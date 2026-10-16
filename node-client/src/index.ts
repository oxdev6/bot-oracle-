import { loadConfig, resolveRuntime } from "./config";
import { makePublicClient, makeWalletClient } from "./utils";
import { createSubmitter, type Submitter } from "./submitter";
import { runFeedLoop, type RoundCleaner } from "./scheduler";
import { createLogger } from "./logger";
import { Metrics } from "./metrics";
import { HealthRegistry, startHealthServer, type HealthServer } from "./health";
import type { FeedConfig } from "./types";

/**
 * Lodestar Oracle node operator entrypoint.
 *
 * 1. Loads feeds + chain config and sets up structured logging.
 * 2. Builds the operator wallet + on-chain submitter (with RPC failover).
 * 3. Sizes the round interval to the on-chain OracleAggregator.roundInterval.
 * 4. Starts one round loop per configured feed, aligning to round boundaries.
 * 5. Serves /healthz, /readyz, /metrics and /status for probes and scrapers.
 *
 * Run:   npm run node
 * Env:   see .env.example (RPC_URL, CHAIN_ID, AGGREGATOR_ADDRESS, OPERATOR_KEY)
 */
async function main() {
  const config = loadConfig();
  const runtime = config.runtime ?? resolveRuntime();
  const logger = createLogger({ level: runtime.logLevel, format: runtime.logFormat });

  const publicClient = makePublicClient(config.chain);
  const { client, account } = makeWalletClient(config.chain, config.operator.privateKey);
  const submitter: Submitter = createSubmitter({
    chain: config.chain,
    wallet: client,
    publicClient,
    account: account.address,
  });

  const metrics = new Metrics();
  const health = new HealthRegistry({
    chainId: config.chain.chainId,
    rpcUrl: config.chain.rpcUrl,
    aggregator: config.chain.aggregator,
    operator: account.address,
  });

  let healthServer: HealthServer | undefined;
  if (runtime.healthEnabled) {
    healthServer = startHealthServer({
      registry: health,
      metrics,
      logger,
      port: runtime.healthPort,
    });
  }

  let onChainInterval = 120_000n;
  try {
    onChainInterval = (await submitter.getRoundInterval()) * 1000n;
  } catch (err) {
    logger.warn("could not read roundInterval from chain; using 120s default", {
      error: (err as Error).message,
    });
  }

  metrics.gauge("lodestar_node_up", "1 while the node process is running", {}, 1);
  metrics.gauge(
    "lodestar_node_round_interval_seconds",
    "On-chain round interval in seconds",
    {},
    Number(onChainInterval / 1000n),
  );

  logger.info("node starting", {
    operator: account.address,
    aggregator: config.chain.aggregator,
    chainId: config.chain.chainId,
    rpc: config.chain.rpcUrl,
    rpcFallbacks: config.chain.fallbackRpcUrls?.length ?? 0,
    feeds: config.feeds.map((f) => f.symbol),
    roundIntervalSeconds: Number(onChainInterval / 1000n),
    healthPort: runtime.healthEnabled ? runtime.healthPort : null,
  });

  const cleaners: RoundCleaner[] = [];
  let stopping = false;

  const stop = () => {
    if (stopping) return;
    stopping = true;
    logger.info("shutting down round loops");
    for (const c of cleaners) c();
    const finish = () => process.exit(0);
    if (healthServer) healthServer.close().then(finish, finish);
    else setTimeout(finish, 100);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  for (const feed of config.feeds) {
    cleaners.push(startLoop(feed));
  }

  health.markReady(true);
  logger.info("ready", { feeds: config.feeds.length });

  function startLoop(feed: FeedConfig): RoundCleaner {
    logger.info("starting feed loop", { feed: feed.symbol, assetId: feed.assetId });
    return runFeedLoop(
      {
        config,
        submitter,
        logger,
        metrics,
        health,
        intervalMs: Number(onChainInterval),
        onError: (f, err) => logger.warn("feed error", { feed: f.symbol, error: err.message }),
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
