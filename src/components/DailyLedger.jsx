import { useState, useEffect, useRef } from "react";
import { Lock, Unlock, AlertTriangle, History, Plus, Printer, LockOpen, DoorOpen, Building2, Landmark, MessageSquareText, CalendarClock, Coffee, FileX } from "lucide-react";
import { Logo, AutoText, SectionHead, EmptyState, RoomName, roomOptionLabel } from "./shared";
import { guarded } from "../lib/busy";
import { CafeteriaSection } from "./CafeteriaPanel";
import { listStaffCafeteria } from "../data/staffCafeteria";
import { emptyPaymentDetails, COMMON_CURRENCIES, CURRENCY_LABEL, PAYMENT_METHODS, methodOptionsFor, EXPENSE_CATEGORIES, fmt, money, currencyKeysOf, freshShiftRecord, computeShiftTotals, rebaseShiftRecord, emptyLedgerRow, HOTEL_ROW_LABEL, methodTransactions, missingPaymentDetails } from "../domain/money";
import { SHIFTS, HOTEL_NAME } from "../domain/constants";
import { todayStr, arabicWeekday, arabicDateLong, defaultShiftForNow, shiftDayNow, prevShiftOf, isShiftActiveNow, SHIFT_OVERTIME_GRACE_HOURS } from "../domain/dates";
import { PaymentDetailsInline } from "./shared";
import { resolveMyShift, getShiftRecord, getShiftRecordStrict, createShiftRecord, updateShiftRecordIfUnchanged, getClaimsForDate, claimShiftRow, reopenShiftRecord } from "../data/shifts";

// العملات مثبّتة في قائمة اختيار بس (مش نص حر) - نفس الخمسة المعتمدة في
// كل مكان تاني في النظام (COMMON_CURRENCIES في domain/money.js).
function CurrencyPicker({ value, onChange, disabled, width }) {
  return (
    <select className="cx-select" disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} style={{ width: width || 86, fontSize: 13 }}>
      {COMMON_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
}

// صف الغرفة "فيه بيانات" = فيه مبلغ أو بيان أو ملاحظة أو مربوط بحجز. باقي الغرف الفاضية مخفية
// (عشان اليومية ماتبقاش ١٦ صف فاضي) ويتضافوا بالاختيار من القايمة أو "عرض كل الغرف".
const rowHasData = (r) => (Number(r.expenseAmt) || 0) !== 0 || (Number(r.collectionAmt) || 0) !== 0 || !!r.expenseDesc || !!r.collectionDesc || !!r.notes || !!r.bookingId;

function LedgerTable({ record, rooms, locked, onUpdateRow }) {
  const [shown, setShown] = useState(() => new Set());
  const [all, setAll] = useState(false);
  const visible = (r) => all || shown.has(r.room) || rowHasData(r);
  const hiddenRooms = [...new Set(record.rows.filter((r) => !visible(r)).map((r) => r.room))];
  const touch = (idx, patch) => { const room = record.rows[idx]?.room; if (room != null && !shown.has(room)) setShown(new Set([...shown, room])); onUpdateRow(idx, patch); };
  const updateRow = touch;
  return (
    <div className="cx-card" style={{ padding: 14 }}>
      <SectionHead icon={DoorOpen} tone="teal" title="حركة الغرف" hint="تحصيل كل غرفة في الشيفت ده (الغرف مابتصرفش - المصاريف في بنود مصاريف الفندق)" />
    <div style={{ overflowX: "auto" }}>
      {!locked && (hiddenRooms.length > 0 || all) && (
        <div className="cx-no-print" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "6px 4px", fontSize: 13, color: "var(--muted)" }}>
          <span>الغرف اللي فيها حركة بس ظاهرة.</span>
          {hiddenRooms.length > 0 && (
            <select className="cx-select" data-testid="ledger-add-room" style={{ width: 150 }} value="" onChange={(e) => { if (e.target.value) setShown(new Set([...shown, Number(e.target.value)])); }}>
              <option value="">＋ أضف غرفة...</option>
              {hiddenRooms.map((n) => <option key={n} value={n}>{roomOptionLabel(rooms, n)}</option>)}
            </select>
          )}
          <button type="button" className="cx-btn cx-btn-outline" data-testid="ledger-show-all" style={{ fontSize: 12.5, padding: "2px 8px" }} onClick={() => setAll(!all)}>{all ? "إخفاء الغرف الفاضية" : "عرض كل الغرف"}</button>
        </div>
      )}
      <table className="cx-table cx-stack" style={{ fontSize: 13, minWidth: 680 }}>
        <thead><tr><th className="cx-th" style={{ width: 60 }}>الغرفة</th><th className="cx-th">التحصيل</th><th className="cx-th">تفاصيل الدفع (فيزا / تحويل)</th><th className="cx-th">ملاحظات</th></tr></thead>
        <tbody>
          {record.rows.map((row, idx) => (!visible(row) ? null : (
            <tr key={row.room + "-" + idx}>
              {/* ممكن يكون لنفس الغرفة أكتر من صف (لو اتحصّل عليها بوسيلتين دفع أو
                  عملتين مختلفتين، أو اتردّ ليها فلوس) - الصف الإضافي بيتعلّم. */}
              <td data-label="الغرفة" style={{ textAlign: "center", fontWeight: 700, position: "sticky", right: 0, background: "#fff", whiteSpace: "nowrap" }}><RoomName rooms={rooms} number={row.room} />{record.rows.findIndex((r) => r.room === row.room) !== idx && <div style={{ fontSize: 11.5, fontWeight: 400, color: "var(--muted)" }}>صف إضافي</div>}</td>
              <td data-label="التحصيل">
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <select className="cx-select" disabled={locked} value={row.collectionMethod} onChange={(e) => updateRow(idx, { collectionMethod: e.target.value, paymentDetails: emptyPaymentDetails() })}>{methodOptionsFor(row.collectionMethod).map((m) => <option key={m} value={m}>{m}</option>)}</select>
                  <AutoText className="cx-input" placeholder="بيان التحصيل" disabled={locked} value={row.collectionDesc} onChange={(e) => updateRow(idx, { collectionDesc: e.target.value })} />
                  <div style={{ display: "flex", gap: 3 }}>
                    <input className="cx-input" type="number" placeholder="المبلغ" disabled={locked} value={row.collectionAmt} onChange={(e) => updateRow(idx, { collectionAmt: e.target.value })} style={{ flex: 1 }} />
                    <CurrencyPicker value={row.collectionCurrency} disabled={locked} onChange={(v) => updateRow(idx, { collectionCurrency: v })} />
                  </div>
                  {(Number(row.expenseAmt) || 0) !== 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>مصروف قديم مسجّل على الغرفة: {row.expenseDesc || row.expenseCategory} - {fmt(row.expenseAmt)} {row.expenseCurrency}</div>}
                </div>
              </td>
              <td data-label="تفاصيل الدفع"><PaymentDetailsInline method={row.collectionMethod} details={row.paymentDetails} disabled={locked} onChange={(d) => updateRow(idx, { paymentDetails: d })} /></td>
              <td data-label="ملاحظات"><AutoText className="cx-input" disabled={locked} value={row.notes} onChange={(e) => updateRow(idx, { notes: e.target.value })} /></td>
            </tr>
          )))}
        </tbody>
      </table>
    </div>
    </div>
  );
}

const hotelRowsOf = (record) => (record.hotelRows && record.hotelRows.length ? record.hotelRows : [emptyLedgerRow(HOTEL_ROW_LABEL)]);

/* بنود "مصاريف الفندق": مش مرتبطة بغرفة (كهرباء، صيانة، مشتريات...). الفندق بيصرف بس - الإيراد بيجي من الغرف والكافيتيريا. */
function HotelRowsTable({ record, locked, onUpdateRow, onAddRow, onRemoveRow }) {
  const rows = hotelRowsOf(record);
  return (
    <div className="cx-card" data-testid="hotel-rows" style={{ marginTop: 14, padding: 12 }}>
      <SectionHead icon={Building2} tone="slate" title="مصاريف الفندق" hint="بنود مش مرتبطة بغرفة (كهرباء، صيانة، مشتريات...). المصروف بيتخصم من الخزينة وبيدخل في إجماليات اليومية والتقارير." />
      <div style={{ overflowX: "auto" }}>
        <table className="cx-table cx-stack" style={{ fontSize: 13, minWidth: 560 }}>
          <thead><tr><th className="cx-th" style={{ width: 70 }}>البند</th><th className="cx-th">المصاريف</th><th className="cx-th">ملاحظات</th>{!locked && <th className="cx-th" style={{ width: 36 }} />}</tr></thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} data-testid={"hotel-row-" + idx}>
                <td data-label="البند" style={{ textAlign: "center", fontWeight: 700, whiteSpace: "nowrap" }}>فندق {idx + 1}</td>
                <td data-label="المصاريف">
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <select className="cx-select" style={{ fontSize: 12.5 }} disabled={locked} value={row.expenseCategory} onChange={(e) => onUpdateRow(idx, { expenseCategory: e.target.value })}>{EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
                    <AutoText className="cx-input" placeholder="بيان المصروف" disabled={locked} value={row.expenseDesc} onChange={(e) => onUpdateRow(idx, { expenseDesc: e.target.value })} />
                    <div style={{ display: "flex", gap: 3 }}>
                      <input className="cx-input" type="number" placeholder="مبلغ المصروف" disabled={locked} value={row.expenseAmt} onChange={(e) => onUpdateRow(idx, { expenseAmt: e.target.value })} style={{ flex: 1 }} />
                      <CurrencyPicker value={row.expenseCurrency} disabled={locked} onChange={(v) => onUpdateRow(idx, { expenseCurrency: v })} />
                    </div>
                    {(Number(row.collectionAmt) || 0) !== 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>إيراد قديم مسجّل على البند: {row.collectionDesc || "—"} - {fmt(row.collectionAmt)} {row.collectionCurrency} ({row.collectionMethod})</div>}
                  </div>
                </td>
                <td data-label="ملاحظات"><AutoText className="cx-input" disabled={locked} value={row.notes} onChange={(e) => onUpdateRow(idx, { notes: e.target.value })} /></td>
                {!locked && <td style={{ textAlign: "center" }}>{rows.length > 1 && <button className="cx-btn cx-btn-outline" title="شيل البند ده" aria-label={"شيل بند فندق " + (idx + 1)} style={{ padding: "3px 8px" }} onClick={() => onRemoveRow(idx)}>×</button>}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!locked && <button className="cx-btn cx-btn-outline cx-no-print" data-testid="hotel-row-add" style={{ marginTop: 8, fontSize: 13 }} onClick={onAddRow}><Plus size={13} /> إضافة بند مصاريف فندق</button>}
    </div>
  );
}

function ShiftSummaryFooter({ record, totals, locked, onChangeHandover, onAddCurrency, prevClosing, onChangeMethodHandover, onAddMethodTracking, prevMethodClosing }) {
  const [newCur, setNewCur] = useState("");
  const [newMethod, setNewMethod] = useState("فيزا");
  const [newMethodCur, setNewMethodCur] = useState("EGP");
  const activeCurrencies = currencyKeysOf(record.handover, totals.totalCollections, totals.totalExpenses, totals.closingCash);
  // وسائل الدفع (غير الكاش) اللي ليها عهدة متابَعة أو تحصيل في الشيفت ده -
  // بنضم القائمة الحالية لأي اسم وسيلة قديم فعليًا متسجل في بيانات الشيفت
  // ده (مثلاً "انستاباي" قبل الدمج) عشان بياناته القديمة ماتختفيش من العرض.
  const candidateMethods = Array.from(new Set([...PAYMENT_METHODS, ...Object.keys(record.methodHandover || {}), ...Object.keys(totals.byMethodCurrency || {})]));
  const activeMethods = candidateMethods.filter((m) => m !== "كاش" && (currencyKeysOf(record.methodHandover?.[m]).length > 0 || currencyKeysOf(totals.byMethodCurrency?.[m]).length > 0));
  return (
    <div className="cx-card" style={{ marginTop: 14, padding: 14 }}>
      <SectionHead icon={Landmark} tone="green" title="الخزينة والعهدة" hint="العهدة + التحصيل - المصاريف لكل عملة" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}>
        {activeCurrencies.map((cur) => (
          <div key={cur} style={{ border: "1px solid var(--hair)", borderRadius: 10, padding: 10 }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>{CURRENCY_LABEL[cur] || cur} ({cur})</div>
            <div style={{ marginBottom: 6 }}>
              <label style={{ fontSize: 12.5, color: "var(--muted)" }}>العهدة</label>
              <input className="cx-input" type="number" disabled={locked} value={record.handover?.[cur] ?? 0} onChange={(e) => onChangeHandover(cur, e.target.value)} />
              {prevClosing && prevClosing[cur] != null && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>مقترح: {money(prevClosing, cur)}</div>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 13.5 }}>
              <div><div style={{ color: "var(--muted)", fontSize: 12 }}>إجمالي التحصيل</div><div style={{ fontWeight: 700 }}>{money(totals.totalCollections, cur)}</div></div>
              <div><div style={{ color: "var(--muted)", fontSize: 12 }}>نقدًا منها</div><div style={{ fontWeight: 700 }}>{money(totals.cashCollections, cur)}</div></div>
              <div><div style={{ color: "var(--muted)", fontSize: 12 }}>إجمالي المصاريف</div><div style={{ fontWeight: 700 }}>{money(totals.totalExpenses, cur)}</div></div>
              <div><div style={{ color: "var(--muted)", fontSize: 12 }}>رصيد الخزينة</div><div style={{ fontWeight: 800, color: "var(--teal)" }}>{money(totals.closingCash, cur)}</div></div>
            </div>
          </div>
        ))}
      </div>
      {!locked && COMMON_CURRENCIES.filter((c) => !activeCurrencies.includes(c)).length > 0 && (
        <div style={{ marginTop: 12, display: "flex", gap: 6, alignItems: "center" }}>
          <select className="cx-select" style={{ maxWidth: 180, fontSize: 13 }} value={newCur} onChange={(e) => setNewCur(e.target.value)}>
            <option value="">أضف عملة تانية...</option>
            {COMMON_CURRENCIES.filter((c) => !activeCurrencies.includes(c)).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="cx-btn cx-btn-outline" style={{ fontSize: 13 }} disabled={!newCur} onClick={() => { onAddCurrency(newCur); setNewCur(""); }}><Plus size={13} /> إضافة</button>
        </div>
      )}

      {/* عهدة وتحصيل وسائل الدفع التانية (فيزا/انستاباي/فودافون كاش/تحويل
          بنكي...) - زي عهدة الكاش بالظبط بس لجهاز الدفع مش الدرج: بتتنقل
          القراية من إقفال الشيفت اللي فات، وبتتحدث أول ما تحصيل بنفس
          الوسيلة يتسجل في جدول اليومية فوق. */}
      {(activeMethods.length > 0 || !locked) && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--hair)" }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8 }}>عهدة وسائل الدفع الأخرى (فيزا، إلخ)</div>
          {activeMethods.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14, marginBottom: activeMethods.length ? 10 : 0 }}>
              {activeMethods.map((m) => {
                const curs = currencyKeysOf(record.methodHandover?.[m], totals.byMethodCurrency?.[m]);
                return curs.map((cur) => (
                  <div key={m + cur} style={{ border: "1px solid var(--hair)", borderRadius: 10, padding: 10 }}>
                    <div style={{ fontWeight: 800, marginBottom: 8 }}>{m} ({cur})</div>
                    <div style={{ marginBottom: 6 }}>
                      <label style={{ fontSize: 12.5, color: "var(--muted)" }}>العهدة (قراءة الجهاز في بداية الشيفت)</label>
                      <input className="cx-input" type="number" disabled={locked} value={record.methodHandover?.[m]?.[cur] ?? 0} onChange={(e) => onChangeMethodHandover(m, cur, e.target.value)} />
                      {prevMethodClosing?.[m]?.[cur] != null && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>مقترح: {money(prevMethodClosing[m], cur)}</div>}
                    </div>
                    {(() => { const tx = methodTransactions(record, m).filter((t) => t.currency === cur); return tx.length > 0 && (
                      <div data-testid="method-transactions" style={{ marginBottom: 6, fontSize: 12.5, background: "var(--paper2)", borderRadius: 6, padding: 6 }}>
                        {tx.map((t, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 6 }}><span>{t.where}{t.details ? <b dir="ltr" style={{ marginInlineStart: 6 }}>{t.details}</b> : null}</span><b>{fmt(t.amount)}</b></div>)}
                      </div>); })()}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 13.5 }}>
                      <div><div style={{ color: "var(--muted)", fontSize: 12 }}>حصلت الشيفت ده</div><div style={{ fontWeight: 700 }}>{money(totals.byMethodCurrency?.[m], cur)}</div></div>
                      <div><div style={{ color: "var(--muted)", fontSize: 12 }}>الإجمالي دلوقتي</div><div style={{ fontWeight: 800, color: "var(--teal)" }}>{money(totals.methodClosing?.[m], cur)}</div></div>
                    </div>
                  </div>
                ));
              })}
            </div>
          )}
          {!locked && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <select className="cx-select" style={{ fontSize: 13, width: 130 }} value={newMethod} onChange={(e) => setNewMethod(e.target.value)}>{PAYMENT_METHODS.filter((m) => m !== "كاش").map((m) => <option key={m} value={m}>{m}</option>)}</select>
              <select className="cx-select" style={{ width: 90, fontSize: 13 }} value={newMethodCur} onChange={(e) => setNewMethodCur(e.target.value)}>{COMMON_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
              <button className="cx-btn cx-btn-outline" style={{ fontSize: 13 }} disabled={!newMethod || !newMethodCur} onClick={() => onAddMethodTracking(newMethod, newMethodCur)}><Plus size={13} /> متابعة عهدة {newMethod}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ShiftClaimPicker({ date, claims, onClaim }) {
  const nowShift = defaultShiftForNow();
  return (
    <div className="cx-card" style={{ padding: 16 }}>
      <div style={{ fontWeight: 800, marginBottom: 4 }}>اختار شيفتك النهارده ({arabicWeekday(date)} · <bdi dir="ltr" className="cx-rn">{date}</bdi>)</div>
      <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>الاختيار ده بيتحدد مرة واحدة بس ومينفعش تغيّره بعد كده، وهتقدر تعدل بس على الشيفت ده لحد ما يخلص اليوم. كل شيفت مينفتحش غير في معاده الفعلي.</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {SHIFTS.map((s) => {
          const taken = claims[s.key];
          const notYourTime = s.key !== nowShift;
          const disabled = !!taken || notYourTime;
          return (
            <button key={s.key} disabled={disabled} onClick={() => onClaim(s.key)}
              className="cx-btn cx-btn-outline" style={{ justifyContent: "space-between", padding: "12px 14px", fontSize: 14.5, opacity: disabled ? 0.5 : 1 }}>
              <span>{s.label} <span style={{ fontWeight: 400, color: "var(--muted)" }}>({s.time})</span></span>
              {taken ? <span style={{ fontSize: 13, color: "var(--muted)" }}>اتاخد بواسطة {taken.name}</span> : notYourTime ? <span style={{ fontSize: 13, color: "var(--muted)" }}>لسه مش وقته</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DailyLedger({ rooms, bookings, profiles, perms, profile, onLog, showToast, dataVersion }) {
  const [mode, setMode] = useState(perms.editLedger ? "live" : "history");
  const [claims, setClaims] = useState(null);
  const [myShiftKey, setMyShiftKey] = useState(null);
  const [record, setRecord] = useState(null);
  const [prevClosing, setPrevClosing] = useState(null);
  const [prevMethodClosing, setPrevMethodClosing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [liveDay, setLiveDay] = useState(shiftDayNow());
  const today = liveDay;
  const [histDate, setHistDate] = useState(shiftDayNow());
  const [histShift, setHistShift] = useState(defaultShiftForNow());
  const [histRecord, setHistRecord] = useState(null);
  const [staffEntries, setStaffEntries] = useState(null);

  // حل مشكلة "العداد بيهيس وأنا بكتب": كل كتابة كانت بتبعت save فوري
  // للسيرفر، والـ realtime كان بيسمع صدى الحفظة دي ويعيد تحميل السجل من
  // جديد فوق نفس اللي بتكتبيه لسه. الحل جزئين: (1) دلوقتي كل التعديلات
  // بتتجمع محليًا وبتتبعت مرة واحدة للسيرفر بعد ما تسيبي الكتابة لحظة بسيطة
  // (debounce)، (2) شاشة اليومية بتاعتك النهارده مابقتش بتعمل reload لنفسها
  // كل ما التغيير ده يوصلها هي نفسها عن طريق الـ realtime.
  const pendingRef = useRef(null);
  const baseUpdatedAtRef = useRef(null);
  const baseRecordRef = useRef(null);
  const debounceTimer = useRef(null);
  const retryRef = useRef(0);
  const flushLatest = useRef(null);

  useEffect(() => {
    if (mode !== "live") return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      let day = shiftDayNow();
      let c = await getClaimsForDate(day);
      let mine = Object.entries(c).find(([, v]) => v && v.username === profile.username);
      if (!mine) {
        // شيفت ليلي بدأ قبل ٨ص وأوفر تايمه لسه شغال بعد ٨ص: بيفضل على تاريخه الأصلي
        const r = await resolveMyShift(profile.username);
        if (r.key === "night" && r.date !== day) { day = r.date; c = r.claims; mine = ["night", r.claims.night]; }
      }
      if (cancelled) return;
      setLiveDay(day);
      setClaims(c);
      if (mine) {
        const [sk] = mine;
        const cur = await getShiftRecordStrict(day, sk);
        const prev = await getPrevShiftClosing(day, sk);
        if (cur.error || prev.error) {
          // قراءة فاشلة (نت/سيرفر): مانكمّلش بسجل فاضي ولا رصيد افتتاحي صفر - نعيد المحاولة بعد شوية والشاشة فاضلة على "جاري التحميل"
          showToast("⚠ تعذر تحميل اليومية (مشكلة اتصال) - بنعيد المحاولة تلقائيًا");
          setTimeout(() => { if (!cancelled) setRefreshKey((k) => k + 1); }, 5000);
          return;
        }
        let rec = cur.data;
        if (!rec) {
          const fresh = freshShiftRecord(day, sk, profile.name, profile.username, rooms, prev.data?.cash || undefined, prev.data?.method || undefined);
          const created = await createShiftRecord(fresh);
          if (created.data) rec = created.data;
          else {
            // فشل الإنشاء (نت، أو جهاز تاني عمله في نفس اللحظة): نقرا الموجود بدل ما نكمّل على سجل محلي من غير updatedAt وتفشل كل حفظة بعده
            const again = await getShiftRecordStrict(day, sk);
            if (again.data) rec = again.data;
            else {
              showToast("⚠ تعذر إنشاء يومية الشيفت (مشكلة اتصال) - بنعيد المحاولة تلقائيًا");
              setTimeout(() => { if (!cancelled) setRefreshKey((k) => k + 1); }, 5000);
              return;
            }
          }
        }
        // انتهى هامش الأوفر تايم (ساعتين بعد نهاية معاد الشيفت) ولسه مقفول
        // لحد دلوقتي - نقفله تلقائيًا بنفس بيانات لحظة الدخول دي، عشان الشيفت
        // ميفضلش مفتوح وبيعطّل تقرير النهارده، ومديرة الحجوزات/المدير العام
        // يقدروا يفتحوه تاني من هنا لو الموظف لسه محتاج يكمل فيه.
        if (rec && !rec.closed && !isShiftActiveNow(sk)) {
          const t = computeShiftTotals(rec);
          const autoClosed = { ...rec, closed: true, closedBy: `${rec.staffName} (إقفال تلقائي - انتهى هامش الأوفر تايم)`, closedAt: Date.now(), ...t };
          const res = await updateShiftRecordIfUnchanged(day, sk, rec.updatedAt, autoClosed);
          if (res.data) { rec = res.data; onLog(`إقفال تلقائي لشيفت ${SHIFTS.find((s) => s.key === sk)?.label} ليوم ${day} بعد انتهاء هامش الأوفر تايم (${SHIFT_OVERTIME_GRACE_HOURS} ساعة)`); }
        }
        if (cancelled) return;
        setMyShiftKey(sk); setRecord(rec); setPrevClosing(prev.data?.cash || null); setPrevMethodClosing(prev.data?.method || null);
      } else { setMyShiftKey(null); setRecord(null); }
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // ملحوظة: عمدًا من غير dataVersion هنا - الشاشة دي بتحدّث نفسها من ردّ
    // كل حفظة مباشرة، وإضافة dataVersion كانت بتخلي كل كتابة تعمل تحميل
    // كامل من جديد فوق نفسها (ده كان سبب مشكلة "العداد بيهيس").
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, refreshKey]);

  // تحديث لحظي لشيفتي المفتوح: لو حد (مدير الحجوزات/المدير العام) فتح الشيفت
  // أو قفله، أو اتسجّل عليه تحصيل/رد من جهاز تاني - الشاشة تتحدث لوحدها من
  // غير ريفرش. بنتجاهل النتيجة لو فيه كتابة معلّقة من الموظف نفسه، أو لو
  // النسخة اللي رجعت مش أحدث من اللي معروضة (صدى حفظته هو نفسه) - ده نفس
  // سبب إن اليومية كانت مستثناة من الـ realtime زمان ("العداد بيهيس")، دلوقتي
  // محلولة بالمقارنة دي بدل الاستثناء الكامل.
  useEffect(() => {
    if (mode !== "live" || !myShiftKey) return undefined;
    let cancelled = false;
    (async () => {
      const fresh = await getShiftRecord(today, myShiftKey);
      if (cancelled || !fresh || pendingRef.current) return;
      setRecord((cur) => (cur && fresh.updatedAt && cur.updatedAt && new Date(fresh.updatedAt) > new Date(cur.updatedAt) ? fresh : cur));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion]);

  async function reloadStaffEntries() { const r = await listStaffCafeteria(); if (r) setStaffEntries(r); }
  useEffect(() => { reloadStaffEntries(); }, [dataVersion, refreshKey]);

  // لو فيه تعديل لسه ماتبعتش للسيرفر (الـ debounce) والموظف قفل التاب أو عمل
  // ريفرش، المتصفح بيحذّره بدل ما التعديل يضيع من غير ما يحس.
  useEffect(() => {
    const warn = (e) => { if (pendingRef.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  useEffect(() => {
    if (mode !== "history") return;
    let cancelled = false;
    (async () => { const r = await getShiftRecord(histDate, histShift); if (!cancelled) setHistRecord(r); })();
    return () => { cancelled = true; };
  }, [mode, histDate, histShift, dataVersion]);

  // عهدة الشيفت اللي قبله: لو الشيفت اللي قبله ماتفتحش خالص بنرجع لأقرب شيفت قبله (لحد ٣) اتقفل بعهدة؛ لو لقينا شيفت مفتوح
  // مانكمّلش رجوع (بيتقفل تلقائيًا وعهدته بتتنقل). بترجّع { data } أو { error } لو أي قراءة فشلت.
  async function getPrevShiftClosing(date, shiftKey) {
    let cursor = { date, shiftKey };
    for (let i = 0; i < 3; i++) {
      cursor = prevShiftOf(cursor.date, cursor.shiftKey);
      const r = await getShiftRecordStrict(cursor.date, cursor.shiftKey);
      if (r.error) return { error: r.error };
      if (!r.data) continue;
      return r.data.closed ? { data: { cash: r.data.closingCash, method: r.data.methodClosing } } : { data: null };
    }
    return { data: null };
  }

  async function claimShift(shiftKey) { return guarded("ledger-claimShift", () => claimShiftInner(shiftKey)); }
  async function claimShiftInner(shiftKey) {
    if (shiftKey !== defaultShiftForNow()) { showToast("الشيفت ده لسه مش في ميعاده"); return; }
    const res = await claimShiftRow(today, shiftKey, profile.username, profile.name);
    if (res.conflict) { showToast("حد تاني اختار نفس الشيفت في نفس اللحظة بالظبط - اختار شيفت تاني"); setRefreshKey((k) => k + 1); return; }
    if (res.error) { showToast(res.error); return; }
    onLog(`${profile.name} اختار ${SHIFTS.find((s) => s.key === shiftKey)?.label} ليوم ${today}`);
    // الموظف الجديد بدأ شيفته: الشيفت اللي قبله لو لسه مفتوح (حتى لو الأوفر
    // تايم ماخلصش) بيتقفل تلقائيًا بنفس بياناته، وعهدته بتتنقل للشيفت الجديد.
    const prev = prevShiftOf(today, shiftKey);
    const prevRec = await getShiftRecord(prev.date, prev.shiftKey);
    if (prevRec && !prevRec.closed) {
      const t = computeShiftTotals(prevRec);
      const closedPrev = { ...prevRec, closed: true, closedBy: `${prevRec.staffName} (إقفال تلقائي - ${profile.name} بدأ الشيفت التالي)`, closedAt: Date.now(), ...t };
      const r = await updateShiftRecordIfUnchanged(prev.date, prev.shiftKey, prevRec.updatedAt, closedPrev);
      if (r.data) onLog(`إقفال تلقائي لشيفت ${SHIFTS.find((s) => s.key === prev.shiftKey)?.label} ليوم ${prev.date} لأن ${profile.name} بدأ الشيفت التالي`);
      else showToast("⚠ الشيفت اللي قبلك لسه مفتوح وماتقفلش تلقائيًا - خليه يقفله أو مدير الحجوزات/المدير العام يقفله");
    }
    setRefreshKey((k) => k + 1);
  }

  // بتحدّث الشاشة فورًا (استجابة سريعة أثناء الكتابة)، لكن بتستنى شوية قبل
  // ما تبعت للسيرفر فعليًا - فكتابة رقم من 3 خانات بتبعت مرة واحدة بس مش 3.
  async function flushPending() {
    const toSave = pendingRef.current;
    const expected = baseUpdatedAtRef.current;
    pendingRef.current = null; baseUpdatedAtRef.current = null;
    if (!toSave) { window.__calmaPendingWrites = false; return; }
    const baseRec = baseRecordRef.current; baseRecordRef.current = null;
    let res = await updateShiftRecordIfUnchanged(today, myShiftKey, expected, toSave);
    // تعارض (رد فلوس من مدير الحجوزات / تحصيل من شاشة تانية نزل على نفس السجل):
    // بنطبّق بس اللي كتبه الموظف فعلاً فوق آخر نسخة من السيرفر ونعيد المحاولة.
    for (let i = 0; res.conflict && i < 3; i++) {
      const fresh = await getShiftRecord(today, myShiftKey);
      if (!fresh || fresh.closed) break;
      res = await updateShiftRecordIfUnchanged(today, myShiftKey, fresh.updatedAt, rebaseShiftRecord(baseRec || toSave, toSave, fresh));
    }
    // لو الموظف كتب حاجة جديدة وقت ما الحفظة دي كانت بتتبعت، التعديل الجديد
    // لسه معلّق فعلاً - ماينفعش نعتبر مفيش كتابات معلّقة (انظر main.jsx).
    window.__calmaPendingWrites = !!pendingRef.current;
    if (res.conflict) { showToast("⚠ فيه تعديل حصل من مكان تاني على نفس الشيفت - جاري تحديث البيانات"); setRefreshKey((k) => k + 1); return; }
    if (res.error) {
      // فشل مؤقت (نت/سيرفر): الكتابة ماتتبخرش - بنرجّعها معلّقة ونعيد المحاولة كل ٥ ثواني لحد ما تتحفظ
      if (!pendingRef.current) { pendingRef.current = toSave; baseUpdatedAtRef.current = expected; baseRecordRef.current = baseRec; }
      window.__calmaPendingWrites = true;
      retryRef.current += 1;
      if (retryRef.current <= 6) {
        showToast("⚠ تعذر حفظ اليومية (" + res.error + ") - بنعيد المحاولة تلقائيًا ومتقفلش الصفحة");
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(flushPending, 5000);
      } else showToast("⚠ اليومية لسه ماتحفظتش بعد كذا محاولة (" + res.error + ") - اتأكد من الاتصال واكتب أي خانة تاني عشان نحاول، وماتقفلش الصفحة");
      return;
    }
    // الموظف كتب حاجة جديدة وقت ما الحفظة دي كانت بتتبعت: ماينفعش نكتب نسخة السيرفر فوق اللي كتبه
    // (كانت بتخلّي الخانة تهيس وتضيع كتابته) - بنحدّث بس "نسخة الأساس" عشان الحفظة الجاية
    // ماتتعارضش مع اللي لسه اتحفظ.
    retryRef.current = 0;
    if (pendingRef.current) {
      baseUpdatedAtRef.current = res.data.updatedAt;
      baseRecordRef.current = res.data;
      setRecord((cur) => (cur ? { ...cur, updatedAt: res.data.updatedAt } : cur));
      return;
    }
    setRecord(res.data);
  }
  function persist(next, { silent, immediate } = {}) {
    if (!pendingRef.current) { baseUpdatedAtRef.current = record.updatedAt; baseRecordRef.current = record; }
    pendingRef.current = next;
    window.__calmaPendingWrites = true; // main.jsx بيستنى قبل ما يطبّق تحديث نسخة جديدة وفيه كتابة لسه ما اتبعتتش
    setRecord(next);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (immediate) { flushPending(); if (!silent) showToast("تم الحفظ"); return; }
    debounceTimer.current = setTimeout(flushPending, 700);
  }
  // بيبعت أي كتابة معلّقة فورًا (قبل ما شاشة تانية تكتب على نفس السجل)
  async function flushNow() { if (debounceTimer.current) clearTimeout(debounceTimer.current); await flushPending(); }
  // الخروج أو الانتقال لتبويب تاني: أي كتابة معلّقة بتتبعت قبل ما الشاشة تتشال (الجلسة لسه شغّالة وقتها)
  flushLatest.current = flushNow;
  useEffect(() => {
    if (mode !== "live") return undefined;
    window.__calmaFlushLedger = () => flushLatest.current && flushLatest.current();
    return () => {
      window.__calmaFlushLedger = null;
      if (pendingRef.current && flushLatest.current) flushLatest.current();
    };
  }, [mode]);
  // بعد عملية ذرية على السيرفر (كافيتيريا استاف): نجيب السجل الجديد، ولو الموظف كتب حاجة في الأثناء نطبّقها فوقه
  async function reloadRecord() {
    const fresh = await getShiftRecord(today, myShiftKey);
    if (!fresh) return;
    if (pendingRef.current) {
      const merged = rebaseShiftRecord(baseRecordRef.current || record, pendingRef.current, fresh);
      baseUpdatedAtRef.current = fresh.updatedAt; baseRecordRef.current = fresh;
      pendingRef.current = merged; setRecord(merged);
    } else setRecord(fresh);
  }
  function updateRow(idx, patch) { const rows = record.rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)); persist({ ...record, rows }, { silent: true }); }
  function updateHotelRow(idx, patch) { const hotelRows = hotelRowsOf(record).map((r, i) => (i === idx ? { ...r, ...patch } : r)); persist({ ...record, hotelRows }, { silent: true }); }
  function addHotelRow() { persist({ ...record, hotelRows: [...hotelRowsOf(record), emptyLedgerRow(HOTEL_ROW_LABEL)] }, { silent: true, immediate: true }); }
  function removeHotelRow(idx) { persist({ ...record, hotelRows: hotelRowsOf(record).filter((_, i) => i !== idx) }, { silent: true, immediate: true }); }
  function updateCafeteria(patch) { persist({ ...record, cafeteria: { ...record.cafeteria, ...patch } }, { silent: true }); }
  function updateHandover(cur, val) { persist({ ...record, handover: { ...record.handover, [cur]: Number(val) || 0 } }, { silent: true }); }
  function addCurrency(cur) { if (!cur || record.handover?.[cur] != null) return; persist({ ...record, handover: { ...record.handover, [cur]: 0 } }, { silent: true, immediate: true }); }
  function updateMethodHandover(method, cur, val) { persist({ ...record, methodHandover: { ...record.methodHandover, [method]: { ...(record.methodHandover?.[method] || {}), [cur]: Number(val) || 0 } } }, { silent: true }); }
  function addMethodTracking(method, cur) {
    if (!method || !cur || record.methodHandover?.[method]?.[cur] != null) return;
    persist({ ...record, methodHandover: { ...record.methodHandover, [method]: { ...(record.methodHandover?.[method] || {}), [cur]: 0 } } }, { silent: true, immediate: true });
  }

  const totals = record ? computeShiftTotals(record) : null;
  // الشيفت يتقفل (يبقى غير قابل للتعديل من موظف الشيفت) لو اتقفل فعليًا، أو
  // لو انتهى هامش الأوفر تايم بتاعه (ساعتين بعد نهاية معاده) - في الحالة
  // التانية هيتقفل تلقائيًا فعليًا عند أول تحميل للشاشة (انظر الإيفكت فوق).
  const locked = !record || record.closed || !perms.editLedger || (!!myShiftKey && !isShiftActiveNow(myShiftKey));

  async function closeShift() { return guarded("ledger-closeShift", () => closeShiftInner()); }
  async function closeShiftInner() {
    // مفيش إقفال وفيه تحصيل فيزا من غير آخر ٤ أرقام (أو تحويل من غير رقم) - كل عملية لازم تتتبّع
    const missing = missingPaymentDetails(pendingRef.current || record);
    if (missing.length > 0) { showToast(`مينفعش تقفل الشيفت: ${missing.slice(0, 3).map((m) => `${m.where} (${m.method})`).join("، ")}${missing.length > 3 ? ` و${missing.length - 3} كمان` : ""} من غير ${missing[0].method === "فيزا" ? "آخر 4 أرقام الكارت" : "رقم التليفون"} - اكتبها في عمود تفاصيل الدفع`); return; }
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    const mineRec = pendingRef.current || record;
    let base = mineRec;
    const baseRec = pendingRef.current ? baseRecordRef.current : record;
    const expected = pendingRef.current ? baseUpdatedAtRef.current : record.updatedAt;
    pendingRef.current = null; baseUpdatedAtRef.current = null; baseRecordRef.current = null;
    window.__calmaPendingWrites = false;
    let t = computeShiftTotals(base);
    let closedRecord = { ...base, closed: true, closedBy: profile.name, closedAt: Date.now(), ...t };
    let res = await updateShiftRecordIfUnchanged(today, myShiftKey, expected, closedRecord);
    for (let i = 0; res.conflict && i < 3; i++) {
      const fresh = await getShiftRecord(today, myShiftKey);
      if (!fresh || fresh.closed) break;
      base = rebaseShiftRecord(baseRec || mineRec, mineRec, fresh);
      t = computeShiftTotals(base);
      closedRecord = { ...base, closed: true, closedBy: profile.name, closedAt: Date.now(), ...t };
      res = await updateShiftRecordIfUnchanged(today, myShiftKey, fresh.updatedAt, closedRecord);
    }
    if (res.conflict) { showToast("⚠ فيه تعديل حصل من مكان تاني - جاري تحديث البيانات، جرّب تقفل تاني"); setRefreshKey((k) => k + 1); return; }
    if (res.error) { showToast(res.error); return; }
    const summary = currencyKeysOf(t.closingCash).map((c) => `${money(t.closingCash, c)} ${c}`).join(" / ") || "0";
    onLog(`أقفل ${SHIFTS.find((s) => s.key === myShiftKey)?.label} ليوم ${today} — رصيد الخزينة ${summary}`);
    setRefreshKey((k) => k + 1);
  }

  // إعادة فتح/إقفال شيفت من وضع "استعراض شيفتات سابقة" - صلاحية مدير
  // الحجوزات/المدير العام بس (perms.reopenShift)، لحالة شيفت قفله موظف
  // بالغلط أو احتاج تصحيح بعد الإقفال (انظر قسم ١٦ في schema.sql).
  async function reopenHistoryShift() { return guarded("ledger-reopenHistoryShift", () => reopenHistoryShiftInner()); }
  async function reopenHistoryShiftInner() {
    if (!histRecord) return;
    const res = await reopenShiftRecord(histDate, histShift, histRecord.updatedAt, histRecord);
    if (res.conflict) { showToast("⚠ فيه تعديل حصل من مكان تاني على نفس الشيفت - جاري تحديث البيانات"); setHistRecord(await getShiftRecord(histDate, histShift)); return; }
    if (res.error) { showToast(res.error); return; }
    setHistRecord(res.data);
    onLog(`إعادة فتح شيفت ${SHIFTS.find((s) => s.key === histShift)?.label} ليوم ${histDate} (كان مقفول بواسطة ${histRecord.closedBy || "—"})`);
    showToast(staffCanContinue(histDate, histShift)
      ? "تم إعادة فتح الشيفت - الموظف يقدر يكمل فيه تاني"
      : "تم إعادة فتح الشيفت، لكن وقته (وهامش الأوفر تايم) انتهى - هيتقفل تاني تلقائيًا أول ما الموظف يفتح اليومية. لتصحيح الأرقام: المدير العام أو الحسابات يعدّلوا اليومية المقفولة مباشرة");
  }
  // الموظف يقدر يكمل في شيفت اتفتح تاني بس لو الشيفت لسه في وقته (أو في هامش الأوفر تايم)؛ غير كده بيتقفل تلقائيًا عند فتح اليومية
  function staffCanContinue(date, shiftKey) { return date === shiftDayNow() && isShiftActiveNow(shiftKey); }

  // سجل الشيفت اللي هيظهر فعليًا في ترويسة الطباعة - شيفتي النهارده في وضع
  // "live"، أو الشيفت المحدد في وضع "history".
  const printRecord = mode === "live" ? record : histRecord;

  return (
    <div className="cx-page">
      <div className="cx-no-print" style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {perms.editLedger && <button className={"cx-btn " + (mode === "live" ? "cx-btn-gold" : "cx-btn-outline")} onClick={() => setMode("live")}>شيفتي النهارده</button>}
        <button className={"cx-btn " + (mode === "history" ? "cx-btn-gold" : "cx-btn-outline")} onClick={() => setMode("history")}><History size={14} /> استعراض شيفتات سابقة (قراءة فقط)</button>
        {printRecord && <button className="cx-btn cx-btn-outline" onClick={() => window.print()}><Printer size={13} /> طباعة اليومية</button>}
      </div>

      {/* ترويسة الطباعة - بتظهر بس في الورقة المطبوعة، بنفس شكل تقرير
          التقارير بالظبط (الشعار واسم الفندق وتفاصيل الشيفت ومين طبعها). */}
      {printRecord && (
        <div className="cx-print-only cx-print-header">
          <div className="cx-print-head-row">
            <div className="cx-print-brand">
              <Logo size={30} />
              {HOTEL_NAME && <div className="cx-print-hotel-name">{HOTEL_NAME}</div>}
            </div>
            <div className="cx-print-meta">
              <div className="cx-print-title">يومية شيفت</div>
              <div>{arabicWeekday(printRecord.date)} <bdi dir="ltr" className="cx-rn">{printRecord.date}</bdi> · {SHIFTS.find((s) => s.key === printRecord.shiftKey)?.label} ({printRecord.staffName})</div>
              <div>تاريخ الإصدار: {arabicDateLong(todayStr())}{profile?.name ? ` · أُعِد بواسطة: ${profile.name}` : ""}</div>
            </div>
          </div>
          <div className="cx-print-rule" />
        </div>
      )}

      {mode === "live" ? (
        loading ? <div style={{ padding: "3rem 1rem", textAlign: "center", color: "var(--muted)" }}>جارِ التحميل...</div> : !myShiftKey ? (
          <ShiftClaimPicker date={today} claims={claims || {}} onClaim={claimShift} />
        ) : (
          <>
            <div className="cx-card" style={{ padding: "14px 16px", marginBottom: 14, display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center", background: "linear-gradient(90deg,#FFFFFF,#FBF6E9)" }}>
              <span className="cx-ico ic-gold" aria-hidden="true"><CalendarClock size={20} /></span>
              <div><label style={{ fontSize: 12.5, color: "var(--muted)", display: "block" }}>التاريخ</label><div style={{ fontWeight: 700, fontSize: 14, padding: "6px 2px" }}>{arabicWeekday(today)} · <bdi dir="ltr" className="cx-rn">{today}</bdi></div></div>
              <div><label style={{ fontSize: 12.5, color: "var(--muted)", display: "block" }}>شيفتك</label><div style={{ fontWeight: 700, fontSize: 14, padding: "6px 2px" }}>{SHIFTS.find((s) => s.key === myShiftKey)?.label} ({SHIFTS.find((s) => s.key === myShiftKey)?.time})</div></div>
              <div><label style={{ fontSize: 12.5, color: "var(--muted)", display: "block" }}>الاسم</label><div style={{ fontSize: 14, padding: "6px 2px" }}>{record.staffName}</div></div>
              <div>{record.closed ? <span className="cx-pill" style={{ background: "#EFEEEC", color: "#8A8577" }}><Lock size={11} style={{ verticalAlign: -1 }} /> مقفول</span> : <span className="cx-pill" style={{ background: "#EAF2EC", color: "var(--sage)" }}><Unlock size={11} style={{ verticalAlign: -1 }} /> شيفتك الوحيد المتاح ليك النهارده</span>}</div>
            </div>
            <LedgerBar sections={LEDGER_SECTIONS} totals={totals} record={record} canClose={!record.closed && perms.closeShift} onClose={closeShift} />
            <div id="led-rooms" className="cx-anchor"><LedgerTable record={record} rooms={rooms} locked={locked} onUpdateRow={updateRow} /></div>
            <div id="led-cafe" className="cx-anchor">
            <CafeteriaSection record={record} rooms={rooms} bookings={bookings} onUpdateCafeteria={updateCafeteria} locked={locked} readOnly={!perms.editLedger} profile={profile} profiles={profiles} staffEntries={staffEntries} onReload={reloadStaffEntries} flushNow={flushNow} reloadRecord={reloadRecord} onLog={onLog} showToast={showToast} />
            </div>
            <div id="led-hotel" className="cx-anchor"><HotelRowsTable record={record} locked={locked} onUpdateRow={updateHotelRow} onAddRow={addHotelRow} onRemoveRow={removeHotelRow} /></div>
            <div id="led-notes" className="cx-card cx-anchor" style={{ marginTop: 14, padding: 14 }}>
              <SectionHead icon={MessageSquareText} tone="amber" title="ملاحظات الشيفت" />
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <input type="checkbox" checked={record.flagged} disabled={locked} onChange={(e) => persist({ ...record, flagged: e.target.checked }, { immediate: true })} />
                <span style={{ fontSize: 14, fontWeight: 700, color: record.flagged ? "var(--rust)" : "var(--text)" }}><AlertTriangle size={13} style={{ verticalAlign: -2 }} /> فيه مشكلة تحتاج متابعة من المديرة/المدير العام</span>
              </div>
              <textarea className="cx-textarea" rows={2} placeholder="ملاحظات الشيفت" disabled={locked} value={record.shiftNotes} onChange={(e) => persist({ ...record, shiftNotes: e.target.value }, { silent: true })} />
            </div>
            <div id="led-cash" className="cx-anchor"><ShiftSummaryFooter record={record} totals={totals} locked={locked} onChangeHandover={updateHandover} onAddCurrency={addCurrency} prevClosing={prevClosing} onChangeMethodHandover={updateMethodHandover} onAddMethodTracking={addMethodTracking} prevMethodClosing={prevMethodClosing} /></div>
            <div className="cx-no-print" style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {!record.closed && perms.closeShift && <span className="cx-hint">راجع الخزينة فوق، وبعدين اضغط "إقفال الشيفت" من الشريط اللي فوق.</span>}
              {record.closed && <span style={{ fontSize: 13, color: "var(--muted)" }}>أُقفل بواسطة {record.closedBy} في {new Date(record.closedAt).toLocaleString("ar-EG-u-nu-latn")} — لو محتاج تصحّح حاجة كلّم مدير الحجوزات أو المدير العام يفتحوه تاني</span>}
            </div>
            <LedgerPrintFooter />
          </>
        )
      ) : (
        <>
          <div className="cx-card cx-no-print" style={{ padding: 12, marginBottom: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div><label style={{ fontSize: 12.5, color: "var(--muted)", display: "block" }}>التاريخ</label><input className="cx-input" type="date" value={histDate} onChange={(e) => setHistDate(e.target.value)} style={{ width: 150 }} /></div>
            <div className="cx-seg" role="group" aria-label="اختار الشيفت" style={{ alignSelf: "flex-end", maxWidth: "100%" }}>{SHIFTS.map((s) => <button key={s.key} aria-pressed={histShift === s.key} onClick={() => setHistShift(s.key)} className={"cx-btn " + (histShift === s.key ? "cx-btn-gold" : "cx-btn-outline")} style={{ fontSize: 13 }}>{s.label}</button>)}</div>
          </div>
          {!histRecord ? <EmptyState icon={FileX} title="لا يوجد سجل لهذا الشيفت" hint="محدش فتح يومية للشيفت ده في التاريخ ده - اختار تاريخ أو شيفت تاني." /> : (
            <>
              {perms.reopenShift && (
                <div className="cx-card cx-no-print" style={{ padding: 10, marginBottom: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {histRecord.closed ? (
                    <>
                      <span style={{ fontSize: 13, color: "var(--muted)" }}><Lock size={12} style={{ verticalAlign: -1 }} /> مقفول بواسطة {histRecord.closedBy} في {histRecord.closedAt ? new Date(histRecord.closedAt).toLocaleString("ar-EG-u-nu-latn") : "—"}</span>
                      <button className="cx-btn cx-btn-outline" style={{ fontSize: 13 }} onClick={reopenHistoryShift}><LockOpen size={13} /> إعادة فتح الشيفت</button>
                    </>
                  ) : (
                    <span style={{ fontSize: 13, color: "var(--sage)" }}><Unlock size={12} style={{ verticalAlign: -1 }} /> {staffCanContinue(histDate, histShift) ? "الشيفت ده مفتوح لسه (أو اتفتح تاني) - الموظف يقدر يكمل فيه" : "الشيفت ده مفتوح لكن وقته انتهى - هيتقفل تلقائيًا أول ما الموظف يفتح اليومية"}</span>
                  )}
                </div>
              )}
              <LedgerTable record={histRecord} rooms={rooms} locked={true} onUpdateRow={() => {}} />
              <CafeteriaSection record={histRecord} rooms={rooms} bookings={bookings} onUpdateCafeteria={() => {}} locked={true} readOnly={true} profile={profile} profiles={profiles} staffEntries={staffEntries} onReload={reloadStaffEntries} flushNow={async () => {}} reloadRecord={async () => {}} onLog={onLog} showToast={showToast} />
              {(histRecord.hotelRows || []).some((r) => (Number(r.expenseAmt) || 0) !== 0 || (Number(r.collectionAmt) || 0) !== 0 || r.expenseDesc || r.collectionDesc) && <HotelRowsTable record={histRecord} locked={true} onUpdateRow={() => {}} onAddRow={() => {}} onRemoveRow={() => {}} />}
              <ShiftSummaryFooter record={histRecord} totals={computeShiftTotals(histRecord)} locked={true} onChangeHandover={() => {}} onAddCurrency={() => {}} prevClosing={null} onChangeMethodHandover={() => {}} onAddMethodTracking={() => {}} prevMethodClosing={null} />
              {histRecord.shiftNotes && <div className="cx-card" style={{ marginTop: 10, padding: 10, fontSize: 13.5 }}>ملاحظات الشيفت: {histRecord.shiftNotes}</div>}
              <LedgerPrintFooter />
            </>
          )}
        </>
      )}
    </div>
  );
}

const LEDGER_SECTIONS = [["led-rooms", "الغرف", DoorOpen], ["led-cafe", "الكافيتيريا", Coffee], ["led-hotel", "مصاريف الفندق", Building2], ["led-notes", "الملاحظات", MessageSquareText], ["led-cash", "الخزينة", Landmark]];

/* شريط ثابت فوق اليومية: تنقّل سريع بين الأقسام (بيعلّم القسم اللي انت فيه) + رصيد الخزينة لحظيًا + زرار الإقفال */
function LedgerBar({ sections, totals, record, canClose, onClose }) {
  const [active, setActive] = useState(sections[0][0]);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver((es) => {
      const vis = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) setActive(vis.target.id);
    }, { rootMargin: "-140px 0px -55% 0px" });
    sections.forEach(([id]) => { const el = document.getElementById(id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, [sections]);
  const cash = currencyKeysOf(totals?.closingCash).map((c) => `${money(totals.closingCash, c)} ${c}`).join(" · ") || "0";
  return (
    <div className="cx-ledbar cx-no-print">
      <nav aria-label="أقسام اليومية" className="cx-ledbar-nav">
        {sections.map(([id, label, Icon]) => (
          <a key={id} href={"#" + id} className={active === id ? "on" : ""} onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }); setActive(id); }}>
            <Icon size={15} aria-hidden="true" />{label}
          </a>
        ))}
      </nav>
      <div className="cx-ledbar-end">
        <div className="cx-ledbar-cash"><span>رصيد الخزينة</span><b>{cash}</b></div>
        {canClose && <button className="cx-btn cx-btn-gold" onClick={onClose}><Lock size={15} /> إقفال الشيفت</button>}
        {record.closed && <span className="cx-pill" style={{ background: "#EFEEEC", color: "#6E685D" }}><Lock size={12} aria-hidden="true" /> الشيفت مقفول</span>}
      </div>
    </div>
  );
}

function LedgerPrintFooter() {
  return (
    <div className="cx-print-only cx-print-footer">
      <div className="cx-print-sign">
        <span>توقيع الموظف المسؤول عن الشيفت: ______________________</span>
        <span>الختم:</span>
      </div>
      <div className="cx-print-generated">تم إصدار هذا المستند أوتوماتيكيًا من نظام إدارة الفندق Calma</div>
    </div>
  );
}
