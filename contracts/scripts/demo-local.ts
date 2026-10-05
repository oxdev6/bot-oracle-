import { ethers } from "hardhat";
import fs from "fs";
import path from "path";
import { deploy } from "./deploy";

const TREASURY_IDX = 1;
const OPERATOR_IDX = [2, 3, 4];
const MIN_STAKE = ethers.parseEther("1000");
const GRANT = ethers.parseEther("5000");
const REWARD_SEED = ethers.parseEther("500000");
const ASSETS = ["BOT/USDT", "WBOT/USDT", "LODE/USDT"];
const ROUNDS = 3;
const DIST = [997n, 1000n, 1003n]; // per-operator jitter in bps

async function main() {
  const signers = await ethers.getSigners();
  const chainId = (await ethers.provider.getNetwork()).chainId;
  console.log(`Local chain ${chainId} — deploying suite...`);

  process.env.TREASURY_ADDRESS = signers[TREASURY_IDX].address;
  await deploy(false);

  const registry = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "config", "addresses", `chain-${chainId}.json`),
      "utf8",
    ),
  );
  const token: any = await ethers.getContractAt("LodestarToken", registry.lodestarToken);
  const vault: any = await ethers.getContractAt("StakingVault", registry.stakingVault);
  const agg: any = await ethers.getContractAt("OracleAggregator", registry.oracleAggregator);

  const treasury = signers[TREASURY_IDX];
  const operators = OPERATOR_IDX.map((i) => signers[i]);

  console.log("\nSeeding reward pool...");
  await (await token.connect(treasury).transfer(vault.target, REWARD_SEED)).wait();

  console.log("Funding + staking 3 operators...");
  for (const op of operators) {
    await (await token.connect(treasury).transfer(op.address, GRANT)).wait();
    await (await token.connect(op).approve(vault.target, MIN_STAKE)).wait();
    await (await vault.connect(op).stake(MIN_STAKE)).wait();
    console.log(`  staked ${op.address}`);
  }

  const interval = Number(await agg.roundInterval());
  const bases: Record<string, bigint> = {
    "BOT/USDT": 83000000n,   // 0.83000000
    "WBOT/USDT": 1240000n,   // 0.01240000
    "LODE/USDT": 24100000n,  // 0.24100000
  };

  const prices: Record<string, bigint> = {};
  for (const asset of ASSETS) prices[asset] = bases[asset];

  /**
   * Anchor the next block a few seconds ahead of the chain head. Always
   * recomputed from `latest` because each transaction moves the head forward.
   */
  const nextBlockTs = async (offset: number): Promise<number> => {
    const head = (await ethers.provider.getBlock("latest"))!.timestamp;
    const ts = head + offset;
    await ethers.provider.send("evm_setNextBlockTimestamp", [ts]);
    return ts;
  };

  /** Land the next block just ahead of the head and let the operators report. */
  const submitRound = async (asset: string) => {
    const assetId = ethers.id(asset);
    const ts = await nextBlockTs(5);
    for (let opIdx = 0; opIdx < operators.length; opIdx++) {
      const price = (prices[asset] * DIST[opIdx]) / 1000n; // ±0.3% honest jitter
      // a node reports the timestamp of the price it just read; the aggregator
      // rejects sources older than maxSourceAgeSeconds
      await (
        await agg.connect(operators[opIdx]).submitPrice(assetId, price, ts)
      ).wait();
    }
  };

  /** Move past the round boundary so closeRound is allowed for this round. */
  const advancePastRound = async () => {
    await nextBlockTs(interval + 8);
  };

  console.log(`\nRunning ${ROUNDS} rounds (interval ${interval}s — simulated)...`);
  for (let round = 0; round < ROUNDS; round++) {
    for (const asset of ASSETS) {
      await submitRound(asset);
      prices[asset] += 10000n; // small honest drift per round
    }

    await advancePastRound();
    for (const asset of ASSETS) {
      await (await agg.closeRound(ethers.id(asset))).wait();
    }

    const answers: string[] = [];
    for (const asset of ASSETS) {
      const { price, decimals } = await agg.getLatestPrice(ethers.id(asset));
      answers.push(`${asset} ${ethers.formatUnits(price, decimals)}`);
    }
    console.log(
      `  round ${round + 1}/${ROUNDS} closed @ ts ${(await ethers.provider.getBlock("latest"))!.timestamp}  ${answers.join("  ")}`,
    );
  }

  console.log(`\nDone. Registry: contracts/config/addresses/chain-${chainId}.json`);

  const dashEnv = [
    "NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545",
    `NEXT_PUBLIC_CHAIN_ID=${chainId}`,
    "NEXT_PUBLIC_SCANNER_URL=http://127.0.0.1:3000",
    `NEXT_PUBLIC_TOKEN_ADDRESS=${registry.lodestarToken}`,
    `NEXT_PUBLIC_VAULT_ADDRESS=${registry.stakingVault}`,
    `NEXT_PUBLIC_AGGREGATOR_ADDRESS=${registry.oracleAggregator}`,
  ].join("\n") + "\n";
  const dashEnvPath = path.join(__dirname, "..", "..", "dashboard", ".env.local");
  fs.writeFileSync(dashEnvPath, dashEnv);
  console.log(`Dashboard env written to ${dashEnvPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e?.message ?? e);
    process.exit(1);
  });

export {};