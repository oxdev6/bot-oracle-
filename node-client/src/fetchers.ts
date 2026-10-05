import type { FeedConfig, PriceObservation, SourceName } from "./types";

export type { PriceObservation } from "./types";

/**
 * Fetch a single price for a feed from its configured sources.
 * Returns every observation captured, or throws if all sources fail.
 */
export async function fetchFeed(feed: FeedConfig): Promise<PriceObservation[]> {
  const results = await Promise.allSettled(
    feed.sources.map(async (source) => {
      const obs = await dispatchFetch(source.name, feed, source.params);
      return { source: source.name, ...obs };
    }),
  );

  const ok = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<PriceObservation>[];
  const failed = results.filter((r) => r.status === "rejected");

  for (const f of failed) {
    console.warn(`[fetcher:${feed.symbol}] source failed:`, (f as PromiseRejectedResult).reason?.message ?? f);
  }
  if (ok.length === 0) {
    throw new Error(`all sources failed for ${feed.symbol}`);
  }
  return ok.map((r) => r.value);
}

async function dispatchFetch(
  name: SourceName,
  feed: FeedConfig,
  params?: Record<string, string>,
): Promise<Omit<PriceObservation, "source">> {
  switch (name) {
    case "binance":
      return fetchBinance(feed, params);
    case "coingecko":
      return fetchCoinGecko(feed, params);
    case "bdex":
      return fetchBdex(feed, params);
    default:
      throw new Error(`unknown source: ${name}`);
  }
}

// ─────────────────────────── Binance ──────────────────────────────────

async function fetchBinance(
  feed: FeedConfig,
  params?: Record<string, string>,
): Promise<Omit<PriceObservation, "source">> {
  const symbol = params?.symbol ?? feed.symbol.replace("/", "");
  const base = params?.baseUrl ?? "https://api.binance.com";
  const res = await fetch(`${base}/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`binance ${symbol} HTTP ${res.status}`);
  const json: any = await res.json();
  const price = Number(json.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error(`binance ${symbol} invalid price`);
  return {
    assetId: feed.assetId,
    priceUsd: price,
    sourceTimestamp: Date.now(),
    fetchedAt: Date.now(),
  };
}

// ─────────────────────────── CoinGecko ────────────────────────────────

async function fetchCoinGecko(
  feed: FeedConfig,
  params?: Record<string, string>,
): Promise<Omit<PriceObservation, "source">> {
  const id = params?.id ?? feed.symbol.split("/")[0].toLowerCase();
  const vs = params?.vs ?? "usd";
  const base = params?.baseUrl ?? "https://api.coingecko.com/api/v3";
  const key = params?.apiKey;
  const url = new URL(`${base}/simple/price`);
  url.searchParams.set("ids", id);
  url.searchParams.set("vs_currencies", vs);
  if (key) url.searchParams.set("x_cg_demo_api_key", key);

  const res = await fetch(url, {
    headers: { Accept: "application/json", ...(key ? { "x-cg-demo-api-key": key } : {}) },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 429) throw new Error("coingecko rate-limit (429)");
  if (res.status === 401 || res.status === 403) throw new Error(`coingecko auth required (${res.status})`);
  if (!res.ok) throw new Error(`coingecko HTTP ${res.status}`);
  const json: any = await res.json();
  const tick = json[id];
  if (!tick || typeof tick[vs] !== "number" || !Number.isFinite(tick[vs]) || tick[vs] <= 0) {
    throw new Error(`coingecko no price for "${id}"`);
  }
  return {
    assetId: feed.assetId,
    priceUsd: tick[vs],
    sourceTimestamp: Date.now(),
    fetchedAt: Date.now(),
  };
}

// ─────────────────────────── BDEX (DEX pool) ──────────────────────────

import { createPublicClient, http, parseAbi } from "viem";

const POOL_ABI = parseAbi([
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
]);

/**
 * Read a UniswapV2-style pool price. Token decimals come from the feed
 * config (`token0Decimals` / `token1Decimals`, default 18).
 */
async function fetchBdex(
  feed: FeedConfig,
  params?: Record<string, string>,
): Promise<Omit<PriceObservation, "source">> {
  if (!params?.pool) throw new Error("bdex source requires params.pool");
  const rpcUrl = params?.rpcUrl ?? "https://rpc.bohr.life";
  const client = createPublicClient({ transport: http(rpcUrl, { timeout: 10_000 }) });

  const reserves = await client.readContract({
    address: params.pool as `0x${string}`,
    abi: POOL_ABI,
    functionName: "getReserves",
  });

  const t0 = Number(params.token0Decimals ?? 18);
  const t1 = Number(params.token1Decimals ?? 18);
  const invert = params?.invert === "true";

  let price: number;
  if (invert) {
    price = Number(reserves[1]) / 10 ** t1 / (Number(reserves[0]) / 10 ** t0);
  } else {
    price = Number(reserves[0]) / 10 ** t0 / (Number(reserves[1]) / 10 ** t1);
  }
  if (!Number.isFinite(price) || price <= 0) throw new Error(`bdex pool invalid price ${price}`);
  return {
    assetId: feed.assetId,
    priceUsd: price,
    sourceTimestamp: Date.now(),
    fetchedAt: Date.now(),
  };
}