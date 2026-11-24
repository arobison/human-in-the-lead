---
id: HITLD-284
title: A failed fast check's output is dropped, and the follow-up blames the branch
kind: work
state: in-progress
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-67 c2, HITLD-404 c2]
claimed_by: D-01M87PRN98K3KNSA
release_note: "The merge queue's rejection of a failed fast check now carries `output_tail`, the last 40 lines of its output with private terms and credentials taken out; when `env.worktree_setup` is empty, its follow-up says the queue's worktree is fresh, with nothing installed or generated."
---

## Why

A failed fast check's output is dropped from the rejection JSON and ledger, and the follow-up blames the branch even when the queue's fresh worktree lacks setup.

Reported as GitHub issue #155 (kind bug, sev-2), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: core/lib/cli/commands/orchestrator.mjs:596-608 rejectedJson keeps output only for classification and duplicate_id

## Done when

- A failing test that reproduces the problem is written first (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `auto-fix-candidate`, area `merge`, still present on main, confidence 0.8. Code pointers are precise; a failing fast check in a test shows the dropped output. Also hit in #177. It stays `proposed` until the owner confirms a precedent that allows auto-fix for its area, or commits it to `planned`.

## Promoted on 2026-11-22

Promoted to rc.2 on the owner's decision (2026-11-22).
