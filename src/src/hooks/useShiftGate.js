import { useEffect, useState } from "react";
import { todayStr, isShiftActiveNow } from "../domain/dates";
import { SHIFTS } from "../domain/constants";
import { getClaimsForDate, getShiftRecord } from "../data/shifts";

/* مصدر واحد موحّد لمعرفة "هل موظف الشيفت دلوقتي في وقت شيفته المحجوز ليه
   ولسه مفتوح" - بيتستخدم في RoomBoard.jsx و BookingsPanel.jsx عشان الاتنين
   يتفقوا على نفس القرار بالظبط (نفس الشيفت، نفس حالة القفل) ومايحصلش
   تضارب بين شاشة وشاشة لنفس الموظف في نفس اللحظة.

   - claims: كل اختيارات الشيفتات النهارده (date -> shift_key -> {username,...})
   - myActiveShiftKey: شيفت الموظف الحالي لو هو فعليًا "في معاده" دلوقتي (عادي
     أو أوفر تايم) - null لو مفيش شيفت نشط حاليًا مطابق لاختياره.
   - isMyShiftNow: true لو فيه myActiveShiftKey.
   - shiftClosed: true لو الشيفت ده (shift_records) مُقفل فعليًا.
   - offShift: true لو الدور مربوط بوقت شيفت (roomStatusRestricted) ومش
     فاضي يعمل حاجة دلوقتي - يا إما مش وقت شيفته، يا إما شيفته مقفول. */
export function useShiftGate(profile, perms, dataVersion) {
  const [claims, setClaims] = useState(null);
  const [shiftRecord, setShiftRecord] = useState(null);
  const today = todayStr();

  useEffect(() => {
    if (!perms.roomStatusRestricted || !profile) { setClaims(null); setShiftRecord(null); return; }
    let cancelled = false;
    (async () => {
      const c = await getClaimsForDate(today);
      if (cancelled) return;
      setClaims(c);
      const mine = SHIFTS.map((s) => s.key).find((k) => c[k]?.username === profile.username && isShiftActiveNow(k));
      if (!mine) { setShiftRecord(null); return; }
      const rec = await getShiftRecord(today, mine);
      if (!cancelled) setShiftRecord(rec);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.username, perms.roomStatusRestricted, today, dataVersion]);

  const myActiveShiftKey = (perms.roomStatusRestricted && claims && profile)
    ? SHIFTS.map((s) => s.key).find((k) => claims[k]?.username === profile.username && isShiftActiveNow(k)) || null
    : null;
  const isMyShiftNow = !!myActiveShiftKey;
  const shiftClosed = !!shiftRecord?.closed;
  const offShift = perms.roomStatusRestricted && (!isMyShiftNow || shiftClosed);

  return { claims, myActiveShiftKey, isMyShiftNow, shiftClosed, offShift };
}
