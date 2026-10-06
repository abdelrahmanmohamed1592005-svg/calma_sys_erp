-- ======================================================================
-- أكواد الأفراد (booking_guests)
-- ======================================================================
select t.pass('GU1 موظف يضيف حجز ٣ أفراد', t.dml('st1', $q$insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, pax, currency, source) values (601, 'GU1', hotel_today() + 100, hotel_today() + 102, 50, 100, 3, 'USD', 'مباشر')$q$));
create function t.gid(nm text) returns uuid language sql as $$ select id from bookings where guest_name = nm $$;
select t.eqn('GU1 اتولّد ٣ أكواد (واحد لكل فرد)', (select count(*) from booking_guests where booking_id = t.gid('GU1')), 3);
select t.chk('GU1 الأكواد بصيغة C + ٦ حروف/أرقام وفريدة', (select bool_and(code ~ '^C[A-Z2-9]{6}$') and count(distinct code) = 3 from booking_guests where booking_id = t.gid('GU1')));
select t.eq('GU1 الترقيم ١..٣', (select string_agg(seq::text, ',' order by seq) from booking_guests where booking_id = t.gid('GU1')), '1,2,3');
select t.chk('GU1 كل كود مربوط بغرفة الحجز', (select bool_and(room = 601) from booking_guests where booking_id = t.gid('GU1')));

create temp table t_codes as select seq, code from booking_guests where booking_id = t.gid('GU1');
grant all on t_codes to public;
select t.pass('GU2 مدير الحجوزات يخفّض الأفراد لـ ٢', t.dml('res1', $q$update bookings set pax = 2 where guest_name = 'GU1'$q$));
select t.eqn('GU2 اتشال كود الفرد الأخير بس', (select count(*) from booking_guests where booking_id = t.gid('GU1')), 2);
select t.chk('GU2 أكواد الفردين الأول والتاني ماتغيّرتش', (select count(*) = 2 from booking_guests g join t_codes c on c.seq = g.seq and c.code = g.code where g.booking_id = t.gid('GU1')));
select t.pass('GU2 ويزوّدهم لـ ٤', t.dml('res1', $q$update bookings set pax = 4 where guest_name = 'GU1'$q$));
select t.eqn('GU2 بقوا ٤ أكواد', (select count(*) from booking_guests where booking_id = t.gid('GU1')), 4);
select t.chk('GU2 الأكواد القديمة (١ و٢) لسه زي ما هي', (select count(*) = 2 from booking_guests g join t_codes c on c.seq = g.seq and c.code = g.code where g.booking_id = t.gid('GU1') and g.seq <= 2));
select t.pass('GU3 تغيير الغرفة', t.dml('res1', $q$update bookings set room = 602 where guest_name = 'GU1'$q$));
select t.chk('GU3 الأكواد كلها اتنقلت للغرفة الجديدة (بالكود أعرف كان في أنهي غرفة)', (select bool_and(room = 602) and count(*) = 4 from booking_guests where booking_id = t.gid('GU1')));
select t.pass('GU4 إلغاء الحجز', t.dml('res1', $q$update bookings set status = 'ملغي' where guest_name = 'GU1'$q$));
select t.eqn('GU4 الأكواد بتفضل بعد الإلغاء', (select count(*) from booking_guests where booking_id = t.gid('GU1')), 4);

select t.reject('GU5 الموظف مايكتبش أكواد مباشرة (insert)', t.dml('st1', $q$insert into booking_guests(booking_id, room, seq, code) select id, room, 9, 'CFORGED' from bookings where guest_name = 'GU1'$q$), 'permission denied');
select t.reject('GU5 ولا يعدّلها', t.dml('st1', $q$update booking_guests set code = 'CFORGED'$q$), 'permission denied');
select t.reject('GU5 ولا يمسحها', t.dml('st1', $q$delete from booking_guests$q$), 'permission denied');
select t.reject('GU5 ولا مدير الحجوزات', t.dml('res1', $q$update booking_guests set room = 603$q$), 'permission denied');
select t.pass('GU6 مستخدم نشط يقرا الأكواد', t.dml('st1', $q$select 1 from booking_guests limit 1$q$));
select t.chk('GU6 الزائر (anon) مالوش صلاحية على الجدول', not has_table_privilege('anon', 'booking_guests', 'select'));

select t.pass('GU7 حجز بدون فلوس بـ ٣ أفراد', t.dml('res1', $q$insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, pax, currency, source) values (603, 'GU7', hotel_today() + 110, hotel_today() + 111, 50, 50, 3, 'USD', 'مباشر')$q$));
select t.eqn('GU7 ٣ أكواد', (select count(*) from booking_guests where booking_id = t.gid('GU7')), 3);
select t.pass('GU7 مسح الحجز', t.dml('res1', $q$delete from bookings where guest_name = 'GU7'$q$));
select t.eqn('GU7 الأكواد اتمسحت معاه', (select count(*) from booking_guests where code in (select code from booking_guests) and booking_id not in (select id from bookings)), 0);
select t.chk('GU8 ensure_booking_guests آمنة تتكرر (من غير أكواد جديدة)', (with before as (select count(*) c from booking_guests), x as (select ensure_booking_guests(id) from bookings) select (select c from before) = (select count(*) from booking_guests) from x limit 1));
select t.chk('GU9 كل الأكواد فريدة على مستوى النظام', (select count(*) = count(distinct code) from booking_guests));
select t.chk('GU9 كل حجز عنده كودات بعدد أفراده بالظبط', (select bool_and(n = pax) from (select b.pax, (select count(*) from booking_guests g where g.booking_id = b.id) n from bookings b) s));
select t.reject('GU10 الموظف مايعمل أكتر من ١٠٠ فرد', t.dml('st1', $q$insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, pax, currency, source) values (604, 'GU10', hotel_today() + 120, hotel_today() + 121, 1, 1, 150, 'USD', 'مباشر')$q$), 'check constraint');

-- ======================================================================
-- رد الفلوس بيتخصم من صف نفس الحجز (تحصيل التسكين المكرر منفصل عن اللي قبله)
-- ======================================================================
select t.pass('RB1 حجز قديم على غرفة 601', t.ins('st1', 'RB1', 601, 70, 72, 50, 100, 100, true));
select t.pass('RB1 حجز جديد (بعده) على نفس الغرفة', t.ins('st1', 'RB2', 601, 72, 74, 30, 60, 60, true));
update shift_records set rows = rows || jsonb_build_array(
  jsonb_build_object('room', 601, 'bookingId', (select id from t.ids where name = 'RB1'), 'collectionAmt', 100, 'collectionMethod', 'كاش', 'collectionCurrency', 'USD', 'collectionDesc', 'تحصيل RB1', 'expenseAmt', '', 'expenseDesc', '', 'expenseCategory', 'أخرى', 'expenseCurrency', 'EGP', 'notes', ''),
  jsonb_build_object('room', 601, 'bookingId', (select id from t.ids where name = 'RB2'), 'collectionAmt', 60, 'collectionMethod', 'كاش', 'collectionCurrency', 'USD', 'collectionDesc', 'تحصيل RB2', 'expenseAmt', '', 'expenseDesc', '', 'expenseCategory', 'أخرى', 'expenseCurrency', 'EGP', 'notes', ''))
  where date = hotel_today() and shift_key = 'morning';
select t.pass('RB2 مدير الحجوزات يلغي الحجز التاني', t.upd('res1', 'RB2', 'status = ''ملغي'''));
select t.pass('RB2 ويرد فلوسه', t.decide('res1', 'RB2', 'refund'));
select t.eqn('RB2 صف الحجز التاني بقى صفر', (select (el ->> 'collectionAmt')::numeric from shift_records s, jsonb_array_elements(s.rows) el where s.date = hotel_today() and s.shift_key = 'morning' and el ->> 'bookingId' = (select id::text from t.ids where name = 'RB2')), 0);
select t.eqn('RB2 صف الحجز الأول (القديم) ما اتلمسش', (select (el ->> 'collectionAmt')::numeric from shift_records s, jsonb_array_elements(s.rows) el where s.date = hotel_today() and s.shift_key = 'morning' and el ->> 'bookingId' = (select id::text from t.ids where name = 'RB1')), 100);
select t.chk('RB2 مفيش صف جديد اتضاف (الرد اتخصم من صف نفس الحجز)', (select count(*) = 2 from shift_records s, jsonb_array_elements(s.rows) el where s.date = hotel_today() and s.shift_key = 'morning' and el ->> 'room' = '601' and el ? 'bookingId'));
select t.pass('RB3 حجز تالت من غير صف في اليومية (تحصيل قديم)', t.ins('st1', 'RB3', 602, 80, 82, 50, 100, 100, true));
select t.pass('RB3 يتلغي', t.upd('res1', 'RB3', 'status = ''ملغي'''));
select t.pass('RB3 الرد بيتسجّل في صف جديد مربوط بيه', t.decide('res1', 'RB3', 'refund'));
select t.chk('RB3 الصف الجديد فيه bookingId الحجز وقيمته -١٠٠', exists (select 1 from shift_records s, jsonb_array_elements(s.rows) el where s.date = hotel_today() and s.shift_key = 'morning' and el ->> 'bookingId' = (select id::text from t.ids where name = 'RB3') and (el ->> 'collectionAmt')::numeric = -100));

-- ======================================================================
-- بنود مصاريف وإيرادات الفندق في اليومية
-- ======================================================================
select t.pass('HR1 الموظف يضيف بنود مصاريف/إيرادات فندق في يوميته المفتوحة', t.dml('st1', $q$update shift_records set hotel_rows = '[{"room":"فندق","expenseDesc":"كهرباء","expenseAmt":120,"expenseCategory":"كهرباء ومياه","expenseCurrency":"EGP","collectionDesc":"إيجار قاعة","collectionAmt":500,"collectionMethod":"كاش","collectionCurrency":"EGP","paymentDetails":{},"notes":""}]'::jsonb where date = hotel_today() and shift_key = 'morning'$q$));
select t.chk('HR1 اتحفظت', (select jsonb_array_length(hotel_rows) = 1 from shift_records where date = hotel_today() and shift_key = 'morning'));
select t.reject('HR2 مدير الحجوزات مايعدّلش بنود يومية مفتوحة', t.dml('res1', $q$update shift_records set hotel_rows = '[]'::jsonb where date = hotel_today() and shift_key = 'morning'$q$), 'NO_ROWS');
select t.reject('HR2 موظف تاني كمان لأ', t.dml('st2', $q$update shift_records set hotel_rows = '[]'::jsonb where date = hotel_today() and shift_key = 'morning'$q$), 'NO_ROWS');
select t.reject('HR3 حجم البنود محدود (٢٠٠ ألف حرف)', t.dml('st1', $q$update shift_records set hotel_rows = (select jsonb_agg(jsonb_build_object('room','فندق','notes',repeat('x',1000))) from generate_series(1,300)) where date = hotel_today() and shift_key = 'morning'$q$), 'check constraint');

