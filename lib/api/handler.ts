import "server-only";

import { resolveIdentity, withIdentity, type ApiContext } from "@/lib/api/auth";
import { jsonError } from "@/lib/api/response";

/** Route context Next.js passes to dynamic segments; `params` is async in v15. */
export interface RouteContext<P = Record<string, string>> {
  params: Promise<P>;
}

/**
 * Wraps a route handler with authentication, error translation and the
 * per-request database transaction.
 *
 * The whole handler body runs inside one transaction impersonating the API key's
 * owner, which is what makes several queries in a single request see a
 * consistent identity — and what makes multi-statement writes atomic.
 */
export function apiRoute(handler: (ctx: ApiContext, request: Request) => Promise<Response>) {
  return async function route(request: Request): Promise<Response> {
    try {
      const identity = await resolveIdentity(request);
      return await withIdentity(identity, (ctx) => handler(ctx, request));
    } catch (error) {
      return jsonError(error);
    }
  };
}

/**
 * Same contract, for routes with a dynamic segment. The params are resolved
 * before the transaction opens so a malformed URL never holds a connection.
 */
export function apiRouteWithParams<P extends Record<string, string>>(
  handler: (
    ctx: ApiContext,
    request: Request,
    params: P,
  ) => Promise<Response>,
) {
  return async function route(request: Request, context: RouteContext<P>): Promise<Response> {
    try {
      const params = await context.params;
      const identity = await resolveIdentity(request);
      return await withIdentity(identity, (ctx) => handler(ctx, request, params));
    } catch (error) {
      return jsonError(error);
    }
  };
}
