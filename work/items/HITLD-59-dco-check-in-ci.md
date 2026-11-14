---
id: HITLD-59
title: DCO check in CI
kind: work
status: Planned
created: 2026-11-14
project: HITLD-15
milestone: first-release
---

## Why

Q20 decided on the Developer Certificate of Origin for this repository, and nothing checks it. The repository is about to be public.

## Done when

- A CI job fails a pull request when any commit in it lacks a `Signed-off-by` line.
- For a commit an agent made, the person who approved it signs off, and the check accepts that sign-off.
- A merge commit made by the merge button is exempt, and the exemption is stated in the job.
- A test runs the check on fixture histories: all signed, one unsigned, an agent commit signed by its approver.
- `CONTRIBUTING.md` says how to sign off.
