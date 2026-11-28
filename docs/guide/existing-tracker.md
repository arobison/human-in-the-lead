# An existing in-repo tracker

For a project that already tracks its work in the repository: one file per item, global IDs of the form `<KEY>-<n>`, scripts that create items and generate views, and a section about the tracker in `AGENTS.md`. Release tag: `v0.1.0-rc.1`. Read the [guide index](README.md) first if you have not.

HITLd's files backend takes that format as it is. The key and every path are settings, and the file format, lifecycle, claim convention and views are the same, so your items need **no conversion**. You move over in four steps, each depending on the one before. The project's own scripts win wherever they disagree with `hitld`, until you decide otherwise.

If you work from more than one machine, or from cloud sessions, read [Moving the private store between machines and cloud sessions](store-remote.md) after this page.

You can also ask Claude Code to do the setup: the `adopt` skill inspects the repository, shows you the whole plan in one message and runs it only after you say yes. It stops before step 4 (the switch), which is your decision.

## What a compatible item looks like

```markdown
---
id: APP-3
title: Add request logging
kind: work
state: planned
created: 2026-10-03
project: APP-1
needs: [APP-2]
---

## Done when

- Each request is logged with its status.
```

- `state` is one of `proposed`, `planned`, `in-progress`, `done`, `dropped`. `kind` is `work`, `decision`, `external`, `project` or `milestone`. Items live in an items folder, projects and milestones in their own.
- Other keys the format knows are `needs`, `area`, `touches`, `classification` and a few more; a project may also declare keys of its own (step 1).
- A file that does not fit is named by `hitld work check`, with the reason. You fix the file or declare the key; `hitld` never rewrites your items to make them fit, except through `hitld work migrate`, which shows a diff first (`--dry-run`).

## Step 1: coexist, read-only

Install nothing yet. Describe your tracker to `hitld` in a scratch directory outside the repository, and compare. This changes no file in your project.

1. **Get the release bundle** once, outside your project (see [Before any of them](README.md#before-any-of-them)):

   ```bash
   mkdir hitld-v0.1.0-rc.1
   curl -fsSL https://github.com/arobison/human-in-the-lead/releases/download/v0.1.0-rc.1/human-in-the-lead-plugin-v0.1.0-rc.1.tgz | tar -xz -C hitld-v0.1.0-rc.1
   ```

2. **Write the two settings files in a scratch directory.** `key` is your tracker ID key. `work_dir` is the folder that holds your item folders (default `work`); name `folders` too if yours are not `items`, `projects` and `milestones`:

   ```bash
   cfg="$(mktemp -d)"
   echo '{"schema_version":1,"project":{"id":"sample-app","key":"APP"}}' > "$cfg/policy.json"
   echo '{"schema_version":1,"work_dir":"tracker"}' > "$cfg/tracker.json"
   ```

3. **Check your data and generate the views into a scratch directory:**

   ```bash
   hitld work check --config "$cfg"
   hitld work views --config "$cfg" --out "$(mktemp -d)"
   hitld work query --ready --config "$cfg"
   ```

   Compare the result with what your own scripts say: the same number of items (`files`), the same items ready, blocked and done. The generated pages are laid out differently from yours, so compare facts, not bytes.

4. **Fix what differs.**
   - `"effort_points" isn't an allowed key for a work`: a key of your own. Declare it in `tracker.json`:

     ```json
     {
       "schema_version": 1,
       "work_dir": "tracker",
       "fields": [
         { "name": "effort_points", "type": "integer", "description": "The old size estimate in points" }
       ]
     }
     ```

     A declared field is kept when `hitld` rewrites a file, and `hitld work query --field effort_points=3` can match it. A key from the format's own list (for example `area` or `estimate_tokens`) goes in `optional_keys` instead; the check says so (`turn it on in .human-in-the-lead/tracker.json optional_keys`). `touches`, `tier_override` and `source_issue` are always on.
   - Files in an older layout: `hitld work migrate --dry-run --config "$cfg"` lists the registered format migrations and the diff each would make. Nothing is written with `--dry-run`.
   - `0 files` when you have items: `work_dir` or `folders` is wrong.
   - Anything else that differs, with data that is plainly valid, is a bug in the backend. Report it (see [Giving feedback](../../README.md#giving-feedback)) and keep working with your scripts until it is fixed.

The step is done when `hitld work check` is clean and its facts match your scripts' on your real data.

## Step 2: the plugin writes, your scripts check

Make a branch and install. Use the same key and paths as the scratch files.

```bash
git switch -c hitld/adopt
hitld install --key APP --ref v0.1.0-rc.1 --repo arobison/human-in-the-lead
```

Then:

1. **Move the scratch settings into the project:** `.human-in-the-lead/policy.json` was written by the install (with your key). Write `.human-in-the-lead/tracker.json` with the content of `$cfg/tracker.json`. Add `"views_dir": "hitld-views"` to it, so the views `hitld` writes do not overwrite the ones your own scripts write: `views_dir` is relative to `work_dir`, and by default both would write `tracker/views/`.
2. **Set the merge commands** in `policy.json` (`merge.full_suite`, `merge.fast_checks`, `env.worktree_setup`), taking them from your CI file and package scripts, as in [An existing project with no tracker](existing-project.md), step 5. Keep your tracker check among the checks: it is the cross-check.
3. **Write your project rules** in `AGENTS.md`, outside the contract markers (test and lint commands, commit rules, what agents must not touch).
4. **Check:**

   ```bash
   hitld work check              # the same file count as step 1
   hitld check policy
   hitld ready
   npm run tracker:check         # your own check, still passing
   ```

5. **Commit** `.human-in-the-lead/`, `.claude/settings.json` and the contract block, and merge:

   ```bash
   git add .human-in-the-lead .claude/settings.json AGENTS.md
   git commit -m "Install human-in-the-lead beside the existing tracker"
   ```

6. **Install the plugin on each machine** and run the first-run setup, as in [A new project](new-project.md), steps 9 and 10.

From now on agents create and claim items with `hitld` (`hitld work new` allocates the next ID after your highest one). **Create items with one tool only**: if people keep using your old creator script, two items can take the same ID. `hitld work check --branches` looks for collisions across branches and worktrees.

## Step 3: the contract

The contract block is already in `AGENTS.md` after the install, but your old tracker section is still there, and two sets of claim and close rules confuse an agent. Edit the file:

1. Read your old tracker section. Move anything that is a rule of your project, not of the tracker (a naming rule, a review rule), into `## Project rules`.
2. Delete the tracker section.
3. `hitld check contract` must pass, and `CLAUDE.md`, if you have one, must import `AGENTS.md`.

Commit it. This is the point where an executor starts to follow one set of rules.

## Step 4: move upstream and delete

Do this only when you decide to. List what your tracker scripts and skills do that `hitld` does not (a report, a custom view, a bot). Report each as feedback or an idea, so it is added upstream, and keep that script until it is. Then delete the rest in one commit: the creator script, the view generator, their tests, the tracker skills, the CI step that runs your check, and `tracker:check`. Keep your data and your settings. Set `views_dir` back to `views` if you want the views where they were, after you delete your generator.

Then, one at a time, as you need them: the orchestrator and ledger, decisions and precedent over any decision items you already have, an evidence source, the adversarial loop on one area, knowledge-base front matter on pages as you next touch them.

## Check that it worked

```bash
hitld version                  # 0.1.0-rc.1
hitld check contract           # ok: true, block: "current"
hitld check policy             # ok: true
hitld work check               # ok: true, "files" equals your items
hitld ready                    # the items you expect, with tiers
hitld work query --state done  # your finished items, unchanged
git diff main -- tracker       # no change to any item file you did not mean to change
```

## Undo it

- **Step 1** wrote nothing in your project. Delete the scratch directory.
- **Steps 2 and 3**: the branch holds all of it. Delete the branch before you merge it, or revert the merge. Then remove the commit guard and the plugin:

  ```bash
  for name in pre-commit commit-msg; do
    hook="$(git rev-parse --git-path "hooks/$name")"
    if grep -q 'hitld:commit-guard' "$hook"; then rm "$hook"; fi
  done
  claude plugin uninstall human-in-the-lead@human-in-the-lead --scope project
  ```

  Your items were never converted, so your own scripts work on them as before. Items that agents created through `hitld` are ordinary files in your format.
- **Step 4**: revert the commit that deleted your scripts; they come back as they were.
