---
id: HITLD-951
title: Local executors run in a separate OS user or sandbox, for any provider or local model
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. A separate OS user or sandbox with only the executor token: Provider-agnostic; each executor gets only its own provider key."
answered_at: 2026-11-22T21:26:46.258Z
answered_via: question-tool
answered_by: owner
---

## Question

What do local executors run as (forge decision 8 of 8)?

Without a separate identity the forge protections bind only cloud executors. The owner asked whether it supports other providers and local inference; the boundary is provider-agnostic, and the Claude hook guard does not cover other harnesses.

## Options and recommendation

- A. A separate OS user or sandbox with only the executor token: Provider-agnostic; each executor gets only its own provider key.
- B. Cloud executors only: Simplest; loses local runs.
- C. Keep local executors as the owner's user: Forge rules do nothing against local executors.

Recommended: A separate OS user or sandbox with only the executor token. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
