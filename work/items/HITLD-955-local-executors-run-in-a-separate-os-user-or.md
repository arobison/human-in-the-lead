---
id: HITLD-955
title: Local executors run in a separate OS user or sandbox that holds only the executor token and its own provider key, whatever the provider or model
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c1]
---

## Why

A local executor runs as the owner's OS user and inherits their git credentials and `gh` sign-in, so every forge rule is bypassed on that machine. The owner decided local executors run in a separate OS user or sandbox (HITLD-951) and asked whether it supports other providers and local inference: the boundary is provider-agnostic, and the Claude hook guard does not cover other harnesses, so for them this boundary is the only one.

## Done when

- A local executor runs under a separate OS user or sandbox that holds only the executor App's token and that executor's own provider key; no owner credential, keychain or `gh` sign-in is reachable from it.
- It works for a headless run of any provider's command-line agent and for a local model runner (as a service reached over localhost or inside the sandbox); GPU or device access is a documented per-platform step.
- A test shows an executor in the sandbox cannot read the owner's credentials and can push only its `hitld/` branch.
- A guard or rights change reaches main only with the owner's own yes.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

From the Fable forge-enforcement spec (2026-11-22) and the owner's walk-through decisions HITLD-944 to 951. Large. Platform differences (a separate user on macOS and Linux, a container or namespace, Windows) are settled in the item. The executor profile is HITLD-956.
