---
id: HITLD-771
title: "Executor profile: runtime, provider and data boundary"
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Yes: runtime, provider and data boundary are profile dimensions: Rungs are (runtime, provider, model, effort) entries declared in policy, ordered by cost, each declaring its data boundary and guard enforcement; an item's classification limits the rungs it may use; a runtime that cannot enforce what the work needs is refused. Only the Claude Code adapter is built now."
answered_at: 2026-11-22T02:44:04.968Z
answered_via: question-tool
answered_by: owner
---

## Question

Do runtime, provider and data boundary become part of the executor profile, with cascade rungs drawn from a policy catalog?

The owner wants to send executors to other harnesses, models, APIs and local inference.

## Options and recommendation

- A. Yes: runtime, provider and data boundary are profile dimensions: Rungs are (runtime, provider, model, effort) entries declared in policy, ordered by cost, each declaring its data boundary and guard enforcement; an item's classification limits the rungs it may use; a runtime that cannot enforce what the work needs is refused. Only the Claude Code adapter is built now.
- B. Models only, one runtime for now: Rungs vary model and effort inside Claude Code.
- C. Yes, and build a second adapter in rc.2: Proves the interface.

Recommended: Yes: runtime, provider and data boundary are profile dimensions. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
