---
id: HITLD-460
title: "Merge of PR #285 (HITLD-450), the start-estimate cap and correction"
kind: decision
state: done
created: 2026-11-17
project: HITLD-15
decider: owner
answer: "A. Merge it: The chief of staff squash-merges the verified head with a corrected message; the poisoned start estimates are corrected after."
answered_at: 2026-11-17T00:24:03.671Z
answered_via: question-tool
answered_by: owner
---

## Question

Merge PR #285 (HITLD-450)? A dispatch's recorded start estimate is capped at 3x the tier default and records where it came from. It adds the public command hitld ledger correct-estimate and two optional ledger fields, no version bump. All 11 checks passed at head 19e57a20cb5c and there was no conflict.

Code, a ledger schema change and a new public command: the owner's own yes is needed.

## Options and recommendation

- A. Merge it: The chief of staff squash-merges the verified head with a corrected message; the poisoned start estimates are corrected after.
- B. Merge, but rename the command: The owner names the command; the executor renames it first.
- C. Hold: Left open; HITLD-454 and everything after it keep waiting.

Recommended: Merge it. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
