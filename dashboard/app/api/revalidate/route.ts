/**
 * POST (and GET) /api/revalidate — bust the dashboard's cached on-chain reads.
 *
 * This is the privileged, secret-gated entry point for operators, external
 * schedulers, and CI. The dashboard's own "Refresh" control does NOT call it
 * (a browser cannot hold a server-only secret); it uses the same-origin
 * `refreshDashboard` Server Action instead. Both paths share `revalidateAll()`.
 *
 * Callers must present the shared secret as either:
 *   - `x-revalidate-secret: <secret>`, or
 *   - `Authorization: Bearer <secret>` (Vercel Cron sends this when the
 *     CRON_SECRET environment variable is set).
 *
 * The expected secret is `REVALIDATE_SECRET`, falling back to `CRON_SECRET`.
 * The endpoint is fail-closed: with neither variable set it refuses every
 * request (503), so a misconfigured deploy can never expose a public
 * cache-buster. Requests are also rate-limited per client IP.
 */
import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { revalidateAll } from "@/lib/server-data";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const MAX_PER_MINUTE = 10;

function expectedSecret(): string | null {
  const secret = process.env.REVALIDATE_SECRET ?? process.env.CRON_SECRET;
  return secret && secret.length > 0 ? secret : null;
}

function safeEqual(a: string, b: string): boolean {
  const aBytes = Buffer.from(a);
  const bBytes = Buffer.from(b);
  if (aBytes.length !== bBytes.length) return false;
  return timingSafeEqual(aBytes, bBytes);
}

function presentedSecret(request: NextRequest): string {
  const direct = request.headers.get("x-revalidate-secret");
  if (direct) return direct;
  const auth = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  return match ? match[1].trim() : "";
}

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

async function handle(request: NextRequest): Promise<NextResponse> {
  // Rate-limit first so unauthenticated callers cannot burn the secret check.
  const limit = rateLimit(clientIp(request), MAX_PER_MINUTE);
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: "rate limited" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const secret = expectedSecret();
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "revalidation is disabled (REVALIDATE_SECRET is not set)" },
      { status: 503 },
    );
  }

  if (!safeEqual(presentedSecret(request), secret)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Immediate expiration: the next read is a blocking cache miss, so the
  // caller observes fresh on-chain data right away.
  revalidateAll();
  return NextResponse.json({ ok: true, revalidatedAt: new Date().toISOString() });
}

export const POST = handle;
export const GET = handle;
