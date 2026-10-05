/**
 * Deterministic-but-live DEMO data for the dashboard.
 *
 * Used ONLY when the on-chain addresses are not configured yet. It exists so
 * the product renders a fully populated, self-running dashboard for proposals
 * and local testing. The banner at the top of the view marks it clearly as
 * demo data — never blend this with real on-chain numbers.
 *
 * Demo rows use the same types as the live on-chain reader (lib/client.ts) so
 * the two modes are interchangeable.
 */
import type { FeedSnapshot, TokenSnapshot, VaultSnapshot, OperatorRow, RoundRow, SlashRow } from "./client";

const now = Date.now();

// ── token ────────────────────────────────────────────────
export const DEMO_TOKEN: TokenSnapshot = {
  name: "Lodestar",
  symbol: "LODE",
  decimals: 18,
  totalSupply: 100_000_000n * 10n ** 18n,
};

export const DEMO_VAULT: VaultSnapshot = { totalStake: 1_240_830n * 10n ** 18n };

// ── feeds ────────────────────────────────────────────────
const ASSET_IDS: Record<string, string> = {
  "BOT/USDT": "0x" + "11".repeat(32),
  "WBOT/USDT": "0x" + "22".repeat(32),
  "LODE/USDT": "0x" + "33".repeat(32),
};

function walk(base: number, amp: number): number {
  const t = Date.now() / 60_000;
  return base * (1 + amp * (0.3 * Math.sin(t / 7) + 0.7 * Math.sin(t / 3.1)) * 0.01);
}

export function demoFeeds(): FeedSnapshot[] {
  const mk = (symbol: string, priceBase: number, amp: number, secondsAgo: number): FeedSnapshot => ({
    assetId: ASSET_IDS[symbol],
    symbol,
    decimals: 8,
    price: BigInt(Math.round(walk(priceBase, amp) * 10 ** 8)),
    updatedAt: new Date(now - secondsAgo * 1000),
    roundId: 1240,
    isPaused: false,
    isStale: secondsAgo > 60,
    roundStart: new Date(now - 15_000),
    nextRoundAt: new Date(now + 105_000),
    submissionsInRound: 5,
    currentRound: 1241,
    scannerLink: "#",
  });
  return [
    mk("BOT/USDT", 0.8312, 1.2, 18),
    mk("WBOT/USDT", 0.0124, 2.0, 96),
    mk("LODE/USDT", 0.2410, 1.8, 51),
  ];
}

// ── operators ────────────────────────────────────────────
const OPS = [
  "0x1D9eFdC7b3A2f5c6E8a1b4d7C9eF2a6b8C1d4E7f",
  "0x8f2A5c9b1d4E7f0A3b6C8d1E5F7a0B2c4D6e8F1a",
  "0x3b7C9eF1a2D4f5A6b8C0d1E3F5a7B9c2D4e6F8a0",
  "0x6e8F1a2b4C6d8E0f1A3b5C7d9E1F2a4B6c8D0e2f",
  "0xA1b3C5d7E9f0A2B4c6D8e0F1a3B5C7d9E1F2a4B6c",
];

export function demoOperators(): OperatorRow[] {
  const stakes = [250_000n, 500_000n, 120_000n, 320_000n, 50_800n].map((s) => s * 10n ** 18n);
  return OPS.map((address, i) => ({
    address,
    stake: stakes[i],
    isEligible: true,
  }));
}

// ── recent rounds ────────────────────────────────────────
export function demoRounds(): RoundRow[] {
  const px = (n: number) => BigInt(Math.round(n * 10 ** 8));
  return [
    { assetId: ASSET_IDS["BOT/USDT"], roundId: 1240, price: px(0.8319), inThresholdSubmissions: 4, vetoed: 1, timestamp: new Date(now - 104_000) },
    { assetId: ASSET_IDS["LODE/USDT"], roundId: 987, price: px(0.2392), inThresholdSubmissions: 5, vetoed: 0, timestamp: new Date(now - 160_000) },
    { assetId: ASSET_IDS["BOT/USDT"], roundId: 1239, price: px(0.8291), inThresholdSubmissions: 4, vetoed: 1, timestamp: new Date(now - 224_000) },
    { assetId: ASSET_IDS["WBOT/USDT"], roundId: 2103, price: px(0.0125), inThresholdSubmissions: 3, vetoed: 0, timestamp: new Date(now - 260_000) },
  ];
}

// ── slashing history ─────────────────────────────────────
export function demoSlashes(): SlashRow[] {
  return [
    { operator: OPS[0], amount: 1_000n * 10n ** 18n, pendingCanceled: 0n, reason: "outlier price (3.4% over threshold)", txHash: "0x" + "a".repeat(64), timestamp: new Date(now - 3 * 60 * 60 * 1000) },
    { operator: OPS[4], amount: 2_500n * 10n ** 18n, pendingCanceled: 1_200n * 10n ** 18n, reason: "missed 6 consecutive rounds (liveness)", txHash: "0x" + "b".repeat(64), timestamp: new Date(now - 26 * 60 * 60 * 1000) },
  ];
}