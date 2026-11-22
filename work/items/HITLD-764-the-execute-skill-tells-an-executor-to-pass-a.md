---
id: HITLD-764
title: The execute skill tells an executor to pass a question to hitld with --file, not inline JSON the guard reads as words
kind: work
state: done
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c2]
claimed_by: D-01M80W9Z9BF8E8HQ
release_note: The executor contract says to pass a question to `hitld rights who` and `hitld precedent match` as a JSON file with `--file`, not inline JSON.
---

## Why

Found by the HITLD-740 executor: the executor guard denies `hitld rights who --question '<json>'` when the JSON holds words the guard reads as commands (record, answer and similar). The executor recommended that the execute skill and the contract tell executors to pass the question with `--file`, with no change to the guard.

## Done when

- The execute skill and the executor contract say to pass a question to `hitld rights who` and `hitld precedent match` with `--file`, not as inline JSON.
- The brief text that orchestrators write carries the same instruction.
- A skill change reaches main only with the owner's own yes. `hitld work check` and the offline eval gate pass.
