---
id: HITLD-73
title: Adopt the CodeQL CLI as this repository's merge scanner
kind: work
state: done
created: 2026-11-14
project: HITLD-15
needs: [HITLD-63]
claimed_by: D-73
release_note: "This repository's merge queue runs CodeQL 2.27.4 as its scanner, from the primary checkout; scanners get `HITLD_PRIMARY_ROOT`, so a branch cannot change the scanner that checks it."
---

## Why

The owner decided to declare a real scanner for this repository before the first release. Design 10.2 makes adopting a tool a decision with a sandbox trial; 10.5 has scanners declared in `merge.scanners`. CodeQL already runs in CI; the merge queue should run the same analysis locally against the baseline (HITLD-63).

## Done when

- The CodeQL CLI is tried in a sandbox with outbound network denied and logged; network defaults, telemetry and any executable fields are recorded in a decision item the owner answers.
- This repository's `policy.json` declares it under `merge.scanners` with SARIF output, pinned to a version, with how to install it on the merge machine written down.
- A first scan on main creates the baseline; the triage table in HITLD-63 is recorded as verdicts where CodeQL reports the same places.
- A branch that adds a finding is sent back by the merge queue in a fixture run.


## Notes

- Pinned: CodeQL bundle `codeql-bundle-v2.27.4` (the `bundleVersion` in codeql-action's `src/defaults.json`), `codeql-bundle-linux64.tar.gz`, sha256 `89ed56c8ec6bfccef6a0d2e7fe86da0469ca24b4db08b88016ec134b942c17a4`, matching the release's `codeql-bundle-linux64.tar.gz.checksum.txt`. Install steps are in CONTRIBUTING.
- Trial (design 10.2) under `unshare -rn`, with every `connect`, `sendto` and `sendmsg` logged by strace: database create and analyze both succeeded with no network, and the only connections attempted were to the local nscd socket. The vetting record is a decision item for the owner.
- The scanner runs from the primary checkout: the queue passes `$HITLD_PRIMARY_ROOT`, and the wrapper runs codeql with fixed arguments, no shell, cwd in a temporary directory and an explicit `--source-root`.
- The code-scanning suite reports nothing on main, so the first scan made an empty baseline. CodeQL reports none of the places in HITLD-63's triage table, so there are no verdicts to carry over.
