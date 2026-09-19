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
--   the employee bot  "employee"  self-service only: report and follow a ticket
--   the staff bot     "staff"     the bench: queue, claim, close
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
-- the employee bot, which is the only one that existed then, so 'employee' is the honest
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
