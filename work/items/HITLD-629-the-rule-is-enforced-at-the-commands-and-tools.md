---
id: HITLD-629
title: The rule is enforced at the commands and tools that return data
kind: decision
state: done
created: 2026-11-20
project: HITLD-15
decider: owner
answer: At the commands and tools that return data (Recommended)
answered_at: 2026-11-20T03:42:37.814Z
answered_via: question-tool
answered_by: owner
---

## Question

Where is the classification rule enforced, given HITLD controls only what tools and commands return to a session, not what a harness sends to its model?

HITLD-620: labels plus channel clearances (HITLD-625); a session must not receive data its model is not cleared for.

## Options and recommendation

- A. At the commands and tools that return data: HITLD commands, dyno's result commands and a hook on file reads check the label against the clearance of the session's model before returning labeled data and fail closed; the public-text check stays
- B. Tell agents in the brief and trust them: The brief states the rule
- C. Wait for a harness-level hook: Enforce at the harness's prompt boundary once one exists

Recommended: At the commands and tools that return data. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
