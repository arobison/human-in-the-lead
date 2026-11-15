# Setup guides

One page for each situation you may start from. Each gives the commands, what to commit, how to check that it worked and how to undo it, at the release tag `v0.1.0-rc.1`.

| Your project | Page |
|---|---|
| A new project, with no code worth keeping yet | [A new project](new-project.md) |
| Existing code, no tracker | [An existing project with no tracker](existing-project.md) |
| Existing code and a tracker kept as files in the repository | [An existing in-repo tracker](existing-tracker.md) |
| Existing code and a tracker in Linear, Jira or GitHub Issues | [An existing hosted tracker](hosted-tracker.md) |
| You want a view of the numbers of your own | [Building your own dashboard](dashboard.md) |

Whichever you start from, read [Moving the private store between machines and cloud sessions](store-remote.md) after it when you work from more than one machine, or from cloud sessions.

## Before any of them

- Node.js 22.13 or later, git, and Claude Code.
- `hitld` is not published to a package registry. Clone the tag once, anywhere outside your project, and run it from there:

  ```bash
  git clone --branch v0.1.0-rc.1 --depth 1 https://github.com/arobison/human-in-the-lead.git
  ```

  In the commands on these pages, `hitld` stands for `node <path to that clone>/core/bin/hitld.mjs`. If you put a `hitld` on your path, use that instead. Keep the clone: the commit guard that `hitld install` writes runs the `hitld` it was installed from.
- Every `hitld` command prints JSON, and `ok` says whether it worked. A failed command has `ok: false` and an `error` code (the list is in [design part 16.2](../design/0001-human-in-the-lead/16-packaging.md#failed-commands-and-their-error-codes)). Exit codes: 0 worked, 1 the command found a problem, 2 usage error, 3 not built yet.

## What `hitld install` does

It sets up the project in one step and never touches anything outside these files:

| File | What it holds |
|---|---|
| `.human-in-the-lead/policy.json` | Your project's ID and tracker ID key, and every setting you change. Kept as it is if it exists |
| `AGENTS.md` | The executor contract, between `hitld:contract` markers. Everything outside the markers is yours and is never changed |
| `CLAUDE.md` | An `@AGENTS.md` import is added, if the file exists without one |
| `.claude/settings.json` | The plugin marketplace pinned to the tag, and the plugin turned on. Other keys are kept |
| the git directory's `hooks/pre-commit` | The commit guard, which refuses a file above the repository's classification ceiling. A pre-commit hook that is not `hitld`'s is left alone, and the result says what to add to it |

The status-line usage capture (`.claude/settings.local.json`, git-ignored) is off unless you pass `--statusline`. It changes your own harness settings, so every page leaves it as your choice.

## What the project keeps

Your tracker items (in `work/` unless you set another folder), `.human-in-the-lead/policy.json`, the contract in `AGENTS.md`, and your own rules. Anything confidential (the ledger, research, relationship notes) lives in a private store outside the repository, under `$XDG_DATA_HOME/human-in-the-lead/<project ID>/` (by default `~/.local/share/human-in-the-lead/<project ID>/`). Your settings as a person and for each machine live in `~/.config/human-in-the-lead/person.json` and the machine file; every project on the machine reads them, so no page tells you to remove them.

## Project rules

`hitld install` writes only the block between the markers. Your project has conventions of its own: how to run the tests, the lint and format commands, commit rules such as a sign-off line or required trailers, and what agents must not touch. Write them as a short `## Project rules` section in `AGENTS.md`, outside the markers, so every agent that reads the file sees them. Keep it to the rules; leave long explanations in `CONTRIBUTING.md` and link to it.
