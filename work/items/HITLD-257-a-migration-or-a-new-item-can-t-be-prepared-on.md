---
id: HITLD-257
title: A migration or a new item can't be prepared on a branch for the owner to review
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Why

work migrate and work new refuse on any branch other than main, so a migration or new items cannot be staged on a branch for owner review in owner merge mode.

Reported as GitHub issue #114 (kind feature, no severity), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: core/lib/tracker/files/ids.mjs:40-45 refuses off main; migrate.mjs:259 calls assertOrchestrator even when nothing is allocated

## Done when

- The missing information is obtained first (a feature or idea, not a defect: acceptance comes from shaping), then a failing test that reproduces the problem (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `backlog`, area `tracker`, still present on main, confidence 0.75. Changes the rule on who creates tracker entities and where; needs shaping, not a quick fix.

## Second sighting on 2026-11-20

A curator job that prepared the nine roadmap moves in a git worktree could not allocate the new release item's ID there, because `hitld work new` refuses on a branch other than main; it took the number from the store counter in a throwaway clone of main and moved the file over. Preparing a new item or a migration for review on a branch, with an ID from the same counter, is what this item asks for.
