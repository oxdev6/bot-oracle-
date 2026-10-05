# Lodestar Oracle (bot-oracle)

A **staked price-oracle network** for BOT Chain. Independent node operators bond
LODE and submit signed prices; the network aggregates them into a median,
rejects outliers, slashes dishonest behavior, and exposes a Chainlink-compatible
`PriceFeed` that any contract can read with zero changes.

> Token: **LODESTAR (LODE)** · Chain: BOT Chain (testnet 968 / mainnet 677)

---

## Why it exists

BOT Chain's own roadmap calls out decentralized oracle infrastructure as a gap.
This project is that missing piece: a permissioned-at-first, increasingly-open,
staking-secured price oracle built directly on BOT Chain — not a fork of an
EVM-neutral oracle with a foreign token economy bolted on.

## What's inside

| Directory     | What                             | Stack                                  |
|---------------|----------------------------------|----------------------------------------|
| `contracts/`  | Smart contracts + deployment     | Solidity 0.8, Hardhat, ethers v6       |
| `node-client/`| Docker-ized node operator client | TypeScript, viem, Binance/CoinGecko/DeFi |
| `dashboard/`  | Public verifiable dashboard      | Next.js 15, viem                        |
| `docs/`       | Spec, methodology, operator guide| Markdown                               |

## Architecture

```
Node Operators (3-5 to start)
   |  fetch prices from independent sources, submit signed price each round
   v
OracleAggregator (median calc, staleness + outlier rejection, circuit breaker)
   |
   |---> StakingVault (bonding, slashing, rewards) <--- LODE token
   |
   +---> PriceFeed (Chainlink-compatible) <--- read by consumer contracts
```

Core contracts (`contracts/contracts/`):

- **`LodestarToken.sol`** — fixed-supply ERC-20 (LODE), minted once at deploy to a treasury multisig.
- **`StakingVault.sol`** — stake/unstake (7-day withdrawal delay), slashing (aggregator-only), per-round rewards.
- **`OracleAggregator.sol`** — round-based median aggregation, outlier rejection (3%), staleness handling, circuit breaker (>20% round-over-round deviation pauses the feed).
- **`PriceFeed.sol`** — Chainlink `AggregatorV3Interface`-compatible read wrapper.
- **`TimelockController.sol`** — minimal timelock so every admin action has a public queue/execute window.
- **`consumers/ExampleConsumer.sol`** — minimal example of how to integrate.

## Quick start

```
# 1. Contracts — build & test
cd contracts
npm install
npx hardhat test                 # full suite incl. adversarial cases
npx hardhat run scripts/deploy.ts --network botTestnet   # deploy (testnet 968)

# 2. Run a node (needs a funded operator key)
cd ../node-client
npm install
cp .env.example .env              # set OPERATOR_KEY, AGGREGATOR_ADDRESS, RPC
npm run node                      # fetch -> median -> submit per round

# 3. Dashboard
cd ../dashboard
npm install
cp .env.example .env.local        # point NEXT_PUBLIC_* at deployed contracts
npm run dev                       # http://localhost:3000
```

## Documentation

- [`docs/spec.md`](docs/spec.md) — one-page protocol spec (params, roles, flow).
- [`docs/methodology.md`](docs/methodology.md) — how median aggregation, slashing, and the circuit breaker work.
- [`docs/node-operator-guide.md`](docs/node-operator-guide.md) — step-by-step third-party node setup.
- [`docs/known-limitations.md`](docs/known-limitations.md) — honest disclosure of what is not yet hardened.

## Security

This system holds real staked value. Read `docs/known-limitations.md` for an
honest disclosure of what is and isn't hardened today. Admin functions sit
behind a timelock; allocations, positions, and parameter changes are openly
queueable and executable only after the delay.

## License

MIT — an infrastructure/public-good project.