# النسخ الاحتياطي والاسترجاع

النظام فيه فلوس وحجوزات حقيقية، فالنسخ الاحتياطي مش اختياري. كل بياناتك في قاعدة بيانات Supabase (Postgres)، والكود على GitHub. يعني عندك **ثلاث حاجات** لازم تتحمي:

| إيه | فين | بيتحمي إزاي |
|---|---|---|
| الكود (الواجهة + الـ Edge Functions) | GitHub | موجود أصلاً في الـ repo |
| هيكل قاعدة البيانات (جداول، صلاحيات) | `supabase/schema.sql` في الـ repo | موجود أصلاً، وبيتشغّل تاني على مشروع جديد |
| **البيانات** (حجوزات، يوميات، مستخدمين، سجل الحركة) | Supabase فقط | **ده اللي محتاج نسخ احتياطي** - باقي الدليل عنه |

> الأسرار (مفاتيح Supabase، باسورد قاعدة البيانات) **مش** بتتحط في الـ repo أبدًا. احتفظ بيها في مدير كلمات مرور.

---

## الطريقة ١: النسخ التلقائي من Supabase (أسهل حاجة)

من Supabase Dashboard ← **Database ← Backups**.

- الخطط المدفوعة (Pro وفوق) بتاخد نسخة يومية تلقائيًا وبتحتفظ بيها لعدد أيام محدد، وفيه إضافة **Point-in-Time Recovery** (PITR) للرجوع لأي ثانية.
- الخطة المجانية **مفيهاش نسخ احتياطي تلقائي تقدر تعتمد عليه**. لو النظام شغّال فعلاً في الفندق، يا إما تترقّى لـ Pro يا إما تستخدم الطريقة ٢ أو ٣ تحت.
- تفاصيل الخطط بتتغيّر، فاتأكد من صفحة Backups في مشروعك ومن https://supabase.com/docs/guides/platform/backups.

للاسترجاع من نفس الصفحة: اختار النسخة واضغط **Restore** (بيستبدل البيانات الحالية بالكامل، فخد نسخة يدوية قبلها).

---

## الطريقة ٢: نسخة يدوية بملف (`pg_dump`) - اعملها أسبوعيًا على الأقل

### المتطلبات (مرة واحدة)
1. ثبّت أدوات PostgreSQL على جهازك (تيجي معاها `pg_dump` و`pg_restore`): https://www.postgresql.org/download/
2. جيب **رابط الاتصال بقاعدة البيانات**: Supabase Dashboard ← زرار **Connect** ← **Session pooler** (أو Direct connection) ← انسخ الـ URI واستبدل `[YOUR-PASSWORD]` بباسورد قاعدة البيانات (Project Settings ← Database ← Reset password لو نسيته).

### أخد النسخة
```bash
pg_dump "postgresql://postgres.PROJECT-REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres" \
  --no-owner --no-privileges \
  --schema=public --schema=auth \
  --format=custom \
  --file=calma-backup-$(date +%F).dump
```
- `--schema=public` = كل بيانات النظام. `--schema=auth` = حسابات الدخول (من غيرها المستخدمين مش هيعرفوا يدخلوا بعد الاسترجاع).
- على Windows (PowerShell) استبدل `$(date +%F)` بتاريخ مكتوب بإيدك، مثلاً `calma-backup-2026-10-06.dump`.
- حجم الملف صغير غالبًا (ميجابايتات).

### مهم جدًا للملف ده
- فيه أسماء وتليفونات النزلاء وبيانات مالية: **متحطوش على GitHub ولا في مكان عام**.
- خزّنه في مكانين على الأقل (مثلاً: Google Drive خاص + فلاشة/هارد)، وشفّره لو هيتخزّن أونلاين:
  ```bash
  gpg --symmetric --cipher-algo AES256 calma-backup-2026-10-06.dump
  ```
- احتفظ بآخر ٧ نسخ يومية + آخر ٤ أسبوعية + آخر ١٢ شهرية، وامسح الأقدم.

---

## الطريقة ٣: نسخة تلقائية كل ليلة بـ GitHub Actions (اختياري)

تخلّي GitHub هو اللي يأخد النسخة يوميًا من غير ما تفتكر. **الـ repo لازم يكون Private**، والنسخة بتتشفّر قبل ما تتخزّن.

1. في GitHub: Settings ← Secrets and variables ← Actions ← New repository secret، وضيف:
   - `SUPABASE_DB_URL` = رابط الاتصال (Session pooler) بالباسورد.
   - `BACKUP_PASSPHRASE` = عبارة سر طويلة (احفظها في مدير كلمات مرور - من غيرها النسخة متتفتحش).
2. اعمل الملف `.github/workflows/backup.yml`:

```yaml
name: Nightly DB backup
on:
  schedule:
    - cron: "0 2 * * *"   # كل يوم ٢ بعد منتصف الليل بتوقيت UTC
  workflow_dispatch: {}
jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - name: Install PostgreSQL client
        run: |
          sudo sh -c 'echo "deb https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
          wget -qO- https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo tee /etc/apt/trusted.gpg.d/pgdg.asc >/dev/null
          sudo apt-get update && sudo apt-get install -y postgresql-client-17
      - name: Dump
        env:
          DB_URL: ${{ secrets.SUPABASE_DB_URL }}
        run: |
          pg_dump "$DB_URL" --no-owner --no-privileges --schema=public --schema=auth --format=custom --file=backup.dump
      - name: Encrypt
        env:
          PASS: ${{ secrets.BACKUP_PASSPHRASE }}
        run: gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase "$PASS" backup.dump
      - uses: actions/upload-artifact@v4
        with:
          name: calma-backup-${{ github.run_id }}
          path: backup.dump.gpg
          retention-days: 30
```
- الملفات بتتحفظ في Actions ← الـ run ← Artifacts لمدة ٣٠ يوم (غيّر `retention-days` زي ما تحب، الحد الأقصى بيتحدد من إعدادات الـ repo).
- لو نسخة Postgres عند Supabase أعلى من ١٧، غيّر رقم `postgresql-client-17` لنفس النسخة أو أعلى (شوفها من Project Settings ← Infrastructure).
- افتح تبويب Actions كل فترة وتأكد إن آخر تشغيل نجح. وحمّل نسخة بإيدك دوريًا وخزّنها خارج GitHub.

---

## الطريقة ٤: تصدير سريع بدون أدوات (للحالات الطارئة والتقارير)

Supabase Dashboard ← **Table Editor** ← اختار جدول (`bookings`, `shift_records`, `profiles`) ← **Export → CSV**. مفيد للاطلاع أو لو محتاج بيانات فقط، لكنه **مش بديل** عن Dump كامل (بيفقد العلاقات والصلاحيات وحسابات الدخول).

---

## الاسترجاع

### أ) استرجاع كامل على مشروع Supabase **جديد** (أنضف طريقة، وبتتجرّب بيها النسخة)
1. اعمل مشروع جديد في Supabase.
2. شغّل `supabase/schema.sql` كامل في SQL Editor (بيبني الجداول والصلاحيات).
3. فك التشفير لو متشفّر: `gpg --decrypt backup.dump.gpg > backup.dump`
4. استرجع **البيانات بس** فوق الهيكل الجاهز:
   ```bash
   pg_restore --data-only --disable-triggers --no-owner \
     --dbname="postgresql://postgres.NEW-REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres" \
     backup.dump
   ```
   - لو ظهرت أخطاء عن جداول `auth.*` (بسبب اختلاف نسخ Supabase)، استرجع `public` بس، واعمل حسابات الدخول من جديد من شاشة "إدارة المستخدمين" بنفس أسماء المستخدمين (حسابات `profiles` مرتبطة بـ `auth.users`، فلو `auth` ماتسترجعش لازم تتعمل من الأول بنفس الـ username).
5. انشر الـ Edge Functions على المشروع الجديد (`supabase link` ثم `supabase functions deploy create-user` و`reset-password`).
6. غيّر `VITE_SUPABASE_URL` و`VITE_SUPABASE_ANON_KEY` في إعدادات Vercel لقيم المشروع الجديد، وأعد النشر.
7. اقفل **Allow new users to sign up**، وجرّب الدخول بكل دور.

### ب) استرجاع من Backups بتاعة Supabase
Database ← Backups ← اختار النسخة (أو وقت PITR) ← Restore. بيستبدل القاعدة الحالية، فخد Dump يدوي قبلها لو القاعدة لسه فيها بيانات تهمّك.

---

## قواعد ذهبية
1. **النسخة اللي عمرها ما اتجرّبت مش نسخة.** اعمل تجربة استرجاع على مشروع Supabase مجاني كل ٣ شهور على الأقل، وتأكد إن الحجوزات واليوميات ظاهرة.
2. خد نسخة يدوية **قبل أي تغيير كبير**: تشغيل `schema.sql` جديد، أو تعديل جماعي، أو حذف بيانات.
3. النسخة لازم تكون **في مكان تاني غير Supabase** (لو الحساب اتقفل، النسخة اللي جواه بتروح معاه).
4. شفّر أي نسخة بتخرج من جهازك، ومتحطهاش في مكان عام.
5. حدّد **مسؤول** عن النسخ الاحتياطي واسمه يتكتب، ومعاه تاريخ آخر نسخة اتاخدت وآخر اختبار استرجاع.
