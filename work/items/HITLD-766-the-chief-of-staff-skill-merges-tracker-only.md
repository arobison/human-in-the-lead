---
id: HITLD-766
title: The chief-of-staff skill merges tracker-only pull requests as soon as they are green, whatever the merge queue is doing
kind: work
state: done
created: 2026-11-22
project: HITLD-15
claimed_by: D-01M80WW60E08SE52
---

## Why

The owner's rule is that tracker-only changes (files under `work/`) are merged out of band from the merge queue, by the chief of staff, as soon as they are green. In the first self-hosting run the chief of staff held tracker merges while the queue was mid-batch, so tracker pull requests waited, grew conflicts on the milestone file and delayed the owner's decisions. The chief-of-staff skill does not say how tracker-only pull requests are merged or that they never wait for the queue.

## Done when

- The chief-of-staff skill says a tracker-only pull request (every changed file under `work/`) is merged by the chief of staff as soon as its checks are green and its files and head SHA are verified, whatever the merge queue is doing; the queue brings its own branches up to date afterwards.
- It says how: squash merge with the chief-of-staff trailers and the owner's sign-off, and when a milestone file conflicts, merge main into the pull request's branch (never rebase or force-push), keep both sides, run `hitld work check`, push and merge.
- It says a code, skill, schema, design or policy pull request still goes through the queue and needs the owner's own yes.
- A skill change reaches main only with the owner's own yes. `hitld work check` and the offline eval gate pass.
