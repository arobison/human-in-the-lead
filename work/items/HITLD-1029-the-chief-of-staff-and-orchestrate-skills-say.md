---
id: HITLD-1029
title: The chief-of-staff and orchestrate skills say how to record an owner's approval of a pull request the queue has not presented
kind: work
state: done
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-67 c?]
claimed_by: D-01M8HECVV7W001QM
---

## Done when



- `skills/chief-of-staff/SKILL.md` (the owner-mode merge bullet, near line 105) says that when the owner approves a pull request the queue has not presented yet, the approval is recorded with `merge approve --only <branch> --head <sha> --signoff "<the owner's sign-off>"`, `--head` naming the head the owner saw; it applies when the queue presents that head, and it is dropped if the branch is sent back or the head changes by anything but a merge of main the queue or the executor pushed.
- `skills/orchestrate/SKILL.md` (near lines 134 and 156) mentions that an approval can arrive before a presentation and that plain `hitld merge` applies it.
- A skill check or eval case, if the skill checks cover wording of this kind, pins both sentences. `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

HITLD-821 (PR 622) lets an owner approval be recorded for a pull request head before the queue presents it. Both skills describe `merge approve` only as an answer to a presented batch, so an agent following them would not know the early form exists. [Certain: the executor of HITLD-821 reported it; the lines are as quoted.]

## Notes

rc.2 or later. Skill change, so it needs the owner's own yes at merge. Edits the same files as HITLD-387, HITLD-1015 and HITLD-1020; build them in order to avoid conflicts. Needs HITLD-821 merged first.
