import { ethers, network } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { Signer } from "ethers";

export const BOT_ASSET_ID = ethers.id("BOT/USDT");
export const WBOT_ASSET_ID = ethers.id("WBOT/USDT");
export const LODE_ASSET_ID = ethers.id("LODE/USDT");

export const ROUND_INTERVAL = 120;
export const DEVIATION_BPS = 300;
export const BREAKER_BPS = 2000;
export const STALE_AFTER = 3600;
export const EMISSION_PER_ROUND = ethers.parseEther("10");
export const MIN_STAKE = ethers.parseEther("1000");
export const TOTAL_SUPPLY = ethers.parseEther("100000000");
export const WITHDRAWAL_DELAY = 7 * 24 * 3600;
/** Default quorum enforced by OracleAggregator. */
export const MIN_SUBMISSIONS = 3;
/** Consecutive missed rounds before a liveness slash. */
export const MISS_LIMIT = 3;

type AnyContract = any;

export interface OracleStack {
  token: AnyContract;
  vault: AnyContract;
  aggregator: AnyContract;
  timelock: AnyContract;
  timelockSigner: Signer;     // impersonated timelock (owner of vault + aggregator)
  treasury: Signer;
  owner: Signer;
  operator: Signer;
  alice: Signer;
  bob: Signer;
  carol: Signer;
}

export async function deployOracleStack(): Promise<OracleStack> {
  const [owner, treasury, operator, alice, bob, carol] = await ethers.getSigners();

  // --- LodestarToken ---
  const LodestarToken = await ethers.getContractFactory("LodestarToken");
  const token: AnyContract = await LodestarToken.deploy(await treasury.getAddress(), TOTAL_SUPPLY);
  await token.waitForDeployment();

  // --- StakingVault ---
  const StakingVault = await ethers.getContractFactory("StakingVault");
  const vault: AnyContract = await StakingVault.deploy(
    await owner.getAddress(),
    token.target,
    await treasury.getAddress(),
    MIN_STAKE,
  );
  await vault.waitForDeployment();

  // --- TimelockController ---
  const TimelockController = await ethers.getContractFactory("TimelockController");
  const timelock: AnyContract = await TimelockController.deploy(2 * 24 * 3600, 30 * 24 * 3600);
  await timelock.waitForDeployment();
  // fund timelock so it can send txs
  await ethers.provider.send("hardhat_setBalance", [timelock.target, "0x56BC75E2D63100000"]);
  const timelockSigner = await ethers.getImpersonatedSigner(timelock.target);

  // --- OracleAggregator (owned by timelock) ---
  const OracleAggregator = await ethers.getContractFactory("OracleAggregator");
  const aggregator: AnyContract = await OracleAggregator.deploy(
    vault.target,
    timelock.target,
    ROUND_INTERVAL,
    DEVIATION_BPS,
    BREAKER_BPS,
    STALE_AFTER,
    EMISSION_PER_ROUND,
  );
  await aggregator.waitForDeployment();

  // wire vault: aggregator while we still own it, then transfer to timelock
  await vault.setAggregator(aggregator.target);
  await vault.transferOwnership(timelock.target);

  // give each operator 50k LODE
  const tokenT = token.connect(treasury);
  for (const acc of [operator, alice, bob, carol]) {
    await tokenT.transfer(await acc.getAddress(), ethers.parseEther("50000"));
  }

  // fund vault reward pool (from treasury)
  await tokenT.approve(vault.target, ethers.parseEther("100000"));
  await vault.connect(treasury).fundRewards(ethers.parseEther("100000"));

  return {
    token, vault, aggregator, timelock, timelockSigner,
    treasury, owner, operator, alice, bob, carol,
  };
}

export async function increaseTimeAndMine(seconds: number) {
  await network.provider.send("evm_increaseTime", [seconds]);
  await network.provider.send("evm_mine", []);
}

export async function roundTrip() {
  await increaseTimeAndMine(ROUND_INTERVAL + 1);
}

/** Current chain timestamp in unix seconds — the value a node submits as
 *  `sourceTimestamp` when its price sources are fresh. */
export async function nowTs(): Promise<number> {
  const block = await ethers.provider.getBlock("latest");
  return Number(block!.timestamp);
}

/** A source timestamp old enough to be rejected by `maxSourceAgeSeconds`. */
export async function staleTs(): Promise<number> {
  return (await nowTs()) - STALE_AFTER - 60;
}

export async function submitAs(
  s: OracleStack,
  assetId: string,
  price: bigint,
  signer: Signer,
) {
  return s.aggregator.connect(signer).submitPrice(assetId, price, await nowTs());
}

/** Submit with an explicit source timestamp (for timestamp-validation tests). */
export async function submitAsAt(
  s: OracleStack,
  assetId: string,
  price: bigint,
  signer: Signer,
  sourceTimestamp: number,
) {
  return s.aggregator.connect(signer).submitPrice(assetId, price, sourceTimestamp);
}