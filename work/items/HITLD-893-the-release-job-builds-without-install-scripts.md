---
id: HITLD-893
title: The release job builds without install scripts or signing rights, and attests the artifact by digest
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-64 c?]
---

## Why

The `release` job in `.github/workflows/release.yml` runs `npm ci`, `npm run check` and the evals with `id-token: write` and `attestations: write` before `npm pack`; a dev dependency with an install script (esbuild) can alter what is packed or mint tokens. Consumers also install by repository ref, so the attestation is not on the path they use.

## Done when

- The build runs with `npm ci --ignore-scripts` in a job with no permissions; a separate job attests the uploaded artifact by digest.
- The marketplace pin is by commit, and the guide says how consumers verify.
- A guard, rights, store or workflow change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Finding S7 (low) of the second Fable security pass (2026-11-22), decision HITLD-885. rc.3.
