-- ======================================================================
-- C-2) حالات دفع مختلفة للخروج المبكر + رسوم إضافية مع الإلغاء
-- ======================================================================
select t.pass('C11 نزيل مدفوع جزئيًا (٣٠٠ من ٤٠٠)', t.ins('st1', 'C11', 608, -2, 2, 100, 400, 300, false));
select t.pass('C11 يغادر بعد ليلتين (الإجمالي ٢٠٠)', t.upd('st1', 'C11', 'checkout = hotel_today(), total_room = 200, status = ''تم تسجيل الخروج'', left_early = true'));
select t.eq('C11 طلب رد للزيادة', t.f('C11', 'refund_pending'), 'true');
select t.pass('C11 رد الزيادة', t.decide('res1', 'C11', 'refund'));
select t.eqn('C11 المردود = ٣٠٠ - ٢٠٠', (current_setting('t.last_decision')::jsonb ->> 'amount')::numeric, 100);
select t.eqn('C11 المدفوع بعد الرد = الإجمالي', t.fn('C11', 'amount_paid'), 200);
select t.pass('C12 نزيل مدفوع قليل (١٠٠ من ٤٠٠)', t.ins('st1', 'C12', 606, -2, 2, 100, 400, 100, false));
select t.pass('C12 يغادر بعد ليلتين', t.upd('st1', 'C12', 'checkout = hotel_today(), total_room = 200, status = ''تم تسجيل الخروج'', left_early = true'));
select t.eq('C12 مفيش طلب رد (المدفوع أقل من الإجمالي الجديد)', t.f('C12', 'refund_pending'), 'false');
select t.pass('C13 حجز بسعر خصم (٣٦٠ لـ ٤ ليالي)', t.ins('st1', 'C13', 607, -2, 2, 100, 360, 360, true));
select t.pass('C13 تقصير نص المدة (الإجمالي ١٨٠ بمتوسط السعر مش ٢٠٠)', t.upd('st1', 'C13', 'checkout = hotel_today(), total_room = 180, status = ''تم تسجيل الخروج'', left_early = true'));
select t.reject('C13 بسعر الليلة الاسمي (٢٠٠) بعد التقصير مرفوض (الحجز متحصّل ومقفول السعر)', t.upd('st1', 'C13', 'total_room = 200'), 'متحصّل بالكامل');
select t.pass('D3 حجز جديد', t.ins('st1', 'D3', 608, 5, 6, 100, 100, 0, false));
select t.pass('D3 رسوم إضافية جولات ٢٠', t.upd('st1', 'D3', 'extras = ''{"laundry":0,"cafeteria":0,"tours":20,"pickup":0}''::jsonb'));
select t.pass('D3 تحصيل الإجمالي كله ١٢٠', t.upd('st1', 'D3', 'amount_paid = 120, settled = true'));
select t.pass('D3 يتلغي', t.upd('res1', 'D3', 'status = ''ملغي'''));
select t.pass('D3 رد كل المدفوع', t.decide('res1', 'D3', 'refund'));
select t.eqn('D3 المردود ١٢٠ (غرفة + رسوم)', (current_setting('t.last_decision')::jsonb ->> 'amount')::numeric, 120);

-- ======================================================================
-- G) يومية الشيفت: ملكية، قفل، إعادة فتح، تصحيح بعد الإقفال
-- ======================================================================
select t.pass('G1 الموظف يعدّل يوميته المفتوحة', t.dml('st1', $q$update shift_records set shift_notes = 'ملاحظة' where date = hotel_today() and shift_key = 'morning'$q$));
select t.reject('G2 موظف تاني مايعدّلش يومية غيره', t.dml('st2', $q$update shift_records set shift_notes = 'اختراق' where date = hotel_today() and shift_key = 'morning'$q$), 'NO_ROWS');
select t.reject('G2 المدير العام مايعدّلش يومية مفتوحة', t.dml('gm1', $q$update shift_records set shift_notes = 'x' where date = hotel_today() and shift_key = 'morning'$q$), 'NO_ROWS');
select t.reject('G2 مدير الحجوزات مايعدّلش يومية مفتوحة', t.dml('res1', $q$update shift_records set shift_notes = 'x' where date = hotel_today() and shift_key = 'morning'$q$), 'NO_ROWS');
select t.reject('G10 تغيير صاحب اليومية مرفوض', t.dml('st1', $q$update shift_records set staff_username = 'st2' where date = hotel_today() and shift_key = 'morning'$q$), 'مينفعش يتغيّروا');
select t.reject('G10 تغيير تاريخ اليومية مرفوض', t.dml('st1', $q$update shift_records set date = hotel_today() - 5 where shift_key = 'morning'$q$), 'مينفعش يتغيّروا');
select t.pass('G3 الموظف يقفل يوميته', t.dml('st1', $q$update shift_records set closed = true, closed_by = 'st1', closed_at = now() where date = hotel_today() and shift_key = 'morning'$q$));
select t.reject('G3 مفيش تعديل بعد القفل من الموظف', t.dml('st1', $q$update shift_records set shift_notes = 'بعد القفل' where date = hotel_today() and shift_key = 'morning'$q$), 'مقفول');
select t.reject('G4 الموظف مايفتحش شيفته بنفسه', t.dml('st1', $q$update shift_records set closed = false where date = hotel_today() and shift_key = 'morning'$q$), 'إعادة فتح');
select t.reject('G6 مدير الحجوزات مايعدّلش محتوى شيفت مقفول (بس يفتحه)', t.dml('res1', $q$update shift_records set shift_notes = 'x' where date = hotel_today() and shift_key = 'morning'$q$), 'لا يمكن تعديل شيفت مقفول');
select t.pass('G7 المحاسبة تصحّح محتوى شيفت مقفول', t.dml('acc1', $q$update shift_records set shift_notes = 'تصحيح محاسبي' where date = hotel_today() and shift_key = 'morning'$q$));
select t.pass('G5 مدير الحجوزات يفتح الشيفت', t.dml('res1', $q$update shift_records set closed = false, closed_by = null, closed_at = null where date = hotel_today() and shift_key = 'morning'$q$));
select t.pass('G5 الموظف يكمل بعد إعادة الفتح', t.dml('st1', $q$update shift_records set shift_notes = 'كمّلت' where date = hotel_today() and shift_key = 'morning'$q$));
select t.pass('G5 الموظف يقفل تاني', t.dml('st1', $q$update shift_records set closed = true where date = hotel_today() and shift_key = 'morning'$q$));
select t.pass('G5 المدير العام يفتحه', t.dml('gm1', $q$update shift_records set closed = false where date = hotel_today() and shift_key = 'morning'$q$));
select t.reject('G8 الموظف مايمسحش يومية', t.dml('st1', $q$delete from shift_records where date = hotel_today()$q$), 'NO_ROWS');
select t.reject('G11 موظف يحجز شيفت بتاريخ بعيد', t.dml('st2', $q$insert into shift_claims(date, shift_key, username, name) values (hotel_today() + 30, 'morning', 'st2', 'st2')$q$), 'row-level security');
select t.reject('G11 موظف ينشئ يومية لشيفت مش حاجزه', t.dml('st2', $q$insert into shift_records(date, shift_key) values (hotel_today(), 'evening')$q$), 'row-level security');
-- الموظف التالي يقفل الشيفت اللي قبله (إقفال تلقائي لحظة ما يبدأ)
insert into shift_claims(date, shift_key, username, name) values (hotel_today() - 1, 'evening', 'st1', 'st1');
insert into shift_records(date, shift_key, staff_name, staff_username) values (hotel_today() - 1, 'evening', 'st1', 'st1');
select t.reject('G9 قبل ما يحجز الشيفت التالي مايقدرش يقفل شيفت غيره', t.dml('st2', $q$update shift_records set closed = true where date = hotel_today() - 1 and shift_key = 'evening'$q$), 'NO_ROWS');
select t.pass('G9 الموظف يحجز الشيفت التالي (المسائي → الليلي)', t.dml('st2', $q$insert into shift_claims(date, shift_key, username, name) values (hotel_today() - 1, 'night', 'st2', 'st2')$q$));
select t.pass('G9 وبعدها يقفل الشيفت اللي قبله', t.dml('st2', $q$update shift_records set closed = true, closed_by = 'st2 (إقفال تلقائي)' where date = hotel_today() - 1 and shift_key = 'evening'$q$));
select t.pass('G12 الموظف ينشئ يومية شيفته المحجوز', t.dml('st2', $q$insert into shift_records(date, shift_key) values (hotel_today() - 1, 'night')$q$));

-- ======================================================================
-- H) سجل الحركة والبروفايلات
-- ======================================================================
select t.pass('H1 الموظف يسجّل حركة', t.dml('st1', $q$insert into activity_log(user_name, username, role, action) values ('انتحال', 'gm1', 'gm', 'حركة مزوّرة')$q$));
select t.eq('H1 الهوية بتتفرض من الجلسة مش من اللي اتبعت', (select username || '/' || role from activity_log where action = 'حركة مزوّرة'), 'st1/staff');
select t.reject('H2 سجل الحركة مايتعدّلش', t.dml('st1', $q$update activity_log set action = 'تعديل'$q$), 'permission denied');
select t.reject('H2 سجل الحركة مايتمسحش', t.dml('gm1', $q$delete from activity_log$q$), 'permission denied');
select t.reject('H3 الموظف مايرقّيش نفسه', t.dml('st1', $q$update profiles set role = 'gm' where username = 'st1'$q$), 'NO_ROWS');
select t.reject('H4 الموظف مايضيفش بروفايل', t.dml('st1', $q$insert into profiles(id, username, name, role) select gen_random_uuid(), 'x', 'x', 'gm'$q$), 'row-level security');
select t.reject('H5 اسم المستخدم ثابت', t.dml('gm1', $q$update profiles set username = 'renamed' where username = 'st2'$q$), 'مينفعش يتغيّروا');
select t.reject('H6 آخر مدير عام مايتعطّلش', t.dml('gm1', $q$update profiles set active = false where username = 'gm1'$q$), 'مدير عام واحد');
select t.reject('H6 ولا يتنزّل دوره', t.dml('gm1', $q$update profiles set role = 'staff' where username = 'gm1'$q$), 'مدير عام واحد');
select t.pass('H7 المدير العام يعطّل موظف', t.dml('gm1', $q$update profiles set active = false where username = 'st2'$q$));
select t.reject('H7 الموظف المعطّل مايقدرش يضيف حجز', t.ins('st2', 'H7', 609, 20, 21, 100, 100), 'row-level security');
select t.pass('H7 المدير العام يفعّله تاني', t.dml('gm1', $q$update profiles set active = true where username = 'st2'$q$));

-- ======================================================================
-- A-3) تمديد الموظف لحجز متحصّل، وتمديد فوق حجز تاني، وحذف حجز عليه فلوس
-- ======================================================================
select t.pass('A13 حجز ليلة مدفوع ومتحصّل', t.ins('st1', 'A13', 610, 20, 21, 100, 100, 100, true));
select t.reject('A13 الموظف يمدّد وعلامة متحصّل لسه true (متبقي جديد) مرفوض', t.upd('st1', 'A13', 'checkout = hotel_today() + 22, total_room = 200'), 'مينفعش');
select t.pass('A13 تمديد صحيح: بيشيل علامة متحصّل والمتبقي بيظهر', t.upd('st1', 'A13', 'checkout = hotel_today() + 22, total_room = 200, settled = false'));
select t.pass('A14 حجز بعده على نفس الغرفة', t.ins('st1', 'A14', 610, 23, 25, 100, 200));
select t.reject('A14 تمديد فوق حجز تاني (حجز مزدوج) مرفوض', t.upd('st1', 'A13', 'checkout = hotel_today() + 24, total_room = 400'), 'bookings_no_overlap');
select t.pass('A15 حجز بدون فلوس', t.ins('st1', 'A15', 611, 30, 31, 100, 100));
select t.pass('A15 حجز عليه فلوس', t.ins('st1', 'A15p', 611, 32, 33, 100, 100, 100, true));
select t.reject('A15 الموظف مايمسحش حجز', t.dml('st1', $q$delete from bookings where guest_name = 'A15'$q$), 'NO_ROWS');
select t.reject('A15 المدير العام مايمسحش حجز', t.dml('gm1', $q$delete from bookings where guest_name = 'A15'$q$), 'NO_ROWS');
select t.reject('A15 مدير الحجوزات مايمسحش حجز عليه فلوس (يلغيه بدل كده)', t.dml('res1', $q$delete from bookings where guest_name = 'A15p'$q$), 'حركة فلوس');
select t.pass('A15 مدير الحجوزات يمسح حجز من غير فلوس', t.dml('res1', $q$delete from bookings where guest_name = 'A15'$q$));
select t.pass('A16 حجز اتلغى ورُدّت فلوسه', t.ins('st1', 'A16', 602, 40, 41, 100, 100, 100, true));
select t.pass('A16 يتلغي', t.upd('res1', 'A16', 'status = ''ملغي'''));
select t.pass('A16 رد الفلوس', t.decide('res1', 'A16', 'refund'));
select t.reject('A16 حجز اتردّت فلوسه مايتمسحش (سجل مالي)', t.dml('res1', $q$delete from bookings where guest_name = 'A16'$q$), 'حركة فلوس');

