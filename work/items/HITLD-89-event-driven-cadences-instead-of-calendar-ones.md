---
id: HITLD-89
title: Event-driven cadences instead of calendar ones
kind: work
state: done
created: 2026-11-15
project: HITLD-15
claimed_by: D-89
release_note: "Reports, digests, calibration reviews and evals run on evidence, not the calendar: `hitld cadence due` says what is due and why, and `hitld cadence done` marks a job as run. New policy sections `reports`, `digests`, `review` and `baselines`, and `load.idle_per_core` in the machine file."
---

## Why

Reports, digests, calibration reviews and baselines run on calendar cadences. Agents do not keep office hours; what matters is how much has changed and whether the owner is there.

## Done when

- Reports and digests are triggered by thresholds (merges, decisions or value accumulated), by the owner's presence, or by an idle machine, with a calendar fallback only as a ceiling on silence.
- Calibration reviews trigger on evidence (enough new outcomes), and nightly baselines and evals on an idle machine.
- Design parts 2, 12, 13 and 23 describe the triggers, and the policy keys say what they measure.


## Note on 2026-11-19

The owner decided (HITLD-536) that the chief of staff looks and reports on events first, with a slow timer of every few hours as a safety net for a lost event, and a digest sent when something needs the owner, not on the clock. This item is the build for that. The chief of staff's own check-in was changed from hourly to every 4 hours on 2026-11-19.
