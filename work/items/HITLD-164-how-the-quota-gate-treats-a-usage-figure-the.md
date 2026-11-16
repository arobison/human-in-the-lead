---
id: HITLD-164
title: How the quota gate treats a usage figure the owner declares as work runs
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. A low-confidence estimate that ages: A hitld quota declare command records it, only in the owner's own turn. The gate estimates the used share from the figure plus the burn recorded since, and asks the owner for a fresh figure when the estimate nears the reserve or the figure is older than a setting."
answered_at: 2026-11-16T01:16:51.553Z
answered_via: question-tool
answered_by: owner
---

## Question

When the owner declares their usage, how should the quota gate treat that figure as work runs afterward?

In a cloud session there is no status line, so a figure the owner declares is the only reading the quota gate has for a plan limit. Raised for HITLD-149.

Reversibility: two-way.

## Options and recommendation

- A. A low-confidence estimate that ages: A hitld quota declare command records it, only in the owner's own turn. The gate estimates the used share from the figure plus the burn recorded since, and asks the owner for a fresh figure when the estimate nears the reserve or the figure is older than a setting.
- B. A fixed figure until the owner updates it: The gate uses exactly the declared number until another is declared, which goes wrong as soon as work runs.
- C. Stop dispatch when the figure is stale: The gate uses the figure and refuses to dispatch once it is older than a set time, until the owner declares a fresh one.

Recommended: A low-confidence estimate that ages. It keeps the gate honest between the owner's updates without stopping the run when the owner is away.

## Answer

Recorded in the front matter once answered.
