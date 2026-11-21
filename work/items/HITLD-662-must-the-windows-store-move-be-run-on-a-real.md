---
id: HITLD-662
title: Must the Windows store move be run on a real Windows machine before it merges?
kind: decision
state: done
created: 2026-11-20
project: HITLD-15
decider: owner
answer: B
answered_at: 2026-11-21T04:49:58.532Z
answered_via: question-tool
answered_by: owner
---

## Question

The move of the private stores to the local app-data folder was tested on Linux with the platform faked. Should #410 wait for a real Windows run?

Pull request 410 (HITLD-249). Review fixes are in progress. A rename with a file held open, cross-drive copies, folder redirection and git worktree repair cannot be tested on Linux. The change moves private data once per machine.

## Options and recommendation

- A. Yes, hold #410 for a Windows run: Someone runs it once on a real Windows machine and reports the result before it merges.
- B. No, merge after the fixes: Rely on the fault-injection tests; a problem is fixed when someone hits it.

Recommended: Yes, hold #410 for a Windows run. It moves private data, and the failure paths are exactly the ones Linux cannot show.

## Answer

Open.
