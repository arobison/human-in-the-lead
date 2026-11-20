---
id: HITLD-356
title: Whether an item the owner asks for skips the usage gate
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Skip the gate, warn on reserve: Only that item skips the usage gate; the start prints its expected tokens and warns if the reserve would be reached; the ledger records the request."
answered_at: 2026-11-16T17:39:07.017Z
answered_via: question-tool
answered_by: owner
---

## Question

When the owner asks for an item themselves (by hand), should it skip the autonomous usage gate, with the expected cost shown and a warning if it crosses the reserve?

The gate holds non-critical items even when the owner asks, because by-hand skips only the first-run setup check.

## Options and recommendation

- A. Skip the gate, warn on reserve: Only that item skips the usage gate; the start prints its expected tokens and warns if the reserve would be reached; the ledger records the request.
- B. Keep the gate: Even the owner's own request is refused while the gate holds it.

Recommended: Skip the gate, warn on reserve. The gate is for autonomous dispatch; an owner's request is their own call, with the cost shown.

## Answer

Recorded in the front matter once answered.
