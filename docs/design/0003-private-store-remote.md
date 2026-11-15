# 0003: A remote for the private store

| | |
|---|---|
| **Status** | Decided. The owner answered every question in section 15. Not built; milestone HITLD-101, a release need of v0.1.0-rc.1. |
| **Date** | 2026-11-15 |
| **Scope** | Moving a project's private store between the owner's machines and sessions without a person carrying a file: what moves, the shape (a synced copy, not a hosted database), keys and devices, transports, when sync runs, the security limits, the file format, interface changes, migration, evals, and the milestone this design serves |
| **Builds on** | [0001](0001-human-in-the-lead.md), especially parts [3.2](0001-human-in-the-lead/03-data-model.md#private-store) (private store), [10](0001-human-in-the-lead/10-security.md) (security), [13.1](0001-human-in-the-lead/13-operations.md#resuming-on-any-machine) (resuming on any machine), [13.4](0001-human-in-the-lead/13-operations.md#134-settings-in-four-layers) (settings) and [16.5](0001-human-in-the-lead/16-packaging.md#165-releases-and-compatibility) (compatibility) |
| **Reading order** | Sections 1 to 4 settle the shape. Sections 5 to 10 are the mechanics. Sections 11 to 13 cover interfaces, migration and evals. Section 14 is the milestone. The owner's decisions are in section 15. |

## 1. What this design settles

Each project has a private store: the ledger, the trust record, decisions and their private ask records, confidential precedents, judgement records, eval results, and feedback ([3.2](0001-human-in-the-lead/03-data-model.md#private-store)). It lives in a directory on one machine.

The owner works on more than one machine. Some work runs locally, some on a machine with a GPU, and some in cloud sessions whose containers are discarded when the session ends. Today:

- **A cloud session's store dies with its container.** The next session starts with an empty ledger, an empty trust record and no calibration. The learning loop starts over each time.
- **Moving a store needs a person.** `hitld store sync <file>` merges and exports one encrypted file, but someone has to carry that file between machines ([13.1](0001-human-in-the-lead/13-operations.md#resuming-on-any-machine)).
- **One passphrase guards every copy.** Every machine that can open the file holds the same secret. Removing one machine means changing it on all of them.

This design adds a **store remote**: storage that holds the project's store, which `hitld` pulls from and pushes to on its own. One requirement shapes everything below: **every move and all key handling is deterministic `hitld` code.** No skill, prompt or agent moves the store, holds a key, or decides when to sync. An agent that forgets a step, or is talked into a different one, cannot leak or lose the store.

It proposes six decisions:

| # | Proposal | Where |
|---|---|---|
| 1 | The store stays a synced copy on each machine, merged as today, behind a small `StoreRemote` interface. A hosted database is a later backend for several people leading one project. | [4](#4-a-synced-copy-not-a-hosted-database) |
| 2 | Each pushed file is encrypted to the project's enrolled devices. Each device has its own key pair; there is no shared passphrase. | [5](#5-keys-one-key-pair-per-device) |
| 3 | A device is enrolled by committing its public key to the repository. The owner's merge is the approval. | [6](#6-enrolling-and-removing-a-device) |
| 4 | The first transport is a private GitHub repository. Others (S3-compatible storage, a directory) follow behind the same interface. | [7](#7-transports) |
| 5 | `hitld` pulls on run start and resume, and pushes at checkpoints, hand-overs and merges. Harness hooks are a backstop. The run lease is the lock. | [8](#8-when-sync-runs) |
| 6 | The file format follows age, with its published test vectors, rather than a new format. | [10](#10-the-file-format) |

Eval baselines are out of scope: HITLD-100 commits accepted baselines to the repository, where CI reads them.

## 2. What moves, and what never does

The store's git history already separates the two ([3.2](0001-human-in-the-lead/03-data-model.md#private-store)):

- **Moves:** the text files the store commits. The ledger, the trust record, decisions and ask records, precedents, signals, notes, judgement records, studies, eval results and feedback.
- **Never moves:** the machine-local files the store's `.gitignore` keeps out. The SQLite index (rebuilt from the text), `run-state.json` and `run/` (rebuilt from the ledger), `primary-checkout.json`, `env/`, `usage/`, the digest cursor, and the machine registry beside the stores.

Secrets never move either: they are not in the store at all ([13](0001-human-in-the-lead/13-operations.md), `env.secret_tasks`). A device's private key is machine-local and never enters the store.

## 3. The pattern

This is state shared across machines, kept on storage that cannot read it. Two well-known patterns cover it, and HITLd already has half of each.

| Analogue | What it does | What HITLd takes from it |
|---|---|---|
| Terraform remote state | One state file in a backend, with a lock so two writers cannot overwrite each other | The run lease is the lock ([13.1](0001-human-in-the-lead/13-operations.md#one-orchestrator-at-a-time)); the remote is the backend |
| restic, borg, Kopia | Back up to S3, B2 or SFTP; the storage only ever holds ciphertext; pluggable backends | Encryption on the client; dumb storage; one interface, several transports |
| age, SOPS | Encrypt a file to several recipients' public keys; each recipient opens it with its own private key | One key pair per device; no shared passphrase |
| Signal linked devices, 1Password device enrolment | A new device gets access only when a trusted one approves it | Enrolment is a commit the owner merges |
| Litestream | Copies a local database to object storage on every write | Push on every checkpoint, not when someone remembers |

Two things HITLd already has make this simpler than a general sync system:

- **One writer at a time.** The run lease means one orchestrator drives a project. Two machines rarely write at once, and when they do the lease says which one may continue.
- **A merge that cannot lose history.** The store's append-only files merge line by line; nothing the common history held may disappear; a real conflict stops and names the paths ([3.2](0001-human-in-the-lead/03-data-model.md#private-store)).

## 4. A synced copy, not a hosted database

Functionally, the store remote is a private database shared between the owner's machines. It could be built as a live hosted database instead of a copy on each machine.

| | Hosted database (Postgres, a serverless SQL service) | Synced copy (this design) |
|---|---|---|
| Source of truth | The server | Each machine holds a full copy; copies merge |
| Works offline | No | Yes |
| What the provider sees | Plain text, if it runs the queries | Ciphertext only |
| What each session holds | A read-write credential to the whole database | Its own device key, which can be removed |
| Many writers at once with fresh reads | Strong | Weaker: a copy is stale until its next pull |
| History of changes | Built separately | Git history |
| Dependencies | A client library or an HTTP API, and one more allowed host | None new |
| Schema changes | Migrations against a live database | The migrations HITLd already ships ([16.5](0001-human-in-the-lead/16-packaging.md#165-releases-and-compatibility)) |

The store's data favours the synced copy: mostly append-only logs, small records, one writer at a time, and text whose history matters. Hybrids exist (a local SQLite file that replicates to a hosted copy), which shows the two shapes are close.

**The interface.** The core talks to a `StoreRemote` with a few operations: read the remote's head, fetch what is new since a head, publish a new head if the remote has not moved (compare and swap), and list or rotate recipients. A hosted database becomes one more implementation when several people lead one project (HITLD-53), where fresh reads matter more than offline work.

### The alternative not taken: a hosted database now

A hosted database gives fresh reads to many writers, which HITLd does not need yet. It costs a credential with full access in every session, a provider that can read the data, a network dependency on every read, and live migrations. It is the right backend for a team; it is not the right first one.

## 5. Keys: one key pair per device

A **device** is anything that runs `hitld` for a project and keeps a store: a laptop, a GPU machine, or a cloud environment.

- **Each device has its own key pair.** `hitld store device init` makes one. The private key stays on the device (section 9 says where). The public key is enrolled (section 6).
- **Each pushed file is encrypted to every enrolled device.** As in age, each file has a fresh random file key; the payload is encrypted once with it; and the file key is wrapped once per recipient's public key. Any enrolled device opens the file with its own private key.
- **No shared secret.** No passphrase is typed, stored or shared. Removing a device does not change any other device's key.

### The alternative not taken: one passphrase, as today

Format 1 ([3.2](0001-human-in-the-lead/03-data-model.md#private-store)) derives the key from one passphrase. It is built and sound for a person carrying a file. For a remote that every machine reaches on its own, it puts the same secret on every machine, offers offline guessing to anyone who copies a file, and makes removal mean re-keying everywhere. Format 1 stays readable for import (section 12).

## 6. Enrolling and removing a device

- **Enrol.** On the new device, `hitld store device init` makes the key pair and writes its public key to `.human-in-the-lead/store-devices.json` in the repository: a device name, the public key and when it was made. The orchestrator commits that change like any tracker change, and it reaches main only through the owner's merge. A public key is safe in a public repository.
- **What enrolment gives.** From the next push, files are encrypted to the new device too. The new device can open what is pushed after its enrolment merges. Until then it can push nothing: `hitld` refuses to push from a device that is not on main's list.
- **Remove.** Removing a device's entry is a commit the owner merges. From the next push, files are no longer encrypted to it. What the removed device already pulled, it keeps: removal protects what comes after, not what was already shared. The transport's old files are pruned (section 7) so the removed key opens nothing new from storage.
- **Executors never enrol.** The `store device` commands refuse executors as the other store commands do ([3.2](0001-human-in-the-lead/03-data-model.md#private-store)), and the merge queue rejects a branch that changes the device list unless it is the orchestrator's enrolment commit.

## 7. Transports

A transport stores opaque files and offers compare and swap on a head. It never sees plain text.

### A private GitHub repository first

GitHub has no per-user database product. A private repository is the closest thing, and it has one large advantage: **authentication is already solved.** A local machine uses the owner's own git credentials. A cloud session already authenticates to the repositories attached to it, so the store repository is attached the same way, with no new token to distribute.

The other GitHub features do not fit:

- **Gists** are not private. A secret gist is unlisted; anyone with its address can read it.
- **Actions artifacts and caches** expire. They are build outputs, not storage.
- **Secrets and variables** are write-only or small. They hold configuration, not data.
- **Packages** can hold blobs as OCI artifacts in a private registry. This works but is awkward to read and write without a container tool.

**Layout.** The store repository holds, per project, a pointer to the current head and the encrypted files: incremental bundles since the previous head, and a full snapshot from time to time. Publishing a head is a git push that fails if the remote moved, which gives compare and swap for free. Pruning rewrites the store repository's history to drop old files; it is dumb storage, so rewriting it is safe.

**As built.** The repository has one branch, `hitld-store`. Its tree holds `bundles/<seq>-<sha256>.bundle`, one file per version kept, and each push is one commit that adds one. The version id is the file name without `.bundle`, so it names the hash its bytes must have and does not change when history is rewritten. A push builds its commit on the remote's tip and is never forced; git refuses it when the tip has moved, and the transport then reports the new head. Prune writes one new root commit that holds only the newest bundles and replaces the branch with `--force-with-lease` pinned to the tip it read, so it cannot overwrite a push that landed meanwhile. The branch must not be protected against force pushes. The provider removes unreachable objects on its own schedule, so prune bounds the branch but does not erase at once.

The transport runs `git` over the URL it is given (`https`, `ssh` or a local path; never a password in the URL). It reads and writes a bare copy kept inside the private store, never the project's checkout. It runs git as `hitld` runs it on the store: an argument list, hooks and signing off, the owner's git config ignored. The keys that say how to reach and sign in to a host (`credential.*`, `http.*`, `url.<base>.insteadOf`) and the proxy, certificate and ssh agent variables are passed on, so the credential helper or proxy a session already uses keeps working.

**One repository per project or one per owner.** One per project isolates access: a session given one project's store repository sees nothing of another's. One per owner, with a folder per project, means one repository to set up. Q4 asks which.

### Plain or encrypted on GitHub

A private repository could hold the store's git history in plain text, pushed as an ordinary remote. That needs no keys at all: GitHub's access control is the only guard. It means GitHub, and anyone holding a token for that repository, can read the ledger, the trust record and confidential decisions. Encryption (section 5) keeps that data unreadable to the provider and to a leaked repository token, at the cost of device keys. Q2 asks which. This design recommends encryption: the store holds `confidential` material, which [10.3](0001-human-in-the-lead/10-security.md#103-information-classification) keeps from third-party services without the owner's decision.

### Later transports

S3-compatible object storage (with a conditional write for compare and swap) and a plain directory (a mounted drive, for tests and air-gapped machines). Each is a module behind `StoreRemote`.

## 8. When sync runs

Sync is part of `hitld` commands that already run at the right moments, so no agent has to remember it:

| Moment | What `hitld` does |
|---|---|
| `hitld run start`, `hitld run resume` | Pull and merge before reading the run state |
| Each checkpoint (`hitld run checkpoint` and the commands that checkpoint) | Push |
| `hitld handover` | Push before releasing the lease |
| A merge through the queue | Push after the merge is recorded |
| `hitld store push`, `hitld store pull` | By hand, for the owner |

**Hooks as a backstop.** `hitld install` adds a session-start hook that pulls and a session-end hook that pushes, for a session that dies between checkpoints. The harness runs hooks, not the model. A hook that fails reports and does not block the session.

**The lease is the lock.** Only the lease holder pushes during a run. A push that finds the remote moved pulls, merges and tries again; a real conflict stops the push, keeps the local store as it is, and becomes a question for the owner with the conflicting paths. Outside a run (the owner's own commands), the same compare and swap applies.

**Offline.** Work continues on the local copy. The next push carries it. A machine that has been offline merges like any other.

**As built: push, pull and status.** The code is `core/lib/store/push-pull.mjs`.

- **The address.** `hitld store remote set <url>` checks the URL and records it in `<store>/.git/hitld-remote.json`. That file is machine-local: it is inside the store's `.git`, which no commit or bundle carries, and nothing is written to the project.
- **What was merged.** Pull and push record the remote version they last merged or pushed, and the local commit it holds, in `<store>/.git/hitld-sync.json`. The next push uses that version as the head it expects.
- **Push.** It commits the store's text, seals it as format 2 to the recipients, and pushes with compare and swap. If the remote has moved, it fetches the new head, merges it as `store import` does, seals again and retries, up to four times. A real conflict stops it, names the paths and changes nothing. A device that is not enrolled, or whose own key is not among the recipients, is refused before anything is sent.
- **Pull.** It fetches the head and opens it with this device's key. An empty remote, or a head already merged, changes nothing. A key that does not open the file is refused and nothing is written.
- **Status.** It reports the address, the local commit and the remote version, the version last merged, whether a push or a pull is due, and this device's enrolment. A remote that cannot be reached is reported in the result, not raised. It changes nothing in the store.
- **Keys.** Recipients and the private key come from `resolveDevices` (`core/lib/store/devices-port.mjs`) and nowhere else. The private key comes from `HITLD_STORE_IDENTITY` or `--identity-fd`, never an argument, and is never printed.

**What can still be lost.** A cloud session killed between two pushes loses what it recorded after the last one. Pushing at each checkpoint keeps that window to one step of work.

## 9. Security limits

| Threat | Defence | Limit |
|---|---|---|
| The storage provider reads the store | Ciphertext only; keys never leave devices | None, if encryption is on (Q2) |
| A leaked token for the store repository | The repository holds ciphertext | The token still lets someone delete or replace files; compare and swap and a merge that never drops history make a replaced file fail to merge, but a deletion is a loss until another device pushes again |
| A stolen laptop | Remove the device (section 6) | It keeps what it already pulled |
| A prompt-injected executor | Executors cannot run store commands or read device keys through `hitld` ([10.2](0001-human-in-the-lead/10-security.md#102-least-privilege-per-role)); the network allowlist limits where data can go | See the next row |
| Any process in a cloud container | — | **A cloud device's private key arrives as an environment variable, and any process in that container can read it.** Encryption protects the store at the provider and isolates devices from each other. It does not protect the store from a session that already holds a key. Inside a session, the network allowlist and least privilege are the defence |

**Where a device key lives.** On a local machine, in the operating system's keychain, as `hitld env` already reads secrets ([13](0001-human-in-the-lead/13-operations.md)). In a cloud environment, an environment variable set once in the owner's personal environment: environment variables there are stored in plain text in the environment's settings, visible to the owner. Q6 asks about this.

## 10. The file format

A new cryptographic format is a risk no review can fully retire. This design follows age, which is specified, widely reviewed and published with test vectors:

- **Format 2** is an age file: a header with one X25519 recipient stanza per enrolled device, then the payload encrypted with ChaCha20-Poly1305 in age's streaming construction. The payload is the same as format 1's: the manifest and the git bundle.
- **In Node, without a dependency.** Node's built-in crypto has X25519, HKDF-SHA-256, HMAC and ChaCha20-Poly1305, which is everything age's X25519 recipient type needs. The implementation passes age's published test vectors, and files it writes open with the `age` program, and the reverse.
- **Or the `age` program.** `hitld` could run `age` the way it runs git: an argument list, no shell, keys passed through file descriptors. That retires the risk of a hand-written implementation, at the cost of one more program to install on every device. Q5 asks which.

Format 1 stays readable for `hitld store import`; nothing writes it to a remote.

## 11. Interface changes

All additive, under [16.5](0001-human-in-the-lead/16-packaging.md#165-releases-and-compatibility):

- **Commands:** `hitld store device init | list | remove`, `hitld store remote set | show`, `hitld store push`, `hitld store pull` and `hitld store status`. Each refuses executors. Each is an entry in the command table, so the MCP server gets the read-only ones.
- **Files:** `.human-in-the-lead/store-devices.json` (public keys, schema-checked, in the repository) and a `store.remote` section in `policy.json` (the transport and its address; no credentials).
- **The store export format** gains format 2 (section 10).
- **Run commands** (`run start`, `run resume`, checkpoints, `handover`) pull and push when a remote is set, and report what they did.
- **`hitld install`** adds the two hooks (section 8).

## 12. Migration from today

- **Nothing changes until a remote is set.** A project with no `store.remote` behaves as today.
- **First push.** `hitld store remote set` checks that this device is enrolled on main and that the remote is empty or holds this project, then pushes the current store.
- **A store moved by hand** with format 1 is imported with its passphrase as today, then pushed in format 2.
- **A second device** enrols, its enrolment merges, then it runs `hitld store pull`.

## 13. Evals and tests

- **Format:** age's test vectors pass; files interoperate with the `age` program both ways; a tampered header, stanza or payload is refused.
- **Sync:** two stores diverge and merge through a remote with the existing merge rules; a push against a moved remote pulls, merges and retries; a real conflict stops and changes nothing.
- **Devices:** a device not on main's list cannot push; after removal, a new push does not open with the removed key.
- **Roles:** an executor is refused every store and device command, in a scenario where an injected instruction asks for one.
- **Lifecycle:** a cloud session is discarded after a checkpoint, and a new session resumes with the ledger and trust record intact.

## 14. The milestone and its build items

### The store follows the owner

- **Outcome:** a project's private store is the same on every machine and session the owner uses, with no file carried by hand and no key handled by an agent.

**Done when:**

- **c1.** A run started in one cloud session, discarded after a checkpoint, resumes in a new cloud session with its ledger, trust record and open decisions intact.
- **c2.** A local machine and a cloud environment, both enrolled, each work on the project in turn, and each sees the other's records after its next pull.
- **c3.** A removed device cannot open anything pushed after its removal.
- **c4.** The storage holds no plain text of the store (when encryption is on), checked by a scan of the remote.
- **c5.** No skill or agent prompt mentions a key, a passphrase or a store file path; every store move is a `hitld` command or a hook.

**Check:** a demo, run by someone other than the items' authors, of c1 to c3 against a real private repository.

### Build items

| Item | Needs |
|---|---|
| **Format 2**: age-compatible encryption to several recipients, with test vectors | — |
| **Devices**: `store device init / list / remove`, `store-devices.json`, the push refusal for an unenrolled device | Format 2 |
| **`StoreRemote` and the GitHub transport**: head, fetch, compare and swap, pruning | — |
| **Push and pull**: `store push / pull / status`, `store remote set / show`, merge on pull | Format 2; StoreRemote |
| **Sync in the run commands and hooks**: start, resume, checkpoint, hand-over, merge; the two hooks in `hitld install` | Push and pull |
| **Evals and docs**: section 13's scenarios; the setup guide for a cloud environment | Each piece as it lands |

## 15. Questions, decided by the owner

### Q1. A synced copy or a hosted database?

**Decided by the owner (2026-11-15): a synced copy on each machine, behind `StoreRemote`; a hosted database is a later backend.**

- **Recommend: a synced copy on each machine, behind a `StoreRemote` interface** (section 4). Works offline, keeps git history, the provider sees only ciphertext, no new dependency. A hosted database is a later backend for several people leading one project.
- **Alternative: a hosted database now.** Fresh reads for many writers, at the cost of a full-access credential in every session, a provider that reads the data, and live migrations.

### Q2. Plain or encrypted on the remote?

**Decided by the owner (2026-11-15): encrypted to enrolled devices.**

- **Recommend: encrypted to enrolled devices** (sections 5 and 7). The store holds confidential material; encryption keeps it from the provider and from a leaked repository token.
- **Alternative: plain git in a private repository.** No keys to manage; GitHub's access control is the only guard, and GitHub can read the store.

### Q3. Which transport first?

**Decided by the owner (2026-11-15): a private GitHub repository first.**

- **Recommend: a private GitHub repository** (section 7). Authentication is already solved for local machines and cloud sessions; push rejection gives compare and swap.
- **Alternative: S3-compatible object storage first.** No GitHub dependency for the store, at the cost of a new credential to distribute to every device.

### Q4. One store repository per project, or one per owner?

**Decided by the owner (2026-11-15): one store repository per project.**

- **Recommend: one per project.** A session given one project's store sees nothing of another's.
- **Alternative: one per owner, with a folder per project.** One repository to set up, at the cost of every session that reaches it seeing every project's (encrypted) store.

### Q5. The age format in Node, or the `age` program?

**Decided by the owner (2026-11-15): age-compatible code in Node's built-in crypto, tested against age's published vectors and against the `age` program.**

- **Recommend: age-compatible code in Node's built-in crypto, tested against age's published vectors and against the `age` program** (section 10). No new install on any device.
- **Alternative: run the `age` program, as `hitld` runs git.** No hand-written cryptography, at the cost of one more program on every device, including cloud environments.

### Q6. Where does a cloud environment's device key live?

**Decided by the owner (2026-11-15): an environment variable in the owner's personal cloud environment, one device per environment.**

- **Recommend: an environment variable in the owner's personal cloud environment, one device per environment** (section 9). Set once; removable like any device. Its limit: any process in that container can read it.
- **Alternative: a new device key per session, enrolled each time.** Nothing stored in the environment, at the cost of an enrolment merge before every session can push.

### Q7. How is a device enrolled?

**Decided by the owner (2026-11-15): a commit to `store-devices.json` that reaches main only through the owner's merge.**

- **Recommend: a commit to `store-devices.json` that reaches main only through the owner's merge** (section 6). Enrolment is reviewable and recorded like any decision.
- **Alternative: approval from an already enrolled device** (as linked devices work), with no commit. Faster for a new session, at the cost of a record outside the repository's history.

### Q8. Does v0.1.0-rc.1 wait for this?

**Decided by the owner (2026-11-15): yes, v0.1.0-rc.1 waits for this milestone.**

- **Was recommended: no; it ships in the next pre-release.** rc.1 already carries HITLD-100, so the release gate does not depend on any store. This milestone is several build items and its own review.
- **Alternative: rc.1 waits for it.** A live trial from cloud sessions keeps its learning between sessions from the first day, at the cost of delaying rc.1 by this milestone.
