---
id: HITLD-16
title: "Merge owner mode: the owner decides each merge"
kind: work
state: done
created: 2026-11-14
project: HITLD-15
---

## Why

merge.mode "owner": finished branches wait; `hitld merge --only <branch>` on the owner's word. Needed for the live test. Being built on branch merge-owner-mode.

## Done when

- With `merge.mode` set to `owner`, finished branches wait and nothing merges on its own.
- `hitld merge --only <branch>` merges that branch on the owner's word and no other.
- A new project starts in owner mode.
- Tests cover waiting, the single merge and the default.
