// The attention budget as settings (design part 23.5): the person's own keys (attention.* in the
// person file, defaults in its schema) under the ceilings the owner sets in policy.json
// (attention.*_max). The lower of the two applies, so a project is stricter than a person and
// never looser. Everything else in the budget is the person's alone.

import { schemas } from '../schema/registry.mjs';

/**
 * @typedef {object} QuietWindow
 * @property {string} from HH:MM
 * @property {string} to HH:MM
 *
 * @typedef {object} AttentionSettings
 * @property {number} decisions_per_digest
 * @property {number} interrupts_per_day
 * @property {QuietWindow[]} quiet_hours
 * @property {string} timezone an IANA zone; this machine's own when the person set none
 * @property {number} non_urgent_at_once
 * @property {number} answering_window_minutes
 *
 * @typedef {{ key: string, value: unknown, layer: string, overridden: { layer: string, value: unknown, why: string }[] }} Entry
 */

/** The keys the project's policy.json caps, and the key each caps. */
const CEILINGS = /** @type {const} */ ({
  decisions_per_digest: 'decisions_per_digest_max',
  interrupts_per_day: 'interrupts_per_day_max',
});

/** This machine's own time zone. */
export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * The defaults for a person's attention keys, from the person schema. The time zone is the
 * machine's own.
 * @returns {AttentionSettings}
 */
export function attentionDefaults() {
  const props = schemas().get('person').properties?.attention?.properties ?? {};
  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    if (/** @type {any} */ (v).default !== undefined) {
      out[k] = structuredClone(/** @type {any} */ (v).default);
    }
  }
  out.timezone = localZone();
  return /** @type {AttentionSettings} */ (out);
}

/** @param {string} zone */
export function validZone(zone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The effective attention settings and an entry per key for `hitld config explain`.
 * @param {{ person: Record<string, any> | null, raw: Record<string, any>, project: Record<string, any> }} l
 *   the layers: the person file, policy.json as written, and the project's policy with defaults
 * @param {{ path: string, message: string }[]} errors where a setting cannot be used
 * @returns {{ attention: AttentionSettings, entries: Entry[] }}
 */
export function effectiveAttention(l, errors) {
  const defaults = attentionDefaults();
  const mine = l.person?.attention ?? {};
  /** @type {Entry[]} */
  const entries = [];
  /** @type {Record<string, any>} */
  const attention = {};
  for (const key of /** @type {(keyof AttentionSettings)[]} */ (Object.keys(defaults))) {
    const personSets = mine[key] !== undefined;
    const personValue = personSets ? mine[key] : defaults[key];
    const ceilingKey = /** @type {keyof typeof CEILINGS | undefined} */ (
      Object.hasOwn(CEILINGS, key) ? key : undefined
    );
    if (!ceilingKey) {
      attention[key] = personValue;
      entries.push({
        key: `attention.${key}`,
        value: personValue,
        layer: personSets ? 'person' : 'default',
        overridden: [],
      });
      continue;
    }
    const ceiling = l.project.attention?.[CEILINGS[ceilingKey]];
    const projectSets = l.raw.attention?.[CEILINGS[ceilingKey]] !== undefined;
    const lower = typeof ceiling === 'number' && ceiling < personValue;
    const value = lower ? ceiling : personValue;
    attention[key] = value;
    entries.push({
      key: `attention.${key}`,
      value,
      layer: lower ? 'project' : personSets ? 'person' : 'default',
      overridden: lower
        ? [
            {
              layer: personSets ? 'person' : 'default',
              value: personValue,
              why: `looser: the project's ceiling (attention.${CEILINGS[ceilingKey]}) is lower`,
            },
          ]
        : projectSets && ceiling > personValue
          ? [
              {
                layer: 'project',
                value: ceiling,
                why: "a ceiling above the person's own value has no effect",
              },
            ]
          : [],
    });
  }
  if (!validZone(attention.timezone)) {
    errors.push({
      path: 'person attention.timezone',
      message: `${JSON.stringify(attention.timezone)} is not a time zone this machine knows; use an IANA name such as Europe/Paris`,
    });
    attention.timezone = localZone();
  }
  return { attention: /** @type {AttentionSettings} */ (attention), entries };
}
