import { createServer, type Server } from "node:http";
import type { FeedRuntimeState } from "./types";
import type { Metrics } from "./metrics";
import type { Logger } from "./logger";

export interface HealthContext {
  chainId: number;
  rpcUrl: string;
  aggregator: string;
  operator: string | null;
}

export interface HealthSnapshot {
  status: "ok" | "degraded" | "error";
  ready: boolean;
  startedAt: string;
  uptimeSeconds: number;
  chain: HealthContext;
  feeds: FeedRuntimeState[];
}

/**
 * In-memory registry the scheduler writes to and the HTTP health endpoint
 * reads from. Kept deliberately dumb: no locking, no persistence — a restart
 * resets it, which is correct for liveness/readiness.
 */
export class HealthRegistry {
  private feeds = new Map<string, FeedRuntimeState>();
  readonly startedAt = new Date();
  private readyFlag = false;

  constructor(private chain: HealthContext) {}

  upsert(feed: Pick<FeedRuntimeState, "symbol" | "assetId">): FeedRuntimeState {
    let state = this.feeds.get(feed.assetId);
    if (!state) {
      state = { symbol: feed.symbol, assetId: feed.assetId, submissions: 0, consecutiveErrors: 0 };
      this.feeds.set(feed.assetId, state);
    }
    return state;
  }

  markReady(ready = true): void {
    this.readyFlag = ready;
  }

  get ready(): boolean {
    return this.readyFlag;
  }

  snapshot(): HealthSnapshot {
    const feeds = [...this.feeds.values()];
    const erroring = feeds.filter((f) => f.consecutiveErrors > 0).length;
    const status: HealthSnapshot["status"] = !this.readyFlag || erroring > 0 ? "degraded" : "ok";
    return {
      status,
      ready: this.readyFlag,
      startedAt: this.startedAt.toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startedAt.getTime()) / 1000),
      chain: this.chain,
      feeds,
    };
  }
}

export interface HealthServer {
  server: Server;
  close: () => Promise<void>;
}

export function startHealthServer(opts: {
  registry: HealthRegistry;
  metrics?: Metrics;
  logger: Logger;
  port: number;
  host?: string;
}): HealthServer {
  const { registry, metrics, logger } = opts;
  const host = opts.host ?? "0.0.0.0";

  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    const path = url.split("?")[0];

    if (req.method !== "GET") {
      respond(res, 405, "text/plain", "method not allowed\n");
      return;
    }

    switch (path) {
      case "/healthz":
        respond(res, 200, "text/plain", "ok\n");
        return;
      case "/readyz":
        if (registry.ready) respond(res, 200, "text/plain", "ready\n");
        else respond(res, 503, "text/plain", "not ready\n");
        return;
      case "/status":
        respond(res, 200, "application/json", JSON.stringify(registry.snapshot(), null, 2) + "\n");
        return;
      case "/metrics":
        if (!metrics) {
          respond(res, 404, "text/plain", "metrics disabled\n");
          return;
        }
        respond(res, 200, "text/plain; version=0.0.4", metrics.render());
        return;
      default:
        respond(res, 404, "text/plain", "not found\n");
    }
  });

  server.on("error", (err) => logger.error("health server error", { error: (err as Error).message }));

  server.listen(opts.port, host, () => {
    logger.info("health server listening", { host, port: opts.port, metrics: Boolean(metrics) });
  });

  return {
    server,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function respond(res: import("node:http").ServerResponse, status: number, contentType: string, body: string): void {
  res.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
  res.end(body);
}
