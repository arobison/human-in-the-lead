# 14. Integration and CI

[Back to the index](../0001-human-in-the-lead.md)

Many executors finish work in parallel; integration turns their branches into a `main` that is always green. The basic merge queue (14.1–14.4) is in "One signal end to end" ([part 21](21-scope.md)). Agent conflict resolution beyond the simple cases (14.3) and CI integration (14.5) come later.

## 14.1 Keep the integration branch green

`main` is the integration branch. Its invariant: **every commit on `main` passed the full test suite as part of the batch that produced it.** The merge queue enforces it by fast-forwarding `main` only to a commit it has tested. No executor, and no person through the system, commits to `main` directly; the orchestrator's own tracker edits go through the queue as tier-0 branches too.

## 14.2 The queue

For each finished branch, after verification ([part 6](06-verification.md)) has passed:

1. **Order.** Branches merge in **dependency order**: an item whose `needs` include another waiting item goes after it. Among independent branches, priority order ([part 2](02-loops.md#24-prioritization)). Branches whose `touches` overlap go one after the other.
2. **Rebase** onto the current tip of the batch under construction.
3. **Fast checks** on the rebased branch: the commit guard's classification rule on each of its commits (built in, whatever the policy lists; [10.3](10-security.md#103-information-classification)), the tracker check, lint, type check, the item's acceptance checks, the tests nearest its `touches`, and the declared security scans, diff-aware against the baseline (below).
4. **Batch.** After `merge.batch_max` branches, or when no more are waiting, run the **full suite once** on the combined result, then regenerate tracker views ([part 3](03-data-model.md#generated-views)) and commit them on top.
5. **Fast-forward** `main` to the tested commit. Each branch's `state: Done` closes its items.

**Two modes** (`merge.mode`). In `queue` mode the orchestrator runs the queue whenever branches are waiting; the owner opts into it once the record supports it. In `owner` mode, the default for a new project, a finished branch is verified and then **waits for the owner**: `hitld merge` lists what is waiting (branch, item, report status, fast-check result, how long it has waited) and merges nothing, and `hitld merge --only <branch>[,<branch>]` merges exactly those, through the same steps above. A branch that fails a check is sent back and nothing of it merges. The orchestrator tells the owner what is ready and runs `--only` only when the owner's own message in the session says to; the command refuses when run from an executor. The report and digest show the branches waiting and for how long.

The batch size has its own controller: smaller after failures, so bisection is cheaper; larger after a run of clean batches ([part 11](11-metrics-and-control.md#114-feedback-controllers)).

**Security scans** (planned, HITLD-63; the rules are in [10.5](10-security.md#105-security-in-done-when)). Scanners are declared in `policy.json` next to the other fast checks: static analysis (Snyk, CodeQL or Semgrep, for example) and dependency audits, each with its command and output format (SARIF by default). None is built in. The queue runs each one on the rebased branch and compares its findings with the baseline and the recorded verdicts. A finding that is in neither sends the branch back to its executor, with the finding; the executor fixes it with a test, or proposes a verdict in its report. A by-design or false-positive verdict on a sensitive path waits for the security review. An accepted risk waits for the owner. After the batch merges, the queue removes fixed findings from the baseline. A finding with an accepted risk past its expiry becomes a decision for the owner, as an expired quarantine entry does (14.7).

## 14.3 Conflicts

When a rebase conflicts, the queue classifies the conflict:

| Class | Example | Handled by |
|---|---|---|
| **Generated** | Tracker views, lockfiles, generated code | Regenerate from the sources after the rebase; never merge generated files by hand (basic queue) |
| **Trivial** | Both branches added entries to the same list; import order; adjacent but independent hunks | A tier-1 conflict-resolver agent, whose result must pass the same fast checks (later milestone; in the basic queue, these go to the next row) |
| **Semantic** | Both branches changed the same function's behaviour | Back to the later branch's executor as a follow-up, with both diffs and the earlier item's intent (basic queue) |
| **Intent conflict** | Two items' goals contradict each other | A decision for the owner (an area owner once [Q21](22-open-questions.md#q21-how-is-a-deciders-identity-established-blocks-any-second-human-and-any-channel-other-than-the-local-session)'s signed answers exist), under the rights rules ([part 4](04-decision-rights.md)) |

Conflict rate per area is recorded; a rising rate is a congestion signal for the concurrency controller and a hint that two items should have been one.

## 14.4 Bisection and flakes

When a batch fails the full suite:

1. **Rerun the full suite on the same commit.** If it passes, the failure is a **flake candidate** (step 4). If it fails again, run the suite on the batch's base (current `main`): a failure there means `main` was not green, which is an incident ([part 2](02-loops.md#27-shipping)).
2. **Bisect**: split the batch, run the full suite on each half, and recurse until the culprit branch is found.
3. The culprit goes back to its executor as a follow-up; the rest of the batch merges.
4. **Flakes** are not blamed on the branch until the evidence says so. **In the basic queue**, a full-suite failure holds the batch even if the rerun passes: nothing merges and nothing is blamed. The rerun is recorded as a flake candidate in the private store (`merge/flakes.jsonl`), and the owner decides. The base comparison, burn-in and the quarantine file below are not built yet. How a flake is told apart from a new intermittent bug, quarantined, fixed and kept from coming back is in [14.7](#147-flaky-tests).

## 14.5 CI integration (later milestone)

Local verification has limits: one machine's hardware, one operating system, the owner's laptop being awake. CI integration lets the queue's checks run elsewhere.

- **Pushed candidate branches.** The queue pushes the batch under test to a candidate branch (`hitld-queue/<n>`, a prefix distinct from the executors' `hitld/`) and GitHub Actions runs the suite on it; the result is the batch's verdict. Pushing is an outward-facing act, so it needs the owner's standing decision for the repository, and only `public` (or, for a private repository, `internal`) work goes there.
- **Special runners.** Hardware-bound tests (a GPU, a device farm), benchmark baselines and visual regression run on self-hosted or larger runners with the right hardware, as serial resources with their own locks.
- **GitHub's merge queue as a backend.** For a project that merges by pull request, the queue's ordering and batch rules map onto GitHub's merge queue instead of the local one, with the same checks.
- **Evidence.** CI results enter the item's evidence with run links, and the ledger records them like local runs.

## 14.6 Measures

| Measure | Definition |
|---|---|
| **Main-green share** | Share of commits on `main` whose full suite passed (target: all of them) |
| **Queue wait** | Time from a branch passing verification to its merge |
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
| **Is it new?** (for every candidate) | Run the test `flake.compare_runs` times (default 10 per side) on the candidate and on its base, under the same load | Fails only on the candidate: the change introduced an intermittent bug; it goes back to the executor. Fails on both: a pre-existing flake; the branch is not blamed |
| **Burn-in** of new and changed tests | In the fast checks, each test the branch adds or changes runs `flake.burn_in_runs` times (default 5; 20 in the nightly sweep) with shuffled order and varied seeds | A new test that fails once is the branch's problem, before it can gate anyone else |
| **The flaky-test sweep** (scheduler, [part 13](13-operations.md)) | Rerun recent failures on unchanged code; stress-run quarantined tests under load | Confirms candidates, clears fixed tests, catches flakes that only appear under load |
| **History** | Per-test results from every run, through the project's test reporter, kept in the evidence source | A test's failure rate over time, by environment, without extra runs |

The rerun on the same commit is cheap and runs every time. The base-versus-candidate comparison costs more, so it runs only for a candidate, and its run count is a controller setting ([part 11](11-metrics-and-control.md#114-feedback-controllers)) with a ceiling in `policy.json`.

### Quarantine

- **Entry.** The orchestrator may quarantine a test, without asking and reporting it in the digest, when it has a recorded fail and pass on the same commit, and the comparison shows it fails on the base too. It cannot quarantine a test that the branch under test adds or changes; that test goes back with the branch.
- **What it means.** A quarantined test still runs everywhere, and its results are still recorded, but it does not gate. An entry can be scoped to an environment (an operating system, a database version, a browser) when it fails only there.
- **Where.** `.human-in-the-lead/quarantine.json` in the repository, so every worktree, machine and CI run sees the same list. The file is public in a public repository, so it holds only the test ID, the environment scope, the expiry and the fix item. The evidence (run IDs, logs) stays in the private store, keyed by the test ID.
- **Expiry.** Each entry lasts `flake.quarantine_days` (default 14). At expiry, a still-flaky test becomes a decision for the owner (an area owner once Q21's signed answers exist): fix it now, rewrite it, or delete it. Deleting a test is never the system's call.
- **Visibility.** Every digest shows the quarantine list, its size, its oldest entry and what quarantined tests would have caught.
- **Guard.** Executors cannot edit the quarantine file: the Bash and write guards deny it, as they deny the policy file.

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
