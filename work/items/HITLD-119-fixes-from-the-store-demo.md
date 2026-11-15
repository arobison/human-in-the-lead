---
id: HITLD-119
title: "Fixes from the store demo: unmatched answers, a removed device's own view, who logged a call, example names, feedback publish"
kind: work
state: planned
created: 2026-11-15
project: HITLD-15
---

## Why

The demo for milestone HITLD-101 passed, and found five things that are wrong or misleading. None opens access, but the first puts words in the owner's mouth. The owner decided all five are fixed before v0.1.0-rc.1.

## Done when

- **An answer that matches no option is refused, not recorded.** `hitld rights answer` with text that names no option of the decision (for example free words) is refused with a named code and the options listed, and nothing is recorded. This applies to every decision, and above all to device decisions, where an unmatched answer was applied as a refusal. Free words that clearly name one option's label may be matched to it only when exactly one option fits; otherwise refuse.
- **A removed device's own view says so.** When this device's key does not open the remote's head, `hitld store device list` and `store status` report that this device cannot open the store and has probably been removed (or not yet sealed to), instead of `enrolled: true` from its last pulled copy.
- **A logged call says who made it.** `logged` ledger events (and other events a session writes without a dispatch) record the session and host, and the digest and `ledger summary` show them.
- **Example device and repository names in the repository are placeholders no owner would choose.** The guide, code, tests and scenarios use names such as `example-laptop` and `example-cloud`, never a name an owner might pick in following the guide; the guide says to choose a name that is not one of its examples.
- **`hitld feedback publish` checks the private term list** before anything is sent, as `hitld publish check` does.
- `npm run check`, the offline eval gate and `hitld work check` pass.
