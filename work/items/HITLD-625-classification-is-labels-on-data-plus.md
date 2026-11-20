---
id: HITLD-625
title: Classification is labels on data plus clearances on channels, in two dimensions
kind: decision
state: done
created: 2026-11-20
project: HITLD-15
decider: owner
answer: Labels plus channel clearances (Recommended)
answered_at: 2026-11-20T03:39:29.972Z
answered_via: question-tool
answered_by: owner
---

## Question

How should HITLD structure classification: one longer ladder, labels plus channel clearances, or IAM-style policy rules?

The design has four levels on one ladder (public, internal, confidential, secret). The owner listed cases that do not fit one order (ok for remote models, local model only, never exposed to any agent, never leaves the machine) and asked how AWS and GCP handle this (HITLD-620).

## Options and recommendation

- A. Labels plus channel clearances: Data carries a label with two dimensions (who or what may read it, where it may go); each channel has a clearance; data flows only to a channel whose clearance covers the label in each dimension; default deny, an explicit deny wins, owner guardrails can only narrow; the four levels stay as shorthands
- B. One longer ladder: Add levels on one ladder
- C. Policy rules, IAM style: Explicit allow and deny rules with conditions

Recommended: Labels plus channel clearances. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
