---
id: HITLD-918
title: The build-systems rc.2 slice is five small items
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. These five items in rc.2: Fixes the reported symptoms and lands the schema."
answered_at: 2026-11-22T20:54:33.511Z
answered_via: question-tool
answered_by: owner
---

## Question

What goes into rc.2 from the build-systems design (HITLD-883 decision 10 of 12)?

Schema and built-in profiles; the dependency trigger from profiles; version sources beyond package.json in the profile, with a migration; one skip-folders helper; non-npm guide examples.

## Options and recommendation

- A. These five items in rc.2: Fixes the reported symptoms and lands the schema.
- B. Only items 1, 2 and 4: Release stays npm-only in rc.2.
- C. All of the staged plan in rc.2: Larger rc.2.

Recommended: These five items in rc.2. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
