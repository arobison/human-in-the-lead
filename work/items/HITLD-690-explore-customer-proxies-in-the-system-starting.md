---
id: HITLD-690
title: Explore customer proxies in the system, starting from arXiv 2510.08338
kind: work
state: proposed
created: 2026-11-21
project: HITLD-15
---

## Done when

- The paper (https://arxiv.org/pdf/2510.08338) has been read, and a short note says what it proposes, what evidence it gives that its proxy is faithful, and what its limits are.
- The owner has decided whether customer proxies belong in the design and, if so, where in the loops they would act, with the questions below walked through one at a time and each answer recorded as a decision.
- Build items are filed from the decisions, each with its own done-when, or the item is closed with the reason a proxy does not fit.
- `hitld work check` passes.

## Why

The owner's idea (2026-11-21, to explore later): use ideas from this paper to build customer proxies into the system. The chief of staff has not read the paper: the research environment could not reach arxiv.org and a search did not find it, so nothing below comes from it. The first step is to read it (the environment's network must allow the host, or the owner supplies the text).

## Notes

Questions to walk through once the paper is read, so the design starts from what a proxy is and is not:

- **What the proxy stands in for.** A customer or user of the project's product, answering questions a product decision needs (does this behave as a user would expect, which of two designs would they pick, what would they ask for). It is not the owner and never speaks for the owner.
- **Where it acts in the loops.** Candidates: intake and triage of reported issues (HITLD-29), design review before a build, acceptance of a finished item (as one more verifier, never the merger), and the planner's view of what matters.
- **A proxy never approves.** The system never grants itself autonomy and an approval comes only from the owner's own message (design 4.6). A proxy's answer is evidence for a human or a check, never a record of consent, and must not feed the trust engine as if it were an owner decision.
- **How its faithfulness is measured.** HITLD already holds real answers: the owner's recorded decisions and ratings, and precedents. A proxy could be calibrated against those and scored on held-out ones, with the score shown wherever its answer is used.
- **Confidentiality.** What the proxy is told about the product and the customer (classification labels, HITLD-632 to 635), where it runs and on which model's clearance, and what its transcripts may reveal.
- **Cost and cadence.** An answer costs tokens; when it is worth asking, how many questions, and how it fits the token budget and the attention budget.
- **Who builds the persona.** Where the description of the customer comes from, who may change it, and how a drifting persona is noticed.
