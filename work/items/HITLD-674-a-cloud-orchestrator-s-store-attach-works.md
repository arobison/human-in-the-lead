---
id: HITLD-674
title: A cloud orchestrator's store attach works without the owner's approval each time
kind: work
state: proposed
created: 2026-11-21
project: HITLD-15
needs: [HITLD-142]
---

## Why

HITLD-142 (done) put a rule in the chief-of-staff skill: `create_session` attaches one repository at start, so the chief of staff passes the attach tool in `extra_allowed_tools` and the orchestrator attaches the store repository itself. In the first self-hosted run that did not work. A grant the creating session does not itself hold is dropped, and the harness's permission check refused the orchestrator's attach (it reported "Unauthorized Access" and stopped, as it should). The orchestrator could not reach the store, so the run's ledger exists only in its container and every merge since its hand-over is unrecorded. The owner chose to allow the attach and asked for it to be automatic from now on (decisions HITLD-671 and HITLD-673).

## Done when

- First-run setup in the chief-of-staff skill checks that this session holds the attach grant, and says in one line what the owner must allow once (a permission rule for the attach tool) when it does not, before any orchestrator is started.
- When an orchestrator's store check finds the store repository not attached, its report to the chief of staff says whether the attach was refused, and the chief of staff tells the owner once, naming it "the store repository", with the exact step.
- A session that is started without the store repository and needs it is never left silently holding state that exists only in its container: the run refuses to go past setup until the store syncs, or the owner says in their own message to go on without it (the rule HITLD-142 wrote, now shown by a test that the grant reaches the orchestrator).
- Tests cover a held grant, a dropped grant and a refused attach. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Related: permission denials are typed faults that escalate (HITLD-186). The harness limit stays: no session can attach a repository to another, and `create_session` takes one source. Raised by the owner, 2026-11-21.

On 2026-11-21 the harness refused an orchestrator's attach twice, the second time after the owner's approval was relayed through the chief of staff. A relayed approval is not accepted for this tool: the owner's own message in that session, or a permission rule for the attach tool in the owner's settings, is what counts. So the permission rule is part of this item's fix, not an optional extra.

## Questions to walk through (the owner, 2026-11-21)

The owner asked whether the system can solve this itself, without the owner changing settings or permission rules each time. What it cannot do is approve its own access: a sub-session attaching a repository to itself is an access grant, and the harness requires the owner's own word for it (the same principle as design 4.6). A relayed approval from the chief of staff is refused. What it can do, to walk through one question at a time:

- **Check at first-run setup, once.** The grant the chief of staff passes down (HITLD-142) is dropped when the chief of staff's own session does not hold the attach tool. Setup should check for it and tell the owner once what to allow, before any orchestrator starts, so the one step that stays the owner's is explicit and up front, not discovered in the middle of a run. This is the item's core.
- **A scoped credential for the store in the environment, so no per-session attach is needed.** Any session in the environment could reach the store with it. The cost is a token with access to the store repository living in the environment, and it is not yet known whether the harness's credential injection would clash with its own GitHub access. Needs a check before it is offered.
- **Fewer hand-overs.** Each hand-over starts a fresh session that needs the attach again. Handing over less often (by the orchestrator's limits and its cadence) reduces how often the step arises.
