import type { BotOracleConfig, FeedConfig } from "./types";
import { fetchFeed } from "./fetchers";
import { aggregateObservations } from "./aggregator";
import { usdToScaled } from "./utils";
import type { Submitter } from "./submitter";

export interface SchedulerOptions {
  config: BotOracleConfig;
  submitter: Submitter;
  onRound?: (feed: FeedConfig, result: { medianUsd: number; scaled: bigint; txHash?: `0x${string}` }) => void;
  onError?: (feed: FeedConfig, error: Error) => void;
  /** In-process timer interval for the round loop (ms). Defaults to 120s. */
  intervalMs?: number;
}

export type RoundCleaner = () => void;

/**
 * Drives one feed's round loop:
 *   fetch → locally aggregate (median + reject local outliers) → submit scaled price.
 *
 * The loop is jittered to avoid all nodes trying to submit on the same
 * second. Failures (fetch, aggregation, or on-chain revert) are caught and
 * logged so a single bad round never crashes the node.
 */
export function runFeedLoop(opts: SchedulerOptions, feed: FeedConfig, shutdown: (code: number) => void) {
  const { config, submitter } = opts;
  const intervalMs = opts.intervalMs ?? 60_000;
  const jitterMs = config.operator.jitterSeconds * 1000;

  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  async function tickOnce() {
    const feedLabel = feed.symbol;
    try {
      const obsRaw = await fetchFeed(feed);
      const agg = aggregateObservations(obsRaw, {
        maxDeviationPct: config.operator.maxLocalDeviationPct,
        minObservations: Math.min(2, feed.sources.length),
      });

      const scaled = usdToScaled(agg.medianUsd, feed.feedDecimals);
      const { hash } = await submitter.submit(feed.assetId as `0x${string}`, scaled);

      console.log(
        `[round:${feedLabel}] median=${agg.medianUsd.toFixed(6)} scaled=${scaled.toString()} ` +
          `sources=${agg.observations.length} spread=${agg.spreadPct.toFixed(2)}% tx=${hash.slice(0, 10)}…`,
      );
      opts.onRound?.(feed, { medianUsd: agg.medianUsd, scaled, txHash: hash });
    } catch (err) {
      const e = err as Error;
      opts.onError?.(feed, e);
      if (isUnexpectedFatal(e)) {
        console.error(`[round:${feedLabel}] FATAL:`, e.message);
        shutdown(1);
      }
    }
  }

  function listen() {
    if (stopped) return;
    timer = setTimeout(run, intervalMs + Math.round(Math.random() * jitterMs));
  }

  async function run() {
    if (stopped) return;
    await tickOnce();
    listen();
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