---
id: HITLD-343
title: Every open work item sits under a milestone, and the empty milestones are filled in
kind: work
state: in-progress
created: 2026-11-16
project: HITLD-15
claimed_by: D-29
---

## Done when

The owner decided the structure in a walk-through on 2026-11-16 (decisions HITLD-358 to 376). The placement tables are in the appendix below; where the owner decided differently, the decision wins (listed under Notes).

- **Milestones.** Every open work item (proposed or planned) is under a milestone as a constraint, or a new milestone holds it. The seven new milestones (adoption from the guide; a consuming project's tracker; a dispatched item reaching main without a hand fix; the chief of staff telling the owner what is true; Windows; the owner giving each answer once; measuring its own work) are created as `proposed` milestones with an outcome, done-when clauses and a check each; the owner commits each one later, one at a time. HITLD-189, 190, 191 and 192 are re-scoped as the rc.3 milestones (their met clauses and misplaced items removed). HITLD-36 goes under a new milestone under HITLD-53 with decision HITLD-44. The eight empty milestones (HITLD-1, 64, 65, 66, 68, 69, 70, 71) get the drafted outcome, clauses and check (appendix section 4), constraints linked to clauses. HITLD-1 stays after v0.1.0 and keeps HITLD-67 as a constraint.
- **Release stages (one release item per version, so the stages are release items that need milestones).** rc.2 (HITLD-137) stays HITLD-67 only, plus HITLD-160. New release items for rc.3 (the self-hosted run holds up) and rc.4 (an outside project adopts it), each with its gate, needing the previous stage. HITLD-24 (v0.1.0) replaces its six open direct needs by the rc.4 release item, HITLD-64, HITLD-66 and HITLD-333; HITLD-24 needs HITLD-66, and HITLD-66 no longer lists HITLD-24. HITLD-24 keeps its chain through HITLD-146 to HITLD-57 (the owner's choice, HITLD-361). The dashboard's Releases lane shows the stages through these needs.
- **Dependencies.** Apply the 21 dependency edits of appendix section 6 as written, each with its evidence in the commit message, except #1, #2, #16 and #25 (decided or skipped), plus: HITLD-228 needs HITLD-203; HITLD-282 needs HITLD-77; HITLD-25 needs HITLD-262 and HITLD-273; HITLD-219 needs HITLD-165 (and is dropped when 165 merges unless a need remains).
- **No contributions yet.** The 15 items the appendix places as contributions (HITLD-154, 165, 290, 296, 315, 76, 220, 267, 268, 339, 55, 138, 127, 291, 43) are placed as constraints of the milestone clause each serves instead (the owner's decision HITLD-377, replacing HITLD-374): no placeholder values, and the orchestrator cannot cut them as low value. Whether contributions stay in the design is HITLD-378.
- **Kept as items.** HITLD-43 and HITLD-26 are kept (HITLD-368, 369): place HITLD-43 as the proposal says and keep HITLD-26 as the demo record. HITLD-229, 298, 300 and 296 are put to the owner as decisions later (HITLD-367); the executor lists them and does not decide them.
- `work check` warns on an open work item under no milestone (an error from the release after the pass), so the rule holds from then on.
- Only files under `work/` change, plus the one check. `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

The owner asked for a pass over the work items and milestones, to make sure they are all filled out correctly with correct dependencies, to add missing work items, and to lay out the rc stages on the way to v0.1.0 (2026-11-16). A scan found 115 of 134 open work items under no milestone, and 8 of the 10 planned milestones with no outcome, clauses or check (shells left by the structure migration). The owner chose the rule (HITLD-345): all items are either placed in a milestone or a new milestone is created for them.

## Notes

The owner's decisions that differ from, or add to, the appendix: HITLD-361 keeps v0.1.0 waiting on the end-to-end eval runner (so HITLD-146 keeps its eval clause, and HITLD-70's first clause lands before v0.1.0 rather than after); HITLD-366 gives HITLD-36 its own milestone under HITLD-53; HITLD-368 and 369 keep HITLD-43 and HITLD-26; HITLD-370 to 372 keep each pair as two items with a `needs` edge; HITLD-376 accepts the proposal's placements as the first pass, to be reviewed on the dashboard. The `release` field cannot sit on every item (one release item per version, `hitld work check`), so items inherit their version through their milestone.

The placements, milestone drafts and release gates in the appendix are the chief of staff's working proposal, read from the tracker on main at commit dccce7a. Where a row is marked low confidence, flag it in the commit message. The pass is large: do the milestones and release items first, then the placements, then the dependency edits, as separate commits.

## Appendix: the placement proposal (working paper, 2026-11-16)

### 2. Placement table

One row per open work item (134), grouped into 11 batches the owner can answer together, in stage order. "As" is how the tracker stores it: a constraint (a `needs` from the milestone, linked to a clause) or a contribution (value and confidence, not needed for the outcome). New milestones are named by outcome and marked "New". Flags are evidence for a stale, duplicate, already-handled or drop question; they recommend, they do not decide.

#### Batch 1. rc.2: Consumer live (confirm only)

| ID | State | Title (short) | Suggested milestone | As | Conf. | Reason | Flag |
|---|---|---|---|---|---|---|---|
| HITLD-137 | planned | Release v0.1.0-rc.2 | release item for 0.1.0-rc.2 | release item | high | the rc.2 release item; needs HITLD-67 and HITLD-140 |  |
| HITLD-24 | planned | Release v0.1.0: version, tag, notes | release item for 0.1.0 | release item | high | the v0.1.0 release item; should need HITLD-66, not be its constraint | circular: HITLD-66 constrains it, its Done-when needs HITLD-66 checked |
| HITLD-74 | planned | Ledger and dispatch IDs from per-machine blocks, so store sync does ... | HITLD-67 | constraint | high | already c1 of Consumer live |  |
| HITLD-109 | planned | Self-host: install rc.1 into this repository through its own PR, then ... | HITLD-67 | constraint | high | already c1 of Consumer live | waits on external HITLD-349 |
| HITLD-147 | planned | Orchestrators enforce that every executor reports up the chain before ... | HITLD-67 | constraint | high | already c1 of Consumer live | also a constraint of HITLD-192, where it does not fit |
| HITLD-148 | planned | A cloud session starts with the owner's settings and the machine's ... | HITLD-67 | constraint | high | already c1 |  |
| HITLD-149 | planned | A usage figure the owner declares reaches the quota gate in a cloud ... | HITLD-67 | constraint | high | already c1 |  |
| HITLD-151 | planned | Remove the Claude five-hour limit from the design, defaults, code, ... | HITLD-67 | constraint | high | already c2 | still open in code: claude-five-hour in schemas/policy/quota.schema.json |

#### Batch 2. rc.3: checks and planner (HITLD-189, re-scoped)

| ID | State | Title (short) | Suggested milestone | As | Conf. | Reason | Flag |
|---|---|---|---|---|---|---|---|
| HITLD-154 | planned | When a wait is eating the owner's attention, the system says it is ... | HITLD-189 | contribution | medium | a wait that eats attention changes the plan | large; design-heavy |
| HITLD-165 | proposed | A quota probe records the real rate-limit reading the claude command ... | HITLD-189 | contribution | medium | a measured usage reading so the gate offers the right work | proposed, but its choices are settled (HITLD-168 to 173): ready to commit |
| HITLD-185 | planned | CI installs the age program so its interoperability tests run, and ... | HITLD-189 | constraint | high | CI runs the skipped age tests |  |
| HITLD-201 | planned | Eval scenarios do not share the real private store, and an earlier ... | HITLD-189 | constraint | medium | eval scenarios share a store: a flaky gate | may already be fixed by HITLD-131 (its own note); first step verifies |
| HITLD-235 | planned | A probe tells whether a harness can run headless before tier 3 is ... | HITLD-189 | constraint | medium | probe headless ability before tier 3 | could share a probe with HITLD-253 and HITLD-165 |
| HITLD-241 | planned | The synchronous mutex retries when its lock directory is moved aside ... | HITLD-189 | constraint | high | mutex race makes CI flaky |  |
| HITLD-253 | planned | A tier-2 start does not fail when the plugin's agents are not ... | HITLD-189 | constraint | high | the planner never offers a tier-2 start that will fail |  |
| HITLD-278 | proposed | The dispatch planner ignores the run's scope.items and offers items ... | HITLD-189 | constraint | high | the planner ignores run scope.items (issue #148) |  |
| HITLD-290 | proposed | A flake fix proves itself by being deterministic and by a mutation, ... | HITLD-189 | contribution | medium | a flake fix proves itself cheaply |  |
| HITLD-293 | proposed | Briefs and the execute skill tell executors to run the pinned CodeQL ... | HITLD-189 | constraint | medium | executors run CodeQL before reporting, so PRs do not fail late | a rule change: owner decides |
| HITLD-296 | proposed | Unused locals on main that tsc --noUnusedLocals flags (nameList, ... | HITLD-189 | contribution | low | unused locals | tiny; drop candidate if the flag stays off |
| HITLD-315 | proposed | Executors run the right tests at the right times: a test cadence that ... | HITLD-189 | contribution | medium | test cadence and a learning loop | large and design-heavy; could go under the learning milestone |
| HITLD-353 | proposed | The owner can hold the run with one setting, and the planner offers ... | HITLD-189 | constraint | high | one owner setting holds the run | untracked file in the checkout at the time of reading (not yet merged) |

#### Batch 3. rc.3: routine jobs by command (HITLD-191, re-scoped)

| ID | State | Title (short) | Suggested milestone | As | Conf. | Reason | Flag |
|---|---|---|---|---|---|---|---|
| HITLD-49 | planned | Close by trailer at merge, and the consistency check on main | HITLD-191 | constraint | medium | closing by trailer keeps the tracker true after hand merges | planned since 2026-11-14, never offered |
| HITLD-76 | planned | Stacked pull requests: dependent items as a GitHub stack, merged in ... | HITLD-191 | contribution | low | stacked pull requests: a later merge feature | needs decision HITLD-27 (open since 2026-11-14) |
| HITLD-143 | planned | Reversible tracker edits by the chief of staff and orchestrator land ... | HITLD-191 | constraint | high | reversible tracker edits land without per-change approval; v0.1.0 need |  |
| HITLD-160 | planned | rights record leaves a decision item behind when the trust event is ... | HITLD-191 | constraint | medium | recording an owner choice must not need hand cleanup | a bug against HITLD-134 (Consumer live c3) |
| HITLD-167 | planned | Finished executor sessions are ended by the chief of staff when their ... | HITLD-191 | constraint | high | ending finished sessions is routine upkeep |  |
| HITLD-202 | planned | work publish leaves the files it published untracked on main | HITLD-191 | constraint | high | work publish leaves main dirty |  |
| HITLD-203 | planned | The Agent-Model trailer carries the model ID, not the family name | HITLD-191 | constraint | medium | trailer carries the model ID | blocked by session rules outside the repository (its notes); merge with HITLD-228 |
| HITLD-218 | planned | The chief of staff's merge routine: current head, required checks, ... | HITLD-191 | constraint | high | the merge routine written down once |  |
| HITLD-220 | proposed | Design: a curator dispatch role, and how each kind of sweep finding ... | HITLD-191 | contribution | medium | design of a curator role for tracker upkeep |  |
| HITLD-228 | planned | work claim and work close commits carry the Agent-Role, Agent-Model ... | HITLD-191 | constraint | high | claim and close commits carry the agent trailers | merge with HITLD-203 |
| HITLD-252 | planned | Published refs are pruned once their branch has merged | HITLD-191 | constraint | medium | pruning published refs is routine upkeep |  |
| HITLD-288 | proposed | Hitld rights reverse writes only to the trust record, so the ... | HITLD-191 | constraint | medium | rights reverse reaches the orchestrator (issue #160) | HITLD-143 relies on rights reverse |
| HITLD-297 | proposed | work publish takes its role and trailers from defaults so the command ... | HITLD-191 | constraint | high | work publish defaults, so a permission rule matches it |  |

#### Batch 4. rc.3: hand-over across containers (HITLD-190, re-scoped) and the plan page (HITLD-192, re-scoped)

| ID | State | Title (short) | Suggested milestone | As | Conf. | Reason | Flag |
|---|---|---|---|---|---|---|---|
| HITLD-183 | planned | After a successful store push, store status says the push is no ... | HITLD-190 | constraint | medium | store status after push | may be specific to one store history (its notes) |
| HITLD-188 | planned | The hand-over note survives the session that wrote it | HITLD-190 | constraint | high | the hand-over note survives the container |  |
| HITLD-236 | planned | An orchestrator idle between wakes does not lose its lease, so the ... | HITLD-190 | constraint | high | idle orchestrator keeps its lease |  |
| HITLD-237 | planned | The chief of staff's run status and dispatch watch pull the private ... | HITLD-190 | constraint | high | status and watch pull the store first |  |
| HITLD-323 | proposed | A successor orchestrator in a fresh cloud container cannot resume: ... | HITLD-190 | constraint | high | a successor resumes in a fresh container | owner answers recorded (HITLD-329 to 332) |
| HITLD-267 | proposed | A state history in the read API | HITLD-192 | contribution | medium | state history in the read API, for the Flow view |  |
| HITLD-268 | proposed | Ready, blocked and open needs as fields on each item in the read API | HITLD-192 | contribution | medium | ready and blocked as read API fields |  |
| HITLD-320 | proposed | Clicking an item link in dashboard.html shows a loading-error page ... | HITLD-192 | constraint | high | item links in the dashboard drawer |  |
| HITLD-339 | proposed | Publish the dashboard to a private claude.ai Artifact so it opens on ... | HITLD-192 | contribution | medium | dashboard on a private Artifact for the phone | open design points listed in the item |
| HITLD-342 | planned | Retire the name "long outcome": a milestone with no project is just a ... | HITLD-192 | constraint | high | retire the name long outcome (dashboard lane and docs) | still open: 31 uses in core and schemas |
| HITLD-343 | proposed | Every open work item sits under a milestone, and the empty milestones ... | HITLD-192 | constraint | high | this pass: every item shows on the milestone board |  |

#### Batch 5. rc.3: dispatch and merge defects (new milestone)

| ID | State | Title (short) | Suggested milestone | As | Conf. | Reason | Flag |
|---|---|---|---|---|---|---|---|
| HITLD-194 | planned | Dispatching a tier-3 item again after an abandon fails because its ... | New: A dispatched item reaches main without a hand fix | constraint | high | redispatch after abandon fails on the branch name |  |
| HITLD-279 | proposed | The executor hook refuses the git branch rename that hitld's own ... | New: A dispatched item reaches main without a hand fix | constraint | high | guard refuses the branch rename the brief asks for (issue #149) | guard change: security review |
| HITLD-280 | proposed | Dispatch complete takes the whole parenthetical after commit: as the ... | New: A dispatched item reaches main without a hand fix | constraint | high | dispatch complete misreads the branch (issue #150) | still present: report.mjs line 81 takes [^)]+ |
| HITLD-281 | proposed | A second failing merge run on the same base crashes with "ledger ... | New: A dispatched item reaches main without a hand fix | constraint | high | second failing merge run crashes the ledger (issue #152) |  |
| HITLD-283 | proposed | Hitld merge doesn't recognize a branch that is already merged into ... | New: A dispatched item reaches main without a hand fix | constraint | high | merge misses an already-merged branch (issue #154) | still present: no is-ancestor check in merge/queue.mjs |
| HITLD-284 | proposed | A failed fast check's output is dropped, and the follow-up blames the ... | New: A dispatched item reaches main without a hand fix | constraint | high | a failed fast check's output is dropped (issue #155) | shape with HITLD-292 |
| HITLD-292 | proposed | A setup without env.worktree_setup passes every check, then the merge ... | New: A dispatched item reaches main without a hand fix | constraint | high | merge queue worktree without setup (issue #177) |  |
| HITLD-314 | proposed | dispatch follow-up refuses an interactive tier-3 dispatch, so a cloud ... | New: A dispatched item reaches main without a hand fix | constraint | high | follow-up for interactive dispatches |  |
| HITLD-346 | proposed | A branch awaiting merge can be released: a dispatch drop command, and ... | New: A dispatched item reaches main without a hand fix | constraint | high | release a branch that will not merge |  |
| HITLD-347 | proposed | dispatch complete writes the verified pass without the dispatch it ... | New: A dispatched item reaches main without a hand fix | constraint | medium | verified entry carries its dispatch | small |

#### Batch 6. rc.3: the chief of staff (new milestone)

| ID | State | Title (short) | Suggested milestone | As | Conf. | Reason | Flag |
|---|---|---|---|---|---|---|---|
| HITLD-55 | planned | The knowledge-base `kb` tool | New: The chief of staff tells the owner what is true, briefly and on time | contribution | low | kb search is the first lookup HITLD-146 names | no milestone of its own; part 21.1 lists the kb tool in One signal end to end |
| HITLD-146 | planned | The chief of staff answers questions about HITLd from the design and ... | New: The chief of staff tells the owner what is true, briefly and on time | constraint | high | the chief of staff cites its sources; v0.1.0 need | needs HITLD-57, which pulls the end-to-end runner into v0.1.0 |
| HITLD-155 | planned | Executors raise the bugs and emergent work they find: a found section ... | New: The chief of staff tells the owner what is true, briefly and on time | constraint | high | executors raise found work; the chief of staff files it |  |
| HITLD-182 | planned | The chief of staff reads its notifications between tool calls, so a ... | New: The chief of staff tells the owner what is true, briefly and on time | constraint | high | notifications read between tool calls |  |
| HITLD-216 | planned | The chief of staff asks the owner one question per call, short, and ... | New: The chief of staff tells the owner what is true, briefly and on time | constraint | high | one short question per call, a queue offered in batches |  |
| HITLD-217 | planned | The chief of staff names every number it writes: a pull request, a ... | New: The chief of staff tells the owner what is true, briefly and on time | constraint | high | no bare #N |  |
| HITLD-219 | planned | The chief of staff asks for a fresh usage figure on a schedule and ... | New: The chief of staff tells the owner what is true, briefly and on time | constraint | medium | asks for the usage figure on a schedule and says what it covers | superseded once HITLD-165 lands |
| HITLD-289 | proposed | The chief-of-staff skill has no row for the Claude desktop app, so a ... | New: The chief of staff tells the owner what is true, briefly and on time | constraint | medium | a desktop-app row in the chief-of-staff harness table (issue #165) |  |

#### Batch 7. rc.4: install and adoption (new milestone)

| ID | State | Title (short) | Suggested milestone | As | Conf. | Reason | Flag |
|---|---|---|---|---|---|---|---|
| HITLD-25 | planned | Consumer setup through a package script | New: A new project adopts HITLd from the guide alone | constraint | high | consumer setup script; already a v0.1.0 need | overlaps HITLD-262 and 273 (triage says shape together) |
| HITLD-138 | proposed | Publish the hitld package to the npm registry, from the release ... | New: A new project adopts HITLd from the guide alone | contribution | low | registry install widens adoption | its notes: not a need of v0.1.0; first publish must be a full release |
| HITLD-256 | proposed | The contract block isn't stable under prettier or markdownlint | New: A new project adopts HITLd from the guide alone | constraint | high | contract block stable under prettier (issue #113) |  |
| HITLD-258 | proposed | The first-run settings write is refused with a misleading reason | New: A new project adopts HITLd from the guide alone | constraint | high | misleading first-run settings refusal (issue #115) |  |
| HITLD-260 | proposed | Hitld ready on a branch reports a missing policy.json that exists | New: A new project adopts HITLd from the guide alone | constraint | high | hitld ready on a branch (issue #118) |  |
| HITLD-262 | proposed | Installing the plugin needs a marketplace step the guide doesn't ... | New: A new project adopts HITLd from the guide alone | constraint | high | plugin install marketplace step (issue #120) | shape with HITLD-25 |
| HITLD-263 | proposed | Hitld install --statusline without --ref replaces the pinned ... | New: A new project adopts HITLd from the guide alone | constraint | high | install --statusline replaces pinned marketplace (issue #121) | HITLD-165 retires the status-line capture: may be moot |
| HITLD-264 | proposed | Machine paths in hitld install's hook warning and status-line command | New: A new project adopts HITLd from the guide alone | constraint | high | machine paths in install output (issue #122) | status-line half moot if HITLD-165 lands |
| HITLD-271 | proposed | The setup never asks whether you work from more than one machine, so ... | New: A new project adopts HITLd from the guide alone | constraint | medium | setup asks about several machines (issue #130) |  |
| HITLD-272 | proposed | The store's git misses a credential helper set in git's built-in ... | New: A new project adopts HITLd from the guide alone | constraint | high | store git and installation-level credential helper (issue #131) |  |
| HITLD-273 | proposed | Installing the plugin assumes the claude CLI, which desktop-app users ... | New: A new project adopts HITLd from the guide alone | constraint | medium | install for desktop-app users (issue #136) | shape with HITLD-25 and 262 |

#### Batch 8. rc.4: the tracker format in a consuming project (new milestone)

| ID | State | Title (short) | Suggested milestone | As | Conf. | Reason | Flag |
|---|---|---|---|---|---|---|---|
| HITLD-255 | proposed | The front-matter parser rejects YAML lists that a formatter wrapped | New: A consuming project's tracker behaves as its guide says | constraint | high | front-matter parser and wrapped YAML lists (issue #112) | still present: frontmatter.mjs reads one-line lists only |
| HITLD-257 | proposed | A migration or a new item can't be prepared on a branch for the owner ... | New: A consuming project's tracker behaves as its guide says | constraint | medium | stage a migration or new item on a branch (issue #114) | feature; needs shaping |
| HITLD-259 | proposed | Names-and-states quietly changes the state of non-work items that ... | New: A consuming project's tracker behaves as its guide says | constraint | high | migration silently changes in-progress non-work items (issue #117) |  |
| HITLD-261 | proposed | Work close reorders front-matter keys | New: A consuming project's tracker behaves as its guide says | constraint | high | work close reorders keys (issue #119) |  |
| HITLD-266 | proposed | Tracker-structure drops a project's link to its initiative when the ... | New: A consuming project's tracker behaves as its guide says | constraint | medium | migration drops project-to-initiative link (issue #124) | only matters for projects still on initiatives |
| HITLD-269 | proposed | Generated views/lists.md fails markdownlint (MD001) | New: A consuming project's tracker behaves as its guide says | constraint | high | lists.md fails MD001 (issue #127) | still present: work/views/lists.md lines 3-5 |
| HITLD-270 | proposed | Work new --needs for a milestone wants a clause on each entry | New: A consuming project's tracker behaves as its guide says | constraint | high | work new --needs on a milestone (issue #128) | the HITLD-343 pass will hit it |
| HITLD-275 | proposed | Work new can't take an item's text, so every new item needs a second ... | New: A consuming project's tracker behaves as its guide says | constraint | medium | work new takes the item text (issue #138) |  |
| HITLD-276 | proposed | No command adds an existing item to a milestone, so constraints are ... | New: A consuming project's tracker behaves as its guide says | constraint | medium | a command adds an item to a milestone (issue #140) | would save hand edits in the HITLD-343 pass |
| HITLD-285 | proposed | Policy dispatch.inline_globs defaults to work/** and ignores ... | New: A consuming project's tracker behaves as its guide says | constraint | medium | inline_globs ignores work_dir (issue #156) | shape with 286 and 287 |
| HITLD-286 | proposed | Touches and tier_override are off by default in tracker.json, so work ... | New: A consuming project's tracker behaves as its guide says | constraint | medium | touches off by default but sizing needs it (issue #157) | format choice |
| HITLD-287 | proposed | Sizing reads a Plan section and touches, but nothing tells a project, ... | New: A consuming project's tracker behaves as its guide says | constraint | medium | nothing tells a project about Plan and touches (issue #158) |  |

#### Batch 9. v0.1.0: publish safety, settings, first release, Windows

| ID | State | Title (short) | Suggested milestone | As | Conf. | Reason | Flag |
|---|---|---|---|---|---|---|---|
| HITLD-77 | planned | Confidential decisions live in the private store, not the public ... | HITLD-64 | constraint | high | keeps confidential decisions out of the public tracker |  |
| HITLD-187 | planned | Verify what the public-text checks do when the private term list ... | HITLD-64 | constraint | high | public-text checks fail closed without the term list | security-relevant |
| HITLD-274 | proposed | Feedback render shows the private record, not the draft that will be ... | HITLD-64 | constraint | high | feedback render shows the private record, not the draft to be filed | a public-posting risk |
| HITLD-282 | proposed | The tracker refuses a decision item classified internal, which is the ... | HITLD-64 | constraint | medium | internal question refused in a public tracker (issue #153) | overlaps HITLD-77; merge or need it |
| HITLD-50 | planned | hitld env primary --reset: the owner moves the recorded primary ... | HITLD-65 | constraint | medium | moving the primary checkout is a settings-layer gap |  |
| HITLD-145 | planned | Executors declare where they run, and the machine cap and heavy-work ... | HITLD-65 | constraint | medium | which cap applies where; v0.1.0 need | duplicates a Done-when line of HITLD-204 |
| HITLD-204 | planned | Raising the executor cap during a run is one command, and the plan ... | HITLD-65 | constraint | high | cap layers: person not project; one command to raise |  |
| HITLD-227 | planned | Follow-ups to briefs naming overlapping work: act on ... | HITLD-66 | constraint | medium | release_note_missing acted on: release notes complete |  |
| HITLD-229 | proposed | The release environment check also covers admin bypass and the ... | HITLD-66 | constraint | medium | release environment check covers admin bypass and branch rule | really an owner decision (kind work, Done-when is a choice) |
| HITLD-300 | proposed | Main carries 3 CodeQL alerts (shell command from an environment path) ... | HITLD-66 | constraint | medium | no undecided CodeQL alert on main before v0.1.0 | really an owner decision (fix or dismiss) |
| HITLD-249 | planned | The private store lives under %LOCALAPPDATA% on Windows, with ... | New: HITLd runs on Windows | constraint | high | Windows store path |  |
| HITLD-250 | planned | Windows protects the device key with DPAPI, so a local store device ... | New: HITLd runs on Windows | constraint | high | Windows DPAPI device key; owner said v0.1.0, not rc.2 |  |
| HITLD-251 | planned | The store's git ignores the owner's global ignore and attributes ... | New: HITLd runs on Windows | constraint | medium | store git ignores global ignore files (every platform, from the Windows PR) |  |
| HITLD-294 | proposed | teardown compares worktree paths with the default realpath, so ... | New: HITLd runs on Windows | constraint | high | teardown real path on Windows | unverified on Windows |
| HITLD-295 | proposed | The isolated-home test guard allows only the default real path of the ... | New: HITLd runs on Windows | constraint | high | isolated-home guard and short-name TEMP | unverified on Windows |

#### Batch 10. After v0.1.0: the rest of One signal end to end, hosted trackers

| ID | State | Title (short) | Suggested milestone | As | Conf. | Reason | Flag |
|---|---|---|---|---|---|---|---|
| HITLD-29 | planned | Intake and triage: GitHub Issues and the owner's notes | HITLD-68 | constraint | high | intake and triage; already a constraint (also feeds HITLD-69) |  |
| HITLD-30 | planned | Reproducer: reported bugs to failing tests | HITLD-68 | constraint | high | reproducer; already a constraint |  |
| HITLD-31 | planned | Acceptance author: checks written before the executor starts | HITLD-68 | constraint | high | acceptance author; already a constraint |  |
| HITLD-32 | planned | Adversarial loop on one area | HITLD-68 | constraint | high | adversarial loop; already a constraint |  |
| HITLD-34 | planned | Security baseline beyond the commit guard | HITLD-69 | constraint | high | security baseline and injection scenarios; already a constraint |  |
| HITLD-265 | proposed | Warn when the commit guard isn't running in a worktree | HITLD-69 | constraint | medium | warn when the commit guard is not running in a worktree (issue #123) | could go under the adoption milestone instead |
| HITLD-33 | planned | Live evals and the Copilot cloud agent profile | HITLD-70 | constraint | high | live evals and baseline; already a constraint |  |
| HITLD-52 | planned | Live evals through Inspect AI: an exporter from our scenarios, ... | HITLD-70 | constraint | high | HITLD-33 needs it; live evals | held by HITLD-351 (usage) |
| HITLD-54 | planned | The thin MCP server (`hitld mcp`) | HITLD-70 | constraint | medium | MCP server; the Copilot profile in HITLD-33 uses tools over MCP |  |
| HITLD-57 | planned | The end-to-end eval runner and `claude plugin eval` scenarios for ... | HITLD-70 | constraint | high | end-to-end runner; already a constraint | HITLD-146 needs it, so it sits on the v0.1.0 path today |
| HITLD-127 | proposed | Live evals across models and providers, on accounts the owner chooses | HITLD-70 | contribution | medium | multi-provider live evals add to the gate |  |
| HITLD-41 | planned | Resource capacities instead of plain locks | HITLD-71 | constraint | high | resource capacities; already a constraint |  |
| HITLD-42 | planned | Load-aware admission and quiet-machine holds | HITLD-71 | constraint | high | load-aware admission; already a constraint |  |
| HITLD-97 | planned | Tracker interchange format: schema, untrusted text with authors, the ... | HITLD-96 | constraint | high | already c6 of Runs on a hosted tracker | held by HITLD-351 (usage) |
| HITLD-98 | planned | State and field mapping: tracker.json sections, refusal of unmapped ... | HITLD-96 | constraint | high | already c6 |  |
| HITLD-99 | planned | Import and switch: hitld work import, the dry run and report, the ID ... | HITLD-96 | constraint | high | already c6 |  |

#### Batch 11. After v0.1.0: authority and learning (new milestones)

| ID | State | Title (short) | Suggested milestone | As | Conf. | Reason | Flag |
|---|---|---|---|---|---|---|---|
| HITLD-36 | planned | Signed decision answers (Q21, option 4) | New: The owner gives each answer once, in one place, and it counts | constraint | medium | signed answers: an answer counts only from who gave it | only open work item of project HITLD-53; HITLD-44 (decision) needs it |
| HITLD-126 | proposed | Design: the chief of staff drives sessions in other environments and ... | New: The owner gives each answer once, in one place, and it counts | constraint | medium | design: the chief of staff drives other sessions, answers recorded once | partly overtaken by HITLD-142/144 (done) and HITLD-254 |
| HITLD-179 | proposed | Git identity and sign-off: where the owner's sign-off lives, what ... | New: The owner gives each answer once, in one place, and it counts | constraint | medium | whose identity and sign-off a commit carries | touches the DCO line of HITLD-24 |
| HITLD-180 | proposed | Relays from the orchestrator are numbered, each is confirmed when ... | New: The owner gives each answer once, in one place, and it counts | constraint | medium | numbered, confirmed relays |  |
| HITLD-186 | proposed | A permission denial is a typed fault that escalates, not a stall | New: The owner gives each answer once, in one place, and it counts | constraint | medium | a denial is a typed fault that escalates to the owner once |  |
| HITLD-240 | proposed | Design: a blocking Stop hook so no orchestrator or interactive ... | New: The owner gives each answer once, in one place, and it counts | constraint | medium | design: a blocking Stop hook so no turn ends unsent |  |
| HITLD-254 | proposed | Design: the owner's answer in the chief of staff session reaches the ... | New: The owner gives each answer once, in one place, and it counts | constraint | high | design: the owner's answer reaches the orchestrator's prompts |  |
| HITLD-291 | proposed | An owner mode for starting runs: the chief of staff proposes every ... | New: The owner gives each answer once, in one place, and it counts | contribution | low | design: an owner mode for starting runs | overlaps HITLD-353 |
| HITLD-333 | proposed | Device approvals are authenticated: signed by an enrolled device, ... | New: The owner gives each answer once, in one place, and it counts | constraint | medium | device approvals are signed by an approved device | store-format change: recommend it lands before v0.1.0 |
| HITLD-43 | proposed | A marketing and go-to-market loop | New: HITLd measures its own work and proposes changes from it | contribution | low | a later loop design (marketing); no owner ask since the migration | drop candidate: refile when Stakeholder reports (part 21.2) is shaped |
| HITLD-48 | proposed | Friction-signal digest per version | New: HITLd measures its own work and proposes changes from it | constraint | medium | friction counts per version feed self-improvement |  |
| HITLD-75 | planned | Agents learn to write good descriptions for items, projects, ... | New: HITLd measures its own work and proposes changes from it | constraint | medium | description quality guide, check and eval |  |
| HITLD-81 | planned | Agent-shaped estimates: token ranges, owner-attention cost and ... | New: HITLd measures its own work and proposes changes from it | constraint | medium | calibrated estimates from the ledger | pairs with HITLD-298 |
| HITLD-112 | proposed | Learned state: every learned parameter with its bound, uncertainty ... | New: HITLd measures its own work and proposes changes from it | constraint | medium | learned state with bounds and uncertainty |  |
| HITLD-139 | proposed | Token accounting: where tokens go by role and activity, with trends, ... | New: HITLd measures its own work and proposes changes from it | constraint | medium | token accounting by role and activity | needs HITLD-112 |
| HITLD-277 | proposed | Feedback the agent finds and the person approves has no honest record ... | New: HITLd measures its own work and proposes changes from it | constraint | low | an honest record shape for agent-found feedback |  |
| HITLD-298 | proposed | estimate_tokens is not enabled in tracker.json, so critical paths ... | New: HITLd measures its own work and proposes changes from it | constraint | medium | whether this repository records estimate_tokens | really an owner decision, not work |

#### 3. Milestones proposed for the new structure

All drafts. Clause wording is for the owner to amend; each would be a `proposed` milestone put to the owner one at a time (HITLD-343). Constraints are listed per clause; contributions are listed apart.

#### 3.1 Seven new milestones (parent HITLD-15 unless said)

| Name (by outcome) | Outcome (one sentence) | Done when (clauses, with constraints) | Check | Stage |
|---|---|---|---|---|
| **A new project adopts HITLd from the guide alone** | A person following the install guide on a fresh clone gets the plugin, the contract block and a first dispatched item with no hand fix and no misleading message. | c1: `npm run hitld:setup` installs the CLI and plugin pinned to a tag, including the marketplace step, and the committed settings keep the pinned source and autoUpdate (HITLD-25, 262, 263, 264, 273). c2: The contract block survives prettier and markdownlint and `hitld check contract` still passes (HITLD-256). c3: Setup and first-run refusals name the real cause: settings write, `hitld ready` on a branch, an installation-level credential helper, several machines (HITLD-258, 260, 271, 272). Contribution: HITLD-138. | demo: someone other than the authors follows the new-project guide on a fresh fixture clone and ends with one item merged and closed; the steps are recorded | rc.4 |
| **A consuming project's tracker behaves as its guide says** | A project's own tracker files survive its formatters, migrations and edits, and items size from what the guide tells the project to write. | c1: Formatter-wrapped front matter parses, and generated views pass markdownlint (HITLD-255, 269). c2: Migrations and `work close` change only what they report (HITLD-259, 261, 266). c3: Items and milestones are written and linked by command, also on a branch for review (HITLD-257, 270, 275, 276). c4: An item with a Plan and touches sizes below tier 3 in a project whose `work_dir` is not `work`, and the guide says what to write (HITLD-285, 286, 287). | integration-test: a fixture consumer tracker, formatted by prettier, migrated, edited by command and closed, passes `work check` and sizes to the expected tiers | rc.4 |
| **A dispatched item reaches main without a hand fix** | Every dispatch, re-dispatch, follow-up, verification and merge in a run completes through `hitld` commands, and a failure says why. | c1: The executor guard and the report parser accept what the brief asks for, and a verified entry names its dispatch (HITLD-279, 280, 347). c2: The merge queue handles an already-merged branch, a second failure on one base and a fresh worktree, and keeps the failed check's output (HITLD-281, 283, 284, 292). c3: An abandoned, unmergeable or interactive dispatch is re-dispatched, released or followed up by command (HITLD-194, 314, 346). | demo: a scripted fixture run seeds each case and completes with no ledger line appended by hand, run by someone other than the authors | rc.3 |
| **The chief of staff tells the owner what is true, briefly and on time** | What the chief of staff tells the owner is checked against a source, short, asked one question at a time, and acted on within minutes of the event. | c1: A claim about HITLd cites the design, code or a command, or says it is unchecked (HITLD-146). c2: One question per call, a queue offered in batches, no bare `#N` (HITLD-216, 217). c3: Notifications, found work and the usage figure are handled during long tasks and on schedule (HITLD-182, 155, 219). c4: The harness table covers the desktop app (HITLD-289). Contribution: HITLD-55. | demo: the owner reviews one recorded chief-of-staff session against the four clauses, with the offline eval scenarios of each item passing | rc.3 (see Q4 on HITLD-146) |
| **HITLd runs on Windows** | The owner's Windows machine runs the suite, enrolls a store device and syncs the store as macOS and Linux do. | c1: The store lives under `%LOCALAPPDATA%` and the device key is protected with DPAPI (HITLD-249, 250). c2: The store's git ignores the global ignore and attributes files on every platform (HITLD-251). c3: The suite passes with short-name paths (HITLD-294, 295). | demo: the owner's recorded Windows run of `npm test` and of device init, push and pull | rc.4 (HITLD-250's note: v0.1.0, not rc.2) |
| **The owner gives each answer once, in one place, and it counts** | The owner answers only in the chief of staff's session, the answer reaches any session that needs it as a record only the owner's turn can create, and signatures show who gave each answer and approval. | c1: The designs for driving other sessions and for answers reaching the orchestrator's prompts are settled and built (HITLD-126, 254, 240, 180). c2: A denial is a typed fault that escalates once (HITLD-186). c3: Commits and sign-offs carry the agreed identity (HITLD-179). c4: Decision answers and device approvals verify by signature (HITLD-36, 333). Contribution: HITLD-291. Parent: HITLD-15, or HITLD-53 for c4 (Q9). | demo: the owner answers a held question in the chief-of-staff session, the orchestrator's command runs with no prompt in its own session, and an unsigned approval is refused | after v0.1.0, except HITLD-333 (Q8) |
| **HITLd measures its own work and proposes changes from it** | Estimates, learned parameters, token shares, description quality and friction counts come from the ledger with their uncertainty, and changes to them are proposed to the owner, never made silently. | c1: Items get calibrated token ranges and attention cost, and this repository records `estimate_tokens` or says why not (HITLD-81, 298). c2: Learned state and token accounting show in `hitld metrics` and the dashboard (HITLD-112, 139). c3: A description-quality guide, check and eval exist (HITLD-75). c4: A friction digest per version and an honest record for agent-found feedback (HITLD-48, 277). Contribution: HITLD-43 (or drop). | integration-test: a seeded ledger produces the expected learned state, token shares and one proposal, and a seeded poor description is flagged | after v0.1.0 |

#### 3.2 The four proposed rc.2-step milestones, re-scoped (recommended over dropping)

| Milestone | Keep | Change | New constraints and contributions | Stage |
|---|---|---|---|---|
| **HITLD-189** Fast, reliable CI and a planner that offers the right work | name, outcome, c1 and c2 (met: all constraints done, check due) | add c3: "The CI and eval gates give the same answer on every run, and checks an executor cannot run locally are run before it reports" and c4: "The planner offers only items that can start and that the owner allows, and says why it holds the others" | c3: HITLD-185, 201, 241, 293. c4: HITLD-235, 253, 278, 353. Contributions: HITLD-154, 165, 290, 296, 315 | rc.3 |
| **HITLD-190** Two containers share one store | c1 (HITLD-74, 148, 149, also in HITLD-67) | outcome becomes "An orchestrator and the chief of staff share one store, and a successor resumes from it in a fresh container"; c2 (HITLD-151) replaced by "A successor in a fresh container resumes from the store with the hand-over note" and c3 "Lease, ledger and push status are read current from the store" | c2: HITLD-323, 188. c3: HITLD-236, 237, 183. Remove HITLD-151 (stays in HITLD-67) | rc.3 |
| **HITLD-191** Routine jobs are done by commands | name, outcome, c1 (met) | add c2 "Reversible tracker edits land without a per-change approval and can be reversed by command", c3 "Merges, publishes, claims and closes follow one written routine and carry the full trailers", c4 "Finished sessions, refs and stale items are cleaned up by command" | c2: HITLD-143, 288, 160. c3: HITLD-218, 297, 202, 228, 203, 49. c4: HITLD-167, 252. Contributions: HITLD-220, 76 | rc.3 |
| **HITLD-192** The owner sees the plan in one page | name, outcome, c1 (met: HITLD-152 and 62 done) | remove HITLD-147; add c2 "Every open item shows on the board under a milestone, and no label says long outcome" and c3 "Every link in the page opens in a browser, or says where it cannot" | c2: HITLD-343, 342. c3: HITLD-320. Contributions: HITLD-267, 268, 339 | rc.3 |

If the owner prefers to drop them instead: HITLD-189 and 191 can be marked done once their demo checks pass (all constraints done), and HITLD-192 dropped as a duplicate of HITLD-67 c4; the rc.3 groups above then become new milestones under the same names. [Likely either works; re-scoping is less churn.]

#### 4. The eight empty milestones

Constraint state read from the tracker [Certain]. Drafts are recommendations.

| Milestone | Draft outcome | Draft done when (constraints per clause) | Draft check | Merge, drop or split? |
|---|---|---|---|---|
| **HITLD-1** Human in the lead: one signal end to end (no project) | One signal travels the whole path, from arrival to a merged and closed item, with the owner involved only for calls that are theirs, every step recorded, and an eval suite that catches the next change that breaks it (design 21.1). | c1: A reported issue reaches a merged, closed item on a fixture repository (checks 1 to 3) (HITLD-68). c2: Untrusted text is contained and leaks are blocked (checks 4, 5) (HITLD-69, 64). c3: The eval suite gates (check 6) (HITLD-70). c4: Settings hold and heavy work waits on a busy machine (checks 8, 9, 11) (HITLD-65, 71). c5: It installs from a release and runs a real consumer (checks 7, 10) (HITLD-66, 67). | demo: the eleven checks of design 21.1 run on fixture repositories by someone other than the authors, each result recorded | Keep as the one milestone that waits on other milestones (HITLD-342, 344). Place it after v0.1.0. Question: keep HITLD-67 under it (tracker) or treat self-hosting as after it (design 21.2) (Q5). Do not add the new rc.3/rc.4 milestones to it [Likely]. |
| **HITLD-64** Safe to publish | Anyone can read the public repository, its history and its issues, and nothing in them should not be there. | c1: The confidentiality pass and the guided design review are finished (HITLD-22, 23, done). c2: Confidential decisions and feedback drafts never reach the public tracker or an issue unseen (HITLD-77, 282, 274). c3: Public-text checks fail closed when the private term list cannot be read (HITLD-187). | demo: an independent scan of the repository and its history, plus a run with no store showing the commit hook refuses or warns, run by someone other than the authors | Keep. c1 is met, so the check is due now. Stage v0.1.0 (scan just before the tag). |
| **HITLD-65** Settings hold | Two projects on one machine share the person's limits without stepping on each other, and every limit says which layer set it. | c1: Check 11 of design 21.1 passes on fixture projects (HITLD-37 to 40, done). c2: The executor cap is a person setting, the plan names the layer and placement that decided it, and the owner raises it with one command (HITLD-204, 145). c3: The owner can move the primary checkout (HITLD-50). | integration-test: check 11 on fixture projects, with a cloud placement case | Keep; do not merge with HITLD-71 (that one is after v0.1.0). Stage rc.4 (HITLD-145 is a v0.1.0 need). |
| **HITLD-66** First release | A consuming project can pin a released version that already has the milestone and release format. | c1: A fresh clone of a fixture consumer installs the plugin pinned to a release tag and `hitld check contract` passes (check 10) (HITLD-18, 45, 58, 59, 63, done). c2: `hitld release propose` on main reports no missing release notes and no undecided high alert, and the release environment refuses an unsafe configuration (HITLD-227, 300, 229). | integration-test: the check-10 install test against the candidate tag | Keep, but **remove HITLD-24 from its constraints and make HITLD-24 need it** (section 0, item 3). Stage v0.1.0. |
| **HITLD-68** End to end | A reported issue reaches a merged, closed item, with the owner asked only for calls that are theirs. | c1: Intake and triage turn issues and notes into classified signals (HITLD-29). c2: A reported bug becomes a failing test before the executor starts (HITLD-30). c3: Every dispatched item has an executable check written before it starts (HITLD-31). c4: One area has an adversarial pass on every change (HITLD-32). | demo: the end-to-end eval (check 1) on a fixture repository, which runs in HITLD-57's runner | Keep. Add HITLD-57 as a need of its check (section 6). After v0.1.0. |
| **HITLD-69** Injection contained | No agent acts on instructions in untrusted text, and each agent can do only what its role allows. | c1: Every injection scenario passes and attempts are flagged (HITLD-34, 29). c2: Each role has a least-privilege definition and the guard enforces it, and a worktree where the commit guard would not run is reported (HITLD-34, 265). | integration-test: the injection scenarios at 100% plus a seeded write outside a role's paths refused | Keep narrow (it is mostly HITLD-34). Merging into HITLD-68 is the alternative: intake is the main source of untrusted text. After v0.1.0. |
| **HITLD-70** Evals gate | A change that degrades a skill cannot merge unnoticed. | c1: Every skill has scenarios under `claude plugin eval` and the end-to-end runner drives three flows (HITLD-57). c2: Live evals run with a recorded baseline, and a deliberately degraded skill fails the gate (HITLD-33, 52). c3: The Copilot cloud agent profile passes against the fake adapter, through the MCP server (HITLD-33, 54). Contribution: HITLD-127. | demo: a deliberately degraded skill fails the gate in CI, run by someone other than the authors | Keep. After v0.1.0, unless the owner keeps HITLD-146's need on HITLD-57 (Q4), which pulls c1 into v0.1.0. HITLD-52 is held by the usage wait HITLD-351. |
| **HITLD-71** Load aware | Heavy work waits while the person's machine is busy, and benchmarks run on a quiet one. | c1: Serial resources have capacities and weighted holders that queue fairly (HITLD-41). c2: Admission defers heavy work above the load threshold, and quiet holds start below it (HITLD-42). | integration-test: simulated load on a fixture machine profile | Keep, after v0.1.0. Note HITLD-145: in the cloud, executors often do not run on the measured machine, which lowers this milestone's value there [Likely]. |

#### 5. Release stages

**Facts** [Certain]: `v0.1.0-rc.1` is tagged (HITLD-128, done). HITLD-137 (`release: 0.1.0-rc.2`) needs HITLD-67 and HITLD-140 (done). HITLD-24 (`release: 0.1.0`) needs 47 entities, of which six are open: HITLD-109, 137, 25, 143, 145, 146. HITLD-57 needs HITLD-137 (the owner's hold, HITLD-242). No rc.3 or rc.4 release item exists. The owner ruled that nothing else from the design lands before rc.2 except HITLD-140 (HITLD-137's Why).

**Recommendation** (each boundary is the owner's, one at a time). Stages are expressed only by release items' `needs` (section 0, item 2).

| Stage | Release item and its `needs` | Gate: what must be done in it | What moves to the next stage | What waits for v0.1.0 itself |
|---|---|---|---|---|
| **rc.2** | HITLD-137 (exists): HITLD-67, HITLD-140 | HITLD-67's open constraints HITLD-74, 109, 147, 148, 149, 151, the external items HITLD-26 and 349, and HITLD-67's demo check by the owner. Optionally HITLD-160 under HITLD-67 c3 (Q7). | Everything else. Remove HITLD-147 from HITLD-192 and HITLD-151 from HITLD-190 so those milestones do not look like rc.2 work. | nothing |
| **rc.3: the self-hosted run holds up** | new release item "Release v0.1.0-rc.3": HITLD-137, HITLD-189, 190, 191, 192, the dispatch-and-merge milestone, the chief-of-staff milestone | Their constraints (about 50 items: batches 2 to 6) and their checks. The demo theme: a self-hosted run goes through a hand-over and several merges with no hand fix and no prompt carried by hand. | Contributions not done (HITLD-154, 165, 220, 267, 268, 290, 296, 315, 339, 76) do not hold it; they ride along or move on. | HITLD-143 and 146 are v0.1.0 needs today but land here through HITLD-191 and the chief-of-staff milestone. |
| **rc.4: an outside consuming project adopts it** | new release item "Release v0.1.0-rc.4": the rc.3 release item, the adoption milestone, the tracker-format milestone, the Windows milestone, HITLD-65 | Batches 7 and 8, the Windows and settings rows of batch 9, and their checks. The demo theme: the consuming project that reported issues #112 to #177 installs rc.4 from the guide and runs an item. | HITLD-138 (registry publish) moves past v0.1.0 (its own note). | HITLD-25 lands here through the adoption milestone. |
| **v0.1.0** | HITLD-24 (exists): **replace** its six open direct needs by the rc.4 release item, HITLD-64 and HITLD-66 (and HITLD-333 if Q8 is yes). Keep its done needs as history. | HITLD-64's scan, HITLD-66's install check and its clause c2 (HITLD-227, 229, 300), release notes complete, the owner's `release make`. | everything after | — |
| **after v0.1.0** (no release item yet) | none until the owner shapes the next version | HITLD-1, 68, 69, 70, 71, 96, the owner-answers milestone, the learning milestone | — | — |

Why rc.3 and rc.4 rather than one more candidate [Guessing on the owner's preference, Likely on the risk]: rc.3's work is about this repository's own run and can be checked by the owner's next self-hosted session; rc.4's is about another project's install and tracker, and needs that project to try it. Splitting lets the owner tag a candidate after each check instead of waiting on both. If one candidate is preferred, merge the rc.3 and rc.4 rows into rc.3.

#### 6. Dependency review (open items, the 25 that matter most)

Edges that only point at finished items are left alone. Each needs the owner's yes before it is written.

| # | Change | Evidence | Tag |
|---|---|---|---|
| 1 | Remove HITLD-24 from HITLD-66's constraints; HITLD-24 needs HITLD-66 | HITLD-24 Done-when: "the first-release milestone's check has passed"; design 3.2: the release item needs what must finish first | Certain |
| 2 | Decide HITLD-146 → HITLD-57 | Chain HITLD-24 → 146 → 57 → 137 makes v0.1.0 wait on the ~1.4M-token runner; HITLD-146's eval clause is the only reason (its Done-when line 4) | Certain (chain), Q4 |
| 3 | Replace HITLD-24's direct needs on HITLD-25, 109, 137, 143, 145, 146 with the stage chain | They are reached through HITLD-67, the rc.3/rc.4 release items and their milestones; avoids `release-needs-overlap` once rc.3 exists | Likely |
| 4 | Remove HITLD-147 from HITLD-192 | HITLD-147 is executor reporting (HITLD-67 c1), not the page | Certain |
| 5 | Remove HITLD-151 from HITLD-190 | HITLD-190's note: moved there because it and HITLD-149 edit the quota code, not for the store outcome; HITLD-149 already needs HITLD-151 | Certain |
| 6 | HITLD-143 needs HITLD-288 | HITLD-143: "`hitld rights reverse` undoes it by a revert pull request"; HITLD-288: `rights reverse` writes only a trust record and the orchestrator cannot act on it | Likely |
| 7 | HITLD-218 needs HITLD-167 | HITLD-218's routine ends the session; its notes: builds on HITLD-167 | Likely |
| 8 | HITLD-323 needs HITLD-74 and HITLD-148 | HITLD-323 Done-when: the state is carried "(HITLD-74 numbering and HITLD-148 settings)" | Certain (text) |
| 9 | Remove HITLD-186 → HITLD-154 | HITLD-186's Done-when (fault kind, relay line, no verbatim retry) uses nothing HITLD-154 builds | Likely |
| 10 | HITLD-145 needs HITLD-204, or move the shared line to one item | Both require `dispatch plan` and `config explain` to name the cap or layer that decided; HITLD-204 removes the project layer first | Certain (overlap) |
| 11 | HITLD-282 needs HITLD-77, or merge | HITLD-282's triage: "the fix is a classification choice that overlaps HITLD-77" | Likely |
| 12 | HITLD-262 and 273 shaped with HITLD-25 (merge, or HITLD-25 needs them) | HITLD-262's triage: "overlaps HITLD-25's planned setup script, so shape together"; HITLD-273: same install steps | Likely |
| 13 | HITLD-25 → HITLD-137: keep only as the owner's hold | HITLD-25's Done-when needs any release tag; rc.1 exists. HITLD-67's note moved HITLD-25 to v0.1.0 by choice | Likely |
| 14 | HITLD-228 needs HITLD-203, or merge | Same trailers and check file; HITLD-228's note: HITLD-203 settles what the model value holds | Likely |
| 15 | HITLD-68 needs HITLD-57 (milestone constraint on its check clause) | HITLD-68's check is the end-to-end eval; HITLD-57 builds the runner that drives "a bug to a merge" | Likely |
| 16 | HITLD-33 needs HITLD-54 | HITLD-33 requires the Copilot cloud agent profile; HITLD-54's Why: that agent "has tools but no general shell" and uses the MCP server. The fake adapter may not need it | Guessing |
| 17 | HITLD-263 and 264 wait on the owner's commit of HITLD-165 | HITLD-165 retires `hitld install --statusline` and the status-line command; HITLD-263 and half of 264 fix them | Likely |
| 18 | HITLD-353 before or merged with HITLD-291 | Both set who may start runs; HITLD-353 is the narrow first step | Likely |
| 19 | HITLD-253 after HITLD-235 (one probe) | HITLD-253's note: HITLD-235's probe "could probe this too"; HITLD-235's note names HITLD-165 too | Likely |
| 20 | HITLD-160 under HITLD-67 c3 (rc.2), not later | HITLD-67 c3 asks that every choice is recorded as a decision; HITLD-160 says `rights record` drops the link and can leave stray items | Likely, Q7 |
| 21 | HITLD-76 is blocked by decision HITLD-27, open since 2026-11-14 | `needs: [HITLD-49, HITLD-27]`; HITLD-27 is a planned decision nobody has asked | Certain |
| 22 | HITLD-26 (external) duplicates HITLD-109 and 349 | HITLD-26 needs HITLD-109 and records the same live test HITLD-109's Done-when demonstrates; HITLD-349 is the owner's side of it | Likely; drop or mark it as the demo record |
| 23 | HITLD-343 after HITLD-270 and 276, optional | The pass creates milestones with `work new --needs` (HITLD-270's defect) and edits about 115 constraints by hand (HITLD-276 adds the command). An ordering choice, not a need | Likely |
| 24 | HITLD-219 dropped once HITLD-165 lands | HITLD-219 asks for a figure because no probe exists; its Why says so | Likely |
| 25 | HITLD-52 and HITLD-97 wait on external HITLD-351 (usage) | Fact from 2026-11-16 (decision HITLD-352); HITLD-33 and HITLD-98, 99 wait with them | Certain; keep |
