// The dashboard data contract (HITLD-691, decision HITLD-683): the one versioned surface that
// HITLD's own page and a project's extensions read. It is what `hitld dashboard --json` returns
// under `report`, and it is described by schemas/dashboard-data.schema.json.
//
// Versioning: `api_version` stays the same when a field is added, and goes up when a field is
// removed, renamed or given another type. Callers ignore fields they do not know. Version 2 is the
// first under this name: it renamed the quota forecast's `before_reset` (version 1, under
// `metrics_schema_version`), a key the schema guard refuses as a lifecycle hook name.
//
// Classification: every tracker entity in the contract carries its label (its own, or the
// project's default_classification). An entity labeled confidential or secret is cut to a stub
// (ID, kind, state, label and the links between IDs), so nothing confidential is added by default.
// The ledger summary and the usage readings come from the private store and are labeled internal.

/** The contract's version. */
export const API_VERSION = 2;

/** The labels whose content stays out of the contract. */
export const WITHHELD = Object.freeze(['confidential', 'secret']);

/** The label of what the private store holds: the ledger and the usage snapshots. */
export const PRIVATE_STORE_LABEL = 'internal';

/**
 * The keys a withheld entity keeps: what it is, where it stands, and the IDs it links to. Its title
 * becomes its ID; its path is dropped, since a file name carries the title.
 */
const STUB_KEYS = [
  'id',
  'kind',
  'state',
  'classification',
  'parent',
  'needs',
  'constraints',
  'constraint_of',
  'contributes_to',
  'created',
];

/** @param {Record<string, any>} e */
export const isWithheld = (e) => WITHHELD.includes(String(e.classification));

/**
 * The entities as the contract may carry them: a withheld entity becomes a stub.
 * @param {Record<string, any>[]} entities as the tracker's read API gives them
 * @returns {{ entities: Record<string, any>[], withheld: Set<string> }}
 */
export function withholdEntities(entities) {
  /** @type {Set<string>} */
  const withheld = new Set();
  const out = entities.map((e) => {
    if (!isWithheld(e)) return e;
    const id = String(e.id);
    withheld.add(id);
    /** @type {Record<string, any>} */
    const stub = { title: id, redacted: true };
    for (const k of STUB_KEYS) if (e[k] !== undefined) stub[k] = e[k];
    return stub;
  });
  return { entities: out, withheld };
}

/**
 * The milestone graph with withheld entities' titles, outcomes and paths taken out.
 * @param {import('../tracker/files/views.mjs').MilestoneGraph | null} mg
 * @param {Set<string>} withheld
 */
export function withholdGraph(mg, withheld) {
  if (!mg || !withheld.size) return mg;
  const has = (/** @type {string | null | undefined} */ id) => id != null && withheld.has(id);
  /** @template {{ id: string, title: string, path?: string | null }} T @param {T} x @returns {T} */
  const cut = (x) => (has(x.id) ? { ...x, title: x.id, path: null } : x);
  return {
    ...mg,
    nodes: mg.nodes.map((n) => ({
      ...cut(n),
      ...(has(n.id) ? { outcome: null } : {}),
      items: n.items.map(cut),
    })),
    lanes: mg.lanes.map((l) => (has(l.id) ? { ...l, title: String(l.id) } : l)),
    releases: mg.releases.map((r) => ({
      ...cut(r),
      needs: r.needs.map(cut),
    })),
  };
}

/**
 * The claims with withheld items' titles taken out.
 * @param {import('../tracker/files/claims.mjs').ClaimedItem[]} claims @param {Set<string>} withheld
 */
export const withholdClaims = (claims, withheld) =>
  claims.map((c) => (withheld.has(c.id) ? { ...c, title: c.id } : c));

/**
 * A limit as the contract carries it: the gate's state, with the forecast's `before_reset` named
 * `reserve_before_reset` (a key starting with before_ reads as a lifecycle hook, and the schema
 * guard refuses it in any data).
 * @param {import('../quota/quota.mjs').QuotaState} q
 */
export function contractQuota(q) {
  const { before_reset, ...forecast } = q.forecast;
  return { ...q, forecast: { ...forecast, reserve_before_reset: before_reset } };
}

/** @typedef {ReturnType<typeof contractQuota>} ContractQuota */

/**
 * The usage readings the gate read: how many, and the latest from each source, without the
 * session that fed it.
 * @param {Record<string, any>[]} snapshots
 */
export function usageSummary(snapshots) {
  /** @type {Map<string, Record<string, any>>} */
  const latest = new Map();
  for (const s of snapshots) {
    const at = Date.parse(s.at);
    const was = latest.get(s.source);
    if (!Number.isFinite(at) || (was && Date.parse(was.at) >= at)) continue;
    latest.set(s.source, s);
  }
  return {
    classification: PRIVATE_STORE_LABEL,
    snapshots: snapshots.length,
    latest: [...latest.values()]
      .map((s) => ({
        at: new Date(Date.parse(s.at)).toISOString(),
        source: String(s.source),
        ...(s.rate_limits ? { rate_limits: s.rate_limits } : {}),
        ...(s.readings ? { readings: s.readings } : {}),
      }))
      .sort((a, b) => a.source.localeCompare(b.source)),
  };
}
