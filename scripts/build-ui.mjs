#!/usr/bin/env node
// The build of the bundle HITLD's page inlines (HITLD-729, decision HITLD-727): React and the
// panels from core/lib/ui/, bundled by esbuild into core/lib/ui/dist/app.js. React and esbuild are
// development dependencies only; the bundle is committed, so `hitld dashboard` needs neither, and
// CI fails when the committed bundle is not what the source builds.
//
//   node scripts/build-ui.mjs          build and write the bundle   (npm run build:ui)
//   node scripts/build-ui.mjs --check  build in memory and compare; exit 1 when the committed
//                                      bundle differs, naming the file   (npm run check:ui)

import { readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = fileURLToPath(new URL('../', import.meta.url));
export const ENTRY = fileURLToPath(new URL('../core/lib/ui/app.mjs', import.meta.url));
export const BUNDLE = fileURLToPath(new URL('../core/lib/ui/dist/app.js', import.meta.url));

/** The first line of the bundle: what it is and how it is made. */
const BANNER =
  '/* HITLD dashboard app (HITLD-729): built by scripts/build-ui.mjs from core/lib/ui/; do not edit. React is MIT licensed. */';

/**
 * Why a bundle cannot go inside an HTML script element, or null: text that would end the element
 * or open a comment there.
 * @param {string} code
 */
export function inlineProblem(code) {
  if (/<\/script/i.test(code)) return 'it holds "</script", which would end the script element';
  if (code.includes('<!--')) return 'it holds "<!--", which opens a comment in a script element';
  return null;
}

/** Build the bundle in memory. @returns {Promise<string>} */
export async function build() {
  const esbuild = await import('esbuild');
  const out = await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    minify: true,
    legalComments: 'none',
    charset: 'ascii',
    banner: { js: BANNER },
    define: { 'process.env.NODE_ENV': '"production"' },
    // Paths in the bundle would differ between checkouts.
    absWorkingDir: REPO,
    logLevel: 'silent',
  });
  const code = out.outputFiles[0].text;
  const problem = inlineProblem(code);
  if (problem) throw new Error(`the bundle cannot be inlined: ${problem}`);
  return code;
}

async function main() {
  const check = process.argv.includes('--check');
  const code = await build();
  const rel = relative(REPO, BUNDLE);
  if (!check) {
    writeFileSync(BUNDLE, code);
    console.log(`wrote ${rel} (${code.length} bytes)`);
    return 0;
  }
  /** @type {string | null} */
  let committed = null;
  try {
    committed = readFileSync(BUNDLE, 'utf8');
  } catch {
    // Missing: reported below.
  }
  if (committed === code) {
    console.log(`${rel} matches its source`);
    return 0;
  }
  console.error(
    committed === null
      ? `${rel} is missing; run npm run build:ui and commit it`
      : `${rel} does not match its source in core/lib/ui/; run npm run build:ui and commit it`,
  );
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(`build-ui: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(2);
    },
  );
}
