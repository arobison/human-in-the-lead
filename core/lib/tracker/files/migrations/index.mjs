// The registered tracker migrations, oldest first. `hitld work migrate` runs them in this order.
// A migration is a named step (see ../migrate.mjs for the contract). A name never changes once
// released.

import { milestoneEntities } from './milestone-entities.mjs';
import { namesAndStates } from './names-and-states.mjs';
import { retirePriority } from './retire-priority.mjs';
import { trackerStructure } from './tracker-structure.mjs';

/** @type {readonly import('../migrate.mjs').Migration[]} */
export const MIGRATIONS = Object.freeze([
  milestoneEntities,
  retirePriority,
  namesAndStates,
  trackerStructure,
]);
