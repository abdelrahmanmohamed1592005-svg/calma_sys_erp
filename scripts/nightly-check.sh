#!/usr/bin/env bash
# فحص الليل (بيتشغّل من GitHub Actions كل ليلة، وممكن يتشغّل بإيدك):
#   ١) نسخة احتياطية مشفّرة من قاعدة البيانات (لو BACKUP_PASSPHRASE موجود)
#   ٢) فحص تطابق الفلوس (supabase/ops/reconcile.sql) - أي سطر "خطأ" = الفحص بيفشل
#   ٣) أخطاء السيستم عند المستخدمين في آخر ٢٤ ساعة (جدول client_errors) - أي خطأ = الفحص بيفشل
# لما الفحص يفشل، GitHub بيبعت إيميل لصاحب الـ repo - ده التنبيه.
#
# الاستخدام: DB_URL="postgresql://..." [BACKUP_PASSPHRASE=...] [OUT_DIR=out] bash scripts/nightly-check.sh
set -uo pipefail
: "${DB_URL:?حدد DB_URL (رابط Session pooler من Supabase)}"
OUT_DIR="${OUT_DIR:-nightly-out}"
mkdir -p "$OUT_DIR"
cd "$(dirname "$0")/.."
fail=0
note() { echo "$1"; [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$1" >> "$GITHUB_STEP_SUMMARY"; return 0; }

note "## فحص الليل - $(date -u +%F)"

# ١) النسخة الاحتياطية
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  file="$OUT_DIR/calma-backup-$(date -u +%F).dump"
  if pg_dump "$DB_URL" --no-owner --no-privileges --schema=public --schema=auth --format=custom --file="$file"; then
    gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase "$BACKUP_PASSPHRASE" --output "$file.gpg" "$file" && rm -f "$file"
    note "- ✅ النسخة الاحتياطية اتاخدت واتشفّرت ($(du -h "$file.gpg" | cut -f1))"
  else
    note "- ❌ النسخة الاحتياطية فشلت (pg_dump)"; fail=1
  fi
else
  note "- ⚠️ النسخة الاحتياطية متوقفة: ضيف السر BACKUP_PASSPHRASE في GitHub عشان تشتغل"
fi

# ٢) فحص تطابق الفلوس
if psql "$DB_URL" -X -q -A -t -F '|' -v ON_ERROR_STOP=1 -f supabase/ops/reconcile.sql > "$OUT_DIR/reconcile.txt"; then
  errs=$(grep -c '^خطأ|' "$OUT_DIR/reconcile.txt" || true)
  warns=$(grep -c '^تنبيه|' "$OUT_DIR/reconcile.txt" || true)
  if [ "$errs" -gt 0 ]; then
    note "- ❌ فحص الفلوس: $errs حجز/يومية مش متطابقين"
    grep '^خطأ|' "$OUT_DIR/reconcile.txt" | head -20 | sed 's/^/    /' | while read -r l; do note "$l"; done
    echo "::error::فحص تطابق الفلوس لقى $errs خطأ - افتح ملخص التشغيل"
    fail=1
  else
    note "- ✅ فحص الفلوس: كل الحجوزات متطابقة مع اليوميات ($warns تنبيه للمراجعة)"
  fi
else
  note "- ❌ فحص الفلوس ماشتغلش (مشكلة اتصال أو صلاحية)"; fail=1
fi

# ٣) أخطاء السيستم عند المستخدمين
if n=$(psql "$DB_URL" -X -q -A -t -c "select count(*) from public.client_errors where at > now() - interval '24 hours'" 2>/dev/null); then
  if [ "${n:-0}" -gt 0 ]; then
    note "- ❌ أخطاء السيستم: $n خطأ عند المستخدمين في آخر ٢٤ ساعة (التفاصيل في سجل الحركة ← أخطاء السيستم)"
    psql "$DB_URL" -X -q -A -t -F ' · ' -c "select to_char(at at time zone 'Africa/Cairo', 'HH24:MI'), coalesce(username, '?'), left(message, 160) from public.client_errors where at > now() - interval '24 hours' order by at desc limit 10" \
      | sed 's/^/    /' | while read -r l; do note "$l"; done
    echo "::error::$n خطأ عند المستخدمين في آخر ٢٤ ساعة"
    fail=1
  else
    note "- ✅ مفيش أخطاء عند المستخدمين في آخر ٢٤ ساعة"
  fi
else
  note "- ⚠️ جدول أخطاء السيستم مش موجود - شغّل schema.sql (نسخة 50)"
fi

exit $fail
