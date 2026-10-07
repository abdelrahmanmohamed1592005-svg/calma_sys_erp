-- ======================================================================
-- أكواد الأفراد: بيكتبها المستخدم بنفسه (bookings.guest_codes) والجدول booking_guests بيتبني منها
-- ======================================================================
create function t.gid(nm text) returns uuid language sql as $$ select id from bookings where guest_name = nm $$;
select t.pass('GU1 موظف يضيف حجز ٣ أفراد وبيكتب كود لكل فرد', t.dml('st1', $q$insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, pax, currency, source, guest_codes) values (601, 'GU1', hotel_today() + 100, hotel_today() + 102, 50, 100, 3, 'USD', 'مباشر', '["AHMED-1","ali2","Sara"]'::jsonb)$q$));
select t.eqn('GU1 اتسجّلوا ٣ أكواد بالظبط (من غير توليد تلقائي)', (select count(*) from booking_guests where booking_id = t.gid('GU1')), 3);
select t.eq('GU1 الأكواد زي ما اتكتبت بالترتيب', (select string_agg(code, ',' order by seq) from booking_guests where booking_id = t.gid('GU1')), 'AHMED-1,ali2,Sara');
select t.chk('GU1 كل كود مربوط بغرفة الحجز', (select bool_and(room = 601) from booking_guests where booking_id = t.gid('GU1')));

select t.pass('GU2 حجز من غير أكواد: مفيش أكواد متولّدة', t.dml('st1', $q$insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, pax, currency, source) values (602, 'GU2', hotel_today() + 100, hotel_today() + 101, 50, 50, 2, 'USD', 'مباشر')$q$));
select t.eqn('GU2 صفر أكواد', (select count(*) from booking_guests where booking_id = t.gid('GU2')), 0);
select t.pass('GU2 الموظف يضيف الأكواد بعدين (خانة فاضية = فرد من غير كود)', t.dml('st1', $q$update bookings set guest_codes = '["", "B-2"]'::jsonb where guest_name = 'GU2'$q$));
select t.eq('GU2 اتسجّل كود الفرد التاني بس برقم ٢', (select string_agg(seq || ':' || code, ',') from booking_guests where booking_id = t.gid('GU2')), '2:B-2');

select t.pass('GU3 تغيير الغرفة بيحدّث ربط الأكواد', t.dml('res1', $q$update bookings set room = 603 where guest_name = 'GU1'$q$));
select t.chk('GU3 الأكواد اتنقلت للغرفة الجديدة (بالكود أعرف كان في أنهي غرفة)', (select bool_and(room = 603) and count(*) = 3 from booking_guests where booking_id = t.gid('GU1')));
select t.pass('GU3 تخفيض عدد الأفراد لـ ٢', t.dml('res1', $q$update bookings set pax = 2 where guest_name = 'GU1'$q$));
select t.eq('GU3 كود الفرد التالت اتشال (زيادة عن عدد الأفراد)', (select string_agg(code, ',' order by seq) from booking_guests where booking_id = t.gid('GU1')), 'AHMED-1,ali2');
select t.pass('GU4 مدير الحجوزات يعدّل كود', t.dml('res1', $q$update bookings set guest_codes = '["NEW-1","ali2"]'::jsonb where guest_name = 'GU1'$q$));
select t.eq('GU4 الكود اتغيّر', (select string_agg(code, ',' order by seq) from booking_guests where booking_id = t.gid('GU1')), 'NEW-1,ali2');
select t.pass('GU4 إلغاء الحجز', t.dml('res1', $q$update bookings set status = 'ملغي' where guest_name = 'GU1'$q$));
select t.eqn('GU4 الأكواد بتفضل بعد الإلغاء (البحث بيطلّع الحجز الملغي كمان)', (select count(*) from booking_guests where booking_id = t.gid('GU1')), 2);

select t.reject('GU5 نفس الكود في نفس الشهر لنزيل تاني مرفوض (حتى لو الأول اتلغى)', t.dml('st1', $q$insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, pax, currency, source, guest_codes) values (604, 'GU5x', hotel_today() + 100, hotel_today() + 101, 50, 50, 1, 'USD', 'مباشر', '["new-1"]'::jsonb)$q$), 'مستخدم الشهر ده');
select t.eqn('GU5 والحجز المرفوض ما اتسجّلش', (select count(*) from bookings where guest_name = 'GU5x'), 0);
select t.pass('GU5 نفس الكود في شهر مختلف مسموح (العداد بيبدأ من الأول)', t.dml('st1', $q$insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, pax, currency, source, guest_codes) values (604, 'GU5', hotel_today() + 140, hotel_today() + 141, 50, 50, 1, 'USD', 'مباشر', '["NEW-1"]'::jsonb)$q$));
select t.eqn('GU5 البحث بالكود بيجيب الاتنين (غرفتين / شهرين)', (select count(distinct room) from booking_guests where upper(code) = 'NEW-1'), 2);
select t.chk('GU5 الشهر متسجّل مع الكود', (select count(distinct ym) = 2 from booking_guests where upper(code) = 'NEW-1'));
select t.pass('GU5 تعديل حجز بنفس كوده مايتعارضش مع نفسه', t.dml('st1', $q$update bookings set guest_codes = '["NEW-1"]'::jsonb where guest_name = 'GU5'$q$));
select t.reject('GU5 نقل الحجز لنفس شهر الكود التاني بيترفض', t.dml('res1', $q$update bookings set checkin = hotel_today() + 100, checkout = hotel_today() + 101 where guest_name = 'GU5'$q$), 'مستخدم الشهر ده');
select t.reject('GU5 لكن مايتكررش جوه نفس الحجز (حتى باختلاف حالة الحروف)', t.dml('st1', $q$insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, pax, currency, source, guest_codes) values (605, 'GU5b', hotel_today() + 110, hotel_today() + 111, 50, 50, 2, 'USD', 'مباشر', '["X1","x1"]'::jsonb)$q$), 'مكرر جوه نفس الحجز');
select t.eqn('GU5 والحجز المرفوض ما اتسجّلش', (select count(*) from bookings where guest_name = 'GU5b'), 0);
select t.reject('GU5 كود أطول من ٤٠ حرف', t.dml('st1', $q$insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, pax, currency, source, guest_codes) values (605, 'GU5c', hotel_today() + 110, hotel_today() + 111, 50, 50, 1, 'USD', 'مباشر', to_jsonb(array[repeat('x', 41)]))$q$), 'أطول من');
select t.reject('GU5 أكواد مش مصفوفة', t.dml('st1', $q$insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, pax, currency, source, guest_codes) values (605, 'GU5d', hotel_today() + 110, hotel_today() + 111, 50, 50, 1, 'USD', 'مباشر', '{"a":1}'::jsonb)$q$), 'check constraint');

select t.reject('GU6 الموظف مايكتبش في جدول الأكواد مباشرة (insert)', t.dml('st1', $q$insert into booking_guests(booking_id, room, seq, code) select id, room, 9, 'CFORGED' from bookings where guest_name = 'GU1'$q$), 'permission denied');
select t.reject('GU6 ولا يعدّلها', t.dml('st1', $q$update booking_guests set code = 'CFORGED'$q$), 'permission denied');
select t.reject('GU6 ولا يمسحها', t.dml('st1', $q$delete from booking_guests$q$), 'permission denied');
select t.reject('GU6 ولا مدير الحجوزات', t.dml('res1', $q$update booking_guests set room = 603$q$), 'permission denied');
select t.pass('GU6 مستخدم نشط يقرا الأكواد', t.dml('st1', $q$select 1 from booking_guests limit 1$q$));
select t.chk('GU6 الزائر (anon) مالوش صلاحية على الجدول', not has_table_privilege('anon', 'booking_guests', 'select'));

select t.pass('GU7 حجز بـ ٣ أكواد', t.dml('res1', $q$insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, pax, currency, source, guest_codes) values (603, 'GU7', hotel_today() + 120, hotel_today() + 121, 50, 50, 3, 'USD', 'مباشر', '["a","b","c"]'::jsonb)$q$));
select t.eqn('GU7 ٣ أكواد', (select count(*) from booking_guests where booking_id = t.gid('GU7')), 3);
select t.pass('GU7 مسح الحجز', t.dml('res1', $q$delete from bookings where guest_name = 'GU7'$q$));
select t.eqn('GU7 الأكواد اتمسحت معاه', (select count(*) from booking_guests where booking_id not in (select id from bookings)), 0);
select t.chk('GU9 كل حجز عنده كودات مش أكتر من عدد أفراده', (select bool_and(n <= pax) from (select b.pax, (select count(*) from booking_guests g where g.booking_id = b.id) n from bookings b) s));
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


-- ======================================================================
-- الدخول المبكر: الموظف يسجّله مرة واحدة على حجز موجود (مش يعدّل/يشيل رسم اتسجّل)
-- ======================================================================
select t.pass('EC1 حجز مستقبلي', t.ins('res1', 'EC1', 610, 200, 203, 100, 300, 0, false));
select t.pass('EC1 الموظف يسجّل دخول مبكر ٥٠ (مرة أولى)', t.upd('st1', 'EC1', $u$early_checkin = '{"applied":true,"fee":50,"note":"وصل ٧ص"}'::jsonb$u$));
select t.eqn('EC1 الإجمالي الكلي بقى ٣٥٠ (غرفة + رسم الدخول المبكر)', (select booking_grand_total(b) from bookings b where guest_name = 'EC1'), 350);
select t.reject('EC1 الموظف مايعدّلش الرسم بعد ما اتسجّل', t.upd('st1', 'EC1', $u$early_checkin = '{"applied":true,"fee":5,"note":"x"}'::jsonb$u$), 'مش من صلاحية موظف الشيفت');
select t.reject('EC1 ولا يشيله', t.upd('st1', 'EC1', $u$early_checkin = '{"applied":false,"fee":0,"note":""}'::jsonb$u$), 'مش من صلاحية موظف الشيفت');
select t.reject('EC1 ورسم سالب مرفوض', t.upd('res1', 'EC1', $u$early_checkin = '{"applied":true,"fee":-5,"note":""}'::jsonb$u$), 'check constraint');
select t.pass('EC2 حجز تاني متحصّل بالكامل', t.ins('st1', 'EC2', 611, 200, 202, 100, 200, 200, true));
select t.reject('EC2 تسجيل دخول مبكر على حجز متحصّل بالكامل من غير ما العلامة تتشال مرفوض', t.upd('st1', 'EC2', $u$early_checkin = '{"applied":true,"fee":50,"note":""}'::jsonb$u$), 'متحصّل بالكامل');
select t.pass('EC2 لكن لو العلامة اتشالت في نفس التحديث (والمدفوع لسه أقل من الإجمالي الجديد) بيعدّي', t.upd('st1', 'EC2', $u$early_checkin = '{"applied":true,"fee":50,"note":""}'::jsonb, settled = false$u$));
select t.pass('EC2 وبعد تحصيل الرسم يرجع متحصّل بالكامل', t.upd('st1', 'EC2', 'amount_paid = 250, settled = true'));

-- ======================================================================
-- كود الحجز تلقائي (B + سنة/شهر + رقم متسلسل)
-- ======================================================================
select t.pass('AC1 حجزين متتاليين', t.dml('st1', $q$insert into bookings(room, guest_name, checkin, checkout, price_night, total_room, pax, currency, source, code) values (612, 'AC1', hotel_today() + 300, hotel_today() + 301, 50, 50, 1, 'USD', 'مباشر', 'MY-OWN-CODE'), (613, 'AC2', hotel_today() + 300, hotel_today() + 301, 50, 50, 1, 'USD', 'مباشر', null)$q$));
select t.chk('AC1 الكود تلقائي بالصيغة والكود اللي المستخدم كتبه اتجاهل', (select bool_and(code ~ '^B[0-9]{4}-[0-9]{4}$') from bookings where guest_name in ('AC1', 'AC2')));
select t.chk('AC1 الرقم متسلسل ومختلف', (select count(distinct code) = 2 from bookings where guest_name in ('AC1', 'AC2')));
select t.chk('AC1 العداد بيمشي: التاني أكبر من الأول', (select (select split_part(code, '-', 2)::int from bookings where guest_name = 'AC2') = (select split_part(code, '-', 2)::int from bookings where guest_name = 'AC1') + 1));
select t.pass('AC2 المدير يحاول يغيّر الكود', t.dml('res1', $q$update bookings set code = 'HACK', notes = 'x' where guest_name = 'AC1'$q$));
select t.chk('AC2 الكود ما اتغيّرش', (select code ~ '^B[0-9]{4}-[0-9]{4}$' from bookings where guest_name = 'AC1'));
select t.reject('AC3 مفيش وصول مباشر لجدول العدادات', t.dml('st1', $q$select * from booking_code_counters$q$), 'permission denied');
select t.reject('AC3 ولا تنفيذ دالة التوليد', t.dml('st1', $q$select next_booking_code()$q$), 'permission denied');
select t.chk('AC4 كل الحجوزات ليها كود', (select bool_and(coalesce(code, '') <> '') from bookings));
