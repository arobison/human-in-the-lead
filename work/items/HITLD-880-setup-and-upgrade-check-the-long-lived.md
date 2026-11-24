---
id: HITLD-880
title: Setup and upgrade check the long-lived credential detached executors run on, and status warns before it ends
kind: work
state: in-progress
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c2]
claimed_by: D-01M860KY6FHJXJ5G
---

## Why

Reported as GitHub issue 547 (https://github.com/arobison/human-in-the-lead/issues/547) with the consumer's follow-up comment: a consumer started detached print-mode executors (HITLD-746) as headless `claude -p`; on first start it warned that the interactive sign-in can end at a fixed date and that unattended jobs should use `claude setup-token`. Nothing in setup or upgrade covers it, so an overnight run would have stopped silently. The consumer wired up the token by hand: stored in the OS keychain, read by the launcher into the child's environment only, never exported or logged.

## Done when

- `hitld:setup`, and `hitld install` on an upgrade that enables detached executors, report whether unattended runs have a long-lived credential, and if not say how to make one (`claude setup-token`) and that the owner runs it themselves in a terminal outside the agent (its output reaches an agent transcript otherwise; the token prints on two lines and only one may be masked).
- The guide stores the credential in the operating system's keychain (macOS Keychain, Windows Credential Manager, libsecret on Linux) or the private store, never in the project, a log or a tracked environment file, and says how to check it without printing it (for example a length check).
- The detached-executor launcher reads it at start into the child's environment only (`CLAUDE_CODE_OAUTH_TOKEN`), unset after, with tracing off and stderr discarded; it refuses to start an executor without it and logs why without the secret.
- `run status` or `env status` says which credential executors run on and when the interactive sign-in can end, without reading the value into output.
- A detached executor that loses its credential mid-run reports `blocked` with the reason rather than exiting silently.
- A test per case above. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Joins Consumer live (HITLD-67) clause c2 on the owner's word of 2026-11-22 (decision HITLD-878). Costs the owner a night's work if missed, so it belongs before any overnight detached run.
