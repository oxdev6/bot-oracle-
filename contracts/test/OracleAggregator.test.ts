import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";
import {
  deployOracleStack,
  BOT_ASSET_ID,
  ROUND_INTERVAL,
  DEVIATION_BPS,
  STALE_AFTER,
  EMISSION_PER_ROUND,
  MIN_STAKE,
  roundTrip,
  submitAs,
  submitAsAt,
  nowTs,
  staleTs,
} from "./fixtures";

const rialto = 100_000_000n; // BOT/USDT at 100.00 with 8 decimals

describe("OracleAggregator", () => {
  const fixture = async () => {
    const s = await deployOracleStack();
    await s.aggregator.connect(s.timelockSigner).registerAsset(BOT_ASSET_ID, 8, "BOT / USDT");
    for (const acc of [s.operator, s.alice, s.bob]) {
      await s.token.connect(acc).approve(s.vault.target, MIN_STAKE * 2n);
      await s.vault.connect(acc).stake(MIN_STAKE);
    }
    return s;
  };

  describe("assets & eligibility", () => {
    it("only owner registers assets", async () => {
      const s = await deployOracleStack();
      await expect(
        s.aggregator.connect(s.timelockSigner).registerAsset(ethers.id("X"), 8, "X"),
      ).to.not.be.reverted;
      // alice (non-owner) cannot register
      await expect(
        s.aggregator.connect(s.alice).registerAsset(ethers.id("Y"), 8, "Y"),
      ).to.be.reverted;
    });

    it("unregistered asset cannot be submitted", async () => {
      const s = await deployOracleStack();
      await expect(
        s.aggregator.connect(s.operator).submitPrice(BOT_ASSET_ID, rialto, await nowTs()),
      ).to.be.revertedWith("OA: unknown asset");
    });

    it("non-staked caller cannot submit", async () => {
      const s = await deployOracleStack();
      await s.aggregator.connect(s.timelockSigner).registerAsset(BOT_ASSET_ID, 8, "BOT / USDT");
      // carol has LODE but no stake
      await expect(
        s.aggregator.connect(s.carol).submitPrice(BOT_ASSET_ID, rialto, await nowTs()),
      ).to.be.revertedWith("OA: not eligible");
    });

    it("positive price enforced", async () => {
      const s = await loadFixture(fixture);
      await expect(
        s.aggregator.connect(s.operator).submitPrice(BOT_ASSET_ID, 0, await nowTs()),
      ).to.be.revertedWith("OA: price must be positive");
    });

    it("submitter cannot double-submit a round", async () => {
      const s = await loadFixture(fixture);
      await s.aggregator.connect(s.operator).submitPrice(BOT_ASSET_ID, rialto, await nowTs());
      await expect(
        s.aggregator.connect(s.operator).submitPrice(BOT_ASSET_ID, rialto + 1n, await nowTs()),
      ).to.be.revertedWith("OA: already submitted");
    });
  });

  describe("median aggregation", () => {
    it("produces the median across all operators", async () => {
      const s = await loadFixture(fixture);

      await submitAs(s, BOT_ASSET_ID, rialto, s.operator);
      await submitAs(s, BOT_ASSET_ID, rialto + 1_000_000n, s.alice);
      await submitAs(s, BOT_ASSET_ID, rialto - 2_000_000n, s.bob);

      await roundTrip();
      await s.aggregator.closeRound(BOT_ASSET_ID);

      const latest = await s.aggregator.getLatestPrice(BOT_ASSET_ID);
      expect(latest.price).to.equal(rialto);
      expect(latest.updatedAt).to.be.gt(0);
      expect(latest.roundId).to.equal(1);
      expect(await s.aggregator.getFeedHealth(BOT_ASSET_ID)).to.exist;
    });

    it("even-count median is the mean of the middle two", async () => {
      const s = await loadFixture(fixture);
      // stake carol too for 4 submitters
      await s.token.connect(s.carol).approve(s.vault.target, MIN_STAKE);
      await s.vault.connect(s.carol).stake(MIN_STAKE);

      const base = rialto; // 100.00
      const p1 = base + 1_000_000n;   // 101.00
      const p2 = base - 1_000_000n;   //  99.00
      const p3 = base + 2_000_000n;   // 102.00
      const p4 = base - 2_000_000n;   //  98.00
      await submitAs(s, BOT_ASSET_ID, p1, s.operator);
      await submitAs(s, BOT_ASSET_ID, p2, s.alice);
      await submitAs(s, BOT_ASSET_ID, p3, s.bob);
      await submitAs(s, BOT_ASSET_ID, p4, s.carol);

      await roundTrip();
      await s.aggregator.closeRound(BOT_ASSET_ID);
      const latest = await s.aggregator.getLatestPrice(BOT_ASSET_ID);
      expect(latest.price).to.equal(base); // (99 + 101)/2 == 100
    });
  });

  describe("outlier rejection", () => {
    it("rejects a hard outlier at submit time vs published reference", async () => {
      const s = await loadFixture(fixture);
      // first round: prices around rialto
      await submitAs(s, BOT_ASSET_ID, rialto, s.operator);
      await submitAs(s, BOT_ASSET_ID, rialto + 1_000_000n, s.alice);
      await submitAs(s, BOT_ASSET_ID, rialto - 1_000_000n, s.bob);
      await roundTrip();
      await s.aggregator.closeRound(BOT_ASSET_ID);

      // next round, someone submits a price >3% away → rejected
      await roundTrip();
      await expect(
        submitAs(s, BOT_ASSET_ID, rialto + rialto / 10n, s.operator), // +10%
      ).to.be.revertedWith("OA: outlier rejected");
    });

it("drop-outlier at close: median ignores a giant wrong submission", async () => {
      const s = await loadFixture(fixture);
      // stake carol first so she can submit
      await s.token.connect(s.carol).approve(s.vault.target, MIN_STAKE);
      await s.vault.connect(s.carol).stake(MIN_STAKE);

      await submitAs(s, BOT_ASSET_ID, rialto, s.operator);
      await submitAs(s, BOT_ASSET_ID, rialto, s.alice);
      await submitAs(s, BOT_ASSET_ID, rialto, s.bob);
      // first round, no reference yet — carol's 10x gets accepted at submit
      await submitAs(s, BOT_ASSET_ID, rialto * 10n, s.carol);

      await roundTrip();
      await s.aggregator.closeRound(BOT_ASSET_ID);
      const latest = await s.aggregator.getLatestPrice(BOT_ASSET_ID);
      expect(latest.price).to.equal(rialto);
    });
  });

  describe("circuit breaker", () => {
    it("pauses the feed on >20% round-over-round move, manual resume", async () => {
      const s = await loadFixture(fixture);
      await submitAs(s, BOT_ASSET_ID, rialto, s.operator);
      await submitAs(s, BOT_ASSET_ID, rialto, s.alice);
      await submitAs(s, BOT_ASSET_ID, rialto, s.bob);
      await roundTrip();
      await s.aggregator.closeRound(BOT_ASSET_ID);

      // wait past staleAfterSeconds so submit-time outlier check is bypassed
      await time.increase(STALE_AFTER + 1);

      const big = rialto + (rialto * 30n) / 100n;
      await submitAs(s, BOT_ASSET_ID, big, s.operator);
      await submitAs(s, BOT_ASSET_ID, big, s.alice);
      await submitAs(s, BOT_ASSET_ID, big, s.bob);
      await roundTrip();

      await expect(s.aggregator.closeRound(BOT_ASSET_ID))
        .to.emit(s.aggregator, "FeedPaused")
        .withArgs(BOT_ASSET_ID, rialto, big, 3000);

      const health = await s.aggregator.getFeedHealth(BOT_ASSET_ID);
      expect(health.isPaused).to.equal(true);
      await expect(
        s.aggregator.connect(s.operator).submitPrice(BOT_ASSET_ID, rialto, await nowTs()),
      ).to.be.reverted;

      // only timelock (owner) can resume, and only for this feed
      await expect(s.aggregator.connect(s.alice).resumeFeed(BOT_ASSET_ID)).to.be.reverted;
      await s.aggregator.connect(s.timelockSigner).resumeFeed(BOT_ASSET_ID);
      expect((await s.aggregator.getFeedHealth(BOT_ASSET_ID)).isPaused).to.equal(false);
    });
  });

  describe("staleness & health", () => {
    it("reports stale once no update within `staleAfterSeconds`", async () => {
      const s = await loadFixture(fixture);
      await submitAs(s, BOT_ASSET_ID, rialto, s.operator);
      await submitAs(s, BOT_ASSET_ID, rialto, s.alice);
      await submitAs(s, BOT_ASSET_ID, rialto, s.bob);
      await roundTrip();
      await s.aggregator.closeRound(BOT_ASSET_ID);

      let health = await s.aggregator.getFeedHealth(BOT_ASSET_ID);
      expect(health.isStale).to.equal(false);

      await time.increase(STALE_AFTER + 1);
      health = await s.aggregator.getFeedHealth(BOT_ASSET_ID);
      expect(health.isStale).to.equal(true);
    });

    it("round with no submissions publishes nothing but rolls round", async () => {
      const s = await loadFixture(fixture);
      await submitAs(s, BOT_ASSET_ID, rialto, s.operator);
      await submitAs(s, BOT_ASSET_ID, rialto, s.alice);
      await submitAs(s, BOT_ASSET_ID, rialto, s.bob);
      await roundTrip();
      await s.aggregator.closeRound(BOT_ASSET_ID);

      // skip a round entirely
      await roundTrip();
      await s.aggregator.closeRound(BOT_ASSET_ID);

      // price kept, round advanced
      const latest = await s.aggregator.getLatestPrice(BOT_ASSET_ID);
      expect(latest.price).to.equal(rialto);
    });
  });

  describe("rewards", () => {
    it("splits emission equally among in-threshold submitters", async () => {
      const s = await loadFixture(fixture);
      const opBefore = await s.token.balanceOf(await s.operator.getAddress());

      await submitAs(s, BOT_ASSET_ID, rialto, s.operator);
      await s.token.connect(s.carol).approve(s.vault.target, MIN_STAKE);
      await s.vault.connect(s.carol).stake(MIN_STAKE);
      await submitAs(s, BOT_ASSET_ID, rialto, s.alice);
      await submitAs(s, BOT_ASSET_ID, rialto, s.bob);

      await roundTrip();
      await s.aggregator.closeRound(BOT_ASSET_ID);

      const opAfter = await s.token.balanceOf(await s.operator.getAddress());
      expect(opAfter - opBefore).to.equal(EMISSION_PER_ROUND / 3n);
    });

    it("does not reward operators whose submission got filtered by median outlier", async () => {
      const s = await loadFixture(fixture);
      await s.token.connect(s.carol).approve(s.vault.target, MIN_STAKE);
      await s.vault.connect(s.carol).stake(MIN_STAKE);

      const carolBefore = await s.token.balanceOf(await s.carol.getAddress());

      // FIRST round: no published reference yet, so a 10x outlier gets stored
      // (close-time median filter is what catches it).
      await submitAs(s, BOT_ASSET_ID, rialto, s.operator);
      await submitAs(s, BOT_ASSET_ID, rialto, s.alice);
      await submitAs(s, BOT_ASSET_ID, rialto, s.bob);
      await submitAs(s, BOT_ASSET_ID, rialto * 10n, s.carol);

      await roundTrip();
      await s.aggregator.closeRound(BOT_ASSET_ID);

      const latest = await s.aggregator.getLatestPrice(BOT_ASSET_ID);
      expect(latest.price).to.equal(rialto);

      // carol got NO reward — her submission was filtered
      const carolAfter = await s.token.balanceOf(await s.carol.getAddress());
      expect(carolAfter).to.equal(carolBefore);
    });
  });

  describe("round rolling", () => {
    it("multiple rounds advance roundId and update price", async () => {
      const s = await loadFixture(fixture);
      const prices = [rialto, rialto + 1_000_000n, rialto + 2_000_000n];
      for (const p of prices) {
        await submitAs(s, BOT_ASSET_ID, p, s.operator);
        await submitAs(s, BOT_ASSET_ID, p, s.alice);
        await submitAs(s, BOT_ASSET_ID, p, s.bob);
        await roundTrip();
        await s.aggregator.closeRound(BOT_ASSET_ID);
      }
      const latest = await s.aggregator.getLatestPrice(BOT_ASSET_ID);
      expect(latest.roundId).to.equal(3);
      expect(latest.price).to.equal(prices[2]);
    });

    it("closeRound before interval elapse reverts", async () => {
      const s = await loadFixture(fixture);
      await submitAs(s, BOT_ASSET_ID, rialto, s.operator);
      await expect(s.aggregator.closeRound(BOT_ASSET_ID)).to.be.revertedWith("OA: round active");
    });
  });

  describe("timelocked param changes", () => {
    it("non-owner cannot change params", async () => {
      const s = await loadFixture(fixture);
      await expect(s.aggregator.connect(s.alice).setEmissionPerRound(1)).to.be.reverted;
      await expect(s.aggregator.connect(s.alice).setRoundInterval(60)).to.be.reverted;
      await expect(s.aggregator.connect(s.alice).resumeFeed(BOT_ASSET_ID)).to.be.reverted;
      await expect(s.aggregator.connect(s.alice).pauseFeed(BOT_ASSET_ID)).to.be.reverted;
      await expect(s.aggregator.connect(s.alice).setMinSubmissions(1)).to.be.reverted;
      // timelock CAN change params
      await expect(s.aggregator.connect(s.timelockSigner).setEmissionPerRound(1)).to.not.be.reverted;
      await expect(s.aggregator.connect(s.timelockSigner).setRoundInterval(60)).to.not.be.reverted;
      await expect(s.aggregator.connect(s.timelockSigner).setMinSubmissions(2)).to.not.be.reverted;
    });
  });
});