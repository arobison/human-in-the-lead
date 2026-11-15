// Commands in the design that are not built yet (design parts 16.2 and 21). Each names the milestone that builds it.

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'intake pull',
    summary: 'Pull raw signals from a source into quarantine',
    built_by: 'signal',
  },
  { name: 'note', summary: "Record an owner's note as a signal", built_by: 'signal' },
  { name: 'kb search', summary: 'Search the knowledge base', built_by: 'signal' },
  { name: 'kb index', summary: 'Regenerate the knowledge base index', built_by: 'signal' },
  { name: 'kb stale', summary: 'Knowledge base pages past their freshness', built_by: 'signal' },
  { name: 'kb orphans', summary: 'Knowledge base pages nothing links to', built_by: 'kb-upkeep' },
  { name: 'kb links', summary: 'Check knowledge base links', built_by: 'signal' },
  {
    name: 'kb check',
    summary: 'Check knowledge base front matter and structure',
    built_by: 'signal',
  },
  {
    name: 'mcp',
    summary: 'Serve the same operations over MCP (tools only)',
    built_by: 'signal',
    mcp: false,
  },
  { name: 'metrics', summary: 'Measures from the ledger and git', built_by: 'measures' },
  {
    name: 'control evaluate',
    summary: 'Evaluate controllers inside the owner bounds',
    built_by: 'controllers',
  },
  {
    name: 'data migrate',
    summary: 'Upgrade data files to the current schema versions',
    built_by: 'major',
  },
];
