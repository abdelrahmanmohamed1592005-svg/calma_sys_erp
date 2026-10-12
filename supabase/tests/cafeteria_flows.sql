-- ======================================================================
-- H) الحالة التلقائية (settled) + كافيتيريا الاستاف (staff_cafeteria)
-- بتتشغّل بعد money_flows.sql (نفس المستخدمين: gm1 / res1 / st1 / st2 / acc1).
-- ======================================================================
-- (أ) الحالة بتتحسب لوحدها من المدفوع والإجمالي، والعلامة المبعوتة بتتتجاهل
select t.pass('H1 حجز بدون مدفوع', t.ins('st1', 'H1', 601, 40, 41, 100, 100, 0, true));
select t.eq('H1 مبعوتة true بس المدفوع صفر => false', t.f('H1', 'settled'), 'false');
select t.pass('H1 تحصيل نص المبلغ', t.maint('H1', 'amount_paid = 50'));
select t.eq('H1 دفع جزئي => false', t.f('H1', 'settled'), 'false');
select t.pass('H1 تحصيل الباقي', t.maint('H1', 'amount_paid = 100'));
select t.eq('H1 مدفوع بالكامل => true تلقائي', t.f('H1', 'settled'), 'true');
select t.pass('H1 رسوم إضافية', t.upd('st1', 'H1', 'extras = ''{"laundry":0,"cafeteria":25,"tours":0,"pickup":0}''::jsonb'));
select t.eq('H1 الإجمالي زاد => false تلقائي', t.f('H1', 'settled'), 'false');
select t.pass('H1 تحصيل كافيتيريا النزيل', t.maint('H1', 'amount_paid = 125'));
select t.eq('H1 رجع true', t.f('H1', 'settled'), 'true');
select t.pass('H1 إلغاء الحجز من مدير الحجوزات', t.upd('res1', 'H1', 'status = ''ملغي'''));
select t.eq('H1 الملغي مش متحصّل', t.f('H1', 'settled'), 'false');
select t.eq('H1 طلب رد للمدفوع', t.f('H1', 'refund_pending'), 'true');
-- حجز أونلاين: الفندق بيحصّل الخدمات بس
select t.pass('H2 حجز', t.ins('st1', 'H2', 602, 40, 41, 100, 100));
select t.pass('H2 تعليمه أونلاين من مدير الحجوزات', t.upd('res1', 'H2', 'payment_details = ''{"senderName":"","senderNumber":"","ref":"B","onlinePaid":true}''::jsonb'));
select t.eq('H2 أونلاين من غير خدمات: متحصّل تلقائي', t.f('H2', 'settled'), 'true');
select t.pass('H2 خدمات جولات', t.upd('st1', 'H2', 'extras = ''{"laundry":0,"cafeteria":0,"tours":30,"pickup":0}''::jsonb'));
select t.eq('H2 فيه خدمات لسه => false', t.f('H2', 'settled'), 'false');
select t.pass('H2 تحصيل الخدمات', t.maint('H2', 'amount_paid = 30'));
select t.eq('H2 بعد تحصيل الخدمات => true', t.f('H2', 'settled'), 'true');
-- مفيش قفل على السعر/الرسوم/وسيلة الدفع بعد التحصيل (مدير الحجوزات بيعدّل السعر وبيتحرّك طلب الرد لوحده)
select t.pass('H3 حجز مدفوع كامل', t.ins('st1', 'H3', 603, 40, 41, 100, 100, 100));
select t.pass('H3 مدير الحجوزات يغيّر وسيلة الدفع', t.upd('res1', 'H3', 'payment_method = ''فيزا'''));
select t.pass('H3 موظف الشيفت يغيّر وسيلة الدفع بعد الدفع الكامل', t.upd('st1', 'H3', 'payment_method = ''كاش'''));
select t.eq('H3 لسه متحصّل', t.f('H3', 'settled'), 'true');
-- مدير الحجوزات لسه ممنوع يلمس المدفوع
select t.reject('H3 مدير الحجوزات ميغيّرش المدفوع', t.upd('res1', 'H3', 'amount_paid = 10'), 'مش بتعديل مباشر');

-- (ب) تحصيل الكافيتيريا في اليومية
select t.pass('H4 عمود cafeteria_rows موجود وبيتحدّث من الموظف صاحب الشيفت', t.dml('st1', $q$update shift_records set cafeteria_rows = '[{"kind":"staff","collectionAmt":10}]'::jsonb where date = hotel_today() and shift_key = 'morning'$q$));

-- (ج) كافيتيريا الاستاف
select t.reject('H5 موظف مايضيفش استهلاك بالـ API مباشرة (لازم من اليومية)', t.dml('st1', $q$insert into staff_cafeteria(consumer_username, consumer_name, description, amount, currency, shift_key) values ('st2', 'مروة', 'قهوة', 40, 'EGP', 'morning')$q$), 'مش بإضافة مباشرة');
select t.reject('H5 مدير الحجوزات مايضيفش', t.dml('res1', $q$insert into staff_cafeteria(consumer_name, amount) values ('x', 5)$q$), 'مش بإضافة مباشرة');
-- تجهيز دين من غير جلسة مستخدم (محرر SQL) + قيود الجدول نفسها
select t.pass('H5 تجهيز دين (صيانة)', t.maint_sql($q$insert into staff_cafeteria(consumer_username, consumer_name, description, amount, currency, shift_key) values ('st2', 'مروة', 'قهوة', 40, 'EGP', 'morning')$q$));
select t.reject('H5 مبلغ صفر مرفوض', t.maint_sql($q$insert into staff_cafeteria(consumer_name, amount) values ('x', 0)$q$), 'check');
select t.reject('H5 مبلغ سالب مرفوض', t.maint_sql($q$insert into staff_cafeteria(consumer_name, amount) values ('x', -5)$q$), 'check');
select t.reject('H5 عملة غريبة مرفوضة', t.maint_sql($q$insert into staff_cafeteria(consumer_name, amount, currency) values ('x', 5, 'XYZ')$q$), 'check');
select t.reject('H5 اسم فاضي مرفوض', t.maint_sql($q$insert into staff_cafeteria(consumer_name, amount) values ('   ', 5)$q$), 'check');
select t.reject('H5 مدفوع أكبر من المبلغ مرفوض', t.maint_sql($q$insert into staff_cafeteria(consumer_name, amount, paid_amount) values ('x', 5, 9)$q$), 'check');
select t.reject('H5 موظف مايسدّدش بتحديث مباشر (لازم سداد الاستاف في اليومية)', t.dml('st2', $q$update staff_cafeteria set paid_amount = 15, payments = '[{"amount":15}]'::jsonb where consumer_name = 'مروة'$q$), 'السداد بس');
select t.reject('H5 موظف مايغيّرش المبلغ', t.dml('st1', $q$update staff_cafeteria set amount = 1 where consumer_name = 'مروة'$q$), 'السداد بس');
select t.reject('H5 موظف مايغيّرش الاسم', t.dml('st1', $q$update staff_cafeteria set consumer_name = 'حد تاني' where consumer_name = 'مروة'$q$), 'المدير العام أو الحسابات');
select t.reject('H5 موظف مايمسحش', t.dml('st1', $q$delete from staff_cafeteria where consumer_name = 'مروة'$q$), 'NO_ROWS');
select t.reject('H5 مدير الحجوزات مايعدّلش', t.dml('res1', $q$update staff_cafeteria set paid_amount = 40 where consumer_name = 'مروة'$q$), 'NO_ROWS');
select t.eq('H5 مدير الحجوزات بيشوف السجل (قراءة)', (select (t.try('res1', 'select 1 from staff_cafeteria')) is null)::text, 'true');
select t.reject('H5 حتى الحسابات مابتغيّرش المبلغ من الـ API (التصحيح من محرر SQL)', t.dml('acc1', $q$update staff_cafeteria set amount = 45 where consumer_name = 'مروة'$q$), 'السداد بس');
select t.pass('H5 الحسابات تغيّر وصف الاستهلاك (مش فلوس)', t.dml('acc1', $q$update staff_cafeteria set description = 'قهوة وكيك' where consumer_name = 'مروة'$q$));
select t.pass('H5 المدير العام يمسح', t.dml('gm1', $q$delete from staff_cafeteria where consumer_name = 'مروة'$q$));
