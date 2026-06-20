Read AGENTS.md first.

Review this pull request for serious issues only.

Focus on:

1. Browser-only file processing
2. Binary file format correctness
3. TypeScript safety
4. Missing tests
5. Broken build
6. Overclaiming in user-facing wording
7. Unexpected dependency changes
8. Security and privacy issues

Treat these as P1:

- User files are uploaded to a server.
- A flat PNG is described as having recoverable layers.
- A parser silently accepts invalid data.
- A binary writer change has no tests.
- The app claims conversion is lossless without proof.
- CI commands fail.

Return:

- Summary
- P0 issues
- P1 issues
- P2 suggestions
- Whether this PR is safe to merge
