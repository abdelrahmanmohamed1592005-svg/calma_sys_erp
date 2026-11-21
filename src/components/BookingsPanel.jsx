import React, { useState, useEffect, useRef } from "react";
import { Pencil, Ban, AlertTriangle, Check, Plus, Printer, Lock, Search, CalendarDays, Moon, Users, CreditCard, Globe, BedDouble, ClipboardList, Wallet, SearchX } from "lucide-react";
import { PayCurrencySelect, payCurrencyOptions, DateRange, RoomName, roomShortLabel, EmptyState, AutoText, TwoStepButton, PaymentDetailsInline, Logo, GuestCodeChips, GuestCodeHits, RefundBox, MoneyBox, PayBreakdown, PayLinesInline, emptyPayLine } from "./shared";
import { fmt, COMMON_CURRENCIES, PAYMENT_METHODS, emptyPaymentDetails, cleanPaymentDetailsFor, validatePaymentDetailsFor, bookingAmountDue, bookingGrandTotal, bookingHasDue, bookingDueLines, formatMoneyLines, refundStatusOf, bookingFxRate, fxCurrencies } from "../domain/money";
import { todayStr, addDays, nightsBetween, uid, arabicDateLong, managerCanCorrect } from "../domain/dates";
import { sourceOptionsFor, BOOKING_STATUSES, roomLabel, SHIFTS } from "../domain/constants";
import { findOverlappingBookings, planDuplicateResolution, repricedTotalRoom, earlyLeavePatch, normalizeGuestCodes, duplicateGuestCode, findGuestCodeHits, guestCodeEntries, findGuestCodeConflict, nextGuestNumber } from "../domain/bookingLogic";
import { useShiftGate } from "../hooks/useShiftGate";
import { useHotel } from "../lib/hotelContext";
import { getPaymentsIndex, getBookingLedgerRows, editLedgerPaymentRow, splitLedgerPaymentRow } from "../data/shifts";
import { changeBookingCurrency, setBookingPriorPaid, devDeleteBooking, recordVisaFee, devRestoreBooking, payLinesError, recordAnyPayment } from "../data/payments";
import { purgeBookingFromLedgers } from "../data/shifts";
import { searchBookings, getBookingsOverlapping, bookingsWindowStart } from "../data/bookings";
import { guarded } from "../lib/busy";
import { sanitizeText } from "../domain/security";

/* رأس خطوة في فورم الحجز: رقم (أو ✓ لما تكتمل) + عنوان + وصف */
function StepHead({ n, title, hint, done, optional }) {
  return (
    <div className="cx-step-head">
      <span className={"cx-step-num" + (done ? " done" : "")} aria-hidden="true">{done ? <Check size={15} /> : n}</span>
      <div><div className="cx-step-title">{title}{optional && <span className="cx-step-opt">اختياري</span>}</div>{hint && <div className="cx-hint">{hint}</div>}</div>
    </div>
  );
}

function emptyBooking() {
  return { id: uid(), code: "", room: "", guestName: "", phone: "", pax: 1, guestCodes: [""], checkin: todayStr(), checkout: addDays(todayStr(), 1), priceNight: "", currency: "EGP", fxRates: {}, totalRoom: "", extras: { laundry: "", cafeteria: "", tours: "", pickup: "" }, earlyCheckin: { applied: false, fee: "", note: "" }, paymentMethod: "كاش", paymentDetails: emptyPaymentDetails(), amountPaid: "", source: "مباشر", status: "مؤكد", approvalStatus: "approved", notes: "", imported: false, needsRoomReview: false,
    // دفعة مقدّمة (اختيارية) وقت إضافة الحجز - كل دفعة ليها وسيلتها وتفاصيلها (آخر ٤ أرقام الفيزا / اسم ورقم المحوِّل) وبتتسجّل في اليومية بيهم
    payNow: { amount: "", method: "كاش", details: emptyPaymentDetails(), fee: "" }, payMore: [],
    // مدفوع قبل السيستم (اختياري): اتدفع برّه السيستم - بيتكتب على الحجز ومابيدخلش اليومية ولا الخزينة
    prior: { amount: "", note: "" } };
}

/* تسجيل دفعة (عربون/سداد) على حجز موجود من قايمة الحجوزات - لموظف الشيفت: قبل كده التحصيل كان من لوحة الغرف بس (حجوزات اليوم وبعده بيومين)،
   فعربون على حجز بعيد (أكتر من يومين) ماكانش ليه مكان يتسجّل فيه خالص. الدفعة بتتسجّل بنفس الدالة الذرية (الحجز + اليومية). */
function QuickPay({ booking, onDone, showToast }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("كاش");
  const [details, setDetails] = useState(emptyPaymentDetails());
  const [currency, setCurrency] = useState("");
  const [fee, setFee] = useState("");
  // كل عملة لوحدها (من غير سعر صرف): عملة الحجز + أي عملة عليها خدمات لسه ماتحصّلتش
  const opts = payCurrencyOptions(booking);
  const cur = opts.some((o) => o.currency === currency) ? currency : opts[0].currency;
  const due = opts.find((o) => o.currency === cur)?.due || 0;
  async function submit() {
    return guarded("quickpay:" + booking.id, async () => {
      const amt = Math.round((amount === "" ? due : Number(amount) || 0) * 100) / 100;
      if (!(amt > 0)) { showToast("اكتب مبلغ الدفعة (أكبر من صفر)"); return; }
      const err = validatePaymentDetailsFor(method, details);
      if (err) { showToast(err); return; }
      const req = { bookingId: booking.id, amount: amt, method, details: cleanPaymentDetailsFor(method, details), note: "تحصيل", expectedUpdatedAt: booking.updatedAt };
      const visaFee = method === "فيزا" && cur === booking.currency ? Math.round((Number(fee) || 0) * 100) / 100 : 0;
      if (visaFee < 0) { showToast("رسوم الفيزا لازم تكون صفر أو أكتر"); return; }
      const res = await recordAnyPayment(booking, { ...req, currency: cur });
      if (res.error) { showToast(res.error); if (onDone) await onDone(); return; }
      let feeNote = "";
      if (visaFee > 0) {
        const f = await recordVisaFee({ bookingId: booking.id, amount: visaFee, details: req.details });
        if (f.error) { showToast("⚠ الدفعة اتسجّلت، لكن رسوم الفيزا ماتسجّلتش: " + f.error + " - سجّلها تاني"); if (onDone) await onDone(); return; }
        feeNote = ` + رسوم فيزا ${fmt(visaFee)} ${cur}`;
      }
      if (onDone) await onDone();
      setOpen(false); setAmount(""); setDetails(emptyPaymentDetails()); setMethod("كاش"); setCurrency(""); setFee("");
      showToast(`تم تسجيل ${fmt(amt)} ${cur}${feeNote} (${method}) على ${booking.guestName} - المتبقي بالـ ${cur} ${fmt(Math.max(0, Math.round((due - amt) * 100) / 100))} ${cur}`);
    });
  }
  if (!open) return <button className="cx-btn cx-btn-soft" style={{ fontSize: 13 }} data-testid="quickpay-open" onClick={() => setOpen(true)}><Wallet size={14} aria-hidden="true" />تسجيل دفعة</button>;
  return (
    <div data-testid="quickpay-panel" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", background: "var(--paper2)", borderRadius: 8, padding: 6 }}>
      <span style={{ fontSize: 13 }}>المتبقي <bdi dir="ltr">{formatMoneyLines(bookingDueLines(booking))}</bdi></span>
      <input className="cx-input" data-testid="quickpay-amount" type="number" min="0" placeholder={`المبلغ (${fmt(due)} ${cur})`} style={{ width: 160 }} value={amount} onChange={(e) => setAmount(e.target.value)} />
      <PayCurrencySelect testid="quickpay" booking={booking} value={cur} onChange={(c) => { setCurrency(c); setAmount(""); }} />
      <select className="cx-select" data-testid="quickpay-method" style={{ width: 130 }} value={method} onChange={(e) => { setMethod(e.target.value); setDetails(emptyPaymentDetails()); }}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
      <PaymentDetailsInline method={method} details={details} onChange={setDetails} testid="quickpay" />
      {method === "فيزا" && cur === booking.currency && <input className="cx-input" data-testid="quickpay-visa-fee" type="number" min="0" placeholder={`رسوم فيزا (${cur})`} aria-label="رسوم الفيزا" style={{ width: 130 }} value={fee} onChange={(e) => setFee(e.target.value)} />}
      <button className="cx-btn cx-btn-gold" data-testid="quickpay-submit" onClick={submit}>سجّل</button>
      <button className="cx-btn cx-btn-outline" onClick={() => setOpen(false)}>إلغاء</button>
    </div>
  );
}

/* تعديل المدفوع (مدير الشيفت: يوميات النهارده وامبارح - المطوّر: أي يوم): كل دفعة متسجّلة على الحجز في اليومية
   بتتعدّل في مكانها (المبلغ/الوسيلة/التفاصيل)، فالمدفوع على الحجز والخزينة والعهدة والتقارير بيتحدّثوا مع بعض.
   صفر = الدفعة اتشالت. */
function EditPayments({ booking, scope, me, onDone, showToast, onLog }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [drafts, setDrafts] = useState({});     // key -> سطور الدفعة (مبلغ + وسيلة) - تعديل مباشر
  const keyOf = (e) => `${e.date}|${e.shiftKey}|${e.list}|${e.idx}`;
  const lineOf = (r) => ({ ...emptyPayLine(r.collectionCurrency || booking.currency), amount: String(Number(r.collectionAmt) || ""), method: r.collectionMethod || "كاش", details: r.paymentDetails || emptyPaymentDetails() });
  // الدفعات الممسوحة (مبلغها صفر) مابتظهرش
  const load = async () => {
    setRows(null);
    const r = await getBookingLedgerRows(booking);
    if (!r) { showToast("تعذر تحميل الدفعات (مشكلة اتصال)"); setOpen(false); return; }
    const live = r.filter((e) => (Number(e.row.collectionAmt) || 0) !== 0);
    setRows(live);
    setDrafts(Object.fromEntries(live.map((e) => [keyOf(e), [lineOf(e.row)]])));
  };
  // مين يعدّل إيه: المطوّر أي يوم، مدير الشيفت شيفتات يومه، موظف الشيفت شيفته المفتوح بس
  const canEdit = (e) => scope === "any" || (scope === "today" && managerCanCorrect(e.date, e.shiftKey)) || (scope === "own" && !e.closed && (e.staffUsername === me || (e.helpers || []).includes(me)));
  const save = (e) => guarded("edit-pay:" + keyOf(e), async () => {
    const lines = drafts[keyOf(e)] || [];
    const err = payLinesError(booking, lines, validatePaymentDetailsFor);
    if (err) { showToast(err); return; }
    const total = lines.reduce((t, l) => t + (Number(l.amount) || 0), 0);
    let res;
    if (e.list === "rows" && !e.row.visaFee && total > 0) res = await splitLedgerPaymentRow(e, lines, booking);
    else {
      // صف رسوم فيزا / كافيتيريا، أو الدفعة كلها اتشالت (صفر): تعديل المبلغ والوسيلة في نفس الصف
      const l = lines[0] || lineOf(e.row);
      const amount = Math.round(total * 100) / 100;
      res = await editLedgerPaymentRow(e, { collectionAmt: amount, collectionMethod: l.method, paymentDetails: cleanPaymentDetailsFor(l.method, l.details) }, { guestName: booking.guestName });
    }
    if (res.error) { showToast(res.error); await load(); return; }
    const txt = lines.filter((l) => Number(l.amount) > 0).map((l) => `${fmt(Number(l.amount))} ${l.currency} ${l.method}`).join(" + ") || "صفر (اتشالت)";
    const fee = lines.reduce((t, l) => t + (l.method === "فيزا" && l.currency === booking.currency ? Number(l.fee) || 0 : 0), 0);
    onLog(`تعديل دفعة على حجز ${booking.guestName} (غرفة ${booking.room}) في يومية ${e.date}: ${fmt(e.row.collectionAmt)} ${e.row.collectionCurrency} ${e.row.collectionMethod} ← ${txt}`);
    showToast(`اتعدّلت الدفعة لـ ${txt}${fee > 0 && e.list === "rows" && !e.row.visaFee ? ` واتضافت رسوم فيزا ${fmt(fee)} ${booking.currency} على النزيل` : ""} - المدفوع على الحجز والخزينة اتظبطوا${res.moved ? ` (والعهدة اتنقلت لـ ${res.moved} شيفت بعده)` : ""}`);
    if (onDone) await onDone();
    await load();
  });
  if (!open) return <button className="cx-btn cx-btn-outline" data-testid="edit-payments-open" style={{ fontSize: 12.5 }} onClick={() => { setOpen(true); load(); }}>تعديل المدفوع</button>;
  return (
    <div data-testid="edit-payments" style={{ width: "100%", background: "var(--paper2)", borderRadius: 8, padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>الدفعات المتسجّلة على الحجز <span style={{ fontWeight: 400, color: "var(--muted)" }}>(عدّل المبلغ والوسيلة على طول، ولو اتدفعت بأكتر من وسيلة اضغط "+ جزء تاني" - صفر = تشيل الدفعة)</span></div>
      {!rows && <div style={{ fontSize: 13, color: "var(--muted)" }}>جارِ التحميل...</div>}
      {rows && rows.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)" }}>مفيش دفعات متسجّلة على الحجز ده في اليوميات.</div>}
      {rows && rows.map((e) => {
        const k = keyOf(e);
        const fx = e.row.fxCovered != null && e.row.fxBookingCurrency;
        const allowed = canEdit(e);
        const cur = e.row.collectionCurrency || booking.currency;
        const label = <span style={{ fontSize: 12.5, fontWeight: 700 }}><bdi dir="ltr">{e.date}</bdi> · {SHIFTS.find((x) => x.key === e.shiftKey)?.label}{e.list === "cafeteriaRows" ? " · كافيتيريا" : ""}{e.row.visaFee ? " · رسوم فيزا" : ""}</span>;
        return (
          <div key={k} data-testid="edit-payment-row" style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px dashed var(--hair)", paddingTop: 6 }}>
            {label}
            {allowed ? (<>
              <div style={{ display: "flex", gap: 6, alignItems: "flex-start", flexWrap: "wrap" }}>
                <PayLinesInline lines={drafts[k] || []} onChange={(ls) => setDrafts({ ...drafts, [k]: ls })} bookingCurrency={e.row.visaFee || e.list !== "rows" ? "__none__" : booking.currency} currencies={[...new Set([cur, booking.currency, ...fxCurrencies(booking), ...Object.keys(booking.otherCharges || {})])]} testid={"edit-pay-" + rows.indexOf(e)} />
                <button className="cx-btn cx-btn-gold" data-testid="edit-payment-save" style={{ fontSize: 12.5, height: 34 }} onClick={() => save(e)}>حفظ</button>
              </div>
            </>) : (
              <span style={{ fontSize: 12.5, color: "var(--muted)" }}><bdi dir="ltr">{fmt(e.row.collectionAmt)} {e.row.collectionCurrency}</bdi> · {e.row.collectionMethod} - {fx ? "دفعة قديمة بسعر صرف (بتتصحّح من اليومية)" : scope === "own" ? "في شيفت تاني - تعديلها من مدير الشيفت" : "يوم قديم - تعديله من المطوّر"}</span>
            )}
          </div>
        );
      })}
      <div><button className="cx-btn cx-btn-outline" style={{ fontSize: 12.5 }} onClick={() => setOpen(false)}>قفل</button></div>
    </div>
  );
}

/* المطوّر: يرجّع حجز اتلغى بالغلط، أو نزيل اتسجّل "غادر مبكرًا" بالغلط (بيرجع لتاريخ خروجه وإجماليه الأصليين) */
function DevRestore({ booking, onDone, showToast }) {
  const cancelled = booking.status === "ملغي", early = !!booking.leftEarly, out = !early && booking.status === "تم تسجيل الخروج";
  if (!cancelled && !early && !out) return null;
  const what = cancelled ? "uncancel" : early ? "unearly" : "uncheckout";
  const run = () => guarded("booking-devRestore", async () => {
    const res = await devRestoreBooking(booking.id, what);
    if (res.error) { showToast(res.error); if (onDone) await onDone(); return; }
    showToast(cancelled ? `الحجز رجع تاني (${booking.guestName})` : early ? `المغادرة المبكرة اتلغت - ${booking.guestName} رجع لتاريخ خروجه الأصلي` : `تسجيل الخروج اتلغى - ${booking.guestName} رجع ساكن في الغرفة`);
    if (onDone) await onDone();
  });
  const label = cancelled ? "إرجاع الحجز (اتلغى بالغلط)" : early ? "إلغاء المغادرة المبكرة" : "إلغاء تسجيل الخروج (اتعمل بالغلط)";
  const confirm = cancelled ? "ترجّع الحجز؟" : early ? "ترجّع تاريخ الخروج الأصلي؟" : "ترجّع النزيل ساكن في الغرفة؟";
  return <span data-testid="dev-restore"><TwoStepButton className="cx-btn-outline" label={label} confirmLabel={confirm} onConfirm={run} /></span>;
}

/* المطوّر: مسح نهائي لحجز اتضاف بالغلط - تحصيله بيتشال من كل اليوميات (والعهدة بتتظبط) وبعدين الحجز نفسه بيتمسح كأنه ماكانش */
function DevDeleteBooking({ booking, onDone, showToast }) {
  const run = () => guarded("booking-devDelete", async () => {
    const p = await purgeBookingFromLedgers(booking);
    if (p.error) { showToast(p.error); return; }
    const res = await devDeleteBooking(booking.id);
    if (res.error) { showToast(res.error); if (onDone) await onDone(); return; }
    showToast(`تم مسح حجز ${booking.guestName} نهائيًا${p.touched ? ` - واتشال تحصيله من ${p.touched} يومية` : ""}`);
    if (onDone) await onDone();
  });
  return <TwoStepButton label="مسح نهائي" confirmLabel="مسح الحجز وكل تحصيله نهائيًا؟" onConfirm={run} />;
}

/* أقسام الدفع في "تعديل الحجز" مقفولة وبتتفتح بضغطة (title = null: حجز جديد، القسم ظاهر على طول) */
function PaySec({ id, title, children }) {
  if (!title) return children;
  return (
    <details data-testid={id} data-paysec="1" style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--hair)" }}>
      <summary style={{ cursor: "pointer", fontSize: 13.5, fontWeight: 700, color: "var(--teal)" }}>{title}</summary>
      {children}
    </details>
  );
}

export function BookingsPanel({ jumpQuery, onJumpDone, rooms, bookings: loadedBookings, perms, role, profile, onInsertBooking, onUpdateBooking, onRefresh, onLog, showToast, pendingEditId, onConsumeEditRequest, dataVersion }) {
  const { hotel } = useHotel();
  const [form, setForm] = useState(null);
  const formBaseRef = React.useRef(null);   // نسخة الحجز اللي الفورم اتفتح عليها (لدمج تعديلاتي مع آخر نسخة لو اتغيّر من مكان تاني)
  const [filter, setFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");      // all | active | cancelled
  const sq = filter.trim().toLowerCase();
  // الشاشة محمّلة آخر ٣ شهور + الساكن والجاي بس: البحث (حرفين أو أكتر) أو فترة أقدم بيجيبوا القديم من السيرفر
  const [older, setOlder] = useState([]);
  const winStart = bookingsWindowStart();
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const parts = [];
      if (sq.length >= 2) parts.push(searchBookings(filter.trim(), hotel?.id ?? null));
      if (dateFrom && dateFrom < winStart) parts.push(getBookingsOverlapping(dateFrom, dateTo && dateTo < winStart ? dateTo : winStart));
      const res = parts.length ? await Promise.all(parts) : [];
      if (alive) setOlder(res.flatMap((r) => r || []).filter((b) => hotel?.id == null || (b.hotelId ?? 1) === hotel.id));
    }, 350);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sq, dateFrom, dateTo, hotel?.id, dataVersion]);
  const bookings = React.useMemo(() => {
    if (!older.length) return loadedBookings;
    const have = new Set(loadedBookings.map((b) => b.id));
    return [...loadedBookings, ...older.filter((b) => !have.has(b.id) && (have.add(b.id), true))];
  }, [loadedBookings, older]);
  // بحث جاي من البحث السريع (Ctrl+K)
  useEffect(() => { if (jumpQuery?.query != null) { setFilter(jumpQuery.query); setStatusFilter("all"); setDateFrom(""); setDateTo(""); onJumpDone?.(); } }, [jumpQuery?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const [payIndex, setPayIndex] = useState(null);                // المدفوع بالوسيلة لكل حجز (من اليومية)
  // نفس هوك شيفت موظف الشيفت المستخدم في RoomBoard.jsx بالظبط - عشان لو
  // شيفته مش حاجزه دلوقتي أو شيفته مقفول، ميعرفش يضيف أو يعدّل أي حجز من هنا
  // برده (مش بس من بلوك الغرف)، ومن غير أي تضارب بين الشاشتين.
  const { offShift, shiftClosed, myActiveShiftKey } = useShiftGate(profile, perms, dataVersion);

  useEffect(() => {
    if (pendingEditId) {
      const b = bookings.find((x) => x.id === pendingEditId);
      if (b) { const f = formFromBooking(b); formBaseRef.current = f; setForm(f); }
      onConsumeEditRequest();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- بيشتغل مرة لما يوصل طلب تعديل (pendingEditId) - إضافة bookings كانت هتعيد فتح الفورم مع كل تحديث
  }, [pendingEditId]);


  // الفورم بيفتح فوق القايمة: أول ما يفتح (حجز جديد أو تعديل) الصفحة بتنزل/تطلع عليه لوحدها
  const formRef = useRef(null);
  const formOpenId = form?.id;
  useEffect(() => {
    if (!formOpenId) return;
    requestAnimationFrame(() => { try { formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch { /* متصفح قديم */ } });
  }, [formOpenId]);
  function startNew() { setForm(emptyBooking()); }
  // الخانات الرقمية اللي قيمتها صفر بتتعرض فاضية (مش "0" لازم يتمسح بالإيد قبل الكتابة)
  const blankZeros = (o, keys) => { const out = { ...o }; keys.forEach((k) => { if ((Number(out[k]) || 0) === 0) out[k] = ""; }); return out; };
  function formFromBooking(b) { return { ...b, guestCodes: normalizeGuestCodes(b.guestCodes, b.pax), extras: blankZeros(b.extras || {}, ["laundry", "cafeteria", "tours", "pickup"]), earlyCheckin: blankZeros(b.earlyCheckin || { applied: false, fee: "", note: "" }, ["fee"]), paymentDetails: b.paymentDetails || emptyPaymentDetails(), payNow: { amount: "", method: "كاش", details: emptyPaymentDetails() } }; }
  // فورم التعديل = الحجز + خانة "مدفوع قبل السيستم" بقيمتها الحالية
  const formForEdit = (b) => ({ ...formFromBooking(b), prior: { amount: Number(b.paymentDetails?.priorPaid) ? String(b.paymentDetails.priorPaid) : "", note: b.paymentDetails?.priorPaidNote || "" } });
  function startEdit(b) { const f = formForEdit(b); formBaseRef.current = f; setForm(f); }

  const isExistingBooking = form ? bookings.some((b) => b.id === form.id) : false;
  const originalBooking = form && isExistingBooking ? bookings.find((b) => b.id === form.id) : null;
  const moneyLocked = role === "reservations" && isExistingBooking;
  // مدير الحجوزات يضيف حجز ويحدد سعره عادي (فوق)، لكن "استلمنا الفلوس فعليًا
  // ولا لأ" (المدفوع) مش شغله خالص - ده قرار موظف الشيفت اللي قدام النزيل
  // فعليًا. القفل ده شامل حتى وقت إنشاء حجز جديد، مش بس وقت تعديل حجز قديم.
  // حالة الدفع (مدفوع بالكامل / متبقي) بتتحسب لوحدها من المدفوع والإجمالي -
  // مفيش علامة "متحصّل" بتتعلّم بالإيد ولا بتقفل حاجة.
  // المطوّر كمان مابيحصّلش (مش واخد شيفت) - التحصيل من اليومية/الموظف بس، والتصحيح من شاشة التصحيح
  const collectionLocked = role === "reservations";
  const chargeLocked = moneyLocked;
  // موظف الشيفت بيعدّل بيانات النزيل والسعر والتمديد؛ الغرفة بتتغيّر من "نقل النزيل" وتاريخ الدخول ثابت (القاعدة بتفرض ده)
  const staffEdit = isExistingBooking && !perms.editBookings && !perms.editBookingFull;
  // الدخول المبكر ممكن يتسجّل على حجز موجود لسه ماتسجّلش عليه (حتى لو التسعير مقفول)؛ لو اتسجّل قبل كده بيتقفل زي باقي الرسوم.
  const earlyLocked = chargeLocked && !(isExistingBooking && !originalBooking?.earlyCheckin?.applied);

  // الغرفة بقت بس رقم - مفيش سعر ثابت أو نوع متسجل عليها نرجع نعبّي بيه
  // السعر/العملة تلقائيًا؛ الموظف بيكتب سعر الليلة والعملة بنفسه كل مرة حسب
  // الاتفاق مع النزيل.
  function onRoomChange(roomNum) { setForm((f) => ({ ...f, room: Number(roomNum) })); }

  const nights = form ? nightsBetween(form.checkin, form.checkout) : 0;
  const autoTotalRoom = form ? Math.round((Number(form.priceNight) || 0) * nights * 100) / 100 : 0;   // لأقرب قرش (سعر ليلة بكسور مايطلّعش 0.002 متبقي)
  // لما مدير الحجوزات يعدّل تواريخ حجز موجود (تمديد/تقصير)، إجمالي الغرفة بيتحرك
  // تلقائيًا بنفس سعر الليلة المتفق عليه - من غير ما يحتاج يفتح قفل الأسعار
  // (القفل لسه موجود على السعر نفسه). null = مفيش إعادة حساب (حجز جديد).
  const lockedRepricedTotal = form && chargeLocked && originalBooking ? repricedTotalRoom(originalBooking, form.checkin, form.checkout) : null;
  const roomTotalNow = lockedRepricedTotal != null ? lockedRepricedTotal : (Number(form?.totalRoom || autoTotalRoom) || 0);
  const earlyFee = form && form.earlyCheckin?.applied ? Number(form.earlyCheckin.fee) || 0 : 0;
  const grandTotal = form ? roomTotalNow + (Number(form.extras.laundry) || 0) + (Number(form.extras.cafeteria) || 0) + (Number(form.extras.tours) || 0) + (Number(form.extras.pickup) || 0) + (Number(form.extras.visaFee) || 0) + earlyFee : 0;
  // اللي اتدفع قبل كده (حجز موجود) + الدفعة المقدّمة دلوقتي (حجز جديد بس)
  const paidBefore = isExistingBooking ? Number(originalBooking?.amountPaid) || 0 : 0;
  // سطر بعملة تانية (الجنيه أو عملة سعرها متحدد على الحجز) بيتحسب بمقابله بعملة الحجز
  const extraLineCovered = (l) => { const a = Math.max(0, Number(l.amount) || 0); const c = l.currency || form?.currency; return c && form && c !== form.currency ? a / (bookingFxRate(form, c) || Infinity) : a; };
  const advanceNow = form && !collectionLocked ? extraLineCovered(form.payNow || {}) + (form.payMore || []).reduce((t, l) => t + extraLineCovered(l), 0) : 0;
  // مدفوع قبل السيستم بيتكتب من الفورم (حجز جديد أو تعديل): في التعديل المدفوع الحالي فيه القديم، فبنحسب الفرق بس
  const priorOld = isExistingBooking ? Number(originalBooking?.paymentDetails?.priorPaid) || 0 : 0;
  // مدفوع قبل السيستم: موظف الشيفت بيكتبه مع الحجز الجديد، والتعديل على حجز موجود لمدير الشيفت والمطوّر
  const canPrior = isExistingBooking ? !!perms.editPriorPaid : !!perms.priorPaid;
  const priorNow = form && canPrior && !form.paymentDetails?.onlinePaid ? Math.max(0, Number(form.prior?.amount) || 0) - priorOld : 0;
  const balanceRaw = form ? Math.round((grandTotal - paidBefore - advanceNow - priorNow) * 100) / 100 : 0;
  const balanceDue = balanceRaw > 0.004 ? balanceRaw : 0;
  // كل الحجوزات الفعلية المتعارضة مع الغرفة/التواريخ دي، والخطة اللي هتتنفذ
  // لو تأكّد "تسكين مكرر" - بتتحسب لحظيًا عشان الموظف يشوف قبل ما يحفظ إيه اللي
  // هيحصل بالظبط للحجز القديم (أو ليه مرفوض وليه).
  const step1Done = !!(form && form.room && form.guestName?.trim());
  const step2Done = !!(form && nights > 0 && (form.paymentDetails?.onlinePaid || Number(form.priceNight) > 0 || Number(form.totalRoom) > 0 || lockedRepricedTotal != null));
  const clashesNow = form && form.room ? findOverlappingBookings(bookings, Number(form.room), form.checkin, form.checkout, form.id) : [];
  const conflict = clashesNow.length > 0;
  const duplicatePlan = conflict ? planDuplicateResolution(clashesNow, form.checkin, todayStr()) : null;
  const clashLabel = (c) => `${c.guestName || "—"} (${c.checkin} → ${c.checkout})`;
  const duplicateBlockedText = (plan) => {
    const c = clashLabel(plan.clash);
    if (plan.reason === "future") return `الحجز ${c} لسه ماجاش معاده (بعد النهارده) - ده حجز مزدوج حقيقي مش خروج مبكر، مينفعش يتسكّن مكرر. لازم مدير الحجوزات يلغيه الأول من شاشة الحجوزات.`;
    if (plan.reason === "new_in_future") return `الحجز ${c} نزيله لسه في الغرفة، والحجز الجديد بيبدأ بعد النهارده - ده مش خروج مبكر. لو النزيل هيخرج بدري فعلاً، مدير الحجوزات يعدّل تاريخ خروجه الأول.`;
    return `تاريخ دخول الحجز الجديد قبل دخول الحجز القديم ${c} على نفس الغرفة - صحّح التواريخ.`;
  };

  // بيرجّع الحجوزات القديمة لحالتها الأصلية لو حفظ الحجز الجديد فشل بعد ما
  // اتنفّذ تسكينها (تقصير/إلغاء) - عشان الغرفة ماتفضلش من غير نزيل في النظام.
  async function rollbackResolved(done) {
    let allOk = true;
    for (const d of [...done].reverse()) {
      const r = await onUpdateBooking(d.updated.id, { ...d.updated, checkout: d.original.checkout, totalRoom: d.original.totalRoom, status: d.original.status, leftEarly: d.original.leftEarly, notes: d.original.notes });
      if (r?.error) allOk = false;
    }
    return allOk;
  }

  // دمج ثلاثي: آخر نسخة من الحجز + الخانات اللي انت غيّرتها بنفسك (مقارنة بالنسخة اللي فتحت عليها)
  function mergeWithFresh(f) {
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const fresh = formForEdit(originalBooking), base = formBaseRef.current || {}, merged = { ...fresh };
    Object.keys(f).forEach((k) => {
      if (k === "updatedAt" || k === "amountPaid" || same(f[k], base[k])) return;
      if (["extras", "earlyCheckin", "paymentDetails", "prior"].includes(k) && f[k] && base[k] && typeof f[k] === "object") {
        merged[k] = { ...fresh[k] };
        Object.keys(f[k]).forEach((kk) => { if (!same(f[k][kk], base[k][kk])) merged[k][kk] = f[k][kk]; });
      } else merged[k] = f[k];
    });
    formBaseRef.current = fresh;
    return merged;
  }
  // تعديل المدفوع من جوه الفورم: الحجز بيتحدّث، فالفورم بياخد آخر نسخة لوحده (من غير ما يضيّع تعديلاتك ولا يطلب حفظ تاني)
  const payEditedRef = useRef(false);
  useEffect(() => {
    if (payEditedRef.current && form && originalBooking?.updatedAt && form.updatedAt !== originalBooking.updatedAt) { payEditedRef.current = false; setForm(mergeWithFresh(form)); }
  }, [originalBooking?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  async function saveBooking() { return guarded("save-booking", saveBookingInner); }
  async function saveBookingInner() {
    if (perms.roomStatusRestricted && offShift) { showToast(shiftClosed ? "شيفتك مقفول - لازم المدير العام أو مدير الحجوزات يفتحوه تاني عشان تقدر تضيف أو تعدّل حجز" : "مش شيفتك دلوقتي - الحجوزات بتتضاف/تتعدل وقت شيفتك اللي حاجزه بس"); return; }
    if (!form.room || !form.guestName.trim()) { showToast("لازم تحدد الغرفة واسم النزيل"); return; }
    // الحجز اتعدّل من مكان تاني (غالبًا تحصيل من موظف الشيفت) وإحنا فاتحين
    // الفورم: نحدّث نسخته المرجعية ونطلب مراجعة، بدل ما كل حفظة بعد كده تفشل
    // بـ"تعارض" والفورم يفضل متعلّق على نسخة قديمة.
    if (isExistingBooking && originalBooking && form.updatedAt && originalBooking.updatedAt && form.updatedAt !== originalBooking.updatedAt) {
      // دمج ثلاثي: الحجز اتحدّث من مكان تاني (تمديد/تحصيل/رسوم)، فنحمّل آخر نسخة كاملة ونفضّل بس على الخانات اللي انت غيّرتها
      // بنفسك (مقارنة بالنسخة اللي فتحت عليها) - الحفظة الجاية ما بترجّعش تغيير حد تاني ولا بتضيّع تعديلك.
      setForm(mergeWithFresh(form));
      showToast("الحجز ده اتحدّث من مكان تاني وانت بتعدّل فيه - حمّلنا آخر نسخة وحافظنا على تعديلاتك، راجع القيم واضغط حفظ تاني");
      return;
    }
    // تاريخ الخروج لازم يكون بعد تاريخ الدخول - من غير الفحص ده هنوصل لقيد
    // قاعدة البيانات (bookings_dates_valid) وتظهر رسالة تقنية مش مفهومة.
    const zeroNightOk = isExistingBooking && !!originalBooking?.leftEarly && form.checkout === form.checkin;
    if (!form.checkin || !form.checkout || form.checkout < form.checkin || (form.checkout === form.checkin && !zeroNightOk)) { showToast("تاريخ الخروج لازم يكون بعد تاريخ الدخول"); return; }
    // الغرفة عليها نزيل: لو ده خروج مبكر شرعي (النزيل القديم دخل فعلاً) الحفظ بيسجّل خروجه المبكر ويسكّن الجديد
    // تلقائيًا (الموظف شايف اللي هيحصل قبل الضغط). لو حجز مستقبلي/تواريخ غلط => مرفوض بسبب واضح ومفيش حاجة بتتغيّر.
    if (conflict && duplicatePlan && !duplicatePlan.ok) {
      showToast(duplicateBlockedText(duplicatePlan));
      return;
    }
    // منع أي قيمة سالبة في الرسوم الإضافية/رسم الدخول المبكر من غير داعي
    // تضرب قيد قاعدة البيانات وتطلّع رسالة خطأ تقنية مش مفهومة.
    const clampedExtras = { laundry: Math.max(0, Number(form.extras.laundry) || 0), cafeteria: Math.max(0, Number(form.extras.cafeteria) || 0), tours: Math.max(0, Number(form.extras.tours) || 0), pickup: Math.max(0, Number(form.extras.pickup) || 0), ...(form.extras.cafeteriaPaid != null ? { cafeteriaPaid: form.extras.cafeteriaPaid } : {}) };
    const clampedEarlyCheckin = { ...form.earlyCheckin, fee: Math.max(0, Number(form.earlyCheckin?.fee) || 0) };
    // أرقام غلط (سالبة/كسور/نص) بتتصلّح هنا قبل الحفظ بدل ما توصل لقيود قاعدة
    // البيانات وتطلّع رسالة تقنية، ونصوص الحقول الحرة بتتنظّف وتتحدد بطول أقصى.
    const pd = form.paymentDetails || {};
    const priceNightNum = Math.max(0, Number(form.priceNight) || 0);
    const totalRoomNum = form.totalRoom !== "" ? Math.round(Number(form.totalRoom) * 100) / 100 : autoTotalRoom;
    if (!Number.isFinite(totalRoomNum) || totalRoomNum < 0) { showToast("إجمالي الغرفة لازم يكون رقم صحيح مش سالب"); return; }
    // الدفعة المقدّمة (حجز جديد بس، وموظف الشيفت بس): ليها وسيلتها وتفاصيلها
    // المخصوصة (فيزا = آخر ٤ أرقام، تحويل = اسم + رقم) وبتتسجّل في اليومية بيهم.
    const online = !!pd.onlinePaid;
    const payNow = form.payNow || { amount: "", method: "كاش", details: emptyPaymentDetails() };
    const advance = !collectionLocked && !online ? Number(payNow.amount) || 0 : 0;   // حجز جديد أو تعديل: تحصيل دلوقتي
    if (!Number.isFinite(advance) || advance < 0) { showToast("المدفوع لازم يكون رقم صحيح مش سالب"); return; }
    if (advance > 0 && !myActiveShiftKey && !perms.devTools) { showToast("مفيش شيفتك شغال دلوقتي - ماينفعش تسجّل دفعة مقدّمة. احفظ الحجز من غير دفعة وسجّلها بعد ما تفتح شيفتك"); return; }
    if (advance > 0) {
      const detailsErr = validatePaymentDetailsFor(payNow.method, payNow.details);
      if (detailsErr) { showToast(detailsErr); return; }
    }
    // دفعات إضافية (وسيلة أو عملة تانية): كل سطر بوسيلته وتفاصيله، والعملة التانية بسعر صرف بيتكتب مع الدفعة
    const moreLines = !collectionLocked && !online ? (form.payMore || []).filter((l) => Number(l.amount) > 0) : [];
    for (const l of moreLines) {
      if (!myActiveShiftKey && !perms.devTools) { showToast("مفيش شيفتك شغال دلوقتي - ماينفعش تسجّل دفعة مقدّمة"); return; }
      const e2 = validatePaymentDetailsFor(l.method, l.details);
      if (e2) { showToast(e2); return; }
    }
    const payMethod = advance > 0 && !isExistingBooking ? payNow.method : (originalBooking?.paymentMethod || "كاش");
    // وسيلة وتفاصيل التحصيل دلوقتي (في التعديل مابتغيّرش وسيلة الحجز نفسه)
    const advMethod = payNow.method || "كاش";
    const advDetails = cleanPaymentDetailsFor(advMethod, payNow.details);
    // أونلاين: المنصة دفعت سعر الغرفة اللي اتحجز (onlineRoomAmount). لو الحجز كان أونلاين واتمدّد في الفندق بعد كده
    // (نفس الدخول وخروج أبعد) المبلغ اللي اتدفع أونلاين بيفضل زي ما هو والليالي الزيادة بتتحصّل في الفندق.
    const origPd = originalBooking?.paymentDetails || {};
    const keepCover = origPd.onlinePaid && origPd.onlineRoomAmount != null && originalBooking.checkin === form.checkin && form.checkout >= originalBooking.checkout
      && Number(originalBooking.priceNight) === priceNightNum && (form.checkout > originalBooking.checkout || Number(originalBooking.totalRoom) === totalRoomNum);
    const cleanPaymentDetails = online
      ? { ...emptyPaymentDetails(), onlinePaid: true, ref: sanitizeText(pd.ref, 200), onlineRoomAmount: keepCover ? Number(origPd.onlineRoomAmount) : totalRoomNum }
      : advance > 0 && !isExistingBooking ? cleanPaymentDetailsFor(payNow.method, payNow.details) : (originalBooking?.paymentDetails || emptyPaymentDetails());
    let cleaned = {
      ...form, room: Number(form.room), guestName: sanitizeText(form.guestName, 120), phone: sanitizeText(form.phone, 40), code: sanitizeText(form.code, 60), notes: sanitizeText(form.notes, 1000),
      pax: Math.max(1, Math.floor(Number(form.pax) || 1)), priceNight: priceNightNum, totalRoom: totalRoomNum, amountPaid: isExistingBooking ? Number(originalBooking?.amountPaid) || 0 : 0,
      extras: clampedExtras, earlyCheckin: { ...clampedEarlyCheckin, note: sanitizeText(clampedEarlyCheckin.note, 300) }, paymentMethod: payMethod, paymentDetails: cleanPaymentDetails, needsRoomReview: false, approvalStatus: "approved",
    };
    delete cleaned.payNow; delete cleaned.payMore; delete cleaned.prior; delete cleaned.__fxCur;
    const prior = canPrior && !online ? Math.round((Number(form.prior?.amount) || 0) * 100) / 100 : 0;
    const priorNote = sanitizeText(form.prior?.note, 200);
    const priorChanged = isExistingBooking ? canPrior && !online && (prior !== priorOld || priorNote !== (originalBooking?.paymentDetails?.priorPaidNote || "")) : prior > 0;
    if (!Number.isFinite(prior) || prior < 0) { showToast("المدفوع قبل السيستم لازم يكون رقم صحيح مش سالب"); return; }
    const visaFee = advance > 0 && payNow.method === "فيزا" && (!payNow.currency || payNow.currency === form.currency) ? Math.round((Number(payNow.fee) || 0) * 100) / 100 : 0;
    if (!Number.isFinite(visaFee) || visaFee < 0) { showToast("رسوم الفيزا لازم تكون صفر أو أكتر"); return; }
    if (!cleaned.guestName) { showToast("لازم تحدد الغرفة واسم النزيل"); return; }
    cleaned.guestCodes = normalizeGuestCodes(Array.from({ length: cleaned.pax }, (_, i) => sanitizeText(form.guestCodes?.[i] ?? "", 40)), cleaned.pax);
    const monthClash = findGuestCodeConflict(bookings, cleaned.guestCodes, cleaned.checkin, cleaned.id);
    if (monthClash) { showToast(`الكود ${monthClash.code} مستخدم الشهر ده بالفعل (غرفة ${monthClash.room} - ${monthClash.guestName}) - اختار كود تاني`); return; }
    const dupCode = duplicateGuestCode(cleaned.guestCodes);
    if (dupCode) { showToast(`الكود ${dupCode} مكتوب لأكتر من فرد في نفس الحجز - كل فرد ليه كود مختلف`); return; }
    // مدير الحجوزات بيعدّل حجز قديم: قيمة الحجز (سعر/رسوم/وسيلة دفع) تفضل زي ما هي
    // حتى لو الواجهة اتلعب فيها (القفل الحقيقي في قاعدة البيانات - قسم ١٤/١٥).
    // الاستثناء الوحيد إجمالي الغرفة: بيتحرك مع عدد الليالي بنفس سعر الليلة.
    if (chargeLocked && originalBooking) {
      cleaned = { ...cleaned, priceNight: originalBooking.priceNight, currency: originalBooking.currency, totalRoom: lockedRepricedTotal, extras: originalBooking.extras, earlyCheckin: originalBooking.earlyCheckin?.applied ? originalBooking.earlyCheckin : cleaned.earlyCheckin, paymentMethod: originalBooking.paymentMethod, paymentDetails: originalBooking.paymentDetails };
    }
    // الجيست يدفع أكتر من اللي عليه عادي (قرار المالك)
    // "تسكين مكرر" (الخطة اتأكدت فوق إنها سليمة): لكل حجز قديم متعارض -
    // - بدأ قبل الجديد: نقصّر تاريخ خروجه لتاريخ دخول الجديد ونعلّمه "غادر مبكرًا"
    //   (مش "ملغي"؛ بيتحاسب على الليالي اللي قعدها، وأي زيادة مدفوعة بتفضل في الفندق).
    // - نزل نفس يوم الجديد وخرج: بيتسجّل "غادر مبكرًا" برضه (خروجه = دخوله)
    //   وبيتحاسب ليلة واحدة (الحد الأدنى).
    // لو حفظ الحجز الجديد فشل بعد كده، كل اللي اتغيّر بيترجع تاني تلقائيًا.
    const resolved = [];
    const refundRequests = [];
        if (conflict && duplicatePlan?.ok) {
      for (const act of duplicatePlan.actions) {
        const c = act.clash;
        const patch = earlyLeavePatch(c, act.checkout);
        const r = await onUpdateBooking(c.id, { ...c, ...patch });
        if (r?.error) {
          const undone = await rollbackResolved(resolved);
          showToast(`تعذر تسكين الحجز القديم ${clashLabel(c)}: ${r.error}${resolved.length ? (undone ? " - اتراجع عن اللي اتغيّر قبله" : " - ⚠ في حجز اتغيّر قبله ومتراجعش، راجع الحجوزات") : ""}`);
          return;
        }
        resolved.push({ original: c, updated: r.data || { ...c, ...patch } });
        const savedOld = r.data || { ...c, ...patch };
        if ((Number(savedOld.amountPaid) || 0) > bookingGrandTotal(savedOld)) refundRequests.push(savedOld);
        onLog(`تسكين مكرر - ${roomLabel(rooms, c.room)} - ${c.guestName}: غادر مبكرًا ${act.action === "trim" ? `(خروج ${act.checkout})` : "(نفس يوم الدخول)"}`);
      }
      cleaned = { ...cleaned, duplicatePlacement: true };
    }
    // تغيير عملة حجز موجود من الفورم: الحجز بيتحفظ بعملته القديمة الأول، وبعدين العملة بتتغيّر بدالتها (الحجز + صفوف اليومية بتاعته)
    const curTo = isExistingBooking && originalBooking && cleaned.currency !== originalBooking.currency ? cleaned.currency : null;
    if (curTo) cleaned = { ...cleaned, currency: originalBooking.currency };
    // حجز ليه تحصيل في شيفت اتقفل: تغيير عملته من مدير الشيفت أو المطوّر بس (القاعدة بترفض برضه) - بنوقف قبل الحفظ
    if (curTo && !["any", "today"].includes(perms.correctLedger)) {
      const led = await getBookingLedgerRows(originalBooking);
      const inClosed = (led || []).some((e) => e.closed && (Number(e.row.collectionAmt) || 0) !== 0 && (e.row.collectionCurrency || "EGP") === originalBooking.currency);
      if (!led || inClosed) {
        if (resolved.length) await rollbackResolved(resolved);
        showToast(!led ? "تعذر قراءة اليوميات (مشكلة اتصال) - جرّب تاني" : "الحجز ليه تحصيل في شيفت اتقفل - تغيير العملة من مدير الشيفت أو المطوّر");
        return;
      }
    }
    const res = isExistingBooking ? await onUpdateBooking(cleaned.id, cleaned) : await onInsertBooking(cleaned);
    if (res?.error) {
      if (resolved.length) {
        const undone = await rollbackResolved(resolved);
        showToast(undone
          ? `تعذر حفظ الحجز الجديد: ${res.error} - الحجز القديم رجع زي ما كان، حاول تاني`
          : `⚠ تعذر حفظ الحجز الجديد: ${res.error} - والحجز القديم اتسجّل "غادر مبكرًا" ومترجعش تلقائيًا: راجع شاشة الحجوزات وضيف الحجز الجديد تاني فورًا`);
        return;
      }
      showToast(res.error); return;
    }
    onLog(`${isExistingBooking ? "تعديل" : "إضافة"} حجز ${roomLabel(rooms, cleaned.room)} — ${cleaned.guestName}${conflict ? " (تسكين مكرر)" : ""}`);
    // لو اتحصّل مبلغ مقدّم وقت إضافة حجز جديد (نزيل مباشر دافع عند موظف
    // الشيفت) سجّله تلقائيًا في يومية شيفته النهارده - عشان رصيد الخزينة/
    // التحصيل حسب طريقة الدفع يعكس الحقيقة من غير ما يحتاج يكتبه تاني يدويًا
    // في اليومية (انظر appendBookingCollection في data/shifts.js). ده صفر
    // دايمًا لو مدير الحجوزات هو اللي عدّل/أضاف (collectionLocked بيصفّر
    // amountPaid له فوق في الحالتين).
    const savedId = res.data?.id || cleaned.id;
    let note = "";
    let payFailed = "";
    let advanceOk = false;
    let curChangeDone = false;
    if (curTo) {
      // القاعدة بتغيّر العملة في كل اليوميات وبتحسب أرقام الشيفتات المقفولة والعهدة اللي بعدها بنفسها
      const cr = await changeBookingCurrency({ bookingId: savedId, currency: curTo, expectedUpdatedAt: res.data?.updatedAt });
      if (cr?.error) { showToast(`⚠ الحجز اتحفظ لكن العملة ماتغيّرتش: ${cr.error}`); if (onRefresh) await onRefresh(); setForm(null); return; }
      curChangeDone = true;
      onLog(`تعديل عملة الحجز - ${roomLabel(rooms, cleaned.room)} - ${cleaned.guestName}: من ${originalBooking.currency} إلى ${curTo}`);
      note += ` — العملة اتغيّرت من ${originalBooking.currency} لـ ${curTo} (الأرقام زي ما هي)`;
      cleaned = { ...cleaned, currency: curTo };
      if (onRefresh) await onRefresh();
    }
    // الدفعة المقدّمة بتتسجّل بعملية ذرية في القاعدة (الحجز + اليومية + كافيتيريا النزيل) بعد حفظ الحجز
    if (advance > 0) {
      const advCur = payNow.currency && payNow.currency !== cleaned.currency ? payNow.currency : cleaned.currency;
      const payRes = await recordAnyPayment({ ...cleaned, ...(res.data || {}), id: savedId }, { amount: advance, currency: advCur, method: advMethod, details: advDetails, note: isExistingBooking ? "تحصيل" : "تحصيل حجز جديد", expectedUpdatedAt: curChangeDone ? null : res.data?.updatedAt });
      if (!payRes.error) advanceOk = true;
      if (payRes.error) { payFailed = `⚠ الحجز اتحفظ لكن الدفعة (${fmt(advance)} ${cleaned.currency} - ${payMethod}) ماتسجّلتش: ${payRes.error} - سجّلها من زرار "تسجيل دفعة" على الحجز في القايمة`.replace(` - ${payMethod})`, ` - ${advMethod})`); }
      else if (onRefresh) await onRefresh();
    }
    for (const l of moreLines) {
      const det = cleanPaymentDetailsFor(l.method, l.details);
      const lc = l.currency && l.currency !== cleaned.currency ? l.currency : cleaned.currency;
      const r2 = await recordAnyPayment({ ...cleaned, ...(res.data || {}), id: savedId }, { amount: Number(l.amount), currency: lc, method: l.method, details: det, note: isExistingBooking ? "تحصيل" : "تحصيل حجز جديد" });
      if (r2.error) { payFailed += `${payFailed ? " | " : "⚠ "}الدفعة (${fmt(Number(l.amount))} ${lc} - ${l.method}) ماتسجّلتش: ${r2.error}`; }
    }
    // رسوم الفيزا اللي اتدفعت مع الدفعة المقدّمة: صف "رسوم فيزا" في اليومية وبتتحسب على النزيل
    if (visaFee > 0 && advanceOk) {
      const f = await recordVisaFee({ bookingId: savedId, amount: visaFee, details: advDetails });
      if (f.error) payFailed += `${payFailed ? " | " : "⚠ "}رسوم الفيزا (${fmt(visaFee)} ${cleaned.currency}) ماتسجّلتش: ${f.error} - سجّلها من "تسجيل دفعة"`;
      else note += ` — رسوم فيزا ${fmt(visaFee)} ${cleaned.currency}`;
    }
    // مدفوع قبل السيستم: على الحجز بس - مابيدخلش اليومية ولا الخزينة
    if (priorChanged) {
      const pr = await setBookingPriorPaid({ bookingId: savedId, amount: prior, note: priorNote });
      if (pr.error) payFailed += `${payFailed ? " | " : "⚠ "}المدفوع قبل السيستم (${fmt(prior)} ${cleaned.currency}) ماتسجّلش: ${pr.error} - افتح "تعديل الحجز" واكتبه تاني`;
      else note += prior > 0 ? ` — ${fmt(prior)} ${cleaned.currency} مدفوع قبل السيستم (مادخلش الخزينة)` : " — اتشال المدفوع قبل السيستم";
    }
    if ((moreLines.length || visaFee > 0 || priorChanged) && onRefresh) await onRefresh();
    refundRequests.forEach((c) => { note += ` — ${c.guestName} غادر مبكرًا: اتحاسب على الليالي اللي قعدها، والـ ${fmt((Number(c.amountPaid) || 0) - bookingGrandTotal(c))} ${c.currency} الزيادة المدفوعة فضلت في الفندق`; });
    const paidAfter = Number(cleaned.amountPaid) || 0;
    if (!cleaned.paymentDetails?.onlinePaid && isExistingBooking && paidAfter > bookingGrandTotal(cleaned) && cleaned.status !== "ملغي") note += ` — المدفوع (${fmt(paidAfter)}) بقى أكبر من الإجمالي الجديد بـ ${fmt(paidAfter - bookingGrandTotal(cleaned))} ${cleaned.currency} - الزيادة بتفضل في الفندق`;
    if (cleaned.status === "ملغي" && originalBooking?.status !== "ملغي" && paidAfter > 0) note += ` — الحجز اتلغى والـ ${fmt(paidAfter)} ${cleaned.currency} المتحصّلة فضلت في الفندق`;
    // حجز اتلغى وعليه فلوس: ماينفعش طلب الرد يختفي من القايمة بسبب فلتر "الشغّالة" أو نص بحث
    if (cleaned.status === "ملغي" && originalBooking?.status !== "ملغي" && paidAfter > 0) { if (statusFilter === "active") setStatusFilter("all"); setFilter(""); }
    setForm(null); showToast(payFailed ? payFailed + note : "تم الحفظ" + note);
  }
  // إلغاء حجز (مش مسح): الحجز بيفضل ظاهر في "الحجوزات الملغية"، ولو عليه فلوس متحصّلة قاعدة البيانات
  // بتفتح طلب رد فلوس لمدير الحجوزات تلقائيًا. مفيش مسح نهائي للحجز من الشاشة عشان أثره المالي ما يختفيش.
  async function cancelBooking(b) {
    const res = await onUpdateBooking(b.id, { ...b, status: "ملغي" });
    if (res?.error) { showToast(res.error); return; }
    if (res?.conflict) { showToast("الحجز اتعدّل من مكان تاني - راجع الحجوزات وجرّب تاني"); return; }
    const saved = res?.data || { ...b, status: "ملغي" };
    onLog(`إلغاء حجز ${roomLabel(rooms, b.room)} — ${b.guestName}`);
    const rs = refundStatusOf(saved);
    if (statusFilter === "active") setStatusFilter("all");        // ماينفعش الحجز اللي لسه اتلغى يختفي من القايمة اللي قدامه
    showToast(`تم إلغاء الحجز - هتلاقيه في "الحجوزات الملغية" (وفي "الكل"). ${rs ? rs.text : ""}`);
  }

  const q = filter.trim().toLowerCase();
  // لو اللي مكتوب في البحث هو كود فرد بالظبط => نعرض الحجز والغرفة اللي كان ساكن فيها
  const codeHits = findGuestCodeHits(bookings, q);
  const counts = { all: bookings.length, active: bookings.filter((b) => b.status !== "ملغي").length, cancelled: bookings.filter((b) => b.status === "ملغي").length };
  const list = bookings.filter((b) => {
    if (statusFilter === "active" && b.status === "ملغي") return false;
    if (statusFilter === "cancelled" && b.status !== "ملغي") return false;
    if (q && !String(b.room).includes(q) && !(b.guestName || "").toLowerCase().includes(q) && !(b.code && b.code.toLowerCase().includes(q)) && !guestCodeEntries(b).some((g) => g.code.toLowerCase().includes(q))) return false;
    if (dateFrom && (b.checkout < dateFrom || (b.checkout === dateFrom && b.checkin !== b.checkout))) return false;
    if (dateTo && b.checkin > dateTo) return false;
    return true;
  }).sort((a, b) => b.checkin.localeCompare(a.checkin));
  // القايمة بتتعرض على دفعات (٥٠ حجز) - مع سنين شغل الحجوزات بالآلاف، وعرضها كلها مرة واحدة كان هيبطّأ الشاشة
  const PAGE = 50;
  const [shownCount, setShownCount] = useState(PAGE);
  useEffect(() => { setShownCount(PAGE); }, [statusFilter, q, dateFrom, dateTo]);
  const visible = list.slice(0, shownCount);
  // تفاصيل الدفع بالوسيلة (من اليوميات) للحجوزات الظاهرة بس - قبل كده كانت بتحمّل يوميات كل الأيام من أول حجز اتعمل مع كل تحديث
  const visibleKey = visible.map((b) => b.id + ":" + b.amountPaid).join(",");
  useEffect(() => {
    let cancelled = false;
    (async () => { const idx = await getPaymentsIndex(visible); if (!cancelled && idx) setPayIndex(idx); })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion, visibleKey]);

  return (
    <div className="cx-page">
      <div className="cx-no-print cx-toolbar" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", flex: "1 1 520px", minWidth: 0 }}>
          <div style={{ position: "relative", flex: "1 1 240px", maxWidth: 340 }}>
            <Search size={16} aria-hidden="true" style={{ position: "absolute", insetInlineStart: 11, top: 12, color: "var(--faint)" }} />
            <input className="cx-input" aria-label="بحث في الحجوزات" style={{ paddingInlineStart: 34 }} placeholder="بحث برقم الغرفة أو الاسم أو الكود" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--muted)", flex: "1 1 300px", minWidth: 0, maxWidth: 380 }}>
            من <input className="cx-input" type="date" title="من تاريخ" aria-label="من تاريخ" style={{ flex: "1 1 0", minWidth: 0 }} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            إلى <input className="cx-input" type="date" title="إلى تاريخ" aria-label="إلى تاريخ" style={{ flex: "1 1 0", minWidth: 0 }} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </span>
          {(dateFrom || dateTo) && <button className="cx-btn cx-btn-outline" onClick={() => { setDateFrom(""); setDateTo(""); }}>مسح الفترة</button>}
          <span data-testid="bookings-window-note" style={{ fontSize: 12, color: "var(--muted)", flexBasis: "100%" }}>القايمة فيها آخر ٣ شهور + الساكن والجاي - الحجوزات الأقدم بتظهر بالبحث أو باختيار فترة قديمة</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="cx-btn cx-btn-outline" onClick={() => window.print()}><Printer size={13} /> طباعة القائمة</button>
          {(perms.editBookings || perms.canCreateBookings) && (perms.roomStatusRestricted ? !offShift : true) && <button className="cx-btn cx-btn-gold" onClick={startNew}><Plus size={14} /> حجز جديد</button>}
        </div>
      </div>

      {perms.roomStatusRestricted && offShift && (
        <div className="cx-no-print" style={{ marginBottom: 12, fontSize: 13, color: "var(--rust)", background: "#F4E7E2", borderRadius: 8, padding: 10, display: "flex", alignItems: "center", gap: 6 }}>
          <AlertTriangle size={13} /> {shiftClosed ? "شيفتك مقفول - لازم المدير العام أو مدير الحجوزات يفتحوه تاني عشان تقدر تضيف أو تعدّل حجز." : "مش شيفتك دلوقتي - الحجوزات بتتضاف/تتعدل وقت شيفتك اللي حاجزه بس."}
        </div>
      )}

      {/* ترويسة الطباعة - بنفس شكل باقي تقارير السيستم بالظبط */}
      <div className="cx-print-only cx-print-header">
        <div className="cx-print-head-row">
          <div className="cx-print-brand">
            <Logo size={30} />
            {hotel.name && <div className="cx-print-hotel-name">{hotel.name}</div>}
          </div>
          <div className="cx-print-meta">
            <div className="cx-print-title">قائمة الحجوزات</div>
            <div>{dateFrom || dateTo ? `${dateFrom || "—"} → ${dateTo || "—"}` : "كل الحجوزات"}{filter ? ` · بحث: ${filter}` : ""}</div>
            <div>تاريخ الإصدار: {arabicDateLong(todayStr())}{profile?.name ? ` · أُعِد بواسطة: ${profile.name}` : ""}</div>
          </div>
        </div>
        <div className="cx-print-rule" />
      </div>

      {form && (
        <div ref={formRef} className="cx-card cx-no-print cx-form" data-calma-editing="booking" style={{ padding: 18, marginBottom: 16, borderColor: "#E3D3A6", boxShadow: "0 0 0 4px var(--gold-soft), var(--sh)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}><span className="cx-ico ic-indigo" aria-hidden="true"><BedDouble size={19} /></span><div><div className="cx-section-title" style={{ fontSize: 18 }}>{isExistingBooking ? `تعديل حجز - ${originalBooking?.guestName || ""}` : "حجز جديد"}</div><div className="cx-hint">اتبع الخطوات بالترتيب - الخطوات الاختيارية ممكن تسيبها فاضية</div></div></div>
            {form.code && <div style={{ fontSize: 13, color: "var(--muted)" }}>كود الحجز: <span dir="ltr" data-testid="booking-code" style={{ fontFamily: "monospace", fontWeight: 700 }}>{form.code}</span></div>}
          </div>
          <div className="cx-form-grid">
          <div className="cx-form-main">
          <section className="cx-step">
          <StepHead n={1} done={step1Done} title="الغرفة والنزيل" hint="اختار الغرفة واكتب اسم النزيل" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>

            <div><label style={{ fontSize: 12.5, color: "var(--muted)" }}>الغرفة {staffEdit && <span style={{ fontSize: 11.5 }}>(تتغيّر من "نقل النزيل")</span>}</label><select className="cx-select" disabled={staffEdit} value={form.room} onChange={(e) => onRoomChange(e.target.value)}><option value="">اختر</option>{rooms.map((r) => <option key={r.number} value={r.number}>{r.name ? roomShortLabel(rooms, r.number) : `غرفة ${r.number}`}</option>)}</select></div>
            <div><label style={{ fontSize: 12.5, color: "var(--muted)" }}>اسم النزيل</label><AutoText className="cx-input" value={form.guestName} onChange={(e) => setForm({ ...form, guestName: e.target.value })} /></div>
            <div><label style={{ fontSize: 12.5, color: "var(--muted)" }}>الهاتف</label><input className="cx-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div><label style={{ fontSize: 12.5, color: "var(--muted)" }}>عدد الأفراد</label><input className="cx-input" type="number" min="1" value={form.pax} onChange={(e) => setForm({ ...form, pax: e.target.value })} /></div>
            <div style={{ gridColumn: "1 / -1" }} data-testid="guest-code-inputs">
              <label style={{ fontSize: 12.5, color: "var(--muted)" }}>كود لكل فرد (اختياري - فريد جوه الشهر)</label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))", gap: 6, marginTop: 2 }}>
                {Array.from({ length: Math.min(100, Math.max(1, Math.floor(Number(form.pax) || 1))) }, (_, i) => (
                  <input key={i} className="cx-input" data-testid={`guest-code-input-${i + 1}`} dir="ltr" maxLength={40} placeholder={`كود الفرد ${i + 1}`} value={form.guestCodes?.[i] ?? ""} onChange={(e) => { const next = normalizeGuestCodes(form.guestCodes, form.pax); next[i] = e.target.value; setForm({ ...form, guestCodes: next }); }} />
                ))}
              </div>
              <div style={{ marginTop: 4, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13, color: "var(--muted)" }}>
                <span data-testid="next-guest-number">الرقم التالي المتاح الشهر ده: {nextGuestNumber(bookings, form.checkin, form.id)} (العداد بيبدأ من 1 كل شهر)</span>
                <button type="button" className="cx-btn cx-btn-outline" data-testid="guest-codes-auto" style={{ fontSize: 12.5, padding: "2px 8px" }} onClick={() => {
                  const cur = normalizeGuestCodes(form.guestCodes, form.pax);
                  let n = nextGuestNumber(bookings, form.checkin, form.id);
                  const used = new Set(cur.filter(Boolean).map((c) => c.toUpperCase()));
                  const filled = cur.map((c) => { if (c) return c; while (used.has(String(n))) n += 1; return String(n++); });
                  setForm({ ...form, guestCodes: filled });
                }}>املا الفاضي تلقائيًا</button>
              </div>
            </div>
          </div>
          </section>
          <section className="cx-step">
          <StepHead n={2} done={step2Done} title="الإقامة والسعر" hint="التواريخ وسعر الليلة - الإجمالي بيتحسب لوحده" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
            <div><label style={{ fontSize: 12.5, color: "var(--muted)" }}>تاريخ الدخول</label><input className="cx-input" type="date" disabled={staffEdit} value={form.checkin} onChange={(e) => { const newCheckin = e.target.value; setForm((f) => ({ ...f, checkin: newCheckin, checkout: f.checkout && f.checkout > newCheckin ? f.checkout : addDays(newCheckin, 1) })); }} /></div>
            <div><label style={{ fontSize: 12.5, color: "var(--muted)" }}>تاريخ الخروج</label><input className="cx-input" type="date" min={form.checkin ? addDays(form.checkin, 1) : undefined} value={form.checkout} onChange={(e) => setForm({ ...form, checkout: e.target.value })} /></div>
            <div><label style={{ fontSize: 12.5, color: "var(--muted)" }}>السعر لليلة {chargeLocked && <Lock size={10} style={{ verticalAlign: -1 }} />}</label><div style={{ display: "flex", gap: 4 }}><input className="cx-input" type="number" disabled={chargeLocked} value={form.priceNight} onChange={(e) => setForm({ ...form, priceNight: e.target.value, ...(form.totalRoom !== "" && Math.abs((Number(form.totalRoom) || 0) - (Number(form.priceNight) || 0) * nights) < 0.005 ? { totalRoom: "" } : {}) })} /><select className="cx-select" disabled={chargeLocked} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} style={{ width: 90 }}>{COMMON_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
              {isExistingBooking && originalBooking && form.currency !== originalBooking.currency && (
                <div data-testid="currency-change-warning" style={{ marginTop: 4, fontSize: 12.5, fontWeight: 700, color: "var(--rust)", background: "#F4E7E2", borderRadius: 6, padding: "4px 6px" }}>⚠ العملة اتغيّرت من {originalBooking.currency} لـ {form.currency} - اكتب سعر الليلة بالـ {form.currency} (الرقم مابيتحوّلش لوحده){!["any", "today"].includes(perms.correctLedger) && " - ولو الحجز ليه تحصيل في شيفت اتقفل التغيير من مدير الشيفت أو المطوّر"}</div>
              )}</div>
            <div><label style={{ fontSize: 12.5, color: "var(--muted)" }}>إجمالي الغرفة ({nights} ليلة) {chargeLocked && <Lock size={10} style={{ verticalAlign: -1 }} />}</label><input className="cx-input" type="number" disabled={chargeLocked} placeholder={String(autoTotalRoom)} value={lockedRepricedTotal != null ? lockedRepricedTotal : form.totalRoom} onChange={(e) => setForm({ ...form, totalRoom: e.target.value })} /></div>
            {(() => {
              // سعر العملة بالمصري للحجز ده (مرة واحدة): الجيست يدفع بالجنيه أو بالعملة دي والسيستم بيحوّل بالسعر ده
              const fxCur = Object.keys(form.fxRates || {})[0] || form.__fxCur || (form.currency !== "EGP" ? form.currency : "USD");
              const fxVal = (form.fxRates || {})[fxCur] ?? "";
              return (
                <div data-testid="fx-rate"><label style={{ fontSize: 12.5, color: "var(--muted)" }}>سعر العملة بالمصري (لو هيدفع بعملة تانية)</label>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <select className="cx-select" aria-label="العملة" data-testid="fx-currency" style={{ width: 90 }} value={fxCur} onChange={(e) => setForm({ ...form, fxRates: fxVal === "" ? {} : { [e.target.value]: fxVal } , __fxCur: e.target.value })}>{COMMON_CURRENCIES.filter((c) => c !== "EGP").map((c) => <option key={c} value={c}>{c}</option>)}</select>
                    <span style={{ fontSize: 12.5, color: "var(--muted)" }}>=</span>
                    <input className="cx-input" aria-label="سعرها بالجنيه" data-testid="fx-egp" type="number" min="0" placeholder="بالجنيه" value={fxVal} onChange={(e) => setForm({ ...form, fxRates: e.target.value === "" ? {} : { [fxCur]: e.target.value } })} />
                    <span style={{ fontSize: 12.5, color: "var(--muted)" }}>ج</span>
                  </div>
                </div>
              );
            })()}

            {/* الحالة (ومعاها "ملغي") من صلاحية مدير الحجوزات بس - موظف
                الشيفت وقت إضافة حجز جديد (walk-in) مش بيشوف الاختيار ده
                خالص، فيفضل الحجز "مؤكد" بالقيمة الافتراضية. ده غير القفل
                الحقيقي في قاعدة البيانات نفسها (قسم ٢٣ في schema.sql) اللي
                بيمنع موظف الشيفت من كتابة "ملغي" حتى لو حد حاول يتخطى
                الواجهة. */}

          </div>

          {moneyLocked && <div style={{ marginTop: 10, fontSize: 13, color: "var(--muted)", background: "var(--paper2)", borderRadius: 8, padding: 8, display: "flex", gap: 6, alignItems: "center" }}><Lock size={13} /> السعر والرسوم والمدفوع بيتقفلوا بعد حفظ الحجز. لو فيه غلط في السعر: الغي الحجز (لو عليه فلوس بيتفتح طلب رد) واعمل حجز جديد بالقيم الصح. تسجيل الدفعات بيتم من موظف الشيفت.</div>}

          {lockedRepricedTotal != null && originalBooking && lockedRepricedTotal !== (Number(originalBooking.totalRoom) || 0) && (
            <div style={{ marginTop: 10, fontSize: 13, color: "var(--teal)", background: "var(--paper2)", borderRadius: 8, padding: 8 }}>
              عدد الليالي اتغيّر ({nightsBetween(originalBooking.checkin, originalBooking.checkout)} ← {nights}) - إجمالي الغرفة اتحرك تلقائيًا من {fmt(originalBooking.totalRoom)} إلى {fmt(lockedRepricedTotal)} {form.currency} بنفس سعر الليلة.
            </div>
          )}
          {form.status === "ملغي" && (isExistingBooking ? originalBooking?.status !== "ملغي" : true) && (Number(isExistingBooking ? originalBooking?.amountPaid : form.amountPaid) || 0) > 0 && (
            <div style={{ marginTop: 10, fontSize: 13, color: "var(--rust)", background: "#F4E7E2", borderRadius: 8, padding: 8 }}>
              <AlertTriangle size={13} style={{ verticalAlign: -2 }} /> الحجز ده عليه {fmt(originalBooking?.amountPaid ?? form.amountPaid)} {form.currency} متحصّل - بعد الإلغاء الفلوس دي بتفضل في الفندق (مفيش رد فلوس). الحجز نفسه بيفضل ظاهر في القائمة كحجز ملغي.
            </div>
          )}

          {conflict && duplicatePlan?.ok && (
            <div data-testid="duplicate-plan" style={{ marginTop: 10, fontSize: 13.5, background: "#E8F0F0", color: "var(--teal)", borderRadius: 8, padding: 10 }}>
              <div style={{ fontWeight: 800, marginBottom: 4 }}>الغرفة دي عليها نزيل دلوقتي ({clashesNow.map(clashLabel).join(" / ")})</div>
              لو كمّلت: {duplicatePlan.actions.map((act) => `${act.clash.guestName} هيتسجّل "غادر مبكرًا"${act.action === "trim" ? ` وخروجه يتقصّر لـ ${act.checkout}` : " (دخل وخرج في نفس اليوم)"} - بيتحاسب على الليالي اللي قعدها (الحد الأدنى ليلة)${(Number(act.clash.amountPaid) || 0) > 0 ? " وأي زيادة مدفوعة تفضل في الفندق" : ""}`).join(" · ")}، والنزيل الجديد يتسكّن مكانه.
            </div>
          )}
          {conflict && duplicatePlan && !duplicatePlan.ok && (
            <div data-testid="duplicate-blocked" style={{ marginTop: 10, color: "var(--rust)", fontSize: 13.5, background: "#F4E7E2", borderRadius: 8, padding: 10 }}>
              <AlertTriangle size={13} style={{ verticalAlign: -2 }} /> {duplicateBlockedText(duplicatePlan)}
            </div>
          )}
          </section>
          <section className="cx-step">
          <StepHead n={3} done={step1Done && step2Done} optional title="الدفع" hint={collectionLocked ? "التحصيل من صلاحية موظف الشيفت" : "لو النزيل دفع حاجة دلوقتي سجّلها هنا"} />

          {form.paymentDetails.onlinePaid ? (
            <div className="cx-card" style={{ padding: 14, boxShadow: "none" }}>
              <div style={{ fontSize: 12.5, color: "var(--muted)" }}>الإجمالي الكلي (غرفة + رسوم)</div>
              <div style={{ fontWeight: 800, fontSize: 15, padding: "4px 0" }}>{fmt(grandTotal)} {form.currency}</div>
              <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 4 }}>الحجز مدفوع أونلاين - سعر الغرفة اتدفع للمنصة. أي خدمات إضافية أو رسم دخول مبكر بتتحصّل في الفندق من بلوك الغرفة وبتدخل اليومية والتقرير.</div>
            </div>
          ) : (
            <div className="cx-card" data-testid="payment-block" style={{ padding: 14, background: "#FCFBF7", boxShadow: "none" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
                <div><label style={{ fontSize: 12.5, color: "var(--muted)" }}>الإجمالي الكلي (غرفة + رسوم)</label><div style={{ fontWeight: 800, fontSize: 15, padding: "6px 0" }}>{fmt(grandTotal)} {form.currency}</div></div>
                {isExistingBooking && <div><label style={{ fontSize: 12.5, color: "var(--muted)" }}>المدفوع حتى الآن</label><div style={{ fontWeight: 800, fontSize: 15, padding: "6px 0" }}>{fmt(paidBefore)} {form.currency}</div></div>}
                <div><label style={{ fontSize: 12.5, color: "var(--muted)" }}>المتبقي على النزيل</label><div data-testid="balance-due" style={{ fontWeight: 800, fontSize: 15, padding: "6px 0", color: balanceDue > 0 ? "var(--rust)" : "var(--sage)" }}>{fmt(balanceDue)} {form.currency}</div></div>
              </div>
              {isExistingBooking && perms.correctLedger && originalBooking && (
                <PaySec id="pay-sec-edit" title="تعديل المدفوع (الدفعات المتسجّلة)">
                <div data-testid="form-edit-payments" style={{ marginTop: 8 }}>
                  <EditPayments booking={originalBooking} scope={perms.correctLedger} me={profile?.username} onDone={async () => { payEditedRef.current = true; if (onRefresh) await onRefresh(); }} showToast={showToast} onLog={onLog} />
                </div>
                </PaySec>
              )}
              {!collectionLocked && (
                <PaySec id="pay-sec-now" title={isExistingBooking ? "تحصيل دلوقتي" : null}>
                <div data-testid="advance-payment" style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--hair)" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{isExistingBooking ? "تحصيل دلوقتي (اختياري) - بوسيلة أو أكتر، وبيتسجّل في اليومية" : "المدفوع حتى الآن (اختياري) - بيتسجّل في اليومية بوسيلته وتفاصيله"}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8, alignItems: "start" }}>
                    <div><label style={{ fontSize: 12.5, color: "var(--muted)" }}>المبلغ المدفوع / ديبوزيت ({form.payNow?.currency || form.currency})</label><input className="cx-input" data-testid="advance-amount" type="number" min="0" value={form.payNow?.amount ?? ""} onChange={(e) => setForm({ ...form, payNow: { ...form.payNow, amount: e.target.value } })} /></div>
                    {fxCurrencies(form).length > 0 && <div><label style={{ fontSize: 12.5, color: "var(--muted)" }}>العملة (بسعر الحجز)</label><select className="cx-select" data-testid="advance-currency" value={form.payNow?.currency || form.currency} onChange={(e) => setForm({ ...form, payNow: { ...form.payNow, currency: e.target.value, fee: "" } })}>{[form.currency, ...fxCurrencies(form)].map((c) => <option key={c} value={c}>{c}</option>)}</select></div>}
                    <div><label style={{ fontSize: 12.5, color: "var(--muted)" }}>طريقة الدفع</label><select className="cx-select" data-testid="advance-method" value={form.payNow?.method || "كاش"} onChange={(e) => setForm({ ...form, payNow: { ...form.payNow, method: e.target.value, details: emptyPaymentDetails() } })}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select></div>
                    <div><PaymentDetailsInline compact={false} testid="advance" method={form.payNow?.method || "كاش"} details={form.payNow?.details} onChange={(d) => setForm({ ...form, payNow: { ...form.payNow, details: d } })} /></div>
                    {form.payNow?.method === "فيزا" && (!form.payNow?.currency || form.payNow.currency === form.currency) && <div><label style={{ fontSize: 12.5, color: "var(--muted)" }}>رسوم فيزا ({form.currency}) - بتتدفع مع المبلغ</label><input className="cx-input" data-testid="advance-visa-fee" type="number" min="0" placeholder="0" value={form.payNow?.fee ?? ""} onChange={(e) => setForm({ ...form, payNow: { ...form.payNow, fee: e.target.value } })} /></div>}
                  </div>
                  {(form.payMore || []).map((l, i) => {
                    const upd = (patch) => setForm({ ...form, payMore: form.payMore.map((x, j) => j === i ? { ...x, ...patch } : x) });
                    return (
                      <div key={i} data-testid={"advance-extra-" + i} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 8, alignItems: "start", marginTop: 8, paddingTop: 8, borderTop: "1px dotted var(--hair)" }}>
                        <div><label style={{ fontSize: 12.5, color: "var(--muted)" }}>المبلغ ({l.currency || form.currency})</label><input className="cx-input" data-testid={"advance-extra-amount-" + i} type="number" min="0" value={l.amount} onChange={(e) => upd({ amount: e.target.value })} /></div>
                        {fxCurrencies(form).length > 0 && <div><label style={{ fontSize: 12.5, color: "var(--muted)" }}>العملة (بسعر الحجز)</label><select className="cx-select" data-testid={"advance-extra-currency-" + i} value={l.currency || form.currency} onChange={(e) => upd({ currency: e.target.value })}>{[form.currency, ...fxCurrencies(form)].map((c) => <option key={c} value={c}>{c}</option>)}</select></div>}
                        <div><label style={{ fontSize: 12.5, color: "var(--muted)" }}>طريقة الدفع</label><select className="cx-select" data-testid={"advance-extra-method-" + i} value={l.method} onChange={(e) => upd({ method: e.target.value, details: emptyPaymentDetails() })}>{PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select></div>
                        <div><PaymentDetailsInline compact={false} testid={"advance-extra-" + i} method={l.method} details={l.details} onChange={(d) => upd({ details: d })} /></div>
                        <div><button type="button" className="cx-btn cx-btn-outline" style={{ marginTop: 18 }} onClick={() => setForm({ ...form, payMore: form.payMore.filter((_, j) => j !== i) })}>شيل</button></div>
                      </div>
                    );
                  })}
                  <button type="button" className="cx-btn cx-btn-outline" data-testid="advance-add-line" style={{ marginTop: 8, fontSize: 13 }} onClick={() => setForm({ ...form, payMore: [...(form.payMore || []), { amount: "", currency: form.currency, method: "كاش", details: emptyPaymentDetails() }] })}><Plus size={13} /> دفعة تانية بوسيلة تانية</button>
                </div>
                </PaySec>
              )}
              {canPrior && !form.paymentDetails?.onlinePaid && (
                <PaySec id="pay-sec-prior" title={isExistingBooking ? "مدفوع قبل السيستم" : null}>
                <div data-testid="new-prior-paid" style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed var(--hair)" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>مدفوع قبل السيستم (اختياري) - بيتكتب على الحجز ومش بيدخل اليومية ولا الخزينة</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
                    <div><label style={{ fontSize: 12.5, color: "var(--muted)" }}>المبلغ ({form.currency})</label><input className="cx-input" data-testid="new-prior-amount" type="number" min="0" value={form.prior?.amount ?? ""} onChange={(e) => setForm({ ...form, prior: { ...form.prior, amount: e.target.value } })} /></div>
                    <div><label style={{ fontSize: 12.5, color: "var(--muted)" }}>ملاحظة (اتدفع إمتى / إزاي)</label><input className="cx-input" data-testid="new-prior-note" value={form.prior?.note ?? ""} onChange={(e) => setForm({ ...form, prior: { ...form.prior, note: e.target.value } })} /></div>
                  </div>
                </div>
                </PaySec>
              )}
              {collectionLocked && <div style={{ marginTop: 8, fontSize: 13, color: "var(--muted)", display: "flex", alignItems: "center", gap: 4 }}><Lock size={11} /> تسجيل التحصيل (كاش / فيزا / تحويل) من صلاحية موظف الشيفت بس - إنت بتحدد سعر الحجز، وحالة الدفع بتتحدّث تلقائيًا أول ما يتحصّل.</div>}
            </div>
          )}

          </section>
          <section className="cx-step">
          <StepHead n={4} done={false} optional title="خيارات إضافية" hint="رسوم، دخول مبكر، حجز أونلاين، جهة الحجز، ملاحظات" />
          <details data-testid="form-more" open={!!((Number(form.extras?.tours) || 0) || (Number(form.extras?.pickup) || 0) || form.earlyCheckin?.applied || form.paymentDetails?.onlinePaid || form.notes || (form.source && form.source !== "مباشر") || (form.status && form.status !== "مؤكد"))} style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer", fontSize: 14, fontWeight: 600, color: "var(--teal)" }}>افتح الخيارات الإضافية</summary>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 8, marginTop: 8 }}>
              <div><label style={{ fontSize: 12.5, color: "var(--muted)" }}>جهة الحجز</label><select className="cx-select" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>{sourceOptionsFor(form.source).map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
              {perms.editBookings && <div><label style={{ fontSize: 12.5, color: "var(--muted)" }}>الحالة</label><select className="cx-select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>{BOOKING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>}
            </div>
          <div className="cx-card" style={{ marginTop: 10, padding: 10, background: "var(--paper2)" }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>رسوم إضافية {chargeLocked && <Lock size={10} style={{ verticalAlign: -1 }} />}</div>
            {/* شيلنا "غسيل" و"كافيتيريا" من هنا - مبقوش يُضافوا كرسوم على
                الحجز من شاشة الحجوزات. لو حجز قديم كان عليه قيمة فيهم
                فعلاً، القيمة تفضل محفوظة ومحسوبة في الإجمالي زي ما هي -
                بس مفيش إضافة جديدة منها عن طريق الواجهة. */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(100px,1fr))", gap: 8 }}>
              <div><label style={{ fontSize: 12, color: "var(--muted)" }}>جولات</label><input className="cx-input" type="number" min="0" disabled={chargeLocked} value={form.extras.tours} onChange={(e) => setForm({ ...form, extras: { ...form.extras, tours: e.target.value } })} /></div>
              <div><label style={{ fontSize: 12, color: "var(--muted)" }}>بيك أب</label><input className="cx-input" type="number" min="0" disabled={chargeLocked} value={form.extras.pickup} onChange={(e) => setForm({ ...form, extras: { ...form.extras, pickup: e.target.value } })} /></div>
            </div>
          </div>

          <div className="cx-card" style={{ marginTop: 10, padding: 10, background: "var(--paper2)" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, marginBottom: form.earlyCheckin?.applied ? 8 : 0 }}>
              <input type="checkbox" disabled={earlyLocked} checked={!!form.earlyCheckin?.applied} onChange={(e) => setForm({ ...form, earlyCheckin: { ...form.earlyCheckin, applied: e.target.checked } })} /> دخول مبكر قبل معاد الحجز الأصلي {earlyLocked && <Lock size={10} />}
            </label>
            {form.earlyCheckin?.applied && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
                <div><label style={{ fontSize: 12, color: "var(--muted)" }}>رسم الدخول المبكر</label><input className="cx-input" type="number" min="0" disabled={earlyLocked} value={form.earlyCheckin.fee} onChange={(e) => setForm({ ...form, earlyCheckin: { ...form.earlyCheckin, fee: e.target.value } })} /></div>
                <div style={{ gridColumn: "span 2" }}><label style={{ fontSize: 12, color: "var(--muted)" }}>ملاحظة الدخول المبكر</label><AutoText className="cx-input" disabled={earlyLocked} value={form.earlyCheckin.note} onChange={(e) => setForm({ ...form, earlyCheckin: { ...form.earlyCheckin, note: e.target.value } })} /></div>
              </div>
            )}
          </div>

          <div className="cx-card" style={{ marginTop: 10, padding: 10, background: "var(--paper2)" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700 }}>
              <input type="checkbox" disabled={chargeLocked} checked={!!form.paymentDetails.onlinePaid} onChange={(e) => setForm({ ...form, paymentDetails: { ...form.paymentDetails, onlinePaid: e.target.checked } })} /> الحجز مدفوع أونلاين (Booking.com أو أي منصة حجز) {chargeLocked && <Lock size={10} style={{ verticalAlign: -1 }} />}
            </label>
            {form.paymentDetails.onlinePaid && (
              <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
                <div><label style={{ fontSize: 12, color: "var(--muted)" }}>إجمالي الحجز الأونلاين</label><div style={{ fontWeight: 700, padding: "6px 0" }}>{fmt(grandTotal)} {form.currency}</div></div>
                {/* الحجز ده مدفوع من خلال منصة حجز (زي Booking.com) مش تحويل
                    مباشر من النزيل - فمفيش "اسم مرسل" أو "رقم محفظة" أصلًا.
                    اسم المنصة نفسها متسجل في "جهة الحجز" فوق، وده بس ملاحظة/
                    كود تأكيد اختياري يخص حجز المنصة. */}
                <div style={{ gridColumn: "1 / -1" }}><label style={{ fontSize: 12, color: "var(--muted)" }}>رقم تأكيد الحجز على المنصة / ملاحظة (اختياري)</label><AutoText className="cx-input" placeholder="مثلاً: رقم حجز Booking.com" disabled={chargeLocked} value={form.paymentDetails.ref} onChange={(e) => setForm({ ...form, paymentDetails: { ...form.paymentDetails, ref: e.target.value } })} /></div>
              </div>
            )}
          </div>

            <div style={{ marginTop: 8 }}><label style={{ fontSize: 12.5, color: "var(--muted)" }}>ملاحظات</label><AutoText className="cx-input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </details>
          </section>
          </div>

          <aside className="cx-form-side" aria-label="ملخص الحجز">
            <div style={{ fontWeight: 700, color: "var(--ink)", marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}><span className="cx-ico sm ic-gold" aria-hidden="true"><ClipboardList size={16} /></span>ملخص الحجز</div>
            <dl className="cx-sum">
              <div><dt>الغرفة</dt><dd>{form.room ? <RoomName rooms={rooms} number={Number(form.room)} /> : "—"}</dd></div>
              <div><dt>النزيل</dt><dd>{form.guestName?.trim() || "—"}{Number(form.pax) > 1 ? ` (${form.pax} أفراد)` : ""}</dd></div>
              <div><dt>الإقامة</dt><dd dir="ltr" style={{ textAlign: "right" }}><DateRange from={form.checkin} to={form.checkout} /></dd></div>
              <div><dt>الليالي</dt><dd>{nights > 0 ? nights : "—"}</dd></div>
              <div className="sep"><dt>الإجمالي</dt><dd style={{ fontSize: 17 }}>{fmt(grandTotal)} {form.currency}</dd></div>
              {form.paymentDetails.onlinePaid ? <div><dt>الدفع</dt><dd style={{ color: "var(--sage)" }}>مدفوع أونلاين</dd></div> : (<>
                {(paidBefore + advanceNow) > 0 && <div><dt>مدفوع</dt><dd>{fmt(paidBefore + advanceNow)} {form.currency}</dd></div>}
                <div><dt>المتبقي</dt><dd style={{ color: balanceDue > 0 ? "var(--rust)" : "var(--sage)" }}>{fmt(balanceDue)} {form.currency}</dd></div>
              </>)}
            </dl>
            <ol className="cx-steps-mini" aria-label="الخطوات">
              {[["الغرفة والنزيل", step1Done], ["الإقامة والسعر", step2Done], ["الدفع (اختياري)", step1Done && step2Done], ["خيارات إضافية (اختياري)", null]].map(([t, d], i) => (
                <li key={t} className={d ? "done" : ""}><span>{d ? <Check size={12} /> : i + 1}</span>{t}</li>
              ))}
            </ol>
            {!step1Done && <div className="cx-hint" style={{ marginBottom: 8 }}>لسه ناقص: {!form.room ? "الغرفة" : ""}{!form.room && !form.guestName?.trim() ? " و" : ""}{!form.guestName?.trim() ? "اسم النزيل" : ""}</div>}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button className="cx-btn cx-btn-gold" style={{ minHeight: 46 }} onClick={saveBooking}><Check size={16} /> {conflict && duplicatePlan?.ok ? "حفظ الحجز + خروج مبكر للنزيل القديم" : "حفظ الحجز"}</button>
              <button className="cx-btn cx-btn-outline" onClick={() => setForm(null)}>إلغاء</button>
            </div>
          </aside>
          </div>
        </div>
      )}

      <GuestCodeHits hits={codeHits} rooms={rooms} />
      <div className="cx-no-print cx-seg" role="group" aria-label="عرض الحجوزات" style={{ marginBottom: 12 }}>
        {[["all", "الكل"], ["active", "الحجوزات الشغّالة"], ["cancelled", "الحجوزات الملغية"]].map(([k, label]) => (
          <button key={k} data-testid={"status-filter-" + k} aria-pressed={statusFilter === k} className={"cx-btn " + (statusFilter === k ? "cx-btn-gold" : "cx-btn-outline")} onClick={() => setStatusFilter(k)}>{label} ({counts[k]})</button>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {list.length === 0 && <EmptyState icon={SearchX} title="لا يوجد حجوزات مطابقة" hint={bookings.length ? "غيّر كلمة البحث أو التواريخ أو الفلتر اللي فوق." : "لسه مفيش حجوزات متسجلة."} />}
        {visible.map((b) => { const cancelled = b.status === "ملغي"; return (
          <div key={b.id} data-testid={cancelled ? "booking-cancelled" : "booking-card"} className="cx-card cx-bk" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, borderInlineStartWidth: 4, borderInlineStartColor: cancelled ? "var(--rust)" : bookingAmountDue(b) > 0 ? "#E0A33A" : "var(--sage)", ...(cancelled ? { background: "#FCF6F4" } : {}) }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15.5, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                  <span style={cancelled ? { textDecoration: "line-through", opacity: 0.7 } : undefined}><RoomName rooms={rooms} number={b.room} /> · <span className="cx-iso">{b.guestName}</span></span>
                  {cancelled && <span className="cx-pill" style={{ background: "var(--rust)", color: "#fff", marginInlineStart: 6 }}>حجز ملغي</span>}
                  {b.paymentDetails?.onlinePaid && <span className="cx-pill" style={{ background: "#EDE8F5", color: "#7A5FB5", marginInlineStart: 6 }}>مدفوع أونلاين</span>}
                  {b.leftEarly && <span className="cx-pill" style={{ background: "#FBE9DA", color: "var(--rust)", marginInlineStart: 6 }}>غادر مبكرًا</span>}
                  {b.duplicatePlacement && <span className="cx-pill" style={{ background: "#EDE8F5", color: "#6B4FA0", marginInlineStart: 6 }}>تسكين مكرر</span>}
                  {b.code && <span dir="ltr" data-testid="booking-code-chip" style={{ fontFamily: "monospace", fontSize: 13, color: "var(--muted)", marginInlineStart: 8 }}>{b.code}</span>}
                </div>
                <div className="cx-meta" style={{ marginTop: 4 }}>
                  <span><CalendarDays size={14} aria-hidden="true" /><DateRange from={b.checkin} to={b.checkout} /></span>
                  <span><Moon size={14} aria-hidden="true" />{nightsBetween(b.checkin, b.checkout)} ليلة</span>
                  <span><Users size={14} aria-hidden="true" />{b.pax} فرد</span>
                  {!b.paymentDetails?.onlinePaid && <span><CreditCard size={14} aria-hidden="true" />{b.paymentMethod}</span>}
                  <span><Globe size={14} aria-hidden="true" />{b.source}</span>
                </div>
                <GuestCodeChips codes={guestCodeEntries(b)} />
              </div>
              <div className="cx-no-print cx-bk-actions">
                {b.status === "تم تسجيل الخروج" && <span className="cx-pill" style={{ background: "#00000010", color: "var(--teal)" }}>{b.status}</span>}
                {perms.markPaymentReceived && !cancelled && bookingHasDue(b) && <QuickPay booking={b} onDone={onRefresh} showToast={showToast} />}
                {perms.editBookingPrice && !perms.editBookings && !offShift && !cancelled && (
                  <button className="cx-btn cx-btn-outline" title="تعديل الحجز (بيانات النزيل والسعر والتمديد)" data-testid="edit-price" onClick={() => startEdit(b)}><Pencil size={13} /> تعديل الحجز</button>
                )}
                {perms.editBookings && (<>
                  <button className="cx-btn cx-btn-outline" title="تعديل" aria-label="تعديل الحجز" onClick={() => startEdit(b)}><Pencil size={13} /></button>
                  {b.status !== "ملغي" && b.status !== "تم تسجيل الخروج" && (
                    <span data-testid="cancel-booking"><TwoStepButton label="إلغاء الحجز" confirmLabel={`تأكيد الإلغاء؟ ${(Number(b.amountPaid) || 0) > 0 ? `(عليه ${fmt(b.amountPaid)} ${b.currency} متحصّل - بتفضل في الفندق، مفيش رد)` : "(مفيش فلوس متحصّلة)"}`} icon={<Ban size={13} />} onConfirm={() => cancelBooking(b)} /></span>
                  )}
                </>)}
                {perms.devTools && (
                  <details className="cx-more" data-testid="booking-more">
                    <summary className="cx-btn cx-btn-outline" aria-label="خيارات أخرى">⋯ المزيد</summary>
                    <div className="cx-more-body">
                      {perms.devTools && <DevRestore booking={b} onDone={onRefresh} showToast={showToast} />}
                      {perms.devTools && <span data-testid="dev-delete-booking"><DevDeleteBooking booking={b} onDone={onRefresh} showToast={showToast} /></span>}
                    </div>
                  </details>
                )}
              </div>
              <div className="cx-print-only">
                <span className="cx-pill" style={{ background: "#00000010", color: cancelled ? "var(--rust)" : "var(--teal)" }}>{b.status}</span>
              </div>
            </div>
            <MoneyBox b={b} />
            <PayBreakdown payments={payIndex?.get(b.id)} currency={b.currency} />
            <RefundBox b={b} />
          </div>
        ); })}
        {list.length > visible.length && (
          <button type="button" className="cx-btn cx-btn-outline cx-no-print" data-testid="bookings-more" style={{ alignSelf: "center" }} onClick={() => setShownCount((n) => n + PAGE)}>
            عرض حجوزات أقدم (باقي {list.length - visible.length})
          </button>
        )}
      </div>

      <div className="cx-print-only cx-print-footer">
        <div className="cx-print-sign">
          <span>توقيع المسؤول: ______________________</span>
          <span>الختم:</span>
        </div>
        <div className="cx-print-generated">تم إصدار هذا المستند أوتوماتيكيًا من نظام مجموعة H&S للفنادق</div>
      </div>
    </div>
  );
}
