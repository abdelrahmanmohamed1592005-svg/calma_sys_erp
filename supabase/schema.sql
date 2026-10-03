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
