---
id: HITLD-773
title: "Executor profile: removing tiers"
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Remove outright, with a one-time migration: tier becomes the profile, tier_override becomes profile_override, the tier setting goes, hitld work migrate rewrites items that set tier_override, ledger events keep reading old tier fields as history."
answered_at: 2026-11-22T02:44:12.337Z
answered_via: question-tool
answered_by: owner
---

## Question

What happens to tier, tier_override, dispatch.tier1_max_touches and the ledger tier fields?

Nothing outside this repository depends on the old names yet.

## Options and recommendation

- A. Remove outright, with a one-time migration: tier becomes the profile, tier_override becomes profile_override, the tier setting goes, hitld work migrate rewrites items that set tier_override, ledger events keep reading old tier fields as history.
- B. Keep tiers as a deprecated alias for a release: Old names map to a profile with a warning.
- C. Keep tiers as one input among others: Tier stays as a hint.

Recommended: Remove outright, with a one-time migration. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
