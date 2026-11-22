---
id: HITLD-255
title: The front-matter parser rejects YAML lists that a formatter wrapped
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-67 c2, HITLD-403 c1]
---

## Why

Front-matter parser rejects prettier-wrapped YAML lists (multi-line [ ] and a list on the next line); migrate reported success and the read API then returned empty constraints.

Reported as GitHub issue #112 (kind bug, sev-2), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: core/lib/tracker/files/frontmatter.mjs:39-41 accepts only key: value, inline [..] on one line, or '- x' entries; other lines give not "key: value"

## Done when

- A failing test that reproduces the problem is written first (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `auto-fix-candidate`, area `tracker`, still present on main, confidence 0.85. Clear input forms and error text; a parser test can show the failure directly. It stays `proposed` until the owner confirms a precedent that allows auto-fix for its area, or commits it to `planned`.

## Promoted on 2026-11-22

Promoted to rc.2 on the owner's decision (2026-11-22).
