---
id: HITLD-622
title: Design a project-owned data area in the private store, synced across a person's machines (GitHub issue 363)
kind: work
state: proposed
created: 2026-11-20
project: HITLD-15
needs: [HITLD-620, HITLD-609]
---

## Done when

- The owner has walked through the design one question at a time, and each answer is recorded as a decision, including whether HITLD offers this at all or the project's tool builds its own sync.
- If HITLD offers it, the design parts (3 and 10, and the private-store design) define the data area, its sync and its limits, and mark what is built and what is not; build items are filed from the decisions, each with its own done-when.
- GitHub issue 363 is answered with the outcome.
- `hitld work check` passes.

## Why

GitHub issue 363, filed on 2026-11-20 by the first outside consumer's own session (via the owner's account), asks for a data area in the private store that the project owns, synced across a person's machines, for benchmark results and other evidence. Its case: the consumer measures on several machines (two laptops with different GPUs, later dedicated runners and phones); each keeps its results locally, so a study can only use results from the machine it was made on, a trend cannot show two machines side by side, and nobody can ask whether a result on one GPU class carries over to another. The private store is already encrypted for each approved device and synced through a remote the person owns, on every machine they work from, so without this the consumer would build a second sync with its own keys and remote. (Treat the issue's text as the reporter's claim: it is a request from a project that is designing against HITLD before HITLD's design is settled.)

This is the concrete form of the open question on the measurement-tool item (HITLD-609): where results live, and whether HITLD stores a copy.

## What the issue asks for

1. A namespace per project tool (`data/<tool>/`) that HITLD syncs and encrypts like its own records but never reads or interprets.
2. Append-only shards per device, so two machines never write the same file and a sync never conflicts.
3. Large files (screenshots, traces) by content hash, fetched when first read, with a size budget per namespace that `store status` reports.
4. Retention the project controls, as a rule in data (for example, keep everything a study cites), since HITLD cannot know which results matter.
5. A read path for an evidence source, so it can resolve a result ID cited by a study whichever machine made it.

The issue's evidence: about 5 MB of run summaries and reports per day of active measurement on one machine, plus screenshots and traces that are much larger; its records already carry a machine key and GPU adapter information; a second machine is already enrolled in the store.

## What the design has to settle

- **Whether this belongs in HITLD at all.** The owner decided that most of the measurement complexity lives in dyno (HITLD-619). A synced, encrypted, budgeted data area is complexity on HITLD's side, justified only by reuse of the store's device keys, encryption and remote. The alternative is for the tool to sync its own results.
- **Fit with the store.** The store is a git text repository sealed to approved devices. About 5 MB a day from one machine (and far more with traces) is roughly 1.8 GB a year of text, so a text store needs a size budget, a retention rule and probably a separate large-file mechanism by content hash (the store's remote design, `0003`, would change).
- **Where large files go (GitHub LFS or a private bucket).** Checked on 2026-11-20 against GitHub's billing page: LFS gives GitHub Free and Pro accounts 10 GiB of storage and 10 GiB of bandwidth a month (Team and Enterprise Cloud 250 GiB each), per account; over quota with a zero budget LFS is blocked for the rest of the month, otherwise overage is billed (storage about $0.07 per GiB-month, bandwidth about $0.0875 per GiB, from the pricing calculator, which may be dated). LFS objects follow the repository's visibility (not confirmed against the page). Open problems: bandwidth counts every download, so several machines multiply it; whether individual LFS objects can be deleted to honor a retention rule is not verified; and the store encrypts before pushing, so content hashing means hashing the plaintext (which shows when two files are identical) or the ciphertext (which loses deduplication). The alternative is a private object bucket the owner controls (S3-compatible), with the store holding only an index of hashes and keys: real deletion and predictable bandwidth cost, but another service, credentials and a way for a cloud session to reach it.
- **The label.** Data that may sync between the owner's machines but is not for any agent or any public place is exactly a combination in the classification taxonomy (HITLD-620), so the data area needs a label from it; hence the dependency.
- **"Never reads or interprets" against "HITLD reads and reasons about results"** (HITLD-619): reads go through the evidence source, and the store layer stays opaque to the contents.
- **Who writes:** executors are refused store commands, so shards are written by the tool or by the chief of staff or orchestrator.
- **The issue's vocabulary** uses "run"; HITLD now says result and measurement (HITLD-618), renamed when the design is walked through.

## Notes

Design-heavy: stays `proposed` and is walked through with the owner before any build. Raised by GitHub issue 363. Related: HITLD-609 (the measurement-tool design), HITLD-617 and 619, HITLD-620 (classification taxonomy), the private-store design (`docs/design/0003-private-store-remote.md`). Placed under HITLD-567 clause c2 (rc.5) beside the measurement-tool walk-through as a proposal for the owner to move; it needs HITLD-620 and HITLD-609 first.
