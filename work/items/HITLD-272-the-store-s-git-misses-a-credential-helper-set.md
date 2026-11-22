---
id: HITLD-272
title: The store's git misses a credential helper set in git's built-in config (Xcode git on macOS)
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-67 c1, HITLD-402 c3]
---

## Why

Store git ignores a credential helper set in git's installation-level config (Xcode git on macOS), so device init fails although plain git works.

Reported as GitHub issue #131 (kind bug, sev-2), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: core/lib/store/remote-git.mjs:712 connectionConfig reads only --system and --global

## Done when

- A failing test that reproduces the problem is written first (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `auto-fix-candidate`, area `store`, still present on main, confidence 0.8. Root cause, error text and a working env workaround are given; a test can supply the key from another config origin. It stays `proposed` until the owner confirms a precedent that allows auto-fix for its area, or commits it to `planned`.

## Promoted on 2026-11-22

Promoted to rc.2 on the owner's decision (2026-11-22).
