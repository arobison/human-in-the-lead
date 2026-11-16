---
id: HITLD-402
title: A new project adopts HITLd from the guide alone
kind: milestone
state: proposed
created: 2026-11-16
project: HITLD-15
outcome: A person following the install guide on a fresh clone gets the plugin, the contract block and a first dispatched item, with no hand fix and no misleading message.
done_when:
  - "c1: `npm run hitld:setup` installs the command and the plugin pinned to a tag, including the marketplace step and for desktop-app users, and the committed settings keep the pinned source and auto-update."
  - "c2: The contract block survives prettier and markdownlint, and `hitld check contract` still passes."
  - "c3: Setup and first-run refusals name the real cause: the settings write, `hitld ready` on a branch, a credential helper set at the installation level, and work from more than one machine."
constraints: [HITLD-25 c1, HITLD-262 c1, HITLD-263 c1, HITLD-264 c1, HITLD-273 c1, HITLD-256 c2, HITLD-258 c3, HITLD-260 c3, HITLD-271 c3, HITLD-272 c3]
check: demo someone other than the authors follows the new-project guide on a fresh fixture clone and ends with one item merged and closed, the steps recorded
---

## Notes

Proposed by the planning pass HITLD-343 on the owner's decision HITLD-363; the owner commits it later. Stage: v0.1.0-rc.4 (HITLD-401). Most of its constraints come from the first outside consuming project's reports.
