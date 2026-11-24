# A new project

For a project that starts now: an empty or nearly empty repository, and no tracker to bring along. Release tag: `v0.1.0-rc.1`. Read the [guide index](README.md) first if you have not: it says what `hitld` stands for in the commands below and what `hitld install` writes.

If you work from more than one machine, or from cloud sessions, read [Moving the private store between machines and cloud sessions](store-remote.md) after this page.

## Steps

1. **Get the release bundle** once, outside your project (skip this if you did it for another project; see [Before any of them](README.md#before-any-of-them)):

   ```bash
   mkdir hitld-v0.1.0-rc.1
   curl -fsSL https://github.com/arobison/human-in-the-lead/releases/download/v0.1.0-rc.1/human-in-the-lead-plugin-v0.1.0-rc.1.tgz | tar -xz -C hitld-v0.1.0-rc.1
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

   `full_suite` runs once per batch of finished work. `fast_checks` run on each branch first (a linter, a type check). `worktree_setup` runs in every fresh worktree an agent works in (install from the lockfile). `npm ci` needs a committed `package-lock.json` and fails without one, which a new project often lacks: commit the lockfile (run `npm install` once, then commit `package-lock.json`), or until you do, write `"worktree_setup": ["npm install --no-package-lock"]`, which installs without reading or writing one. When a setup command fails, `hitld dispatch start` names it with the end of its output and removes the worktree and branch it made; `hitld env status` holds the whole output. Each command runs through the shell, so write only commands you trust. A new project starts in owner merge mode (`merge.mode` is `owner`): the queue checks each finished branch and asks you before it merges.

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

10. **Start your first session.** Open Claude Code in the project and ask it to start a run (the `orchestrate` skill). Before anything else it does the first-run setup, because your person file and this machine's file do not exist yet: it detects the machine, shows every proposed value in one numbered message, and waits. Reply `yes to all`, or `change N to X` for any number of values. It then asks, as a separate question, whether to install the status-line usage capture; that one is always its own question. With a store remote, your answers also go in the project's private store once `hitld store push` carries them, so a new cloud session reads them and does not ask again (the person file's store addresses stay on this machine).

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

Until the first-run setup is done, `hitld dispatch plan` holds all autonomous work, and only work you start by hand (`hitld dispatch start <ID> --by-hand`) runs. The orchestrate skill runs that command for you; to run it from a shell yourself, follow [Drive one item by hand](#drive-one-item-by-hand-without-claude-code).

## Quotas: why dispatch stops at first

The quota gate lets autonomous work start only while each limit it watches has a reading with room above your reserve. A limit with no reading stops dispatch; the gate fails closed.

At `v0.1.0-rc.1` the gate watches two limits by default, both in percent of your Claude plan and both read from the status-line usage capture:

- `claude-five-hour`, the five-hour window;
- `claude-weekly`, the weekly window.

The reserve, the share of each limit kept for your own use, is 25%. Until the capture is on, neither limit has a reading, and the gate stops on `claude-five-hour`, the first in the list. At rc.1 the reason reads `stop at the reserve: claude-five-hour: its use, limit or headroom is unknown or not a number (no snapshot yet, and the ledger cannot estimate this unit)`. Nothing has reached the reserve: the limit has no reading yet.

Some plans have a five-hour window (Pro, Max, and seat-based Team and Enterprise plans, per their documentation); Ultra and usage-based plans do not. On a plan without one, or on a Team or Enterprise seat whose status line does not report it, `claude-five-hour` never gets a reading at rc.1, and the gate stays stopped even with the capture on. Declare your limits instead.

You have two ways out:

1. **Install the capture** (`hitld install --statusline`, your choice). It works when your status line reports both windows.
2. **Declare your limits** in your person file. Your list replaces the default list. At rc.1 a limit in percent of your plan gets a reading only from the capture, so declare one that the ledger can read: a budget of tokens per week for autonomous work, counted from what HITLd's own dispatches report. `--merge` keeps the rest of your person file; `--check` first validates it and writes nothing:

   ```bash
   hitld config write person --merge --check --data '{"schema_version":1,"quota":{"limits":[{"id":"weekly-tokens","unit":"tokens","window":"weekly","limit":20000000,"source":"estimated","hard":false}]}}'
   hitld config write person --merge --data '{"schema_version":1,"quota":{"limits":[{"id":"weekly-tokens","unit":"tokens","window":"weekly","limit":20000000,"source":"estimated","hard":false}]}}'
   ```

   Every limit needs all six keys: `id`, `unit` (`tokens`, `requests`, `usd`, `credits` or `plan-percent`), `window` (`rolling_5h`, `weekly`, `monthly_utc`, `run`, or a period such as `P14D`), `limit`, `source` (`measured`, `estimated` or `declared`) and `hard`. Choose the `limit` figure yourself: it is what autonomous work may spend in the window, not your plan's limit. This budget does not see your own interactive use, so it does not protect your plan's windows. `hitld quota status` then returns `"mode": "normal"`, with `weekly-tokens` in `quotas` at `"used": 0`. The full schema is in [design 12.5](../design/0001-human-in-the-lead/12-reporting-and-limits.md#125-quotas-and-budgets).

**After rc.1.** These are true on `main`, not in `v0.1.0-rc.1`:

- The default list is `claude-weekly` alone. The gate adds `claude-five-hour` while your status line reports a five-hour window that has not reset, unless you declare a limit on the `rolling_5h` window. With no reading, the gate stops on `claude-weekly`.
- The default reserve is 10%.
- With no reading, the gate's reason reads `no reading yet: claude-weekly has no usage reading (…)`, not `stop at the reserve`.
- `hitld quota declare --used <figure> --resets-at <reset> [--limit <ID>]` records a usage figure you read on your own account, so a limit in percent of your plan has a reading without the capture, such as in a cloud session.
- The declared-limit example above works unchanged.

## Drive one item by hand, without Claude Code

In a Claude Code session, the orchestrate skill runs every command below for you, and an executor does the item. To take one item from planned to merged from a shell, with no Claude Code session, you play both parts: you run the commands, and you do the item's work yourself.

Before you start, the quota gate needs a reading. `--by-hand` gets past an unfinished first-run setup, not the gate: without the status-line capture, declare a limit the ledger can read, as in way 2 of [Quotas](#quotas-why-dispatch-stops-at-first).

Run these in order. Run the `run`, `dispatch` and `merge` commands from the checkout you ran `hitld run start` in.

```bash
hitld run start
hitld dispatch plan
hitld dispatch start <ID> --by-hand
hitld dispatch handle --dispatch <D-n> --harness-ref by-hand
git switch -c <branch>
hitld work claim <ID> --dispatch <D-n> --branch <branch>
# make the change, run your tests, commit with the trailers Work-Item: <ID> and Dispatch: <D-n>
hitld work close <ID> --report-file <report>
git switch main
hitld dispatch complete --dispatch <D-n> --report-file <report> --tokens 0
hitld merge
hitld merge --all
```

What each one does, and what to take from its output:

1. **`hitld run start`** records the run and takes the lease. With no Claude Code session and no `HITLD_SESSION`, it makes a session ID for this checkout and remembers it (`identity.source` is `new`), so the later commands need no `--session`. Set `HITLD_SESSION` or pass `--session` only to choose the ID yourself.
2. **`hitld dispatch plan`** shows what is ready and what is held, with the reason. Before the setup is done it holds everything; that is expected. It records nothing, so you may skip it.
3. **`hitld dispatch start <ID> --by-hand`** records the dispatch. Take `dispatch` (the `D-<n>` ID) and `branch` from its output. Its `instruction` is a Claude Code tool call that an orchestrator would make to start an executor: do not make it, since you do the work. `brief_file` is the brief that executor would read. If the output has a `worktree`, the branch is already checked out in that folder: work there instead of running `git switch -c`.
4. **`hitld dispatch handle`** records who runs the dispatch. `by-hand` is the reference; any word that names it for you works.
5. **The work**, on the branch. `hitld work claim` writes the claim commit, which must be the branch's first. Then make and commit the change. `hitld work close` sets the item to `done` and commits it with your report as the message. Write the report first, in the fixed shape of the executor contract in `AGENTS.md` (`item`, `result`, `commit`, `evidence`, `bench_runs`, `deviations`, `calls`, `questions`), with the hash of your last work commit on the `commit` line. Keep the report file outside the repository.
6. **`hitld dispatch complete`** checks the report and queues the branch to merge (`queued_to_merge`). `--tokens` is what the dispatch cost in model tokens, which the quota counts: `0` when no model did the work, or the figure your tool reports.
7. **`hitld merge`**. A new project is in owner merge mode: this checks the branch (rebase, fast checks, full suite) without moving `main` and lists it under `presented` with the evidence. Read it, then **`hitld merge --all`** merges what was presented, or `hitld merge --only <branch>` merges just that one. In queue mode, plain `hitld merge` merges and there is no second step. With `merge.via` set to `pull-request`, the merge goes through pull requests, which this section does not cover.

After rc.1, `hitld dispatch --help`, `hitld run --help` and `hitld work --help` list each group's commands, and `hitld <command> --help` gives a command's options.

## Undo it

Everything the install changed in the repository is in your setup commit, so undo it with git:

```bash
git revert <the setup commit>
```

Then remove the two things git does not hold:

```bash
# the commit guard, only if it is hitld's
for name in pre-commit commit-msg; do
  hook="$(git rev-parse --git-path "hooks/$name")"
  if grep -q 'hitld:commit-guard' "$hook"; then rm "$hook"; fi
done

# the plugin, on each machine that installed it
claude plugin uninstall human-in-the-lead@human-in-the-lead --scope project
```

The private store (`~/.local/share/human-in-the-lead/<project ID>/`; on Windows `%LOCALAPPDATA%\human-in-the-lead\<project ID>\`; under `$XDG_DATA_HOME` where set) and your person and machine files stay: other projects use the second, and the first is your record. Delete the store directory only if you want the ledger gone for good.

To upgrade later, run `hitld install` again from the new release's bundle with its `--ref`, and commit the change to `.claude/settings.json` and `AGENTS.md`. Rolling back is reverting that commit.
