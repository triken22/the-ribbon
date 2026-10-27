# Cloudflare launch prep (add to production PR)

Owner ask (25 Oct 2026): prepare everything on Cloudflare for launch — Email, cheap domain (<€5), social graph, performance.

## Email (transactional)
- Kindle sender is `issue@theribbon.fyi` (permanent, approved by readers on Amazon); `hello@theribbon.fyi` is routed to the owner's inbox.
- CF Email Sending = transactional only — weekly Kindle delivery + confirm/stop links fit; not blast marketing.
- Attach greyscale PDF/EPUB via Worker or external Resend if attachment limits block CF path; document choice in PRODUCT.md.
- SPF/DKIM/DMARC required before first Kindle send.

## Domain
- Done 25 Oct 2026: `theribbon.fyi` ($5.20/yr, Cloudflare Registrar) on Pages project `weekend-bookmark`.
- `weekend-bookmark.pages.dev` stays up as fallback and preview host.

## Social graph
- OG + Twitter cards on homepage + issue pages; 1200×630 share image per issue (or default brand).
- JSON-LD WebSite / Periodical; sitemap.xml; robots.txt; apple-touch-icon.
- Respect CSP (self-hosted assets only).

## Performance
- `_headers` cache for fonts/css/js/images; immutable hashed assets if applicable.
- Lazy-load swipe page images; responsive srcset; preload only LCP cover.
- Font subset latin; avoid layout shift; defer non-critical JS.
- Measure with Pages preview + Web Analytics / local Lighthouse.

## Out of scope for silent prod
- Do not buy domain or flip production custom domain without the owner's yes.
- Open PR + preview URL; wait for approval to attach custom domain.

## Status (25 Oct 2026, branch `site/pain-led-homepage`)

| Item | State | Where |
| --- | --- | --- |
| OG + Twitter cards, canonical, apple-touch-icon | Done on `/`, `/library/`, `/issue/`, `/read/` (and `/subscribe/` by the homepage session) | `site/public/*/index.html`, `docs/snippets/front-head.html` |
| Default 1200×630 share image | Done, in the front-door style; re-render with `site/scripts/og/render_og.mjs` | `site/public/og/default.png` |
| Per-issue share image / title | **Not done.** `/issue/?n=` is client-rendered, so crawlers see the default card. Needs a Pages Function (HTMLRewriter on `/issue/`) reading `meta.json` from R2, plus a 1200×630 crop per issue made at publish | — |
| JSON-LD WebSite + Periodical | Done (front page; a data block, CSP-safe) | `site/public/index.html` |
| sitemap.xml, robots.txt | Done: sitemap is a Function built from the R2 manifest | `site/functions/sitemap.xml.js`, `site/public/robots.txt` |
| `_headers` caching | Icons, og, robots added; fonts already immutable; CSS/JS stay 1 h (names not hashed) | `site/public/_headers`, `docs/PERF.md` |
| Lazy/priority hints for reader pages, font-display | Reader priorities done; font-display swap + metric fallbacks were already in place | `site/public/js/reader.js` |
| Lighthouse baseline | Done | `docs/PERF.md` |
| Email | Planned + Worker stub, **not deployed**. The greyscale PDF (10 MiB) is over Cloudflare's 5 MiB cap: Resend fallback, or a ≤3.6 MB Kindle edition | `docs/EMAIL.md`, `workers/email/` |
| Domain | **Live:** `theribbon.fyi` on Pages (apex, `www` → apex 301). Site URLs moved to it on `site/pain-led-homepage` | `docs/DOMAIN.md` |
