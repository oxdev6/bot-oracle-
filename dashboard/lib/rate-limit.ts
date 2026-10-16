/**
 * Tiny in-memory fixed-window rate limiter.
 *
 * This is best-effort defence-in-depth: on serverless platforms each instance
 * keeps its own Map, so a caller spread across many warm instances can still
 * exceed the nominal limit. The revalidation secret is the primary control;
 * this limiter only blunts accidental or single-origin hammering.
 *
 * The Map is bounded (`MAX_KEYS`) so a flood of spoofed keys cannot grow it
 * without bound.
 */

interface Window {
  count: number;
  resetAt: number;
}

const DEFAULT_MAX_REQUESTS = 10;
const DEFAULT_WINDOW_MS = 60_000;
const MAX_KEYS = 1000;

const buckets = new Map<string, Window>();

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the window resets; 0 when allowed. */
  retryAfterSeconds: number;
}

export function rateLimit(
  key: string,
  max = DEFAULT_MAX_REQUESTS,
  windowMs = DEFAULT_WINDOW_MS,
): RateLimitResult {
  const now = Date.now();
  const window = buckets.get(key);

  if (!window || window.resetAt <= now) {
    if (buckets.size >= MAX_KEYS) evict(now);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSeconds: 0 };
  }

  if (window.count >= max) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - now) / 1000)) };
  }

  window.count += 1;
  return { ok: true, retryAfterSeconds: 0 };
}

function evict(now: number): void {
  for (const [key, window] of buckets) {
    if (window.resetAt <= now) buckets.delete(key);
  }
  // Map preserves insertion order, so the front entry is the oldest.
  while (buckets.size >= MAX_KEYS) {
    const oldest = buckets.keys().next().value;
    if (oldest === undefined) break;
    buckets.delete(oldest);
  }
}
