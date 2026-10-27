# Local dev, fixtures and checks

## Fixtures (never shipped)

Sample issues (fictional posts and handles) live in `site/dev-fixtures/` (`manifest.json`, `issues/001..003`), **outside** `site/public/`, so Cloudflare Pages never uploads them.

Run the site locally with the fixtures overlaid at the site root:

    python3 site/scripts/dev_server.py --fixtures --port 8788   # http://127.0.0.1:8788/

Without `--fixtures` the server shows the real empty state (no manifest). Unknown paths return the 404 page with status 404, like Pages.

## Checks

| Command | What it checks |
| --- | --- |
| `site/scripts/check_no_example.sh` | Fails if `site/public/example/` exists, a `/example/` reference remains in `public/`, or `_redirects` has a catch-all. Run before every production publish. |
| `python3 site/scripts/test_validate_issue.py` | meta.json validator tests. |
| `python3 site/scripts/test_strip_metadata.py` | PDF/WebP metadata stripping helper tests, incl. which link annotations survive (only minimal x.com/twitter.com status links) and byte-identical re-strip (needs `pypdf`, `Pillow`, `reportlab`). |
| `PW_DIR=<dir with node_modules/playwright-core> node site/scripts/ui_check.mjs` | Chromium checks against the fixtures: front door (every copy variant above the fold at 390×844, sticky 50/50 A/B assignment, `?v=` override, `?ab=qa` switcher, book keyboard/swipe/missing-page, empty and error states, CLS, reduced motion), `/subscribe/` (validation, honest delivery-off state, local stub, email-link landing states), source hover card position at several scroll offsets, reader chip reachable with thumbnails visible, 44 px touch targets on mobile, 404 page, Plausible end to end on the production host and CSP (no violation, events reach the real `/api/event` Function). Set `CHROME_PATH` if Playwright's browser is not installed. |
| `python3 site/scripts/test_bookmark_publish.py` | `bookmark publish` tests (mocked S3, fixture issue 002; signed-approval gate with a throwaway key generated in the test temp dir; render-from-PDF, image gate, `qa.json` build record and per-build names, incl. the 18 Oct stray `pp-1.png` replay; needs `pypdf`, `Pillow`, poppler, OpenSSH 8.2+; about 3 minutes on 8 cores). |
| `node site/scripts/test_functions.mjs` | Pages Function tests (mocked R2 binding, plain node, no network). |
| `node site/scripts/test_analytics.mjs` | Plausible wiring (no network): the `/api/event` Function with a mocked upstream (self-hosted CE at `stats.tristankennedy.art` by default, visitor IP in `X-Plausible-IP`, pinned domain, query stripping, preview hosts dropped, not an open relay) and `js/pa.js` in a fake window (pageview, props, queue, 404 event, localhost/automation/ignore). docs/ANALYTICS.md. |
| `node site/scripts/test_data_js.mjs` | Reader image URLs from `meta.json` / `manifest.json`: per-build content-hash names, legacy fallback, malformed names dropped. |
| `site/scripts/check_secrets.sh` | Simple secret scan (tracked env files, key ids, private keys). Scans test files too; prints file:line only, never the matched value. Also run by `check_no_example.sh`. |
| `python3 site/scripts/test_check_secrets.py` | Secret scanner tests (temp git repos, fake credentials assembled at runtime). |
| `python3 site/scripts/test_ci_r2_env.py` | CI credential step (`ci_r2_env.py`): token derivation with the Cloudflare API mocked, `::add-mask::` lines, no value in stdout/stderr outside them, env file 700/600 accepted by `load_env`, fallback secrets. |
| `python3 site/scripts/test_ci_qa_public.py` | CI post-publish check (`ci_qa_public.py`) against an in-memory site: status, Content-Type, PDF SHA-256, image name hashes, manifest entry, retries. |
| `python3 site/scripts/test_publish_workflow.py` | Invariants of `.github/workflows/publish.yml` (secrets only in the credential step, no `${{ }}` in shell scripts, read-only token, hash-pinned deps; needs PyYAML). `actionlint .github/workflows/publish.yml` lints it. |
| `node site/scripts/test_launch.mjs` | Share cards (og/twitter, apple-touch-icon) on every template, one site origin in every share/canonical/JSON-LD URL, og image 1200x630, robots.txt, and the `/sitemap.xml` Function (manifest parsing, fallback without R2, headers), the `pa.js` tag on every page and the CSP unchanged. |
| `node workers/email/test.mjs` | Email Worker pure helpers: subscribe validation (`@kindle.com` only, no header injection), transport choice by PDF size, which PDF a Kindle gets. The Worker itself is not deployed (docs/EMAIL.md). |
| `PW_DIR=<dir with node_modules/playwright-core> node site/scripts/og/render_og.mjs` | Not a check: re-renders `public/og/default.png` and `public/apple-touch-icon.png` from `scripts/og/default.html` with the self-hosted fonts. Run after the front page's tokens or hero copy change. |
| `for f in site/public/js/*.js site/functions/*.js site/functions/*/*.js; do node --check $f; done` | JS syntax. |

## CSP rules

`_headers` sets `default-src 'self'`: no inline scripts or styles, no third-party hosts. Do not add `<script>` bodies, `style=""` in HTML files, or external URLs. The one exception is the `<script type="application/ld+json">` data block on the front page: browsers never execute it, so `script-src` does not apply (no violation is reported). (JS sets `element.style` through the CSSOM, which the policy allows.) Analytics follows the same rule: Plausible is reached only through the same-origin `/js/pa.js` and `/api/event` (docs/ANALYTICS.md), never by adding its host to the CSP.
