# The eval suite

Scenarios, fixtures, graders and the runner ([design part 17](../docs/design/0001-human-in-the-lead/17-evals.md)). This is the guide for the pieces of "Usable in a consuming project" ([design part 21](../docs/design/0001-human-in-the-lead/21-scope.md)): each adds offline scenarios for what it builds, and `hitld eval --offline` is their gate.

```bash
node core/bin/hitld.mjs eval --offline                       # everything
node core/bin/hitld.mjs eval --offline --scenarios ledger    # one suite, or one ID, or an ID prefix
node core/bin/hitld.mjs eval --offline --seed 7              # other fixtures; its own baseline
```

The command prints JSON and exits 0 only when every scenario passes and the gate is satisfied. A failure lists the failing graders and where the transcript was kept.

## Where things live

| Path | What |
|---|---|
| `evals/scenarios/<suite>/<name>.scenario.json` | One scenario. Its ID is `<suite>/<name>`, and the file's path must say so |
| `evals/fixtures/<name>/` | A fixture directory a scenario copies fresh (`copy` generator). Synthetic and `public` only |
| `core/lib/eval/actions/<suite>.mjs` | Actions your scenarios need, exporting `actions` (see below) |
| `schemas/eval-scenario.schema.json`, `schemas/eval-result.schema.json` | The scenario and result formats |
| `schemas/policy/eval.schema.json` | The gate's thresholds: category floors and tolerances |

`<suite>` is the area name, matching your command file in `core/lib/cli/commands/`: `foundation`, `tracker`, `ledger`, `env`, `contract`, `rights`, `quota`, `eval`, `orchestrator`, `security`, `release`, `adopt`, `store`. Make the directory when you add your first scenario. A consuming project adds its own scenarios under its own `evals/`, in the same format; `hitld eval` runs both.

## A scenario

JSON, validated by `schemas/eval-scenario.schema.json`. The design names YAML; the core has no YAML reader and takes no dependencies, and the format is plain data that converts to it if that is wanted later.

```json
{
  "schema_version": 1,
  "id": "foundation/policy-check",
  "suite": "foundation",
  "category": "policy",
  "description": "What behavior this protects, in a sentence.",
  "mode": "offline",
  "fixture": { "generator": "repo", "options": { "language": "javascript" } },
  "steps": [{ "id": "check", "action": "cli", "with": { "argv": ["check", "policy"] } }],
  "graders": [{ "id": "ok", "grader": "equals", "with": { "path": "steps.check.result.ok", "value": true } }]
}
```

- **`category`** is what the regression gate scores. Pick a stable name for a kind of behavior; use `injection-containment` or `escalation-recall` only for scenarios of that kind, because those have floors.
- **`fixture`** builds a sandbox (a temporary directory, removed afterwards). `repo` generates a small repository, seeded: `language` (`javascript` or `python`), `modules` (1 to 8), `git: true` for a real repository with a fixed commit, `policy` for extra policy sections. `copy` copies `evals/fixtures/<options.from>`.
- **`steps`** run in order. Each calls an action with its `with`, and its result is kept as `steps.<id>`.
- **`graders`** check the end state, not the path. All must pass.
- **`harness`** is for scenarios that drive the fake adapter: `{ "profiles": ["*"], "requires": { "parallel_subagents": true } }`. It runs under each profile named (`full`, `minimal`, `copilot-cloud-agent`; `*` is all), and is reported **not applicable**, never passed, where a profile lacks a required capability. A scenario that uses `adapter.*` actions must declare it. Scenarios without `harness` run once, with profile `none`.
- **`labels`** holds expected values for the accuracy metrics of part 17.4, for graders to use later.

Scenarios are data and never run code. A scenario cannot contain a key that names code (`script`, `command`, `on_merge`, ...); the validator refuses it like any data file. To test that such a key is refused, set it by path from a string: `{ "action": "file.set-json", "with": { "path": "...", "key_path": ["project", "post_merge"], "value": "..." } }`, or the `set` list of `schema.validate`. See `foundation/schema-refuses-code-running-keys`.

### Actions

| Action | Does |
|---|---|
| `cli` | Runs a `hitld` command in the sandbox. Result: `{ exit, result }`, the exit code and the JSON printed |
| `file.write` | Writes a text file in the sandbox |
| `file.set-json` | Sets one value in a JSON file, by key path |
| `schema.validate` | Validates data against a schema, after optional `set` edits. Result: `{ valid, errors }` |
| `adapter.dispatch` | Dispatches to the profile's fake adapter and completes it. A refusal is data: `{ accepted, refusal, completion }` |
| `adapter.capabilities` | The profile's capabilities |
| `store.fixture`, `store.session`, `store.discard` | The store remote scenarios (`store/`): a project whose devices each have a checkout, a private store and a key, with bare repositories standing in for the project's origin and the store's host; a new cloud session; a discarded one |
| `store.hitld`, `store.owner-merge`, `store.inspect-remote` | Run a `hitld` command on one device; land the owner's merge of the device list; look at everything the store's host holds, and what each device's key opens. A private key a command prints is kept as that device's key and left out of the result |

**To add an action**, add `core/lib/eval/actions/<suite>.mjs` exporting `actions`: each has a `description`, an `input` (a JSON Schema for `with`, which the loader checks) and `run(input, ctx)`, which calls your piece's library and returns plain JSON. `ctx` gives `sandbox`, `seed`, `profile`, `adapter()` (the fake adapter for the profile) and `recordTokens(n)`. Never call a harness: use `ctx.adapter()`.

### Graders

`equals`, `matches` (a regular expression; a path with `[*]` reads a list, and any or all entries must match), `contains`, `count`, `schema`, `file_exists`, `adapter_calls`. Paths start at `steps.` and use `.name`, `[0]` and `[*]`. Prefer deterministic graders and grade outcomes. `model_judge` exists as a marked seam: it needs a model, so offline runs report a scenario that uses it as not applicable.

## Results and the gate

Every run is written to the private store (`eval/results/<run ID>.json`), recording the plugin version and commit, the schema versions, the policy hash, the seed, the profiles and the scenario set version. A scenario that does not pass keeps its transcript (`eval/transcripts/...`): read it before blaming the system or the grader.

The gate compares a run with the baseline for the same settings, scenario by scenario. It fails when:

- a scenario that passed in the baseline now fails, errors, is not applicable, or is gone (removing a scenario is the owner's decision);
- a category's score drops by more than `eval.score_tolerance` (none, offline);
- a category is below its floor in `eval.category_floors`;
- a scenario's tokens rise beyond `eval.tokens_tolerance`.

New scenarios are noted, not failed. With no baseline, only floors and scenario results apply.

**The baseline is committed.** The gate reads `evals/baselines/<mode>-<settings hash>.json` in the checkout first and the private store's copy second, and says which it used (`gate.baseline_source` in the command's output, and a note). The key is the mode, the seed and the profiles, so it is the same on any machine. `--require-baseline` fails the run when no committed baseline matches, and ignores the private store: CI and the release workflow use it. A baseline file is the run in a committed form (grader messages empty, no reasons, no transcript keys, wall time 0, no commit), and a test fails if one carries a path, hostname, account name or private-store content. Baselines are not part of the built plugin.

**Recording a baseline is the owner's decision** (part 17.9: scenarios, graders and thresholds are protected). `hitld eval accept --result <run>` (or `--accept-baseline` on a run) records a full, passing run of a commit on main with a clean working tree (a baseline judges main; a run on a branch or with uncommitted changes is refused as `not-on-main` or `dirty-tree`, so run the suite on main): it writes the committed file in the primary checkout and keeps a copy in the private store. It does not commit; the owner, or the orchestrator under delegation, commits the file. Agents building a piece add scenarios and run the suite; they do not pass `--accept-baseline`, and do not edit thresholds or other pieces' scenarios.

## Seams left for later

- `--live`, `--harness` and `--sealed` are not built. `core/lib/eval/live.mjs` marks where they go: live runs against a real adapter, `claude plugin eval` compilation for skill scenarios, and the `model_judge` grader. Results already have a `live` mode.
- The Copilot cloud agent profile is a capability set for the fake adapter (`core/lib/eval/profiles.mjs`); its non-capability constraints (a run-time cap, tools-only MCP, a network allowlist) are recorded there for the scenarios of part 17.7 that need them. The Copilot adapter confirms or corrects the values.
