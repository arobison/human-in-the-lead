---
id: HITLD-202
title: work publish leaves the files it published untracked on main
kind: work
state: done
created: 2026-11-16
project: HITLD-15
needs: [HITLD-125]
claimed_by: D-56
---

## Why

`hitld work publish` commits the tracker files a session changed on a new branch from the remote's main, pushes it, and prints the pull request to open. It leaves the same files untracked in the working tree on main. The Stop hook then reports untracked files and asks for a commit to the current branch (main), which is not allowed, and a later `git pull` of the merged pull request would stop on "untracked files would be overwritten". Seen in the first self-hosted run after recording six decisions (HITLD-195 to 200): the files had to be removed by hand once the pushed branch was confirmed to hold them.

## Done when

- After a successful publish the working tree is clean: the published files are removed from main's working tree, or left as tracked changes that the pull request's merge absorbs, and the command says which.
- A test publishes from main with new items and checks that `git status` afterwards shows no untracked published file, only the published files staged (`A`/`M`) with the pushed content and the working copies untouched, and that a later fast-forward pull (`git pull --ff-only`) of the merged result works and leaves `git status` clean. A status-based Stop hook can still fire on those staged changes until the merge; that needs a hook exception for the publish flow or harness feedback, as the second sighting below says, and is outside this item.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Found by the chief of staff and filed under HITLD-181. Builds on HITLD-125. Whether the squash commit carries the owner's delegated sign-off is a separate question and belongs to HITLD-179.

## Second sighting on 2026-11-20 (the retrospective, HITLD-589)

The harness's Stop hook demanded again, at the end of a turn, that untracked files be committed and pushed "to the remote branch". The files were decision records that `hitld work publish` had already pushed to a `hitld/tracker-*` branch for a pull request, so they stayed untracked on main until the pull request merged. Committing them to the session branch would have duplicated them and left a divergent branch; the chief of staff removed the local copies instead. The cause is the one above (published files stay untracked on main), made worse by the hook asking for a push to a different branch than the publish flow uses. The fix this item asks for (untracking or removing the published copies once published) also clears the hook; if the hook still fires for files published but not yet merged, the hook needs an exception for the publish flow, which is outside this project and is raised as feedback.
