---
id: HITLD-249
title: The private store lives under %LOCALAPPDATA% on Windows, with XDG_DATA_HOME still overriding and a one-time move of an existing store
kind: work
state: in-progress
created: 2026-11-16
project: HITLD-15
needs: [HITLD-243, HITLD-153]
claimed_by: D-58
release_note: "On Windows the private stores and the machine file live under `%LOCALAPPDATA%\\human-in-the-lead` (`XDG_DATA_HOME`, when set, still overrides it on every platform). The first time `hitld` resolves a store or the machine file still at the old `~/.local/share/human-in-the-lead`, it moves it there and says so, unless it is in use (executor worktrees, a live run lease, a live resource lock); then it stays and is used where it is until a later run. Stop every session on an older plugin version, and upgrade every project on the machine at once, before the move: a session on an older release keeps using the old place, and what it writes there is merged only where no file is at both places. Known limits: a reused Windows process ID reads as a live holder (the move waits); the run lease is read only from the store's run-state.json; an executor's progress hook says nothing while a move is interrupted; a copy across volumes does not keep directory modes."
---

## Why

Ordering (the owner, in the chief of staff session): this waits for HITLD-153, so the planner builds the fix for a finished-but-unmerged item holding a slot first. It is an ordering choice, not a technical dependency.

The owner decided (HITLD-245) that the store moves from `~/.local/share/human-in-the-lead/<id>` to `%LOCALAPPDATA%\human-in-the-lead\<id>` on Windows, before outside users rely on the old path. PR #186 (Windows) left it alone as a decision.

## Done when

- On Windows the default store directory is `%LOCALAPPDATA%\human-in-the-lead\<id>`; `XDG_DATA_HOME`, when set, still overrides it on every platform.
- A store found at the old Windows location is moved once, with a message and without losing a file; a second run does nothing.
- The install guide and the design (part 16, the store path) say the Windows location.
- A test covers the default, the override and the one-time move (on Windows only where a path test needs it).
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

From the owner's decisions on the open questions in the Windows pull request (PR #186, HITLD-243). Needs HITLD-243: the pull request changes the same code.

## Known limits (from the reviews of PR 410)

- Liveness of a resource lock holder is a process ID check: on Windows a reused process ID reads as alive, which only delays the move of `_machine`.
- The live-lease check reads only `<store>/run-state.json`; a missing or unreadable one counts as no lease.
- The executor check is `executorSignal`: the environment (`HITLD_ROLE`, `HITLD_DISPATCH`) or a linked worktree as the working directory.
- No fsync before the aside copy is removed after a cross-volume copy: a power cut right after could lose data the file system had not yet written. A complete copy is recognized by a marker written into it before it is renamed into place, not by comparing contents.
- A store found at both places is merged only for paths the store lacks, each with a hard link or an exclusive copy, so nothing in the store is overwritten; a path at both (a ledger above all), a file in one place where the other has a directory, and anything under `.git` are left for the person, with the steps, said once a day. Only empty directories are removed afterwards, so a file written into the stray copy meanwhile stays and moves on a later run.
- The progress hook for an executor swallows the interrupted-move error, so the watchdog sees no progress from it while a move is interrupted.
- A copy across volumes keeps file modes but not directory modes (0700 becomes 0755 on POSIX; Windows does not enforce POSIX modes).

## Windows checks still needed

Everything above was verified on Linux with the platform injected. Still to check on Windows: that a junction reports `isSymbolicLink` in `lstat`; the real error codes (EBUSY, EPERM, EACCES) for a rename of a directory held open; MoveFileEx replace-on-rename semantics; whether C: to D: gives EXDEV; a real move across drives; hard links and exclusive copies for the absorb, and case-insensitive path matching there; 260-character paths with the long temporary names; `cpSync` on Windows; `isAlive` and process ID reuse; antivirus holds during the copy and the removal; the cost of the git spawn in `executorSignal` from hooks; a redirected `%LOCALAPPDATA%`; NTFS permissions after a rename compared with a copy.
