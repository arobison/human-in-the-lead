---
id: HITLD-789
title: core/test/views.test.mjs uses British spellings that the spelling check rejects
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
---

## Why

Found by the HITLD-742 executor after PR 474 (HITLD-692) merged: `npm run spelling` reports two British spellings, "colour", in `core/test/views.test.mjs` (the fixture field name at line 308 and the matching error text at line 337). The CI `check` job did not fail on them, but the spelling check rejects British forms and will fail wherever it does run.

## Done when

- The fixture field and the error text in `core/test/views.test.mjs` use an American spelling (for example `color`) and the test still passes.
- `npm run spelling` reports no hits in the repository.
- `npm run check` and `hitld work check` pass.
