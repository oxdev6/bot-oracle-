# Lodestar Oracle Node Client

Reference node implementation for Lodestar operators. The node samples
independent price sources, computes a local median, rejects any source that
deviates from the median by more than `MAX_LOCAL_DEVIATION_PCT` (default 5%),
scales the price to the feed's `feedDecimals`, and submits it to the on-chain
`OracleAggregator` using your operator stake.

The scheduler runs one round loop per configured feed at the on-chain
`roundInterval` (`OracleAggregator.roundInterval`), each tick offset by up to
`JITTER_SECONDS` of random jitter so all operators do not converge on the same
block.

## Architecture

```
src/
  index.ts         entrypoint: config -> clients -> one loop per feed
  config.ts        env + feeds.json loader; derives assetId = keccak256(symbol)
  fetchers.ts      source adapters: binance, coingecko, bdex (DEX pool)
  aggregator.ts    local aggregation: median + outlier rejection
  submitter.ts     viem client + minimal OracleAggregator ABI
  scheduler.ts     jittered round loop with per-round error isolation
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
| `RPC_URL` | yes | — | BOT Chain RPC (testnet `https://rpc.bohr.life`) |
| `CHAIN_ID` | no | `968` | 968 testnet / 677 mainnet |
| `AGGREGATOR_ADDRESS` | yes | — | deployed `OracleAggregator` address |
| `OPERATOR_KEY` | yes | — | operator private key (0x + 64 hex) |
| `MAX_LOCAL_DEVIATION_PCT` | no | `5` | reject own sources deviating > this % from own median |
| `JITTER_SECONDS` | no | `4` | per-tick scheduling jitter (s) |
| `CONFIG_PATH` | no | `config/feeds.json` | alternate feed list |

Never commit `.env`. Rotate keys per operator; each operator needs a
non-withdrawing stake in `StakingVault` before submissions will be accepted.

## Feeds config

Each entry:

```json
{
  "symbol": "BOT/USDT",
  "feedDecimals": 8,
  "sources": [
    { "name": "binance",   "params": { "symbol": "BOTUSDT" } },
    { "name": "coingecko", "params": { "id": "bitcoin-of-bot" } },
    { "name": "bdex",      "params": { "pool": "...", "token0Decimals": 18, "token1Decimals": 6 } }
  ]
}
```

- `assetId` is computed automatically as `keccak256(symbol)` and must match
  the feed id registered on-chain by the deploy script.
- The bdex source reads `getReserves()` on a UniswapV2-style pool. Set
  `invert: true` if `token0` is the quote asset.
- Only positive finite prices are accepted; the submitter never sends
  non-finite values.

## Docker

```bash
docker build -t lodestar-node .
docker run --env-file .env -v "$PWD/config:/app/config" lodestar-node
```

## Behavior guarantees

- A single source failure never crashes the node; failed sources are logged
  and the round continues if at least one source survives.
- A non-fatal in-flight revert (e.g. "already submitted") is logged and the
  next tick retries.
- The node exits only on fatal errors (bad key, chain mismatch, gas /
  insufficient funds) or `SIGINT`/`SIGTERM`.