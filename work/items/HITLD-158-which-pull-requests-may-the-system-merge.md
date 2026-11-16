---
id: HITLD-158
title: Which pull requests may the system merge without asking the owner
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Tracker-only now, then earn the rest: owner_paths lists everything except work/, so pull requests touching only tracker files merge on green. Code, workflows, schemas and skills wait. After N approved merges in an area with none reverted, the system proposes widening it and the owner decides each time."
answered_at: 2026-11-16T01:06:48.038Z
answered_via: question-tool
answered_by: owner
---

## Question

Which pull requests may the system merge without asking the owner, once their checks pass?

Today every pull request waits for the owner. Design 14 has owner_paths, a list of paths that always wait so a pull request touching nothing on it merges on green, and propose_queue_after, where after enough approved merges in an area with none reverted the system proposes letting that area through and the owner decides. The system never changes these settings itself. Raised for HITLD-150 after the owner said waiting on tracker pull requests was costing their attention.

Reversibility: two-way.

## Options and recommendation

- A. Tracker-only now, then earn the rest: owner_paths lists everything except work/, so pull requests touching only tracker files merge on green. Code, workflows, schemas and skills wait. After N approved merges in an area with none reverted, the system proposes widening it and the owner decides each time.
- B. A path list the owner maintains: The owner sets owner_paths themselves, with no earn-the-queue proposals unless they turn them on.
- C. Everything keeps waiting: No change to who merges. HITLD-150 shrinks to making the existing owner-mode settings work on the pull-request path.

Recommended: Tracker-only now, then earn the rest. It removes the tracker-pull-request wait today and hands over no code.

## Answer

Recorded in the front matter once answered.
