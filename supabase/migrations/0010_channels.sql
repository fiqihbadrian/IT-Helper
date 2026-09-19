-- =============================================================================
-- IT Helpdesk — Embeddable web widget channels
-- Migration 0010
--
-- A `channel` is one website that may embed the chat widget. It carries the
-- public key that website ships, the origins allowed to use it, and the
-- defaults a conversation started there inherits.
--
-- The central decision: **a visitor is not a user.**
--
-- The obvious design is to create an account per visitor. That would be wrong.
-- Visitors are not employees — they have no role, no department, no business
-- being in /admin/users, and no business appearing in the "assign to" dropdown
-- next to real colleagues. They would also accumulate forever, because unlike
-- an employee there is nobody to deactivate them.
--
-- So instead every channel owns one *system profile* (`profiles.is_system`),
-- and the visitor's own words are written as that profile. The visitor's real
-- identity lives in `ticket_contacts`, one row per external ticket.
--
-- That buys two things:
--
--   * RLS is untouched. A widget request runs through the same `asUser()`
--     impersonation as the bot and the API, so `tickets_insert`'s
--     `created_by = auth.uid()` is satisfied by the system profile and every
--     policy keeps working verbatim. There is no "anonymous" hole to audit.
--   * staff and visitors are distinguishable without a new role: a ticket with
--     a `ticket_contacts` row is external, and `tickets.source` says where it
--     came from.
--
-- The system profile is `is_active = true` (RLS requires it) and `is_system =
-- true` (which is what keeps it out of the user list, out of the assignee
-- picker, and out of the notification table — see `notify()` below).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Mark the machine profiles.
--
-- A boolean column rather than "join channels and see if it matches", because
-- every list query needs this filter and a column makes it one predicate
-- instead of a subquery that each call site has to remember.
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists is_system boolean not null default false;

comment on column public.profiles.is_system is
  'Machine account backing a web widget channel. Never a person: hidden from the user list, the assignee picker and notifications.';

create index if not exists profiles_system_idx
  on public.profiles (is_system)
  where is_system = true;

-- -----------------------------------------------------------------------------
-- Channels
-- -----------------------------------------------------------------------------
create table if not exists public.channels (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  slug                text not null unique,
  public_key          text not null unique,
  allowed_origins     text[] not null default '{}',
  department_id       uuid references public.departments (id) on delete set null,
  default_category_id uuid references public.categories (id) on delete set null,
  default_priority    text not null default 'MEDIUM'
                        check (default_priority in ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  greeting            text not null default 'Hi! Tell us what is wrong and the IT team will pick it up.',
  accent_color        text not null default '#4f46e5',
  is_active           boolean not null default true,
  system_profile_id   uuid not null references public.profiles (id) on delete restrict,
  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (system_profile_id)
);

create index if not exists channels_active_idx on public.channels (is_active);

drop trigger if exists channels_set_updated_at on public.channels;
create trigger channels_set_updated_at
  before update on public.channels
  for each row execute function public.set_updated_at();

comment on column public.channels.public_key is
  'Shipped to the browser. Public by definition — it names a channel, it does not authorise anything.';
comment on column public.channels.allowed_origins is
  'Origins permitted to call the widget API. A single "*" entry allows any origin. An empty array allows none, so a half-configured channel fails closed.';

-- -----------------------------------------------------------------------------
-- Where a ticket came from.
--
-- `source` and `channel_id` are redundant for widget tickets, so the CHECK below
-- makes the redundancy impossible to get wrong: a channel id means a widget
-- ticket and a widget ticket means a channel id. `on delete restrict` on the
-- channel keeps that true — you deactivate a channel, you do not delete one that
-- has history.
-- -----------------------------------------------------------------------------
alter table public.tickets
  add column if not exists source text not null default 'web';

alter table public.tickets
  add column if not exists channel_id uuid references public.channels (id) on delete restrict;

alter table public.tickets
  drop constraint if exists tickets_source_check;

alter table public.tickets
  add constraint tickets_source_check
  check (source in ('web', 'telegram', 'api', 'widget'));

alter table public.tickets
  drop constraint if exists tickets_channel_source_check;

alter table public.tickets
  add constraint tickets_channel_source_check
  check ((source = 'widget') = (channel_id is not null));

create index if not exists tickets_channel_idx
  on public.tickets (channel_id)
  where channel_id is not null;

comment on column public.tickets.source is
  'Which surface created the ticket. Kept explicit rather than derived, because "web", "api" and "telegram" all have no channel_id and are still different origins.';

-- -----------------------------------------------------------------------------
-- The person behind an external ticket.
--
-- One row per widget ticket. This is the only place a visitor's identity is
-- stored, and it is deliberately separate from `profiles`: a visitor never gets
-- a login, never appears in a dropdown, and is never something to "deactivate".
-- -----------------------------------------------------------------------------
create table if not exists public.ticket_contacts (
  ticket_id   uuid primary key references public.tickets (id) on delete cascade,
  visitor_ref text not null,
  name        text not null,
  email       text not null,
  visitor_ip  inet,
  user_agent  text,
  page_url    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists ticket_contacts_visitor_idx
  on public.ticket_contacts (visitor_ref);

create index if not exists ticket_contacts_ip_idx
  on public.ticket_contacts (visitor_ip, created_at desc);

drop trigger if exists ticket_contacts_set_updated_at on public.ticket_contacts;
create trigger ticket_contacts_set_updated_at
  before update on public.ticket_contacts
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Widget sessions.
--
-- The visitor has no account, so the *only* thing standing between one visitor's
-- conversation and another's is this token. It is minted once when the
-- conversation starts, stored here as a sha256 hash, and kept in the visitor's
-- localStorage — the same shape as an API key, for the same reason: a database
-- dump must not contain anything that can be replayed.
--
-- The invariant that makes it safe: a session is bound to exactly ONE
-- `ticket_id`. `GET /messages` reads that column, never the request, so holding
-- a channel's public key does not let anyone name someone else's ticket.
--
-- No RLS policies on purpose, like `telegram_sessions`: this table is reachable
-- only through the service-role connection, never through PostgREST.
-- -----------------------------------------------------------------------------
create table if not exists public.widget_sessions (
  id           uuid primary key default gen_random_uuid(),
  channel_id   uuid not null references public.channels (id) on delete cascade,
  ticket_id    uuid not null references public.tickets (id) on delete cascade,
  visitor_ref  text not null,
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '30 days',
  last_seen_at timestamptz not null default now()
);

create index if not exists widget_sessions_ticket_idx
  on public.widget_sessions (ticket_id);

create index if not exists widget_sessions_expiry_idx
  on public.widget_sessions (expires_at);

-- -----------------------------------------------------------------------------
-- `notify()` must not write to a machine profile.
--
-- Every widget ticket has the channel's system profile as its requester, so
-- "the requester was notified" would mean a notification row addressed to a
-- robot that nothing ever reads. The visitor hears about replies by polling the
-- widget, which is the honest channel for them.
--
-- Skipping the insert (rather than inserting and hiding) means no notification
-- row, no `notification_deliveries` row, and no Telegram queue entry — the dead
-- weight never gets created in the first place.
-- -----------------------------------------------------------------------------
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
    and exists (
      select 1
        from public.profiles p
       where p.id = p_user_id
         and p.is_active = true
         and p.is_system = false
    );
$$;

-- -----------------------------------------------------------------------------
-- Who wrote this, in words a person reading the timeline understands.
--
-- For a widget ticket the stored author is the channel's system profile, which
-- would render every visitor as "Widget: Acme Support". The contact row holds
-- the real name, so it wins.
-- -----------------------------------------------------------------------------
create or replace function public.ticket_actor_name(p_ticket_id uuid, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select 'Visitor — ' || c.name
        from public.ticket_contacts c
       where c.ticket_id = p_ticket_id
         and exists (
           select 1 from public.tickets t
            where t.id = p_ticket_id
              and t.created_by = p_user_id
              and t.source = 'widget'
         )
    ),
    (
      select case
               when p.role in ('it_support', 'admin') then 'IT Support — ' || p.full_name
               else p.full_name
             end
        from public.profiles p
       where p.id = p_user_id
    )
  );
$$;

-- -----------------------------------------------------------------------------
-- Re-point the two triggers that name an author at the helper.
--
-- `tickets_log_insert` cannot use the contact row: it runs on the ticket's
-- INSERT, and the contact is written immediately after (the foreign key makes
-- any other order impossible). It names the channel instead, which is true at
-- that moment. The first comment follows milliseconds later and carries the
-- visitor's name.
-- -----------------------------------------------------------------------------
create or replace function public.tickets_log_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := coalesce(auth.uid(), new.created_by);
  v_origin text;
begin
  if new.source = 'widget' then
    select 'a visitor via ' || c.name into v_origin
      from public.channels c
     where c.id = new.channel_id;
    v_origin := coalesce(v_origin, 'a website visitor');
  else
    select p.full_name into v_origin
      from public.profiles p
     where p.id = new.created_by;
    v_origin := coalesce(v_origin, 'a user');
  end if;

  insert into public.ticket_history (ticket_id, user_id, action, old_value, new_value)
  values (new.id, v_actor, 'CREATED', null, 'Ticket created by ' || v_origin);

  -- a new ticket is bench business: it goes to the staff bot, never to the
  -- employee bot of a staff member who happens to be off shift
  insert into public.notifications (user_id, ticket_id, title, message, audience)
  select p.id,
         new.id,
         'New ticket ' || new.ticket_number,
         upper(left(v_origin, 1)) || substr(v_origin, 2) || ' created "' || new.title || '"',
         'staff'
  from public.profiles p
  where p.is_active = true
    and p.is_system = false
    and p.role in ('it_support', 'admin')
    and p.id <> new.created_by;

  return new;
end;
$$;

drop trigger if exists tickets_log_insert on public.tickets;
create trigger tickets_log_insert
  after insert on public.tickets
  for each row execute function public.tickets_log_insert();

create or replace function public.comments_log_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.tickets;
  v_author_label text;
begin
  select * into v_ticket from public.tickets where id = new.ticket_id;
  if v_ticket is null then
    return new;
  end if;

  v_author_label := coalesce(public.ticket_actor_name(new.ticket_id, new.user_id), 'Someone');

  insert into public.ticket_history (ticket_id, user_id, action, old_value, new_value)
  values (new.ticket_id, new.user_id, 'COMMENT_ADDED', null, left(new.message, 180));

  -- the requester replied -> notify the assignee, or the whole bench when
  -- unassigned. A widget visitor is the requester here, and their words reach
  -- the bench through the same path an employee's do.
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
      where p.is_active = true
        and p.is_system = false
        and p.role in ('it_support', 'admin');
    end if;
  else
    -- staff replied -> notify the ticket owner. For a widget ticket that owner
    -- is the system profile, and `notify()` drops it: the visitor is watching
    -- the widget, not an inbox.
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

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.channels        enable row level security;
alter table public.ticket_contacts enable row level security;
alter table public.widget_sessions enable row level security;

grant select, insert, update, delete on public.channels        to authenticated;
grant select, insert, update, delete on public.ticket_contacts to authenticated;
grant select, insert, update, delete on public.widget_sessions to authenticated;

-- The widget API never touches PostgREST: it resolves a public key and a session
-- token over the service-role connection. So nothing here needs to be readable
-- anonymously, and nothing is.
drop policy if exists channels_select_staff on public.channels;
create policy channels_select_staff on public.channels
  for select to authenticated
  using (public.is_staff());

drop policy if exists channels_admin_write on public.channels;
create policy channels_admin_write on public.channels
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists ticket_contacts_select on public.ticket_contacts;
create policy ticket_contacts_select on public.ticket_contacts
  for select to authenticated
  using (public.can_access_ticket(ticket_id));

drop policy if exists ticket_contacts_admin_write on public.ticket_contacts;
create policy ticket_contacts_admin_write on public.ticket_contacts
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- The widget writes as the channel's machine profile, which is an ordinary
-- `employee` and therefore not an admin. Filing the contact row is the one write
-- it makes outside the ticket itself, so the policy is narrow enough to be
-- obviously safe: only the ticket's own creator, only on a widget ticket.
-- Without this the insert is refused and the whole conversation fails.
drop policy if exists ticket_contacts_insert_own_ticket on public.ticket_contacts;
create policy ticket_contacts_insert_own_ticket on public.ticket_contacts
  for insert to authenticated
  with check (
    exists (
      select 1
        from public.tickets t
       where t.id = ticket_id
         and t.created_by = auth.uid()
         and t.source = 'widget'
    )
  );

grant execute on function public.ticket_actor_name(uuid, uuid) to authenticated;
