---
id: HITLD-8
title: Decision rights with precedent and judgement priors (piece e)
kind: work
status: Done
created: 2026-11-14
project: HITLD-2
---

## Why

Part of the slice usable in a consuming project.

## Done when

- Rights rules in `policy.json` and `hitld rights` decide whether a call is the owner's.
- A call that is the owner's becomes a decision item in the stand-alone question format, with the precedent offer.
- A precedent is created only with the decider's confirmation, is matched on later calls, and its applications are listed in digests.
- An overrule is recorded against the precedent. The owner's judgements are recorded on signals.
- The escalation and precedent-matching scenarios (rule positives, negatives, near misses, pairs) pass offline.
