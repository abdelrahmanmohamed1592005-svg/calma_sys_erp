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
  type text not null,
  price numeric not null default 0,
  currency text not null default 'USD',
  capacity integer not null default 2,
  beds text default ''
);

alter table rooms enable row level security;
drop policy if exists "rooms select" on rooms;
create policy "rooms select" on rooms for select using (auth.uid() is not null);
drop policy if exists "rooms write" on rooms;
create policy "rooms write" on rooms for all using (is_active_user()) with check (is_active_user());

insert into rooms (number, type, price, currency, capacity, beds) values
  (601, 'غرفة مزدوجة - إطلالة داخلية', 50, 'USD', 2, 'سرير مزدوج'),
  (602, 'غرفة بسرير كينج - إطلالة داخلية', 50, 'USD', 2, 'سرير كينج'),
  (603, 'غرفة عائلية (٣ أسرة)', 80, 'USD', 4, '٣ أسرة مفردة'),
  (604, 'غرفة مزدوجة - بلكونة فرنسية', 70, 'USD', 2, 'سرير مزدوج'),
  (605, 'غرفة مزدوجة - بلكونة', 70, 'USD', 2, 'سرير مزدوج'),
  (606, 'غرفة مزدوجة', 60, 'USD', 2, 'سرير مزدوج'),
  (607, 'غرفة مزدوجة', 60, 'USD', 2, 'سرير مزدوج'),
  (608, 'غرفة مزدوجة', 60, 'USD', 2, 'سرير مزدوج'),
  (609, 'غرفة مزدوجة', 60, 'USD', 2, 'سرير مزدوج'),
  (610, 'غرفة مزدوجة', 60, 'USD', 2, 'سرير مزدوج'),
  (611, 'غرفة مزدوجة', 60, 'USD', 2, 'سرير مزدوج'),
  (612, 'غرفة مزدوجة', 60, 'USD', 2, 'سرير مزدوج'),
  (613, 'غرفة مزدوجة', 60, 'USD', 2, 'سرير مزدوج'),
  (614, 'غرفة مزدوجة', 60, 'USD', 2, 'سرير مزدوج'),
  (615, 'غرفة مزدوجة', 60, 'USD', 2, 'سرير مزدوج'),
  (616, 'غرفة مزدوجة', 60, 'USD', 2, 'سرير مزدوج')
on conflict (number) do nothing;

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
-- editBookings / canApproveBookings / editRoomConfig = true في كود التطبيق
-- (constants.js) - مش gm ولا accounts زي ما كنت مفتكر أول مرة
create or replace function is_reservations_manager()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'reservations' and active = true
  );
$$;

grant execute on function profiles_exist() to anon, authenticated;
grant execute on function is_gm() to authenticated;
grant execute on function is_active_user() to authenticated;
grant execute on function can_manage_financials() to authenticated;
grant execute on function is_reservations_manager() to authenticated;

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

do $$ begin
  alter table bookings add constraint bookings_currency_chk check (currency in ('USD','EGP'));
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

do $$ begin
  alter table rooms add constraint rooms_price_nonneg check (price >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table rooms add constraint rooms_capacity_positive check (capacity > 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table rooms add constraint rooms_currency_chk check (currency in ('USD','EGP'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table shift_records add constraint shift_handover_shape check (
    handover ?& array['EGP','USD']
  );
exception when duplicate_object then null; end $$;

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

-- الغرف: التسعير وإضافة/حذف الغرف لمدير الحجوزات (اللي عنده editRoomConfig
-- فعليًا في التطبيق)، مش المدير العام. عرضها متاح للجميع.
drop policy if exists "rooms write" on rooms;
create policy "rooms write" on rooms for all using (is_reservations_manager()) with check (is_reservations_manager());

-- الحجوزات: الإضافة والتعديل لأي موظف نشط، لكن الحذف الفعلي لمدير الحجوزات بس
-- (ده اللي عنده editBookings=true فعليًا في التطبيق)
drop policy if exists "bookings write" on bookings;
drop policy if exists "bookings insert" on bookings;
drop policy if exists "bookings update" on bookings;
drop policy if exists "bookings delete" on bookings;
create policy "bookings insert" on bookings for insert with check (is_active_user());
create policy "bookings update" on bookings for update using (is_active_user()) with check (is_active_user());
create policy "bookings delete" on bookings for delete using (is_reservations_manager());

-- الشيفتات: نفس المنطق - التعديل لأي نشط (والتريجر بيمنع تعديل المقفول)، الحذف للمدير/الحسابات
drop policy if exists "shifts write" on shift_records;
drop policy if exists "shifts insert" on shift_records;
drop policy if exists "shifts update" on shift_records;
drop policy if exists "shifts delete" on shift_records;
create policy "shifts insert" on shift_records for insert with check (is_active_user());
create policy "shifts update" on shift_records for update using (is_active_user()) with check (is_active_user());
create policy "shifts delete" on shift_records for delete using (can_manage_financials());

-- اختيار الشيفتات: أي نشط يقدر يعمل claim، بس الحذف بس لصاحبه أو المدير العام
drop policy if exists "claims write" on shift_claims;
drop policy if exists "claims insert" on shift_claims;
drop policy if exists "claims update" on shift_claims;
drop policy if exists "claims delete" on shift_claims;
create policy "claims insert" on shift_claims for insert with check (is_active_user());
create policy "claims update" on shift_claims for update using (is_gm()) with check (is_gm());
create policy "claims delete" on shift_claims for delete using (
  is_gm() or username = (select username from profiles where id = auth.uid())
);

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
