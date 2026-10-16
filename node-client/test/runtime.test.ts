import { describe, it, expect, vi, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import { createLogger } from "../src/logger";
import { Metrics } from "../src/metrics";
import { HealthRegistry, startHealthServer } from "../src/health";
import { buildTransport } from "../src/rpc";
import { parseRpcList, resolveRuntime } from "../src/config";
import { runFeedLoop, type SchedulerOptions } from "../src/scheduler";
import type { BotOracleConfig, FeedConfig, PriceObservation } from "../src/types";

describe("logger", () => {
  it("emits JSON records with base and per-call fields", () => {
    const lines: string[] = [];
    const logger = createLogger(
      { level: "debug", format: "json", stdout: (l) => lines.push(l), stderr: (l) => lines.push(l), now: () => new Date("2024-01-01T00:00:00.000Z") },
      { feed: "BOT/USDT" },
    );
    logger.child({ node: "op-1" }).info("hit", { median: 1.5 });

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]);
    expect(record).toMatchObject({ level: "info", msg: "hit", feed: "BOT/USDT", node: "op-1", median: 1.5 });
    expect(record.time).toBe("2024-01-01T00:00:00.000Z");
  });

  it("drops records below the configured level", () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "warn", format: "pretty", stdout: (l) => lines.push(l), stderr: (l) => lines.push(l) });
    logger.debug("nope");
    logger.info("nope");
    logger.warn("yep");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("yep");
  });

  it("writes warn/error to stderr", () => {
    const out: string[] = [];
    const err: string[] = [];
    const logger = createLogger({ level: "debug", format: "json", stdout: (l) => out.push(l), stderr: (l) => err.push(l) });
    logger.info("a");
    logger.error("b");
    expect(out).toHaveLength(1);
    expect(err).toHaveLength(1);
  });
});

describe("metrics", () => {
  it("counts, gauges and renders the Prometheus text format", () => {
    const m = new Metrics();
    m.counter("submissions_total", "submitted", { feed: "BOT/USDT" });
    m.counter("submissions_total", "submitted", { feed: "BOT/USDT" });
    m.gauge("last_price_usd", "price", { feed: "BOT/USDT" }, 0.83);

    expect(m.value("submissions_total", { feed: "BOT/USDT" })).toBe(2);
    const text = m.render();
    expect(text).toContain("# TYPE submissions_total counter");
    expect(text).toContain('submissions_total{feed="BOT/USDT"} 2');
    expect(text).toContain("# TYPE last_price_usd gauge");
    expect(text).toContain('last_price_usd{feed="BOT/USDT"} 0.83');
  });

  it("escapes label values", () => {
    const m = new Metrics();
    m.counter("x", "h", { note: 'a"b' });
    expect(m.render()).toContain('x{note="a\\"b"} 1');
  });
});

describe("health registry", () => {
  it("is degraded until marked ready, then ok", () => {
    const reg = new HealthRegistry({ chainId: 968, rpcUrl: "http://x", aggregator: "0xagg", operator: "0xop" });
    reg.upsert({ symbol: "BOT/USDT", assetId: "0x1" });
    expect(reg.snapshot().status).toBe("degraded");
    reg.markReady(true);
    const snap = reg.snapshot();
    expect(snap.status).toBe("ok");
    expect(snap.ready).toBe(true);
    expect(snap.feeds).toHaveLength(1);
  });
});

describe("health server", () => {
  const servers: Array<{ close: () => Promise<void> }> = [];
  afterEach(async () => {
    while (servers.length) await servers.pop()!.close();
  });

  async function boot(metrics?: Metrics) {
    const reg = new HealthRegistry({ chainId: 968, rpcUrl: "http://x", aggregator: "0xagg", operator: "0xop" });
    reg.upsert({ symbol: "BOT/USDT", assetId: "0x1" });
    const srv = startHealthServer({ registry: reg, metrics, logger: createLogger({ level: "error" }), port: 0, host: "127.0.0.1" });
    servers.push(srv);
    await new Promise<void>((resolve) => srv.server.once("listening", () => resolve()));
    const { port } = srv.server.address() as AddressInfo;
    return { reg, base: `http://127.0.0.1:${port}` };
  }

  it("serves liveness and readiness transitions", async () => {
    const { reg, base } = await boot();
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await fetch(`${base}/readyz`)).status).toBe(503);
    reg.markReady(true);
    expect((await fetch(`${base}/readyz`)).status).toBe(200);
    expect((await fetch(`${base}/unknown`)).status).toBe(404);
  });

  it("exposes metrics and status JSON", async () => {
    const m = new Metrics();
    m.counter("submissions_total", "submitted", {}, 3);
    const { base } = await boot(m);
    const metricsBody = await (await fetch(`${base}/metrics`)).text();
    expect(metricsBody).toContain("submissions_total 3");
    const status = await (await fetch(`${base}/status`)).json();
    expect(status.chain.chainId).toBe(968);
    expect(status.feeds[0].symbol).toBe("BOT/USDT");
  });
});

describe("rpc transport", () => {
  it("throws without urls", () => {
    expect(() => buildTransport("")).toThrow(/at least one RPC URL/);
  });
  it("returns a transport for one or many urls", () => {
    expect(typeof buildTransport("https://a")).toBe("function");
    expect(typeof buildTransport("https://a", ["https://b", "https://b"])).toBe("function");
  });
});

describe("config parsing", () => {
  it("splits an RPC list into primary + fallbacks", () => {
    expect(parseRpcList("https://a, https://b ,https://c")).toEqual({
      rpcUrl: "https://a",
      fallbackRpcUrls: ["https://b", "https://c"],
    });
    expect(parseRpcList("https://only")).toEqual({ rpcUrl: "https://only", fallbackRpcUrls: [] });
    expect(() => parseRpcList(" , ")).toThrow(/empty/);
  });

  it("resolves runtime defaults and validates overrides", () => {
    const rt = resolveRuntime({} as NodeJS.ProcessEnv);
    expect(rt).toMatchObject({ logLevel: "info", logFormat: "pretty", healthEnabled: true, healthPort: 9464 });
    const custom = resolveRuntime({
      LOG_LEVEL: "debug",
      LOG_FORMAT: "json",
      HEALTH_DISABLED: "true",
      HEALTH_PORT: "8080",
      RETRY_BACKOFF_FRACTION: "0.25",
    } as NodeJS.ProcessEnv);
    expect(custom).toMatchObject({ logLevel: "debug", logFormat: "json", healthEnabled: false, healthPort: 8080, retryBackoffFraction: 0.25 });
    expect(() => resolveRuntime({ LOG_LEVEL: "loud" } as NodeJS.ProcessEnv)).toThrow(/LOG_LEVEL/);
    expect(() => resolveRuntime({ RETRY_BACKOFF_FRACTION: "2" } as NodeJS.ProcessEnv)).toThrow(/RETRY_BACKOFF/);
  });
});

describe("runFeedLoop round alignment", () => {
  const AID = "0x" + "22".repeat(32);
  const feed: FeedConfig = {
    assetId: AID,
    symbol: "BOT/USDT",
    feedDecimals: 8,
    sources: [{ name: "binance", params: { symbol: "BOTUSDT" } }],
  };
  const obs = (price: number): PriceObservation => ({ source: "binance", assetId: AID, priceUsd: price, sourceTimestamp: Date.now(), fetchedAt: Date.now() });

  function config(): BotOracleConfig {
    return {
      chain: { rpcUrl: "http://x", chainId: 968, aggregator: "0x" + "ab".repeat(20), scannerUrl: "" },
      operator: { privateKey: "0x" + "12".repeat(32), maxLocalDeviationPct: 2, jitterSeconds: 0 },
      feeds: [feed],
      runtime: { logLevel: "error", logFormat: "json", healthEnabled: false, healthPort: 9464, retryBackoffFraction: 0.5 },
    };
  }

  function fakeSubmitter() {
    const submit = vi.fn(async () => ({ hash: "0xhash" as `0x${string}` }));
    const getFeedHealth = vi.fn(async () => {
      const now = Math.floor(Date.now() / 1000);
      return {
        isPaused: false,
        isStale: false,
        hasPrice: true,
        lastUpdate: BigInt(now),
        lastRoundSubmissions: 1n,
        lastRoundVetoed: 0n,
        roundStart: BigInt(now - 30),
        nextRoundAt: BigInt(now + 30),
        currentRound: 1n,
        openRoundSubmissions: 1n,
      };
    });
    const submitter = {
      submit,
      getLatestPrice: vi.fn(),
      getFeedHealth,
      getRoundInterval: vi.fn(async () => 120n),
      address: () => "0xaddr" as `0x${string}`,
    };
    return { submit, submitter: submitter as unknown as SchedulerOptions["submitter"] };
  }

  afterEach(() => vi.useRealTimers());

  it("submits once per on-chain round and stops cleanly", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    const { submit, submitter } = fakeSubmitter();

    const cleaner = runFeedLoop(
      {
        config: config(),
        submitter,
        logger: createLogger({ level: "error" }),
        intervalMs: 120_000,
        fetchObservations: async () => [obs(0.83), obs(0.84), obs(0.85)],
      },
      feed,
      () => {},
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(submit).toHaveBeenCalledTimes(1);

    // next round opens in ~30s, so the second submit lands at the boundary
    await vi.advanceTimersByTimeAsync(30_001);
    expect(submit).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(30_001);
    expect(submit).toHaveBeenCalledTimes(3);

    cleaner();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(submit).toHaveBeenCalledTimes(3);
  });

  it("backs off and retries within the round after a failed fetch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    const { submit, submitter } = fakeSubmitter();
    let calls = 0;

    const cleaner = runFeedLoop(
      {
        config: config(),
        submitter,
        logger: createLogger({ level: "error" }),
        intervalMs: 120_000,
        fetchObservations: async () => {
          calls += 1;
          if (calls === 1) throw new Error("source down");
          return [obs(1)];
        },
      },
      feed,
      () => {},
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(submit).not.toHaveBeenCalled();

    // retry backoff = 0.5 * ~30s remaining ≈ 15s
    await vi.advanceTimersByTimeAsync(15_001);
    expect(submit).toHaveBeenCalledTimes(1);
    cleaner();
  });

  it("skips feeds with no configured sources without erroring or submitting", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    const { submit, submitter } = fakeSubmitter();
    const fetchObservations = vi.fn(async () => [obs(1)]);
    const lines: string[] = [];

    const cleaner = runFeedLoop(
      {
        config: config(),
        submitter,
        logger: createLogger({
          level: "warn",
          format: "json",
          stdout: (l) => lines.push(l),
          stderr: (l) => lines.push(l),
        }),
        intervalMs: 120_000,
        fetchObservations,
      },
      { ...feed, sources: [] },
      () => {},
    );

    await vi.advanceTimersByTimeAsync(600_000);
    expect(fetchObservations).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("no configured sources");
    expect(typeof cleaner).toBe("function");
    cleaner();
  });
});
