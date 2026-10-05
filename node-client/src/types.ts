/** Shared types for the Lodestar node operator client. */

export type SourceName = "binance" | "coingecko" | "bdex";

export interface BdexSourceConfig {
  chainId: string;
  rpcUrl: string;
  pool: string;            // UniswapV2-style pool address
  token0Decimals?: number; // default 18
  token1Decimals?: number; // default 18
  invert?: boolean;        // if token0 is the quote asset
}

export interface SourceConfig {
  name: SourceName;
  params?: Record<string, string>;
}

export interface FeedConfig {
  /** On-chain id: keccak256 of `${symbol}`. */
  assetId: string;
  /** Human symbol shown on the dashboard, e.g. "BOT/USDT". */
  symbol: string;
  /** Answer decimals on-chain (8 for usd pairs). */
  feedDecimals: number;
  /** Sources this node samples for this feed. */
  sources: SourceConfig[];
}

export interface ChainConfig {
  rpcUrl: string;
  chainId: number;
  aggregator: string;
  scannerUrl: string;
}

export interface OperatorConfig {
  /** Operator private key (0x-prefixed hex). MUST come from env. */
  privateKey: string;
  /** In-USD sanity bound: skip submissions deviating more than this (%) from own median. */
  maxLocalDeviationPct: number;
  /** Jitter (seconds) added to the round timer to avoid thundering herd. */
  jitterSeconds: number;
}

export interface BotOracleConfig {
  chain: ChainConfig;
  operator: OperatorConfig;
  feeds: FeedConfig[];
}

export interface PriceObservation {
  source: SourceName;
  assetId: string;
  /** USD-normalized price, as a number. */
  priceUsd: number;
  /** Time the underlying source reported this price (ms epoch). */
  sourceTimestamp: number;
  fetchedAt: number;
}

export interface AggregateResult {
  assetId: string;
  medianUsd: number;
  observations: PriceObservation[];
  /** Max pairwise deviation % between kept observations. */
  spreadPct: number;
}

/** Decoding helpers for contract return types. */
export interface FeedHealth {
  isPaused: boolean;
  isStale: boolean;
  hasPrice: boolean;
  lastUpdate: bigint;
  lastRoundSubmissions: bigint;
  lastRoundVetoed: bigint;
  roundStart: bigint;
  nextRoundAt: bigint;
  currentRound: bigint;
  openRoundSubmissions: bigint;
}

export interface LatestPrice {
  price: bigint;
  updatedAt: bigint;
  roundId: bigint;
  decimals: number;
  isPaused: boolean;
}