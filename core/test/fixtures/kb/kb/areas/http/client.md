---
summary: The HTTP client and where its requests are built.
areas: [http]
tags: [client]
checked: 2026-11-14
checked_at: BASE
sources: ["src/http/**"]
---

# The client

Requests are built in `src/http/client.js`. Responses go through [the cache](old-cache.md).
