---
id: HITLD-15
title: "Ready for consuming projects and the first release"
kind: project
status: Planned
created: 2026-11-14
initiative: HITLD-1
lead: owner
milestones: [safe-to-publish, settings-hold, first-release, consumer-live]
---

## Summary

## Milestones

Named here in the format as built; HITLD-45 migrates them into milestone entities (design 3.2, "Milestones and releases"). Items marked with a milestone are its constraints. Items with none (HITLD-19 to HITLD-21, HITLD-27) are contributions.

- **safe-to-publish** (capability). Outcome: anyone can read the public repository, and nothing in it or its history should not be there. Done when: the confidentiality pass finds nothing open, and the owner has finished the guided design review. Check: an independent scan of the repository and its history. Constraints: HITLD-22, HITLD-23.
- **settings-hold** (capability). Outcome: two projects on one machine share the person's limits without stepping on each other. Done when: check 11 of One signal end to end (part 21) passes on fixture projects. Check: that integration test. Constraints: HITLD-37 to HITLD-40.
- **first-release** (capability). Outcome: a consuming project can pin a released version that already has the milestone and release format. Done when: v0.1.0 is tagged with a release record, and a fresh clone of a fixture consumer installs it pinned (check 10 of One signal end to end). Check: that install test. Constraints: HITLD-18, HITLD-45, HITLD-58, HITLD-59, HITLD-63, HITLD-24 (and the commit guard, HITLD-51).
- **consumer-live** (capability). Outcome: a real consuming project runs its work through HITLd. Done when: the consumer's setup runs from a package script, and the live test reports items dispatched and merged there. Check: the owner's live test. Constraints: HITLD-25, HITLD-26, HITLD-46, HITLD-47, HITLD-60 (the live test is where feedback on HITLd starts).
