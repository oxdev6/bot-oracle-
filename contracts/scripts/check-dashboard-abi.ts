import { ethers } from "hardhat";
import { deployOracleStack, BOT_ASSET_ID, MIN_STAKE, roundTrip, submitAs, nowTs } from "../test/fixtures";

/**
 * Mirrors dashboard/lib/client.ts's aggregator reads against a real deployment,
 * so ABI drift between the dashboard and the contracts fails here instead of
 * showing an empty dashboard in production.
 */
async function main() {
  const s: any = await deployOracleStack();
  const agg = s.aggregator;
  const vault = s.vault;

  await agg.connect(s.timelockSigner).registerAsset(BOT_ASSET_ID, 8, "BOT / USDT");
  for (const acc of [s.operator, s.alice, s.bob]) {
    await s.token.connect(acc).approve(vault.target, MIN_STAKE);
    await vault.connect(acc).stake(MIN_STAKE);
  }
  for (const acc of [s.operator, s.alice, s.bob]) {
    await submitAs(s, BOT_ASSET_ID, 100_000_000n, acc);
  }
  await roundTrip();
  await agg.closeRound(BOT_ASSET_ID);

  const assets: string[] = await agg.getRegisteredAssets();
  console.log(`registered assets: ${assets.length}`);

  for (const assetId of assets) {
    const price: any = await agg.getLatestPrice(assetId);
    // exactly the fields the dashboard destructures, in contract order
    const h = await agg.getFeedHealth(assetId);
    if (h.length !== 10) throw new Error(`getFeedHealth returned ${h.length} fields, dashboard expects 10`);
    const [isPaused, isStale, hasPrice, lastUpdate, lastSubs, lastVetoed, roundStart, nextRoundAt, currentRound, openSubs] = h;

    if (nextRoundAt <= roundStart) throw new Error("nextRoundAt must be after roundStart");
    if (lastUpdate === 0n !== !hasPrice) throw new Error("hasPrice disagrees with lastUpdate");

    console.log(
      `${await agg.feedSymbols(assetId)} price=${ethers.formatUnits(price.price, price.decimals)} ` +
        `round=${currentRound} openSubs=${openSubs} lastSubs=${lastSubs} vetoed=${lastVetoed} ` +
        `paused=${isPaused} stale=${isStale} hasPrice=${hasPrice} ` +
        `roundStart=${new Date(Number(roundStart) * 1000).toISOString()} ` +
        `next=${new Date(Number(nextRoundAt) * 1000).toISOString()}`,
    );
  }

  console.log(`stakers: ${await vault.getStakerCount()}, total stake: ${ethers.formatEther(await vault.totalStake())}`);
  console.log(`submitted at ts ${await nowTs()} — dashboard ABI surface matches the contracts`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e?.message ?? e);
    process.exit(1);
  });

export {};