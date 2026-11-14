---
id: HITLD-38
title: Machine detection with `hitld machine detect`
kind: work
status: In progress
created: 2026-11-14
project: HITLD-15
milestone: settings-hold
needs: [HITLD-37]
claimed: D-38
---

## Why

Per design 13.4: the machine profile starts from what the machine has, but the system never assumes silently. Projects name what work needs (gpu, browser, quiet); an item needing a resource this machine lacks must wait here with the reason shown.

A machine also has a role: dedicated, workstation, cloud VM or CI. The role sets the defaults (a dedicated machine may take most of its cores, a workstation takes half, a cloud VM or CI runner has no person to confirm anything) and is detected from local hints, never from the network.

## Done when

- `hitld machine detect` probes cores, memory, GPUs, browsers and the operating system on macOS and Linux, and prints a proposed profile with conservative shares; it writes nothing until the person confirms.
- The profile records what was detected and when; a later probe that finds less warns and uses the smaller value.
- An item needing a resource the machine lacks is not dispatched, and the orchestrator states why.
- A fixture cloud session gets its own profile at start.
- The roles are dedicated, workstation, cloud VM and CI. Each has defaults for shares, load thresholds and confirmation: a workstation starts at half the cores and memory, a dedicated machine higher, and a cloud VM or CI runner takes conservative detected values, recorded without asking.
- The role is detected from local hints (a CI environment variable, a cloud metadata file, no display, no logged-in session), proposed with the profile, and overridden only by the person in the machine file.
- A fixture for each role detects as that role and gets its defaults.
