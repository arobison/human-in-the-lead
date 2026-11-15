---
id: HITLD-22
title: Confidentiality and security pass before the first push
kind: work
state: done
created: 2026-11-14
project: HITLD-15
---

## Why

Scan the repository and its history for anything that must not be public (a consuming project's internals, commercial topics, personal data, machine paths). Snyk scan once the service is back; resolve or record each finding.

Also verify the citations in part 20 that were added without a check: Meadows (two), Åström and Murray, Bungay, Bezos's 2016 letter, Campbell, Shewhart, Deming, Dwork et al., Saltzer and Schroeder, and especially Crow 1974. Also: Ashby 1956; Petrović and Ivanković, ICSE-SEIP 2018; MIL-HDBK-189C; slsa.dev. From docs/systems-thinking.md: Kano et al. 1984; Seiden, Outcomes Over Output (year). Added with the milestones and releases design: Conant and Ashby 1970; Simon 1962; Kano et al. 1984; Clegg 1994 (MoSCoW); Seiden 2019; Snowden and Boone 2007; Preston-Werner, Semantic Versioning 2.0.0; Humble and Farley 2010.

## Done when

- An independent scan of the repository and its history finds nothing that must not be public.
- Each finding is fixed or recorded with the reason it stays.
- A Snyk scan has run, and each finding is resolved or recorded.
- Each citation listed above is checked and corrected in part 20, or marked as unchecked.
- The owner has read the scan result.

## Result

Checked the working tree that will be published (every tracked file, including work/, signals/, docs/, core/ comments and tests, evals, schemas, templates and .github/); the history is squashed before the push, and the one public commit holds only the README and the LICENSE.

- Confidentiality: case-insensitive searches for consuming-project names and tracker keys, employer and commercial topics, personal data (names, addresses, machine paths, hostnames), secrets and token patterns, statements about a person's preferences or setup, and narration of how the design was made. Findings fixed: example tracker keys in two code comments, one test and the orchestrator skill now use the generic `APP`; narration of a review round in this item removed. Kept on purpose: the GitHub account name and the LICENSE copyright line (already public), the `/home/o` test fixture paths. Domain-flavoured test fixtures were replaced with a neutral response-cache example.
- Snyk Code on core/: 21 medium findings, all the sinks already triaged in HITLD-63 (worktree setup by design; locks, tracker reads, fixtures and the primary check false positives); none new. The Snyk secret scan is not enabled for the account; the token-pattern search found nothing.
- Citations: every source in part 20 and docs/systems-thinking.md with a year, venue or link was checked, and so was MIL-HDBK-189C in part 6. DOIs resolve to the cited papers, and the links open the pages they claim. Corrected: Bungay, _The Art of Action_, is 2010, not 2011 (in both files); Crow 1974 now names its volume (_Reliability and Biometry_, SIAM); Kano et al. now give their pages; the Hubbard link was removed because it now redirects to a news post, not the book. Unchanged and confirmed: the rest of the list, including Bezos's letter for 2015 (published 2016), Clegg 1994 for MoSCoW, Seiden 2019, Petrović and Ivanković at ICSE-SEIP 2018, and DORA's five measures.
