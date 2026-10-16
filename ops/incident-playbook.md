# Incident Playbook: Lodestar Oracle

This is the minimal runbook for a production outage or suspected manipulation. It assumes a single-lead responder; escalate to multisig/timelock owner when policy changes are needed.

## Severity levels
- **P0 - Loss of liveness**: no new prices published for ≥ 2× `roundInterval` (240s) with open rounds; multiple feeds missing.
- **P1 - Divergence / potential manipulation**: sustained outlier prices, suspected keeper/round abuse, or voter-submission anomalies.
- **P2 - Degraded**: high RPC errors, partial operator set offline, health alerts firing intermittently.

## P0: Liveness outage
1. **Confirm scope**: check `/api/health` (dashboard), node-client `/readyz`/`/status`, and on-chain `getFeedHealth` for affected feeds.
2. **Restart/scale operators**: confirm each operator's process is running, logs show retries (not fatal), and private key/gas remain. If an RPC is flaky, switch to a backup (multi-RPC).
3. **Escalate**: if no recovery within `roundInterval * 3` (360s), alert multisig/timelock (via channel + on-call). Do not pause feeds on your own unless instructed; pausing requires timelock.
4. **Verify**: next round(s) publish, `lastUpdate` increases, status returns to `live`.

## P1: Divergence / manipulation
1. **Capture evidence**: save dashboard `/api/feeds/[id]` history, operator `/status`, recent `RoundClosed` and `Slash` logs from the scanner, and transaction hashes for submissions.
2. **Isolate**: note which operators submitted outliers (on-chain) and which nodes logged `source failed`/`outlier check failed`. Compare against feeds config.
3. **Contain**: if feed clearly uncorrectable, timelock owner may `pauseFeed`/`unpauseFeed` or deactivate the feed (`deactivateAsset`) — never do this from a hot operator key.
4. **Post-incident**: review operator uptime/submissions, consider `slash` evidence (off-chain memo) and process fixes; update this playbook.

## P2: Degraded
1. **RPC flakiness**: prefer operator nodes with `RPC_URL` list; dashboard uses cached API. Check `/api/health`.
2. **Backfill alerts**: ensure Prometheus rules firing (no submission > 600s). Repair/replace misbehaving operator node.
3. **Roll forward**: no protocol change unless required.

## Contact
- Primary on-call: `oncall@lodestar.example` (replace with real)
- Timelock/multisig: see `contracts/config/addresses/*` and gov docs
- Status page: `status.lodestar.example` (replace with real)

## Artifacts
- Feed detail JSON (dashboard)
- Node client `/metrics` snapshot (last 15m)
- Event logs: RoundClosed, Slash, SubmitPrice attempts
- Investigation timeline (UTC)

## Prevention
- Run at least two independent operators per mission-critical feed.
- Expose `/healthz`,`/readyz`,`/metrics` for scraping.
- Keep secrets in a secret manager (never plain `.env` on shared hosts).
- Use multi-RPC and container restart policies.
- Regularly verify stake eligibility and key rotation procedure.
