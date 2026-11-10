-- ======================================================================
-- H) الفنادق المتعددة: كل فندق له غرفه ويوميته وتحصيله، والحجز بيتبع فندق غرفته.
-- بتتشغّل بعد move_cafeteria_flows.sql (نفس المستخدمين). تواريخ بعيدة (+300 يوم).
-- ======================================================================
select t.eqn('H1 غرف Calma (601-616)', (select count(*) from rooms where hotel_id = 1), 16);
select t.eqn('H1 غرف Revento (201-225)', (select count(*) from rooms where hotel_id = 2 and number between 201 and 225), 25);
select t.eqn('H1 غرف Park Plaza (401-433)', (select count(*) from rooms where hotel_id = 3 and number between 401 and 433), 33);
select t.eqn('H1 غرف The Location (301-307)', (select count(*) from rooms where hotel_id = 4 and number between 301 and 307), 7);
select t.eqn('H1 أربع فنادق', (select count(*) from hotels), 4);

select t.pass('H2 حجز في غرفة Revento 205', t.ins('res1', 'H2a', 205, 300, 302, 100, 200));
select t.eqn('H2 الحجز اتربط بفندق Revento', (select hotel_id from bookings where id = (select id from t.ids where name = 'H2a')), 2);
select t.pass('H2 حجز في غرفة Park Plaza 410', t.ins('res1', 'H2b', 410, 300, 302, 100, 200));
select t.eqn('H2 الحجز اتربط بفندق Park Plaza', (select hotel_id from bookings where id = (select id from t.ids where name = 'H2b')), 3);
select t.pass('H2 حجز في غرفة The Location 303', t.ins('res1', 'H2c', 303, 300, 302, 100, 200));
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

-- منع الموظف من إضافة/تعديل حجز في فندق مش فندق شيفته (hs1 شيفته Calma، hs2 شيفته Revento)
select t.reject('H13 hs1 (شيفته Calma) يضيف حجز في Revento مرفوض', t.ins('hs1', 'H13a', 215, 600, 601, 100, 100), 'فندق مش فندق شيفتك');
select t.reject('H13 hs2 (شيفته Revento) يضيف حجز في Calma مرفوض', t.ins('hs2', 'H13b', 606, 600, 601, 100, 100), 'فندق مش فندق شيفتك');
select t.pass('H13 hs1 يضيف حجز في Calma (فندقه) مسموح', t.ins('hs1', 'H13c', 606, 600, 601, 100, 100));
select t.pass('H13 hs2 يضيف حجز في Revento (فندقه) مسموح', t.ins('hs2', 'H13d', 216, 600, 601, 100, 100));
select t.reject('H13 st2 (شيفته Calma) يضيف حجز في Revento مرفوض', t.ins('st2', 'H13e', 218, 610, 611, 100, 100), 'فندق مش فندق شيفتك');
select t.pass('H13 مدير الحجوزات يضيف في أي فندق', t.ins('res1', 'H13f', 405, 600, 601, 100, 100));
select t.reject('H14 hs1 مايعدّلش حجز Revento', t.upd('hs1', 'H13d', 'guest_name = guest_name'), 'فندق مش فندق شيفتك');
-- نقل النزيل: موظف الشيفت (فندق شيفته) ومدير الحجوزات
select t.reject('H15 موظف شيفته في فندق تاني ما بيقدرش ينقل نزيل', t.try('hs1', format($q$select move_booking_room(%L, 217)$q$, (select id from t.ids where name = 'H13d'))), 'فندق');
select t.pass('H15 موظف شيفته مفتوح في نفس الفندق ينقل نزيل', t.try('hs2', format($q$select move_booking_room(%L, 217)$q$, (select id from t.ids where name = 'H13d'))));
select t.pass('H15 مدير الحجوزات ينقل جوه نفس الفندق', t.try('res1', format($q$select move_booking_room(%L, 216)$q$, (select id from t.ids where name = 'H13d'))));

-- أكواد الحجز لكل فندق: بادئة الفندق + رقم متسلسل لكل فندق لوحده
select t.eq('H16 كود حجز Calma بيبدأ بـ B', (select left(code, 1) from bookings where guest_name = 'H13c'), 'B');
select t.eq('H16 كود حجز Revento بيبدأ بـ R', (select left(code, 1) from bookings where guest_name = 'H13d'), 'R');
select t.eq('H16 كود حجز Park Plaza بيبدأ بـ P', (select left(code, 1) from bookings where guest_name = 'H13f'), 'P');
select t.eq('H16 كود حجز The Location بيبدأ بـ L', (select left(code, 1) from bookings where guest_name = 'H2c'), 'L');
select t.chk('H16 مفيش كودين متكررين في كل الحجوزات', (select count(*) = count(distinct code) from bookings));
select t.chk('H16 العداد منفصل لكل فندق (كل فندق ليه أرقامه)', (select count(distinct hotel_id) from booking_code_counters) >= 4);

-- إدارة الفنادق والغرف (المدير العام بس) + حماية
select t.reject('H17 مدير الحجوزات مايضيفش فندق', t.try('res1', $q$select create_hotel('Hotel X', 'X', 'X')$q$), 'المدير العام');
select t.reject('H17 موظف مايضيفش غرفة', t.try('hs1', $q$select add_hotel_room(2, 250, '250')$q$), 'المدير العام');
select t.pass('H17 المدير العام يضيف فندق', t.try('gm1', $q$select create_hotel('Sea View', 'Sea', 'S')$q$));
select t.eqn('H17 الفندق الجديد رقم 5', (select max(id) from hotels), 5);
select t.reject('H17 نفس البادئة مرفوضة', t.try('gm1', $q$select create_hotel('Other', 'O', 'S')$q$), 'بادئة');
select t.reject('H17 نفس الاسم مرفوض', t.try('gm1', $q$select create_hotel('sea view', 'x', 'Z')$q$), 'بنفس الاسم');
select t.pass('H17 المدير العام يضيف غرفة للفندق الجديد', t.try('gm1', $q$select add_hotel_room(5, 501, 'Suite 501')$q$));
select t.reject('H17 رقم غرفة مكرر مرفوض (حتى في فندق تاني)', t.try('gm1', $q$select add_hotel_room(5, 205, 'x')$q$), 'مستخدم');
select t.eqn('H17 الغرفة اتضافت على الفندق ٥', (select hotel_id from rooms where number = 501), 5);
select t.pass('H17 المدير العام يعدّل اسم غرفة', t.try('gm1', $q$select rename_hotel_room(501, 'Suite 501 VIP')$q$));
select t.eq('H17 الاسم اتغيّر', (select name from rooms where number = 501), 'Suite 501 VIP');
select t.reject('H17 مدير الحجوزات مايعدّلش اسم غرفة', t.try('res1', $q$select rename_hotel_room(501, 'x')$q$), 'المدير العام');
select t.pass('H17 حجز في الفندق الجديد بيتربط بيه وبكوده', t.ins('res1', 'H17b', 501, 700, 701, 100, 100));
select t.eq('H17 كود الفندق الجديد بيبدأ بـ S', (select left(code, 1) from bookings where guest_name = 'H17b'), 'S');

-- تحديد فنادق الموظف (allowed_hotels): الاختيار خارج المسموح مرفوض من القاعدة
update profiles set allowed_hotels = array[3] where username = 'st2';
select t.reject('H18 st2 مسموحله Park Plaza بس: يختار شيفت Calma مرفوض', t.try('st2', format($q$insert into shift_claims(hotel_id, date, shift_key, username, name) values (1, %L, 'night', 'st2', 'st2')$q$, hotel_today() + 1)));
select t.pass('H18 st2 يختار شيفت في Park Plaza (المسموح)', t.try('st2', format($q$insert into shift_claims(hotel_id, date, shift_key, username, name) values (3, %L, 'night', 'st2', 'st2')$q$, hotel_today() + 1)));
select t.try('gm1', $q$update profiles set allowed_hotels = array[99] where username = 'st1'$q$);
select t.chk('H18 فندق مش موجود مرفوض في القايمة', (select allowed_hotels is null from profiles where username = 'st1'));
select t.try('st2', $q$update profiles set allowed_hotels = null where username = 'st2'$q$);
select t.chk('H18 الموظف مايفكّش قيد نفسه', (select allowed_hotels = array[3] from profiles where username = 'st2'));

-- إيقاف فندق: مرفوض لو فيه شيفت مفتوح، ومسموح بعد القفل
select t.reject('H19 المدير العام مايوقّفش فندق فيه شيفت مفتوح (Revento: hs2 شيفته مفتوح)', t.try('gm1', $q$update hotels set active = false where id = 2$q$), 'شيفت مفتوح');
select t.chk('H19 الفندق لسه فعّال', (select active from hotels where id = 2));
update shift_records set closed = true where hotel_id = 2;
select t.pass('H19 بعد قفل الشيفتات يتوقّف', t.try('gm1', $q$update hotels set active = false where id = 2$q$));
select t.chk('H19 الفندق اتوقّف', (select not active from hotels where id = 2));
select t.pass('H19 ويتفعّل تاني', t.try('gm1', $q$update hotels set active = true where id = 2$q$));

-- مراجعة: الغرفة مينفعش تتنقل لفندق تاني ولا يتغيّر رقمها من الـ API، والفندق الموقوف مينفعش حد يختار فيه شيفت
select t.reject('H20 مدير الحجوزات مايغيّرش فندق غرفة', t.try('res1', $q$update rooms set hotel_id = 2 where number = 601$q$), 'مينفعش يتغيّروا');
select t.reject('H20 مدير الحجوزات مايغيّرش رقم غرفة', t.try('res1', $q$update rooms set number = 1601 where number = 601$q$), 'مينفعش يتغيّروا');
select t.try('gm1', $q$update rooms set hotel_id = 2 where number = 601$q$);
select t.eqn('H20 فندق الغرفة 601 لسه Calma (المدير العام ماقدرش يغيّره من الـ API)', (select hotel_id from rooms where number = 601), 1);
select t.pass('H20 تعديل اسم الغرفة لسه مسموح لمدير الحجوزات', t.try('res1', $q$update rooms set name = '601 داخلي' where number = 601$q$));
update hotels set active = false where id = 4;
update profiles set allowed_hotels = null where username = 'st2';
select t.reject('H21 مينفعش حد يختار شيفت في فندق موقوف', t.try('hs1', format($q$insert into shift_claims(hotel_id, date, shift_key, username, name) values (4, %L, 'night', 'hs1', 'hs1')$q$, hotel_today() + 1)));
update hotels set active = true where id = 4;

-- مراجعة الكود: بادئة كود الحجز فريدة وبصيغة صحيحة ومينفعش تتغيّر بعد وجود حجوزات
select t.pass('H22 فندق جديد من غير حجوزات', t.try('gm1', $q$select create_hotel('Fresh Hotel', 'F', 'F')$q$));
select t.reject('H22 بادئة مكررة بين فندقين مرفوضة', t.try('gm1', $q$update hotels set code_prefix = 'B' where name = 'Fresh Hotel'$q$), 'hotels_code_prefix_uidx');
select t.reject('H22 بادئة بصيغة غلط مرفوضة', t.try('gm1', $q$update hotels set code_prefix = 'Z9' where name = 'Fresh Hotel'$q$), 'hotels_prefix_format_chk');
select t.pass('H22 تغيير بادئة فندق من غير حجوزات مسموح', t.try('gm1', $q$update hotels set code_prefix = 'W' where name = 'Fresh Hotel'$q$));
select t.eq('H22 البادئة اتغيّرت', (select code_prefix from hotels where name = 'Fresh Hotel'), 'W');
select t.reject('H22 مينفعش تغيير بادئة فندق عنده حجوزات (Park Plaza)', t.try('gm1', $q$update hotels set code_prefix = 'Q' where id = 3$q$), 'بعد ما الفندق بقى له حجوزات');

-- تشديد: مفيش إضافة/مسح غرف مباشرة من الـ API (المدير العام بالدوال بس)، وتعديل الاسم لمدير الحجوزات لسه شغال
select t.reject('H23 مدير الحجوزات مايضيفش غرفة مباشرة (حتى بفندق تاني)', t.try('res1', $q$insert into rooms(number, name, hotel_id) values (9001, 'x', 2)$q$), 'permission denied');
select t.reject('H23 مدير الحجوزات مايمسحش غرفة', t.try('res1', $q$delete from rooms where number = 9001$q$), 'permission denied');
select t.pass('H23 تعديل اسم غرفة لسه شغال لمدير الحجوزات', t.try('res1', $q$update rooms set name = 'اسم جديد' where number = 602$q$));
select t.eq('H23 الاسم اتغيّر', (select name from rooms where number = 602), 'اسم جديد');

-- ======================================================================
-- S) شيفت مشترك (زميل على نفس اليومية) + دفع بعملة تانية بسعر صرف
-- hs1 صاحب شيفت المساء في Calma؛ hs3 هيبقى زميله.
-- ======================================================================
insert into auth.users(id, email) select gen_random_uuid(), u || '@calma.internal' from unnest(array['hs3']) u;
insert into profiles(id, username, name, role)
select (select id from auth.users where email = u || '@calma.internal'), u, u, 'staff' from unnest(array['hs3']) u;
select t.reject('S1 موظف من غير شيفت ما يقدرش يحصّل', t.pay('hs3', 'H3c', 10), 'مفيش شيفتك');
select t.reject('S1 موظف مش صاحب الشيفت ما يضيفش زميل', t.try('hs3', format($q$select set_shift_helpers(1, %L, 'evening', '["hs3"]'::jsonb)$q$, hotel_today())), 'صاحب الشيفت');
select t.reject('S1 زميل مش موظف شيفت مرفوض', t.try('hs1', format($q$select set_shift_helpers(1, %L, 'evening', '["gm1"]'::jsonb)$q$, hotel_today())), 'مش موظف');
select t.reject('S1 أكتر من ٣ زملاء مرفوض', t.try('hs1', format($q$select set_shift_helpers(1, %L, 'evening', '["hs2","hs3","st1","st2"]'::jsonb)$q$, hotel_today())), 'أقصى');
select t.pass('S2 صاحب الشيفت يضيف زميل', t.try('hs1', format($q$select set_shift_helpers(1, %L, 'evening', '["hs3"]'::jsonb)$q$, hotel_today())));
select t.pass('S2 الزميل يحصّل على يومية الشيفت المشترك', t.pay('hs3', 'H3c', 10));
select t.eqn('S2 التحصيل اتسجّل في يومية صاحب الشيفت (Calma مساء)', (select count(*) from shift_records, jsonb_array_elements(rows) r where hotel_id = 1 and date = hotel_today() and shift_key = 'evening' and staff_username = 'hs1' and (r ->> 'collectionAmt')::numeric > 0), 1);
select t.reject('S2 الزميل ما يغيّرش قايمة الزملاء مباشرة', t.dml('hs3', format($q$update shift_records set helpers = '{}' where hotel_id = 1 and date = %L and shift_key = 'evening'$q$, hotel_today())), 'زميل معايا');
select t.reject('S2 الزميل ما يغيّرش صاحب الشيفت', t.dml('hs3', format($q$update shift_records set staff_name = 'x' where hotel_id = 1 and date = %L and shift_key = 'evening'$q$, hotel_today())), 'اسم صاحب الشيفت');
select t.reject('S3 موظف تاني مش زميل ما يحصّلش على اليومية دي', t.pay('hs2', 'H3c', 10), 'شيفتك');
select t.pass('S4 دفع بعملة تانية بسعر صرف (٥٠ جنيه = ١ دولار)', t.try('hs1', format($q$select record_booking_payment_fx(%L, 50, 'EGP', 50, 'كاش')$q$, (select id from t.ids where name = 'H3c'))));
select t.reject('S4 الدفع بنفس عملة الحجز بسعر صرف مرفوض', t.try('hs1', format($q$select record_booking_payment_fx(%L, 5, (select currency from bookings where id = %L), 1, 'كاش')$q$, (select id from t.ids where name = 'H3c'), (select id from t.ids where name = 'H3c'))), 'نفس عملة');
