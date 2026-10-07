/**
 * Chain reader for the public dashboard.
 *
 * Reads protocol data directly from the configured BOT chain. The dashboard
 * must have valid deployment addresses; synthetic data is intentionally not
 * supported in production mode.
 */
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  formatUnits,
  http,
  parseAbi,
  parseUnits,
  type Address,
  type EIP1193Provider,
  type Hash,
} from "viem";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Read an address from the environment. These values are routinely unset, set
 * to the bare string `"0x"`, left as an all-zero placeholder, or padded with
 * whitespace copied out of a `.env` file. Every one of those means "not
 * configured yet" and normalizes to the `"0x"` sentinel — otherwise a naive
 * `!== "0x"` check reports the network as live and every read fails silently.
 */
function readAddress(value: string | undefined): `0x${string}` {
  const raw = (value ?? "").trim();
  if (raw === "" || /^0x0*$/.test(raw)) return "0x";
  return raw as `0x${string}`;
}

export const CHAIN_CONFIG = {
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 968),
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "https://rpc.bohr.life",
  scannerUrl: process.env.NEXT_PUBLIC_SCANNER_URL ?? "https://scan.bohr.life",
  tokenAddress: readAddress(process.env.NEXT_PUBLIC_TOKEN_ADDRESS),
  vaultAddress: readAddress(process.env.NEXT_PUBLIC_VAULT_ADDRESS),
  aggregatorAddress: readAddress(process.env.NEXT_PUBLIC_AGGREGATOR_ADDRESS),
};

export const isDeployed = ADDRESS_RE.test(CHAIN_CONFIG.aggregatorAddress);

export interface InjectedWallet {
  info: {
    uuid: string;
    name: string;
    icon?: string;
    rdns?: string;
  };
  provider: EIP1193Provider;
}

let activeWallet: EIP1193Provider | null = null;

const BOT_CHAIN = defineChain({
  id: CHAIN_CONFIG.chainId,
  name: CHAIN_CONFIG.chainId === 677 ? "BOT Mainnet" : "BOT Testnet",
  nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: { default: { http: [CHAIN_CONFIG.rpcUrl] } },
  blockExplorers: { default: { name: "BOT Explorer", url: CHAIN_CONFIG.scannerUrl } },
});

export function getInjectedWallet(): EIP1193Provider | null {
  if (typeof window === "undefined") return null;
  return activeWallet ?? (window as Window & { ethereum?: EIP1193Provider }).ethereum ?? null;
}

export function setActiveWallet(provider: EIP1193Provider | null): void {
  activeWallet = provider;
}

export async function discoverInjectedWallets(): Promise<InjectedWallet[]> {
  if (typeof window === "undefined") return [];

  const discovered = new Map<EIP1193Provider, InjectedWallet>();
  const addFallback = () => {
    const provider = (window as Window & { ethereum?: EIP1193Provider }).ethereum;
    if (provider && !discovered.has(provider)) {
      discovered.set(provider, {
        info: { uuid: "injected-fallback", name: "Browser wallet" },
        provider,
      });
    }
  };
  const listener = (event: Event) => {
    const wallet = (event as CustomEvent<InjectedWallet>).detail;
    if (wallet?.provider && wallet.info?.uuid && wallet.info.name) {
      discovered.set(wallet.provider, wallet);
    }
  };

  window.addEventListener("eip6963:announceProvider", listener);
  addFallback();
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((resolve) => window.setTimeout(resolve, 300));
  window.removeEventListener("eip6963:announceProvider", listener);

  return [...discovered.values()];
}

function requireInjectedWallet(): EIP1193Provider {
  const provider = getInjectedWallet();
  if (!provider) throw new Error("No browser wallet found. Install or enable MetaMask to continue.");
  return provider;
}

async function walletFor(address?: string) {
  const provider = requireInjectedWallet();
  const client = createWalletClient({ chain: BOT_CHAIN, transport: custom(provider) });
  if (address) {
    const accounts = await client.requestAddresses();
    if (!accounts.some((account) => account.toLowerCase() === address.toLowerCase())) {
      throw new Error("The connected wallet account changed. Reconnect your wallet and try again.");
    }
  }

  const chainId = await client.getChainId();
  if (chainId !== CHAIN_CONFIG.chainId) {
    try {
      await client.switchChain({ id: CHAIN_CONFIG.chainId });
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== 4902) throw error;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: `0x${CHAIN_CONFIG.chainId.toString(16)}`,
          chainName: BOT_CHAIN.name,
          nativeCurrency: BOT_CHAIN.nativeCurrency,
          rpcUrls: [CHAIN_CONFIG.rpcUrl],
          blockExplorerUrls: [CHAIN_CONFIG.scannerUrl],
        }],
      });
      await client.switchChain({ id: CHAIN_CONFIG.chainId });
    }
  }

  return address
    ? createWalletClient({
        account: address as Address,
        chain: BOT_CHAIN,
        transport: custom(provider),
      })
    : client;
}

export function getConfigurationError(): string | null {
  if (!ADDRESS_RE.test(CHAIN_CONFIG.tokenAddress)) return "NEXT_PUBLIC_TOKEN_ADDRESS is not configured.";
  if (!ADDRESS_RE.test(CHAIN_CONFIG.vaultAddress)) return "NEXT_PUBLIC_VAULT_ADDRESS is not configured.";
  if (!ADDRESS_RE.test(CHAIN_CONFIG.aggregatorAddress)) return "NEXT_PUBLIC_AGGREGATOR_ADDRESS is not configured.";
  if (![968, 677].includes(CHAIN_CONFIG.chainId)) return "NEXT_PUBLIC_CHAIN_ID must be 968 (testnet) or 677 (mainnet).";
  return null;
}

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
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const VAULT_ABI = parseAbi([
  "function isEligibleOperator(address) view returns (bool)",
  "function stakeOf(address) view returns (uint256)",
  "function effectiveStake(address) view returns (uint256)",
  "function minStake() view returns (uint256)",
  "function requestWithdrawal(uint256 amount)",
  "function claimWithdrawal(uint256 requestIndex)",
  "function getWithdrawalRequestCount(address operator) view returns (uint256)",
  "function withdrawalRequests(address operator, uint256 index) view returns (uint256 amount, uint256 availableAt)",
  "function stake(uint256 amount)",
  "function totalStake() view returns (uint256)",
  "function getStakerCount() view returns (uint256)",
  "function stakers(uint256) view returns (address)",
]);

const OPERATOR_AGG_ABI = parseAbi([
  "function submitPrice(bytes32 assetId, int256 price, uint64 sourceTimestamp)",
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

export interface WithdrawalRequest {
  index: number;
  amount: bigint;
  availableAt: Date;
}

export interface OperatorAccount {
  tokenBalance: bigint;
  tokenAllowance: bigint;
  nativeBalance: bigint;
  stake: bigint;
  effectiveStake: bigint;
  minStake: bigint;
  withdrawals: WithdrawalRequest[];
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

export async function connectOperatorWallet(provider?: EIP1193Provider): Promise<string> {
  if (provider) setActiveWallet(provider);
  const wallet = await walletFor();
  const [address] = await wallet.requestAddresses();
  if (!address) throw new Error("The wallet did not return an account.");
  return address;
}

export async function getOperatorAccount(address: string): Promise<OperatorAccount> {
  if (!ADDRESS_RE.test(address)) throw new Error("The connected wallet address is invalid.");
  const client = makeClient();
  const [tokenBalance, tokenAllowance, nativeBalance, stake, effectiveStake, minStake, requestCount] = await Promise.all([
    client.readContract({ address: CHAIN_CONFIG.tokenAddress, abi: TOKEN_ABI, functionName: "balanceOf", args: [address as Address] }),
    client.readContract({ address: CHAIN_CONFIG.tokenAddress, abi: TOKEN_ABI, functionName: "allowance", args: [address as Address, CHAIN_CONFIG.vaultAddress] }),
    client.getBalance({ address: address as Address }),
    client.readContract({ address: CHAIN_CONFIG.vaultAddress, abi: VAULT_ABI, functionName: "stakeOf", args: [address as Address] }),
    client.readContract({ address: CHAIN_CONFIG.vaultAddress, abi: VAULT_ABI, functionName: "effectiveStake", args: [address as Address] }),
    client.readContract({ address: CHAIN_CONFIG.vaultAddress, abi: VAULT_ABI, functionName: "minStake" }),
    client.readContract({ address: CHAIN_CONFIG.vaultAddress, abi: VAULT_ABI, functionName: "getWithdrawalRequestCount", args: [address as Address] }),
  ]);
  const withdrawals = await Promise.all(
    Array.from({ length: Number(requestCount) }, async (_, index) => {
      const [amount, availableAt] = await client.readContract({
        address: CHAIN_CONFIG.vaultAddress,
        abi: VAULT_ABI,
        functionName: "withdrawalRequests",
        args: [address as Address, BigInt(index)],
      });
      return { index, amount, availableAt: new Date(Number(availableAt) * 1000) };
    }),
  );

  return { tokenBalance, tokenAllowance, nativeBalance, stake, effectiveStake, minStake, withdrawals };
}

async function waitForSuccessfulTransaction(hash: Hash): Promise<void> {
  const receipt = await makeClient().waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Transaction ${hash} reverted. Check it on the network explorer.`);
  }
}

export async function stakeLode(
  address: string,
  amount: bigint,
  onApproval?: () => void,
): Promise<void> {
  if (amount <= 0n) throw new Error("Enter a stake amount greater than zero.");
  const account = address as Address;
  const wallet = await walletFor(address);
  const allowance = await makeClient().readContract({
    address: CHAIN_CONFIG.tokenAddress,
    abi: TOKEN_ABI,
    functionName: "allowance",
    args: [account, CHAIN_CONFIG.vaultAddress],
  });
  if (allowance < amount) {
    onApproval?.();
    const approvalHash = await wallet.writeContract({
      address: CHAIN_CONFIG.tokenAddress,
      abi: TOKEN_ABI,
      functionName: "approve",
      args: [CHAIN_CONFIG.vaultAddress, amount],
      account,
    });
    await waitForSuccessfulTransaction(approvalHash);
  }
  const hash = await wallet.writeContract({
    address: CHAIN_CONFIG.vaultAddress,
    abi: VAULT_ABI,
    functionName: "stake",
    args: [amount],
    account,
  });
  await waitForSuccessfulTransaction(hash);
}

export async function requestLodeWithdrawal(address: string, amount: bigint): Promise<void> {
  if (amount <= 0n) throw new Error("Enter a withdrawal amount greater than zero.");
  const account = address as Address;
  const wallet = await walletFor(address);
  const hash = await wallet.writeContract({
    address: CHAIN_CONFIG.vaultAddress,
    abi: VAULT_ABI,
    functionName: "requestWithdrawal",
    args: [amount],
    account,
  });
  await waitForSuccessfulTransaction(hash);
}

export async function claimLodeWithdrawal(address: string, index: number): Promise<void> {
  const account = address as Address;
  const wallet = await walletFor(address);
  const hash = await wallet.writeContract({
    address: CHAIN_CONFIG.vaultAddress,
    abi: VAULT_ABI,
    functionName: "claimWithdrawal",
    args: [BigInt(index)],
    account,
  });
  await waitForSuccessfulTransaction(hash);
}

export async function submitFeedPrice(
  address: string,
  assetId: string,
  rawPrice: string,
  decimals: number,
): Promise<void> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(assetId)) throw new Error("The selected feed has an invalid asset ID.");
  const price = parseUnits(rawPrice.trim(), decimals);
  if (price <= 0n) throw new Error("Enter a price greater than zero.");
  if (price > (1n << 255n) - 1n) throw new Error("The entered price is too large.");

  const account = address as Address;
  const wallet = await walletFor(address);
  const hash = await wallet.writeContract({
    address: CHAIN_CONFIG.aggregatorAddress,
    abi: OPERATOR_AGG_ABI,
    functionName: "submitPrice",
    args: [assetId as `0x${string}`, price, BigInt(Math.floor(Date.now() / 1000))],
    account,
  });
  await waitForSuccessfulTransaction(hash);
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