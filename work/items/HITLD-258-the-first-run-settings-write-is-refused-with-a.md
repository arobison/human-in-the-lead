---
id: HITLD-258
title: The first-run settings write is refused with a misleading reason
kind: work
state: done
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-67 c1, HITLD-402 c3]
claimed_by: D-01M81644XG5J7PF4
release_note: `hitld config write` and `hitld machine detect --write` refused from a linked worktree now say to run the setup from the primary checkout or outside any repository, instead of calling the person an executor. A refusal for a settings file inside a managed project names the `.human-in-the-lead` entry that marks it, what it holds, and how to fix it.
---

## Why

config write refusals mislead: a stray ~/.human-in-the-lead makes home look like a managed project, and a worktree run is told executors never write settings.

Reported as GitHub issue #115 (kind bug, sev-3), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: core/lib/settings/files.mjs:364 "executors never write settings" and :371 "settings files never live in a managed project", unchanged

## Done when

- A failing test that reproduces the problem is written first (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `auto-fix-candidate`, area `setup`, still present on main, confidence 0.75. Both cases have clear steps and the exact refusal text; message changes are testable. It stays `proposed` until the owner confirms a precedent that allows auto-fix for its area, or commits it to `planned`.

## Promoted on 2026-11-22

Promoted to rc.2 on the owner's decision (2026-11-22).
