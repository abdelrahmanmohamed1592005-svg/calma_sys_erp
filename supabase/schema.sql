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
  when duplicate_object or duplicate_table then null;
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
--   * تقصير: الإجمالي الحالي × (الليالي اللي قعدها ÷ المحجوزة) - متوسط سعر
--     الليلة الفعلي (يراعي أي خصم)، والحد الأدنى ليلة (مشي نفس اليوم = ليلة).
create or replace function reprice_total(b bookings, new_checkout date)
returns numeric language plpgsql immutable as $$
declare
  old_n int := b.checkout - b.checkin;
  new_n int := new_checkout - b.checkin;
  n int;
begin
  if new_n = old_n then return coalesce(b.total_room, 0); end if;
  n := greatest(new_n, 1);  -- الحد الأدنى ليلة: نزيل دخل ومشي نفس اليوم بيتحاسب ليلة
  if n = old_n then return coalesce(b.total_room, 0); end if;
  if n > old_n then return coalesce(b.total_room, 0) + coalesce(b.price_night, 0) * (n - old_n); end if;
  if old_n <= 0 then return coalesce(b.total_room, 0); end if;
  return round(coalesce(b.total_room, 0) * n * 100 / old_n) / 100;
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
  -- نقل النزيل لغرفة تانية من دالة move_booking_room (بتغيّر الغرفة بس، وبتتأكد من الصلاحية والتعارض)
  if coalesce(current_setting('calma.move_rpc', true), '') = '1' or coalesce(current_setting('calma.currency_rpc', true), '') = '1' then return new; end if;
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
       -- الدخول المبكر: الموظف (اللي قدام النزيل) يقدر يسجّله مرة واحدة على حجز لسه ماتسجّلش
       -- عليه (applied من false لـ true)، لكن مايعدّلش ولا يشيل رسم اتسجّل قبل كده.
       or (new.early_checkin is distinct from old.early_checkin
           and not (not coalesce((old.early_checkin ->> 'applied')::boolean, false)
                    and coalesce((new.early_checkin ->> 'applied')::boolean, false)))
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
  if not calma_valid_method(meth) then raise exception 'وسيلة الدفع غير صالحة - اختار وسيلة من القايمة'; end if;
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
      cur_amt := case when trim(coalesce(el ->> 'collectionAmt', '')) ~ '^[-+]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][-+]?[0-9]+)?$' then trim(el ->> 'collectionAmt')::numeric else 0 end;
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
      'paymentDetails', jsonb_build_object('senderName', '', 'senderNumber', '', 'ref', '', 'onlinePaid', false),
      'notes', ''));
  else
    el := v_rows -> idx;
    cur_amt := case when trim(coalesce(el ->> 'collectionAmt', '')) ~ '^[-+]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][-+]?[0-9]+)?$' then trim(el ->> 'collectionAmt')::numeric else 0 end;
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
exception when duplicate_object or duplicate_table then null;
          when others then raise notice 'تعذر تثبيت قيد "شيفت واحد لكل موظف في اليوم" - فيه اختيارات قديمة مكررة. راجعيها يدويًا.';
end $$;

drop policy if exists "claims delete" on shift_claims;
create policy "claims delete" on shift_claims for delete using (is_gm());

-- موظف الشيفت التالي (اللي اختار شيفته فعلاً) يقدر يقفل الشيفت اللي قبله
-- لو لسه مفتوح (إقفال تلقائي لحظة ما الموظف الجديد يبدأ، حتى لو الأوفر تايم
-- ماخلصش) - ترتيب الشيفتات: صباحي ← مسائي ← ليلي ← صباحي اليوم اللي بعده.
create or replace function is_next_shift_claimant(rec_date date, rec_shift text)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from shift_claims c
    where c.username = (select username from profiles where id = auth.uid())
      and ((rec_shift = 'morning' and c.date = rec_date and c.shift_key = 'evening')
        or (rec_shift = 'evening' and c.date = rec_date and c.shift_key = 'night')
        or (rec_shift = 'night' and c.date = rec_date + 1 and c.shift_key = 'morning'))
  );
$$;
grant execute on function is_next_shift_claimant(date, text) to authenticated;

drop policy if exists "shifts update" on shift_records;
create policy "shifts update" on shift_records for update using (
  (is_staff() and (staff_username = (select username from profiles where id = auth.uid())
                   or (closed = false and is_next_shift_claimant(date, shift_key))))
  or can_manage_financials() or (closed = true and is_gm_or_reservations())
) with check (
  (is_staff() and (staff_username = (select username from profiles where id = auth.uid())
                   or is_next_shift_claimant(date, shift_key)))
  or can_manage_financials() or is_gm_or_reservations()
);

-- --------------------------------------------------------------------------
-- 27) تحصينات أمان وتكامل بيانات إضافية (مراجعة شاملة) - كلها idempotent:
--   (أ) سحب صلاحيات مالهاش لازمة من anon (الدخول بدون تسجيل).
--   (ب) سحب EXECUTE من دوال الصلاحيات للزوار (anon) - بتبقى للمسجّلين بس.
--   (ج) قيود طول/حجم/قيم على النصوص والـ JSON (NOT VALID = بتتطبّق على أي
--       كتابة جديدة من غير ما تفشل بسبب بيانات قديمة موجودة).
--   (د) وقت تحديث حالة الغرفة من السيرفر مش من ساعة جهاز الموظف.
--   (هـ) اختيار الشيفت/إنشاء يوميته مرتبطين بالشيفت المحجوز فعلاً لنفس
--       الموظف وبتاريخ قريب من النهارده، مش أي تاريخ/شيفت.
--   (و) بيانات "مين أنشأ الحجز ومتى" ثابتة بعد الإنشاء، وهوية صاحب يومية
--       الشيفت ما تتغيّرش بتعديل.
-- --------------------------------------------------------------------------

-- (أ) anon مايحتاجش يكتب/يقرأ أي جدول (كل القراءة والكتابة بتتم بجلسة مسجّلة،
--     وأول مدير عام بيتعمل بعد signUp يعني بجلسة authenticated).
revoke insert, update, delete on profiles from anon;
revoke select on profiles from anon;
revoke select on rooms from anon;

-- ثغرة حرجة اتصلّحت: شرط "أول مدير عام" القديم كان بيعدّ الصفوف بـ
-- (select count(*) from profiles) جوه الـ policy نفسها - والعدّ ده بيتنفّذ
-- تحت RLS بصلاحيات المستخدم، فأي حساب مسجّل لسه ملوش profile (مثلاً حد فتح
-- حساب جديد بنفسه لو التسجيل المفتوح شغال) كان بيشوف الجدول فاضي (عدد = ٠)
-- فيقدر يضيف نفسه "gm" حتى بعد وجود مديرين فعليين. دلوقتي الفحص بيتم بدالة
-- profiles_exist() (security definer - بتشوف الجدول الحقيقي كله).
drop policy if exists "profiles insert" on profiles;
create policy "profiles insert" on profiles for insert
  with check (
    id = auth.uid()
    and (
      (role = 'gm' and active = true and not profiles_exist())
      or is_gm()
    )
  );

-- (ب) دوال الصلاحيات: للمسجّلين بس (profiles_exist بس مفتوحة لشاشة الإعداد).
do $$
declare f text;
begin
  foreach f in array array[
    'is_gm()', 'is_active_user()', 'can_manage_financials()', 'is_reservations_manager()',
    'is_staff()', 'is_staff_or_reservations()', 'can_view_activity_log()', 'is_gm_or_reservations()',
    'is_next_shift_claimant(date, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- (ج) قيود الطول والحجم والقيم
do $$
declare c record;
begin
  for c in select * from (values
    ('bookings',       'bookings_text_len_chk',      $c$char_length(guest_name) <= 200 and char_length(coalesce(phone, '')) <= 60 and char_length(coalesce(code, '')) <= 100 and char_length(coalesce(notes, '')) <= 2000$c$),
    ('bookings',       'bookings_json_size_chk',     $c$octet_length(payment_details::text) <= 4000 and octet_length(extras::text) <= 2000 and octet_length(early_checkin::text) <= 2000$c$),
    ('bookings',       'bookings_amount_max_chk',    $c$price_night <= 1000000000 and total_room <= 1000000000 and amount_paid <= 1000000000 and amount_tendered <= 1000000000$c$),
    ('bookings',       'bookings_pax_max_chk',       $c$pax <= 100$c$),
    ('profiles',       'profiles_text_len_chk',      $c$char_length(name) <= 80 and char_length(username) <= 30$c$),
    ('activity_log',   'activity_text_len_chk',      $c$char_length(action) <= 2000$c$),
    ('shift_records',  'shifts_notes_len_chk',       $c$char_length(coalesce(shift_notes, '')) <= 5000$c$),
    ('shift_records',  'shifts_json_size_chk',       $c$octet_length(rows::text) <= 1000000 and octet_length(cafeteria::text) <= 50000 and octet_length(handover::text) <= 20000 and octet_length(method_handover::text) <= 20000 and octet_length(booking_collections::text) <= 500000$c$),
    ('room_overrides', 'room_overrides_status_chk',  $c$status in ('auto', 'early_checkout', 'maintenance', 'cleaning')$c$)
  ) as t(tbl, cname, expr)
  loop
    begin
      execute format('alter table %I add constraint %I check (%s) not valid', c.tbl, c.cname, c.expr);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- (د) وقت آخر تحديث لحالة الغرفة من ساعة السيرفر (صلاحية الحالة اليدوية بتتحسب
--     بتاريخه، فساعة جهاز غلط/متلاعب فيها كانت بتطيّل أو تقصّر الحالة).
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
    new.updated_at := now();
  end if;

  return new;
end;
$$;

-- (هـ) اختيار الشيفت: بتاريخ قريب من النهارده بس (النهارده/امبارح بسبب يوم
--     الشيفتات اللي بيبدأ ٨ص) - مش أي تاريخ بعيد يحجز شيفتات مقدّمًا.
drop policy if exists "claims insert" on shift_claims;
create policy "claims insert" on shift_claims for insert
  with check (is_staff() and date between hotel_today() - 1 and hotel_today() + 1);

-- إنشاء يومية شيفت: لنفس الموظف اللي حاجز الشيفت ده فعلاً وبتاريخ قريب.
drop policy if exists "shifts insert" on shift_records;
create policy "shifts insert" on shift_records for insert
  with check (
    is_staff()
    and date between hotel_today() - 1 and hotel_today() + 1
    and exists (
      select 1 from shift_claims c
      where c.date = shift_records.date and c.shift_key = shift_records.shift_key
        and c.username = (select username from profiles where id = auth.uid())
    )
  );

-- (و) ثبات بيانات الأصل: الحجز (من أنشأه ومتى) ويومية الشيفت (تاريخها/نوعها/
--     صاحبها) مايتعدّلوش بعد الإنشاء - التعديل الوحيد المسموح هو على المحتوى.
create or replace function protect_record_provenance()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_TABLE_NAME = 'bookings' then
    new.created_by := old.created_by;
    new.created_by_role := old.created_by_role;
    new.created_at := old.created_at;
  elsif TG_TABLE_NAME = 'shift_records' then
    if new.date is distinct from old.date or new.shift_key is distinct from old.shift_key
       or new.staff_username is distinct from old.staff_username then
      raise exception 'تاريخ الشيفت ونوعه وصاحبه مينفعش يتغيّروا';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_provenance_guard on bookings;
create trigger bookings_provenance_guard before update on bookings
  for each row execute function protect_record_provenance();
drop trigger if exists shift_records_provenance_guard on shift_records;
create trigger shift_records_provenance_guard before update on shift_records
  for each row execute function protect_record_provenance();

-- (ز) المدير العام والمحاسبة كانوا يقدروا يعدّلوا محتوى يومية شيفت **مفتوح** (سياسة
--     التعديل كانت بتسمح لـ can_manage_financials() في أي حالة)، مع إن صلاحياتهم
--     (editLedger = false) تصحيح بعد الإقفال بس. دلوقتي: الموظف صاحب الشيفت (أو
--     التالي له) على المفتوح، والمدير/المحاسبة/مدير الحجوزات على المقفول بس
--     (تصحيح أو إعادة فتح). WITH CHECK بيفضل واسع عشان إعادة الفتح (closed true -> false) تعدّي.
drop policy if exists "shifts update" on shift_records;
create policy "shifts update" on shift_records for update using (
  (is_staff() and (staff_username = (select username from profiles where id = auth.uid())
                   or (closed = false and is_next_shift_claimant(date, shift_key))))
  or (closed = true and (can_manage_financials() or is_gm_or_reservations()))
) with check (
  (is_staff() and (staff_username = (select username from profiles where id = auth.uid())
                   or is_next_shift_claimant(date, shift_key)))
  or can_manage_financials() or is_gm_or_reservations()
);

-- (ح) مفيش حذف لحجز عليه حركة فلوس (مدفوع / طلب رد معلّق / اترد منه مبلغ): الواجهة
--     كانت بتمنع ده بس، لكن قاعدة البيانات كانت بتسمح لمدير الحجوزات يمسح الحجز
--     (ويضيّع الأثر المالي بتاعه). الإلغاء (status = 'ملغي') هو الطريق الصح.
create or replace function prevent_delete_booking_with_money()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(old.amount_paid, 0) > 0 or coalesce(old.refund_pending, false) or coalesce(old.refunded_amount, 0) > 0 then
    raise exception 'الحجز ده عليه حركة فلوس (مدفوع أو رد) - استخدم حالة "ملغي" بدل الحذف';
  end if;
  return old;
end;
$$;
drop trigger if exists bookings_no_delete_with_money on bookings;
create trigger bookings_no_delete_with_money before delete on bookings
  for each row execute function prevent_delete_booking_with_money();

-- (ط) توحيد صلاحيات اليومية مع الواجهة (constants.js):
--     * إعادة فتح شيفت مقفول: المدير العام ومدير الحجوزات بس (reopenShift) - المحاسبة كانت
--       تقدر تفتحه من قاعدة البيانات رغم إن الواجهة بتمنعها. المحاسبة لسه تقدر تصحّح المحتوى.
--     * مسح سجل يومية: المدير العام بس (لإلغاء اختيار شيفت بالغلط) وللشيفت المفتوح بس - يومية
--       مقفولة (متثبّتة فيها أرصدة) لازم تتفتح الأول؛ المحاسبة كانت تقدر تمسح أي يومية.
create or replace function prevent_closed_shift_edit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.closed = true then
    if new.closed = false then
      if not is_gm_or_reservations() then
        raise exception 'إعادة فتح شيفت مقفول من صلاحية المدير العام أو مدير الحجوزات بس';
      end if;
    else
      -- الشيفت فاضل مقفول وبيتم تعديل محتواه (تصحيح): المدير العام/الحسابات بس
      if not can_manage_financials() then
        raise exception 'لا يمكن تعديل شيفت مقفول إلا من المدير العام أو الحسابات';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop policy if exists "shifts delete" on shift_records;
create policy "shifts delete" on shift_records for delete using (is_gm() and closed = false);

-- --------------------------------------------------------------------------
-- 28) أكواد الأفراد + صفوف مصاريف/إيرادات الفندق + رد الفلوس بحسب الحجز:
--   (أ) كود لكل فرد في الحجز (بعدد الأفراد pax) بيكتبه المستخدم بنفسه (bookings.guest_codes):
--       مصفوفة نصوص، الخانة الفاضية = فرد من غير كود. جدول booking_guests بيتبني منها تلقائيًا
--       بـ trigger (مفيش كتابة مباشرة من الواجهة) ومربوط بالغرفة اللي سكن فيها. نفس الكود ممكن
--       يتكرر في أكتر من حجز (نزيل راجع) فالبحث بالكود بيطلّع كل الغرف اللي سكنها، لكن مايتكررش
--       جوه نفس الحجز.
--   (ب) shift_records.hotel_rows: بنود "مصاريف وإيرادات الفندق" في اليومية (مش مرتبطة بغرفة).
--   (ج) تحصيل كل حجز في اليومية بصف مستقل (bookingId في الصف) - فبيتفصل تحصيل التسكين
--       المكرر عن تحصيل الحجز اللي قبله، ورد الفلوس بيتخصم من صف نفس الحجز.
-- --------------------------------------------------------------------------
create table if not exists booking_guests (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  room integer not null references rooms(number),
  seq integer not null check (seq > 0),
  code text not null,
  created_at timestamptz not null default now(),
  unique (booking_id, seq)
);
-- نسخة أقدم من القسم ده كانت بتولّد الأكواد تلقائيًا وبتمنع تكرارها: مرة واحدة بس بنمسحها
-- (قبل ما العمود الجديد يتضاف) وبنشيل قيد التفرّد.
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bookings' and column_name = 'guest_codes') then
    delete from booking_guests where id is not null;
  end if;
end $$;
alter table booking_guests drop constraint if exists booking_guests_code_key;
drop function if exists gen_guest_code();
drop function if exists ensure_booking_guests(uuid);
create index if not exists booking_guests_booking_idx on booking_guests (booking_id);
create index if not exists booking_guests_code_idx on booking_guests (upper(code));

alter table bookings add column if not exists guest_codes jsonb not null default '[]'::jsonb;
do $$ begin
  alter table bookings add constraint bookings_guest_codes_shape check (jsonb_typeof(guest_codes) = 'array' and jsonb_array_length(guest_codes) <= 100 and octet_length(guest_codes::text) <= 8000) not valid;
exception when duplicate_object then null; end $$;

alter table booking_guests enable row level security;
drop policy if exists "guests select" on booking_guests;
create policy "guests select" on booking_guests for select using (is_active_user());
revoke all on booking_guests from anon, authenticated;
grant select on booking_guests to authenticated;
grant all on booking_guests to service_role;

-- بيبني أكواد الأفراد من bookings.guest_codes (بنفس ترتيب الأفراد) ومربوطة بالغرفة الحالية.
-- الكود فريد جوه الشهر (شهر تاريخ الدخول): نفس الرقم مرفوض لو اتكتب لنزيل تاني في نفس الشهر
-- (حتى لو الحجز القديم اتلغى أو النزيل مشي - الكود بيفضل محفوظ)، ومسموح في شهر مختلف.
alter table booking_guests add column if not exists ym text;
update booking_guests g set ym = to_char(b.checkin, 'YYMM') from bookings b where b.id = g.booking_id and g.ym is null;
create or replace function bookings_sync_guests()
returns trigger language plpgsql security definer set search_path = public as $$
declare codes jsonb; n int; i int; c text; seen text[] := '{}'; ym_v text; clash record;
begin
  codes := coalesce(new.guest_codes, '[]'::jsonb);
  n := least(greatest(coalesce(new.pax, 1), 1), jsonb_array_length(codes));
  ym_v := to_char(new.checkin, 'YYMM');
  delete from booking_guests where booking_id = new.id;
  for i in 0 .. n - 1 loop
    if jsonb_typeof(codes -> i) is distinct from 'string' then continue; end if;
    c := btrim(codes ->> i);
    if c = '' then continue; end if;
    if char_length(c) > 40 then raise exception 'كود الفرد % أطول من ٤٠ حرف', i + 1; end if;
    if upper(c) = any(seen) then raise exception 'الكود % مكرر جوه نفس الحجز', c; end if;
    seen := seen || upper(c);
    select g.room, b.guest_name into clash from booking_guests g join bookings b on b.id = g.booking_id
      where g.ym = ym_v and upper(g.code) = upper(c) and g.booking_id <> new.id limit 1;
    if found then
      raise exception 'الكود % مستخدم الشهر ده بالفعل (غرفة % - %) - اختار كود تاني أو استنى الشهر الجاي', c, clash.room, clash.guest_name;
    end if;
    insert into booking_guests(booking_id, room, seq, code, ym) values (new.id, new.room, i + 1, c, ym_v);
  end loop;
  return null;
end;
$$;
drop trigger if exists bookings_guests_sync on bookings;
create trigger bookings_guests_sync after insert or update of pax, room, guest_codes, checkin on bookings
  for each row execute function bookings_sync_guests();
revoke all on function bookings_sync_guests() from public, anon, authenticated;
create index if not exists booking_guests_ym_code_idx on booking_guests (ym, upper(code));

do $$ begin
  begin execute 'alter publication supabase_realtime add table booking_guests';
  exception when duplicate_object then null; when others then null; end;
end $$;

-- (ب) بنود مصاريف وإيرادات الفندق في اليومية
alter table shift_records add column if not exists hotel_rows jsonb not null default '[]'::jsonb;
do $$ begin
  alter table shift_records add constraint shifts_hotel_rows_size_chk check (octet_length(hotel_rows::text) <= 200000) not valid;
exception when duplicate_object then null; end $$;

-- (ج) رد الفلوس بيتخصم من صف نفس الحجز في اليومية (لو تحصيله اتسجّل بصف مستقل)، ومايتدمجش مع صف حجز تاني
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
  if not calma_valid_method(meth) then raise exception 'وسيلة الدفع غير صالحة - اختار وسيلة من القايمة'; end if;
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
  -- ١) صف نفس الحجز (تحصيله اتسجّل بصف مستقل) بنفس الوسيلة والعملة
  for i in 0 .. jsonb_array_length(v_rows) - 1 loop
    el := v_rows -> i;
    if (el ->> 'bookingId') = b.id::text and el ->> 'collectionMethod' = meth and el ->> 'collectionCurrency' = b.currency then
      idx := i; exit;
    end if;
  end loop;
  -- ٢) تحصيل قديم من غير ربط بحجز: صف الغرفة اللي مش تابع لحجز تاني (أو صف فاضي)
  if idx is null then
    for i in 0 .. jsonb_array_length(v_rows) - 1 loop
      el := v_rows -> i;
      if (el ->> 'room') = b.room::text and coalesce(el ->> 'bookingId', '') = '' then
        cur_amt := case when trim(coalesce(el ->> 'collectionAmt', '')) ~ '^[-+]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][-+]?[0-9]+)?$' then trim(el ->> 'collectionAmt')::numeric else 0 end;
        if (cur_amt <> 0 or coalesce(el ->> 'collectionDesc', '') <> '')
           and el ->> 'collectionMethod' = meth and el ->> 'collectionCurrency' = b.currency then
          idx := i; exit;
        end if;
        if empty_idx is null and cur_amt = 0 and coalesce(el ->> 'collectionDesc', '') = '' then empty_idx := i; end if;
      end if;
    end loop;
    if idx is null then idx := empty_idx; end if;
  end if;
  if idx is null then
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'room', b.room, 'bookingId', b.id, 'expenseDesc', '', 'expenseAmt', '', 'expenseCategory', 'أخرى', 'expenseCurrency', 'EGP',
      'collectionDesc', label, 'collectionAmt', -amount, 'collectionMethod', meth, 'collectionCurrency', b.currency,
      'paymentDetails', jsonb_build_object('senderName', '', 'senderNumber', '', 'ref', '', 'onlinePaid', false),
      'notes', ''));
  else
    el := v_rows -> idx;
    cur_amt := case when trim(coalesce(el ->> 'collectionAmt', '')) ~ '^[-+]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][-+]?[0-9]+)?$' then trim(el ->> 'collectionAmt')::numeric else 0 end;
    cur_desc := coalesce(el ->> 'collectionDesc', '');
    -- صف فاضي بيتربط بالحجز ده من أول رد/تحصيل عليه
    if cur_amt = 0 and cur_desc = '' and coalesce(el ->> 'bookingId', '') = '' then
      el := el || jsonb_build_object('bookingId', b.id);
    end if;
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
revoke all on function decide_booking_refund(uuid, text, timestamptz, text) from public, anon;
grant execute on function decide_booking_refund(uuid, text, timestamptz, text) to authenticated;

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

-- --------------------------------------------------------------------------
-- 29) كود الحجز تلقائي: B + سنة/شهر + رقم متسلسل بيبدأ من ١ كل شهر (مثلاً B2610-0001).
--     بيتولّد وقت إنشاء الحجز ومايتغيّرش بعد كده (المستخدم مابيكتبوش). الحجوزات القديمة
--     اللي من غير كود بتاخد كود تلقائي، واللي ليها كود قديم بتفضل زي ما هي.
-- --------------------------------------------------------------------------
create table if not exists booking_code_counters (
  ym text primary key,
  n integer not null default 0
);
alter table booking_code_counters enable row level security;
revoke all on booking_code_counters from anon, authenticated;
grant all on booking_code_counters to service_role;

create or replace function next_booking_code(p_day date default null)
returns text language plpgsql security definer set search_path = public as $$
declare ym_v text := to_char(coalesce(p_day, hotel_today()), 'YYMM'); k int;
begin
  insert into booking_code_counters(ym, n) values (ym_v, 1)
    on conflict (ym) do update set n = booking_code_counters.n + 1
    returning n into k;
  return 'B' || ym_v || '-' || lpad(k::text, 4, '0');
end;
$$;
revoke all on function next_booking_code(date) from public, anon, authenticated;

create or replace function bookings_auto_code()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    new.code := next_booking_code();
  elsif coalesce(old.code, '') <> '' then
    new.code := old.code;                       -- مابيتغيّرش
  elsif coalesce(new.code, '') = '' then
    new.code := next_booking_code();
  end if;
  return new;
end;
$$;
drop trigger if exists bookings_auto_code_guard on bookings;
create trigger bookings_auto_code_guard before insert or update on bookings
  for each row execute function bookings_auto_code();
revoke all on function bookings_auto_code() from public, anon, authenticated;

-- الحجوزات الموجودة من غير كود (بالترتيب الزمني)
do $$ declare r record; begin
  for r in select id from bookings where coalesce(code, '') = '' order by created_at loop
    update bookings set code = next_booking_code() where id = r.id;
  end loop;
end $$;

-- --------------------------------------------------------------------------
-- 30) حالة التحصيل تلقائية + تحصيل الكافيتيريا + كافيتيريا الاستاف:
--   (أ) علامة "متحصّل بالكامل" (settled) مابقاتش قرار حد: بتتحسب تلقائيًا في
--       قاعدة البيانات من المدفوع والإجمالي (حجز ملغي = false). اتشالت قيود
--       القفل القديمة (قسم ١٧ و٢٤) لأنها كانت مربوطة بعلامة بيعلّمها الموظف
--       بإيده، وكمان اتشال شرط تعديل settled من قيد مدير الحجوزات (قسم ١٤).
--       أي تعديل في الإجمالي أو المدفوع بيحدّث الحالة لوحده، وزيادة المدفوع
--       عن الإجمالي بتفتح طلب رد فلوس زي ما كان (قسم ٢١).
--   (ب) shift_records.cafeteria_rows: تحصيل الكافيتيريا التلقائي (خدمات نزلاء
--       اتحصّلت + سداد الاستاف) - بنود بنفس شكل صفوف اليومية.
--   (ج) staff_cafeteria: مشروبات/أكل الاستاف من الكافيتيريا ومين دفع ومين لسه
--       عليه فلوس (المديونية بتفضل لحد ما تتسدّد حتى لو عدّت شيفتات كتير).
-- --------------------------------------------------------------------------
drop trigger if exists bookings_settled_charge_guard on bookings;
drop trigger if exists bookings_settled_validity_guard on bookings;
drop function if exists prevent_charge_edit_when_settled();
drop function if exists prevent_invalid_settled();

-- اللي الفندق نفسه مطلوب يحصّله: الإجمالي الكلي، أو (للحجز المدفوع أونلاين)
-- الإجمالي ناقص سعر الغرفة اللي اتدفع للمنصة (نفس bookingHotelTotal في money.js)
create or replace function booking_hotel_total(b bookings)
returns numeric language sql immutable as $$
  select case when coalesce((b.payment_details->>'onlinePaid')::boolean, false)
              then greatest(0, booking_grand_total(b) - coalesce(b.total_room, 0))
              else booking_grand_total(b) end;
$$;

create or replace function bookings_auto_settled()
returns trigger language plpgsql as $$
begin
  new.settled := new.status is distinct from 'ملغي' and coalesce(new.amount_paid, 0) >= booking_hotel_total(new);
  return new;
end;
$$;
-- الاسم بيبدأ بـ zz عشان يشتغل آخر تريجر (بعد ما باقي القيود تخلص)
drop trigger if exists bookings_zz_auto_settled on bookings;
create trigger bookings_zz_auto_settled before insert or update on bookings
  for each row execute function bookings_auto_settled();

-- قيد مدير الحجوزات (قسم ١٤) من غير شرط settled: التحصيل (المدفوع) بس هو اللي
-- مش من صلاحيته، والحالة بقت نتيجة تلقائية مش حاجة بيعدّلها.
create or replace function prevent_reservations_collection_edit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  old_paid numeric; old_tendered numeric;
begin
  if coalesce(current_setting('calma.refund_rpc', true), '') = '1' then
    return new;
  end if;
  if is_reservations_manager() then
    if TG_OP = 'INSERT' then
      old_paid := 0; old_tendered := 0;
    else
      old_paid := old.amount_paid; old_tendered := old.amount_tendered;
    end if;
    if (new.amount_paid is distinct from old_paid)
       or (new.amount_tendered is distinct from old_tendered) then
      raise exception 'تسجيل التحصيل (المدفوع/المتحصّل) من صلاحية موظف الشيفت بس، مش مدير الحجوزات';
    end if;
  end if;
  return new;
end;
$$;

-- حجوزات موجودة من قبل: نحسب الحالة لمرة واحدة (التريجر هو اللي بيحسبها)
do $$
declare r record;
begin
  for r in select id from bookings b where b.settled is distinct from (b.status is distinct from 'ملغي' and coalesce(b.amount_paid, 0) >= booking_hotel_total(b)) loop
    begin
      update bookings set settled = settled where id = r.id;       -- التريجر هو اللي بيحسبها
    exception when others then raise notice 'تعذر إعادة حساب حالة التحصيل للحجز %: %', r.id, sqlerrm;
    end;
  end loop;
end $$;

-- (ب) تحصيل الكافيتيريا التلقائي في اليومية
alter table shift_records add column if not exists cafeteria_rows jsonb not null default '[]'::jsonb;
do $$ begin
  alter table shift_records add constraint shifts_cafeteria_rows_size_chk check (octet_length(cafeteria_rows::text) <= 200000) not valid;
exception when duplicate_object then null; end $$;

-- (ج) كافيتيريا الاستاف
create table if not exists staff_cafeteria (
  id uuid primary key default gen_random_uuid(),
  day date not null default hotel_today(),
  shift_key text check (shift_key in ('morning','evening','night')),
  consumer_username text,
  consumer_name text not null check (char_length(btrim(consumer_name)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 300),
  amount numeric not null check (amount > 0 and amount <= 1000000),
  currency text not null default 'EGP' check (currency in ('EGP','USD','EUR','SAR','GBP')),
  paid_amount numeric not null default 0 check (paid_amount >= 0),
  payments jsonb not null default '[]'::jsonb check (jsonb_typeof(payments) = 'array' and octet_length(payments::text) <= 20000),
  recorded_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_cafeteria_paid_le_amount check (paid_amount <= amount)
);
create index if not exists staff_cafeteria_day_idx on staff_cafeteria (day desc);
create index if not exists staff_cafeteria_consumer_idx on staff_cafeteria (consumer_name);

create or replace function staff_cafeteria_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_username text;
begin
  select username into v_username from profiles where id = auth.uid();
  if TG_OP = 'INSERT' then
    new.recorded_by := coalesce(v_username, new.recorded_by);
    new.created_at := now();
    return new;
  end if;
  -- تعديل: المدير العام/الحسابات بس يقدروا يغيّروا أي حاجة. موظف الشيفت بيسدّد
  -- بس (يزوّد paid_amount ويضيف في payments) - مايقدرش يعدّل المبلغ أو الاسم أو
  -- يقلّل المدفوع.
  if not can_manage_financials() then
    if new.consumer_name is distinct from old.consumer_name
       or new.consumer_username is distinct from old.consumer_username
       or new.description is distinct from old.description
       or new.amount is distinct from old.amount
       or new.currency is distinct from old.currency
       or new.day is distinct from old.day
       or new.shift_key is distinct from old.shift_key
       or new.recorded_by is distinct from old.recorded_by then
      raise exception 'تعديل بيانات استهلاك الاستاف من المدير العام أو الحسابات بس - موظف الشيفت يسجّل السداد بس';
    end if;
    if new.paid_amount < old.paid_amount
       or jsonb_array_length(new.payments) < jsonb_array_length(old.payments) then
      raise exception 'مينفعش تقلّل المدفوع على استهلاك استاف';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists staff_cafeteria_guard_trg on staff_cafeteria;
create trigger staff_cafeteria_guard_trg before insert or update on staff_cafeteria
  for each row execute function staff_cafeteria_guard();
revoke all on function staff_cafeteria_guard() from public, anon, authenticated;

alter table staff_cafeteria enable row level security;
drop policy if exists "staff cafeteria select" on staff_cafeteria;
create policy "staff cafeteria select" on staff_cafeteria for select using (is_active_user());
drop policy if exists "staff cafeteria insert" on staff_cafeteria;
create policy "staff cafeteria insert" on staff_cafeteria for insert with check (is_staff());
drop policy if exists "staff cafeteria update" on staff_cafeteria;
create policy "staff cafeteria update" on staff_cafeteria for update using (is_staff() or can_manage_financials()) with check (is_staff() or can_manage_financials());
drop policy if exists "staff cafeteria delete" on staff_cafeteria;
create policy "staff cafeteria delete" on staff_cafeteria for delete using (can_manage_financials());

revoke all on staff_cafeteria from anon, authenticated;
grant select, insert, update, delete on staff_cafeteria to authenticated;
grant all on staff_cafeteria to service_role;

do $$ begin
  begin execute 'alter publication supabase_realtime add table staff_cafeteria';
  exception when duplicate_object then null; when others then null; end;
end $$;

-- --------------------------------------------------------------------------
-- 31) رد الفلوس بيتقسّم على وسائل الدفع الأصلية (من غير لخبطة كاش/فيزا):
--     المدفوع الفعلي لكل وسيلة (وكارت/محفظة) بيتحسب من اليومية نفسها (صفوف الحجز
--     وصفوف الكافيتيريا المربوطة بيه، عبر كل الشيفتات). الرد بيبدأ بالوسيلة اللي
--     مدير الحجوزات اختارها (لحد رصيدها بس)، والباقي على باقي الوسائل بالأكبر رصيد -
--     فيزا ١٠٠ + كاش ٥٠ والرد ١٥٠ يرجّع الفيزا ١٠٠ والكاش ٥٠، ورد الفيزا بيتسجّل على
--     نفس الكارت (****١٢٣٤). لو الوسيلة المختارة معاهاش رصيد (مثلاً دفع كاش والرد
--     بتحويل) قرار المدير هو اللي بيمشي والرد كله عليها. لو اليومية مفيهاش تحصيل
--     لحجز قديم، بيتسجّل الرد كله على الوسيلة المختارة زي الأول.
-- --------------------------------------------------------------------------
create or replace function decide_booking_refund(p_booking uuid, p_decision text, p_expected timestamptz default null, p_method text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b bookings%rowtype;
  sr shift_records%rowtype;
  v_rows jsonb; el jsonb; i int; idx int;
  amount numeric; grand numeric; uname text; meth text; remaining numeric; take numeric; tot_bal numeric;
  alloc record; chosen_bal numeric := 0; splits jsonb := '[]'::jsonb;
  cur_amt numeric; cur_desc text; label text; det jsonb; online_m boolean; empty_idx int;
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
  if not calma_valid_method(meth) then raise exception 'وسيلة الدفع غير صالحة - اختار وسيلة من القايمة'; end if;
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

  -- رصيد كل وسيلة (وتفاصيلها) من تحصيل هذا الحجز في اليومية بعملة الحجز
  -- (Supabase بيفعّل pg_safeupdate: أي DELETE/UPDATE من غير WHERE بيتقفل - فمفيش هنا ولا واحد)
  drop table if exists pg_temp._refund_bal;
  create temporary table _refund_bal (m text, n text, p text, bal numeric, ord int) on commit drop;
  insert into _refund_bal(m, n, p, bal, ord)
  select t.m, t.n, t.p, t.bal, case when t.m = meth then 0 else 1 end from (
  select e ->> 'collectionMethod' as m, coalesce(e #>> '{paymentDetails,senderName}', '') as n, coalesce(e #>> '{paymentDetails,senderNumber}', '') as p,
         sum(case when trim(coalesce(e ->> 'collectionAmt', '')) ~ '^[-+]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][-+]?[0-9]+)?$' then trim(e ->> 'collectionAmt')::numeric else 0 end) as bal
  from (
    select x as e from shift_records s, jsonb_array_elements(coalesce(s.rows, '[]'::jsonb)) x
    union all
    select x as e from shift_records s, jsonb_array_elements(coalesce(s.cafeteria_rows, '[]'::jsonb)) x
  ) q
  where q.e ->> 'bookingId' = b.id::text and q.e ->> 'collectionCurrency' = b.currency
  group by 1, 2, 3) t;
  delete from _refund_bal where bal <= 0;
  select coalesce(sum(bal), 0) into chosen_bal from _refund_bal where m = meth;
  -- (ترتيب الرد: الوسيلة المختارة الأول ord=0، وبعدها الأكبر رصيد - اتحسب وقت الإدخال)
  if chosen_bal = 0 then
    -- الوسيلة المختارة معاهاش رصيد: قرار المدير بيمشي والرد كله عليها (زي الأول)
    truncate _refund_bal;
    insert into _refund_bal values (meth, '', '', amount, 0);
  end if;

  -- بيانات قديمة: المدفوع على الحجز أكبر من اللي مسجّل في اليومية (حجز اتحصّل قبل ربط اليومية)؟ الفرق بيتحسب على أول وسيلة
  -- في الترتيب (بتفاصيلها) عشان اليومية تتطابق مع المبلغ اللي اترد فعلًا من غير ما فلوس تفلت من التسجيل.
  select coalesce(sum(bal), 0) into tot_bal from _refund_bal;
  if tot_bal < amount then
    update _refund_bal set bal = bal + (amount - tot_bal) where ctid = (select ctid from _refund_bal order by ord, bal desc limit 1);
  end if;
  v_rows := coalesce(sr.rows, '[]'::jsonb);
  remaining := amount;
  for alloc in select * from _refund_bal order by ord, bal desc loop
    exit when remaining <= 0;
    take := least(remaining, alloc.bal);
    if alloc.bal = amount and chosen_bal = 0 then take := remaining; end if;
    remaining := remaining - take;
    online_m := alloc.m in ('فيزا', 'تحويل بنكي / انستاباي', 'فودافون كاش', 'انستاباي', 'تحويل بنكي');
    det := jsonb_build_object('senderName', alloc.n, 'senderNumber', alloc.p, 'ref', '', 'onlinePaid', false);
    label := 'رد فلوس - ' || b.guest_name || ' (-' || take || ' ' || b.currency || ')';
    idx := null; empty_idx := null;
    for i in 0 .. jsonb_array_length(v_rows) - 1 loop
      el := v_rows -> i;
      if (el ->> 'bookingId') = b.id::text and el ->> 'collectionMethod' = alloc.m and el ->> 'collectionCurrency' = b.currency
         and (not online_m or (coalesce(el #>> '{paymentDetails,senderName}', '') = alloc.n and coalesce(el #>> '{paymentDetails,senderNumber}', '') = alloc.p)) then
        idx := i; exit;
      end if;
    end loop;
    if idx is null and not online_m then
      -- تحصيل قديم من غير ربط بحجز: صف الغرفة اللي مش تابع لحجز تاني (أو صف فاضي)
      for i in 0 .. jsonb_array_length(v_rows) - 1 loop
        el := v_rows -> i;
        if (el ->> 'room') = b.room::text and coalesce(el ->> 'bookingId', '') = '' then
          cur_amt := case when trim(coalesce(el ->> 'collectionAmt', '')) ~ '^[-+]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][-+]?[0-9]+)?$' then trim(el ->> 'collectionAmt')::numeric else 0 end;
          if (cur_amt <> 0 or coalesce(el ->> 'collectionDesc', '') <> '') and el ->> 'collectionMethod' = alloc.m and el ->> 'collectionCurrency' = b.currency then
            idx := i; exit;
          end if;
          if empty_idx is null and cur_amt = 0 and coalesce(el ->> 'collectionDesc', '') = '' then empty_idx := i; end if;
        end if;
      end loop;
      if idx is null then idx := empty_idx; end if;
    end if;
    if idx is null then
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'room', b.room, 'bookingId', b.id, 'expenseDesc', '', 'expenseAmt', '', 'expenseCategory', 'أخرى', 'expenseCurrency', 'EGP',
        'collectionDesc', label, 'collectionAmt', -take, 'collectionMethod', alloc.m, 'collectionCurrency', b.currency,
        'paymentDetails', det, 'notes', ''));
    else
      el := v_rows -> idx;
      cur_amt := case when trim(coalesce(el ->> 'collectionAmt', '')) ~ '^[-+]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][-+]?[0-9]+)?$' then trim(el ->> 'collectionAmt')::numeric else 0 end;
      cur_desc := coalesce(el ->> 'collectionDesc', '');
      if cur_amt = 0 and cur_desc = '' and coalesce(el ->> 'bookingId', '') = '' then
        el := el || jsonb_build_object('bookingId', b.id) || jsonb_build_object('paymentDetails', det);
      end if;
      v_rows := jsonb_set(v_rows, array[idx::text], el || jsonb_build_object(
        'collectionAmt', cur_amt - take, 'collectionMethod', alloc.m, 'collectionCurrency', b.currency,
        'collectionDesc', case when cur_desc <> '' then cur_desc || ' / ' || label else label end));
    end if;
    splits := splits || jsonb_build_array(jsonb_build_object('method', alloc.m, 'amount', take, 'details', det));
  end loop;
  update shift_records set rows = v_rows,
    booking_collections = coalesce(booking_collections, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text, 'bookingId', b.id))
    where date = sr.date and shift_key = sr.shift_key;

  update bookings set
    amount_paid = coalesce(amount_paid, 0) - amount,
    refund_pending = false, refund_decision = 'refunded',
    refunded_amount = coalesce(refunded_amount, 0) + amount, refunded_by = uname, refunded_at = now()
    where id = p_booking;
  perform set_config('calma.refund_rpc', '', true);
  return jsonb_build_object('decision', 'refunded', 'amount', amount, 'currency', b.currency, 'method', meth, 'splits', splits, 'shiftDate', sr.date, 'shiftKey', sr.shift_key);
end;
$$;
revoke all on function decide_booking_refund(uuid, text, timestamptz, text) from public, anon;
grant execute on function decide_booking_refund(uuid, text, timestamptz, text) to authenticated;

-- --------------------------------------------------------------------------
-- 32) إصلاح كود الحجز بعد ٩٩٩٩ حجز في الشهر: lpad(k, 4) كان بيقصّ الرقم الأطول من ٤ خانات (١٠٠٠٠ ← ١٠٠٠)
--     فيتكرر الكود ويفشل الإدخال بقيد التفرّد. دلوقتي الرقم الأطول بيتكتب كامل (B2610-10000).
--     بيطلع في اختبار الحمل (sim/load.sim.js).
-- --------------------------------------------------------------------------
create or replace function next_booking_code(p_day date default null)
returns text language plpgsql security definer set search_path = public as $$
declare ym_v text := to_char(coalesce(p_day, hotel_today()), 'YYMM'); k int;
begin
  insert into booking_code_counters(ym, n) values (ym_v, 1)
    on conflict (ym) do update set n = booking_code_counters.n + 1
    returning n into k;
  return 'B' || ym_v || '-' || lpad(k::text, greatest(4, length(k::text)), '0');
end;
$$;
revoke all on function next_booking_code(date) from public, anon, authenticated;

-- --------------------------------------------------------------------------
-- 33) تسجيل الفلوس بعملية واحدة ذرية (atomic) داخل قاعدة البيانات بدل خطوتين من المتصفح:
--     قبل كده الواجهة كانت بتحدّث الحجز الأول وبعدين تكتب في اليومية (طلبين منفصلين)، فلو التاني فشل
--     (نت وقع، تعارض متكرر...) الفلوس كانت بتتسجّل على الحجز ومش في اليومية. دلوقتي:
--       record_booking_payment  : دفعة على حجز (المدفوع + صف الوسيلة في اليومية + كافيتيريا النزيل) كله أو ولا حاجة.
--       record_staff_cafeteria  : استهلاك استاف (آجل أو مدفوع فورًا) + صف الكافيتيريا في اليومية.
--       settle_staff_cafeteria  : سداد مديونية استاف (بيتوزّع على الأقدم الأول) + اليومية.
--     والتحقق (المبلغ ≤ المتبقي، وسيلة صالحة، آخر ٤ أرقام للفيزا، رقم تليفون للتحويل) بقى في القاعدة نفسها كمان.
--     منطق دمج صفوف اليومية هنا مطابق لـ applyCollectionToRows/applyCafeteriaCollection في src/domain/money.js
--     (واختبار sim بيقارن النسختين).
-- --------------------------------------------------------------------------
create or replace function calma_online_method(m text) returns boolean language sql immutable as
$$ select m in ('فيزا', 'تحويل بنكي / انستاباي', 'فودافون كاش', 'انستاباي', 'تحويل بنكي') $$;
create or replace function calma_last4(t text) returns text language sql immutable as
$$ select right(regexp_replace(translate(coalesce(t, ''), '٠١٢٣٤٥٦٧٨٩', '0123456789'), '\D', '', 'g'), 4) $$;
create or replace function calma_phone(t text) returns text language sql immutable as
$$ select left(regexp_replace(translate(coalesce(t, ''), '٠١٢٣٤٥٦٧٨٩', '0123456789'), '[^0-9+]', '', 'g'), 20) $$;
create or replace function calma_num(t text) returns numeric language sql immutable as
$$ select case when trim(coalesce(t, '')) ~ '^[-+]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][-+]?[0-9]+)?$' then trim(t)::numeric else 0 end $$;
create or replace function calma_clean_details(m text, d jsonb) returns jsonb language sql immutable as $$
  select case
    when m = 'فيزا' then jsonb_build_object('senderName', '', 'senderNumber', calma_last4(d ->> 'senderNumber'), 'ref', '', 'onlinePaid', false)
    when calma_online_method(m) then jsonb_build_object('senderName', left(btrim(regexp_replace(coalesce(d ->> 'senderName', ''), E'[\\x01-\\x1f\\x7f]', '', 'g')), 120), 'senderNumber', calma_phone(d ->> 'senderNumber'), 'ref', '', 'onlinePaid', false)
    else jsonb_build_object('senderName', '', 'senderNumber', '', 'ref', '', 'onlinePaid', false) end $$;
create or replace function calma_details_err(m text, d jsonb) returns text language sql immutable as $$
  select case
    when m = 'فيزا' and length(calma_last4(d ->> 'senderNumber')) <> 4 then 'اكتب آخر ٤ أرقام من الكارت (٤ أرقام بالظبط)'
    when calma_online_method(m) and m <> 'فيزا' and length(regexp_replace(calma_phone(d ->> 'senderNumber'), '\D', '', 'g')) < 6 then 'اكتب رقم التليفون اللي اتحوّل منه'
    else null end $$;
create or replace function calma_details_key(m text, d jsonb) returns text language sql immutable as $$
  select case when m = 'فيزا' then calma_last4(d ->> 'senderNumber')
              when calma_online_method(m) then concat_ws(' · ', nullif(btrim(coalesce(d ->> 'senderName', '')), ''), nullif(btrim(coalesce(d ->> 'senderNumber', '')), ''))
              else '' end $$;
create or replace function calma_valid_method(m text) returns boolean language sql immutable as
$$ select m is not null and char_length(m) <= 40 and m in ('كاش', 'فيزا', 'تحويل بنكي / انستاباي', 'فودافون كاش', 'انستاباي', 'تحويل بنكي') $$;

-- دمج تحصيل في صف الغرفة (نفس قواعد applyCollectionToRows)
create or replace function calma_apply_room_collection(p_rows jsonb, p_room int, p_booking uuid, p_method text, p_cur text, p_details jsonb, p_amount numeric, p_label text)
returns jsonb language plpgsql immutable as $$
declare i int; el jsonb; idx int := null; n int := jsonb_array_length(p_rows); k text := calma_details_key(p_method, p_details); amt numeric; was_empty boolean; ne jsonb;
begin
  if p_amount = 0 then return p_rows; end if;
  for i in 0 .. n - 1 loop
    el := p_rows -> i; amt := calma_num(el ->> 'collectionAmt');
    if (el ->> 'room') = p_room::text and (el ->> 'bookingId') = p_booking::text
       and not (amt = 0 and coalesce(el ->> 'collectionDesc', '') = '')
       and el ->> 'collectionMethod' = p_method and coalesce(el ->> 'collectionCurrency', '') = p_cur
       and calma_details_key(p_method, el -> 'paymentDetails') = k then idx := i; exit; end if;
  end loop;
  if idx is null then
    for i in 0 .. n - 1 loop
      el := p_rows -> i; amt := calma_num(el ->> 'collectionAmt');
      if (el ->> 'room') = p_room::text and amt = 0 and coalesce(el ->> 'collectionDesc', '') = '' and coalesce(el ->> 'bookingId', '') = '' then idx := i; exit; end if;
    end loop;
  end if;
  if idx is null then
    return p_rows || jsonb_build_array(jsonb_build_object('room', p_room, 'bookingId', p_booking, 'expenseDesc', '', 'expenseAmt', '', 'expenseCategory', 'أخرى', 'expenseCurrency', 'EGP',
      'collectionDesc', p_label, 'collectionAmt', p_amount, 'collectionMethod', p_method, 'collectionCurrency', p_cur, 'paymentDetails', p_details, 'notes', ''));
  end if;
  el := p_rows -> idx; amt := calma_num(el ->> 'collectionAmt');
  was_empty := amt = 0 and coalesce(el ->> 'collectionDesc', '') = '';
  ne := el || jsonb_build_object('collectionAmt', amt + p_amount, 'collectionMethod', p_method, 'collectionCurrency', p_cur,
          'collectionDesc', case when coalesce(el ->> 'collectionDesc', '') <> '' then (el ->> 'collectionDesc') || ' / ' || p_label else p_label end);
  if coalesce(el ->> 'bookingId', '') = '' then ne := ne || jsonb_build_object('bookingId', p_booking); end if;
  if was_empty then ne := ne || jsonb_build_object('paymentDetails', p_details); end if;
  return jsonb_set(p_rows, array[idx::text], ne);
end;
$$;

-- دمج تحصيل كافيتيريا (نزيل/استاف) في cafeteria_rows (نفس قواعد applyCafeteriaCollection)
create or replace function calma_apply_cafe_collection(p_rows jsonb, p_kind text, p_key text, p_who text, p_room int, p_method text, p_cur text, p_details jsonb, p_amount numeric, p_label text)
returns jsonb language plpgsql immutable as $$
declare i int; el jsonb; idx int := null; n int := jsonb_array_length(p_rows); k text := calma_details_key(p_method, p_details); rk text; ne jsonb;
begin
  if p_amount = 0 then return p_rows; end if;
  for i in 0 .. n - 1 loop
    el := p_rows -> i;
    rk := case when coalesce(el ->> 'kind', 'guest') = 'staff' then coalesce(el ->> 'consumerKey', '') else coalesce(el ->> 'bookingId', '') end;
    if coalesce(el ->> 'kind', 'guest') = p_kind and rk = p_key and el ->> 'collectionMethod' = p_method and coalesce(el ->> 'collectionCurrency', '') = p_cur
       and calma_details_key(p_method, el -> 'paymentDetails') = k then idx := i; exit; end if;
  end loop;
  if idx is null then
    ne := jsonb_build_object('room', 'كافيتيريا', 'kind', p_kind, 'who', coalesce(p_who, ''), 'expenseDesc', '', 'expenseAmt', '', 'expenseCategory', 'أخرى', 'expenseCurrency', 'EGP',
      'collectionDesc', p_label, 'collectionAmt', p_amount, 'collectionMethod', p_method, 'collectionCurrency', p_cur, 'paymentDetails', p_details, 'notes', '');
    ne := ne || case when p_kind = 'staff' then jsonb_build_object('consumerKey', p_key) else jsonb_build_object('bookingId', p_key, 'guestRoom', p_room) end;
    return p_rows || jsonb_build_array(ne);
  end if;
  el := p_rows -> idx;
  return jsonb_set(p_rows, array[idx::text], el || jsonb_build_object('collectionAmt', calma_num(el ->> 'collectionAmt') + p_amount,
    'collectionDesc', case when coalesce(el ->> 'collectionDesc', '') <> '' then (el ->> 'collectionDesc') || ' / ' || p_label else p_label end));
end;
$$;

-- شيفت الموظف الحالي المفتوح (آخر شيفت مفتوح ليه النهارده/امبارح) - مقفول للتعديل أثناء العملية
create or replace function calma_my_open_shift() returns shift_records language plpgsql security definer set search_path = public as $$
declare uname text; sr shift_records;
begin
  select username into uname from profiles where id = auth.uid();
  select * into sr from shift_records where staff_username = uname and closed = false and date >= hotel_today() - 1
    order by date desc, (case shift_key when 'night' then 3 when 'evening' then 2 else 1 end) desc limit 1 for update;
  if not found then raise exception 'مفيش شيفتك مفتوح - التحصيل لازم يتسجّل في يومية شيفتك'; end if;
  return sr;
end;
$$;
revoke all on function calma_my_open_shift() from public, anon, authenticated;

create or replace function record_booking_payment(p_booking uuid, p_amount numeric, p_method text, p_details jsonb default '{}'::jsonb, p_expected timestamptz default null, p_note text default 'تحصيل')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b bookings%rowtype; sr shift_records; amt numeric := round(p_amount, 2); due numeric; err text; det jsonb;
  cafe_out numeric; cafe numeric := 0; v_extras jsonb; v_rows jsonb; v_caf jsonb; note text := left(coalesce(nullif(btrim(p_note), ''), 'تحصيل'), 60);
begin
  if not is_staff() then raise exception 'تسجيل التحصيل من صلاحية موظف الشيفت بس'; end if;
  if amt is null or amt <= 0 then raise exception 'اكتب مبلغ الدفعة (أكبر من صفر)'; end if;
  if not calma_valid_method(p_method) then raise exception 'وسيلة الدفع غير صالحة'; end if;
  err := calma_details_err(p_method, coalesce(p_details, '{}'::jsonb));
  if err is not null then raise exception '%', err; end if;
  det := calma_clean_details(p_method, coalesce(p_details, '{}'::jsonb));
  select * into b from bookings where id = p_booking for update;
  if not found then raise exception 'الحجز مش موجود'; end if;
  if b.status = 'ملغي' then raise exception 'الحجز ملغي - مينفعش يتحصّل عليه'; end if;
  if p_expected is not null and b.updated_at is distinct from p_expected then
    raise exception 'الحجز اتغيّر من حد تاني - حدّث الصفحة وجرّب تاني';
  end if;
  due := greatest(0, booking_hotel_total(b) - coalesce(b.amount_paid, 0));
  if amt > due then raise exception 'المبلغ أكبر من المتبقي على النزيل (%)', trim_scale(due); end if;
  sr := calma_my_open_shift();
  -- الدفعة بتسدّد خدمات كافيتيريا النزيل الأول، والباقي لصف الغرفة
  cafe_out := greatest(0, calma_num(b.extras ->> 'cafeteria') - calma_num(b.extras ->> 'cafeteriaPaid'));
  cafe := least(amt, cafe_out);
  v_extras := case when cafe > 0 then jsonb_set(b.extras, '{cafeteriaPaid}', to_jsonb(calma_num(b.extras ->> 'cafeteriaPaid') + cafe)) else b.extras end;
  perform set_config('calma.pay_rpc', '1', true);
  update bookings set amount_paid = coalesce(amount_paid, 0) + amt, payment_method = p_method, extras = v_extras where id = p_booking;
  perform set_config('calma.pay_rpc', '', true);
  v_rows := calma_apply_room_collection(coalesce(sr.rows, '[]'::jsonb), b.room, b.id, p_method, b.currency, det, amt - cafe,
    note || coalesce(' - ' || nullif(b.guest_name, ''), '') || ' (+' || trim_scale(amt - cafe) || ' ' || b.currency || ')');
  v_caf := coalesce(sr.cafeteria_rows, '[]'::jsonb);
  if cafe > 0 then
    v_caf := calma_apply_cafe_collection(v_caf, 'guest', b.id::text, b.guest_name, b.room, p_method, b.currency, det, cafe,
      'خدمة كافيتيريا' || coalesce(' - ' || nullif(b.guest_name, ''), '') || ' (+' || trim_scale(cafe) || ' ' || b.currency || ')');
  end if;
  update shift_records set rows = v_rows, cafeteria_rows = v_caf,
    booking_collections = coalesce(booking_collections, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text, 'bookingId', b.id))
    where date = sr.date and shift_key = sr.shift_key;
  return jsonb_build_object('amount', amt, 'cafeteria', cafe, 'left', due - amt, 'currency', b.currency, 'method', p_method, 'details', det, 'shiftDate', sr.date, 'shiftKey', sr.shift_key);
end;
$$;
revoke all on function record_booking_payment(uuid, numeric, text, jsonb, timestamptz, text) from public, anon;
grant execute on function record_booking_payment(uuid, numeric, text, jsonb, timestamptz, text) to authenticated;

create or replace function record_staff_cafeteria(p_name text, p_username text, p_desc text, p_amount numeric, p_currency text, p_method text default null, p_details jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare sr shift_records; amt numeric := round(p_amount, 2); nm text := btrim(coalesce(p_name, '')); err text; det jsonb; v_id uuid; paid boolean := p_method is not null and btrim(p_method) <> '';
begin
  if not is_staff() then raise exception 'تسجيل كافيتيريا الاستاف من صلاحية موظف الشيفت بس'; end if;
  if char_length(nm) < 1 or char_length(nm) > 120 then raise exception 'اختار اسم الموظف أو اكتب الاسم'; end if;
  if amt is null or amt <= 0 or amt > 1000000 then raise exception 'اكتب مبلغ الاستهلاك (أكبر من صفر)'; end if;
  if p_currency not in ('EGP', 'USD', 'EUR', 'SAR', 'GBP') then raise exception 'عملة غير صالحة'; end if;
  sr := calma_my_open_shift();
  if paid then
    if not calma_valid_method(p_method) then raise exception 'وسيلة الدفع غير صالحة'; end if;
    err := calma_details_err(p_method, coalesce(p_details, '{}'::jsonb));
    if err is not null then raise exception '%', err; end if;
    det := calma_clean_details(p_method, coalesce(p_details, '{}'::jsonb));
  end if;
  perform set_config('calma.staff_rpc', '1', true);
  insert into staff_cafeteria(day, shift_key, consumer_username, consumer_name, description, amount, currency, paid_amount, payments)
  values (sr.date, sr.shift_key, nullif(btrim(coalesce(p_username, '')), ''), nm, left(coalesce(p_desc, ''), 300), amt, p_currency, case when paid then amt else 0 end,
          case when paid then jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text, 'at', (extract(epoch from now()) * 1000)::bigint, 'amount', amt, 'method', p_method, 'details', det, 'day', sr.date, 'shiftKey', sr.shift_key)) else '[]'::jsonb end)
  returning id into v_id;
  perform set_config('calma.staff_rpc', '', true);
  if paid then
    update shift_records set cafeteria_rows = calma_apply_cafe_collection(coalesce(cafeteria_rows, '[]'::jsonb), 'staff', coalesce(nullif(btrim(coalesce(p_username, '')), ''), lower(nm)), nm, null, p_method, p_currency, det, amt,
      'كافيتيريا استاف - ' || nm || ' (+' || trim_scale(amt) || ' ' || p_currency || ')')
      where date = sr.date and shift_key = sr.shift_key;
  end if;
  return jsonb_build_object('id', v_id, 'amount', amt, 'paid', paid);
end;
$$;
revoke all on function record_staff_cafeteria(text, text, text, numeric, text, text, jsonb) from public, anon;
grant execute on function record_staff_cafeteria(text, text, text, numeric, text, text, jsonb) to authenticated;

create or replace function settle_staff_cafeteria(p_name text, p_username text, p_currency text, p_amount numeric, p_method text, p_details jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  sr shift_records; amt numeric := round(p_amount, 2); nm text := btrim(coalesce(p_name, '')); k text := coalesce(nullif(btrim(coalesce(p_username, '')), ''), lower(btrim(coalesce(p_name, ''))));
  err text; det jsonb; owed numeric; left_amt numeric; e record; part numeric;
begin
  if not is_staff() then raise exception 'تسجيل سداد الاستاف من صلاحية موظف الشيفت بس'; end if;
  if amt is null or amt <= 0 then raise exception 'اكتب مبلغ السداد'; end if;
  if not calma_valid_method(p_method) then raise exception 'وسيلة الدفع غير صالحة'; end if;
  err := calma_details_err(p_method, coalesce(p_details, '{}'::jsonb));
  if err is not null then raise exception '%', err; end if;
  det := calma_clean_details(p_method, coalesce(p_details, '{}'::jsonb));
  sr := calma_my_open_shift();
  -- قفل صفوف المديونية الأول (موظفين مختلفين ممكن يسدّدوا نفس الشخص في نفس اللحظة)، وبعدين نحسب المتبقي من آخر نسخة
  perform 1 from staff_cafeteria
    where coalesce(nullif(consumer_username, ''), lower(btrim(consumer_name))) = k and currency = p_currency and paid_amount < amount
    order by created_at, id for update;
  select coalesce(sum(amount - paid_amount), 0) into owed from staff_cafeteria
    where coalesce(nullif(consumer_username, ''), lower(btrim(consumer_name))) = k and currency = p_currency and paid_amount < amount;
  if owed <= 0 then raise exception 'مفيش مديونية على الموظف ده'; end if;
  if amt > owed then raise exception 'المبلغ أكبر من المديونية (%)', trim_scale(owed); end if;
  left_amt := amt;
  perform set_config('calma.staff_rpc', '1', true);
  for e in select id, amount, paid_amount from staff_cafeteria
           where coalesce(nullif(consumer_username, ''), lower(btrim(consumer_name))) = k and currency = p_currency and paid_amount < amount
           order by created_at, id for update loop
    exit when left_amt <= 0;
    part := least(left_amt, e.amount - e.paid_amount);
    update staff_cafeteria set paid_amount = paid_amount + part,
      payments = payments || jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text, 'at', (extract(epoch from now()) * 1000)::bigint, 'amount', part, 'method', p_method, 'details', det, 'day', sr.date, 'shiftKey', sr.shift_key))
      where id = e.id;
    left_amt := left_amt - part;
  end loop;
  perform set_config('calma.staff_rpc', '', true);
  if left_amt > 0 then raise exception 'المديونية اتغيّرت - حدّث وجرّب تاني'; end if;
  update shift_records set cafeteria_rows = calma_apply_cafe_collection(coalesce(cafeteria_rows, '[]'::jsonb), 'staff', k, nm, null, p_method, p_currency, det, amt,
    'كافيتيريا استاف - ' || nm || ' (+' || trim_scale(amt) || ' ' || p_currency || ')')
    where date = sr.date and shift_key = sr.shift_key;
  return jsonb_build_object('amount', amt, 'left', owed - amt, 'currency', p_currency);
end;
$$;
revoke all on function settle_staff_cafeteria(text, text, text, numeric, text, jsonb) from public, anon;
grant execute on function settle_staff_cafeteria(text, text, text, numeric, text, jsonb) to authenticated;

-- --------------------------------------------------------------------------
-- 34) تقوية بعد مراجعة شاملة للكود (كل نقطة اتأكدت بتجربة على قاعدة حقيقية):
--   (أ) مدير الحجوزات كان يقدر يعدّل محتوى يومية مقفولة (صفوف/رصيد) وهو بيعيد فتحها في نفس الـ UPDATE.
--       دلوقتي إعادة الفتح بتغيّر حالة القفل بس؛ تعديل المحتوى للمدير العام/الحسابات بس.
--   (ب) تغيير عملة حجز عليه مدفوع كان مسموح لمدير الحجوزات (١٠٠٠ جنيه تتقلب ١٠٠٠ دولار) - ممنوع لأي حد.
--   (ج) حجز مدفوع أونلاين (amount_paid = 0) كان ينفع يتمسح فيضيع أثره - دلوقتي زي أي حجز عليه فلوس.
--   (د) وسيلة الرد بتتحقق من القايمة (كانت أي نص: رد ٧٠٠ على وسيلة "xyz" من غير ما ينقص رصيد الفيزا/الكاش الحقيقي).
--   (هـ) calma_num بيقرا كمان ".5" و"1e3" (حقل الرقم في المتصفح بيكتبهم) - كانوا بيتقروا صفر فيتمسح تحصيل موجود.
-- --------------------------------------------------------------------------
create or replace function prevent_closed_shift_edit()
returns trigger language plpgsql security definer set search_path = public as $$
declare skip text[] := array['closed', 'closed_by', 'closed_at', 'updated_at'];
begin
  if old.closed = true then
    if new.closed = false then
      if not is_gm_or_reservations() then
        raise exception 'إعادة فتح شيفت مقفول من صلاحية المدير العام أو مدير الحجوزات بس';
      end if;
      -- إعادة الفتح لوحدها: أي تغيير في المحتوى معاها (صفوف/أرصدة/إجماليات) للمدير العام/الحسابات بس
      if not can_manage_financials() and (to_jsonb(new) - skip) is distinct from (to_jsonb(old) - skip) then
        raise exception 'إعادة فتح الشيفت المقفول مينفعش تتغيّر معاها بياناته - التعديل من المدير العام أو الحسابات';
      end if;
    else
      -- الشيفت فاضل مقفول وبيتم تعديل محتواه (تصحيح): المدير العام/الحسابات بس
      if not can_manage_financials() then
        raise exception 'لا يمكن تعديل شيفت مقفول إلا من المدير العام أو الحسابات';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function prevent_currency_change_when_paid()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.currency is distinct from old.currency and (coalesce(old.amount_paid, 0) <> 0 or coalesce(old.refunded_amount, 0) <> 0) then
    raise exception 'مينفعش تغيّر عملة حجز عليه فلوس متحصّلة أو مردودة (المدفوع بعملة الحجز الأصلية) - الغي الحجز واعمل حجز جديد بالعملة الصح';
  end if;
  return new;
end;
$$;
drop trigger if exists bookings_currency_guard on bookings;
create trigger bookings_currency_guard before update on bookings
  for each row execute function prevent_currency_change_when_paid();

create or replace function prevent_delete_booking_with_money()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(old.amount_paid, 0) > 0 or coalesce(old.refund_pending, false) or coalesce(old.refunded_amount, 0) > 0
     or coalesce((old.payment_details ->> 'onlinePaid')::boolean, false) then
    raise exception 'الحجز ده عليه حركة فلوس (مدفوع أو رد أو مدفوع أونلاين) - استخدم حالة "ملغي" بدل الحذف';
  end if;
  return old;
end;
$$;

-- (و) extras.cafeteriaPaid (اللي اتحصّل من كافيتيريا النزيل) بيتغيّر من record_booking_payment بس: حفظ الرسوم من بطاقة الغرفة
--     كان بيكتب extras من غيره فيمسحه، فالكافيتيريا تتحسب مرتين والدفعة الجاية تروح لصف الكافيتيريا تاني.
create or replace function keep_cafeteria_paid()
returns trigger language plpgsql as $$
declare old_cp jsonb; new_cp jsonb;
begin
  if coalesce(current_setting('calma.pay_rpc', true), '') = '1' or auth.uid() is null then return new; end if;
  old_cp := case when TG_OP = 'UPDATE' then old.extras -> 'cafeteriaPaid' else null end;
  new_cp := new.extras -> 'cafeteriaPaid';
  if new_cp is distinct from old_cp then
    new.extras := case when old_cp is null then new.extras - 'cafeteriaPaid' else jsonb_set(new.extras, '{cafeteriaPaid}', old_cp) end;
  end if;
  return new;
end;
$$;
drop trigger if exists bookings_keep_cafeteria_paid on bookings;
create trigger bookings_keep_cafeteria_paid before insert or update on bookings
  for each row execute function keep_cafeteria_paid();

-- --------------------------------------------------------------------------
-- 35) قفل الكتابة المباشرة على الفلوس: من أي جلسة مستخدم حقيقي (واجهة/API) amount_paid بيتغيّر من دوال التحصيل والرد بس،
--     ومبلغ/مدفوع/دفعات ديون كافيتيريا الاستاف من record_staff_cafeteria / settle_staff_cafeteria بس.
--     قبل كده موظف الشيفت كان يقدر (بالـ API مباشرة) يكتب amount_paid أو يمسح دين استاف من غير ما يتسجّل في اليومية.
--     محرر SQL/الصيانة (من غير مستخدم، auth.uid() فاضي) لسه مسموح عشان التصحيح اليدوي - و reconcile.sql بيكشف أي رقم مش مطابق.
-- --------------------------------------------------------------------------
create or replace function lock_booking_payments()
returns trigger language plpgsql as $$
begin
  if auth.uid() is null
     or coalesce(current_setting('calma.pay_rpc', true), '') = '1'
     or coalesce(current_setting('calma.refund_rpc', true), '') = '1' then
    return new;
  end if;
  if TG_OP = 'INSERT' then
    if coalesce(new.amount_paid, 0) <> 0 then
      raise exception 'المدفوع بيتسجّل بعد حفظ الحجز من خانة تسجيل دفعة (مش وقت الإنشاء مباشرة)';
    end if;
  elsif new.amount_paid is distinct from old.amount_paid then
    raise exception 'المدفوع على الحجز بيتغيّر من تسجيل دفعة أو قرار رد الفلوس بس - مش بتعديل مباشر';
  end if;
  return new;
end;
$$;
drop trigger if exists bookings_lock_payments on bookings;
create trigger bookings_lock_payments before insert or update on bookings
  for each row execute function lock_booking_payments();

create or replace function lock_staff_cafeteria_money()
returns trigger language plpgsql as $$
begin
  if auth.uid() is null or coalesce(current_setting('calma.staff_rpc', true), '') = '1' then
    return new;
  end if;
  if TG_OP = 'INSERT' then
    raise exception 'استهلاك الاستاف بيتسجّل من خانة كافيتيريا الاستاف في اليومية (مش بإضافة مباشرة)';
  elsif new.amount is distinct from old.amount
     or new.paid_amount is distinct from old.paid_amount
     or new.payments is distinct from old.payments then
    raise exception 'مبلغ ومدفوع ودفعات كافيتيريا الاستاف بتتغيّر من تسجيل الاستهلاك أو السداد بس';
  end if;
  return new;
end;
$$;
drop trigger if exists staff_cafeteria_lock_money on staff_cafeteria;
create trigger staff_cafeteria_lock_money before insert or update on staff_cafeteria
  for each row execute function lock_staff_cafeteria_money();

-- --------------------------------------------------------------------------
-- 36/37) نسخة مخطط قاعدة البيانات (37 = بعد جدول التدقيق money_audit) + إعادة تحميل cache الـ API.
--     الواجهة بتسأل calma_schema_version() وتحذّر بوضوح لو القاعدة لسه ماتحدّثتش (بدل "Could not find the function ...
--     in the schema cache" اللي بتظهر من غير ما حد يفهم إن المطلوب تشغيل schema.sql). كل مرة بتتضاف أقسام جديدة بنرفع الرقم هنا
--     وفي REQUIRED_SCHEMA_VERSION (src/data/schemaCheck.js).
-- --------------------------------------------------------------------------
-- (أ) يومية شيفت بتتعدّل: اللي مش صاحب الشيفت (موظف بيستلم الشيفت اللي بعده) يقدر يقفله بس - ما يمسحش صفوفه ولا يعدّل أرصدته.
--     قبل كده أي موظف يسجّل اختيار شيفت قريب كان يقدر يمسح تحصيل زميله وهو لسه مفتوح. واسم صاحب الشيفت ماينفعش يتغيّر من موظف.
create or replace function shift_records_claimant_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare me text; skip text[] := array['closed', 'closed_by', 'closed_at', 'updated_at', 'total_expenses', 'total_collections', 'closing_cash', 'cash_collections', 'by_method_currency', 'by_category', 'method_closing'];
begin
  if auth.uid() is null or is_gm_or_reservations() or can_manage_financials() then return new; end if;
  select username into me from profiles where id = auth.uid();
  if old.staff_username is distinct from me then
    if old.closed or not new.closed then
      raise exception 'مينفعش تعدّل يومية شيفت موظف تاني - تقدر تقفل الشيفت اللي قبلك بس لما تبدأ شيفتك';
    end if;
    if (to_jsonb(new) - skip) is distinct from (to_jsonb(old) - skip) then
      raise exception 'إقفال شيفت موظف تاني مايغيّرش صفوفه ولا أرصدته - الإقفال بس';
    end if;
  end if;
  if new.staff_name is distinct from old.staff_name then
    raise exception 'مينفعش تغيّر اسم صاحب الشيفت';
  end if;
  return new;
end;
$$;
drop trigger if exists shift_records_claimant_guard on shift_records;
create trigger shift_records_claimant_guard before update on shift_records
  for each row execute function shift_records_claimant_guard();

-- (ب) سجل تدقيق على مستوى القاعدة (مش بيعتمد على الواجهة): أي تغيير في المدفوع/حالة/رد الحجز، ديون كافيتيريا الاستاف،
--     دور أو تفعيل مستخدم، وإعادة فتح يومية مقفولة - بيتسجّل بـ trigger مهما كان الطريق (الواجهة، API مباشر، أو محرر SQL).
--     قبل كده سجل الحركة بتكتبه الواجهة، فعملية API مباشرة (مثلًا دالة الدفع) ماكانتش بتسيب أثر في السجل. الجدول للقراءة بس
--     (مدير عام/محاسبة/مدير حجوزات) ومفيش حد يقدر يعدّل أو يمسح منه من الـ API.
create table if not exists money_audit (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  actor text,                      -- username من الجلسة؛ فاضي لو العملية من محرر SQL/الصيانة
  tbl text not null,
  row_id text,
  action text not null,            -- insert / update / delete
  old_val jsonb,
  new_val jsonb
);
create index if not exists money_audit_ts_idx on money_audit (ts desc);
create index if not exists money_audit_row_idx on money_audit (tbl, row_id);
alter table money_audit enable row level security;
revoke all on money_audit from public, anon, authenticated;
grant select on money_audit to authenticated;
drop policy if exists "money audit select" on money_audit;
create policy "money audit select" on money_audit for select using (is_gm() or can_manage_financials() or is_gm_or_reservations());

create or replace function calma_audit() returns trigger language plpgsql security definer set search_path = public as $$
declare who text; o jsonb; n jsonb; keep text[]; rid text;
begin
  select username into who from profiles where id = auth.uid();
  keep := case TG_TABLE_NAME
    when 'bookings' then array['amount_paid','status','refund_pending','refund_decision','settled','currency','total_room','price_night','checkin','checkout','room']
    when 'staff_cafeteria' then array['amount','paid_amount','consumer_name','currency']
    when 'profiles' then array['username','role','active']
    else array['closed','closed_by','date','shift_key','staff_username','total_collections','closing_cash'] end;
  o := case when TG_OP = 'INSERT' then null else (select coalesce(jsonb_object_agg(k, v), '{}') from jsonb_each(to_jsonb(old)) e(k, v) where k = any(keep)) end;
  n := case when TG_OP = 'DELETE' then null else (select coalesce(jsonb_object_agg(k, v), '{}') from jsonb_each(to_jsonb(new)) e(k, v) where k = any(keep)) end;
  if TG_OP = 'UPDATE' and o is not distinct from n then return null; end if;
  if TG_OP = 'INSERT' and TG_TABLE_NAME in ('bookings', 'staff_cafeteria') and coalesce((n ->> case TG_TABLE_NAME when 'bookings' then 'amount_paid' else 'paid_amount' end)::numeric, 0) = 0 then return null; end if;
  rid := case when TG_OP = 'DELETE' then to_jsonb(old) ->> 'id' else to_jsonb(new) ->> 'id' end;
  insert into money_audit(actor, tbl, row_id, action, old_val, new_val) values (who, TG_TABLE_NAME, rid, lower(TG_OP), o, n);
  return null;
end;
$$;
revoke all on function calma_audit() from public, anon, authenticated;
drop trigger if exists bookings_audit on bookings;
create trigger bookings_audit after insert or update or delete on bookings for each row execute function calma_audit();
drop trigger if exists staff_cafeteria_audit on staff_cafeteria;
create trigger staff_cafeteria_audit after insert or update or delete on staff_cafeteria for each row execute function calma_audit();
drop trigger if exists profiles_audit on profiles;
create trigger profiles_audit after insert or update or delete on profiles for each row execute function calma_audit();
drop trigger if exists shift_records_audit on shift_records;
create trigger shift_records_audit after update on shift_records for each row
  when (old.closed is distinct from new.closed) execute function calma_audit();
drop trigger if exists shift_records_audit_del on shift_records;
create trigger shift_records_audit_del after delete on shift_records for each row execute function calma_audit();

-- --------------------------------------------------------------------------
-- 39) أكتوبر ٢٠٢٦ - طلبات تشغيل:
--   (أ) مفيش رد فلوس خالص: حجز اتلغى أو نزيل مشي بدري وكان دافع زيادة، الفلوس بتفضل في الفندق.
--       مفيش "طلب رد معلّق" بيتفتح تاني، والطلبات المعلّقة القديمة بتتقفل (من غير ما المدفوع يتغيّر).
--   (ب) دفعة بعملة غير عملة الحجز بسعر صرف وقت الدفع: الخزينة/اليومية بتسجّل المبلغ بعملته الفعلية،
--       والمتبقي على الحجز بيتخصم بالمقابل بعملة الحجز (المبلغ ÷ سعر الصرف). صف اليومية فيه fxCovered
--       (المقابل بعملة الحجز) و fxRate و fxBookingCurrency - reconcile.sql بيقارن بيهم.
--   (ج) نقل نزيل (الحجز كله بكل تفاصيله وفلوسه) لغرفة تانية فاضية في نفس التواريخ - الغرفة القديمة بتفضى.
--   (د) إلغاء اختيار شيفت (ومسح يوميته) مينفعش بعد ما معاد الشيفت يخلص.
--   (هـ) الحجز المدفوع أونلاين: المنصة دفعت سعر الغرفة اللي اتحجز بس. الرسوم والدخول المبكر وأي ليالي
--       تمديد اتضافت في الفندق بيتحصّلوا في الفندق. payment_details.onlineRoomAmount = سعر الغرفة اللي
--       اتدفع أونلاين (لو مش موجود = إجمالي الغرفة، زي الأول).
-- --------------------------------------------------------------------------

-- (أ)
create or replace function set_refund_pending_on_cancel()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('calma.refund_rpc', true), '') = '1' then return new; end if;
  if TG_OP = 'INSERT' then
    new.refund_pending := false; new.refund_decision := null;
    new.refunded_amount := null; new.refunded_by := null; new.refunded_at := null;
    return new;
  end if;
  -- سجل الردود القديمة (لو حصلت قبل كده) بيفضل زي ما هو، ومفيش طلب رد جديد
  new.refund_pending := false; new.refund_decision := old.refund_decision;
  new.refunded_amount := old.refunded_amount; new.refunded_by := old.refunded_by; new.refunded_at := old.refunded_at;
  return new;
end;
$$;
update bookings set refund_pending = false where refund_pending;
revoke all on function decide_booking_refund(uuid, text, timestamptz, text) from public, anon, authenticated;

-- (هـ)
create or replace function booking_hotel_total(b bookings)
returns numeric language sql immutable as $$
  select case when coalesce((b.payment_details->>'onlinePaid')::boolean, false)
              then greatest(0, booking_grand_total(b) - least(coalesce(b.total_room, 0),
                     case when b.payment_details ? 'onlineRoomAmount' then calma_num(b.payment_details ->> 'onlineRoomAmount') else coalesce(b.total_room, 0) end))
              else booking_grand_total(b) end;
$$;
-- تمديد حجز أونلاين قديم (من غير onlineRoomAmount): نثبّت اللي اتدفع أونلاين = إجمالي الغرفة قبل التمديد،
-- فالليالي الزيادة بتتحصّل في الفندق. بيشتغل بعد قيود الصلاحيات (الاسم zy) وقبل حساب الحالة (zz).
create or replace function bookings_online_cover()
returns trigger language plpgsql as $$
begin
  if coalesce((new.payment_details->>'onlinePaid')::boolean, false)
     and coalesce((old.payment_details->>'onlinePaid')::boolean, false)
     and not (new.payment_details ? 'onlineRoomAmount')
     and new.checkout > old.checkout then
    new.payment_details := new.payment_details || jsonb_build_object('onlineRoomAmount', coalesce(old.total_room, 0));
  end if;
  return new;
end;
$$;
drop trigger if exists bookings_zy_online_cover on bookings;
create trigger bookings_zy_online_cover before update on bookings
  for each row execute function bookings_online_cover();

-- (ب)
create or replace function record_booking_payment_fx(p_booking uuid, p_amount numeric, p_currency text, p_rate numeric, p_method text,
  p_details jsonb default '{}'::jsonb, p_expected timestamptz default null, p_note text default 'تحصيل')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b bookings%rowtype; sr shift_records; amt numeric := round(p_amount, 2); rate numeric := p_rate; due numeric; covered numeric; err text; det jsonb;
  cafe_out numeric; cafe numeric := 0; cafe_x numeric := 0; room_x numeric; v_extras jsonb; v_rows jsonb; v_caf jsonb; cur text := upper(btrim(coalesce(p_currency, '')));
  note text := left(coalesce(nullif(btrim(p_note), ''), 'تحصيل'), 60); base jsonb;
begin
  if not is_staff() then raise exception 'تسجيل التحصيل من صلاحية موظف الشيفت بس'; end if;
  if amt is null or amt <= 0 then raise exception 'اكتب مبلغ الدفعة (أكبر من صفر)'; end if;
  if cur !~ '^[A-Z]{3}$' then raise exception 'اختار عملة الدفعة'; end if;
  if rate is null or rate <= 0 or rate > 1000000 then raise exception 'اكتب سعر الصرف (أكبر من صفر)'; end if;
  if not calma_valid_method(p_method) then raise exception 'وسيلة الدفع غير صالحة'; end if;
  err := calma_details_err(p_method, coalesce(p_details, '{}'::jsonb));
  if err is not null then raise exception '%', err; end if;
  det := calma_clean_details(p_method, coalesce(p_details, '{}'::jsonb));
  select * into b from bookings where id = p_booking for update;
  if not found then raise exception 'الحجز مش موجود'; end if;
  if b.status = 'ملغي' then raise exception 'الحجز ملغي - مينفعش يتحصّل عليه'; end if;
  if cur = b.currency then raise exception 'الدفعة بنفس عملة الحجز - سجّلها من غير سعر صرف'; end if;
  if p_expected is not null and b.updated_at is distinct from p_expected then
    raise exception 'الحجز اتغيّر من حد تاني - حدّث الصفحة وجرّب تاني';
  end if;
  due := greatest(0, booking_hotel_total(b) - coalesce(b.amount_paid, 0));
  covered := round(amt / rate, 2);
  if covered > due and covered - due <= 0.01 then covered := due; end if;      -- كسور التقريب
  if covered <= 0 then raise exception 'المبلغ صغير جدًا بالنسبة لسعر الصرف'; end if;
  if covered > due then raise exception 'المبلغ (= % %) أكبر من المتبقي على النزيل (% %)', trim_scale(covered), b.currency, trim_scale(due), b.currency; end if;
  sr := calma_my_open_shift();
  cafe_out := greatest(0, calma_num(b.extras ->> 'cafeteria') - calma_num(b.extras ->> 'cafeteriaPaid'));
  cafe := least(covered, cafe_out);
  cafe_x := case when cafe > 0 then round(amt * cafe / covered, 2) else 0 end;
  room_x := amt - cafe_x;
  v_extras := case when cafe > 0 then jsonb_set(b.extras, '{cafeteriaPaid}', to_jsonb(calma_num(b.extras ->> 'cafeteriaPaid') + cafe)) else b.extras end;
  perform set_config('calma.pay_rpc', '1', true);
  update bookings set amount_paid = coalesce(amount_paid, 0) + covered, payment_method = p_method, extras = v_extras where id = p_booking;
  perform set_config('calma.pay_rpc', '', true);
  base := jsonb_build_object('expenseDesc', '', 'expenseAmt', '', 'expenseCategory', 'أخرى', 'expenseCurrency', 'EGP', 'collectionMethod', p_method,
    'collectionCurrency', cur, 'paymentDetails', det, 'notes', '', 'fxRate', rate, 'fxBookingCurrency', b.currency);
  v_rows := coalesce(sr.rows, '[]'::jsonb);
  if room_x > 0 then
    v_rows := v_rows || jsonb_build_array(base || jsonb_build_object('room', b.room, 'bookingId', b.id, 'collectionAmt', room_x, 'fxCovered', covered - cafe,
      'collectionDesc', note || coalesce(' - ' || nullif(b.guest_name, ''), '') || ' (+' || trim_scale(room_x) || ' ' || cur || ' = ' || trim_scale(covered - cafe) || ' ' || b.currency || ' بسعر ' || trim_scale(rate) || ')'));
  end if;
  v_caf := coalesce(sr.cafeteria_rows, '[]'::jsonb);
  if cafe > 0 then
    v_caf := v_caf || jsonb_build_array(base || jsonb_build_object('room', 'كافيتيريا', 'kind', 'guest', 'who', coalesce(b.guest_name, ''), 'bookingId', b.id, 'guestRoom', b.room,
      'collectionAmt', cafe_x, 'fxCovered', cafe,
      'collectionDesc', 'خدمة كافيتيريا' || coalesce(' - ' || nullif(b.guest_name, ''), '') || ' (+' || trim_scale(cafe_x) || ' ' || cur || ' = ' || trim_scale(cafe) || ' ' || b.currency || ')'));
  end if;
  update shift_records set rows = v_rows, cafeteria_rows = v_caf,
    booking_collections = coalesce(booking_collections, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text, 'bookingId', b.id))
    where date = sr.date and shift_key = sr.shift_key;
  return jsonb_build_object('amount', amt, 'currency', cur, 'covered', covered, 'bookingCurrency', b.currency, 'rate', rate, 'cafeteria', cafe,
    'left', due - covered, 'method', p_method, 'details', det, 'shiftDate', sr.date, 'shiftKey', sr.shift_key);
end;
$$;
revoke all on function record_booking_payment_fx(uuid, numeric, text, numeric, text, jsonb, timestamptz, text) from public, anon;
grant execute on function record_booking_payment_fx(uuid, numeric, text, numeric, text, jsonb, timestamptz, text) to authenticated;

-- (ج) نقل النزيل: اتنقلت لقسم ٤١ (آخر الملف) عشان بتعتمد على room_from.


-- (د) نهاية معاد الشيفت (بتوقيت القاهرة): الصباحي ٨ص-٤م، المسائي ٤م-١٢ص، الليلي ١٢ص-٨ص (بعد يوم الشيفت)
create or replace function calma_shift_end(p_date date, p_key text) returns timestamptz language sql stable as $$
  select ((p_date + case p_key when 'morning' then interval '16 hours' when 'evening' then interval '24 hours' else interval '32 hours' end)::timestamp
          at time zone 'Africa/Cairo')
$$;
create or replace function prevent_past_shift_unclaim()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and now() >= calma_shift_end(old.date, old.shift_key) then
    raise exception 'معاد الشيفت ده خلص - مينفعش يتلغي اختياره ولا تتمسح يوميته';
  end if;
  return old;
end;
$$;
drop trigger if exists shift_claims_no_past_unclaim on shift_claims;
create trigger shift_claims_no_past_unclaim before delete on shift_claims
  for each row execute function prevent_past_shift_unclaim();
drop trigger if exists shift_records_no_past_delete on shift_records;
create trigger shift_records_no_past_delete before delete on shift_records
  for each row execute function prevent_past_shift_unclaim();

-- --------------------------------------------------------------------------
-- 40) أكتوبر ٢٠٢٦ - كل حاجة بعملتها (من غير سعر صرف):
--   * خدمة بعملة غير عملة الحجز (مثلاً غسيل 200 جنيه على حجز بالدولار) بتتسجّل في other_charges بعملتها:
--       {"EGP": {"laundry":200, "cafeteria":0, "tours":0, "pickup":0, "cafeteriaPaid":0}}
--   * الدفع بالعملة دي بيتسجّل في other_paid بعملتها {"EGP": 200} - من record_booking_payment_other بس.
--   * المتبقي بيبان لكل عملة لوحدها، والحالة "مدفوع بالكامل" لازم كل العملات تتغطّى.
--   * دفع بسعر صرف (record_booking_payment_fx من قسم ٣٩) اتقفل - مفيش تحويل بين العملات.
-- --------------------------------------------------------------------------
alter table bookings add column if not exists other_charges jsonb not null default '{}'::jsonb;
alter table bookings add column if not exists other_paid jsonb not null default '{}'::jsonb;

revoke execute on function record_booking_payment_fx(uuid, numeric, text, numeric, text, jsonb, timestamptz, text) from authenticated, public, anon;

create or replace function calma_other_total(c jsonb) returns numeric language sql immutable as $$
  select calma_num(c ->> 'laundry') + calma_num(c ->> 'cafeteria') + calma_num(c ->> 'tours') + calma_num(c ->> 'pickup')
$$;

-- المتبقي لكل عملة تانية: {"EGP": 150} (العملات اللي مفيهاش متبقي مش بتظهر)
create or replace function booking_other_due(b bookings) returns jsonb language sql immutable as $$
  select coalesce(jsonb_object_agg(k, d), '{}'::jsonb) from (
    select k, calma_other_total(coalesce(b.other_charges -> k, '{}'::jsonb)) - calma_num(b.other_paid ->> k) as d
    from (select jsonb_object_keys(coalesce(b.other_charges, '{}'::jsonb)) k) x
  ) y where d > 0.004
$$;

create or replace function bookings_other_money_guard()
returns trigger language plpgsql as $$
declare k text; v jsonb; f text; old_c jsonb; maint boolean := auth.uid() is null; pay boolean := coalesce(current_setting('calma.pay_rpc', true), '') = '1';
begin
  if jsonb_typeof(coalesce(new.other_charges, '{}'::jsonb)) <> 'object' then new.other_charges := '{}'::jsonb; end if;
  if jsonb_typeof(coalesce(new.other_paid, '{}'::jsonb)) <> 'object' then raise exception 'other_paid غير صالح'; end if;
  -- المدفوع بالعملات التانية بيتغيّر من دالة التحصيل بس (زي amount_paid)
  if not maint and not pay then
    if TG_OP = 'INSERT' and new.other_paid <> '{}'::jsonb then raise exception 'المدفوع بيتسجّل بعد حفظ الحجز من خانة تسجيل دفعة'; end if;
    if TG_OP = 'UPDATE' and new.other_paid is distinct from old.other_paid then
      raise exception 'المدفوع على الحجز بيتغيّر من تسجيل دفعة بس - مش بتعديل مباشر';
    end if;
  end if;
  for k, v in select * from jsonb_each(new.other_charges) loop
    if k !~ '^[A-Z]{3}$' or k not in ('EGP', 'USD', 'EUR', 'SAR', 'GBP') then raise exception 'عملة الخدمة غير صالحة: %', k; end if;
    if k = new.currency then raise exception 'الخدمة بعملة الحجز (%) بتتسجّل في الخدمات العادية', k; end if;
    if jsonb_typeof(v) <> 'object' then raise exception 'خدمات العملة % غير صالحة', k; end if;
    for f in select jsonb_object_keys(v) loop
      if f not in ('laundry', 'cafeteria', 'tours', 'pickup', 'cafeteriaPaid') then raise exception 'نوع خدمة غير معروف: %', f; end if;
      if calma_num(v ->> f) < 0 or calma_num(v ->> f) > 10000000 then raise exception 'مبلغ الخدمة لازم يكون صفر أو أكتر'; end if;
    end loop;
  end loop;
  for k, v in select * from jsonb_each(new.other_paid) loop
    if k not in ('EGP', 'USD', 'EUR', 'SAR', 'GBP') or jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric < 0 then raise exception 'المدفوع بعملة % غير صالح', k; end if;
  end loop;
  -- اللي اتحصّل من كافيتيريا النزيل بكل عملة بيتغيّر من دالة التحصيل بس (حفظ الخدمات من الشاشة مابيمسحوش)،
  -- وعملة عليها مدفوع مابتختفيش من الخدمات
  if not maint and not pay and TG_OP = 'UPDATE' then
    for k, v in select * from jsonb_each(coalesce(old.other_charges, '{}'::jsonb)) loop
      old_c := coalesce(new.other_charges -> k, '{"laundry":0,"cafeteria":0,"tours":0,"pickup":0}'::jsonb);
      if v ? 'cafeteriaPaid' then old_c := jsonb_set(old_c, '{cafeteriaPaid}', v -> 'cafeteriaPaid'); else old_c := old_c - 'cafeteriaPaid'; end if;
      new.other_charges := jsonb_set(new.other_charges, array[k], old_c);
    end loop;
    for k in select jsonb_object_keys(new.other_charges) loop
      if not (coalesce(old.other_charges, '{}'::jsonb) ? k) and (new.other_charges -> k) ? 'cafeteriaPaid' then
        new.other_charges := jsonb_set(new.other_charges, array[k], (new.other_charges -> k) - 'cafeteriaPaid');
      end if;
    end loop;
  end if;
  return new;
end;
$$;
drop trigger if exists bookings_other_money_guard on bookings;
create trigger bookings_other_money_guard before insert or update on bookings
  for each row execute function bookings_other_money_guard();

-- الحالة "مدفوع بالكامل": عملة الحجز + كل عملة تانية عليها خدمات
create or replace function bookings_auto_settled()
returns trigger language plpgsql as $$
begin
  new.settled := new.status is distinct from 'ملغي' and coalesce(new.amount_paid, 0) >= booking_hotel_total(new)
                 and booking_other_due(new) = '{}'::jsonb;
  return new;
end;
$$;

-- الحجز اللي عليه مدفوع بعملة تانية مايتمسحش (زي أي حجز عليه فلوس)
create or replace function bookings_no_delete_other_paid()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from jsonb_each(coalesce(old.other_paid, '{}'::jsonb)) e where (e.value #>> '{}')::numeric > 0) then
    raise exception 'الحجز ده عليه حركة فلوس (مدفوع) - استخدم حالة "ملغي" بدل الحذف';
  end if;
  return old;
end;
$$;
drop trigger if exists bookings_no_delete_other_paid on bookings;
create trigger bookings_no_delete_other_paid before delete on bookings
  for each row execute function bookings_no_delete_other_paid();

-- دفعة بعملة غير عملة الحجز: بتسدّد خدمات العملة دي بس (كافيتيريا النزيل الأول)، ومفيش أي تحويل
create or replace function record_booking_payment_other(p_booking uuid, p_amount numeric, p_currency text, p_method text,
  p_details jsonb default '{}'::jsonb, p_expected timestamptz default null, p_note text default 'تحصيل')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b bookings%rowtype; sr shift_records; amt numeric := round(p_amount, 2); cur text := upper(btrim(coalesce(p_currency, ''))); due numeric; err text; det jsonb;
  c jsonb; cafe_out numeric; cafe numeric := 0; v_rows jsonb; v_caf jsonb; note text := left(coalesce(nullif(btrim(p_note), ''), 'تحصيل'), 60);
begin
  if not is_staff() then raise exception 'تسجيل التحصيل من صلاحية موظف الشيفت بس'; end if;
  if amt is null or amt <= 0 then raise exception 'اكتب مبلغ الدفعة (أكبر من صفر)'; end if;
  if cur not in ('EGP', 'USD', 'EUR', 'SAR', 'GBP') then raise exception 'اختار عملة الدفعة'; end if;
  if not calma_valid_method(p_method) then raise exception 'وسيلة الدفع غير صالحة'; end if;
  err := calma_details_err(p_method, coalesce(p_details, '{}'::jsonb));
  if err is not null then raise exception '%', err; end if;
  det := calma_clean_details(p_method, coalesce(p_details, '{}'::jsonb));
  select * into b from bookings where id = p_booking for update;
  if not found then raise exception 'الحجز مش موجود'; end if;
  if b.status = 'ملغي' then raise exception 'الحجز ملغي - مينفعش يتحصّل عليه'; end if;
  if cur = b.currency then raise exception 'دي عملة الحجز - سجّلها من الدفع العادي'; end if;
  if p_expected is not null and b.updated_at is distinct from p_expected then
    raise exception 'الحجز اتغيّر من حد تاني - حدّث الصفحة وجرّب تاني';
  end if;
  c := coalesce(b.other_charges -> cur, '{}'::jsonb);
  due := greatest(0, calma_other_total(c) - calma_num(b.other_paid ->> cur));
  if due <= 0 then raise exception 'مفيش متبقي على النزيل بالـ %', cur; end if;
  if amt > due then raise exception 'المبلغ أكبر من المتبقي على النزيل بالـ % (%)', cur, trim_scale(due); end if;
  sr := calma_my_open_shift();
  cafe_out := greatest(0, calma_num(c ->> 'cafeteria') - calma_num(c ->> 'cafeteriaPaid'));
  cafe := least(amt, cafe_out);
  if cafe > 0 then c := jsonb_set(c, '{cafeteriaPaid}', to_jsonb(calma_num(c ->> 'cafeteriaPaid') + cafe)); end if;
  perform set_config('calma.pay_rpc', '1', true);
  update bookings set other_paid = jsonb_set(coalesce(other_paid, '{}'::jsonb), array[cur], to_jsonb(calma_num(other_paid ->> cur) + amt)),
                      other_charges = jsonb_set(other_charges, array[cur], c)
    where id = p_booking;
  perform set_config('calma.pay_rpc', '', true);
  v_rows := coalesce(sr.rows, '[]'::jsonb);
  if amt - cafe > 0 then
    v_rows := calma_apply_room_collection(v_rows, b.room, b.id, p_method, cur, det, amt - cafe,
      note || coalesce(' - ' || nullif(b.guest_name, ''), '') || ' (+' || trim_scale(amt - cafe) || ' ' || cur || ')');
  end if;
  v_caf := coalesce(sr.cafeteria_rows, '[]'::jsonb);
  if cafe > 0 then
    v_caf := calma_apply_cafe_collection(v_caf, 'guest', b.id::text, b.guest_name, b.room, p_method, cur, det, cafe,
      'خدمة كافيتيريا' || coalesce(' - ' || nullif(b.guest_name, ''), '') || ' (+' || trim_scale(cafe) || ' ' || cur || ')');
  end if;
  update shift_records set rows = v_rows, cafeteria_rows = v_caf,
    booking_collections = coalesce(booking_collections, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text, 'bookingId', b.id))
    where date = sr.date and shift_key = sr.shift_key;
  return jsonb_build_object('amount', amt, 'currency', cur, 'cafeteria', cafe, 'left', due - amt, 'method', p_method, 'details', det, 'shiftDate', sr.date, 'shiftKey', sr.shift_key);
end;
$$;
revoke all on function record_booking_payment_other(uuid, numeric, text, text, jsonb, timestamptz, text) from public, anon;
grant execute on function record_booking_payment_other(uuid, numeric, text, text, jsonb, timestamptz, text) to authenticated;


-- --------------------------------------------------------------------------
-- 41) أكتوبر ٢٠٢٦ - (أ) نقل النزيل بيعتبر الغرفة الجديدة محجوزة من يوم النقل بس (مش من أول الإقامة)،
--        عشان غرفة نزيل خرج النهارده (أو قبل كده) تظهر متاحة للنقل.
--     (ب) تعديل عملة الحجز (لو الموظف اتلغبط): بتتغيّر على الحجز وفي كل صفوف اليومية المفتوحة بتاعته مع بعض.
--     (ج) كود الفرد بتاع حجز ملغي يرجع يتستخدم تاني لنزيل تاني (نفس الشهر).
-- --------------------------------------------------------------------------
alter table bookings add column if not exists room_from date;
alter table bookings add column if not exists occ_range daterange
  generated always as (daterange(least(coalesce(room_from, checkin), checkout), checkout, '[)')) stored;

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'bookings_no_overlap' and conrelid = 'bookings'::regclass
             and pg_get_constraintdef(oid) not like '%occ_range%') then
    alter table bookings drop constraint bookings_no_overlap;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bookings_no_overlap' and conrelid = 'bookings'::regclass) then
    alter table bookings add constraint bookings_no_overlap
      exclude using gist (room with =, occ_range with &&)
      where (status <> 'ملغي');
  end if;
exception when others then
  raise notice 'تعذر تحديث قيد منع تعارض الحجوزات: %', sqlerrm;
end $$;

-- room_from بيتحدد من نقل النزيل بس (مش من تعديل مباشر)، وأي تغيير مباشر للغرفة بيرجّع الحجز يحجز الغرفة من أول إقامته
create or replace function bookings_room_from_guard()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    if auth.uid() is not null then new.room_from := null; end if;
    return new;
  end if;
  if coalesce(current_setting('calma.move_rpc', true), '') = '1' or auth.uid() is null then return new; end if;
  new.room_from := old.room_from;
  if new.room is distinct from old.room or new.checkin is distinct from old.checkin then new.room_from := null; end if;
  return new;
end;
$$;
drop trigger if exists bookings_room_from_guard on bookings;
create trigger bookings_room_from_guard before insert or update on bookings
  for each row execute function bookings_room_from_guard();

create or replace function move_booking_room(p_booking uuid, p_room int, p_expected timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b bookings%rowtype; clash bookings%rowtype; old_room int; today date := hotel_today(); new_from date;
begin
  if not (is_staff() or is_reservations_manager()) then raise exception 'نقل النزيل من صلاحية موظف الشيفت أو مدير الحجوزات'; end if;     -- المدير العام مابينقلش
  if is_staff() then perform calma_my_open_shift(); end if;          -- الموظف لازم شيفته مفتوح
  select * into b from bookings where id = p_booking for update;
  if not found then raise exception 'الحجز مش موجود'; end if;
  if p_expected is not null and b.updated_at is distinct from p_expected then raise exception 'الحجز اتغيّر من حد تاني - حدّث الصفحة وجرّب تاني'; end if;
  if b.status = 'ملغي' then raise exception 'الحجز ملغي'; end if;
  if b.checkout <= today or b.status = 'تم تسجيل الخروج' then raise exception 'الحجز خلص - مفيش نقل'; end if;
  if not exists (select 1 from rooms where number = p_room) then raise exception 'الغرفة دي مش موجودة'; end if;
  if p_room = b.room then raise exception 'النزيل في الغرفة دي أصلًا'; end if;
  -- الغرفة الجديدة مطلوبة من يوم النقل (أو أول الإقامة لو لسه ماجاش) لحد الخروج
  new_from := case when b.checkin < today then today else null end;
  select * into clash from bookings x where x.room = p_room and x.id <> b.id and x.status <> 'ملغي'
    and x.occ_range && daterange(coalesce(new_from, b.checkin), b.checkout, '[)')
    order by x.checkin limit 1;
  if found then
    raise exception 'الغرفة % مش فاضية في نفس التواريخ - فيها % (% → %)', p_room, clash.guest_name, clash.checkin, clash.checkout;
  end if;
  old_room := b.room;
  perform set_config('calma.move_rpc', '1', true);
  update bookings set room = p_room, room_from = new_from where id = p_booking;
  perform set_config('calma.move_rpc', '', true);
  return jsonb_build_object('from', old_room, 'to', p_room);
end;
$$;
revoke all on function move_booking_room(uuid, int, timestamptz) from public, anon;
grant execute on function move_booking_room(uuid, int, timestamptz) to authenticated;

-- (ب) تعديل عملة الحجز: نفس الأرقام بس العملة اللي اتكتبت غلط. بتتغيّر على الحجز وفي صفوف اليومية (غرفة + كافيتيريا) بتاعته.
--     ممنوعة لو فيه تحصيل بتاعه في شيفت اتقفل (أرقام الشيفت المقفول متثبّتة) أو لو فيه خدمات/مدفوع منفصل بالعملة الجديدة.
create or replace function change_booking_currency(p_booking uuid, p_currency text, p_expected timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b bookings%rowtype; cur text := upper(btrim(coalesce(p_currency, ''))); old_cur text; sr record; n int := 0;
  new_rows jsonb; new_caf jsonb; el jsonb; i int; oc jsonb;
  mine boolean := false;
begin
  if not (is_staff() or is_reservations_manager()) then raise exception 'تعديل عملة الحجز من صلاحية موظف الشيفت أو مدير الحجوزات'; end if;
  if cur not in ('EGP', 'USD', 'EUR', 'SAR', 'GBP') then raise exception 'اختار عملة صالحة'; end if;
  if is_staff() then perform calma_my_open_shift(); end if;
  select * into b from bookings where id = p_booking for update;
  if not found then raise exception 'الحجز مش موجود'; end if;
  if p_expected is not null and b.updated_at is distinct from p_expected then raise exception 'الحجز اتغيّر من حد تاني - حدّث الصفحة وجرّب تاني'; end if;
  if b.status = 'ملغي' then raise exception 'الحجز ملغي'; end if;
  old_cur := b.currency;
  if cur = old_cur then raise exception 'دي عملة الحجز أصلًا'; end if;
  oc := coalesce(b.other_charges, '{}'::jsonb);
  if coalesce(calma_other_total(oc -> cur), 0) > 0 or calma_num(oc #>> array[cur, 'cafeteriaPaid']) > 0 or calma_num(b.other_paid ->> cur) > 0 then
    raise exception 'على الحجز خدمات أو مدفوع منفصل بعملة % - اتعامل معاهم الأول وبعدين غيّر العملة', cur;
  end if;
  -- أي تحصيل/رد بالعملة القديمة بتاع الحجز ده في شيفت مقفول = ممنوع (الشيفت المقفول أرقامه متثبّتة)
  if exists (
    select 1 from shift_records s, jsonb_array_elements(coalesce(s.rows, '[]'::jsonb) || coalesce(s.cafeteria_rows, '[]'::jsonb)) e
    where s.closed = true and e ->> 'bookingId' = b.id::text and e ->> 'collectionCurrency' = old_cur
  ) then
    raise exception 'فيه تحصيل على الحجز ده في شيفت اتقفل - تعديل العملة لازم يتعمل من الحسابات أو المدير العام';
  end if;
  for sr in select s.date, s.shift_key, s.rows, s.cafeteria_rows from shift_records s
    where s.closed = false and exists (
      select 1 from jsonb_array_elements(coalesce(s.rows, '[]'::jsonb) || coalesce(s.cafeteria_rows, '[]'::jsonb)) e
      where e ->> 'bookingId' = b.id::text and e ->> 'collectionCurrency' = old_cur)
    for update
  loop
    new_rows := '[]'::jsonb; new_caf := '[]'::jsonb;
    for i in 0 .. coalesce(jsonb_array_length(sr.rows), 0) - 1 loop
      el := sr.rows -> i;
      if el ->> 'bookingId' = b.id::text and el ->> 'collectionCurrency' = old_cur then
        el := el || jsonb_build_object('collectionCurrency', cur, 'collectionDesc', replace(coalesce(el ->> 'collectionDesc', ''), ' ' || old_cur || ')', ' ' || cur || ')'));
        n := n + 1;
      end if;
      new_rows := new_rows || jsonb_build_array(el);
    end loop;
    for i in 0 .. coalesce(jsonb_array_length(sr.cafeteria_rows), 0) - 1 loop
      el := sr.cafeteria_rows -> i;
      if el ->> 'bookingId' = b.id::text and el ->> 'collectionCurrency' = old_cur then
        el := el || jsonb_build_object('collectionCurrency', cur, 'collectionDesc', replace(coalesce(el ->> 'collectionDesc', ''), ' ' || old_cur || ')', ' ' || cur || ')'));
        n := n + 1;
      end if;
      new_caf := new_caf || jsonb_build_array(el);
    end loop;
    update shift_records set rows = new_rows, cafeteria_rows = new_caf where date = sr.date and shift_key = sr.shift_key;
  end loop;
  perform set_config('calma.currency_rpc', '1', true);
  perform set_config('calma.pay_rpc', '1', true);
  update bookings set currency = cur, other_charges = oc - cur where id = p_booking;
  perform set_config('calma.currency_rpc', '', true);
  perform set_config('calma.pay_rpc', '', true);
  return jsonb_build_object('from', old_cur, 'to', cur, 'rows', n);
end;
$$;
revoke all on function change_booking_currency(uuid, text, timestamptz) from public, anon;
grant execute on function change_booking_currency(uuid, text, timestamptz) to authenticated;

-- (ب) الحارس القديم لتغيير العملة: مسموح بس من دالة change_booking_currency
create or replace function prevent_currency_change_when_paid()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.currency is distinct from old.currency and (coalesce(old.amount_paid, 0) <> 0 or coalesce(old.refunded_amount, 0) <> 0)
     and coalesce(current_setting('calma.currency_rpc', true), '') <> '1' then
    raise exception 'عملة حجز عليه فلوس بتتغيّر من زرار "تعديل عملة الحجز" في لوحة الغرف بس';
  end if;
  return new;
end;
$$;

-- (ج) كود الفرد بتاع حجز ملغي بيرجع متاح، وإلغاء/استرجاع الحجز بيتفحص الكود من جديد
create or replace function bookings_sync_guests()
returns trigger language plpgsql security definer set search_path = public as $$
declare codes jsonb; n int; i int; c text; seen text[] := '{}'; ym_v text; clash record;
begin
  codes := coalesce(new.guest_codes, '[]'::jsonb);
  n := least(greatest(coalesce(new.pax, 1), 1), jsonb_array_length(codes));
  ym_v := to_char(new.checkin, 'YYMM');
  delete from booking_guests where booking_id = new.id;
  for i in 0 .. n - 1 loop
    if jsonb_typeof(codes -> i) is distinct from 'string' then continue; end if;
    c := btrim(codes ->> i);
    if c = '' then continue; end if;
    if char_length(c) > 40 then raise exception 'كود الفرد % أطول من ٤٠ حرف', i + 1; end if;
    if upper(c) = any(seen) then raise exception 'الكود % مكرر جوه نفس الحجز', c; end if;
    seen := seen || upper(c);
    if new.status is distinct from 'ملغي' then
      select g.room, b.guest_name into clash from booking_guests g join bookings b on b.id = g.booking_id
        where g.ym = ym_v and upper(g.code) = upper(c) and g.booking_id <> new.id and b.status is distinct from 'ملغي' limit 1;
      if found then
        raise exception 'الكود % مستخدم الشهر ده بالفعل (غرفة % - %) - اختار كود تاني أو استنى الشهر الجاي', c, clash.room, clash.guest_name;
      end if;
    end if;
    insert into booking_guests(booking_id, room, seq, code, ym) values (new.id, new.room, i + 1, c, ym_v);
  end loop;
  return null;
end;
$$;
drop trigger if exists bookings_guests_sync on bookings;
create trigger bookings_guests_sync after insert or update of pax, room, guest_codes, checkin, status on bookings
  for each row execute function bookings_sync_guests();

create or replace function calma_schema_version() returns int language sql immutable as $$ select 41 $$;
revoke all on function calma_schema_version() from public, anon;
grant execute on function calma_schema_version() to authenticated;
-- PostgREST بيحمّل الدوال الجديدة في الـ cache؛ من غير ده ممكن تفضل "مش موجودة" لحد ما الخدمة تتعمل لها restart
notify pgrst, 'reload schema';
