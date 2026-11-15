---
id: HITLD-78
title: Adopt the CodeQL CLI v2.27.4 as this repository's merge scanner
kind: decision
status: Done
created: 2026-11-15
project: HITLD-15
decided-by: owner
answer: Adopt v2.27.4
answered_at: 2026-11-15T00:30:00Z
answered_by: owner
answered_via: main-session
---

## Question

Adopt the CodeQL CLI bundle v2.27.4 (`codeql-bundle-linux64.tar.gz`, sha256 `89ed56c8ec6bfccef6a0d2e7fe86da0469ca24b4db08b88016ec134b942c17a4`, matching the release checksum) as this repository's merge scanner (design 10.2, vetting new tools; HITLD-73)?

Trial record: run under a cut network (`unshare -rn`, every `connect`, `sendto` and `sendmsg` logged by strace). Database create and analyze both succeeded; the only connection attempted was the local nscd socket. No telemetry observed. The scanner runs from the primary checkout through `$HITLD_PRIMARY_ROOT`, with fixed arguments, no shell, cwd in a temporary directory and an explicit `--source-root`. The first scan on main reported no findings, so the baseline is empty.

## Options and recommendation

- **Adopt v2.27.4 (recommended).** Declared in `merge.scanners`; the merge machine installs the pinned bundle and sets `HITLD_CODEQL`. Version bumps are later decisions.
- Adopt on the merge machine only.
- Defer and keep CI CodeQL only.

## Answer

Adopt v2.27.4. Answered by the owner in the main session.
