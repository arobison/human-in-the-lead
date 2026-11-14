---
id: HITLD-18
title: "Tracker read API: versioned JSON output and declared extension fields"
kind: work
status: Done
created: 2026-11-14
project: HITLD-15
milestone: first-release
claimed: D-18
---

## Why

Per design 3.4, "Who owns the format": `hitld work query/show --json` with api_version; project fields declared in tracker.json, validated, preserved, queryable; `hitld work migrate` for structural changes; a backend conformance suite.

## Done when

- `hitld work query` and `hitld work show` take `--json`, and the output carries `api_version`. Removing or retyping a field raises it.
- Project fields declared in `tracker.json` are validated, kept when the tool writes a file, and queryable.
- `hitld work migrate` applies a structural change to the whole tracker, is idempotent, and has a dry run.
- A backend conformance suite runs against the files backend and fails a backend that drops a declared field.
