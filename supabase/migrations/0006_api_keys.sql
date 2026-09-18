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
