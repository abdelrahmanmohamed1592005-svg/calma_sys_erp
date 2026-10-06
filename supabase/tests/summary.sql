-- تطابق إعادة تسعير الإقامة بين قاعدة البيانات والواجهة (الحالات من reprice_cases.json)
insert into t.results(label, ok, detail)
select format('F reprice_total %s -> %s (إجمالي %s، سعر %s)', checkin, new_checkout, total, price),
       abs(reprice_total(jsonb_populate_record(null::bookings, jsonb_build_object('checkin', checkin, 'checkout', checkout, 'total_room', total, 'price_night', price)), new_checkout) - expected) < 0.005,
       format('expected=%s actual=%s', expected, reprice_total(jsonb_populate_record(null::bookings, jsonb_build_object('checkin', checkin, 'checkout', checkout, 'total_room', total, 'price_night', price)), new_checkout))
from t.reprice_cases;

\echo ''
\echo '=== الاختبارات الفاشلة ==='
select n, label, detail from t.results where not ok order by n;
\echo '=== الملخص ==='
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from t.results;
do $$ begin
  if exists (select 1 from t.results where not ok) then raise exception 'فيه اختبارات قاعدة بيانات فشلت'; end if;
end $$;
