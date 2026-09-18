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
