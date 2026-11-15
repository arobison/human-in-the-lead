---
id: HITLD-72
title: rights ask and rights answer reach the files tracker from the command line
kind: work
state: done
created: 2026-11-14
project: HITLD-15
claimed_by: D-72
release_note: "`hitld rights ask` and `rights answer` work from the command line, and answered decisions are recorded in the tracker files."
---

## Why

`rights ask` and `rights answer` cannot open a tracker from the command line: `core/lib/cli/commands/rights.mjs` imports `core/lib/tracker/files/index.mjs`, which does not exist. The files format also has no keys for a decision's answer. So a decision cannot be asked or answered through the CLI, and `hitld security accept --decision` (which needs an answered decision) can only be fed by editing files. Found while testing HITLD-63.

## Done when

- `hitld rights ask` and `hitld rights answer` open the files tracker of the primary checkout and work end to end from the command line, with the existing guards.
- The files format records what an answered decision needs (the answer, when, by whom, and whether a precedent resolved it), declared in the schema and kept by the read API.
- An end-to-end test asks a question, answers it, and accepts a security risk against that decision, all through the CLI.
- The offline eval scenarios for decision rights still pass.

