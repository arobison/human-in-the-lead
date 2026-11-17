---
id: HITLD-454
title: The orchestrate skill tells the orchestrator to complete an interactive dispatch with --session-record
kind: work
state: in-progress
created: 2026-11-16
project: HITLD-15
claimed_by: D-38
---

## Done when

- `skills/orchestrate/SKILL.md` step 4.1 says: for a tier-3 interactive session, save its result events (`list_events`, kind result, every page) to a file and give `--session-record <file>`; use `--tokens` only when no record is available, and never the executor's own figure. The plugin copy of the skill matches.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

HITLD-438 (merged) added `--session-record`, so an interactive completion's tokens and cost are read from the harness's record instead of typed. The skill still tells the orchestrator to type `--tokens` from the notification, which is the guess HITLD-436 and HITLD-438 were meant to retire. The owner decided the wording on 2026-11-16 (HITLD-456).

## Notes

A skill change: needs the owner's own yes to merge. Orch-3 already completes interactive dispatches with `--session-record` from the owner's HITLD-438 merge; this makes the skill say so. Queued behind HITLD-450, per the order the owner set (HITLD-440).
