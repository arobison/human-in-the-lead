---
id: HITLD-46
title: "`hitld feedback`: capture feedback about HITLd with context, stored locally"
kind: work
status: Planned
created: 2026-11-14
project: HITLD-15
---

## Why

Design 18.4, "Giving feedback". People using HITLd in a consuming project notice what the evals miss: questions not worth asking, steps that feel wrong, parts that work well. The live test (HITLD-26) is where that feedback starts, so the command has to exist before it. Capturing the context automatically means the person says only what they noticed, and storing it locally first means nothing confidential leaves the machine and nothing is lost when publishing waits.

## Done when

- `hitld feedback --kind <bug|friction|idea|worked-well> --words <text>` writes a record to the consuming project's private store as `feedback/FB-<n>`, with `--refs` for dispatch, decision and merge IDs, an optional `--area` and `--expected`, and `--json` output. It works offline.
- The record captures, without the person typing them: the plugin version, the harness and its version, the loop or command concerned (from `--area` or the refs), and what happened, drawn from the ledger entries for the refs. The person's words are stored verbatim.
- A schema for the feedback record (`schemas/feedback.schema.json`) with `schema_version`, unknown-key rejection, `classification: confidential`, and `state` (`local`, `drafted`, `filed` with the issue's URL, `withheld` with the reason, `dropped`). The record is refused anywhere but the private store, by the commit guard and the tracker check.
- `hitld feedback list` shows waiting records; `hitld feedback drop FB-<n>` marks one dropped.
- `hitld feedback render FB-<n>` prints the issue body under the same headings, in the same order, as the forms in `.github/ISSUE_TEMPLATE/` (HITLd version, harness, loop or area, what happened, what you expected, evidence). A test parses each form and checks that the headings match.
- Signal kinds gain `friction` and `worked-well` in `schemas/signal.schema.json` and design 3.2.
- Offline evals: a record holds the fields above; a record written into a worktree path is refused; a malformed ref is reported, not dropped silently.

## Plan

docs/design/0001-human-in-the-lead/18-self-improvement.md#184-giving-feedback

## Notes

Publishing (the generalizer, the send gate, filing) is HITLD-47. This item records only.
