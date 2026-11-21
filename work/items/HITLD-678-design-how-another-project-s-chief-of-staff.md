---
id: HITLD-678
title: Design how another project's chief of staff queries the HITLD docs and knowledge base
kind: work
state: proposed
created: 2026-11-21
project: HITLD-15
---

## Done when

- The owner has walked through the design one question at a time, and each answer is recorded as a decision.
- The design says how a chief of staff working in another project asks questions of HITLD's own design documents and, if the owner wants it, of HITLD's project knowledge base, what it may see, and how the answer reaches it. It marks what is built and what is not.
- Build items are filed from the decisions, each with its own done-when.
- `hitld work check` passes.

## Why

The owner's idea (2026-11-21, for later): a chief of staff in another project should be able to look things up in HITLD's own documentation, or perhaps in HITLD's project knowledge base, instead of the owner relaying answers by hand. The first outside consumer already needed this kind of lookup, and each answer is knowledge HITLD already holds.

## Notes

Questions to walk through, with the constraints each one touches:

- **What may be read.** The design documents are public in the repository, so reading them needs no new access. HITLD's knowledge base (HITLD-55) is project-owned and may hold private material, so the classification labels (HITLD-632 to 635) decide what leaves the project. Which of the two is in scope?
- **Projects are blind to each other (HITLD-549).** No project reads another's data or learns it exists. A lookup of HITLD's public documents does not break that, but a lookup of its knowledge base, or any reply that names the asking project, could. The design must keep the asking project invisible to HITLD and HITLD's private records invisible to it.
- **How it is asked.** Options: the installed plugin carries the design documents and a read-only lookup command; a published, versioned copy of the documents the other project reads from the release; or a question put to a HITLD session that answers from its own knowledge base. A lookup command from the release matches the rule that data goes through commands (HITLD-629 and HITLD-638).
- **Which version.** A project pins a release; its answers must come from the same version it runs, not from main.
- **Cost and trust.** An answer from a session costs tokens and may be wrong; a lookup of the text itself costs almost nothing and cannot be wrong, but it does not interpret.
- **Who asks.** Only the chief of staff, or also orchestrators and executors; what the owner sees about the questions.
- **Feeding it back.** A question the lookup cannot answer is evidence that a document is missing (HITLD-55's loop), filed through the feedback path without naming the asking project.

Raised by the owner in the chief of staff session, 2026-11-21. Not urgent; walk it through when the owner asks.
