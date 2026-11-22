---
id: HITLD-757
title: "Release lines: what happens to the existing releases"
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "B. Migrate existing releases into a named main line: A migration renames old tags and records under a line called main; one model afterwards."
answered_at: 2026-11-22T02:03:22.560Z
answered_via: question-tool
answered_by: owner
---

## Question

HITLD-752 question 5: what happens to the existing repository-wide releases and the release workflow when lines are added?

Existing tags like v0.1.0-rc.1 are pinned by consuming projects; migrating them is a one-way door.

## Options and recommendation

- A. Existing line stays as is, named lines added beside it: No migration; today's tags, records and workflow keep working as an implicit unnamed line.
- B. Migrate existing releases into a named main line: A migration renames old tags and records under a line called main; one model afterwards.

Recommended: Existing line stays as is, named lines added beside it. The chief of staff recommended leaving the existing line as is; the owner chose to migrate.

## Answer

Recorded in the front matter once answered.
