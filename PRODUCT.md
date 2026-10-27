# Product

<!-- impeccable:product-schema 1 -->

> Updated 2026-10-25 for the pain-led front door (positioning, A/B test, Kindle delivery). First written during a
> non-interactive run (homepage redesign, 2026-10-23). No interview was possible, so every fact below is
> inferred from the repository and the owner's brief and is unconfirmed until the owner reviews it.

## Platform

web

## Users

People who want to stay current on AI and tech without living in the feed: they know the week's posts on X matter, and
they're tired of the scroll it takes to find them. They read on a Kindle (or on screen, or printed) on Saturday.
Secondary: existing readers who come back for this week's issue or an earlier one.

## Product Purpose

A free weekly magazine: sixteen pages of what mattered in AI and tech this week, edited from a week of saved posts on X,
delivered to the reader's Kindle every Saturday. Each issue is also published as a colour PDF, a greyscale print PDF and
page images for an online reader. Success: a visitor understands the promise in one screen and sets up Kindle delivery;
a returning reader finds the newest issue at once and can reach any earlier one.

## Positioning

**Pain-led.** The front door names the problem first (staying current costs a doom-scroll) and then the relief (one
finished, free Saturday issue on your Kindle). Process ("made from a week of saved posts on X", editors, sub-editors) is
true and stays, but below the fold and in the footer, never as the pitch. The issue itself is the proof: the real cover
and every real page, turnable on the front page.

**Copy test (live from this release).** Four hero variants exist; production splits new visitors 50/50 between A and B.
Only the hero line, the sub and the primary CTA label vary; everything else is constant.

| ID | Hero (problem / relief) | Sub | CTA |
|---|---|---|---|
| **A** (default, no-JS, crawlers) | Stay current on tech. / Skip the scroll. | Sixteen pages of what mattered in AI and tech this week — free on your Kindle every Saturday. | Get it free on Kindle |
| **B** | The week on X — / without opening X. | Edited bookmarks, no account, no algorithm. Free every Saturday. | Get it free on Kindle |
| C (preview only) | What people said. / Not what media spun. | Primary posts from the week, cut to sixteen pages. Free on Kindle. | Get it free on Kindle |
| D (preview only) | Sixteen pages. / Zero doomscroll. | One free Saturday magazine instead of another week in the feed. | Send free issues to Kindle |

Constant in every arm: "**Free.** Stop delivery any time." under the CTA; the Kindle beat "Leave the feed. Keep the
*signal*."; the footer "See you Saturday." with "Free to read. Enjoying it? Buy me a coffee".

## Operating Context

- Static site on Cloudflare Pages (`site/public/`), served at `https://theribbon.fyi` (`www` 301s to the apex;
  `weekend-bookmark.pages.dev` still answers), with Pages Functions serving `/manifest.json` and `/issues/*` from R2 and `/api/event` (Plausible, docs/ANALYTICS.md).
  Pages is connected to GitHub: every PR gets a preview deployment; `main` is production.
- Data flow: `/manifest.json` lists published issues; `/issues/NNN/meta.json` carries the per-issue record (title, date,
  cover headline, sections, articles, credits, PDF file names, per-build page image names). See `site/docs/PIPELINE-SPEC.md`.
- Routes: `/` (front door: pitch, the latest issue as a turnable book, Kindle beat), `/subscribe/` (Kindle setup, four
  steps, plus `?confirmed|stopped|expired` landing states), `/library/` (every issue, search and filters),
  `/issue/?n=N` (contents and downloads), `/read/?n=N&p=P` (online page reader).
- Issues are published by `bookmark publish NNN` behind a signed approval; the site never edits issue data. The front
  page picks up a new issue (cover, pages, last page on the Kindle) from the manifest with no site change.

## The copy test (A/B): how it works

`site/public/js/ab.js`, a classic script loaded synchronously in `<head>` so the visitor's copy is in before first paint.

| Mechanism | Behaviour |
|---|---|
| `CONFIG.enabled` (top of `ab.js`) | `true`: new visitors get a fair coin over `CONFIG.arms` (`['A','B']`). `false`: everyone sees `CONFIG.fallback` (A); stored assignments are ignored; a `?v=` link still previews for that page view and is not saved. **This is the kill switch.** |
| Assignment | Stored in `localStorage` as `wb_ab` (variant) and `wb_ab_src` (`assigned` or `override`). Returning visitors keep their arm. Only the front page assigns (`<html data-ab-assign>`); `/subscribe/` only reads. |
| `?v=A…D` | Override, case-insensitive, saved as `override` so analysis can exclude it. Invalid values are ignored. |
| `?ab=qa` | Shows the QA switcher (dashed chip) for the tab's session; `?ab=off` hides it. Visitors never see it. |
| No storage | Visitors whose browser blocks `localStorage` see A and are labelled `nostorage` (exclude them). |
| No flash | `<html data-ab>` is set before the body parses; a non-A hero stays hidden until its copy is in. |

**Events** (every event carries `variant`, `source` and `path`):

| Event | When |
|---|---|
| `variant_view` | Front page load (and each QA switch) |
| `cta_click` / `cta_click_kindle` | Hero pill / Kindle beat "Set it up" |
| `read_online_click`, `pdf_click`, `bmc_click` | The quiet links and Buy me a coffee |
| `subscribe_step` (`step`), `subscribe_send` | Each subscribe step shown; the test send pressed |
| `subscribe_blocked` (`reason: delivery_off`) | Send pressed while delivery is off |
| `subscribe_done` | The done step (stub or live) |
| `subscribe_confirmed` / `_stopped` / `_expired` | The email links' landing states |

**Where events go:** `console.info('[wb_ab]', …)`, `window.__wbAb.events`, a `wb:track` DOM event, and **Plausible**
through `window.plausible`, defined by the self-hosted `js/pa.js`, which posts to `/api/event` on this origin; a Pages
Function forwards server-side to self-hosted Plausible CE at `stats.tristankennedy.art` (same VPS as tristankennedy.art;
not Plausible Cloud). The CSP is unchanged (`script-src 'self'`, `connect-src 'self'`).
Plausible props: `variant`, `source`, `path`, plus `step` / `reason` where listed. Setup, privacy rules (what is not
counted or sent) and how to read the test: `docs/ANALYTICS.md`.

Decide the success metric before reading results: `subscribe_send` per `variant_view` while delivery is off, then
`subscribe_done` once it is live; `cta_click` as the early signal; `source` in `{assigned, returning}` only.

## Capabilities and Constraints

- CSP is `default-src 'self'`: no inline scripts or styles, no third-party hosts, fonts self-hosted. `form-action 'self'`:
  forms may submit only to this origin (the subscribe form is driven by script and posts with `fetch`).
- Every string from `meta.json` is rendered as plain text, never HTML; unknown keys are ignored.
- A missing or malformed manifest is a calm "no issues yet" state, never an error. The pitch and CTA work regardless.
- Mobile and desktop both matter; touch targets at least 44 px; the whole pitch and CTA fit a 390×844 first screen
  (`site/scripts/ui_check.mjs`).
- **Kindle delivery is live.** `js/subscribe.js` `DELIVERY = 'live'` POSTs `{email, kindle, variant}` to `/api/subscribe`
  (the email Worker in `workers/email/`, docs/EMAIL.md). Double opt-in: the reader gets a confirm link by email, and the
  issue goes to the Kindle only after they confirm, so steps 4 and 5 say "check your email", never "sent". `'off'` is the
  kill switch: a notice says nothing is sent or saved, and the send says so plainly instead of pretending.

## Brand Commitments

- Name: **The Ribbon** (renamed from The Weekend Bookmark on 25 Oct 2026; Issue 3 was printed under the old name).
  Domain `https://theribbon.fyi`, the one site origin for canonical, share-card, JSON-LD and sitemap URLs. Kindle
  sender `issue@theribbon.fyi`, permanent once readers approve it; contact `hello@theribbon.fyi`. Front-door promise (variant A): "Stay current on tech. Skip the scroll." The reading
  register keeps the tagline "What caught my eye on X this week".
- Free to read, free on Kindle. Support is a quiet "Buy me a coffee" link, never a gate.
- Faces, all self-hosted, SIL OFL: Instrument Serif and Schibsted Grotesk (front door); Newsreader, IBM Plex Sans
  Condensed, IBM Plex Mono (reading register).
- Ochre ground with ink and the red ribbon on the front door; paper and ink with one red in the reading register.

## Evidence on Hand

- Real issues: only those in the live `/manifest.json` (Issue 3 at the time of writing). Fixture issues in
  `site/dev-fixtures/` are fictional and never ship.
- No testimonials, subscriber numbers, press or pricing exist. Do not invent them.

## Product Principles

1. The promise leads and the newest issue proves it: the real cover and pages, one turn away. Everything else is one step away.
2. Show only what the published data says. No invented claims, counts or schedules beyond the shipped copy.
3. The publication is the artifact; the site frames it and gets out of the way.
4. Privacy boundary first: nothing from the bookmarks beyond what the printed issue already credits.
5. Never claim what isn't true yet: no "sent" without a send, no subscriber counts, no schedule beyond Saturday.

## Accessibility & Inclusion

WCAG 2.1 AA as the working bar: real contrast, keyboard access, visible focus, 44 px targets, reduced motion respected.

## Open items for the owner

- [ ] **Buy me a coffee:** add the link in `site/public/index.html` (footer, marked `TODO(owner)`) once there is a
      real username. Until then the footer says only "Free to read." (no placeholder link).
- [x] **Kindle delivery:** the email Worker is deployed and `DELIVERY = 'live'` in `site/public/js/subscribe.js`
      (`SENDER` is `issue@theribbon.fyi`). Set it back to `'off'` to pause sign-ups honestly.
- [ ] **Stripe:** nothing to do while the product is free. If a paid tier ever exists, it gets its own route and a CSP
      change for Stripe's hosts.
- [ ] **Analytics:** self-hosted Plausible CE at `stats.tristankennedy.art` chosen and wired (same-origin via `/js/pa.js`
      + `/api/event`, `docs/ANALYTICS.md`). The site `theribbon.fyi`, its goals and custom properties already exist there;
      no Cloud signup. Owner: set `PLAUSIBLE_API_HOST` in Pages Production, and `plausible_ignore` on your own browsers.
- [ ] **End the test:** set `CONFIG.enabled = false` and, if B wins, make B the static copy in `index.html` and the fallback.

