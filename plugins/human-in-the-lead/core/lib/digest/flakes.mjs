// The flaky-test part of the digest. Its place is here, and it has nothing to say yet: the
// quarantine file and the flake measures arrive with HITLD-21, which fills in `collect`.
//
// What `collect` returns is the same as every other part (see parts.mjs):
//   { section, json }
// where `section` is a Section (core/lib/digest/render.mjs) such as
//   { id: 'flakes', rank: 7, title: 'Flaky tests', entries: [['<test>: <what changed>']],
//     noun: 'tests', news: true }
// built from records since the read cursor (`since`), and `json` holds the data under a `flakes`
// key. Return `{ section: null }` when there is nothing new. The renderer shortens the section to
// fit the digest's size budget; the part keeps each entry to the lines it needs.

/** @type {import('./parts.mjs').Part} */
export const flakesPart = {
  id: 'flakes',
  rank: 7,
  collect: () => ({ section: null }),
};
