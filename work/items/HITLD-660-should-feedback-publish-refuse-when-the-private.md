---
id: HITLD-660
title: Should feedback publish refuse when the private term list was not checked?
kind: decision
state: planned
created: 2026-11-20
project: HITLD-15
decider: owner
---

## Question

feedback publish sends an approved issue to a public forge. When the private term list could not be read, should it refuse, or only warn?

Pull request 404 (HITLD-187). The public-text checks now warn when the list is absent. feedback publish sends the issue first and can only report the warning afterwards. A published issue cannot be un-sent.

## Options and recommendation

- A. Refuse: feedback publish refuses to send when the list was not checked, and says how to fix it.
- B. Warn only: It sends and reports that the list was not checked.

Recommended: Refuse. A public issue cannot be taken back, so the one irreversible path should fail closed.

## Answer

Open.
