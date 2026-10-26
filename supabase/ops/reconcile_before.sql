-- ============================================================================
-- فحص "قبل التحديث" - بيشتغل على قاعدة قديمة (قبل ما schema.sql الجديد يتشغّل)، عكس reconcile.sql اللي محتاج الأعمدة والجداول الجديدة.
-- قراءة فقط. سجّل النتيجة (لقطة شاشة) قبل ما تشغّل schema.sql، وبعد التحديث شغّل reconcile.sql وقارن.
-- ============================================================================
with ledger as (
  select (x ->> 'bookingId') as booking_id,
         coalesce(nullif(x ->> 'fxBookingCurrency', ''), nullif(x ->> 'collectionCurrency', ''), 'EGP') as cur,  -- دفع بعملة تانية: بيتحسب بالمغطّى بعملة الحجز
         case when trim(coalesce(x ->> 'fxBookingCurrency', '')) <> '' then (case when trim(coalesce(x ->> 'fxCovered', '')) ~ '^[-+]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][-+]?[0-9]+)?$' then trim(x ->> 'fxCovered')::numeric else 0 end)
              when trim(coalesce(x ->> 'collectionAmt', '')) ~ '^[-+]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][-+]?[0-9]+)?$' then trim(x ->> 'collectionAmt')::numeric else 0 end as amt
  from shift_records s, lateral jsonb_array_elements(coalesce(to_jsonb(s) -> 'rows', '[]'::jsonb)) x
  where coalesce(x ->> 'bookingId', '') <> ''
), per_booking as (select booking_id, cur, sum(amt) as led from ledger group by 1, 2)
select 'معلومة' as level, 'عدد الحجوزات / اليوميات' as check_name, '' as ref,
       format('%s حجز · %s يومية · مجموع المدفوع على الحجوزات %s', (select count(*) from bookings), (select count(*) from shift_records), (select coalesce(sum(amount_paid), 0) from bookings)) as detail
union all
select 'خطأ', 'المدفوع على الحجز مش مطابق لتحصيله في اليومية (متوقع في حجوزات قديمة قبل ربط اليومية)', b.id::text,
       format('%s غرفة %s: مدفوع %s %s / في اليومية %s', b.guest_name, b.room, b.amount_paid, b.currency, coalesce(p.led, 0))
from bookings b left join per_booking p on p.booking_id = b.id::text and p.cur = b.currency
where coalesce(b.amount_paid, 0) <> coalesce(p.led, 0)
order by 1, 2, 3;
