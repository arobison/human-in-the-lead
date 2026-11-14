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
| `hitld work new / show / query / claim / release / close / claims` | Tracker operations through the configured backend; `claims` lists claimed items from branches; `show` and `query` take `--json` for the versioned read API |
| `hitld work migrate [--dry-run]` | Apply the tracker format migrations to every file; idempotent; the dry run prints the diff |
| `hitld work check` | Schema, references, cycles, classification, orphaned claims; view freshness on `main` |
| `hitld work views` | Regenerate views (ready, blocked, claims, decisions, projects, initiatives, lists, a dependency diagram) |
| `hitld ready` | The ready queue in priority order, with tiers and estimates |
| `hitld dispatch plan / start` | Choose items for free slots and serial resources; start them through the harness adapter |
| `hitld merge` | Run the merge queue: rebase, fast checks, batch suite, bisection |
| `hitld ledger append / tail / inflight / summary` | Ledger operations; `inflight` for restart; `summary` for the run report |
| `hitld rights <question.json>` | Which decider, by which rule |
| `hitld precedent match <question.json>` | Candidate precedents |
| `hitld intake pull <source>` and `hitld note <text>` | Pull raw signals into quarantine; record an owner's note |
| `hitld kb search / index / stale / orphans / links / check` | The knowledge base tool ([part 8](08-knowledge-base.md#85-the-kb-tool)) |
| `hitld metrics`, `hitld control evaluate` | Measures; controllers inside bounds |
| `hitld eval [--offline | --live] [--harness h] [--sealed]` | The eval suite ([part 17](17-evals.md)); built: `--offline`, `eval report`, `eval accept --run` |
| `hitld config explain / write` (planned) | Each effective setting and the layer it came from; write the person or machine file after validating it ([part 13](13-operations.md#134-settings-in-four-layers)) |
| `hitld machine detect` (planned) | Probe this machine and propose a machine profile for the person to confirm |
| `hitld check contract / policy` | `AGENTS.md` contract present and current, and imported by `CLAUDE.md` if one exists; `policy.json` valid within bounds |
| `hitld data migrate` (planned) | Upgrade data files (`policy.json`, settings and private-store files; never the ledger) to the current schema versions |
| `hitld work migrate` (planned) | Upgrade the tracker files to the current tracker format ([3.4](03-data-model.md#file-format)) |
| `hitld config migrate` (planned) | Move settings out of `policy.json` into the person and machine files ([13.4](13-operations.md#moving-from-todays-policyjson)) |
| `hitld store export / import / sync` (planned) | Move or sync the private store between machines as an encrypted bundle ([part 3](03-data-model.md#private-store)) |
| `hitld release` (planned) | Tag and publish a release after its gate |
| `hitld feedback`, with `list`, `drop` and `render` | Capture feedback about the plugin, locally ([part 18](18-self-improvement.md#184-giving-feedback)) |
| `hitld mcp` (planned) | Serve the same operations over MCP (tools only) |
| `hitld install` | Set up a consuming project: policy, contract block, `.claude/settings.json` pin, and the opt-in status-line capture (`--statusline`) |
| `hitld install --harness <h>` (planned) | Place skills, agents, hooks and instructions where a harness reads them, for harnesses without a plugin path |

Built as well: `run`, `env`, `handover`, `rights ask / answer`, `quota`, `report`, `eval accept` and `merge --only`. `hitld --help` lists every built command; this table is the design, not the list.

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
- **First run.** The person's first session runs the orchestrator's setup: `hitld machine detect`, a few questions, then `hitld config write` for the person and machine files ([13.4](13-operations.md#134-settings-in-four-layers)). Until then defaults are conservative and autonomous dispatch waits. The setup also offers the status-line usage capture, which is opt-in: it changes the person's own harness settings, so it is installed only on a yes (`hitld install --statusline`).
- **Before any tag exists**, `hitld install` pins a local checkout path, which puts a machine path in the committed `.claude/settings.json`. It warns; switch to `--ref <tag> --repo <owner/name>` before others clone the project.
- **Pinning.** The marketplace `ref` pins the catalog to a tag; the plugin's `version` in `plugin.json` is set equal to that tag by the release step, so the version a session loads is the version the tag names. A commit SHA can be used as `ref` for an exact pin.

### Releases

- A release is a **tag** (`vMAJOR.MINOR.PATCH`) on `main`, with a changelog generated from this repository's own item files.
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

Compatibility rules for data:

- **Every data file and ledger line carries `schema_version`.**
- **From 1.0, minor and patch releases** read every older schema version of the same major, and write only formats that the previous minor release can still read. New fields are optional with defaults.
- **Major releases** may change formats. Each ships `hitld data migrate` and `hitld work migrate` where it changes data files or the tracker format; each rewrites its files in one reviewable commit, and `hitld work check` names files that still need it.
- **The ledger is never rewritten.** It is append-only, so readers handle every schema version that appears in it.
- **No writing ahead.** A release refuses to write a file whose `schema_version` is newer than it knows, so a machine on an older pin cannot corrupt data written by a newer one (relevant when two machines exchange bundles).
- **`policy.json` migrations** add new settings with their defaults and bounds; they never change a value the owner set.

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
