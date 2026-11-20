---
id: HITLD-463
title: Device key rotation is done with the HITLD-333 work
kind: decision
state: done
created: 2026-11-17
project: HITLD-15
decider: owner
answer: "B. With HITLD-333: Rotate it as part of the new private storage format work; nothing is done separately now."
answered_at: 2026-11-17T00:42:26.710Z
answered_via: question-tool
answered_by: owner
---

## Question

A security matter an executor reported (details are not recorded in this public tracker) calls for rotating one device key. Rotate it now by hand, or as part of HITLD-333 (the new private storage format)?

HITLD-333 already owns key rotation as a one-way-door design question. The owner chose to do it there.

## Options and recommendation

- A. Now, by hand: Remove the device and enroll a fresh key after the open run finishes.
- B. With HITLD-333: Rotate it as part of the new private storage format work; nothing is done separately now.

Recommended: Now, by hand. The chief of staff recommended rotating it by hand; the owner chose the HITLD-333 route.

## Answer

Recorded in the front matter once answered.
