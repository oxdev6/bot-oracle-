import { createPublicClient, createWalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ChainConfig } from "./types";
import { buildTransport } from "./rpc";

/**
 * Minimal select BOT Chain chains. If the RPC disagrees with these IDs the
 * client falls back to a permissive custom chain.
 */
export function defineBotChain(chainId: number, rpcUrl: string) {
  const name = chainId === 677 ? "BOT Chain Mainnet" : chainId === 968 ? "BOT Chain Testnet" : "BOT Chain";
  return {
    id: chainId,
    name,
    nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  } as const;
}

export function makePublicClient(chain: ChainConfig) {
  return createPublicClient({
    chain: defineBotChain(chain.chainId, chain.rpcUrl),
    transport: buildTransport(chain.rpcUrl, chain.fallbackRpcUrls),
  });
}

export function makeWalletClient(chain: ChainConfig, privateKey: string) {
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  return {
    account,
    client: createWalletClient({
      account,
      chain: defineBotChain(chain.chainId, chain.rpcUrl),
      transport: buildTransport(chain.rpcUrl, chain.fallbackRpcUrls),
    }),
  };
}

/**
 * Scale a USD float to the on-chain answer integer.
 * e.g. usdToScaled(0.83, 8) => 83000000n
 */
export function usdToScaled(priceUsd: number, decimals: number): bigint {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    throw new Error(`invalid price: ${priceUsd}`);
  }
  const scaled = priceUsd * 10 ** decimals;
  return BigInt(Math.round(scaled));
}

/** Invert: number -> on-chain bigint with given decimals (for dashboards/tests). */
export function scaledToUsd(value: bigint, decimals: number): number {
  return Number(value) / 10 ** decimals;
}

export function median(numbers: number[]): number {
  if (numbers.length === 0) throw new Error("median of empty set");
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function deviationPct(a: number, b: number): number {
  if (a === 0 && b === 0) return 0;
  const denom = Math.max(Math.abs(a), Math.abs(b));
  return (Math.abs(a - b) / denom) * 100;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function nowSec(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}