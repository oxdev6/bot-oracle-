import type { BotOracleConfig, FeedConfig, PriceObservation } from "./types";
import { fetchFeed } from "./fetchers";
import { aggregateObservations } from "./aggregator";
import { usdToScaled } from "./utils";
import { createLogger, type Logger } from "./logger";
import type { Metrics } from "./metrics";
import type { HealthRegistry } from "./health";
import type { Submitter } from "./submitter";

export interface SchedulerOptions {
  config: BotOracleConfig;
  submitter: Submitter;
  logger?: Logger;
  metrics?: Metrics;
  health?: HealthRegistry;
  onRound?: (feed: FeedConfig, result: { medianUsd: number; scaled: bigint; txHash?: `0x${string}` }) => void;
  onError?: (feed: FeedConfig, error: Error) => void;
  /** In-process timer interval for the round loop (ms). Defaults to 120s. */
  intervalMs?: number;
  /** Injectable source fetcher (defaults to `fetchFeed`); used by tests. */
  fetchObservations?: (feed: FeedConfig) => Promise<PriceObservation[]>;
}

export type RoundCleaner = () => void;

const METRIC_SUBMISSIONS = "lodestar_node_submissions_total";
const METRIC_ERRORS = "lodestar_node_submission_errors_total";
const METRIC_LAST_PRICE = "lodestar_node_last_price_usd";
const METRIC_LAST_SUCCESS = "lodestar_node_last_success_timestamp_seconds";

/**
 * Drives one feed's round loop:
 *   fetch → locally aggregate (median + reject local outliers) → preflight → submit.
 *
 * Timing is aligned to the on-chain round boundary rather than to the process
 * start: after a successful submission the loop sleeps until the next round
 * opens (read from `getFeedHealth.nextRoundAt`), so the node's reports always
 * land inside a fresh round and do not drift against the aggregator. A failed
 * round backs off by a fraction of the remaining window and retries, so a
 * transient source/RPC hiccup is not a missed round.
 *
 * Failures are caught per round; only truly un-recoverable errors (bad key,
 * chain mismatch, out of gas) stop the node.
 */
export function runFeedLoop(opts: SchedulerOptions, feed: FeedConfig, shutdown: (code: number) => void): RoundCleaner {
  const { config, submitter } = opts;
  const intervalMs = opts.intervalMs ?? 60_000;
  const jitterMs = config.operator.jitterSeconds * 1000;
  const retryFraction = config.runtime?.retryBackoffFraction ?? 0.5;
  const log = (opts.logger ?? createLogger()).child({ feed: feed.symbol });
  const state = opts.health?.upsert({ symbol: feed.symbol, assetId: feed.assetId });
  const fetchObservations = opts.fetchObservations ?? fetchFeed;

  // A feed with no verified sources is intentionally inert: warn once and never
  // start a round loop, rather than failing (and logging an error) every round.
  if (feed.sources.length === 0) {
    log.warn("feed has no configured sources; skipping until sources are added to config/feeds.json");
    return () => {};
  }

  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  async function tickOnce(): Promise<boolean> {
    try {
      const obsRaw = await fetchObservations(feed);
      const agg = aggregateObservations(obsRaw, {
        maxDeviationPct: config.operator.maxLocalDeviationPct,
        minObservations: Math.min(2, feed.sources.length),
      });

      const scaled = usdToScaled(agg.medianUsd, feed.feedDecimals);
      const { hash } = await submitter.submit(feed.assetId as `0x${string}`, scaled);

      if (state) {
        state.submissions += 1;
        state.consecutiveErrors = 0;
        state.lastError = undefined;
        state.lastRoundAt = new Date().toISOString();
        state.lastMedianUsd = agg.medianUsd;
      }
      opts.metrics?.counter(METRIC_SUBMISSIONS, "Successful on-chain price submissions", { feed: feed.symbol });
      opts.metrics?.gauge(METRIC_LAST_PRICE, "Last locally aggregated price (USD)", { feed: feed.symbol }, agg.medianUsd);
      opts.metrics?.gauge(METRIC_LAST_SUCCESS, "Unix time of the last successful submission", { feed: feed.symbol }, Math.floor(Date.now() / 1000));

      log.info("price submitted", {
        median: agg.medianUsd,
        scaled: scaled.toString(),
        sources: agg.observations.length,
        spreadPct: Number(agg.spreadPct.toFixed(2)),
        tx: hash.slice(0, 10),
      });
      opts.onRound?.(feed, { medianUsd: agg.medianUsd, scaled, txHash: hash });
      return true;
    } catch (err) {
      const e = err as Error;
      if (state) {
        state.consecutiveErrors += 1;
        state.lastError = e.message;
      }
      opts.metrics?.counter(METRIC_ERRORS, "Failed submission attempts", { feed: feed.symbol });
      log.warn("round failed", { error: e.message, consecutiveErrors: state?.consecutiveErrors });
      opts.onError?.(feed, e);
      if (isUnexpectedFatal(e)) {
        shutdown(1);
      }
      return false;
    }
  }

  /** Seconds until the on-chain round we are currently in closes, or null when unknown. */
  async function secondsUntilNextRound(): Promise<number | null> {
    try {
      const health = await submitter.getFeedHealth(feed.assetId as `0x${string}`);
      if (health.roundStart <= 0n || health.nextRoundAt <= 0n) return null;
      return Number(health.nextRoundAt) - Math.floor(Date.now() / 1000);
    } catch (err) {
      log.debug("health read failed; falling back to local interval", { error: (err as Error).message });
      return null;
    }
  }

  async function nextDelayMs(previousOk: boolean): Promise<number> {
    const untilNext = await secondsUntilNextRound();
    let base = intervalMs;
    if (untilNext !== null) {
      if (previousOk) {
        // submit again right after the next round opens
        base = untilNext > 0 ? untilNext * 1000 : 0;
      } else {
        // retry inside the current window, backing off by the configured fraction
        const remaining = (untilNext > 0 ? untilNext : intervalMs / 1000) * 1000;
        base = Math.max(2_000, Math.round(remaining * retryFraction));
      }
    }
    return Math.max(500, base + Math.round(Math.random() * jitterMs));
  }

  async function run() {
    if (stopped) return;
    const ok = await tickOnce();
    if (stopped) return;
    const delay = await nextDelayMs(ok);
    timer = setTimeout(run, delay);
  }

  void run();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

/**
 * Only treat truly un-recoverable errors as fatal (e.g. missing operator
 * wallet or chain-level issues). Expected per-round failures — quote hiccups,
 * outlier rejection, on-chain reverts like already-submitted — are logged and
 * the loop simply continues on the next tick.
 */
function isUnexpectedFatal(e: Error): boolean {
  const msg = e.message?.toLowerCase() ?? "";
  if (msg.includes("no operator wallet")) return true;
  if (msg.includes("invalid private key")) return true;
  if (msg.includes("insufficient funds")) return true;
  if (msg.includes("nonce too low")) return true;
  if (msg.includes("chain mismatch")) return true;
  return false;
}

export function defaultIntervalMs(config: BotOracleConfig): number {
  void config;
  return 120_000;
}
