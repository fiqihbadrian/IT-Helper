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
