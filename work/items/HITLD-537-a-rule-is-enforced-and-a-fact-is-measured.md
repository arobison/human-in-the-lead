---
id: HITLD-537
title: A rule is enforced and a fact is measured; briefs keep only judgment
kind: decision
state: done
created: 2026-11-19
project: HITLD-15
decider: owner
answer: "A. Enforce or measure it, briefs keep only judgment: A rule an executor could break by accident is enforced by a hook or a scrubbed environment; a fact comes from an independent source (CI for tests, git for what changed, the session record for tokens and what was read); a brief keeps only the purpose and the judgment calls"
answered_at: 2026-11-19T23:18:17.264Z
answered_via: question-tool
answered_by: owner
---

## Question

Should every rule and fact an executor handles be enforced by structure or measured, as tokens already are?

HITLD-493: briefs tell executors what not to print or merge, and executors self-report facts such as tests passing or what they read; HITLD-438 moved tokens to measure-don't-ask and HITLD-464 is the first fix for secrets.

## Options and recommendation

- A. Enforce or measure it, briefs keep only judgment: A rule an executor could break by accident is enforced by a hook or a scrubbed environment; a fact comes from an independent source (CI for tests, git for what changed, the session record for tokens and what was read); a brief keeps only the purpose and the judgment calls
- B. Only the security-sensitive ones: Secrets and merge rights by structure, the rest as text and self-report
- C. Keep briefs as they are: Prose rules and self-reports stay

Recommended: Enforce or measure it, briefs keep only judgment. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
