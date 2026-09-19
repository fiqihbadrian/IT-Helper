-- =============================================================================
-- IT Helpdesk — complete schema
--
-- GENERATED FILE — do not edit by hand.
-- Source: supabase/migrations/*.sql and supabase/seed.sql
-- Rebuild with: npm run db:bundle
--
-- Paste this whole file into the Supabase SQL editor to create the database
-- from scratch. It is idempotent, so re-running it is safe.
-- =============================================================================


-- =============================================================================
-- 0001_init.sql
-- =============================================================================

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



-- =============================================================================
-- 0002_triggers.sql
-- =============================================================================

-- =============================================================================
-- IT Helpdesk — Domain triggers
-- Migration 0002
--
-- All ticket side-effects (history, timestamps, notifications) live in the
-- database. Web now, Telegram/email later — both go through the same records.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Notification helper. Channel-agnostic: a row in `notifications` is the single
-- source of truth. Phase 2 will add a dispatcher that reads this table and
-- pushes to Telegram; nothing in the ticket flow has to change.
-- -----------------------------------------------------------------------------
create or replace function public.notify(
  p_user_id   uuid,
  p_ticket_id uuid,
  p_title     text,
  p_message   text
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (user_id, ticket_id, title, message)
  select p_user_id, p_ticket_id, p_title, p_message
  where p_user_id is not null
    and exists (select 1 from public.profiles where id = p_user_id and is_active = true);
$$;

-- -----------------------------------------------------------------------------
-- resolved_at / closed_at maintenance
-- -----------------------------------------------------------------------------
create or replace function public.tickets_stamp_state()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'RESOLVED' then
      new.resolved_at = coalesce(new.resolved_at, now());
    elsif new.status <> 'RESOLVED' then
      new.resolved_at = null;
    end if;

    if new.status = 'CLOSED' then
      new.closed_at = coalesce(new.closed_at, now());
    elsif new.status <> 'CLOSED' then
      new.closed_at = null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tickets_stamp_state on public.tickets;
create trigger tickets_stamp_state
  before update on public.tickets
  for each row execute function public.tickets_stamp_state();

-- -----------------------------------------------------------------------------
-- tickets: history + notifications
-- -----------------------------------------------------------------------------
create or replace function public.tickets_log_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := coalesce(auth.uid(), new.created_by);
  v_author text;
begin
  select full_name into v_author from public.profiles where id = new.created_by;

  insert into public.ticket_history (ticket_id, user_id, action, old_value, new_value)
  values (new.id, v_actor, 'CREATED', null, 'Ticket created by ' || coalesce(v_author, 'user'));

  insert into public.notifications (user_id, ticket_id, title, message)
  select p.id,
         new.id,
         'New ticket ' || new.ticket_number,
         coalesce(v_author, 'An employee') || ' created "' || new.title || '"'
  from public.profiles p
  where p.is_active = true
    and p.role in ('it_support', 'admin')
    and p.id <> new.created_by;

  return new;
end;
$$;

drop trigger if exists tickets_log_insert on public.tickets;
create trigger tickets_log_insert
  after insert on public.tickets
  for each row execute function public.tickets_log_insert();

create or replace function public.tickets_log_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := coalesce(auth.uid(), new.created_by);
  v_old_name text;
  v_new_name text;
begin
  if new.status is distinct from old.status then
    insert into public.ticket_history (ticket_id, user_id, action, old_value, new_value)
    values (new.id, v_actor, 'STATUS_CHANGED', old.status, new.status);

    perform public.notify(
      new.created_by,
      new.id,
      'Ticket ' || new.ticket_number || ' updated',
      'Status changed from ' || old.status || ' to ' || new.status
    );
  end if;

  if new.priority is distinct from old.priority then
    insert into public.ticket_history (ticket_id, user_id, action, old_value, new_value)
    values (new.id, v_actor, 'PRIORITY_CHANGED', old.priority, new.priority);

    -- the requester cares about their own ticket being re-prioritised, either way
    if new.created_by <> v_actor then
      perform public.notify(
        new.created_by,
        new.id,
        'Ticket ' || new.ticket_number || ' re-prioritised',
        'Priority changed from ' || old.priority || ' to ' || new.priority
      );
    end if;

    -- escalation is also broadcast to the rest of the bench
    if new.priority in ('HIGH', 'CRITICAL') then
      insert into public.notifications (user_id, ticket_id, title, message)
      select p.id, new.id,
             new.ticket_number || ' priority ' || new.priority,
             '"' || new.title || '" was escalated to ' || new.priority
      from public.profiles p
      where p.is_active = true
        and p.role in ('it_support', 'admin')
        and p.id <> v_actor
        and p.id <> new.created_by;
    end if;
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    select full_name into v_old_name from public.profiles where id = old.assigned_to;
    select full_name into v_new_name from public.profiles where id = new.assigned_to;

    insert into public.ticket_history (ticket_id, user_id, action, old_value, new_value)
    values (new.id, v_actor, 'ASSIGNED', coalesce(v_old_name, 'Unassigned'), coalesce(v_new_name, 'Unassigned'));

    if new.assigned_to is not null then
      perform public.notify(
        new.assigned_to,
        new.id,
        'Ticket ' || new.ticket_number || ' assigned to you',
        new.title
      );
    end if;

    perform public.notify(
      new.created_by,
      new.id,
      'Ticket ' || new.ticket_number || ' assigned',
      'Handled by ' || coalesce(v_new_name, 'unassigned')
    );
  end if;

  if new.category_id is distinct from old.category_id then
    select name into v_old_name from public.categories where id = old.category_id;
    select name into v_new_name from public.categories where id = new.category_id;

    insert into public.ticket_history (ticket_id, user_id, action, old_value, new_value)
    values (new.id, v_actor, 'CATEGORY_CHANGED', coalesce(v_old_name, 'None'), coalesce(v_new_name, 'None'));
  end if;

  return new;
end;
$$;

drop trigger if exists tickets_log_update on public.tickets;
create trigger tickets_log_update
  after update on public.tickets
  for each row execute function public.tickets_log_update();

-- -----------------------------------------------------------------------------
-- comments: history + cross-notification
-- -----------------------------------------------------------------------------
create or replace function public.comments_log_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.tickets;
  v_author public.profiles;
  v_author_label text;
begin
  select * into v_ticket from public.tickets where id = new.ticket_id;
  select * into v_author from public.profiles where id = new.user_id;
  if v_ticket is null then
    return new;
  end if;

  v_author_label := case
    when v_author.role in ('it_support', 'admin') then 'IT Support — ' || v_author.full_name
    else v_author.full_name
  end;

  insert into public.ticket_history (ticket_id, user_id, action, old_value, new_value)
  values (new.ticket_id, new.user_id, 'COMMENT_ADDED', null, left(new.message, 180));

  -- employee replied -> notify the assignee, or the whole bench when unassigned
  if new.user_id = v_ticket.created_by then
    if v_ticket.assigned_to is not null then
      perform public.notify(
        v_ticket.assigned_to, new.ticket_id,
        'New reply on ' || v_ticket.ticket_number,
        v_author_label || ' replied to "' || v_ticket.title || '"'
      );
    else
      insert into public.notifications (user_id, ticket_id, title, message)
      select p.id, new.ticket_id,
             'New reply on ' || v_ticket.ticket_number,
             v_author_label || ' replied to "' || v_ticket.title || '"'
      from public.profiles p
      where p.is_active = true and p.role in ('it_support', 'admin');
    end if;
  else
    -- staff replied -> notify the ticket owner
    perform public.notify(
      v_ticket.created_by, new.ticket_id,
      'IT Support replied to ' || v_ticket.ticket_number,
      left(new.message, 160)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists comments_log_insert on public.ticket_comments;
create trigger comments_log_insert
  after insert on public.ticket_comments
  for each row execute function public.comments_log_insert();

-- -----------------------------------------------------------------------------
-- attachments: history
-- -----------------------------------------------------------------------------
create or replace function public.attachments_log_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ticket_history (ticket_id, user_id, action, old_value, new_value)
  values (new.ticket_id, new.uploaded_by, 'ATTACHMENT_ADDED', null, new.file_name);
  return new;
end;
$$;

drop trigger if exists attachments_log_insert on public.ticket_attachments;
create trigger attachments_log_insert
  after insert on public.ticket_attachments
  for each row execute function public.attachments_log_insert();



-- =============================================================================
-- 0003_rls.sql
-- =============================================================================

-- =============================================================================
-- IT Helpdesk — Row Level Security
-- Migration 0003
--
-- Authorisation is enforced in the database, not only by hiding menu items.
-- =============================================================================

alter table public.departments        enable row level security;
alter table public.profiles           enable row level security;
alter table public.categories         enable row level security;
alter table public.tickets            enable row level security;
alter table public.ticket_comments    enable row level security;
alter table public.ticket_attachments enable row level security;
alter table public.ticket_history     enable row level security;
alter table public.notifications      enable row level security;
alter table public.devices            enable row level security;
alter table public.remote_sessions    enable row level security;

-- -----------------------------------------------------------------------------
-- grants (Supabase default privileges cover most of this; be explicit anyway)
-- -----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- =============================================================================
-- departments
-- =============================================================================
drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments
  for select to authenticated
  using (public.is_active_user());

drop policy if exists departments_admin_write on public.departments;
create policy departments_admin_write on public.departments
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- =============================================================================
-- profiles
-- =============================================================================
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_staff());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_all on public.profiles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- =============================================================================
-- categories
-- =============================================================================
drop policy if exists categories_select on public.categories;
create policy categories_select on public.categories
  for select to authenticated
  using (public.is_active_user());

drop policy if exists categories_admin_write on public.categories;
create policy categories_admin_write on public.categories
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- =============================================================================
-- tickets
-- =============================================================================
drop policy if exists tickets_select on public.tickets;
create policy tickets_select on public.tickets
  for select to authenticated
  using (
    created_by = auth.uid()
    or assigned_to = auth.uid()
    or public.is_staff()
  );

drop policy if exists tickets_insert on public.tickets;
create policy tickets_insert on public.tickets
  for insert to authenticated
  with check (public.is_active_user() and created_by = auth.uid());

drop policy if exists tickets_update on public.tickets;
create policy tickets_update on public.tickets
  for update to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists tickets_delete on public.tickets;
create policy tickets_delete on public.tickets
  for delete to authenticated
  using (public.is_admin());

-- =============================================================================
-- ticket_comments
-- =============================================================================
drop policy if exists ticket_comments_select on public.ticket_comments;
create policy ticket_comments_select on public.ticket_comments
  for select to authenticated
  using (public.can_access_ticket(ticket_id));

drop policy if exists ticket_comments_insert on public.ticket_comments;
create policy ticket_comments_insert on public.ticket_comments
  for insert to authenticated
  with check (
    public.is_active_user()
    and user_id = auth.uid()
    and public.can_access_ticket(ticket_id)
  );

drop policy if exists ticket_comments_update on public.ticket_comments;
create policy ticket_comments_update on public.ticket_comments
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists ticket_comments_delete on public.ticket_comments;
create policy ticket_comments_delete on public.ticket_comments
  for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- =============================================================================
-- ticket_attachments
-- =============================================================================
drop policy if exists ticket_attachments_select on public.ticket_attachments;
create policy ticket_attachments_select on public.ticket_attachments
  for select to authenticated
  using (public.can_access_ticket(ticket_id));

drop policy if exists ticket_attachments_insert on public.ticket_attachments;
create policy ticket_attachments_insert on public.ticket_attachments
  for insert to authenticated
  with check (
    public.is_active_user()
    and uploaded_by = auth.uid()
    and public.can_access_ticket(ticket_id)
  );

drop policy if exists ticket_attachments_delete on public.ticket_attachments;
create policy ticket_attachments_delete on public.ticket_attachments
  for delete to authenticated
  using (uploaded_by = auth.uid() or public.is_admin());

-- =============================================================================
-- ticket_history (read-only for users; rows are written by SECURITY DEFINER
-- triggers so the log cannot be forged or erased from the client)
-- =============================================================================
drop policy if exists ticket_history_select on public.ticket_history;
create policy ticket_history_select on public.ticket_history
  for select to authenticated
  using (public.can_access_ticket(ticket_id));

-- =============================================================================
-- notifications
-- =============================================================================
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications
  for delete to authenticated
  using (user_id = auth.uid());

-- =============================================================================
-- Phase 3/4 tables: admin-only until their feature ships
-- =============================================================================
drop policy if exists devices_admin_all on public.devices;
create policy devices_admin_all on public.devices
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists remote_sessions_admin_all on public.remote_sessions;
create policy remote_sessions_admin_all on public.remote_sessions
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());



-- =============================================================================
-- 0004_storage.sql
-- =============================================================================

-- =============================================================================
-- IT Helpdesk — Storage
-- Migration 0004
--
-- Private bucket. Object path convention:  <ticket_id>/<uuid>-<filename>
-- Access is decided by the same ticket rules used by the tables.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ticket-attachments',
  'ticket-attachments',
  false,
  10485760, -- 10 MB
  array[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'application/pdf',
    'text/plain', 'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists ticket_files_select on storage.objects;
create policy ticket_files_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'ticket-attachments'
    and public.can_access_ticket((storage.foldername(name))[1]::uuid)
  );

drop policy if exists ticket_files_insert on storage.objects;
create policy ticket_files_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'ticket-attachments'
    and public.is_active_user()
    and public.can_access_ticket((storage.foldername(name))[1]::uuid)
  );

drop policy if exists ticket_files_delete on storage.objects;
create policy ticket_files_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'ticket-attachments'
    and (owner = auth.uid() or public.is_admin())
  );



-- =============================================================================
-- 0005_stats.sql
-- =============================================================================

-- =============================================================================
-- IT Helpdesk — Aggregates
-- Migration 0005
--
-- SECURITY INVOKER: Row Level Security still applies, so an employee only
-- counts their own tickets while staff count everything.
-- =============================================================================

create or replace function public.ticket_stats()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'total',           count(*),
    'open',            count(*) filter (where status = 'OPEN'),
    'assigned',        count(*) filter (where status = 'ASSIGNED'),
    'in_progress',     count(*) filter (where status = 'IN_PROGRESS'),
    'waiting_user',    count(*) filter (where status = 'WAITING_USER'),
    'resolved',        count(*) filter (where status = 'RESOLVED'),
    'closed',          count(*) filter (where status = 'CLOSED'),
    'active',          count(*) filter (where status not in ('RESOLVED', 'CLOSED')),
    'unassigned',      count(*) filter (where assigned_to is null and status not in ('RESOLVED', 'CLOSED')),
    'assigned_to_me',  count(*) filter (where assigned_to = auth.uid() and status not in ('RESOLVED', 'CLOSED')),
    'high_priority',   count(*) filter (where priority in ('HIGH', 'CRITICAL') and status not in ('RESOLVED', 'CLOSED')),
    'critical',        count(*) filter (where priority = 'CRITICAL' and status not in ('RESOLVED', 'CLOSED'))
  )
  from public.tickets;
$$;

grant execute on function public.ticket_stats() to authenticated;



-- =============================================================================
-- 0006_api_keys.sql
-- =============================================================================

-- =============================================================================
-- IT Helpdesk — API keys
-- Migration 0006
--
-- API keys authenticate external callers (scripts, AI tools, the Telegram bot).
-- They deliberately do NOT bypass Row Level Security: an API request runs as the
-- owning user, so every policy in 0003_rls.sql still applies. A key issued to an
-- employee cannot read another employee's ticket, exactly like the web session.
-- =============================================================================

create table if not exists public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  name         text not null,
  -- Only the hash is stored. The plaintext key is shown once, at creation time.
  key_hash     text not null unique,
  key_prefix   text not null,
  last_used_at timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists api_keys_user_idx on public.api_keys (user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Hashing. sha256 is correct here (unlike for passwords): the key is a long
-- random secret with full entropy, so there is nothing to brute force and we
-- need the lookup to be a fast indexed equality check on every request.
-- -----------------------------------------------------------------------------
create or replace function public.hash_api_key(p_key text)
returns text
language sql
immutable
-- `digest()` comes from pgcrypto in the `extensions` schema, and a SECURITY
-- DEFINER caller may pin search_path to `public` alone, so this function has to
-- resolve it on its own.
set search_path = public, extensions
as $$
  select encode(digest(p_key, 'sha256'), 'hex');
$$;

-- -----------------------------------------------------------------------------
-- Issue a key. Returns the plaintext exactly once.
-- -----------------------------------------------------------------------------
create or replace function public.create_api_key(
  p_name      text,
  p_expires_at timestamptz default null
)
returns table (id uuid, name text, api_key text, key_prefix text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid    uuid := auth.uid();
  v_secret text;
  v_key    text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- `p.id`, not `id`: the OUT parameter above shares that name, and an
  -- unqualified reference would be ambiguous.
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.is_active = true) then
    raise exception 'account is not active' using errcode = '28000';
  end if;

  -- 32 bytes of entropy, url-safe so it survives copy/paste and shell quoting.
  v_secret := encode(gen_random_bytes(32), 'base64');
  v_secret := replace(replace(replace(v_secret, '+', '-'), '/', '_'), '=', '');
  v_key    := 'itk_' || v_secret;

  return query
  insert into public.api_keys (user_id, name, key_hash, key_prefix, expires_at)
  values (v_uid, coalesce(nullif(trim(p_name), ''), 'Untitled key'),
          public.hash_api_key(v_key), left(v_key, 12), p_expires_at)
  returning api_keys.id, api_keys.name, v_key, api_keys.key_prefix, api_keys.expires_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- Verify a key and return the owning user. Used by the API gateway.
-- SECURITY DEFINER because the caller is anonymous at that point; it only ever
-- discloses the user id, never any ticket data.
-- -----------------------------------------------------------------------------
-- `create or replace` cannot change a function's return type, so drop first.
drop function if exists public.verify_api_key(text);

create or replace function public.verify_api_key(p_key text)
returns table (user_id uuid, key_id uuid, key_name text, role text, email text, full_name text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row public.api_keys;
  v_profile public.profiles;
begin
  if p_key is null or length(p_key) < 20 then
    return;
  end if;

  select * into v_row
  from public.api_keys k
  where k.key_hash = public.hash_api_key(p_key)
    and k.revoked_at is null
    and (k.expires_at is null or k.expires_at > now());

  if v_row.id is null then
    return;
  end if;

  select * into v_profile from public.profiles where id = v_row.user_id;
  if v_profile.id is null or v_profile.is_active = false then
    return;
  end if;

  update public.api_keys set last_used_at = now() where id = v_row.id;

  return query select v_profile.id, v_row.id, v_row.name, v_profile.role::text, v_profile.email, v_profile.full_name;
end;
$$;

-- -----------------------------------------------------------------------------
-- Revoke
-- -----------------------------------------------------------------------------
create or replace function public.revoke_api_key(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_role text := public.current_role_name();
begin
  update public.api_keys
     set revoked_at = now()
   where id = p_id
     and revoked_at is null
     and (user_id = v_uid or v_role = 'admin');

  return found;
end;
$$;

-- -----------------------------------------------------------------------------
-- RLS. Owners manage their own keys; admins can see (but never read) all of
-- them. There is no policy that lets anyone select key_hash, and no insert
-- policy at all — keys can only be minted through create_api_key().
-- -----------------------------------------------------------------------------
alter table public.api_keys enable row level security;

drop policy if exists api_keys_select_own on public.api_keys;
create policy api_keys_select_own on public.api_keys
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists api_keys_update_own on public.api_keys;
create policy api_keys_update_own on public.api_keys
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists api_keys_delete_admin on public.api_keys;
create policy api_keys_delete_admin on public.api_keys
  for delete to authenticated
  using (public.is_admin());



-- =============================================================================
-- 0007_telegram.sql
-- =============================================================================

-- =============================================================================
-- IT Helpdesk — Telegram bot plumbing
-- Migration 0007
--
-- Phase 2. Nothing here changes the ticketing model: the bot creates tickets,
-- posts comments and reads notifications through exactly the same tables and
-- triggers as the web app.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Link a Telegram account to a profile.
--
-- Deliberately a two-step handshake rather than "ask the user for their email":
-- an email address is not a secret, so trusting one would let anybody claim
-- somebody else's tickets. The user generates a short-lived code in the web app
-- (where they are already authenticated), then sends it to the bot.
-- -----------------------------------------------------------------------------
create table if not exists public.telegram_link_codes (
  code       text primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists telegram_link_codes_user_idx
  on public.telegram_link_codes (user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Inbound update log. Telegram retries webhooks, so every update_id is recorded
-- once and replayed requests are ignored. Also doubles as the audit trail for
-- "who told the bot what".
-- -----------------------------------------------------------------------------
create table if not exists public.telegram_updates (
  update_id    bigint primary key,
  chat_id      bigint not null,
  user_id      uuid references public.profiles (id) on delete set null,
  command      text,
  payload      text,
  ticket_id    uuid references public.tickets (id) on delete set null,
  reply        text,
  processed_at timestamptz not null default now()
);

create index if not exists telegram_updates_chat_idx
  on public.telegram_updates (chat_id, processed_at desc);

-- -----------------------------------------------------------------------------
-- Conversation state. Multi-step commands (/new asks for a title, then a
-- description) need somewhere to park a half-finished draft between messages.
-- -----------------------------------------------------------------------------
create table if not exists public.telegram_sessions (
  chat_id    bigint primary key,
  user_id    uuid references public.profiles (id) on delete cascade,
  state      text,
  draft      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Outbound delivery tracking.
--
-- `notifications` stays the single source of truth (written by the 0002
-- triggers, channel-agnostic). This table only records *attempts* to push a
-- given notification to a given channel, so a dispatcher can be retried and can
-- never double-send.
-- -----------------------------------------------------------------------------
create table if not exists public.notification_deliveries (
  id              uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications (id) on delete cascade,
  channel         text not null check (channel in ('web', 'telegram', 'email')),
  status          text not null default 'PENDING'
                    check (status in ('PENDING', 'SENT', 'FAILED', 'SKIPPED')),
  attempts        int not null default 0,
  last_error      text,
  external_id     text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (notification_id, channel)
);

create index if not exists notification_deliveries_pending_idx
  on public.notification_deliveries (channel, status, created_at);

drop trigger if exists notification_deliveries_set_updated_at on public.notification_deliveries;
create trigger notification_deliveries_set_updated_at
  before update on public.notification_deliveries
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Queue a delivery row for every new notification. This is the hook the
-- dispatcher polls; adding an email channel later is a one-line change here.
--
-- 0009 replaces this function with the real one, which routes to one of the two
-- bots based on `notifications.audience`. It is web-only here because the bot
-- routing needs `telegram_links`, which 0009 creates.
-- -----------------------------------------------------------------------------
create or replace function public.notifications_queue_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notification_deliveries (notification_id, channel, status)
  values (new.id, 'web', 'SENT');

  return new;
end;
$$;

drop trigger if exists notifications_queue_delivery on public.notifications;
create trigger notifications_queue_delivery
  after insert on public.notifications
  for each row execute function public.notifications_queue_delivery();

-- -----------------------------------------------------------------------------
-- The link-code RPCs (`redeem_telegram_code`, `unlink_telegram`,
-- `profile_for_telegram_chat`, `create_telegram_link_code`) are created in
-- 0009, not here.
--
-- They used to live in this file and store the link on `profiles.telegram_user_id`.
-- That column cannot exist any more — 0009 replaces it with `telegram_links`, one
-- row per (profile, bot) — and these files are replayed as a set every time, so
-- leaving definitions here that name a dropped column would break the second run.
-- 0009 is where the two-bot versions belong.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.telegram_link_codes enable row level security;
alter table public.telegram_updates enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.telegram_sessions enable row level security;

-- No policies on telegram_sessions: only the bot (service role) ever touches it.

drop policy if exists telegram_link_codes_select_own on public.telegram_link_codes;
create policy telegram_link_codes_select_own on public.telegram_link_codes
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists telegram_updates_select_admin on public.telegram_updates;
create policy telegram_updates_select_admin on public.telegram_updates
  for select to authenticated
  using (public.is_admin());

drop policy if exists notification_deliveries_select_own on public.notification_deliveries;
create policy notification_deliveries_select_own on public.notification_deliveries
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.notifications n
      where n.id = notification_id and n.user_id = auth.uid()
    )
  );



-- =============================================================================
-- 0008_profile_visibility.sql
-- =============================================================================

-- =============================================================================
-- IT Helpdesk — Profile visibility for ticket participants
-- Migration 0008
--
-- `profiles_select_self` lets you read your own row, and staff read everything.
-- That left a hole in the ticket conversation: when a support agent replies to
-- an employee's ticket, the employee could not read the agent's profile, so the
-- reply rendered with no name at all — "Unknown" in the UI and `null` in the API.
--
-- A helpdesk conversation is not anonymous, and the participant is not a secret:
-- you already see their words. What must stay hidden is the rest of the
-- directory. So this policy grants exactly one extra thing — the profile of
-- somebody you are already in a ticket with.
-- =============================================================================

create or replace function public.shares_ticket_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tickets t
    where public.can_access_ticket(t.id)
      and (
        t.created_by = p_user_id
        or t.assigned_to = p_user_id
        or exists (
          select 1
          from public.ticket_comments c
          where c.ticket_id = t.id
            and c.user_id = p_user_id
        )
      )
  );
$$;

grant execute on function public.shares_ticket_with(uuid) to authenticated;

drop policy if exists profiles_select_participants on public.profiles;
create policy profiles_select_participants on public.profiles
  for select to authenticated
  using (public.shares_ticket_with(id));



-- =============================================================================
-- 0009_two_bots.sql
-- =============================================================================

-- =============================================================================
-- IT Helpdesk — Two bots: one for employees, one for IT
-- Migration 0009
--
-- Until now one bot served everybody: it looked up the caller's role and
-- unlocked the staff commands per chat. That works, but it means the employee
-- bot and the IT bot are the same surface — the only thing standing between an
-- employee and the queue commands is a role check in application code.
--
-- This migration splits the surface in two:
--
--   @bian_it_bot    "employee"  self-service only: report and follow a ticket
--   @bian_itbot     "staff"     the bench: queue, claim, close
--
-- The separation is real, not cosmetic:
--
--   * a *link* is now per bot, so one person can hold both and the same person
--     raising a ticket and working a queue does not have to choose;
--   * a link code is minted for a specific bot, so a code generated on the
--     employee panel cannot be redeemed against the staff bot;
--   * `redeem_telegram_code` refuses the staff bot outright for anyone who is
--     not `it_support`/`admin`, whatever the code claims;
--   * notifications carry an `audience`, and the queue trigger delivers a
--     requester notification to the employee bot and a bench notification to
--     the staff bot — so the two bots do not just look different, they say
--     different things.
--
-- Nothing here changes the ticketing model. Both bots still go through the same
-- tables, the same triggers and the same RLS as the web app.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Link a Telegram chat to a profile, per bot.
--
-- `profiles.telegram_user_id` held exactly one chat id, which cannot express
-- "this admin follows their own ticket on the employee bot and the bench on the
-- staff bot". Note the uniqueness: a *private* chat id is the user's Telegram id,
-- so the same human talking to two bots has the SAME chat_id on both. It is only
-- unique per bot, hence `unique (bot, chat_id)` rather than `unique (chat_id)`.
-- -----------------------------------------------------------------------------
create table if not exists public.telegram_links (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  bot        text not null check (bot in ('employee', 'staff')),
  chat_id    bigint not null,
  linked_at  timestamptz not null default now(),
  primary key (profile_id, bot),
  unique (bot, chat_id)
);

create index if not exists telegram_links_chat_idx
  on public.telegram_links (bot, chat_id);

-- Backfill. Everything linked before this migration was talking to
-- @bian_it_bot, which is the employee bot now, so 'employee' is the honest
-- answer — including for staff, whose old link was an employee-bot link whether
-- or not they meant it that way. Staff have to link the staff bot deliberately.
--
-- Guarded because this file is replayed: on the second run the column is already
-- gone, and the backfill has nothing left to say.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'profiles'
       and column_name = 'telegram_user_id'
  ) then
    execute $backfill$
      insert into public.telegram_links (profile_id, bot, chat_id)
      select p.id, 'employee', p.telegram_user_id
        from public.profiles p
       where p.telegram_user_id is not null
      on conflict do nothing
    $backfill$;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Link codes are minted for one bot.
-- -----------------------------------------------------------------------------
alter table public.telegram_link_codes
  add column if not exists bot text not null default 'employee';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.telegram_link_codes'::regclass
       and conname = 'telegram_link_codes_bot_check'
  ) then
    alter table public.telegram_link_codes
      add constraint telegram_link_codes_bot_check
      check (bot in ('employee', 'staff'));
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Sessions and the update log become per bot.
--
-- `telegram_sessions.chat_id` was the primary key. With two bots the same person
-- has the same chat_id on both, so a draft started on one bot would be resumed
-- by the other — the PK has to include the bot.
--
-- `telegram_updates.update_id` was the primary key for the same reason retries
-- are deduped. But update_id is a *per-bot* sequence in Telegram, so two bots can
-- legitimately both send update_id 123456 and the second would be silently
-- dropped as a duplicate. The key becomes (bot, update_id).
-- -----------------------------------------------------------------------------
alter table public.telegram_sessions
  add column if not exists bot text not null default 'employee';

alter table public.telegram_updates
  add column if not exists bot text not null default 'employee';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.telegram_sessions'::regclass
       and conname = 'telegram_sessions_bot_check'
  ) then
    alter table public.telegram_sessions
      add constraint telegram_sessions_bot_check
      check (bot in ('employee', 'staff'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.telegram_updates'::regclass
       and conname = 'telegram_updates_bot_check'
  ) then
    alter table public.telegram_updates
      add constraint telegram_updates_bot_check
      check (bot in ('employee', 'staff'));
  end if;
end $$;

-- Widen the keys only if they are still the old single-column ones, so a re-run
-- of this migration is a no-op instead of an error.
do $$
declare
  v_needs_sessions boolean;
  v_needs_updates  boolean;
begin
  select not exists (
    select 1
      from pg_index i
      join pg_attribute a
        on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
     where i.indrelid = 'public.telegram_sessions'::regclass
       and i.indisprimary
       and a.attname = 'bot'
  ) into v_needs_sessions;

  if v_needs_sessions then
    alter table public.telegram_sessions drop constraint if exists telegram_sessions_pkey;
    alter table public.telegram_sessions add primary key (bot, chat_id);
  end if;

  select not exists (
    select 1
      from pg_index i
      join pg_attribute a
        on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
     where i.indrelid = 'public.telegram_updates'::regclass
       and i.indisprimary
       and a.attname = 'bot'
  ) into v_needs_updates;

  if v_needs_updates then
    alter table public.telegram_updates drop constraint if exists telegram_updates_pkey;
    alter table public.telegram_updates add primary key (bot, update_id);
  end if;
end $$;

drop index if exists public.telegram_updates_chat_idx;
create index if not exists telegram_updates_chat_idx
  on public.telegram_updates (bot, chat_id, processed_at desc);

-- -----------------------------------------------------------------------------
-- Who a notification is for.
--
-- The dispatcher has to decide which bot to push to, and it cannot guess that
-- from the notification row: "Ticket IT-000004 updated" is for the requester,
-- "IT-000004 assigned to you" is for the bench, and an admin is both people.
-- The audience is known at the point the notification is created, so it is
-- recorded there rather than re-derived at delivery time.
-- -----------------------------------------------------------------------------
alter table public.notifications
  add column if not exists audience text not null default 'requester';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.notifications'::regclass
       and conname = 'notifications_audience_check'
  ) then
    alter table public.notifications
      add constraint notifications_audience_check
      check (audience in ('requester', 'staff'));
  end if;
end $$;

create index if not exists notifications_user_audience_idx
  on public.notifications (user_id, audience, created_at desc);

-- -----------------------------------------------------------------------------
-- notify() learns the audience. The 4-argument version is dropped explicitly:
-- `create or replace` with a different argument list would otherwise leave the
-- old function in place as an overload, and every existing 4-argument call site
-- would keep resolving to it.
-- -----------------------------------------------------------------------------
drop function if exists public.notify(uuid, uuid, text, text);

create or replace function public.notify(
  p_user_id   uuid,
  p_ticket_id uuid,
  p_title     text,
  p_message   text,
  p_audience  text default 'requester'
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (user_id, ticket_id, title, message, audience)
  select p_user_id, p_ticket_id, p_title, p_message, p_audience
  where p_user_id is not null
    and exists (select 1 from public.profiles where id = p_user_id and is_active = true);
$$;

-- -----------------------------------------------------------------------------
-- tickets: history + notifications (audience added)
-- -----------------------------------------------------------------------------
create or replace function public.tickets_log_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := coalesce(auth.uid(), new.created_by);
  v_author text;
begin
  select full_name into v_author from public.profiles where id = new.created_by;

  insert into public.ticket_history (ticket_id, user_id, action, old_value, new_value)
  values (new.id, v_actor, 'CREATED', null, 'Ticket created by ' || coalesce(v_author, 'user'));

  -- a new ticket is bench business: it goes to the staff bot, never to the
  -- employee bot of a staff member who happens to be off shift
  insert into public.notifications (user_id, ticket_id, title, message, audience)
  select p.id,
         new.id,
         'New ticket ' || new.ticket_number,
         coalesce(v_author, 'An employee') || ' created "' || new.title || '"',
         'staff'
  from public.profiles p
  where p.is_active = true
    and p.role in ('it_support', 'admin')
    and p.id <> new.created_by;

  return new;
end;
$$;

drop trigger if exists tickets_log_insert on public.tickets;
create trigger tickets_log_insert
  after insert on public.tickets
  for each row execute function public.tickets_log_insert();

create or replace function public.tickets_log_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := coalesce(auth.uid(), new.created_by);
  v_old_name text;
  v_new_name text;
begin
  if new.status is distinct from old.status then
    insert into public.ticket_history (ticket_id, user_id, action, old_value, new_value)
    values (new.id, v_actor, 'STATUS_CHANGED', old.status, new.status);

    perform public.notify(
      new.created_by,
      new.id,
      'Ticket ' || new.ticket_number || ' updated',
      'Status changed from ' || old.status || ' to ' || new.status,
      'requester'
    );
  end if;

  if new.priority is distinct from old.priority then
    insert into public.ticket_history (ticket_id, user_id, action, old_value, new_value)
    values (new.id, v_actor, 'PRIORITY_CHANGED', old.priority, new.priority);

    -- the requester cares about their own ticket being re-prioritised, either way
    if new.created_by <> v_actor then
      perform public.notify(
        new.created_by,
        new.id,
        'Ticket ' || new.ticket_number || ' re-prioritised',
        'Priority changed from ' || old.priority || ' to ' || new.priority,
        'requester'
      );
    end if;

    -- escalation is also broadcast to the rest of the bench
    if new.priority in ('HIGH', 'CRITICAL') then
      insert into public.notifications (user_id, ticket_id, title, message, audience)
      select p.id, new.id,
             new.ticket_number || ' priority ' || new.priority,
             '"' || new.title || '" was escalated to ' || new.priority,
             'staff'
      from public.profiles p
      where p.is_active = true
        and p.role in ('it_support', 'admin')
        and p.id <> v_actor
        and p.id <> new.created_by;
    end if;
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    select full_name into v_old_name from public.profiles where id = old.assigned_to;
    select full_name into v_new_name from public.profiles where id = new.assigned_to;

    insert into public.ticket_history (ticket_id, user_id, action, old_value, new_value)
    values (new.id, v_actor, 'ASSIGNED', coalesce(v_old_name, 'Unassigned'), coalesce(v_new_name, 'Unassigned'));

    if new.assigned_to is not null then
      -- "assigned to you" is work, so it belongs on the staff bot
      perform public.notify(
        new.assigned_to,
        new.id,
        'Ticket ' || new.ticket_number || ' assigned to you',
        new.title,
        'staff'
      );
    end if;

    perform public.notify(
      new.created_by,
      new.id,
      'Ticket ' || new.ticket_number || ' assigned',
      'Handled by ' || coalesce(v_new_name, 'unassigned'),
      'requester'
    );
  end if;

  if new.category_id is distinct from old.category_id then
    select name into v_old_name from public.categories where id = old.category_id;
    select name into v_new_name from public.categories where id = new.category_id;

    insert into public.ticket_history (ticket_id, user_id, action, old_value, new_value)
    values (new.id, v_actor, 'CATEGORY_CHANGED', coalesce(v_old_name, 'None'), coalesce(v_new_name, 'None'));
  end if;

  return new;
end;
$$;

drop trigger if exists tickets_log_update on public.tickets;
create trigger tickets_log_update
  after update on public.tickets
  for each row execute function public.tickets_log_update();

-- -----------------------------------------------------------------------------
-- comments: history + cross-notification (audience added)
-- -----------------------------------------------------------------------------
create or replace function public.comments_log_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.tickets;
  v_author public.profiles;
  v_author_label text;
begin
  select * into v_ticket from public.tickets where id = new.ticket_id;
  select * into v_author from public.profiles where id = new.user_id;
  if v_ticket is null then
    return new;
  end if;

  v_author_label := case
    when v_author.role in ('it_support', 'admin') then 'IT Support — ' || v_author.full_name
    else v_author.full_name
  end;

  insert into public.ticket_history (ticket_id, user_id, action, old_value, new_value)
  values (new.ticket_id, new.user_id, 'COMMENT_ADDED', null, left(new.message, 180));

  -- employee replied -> notify the assignee, or the whole bench when unassigned
  if new.user_id = v_ticket.created_by then
    if v_ticket.assigned_to is not null then
      perform public.notify(
        v_ticket.assigned_to, new.ticket_id,
        'New reply on ' || v_ticket.ticket_number,
        v_author_label || ' replied to "' || v_ticket.title || '"',
        'staff'
      );
    else
      insert into public.notifications (user_id, ticket_id, title, message, audience)
      select p.id, new.ticket_id,
             'New reply on ' || v_ticket.ticket_number,
             v_author_label || ' replied to "' || v_ticket.title || '"',
             'staff'
      from public.profiles p
      where p.is_active = true and p.role in ('it_support', 'admin');
    end if;
  else
    -- staff replied -> notify the ticket owner
    perform public.notify(
      v_ticket.created_by, new.ticket_id,
      'IT Support replied to ' || v_ticket.ticket_number,
      left(new.message, 160),
      'requester'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists comments_log_insert on public.ticket_comments;
create trigger comments_log_insert
  after insert on public.ticket_comments
  for each row execute function public.comments_log_insert();

-- -----------------------------------------------------------------------------
-- One Telegram channel per bot.
--
-- `telegram` keeps its meaning — the employee bot — so existing delivery rows and
-- the dispatcher's default keep working; `telegram_staff` is the new one.
-- -----------------------------------------------------------------------------
alter table public.notification_deliveries
  drop constraint if exists notification_deliveries_channel_check;

alter table public.notification_deliveries
  add constraint notification_deliveries_channel_check
  check (channel in ('web', 'telegram', 'telegram_staff', 'email'));

-- -----------------------------------------------------------------------------
-- Queue a delivery against the bot that matches the notification's audience.
--
-- A requester notification only reaches the employee bot, and a bench
-- notification only reaches the staff bot. A staff member who linked just one of
-- them simply does not get that kind on Telegram — they still see everything in
-- the web app. Falling back to "whichever bot is linked" would quietly undo the
-- separation this migration exists to create.
-- -----------------------------------------------------------------------------
create or replace function public.notifications_queue_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bot     text := case when new.audience = 'staff' then 'staff' else 'employee' end;
  v_channel text := case when new.audience = 'staff' then 'telegram_staff' else 'telegram' end;
begin
  insert into public.notification_deliveries (notification_id, channel, status)
  values (new.id, 'web', 'SENT');

  if exists (
    select 1
      from public.telegram_links l
      join public.profiles p on p.id = l.profile_id
     where l.profile_id = new.user_id
       and l.bot = v_bot
       and p.is_active = true
  ) then
    insert into public.notification_deliveries (notification_id, channel, status)
    values (new.id, v_channel, 'PENDING');
  end if;

  return new;
end;
$$;

drop trigger if exists notifications_queue_delivery on public.notifications;
create trigger notifications_queue_delivery
  after insert on public.notifications
  for each row execute function public.notifications_queue_delivery();

-- -----------------------------------------------------------------------------
-- Redeem a link code for a specific bot.
--
-- `on delete cascade` on telegram_links means the delete below is the only way
-- to move a chat between profiles; the delete-then-insert keeps `unique (bot,
-- chat_id)` satisfiable when someone re-links the same Telegram account.
-- -----------------------------------------------------------------------------
drop function if exists public.redeem_telegram_code(text, bigint);

create or replace function public.redeem_telegram_code(
  p_code    text,
  p_bot     text,
  p_chat_id bigint
)
returns table (user_id uuid, full_name text, role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code    public.telegram_link_codes;
  v_profile public.profiles;
begin
  select * into v_code
  from public.telegram_link_codes c
  where c.code = upper(trim(p_code))
    and c.bot = p_bot
    and c.used_at is null
    and c.expires_at > now();

  if v_code.code is null then
    return;
  end if;

  select * into v_profile
  from public.profiles
  where id = v_code.user_id and is_active = true;

  if v_profile.id is null then
    return;
  end if;

  -- The staff bot is the bench. A code that was somehow minted for a
  -- non-staff profile must not open it, so the role is checked here as well as
  -- when the code is created.
  if p_bot = 'staff' and v_profile.role not in ('it_support', 'admin') then
    return;
  end if;

  delete from public.telegram_links
   where bot = p_bot and chat_id = p_chat_id;

  insert into public.telegram_links (profile_id, bot, chat_id)
  values (v_profile.id, p_bot, p_chat_id);

  update public.telegram_link_codes
     set used_at = now()
   where code = v_code.code;

  return query select v_profile.id, v_profile.full_name, v_profile.role::text;
end;
$$;

drop function if exists public.unlink_telegram(bigint);

create or replace function public.unlink_telegram(p_bot text, p_chat_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.telegram_links
   where bot = p_bot and chat_id = p_chat_id;
  return found;
end;
$$;

drop function if exists public.profile_for_telegram_chat(bigint);

create or replace function public.profile_for_telegram_chat(p_bot text, p_chat_id bigint)
returns table (user_id uuid, full_name text, role text, email text)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.full_name, p.role::text, p.email
  from public.telegram_links l
  join public.profiles p on p.id = l.profile_id
  where l.bot = p_bot
    and l.chat_id = p_chat_id
    and p.is_active = true;
$$;

-- -----------------------------------------------------------------------------
-- Generate a link code for the signed-in user, for a named bot.
-- -----------------------------------------------------------------------------
drop function if exists public.create_telegram_link_code();

create or replace function public.create_telegram_link_code(p_bot text default 'employee')
returns table (code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid  uuid := auth.uid();
  v_code text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_bot not in ('employee', 'staff') then
    raise exception 'unknown bot %', p_bot using errcode = '22023';
  end if;

  -- The staff bot is the bench, so only the bench may ask for its code. The
  -- panel that shows this button is hidden for employees too, but the check
  -- belongs where it cannot be skipped.
  if p_bot = 'staff' and not public.is_staff() then
    raise exception 'only IT staff can link the staff bot' using errcode = '42501';
  end if;

  -- invalidate anything still outstanding for this user on this bot
  update public.telegram_link_codes
     set used_at = now()
   where user_id = v_uid and bot = p_bot and used_at is null;

  -- 6 characters from an unambiguous alphabet (no 0/O/1/I/L)
  select string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', (random() * 30)::int + 1, 1), '')
    into v_code
  from generate_series(1, 6);

  return query
  insert into public.telegram_link_codes (code, user_id, bot)
  values (v_code, v_uid, p_bot)
  returning telegram_link_codes.code, telegram_link_codes.expires_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- `profiles.telegram_user_id` is now derived from `telegram_links`. Keeping both
-- would mean two sources of truth for the same fact.
-- -----------------------------------------------------------------------------
alter table public.profiles drop column if exists telegram_user_id;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.telegram_links enable row level security;

drop policy if exists telegram_links_select_own on public.telegram_links;
create policy telegram_links_select_own on public.telegram_links
  for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());

grant execute on function public.create_telegram_link_code(text) to authenticated;
grant execute on function public.profile_for_telegram_chat(text, bigint) to authenticated;



-- =============================================================================
-- seed.sql
-- =============================================================================

-- =============================================================================
-- IT Helpdesk — Demo / seed data
-- Run AFTER 0001..0004.
--
-- Every demo account uses the password:  Password123!
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Departments
-- -----------------------------------------------------------------------------
insert into public.departments (name) values
  ('IT'), ('Finance'), ('HR'), ('Marketing'), ('Operations')
on conflict (name) do nothing;

-- -----------------------------------------------------------------------------
-- Categories
-- -----------------------------------------------------------------------------
insert into public.categories (name, description) values
  ('Hardware', 'Laptop, desktop, monitor, peripheral'),
  ('Software', 'Application install, licence, error, crash'),
  ('Network',  'WiFi, LAN, VPN, internet connectivity'),
  ('Printer',  'Printing, scanning, toner'),
  ('Account',  'Login, password reset, access rights'),
  ('Email',    'Mailbox, distribution list, spam'),
  ('Security', 'Suspicious activity, malware, phishing'),
  ('Other',    'Anything that does not fit above')
on conflict (name) do nothing;

-- -----------------------------------------------------------------------------
-- Demo auth users + profiles
-- -----------------------------------------------------------------------------
do $$
declare
  v_instance uuid;
  v_user     record;
  v_id       uuid;
begin
  -- GoTrue filters users by instance_id. On a hosted project auth.instances is
  -- usually empty, in which case login silently fails with "Invalid login
  -- credentials", so fall back to the canonical zero UUID that GoTrue itself uses.
  select id into v_instance from auth.instances limit 1;
  v_instance := coalesce(v_instance, '00000000-0000-0000-0000-000000000000'::uuid);

  for v_user in
    select * from (values
      ('11111111-1111-4111-8111-111111111111'::uuid, 'admin@helpdesk.test',      'Andi Pratama',  'admin',      'IT'),
      ('22222222-2222-4222-8222-222222222222'::uuid, 'support1@helpdesk.test',   'Fiqih Ramadhan','it_support', 'IT'),
      ('33333333-3333-4333-8333-333333333333'::uuid, 'support2@helpdesk.test',   'Rina Kusuma',   'it_support', 'IT'),
      ('44444444-4444-4444-8444-444444444444'::uuid, 'employee1@helpdesk.test',  'Budi Santoso',  'employee',   'Finance'),
      ('55555555-5555-4555-8555-555555555555'::uuid, 'employee2@helpdesk.test',  'Sari Melati',   'employee',   'Marketing')
    ) as t(id, email, full_name, role, department)
  loop
    v_id := v_user.id;

    insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change
    )
    values (
      v_id, v_instance, 'authenticated', 'authenticated', v_user.email,
      crypt('Password123!', gen_salt('bf')),
      now(), now(), now(),
      jsonb_build_object('provider', 'email', 'providers', array['email']),
      jsonb_build_object('full_name', v_user.full_name, 'role', v_user.role),
      '', '', '', ''
    )
    on conflict (id) do nothing;

    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    )
    values (
      gen_random_uuid(), v_id, v_id::text,
      jsonb_build_object('sub', v_id::text, 'email', v_user.email, 'email_verified', true),
      'email', now(), now(), now()
    )
    on conflict (provider_id, provider) do nothing;

    -- handle_new_user() already inserted a row; make sure the extra columns match
    update public.profiles
       set full_name     = v_user.full_name,
           role          = v_user.role,
           department_id = (select id from public.departments where name = v_user.department),
           is_active     = true
     where id = v_id;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Demo tickets
-- -----------------------------------------------------------------------------
do $$
declare
  v_budi  uuid := '44444444-4444-4444-8444-444444444444';
  v_sari  uuid := '55555555-5555-4555-8555-555555555555';
  v_fiqih uuid := '22222222-2222-4222-8222-222222222222';
  v_rina  uuid := '33333333-3333-4333-8333-333333333333';
  v_t     uuid;
  v_net   uuid := (select id from public.categories where name = 'Network');
  v_prn   uuid := (select id from public.categories where name = 'Printer');
  v_acc   uuid := (select id from public.categories where name = 'Account');
  v_hw    uuid := (select id from public.categories where name = 'Hardware');
  v_sec   uuid := (select id from public.categories where name = 'Security');
begin
  if exists (select 1 from public.tickets) then
    raise notice 'Tickets already present, skipping demo ticket seed.';
    return;
  end if;

  -- 1. resolved + closed ticket, with a full conversation
  insert into public.tickets (title, description, category_id, priority, status, created_by, assigned_to, created_at, updated_at)
  values ('Printer tidak mencetak', 'Printer lantai 3 tidak mengeluarkan hasil cetak sejak pagi. Lampu indikator berkedip merah.',
          v_prn, 'MEDIUM', 'OPEN', v_budi, null, now() - interval '9 days', now() - interval '9 days')
  returning id into v_t;

  insert into public.ticket_comments (ticket_id, user_id, message, created_at)
  values (v_t, v_fiqih, 'Saya akan melakukan pengecekan.', now() - interval '8 days');

  insert into public.ticket_comments (ticket_id, user_id, message, created_at)
  values (v_t, v_budi, 'Baik, terima kasih.', now() - interval '8 days' + interval '20 minutes');

  update public.tickets set status = 'ASSIGNED', assigned_to = v_fiqih, updated_at = now() - interval '8 days' where id = v_t;
  update public.tickets set status = 'IN_PROGRESS', updated_at = now() - interval '8 days' + interval '30 minutes' where id = v_t;
  update public.tickets set status = 'RESOLVED', updated_at = now() - interval '7 days' where id = v_t;
  update public.tickets set status = 'CLOSED', updated_at = now() - interval '6 days' where id = v_t;

  -- 2. in progress
  insert into public.tickets (title, description, category_id, priority, status, created_by, assigned_to, created_at, updated_at)
  values ('Laptop tidak bisa connect WiFi', 'Laptop saya tidak bisa menemukan WiFi kantor sejak pagi. Sudah restart tetap tidak muncul.',
          v_net, 'HIGH', 'OPEN', v_budi, null, now() - interval '3 days', now() - interval '3 days')
  returning id into v_t;

  insert into public.ticket_comments (ticket_id, user_id, message, created_at)
  values (v_t, v_fiqih, 'Saya akan melakukan pengecekan. Mohon tetap menyalakan laptopnya.', now() - interval '3 days' + interval '1 hour');

  update public.tickets set status = 'ASSIGNED', assigned_to = v_fiqih, updated_at = now() - interval '3 days' + interval '30 minutes' where id = v_t;
  update public.tickets set status = 'IN_PROGRESS', updated_at = now() - interval '2 days' where id = v_t;

  -- 3. waiting user
  insert into public.tickets (title, description, category_id, priority, status, created_by, assigned_to, created_at, updated_at)
  values ('Reset password akun email', 'Lupa password email kantor dan tidak bisa login sejak kemarin.',
          v_acc, 'MEDIUM', 'OPEN', v_sari, null, now() - interval '2 days', now() - interval '2 days')
  returning id into v_t;

  insert into public.ticket_comments (ticket_id, user_id, message, created_at)
  values (v_t, v_rina, 'Password sudah saya reset. Silakan coba login dan konfirmasi di sini.', now() - interval '1 day');

  update public.tickets set status = 'ASSIGNED', assigned_to = v_rina, updated_at = now() - interval '1 day' - interval '1 hour' where id = v_t;
  update public.tickets set status = 'IN_PROGRESS', updated_at = now() - interval '1 day' - interval '30 minutes' where id = v_t;
  update public.tickets set status = 'WAITING_USER', updated_at = now() - interval '1 day' where id = v_t;

  -- 4. unassigned, critical
  insert into public.tickets (title, description, category_id, priority, status, created_by, assigned_to, created_at, updated_at)
  values ('Server tidak bisa diakses', 'Server aplikasi tidak bisa diakses oleh tim Finance sejak 30 menit lalu.',
          v_hw, 'CRITICAL', 'OPEN', v_sari, null, now() - interval '4 hours', now() - interval '4 hours')
  returning id into v_t;

  -- 5. unassigned, high
  insert into public.tickets (title, description, category_id, priority, status, created_by, assigned_to, created_at, updated_at)
  values ('Network down di lantai 2', 'Seluruh koneksi jaringan di lantai 2 terputus. Sekitar 20 orang terdampak.',
          v_net, 'HIGH', 'OPEN', v_budi, null, now() - interval '2 hours', now() - interval '2 hours')
  returning id into v_t;

  -- 6. security report, open
  insert into public.tickets (title, description, category_id, priority, status, created_by, assigned_to, created_at, updated_at)
  values ('Email mencurigakan mengatasnamakan HRD', 'Saya menerima email berisi link login yang meminta data pribadi. Terlihat seperti phishing.',
          v_sec, 'HIGH', 'OPEN', v_sari, null, now() - interval '1 day', now() - interval '1 day')
  returning id into v_t;

  -- 7. low priority, resolved
  insert into public.tickets (title, description, category_id, priority, status, created_by, assigned_to, created_at, updated_at)
  values ('Minta tambah RAM laptop', 'Laptop terasa lambat saat membuka banyak spreadsheet. Mohon evaluasi penambahan RAM.',
          v_hw, 'LOW', 'OPEN', v_budi, null, now() - interval '14 days', now() - interval '14 days')
  returning id into v_t;

  update public.tickets set status = 'ASSIGNED', assigned_to = v_rina, updated_at = now() - interval '13 days' where id = v_t;
  update public.tickets set status = 'RESOLVED', updated_at = now() - interval '12 days' where id = v_t;

  -- 8. closed
  insert into public.tickets (title, description, category_id, priority, status, created_by, assigned_to, created_at, updated_at)
  values ('Instalasi Microsoft Office', 'Butuh instalasi Microsoft Office pada laptop baru.',
          v_acc, 'LOW', 'OPEN', v_sari, null, now() - interval '20 days', now() - interval '20 days')
  returning id into v_t;

  update public.tickets set status = 'ASSIGNED', assigned_to = v_fiqih, updated_at = now() - interval '19 days' where id = v_t;
  update public.tickets set status = 'IN_PROGRESS', updated_at = now() - interval '19 days' + interval '2 hours' where id = v_t;
  update public.tickets set status = 'RESOLVED', updated_at = now() - interval '18 days' where id = v_t;
  update public.tickets set status = 'CLOSED', updated_at = now() - interval '17 days' where id = v_t;

  raise notice 'Demo tickets seeded.';
end $$;

