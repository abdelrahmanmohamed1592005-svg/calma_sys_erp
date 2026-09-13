import React, { useState, useEffect } from "react";
import { GlobalStyle, LoadingScreen, ConfigWarningBanner } from "./components/shared";
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
import { getRooms, getRoomOverrides, setRoomOverride, saveRoom } from "./data/rooms";
import { getBookings, insertBooking, updateBooking, deleteBooking } from "./data/bookings";
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

  function requestEditBooking(id) { setPendingEditBookingId(id); setTab("bookings"); }
  function showToast(msg) { setToast(msg); setTimeout(() => setToast(null), 2200); }

  // البث اللحظي: أي تغيير في أي جدول بيبلّغ كل الشاشات المفتوحة تعيد تحميل بياناتها
  useEffect(() => {
    const unsubscribe = subscribeToAllChanges(() => setDataVersion((v) => v + 1));
    return unsubscribe;
  }, []);

  // تحميل حالة تسجيل الدخول والاستماع لأي تغيير فيها
  useEffect(() => {
    let cancelled = false;
    async function loadAuthState(sess) {
      if (!sess) {
        const needSetup = await checkSetupNeeded();
        if (cancelled) return;
        setCurrentProfile(null); setSetupNeeded(needSetup); setAuthChecked(true);
        return;
      }
      let profile = null;
      for (let attempt = 0; attempt < 4 && !profile; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 400));
        profile = await getMyProfile();
        if (cancelled) return;
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
    return () => { cancelled = true; unsubscribe(); };
  }, []);

  async function refreshProfiles() { setAllProfiles(await listProfiles()); }
  useEffect(() => { if (currentProfile) refreshProfiles(); }, [currentProfile?.id, dataVersion]);

  useEffect(() => {
    if (!currentProfile) return;
    (async () => {
      const [r, o, b, a] = await Promise.all([getRooms(), getRoomOverrides(), getBookings(), getActivity()]);
      setRooms(r.length ? r : ROOMS_DEFAULT); setOverrides(o); setBookings(b); setActivity(a); setLoadingData(false);
    })();
  }, [currentProfile?.id, dataVersion]);

  function logActivity(action) {
    const entry = { userName: currentProfile?.name || "—", username: currentProfile?.username || "—", role: currentProfile?.role || "—", action };
    setActivity((prev) => [{ id: uid(), ts: Date.now(), user: entry.userName, username: entry.username, role: entry.role, action }, ...prev].slice(0, 300));
    addActivity(entry);
  }

  async function handleSaveOverride(roomNumber, status) { const res = await setRoomOverride(roomNumber, status, currentProfile?.username); if (!res.error) setOverrides((prev) => ({ ...prev, [roomNumber]: { status, updatedAt: Date.now() } })); return res; }
  async function handleSaveRoom(room) { const res = await saveRoom(room); if (!res.error) setRooms((prev) => prev.map((r) => (r.number === room.number ? { ...r, ...room } : r))); return res; }
  async function handleToggleSettled(booking, value) { const res = await updateBooking(booking.id, { ...booking, settled: value }); if (res.data) setBookings((prev) => prev.map((b) => (b.id === booking.id ? res.data : b))); return res; }
  async function handleInsertBooking(booking) { const res = await insertBooking(booking); if (res.data) setBookings((prev) => [res.data, ...prev]); return res; }
  async function handleUpdateBooking(id, booking) { const res = await updateBooking(id, booking); if (res.data) setBookings((prev) => prev.map((b) => (b.id === id ? res.data : b))); return res; }
  async function handleDeleteBooking(id) { const res = await deleteBooking(id); if (!res.error) setBookings((prev) => prev.filter((b) => b.id !== id)); return res; }

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
  async function changeOwnPasswordHandler(pw) { const res = await authChangeOwnPassword(pw); if (res.error) { showToast(res.error); return; } showToast("تم تغيير كلمة المرور"); }

  if (!authChecked) return <div className="calma-app" dir="rtl"><GlobalStyle />{!supabaseConfigured && <ConfigWarningBanner />}<LoadingScreen /></div>;
  if (!currentProfile && setupNeeded) return <><SetupScreen onCreate={handleSetup} />{!supabaseConfigured && <ConfigWarningBanner />}</>;
  if (!currentProfile) return <><LoginScreen onLogin={handleLogin} />{!supabaseConfigured && <ConfigWarningBanner />}</>;

  const perms = PERMISSIONS[currentProfile.role];
  const activeTab = perms.tabs.includes(tab) ? tab : perms.tabs[0];

  if (logoutGate) {
    const mine = activity.filter((a) => a.username === currentProfile.username && isSameDay(a.ts, todayStr()));
    return <LogoutReportScreen user={currentProfile} actions={mine} onExportAndLogout={finishLogoutExport} />;
  }

  return (
    <div className="calma-app" dir="rtl">
      <GlobalStyle />
      <Header user={currentProfile} onLogout={requestLogout} onChangePassword={changeOwnPasswordHandler} />
      <TabBar tabs={perms.tabs} active={activeTab} onChange={setTab} />
      {loadingData ? <LoadingScreen /> : (
        <>
          {activeTab === "board" && <RoomBoard rooms={rooms} overrides={overrides} bookings={bookings} perms={perms} onSaveOverride={handleSaveOverride} onSaveRoom={handleSaveRoom} onToggleSettled={handleToggleSettled} onEditBooking={requestEditBooking} onLog={logActivity} showToast={showToast} dataVersion={dataVersion} />}
          {activeTab === "ledger" && <DailyLedger rooms={rooms} perms={perms} profile={currentProfile} onLog={logActivity} showToast={showToast} dataVersion={dataVersion} />}
          {activeTab === "bookings" && <BookingsPanel rooms={rooms} bookings={bookings} perms={perms} role={currentProfile.role} onInsertBooking={handleInsertBooking} onUpdateBooking={handleUpdateBooking} onDeleteBooking={handleDeleteBooking} onLog={logActivity} showToast={showToast} pendingEditId={pendingEditBookingId} onConsumeEditRequest={() => setPendingEditBookingId(null)} />}
          {activeTab === "reports" && <ReportsPanel rooms={rooms} bookings={bookings} dataVersion={dataVersion} />}
          {activeTab === "activity" && <ActivityPanel activity={activity} />}
          {activeTab === "users" && <UsersPanel users={allProfiles} onRefresh={refreshProfiles} currentUsername={currentProfile.username} readOnly={!perms.manageUsers} onLog={logActivity} showToast={showToast} dataVersion={dataVersion} />}
        </>
      )}
      {toast && <div className="cx-toast">{toast}</div>}
      {!supabaseConfigured && <ConfigWarningBanner />}
    </div>
  );
}
