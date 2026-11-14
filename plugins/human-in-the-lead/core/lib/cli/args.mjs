// Argument parsing from a command's declared arguments, and the JSON Schema of its input.
// The same declaration drives the command line and, later, the MCP server's tool schemas, so the
// two cannot drift (design part 15.1).

/**
 * @typedef {object} ArgSpec
 * @property {string} name the input key; on the command line, --<name> (or a positional)
 * @property {'string' | 'boolean' | 'integer'} type
 * @property {string} description
 * @property {boolean} [required]
 * @property {boolean} [positional] taken from bare words, in declaration order
 * @property {boolean} [repeatable] the option may be given more than once; the input is a list
 *   (not for a boolean)
 * @property {boolean} [mcp] false for an option that only makes sense on the command line (for
 *   example a path to write to); it is left out of the MCP input schema, which then refuses it
 */

export class UsageError extends Error {}

/**
 * Parse command-line words into a command's input object.
 * @param {string[]} words the words after the command name
 * @param {ArgSpec[]} specs
 * @returns {Record<string, unknown>}
 */
export function parseArgs(words, specs) {
  /** @type {Record<string, unknown>} */
  const input = {};
  const byName = new Map(specs.filter((s) => !s.positional).map((s) => [s.name, s]));
  const positionals = specs.filter((s) => s.positional);
  let next = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.startsWith('--')) {
      const [flag, inline] = w.slice(2).split(/=(.*)/s, 2);
      const spec = byName.get(flag);
      if (!spec) {
        const known = [...byName.keys()].map((k) => `--${k}`).join(', ') || 'none';
        throw new UsageError(`unknown option --${flag} (options: ${known})`);
      }
      if (spec.type === 'boolean') {
        if (inline !== undefined) throw new UsageError(`--${flag} takes no value`);
        input[spec.name] = true;
        continue;
      }
      const value = inline ?? words[++i];
      if (value === undefined) throw new UsageError(`--${flag} needs a value`);
      if (spec.repeatable) {
        input[spec.name] = [
          .../** @type {unknown[]} */ (input[spec.name] ?? []),
          convert(spec, value),
        ];
      } else input[spec.name] = convert(spec, value);
    } else {
      const spec = positionals[next++];
      if (!spec) throw new UsageError(`unexpected argument ${JSON.stringify(w)}`);
      input[spec.name] = convert(spec, w);
    }
  }
  for (const s of specs) {
    if (s.required && !(s.name in input)) {
      throw new UsageError(`${s.positional ? `<${s.name}>` : `--${s.name}`} is required`);
    }
  }
  return input;
}

/** @param {ArgSpec} spec @param {string} value */
function convert(spec, value) {
  if (spec.type === 'integer') {
    if (!/^-?\d+$/.test(value)) throw new UsageError(`--${spec.name} must be an integer`);
    return Number(value);
  }
  return value;
}

/**
 * The JSON Schema for a command's input: what an MCP tool declares as its inputSchema.
 * @param {ArgSpec[]} specs
 */
export function inputSchema(specs) {
  return {
    type: 'object',
    properties: Object.fromEntries(
      specs
        .filter((s) => s.mcp !== false)
        .map((s) => [
          s.name,
          s.repeatable
            ? { type: 'array', items: { type: s.type }, description: s.description }
            : { type: s.type, description: s.description },
        ]),
    ),
    required: specs.filter((s) => s.required && s.mcp !== false).map((s) => s.name),
    additionalProperties: false,
  };
}
