---
id: HITLD-943
title: "Smaller consumer gaps: the hook path after the bundle moves, the CLAUDE.md line and gitignore in install output, the status line left by undo, and a grouped hitld help"
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-402 c?]
---

## Why

Smaller gaps: on rc.1 the git hook has a fixed path and blocks every commit once the bundle directory moves; `install` prints a CLAUDE.md line when there is none; the guide's `git add` list omits the `.gitignore` that `--statusline` creates; undo leaves the status line in `.claude/settings.local.json`; worktrees, briefs and reports go in the private store outside the project; the guide does not name `gh`, `lsof`, `ps`; `hitld --help` is over 100 ungrouped lines.

## Done when

- Each of the six has a fix or a written reason it stays.
- `hitld --help` is grouped.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

From the Fable consumer-eye walkthrough of 2026-11-22 (C12); decision HITLD-932. rc.3 by the owner's decision.
