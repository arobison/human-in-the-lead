---
id: HITLD-60
title: Private store as git text plus a local SQLite index, with hitld store export, import and sync
kind: work
status: Done
created: 2026-11-14
project: HITLD-15
claimed: D-60
---

## Why

Q1 is decided: git text files are the truth for what syncs, and SQLite (Node's built-in module) holds machine-local state and a rebuildable index. The live test (HITLD-26) starts a real ledger, and moving a store by hand would be painful.

## Done when

- The store's text parts are a git repository.
- The SQLite index rebuilds from the text and is never exported. The machine registry stays machine-local.
- `hitld store export` writes one encrypted file: a git bundle plus a manifest (project ID, schema versions, head), under authenticated encryption with a key derived from a passphrase, using Node's built-in crypto.
- `hitld store import` verifies the file, refuses another project's file or a newer schema, merges append-only history and stops on a conflict, then rebuilds the index.
- `hitld store sync` does both directions.
- Executors are refused.
- Tests cover a round trip between two store directories, a wrong passphrase, another project's file, and a conflict.
