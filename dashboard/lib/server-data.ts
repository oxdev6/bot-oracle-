/**
 * Server-side data access for the dashboard API.
 *
 * This is the ONLY module that should be imported by route handlers. It wraps
 * the raw on-chain readers in `lib/client.ts` with `unstable_cache` so RPC load
 * is bounded (one refresh per TTL, shared across requests) and converts every
 * result to the JSON-safe wire format in `lib/api-types.ts`.
 *
 * When the deployment addresses are unset it returns clearly-flagged demo data
 * instead of failing, so the UI is always renderable.
 */
import { unstable_cache } from "next/cache";
import {
  CHAIN_CONFIG,
  checkRpcConnection,
  getConfigurationError,
  getFeed,
  getOperators,
  getRegistry,
  getRounds,
  getSlashes,
  getToken,
  getVault,
} from "./client";
import {
  DEMO_TOKEN,
  DEMO_VAULT,
  demoFeeds,
  demoOperators,
  demoRounds,
  demoSlashes,
} from "./demo";
import {
  serializeFeed,
  serializeOperator,
  serializeRound,
  serializeSlash,
  serializeToken,
  serializeVault,
  type FeedDetailResponse,
  type OverviewResponse,
  type SerializedFeed,
  type SerializedOperator,
  type SerializedRound,
  type SerializedSlash,
  type SerializedToken,
  type SerializedVault,
} from "./api-types";

const TOKEN_TTL = 60;
const FEEDS_TTL = 15;
const OPERATORS_TTL = 30;
const LOGS_TTL = 30;
const LOG_LIMIT = 60;

/** Cache tags for on-demand revalidation (`revalidateTag`). */
export const CACHE_TAGS = {
  token: "lodestar:token",
  feeds: "lodestar:feeds",
  operators: "lodestar:operators",
  rounds: "lodestar:rounds",
  slashes: "lodestar:slashes",
} as const;

export const getCachedToken = unstable_cache(
  async (): Promise<SerializedToken | null> => {
    const token = await getToken();
    return token ? serializeToken(token) : null;
  },
  ["lodestar-token"],
  { revalidate: TOKEN_TTL, tags: [CACHE_TAGS.token] },
);

export const getCachedVault = unstable_cache(
  async (): Promise<SerializedVault | null> => {
    const vault = await getVault();
    return vault ? serializeVault(vault) : null;
  },
  ["lodestar-vault"],
  { revalidate: TOKEN_TTL, tags: [CACHE_TAGS.token] },
);

export const getCachedFeeds = unstable_cache(
  async (): Promise<SerializedFeed[]> => {
    const registry = await getRegistry();
    const feeds = await Promise.all(registry.map(getFeed));
    return feeds
      .filter((feed): feed is NonNullable<typeof feed> => Boolean(feed))
      .map(serializeFeed);
  },
  ["lodestar-feeds"],
  { revalidate: FEEDS_TTL, tags: [CACHE_TAGS.feeds] },
);

export const getCachedOperators = unstable_cache(
  async (): Promise<SerializedOperator[]> => {
    const operators = await getOperators();
    return operators.map(serializeOperator);
  },
  ["lodestar-operators"],
  { revalidate: OPERATORS_TTL, tags: [CACHE_TAGS.operators] },
);

export const getCachedRounds = unstable_cache(
  async (): Promise<SerializedRound[]> => {
    const rounds = await getRounds(LOG_LIMIT);
    return rounds.map(serializeRound);
  },
  ["lodestar-rounds"],
  { revalidate: LOGS_TTL, tags: [CACHE_TAGS.rounds] },
);

export const getCachedSlashes = unstable_cache(
  async (): Promise<SerializedSlash[]> => {
    const slashes = await getSlashes(LOG_LIMIT);
    return slashes.map(serializeSlash);
  },
  ["lodestar-slashes"],
  { revalidate: LOGS_TTL, tags: [CACHE_TAGS.slashes] },
);

export function isConfigured(): boolean {
  return getConfigurationError() === null;
}

export async function loadFeeds(): Promise<SerializedFeed[]> {
  if (!isConfigured()) return demoFeeds().map(serializeFeed);
  return getCachedFeeds();
}

export async function loadOperators(): Promise<SerializedOperator[]> {
  if (!isConfigured()) return demoOperators().map(serializeOperator);
  return getCachedOperators();
}

export async function loadRounds(): Promise<SerializedRound[]> {
  if (!isConfigured()) return demoRounds().map(serializeRound);
  return getCachedRounds();
}

export async function loadSlashes(): Promise<SerializedSlash[]> {
  if (!isConfigured()) return demoSlashes().map(serializeSlash);
  return getCachedSlashes();
}

/** Feed summary plus its recent round history, for the feed detail page. */
export async function loadFeedDetail(assetId: string): Promise<FeedDetailResponse> {
  const target = assetId.toLowerCase();
  const feeds = await loadFeeds();
  const feed = feeds.find((candidate) => candidate.assetId.toLowerCase() === target) ?? null;
  if (!feed) return { feed: null, rounds: [], error: "Unknown asset id." };
  const rounds = (await loadRounds()).filter((round) => round.assetId.toLowerCase() === target);
  return { feed, rounds, error: null };
}

/** One-shot payload for the landing dashboard. */
export async function loadOverview(): Promise<OverviewResponse> {
  const base = {
    chainId: CHAIN_CONFIG.chainId,
    generatedAt: new Date().toISOString(),
  };

  const configError = getConfigurationError();
  if (configError) return demoOverview(configError, base.chainId, base.generatedAt);

  try {
    await checkRpcConnection();
  } catch (err) {
    return {
      configured: true,
      demo: false,
      ...base,
      token: null,
      vault: null,
      feeds: [],
      operators: [],
      rounds: [],
      slashes: [],
      error: err instanceof Error ? err.message : "The BOT RPC endpoint is unreachable.",
    };
  }

  const [token, vault, feeds, operators, rounds, slashes] = await Promise.all([
    getCachedToken(),
    getCachedVault(),
    getCachedFeeds(),
    getCachedOperators(),
    getCachedRounds(),
    getCachedSlashes(),
  ]);

  return { configured: true, demo: false, ...base, token, vault, feeds, operators, rounds, slashes, error: null };
}

function demoOverview(configError: string, chainId: number, generatedAt: string): OverviewResponse {
  return {
    configured: false,
    demo: true,
    chainId,
    generatedAt,
    token: serializeToken(DEMO_TOKEN),
    vault: serializeVault(DEMO_VAULT),
    feeds: demoFeeds().map(serializeFeed),
    operators: demoOperators().map(serializeOperator),
    rounds: demoRounds().map(serializeRound),
    slashes: demoSlashes().map(serializeSlash),
    error: null,
    configError,
  };
}
