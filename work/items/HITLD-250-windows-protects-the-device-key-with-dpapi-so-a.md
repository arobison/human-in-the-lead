---
id: HITLD-250
title: Windows protects the device key with DPAPI, so a local store device init works there
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
needs: [HITLD-243, HITLD-153]
---

## Why

Ordering (the owner, in the chief of staff session): this waits for HITLD-153, so the planner builds the fix for a finished-but-unmerged item holding a slot first. It is an ordering choice, not a technical dependency.

hitld has no keychain tool on Windows, so a local `store device init` fails with `device-no-keychain` and suggests `--cloud`. The owner decided (HITLD-246) to protect the key with Windows DPAPI, through PowerShell and with no extra dependency. For v0.1.0, not rc.2.

## Done when

- `hitld store device init` on Windows stores the device key encrypted for the user account with DPAPI (`ProtectedData`), and reads it back for `store pull` and `push`.
- A key written by another account or another machine does not decrypt, and the error says so.
- The keychain stand-in tests that were skipped on Windows run against the DPAPI path where PowerShell is available.
- `device-no-keychain` is no longer the answer on Windows; it stays for a platform with neither.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

From the owner's decisions on the open questions in the Windows pull request (PR #186, HITLD-243). Needs HITLD-243: the pull request changes the same code.

Also reported as GitHub issue #134 (friction, triage 2026-11-16): store device init has no Windows keychain support, so a Windows machine enrolls only via --cloud, keeping a private key in a user environment variable. This item covers the feature (DPAPI). The issue also asks that, until the key is protected, the Windows refusal say plainly that `--cloud` leaves the private key in a user environment variable, so a person can choose WSL with the Linux Secret Service instead. That wording change is part of this item's first step.

## Affected by a decision (reconciliation, HITLD-578)

The audit of 2026-11-19 found that an open design touches this item (333/409): DPAPI device key (device keys/enrollment). The decisions since then are answers, proof and contributors (HITLD-515 to 517). The item stays `planned`; a builder reads those decisions first, and the item is reworded if they change what it builds.
