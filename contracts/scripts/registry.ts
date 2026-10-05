import { ethers } from "hardhat";
import fs from "fs";
import path from "path";

/**
 * Registry audit.
 *
 * `scripts/deploy.ts` writes `config/addresses/<network>.json` after every
 * deploy. This script is the other half: it reads those files back and checks
 * that each recorded address actually has bytecode on the chain it claims to
 * be on, so a typo'd or stale registry entry is caught here rather than by a
 * consumer contract reading garbage.
 *
 * Run:  npx hardhat run scripts/registry.ts --network botTestnet
 * Exit: 0 = every registered address verified, 1 = at least one problem.
 */

interface Registry {
  chainId: string;
  network: string;
  deployedAt: string;
  lodestarToken: string | null;
  stakingVault: string | null;
  oracleAggregator: string | null;
  timelock: string | null;
  priceFeeds: Record<string, string> | null;
}

const REGISTRY_DIR = path.join(__dirname, "..", "config", "addresses");

const CORE_KEYS = ["lodestarToken", "stakingVault", "oracleAggregator", "timelock"] as const;

function isAddress(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function loadRegistries(): Registry[] {
  if (!fs.existsSync(REGISTRY_DIR)) return [];
  return fs
    .readdirSync(REGISTRY_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(REGISTRY_DIR, f), "utf8")) as Registry);
}

async function verifyRegistry(reg: Registry, liveChainId: bigint): Promise<string[]> {
  const problems: string[] = [];

  if (BigInt(reg.chainId) !== liveChainId) {
    return [`${reg.network}: registered on chain ${reg.chainId}, not verifying against connected chain ${liveChainId}`];
  }

  const missing = CORE_KEYS.filter((k) => !isAddress(reg[k]));
  if (missing.length > 0) {
    problems.push(`${reg.network}: unset core entries — ${missing.join(", ")}`);
  }

  const entries: Array<[string, string]> = [];
  for (const key of CORE_KEYS) {
    if (isAddress(reg[key])) entries.push([key, reg[key]]);
  }
  if (reg.priceFeeds) {
    for (const [symbol, addr] of Object.entries(reg.priceFeeds)) {
      if (isAddress(addr)) entries.push([`priceFeed:${symbol}`, addr]);
      else problems.push(`${reg.network}: priceFeed:${symbol} is not a valid address (${addr})`);
    }
  }

  for (const [label, address] of entries) {
    let code: string;
    try {
      code = await ethers.provider.getCode(address);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      problems.push(`${reg.network}: ${label} @ ${address} — RPC unreachable (${msg})`);
      continue;
    }
    if (code === "0x") {
      problems.push(`${reg.network}: ${label} @ ${address} — no bytecode on chain ${reg.chainId}`);
    } else {
      console.log(`  ok   ${label.padEnd(24)} ${address}`);
    }
  }

  return problems;
}

async function registry(): Promise<number> {
  const registries = loadRegistries();
  if (registries.length === 0) {
    console.log(`No registries found in ${REGISTRY_DIR} — deploy first.`);
    return 0;
  }

  const net = await ethers.provider.getNetwork();
  console.log(`\n=== Lodestar contract registry (connected to chain ${net.chainId}) ===\n`);

  const problems: string[] = [];
  for (const reg of registries) {
    console.log(`${reg.network} (chain ${reg.chainId}, deployed ${reg.deployedAt || "unknown"})`);
    const found = await verifyRegistry(reg, net.chainId);
    if (found.length === 0) console.log("  all addresses carry bytecode");
    problems.push(...found);
  }

  if (problems.length > 0) {
    console.log("\nProblems:");
    for (const p of problems) console.log(`  ! ${p}`);
    return 1;
  }

  console.log("\nAll registered addresses verified.");
  return 0;
}

// Self-execute when invoked directly: `npx hardhat run scripts/registry.ts`
const isDirect = typeof process !== "undefined" && process.argv.slice(1).some((s) => s.includes("registry.ts"));
if (isDirect) {
  registry()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err?.message ?? err);
      process.exit(1);
    });
}

export { registry };