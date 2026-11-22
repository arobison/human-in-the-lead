---
id: HITLD-67
title: Consumer live
kind: milestone
state: planned
created: 2026-11-14
project: HITLD-15
outcome: A real consuming project runs its work through HITLd. The first one is this repository, running its own development on an installed release.
done_when:
  - "c1: The owner directs one item end to end (filed, dispatched, executed, merged and closed) through the chief of staff in the self-hosting cloud environment, on v0.1.0-rc.1 installed in this repository, or a pinned commit on main that carries the first-run fixes (the milestone's own constraints land after rc.1), with no prompt carried between sessions by hand."
  - "c2: The routine jobs of that run (merging through pull requests, tracker changes from the session, tracker upkeep, removing finished worktrees) are done by hitld commands, not by hand."
  - "c3: Every choice the owner makes in that run is recorded as a decision, and the trust and attention records show it."
  - "c4: The owner can see the plan, the milestones, what is happening now, and quota and spend in one generated page, dashboard.html."
constraints: [HITLD-26 c1, HITLD-109 c1, HITLD-46 c1, HITLD-47 c1, HITLD-60 c1, HITLD-142 c1, HITLD-74 c1, HITLD-144 c1, HITLD-147 c1, HITLD-148 c1, HITLD-149 c1, HITLD-124 c2, HITLD-125 c2, HITLD-130 c2, HITLD-131 c2, HITLD-132 c2, HITLD-133 c2, HITLD-136 c2, HITLD-141 c2, HITLD-150 c2, HITLD-151 c2, HITLD-153 c2, HITLD-134 c3, HITLD-135 c3, HITLD-62 c4, HITLD-152 c4, HITLD-160 c3, HITLD-349 c1, HITLD-681 c4, HITLD-691 c4, HITLD-692 c4, HITLD-693 c4, HITLD-694 c4, HITLD-695 c4, HITLD-737 c1, HITLD-738 c1, HITLD-740 c1, HITLD-742 c1, HITLD-739 c2, HITLD-280 c2, HITLD-741 c2, HITLD-743 c2, HITLD-746 c1, HITLD-752 c2, HITLD-758 c2, HITLD-759 c2, HITLD-258 c1, HITLD-272 c1, HITLD-255 c2, HITLD-256 c2, HITLD-261 c2, HITLD-269 c2, HITLD-285 c2, HITLD-286 c2, HITLD-284 c2, HITLD-292 c2, HITLD-274 c2, HITLD-748 c2, HITLD-780 c1, HITLD-781 c1, HITLD-777 c2, HITLD-778 c2, HITLD-763 c2, HITLD-764 c2, HITLD-765 c2, HITLD-766 c2, HITLD-767 c2, HITLD-729 c4, HITLD-732 c4, HITLD-789 c2, HITLD-795 c2, HITLD-796 c2, HITLD-792 c1, HITLD-793 c1, HITLD-798 c2, HITLD-799 c2, HITLD-800 c2, HITLD-797 c4, HITLD-806 c2, HITLD-254 c2, HITLD-204 c2, HITLD-804 c2, HITLD-805 c2, HITLD-807 c2, HITLD-552 c2, HITLD-553 c2, HITLD-814 c2]
check: demo the owner directing one item end to end through the chief of staff in the self-hosting environment, run by the owner
---

## Notes

Shaped on the owner's decision (2026-11-15): this repository, self-hosting, is the first consuming project, and the release item for v0.1.0-rc.2 (HITLD-137) needs this milestone. Setup through a package script (HITLD-25) is for an outside consumer and moved to v0.1.0 (HITLD-24).

On the owner's decision (2026-11-16, in the chief of staff session), the failures of the first self-hosted run join this milestone: HITLD-142, 144, 147, 148 and 149 under the first clause, because each made a prompt or an answer travel between sessions by hand, and HITLD-141, HITLD-150, HITLD-151 and HITLD-153 under the second (HITLD-153 added the same day, after the first run's dispatch start was refused with nothing running). HITLD-143, 145 and 146 are for v0.1.0.

On the owner's decision (2026-11-16, HITLD-176 and HITLD-177), the dashboard page joins this milestone as a fourth clause, built next: HITLD-152 and HITLD-62 under it. The clause wording is a proposal for the owner to amend.

On the owner's decision (2026-11-16, HITLD-178), HITLD-74 joins the first clause: two containers cannot share one store without it.

On the owner's decision HITLD-364 (2026-11-16), HITLD-160 (`rights record` leaves a decision item behind) joins the third clause as the one exception for rc.2, applied by the planning pass HITLD-343.

On the owner's decision (2026-11-21, HITLD-682), HITLD-681 joins the fourth clause with its build items (HITLD-691 to 695): the shared work-tracking UI that a project can extend without rebuilding it, all of it, before rc.2. This is wider than the page of clause four, and the owner chose it against the chief of staff's recommendation of the smallest slice (the data contract and declarative panels); the cost is that rc.2 waits for the design text, the build items and their review.

On the owner's decisions HITLD-736 and HITLD-735 (2026-11-22), the bugs that came from consumer use of rc.1 join this milestone: HITLD-737 and the decision HITLD-738 (executors lost when a print-mode orchestrator ends its turn, GitHub issue 455), HITLD-740 (the guard allowlist, issue 432) and HITLD-742 (the install docs, issues 427 and 426) under the first clause, and HITLD-739 (the follow-up gap for an interactive executor, which holds HITLD-691's pull request), HITLD-280 (the report parser, issue 430, also still listed in HITLD-404), HITLD-741 (the git hooks, issues 427 and 426) and HITLD-743 (the worktree files, issue 417) under the second. Out of this milestone: HITLD-744 (port rewriting, issue 417) and HITLD-745 (the planner's repeated offer, issue 431).

On the owner's decision HITLD-738 (2026-11-22, answer B), HITLD-746 (the Claude Code adapter starts print-mode executors detached from the orchestrator) joins the first clause; it stays proposed until it is designed with the owner.

On the owner's decision HITLD-751 (2026-11-22, GitHub issue 465), release packages join the second clause: the design (HITLD-752), its curator pass (HITLD-758) and the build (HITLD-759). The owner chose to design and build them before rc.2.

On the owner's decision (2026-11-22), three groups of older proposed items join this milestone and are now planned. Tracker and formatter breakers: HITLD-255 (GitHub issue 112), HITLD-256 (113), HITLD-261 (119), HITLD-269 (127), HITLD-285 (156) and HITLD-286 (157), under the second clause. Laptop setup: HITLD-272 (131) and HITLD-258 (115), under the first clause, because each stops a first run before an item can be directed. Silent failures: HITLD-284 (155), HITLD-292 (177) and HITLD-274 (137), under the second. HITLD-263 (121) is not included: the owner decided on 2026-11-20 (HITLD-606) that it closes when the quota probe HITLD-165 lands. The tracker lets one item serve several milestones, so each stays a constraint of the milestone it already serves. HITLD-282 (153) is held back: it needs HITLD-77 (confidential decisions in the private store), which is larger and still proposed.

On 2026-11-22, HITLD-748 (dispatch complete refuses a malformed report and records nothing) joins the second clause: three malformed reports in the first run were recorded and could not be corrected.

On the owner's decision HITLD-779 (2026-11-22), executors become a durable claim plus a stateless reconciler. HITLD-746 is reworded (durable print-mode executors, completion observed), and HITLD-780 (dispatch reconcile) and HITLD-781 (the guard identifies executors by claim branch, a security gap) join the first clause. HITLD-782 (the executor budget hook) stays proposed and outside rc.2.

On 2026-11-22, two items from the first runs join the second clause: HITLD-777 (the merge queue does not update or recheck a branch when main moved only under work/, a livelock with tracker merges) and HITLD-778 (the contract says exactly what the commit line of a report may hold).

On 2026-11-22, four small items from the first runs join the second clause: HITLD-763 (the store export never commits executor worktrees), HITLD-764 and HITLD-765 (execute-skill wording on question files and on pushing the branch for a pull request) and HITLD-766 (the chief-of-staff skill merges tracker-only pull requests out of band from the queue). The design item HITLD-767 (milestone merges) stays proposed.

On the owner's word (2026-11-22), the design item HITLD-767 (milestone constraints and notes merge cleanly) joins the second clause. It stays proposed until it is designed with the owner.

On 2026-11-22, HITLD-729 (build the shared React app, decided in HITLD-728) and HITLD-732 (the curator reword of HITLD-693 to 695) join the fourth clause, which they should have since the owner's UI decisions; HITLD-789 (a spelling fix in a test) joins the second.

On the owner's decision HITLD-794 and their word (2026-11-22), HITLD-795 (this repository's handover thresholds) and HITLD-796 (the chief of staff measures an orchestrator's context and the default thresholds drop) join the second clause.

On the owner's decisions HITLD-790 and HITLD-791 (2026-11-22), HITLD-792 (the plugin runs in cloud executor sessions, verified) and HITLD-793 (the guard allows pushing the executor's own claim branch) join the first clause: the HITLD-781 executor found that cloud executors were unguarded.

On the owner's decision HITLD-801 (2026-11-22), HITLD-798 (this repository's cap of 5 executors), HITLD-799 (the package default reserve of 10 percent) and HITLD-800 (the design text for it) join the second clause. The owner's person and machine files already say 5 executors and a 10 percent reserve; the run's scope still says 3 and the project's cap 4.

On the owner's word (2026-11-22), HITLD-797 (derived milestone and project progress) joins the fourth clause: milestones never showed progress because the design stores no in-progress state for them.

On 2026-11-22, HITLD-806 (the contract and the brief say each report list line starts with a dash) joins the second clause: the HITLD-764 executor's first report failed the shape check on 15 lines.

On the owner's decision HITLD-803 and their word (2026-11-22), HITLD-254 (how an owner decision reaches the orchestrator's permission checks), HITLD-204 (the executor ceiling is raised by one command and no run layer freezes it), HITLD-804 (the build) and HITLD-805 (the design text) join the second clause: the owner does not want to talk to the orchestrator.

On the owner's word (2026-11-22), HITLD-807 (every item the chief of staff names carries its title and a link to its file) joins the second clause: the owner cannot keep tickets straight by number.

On the owner's decision HITLD-809 (2026-11-22), HITLD-552 (the trust engine core) and HITLD-553 (merging registers with it) join the second clause, so ordinary code and docs can start earning automatic merges. The first unlock is more than a week after the build lands, because the bar needs merges aged 7 days.

On the owner's word (2026-11-22), HITLD-814 (the pull-request merge queue tests approved branches together in a batch) joins the second clause. It stays proposed until the owner designs it in a walk-through.
