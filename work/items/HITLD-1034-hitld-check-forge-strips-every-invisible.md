---
id: HITLD-1034
title: `hitld check forge` strips every invisible character, reads the token variable name safely, names the right permission on a 401, and the deferred hardening is built
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- The output sanitiser also removes U+2028, U+2029, U+FEFF and U+00AD; a test covers each.
- `--token-env` with a name such as `toString` or `constructor` finds no variable and sends no bearer (look the name up with `Object.hasOwn`); a test covers it.
- A 401 does not say 'needs Metadata: read' when the token is bad or expired; it says the token was refused, and names the missing permission only on a 403; a test covers both.
- The deferred list from the review is each either built with a test or dropped with a reason in this item: paging through a result that spans pages, one overall time limit for the whole run, `redirect: 'error'` on the forge requests, escaping a repository path segment, comparing the owner name case-insensitively.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

PR 632 (HITLD-953, `hitld check forge`) merged on 2026-11-24 after an independent review found no blocking issue and these display-level and hardening points, which the owner chose to file rather than send back. Serves the owner, who relies on the check to say what is wrong with the forge settings. [Certain: the points come from the reviewer's report.]

## Notes

rc.3 (a proposal for the owner to move). The permission and field names GitHub really returns were not verified against the live forge: the owner runs `hitld check forge` once with the HITLD-952 baseline token and the item corrects any name that differs. No guard, policy, rights, skill, design-rule, public-schema or release-path file is meant to change; the forge area is owner-held for merge.
