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

## The merge scanner

This repository's merge queue runs CodeQL ([design 10.5](docs/design/0001-human-in-the-lead/10-security.md#105-security-in-done-when)), declared in `.human-in-the-lead/policy.json` under `merge.scanners`. The queue runs `scripts/codeql-scan.mjs` from the primary checkout (`$HITLD_PRIMARY_ROOT`), never a branch's copy. The script refuses to run until the pinned CLI is installed. On the merge machine:

```bash
curl -fLO https://github.com/github/codeql-action/releases/download/codeql-bundle-v2.27.4/codeql-bundle-linux64.tar.gz
echo '89ed56c8ec6bfccef6a0d2e7fe86da0469ca24b4db08b88016ec134b942c17a4  codeql-bundle-linux64.tar.gz' | sha256sum -c
mkdir -p ~/.cache/hitld-codeql/v2.27.4
tar -xzf codeql-bundle-linux64.tar.gz -C ~/.cache/hitld-codeql/v2.27.4
export HITLD_CODEQL=~/.cache/hitld-codeql/v2.27.4/codeql/codeql   # in the shell that runs hitld merge
```

The checksum is the one the release publishes (`codeql-bundle-linux64.tar.gz.checksum.txt`). The bundle holds its own query packs and needs no network to scan. Raising the version changes `scripts/codeql-scan.mjs`, this section and the baseline: the new version's first run on main extends it. The CodeQL licence allows this use because the repository is open source on GitHub.com; it does not cover private code.

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

## Releases

A release goes through a release pull request ([design 16.5, Release mechanics](docs/design/0001-human-in-the-lead/16-packaging.md#release-mechanics)). Making one is the owner's decision.

1. In the owner's own turn, in the main session: `hitld release propose` to see the version, then `hitld release make --branch release/<tag>` (add `--pre rc` for a release candidate). It writes `work/releases/<tag>.md` on that new branch and tags nothing.
2. The orchestrator pushes the branch and opens a pull request to main, with the title and body `release make` returned.
3. The owner reviews it and squash-merges it with their `Signed-off-by:` line in the commit message. That merge is the release decision.
4. The release workflow starts on that push to main, checks the record (`core/bin/release-check.mjs`), and waits: approve it from the run's page (Actions → Release → the run → Review deployments → check `release` → Approve and deploy). It then tags the squash commit, builds, attests provenance and drafts the GitHub release.
5. The owner publishes the draft (Releases → the draft → Edit → Publish release).

The check refuses a record whose tag exists, whose version is not the one `release propose` gives at the merged commit's parent, or that did not arrive through a pull request. A release at a version above the proposal (`--version`) is tagged by hand: `hitld release make` on main at a terminal, then `git push origin main <tag>`; the same workflow drafts it on the tag push.

### Repository settings for releases

The owner applies these on github.com; each works from a phone browser. On a phone, the Settings tab may be behind the `…` at the end of the repository's tab bar.

**1. A tag ruleset on `v*`.** Repository → Settings → Rules → Rulesets → New ruleset → New tag ruleset.

- Ruleset name: `release tags`. Enforcement status: Active.
- Target tags: Add target → Include by pattern → `v*` → Add inclusion pattern.
- Bypass list: Add bypass. If the list offers **GitHub Actions** (under apps), check it, choose Add selected, and leave it on Always allow. Add no role: the Actions token is not a user, so a role such as Repository admin does not let it through.
- Rules: check **Restrict updates** and **Restrict deletions**, and keep Block force pushes. Check **Restrict creations** only if GitHub Actions is on the bypass list. Without that bypass, Restrict creations also refuses the workflow's own tag push, at the step "Tag the commit and push the tag", and nothing is drafted; without Restrict creations, only people with write access (the owner) can create a `v*` tag, and no one can move or delete one.
- Create.

With Restrict creations on, a tag pushed by hand is refused too, so the by-hand path needs the person on the bypass list as well.

**2. Immutable releases.** Repository → Settings → General → Releases → check **Enable release immutability**. A draft stays editable, so the workflow can draft the release and attach its files; once the owner publishes it, its files and its tag can no longer change or be deleted, and the tag name cannot be reused. It applies to releases published after it is turned on.

**3. The `release` environment.** Repository → Settings → Environments → New environment → Name `release` → Configure environment.

- Deployment protection rules: check **Required reviewers**, add the owner, leave **Prevent self-review** unchecked (one maintainer approves their own release), then Save protection rules.
- Deployment branches and tags: choose **Selected branches and tags** → Add deployment branch or tag rule → Ref type Branch, name pattern `main` → Add rule.

Only the workflow's `release` job uses the environment. The by-hand `tagged` job runs on a tag push and does not, so the `main`-only rule does not stop it.
