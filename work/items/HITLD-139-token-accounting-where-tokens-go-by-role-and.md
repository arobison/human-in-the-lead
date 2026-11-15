---
id: HITLD-139
title: "Token accounting: where tokens go by role and activity, with trends, as feedback for token efficiency"
kind: work
state: proposed
created: 2026-11-15
project: HITLD-15
---

## Why

The ledger records tokens per completed dispatch (`tokens`, `tokens_before_first_edit`, `estimate_tokens`), but nothing shows where a project's tokens go as a whole: building, reviewing, fixing after a failed verification, orchestration, the chief of staff's talk with the owner, hand-overs, briefs and reports. Without that split and its trend, token efficiency cannot be tuned, and changes to briefs, tiers or cadence cannot be judged by what they cost. The owner asked for this after v0.1.0-rc.1.

## Done when

- Every dispatch completion records its role and activity (build, review, fix, research, curator, orchestrate, chief of staff), and the orchestrator and chief of staff record their own sessions' usage at each checkpoint and hand-over, where the harness reports it. Usage the harness does not report is counted as unknown, never guessed.
- `hitld metrics tokens [--since <date>] [--by role|activity|area|model] [--json]` shows the totals and shares, the rework share (tokens spent on items that failed verification and were fixed), the overhead share (orchestration, briefs, reports and hand-overs against building), and tokens per merged item, with their trend over time.
- The data contract (`hitld dashboard --json`) gains a `tokens` section, and `dashboard.html` shows the shares and their trend in one small panel.
- The shares feed the learned state (HITLD-112): a rising overhead or rework share is a finding in the digest, with the change that most likely caused it, for the owner to act on.
- Design parts 11 and 12 describe the records, the command and the panel.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Not a need of v0.1.0. What the harness reports limits the split: a completion notice gives one total per subagent, so the activity is known from the dispatch, not from inside a session. Shares within a session (reading, editing, talking) need the harness to report usage by turn, and are out of scope until it does.
