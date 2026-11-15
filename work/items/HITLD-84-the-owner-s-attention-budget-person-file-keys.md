---
id: HITLD-84
title: "The owner's attention budget: person-file keys, delivery now or digest or hold, quiet hours, unanswered defaults, computed urgency"
kind: work
state: planned
created: 2026-11-15
project: HITLD-15
---

## Why

Design part 1.2 makes the owner's attention the scarcest resource, but nothing meters or budgets it. The person file has no keys for it, quiet hours cannot be enforced, whether a question interrupts now or waits is the orchestrator's guess, and "if unanswered by X: B" is shown but never applied.

## Done when

- The person file has `attention` keys (decisions per digest, interruptions per day, quiet hours, how many non-urgent questions at once) with conservative defaults. The person and machine files follow a versioning rule: a reader accepts a `schema_version` at or below its own and refuses a newer one with an upgrade message naming the project; a writer stamps the lowest version that expresses the file's content; `config explain` warns when a project pinned on this machine cannot read the file.
- `hitld rights pending` returns open decisions ordered by cost of delay, the attention budget left, and for each one `deliver: now | digest | hold | default`, computed from the critical path, idle slots and quiet hours, the way the quota gate decides for tokens.
- Due defaults are applied by a sweep, recorded with `answered_via: default`, reversible, and listed in the digest; the orchestrator sets a default on every easy-to-undo question.
- Tests cover each delivery outcome, quiet hours, an applied default and the versioning rule.

