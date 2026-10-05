import { ethers, run } from "hardhat";

const SUPPLY = "100000000000000000000000000";                 // 100M LODE
const MIN_STAKE = "1000000000000000000000";                   // 1000 LODE
const REWARD_FUNDING = "500000000000000000000000";            // 500k LODE rewards
const TIMELOCK_DELAY = 2 * 24 * 3600;                         // 48h

const ROOUND_INTERVAL = Number(process.env.ROUND_INTERVAL_SECONDS ?? 120); // seconds
const DEVIATION_BPS = Number(process.env.DEVIATION_BPS ?? 300);             // 3%
const BREAKER_BPS = Number(process.env.BREAKER_BPS ?? 2000);                // 20%
const STALE_AFTER = Number(process.env.STALE_AFTER ?? 3600);                // 1h
const EMISSION_PER_ROUND = ethers.parseEther(process.env.EMISSION_PER_ROUND ?? "10");

async function deploy(verify: boolean) {
  const TREASURY = process.env.TREASURY_ADDRESS ?? "";
  const [deployer] = await ethers.getSigners();
  const deployerAddr = await deployer.getAddress();
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const netName =
    chainId === 677n ? "botMainnet" : chainId === 968n ? "botTestnet" : `chain-${chainId}`;

  if (verify && chainId !== 968n && chainId !== 677n) {
    throw new Error("Verification only supported on botTestnet / botMainnet");
  }
  if (!TREASURY) throw new Error("Set TREASURY_ADDRESS (multisig). Never use an EOA.");

  console.log(`\n=== Lodestar Oracle deployment on ${netName} (chain ${chainId}) ===`);
  console.log(`Deployer: ${deployerAddr}`);
  console.log(`Treasury: ${TREASURY}\n`);

  const addrs: Record<string, any> = {};
  const a = (v: unknown) => v as string;

  // 1. LodestarToken — fixed supply minted to treasury
  const LodestarToken = await ethers.getContractFactory("LodestarToken");
  const token = await LodestarToken.deploy(TREASURY, SUPPLY);
  await token.waitForDeployment();
  addrs.lodestarToken = a(token.target);
  console.log(`LodestarToken    @ ${token.target}`);

  // 2. StakingVault (owned by deployer during bootstrap)
  const StakingVault = await ethers.getContractFactory("StakingVault");
  const vault = await StakingVault.deploy(deployerAddr, token.target, TREASURY, MIN_STAKE);
  await vault.waitForDeployment();
  addrs.stakingVault = a(vault.target);
  console.log(`StakingVault     @ ${vault.target}`);

  // 3. TimelockController
  const TimelockController = await ethers.getContractFactory("TimelockController");
  const timelock = await TimelockController.deploy(TIMELOCK_DELAY, 30 * 24 * 3600);
  await timelock.waitForDeployment();
  addrs.timelock = a(timelock.target);
  console.log(`Timelock         @ ${timelock.target} (delay ${TIMELOCK_DELAY}s)`);

  // 4. OracleAggregator
  const OracleAggregator = await ethers.getContractFactory("OracleAggregator");
  const aggregator = await OracleAggregator.deploy(
    vault.target,
    deployerAddr,
    ROOUND_INTERVAL,
    DEVIATION_BPS,
    BREAKER_BPS,
    STALE_AFTER,
    EMISSION_PER_ROUND.toString(),
  );
  await aggregator.waitForDeployment();
  addrs.oracleAggregator = a(aggregator.target);
  console.log(`OracleAggregator @ ${aggregator.target}`);

  // 5. Wire + register asset feeds
  await (await vault.setAggregator(aggregator.target)).wait();
  const assets = ["BOT/USDT", "WBOT/USDT", "LODE/USDT"];
  for (const assetId of assets) {
    await (await aggregator.registerAsset(ethers.id(assetId), 8, assetId)).wait();
    console.log(`  - feed    ${assetId} (8 decimals)`);
  }

  // 6. Seed the reward pool (only if deployer holds LODE during bootstrap)
  const bal = await token.balanceOf(deployerAddr);
  if (bal >= ethers.parseEther("500000")) {
    await (await token.approve(vault.target, REWARD_FUNDING)).wait();
    await (await vault.fundRewards(REWARD_FUNDING)).wait();
    console.log("  - reward pool funded with 500k LODE");
  } else {
    console.log("  ! deployer has no LODE — treasury must fund the reward pool manually");
  }

  // 7. Hand ownership of vault+aggregator to the timelock
  await (await vault.transferOwnership(timelock.target)).wait();
  await (await aggregator.transferOwnership(timelock.target)).wait();
  console.log("  - ownership of vault + aggregator moved to timelock");

  // 8. Deploy a Chainlink-compatible PriceFeed wrapper per asset
  const PriceFeed = await ethers.getContractFactory("PriceFeed");
  addrs.priceFeeds = {};
  for (const assetId of assets) {
    const feed = await PriceFeed.deploy(aggregator.target, ethers.id(assetId), 8, assetId);
    await feed.waitForDeployment();
    addrs.priceFeeds[assetId] = a(feed.target);
    console.log(`PriceFeed(${assetId}) @ ${feed.target}`);
  }

  // 9. Save the contract registry
  const fs = await import("fs");
  const path = await import("path");
  const registryPath = path.join(__dirname, "..", "config", "addresses", `${netName}.json`);
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(
    registryPath,
    JSON.stringify(
      {
        chainId: chainId.toString(),
        network: netName,
        deployedAt: new Date().toISOString(),
        ...addrs,
      },
      null,
      2,
    ),
  );
  console.log(`\nRegistry saved to ${registryPath}`);

  // 10. Optional verification
  if (verify) {
    console.log("\nVerifying contracts on the block explorer...");
    await run("verify:verify", { address: token.target, constructorArguments: [TREASURY, SUPPLY] }).catch((e) => console.log("  !", e.message?.slice(0, 140)));
    await run("verify:verify", { address: vault.target, constructorArguments: [deployerAddr, token.target, TREASURY, MIN_STAKE] }).catch((e) => console.log("  !", e.message?.slice(0, 140)));
    await run("verify:verify", { address: aggregator.target, constructorArguments: [vault.target, deployerAddr, ROOUND_INTERVAL, DEVIATION_BPS, BREAKER_BPS, STALE_AFTER, EMISSION_PER_ROUND.toString()] }).catch((e) => console.log("  !", e.message?.slice(0, 140)));
  }
}

// Self-execute when invoked directly: `npx hardhat run scripts/deploy.ts`
const isDirect = typeof process !== "undefined" && process.argv.slice(1).some((s) => s.includes("deploy.ts"));
if (isDirect) {
  const verify = process.argv.includes("--verify");
  deploy(verify)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err?.message ?? err);
      process.exit(1);
    });
}

export { deploy };