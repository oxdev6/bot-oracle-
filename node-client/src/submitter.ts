import type { WalletClient, PublicClient } from "viem";
import type { ChainConfig, FeedHealth, LatestPrice } from "./types";
import { aggregatorAbi } from "./aggregatorAbi";
import { defineBotChain } from "./utils";

export { aggregatorAbi };

export interface Submitter {
  submit(assetId: `0x${string}`, price: bigint): Promise<{ hash: `0x${string}` }>;
  getLatestPrice(assetId: `0x${string}`): Promise<LatestPrice>;
  getFeedHealth(assetId: `0x${string}`): Promise<FeedHealth>;
  getRoundInterval(): Promise<bigint>;
  address(): `0x${string}`;
}

export function createSubmitter(opts: {
  chain: ChainConfig;
  wallet?: WalletClient;
  publicClient: PublicClient;
  account?: `0x${string}`;
}): Submitter {
  const aggregator = opts.chain.aggregator as `0x${string}`;
  const publicClient = opts.publicClient;

  async function submit(
    assetId: `0x${string}`,
    price: bigint,
  ): Promise<{ hash: `0x${string}` }> {
    const wallet = opts.wallet;
    if (!wallet || !opts.account) throw new Error("no operator wallet configured");
    const hash = await wallet.writeContract({
      chain: defineBotChain(opts.chain.chainId, opts.chain.rpcUrl),
      address: aggregator,
      abi: aggregatorAbi,
      functionName: "submitPrice",
      args: [assetId, price, BigInt(Math.floor(Date.now() / 1000))],
      account: opts.account,
    });
    return { hash };
  }

  async function getLatestPrice(assetId: `0x${string}`): Promise<LatestPrice> {
    const [price, updatedAt, roundId, decimals, isPaused] = await publicClient.readContract({
      address: aggregator,
      abi: aggregatorAbi,
      functionName: "getLatestPrice",
      args: [assetId],
    });
    return { price, updatedAt, roundId, decimals, isPaused };
  }

  async function getFeedHealth(assetId: `0x${string}`): Promise<FeedHealth> {
    const [isPaused, isStale, hasPrice, lastUpdate, lastRoundSubmissions, lastRoundVetoed, roundStart, nextRoundAt, currentRound, openRoundSubmissions] =
      await publicClient.readContract({
        address: aggregator,
        abi: aggregatorAbi,
        functionName: "getFeedHealth",
        args: [assetId],
      });
    return {
      isPaused,
      isStale,
      hasPrice,
      lastUpdate,
      lastRoundSubmissions,
      lastRoundVetoed,
      roundStart,
      nextRoundAt,
      currentRound,
      openRoundSubmissions,
    };
  }

  async function getRoundInterval(): Promise<bigint> {
    return publicClient.readContract({ address: aggregator, abi: aggregatorAbi, functionName: "roundInterval" });
  }

  return {
    submit,
    getLatestPrice,
    getFeedHealth,
    getRoundInterval,
    address: () => opts.account as `0x${string}`,
  };
}