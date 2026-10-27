# Performance: baseline and what launch prep changed

Measured 25 Oct 2026 with Lighthouse 13.4.1 (headless Chromium 1243, default throttling: mobile = Moto G Power on slow 4G,
desktop = `--preset=desktop`). One run each, so treat ±5 points and ±0.3 s as noise.

## Baseline: production (`weekend-bookmark.pages.dev`, main at 0be82cf, Issue 3 live)

| Page | Form | Perf | A11y | Best pr. | SEO | LCP | FCP | TBT | CLS | Weight |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | mobile | 96 | 100 | 100 | 100 | 2.7 s | 0.9 s | 0 ms | 0 | 371 KiB |
| `/` | desktop | 100 | 100 | 100 | 100 | 0.6 s | 0.3 s | 0 ms | 0 | 371 KiB |
| `/library/` | mobile | 95 | 100 | 100 | 100 | 2.7 s | 1.7 s | 20 ms | 0.044 | 372 KiB |
| `/library/` | desktop | 99 | 100 | 100 | 100 | 0.6 s | 0.3 s | 0 ms | 0.064 | 372 KiB |
| `/read/?n=3` | mobile | 98 | 98 | 100 | 92 | 2.2 s | 1.6 s | 0 ms | 0 | 550 KiB |
| `/read/?n=3` | desktop | 99 | 93 | 100 | 92 | 0.9 s | 0.6 s | 0 ms | 0.014 | 1,108 KiB |

The reader's SEO 92 is the missing meta description, now added on this branch.

## This branch, locally (`dev_server.py --fixtures`)

The Python dev server has no compression, no cache headers and only HTTP/1.1, so these numbers are **not** comparable with the
table above. Re-measure on the Pages preview URL of the PR before comparing.

| Page | Form | Perf | A11y | Best pr. | SEO | LCP | FCP | CLS | Weight |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/` (new front door) | mobile | 93 | 100 | 96* | 100 | 2.9 s | 1.7 s | 0.073 | 772 KiB |
| `/` (new front door) | desktop | 100 | 100 | 96* | 100 | 0.6 s | 0.4 s | 0 | 772 KiB |
| `/read/?n=3` | mobile | 90 | 98 | 100 | 100 | 3.2 s | 2.4 s | 0 | 552 KiB |
| `/read/?n=3` | desktop | 99 | 93 | 96* | 100 | 0.9 s | 0.6 s | 0.014 | 993 KiB |

\* Console 404s for page images missing from the dev fixtures (`p-04`, `p-16`); not a site bug.

Re-run: `site/scripts/dev_server.py --fixtures --port 8791 &` then
`CHROME_PATH=<chromium> npx lighthouse http://127.0.0.1:8791/ --chrome-flags=--headless=new [--preset=desktop]`.
On a preview deploy: same command against `https://<hash>.weekend-bookmark.pages.dev/`.

## What launch prep changed

- **`_headers`**: explicit cache lifetimes for `/favicon.svg` and `/apple-touch-icon.png` (7 days), `/og/*` and `/robots.txt`
  (1 day). Fonts were already `immutable`; issue page images and PDFs are content-addressed and `immutable` from the Function.
  `/sitemap.xml` is a Function with a 1 hour cache.
- **Reader, mobile pager**: the page on screen is fetched at `fetchpriority=high`, the two neighbour prefetches at `low` with
  async decode, so the prefetches no longer compete with the page you are looking at.
- **Reader, desktop**: after a page turn settles, the next spread's images are created at `low` priority, so the leaf of the
  next turn is already decoded instead of turning blank.
- Already in place and verified: `font-display: swap` on every face with metric-matched fallbacks (CLS 0 from fonts), latin
  and latin-ext `unicode-range` subsets, only the LCP cover is `eager` + `fetchpriority=high`, every other cover and page thumb is
  `loading=lazy` with width/height set, all page JS is `type=module` (deferred).

## Open opportunities (not done here)

1. **The LCP cover isn't discoverable from the initial HTML** (Lighthouse `lcp-discovery`): its URL comes from `manifest.json` →
   `meta.json`, two round trips after the HTML. Fix: a Pages Function middleware on `/` that reads `manifest.json` from R2 and
   adds `Link: </issues/NNN/pages/p-01.<hash>.webp>; rel=preload; as=image; fetchpriority=high`. Pages turns `Link` preloads into
   103 Early Hints. This should remove most of the two round trips from mobile LCP (unmeasured).
2. **CSS and JS are cached for 1 hour with `must-revalidate`** because the names are not content-hashed (no build step).
   `immutable` needs fingerprinted names (`site.3f9a1c.css`) plus HTML rewriting at deploy. Worth it only if a build step
   arrives for another reason.
3. **Render-blocking on the new front door**: `js/ab.js` is a classic script in `<head>` on purpose (the copy test must run
   before first paint). Keep it tiny and same-origin; it is ~600 ms of the local blocking estimate only because the dev
   server is slow.
4. **Fonts are `immutable` under stable names.** If a font file is ever replaced in place, rename it (e.g. add `-v2`) or returning
   visitors keep the old file for a year.
5. **Cloudflare Web Analytics** (free, cookieless) gives real-user LCP/INP/CLS. Turning it on in the Pages dashboard auto-injects a third-party beacon, which the current CSP blocks; it needs
   `script-src https://static.cloudflareinsights.com` and `connect-src https://cloudflareinsights.com` in the CSP (both `_headers`
   and `functions/_lib/serve.js`, kept equal by the test). Decide before enabling.
