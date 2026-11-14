---
id: HITLD-29
title: "Intake and triage: GitHub Issues and the owner's notes"
kind: work
status: Planned
created: 2026-11-14
project: HITLD-28
milestone: end-to-end
---

## Why

Quarantined triager with schema-validated output; signals; duplicates; Q7.

## Done when

- Issues of one named GitHub repository are pulled (not by webhook), and the owner's notes are taken with `hitld note`. Both become signals.
- The triager runs quarantined. Its output passes schema validation or is refused.
- A duplicate is linked to the existing item, and each signal is classified and routed.
- Auto-fix happens only for a known reporter under a confirmed precedent.
- The twelve triage scenarios pass offline.
