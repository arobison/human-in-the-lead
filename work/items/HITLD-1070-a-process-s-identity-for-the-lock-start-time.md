---
id: HITLD-1070
title: A process's identity for the lock (start time and boot) is read the same way on macOS and Windows as on Linux, and a clock step is not a reboot
kind: work
state: planned
created: 2026-11-25
project: HITLD-15
needs: [HITLD-1052]
constraint_of: [HITLD-405 c?]
---

## Done when

- On macOS the boot is read from `kern.bootsessionuuid` (or compared with a tolerance), not from `kern.boottime` seconds, so a wall-clock step (network time, wake from sleep) never reads as a restart that takes over live holders and drops live tickets (`core/lib/env/locks.mjs`).
- On macOS and Windows the process start time is read in a fixed zone and locale, with a timeout, and a failed read for a live holder never lets the clock revoke it; a test per platform path where a runner exists.
- `outdatedCopies` finds a Windows npm `.cmd` shim's install root, so the check that names an older copy on PATH works there too.
- A CI job on macOS and Windows runs the lock tests, or the item says in its notes why not and what the first confirmed break is.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

The HITLD-1052 review found that none of the non-Linux paths (boot id, start-time caches, PowerShell inside the critical section, shim lookup) is exercised by any workflow, and that the macOS boot id can shift without a reboot [Guessing, from how the boot time is adjusted when the wall clock is stepped]. HITLD-1052 fixes Linux and the zone dependence of `ps`; this covers the rest.

## Notes

rc.3. Owner-held (merge-path lock). Follows HITLD-1052; confirm the macOS boot-time shift on a real machine before spending an executor on that part.
