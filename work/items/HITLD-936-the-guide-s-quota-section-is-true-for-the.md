---
id: HITLD-936
title: The guide's quota section is true for the release, with a working declared-limit example, and the gate says no reading yet
kind: work
state: done
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c1]
claimed_by: D-01M860KZKQ2PA2WP
---

## Why

The guide says the default quota is the weekly window; rc.1 stops on `claude-five-hour` with 'no snapshot yet' and its reason reads 'stop at the reserve' when the truth is 'no reading'; declaring a limit took three tries reading the schema, one error per run. Current main binds on `claude-weekly`.

## Done when

- The guide's quota section matches the release it pins, with a working declared-limit example (the `config write person` command that worked).
- The gate's reason reads 'no reading yet' when there is no reading.
- The guide marks what is true only after rc.1.
- `hitld work check` and the spelling check pass.


## Notes

From the Fable consumer-eye walkthrough of 2026-11-22 (C7); decision HITLD-932. Joins Consumer live (HITLD-67) clause c1 as a recorded exception to the freeze: it breaks a first consumer's first hour.
