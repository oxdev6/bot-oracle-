/**
 * Live source probe.
 *
 * Runs every feed in `config/feeds.json` through its configured sources and
 * prints the observations it gets back (or the failure). Use it to re-verify
 * that pool addresses, API ids and token decimals are still correct before
 * trusting a feed in production.
 *
 *   npx tsx scripts/probe-sources.ts            # config/feeds.json
 *   npx tsx scripts/probe-sources.ts path.json  # alternate feed list
 *
 * Exits non-zero if any feed that has sources fails to return a price.
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { keccak256, toBytes } from "viem";
import { fetchFeed } from "../src/fetchers";
import type { FeedConfig } from "../src/types";

async function main() {
  const configPath = process.argv[2] ?? path.join(process.cwd(), "config", "feeds.json");
  const raw: Array<Omit<FeedConfig, "assetId"> & { assetId?: string }> = JSON.parse(
    readFileSync(configPath, "utf8"),
  );

  let failures = 0;
  for (const entry of raw) {
    const feed: FeedConfig = {
      ...entry,
      assetId: entry.assetId ?? (keccak256(toBytes(entry.symbol)) as `0x${string}`),
    };

    if (feed.sources.length === 0) {
      console.log(`\n${feed.symbol}: no sources configured — skipped`);
      continue;
    }

    try {
      const observations = await fetchFeed(feed);
      console.log(`\n${feed.symbol}:`);
      for (const obs of observations) {
        console.log(`  ${obs.source.padEnd(10)} price=${obs.priceUsd}`);
      }
    } catch (err) {
      failures += 1;
      console.error(`\n${feed.symbol}: ALL SOURCES FAILED — ${err instanceof Error ? err.message : err}`);
    }
  }

  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
