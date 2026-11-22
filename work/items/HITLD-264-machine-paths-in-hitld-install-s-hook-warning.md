---
id: HITLD-264
title: Machine paths in hitld install's hook warning and status-line command
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
needs: [HITLD-165]
constraint_of: [HITLD-402 c1]
---

## Why

hitld install writes machine paths: the core.hooksPath warning gives an absolute node path, and the status-line command points into the worktree it was installed from.

Reported as GitHub issue #122 (kind bug, sev-3), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: core/lib/install/install.mjs:116 node <absolute hitld.mjs> in the hook line; :329 status line uses an absolute STATUSLINE path

## Done when

- A failing test that reproduces the problem is written first (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `auto-fix-candidate`, area `install`, still present on main, confidence 0.75. Both outputs are deterministic and checkable in a test; the portable form is named. It stays `proposed` until the owner confirms a precedent that allows auto-fix for its area, or commits it to `planned`.

## Decided on 2026-11-20 (HITLD-606)

The owner decided that this item closes when the quota probe (HITLD-165) lands: that item retires the status-line usage capture (decision HITLD-173), so nothing is left to fix here. It needs HITLD-165 and is not built separately.
