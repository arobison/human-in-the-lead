# 16. Packaging and distribution

[Back to the index](../0001-human-in-the-lead.md)

Layer 4 of the architecture ([part 15](15-architecture.md)) is thin: each harness gets the core, the portable instructions and its adapter in the form it installs. The plugin holds only generic machinery. A consuming project holds its own data and settings (16.6).

## 16.1 This repository's layout

```
human-in-the-lead/
  .claude-plugin/
    marketplace.json              # this repository is its own marketplace (16.3)
  .github/                        # CI (npm run check and the offline evals), release and issue forms
  plugins/
    human-in-the-lead/            # the Claude Code plugin: build output, never edited by hand
      .claude-plugin/plugin.json  # name, version (equal to the release tag), description
      skills/ agents/ hooks/      # copied by the build step, with Claude Code front matter added
      core/ schemas/ templates/   # copies of the core, the schemas and the templates
      evals/ bin/
  core/                           # layer 1: the Node library and the hitld command line
    bin/hitld.mjs
    lib/                          # model, schemas, tracker adapters, rights, precedent,
                                  # dispatch planning, merge-queue checks, ledger, quotas, evals
    harness/                      # layer 3: claude-code/ (built); copilot and others planned
  schemas/                        # versioned JSON Schemas
  skills/                         # layer 2: SKILL.md sources with portable front matter only
    adopt/ chief-of-staff/        # built; the rest of the design's skills are planned
    orchestrate/
    execute/ curate/
  agents/                         # agent definitions beyond the executors (the generalizer),
                                  # portable front matter only; the build adds the harness's
  templates/                      # AGENTS.contract.md, policy.json and the item, decision and
                                  # report templates
  evals/                          # the eval suite (part 17): scenarios, graders, runner
  work/                           # this repository's own tracker (the files backend)
  signals/                        # this repository's own signals
  packaging/                      # per-harness packaging
  docs/design/
```


**The plugin sits in a subdirectory**, `plugins/human-in-the-lead/`, rather than at the repository root. A marketplace entry pointing at a subdirectory is documented; whether one `.claude-plugin/` directory may hold both `marketplace.json` and the plugin's `plugin.json` is not, so the layout avoids the question.

**No third-party runtime dependencies.** This is settled. The core uses only Node built-ins. Reasons: Claude Code plugins commonly ship Node scripts; a consuming project's tooling is commonly Node; and zero dependencies means installing the plugin adds nothing to a consuming project's supply chain. Development dependencies (a test runner) are allowed, since they never ship.

## 16.2 The `hitld` command line

One entry point for skills, hooks, adapters and people. Every subcommand reads and writes JSON.

| Command | Does |
|---|---|
| `hitld work new / show / query / claim / unclaim / close / claims` | Tracker operations through the configured backend; `claims` lists claimed items from branches; `show` and `query` take `--json` for the versioned read API |
| `hitld work migrate [--dry-run]` | Apply the tracker format migrations to every file; idempotent; the dry run prints the diff. Registered: `milestone-entities`, `retire-priority` |
| `hitld work check` | Schema, references, cycles, classification, orphaned claims; view freshness on `main` |
| `hitld work sweep` | The stale-item sweep: orphaned claims, old `proposed` items, blocked items whose blockers are resolved, items merged but still open, release items whose needs overlap, items that changed public surface without a `release_note`; reads only ([13.3](13-operations.md#the-stale-item-sweep-and-the-curators-pass)) |
| `hitld work views` | Regenerate views (ready, blocked, claims, decisions, projects, critical path, milestones, unreleased, lists, dependency diagrams) |
| `hitld ready` | The ready queue in priority order, with tiers (execution profiles once HITLD-561 lands) and estimates |
| `hitld dispatch plan / start` | Choose items for free slots and serial resources; start them through the harness adapter |
| `hitld merge` | Run the merge queue: rebase, fast checks, batch suite, bisection; with `merge.via: pull-request`, one pass over GitHub pull requests instead: open or update, wait for the named checks, bring up to date by merging `main`, squash-merge through `gh api` ([14.2](14-integration.md#142-the-queue)). Its tests run against a fake GitHub API |
| `hitld run status / retire` and `hitld handover` | Read who holds the run lease and where wakes go; release the lease of a session that ended; write the hand-over and give up the lease ([part 13](13-operations.md#the-chief-of-staff-and-disposable-orchestrators)). Decided to go with the run object (HITLD-484); HITLD-492 replaces the run commands with one command that rebuilds an orchestrator's view from the ledger and the tracker |
| `hitld ledger append / tail / in-flight / summary` | Ledger operations; `in-flight` for restart; `summary` for the run report |
| `hitld rights who --file <question.json>` | Which decider, by which rule |
| `hitld precedent match <question.json>` | Candidate precedents |
| `hitld intake pull <source>` and `hitld note <text>` | Pull raw signals into quarantine; record an owner's note |
| `hitld kb search / index / stale / orphans / links / check` | The knowledge base tool ([part 8](08-knowledge-base.md#85-the-kb-tool)) |
| `hitld metrics`, `hitld control evaluate` | Measures; controllers inside bounds |
| `hitld eval [--offline | --live] [--harness h] [--sealed]` | The eval suite ([part 17](17-evals.md)); built: `--offline`, `eval report`, `eval accept --result` |
| `hitld config explain / write` | Each effective setting and the layer it came from; write the person or machine file after validating it ([part 13](13-operations.md#134-settings-in-four-layers)) |
| `hitld machine detect` (planned) | Probe this machine and propose a machine profile for the person to confirm |
| `hitld check contract / policy` | `AGENTS.md` contract present and current, and imported by `CLAUDE.md` if one exists; `policy.json` valid within bounds |
| `hitld check classification [--staged]` | The commit guard: no file above the repository's classification ceiling, and none that holds a term from the private term list, in the next commit or the whole tree ([10.3](10-security.md#103-information-classification)) |
| `hitld check commit-message <file>` | The commit message guard the commit-msg hook runs: no term from the private term list in the message ([10.3, rule 7](10-security.md#private-names)) |
| `hitld private add / list / remove` | Keep the private term list in the private store: names, repositories, devices, hosts, email addresses and URLs that never reach the repository or anything published from it; `list` masks each term unless `--show`; the owner's only ([10.3, rule 7](10-security.md#private-names)) |
| `hitld publish check --file <path> / --text -` | Check a pull request's title and body, an issue comment or release notes against the private term list before posting it; refused naming the kind and line, never the term. Executors may run it ([10.3, rule 7](10-security.md#private-names)) |
| `hitld data migrate` (planned) | Upgrade data files (`policy.json`, settings and private-store files; never the ledger) to the current schema versions |
| `hitld config migrate` | Move settings out of `policy.json` into the person and machine files ([13.4](13-operations.md#moving-from-todays-policyjson)) |
| `hitld store export / import / sync` | Move or sync the private store between machines as an encrypted bundle ([part 3](03-data-model.md#private-store)) |
| `hitld store device init / ask / list / remove` | Enroll, list and remove the devices the private store is encrypted to: the key pair, the private key in the OS keychain or a cloud environment variable, the device's request on the store repository, and the device decisions only the owner's answer settles ([0003 section 6](../0003-private-store-remote.md#6-enrolling-and-removing-a-device)) |
| `hitld store remote set / clear / show`, `store push / pull / status` | Move the private store through its remote, encrypted to the devices the owner approved; the address is `HITLD_STORE_REMOTE`, else the person file, else this machine's override, never `policy.json`; `remote set` puts the address and the repository's names on the private term list ([design 0003](../0003-private-store-remote.md#8-when-sync-runs)) |
| `hitld release propose [--pre rc] [--item <id>]` | The interface delta since the last full release, the bump it proposes and its reason, draft notes, items that changed public surface without a `release_note` line, and the gates of the release item for the proposed version (the work item whose `release` is that version, or `--item`): each item or milestone it needs that is not done or dropped ([3.2](03-data-model.md#release)) |
| `hitld release make [--version v] [--pre rc] [--decision <id>] [--item <id>]` | Write the release record and an annotated tag on `main`, refused while a gate of the release item for that version is open; the owner's, from the main session; never pushes. Publishing after the eval gate is planned |
| `hitld feedback`, with `list`, `drop` and `render` | Capture feedback about the plugin, locally ([part 18](18-self-improvement.md#184-giving-feedback)) |
| `hitld friction scan`, `friction messages` | Record the friction in a session record as `friction` events in the ledger, and give the independent reader the messages it classifies ([18.4, implicit friction signals](18-self-improvement.md#implicit-friction-signals)) |
| `hitld mcp` (planned) | Serve the same operations over MCP (tools only) |
| `hitld install` | Set up a consuming project: policy, contract block, `.claude/settings.json` pin (the plugin it enables carries the store-sync hooks: SessionStart pulls the private store, SessionEnd pushes it), the commit guard's pre-commit and commit-msg hooks, and the opt-in status-line capture (`--statusline`) |
| `hitld upgrade plan [--to v] [--from v] [--records dir]` | What upgrading to the pinned release takes: the notes and interface delta of the releases on the way, the migrations, the restart, and what each role does, in order; reads only ([16.5, Upgrades](#upgrades)) |
| `hitld install --harness <h>` (planned) | Place skills, agents, hooks and instructions where a harness reads them, for harnesses without a plugin path |

Built as well: `run`, `env`, `rights ask / answer`, `quota`, `dashboard`, `eval accept`, and for owner merge mode `merge --all`, `merge --only` and `merge approve`. `hitld --help` lists every built command; this table is the design, not the list.

### Failed commands and their error codes

A command that fails prints one JSON object: `ok` is false, `error` is a code, `message` says what happened for a person, and some codes add fields. Exit codes: 0 ok, 1 the command ran and found a problem or failed, 2 usage error, 3 not yet built. Scripts and agents match on `error`; the `message` may change in any release. `hitld mcp` (planned) serves the same results, so it returns the same codes.

A code is lowercase kebab-case and means one thing. Two commands that refuse the same thing return the same code: a caller whose role may not run a command always gets `not-permitted`, whichever command it was. A code that means something different gets a name that says so (`no-run` is no orchestrator run, `no-eval-run` is no stored eval run). The list below is `core/lib/cli/errors.mjs`. A test fails on a code in the library that is not on the list or not kebab-case, and on a code on the list that the library never writes.

**The command line itself**

- `usage`: The input is wrong: an unknown command, a missing or malformed argument, or a value out of range.
- `failed`: The command stopped on an error it did not expect; the message says what.
- `not-built`: The command is in the table but is not built yet.

**Who may run it**

- `not-permitted`: The caller may not run this command: an owner-only or orchestrator-only command run by an executor, or run outside the main session in the primary checkout.
- `not-an-approver`: The named person is not among policy feedback.approvers.
- `not-a-decider`: The named person is not among the deciders of that decision.
- `not-owner-mode`: The command is for merge.mode owner, and the project is not in it.
- `not-a-dispatch`: The caller is not a live dispatched executor (HITLD_DISPATCH is unset, malformed or not live), so it may not use a secret task.
- `task-not-granted`: The dispatch role has no grant for that secret task.

**The project, its files and the run**

- `policy`: policy.json is missing, invalid or not trusted.
- `settings`: A settings file is invalid.
- `tracker`: tracker.json is invalid.
- `id-counter-unreachable`: A new ID is taken from the counter on the store repository, and it could not be reached or written; no ID was taken.
- `contract`: The contract block in AGENTS.md could not be installed.
- `not-a-repository`: The working directory is not in a git repository.
- `output-path`: The output directory is outside the repository and the private store, or the page would overwrite a file the report did not create.
- `no-run`: No orchestrator run has started; start one with hitld run start.
- `no-eval-run`: No stored eval run has that ID, or none is stored yet.
- `invalid-eval-run`: A stored eval run is not a valid eval result.
- `setup-failed`: The worktree's setup commands failed.
- `version-not-pinned`: This session runs another release of the plugin than the pin in .claude/settings.json names, so no run starts or resumes.

**The run lease and locks**

The run-lease codes, `no-run` and `handover-due` go with the run object when HITLD-492 removes it (HITLD-484). The meaning of `not-planned` below names the tier as built; tiers are being replaced by execution profiles (HITLD-581).

- `lease-held`: Another session holds the run lease.
- `lease-lost`: This session no longer holds the run lease: another session holds it.
- `lease-host-mismatch`: This session holds the run lease, but on another host than the call gives; the lease is not lost.
- `lease-released`: This session released the run lease, so it can no longer record.
- `lock-held`: A named resource lock is held by someone else.
- `lock-timeout`: A named resource lock was not free before the wait ended.

**Quotas**

- `invalid-snapshot`: The usage snapshot does not match its schema.

**Ledger**

- `invalid-event`: The ledger event does not match its schema or lacks a field its kind needs.
- `forbidden-event`: The event kind is written only by the orchestrator, not by this caller.
- `forbidden-field`: The event carries a field this caller may not set.
- `forbidden-correction`: The correction would change an entry this caller may not correct.
- `already-corrected`: The ledger event was already corrected; correct the event that corrected it, which now stands.
- `no-estimate`: The dispatch carries no start estimate of its own (a follow-up): correct the earlier dispatch it reads its estimate from.

**Dispatch, handover and the merge queue**

- `not-planned`: The item is not one the plan starts now (held, tier 0, no free slot, or not ready).
- `disk-floor`: Free disk is below the machine file's disk_floor_mb, so no new work starts until space is freed.
- `not-in-flight`: The dispatch is not in flight.
- `tokens-over-estimate`: The completion's token count is three times the dispatch's estimate or more; nothing was recorded. Give output plus fresh input (never cache reads), or confirm with --tokens-over-estimate.
- `unknown-dispatch`: The dispatch has no recorded harness reference, so it cannot be continued.
- `still-running`: The dispatch is still running; its completion notice comes first.
- `handover-due`: This session's hand-over is due, so nothing new starts.
- `draining`: Executors still report to this session, and no successor would hear of them.
- `cap`: The maximum number of live executors is reached.
- `merge-busy`: The merge queue is held by another process.
- `not-presented`: The branch was not presented to the owner, or nothing has been presented yet.
- `not-waiting`: The branch is not waiting to merge.
- `stale`: A presented branch changed after the owner saw it.
- `ambiguous`: The name matches more than one presented branch, or a branch other than the item was dispatched on.
- `no-github-remote`: merge.via is pull-request, and the git remote merge.pull_request.remote names no GitHub repository.

**Decisions and precedents**

- `invalid-question`: The question does not match its schema or normalize.
- `incomplete-question`: The question does not stand alone; it lacks fields a decider needs.
- `invalid-default`: The default if unanswered is not allowed here: not a two-way door, or not one of the options.
- `invalid-decision`: The decision record or answer is not valid.
- `invalid-trust-event`: The trust event the question would record does not match its schema; nothing was recorded.
- `answer-matches-no-option`: The answer names none of the decision's options, or words that fit more than one; nothing was recorded.
- `answer-question-changed`: The question the answer would apply to is not the one shown: its check code differs from the one given or last shown, the tracker item and the ask record disagree, or the device action it would apply is another; nothing was recorded.
- `not-created`: The tracker refused to create the decision item.
- `not-a-decision`: The ID names an item that is not a decision.
- `not-open`: The decision is not open.
- `no-question-record`: The question text is not recorded, so there is nothing to show.
- `bad-narrowing`: The precedent cannot be narrowed that way.
- `invalid-precedent`: The precedent does not match its schema.
- `not-an-application`: The decision was not resolved by a precedent, so there is nothing to overrule.
- `already-overruled`: The decision was already overruled.
- `no-precedent`: The precedent is not in the store.
- `invalid-exception`: The exception it would add is not valid.
- `sensitive-exception`: The exception is not derived from the reversed case and needs its own conditions.
- `already-reversed`: The call was already reversed.
- `invalid-call`: The logged call is empty or not valid.
- `nothing-to-rate`: No decision has been answered yet.
- `not-found`: The ID is not in the tracker or the store.

**Design walk-throughs**

- `not-a-design`: The design has no questions section with Q<n> questions, or an open question lacks two options or a recommendation, or lists its recommendation after another option.
- `already-decided`: The design question is decided already; nothing was written.
- `decision-not-for-question`: The decision is not the one filed for that design question: its title is not the question's; nothing was written.
- `not-answered`: The decision has no answer from the owner, so the question stays open.
- `options-differ`: The decision offered a different number of options than the design question has, so the option picked cannot be named in the design's words.
- `questions-open`: Questions in the design wait for the owner, so it is not marked decided.

**Publishing tracker changes**

- `main-changed`: The main branch changed a tracker file this session changed too, in a way this session has not seen; nothing was published.
- `push-failed`: The push of the new branch to the remote failed; nothing was published.
- `classification`: A file is above the repository's classification ceiling or holds the private store's address or device list; nothing was published.

**Feedback and the send gate**

- `not-an-approval`: The answer is not approve, edit or by-hand.
- `not-approved`: Only an approved publication from the send gate is sent.
- `by-hand`: The person posts this one themselves; nothing is sent.
- `not-by-hand`: The record was not approved by hand, so it takes no --url.
- `not-an-issue`: The URL is not an issue in the feedback repository.
- `not-drafted`: The record is not drafted, so it cannot be published.
- `no-edits`: The answer edit has no changed text.
- `edits-need-edit`: Changed text goes only with the answer edit.
- `not-public`: The edited draft holds material that is not public.
- `empty`: The publication has no repository, title or body.

**Eval and baselines**

- `no-scenarios`: No scenario matches, or none is found.
- `no-committed-baseline`: The gate has no committed baseline to compare with.
- `not-accepted`: The run does not qualify as a baseline, or writing the baseline failed.
- `no-commit`: The run did not record the commit it ran on.
- `dirty-tree`: The run, or the checkout, has uncommitted changes.
- `not-on-main`: The checkout is not on the main branch, or the run's commit is not on it.

**Releases**

- `release-gates-open`: The release item for this version still needs an item or milestone that is not done or dropped.
- `release-item-mismatch`: The release item named is the release item for another version.

**Security and quarantine**

- `security`: The security command stopped on an error; the message says what.
- `scanner`: A scanner failed.
- `decision`: The decision ID is not an answered owner decision that allows this.
- `quarantine`: The quarantine file is invalid or the entry is refused.
- `fix-item`: The fix item is not an open work item in the tracker.
- `already-quarantined`: The test is already quarantined, and the entry has not expired.
- `no-evidence`: There is no recorded evidence that the test is flaky.
- `fix-not-done`: The fix item is not done and the entry has not expired.

**The private store**

- `no-passphrase`: No passphrase was given, or it is empty.
- `no-identity`: No age private key was given for a file that opens with one.
- `no-recipients`: No age public key was given to encrypt the export to.
- `no-file`: There is no export file at that path.
- `age-header-invalid`: The age header does not parse, or breaks a rule of the format.
- `age-no-match`: The header parses, but no key given opens it.
- `age-mac-mismatch`: A key opens the header, but its MAC is wrong: the header was changed.
- `age-payload-invalid`: The age payload does not decrypt and authenticate to its end.
- `age-bad-recipient`: An age public key does not parse, or cannot be used.
- `age-bad-identity`: An age private key does not parse.
- `age-no-recipients`: There is no age public key to encrypt to.
- `age-no-identities`: There is no age private key to decrypt with.
- `bad-bech32`: A Bech32 string, such as an age key, is malformed.
- `bad-header`: The export file's header is not one this version reads.
- `not-export`: The file is not a hitld store export.
- `unknown-format`: The export format is not one this version reads.
- `cannot-open`: The file does not open: the passphrase is wrong, or the file was changed or damaged.
- `damaged`: The file is damaged.
- `git-failed`: A git command failed inside the store.
- `bad-bundle`: The bundle does not verify or does not match its manifest.
- `bad-path`: The export file is inside the store.
- `another-project`: The file is from another project.
- `newer-schema`: The file was written by a newer release; upgrade hitld first.
- `store-changed`: A file changed in the store during the import; nothing was merged.
- `conflict`: The import stopped on a merge conflict; nothing was merged.

**The store remote**

- `remote-moved`: The remote's head is not the one the push expected.
- `remote-url-invalid`: The remote URL is not one that is accepted.
- `remote-unreachable`: The remote cannot be reached.
- `remote-version-missing`: The remote no longer holds that version.
- `remote-version-invalid`: The version ID is not valid.
- `remote-corrupt`: What the remote holds does not match what was pushed.
- `remote-too-large`: The bytes are larger than the remote accepts.
- `remote-argument-invalid`: An argument to the remote is not valid.
- `remote-dir-invalid`: The local directory for the remote is not usable.
- `remote-git-failed`: A git command against the remote failed.

**Store devices**

- `devices-fetch-failed`: The device requests on the store repository's hitld-devices branch could not be read.
- `device-ask-refused`: A device decision could not be put to the owner: the tracker refused it, or the rules do not route it to the owner alone.
- `device-name-invalid`: A device name is not a short lower-case name.
- `device-name-required`: No device name was given and none could be made from the host name.
- `device-name-taken`: The device name is used by another key, approved or asking.
- `device-unknown`: No device the owner approved has that name.
- `device-no-keychain`: This machine has no OS keychain hitld can store the device key in.
- `device-not-enrolled`: This device has no key, or the owner has not approved its key (or removed it), so it may not push.


**Pushing and pulling the store**

- `no-remote`: No store address is set: set HITLD_STORE_REMOTE in a cloud environment, or run hitld store remote set <url> on a machine.
- `nothing-to-push`: The store holds no text to push yet.
- `remote-not-format-2`: The remote's head is not an age file; nothing writes another format to a remote.
- `remote-config-invalid`: This machine's override of the store's address is damaged.
- `sync-state-invalid`: The file that records what this store last merged from the remote is damaged.
- `store-pull-refused`: hitld run start or run resume stopped: the store remote answered, but its head does not open or merge. An unreachable remote does not stop a run; --no-sync goes on with the local store.

**The private term list**

- `private-term`: The text holds a term from the private term list; the refusal names its kind and line, never the term.
- `private-term-invalid`: A term is not one the private term list takes: too short or long, more than one line, or of an unknown kind.
- `private-term-unknown`: No term on the private term list has that ID or matches that term.
- `private-list-invalid`: A line of the private term list does not read, so nothing is checked or committed until it is fixed.

**Secrets and the environment**

- `secret-missing`: No value is stored for a secret the task needs.
- `spawn-failed`: The task process could not start.
- `task-undeclared`: The task is not declared in policy.json env.secret_tasks.
- `task-invalid`: The declared task cannot run as written.
- `worktree-mismatch`: The caller is not inside the dispatch's own worktree.
- `project-unknown`: HITLD_PROJECT_ID is not set or names no project.
- `primary-unrecorded`: No primary checkout is recorded for the project.
- `primary-mismatch`: The recorded primary checkout is not the one this process is in.

**Names before v0.1.0-rc.1.** Error codes were partly snake_case, and some meanings had more than one code. There is no fallback for the old names ([16.5](#165-releases-and-compatibility)).

| Before | Now | Note |
|---|---|---|
| `not_permitted` | `not-permitted` | One code for "the caller's role may not run this". |
| `not_allowed` | `not-permitted` | `hitld eval accept` run by an executor. |
| `refused` | `not-permitted` | `hitld cadence done`, `hitld config write` and `migrate`, `hitld machine detect --write`, run by an executor. |
| `refused` | `not-accepted` | `hitld eval accept`: the run does not qualify as a baseline, or writing it failed. A different meaning from a role refusal. |
| `no_run` | `no-run` | No orchestrator run has started. |
| `no_run` | `no-eval-run` | `hitld eval report` and `eval accept`: no stored eval run has that ID. A different meaning from `no-run`. |
| `bad_run` | `invalid-eval-run` | A stored eval run is not a valid result. |
| `no_policy` | `policy` | The store commands, now the same code as every other missing or invalid `policy.json`. |
| `dirty` | `dirty-tree` | `hitld security baseline`, now the same code as the eval baseline check. |
| `exists` | `already-quarantined` |  |
| `dispatch_refused` | `not-a-dispatch` |  |
| `lease_held`, `lease_lost`, `lease_released` | `lease-held`, `lease-lost`, `lease-released` |  |

Every other snake_case code is the same word with hyphens: `not_built`, `not_a_repository`, `setup_failed`, `output_path`, `forbidden_event`, `forbidden_field`, `forbidden_correction`, `invalid_event`, `fix_item`, `no_evidence`, `fix_not_done`, `not_found`, `not_on_main`, `lock_timeout`, `lock_held`, `invalid_question`, `invalid_decision`, `invalid_default`, `invalid_precedent`, `invalid_exception`, `invalid_call`, `not_created`, `incomplete_question`, `not_a_decision`, `not_open`, `no_question_record`, `not_a_decider`, `bad_narrowing`, `not_an_application`, `already_overruled`, `no_precedent`, `sensitive_exception`, `already_reversed`, `nothing_to_rate`, `not_an_approver`, `not_an_approval`, `not_approved`, `by_hand`, `not_by_hand`, `not_an_issue`, `not_drafted`, `no_edits`, `not_public`, `edits_need_edit`, `not_presented`, `handover_due`, `not_planned`, `not_in_flight`, `unknown_dispatch`, `still_running`, `not_waiting`, `merge_busy`, `not_owner_mode`, `project_unknown`, `primary_unrecorded`, `primary_mismatch`, `task_undeclared`, `task_not_granted`, `worktree_mismatch`, `task_invalid`, `secret_missing`, `spawn_failed`, `no_passphrase`, `bad_header`, `not_export`, `unknown_format`, `cannot_open`, `git_failed`, `bad_bundle`, `store_changed`, `bad_path`, `another_project`, `newer_schema`, `no_scenarios`, `no_committed_baseline`.

### Pages the commands write

`hitld dashboard` writes `dashboard.html` and `digest.txt` into its output directory (`--out`; the private store's `reports/` by default). The directory keeps a marker, `.hitld-report.json`, naming the files a report made there, and a report overwrites only files the marker lists. A directory written before v0.1.0-rc.1 holds `report.html` (the page's earlier name) and is accepted as it is: the next run removes the `report.html` the marker lists, writes `dashboard.html` and rewrites the marker with the new names. A `report.html` the marker does not list is not touched. `hitld eval report` writes `eval-<run>.html`.

## 16.3 How a consuming project gets the plugin

### This repository is its own marketplace

`.claude-plugin/marketplace.json` at the repository root lists the plugin:

```json
{
  "name": "human-in-the-lead",
  "owner": { "name": "human-in-the-lead maintainers" },
  "plugins": [
    {
      "name": "human-in-the-lead",
      "source": "./plugins/human-in-the-lead",
      "description": "Agents do the work; people set the direction and make the calls."
    }
  ]
}
```

### The consumer declares it in committed project settings

The consumer commits `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "human-in-the-lead": {
      "source": { "source": "github", "repo": "arobison/human-in-the-lead", "ref": "v0.1.0" },
      "autoUpdate": false
    }
  },
  "enabledPlugins": { "human-in-the-lead@human-in-the-lead": true }
}
```

- **What the committed file does.** It declares the marketplace pinned to a release tag (`ref`), with automatic updates off, and turns the plugin on for the project. Every worktree is a checkout of the same repository, so every worktree session sees the same pin.
- **What it does not do** (per the documentation read on 2026-11-14): committed project settings turn the plugin on but **do not download it** to a collaborator's machine, and a marketplace declared in project settings takes effect only after the person trusts the folder. Each machine therefore installs once:

  ```bash
  claude plugin install human-in-the-lead@human-in-the-lead --scope project
  ```

  The adopt skill reports a machine where the pinned version is not installed (it reads `claude plugin list`); `hitld check contract` checks the repository only.
- **First run.** The person's first session runs the orchestrator's setup: `hitld machine detect`, one message with every proposed value for the person to accept or change, then `hitld config write` for the person and machine files ([13.4](13-operations.md#134-settings-in-four-layers)). Until then defaults are conservative and autonomous dispatch waits. The setup also offers the status-line usage capture, which is opt-in: it changes the person's own harness settings, so it is installed only on a yes (`hitld install --statusline`).
- **Before any tag exists**, `hitld install` pins a local checkout path, which puts a machine path in the committed `.claude/settings.json`. It warns; switch to `--ref <tag> --repo <owner/name>` before others clone the project.
- **Pinning.** The marketplace `ref` pins the catalog to a tag; the plugin's `version` in `plugin.json` is set equal to that tag by the release step, so the version a session loads is the version the tag names. A commit SHA can be used as `ref` for an exact pin.

### Releases

- A release is a **tag** (`vMAJOR.MINOR.PATCH`) on `main`, with a changelog generated from this repository's own item files. It is made through a release pull request, and the release workflow tags it ([16.5, Release mechanics](#release-mechanics)).
- A release is **gated by the eval suite**: the visible suite passes on the supported harnesses, the head-to-head against the previous release shows no regression beyond tolerance, and for skill or policy changes the sealed set passes ([part 18](18-self-improvement.md#183-guardrails-against-gaming-its-own-grading)). The changelog cites the eval run IDs.
- **The first release** has no previous release, no live runner and no sealed set yet. It is gated on the offline suite passing against the owner-accepted baseline, which is committed in `evals/baselines/` ([17.5](17-evals.md#175-how-it-runs)); the release workflow fails when no committed baseline matches. The live evals, the comparison with the previous release and the sealed set join the gate once each exists.
- **A consumer upgrades by committing a change to the `ref`**, then running the migrations the release notes name (`hitld data migrate`, `hitld work migrate` or `hitld config migrate`); `hitld upgrade plan` lists them in order. Rolling back is reverting that commit ([16.5, Upgrades](#upgrades)).

### The development loop

To try unreleased changes against a consumer's real work before tagging:

- **`claude --plugin-dir <checkout>/plugins/human-in-the-lead`** loads the plugin from a local directory for one session, in place; `/reload-plugins` picks up edits. It **silently replaces** a same-named installed plugin for that session, which is what a test wants but is easy to forget, so the session-start hook prints the loaded plugin's path and version.
- **A local directory marketplace** (`claude plugin marketplace add <checkout>`) serves the plugin in place to every session on that machine until removed; edits apply at the next session or on `/reload-plugins`.

Known limits, from the documentation read on 2026-11-14: cloud sessions do not load plugins from the local machine; in headless `-p` runs the `/plugin` command is unavailable but installed plugins load. Not documented either way, and not yet checked (an open check, not a result): whether `--plugin-dir` applies in desktop-app sessions, in `--worktree` sessions, and to background subagents. Until checked, the development loop uses the local directory marketplace, which applies to every session on the machine.

**Where the repository lives.** It stays at `arobison/human-in-the-lead` for now. If it grows, it can move to its own organization: GitHub redirects transferred repositories, so existing pins keep working.

## 16.4 Other harnesses

| Harness | Packaging |
|---|---|
| **Any (shell available)** | The npm package: `hitld` command line and MCP server, versioned with the plugin |
| **Copilot in VS Code** | An agent plugin (`plugin.json` bundling skills, agents, hooks, MCP and instructions). VS Code also reads the Claude plugin format, which may make one package serve both; the Copilot adapter milestone tests this |
| **Copilot cloud agent** | No plugin path was found. `hitld install --harness copilot-cloud` writes the repository files it reads (skills, custom agents, hooks, setup steps) and prints the MCP configuration to paste into the repository's Copilot settings |
| **Codex, Cursor** | Their plugin formats, in their adapter milestones |

## 16.5 Releases and compatibility

The plugin's **public interface** is: the executor contract; the report shape; the data schemas (items, decisions, precedents, signals, studies, ledger, `policy.json`, eval scenarios and results); the adapter interfaces; the `hitld` command's and MCP server's JSON; and the commit trailers. Semantic versioning applies to that interface. The adapter interface and capability set are public and labeled experimental until a second adapter proves their shape. The schemas of the person and machine files ([13.4](13-operations.md#134-settings-in-four-layers)) are part of it.

**While the version is 0.y.z** (before 1.0), a minor release may break formats or commands, and ships the migration for whatever it changes: `hitld data migrate` for data files, `hitld work migrate` for the tracker format. Patch releases never break. Minor and major releases are the owner's call; a patch release may follow a precedent the owner confirmed. The first tag is `v0.1.0`. The rules below apply from 1.0.

**What a 0.y.z release still keeps.** Data people keep (tracker files, settings, the ledger, private-store records) follows the rename rule below even before 1.0: an old name is read for one minor release, with a warning, and the release ships its migration. Output (error codes, the `hitld` command's JSON and text, generated pages) may change in any minor release with no fallback; the release notes list each change. The error codes are listed in [16.2](#failed-commands-and-their-error-codes).

Compatibility rules for data:

- **Every data file and ledger line carries `schema_version`.**
- **From 1.0, minor and patch releases** read every older schema version of the same major, and write only formats that the previous minor release can still read. New fields are optional with defaults.
- **Major releases** may change formats. Each ships `hitld data migrate` and `hitld work migrate` where it changes data files or the tracker format; each rewrites its files in one reviewable commit, and `hitld work check` names files that still need it.
- **The ledger is never rewritten.** It is append-only, so readers handle every schema version that appears in it, and every name it ever used (HITLD-82: `claimed`, `question`, `released`, `outcome` and `handle` are read as `started`, `asked`, `unclaimed`, `result` and `harness_ref`).
- **A rename is read under the old name for one minor release, with a warning**, wherever the data lives outside the repository: private-store records (feedback, run state, the environment manager's holders file), eval results and baselines, precedent files, the person and machine files (`hitld config migrate` rewrites those two) and `policy.json`. Tracker files move with `hitld work migrate`; claim branches, file history and release tags from before are read in the new names. `hitld install` rewrites the contract block.
- **No writing ahead.** A release refuses to write a file whose `schema_version` is newer than it knows, so a machine on an older pin cannot corrupt data written by a newer one (relevant when two machines exchange bundles).
- **The person and machine files follow one rule, because every project on the machine reads them, each with the release it is pinned to.** A reader accepts a `schema_version` at or below its own and refuses a newer one, with a message that says to upgrade human-in-the-lead and leaves the file as it is. A writer stamps the lowest version that expresses the file's content, so a file that uses nothing new stays readable by the older release a project may still be pinned to. `hitld config explain` warns when a project pinned on this machine cannot read the file as it is, naming the project, the version it reads and the release that reads more. It finds the pin in the project's `.claude/settings.json` (a tag, or a checkout whose own schemas say what it reads) and, for every other project with a private store, the release its last run started with.
- **`policy.json` migrations** add new settings with their defaults and bounds; they never change a value the owner set.

### Upgrades

A project runs the release its pin names, and only a commit the owner merges moves the pin. A harness that updated the plugin on its own would change the running release under the project without anyone deciding it, so `hitld` checks.

**The drift check.** `hitld` compares three releases: the one this session runs, the one the pin in `.claude/settings.json` names (a tag, or a checkout's own `package.json` version), and the one that last wrote the run's data (the ledger's `run-started` and `lease-taken` events record it). The check is `core/lib/install/drift.mjs`. It runs at session start, in a SessionStart hook that only speaks and comes before the store pull, and at `hitld run start` and `run resume`, before anything is recorded: first, so a refused release pulls nothing, and again after the store pull, which may bring data a newer release wrote. The held-elsewhere check comes after the pull:

- A session on another release than the pin is refused with `version-not-pinned`. When the pin is ahead, this machine has not caught up: `claude plugin marketplace update human-in-the-lead`, `claude plugin update human-in-the-lead@human-in-the-lead --scope project`, then a restart. When the running release is ahead, the plugin moved without the pin: move the pin by a pull request the owner merges, or turn off automatic updates for the marketplace and install the pinned release again.
- Data at a schema version this release does not read is refused with `newer-schema`, the no-writing-ahead rule above.
- A pin ahead of the release that last wrote the data says an upgrade is due (`upgrade.due` in the output), with `hitld upgrade plan` as the next step. It clears once a session on the new release takes the lease.
- A pin to a commit or a branch names no release, so nothing is compared. A branch gets a warning, since it moves; so does `"autoUpdate": true` on the marketplace entry.

**`hitld upgrade plan`** reads the release records from the release that last wrote the data up to the pinned one: the target's `work/releases/<tag>.md` and those before it, from the marketplace's own clone in the plugins directory, or from `--records`. A pre-release is left out when its full release is on the way. From the notes and the interface delta it lists, in order, what to run and who does it:

1. The owner merges the pull request that moves the pin.
2. The chief of staff asks the orchestrator to hand over.
3. The orchestrator drains and hands over. Across minors, it waits until nothing is in flight.
4. Each machine that runs the project's sessions updates the plugin.
5. Each session restarts, the chief of staff's included, so skills, hooks and the `hitld` on the PATH reload.
6. The chief of staff starts the successor.
7. The successor runs the migrations (`hitld work migrate`, `config migrate`, `data migrate`), then `hitld check contract` and `hitld work check`, before it plans.

A migration is listed when a release on the way names it or makes a breaking change (`data migrate` for a breaking schema change). The plan changes nothing.

**The chief of staff upgrades only when an orchestrator is replaced** ([13.1](13-operations.md#the-chief-of-staff-and-disposable-orchestrators)). No orchestrator changes release mid-work: it drains and ends, and its successor starts on the new release. As built, the plan's steps 2 and 3 say "hand over", the drift check reads the release from the ledger's `run-started` and `lease-taken` events, and it runs at `hitld run start` and `run resume`; HITLD-492 changes these with the run object.

**Executors on the old release.** A dispatch records the release it started on. An executor still running when its orchestrator is replaced finishes on that release, and `hitld dispatch complete` accepts its report when the two releases share a minor (`executor_version` in the output). A report from another minor is read with the new release's rules and warned about, so an upgrade across minors waits until `hitld ledger in-flight` lists nothing.

**Rolling back** is reverting the pin commit, then the same update and restart. No migration runs backwards. Data the newer release wrote at a schema version the older one does not read is refused and left as it is; data at versions it reads goes on, with a warning. A test shows an older release refusing newer data (`core/test/upgrade.test.mjs`).

### How Claude Code installs and updates the plugin

HITLd relies on what the Claude Code documentation says, read on 2026-11-15: [Plugin loading reference](https://code.claude.com/docs/en/plugins/loading) (loading), [Install and manage plugins](https://code.claude.com/docs/en/plugins/install) (install), [Host and maintain a marketplace](https://code.claude.com/docs/en/plugins/host-marketplace) (hosting), [Marketplace reference](https://code.claude.com/docs/en/plugins/marketplace-reference) (marketplace), [Plugin commands reference](https://code.claude.com/docs/en/plugins/cli-reference) (commands), [Settings reference, `extraKnownMarketplaces`](https://code.claude.com/docs/en/settings-reference#extraknownmarketplaces) (settings), [Manage plugins for your organization](https://code.claude.com/docs/en/plugins/org) (org) and [Environment variables](https://code.claude.com/docs/en/env-vars) (env).

- **Three stages.** Settings declare the plugin, Claude Code fetches it to disk, and the session loads it when it starts. A change to settings or to disk reaches a running session only through `/reload-plugins` or a new session. (loading)
- **A copy per version.** A plugin from a git marketplace is copied to `cache/<marketplace>/<plugin>/<version>/` under `~/.claude/plugins` (or `$CLAUDE_PLUGIN_CACHE_DIR`), and `${CLAUDE_PLUGIN_ROOT}` points at that directory. The marketplace itself is cloned to `marketplaces/<name>/`. (loading)
- **The version comes from `plugin.json`** first, then the marketplace entry, then the commit. An update replaces the cached copy only when that version changes. HITLd's release step sets it to the tag. (loading, hosting)
- **A `ref` pins the marketplace.** In `extraKnownMarketplaces` it is a branch, a tag, or a commit's full SHA (a SHA needs Claude Code v2.1.324 or later). A refresh moves a branch or tag ref to its latest commit; the release tag ruleset keeps a tag from moving. (marketplace, commands)
- **Automatic updates are off by default for this marketplace.** Only Anthropic's official marketplaces and those added from claude.ai default on. The first of these that is set decides: `autoUpdate` on the `extraKnownMarketplaces` entry in a settings file; then the user's toggle in `/plugin`, Marketplaces, which also writes that settings entry when one exists; then the default. `DISABLE_AUTOUPDATER`, `DISABLE_UPDATES` or `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` turn it off unless `FORCE_AUTOUPDATE_PLUGINS` is set. `hitld install` writes `"autoUpdate": false`, so the committed file decides, and a toggle shows as a change to it. (loading, install, settings, org, env)
- **An automatic update** runs up to ten minutes after the first message of an interactive session. It updates the copies on disk and leaves the running session on what it loaded (`Run /reload-plugins to apply`); the next session loads the new release. (loading, install)
- **A changed source is fetched again.** When the source a settings file declares for a marketplace changes, as a new `ref` does, Claude Code fetches it again in the background after the session starts and says `Plugins changed. Run /reload-plugins to activate.` (loading)
- **Updating by hand.** `claude plugin update <plugin>@<marketplace>` updates to the version the marketplace offers, and it loads in the next session or after `/reload-plugins`. `claude plugin marketplace update` with no name refreshes the listings and leaves installed plugins as they are. (commands, install)
- **`/reload-plugins`** switches hooks and MCP and LSP servers to the new copy; monitors need a restart, and a session without an interactive terminal connects no new MCP server. (loading, commands)
- **One registration per marketplace name**, per user: a marketplace added in one project is known in every project. (loading, marketplace)
- **Project settings do not install**, a marketplace they declare takes effect only after the folder is trusted, and a cloud session never adds it; `--plugin-dir` silently replaces an installed plugin of the same name ([16.3](#163-how-a-consuming-project-gets-the-plugin)). (loading, settings)

Not documented either way, and not yet checked (open checks, not results):

- Whether fetching a marketplace again after its `ref` changed also replaces the installed copy of the plugin, or only the listing. The plan runs `claude plugin update` either way.
- What a session loads when two projects on one machine pin this marketplace to different refs, given one registration per name. The drift check catches the result: a session that loaded the other project's release is refused.
- Whether `claude plugin update` moves a plugin back to an older version after the pin moved back. For a plugin ahead of its pin, the fix the check gives is to uninstall it and install it again from the pinned ref.
- Whether `/reload-plugins` runs SessionStart hooks again. HITLd's SessionStart hook puts the plugin's versioned `bin` directory on the session's PATH, so the plan restarts sessions instead of reloading them.

### Release mechanics

*Decided and built (HITLD-79, [Q37](22-open-questions.md#q37-how-is-a-release-tagged-when-the-owner-has-no-terminal-affects-releases)).* A release goes through a **release pull request**, as release-please and Changesets do; the release decision itself (the interface delta, the bump and the record, [3.2](03-data-model.md#release)) stays HITLd's.

1. **`hitld release make --branch <name>`** runs in the owner's own turn, with the same guard and checks as on main ([3.2](03-data-model.md#release)), including the gates of the release item for the version: the work item whose `release` key is that version, which needs the items and milestones the release waits for. It writes the record on a new branch made from main, refuses a branch that exists here or at a remote, checks out main again, and never tags or pushes. It returns the pull request's title and body: the version, the bump, the notes and the interface delta.
2. **The orchestrator pushes the branch and opens the pull request.** CI and the DCO check run on it like any other.
3. **The owner's squash merge is the release decision.** The squash commit on main adds `work/releases/<tag>.md` and carries the owner's `Signed-off-by` (HITLD-59).
4. **One workflow run** (`.github/workflows/release.yml`) starts on that push. Its first job runs the record-to-tag check (`core/bin/release-check.mjs`) with read access only, then reads the `release` environment's protection rules through the GitHub API (`scripts/release-environment.mjs`, HITLD-140) and refuses the run when the environment is missing, has no required reviewer, or cannot be read: GitHub creates a missing environment with no rules when a job first uses it and runs that job at once, so the approval would otherwise rest on a setting nothing checked. The second job runs in the `release` environment, which waits for the owner's approval in GitHub. It checks the record again, runs the checks and the offline evals, packages, creates the annotated tag on that exact commit, pushes the tag with the run's own token, attests build provenance and drafts the GitHub release (a pre-release for a tag with a `-`). Tagging and releasing happen in the same run: a push made with the Actions token starts no other workflow, so nothing waits on one, and no long-lived token is stored.
5. **The owner publishes the draft.** With immutable releases on, the published release, its assets and its tag can no longer change.

**The record-to-tag check** refuses unless the commit adds exactly one record; the record passes the tracker's checks and the release schema; its tag does not exist; its version is the one `release propose` gives at the commit's parent, for the same pre-release label or a full release, and its `previous` is that proposal's base; and the commit is on main, has one parent, and its subject ends with the `(#N)` a squash merge adds, where N is a merged pull request GitHub links the commit to. When a work item's `release` is the record's version, everything it needs, read at the commit's parent, is done or dropped; an open item or milestone refuses the record, so a record made by hand cannot skip a gate. A commit that adds no record releases nothing. A version above the proposal (`release make --version`) does not pass; it is tagged by hand. Edge: when another pull request merges between `release make --branch` and the release merge and changes the proposal, the check refuses, and the record is made again from the new main.

**By hand.** `hitld release make` on main still writes the record and the annotated tag for a person at a terminal, who pushes both; the same workflow's `tagged` job builds, attests and drafts on that tag push. A tag ruleset on `v*` refuses that push unless the person is on its bypass list.

**Repository settings** that make this hold (the owner's, written as click-paths in `CONTRIBUTING.md`, Releases): a tag ruleset on `v*` so tags are not moved or deleted, and are created only by the release workflow where GitHub's bypass list allows it; immutable releases; and the `release` environment, with the owner as required reviewer, self-review allowed (one maintainer), and deployments from `main` only. The run refuses without a required reviewer; the other settings are not checked by the workflow.

## 16.6 What lives in a consuming project

The plugin holds only generic machinery. The project holds:

```
<project>/
  AGENTS.md                      # the executor contract block, between markers (template from the plugin)
  CLAUDE.md                      # if present, imports @AGENTS.md
  .claude/settings.json          # marketplace pin and enabled plugin
  .claude/settings.local.json    # this machine only, git-ignored: the opt-in status-line capture
  .human-in-the-lead/
    policy.json                  # settings with bounds, decision rights, area map, ID key, paths, harnesses
    tracker.json                 # tracker backend choice and its paths
  work/                          # files backend data (path configurable)
  precedents/                    # public precedents
  kb/                            # public knowledge base
  evals/                         # the project's own eval scenarios (part 17)
```

Outside the repository, with the person: the person file (`~/.config/human-in-the-lead/person.json`) and the machine file, written by the first-run setup ([13.4](13-operations.md#134-settings-in-four-layers)).

Outside the repository, in the private store: the ledger, private signals, confidential decisions, precedents and knowledge, research, contributor records, process studies, digests, dashboard intents, and the project's sealed eval scenarios if it keeps any ([part 3](03-data-model.md#private-store)). **Anything confidential lives there, never in the plugin or the repository.**

The decision log is the set of decision items plus the generated `kb/decisions.md`.

## 16.7 Adopting an existing in-repo tracker

A project may already run an in-repo tracker: one file per item with global `<KEY>-<n>` IDs (the key is per project), scripts to create items and to generate views and check the data, and a section about the tracker in its `AGENTS.md`.

**The plugin's files backend adopts that format, generalized**: the key and every path are settings, and the file format, lifecycle, claim convention and views are the same. So existing items need **no conversion**.

Migration, step by step, each depending on the one before:

1. **Coexist, read-only.** Install the plugin pinned to a release. Set the key in `policy.json` (`project.key`) and the paths in `tracker.json`. Run `hitld work check` and `hitld work views` to a scratch directory and compare with the project's own scripts' output. Any difference is a bug in the backend, fixed upstream, until the outputs agree.
2. **Plugin writes, project scripts check.** Agents create and claim items with `hitld`; the project's own check still runs in its tests as a cross-check.
3. **Contract.** Replace the tracker section of `AGENTS.md` with the executor contract block; `hitld check contract` passes.
4. **Move upstream and delete.** Anything the project's scripts or skills do that the plugin does not is added to the plugin. Then the project deletes its tracker scripts, skills and their tests, keeping only its data and settings.
5. **Then, one at a time:** the orchestrator and ledger, decisions and precedent over the existing decision items, the project's own evidence source, intake sources, the adversarial loop on one area, and knowledge-base front matter on existing docs as pages are next touched ([part 8](08-knowledge-base.md#87-where-existing-project-material-fits)).

**Setup through the project's package manager.** Once releases are tagged, the project declares the `hitld` command line as a development dependency pinned to a release tag of this repository, and adds an explicit setup script (for npm, `npm run hitld:setup`) that runs `hitld install --ref <tag>` and the two `claude plugin` commands. Never an install hook that runs on every package install: that would run for every contributor and every CI job. The plugin itself still comes from the marketplace, pinned to the same tag.

Where the plugin and the project's scripts disagree during coexistence, the project's scripts win until the owner decides otherwise.

The steps as commands, with what to commit, how to check and how to undo, are in [the setup guides](../../guide/existing-tracker.md); the `adopt` skill runs them after the owner's yes.
