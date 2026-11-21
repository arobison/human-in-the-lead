---
summary: How the HTTP client caches responses and when entries are invalidated.
areas: [http]
tags: [cache, invalidation]
owner: C-1
checked: 2026-11-14
checked_at: BASE
sources: ["src/cache/**"]
links: [../../conventions/naming.md]
supersedes: [areas/http/old-cache.md]
---

# The response cache

Responses are kept in `src/cache/store.js`, keyed by URL. Invalidation drops an entry when the
server's validator changes. Names follow [the naming convention](../../conventions/naming.md).
