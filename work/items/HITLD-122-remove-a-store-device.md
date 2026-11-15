---
id: HITLD-122
title: Remove a store device
kind: decision
state: done
created: 2026-11-15
project: HITLD-15
decider: owner
answer: "A. Remove it: The next push is encrypted to the other devices only, and prunes the older files."
answered_at: 2026-11-15T21:49:16.387Z
answered_via: main-session
answered_by: owner
---

## Question

Remove the store device whose key fingerprint is 37b8-f4b3-1bed-b2ce?

Once you approve the removal, no push is encrypted to this device's key, and the next push prunes the older files it can open. What it already pulled, it keeps. hitld store device list shows its name.

Rule basis: rule-change. Reversibility: two-way.

## Options and recommendation

- A. Remove it: The next push is encrypted to the other devices only, and prunes the older files.
- B. Keep it: Nothing changes.

Recommended: A. if this is the device you meant to remove; otherwise B

## Answer

Recorded in the front matter once answered.
