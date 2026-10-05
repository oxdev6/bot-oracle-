import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";
import {
  deployOracleStack,
  BOT_ASSET_ID,
  LODE_ASSET_ID,
  ROUND_INTERVAL,
  MIN_STAKE,
  MIN_SUBMISSIONS,
  MISS_LIMIT,
  STALE_AFTER,
  roundTrip,
  submitAs,
  submitAsAt,
  nowTs,
  staleTs,
} from "./fixtures";

/**
 * Behaviour that the spec (docs/spec.md) and methodology (docs/methodology.md)
 * promise but which had no implementation or test:
 *   - quorum: a round below `minSubmissions` must not publish
 *   - per-feed circuit breaker: pausing BOT/USDT must not touch LODE/USDT
 *   - automatic liveness + accuracy slashing
 *   - source-timestamp freshness enforcement
 *   - reward isolation: an empty reward pool must not block price publication
 */
describe("Safety rules", () => {
  const rialto = 100_000_000n; // 100.00 with 8 decimals

  const fixture = async () => {
    const s = await deployOracleStack();
    await s.aggregator.connect(s.timelockSigner).registerAsset(BOT_ASSET_ID, 8, "BOT / USDT");
    await s.aggregator.connect(s.timelockSigner).registerAsset(LODE_ASSET_ID, 8, "LODE / USDT");
    // four staked operators against a quorum of three: quorum is still
    // unreachable with fewer than three reports, but one of the four can
    // go dark while the feed keeps publishing (liveness slashing cases)
    for (const acc of [s.operator, s.alice, s.bob, s.carol]) {
      await s.token.connect(acc).approve(s.vault.target, MIN_STAKE * 2n);
      await s.vault.connect(acc).stake(MIN_STAKE);
    }
    return s;
  };

  describe("quorum", () => {
    it("a single submission cannot publish a price", async () => {
      const s = await loadFixture(fixture);
      expect(await s.aggregator.minSubmissions()).to.equal(MIN_SUBMISSIONS);

      await submitAs(s, BOT_ASSET_ID, rialto, s.operator);
      await roundTrip();
      await expect(s.aggregator.closeRound(BOT_ASSET_ID))
        .to.emit(s.aggregator, "RoundClosedNoData")
        .withArgs(BOT_ASSET_ID, 1, 1, MIN_SUBMISSIONS, 1);

      const latest = await s.aggregator.getLatestPrice(BOT_ASSET_ID);
      expect(latest.price).to.equal(0);
      expect(latest.updatedAt).to.equal(0);
      expect(latest.roundId).to.equal(1); // round still advanced
    });

    it("publishes once quorum is reached", async () => {
      const s = await loadFixture(fixture);
      await submitAs(s, BOT_ASSET_ID, rialto, s.operator);
      await submitAs(s, BOT_ASSET_ID, rialto, s.alice);
      await submitAs(s, BOT_ASSET_ID, rialto, s.bob);
      await roundTrip();
      await expect(s.aggregator.closeRound(BOT_ASSET_ID))
        .to.emit(s.aggregator, "RoundClosed")
        .withArgs(BOT_ASSET_ID, 1, rialto, 3, 0);
      expect((await s.aggregator.getLatestPrice(BOT_ASSET_ID)).price).to.equal(rialto);
    });

    it("quorum is a timelocked parameter and cannot be zero", async () => {
      const s = await loadFixture(fixture);
      await expect(
        s.aggregator.connect(s.timelockSigner).setMinSubmissions(0),
      ).to.be.revertedWith("OA: quorum at least 1");
      await s.aggregator.connect(s.timelockSigner).setMinSubmissions(2);
      await submitAs(s, BOT_ASSET_ID, rialto, s.operator);
      await submitAs(s, BOT_ASSET_ID, rialto, s.alice);
      await roundTrip();
      await s.aggregator.closeRound(BOT_ASSET_ID);
      expect((await s.aggregator.getLatestPrice(BOT_ASSET_ID)).price).to.equal(rialto);
    });
  });

  describe("per-feed circuit breaker", () => {
    it("pausing one feed leaves the other feed running", async () => {
      const s = await loadFixture(fixture);

      // publish an initial price on both feeds
      for (const [id, px] of [[BOT_ASSET_ID, rialto], [LODE_ASSET_ID, rialto]] as const) {
        await submitAs(s, id, px, s.operator);
        await submitAs(s, id, px, s.alice);
        await submitAs(s, id, px, s.bob);
      }
      await roundTrip();
      await s.aggregator.closeRound(BOT_ASSET_ID);
      await s.aggregator.closeRound(LODE_ASSET_ID);

      // let both references go stale so a >20% move is accepted at submit time
      await time.increase(STALE_AFTER + 1);

      const big = rialto + (rialto * 30n) / 100n;
      for (const signer of [s.operator, s.alice, s.bob]) {
        await submitAs(s, BOT_ASSET_ID, big, signer);
      }
      await roundTrip();
      await expect(s.aggregator.closeRound(BOT_ASSET_ID)).to.emit(s.aggregator, "FeedPaused");

      // BOT/USDT is frozen …
      expect(await s.aggregator.isFeedPaused(BOT_ASSET_ID)).to.equal(true);
      await expect(
        submitAs(s, BOT_ASSET_ID, rialto, s.operator),
      ).to.be.revertedWith("OA: feed paused");
      // … LODE/USDT is not
      expect(await s.aggregator.isFeedPaused(LODE_ASSET_ID)).to.equal(false);
      await expect(submitAs(s, LODE_ASSET_ID, rialto, s.bob)).to.not.be.reverted;

      // and resuming one feed does not resume the other
      await s.aggregator.connect(s.timelockSigner).pauseFeed(LODE_ASSET_ID);
      await s.aggregator.connect(s.timelockSigner).resumeFeed(BOT_ASSET_ID);
      expect(await s.aggregator.isFeedPaused(BOT_ASSET_ID)).to.equal(false);
      expect(await s.aggregator.isFeedPaused(LODE_ASSET_ID)).to.equal(true);
    });

    it("pauseFeed is owner-only and idempotent-safe", async () => {
      const s = await loadFixture(fixture);
      await expect(s.aggregator.connect(s.alice).pauseFeed(BOT_ASSET_ID)).to.be.reverted;
      await s.aggregator.connect(s.timelockSigner).pauseFeed(BOT_ASSET_ID);
      await expect(s.aggregator.connect(s.timelockSigner).pauseFeed(BOT_ASSET_ID)).to.be.revertedWith(
        "OA: already paused",
      );
      await s.aggregator.connect(s.timelockSigner).resumeFeed(BOT_ASSET_ID);
      await expect(s.aggregator.connect(s.timelockSigner).resumeFeed(BOT_ASSET_ID)).to.be.revertedWith(
        "OA: not paused",
      );
    });
  });

  /** Four operators report, so a published round also establishes everyone. */
  async function establishOperators(s: any, price = rialto) {
    await submitAllFour(s, price);
    await roundTrip();
    await s.aggregator.closeRound(BOT_ASSET_ID);
  }

  async function submitAllFour(s: any, price: bigint) {
    for (const acc of [s.operator, s.alice, s.bob, s.carol]) {
      await submitAs(s, BOT_ASSET_ID, price, acc);
    }
  }

  /** Quorum (3) is met by everyone except bob, who is the one going dark. */
  async function submitThreeWithoutBob(s: any, price: bigint) {
    for (const acc of [s.operator, s.alice, s.carol]) {
      await submitAs(s, BOT_ASSET_ID, price, acc);
    }
  }

  describe("automatic liveness slashing", () => {
    it("slashes an operator that misses consecutive rounds", async () => {
      const s = await loadFixture(fixture);
      expect(await s.aggregator.livenessMissLimit()).to.equal(MISS_LIMIT);

      const bobAddr = await s.bob.getAddress();
      await establishOperators(s);
      const stakeBefore = await s.vault.stakeOf(bobAddr);

      // bob goes dark; the other three keep quorum up
      for (let i = 0; i < MISS_LIMIT; i++) {
        await submitThreeWithoutBob(s, rialto);
        await roundTrip();
        if (i < MISS_LIMIT - 1) await s.aggregator.closeRound(BOT_ASSET_ID);
      }
      await s.aggregator.closeRound(BOT_ASSET_ID);

      const st = await s.aggregator.operatorStats(BOT_ASSET_ID, bobAddr);
      expect(st.slashCount).to.equal(1);
      expect(st.slashedAmount).to.be.greaterThan(0);
      expect(await s.vault.stakeOf(bobAddr)).to.be.lessThan(stakeBefore);
      // a liveness slash is 1% of effective stake by default
      expect(st.slashedAmount).to.equal((stakeBefore * 100n) / 10_000n);
      expect(
        await s.aggregator.slashReasonLabel(ethers.id("LODESTAR_LIVENESS")),
      ).to.equal("liveness: missed consecutive rounds");
    });

    it("emits the vault Slash event with the liveness reason", async () => {
      const s = await loadFixture(fixture);
      await submitAs(s, BOT_ASSET_ID, rialto, s.operator);
      await submitAs(s, BOT_ASSET_ID, rialto, s.alice);
      await submitAs(s, BOT_ASSET_ID, rialto, s.bob);
      await roundTrip();
      await s.aggregator.closeRound(BOT_ASSET_ID);

      await establishOperators(s);

      const liveness = ethers.id("LODESTAR_LIVENESS");
      const bobAddr = await s.bob.getAddress();
      for (let i = 0; i < MISS_LIMIT - 1; i++) {
        await submitThreeWithoutBob(s, rialto);
        await roundTrip();
        await s.aggregator.closeRound(BOT_ASSET_ID);
      }
      await submitThreeWithoutBob(s, rialto);
      await roundTrip();
      await expect(s.aggregator.closeRound(BOT_ASSET_ID))
        .to.emit(s.vault, "Slash")
        .withArgs(bobAddr, (MIN_STAKE * 100n) / 10_000n, 0, liveness);
    });

    it("does not slash while quorum is unmet", async () => {
      const s = await loadFixture(fixture);
      await submitAs(s, BOT_ASSET_ID, rialto, s.operator);
      await roundTrip();
      await s.aggregator.closeRound(BOT_ASSET_ID);

      // nobody submits for MISS_LIMIT rounds: misses accrue but no reward
      // evidence exists, and slashing a whole network outage would punish
      // every honest operator at once.
      for (let i = 0; i < MISS_LIMIT + 2; i++) {
        await roundTrip();
        await s.aggregator.closeRound(BOT_ASSET_ID);
      }
      expect((await s.aggregator.operatorStats(BOT_ASSET_ID, await s.operator.getAddress())).slashCount).to.equal(
        0,
      );
    });

    it("a submitted round resets the miss counter", async () => {
      const s = await loadFixture(fixture);
      const bobAddr = await s.bob.getAddress();
      await establishOperators(s);

      // one miss short of the limit …
      await submitThreeWithoutBob(s, rialto);
      await roundTrip();
      await s.aggregator.closeRound(BOT_ASSET_ID);
      expect((await s.aggregator.operatorStats(BOT_ASSET_ID, bobAddr)).consecutiveMisses).to.equal(1);

      // … bob reports again and the counter is cleared, so he survives
      // the next two misses where he would otherwise be slashed
      await submitAllFour(s, rialto);
      await roundTrip();
      await s.aggregator.closeRound(BOT_ASSET_ID);
      const st = await s.aggregator.operatorStats(BOT_ASSET_ID, bobAddr);
      expect(st.consecutiveMisses).to.equal(0);
      expect(st.slashCount).to.equal(0);
      expect(st.slashCount).to.equal(0);
    });

    it("the timelock kill switch stops slashing without stopping pricing", async () => {
      const s = await loadFixture(fixture);
      await s.aggregator
        .connect(s.timelockSigner)
        .setSlashingParams(MISS_LIMIT, 100, 500, 900, false);

      await establishOperators(s);

      for (let i = 0; i < MISS_LIMIT; i++) {
        await submitThreeWithoutBob(s, rialto);
        await roundTrip();
        await s.aggregator.closeRound(BOT_ASSET_ID);
      }
      expect(
        (await s.aggregator.operatorStats(BOT_ASSET_ID, await s.bob.getAddress())).slashCount,
      ).to.equal(0);
      // pricing continued regardless
      expect((await s.aggregator.getLatestPrice(BOT_ASSET_ID)).price).to.equal(rialto);
    });
  });

  describe("automatic accuracy slashing", () => {
    it("slashes a grossly wrong submission but only far beyond the outlier band", async () => {
      const s = await loadFixture(fixture);

      // honest quorum first so a reference exists
      await establishOperators(s);

      // next round carol submits 3x — vetoed at submit time (no slash, the
      // submission simply never lands)
      await expect(submitAs(s, BOT_ASSET_ID, rialto * 3n, s.carol)).to.be.revertedWith(
        "OA: outlier rejected",
      );

      // carol's tracked-but-egregious case needs a stale reference so the
      // submit gate cannot veto her first.
      await time.increase(STALE_AFTER + 1);
      await submitAs(s, BOT_ASSET_ID, rialto, s.operator);
      await submitAs(s, BOT_ASSET_ID, rialto, s.alice);
      await submitAs(s, BOT_ASSET_ID, rialto * 5n, s.bob);
      await submitAs(s, BOT_ASSET_ID, rialto, s.carol);

      await roundTrip();
      await expect(s.aggregator.closeRound(BOT_ASSET_ID)).to.emit(s.aggregator, "OperatorSlashed");

      const st = await s.aggregator.operatorStats(BOT_ASSET_ID, await s.bob.getAddress());
      expect(st.slashCount).to.equal(1);
      expect(st.accuracyVetoes).to.be.greaterThan(0);
      expect(await s.vault.stakeOf(await s.bob.getAddress())).to.be.lessThan(MIN_STAKE);
    });

    it("a mildly-off submission inside the band is never slashed", async () => {
      const s = await loadFixture(fixture);
      await submitAs(s, BOT_ASSET_ID, rialto, s.operator);
      await submitAs(s, BOT_ASSET_ID, rialto, s.alice);
      await submitAs(s, BOT_ASSET_ID, rialto, s.bob);
      await roundTrip();
      await s.aggregator.closeRound(BOT_ASSET_ID);

      // 0.2% skew on every source: no veto, no slash, everyone paid
      const skewed = rialto - (rialto * 2n) / 1000n;
      await submitAs(s, BOT_ASSET_ID, skewed, s.operator);
      await submitAs(s, BOT_ASSET_ID, skewed, s.alice);
      await submitAs(s, BOT_ASSET_ID, skewed, s.bob);
      await roundTrip();
      await s.aggregator.closeRound(BOT_ASSET_ID);

      for (const signer of [s.operator, s.alice, s.bob]) {
        const st = await s.aggregator.operatorStats(BOT_ASSET_ID, await signer.getAddress());
        expect(st.slashCount).to.equal(0);
        expect(st.accuracyVetoes).to.equal(0);
      }
    });

    it("does not slash anyone when the breaker trips (market-wide move)", async () => {
      const s = await loadFixture(fixture);
      await submitAs(s, BOT_ASSET_ID, rialto, s.operator);
      await submitAs(s, BOT_ASSET_ID, rialto, s.alice);
      await submitAs(s, BOT_ASSET_ID, rialto, s.bob);
      await roundTrip();
      await s.aggregator.closeRound(BOT_ASSET_ID);

      await time.increase(STALE_AFTER + 1);
      // one straggler still reports the old price while the market moved 40%
      const big = rialto + (rialto * 40n) / 100n;
      await submitAs(s, BOT_ASSET_ID, big, s.operator);
      await submitAs(s, BOT_ASSET_ID, big, s.alice);
      await submitAs(s, BOT_ASSET_ID, rialto, s.bob);
      await roundTrip();
      await expect(s.aggregator.closeRound(BOT_ASSET_ID)).to.emit(s.aggregator, "FeedPaused");

      for (const signer of [s.operator, s.alice, s.bob]) {
        const st = await s.aggregator.operatorStats(BOT_ASSET_ID, await signer.getAddress());
        expect(st.slashCount).to.equal(0);
      }
    });
  });

  describe("source timestamp freshness", () => {
    it("rejects a stale source timestamp", async () => {
      const s = await loadFixture(fixture);
      await expect(
        submitAsAt(s, BOT_ASSET_ID, rialto, s.operator, await staleTs()),
      ).to.be.revertedWith("OA: stale source");
    });

    it("rejects a timestamp from the future", async () => {
      const s = await loadFixture(fixture);
      await expect(
        submitAsAt(s, BOT_ASSET_ID, rialto, s.operator, (await nowTs()) + 3600),
      ).to.be.revertedWith("OA: future timestamp");
    });

    it("accepts a recent timestamp", async () => {
      const s = await loadFixture(fixture);
      await expect(submitAsAt(s, BOT_ASSET_ID, rialto, s.operator, await nowTs())).to.not.be
        .reverted;
    });
  });

  describe("reward isolation", () => {
    it("an unfunded reward pool skips payouts but still publishes", async () => {
      const s = await loadFixture(fixture);

      // Demand more emission than the pool holds (100k LODE funded): the
      // per-operator payout is the emission split three ways, and three of
      // them exceed the pool, so `distributeRewards` reverts inside the vault.
      const emission = ethers.parseEther("100000000");
      await s.aggregator.connect(s.timelockSigner).setEmissionPerRound(emission);
      const payout = (emission / 3n) * 3n;
      expect(payout).to.be.greaterThan(await s.vault.rewardPoolBalance());

      for (const acc of [s.operator, s.alice, s.bob]) {
        await submitAs(s, BOT_ASSET_ID, rialto, acc);
      }
      await roundTrip();

      const opBefore = await s.token.balanceOf(await s.operator.getAddress());
      await expect(s.aggregator.closeRound(BOT_ASSET_ID))
        .to.emit(s.aggregator, "RewardsSkipped")
        .withArgs(BOT_ASSET_ID, 1, payout);

      // price published, nobody paid
      expect((await s.aggregator.getLatestPrice(BOT_ASSET_ID)).price).to.equal(rialto);
      expect(await s.token.balanceOf(await s.operator.getAddress())).to.equal(opBefore);
    });
  });

  describe("operator accounting views", () => {
    it("tracks uptime, submissions and vetoes per operator", async () => {
      const s = await loadFixture(fixture);
      const opAddr = await s.operator.getAddress();

      for (let i = 0; i < 3; i++) {
        await submitAs(s, BOT_ASSET_ID, rialto, s.operator);
        await submitAs(s, BOT_ASSET_ID, rialto, s.alice);
        await submitAs(s, BOT_ASSET_ID, rialto, s.bob);
        await roundTrip();
        await s.aggregator.closeRound(BOT_ASSET_ID);
      }

      const st = await s.aggregator.operatorStats(BOT_ASSET_ID, opAddr);
      expect(st.tracked).to.equal(true);
      expect(st.submissions).to.equal(3);
      expect(st.roundsSeen).to.equal(3);
      expect(await s.aggregator.getOperatorUptimeBps(BOT_ASSET_ID, opAddr)).to.equal(10_000);
      expect(await s.aggregator.getOperatorCount(BOT_ASSET_ID)).to.equal(3);

      const listed = await s.aggregator.getOperators(BOT_ASSET_ID, 0, 10);
      expect(listed.length).to.equal(3);
      expect(listed).to.include(opAddr);

      const paged = await s.aggregator.getOperators(BOT_ASSET_ID, 2, 1);
      expect(paged.length).to.equal(1);
    });

    it("reports the live round's submissions", async () => {
      const s = await loadFixture(fixture);
      await submitAs(s, BOT_ASSET_ID, rialto, s.operator);
      await submitAs(s, BOT_ASSET_ID, rialto, s.alice);

      expect(await s.aggregator.getSubmissionCount(BOT_ASSET_ID)).to.equal(2);
      const [ops, prices, times] = await s.aggregator.getRoundSubmissions(BOT_ASSET_ID, 1, 10);
      expect(ops.length).to.equal(2);
      expect(prices.length).to.equal(2);
      expect(times[0]).to.be.greaterThan(0);

      const health = await s.aggregator.getFeedHealth(BOT_ASSET_ID);
      expect(health.openRoundSubmissions).to.equal(2);
      expect(health.currentRound).to.equal(0);
      expect(health.nextRoundAt).to.be.greaterThan(0);
      expect(health.hasPrice).to.equal(false);
    });
  });

  describe("round economics bookkeeping", () => {
    it("counts vetoed submissions in the round event and health view", async () => {
      const s = await loadFixture(fixture);
      await s.token.connect(s.carol).approve(s.vault.target, MIN_STAKE);
      await s.vault.connect(s.carol).stake(MIN_STAKE);

      await submitAs(s, BOT_ASSET_ID, rialto, s.operator);
      await submitAs(s, BOT_ASSET_ID, rialto, s.alice);
      await submitAs(s, BOT_ASSET_ID, rialto, s.bob);
      // no reference yet, so this 10x lands in the round and gets vetoed at close
      await submitAs(s, BOT_ASSET_ID, rialto * 10n, s.carol);

      await roundTrip();
      await expect(s.aggregator.closeRound(BOT_ASSET_ID))
        .to.emit(s.aggregator, "RoundClosed")
        .withArgs(BOT_ASSET_ID, 1, rialto, 3, 1);

      const health = await s.aggregator.getFeedHealth(BOT_ASSET_ID);
      expect(health.lastRoundVetoed).to.equal(1);
      expect(health.lastRoundSubmissions).to.equal(3);
    });

    it("reward pool balance view reports what is not backing stake", async () => {
      const s = await loadFixture(fixture);
      const pool = await s.vault.rewardPoolBalance();
      expect(pool).to.be.greaterThan(0);
      const bonded = await s.vault.totalStake();
      expect(pool + bonded).to.equal(await s.token.balanceOf(await s.vault.getAddress()));
    });
  });

  describe("round interval sanity", () => {
    it("still refuses to close an active round early", async () => {
      const s = await loadFixture(fixture);
      await submitAs(s, BOT_ASSET_ID, rialto, s.operator);
      await time.increase(ROUND_INTERVAL - 30);
      await expect(s.aggregator.closeRound(BOT_ASSET_ID)).to.be.revertedWith("OA: round active");
    });
  });
});
