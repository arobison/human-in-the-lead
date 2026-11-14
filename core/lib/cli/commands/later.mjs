// Commands in the design that come after v0-alpha (design parts 16.2 and 21).

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  { name: 'intake pull', summary: 'Pull raw signals from a source into quarantine', piece: 'v0' },
  { name: 'note', summary: "Record an owner's note as a signal", piece: 'v0' },
  { name: 'kb search', summary: 'Search the knowledge base', piece: 'v0' },
  { name: 'kb index', summary: 'Regenerate the knowledge base index', piece: 'v0' },
  { name: 'kb stale', summary: 'Knowledge base pages past their freshness', piece: 'v0' },
  { name: 'kb orphans', summary: 'Knowledge base pages nothing links to', piece: 'M4' },
  { name: 'kb links', summary: 'Check knowledge base links', piece: 'v0' },
  { name: 'kb check', summary: 'Check knowledge base front matter and structure', piece: 'v0' },
  {
    name: 'mcp',
    summary: 'Serve the same operations over MCP (tools only)',
    piece: 'v0',
    mcp: false,
  },
  { name: 'metrics', summary: 'Measures from the ledger and git', piece: 'M1' },
  {
    name: 'control evaluate',
    summary: 'Evaluate controllers inside the owner bounds',
    piece: 'M2',
  },
  { name: 'migrate', summary: 'Upgrade data files to the current schema versions', piece: 'major' },
];
