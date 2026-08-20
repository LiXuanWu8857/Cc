/**
 * Rate limiting (§4.12).
 *
 * This is the APPLICATION-layer limiter. In production it sits behind
 * Cloudflare WAF limits (per-IP, bot protection) — the two together satisfy
 * the IP + account + endpoint dimensions the spec requires.
 *
 * The in-memory implementation below is a correct fixed-window limiter for a
 * single process only. It is NOT suitable for multi-instance deploys — swap in
 * a shared store (e.g. Redis/Upstash) via the `RateLimiter` interface without
 * touching call sites.
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export interface RateLimiter {
  check(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}

class InMemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      const resetAt = now + windowMs;
      this.buckets.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: limit - 1, resetAt };
    }

    if (bucket.count >= limit) {
      return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
    }

    bucket.count += 1;
    return { allowed: true, remaining: limit - bucket.count, resetAt: bucket.resetAt };
  }
}

export const rateLimiter: RateLimiter = new InMemoryRateLimiter();

/** Per-endpoint policies. Tighten upload/OCR/AI when those routes land (§4.12). */
export const RATE_POLICIES = {
  default: { limit: 60, windowMs: 60_000 },
  write: { limit: 30, windowMs: 60_000 },
} as const;
