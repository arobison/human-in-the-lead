---
id: HITLD-280
title: "Dispatch complete takes the whole parenthetical after commit: as the branch name"
kind: work
state: in-progress
created: 2026-11-16
project: HITLD-15
claimed_by: D-01M80FZPB9ANGFJG
release_note: "`hitld dispatch complete` asks for the report again, under `report_errors`, when the commit line's branch is not a valid branch name (a note written inside the parenthetical) or, with the local merge queue, is not a branch in the repository; notes about the branch go under `deviations`."
---

## Why

dispatch complete takes everything inside the commit line's parentheses as the branch name, records it in the verified event, and merge then rejects it as missing.

Reported as GitHub issue #150 (kind bug, sev-2), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: core/lib/contract/report.mjs:81 regex takes [^)]+ as branch; orchestrator.mjs:1350 records it unchecked

## Done when

- A failing test that reproduces the problem is written first (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `auto-fix-candidate`, area `dispatch`, still present on main, confidence 0.85. Exact report line and regex given; a parser test reproduces it. It stays `proposed` until the owner confirms a precedent that allows auto-fix for its area, or commits it to `planned`.

## Promoted on 2026-11-22 (HITLD-736)

The owner put the rc.2 bug list in HITLD-67 (HITLD-736): this item is planned and a constraint of its second clause, because the merge rejects the verified entry. This is GitHub issue 430, the same report as the issue named above. The tracker lets one item serve several milestones, so it also stays a constraint of HITLD-404 (clause c1).
