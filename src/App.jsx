import React, { useState, useEffect, useRef } from "react";
import { GlobalStyle, LoadingScreen, ConfigWarningBanner, RefundBox } from "./components/shared";
import { Header, TabBar } from "./components/Header";
import { SetupScreen, LoginScreen, LogoutReportScreen } from "./components/AuthScreens";
import { RoomBoard } from "./components/RoomBoard";
import { DailyLedger } from "./components/DailyLedger";
import { BookingsPanel } from "./components/BookingsPanel";
import { ReportsPanel } from "./components/ReportsPanel";
import { ActivityPanel } from "./components/ActivityPanel";
import { UsersPanel } from "./components/UsersPanel";

import { supabaseConfigured } from "./lib/supabaseClient";
import { subscribeToAllChanges } from "./lib/realtime";
import { signUpUser, signIn, signOut, getSession, onAuthStateChange, getMyProfile, listProfiles, checkSetupNeeded, changeOwnPassword as authChangeOwnPassword } from "./lib/auth";
import { getRooms, getRoomOverrides, setRoomOverride } from "./data/rooms";
import { getBookings, insertBooking, updateBookingIfUnchanged, decideBookingRefund } from "./data/bookings";
import { getActivity, addActivity } from "./data/activity";

import { PERMISSIONS, ROOMS_DEFAULT, roomLabel } from "./domain/constants";
import { todayStr, isSameDay, uid } from "./domain/dates";
import { refundDueAmount, fmt } from "./domain/money";
import { withBusy } from "./lib/busy";

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [currentProfile, setCurrentProfile] = useState(null);
  const [allProfiles, setAllProfiles] = useState([]);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [tab, setTab] = useState("board");
  const [rooms, setRooms] = useState(ROOMS_DEFAULT);
  const [overrides, setOverrides] = useState({});
  const [bookings, setBookings] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loadingData, setLoadingData] = useState(true);
  const [toast, setToast] = useState(null);
  const [pendingEditBookingId, setPendingEditBookingId] = useState(null);
  const [logoutGate, setLogoutGate] = useState(false);
  const [sessionExported, setSessionExported] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);

  function requestEditBooking(id) { setPendingEditBookingId(id); setTab("bookings"); }
  // الرسالة بتفضل على الشاشة وقت يتناسب مع طولها (الرسائل الطويلة - زي تفاصيل
  // خطأ أو تحذير مالي - كانت بتختفي في ثانيتين قبل ما تتقرا)، وأي رسالة
  // جديدة بتلغي مؤقّت اللي قبلها بدل ما تتقفل بدري بسببه.
  const toastTimer = useRef(null);
  function showToast(msg) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), Math.min(10000, Math.max(2500, String(msg).length * 70)));
  }
  // بيتزوّد مع كل كتابة (إضافة/تعديل/حذف) من الجهاز ده - عشان لو تحميل بيانات
  // كان شغال وقت الكتابة (بدأ قبلها) ورجع بعدها، مانكتبش نتيجته القديمة فوق
  // التعديل الجديد (بنعيد التحميل بدلها).
  const mutationSeq = useRef(0);

  // إشعار مدير الحجوزات بطلبات رد الفلوس المعلّقة: أي حجز اتلغى (أو اتقصّر)
  // وعليه فلوس متحصّلة بيظهر هنا فورًا (البث اللحظي) كشريط تنبيه + عداد على
  // تبويب الحجوزات + رسالة لحظة وصول طلب جديد.
  const pendingRefunds = bookings.filter((b) => b.refundPending && refundDueAmount(b) > 0);
  const prevRefundIds = useRef(null);
  useEffect(() => {
    // أول تحميل للبيانات بس بيسجّل الطلبات الموجودة أصلاً (من غير رسالة "جديد")
    if (currentProfile?.role !== "reservations" || loadingData) { prevRefundIds.current = null; return; }
    const ids = new Set(pendingRefunds.map((b) => b.id));
    if (prevRefundIds.current) {
      const fresh = pendingRefunds.filter((b) => !prevRefundIds.current.has(b.id));
      if (fresh.length > 0) showToast(`طلب رد فلوس جديد: ${fresh.map((b) => b.guestName).join("، ")} - راجعه من تبويب الحجوزات`);
    }
    prevRefundIds.current = ids;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, currentProfile?.role, loadingData]);

  // البث اللحظي: أي تغيير في أي جدول بيبلّغ كل الشاشات المفتوحة تعيد تحميل
  // بياناتها. الاشتراك بيتعمل بعد تسجيل الدخول (مش وقت فتح الصفحة قبله) عشان
  // قناة الريل تايم تتفتح بجلسة المستخدم الفعلية - الجداول محمية بـ RLS، وقناة
  // اتفتحت قبل الدخول ممكن ما توصلهاش تغييرات لحد ما تتحدث الصفحة يدويًا
  // (ده كان أحد أسباب "لازم أرفرش"). كمان بنعيد التحميل لما القناة ترجع
  // تتوصل بعد انقطاع، ولما التاب يرجع يظهر أو النت يرجع، وبفحص احتياطي كل
  // دقيقة لو القناة وقفت من غير ما نحس.
  useEffect(() => {
    if (!currentProfile) return undefined;
    let timer = null;
    const bump = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setDataVersion((v) => v + 1), 200);
    };
    const unsubscribe = subscribeToAllChanges(bump, (status) => { if (status === "SUBSCRIBED") bump(); });
    const onVisible = () => { if (document.visibilityState === "visible") bump(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", bump);
    const poll = setInterval(() => { if (document.visibilityState === "visible") bump(); }, 60000);
    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", bump);
      unsubscribe();
    };
  }, [currentProfile?.id]);

  // تحميل حالة تسجيل الدخول والاستماع لأي تغيير فيها
  useEffect(() => {
    let cancelled = false;
    let retryTimer = null;
    async function loadAuthState(sess) {
      if (!sess) {
        const needSetup = await checkSetupNeeded();
        if (cancelled) return;
        setCurrentProfile(null); setSetupNeeded(needSetup); setAuthChecked(true);
        return;
      }
      let profile = null, transient = false;
      for (let attempt = 0; attempt < 4 && !profile; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 400));
        const r = await getMyProfile();
        if (cancelled) return;
        transient = !!r?.transientError;
        profile = transient ? null : r;
      }
      // مشكلة شبكة مؤقتة (مش "مفيش بروفايل") ماتخرّجش مستخدم جلسته سليمة وتضيّع
      // اللي فاتح - نسيب الحالة زي ما هي ونحاول تاني بعد شوية.
      if (!profile && transient) {
        setAuthChecked(true);
        retryTimer = setTimeout(() => { if (!cancelled) loadAuthState(sess); }, 4000);
        return;
      }
      if (!profile || !profile.active) {
        await signOut();
        const needSetup = await checkSetupNeeded();
        setCurrentProfile(null); setSetupNeeded(needSetup); setAuthChecked(true);
        return;
      }
      setCurrentProfile(profile); setAuthChecked(true);
    }
    (async () => { const sess = await getSession(); await loadAuthState(sess); })();
    const unsubscribe = onAuthStateChange((sess) => { loadAuthState(sess); });
    return () => { cancelled = true; if (retryTimer) clearTimeout(retryTimer); unsubscribe(); };
  }, []);

  async function refreshProfiles() { const p = await listProfiles(); if (p) setAllProfiles(p); }
  useEffect(() => { if (currentProfile) refreshProfiles(); }, [currentProfile?.id, dataVersion]);

  // أي قراءة فشلت (راجعة null) بنسيب آخر بيانات سليمة زي ما هي بدل ما نفضّي
  // الشاشة - خصوصًا الحجوزات، لأن فحص التعارض بيعتمد عليها. وأي تحميل أقدم
  // من تحميل أحدث (أو من كتابة حصلت في النص) مابيكتبش فوقهم.
  useEffect(() => {
    if (!currentProfile) return undefined;
    let cancelled = false;
    const seqAtStart = mutationSeq.current;
    (async () => {
      const [r, o, b, a] = await Promise.all([getRooms(), getRoomOverrides(), getBookings(), getActivity()]);
      if (cancelled) return;
      if (mutationSeq.current !== seqAtStart) { setDataVersion((v) => v + 1); return; }
      if (r) setRooms(r.length ? r : ROOMS_DEFAULT);
      if (o) setOverrides(o);
      if (b) setBookings(b);
      if (a) setActivity(a);
      setLoadingData(false);
    })();
    return () => { cancelled = true; };
  }, [currentProfile?.id, dataVersion]);

  function logActivity(action) {
    const entry = { userName: currentProfile?.name || "—", username: currentProfile?.username || "—", role: currentProfile?.role || "—", action };
    setActivity((prev) => [{ id: uid(), ts: Date.now(), user: entry.userName, username: entry.username, role: entry.role, action }, ...prev].slice(0, 300));
    addActivity(entry).then((r) => { if (r?.error) showToast("⚠ تعذر تسجيل الحركة في سجل الحركة - اتأكد من النت وسجّل الإجراء تاني لو لزم"); });
  }

  async function handleSaveOverride(roomNumber, status) { mutationSeq.current++; const res = await setRoomOverride(roomNumber, status, currentProfile?.username); mutationSeq.current++; if (!res.error) setOverrides((prev) => ({ ...prev, [roomNumber]: { status, updatedAt: Date.now() } })); return res; }
  // تعديل آمن من تعارض تعديلين في نفس اللحظة (زي اليومية بالظبط): لو حد
  // عدّل نفس الحجز في نفس اللحظة، بنرجّع "تعارض" بدل ما نكتب فوق تعديله
  // من غير ما حد يدري، وبنحدّث بيانات الشاشة من قاعدة البيانات تاني.
  async function safeUpdateBooking(id, booking) {
    mutationSeq.current++;
    const res = await updateBookingIfUnchanged(id, booking.updatedAt, booking);
    mutationSeq.current++; // بعد الكتابة كمان: تحميل بدأ وقت الكتابة ماينفعش يكتب نتيجته فوقها
    if (res.conflict) { setDataVersion((v) => v + 1); return { error: "في حد عدّل نفس الحجز ده في نفس اللحظة - البيانات اتحدّثت، راجعي وجرّبي تاني" }; }
    if (res.data) {
      // طلب الرد اللي أنا اللي فتحته (إلغاء/تقصير من عندي) مش محتاج إشعار "جديد" يغطّي رسالة العملية نفسها
      if (res.data.refundPending && prevRefundIds.current) prevRefundIds.current.add(res.data.id);
      setBookings((prev) => prev.map((b) => (b.id === id ? res.data : b)));
    }
    return res;
  }
  async function handleToggleSettled(booking, value) { return safeUpdateBooking(booking.id, { ...booking, settled: value }); }
  async function handleInsertBooking(booking) { mutationSeq.current++; const res = await insertBooking(booking); mutationSeq.current++; if (res.data) { setBookings((prev) => [res.data, ...prev]); setDataVersion((v) => v + 1); } return res; }
  async function handleUpdateBooking(id, booking) { return safeUpdateBooking(id, booking); }
  // قرار مدير الحجوزات في طلب رد فلوس (رد فعلي / إبقاء الفلوس) - معاملة واحدة
  // في قاعدة البيانات (decide_booking_refund)، وبعدها نحدّث الحجوزات واليومية.
  async function handleDecideRefund(booking, decision, method) {
    mutationSeq.current++;
    const res = await decideBookingRefund(booking.id, decision, booking.updatedAt, method);
    mutationSeq.current++;
    setDataVersion((v) => v + 1);
    return res;
  }

  // قرار طلب رد الفلوس (من أي شاشة): "refund" = رد فعلي بيتخصم من اليومية، "keep" = رفض والفلوس تفضل متحصّلة
  async function runRefund(b, decision, method) {
    return withBusy(async () => {
      const amount = refundDueAmount(b);
      const res = await handleDecideRefund(b, decision, method);
      if (res?.error) { showToast(res.error); return; }
      if (decision === "keep") {
        logActivity(`رفض رد فلوس - ${roomLabel(rooms, b.room)} - ${b.guestName} - ${fmt(amount)} ${b.currency} (الفلوس فضلت متحصّلة)`);
        showToast("تم رفض الرد - الفلوس فضلت متحصّلة على الحجز");
        return;
      }
      logActivity(`رد فلوس - ${roomLabel(rooms, b.room)} - ${b.guestName} - ${fmt(amount)} ${b.currency} (${method})`);
      showToast(`تم رد ${fmt(res?.data?.amount ?? amount)} ${b.currency} - اتشالت من التحصيل واليومية`);
    });
  }

  async function handleSetup({ name, username, pw }) {
    const res = await signUpUser({ username, password: pw, name, role: "gm" });
    if (res.error) return { error: res.error };
    return {};
  }
  async function handleLogin({ username, password }) {
    const res = await signIn({ username, password });
    if (res.error) return { error: res.error };
    setSessionExported(false);
    return {};
  }
  async function doLogout() { await signOut(); setLogoutGate(false); setSessionExported(false); }
  function requestLogout() {
    const mine = activity.filter((a) => a.username === currentProfile?.username && isSameDay(a.ts, todayStr()));
    if (mine.length > 0 && !sessionExported) { setLogoutGate(true); } else { doLogout(); }
  }
  function finishLogoutExport() { setSessionExported(true); setLogoutGate(false); doLogout(); }
  async function changeOwnPasswordHandler(pw) { const res = await authChangeOwnPassword(pw); if (res.error) { showToast(res.error); return false; } showToast("تم تغيير كلمة المرور"); return true; }

  if (!authChecked) return <div className="calma-app" dir="rtl"><GlobalStyle />{!supabaseConfigured && <ConfigWarningBanner />}<LoadingScreen /></div>;
  if (!currentProfile && setupNeeded) return <><SetupScreen onCreate={handleSetup} />{!supabaseConfigured && <ConfigWarningBanner />}</>;
  if (!currentProfile) return <><LoginScreen onLogin={handleLogin} />{!supabaseConfigured && <ConfigWarningBanner />}</>;

  const perms = PERMISSIONS[currentProfile.role];
  const activeTab = perms.tabs.includes(tab) ? tab : perms.tabs[0];

  if (logoutGate) {
    const mine = activity.filter((a) => a.username === currentProfile.username && isSameDay(a.ts, todayStr()));
    return <LogoutReportScreen user={currentProfile} actions={mine} onExportAndLogout={finishLogoutExport} onCancel={() => setLogoutGate(false)} />;
  }

  return (
    <div className="calma-app" dir="rtl">
      <GlobalStyle />
      <Header user={currentProfile} onLogout={requestLogout} onChangePassword={changeOwnPasswordHandler} />
      <TabBar tabs={perms.tabs} active={activeTab} onChange={setTab} badges={perms.decideRefund ? { bookings: pendingRefunds.length } : {}} />
      {pendingRefunds.length > 0 && perms.tabs.includes("bookings") && activeTab !== "bookings" && (
        <div className="cx-no-print" data-testid="refund-banner" style={{ background: "#F4E7E2", padding: "8px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ color: "var(--rust)", fontSize: 12.5, fontWeight: 700 }}>🔔 طلبات رد فلوس منتظرة ({pendingRefunds.length}){perms.decideRefund ? " - موافقة بضغطة واحدة" : " - مدير الحجوزات هو اللي بيوافق"}</div>
          {pendingRefunds.map((b) => (
            <div key={b.id} data-testid="refund-inbox-item" style={{ fontSize: 12.5 }}>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>{roomLabel(rooms, b.room)} · {b.guestName}</div>
              <RefundBox b={b} canDecide={!!perms.decideRefund} onDecide={runRefund} />
            </div>
          ))}
        </div>
      )}
      {loadingData ? <LoadingScreen /> : (
        <>
          {activeTab === "board" && <RoomBoard rooms={rooms} overrides={overrides} bookings={bookings} perms={perms} profile={currentProfile} onSaveOverride={handleSaveOverride} onToggleSettled={handleToggleSettled} onUpdateBooking={handleUpdateBooking} onEditBooking={requestEditBooking} onDecideRefund={runRefund} onLog={logActivity} showToast={showToast} dataVersion={dataVersion} />}
          {activeTab === "ledger" && <DailyLedger rooms={rooms} perms={perms} profile={currentProfile} onLog={logActivity} showToast={showToast} dataVersion={dataVersion} />}
          {activeTab === "bookings" && <BookingsPanel rooms={rooms} bookings={bookings} perms={perms} role={currentProfile.role} profile={currentProfile} onInsertBooking={handleInsertBooking} onUpdateBooking={handleUpdateBooking} onDecideRefund={runRefund} onLog={logActivity} showToast={showToast} pendingEditId={pendingEditBookingId} onConsumeEditRequest={() => setPendingEditBookingId(null)} dataVersion={dataVersion} />}
          {activeTab === "reports" && <ReportsPanel rooms={rooms} bookings={bookings} dataVersion={dataVersion} profile={currentProfile} />}
          {activeTab === "activity" && <ActivityPanel activity={activity} />}
          {activeTab === "users" && <UsersPanel users={allProfiles} onRefresh={refreshProfiles} currentUsername={currentProfile.username} readOnly={!perms.manageUsers} onLog={logActivity} showToast={showToast} dataVersion={dataVersion} />}
        </>
      )}
      {toast && <div className="cx-toast">{toast}</div>}
      {!supabaseConfigured && <ConfigWarningBanner />}
    </div>
  );
}
