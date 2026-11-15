---
id: HITLD-95
title: "Hosted tracker backends"
kind: project
state: planned
created: 2026-11-15
owner: owner
decision: HITLD-94
plan: docs/design/0002-hosted-tracker-backends.md
---

## Summary

A project runs HITLd on Linear, Jira or GitHub Issues as its tracker, per design 0002. Work items are hosted; HITLd's own records stay as files. Import and switch comes first and needs only the files backend (0002 Q8). The full backends need "One signal end to end" (HITLD-1), with the tracker interface unchanged through at least one consumer's use.

The rest of the build items in 0002 section 16 are filed as the first slice lands.
