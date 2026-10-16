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
  deployedAt: "2026-10-06T19:27:27.812Z",
  // ── deployed & verified on scan.bohr.life (mirrors config/addresses/botTestnet.json)
  lodestarToken: "0x3984FB054C5CdA5926CCB6b9a28518E9Ef9D922b",
  stakingVault: "0x689228a6dD03162a66A6D12c8dd2d3A29BFA33E1",
  oracleAggregator: "0xD8259eeDd2435d9BEF12FF8dd7596F67B95ac640",
  timelock: "0x11473af8dE46D6C2cdbC0765d16F933C7AD742DD",
  priceFeeds: {
    "BOT/USDT": "0xD5F951f49676e1FB2ed87a99619E25bFEb3D1d05",
    "WBOT/USDT": "0xaCCEc963d123F4f88fCDBD4b28B2736271422caF",
    "LODE/USDT": "0x16213a4Cc9aB463EDff7214aa113881ad1946859",
  },
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