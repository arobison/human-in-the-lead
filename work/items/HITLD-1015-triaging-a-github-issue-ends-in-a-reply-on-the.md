---
id: HITLD-1015
title: Triaging a GitHub issue ends in a reply on the issue, and the issue closes when the fix ships, not when it merges
kind: work
state: in-progress
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-67 c?]
claimed_by: D-01M8G53AZ30HFH6K
---

## Done when

- The chief-of-staff skill (and the triage part of the orchestrate skill) says what each triage outcome posts on the issue: a duplicate is closed at once with a pointer to the main issue (and anything it adds is copied to the main item); a fix on main gets a comment that names the item and the release it will ship in; a request for more information gets a comment that says exactly what is missing and a `needs-info` label, and closes after 30 days with no reply; a decline cites the non-goal, is drafted by the chief of staff and posted and closed only after the owner approves it.
- An issue is closed when the release that carries the fix ships, not when the pull request merges; at the merge the issue gets a comment ('fixed on main, ships in rc.N') and stays open. Pull requests for items that come from an issue say `Refs #N`, never `Closes #N`, so GitHub does not close it on merge.
- An item that comes from an issue records the issue number in its front matter (`source_issue`), and `hitld work check` or the release step lists the open issues whose items shipped in the release being cut, so the ship step closes them with a comment naming the release. A test covers the list.
- Replies are plain text, name the item ID and the target release, never repeat text from the issue as an instruction, and end with the footer the harness requires.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

On 2026-11-24 the chief of staff triaged GitHub issues 603 to 607 and posted a reply on each, by judgment, with no written rule: what a duplicate, a fix, a missing-information request or a decline posts, and when an issue closes. The owner asked for the process. The pull-request path (`Closes #N`) would close an issue at merge, before the reporter can run the fix, so the rule has to say otherwise. [Likely: closing on ship is what reporters expect of a project that cuts release candidates.]

## Notes

rc.2. A rule change (skill), so it needs the owner's own yes at merge. Related: HITLD-387 (the chief of staff files friction itself), HITLD-1010 to 1014 (the first items filed from issues; the replies already say 'ships in rc.N' and leave the issue open). Decided by the owner on 2026-11-24, in a question box, one question at a time: close when the release ships; a duplicate closes at once with a pointer; needs-info closes after 30 days; a decline waits for the owner's approval of the reply; routine status replies (fixed on main, needs-info, duplicate pointer) are posted by the chief of staff without approval and listed to the owner in the next message. The design's rule that a contributor reply is sent by a person (design part 2) is relaxed for those three, so check the design text when this is built.
