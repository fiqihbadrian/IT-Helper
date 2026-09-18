import { ApiError } from "@/lib/api/errors";

/** Uniform JSON envelope so API consumers can branch on `error.code`. */
export function jsonError(error: unknown) {
  if (error instanceof ApiError) {
    return Response.json(
      {
        ok: false,
        error: { code: error.code, message: error.message, details: error.details },
      },
      { status: error.status },
    );
  }

  console.error("[api] unhandled error", error);
  return Response.json(
    { ok: false, error: { code: "internal_error", message: "Something went wrong." } },
    { status: 500 },
  );
}

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return Response.json({ ok: true, data }, init);
}

/** Pagination shared by every list endpoint. */
export function readPagination(url: URL, defaultLimit = 25, maxLimit = 100) {
  const rawLimit = Number(url.searchParams.get("limit") ?? defaultLimit);
  const rawPage = Number(url.searchParams.get("page") ?? 1);

  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.trunc(rawLimit), 1), maxLimit)
    : defaultLimit;
  const page = Number.isFinite(rawPage) ? Math.max(Math.trunc(rawPage), 1) : 1;

  return { limit, page, offset: (page - 1) * limit };
}
