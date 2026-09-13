-- ============================================================================
-- Calma Hotel System - قاعدة البيانات (النسخة المُطبّعة الكاملة)
-- شغّل الملف ده كامل مرة واحدة في Supabase SQL Editor - آمن تشغّله أكتر من مرة
-- ============================================================================

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
-- خطوة يدوية مهمة بعد تشغيل السكريبت ده:
-- Authentication -> Providers -> Email -> شيّل علامة "Confirm email"
-- ============================================================================
