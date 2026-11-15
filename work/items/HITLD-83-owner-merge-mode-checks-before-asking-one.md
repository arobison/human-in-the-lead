---
id: HITLD-83
title: "Owner merge mode: checks before asking, one approval per batch, evidence the executor did not write"
kind: work
state: planned
created: 2026-11-15
project: HITLD-15
---

## Why

Owner merge mode, the default, asks the owner to approve each branch before any check has run, on evidence the executor reported about itself: the human-in-the-loop gate part 1.1 warns against, which turns into a rubber stamp as volume grows. Approvals are not recorded as trust evidence, so the record that would justify the automatic queue never builds.

## Done when

- Before a branch is shown to the owner, the merge queue has rebased it and run the fast checks, the scanners and the suite; only green branches are presented, with evidence the executor did not write: check results, the files actually changed against `touches`, sensitive globs hit, the public-surface delta and deviations.
- The owner approves at merge boundaries in one message ("merge all 4? yes, or list"); a directed read (design 6.6) is attached only where a trigger fires.
- Each approval is recorded as a trust event (latency, approved as presented or not, later revert).
- Owner mode can be limited to areas or paths (`merge.owner_paths`), and after a run of clean merges in an area the system proposes the automatic queue there; the owner decides.
- Tests and an offline eval scenario cover a red branch never reaching the owner and a batch approval.

