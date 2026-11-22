---
id: HITLD-825
title: `hitld work publish` restores or removes its working copies after the pull request is open
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-191 c2]
---


## Why

After every tracker pull request the working copies have to be reset by hand (`git reset`, `git checkout` for tracked files, `rm` for new ones) so the Stop hook is satisfied. On 2026-11-22 a glob in that cleanup deleted a tracked file (HITLD-812) that an earlier pull request had merged; it was restored, but the hand-run cleanup is fragile and repeated about twenty times in a session.

## Done when

- `hitld work publish --finish` (or the default after the pull request exists on the remote) restores tracked files it published to main's version and removes new ones, only the files it published, and prints what it did.
- It refuses when the pushed branch does not hold the file's current content.
- Tests cover a new file, a tracked modified file and a file changed after publishing. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Filed on 2026-11-22 from the owner's request to propose tickets for the session's mistakes and friction.
