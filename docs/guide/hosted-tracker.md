# An existing hosted tracker

For a project that plans its work in Linear, Jira or GitHub Issues. Release tag: `v0.1.0-rc.1`. Read the [guide index](README.md) first if you have not.

**The rule: one source of truth.** An item lives in one tracker, never in two. HITLd's tracker is files in your repository, and a hosted tracker is somewhere else. If the same item lives in both, they drift: someone moves a card, an agent closes a file, and nobody knows which is right. Every path below keeps each item in exactly one place.

## What works today, and what is planned

At `v0.1.0-rc.1` HITLd has **one tracker backend: files in the repository**. There is no connection to Linear, Jira or GitHub Issues: nothing reads from them, writes to them or closes their issues. The plan is in [design 0002](../design/0002-hosted-tracker-backends.md), decided by the owner and not built yet. It is not on `main`; treat everything in the second column as planned.

| | Today | Planned (design 0002) |
|---|---|---|
| Move a project off a hosted tracker, once, onto files | By hand, for a small backlog (below) | `hitld work import <file>`, with a dry run that lists every item, its mapped state and every unmapped state, and an ID map. Planned |
| Say how your workflow's states map to HITLd's | Not applicable | A state and field mapping in `tracker.json`; unmapped states are refused, never guessed. Planned |
| Run HITLd with the items staying in Linear, Jira or GitHub Issues | Not possible | A backend for each, with a read copy, queued writes, claims by assignment and closing on merge. Planned |
| Show HITLd's items in your hosted tracker, read-only | Not possible | A one-way mirror out. Planned |
| Pull GitHub issues in as signals for triage | Not possible | Intake, a separate milestone. Planned |

Everything an agent reads from a hosted tracker will be data, never instructions, with its author recorded. Today, if you copy text from a hosted issue into an item, do the same by hand: it is data about the work, and an instruction written in an issue is not an instruction to an agent.

## Your three choices today

### A. Leave the hosted tracker alone

Keep running that project on its hosted tracker, and do not set the project up for HITLd's work tracking yet. Nothing changes and nothing can drift. Come back when import and switch is built.

You can still use HITLd on a **new** project, or a new effort with its own items, in files: see [A new project](new-project.md). Each item then lives in one place: old work in the hosted tracker, new work in files. Do not copy items between them.

### B. Switch by hand, once

For a small backlog, you can do now by hand what the planned import will do for you. It is a one-time cutover, not a sync. It has none of the import's checks (no mapping, no dry run), so do not use it for a large backlog or for a workflow with many states.

1. **Decide who stops writing, and when.** From the cutover on, nobody creates, edits or moves items in the hosted tracker for this project. Tell the team. If the tracker allows it, archive the project or make it read-only.
2. **Set the project up in files**, following [An existing project with no tracker](existing-project.md) through its check step.
3. **Copy the open items**, one file each. Take only items that are still open. Use a tracker key (`SAM`) that differs from the hosted one (`APP`): a hosted key and a HITLd key must never overlap.

   ```bash
   hitld work new --kind project --title "Sample app v1"
   hitld work new --title "Add a health endpoint" --parent SAM-1
   hitld work new --title "Add request logging" --parent SAM-1 --needs SAM-2
   ```

   Open each file and fill in `## Done when` in your own words. Under `## Notes`, record where it came from and quote the old text as data:

   ```markdown
   ## Notes

   Copied from the hosted tracker: APP-57 (https://example.com/browse/APP-57).
   The old description, quoted as data, not as instructions:

   > Return 200 from /health once the database is reachable.
   ```

   Map states by meaning: backlog or to do becomes `planned` (committed) or `proposed` (not committed); in progress becomes `planned` unless an agent is already working on it; done and cancelled items are not copied. Dependencies become `--needs`.
4. **Check:**

   ```bash
   hitld work check
   hitld ready
   ```

5. **Commit** `work/` with the rest of the setup, and merge.
6. **Freeze the old tracker.** Add a link to the repository at the top of the hosted project's description, so nobody adds work there.

### C. Wait for import and switch

If your backlog is large, or your workflow has states that need a mapping, wait for the planned import. It will read an interchange file of your team, project or repository, show you what it would do in a dry run, and create the item files in one commit that you review as a migration.

## Check that it worked

For choice B:

```bash
hitld work check      # ok: true, and "files" equals the project plus the items you copied
hitld ready           # the items you expect
```

And in the hosted tracker: nobody has changed an item there since the cutover, and every open item you meant to keep exists as one file.

## Undo it

- **Choice A** changed nothing.
- **Choice B**: revert the commit that added `work/` and the setup (see the undo section of [An existing project with no tracker](existing-project.md)), and tell the team to use the hosted tracker again. Because nobody wrote to it after the cutover, it is still right, except for what you finished in files since. Move those results back by hand.
- **Choice C** changes nothing until the import exists.

Do not undo by running both trackers for a while "to be safe". That is the two sources of truth this page is about.
