---
id: HITLD-667
title: A real OS-level boundary for the reproducer's sandbox
kind: work
state: proposed
created: 2026-11-21
project: HITLD-15
needs: [HITLD-30]
---

## Why

The reproducer (HITLD-30) merged with a best-effort sandbox, not a boundary: a plain file export with no repository, an isolated environment, Node's permission model, an in-process denial of network calls and signals, and a network and process-ID namespace where the machine allows it. The owner chose to merge with honest wording (decision HITLD-659) and to file this follow-up.

What is still open:

- Unix-domain sockets can be reached.
- Reads outside the export are limited only by Node's permission model.
- Machines without namespace support get only the in-process layer.
- Signalling processes outside the sandbox is blocked in-process only.
- The guard depends on the agent type the harness reports.

Nothing calls the reproducer automatically yet. That must stay true until this item is done, or the reproducer is refused when it cannot get a real boundary.

## Done when

- On supported machines the reproducer runs inside a network namespace and a mount namespace that shows only the export (bubblewrap or an equivalent), so unix sockets and reads outside the sandbox are blocked by the operating system, not by in-process checks.
- The runner reports truthfully, in its output and in the stored reproduction, which boundaries were actually enforced on this run.
- Where no real boundary is available, the reproducer refuses to run unattended. Intake (HITLD-29) cannot call it without the boundary.
- Tests show the boundary holds: a unix-socket connection, a read of a file outside the export and a signal to an outside process all fail inside the sandbox.
- The design's sandbox section (docs 10.2) is updated through a curator job and a design PR, not edited directly.

## Notes

Related: the security baseline (HITLD-34). Does not change what the reproducer already does when it runs; it changes what it may be trusted with.
