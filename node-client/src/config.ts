import { readFileSync, existsSync } from "node:fs";
import * as path from "node:path";
import dotenv from "dotenv";
import { keccak256, toBytes } from "viem";
import type { BotOracleConfig, FeedConfig, LogLevel, RuntimeConfig } from "./types";

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

const LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

/** Split a comma-separated RPC list into a primary URL + fallbacks. */
export function parseRpcList(value: string): { rpcUrl: string; fallbackRpcUrls: string[] } {
  const urls = value
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  if (urls.length === 0) throw new Error("RPC_URL is empty");
  const [rpcUrl, ...fallbackRpcUrls] = urls;
  return { rpcUrl, fallbackRpcUrls };
}

export function resolveRuntime(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const level = (env.LOG_LEVEL ?? "info").toLowerCase() as LogLevel;
  if (!LOG_LEVELS.includes(level)) throw new Error(`LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}`);
  const format = (env.LOG_FORMAT ?? "pretty").toLowerCase();
  if (format !== "json" && format !== "pretty") throw new Error("LOG_FORMAT must be 'json' or 'pretty'");
  const port = Number(env.HEALTH_PORT ?? "9464");
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("HEALTH_PORT must be a valid TCP port");
  const backoff = Number(env.RETRY_BACKOFF_FRACTION ?? "0.5");
  if (!Number.isFinite(backoff) || backoff < 0 || backoff > 1) {
    throw new Error("RETRY_BACKOFF_FRACTION must be between 0 and 1");
  }
  return {
    logLevel: level,
    logFormat: format as "json" | "pretty",
    healthEnabled: env.HEALTH_DISABLED !== "true" && env.HEALTH_DISABLED !== "1",
    healthPort: port,
    retryBackoffFraction: backoff,
  };
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

  const { rpcUrl, fallbackRpcUrls } = parseRpcList(requireEnv("RPC_URL"));
  const chain = {
    rpcUrl,
    fallbackRpcUrls,
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

  return { chain, operator, feeds, runtime: resolveRuntime() };
}