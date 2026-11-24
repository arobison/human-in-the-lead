---
id: HITLD-494
title: A new merge presentation that replaces one with a recorded approval says so, carries the approval over for unchanged branches, and refuses a stale approval loudly
kind: work
state: proposed
created: 2026-11-18
project: HITLD-15
constraint_of: [HITLD-404 c2]
---

## Done when

- When a new merge presentation replaces one that has a recorded approval, `hitld merge` says so: which approval it voided, for which branches, and why. It carries the approval over for any branch whose tested commit is unchanged and presents only what is new, or says plainly why it cannot.
- Applying an approval that no longer matches refuses loudly (`approval-stale`, naming the presentation it was for), never a silent no-op.
- The orchestrate skill says not to run `hitld merge` on new branches while an approval is waiting to be applied: apply it first, then check the next branch.
- A test covers an approval recorded for one presentation, a second presentation made before it is applied, and the carry-over or the refusal. `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Reported in GitHub issue #297 (feedback from the self-hosted run, v0.1.0-rc.1). `hitld merge approve --all` returned `ok`, then the orchestrator checked a second branch with `hitld merge`, which made a new presentation of both; applying the approval then merged nothing and said nothing, because the approval was bound to the first presentation. The owner had to answer the same branch again. Binding an approval to what the owner saw is right; voiding it silently cost a round trip, and an approval that looks recorded and then does nothing is easy to miss.

## Notes

Triaged 2026-11-18 (design part 2.2): one proposed item for one cause. Related: #202 (HITLD-496), #295 (HITLD-495). These paths belong to owner merge mode as built for rc.1; the self-hosted cloud run merges through GitHub pull requests (HITLD-133), so check first which of the failures the pull-request path still has. Code and skill: the owner's own yes to merge.

Added 2026-11-24 from GitHub issue 630 (closed as a duplicate of 297): a refusal as stale that lists no moved branches must say why; and when the verified work sits on a branch hitld does not track (a harness-named branch), the refusal must say that plainly, not report the approval as stale with an empty list or drop it with no message. I met the silent drop myself on this repository's queue: an approval recorded against an older presentation did nothing until it was re-recorded against the current one.
