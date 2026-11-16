---
id: HITLD-24
title: "Release v0.1.0: version, tag, notes"
kind: work
state: planned
created: 2026-11-14
project: HITLD-15
release: 0.1.0
needs: [HITLD-22, HITLD-23, HITLD-16, HITLD-39, HITLD-40, HITLD-45, HITLD-51, HITLD-58, HITLD-59, HITLD-61, HITLD-63, HITLD-72, HITLD-73, HITLD-79, HITLD-80, HITLD-82, HITLD-83, HITLD-84, HITLD-85, HITLD-86, HITLD-87, HITLD-88, HITLD-89, HITLD-21, HITLD-35, HITLD-90, HITLD-91, HITLD-92, HITLD-93, HITLD-101, HITLD-102, HITLD-103, HITLD-104, HITLD-105, HITLD-106, HITLD-107, HITLD-109, HITLD-110, HITLD-113, HITLD-114, HITLD-119, HITLD-128, HITLD-137, HITLD-25, HITLD-143, HITLD-145, HITLD-146]
---

## Why

Semantic versioning of the public interface (design 16.5), 0.y.z before 1.0. Set the plugin and CLI version, tag, release notes; push to GitHub.

Made the planned way (design 2.7 and 3.2, "Milestones and releases"): `hitld release propose` drafts the bump and the notes, and the owner makes the release, which writes the first release record. Needs HITLD-45 because the milestone and release format changes the file format, which should not change right after the first release (Q33).

On GitHub (done before the first push): the issue labels `feedback`, `bug`, `friction`, `idea`, `worked-well` and `experience-report`; private vulnerability reporting is on.

## Done when

- The plugin and CLI version is 0.1.0, and the tag `v0.1.0` exists.
- `hitld release propose` has drafted the bump and the notes, and the owner made the release with `hitld release make`, which wrote the first release record.
- A fresh clone of a fixture consumer installs the plugin pinned to the tag, and `hitld check contract` passes.
- Every item this one needs is Done, and the first-release milestone's check has passed.
- The first commit is signed off by the owner (DCO).
- The issue labels exist and private vulnerability reporting is on.
