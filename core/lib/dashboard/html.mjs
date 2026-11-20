// Small helpers the dashboard's views share: escaping, a link to an item's file, an age in words.

import { fileHref } from '../tracker/files/views.mjs';

/** Text escaped for HTML, in an element or an attribute. @param {unknown} v @returns {string} */
export const esc = (v) =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      /** @type {Record<string, string>} */ ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c],
  );

/** Text cut to `max` characters, ending with an ellipsis when cut. @param {string} t @param {number} max */
export const cut = (t, max) => (t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`);

/**
 * An ID linked to its file: on the forge when `base` is known, else by its repository-relative
 * path; the ID alone without a path.
 * @param {string} id @param {string | null | undefined} path @param {string | null} [base]
 */
export const fileLink = (id, path, base = null) =>
  path ? `<a class="file" href="${esc(fileHref(path, { base }))}">${esc(id)}</a>` : esc(id);

/** An age in whole days, in words. @param {number | null | undefined} days */
export const age = (days) =>
  days == null ? 'age unknown' : days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'}`;

/** "1 item" or "3 items". @param {number} n @param {string} one @param {string} [many] */
export const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
