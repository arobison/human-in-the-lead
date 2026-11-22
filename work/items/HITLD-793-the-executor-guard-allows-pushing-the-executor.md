---
id: HITLD-793
title: The executor guard allows pushing the executor's own claim branch and nothing else
kind: work
state: done
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c1]
claimed_by: D-01M815JQPA5D7X66
---

## Why

Decided by the owner (HITLD-791): once the guard runs in cloud executor sessions (HITLD-792) it denies every executor `git push`, but a cloud executor's work lives only in its own container and the orchestrator cannot reach it, so the guard allows exactly one push: the checked-out `hitld/<item>` claim branch to the project remote. A pushed branch changes nothing on main; it still goes through the merge queue, the checks and the owner's yes. The execute skill wording is HITLD-765.

## Done when

- The executor guard allows `git push` of the checked-out claim branch (a `hitld/<item>` branch whose HEAD holds a claim commit) to the project remote, and denies everything else: main or any other branch, a refspec that names another ref, `--force` and `--force-with-lease`, `--delete`, `--mirror`, `--all`, tags, and a remote other than the project's.
- A test covers the allowed push and each denial, and that the guard fails closed when it cannot tell the branch or the remote.
- The plugin copy matches. A guard change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.
