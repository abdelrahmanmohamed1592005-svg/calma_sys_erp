-- ============================================================================
-- اختبارات قاعدة البيانات لمسارات الفلوس: التحصيل، التمديد، الإلغاء، طلب رد
-- الفلوس وقراره (رد / إبقاء)، الخروج المبكر، التسكين المكرر، وقفل "متحصّل".
-- كل حالة بتتنفّذ بصلاحية دور حقيقي (staff / reservations / gm / accounts) عن
-- طريق RLS والـ triggers الفعلية في schema.sql - مش محاكاة.
-- بتتشغّل بعد schema.sql وstub_supabase.sql (انظر run.sh).
-- ============================================================================
\set ON_ERROR_STOP on
\o /dev/null
drop schema if exists t cascade;
create schema t;
create table t.results (n serial primary key, label text, ok boolean, detail text);
create table t.ids (name text primary key, id uuid);
grant usage on schema t to public;
grant all on all tables in schema t to public;
grant all on all sequences in schema t to public;

create function t.chk(label text, ok boolean, detail text default '') returns void language sql as
$$ insert into t.results(label, ok, detail) values (label, coalesce(ok, false), detail) $$;
create function t.eq(label text, actual text, expected text) returns void language sql as
$$ select t.chk(label, actual is not distinct from expected, 'expected=' || coalesce(expected, 'NULL') || ' actual=' || coalesce(actual, 'NULL')) $$;
create function t.eqn(label text, actual numeric, expected numeric) returns void language sql as
$$ select t.chk(label, actual is not null and expected is not null and abs(actual - expected) < 0.005, 'expected=' || coalesce(expected::text, 'NULL') || ' actual=' || coalesce(actual::text, 'NULL')) $$;
-- العملية لازم تنجح (err فاضي) / لازم تفشل (وتحتوي على النص المتوقع في الرسالة)
create function t.pass(label text, err text) returns void language sql as
$$ select t.chk(label, err is null, 'unexpected error: ' || coalesce(err, '')) $$;
create function t.reject(label text, err text, pat text default null) returns void language sql as
$$ select t.chk(label, err is not null and (pat is null or position(pat in err) > 0), 'error=' || coalesce(err, 'NONE (operation succeeded!)') || case when pat is null then '' else ' expected-substring=' || pat end) $$;

create function t.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', (select id::text from profiles where username = u), false);
  execute 'set role authenticated';
end $$;

-- ينفّذ SQL بصلاحية مستخدم، ويرجّع نص الخطأ (أو null لو نجح)
create function t.try(u text, q text) returns text language plpgsql as $$
begin
  perform t.as_user(u);
  execute q;
  execute 'reset role';
  return null;
exception when others then
  execute 'reset role';
  return sqlerrm;
end $$;

create function t.ins(u text, nm text, room int, cin int, cout int, price numeric, total numeric,
                      paid numeric default 0, settled boolean default false, status text default 'مؤكد',
                      dup boolean default false, pm text default 'كاش') returns text language plpgsql as $$
declare v uuid;
begin
  perform t.as_user(u);
  insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, amount_paid, settled, status, currency, source, duplicate_placement, payment_method)
  values (room, nm, hotel_today() + cin, hotel_today() + cout, price, total, paid, settled, status, 'USD', 'مباشر', dup, pm)
  returning id into v;
  execute 'reset role';
  insert into t.ids values (nm, v);
  return null;
exception when others then
  execute 'reset role';
  return sqlerrm;
end $$;

create function t.upd(u text, nm text, setc text) returns text language plpgsql as $$
declare v uuid; n int;
begin
  select id into v from t.ids where name = nm;
  perform t.as_user(u);
  execute format('update bookings set %s where id = %L', setc, v);
  get diagnostics n = row_count;
  execute 'reset role';
  if n = 0 then return 'NO_ROWS_UPDATED'; end if;
  return null;
exception when others then
  execute 'reset role';
  return sqlerrm;
end $$;

create function t.dml(u text, q text) returns text language plpgsql as $$
declare n int;
begin
  perform t.as_user(u);
  execute q;
  get diagnostics n = row_count;
  execute 'reset role';
  if n = 0 then return 'NO_ROWS'; end if;
  return null;
exception when others then
  execute 'reset role';
  return sqlerrm;
end $$;

create function t.f(nm text, col text) returns text language plpgsql as $$
declare r text;
begin
  execute format('select %I::text from bookings where id = (select id from t.ids where name = %L)', col, nm) into r;
  return r;
end $$;
create function t.fn(nm text, col text) returns numeric language sql as $$ select t.f(nm, col)::numeric $$;

create function t.decide(u text, nm text, decision text, method text default null, expected timestamptz default null) returns text language plpgsql as $$
declare v uuid; res jsonb;
begin
  select id into v from t.ids where name = nm;
  perform t.as_user(u);
  select decide_booking_refund(v, decision, expected, method) into res;
  execute 'reset role';
  perform set_config('t.last_decision', res::text, false);
  return null;
exception when others then
  execute 'reset role';
  return sqlerrm;
end $$;

-- ---------------------------------------------------------------- المستخدمين
insert into auth.users(id, email)
select gen_random_uuid(), u || '@calma.internal' from unnest(array['gm1', 'res1', 'st1', 'st2', 'acc1']) u;
insert into profiles(id, username, name, role)
select (select id from auth.users where email = u || '@calma.internal'), u, u, r
from (values ('gm1', 'gm'), ('res1', 'reservations'), ('st1', 'staff'), ('st2', 'staff'), ('acc1', 'accounts')) v(u, r);

-- شيفت مفتوح النهارده لموظف st1 (يومية فيها صف تحصيل كاش دولار لغرفة 604)
insert into shift_claims(date, shift_key, username, name) values (hotel_today(), 'morning', 'st1', 'st1');
insert into shift_records(date, shift_key, staff_name, staff_username, rows)
values (hotel_today(), 'morning', 'st1', 'st1', jsonb_build_array(
  jsonb_build_object('room', 604, 'expenseDesc', '', 'expenseAmt', '', 'expenseCategory', 'أخرى', 'expenseCurrency', 'EGP',
    'collectionDesc', 'تحصيل B1', 'collectionAmt', 300, 'collectionMethod', 'كاش', 'collectionCurrency', 'USD',
    'paymentDetails', '{}'::jsonb, 'notes', '')));

-- ======================================================================
-- A) التحصيل والتمديد وقفل "متحصّل بالكامل"
-- ======================================================================
select t.pass('A1 موظف يضيف حجز ٣ ليالي', t.ins('st1', 'A1', 601, 0, 3, 100, 300));
select t.pass('A2 موظف يحصّل كامل المبلغ ويعلّم متحصّل', t.upd('st1', 'A1', 'amount_paid = 300, settled = true'));
select t.reject('A3 موظف يعلّم متحصّل والمدفوع أقل من الإجمالي', t.ins('st1', 'A3', 602, 0, 1, 100, 100, 50, true), 'مينفعش');
select t.reject('A4 مدير الحجوزات ميغيّرش المدفوع', t.upd('res1', 'A1', 'amount_paid = 100'), 'موظف الشيفت');
select t.reject('A5 مدير الحجوزات ميشيلش علامة متحصّل بدون سبب (الإجمالي مغطّى)', t.upd('res1', 'A1', 'settled = false'), 'موظف الشيفت');
select t.pass('A6 مدير الحجوزات يمدّد ليلة ويشيل علامة متحصّل (المتبقي ظاهر)', t.upd('res1', 'A1', 'checkout = hotel_today() + 4, total_room = 400, settled = false'));
select t.eqn('A6 المدفوع ما اتغيّرش', t.fn('A1', 'amount_paid'), 300);
select t.eq('A6 مفيش طلب رد فلوس بسبب تمديد', t.f('A1', 'refund_pending'), 'false');
select t.pass('A7 موظف يحصّل الفرق ويعلّم متحصّل', t.upd('st1', 'A1', 'amount_paid = 400, settled = true'));
select t.reject('A7 مدير الحجوزات يمدّد وعلامة متحصّل لسه true (متبقي جديد)', t.upd('res1', 'A1', 'checkout = hotel_today() + 5, total_room = 500'), 'مينفعش');
select t.pass('A8 موظف يضيف حجز', t.ins('st1', 'A8', 603, 0, 2, 100, 200));
select t.reject('A8 تمديد مجاني (من غير زيادة السعر) مرفوض', t.upd('st1', 'A8', 'checkout = hotel_today() + 3'), 'تعديل بيانات الحجز الأساسية');
select t.reject('A8 تمديد بسعر غلط مرفوض', t.upd('st1', 'A8', 'checkout = hotel_today() + 3, total_room = 350'), 'تعديل بيانات الحجز الأساسية');
select t.pass('A8 تمديد صحيح بنفس سعر الليلة', t.upd('st1', 'A8', 'checkout = hotel_today() + 3, total_room = 300'));
select t.reject('A9 الموظف مينفعش يلغي حجز', t.upd('st1', 'A8', 'status = ''ملغي'''), 'مدير الحجوزات');
select t.reject('A10 المحاسبة مينفعش تعدّل حجز', t.upd('acc1', 'A8', 'notes = ''x'''), 'NO_ROWS_UPDATED');
select t.reject('A10 المدير العام مينفعش يعدّل حجز', t.upd('gm1', 'A8', 'notes = ''x'''), 'NO_ROWS_UPDATED');
select t.reject('A11 موظف مينفعش يغيّر سعر الليلة', t.upd('st1', 'A8', 'price_night = 10'), 'تعديل بيانات الحجز الأساسية');
select t.reject('A12 مدفوع سالب مرفوض', t.upd('st1', 'A8', 'amount_paid = -5'), 'check constraint');

-- ======================================================================
-- B) الإلغاء وطلب رد الفلوس وقراره
-- ======================================================================
select t.pass('B1 حجز مدفوع ومتحصّل بالكامل', t.ins('st1', 'B1', 604, 0, 3, 100, 300, 300, true));
update shift_records set booking_collections = jsonb_build_array(jsonb_build_object('id', 'seed', 'bookingId', (select id from t.ids where name = 'B1')))
  where date = hotel_today() and shift_key = 'morning';
select t.pass('B2 حجز غير مدفوع', t.ins('st1', 'B2', 605, 0, 2, 100, 200));
select t.pass('B2 مدير الحجوزات يلغي الحجز غير المدفوع', t.upd('res1', 'B2', 'status = ''ملغي'''));
select t.eq('B2 مفيش طلب رد (مفيش فلوس)', t.f('B2', 'refund_pending'), 'false');
select t.pass('B3 مدير الحجوزات يلغي الحجز المدفوع', t.upd('res1', 'B1', 'status = ''ملغي'''));
select t.eq('B3 طلب رد الفلوس اتفتح تلقائيًا', t.f('B1', 'refund_pending'), 'true');
select t.eq('B3 مفيش قرار لسه', t.f('B1', 'refund_decision'), null);
select t.reject('B4 موظف مايسحبش المدفوع من حجز عليه طلب رد', t.upd('st1', 'B1', 'amount_paid = 0'), 'مطلوب ردها');
select t.reject('B4 مدير الحجوزات برضه مايسحبش المدفوع بره قرار الرد', t.upd('res1', 'B1', 'amount_paid = 0'), 'مطلوب ردها');
select t.pass('B5 محاولة تصفير طلب الرد مباشرة (بتتجاهل)', t.upd('res1', 'B1', 'refund_pending = false, refunded_amount = 999, refund_decision = ''refunded'', refunded_by = ''x'''));
select t.eq('B5 طلب الرد لسه معلّق', t.f('B1', 'refund_pending'), 'true');
select t.eq('B5 المبلغ المردود ماتزورش', t.f('B1', 'refunded_amount'), null);
select t.eq('B5 القرار ماتزورش', t.f('B1', 'refund_decision'), null);

select t.reject('B6 موظف مايقررش الرد', t.decide('st1', 'B1', 'refund'), 'مدير الحجوزات');
select t.reject('B6 المدير العام مايقررش الرد', t.decide('gm1', 'B1', 'refund'), 'مدير الحجوزات');
select t.reject('B6 المحاسبة مايقررش الرد', t.decide('acc1', 'B1', 'refund'), 'مدير الحجوزات');
select t.reject('B7 قرار غير معروف', t.decide('res1', 'B1', 'maybe'), 'غير معروف');
select t.reject('B7 الحجز اتغيّر من حد تاني (expected قديم) => مرفوض', t.decide('res1', 'B1', 'refund', null, now() - interval '1 day'), 'اتغيّر');
select t.reject('B7 وسيلة رد طويلة بشكل غير معقول', t.decide('res1', 'B1', 'refund', repeat('x', 50)), 'وسيلة الدفع');

-- مفيش شيفت مفتوح => الرد مرفوض (ومفيش حاجة اتغيّرت)
select set_config('request.jwt.claim.sub', (select id::text from profiles where username = 'st1'), false);
set role authenticated;
update shift_records set closed = true where date = hotel_today() and shift_key = 'morning';
reset role;
select t.reject('B8 مفيش شيفت مفتوح => الرد مرفوض', t.decide('res1', 'B1', 'refund'), 'مفيش شيفت مفتوح');
select t.eq('B8 المدفوع ما اتخصمش', t.f('B1', 'amount_paid'), '300');
select t.eq('B8 الطلب لسه معلّق', t.f('B1', 'refund_pending'), 'true');
select set_config('request.jwt.claim.sub', (select id::text from profiles where username = 'res1'), false);
set role authenticated;
update shift_records set closed = false where date = hotel_today() and shift_key = 'morning';
reset role;

select t.pass('B9 مدير الحجوزات يرد الفلوس', t.decide('res1', 'B1', 'refund'));
select t.eq('B9 نتيجة القرار', current_setting('t.last_decision')::jsonb ->> 'decision', 'refunded');
select t.eqn('B9 المبلغ المردود في النتيجة', (current_setting('t.last_decision')::jsonb ->> 'amount')::numeric, 300);
select t.eqn('B9 المدفوع بقى صفر', t.fn('B1', 'amount_paid'), 0);
select t.eq('B9 علامة متحصّل اتشالت', t.f('B1', 'settled'), 'false');
select t.eq('B9 طلب الرد اتقفل', t.f('B1', 'refund_pending'), 'false');
select t.eq('B9 القرار اتسجّل', t.f('B1', 'refund_decision'), 'refunded');
select t.eqn('B9 المبلغ المردود اتسجّل', t.fn('B1', 'refunded_amount'), 300);
select t.eq('B9 مين رد', t.f('B1', 'refunded_by'), 'res1');
select t.eqn('B9 صف اليومية (غرفة 604) بقى صفر بعد خصم الرد', (select (el ->> 'collectionAmt')::numeric from shift_records s, jsonb_array_elements(s.rows) el where s.date = hotel_today() and el ->> 'room' = '604' limit 1), 0);
select t.chk('B9 وصف الرد اتضاف لصف اليومية', (select el ->> 'collectionDesc' like '%رد فلوس%' from shift_records s, jsonb_array_elements(s.rows) el where s.date = hotel_today() and el ->> 'room' = '604' limit 1));
select t.eqn('B9 اتسجّل الرد في booking_collections (مرتين: التحصيل الأصلي + الرد)', (select jsonb_array_length(booking_collections) from shift_records where date = hotel_today()), 2);
select t.reject('B10 نفس الطلب مايتقرّرش مرتين', t.decide('res1', 'B1', 'refund'), 'مفيش طلب رد');

select t.pass('B11 حجز مدفوع ٢٠٠ ومتحصّل', t.ins('st1', 'B11', 606, 0, 2, 100, 200, 200, true));
select t.pass('B11 يتلغي', t.upd('res1', 'B11', 'status = ''ملغي'''));
select t.pass('B11 مدير الحجوزات يرفض الرد (إبقاء الفلوس)', t.decide('res1', 'B11', 'keep'));
select t.eq('B11 قرار الإبقاء', t.f('B11', 'refund_decision'), 'kept');
select t.eqn('B11 المدفوع لسه ٢٠٠', t.fn('B11', 'amount_paid'), 200);
select t.eq('B11 الطلب اتقفل', t.f('B11', 'refund_pending'), 'false');
select t.eqn('B11 اليومية ما اتغيّرتش بسبب الإبقاء', (select jsonb_array_length(rows) from shift_records where date = hotel_today()), 1);
select t.pass('B12 فلوس اتضافت على حجز ملغي', t.upd('st1', 'B11', 'amount_paid = 300'));
select t.eq('B12 بتتحوّل لطلب رد من جديد', t.f('B11', 'refund_pending'), 'true');
select t.reject('B13 موظف مايرجّعش حجز ملغي', t.upd('st1', 'B2', 'status = ''مؤكد'''), 'استرجاع');
select t.pass('B13 مدير الحجوزات يرجّع حجز ملغي', t.upd('res1', 'B2', 'status = ''مؤكد'''));
select t.eq('B13 مفيش طلب رد بعد الاسترجاع', t.f('B2', 'refund_pending'), 'false');

select t.pass('B14 حجز مدفوع بفيزا', t.ins('st1', 'B14', 607, 0, 2, 50, 100, 100, true, 'مؤكد', false, 'فيزا'));
select t.pass('B14 يتلغي', t.upd('res1', 'B14', 'status = ''ملغي'''));
select t.pass('B14 رد بوسيلة كاش (غير وسيلة التحصيل)', t.decide('res1', 'B14', 'refund', 'كاش'));
select t.chk('B14 صف رد جديد بوسيلة الرد اتضاف لليومية', exists (select 1 from shift_records s, jsonb_array_elements(s.rows) el where s.date = hotel_today() and el ->> 'room' = '607' and (el ->> 'collectionAmt')::numeric = -100 and el ->> 'collectionMethod' = 'كاش' and el ->> 'collectionCurrency' = 'USD'));
select t.pass('B15 حجز غير مدفوع كامل (مدفوع ٤٠ من ٢٠٠) يتلغي', t.ins('st1', 'B15', 608, 0, 2, 100, 200, 40, false));
select t.pass('B15 يتلغي', t.upd('res1', 'B15', 'status = ''ملغي'''));
select t.pass('B15 رد المدفوع بس (٤٠)', t.decide('res1', 'B15', 'refund'));
select t.eqn('B15 المبلغ المردود ٤٠', (current_setting('t.last_decision')::jsonb ->> 'amount')::numeric, 40);

-- ======================================================================
-- C) الخروج المبكر والتسكين المكرر (بنفس التعديلات اللي الواجهة بتبعتها)
-- ======================================================================
-- نزيل قديم دخل من يومين ومحجوز لحد بعد يومين (٤ ليالي)، ودفع وسدّد بالكامل
select t.pass('C1 نزيل قديم ٤ ليالي مدفوع بالكامل', t.ins('st1', 'C1', 609, -2, 2, 100, 400, 400, true));
select t.pass('C2 موظف يقصّر إقامة النزيل القديم (غادر مبكرًا) بنفس سعر الليلة',
  t.upd('st1', 'C1', 'checkout = hotel_today(), total_room = 200, status = ''تم تسجيل الخروج'', left_early = true, notes = ''غادر مبكرًا'''));
select t.eqn('C2 إجمالي الغرفة اتحسب على الليالي اللي قعدها (٢)', t.fn('C1', 'total_room'), 200);
select t.eq('C2 طلب رد للزيادة المدفوعة اتفتح', t.f('C1', 'refund_pending'), 'true');
select t.chk('C2 تاريخ الخروج الأصلي اتحفظ للتراجع', (select pre_early_checkout = hotel_today() + 2 and pre_early_total = 400 from bookings where id = (select id from t.ids where name = 'C1')));
select t.pass('C3 الحجز الجديد (تسكين مكرر) على نفس الغرفة بعد التقصير', t.ins('st1', 'C3', 609, 0, 2, 120, 240, 0, false, 'مؤكد', true));
select t.eq('C3 معلّم تسكين مكرر', t.f('C3', 'duplicate_placement'), 'true');
select t.pass('C5 مدير الحجوزات يرد الزيادة (٢٠٠)', t.decide('res1', 'C1', 'refund'));
select t.eqn('C5 المبلغ المردود = المدفوع - الإجمالي الجديد', (current_setting('t.last_decision')::jsonb ->> 'amount')::numeric, 200);
select t.eqn('C5 المدفوع بقى مساوي الإجمالي', t.fn('C1', 'amount_paid'), 200);
select t.eq('C5 الحجز لسه متحصّل بالكامل (مفيش متبقي)', t.f('C1', 'settled'), 'true');
select t.eq('C5 الطلب اتقفل', t.f('C1', 'refund_pending'), 'false');
select t.eqn('C5 اليومية: صف غرفة 609 بالسالب -٢٠٠', (select (el ->> 'collectionAmt')::numeric from shift_records s, jsonb_array_elements(s.rows) el where s.date = hotel_today() and el ->> 'room' = '609' limit 1), -200);

-- تسكين مكرر بدون تقصير القديم => قيد منع الحجز المزدوج
select t.pass('C4 حجز قائم على غرفة 610', t.ins('st1', 'C4old', 610, 0, 2, 100, 200));
select t.reject('C4 حجز مزدوج لنفس الغرفة من غير تقصير مرفوض', t.ins('st1', 'C4', 610, 0, 1, 100, 100), 'bookings_no_overlap');

-- خروج مبكر في نفس يوم الدخول
select t.pass('C6 نزيل دخل النهارده ومدفوع', t.ins('st1', 'C6', 611, 0, 2, 100, 200, 200, true));
select t.pass('C6 يغادر في نفس اليوم (صفر ليالي، بيتحاسب ليلة واحدة)',
  t.upd('st1', 'C6', 'checkout = hotel_today(), total_room = 100, status = ''تم تسجيل الخروج'', left_early = true'));
select t.eq('C6 خروجه = دخوله', t.f('C6', 'checkout'), t.f('C6', 'checkin'));
select t.eq('C6 طلب رد للنص التاني (١٠٠)', t.f('C6', 'refund_pending'), 'true');
select t.pass('C6 حجز جديد على نفس الغرفة بدأ نفس اليوم', t.ins('st1', 'C6b', 611, 0, 1, 100, 100, 0, false, 'مؤكد', true));
select t.pass('C6 قرار رد الزيادة', t.decide('res1', 'C6', 'refund'));
select t.eqn('C6 المردود ١٠٠', (current_setting('t.last_decision')::jsonb ->> 'amount')::numeric, 100);

-- حجز مستقبلي: الخروج المبكر ممنوع على الموظف (إلغاء مقنّع)
select t.pass('C7 حجز مستقبلي (بعد ٣ أيام)', t.ins('st1', 'C7', 612, 3, 5, 100, 200, 0, false));
select t.reject('C7 الموظف مايقصّرش حجز مستقبلي', t.upd('st1', 'C7', 'checkout = hotel_today() + 4, total_room = 100, left_early = true'), 'الخروج المبكر مسموح بس');
select t.reject('C7 ولا يعلّم تسكين مكرر عليه', t.upd('st1', 'C7', 'duplicate_placement = true'), 'الخروج المبكر مسموح بس');
select t.pass('C7 مدير الحجوزات يقصّر الحجز المستقبلي', t.upd('res1', 'C7', 'checkout = hotel_today() + 4, total_room = 100'));

-- تراجع عن التقصير لو حفظ الحجز الجديد فشل (rollbackResolved في الواجهة)
select t.pass('C8 نزيل قديم غير مدفوع', t.ins('st1', 'C8', 613, -2, 2, 100, 400));
select t.pass('C8 تقصير', t.upd('st1', 'C8', 'checkout = hotel_today(), total_room = 200, status = ''تم تسجيل الخروج'', left_early = true, notes = ''n'''));
select t.pass('C8 تراجع كامل لنفس القيم الأصلية', t.upd('st1', 'C8', 'checkout = hotel_today() + 2, total_room = 400, status = ''مؤكد'', left_early = false, notes = '''''));
select t.chk('C8 ذاكرة التقصير اتمسحت بعد التراجع', (select pre_early_checkout is null and pre_early_total is null from bookings where id = (select id from t.ids where name = 'C8')));
select t.pass('C8b نزيل قديم مدفوع بالكامل', t.ins('st1', 'C8b', 614, -2, 2, 100, 400, 400, true));
select t.pass('C8b تقصير', t.upd('st1', 'C8b', 'checkout = hotel_today(), total_room = 200, status = ''تم تسجيل الخروج'', left_early = true'));
select t.eq('C8b طلب رد اتفتح بعد التقصير', t.f('C8b', 'refund_pending'), 'true');
select t.pass('C8b تراجع', t.upd('st1', 'C8b', 'checkout = hotel_today() + 2, total_room = 400, status = ''مؤكد'', left_early = false'));
select t.eq('C8b طلب الرد اتلغى بعد التراجع (المدفوع = الإجمالي)', t.f('C8b', 'refund_pending'), 'false');
select t.reject('C9 تراجع بإجمالي مختلف عن الأصلي مرفوض', t.upd('st1', 'C8', 'checkout = hotel_today() + 2, total_room = 100, status = ''مؤكد'', left_early = false'), 'تعديل بيانات الحجز الأساسية');
select t.pass('C10 نزيل جديد للتقصير بإجمالي غلط', t.ins('st1', 'C10', 615, -2, 2, 100, 400));
select t.reject('C10 تقصير بإجمالي غلط (تخفيض مجاني) مرفوض', t.upd('st1', 'C10', 'checkout = hotel_today(), total_room = 100, left_early = true'), 'تعديل بيانات الحجز الأساسية');

-- ======================================================================
-- D) تقصير/تخفيض من مدير الحجوزات وأثره على رد الفلوس
-- ======================================================================
select t.pass('D1 حجز ٤ ليالي مدفوع بالكامل', t.ins('st1', 'D1', 616, -1, 3, 100, 400, 400, true));
select t.pass('D1 مدير الحجوزات يقصّر لنص المدة', t.upd('res1', 'D1', 'checkout = hotel_today() + 1, total_room = 200'));
select t.eq('D1 طلب رد للزيادة', t.f('D1', 'refund_pending'), 'true');
select t.pass('D1 رد الزيادة', t.decide('res1', 'D1', 'refund'));
select t.eqn('D1 المردود ٢٠٠', (current_setting('t.last_decision')::jsonb ->> 'amount')::numeric, 200);
select t.eqn('D1 المدفوع = الإجمالي الجديد', t.fn('D1', 'amount_paid'), t.fn('D1', 'total_room'));
select t.pass('D2 حجز متحصّل بالكامل', t.ins('st1', 'D2', 601, 10, 12, 100, 200, 200, true));
select t.reject('D2 تخفيض السعر على حجز متحصّل مرفوض', t.upd('res1', 'D2', 'total_room = 100'), 'متحصّل بالكامل');
select t.reject('D2 وتغيير سعر الليلة على حجز متحصّل مرفوض', t.upd('res1', 'D2', 'price_night = 10'), 'متحصّل بالكامل');

-- ======================================================================
-- E) الرسوم الإضافية وقفل المتحصّل
-- ======================================================================
select t.pass('E1 حجز متحصّل', t.ins('st1', 'E1', 602, 10, 11, 100, 100, 100, true));
select t.reject('E1 رسوم إضافية على حجز متحصّل مرفوضة', t.upd('st1', 'E1', 'extras = ''{"laundry":0,"cafeteria":0,"tours":20,"pickup":0}''::jsonb'), 'متحصّل بالكامل');
select t.pass('E1 إلغاء علامة التحصيل', t.upd('st1', 'E1', 'settled = false'));
select t.pass('E1 إضافة رسوم بعد إلغاء العلامة', t.upd('st1', 'E1', 'extras = ''{"laundry":0,"cafeteria":0,"tours":20,"pickup":0}''::jsonb'));
select t.reject('E1 تعليم متحصّل قبل تحصيل الرسوم مرفوض', t.upd('st1', 'E1', 'settled = true'), 'مينفعش');
select t.pass('E1 تحصيل الفرق وتعليم متحصّل', t.upd('st1', 'E1', 'amount_paid = 120, settled = true'));
select t.reject('E2 رسوم سالبة مرفوضة', t.upd('st1', 'E1', 'settled = false, extras = ''{"laundry":-5,"cafeteria":0,"tours":0,"pickup":0}''::jsonb'), 'check constraint');
select t.pass('E3 حجز جديد', t.ins('st1', 'E3', 603, 10, 11, 100, 100));
select t.reject('E3 الموظف مايغيّرش تفاصيل الدفع (تعليم أونلاين)', t.upd('st1', 'E3', 'payment_details = ''{"senderName":"","senderNumber":"","ref":"","onlinePaid":true,"commissionPct":15}''::jsonb'), 'تعديل بيانات الحجز الأساسية');
select t.pass('E3 مدير الحجوزات يعلّمه مدفوع أونلاين', t.upd('res1', 'E3', 'payment_details = ''{"senderName":"","senderNumber":"","ref":"","onlinePaid":true,"commissionPct":15}''::jsonb'));
select t.pass('E3 الأونلاين مايحتاجش مدفوع للتعليم متحصّل', t.upd('st1', 'E3', 'settled = true'));
select t.pass('E4 نزيل قديم للأونلاين', t.ins('st1', 'E4', 604, -2, 2, 100, 400, 0, false));
select t.pass('E4 يعلّمه أونلاين', t.upd('res1', 'E4', 'payment_details = ''{"senderName":"","senderNumber":"","ref":"","onlinePaid":true,"commissionPct":15}''::jsonb'));
select t.pass('E4 يقصّر (غادر مبكرًا)', t.upd('st1', 'E4', 'checkout = hotel_today(), total_room = 200, status = ''تم تسجيل الخروج'', left_early = true'));
select t.eq('E4 مفيش طلب رد (مفيش مدفوع نقدي)', t.f('E4', 'refund_pending'), 'false');

-- ======================================================================
-- F) تطابق إعادة تسعير الإقامة (نفس معادلة الواجهة repricedTotalRoom)
-- ======================================================================
\ir more_flows.sql

create table t.reprice_cases (checkin date, checkout date, new_checkout date, total numeric, price numeric, expected numeric);
\o
