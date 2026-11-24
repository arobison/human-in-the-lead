---
id: HITLD-1026
title: A detached executor in a Claude Code cloud session starts on the session's own sign-in (PR 620, HITLD-880)
kind: decision
state: done
created: 2026-11-24
project: HITLD-15
decider: owner
answer: "A. Accept the cloud session's own sign-in: When CLAUDE_CODE_REMOTE is set the launcher starts the executor and reports credential kind cloud-session; a run that loses the credential mid-run is recorded blocked."
answered_at: 2026-11-24T14:54:36.497Z
answered_via: question-tool
answered_by: owner
---

## Question

How should the launcher treat a Claude Code cloud session, which sets none of the six credential variables it accepts?

The executor tested it: in a cloud session with none of the six variables set, a child claude -p authenticates (exit 0). Today's launcher refuses every detached executor there. This is a security-rule call.

## Options and recommendation

- A. Accept the cloud session's own sign-in: When CLAUDE_CODE_REMOTE is set the launcher starts the executor and reports credential kind cloud-session; a run that loses the credential mid-run is recorded blocked.
- B. Only with an owner opt-out setting: Cloud sessions are refused unless the owner sets an explicit opt-out.
- C. Keep refusing in cloud sessions: Detached executors need one of the six variables set by hand; cloud dispatch stays refused.

Recommended: Accept the cloud session's own sign-in. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
