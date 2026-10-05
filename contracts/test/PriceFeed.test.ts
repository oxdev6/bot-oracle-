import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";
import {
  deployOracleStack,
  BOT_ASSET_ID,
  MIN_STAKE,
  roundTrip,
  nowTs,
} from "./fixtures";

describe("PriceFeed (Chainlink compatibility)", () => {
  const rialto = 100_000_000n; // 100.00

  const fixture = async () => {
    const s = await deployOracleStack();

    // register asset & stake 3 operators
    await s.aggregator.connect(s.timelockSigner).registerAsset(BOT_ASSET_ID, 8, "BOT / USDT");
    for (const acc of [s.operator, s.alice, s.bob]) {
      await s.token.connect(acc).approve(s.vault.target, MIN_STAKE + 1n);
      await s.vault.connect(acc).stake(MIN_STAKE);
    }

    // deploy the Chainlink-compatible feed wrapper
    const PriceFeed = await ethers.getContractFactory("PriceFeed");
    const feed = await PriceFeed.deploy(
      s.aggregator.target,
      BOT_ASSET_ID,
      8,
      "BOT / USDT",
    );
    await feed.waitForDeployment();

    const ExampleConsumer = await ethers.getContractFactory("ExampleConsumer");
    const consumer = await ExampleConsumer.deploy(feed.target);
    await consumer.waitForDeployment();

    return { ...s, feed, consumer };
  };

  it("exposes Chainlink standard getters", async () => {
    const { feed } = await loadFixture(fixture);
    expect(await feed.decimals()).to.equal(8);
    expect(await feed.version()).to.equal(1);
    expect(await feed.description()).to.equal("BOT / USDT");
  });

  it("latestRoundData returns the aggregated median", async () => {
    const { feed, aggregator, operator, alice, bob } = await loadFixture(fixture);

    await aggregator.connect(operator).submitPrice(BOT_ASSET_ID, rialto, await nowTs());
    await aggregator.connect(alice).submitPrice(BOT_ASSET_ID, rialto, await nowTs());
    await aggregator.connect(bob).submitPrice(BOT_ASSET_ID, rialto, await nowTs());
    await roundTrip();
    await aggregator.closeRound(BOT_ASSET_ID);

    const data = await feed.latestRoundData();
    expect(data[1]).to.equal(rialto);          // answer
    expect(data[3]).to.be.greaterThan(0);      // updatedAt
    expect(data[0]).to.equal(1n);              // roundId
    expect(data[2]).to.equal(data[3]);         // startedAt == updatedAt (documented)
  });

  it("getRoundData mirrors latestRoundData (no-history wrapper)", async () => {
    const { feed, aggregator, operator, alice, bob } = await loadFixture(fixture);
    await aggregator.connect(operator).submitPrice(BOT_ASSET_ID, rialto, await nowTs());
    await aggregator.connect(alice).submitPrice(BOT_ASSET_ID, rialto, await nowTs());
    await aggregator.connect(bob).submitPrice(BOT_ASSET_ID, rialto, await nowTs());
    await roundTrip();
    await aggregator.closeRound(BOT_ASSET_ID);

    const latest = await feed.latestRoundData();
    const anyRound = await feed.getRoundData(latest[0]);
    expect(anyRound[1]).to.equal(latest[1]);
  });

  it("a Chainlink-style consumer reads the feed with zero code changes", async () => {
    const { consumer, aggregator, operator, alice, bob } = await loadFixture(fixture);

    await aggregator.connect(operator).submitPrice(BOT_ASSET_ID, rialto, await nowTs());
    await aggregator.connect(alice).submitPrice(BOT_ASSET_ID, rialto, await nowTs());
    await aggregator.connect(bob).submitPrice(BOT_ASSET_ID, rialto, await nowTs());
    await roundTrip();
    await aggregator.closeRound(BOT_ASSET_ID);

    const [price, decimals, roundId, updatedAt] = await consumer.getPrice();
    expect(price).to.equal(rialto);
    expect(decimals).to.equal(8);
    expect(roundId).to.equal(1n);
    expect(updatedAt).to.be.greaterThan(0);
  });

  it("exposes the Lodestar extras (asset id, pause, staleness)", async () => {
    const { feed, consumer } = await loadFixture(fixture);
    expect(await feed.getAssetId()).to.equal(BOT_ASSET_ID);
    expect(await feed.isPaused()).to.equal(false);
    expect(await feed.isStale()).to.equal(false);
    expect(await feed.staleness()).to.equal(0); // never updated yet

    // before any round closes the safe consumer refuses to answer
    await expect(consumer.getPriceOrRevert()).to.be.revertedWith("EC: no answer");
  });

  it("the safe consumer reverts while the feed is paused, and answers after resume", async () => {
    const { feed, consumer, aggregator, operator, alice, bob, timelockSigner } =
      await loadFixture(fixture);

    await aggregator.connect(operator).submitPrice(BOT_ASSET_ID, rialto, await nowTs());
    await aggregator.connect(alice).submitPrice(BOT_ASSET_ID, rialto, await nowTs());
    await aggregator.connect(bob).submitPrice(BOT_ASSET_ID, rialto, await nowTs());
    await roundTrip();
    await aggregator.closeRound(BOT_ASSET_ID);

    // rialto is 1e8 with 8 decimals == 1.00; getPrice18 rescales to 1e18
    expect(await consumer.getPrice18()).to.equal(ethers.parseEther("1"));

    await aggregator.connect(timelockSigner).pauseFeed(BOT_ASSET_ID);
    expect(await feed.isPaused()).to.equal(true);
    await expect(consumer.getPriceOrRevert()).to.be.revertedWith("EC: feed paused");

    await aggregator.connect(timelockSigner).resumeFeed(BOT_ASSET_ID);
    expect(await consumer.getPriceOrRevert()).to.not.be.reverted;
  });
});