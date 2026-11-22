---
id: HITLD-742
title: The README and the guide say the release ships the CLI
kind: work
state: in-progress
created: 2026-11-22
project: HITLD-15
claimed_by: D-01M80JA52TF52ST3
---

## Why

Reported as GitHub issues 427 and 426. README.md and docs/guide/README.md say that `hitld` is not published and tell the reader to clone the tag and run it from there. A release does ship the CLI (in the plugin bundle), so a consumer following the text installs from a clone that the hooks then depend on (HITLD-741) when they need not.

## Done when

- One paragraph in README.md and the matching one in docs/guide/README.md say that the release ships the CLI, how to run it from the release, and no longer tell the reader to clone the tag.
- The text still says that publishing to a package registry is separate, with no promise about when.
- A docs check (or the existing docs tests) passes with the new text, and the spell check passes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Keep this apart from HITLD-138 (publish the hitld package to the npm registry), which stays its own item. This item is a docs fix only. Related: HITLD-741.
