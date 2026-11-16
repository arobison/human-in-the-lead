---
id: HITLD-295
title: The isolated-home test guard allows only the default real path of the temp dir, so a Windows short-name TEMP can trip it
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Why

Found by D-21 (likely, not verifiable on Linux). The isolated-home guard in `core/test/helpers/isolated-home.mjs` (lines 43-46) allows only the resolved temp dir and its default real path. On Windows with a short-name TEMP (`C:\Users\ABC~1\...`), the native real path of the temp dir is a long path inside the real home that is not on the allowed list, so a test could throw "a test reached the real home directory".

The owner merged the Windows PR (#186) knowing this; their Windows run of the suite is the check.

## Done when

- The guard also allows the native (platform) real path of the temp dir.
- A test covers it, and the owner's Windows run of `npm test` shows no guard failure with a short-name TEMP.
- `npm run check` and `hitld work check` pass.
