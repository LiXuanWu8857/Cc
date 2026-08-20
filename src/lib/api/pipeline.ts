import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createRlsClient } from "@/lib/supabase/server";
import { ApiError, ErrorCode } from "./errors";
import { RATE_POLICIES, rateLimiter, type RateLimiter } from "./rate-limit";

/**
 * The single fixed request pipeline every API route runs through (§4.4):
 *
 *   Rate Limit -> Authentication -> Schema Validation -> Authorization
 *   -> Business Logic -> (DB + RLS) -> Audit -> Minimal Response
 *
 * Authorization and audit happen inside the handler (they are resource
 * specific), but authentication, validation, rate limiting and safe error
 * shaping are enforced here so no route can forget them.
 */
export interface PipelineContext<TBody> {
  req: NextRequest;
  /** Verified user. Never trust an id from the body — read it from here. */
  user: User;
  /** RLS-bound client. All DB access for the request goes through this. */
  db: SupabaseClient;
  /** Parsed & whitelisted body (unknown keys rejected). `undefined` for GET. */
  body: TBody;
  /** Correlation id for logs / audit. Contains no PII. */
  requestId: string;
}

interface PipelineOptions<TSchema extends z.ZodTypeAny> {
  /** Zod schema for the request body. Omit for read-only endpoints. */
  schema?: TSchema;
  rate?: { limit: number; windowMs: number };
  limiter?: RateLimiter;
}

type Handler<TBody> = (ctx: PipelineContext<TBody>) => Promise<NextResponse>;

export function withPipeline<TSchema extends z.ZodTypeAny = z.ZodUndefined>(
  options: PipelineOptions<TSchema>,
  handler: Handler<TSchema extends z.ZodTypeAny ? z.infer<TSchema> : undefined>,
) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const requestId = crypto.randomUUID();
    const limiter = options.limiter ?? rateLimiter;
    const rate = options.rate ?? RATE_POLICIES.default;

    try {
      // 1. Rate limit (per-IP; per-user tightening happens after auth).
      const ip = clientIp(req);
      const rl = await limiter.check(`ip:${ip}:${req.nextUrl.pathname}`, rate.limit, rate.windowMs);
      if (!rl.allowed) throw ApiError.rateLimited();

      // 2. Authentication — identity comes ONLY from the verified session.
      const db = createRlsClient();
      const {
        data: { user },
        error: authError,
      } = await db.auth.getUser();
      if (authError || !user) throw ApiError.unauthenticated();

      // 2b. Per-user rate limit (defence against a single hot account).
      const rlUser = await limiter.check(`user:${user.id}:${req.nextUrl.pathname}`, rate.limit, rate.windowMs);
      if (!rlUser.allowed) throw ApiError.rateLimited();

      // 3. Schema validation — strict, unknown keys rejected (mass-assignment,
      //    Threat Model #9). Body is read only when a schema is declared.
      let body: unknown = undefined;
      if (options.schema) {
        const raw = await readJson(req);
        const parsed = options.schema.safeParse(raw);
        if (!parsed.success) {
          throw ApiError.validation(parsed.error.flatten());
        }
        body = parsed.data;
      }

      // 4-7. Authorization + business logic + DB(+RLS) + audit live in handler.
      return await handler({
        req,
        user,
        db,
        body: body as never,
        requestId,
      });
    } catch (err) {
      return toErrorResponse(err, requestId);
    }
  };
}

async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw ApiError.validation({ body: ["Expected a JSON object"] });
  }
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Shapes every failure into a minimal, non-leaky response. Unexpected errors
 * are logged server-side under the requestId and surfaced to the client only
 * as a generic 500 — never the underlying message (§4.4).
 */
function toErrorResponse(err: unknown, requestId: string): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, details: err.details }, requestId },
      { status: err.status },
    );
  }

  // Unknown/unexpected: log internally, reveal nothing.
  console.error(`[${requestId}] Unhandled error:`, err);
  return NextResponse.json(
    { error: { code: ErrorCode.INTERNAL, message: "Something went wrong" }, requestId },
    { status: 500 },
  );
}
