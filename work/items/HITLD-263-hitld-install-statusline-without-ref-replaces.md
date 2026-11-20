---
id: HITLD-263
title: Hitld install --statusline without --ref replaces the pinned marketplace with a machine path
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
needs: [HITLD-165]
---

## Why

hitld install --statusline without --ref replaces a pinned GitHub marketplace source in committed settings with a machine-local directory path.

Reported as GitHub issue #121 (kind bug, sev-2), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: core/lib/install/install.mjs:267-290 with no --ref always builds a directory source and overwrites extraKnownMarketplaces

## Done when

- A failing test that reproduces the problem is written first (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `auto-fix-candidate`, area `install`, still present on main, confidence 0.85. Exact steps given; a test installs with --ref then --statusline and checks the source. It stays `proposed` until the owner confirms a precedent that allows auto-fix for its area, or commits it to `planned`.

## Decided on 2026-11-20 (HITLD-606)

The owner decided that this item closes when the quota probe (HITLD-165) lands: that item retires the status-line usage capture (decision HITLD-173), so nothing is left to fix here. It needs HITLD-165 and is not built separately.
