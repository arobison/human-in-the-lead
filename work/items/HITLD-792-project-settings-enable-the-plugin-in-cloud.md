---
id: HITLD-792
title: Project settings enable the plugin in cloud executor sessions, and a fresh cloud session proves the guard runs
kind: work
state: in-progress
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c1]
claimed_by: D-01M8157D3BBKPMS2
---

## Why

Found by the HITLD-781 executor on 2026-11-22: the plugin's hooks, including the executor guard, do not run in cloud executor sessions, so `git push origin HEAD` was allowed in one. Every executor session started in the cloud so far has been unguarded and unmetered. The owner decided (HITLD-790) to enable the plugin in those sessions and to verify it. HITLD-781 made the guard recognize an executor by its checkout; this item makes the guard run at all.

## Done when

- The repository's project settings enable the plugin from this repository's marketplace so that a cloud session started on the repository loads its hooks; how this is done is found out first (the documentation for cloud sessions and project settings) and recorded in the item.
- A fresh cloud session on a claim branch is started and a command the executor guard denies (for example `git push origin main`) is attempted in it: the denial is the proof the guard runs, and the result is recorded in the item without printing the environment.
- The same session shows the budget hook of HITLD-782 can run there, or the item records what is missing.
- A settings or guard change reaches main only with the owner's own yes. `hitld work check` passes.

## How it is done (found out first)

Read on 2026-11-22 from the Claude Code documentation (the cloud environments page, "What carries over from your setup"; the plugin loading reference, "Plugins shared through a repository"): a cloud session **does not install** the plugins a repository's `.claude/settings.json` turns on under `enabledPlugins`. Nor does it add the marketplaces that file lists under `extraKnownMarketplaces`, because that needs the workspace trust dialog, which a cloud session never shows. [Certain] The same table says the repository's `.claude/settings.json` **hooks do run** in a cloud session with one repository, and the hooks reference says `CLAUDE_CODE_REMOTE` is `"true"` there.

So the plugin cannot be enabled from this repository's marketplace in the cloud, and the committed settings run the plugin's own hooks instead:

- `.claude/settings.json` has one hook for each event in `plugins/human-in-the-lead/hooks/hooks.json`, with the same matchers and timeouts. Each starts with `[ "$CLAUDE_CODE_REMOTE" = true ] || exit 0`, so outside the cloud it does nothing. A local session loads the installed plugin, so it does not run each hook twice. The file declares no marketplace and enables no plugin: the cloud would ignore those entries, and locally they could clash with the owner's own registration of the same marketplace name.
- At SessionStart, `scripts/cloud-plugin-start.mjs` copies the committed plugin (`git archive HEAD`) to `~/.claude/human-in-the-lead-cloud`, outside the checkout. It then runs the plugin's SessionStart hooks from that copy with `CLAUDE_PLUGIN_ROOT` set, which also puts `hitld` on the session's PATH. The other hooks run the copy too, so a later edit to an executor's checkout does not change the guard that is running. An installed plugin's cached copy behaves the same way.
- When the copy is missing (the settings reached a session that had already started, through a pull or a checkout), a hook makes the copy first. If it still cannot, the PreToolUse hook refuses the tool call (exit 2), so the guard fails closed. The other events' hooks exit 1, which does not block, so a Stop is never refused forever.
- `core/test/cloud-plugin.test.mjs` checks four things: the settings match the plugin's `hooks.json`; every hook does nothing outside the cloud; in the cloud, the guard denies an executor's push to main through the settings; and the PreToolUse hook refuses the tool call when no copy can be made.

Only the hooks come this way: a cloud session does not load the plugin's skills and agents.

## Found while doing it

- **Project hooks reach a running session at once.** When this item's executor wrote the settings file, Claude Code loaded its hooks into the session that was already running. That session had no copy yet, and the first version refused rather than making one, so every tool call was refused. The session came back only when it resumed and its SessionStart hook made the copy. The lazy copy above is the fix: a session that pulls the file mid-session is guarded, not locked out.
- **The same goes the other way.** An executor can change its own hooks mid-session in two ways: by editing `.claude/settings.json`, or by deleting the copy after committing an edited guard. The guard today checks only Bash commands. Closing that is a guard change, raised in this dispatch's report as a question.

## Verified in a fresh cloud session

On 2026-11-22 this item's executor pushed its claim branch, with the claim commit and the change, and started a new cloud session on it with `create_session`, in the same environment and with no other set-up. That session ran only a probe and changed nothing. From its own transcript (nothing from its environment was printed):

- **The settings hooks ran, the plugin did not install.** At startup the session reported `human-in-the-lead 0.1.0-rc.1 loaded from` the copy under `~/.claude`. Its init record lists the hooks as coming from the project settings, and it lists no human-in-the-lead plugin, as the documentation says.
- **The guard runs and knows the executor by its checkout.** `git push --dry-run origin main` was refused by the PreToolUse hook: "executors push only their own claim branch, alone: …; never main, another branch, or with force". The dry run was chosen so that nothing would be pushed even if the guard had not run. A shell command naming `hitld` was refused too ("executors run only the hitld commands for claiming, closing, reading and checking"), and the report check on Stop held the probe's last message to the fixed report shape.
- **The budget hook can run there but has nothing to read.** Its reading (`readBudget` from the copy, run in that session) was `null`, and the session's private store held 0 ledger events. The hook finds no ledger entry for the dispatch, so nothing is enforced. What is missing: the cloud container's private store does not hold the dispatch's `dispatched` event and start estimate, because the SessionStart store pull skips executors and a fresh container starts with an empty store. Until a cloud executor's store holds its dispatch, the reconcile pass (HITLD-780) is the only budget check for cloud executors.

The executor's own session showed the same once it resumed: the guard refused its dry-run push to main and let its own claim branch be pushed (HITLD-791).

Not verified: the SessionEnd store push and the PostToolUse progress hook's output at the cap, since neither has anything to act on without a ledger entry.
