/**
 * Browser-side client for the dashboard HTTP API (`app/api/*`).
 *
 * The dashboard no longer reads the BOT RPC directly from the browser; it goes
 * through the cached server API, which keeps a single origin of truth and stops
 * every open tab from hammering the RPC. These helpers fetch the JSON wire
 * format and rehydrate it into the richer on-chain types from `lib/client.ts`.
 */
import {
  deserializeFeed,
  deserializeOperator,
  deserializeRound,
  deserializeSlash,
  deserializeToken,
  deserializeVault,
  type FeedDetailResponse,
  type OverviewResponse,
} from "./api-types";
import type { FeedSnapshot, OperatorRow, RoundRow, SlashRow, TokenSnapshot, VaultSnapshot } from "./client";

export interface DashboardData {
  configured: boolean;
  demo: boolean;
  chainId: number;
  generatedAt: string;
  configError?: string;
  token: TokenSnapshot | null;
  vault: VaultSnapshot | null;
  feeds: FeedSnapshot[];
  operators: OperatorRow[];
  rounds: RoundRow[];
  slashes: SlashRow[];
  error: string | null;
}

async function getJson<T>(url: string): Promise<{ ok: boolean; status: number; body: T | null }> {
  const response = await fetch(url, { cache: "no-store" });
  let body: T | null = null;
  try {
    body = (await response.json()) as T;
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body };
}

/**
 * Called by the dashboard's explicit "Refresh" action.
 *
 * Historically this POSTed to `/api/revalidate` to bust the server cache. That
 * endpoint is now gated behind a server-only secret that browsers cannot hold,
 * so the client-side refresh is a soft refresh: `fetchOverview` re-reads the
 * cached API and may serve data up to one cache TTL (15–60s) old. Freshness is
 * kept current by a scheduled caller of `/api/revalidate` (see
 * `docs/ops-runbook.md`).
 */
export async function revalidateDashboard(): Promise<void> {
  // Intentionally a no-op — see the doc comment above.
}

export async function fetchOverview(): Promise<DashboardData> {
  const { ok, status, body } = await getJson<OverviewResponse>("/api/overview");
  if (!body) throw new Error(`The dashboard API is unavailable (HTTP ${status}).`);
  if (!ok && body.error) throw new Error(body.error);
  return {
    configured: body.configured,
    demo: body.demo,
    chainId: body.chainId,
    generatedAt: body.generatedAt,
    configError: body.configError,
    token: body.token ? deserializeToken(body.token) : null,
    vault: body.vault ? deserializeVault(body.vault) : null,
    feeds: (body.feeds ?? []).map(deserializeFeed),
    operators: (body.operators ?? []).map(deserializeOperator),
    rounds: (body.rounds ?? []).map(deserializeRound),
    slashes: (body.slashes ?? []).map(deserializeSlash),
    error: body.error,
  };
}

export interface FeedDetail {
  feed: FeedSnapshot | null;
  rounds: RoundRow[];
  error: string | null;
}

export async function fetchFeedDetail(assetId: string): Promise<FeedDetail> {
  const { ok, status, body } = await getJson<FeedDetailResponse>(`/api/feeds/${assetId}`);
  if (!body) throw new Error(`The dashboard API is unavailable (HTTP ${status}).`);
  return {
    feed: body.feed ? deserializeFeed(body.feed) : null,
    rounds: (body.rounds ?? []).map(deserializeRound),
    error: body.error ?? (ok ? null : `HTTP ${status}`),
  };
}
