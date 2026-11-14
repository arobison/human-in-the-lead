// Commands in the design that are not built yet (design parts 16.2 and 21). Each names the milestone that builds it.

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'intake pull',
    summary: 'Pull raw signals from a source into quarantine',
    piece: 'signal',
  },
  { name: 'note', summary: "Record an owner's note as a signal", piece: 'signal' },
  { name: 'kb search', summary: 'Search the knowledge base', piece: 'signal' },
  { name: 'kb index', summary: 'Regenerate the knowledge base index', piece: 'signal' },
  { name: 'kb stale', summary: 'Knowledge base pages past their freshness', piece: 'signal' },
  { name: 'kb orphans', summary: 'Knowledge base pages nothing links to', piece: 'kb-upkeep' },
  { name: 'kb links', summary: 'Check knowledge base links', piece: 'signal' },
  { name: 'kb check', summary: 'Check knowledge base front matter and structure', piece: 'signal' },
  {
    name: 'mcp',
    summary: 'Serve the same operations over MCP (tools only)',
    piece: 'signal',
    mcp: false,
  },
  { name: 'metrics', summary: 'Measures from the ledger and git', piece: 'measures' },
  {
    name: 'control evaluate',
    summary: 'Evaluate controllers inside the owner bounds',
    piece: 'controllers',
  },
  {
    name: 'data migrate',
    summary: 'Upgrade data files to the current schema versions',
    piece: 'major',
  },
  {
    name: 'work migrate',
    summary: 'Upgrade the tracker files to the current tracker format',
    piece: 'first-release',
  },
  {
    name: 'config migrate',
    summary: 'Move settings out of policy.json into the person and machine files',
    piece: 'first-release',
  },
];
