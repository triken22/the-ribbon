# The Ribbon

A free weekly Kindle magazine of edited X bookmarks. Each Saturday, a week of saved posts becomes a short, printable
issue that's quiet to read and lands on your Kindle.

**Live:** https://theribbon.fyi

This repo holds the site, the email Worker and the publishing pipeline. (The repo is still called `weekend-bookmark`,
the magazine's old name, and so are some of its infra ids.)

## What's here

| Path | What it is |
| --- | --- |
| `site/public/` | The static site: front page, library, issue pages, reader, subscribe. No build step, no framework. |
| `site/functions/` | Cloudflare Pages Functions: issues served from a private R2 bucket, sitemap, same-origin analytics proxy. |
| `site/scripts/` | `bookmark publish` (strip, render, gate and upload an issue to R2), validators and tests. |
| `site/dev-fixtures/` | Sample issues for local development (never deployed). |
| `workers/email/` | Cloudflare Worker for double opt-in Kindle delivery (D1, Email Sending, Resend fallback). |
| `docs/`, `site/docs/` | Runbooks: publishing, email, analytics, domain, performance. |
| `PRODUCT.md`, `DESIGN.md` | What the product is and the editorial design system. |

## Quick start

The site is plain HTML, CSS and JS hosted on Cloudflare Pages (project root `site`, output `site/public`). To run it
locally with the sample issues:

```sh
python3 site/scripts/dev_server.py --fixtures --port 8788   # http://127.0.0.1:8788/
```

Checks, with what each one needs, are listed in [`site/docs/DEV.md`](site/docs/DEV.md). The quick ones need only Python 3
and Node:

```sh
node site/scripts/test_functions.mjs
node site/scripts/test_launch.mjs
node workers/email/test.mjs
site/scripts/check_secrets.sh
```

The email Worker uses wrangler (`cd workers/email && pnpm add -D wrangler`). Setup and deploy steps are in
[`docs/EMAIL.md`](docs/EMAIL.md). Publishing an issue is in [`site/docs/PUBLISH.md`](site/docs/PUBLISH.md).

## Env and secrets

No real values live in this repo. The secret **names** are in [`.env.example`](.env.example) (Pages variables, the
publish env file, GitHub Actions secrets) and [`workers/email/.env.example`](workers/email/.env.example) (`RESEND_API_KEY`).
Worker secrets go in with `wrangler secret put`. The R2 publish credentials go in an env file outside any git checkout.
Run `site/scripts/check_secrets.sh` before you open a PR.

Publishing is gated on a signed approval: the repo owner pins their SSH **public** key in
`site/keys/approval_allowed_signers` through a reviewed PR and signs each issue on their own machine. Agents and CI never
hold that key. The details are in `site/docs/PUBLISH.md`, section 1a.

## Privacy

Nobody's bookmarks are in this repo, and neither is any subscriber data. Subscribers live in a Cloudflare D1 database.
Tokens are stored only as hashes, and logs never contain addresses. Analytics are cookieless, self-hosted Plausible,
reached same-origin ([`docs/ANALYTICS.md`](docs/ANALYTICS.md)).

## License

The code is [MIT](LICENSE). Published issues are not: their PDFs, page images and editorial text, and The Ribbon's name
and masthead, remain © Tristan Kennedy, all rights reserved. Fork the code and make your own magazine, but please don't
republish The Ribbon's issues as yours. See [`CONTENT-LICENSE.md`](CONTENT-LICENSE.md).

## Contributing

PRs are welcome: bug fixes, accessibility, performance, docs. Keep changes small, run the checks that apply from
`site/docs/DEV.md`, and follow the CSP rules there (no inline scripts or styles, no third-party hosts). Never commit
secrets, real `.env` files, subscriber data or private keys. If you find a security issue, please report it privately
via GitHub's "Report a vulnerability" rather than in a public issue.
