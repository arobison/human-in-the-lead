---
id: HITLD-1030
title: "Review nits from PRs 614, 616, 618, 620 and 622 are cleaned up: stale comments, one unreachable branch, one misleading label, missing tests"
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-67 c?]
---

## Done when



- `core/lib/store/store.mjs`: the comment on the list walk about symlinks is accurate (or removed), the unreachable `prefix.startsWith(sub)` branch near line 130 is removed, and the store list test covers a `.tmp` entry and the sort order (nits from PR 614, HITLD-1010).
- `core/lib/quota/gate.mjs` lines 9-10: the stale comment is corrected. `core/lib/contract/report.mjs` (the quota report near line 197): the "Stopped at the reserve" label no longer reads as stopped when the gate is not stopped; the reason string says what to do about it. Tests cover `limits: []`, two unread limits and a hard unread limit (nits from PR 618, HITLD-936).
- From PR 622 (HITLD-821): an early approval dropped because `needs_rejected` expired an unrelated sound branch's approval does not happen (only the rejected branch's is dropped), and `approved_ahead.expired` is also written to the ledger so the owner can see why they must re-approve.
- From PR 620 (HITLD-880): the `ownerOnly` open of the executor's result and error files (`core/harness/claude-code/launch.mjs`) refuses a symlink; the shell-tracing variables (`SHELLOPTS`, `BASH_XTRACEFD`, `PS4`) are stripped from the child environment on the cloud-session and env-credential paths too, not only the stored-token path; the redactor's 256-character hold-back in `core/lib/env/secrets.mjs` applies only to callers that have secrets; `isOn` in `credential.mjs` and `cloudSession` in `store/reach.mjs` are one function; a blocked completion for a lost credential carries a `reason` (the ledger's reason enum has none for credentials, so adding one is a schema change: split it into its own item).
- From PR 616 (HITLD-838): tests cover a lockstep group sharing one release item and a train; `03-data-model.md` says `released_in` is set only by a full release's record.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Independent reviews of PRs 614, 616, 618, 620 and 622 each found non-blocking points that were left for a later item. [Certain: each comes from the reviewer's report on that pull request.]

## Notes

rc.2 or later. Ordinary code; no guard, policy, rights, skill, design-rule, public-schema or release-path file is meant to change; if one of the points turns out to need such a change, split it into its own item.
