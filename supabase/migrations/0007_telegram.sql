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
