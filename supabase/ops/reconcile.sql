-- ============================================================================
-- فحص تطابق الفلوس (قراءة فقط - مابيعدّلش أي حاجة). شغّله في Supabase SQL Editor:
--   قبل النشر (على بياناتك الحالية)، بعد تشغيل schema.sql، وبعدها كل يوم/أسبوع.
-- لو رجّع صفر صفوف في القسم "خطأ" يبقى الفلوس متطابقة. صفوف "تنبيه" معلومات للمراجعة.
-- ============================================================================
with ledger as (        -- كل تحصيل في اليومية مربوط بحجز (غرف + كافيتيريا النزيل)
  select (x ->> 'bookingId') as booking_id,
         coalesce(nullif(x ->> 'collectionCurrency', ''), 'EGP') as cur,
         coalesce(x ->> 'collectionMethod', '') as method,
         case when trim(coalesce(x ->> 'collectionAmt', '')) ~ '^-?[0-9]+(\.[0-9]+)?$' then trim(x ->> 'collectionAmt')::numeric else 0 end as amt
  from shift_records s, lateral (select jsonb_array_elements(coalesce(s.rows, '[]'::jsonb)) union all select jsonb_array_elements(coalesce(s.cafeteria_rows, '[]'::jsonb))) e(x)
  where coalesce(x ->> 'bookingId', '') <> ''
),
per_booking as (select booking_id, cur, sum(amt) as led from ledger group by 1, 2)
select 'خطأ' as level, 'المدفوع على الحجز مش مطابق لتحصيله في اليومية' as check_name, b.id::text as ref,
       format('%s غرفة %s: مدفوع %s %s / في اليومية %s', b.guest_name, b.room, b.amount_paid, b.currency, coalesce(p.led, 0)) as detail
from bookings b left join per_booking p on p.booking_id = b.id::text and p.cur = b.currency
where coalesce(b.amount_paid, 0) <> coalesce(p.led, 0)
union all
select 'خطأ', 'تحصيل في اليومية لحجز بعملة مختلفة أو حجز مش موجود', p.booking_id, format('%s %s', p.led, p.cur)
from per_booking p left join bookings b on b.id::text = p.booking_id
where b.id is null or (b.currency <> p.cur and p.led <> 0)
union all
select 'خطأ', 'حالة "مدفوع بالكامل" مش مطابقة للمعادلة', b.id::text, format('%s: settled=%s مدفوع %s من %s', b.guest_name, b.settled, b.amount_paid, booking_hotel_total(b))
from bookings b
where b.settled is distinct from (b.status is distinct from 'ملغي' and coalesce(b.amount_paid, 0) >= booking_hotel_total(b))
union all
select 'خطأ', 'مدفوع كافيتيريا النزيل أكبر من قيمة الكافيتيريا', b.id::text, format('%s: مدفوع %s من %s', b.guest_name, b.extras ->> 'cafeteriaPaid', b.extras ->> 'cafeteria')
from bookings b
where coalesce(nullif(b.extras ->> 'cafeteriaPaid', '')::numeric, 0) > coalesce(nullif(b.extras ->> 'cafeteria', '')::numeric, 0) + 0.005
union all
select 'خطأ', 'كافيتيريا استاف: المدفوع مش مطابق لمجموع الدفعات أو أكبر من المبلغ', e.id::text,
       format('%s: مدفوع %s / مجموع الدفعات %s / المبلغ %s', e.consumer_name, e.paid_amount, coalesce((select sum((p ->> 'amount')::numeric) from jsonb_array_elements(e.payments) p), 0), e.amount)
from staff_cafeteria e
where e.paid_amount > e.amount + 0.005 or abs(e.paid_amount - coalesce((select sum((p ->> 'amount')::numeric) from jsonb_array_elements(e.payments) p), 0)) > 0.005
union all
select 'خطأ', 'طلب رد فلوس معلّق على حجز مفيش عليه زيادة ولا ملغي', b.id::text, format('%s: مدفوع %s من %s', b.guest_name, b.amount_paid, booking_grand_total(b))
from bookings b
where b.refund_pending and not (b.status = 'ملغي' and coalesce(b.amount_paid, 0) > 0) and not (coalesce(b.amount_paid, 0) > booking_grand_total(b))
union all
select 'تنبيه', 'رصيد وسيلة دفع سالب على حجز (رد أكبر من التحصيل بنفس الوسيلة)', booking_id, format('%s %s = %s', method, cur, sum(amt))
from ledger group by booking_id, method, cur having sum(amt) < -0.005
union all
select 'تنبيه', 'شيفت لسه مفتوح من أكتر من يومين', s.date::text || ' ' || s.shift_key, s.staff_name
from shift_records s where not s.closed and s.date < hotel_today() - 1
union all
select 'تنبيه', 'مديونية كافيتيريا استاف مفتوحة', e.consumer_name, format('%s %s', sum(e.amount - e.paid_amount), e.currency)
from staff_cafeteria e where e.paid_amount < e.amount group by e.consumer_name, e.currency
order by 1, 2, 3;
