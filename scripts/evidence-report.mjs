// يحوّل evidence-out/*.json إلى EVIDENCE.md (ملخص + طلبات API + حالة القاعدة). بدون أي أسرار.
import fs from "node:fs";
const dir = "evidence-out";
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
let md = "# أدلة التشغيل الحقيقي\n\nكل سيناريو اتنفّذ في Chromium حقيقي على Postgres معزول؛ الأرقام هنا مأخوذة من الملفات الناتجة فعلًا.\n\n";
for (const f of files) {
  const d = JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8"));
  md += `## ${d.name}\n\n`;
  for (const s of d.steps) md += `- **${s.label}** — toast: ${s.ui.toast ?? "-"} — لقطة: \`${s.screenshot}\` — DB: \`${JSON.stringify(s.db)}\`\n`;
  md += "\n| طلب | مسار | الحالة | الرد |\n|---|---|---|---|\n";
  for (const a of [...d.api, ...(d.cases || []).map((c) => ({ method: c.who, path: c.action, status: c.status, response: c.body }))])
    md += `| ${a.method} | ${a.path} | ${a.status} | ${JSON.stringify(a.response ?? null).slice(0, 140).replace(/\|/g, "/")} |\n`;
  if (d.netByMethod) md += `\nصافي اليومية بالوسيلة بعد الرد: \`${JSON.stringify(d.netByMethod)}\`\n`;
  md += "\n";
}
fs.writeFileSync("EVIDENCE.md", md);
console.log("EVIDENCE.md", files.length, "scenarios");
