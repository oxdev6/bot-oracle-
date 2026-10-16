import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";
import {
  deployOracleStack,
  BOT_ASSET_ID,
  WBOT_ASSET_ID,
  LODE_ASSET_ID,
  MIN_STAKE,
  roundTrip,
  submitAs,
  submitAsAt,
  nowTs,
} from "./fixtures";

const rialto = 100_000_000n; // 100.00 with 8 decimals

describe("Round history, keeper & asset lifecycle", () => {
  const fixture = async () => {
    const s = await deployOracleStack();
    await s.aggregator.connect(s.timelockSigner).registerAsset(BOT_ASSET_ID, 8, "BOT / USDT");
    await s.aggregator.connect(s.timelockSigner).registerAsset(WBOT_ASSET_ID, 8, "WBOT / USDT");
    for (const acc of [s.operator, s.alice, s.bob]) {
      await s.token.connect(acc).approve(s.vault.target, MIN_STAKE);
      await s.vault.connect(acc).stake(MIN_STAKE);
    }
    return s;
  };

  async function deployFeed(s: Awaited<ReturnType<typeof deployOracleStack>>, assetId: string) {
    const PriceFeed = await ethers.getContractFactory("PriceFeed");
    const feed = await PriceFeed.deploy(s.aggregator.target, assetId, 8, "BOT / USDT");
    await feed.waitForDeployment();
    return feed;
  }

  describe("published round records", () => {
    it("stores the published round and returns it via getRoundData", async () => {
      const s = await loadFixture(fixture);
      await submitAs(s, BOT_ASSET_ID, rialto, s.operator);
      await submitAs(s, BOT_ASSET_ID, rialto + 1_000_000n, s.alice);
      await submitAs(s, BOT_ASSET_ID, rialto - 1_000_000n, s.bob);
      await roundTrip();
      await s.aggregator.closeRound(BOT_ASSET_ID);

      const record = await s.aggregator.getRoundData(BOT_ASSET_ID, 1);
      expect(record.published).to.equal(true);
      expect(record.answer).to.equal(rialto);
      expect(record.updatedAt).to.be.gt(0);
      expect(record.inThreshold).to.equal(3);
      expect(record.vetoed).to.equal(0);
    });

    it("does not record a round that failed quorum", async () => {
      const s = await loadFixture(fixture);
      await submitAs(s, BOT_ASSET_ID, rialto, s.operator); // 1 < quorum(3)
      await roundTrip();
      await s.aggregator.closeRound(BOT_ASSET_ID);

      const record = await s.aggregator.getRoundData(BOT_ASSET_ID, 1);
      expect(record.published).to.equal(false);
      expect(record.answer).to.equal(0);
    });

    it("records each published round independently", async () => {
      const s = await loadFixture(fixture);
      for (const [i, price] of [rialto, rialto + 1_000_000n, rialto + 2_000_000n].entries()) {
        await submitAs(s, BOT_ASSET_ID, price, s.operator);
        await submitAs(s, BOT_ASSET_ID, price, s.alice);
        await submitAs(s, BOT_ASSET_ID, price, s.bob);
        await roundTrip();
        await s.aggregator.closeRound(BOT_ASSET_ID);
        expect((await s.aggregator.getRoundData(BOT_ASSET_ID, i + 1)).answer).to.equal(price);
      }
    });
  });

  describe("PriceFeed history", () => {
    it("returns real getRoundData history and reverts on missing rounds", async () => {
      const s = await loadFixture(fixture);
      const feed = await deployFeed(s, BOT_ASSET_ID);

      await submitAs(s, BOT_ASSET_ID, rialto, s.operator);
      await submitAs(s, BOT_ASSET_ID, rialto, s.alice);
      await submitAs(s, BOT_ASSET_ID, rialto, s.bob);
      await roundTrip();
      await s.aggregator.closeRound(BOT_ASSET_ID);

      expect(await feed.latestRound()).to.equal(1);
      const [roundId, answer] = await feed.getRoundData(1);
      expect(roundId).to.equal(1);
      expect(answer).to.equal(rialto);
      await expect(feed.getRoundData(2)).to.be.revertedWith("PF: no data for round");
    });
  });

  describe("permissionless keeper", () => {
    it("closes every due feed in one call and skips unstarted/unknown assets", async () => {
      const s = await loadFixture(fixture);
      await submitAs(s, BOT_ASSET_ID, rialto, s.operator);
      await submitAs(s, BOT_ASSET_ID, rialto, s.alice);
      await submitAs(s, BOT_ASSET_ID, rialto, s.bob);
      await submitAs(s, WBOT_ASSET_ID, rialto, s.operator); // starts WBOT round, below quorum

      await roundTrip();
      await expect(
        s.aggregator
          .connect(s.carol) // a random third party, no stake
          .closeRounds([BOT_ASSET_ID, WBOT_ASSET_ID, LODE_ASSET_ID]),
      )
        .to.emit(s.aggregator, "RoundsProcessed")
        .withArgs(3, 2);

      expect((await s.aggregator.getRoundData(BOT_ASSET_ID, 1)).published).to.equal(true);
      expect((await s.aggregator.getRoundData(WBOT_ASSET_ID, 1)).published).to.equal(false);
    });

    it("never closes a feed that is still inside its window", async () => {
      const s = await loadFixture(fixture);
      await submitAs(s, BOT_ASSET_ID, rialto, s.operator);
      await expect(s.aggregator.closeRounds([BOT_ASSET_ID]))
        .to.emit(s.aggregator, "RoundsProcessed")
        .withArgs(1, 0);
    });

    it("skips paused feeds", async () => {
      const s = await loadFixture(fixture);
      await s.aggregator.connect(s.timelockSigner).pauseFeed(BOT_ASSET_ID);
      await submitAs(s, WBOT_ASSET_ID, rialto, s.operator);
      await roundTrip();
      await expect(s.aggregator.closeRounds([BOT_ASSET_ID, WBOT_ASSET_ID]))
        .to.emit(s.aggregator, "RoundsProcessed")
        .withArgs(2, 1);
    });
  });

  describe("asset lifecycle", () => {
    it("deactivating blocks submissions but preserves history; activating restores", async () => {
      const s = await loadFixture(fixture);
      await submitAs(s, BOT_ASSET_ID, rialto, s.operator);
      await submitAs(s, BOT_ASSET_ID, rialto, s.alice);
      await submitAs(s, BOT_ASSET_ID, rialto, s.bob);
      await roundTrip();
      await s.aggregator.closeRound(BOT_ASSET_ID);

      await s.aggregator.connect(s.timelockSigner).deactivateAsset(BOT_ASSET_ID);
      expect(await s.aggregator.isAssetActive(BOT_ASSET_ID)).to.equal(false);
      expect((await s.aggregator.getRoundData(BOT_ASSET_ID, 1)).published).to.equal(true);

      await roundTrip();
      await expect(submitAs(s, BOT_ASSET_ID, rialto, s.operator)).to.be.revertedWith(
        "OA: asset deactivated",
      );

      await s.aggregator.connect(s.timelockSigner).activateAsset(BOT_ASSET_ID);
      expect(await s.aggregator.isAssetActive(BOT_ASSET_ID)).to.equal(true);
      await expect(submitAs(s, BOT_ASSET_ID, rialto, s.operator)).to.not.be.reverted;
    });

    it("only the owner can deactivate/reactivate", async () => {
      const s = await loadFixture(fixture);
      await expect(s.aggregator.connect(s.alice).deactivateAsset(BOT_ASSET_ID)).to.be.reverted;
      await s.aggregator.connect(s.timelockSigner).deactivateAsset(BOT_ASSET_ID);
      await expect(s.aggregator.connect(s.alice).activateAsset(BOT_ASSET_ID)).to.be.reverted;
      await expect(
        s.aggregator.connect(s.timelockSigner).deactivateAsset(BOT_ASSET_ID),
      ).to.be.revertedWith("OA: already deactivated");
    });

    it("unknown asset cannot be deactivated", async () => {
      const s = await loadFixture(fixture);
      await expect(
        s.aggregator.connect(s.timelockSigner).deactivateAsset(LODE_ASSET_ID),
      ).to.be.revertedWith("OA: unknown asset");
    });
  });
});

// silence unused import warnings for helpers used indirectly in fixtures
void submitAsAt;
void nowTs;
