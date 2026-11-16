---
id: HITLD-202
title: work publish leaves the files it published untracked on main
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
needs: [HITLD-125]
---

## Why

`hitld work publish` commits the tracker files a session changed on a new branch from the remote's main, pushes it, and prints the pull request to open. It leaves the same files untracked in the working tree on main. The Stop hook then reports untracked files and asks for a commit to the current branch (main), which is not allowed, and a later `git pull` of the merged pull request would stop on "untracked files would be overwritten". Seen in the first self-hosted run after recording six decisions (HITLD-195 to 200): the files had to be removed by hand once the pushed branch was confirmed to hold them.

## Done when

- After a successful publish the working tree is clean: the published files are removed from main's working tree, or left as tracked changes that the pull request's merge absorbs, and the command says which.
- A test publishes from main with new items and checks that `git status` is clean afterwards and that a later fast-forward pull of the merged result works.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Found by the chief of staff and filed under HITLD-181. Builds on HITLD-125. Whether the squash commit carries the owner's delegated sign-off is a separate question and belongs to HITLD-179.
