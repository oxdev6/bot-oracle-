/**
 * Wire format for the dashboard HTTP API.
 *
 * `bigint` and `Date` values cannot survive `JSON.stringify` (bigint throws,
 * Date silently becomes a string on the way back), so every on-chain value is
 * serialized to a decimal string and every timestamp to an ISO-8601 string.
 * The `serialize*`/`deserialize*` helpers convert between the on-chain types in
 * `lib/client.ts` and these wire types, and are the single place that knows
 * which fields are encoded.
 */
import type {
  FeedSnapshot,
  OperatorRow,
  RoundRow,
  SlashRow,
  TokenSnapshot,
  VaultSnapshot,
} from "./client";

export interface SerializedFeed {
  assetId: string;
  symbol: string;
  decimals: number;
  price: string;
  updatedAt: string;
  roundId: number;
  isPaused: boolean;
  isStale: boolean;
  hasPrice: boolean;
  roundStart: string;
  nextRoundAt: string;
  submissionsInRound: number;
  currentRound: number;
  scannerLink: string;
}

export interface SerializedToken {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
}

export interface SerializedVault {
  totalStake: string;
}

export interface SerializedOperator {
  address: string;
  stake: string;
  isEligible: boolean;
}

export interface SerializedRound {
  assetId: string;
  roundId: number;
  price: string;
  inThresholdSubmissions: number;
  vetoed: number | null;
  timestamp: string;
}

export interface SerializedSlash {
  operator: string;
  amount: string;
  pendingCanceled: string;
  reason: string;
  txHash: string;
  timestamp: string;
}

export interface OverviewResponse {
  configured: boolean;
  demo: boolean;
  chainId: number;
  generatedAt: string;
  token: SerializedToken | null;
  vault: SerializedVault | null;
  feeds: SerializedFeed[];
  operators: SerializedOperator[];
  rounds: SerializedRound[];
  slashes: SerializedSlash[];
  error: string | null;
  /** Present when demo mode is active: why the live deployment is unavailable. */
  configError?: string;
}

export interface FeedDetailResponse {
  feed: SerializedFeed | null;
  rounds: SerializedRound[];
  error: string | null;
}

export function serializeFeed(feed: FeedSnapshot): SerializedFeed {
  return {
    ...feed,
    price: feed.price.toString(),
    updatedAt: feed.updatedAt.toISOString(),
    roundStart: feed.roundStart.toISOString(),
    nextRoundAt: feed.nextRoundAt.toISOString(),
  };
}

export function deserializeFeed(feed: SerializedFeed): FeedSnapshot {
  return {
    ...feed,
    price: BigInt(feed.price),
    updatedAt: new Date(feed.updatedAt),
    roundStart: new Date(feed.roundStart),
    nextRoundAt: new Date(feed.nextRoundAt),
  };
}

export function serializeToken(token: TokenSnapshot): SerializedToken {
  return { ...token, totalSupply: token.totalSupply.toString() };
}

export function deserializeToken(token: SerializedToken): TokenSnapshot {
  return { ...token, totalSupply: BigInt(token.totalSupply) };
}

export function serializeVault(vault: VaultSnapshot): SerializedVault {
  return { totalStake: vault.totalStake.toString() };
}

export function deserializeVault(vault: SerializedVault): VaultSnapshot {
  return { totalStake: BigInt(vault.totalStake) };
}

export function serializeOperator(operator: OperatorRow): SerializedOperator {
  return { ...operator, stake: operator.stake.toString() };
}

export function deserializeOperator(operator: SerializedOperator): OperatorRow {
  return { ...operator, stake: BigInt(operator.stake) };
}

export function serializeRound(round: RoundRow): SerializedRound {
  return { ...round, price: round.price.toString(), timestamp: round.timestamp.toISOString() };
}

export function deserializeRound(round: SerializedRound): RoundRow {
  return { ...round, price: BigInt(round.price), timestamp: new Date(round.timestamp) };
}

export function serializeSlash(slash: SlashRow): SerializedSlash {
  return {
    ...slash,
    amount: slash.amount.toString(),
    pendingCanceled: slash.pendingCanceled.toString(),
    timestamp: slash.timestamp.toISOString(),
  };
}

export function deserializeSlash(slash: SerializedSlash): SlashRow {
  return {
    ...slash,
    amount: BigInt(slash.amount),
    pendingCanceled: BigInt(slash.pendingCanceled),
    timestamp: new Date(slash.timestamp),
  };
}
