// Migration "retire-priority" (design part 3.4; Q30, decided: retire it in the milestone
// migration). Order is derived: cost of delay over size, with a milestone's constraints carrying
// its cost of delay, so a stored priority label is a second source of order that can disagree
// with the derived one. This step removes the `priority` line from every file that has one,
// editing only that line. An owner's direct reorder stays a recorded decision (design part 2.4).

import { dropKey } from './milestone-entities.mjs';

/** @type {import('../migrate.mjs').Migration} */
export const retirePriority = {
  name: 'retire-priority',
  summary: 'remove the priority key from every file: order is derived from cost of delay and size',
  plan: ({ entries, files }) =>
    entries
      .filter((e) => e.data && Object.hasOwn(e.data, 'priority'))
      .map((e) => ({
        path: e.path,
        text: dropKey(/** @type {string} */ (files.get(e.path)), 'priority'),
      })),
};
