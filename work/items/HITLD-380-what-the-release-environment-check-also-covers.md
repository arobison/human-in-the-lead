---
id: HITLD-380
title: What the release environment check also covers
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Both: Refuse on admin bypass and on a missing main-only deployment rule; tests, CONTRIBUTING and design 16.5 follow."
answered_at: 2026-11-16T18:41:15.010Z
answered_via: question-tool
answered_by: owner
---

## Question

Should the Release workflow's environment check also refuse when administrators can bypass the reviewer rule, and when the environment is not limited to deployments from main?

HITLD-140's check covers only the required reviewer; a release is a one-way door.

## Options and recommendation

- A. Both: Refuse on admin bypass and on a missing main-only deployment rule; tests, CONTRIBUTING and design 16.5 follow.
- B. Admin bypass only: Only the bypass is checked.
- C. Neither: The check stays reviewer-only.

Recommended: Both. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
