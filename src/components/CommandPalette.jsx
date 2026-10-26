import { useState, useEffect, useRef, useMemo } from "react";
import { Search, CornerDownLeft, LayoutGrid, NotebookPen, CalendarCheck2, BarChart3, History, Users, DoorOpen, User } from "lucide-react";
import { TAB_LABELS } from "../domain/constants";
import { DateRange, RoomName } from "./shared";
import { computeRoomStatus, guestCodeEntries } from "../domain/bookingLogic";
import { todayStr } from "../domain/dates";

const TAB_ICONS = { board: LayoutGrid, ledger: NotebookPen, bookings: CalendarCheck2, reports: BarChart3, activity: History, users: Users };
const norm = (s) => String(s ?? "").toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").trim();

/*
  بحث سريع (Ctrl+K / ⌘K): من أي شاشة تكتب اسم نزيل أو رقم غرفة أو كود حجز/فرد أو اسم قسم
  وتروح له على طول. الأسهم للتنقل، Enter للفتح، Esc للقفل.
*/
export function CommandPalette({ open, onClose, tabs, rooms, bookings, overrides, onGoTab, onOpenRoom, onFindBooking }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  useEffect(() => { if (open) { setQ(""); setSel(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);

  const date = todayStr();
  const items = useMemo(() => {
    const nq = norm(q);
    const out = [];
    tabs.forEach((t) => { if (!nq || norm(TAB_LABELS[t]).includes(nq)) out.push({ kind: "tab", key: "t-" + t, tab: t, label: TAB_LABELS[t], sub: "قسم", Icon: TAB_ICONS[t] }); });
    if (nq) {
      rooms.filter((r) => norm(r.number).includes(nq) || norm(r.name).includes(nq)).slice(0, 6).forEach((r) => {
        const st = computeRoomStatus(r.number, bookings, overrides, date);
        out.push({ kind: "room", key: "r-" + r.number, room: r.number, label: <RoomName rooms={rooms} number={r.number} />, sub: st.guest ? `${st.label} · ${st.guest}` : st.label, Icon: DoorOpen });
      });
      bookings.filter((b) => norm(b.guestName).includes(nq) || norm(b.code).includes(nq) || norm(b.phone).includes(nq) || guestCodeEntries(b).some((g) => norm(g.code) === nq))
        .sort((a, b) => b.checkin.localeCompare(a.checkin)).slice(0, 8).forEach((b) => {
          out.push({ kind: "booking", key: "b-" + b.id, booking: b, label: b.guestName, sub: <><RoomName rooms={rooms} number={b.room} /> · <DateRange from={b.checkin} to={b.checkout} />{b.status === "ملغي" ? " · ملغي" : ""}</>, Icon: User });
        });
    }
    return out;
  }, [q, tabs, rooms, bookings, overrides, date]);

  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }, [sel]);
  if (!open) return null;

  function choose(it) {
    if (!it) return;
    onClose();
    if (it.kind === "tab") onGoTab(it.tab);
    else if (it.kind === "room") onOpenRoom(it.room);
    else if (it.kind === "booking") {
      const b = it.booking;
      const living = b.status !== "ملغي" && b.checkin <= date && date < b.checkout;
      if (living && tabs.includes("board")) onOpenRoom(b.room); else onFindBooking(b.guestName);
    }
  }
  function onKey(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(items[sel]); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  }
  const groups = [["tab", "الأقسام"], ["room", "الغرف"], ["booking", "الحجوزات والنزلاء"]];
  let idx = -1;
  return (
    <div className="cx-pal-back cx-no-print" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cx-pal" role="dialog" aria-modal="true" aria-label="بحث سريع">
        <div className="cx-pal-in">
          <Search size={18} aria-hidden="true" />
          <input ref={inputRef} autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="اكتب اسم نزيل، رقم غرفة، كود، أو اسم قسم..." aria-label="بحث سريع" role="combobox" aria-expanded="true" aria-controls="cx-pal-list" aria-activedescendant={items[sel] ? "pal-" + items[sel].key : undefined} />
          <kbd>Esc</kbd>
        </div>
        <div className="cx-pal-list" id="cx-pal-list" role="listbox" ref={listRef}>
          {items.length === 0 && <div className="cx-pal-empty">مفيش نتايج لـ "{q}"</div>}
          {groups.map(([kind, title]) => {
            const g = items.filter((it) => it.kind === kind);
            if (!g.length) return null;
            return (
              <div key={kind}>
                <div className="cx-pal-group">{title}</div>
                {g.map((it) => { idx = items.indexOf(it); const i = idx; const Icon = it.Icon; return (
                  <div key={it.key} id={"pal-" + it.key} role="option" aria-selected={i === sel} className="cx-pal-item" onMouseEnter={() => setSel(i)} onMouseDown={(e) => { e.preventDefault(); choose(it); }}>
                    <span className="cx-ico sm ic-slate" aria-hidden="true">{Icon && <Icon size={15} />}</span>
                    <div style={{ flex: 1, minWidth: 0 }}><div className="t">{it.label}</div><div className="s">{it.sub}</div></div>
                    {i === sel && <CornerDownLeft size={15} aria-hidden="true" style={{ color: "var(--faint)" }} />}
                  </div>
                ); })}
              </div>
            );
          })}
        </div>
        <div className="cx-pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> للتنقل</span><span><kbd>Enter</kbd> للفتح</span><span><kbd>Ctrl</kbd>+<kbd>K</kbd> من أي مكان</span></div>
      </div>
    </div>
  );
}
