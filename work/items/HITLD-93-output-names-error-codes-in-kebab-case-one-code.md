---
id: HITLD-93
title: "Output names: error codes in kebab-case, one code per meaning, the dashboard page is dashboard.html"
kind: work
state: planned
created: 2026-11-15
project: HITLD-15
---

## Why

Every value is lowercase kebab-case since the rename pass (HITLD-82), but the `error` codes in the `hitld` command's JSON are snake_case (`not_permitted`, `output_path`), and some mean the same thing under different names (`not_permitted`, `not_allowed`, `refused`). `hitld dashboard` writes `report.html`, so the command and its page disagree. Agents and scripts match on these names, so they are cheapest to fix before the first release. The owner decided both before v0.1.0-rc.1, as output: no fallback, listed in the release notes (design 16.5, what a 0.y.z release still keeps).

## Done when

- Every `error` code the `hitld` command and the MCP server return is lowercase kebab-case, and codes that mean the same thing are one code. A test lists every code the command table can return and fails on one that is not kebab-case.
- `hitld dashboard` writes `dashboard.html` and `digest.txt`; the output-directory marker accepts a directory written before under `report.html`.
- The skills, the design and the docs use the new names; the release notes for rc.1 list each renamed code and the page name.
- `npm run check`, the offline eval gate and `hitld work check` pass.
