# Lodestar Oracle — Protocol Spec

A staked, Chainlink-compatible price oracle native to BOT Chain.

## Trust model

- Prices are produced by a rotating set of **node operators**, each of which
  must lock a **minimum stake** of LODE in `StakingVault` before their
  submissions are accepted.
- Dishonest or unresponsive operators are **slashed**; honest operators earn
  per-round emission rewards.
- The final price for a round is the **median** of accepted submissions after
  **outlier rejection**, not the mean and not any single operator's number.
- Admin parameters can only change through a **48-hour timelock**, so no single
  key can silently change the rules.

## Roles

| Role | Actor | Powers |
|---|---|---|
| Owner | timelock controller | register feeds, tweak thresholds, resume paused feeds, change vault min-stake, schedule admin txs |
| Aggregator | `OracleAggregator` | (the only caller allowed to) slash operators in `StakingVault`, push per-round rewards |
| Operator | any EOA/caller | stake, submit prices, unstake (7-day withdrawal delay) |

## Protocol parameters (v1)

| Parameter | Value | Where |
|---|---|---|
| Round interval | `120 s` | `OracleAggregator.roundInterval` |
| Outlier threshold | `300 bps` (3%) | `OracleAggregator.DEVIATION_THRESHOLD_BPS` |
| Circuit breaker | `2000 bps` (20% round-over-round) | `OracleAggregator.BREAKER_THRESHOLD_BPS` |
| Staleness cutoff | `3600 s` (1h) | `OracleAggregator.STALE_AFTER_SECONDS` |
| Emission per round | `10 LODE` | `OracleAggregator.emissionPerRound` |
| Min stake | `1000 LODE` | `StakingVault.minStake` |
| Withdrawal delay | `7 days` | `StakingVault.WITHDRAWAL_DELAY` |
| Timelock delay | `48 h` | `TimelockController.DELAY` |

## Round lifecycle

1. Operator queriers fetch independent quotes (Binance, CoinGecko, BDEX pool).
2. The operator client computes a **local median**, rejects its own outlier
   sources, scales to `feedDecimals`, and calls `submitPrice(assetId, price, ts)`.
3. `OracleAggregator.submitPrice` checks:
   - asset is registered,
   - caller has a non-withdrawing stake (`isEligibleOperator`),
   - caller has already-submitted state is reset (fresh round if `now >= roundStart + interval`),
   - price is within `DEVIATION_THRESHOLD_BPS` of the last live reference price **or** the reference is stale (a stale reference can't veto a fresh round).
4. When a majority of the current round window has elapsed the round **closes**:
   - the raw median of submissions is computed,
   - submissions deviating more than the outlier threshold from that raw median are excluded,
   - the median of the **surviving** submissions becomes the round price.
5. The new round price is compared to the previous round price. If the move
   exceeds `BREAKER_THRESHOLD_BPS`, the feed is **paused** (`circuit breaker`)
   and only the timelock owner can `resumeFeed()`.
6. Operators that contributed an accepted submission share `emissionPerRound`
   equally; `StakingVault.distributeRewards` pays them from the reward pool.

## Slashing

Callable **only** by the aggregator. In violation events, the aggregator calls
`StakingVault.slash(operator, amount)`:

- Outgoing withdrawal requests are cancelled **newest-first** so an operator
  cannot dodge an imminent slash by quick-unstaking.
- The slash then reduces the operator's live stake.
- Slash proceeds are moved to a dedicated `slashingTreasury` — a separate
  budget for protocol reserves that isn't burned, but isn't reachable by
  either the operator or the core admin either.

## Read interface

`PriceFeed.sol` implements `AggregatorV3Interface` (`latestRoundData`,
`decimals`, `description`, `version`) so existing Chainlink consumers read
the Lodestar feed with zero changes. `ExampleConsumer.sol` shows the pattern.

## Deployment order

1. `LodestarToken` → minted to treasury.
2. `StakingVault` → treasury, min-stake.
3. `TimelockController` → delay 48h.
4. `OracleAggregator` → vault, owner=timelock, params above.
5. `vault.setAggregator(aggregator)`; `aggregator.registerAsset(...)` for each pair.
6. Owner → timelock for vault + aggregator.
7. `PriceFeed` wrappers per asset for Chainlink consumers.
8. Fund reward pool; operators stake and begin submitting.