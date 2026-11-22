---
id: HITLD-740
title: The executor guard allows hitld rights who and hitld precedent match
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
---

## Why

Reported as GitHub issue 432. The executor contract requires an executor to run `hitld rights who` and `hitld precedent match` before it lists a question (HITLD-87). The guard hook's allowlist of executor commands (`EXECUTOR_HITLD` in core/harness/claude-code/hooks/guard.mjs) lacks both, so the guard denies them and the executor either asks the question it should have settled or goes without the check.

## Done when

- `EXECUTOR_HITLD` allows `rights who` and `precedent match`, and still denies every other `rights` and `precedent` subcommand (a write such as `rights record` or `precedent add` stays denied to an executor).
- The plugin copy of the guard matches.
- A test covers the two allowed commands and a denied neighbor of each. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

The guard is a security control: review the change as security-sensitive. The other refusal in issue 432, `git branch -m`, comes from the harness's own permission layer and not from the guard; it is recorded in HITLD-279 and gets no item of its own. Related: HITLD-87. Code: the owner's own yes to merge.
