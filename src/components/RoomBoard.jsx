import { useState, useEffect, useMemo, useRef } from "react";
import { Pencil, Check, X, Plus, ArrowLeftRight, Eye, AlertTriangle, Search, Wallet, Receipt, BedDouble, CalendarDays, Moon, Users, Hash, LogIn, LogOut } from "lucide-react";
import { fmt, money, emptyMoney, currencyKeysOf, computeShiftTotals, bookingGrandTotal, bookingAmountDue, PAYMENT_METHODS, emptyPaymentDetails, cleanPaymentDetailsFor, validatePaymentDetailsFor, describePaymentDetails, ONLINE_METHODS } from "../domain/money";
import { todayStr, shiftDayNow, nightsBetween, addDays } from "../domain/dates";
import { SHIFTS, STATUS_COLORS, MANUAL_STATUS_OPTIONS, roomLabel } from "../domain/constants";
import { computeRoomStatus, roomsOverlap, findOverlappingBooking, repricedTotalRoom, earlyLeavePatch, normalizeGuestCodes, duplicateGuestCode, findGuestCodeHits, guestCodeEntries } from "../domain/bookingLogic";
import { getShiftRecord, getBookingPayments } from "../data/shifts";
import { recordBookingPayment, recordBookingPaymentFx, moveBookingRoom } from "../data/payments";
import { useShiftGate } from "../hooks/useShiftGate";
import { roomOptionLabel, PayCurrencyFields, fxPreview, DateRange, RoomName, AutoText, GuestCodeChips, GuestCodeHits, TwoStepButton, MoneyBox, RefundBox, PaymentDetailsInline, PayBreakdown } from "./shared";
import { sanitizeText } from "../domain/security";
import { withBusy, guarded } from "../lib/busy";

// نص الأقراص على الخلفية الفاتحة: ألوان أغمق من ألوان المربعات عشان تحقق تباين WCAG AA (٤.٥:١)
const STATUS_TEXT = { ...STATUS_COLORS, occupied_paid: "#6B5300", occupied_unpaid: "#B0222E", early_checkout: "#8F4A12" };
// اسم قصير للحالة على مربع الغرفة (الاسم الكامل في البطاقة والفلتر)
const TILE_LABEL = { available: "متاحة", occupied_paid: "مدفوعة", occupied_unpaid: "عليها فلوس", reserved: "قادمة", early_checkout: "خرج بدري", maintenance: "صيانة", cleaning: "تنظيف" };
const STATUS_TINTS = { available: "#E6F2EA", occupied_paid: "#F5EFD6", occupied_unpaid: "#FBE2E4", reserved: "#EDE7F5", early_checkout: "#FBE9DA", maintenance: "#EEEBE7", cleaning: "#E3EBF0" };

/* قسم مطوي في بطاقة الغرفة (برّه الـ component عشان الحقول اللي جواه ماتتفقدش الفوكس وقت الكتابة) */
function Sec({ id, title, children, badge }) {
  return (
    <details data-testid={id} style={{ marginTop: 4, background: "#fff", borderRadius: 12, padding: "10px 14px", border: "1px solid var(--hair2)" }}>
      <summary style={{ cursor: "pointer", fontSize: 14.5, fontWeight: 700, color: "var(--ink)" }}>{title}{badge ? <span className="cx-pill" style={{ background: "var(--paper2)", marginInlineStart: 6, fontSize: 12 }}>{badge}</span> : null}</summary>
      <div style={{ marginTop: 8 }}>{children}</div>
    </details>
  );
}

/* "النهارده": مين جاي، مين ماشي، ومين لسه عليه فلوس - بضغطة على الاسم بتفتح غرفته */
function TodayStrip({ rooms, bookings, overrides, date, onOpen }) {
  const live = bookings.filter((b) => b.status !== "ملغي");
  const arrivals = live.filter((b) => b.checkin === date);
  const departures = live.filter((b) => b.checkout === date && b.checkin !== date);
  const due = rooms.map((r) => computeRoomStatus(r.number, bookings, overrides, date)).filter((st) => st.key === "occupied_unpaid" && st.booking).map((st) => st.booking);
  const cols = [
    ["arr", "وصول النهارده", LogIn, "teal", arrivals, "مفيش وصول متوقع النهارده"],
    ["dep", "مغادرة النهارده", LogOut, "amber", departures, "مفيش مغادرة النهارده"],
    ["due", "مطلوب تحصيله", Wallet, "red", due, "كل النزلاء الساكنين دافعين ✓"],
  ];
  return (
    <div className="cx-today cx-no-print" data-testid="today-strip">
      {cols.map(([k, title, Icon, tone, list, empty]) => (
        <div key={k} className="cx-card cx-today-col">
          <div className="cx-today-head"><span className={"cx-ico sm ic-" + tone} aria-hidden="true"><Icon size={16} /></span><b>{title}</b><span className="cx-today-n">{list.length}</span></div>
          {list.length === 0 ? <div className="cx-hint" style={{ padding: "4px 2px" }}>{empty}</div> : (
            <ul>
              {list.slice(0, 4).map((b) => (
                <li key={b.id}><button type="button" onClick={() => onOpen(b.room)}>
                  <span className="r"><RoomName rooms={rooms} number={b.room} /></span><span className="g">{b.guestName}</span>
                  {k === "due" && <span className="d">{fmt(bookingAmountDue(b))} {b.currency}</span>}
                </button></li>
              ))}
              {list.length > 4 && <li className="cx-hint" style={{ padding: "2px 6px" }}>+ {list.length - 4} كمان</li>}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

const EXTRA_KINDS = [["laundry", "غسيل"], ["cafeteria", "كافيتيريا"], ["tours", "جولات"], ["pickup", "بيك أب"]];

export function RoomBoard({ jumpRoom, onJumpDone, rooms, overrides, bookings, perms, profile, onSaveOverride, onUpdateBooking, onRefresh, onEditBooking, onLog, showToast, dataVersion }) {
  const [selected, setSelected] = useState(null);
  const [stFilter, setStFilter] = useState("all");
  // فتح غرفة جاية من البحث السريع
  useEffect(() => { if (jumpRoom?.room != null) { setStFilter("all"); setSelected(jumpRoom.room); onJumpDone?.(); } }, [jumpRoom?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  // Esc بيقفل بطاقة الغرفة المفتوحة
  useEffect(() => {
    if (selected == null) return undefined;
    const onKey = (e) => { if (e.key === "Escape" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) setSelected(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);
  const [kpis, setKpis] = useState(null);
  const [extrasDraft, setExtrasDraft] = useState(null);
  const [addSvc, setAddSvc] = useState("laundry");
  const [addAmt, setAddAmt] = useState("");
  const [addLock, setAddLock] = useState(false);
  const [fixMode, setFixMode] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTo, setMoveTo] = useState("");
  const [moveLock, setMoveLock] = useState(false);
  const extrasBaseRef = useRef("");
  const normExtras = (e) => JSON.stringify([Number(e?.laundry) || 0, Number(e?.cafeteria) || 0, Number(e?.tours) || 0, Number(e?.pickup) || 0]);
  // دفعة جديدة على الحجز: مبلغ + وسيلة + تفاصيلها (فيزا = آخر 4 أرقام، تحويل = اسم + رقم)
  // زرار التحصيل بيتقفل وقت الحفظ ولحظة بعده: دوسات ورا بعض (دبل/تريبل كليك) ماتسجّلش "كامل المتبقي" تاني
  const [payLock, setPayLock] = useState(false);
  const [pay, setPay] = useState({ amount: "", method: "كاش", details: emptyPaymentDetails(), currency: "", rate: "" });
  // تحصيل رسم الدخول المبكر ليه وسيلته وتفاصيله المستقلة (مايتخلطوش مع خانات الدفعة العادية)
  const [epay, setEpay] = useState({ method: "كاش", details: emptyPaymentDetails() });
  const [codeQuery, setCodeQuery] = useState("");
  const [extendNights, setExtendNights] = useState(1);
  const [ecFee, setEcFee] = useState("");
  const [ecNote, setEcNote] = useState("");
  const [ecCollect, setEcCollect] = useState(true);
  const [codesDraft, setCodesDraft] = useState([]);
  const [payBreakdown, setPayBreakdown] = useState(null);
  const date = todayStr();
  const room = rooms.find((r) => r.number === selected);
  const status = selected ? computeRoomStatus(selected, bookings, overrides, date) : null;

  // eslint-disable-next-line react-hooks/exhaustive-deps -- مربوط بالغرفة وبقيم الرسوم المحفوظة عمدًا - إضافة كائن الحجز كانت هتمسح اللي الموظف بيكتبه مع كل تحديث
  useEffect(() => { if (status?.booking) setExtrasDraft({ laundry: status.booking.extras?.laundry || "", cafeteria: status.booking.extras?.cafeteria || "", tours: status.booking.extras?.tours || "", pickup: status.booking.extras?.pickup || "" }); else setExtrasDraft(null); if (status?.booking) extrasBaseRef.current = normExtras(status.booking.extras); }, [selected, status?.booking?.id]);
  useEffect(() => { setPay({ amount: "", method: "كاش", details: emptyPaymentDetails(), currency: "", rate: "" }); setAddAmt(""); setFixMode(false); setMoveOpen(false); setMoveTo(""); }, [selected, status?.booking?.id]);
  useEffect(() => { setExtendNights(1); setEcFee(""); setEcNote(""); setEcCollect(true); setEpay({ method: "كاش", details: emptyPaymentDetails() }); }, [selected, status?.booking?.id]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- مربوط بالغرفة/الحجز وعدد الأفراد وأكواده (JSON) عمدًا لنفس السبب
  useEffect(() => { if (status?.booking) setCodesDraft(normalizeGuestCodes(status.booking.guestCodes, status.booking.pax)); else setCodesDraft([]); }, [selected, status?.booking?.id, status?.booking?.pax, JSON.stringify(status?.booking?.guestCodes || [])]);

  // المدفوع على الحجز مقسّم بالوسيلة (من اليومية) - بيتحدّث مع أي تحصيل/رد
  useEffect(() => {
    const bk = status?.booking;
    if (!bk) { setPayBreakdown(null); return undefined; }
    let cancelled = false;
    (async () => { const r = await getBookingPayments(bk); if (!cancelled) setPayBreakdown(r); })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.booking?.id, status?.booking?.amountPaid, dataVersion]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let rev = emptyMoney(), exp = emptyMoney(), flagged = 0;
      for (const s of SHIFTS) {
        const r = await getShiftRecord(shiftDayNow(), s.key);
        if (cancelled) return;
        if (!r) continue;
        const t = computeShiftTotals(r);
        currencyKeysOf(t.totalCollections).forEach((c) => { rev[c] = (rev[c] || 0) + t.totalCollections[c]; });
        currencyKeysOf(t.totalExpenses).forEach((c) => { exp[c] = (exp[c] || 0) + t.totalExpenses[c]; });
        if (r.flagged) flagged += 1;
      }
      if (!cancelled) setKpis({ rev, exp, flagged });
    })();
    return () => { cancelled = true; };
  }, [date, dataVersion]);

  // موظف الشيفت (staff) يقدر يغيّر حالة الغرف ويحصّل الفلوس بس وهو في شيفته
  // الفعلي اللي حاجزه ولسه مفتوح (مش مقفول) - عشان نمنع موظف يدخل بره معاده
  // أو بعد ما يكون قفل شيفته يعدل على حاجة مش شغله. الهوك ده نفسه بالظبط
  // المستخدم في BookingsPanel.jsx عشان الاتنين يتفقوا على نفس القرار بدون
  // أي تضارب. باقي الأدوار (مدير الحجوزات/الحسابات/المدير العام) مش مربوطة
  // بشيفت أصلًا (roomStatusRestricted: false) فمش بيأثر عليهم.
  const { offShift, shiftClosed, myActiveShiftKey } = useShiftGate(profile, perms, dataVersion);


  async function saveOverride(statusKey) {
    if (offShift) { showToast(shiftClosed ? "شيفتك مقفول - لازم المدير العام أو مدير الحجوزات يفتحوه تاني الأول" : "مش شيفتك دلوقتي - الحالة مش هتتعدل غير وقت شيفتك اللي حاجزه"); return; }
    const res = await onSaveOverride(selected, statusKey);
    if (res?.error) { showToast(res.error); return; }
    onLog(`تغيير حالة ${roomLabel(rooms, selected)} إلى: ${MANUAL_STATUS_OPTIONS.find((o) => o.key === statusKey)?.label}`);
    showToast("تم تحديث حالة الغرفة");
  }
  // تسجيل دفعة (كاملة أو جزئية) على الحجز: كل دفعة ليها وسيلتها وتفاصيلها
  // (فيزا: آخر 4 أرقام، تحويل: اسم + رقم) وبتتسجّل في صف نفس الوسيلة في اليومية،
  // فتدخل التحصيل وعهدة الفيزا والتقرير بنفس التفاصيل. حالة الحجز (مدفوع
  // بالكامل / متبقي) بتتحدّث لوحدها من المدفوع والإجمالي - مفيش علامة بتتعلّم.
  // لو النزيل عليه خدمات كافيتيريا، الدفعة بتسدّدها الأول وبتروح لصف الكافيتيريا.
  async function recordPayment(booking) {
    setPayLock(true);
    try { return await guarded("pay:" + booking.id, () => recordPaymentInner(booking)); }
    finally { setTimeout(() => setPayLock(false), 700); }
  }
  async function recordPaymentInner(booking) {
    if (offShift) { showToast(shiftClosed ? "شيفتك مقفول - لازم يُفتح تاني الأول" : "مش شيفتك دلوقتي"); return; }
    const due = bookingAmountDue(booking);
    const fxCur = pay.currency && pay.currency !== booking.currency ? pay.currency : "";
    const fx = fxCur ? fxPreview({ amount: pay.amount, currency: fxCur, rate: pay.rate, bookingCurrency: booking.currency, due }) : null;
    if (fx && !(fx.rate > 0)) { showToast(`اكتب سعر الصرف: 1 ${booking.currency} = كام ${fxCur}`); return; }
    const typed = fx ? fx.amt : pay.amount === "" ? due : Number(pay.amount);
    const amount = Math.round((Number(typed) || 0) * 100) / 100;
    if (!(amount > 0)) { showToast("اكتب مبلغ الدفعة (أكبر من صفر)"); return; }
    if (fx ? fx.covered - due > 0.01 : amount > due) { showToast(`المبلغ أكبر من المتبقي على النزيل (${fmt(due)} ${booking.currency}${fx ? ` = ${fmt(Math.round(due * fx.rate * 100) / 100)} ${fxCur}` : ""})`); return; }
    const detailsErr = validatePaymentDetailsFor(pay.method, pay.details);
    if (detailsErr) { showToast(detailsErr); return; }
    if (!myActiveShiftKey) { showToast("مفيش شيفتك شغال دلوقتي - التحصيل لازم يتسجّل في يومية شيفتك"); return; }
    const method = pay.method;
    const rawDetails = pay.details;
    const before = { ...pay };
    // الخانات بتتصفّر فورًا (القيم اتحفظت فوق) عشان اللي بيتكتب بعد كده مايضيعش وقت الحفظ
    setPay({ amount: "", method: "كاش", details: emptyPaymentDetails(), currency: "", rate: "" });
    // عملية واحدة ذرية في القاعدة: المدفوع على الحجز + صف الوسيلة في اليومية + (لو عليه كافيتيريا) صف الكافيتيريا
    const res = fx
      ? await recordBookingPaymentFx({ bookingId: booking.id, amount, currency: fxCur, rate: fx.rate, method, details: rawDetails, note: "تحصيل", expectedUpdatedAt: booking.updatedAt })
      : await recordBookingPayment({ bookingId: booking.id, amount, method, details: rawDetails, note: "تحصيل", expectedUpdatedAt: booking.updatedAt });
    if (res?.error) { showToast(res.error); if (onRefresh) onRefresh(); setPay({ ...before, amount: String(amount) }); return; }
    const out = res.data || {};
    const details = out.details || cleanPaymentDetailsFor(method, rawDetails);
    const detailsText = describePaymentDetails(method, details) ? "\u2066" + describePaymentDetails(method, details) + "\u2069" : "";
    const covered = fx ? Number(out.covered) || fx.covered : amount;
    const paidText = fx ? `${fmt(amount)} ${fxCur} (= ${fmt(covered)} ${booking.currency} بسعر ${fmt(fx.rate)})` : `${fmt(amount)} ${booking.currency}`;
    onLog(`تحصيل ${paidText} (${method}${detailsText ? " " + detailsText : ""}) - ${roomLabel(rooms, booking.room)} - ${booking.guestName}`);
    if (onRefresh) await onRefresh();
    getBookingPayments(booking).then((r) => { if (r) setPayBreakdown(r); });     // تفصيل المدفوع بالوسيلة بعد ما اليومية اتحدّثت
    const cafe = Number(out.cafeteria) || 0;
    const left = Math.max(0, Math.round((due - covered) * 100) / 100);
    showToast(`تم تسجيل ${paidText} (${method}${detailsText ? " " + detailsText : ""})${cafe > 0 ? ` - منها ${fmt(cafe)} ${booking.currency} كافيتيريا` : ""} - ${left > 0 ? `المتبقي ${fmt(left)} ${booking.currency}` : "الحجز مدفوع بالكامل"}`);
  }
  // دخول مبكر: رسم بيتضاف على الحجز (بيزوّد الإجمالي)، وممكن يتحصّل في نفس اللحظة فيدخل اليومية والتقرير والتوتال.
  async function applyEarlyCheckin(booking) { return guarded("early:" + booking.id, () => applyEarlyCheckinInner(booking)); }
  async function applyEarlyCheckinInner(booking) {
    if (offShift) { showToast(shiftClosed ? "شيفتك مقفول - لازم يُفتح تاني الأول" : "مش شيفتك دلوقتي"); return; }
    const fee = Math.max(0, Math.round((Number(ecFee) || 0) * 100) / 100);
    if (!(fee > 0)) { showToast("اكتب رسم الدخول المبكر (أكبر من صفر)"); return; }
    const collectNow = !!perms.markPaymentReceived && ecCollect;
    if (collectNow) { const detailsErr = validatePaymentDetailsFor(epay.method, epay.details); if (detailsErr) { showToast(detailsErr); return; } }
    const next = { ...booking, earlyCheckin: { applied: true, fee, note: sanitizeText(ecNote, 300) } };
    const res = await onUpdateBooking(booking.id, next);
    if (res?.error) { showToast(res.error); return; }
    onLog(`دخول مبكر ${fee} ${booking.currency} - ${roomLabel(rooms, booking.room)} - ${booking.guestName}${collectNow ? ` (اتحصّل - ${epay.method})` : " (لسه ماتحصّلش)"}`);
    let warn = "";
    if (collectNow) {
      // الرسم اتسجّل على الحجز (زوّد المتبقي) فدلوقتي بنحصّله بعملية ذرية: الحجز + اليومية
      const pr = await recordBookingPayment({ bookingId: booking.id, amount: fee, method: epay.method, details: epay.details, note: "رسم دخول مبكر", expectedUpdatedAt: res?.data?.updatedAt });
      if (pr?.error) warn = " — لكن التحصيل ماتسجّلش: " + pr.error + " (الرسم لسه متبقي على النزيل - سجّله من خانة تسجيل دفعة)";
      else { if (onRefresh) await onRefresh(); getBookingPayments(booking).then((r) => { if (r) setPayBreakdown(r); }); }
    }
    setEcFee(""); setEcNote("");
    showToast(`تم تسجيل الدخول المبكر (${fmt(fee)} ${booking.currency})${collectNow && !warn ? " واتحصّل" : " - لسه متبقي على النزيل، سجّله من خانة (تسجيل دفعة)"}` + warn);
  }
  // غادر مبكرًا: بيقصّر الإقامة لحد النهارده (الحد الأدنى ليلة). مفيش رد فلوس: لو كان دافع زيادة، الفلوس بتفضل في الفندق.
  async function earlyLeave(booking) { return guarded("leave:" + booking.id, () => earlyLeaveInner(booking)); }
  async function earlyLeaveInner(booking) {
    if (offShift) { showToast(shiftClosed ? "شيفتك مقفول - لازم يُفتح تاني الأول" : "مش شيفتك دلوقتي"); return; }
    const patch = earlyLeavePatch(booking, date, "plain");
    const res = await onUpdateBooking(booking.id, { ...booking, ...patch });
    if (res?.error) { showToast(res.error); return; }
    const saved = res?.data || { ...booking, ...patch };
    const stayed = Math.max(1, nightsBetween(booking.checkin, date));
    const plannedNights = nightsBetween(booking.checkin, booking.checkout);
    onLog(`غادر مبكرًا - ${roomLabel(rooms, booking.room)} - ${booking.guestName} - قعد ${stayed} من ${plannedNights} ليلة`);
    const extra = Math.max(0, (Number(saved.amountPaid) || 0) - bookingGrandTotal(saved));
    const left = bookingAmountDue(saved);
    let msg = `النزيل غادر مبكرًا: اتحاسب على ${stayed} ليلة من ${plannedNights} (الحد الأدنى ليلة) - الإجمالي بقى ${fmt(bookingGrandTotal(saved))} ${booking.currency}`;
    if (extra > 0) msg += ` — الـ ${fmt(extra)} ${booking.currency} الزيادة المدفوعة فضلت في الفندق`;
    if (left > 0) msg += ` — لسه متبقي على النزيل ${fmt(left)} ${booking.currency}`;
    showToast(msg);
  }
  // معاينة قبل التأكيد: هيتحاسب على كام ليلة
  function earlyLeavePreview(booking) {
    const patch = earlyLeavePatch(booking, date, "plain");
    const next = { ...booking, totalRoom: patch.totalRoom };
    const stayed = Math.max(1, nightsBetween(booking.checkin, date));
    const owed = Math.max(0, (Number(booking.amountPaid) || 0) - bookingGrandTotal(next));
    const left = bookingAmountDue(next);
    return `(هيتحاسب ${stayed} ليلة من ${nightsBetween(booking.checkin, booking.checkout)}${owed > 0 ? ` - الزيادة المدفوعة ${fmt(owed)} ${booking.currency} تفضل في الفندق` : left > 0 ? ` - متبقي ${fmt(left)} ${booking.currency}` : ""})`;
  }
  async function saveGuestCodes(booking) { return withBusy(() => saveGuestCodesInner(booking)); }
  async function saveGuestCodesInner(booking) {
    const codes = normalizeGuestCodes(codesDraft.map((c) => sanitizeText(c, 40)), booking.pax);
    const dup = duplicateGuestCode(codes);
    if (dup) { showToast(`الكود ${dup} مكتوب لأكتر من فرد في نفس الحجز - كل فرد ليه كود مختلف`); return; }
    const res = await onUpdateBooking(booking.id, { ...booking, guestCodes: codes });
    if (res?.error) { showToast(res.error); return; }
    onLog(`تعديل أكواد الأفراد - ${roomLabel(rooms, booking.room)} - ${booking.guestName}`);
    showToast("تم حفظ أكواد الأفراد");
  }
  // تمديد الحجز بليلة/ليالي إضافية: بتحرك تاريخ الخروج قدام، وبتزود إجمالي
  // سعر الغرفة بقيمة الليالي الجديدة على نفس سعر الليلة المتفق عليه
  // (من غير ما تلمس أي رسوم إضافية أو مدفوعات سابقة)، فكل حاجة تبعها -
  // الإجمالي الكلي، المتبقي، التقارير - بتتحدث تلقائي لوحدها. وبتتأكد الأول
  // إن الغرفة مش متحجزة لحد تاني في الليالي الإضافية دي قبل ما تأكد - لو فيه
  // تعارض وكان هو حجز أضافه مدير الحجوزات، بنوضح ده صريح في رسالة الرفض.
  async function extendBooking(booking) { return guarded("extend:" + booking.id, () => extendBookingInner(booking)); }
  async function extendBookingInner(booking) {
    if (offShift) { showToast(shiftClosed ? "شيفتك مقفول - لازم يُفتح تاني الأول" : "مش شيفتك دلوقتي"); return; }
    const n = Math.max(1, Number(extendNights) || 1);
    const newCheckout = addDays(booking.checkout, n);
    const conflict = roomsOverlap(bookings, booking.room, booking.checkout, newCheckout, booking.id);
    if (conflict) {
      const clash = findOverlappingBooking(bookings, booking.room, booking.checkout, newCheckout, booking.id);
      if (clash?.createdByRole === "reservations") { showToast("مينفعش تمدد - مدير الحجوزات ضايف حجز على الغرفة دي في التاريخ ده"); return; }
      showToast("الغرفة محجوزة لحد تاني في الليلة/الليالي الجديدة - مينفعش تمدد بالتاريخ ده");
      return;
    }
    const newTotalRoom = repricedTotalRoom(booking, booking.checkin, newCheckout);
    const extended = { ...booking, checkout: newCheckout, totalRoom: newTotalRoom };
    // الليالي الإضافية ليها سعر (سعر الليلة المتفق عليه) ولسه ماتحصّلتش - فالمتبقي
    // بيزيد لوحده والغرفة تبقى حمراء لحد ما يتحصّل الفرق.
    const gtNew = bookingGrandTotal(extended);
    const paidNow = Number(booking.amountPaid) || 0;
    const res = await onUpdateBooking(booking.id, extended);
    if (res?.error) { showToast(res.error); return; }
    onLog(`تمديد حجز ${roomLabel(rooms, booking.room)} - ${booking.guestName} بـ${n} ليلة/ليالي - تشيك أوت جديد ${newCheckout}`);
    const due = booking.paymentDetails?.onlinePaid ? 0 : Math.max(0, gtNew - paidNow);
    showToast(`تم تمديد الحجز لحد ${newCheckout}${due > 0 ? ` - الإجمالي بقى ${fmt(gtNew)} ${booking.currency} والمتبقي ${fmt(due)} (الغرفة حمراء لحد التحصيل)` : ""}`);
    setExtendNights(1);
  }
  // إضافة خدمة: السعر بيتضاف على إجمالي الخدمة دي (مش بيستبدله) - كده ماينفعش خدمة تتسجّل مرتين بالغلط
  // ولا خدمة جاية من الحجز تتمسح. التصحيح (استبدال الإجمالي) زرار لوحده.
  async function addExtra(booking) {
    setAddLock(true);
    try { return await guarded("extra-add:" + booking.id, () => addExtraInner(booking)); }
    finally { setTimeout(() => setAddLock(false), 700); }
  }
  async function addExtraInner(booking) {
    if (offShift) { showToast(shiftClosed ? "شيفتك مقفول - لازم يُفتح تاني الأول" : "مش شيفتك دلوقتي"); return; }
    const amt = Math.round((Number(addAmt) || 0) * 100) / 100;
    if (!(amt > 0)) { showToast("اكتب سعر الخدمة (أكبر من صفر)"); return; }
    const kind = EXTRA_KINDS.find(([k]) => k === addSvc) || EXTRA_KINDS[0];
    const cur = Number(booking.extras?.[kind[0]]) || 0;
    const res = await onUpdateBooking(booking.id, { ...booking, extras: { ...(booking.extras || {}), [kind[0]]: Math.round((cur + amt) * 100) / 100 } });
    if (res?.error) { showToast(res.error); return; }
    setAddAmt("");
    const saved = res?.data;
    if (saved) { setExtrasDraft({ laundry: saved.extras?.laundry || "", cafeteria: saved.extras?.cafeteria || "", tours: saved.extras?.tours || "", pickup: saved.extras?.pickup || "" }); extrasBaseRef.current = normExtras(saved.extras); }
    onLog(`إضافة خدمة ${kind[1]} ${fmt(amt)} ${booking.currency} - ${roomLabel(rooms, booking.room)} - ${booking.guestName}`);
    showToast(`اتضاف ${kind[1]} ${fmt(amt)} ${booking.currency} - إجمالي ${kind[1]} على الحجز بقى ${fmt(cur + amt)} ${booking.currency}`);
  }
  // نقل النزيل: الحجز كله (التواريخ والفلوس والأكواد والرسوم) بيتنقل للغرفة الجديدة - القاعدة بتتأكد إنها فاضية
  async function moveGuest(booking) {
    setMoveLock(true);
    try { return await guarded("move:" + booking.id, () => moveGuestInner(booking)); }
    finally { setTimeout(() => setMoveLock(false), 700); }
  }
  async function moveGuestInner(booking) {
    if (!moveTo) { showToast("اختار الغرفة الجديدة"); return; }
    if (offShift && !perms.editBookings) { showToast(shiftClosed ? "شيفتك مقفول - لازم يُفتح تاني الأول" : "مش شيفتك دلوقتي"); return; }
    const to = Number(moveTo);
    const res = await moveBookingRoom({ bookingId: booking.id, room: to, expectedUpdatedAt: booking.updatedAt });
    if (res?.error) { showToast(res.error); if (onRefresh) onRefresh(); return; }
    onLog(`نقل نزيل - ${booking.guestName}: من ${roomLabel(rooms, booking.room)} إلى ${roomLabel(rooms, to)} (الحجز كله)`);
    setMoveOpen(false); setMoveTo("");
    if (onRefresh) await onRefresh();
    setStFilter("all"); setSelected(to);
    showToast(`اتنقل ${booking.guestName} لـ ${roomLabel(rooms, to)} - و${roomLabel(rooms, booking.room)} فضيت`);
  }
  async function saveExtras(booking) { return guarded("extras:" + booking.id, () => saveExtrasInner(booking)); }
  async function saveExtrasInner(booking) {
    if (offShift) { showToast(shiftClosed ? "شيفتك مقفول - لازم يُفتح تاني الأول" : "مش شيفتك دلوقتي"); return; }
    // منع أي قيمة سالبة من غير داعي تضرب قيد قاعدة البيانات (bookings_extras_nonneg)
    // وتطلّع رسالة خطأ تقنية مش مفهومة للموظف - بنمنعها من هنا الأول.
    // الرسوم اتغيّرت من جهاز تاني وانت بتعدّل: نحدّث المسودة ونطلب مراجعة بدل
    // ما نكتب فوق التعديل الأحدث من غير ما حد يدري.
    if (normExtras(booking.extras) !== extrasBaseRef.current) {
      const e = booking.extras || {};
      setExtrasDraft({ laundry: e.laundry || "", cafeteria: e.cafeteria || "", tours: e.tours || "", pickup: e.pickup || "" });
      extrasBaseRef.current = normExtras(e);
      showToast("الرسوم الإضافية اتعدّلت من مكان تاني - راجع القيم الجديدة واضغط حفظ تاني");
      return;
    }
    const clamped = { laundry: Math.max(0, Number(extrasDraft.laundry) || 0), cafeteria: Math.max(0, Number(extrasDraft.cafeteria) || 0), tours: Math.max(0, Number(extrasDraft.tours) || 0), pickup: Math.max(0, Number(extrasDraft.pickup) || 0) };
    const res = await onUpdateBooking(booking.id, { ...booking, extras: { ...(booking.extras || {}), ...clamped } });   // cafeteriaPaid بيفضل زي ما هو
    if (res?.error) { showToast(res.error); return; }
    setExtrasDraft(clamped); extrasBaseRef.current = normExtras(clamped);
    onLog(`تصحيح مبالغ الخدمات الإضافية - ${roomLabel(rooms, booking.room)} - ${booking.guestName}`);
    setFixMode(false);
    showToast("تم حفظ تصحيح المبالغ");
  }

  const counts = useMemo(() => { const c = { available: 0, occupied_paid: 0, occupied_unpaid: 0, reserved: 0, maintenance: 0, cleaning: 0, early_checkout: 0 }; rooms.forEach((r) => { const s = computeRoomStatus(r.number, bookings, overrides, date); c[s.key] = (c[s.key] || 0) + 1; }); return c; }, [rooms, bookings, overrides, date]);
  const revCurrencies = kpis ? currencyKeysOf(kpis.rev, kpis.exp) : [];
  // بحث بكود النزيل: بيرجّع الغرفة اللي كان ساكن فيها
  const cq = codeQuery.trim().toLowerCase();
  const codeHits = findGuestCodeHits(bookings, cq);

  const LEGEND = [
    ["available", "متاحة"], ["occupied_paid", "مشغولة - متحصّلة"], ["occupied_unpaid", "مشغولة - متبقي فلوس"], ["reserved", "قادمة قريبًا"],
    ["early_checkout", "غادر مبكرًا"], ["maintenance", "صيانة"], ["cleaning", "تحت التنظيف"],
  ];
  const statusOf = (n) => computeRoomStatus(n, bookings, overrides, date);
  const shownRooms = stFilter === "all" ? rooms : rooms.filter((r) => statusOf(r.number).key === stFilter);
  const occPct = rooms.length ? Math.round((((counts.occupied_paid || 0) + (counts.occupied_unpaid || 0)) / rooms.length) * 100) : 0;

  return (
    <div className="cx-page">
      <div className="cx-no-print cx-toolbar" style={{ marginBottom: 14, flexDirection: "column", alignItems: "stretch" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: "1 1 260px", maxWidth: 380 }}>
            <Search size={16} aria-hidden="true" style={{ position: "absolute", insetInlineStart: 11, top: 12, color: "var(--faint)" }} />
            <input className="cx-input" data-testid="board-code-search" style={{ paddingInlineStart: 34 }} placeholder="بحث بكود النزيل (يعرّفك الغرفة)" value={codeQuery} onChange={(e) => setCodeQuery(e.target.value)} />
          </div>
          <div className="cx-legend" role="radiogroup" aria-label="فلترة الغرف حسب الحالة">
            <span role="radio" tabIndex={0} aria-checked={stFilter === "all"} className="cx-pill" style={{ background: "var(--paper2)", color: "var(--ink)" }} onClick={() => setStFilter("all")} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setStFilter("all")}>كل الغرف ({rooms.length})</span>
            {LEGEND.map(([k, label]) => (
              <span key={k} role="radio" tabIndex={0} aria-checked={stFilter === k} className="cx-pill" style={{ background: STATUS_TINTS[k], color: STATUS_TEXT[k] }}
                onClick={() => setStFilter(stFilter === k ? "all" : k)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setStFilter(stFilter === k ? "all" : k)}>{label} {counts[k] || 0}</span>
            ))}
          </div>
        </div>
        {(codeHits.length > 0 || cq.length >= 3) && (
          <div>
            <GuestCodeHits hits={codeHits} rooms={rooms} onOpenRoom={(r) => { setSelected(r); setCodeQuery(""); }} />
            {cq.length >= 3 && !codeHits.length && <div data-testid="board-code-missing" style={{ fontSize: 13, color: "var(--rust)" }}>مفيش نزيل بالكود ده</div>}
          </div>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 16 }}>
        <div className="cx-kpi" style={{ display: "flex", gap: 12, alignItems: "center" }}><span className="cx-ico ic-green" aria-hidden="true"><Wallet size={19} /></span><div style={{ minWidth: 0 }}><div style={{ fontSize: 13, color: "var(--muted)" }}>تحصيل اليوم</div><div style={{ fontWeight: 700, fontSize: 18 }}>{kpis ? (revCurrencies.length ? revCurrencies.map((c) => `${money(kpis.rev, c)} ${c}`).join(" + ") : "0") : "…"}</div></div></div>
        <div className="cx-kpi" style={{ display: "flex", gap: 12, alignItems: "center" }}><span className="cx-ico ic-red" aria-hidden="true"><Receipt size={19} /></span><div style={{ minWidth: 0 }}><div style={{ fontSize: 13, color: "var(--muted)" }}>مصاريف اليوم</div><div style={{ fontWeight: 700, fontSize: 18 }}>{kpis ? (revCurrencies.length ? revCurrencies.map((c) => `${money(kpis.exp, c)} ${c}`).join(" + ") : "0") : "…"}</div></div></div>
        <div className="cx-kpi" style={{ display: "flex", gap: 12, alignItems: "center" }}><span className="cx-ico ic-indigo" aria-hidden="true"><BedDouble size={19} /></span><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, color: "var(--muted)" }}>نسبة الإشغال</div><div style={{ display: "flex", alignItems: "center", gap: 10 }}><span style={{ fontWeight: 700, fontSize: 20 }}>{occPct}%</span><span aria-hidden="true" style={{ flex: 1, height: 6, background: "var(--paper2)", borderRadius: 6, overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: occPct + "%", background: "linear-gradient(90deg,#7A6BC9,#5B4BA6)" }} /></span></div></div></div>
        <div className="cx-kpi" style={{ display: "flex", gap: 12, alignItems: "center" }}><span className={"cx-ico " + (kpis?.flagged ? "ic-red" : "ic-amber")} aria-hidden="true"><AlertTriangle size={19} /></span><div><div style={{ fontSize: 13, color: "var(--muted)" }}>شيفتات تحتاج متابعة</div><div style={{ fontWeight: 700, fontSize: 20, color: kpis?.flagged ? "var(--rust)" : "var(--text)" }}>{kpis ? kpis.flagged : "…"}</div></div></div>
      </div>
      <TodayStrip rooms={rooms} bookings={bookings} overrides={overrides} date={date} onOpen={(n) => { setStFilter("all"); setSelected(n); }} />
      <div className={"cx-board" + (room && status ? " has-panel" : "")}>
      <div className="cx-tiles">
        {shownRooms.length === 0 && <div style={{ gridColumn: "1 / -1", color: "var(--muted)", padding: 30, textAlign: "center" }}>مفيش غرف بالحالة دي دلوقتي</div>}
        {shownRooms.map((r) => { const s = statusOf(r.number); const dueT = s.booking && (s.key === "occupied_unpaid") ? bookingAmountDue(s.booking) : 0; return (
          <div key={r.number} role="button" tabIndex={0} aria-pressed={selected === r.number} onClick={() => setSelected(r.number)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(r.number); } }}
            className={"cx-tile " + (selected === r.number ? "selected" : "")} style={{ "--st": STATUS_COLORS[s.key], background: `linear-gradient(180deg, ${STATUS_TINTS[s.key] || "#fff"} 0%, #fff 78%)` }}>
            <span className="cx-tile-st" style={{ color: STATUS_TEXT[s.key] }}>{TILE_LABEL[s.key]}</span>
            <div style={{ fontWeight: 700, fontSize: r.name ? 16 : 22, lineHeight: 1.25, overflowWrap: "anywhere", color: "var(--ink)" }}><RoomName rooms={rooms} number={r.number} prefix={false} /></div>
            {s.guest && <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.guest}</div>}
            {s.booking && <div data-testid={"tile-price-" + r.number} style={{ fontSize: 12.5, color: "var(--muted)" }}>{fmt(s.booking.priceNight)} {s.booking.currency} / ليلة</div>}
            {dueT > 0 && <div style={{ fontSize: 12.5, color: "var(--rust)", fontWeight: 600, marginTop: "auto" }}>متبقي {fmt(dueT)} {s.booking.currency}</div>}
            {s.booking?.duplicatePlacement && <span className="cx-pill" style={{ background: "#EDE8F5", color: "#6B4FA0", fontSize: 11.5, marginTop: 3, alignSelf: "flex-start" }}>تسكين مكرر</span>}
          </div>
        ); })}
      </div>

      {room && status && (() => {
        const b = status.booking;
        const departedList = bookings.filter((bk) => bk.room === selected && bk.leftEarly && bk.status !== "ملغي" && (bk.checkout === date || bk.checkin === date) && bk.id !== b?.id);
        const occupiedNow = status.key === "occupied_paid" || status.key === "occupied_unpaid";
        const canAct = (perms.editBookings || perms.markPaymentReceived) && !offShift;
        const online = !!b?.paymentDetails?.onlinePaid;
        const due = b ? bookingAmountDue(b) : 0;
        const extrasList = b ? [
          b.extras?.laundry > 0 && ["غسيل", b.extras.laundry],
          b.extras?.cafeteria > 0 && [Number(b.extras.cafeteriaPaid) > 0 ? `كافيتيريا (اتسدّد ${fmt(b.extras.cafeteriaPaid)})` : "كافيتيريا", b.extras.cafeteria],
          b.extras?.tours > 0 && ["جولات", b.extras.tours],
          b.extras?.pickup > 0 && ["بيك أب", b.extras.pickup],
          b.earlyCheckin?.applied && ["دخول مبكر", b.earlyCheckin.fee || 0],
        ].filter(Boolean) : [];
        const codes = b ? guestCodeEntries(b) : [];
        return (
        <aside className="cx-card cx-panel" aria-label={"تفاصيل " + roomLabel(rooms, room.number)} style={{ padding: 16 }}>
          <div className="cx-panel-head">
            <div style={{ fontSize: 20, fontWeight: 700, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><span><RoomName rooms={rooms} number={room.number} /></span> <span className="cx-pill" style={{ background: STATUS_TINTS[status.key], color: STATUS_TEXT[status.key], fontSize: 12.5 }}>{status.label}</span></div>
            <button className="cx-btn cx-btn-outline" aria-label="إغلاق" title="إغلاق (Esc)" style={{ minHeight: 36, padding: "6px 10px" }} onClick={() => setSelected(null)}><X size={16} /></button>
          </div>

          {/* نزيل غادر مبكرًا النهارده: بياناته وحسابه وحالة رد الفلوس بنفس الشكل في كل مكان */}
          {departedList.map((d) => (
            <div key={d.id} data-testid="departed-card" className="cx-card" style={{ marginTop: 10, padding: 10, background: "#FBE9DA", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 14 }}>
                <span className="cx-pill" style={{ background: "#fff", color: "var(--rust)", fontSize: 12.5, marginInlineEnd: 6 }}>غادر مبكرًا</span>
                <b>{d.guestName}</b> - غادر النهارده (<DateRange from={d.checkin} to={d.checkout} />){d.checkin === d.checkout ? " - دخل وخرج في نفس اليوم" : ""}{bookings.some((bk) => bk.room === selected && bk.duplicatePlacement && bk.id !== d.id && bk.checkin <= date && date < bk.checkout) ? " وحل مكانه نزيل جديد" : ""}
              </div>
              <MoneyBox b={d} />
              <RefundBox key={d.id} b={d} />
            </div>
          ))}

          {b && (
            <div className="cx-card" data-testid="booking-card" style={{ marginTop: 10, padding: 12, background: "var(--paper2)", display: "flex", flexDirection: "column", gap: 8 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 15 }}>
                  {b.guestName}
                  {online && <span className="cx-pill" style={{ background: "#EDE8F5", color: "#6B4FA0", marginInlineStart: 6, fontSize: 12.5 }}>مدفوع أونلاين</span>}
                  {b.duplicatePlacement && <span className="cx-pill" style={{ background: "#EDE8F5", color: "#6B4FA0", marginInlineStart: 6, fontSize: 12.5 }}>تسكين مكرر</span>}
                </div>
                <div className="cx-meta" style={{ marginTop: 4 }}>
                  <span><CalendarDays size={14} aria-hidden="true" /><DateRange from={b.checkin} to={b.checkout} /></span>
                  <span><Moon size={14} aria-hidden="true" />{nightsBetween(b.checkin, b.checkout)} ليلة · {fmt(b.priceNight)} {b.currency} / ليلة</span>
                  <span><Users size={14} aria-hidden="true" />{b.pax || 1} فرد</span>
                  {b.code && <span><Hash size={14} aria-hidden="true" /><span dir="ltr" data-testid="card-booking-code" style={{ fontFamily: "monospace" }}>{b.code}</span></span>}
                </div>
              </div>

              <MoneyBox b={b} />
              <PayBreakdown payments={payBreakdown} currency={b.currency} />
              <RefundBox key={b.id} b={b} />

              {offShift && (perms.markPaymentReceived || perms.editBookings) && <div style={{ fontSize: 13, color: "var(--rust)", background: "#F4E7E2", borderRadius: 8, padding: 8, display: "flex", alignItems: "center", gap: 4 }}><AlertTriangle size={12} /> {shiftClosed ? "شيفتك مقفول - لازم المدير العام أو مدير الحجوزات يفتحوه تاني عشان تقدر تعمل أي حاجة هنا." : "مش شيفتك دلوقتي - التحصيل والتعديل مش متاحين غير وقت شيفتك اللي حاجزه."}</div>}

              {/* الأفعال الأساسية: تحصيل / غادر مبكرًا */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {perms.markPaymentReceived && !offShift && b.status !== "ملغي" && due > 0 && (
                  <div data-testid="pay-panel" style={{ width: "100%", background: "#fff", borderRadius: 8, padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{online ? "تسجيل تحصيل الخدمات/الدخول المبكر" : "تسجيل دفعة"} <span style={{ fontWeight: 400, color: "var(--muted)" }}>(سيب المبلغ فاضي = كامل المتبقي {fmt(due)} {b.currency})</span></div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-start" }}>
                      <input className="cx-input" data-testid="pay-amount" type="number" min="0" placeholder={`المبلغ (${pay.currency && pay.currency !== b.currency ? pay.currency : fmt(due)})`} style={{ width: 120 }} value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
                      <PayCurrencyFields bookingCurrency={b.currency} currency={pay.currency} rate={pay.rate || ""} amount={pay.amount} due={due} onChange={(c) => setPay({ ...pay, ...c })} />
                      <select className="cx-select" aria-label="وسيلة الدفع" data-testid="collect-method" style={{ fontSize: 13, width: 150 }} value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value, details: emptyPaymentDetails() })}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
                      <PaymentDetailsInline compact={false} testid="pay" method={pay.method} details={pay.details} onChange={(d) => setPay({ ...pay, details: d })} />
                      <button className="cx-btn cx-btn-gold" data-testid="pay-record" style={{ fontSize: 13 }} disabled={payLock} aria-busy={payLock} onClick={() => recordPayment(b)}><Check size={13} /> تسجيل التحصيل</button>
                    </div>
                  </div>
                )}
                {occupiedNow && perms.editRoomStatus && !offShift && (
                  <span data-testid="early-leave"><TwoStepButton label="غادر مبكرًا (تقصير الإقامة)" confirmLabel={`تأكيد المغادرة المبكرة؟ ${earlyLeavePreview(b)}`} onConfirm={() => earlyLeave(b)} /></span>
                )}
                {perms.editBookings && onEditBooking && <button className="cx-btn cx-btn-outline" style={{ fontSize: 13 }} onClick={() => onEditBooking(b.id)}><Pencil size={13} /> تعديل الحجز</button>}
                {((perms.markPaymentReceived && !offShift) || perms.editBookings) && b.status !== "ملغي" && b.checkout > date && (
                  <button className="cx-btn cx-btn-outline" data-testid="move-open" style={{ fontSize: 13 }} onClick={() => { setMoveTo(""); setMoveOpen((v) => !v); }}><ArrowLeftRight size={13} /> نقل لغرفة تانية</button>
                )}
              </div>
              {moveOpen && b.status !== "ملغي" && (
                <div data-testid="move-panel" style={{ background: "#fff", borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>نقل {b.guestName} لغرفة تانية <span style={{ fontWeight: 400, color: "var(--muted)" }}>- الحجز كله بيتنقل بكل تفاصيله وفلوسه (<DateRange from={b.checkin} to={b.checkout} />)، والغرفة دي بتفضى</span></div>
                  {(() => {
                    const free = rooms.filter((r) => r.number !== b.room && !bookings.some((x) => x.id !== b.id && x.room === r.number && x.status !== "ملغي" && x.checkin < b.checkout && b.checkin < x.checkout && x.checkout > x.checkin));
                    return free.length === 0 ? <div style={{ fontSize: 13, color: "var(--rust)" }}>مفيش غرفة فاضية طول نفس التواريخ</div> : (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                        <select className="cx-select" aria-label="الغرفة الجديدة" data-testid="move-room" style={{ width: 220 }} value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                          <option value="">اختار الغرفة الجديدة ({free.length} فاضية)</option>
                          {free.map((r) => <option key={r.number} value={r.number}>{roomOptionLabel(rooms, r.number)}{(() => { const st = computeRoomStatus(r.number, bookings, overrides, date); return st.key === "maintenance" || st.key === "cleaning" ? " - " + st.label : ""; })()}</option>)}
                        </select>
                        <button className="cx-btn cx-btn-gold" data-testid="move-confirm" disabled={!moveTo || moveLock} onClick={() => moveGuest(b)}><ArrowLeftRight size={13} /> نقل النزيل</button>
                        <button className="cx-btn cx-btn-outline" onClick={() => setMoveOpen(false)}>إلغاء</button>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* باقي التفاصيل مطوية عشان الشاشة تفضل بسيطة */}
              {(extrasList.length > 0 || (canAct && occupiedNow)) && (
                <Sec id="sec-extras" title="خدمات إضافية ودخول مبكر" badge={extrasList.length ? extrasList.length : null}>
                  {extrasList.length > 0 && (
                    <div data-testid="extras-current" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontSize: 12.5, color: "var(--muted)" }}>على الحجز دلوقتي:</span>
                      {extrasList.map(([label, amt]) => <span key={label} className="cx-pill" style={{ background: "var(--paper2)" }}>{label}: {fmt(amt)} {b.currency}</span>)}
                    </div>
                  )}
                  {extrasDraft && (perms.editBookings || perms.markPaymentReceived) && !offShift && b.status !== "ملغي" && (
                    <div>
                      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 6 }}>إضافة خدمة: اختار الخدمة واكتب سعرها - بيتضاف على اللي موجود (مش بيمسحه)</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                        <select className="cx-select" aria-label="نوع الخدمة" data-testid="extra-add-kind" style={{ width: 130 }} value={addSvc} onChange={(e) => setAddSvc(e.target.value)}>
                          {EXTRA_KINDS.filter(([k]) => profile?.role !== "reservations" || k === "tours" || k === "pickup").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                        <input className="cx-input" aria-label="سعر الخدمة" data-testid="extra-add-amount" type="number" min="0" placeholder={`السعر (${b.currency})`} style={{ width: 120 }} value={addAmt} onChange={(e) => setAddAmt(e.target.value)} />
                        <button className="cx-btn cx-btn-gold" data-testid="extra-add" style={{ fontSize: 13 }} disabled={addLock} onClick={() => addExtra(b)}><Plus size={13} /> إضافة الخدمة</button>
                        <button type="button" className="cx-btn cx-btn-outline" data-testid="extras-fix-toggle" style={{ fontSize: 12.5 }} onClick={() => setFixMode((v) => !v)}>{fixMode ? "قفل التصحيح" : "تصحيح المبالغ"}</button>
                      </div>
                      {fixMode && (
                        <div data-testid="extras-fix" style={{ marginTop: 8, padding: 8, borderRadius: 8, background: "var(--gold-soft)" }}>
                          <div style={{ fontSize: 12.5, color: "#7A5A12", marginBottom: 6, fontWeight: 600 }}>تصحيح: الأرقام دي هي الإجمالي لكل خدمة - اللي هتكتبه هيحل مكان القديم (مش هيتضاف عليه)</div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(90px,1fr))", gap: 6 }}>
                            {EXTRA_KINDS.filter(([k]) => profile?.role !== "reservations" || k === "tours" || k === "pickup").map(([k, l]) => (
                              <div key={k}><label style={{ fontSize: 11.5, color: "var(--muted)" }}>{l}</label><input className="cx-input" aria-label={l} type="number" min="0" value={extrasDraft[k]} onChange={(e) => setExtrasDraft({ ...extrasDraft, [k]: e.target.value })} /></div>
                            ))}
                          </div>
                          <button className="cx-btn cx-btn-gold" style={{ marginTop: 8, fontSize: 13 }} onClick={() => saveExtras(b)}><Check size={13} /> حفظ التصحيح</button>
                        </div>
                      )}
                    </div>
                  )}
                  {b.earlyCheckin?.applied && b.earlyCheckin.note && <div style={{ marginTop: 6, fontSize: 13, color: "var(--muted)" }}>ملاحظة الدخول المبكر: {b.earlyCheckin.note}</div>}
                  {occupiedNow && !b.earlyCheckin?.applied && canAct && (
                    <div data-testid="early-checkin-panel" style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--hair)" }}>
                      <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 6 }}>النزيل دخل بدري قبل معاد الحجز؟ سجّل رسم الدخول المبكر - بيزوّد إجمالي الحجز{perms.markPaymentReceived ? "، ولو حصّلته دلوقتي بيتسجّل في اليومية والتقرير" : ""}</div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        <input className="cx-input" data-testid="early-fee" type="number" min="0" placeholder="الرسم" value={ecFee} onChange={(e) => setEcFee(e.target.value)} style={{ width: 90 }} />
                        <AutoText className="cx-input" data-testid="early-note" placeholder="ملاحظة (اختياري)" value={ecNote} onChange={(e) => setEcNote(e.target.value)} style={{ width: 160 }} />
                        {perms.markPaymentReceived && (<>
                          <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 4 }}><input type="checkbox" data-testid="early-collect" checked={ecCollect} onChange={(e) => setEcCollect(e.target.checked)} /> حصّلته دلوقتي</label>
                          {ecCollect && <><select className="cx-select" aria-label="وسيلة دفع رسم الدخول المبكر" data-testid="early-method" style={{ fontSize: 13, width: 130 }} value={epay.method} onChange={(e) => setEpay({ method: e.target.value, details: emptyPaymentDetails() })}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select><PaymentDetailsInline compact={false} testid="early" method={epay.method} details={epay.details} onChange={(d) => setEpay({ ...epay, details: d })} /></>}
                        </>)}
                        <button className="cx-btn cx-btn-gold" data-testid="early-apply" style={{ fontSize: 13 }} onClick={() => applyEarlyCheckin(b)}><Check size={13} /> تسجيل الدخول المبكر</button>
                      </div>
                    </div>
                  )}
                </Sec>
              )}

              {canAct && occupiedNow && (
                <Sec id="sec-extend" title="تمديد الإقامة">
                  <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 6 }}>حدد عدد الليالي الإضافية - تاريخ الخروج والإجمالي والمتبقي بيتحدثوا لوحدهم (لو الغرفة محجوزة لحد تاني في التاريخ الجديد مش هيتسمحلك)</div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <input className="cx-input" aria-label="عدد ليالي التمديد" type="number" min="1" value={extendNights} onChange={(e) => setExtendNights(e.target.value)} style={{ width: 70 }} />
                    <span style={{ fontSize: 13, color: "var(--muted)" }}>ليلة/ليالي إضافية</span>
                    <button className="cx-btn cx-btn-outline" style={{ fontSize: 13 }} onClick={() => extendBooking(b)}>تمديد الحجز</button>
                  </div>
                </Sec>
              )}

              <Sec id="sec-codes" title="أكواد الأفراد" badge={codes.length ? codes.length : null}>
                <GuestCodeChips codes={codes} />
                {canAct && (
                  <div data-testid="guest-codes-editor" style={{ marginTop: 6 }}>
                    <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 6 }}>كود لكل فرد (اكتبه بنفسك - فريد جوه الشهر)</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      {codesDraft.slice(0, 100).map((c, i) => <input key={i} className="cx-input" data-testid={`board-code-input-${i + 1}`} dir="ltr" maxLength={40} placeholder={`كود الفرد ${i + 1}`} value={c} onChange={(e) => setCodesDraft(codesDraft.map((x, j) => (j === i ? e.target.value : x)))} style={{ width: 130 }} />)}
                      <button className="cx-btn cx-btn-outline" data-testid="board-codes-save" style={{ fontSize: 13 }} onClick={() => saveGuestCodes(b)}>حفظ الأكواد</button>
                    </div>
                  </div>
                )}
              </Sec>

              <Sec id="sec-info" title="بيانات الحجز">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 8, fontSize: 13.5 }}>
                  <div><div style={{ color: "var(--muted)", fontSize: 12 }}>مصدر الحجز</div><div style={{ fontWeight: 700 }}>{b.source}</div></div>
                  {!online && <div><div style={{ color: "var(--muted)", fontSize: 12 }}>آخر وسيلة دفع</div><div style={{ fontWeight: 700 }}>{b.paymentMethod}</div></div>}
                  <div><div style={{ color: "var(--muted)", fontSize: 12 }}>سعر الليلة × المدة</div><div style={{ fontWeight: 700 }}>{fmt(b.priceNight)} × {nightsBetween(b.checkin, b.checkout)} = {fmt(b.totalRoom)} {b.currency}</div></div>
                  {online && b.paymentDetails?.ref && <div style={{ gridColumn: "1 / -1" }}><div style={{ color: "var(--muted)", fontSize: 12 }}>ملاحظة حجز المنصة</div><div style={{ fontWeight: 700 }}>{b.paymentDetails.ref}</div></div>}
                  {!online && ONLINE_METHODS.includes(b.paymentMethod) && describePaymentDetails(b.paymentMethod, b.paymentDetails) && (
                    <div style={{ gridColumn: "1 / -1" }}><div style={{ color: "var(--muted)", fontSize: 12 }}>{b.paymentMethod === "فيزا" ? "فيزا - آخر 4 أرقام" : "تفاصيل التحويل"}</div><div dir="ltr" style={{ fontWeight: 700, textAlign: "right" }}>{describePaymentDetails(b.paymentMethod, b.paymentDetails)}</div></div>
                  )}
                  {b.notes && <div style={{ gridColumn: "1 / -1" }}><div style={{ color: "var(--muted)", fontSize: 12 }}>ملاحظات</div><div>{b.notes}</div></div>}
                </div>
              </Sec>
            </div>
          )}

          {/* الحالة اليدوية: صيانة / تنظيف بس، وبس لما مفيش نزيل ساكن (النزيل الساكن مابيتخباش بأي حالة) */}
          {!perms.editRoomStatus ? (<div style={{ marginTop: 12, fontSize: 13, color: "var(--muted)", display: "flex", alignItems: "center", gap: 4 }}><Eye size={13} /> عرض فقط لدورك الحالي</div>) : !occupiedNow && (
            offShift ? (
              <div style={{ marginTop: 12, fontSize: 13, color: "var(--rust)", background: "#F4E7E2", borderRadius: 8, padding: 10, display: "flex", alignItems: "center", gap: 4 }}>
                <AlertTriangle size={13} /> {shiftClosed ? "شيفتك مقفول - لازم المدير العام أو مدير الحجوزات يفتحوه تاني عشان تقدر تعدّل حالة الغرف." : "مش شيفتك دلوقتي - الحالة مش هتتعدل غير وقت شيفتك اللي حاجزه."}
              </div>
            ) : (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 6 }}>حالة الغرفة</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{MANUAL_STATUS_OPTIONS.map((o) => <button key={o.key} className="cx-btn cx-btn-outline" style={{ fontSize: 13 }} onClick={() => saveOverride(o.key)}>{o.label}</button>)}</div>
              </div>
            )
          )}
        </aside>
        );
      })()}
      </div>
    </div>
  );
}
