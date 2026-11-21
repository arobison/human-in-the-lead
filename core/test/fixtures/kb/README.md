A knowledge base with one defect of each kind `hitld kb check` finds (core/test/kb.test.mjs). The test copies it into a fresh repository, renames `dot-hitld/` to `.human-in-the-lead/`, commits it, puts that commit in place of `BASE` in the `checked_at` lines, and changes `src/cache/` in a second commit.

| Note | Defect |
|---|---|
| `kb/areas/http/cache.md` | stale: a source changed since `checked_at` |
| `kb/areas/http/lost.md` | stale: `checked_at` is not reachable |
| `kb/conventions/naming.md` | stale: no sources, checked longer ago than `kb.max_age_unsourced` |
| `kb/areas/http/client.md` | a link to a superseded note (`old-cache.md`, superseded by `cache.md`) |
| `kb/playbooks/release.md` | a broken link |
| `kb/areas/db/bad-front-matter.md` | front matter against the schema: an unknown key |
| `kb/areas/db/too-long.md` | over `kb.note_tokens_max` |
| `kb/index.md` | missing, so not current; the notes' index exceeds `kb.index_tokens_max` and splits by area |

`kb/glossary.md` maps "memoize" to "cache", so a search for it finds the cache note. `kb/areas/db/schema.md` has no defect. The test adds a confidential note at run time (the repository's commit guard refuses one in its own files), which the index leaves out.
