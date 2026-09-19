-- =============================================================================
-- 0011 — Sign in to the web app with Telegram
--
-- Telegram already knows who you are and we already trust it to act on your
-- behalf: `telegram_links` binds one chat to one profile, and the bot writes to
-- the database as that profile. Signing in is the same fact used one more time.
--
-- The shape is deliberately dull:
--
--   1. The browser asks for a short code and gets a cookie of its own.
--   2. It shows the code and a deep link into the bot.
--   3. You press start. The bot knows which profile your chat is linked to and
--      stamps that profile onto the code row. It cannot stamp anyone else's.
--   4. The browser, still holding its cookie, collects the profile and the
--      server mints it a real Supabase session.
--
-- The code is not a credential for somebody else's account, and that is the
-- whole security argument. Whoever sends `/login CODE` is resolved through
-- `telegram_links` first, so the worst a stolen code buys is a session for the
-- thief's own account. The browser cookie is a second lock: a code lifted out
-- of a shoulder-surfed screen still needs the cookie that was issued alongside
-- it. And the code is single-use and ten minutes old at most.
--
-- Note what is *not* here: no passwords, no magic link in an email, no second
-- identity provider. A profile still has to exist and still has to be active,
-- which is checked again at the moment the session is minted.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Pending sign-ins.
--
-- One row per attempt. `browser_token` is the cookie half of the handshake and
-- `profile_id` is filled in by the bot; the row is only spendable when both are
-- present. Nothing here is readable through PostgREST — no policies and no
-- grants to `anon` or `authenticated`, so the table is service-role only.
-- -----------------------------------------------------------------------------
create table if not exists public.web_login_codes (
  code          text primary key,
  browser_token text not null,
  profile_id    uuid references public.profiles (id) on delete cascade,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  used_at       timestamptz
);

create index if not exists web_login_codes_expires_idx
  on public.web_login_codes (expires_at);

comment on table public.web_login_codes is
  'Pending "sign in with Telegram" handshakes. Service-role only: no policies, no grants to anon or authenticated.';
comment on column public.web_login_codes.browser_token is
  'Random value also stored in an HttpOnly cookie. A code without its cookie cannot be spent.';
comment on column public.web_login_codes.profile_id is
  'Filled in by the bot when the linked chat sends /login CODE. Null means nobody has claimed the code yet.';

alter table public.web_login_codes enable row level security;

revoke all on public.web_login_codes from anon, authenticated;
grant select, insert, update, delete on public.web_login_codes to service_role;

-- -----------------------------------------------------------------------------
-- The bot's half: bind this code to the profile the chat is linked to.
--
-- Called from the Telegram webhook as the system role, never as the caller, so
-- `p_profile_id` comes from `profile_for_telegram_chat()` rather than from
-- anything the sender typed. `profile_id is null` makes the claim first-wins:
-- a second chat cannot overwrite the profile a code already points at.
-- -----------------------------------------------------------------------------
create or replace function public.redeem_web_login_code(p_code text, p_profile_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_profile_id is null then
    return false;
  end if;

  update public.web_login_codes
     set profile_id = p_profile_id
   where code = upper(btrim(p_code))
     and profile_id is null
     and used_at is null
     and expires_at > now();

  return found;
end;
$$;

comment on function public.redeem_web_login_code(text, uuid) is
  'Claims a pending web sign-in for a linked profile. Returns false when the code is unknown, expired, already claimed or already spent.';

-- -----------------------------------------------------------------------------
-- The browser's half: trade the code *and* the cookie for a profile id.
--
-- Only succeeds once the bot has stamped a profile, so polling is free — an
-- unclaimed code returns null and the row is left alone. `used_at` is set in the
-- same statement that reads the profile, so two pollers cannot both win.
-- -----------------------------------------------------------------------------
create or replace function public.consume_web_login_code(p_code text, p_browser_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
begin
  -- a null token must never match, which the comparison already gives us
  if p_browser_token is null or p_browser_token = '' then
    return null;
  end if;

  update public.web_login_codes
     set used_at = now()
   where code = upper(btrim(p_code))
     and browser_token = p_browser_token
     and profile_id is not null
     and used_at is null
     and expires_at > now()
  returning profile_id into v_profile_id;

  return v_profile_id;
end;
$$;

comment on function public.consume_web_login_code(text, text) is
  'Spends a claimed sign-in code. Requires the browser token issued with the code; single use.';

-- Postgres grants EXECUTE to PUBLIC on every new function, so "only the service
-- role may call this" needs saying out loud. Without the revoke, `anon` could
-- claim a code for any profile id it liked — no cookie needed to *claim*, and a
-- claim is what decides whose session a browser ends up holding.
grant execute on function public.redeem_web_login_code(text, uuid) to service_role;
grant execute on function public.consume_web_login_code(text, text) to service_role;
revoke execute on function public.redeem_web_login_code(text, uuid) from public, anon, authenticated;
revoke execute on function public.consume_web_login_code(text, text) from public, anon, authenticated;
