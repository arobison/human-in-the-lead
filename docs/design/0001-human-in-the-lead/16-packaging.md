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
    orchestrate/ execute/         # built; the rest of the design's skills are planned
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
| `hitld work views` | Regenerate views (ready, blocked, claims, decisions, projects, critical path, milestones, unreleased, lists, dependency diagrams) |
| `hitld ready` | The ready queue in priority order, with tiers and estimates |
| `hitld dispatch plan / start` | Choose items for free slots and serial resources; start them through the harness adapter |
| `hitld merge` | Run the merge queue: rebase, fast checks, batch suite, bisection |
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
| `hitld check classification [--staged]` | The commit guard: no file above the repository's classification ceiling, in the next commit or the whole tree ([10.3](10-security.md#103-information-classification)) |
| `hitld data migrate` (planned) | Upgrade data files (`policy.json`, settings and private-store files; never the ledger) to the current schema versions |
| `hitld config migrate` | Move settings out of `policy.json` into the person and machine files ([13.4](13-operations.md#moving-from-todays-policyjson)) |
| `hitld store export / import / sync` | Move or sync the private store between machines as an encrypted bundle ([part 3](03-data-model.md#private-store)) |
| `hitld release propose [--pre rc] [--item <id>]` | The interface delta since the last full release, the bump it proposes and its reason, draft notes, items that changed public surface without a `release_note` line, unmet gates ([3.2](03-data-model.md#release)) |
| `hitld release make [--version v] [--pre rc] [--decision <id>] [--item <id>]` | Write the release record and an annotated tag on `main`; the owner's, from the main session; never pushes. Publishing after the eval gate is planned |
| `hitld feedback`, with `list`, `drop` and `render` | Capture feedback about the plugin, locally ([part 18](18-self-improvement.md#184-giving-feedback)) |
| `hitld mcp` (planned) | Serve the same operations over MCP (tools only) |
| `hitld install` | Set up a consuming project: policy, contract block, `.claude/settings.json` pin, the commit guard's pre-commit hook, and the opt-in status-line capture (`--statusline`) |
| `hitld install --harness <h>` (planned) | Place skills, agents, hooks and instructions where a harness reads them, for harnesses without a plugin path |

Built as well: `run`, `env`, `handover`, `rights ask / answer`, `quota`, `dashboard`, `eval accept`, and `merge --all` and `merge --only` for owner merge mode. `hitld --help` lists every built command; this table is the design, not the list.

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
      "source": { "source": "github", "repo": "arobison/human-in-the-lead", "ref": "v0.1.0" }
    }
  },
  "enabledPlugins": { "human-in-the-lead@human-in-the-lead": true }
}
```

- **What the committed file does.** It declares the marketplace pinned to a release tag (`ref`) and turns the plugin on for the project. Every worktree is a checkout of the same repository, so every worktree session sees the same pin.
- **What it does not do** (per the documentation read on 2026-11-14): committed project settings turn the plugin on but **do not download it** to a collaborator's machine, and a marketplace declared in project settings takes effect only after the person trusts the folder. Each machine therefore installs once:

  ```bash
  claude plugin install human-in-the-lead@human-in-the-lead --scope project
  ```

  `hitld check contract` (or the adopt skill) reports a machine where the pinned version is not installed.
- **First run.** The person's first session runs the orchestrator's setup: `hitld machine detect`, one message with every proposed value for the person to accept or change, then `hitld config write` for the person and machine files ([13.4](13-operations.md#134-settings-in-four-layers)). Until then defaults are conservative and autonomous dispatch waits. The setup also offers the status-line usage capture, which is opt-in: it changes the person's own harness settings, so it is installed only on a yes (`hitld install --statusline`).
- **Before any tag exists**, `hitld install` pins a local checkout path, which puts a machine path in the committed `.claude/settings.json`. It warns; switch to `--ref <tag> --repo <owner/name>` before others clone the project.
- **Pinning.** The marketplace `ref` pins the catalog to a tag; the plugin's `version` in `plugin.json` is set equal to that tag by the release step, so the version a session loads is the version the tag names. A commit SHA can be used as `ref` for an exact pin.

### Releases

- A release is a **tag** (`vMAJOR.MINOR.PATCH`) on `main`, with a changelog generated from this repository's own item files. It is made through a release pull request, and the release workflow tags it ([16.5, Release mechanics](#release-mechanics)).
- A release is **gated by the eval suite**: the visible suite passes on the supported harnesses, the head-to-head against the previous release shows no regression beyond tolerance, and for skill or policy changes the sealed set passes ([part 18](18-self-improvement.md#183-guardrails-against-gaming-its-own-grading)). The changelog cites the eval run IDs.
- **The first release** has no previous release, no live runner and no sealed set yet. It is gated on the offline suite passing against the owner-accepted baseline. The live evals, the comparison with the previous release and the sealed set join the gate once each exists.
- **A consumer upgrades by committing a change to the `ref`**, then running the migrations the release notes name (`hitld data migrate`, `hitld work migrate` or `hitld config migrate`). Rolling back is reverting that commit.

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

The plugin's **public interface** is: the executor contract; the report shape; the data schemas (items, decisions, precedents, signals, studies, ledger, `policy.json`, eval scenarios and results); the adapter interfaces; the `hitld` command's and MCP server's JSON; and the commit trailers. Semantic versioning applies to that interface. The adapter interface and capability set are public and labelled experimental until a second adapter proves their shape. The schemas of the person and machine files ([13.4](13-operations.md#134-settings-in-four-layers)) are part of it.

**While the version is 0.y.z** (before 1.0), a minor release may break formats or commands, and ships the migration for whatever it changes: `hitld data migrate` for data files, `hitld work migrate` for the tracker format. Patch releases never break. Minor and major releases are the owner's call; a patch release may follow a precedent the owner confirmed. The first tag is `v0.1.0`. The rules below apply from 1.0.

**What a 0.y.z release still keeps.** Data people keep (tracker files, settings, the ledger, private-store records) follows the rename rule below even before 1.0: an old name is read for one minor release, with a warning, and the release ships its migration. Output (error codes, the `hitld` command's JSON and text, generated pages) may change in any minor release with no fallback; the release notes list each change.

Compatibility rules for data:

- **Every data file and ledger line carries `schema_version`.**
- **From 1.0, minor and patch releases** read every older schema version of the same major, and write only formats that the previous minor release can still read. New fields are optional with defaults.
- **Major releases** may change formats. Each ships `hitld data migrate` and `hitld work migrate` where it changes data files or the tracker format; each rewrites its files in one reviewable commit, and `hitld work check` names files that still need it.
- **The ledger is never rewritten.** It is append-only, so readers handle every schema version that appears in it, and every name it ever used (HITLD-82: `claimed`, `question`, `released`, `outcome` and `handle` are read as `started`, `asked`, `unclaimed`, `result` and `harness_ref`).
- **A rename is read under the old name for one minor release, with a warning**, wherever the data lives outside the repository: private-store records (feedback, run state, the environment manager's holders file), eval results and baselines, precedent files, the person and machine files (`hitld config migrate` rewrites those two) and `policy.json`. Tracker files move with `hitld work migrate`; claim branches, file history and release tags from before are read in the new names. `hitld install` rewrites the contract block.
- **No writing ahead.** A release refuses to write a file whose `schema_version` is newer than it knows, so a machine on an older pin cannot corrupt data written by a newer one (relevant when two machines exchange bundles).
- **The person and machine files follow one rule, because every project on the machine reads them, each with the release it is pinned to.** A reader accepts a `schema_version` at or below its own and refuses a newer one, with a message that says to upgrade human-in-the-lead and leaves the file as it is. A writer stamps the lowest version that expresses the file's content, so a file that uses nothing new stays readable by the older release a project may still be pinned to. `hitld config explain` warns when a project pinned on this machine cannot read the file as it is, naming the project, the version it reads and the release that reads more. It finds the pin in the project's `.claude/settings.json` (a tag, or a checkout whose own schemas say what it reads) and, for every other project with a private store, the release its last run started with.
- **`policy.json` migrations** add new settings with their defaults and bounds; they never change a value the owner set.

### Release mechanics

*Decided and built (HITLD-79, [Q37](22-open-questions.md#q37-how-is-a-release-tagged-when-the-owner-has-no-terminal-affects-releases)).* A release goes through a **release pull request**, as release-please and Changesets do; the release decision itself (the interface delta, the bump and the record, [3.2](03-data-model.md#release)) stays HITLd's.

1. **`hitld release make --branch <name>`** runs in the owner's own turn, with the same guard and checks as on main ([3.2](03-data-model.md#release)). It writes the record on a new branch made from main, refuses a branch that exists here or at a remote, checks out main again, and never tags or pushes. It returns the pull request's title and body: the version, the bump, the notes and the interface delta.
2. **The orchestrator pushes the branch and opens the pull request.** CI and the DCO check run on it like any other.
3. **The owner's squash merge is the release decision.** The squash commit on main adds `work/releases/<tag>.md` and carries the owner's `Signed-off-by` (HITLD-59).
4. **One workflow run** (`.github/workflows/release.yml`) starts on that push. Its first job runs the record-to-tag check (`core/bin/release-check.mjs`) with read access only. The second job runs in the `release` environment, which waits for the owner's approval in GitHub. It checks the record again, runs the checks and the offline evals, packages, creates the annotated tag on that exact commit, pushes the tag with the run's own token, attests build provenance and drafts the GitHub release (a pre-release for a tag with a `-`). Tagging and releasing happen in the same run: a push made with the Actions token starts no other workflow, so nothing waits on one, and no long-lived token is stored.
5. **The owner publishes the draft.** With immutable releases on, the published release, its assets and its tag can no longer change.

**The record-to-tag check** refuses unless the commit adds exactly one record; the record passes the tracker's checks and the release schema; its tag does not exist; its version is the one `release propose` gives at the commit's parent, for the same pre-release label or a full release, and its `previous` is that proposal's base; and the commit is on main, has one parent, and its subject ends with the `(#N)` a squash merge adds, where N is a merged pull request GitHub links the commit to. A commit that adds no record releases nothing. A version above the proposal (`release make --version`) does not pass; it is tagged by hand. Edge: when another pull request merges between `release make --branch` and the release merge and changes the proposal, the check refuses, and the record is made again from the new main.

**By hand.** `hitld release make` on main still writes the record and the annotated tag for a person at a terminal, who pushes both; the same workflow's `tagged` job builds, attests and drafts on that tag push. A tag ruleset on `v*` refuses that push unless the person is on its bypass list.

**Repository settings** that make this hold (the owner's, written as click-paths in `CONTRIBUTING.md`, Releases): a tag ruleset on `v*` so tags are not moved or deleted, and are created only by the release workflow where GitHub's bypass list allows it; immutable releases; and the `release` environment, with the owner as required reviewer, self-review allowed (one maintainer), and deployments from `main` only.

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

1. **Coexist, read-only.** Install the plugin pinned to a release. Set the key and paths in `tracker.json`. Run `hitld work check` and `hitld work views` to a scratch directory and compare with the project's own scripts' output. Any difference is a bug in the backend, fixed upstream, until the outputs agree.
2. **Plugin writes, project scripts check.** Agents create and claim items with `hitld`; the project's own check still runs in its tests as a cross-check.
3. **Contract.** Replace the tracker section of `AGENTS.md` with the executor contract block; `hitld check contract` passes.
4. **Move upstream and delete.** Anything the project's scripts or skills do that the plugin does not is added to the plugin. Then the project deletes its tracker scripts, skills and their tests, keeping only its data and settings.
5. **Then, one at a time:** the orchestrator and ledger, decisions and precedent over the existing decision items, the project's own evidence source, intake sources, the adversarial loop on one area, and knowledge-base front matter on existing docs as pages are next touched ([part 8](08-knowledge-base.md#87-where-existing-project-material-fits)).

**Setup through the project's package manager.** Once releases are tagged, the project declares the `hitld` command line as a development dependency pinned to a release tag of this repository, and adds an explicit setup script (for npm, `npm run hitld:setup`) that runs `hitld install --ref <tag>` and the two `claude plugin` commands. Never an install hook that runs on every package install: that would run for every contributor and every CI job. The plugin itself still comes from the marketplace, pinned to the same tag.

Where the plugin and the project's scripts disagree during coexistence, the project's scripts win until the owner decides otherwise.
