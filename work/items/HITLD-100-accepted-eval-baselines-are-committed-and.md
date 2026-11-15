---
id: HITLD-100
title: "Accepted eval baselines are committed, and CI gates on them"
kind: work
state: planned
created: 2026-11-15
project: HITLD-15
---

## Why

The owner-accepted eval baseline lives in the private store of the machine that accepted it. CI's release job has no private store, so its eval gate runs with no baseline and checks only the category floors, not regressions against what the owner accepted. Design 16.5 says the first release is gated on the offline suite passing against the owner-accepted baseline. A baseline in a cloud session is also lost when the container ends. Offline baselines hold scenario IDs, scores and token counts, nothing confidential, so they can live in the repository, where accepting one is a reviewable commit. The owner decided this lands before v0.1.0-rc.1.

## Done when

- `hitld eval accept` (and `--accept-baseline`) writes the accepted offline baseline to `evals/baselines/` in the primary checkout, keyed as today (settings and seed), for the owner to commit; the private store keeps a copy. Accepting stays the owner's decision and is refused to executors, as today.
- The committed baseline holds nothing machine-specific or confidential: no paths, hostnames, account names or private-store content. A test fails if a baseline carries any.
- The gate reads the committed baseline first and the private store's second, and says which it used. The baseline key is the same on a laptop, in a cloud session and in CI for the same commit and seed.
- The release workflow's eval step and the CI check fail when no committed baseline matches, instead of passing on floors alone; a scenario the baseline has not seen is still a note, not a failure.
- This repository commits the baseline the owner accepted after HITLD-82 (re-run on the final rc.1 main and accepted by the orchestrator under the owner's standing delegation).
- `npm run check`, the offline eval gate and `hitld work check` pass.
