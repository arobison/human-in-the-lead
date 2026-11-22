---
id: HITLD-709
title: How long a recorded store pull stays fresh enough to read the store's settings
kind: decision
state: planned
created: 2026-11-22
project: HITLD-15
decider: owner
---

## Question

How long should a recorded store pull count as fresh enough to read the settings in the store?

A session reads the settings copy in the project's store only after a pull that reached the remote, and only while that record is no more than 24 hours old (`MAX_AGE_HOURS` in `core/lib/store/last-pull.mjs`; design 13.4, HITLD-148). Past that age the copy is not used and the session runs on conservative defaults and says why (HITLD-163). A long run in one container can pass 24 hours between pulls, and a changed cap can wait up to a day to reach a session that does not pull. Reversibility: two-way.

## Options and recommendation

- A. Keep 24 hours: The constant stays, and a run that needs to go past it pulls the store.
- B. A shorter life, for example 4 hours: A changed cap reaches a running session sooner, and a session that does not pull falls back to defaults sooner.
- C. A project setting: The owner sets the life per project in the store policy, with 24 hours as the default.
- D. No age limit: Only a pull in this session that reached the remote at the address in use counts.

Recommended: A. Nothing recorded shows a stale copy read or an early refusal, and the number sits in one place; revisit it with evidence from a run.

## Answer

Open.
