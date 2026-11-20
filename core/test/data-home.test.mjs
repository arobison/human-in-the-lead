// The Windows move of the data directory (HITLD-249): from ~/.local/share/human-in-the-lead to
// %LOCALAPPDATA%\human-in-the-lead. These run on every platform with the platform injected; a
// cross-volume move is simulated with a rename that fails with EXDEV.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  dataDirPath,
  entryDir,
  isMoveLeftover,
  moveOldEntry,
  siblingEntry,
} from '../lib/store/data-home.mjs';
import { openStore, privateStorePath } from '../lib/store/store.mjs';
import { settingsLocation } from '../lib/settings/files.mjs';
import { pinnedProjects } from '../lib/settings/pins.mjs';
import { tempDir } from './helpers/tmp.mjs';

const WIN = /** @type {const} */ ('win32');

/** A home with a project store and _machine at the old Windows place. */
function oldHome() {
  const home = tempDir('hitld-win-home-');
  const old = join(home, '.local', 'share', 'human-in-the-lead');
  mkdirSync(join(old, 'p', 'runs', 'R-1'), { recursive: true });
  writeFileSync(join(old, 'p', 'ledger.jsonl'), '{"a":1}\n');
  writeFileSync(join(old, 'p', 'runs', 'R-1', 'run-state.json'), '{}');
  mkdirSync(join(old, 'q'));
  writeFileSync(join(old, 'q', 'ledger.jsonl'), '{"q":1}\n');
  mkdirSync(join(old, '_machine', 'locks'), { recursive: true });
  writeFileSync(join(old, '_machine', 'machine.json'), '{"schema_version":1}');
  const local = join(home, 'AppData', 'Local');
  const now = join(local, 'human-in-the-lead');
  /** @type {string[]} */
  const messages = [];
  const o = {
    env: { LOCALAPPDATA: local },
    home,
    cwd: home,
    platform: WIN,
    report: (/** @type {string} */ m) => void messages.push(m),
  };
  return { home, old, local, now, o, messages };
}

/** A pid that is not running: a child that has exited. */
const deadPid = () => spawnSync(process.execPath, ['-e', '0']).pid;

/** @param {string} dir */
const leftovers = (dir) => (existsSync(dir) ? readdirSync(dir).filter(isMoveLeftover) : []);

test('on Windows a store at the old place moves on first use, once, with a message', () => {
  const { old, now, o, messages } = oldHome();
  const path = privateStorePath('p', o);
  assert.equal(path, join(now, 'p'));
  assert.equal(readFileSync(join(path, 'ledger.jsonl'), 'utf8'), '{"a":1}\n');
  assert.equal(readFileSync(join(path, 'runs', 'R-1', 'run-state.json'), 'utf8'), '{}');
  assert.equal(existsSync(join(old, 'p')), false);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /moved the store for p from /);
  assert.doesNotMatch(messages[0], /\bq\b/, 'it names only the project at hand');
  assert.equal(existsSync(join(old, 'q', 'ledger.jsonl')), true, 'other projects wait their turn');

  assert.equal(privateStorePath('p', o), path);
  assert.equal(moveOldEntry('p', o).state, 'not-there', 'a second run does nothing');
  assert.equal(messages.length, 1);

  const machine = settingsLocation('machine', o);
  assert.equal(machine.dir, join(now, '_machine'));
  assert.equal(readFileSync(machine.path, 'utf8'), '{"schema_version":1}');
  privateStorePath('q', o);
  assert.equal(existsSync(old), false, 'the old directory goes once it is empty');
  assert.deepEqual(leftovers(now), ['.move-notes.json']);
});

test('XDG_DATA_HOME and other platforms never move anything', () => {
  const { home, old, o } = oldHome();
  const report = () => assert.fail('no message');
  for (const opts of [
    { ...o, platform: /** @type {const} */ ('linux'), report },
    { ...o, env: { ...o.env, XDG_DATA_HOME: join(home, 'data') }, report },
  ]) {
    assert.equal(moveOldEntry('p', opts).state, 'not-there');
    entryDir('p', opts);
  }
  assert.equal(existsSync(join(old, 'p', 'ledger.jsonl')), true);
});

test('LOCALAPPDATA is read whatever its case, as Windows does', () => {
  assert.equal(
    dataDirPath({ env: { LocalAppData: '/l' }, home: '/h', platform: WIN }),
    join('/l', 'human-in-the-lead'),
  );
});

test('a store with executor worktrees or a live run lease stays where it is, and resolves there', () => {
  const { old, now, o, messages } = oldHome();
  mkdirSync(join(old, 'p', 'worktrees', 'D-1'), { recursive: true });
  assert.equal(entryDir('p', o), join(old, 'p'));
  assert.equal(messages.length, 1);
  assert.match(messages[0], /the store for p is not at .* yet: .*worktrees/);
  // A write goes to the store where it is; no second store appears at the new place.
  openStore(privateStorePath('p', o)).append('ledger.jsonl', '{"a":2}\n');
  assert.equal(existsSync(join(now, 'p')), false);
  assert.equal(moveOldEntry('p', o).quiet, true, 'the next process within minutes says nothing');

  rmSync(join(old, 'p', 'worktrees'), { recursive: true });
  const at = Date.now();
  writeFileSync(
    join(old, 'p', 'run-state.json'),
    JSON.stringify({ lease: { renewed_at: new Date(at).toISOString() } }),
  );
  const later = { ...o, now: () => at + 11 * 60_000 };
  assert.equal(moveOldEntry('p', { ...later, now: () => at + 60_000 }).quiet, true);
  assert.match(moveOldEntry('p', later).reason ?? '', /run lease/);
  writeFileSync(
    join(old, 'p', 'run-state.json'),
    JSON.stringify({ lease: { renewed_at: new Date(at).toISOString(), released: { at } } }),
  );
  assert.equal(moveOldEntry('p', { ...o, now: () => at + 22 * 60_000 }).state, 'moved');
  assert.equal(readFileSync(join(now, 'p', 'ledger.jsonl'), 'utf8'), '{"a":1}\n{"a":2}\n');
});

test('_machine stays while a resource lock holder is alive, and moves once it is gone', () => {
  const { old, now, o } = oldHome();
  const lock = join(old, '_machine', 'locks', 'gpu.lock');
  writeFileSync(lock, JSON.stringify({ holder: 'x', pid: process.pid }));
  assert.match(moveOldEntry('_machine', o).reason ?? '', /resource lock is held/);
  assert.equal(settingsLocation('machine', o).dir, join(old, '_machine'));
  assert.equal(siblingEntry(join(now, 'p'), '_machine', o), join(old, '_machine'));
  writeFileSync(lock, JSON.stringify({ holder: 'x', pid: deadPid() }));
  const later = { ...o, now: () => Date.now() + 11 * 60_000 };
  assert.equal(moveOldEntry('_machine', later).state, 'moved');
  assert.equal(siblingEntry(join(old, 'p'), '_machine', later), join(now, '_machine'));
});

/** A rename that fails with EXDEV from the old place to the new one, as across volumes. */
const crossVolume = (/** @type {string} */ old, /** @type {string} */ now) => ({
  rename: (/** @type {string} */ from, /** @type {string} */ to) => {
    if (from.startsWith(old) && to.startsWith(now)) {
      throw Object.assign(new Error('EXDEV: cross-device link not permitted'), { code: 'EXDEV' });
    }
    renameSync(from, to);
  },
});

test('across volumes: copied under a temporary name, renamed into place, nothing left behind', () => {
  const { old, now, o } = oldHome();
  mkdirSync(now, { recursive: true });
  mkdirSync(join(now, '.p.moving-4242'));
  writeFileSync(join(now, '.p.moving-4242', 'ledger.jsonl'), 'partial');
  const r = moveOldEntry('p', { ...o, seam: crossVolume(old, now) });
  assert.equal(r.state, 'moved');
  assert.equal(readFileSync(join(now, 'p', 'ledger.jsonl'), 'utf8'), '{"a":1}\n');
  assert.equal(readFileSync(join(now, 'p', 'runs', 'R-1', 'run-state.json'), 'utf8'), '{}');
  assert.deepEqual(leftovers(now), ['.move-notes.json'], 'a stale temporary copy is swept');
  assert.deepEqual(leftovers(old), []);
});

test('across volumes: a removal that fails says the copy can be deleted, and the next run finishes it', () => {
  const { old, now, o, messages } = oldHome();
  const seam = {
    ...crossVolume(old, now),
    rm: (/** @type {string} */ p, /** @type {any} */ opts) => {
      if (p.endsWith('.p.moved')) throw Object.assign(new Error('EBUSY: held'), { code: 'EBUSY' });
      rmSync(p, opts);
    },
  };
  assert.equal(entryDir('p', { ...o, seam }), join(now, 'p'));
  assert.match(messages[0], /the copy left at .*\.p\.moved can be deleted/);
  assert.doesNotMatch(messages[0], /could not be moved/);
  assert.equal(readFileSync(join(now, 'p', 'ledger.jsonl'), 'utf8'), '{"a":1}\n');
  const r = moveOldEntry('p', { ...o, now: () => Date.now() + 11 * 60_000 });
  assert.equal(r.state, 'moved', 'the aside copy matches the store, so it goes');
  assert.equal(existsSync(join(old, '.p.moved')), false);
});

test('across volumes: a move that stopped after the source went aside is finished', () => {
  const { old, now, o } = oldHome();
  renameSync(join(old, 'p'), join(old, '.p.moved'));
  assert.equal(moveOldEntry('p', o).state, 'moved');
  assert.equal(readFileSync(join(now, 'p', 'ledger.jsonl'), 'utf8'), '{"a":1}\n');
  assert.deepEqual(leftovers(old), []);
});

test('across volumes: a copy that fails puts the source back', () => {
  const { old, now, o } = oldHome();
  const seam = {
    rename: (/** @type {string} */ from, /** @type {string} */ to) => {
      if (from.startsWith(old) && to.startsWith(now))
        throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' });
      if (from.includes('.moving-')) throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
      renameSync(from, to);
    },
  };
  const r = moveOldEntry('p', { ...o, seam });
  assert.equal(r.state, 'left');
  assert.match(r.reason ?? '', /could not be moved \(ENOSPC\)/);
  assert.equal(readFileSync(join(old, 'p', 'ledger.jsonl'), 'utf8'), '{"a":1}\n');
  assert.deepEqual([leftovers(old), existsSync(join(now, 'p'))], [[], false]);
});

test('a rename that stays busy is given up within a bounded time, and the store resolves where it is', () => {
  const { old, now, o } = oldHome();
  const busy = () => {
    throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' });
  };
  const started = Date.now();
  const r = moveOldEntry('p', { ...o, seam: { rename: busy } });
  assert.ok(Date.now() - started < 2_000, 'retries share a small budget');
  assert.equal(r.state, 'left');
  assert.equal(r.path, join(old, 'p'));
  assert.equal(existsSync(join(now, 'p')), false);
});

test('an empty directory at the new place does not block the move; a full one is left and named', () => {
  const { old, now, o } = oldHome();
  mkdirSync(join(now, 'p'), { recursive: true });
  assert.equal(moveOldEntry('p', o).state, 'moved');
  mkdirSync(join(now, 'q'));
  writeFileSync(join(now, 'q', 'ledger.jsonl'), 'other\n');
  const r = moveOldEntry('q', o);
  assert.equal(r.state, 'both');
  assert.equal(r.path, join(now, 'q'));
  assert.equal(readFileSync(join(old, 'q', 'ledger.jsonl'), 'utf8'), '{"q":1}\n');
});

test('an executor, a link at the old place and an unwritable new place move nothing', () => {
  const { home, old, o } = oldHome();
  for (const env of [{ HITLD_ROLE: 'executor' }, { HITLD_DISPATCH: 'D-1' }]) {
    const r = moveOldEntry('p', { ...o, env: { ...o.env, ...env } });
    assert.equal(r.state, 'left');
    assert.match(r.reason ?? '', /an executor does not move it/);
  }
  writeFileSync(join(home, 'file'), '');
  const r = moveOldEntry('p', { ...o, env: { LOCALAPPDATA: join(home, 'file') } });
  assert.match(r.reason ?? '', /cannot be made/);
  assert.equal(r.path, join(old, 'p'));

  const elsewhere = join(home, 'elsewhere');
  renameSync(old, elsewhere);
  try {
    symlinkSync(elsewhere, old, 'junction');
  } catch {
    return; // links not allowed here (Windows without the right): the rest is checked
  }
  const linked = moveOldEntry('p', o);
  assert.match(linked.reason ?? '', /is a link/);
  assert.equal(existsSync(join(elsewhere, 'p', 'ledger.jsonl')), true);
});

test('pinnedProjects lists stores at both places and never a move leftover', () => {
  const { old, now, o } = oldHome();
  const ledger =
    JSON.stringify({ event: 'run-started', skill_versions: { hitld_version: '0.1.0-rc.1' } }) +
    '\n';
  for (const dir of [
    join(old, 'q'),
    join(now, 'r'),
    join(now, '.s.moving-12'),
    join(now, 'x.moved'),
    join(now, 'y.moving-1'),
  ]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'ledger.jsonl'), ledger);
  }
  const names = pinnedProjects(o).map((p) => p.project);
  assert.deepEqual(
    names.sort(),
    ['q', 'r', 'x.moved', 'y.moving-1'],
    'q at the old place, r at the new, valid IDs that look like move names, no leftover',
  );
});

test('four processes racing to move the same store across volumes: one moves it, nothing is lost or left', async () => {
  const { old, now, home, local } = oldHome();
  for (let i = 0; i < 200; i++) writeFileSync(join(old, 'p', `f${i}.json`), `${i}`.repeat(1000));
  const mod = pathToFileURL(join(import.meta.dirname, '..', 'lib', 'store', 'data-home.mjs')).href;
  const script = `
    import { renameSync } from 'node:fs';
    import { moveOldEntry } from ${JSON.stringify(mod)};
    const [old, now, home, local] = process.argv.slice(1);
    const rename = (from, to) => {
      if (from.startsWith(old) && to.startsWith(now)) throw Object.assign(new Error('EXDEV'), { code: 'EXDEV' });
      renameSync(from, to);
    };
    const r = moveOldEntry('p', { env: { LOCALAPPDATA: local }, home, platform: 'win32', seam: { rename } });
    process.stdout.write(r.state);`;
  const run = () =>
    new Promise((done) => {
      const child = spawn(
        process.execPath,
        ['--input-type=module', '-e', script, old, now, home, local],
        { stdio: ['ignore', 'pipe', 'inherit'] },
      );
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.on('close', () => done(out));
    });
  const states = await Promise.all([run(), run(), run(), run()]);
  assert.equal(states.filter((s) => s === 'moved').length, 1, states.join(','));
  assert.ok(
    states.every((s) => s === 'moved' || s === 'not-there'),
    states.join(','),
  );
  assert.equal(readFileSync(join(now, 'p', 'ledger.jsonl'), 'utf8'), '{"a":1}\n');
  assert.equal(readdirSync(join(now, 'p')).length, 202);
  assert.deepEqual(leftovers(old), []);
  assert.deepEqual(
    leftovers(now).filter((f) => f !== '.move-notes.json'),
    [],
  );
});

const LATER = 11 * 60_000;

test('A: a failed removal is finished later even after the store was written to', () => {
  const { old, now, o } = oldHome();
  const seam = {
    ...crossVolume(old, now),
    rm: (/** @type {string} */ p, /** @type {any} */ opts) => {
      if (p.endsWith('.p.moved')) throw Object.assign(new Error('EBUSY: held'), { code: 'EBUSY' });
      rmSync(p, opts);
    },
  };
  assert.equal(moveOldEntry('p', { ...o, seam }).state, 'leftover');
  openStore(join(now, 'p')).append('ledger.jsonl', '{"a":2}\n');
  const r = moveOldEntry('p', { ...o, now: () => Date.now() + LATER });
  assert.equal(r.state, 'moved', r.reason);
  assert.equal(existsSync(join(old, '.p.moved')), false, 'the aside copy is gone');
  assert.equal(existsSync(join(now, 'p', '.hitld-moved.tmp')), false, 'and so is the marker');
  assert.equal(readFileSync(join(now, 'p', 'ledger.jsonl'), 'utf8'), '{"a":1}\n{"a":2}\n');
});

test('B: an interrupted move with no store at either path is an error, never a new store', () => {
  const { old, now, o } = oldHome();
  renameSync(join(old, 'p'), join(old, '.p.moved'));
  assert.throws(
    () => privateStorePath('p', { ...o, env: { ...o.env, HITLD_ROLE: 'executor' } }),
    /a move of the store for p was interrupted at .*\.p\.moved; .*run hitld outside an executor/,
  );
  assert.equal(existsSync(join(old, 'p')), false, 'no second store at the old path');
  assert.equal(existsSync(join(now, 'p')), false);

  const seam = {
    rename: (/** @type {string} */ from, /** @type {string} */ to) => {
      if (from.includes('.moving-'))
        throw Object.assign(new Error('ENOSPC: no space'), { code: 'ENOSPC' });
      renameSync(from, to);
    },
  };
  assert.throws(
    () => moveOldEntry('p', { ...o, seam }),
    (e) => {
      assert.match(String(e), /interrupted at .*finishing it failed \(ENOSPC: no space\)/);
      assert.doesNotMatch(String(e), /another hitld process/);
      return true;
    },
  );
  const started = Date.now();
  assert.throws(() => moveOldEntry('p', o), /interrupted .*ENOSPC/, 'noted: it fails at once');
  assert.ok(Date.now() - started < 1_000);
  assert.equal(moveOldEntry('p', { ...o, now: () => Date.now() + LATER }).state, 'moved');
  assert.equal(readFileSync(join(now, 'p', 'ledger.jsonl'), 'utf8'), '{"a":1}\n');
});

test('C: a stray store at the old place with only new paths is absorbed', () => {
  const { old, now, o } = oldHome();
  assert.equal(moveOldEntry('p', o).state, 'moved');
  mkdirSync(join(old, 'p', 'notes'), { recursive: true });
  writeFileSync(join(old, 'p', 'notes', 'n.md'), 'from an older release\n');
  const r = moveOldEntry('p', o);
  assert.equal(r.state, 'moved', r.reason);
  assert.equal(readFileSync(join(now, 'p', 'notes', 'n.md'), 'utf8'), 'from an older release\n');
  assert.equal(readFileSync(join(now, 'p', 'ledger.jsonl'), 'utf8'), '{"a":1}\n');
  assert.equal(existsSync(join(old, 'p')), false);
});

test('C: a stray ledger at both places is left, named, with the steps, once a day', () => {
  const { old, now, o, messages } = oldHome();
  assert.equal(moveOldEntry('p', o).state, 'moved');
  mkdirSync(join(old, 'p'));
  writeFileSync(join(old, 'p', 'ledger.jsonl'), '{"stray":1}\n');
  writeFileSync(join(old, 'p', 'extra.md'), 'x');
  assert.equal(entryDir('p', o), join(now, 'p'));
  assert.equal(messages.length, 1);
  assert.match(
    messages[0],
    /Only at .*: extra\.md\. At both: ledger\.jsonl; of these, of different size: ledger\.jsonl/,
  );
  assert.match(messages[0], /To merge by hand: stop every session/);
  assert.match(messages[0], /once a day/);
  assert.equal(readFileSync(join(old, 'p', 'ledger.jsonl'), 'utf8'), '{"stray":1}\n');
  assert.equal(readFileSync(join(now, 'p', 'ledger.jsonl'), 'utf8'), '{"a":1}\n');
  const t = Date.now();
  assert.equal(moveOldEntry('p', { ...o, now: () => t + 2 * 60 * 60_000 }).quiet, true);
  const again = moveOldEntry('p', { ...o, now: () => t + 25 * 60 * 60_000 });
  assert.equal(again.state, 'both');
  assert.equal(again.quiet, undefined, 'a day later it is said again');
});

test('a note dated in the future holds nothing', () => {
  const { now, o } = oldHome();
  mkdirSync(now, { recursive: true });
  writeFileSync(join(now, '.move-notes.json'), JSON.stringify({ p: { at: 9e15 } }));
  assert.equal(moveOldEntry('p', o).state, 'moved');
});

test('a lock held by a live process is waited for once, then noted, and the next call is at once', () => {
  const { old, now, o } = oldHome();
  mkdirSync(join(now, '.p.move-lock'), { recursive: true });
  writeFileSync(join(now, '.p.move-lock', 'owner'), `${process.pid}\n`);
  const r = moveOldEntry('p', o);
  assert.equal(r.state, 'left');
  assert.match(r.reason ?? '', /timed out waiting for the lock/);
  assert.equal(r.path, join(old, 'p'));
  const started = Date.now();
  assert.equal(moveOldEntry('p', o).quiet, true);
  assert.ok(Date.now() - started < 1_000);
});
