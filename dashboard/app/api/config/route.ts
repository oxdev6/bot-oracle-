/**
 * GET /api/config
 *
 * Public, non-sensitive deployment metadata for the dashboard and integrators:
 * which chain is targeted, whether contracts are configured, and whether the
 * registered feeds actually have price data yet.
 */
import { CHAIN_CONFIG } from "@/lib/client";
import { isConfigured, loadFeeds } from "@/lib/server-data";

export const dynamic = "force-dynamic";

export async function GET() {
  const configured = isConfigured();
  const feeds = await loadFeeds();
  const withPrice = feeds.filter((feed) => feed.hasPrice).length;
  return Response.json(
    {
      chainId: CHAIN_CONFIG.chainId,
      chainName: CHAIN_CONFIG.chainId === 677 ? "BOT Mainnet" : CHAIN_CONFIG.chainId === 968 ? "BOT Testnet" : "Local Network",
      rpcUrl: CHAIN_CONFIG.rpcUrl,
      scannerUrl: CHAIN_CONFIG.scannerUrl,
      addresses: {
        token: CHAIN_CONFIG.tokenAddress,
        vault: CHAIN_CONFIG.vaultAddress,
        aggregator: CHAIN_CONFIG.aggregatorAddress,
      },
      configured,
      feeds: feeds.length,
      feedsWithPrice: withPrice,
      generatedAt: new Date().toISOString(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
