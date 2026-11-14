---
id: HITLD-63
title: "Security in done when: diff-aware scanning against a baseline, triage records, accepted risk with expiry"
kind: work
status: Planned
created: 2026-11-14
project: HITLD-15
milestone: first-release
---

## Why

Design 10.5, 6.2 and 14.2: a change is not done while it adds a security finding nobody has looked at. Scanning must not block on old findings, must not depend on one vendor, and must not ask twice about the same place. Before the first release, so consuming projects start with it.

## Triage recorded so far (Snyk Code, this repository)

| Finding | Verdict | Change |
|---|---|---|
| cli/commands/rights.mjs → precedent/store.mjs write | Real: a symlink at precedents/ or a P-n file redirected the owner's write outside the directory | Directory contained with insidePath; files read and written without following links; 2 tests |
| cli/commands/env.mjs (2) and orchestrator.mjs (4), command injection → worktree setup spawn | By design: commands from `env.worktree_setup`, owner-declared, trusted loading from the primary checkout | Trust boundary named at the sink; runSetup takes no commands from its caller; 1 test |
| the same six, path traversal → locks.mjs read | False positive: resource name matches the name pattern and must be in `serial_resources`; root from a validated project ID | None |
| env/tasks.mjs → primary.mjs read of .git | False positive: this is the ownership check itself | Check and read share one no-follow descriptor; 1 test |
| orchestrator.mjs (3), cli/commands/tracker.mjs, tracker/files/tracker.mjs → directory reads | False positive: paths pass schema pattern, containment, per-component link check, realpath | None |
| tracker/files/tracker.mjs claims | False positive: claims read from refs through git ls-tree | None |
| eval/offline.mjs → fixtures read | False positive: `from` is pattern-checked and contained; links refused | None |

The scanner still lists these until verdicts are recorded in the baseline this item builds.

## Done when

- Scanners are declared in `policy.json` next to the other fast checks, each with its command and output format (SARIF by default). No tool is built in; a fixture scanner that writes SARIF plugs in.
- The project keeps a baseline of known findings in the private store. The first scan of an existing codebase creates it instead of failing. A new tool or rule version's first run on `main` extends it. A merged fix removes its finding; nothing else adds to it.
- The merge queue fails a branch only on findings that are in neither the baseline nor the recorded verdicts, and sends it back with the finding.
- Each new finding has a recorded triage verdict with the item's evidence: real (fixed, with a test that would have caught it), by design (the trust boundary named at the sink) or false positive (a one-line reason). Verdicts are keyed by tool, rule and a code fingerprint; the next scan does not ask again at the same place, and asks again when the code there changes.
- Accepting a real risk is an owner decision with an expiry. At expiry it becomes a decision again. An executor cannot record an accepted risk or edit the baseline or verdicts: the guards deny it, and the command line refuses it.
- Every real finding caught becomes a regression test; a finding about agent behaviour becomes an eval scenario.
- Baseline, verdicts and accepted risks for real findings are `confidential`; a public item records only that its scans passed.
- Offline evals: an existing codebase with findings gets a baseline and no failure; a change adding a finding fails; a recorded false positive is not asked again; changed code at that place is asked again; an expired accepted risk becomes an owner decision.

## Plan

docs/design/0001-human-in-the-lead/10-security.md#105-security-in-done-when; docs/design/0001-human-in-the-lead/14-integration.md#142-the-queue.

## Notes

The independent security review for sensitive paths and the threat-model notes for design-level items are HITLD-34.
