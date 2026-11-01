import { useState } from "react";
import { Building2, Plus, Check, DoorOpen } from "lucide-react";
import { SectionHead } from "./shared";
import { createHotel, updateHotel, addHotelRoom, renameHotelRoom } from "../data/hotels";
import { hotelAccent } from "../domain/constants";

/* إدارة الفنادق والغرف - المدير العام بس: تغيير اسم فندق أو بادئة كود الحجز، إيقاف/تفعيل فندق، إضافة فندق جديد،
   إضافة غرفة وتغيير اسمها. مفيش مسح (عشان الحجوزات واليوميات القديمة تفضل سليمة). */
export function HotelsAdmin({ hotels, rooms, onChanged, onLog, showToast }) {
  const [openId, setOpenId] = useState(null);
  const [form, setForm] = useState(null);                 // فندق جديد
  const [roomForm, setRoomForm] = useState({ number: "", name: "" });
  const [edits, setEdits] = useState({});                 // تعديل اسم فندق/بادئة قبل الحفظ
  const [roomNames, setRoomNames] = useState({});
  const [busy, setBusy] = useState(false);
  async function run(fn) { if (busy) return; setBusy(true); try { await fn(); } finally { setBusy(false); } }

  const edit = (h) => ({ name: h.name, prefix: h.prefix, ...(edits[h.id] || {}) });
  const dirty = (h) => { const e = edit(h); return e.name !== h.name || e.prefix !== h.prefix; };

  async function saveHotel(h) {
    const e = edit(h);
    const name = e.name.trim();
    if (name.length < 2) { showToast("اكتب اسم الفندق"); return; }
    if (!/^[A-Za-z]{1,2}$/.test(e.prefix.trim())) { showToast("بادئة كود الحجز: حرف أو حرفين إنجليزي"); return; }
    const res = await updateHotel(h.id, { name, prefix: e.prefix.trim() });
    if (res.error) { showToast(res.error); return; }
    onLog(`تعديل بيانات فندق ${h.name}${name !== h.name ? ` (الاسم الجديد: ${name})` : ""}`);
    setEdits((p) => { const n = { ...p }; delete n[h.id]; return n; });
    showToast("تم حفظ بيانات الفندق"); onChanged();
  }
  async function toggleHotel(h) {
    if (h.active && hotels.filter((x) => x.active).length <= 1) { showToast("لازم يفضل فندق واحد فعّال على الأقل"); return; }
    const res = await updateHotel(h.id, { active: !h.active });
    if (res.error) { showToast(res.error); return; }
    onLog(`${h.active ? "إيقاف" : "تفعيل"} فندق ${h.name}`); showToast(h.active ? "الفندق اتوقف (بياناته محفوظة)" : "الفندق اتفعّل"); onChanged();
  }
  async function saveNewHotel() {
    const res = await createHotel({ name: form.name.trim(), shortName: form.short.trim(), prefix: form.prefix.trim() });
    if (res.error) { showToast(res.error); return; }
    onLog(`إضافة فندق جديد: ${form.name.trim()}`); setForm(null); showToast("تم إضافة الفندق - ضيف غرفه من هنا"); setOpenId(res.id); onChanged();
  }
  async function saveRoom(h) {
    const res = await addHotelRoom(h.id, roomForm.number, roomForm.name.trim());
    if (res.error) { showToast(res.error); return; }
    onLog(`إضافة غرفة ${roomForm.number} لفندق ${h.name}`); setRoomForm({ number: "", name: "" }); showToast("تم إضافة الغرفة"); onChanged();
  }
  async function saveRoomName(r) {
    const nm = (roomNames[r.number] ?? r.name).trim();
    const res = await renameHotelRoom(r.number, nm);
    if (res.error) { showToast(res.error); return; }
    onLog(`تغيير اسم غرفة ${r.number} إلى: ${nm}`); setRoomNames((p) => { const n = { ...p }; delete n[r.number]; return n; }); showToast("تم تغيير اسم الغرفة"); onChanged();
  }

  return (
    <div className="cx-card" data-testid="hotels-admin" style={{ padding: 12, marginBottom: 14 }}>
      <SectionHead icon={Building2} tone="teal" title="إدارة الفنادق والغرف" hint="أسماء الفنادق، بادئة كود الحجز، إضافة فندق أو غرفة (المدير العام بس - مفيش مسح عشان الحجوزات القديمة تفضل سليمة)" />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {hotels.map((h) => {
          const e = edit(h); const open = openId === h.id; const hr = rooms.filter((r) => (r.hotelId ?? 1) === h.id);
          return (
            <div key={h.id} data-testid={"hotel-admin-" + h.id} style={{ border: "1px solid var(--hair)", borderRadius: 12, padding: 10, opacity: h.active ? 1 : 0.6, borderInlineStart: `5px solid ${hotelAccent(hotels, h.id)}` }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div><label style={{ fontSize: 12.5, color: "var(--muted)", display: "block" }}>اسم الفندق</label><input className="cx-input" aria-label={"اسم الفندق " + h.id} style={{ width: 200 }} value={e.name} onChange={(ev) => setEdits({ ...edits, [h.id]: { ...e, name: ev.target.value } })} /></div>
                <div><label style={{ fontSize: 12.5, color: "var(--muted)", display: "block" }}>بادئة كود الحجز</label><input className="cx-input" aria-label={"بادئة الكود " + h.id} dir="ltr" maxLength={2} style={{ width: 80 }} value={e.prefix} onChange={(ev) => setEdits({ ...edits, [h.id]: { ...e, prefix: ev.target.value.toUpperCase() } })} /></div>
                <button className="cx-btn cx-btn-gold" disabled={busy || !dirty(h)} onClick={() => run(() => saveHotel(h))}><Check size={13} /> تثبيت</button>
                <button className="cx-btn cx-btn-outline" disabled={busy} onClick={() => run(() => toggleHotel(h))}>{h.active ? "إيقاف" : "تفعيل"}</button>
                <button className="cx-btn cx-btn-outline" data-testid={"hotel-rooms-toggle-" + h.id} onClick={() => setOpenId(open ? null : h.id)}><DoorOpen size={13} /> الغرف ({hr.length})</button>
              </div>
              {open && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 6 }}>
                    {hr.map((r) => (
                      <div key={r.number} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ fontWeight: 700, minWidth: 38 }}>{r.number}</span>
                        <input className="cx-input" aria-label={"اسم غرفة " + r.number} style={{ flex: 1, minWidth: 0 }} value={roomNames[r.number] ?? r.name} onChange={(ev) => setRoomNames({ ...roomNames, [r.number]: ev.target.value })} />
                        <button className="cx-btn cx-btn-outline" aria-label={"تثبيت اسم غرفة " + r.number} disabled={busy || (roomNames[r.number] ?? r.name) === r.name} onClick={() => run(() => saveRoomName(r))}><Check size={13} /></button>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 10 }}>
                    <div><label style={{ fontSize: 12.5, color: "var(--muted)", display: "block" }}>رقم غرفة جديدة</label><input className="cx-input" data-testid="new-room-number" type="number" style={{ width: 120 }} value={roomForm.number} onChange={(ev) => setRoomForm({ ...roomForm, number: ev.target.value })} /></div>
                    <div><label style={{ fontSize: 12.5, color: "var(--muted)", display: "block" }}>اسمها (اختياري)</label><input className="cx-input" data-testid="new-room-name" style={{ width: 180 }} value={roomForm.name} onChange={(ev) => setRoomForm({ ...roomForm, name: ev.target.value })} /></div>
                    <button className="cx-btn cx-btn-gold" data-testid="new-room-save" disabled={busy || !roomForm.number} onClick={() => run(() => saveRoom(h))}><Plus size={13} /> إضافة الغرفة</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {form ? (
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div><label style={{ fontSize: 12.5, color: "var(--muted)", display: "block" }}>اسم الفندق</label><input className="cx-input" data-testid="new-hotel-name" style={{ width: 200 }} value={form.name} onChange={(ev) => setForm({ ...form, name: ev.target.value })} /></div>
          <div><label style={{ fontSize: 12.5, color: "var(--muted)", display: "block" }}>اسم مختصر</label><input className="cx-input" style={{ width: 130 }} value={form.short} onChange={(ev) => setForm({ ...form, short: ev.target.value })} /></div>
          <div><label style={{ fontSize: 12.5, color: "var(--muted)", display: "block" }}>بادئة الكود (حرف)</label><input className="cx-input" data-testid="new-hotel-prefix" dir="ltr" maxLength={2} style={{ width: 90 }} value={form.prefix} onChange={(ev) => setForm({ ...form, prefix: ev.target.value.toUpperCase() })} /></div>
          <button className="cx-btn cx-btn-gold" data-testid="new-hotel-save" disabled={busy || form.name.trim().length < 2} onClick={() => run(saveNewHotel)}><Check size={13} /> إنشاء الفندق</button>
          <button className="cx-btn cx-btn-outline" onClick={() => setForm(null)}>إلغاء</button>
        </div>
      ) : (
        <button className="cx-btn cx-btn-outline" data-testid="new-hotel-open" style={{ marginTop: 10 }} onClick={() => setForm({ name: "", short: "", prefix: "" })}><Plus size={13} /> إضافة فندق جديد</button>
      )}
    </div>
  );
}
