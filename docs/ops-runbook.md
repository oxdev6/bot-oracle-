# Operations Runbook: Lodestar Oracle

Daily, weekly and pre-release checks to keep the network healthy and low-touch.

## Golden paths
- **Operator lifecycle**: stake ≥ min (1000 LODE) → run node client → monitor `/readyz` → request withdrawal when exiting (7d).
- **Deployment**: verify addresses in registry → set envs → smoke test via `npm run test`/`typecheck` → run slither against changed contracts → deploy behind timelock → call `check-dashboard-abi.ts`.
- **Incident escalation**: see `ops/incident-playbook.md`.

## Daily checks (10 min)
- [ ] Dashboard `/api/health` = `ok` (and no RPC errors in last 24h).
- [ ] No feed stuck for > 1 round interval (120s). Check `nextRoundAt` age.
- [ ] Operator counts reasonable; no large drop-off.
- [ ] Node `/metrics`: `lodestar_node_submissions_total` increasing per feed; `lodestar_node_submission_errors_total` small or flat.
- [ ] RPC errors (fallbacks working) — `fallbackRpcUrls` being used.
- [ ] Slashing table quiet (or triage if new entries).

## Weekly checks (30 min)
- [ ] Check staker set: any operator leaving (not eligible)? Unstaking timeline clear.
- [ ] Gas spend: top-up plans for key operators.
- [ ] Review round history for each feed (no repeated misses).
- [ ] Dashboard typecheck/build still pass locally or in CI.
- [ ] Reconcile LODE supply/staked vs `getVault.totalStake` (sanity).
- [ ] Check for upstream source deprecations (e.g. API base URLs) in feeds.json.

## Pre-release / Hardfork readiness
- [ ] Contracts: `npx hardhat test` (all pass) — 89+ expected.
- [ ] Node client: `npm run typecheck && npm run test`.
- [ ] Dashboard: `npm run typecheck && npm run build`.
- [ ] ABI sync: `npx hardhat run scripts/check-dashboard-abi.ts` returns clean.
- [ ] Slither: review new findings; add to allowlist only if false positive with rationale.
- [ ] Docs updated: `.env.example`, README, node-operator-guide, build guide.
- [ ] Multi-RPC tested (simulate failover) on one node.
- [ ] Health endpoints probed in a canary environment.

## Observability
- **Metrics (node)**: `lodestar_node_submissions_total{feed}`, `lodestar_node_submission_errors_total{feed}`, `lodestar_node_last_price_usd{feed}`, `lodestar_node_last_success_timestamp_seconds{feed}`, `lodestar_node_round_interval_seconds`, `lodestar_node_up`.
- **SLO ideas**: publish ≥ 99% of expected rounds per feed (windows of 24h); `/readyz` 99.9%.
- **Alerts**: no submission 10m (critical), feed paused 5m (warn), RPC error rate rising (warn), low gas (warn).

## Tooling
- `contracts/scripts/check-dashboard-abi.ts`: guards ABI drift between contracts and dashboard.
- `contracts/scripts/deploy.ts`, `contracts/scripts/registry.ts`: deploy/registry helpers.
- `node-client/src/rpc.ts`: fallback transport; configure `RPC_URL` comma-separated.
- `node-client/src/health.ts`: probes; expose in Docker with HEALTHCHECK.

## Dashboard cache & revalidation
- The dashboard serves cached on-chain reads (`lib/server-data.ts`). Cached
  entries use `revalidate: false` — they are held indefinitely and **never
  refresh on a timer**. There is deliberately no TTL and no Vercel Cron.
- The dashboard's **Refresh** control calls the same-origin `refreshDashboard`
  Server Action (`dashboard/app/actions.ts`), which invalidates every tag and
  forces the next read to recompute from chain. Data changes only on an explicit
  click; the dashboard never polls or refreshes itself.
- `POST`/`GET /api/revalidate` busts the same tags for external callers
  (operators, CI, external schedulers). It is **fail-closed**: it returns `503`
  unless `REVALIDATE_SECRET` (or `CRON_SECRET`) is set in the environment, `401`
  for a wrong secret, and is rate-limited per IP.
- External callers authenticate with `x-revalidate-secret: <secret>` or
  `Authorization: Bearer <secret>`.
- **Rotation:** change `REVALIDATE_SECRET` (and `CRON_SECRET` if used) in Vercel,
  redeploy, and update any external caller. No contract or node changes required.

## Secrets & safety
- Never reuse testnet private keys on mainnet.
- Use `.env.local`/secret manager; never commit `.env`.
- Operator wallet needs BOT for gas only; LODE held in staking vault.
- Admin actions must go through `TimelockController` (48h delay) unless an emergency policy allows.
- Additive-only contracts rule: never delete functions/storage; only add. Verify with storage layout diffs.

## Contacts
- Oracle lead: `<replace>`
- Smart contracts: `<replace>`
- SRE: `<replace>`
- Security: `<replace>`

---
_Last updated:_ 2026-10-13 | _Branch:_ main
