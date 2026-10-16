import { fallback, http, type Transport } from "viem";

/**
 * Build a viem transport from one or more RPC URLs.
 *
 * A single URL produces a plain HTTP transport. Multiple URLs produce viem's
 * `fallback` transport, which rotates providers on failure so a flaky or
 * rate-limited BOT RPC cannot stall the node. Order matters: the first URL is
 * preferred and the rest are backups.
 */
export function buildTransport(rpcUrl: string, fallbackRpcUrls: string[] = []): Transport {
  const urls = [rpcUrl, ...fallbackRpcUrls].map((u) => u?.trim()).filter((u): u is string => Boolean(u));
  const unique = [...new Set(urls)];
  if (unique.length === 0) throw new Error("buildTransport: at least one RPC URL is required");
  if (unique.length === 1) {
    return http(unique[0], { timeout: 15_000, retryCount: 2 });
  }
  return fallback(
    unique.map((url) => http(url, { timeout: 15_000, retryCount: 1 })),
    { rank: false, retryCount: 2 },
  );
}
