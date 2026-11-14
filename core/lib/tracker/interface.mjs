// The tracker adapter interface (design part 3.3). The files backend (piece (a) of "Usable in a consuming project",
// under core/lib/tracker/files/) is the reference implementation; other pieces code against
// these types so they can be built in parallel with it.
//
// Methods are synchronous for the files backend's needs; a hosted backend may wrap them.

/**
 * @typedef {string} Id a tracker ID, <KEY>-<n>
 * @typedef {string} DispatchId D-<n>
 * @typedef {string} Version an opaque version for optimistic concurrency (for files: a blob hash)
 * @typedef {'Proposed' | 'Planned' | 'In progress' | 'Done' | 'Dropped'} State
 * @typedef {'needs' | 'parent' | 'duplicate_of' | 'opened_from'} Relation
 * @typedef {Record<string, unknown>} Entity front matter as validated by the kind's schema, plus `body`
 * @typedef {Record<string, unknown>} EntityDraft an entity without its ID
 * @typedef {Record<string, unknown>} Patch fields to set; null removes a field
 * @typedef {object} Filter
 * @property {string | string[]} [kind]
 * @property {State | State[]} [state]
 * @property {string} [area]
 * @property {Id} [needs] entities that need this ID
 * @property {Id} [parent]
 * @property {string} [text] case-insensitive, in the title and body
 * @property {boolean} [ready] derived: Planned, every need Done, not claimed (design part 3.2)
 * @property {boolean} [blocked] derived: Planned or Proposed with a need not Done
 * @property {boolean} [claimed] derived: a live branch has a claim for it
 * @typedef {{ commit?: string, branch?: string }} ChangeRef where a change was recorded
 * @typedef {{ at: string, from: State | null, to: State, ref: ChangeRef }} Change
 *
 * @typedef {object} TrackerCapabilities
 * @property {boolean} closesOnMerge the state change rides with the work
 * @property {boolean} claimInBranch
 * @property {boolean} customFields can store needs, touches, estimate_tokens natively
 * @property {boolean} decisionKind can model decisions as items
 * @property {boolean} classificationEnforced can restrict visibility per entity
 * @property {'full' | 'partial' | 'none'} history
 *
 * @typedef {object} TrackerAdapter
 * @property {() => TrackerCapabilities} capabilities
 * @property {(id: Id) => Entity} get
 * @property {(filter: Filter) => Entity[]} query
 * @property {(draft: EntityDraft) => Id} create ID allocation per the backend's rules (orchestrator only)
 * @property {(id: Id, patch: Patch, expectedVersion: Version) => Version} update
 * @property {(id: Id, to: State, reason: string, via: ChangeRef) => Version} transition
 * @property {(from: Id, relation: Relation, to: Id) => void} link
 * @property {(id: Id, claimant: DispatchId, branch: string) => ChangeRef} claim
 * @property {(id: Id) => Change[]} history
 * @property {() => void} renderViews
 */

export const TRACKER_METHODS = Object.freeze([
  'capabilities',
  'get',
  'query',
  'create',
  'update',
  'transition',
  'link',
  'claim',
  'history',
  'renderViews',
]);
