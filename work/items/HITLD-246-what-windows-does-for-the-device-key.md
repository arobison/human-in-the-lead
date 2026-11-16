---
id: HITLD-246
title: What Windows does for the device key
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Protect the key with Windows DPAPI: Protect the key with Windows DPAPI."
answered_at: 2026-11-16T05:20:34.278Z
answered_via: question-tool
answered_by: owner
---

## Question

What should Windows do for the device key, since there is no keychain tool?

One of the four decisions left for the owner in the Windows pull request (PR #186). Decided by the owner in the chief of staff session, 2026-11-16.

Reversibility: two-way.

## Options and recommendation

- A. Protect the key with Windows DPAPI: Protect the key with Windows DPAPI.
- B. Use Windows Credential Manager: Use Windows Credential Manager.
- C. Leave it: Windows enrolls with --cloud only: Leave it: Windows enrolls with --cloud only.

Recommended: Protect the key with Windows DPAPI. The recommended option.

## Answer

Recorded in the front matter once answered.
