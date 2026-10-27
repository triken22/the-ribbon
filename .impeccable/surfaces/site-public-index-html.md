---
version: 2
slug: "site-public-index-html"
primary_target: "site/public/index.html"
related_targets: ["site/public/js/front.js","site/public/js/ab.js","site/public/css/front.css","site/public/subscribe/index.html","site/public/js/subscribe.js"]
---

# Surface brief: front door (`site/public/index.html`, `/subscribe/`)

Scope: the front page and the Kindle setup flow, on the front-door system (`css/front.css`, DESIGN.md "Front door").
Visitor mode: **Persuade**. The library, issue page and reader stay in the reading register (`css/site.css`).

Audience and job: someone who wants to stay current on AI and tech without the feed. Understand the promise in one
screen, see a real issue, set up free Kindle delivery. Returning readers find this week's issue in one tap.
Content: the copy test (`js/ab.js`, variants A–D, production splits A|B), `manifest.json` and the latest issue's
`meta.json` (cover, pages, sections, headlines, colour PDF). No invented claims.
Constraints: CSP `default-src 'self'`, 44 px targets, one h1, CLS < 0.01 with late data, the whole pitch and CTA above
the fold at 390×844 in every variant, reduced motion respected, states for loading / no issues / list failed / meta
failed / missing page image.

## Direction contract

THESIS: Problem, then relief, then proof. The hero names the cost of staying current (the scroll) and the way out (one
free Saturday issue on Kindle); the real issue sits beside it as a book you can turn.

SOURCE OF TRUTH: `out/kindle-homepage-v5/` (v4 copy, A/B and book; v5 header-to-hero spacing), ported to production
25 October 2026.

FIRST VIEWPORT: bar (wordmark with the ribbon mark, Library). Phones: hero, sub, issue line, book, pager, pill CTA,
"Free. Stop delivery any time.", Read online · PDF. Desktop: problem right-aligned left, book centre, relief right.

DO NOT REGRESS TO: the Saturday Register's dense lead and archive list, or process essays above the fold.
