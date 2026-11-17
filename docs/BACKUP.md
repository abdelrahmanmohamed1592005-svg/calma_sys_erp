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

## الطريقة ٣: نسخة تلقائية كل ليلة بـ GitHub Actions (جاهزة في الـ repo)

الملف `.github/workflows/nightly.yml` بيشتغل كل ليلة الساعة ٣ الفجر بتوقيت القاهرة، وبيعمل ٣ حاجات (السكربت `scripts/nightly-check.sh`):
1. **نسخة احتياطية مشفّرة** من قاعدة البيانات (`public` + `auth`)، بتتحفظ ٣٠ يوم في Actions ← الـ run ← Artifacts.
2. **فحص تطابق الفلوس** (`supabase/ops/reconcile.sql`).
3. **أخطاء السيستم** عند المستخدمين في آخر ٢٤ ساعة (جدول `client_errors`).

لو الفحص لقى خطأ في الفلوس أو أخطاء عند المستخدمين أو النسخة فشلت، التشغيل بيفشل و**GitHub بيبعت إيميل لصاحب الـ repo**. الملخص بيظهر في صفحة التشغيل نفسها.

**التفعيل (مرة واحدة):** في GitHub: Settings ← Secrets and variables ← Actions ← New repository secret:
- `SUPABASE_DB_URL` = Supabase ← زرار **Connect** ← **Session pooler** ← الرابط كامل بباسورد قاعدة البيانات. (لازم Session pooler مش Direct: أجهزة GitHub مابتدعمش IPv6.)
- `BACKUP_PASSPHRASE` = عبارة سر طويلة لتشفير النسخة. احفظها في مدير كلمات مرور - من غيرها النسخة ماتتفتحش.

بعدها: Actions ← Nightly check ← **Run workflow** عشان تجرّبه على طول. الـ repo لازم يفضل **Private**.

**فك النسخة:** `gpg --decrypt calma-backup-YYYY-MM-DD.dump.gpg > backup.dump` وبعدها الاسترجاع زي "الاسترجاع" تحت.

---

## الطريقة ٤: تصدير سريع بدون أدوات (للحالات الطارئة والتقارير)

Supabase Dashboard ← **Table Editor** ← اختار جدول (`bookings`, `shift_records`, `profiles`) ← **Export → CSV**. مفيد للاطلاع أو لو محتاج بيانات فقط، لكنه **مش بديل** عن Dump كامل (بيفقد العلاقات والصلاحيات وحسابات الدخول).

---

## الاسترجاع

### أ) استرجاع كامل على مشروع Supabase **جديد** (أنضف طريقة، وبتتجرّب بيها النسخة)
1. اعمل مشروع جديد في Supabase.
2. شغّل `supabase/schema.sql` كامل في SQL Editor (بيبني الجداول والصلاحيات).
3. فك التشفير لو متشفّر: `gpg --decrypt backup.dump.gpg > backup.dump`
4. استرجع **البيانات بس** فوق الهيكل الجاهز. الأول فضّي جدولي الفنادق والغرف (`schema.sql` بيحط فنادق وغرف افتراضية، وبدون التفضية الاسترجاع بيفشل على جدولي `hotels` و`rooms` بخطأ `duplicate key` وغرفك المعدّلة ماترجعش) - في SQL Editor:
   ```sql
   truncate table public.hotels, public.rooms cascade;   -- القاعدة الجديدة فاضية، فالـ cascade مابيمسحش بيانات
   ```
   ```bash
   pg_restore --data-only --disable-triggers --no-owner \
     --dbname="postgresql://postgres.NEW-REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres" \
     backup.dump
   ```
   - لو ظهر خطأ واحد بس `unrecognized configuration parameter "transaction_timeout"` وبعده `errors ignored on restore: 1`، ده مش مشكلة: معناه إن `pg_restore` اللي على جهازك نسخته أحدث من قاعدة البيانات. ده إعداد للجلسة بس، والبيانات كلها اترجعت. أي خطأ تاني لازم يتراجع.
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
