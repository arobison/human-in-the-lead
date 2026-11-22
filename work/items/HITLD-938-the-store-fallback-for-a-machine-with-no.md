---
id: HITLD-938
title: The store fallback for a machine with no keychain is a private key file, never printed JSON, and the guide says what to do with the decision file
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c1]
---

## Why

The guide's fallback for a machine with no keychain is `store device init --cloud`, which prints the private key in the ordinary JSON `identity` field, to be kept in a plain-text variable. The command also writes an uncommitted decision file on main that the guide does not mention.

## Done when

- The fallback writes the key to a file with mode 0600 and prints only its path; the key never appears in a result or a log.
- The guide says what to do with the decision file the command writes (commit it, or where it goes).
- A test checks the key is not in the output.
- A store or rights change reaches main only with the owner's own yes.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

From the Fable consumer-eye walkthrough of 2026-11-22 (C10); decision HITLD-932. Joins Consumer live (HITLD-67) clause c1 as a recorded exception to the freeze: it breaks a first consumer's first hour.
