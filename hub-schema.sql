-- ============================================================================
--  2434 (Church Fenton) Squadron - Training Hub
--  Supabase / Postgres schema
--
--  HOW TO USE
--    1. Create a project at supabase.com  (free tier, choose London / eu-west-2)
--    2. SQL Editor > New query > paste this whole file > Run
--    3. Project Settings > API Keys > copy the Project URL and the PUBLISHABLE key
--    4. Open the Training Hub, click Setup, paste those two values
--
--  A NOTE ON SECURITY
--    The publishable key is designed to be public - it identifies the project,
--    it does not grant access. All protection comes from the Row Level Security
--    (RLS) policies below. NEVER put a secret key in the web app: secret keys
--    bypass every policy here. Every table has RLS enabled and denies by default; the
--    policies then open up only what each role legitimately needs.
--
--    In particular: a cadet CANNOT make themselves staff. That is enforced by a
--    database trigger, not by hiding a button in the interface.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  ROSTER - staff pre-load cadets here before they sign up
--
--  This is the ONLY place an email address is stored, and it is deliberately
--  erased the moment the cadet claims their account. It exists purely so that
--  sign-up can verify "you are who you say you are" against something staff
--  entered in advance.
-- ---------------------------------------------------------------------------
create table if not exists public.roster (
  id             uuid primary key default gen_random_uuid(),
  service_number text        not null unique,
  surname        text        not null,
  email          text,                          -- nulled on claim, see below
  flight         text,
  intended_staff boolean     not null default false,
  claimed_by     uuid        references auth.users(id) on delete set null,
  claimed_at     timestamptz,
  created_at     timestamptz not null default now(),
  created_by     uuid        references auth.users(id)
);

comment on column public.roster.email is
  'Used only to verify sign-up. Erased automatically once the account is claimed.';

-- ---------------------------------------------------------------------------
--  PROFILES - the actual cadet/staff record
--
--  Minimal by design: a service number, a display name, and whether they are
--  staff. No email, no date of birth, no address. Email lives in auth.users
--  where Supabase needs it for password resets, and nowhere else.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  service_number text        not null unique,
  display_name   text        not null,
  is_staff       boolean     not null default false,
  flight         text,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
--  LESSON PROGRESS - one row per cadet per learning outcome
-- ---------------------------------------------------------------------------
create table if not exists public.lesson_progress (
  id           uuid primary key default gen_random_uuid(),
  cadet_id     uuid not null references public.profiles(id) on delete cascade,
  lo           text not null check (lo in ('LO1','LO2','LO3','LO4','LO5')),
  slide_index  int  not null default 0,
  slide_count  int,
  started_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz,
  unique (cadet_id, lo)
);

-- ---------------------------------------------------------------------------
--  HANDOUT RESPONSES - what a cadet writes during the lesson
--
--  One row per prompt. Staff can read these: the squadron wants live "who is
--  keeping up, who is stuck" during the lesson, which the cadets are told.
-- ---------------------------------------------------------------------------
create table if not exists public.handout_responses (
  id          uuid primary key default gen_random_uuid(),
  cadet_id    uuid not null references public.profiles(id) on delete cascade,
  lo          text not null check (lo in ('LO1','LO2','LO3','LO4','LO5')),
  prompt_key  text not null,
  answer      text not null default '',
  updated_at  timestamptz not null default now(),
  unique (cadet_id, lo, prompt_key)
);

-- ---------------------------------------------------------------------------
--  CHECK RESULTS - after-lesson quiz scores
-- ---------------------------------------------------------------------------
create table if not exists public.check_results (
  id        uuid primary key default gen_random_uuid(),
  cadet_id  uuid not null references public.profiles(id) on delete cascade,
  lo        text not null check (lo in ('LO1','LO2','LO3','LO4','LO5')),
  score     int  not null,
  total     int  not null,
  wrong     jsonb not null default '[]'::jsonb,
  taken_at  timestamptz not null default now()
);

-- ============================================================================
--  HELPERS
-- ============================================================================

-- Is the current user a staff member? SECURITY DEFINER so that the policies on
-- profiles can call it without recursing through their own RLS.
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_staff from public.profiles where id = auth.uid()), false);
$$;

-- ---------------------------------------------------------------------------
--  CLAIM AN ACCOUNT
--
--  Called once, immediately after sign-up. Verifies the three things staff
--  pre-loaded - service number, surname, and the email the account was created
--  with - then creates the profile and erases the stored email.
--
--  SECURITY DEFINER because an unclaimed user has no profile yet and therefore
--  no rights. The function is the narrow, audited door through that.
-- ---------------------------------------------------------------------------
create or replace function public.claim_account(
  p_service_number text,
  p_surname        text,
  p_display_name   text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email   text;
  v_row     public.roster;
  v_profile public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  if exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'This account has already been set up.';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  select * into v_row
    from public.roster
   where lower(trim(service_number)) = lower(trim(p_service_number))
     and lower(trim(surname))        = lower(trim(p_surname))
     and lower(trim(coalesce(email,''))) = lower(trim(coalesce(v_email,'')))
     and claimed_by is null;

  if v_row.id is null then
    -- Deliberately vague: do not reveal which of the three did not match.
    raise exception 'Those details do not match a cadet on the roster. Check with your staff.';
  end if;

  insert into public.profiles (id, service_number, display_name, is_staff, flight)
  values (auth.uid(),
          trim(v_row.service_number),
          coalesce(nullif(trim(p_display_name), ''), trim(v_row.surname)),
          v_row.intended_staff,
          v_row.flight)
  returning * into v_profile;

  update public.roster
     set claimed_by = auth.uid(),
         claimed_at = now(),
         email      = null          -- erased: it has done its job
   where id = v_row.id;

  return v_profile;
end;
$$;

-- ---------------------------------------------------------------------------
--  GUARD: nobody can promote themselves to staff
--
--  The tickbox in the interface is convenience. THIS is the actual rule.
-- ---------------------------------------------------------------------------
create or replace function public.guard_is_staff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_staff is distinct from old.is_staff then
    if not public.is_staff() then
      raise exception 'Only staff can change staff status.';
    end if;
    if new.id = auth.uid() then
      raise exception 'You cannot change your own staff status.';
    end if;
  end if;
  -- service_number is issued, not chosen
  if new.service_number is distinct from old.service_number and not public.is_staff() then
    raise exception 'Only staff can change a service number.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_is_staff on public.profiles;
create trigger trg_guard_is_staff
  before update on public.profiles
  for each row execute function public.guard_is_staff();

-- Keep updated_at honest
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists trg_touch_handout on public.handout_responses;
create trigger trg_touch_handout before update on public.handout_responses
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_touch_progress on public.lesson_progress;
create trigger trg_touch_progress before update on public.lesson_progress
  for each row execute function public.touch_updated_at();

-- ============================================================================
--  ROW LEVEL SECURITY
--  Everything is denied unless a policy below allows it.
-- ============================================================================
alter table public.roster            enable row level security;
alter table public.profiles          enable row level security;
alter table public.lesson_progress   enable row level security;
alter table public.handout_responses enable row level security;
alter table public.check_results     enable row level security;

-- ---- roster: staff only, entirely ----------------------------------------
drop policy if exists roster_staff_all on public.roster;
create policy roster_staff_all on public.roster
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---- profiles ------------------------------------------------------------
drop policy if exists profiles_read_own on public.profiles;
create policy profiles_read_own on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_staff());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_staff())
  with check (id = auth.uid() or public.is_staff());
  -- the trigger above still blocks self-promotion

drop policy if exists profiles_staff_delete on public.profiles;
create policy profiles_staff_delete on public.profiles
  for delete to authenticated using (public.is_staff());

-- ---- lesson_progress ----------------------------------------------------
drop policy if exists progress_own_rw on public.lesson_progress;
create policy progress_own_rw on public.lesson_progress
  for all to authenticated
  using (cadet_id = auth.uid() or public.is_staff())
  with check (cadet_id = auth.uid());

-- ---- handout_responses --------------------------------------------------
--  Cadets write their own. Staff can read everyone's - the squadron wants live
--  progress during the lesson - but staff cannot write a cadet's answers.
drop policy if exists handout_own_write on public.handout_responses;
create policy handout_own_write on public.handout_responses
  for all to authenticated
  using (cadet_id = auth.uid())
  with check (cadet_id = auth.uid());

drop policy if exists handout_staff_read on public.handout_responses;
create policy handout_staff_read on public.handout_responses
  for select to authenticated using (public.is_staff());

-- ---- check_results ------------------------------------------------------
drop policy if exists checks_own_insert on public.check_results;
create policy checks_own_insert on public.check_results
  for insert to authenticated with check (cadet_id = auth.uid());

drop policy if exists checks_read on public.check_results;
create policy checks_read on public.check_results
  for select to authenticated
  using (cadet_id = auth.uid() or public.is_staff());

-- ============================================================================
--  BOOTSTRAP YOUR FIRST STAFF ACCOUNT
--
--  Chicken and egg: only staff can create staff, and there are no staff yet.
--  So do this once, by hand, in the SQL editor.
--
--  1. Put yourself on the roster with intended_staff = true. Use the email you
--     will sign up with:
--
--       insert into public.roster (service_number, surname, email, intended_staff)
--       values ('YOUR_SERVICE_NO', 'YourSurname', 'you@example.com', true);
--
--  2. Sign up in the Training Hub with exactly those details.
--  3. You are now staff and can add everyone else from the Cadets screen.
--
--  IF YOU LOCK YOURSELF OUT
--    The guard trigger below fires for everyone - including this SQL editor,
--    where auth.uid() is null, so is_staff() is false and a plain UPDATE is
--    refused. Switch the trigger off for the one statement:
--
--       begin;
--       alter table public.profiles disable trigger trg_guard_is_staff;
--       update public.profiles set is_staff = true
--        where service_number = 'YOUR_SERVICE_NO';
--       alter table public.profiles enable trigger trg_guard_is_staff;
--       commit;
--
--    Then sign out and back in - the hub reads your profile at sign-in.
-- ============================================================================
