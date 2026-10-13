# أدلة التشغيل الحقيقي

كل سيناريو اتنفّذ في Chromium حقيقي على Postgres معزول؛ الأرقام هنا مأخوذة من الملفات الناتجة فعلًا.

## EV1-valid-payment

- **بعد تسجيل ١٢٠ فيزا** — toast: تم تسجيل ١٢٠ USD (فيزا ⁦****4242⁩) - المتبقي ٨٠ USD — لقطة: `EV1-valid-payment-1.png` — DB: `[{"amount_paid":120,"settled":false,"payment_method":"فيزا"}]`
- **التقرير** — toast: - — لقطة: `EV1-valid-payment-2.png` — DB: `null`

| طلب | مسار | الحالة | الرد |
|---|---|---|---|
| POST | rpc/profiles_exist | 200 | true |
| POST | rpc/profiles_exist | 200 | true |
| POST | rpc/calma_schema_version | 200 | 36 |
| POST | rpc/record_booking_payment | 200 | {"left":80,"amount":120,"method":"فيزا","details":{"ref":"","onlinePaid":false,"senderName":"","senderNumber":"4242"},"currency":"USD","shif |
| POST | activity_log | 201 | null |
| POST | rpc/profiles_exist | 200 | true |
| POST | rpc/calma_schema_version | 200 | 36 |

## EV2-invalid-input

- **مبلغ 0 بوسيلة كاش** — toast: اكتب مبلغ الدفعة (أكبر من صفر) — لقطة: `EV2-invalid-input-1.png` — DB: `[{"amount_paid":0}]`
- **مبلغ -5 بوسيلة كاش** — toast: اكتب مبلغ الدفعة (أكبر من صفر) — لقطة: `EV2-invalid-input-2.png` — DB: `[{"amount_paid":0}]`
- **مبلغ 500 بوسيلة كاش** — toast: المبلغ أكبر من المتبقي على النزيل (١٠٠ USD) — لقطة: `EV2-invalid-input-3.png` — DB: `[{"amount_paid":0}]`
- **مبلغ 50 بوسيلة فيزا** — toast: اكتب آخر ٤ أرقام من الكارت (٤ أرقام بالظبط) — لقطة: `EV2-invalid-input-4.png` — DB: `[{"amount_paid":0}]`

| طلب | مسار | الحالة | الرد |
|---|---|---|---|
| POST | rpc/profiles_exist | 200 | true |
| POST | rpc/profiles_exist | 200 | true |
| POST | rpc/calma_schema_version | 200 | 36 |
| POST | rpc/record_booking_payment (direct) | 400 | {"code":"P0001","message":"اكتب مبلغ الدفعة (أكبر من صفر)","details":null,"hint":null} |
| POST | rpc/record_booking_payment (direct) | 400 | {"code":"P0001","message":"اكتب مبلغ الدفعة (أكبر من صفر)","details":null,"hint":null} |
| POST | rpc/record_booking_payment (direct) | 400 | {"code":"P0001","message":"المبلغ أكبر من المتبقي على النزيل (100)","details":null,"hint":null} |
| POST | rpc/record_booking_payment (direct) | 400 | {"code":"22P02","message":"invalid input syntax for type numeric: \"abc\"","details":null,"hint":null} |

## EV3-duplicate-submit

- **بعد ٣ ضغطات** — toast: تم تسجيل ١٠٠ USD (كاش) - الحجز مدفوع بالكامل — لقطة: `EV3-duplicate-submit-1.png` — DB: `[{"amount_paid":100}]`

| طلب | مسار | الحالة | الرد |
|---|---|---|---|
| POST | rpc/profiles_exist | 200 | true |
| POST | rpc/profiles_exist | 200 | true |
| POST | rpc/calma_schema_version | 200 | 36 |
| POST | rpc/record_booking_payment | 200 | {"left":0,"amount":100,"method":"كاش","details":{"ref":"","onlinePaid":false,"senderName":"","senderNumber":""},"currency":"USD","shiftKey": |
| POST | activity_log | 201 | null |

## EV4-unauthorized

- **الموظف داخل** — toast: - — لقطة: `EV4-unauthorized-1.png` — DB: `null`

| طلب | مسار | الحالة | الرد |
|---|---|---|---|
| POST | rpc/profiles_exist | 200 | true |
| POST | rpc/profiles_exist | 200 | true |
| POST | rpc/calma_schema_version | 200 | 36 |
| rawan | rpc record_booking_payment | 400 | {"code":"P0001","message":"تسجيل التحصيل من صلاحية موظف الشيفت بس","details":null,"hint":null} |
| acc | rpc record_booking_payment | 400 | {"code":"P0001","message":"تسجيل التحصيل من صلاحية موظف الشيفت بس","details":null,"hint":null} |
| ahmed | PATCH bookings.amount_paid=999 | 400 | {"code":"P0001","message":"المدفوع على الحجز بيتغيّر من تسجيل دفعة أو قرار رد الفلوس بس - مش بتعديل مباشر","details":null,"hint":null} |
| rawan | PATCH bookings.amount_paid=999 | 400 | {"code":"P0001","message":"المدفوع على الحجز بيتغيّر من تسجيل دفعة أو قرار رد الفلوس بس - مش بتعديل مباشر","details":null,"hint":null} |
| anon | rpc بدون توكن | 403 | {"code":"42501","message":"permission denied for function record_booking_payment","details":null,"hint":null} |

## EV5-failure-recovery

- **بعد الفشل** — toast: boom — لقطة: `EV5-failure-recovery-1.png` — DB: `[{"amount_paid":0}]`
- **بعد إعادة المحاولة** — toast: تم تسجيل ١٠٠ USD (كاش) - الحجز مدفوع بالكامل — لقطة: `EV5-failure-recovery-2.png` — DB: `[{"amount_paid":100,"settled":true}]`

| طلب | مسار | الحالة | الرد |
|---|---|---|---|
| POST | rpc/profiles_exist | 200 | true |
| POST | rpc/profiles_exist | 200 | true |
| POST | rpc/calma_schema_version | 200 | 36 |
| POST | rpc/record_booking_payment | 500 | {"message":"boom","code":"XX000"} |
| POST | rpc/record_booking_payment | 200 | {"left":0,"amount":100,"method":"كاش","details":{"ref":"","onlinePaid":false,"senderName":"","senderNumber":""},"currency":"USD","shiftKey": |
| POST | activity_log | 201 | null |

## EV6-refund

- **طلب الرد قبل القرار** — toast: - — لقطة: `EV6-refund-1.png` — DB: `null`
- **بعد الموافقة** — toast: تم رد ٢٠٠ USD: ١٠٠ كاش + ١٠٠ فيزا ⁦****1111⁩ - اتشالت من التحصيل واليومية — لقطة: `EV6-refund-2.png` — DB: `[{"amount_paid":0,"refund_pending":false,"status":"ملغي"}]`

| طلب | مسار | الحالة | الرد |
|---|---|---|---|
| POST | rpc/profiles_exist | 200 | true |
| POST | rpc/profiles_exist | 200 | true |
| POST | rpc/calma_schema_version | 200 | 36 |
| POST | rpc/record_booking_payment | 200 | {"left":100,"amount":100,"method":"كاش","details":{"ref":"","onlinePaid":false,"senderName":"","senderNumber":""},"currency":"USD","shiftKey |
| POST | activity_log | 201 | null |
| POST | rpc/record_booking_payment | 200 | {"left":0,"amount":100,"method":"فيزا","details":{"ref":"","onlinePaid":false,"senderName":"","senderNumber":"1111"},"currency":"USD","shift |
| POST | activity_log | 201 | null |
| PATCH | bookings (cancel by reservations) | 200 | [{"id":"d5a38a38-c543-4c40-9b04-fc1c9339344b","code":"B2610-0001","room":601,"guest_name":"Refund Guest","phone":"","pax":1,"checkin":"2026- |
| NOTE | state after cancel (DB trigger) | 0 | [{"status":"ملغي","refund_pending":true,"amount_paid":200}] |
| POST | rpc/profiles_exist | 200 | true |
| POST | rpc/profiles_exist | 200 | true |
| POST | rpc/calma_schema_version | 200 | 36 |
| POST | rpc/decide_booking_refund | 200 | {"amount":200,"method":"كاش","splits":[{"amount":100,"method":"كاش","details":{"ref":"","onlinePaid":false,"senderName":"","senderNumber":"" |
| POST | activity_log | 201 | null |
| POST | rpc/decide_booking_refund (duplicate) | 400 | {"code":"P0001","message":"مفيش طلب رد فلوس معلّق على الحجز ده (اتقرر قبل كده)","details":null,"hint":null} |

صافي اليومية بالوسيلة بعد الرد: `{"كاش":0,"فيزا":0}`

