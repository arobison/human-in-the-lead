---
id: HITLD-314
title: dispatch follow-up refuses an interactive tier-3 dispatch, so a cloud run has no recorded way to send an executor more work
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Why

Found by the orchestrator in a cloud run (verified by it with the command below, not by the chief of staff). `hitld dispatch follow-up --dispatch D-22 --message "..."` is refused with error `failed`: "a headless follow-up needs the earlier run session ID, its worktree, the message file and a result file". The command only knows headless runs. An interactive tier-3 dispatch, the only kind this run has used, has none of those. So the orchestrate skill's follow-up path (step 5) cannot be used in a cloud run: the chief of staff relays the message by hand, and the ledger records nothing, so the dispatch looks finished while the executor keeps working.

Repro: start any interactive dispatch, then run `hitld dispatch follow-up --dispatch D-<n> --message x`.

## Done when

- `dispatch follow-up` works for an interactive dispatch: it records the follow-up on the ledger (a new dispatch ID on the same agent, as for a headless one) and does not need a worktree or result file, or it says plainly which dispatch kinds it supports and the skill says what to do for the others.
- A test covers an interactive dispatch.
- `npm run check` and `hitld work check` pass.


Evidence added 2026-11-16 (second sighting, by the chief of staff, from the orchestrator's report on D-30, HITLD-151): after the executor reported `blocked` and the owner then decided the item's direction (HITLD-416), `dispatch follow-up` could not carry the decision to the interactive executor, so the orchestrator messaged the executor's session directly. The continuation worked, but it has no dispatch ID of its own: `dispatch complete --dispatch D-30` with the new `done` report returned `already: true` and echoed the earlier `blocked` event, so the second report was not recorded, `hitld merge` found nothing to queue, and no `verified` pass exists for the final commit. The pull request had to be opened by hand. So the gap has two parts: no recorded follow-up for an interactive dispatch, and a dispatch's completion can be recorded only once, so a re-opened dispatch cannot report again. The first sighting was D-24 (HITLD-152), where the owner's design questions also had to reach an interactive executor by hand.
