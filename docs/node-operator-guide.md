# Node Operator Guide

How to run a Lodestar oracle node, written for someone who has never seen the
project before.

## What you need

- **Node.js 20+** and npm (or Docker — see below).
- An operator wallet funded with a little **BOT** for gas on chain 968
  (testnet faucet) or 677 (mainnet).
- **1000 LODE or more** to stake in the vault.
- The deployed contract addresses from the project's Contract Registry
  (`contracts/config/addresses/<network>.json`).
- Nothing else. Prices are fetched from public sources; no account needed.

## Procedure (testnet)

### 1. Stake

Call `StakingVault.stake(amountLode)` with your operator address and at least
`1000 * 10**18` LODE. Your operator is now eligible to submit. (In a browser
frontend, approve LODE for the vault first.)

Double-check eligibility:

```
contract read StakingVault.isEligibleOperator(yourAddress)
```

If you are mid-withdrawal, eligibility is false — the withdrawal finishes first.

### 2. Get the node client

```bash
git clone <repo-url>
cd node-client
npm install
cp .env.example .env
```

### 3. Configure `.env`

```bash
RPC_URL=https://rpc.bohr.life           # testnet; https://rpc.botchain.ai for mainnet
CHAIN_ID=968                            # 677 for mainnet
AGGREGATOR_ADDRESS=0x...                # OracleAggregator address (registry JSON)
OPERATOR_KEY=0x...                      # your LOWER-CASE private key, no padding
# optional:
# SCANNER_URL=https://scan.bohr.life
# MAX_LOCAL_DEVIATION_PCT=5             # reject own sources deviating more than 5% from own median
# JITTER_SECONDS=4
```

**Never commit `.env`.** Treat `OPERATOR_KEY` like a bank password. If you run
multiple nodes, use a different key and stake for each.

### 4. Review the feeds config

`config/feeds.json` lists every pair this node will attest. `assetId` is
derived automatically as `keccak256(symbol)` and must equal the id the
deployer registered on-chain. If you only want to run part of the network,
trim the list — but only submit to feeds you honestly observe.

### 5. Run

```bash
npm test              # sanity: unit tests pass locally
npm run node          # starts one round loop per feed
```

Expected logs:

```
[boot] operator     0x…
[boot] feeds        BOT/USDT, LODE/USDT
[round:BOT/USDT] median=0.832000 scaled=83200000 sources=3 spread=0.21% tx=0x4f2a…
```

Each round completes within `roundInterval` (120s) plus your jitter. A per-round
revert (e.g. `already submitted`) is normal if another node beat you to the
round — the loop keeps going.

### 6. Docker (optional, recommended)

```bash
docker build -t lodestar-node .
docker run --env-file .env -d --name lodestar-node --restart unless-stopped lodestar-node
```

The container runs as an unprivileged user and only ever writes logs.

## Monitoring

- Watch the public dashboard (`dashboard/`) for your operator's submissions.
- If the circuit breaker pauses a feed, `npm run node` keeps running; the
  on-chain feed just doesn't close new rounds until the timelock owner resumes.
- Keep at least a day's gas in the operator wallet. Losing gas on a liveness
  round is exactly the failure the protocol is designed to slash.

## Exit

1. Wait for any dependent position to unwind.
2. Call `StakingVault.unstake(amount)`; your LODE moves to a 7-day pending
   request and you immediately become ineligible to submit.
3. After the delay, claim your LODE back.
4. Stop the container / process. Log rotation is up to you; the node stores no
   state.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Missing OPERATOR_KEY` | env not loaded | `set -a; source .env; set +a` or use `--env-file` |
| `aggregator submitPrice: not eligible` | not staked / mid-withdrawal | stake ≥ 1000 LODE and confirm `isEligibleOperator` |
| `already submitted` | another node submitted first this round | expected; no action |
| `insufficient funds` | no BOT for gas | top up; restart |
| `chain mismatch` | wrong RPC/CHAIN_ID | testnet 968 ↔ rpc.bohr.life, mainnet 677 ↔ rpc.botchain.ai |