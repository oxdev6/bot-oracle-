import { loadConfig } from "./config";
import { makePublicClient, makeWalletClient } from "./utils";
import { createSubmitter, type Submitter } from "./submitter";
import { runFeedLoop, type RoundCleaner } from "./scheduler";
import type { FeedConfig } from "./types";

/**
 * Lodestar Oracle node operator entrypoint.
 *
 * 1. Loads feeds + chain config.
 * 2. Sets up the operator wallet and the on-chain submitter.
 * 3. Sizes the round interval to the on-chain OracleAggregator.roundInterval.
 * 4. Starts one round loop per configured feed.
 *
 * Run:   npm run node
 * Env:   see .env.example (RPC_URL, CHAIN_ID, AGGREGATOR_ADDRESS, OPERATOR_KEY)
 */
async function main() {
  const config = loadConfig();

  const publicClient = makePublicClient(config.chain);
  const { client, account } = makeWalletClient(config.chain, config.operator.privateKey);
  const submitter: Submitter = createSubmitter({
    chain: config.chain,
    wallet: client,
    publicClient,
    account: account.address,
  });

  const onChainInterval = (await submitter.getRoundInterval()) * 1000n;

  console.log(`[boot] operator     ${account.address}`);
  console.log(`[boot] aggregator   ${config.chain.aggregator}`);
  console.log(`[boot] chain        #${config.chain.chainId} (${config.chain.rpcUrl})`);
  console.log(`[boot] feeds        ${config.feeds.map((f) => f.symbol).join(", ")}`);
  console.log(`[boot] round interval ${(onChainInterval / 1000n).toString()}s (from chain)`);
  console.log(`[boot] jitter       ${config.operator.jitterSeconds}s max per tick`);

  const cleaners: RoundCleaner[] = [];
  let stopping = false;

  const stop = () => {
    if (stopping) return;
    stopping = true;
    console.log("[shutdown] stopping round loops…");
    for (const c of cleaners) c();
    setTimeout(() => process.exit(0), 100);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  for (const feed of config.feeds) {
    cleaners.push(startLoop(feed));
  }

  function startLoop(feed: FeedConfig): RoundCleaner {
    console.log(`[boot] starting round loop for ${feed.symbol} (${feed.assetId})…`);
    return runFeedLoop(
      {
        config,
        submitter,
        onError: (f, err) => console.warn(`[round:${f.symbol}] ${err.message}`),
        intervalMs: Number(onChainInterval),
      },
      feed,
      () => stop(),
    );
  }
}

main().catch((err) => {
  console.error("[fatal]", err instanceof Error ? err.message : err);
  process.exit(1);
});