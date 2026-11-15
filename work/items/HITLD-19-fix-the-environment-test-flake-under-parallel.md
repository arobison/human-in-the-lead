---
id: HITLD-19
title: Fix the environment test flake under parallel load
kind: work
state: done
created: 2026-11-14
project: HITLD-15
claimed_by: D-HITLD-19
---

## Why

core/test/env.test.mjs fails intermittently when other suites run at once (shared machine lock directory, timeouts). Isolate the machine directory per test. The first flake handled the way design 14.7 says: reproduce deterministically first.

## Done when

- `core/test/env.test.mjs` passes twenty runs in a row while the other suites run at once.
- Each test uses its own machine directory and never the shared lock directory.
- A test reproduces the old failure deterministically, and it fails without the fix.
