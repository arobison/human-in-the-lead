# 22. Open questions for the owner

[Back to the index](../0001-human-in-the-lead.md)

Each question stands alone, with a recommendation and the main alternative. They are grouped by what they block. A question that is settled leads with "Decided".

## Before One signal end to end

### Q1. Where does the private store live, and do other machines share it?

*Decided: git text files for what syncs, SQLite for what stays on one machine.*

The ledger, private signals, confidential decisions, research and eval results need a home outside the public repository ([part 3](03-data-model.md#private-store)).

- **Git text files are the source of truth** for what syncs between machines and keeps history: the ledger, decisions, precedents, signals, notes and judgement records. Other machines the owner controls get them through an encrypted bundle, the same way code bundles move (`hitld store export`, `import` and `sync`, planned). One ledger and one decision record, so flow metrics cover every machine.
- **SQLite** (Node's built-in module, so no dependency) holds what is local to one machine and needs transactions or fast queries: the machine registry (live executors, leases, locks, capacities) and an index over the ledger for metrics. The index can be deleted and rebuilt from the text.
- This is the knowledge base's pattern ([part 8](08-knowledge-base.md#82-markdown-in-git-is-the-source-of-truth)): text is the truth, the index is a deletable cache.
- **Why not SQLite for everything.** Two SQLite files cannot be merged when two machines both wrote to them. Git text history can.
- **Alternative not taken: a plain local directory per machine.** Simpler, but each machine has its own partial ledger, and metrics must merge them.

### Q2. How are tracker IDs allocated across worktrees and machines?

*Decided: sequential IDs, as recommended.* Only the orchestrator allocates them. Every other orchestrator (another machine, a cloud session) allocates from its own reserved block. People say and type these IDs, often from a phone, and agents copy short numbers more reliably than random strings. Item creation is already centralized in the orchestrator, so hash IDs' main benefit is not needed.

Global `<KEY>-<n>` IDs collide when two places create items at once ([part 3](03-data-model.md#id-allocation)).

- **Recommend: only the orchestrator allocates IDs, and each additional orchestrator allocates from its own reserved block** (for example, 100000 and up). Keeps short, sequential IDs and matches the reference tracker format.
- **Alternative: hash-based IDs** that need no coordination. They never collide, but are harder to say and remember, and would mix two schemes in an existing tracker.

### Q3. When a decision is answered, who generalizes it into precedent?

*Decided: the decider confirms each generalization, as recommended.*

Precedent saves the owner from answering the same question twice, but the generalization is an inference that could overreach ([part 4](04-decision-rights.md#43-precedent)).

- **Recommend: the decider confirms each generalization**, offered as one extra line in the question ("Future cases like this: treat the same way? yes / just this one"), so it costs no extra round trip.
- **Alternative: precedent is created automatically from every answer**, and the owner narrows it later by overruling applications in the digest. Fewer taps at first, more risk of a rule the owner never meant.

### Q4. May a reproduced bug from an unknown reporter become planned work without a human?

*Decided: no, as recommended.* Reproduced bugs from unknown reporters become `Proposed` until a person commits them.

A bug reproduced into a failing test has strong evidence behind it, but its report came from someone the project does not know ([part 2](02-loops.md#22-triage), [part 9](09-contributors.md#92-trust-levels)).

- **Recommend: not for unknown (T0) reporters.** Their reproduced bugs become `Proposed` items with the failing test attached, and a person commits each in the main session. Auto-fix by precedent is allowed for known reporters (T1 and above), per area.
- **Alternative: allow auto-fix by precedent for any reporter once the bug is reproduced**, treating the reproduction as the evidence. Faster for outside reporters, but untrusted reports then steer executor work with no human in between.

### Q5. Do provenance trailers naming the model appear in the public repository?

*Decided: yes.* Agent commits carry `Agent-Role:`, `Agent-Model:` and `Agent-Effort:` beside `Work-Item:` and `Dispatch:`, in public repositories too: the model is useful tracking information. `Brief:`, `Plugin-Version:` and `Evidence:` go public too, once built.

Each agent commit can carry trailers for the item, dispatch, role, model, effort and brief ([part 6](06-verification.md#64-provenance)).

- **Recommend: yes, all trailers in public commits.** Open about how the code was made, useful to contributors reading history, and consistent with a project about this method.
- **Alternative: only `Work-Item:` and `Dispatch:` in public commits**; model, effort and brief stay in the private ledger, joined by the dispatch ID.

### Q6. What does the public repository show for a confidential decision that public work depends on?

*Decided: a stub, as recommended.*

A public item may need a decision whose content is confidential ([part 10](10-security.md#rules)).

- **Recommend: a stub** (ID, the title "confidential decision", state) in the public tracker, with the content in the private store. `needs` keeps resolving, and public views show that something is pending.
- **Alternative: nothing public.** The dependency lives only in the private store, and readiness is computed by a check that can see both. No hint the decision exists, at the cost of public views that cannot explain why an item is blocked.

### Q7. Which intake sources come first?

*Decided: GitHub Issues for a named repository, plus the owner's notes, as recommended.*

"One signal end to end" includes two ([part 21](21-scope.md)).

- **Recommend: GitHub Issues for a named repository, plus the owner's notes.** Both are simple, cover public reports and the owner's own ideas, and exercise the untrusted-input path.
- **Alternative: name the source that carries the most signal for the project today** (for example a chat channel, email, or CI failures) and start there instead of GitHub Issues.

### Q8. Build the eval runner, or adopt a framework?

*Decided: different kinds of test get different tools.* The offline suite is integration tests of deterministic workflows (tracker files, branches, merges, leases, gates): our own runner and JSON scenarios stay the source of truth and gate every change. Model-dependent live evals export to Inspect AI for sandboxed, multi-model runs and its viewer, installed by whoever runs them, so the core keeps zero runtime dependencies. Skill-level scenarios on Claude Code use `claude plugin eval`. Live-run traces use OpenTelemetry's GenAI semantic conventions, so standard tools can read them. Planned: HITLD-52.

The suite needs a runner ([part 17](17-evals.md#175-how-it-runs)).

- **Recommend: a small harness-neutral scenario format and runner in the core, reusing `claude plugin eval` for skill-level scenarios on Claude Code.** No new dependency or language in the core, and the end-to-end flows (multi-agent dispatch, tracker, merge queue) are modelled directly.
- **Alternative: adopt Inspect AI as the runner.** Mature sandboxing, logs and a viewer, at the cost of a Python dependency beside a Node core and an adapter from its model to tracker-and-merge flows.

### Q9. How much live-model eval spend per change and per release?

*Decided: as recommended.* Each live scenario runs 3 times, and the live budget is set from the first measured baseline.

Live scenarios cost tokens on every run, and each runs `k` times ([part 17](17-evals.md#174-metrics)).

- **Recommend: on a candidate change, only the scenarios the change can affect, with `k` = 3; on a release, the full suite with `k` = 3.** Set `eval.live_budget_tokens` from the first measured baseline rather than in advance.
- **Alternative: `k` = 5 everywhere.** Tighter variance estimates and fewer false regressions, at about five-thirds of the cost.

### Q10. May the system start a fresh orchestrator session on its own when the current one's context is filling?

*Decided: yes, as a standing permission, as recommended.* The system sends the owner a message and links the hand-over note.

The orchestrator is restartable from files ([part 5](05-execution.md#54-the-ledger)).

- **Recommend: yes, as a standing permission**, with a message to the owner when it happens and the hand-over note linked.
- **Alternative: ask each time.** One more interrupt, at the moment the run is busiest.

### Q11. How large is the owner's reserve on each account limit?

*Decided: 25% of each window, set in the person file.*

Autonomous runs never spend the reserve, so the owner is never locked out of their own tools ([part 12](12-reporting-and-limits.md#125-quotas-and-budgets)). The default is 25% of each window, set in the person file ([13.4](13-operations.md#134-settings-in-four-layers)) and adjustable per account there.

- **Alternative not taken: 10% everywhere.** More capacity for autonomous runs, with a real chance that a long run leaves the owner too little for a busy afternoon.

### Q12. Which limits are hard?

*Decided: limits that cost money are hard; plan windows are soft with the reserve.*

A hard limit needs the person's yes before it is exceeded ([part 12](12-reporting-and-limits.md#control)). Every limit whose overrun costs money is hard (extra usage, budgets beyond an allowance, API spend). Plan windows are soft, protected by the reserve rule.

- **Alternative not taken: every limit is hard.** The system asks before touching the edge of any window, at the cost of more interrupts during long runs.

<a id="q22-do-the-new-judgement-record-fields-join-v0-affects-v0s-record-scoring-waits-for-hl"></a>

### Q22. Do the new judgement-record fields join One signal end to end? (affects its record; scoring waits for People in the lead)

*Decided: yes, recorded from One signal end to end, in the private store.* Public entities carry only `what`, `basis` and `by` ([part 23](23-people-in-the-lead.md#232-the-judgement-record)).

The judgement record ([part 23](23-people-in-the-lead.md#232-the-judgement-record)) adds an optional confidence, an optional expectation and the evidence available at the time to judgements and decision answers.

- **Recommend: record the three fields from the start**, with no scoring or review yet. Like trust-calibration data, a record started later cannot be backfilled honestly: nobody remembers what they expected.
- **Alternative: add them with "People in the lead".** The milestone stays smaller, and the record starts empty when that milestone begins.

<a id="q25-is-the-confidence-line-offered-on-every-question-blocks-hl-v0-if-q22-is-yes"></a>

### Q25. Is the confidence line offered on every question? (affects One signal end to end, with Q22)

*Decided: on every judgement and decision answer, optional, with a per-person switch, as recommended.*

- **Recommend: on every judgement and decision answer**, optional and one line, with a per-person switch to hide it. More scored calls make feedback useful sooner.
- **Alternative: only on gut checks and one-way doors.** Shorter questions, slower feedback.

## Before the first release

These shape a format or a default that the first release (v0.1.0, HITLD-24) would otherwise ship and then break.

### Q18. What unit is value measured in? (blocks Shaping and prioritization)

*Decided: relative points 1, 2, 3, 5, 8 and 13, compared within a milestone, never across.* A contribution's value is relative to the other contributions of the same milestone ([part 3](03-data-model.md#milestone)).

Prioritization divides cost of delay by size, so value needs a unit ([part 1](../0001-human-in-the-lead.md#13-the-objective)).

- **Recommend: relative value points on a fixed scale** (1, 2, 3, 5, 8, 13), set at shaping and calibrated against the owner's bets and later outcomes.
- **Alternative: a money-like unit** (estimated value per period of delay). More meaningful for cost of delay, harder to estimate for platform and research work, and closer to commercial matters this public repository should not hold.

### Q26. What share of a machine may `hitld` use by default? (affects the machine profile `hitld machine detect` proposes)

*Decided: by the machine's role.* The machine profile has a role, and each role has defaults ([13.4](13-operations.md#134-settings-in-four-layers)):

- **Dedicated**: everything except one core and about 10% of memory. Load checks only for quiet holds.
- **Workstation**: half the cores and half the memory. Load-aware: it yields to the person and their programs.
- **Cloud VM**: its whole allocation. Cost-aware: it shuts down when idle and keeps to a budget per machine-hour.
- **CI or ephemeral**: what the job grants. No setup questions.

`hitld machine detect` proposes a role from local hints (a desktop session, container or virtual machine markers, CI variables), with no network calls. The person confirms it, except on CI and cloud machines, which take conservative detected values and record them.

### Q28. Does the person file sync across machines? (affects first-run setup on a second machine)

*Decided: no, as recommended.* The person keeps the person file with their dotfiles, and HITLd does not sync it. Settings loading allows a dotfiles repository and symlinks to it ([13.4](13-operations.md#security)).

- **Recommend: no. The person keeps it with their other dotfiles, and the system does not sync it.** The first-run walk-through on a new machine offers to copy values the person pastes in. The account-wide usage reading already keeps every machine inside the plan.
- **Alternative: sync it through the private store's bundle exchange** ([Q1](#q1-where-does-the-private-store-live-and-do-other-machines-share-it)). One less file to carry, at the cost of personal plans and limits travelling with project data.

### Q29. How is headroom shared when several projects compete near the reserve? (affects the budget controller across projects)

*Decided: equal shares by default, as recommended.*

- **Recommend: equal shares by default, which the person changes in the person file; inside its share each project applies its own ladder.** No project's routine work can starve another's critical path.
- **Alternative: critical-path work from any project first, then routine work by share.** Better for the most urgent work overall, but it compares priorities across projects that were set separately.

### Q30. Does the files backend's `priority` key retire with the milestone migration? (affects the milestone format)

*Decided: yes, retire it in the milestone migration.*

Ordering is derived (cost of delay over size), and milestones split work into constraints and contributions, so a stored priority label duplicates what is derived ([part 3](03-data-model.md#30-principles-of-the-model), principles 1 and 3).

- **Recommend: retire it in the same migration.** `hitld work migrate` drops the key; an owner's direct reorder stays a recorded decision ([part 2](02-loops.md#24-prioritization)).
- **Alternative: keep it as an optional owner override** that breaks ties. Familiar to people from other trackers, but a second source of order that can disagree with the derived one.

### Q31. Who commits a bet project's milestones? (affects milestones)

*Decided: design review proposes, the owner commits.*

- **Recommend: design review proposes them, and the owner commits them in the same batched review**; afterwards the orchestrator adds and cuts contributions within each appetite. Changing an outcome, a clause or a constraint stays a decision ([part 3](03-data-model.md#milestone)).
- **Alternative: the orchestrator commits milestones inside a bet's appetite**, and the owner commits only those with a deadline or a public commitment. Less attention, but the future states that steer the work are set without the owner.

### Q32. Where does a release record live? (affects releases)

*Decided: `work/releases/<tag>.md`, as recommended.*

- **Recommend: one file per release in the tracker (`work/releases/v0.4.0.md`)**, named by the tag. The interface delta and the owner's decision do not fit in a tag, and the read API can return the file like any entity ([part 3](03-data-model.md#release)).
- **Alternative: the annotated tag message holds the record.** Nothing new in the tracker, but readers need git, and the record cannot be validated with the other files.

### Q33. Does the first release wait for the milestone and release format? (affects HITLD-24)

*Decided: yes.* The first release waits for the milestone and release format (HITLD-45).

- **Recommend: yes.** The format change replaces two keys of a public schema. Releasing first would mean shipping a format the next release breaks, and every consuming project would need a migration on its second release. The release item HITLD-24 needs the build item HITLD-45.
- **Alternative: release v0.1.0 now** and ship the format in the next minor, with the tracker format migration, `hitld work migrate`. A consuming project starts sooner, at the cost of one migration.

## Before later milestones

### Q13. May the merge queue push candidate branches to GitHub so CI can test them? (blocks CI integration)

*Decided, as recommended; it comes later, with CI integration.* Candidate branches go to `hitld-queue/*` in the same repository, for `public` work only, and are deleted after the verdict.

Pushing is outward-facing; this repository and consuming projects may be public ([part 14](14-integration.md#145-ci-integration-later-milestone)).

- **Recommend: yes, to a dedicated `hitld-queue/*` branch namespace in the same repository, for `public` work only** (and `internal` work in a private repository), deleted after the verdict.
- **Alternative: a separate private mirror repository used only for CI.** Nothing unmerged appears in the public repository, at the cost of keeping a mirror in sync and paying for its runners.

### Q14. May Claude Code's OpenTelemetry export be turned on, to a local collector only? (blocks Explorable reporting)

*Decided: yes, to a local collector only, as recommended.* Nothing is sent off the machine.

It is a documented source of per-request token and cost data ([part 12](12-reporting-and-limits.md#what-can-be-measured-by-harness)).

- **Recommend: yes, with a local file or collector exporter only**, nothing sent off the machine.
- **Alternative: leave it off** and rely on the ledger, headless JSON results and status-line snapshots. Simpler, but per-request costs for background agents go unmeasured.

### Q15. Who holds the sealed eval set, and where does its runner run? (blocks Self-improvement)

*Decided: the owner's machine first; private CI later.*

The sealed set must be unreadable by the agents that improve the plugin ([part 18](18-self-improvement.md#2-a-sealed-eval-set-the-improving-agents-never-see)).

- **Recommend: the owner's machine.** Scenarios encrypted in the owner's private store; the key in the operating system's keychain; `hitld eval --sealed` run by the owner on release candidates. No hosted service holds the key.
- **Alternative: a CI job in a private repository**, holding the key as a secret. Sealed runs no longer wait for the owner, at the cost of a hosted place that holds the key and must be secured.

### Q16. What may the Copilot cloud agent work on? (blocks Copilot adapter)

It runs on GitHub's infrastructure ([part 15](15-architecture.md#the-copilot-cloud-agent-asynchronous-tier-3-and-intake-to-pr)).

- **Recommend: `public` items only**, the rule for any harness without hooks ([part 15](15-architecture.md)). The tightest boundary; most of a private project's work stays with local harnesses.
- **Alternative: items up to `internal`, only in repositories already hosted on GitHub**, never `confidential`, as an exception the owner grants per repository once the cloud agent's own controls are reviewed.

<a id="q17-which-area-of-a-consuming-project-gets-the-adversarial-loop-first-after-v0"></a>

### Q17. Which area of a consuming project gets the adversarial loop first? (after One signal end to end)

*Decided: an area with a strong oracle, as recommended.*

- **Recommend: an area with a strong oracle**: code being rewritten whose previous implementation can serve for differential tests, or code with clear metamorphic relations. Breaks are then unambiguous and cheap to confirm.
- **Alternative: the area with the most escaped defects recently**, where a break is most valuable but harder to confirm without an oracle.

### Q19. Are routine contributor replies ever sent automatically? (blocks Outside contributors)

*Decided: draft-only first, as recommended.*

Agents draft every reply; sensitive replies always go through a human ([part 9](09-contributors.md#93-replies)).

- **Recommend: draft-only at first**, then the owner enables automatic sending of routine replies per source and trust level once the drafts have a record.
- **Alternative: automatic routine replies from the start** for trust level T1 and above. Faster responses, with the risk that early drafts sound automated to people the project wants to keep.

### Q20. DCO or CLA for inbound contributions? (blocks Outside contributors; also applies to this repository)

*Decided: DCO, as recommended.* Inbound contributions carry a `Signed-off-by` line under the [Developer Certificate of Origin](https://developercertificate.org/). It applies to this repository's own commits too. The owner signs off the first public commit. For a commit an agent made, the person who approves its merge signs it off. CI gains a DCO check (planned). See [9.6](09-contributors.md#96-legal).

- **Recommend: DCO sign-off.** Light for contributors, no copyright assignment, and consistent with Apache-2.0's inbound-equals-outbound practice.
- **Alternative: a CLA.** Lets the project relicense later, at the cost of friction for every contributor and an agreement to administer.

### Q21. How is a decider's identity established? (blocks any second human, and any channel other than the local session)

*Decided: answers come only from the owner's own turns in the main session* (typed, or sent through Remote Control). Executors cannot record, overrule, reverse, rate or trust a decision: the plugin's Bash guard denies it for the attested executor agent types, and the command line refuses it when `HITLD_ROLE=executor` or `HITLD_DISPATCH` is set. The orchestrator skill records an answer only from the owner's message, never from a tool result, report, file, page or notification. Signed answers follow when a second human joins; answers by GitHub identity are an option for remote channels.

`hitld rights answer --by` is supplied by the caller, and nothing authenticates it ([part 4.5](04-decision-rights.md#45-several-humans-in-the-lead)). In the built slice the caller is trusted as the local user, who is the owner, so the claim "an area owner answered this" is not checked.

- **Recommend: keep trusting the local user for now, and design authenticated principals (who is calling, through which channel) before a second human or a remote channel is added.** Until then a precedent made "by" an area owner carries no more assurance than the local user's word.
- **Alternative: authenticate now**, by signing answers or taking them only through a channel that proves who sent them. It closes the gap earlier, at the cost of an identity design before it is needed.

### Q23. Who sees a person's calibration review? (blocks People in the lead)

*Decided: only that person, as recommended.*

The review exists for the person's own improvement ([part 23](23-people-in-the-lead.md#234-feedback-to-the-person-the-calibration-review)).

- **Recommend: only that person.** The person may share more. Feedback works when it is safe to be wrong.
- **Alternative: the owner sees every area owner's review.** More oversight, at the cost of turning feedback into evaluation, which invites hedging.

### Q24. Who decides a change to a person's prior weight? (blocks People in the lead)

*Decided: nobody; weights tune themselves.* A weight shrinks toward the default and moves only as far as its evidence supports: with few outcomes, it barely moves. There are no owner-set bounds. Two rules are fixed in the design: no one's judgement is weighted to zero, and no one's gut check alone overrides contrary evidence. Each person sees their own weights in their private review ([part 23](23-people-in-the-lead.md#233-calibration-as-a-prior)).

- **Why not an owner decision per change.** A weight is an estimate from data, not a policy. Shrinkage keeps it from moving on thin evidence, and the fixed rules bound it, so tuning inside them is not a rule change.
- **Alternative not taken: the owner decides each change**, as one batched decision per person. More oversight, at the cost of owner attention and of the owner reviewing everyone's calibration.

### Q27. What load threshold and settle period gate heavy work and quiet holds? (affects load-aware admission)

*Decided, as recommended.* Heavy work waits above 0.7 load per core or under high memory pressure; a quiet hold starts after 60 seconds below 0.2 per core.

- **Recommend: defer heavy work while the one-minute load average per core is above 0.7 or memory pressure is high; start a quiet hold after load per core stays below 0.2 for 60 seconds.** Both are machine settings the person can change, and admission wait shows whether they are too strict.
- **Alternative: no admission check**, leaving load to the concurrency controller. Simpler, but the controller reacts only after flakes and slow suites appear, and it cannot see the person's own load.

### Q34. What are the flake defaults? (affects 14.7)

*Decided, as recommended.* Burn-in is 5 runs in the fast checks and 20 in the nightly sweep. The base-versus-candidate comparison is 10 runs per side. A test stays in quarantine 14 days. A flake counts as fixed after 100 stress runs ([part 14](14-integration.md#147-flaky-tests)).

### Q35. May the orchestrator quarantine on evidence without asking? (affects 14.7)

*Decided: yes, as recommended.* Entry needs evidence, every entry expires into a decision for the owner, and every digest lists the quarantine. The quarantine file is public and holds only test IDs, environment scope, expiry and the fix item; the evidence stays in the private store.

### Q36. Does the executor contract carry the failing-test line? (affects 14.7)

*Decided: yes.* "A failing test is yours unless you show it fails on the base commit too, or it is in the quarantine list. Never call a failure flaky without a rerun." It is item 8 of the contract template.

---

## Calls made in this design

These are calls the design makes without asking. Each can be reversed cheaply now; listed so they can be checked while reading.

- **Naming.** The command line is `hitld`; the plugin and marketplace are `human-in-the-lead`; the project directory is `.human-in-the-lead/`. "HITLd" abbreviates human in the lead, which the "d" keeps apart from HITL, human in the loop.
- The core is Node.js with no third-party runtime dependencies ([part 16](16-packaging.md#161-this-repositorys-layout)).
- Skills call the command line where a shell exists, and the MCP server (tools only) where it does not ([part 15](15-architecture.md#151-layer-1-the-neutral-core)).
- Core skill files use only the portable `SKILL.md` front matter; harness-specific fields are added at packaging ([part 15](15-architecture.md#skills-in-the-agent-skills-format)).
- The plugin lives in `plugins/human-in-the-lead/`, listed by a marketplace at the repository root ([part 16](16-packaging.md#161-this-repositorys-layout)).
- Decisions are items of kind `decision` in the same tracker and number space ([part 3](03-data-model.md#decision)).
- Studies and runs stay in the project's benchmark tool; this system cites them ([part 3](03-data-model.md#study-run-verdict)).
- The report shape adds `status` and `calls` (logged calls) to the agreed shape ([part 5](05-execution.md#56-the-report-shape)).
- Executors never create tracker entities; the orchestrator does ([part 3](03-data-model.md#id-allocation)).
- Claims are read from branches; `main` never shows `In progress`; views are written only as part of a merge (by the queue, or by the merge the owner names in owner mode) ([part 3](03-data-model.md#initiative-project-item)).
- A sandboxed reproducer role turns bug reports into failing tests ([part 2](02-loops.md#22-triage)).
- The owner's own words in the main session are directions; notes and pasted material become signals ([part 9](09-contributors.md#92-trust-levels)).
- A minimal acceptance author and the security baseline are part of "One signal end to end" ([part 21](21-scope.md)).
- The checks of "One signal end to end" run on synthetic fixture repositories; an existing project's tracker is touched read-only there ([part 21](21-scope.md#done-when)).
- The Copilot adapter comes right after "One signal end to end" and before Codex; that milestone's eval suite already checks the core against the Copilot cloud agent's constraints ([part 17](17-evals.md#177-portability)).
- Session transcript files are never parsed for usage, because their format is not a documented interface; usage comes from documented sources ([part 12](12-reporting-and-limits.md#what-can-be-measured-by-harness)).
- The status-line usage capture is opt-in: the first-run setup offers it, and it installs a status line command (wrapping the person's existing one, if any) only on a yes ([part 12](12-reporting-and-limits.md#what-can-be-measured-by-harness)).
- The run-state file is derived; the ledger is the truth, written before each checkpoint ([part 13](13-operations.md#131-orchestrator-continuity)).
- UX design and review is its own loop and part, beside verification ([part 7](07-ux.md)).
- The audit trail is its own hash-chained file, separate from the ledger ([part 3](03-data-model.md#audit-record)).
- Loops are nested by speed, with stability rules strictest on the slow loops ([part 2](02-loops.md#loops-nested-by-speed)).
- Judgements are calibrated priors: the owner's gut checks start with a high weight, set in the owner's person layer; weights tune themselves by shrinkage under two fixed rules; evidence that contradicts a judgement is put to its person, never silently applied ([part 3](03-data-model.md#judgement), [part 23](23-people-in-the-lead.md#233-calibration-as-a-prior)).
- Trust-calibration data is collected from the start; autonomy changes are always owner decisions ([part 2](02-loops.md#215-trust-calibration)).
- This repository keeps its public signals in `signals/`; the first 18 are the owner's untriaged ideas ([part 3](03-data-model.md#layout)).
- Markdown stays the knowledge base's source of truth; any search index is a rebuildable cache ([part 8](08-knowledge-base.md#82-markdown-in-git-is-the-source-of-truth)).
- Speculation cost is reported separately from waste ([part 5](05-execution.md#speculative-execution-later)).
- Trust levels T0–T4 ([part 9](09-contributors.md#92-trust-levels)).
- The private store's default path is `~/.local/share/human-in-the-lead/<project-id>/` ([part 3](03-data-model.md#private-store)).
- Controllers move settings only inside owner-set bounds; anything else is a rule change ([part 11](11-metrics-and-control.md#112-who-moves-what)). Judgement weights are estimates, not settings, and have no owner bounds ([Q24](#q24-who-decides-a-change-to-a-persons-prior-weight-blocks-hl)).
- New projects start in owner merge mode (`merge.mode: owner`): the owner decides each merge ([part 14](14-integration.md)).
- For caps and limits, the strictest settings layer wins ([13.4](13-operations.md#precedence)).
