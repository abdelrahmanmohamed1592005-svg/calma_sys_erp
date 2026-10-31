-- ======================================================================
-- H) الفنادق المتعددة: كل فندق له غرفه ويوميته وتحصيله، والحجز بيتبع فندق غرفته.
-- بتتشغّل بعد move_cafeteria_flows.sql (نفس المستخدمين). تواريخ بعيدة (+300 يوم).
-- ======================================================================
select t.eqn('H1 غرف Calma (601-616)', (select count(*) from rooms where hotel_id = 1), 16);
select t.eqn('H1 غرف Revento (201-225)', (select count(*) from rooms where hotel_id = 2 and number between 201 and 225), 25);
select t.eqn('H1 غرف Park Plaza (401-433)', (select count(*) from rooms where hotel_id = 3 and number between 401 and 433), 33);
select t.eqn('H1 غرف The Location (301-307)', (select count(*) from rooms where hotel_id = 4 and number between 301 and 307), 7);
select t.eqn('H1 أربع فنادق', (select count(*) from hotels), 4);

select t.pass('H2 حجز في غرفة Revento 205', t.ins('st1', 'H2a', 205, 300, 302, 100, 200));
select t.eqn('H2 الحجز اتربط بفندق Revento', (select hotel_id from bookings where id = (select id from t.ids where name = 'H2a')), 2);
select t.pass('H2 حجز في غرفة Park Plaza 410', t.ins('st1', 'H2b', 410, 300, 302, 100, 200));
select t.eqn('H2 الحجز اتربط بفندق Park Plaza', (select hotel_id from bookings where id = (select id from t.ids where name = 'H2b')), 3);
select t.pass('H2 حجز في غرفة The Location 303', t.ins('st1', 'H2c', 303, 300, 302, 100, 200));
select t.eqn('H2 الحجز اتربط بفندق The Location', (select hotel_id from bookings where id = (select id from t.ids where name = 'H2c')), 4);

-- موظفين جداد: hs1 شيفت المساء في Calma، وhs2 نفس الشيفت في Revento (نفس اليوم، فندق تاني) - المفتاح (فندق، يوم، شيفت)
insert into auth.users(id, email) select gen_random_uuid(), u || '@calma.internal' from unnest(array['hs1', 'hs2']) u;
insert into profiles(id, username, name, role)
select (select id from auth.users where email = u || '@calma.internal'), u, u, 'staff' from unnest(array['hs1', 'hs2']) u;
select t.pass('H3 hs1 يختار شيفت المساء في Calma', t.try('hs1', format($q$insert into shift_claims(hotel_id, date, shift_key, username, name) values (1, %L, 'evening', 'hs1', 'hs1')$q$, hotel_today())));
select t.pass('H3 hs1 يفتح يومية Calma', t.try('hs1', format($q$insert into shift_records(hotel_id, date, shift_key, staff_name, staff_username) values (1, %L, 'evening', 'hs1', 'hs1')$q$, hotel_today())));
select t.pass('H3 حجز في Calma', t.ins('res1', 'H3c', 602, 400, 402, 100, 200));
select t.reject('H3 تحصيل حجز فندق تاني من يومية Calma مرفوض', t.pay('hs1', 'H2a', 50), 'فندق تاني');
select t.reject('H4 نقل نزيل لغرفة في فندق تاني مرفوض', t.try('res1', format($q$select move_booking_room(%L, 303)$q$, (select id from t.ids where name = 'H2a'))), 'فندق تاني');
select t.reject('H5 تغيير غرفة الحجز لفندق تاني مرفوض', t.upd('res1', 'H2a', 'room = 303'), 'فندق تاني');

select t.pass('H6 hs2 يختار نفس الشيفت في Revento', t.try('hs2', format($q$insert into shift_claims(hotel_id, date, shift_key, username, name) values (2, %L, 'evening', 'hs2', 'hs2')$q$, hotel_today())));
select t.pass('H6 hs2 يفتح يومية Revento', t.try('hs2', format($q$insert into shift_records(hotel_id, date, shift_key, staff_name, staff_username) values (2, %L, 'evening', 'hs2', 'hs2')$q$, hotel_today())));
select t.reject('H6 موظف تاني مايحجزش نفس شيفت Revento', t.try('st2', format($q$insert into shift_claims(hotel_id, date, shift_key, username, name) values (2, %L, 'evening', 'st2', 'st2')$q$, hotel_today())));
select t.pass('H7 hs2 يحصّل على حجز Revento', t.pay('hs2', 'H2a', 50));
select t.eqn('H7 التحصيل اتسجّل في يومية Revento بس', (select jsonb_array_length(rows) from shift_records where hotel_id = 2 and date = hotel_today() and shift_key = 'evening'), 1);
select t.eqn('H7 يومية Calma ما اتلمستش', (select jsonb_array_length(rows) from shift_records where hotel_id = 1 and date = hotel_today() and shift_key = 'evening'), 0);
select t.reject('H8 hs2 مايحصّلش على حجز Calma من يومية Revento', t.pay('hs2', 'H3c', 10), 'فندق تاني');
select t.pass('H9 hs1 يحصّل على حجز Calma في يومية Calma', t.pay('hs1', 'H3c', 20));
select t.eqn('H9 يومية Calma اتسجّل فيها التحصيل', (select jsonb_array_length(rows) from shift_records where hotel_id = 1 and date = hotel_today() and shift_key = 'evening'), 1);

-- صلاحيات جدول الفنادق: الكل يقرا، المدير العام بس يعدّل الاسم، ومحدش يمسح أو يضيف من الـ API
select t.pass('H10 موظف يقرا الفنادق', t.try('hs1', 'select * from hotels'));
select t.try('hs1', $q$update hotels set name = 'x' where id = 2$q$);
select t.eq('H10 اسم الفندق ما اتغيّرش من موظف', (select name from hotels where id = 2), 'Revento');
select t.try('res1', $q$update hotels set name = 'x' where id = 2$q$);
select t.eq('H10 اسم الفندق ما اتغيّرش من مدير الحجوزات', (select name from hotels where id = 2), 'Revento');
select t.pass('H10 المدير العام يعدّل اسم فندق', t.try('gm1', $q$update hotels set short_name = 'Rev' where id = 2$q$));
select t.reject('H10 المدير العام مايمسحش فندق من الـ API', t.try('gm1', $q$delete from hotels where id = 2$q$));
select t.reject('H10 مايضيفش فندق من الـ API', t.try('gm1', $q$insert into hotels(id, name) values (9, 'x')$q$));
select t.reject('H11 موظف مايغيّرش فندق يومية', t.try('hs1', format($q$update shift_records set hotel_id = 3 where hotel_id = 1 and date = %L and shift_key = 'evening'$q$, hotel_today())));
-- حجز مباشر بفندق غلط (الواجهة مابتبعتش hotel_id؛ التريجر بيفرض فندق الغرفة)
select t.pass('H12 حجز بيحاول يفرض hotel_id غلط', t.try('res1', format($q$insert into bookings(room, hotel_id, guest_name, checkin, checkout, price_night, total_room, currency) values (212, 4, 'Forced', hotel_today() + 500, hotel_today() + 501, 1, 1, 'USD')$q$)));
select t.eqn('H12 الفندق اتفرض من الغرفة مش من القيمة المبعوتة', (select hotel_id from bookings where guest_name = 'Forced'), 2);
