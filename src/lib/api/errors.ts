/**
 * Stable, client-safe error codes. Responses expose ONLY these codes plus a
 * short generic message — never a secret, stack trace, third-party error body
 * or another user's data (§4.4).
 */
export const ErrorCode = {
  RATE_LIMITED: "rate_limited",
  UNAUTHENTICATED: "unauthenticated",
  FORBIDDEN: "forbidden",
  VALIDATION_FAILED: "validation_failed",
  NOT_FOUND: "not_found",
  CONFLICT: "conflict",
  INTERNAL: "internal_error",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

const STATUS: Record<ErrorCode, number> = {
  [ErrorCode.RATE_LIMITED]: 429,
  [ErrorCode.UNAUTHENTICATED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.VALIDATION_FAILED]: 422,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.INTERNAL]: 500,
};

/**
 * The only error type the pipeline turns into a structured client response.
 * `details` is optional and must contain NOTHING sensitive — it is meant for
 * field-level validation hints, not internal diagnostics.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message ?? code);
    this.name = "ApiError";
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }

  static rateLimited() {
    return new ApiError(ErrorCode.RATE_LIMITED, "Too many requests");
  }
  static unauthenticated() {
    return new ApiError(ErrorCode.UNAUTHENTICATED, "Authentication required");
  }
  static forbidden() {
    return new ApiError(ErrorCode.FORBIDDEN, "Not allowed");
  }
  static validation(details?: unknown) {
    return new ApiError(ErrorCode.VALIDATION_FAILED, "Invalid request", details);
  }
  static notFound() {
    return new ApiError(ErrorCode.NOT_FOUND, "Not found");
  }
  static conflict(message = "Conflict") {
    return new ApiError(ErrorCode.CONFLICT, message);
  }
}
