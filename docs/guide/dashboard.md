# Building your own dashboard

For a project that wants a view the built-in page does not give: its own numbers, its own layout, or a page published where the team looks. You build it on `hitld dashboard --json`, which returns the same data the built-in page is drawn from. Release tag: `v0.1.0-rc.1`. Read the [guide index](README.md) first if you have not.

**The built-in page stays.** `hitld dashboard` always writes `dashboard.html` (a static, self-contained page with no script, no server and no network request) and `digest.txt` (the digest on one phone screen). Your own dashboard is an addition. If it breaks, or you stop maintaining it, the built-in page is still there and still right.

## What `hitld dashboard` does

```bash
hitld dashboard                 # write dashboard.html and digest.txt
hitld dashboard --json          # the same, and also return the data
hitld dashboard --json --no-write   # return the data only; write no files
hitld dashboard --out reports   # write them in a directory of your choice
```

- By default the two files go to `reports/` in the project's private store (outside the repository). `--out` takes a directory inside the repository or the private store, and refuses anything else with the error `output-path`. The directory keeps a marker, `.hitld-report.json`, naming the files a report made there, and a later report overwrites only files the marker lists.
- With `--json`, the command's JSON output has the usual `ok`, the paths `html` and `digest`, the dispatch `mode` and the digest `text`, and the data under **`report`**. It still writes the two files: `--json` adds to the output, it does not replace the page. To get the data without writing any file, add `--no-write`: the output then has `ok`, `mode`, `text` and `report`, and no `html` or `digest` path.
- It reads the ledger, the usage snapshots and the quotas for the project, locally. It makes no network request.

## What the data holds

`report` is the dashboard data contract: the one versioned surface HITLD's own page and a project's views read. HITLD's built-in views read only this, so anything the page shows, your view can show too. The schema is [`schemas/dashboard-data.schema.json`](../../schemas/dashboard-data.schema.json). This is the full list at this release:

| Field | Holds |
|---|---|
| `api_version` | The version of this contract: `2` |
| `metrics_schema_version` | The same number, under its name before `api_version`. Kept until the next minor release: read `api_version` |
| `generated_at` | When the report was made, as a timestamp |
| `project` | The project ID |
| `gate` | What the dispatch gate says now: `mode` (`normal`, `economize`, `critical_path_only` or `stop`), `allow_ordinary`, `allow_critical_path`, `reason`, `binding` (the limit that decides, or `null`), `forecast`, `ask_owner`, `refresh` (the limits whose owner-declared usage figure nears the reserve or has grown old, each with why the owner is asked for a fresh one), `unread` |
| `quotas` | One entry for each limit: `id`, `unit`, `window`, `source` (`measured`, `estimated` or `declared`), `hard`, `limit`, `reserve_share`, `reserve`, `used`, `used_from` (`snapshot`, `declared` for an estimate from a figure the owner declared, used only without a fresh measured reading, or `ledger`), `declared` (that figure, its time and the burn carried on from it), `refresh`, `as_of`, `resets_at`, `confidence`, `headroom` (the share of the limit above the reserve, or `null` with no reading), a `forecast` (`burn_per_hour`, `burn_basis`, `burn_band`, `reserve_at`, `reserve_band`, `limit_at`, and `reserve_before_reset`: whether the reserve is reached before the window resets) and `notes` |
| `thresholds` | One line for each limit that has passed a notify level, such as `claude-weekly is past 75% used` |
| `ledger` | Counts from the ledger: `classification` (`internal`), `entries`, `events` (a count for each event kind), `tokens`, `tokens_by_model`, `tokens_by_tier`, `items_merged`, `tokens_per_merged_item` |
| `usage` | The usage snapshots the gate read: `classification` (`internal`), `snapshots` (how many) and `latest` (the latest from each source, with its `rate_limits` or `readings`) |
| `settings` | The settings the page draws with: the quota bar's `economize_below` and `critical_below`, and the plan view's `dashboard_plan_states` and `dashboard_plan_max_items` (`null` where the policy does not set them) |
| `waiting_for_owner` | In owner merge mode, the branches that passed verification and wait for your merge: `item`, `branch`, `result`, `fast_check`, `waiting_since`, `waited_ms` |
| `milestones` | The milestone graph the Roadmap draws: `nodes`, `edges`, `critical_path`, `lanes`, `releases`. `null` without a tracker |
| `work` | The tracker as the work views read it. `null` without a tracker. Below |

`work` holds:

- `read_at` and `source`: when, and at which commit and branch, the tracker was read.
- `fields`: the project's declared fields, as `tracker.json` declares them (`name`, `type`, `list`, `values`, `description`).
- `items`: every work, decision and external item, in ID order: `id`, `kind`, `title`, `state`, `stage` (the state, with `planned` split into `ready` and `blocked`), `project`, `needs`, `open_needs`, `path`, `created`, `critical`, `waiting_on_it`, `decider`, `waiting_on`, `scopes`, `classification`, `owner`, `fields` (the declared fields the item sets, typed as declared: `{ "team": "web", "points": 3 }`) and `redacted`.
- `projects` and `milestones`: each with `id`, `title`, `state`, `classification` and `redacted`; a milestone also has `long_outcome` and `scopes`.
- `critical_path`: the item critical path.
- `claims`: the claimed items, with each claim's `claimant`, `branch`, `ref`, `commit`, `at` and `source` (`local`, `remote` or `bundle`), and `double` when more than one holds it.
- `history`: each entity's committed state changes, oldest first: `at`, `from`, `to`, `commit`.
- `move` and `flow`: the figures of Your move and Flow.

A fresh project with no readings and no ledger gives `gate.mode: "stop"` (no reading of a limit means dispatch stops at the gate), `used: null` for every limit, and zero counts. A value that cannot be known yet is `null`.

## Classification in the data

- Every item, project and milestone carries its `classification`: its own label, or `default_classification` from `tracker.json` when it has none.
- An entity labeled `confidential` or `secret` is in the contract only as a stub with `redacted: true`: its `title` is its ID, and it has no `path`, no `fields`, no `decider` and no `waiting_on`. Its state and the IDs it links to stay, so what waits on it still shows. Nothing confidential is in the contract.
- `ledger` and `usage` come from the private store and are labeled `internal`.

## The versioned contract

- `api_version` is the version of the contract. Read it first, and stop with a clear message when it is a number your code does not know.
- Adding a field keeps the version. Removing, renaming or retyping one raises it. So ignore fields you do not know, and do not depend on the order of fields or of entries.
- Version 2 is the first under `api_version`. From version 1 (`metrics_schema_version: 1`) it renamed the quota forecast's `before_reset` to `reserve_before_reset`, added `api_version`, `usage`, `settings` and the labels, and documents `milestones` and `work`, which version 1 carried without a description.
- Before version 1.0 of HITLd, a minor release may change this output, and the release notes list each change ([design 16.5](../design/0001-human-in-the-lead/16-packaging.md#165-releases-and-compatibility)). Pin your project to a tag, as the rest of the setup does, and read the notes when you upgrade.
- Match on field names and values, not on the text of `reason` or `forecast`, which is written for people and may change in any release.

## Reading it from a script

With `jq`:

```bash
hitld dashboard --json --no-write | jq -r '.report.gate.mode'
hitld dashboard --json --no-write | jq -r '.report.quotas[] | "\(.id) \(.headroom)"'
```

With Node, which `hitld` already needs. This script checks the version and copies only chosen fields:

```js
import { readFileSync } from 'node:fs';

const result = JSON.parse(readFileSync(0, 'utf8'));
if (!result.ok) throw new Error(`${result.error}: ${result.message}`);

const { report } = result;
if (report.api_version !== 2) {
  throw new Error(`unknown api_version ${report.api_version}`);
}

const snapshot = {
  api_version: report.api_version,
  generated_at: report.generated_at,
  dispatch_mode: report.gate.mode,
  items_merged: report.ledger.items_merged,
  tokens_per_merged_item: report.ledger.tokens_per_merged_item,
  quotas: report.quotas.map((q) => ({
    id: q.id,
    window: q.window,
    used_share: q.used == null || !q.limit ? null : q.used / q.limit,
    headroom: q.headroom,
  })),
};
console.log(JSON.stringify(snapshot, null, 2));
```

Run it as `hitld dashboard --json --no-write | node snapshot.mjs`. A command that fails prints one JSON object with `ok: false` and an `error` code, so check `ok` before you read `report`. Exit codes are 0 for ok and 1 for a problem.

## Showing it on a published page

A page that your team opens (a static site, or a page published in a tool such as Claude) cannot run `hitld`. Run it where the project is, write the data to a file, and have the page read that file:

1. A script on the machine that holds the project runs `hitld dashboard --json`, picks the fields it means to show, and writes the result as a JSON file.
2. You publish that file with the page, by whatever means you already use.
3. The page fetches the file and draws it: bars for `headroom`, a table for `quotas`, a counter for `items_merged`.

Two rules for anything that leaves the machine:

- **Publish an allow-list, not the report.** `waiting_for_owner`, `work` and `milestones` name items and branches, and the project ID names the project. The labels say what each part is: check them against where the page goes. Copy only the fields you have decided to show, as the script above does. For a private project, publish aggregates only.
- **Publishing is the owner's decision.** Keep the data at or below the repository's classification ceiling, and have the owner say yes to what the page shows before it is published. Do not commit the output of `hitld dashboard --out` inside the repository unless you mean to: it holds item IDs and branch names.

If the page is a static file with no script and no network request, you get the same properties as the built-in one. If it fetches data from elsewhere, say so on the page.

## Check that it worked

```bash
hitld dashboard --json --no-write | jq '.report.api_version'   # 2
hitld dashboard --json --no-write | node snapshot.mjs                     # your fields, no error
```

Open your page next to the built-in `dashboard.html` (run `hitld dashboard --json` without `--no-write`; its path is in the command's `html` field). The numbers for the same limit must agree: both come from the same report.

## Undo it

Delete your script and the page. HITLD's files and settings are unchanged by anything on this page: `hitld dashboard --no-write` writes nothing, and it overwrites only the files its own marker lists. If you used `--out` inside the repository, delete that directory.

## When a view should be built in

If several projects end up rebuilding the same view, it belongs on the built-in page. Tell us: use the idea form on GitHub, or `hitld feedback` from inside a session, and say what the view shows and which field it needs ([giving feedback](../../README.md#giving-feedback)). Views that several projects rebuild are candidates for the built-in page.
