// File-system calls the environment manager uses, under its own names. They live in
// ../platform/fs.mjs, shared with the rest of hitld: real paths with Windows short names expanded,
// and renames retried on Windows while another process holds the target.

export { realPath, RM_RETRY, renameReplacing as renameOver } from '../platform/fs.mjs';
