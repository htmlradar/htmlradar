# Contributing to HTMLRadar

Thanks for considering a contribution. HTMLRadar is AGPL-3.0 open source, and we welcome PRs that improve the tracker, the proxy, the web app, the docs, or the demo.

## Before you start

1. **Read the issue tracker.** Big features should be discussed in an issue before code goes in. Bug fixes and small improvements can go straight to PR.
2. **Run the test suite locally.** `pnpm test` should pass. Add tests for new logic.
3. **Run lint + format.** `pnpm lint && pnpm format:check` must be green before pushing.

## Sign your commits — DCO required

We use the [Developer Certificate of Origin](https://developercertificate.org/) (DCO) instead of a CLA. It's a one-line attestation that you wrote (or have the right to contribute) the code.

Every commit must be signed off:

```bash
git commit -s -m "fix: handle empty section list in tracker"
```

This appends a `Signed-off-by: Your Name <your.email@example.com>` line to the commit message. The DCO bot will block PRs missing this.

## Pull request checklist

- [ ] Branch off `main`. Keep PRs small and focused.
- [ ] Tests pass: `pnpm test`.
- [ ] Lint clean: `pnpm lint`.
- [ ] Types check: `pnpm typecheck`.
- [ ] Commits signed (`git commit -s`).
- [ ] If the change is user-facing, the README or a doc is updated.

## Code style

- TypeScript everywhere except SQL.
- 100-char line width, single quotes, trailing commas.
- No `any` without a comment explaining why.
- No `console.log` in committed code (warnings/errors are fine).

## Reporting bugs

Open an issue with:

- What you expected to happen
- What actually happened
- Steps to reproduce
- Browser + version (for tracker / web app bugs)

For security issues: **do not open a public issue.** Email `security@htmlradar.com`.

## License

By contributing, you agree that your contributions will be licensed under AGPL-3.0-or-later, matching the rest of the project.
