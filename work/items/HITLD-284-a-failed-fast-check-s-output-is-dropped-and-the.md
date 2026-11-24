---
id: HITLD-284
title: A failed fast check's follow-up names the queue's fresh worktree when env.worktree_setup is empty
kind: work
state: done
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-67 c2, HITLD-404 c2]
claimed_by: D-01M87PRN98K3KNSA
release_note: "When `env.worktree_setup` is empty, the merge queue's follow-up for a failed fast check says the queue's worktree is fresh, with nothing installed or generated, and points at `env.worktree_setup`, instead of only telling the executor to fix its branch."
---

## Why

A failed fast check's output is dropped from the rejection JSON and ledger, and the follow-up blames the branch even when the queue's fresh worktree lacks setup.

Reported as GitHub issue #155 (kind bug, sev-2), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: core/lib/cli/commands/orchestrator.mjs:596-608 rejectedJson keeps output only for classification and duplicate_id

## Done when

- A failing test that reproduces the problem is written first (design part 14.7).
- The fix makes that test pass without weakening another test: when env.worktree_setup is empty, the follow-up for a failed fast check names the queue's fresh worktree (nothing installed, nothing generated) and env.worktree_setup, instead of only blaming the branch; with a setup, the follow-up is unchanged.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `auto-fix-candidate`, area `merge`, still present on main, confidence 0.8. Code pointers are precise; a failing fast check in a test shows the dropped output. Also hit in #177. It stays `proposed` until the owner confirms a precedent that allows auto-fix for its area, or commits it to `planned`.

## Narrowed on 2026-11-24

On the owner's decision, this item ships only the follow-up hint. Carrying the failed check's output to the orchestrator (the rejection JSON) and to the ledger moves to a new design item; its number goes here once that item merges.

## Promoted on 2026-11-22

Promoted to rc.2 on the owner's decision (2026-11-22).
