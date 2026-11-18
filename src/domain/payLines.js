/* سعر الصرف زي ما الموظف بيكتبه: "1 دولار = كام جنيه" (الجنيه دايمًا هو اللي بيتكتب بيه).
   الدالة بتحوّله لسعر القاعدة (كام من عملة الدفعة في كل 1 من عملة الحجز). */
export function payLineApiRate(line, bookingCurrency) {
  const r = Number(line.rate);
  if (!(r > 0)) return 0;
  if (bookingCurrency === "EGP" && line.currency !== "EGP") return 1 / r;    // حجز بالجنيه ودفعة بالدولار: 1 دولار = r جنيه
  return r;                                                                  // حجز بالدولار ودفعة بالجنيه: 1 دولار = r جنيه
}
export function payLineCovered(line, bookingCurrency) {
  const amt = Number(line.amount) || 0, r = payLineApiRate(line, bookingCurrency);
  return amt > 0 && r > 0 ? Math.round((amt / r) * 100) / 100 : 0;
}
export function payLineRateLabel(line, bookingCurrency) {
  if (bookingCurrency === "EGP" && line.currency !== "EGP") return `1 ${line.currency} = كام EGP`;
  if (line.currency === "EGP") return `1 ${bookingCurrency} = كام EGP`;
  return `كام ${line.currency} في كل 1 ${bookingCurrency}`;
}

