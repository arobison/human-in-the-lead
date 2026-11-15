---
id: HITLD-113
title: "The store's address and device list live outside the project repository"
kind: work
state: planned
created: 2026-11-15
project: HITLD-15
needs: [HITLD-107]
---

## Why

The project repository may be public. Its committed files must not name the private store's repository or the devices that can read it: that tells anyone where the store is and how many devices hold keys. The owner decided that both move out of the project repository, keeping the two properties they served: a fresh cloud container finds the remote with no setup, and only the owner's merge changes who can read the store. This lands before v0.1.0-rc.1, as part of milestone HITLD-101.

## Done when

- **The address** is read from outside the repository: the `HITLD_STORE_REMOTE` environment variable (a cloud environment sets it beside `HITLD_STORE_IDENTITY`), then the person file, keyed by project ID, on a local machine, then the existing machine override. `policy.json` holds only `store.remote.required` (true or false); when it is true and no address is found, `run start`, `run resume` and `store status` say so by name, and the hooks print one line. `store.remote.url` in `policy.json` is refused by the policy check with a message saying where the address goes. `hitld store remote set` writes the person file or the machine override, never `policy.json`.
- **The device list** lives in the private store repository on its own branch `hitld-devices` (one file, same schema as `store-devices.json`), never in the project repository. Enrolment and removal are a change to that branch that only the owner's merge makes; `hitld store device init` and `remove` prepare the change on a new branch of the store repository and print what the owner merges. Push encrypts only to the list on `hitld-devices` and refuses a device not on it; the rotation after a removal and the re-seal after an enrolment work as today. `store status` reminds the owner to protect `hitld-devices` (pull request required, no direct or force pushes), since `hitld` cannot check that setting from git.
- **A guard** refuses to commit, to the project repository, a file holding a store address or a device list (`.human-in-the-lead/store-devices.json`, `store.remote.url`), with a message saying where each goes.
- Design 0003 (sections 6, 7, 11 and 15, with a note on the owner's change of Q3 and Q7's placement), the store guide, the `adopt` skill and the offline scenarios describe the new placement; the existing tests and scenarios pass on it.
- `npm run check`, the offline eval gate and `hitld work check` pass.
