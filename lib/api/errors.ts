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

export const unauthorized = (message = "Missing or invalid API key.") =>
  new ApiError(401, "unauthorized", message);

export const forbidden = (message = "Your role does not allow this action.") =>
  new ApiError(403, "forbidden", message);

export const notFound = (message = "Not found.") => new ApiError(404, "not_found", message);
