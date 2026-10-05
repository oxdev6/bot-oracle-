# Lodestar Oracle — Complete Build Guide
### A staked price-oracle network for BOT Chain
**Repo:** `bot-oracle` · **Token:** Lodestar (LODE)

This is the single, complete reference — architecture, setup, phase-by-phase steps, security, and grant submission all in one place. Supersedes earlier separate architecture/build-guide drafts.

---

## 0. Prerequisites & Tooling Checklist

Before Day 1, make sure you have:

- [ ] Node.js 20+ and npm/pnpm installed
- [ ] Foundry installed (`curl -L https://foundry.paradigm.xyz | bash && foundryup`)
- [ ] Docker installed (for node operator packaging)
- [ ] A GitHub account/org set up as `bot-oracle` (confirmed available — verify manually one more time before creating)
- [ ] A funded wallet for testnet deployment (BOT Chain testnet faucet, chain ID 968) and a separate one for eventual mainnet deployment — **never reuse a testnet key for mainnet**
- [ ] A password manager or secrets vault for private keys — never commit keys, use `.env` + `.gitignore` from commit 1
- [ ] Accounts/API keys for external price sources you'll pull from (e.g., a free-tier CoinGecko or CoinMarketCap API key, a public CEX market-data endpoint that needs no auth)
- [ ] 3-5 people lined up (yourself + collaborators) willing to run initial oracle nodes
- [ ] Vercel account (dashboard hosting), Neon/Supabase account (if you add persistence later), UptimeRobot account (free monitoring)
- [ ] A Gnosis Safe (or equivalent multisig) deployable on BOT Chain confirmed — check their docs/explorer for an existing Safe deployment on chain 677, or budget time to deploy a minimal timelock contract yourself if none exists

---

## 1. Naming & Branding Decisions (locked in)

| Item | Decision |
|---|---|
| Project/repo name | `bot-oracle` |
| Token name | Lodestar |
| Token ticker | LODE |
| Avoid | "ORCL" or any "Oracle"-adjacent ticker — Oracle Corporation has actively litigated crypto projects over "Oracle" branding (2019 and 2024 lawsuits against Crypto Oracle LLC); not worth the risk |
| Domain (optional) | Check `bot-oracle.xyz`, `lodestaroracle.xyz`, or similar before committing — do this in parallel with Phase 0 below |

- [ ] Manually visit `github.com/bot-oracle` to do a final human confirmation it's free, then create the org
- [ ] Register npm scope/package name `bot-oracle` if you plan to publish the node client as an installable package
- [ ] Quick manual search for "Lodestar" + "crypto" + "token" to check for any existing project already using this exact name in the blockchain space (a light version of what we did for ORCL) before finalizing

---

## 2. Architecture Summary (see full diagram in prior architecture doc — key points repeated here)

```
Node Operators (3-5 to start)
   │ fetch prices from 2-3 independent sources, submit signed price
   ▼
OracleAggregator (median calc, staleness + outlier rejection, circuit breaker)
   │
   ├──► StakingVault (bonding, slashing, rewards) ◄── LODE Token
   │
   └──► PriceFeed (Chainlink-compatible interface) ◄── read by consumer contracts
```

Core contracts:
- **`LodestarToken.sol`** — fixed-supply ERC-20 (LODE)
- **`StakingVault.sol`** — stake/unstake (with withdrawal delay)/slash/reward logic
- **`OracleAggregator.sol`** — median aggregation, staleness checks, circuit breaker
- **`PriceFeed.sol`** — Chainlink `AggregatorV3Interface`-compatible read wrapper

Off-chain:
- **Node operator client** — Dockerized, pulls from multiple sources, submits on a round schedule
- **Public dashboard** — Next.js app reading live contract state

---

## 3. Phase 0 — Research & Design Lock (Day 1-3)

- [ ] Confirm v1 supported assets: recommend BOT/USDT, WBOT/USDT, one more major pair
- [ ] Lock round interval (60-120s recommended)
- [ ] Lock deviation threshold for outlier rejection (e.g. >3% from running median discarded)
- [ ] Lock slashing percentages: accuracy violation (5-10%), liveness/downtime (1-2%)
- [ ] Lock minimum stake per operator (denominated in LODE)
- [ ] Write a one-page spec doc — this is your first real artifact, and doubles as the technical section skeleton for your grant application
- [ ] Confirm your 3-5 initial node operators by name/commitment, not just in theory

**Exit criteria:** written spec you'd show a smart contract auditor without embarrassment.

---

## 4. Phase 1 — Project Scaffolding (Day 3-5)

```bash
mkdir bot-oracle && cd bot-oracle
forge init contracts
cd contracts
forge install OpenZeppelin/openzeppelin-contracts
```

- [ ] Configure `foundry.toml`:
  ```toml
  [rpc_endpoints]
  bot_mainnet = "https://rpc.botchain.ai"
  bot_testnet = "https://rpc.bohr.life"
  ```
- [ ] Contract stubs:
  ```
  src/
    LodestarToken.sol
    StakingVault.sol
    OracleAggregator.sol
    PriceFeed.sol
    interfaces/AggregatorV3Interface.sol
  test/
    LodestarToken.t.sol
    StakingVault.t.sol
    OracleAggregator.t.sol
  ```
- [ ] Root-level repo structure alongside `contracts/`:
  ```
  bot-oracle/
    contracts/        # Foundry project above
    node-client/        # off-chain operator software (Phase 5)
    dashboard/            # Next.js app (Phase 9)
    docs/                   # spec, methodology, node operator guide
    README.md
    LICENSE                 # MIT recommended for an infra/public-good project
  ```
- [ ] Add `.env.example`, `.gitignore` (covering `.env`, `node_modules`, `out/`, `cache/`)
- [ ] Push to GitHub, public, from commit 1

**Exit criteria:** `forge build` compiles cleanly.

---

## 5. Phase 2 — LodestarToken (Day 5-6)

- [ ] Implement fixed-supply OpenZeppelin ERC-20, minted at deploy to a treasury multisig address (not an EOA)
- [ ] Tests: total supply, transfer behavior, confirm no hidden mint function reachable by any single key
- [ ] Deploy to testnet, verify on `scan.bohr.life`

**Exit criteria:** LODE live and verified on testnet.

---

## 6. Phase 3 — StakingVault (Day 6-10) — highest-risk contract, take the most care

- [ ] `stake()`, `unstake()` (7-day withdrawal delay recommended), `isEligibleOperator()`
- [ ] `slash()` — callable only by `OracleAggregator`'s address, itself set through a timelocked admin function, not a raw owner-only setter
- [ ] Reward distribution — start with a fixed per-round emission split among operators who submitted valid data
- [ ] Adversarial tests:
  - Operator tries to unstake immediately post-bad-submission (must be blocked)
  - Non-aggregator address calling `slash()` (must revert)
  - Under-staked operator attempting to submit (must be rejected)
- [ ] Deploy to testnet, verify

**Exit criteria:** full test suite passing, including adversarial cases.

---

## 7. Phase 4 — OracleAggregator (Day 10-14)

- [ ] `submitPrice()` — validates caller is staked/eligible, records submission for current round
- [ ] Round-closing logic — median across valid submissions, outlier rejection beyond threshold
- [ ] `getLatestPrice()`, `getFeedHealth()` view functions
- [ ] Circuit breaker — pause feed if round-over-round deviation exceeds a large threshold (e.g. >20%), require manual resume
- [ ] Tests: median correctness, outlier rejection, staleness handling, circuit breaker triggering
- [ ] Deploy to testnet, verify

**Exit criteria:** aggregator produces correct median prices from simulated multi-operator submissions.

---

## 8. Phase 5 — Node Operator Software (Day 14-18)

```
node-client/
  src/
    fetchers/
      binance.ts
      coingecko.ts
      bdexPool.ts
    aggregator.ts     # local median of this node's own sources
    submitter.ts        # viem-based signed submission
    scheduler.ts
  config/feeds.json
  Dockerfile
  README.md             # "how to run a node" — write for a technical stranger
```

- [ ] Each node pulls from 2-3 independent sources per asset
- [ ] Local median computed before submission
- [ ] Dockerize
- [ ] Get 3+ testnet nodes running continuously for 48+ hours without manual intervention

**Exit criteria:** stable multi-node testnet submissions producing sensible aggregated prices.

---

## 9. Phase 6 — PriceFeed & Chainlink Compatibility (Day 18-19)

- [ ] Implement `latestRoundData()` matching Chainlink's `AggregatorV3Interface`
- [ ] Build a minimal example consumer contract demonstrating integration
- [ ] Confirm an unmodified Chainlink-style consumer can read your feed with zero changes

**Exit criteria:** working example integration, screenshot-ready for the grant application.

---

## 10. Phase 7 — Security Review (Day 19-23) — do not skip or rush this

- [ ] Run Slither and Mythril static analysis, resolve findings
- [ ] Manual review pass: reentrancy, access control, integer edge cases, and specifically confirm you have **not** repeated BOT Chain's own audited centralization flaw (single-key upgrade control)
- [ ] Budget for at least one external Solidity developer review of `StakingVault` and `OracleAggregator`, even if it's a paid freelance review rather than a full audit firm
- [ ] Deploy admin functions behind a timelock + multisig (Gnosis Safe if deployable on BOT Chain, otherwise a minimal custom timelock)
- [ ] Document every known limitation honestly in the README — a differentiator in this ecosystem specifically

**Exit criteria:** static analysis findings resolved/documented, admin functions behind timelock/multisig, at least one external review completed.

---

## 11. Phase 8 — Mainnet Deployment (Day 23-25)

- [ ] Deploy `LodestarToken`, `StakingVault`, `OracleAggregator`, `PriceFeed` to BOT Chain mainnet (chain ID 677)
- [ ] Verify every contract on `scan.botchain.ai`
- [ ] Seed initial liquidity: LODE/USDT and/or LODE/BOT pool on BDEX (small, real amount — this is what gives you a real trading pair, relevant for Option A eligibility later)
- [ ] Get initial node operators staked and submitting on mainnet
- [ ] Publish the Contract Registry (`addresses.ts`) with sourcing comments for every address

**Exit criteria:** live, verified mainnet contracts, real operators submitting continuously.

---

## 12. Phase 9 — Public Dashboard (Day 25-28)

```
dashboard/
  app/
    page.tsx            # live feed values, operator list, slash history
  lib/
    chain/client.ts      # viem client reading your own contracts only
```

- [ ] Next.js app, deployed to Vercel, reading directly from your deployed contracts (much smaller scope than a full-chain monitoring dashboard)
- [ ] Every value shown needs a timestamp + link to `scan.botchain.ai` for independent verification
- [ ] Set up UptimeRobot on the deployed dashboard URL — start accumulating a real uptime track record immediately

**Exit criteria:** public URL showing live, verifiable feed data and node status.

---

## 13. Phase 10 — Documentation (Day 28-30)

- [ ] Full `README.md`: what it is, why it exists (quote BOT Chain's own whitepaper roadmap line on oracle infrastructure), architecture diagram, how to run a node, how to integrate as a consumer
- [ ] `docs/methodology.md`: plain-language explanation of median aggregation, slashing, circuit breaker
- [ ] `docs/node-operator-guide.md`: step-by-step for a third party to run a node
- [ ] `docs/known-limitations.md`: honest disclosure of current decentralization level, node count, and anything not yet hardened

---

## 14. Phase 11 — Grant Application Prep (Day 30-31)

Map directly to the actual application form fields so nothing is missing when you submit:

- [ ] **Project Name:** Lodestar (or "Lodestar Oracle")
- [ ] **Core Highlights:** 2-3 sentences — cite the specific roadmap gap you're closing, the Chainlink-compatible interface, and the staking/slashing security model
- [ ] **Official Channels:** website (dashboard URL doubles as this if no separate site yet), Twitter/X, Telegram/Discord — set these up before submitting, even minimally
- [ ] **Development Stage:** Mainnet Live (by the time you apply, per this timeline)
- [ ] **Whitepaper/Pitch Deck:** write a short one (2-4 pages is fine) — reuse your Phase 0 spec doc and methodology doc as the source material
- [ ] **GitHub Repository URL:** `github.com/bot-oracle` — public, from commit 1, this is a real advantage over much of the existing ecosystem
- [ ] **Demo Video/Testnet Link:** record a short screen-capture walkthrough of the live dashboard + a consumer contract reading a real price
- [ ] **Primary Receiving Wallet Address:** a dedicated multisig, not a personal EOA
- [ ] **On-chain Interaction Records:** screenshot or link showing real staking/submission transactions on `scan.botchain.ai`
- [ ] **Support Tier:** apply under **Option C** first (real on-chain interactions from staking/submissions/consumer integrations), since you won't have CEX listing or major DEX volume yet — Option A/B become realistic later once LODE has real trading activity
- [ ] Read the Anti-Cheating Compliance Notice again before submitting — make sure nothing in your metrics reporting could be construed as inflated (your numbers should already be clean by construction, since staking/slashing are real, not farmable in the way DEX volume is)

---

## 15. Post-Launch Operations Checklist (ongoing, don't skip after "launch")

- [ ] Monitor circuit-breaker and anomaly alerts weekly
- [ ] Track node operator uptime/accuracy, publish it on the dashboard
- [ ] Keep README/methodology docs in sync with any parameter changes
- [ ] Plan a path to decentralize beyond your initial 3-5 operators — publish clear onboarding criteria for new node operators
- [ ] Revisit the security review after any material contract change — a second review post-launch is cheap insurance compared to a post-incident cleanup
- [ ] Consider a lightweight incident response plan: who gets paged if the circuit breaker trips, what the manual-resume process looks like, and how you'll communicate publicly if something goes wrong

---

### Total estimated timeline: ~4.5 weeks solo, ~3 weeks with two people (one on contracts, one on node software + dashboard) working in parallel after Phase 0-1.

### Single most important reminder
This project will hold real staked value and, eventually, be relied on by other contracts. **Phase 7 (security review) is the phase most tempting to rush and the most dangerous to cut.** A short delay there is far cheaper than a bad-data incident or exploit in month one — both for user funds and for your credibility with the grant committee.
