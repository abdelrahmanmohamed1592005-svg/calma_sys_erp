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


-- تجهيز حالة (مدفوع على الحجز) من غير جلسة مستخدم، زي محرر SQL/الصيانة: جلسات المستخدمين مقفولة على amount_paid (قسم ٣٥) إلا من دوال التحصيل والرد
create function t.maint(nm text, setc text) returns text language plpgsql as $$
declare v uuid; n int;
begin
  select id into v from t.ids where name = nm;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', false);
  execute format('update bookings set %s where id = %L', setc, v);
  get diagnostics n = row_count;
  if n = 0 then return 'NO_ROWS_UPDATED'; end if;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function t.maint_sql(q text) returns text language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', false);
  execute q;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function t.ins(u text, nm text, room int, cin int, cout int, price numeric, total numeric,
                      paid numeric default 0, settled boolean default false, status text default 'مؤكد',
                      dup boolean default false, pm text default 'كاش') returns text language plpgsql as $$
declare v uuid;
begin
  perform t.as_user(u);
  insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, amount_paid, settled, status, currency, source, duplicate_placement, payment_method)
  values (room, nm, hotel_today() + cin, hotel_today() + cout, price, total, 0, settled and paid = 0, status, 'USD', 'مباشر', dup, pm)
  returning id into v;
  execute 'reset role';
  insert into t.ids values (nm, v);
  if paid <> 0 then
    perform set_config('request.jwt.claim.sub', '', false);
    update bookings set amount_paid = paid where id = v;
  end if;
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
select t.pass('A2 موظف يحصّل كامل المبلغ ويعلّم متحصّل', t.maint('A1', 'amount_paid = 300'));
select t.pass('A3 حجز مدفوع جزء منه: الحالة بتتحسب لوحدها (مش متحصّل)', t.ins('st1', 'A3', 602, 0, 1, 100, 100, 50, true));
select t.eq('A3 العلامة اللي اتبعتت true اتتجاهلت: المدفوع أقل فالحالة false', t.f('A3', 'settled'), 'false');
select t.reject('A4 مدير الحجوزات ميغيّرش المدفوع', t.upd('res1', 'A1', 'amount_paid = 100'), 'مش بتعديل مباشر');
select t.pass('A5 مدير الحجوزات يحاول يشيل العلامة يدويًا: بتتتجاهل (الإجمالي مغطّى فالحالة تفضل متحصّل)', t.upd('res1', 'A1', 'settled = false'));
select t.eq('A5 الحالة لسه متحصّل بالكامل تلقائيًا', t.f('A1', 'settled'), 'true');
select t.pass('A6 مدير الحجوزات يمدّد ليلة ويشيل علامة متحصّل (المتبقي ظاهر)', t.upd('res1', 'A1', 'checkout = hotel_today() + 4, total_room = 400, settled = false'));
select t.eqn('A6 المدفوع ما اتغيّرش', t.fn('A1', 'amount_paid'), 300);
select t.eq('A6 مفيش طلب رد فلوس بسبب تمديد', t.f('A1', 'refund_pending'), 'false');
select t.pass('A7 موظف يحصّل الفرق ويعلّم متحصّل', t.maint('A1', 'amount_paid = 400'));
select t.pass('A7 مدير الحجوزات يمدّد تاني: الحالة بتتحوّل لـ متبقي تلقائيًا', t.upd('res1', 'A1', 'checkout = hotel_today() + 5, total_room = 500'));
select t.eq('A7 بقى فيه متبقي فالحالة false', t.f('A1', 'settled'), 'false');
select t.pass('A8 موظف يضيف حجز', t.ins('st1', 'A8', 603, 0, 2, 100, 200));
select t.reject('A8 تمديد مجاني (من غير زيادة السعر) مرفوض', t.upd('st1', 'A8', 'checkout = hotel_today() + 3'), 'تعديل بيانات الحجز الأساسية');
select t.reject('A8 تمديد بسعر غلط مرفوض', t.upd('st1', 'A8', 'checkout = hotel_today() + 3, total_room = 350'), 'تعديل بيانات الحجز الأساسية');
select t.pass('A8 تمديد صحيح بنفس سعر الليلة', t.upd('st1', 'A8', 'checkout = hotel_today() + 3, total_room = 300'));
select t.reject('A9 الموظف مينفعش يلغي حجز', t.upd('st1', 'A8', 'status = ''ملغي'''), 'مدير الحجوزات');
select t.reject('A10 المحاسبة مينفعش تعدّل حجز', t.upd('acc1', 'A8', 'notes = ''x'''), 'NO_ROWS_UPDATED');
select t.reject('A10 المدير العام مينفعش يعدّل حجز', t.upd('gm1', 'A8', 'notes = ''x'''), 'NO_ROWS_UPDATED');
select t.reject('A11 موظف مينفعش يغيّر سعر الليلة', t.upd('st1', 'A8', 'price_night = 10'), 'تعديل بيانات الحجز الأساسية');
select t.reject('A12 مدفوع سالب مرفوض (قيد قاعدة البيانات نفسه)', t.maint('A8', 'amount_paid = -5'), 'check constraint');
select t.reject('A12 والموظف مايكتبش المدفوع مباشرة أصلًا', t.upd('st1', 'A8', 'amount_paid = 5'), 'مش بتعديل مباشر');

-- ======================================================================
-- B) الإلغاء: مفيش رد فلوس (من قسم ٣٩) - الفلوس المتحصّلة بتفضل في الفندق
-- ======================================================================
select t.pass('B1 حجز مدفوع ومتحصّل بالكامل', t.ins('st1', 'B1', 604, 0, 3, 100, 300, 300, true));
update shift_records set booking_collections = jsonb_build_array(jsonb_build_object('id', 'seed', 'bookingId', (select id from t.ids where name = 'B1')))
  where date = hotel_today() and shift_key = 'morning';
select t.pass('B2 حجز غير مدفوع', t.ins('st1', 'B2', 605, 0, 2, 100, 200));
select t.pass('B2 مدير الحجوزات يلغي الحجز غير المدفوع', t.upd('res1', 'B2', 'status = ''ملغي'''));
select t.eq('B2 مفيش طلب رد', t.f('B2', 'refund_pending'), 'false');
select t.pass('B3 مدير الحجوزات يلغي الحجز المدفوع', t.upd('res1', 'B1', 'status = ''ملغي'''));
select t.eq('B3 مفيش طلب رد فلوس (الفلوس فضلت في الفندق)', t.f('B1', 'refund_pending'), 'false');
select t.eqn('B3 المدفوع لسه ٣٠٠', t.fn('B1', 'amount_paid'), 300);
select t.reject('B4 موظف مايسحبش المدفوع من حجز ملغي', t.upd('st1', 'B1', 'amount_paid = 0'), 'مش بتعديل مباشر');
select t.reject('B4 مدير الحجوزات برضه مايسحبش المدفوع', t.upd('res1', 'B1', 'amount_paid = 0'), 'مش بتعديل مباشر');
select t.pass('B5 محاولة تزوير بيانات رد مباشرة (بتتجاهل)', t.upd('res1', 'B1', 'refund_pending = true, refunded_amount = 999, refund_decision = ''refunded'', refunded_by = ''x'''));
select t.eq('B5 مفيش طلب رد', t.f('B1', 'refund_pending'), 'false');
select t.eq('B5 المبلغ المردود ماتزورش', t.f('B1', 'refunded_amount'), null);
select t.eq('B5 القرار ماتزورش', t.f('B1', 'refund_decision'), null);
select t.reject('B6 دالة رد الفلوس اتقفلت لمدير الحجوزات', t.decide('res1', 'B1', 'refund'), 'permission denied');
select t.reject('B6 ولموظف الشيفت', t.decide('st1', 'B1', 'refund'), 'permission denied');
select t.eqn('B6 اليومية ما اتغيّرتش', (select (el ->> 'collectionAmt')::numeric from shift_records s, jsonb_array_elements(s.rows) el where s.date = hotel_today() and el ->> 'room' = '604' limit 1), 300);
select t.pass('B12 فلوس اتضافت على حجز ملغي', t.maint('B1', 'amount_paid = 350'));
select t.eq('B12 برضه مفيش طلب رد', t.f('B1', 'refund_pending'), 'false');
select t.pass('B12 رجوع للمدفوع الأصلي', t.maint('B1', 'amount_paid = 300'));
select t.reject('B13 موظف مايرجّعش حجز ملغي', t.upd('st1', 'B2', 'status = ''مؤكد'''), 'استرجاع');
select t.pass('B13 مدير الحجوزات يرجّع حجز ملغي', t.upd('res1', 'B2', 'status = ''مؤكد'''));
select t.eq('B13 مفيش طلب رد بعد الاسترجاع', t.f('B2', 'refund_pending'), 'false');

-- ======================================================================
-- C) الخروج المبكر والتسكين المكرر (بنفس التعديلات اللي الواجهة بتبعتها)
-- ======================================================================
-- نزيل قديم دخل من يومين ومحجوز لحد بعد يومين (٤ ليالي)، ودفع وسدّد بالكامل
select t.pass('C1 نزيل قديم ٤ ليالي مدفوع بالكامل', t.ins('st1', 'C1', 609, -2, 2, 100, 400, 400, true));
select t.pass('C2 موظف يقصّر إقامة النزيل القديم (غادر مبكرًا) بنفس سعر الليلة',
  t.upd('st1', 'C1', 'checkout = hotel_today(), total_room = 200, status = ''تم تسجيل الخروج'', left_early = true, notes = ''غادر مبكرًا'''));
select t.eqn('C2 إجمالي الغرفة اتحسب على الليالي اللي قعدها (٢)', t.fn('C1', 'total_room'), 200);
select t.eq('C2 مفيش طلب رد للزيادة (فضلت في الفندق)', t.f('C1', 'refund_pending'), 'false');
select t.eqn('C2 المدفوع لسه ٤٠٠', t.fn('C1', 'amount_paid'), 400);
select t.eq('C2 الحجز متحصّل بالكامل', t.f('C1', 'settled'), 'true');
select t.chk('C2 تاريخ الخروج الأصلي اتحفظ للتراجع', (select pre_early_checkout = hotel_today() + 2 and pre_early_total = 400 from bookings where id = (select id from t.ids where name = 'C1')));
select t.pass('C3 الحجز الجديد (تسكين مكرر) على نفس الغرفة بعد التقصير', t.ins('st1', 'C3', 609, 0, 2, 120, 240, 0, false, 'مؤكد', true));
select t.eq('C3 معلّم تسكين مكرر', t.f('C3', 'duplicate_placement'), 'true');

-- تسكين مكرر بدون تقصير القديم => قيد منع الحجز المزدوج
select t.pass('C4 حجز قائم على غرفة 610', t.ins('st1', 'C4old', 610, 0, 2, 100, 200));
select t.reject('C4 حجز مزدوج لنفس الغرفة من غير تقصير مرفوض', t.ins('st1', 'C4', 610, 0, 1, 100, 100), 'bookings_no_overlap');

-- خروج مبكر في نفس يوم الدخول
select t.pass('C6 نزيل دخل النهارده ومدفوع', t.ins('st1', 'C6', 611, 0, 2, 100, 200, 200, true));
select t.pass('C6 يغادر في نفس اليوم (صفر ليالي، بيتحاسب ليلة واحدة)',
  t.upd('st1', 'C6', 'checkout = hotel_today(), total_room = 100, status = ''تم تسجيل الخروج'', left_early = true'));
select t.eq('C6 خروجه = دخوله', t.f('C6', 'checkout'), t.f('C6', 'checkin'));
select t.eq('C6 مفيش طلب رد', t.f('C6', 'refund_pending'), 'false');
select t.pass('C6 حجز جديد على نفس الغرفة بدأ نفس اليوم', t.ins('st1', 'C6b', 611, 0, 1, 100, 100, 0, false, 'مؤكد', true));

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
select t.pass('C8b تراجع', t.upd('st1', 'C8b', 'checkout = hotel_today() + 2, total_room = 400, status = ''مؤكد'', left_early = false'));
select t.eqn('C8b الإجمالي رجع ٤٠٠', t.fn('C8b', 'total_room'), 400);
select t.reject('C9 تراجع بإجمالي مختلف عن الأصلي مرفوض', t.upd('st1', 'C8', 'checkout = hotel_today() + 2, total_room = 100, status = ''مؤكد'', left_early = false'), 'تعديل بيانات الحجز الأساسية');
select t.pass('C10 نزيل جديد للتقصير بإجمالي غلط', t.ins('st1', 'C10', 615, -2, 2, 100, 400));
select t.reject('C10 تقصير بإجمالي غلط (تخفيض مجاني) مرفوض', t.upd('st1', 'C10', 'checkout = hotel_today(), total_room = 100, left_early = true'), 'تعديل بيانات الحجز الأساسية');

-- ======================================================================
-- D) تقصير/تخفيض من مدير الحجوزات: الزيادة المدفوعة بتفضل في الفندق
-- ======================================================================
select t.pass('D1 حجز ٤ ليالي مدفوع بالكامل', t.ins('st1', 'D1', 616, -1, 3, 100, 400, 400, true));
select t.pass('D1 مدير الحجوزات يقصّر لنص المدة', t.upd('res1', 'D1', 'checkout = hotel_today() + 1, total_room = 200'));
select t.eq('D1 مفيش طلب رد', t.f('D1', 'refund_pending'), 'false');
select t.eqn('D1 المدفوع لسه ٤٠٠', t.fn('D1', 'amount_paid'), 400);
select t.pass('D2 حجز متحصّل بالكامل', t.ins('st1', 'D2', 601, 10, 12, 100, 200, 200, true));
select t.pass('D2 تخفيض السعر على حجز مدفوع: مسموح', t.upd('res1', 'D2', 'total_room = 100'));
select t.eq('D2 مفيش طلب رد', t.f('D2', 'refund_pending'), 'false');
select t.eq('D2 الحالة لسه مدفوع بالكامل', t.f('D2', 'settled'), 'true');
select t.pass('D2 تغيير سعر الليلة: مسموح (مفيش قفل تاني)', t.upd('res1', 'D2', 'price_night = 10'));

-- ======================================================================
-- E) الرسوم الإضافية وقفل المتحصّل
-- ======================================================================
select t.pass('E1 حجز متحصّل', t.ins('st1', 'E1', 602, 10, 11, 100, 100, 100, true));
select t.pass('E1 رسوم إضافية على حجز مدفوع: مسموحة والحالة بتتحوّل لمتبقي تلقائيًا', t.upd('st1', 'E1', 'extras = ''{"laundry":0,"cafeteria":0,"tours":20,"pickup":0}''::jsonb'));
select t.eq('E1 بقى متبقي ٢٠ فالحالة false', t.f('E1', 'settled'), 'false');
select t.pass('E1 إلغاء علامة التحصيل', t.upd('st1', 'E1', 'settled = false'));
select t.pass('E1 إضافة رسوم بعد إلغاء العلامة', t.upd('st1', 'E1', 'extras = ''{"laundry":0,"cafeteria":0,"tours":20,"pickup":0}''::jsonb'));
select t.pass('E1 محاولة تعليم متحصّل يدويًا قبل تحصيل الرسوم: بتتتجاهل', t.upd('st1', 'E1', 'settled = true'));
select t.eq('E1 الحالة لسه متبقي', t.f('E1', 'settled'), 'false');
select t.pass('E1 تحصيل الفرق وتعليم متحصّل', t.maint('E1', 'amount_paid = 120'));
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
-- G) قسم ٣٩: الدفع بعملة تانية، نقل النزيل، الأونلاين، الشيفت اللي معاده خلص
-- ======================================================================
create function t.fx(u text, nm text, amt numeric, cur text, meth text default 'كاش') returns text language plpgsql as $$
declare v uuid; res jsonb;
begin
  select id into v from t.ids where name = nm;
  perform t.as_user(u);
  select record_booking_payment_other(v, amt, cur, meth) into res;
  execute 'reset role';
  perform set_config('t.last_fx', res::text, false);
  return null;
exception when others then
  execute 'reset role';
  return sqlerrm;
end $$;
create function t.mv(u text, nm text, room int) returns text language plpgsql as $$
declare v uuid;
begin
  select id into v from t.ids where name = nm;
  perform t.as_user(u);
  perform move_booking_room(v, room);
  execute 'reset role';
  return null;
exception when others then
  execute 'reset role';
  return sqlerrm;
end $$;

-- كل حاجة بعملتها: حجز بالدولار + غسيل 200 جنيه + كافيتيريا 50 جنيه - من غير أي سعر صرف
select t.pass('G1 حجز ١٢٠ دولار', t.ins('st1', 'G1', 601, 60, 62, 60, 120));
select t.pass('G1 الموظف يضيف غسيل وكافيتيريا بالجنيه', t.upd('st1', 'G1', 'other_charges = ''{"EGP":{"laundry":200,"cafeteria":50,"tours":0,"pickup":0}}''::jsonb'));
select t.reject('G1 الموظف مايكتبش المدفوع بالجنيه مباشرة', t.upd('st1', 'G1', 'other_paid = ''{"EGP":250}''::jsonb'), 'مش بتعديل مباشر');
select t.reject('G1 خدمة بعملة الحجز مكانها الخدمات العادية', t.upd('st1', 'G1', 'other_charges = ''{"USD":{"laundry":5}}''::jsonb'), 'بعملة الحجز');
select t.reject('G1 خدمة بمبلغ سالب مرفوضة', t.upd('st1', 'G1', 'other_charges = ''{"EGP":{"laundry":-5}}''::jsonb'), 'صفر أو أكتر');
select t.reject('G1 مدير الحجوزات مايسجّلش تحصيل', t.fx('res1', 'G1', 100, 'EGP'), 'موظف الشيفت');
select t.reject('G1 عملة الحجز من الدفع العادي', t.fx('st1', 'G1', 50, 'USD'), 'عملة الحجز');
select t.reject('G1 عملة مفيش عليها خدمات', t.fx('st1', 'G1', 50, 'EUR'), 'مفيش متبقي');
select t.reject('G1 أكبر من المتبقي بالجنيه مرفوض', t.fx('st1', 'G1', 300, 'EGP'), 'أكبر من المتبقي');
select t.eq('G1 الحالة مش مدفوعة', t.f('G1', 'settled'), 'false');
select t.pass('G2 دفع ١٠٠ جنيه (بتسدّد الكافيتيريا ٥٠ الأول)', t.fx('st1', 'G1', 100, 'EGP'));
select t.eqn('G2 منها كافيتيريا ٥٠', (current_setting('t.last_fx', true)::jsonb ->> 'cafeteria')::numeric, 50);
select t.eqn('G2 المتبقي بالجنيه ١٥٠', (current_setting('t.last_fx', true)::jsonb ->> 'left')::numeric, 150);
select t.eqn('G2 المدفوع بالجنيه', (select (other_paid ->> 'EGP')::numeric from bookings where id = (select id from t.ids where name = 'G1')), 100);
select t.eqn('G2 المدفوع بالدولار ما اتلمسش', t.fn('G1', 'amount_paid'), 0);
select t.chk('G2 صف اليومية بالجنيه ٥٠ (غرفة) وصف كافيتيريا بالجنيه ٥٠ - من غير تحويل', exists (select 1 from shift_records s, jsonb_array_elements(s.rows) el where s.date = hotel_today() and el ->> 'room' = '601' and el ->> 'bookingId' = (select id::text from t.ids where name = 'G1')
  and (el ->> 'collectionAmt')::numeric = 50 and el ->> 'collectionCurrency' = 'EGP') and exists (select 1 from shift_records s, jsonb_array_elements(s.cafeteria_rows) el where el ->> 'bookingId' = (select id::text from t.ids where name = 'G1') and (el ->> 'collectionAmt')::numeric = 50 and el ->> 'collectionCurrency' = 'EGP'));
select t.pass('G2 حفظ الخدمات من الشاشة (من غير cafeteriaPaid) مابيمسحش اللي اتحصّل', t.upd('st1', 'G1', 'other_charges = ''{"EGP":{"laundry":200,"cafeteria":50,"tours":0,"pickup":0}}''::jsonb'));
select t.eq('G2 cafeteriaPaid فضل ٥٠', (select other_charges #>> '{EGP,cafeteriaPaid}' from bookings where id = (select id from t.ids where name = 'G1')), '50');
select t.pass('G3 باقي الجنيه ١٥٠', t.fx('st1', 'G1', 150, 'EGP', 'كاش'));
select t.eq('G3 لسه مش مدفوع بالكامل (الدولار لسه)', t.f('G1', 'settled'), 'false');
select t.pass('G3 الدولار بالدفع العادي', t.maint('G1', 'amount_paid = 120'));
select t.eq('G3 مدفوع بالكامل لما كل العملات اتغطّت', t.f('G1', 'settled'), 'true');
select t.reject('G3 حجز عليه مدفوع بالجنيه مايتمسحش', t.dml('res1', $q$delete from bookings where guest_name = 'G1'$q$), 'حركة فلوس');
select t.reject('G3 دالة سعر الصرف القديمة اتقفلت', t.try('st1', $q$select record_booking_payment_fx((select id from t.ids where name = 'G1'), 10, 'EUR', 1, 'كاش')$q$), 'permission denied');

select t.pass('G4 حجز تاني في غرفة 602', t.ins('st1', 'G4', 602, 60, 63, 100, 300));
select t.pass('G4 حجز على غرفة 603 بعد يومين', t.ins('st1', 'G4x', 603, 62, 64, 100, 200));
select t.reject('G5 نقل لغرفة مشغولة في نفس التواريخ مرفوض', t.mv('st1', 'G4', 603), 'مش فاضية');
select t.reject('G5 نقل لنفس الغرفة مرفوض', t.mv('st1', 'G4', 602), 'أصلًا');
select t.reject('G5 المحاسبة ماتنقلش', t.mv('acc1', 'G4', 604), 'صلاحية');
select t.pass('G6 موظف الشيفت ينقل النزيل لغرفة 604', t.mv('st1', 'G4', 604));
select t.eq('G6 الحجز بقى في 623', t.f('G4', 'room'), '604');
select t.pass('G6 غرفة 602 فضيت: حجز جديد عليها نفس التواريخ', t.ins('st1', 'G6new', 602, 60, 63, 100, 300));
select t.reject('G6 الموظف مايغيّرش الغرفة بتعديل مباشر', t.upd('st1', 'G4', 'room = 605'), 'تعديل بيانات الحجز الأساسية');
select t.pass('G7 مدير الحجوزات ينقل', t.mv('res1', 'G4', 605));
select t.reject('G7 حجز ملغي مايتنقلش', t.mv('res1', 'B1', 606), 'ملغي');

-- الأونلاين: المدفوع أونلاين بيغطي الغرفة بس، والتمديد بعدها بيتحصّل في الفندق
select t.pass('G8 حجز أونلاين ٢٠٠', t.ins('st1', 'G8', 606, 60, 62, 100, 200));
select t.pass('G8 يتعلّم مدفوع أونلاين بمبلغ الغرفة', t.upd('res1', 'G8', 'payment_details = ''{"senderName":"","senderNumber":"","ref":"","onlinePaid":true,"commissionPct":15,"onlineRoomAmount":200}''::jsonb'));
select t.eqn('G8 المطلوب في الفندق صفر', (select booking_hotel_total(b) from bookings b where id = (select id from t.ids where name = 'G8')), 0);
select t.pass('G9 تمديد ليلة (٣٠٠)', t.upd('res1', 'G8', 'checkout = hotel_today() + 63, total_room = 300'));
select t.eqn('G9 الليلة الزيادة مطلوبة في الفندق', (select booking_hotel_total(b) from bookings b where id = (select id from t.ids where name = 'G8')), 100);
select t.pass('G10 حجز أونلاين قديم من غير مبلغ الغرفة', t.ins('st1', 'G10', 607, 60, 62, 100, 200));
select t.pass('G10 يتعلّم أونلاين', t.upd('res1', 'G10', 'payment_details = ''{"senderName":"","senderNumber":"","ref":"","onlinePaid":true,"commissionPct":15}''::jsonb'));
select t.pass('G10 تمديد', t.upd('res1', 'G10', 'checkout = hotel_today() + 63, total_room = 300'));
select t.eq('G10 مبلغ الأونلاين اتثبّت على الإجمالي القديم', (select payment_details ->> 'onlineRoomAmount' from bookings where id = (select id from t.ids where name = 'G10')), '200');
select t.eqn('G10 الليلة الزيادة مطلوبة في الفندق', (select booking_hotel_total(b) from bookings b where id = (select id from t.ids where name = 'G10')), 100);

-- شيفت معاده خلص: مايتلغيش اختياره ولا تتمسح يوميته
insert into shift_claims(date, shift_key, username, name) values (hotel_today() - 3, 'evening', 'st2', 'st2');
select t.reject('G11 إلغاء اختيار شيفت معاده خلص مرفوض', t.dml('gm1', 'delete from shift_claims where date = hotel_today() - 3 and shift_key = ''evening'''), 'معاد الشيفت');
insert into shift_claims(date, shift_key, username, name) values (hotel_today() + 3, 'evening', 'st2', 'st2');
select t.pass('G12 إلغاء اختيار شيفت لسه جاي مسموح', t.dml('gm1', 'delete from shift_claims where date = hotel_today() + 3 and shift_key = ''evening'''));
select t.eqn('G13 نهاية الشيفت الليلي بعد نهاية الصباحي بـ ١٦ ساعة', extract(epoch from calma_shift_end(date '2026-10-20', 'night') - calma_shift_end(date '2026-10-20', 'morning')) / 3600, 16);

-- ======================================================================
-- F) تطابق إعادة تسعير الإقامة (نفس معادلة الواجهة repricedTotalRoom)
-- ======================================================================
\ir more_flows.sql
\ir guests_and_rows.sql
\ir cafeteria_flows.sql
\ir move_cafeteria_flows.sql

create table t.reprice_cases (checkin date, checkout date, new_checkout date, total numeric, price numeric, expected numeric);
\o
