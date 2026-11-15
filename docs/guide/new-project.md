# A new project

For a project that starts now: an empty or nearly empty repository, and no tracker to bring along. Release tag: `v0.1.0-rc.1`. Read the [guide index](README.md) first if you have not: it says what `hitld` stands for in the commands below and what `hitld install` writes.

If you work from more than one machine, or from cloud sessions, read [Moving the private store between machines and cloud sessions](store-remote.md) after this page.

## Steps

1. **Get the tag** once, outside your project (skip this if you did it for another project):

   ```bash
   git clone --branch v0.1.0-rc.1 --depth 1 https://github.com/arobison/human-in-the-lead.git
   ```

2. **Make the repository**, with a first commit:

   ```bash
   mkdir sample-app && cd sample-app
   git init -b main
   git commit --allow-empty -m "Start the project"
   ```

3. **Install into it.** `--key` is the tracker ID key: one to ten capital letters or digits, starting with a letter, and not `SIG`, `P`, `C` or `D`. Items are then `<KEY>-1`, `<KEY>-2` and so on.

   ```bash
   hitld install --key SAM --ref v0.1.0-rc.1 --repo arobison/human-in-the-lead
   ```

   The result lists what it did, any warnings, and the commands to run next. The project ID, in `policy.json`, comes from the directory name; give `--project-id <id>` to choose another (lower-case letters, digits, `.`, `_`, `-`).

4. **Tell the merge queue how to test.** Open `.human-in-the-lead/policy.json` and add the commands your project runs. The merge queue will not move `main` without a full suite:

   ```json
   {
     "schema_version": 1,
     "project": { "id": "sample-app", "key": "SAM" },
     "merge": { "full_suite": ["npm test"], "fast_checks": [] },
     "env": { "worktree_setup": ["npm ci"] }
   }
   ```

   `full_suite` runs once per batch of finished work. `fast_checks` run on each branch first (a linter, a type check). `worktree_setup` runs in every fresh worktree an agent works in (install from the lockfile). Each command runs through the shell, so write only commands you trust. A new project starts in owner merge mode (`merge.mode` is `owner`): the queue checks each finished branch and asks you before it merges.

5. **Write your project rules** in `AGENTS.md`, below the contract block and outside its markers: the test, lint and format commands, commit rules (a sign-off line, required trailers), and anything agents must not touch. A few lines are enough.

6. **Check the setup:**

   ```bash
   hitld check contract
   hitld check policy
   hitld work check
   ```

7. **Add your first project and items.** A project groups items; every item needs one. Items start `planned`, which means committed. Use `--state proposed` for an idea you have not committed to.

   ```bash
   hitld work new --kind project --title "Sample app v1"
   hitld work new --title "Add a health endpoint" --parent SAM-1
   hitld work check
   hitld ready
   ```

   `hitld work new` writes `work/projects/SAM-1-sample-app-v1.md` and `work/items/SAM-2-add-a-health-endpoint.md`. Open the item and fill in its `## Done when` section: that is what an agent works to. `hitld ready` lists the items that can start, with a size tier for each.

8. **Commit** these files:

   - `.human-in-the-lead/policy.json`
   - `AGENTS.md` (and `CLAUDE.md`, if you have one)
   - `.claude/settings.json`
   - `work/`

   ```bash
   git add .human-in-the-lead AGENTS.md .claude/settings.json work
   git commit -m "Set up human-in-the-lead"
   ```

   Do not commit `.claude/settings.local.json` (the install adds it to `.gitignore` when you ask for the status line).

9. **Install the plugin on this machine.** The committed settings turn the plugin on but do not download it. Every machine that works on the project does this once:

   ```bash
   claude plugin install human-in-the-lead@human-in-the-lead --scope project
   ```

10. **Start your first session.** Open Claude Code in the project and ask it to start a run (the `orchestrate` skill). Before anything else it does the first-run setup, because your person file and this machine's file do not exist yet: it detects the machine, shows every proposed value in one numbered message, and waits. Reply `yes to all`, or `change N to X` for any number of values. It then asks, as a separate question, whether to install the status-line usage capture; that one is always its own question.

    Without Claude Code, you can write the two files yourself:

    ```bash
    hitld machine detect
    hitld config write person --data '{"schema_version":1,"max_executors":2}'
    hitld config write machine --data '{"schema_version":1,"kind":"workstation","max_executors":2,"cores":4,"memory_ceiling_mb":8192}'
    ```

    `machine detect` writes nothing; take the values for the second command from its `proposed` field. These files are yours, not the project's: never commit them.

## Check that it worked

```bash
hitld version                  # 0.1.0-rc.1
hitld check contract           # ok: true, block: "current"
hitld check policy             # ok: true
hitld work check               # ok: true, and "files" equals the items you made
hitld config explain --json    # setup.done is true once step 10 is finished
claude plugin list             # human-in-the-lead@human-in-the-lead is installed
```

`hitld work check` reports `0 files` when it finds no items. In a project that has items, that means it is looking in the wrong folder, not that all is well.

Until the first-run setup is done, `hitld dispatch plan` holds all autonomous work, and only work you start by hand (`hitld dispatch start <ID> --by-hand`) runs. Until the status-line capture is on, the default quotas (your plan's five-hour and weekly windows) have no readings, and dispatch stops at the quota gate. Either install the capture (`hitld install --statusline`, your choice) or declare limits as described in [design 12.5](../design/0001-human-in-the-lead/12-reporting-and-limits.md#125-quotas-and-budgets).

## Undo it

Everything the install changed in the repository is in your setup commit, so undo it with git:

```bash
git revert <the setup commit>
```

Then remove the two things git does not hold:

```bash
# the commit guard, only if it is hitld's
hook="$(git rev-parse --git-path hooks/pre-commit)"
if grep -q 'hitld:commit-guard' "$hook"; then rm "$hook"; fi

# the plugin, on each machine that installed it
claude plugin uninstall human-in-the-lead@human-in-the-lead --scope project
```

The private store (`~/.local/share/human-in-the-lead/<project ID>/`) and your person and machine files stay: other projects use the second, and the first is your record. Delete the store directory only if you want the ledger gone for good.

To upgrade later, run `hitld install` again from the new tag's clone with its `--ref`, and commit the change to `.claude/settings.json` and `AGENTS.md`. Rolling back is reverting that commit.
