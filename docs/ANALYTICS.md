# Analytics: Plausible, same-origin

Chosen 25 Oct 2026: **self-hosted Plausible Community Edition** at `https://stats.tristankennedy.art` (the same VPS
as tristankennedy.art), site `theribbon.fyi`. Not Plausible Cloud. The browser only ever talks to this origin, so the
CSP stays `default-src 'self'` with `script-src 'self'` and `connect-src 'self'`. Neither Plausible nor
`stats.tristankennedy.art` is ever listed in the CSP.

```
browser                                  this origin (Cloudflare Pages)                 Plausible CE (own VPS)
/js/pa.js  ── POST /api/event ──▶  functions/api/event.js  ── POST /api/event ──▶  stats.tristankennedy.art
(static file, self-hosted)              (validates, pins the domain, forwards server-side)
```

## Pieces

| Path | File | What it does |
|---|---|---|
| `/js/pa.js` | `site/public/js/pa.js` | Self-hosted stand-in for Plausible's script (no third-party code runs on the site). Defines `window.plausible(name, { props, callback })`, sends one `pageview` per load, replays a `window.plausible.q` queue, and posts JSON (`text/plain`, `keepalive`) to `/api/event`. On the 404 page (`<html data-pa-404>`) it also sends a `404` event with `path`. |
| `/api/event` | `site/functions/api/event.js` | Pages Function. `POST` only. Refuses a foreign `Origin` (403), a page URL on another origin or a malformed body (400), bodies over 8 KB (413). Sets `domain` itself, strips the URL to path + `utm_*`/`ref`/`source`, keeps flat props (≤ 30), forwards the visitor's `User-Agent` and `CF-Connecting-IP` (as `X-Plausible-IP`, which Plausible CE reads first, and `X-Forwarded-For`; Plausible needs it for unique visitors), and answers `202`. Upstream failure is a bare `502`. |

Script tag, on `/`, `/subscribe/`, `/library/`, `/issue/`, `/read/` and the 404 page:

```html
<script defer src="/js/pa.js" data-domain="theribbon.fyi"></script>
```

It sits after `ab.js` (a classic script in `<head>`) and before every module script. `defer` scripts run in document
order before `DOMContentLoaded`, so `window.plausible` exists by the time `ab.js` sends `variant_view` and before
`subscribe.js` runs. `site/scripts/test_launch.mjs` enforces the tag and its position on every page.

## What is not sent

- **Not counted:** `localhost` / `127.0.0.1` / `file:` (the dev server), headless and automated browsers
  (`navigator.webdriver`), and any browser with `localStorage.plausible_ignore = "true"`. Run
  `localStorage.plausible_ignore = 'true'` in the console on theribbon.fyi to stop counting your own visits.
  Every call is still recorded in `window.__pa.log` (`sent: false`, with the reason) for QA.
- **Preview deployments** (`*.weekend-bookmark.pages.dev`) and `weekend-bookmark.pages.dev` itself: `/api/event`
  answers `202` with `X-Analytics: dropped` and forwards nothing. The wiring is checkable in the network tab of a
  preview; only `theribbon.fyi` (and `www.`, which 301s anyway) reaches Plausible.
- **Query strings:** only `utm_source|medium|campaign|term|content`, `ref` and `source` leave with the page URL, in the
  browser and again in the Function. `?v=`, `?ab=`, `?n=`, `?p=` and anything an email link might carry never reach
  Plausible. The referrer is sent without its query.
- No cookies, no `localStorage` writes, no IDs. Plausible derives a daily-rotating visitor hash from IP and UA
  server-side and does not store either.
- The visitor IP goes in `X-Plausible-IP` because Caddy in front of the CE instance replaces an untrusted
  `X-Forwarded-For` with the caller's address (Cloudflare's egress), which would merge every visitor into a few.

## Config

| Name | Where | Default | Notes |
|---|---|---|---|
| `PLAUSIBLE_DOMAIN` | Pages → Settings → Variables (plain text, optional) | `theribbon.fyi` | The Plausible site *and* the only host whose events are forwarded. |
| `PLAUSIBLE_API_HOST` | same | `https://stats.tristankennedy.art` | Must be `https`. Set it explicitly in Production anyway, so the target is visible in the dashboard. |

No secret, API key or shared link is needed for event ingest. Nothing secret is in the repo. A Stats API key would
only be needed to *read* results programmatically; if that is ever wanted, keep it as a Pages secret, never in git.

## Custom events

Every `ab.js` event goes to Plausible through `window.plausible(name, { props })` with **`variant`** (A–D),
**`source`** (`assigned` | `returning` | `override` | `off` | `nostorage` | `unassigned`) and **`path`**, plus:

| Event | Page | Extra props |
|---|---|---|
| `pageview` | every page (from `pa.js`) | none |
| `variant_view` | `/` load, and each QA switch | |
| `cta_click` | `/` hero pill | |
| `cta_click_kindle` | `/` Kindle beat "Set it up" | |
| `read_online_click`, `pdf_click`, `bmc_click` | `/` quiet links, Buy me a coffee | |
| `subscribe_step` | `/subscribe/` each step shown | `step` (number) |
| `subscribe_send` | `/subscribe/` test send pressed | |
| `subscribe_blocked` | `/subscribe/` send while delivery is off | `reason` (`delivery_off`) |
| `subscribe_done` | `/subscribe/` done step | |
| `subscribe_confirmed`, `subscribe_stopped`, `subscribe_expired` | `/subscribe/?confirmed` etc. | |
| `404` | the 404 page (from `pa.js`) | `path` |

The full A/B mechanics are in `PRODUCT.md` → "The copy test (A/B)".

## Owner setup (once)

No Plausible Cloud signup. The site **`theribbon.fyi`** already exists on `https://stats.tristankennedy.art` with the
custom properties `variant`, `source`, `path`, `step`, `reason` and goals for the A/B events in the table above. Do not
recreate them; add a goal there only if a new event is added to the table. Skip Plausible's snippet: the site already has `pa.js`.

1. Cloudflare Pages → `weekend-bookmark` → Settings → Variables (Production): `PLAUSIBLE_API_HOST` =
   `https://stats.tristankennedy.art`, optionally `PLAUSIBLE_DOMAIN` = `theribbon.fyi` (both match the defaults).
2. Merge the PR. After deploy, open `https://theribbon.fyi/` in a normal browser: the visit appears in the
   `theribbon.fyi` Realtime view on stats.tristankennedy.art within a minute. Then set `plausible_ignore` (above) on
   your own browsers.

## Reading the A/B test

Decide the metric before looking. Suggested:

- **Primary:** `subscribe_send` per `variant_view`, by `variant`, while Kindle delivery is off;
  switch to **`subscribe_done`** per `variant_view` once delivery is live (`DELIVERY = 'live'` in `subscribe.js`).
- **Early signal:** `cta_click` per `variant_view`.
- **Filter:** `source` is `assigned` or `returning`. Drop `override` (QA and `?v=` links), `nostorage` and `off`.

In Plausible: Goals → pick the goal → filter by property `variant`, and add a `source` filter. Compare conversion
rates, not raw counts; wait for enough visitors per arm before calling it.

## Tests

- `node site/scripts/test_analytics.mjs`: the Function (forwarding, pinned domain, query stripping, preview drop,
  Origin/URL/body refusals, 405/413/502) and `pa.js` in a fake window (pageview, props, queue, 404, ignore rules).
- `node site/scripts/test_launch.mjs`: the tag on every page, its order, and the CSP unchanged in `_headers` and the Functions.
- `ui_check.mjs` section 3b5: Chromium on `https://theribbon.fyi` (routed to the fixtures) with the production CSP
  header, `/api/event` answered by the real Function: no CSP violation, the browser never leaves the origin, and the
  `ab.js` events arrive upstream with their props.
