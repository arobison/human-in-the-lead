---
id: HITLD-250
title: Windows protects the device key with DPAPI, so a local store device init works there
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
needs: [HITLD-243]
---

## Why

hitld has no keychain tool on Windows, so a local `store device init` fails with `device-no-keychain` and suggests `--cloud`. The owner decided (HITLD-246) to protect the key with Windows DPAPI, through PowerShell and with no extra dependency. For v0.1.0, not rc.2.

## Done when

- `hitld store device init` on Windows stores the device key encrypted for the user account with DPAPI (`ProtectedData`), and reads it back for `store pull` and `push`.
- A key written by another account or another machine does not decrypt, and the error says so.
- The keychain stand-in tests that were skipped on Windows run against the DPAPI path where PowerShell is available.
- `device-no-keychain` is no longer the answer on Windows; it stays for a platform with neither.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

From the owner's decisions on the open questions in the Windows pull request (PR #186, HITLD-243). Needs HITLD-243: the pull request changes the same code.
