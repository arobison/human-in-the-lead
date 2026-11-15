---
id: HITLD-117
title: Approve a store device
kind: decision
state: planned
created: 2026-11-15
project: HITLD-15
decider: owner
---

## Question

Enrol the store device whose key fingerprint is 50e9-1d59-fcfa-e94b?

A device asked to read and write this project's private store. Once you approve it, every push is encrypted to it too. Check that the fingerprint is the one the device showed when it asked (hitld store device init); hitld store device list shows its name. Only your own answer approves it: no default and no precedent ever does.

Rule basis: rule-change. Reversibility: two-way.

## Options and recommendation

- A. Enrol it: Every push from now on is encrypted to this device too, and it may push.
- B. Do not enrol it: Nothing is encrypted to it, and it may not push. A new key must ask again.

Recommended: A. if the fingerprint matches the one the device showed you; otherwise B

## Answer

Recorded in the front matter once answered.
