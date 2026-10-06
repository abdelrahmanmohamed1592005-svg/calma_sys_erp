import { useEffect, useState } from "react";
import { isShiftActiveNow } from "../domain/dates";
import { getShiftRecord, resolveMyShift } from "../data/shifts";

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
  const [state, setState] = useState({ claims: null, key: null, date: null, record: null });

  useEffect(() => {
    if (!perms.roomStatusRestricted || !profile) { setState({ claims: null, key: null, date: null, record: null }); return; }
    let cancelled = false;
    (async () => {
      const r = await resolveMyShift(profile.username);
      if (cancelled) return;
      const rec = r.key ? await getShiftRecord(r.date, r.key) : null;
      if (!cancelled) setState({ claims: r.claims, key: r.key, date: r.date, record: rec });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.username, perms.roomStatusRestricted, dataVersion]);

  // الشيفت لازم يفضل "نشط" لحظيًا (مش بس وقت آخر تحميل): نعيد التحقق من الوقت هنا.
  const myActiveShiftKey = (perms.roomStatusRestricted && state.claims && profile && state.key && isShiftActiveNow(state.key)) ? state.key : null;
  const myActiveShiftDate = myActiveShiftKey ? state.date : null;
  const isMyShiftNow = !!myActiveShiftKey;
  const shiftClosed = !!state.record?.closed;
  const offShift = perms.roomStatusRestricted && (!isMyShiftNow || shiftClosed);

  return { claims: state.claims, myActiveShiftKey, myActiveShiftDate, isMyShiftNow, shiftClosed, offShift };
}
