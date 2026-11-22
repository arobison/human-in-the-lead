---
id: HITLD-755
title: "Release lines: how the public interface is measured"
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. A committed surface file per line: The project's own tool produces and commits a surface file; release propose diffs it between the last tag and now: added lines only is minor, a removed or changed line is major (minor while 0.y.z), no change is patch; the owner still confirms minor and major."
answered_at: 2026-11-22T02:03:15.206Z
answered_via: question-tool
answered_by: owner
---

## Question

HITLD-752 question 3: how does HITLD measure a line's public interface to propose a version bump?

Today it reads HITLD's own schemas, command table and contract.

## Options and recommendation

- A. A committed surface file per line: The project's own tool produces and commits a surface file; release propose diffs it between the last tag and now: added lines only is minor, a removed or changed line is major (minor while 0.y.z), no change is patch; the owner still confirms minor and major.
- B. A declared command prints the interface: HITLD runs an owner-approved command at each tag.
- C. Items declare the change kind: The highest declared kind among items since the last tag.

Recommended: A committed surface file per line. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
