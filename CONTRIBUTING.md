# Contributing

The project is not ready for outside code contributions until the milestone "One signal end to end" is done (see the [README](README.md#contributing)). This file is for the sessions and people building it.

## Setup

Node.js 22.13 or later (for the built-in `node:sqlite`). No build step: the core is plain JavaScript (ES modules) with JSDoc types.

```bash
npm ci                 # dev dependencies only: TypeScript (type checking), Prettier, Node types
npm test               # node:test, no test framework
npm run typecheck      # tsc --noEmit over core/
npm run format         # Prettier; npm run format:check to check only
npm run check          # all three
node core/bin/hitld.mjs --help
```

## Rules

- **No third-party runtime dependencies** ([design part 16.1](docs/design/0001-human-in-the-lead/16-packaging.md#161-this-repositorys-layout)). Only Node built-ins in `core/`. Dev dependencies are allowed and pinned to exact versions.
- **The core never calls a harness** ([part 15](docs/design/0001-human-in-the-lead/15-architecture.md)). Harness code lives under `core/harness/<id>/`; core tests use the fake adapter.
- **Data never runs code.** Schemas reject unknown keys and refuse keys that name code to run. A new schema goes in `schemas/`; a new `policy.json` section goes in `schemas/policy/`, with a `default` and a `description` for every setting.
- **Every data file carries `schema_version`.** Raising a version follows [part 16.5](docs/design/0001-human-in-the-lead/16-packaging.md#165-releases-and-compatibility).
- **One command table.** A new `hitld` command is an entry in the piece's file under `core/lib/cli/commands/`, with its arguments declared, so the MCP server can be generated from the same table.
- **Writing.** Plain, precise wording. No time estimates. Nothing about a consuming project's confidential details.
- **Push your own branch only.** Agents push their branch, never main, and never force-push. Agents open no pull request to main; the owner opens it or merges the branch.

## Giving feedback

You do not need a problem to file feedback; something that worked well is useful too.

- **Issue forms.** Open an issue and pick a form: bug, friction, idea or design comment, worked well, or experience report. Blank issues are off. Leave out anything confidential.
- **`hitld feedback`** records feedback about HITLd from inside a consuming project's session, with its context, in that project's private store (`hitld feedback list`, `drop` and `render` work on the records). `hitld feedback publish` files a generalized version, with the same fields as the forms, only after the person approves it; the record itself never leaves the machine.

Details: [design 18.4](docs/design/0001-human-in-the-lead/18-self-improvement.md#184-giving-feedback).

## Sign-off

Contributions carry a `Signed-off-by` line under the [Developer Certificate of Origin](https://developercertificate.org/) (design [part 22, Q20](docs/design/0001-human-in-the-lead/22-open-questions.md#q20-dco-or-cla-for-inbound-contributions-blocks-m7-also-applies-to-this-repository)).

**How to sign off.** Add the line with `git commit -s`, which appends `Signed-off-by: Your Name <you@example.com>` using your git name and email. Sign off every commit in a pull request. To fix commits already made, run `git commit --amend -s` for the last one, or `git rebase --signoff <base>` for several, and push the branch again.

**Squash merges only.** The repository allows squash merges and nothing else, so each pull request lands on main as one commit. The person who merges signs off that squash commit by putting their `Signed-off-by:` line in its message on GitHub.

**Agent pull requests.** A commit an agent made carries `Agent-Role:` or `Dispatch:` trailers and no sign-off. The person who approves the merge signs off the squash commit. That is how the owner signs off agent work.

**The CI check** (`core/bin/dco-check.mjs`):

- On a pull request, a commit by a person must carry a `Signed-off-by` that matches its author's email. An agent commit is accepted without one. Merge commits on the branch (main merged in) are exempt. A failure names the commit and the fix.
- On a push to main, each pushed commit must carry a `Signed-off-by` from a person, not an agent address such as `noreply@anthropic.com`. A merge commit made by the merge button is exempt.

The owner signs off the first public commit.

Credit for adapted patches uses `Co-Authored-By:` with the contributor's forge noreply address, unless they ask for another.
