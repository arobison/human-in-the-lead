---
id: HITLD-807
title: Every item the chief of staff names to the owner carries its title and a link to its file
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
needs: [HITLD-766]
constraint_of: [HITLD-67 c2]
---

## Done when



## Why

The owner said (2026-11-22) that they cannot keep tickets straight when the chief of staff names them by number alone, and asked for the rule to be added to the chief-of-staff skill: every time an item is named, its title goes with it, and a link to its file lets them open and read it. Today the skill only forbids a bare `#N` for pull requests and issues.

## Done when

- `skills/chief-of-staff/SKILL.md` (and the plugin copy) says that every message to the owner that names an item by ID also gives its title, and the first time in a message a link to the item's `.md` file on the repository's main branch (the pull request branch while it is not yet on main). A list of items has the title on each line.
- `hitld work show` (or a new `hitld work ref <ids>`) prints `ID: title (link)` for each ID, from the repository's remote and the item's path, so the chief of staff does not write titles from memory; a test covers an item on main and one that is not yet there.
- The orchestrate skill's message shape asks the orchestrator to give titles in what it sends the chief of staff.
- A skill change reaches main only with the owner's own yes. `hitld work check` and the offline eval gate pass.
