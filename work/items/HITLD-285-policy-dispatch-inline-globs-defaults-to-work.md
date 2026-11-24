---
id: HITLD-285
title: Policy dispatch.inline_globs defaults to work/** and ignores tracker.json's work_dir
kind: work
state: done
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-67 c2, HITLD-403 c4]
claimed_by: D-01M87PRM5ZXXVCTD
release_note: "The tracker's own folder (tracker.json `work_dir`) is always an inline path: an item that touches only tracker files runs inline, and a branch's claim and close edits are no longer reported outside its touches. `dispatch.inline_globs` now defaults to an empty list, was `work/**`."
---

## Why

policy dispatch.inline_globs defaults to work/** and ignores tracker.json work_dir, so tracker-only items never size tier 0 and every branch gets a false outside-touches deviation.

Reported as GitHub issue #156 (kind bug, sev-3), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: schemas/policy/dispatch.schema.json:10 default ["work/**"]; core/lib/merge/owner.mjs:215 and sizing.mjs:79 read only inline_globs

## Done when

- A failing test that reproduces the problem is written first (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `auto-fix-candidate`, area `dispatch`, still present on main, confidence 0.8. A project with work_dir other than work shows it; the default or evidenceFor fix is testable. It stays `proposed` until the owner confirms a precedent that allows auto-fix for its area, or commits it to `planned`.

## Note on 2026-11-20 (HITLD-581)

Discrete tiers are being replaced by an execution mode, a cost-ordered cascade and a measured budget (HITLD-561). This item stays an independent small fix of a default; where it says "tier", read the profile that replaces it.

## Promoted on 2026-11-22

Promoted to rc.2 on the owner's decision (2026-11-22).
