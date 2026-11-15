---
id: HITLD-73
title: Adopt the CodeQL CLI as this repository's merge scanner
kind: work
status: In progress
created: 2026-11-14
project: HITLD-15
needs: [HITLD-63]
claimed: D-73
---

## Why

The owner decided to declare a real scanner for this repository before the first release. Design 10.2 makes adopting a tool a decision with a sandbox trial; 10.5 has scanners declared in `merge.scanners`. CodeQL already runs in CI; the merge queue should run the same analysis locally against the baseline (HITLD-63).

## Done when

- The CodeQL CLI is tried in a sandbox with outbound network denied and logged; network defaults, telemetry and any executable fields are recorded in a decision item the owner answers.
- This repository's `policy.json` declares it under `merge.scanners` with SARIF output, pinned to a version, with how to install it on the merge machine written down.
- A first scan on main creates the baseline; the triage table in HITLD-63 is recorded as verdicts where CodeQL reports the same places.
- A branch that adds a finding is sent back by the merge queue in a fixture run.

