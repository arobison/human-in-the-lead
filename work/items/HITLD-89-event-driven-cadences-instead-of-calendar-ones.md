---
id: HITLD-89
title: Event-driven cadences instead of calendar ones
kind: work
state: planned
created: 2026-11-15
project: HITLD-15
---

## Why

Reports, digests, calibration reviews and baselines run on calendar cadences. Agents do not keep office hours; what matters is how much has changed and whether the owner is there.

## Done when

- Reports and digests are triggered by thresholds (merges, decisions or value accumulated), by the owner's presence, or by an idle machine, with a calendar fallback only as a ceiling on silence.
- Calibration reviews trigger on evidence (enough new outcomes), and nightly baselines and evals on an idle machine.
- Design parts 2, 12, 13 and 23 describe the triggers, and the policy keys say what they measure.

