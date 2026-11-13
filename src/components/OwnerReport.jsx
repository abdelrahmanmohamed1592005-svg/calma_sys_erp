import { useEffect, useMemo, useRef, useState } from "react";
import { Send, Printer, Download, X } from "lucide-react";
import { buildOwnerReport, bookingsForDay } from "../domain/ownerReport";
import { arabicWeekday } from "../domain/dates";
import { getShiftRecordsInRange, getPaymentsIndex } from "../data/shifts";
import { sheetToPngFile, downloadFile } from "../lib/sheetImage";
import { useHotel } from "../lib/hotelContext";
import { guarded } from "../lib/busy";

/*
  تقرير الأونر: نفس ورق اليومية (كشف الغرف + ورقة كل شيفت اتفتح في اليوم) طالع من السيستم.
  زرار "إرسال للأونر" بيجهّز الورق صور وبيفتح المشاركة (واتساب)؛ لو الجهاز مابيدعمش المشاركة بالصور بتتحمّل على الجهاز.
*/
const lines = (v) => (Array.isArray(v) ? v : v ? [v] : []);

function Sheet({ sheet }) {
  return (
    <section className="cx-or-sheet" data-testid={"owner-sheet-" + sheet.id}>
      <div className="cx-or-top">
        <h3>{sheet.title}</h3>
        {sheet.hotelName && <span className="cx-or-hotel">{sheet.hotelName}</span>}
      </div>
      <div className="cx-or-head">{sheet.head.map(([l, v]) => <span key={l}>{l}: <b>{v}</b></span>)}</div>
      <div className="cx-or-scroll">
        <table className="cx-or-table">
          <thead><tr>{sheet.columns.map((c) => <th key={c.key} style={{ width: (c.w / sheet.columns.reduce((s, x) => s + x.w, 0)) * 100 + "%" }}>{c.label}</th>)}</tr></thead>
          <tbody>
            {sheet.rows.map((r, i) => (
              <tr key={i} className={"t-" + (r.tone || "ok")}>
                {sheet.columns.map((c) => <td key={c.key} className={"c-" + c.key}>{lines(r.cells[c.key]).map((l, k) => <div key={k}>{l}</div>)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="cx-or-sum">{sheet.summary.map(([l, v]) => <div key={l}><dt>{l}</dt><dd>{v}</dd></div>)}</dl>
      {sheet.notes.map((n, i) => <p key={i} className="cx-or-note">{n}</p>)}
    </section>
  );
}

export function OwnerReport({ date, rooms, bookings, staffNames, onClose, onLog, showToast }) {
  const { hotel, hotelId } = useHotel();
  const [data, setData] = useState(null);   // { records, paymentsIndex } | { error }
  const [files, setFiles] = useState(null);
  const closeRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const records = await getShiftRecordsInRange(date, date, hotelId);
      if (cancelled) return;
      if (!records) { setData({ error: true }); return; }
      const dayBookings = rooms.flatMap((r) => bookingsForDay(bookings, r.number, date));
      const paymentsIndex = await getPaymentsIndex(dayBookings);
      if (!cancelled) setData({ records, paymentsIndex: paymentsIndex || new Map() });
    })();
    return () => { cancelled = true; };
    // التقرير لقطة لحظة الفتح - مش بيتحدّث وهو مفتوح
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, hotelId]);

  const sheets = useMemo(() => (data && !data.error ? buildOwnerReport({ rooms, bookings, date, records: data.records, paymentsIndex: data.paymentsIndex, hotelName: hotel.name, staffNames }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- لقطة: بتتبني مرة مع تحميل البيانات
    [data]);

  // الصور بتتجهّز أول ما التقرير يفتح، عشان ضغطة "إرسال" تفتح المشاركة فورًا (المتصفح بيرفض المشاركة لو اتأخرت عن الضغطة)
  useEffect(() => {
    if (!sheets) return undefined;
    let cancelled = false;
    setFiles(null);
    (async () => {
      const stamp = new Date().toLocaleString("ar-EG-u-nu-latn", { dateStyle: "short", timeStyle: "short" });
      try {
        const out = [];
        for (const [i, s] of sheets.entries()) out.push(await sheetToPngFile(s, `calma-${date}-${i + 1}-${s.id}.png`, { stamp }));
        if (!cancelled) setFiles(out);
      } catch { if (!cancelled) setFiles([]); }
    })();
    return () => { cancelled = true; };
  }, [sheets, date]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    document.body.classList.add("cx-or-open");
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") onCloseRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.classList.remove("cx-or-open"); window.removeEventListener("keydown", onKey); };
  }, []);

  const label = `يومية ${hotel.name} - ${arabicWeekday(date)} ${date}`;
  const noShift = sheets && sheets.length === 1;

  const send = () => guarded("owner-report-send", async () => {
    if (!files || !files.length) { showToast("تعذر تجهيز صور التقرير - استخدم طباعة / PDF"); return; }
    if (navigator.canShare && navigator.canShare({ files })) {
      try {
        await navigator.share({ files, title: label, text: label });
        onLog(`إرسال تقرير اليومية للأونر (${date})`);
        showToast("تم فتح المشاركة - اختار الأونر في واتساب");
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return;   // المستخدم قفل نافذة المشاركة
      }
    }
    files.forEach(downloadFile);
    onLog(`تحميل صور تقرير اليومية للأونر (${date})`);
    showToast(`الجهاز ده مابيدعمش المشاركة المباشرة - ${files.length} صور اتحمّلت، ابعتها للأونر واتساب`);
  });
  const download = () => { if (files && files.length) { files.forEach(downloadFile); showToast(`${files.length} صور اتحمّلت على الجهاز`); } };

  return (
    <div className="cx-or" role="dialog" aria-modal="true" aria-label="تقرير اليومية للأونر" data-testid="owner-report">
      <div className="cx-or-bar cx-no-print">
        <div className="cx-or-bar-t"><b>تقرير اليومية للأونر</b><span>{arabicWeekday(date)} · <bdi dir="ltr" className="cx-rn">{date}</bdi> · {hotel.name}</span></div>
        <div className="cx-or-bar-b">
          <button className="cx-btn cx-btn-gold" data-testid="owner-report-send" disabled={!files} onClick={send}><Send size={15} /> {files ? "إرسال للأونر (واتساب)" : "بنجهّز الصور..."}</button>
          <button className="cx-btn cx-btn-outline" data-testid="owner-report-download" disabled={!files || !files.length} onClick={download}><Download size={14} /> تحميل الصور</button>
          <button className="cx-btn cx-btn-outline" disabled={!sheets} onClick={() => window.print()}><Printer size={14} /> طباعة / PDF</button>
          <button ref={closeRef} className="cx-btn cx-btn-outline" data-testid="owner-report-close" onClick={onClose}><X size={14} /> إغلاق</button>
        </div>
      </div>
      <div className="cx-or-body">
        {!data && <div className="cx-or-msg">جارِ تجهيز التقرير...</div>}
        {data?.error && <div className="cx-or-msg">⚠ تعذر تحميل بيانات اليوم (مشكلة اتصال) - اقفل وجرّب تاني</div>}
        {noShift && <div className="cx-or-msg cx-no-print">مفيش شيفت اتفتح في اليوم ده لسه - التقرير فيه كشف الغرف بس.</div>}
        {sheets && sheets.map((s) => <Sheet key={s.id} sheet={s} />)}
      </div>
    </div>
  );
}
