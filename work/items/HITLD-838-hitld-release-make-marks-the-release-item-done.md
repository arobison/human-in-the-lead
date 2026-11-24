---
id: HITLD-838
title: `hitld release make` lists the release item in the release record, so the item records the release it shipped in
kind: work
state: done
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c2]
claimed_by: D-01M860KWV74HH54J
release_note: "`hitld release make` lists the release item under the release record's `items`, so the item records the release it shipped in; a dropped release item is left out. The item stays open until its release is published and is closed by hand after that."
---

## Why

Reported as GitHub issue 519 (friction, release area, 0.1.0-rc.1), filed by the owner through `hitld feedback` on 2026-11-22. Running the release command against a release item wrote the release record and the tag and listed the shipped items and milestones, but left the release item in the planned state; `hitld work close` then refused it, because it closes only items a branch has claimed, and the item was edited by hand in a follow-up commit. The same happened to HITLD's own release item. `core/lib/release/make.mjs` does not touch the release item's state; this release (HITLD-137, rc.2) will hit it.

## Done when

- `hitld release make` lists the release item (the item whose `release:` names the version made) under `items` in the release record, in the same commit as the record; a dropped release item is left out.
- It does not change the release item's state: the item stays open until its release is published and is closed by hand after that (the owner's decision, 2026-11-24).
- `03-data-model.md`, `16-packaging.md` and the comment in `core/lib/tracker/files/closing.mjs` say so, and none of them says the release command marks the item done.
- Tests cover a release item listed with its state unchanged, a dropped release item, and a release with no release item.
- A release change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.
