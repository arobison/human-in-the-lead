---
id: HITLD-327
title: The first run archive is sent to the owner as files
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Send them to me as files: The orchestrator pastes the text, the chief of staff saves it and sends it to the owner."
answered_at: 2026-11-16T16:17:49.845Z
answered_via: question-tool
answered_by: owner
---

## Question

Where should the first run ledger and state files live for good?

They exist only on the first orchestrator VM.

## Options and recommendation

- A. Send them to me as files: The orchestrator pastes the text, the chief of staff saves it and sends it to the owner.
- B. Encrypted into the private store repo: Needs the store sync, which is blocked.
- C. Leave it on the VM: It may be lost.

Recommended: Send them to me as files. Private to the owner, no repository involved.

## Answer

Recorded in the front matter once answered.
