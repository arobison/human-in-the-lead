---
id: HITLD-1013
title: The quiet-machine test ignores background-priority load and reads the GPU separately
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-67 c?]
---

## Done when

- The quiet test counts only load that competes with the job: on macOS it leaves out processes at background priority (priority 4 in `ps`) when it compares the load to the bar, and reads the GPU's busy share (IOAccelerator Device Utilization, readable without sudo) as its own figure against its own bar; a test covers a sample with high load average but only background work, and one with an idle CPU and a busy GPU.
- Whether background load leaves a measurement alone is checked by a noise test, not assumed; the setting that turns the filter on says so in `env status`.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

GitHub issue 606 (v0.1.0-rc.1): a measurement waited more than an hour for a quiet machine, and the pause held the merge gates and the executors with it. Most of the load was the system's own indexing and media analysis at background priority. The test divides the load average by the core count, which counts every runnable thread at any priority: about 1 core of background work and 0.8 of everything else on 8 cores read 0.47 per core against a 0.3 bar, where the competing load was 0.1.

## Notes

rc.2 (the owner moved it in on 2026-11-25). Platform-specific (macOS), confidence on the numbers: Guessing, taken from the report. Related: HITLD-42 (load-aware admission), HITLD-882 (env status names the top processes, indexer folders), HITLD-983 (a job can request a quiet machine).
