---
id: HITLD-933
title: install validates --key before writing anything, refuses a --key that differs from the existing policy, and renders the contract example with the real key
kind: work
state: in-progress
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c1]
claimed_by: D-01M82XXJPHZCT24N
---

## Why

`hitld install --key sam` (lower case) writes an invalid policy and reports ok; running it again with the right key reports `kept` and leaves the invalid key; hand-fixing the key then makes `check contract` say the contract block was 'edited by hand', because the example in the block was rendered with a fallback key.

## Done when

- `install` validates `--key` against the key pattern before it writes anything, and refuses a `--key` that differs from the existing policy's with a message saying so.
- The contract example is rendered with the project's real key, so fixing the policy does not make the block look hand-edited.
- A test per case (a lower-case key; a differing key; a hand-fixed policy).
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

From the Fable consumer-eye walkthrough of 2026-11-22 (C1); decision HITLD-932. Joins Consumer live (HITLD-67) clause c1 as a recorded exception to the freeze: it breaks a first consumer's first hour.
