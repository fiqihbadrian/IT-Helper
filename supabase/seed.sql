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
