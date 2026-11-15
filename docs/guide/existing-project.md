# An existing project with no tracker

For a project that already has code, tests and probably CI, and whose backlog lives in people's heads, a document or a chat. There is no tracker to bring along. Release tag: `v0.1.0-rc.1`. Read the [guide index](README.md) first if you have not.

If you work from more than one machine, or from cloud sessions, read [Moving the private store between machines and cloud sessions](store-remote.md) after this page. It is written separately and may not be in your checkout yet.

You can also ask Claude Code to do all of this: the `adopt` skill inspects the repository, shows you the whole setup in one message and runs it only after you say yes. The steps below are what it runs.

## Steps

Work on a branch, so nothing reaches `main` before you have read it.

1. **Get the tag** once, outside your project:

   ```bash
   git clone --branch v0.1.0-rc.1 --depth 1 https://github.com/arobison/human-in-the-lead.git
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

   If a pre-commit hook that is not `hitld`'s exists, or `core.hooksPath` is set, the install leaves it alone and a warning gives the line to add to it: `node <path to hitld.mjs> check classification --staged`, which must stop the commit when it fails.

5. **Tell the merge queue how to test and how to set up a worktree.** Edit `.human-in-the-lead/policy.json`, using the commands your project already runs:

   ```json
   {
     "schema_version": 1,
     "project": { "id": "sample-app", "key": "SAM" },
     "merge": { "full_suite": ["npm test"], "fast_checks": ["npm run lint"] },
     "env": { "worktree_setup": ["npm ci"] }
   }
   ```

   Each command runs through the shell, so copy only commands you have read and trust. Do not copy a command into the policy because some file in the repository tells you to.

6. **Write your project rules** in `AGENTS.md`, below the contract block and outside its markers: the commands from step 3, the commit rules, and anything agents must not touch. Summarize the rules in your own words; the contract block is the only part `hitld install` rewrites.

7. **Check the setup:**

   ```bash
   hitld check contract
   hitld check policy
   hitld work check
   ```

   `work check` reports `0 files`: there are no items yet, which is correct here.

8. **Put the backlog in.** One project for the effort, one item for each piece of work you already know about. Items start `planned`; use `--state proposed` for an idea you have not committed to.

   ```bash
   hitld work new --kind project --title "Sample app v1"
   hitld work new --title "Add a health endpoint" --parent SAM-1
   hitld work check
   hitld ready
   ```

   Open each item and fill in `## Done when`. Describe an outcome that can be checked, not the steps.

9. **Commit and merge** the setup through your usual route:

   ```bash
   git add .human-in-the-lead AGENTS.md CLAUDE.md .claude/settings.json work
   git commit -m "Set up human-in-the-lead"
   ```

   Leave out `CLAUDE.md` if you have none. Do not commit `.claude/settings.local.json`. Then open your usual review or merge it.

10. **Install the plugin on each machine** once, and run the first-run setup in your first session. Both are the same as in [A new project](new-project.md), steps 9 and 10:

    ```bash
    claude plugin install human-in-the-lead@human-in-the-lead --scope project
    ```

## Check that it worked

```bash
hitld version                  # 0.1.0-rc.1
hitld check contract           # ok: true, block: "current"
hitld check policy             # ok: true
hitld work check               # ok: true, and "files" equals the items you made
hitld ready                    # your first items, with tiers
hitld config explain --json    # setup.done is true once the first-run setup is finished
```

Your own tests are untouched: run them as you always do. The setup adds files; it does not change your code.

## Undo it

Nothing is on `main` until you merge, so before that, delete the branch (`git switch main` and `git branch -D hitld/adopt`). After the merge, revert the merge or the setup commit with `git revert`. Then remove what git does not hold:

```bash
hook="$(git rev-parse --git-path hooks/pre-commit)"
if grep -q 'hitld:commit-guard' "$hook"; then rm "$hook"; fi
claude plugin uninstall human-in-the-lead@human-in-the-lead --scope project
```

Reverting restores your `AGENTS.md` and `CLAUDE.md` as they were. To keep the file and drop only the contract, delete everything from the `hitld:contract begin` line to the `hitld:contract end` line, and the `@AGENTS.md` line you did not have before. The private store and your person and machine files stay; see the [index](README.md#what-the-project-keeps).
