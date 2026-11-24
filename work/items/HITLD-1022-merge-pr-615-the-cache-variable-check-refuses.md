---
id: HITLD-1022
title: "Merge PR 615: the cache-variable check refuses credential, session and shell-startup names (HITLD-1019)"
kind: decision
state: done
created: 2026-11-24
project: HITLD-15
decider: owner
answer: "A. Approve: Merge PR 615 at head b867b756."
answered_at: 2026-11-24T06:44:16.616Z
answered_via: question-tool
answered_by: owner
---

## Question

PR 615 (HITLD-1019) makes the ecosystem cache-variable check refuse credential, session, shell-startup and runner-variable names, and rewrites the description text of two public schema files. Approve the merge?

Independent read-only review found no blocking problem: schema patterns unchanged, the 10 built-in cache variables all pass, mutation tests bite. It is a convention filter, not a security boundary; substring matching can refuse names such as BYPASS_CACHE.

## Options and recommendation

- A. Approve: Merge PR 615 at head b867b756.
- B. Send back: Hold it and ask for a change to the stem-word matching.

Recommended: Approve. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
