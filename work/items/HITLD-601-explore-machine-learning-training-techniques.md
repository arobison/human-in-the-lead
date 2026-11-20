---
id: HITLD-601
title: "Explore machine-learning training techniques for controlling the system's behavior: evals as reward, the owner's decisions as preference data, held-out sets, alignment"
kind: work
state: proposed
created: 2026-11-20
project: HITLD-15
---

## Why

The owner said on 2026-11-20 that as the amount of self-improvement and learning in HITLd grows, it will most likely need training techniques from machine learning research, borrowing from how large language models are trained, to control the system's behavior through evals, alignment, and pre- and post-training. The design has the guardrails but not the method: design part 18.3 (a protected core, a sealed eval set the improving agents never see, head-to-head comparison, diverse checking) and part 17 (evals and graders) say how to keep self-grading honest, and the learning loop proposes changes to skills, briefs, templates, controllers and policy defaults (part 2, part 18 stage 2). Nothing says how to search for better changes or how to learn from the owner's decisions systematically. The friction signals (HITLD-595) and controller (HITLD-596) will produce data.

## What the study should cover

- **What the "weights" are.** HITLd does not train model weights. What it tunes is the protected core: skills, briefs, templates, policy defaults, controller settings and the model catalog's rungs. Name each and what changes it.
- **Reward and preference signals.** Candidates: verifiable outcomes (tests, CI, the mechanical verifiability gate of HITLD-518, evals that pass), the owner's recorded decisions and their accepted or rejected proposals (each decision with its options and the chosen one is a labeled preference), rework and reverts, friction events (HITLD-595). Which are trustworthy, how much data each gives, and how a judge-style grader is calibrated against the owner's ratings.
- **Search and optimization methods** that fit a protected core without differentiable training: optimizing skill and brief wording against evals, bandits for the model-and-effort cascade (HITLD-581), Bayesian updating of estimates (HITLD-81), recalibration when a new model arrives (design part 11).
- **Whether to fine-tune any model.** Possibly small narrow roles later (a friction classifier, a curator audit classifier) once a labeled dataset exists; the constraints are that data is per project and confidential (HITLD-490), small, and that the frontier models in use are not ours to tune.
- **Alignment as control, not training.** The decision rights and the trust engine (HITLD-507) are the control layer; the study says what the learning loop may change on its own and what needs the owner, so a learner cannot widen its own authority (design 4.6).
- **Failure modes.** Overfitting the evals and gaming them (Goodhart), contamination of the sealed set, data scarcity with the owner as the only ground truth, distribution shift when models change, cost, and over-engineering.
- **A first experiment**, small and replayable: for example optimizing the chief-of-staff skill's wording against the friction rate per decision on a sealed set of replayed interactions, with the owner deciding adoption.

## Done when

- The owner reads a written study that answers the questions above with a recommendation and a first experiment, and decides what to build. Nothing is built by this item.
- The study cites its sources for any claim about machine-learning practice and marks what is the chief of staff's own reasoning.

## Notes

Design-heavy exploration, the owner's idea to explore later: it stays `proposed` and is walked through with the owner when the friction signals exist and have produced data. Not a need of any release stage. Placed under HITLD-408 c2 (learned state and the measuring of the system's own work) by the chief of staff, a proposal for the owner to move. Related: design parts 17 and 18, HITLD-52, 57 and 70 (evals), HITLD-112 (learned state), HITLD-507, 581, 587, 595, 596.
