// Machine detection (design part 13.4): what this machine has, what role it plays, and a proposed
// profile with conservative shares.
//
// Local only. The probes read the os module, /proc, /sys and the file system, and run `nvidia-smi`
// and `system_profiler` when they exist, as a program with an argument list and a timeout, never
// through a shell. Nothing here touches the network. All of it goes through `Sources`, a small
// seam, so tests fake each role and each probe result.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { arch, cpus, release, totalmem } from 'node:os';
import { delimiter, join } from 'node:path';

/**
 * @typedef {'dedicated' | 'workstation' | 'cloud-vm' | 'ci'} Role
 *
 * @typedef {object} Sources what the probes read; every part is replaceable in tests
 * @property {string} platform process.platform
 * @property {string} arch
 * @property {string} release
 * @property {number} cores
 * @property {number} memoryBytes
 * @property {NodeJS.ProcessEnv} env
 * @property {(path: string) => string | null} readText the file's text, or null when unreadable
 * @property {(path: string) => boolean} exists
 * @property {(file: string, args: string[]) => string | null} run a program with an argument list,
 *   its output, or null when it is missing, fails or times out
 *
 * @typedef {{ name: string, memory_mb?: number }} Gpu
 *
 * @typedef {object} Probe
 * @property {string} at ISO time of the probe
 * @property {{ platform: string, release: string, arch: string }} os
 * @property {number} cores what this machine (or its cgroup) lets the process use
 * @property {number} memory_mb
 * @property {Gpu[]} gpus
 * @property {string[]} browsers
 * @property {Role} role
 * @property {string[]} role_hints
 * @property {string[]} notes what could not be probed
 */

export const ROLES = /** @type {const} */ (['dedicated', 'workstation', 'cloud-vm', 'ci']);

const PROBE_TIMEOUT_MS = 5000;
const MB = 1024 * 1024;

/** The real sources: this machine. @returns {Sources} */
export function localSources() {
  return {
    platform: process.platform,
    arch: arch(),
    release: release(),
    cores: cpus().length,
    memoryBytes: totalmem(),
    env: process.env,
    readText: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
    exists: (path) => existsSync(path),
    run: (file, args) => {
      try {
        return execFileSync(file, args, {
          encoding: 'utf8',
          timeout: PROBE_TIMEOUT_MS,
          stdio: ['ignore', 'pipe', 'ignore'],
          maxBuffer: 4 * MB,
        });
      } catch {
        return null;
      }
    },
  };
}

/**
 * The cores a Linux control group allows, when it caps them below the machine's.
 * @param {Sources} s @returns {number | null}
 */
function cgroupCores(s) {
  const v2 = s.readText('/sys/fs/cgroup/cpu.max')?.trim().split(/\s+/);
  if (v2 && v2[0] !== 'max') {
    const quota = Number(v2[0]);
    const period = Number(v2[1]);
    if (quota > 0 && period > 0) return Math.max(1, Math.floor(quota / period));
  }
  const q = Number(s.readText('/sys/fs/cgroup/cpu/cpu.cfs_quota_us'));
  const p = Number(s.readText('/sys/fs/cgroup/cpu/cpu.cfs_period_us'));
  if (q > 0 && p > 0) return Math.max(1, Math.floor(q / p));
  return null;
}

/**
 * The memory a Linux control group allows, in bytes, when it caps it below the machine's.
 * @param {Sources} s @returns {number | null}
 */
function cgroupMemory(s) {
  for (const path of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
    const n = Number(s.readText(path)?.trim());
    // A huge number means "no limit" on cgroup v1.
    if (n > 0 && n < 2 ** 50) return n;
  }
  return null;
}

/**
 * GPUs: nvidia-smi where present; on macOS, system_profiler.
 * @param {Sources} s @param {string[]} notes @returns {Gpu[]}
 */
function probeGpus(s, notes) {
  /** @type {Gpu[]} */
  const gpus = [];
  const smi = s.run('nvidia-smi', [
    '--query-gpu=name,memory.total',
    '--format=csv,noheader,nounits',
  ]);
  if (smi) {
    for (const line of smi.split('\n')) {
      const [name, mem] = line.split(',').map((x) => x.trim());
      if (!name) continue;
      const mb = Number(mem);
      gpus.push(Number.isFinite(mb) && mem !== '' ? { name, memory_mb: Math.floor(mb) } : { name });
    }
  }
  if (s.platform === 'darwin') {
    const out = s.run('system_profiler', ['-json', 'SPDisplaysDataType']);
    if (out === null) {
      notes.push('system_profiler gave no answer: GPUs not probed');
    } else {
      try {
        const list = JSON.parse(out).SPDisplaysDataType ?? [];
        for (const g of list) {
          const name = g.sppci_model ?? g._name;
          if (typeof name === 'string' && name) gpus.push({ name });
        }
      } catch {
        notes.push('system_profiler output was not understood: GPUs not probed');
      }
    }
  }
  return gpus;
}

const LINUX_BROWSERS = /** @type {const} */ ([
  ['chrome', ['google-chrome', 'google-chrome-stable']],
  ['chromium', ['chromium', 'chromium-browser']],
  ['firefox', ['firefox']],
  ['edge', ['microsoft-edge', 'microsoft-edge-stable']],
]);
const MAC_BROWSERS = /** @type {const} */ ([
  ['chrome', 'Google Chrome.app'],
  ['chromium', 'Chromium.app'],
  ['firefox', 'Firefox.app'],
  ['edge', 'Microsoft Edge.app'],
  ['safari', 'Safari.app'],
]);

/**
 * Installed browsers, from file names only: programs on PATH (Linux) or app bundles (macOS).
 * Nothing is started.
 * @param {Sources} s @returns {string[]}
 */
function probeBrowsers(s) {
  /** @type {string[]} */
  const found = [];
  if (s.platform === 'darwin') {
    const roots = [
      '/Applications',
      '/System/Applications',
      join(s.env.HOME ?? '/nonexistent', 'Applications'),
    ];
    for (const [name, bundle] of MAC_BROWSERS) {
      if (roots.some((r) => s.exists(join(r, bundle)))) found.push(name);
    }
    return found;
  }
  const dirs = (s.env.PATH ?? '').split(delimiter).filter((d) => d.startsWith('/'));
  for (const [name, bins] of LINUX_BROWSERS) {
    if (bins.some((b) => dirs.some((d) => s.exists(join(d, b))))) found.push(name);
  }
  return found;
}

const CI_VARS = [
  'CI',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'BUILDKITE',
  'CIRCLECI',
  'JENKINS_URL',
  'TF_BUILD',
  'TEAMCITY_VERSION',
];
const CLOUD_ENV = ['CODESPACES', 'GITPOD_WORKSPACE_ID', 'CLAUDE_CODE_REMOTE'];
const CLOUD_FILES = ['/var/lib/cloud/instance', '/run/cloud-init/instance-data.json'];
const DMI_FILES = [
  '/sys/class/dmi/id/sys_vendor',
  '/sys/class/dmi/id/product_name',
  '/sys/class/dmi/id/chassis_asset_tag',
];
const CLOUD_DMI =
  /amazon ec2|google compute|digitalocean|hetzner|openstack|oracle ?cloud|alibaba|microsoft corporation.*virtual machine|azure/i;

/**
 * The role local hints point to, with the hints. Order matters: a CI variable beats a cloud marker,
 * and a cloud marker beats a headless machine, because a CI runner is often itself a cloud VM.
 * @param {Sources} s @returns {{ role: Role, hints: string[] }}
 */
export function detectRole(s) {
  const ci = CI_VARS.filter((v) => s.env[v] && s.env[v] !== 'false' && s.env[v] !== '0');
  if (ci.length) return { role: 'ci', hints: ci.map((v) => `environment variable ${v} is set`) };

  /** @type {string[]} */
  const cloud = CLOUD_ENV.filter((v) => s.env[v]).map((v) => `environment variable ${v} is set`);
  for (const f of CLOUD_FILES) if (s.exists(f)) cloud.push(`${f} exists`);
  for (const f of DMI_FILES) {
    const text = s.readText(f)?.trim();
    if (text && CLOUD_DMI.test(text)) cloud.push(`${f} says "${text}"`);
  }
  if (cloud.length) return { role: 'cloud-vm', hints: cloud };

  const linux = s.platform !== 'darwin';
  const remote = Boolean(s.env.SSH_CONNECTION || s.env.SSH_TTY);
  const display = linux ? Boolean(s.env.DISPLAY || s.env.WAYLAND_DISPLAY) : !remote;
  const sessionType = s.env.XDG_SESSION_TYPE;
  const session = linux
    ? Boolean(sessionType && sessionType !== 'tty' && sessionType !== 'unspecified')
    : !remote;
  if (!display && !session) {
    return {
      role: 'dedicated',
      hints: [
        linux ? 'no display and no desktop session' : 'only a remote shell, no console session',
      ],
    };
  }
  return {
    role: 'workstation',
    hints: [
      display ? (linux ? 'a display is set' : 'a macOS desktop') : 'a desktop session',
    ].concat(session && display ? ['a logged-in session'] : []),
  };
}

/**
 * Probe this machine through `sources`.
 * @param {Sources} [sources] default: this machine
 * @param {Date} [now]
 * @returns {Probe}
 */
export function probeMachine(sources = localSources(), now = new Date()) {
  const s = sources;
  /** @type {string[]} */
  const notes = [];
  if (s.platform !== 'darwin' && s.platform !== 'linux') {
    notes.push(
      `${s.platform} is not probed (macOS and Linux only): cores and memory from the os module`,
    );
  }
  let cores = s.cores;
  let memory = s.memoryBytes;
  if (s.platform === 'linux') {
    const c = cgroupCores(s);
    if (c !== null && c < cores) cores = c;
    const m = cgroupMemory(s);
    if (m !== null && m < memory) memory = m;
  }
  const { role, hints } = detectRole(s);
  return {
    at: now.toISOString(),
    os: { platform: s.platform, release: s.release, arch: s.arch },
    cores,
    memory_mb: Math.floor(memory / MB),
    gpus: probeGpus(s, notes),
    browsers: probeBrowsers(s),
    role,
    role_hints: hints,
    notes,
  };
}

/**
 * What a role starts with, from the probe (design part 13.4, machine roles). `confirm` says whether
 * a person confirms the profile before it is written.
 * @param {Role} role @param {{ cores: number, memory_mb: number }} have
 * @returns {{ cores: number, memory_ceiling_mb: number, max_executors: number,
 *   load: { max_per_core: number }, confirm: boolean }}
 */
export function roleDefaults(role, have) {
  const cores = Math.max(1, have.cores);
  /** @param {number} n @param {number} mb @param {number} load @param {boolean} confirm */
  const make = (n, mb, load, confirm) => ({
    cores: n,
    memory_ceiling_mb: Math.max(1, Math.floor(mb)),
    max_executors: Math.max(1, Math.floor(n / 2)),
    load: { max_per_core: load },
    confirm,
  });
  switch (role) {
    case 'dedicated':
      // Everything except one core and about 10% of memory; load matters only for quiet holds.
      return make(Math.max(1, cores - 1), have.memory_mb * 0.9, 1, true);
    case 'workstation':
      return make(Math.max(1, Math.floor(cores / 2)), have.memory_mb * 0.5, 0.7, true);
    case 'cloud-vm':
      // The whole allocation, less a tenth of memory; nobody is there to confirm it.
      return make(cores, have.memory_mb * 0.9, 0.9, false);
    case 'ci':
      // What the job grants; no setup questions.
      return make(cores, have.memory_mb * 0.9, 1, false);
    default:
      throw new Error(`no role "${role}": ${ROLES.join(', ')}`);
  }
}

/**
 * Reconcile a stored profile with a fresh probe: where the probe finds less than the profile says
 * (cores, memory, GPUs, browsers), warn and use the smaller value. A resource that has gone is
 * gone from `has`.
 * @param {Record<string, any> | null} profile the machine file's data
 * @param {Probe} probe
 * @returns {{ cores: number | null, memory_ceiling_mb: number | null, gpus: number, browsers: string[],
 *   warnings: string[] }}
 */
export function reconcile(profile, probe) {
  /** @type {string[]} */
  const warnings = [];
  /** @param {number | undefined} set @param {number} found @param {string} what @param {string} unit */
  const smaller = (set, found, what, unit) => {
    if (set === undefined) return null;
    if (found < set) {
      warnings.push(
        `this machine now has ${found}${unit} ${what}, the profile says ${set}${unit}; using ${found}${unit}`,
      );
      return found;
    }
    return set;
  };
  const cores = smaller(profile?.cores, probe.cores, 'cores', '');
  const memory = smaller(profile?.memory_ceiling_mb, probe.memory_mb, 'of memory', ' MB');
  const was = profile?.detected;
  if (was) {
    if (typeof was.cores === 'number' && probe.cores < was.cores && cores === null) {
      warnings.push(`this machine now has ${probe.cores} cores, it had ${was.cores} when detected`);
    }
    const gpusBefore = Array.isArray(was.gpus) ? was.gpus.length : 0;
    if (probe.gpus.length < gpusBefore) {
      warnings.push(
        probe.gpus.length === 0
          ? `no GPU found now; ${gpusBefore} when detected`
          : `${probe.gpus.length} GPUs found now; ${gpusBefore} when detected`,
      );
    }
    for (const b of /** @type {string[]} */ (was.browsers ?? [])) {
      if (!probe.browsers.includes(b)) warnings.push(`browser ${b} found when detected is gone`);
    }
  }
  return {
    cores,
    memory_ceiling_mb: memory,
    gpus: probe.gpus.length,
    browsers: probe.browsers,
    warnings,
  };
}

/**
 * The profile this probe proposes. Whatever the person already set in the machine file wins over a
 * default, the kind of machine included (stored as `kind`; `role` before HITLD-82); `detected`
 * is always refreshed.
 * @param {Probe} probe @param {Record<string, any> | null} [existing]
 * @returns {{ profile: Record<string, any>, role: Role, role_source: 'machine file' | 'detected',
 *   confirm: boolean, warnings: string[] }}
 */
export function proposeProfile(probe, existing = null) {
  const role = /** @type {Role} */ (existing?.kind ?? existing?.role ?? probe.role);
  const defaults = roleDefaults(role, probe);
  const rec = reconcile(existing, probe);
  /** @type {Record<string, any>} */
  const profile = {
    schema_version: 1,
    kind: role,
    max_executors: existing?.max_executors ?? defaults.max_executors,
    cores: rec.cores ?? defaults.cores,
    memory_ceiling_mb: rec.memory_ceiling_mb ?? defaults.memory_ceiling_mb,
    load: existing?.load ?? defaults.load,
    ...(existing?.capacity ? { capacity: existing.capacity } : {}),
    ...(existing?.env ? { env: existing.env } : {}),
    detected: {
      at: probe.at,
      kind: probe.role,
      kind_hints: probe.role_hints,
      os: probe.os,
      cores: probe.cores,
      memory_mb: probe.memory_mb,
      gpus: probe.gpus,
      browsers: probe.browsers,
    },
  };
  return {
    profile,
    role,
    role_source: existing?.kind || existing?.role ? 'machine file' : 'detected',
    confirm: defaults.confirm,
    warnings: [...probe.notes, ...rec.warnings],
  };
}

/**
 * The resources this machine has, for the dispatch plan: gpu and browser from the probe (the
 * smaller of the stored profile and a fresh probe when both are given), quiet always, and any
 * name the profile gives a capacity.
 * @param {Record<string, any> | null} profile @param {Probe | null} probe
 * @returns {{ has: (name: string) => boolean, why: (name: string) => string }}
 */
export function machineResources(profile, probe) {
  const detected = profile?.detected;
  const known = [
    probe?.gpus.length,
    Array.isArray(detected?.gpus) ? detected.gpus.length : undefined,
  ].filter((n) => n !== undefined);
  const gpus = known.length ? Math.min(...known) : 0;
  const browsers = probe?.browsers ?? detected?.browsers ?? [];
  const capacity = Object.keys(profile?.capacity ?? {});
  /** @param {string} name */
  const has = (name) => {
    if (name === 'quiet') return true;
    if (name === 'gpu') return gpus > 0;
    if (name === 'browser') return browsers.length > 0;
    return capacity.includes(name);
  };
  return { has, why: (name) => `needs ${name}; this machine has none` };
}
