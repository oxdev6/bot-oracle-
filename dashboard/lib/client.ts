/**
 * Chain reader for the public dashboard.
 *
 * All reads are on-chain-only (no server state). If the contract addresses
 * are not configured (not deployed yet) the dashboard renders a placeholder
 * state so it still looks presentable.
 */
import { createPublicClient, http, parseAbi, formatUnits } from "viem";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Read an address from the environment. These values are routinely unset, set
 * to the bare string `"0x"`, left as an all-zero placeholder, or padded with
 * whitespace copied out of a `.env` file. Every one of those means "not
 * configured yet" and normalizes to the `"0x"` sentinel — otherwise a naive
 * `!== "0x"` check reports the network as live and every read fails silently.
 */
function readAddress(name: string): `0x${string}` {
  const raw = (process.env[name] ?? "").trim();
  if (raw === "" || /^0x0*$/.test(raw)) return "0x";
  return raw as `0x${string}`;
}

export const CHAIN_CONFIG = {
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 968),
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "https://rpc.bohr.life",
  scannerUrl: process.env.NEXT_PUBLIC_SCANNER_URL ?? "https://scan.bohr.life",
  tokenAddress: readAddress("NEXT_PUBLIC_TOKEN_ADDRESS"),
  vaultAddress: readAddress("NEXT_PUBLIC_VAULT_ADDRESS"),
  aggregatorAddress: readAddress("NEXT_PUBLIC_AGGREGATOR_ADDRESS"),
};

/** True only when a real 20-byte aggregator address is configured. */
export const isDeployed = ADDRESS_RE.test(CHAIN_CONFIG.aggregatorAddress);
export const isDemo = !isDeployed;

function makeClient() {
  return createPublicClient({
    chain: {
      id: CHAIN_CONFIG.chainId,
      name:
        CHAIN_CONFIG.chainId === 677
          ? "BOT Mainnet"
          : CHAIN_CONFIG.chainId === 968
            ? "BOT Testnet"
            : "BOT Local",
      nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
      rpcUrls: { default: { http: [CHAIN_CONFIG.rpcUrl] } },
    },
    transport: http(CHAIN_CONFIG.rpcUrl, { timeout: 10_000, retryCount: 1 }),
  });
}

const AGG_ABI = parseAbi([
  "function getLatestPrice(bytes32 assetId) view returns (int256 price, uint256 updatedAt, uint80 roundId, uint8 decimals, bool isPaused)",
  "function getFeedHealth(bytes32 assetId) view returns (bool isPaused, bool isStale, bool hasPrice, uint256 lastUpdate, uint256 lastRoundSubmissions, uint256 lastRoundVetoed, uint256 roundStart, uint256 nextRoundAt, uint256 currentRound, uint256 openRoundSubmissions)",
  "function roundInterval() view returns (uint256)",
  "function getRegisteredAssets() view returns (bytes32[])",
  "function feedDecimals(bytes32) view returns (uint8)",
  "function feedSymbols(bytes32) view returns (string)",
]);

const TOKEN_ABI = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
]);

const VAULT_ABI = parseAbi([
  "function isEligibleOperator(address) view returns (bool)",
  "function stakeOf(address) view returns (uint256)",
  "function totalStake() view returns (uint256)",
  "function getStakerCount() view returns (uint256)",
  "function stakers(uint256) view returns (address)",
]);

// Events are declared through parseAbi (not hand-rolled objects) so viem keeps
// the typed `args` on the returned logs.
const ROUND_CLOSED_EVENT = parseAbi([
  "event RoundClosed(bytes32 indexed assetId, uint80 roundId, int256 price, uint256 inThresholdSubmissions, uint256 vetoedSubmissions)",
])[0];

const SLASH_EVENT = parseAbi([
  "event Slash(address indexed operator, uint256 amount, uint256 pendingCanceled, bytes32 reason)",
])[0];

export interface FeedSnapshot {
  assetId: string;
  symbol: string;
  decimals: number;
  price: bigint;
  updatedAt: Date;
  roundId: number;
  isPaused: boolean;
  isStale: boolean;
  roundStart: Date;
  /** When the open round closes (end of `roundInterval`). */
  nextRoundAt: Date;
  submissionsInRound: number;
  currentRound: number;
  scannerLink: string;
}

export interface TokenSnapshot {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
}

export interface VaultSnapshot {
  totalStake: bigint;
}

export interface OperatorRow {
  address: string;
  stake: bigint;
  isEligible: boolean;
}

export interface RoundRow {
  assetId: string;
  roundId: number;
  price: bigint;
  inThresholdSubmissions: number;
  vetoed: number | null;
  timestamp: Date;
}

export interface SlashRow {
  operator: string;
  amount: bigint;
  pendingCanceled: bigint;
  reason: string;
  txHash: string;
  timestamp: Date;
}

export async function getRegistry(): Promise<string[]> {
  if (!isDeployed) return [];
  const client = makeClient();
  try {
    return (await client.readContract({
      address: CHAIN_CONFIG.aggregatorAddress,
      abi: AGG_ABI,
      functionName: "getRegisteredAssets",
    })) as string[];
  } catch {
    return [];
  }
}

export async function getToken(): Promise<TokenSnapshot | null> {
  if (!ADDRESS_RE.test(CHAIN_CONFIG.tokenAddress)) return null;
  const client = makeClient();
  try {
    const [name, symbol, decimals, totalSupply] = await Promise.all([
      client.readContract({ address: CHAIN_CONFIG.tokenAddress, abi: TOKEN_ABI, functionName: "name" }) as Promise<string>,
      client.readContract({ address: CHAIN_CONFIG.tokenAddress, abi: TOKEN_ABI, functionName: "symbol" }) as Promise<string>,
      client.readContract({ address: CHAIN_CONFIG.tokenAddress, abi: TOKEN_ABI, functionName: "decimals" }) as Promise<number>,
      client.readContract({ address: CHAIN_CONFIG.tokenAddress, abi: TOKEN_ABI, functionName: "totalSupply" }) as Promise<bigint>,
    ]);
    return { name, symbol, decimals: Number(decimals), totalSupply };
  } catch {
    return null;
  }
}

export async function getFeed(assetId: string): Promise<FeedSnapshot | null> {
  if (!isDeployed) return null;
  const client = makeClient();
  try {
    const [priceData, health] = await Promise.all([
      client.readContract({ address: CHAIN_CONFIG.aggregatorAddress, abi: AGG_ABI, functionName: "getLatestPrice", args: [assetId as `0x${string}`] }),
      client.readContract({ address: CHAIN_CONFIG.aggregatorAddress, abi: AGG_ABI, functionName: "getFeedHealth", args: [assetId as `0x${string}`] }),
    ]);
    const [symbol, feedDecimals] = await Promise.all([
      client.readContract({ address: CHAIN_CONFIG.aggregatorAddress, abi: AGG_ABI, functionName: "feedSymbols", args: [assetId as `0x${string}`] }) as Promise<string>,
      client.readContract({ address: CHAIN_CONFIG.aggregatorAddress, abi: AGG_ABI, functionName: "feedDecimals", args: [assetId as `0x${string}`] }) as Promise<number>,
    ]);

    // Field order follows the contract's `FeedHealth` struct.
    const [
      isPaused,      // 0
      isStale,       // 1
      ,              // 2 hasPrice
      ,              // 3 lastUpdate
      ,              // 4 lastRoundSubmissions
      ,              // 5 lastRoundVetoed
      roundStart,    // 6
      nextRoundAt,   // 7
      currentRound,  // 8
      openSubmissions, // 9
    ] = health;

    return {
      assetId,
      symbol,
      decimals: Number(feedDecimals),
      price: priceData[0],
      updatedAt: new Date(Number(priceData[1]) * 1000),
      roundId: Number(priceData[2]),
      isPaused,
      isStale,
      roundStart: new Date(Number(roundStart) * 1000),
      nextRoundAt: new Date(Number(nextRoundAt) * 1000),
      // reports for the round currently being collected, not the last closed one
      submissionsInRound: Number(openSubmissions),
      currentRound: Number(currentRound),
      scannerLink: `${CHAIN_CONFIG.scannerUrl}/token/${CHAIN_CONFIG.aggregatorAddress}?a=0x${assetId.slice(2)}`,
    };
  } catch {
    return null;
  }
}

export async function getVault(): Promise<VaultSnapshot | null> {
  if (!ADDRESS_RE.test(CHAIN_CONFIG.vaultAddress)) return null;
  const client = makeClient();
  try {
    const totalStake = (await client.readContract({
      address: CHAIN_CONFIG.vaultAddress,
      abi: VAULT_ABI,
      functionName: "totalStake",
    })) as bigint;
    return { totalStake };
  } catch {
    return null;
  }
}

export async function getOperators(): Promise<OperatorRow[]> {
  if (!isDeployed || !ADDRESS_RE.test(CHAIN_CONFIG.vaultAddress)) return [];
  const client = makeClient();
  try {
    const count = Number(await client.readContract({ address: CHAIN_CONFIG.vaultAddress, abi: VAULT_ABI, functionName: "getStakerCount" }));
    if (count === 0) return [];
    const indices = Array.from({ length: count }, (_, i) => BigInt(i));
    const addrs = await Promise.all(
      indices.map((i) => client.readContract({ address: CHAIN_CONFIG.vaultAddress, abi: VAULT_ABI, functionName: "stakers", args: [i] }) as Promise<`0x${string}`>),
    );
    const stakes = await Promise.all(
      addrs.map((a) => client.readContract({ address: CHAIN_CONFIG.vaultAddress, abi: VAULT_ABI, functionName: "stakeOf", args: [a] }) as Promise<bigint>),
    );
    const eligible = await Promise.all(
      addrs.map((a) => client.readContract({ address: CHAIN_CONFIG.vaultAddress, abi: VAULT_ABI, functionName: "isEligibleOperator", args: [a] }) as Promise<boolean>),
    );
    return addrs.map((address, i) => ({ address, stake: stakes[i], isEligible: eligible[i] }));
  } catch {
    return [];
  }
}

export async function getRounds(limit = 25): Promise<RoundRow[]> {
  if (!isDeployed) return [];
  const client = makeClient();
  try {
    const logs = await client.getLogs({
      address: CHAIN_CONFIG.aggregatorAddress,
      event: ROUND_CLOSED_EVENT,
      fromBlock: 0n,
      toBlock: "latest",
    });
    const recent = logs.slice(-limit).reverse();
    const blocks = await Promise.all(
      recent.map((log) => client.getBlock({ blockNumber: log.blockNumber }).then((b) => Number(b.timestamp) * 1000)),
    );
    return recent.map((log, i) => ({
      assetId: log.args.assetId as string,
      roundId: Number(log.args.roundId),
      price: log.args.price as bigint,
      inThresholdSubmissions: Number(log.args.inThresholdSubmissions),
      vetoed: Number(log.args.vetoedSubmissions),
      timestamp: new Date(blocks[i]),
    }));
  } catch {
    return [];
  }
}

export async function getSlashes(limit = 25): Promise<SlashRow[]> {
  if (!isDeployed) return [];
  const client = makeClient();
  try {
    const logs = await client.getLogs({
      address: CHAIN_CONFIG.vaultAddress,
      event: SLASH_EVENT,
      fromBlock: 0n,
      toBlock: "latest",
    });
    const recent = logs.slice(-limit).reverse();
    const blocks = await Promise.all(
      recent.map((log) => client.getBlock({ blockNumber: log.blockNumber }).then((b) => Number(b.timestamp) * 1000)),
    );
    return recent.map((log, i) => ({
      operator: log.args.operator as string,
      amount: log.args.amount as bigint,
      pendingCanceled: log.args.pendingCanceled as bigint,
      reason: log.args.reason as string,
      txHash: log.transactionHash,
      timestamp: new Date(blocks[i]),
    }));
  } catch {
    return [];
  }
}

export function fmtToken(value: bigint, decimals = 18, digits = 4): string {
  return formatUnits(value, decimals).replace(/(\.\d*?\d)0+$/, `$1`).slice(0, decimals + digits + 2);
}

export function fmtPrice(value: bigint, decimals: number): string {
  const s = formatUnits(value, decimals);
  const n = Number(s);
  if (n >= 1000) return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (n >= 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(8)}`;
}

export function fmtTimestamp(d: Date): string {
  return d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}