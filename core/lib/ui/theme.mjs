// The panels' styles and the theme variables a project sets to restyle them (HITLD-729, decisions
// HITLD-721 and HITLD-724). The panels draw with CSS custom properties only. HITLD's page defines
// them on :root; a project's own app sets the --hitld-* variables, in its own CSS or through the
// `theme` prop of HitldRoot, and THEME_CSS maps them onto the panels' properties inside a .hitld
// element. Pure: it runs on both sides.

/**
 * The theme variables, by the name a theme object uses. A project's CSS sets `--hitld-<name>`
 * (accent as --hitld-accent, stopBg as --hitld-stop-bg).
 */
export const THEME_VARIABLES = Object.freeze({
  bg: 'The page background.',
  fg: 'The text color.',
  muted: 'Secondary text: notes, captions, axis labels.',
  line: 'Borders and rules.',
  card: 'The background of a card, a board column or a node.',
  accent: 'Bars, lines, dots and spans: the data color.',
  track: 'The empty part of a bar and a count badge.',
  mark: 'Edges and node outlines in a graph.',
  stop: 'The border of a refused panel.',
  stopBg: 'The background of a refused panel.',
  font: 'The font family.',
});

/** @typedef {Partial<Record<keyof typeof THEME_VARIABLES, string>>} Theme */

/** The CSS custom property for a theme name. @param {string} name */
export const themeProperty = (name) =>
  `--hitld-${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/**
 * A value a theme may set: a color or a font list, and nothing that can load, run or leave the
 * declaration (no url(), no semicolon, no brace, no backslash, no quote but plain font names).
 */
const SAFE_VALUE = /^[#(),.%\w\s'-]{1,120}$/;

/**
 * The style object that sets a theme's variables. A name that is not a theme variable, or a
 * value that is not safe, is refused by name.
 * @param {Theme} theme @returns {Record<string, string>}
 */
export function themeStyle(theme) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [name, value] of Object.entries(theme ?? {})) {
    if (!Object.hasOwn(THEME_VARIABLES, name)) {
      throw new TypeError(
        `"${name}" is not a theme variable (one of ${Object.keys(THEME_VARIABLES).join(', ')})`,
      );
    }
    if (typeof value !== 'string' || !SAFE_VALUE.test(value) || /url\s*\(/i.test(value)) {
      throw new TypeError(`theme variable "${name}" takes a color or a font list, not ${value}`);
    }
    out[themeProperty(name)] = value;
  }
  return out;
}

/** The panels' styles, over the page's properties (--card, --line, --used and the rest). */
export const PANELS_CSS = `.pn{margin:1.5rem 0 2rem}.pn h3{font-size:1rem;margin:0 0 .25rem}.pn-refused{border-left-color:var(--stop);background:var(--stop-bg)}
.pn-board{display:flex;gap:.75rem;overflow-x:auto;align-items:flex-start}.pn-col{flex:1 0 12rem;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:.5rem .6rem}.pn-col h4{font-size:.9rem;margin:0 0 .25rem}.pn-col ul{list-style:none;padding:0}.pn-col li{padding:.2rem 0;border-bottom:1px solid var(--line);font-size:.9rem}
svg.pn-svg{display:block;width:100%;max-width:720px;height:auto;font:11px system-ui,sans-serif}.pn-svg text{fill:var(--muted)}.pn-line{fill:none;stroke:var(--used);stroke-width:2}.pn-dot{fill:var(--used)}.pn-axis{stroke:var(--line)}.pn-node rect{fill:var(--card);stroke:var(--mark)}.pn-node text{fill:var(--fg)}.pn-edge{stroke:var(--mark);fill:none}.pn-span{fill:var(--used)}
svg.pn-bar{display:block;width:12rem;height:.8rem}table.pn-table{min-width:0}.pn caption{text-align:left}`;

/** The light and dark defaults of each theme variable: HITLD's page's own colors. */
const DEFAULTS = {
  light: {
    bg: '#fbfbfa',
    fg: '#1c1d20',
    muted: '#60646c',
    line: '#d9dbe0',
    card: '#fff',
    accent: '#2f6fb3',
    track: '#e9eaee',
    mark: '#8a8f98',
    stop: '#b3261e',
    stopBg: '#fbe9e7',
    font: 'system-ui, sans-serif',
  },
  dark: {
    bg: '#141517',
    fg: '#e8e9ec',
    muted: '#9a9fa8',
    line: '#34373d',
    card: '#1b1c1f',
    accent: '#6aa5e6',
    track: '#2a2c31',
    mark: '#8a8f98',
    stop: '#ff8a80',
    stopBg: '#3a1f1c',
    font: 'system-ui, sans-serif',
  },
};

/** The panels' properties, each from a theme variable. */
const MAPPED = [
  ['bg', 'bg'],
  ['fg', 'fg'],
  ['muted', 'muted'],
  ['line', 'line'],
  ['card', 'card'],
  ['used', 'accent'],
  ['track', 'track'],
  ['mark', 'mark'],
  ['stop', 'stop'],
  ['stop-bg', 'stopBg'],
];

/** @param {'light' | 'dark'} mode */
const mapped = (mode) =>
  MAPPED.map(
    ([prop, name]) =>
      `--${prop}:var(${themeProperty(name)},${DEFAULTS[mode][/** @type {keyof typeof DEFAULTS.light} */ (name)]})`,
  ).join(';');

/**
 * The stylesheet for a project's own app: the panels' styles inside a .hitld element, with each
 * property read from a --hitld-* variable the project may set, falling back to HITLD's light or
 * dark colors as the reader's setting asks. HITLD's page does not need it; it defines the
 * properties itself.
 */
export const THEME_CSS = `.hitld{${mapped('light')};background:var(--bg);color:var(--fg);font-family:var(--hitld-font,${DEFAULTS.light.font})}
@media (prefers-color-scheme:dark){.hitld{${mapped('dark')}}}
.hitld .meta,.hitld small{color:var(--muted)}.hitld .num{display:inline-block;min-width:1.6rem;padding:0 .35rem;border-radius:4px;background:var(--track);text-align:center}
.hitld .wrap{overflow-x:auto}.hitld table{border-collapse:collapse;width:100%}.hitld th,.hitld td{text-align:left;vertical-align:top;padding:.5rem .6rem;border-bottom:1px solid var(--line)}
.hitld .status{background:var(--card);border:1px solid var(--line);border-left:6px solid var(--mark);border-radius:6px;padding:.75rem 1rem;margin:1rem 0}
.hitld .track{fill:var(--track)}.hitld .used{fill:var(--used)}
${PANELS_CSS}`;
