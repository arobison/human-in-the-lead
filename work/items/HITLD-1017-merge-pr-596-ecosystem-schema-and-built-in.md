---
id: HITLD-1017
title: "Merge PR 596: ecosystem schema and built-in profiles are data in policy.json (HITLD-920)"
kind: decision
state: done
created: 2026-11-24
project: HITLD-15
decider: owner
answer: "A. Merge, file the stem follow-up: Record the yes; orch-11 merges; an rc.2 item adds the stems and refuses RUNNER_ and ZSH_CACHE_DIR."
answered_at: 2026-11-24T05:07:04.827Z
answered_via: question-tool
answered_by: owner
---

## Question

PR 596 (HITLD-920, head 550e0a48): merge it? It changes a public schema, so it needs the owner's own yes. Third read found no blocking defect; checks green. Gap: the cache-variable check is a convention filter; names such as AUTH_CACHE, SESSION_CACHE, RUNNER_TOOL_CACHE and ZSH_CACHE_DIR still pass; nothing exports the variable yet.

Sent back twice to tighten the cache-variable allowlist; the third read confirmed the fixes. A follow-up adds the missing stems before HITLD-925 exports the variable.

## Options and recommendation

- A. Merge, file the stem follow-up: Record the yes; orch-11 merges; an rc.2 item adds the stems and refuses RUNNER_ and ZSH_CACHE_DIR.
- B. Send back for one more round: The executor adds the stems now.
- C. Do not merge: Leave it open.

Recommended: Merge, file the stem follow-up. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
