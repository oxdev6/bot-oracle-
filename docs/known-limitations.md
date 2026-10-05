# Known Limitations

Honest disclosure of what Lodestar is **not** yet. Most items below are the
explicit roadmap; some are inherent design trade-offs we chose knowingly.

## 1. Decentralization level

- **Permissioned launch.** Starting dynamics expected with 3–5 operators hand
  vetted by the founders. The system is *designed* to open up (the spec and
  slashing rules are operator-agnostic), but v1 is not a permissionless node
  market. New-operator onboarding criteria are published in the roadmap.
- **Single deployer / signer of the admin actions.** All admin state is owned
  by a timelock, but the person who queues transactions is the deployer today.
  A Gnosis Safe (or a local multisig) should own the timelock's queue/execute
  roles before mainnet value concentrates.
- **Concentration risk**: if one operator runs most nodes, their correlated
  failure can still stop a feed (although *values* remain safe — the median
  still rejects their embedded skew).

## 2. Slashing is coarse

- Violation detection today is designed to be provable and simple: inaccurate
  submissions, missing rounds, double-submission, submitting with a queued
  withdrawal. More sophisticated fraud (Sybil-redistribution of a large stake,
  micro-latency gaming) is not yet detected.
- The protocol slashes **events**, not *intent*. Proving intent on-chain is a
  hard problem; we prioritize clear, objective rules.
- A targeted on-chain attacker who already controls a majority of *network
  submission slots* can influence the median. Mitigation is economic (stakes,
  outlier rejection, circuit breaker) not cryptographic.

## 3. No staking/liquidity mechanics

- **No LODE emissions to stakers beyond oracle rounds.** There is no separate
  staking APR; the only yield is the per-round reward pool, which depends on
  network activity.
- **No on-chain bond market or delegation.** You cannot delegate LODE to an
  operator; each node must stake directly.

## 4. Price-source dependence

- The aggregator trusts operator self-reports of price *source* timestamps and
  relies on operator honesty in sampling. We do not run our own market-data
  infrastructure at protocol level.
- BDEX pool liquidity can be thin; the DEX-vs-CEX spread can exceed the 3%
  outlier threshold during high volatility, causing rounds to close with fewer
  submissions (which is correct behavior — no price is better than a bad one).

## 5. Not audited (externally)

- The codebase has a thorough in-repo test suite (including adversarial cases)
  but has **not** been through an external Solidity audit. Running Slither/Mythril
  and a paid freelance review is Phase 4 of the full build plan before any
  significant mainnet value is bonded. Known issue: reentrancy guards, integer
  edge cases, and upgrade paths remain to be formally reviewed.
- Constants are chosen conservatively but reviewed at launch.

## 6. Dashboard scope

- The public dashboard reads only from the deployed contracts; it does **not**
  crawl every chain transaction, keep the slashing history database, or show
  up/down history graphs. Those are follow-up features (Neon/Supabase-backed
  persistence is on the roadmap).
- While the launch addresses are unset, the dashboard renders an empty state —
  it is not broken, it is awaiting the registry.

## 7. Timelock flaws inherent to minimal timelock

- The custom `TimelockController` executes by `keccak256(nonce, target, data)`
  deterministic id. It is compatible with the OpenZeppelin flow but does not
  support multi-collider batching, role-granular scheduling, or delay
  extension. It was built deliberately small; an external review could still
  find edge cases.

## 8. Chain risks out of our control

- BOT Chain network-side events (RPC outages, chain stops, reorgs past the
  confirmations we wait) can stall rounds. The circuit breaker + staleness
  logic limits damage but cannot prevent it.
- Testnet/mainnet RPCs are third-party; node health depends on them.

---

### Honesty policy

This document is a living file. Any change to the security model, an external
review, or a discovered incident will be appended here with a date, exactly as
the README promises. If we cannot fully explain a limitation we will not ship
the feature that creates it.