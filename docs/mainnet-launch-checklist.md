# Mainnet Launch Checklist: Lodestar Oracle

Ordered, gated checklist for putting Lodestar on BOT Chain mainnet (chain ID
677). Do not start a step until the previous gate is signed off. Every address
produced here must be independently verifiable on `scan.botchain.ai`.

Companion docs: `spec.md`, `methodology.md`, `known-limitations.md`,
`node-operator-guide.md`, `ops-runbook.md`, `../ops/incident-playbook.md`.

---

## 0. Gate — code freeze & audit

- [ ] `main` is frozen; no direct pushes. All changes via reviewed PRs.
- [ ] Contracts: `cd contracts && npm test` — all pass (89+ expected).
- [ ] Contracts static analysis: run Slither (`slither.config.json`); no
      unaddressed high/medium findings.
- [ ] Node client: `cd node-client && npm run typecheck && npm test`.
- [ ] Dashboard: `cd dashboard && npm run typecheck && npm run build`.
- [ ] ABI drift: `node contracts/scripts/check-dashboard-abi.ts` returns clean.
- [ ] External security review of `OracleAggregator`, `StakingVault`,
      `TimelockController` completed; findings triaged and fixed.
- [ ] Storage-layout diff confirms the additive-only rule (no deletions).

## 1. Governance & keys

- [ ] Deploy a **Gnosis Safe multisig** (recommend 3-of-5 or 4-of-7) as the
      protocol owner. This address becomes `TREASURY_ADDRESS`.
- [ ] Never reuse testnet keys on mainnet (`ops-runbook.md`). Generate fresh
      deployer + operator keys; store in a secret manager / HSM.
- [ ] Define role holders for timelock `PROPOSER` / `EXECUTOR` / `CANCELLER`;
      the Safe holds `PROPOSER` + `CANCELLER`, an executor bot holds `EXECUTOR`.
- [ ] Governance calendar documented: 48h timelock delay, 30d execution window.

## 2. Contract deployment

- [ ] `contracts/.env` set: `DEPLOY_KEY` (fresh), `TREASURY_ADDRESS` (Safe),
      `BOT_MAINNET_RPC=https://rpc.botchain.ai`, `BOT_MAINNET_ETHERSCAN_KEY`,
      and the protocol params (`ROUND_INTERVAL_SECONDS`, `DEVIATION_BPS`,
      `BREAKER_BPS`, `STALE_AFTER`, `EMISSION_PER_ROUND`).
- [ ] Deploy: `cd contracts && npm run deploy:mainnet` — writes
      `config/addresses/botMainnet.json`.
- [ ] Verify every contract on `scan.botchain.ai` (the script verifies token,
      vault, aggregator; verify the rest manually if needed).
- [ ] Record `LodestarToken`, `StakingVault`, `TimelockController`,
      `OracleAggregator` and each `PriceFeed` address in the registry.
- [ ] Populate `BOT_MAINNET` in `contracts/config/addresses.ts` with the same
      addresses and a sourcing comment (mirrors `botMainnet.json`).
- [ ] Confirm `TimelockController` now owns `StakingVault` + `OracleAggregator`.

## 3. Bootstrap & funding

- [ ] Confirm the 100M LODE fixed supply is held by the treasury Safe (no mint
      function exists).
- [ ] Safe approves + calls `vault.fundRewards(...)` to seed the reward pool
      (testnet seeded 500k LODE; size mainnet deliberately).
- [ ] Confirm no admin function is reachable by an EOA — only via the timelock.

## 4. Feeds & liquidity

- [ ] Seed a real **BDEX LODE/USDT** (and/or LODE/BOT) pool; record the pool
      address and token decimals.
- [ ] Update `node-client/config/feeds.json` for mainnet:
      - BOT/USDT, WBOT/USDT → BDEX WBOT/USDT pool
        `0x64f418471a1a7932a190e10da5a8551db5abec05` (mainnet USDT
        `0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C`);
      - LODE/USDT → the newly seeded pool.
- [ ] Add CoinGecko `wrapped-bot` as an independent source now that mainnet
      prices track reality (testnet-only divergence no longer applies).
- [ ] Re-verify live: `cd node-client && npx tsx scripts/probe-sources.ts`
      returns a price for every feed.

## 5. Node operators

- [ ] Recruit at least 3 (quorum is 3) independent operators.
- [ ] Each operator: fresh key, `RPC_URL=https://rpc.botchain.ai`, `CHAIN_ID=677`,
      mainnet `AGGREGATOR_ADDRESS`, ≥ `1000 LODE` staked and eligible.
- [ ] Confirm continuous submissions for ≥ 48h with zero manual intervention.
- [ ] Confirm the local `MAX_LOCAL_DEVIATION_PCT` and `RETRY_BACKOFF_FRACTION`
      are sane for mainnet spreads.

## 6. Dashboard

- [ ] Point `dashboard/.env` at mainnet: `NEXT_PUBLIC_RPC_URL`,
      `NEXT_PUBLIC_CHAIN_ID=677`, `NEXT_PUBLIC_SCANNER_URL`,
      `NEXT_PUBLIC_TOKEN_ADDRESS`, `NEXT_PUBLIC_VAULT_ADDRESS`,
      `NEXT_PUBLIC_AGGREGATOR_ADDRESS`.
- [ ] Set `REVALIDATE_SECRET` (Vercel env). Set `CRON_SECRET` to the same value
      so the `dashboard/vercel.json` cron authenticates. Confirm the cron plan
      supports sub-daily schedules (else attach an external scheduler).
- [ ] Confirm the dashboard leaves demo mode and renders live mainnet data.

## 7. Monitoring & alerting

- [ ] Prometheus scrapes each node's `/metrics`; alert rules loaded
      (no submission 10m = critical, feed paused = warn, RPC errors rising,
      low gas).
- [ ] `/readyz` health checks wired to paging.
- [ ] Replace the `<replace>` contacts in `ops-runbook.md` and the
      `@lodestar.example` placeholders in `ops/incident-playbook.md`.
- [ ] Status page live; incident drill run once before go-live.

## 8. Go-live smoke tests

- [ ] Per asset: submit → round closes → price published; `latestRoundData`
      and `getRoundData(roundId)` return the published value.
- [ ] Circuit-breaker rehearsal: a >`BREAKER_BPS` move pauses the feed and a
      manual (timelock) resume restores it.
- [ ] Unknown-round `getRoundData` reverts (Chainlink semantics).
- [ ] Stale-data path: `PriceFeed` flags stale after `STALE_AFTER`.
- [ ] Withdraw + slash paths exercised on a canary stake.

## 9. Post-launch

- [ ] 48h timelock observation window: monitor the queue, nothing unexpected.
- [ ] Publish contract addresses + verification links.
- [ ] 30-day review: round uptime ≥ 99%, no unexplained slashes, gas topped up.
- [ ] Record any parameter changes through the timelock, not direct calls.

---

## Known gaps to close before or during launch

- Multisig handover of timelock roles is manual (`known-limitations.md`).
- Reward/slash evidence is event-based and coarse for v1.
- `TimelockController` currently supports single (non-batched) calls.
- BDEX liquidity may be thin; the DEX-vs-CEX spread can exceed the on-chain
  deviation threshold — watch for false breaker trips.
