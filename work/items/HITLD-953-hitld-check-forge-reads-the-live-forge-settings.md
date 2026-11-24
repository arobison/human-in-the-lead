---
id: HITLD-953
title: hitld check forge reads the live forge settings with a read-only token and reports each as ok, wrong or cannot-read
kind: work
state: done
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c1]
claimed_by: D-01M87R90H4GKNQYQ
release_note: "`hitld check forge` reads the live GitHub settings with a read-only token from `HITLD_FORGE_TOKEN` (or the variable `--token-env` names) and reports each as ok, wrong (found, expected, where to fix it) or cannot-read (status, permission needed), exiting non-zero on any that is not ok."
---

## Why

The settings in HITLD-952 are the owner's to apply and nothing checks them afterwards.

## Done when

- `hitld check forge` takes a read-only token from the caller, prints nothing secret and exits non-zero on any wrong or cannot-read; each line reads ok, wrong (found, expected, UI path) or cannot-read (status, permission needed).
- It checks squash-only and auto-merge off, the rulesets (enforcement active, targets, rules, required contexts equal to `policy.json`, bypass actors exactly as specified), no classic rule in conflict, the release environment, Actions permissions, secrets, deploy keys, collaborators and installations.
- A test per check with a fake forge.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

From the Fable forge-enforcement spec (2026-11-22) and the owner's walk-through decisions HITLD-944 to 951.

Installations are not checked: GitHub lists installed Apps only to an App's own user access token (`GET /user/installations`), so a personal read-only token cannot find a stray App. The command lists installations under `not_checked` with that reason, so it never reads as ok; the owner reviews installed Apps by hand (HITLD-952 step 4).

Unverified against live GitHub until the owner runs the command once with the HITLD-952 baseline token:
- the permission each cannot-read line names (Administration read for rulesets, classic protection, Actions permissions and deploy keys; Actions read for environments; Secrets read for secrets; Metadata read for the repository and collaborators), and that this set is enough;
- the field names read: `sha_pinning_required`, `allowed_merge_methods`, `require_code_owner_review`, `required_status_checks[].integration_id`, `can_admins_bypass`, `deployment_branch_policy`, `bypass_actors` (and that a fine-grained token sees them), and `can_approve_pull_request_reviews`;
- that a ruleset on the default branch reads back as `~DEFAULT_BRANCH` or `refs/heads/main`, that an unprotected branch answers 404 "Branch not protected", and that a missing environment answers 404;
- GitHub Actions' App ID 15368, the `/apps/<slug>` lookup for the queue and release Apps, and the scorecard action's allowed pattern `ossf/scorecard-action@<full SHA>`.

Left for follow-up items: pagination past 100 entries, an overall time limit, refusing redirects, escaping path parts, and comparing the owner's login without regard to case.
