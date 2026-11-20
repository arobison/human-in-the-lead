---
id: HITLD-386
title: The tracker check run reads in_progress after it has succeeded, on some pull requests
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Done when




- The cause is found and written in this item: why the `tracker` job's check run keeps `status: in_progress` while its `conclusion` is `success` and its `completed_at` is set, on some pull requests and not others. Candidates, none verified: a GitHub API reporting lag; the job being re-run or re-queued by another event; the `check` job's `needs` handling; a workflow concurrency setting.
- The merge routine (the chief of staff's tracker-only merge, `hitld merge`, and the orchestrate skill) says what to do when one check run reads `in_progress` with a success conclusion, so it neither merges on a half-read state nor waits forever: for example, read the check suite's own `status`, or re-read the check run once after a short wait.
- If the cause is in this repository's workflow, it is fixed there. `npm run check` and `hitld work check` pass.

## Why

Seen by the chief of staff on 2026-11-16 on two tracker-only pull requests (the records of HITLD-353 and 354, and of HITLD-385): the nine other checks were `completed` with `success`, GitHub reported the check suite complete and the pull request clean, and the `tracker` check run showed `in_progress` with a `success` conclusion and a completion time seconds after it started. It did not clear on a second read. The chief of staff merged both on the evidence of the suite and the other nine checks; the pull request's own tracker check had passed. The merge rule (every check `completed` and `success`) cannot be applied literally to such a state.

## Notes

Evidence to start from: the check run on PR #240 (HITLD-353 and 354), run ID 133484913298 (started 2026-11-16T17:36:29Z, completed 17:36:35Z, status `in_progress`, conclusion `success`), and the same on PR #246 (HITLD-385). Related: HITLD-131 (faster checks in CI).

Evidence added 2026-11-16 (third sighting, by the chief of staff): on PR #250 (HITLD-410 to 413), head a0e69b9, the `dco` and `public` check runs read `in_progress` with a `success` conclusion some seconds after the other checks completed, not the `tracker` job. So it is not specific to the `tracker` job. A re-read about a minute later still showed two such runs. PRs #244, #245, #247 and #248 had all ten checks `completed` on first read.
