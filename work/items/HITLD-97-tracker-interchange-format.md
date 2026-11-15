---
id: HITLD-97
title: "Tracker interchange format: schema, untrusted text with authors, the header"
kind: work
state: planned
created: 2026-11-15
project: HITLD-95
---

## Why

Import and switch (design 0002, section 10) moves a project's items from a hosted tracker into HITLd's model. The interchange file is what a fetch writes and the import reads: one schema, so the import never reads a tracker's raw output.

## Done when

- `schemas/tracker-interchange.schema.json` describes the file as in 0002 section 10.1: the header (source tracker, workspace, fetched at, fetcher), items with their fields, states and relations, and every piece of tracker text marked as untrusted with its author.
- The text fields are data the import shows and stores, never instructions (0002 section 9.1); a test feeds a file whose text holds instructions and checks nothing acts on them.
- The schema is part of the public interface (design 16.5) and is listed with the others.
- `npm run check`, the offline eval gate and `hitld work check` pass.
