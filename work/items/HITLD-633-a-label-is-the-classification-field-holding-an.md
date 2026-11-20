---
id: HITLD-633
title: A label is the classification field holding an object with two keys
kind: decision
state: done
created: 2026-11-20
project: HITLD-15
decider: owner
answer: Keep the classification field, as an object with two keys (Recommended)
answered_at: 2026-11-20T03:58:40.588Z
answered_via: question-tool
answered_by: owner
---

## Question

How is a label written in a file and in a command's JSON, and in dyno's result output?

HITLD-620: explicit labels with five readers and five place classes (HITLD-631); the existing classification field is read by existing tooling.

## Options and recommendation

- A. Keep the classification field, as an object with two keys: classification: { readers: ..., reach: ... } in front matter, command JSON and dyno's results; the one-time migration turns the old four names into the object
- B. Two new top-level fields: readers and reach beside each other, the old field removed
- C. One combined string: classification: any-model/private-store

Recommended: Keep the classification field, as an object with two keys. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
