/**
 * Lodestar Oracle — Contract Registry
 *
 * Source of truth for deployed addresses on BOT Chain (testnet 968 / mainnet 677).
 * Each entry must carry a sourcing comment: where the address came from and
 * whether it has been independently verified. Update via:
 *
 *     npm run deploy:testnet   # writes config/addresses/botTestnet.json
 *     npm run deploy:mainnet   # writes config/addresses/botMainnet.json
 *
 * If an address is not yet deployed it stays `null` — dashboards and the node
 * client must tolerate `null` cleanly.
 */
export interface ContractRegistry {
  chainId: string;
  network: string;
  deployedAt: string;
  lodestarToken: string | null;      // LODE ERC-20, fixed supply minted to treasury
  stakingVault: string | null;       // stake/slash/rewards
  oracleAggregator: string | null;   // median + outlier + circuit breaker
  timelock: string | null;           // 48h timelock admin
  priceFeeds: Record<string, string> | null; // "BOT/USDT" -> PriceFeed address
}

export const BOT_TESTNET: ContractRegistry = {
  chainId: "968",
  network: "botTestnet",
  deployedAt: "",
  // ── deployed & verified on scan.bohr.life (fill after `npm run deploy:testnet`)
  lodestarToken: null,
  stakingVault: null,
  oracleAggregator: null,
  timelock: null,
  priceFeeds: null,
};

export const BOT_MAINNET: ContractRegistry = {
  chainId: "677",
  network: "botMainnet",
  deployedAt: "",
  // ── deployed & verified on scan.botchain.ai (fill after `npm run deploy:mainnet`)
  lodestarToken: null,
  stakingVault: null,
  oracleAggregator: null,
  timelock: null,
  priceFeeds: null,
};

export function getRegistry(chainId: number): ContractRegistry {
  if (chainId === 968) return BOT_TESTNET;
  if (chainId === 677) return BOT_MAINNET;
  throw new Error(`No registry for chain ${chainId}`);
}