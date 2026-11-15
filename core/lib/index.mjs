// The hitld library's public entry point. The command line and, later, the MCP server and the
// harness adapters use only what is exported here and in core/harness/.

export { NAME, VERSION } from './version.mjs';
export { validate, checkSchema, formatErrors, isCodeRunningKey } from './schema/validate.mjs';
export { SchemaRegistry, schemas, SCHEMA_DIR, TRACKER_KINDS } from './schema/registry.mjs';
export {
  POLICY_PATH,
  loadPolicy,
  resolvePolicy,
  policyDefaults,
  mergePolicy,
  findPolicyFile,
  findRepoRoot,
  ownershipProblem,
  readTrustedPolicy,
  policyHash,
  canonicalJson,
} from './policy/policy.mjs';
export { privateStorePath, openStore } from './store/store.mjs';
export { TRACKER_METHODS } from './tracker/interface.mjs';
export { COMMANDS, BUILT_BY, findCommand, toolName } from './cli/table.mjs';
export { inputSchema, parseArgs, UsageError } from './cli/args.mjs';
