// The shared React app on HITLD's page (HITLD-729, decisions HITLD-725 and 727): the committed
// bundle (core/lib/ui/dist/app.js, built by scripts/build-ui.mjs) and the contract data, both
// inlined, so the page stays one self-contained file and `hitld dashboard` needs no React and no
// bundler. The data goes in a JSON script element the browser never runs, with every character that
// could end it escaped; the bundle runs under the page's Content-Security-Policy by its hash.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { scriptJson } from '../dashboard/script.mjs';
import { INLINE_ID } from './client.mjs';

/** The committed bundle's path. */
export const BUNDLE_URL = new URL('./dist/app.js', import.meta.url);

/** @type {{ code: string, hash: string } | null} */
let cached = null;

/** The committed bundle and its hash, read once. @returns {{ code: string, hash: string }} */
export function appBundle() {
  if (!cached) {
    const code = readFileSync(BUNDLE_URL, 'utf8');
    cached = { code, hash: `sha256-${createHash('sha256').update(code, 'utf8').digest('base64')}` };
  }
  return cached;
}

/**
 * The page's app: the data element, the bundle's script element, and the hash its policy allows.
 * @param {unknown} contract the dashboard data contract
 * @param {{ fileBase?: string | null }} [where] the forge's address for the repository's files
 */
export function appScripts(contract, { fileBase = null } = {}) {
  const { code, hash } = appBundle();
  return {
    hash,
    data: `<script type="application/json" id="${INLINE_ID}">${scriptJson({ contract, file_base: fileBase })}</script>`,
    tag: `<script>${code}</script>`,
  };
}
