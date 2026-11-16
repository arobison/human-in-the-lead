---
id: HITLD-310
title: "Delegated merges: decision answers are checked"
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Check answers against rights answer: A delegated merge refuses when a changed decision answer does not match what rights answer recorded."
answered_at: 2026-11-16T06:18:06.187Z
answered_via: question-tool
answered_by: owner
---

## Question

A work/-only PR can write an answer into a decision item and merge without asking. How should it be guarded?

PR #207 (HITLD-150): merge authority holds on the pull request path.

## Options and recommendation

- A. Check answers against rights answer: A delegated merge refuses when a changed decision answer does not match what rights answer recorded.
- B. Decision items wait for the owner: Any PR touching a decision item waits.
- C. Leave it: Rely on review.

Recommended: Check answers against rights answer. Keeps tracker-only merges automatic without allowing a forged answer.

## Answer

Recorded in the front matter once answered.
