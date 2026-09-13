# نظام Calma لإدارة الفندق - النسخة الكاملة (v2)

النسخة دي هي النسخة النهائية: قاعدة بيانات مطبّعة بالكامل (كل حجز/غرفة/شيفت صف مستقل، مش JSON مجمّع)، كود مقسّم لملفات منظمة بدل ملف واحد ضخم، اختبارات آلية حقيقية (٤٨ اختبار شغالة)، مصادقة حقيقية (Supabase Auth)، حماية على مستوى قاعدة البيانات، حماية من تعارض الكتابة بين الأجهزة، ومزامنة لحظية.

اتعمل عليها **build حقيقي ناجح** و **٤٨ اختبار آلي ناجح بالكامل** قبل ما تتسلّملك.

---

## الخطوة ١: قاعدة البيانات

1. [supabase.com](https://supabase.com) -> مشروع جديد (Free Tier كفاية جدًا لفندق صغير-متوسط).
2. **SQL Editor** -> انسخ محتوى `supabase/schema.sql` كامل -> **Run**.
   - لو كان عندك مشروع قديم بجدول `kv_store` بس، السكريبت ده هيضيف الجداول الجديدة (`rooms`, `bookings`, `shift_records`, `shift_claims`, `activity_log`) جنبه من غير ما يمسح حاجة. جدول `kv_store` القديم هيفضل موجود لكن مش هيتستخدم تاني.
3. **مهم جدًا**: Authentication -> Providers -> Email -> شيّل "Confirm email".
4. من Project Settings -> API خد `Project URL` و `anon public key`.

---

## الخطوة ٢: نشر Edge Function (لتغيير باسورد موظف من المدير العام)

```bash
npm install -g supabase
supabase login
supabase link --project-ref xxxxxxxxxxxxx
supabase functions deploy reset-password
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

لو أجّلتها، كل حاجة في السيستم شغالة عادي، وزرار "إعادة تعيين كلمة مرور" بس مش هيشتغل لحد ما تعملها.

---

## الخطوة ٣: التجربة المحلية (اختياري)

```bash
npm install
cp .env.example .env   # واملأ القيم من Supabase
npm run dev
```

## الخطوة ٤: تشغيل الاختبارات الآلية (اختياري بس مفيد)

```bash
npm test
```

المفروض تشوف: `Tests  48 passed (48)`. الاختبارات دي بتتأكد من صحة الحسابات المالية، منطق حالة الغرف، وقواعد استيراد ومنع تكرار الحجوزات - أي تعديل مستقبلي في المنطق ده هيتكشف تلقائيًا لو كسر حاجة.

---

## الخطوة ٥: الرفع على الإنترنت

### الخيار أ) Vercel (اللي استخدمناه قبل كده)

1. ارفع المشروع على GitHub.
2. Vercel -> Add New Project -> اختار الـ repo.
3. Environment Variables -> `VITE_SUPABASE_URL` و `VITE_SUPABASE_ANON_KEY`.
4. Deploy.

### الخيار ب) Netlify (بديل بنفس السهولة بالظبط، مفيش فرق حقيقي في الصعوبة)

بصراحة، مفيش خيار "أبسط بشكل واضح" من Vercel لموقع React حقيقي بدومين خاص - أي منصة هتحتاجك تعمل نفس الخطوات (ربط GitHub، حط متغيرات البيئة، Deploy). Netlify نفس المستوى بالظبط:

1. [netlify.com](https://netlify.com) -> Add new site -> Import from Git -> اختار الـ repo.
2. Build command: `npm run build` — Publish directory: `dist`.
3. Site settings -> Environment variables -> ضيف نفس المتغيرين.
4. Deploy site.

**الصعوبة اللي حسيت بيها المرة اللي فاتت مكنتش بسبب Vercel نفسه - كانت أول مرة تتعامل مع أي حاجة من النوع ده.** أي منصة تانية (Netlify, Cloudflare Pages, Render) هتحتاج بالظبط نفس عدد الخطوات ونفس نوع المعلومات (رابط GitHub + متغيرين بيئة). Vercel فعليًا من أسهل الخيارات الموجودة في السوق كله، مش أصعبها.

---

## هل السيستم "مسمّع" فعلاً على كل الأجهزة؟

نعم، بثلاث طبقات حماية حقيقية:

1. **قاعدة بيانات واحدة مركزية** (Supabase) - كل الأجهزة بتقرا وتكتب في نفس المكان بالظبط، مفيش نسخة محلية منفصلة لكل جهاز.
2. **بث لحظي (Realtime)** - أي تغيير في أي جدول بيوصل لكل الأجهزة المفتوحة في أقل من ثانية من غير ما حد يحتاج يعمل Refresh.
3. **حماية من تعارض الكتابة** - لو جهازين حاولوا يكتبوا نفس البيانات في نفس اللحظة بالظبط، واحد بس بينجح والتاني بيستقبل تحذير واضح ويتحدّث تلقائي، بدل ما تعديل حد يتمسح بصمت.

---

## هيكل المشروع الجديد

```
calma-standalone/
├── src/
│   ├── App.jsx                 # الغلاف الرئيسي - تسجيل الدخول والتنقل بين الصفحات بس
│   ├── main.jsx
│   ├── domain/                 # منطق الأعمال الصافي (بدون واجهة) - قابل للاختبار بالكامل
│   │   ├── dates.js
│   │   ├── money.js
│   │   ├── constants.js
│   │   ├── bookingLogic.js
│   │   └── importLogic.js
│   ├── data/                   # الاتصال بقاعدة البيانات (استعلامات Supabase)
│   │   ├── rooms.js
│   │   ├── bookings.js
│   │   ├── shifts.js
│   │   └── activity.js
│   ├── lib/
│   │   ├── supabaseClient.js
│   │   ├── auth.js
│   │   └── realtime.js
│   ├── components/              # كل صفحة/قسم في ملفه الخاص
│   │   ├── shared.jsx
│   │   ├── Header.jsx
│   │   ├── AuthScreens.jsx
│   │   ├── RoomBoard.jsx
│   │   ├── DailyLedger.jsx
│   │   ├── BookingsPanel.jsx
│   │   ├── ReportsPanel.jsx
│   │   ├── ActivityPanel.jsx
│   │   └── UsersPanel.jsx
│   └── __tests__/                # ٤٨ اختبار آلي
├── supabase/
│   ├── schema.sql
│   └── functions/reset-password/
└── public/
```

---

## قاعدة البيانات - الجداول

| الجدول | الغرض |
|---|---|
| `profiles` | الموظفين وأدوارهم (مربوط بنظام تسجيل الدخول) |
| `rooms` | الـ١٦ غرفة وتفاصيلها |
| `room_overrides` | حالة الغرفة اليدوية (صيانة/تنظيف/غادر مبكرًا) |
| `bookings` | كل حجز صف مستقل بكل تفاصيله |
| `shift_records` | كل شيفت (يومية) صف مستقل |
| `shift_claims` | مين اختار أي شيفت النهارده |
| `activity_log` | سجل كل التعديلات |

---

## إيه اللي كان ناقص وبقى مكتمل دلوقتي

| كان قبل كده | بقى دلوقتي |
|---|---|
| ملف واحد ~١٦٠٠ سطر | مقسّم على ٢٠+ ملف منظم حسب المسؤولية |
| صفر اختبارات | ٤٨ اختبار آلي شغال، بيتأكد من الحسابات المالية ومنطق الحجوزات والصلاحيات |
| `bookings`/`rooms`/كل حاجة كـ JSON مجمّع في مفتاح واحد | كل جدول مطبّع بالكامل، كل حجز/غرفة/شيفت صف مستقل حقيقي |
| مصادقة يدوية SHA-256 | Supabase Auth حقيقي (bcrypt + جلسات JWT) |
| قاعدة بيانات مفتوحة لأي حد معاه anon key | حماية RLS تتطلب تسجيل دخول حقيقي |
| كتابة بتاخد فوق بعض بصمت | كتابة آمنة (compare-and-swap) بتحذير واضح عند التعارض |

مفيش نقطة من الثلاثة اللي كانوا موصوفين "محتاجين شغل" باقية من غير حل.

---

## لو حصلت مشكلة

- **"بيانات ما بتتزامنش"**: تأكد إن الجداول السبعة (`profiles`, `rooms`, `room_overrides`, `bookings`, `shift_records`, `shift_claims`, `activity_log`) موجودة في Table Editor. لو ناقصة، شغّل `schema.sql` تاني.
- **"Email not confirmed"**: راجع الخطوة ١.٣.
- **زرار إعادة تعيين كلمة المرور مش شغال**: راجع الخطوة ٢.
- **عايز تصفّر البيانات**: امسح صفوف الجداول من Table Editor، وامسح المستخدمين من Authentication -> Users.
