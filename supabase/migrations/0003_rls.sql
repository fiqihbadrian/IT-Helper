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
