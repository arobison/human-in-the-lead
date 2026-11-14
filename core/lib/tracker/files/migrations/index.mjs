// The registered tracker migrations, oldest first. `hitld work migrate` runs them in this order.
// A migration is a named step (see ../migrate.mjs for the contract). None is registered yet: the
// first one arrives with the first change to the tracker's file format.

/** @type {readonly import('../migrate.mjs').Migration[]} */
export const MIGRATIONS = Object.freeze([]);
