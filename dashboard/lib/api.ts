/**
 * Browser-side client for the dashboard HTTP API (`app/api/*`).
 *
 * The dashboard no longer reads the BOT RPC directly from the browser; it goes
 * through the cached server API, which keeps a single origin of truth and stops
 * every open tab from hammering the RPC. These helpers fetch the JSON wire
 * format and rehydrate it into the richer on-chain types from `lib/client.ts`.
 */
import { refreshDashboard } from "@/app/actions";
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
 * The server caches on-chain reads indefinitely (`revalidate: false`), so a
 * refresh has to invalidate those tags before re-reading. This invokes the
 * same-origin `refreshDashboard` Server Action, which Next.js protects with its
 * built-in origin check — no client-side secret required. After it resolves,
 * the following `fetchOverview`/`fetchFeedDetail` reads recompute from chain.
 *
 * The dashboard never refreshes itself; this only runs on an explicit click.
 */
export async function revalidateDashboard(): Promise<void> {
  await refreshDashboard();
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
