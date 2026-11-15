---
id: HITLD-107
title: "Store remote: evals and the setup guide for a cloud environment"
kind: work
state: done
created: 2026-11-15
project: HITLD-15
claimed_by: D-107
needs: [HITLD-102, HITLD-103, HITLD-104, HITLD-105, HITLD-106]
release_note: "A guide, `docs/guide/store-remote.md`, sets up the private store remote: the store repository, `store.remote.url`, a local device, a cloud environment device, enrollment through the owner's merge, removal and undo. After an enrollment or removal merges, the next push re-seals the store to main's device list (`store status` reports `push_reason`). Offline eval scenarios cover two devices taking turns, a removed device, a discarded session, an unreleased lease and a remote with no plain text."
---

## Why

Design 0003 section 13: scenarios for the store remote, and a guide so the owner can set up a cloud environment and a local machine as devices.

## Done when

- Design 0003 section 13's offline scenarios pass, including two devices taking turns (milestone c2) and a removed device locked out (c3).
- No skill or agent prompt mentions a key, a passphrase or a store file path (c5); a test checks the skills.
- A guide page sets up the store repository, a local device and a cloud environment device, step by step.
- Design 0001 parts 3.2 and 13.1 describe what is built.
- `npm run check`, the offline eval gate and `hitld work check` pass.
