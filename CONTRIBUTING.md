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
- **Never push.** Commits stay local until the owner reviews them.

## Giving feedback

You do not need a problem to file feedback; something that worked well is useful too.

- **Issue forms.** Open an issue and pick a form: bug, friction, idea or design comment, worked well, or experience report. Blank issues are off. Leave out anything confidential.
- **`hitld feedback`** (planned) records feedback about HITLd from inside a consuming project's session, stored locally until a generalized version is approved and filed with the same fields as the forms.

Details: [design 18.4](docs/design/0001-human-in-the-lead/18-self-improvement.md#184-giving-feedback).

## Sign-off

Contributions carry a `Signed-off-by` line under the [Developer Certificate of Origin](https://developercertificate.org/) (design [part 22, Q20](docs/design/0001-human-in-the-lead/22-open-questions.md#q20-dco-or-cla-for-inbound-contributions-blocks-m7-also-applies-to-this-repository)). Add it with `git commit -s`, which appends `Signed-off-by: Your Name <you@example.com>` using your git name and email. Sign off every commit in a pull request.

This applies to this repository's own commits as well. The owner signs off the first public commit. For a commit an agent made, the person who approves its merge adds the sign-off. A DCO check in CI is planned.

Credit for adapted patches uses `Co-Authored-By:` with the contributor's forge noreply address, unless they ask for another.
