-- =============================================================================
-- IT Helpdesk — Core schema
-- Migration 0001
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Enums as check constraints (keeps migration simple and portable)
-- -----------------------------------------------------------------------------
-- profiles.role          : employee | it_support | admin
-- tickets.status         : OPEN | ASSIGNED | IN_PROGRESS | WAITING_USER | RESOLVED | CLOSED
-- tickets.priority       : LOW | MEDIUM | HIGH | CRITICAL

-- -----------------------------------------------------------------------------
-- updated_at helper
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- departments
-- -----------------------------------------------------------------------------
create table if not exists public.departments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists departments_set_updated_at on public.departments;
create trigger departments_set_updated_at
  before update on public.departments
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  full_name         text not null,
  email             text not null,
  role              text not null default 'employee'
                      check (role in ('employee', 'it_support', 'admin')),
  department_id     uuid references public.departments (id) on delete set null,
  telegram_user_id  bigint unique,
  avatar_url        text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists profiles_department_idx on public.profiles (department_id);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- categories
-- -----------------------------------------------------------------------------
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists categories_set_updated_at on public.categories;
create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- tickets
-- -----------------------------------------------------------------------------
create sequence if not exists public.ticket_number_seq as bigint start with 1;

create table if not exists public.tickets (
  id            uuid primary key default gen_random_uuid(),
  ticket_number text not null unique
                  default 'IT-' || lpad(nextval('public.ticket_number_seq')::text, 6, '0'),
  title         text not null,
  description   text not null,
  category_id   uuid references public.categories (id) on delete set null,
  priority      text not null default 'MEDIUM'
                  check (priority in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  status        text not null default 'OPEN'
                  check (status in ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_USER', 'RESOLVED', 'CLOSED')),
  created_by    uuid not null references public.profiles (id) on delete restrict,
  assigned_to   uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  closed_at     timestamptz
);

create index if not exists tickets_created_by_idx  on public.tickets (created_by);
create index if not exists tickets_assigned_to_idx on public.tickets (assigned_to);
create index if not exists tickets_status_idx      on public.tickets (status);
create index if not exists tickets_priority_idx    on public.tickets (priority);
create index if not exists tickets_category_idx    on public.tickets (category_id);
create index if not exists tickets_updated_at_idx  on public.tickets (updated_at desc);
create index if not exists tickets_search_idx on public.tickets
  using gin (to_tsvector('simple', ticket_number || ' ' || title || ' ' || description));

drop trigger if exists tickets_set_updated_at on public.tickets;
create trigger tickets_set_updated_at
  before update on public.tickets
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- ticket_comments
-- -----------------------------------------------------------------------------
create table if not exists public.ticket_comments (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.tickets (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete restrict,
  message     text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists ticket_comments_ticket_idx on public.ticket_comments (ticket_id, created_at);

drop trigger if exists ticket_comments_set_updated_at on public.ticket_comments;
create trigger ticket_comments_set_updated_at
  before update on public.ticket_comments
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- ticket_attachments (binary lives in Supabase Storage, never in Postgres)
-- -----------------------------------------------------------------------------
create table if not exists public.ticket_attachments (
  id           uuid primary key default gen_random_uuid(),
  ticket_id    uuid not null references public.tickets (id) on delete cascade,
  comment_id   uuid references public.ticket_comments (id) on delete set null,
  uploaded_by  uuid not null references public.profiles (id) on delete restrict,
  file_name    text not null,
  file_path    text not null,
  file_size    bigint not null default 0,
  mime_type    text not null default 'application/octet-stream',
  created_at   timestamptz not null default now()
);

create index if not exists ticket_attachments_ticket_idx on public.ticket_attachments (ticket_id);
create index if not exists ticket_attachments_comment_idx on public.ticket_attachments (comment_id);

-- -----------------------------------------------------------------------------
-- ticket_history
-- -----------------------------------------------------------------------------
create table if not exists public.ticket_history (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.tickets (id) on delete cascade,
  user_id     uuid references public.profiles (id) on delete set null,
  action      text not null,
  old_value   text,
  new_value   text,
  created_at  timestamptz not null default now()
);

create index if not exists ticket_history_ticket_idx on public.ticket_history (ticket_id, created_at);

-- -----------------------------------------------------------------------------
-- notifications (channel-agnostic: web now, telegram/email later)
-- -----------------------------------------------------------------------------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  ticket_id   uuid references public.tickets (id) on delete cascade,
  title       text not null,
  message     text not null,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications (user_id, is_read, created_at desc);

-- -----------------------------------------------------------------------------
-- PHASE 3/4 placeholders — created now so tickets can reference them later
-- without a breaking migration. No UI, no logic in Phase 1.
-- -----------------------------------------------------------------------------
create table if not exists public.devices (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  asset_tag     text unique,
  serial_number text,
  device_type   text,
  os            text,
  owner_id      uuid references public.profiles (id) on delete set null,
  department_id uuid references public.departments (id) on delete set null,
  metadata      jsonb not null default '{}'::jsonb,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists devices_set_updated_at on public.devices;
create trigger devices_set_updated_at
  before update on public.devices
  for each row execute function public.set_updated_at();

create table if not exists public.remote_sessions (
  id           uuid primary key default gen_random_uuid(),
  ticket_id    uuid references public.tickets (id) on delete set null,
  device_id    uuid references public.devices (id) on delete set null,
  operator_id  uuid references public.profiles (id) on delete set null,
  target_id    uuid references public.profiles (id) on delete set null,
  provider     text,
  session_ref  text,
  status       text not null default 'PENDING',
  started_at   timestamptz,
  ended_at     timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists remote_sessions_set_updated_at on public.remote_sessions;
create trigger remote_sessions_set_updated_at
  before update on public.remote_sessions
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Helper functions (SECURITY DEFINER -> safe to use inside RLS policies)
-- =============================================================================

create or replace function public.current_role_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and is_active = true;
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and is_active = true
  );
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true and role in ('it_support', 'admin')
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_active = true and role = 'admin'
  );
$$;

create or replace function public.can_access_ticket(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tickets t
    where t.id = p_ticket_id
      and (
        t.created_by = auth.uid()
        or t.assigned_to = auth.uid()
        or public.is_staff()
      )
  );
$$;

grant execute on function public.current_role_name() to authenticated;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_access_ticket(uuid) to authenticated;

-- =============================================================================
-- Auth -> profile bootstrap
-- =============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, role, department_id)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'role', ''), 'employee'),
    nullif(new.raw_user_meta_data ->> 'department_id', '')::uuid
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only admins may change a role / activation flag; blocks privilege escalation
create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.role is distinct from old.role
      or new.is_active is distinct from old.is_active
      or new.department_id is distinct from old.department_id)
     and not public.is_admin()
     and auth.uid() is not null
  then
    raise exception 'Only administrators can change role, status or department';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_privileges on public.profiles;
create trigger profiles_guard_privileges
  before update on public.profiles
  for each row execute function public.guard_profile_privileges();
