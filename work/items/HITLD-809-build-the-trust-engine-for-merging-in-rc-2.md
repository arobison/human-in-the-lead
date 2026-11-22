---
id: HITLD-809
title: Build the trust engine for merging in rc.2
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Yes, put HITLD-553 in rc.2: The engine core and the merging registration are planned into the second clause; no kind unlocks until 15 merges aged 7 days from 8 items."
answered_at: 2026-11-22T05:58:02.729Z
answered_via: question-tool
answered_by: owner
---

## Question

Should the trust engine for merging (path-rule kinds, never-unlock kinds, mechanical verifiability gate) be built in rc.2?

Today merge.mode is owner and only work/ merges without the owner's yes. The design for earning automatic merges is decided (HITLD-472) and unbuilt; HITLD-553 needs the trust engine core HITLD-552.

## Options and recommendation

- A. Yes, put HITLD-553 in rc.2: The engine core and the merging registration are planned into the second clause; no kind unlocks until 15 merges aged 7 days from 8 items.
- B. No, leave it for rc.3: The owner keeps approving every code PR through rc.2.
- C. Not sure, show me the design first: A walk-through before any placement.

Recommended: Yes, put HITLD-553 in rc.2. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
