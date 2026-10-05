import { readFileSync, existsSync } from "node:fs";
import * as path from "node:path";
import dotenv from "dotenv";
import { keccak256, toBytes } from "viem";
import type { BotOracleConfig, FeedConfig } from "./types";

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing ${name} in environment`);
  }
  return value.trim();
}

function here(...parts: string[]): string {
  return path.join(process.cwd(), ...parts);
}

/**
 * Load `config/feeds.json` (or a path given via CONFIG_PATH), merge in the
 * chain + operator settings from the environment.
 *
 * The on-chain assetId is always derived as `keccak256(symbol)` so the
 * symbol in this file stays the single source of truth.
 */
export function loadConfig(): BotOracleConfig {
  const feedPath = process.env.CONFIG_PATH ? here(process.env.CONFIG_PATH) : here("config", "feeds.json");
  if (!existsSync(feedPath)) {
    throw new Error(`Feed config not found at ${feedPath}`);
  }
  const raw: Array<Omit<FeedConfig, "assetId"> & { assetId?: string }> = JSON.parse(readFileSync(feedPath, "utf8"));

  const feeds: FeedConfig[] = raw.map((f) => {
    const derived = keccak256(toBytes(f.symbol)) as `0x${string}`;
    return { ...f, assetId: f.assetId ?? derived };
  });

  const chain = {
    rpcUrl: requireEnv("RPC_URL"),
    chainId: Number(process.env.CHAIN_ID ?? "968"),
    aggregator: requireEnv("AGGREGATOR_ADDRESS").toLowerCase() as `0x${string}`,
    scannerUrl: process.env.SCANNER_URL ?? "https://scan.bohr.life",
  };

  const operator = {
    privateKey: requireEnv("OPERATOR_KEY"),
    maxLocalDeviationPct: Number(process.env.MAX_LOCAL_DEVIATION_PCT ?? "5"),
    jitterSeconds: Number(process.env.JITTER_SECONDS ?? "4"),
  };

  if (!/^0x[a-fA-F0-9]{64}$/.test(operator.privateKey)) {
    throw new Error("OPERATOR_KEY must be a 0x-prefixed 64-hex private key");
  }

  return { chain, operator, feeds };
}