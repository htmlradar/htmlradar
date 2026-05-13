# HTMLRadar

**Know who's reading.** Section-level read tracking for HTML decks, briefs, and proposals. Open source under AGPL-3.0.

- **Hosted:** [htmlradar.com](https://htmlradar.com) — free for the first 10 documents, $15/mo for unlimited + custom domain + chrome-free viewer.
- **License:** AGPL-3.0-or-later. Code under `packages/` and `schema/` is the canonical source.
- **Discuss:** [GitHub Issues](https://github.com/htmlradar/htmlradar/issues) — bug reports and feature requests welcome.

---

## What this is

DocSend, rebuilt for HTML. Investor decks now ship as Pitch exports, single-file pages typed into Claude, or interactive prototypes. The category that grew up around document analytics — DocSend, PandaDoc, Brevo — was built when PDFs were the answer, and stayed loyal to it. HTMLRadar tracks what those tools don't: who read your HTML, which sections they actually dwelled on, and whether they came back.

### What it gets right

- **Section-level dwell, not "opened."** A three-second threshold separates a real read from a scroll-past. The dashboard tells you Marc spent 2m 41s on §03 The Ask, twelve seconds on Problem, and skipped Market sizing entirely.
- **Per-recipient share links.** One document, many shares. Each share carries its own email gate, password, expiry, and revocation. The dashboard tells you _which_ recipient opened it, not "someone opened it."
- **Replace the HTML, keep the link.** Re-upload after partner feedback. Every share you've already sent now points at v2. No re-sending. No broken URLs in inboxes.
- **Email when a real read happens.** A notification fires the moment the recipient crosses the three-second dwell threshold. Subject line includes the document title and the recipient.
- **No watermark on your document body.** A thin "Shared with HTMLRadar" mark sits in the viewer chrome — never on the document itself. Send to investors without flinching.

### What it deliberately is not

It's a sender-side analytics tool for one document at a time. Not a CMS, not a deck builder, not a static-site host, not a PDF viewer, not website analytics. You bring the HTML.

---

## Quick start (hosted)

1. Sign in at [htmlradar.com](https://htmlradar.com) with Google or a magic link.
2. Upload an HTML file or paste a URL.
3. Create a per-recipient share. Set an email gate, password, or expiry if you want.
4. Send the tracked link.
5. Watch the dashboard. First read notification lands in your inbox the moment the recipient crosses the dwell threshold.

Free tier: **10 documents lifetime**, unlimited shares per document. Pro tier (**$15/mo**) unlocks unlimited documents, custom domain on share URLs, chrome footer removed, allow-list, and 90-day analytics retention. Or self-host the whole thing — see below.

---

## Self-host

The full source runs on Cloudflare + Supabase free tiers.

You need:

- A Cloudflare account (Workers + R2)
- A Supabase project (free tier)
- A domain on Cloudflare DNS
- Node ≥20, PNPM ≥10, a Resend account for outbound email (optional)

See [`docs/self-hosting.md`](./docs/self-hosting.md) for the full guide — roughly 15 minutes if you already have CF and Supabase accounts. The schema is in [`schema/`](./schema/), the worker in [`packages/proxy/`](./packages/proxy/), and the web app in [`packages/app/`](./packages/app/).

Self-hosted instances must remain AGPL-3.0 — if you modify the source and run a network service from it, you have to make your modifications available. See [`LICENSE`](./LICENSE).

---

## Repo layout

```
htmlradar/
├── packages/
│   ├── tracker/      # The embedded tracker JS (~14 KB gzipped, ESM)
│   ├── proxy/        # Cloudflare Worker that serves /r/{slug}
│   └── app/          # Next.js 14 web app (auth, upload, dashboard)
├── schema/           # SQL: tables, RLS policies, SECURITY DEFINER RPCs, triggers
├── examples/         # Demo HTML documents
└── docs/             # Self-hosting, privacy, architecture, quickstart
```

The architecture decisions — why a Cloudflare Worker proxy, why hand-rolled PostgREST instead of `@supabase/supabase-js`, why stored-token session auth — are in [`docs/architecture.md`](./docs/architecture.md).

---

## Development

```bash
pnpm install
cp .env.example .env.local            # fill in keys (Supabase, R2, Resend)
pnpm dev                              # runs tracker + proxy + app in parallel
pnpm test                             # unit + integration tests
pnpm typecheck                        # tsc --noEmit across all packages
pnpm lint                             # eslint + prettier
```

Requires Node ≥20, PNPM ≥10. The web app dev server listens on `http://localhost:3000`, the proxy worker on `http://localhost:8787`, and the tracker is served from `packages/tracker/dist/tracker.js` after a build.

---

## Stack

- **Frontend:** Next.js 14 (App Router, Server Components), Tailwind CSS, Fraunces (variable serif), self-hosted via next/font.
- **Backend:** Supabase Postgres with Row Level Security + SECURITY DEFINER RPCs.
- **Proxy:** Cloudflare Worker with HTMLRewriter for tracker injection.
- **Storage:** Cloudflare R2 for uploaded HTML.
- **Auth:** Supabase Auth (Google OAuth + magic-link).
- **Email:** Resend via `pg_net` triggered from Postgres.
- **Payments:** Stripe Payment Link (Wizard-of-Oz at launch; proper checkout post-launch).

---

## Contributing

PRs welcome. We use [DCO sign-off](https://developercertificate.org/) instead of a CLA — just `git commit -s`. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full guide and code style.

Big features go through an issue first. Bug fixes and small improvements can go straight to PR.

## Security

Found a vulnerability? Email **security@htmlradar.com**. Don't open a public issue. See [`SECURITY.md`](./SECURITY.md) for the disclosure policy.

## License

AGPL-3.0-or-later. See [`LICENSE`](./LICENSE).

If you want to embed HTMLRadar's tracker in a closed-source product or run a hosted service without sharing your modifications, contact `hello@htmlradar.com` to discuss a commercial license.

---

Built with [Claude Code](https://claude.com/claude-code).
