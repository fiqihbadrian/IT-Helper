/**
 * API error types.
 *
 * Every failure carries a stable machine-readable `code` alongside the HTTP
 * status, so an integration can branch on the code instead of parsing English.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, "bad_request", message, details);

export const unauthorized = (message = "Missing or invalid API key.", details?: unknown) =>
  new ApiError(401, "unauthorized", message, details);

export const forbidden = (message = "Your role does not allow this action.", details?: unknown) =>
  new ApiError(403, "forbidden", message, details);

export const notFound = (message = "Not found.") => new ApiError(404, "not_found", message);

export const tooManyRequests = (message = "Too many requests. Please slow down.") =>
  new ApiError(429, "rate_limited", message);
