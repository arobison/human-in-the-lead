// The entry of the bundle HITLD's page inlines (HITLD-729, decisions HITLD-725 and 727): it reads
// the contract the page carries and draws the parts the page marks with data-hitld-mount, in place
// of what they hold. The page reads complete without it: each mount point holds the same content
// drawn with no script, which stays when the contract cannot be read. Built into
// core/lib/ui/dist/app.js by scripts/build-ui.mjs; the bundle is committed.

import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { readInlined } from './client.mjs';
import { HitldRoot, PanelsView, ReadStamp } from './components.mjs';

/** What each mount point draws. */
const PARTS = { read: ReadStamp, panels: PanelsView };

/** Draw the page's mount points from its contract. @param {Document} doc */
export function mount(doc) {
  /** @type {ReturnType<typeof readInlined>} */
  let inlined;
  try {
    inlined = readInlined(doc);
  } catch {
    // Keep the content drawn with no script.
    return;
  }
  for (const el of doc.querySelectorAll('[data-hitld-mount]')) {
    const part = PARTS[/** @type {keyof typeof PARTS} */ (el.getAttribute('data-hitld-mount'))];
    if (!part) continue;
    createRoot(el).render(
      h(HitldRoot, { contract: inlined.contract, fileBase: inlined.fileBase, bare: true }, h(part)),
    );
  }
}

mount(document);
