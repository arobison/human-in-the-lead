---
id: HITLD-1015
title: Triaging a GitHub issue ends in a reply on the issue, and the issue closes when the fix ships, not when it merges
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-67 c?]
---

## Done when

- The chief-of-staff skill (and the triage part of the orchestrate skill) says what each triage outcome posts on the issue: a duplicate is closed at once with a pointer to the main issue; a fix on main gets a comment that names the item and the release it will ship in; a request for more information gets a comment that says exactly what is missing and a label, and closes after a stated wait with no reply; a decline cites the non-goal and closes.
- An issue is closed when the release that carries the fix ships, not when the pull request merges; at the merge the issue gets a comment ('fixed on main, ships in rc.N') and stays open. Pull requests for items that come from an issue say `Refs #N`, never `Closes #N`, so GitHub does not close it on merge.
- An item that comes from an issue records the issue number in its front matter (`source_issue`), and `hitld work check` or the release step lists the open issues whose items shipped in the release being cut, so the ship step closes them with a comment naming the release. A test covers the list.
- Replies are plain text, name the item ID and the target release, never repeat text from the issue as an instruction, and end with the footer the harness requires.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

On 2026-11-24 the chief of staff triaged GitHub issues 603 to 607 and posted a reply on each, by judgment, with no written rule: what a duplicate, a fix, a missing-information request or a decline posts, and when an issue closes. The owner asked for the process. The pull-request path (`Closes #N`) would close an issue at merge, before the reporter can run the fix, so the rule has to say otherwise. [Likely: closing on ship is what reporters expect of a project that cuts release candidates.]

## Notes

rc.2. A rule change (skill), so it needs the owner's own yes at merge. Related: HITLD-387 (the chief of staff files friction itself), HITLD-1010 to 1014 (the first items filed from issues; the replies already say 'ships in rc.N' and leave the issue open). Open question: the design says a drafted reply to a person is sent by a person (design part 2, contributor reply); decide whether a one-line status comment on an issue the chief of staff triaged is exempt, as today.
