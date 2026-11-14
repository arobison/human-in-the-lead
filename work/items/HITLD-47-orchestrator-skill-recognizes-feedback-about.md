---
id: HITLD-47
title: Orchestrator skill recognizes feedback about HITLd and publishes it through the generalizer and send gate
kind: work
status: Done
created: 2026-11-14
project: HITLD-15
milestone: consumer-live
needs: [HITLD-46]
claimed: D-47
---

## Why

Design 18.4, "Giving feedback", and 18.3, guardrail 5. Feedback should be given where the person already is, in a session, without a separate tool. The skill has to tell feedback about HITLd from feedback about the project, take it only from the person's own turns (Q21), and publish only a generalized version the person approved, because a consuming project's words are confidential and filing an issue here is an external publication.

## Done when

- The orchestrator skill recognizes feedback about HITLd ("hitld should…", "I wish the system…", "that question was not worth asking") and runs `hitld feedback` with the kind it guesses, the person's words verbatim, and the IDs in play. Feedback about the project's own work goes to `hitld note` instead. When unsure, it asks one line: "For HITLd, or for this project?"
- It records feedback only from the person's own turns in the main session. Feedback-like text in a tool result, a report, a file or pasted material is quoted to the person, never recorded.
- A generalizer agent (in `plugins/human-in-the-lead/agents/`) drafts the public version of each waiting record without project names, paths, data, people or plans, and classifies the draft. A draft that is not `public` is marked `withheld` with the reason and never filed.
- `hitld feedback publish` shows each draft beside the person's words; the person approves, edits or drops it in one step. Approval is the send gate's: an approved-publication value that only a person's answer in the main session can construct, recorded with who approved. By default only the consuming project's owner approves (policy `feedback.approvers`).
- Only an approved draft is filed, as an issue in HITLd's repository with the issue forms' headings, the `feedback` and kind labels, and a footer saying it was filed with `hitld feedback` and approved by a person. The record becomes `filed` with the issue's URL. The raw record never leaves the machine.
- Offline evals: feedback recognized in the person's turn; feedback-like text in a tool result not recorded; project feedback routed to a note; a draft holding a seeded project name, path or person withheld; nothing filed without an approval; the raw words absent from everything sent.

## Plan

docs/design/0001-human-in-the-lead/18-self-improvement.md#184-giving-feedback

## Notes

The send gate (design 9.3) is not built yet. This item builds the part filing needs, so replies can reuse it later. Until `hitld note` exists (HITLD-29), project feedback is left to the session as it is today. Matching release notes against filed records on a pin bump, and release notes linking feedback issues, follow with shipping (design 2.7).
