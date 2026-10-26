import { useState, useEffect, useRef } from "react";
import { GlobalStyle, BackToTop, LoadingScreen, ConfigWarningBanner, SchemaOutdatedBanner } from "./components/shared";
import { checkSchemaVersion, REQUIRED_SCHEMA_VERSION } from "./data/schemaCheck";
import { Header, TabBar, PageHead } from "./components/Header";
import { SetupScreen, LoginScreen, LogoutReportScreen } from "./components/AuthScreens";
import { RoomBoard } from "./components/RoomBoard";
import { DailyLedger } from "./components/DailyLedger";
import { BookingsPanel } from "./components/BookingsPanel";
import { ReportsPanel } from "./components/ReportsPanel";
import { ActivityPanel } from "./components/ActivityPanel";
import { UsersPanel } from "./components/UsersPanel";
import { CommandPalette } from "./components/CommandPalette";

import { supabaseConfigured } from "./lib/supabaseClient";
import { subscribeToAllChanges } from "./lib/realtime";
import { signUpUser, signIn, signOut, getSession, onAuthStateChange, getMyProfile, listProfiles, checkSetupNeeded, changeOwnPassword as authChangeOwnPassword } from "./lib/auth";
import { getRooms, getRoomOverrides, setRoomOverride } from "./data/rooms";
import { getBookings, insertBooking, updateBookingIfUnchanged } from "./data/bookings";
import { getActivity, addActivity } from "./data/activity";

import { PERMISSIONS, ROOMS_DEFAULT } from "./domain/constants";
import { todayStr, isSameDay, uid } from "./domain/dates";

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
  const [schemaState, setSchemaState] = useState({ ok: null });
  // بحث سريع (Ctrl+K) + "اقفز لـ" غرفة/حجز من أي شاشة
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [jump, setJump] = useState(null);       // { room } أو { query } + nonce
  useEffect(() => {
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K" || e.code === "KeyK")) { e.preventDefault(); setPaletteOpen((o) => !o); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // فحص نسخة قاعدة البيانات بعد الدخول (وكل ما التاب يرجع ظاهر): لو أقدم من اللي الواجهة محتاجاه نحذّر بوضوح
  useEffect(() => {
    if (!currentProfile) return undefined;
    let cancelled = false;
    const run = async () => { const r = await checkSchemaVersion(); if (!cancelled) setSchemaState(r); };
    run();
    const onVis = () => { if (document.visibilityState === "visible") run(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { cancelled = true; document.removeEventListener("visibilitychange", onVis); };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- بنعيد الفحص لما يتغيّر المستخدم (id) بس؛ كائن الـ profile بيتغيّر مرجعه كل تحديث
  }, [currentProfile?.id]);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- مربوط بهوية المستخدم (id) عمدًا - الاشتراك اللحظي مايتعاد بتغيّر مرجع كائن الـ profile
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- مربوط بهوية المستخدم وdataVersion عمدًا (قراءة قائمة المستخدمين)
  useEffect(() => { if (currentProfile) refreshProfiles(); }, [currentProfile?.id, dataVersion]);

  // أي قراءة فشلت (راجعة null) بنسيب آخر بيانات سليمة زي ما هي بدل ما نفضّي
  // الشاشة - خصوصًا الحجوزات، لأن فحص التعارض بيعتمد عليها. وأي تحميل أقدم
  // من تحميل أحدث (أو من كتابة حصلت في النص) مابيكتبش فوقهم.
  // لما المستخدم يتغيّر (خروج/دخول بحساب تاني على نفس الجهاز) بنفضّي كل بياناته: من غير كده مستخدم جديد كان بيشوف لحظيًا
  // حجوزات وحركات اللي قبله، ولو قراءاته فشلت أو اتفلترت بالصلاحيات كانت بتفضل ظاهرة
  const loadedOnce = useRef(false);
  useEffect(() => {
    setBookings([]); setActivity([]); setOverrides({}); setAllProfiles([]); setLoadingData(true); setTab("board");
    setSchemaState({ ok: null }); loadedOnce.current = false; setJump(null); setPaletteOpen(false);
  }, [currentProfile?.id]);

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
      if (b) { setBookings(b); loadedOnce.current = true; }
      if (a) setActivity(a);
      // أول تحميل والحجوزات ماتقرتش (نت/سيرفر): ماننزلش شاشة "فندق فاضي" ولا نمرّر فحص التعارض على قايمة فاضية؛
      // بنفضل على التحميل ونعيد المحاولة تلقائيًا
      if (!loadedOnce.current) {
        showToast("⚠ تعذر تحميل الحجوزات (مشكلة اتصال) - بنعيد المحاولة تلقائيًا");
        setTimeout(() => { if (!cancelled) setDataVersion((v) => v + 1); }, 4000);
        return;
      }
      setLoadingData(false);
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- مربوط بهوية المستخدم وdataVersion عمدًا - إضافة كائن الـ profile كانت هتعمل تحميل زيادة لكل تحديث ملف
  }, [currentProfile?.id, dataVersion]);

  function logActivity(action) {
    const entry = { userName: currentProfile?.name || "—", username: currentProfile?.username || "—", role: currentProfile?.role || "—", action };
    setActivity((prev) => [{ id: uid(), ts: Date.now(), user: entry.userName, username: entry.username, role: entry.role, action }, ...prev].slice(0, 300));
    addActivity(entry).then((r) => { if (r?.error) showToast("⚠ تعذر تسجيل الحركة في سجل الحركة - اتأكد من النت وسجّل الإجراء تاني لو لزم"); });
  }

  // بعد عملية في القاعدة (دفعة مثلاً): نعيد تحميل الحجوزات واليوميات من القاعدة
  // بعد عملية ذرية في القاعدة (دفعة مثلاً): نجيب الحجوزات من جديد ونستنى ده يخلص قبل ما الشاشة تقول "تم" (من غير كده البطاقة
  // كانت بتفضل شايفة "المدفوع صفر" لحظات بعد رسالة النجاح). بترجّع true لو التحديث نجح.
  async function refreshAll() {
    mutationSeq.current++;
    const b = await getBookings();
    mutationSeq.current++;
    if (b) setBookings(b);
    setDataVersion((v) => v + 1);
    return !!b;
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
      setBookings((prev) => prev.map((b) => (b.id === id ? res.data : b)));
    }
    return res;
  }
  async function handleInsertBooking(booking) { mutationSeq.current++; const res = await insertBooking(booking); mutationSeq.current++; if (res.data) { setBookings((prev) => [res.data, ...prev]); setDataVersion((v) => v + 1); } return res; }
  async function handleUpdateBooking(id, booking) { return safeUpdateBooking(id, booking); }
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
  // قبل الخروج: أي كتابة معلّقة في اليومية (كتبها الموظف من أقل من ثانية أو لسه في إعادة محاولة) بتتبعت الأول، وبعدين بنخرج؛
  // من غير كده الخروج كان بيقفل الجلسة قبل الحفظ فالكتابة بتتبخر
  async function flushBeforeLeave() {
    try {
      if (window.__calmaFlushLedger) await window.__calmaFlushLedger();
      for (let i = 0; i < 30 && window.__calmaBusyCount; i++) await new Promise((r) => setTimeout(r, 100));
    } catch { /* مانمنعش الخروج */ }
  }
  async function doLogout() { await flushBeforeLeave(); await signOut(); setLogoutGate(false); setSessionExported(false); }
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
    <div className="calma-app cx-shell" dir="rtl">
      <GlobalStyle />
      <Header user={currentProfile} onLogout={requestLogout} onChangePassword={changeOwnPasswordHandler} onOpenSearch={() => setPaletteOpen(true)} />
      <TabBar tabs={perms.tabs} active={activeTab} onChange={setTab} badges={{}} />
      <main className="cx-main">
      {schemaState.ok === false && <SchemaOutdatedBanner version={schemaState.version} required={REQUIRED_SCHEMA_VERSION} isAdmin={currentProfile.role === "gm"} />}
      <PageHead tab={activeTab} />
      {loadingData ? <LoadingScreen /> : (
        <>
          {activeTab === "board" && <RoomBoard jumpRoom={jump?.room != null ? jump : null} onJumpDone={() => setJump(null)} rooms={rooms} overrides={overrides} bookings={bookings} perms={perms} profile={currentProfile} onSaveOverride={handleSaveOverride} onUpdateBooking={handleUpdateBooking} onRefresh={refreshAll} onEditBooking={requestEditBooking} onLog={logActivity} showToast={showToast} dataVersion={dataVersion} />}
          {activeTab === "ledger" && <DailyLedger rooms={rooms} bookings={bookings} profiles={allProfiles} perms={perms} profile={currentProfile} onLog={logActivity} showToast={showToast} dataVersion={dataVersion} />}
          {activeTab === "bookings" && <BookingsPanel jumpQuery={jump?.query != null ? jump : null} onJumpDone={() => setJump(null)} rooms={rooms} bookings={bookings} perms={perms} role={currentProfile.role} profile={currentProfile} onInsertBooking={handleInsertBooking} onUpdateBooking={handleUpdateBooking} onRefresh={refreshAll} onLog={logActivity} showToast={showToast} pendingEditId={pendingEditBookingId} onConsumeEditRequest={() => setPendingEditBookingId(null)} dataVersion={dataVersion} />}
          {activeTab === "reports" && <ReportsPanel rooms={rooms} bookings={bookings} dataVersion={dataVersion} profile={currentProfile} />}
          {activeTab === "activity" && <ActivityPanel activity={activity} />}
          {activeTab === "users" && <UsersPanel users={allProfiles} onRefresh={refreshProfiles} currentUsername={currentProfile.username} readOnly={!perms.manageUsers} onLog={logActivity} showToast={showToast} dataVersion={dataVersion} />}
        </>
      )}
      </main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} tabs={perms.tabs} rooms={rooms} bookings={bookings} overrides={overrides}
        onGoTab={(t) => setTab(t)}
        onOpenRoom={(r) => { setTab(perms.tabs.includes("board") ? "board" : perms.tabs[0]); setJump({ room: r, nonce: Date.now() }); }}
        onFindBooking={(name) => { if (perms.tabs.includes("bookings")) { setTab("bookings"); setJump({ query: name, nonce: Date.now() }); } }} />
      <BackToTop />
      {toast && <div className="cx-toast" role="status">{toast}</div>}
      {!supabaseConfigured && <ConfigWarningBanner />}
    </div>
  );
}
