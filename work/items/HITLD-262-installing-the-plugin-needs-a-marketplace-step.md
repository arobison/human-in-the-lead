---
id: HITLD-262
title: Installing the plugin needs a marketplace step the guide doesn't list, and that step drops autoUpdate
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Why

Plugin install needs a marketplace add step the guide omits; that step rewrites .claude/settings.json and drops autoUpdate; via npm -w it registers the workspace, not the repo.

Reported as GitHub issue #120 (kind bug, sev-2), filed by the owner through `hitld feedback` from a first run on v0.1.0-rc.1. The issue is untouched on GitHub.

Evidence: docs/guide/new-project.md:79-83 step 9 lists only claude plugin install; related planned HITLD-25 (hitld:setup script)

## Done when

- The missing information is obtained first (the Claude Code version and the exact settings before and after the marketplace add), then a failing test that reproduces the problem (design part 14.7).
- The fix makes that test pass, and the behavior is what the issue's "What you expected" asks for, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Triage record (design part 2.2, quarantined triager; evidence is the triager's and is not individually verified): route `backlog`, area `install`, still present on main, confidence 0.7. Guide fix plus setup ordering; overlaps HITLD-25's planned setup script, so shape together.
