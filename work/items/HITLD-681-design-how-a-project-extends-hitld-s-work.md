---
id: HITLD-681
title: Design how a project extends HITLD's work-tracking views without rebuilding them
kind: work
state: proposed
created: 2026-11-21
project: HITLD-15
---

## Done when

- The owner has walked through the design one question at a time, and each answer is recorded as a decision.
- The design says how a project adds to HITLD's work-tracking views without rebuilding them, what is data and what (if anything) is code, and marks what is built and what is not.
- Build items are filed from the decisions, each with its own done-when.
- `hitld work check` passes.

## Why

The owner (2026-11-21) is rebuilding the same work-tracking UI in each project that uses HITLD, and wants it to live in HITLD, be reused by projects, and be extensible so a project can add to it. HITLD already has the reusable part: `hitld dashboard` writes one static page (design 12.1.3 and 12.4) and `hitld dashboard --json` returns its versioned data contract so richer views read the same data; projects can declare their own item fields in `tracker.json` (HITLD-18). It has no way for a project to add a panel or view without forking the page.

## Notes

The chief of staff's recommendation, to be walked through and not yet decided: the data contract is the product and the page is its reference renderer; extensions are data, not code; code only through the release.

Questions to walk through, one at a time:

- **The contract.** Which parts of the view model are the stable, versioned surface (items, claims, state history, ledger summaries, usage), and how a project's own fields appear in it.
- **Declarative panels.** A project declares extra panels as data: a named filter over its fields, columns, grouping and a chart from a closed set. What the closed set is, and where the declaration lives (the project's policy or a views file).
- **Evidence panels from adapters.** A project's evidence source returns typed view-model fragments carrying a classification label (HITLD-632 to 635); HITLD renders them and refuses to inline data whose label does not allow the page's reach. How this connects to the measurement-tool design (HITLD-609).
- **Code extensions.** Whether any are allowed. If so, only as versioned, owner-approved code in the pinned plugin, never loaded from data an agent can edit (the rule from the dyno exchange: configuration names no code to run, except in a property HITLD marks as executing and the owner approves).
- **Projects are blind to each other (HITLD-549).** The page stays per project. Whether a person-level view across projects exists at all, and if so only as the owner's explicit opt-in.
- **Where it runs and how it stays fresh.** Static file or published page, regenerated on events (event-first cadence, HITLD-536), and what the page says about when and where its data was read.
- **Size.** Whether to build only the contract and declarative panels first and leave a plugin UI framework out unless a real need shows up.
