import "server-only";

import { ApiError } from "@/lib/api/errors";
import { resolveWidgetChannel, type WidgetRequestContext } from "@/lib/widget/channels";

/**
 * CORS for the widget API.
 *
 * The widget runs on somebody else's website, so every response has to carry
 * the caller's origin or the browser throws it away. The origin is *reflected*
 * rather than answered with `*` for one reason: it keeps the allowed-origin
 * check meaningful. `*` would tell every site on the internet that it may read
 * the reply.
 *
 * `Vary: Origin` matters because the answer depends on a request header —
 * without it a shared cache could hand one site's response to another.
 */
export function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return { vary: "origin" };

  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-widget-key, x-widget-token",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

function withCors(response: Response, origin: string | null): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders(origin))) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function widgetJson<T>(data: T, init?: ResponseInit): Response {
  return Response.json({ ok: true, data }, init);
}

function widgetError(error: unknown, origin: string | null): Response {
  if (error instanceof ApiError) {
    return withCors(
      Response.json(
        { ok: false, error: { code: error.code, message: error.message, details: error.details } },
        { status: error.status },
      ),
      origin,
    );
  }

  console.error("[widget] unhandled error", error);
  return withCors(
    Response.json(
      { ok: false, error: { code: "internal_error", message: "Something went wrong." } },
      { status: 500 },
    ),
    origin,
  );
}

/**
 * Wraps a widget route with channel resolution, CORS and error translation.
 *
 * The two branches answer different origins on purpose:
 *
 *   success — the channel resolved, so its own allow-list already approved this
 *             origin. Reflecting it is correct, and the response may carry the
 *             visitor's conversation.
 *
 *   failure — there is no data to leak, only a status and a sentence. Reflecting
 *             the origin here is what makes a misconfigured channel debuggable:
 *             the developer reads "Origin … is not allowed" in the network tab
 *             instead of a bare CORS block. If that check ever produced a body
 *             with ticket content, this is the line that would have to change.
 *
 * Handlers return a plain `Response`; the CORS headers are added here so no
 * route can forget them.
 */
export function widgetRoute(
  handler: (ctx: WidgetRequestContext, request: Request) => Promise<Response>,
) {
  return async function route(request: Request): Promise<Response> {
    try {
      const ctx = await resolveWidgetChannel(request);
      return withCors(await handler(ctx, request), ctx.origin);
    } catch (error) {
      return widgetError(error, request.headers.get("origin"));
    }
  };
}

/** `OPTIONS` preflight. Answering it does not require a valid key. */
export function widgetPreflight(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("origin")),
  });
}
