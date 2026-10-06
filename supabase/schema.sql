-- ============================================================================
-- Calma Hotel System - قاعدة البيانات (النسخة الموحّدة والنهائية)
-- شغّل الملف ده كامل مرة واحدة بس في Supabase SQL Editor على مشروع جديد -
-- آمن تشغّله أكتر من مرة على مشروع موجود بالفعل (كل حاجة فيه idempotent).
--
-- ده الملف الوحيد المطلوب من دلوقتي فصاعدًا. كل إصلاحات الأمان والصلاحيات
-- اللي اتعملت على مراحل بقت مدمجة هنا في مكان واحد، فأي نسخة جديدة من
-- النظام (لعميل تاني، أو استعادة بعد كارثة) هتبقى محمية من أول تشغيل من
-- غير ما حد يحتاج يفتكر يشغّل ملفات patch منفصلة.

-- ============================================================================
-- Calma Hotel System - قاعدة البيانات (النسخة المُطبّعة الكاملة)
-- شغّل الملف ده كامل مرة واحدة في Supabase SQL Editor - آمن تشغّله أكتر من مرة

-- --------------------------------------------------------------------------
-- 0) دوال مساعدة عامة
-- --------------------------------------------------------------------------
create extension if not exists pgcrypto;

create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- --------------------------------------------------------------------------
-- 1) البروفايلات (مربوطة بنظام تسجيل الدخول الحقيقي Supabase Auth)
-- --------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  name text not null,
  role text not null check (role in ('staff','reservations','accounts','gm')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function is_gm()
returns boolean language sql security definer stable as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'gm' and active = true);
$$;

create or replace function is_active_user()
returns boolean language sql security definer stable as $$
  select exists (select 1 from profiles where id = auth.uid() and active = true);
$$;

create or replace function profiles_exist()
returns boolean language sql security definer stable as $$
  select exists(select 1 from profiles limit 1);
$$;

alter table profiles enable row level security;
drop policy if exists "profiles select" on profiles;
create policy "profiles select" on profiles for select using (auth.uid() is not null);
drop policy if exists "profiles insert" on profiles;
create policy "profiles insert" on profiles for insert
  with check ((select count(*) from profiles) = 0 or is_gm());
drop policy if exists "profiles update" on profiles;
create policy "profiles update" on profiles for update using (is_gm()) with check (is_gm());

-- --------------------------------------------------------------------------
-- 2) الغرف
-- --------------------------------------------------------------------------
create table if not exists rooms (
  number integer primary key,
  name text
);

-- الغرفة بقت بس رقمها + اسمها (الاسم/الكود اللي الفندق فعليًا بيستخدمه على
-- الباب)؛ مفيش نوع غرفة ولا سعر ثابت ولا سعة ولا أسرّة محفوظة على الغرفة -
-- كل ده بيتحدد من الحجز نفسه. الأعمدة القديمة دي بتُشال هنا (لو لسه موجودة
-- من نسخة قديمة) من غير ما تبوّظ حاجة، لأن الكود مش بيقراها خالص دلوقتي.
alter table rooms add column if not exists name text;
alter table rooms drop column if exists type;
alter table rooms drop column if exists price;
alter table rooms drop column if exists currency;
alter table rooms drop column if exists capacity;
alter table rooms drop column if exists beds;

alter table rooms enable row level security;
drop policy if exists "rooms select" on rooms;
create policy "rooms select" on rooms for select using (auth.uid() is not null);
drop policy if exists "rooms write" on rooms;
create policy "rooms write" on rooms for all using (is_active_user()) with check (is_active_user());

-- بيانات الغرف الحقيقية (الاسم/الكود المكتوب على كل باب فعليًا). "on
-- conflict ... do update" يعني تشغيل السكريبت ده تاني (بعد ما تغيّري اسم
-- غرفة من هنا) بيحدّث الاسم المسجّل من غير ما يضيف صف جديد أو يلمس أي حجوزات.
insert into rooms (number, name) values
  (601, '(t)601داخلي'),
  (602, '602(S/D)داخلي'),
  (603, '603(T)تراس'),
  (604, '(W)604(D)'),
  (605, '(b)605(D)'),
  (606, '(W)606(T)'),
  (607, '(W)607(T)'),
  (608, '(b)608(D)'),
  (609, '(b)609(D)'),
  (610, '(W)610(D)'),
  (611, '(W)611(D)'),
  (612, '(b)612(D)'),
  (613, '(B)613(T)'),
  (614, '(W)614(Q)'),
  (615, '615(S)داخلي'),
  (616, '616(S)داخلي')
on conflict (number) do update set name = excluded.name;

-- --------------------------------------------------------------------------
-- 3) حالة الغرف اليدوية (صيانة / تنظيف / غادر مبكرًا...)
-- --------------------------------------------------------------------------
create table if not exists room_overrides (
  room_number integer primary key references rooms(number) on delete cascade,
  status text not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table room_overrides enable row level security;
drop policy if exists "overrides select" on room_overrides;
create policy "overrides select" on room_overrides for select using (auth.uid() is not null);
drop policy if exists "overrides write" on room_overrides;
create policy "overrides write" on room_overrides for all using (is_active_user()) with check (is_active_user());

-- --------------------------------------------------------------------------
-- 4) الحجوزات - كل حجز صف مستقل (مش JSON مجمّع)
-- --------------------------------------------------------------------------
create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  code text,
  room integer not null references rooms(number),
  guest_name text not null default '',
  phone text default '',
  pax integer not null default 1,
  checkin date not null,
  checkout date not null,
  price_night numeric not null default 0,
  currency text not null default 'USD',
  total_room numeric not null default 0,
  extras jsonb not null default '{"laundry":0,"cafeteria":0,"tours":0,"pickup":0}'::jsonb,
  early_checkin jsonb not null default '{"applied":false,"fee":0,"note":""}'::jsonb,
  payment_method text not null default 'كاش',
  payment_details jsonb not null default '{"senderName":"","senderNumber":"","ref":""}'::jsonb,
  amount_paid numeric not null default 0,
  amount_tendered numeric not null default 0,
  source text not null default 'مباشر',
  status text not null default 'مؤكد',
  approval_status text not null default 'approved' check (approval_status in ('approved','pending')),
  settled boolean not null default false,
  notes text default '',
  imported boolean not null default false,
  needs_room_review boolean not null default false,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bookings_room_dates_idx on bookings (room, checkin, checkout);
create index if not exists bookings_code_idx on bookings (code);

drop trigger if exists bookings_touch on bookings;
create trigger bookings_touch before update on bookings
  for each row execute function touch_updated_at();

alter table bookings enable row level security;
drop policy if exists "bookings select" on bookings;
create policy "bookings select" on bookings for select using (auth.uid() is not null);
drop policy if exists "bookings write" on bookings;
create policy "bookings write" on bookings for all using (is_active_user()) with check (is_active_user());

-- --------------------------------------------------------------------------
-- 5) اليومية - صف واحد لكل شيفت (تفاصيل الغرف جوه عمود jsonb لأنها بنية ثابتة صغيرة)
-- --------------------------------------------------------------------------
create table if not exists shift_records (
  date date not null,
  shift_key text not null check (shift_key in ('morning','evening','night')),
  staff_name text,
  staff_username text,
  handover jsonb not null default '{"EGP":0,"USD":0}'::jsonb,
  rows jsonb not null default '[]'::jsonb,
  cafeteria jsonb not null default '{}'::jsonb,
  shift_notes text default '',
  flagged boolean not null default false,
  closed boolean not null default false,
  closed_by text,
  closed_at timestamptz,
  total_expenses jsonb,
  total_collections jsonb,
  closing_cash jsonb,
  updated_at timestamptz not null default now(),
  primary key (date, shift_key)
);

drop trigger if exists shift_records_touch on shift_records;
create trigger shift_records_touch before update on shift_records
  for each row execute function touch_updated_at();

alter table shift_records enable row level security;
drop policy if exists "shifts select" on shift_records;
create policy "shifts select" on shift_records for select using (auth.uid() is not null);
drop policy if exists "shifts write" on shift_records;
create policy "shifts write" on shift_records for all using (is_active_user()) with check (is_active_user());

-- --------------------------------------------------------------------------
-- 6) اختيار الشيفت اليومي لكل موظف (مرة واحدة في اليوم، مقفول بعد اختياره)
-- --------------------------------------------------------------------------
create table if not exists shift_claims (
  date date not null,
  shift_key text not null check (shift_key in ('morning','evening','night')),
  username text not null,
  name text not null,
  claimed_at timestamptz not null default now(),
  primary key (date, shift_key)
);

alter table shift_claims enable row level security;
drop policy if exists "claims select" on shift_claims;
create policy "claims select" on shift_claims for select using (auth.uid() is not null);
drop policy if exists "claims write" on shift_claims;
create policy "claims write" on shift_claims for all using (is_active_user()) with check (is_active_user());

-- --------------------------------------------------------------------------
-- 7) سجل الحركة
-- --------------------------------------------------------------------------
create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null default now(),
  user_name text,
  username text,
  role text,
  action text not null
);

create index if not exists activity_log_ts_idx on activity_log (ts desc);

alter table activity_log enable row level security;
drop policy if exists "activity select" on activity_log;
create policy "activity select" on activity_log for select using (auth.uid() is not null);
drop policy if exists "activity insert" on activity_log;
create policy "activity insert" on activity_log for insert with check (is_active_user());

-- --------------------------------------------------------------------------
-- 8) البث اللحظي على كل الجداول (محصّن ضد فشل جزئي)
-- --------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profiles','rooms','room_overrides','bookings','shift_records','shift_claims','activity_log']
  loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null; when others then null;
    end;
  end loop;
end $$;

-- --------------------------------------------------------------------------
-- 9) صلاحيات تنفيذ الدوال
-- --------------------------------------------------------------------------
grant execute on function profiles_exist() to anon, authenticated;
grant execute on function is_gm() to authenticated;
grant execute on function is_active_user() to authenticated;

-- ============================================================================


-- ============================================================================
-- Calma Hotel System - سكريبت إصلاحات شامل
-- شغّليه كامل مرة واحدة في Supabase SQL Editor - آمن تشغّله أكتر من مرة
--
-- ملاحظة مهمة: السكريبت ده بيعالج كل نقاط الأمان وتكامل البيانات اللي راجعناها
-- في السكريبت الأصلي. مش بديل عن اختبار فعلي للتطبيق، وفيه جزء واحد (status
-- enum) اتسيب عمدًا من غير قيد صارم لأني مش عارف كل القيم اللي التطبيق
-- بيبعتها فعليًا - شرح السبب تحت في القسم 7.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1) صلاحيات GRANT الأساسية على الجداول (سبب مشكلة "permission denied")
-- --------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select, insert, update on profiles to authenticated;
grant select, insert on profiles to anon;

grant select on rooms to anon, authenticated;
grant insert, update, delete on rooms to authenticated;

grant select, insert, update, delete on room_overrides to authenticated;
grant select, insert, update, delete on bookings to authenticated;
grant select, insert, update, delete on shift_records to authenticated;
grant select, insert, update, delete on shift_claims to authenticated;
grant select, insert on activity_log to authenticated;

-- --------------------------------------------------------------------------
-- 2) تحصين الدوال الحالية (إضافة search_path ثابت - أمان Postgres قياسي)
-- --------------------------------------------------------------------------
create or replace function is_gm()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'gm' and active = true);
$$;

create or replace function is_active_user()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active = true);
$$;

create or replace function profiles_exist()
returns boolean language sql security definer stable set search_path = public as $$
  select exists(select 1 from profiles limit 1);
$$;

-- دالة جديدة: هل المستخدم الحالي مدير عام أو حسابات (لعمليات الحذف المالية)
create or replace function can_manage_financials()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role in ('gm','accounts') and active = true
  );
$$;

-- دالة جديدة: هل المستخدم الحالي "مدير حجوزات" - ده الدور اللي فعليًا معاه
-- editBookings / canApproveBookings = true في كود التطبيق (constants.js) -
-- مش gm ولا accounts زي ما كنت مفتكر أول مرة
create or replace function is_reservations_manager()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'reservations' and active = true
  );
$$;

-- دالتين جديدتين: هل الدور الحالي ستاف بالظبط، وهل هو ستاف أو مدير حجوزات
-- (الدورين اللي فعليًا بيكتبوا على الحجوزات/حالة الغرف في التطبيق -
-- راجعت PERMISSIONS في constants.js: accounts و gm عندهم canCreateBookings
-- و editBookings و editRoomStatus و markPaymentReceived كلها false، يعني
-- مفروض أصلاً ميقدروش يكتبوا على الجداول دي - كانت الصلاحية القديمة
-- is_active_user() بتسمحلهم يعدّلوا مباشرة عن طريق الـ API من غير ما يمروا
-- على الواجهة خالص، وده كان بيكسر فصل الصلاحيات اللي التطبيق بيوعد بيه)
create or replace function is_staff()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'staff' and active = true);
$$;

create or replace function is_staff_or_reservations()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('staff','reservations') and active = true);
$$;

grant execute on function profiles_exist() to anon, authenticated;
grant execute on function is_gm() to authenticated;
grant execute on function is_active_user() to authenticated;
grant execute on function can_manage_financials() to authenticated;
grant execute on function is_reservations_manager() to authenticated;
grant execute on function is_staff() to authenticated;
grant execute on function is_staff_or_reservations() to authenticated;

-- --------------------------------------------------------------------------
-- 3) حماية آخر مدير عام نشط (اكتشفت من كود التطبيق إن UsersPanel.jsx بيسمح
--    بأكتر من مدير عام نشط في نفس الوقت عمدًا - ده مش خطأ، ده تصميم مقصود.
--    اللي فعلاً محتاج حماية هو منع تعطيل آخر مدير عام نشط، وده حاليًا محمي
--    في الفرونت إند بس (toggleActive في UsersPanel.jsx) وممكن يتلف لو حد
--    نادى الـ API مباشرة. التريجر ده بينقل نفس الحماية لقاعدة البيانات.
-- --------------------------------------------------------------------------
create or replace function prevent_last_gm_deactivation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'gm' and old.active = true and new.active = false then
    if not exists (
      select 1 from profiles
      where role = 'gm' and active = true and id <> old.id
    ) then
      raise exception 'لازم يفضل مدير عام واحد فعّال على الأقل';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_last_gm on profiles;
create trigger profiles_protect_last_gm before update on profiles
  for each row execute function prevent_last_gm_deactivation();

-- --------------------------------------------------------------------------
-- 4) تريجر: تعبئة هوية الفاعل الحقيقية تلقائيًا (بدل النص الحر من العميل)
--    ده بيمنع أي حد إنه "يوقّع" باسم زميله في السجلات
-- --------------------------------------------------------------------------
create or replace function set_actor_fields()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_username text;
  v_name text;
  v_role text;
begin
  select username, name, role into v_username, v_name, v_role
  from profiles where id = auth.uid();

  if TG_TABLE_NAME = 'activity_log' then
    new.username := coalesce(v_username, new.username);
    new.user_name := coalesce(v_name, new.user_name);
    new.role := coalesce(v_role, new.role);
  elsif TG_TABLE_NAME = 'shift_records' then
    new.staff_username := coalesce(v_username, new.staff_username);
    new.staff_name := coalesce(v_name, new.staff_name);
  elsif TG_TABLE_NAME = 'bookings' then
    new.created_by := coalesce(v_username, new.created_by);
  elsif TG_TABLE_NAME = 'shift_claims' then
    new.username := coalesce(v_username, new.username);
    new.name := coalesce(v_name, new.name);
  end if;

  return new;
end;
$$;

drop trigger if exists activity_log_actor on activity_log;
create trigger activity_log_actor before insert on activity_log
  for each row execute function set_actor_fields();

drop trigger if exists shift_records_actor on shift_records;
create trigger shift_records_actor before insert on shift_records
  for each row execute function set_actor_fields();

drop trigger if exists bookings_actor on bookings;
create trigger bookings_actor before insert on bookings
  for each row execute function set_actor_fields();

drop trigger if exists shift_claims_actor on shift_claims;
create trigger shift_claims_actor before insert on shift_claims
  for each row execute function set_actor_fields();

-- --------------------------------------------------------------------------
-- 5) تريجر: منع تعديل شيفت مقفول إلا من المدير العام أو الحسابات
-- --------------------------------------------------------------------------
create or replace function prevent_closed_shift_edit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.closed = true and not can_manage_financials() then
    raise exception 'لا يمكن تعديل شيفت مقفول إلا من المدير العام أو الحسابات';
  end if;
  return new;
end;
$$;

drop trigger if exists shift_records_lock on shift_records;
create trigger shift_records_lock before update on shift_records
  for each row execute function prevent_closed_shift_edit();

-- --------------------------------------------------------------------------
-- 6) تريجر: منع أي حد يوافق على حجزه لنفسه (approval_status)
--    ملاحظة: راجعت constants.js في كود التطبيق - "canApproveBookings: true"
--    معمولة لدور "reservations" (مدير الحجوزات) بس، مش gm ولا accounts.
--    لو قيدتها عليهم كنت هكسر ميزة الموافقة فعليًا لصاحب الصلاحية الحقيقي.
-- --------------------------------------------------------------------------
create or replace function prevent_self_approval()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.approval_status is distinct from old.approval_status
     and not is_reservations_manager() then
    raise exception 'فقط مدير الحجوزات يقدر يغيّر حالة اعتماد الحجز';
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_approval_guard on bookings;
create trigger bookings_approval_guard before update on bookings
  for each row execute function prevent_self_approval();

-- --------------------------------------------------------------------------
-- 7) قيود تكامل البيانات (Data Integrity Checks)
--    ملاحظة عن "status": متعمد مسيبتوش check enum لأني مش شايف كل القيم
--    اللي التطبيق بيبعتها فعليًا (مؤكد/ملغي/... إلخ). لو بعتيلي القائمة
--    الكاملة أقدر أضيفه بأمان من غير ما يبوّظ حجوزات موجودة.
-- --------------------------------------------------------------------------
do $$ begin
  alter table bookings add constraint bookings_dates_valid check (checkout > checkin);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table bookings add constraint bookings_pax_positive check (pax > 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table bookings add constraint bookings_amounts_nonneg check (
    price_night >= 0 and total_room >= 0 and amount_paid >= 0 and amount_tendered >= 0
  );
exception when duplicate_object then null; end $$;

-- الشرط القديم على extras/early_checkin كان بيتأكد إن المفاتيح موجودة بس
-- مش إن القيم مش سالبة - يعني موظف كان يقدر يكتب رقم سالب في "غسيل" مثلاً
-- ويقلل إجمالي الحجز من غير ما حد يدري أو حاجة توقفه. لو فيه حجوزات قديمة
-- فيها قيم سالبة فعلاً، القيد مش هيتضاف (NOTICE بدل ما يوقف باقي السكريبت)
-- - راجعي الحجوزات دي يدويًا وصلّحيها ثم شغّلي الملف تاني.
do $$ begin
  alter table bookings add constraint bookings_extras_nonneg check (
    coalesce((extras->>'laundry')::numeric, 0) >= 0 and
    coalesce((extras->>'cafeteria')::numeric, 0) >= 0 and
    coalesce((extras->>'tours')::numeric, 0) >= 0 and
    coalesce((extras->>'pickup')::numeric, 0) >= 0
  );
exception
  when duplicate_object then null;
  when others then raise notice 'تعذر إضافة قيد منع الرسوم الإضافية السالبة - فيه حجوزات قديمة فيها قيمة سالبة. راجعيها يدويًا ثم شغّلي هذا الجزء تاني بمفرده.';
end $$;

do $$ begin
  alter table bookings add constraint bookings_early_checkin_fee_nonneg check (
    coalesce((early_checkin->>'fee')::numeric, 0) >= 0
  );
exception
  when duplicate_object then null;
  when others then raise notice 'تعذر إضافة قيد منع رسوم الدخول المبكر السالبة - فيه حجوزات قديمة فيها قيمة سالبة. راجعيها يدويًا ثم شغّلي هذا الجزء تاني بمفرده.';
end $$;

-- العملة بقت نص حر (مش بس EGP/USD) - القيد بس بيتأكد إنها كود معقول الطول
alter table bookings drop constraint if exists bookings_currency_chk;
do $$ begin
  alter table bookings add constraint bookings_currency_chk check (char_length(currency) between 1 and 10);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table bookings add constraint bookings_extras_shape check (
    extras ?& array['laundry','cafeteria','tours','pickup']
  );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table bookings add constraint bookings_payment_details_shape check (
    payment_details ?& array['senderName','senderNumber','ref']
  );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table bookings add constraint bookings_early_checkin_shape check (
    early_checkin ?& array['applied','fee','note']
  );
exception when duplicate_object then null; end $$;

create unique index if not exists bookings_code_unique_idx
  on bookings (code) where code is not null;

-- شيلنا قيود rooms_price_nonneg / rooms_capacity_positive / rooms_currency_chk
-- القديمة لأن الأعمدة اللي كانت بتتحقق منها (price/capacity/currency) بقت
-- متشالة من الغرفة خالص (انظر تعليق قسم "٢) الغرف" فوق).

-- العهدة (handover) بقت ممكن تتسجل بأي عملة، مش لازم تكون فيها EGP/USD
-- بالتحديد - شيلنا الشرط القديم اللي كان بيجبرها تبقى فيها الاتنين دول بس
alter table shift_records drop constraint if exists shift_handover_shape;

-- عهدة وسائل الدفع التانية غير الكاش (فيزا/انستاباي/فودافون كاش/تحويل
-- بنكي...) - زي عهدة الكاش بالظبط بس لقراءة جهاز الدفع، بتتنقل تلقائيًا من
-- إقفال الشيفت اللي فات. وأعمدة إضافية عشان تفاصيل الشيفت (تحصيل كل طريقة
-- دفع، تحصيل الكاش بس، المصاريف حسب البند، ورصيد كل وسيلة دفع دلوقتي)
-- تتحفظ فعليًا لما الشيفت يتقفل - من غيرها التقرير كان بيفقد التفاصيل دي
-- بمجرد ما الشيفت يتقفل.
alter table shift_records add column if not exists method_handover jsonb not null default '{}'::jsonb;
alter table shift_records add column if not exists by_method_currency jsonb;
alter table shift_records add column if not exists cash_collections jsonb;
alter table shift_records add column if not exists by_category jsonb;
alter table shift_records add column if not exists method_closing jsonb;

-- --------------------------------------------------------------------------
-- 8) منع الحجز المزدوج لنفس الغرفة في تواريخ متداخلة
--    لو فشلت الخطوة دي، معناها فيه حجوزات متعارضة موجودة فعلاً في بياناتك
--    حاليًا - هيظهرلك NOTICE بدل ما يوقف باقي السكريبت
-- --------------------------------------------------------------------------
create extension if not exists btree_gist;

alter table bookings add column if not exists stay_range daterange
  generated always as (daterange(checkin, checkout, '[)')) stored;

do $$
begin
  alter table bookings add constraint bookings_no_overlap
    exclude using gist (room with =, stay_range with &&)
    where (status <> 'ملغي');
exception
  when duplicate_object then null;
  when others then
    raise notice 'تعذر إضافة قيد منع تعارض الحجوزات - على الأرجح لوجود حجوزات متداخلة في البيانات الحالية. راجعي الحجوزات المتعارضة يدويًا ثم نفذي هذا الجزء تاني بمفرده.';
end $$;

-- --------------------------------------------------------------------------
-- 9) تعديل صلاحيات الكتابة (RLS Policies) لتقييد العمليات الحساسة
-- --------------------------------------------------------------------------

-- الغرف: الكتابة (مثلاً تعديل اسم غرفة مباشرة من قاعدة البيانات) لمدير
-- الحجوزات بس، مش المدير العام. عرضها متاح للجميع. التطبيق نفسه مفيهوش أي
-- شاشة تعدّل الغرف - القيد ده دفاع إضافي لو حد حاول يكتب عن طريق الـ API.
drop policy if exists "rooms write" on rooms;
create policy "rooms write" on rooms for all using (is_reservations_manager()) with check (is_reservations_manager());

-- الحجوزات: الإضافة والتعديل لستاف ومدير الحجوزات بس (دول الدورين اللي
-- عندهم canCreateBookings/editBookings/markPaymentReceived = true فعليًا
-- في constants.js) - مش أي مستخدم نشط زي ما كان قبل كده. الحذف لمدير
-- الحجوزات بس زي ما هو.
drop policy if exists "bookings write" on bookings;
drop policy if exists "bookings insert" on bookings;
drop policy if exists "bookings update" on bookings;
drop policy if exists "bookings delete" on bookings;
create policy "bookings insert" on bookings for insert with check (is_staff_or_reservations());
create policy "bookings update" on bookings for update using (is_staff_or_reservations()) with check (is_staff_or_reservations());
create policy "bookings delete" on bookings for delete using (is_reservations_manager());

-- الشيفتات: الإنشاء (claim شيفت جديد) لستاف بس (ده اللي عنده editLedger=true
-- فعليًا). التعديل: ستاف يقدر يعدّل أي شيفت (والتريجر الموجود أصلاً بيمنعه
-- من تعديل شيفت مقفول)، والمدير العام/الحسابات ميقدروش يعدّلوا إلا شيفت
-- *مقفول بالفعل* بس (تصحيح بعد الإقفال) - مش شيفت لسه شغال، عشان مايبقوش
-- عندهم صلاحية فعلية أوسع من اللي موضحة في PERMISSIONS (editLedger=false
-- للاتنين). الحذف للمدير/الحسابات زي ما هو.
drop policy if exists "shifts write" on shift_records;
drop policy if exists "shifts insert" on shift_records;
drop policy if exists "shifts update" on shift_records;
drop policy if exists "shifts delete" on shift_records;
create policy "shifts insert" on shift_records for insert with check (is_staff());
create policy "shifts update" on shift_records for update using (is_staff() or (can_manage_financials() and closed = true)) with check (is_staff() or can_manage_financials());
create policy "shifts delete" on shift_records for delete using (can_manage_financials());

-- اختيار الشيفتات: ستاف بس (ده اللي فعليًا بيدخل شاشة "شيفتي النهارده")،
-- الحذف بس لصاحبه أو المدير العام
drop policy if exists "claims write" on shift_claims;
drop policy if exists "claims insert" on shift_claims;
drop policy if exists "claims update" on shift_claims;
drop policy if exists "claims delete" on shift_claims;
create policy "claims insert" on shift_claims for insert with check (is_staff());
create policy "claims update" on shift_claims for update using (is_gm()) with check (is_gm());
create policy "claims delete" on shift_claims for delete using (
  is_gm() or username = (select username from profiles where id = auth.uid())
);

-- حالة الغرف اليدوية (صيانة/تنظيف/غادر مبكرًا...): ستاف ومدير الحجوزات بس
-- (ده اللي عنده editRoomStatus=true فعليًا) - كانت متاحة لأي مستخدم نشط
-- بما فيهم المدير العام والحسابات اللي مفروض معندهمش الصلاحية دي أصلاً.
drop policy if exists "overrides write" on room_overrides;
create policy "overrides write" on room_overrides for all using (is_staff_or_reservations()) with check (is_staff_or_reservations());

-- --------------------------------------------------------------------------
-- 10) إعادة تفعيل البث اللحظي (لضمان بقاء الإعداد سليم بعد كل التعديلات)
-- --------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profiles','rooms','room_overrides','bookings','shift_records','shift_claims','activity_log']
  loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null; when others then null;
    end;
  end loop;
end $$;

-- --------------------------------------------------------------------------
-- 11) قيد صارم على حالة الحجز - القيم دي من كود التطبيق نفسه
--     (domain/constants.js -> BOOKING_STATUSES) مش تخمين
-- --------------------------------------------------------------------------
do $$ begin
  alter table bookings add constraint bookings_status_chk check (
    status in ('مؤكد', 'تم تسجيل الدخول', 'تم تسجيل الخروج', 'ملغي')
  );
exception when duplicate_object then null; end $$;

-- --------------------------------------------------------------------------
-- 12) صلاحيات service_role على الجداول - محتاجها الـ Edge Functions
--     (create-user و reset-password) عشان تقدر تنشئ/تعدّل بروفايلات
--     من غير ما تعتمد على RLS (هي بتعمل التحقق من الصلاحية بنفسها في الكود
--     قبل ما توصل هنا أصلاً). من غيرها بتظهر "permission denied for table"
--     حتى لو الكود والمفتاح صح 100%.
-- --------------------------------------------------------------------------
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;

-- --------------------------------------------------------------------------
-- 13) تشديدات أمان إضافية (مراجعة شاملة - النظام ده فيه فلوس وحجوزات حقيقية
--     فلازم يكون قفل محكم 100% مش بس على مستوى الواجهة، لأن أي حد يعرف
--     JavaScript يقدر يفتح Console المتصفح ويبعت طلبات مباشرة لقاعدة
--     البيانات (Supabase API) من غير ما يمر على الواجهة خالص - فالحماية
--     الحقيقية الوحيدة هي RLS على مستوى قاعدة البيانات نفسها، مش كود الواجهة.
-- --------------------------------------------------------------------------

-- (أ) ثغرة انتحال هوية: room_overrides.updated_by كان بييجي كنص حر من
--     المتصفح من غير أي تحقق - موظف ممكن (بفتح Console) يبعت تحديث حالة
--     غرفة وهو يكتب في updated_by اسم زميله بدل اسمه، فيظهر في السجل إن
--     زميله هو اللي غيّر الحالة مش هو. نفس الحل المطبّق على activity_log/
--     bookings/shift_records/shift_claims: تريجر بيجيب هوية الفاعل الحقيقية
--     من الجلسة نفسها (auth.uid())، مش من النص اللي المتصفح بعته.
create or replace function set_actor_fields()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_username text;
  v_name text;
  v_role text;
begin
  select username, name, role into v_username, v_name, v_role
  from profiles where id = auth.uid();

  if TG_TABLE_NAME = 'activity_log' then
    new.username := coalesce(v_username, new.username);
    new.user_name := coalesce(v_name, new.user_name);
    new.role := coalesce(v_role, new.role);
  elsif TG_TABLE_NAME = 'shift_records' then
    new.staff_username := coalesce(v_username, new.staff_username);
    new.staff_name := coalesce(v_name, new.staff_name);
  elsif TG_TABLE_NAME = 'bookings' then
    new.created_by := coalesce(v_username, new.created_by);
  elsif TG_TABLE_NAME = 'shift_claims' then
    new.username := coalesce(v_username, new.username);
    new.name := coalesce(v_name, new.name);
  elsif TG_TABLE_NAME = 'room_overrides' then
    new.updated_by := coalesce(v_username, new.updated_by);
  end if;

  return new;
end;
$$;

drop trigger if exists room_overrides_actor on room_overrides;
create trigger room_overrides_actor before insert or update on room_overrides
  for each row execute function set_actor_fields();

-- (ب) ثغرة في تسجيل أول مدير عام (bootstrap): الشرط القديم
--     "(select count(*) from profiles) = 0 or is_gm()" كان بيسمح بإدخال
--     أي صف (أي id، وأي role حتى لو مش 'gm') طول ما جدول profiles فاضي
--     خالص - من غير ما يتأكد إن اللي بيعمل insert ده هو نفسه صاحب الـ id
--     المُدرج. دلوقتي بنتأكد: (1) الصف اللي بيتضاف لازم يكون بمعرّف
--     المستخدم الحالي نفسه (id = auth.uid()) مش معرّف حد تاني، و(2) أول
--     حساب يتعمل (الجدول فاضي) لازم يكون دوره 'gm' بالتحديد مش أي دور تاني.
drop policy if exists "profiles insert" on profiles;
create policy "profiles insert" on profiles for insert
  with check (
    id = auth.uid()
    and (
      (role = 'gm' and (select count(*) from profiles) = 0)
      or is_gm()
    )
  );

-- (ج) ثغرة: كل شاشات العرض (select) على rooms/room_overrides/bookings/
--     shift_records/shift_claims/profiles كانت بس بتتأكد إن فيه جلسة دخول
--     صالحة (auth.uid() is not null) من غير ما تتأكد إن الحساب ده لسه
--     "مفعّل" (active = true). يعني موظف اتعطّل حسابه من المدير العام
--     يقدر يستمر يقرا كل بيانات الحجوزات/الفلوس/الأنشطة لحد ما الجلسة
--     (JWT) بتاعته تنتهي أو يسجّل خروج - ده وقت طويل أوي لحساب المفروض
--     مقطوع منه الوصول فورًا. دلوقتي العرض كله بقى مربوط بـ is_active_user()
--     بدل ما يكفي إنه بس "مسجل دخول".
drop policy if exists "profiles select" on profiles;
create policy "profiles select" on profiles for select using (is_active_user());

drop policy if exists "rooms select" on rooms;
create policy "rooms select" on rooms for select using (is_active_user());

drop policy if exists "overrides select" on room_overrides;
create policy "overrides select" on room_overrides for select using (is_active_user());

drop policy if exists "bookings select" on bookings;
create policy "bookings select" on bookings for select using (is_active_user());

drop policy if exists "shifts select" on shift_records;
create policy "shifts select" on shift_records for select using (is_active_user());

drop policy if exists "claims select" on shift_claims;
create policy "claims select" on shift_claims for select using (is_active_user());

-- (د) سجل الحركة (activity_log) كان أي مستخدم نشط يقدر يقراه كامل، حتى لو
--     دوره (staff) مفروض معندهوش صلاحية "viewActivity" في الواجهة أصلاً
--     (constants.js -> PERMISSIONS.staff.viewActivity = false). الواجهة
--     كانت بتخبي التاب بس، والسجل الكامل (بتاع كل الموظفين) يفضل متاح عن
--     طريق الـ API مباشرة. دلوقتي: مدير الحجوزات/الحسابات/المدير العام
--     بيشوفوا السجل كامل زي ما هي صلاحيتهم. أما ستاف (أو أي دور تاني) فبيشوف
--     بس صفوفه هو (username بتاعه) - ده ضروري لميزة "تقرير جلسة العمل" قبل
--     تسجيل الخروج اللي بتعرض أفعال اليوزر نفسه بس وموجودة لكل الأدوار.
create or replace function can_view_activity_log()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role in ('reservations','accounts','gm') and active = true
  );
$$;
grant execute on function can_view_activity_log() to authenticated;

drop policy if exists "activity select" on activity_log;
create policy "activity select" on activity_log for select using (
  can_view_activity_log()
  or (is_active_user() and username = (select username from profiles where id = auth.uid()))
);

-- --------------------------------------------------------------------------
-- 13b) دوال مساعدة مشتركة لقيود الأقسام التالية:
--      booking_grand_total: الإجمالي الكلي للحجز (غرفة + رسوم إضافية + رسم
--        الدخول المبكر لو منطبق) - نفس معادلة bookingGrandTotal في الواجهة.
--      hotel_today: تاريخ "النهارده" بتوقيت الفندق (مش UTC) - بيتستخدم في
--        قيد التسكين المكرر عشان "الحجز بدأ فعلاً" تتقارن بنفس تاريخ الموظف.
--        لو الفندق في منطقة زمنية تانية غير القاهرة، غيّري الاسم هنا.
-- --------------------------------------------------------------------------
create or replace function booking_grand_total(b bookings)
returns numeric language sql immutable as $$
  select coalesce(b.total_room, 0)
    + coalesce((b.extras->>'laundry')::numeric, 0)
    + coalesce((b.extras->>'cafeteria')::numeric, 0)
    + coalesce((b.extras->>'tours')::numeric, 0)
    + coalesce((b.extras->>'pickup')::numeric, 0)
    + case when coalesce((b.early_checkin->>'applied')::boolean, false) then coalesce((b.early_checkin->>'fee')::numeric, 0) else 0 end;
$$;

create or replace function hotel_today()
returns date language sql stable as $$
  select (now() at time zone 'Africa/Cairo')::date;
$$;

-- إجمالي الغرفة المسموح بعد تغيير تاريخ الخروج (نفس حساب repricedTotalRoom
-- في src/domain/bookingLogic.js بالظبط):
--   * تمديد: الإجمالي الحالي + سعر الليلة × الليالي الزيادة.
--   * تقصير: الإجمالي الحالي × (الليالي الجديدة ÷ القديمة) - يعني متوسط سعر
--     الليلة الفعلي (يراعي أي خصم متفق عليه)، وصفر ليالي = صفر.
create or replace function reprice_total(b bookings, new_checkout date)
returns numeric language plpgsql immutable as $$
declare
  old_n int := b.checkout - b.checkin;
  new_n int := new_checkout - b.checkin;
begin
  if new_n <= 0 then return 0; end if;
  if new_n >= old_n then return coalesce(b.total_room, 0) + coalesce(b.price_night, 0) * (new_n - old_n); end if;
  if old_n <= 0 then return coalesce(b.total_room, 0); end if;
  return round(coalesce(b.total_room, 0) * new_n * 100 / old_n) / 100;
end;
$$;

-- --------------------------------------------------------------------------
-- 14) قرار عمل جديد: مدير الحجوزات يضيف حجوزات ويحدد سعرها عادي، لكن
--     "استلمنا الفلوس فعليًا ولا لأ" (amount_paid / amount_tendered /
--     settled) مش شغله خالص - ده قرار موظف الشيفت اللي قدام النزيل فعليًا
--     وقت التحصيل. الواجهة بقت تقفل الحقول دي له (BookingsPanel.jsx)، وده
--     نفس القرار لكن على مستوى قاعدة البيانات - دفاع حقيقي لو حد حاول
--     يتخطى الواجهة ويبعت تحديث مباشر. مدير الحجوزات لسه يقدر يغيّر أي حاجة
--     تانية في الحجز (سعر، تواريخ، غرفة، حالة...) عادي، القيد ده بس على
--     الثلاث خانات دول.
-- --------------------------------------------------------------------------
create or replace function prevent_reservations_collection_edit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  old_paid numeric; old_tendered numeric; old_settled boolean;
begin
  -- دالة قرار رد الفلوس (decide_booking_refund - قسم ٢٥) هي المسار الوحيد
  -- المسموح له يغيّر المدفوع بالسالب بإسم مدير الحجوزات - بتفعّل علامة
  -- جلسة محلية للمعاملة دي بس (مش بتتبعت من الواجهة).
  if coalesce(current_setting('calma.refund_rpc', true), '') = '1' then
    return new;
  end if;
  if is_reservations_manager() then
    if TG_OP = 'INSERT' then
      old_paid := 0; old_tendered := 0; old_settled := false;
    else
      old_paid := old.amount_paid; old_tendered := old.amount_tendered; old_settled := old.settled;
    end if;
    if (new.amount_paid is distinct from old_paid)
       or (new.amount_tendered is distinct from old_tendered) then
      raise exception 'تسجيل التحصيل (المدفوع/المتحصّل) من صلاحية موظف الشيفت بس، مش مدير الحجوزات';
    end if;
    if new.settled is distinct from old_settled then
      -- الاستثناء الوحيد: مدير الحجوزات زوّد قيمة حجز كان "متحصّل بالكامل"
      -- (تمديد/ليالي إضافية) فالمدفوع بقى أقل من الإجمالي الجديد - علامة
      -- التحصيل بتتشال تلقائيًا (true -> false) عشان الغرفة تظهر "متبقي
      -- عليها فلوس" ومايحتاجش موظف الشيفت يلغي التحصيل بإيده الأول. غير كده
      -- ممنوع (مدير الحجوزات ما يعلّمش حجز "متحصّل").
      if not (TG_OP = 'UPDATE' and old_settled = true and new.settled = false
              and booking_grand_total(new) > coalesce(new.amount_paid, 0)) then
        raise exception 'تسجيل التحصيل (المدفوع/المتحصّل) من صلاحية موظف الشيفت بس، مش مدير الحجوزات';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_reservations_collection_guard on bookings;
create trigger bookings_reservations_collection_guard before insert or update on bookings
  for each row execute function prevent_reservations_collection_edit();

-- --------------------------------------------------------------------------
-- 15) تحصين إضافي: موظف الشيفت (staff) ليه صلاحية يضيف حجوزات جديدة كاملة
--     (canCreateBookings=true)، لكن لما يعدّل في حجز موجود بالفعل، شغله
--     المفروض يكون محدود بالحاجات اللي بتحصل وقت الشيفت فعليًا: التحصيل
--     (amount_paid/settled)، وسيلة الدفع، الرسوم الإضافية (extras)، وحالة/
--     تاريخ الخروج والملاحظات (ده مطلوب فعليًا لحالة "تسكين مكرر" لما
--     موظف الشيفت يحل تعارض حجزين على نفس الغرفة بتعديل حجز قديم تانِي -
--     بيغيّر checkout أو status/notes بتاعه). أي تعديل على باقي بيانات
--     الحجز (الغرفة، اسم/رقم النزيل، عدد الأفراد، تاريخ الدخول، السعر،
--     العملة، إجمالي الغرفة، الدخول المبكر، تفاصيل الدفع الأونلاين، المتحصّل
--     نقدًا tendered، مصدر الحجز، حالة الاعتماد، كود الحجز، استيراد/مراجعة
--     الغرفة) ممنوع من موظف الشيفت على مستوى القاعدة - دفاع حقيقي لو حد
--     حاول يتخطى الواجهة ويبعت تحديث مباشر بالـ API. ده سارٍ على UPDATE بس،
--     مش INSERT، عشان ميأثرش على صلاحية موظف الشيفت في إضافة حجز جديد كامل.
-- --------------------------------------------------------------------------
create or replace function prevent_staff_core_booking_edit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  restoring boolean;
begin
  if is_staff() and TG_OP = 'UPDATE' then
    -- الخروج المبكر / التسكين المكرر مسموح بس لنزيل بدأ إقامته فعلاً (دخوله
    -- النهارده أو قبله) - مفيش تقصير ولا تعليم لحجز مستقبلي، وده كان هيبقى
    -- إلغاء مقنّع (الإلغاء من مدير الحجوزات بس).
    if (new.left_early is distinct from old.left_early
        or new.duplicate_placement is distinct from old.duplicate_placement
        or new.checkout < old.checkout)
       and old.checkin > hotel_today() then
      raise exception 'الخروج المبكر مسموح بس لنزيل بدأ إقامته فعلاً - الحجز المستقبلي إلغاؤه من مدير الحجوزات';
    end if;
    -- التراجع عن خروج مبكر (لو حفظ الحجز الجديد فشل): بس بنفس تاريخ الخروج
    -- والإجمالي اللي كانوا قبل الخروج المبكر بالظبط (متسجلين في pre_early_*).
    restoring := coalesce(old.left_early, false) and not coalesce(new.left_early, false)
                 and old.pre_early_checkout is not null
                 and new.checkout = old.pre_early_checkout and new.total_room = old.pre_early_total;
    if (new.room is distinct from old.room)
       or (new.guest_name is distinct from old.guest_name)
       or (new.phone is distinct from old.phone)
       or (new.pax is distinct from old.pax)
       or (new.checkin is distinct from old.checkin)
       or (new.price_night is distinct from old.price_night)
       or (new.currency is distinct from old.currency)
       -- total_room مسموح يتغيّر بس لو ده تمديد/تقصير حقيقي لتاريخ الخروج
       -- وبنفس سعر الليلة المتسجل (الفرق في الليالي × price_night) - يعني
       -- موظف الشيفت يقدر يمدد الإقامة والسعر يتحرك تلقائيًا، لكن مايقدرش
       -- يغيّر إجمالي الغرفة بأي قيمة تانية.
       or (not restoring and new.total_room is distinct from old.total_room
           and not (new.checkout is distinct from old.checkout
                    and abs(new.total_room - reprice_total(old, new.checkout)) <= 0.011))
       -- ومفيش تمديد مجاني: لو تاريخ الخروج اتأخر، إجمالي الغرفة لازم يزيد
       -- بنفس الفرق (التقصير لوحده - "مشي بدري" - مسموح من غير تغيير إجمالي).
       or (not restoring and new.checkout > old.checkout
           and abs(new.total_room - reprice_total(old, new.checkout)) > 0.011)
       or (new.early_checkin is distinct from old.early_checkin)
       or (new.payment_details is distinct from old.payment_details)
       or (new.amount_tendered is distinct from old.amount_tendered)
       or (new.source is distinct from old.source)
       or (new.approval_status is distinct from old.approval_status)
       or (new.code is distinct from old.code)
       or (new.imported is distinct from old.imported)
       or (new.needs_room_review is distinct from old.needs_room_review) then
      raise exception 'تعديل بيانات الحجز الأساسية مش من صلاحية موظف الشيفت - التحصيل/الرسوم/الحالة بس';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_staff_core_edit_guard on bookings;
create trigger bookings_staff_core_edit_guard before update on bookings
  for each row execute function prevent_staff_core_booking_edit();

-- --------------------------------------------------------------------------
-- 16) مدير الحجوزات والمدير العام يقدروا "يفتحوا تاني" شيفت قفله موظف
--     بالغلط (أو احتاج تصحيح بعد الإقفال) - غير إعادة الفتح دي، أي تعديل
--     تاني على محتوى شيفت لسه مقفول يفضل للمدير العام/الحسابات بس زي ما كان.
-- --------------------------------------------------------------------------
create or replace function is_gm_or_reservations()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role in ('gm','reservations') and active = true
  );
$$;
grant execute on function is_gm_or_reservations() to authenticated;

create or replace function prevent_closed_shift_edit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.closed = true then
    if new.closed = false then
      -- إعادة فتح شيفت مقفول: مدير الحجوزات أو المدير العام أو الحسابات بس
      if not (is_gm_or_reservations() or can_manage_financials()) then
        raise exception 'إعادة فتح شيفت مقفول من صلاحية المدير العام أو مدير الحجوزات بس';
      end if;
    else
      -- الشيفت فاضل مقفول وبيتم تعديل محتواه (مش عملية إعادة فتح) - المدير العام/الحسابات بس زي ما كان
      if not can_manage_financials() then
        raise exception 'لا يمكن تعديل شيفت مقفول إلا من المدير العام أو الحسابات';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop policy if exists "shifts update" on shift_records;
create policy "shifts update" on shift_records for update using (
  is_staff() or can_manage_financials() or (closed = true and is_gm_or_reservations())
) with check (
  is_staff() or can_manage_financials() or is_gm_or_reservations()
);

-- --------------------------------------------------------------------------
-- 17) لو الحجز اتسجل "متحصّل بالكامل" (settled)، ميتغيّرش أي حاجة تخص قيمة
--     الحجز (سعر الليلة/الإجمالي/الرسوم الإضافية/رسوم الدخول المبكر) إلا لو
--     حد لغى علامة التحصيل الأول - عشان المبلغ المتحصّل يفضل متطابق مع اللي
--     استُحق فعليًا وقت التحصيل، ومتظهرش فروق أو "لغبطة" بعد كده في التقرير.
--     الواجهة بقت تقفل الحقول دي (BookingsPanel.jsx / RoomBoard.jsx)، وده
--     نفس القرار على مستوى قاعدة البيانات لو حد حاول يتخطى الواجهة.
-- --------------------------------------------------------------------------
create or replace function prevent_charge_edit_when_settled()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.settled = true and new.settled = true then
    -- تغيير إجمالي الغرفة مع تغيير تاريخ الخروج (تمديد/تقصير/مشي بدري) مسموح:
    -- ده بيعيد تسعير الإقامة نفسها (قيد قسم ١٥ بيحدد الفرق بدقة للموظف، وقيد
    -- قسم ٢٤ بيمنع علامة "متحصّل" لو المدفوع أقل من الإجمالي الجديد).
    if ((new.total_room is distinct from old.total_room and new.checkout is not distinct from old.checkout))
       or (new.price_night is distinct from old.price_night)
       or (new.extras is distinct from old.extras)
       or (new.early_checkin is distinct from old.early_checkin)
       or (new.payment_method is distinct from old.payment_method)
       or (new.payment_details is distinct from old.payment_details) then
      raise exception 'الحجز متحصّل بالكامل - لازم تلغي علامة التحصيل الأول عشان تقدر تعدّل السعر/الرسوم/طريقة الدفع';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_settled_charge_guard on bookings;
create trigger bookings_settled_charge_guard before update on bookings
  for each row execute function prevent_charge_edit_when_settled();

-- --------------------------------------------------------------------------
-- 18) أعمدة إضافية على الحجز:
--     - created_by_role: دور مين أضاف الحجز وقت الإضافة (يُستخدم في رسالة
--       تحذير واضحة لو موظف الشيفت حاول يمدد حجز والغرفة متعارضة مع حجز
--       أضافه مدير الحجوزات في نفس الفترة).
--     - left_early / duplicate_placement: لتوضيح حالة "تسكين مكرر" بدون
--       اللجوء لـ status='ملغي' غلط - استخدام 'ملغي' هنا كان عيب حقيقي لأنه
--       كان يشيل من التقرير إيراد الليالي اللي النزيل القديم قعدها فعليًا.
--       دلوقتي الحجز القديم يتقصّر (تاريخ خروج = تاريخ دخول الحجز الجديد)
--       ويُعلّم left_early، والحجز الجديد يُعلّم duplicate_placement - و
--       status='ملغي' يفضل فعل حقيقي من مدير الحجوزات بس (زرار الإلغاء
--       اليدوي في شاشة الحجوزات)، مش نتيجة جانبية لعملية تسكين مكرر تلقائية.
-- --------------------------------------------------------------------------
alter table bookings add column if not exists created_by_role text;
alter table bookings add column if not exists left_early boolean not null default false;
alter table bookings add column if not exists duplicate_placement boolean not null default false;

create or replace function set_actor_fields()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_username text;
  v_name text;
  v_role text;
begin
  select username, name, role into v_username, v_name, v_role
  from profiles where id = auth.uid();

  if TG_TABLE_NAME = 'activity_log' then
    new.username := coalesce(v_username, new.username);
    new.user_name := coalesce(v_name, new.user_name);
    new.role := coalesce(v_role, new.role);
    new.ts := now(); -- الوقت من السيرفر مش من العميل
  elsif TG_TABLE_NAME = 'shift_records' then
    new.staff_username := coalesce(v_username, new.staff_username);
    new.staff_name := coalesce(v_name, new.staff_name);
  elsif TG_TABLE_NAME = 'bookings' then
    new.created_by := coalesce(v_username, new.created_by);
    new.created_by_role := coalesce(v_role, new.created_by_role);
  elsif TG_TABLE_NAME = 'shift_claims' then
    new.username := coalesce(v_username, new.username);
    new.name := coalesce(v_name, new.name);
  elsif TG_TABLE_NAME = 'room_overrides' then
    new.updated_by := coalesce(v_username, new.updated_by);
  end if;

  return new;
end;
$$;

-- --------------------------------------------------------------------------
-- 19) تثبيت العملات المستخدمة فعليًا على خمس عملات بس (جنيه، دولار، يورو،
--     ريال سعودي، جنيه إسترليني) بدل النص الحر - الواجهة بقت قائمة اختيار
--     ثابتة بنفس الخمسة في كل مكان فيه عملة، وده نفس القرار على مستوى
--     قاعدة البيانات. لو فيه حجوزات قديمة بعملة غير دول، القيد مش هيتضاف
--     (NOTICE) وتحتاجي تصلّحيها يدويًا الأول (UPDATE على العمود currency).
-- --------------------------------------------------------------------------
alter table bookings drop constraint if exists bookings_currency_chk;
do $$ begin
  alter table bookings add constraint bookings_currency_chk check (currency in ('EGP','USD','EUR','SAR','GBP'));
exception
  when duplicate_object then null;
  when others then raise notice 'تعذر تثبيت قيد العملات - فيه حجوزات قديمة بعملة مش من الخمسة المعتمدة (EGP/USD/EUR/SAR/GBP). راجعيها يدويًا ثم نفذي هذا الجزء تاني بمفرده.';
end $$;

-- --------------------------------------------------------------------------
-- 20) تثبيت جهات الحجز على الخمسة المعتمدة (مباشر/سوشيال ميديا/Booking.com/
--     Expedia/Trip.com) بدل النص الحر، بنفس أسلوب تثبيت العملات فوق بالظبط -
--     لو فيه حجوزات قديمة بجهة غير دول (مثلاً "Airbnb" أو "وسيط" من قبل
--     التثبيت) القيد مش هيتضاف (NOTICE) وتحتاجي تصلّحيها يدويًا الأول.
-- --------------------------------------------------------------------------
alter table bookings drop constraint if exists bookings_source_chk;
do $$ begin
  alter table bookings add constraint bookings_source_chk check (source in ('مباشر','سوشيال ميديا','Booking.com','Expedia','Trip.com'));
exception
  when duplicate_object then null;
  when others then raise notice 'تعذر تثبيت قيد جهة الحجز - فيه حجوزات قديمة بجهة مش من الخمسة المعتمدة. راجعيها يدويًا ثم نفذي هذا الجزء تاني بمفرده.';
end $$;

-- --------------------------------------------------------------------------
-- 21) رد فلوس حجز ملغي: لو مدير الحجوزات لغى حجز كان عليه مبلغ متحصّل فعليًا،
--     لازم يترد للنزيل - refund_pending بتتحدد تلقائيًا true لحظة ما الحالة
--     تتحول لـ"ملغي" (لو اتلغى الإلغاء/رجعت الحالة تاني، بترجع false من
--     تلقائيًا كمان). موظف الشيفت (من الواجهة - BookingsPanel.jsx) هو اللي
--     يسجّل إن الفلوس ارتدت فعليًا، وده بيصفّر refund_pending ويسجّل
--     refunded_amount/refunded_by/refunded_at.
-- --------------------------------------------------------------------------
alter table bookings add column if not exists refund_pending boolean not null default false;
alter table bookings add column if not exists refunded_amount numeric;
alter table bookings add column if not exists refunded_by text;
alter table bookings add column if not exists refunded_at timestamptz;

alter table bookings add column if not exists refund_decision text;
do $$ begin
  alter table bookings add constraint bookings_refund_decision_chk check (refund_decision is null or refund_decision in ('refunded','kept'));
exception when duplicate_object then null; end $$;

-- طلب رد الفلوس (refund_pending) بيتفتح تلقائيًا بس في حالتين:
--   (أ) الحجز اتلغى وعليه مبلغ متحصّل.
--   (ب) إقامة اتقصّرت (مشي بدري/تسكين مكرر) والمدفوع بقى أكبر من الإجمالي الجديد
--       (المبلغ المطلوب رده = الزيادة بس).
-- وقرار الطلب (رد فعلي أو رفض وإبقاء الفلوس) من مدير الحجوزات بس، عن طريق
-- الدالة decide_booking_refund (قسم ٢٥). أي تعديل مباشر من الواجهة على
-- حقول الرد (refund_*) بيتتجاهل هنا.
create or replace function set_refund_pending_on_cancel()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  bypass boolean := coalesce(current_setting('calma.refund_rpc', true), '') = '1';
begin
  if bypass then return new; end if;
  if TG_OP = 'INSERT' then
    new.refund_pending := false; new.refund_decision := null;
    new.refunded_amount := null; new.refunded_by := null; new.refunded_at := null;
    return new;
  end if;
  -- مفيش حد يقدر يسحب المدفوع من حجز فيه طلب رد معلّق بره قرار مدير الحجوزات
  if old.refund_pending and coalesce(new.amount_paid,0) < coalesce(old.amount_paid,0) then
    raise exception 'الفلوس دي مطلوب ردها - قرار الرد أو الإبقاء من مدير الحجوزات بس';
  end if;
  new.refund_pending := old.refund_pending; new.refund_decision := old.refund_decision;
  new.refunded_amount := old.refunded_amount; new.refunded_by := old.refunded_by; new.refunded_at := old.refunded_at;

  if new.status = 'ملغي' and old.status is distinct from 'ملغي' then
    if coalesce(new.amount_paid, 0) > 0 then
      new.refund_pending := true; new.refund_decision := null;
    end if;
  elsif new.status = 'ملغي' and old.status = 'ملغي' and coalesce(new.amount_paid, 0) > coalesce(old.amount_paid, 0) then
    -- فلوس اتضافت على حجز ملغي بالفعل: لازم تبقى طلب رد برضه
    new.refund_pending := true; new.refund_decision := null;
  elsif new.status is distinct from 'ملغي' and old.status = 'ملغي' then
    new.refund_pending := false;
  elsif new.status is distinct from 'ملغي'
        and (new.checkout < old.checkout or booking_grand_total(new) < booking_grand_total(old))
        and coalesce(new.amount_paid, 0) > booking_grand_total(new) then
    new.refund_pending := true; new.refund_decision := null;
  end if;
  if new.refund_pending and new.status is distinct from 'ملغي' and coalesce(new.amount_paid, 0) <= booking_grand_total(new) then
    new.refund_pending := false;
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_refund_pending_guard on bookings;
create trigger bookings_refund_pending_guard before insert or update on bookings
  for each row execute function set_refund_pending_on_cancel();

-- --------------------------------------------------------------------------
-- 22) تحصيل الحجوزات التلقائي (من بلوك الغرف/شاشة الحجوزات) بيتسجل جوه
--     يومية الشيفت في العمود ده - عنصر لكل تحصيل أو رد فلوس، بدل ما الموظف
--     يحتاج يكتب نفس المبلغ تاني يدويًا في جدول اليومية (انظر
--     appendBookingCollection في src/data/shifts.js وcomputeShiftTotals في
--     src/domain/money.js).
-- --------------------------------------------------------------------------
alter table shift_records add column if not exists booking_collections jsonb not null default '[]'::jsonb;

-- --------------------------------------------------------------------------
-- 23) الإلغاء (status = 'ملغي') يفضل حصريًا فعل يدوي من مدير الحجوزات -
--     موظف الشيفت أصلًا مش بيشوف اختيار الحالة في الواجهة وقت إضافة حجز
--     جديد (walk-in)، لكن ده تحصين حقيقي على مستوى القاعدة لو حد حاول
--     يتخطى الواجهة ويبعت تحديث/إضافة مباشر بالـ API بحالة "ملغي". سارٍ على
--     INSERT وUPDATE الاتنين (عكس تحصين قسم ١٥ اللي بس على UPDATE)، عشان
--     يقفل كمان احتمال حجز جديد يتضاف من موظف الشيفت بحالة "ملغي" من الأساس.
-- --------------------------------------------------------------------------
create or replace function prevent_staff_cancel_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if is_staff() and new.status = 'ملغي' and (TG_OP = 'INSERT' or old.status is distinct from 'ملغي') then
    -- (تسكين مكرر مابقاش بيلغي حجز: النزيل القديم بيتسجّل "غادر مبكرًا" بدل ما يتلغي)
    raise exception 'إلغاء الحجز (ملغي) من صلاحية مدير الحجوزات بس';
  end if;
  -- ومش بيرجّع حجز ملغي (ده كان هيمسح علامة "مطلوب رد فلوس" اللي حطها
  -- مدير الحجوزات).
  if is_staff() and TG_OP = 'UPDATE' and old.status = 'ملغي' and new.status is distinct from 'ملغي' then
    raise exception 'استرجاع حجز ملغي من صلاحية مدير الحجوزات بس';
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_staff_cancel_guard on bookings;
create trigger bookings_staff_cancel_guard before insert or update on bookings
  for each row execute function prevent_staff_cancel_status();

-- --------------------------------------------------------------------------
-- 24) "متحصّل بالكامل" (settled) ما ينفعش يتسجل إلا لو المدفوع فعليًا وصل
--     للإجمالي الكلي (سعر الغرفة + كل الرسوم الإضافية + رسم الدخول المبكر لو
--     منطبق) - من غيره كان ممكن يحصل تضارب: حجز معلّم "متحصّل بالكامل" وعليه
--     متبقي فعلي في نفس الوقت (حصل فعليًا في الواجهة قبل الإصلاح ده). الحجز
--     المدفوع أونلاين مستثنى (مش بيستخدم amount_paid أصلًا - انظر قسم ١٧).
-- --------------------------------------------------------------------------
create or replace function prevent_invalid_settled()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  grand numeric;
begin
  if new.settled = true and not coalesce((new.payment_details->>'onlinePaid')::boolean, false) then
    grand := booking_grand_total(new);
    -- القيد بيتفحص بس لما حاجة تخص الفلوس بتتغيّر فعلاً (حجز جديد، أو علامة
    -- التحصيل لسه بتتحط، أو المدفوع/الإجمالي اتغيّر). حجز قديم اتسجّل
    -- "متحصّل" بالغلط قبل القيد ده (بيانات تجريبية مثلاً) مش بيتعطّل فيه
    -- تقصير/تراجع/ملاحظات - بيفضل قابل للتعامل معاه عادي.
    if (TG_OP = 'INSERT'
        or old.settled is distinct from true
        or new.amount_paid is distinct from old.amount_paid
        or grand is distinct from booking_grand_total(old))
       and coalesce(new.amount_paid, 0) < grand then
      raise exception 'مينفعش تعلّمي الحجز "متحصّل بالكامل" والمدفوع (%) لسه أقل من الإجمالي الكلي (%)', new.amount_paid, grand;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_settled_validity_guard on bookings;
create trigger bookings_settled_validity_guard before insert or update on bookings
  for each row execute function prevent_invalid_settled();

-- --------------------------------------------------------------------------
-- 25) مغادرة مبكرة في نفس يوم الدخول + قرار رد الفلوس
--   (أ) نزيل دخل وخرج في نفس اليوم (تسكين مكرر): بيتسجّل "تم تسجيل الخروج"
--       + left_early وتاريخ خروجه = تاريخ دخوله (صفر ليالي). النطاق الفاضي
--       مابيتعارضش مع أي حجز تاني (قيد منع الحجز المزدوج بيتجاهله).
--   (ب) رد الفلوس قراره لمدير الحجوزات بس: يا يردّها فعلاً (decide_booking_refund
--       'refund': بتتشال من المدفوع وبتتسجّل بالسالب في صف الغرفة في يومية الشيفت
--       المفتوح) يا يرفض الرد ويسيب الفلوس ('keep').
-- --------------------------------------------------------------------------
alter table bookings drop constraint if exists bookings_dates_valid;
alter table bookings add constraint bookings_dates_valid check (checkout > checkin or (checkout = checkin and left_early = true));

drop function if exists decide_booking_refund(uuid, text, timestamptz);
create or replace function decide_booking_refund(p_booking uuid, p_decision text, p_expected timestamptz default null, p_method text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b bookings%rowtype;
  sr shift_records%rowtype;
  v_rows jsonb; el jsonb; i int; idx int := null; empty_idx int := null;
  amount numeric; grand numeric; label text; uname text; cur_amt numeric; cur_desc text; meth text;
begin
  if not is_reservations_manager() then
    raise exception 'قرار رد الفلوس من صلاحية مدير الحجوزات بس';
  end if;
  if p_decision not in ('refund','keep') then raise exception 'قرار غير معروف'; end if;
  select * into b from bookings where id = p_booking for update;
  if not found then raise exception 'الحجز مش موجود'; end if;
  if not b.refund_pending then raise exception 'مفيش طلب رد فلوس معلّق على الحجز ده (اتقرر قبل كده)'; end if;
  if p_expected is not null and b.updated_at is distinct from p_expected then
    raise exception 'الحجز اتغيّر من حد تاني - حدّث الصفحة وراجع الطلب';
  end if;
  select username into uname from profiles where id = auth.uid();
  grand := booking_grand_total(b);
  amount := case when b.status = 'ملغي' then coalesce(b.amount_paid, 0) else greatest(coalesce(b.amount_paid, 0) - grand, 0) end;
  meth := coalesce(nullif(trim(coalesce(p_method, '')), ''), b.payment_method);
  if char_length(meth) > 40 then raise exception 'وسيلة الدفع غير صالحة'; end if;
  perform set_config('calma.refund_rpc', '1', true);

  if p_decision = 'keep' or amount <= 0 then
    update bookings set refund_pending = false,
      refund_decision = case when amount <= 0 then refund_decision else 'kept' end,
      refunded_by = case when amount <= 0 then refunded_by else uname end,
      refunded_at = case when amount <= 0 then refunded_at else now() end
      where id = p_booking;
    perform set_config('calma.refund_rpc', '', true);
    return jsonb_build_object('decision', case when amount <= 0 then 'none' else 'kept' end, 'amount', 0);
  end if;

  select * into sr from shift_records
    where closed = false and date >= hotel_today() - 1
    order by date desc, (case shift_key when 'night' then 3 when 'evening' then 2 else 1 end) desc
    limit 1 for update;
  if not found then
    raise exception 'مفيش شيفت مفتوح دلوقتي في اليومية - الرد بيتسجّل في يومية شيفت مفتوح، استنى لما موظف يفتح شيفته وجرّب تاني';
  end if;

  v_rows := coalesce(sr.rows, '[]'::jsonb);
  label := 'رد فلوس - ' || b.guest_name || ' (-' || amount || ' ' || b.currency || ')';
  for i in 0 .. jsonb_array_length(v_rows) - 1 loop
    el := v_rows -> i;
    if (el ->> 'room') = b.room::text then
      cur_amt := case when trim(coalesce(el ->> 'collectionAmt', '')) ~ '^-?[0-9]+(\.[0-9]+)?$' then trim(el ->> 'collectionAmt')::numeric else 0 end;
      if (cur_amt <> 0 or coalesce(el ->> 'collectionDesc', '') <> '')
         and el ->> 'collectionMethod' = meth and el ->> 'collectionCurrency' = b.currency then
        idx := i; exit;
      end if;
      if empty_idx is null and cur_amt = 0 and coalesce(el ->> 'collectionDesc', '') = '' then empty_idx := i; end if;
    end if;
  end loop;
  if idx is null then idx := empty_idx; end if;
  if idx is null then
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'room', b.room, 'expenseDesc', '', 'expenseAmt', '', 'expenseCategory', 'أخرى', 'expenseCurrency', 'EGP',
      'collectionDesc', label, 'collectionAmt', -amount, 'collectionMethod', meth, 'collectionCurrency', b.currency,
      'paymentDetails', jsonb_build_object('senderName', '', 'senderNumber', '', 'ref', '', 'onlinePaid', false, 'commissionPct', 15),
      'notes', ''));
  else
    el := v_rows -> idx;
    cur_amt := case when trim(coalesce(el ->> 'collectionAmt', '')) ~ '^-?[0-9]+(\.[0-9]+)?$' then trim(el ->> 'collectionAmt')::numeric else 0 end;
    cur_desc := coalesce(el ->> 'collectionDesc', '');
    v_rows := jsonb_set(v_rows, array[idx::text], el || jsonb_build_object(
      'collectionAmt', cur_amt - amount, 'collectionMethod', meth, 'collectionCurrency', b.currency,
      'collectionDesc', case when cur_desc <> '' then cur_desc || ' / ' || label else label end));
  end if;
  update shift_records set rows = v_rows,
    booking_collections = coalesce(booking_collections, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text, 'bookingId', b.id))
    where date = sr.date and shift_key = sr.shift_key;

  update bookings set
    amount_paid = coalesce(amount_paid, 0) - amount,
    settled = case when status = 'ملغي' then false else settled end,
    refund_pending = false, refund_decision = 'refunded',
    refunded_amount = coalesce(refunded_amount, 0) + amount, refunded_by = uname, refunded_at = now()
    where id = p_booking;
  perform set_config('calma.refund_rpc', '', true);
  return jsonb_build_object('decision', 'refunded', 'amount', amount, 'currency', b.currency, 'method', meth, 'shiftDate', sr.date, 'shiftKey', sr.shift_key);
end;
$$;
revoke all on function decide_booking_refund(uuid, text, timestamptz, text) from public;
revoke all on function decide_booking_refund(uuid, text, timestamptz, text) from anon;
grant execute on function decide_booking_refund(uuid, text, timestamptz, text) to authenticated;

-- --------------------------------------------------------------------------
-- 26) تحصينات إضافية
--   (أ) ذاكرة الخروج المبكر: لما حجز بيتقصّر ويتعلّم left_early، بنحفظ تاريخ
--       الخروج والإجمالي قبله (pre_early_*) - ده بس اللي بيسمح للموظف
--       يتراجع لنفس القيم لو حفظ التسكين المكرر فشل (قسم ١٥).
--   (ب) الحقول دي والـ id والـ username ثابتين - مفيش تعديل يدوي عليهم.
--   (ج) اختيار الشيفت: مرة واحدة لنفس الموظف في نفس اليوم، والحذف للمدير العام
--       بس. تعديل يومية شيفت مفتوح من صاحبه بس (غير تصحيح المدير بعد الإقفال).
-- --------------------------------------------------------------------------
alter table bookings add column if not exists pre_early_checkout date;
alter table bookings add column if not exists pre_early_total numeric;

create or replace function remember_pre_early_leave()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.pre_early_checkout := old.pre_early_checkout;
  new.pre_early_total := old.pre_early_total;
  if coalesce(new.left_early, false) and not coalesce(old.left_early, false) and new.checkout < old.checkout then
    new.pre_early_checkout := old.checkout;
    new.pre_early_total := old.total_room;
  elsif coalesce(old.left_early, false) and not coalesce(new.left_early, false) then
    new.pre_early_checkout := null;
    new.pre_early_total := null;
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_early_memory on bookings;
create trigger bookings_early_memory before update on bookings
  for each row execute function remember_pre_early_leave();

create or replace function protect_profile_identity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.id is distinct from old.id or new.username is distinct from old.username then
    raise exception 'اسم المستخدم والمعرّف مينفعش يتغيّروا';
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_protect_identity on profiles;
create trigger profiles_protect_identity before update on profiles
  for each row execute function protect_profile_identity();

create or replace function prevent_last_gm_deactivation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'gm' and old.active = true and (new.active = false or new.role <> 'gm') then
    -- قفل صفوف المديرين العموم الفعّالين عشان تعطيل اتنين في نفس اللحظة مايعديش
    perform 1 from profiles where role = 'gm' and active = true for update;
    if not exists (select 1 from profiles where role = 'gm' and active = true and id <> old.id) then
      raise exception 'لازم يفضل مدير عام واحد فعّال على الأقل';
    end if;
  end if;
  return new;
end;
$$;

do $$ begin
  alter table shift_claims add constraint shift_claims_one_per_user_day unique (date, username);
exception when duplicate_object then null;
          when others then raise notice 'تعذر تثبيت قيد "شيفت واحد لكل موظف في اليوم" - فيه اختيارات قديمة مكررة. راجعيها يدويًا.';
end $$;

drop policy if exists "claims delete" on shift_claims;
create policy "claims delete" on shift_claims for delete using (is_gm());

drop policy if exists "shifts update" on shift_records;
create policy "shifts update" on shift_records for update using (
  (is_staff() and staff_username = (select username from profiles where id = auth.uid()))
  or can_manage_financials() or (closed = true and is_gm_or_reservations())
) with check (
  (is_staff() and staff_username = (select username from profiles where id = auth.uid()))
  or can_manage_financials() or is_gm_or_reservations()
);

-- ============================================================================
-- خطوات يدوية لازم تتأكدي منها بعد تشغيل السكريبت ده (مرة واحدة بس):
--
-- 1) Authentication -> Sign In / Providers -> Email -> شيّلي علامة
--    "Confirm email" (من غيرها حسابات الموظفين الجداد مش هيقدروا يدخلوا).
--
-- 2) Authentication -> Settings -> Realtime Authorization: تأكدي إنه مفعّل
--    ومحترم الـ RLS، عشان بيانات bookings/shift_records الحساسة متتسربش
--    لأي مشترك في القناة بدون صلاحية SELECT فعلية.
--
-- 3) نشر الـ Edge Functions (مرة واحدة بس، من الجهاز اللي فيه المشروع):
--      supabase functions deploy create-user
--      supabase functions deploy reset-password
--
-- 4) (اختياري لكن موصى بيه) تقييد CORS للـ Edge Functions بدل ما تفضل
--    مفتوحة لأي نطاق - بعد ما تعرفي دومين الموقع بتاعك على Vercel:
--      supabase secrets set ALLOWED_ORIGIN=https://your-domain.vercel.app
--
-- 5) لو عندك حجوزات متعارضة قديمة (تواريخ متداخلة لنفس الغرفة) من قبل
--    تشغيل السكريبت ده، قيد منع الحجز المزدوج في القسم 8 هيفشل ويطلعلك
--    NOTICE بدل ما يوقف باقي السكريبت - راجعيها يدويًا وشغلي القسم ده لوحده
--    تاني بعد كده.
-- ============================================================================
