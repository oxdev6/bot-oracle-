# Lodestar Oracle Node Client

Reference node implementation for Lodestar operators. The node samples
independent price sources, computes a local median, rejects any source that
deviates from the median by more than `MAX_LOCAL_DEVIATION_PCT` (default 5%),
scales the price to the feed's `feedDecimals`, and submits it to the on-chain
`OracleAggregator` using your operator stake.

The scheduler runs one round loop per configured feed. After each successful
submission it reads `getFeedHealth` and sleeps until the **next on-chain round
opens**, so reports always land in a fresh round instead of drifting against
the aggregator. A small `JITTER_SECONDS` offset keeps operators from converging
on the same instant. Failed rounds back off by `RETRY_BACKOFF_FRACTION` of the
remaining window and retry inside the same round.

Each submission is dry-run with `simulateContract` first, so predictable
reverts (not eligible, already submitted, outlier, paused feed) surface as a
logged error rather than a wasted reverted transaction. RPC calls go through
viem's `fallback` transport when more than one `RPC_URL` is provided.

## Architecture

```
src/
  index.ts         entrypoint: config -> logging -> health -> one loop per feed
  config.ts        env + feeds.json loader; derives assetId = keccak256(symbol)
  fetchers.ts      source adapters: binance, coingecko, bdex (DEX pool)
  aggregator.ts    local aggregation: median + outlier rejection
  submitter.ts     viem client + minimal OracleAggregator ABI (+ preflight sim)
  rpc.ts           HTTP / fallback transport builder for multi-RPC setups
  scheduler.ts     round-boundary-aligned loop with per-round error isolation
  logger.ts        structured JSON / pretty logger with level filtering
  metrics.ts       dependency-free Prometheus counter/gauge registry
  health.ts        /healthz, /readyz, /metrics and /status HTTP server
  utils.ts         scaling, median, deviation helpers
  types.ts         shared interfaces
config/
  feeds.json       the feeds this operator watches
test/              vitest unit tests
```

## Quick start

```bash
npm install          # (use npm ci in prod; the Dockerfile does this itself)
cp .env.example .env # fill RPC_URL, CHAIN_ID, AGGREGATOR_ADDRESS, OPERATOR_KEY

npm test             # run unit tests
npm run typecheck    # static check
npm run node         # start the operator (tsx)
```

## Environment

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `RPC_URL` | yes | — | BOT Chain RPC; comma-separate for automatic failover (testnet `https://rpc.bohr.life`) |
| `CHAIN_ID` | no | `968` | 968 testnet / 677 mainnet |
| `AGGREGATOR_ADDRESS` | yes | — | deployed `OracleAggregator` address |
| `OPERATOR_KEY` | yes | — | operator private key (0x + 64 hex) |
| `MAX_LOCAL_DEVIATION_PCT` | no | `5` | reject own sources deviating > this % from own median |
| `JITTER_SECONDS` | no | `4` | per-tick scheduling jitter (s) |
| `CONFIG_PATH` | no | `config/feeds.json` | alternate feed list |
| `LOG_LEVEL` | no | `info` | `debug` / `info` / `warn` / `error` |
| `LOG_FORMAT` | no | `pretty` | `pretty` (human) or `json` (log shippers) |
| `HEALTH_PORT` | no | `9464` | port for the health/metrics server |
| `HEALTH_DISABLED` | no | `false` | set `true` to disable the health server |
| `RETRY_BACKOFF_FRACTION` | no | `0.5` | fraction of the remaining round to wait before retrying a failed round |

## Health & metrics

Unless `HEALTH_DISABLED=true`, the node serves:

| Route | Purpose |
|---|---|
| `GET /healthz` | liveness — always `200` while the process runs |
| `GET /readyz` | readiness — `200` once loops start, `503` before |
| `GET /metrics` | Prometheus text exposition |
| `GET /status` | JSON snapshot: uptime, chain, per-feed submissions/errors/price |

Key series: `lodestar_node_submissions_total{feed}`, `lodestar_node_submission_errors_total{feed}`,
`lodestar_node_last_price_usd{feed}`, `lodestar_node_last_success_timestamp_seconds{feed}`,
`lodestar_node_round_interval_seconds`, `lodestar_node_up`.

Example scrape config:

```yaml
scrape_configs:
  - job_name: lodestar-node
    static_configs:
      - targets: ["node-host:9464"]
```

Never commit `.env`. Rotate keys per operator; each operator needs a
non-withdrawing stake in `StakingVault` before submissions will be accepted.

## Feeds config

Each entry lists the independent sources this node samples for one feed:

```json
{
  "symbol": "BOT/USDT",
  "feedDecimals": 8,
  "sources": [
    {
      "name": "bdex",
      "params": {
        "pool": "0xD3EC267707BA234583645E75CE283Cf679dd94Fa",
        "rpcUrl": "https://rpc.bohr.life",
        "token0Decimals": "6",
        "token1Decimals": "18",
        "invert": "false"
      }
    }
  ]
}
```

- `assetId` is computed automatically as `keccak256(symbol)` and must match
  the feed id registered on-chain by the deploy script.
- The bdex source reads `getReserves()` on a UniswapV2-style pool. Set
  `invert: true` if `token0` is the quote asset.
- A feed with an empty `sources` array is **skipped** (one warning, no round
  loop) instead of erroring every round.
- Only positive finite prices are accepted; the submitter never sends
  non-finite values.

### Source provenance (testnet, chain 968)

Verified against the BOT Chain DEX docs and a live RPC before being committed:

| Feed | Source | Value | How it was verified |
|---|---|---|---|
| BOT/USDT | bdex | pool `0xD3EC267707BA234583645E75CE283Cf679dd94Fa` | official V2 factory `getPair(WBOT, USDT)`; `getReserves()` → USDT(6)/WBOT(18) |
| WBOT/USDT | bdex | same pool | WBOT is BOT wrapped 1:1 |
| LODE/USDT | — | none yet | LODE `0x3984…922b` has a single holder and no V2/V3 pool |

Canonical BOT Chain addresses (from `dev-docs.botchain.ai`) used above:

- WBOT (18): `0xD5452816194a3784dBa983426cCe7c122F4abd30`
- USDT testnet (6): `0x75edC9335175Fc0552D51D48439F229c10420fe3`
- V2 Factory testnet: `0x65b8e98ceA190d8c28B3e4716402027f634d15a3`
- V2 Router02 testnet: `0xD6425a02f0845B8D99e349C34D2E7A576E177345`
- Mainnet WBOT/USDT pool: `0x64f418471a1a7932a190e10da5a8551db5abec05`
  (mainnet USDT `0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C`)

Notes:

- `BOT/USDT` and `WBOT/USDT` share one pool because WBOT is BOT wrapped 1:1.
- **Removed** bogus sources: Binance `BOTUSDT` (no such market) and CoinGecko
  `bitcoin-of-bot` (no such id). CoinGecko's real BOT Chain id is `wrapped-bot`
  (contract `0xD545…`); it is a valid extra source on **mainnet**, but on
  testnet it tracks the real-world price and diverges from the seeded testnet
  pool by more than the local deviation bound, so adding it there fails every
  round.
- To enable `LODE/USDT`: seed a BDEX pool first, then add a `bdex` source with
  its pool address and token decimals — the on-chain `assetId` does not change.

### Re-verifying sources

```bash
npx tsx scripts/probe-sources.ts          # runs every configured feed live
npx tsx scripts/probe-sources.ts path.json  # or an alternate feed list
```


## Docker

```bash
docker build -t lodestar-node .
docker run --env-file .env -v "$PWD/config:/app/config" lodestar-node
```

## Behavior guarantees

- A single source failure never crashes the node; failed sources are logged
  and the round continues if at least one source survives.
- A feed configured with no sources is skipped with a single warning; the node
  never submits a price it could not source.
- Every submission is simulated first; a predictable revert is logged without
  spending gas, and the round retries within its backoff window.
- If one RPC endpoint is down or rate-limited, the `fallback` transport moves
  on to the next configured endpoint.
- Readiness (`/readyz`) flips to healthy once the feed loops start, and the
  health server shuts down cleanly on `SIGINT`/`SIGTERM`.
- The node exits only on fatal errors (bad key, chain mismatch, gas /
  insufficient funds) or `SIGINT`/`SIGTERM`.