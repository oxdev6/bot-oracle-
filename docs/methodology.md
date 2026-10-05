# Methodology

Plain-language explanation of the mechanisms that keep Lodestar prices honest.

## Median, not mean

A single bad operator can't move the final price because the round price is the
**median of all accepted submissions**. To break the median you need to control
more than half of the honest submissions — which is exactly what staking makes
expensive. A mean would let one absurd number drag every price.

## Outlier rejection

Each submission is compared against the live reference price. If it deviates by
more than **3%** (`DEVIATION_THRESHOLD_BPS = 300`) it is rejected at the door.

At round close the process repeats one level up: the raw median of the round's
submissions is computed, and any submission more than 3% away from *that* is
excluded before the final median is taken. Outlier rejection therefore happens
both per-submission (against the last confirmed price) and at close (against the
round's own center), so a coordinated mini-cartel can't inject a skewed value
through sheer volume.

The reference is only allowed to veto when it is reasonably fresh. If the last
round is older than `STALE_AFTER` (1h), a new submission is accepted even if it
disagrees with the stale reference — otherwise the feed could lock up
permanently right when it's most needed (a volatile moment is precisely when
the old price is worst).

## Circuit breaker

If a closed round's price moves more than **20%** from the previous round, the
feed pauses (`_pause`). Consumer contracts see `isPaused` and can decide how to
act; no one can quietly re-enable it. Resumption is a timelocked admin action
performed only after a human reviews the cause. This bounds worst-case damage
from an oracle attack or a catastrophic data incident: prices can never be
"soft-adjusted" silently — they stop, loudly.

## Staking and slashing

Operators post a minimum stake (`1000 LODE`) that sits in `StakingVault`.
The stake does three jobs:

1. **Access control** — only staked, non-withdrawing accounts may submit.
2. **Bond** — if the aggregator detects a violation it slashes; the operator's
   own money is at risk, not just reputation.
3. **Skin-in-the-game cutoff** — operators exiting must wait **7 days** before
   their LODE is released, and a pending-withdrawal operator is immediately
   ineligible to keep submitting.

`slash()` is callable only by the aggregator address (itself owned by the
timelock), and it cancels pending withdrawals **newest-first** before touching
live stake, so resignation can't beat punishment. Slash proceeds go to a
dedicated `slashingTreasury`, separate from the reward pool and the admin.

## Rewards

Each closed round pays out a fixed emission (`10 LODE`) split equally among
operators whose submissions survived clean-outlier rejection. Rewards are paid
out of the reward pool, which is funded at deploy and can be topped up through
the timelock. Operators who were filtered out, pause a feed, or spam an
unregistered pair earn nothing — correctness is the only thing that pays.

## Why the timelock

Every sensitive parameter (min stake, thresholds, resuming a paused feed,
changing the aggregator wired into the vault) is owned by `TimelockController`
with a **48-hour delay**. Queue it today; anyone can see it; it executes at most
tomorrow. That gives users a public window to react to malicious or mistaken
admin actions — the single-key upgrade flaw that hurt BOT Chain's own audited
centralization is deliberately not repeated here.