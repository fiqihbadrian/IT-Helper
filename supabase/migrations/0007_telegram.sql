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

  -- only queue Telegram for users who actually linked an account
  if exists (
    select 1 from public.profiles
    where id = new.user_id and telegram_user_id is not null and is_active = true
  ) then
    insert into public.notification_deliveries (notification_id, channel, status)
    values (new.id, 'telegram', 'PENDING');
  end if;

  return new;
end;
$$;

drop trigger if exists notifications_queue_delivery on public.notifications;
create trigger notifications_queue_delivery
  after insert on public.notifications
  for each row execute function public.notifications_queue_delivery();

-- -----------------------------------------------------------------------------
-- Redeem a link code. SECURITY DEFINER: the bot is not authenticated as the
-- user, it only knows the chat id and the code the user pasted.
-- -----------------------------------------------------------------------------
create or replace function public.redeem_telegram_code(p_code text, p_chat_id bigint)
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
    and c.used_at is null
    and c.expires_at > now();

  if v_code.code is null then
    return;
  end if;

  -- one Telegram account per profile, and one profile per Telegram account
  update public.profiles
     set telegram_user_id = p_chat_id
   where id = v_code.user_id;

  update public.telegram_link_codes
     set used_at = now()
   where code = v_code.code;

  select * into v_profile from public.profiles where id = v_code.user_id;

  return query select v_profile.id, v_profile.full_name, v_profile.role::text;
end;
$$;

create or replace function public.unlink_telegram(p_chat_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set telegram_user_id = null
   where telegram_user_id = p_chat_id;
  return found;
end;
$$;

-- -----------------------------------------------------------------------------
-- Resolve a chat id to a profile, without disclosing anything else.
-- -----------------------------------------------------------------------------
create or replace function public.profile_for_telegram_chat(p_chat_id bigint)
returns table (user_id uuid, full_name text, role text, email text)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.full_name, p.role::text, p.email
  from public.profiles p
  where p.telegram_user_id = p_chat_id
    and p.is_active = true;
$$;

-- -----------------------------------------------------------------------------
-- Generate a link code for the signed-in user.
-- -----------------------------------------------------------------------------
create or replace function public.create_telegram_link_code()
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

  -- invalidate anything still outstanding for this user
  update public.telegram_link_codes
     set used_at = now()
   where user_id = v_uid and used_at is null;

  -- 6 characters from an unambiguous alphabet (no 0/O/1/I/L)
  select string_agg(substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', (random() * 30)::int + 1, 1), '')
    into v_code
  from generate_series(1, 6);

  return query
  insert into public.telegram_link_codes (code, user_id)
  values (v_code, v_uid)
  returning telegram_link_codes.code, telegram_link_codes.expires_at;
end;
$$;

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
