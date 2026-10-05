import type { AggregateResult, PriceObservation } from "./types";
import { deviationPct, median } from "./utils";

/**
 * Combine the node's own source observations into a single local price for
 * a feed:
 *
 *  1. Reject local outliers: any observation deviating more than
 *     `maxDeviationPct` from the local median is discarded.
 *  2. Result price = median of the surviving observations.
 *
 * If you want an adversarially lower limit on the number of agreeing
 * sources, pass `minObservations`. When fewer survive, the call throws so
 * the scheduler can skip the round instead of submitting a bad price.
 */
export function aggregateObservations(
  observations: PriceObservation[],
  opts?: { minObservations?: number; maxDeviationPct?: number },
): AggregateResult {
  const maxDev = opts?.maxDeviationPct ?? 5;
  const minObs = opts?.minObservations ?? 1;

  if (observations.length === 0) throw new Error("no observations");
  const local = median(observations.map((o) => o.priceUsd));

  const kept: PriceObservation[] = [];
  for (const o of observations) {
    if (deviationPct(o.priceUsd, local) <= maxDev) kept.push(o);
  }
  if (kept.length === 0) throw new Error("all observations failed outlier check");

  const prices = kept.map((o) => o.priceUsd);
  const resultMedian = median(prices);
  let spreadPct = 0;
  for (const p of prices) spreadPct = Math.max(spreadPct, deviationPct(p, resultMedian));

  if (kept.length < minObs) {
    throw new Error(`only ${kept.length}/${observations.length} sources agreed`);
  }

  return { assetId: observations[0].assetId, medianUsd: resultMedian, observations: kept, spreadPct };
}