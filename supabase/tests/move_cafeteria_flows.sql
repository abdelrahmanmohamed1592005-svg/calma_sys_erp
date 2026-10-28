-- ======================================================================
-- M) كافيتيريا النزيل بعملتين + نقل النزيل من غرفة لغرفة (سيناريوهات كاملة)
-- بتتشغّل بعد money_flows.sql (نفس المستخدمين: gm1 / res1 / st1 / st2 / acc1).
-- تواريخ بعيدة (+200 يوم) عشان مايتعارضش مع أي حجز في الاختبارات التانية.
-- ======================================================================
create function t.pay(u text, nm text, amt numeric, meth text default 'كاش') returns text language plpgsql as $$
declare v uuid; res jsonb;
begin
  select id into v from t.ids where name = nm;
  perform t.as_user(u);
  select record_booking_payment(v, amt, meth) into res;
  execute 'reset role';
  perform set_config('t.last_pay', res::text, false);
  return null;
exception when others then
  execute 'reset role';
  return sqlerrm;
end $$;
-- نقل بتوقيت متوقع (للتأكد من حماية "الحجز اتغيّر من حد تاني")
create function t.mvx(u text, nm text, room int, expected timestamptz) returns text language plpgsql as $$
declare v uuid;
begin
  select id into v from t.ids where name = nm;
  perform t.as_user(u);
  perform move_booking_room(v, room, expected);
  execute 'reset role';
  return null;
exception when others then
  execute 'reset role';
  return sqlerrm;
end $$;
create function t.snap(nm text) returns text language sql as $$
  select jsonb_build_object('extras', extras, 'oc', other_charges, 'op', other_paid, 'paid', amount_paid, 'total', total_room, 'code', code,
    'cur', currency, 'in', checkin, 'out', checkout, 'settled', settled, 'status', status, 'guest', guest_name, 'pm', payment_method)::text
  from bookings where id = (select id from t.ids where name = nm)
$$;
create function t.snapshot(k text, nm text) returns void language plpgsql as $$
begin perform set_config('t.snap_' || k, t.snap(nm), false); end $$;
create function t.snapof(k text) returns text language sql as $$ select current_setting('t.snap_' || k, true) $$;
create function t.cafe_rows(nm text) returns int language sql as $$
  select count(*)::int from shift_records s, jsonb_array_elements(s.cafeteria_rows) el where el ->> 'bookingId' = (select id::text from t.ids where name = nm)
$$;
create function t.cafe_sum(nm text, cur text) returns numeric language sql as $$
  select coalesce(sum((el ->> 'collectionAmt')::numeric), 0) from shift_records s, jsonb_array_elements(s.cafeteria_rows) el
  where el ->> 'bookingId' = (select id::text from t.ids where name = nm) and el ->> 'collectionCurrency' = cur
$$;
create function t.room_sum(nm text, rm int) returns numeric language sql as $$
  select coalesce(sum((el ->> 'collectionAmt')::numeric), 0) from shift_records s, jsonb_array_elements(s.rows) el
  where el ->> 'bookingId' = (select id::text from t.ids where name = nm) and el ->> 'room' = rm::text
$$;

-- ---------- M1: كافيتيريا بعملة الحجز (دولار) + كافيتيريا بالجنيه على نفس الحجز
select t.pass('M1 حجز دولار ١٢٠ (٢ ليلة)', t.ins('st1', 'M1', 601, 200, 202, 60, 120));
select t.pass('M1 كافيتيريا دولار ٤٠ + غسيل ١٠', t.upd('st1', 'M1', 'extras = ''{"laundry":10,"cafeteria":40,"tours":0,"pickup":0}''::jsonb'));
select t.pass('M1 كافيتيريا جنيه ٨٠ + غسيل ٢٠ جنيه', t.upd('st1', 'M1', 'other_charges = ''{"EGP":{"laundry":20,"cafeteria":80,"tours":0,"pickup":0}}''::jsonb'));
select t.eqn('M1 المتبقي الكلي بالدولار ١٧٠', (select booking_hotel_total(b) - amount_paid from bookings b where id = (select id from t.ids where name = 'M1')), 170);
select t.eq('M1 المتبقي بالجنيه ١٠٠', (select booking_other_due(b) ->> 'EGP' from bookings b where id = (select id from t.ids where name = 'M1')), '100');
select t.pass('M1 دفع ٣٠ دولار: كلها كافيتيريا (الأولوية)', t.pay('st1', 'M1', 30));
select t.eqn('M1 كافيتيريا دولار اتحصّل ٣٠', (current_setting('t.last_pay')::jsonb ->> 'cafeteria')::numeric, 30);
select t.eqn('M1 cafeteriaPaid=30', (t.f('M1', 'extras')::jsonb ->> 'cafeteriaPaid')::numeric, 30);
select t.eqn('M1 صف الكافيتيريا دولار ٣٠', t.cafe_sum('M1', 'USD'), 30);
select t.eqn('M1 مفيش صف غرفة للدفعة دي', t.room_sum('M1', 601), 0);
select t.pass('M1 دفع ٣٠ دولار تاني: ١٠ كافيتيريا و٢٠ غرفة', t.pay('st1', 'M1', 30));
select t.eqn('M1 منها ١٠ كافيتيريا', (current_setting('t.last_pay')::jsonb ->> 'cafeteria')::numeric, 10);
select t.eqn('M1 صف الكافيتيريا دولار بقى ٤٠', t.cafe_sum('M1', 'USD'), 40);
select t.eqn('M1 صف الغرفة دولار ٢٠', t.room_sum('M1', 601), 20);
select t.pass('M1 دفع ٥٠ جنيه: كلها كافيتيريا', t.fx('st1', 'M1', 50, 'EGP'));
select t.eqn('M1 كافيتيريا جنيه ٥٠', t.cafe_sum('M1', 'EGP'), 50);
select t.pass('M1 دفع ٥٠ جنيه تاني: ٣٠ كافيتيريا و٢٠ غسيل', t.fx('st1', 'M1', 50, 'EGP'));
select t.eqn('M1 كافيتيريا جنيه ٨٠ بالظبط', t.cafe_sum('M1', 'EGP'), 80);
select t.reject('M1 دفع زيادة بالجنيه مرفوض', t.fx('st1', 'M1', 1, 'EGP'), 'مفيش متبقي');

-- ---------- M2: غرفة عليها كافيتيريا بس (الغرفة مدفوعة)
select t.pass('M2 حجز مدفوع كامل', t.ins('st1', 'M2', 602, 200, 201, 100, 100, 100, true));
select t.eq('M2 مدفوع بالكامل', t.f('M2', 'settled'), 'true');
select t.pass('M2 كافيتيريا ٣٥ تتضاف', t.upd('st1', 'M2', 'extras = ''{"laundry":0,"cafeteria":35,"tours":0,"pickup":0}''::jsonb'));
select t.eq('M2 بقى عليه فلوس (مش settled)', t.f('M2', 'settled'), 'false');
select t.pass('M2 تحصيل ٣٥', t.pay('st1', 'M2', 35));
select t.eqn('M2 كلها كافيتيريا', (current_setting('t.last_pay')::jsonb ->> 'cafeteria')::numeric, 35);
select t.eqn('M2 صف الكافيتيريا ٣٥', t.cafe_sum('M2', 'USD'), 35);
select t.eq('M2 رجع مدفوع بالكامل', t.f('M2', 'settled'), 'true');
select t.pass('M2b كافيتيريا ١٥ جنيه (بعملة تانية) على حجز مدفوع', t.upd('st1', 'M2', 'other_charges = ''{"EGP":{"laundry":0,"cafeteria":15,"tours":0,"pickup":0}}''::jsonb'));
select t.eq('M2b مش settled (فيه متبقي بالجنيه)', t.f('M2', 'settled'), 'false');
select t.pass('M2b تحصيل ١٥ جنيه', t.fx('st1', 'M2', 15, 'EGP'));
select t.eq('M2b settled', t.f('M2', 'settled'), 'true');
select t.eqn('M2b صف الكافيتيريا جنيه ١٥', t.cafe_sum('M2', 'EGP'), 15);

-- ---------- M3: نقل حجز عليه كافيتيريا لسه مدفوعتش بالعملتين: لا شيء يتغيّر غير الغرفة
select t.pass('M3 حجز دولار', t.ins('st1', 'M3', 603, 200, 203, 50, 150));
select t.pass('M3 كافيتيريا دولار ٢٥ + جنيه ٩٠', t.upd('st1', 'M3', 'extras = ''{"laundry":0,"cafeteria":25,"tours":0,"pickup":0}''::jsonb, other_charges = ''{"EGP":{"laundry":0,"cafeteria":90,"tours":0,"pickup":0}}''::jsonb'));
select t.pass('M3 دفع جزئي ١٠ دولار (كافيتيريا)', t.pay('st1', 'M3', 10));
select t.pass('M3 دفع جزئي ٣٠ جنيه (كافيتيريا)', t.fx('st1', 'M3', 30, 'EGP'));
select t.snapshot('m3', 'M3');
select t.pass('M3 النقل من 603 لـ 604', t.mv('st1', 'M3', 604));
select t.eq('M3 الغرفة 604', t.f('M3', 'room'), '604');
select t.eq('M3 كل الفلوس والخدمات والكود زي ما هي', t.snap('M3'), t.snapof('m3'));
select t.pass('M3 الغرفة القديمة فضيت: حجز جديد عليها', t.ins('st1', 'M3new', 603, 200, 203, 50, 150));
select t.pass('M3 دفع ١٥ دولار بعد النقل: كلها كافيتيريا', t.pay('st1', 'M3', 15));
select t.eqn('M3 صف الكافيتيريا دولار ٢٥ (١٠ قبل النقل + ١٥ بعده) - نفس الحجز', t.cafe_sum('M3', 'USD'), 25);
select t.pass('M3 دفع ٦٠ جنيه بعد النقل', t.fx('st1', 'M3', 60, 'EGP'));
select t.eqn('M3 كافيتيريا جنيه ٩٠ بالظبط', t.cafe_sum('M3', 'EGP'), 90);
select t.pass('M3 دفع باقي الغرفة ١٥٠ دولار بعد النقل', t.pay('st1', 'M3', 150));
select t.eqn('M3 صف الغرفة اتسجل على 604 (الغرفة الجديدة)', t.room_sum('M3', 604), 150);
select t.eqn('M3 مفيش صف غرفة على 603 (مفيش دفعة غرفة قبل النقل)', t.room_sum('M3', 603), 0);
select t.eq('M3 مدفوع بالكامل بعد النقل', t.f('M3', 'settled'), 'true');
select t.eqn('M3 مجموع المدفوع بالدولار = ١٧٥ (غرفة ١٥٠ + كافيتيريا ٢٥)', t.fn('M3', 'amount_paid'), 175);

-- ---------- M4: دفع قبل النقل بصف غرفة، وبعد النقل الصف القديم يفضل على غرفته القديمة
select t.pass('M4 حجز دولار ٢٠٠', t.ins('st1', 'M4', 605, 200, 202, 100, 200));
select t.pass('M4 دفع ٧٠ دولار على 605', t.pay('st1', 'M4', 70));
select t.eqn('M4 صف 605 = ٧٠', t.room_sum('M4', 605), 70);
select t.pass('M4 نقل لـ 606', t.mv('st1', 'M4', 606));
select t.pass('M4 دفع ٣٠ بعد النقل', t.pay('st1', 'M4', 30));
select t.eqn('M4 صف 605 لسه ٧٠ (تاريخ)', t.room_sum('M4', 605), 70);
select t.eqn('M4 صف 606 = ٣٠', t.room_sum('M4', 606), 30);
select t.pass('M4 نقل تاني لـ 607', t.mv('st1', 'M4', 607));
select t.pass('M4 نقل رجوع لـ 605', t.mv('res1', 'M4', 605));
select t.pass('M4 دفع الباقي ١٠٠ على 605 بعد الرجوع', t.pay('st1', 'M4', 100));
select t.eqn('M4 صف 605 بقى ١٧٠ (نفس الصف اتجمّع)', t.room_sum('M4', 605), 170);
select t.eqn('M4 مجموع الصفوف = المدفوع', t.room_sum('M4', 605) + t.room_sum('M4', 606) + t.room_sum('M4', 607), t.fn('M4', 'amount_paid'));
select t.eq('M4 مدفوع بالكامل', t.f('M4', 'settled'), 'true');

-- ---------- M5: حدود التعارض (حجز ماشي جنب حجز)
select t.pass('M5 حجز في 608: ٢٠٠-٢٠٣', t.ins('st1', 'M5a', 608, 200, 203, 100, 300));
select t.pass('M5 حجز للنقل ٢٠٣-٢٠٥', t.ins('st1', 'M5b', 609, 203, 205, 100, 200));
select t.pass('M5 يتنقل ورا حجز بيخلص يوم ما يبدأ (تلاصق مش تعارض)', t.mv('st1', 'M5b', 608));
select t.pass('M5 حجز ٢٠٤-٢٠٦ في 610', t.ins('st1', 'M5c', 610, 204, 206, 100, 200));
select t.reject('M5 نقل متداخل ليلة واحدة مرفوض', t.mv('st1', 'M5b', 610), 'مش فاضية');
select t.eq('M5 الغرفة ما اتغيرتش بعد الرفض', t.f('M5b', 'room'), '608');
select t.pass('M5 حجز ملغي في 611 نفس التواريخ', t.ins('res1', 'M5d', 611, 203, 205, 100, 200, 0, false, 'ملغي'));
select t.pass('M5 النقل لغرفة فيها حجز ملغي مسموح', t.mv('st1', 'M5b', 611));
select t.reject('M5 غرفة مش موجودة', t.mv('st1', 'M5b', 999), 'مش موجودة');

-- ---------- M6: الرفض: ملغي / خلص / ممنوع / مش مفتوح شيفته / توقيت قديم
select t.pass('M6 حجز خلص (خرج)', t.ins('st1', 'M6done', 612, -5, -1, 100, 400));
select t.reject('M6 حجز انتهى مينقلش', t.mv('res1', 'M6done', 613), 'خلص');
select t.pass('M6 حجز خروجه النهارده', t.ins('st1', 'M6today', (select r.number from rooms r where not exists (select 1 from bookings b where b.room = r.number and b.stay_range && daterange(hotel_today() - 2, hotel_today())) order by 1 limit 1), -2, 0, 100, 200));
select t.reject('M6 حجز خروجه النهارده مينقلش', t.mv('res1', 'M6today', 615), 'خلص');
select t.pass('M6 حجز عادي للتوقيت', t.ins('st1', 'M6', 616, 200, 202, 100, 200));
select t.reject('M6 توقيت قديم مرفوض', t.mvx('st1', 'M6', 601, now() - interval '1 day'), 'اتغيّر');
select t.eq('M6 لسه في 616', t.f('M6', 'room'), '616');
select t.pass('M6 التوقيت الصح ينجح', t.mvx('st1', 'M6', 612, (select updated_at from bookings where id = (select id from t.ids where name = 'M6'))));
select t.reject('M6 gm مفيش مشكلة بس نفس الغرفة', t.mv('gm1', 'M6', 612), 'أصلًا');
select t.pass('M6 المدير العام ينقل', t.mv('gm1', 'M6', 613));
select t.reject('M6 المحاسبة مرفوضة', t.mv('acc1', 'M6', 614), 'صلاحية');
select t.reject('M6 حجز غير موجود', t.try('st1', $q$select move_booking_room(gen_random_uuid(), 601)$q$), 'مش موجود');
select t.pass('M6 تجهيز: قفل شيفتات st2', t.maint_sql($q$update shift_records set closed = true where staff_username = 'st2' and closed = false$q$));
select t.reject('M6 موظف شيفته مش مفتوح', t.mv('st2', 'M6', 614), 'شيفتك');
select t.eq('M6 لسه في 613', t.f('M6', 'room'), '613');

-- ---------- M7: أكواد الأفراد + قيد الحجز المزدوج + تعديل مباشر
select t.pass('M7 حجز بفردين', t.ins('st1', 'M7', 601, 210, 212, 100, 200));
select t.pass('M7 أكواد الأفراد', t.upd('res1', 'M7', 'pax = 2, guest_codes = ''["K7A","K7B"]''::jsonb'));
select t.eqn('M7 كودين مربوطين بالغرفة 601', (select count(*) from booking_guests where booking_id = (select id from t.ids where name = 'M7') and room = 601), 2);
select t.pass('M7 نقل', t.mv('st1', 'M7', 602));
select t.eqn('M7 الكودين بقوا على 602', (select count(*) from booking_guests where booking_id = (select id from t.ids where name = 'M7') and room = 602), 2);
select t.eqn('M7 مفيش كود على 601', (select count(*) from booking_guests where booking_id = (select id from t.ids where name = 'M7') and room = 601), 0);
select t.reject('M7 كود نفس الشهر مكرر لنزيل تاني مرفوض', t.upd('res1', 'M5a', 'pax = 1, guest_codes = ''["K7A"]''::jsonb'), 'مستخدم');
select t.reject('M7 الموظف مايعدّلش الغرفة مباشرة', t.upd('st1', 'M7', 'room = 603'), 'تعديل بيانات الحجز الأساسية');
select t.reject('M7 مدير الحجوزات: الحجز المزدوج بتعديل مباشر لسه ممنوع', t.upd('res1', 'M5c', 'room = 611'), 'bookings_no_overlap');

-- ---------- M8: حجز مدفوع أونلاين + نقل + كافيتيريا بعده
select t.pass('M8 حجز أونلاين ٢٠٠', t.ins('st1', 'M8', 609, 220, 222, 100, 200));
select t.pass('M8 تعليم أونلاين', t.upd('res1', 'M8', 'payment_details = ''{"senderName":"","senderNumber":"","ref":"","onlinePaid":true,"commissionPct":15,"onlineRoomAmount":200}''::jsonb'));
select t.pass('M8 كافيتيريا ٤٠ دولار + ٦٠ جنيه', t.upd('st1', 'M8', 'extras = ''{"laundry":0,"cafeteria":40,"tours":0,"pickup":0}''::jsonb, other_charges = ''{"EGP":{"laundry":0,"cafeteria":60,"tours":0,"pickup":0}}''::jsonb'));
select t.snapshot('m8', 'M8');
select t.pass('M8 نقل', t.mv('st1', 'M8', 610));
select t.eq('M8 تفاصيل الأونلاين والفلوس زي ما هي', t.snap('M8'), t.snapof('m8'));
select t.eqn('M8 المطلوب في الفندق ٤٠ بس', (select booking_hotel_total(b) from bookings b where id = (select id from t.ids where name = 'M8')), 40);
select t.pass('M8 تحصيل ٤٠ دولار بعد النقل', t.pay('st1', 'M8', 40));
select t.pass('M8 تحصيل ٦٠ جنيه بعد النقل', t.fx('st1', 'M8', 60, 'EGP'));
select t.eq('M8 مدفوع بالكامل', t.f('M8', 'settled'), 'true');

-- ---------- M9: تعديل الرسوم من الشاشة بعد النقل ما يمسحش اللي اتحصّل
select t.pass('M9 حجز', t.ins('st1', 'M9', 611, 230, 232, 100, 200));
select t.pass('M9 كافيتيريا ٥٠ دولار + ٤٠ جنيه', t.upd('st1', 'M9', 'extras = ''{"laundry":0,"cafeteria":50,"tours":0,"pickup":0}''::jsonb, other_charges = ''{"EGP":{"laundry":0,"cafeteria":40,"tours":0,"pickup":0}}''::jsonb'));
select t.pass('M9 تحصيل ٢٠ دولار + ١٠ جنيه', t.pay('st1', 'M9', 20));
select t.pass('M9 تحصيل جنيه', t.fx('st1', 'M9', 10, 'EGP'));
select t.pass('M9 نقل', t.mv('st1', 'M9', 612));
select t.pass('M9 الموظف يعدّل الخدمات من الشاشة (من غير cafeteriaPaid)', t.upd('st1', 'M9', 'extras = ''{"laundry":5,"cafeteria":50,"tours":0,"pickup":0}''::jsonb, other_charges = ''{"EGP":{"laundry":0,"cafeteria":40,"tours":0,"pickup":0}}''::jsonb'));
select t.eqn('M9 cafeteriaPaid دولار لسه ٢٠', (t.f('M9', 'extras')::jsonb ->> 'cafeteriaPaid')::numeric, 20);
select t.eqn('M9 cafeteriaPaid جنيه لسه ١٠', (t.f('M9', 'other_charges')::jsonb #>> '{EGP,cafeteriaPaid}')::numeric, 10);
select t.pass('M9 دفع ٣٠ دولار: كافيتيريا الأول', t.pay('st1', 'M9', 30));
select t.eqn('M9 منها ٣٠ كافيتيريا (كملت ٥٠)', (current_setting('t.last_pay')::jsonb ->> 'cafeteria')::numeric, 30);

-- ---------- M10: سلسلة نقلات متتالية + مجموع اليومية متطابق
select t.pass('M10 حجز', t.ins('st1', 'M10', 613, 240, 243, 100, 300));
select t.pass('M10 خدمات', t.upd('st1', 'M10', 'extras = ''{"laundry":0,"cafeteria":15,"tours":0,"pickup":0}''::jsonb'));
select t.snapshot('m10', 'M10');
select t.pass('M10 نقل ١', t.mv('st1', 'M10', 614));
select t.pass('M10 نقل ٢', t.mv('st1', 'M10', 615));
select t.pass('M10 نقل ٣', t.mv('res1', 'M10', 616));
select t.pass('M10 نقل ٤ رجوع', t.mv('gm1', 'M10', 613));
select t.eq('M10 بعد ٤ نقلات كل حاجة زي ما هي', t.snap('M10'), t.snapof('m10'));
select t.eqn('M10 تاريخ النقلات: حجز تاني يقدر ياخد 614 و615 و616', (select count(*) from bookings where room in (614, 615, 616) and guest_name = 'M10'), 0);
select t.pass('M10 ٣ حجوزات جديدة ياخدوا الغرف اللي فضيت', t.ins('st1', 'M10n1', 614, 240, 243, 100, 300));
select t.pass('M10 ', t.ins('st1', 'M10n2', 615, 240, 243, 100, 300));
select t.pass('M10 ', t.ins('st1', 'M10n3', 616, 240, 243, 100, 300));
select t.reject('M10 مفيش غرفة فاضية يتنقل ليها', t.mv('st1', 'M10', 614), 'مش فاضية');

-- ---------- M11: سلامة اليومية: مجموع صفوف كل حجز = المدفوع (غرفة + كافيتيريا) بكل عملة
select t.eqn('M11 M1 دولار: غرفة (من غير ٢٠ جنيه غسيل) + كافيتيريا = المدفوع', (t.room_sum('M1', 601) - 20) + t.cafe_sum('M1', 'USD'), t.fn('M1', 'amount_paid'));
select t.eqn('M11 M3 دولار: الغرفة+الكافيتيريا = المدفوع', t.room_sum('M3', 604) + t.room_sum('M3', 603) + t.cafe_sum('M3', 'USD'), t.fn('M3', 'amount_paid'));
select t.eqn('M11 M3 جنيه: الكافيتيريا = other_paid', t.cafe_sum('M3', 'EGP'), (select (other_paid ->> 'EGP')::numeric from bookings where id = (select id from t.ids where name = 'M3')));
