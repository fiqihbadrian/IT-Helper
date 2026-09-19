import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApiError, badRequest, forbidden, unauthorized } from "@/lib/api/errors";import { jsonError, jsonOk } from "@/lib/api/response";
import {
  BROWSER_COOKIE,
  LOGIN_CODE_LENGTH,
  LOGIN_TTL_MS,
  generateBrowserToken,
  generateLoginCode,
  loginBotLinks,
  normaliseCode,
} from "@/lib/telegram/login";
import { safeNextPath } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sign in with Telegram, browser side.
 *
 *   POST  start a handshake and return the code to show the visitor
 *   GET   poll it; the third answer is a session cookie
 *
 * Both halves are unauthenticated by definition — this is the login. What keeps
 * it honest is that the code alone is worthless: only a chat linked to a profile
 * can claim it, and only the browser holding the matching cookie can spend it.
 * See 0011_web_login.sql.
 */

function secureCookie(request: Request) {
  // `next dev` and `wrangler dev` serve plain http; a Secure cookie would be
  // dropped there and the handshake would never complete locally.
  return (
    new URL(request.url).protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https"
  );
}

export async function POST(request: NextRequest) {
  try {
    const service = createAdminClient();
    const browserToken = generateBrowserToken();
    const expiresAt = new Date(Date.now() + LOGIN_TTL_MS);

    // Housekeeping on the way in: nobody polls a finished handshake, so old rows
    // are cleared here rather than by a scheduled job.
    await service
      .from("web_login_codes")
      .delete()
      .lt("expires_at", new Date(Date.now() - LOGIN_TTL_MS).toISOString());

    // A collision needs a simultaneous duplicate of an 8-character code; three
    // attempts is generosity, not a plan.
    let code: string | null = null;
    for (let attempt = 0; attempt < 3 && !code; attempt += 1) {
      const candidate = generateLoginCode();
      const { error } = await service.from("web_login_codes").insert({
        code: candidate,
        browser_token: browserToken,
        expires_at: expiresAt.toISOString(),
      });

      if (!error) code = candidate;
      else if (error.code !== "23505") throw new Error(error.message);
    }

    if (!code) throw new Error("could not allocate a login code");

    const response = NextResponse.json({
      ok: true,
      data: { code, expiresAt: expiresAt.toISOString(), links: loginBotLinks(code) },
    });

    response.cookies.set(BROWSER_COOKIE, browserToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(LOGIN_TTL_MS / 1000),
      secure: secureCookie(request),
    });

    return response;
  } catch (error) {
    return jsonError(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const code = normaliseCode(url.searchParams.get("code") ?? "");
    const browserToken = request.cookies.get(BROWSER_COOKIE)?.value ?? "";

    if (code.length !== LOGIN_CODE_LENGTH || !browserToken) {
      throw badRequest("This sign-in is no longer valid. Start again.");
    }

    const service = createAdminClient();
    const { data: profileId, error } = await service.rpc("consume_web_login_code", {
      p_code: code,
      p_browser_token: browserToken,
    });

    if (error) throw new Error(error.message);

    if (!profileId) {
      // Not claimed yet, or never will be. Telling the two apart matters: the
      // page stops polling once the code is dead instead of waiting out the
      // clock on a row that is gone.
      const { data: row } = await service
        .from("web_login_codes")
        .select("expires_at, used_at")
        .eq("code", code)
        .maybeSingle();

      const alive =
        row && row.used_at === null && new Date(row.expires_at).getTime() > Date.now();
      return jsonOk({ status: alive ? "pending" : "expired" });
    }

    // The profile is re-checked here rather than trusted from the bot: a machine
    // account (a widget channel) must never hold a browser session, and an
    // account disabled since the code was issued must not slip through.
    const { data: profile } = await service
      .from("profiles")
      .select("email, full_name, role, is_active, is_system")
      .eq("id", profileId)
      .maybeSingle();

    if (!profile) throw unauthorized("That account no longer exists.");
    if (profile.is_system) throw forbidden("This account cannot sign in.");
    if (!profile.is_active) throw forbidden("This account is deactivated. Contact IT support.");

    const { data: link, error: linkError } = await service.auth.admin.generateLink({
      type: "magiclink",
      email: profile.email,
    });

    const tokenHash = link?.properties?.hashed_token;
    if (linkError || !tokenHash) {
      throw new Error(linkError?.message ?? "could not mint a session link");
    }

    // `createClient()` writes through the cookie adapter, so this is where the
    // session actually lands in the browser.
    const supabase = await createClient();
    const { error: otpError } = await supabase.auth.verifyOtp({
      type: "magiclink",
      token_hash: tokenHash,
    });

    if (otpError) throw new Error(otpError.message);

    const next = safeNextPath(url.searchParams.get("next"));

    return jsonOk({
      status: "ready",
      redirect: next,
      profile: { name: profile.full_name, role: profile.role },
    });
  } catch (error) {
    return jsonError(error);
  }
}
