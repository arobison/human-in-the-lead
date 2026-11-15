---
id: HITLD-123
title: "Tracker IDs never collide across sessions, and an answer applies only to the question it answers"
kind: work
state: done
created: 2026-11-15
project: HITLD-15
claimed_by: D-123
release_note: "Tracker IDs come from a counter on the store repository (branch `hitld-ids`, moved with compare-and-swap) when a store remote is set, and are always checked against the remote's main and open branches, so two sessions never take the same ID (`hitld work new` reports `id_source`). Each question carries a check code; `hitld rights answer` refuses an answer whose question changed (`answer-question-changed`) and accepts `--code`. A lone letter names an option only when it is the whole answer. The merge queue and CI refuse duplicate IDs. The skills ask decisions with the harness's question tool."
---

## Why

Two sessions on different machines each filed a decision from their own copy of main and both took the next free ID. The owner's answer to the second was then applied to the first: a device removal never happened, and the device kept access to the private store until the removal was asked again. The owner decided this is fixed before v0.1.0-rc.1.

## Done when

- **IDs do not collide.** An ID is taken from a source every session shares, not only the local checkout: for example a counter the store remote moves with compare-and-swap, or a check against `origin/main` and the open branches that refuses an ID already in use. Two sessions filing at once get different IDs; a test races two filings.
- **An answer applies only to its question.** `hitld rights answer <ID>` checks that the tracker item, the private ask record and the action it would apply (for a device decision: the action, device name and fingerprint) are the same question; when they differ it refuses with a named code and records nothing.
- **An answer is bound to the question as shown.** Every question the owner sees carries a short check code derived from its question, options and context (as a device decision shows a fingerprint, and as an owner-mode merge approval is bound to the presented batch). `hitld rights answer` takes the code the answering session showed (or reads it from that session's own record of what it showed) and refuses when the question it would apply has a different code.
- **Decisions are asked with the harness's question tool where it has one.** The orchestrate and chief-of-staff skills show each decision as a structured question (its options as choices, the ID and check code with it), and the option the owner picks is recorded as the owner's own answer, bound to that check code. Free text stays possible and follows the matching rule of HITLD-119.
- **Eval scenarios:** two sessions file decisions from out-of-date copies of main and get different IDs, each answer applying to its own question; and an answer to a question that has since changed under the same ID is refused.
- **Duplicates are caught.** `hitld work check` and the merge check refuse two tracker items with the same ID, naming both files.
- Design parts 3 (IDs) and 4 (answers) say so.
- `npm run check`, the offline eval gate and `hitld work check` pass.
