# 14. Integration and CI

[Back to the index](../0001-human-in-the-lead.md)

Many executors finish work in parallel; integration turns their branches into a `main` that is always green. The basic merge queue (14.1–14.4) is in "One signal end to end" ([part 21](21-scope.md)). Agent conflict resolution beyond the simple cases (14.3) and CI integration (14.5) come later.

## 14.1 Keep the integration branch green

`main` is the integration branch. Its invariant: **every commit on `main` passed the full test suite as part of the batch that produced it.** The merge queue enforces it by fast-forwarding `main` only to a commit it has tested. No executor, and no person through the system, commits to `main` directly; the orchestrator's own tracker edits go through the queue as tier-0 branches too.

## 14.2 The queue

For each finished branch, after verification ([part 6](06-verification.md)) has passed:

1. **Order.** Branches merge in **dependency order**: an item whose `needs` include another waiting item goes after it. Among independent branches, priority order ([part 2](02-loops.md#24-prioritization)). Branches whose `touches` overlap go one after the other.
2. **Rebase** onto the current tip of the batch under construction.
3. **Fast checks** on the rebased branch: the commit guard's classification rule on each of its commits (built in, whatever the policy lists; [10.3](10-security.md#103-information-classification)), the duplicate-ID check (built in: two tracker items with one ID in the rebased tree send the branch back, naming both files; [3.4](03-data-model.md#id-allocation)), lint, type check, the item's acceptance checks, the tests nearest its `touches`, the burn-in of the tests it adds or changes ([14.7](#147-flaky-tests)), and the declared security scans, diff-aware against the baseline (below). A branch that changes the quarantine file is sent back ([14.7](#quarantine)).
4. **Batch.** After `merge.batch_max` branches, or when no more are waiting, run the **full suite once** on the combined result, then regenerate tracker views ([part 3](03-data-model.md#generated-views)) and commit them on top.
5. **Fast-forward** `main` to the tested commit. Each branch's `state: Done` closes its items.

**Two modes** (`merge.mode`). In `queue` mode the orchestrator runs the queue whenever branches are waiting; the owner opts into it once the record supports it. In `owner` mode, the default for a new project, a finished branch **waits for the owner, but is checked first**. Asking the owner to approve a branch no check has run on, on the executor's own account of it, is the human-in-the-loop gate [part 1.1](../0001-human-in-the-lead.md#11-what-human-in-the-lead-means) warns against: as volume grows it becomes a rubber stamp.

1. **Check before asking.** `hitld merge` runs steps 1 to 4 on every waiting branch (rebase, the commit guard, the fast checks, the scanners, the full suite and bisection) and holds the tested commit (`refs/hitld/merge-held`) without moving `main`. A branch that fails is sent back to its executor and is never shown to the owner.
2. **Evidence the executor did not write.** Each green branch is presented with what the queue and git say about it: the checks that passed, the files it actually changes against its `touches` (tracker edits and generated files aside), the files under `dispatch.sensitive_globs`, the public-surface delta (files under `merge.public_globs`, and for a JSON schema the fields added, removed or changed) and the deviations found, such as files outside `touches` or a branch tip that is not the commit the report named. A **directed read** ([6.6](06-verification.md#66-when-a-human-reads-the-code)) is attached only where a trigger fires: a sensitive path, a public-surface change, a dependency manifest, or an area in `dispatch.owner_review_areas`. Each names the files, the diff to look at and the question.
3. **One approval per batch.** The orchestrator puts the batch to the owner in one message: "Merge all 4? yes, or list the ones to merge". Yes is `hitld merge --all`: with `main` unmoved, it fast-forwards `main` to the held commit and runs nothing again. A list is `hitld merge --only <branch>[,<branch>]`: its stack differs from the one tested, so the queue checks just those branches again before `main` moves. Only presented branches can be approved, and a branch that moved since it was presented is refused, because the owner was shown other code. The orchestrator runs `--all` or `--only` only when the owner's own message in the session says to; the command refuses when run from an executor.

   **The approval is one record, wherever the owner gives it.** Every approval is a `merge-approved` ledger event naming the presentation it answers (its time and tested commit), the branches approved and the session that recorded it. When the owner talks to the chief of staff rather than to the session holding the lease ([13.1](13-operations.md#the-chief-of-staff-and-disposable-orchestrators)), the chief of staff records the owner's answer with `hitld merge approve --all` or `--only <list>`, from the owner's own message, under the same rules: only presented branches, none that moved since. The orchestrator then runs plain `hitld merge`, which applies exactly that answer and chooses nothing itself. An answer whose branches moved before it was applied is not applied: the batch is checked and presented again. Applying an approval clears the presentation, so each is applied once.
4. **Approvals are trust evidence.** Each approval, when it is applied, is recorded as a `merge-approval` trust event ([part 4.6](04-decision-rights.md#46-autonomy-changes-with-the-record)), one per area the branch changes, once whichever session recorded it: the latency from presentation to the owner's answer, and whether the owner took the batch as presented or named a list. A later `reverted` ledger event for the item adds a `merge-reverted` event.
5. **Limits, and earning the queue.** `merge.owner_paths` and `merge.owner_areas` limit owner mode to paths or areas (`unassigned` names files in no area); a branch that changes nothing there goes through the queue as in `queue` mode. `merge.owner_paths` is read in order, the last glob a file matches deciding, and a glob that starts with `!` takes files back out. With both empty, every branch waits. After `merge.propose_queue_after` merges in a row in an area, each approved as presented and none reverted, `hitld merge --all` or `--only` proposes letting the queue merge that area without asking, with the policy change a yes would make. The orchestrator puts it to the owner as a decision; the system never changes `merge.mode` or the owner settings itself.

**Through pull requests** (built, HITLD-133, as `merge.via: pull-request`; the default `push` is the local fast-forward above). A cloud session cannot push `main`, and a protected `main` may refuse a push anywhere, so `main` moves by GitHub's squash merge instead, and still only to a commit that passed the checks the policy names. Each `hitld merge` is one pass over the waiting branches, in dependency order:

1. **Guard.** On each branch against `main`: the commit guard on every commit it brings, the duplicate-ID check, a change to the quarantine file, and the item closed in the branch itself, so the tracker's close (state, `claimed_by`, the release note) lands in the same pull request. These run whatever the policy says; on this path the named checks stand in for the fast checks, the scanners and the full suite.
2. **Open or update** the branch's pull request. Its title and body come from the item, the report's evidence and the release note, checked against the private term list first, as `hitld publish check` would.
3. **Wait for the named checks only** (`merge.pull_request.checks`), and for each of `merge.pull_request.conditional_checks` unless every changed file matches its `unless_only` globs: a check CI reports only for some changes, such as the code scanning result `CodeQL`, which a text-only pull request never gets (decision HITLD-312). One that failed sends the branch back. One still running holds the merges after it, until it has run longer than `merge.pull_request.check_timeout_minutes`: then the pull request is reported as stalled, stays waiting, and the queue goes on without it, so a check that never completes never stalls the queue. Checks it does not name are never waited for.
4. **The owner.** Whether a green pull request waits for the owner is one function of the paths it changes (`pullRequestWaits`), never of its author or description. None waits in queue mode. In owner mode the local queue's rule applies (built, HITLD-150): one that changes a file under `merge.owner_paths` or in an area named in `merge.owner_areas` waits, every one waits when both are empty, and one that changes nothing there is merged once its named checks pass. The paths are git's own (`--no-renames`, unquoted), so a file moved out of an owner path counts where it came from. `merge.owner_paths` is read in order, the last glob a file matches deciding, and a glob that starts with `!` takes files back out: `["**", "!work/**", "work/releases/**"]` holds everything but the tracker and keeps release records with the owner, and a new directory waits. Three rules hold whatever the paths say (decisions HITLD-310, HITLD-313): a pull request that adds, changes or removes a symbolic link anywhere waits; and one that would merge without asking but changes a decision's answer fields waits, marked `answer_unverified`, unless the rights flow recorded that answer: an `answered` ledger event for the decision at its `answered_at`, with the same text where the event holds it (`rights answer` records it), or a precedent's application at that time citing the same precedent. Both are read from the diff, the item at the merge base and at the head. One that waits is presented with its link, its changed files and the checks that passed, and merges only with a recorded approval of its head (`hitld merge --all` or `--only`, or `hitld merge approve` by the chief of staff), which carries the owner's `Signed-off-by` (`--signoff`). An approval holds across the queue's own updates (below) and no other new commit. **Merges under the owner's delegation.** When `merge.pull_request.delegated_by` names the owner's decision that delegated them, a pull request merged without asking carries the owner's `Signed-off-by`, the one their latest approval gave, and a `Delegated-by` trailer naming that decision; until an approval has given one, such a pull request waits for the owner, marked `no_signoff`. Each is recorded in the ledger with that decision and listed in the digest with the command that reverses it (a `git revert` merged through its own pull request, then a `reverted` ledger event).
5. **Bring it up to date.** A green branch behind `main` gets `main` merged in (never a rebase, never a force-push), its generated files rebuilt (`merge.generated`) and committed, and is pushed and checked again. A conflict sends it back to its executor as a follow-up.
6. **Squash-merge** through the GitHub API, only while the head is the commit checked, with a message carrying the trailers of the branch's own commits (`Work-Item`, `Dispatch`, `Agent-Role`, `Agent-Model`, `Agent-Effort`) and, when the owner approved it, their `Signed-off-by` (or, under their delegation, the delegated one above). The merge is recorded in the ledger and the merged branch's worktrees are released, as after a local merge; the next waiting branch is then brought up to date (step 5).
7. **Trust and earning the queue**, as on the local path: each approval applied is a `merge-approval` trust event per area, and each merge under the owner's delegation a `merge-delegated` one. A `reverted` ledger event for either adds a `merge-reverted` event; for a delegated merge it starts the area's clean run again from the revert. After `merge.propose_queue_after` approvals in a row in an area, `hitld merge` returns the proposal with the policy change a yes would make, and the orchestrator puts it to the owner as a decision. For a glob in `merge.owner_paths` that reaches past the area (`**`), the change keeps it and adds the area's paths after it as exclusions, so only that area stops waiting. An area's paths may include the generated copy of its sources, so one approval frees both: this repository's `core` and `skills` areas include their copies in the plugin build under `plugins/` (decision HITLD-317).

GitHub is reached through the GitHub command line's own sign-in (`gh api`): HITLd stores no token. The tests run the whole flow against a fake GitHub API whose repository is a bare git remote: a green pull request, a red check, a check that never completes, a conflict on update, and the owner's sign-off; and who decides: a pull request outside the owner paths merged under the delegation, one inside left waiting, one touching both, a rename, the same decision whatever the author, message or description say, the proposal after the threshold, and a revert starting the run again (`core/test/merge-pull-request.test.mjs`).

The report and digest show the branches waiting and for how long.

The batch size has its own controller: smaller after failures, so bisection is cheaper; larger after a run of clean batches ([part 11](11-metrics-and-control.md#114-feedback-controllers)).

**Security scans** (built, HITLD-63, as `merge.scanners`; the rules are in [10.5](10-security.md#105-security-in-done-when)). Scanners are declared in `policy.json` next to the other fast checks: static analysis (Snyk, CodeQL or Semgrep, for example) and dependency audits, each with its command and output format (SARIF by default). None is built in. The queue runs each one on the rebased branch and compares its findings with the baseline and the recorded verdicts. The working directory is the branch, so a scanner script kept in the repository is run from the primary checkout the policy came from, which the queue passes as `$HITLD_PRIMARY_ROOT`, never from the branch's copy (HITLD-73). A finding that is in neither sends the branch back to its executor, with the finding; the executor fixes it with a test, or proposes a verdict in its report. A by-design or false-positive verdict on a sensitive path waits for the security review. An accepted risk waits for the owner. After the batch merges, the queue removes fixed findings from the baseline. A finding with an accepted risk past its expiry becomes a decision for the owner, as an expired quarantine entry does (14.7).

## 14.3 Conflicts

When a rebase conflicts, the queue classifies the conflict:

| Class | Example | Handled by |
|---|---|---|
| **Generated** | Tracker views, lockfiles, generated code | Regenerate from the sources after the rebase; never merge generated files by hand (basic queue) |
| **Trivial** | Both branches added entries to the same list; import order; adjacent but independent hunks | A tier-1 conflict-resolver agent, whose result must pass the same fast checks (later milestone; in the basic queue, these go to the next row) |
| **Semantic** | Both branches changed the same function's behavior | Back to the later branch's executor as a follow-up, with both diffs and the earlier item's intent (basic queue) |
| **Intent conflict** | Two items' goals contradict each other | A decision for the owner (an area owner once [Q21](22-open-questions.md#q21-how-is-a-deciders-identity-established-blocks-any-second-human-and-any-channel-other-than-the-local-session)'s signed answers exist), under the rights rules ([part 4](04-decision-rights.md)) |

Conflict rate per area is recorded; a rising rate is a congestion signal for the concurrency controller and a hint that two items should have been one.

## 14.4 Bisection and flakes

When a batch fails the full suite:

1. **Rerun the full suite on the same commit** (`merge.flake_reruns`, default once). If it passes, the failure is a **flake candidate** (step 4). If it fails again, run the suite on the batch's base (current `main`): a failure there means `main` was not green, which is an incident ([part 2](02-loops.md#27-shipping)).
2. **Bisect**: split the batch, run the full suite on each half, and recurse until the culprit branch is found.
3. The culprit goes back to its executor as a follow-up; the rest of the batch merges.
4. **Flakes** are not blamed on the branch until the evidence says so. The base comparison decides (built, HITLD-21): the full suite runs on the batch's base and then on the candidate, `flake.compare_runs` times each. A failure on the base is a pre-existing flake: nobody is blamed and the batch goes on. A failure only on the candidate is an intermittent failure the change brought: the batch is bisected as in step 2, each probe running the suite up to `flake.compare_runs` times, and the culprit goes back to its executor. A failure on neither is inconclusive: nobody is blamed, the batch goes on, and the comparison is counted. Every failure, with what the rerun and the comparison found, is recorded in the private store (`merge/flakes.jsonl`). How a flake is told apart from a new intermittent bug, quarantined, fixed and kept from coming back is in [14.7](#147-flaky-tests).

## 14.5 CI integration (later milestone)

Local verification has limits: one machine's hardware, one operating system, the owner's laptop being awake. CI integration lets the queue's checks run elsewhere.

- **Pushed candidate branches.** The queue pushes the batch under test to a candidate branch (`hitld-queue/<n>`, a prefix distinct from the executors' `hitld/`) and GitHub Actions runs the suite on it; the result is the batch's verdict. Pushing is an outward-facing act, so it needs the owner's standing decision for the repository, and only `public` (or, for a private repository, `internal`) work goes there.
- **Special runners.** Hardware-bound tests (a GPU, a device farm), benchmark baselines and visual regression run on self-hosted or larger runners with the right hardware, as serial resources with their own locks.
- **GitHub's merge queue as a backend.** For a project that merges by pull request (`merge.via: pull-request`, 14.2), the queue's ordering and batch rules map onto GitHub's merge queue instead of the pass `hitld merge` runs over the pull requests one at a time, with the same checks. Not built.
- **Evidence.** CI results enter the item's evidence with run links, and the ledger records them like local runs.

## 14.6 Measures

| Measure | Definition |
|---|---|
| **Main-green share** | Share of commits on `main` whose full suite passed (target: all of them) |
| **Queue wait** | Time from a branch passing verification to its merge |
| **Approval latency** | In owner mode, time from a batch being presented to the owner's approval, per area (the `merge-approval` trust events) |
| **Batch failure rate** | Share of batches that failed the full suite |
| **Bisection cost** | Suite runs spent on bisection per failed batch |
| **Conflict rate** | Rebases with conflicts, per class and per area |
| **Flake rate** | [Part 11](11-metrics-and-control.md#111-measures) |

## 14.7 Flaky tests

A flaky test passes and fails on the same code. It costs more here than on a human team, for three reasons. Many agents run suites at once on one machine, so timing and shared-resource flakes appear that a lone developer never sees. Agents write many tests quickly, and a new test can be flaky from the start. And agents explain away failures: "this failure is flaky and unrelated to my change" is a claim agents make, and it is often unverified. A flake left alone trains everyone, people and agents, to ignore red.

### Principles

- **A failure belongs to the change until the evidence says otherwise.** Nobody, executor or orchestrator, may call a failure flaky without a recorded rerun.
- **A flake can be a product bug.** Intermittent failure is often a real race in the code under test, not in the test. The fix item says which it is, with evidence.
- **Quarantine lowers the gate, so it is controlled.** It needs evidence, it expires, it is visible in every digest, and an executor can never do it.
- **Retries hide; they do not fix.** A fix that only adds a retry, a sleep or a longer timeout must say why the wait is inherent; review checks for it.

### Detection

| Where | How | What it proves |
|---|---|---|
| **Gate failure** (fast checks or full suite) | Rerun the failing tests once on the same commit (in the basic queue, the whole suite) | Pass on rerun: a flake candidate. Fail again: a real failure, handled as in 14.4 |
| **Is it new?** (for every candidate) | Run the test `flake.compare_runs` times (default 10 per side) on the candidate and on its base, under the same load (in the basic queue, the whole suite, base first) | Fails on the base: a pre-existing flake; the branch is not blamed. Fails only on the candidate: the change introduced an intermittent bug; it goes back to the executor. Fails on neither: inconclusive, not blamed, counted |
| **Burn-in** of new and changed tests | In the fast checks, each test the branch adds or changes runs `flake.burn_in_runs` times (default 5; 20 in the nightly sweep) with shuffled order and varied seeds | A new test that fails once is the branch's problem, before it can gate anyone else |
| **The flaky-test sweep** (scheduler, [part 13](13-operations.md)) | Rerun recent failures on unchanged code; stress-run quarantined tests under load | Confirms candidates, clears fixed tests, catches flakes that only appear under load |
| **History** | Per-test results from every run, through the project's test reporter, kept in the evidence source | A test's failure rate over time, by environment, without extra runs |

The rerun on the same commit is cheap and runs every time. The base-versus-candidate comparison costs more, so it runs only for a candidate, and its run count is a controller setting ([part 11](11-metrics-and-control.md#114-feedback-controllers)) with a ceiling, `flake.compare_runs_max`, in `policy.json`; the queue never runs more.

**What the project provides** (built, HITLD-21). The queue knows nothing of a project's test framework, so two contracts let it name tests, like the scanners' `$HITLD_SARIF`:

- **The test report.** Each full-suite command gets `$HITLD_TEST_REPORT`, a path. A suite that writes a JSON object there, `{"schema_version": 1, "tests": [{"id", "outcome": "pass" | "fail" | "skip", "file"}]}` (`file` is optional), lets the queue name the tests that failed, compare them on the base, and honor the quarantine. Without a report, the rerun and the comparison still work on the whole suite, but no test can be quarantined.
- **The burn-in command.** `flake.burn_in_command` runs the tests a branch adds or changes. The queue calls it `flake.burn_in_runs` times, with `$HITLD_BURN_IN_FILES` (the changed files that match `flake.test_globs`), a different `$HITLD_BURN_IN_SEED` each time and `$HITLD_BURN_IN_RUN`. A non-zero exit fails the branch. With no command, new tests are not burned in.

### Quarantine

- **Entry.** The orchestrator may quarantine a test, without asking and reporting it in the digest, when it has a recorded fail and pass on the same commit, and the comparison shows it fails on the base too. It cannot quarantine a test that the branch under test adds or changes; that test goes back with the branch. `hitld quarantine add` checks that evidence in the private store, needs the fix item (a work item that exists and is not done), and sets the expiry itself. The orchestrator commits the file on `main`.
- **What it means.** A quarantined test still runs everywhere, and its results are still recorded, but it does not gate: a full suite whose failures are all quarantined tests passes, and each excused failure is recorded. A quarantined test that the batch under test changed gates anyway. An entry can be scoped to an environment (an operating system, a database version, a browser) when it fails only there; the queue's environments are its operating system and the labels in `flake.environments`.
- **Where.** `.human-in-the-lead/quarantine.json` in the repository, so every worktree, machine and CI run sees the same list. The file is public in a public repository, so it holds only the test ID, the environment scope, the expiry and the fix item. The evidence (run IDs, logs) stays in the private store, keyed by the test ID. The schema is `schemas/quarantine.schema.json`.
- **Expiry.** Each entry lasts `flake.quarantine_days` (default 14). At expiry the test gates again, and a still-flaky test becomes a decision for the owner (an area owner once Q21's signed answers exist): fix it now, rewrite it, or delete it. Deleting a test is never the system's call. An expired entry is renewed only with the owner's answered decision, and an entry is removed once its fix item is done.
- **Visibility.** Every digest shows the quarantine list, its size, its oldest entry and what quarantined tests would have caught. `hitld quarantine list` is that section: each entry with its expiry and fix item, the flake measures below, and for each expired entry the question for the owner.
- **Guard.** The file is checked, and executors cannot edit it. An entry without an expiry or a fix item is refused, as is any key the schema does not list (`hitld check quarantine`). The merge queue checks main's file before every run, stops with an incident when it fails, and sends back any branch that changes the file, so no executor's change reaches `main`. The Bash guard denies an executor the quarantine commands and writes to the file; reading it is allowed, because the contract tells executors to look there. Guards on the Write and Edit tools belong to the planned security baseline ([part 21](21-scope.md)).

### Fixing

Each confirmed flake becomes a work item in the test's area, with the evidence attached: failure logs, seeds, order, environment, the failure rate, and whether load mattered. Its priority comes from what the flake costs: reruns, suite time, merges it delayed, and attention.

The fix follows the reproducer pattern ([part 2](02-loops.md#22-triage)): first a **deterministic reproduction** (a fixed seed, a forced order, an injected delay, a held lock), then the fix. Done when the reproduction passes and a stress run of `flake.fixed_runs` (default 100) passes under load. The common causes, as a checklist in the fix brief:

| Cause | Typical sign | Usual fix |
|---|---|---|
| Order dependence, shared state between tests | Fails only with shuffled or filtered runs | Isolate state; set up and tear down per test |
| Timing and asynchrony | Fails under load, passes alone | Wait on the condition, not on a duration |
| Shared machine resources (ports, files, lock directories, GPU) | Fails when other suites run at once | Take resources through the environment manager, or isolate per test |
| Uncontrolled randomness, time or locale | Fails on some seeds or dates | Inject the seed, clock and locale |
| Network or external services | Fails offline or on slow links | Fake the service; the network allowlist makes this visible |
| A real race in the product | Fails in both the test and the reproduction with no test fault | Fix the code, not the test; the item is a bug, not test hygiene |

### Load and concurrency

Flakes that appear only when several suites run at once are a signal about the machine, not just the test. The flake rate is an input to the concurrency controller ([part 11](11-metrics-and-control.md#114-feedback-controllers)): when the flake rate rises with the number of running executors, the controller lowers concurrency or runs heavy suites as a serial resource, and files the shared-resource flakes for fixing. Load-aware admission ([part 13](13-operations.md#134-settings-in-four-layers)) holds heavy suites back while the machine is loaded, by `hitld` or anything else, and quiet-machine holds give timing-sensitive tests an idle machine.

### Measures

| Measure | Definition | Goodhart pair |
|---|---|---|
| **Flake rate** | [Part 11](11-metrics-and-control.md#111-measures) | Test count and mutation score: deleting or weakening tests must not lower it |
| **Quarantine size and age** | Entries, and the oldest entry's age | Escaped defects in quarantined areas |
| **Flake cost** | Reruns, suite minutes and merge delay spent on flakes | Burn-in and comparison runs spent |
| **Time to deflake** | From quarantine to the fix merging | Reopened flakes |

### In the contract

The executor contract carries one line, so the agent-specific failure mode is covered where every executor reads it: *"A failing test is yours unless you show it fails on the base commit too, or it is in the quarantine list. Never call a failure flaky without a rerun."*

The defaults above, quarantine on evidence without asking, and the contract line are decided ([Q34 to Q36](22-open-questions.md#q34-what-are-the-flake-defaults-affects-147)).
