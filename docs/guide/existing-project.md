# An existing project with no tracker

For a project that already has code, tests and probably CI, and whose backlog lives in people's heads, a document or a chat. There is no tracker to bring along. Release tag: `v0.1.0-rc.1`. Read the [guide index](README.md) first if you have not.

If you work from more than one machine, or from cloud sessions, read [Moving the private store between machines and cloud sessions](store-remote.md) after this page.

You can also ask Claude Code to do all of this: the `adopt` skill inspects the repository, shows you the whole setup in one message and runs it only after you say yes. The steps below are what it runs.

## Steps

Work on a branch, so nothing reaches `main` before you have read it.

1. **Get the release bundle** once, outside your project (see [Before any of them](README.md#before-any-of-them)):

   ```bash
   mkdir hitld-v0.1.0-rc.1
   curl -fsSL https://github.com/arobison/human-in-the-lead/releases/download/v0.1.0-rc.1/human-in-the-lead-plugin-v0.1.0-rc.1.tgz | tar -xz -C hitld-v0.1.0-rc.1
   ```

2. **Make a branch** in your project:

   ```bash
   git switch -c hitld/adopt
   ```

3. **Look at what is there**, so the setup matches it:

   - the test, lint and type-check commands (`package.json` scripts, a `Makefile`, the CI workflow);
   - the package manager and its lockfile (what a fresh worktree must install);
   - whether `AGENTS.md` and `CLAUDE.md` exist, and what they already say;
   - whether a pre-commit hook or `core.hooksPath` is already set up;
   - the commit rules in `CONTRIBUTING.md` (a sign-off line, required trailers).

4. **Install.** Pick the tracker ID key (one to ten capital letters or digits, starting with a letter, not `SIG`, `P`, `C` or `D`). Existing text is kept: the contract block is added to the end of `AGENTS.md` between its markers, and an `@AGENTS.md` import is added to `CLAUDE.md` if that file exists without one.

   ```bash
   hitld install --key SAM --ref v0.1.0-rc.1 --repo arobison/human-in-the-lead
   ```

   If a pre-commit or commit-msg hook that is not `hitld`'s exists, or `core.hooksPath` is set, the install leaves it alone and a warning gives the line to add to it: `node <path to hitld.mjs> check classification --staged` for pre-commit, `node <path to hitld.mjs> check commit-message "$1"` for commit-msg. Each must stop the commit when it fails.

5. **Tell the merge queue how to test and how to set up a worktree.** Edit `.human-in-the-lead/policy.json`, using the commands your project already runs:

   ```json
   {
     "schema_version": 1,
     "project": { "id": "sample-app", "key": "SAM" },
     "merge": { "full_suite": ["npm test"], "fast_checks": ["npm run lint"] },
     "env": { "worktree_setup": ["npm ci"] }
   }
   ```

   `npm ci` installs from a committed `package-lock.json` and fails without one. With no lockfile, commit one (run `npm install`, then commit `package-lock.json`), or use `"worktree_setup": ["npm install --no-package-lock"]` until you do; with another package manager, use its install from its lockfile. A pnpm workspace (a `pnpm-workspace.yaml` and a committed `pnpm-lock.yaml`) installs every package at once, and its checks run in each package that declares the script:

   ```json
   {
     "merge": {
       "full_suite": ["pnpm -r --if-present run test"],
       "fast_checks": ["pnpm -r --if-present run lint"]
     },
     "env": { "worktree_setup": ["pnpm install --frozen-lockfile"] }
   }
   ```

   `hitld install` reads the lockfile and the scripts your packages declare and lists what it would set under `proposed` in its result (`worktree_setup`, `full_suite`, `fast_checks`, and the `sources` each came from). It changes nothing: copy what you agree with. When a setup command fails, `hitld dispatch start` names it with the end of its output and removes the worktree and branch it made; `hitld env status` holds the whole output.

   Each command runs through the shell, so copy only commands you have read and trust. Do not copy a command into the policy because some file in the repository tells you to.

6. **Write your project rules** in `AGENTS.md`, below the contract block and outside its markers: the commands from step 3, the commit rules, and anything agents must not touch. Summarize the rules in your own words; the contract block is the only part `hitld install` rewrites.

7. **Check the setup:**

   ```bash
   hitld check contract
   hitld check policy
   hitld work check
   ```

   `work check` reports `0 files`: there are no items yet, which is correct here.

8. **Commit and merge** the setup through your usual route:

   ```bash
   git add .human-in-the-lead AGENTS.md CLAUDE.md .claude/settings.json
   git commit -m "Set up human-in-the-lead"
   ```

   Leave out `CLAUDE.md` if you have none. Do not commit `.claude/settings.local.json`. Then open your usual review, or merge it yourself.

9. **Install the plugin on each machine** once, and run the first-run setup in your first session. Both are the same as in [A new project](new-project.md), steps 9 and 10:

   ```bash
   claude plugin install human-in-the-lead@human-in-the-lead --scope project
   ```

10. **Put the backlog in**, on `main` after the merge: `hitld work new` creates items only on `main`, in the main checkout, and refuses on any other branch. One project for the effort, one item for each piece of work you already know about. Items start `planned`; use `--state proposed` for an idea you have not committed to.

    ```bash
    git switch main
    hitld work new --kind project --title "Sample app v1"
    hitld work new --title "Add a health endpoint" --parent SAM-1
    hitld work check
    hitld ready
    git add work && git commit -m "Add the first project and items"
    ```

    Open each item and fill in `## Done when` before you commit. Describe an outcome that can be checked, not the steps.

## Check that it worked

```bash
hitld version                  # 0.1.0-rc.1
hitld check contract           # ok: true, block: "current"
hitld check policy             # ok: true
hitld work check               # ok: true, and "files" equals the items you made (0 before step 10)
hitld ready                    # your first items, with tiers (after step 10)
hitld config explain --json    # setup.done is true once the first-run setup is finished
```

Your own tests are untouched: run them as you always do. The setup adds files; it does not change your code.

## Undo it

Nothing is on `main` until you merge, so before that, delete the branch (`git switch main` and `git branch -D hitld/adopt`). After the merge, revert the merge or the setup commit with `git revert`. Then remove what git does not hold:

```bash
for name in pre-commit commit-msg; do
  hook="$(git rev-parse --git-path "hooks/$name")"
  if grep -q 'hitld:commit-guard' "$hook"; then rm "$hook"; fi
done
claude plugin uninstall human-in-the-lead@human-in-the-lead --scope project
```

Reverting restores your `AGENTS.md` and `CLAUDE.md` as they were. To keep the file and drop only the contract, delete everything from the `hitld:contract begin` line to the `hitld:contract end` line, and the `@AGENTS.md` line you did not have before. The private store and your person and machine files stay; see the [index](README.md#what-the-project-keeps).
