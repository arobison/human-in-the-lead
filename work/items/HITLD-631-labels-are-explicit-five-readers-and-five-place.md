---
id: HITLD-631
title: "Labels are explicit: five readers and five place classes, no shorthands"
kind: decision
state: done
created: 2026-11-20
project: HITLD-15
decider: owner
answer: i find the shorthands a little confusing, seems unlikely i'll remember what they mean, and mostly agents will be using this info, no? isn't explicit better? (after the place classes were revised to include storage buckets)
answered_at: 2026-11-20T03:49:27.754Z
answered_via: chat
answered_by: owner
---

## Question

Is this the right vocabulary for the two dimensions, with storage places as named, registered classes, and should the old level names stay as shorthands?

HITLD-620: labels plus channel clearances (HITLD-625). Benchmark results will live in a bucket owned by dyno (HITLD-623), so the where dimension needs storage places. The owner said the shorthands are confusing and that agents mostly use this information, so explicit is better.

## Options and recommendation

- A. Five readers, five place classes, explicit: Who may read: public; any model including a remote model on the owner's account; local model only; tools only; owner only. Widest place it may reach: this machine only; the owner's synced private store; a private bucket with client-side encryption; a private bucket with provider-managed encryption; anywhere. The owner registers concrete places under a class. No shorthands
- B. Five readers, three place classes: Keep this machine, the synced store and anywhere only
- C. Something else: Ask the owner to say more

Recommended: Five readers, five place classes, explicit. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
