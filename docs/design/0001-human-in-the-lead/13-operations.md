# 13. Operations: continuity, environment and scheduling

[Back to the index](../0001-human-in-the-lead.md)

Four pieces of machinery keep a long run healthy without the owner's attention: the orchestrator's state lives outside its context (13.1), the environment executors run in is created, shared and cleaned up safely (13.2), recurring work happens without anyone prompting it (13.3), and settings come from the layer that owns them: the person, the machine, the project or the run (13.4). All but the scheduler are in "One signal end to end" ([part 21](21-scope.md)).

<a id="131-orchestrator-continuity"></a>

## 13.1 Orchestrator continuity

The orchestrator is a model session. Its context fills, gets summarized, and eventually must be replaced, and the session can end at any moment (a crash, a closed laptop, a switch to another machine). So **nothing the run needs lives only in the orchestrator's context.**

### The run-state file

Each run has one `run-state.json` in the private store:

| Field | Holds |
|---|---|
| `run` | Run ID, start time, the plugin version and `policy.json` hash it started with |
| `scope` | Which items or milestones the run covers, its token budget, its concurrency cap, its stopping condition |
| `in_flight` | Each executor running: dispatch ID, item, harness and its handle, host, worktree, branch, serial resources held, start time |
| `ledger_position` | The ID of the last ledger event the orchestrator has processed |
| `open_questions` | Decision IDs asked and not answered; questions held for the next digest |
| `decisions_this_run` | Answers received, precedents applied, logged calls made |
| `controllers` | Each controller's current setting and its last step ([part 11](11-metrics-and-control.md#114-feedback-controllers)) |
| `quotas` | The last usage snapshot and forecast ([part 12](12-reporting-and-limits.md)) |
| `merge_queue` | Branches waiting, the batch under test |
| `lease` | Which orchestrator session holds the run: host, session ID, renewed-at |
| `checkpoint` | Checkpoint number and the hash of the previous checkpoint |

The file is **derived, never authoritative**. The ledger, the tracker, git branches and the decision items are the record; the run-state file is the orchestrator's working memory of them, written so that resuming needs one small read instead of a history replay. If it is lost or corrupt, `hitld run rebuild` reconstructs it from the ledger, claim branches and the tracker.

### Checkpoints at clean points

The orchestrator writes a checkpoint at each clean point: after a dispatch is recorded, after a completion is processed, after a merge batch, after an answer is applied, and before it ends a turn. Each write:

1. appends the triggering event to the ledger first (the ledger is the truth);
2. writes the new run state to a temporary file and renames it over the old one (atomic on the same file system on POSIX; other platforms need their own replace call);
3. keeps the last `run.checkpoints_kept` checkpoints, so a bad one can be rolled back.

Because the ledger is written first, a crash between the two steps leaves a ledger event the run state has not absorbed; resuming replays ledger events after `ledger_position`, so nothing is lost or applied twice. Each ledger event has a unique ID, and applying one is idempotent.

### One orchestrator at a time

The `lease` stops two orchestrators from driving one run. A session renews the lease at every checkpoint. On the same machine, a new session takes over automatically once the lease is older than `run.lease_expiry`. Across machines it needs the owner's OK, because clock skew between machines could otherwise let two sessions drive one run. Taking over is a ledger event.

### Resuming, on any machine

A fresh orchestrator session runs `hitld run resume`, which:

1. takes the lease;
2. reads the run-state file (small by design) and the ledger events after its position;
3. reconciles `in_flight` with reality: claim branches that exist, completions that arrived while no orchestrator was running, executors that died. A dispatch with neither a live executor nor a report is marked abandoned and its item released, unless its worktree has commits, in which case it is offered to a new executor as a follow-up;
4. prints a short hand-over summary (generated from the run state, not from anyone's memory) and continues.

**On another machine**, the private store's text history arrives through `hitld store sync`, an encrypted bundle exchanged the same way as the code ([part 3](03-data-model.md#private-store), planned). The run state is rebuilt from it, and the ledger index is rebuilt locally. Executors still running on the first machine cannot be adopted remotely: they stay `in_flight` with their host named, and their reports arrive with the next bundle. If the first machine is gone, the owner decides whether to abandon them.

**Context hygiene.** The orchestrator keeps its own context small on purpose: it reads the run-state summary, reports in their fixed shape, and script output, never diffs or logs. When its context passes `orchestrator.context_handoff`, it checkpoints and hands over to a fresh session (with the owner's standing permission, Q10).

**Eval.** The eval suite includes a kill-and-resume scenario: an orchestrator is killed at random points in a fixture run (including between a ledger append and the run-state write), a fresh session resumes, and the scenario checks that no dispatch was lost or duplicated and that the final repository, tracker and ledger match an uninterrupted run ([part 17](17-evals.md#171-what-it-evaluates)).

<a id="132-the-environment-resource-manager-v0"></a>

## 13.2 The environment resource manager

`hitld env` manages what executors share on a machine: worktrees, ports, serial resources and secrets. Every allocation is a lease with a holder (a dispatch ID), recorded in a registry, and released when the holder ends. Worktree records live in the project's private store; ports, resource holders and live executors live in the machine-wide registry, because every project on the machine shares them (13.4).

### Worktrees

- **Creation.** A worktree per executor, cut from the tip of `main`, on a branch named `<branch_prefix>/<ID>-<slug>`. Where the harness creates its own worktree (Claude Code's `isolation: worktree`), `hitld env` adopts it through a hook instead of creating one.
- **Setup.** A fresh worktree lacks everything git does not track: installed dependencies, generated files, local configuration copied from templates, build caches. The project declares its setup in `policy.json` (`env.worktree_setup`: an ordered list of commands, such as installing from the lockfile, copying `.env.example` files, generating code, linking a shared cache). `hitld env setup` runs it in the new worktree, sandboxed with the role's network allowlist (a package registry mirror at most), and records the result. A setup failure is reported before the executor starts, not discovered by it.
- **Cleanup.** After a merge or an abandonment, the worktree is removed and its merged branch deleted. Worktrees of failed dispatches are kept for inspection, up to `env.failed_worktrees_kept`. A worktree with uncommitted changes is never deleted without the change being saved to a branch first.
- **Links in cleanup** (planned). Setup often links things in (a shared cache, a dependency directory from another checkout), so removal must never reach through a link:
  - Cleanup never follows a link.
  - Before deleting any path, it checks that the path's real location is inside the worktree being removed.
  - A link that points outside the worktree is unlinked, never descended into.
  - Windows junctions count as links.
  - `hitld env setup` flags setup commands that create links out of the worktree, such as linking a dependency directory from another checkout, so the owner sees what cleanup will meet.

### Dev-server ports

- Ports are allocated from the machine's range, which a project may narrow (`env.port_range`, 13.4). Before allocating, the manager checks both its registry and the operating system (a test bind), so it never hands out a port someone else is using, including the owner's own servers.
- **It never stops a process it did not start.** The registry records each server's process ID, start time and working directory; on release it stops only a process matching all three. A registry entry whose process is gone is reaped; one whose process is alive but unknown is left alone and its port skipped.

### Locks on serial resources

- Serial resources (a hardware device such as a GPU or an attached phone, benchmark runs, a shared test database, the merge queue) are locks with a holder, a queue in arrival order, and an expiry renewed while the holder is alive. Locks are machine-wide, except the merge queue's, which is per repository. Capacities and quiet-machine holds generalize them (13.4).
- The dispatch planner consults the locks, so an item needing a device is not started while another holds it.
- Time spent waiting for a lock is recorded per resource; it is the sensor for serial-resource contention ([part 11](11-metrics-and-control.md#114-feedback-controllers)).

### Secrets

- **The default is no secrets.** `env.secret_tasks` is empty until the owner declares a task, and executors get no secret any other way.
- **Agents never see secret values, and never choose what runs with one.** A secret is usable only through a named task that the owner declared in `policy.json` (`env.secret_tasks`): an exact command (an absolute program path and its arguments, or a fixed script inside the primary checkout), the roles that may run it, and the secrets it receives. A script that needs a secret runs as `hitld env exec <task>`: the manager reads the values from the operating system's keychain or a secret manager and injects them into that child process's environment only, in an environment it builds itself (a fixed `PATH`, no `NODE_OPTIONS`, `LD_PRELOAD` or similar). `env exec` takes a task name and nothing else; a name that is not declared is refused. **The owner reviews every `secret_tasks` entry like code**: it is a command that runs with secrets, so a task that takes the agent's input (a shell, an interpreter, a script that runs files from the worktree) hands the secret to the agent. `env exec` reads `policy.json` only from the primary checkout, and finds that checkout from a record, not from git: when the orchestrator starts a run (`hitld run start`) it writes the primary checkout's canonical path to `primary-checkout.json` in the project's private store, where executors cannot write (the first record wins, so a later run from another path is refused). Moving the checkout therefore needs a reset: `hitld env primary --reset`, for the owner only and refused for executors (planned, not built). The orchestrator gives the executor `HITLD_PROJECT` and `HITLD_DISPATCH`; `env exec` refuses unless the record exists, the policy it loads from that path is for the same project, the dispatch's recorded worktree is a linked worktree of that checkout (judged from the checkout's own metadata, so a rewritten `.git` file in the worktree gains nothing), and the caller is inside it. There is no fallback to the working directory.
- **Scoped by role, from the dispatch record.** The caller's role is not asserted by the caller. The orchestrator passes the executor's environment `HITLD_DISPATCH`, the dispatch ID; the manager looks it up in the run state the run module wrote and takes the role from there. A request is refused, and logged, when the task is not declared, the dispatch is missing, is not live (claimed and not yet reported), or its role has no grant for the task. **Known gap:** this does not stop an agent that can read another live dispatch's ID from borrowing it, and so borrowing that role's tasks; closing that is the harness sandbox's job (a later milestone). It also relies on the ledger refusing raw appends of dispatch records from anyone but the run module.
- **Never printed.** Output from a process given a secret is filtered for the secret's value before it reaches any agent, log or report.
- **Never committed.** Secret files never live in a worktree; the commit guard scans every commit ([part 10](10-security.md#102-least-privilege-per-role)).

### Per-harness differences

| Harness | Worktrees | Setup | Secrets |
|---|---|---|---|
| Claude Code | Subagents with `isolation: worktree` get a temporary worktree from the default branch; headless tier-3 runs get one from `hitld env` | A hook runs `hitld env setup` when the worktree is created | Injected by `hitld env exec`; guard hook blocks reads of secret paths |
| Copilot in VS Code | Worktree isolation (not treated as a security boundary) | `hitld env setup` from the agent's first step | As Claude Code |
| Copilot cloud agent | A fresh runner or sandbox per task | `.github/workflows/copilot-setup-steps.yml`, generated from `env.worktree_setup` by `hitld install` | Repository secrets; MCP secrets named `COPILOT_MCP_*` |
| Codex cloud | A workspace per task | The environment's setup script, generated likewise | The environment's secrets |

## 13.3 The scheduler (later milestone)

Some work recurs and nobody prompts it. The scheduler runs it.

| Job | Typical cadence | Runs |
|---|---|---|
| Intake pull and triage | Several times a day | `hitld intake pull`, then a triage dispatch if anything arrived |
| Digest | At the owner's set times | `hitld report digest` through the notification channel ([part 12](12-reporting-and-limits.md)) |
| Nightly baselines | Nightly | Benchmark runs on `main` through the evidence source, holding the benchmark resource's lock |
| Stale-item sweep | Daily | Orphaned claims, `Proposed` items older than `sweep.proposed_max_age`, blocked items whose blockers resolved |
| Stale-knowledge sweep | After merge batches, or daily | `hitld kb stale`, then gardening dispatches |
| Flaky-test sweep | Daily | Rerun recent failures on unchanged code; quarantine and file items for confirmed flakes |
| Quota check | Hourly while a run is active | Usage snapshot and forecast ([part 12](12-reporting-and-limits.md#125-quotas-and-budgets)) |
| Maintenance scan | Daily | Dependency updates and security advisories ([part 2](02-loops.md#29-maintenance)) |
| Eval runs | Nightly (offline), per release (live) | `hitld eval` |

**Rules for every job:** it is declared in `policy.json` (`schedule`, with cron expressions); it is idempotent, so a missed or doubled run is harmless; it has a token budget and respects the quota reserve and quiet hours; it writes to the ledger; its results reach the owner only through digests unless a threshold is crossed.

**Deterministic jobs need no agent.** Intake pulls, sweeps, quota checks and offline evals are `hitld` commands; only the follow-up (triage, gardening, a fix) dispatches an agent. So most jobs cost no model tokens.

**Where it runs, per harness:**

- **Locally:** the operating system's scheduler (launchd on macOS, cron or systemd timers on Linux) running `hitld` commands, which start agents through the harness adapter when a job needs one. This works with any harness and keeps everything on the owner's machine.
- **Claude Code:** desktop scheduled tasks (local, while the app is open) and cloud scheduled tasks (a fresh cloud clone), both with a minimum interval the product sets, where they fit; in-session `/loop` tasks only for checks during a run, since they end with the session.
- **GitHub:** Actions `schedule` triggers for jobs that run in CI (nightly offline evals, baselines on a runner with the right hardware), and Copilot cloud agent automations for agent work on a schedule, which GitHub documents as limited to some repository types (check before relying on it).

Hosted schedulers carry only work at or below their classification limit; jobs touching `confidential` material run locally.

**Sources** (opened 2026-11-14): Claude Code scheduled tasks <https://code.claude.com/docs/en/scheduled-tasks>, cloud scheduled tasks (routines) <https://code.claude.com/docs/en/routines> and desktop scheduled tasks <https://code.claude.com/docs/en/desktop-scheduled-tasks>; the GitHub Actions `schedule` trigger <https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule>; Copilot cloud agent automations <https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-automations>.

## 13.4 Settings in four layers

A setting lives with whoever owns the fact it describes. A person's plans and limits are theirs. A machine's cores belong to the machine. What the work needs belongs to the project. One run's budget belongs to the run. So settings come in four layers, and nothing personal is committed to a repository.

| Layer | Where | Set by | Holds |
|---|---|---|---|
| **Person** | Outside any repository: `~/.config/human-in-the-lead/person.json` (under `$XDG_CONFIG_HOME` where set) | The person | Accounts, plans and their limits; the reserve, economize and critical thresholds ([part 12](12-reporting-and-limits.md#125-quotas-and-budgets)); the person's total appetite for parallel agents across all their projects; shares between projects; quiet hours, attention budget and question style, including whether non-urgent questions may go at once while they are answering quickly, and how much the status line shows ([part 12](12-reporting-and-limits.md#1211-the-status-line-planned), [part 23](23-people-in-the-lead.md#235-the-interface-as-a-design-surface)) |
| **Machine** | Per machine, beside the machine-wide registry: `~/.local/share/human-in-the-lead/_machine/machine.json` | The person, from a detected proposal | Its role (below); what the machine has (cores, memory, GPUs, browsers) and how much of it `hitld` may use; capacity per resource; the most executors on this machine; load thresholds; port range; worktree root; secret provider |
| **Project** | `.human-in-the-lead/policy.json`, committed | The project's maintainers | What the work needs, named abstractly (`gpu`, `browser`, `quiet`); which commands are heavy; decision rights; merge mode and checks; the project's own cap; run budgets |
| **Run** | The run's `scope` in `run-state.json` (13.1) | The orchestrator, from the person | This run's cap and budget |

### Precedence

- **For caps and limits, the strictest layer wins.** The effective executor cap is the smallest of: the person's appetite less what their other projects are running, the machine's maximum less what is running on it, the project's cap, and the run's cap. Budgets take the smallest; reserves and thresholds take the most cautious; a port range is the overlap.
- **A project may be stricter than the person and the machine, never looser.** A looser project value is not an error; it has no effect, and `hitld config explain` says so.
- **Every other key has one home layer.** Merge mode is the project's; quiet hours are the person's. A key in the wrong layer is refused with its home named.
- **Nothing personal is committed.** Plans, limits, account names, hardware and local paths live only in the person and machine files. `policy.json` refuses those keys.
- **`hitld config explain`** prints each effective value, the layer it came from, and any value it overrode. With `--json`, skills read the same thing. It is the first command to run when the system does something surprising.

### Using the machine, not only knowing it

The machine profile says how much of the machine `hitld` may use, not just what it has:

| Setting | Example | Meaning |
|---|---|---|
| `cores` | 2 of 4 | The most cores heavy work started by `hitld` may keep busy |
| `memory_ceiling` | 8 GB | Heavy work is not admitted when its expected use would pass this |
| `executors_max` | 3 | The most executors on this machine, from every project |
| `capacity` | `gpu`: 4 | How many weight units each resource takes (see below) |
| `load` | `max_per_core`: 0.7 | Above this, heavy work waits |

**Machine roles.** The machine profile has a role, and the role sets the defaults (decided, [Q26](22-open-questions.md#q26-what-share-of-a-machine-may-hitld-use-by-default-affects-the-machine-profile-hitld-machine-detect-proposes)):

| Role | Default share | Behaviour |
|---|---|---|
| **Dedicated** | Everything except one core and about 10% of memory | Load checks only for quiet holds |
| **Workstation** | Half the cores and half the memory | Load-aware: yields to the person and their programs |
| **Cloud VM** | Its whole allocation | Cost-aware: shuts down when idle, and keeps to a budget per machine-hour |
| **CI or ephemeral** | What the job grants | No setup questions |

**Load-aware admission.** Before starting heavy work (a test suite, a build, a benchmark), the environment manager reads current load: the load average or CPU use, memory pressure, and GPU use where the operating system exposes it. Above the machine's threshold, the work is deferred and admitted when load falls. Load counts everything on the machine, including the person's own interactive work and other programs, not only `hitld`. So an autonomous run gives way when the person starts a heavy build of their own.

The project marks which of its commands are heavy; the merge queue's full suite is heavy by default. Time deferred is recorded per resource as **admission wait**, a sensor for the concurrency controller beside lock waits ([part 11](11-metrics-and-control.md#114-feedback-controllers)). Flakes rise with load ([part 14](14-integration.md#load-and-concurrency)), so admission also keeps timing flakes down. Admission wait and flake rate together tell the controller whether to lower the cap.

### Capacities and quiet holds

**A resource has a capacity, not just a lock.** Each holder takes a weight. A GPU with capacity 4 may take one heavy holder (weight 4) or several light ones (weight 1 each). A plain serial resource has capacity 1. Holders queue in arrival order, and a heavy holder at the head of the queue is not overtaken by light ones that arrive after it.

**A quiet machine is its own kind of hold**, for timing-sensitive work such as benchmarks:

1. It is exclusive: one quiet holder on the machine at a time, from any project.
2. While it waits and while it holds, no new heavy work is admitted. Running heavy work from `hitld` pauses where it can and otherwise finishes first.
3. It starts only after load stays below `quiet.load_max` for `quiet.settle` seconds. Load from the person's own work delays it, and the hold reports what it is waiting for.
4. The load during the hold is recorded with the result, so a measurement taken on a busy machine shows as one.

### Detection

`hitld machine detect` probes the cores, memory, GPUs and their memory, installed browsers and the operating system, and proposes a profile with conservative shares. It proposes a role from local hints: a desktop session, container or virtual machine markers, CI variables. It makes no network calls. It never assumes silently: the person confirms or edits the role and each value, and the file records what was detected and when. If a later probe finds less than the profile says (fewer cores, no GPU), it warns and uses the smaller value.

Projects name what work needs. An item, or its area, lists the resources it needs. An item that needs a resource this machine lacks does not dispatch here: it waits, and the orchestrator says why, for example "waits: needs gpu; this machine has none". Another machine that has the resource can take it through the bundle exchange ([part 5](05-execution.md#53-the-merge-queue)).

A cloud, CI or ephemeral session is a machine with its own profile, detected when the session starts and gone when it ends. Nobody is there to confirm it, so it takes conservative detected values, records them, and asks nothing.

### Across projects

Machine-wide state lives in the machine registry, `_machine/` beside the project stores, not in any project's store. The registry is a SQLite file (Node's built-in module): transactional, local to the machine, and never synced or exported ([part 3](03-data-model.md#private-store)). It holds:

| State | Why it is machine-wide |
|---|---|
| Live executors from every project, with project, dispatch and resources held | The person's cap and the machine's cap hold across repositories |
| Resource holders and queues, including quiet holds | Two repositories share one GPU |
| Usage snapshots, per account | Every project on the machine sees the same account use, and no project counts another's autonomous run as the person's interactive use |
| Admission waits | Load is a property of the machine |

Each project keeps its own ledger, run state and worktree records in its private store.

**Shares near the reserve.** When several projects compete for headroom near the reserve, the shares the person sets decide who gets it (`projects.<id>.share` in the person file, equal by default). Inside its share, each project applies its own ladder ([part 12](12-reporting-and-limits.md#control)), so one project's routine work cannot starve another's critical path.

**Some locks are per repository by nature.** The merge queue lock is scoped to the repository, so two repositories never serialize each other's merges. Port leases stay machine-wide.

**Across machines**, nothing is shared directly. The account-wide reading (status-line percentages, vendor usage APIs) already includes every machine's use, and the quota gate acts on it, so the person stays inside their plan. Between readings each machine estimates only its own burn, and the next reading corrects it.

### First run

When the person or machine file is missing, the orchestrator skill walks the person through setting it up, in the main session:

1. It runs `hitld machine detect` and reads any settings that already exist.
2. It asks a few questions, each with the detected value or a sensible default as its recommendation: which accounts and plans, the reserve, how many agents at once across all projects, the machine's role and how much of it to use, quiet hours.
3. It offers the status-line usage capture, which is opt-in: it says what it changes in the person's own harness settings, and installs it only on a yes ([part 12](12-reporting-and-limits.md#125-quotas-and-budgets)). Without it, limits are declared and estimated.
4. It writes the files through `hitld config write`, which validates them, and shows `hitld config explain`.

Until then, conservative defaults apply (one executor, the default reserve, no heavy work above the default load threshold) and autonomous dispatch waits for the setup. Work the person starts by hand still runs. **Executors never run the setup**: `config write` refuses when `HITLD_ROLE=executor` or `HITLD_DISPATCH` is set, as answers do ([Q21](22-open-questions.md)).

### Security

- **Data only.** Each file has a `schema_version` and a schema. Unknown keys and code-running keys are refused, so commands (`env.worktree_setup`, `env.secret_tasks`) stay in `policy.json`, where maintainers review them like code.
- **Trusted loading.** They are read with the same trusted loading as `policy.json`: a regular file owned by the current user, not group- or world-writable, in a directory under the same rule. A symlink is allowed when its target passes the same checks, so dotfiles setups (a dotfiles repository, links made by a tool such as GNU Stow) work.
- **Never in a managed project.** A settings path inside the working tree of a project HITLd manages is refused, and the commit guard refuses files with these names. Other git repositories, such as a dotfiles repository, are allowed.
- **Not synced.** The person keeps the person file with their dotfiles; HITLd does not sync it (decided, [Q28](22-open-questions.md#q28-does-the-person-file-sync-across-machines-affects-first-run-setup-on-a-second-machine)).

### Moving from today's `policy.json`

| Key today | Moves to | A project may still |
|---|---|---|
| `quota.limits` | Person | Set run budgets (`window: run`) |
| `quota.owner_reserve`, `economize_at`, `critical_at`, `notify_at`, `forecast_hours` | Person | Set a larger reserve or earlier thresholds |
| `env.port_range` | Machine | Narrow it to a sub-range |
| `env.worktree_root` | Machine | Name a subdirectory under it |
| `env.secret_provider` | Machine | Narrow it (`auto` to `keychain`), never widen it |
| `env.serial_resources` | Stays, as the names of what work needs | Capacities and holders are machine settings |
| `execution.concurrency` | Stays, as the project's own cap | The person's and machine's caps apply on top |
| Per-person interface settings ([part 23](23-people-in-the-lead.md#235-the-interface-as-a-design-surface)) | Person | Keep each person's decision rights and decision budget ceiling |
| `judgement.weights` (starting weights per person, [part 23](23-people-in-the-lead.md#233-calibration-as-a-prior)) | Person | Nothing: weights are personal |

For one minor version, a moved key in `policy.json` still loads, with a warning naming its new home. `hitld config migrate` (the settings migration) proposes the person and machine files from those keys, writes them once the person confirms, and removes the keys from `policy.json` in a commit the maintainers review.
