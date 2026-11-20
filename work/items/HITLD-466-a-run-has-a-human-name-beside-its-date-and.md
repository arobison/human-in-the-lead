---
id: HITLD-466
title: A run has a human name beside its date-and-number ID, proposed by the chief of staff and renameable
kind: work
state: dropped
reason: "Dropped by the owner on 2026-11-19 (reconciliation, HITLD-573): there is no run to name once the run object is removed (HITLD-470, 484 to 490)."
created: 2026-11-17
project: HITLD-15
---

## Done when

- A run has a `name` beside its ID. The ID (`<date>-<n>`, from `defaultRunId` in `core/lib/run/run.mjs`) stays the stable key: the `run` field on ledger events and the event IDs that embed it do not change, and an older run with no name reads as its ID. The name is plain text, one line, with no character the ID's uses forbid, because it is never used as a key.
- The name is written on the run's `run-started` event when one is given at start (`--name`), and `hitld run rename <run> <name>` changes it with a new ledger event, read in place of the earlier one, so the ledger is never rewritten.
- The default is derived, not random: the release stage and the focus the run serves (for example "rc.3 token fixes"). The chief of staff proposes it when a run starts, from the plan and the owner's stated order, and the owner can change it. When nothing gives a focus, the name is the ID and nothing is invented.
- Every place a person reads a run shows the name first and the ID second: `hitld run status`, the digest, the dashboard's in-flight and spend views, the orchestrator's messages, and the chief of staff's report to the owner. A test covers a named, a renamed and an unnamed run in each of those.
- The ledger schema gains one additive optional field (no version bump), and a release note says so.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

A run is told apart today only by `<date>-<n>`, such as 2026-11-16-1. The owner said on 2026-11-17 that runs need better names than a date string; the date says when, not what. The owner chose (HITLD-467) a derived focus name that can be renamed, over an owner-given name only, a release-stage counter, or random words. Keeping the ID as the key avoids a ledger migration.

## Notes

Design: a new ledger field and a new public command; touches `docs/design/0001-human-in-the-lead/` 05-execution.md (the ledger fields), 13-operations.md (the run) and 16-packaging.md (the command). Code, schema and design: the owner's own yes to merge. Related: HITLD-405 c2 (no bare number without what it names).

## Reshape needed (2026-11-18)

The owner decided in HITLD-470 (HITLD-484 to HITLD-490) that there is no run object, so "a run has a name" no longer has a run to name. What a person reads now are orchestrator sessions and the dispatches and events they write (display numbers assigned at ingest, HITLD-489). This item moves to `proposed` until it is reshaped to cover those: a human name for an orchestrator session (proposed by the chief of staff, derived from the focus it serves, renameable) and for a dispatch where a bare ID would not tell the owner what it is. The derived-name choice (HITLD-467) stands.

