---
id: HITLD-708
title: A store settings copy edited outside the CLI is caught at store push by a recorded hash
kind: work
state: proposed
created: 2026-11-22
project: HITLD-15
---

## Why

The owner's person and machine settings travel in the project's store (design 13.4, HITLD-148): only `hitld config write`, in the owner's own turn, writes the copy, and `hitld store push` carries it. Nothing stops another process (an editor, a script, an agent with file access) from changing the copy in the store directory directly. That edit would reach every machine at the next push and be read there as the owner's caps and limits. The check should happen where the copy leaves the machine.

## Done when

- `hitld config write` records a hash of each settings copy it writes, and `hitld store push` refuses when the copy it would send does not match the hash of the last write. The refusal names the file, says the copy was changed outside `hitld config write`, and says how to proceed (write it again with `hitld config write`).
- A copy that another machine's `config write` produced and this machine pulled is not refused: the build says where the hash lives so that holds, and says what the check does and does not defend against (a non-CLI edit, not a writer who can also change the hash).
- A test edits the copy by hand and shows the push refused, then shows a `config write` followed by a push going through, and a pulled copy going through.
- The new refusal code is listed in design part 16.2 through the curator job.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Raised in the review of PR 391 (HITLD-148). Proposed because where the hash lives, and what it is meant to resist, is a design choice. Code and design: the owner's own yes to merge. Related: HITLD-709 (how long a recorded pull counts), HITLD-163.
