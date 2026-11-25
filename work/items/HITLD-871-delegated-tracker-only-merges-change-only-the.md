---
id: HITLD-871
title: Delegated tracker-only merges change only the claimed item and run the queue's answer checks
kind: work
state: in-progress
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c1]
claimed_by: D-01M88NC0G604RHSV
---

## Why

The review found that a pull request whose files are all under `work/` merges by delegation with the owner's sign-off, and that the answer check (`core/lib/merge/answers.mjs`) compares only four fields of an answered decision, so such a branch can rewrite a decision's title, question or options, another item's Done-when, or add items whose bodies become later executors' briefs. The chief of staff's hand-merge of tracker-only pull requests is prose only and skips the queue's answer, symbolic-link, quarantine and private-term checks.

## Done when

- A delegated tracker-only merge may change only the file of the item its branch claimed; any change to a decision item, to another item, or to a milestone waits for the owner.
- One command (`hitld merge --tracker-only <pull request>`) runs the queue's answer check, the symbolic-link rule, the quarantine and duplicate-ID guards and the private-term check, and verifies the head branch's origin; the chief-of-staff skill calls it instead of describing the steps.
- Owner-only state changes with no decision behind them (promoting `proposed` to `planned`) are refused.
- A test per case above.
- A merge-path or skill change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Findings T5 and T6 and the operating-model review's O6.
