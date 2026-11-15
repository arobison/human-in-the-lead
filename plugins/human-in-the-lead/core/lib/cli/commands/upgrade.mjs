// Upgrades (design part 16.5, Upgrades): `hitld upgrade plan` says what moving to the pinned
// release takes, in order, and who does each step. It reads the release records and changes
// nothing. The work is in core/lib/install/upgrade.mjs; the drift it starts from is
// core/lib/install/drift.mjs.

import { readLedger } from '../../ledger/ledger.mjs';
import { inflight } from '../../ledger/inflight.mjs';
import { projectDrift } from '../../install/drift.mjs';
import { upgradePlan } from '../../install/upgrade.mjs';

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'upgrade plan',
    summary:
      'What upgrading to the pinned release takes: the release notes and interface delta on the way, the migrations to run, the restart, and what each role does, in order. Reads only',
    built_by: 'first-release',
    args: [
      {
        name: 'to',
        type: 'string',
        description:
          'The release to upgrade to, such as 0.2.0. Default: the release the pin in .claude/settings.json names',
      },
      {
        name: 'from',
        type: 'string',
        description:
          "The release to upgrade from. Default: the release that last wrote the run's data (the ledger), or this session's",
      },
      {
        name: 'records',
        type: 'string',
        description:
          "A directory of release records (work/releases of a checkout at the target release). Default: the marketplace's clone in the Claude Code plugins directory, then this hitld's own checkout",
      },
      {
        name: 'store',
        type: 'string',
        description: "The private store directory. Default: the project's, from policy.json",
      },
    ],
    output: [
      'ok',
      'from',
      'to',
      'due',
      'message',
      'records_from',
      'releases',
      'same_minor',
      'breaking',
      'migrations',
      'steps',
      'roles',
      'changes',
      'version',
    ],
    run: (input, ctx) => {
      const d = projectDrift({
        cwd: ctx.cwd,
        env: ctx.env,
        store: typeof input.store === 'string' ? input.store : undefined,
      });
      const to = typeof input.to === 'string' ? input.to : d.pin?.version;
      if (!to) {
        return {
          ok: false,
          error: 'usage',
          message: d.pin
            ? `the pin (${d.pin.where}) names no release: give --to <version>`
            : 'this project declares no pin in .claude/settings.json: give --to <version>',
        };
      }
      const from = typeof input.from === 'string' ? input.from : (d.data.version ?? d.running);
      const inFlight = d.store ? inflight(readLedger(d.store).events) : [];
      const plan = upgradePlan({
        from,
        to,
        records: typeof input.records === 'string' ? input.records : undefined,
        env: ctx.env,
        pinVersion: d.pin?.version ?? null,
        inFlight,
      });
      return {
        ...plan,
        version: {
          running: d.running,
          pin: d.pin,
          data: d.data,
          ...(d.refusal ? { refusal: d.refusal } : {}),
          ...(d.warnings.length ? { warnings: d.warnings } : {}),
        },
      };
    },
  },
];
