---
id: HITLD-101
title: The store follows the owner
kind: milestone
state: done
created: 2026-11-15
project: HITLD-15
outcome: A project's private store is the same on every machine and session the owner uses, with no file carried by hand and no key handled by an agent.
done_when:
  - "c1: A run started in one cloud session, discarded after a checkpoint, resumes in a new cloud session with its ledger, trust record and open decisions intact."
  - "c2: A local machine and a cloud environment, both enrolled, each work on the project in turn, and each sees the other's records after its next pull."
  - "c3: A removed device cannot open anything pushed after its removal."
  - "c4: The storage holds no plain text of the store, checked by a scan of the remote."
  - "c5: No skill or agent prompt mentions a key, a passphrase or a store file path; every store move is a hitld command or a hook."
check: demo c1 to c3 against a real private repository, run by someone other than the items' authors
check_results:
  - "pass 2026-11-15 owner: the owner's verdict \"pass\" on the demo against a real private store repository with two cloud environments: c1 a run discarded after a checkpoint resumed in a fresh session with its ledger, trust record and open decision HITLD-117 intact, after lease-held and a retire; c2 each environment took a turn and saw the other's records on its next pull; c3 after the owner removed the second environment (HITLD-118) the push re-sealed to one device and pruned the remote to one bundle, and the removed key's pull, push and resume were refused; c4 no store text in any of the remote's objects; c5 the prompt test passes and no key was printed"
---

## Notes

From design 0003, section 14. The owner decided v0.1.0-rc.1 waits for this milestone (HITLD-108, Q8).
