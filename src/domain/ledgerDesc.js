/* البيان بعد تعديل المبلغ: "(+4000 EGP)" بيبقى "(+3000 EGP)". لو البيان فيه أكتر من مبلغ (صف متجمّع) أو مفيهوش،
   بيتضاف في الآخر "← اتعدّل لـ 3000 EGP" بدل ما يفضل رقم غلط. */
export function descWithAmount(desc, oldAmt, newAmt, cur) {
  const d = String(desc || "");
  const n = Math.round((Number(newAmt) || 0) * 100) / 100;
  const re = /\(\+([\d.,]+) ([A-Z]{3})\)/g;
  const hits = [...d.matchAll(re)];
  if (hits.length === 1 && hits[0][2] === cur) return d.replace(re, `(+${n} ${cur})`);
  const base = d.replace(/ ← اتعدّل لـ [\d.,]+ [A-Z]{3}$/, "");
  return Number(oldAmt) === n ? base : `${base}${base ? " " : ""}← اتعدّل لـ ${n} ${cur}`;
}

