---
id: HITLD-110
title: "Upgrades on a pin change: drift detection, an upgrade plan, and upgrading at a hand-over"
kind: work
state: done
created: 2026-11-15
project: HITLD-15
claimed_by: D-110
release_note: "`hitld run start` and `run resume` refuse when the running plugin is not the pinned release (`version-not-pinned`), before anything is pulled or recorded, and say how to fix it; a SessionStart hook reports drift. `hitld upgrade plan` lists, by role, what a pin change needs. `hitld install` turns off automatic updates for the plugin. The chief of staff upgrades only at a hand-over."
---

## Why

A project runs the HITLd release its pin names, and moving the pin is a PR the owner merges (HITLD-109). Today nothing checks that the running plugin matches the pin, or tells people and agents what an upgrade needs and when. A harness that updates plugins on its own would move the running version under a pinned project without anyone deciding it. The owner decided this lands before v0.1.0-rc.1.

## Done when

- How Claude Code installs, caches and updates a marketplace plugin pinned to a ref (including any automatic update) is checked against its current documentation, and design 16.5 states what HITLd relies on.
- At session start and `hitld run start` / `run resume`, `hitld` compares the running plugin's version, the pin in `.claude/settings.json`, and the release that last wrote the tracker and the private store (the ledger's `run-started`). A running version that is not the pinned one refuses a run with `version-not-pinned` and says how to fix it (move the pin by a PR, or turn off automatic updates for this plugin); a pin ahead of what wrote the data says an upgrade is due.
- `hitld upgrade plan` reads the target release's notes and interface delta and lists, in order, what to run (`hitld work migrate`, `config migrate`, `data migrate`, a session restart so skills and hooks reload) and what each person and agent role does; it changes nothing.
- The chief of staff upgrades only at a hand-over: the orchestrator drains, the plan runs, the successor starts on the new version; executors still running on the old version finish, and their reports are accepted within the same minor. The skills say so.
- Rolling back is reverting the pin commit; the no-writing-ahead rule keeps an older release from touching newer data, and a test shows it.
- `npm run check`, the offline eval gate and `hitld work check` pass.
