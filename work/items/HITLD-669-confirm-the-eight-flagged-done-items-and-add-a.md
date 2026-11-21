---
id: HITLD-669
title: Confirm the eight flagged done items and add a cutoff to the consistency check
kind: work
state: proposed
created: 2026-11-21
project: HITLD-15
needs: [HITLD-49]
---

## Why

The consistency check on main (HITLD-49, pull request 398) flags eight done items that no commit names: six closed in tracker-only commits and two whose code merged with no ID. The owner chose to confirm each one and add a cutoff (decision HITLD-664). HITLD-470, 472 and 507 were closed as superseded by a design update.

## Done when

- Each of the eight flagged items is confirmed against the history, and a note with a Refs trailer is published for each real one.
- HITLD-470, 472 and 507 are marked dropped, with the reason.
- A policy cutoff exists so items done before the check was adopted are not flagged, with a test, and the check on main reports no flag for the eight.
- Waits for pull request 398 to merge.
