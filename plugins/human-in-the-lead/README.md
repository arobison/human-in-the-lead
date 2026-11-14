# The human-in-the-lead plugin for Claude Code

Layer 4 packaging ([design part 16.1](../../docs/design/0001-human-in-the-lead/16-packaging.md#161-this-repositorys-layout)).

| Path | Holds | Made by |
|---|---|---|
| `.claude-plugin/plugin.json` | Name, version (equal to the release tag), description | By hand; the release step sets the version |
| `skills/` | `orchestrate` and `execute`, from `../../skills/`, with Claude Code front matter added | `npm run build` |
| `agents/` | `executor-tier1` and `executor-tier2`: model, effort, worktree isolation, background | `npm run build` |
| `hooks/hooks.json` | SessionStart (hitld on PATH, plugin path and version), PreToolUse guard, SubagentStop and Stop report check | By hand; the scripts are in `core/harness/claude-code/hooks/` |
| `bin/hitld` | The command line, from the plugin's own core | By hand |
| `core/`, `schemas/`, `templates/`, `evals/` | Copies, because an installed plugin cannot reach files outside this directory | `npm run build` |

Never edit the generated parts here: edit the sources and run `npm run build`. A test fails when this copy is out of date.

## Using it in a project, before release tags exist

From the consuming project's root, with a checkout of this repository at `<checkout>`:

```bash
node <checkout>/core/bin/hitld.mjs install --key <KEY>      # policy.json, AGENTS.md block, settings, status line
claude plugin marketplace add <checkout>                   # the local directory marketplace
claude plugin install human-in-the-lead@human-in-the-lead --scope project
```

Then set `merge.full_suite` in `.human-in-the-lead/policy.json`, check with `hitld check contract` and `hitld check policy`, commit the files `install` wrote (not `.claude/settings.local.json`), and ask Claude Code to run the orchestrate skill. For one session without installing: `claude --plugin-dir <checkout>/plugins/human-in-the-lead`.
