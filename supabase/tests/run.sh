#!/usr/bin/env bash
# اختبارات قاعدة البيانات (الفلوس / الإلغاء / رد الفلوس / الخروج المبكر / التسكين المكرر).
# بتشتغل على Postgres حقيقي (نسخة ١٥ أو أحدث) في قاعدة بيانات **فاضية للتجارب** -
# مش مشروع Supabase الحقيقي أبدًا (بتنشئ جداول وبتمسح schema اسمه t).
#
#   createdb calma_test
#   DATABASE_URL=postgresql:///calma_test npm run test:db
set -euo pipefail
: "${DATABASE_URL:?حدد DATABASE_URL لقاعدة بيانات فاضية للتجارب}"
HERE="$(cd "$(dirname "$0")" && pwd)"
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f "$HERE/stub_supabase.sql"
"${PSQL[@]}" -f "$HERE/../schema.sql"
"${PSQL[@]}" -f "$HERE/money_flows.sql"
# حالات إعادة التسعير بتتقرا من نفس ملف JSON اللي اختبار الواجهة بيستخدمه
node -e '
const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
console.log(c.map((x) => `insert into t.reprice_cases values (${[x.checkin, x.checkout, x.newCheckout].map((d) => `date \x27${d}\x27`).join(",")},${x.totalRoom},${x.priceNight},${x.expected});`).join("\n"));
' "$HERE/reprice_cases.json" | "${PSQL[@]}"
"${PSQL[@]}" -f "$HERE/summary.sql"
