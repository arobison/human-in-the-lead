---
id: HITLD-42
title: Load-aware admission and quiet-machine holds
kind: work
state: planned
created: 2026-11-14
project: HITLD-28
needs: [HITLD-41, HITLD-38]
constraint_of: [HITLD-71 c2]
---

## Why

Per design 13.4: heavy work started on a loaded machine is slow and flaky (design 14.7), and the load includes the person's own work and other programs. Benchmarks need an idle machine.

## Done when

- Before heavy work starts, the manager reads load average or CPU use, memory pressure and GPU use where readable, and defers the work above the machine's threshold.
- Admission wait is recorded per resource and is a concurrency controller sensor.
- A quiet hold is exclusive across projects, pauses or waits out other heavy work, and starts only after load stays below its threshold for the settle period; the load during the hold is recorded with the result.
- Tests use a fake load source, so they do not depend on the test machine.

## Note on 2026-11-19

The owner decided (HITLD-534) that executor count follows measured headroom; load-aware admission is a part of HITLD-559.

## Affected by a decision (reconciliation, HITLD-578)

The audit of 2026-11-19 found that an open design touches this item (493): load-aware admission thresholds; machine-load gates (weak). The decisions since then are the audit of defaults (HITLD-532 to 538). The item stays `planned`; a builder reads those decisions first, and the item is reworded if they change what it builds.
