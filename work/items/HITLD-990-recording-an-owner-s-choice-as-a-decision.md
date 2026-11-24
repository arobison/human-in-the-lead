---
id: HITLD-990
title: Recording an owner's choice as a decision, publishing it and opening its pull request is one hitld command, so the chief of staff does not carry a private script
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- `hitld rights record` takes the title, question, context, options, recommendation, answer, tag and how it was asked, writes the decision item, and prints its ID; a test covers a recorded choice and a refused duplicate tag.
- `hitld work publish --open` also opens the pull request where the forge's tool is available, or prints the one call to make; a test covers both.
- The chief-of-staff skill uses these commands, and no step names a script outside the repository.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Today the chief of staff records every owner choice with a private script and then runs publish, opens the pull request, cleans the working tree and merges, about eight calls per choice. Serves the owner's token budget and repeatable behaviour across chief-of-staff sessions.

## Notes

rc.3. From the owner's request of 2026-11-24 to keep the token use of the chief-of-staff chat down without breaking the long-running chat: one chief-of-staff session read billions of cache-read tokens in eight days, because every model call re-reads the whole context, so cost grows with context size times the number of calls.
