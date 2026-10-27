# Domain — The Ribbon

**Locked & purchased 25 Oct 2026 (owner):** brand **The Ribbon**, domain **theribbon.fyi**.

- Registrar: Cloudflare Registrar
- Price: $5.20 USD / year, auto-renew $5.20
- Account: the owner's Cloudflare account
- Permanent Kindle / issue sender: `issue@theribbon.fyi` (never change after first subscriber)
- Also plan: `hello@theribbon.fyi` (Email Routing → the owner's inbox)
- Short links in print: `theribbon.fyi/3n2` (replaces dead bkmk.to)
- Optional later: `rbbn.fyi` shortlinks only (available $5.20, not bought); `theribbon.de` → apex for Impressum era
- Pages: attach custom domain apex + www→apex; redirect weekend-bookmark.pages.dev → theribbon.fyi
- Status: **live.** Custom domain and Email Routing attached (below); site copy and URLs renamed on `site/pain-led-homepage`.

## Attached 25 Oct 2026
- Pages project `weekend-bookmark`: custom domains theribbon.fyi + www.theribbon.fyi (were Verifying)
- DNS: CNAME @ and www → weekend-bookmark.pages.dev (proxied)
- Email Routing Enabled: hello@theribbon.fyi → the owner's verified inbox; catch-all Drop
- Single Redirect: www → apex 301 (query string not preserved)
- Checked 25 Oct 2026 with curl: `https://theribbon.fyi/`, `/robots.txt` and `/manifest.json` answer 200;
  `https://www.theribbon.fyi/x?y=1` answers 301 to `https://theribbon.fyi/x?y=1` (the query string did come through).

## What the site uses (PR #12)
- **One site origin: `https://theribbon.fyi`.** Canonical links, `og:url`, `og:image`, the front page's JSON-LD and the
  robots.txt `Sitemap:` line all use it (`site/scripts/test_launch.mjs` fails if any of them differ). `/sitemap.xml`
  (`site/functions/sitemap.xml.js`, `SITE_ORIGIN`) lists theribbon.fyi URLs whichever host answers, so a crawler on
  `weekend-bookmark.pages.dev` is pointed at the canonical host.
- `weekend-bookmark.pages.dev` keeps serving production and previews (`<hash>.weekend-bookmark.pages.dev`). Infra names
  keep the old id on purpose: the Pages project, the R2 bucket `weekend-bookmark-issues`, the approval signing namespace
  `weekend-bookmark-approval` and `~/.config/weekend-bookmark/`. Renaming them would break publishing and signatures.
- Live-site QA after a publish (`site/scripts/ci_qa_public.py`) checks `https://theribbon.fyi`.
- Kindle sender `issue@theribbon.fyi` is set in `site/public/js/subscribe.js` (`SENDER`) and `workers/email/wrangler.jsonc`.
  Delivery is live (`DELIVERY = 'live'`, double opt-in through the email Worker; docs/EMAIL.md).

## Still to do (owner)
- **Email sending** (docs/EMAIL.md): onboard theribbon.fyi in Email Service (SPF, DKIM), DMARC, Resend fallback, and an
  Email Routing rule for `issue@` (today the catch-all drops it, so Amazon or reader replies to it are lost).
- **Short links:** future issues print `theribbon.fyi/<issue>n<k>` (e.g. `/3n2`). Nothing serves those paths yet; they
  need a redirect table (Pages `_redirects` or a Function) written by the print pipeline. Issue 3's printed `bkmk.to`
  links stay dead (gates/003.qa.json F1); reprinting it is out of scope.
- Google Search Console: add the domain property (DNS TXT) and submit `https://theribbon.fyi/sitemap.xml`.
- Optional, later: a Bulk Redirect `weekend-bookmark.pages.dev/*` → `https://theribbon.fyi/$1` once shared links have
  moved. Never for preview hosts (`*.weekend-bookmark.pages.dev`).
- HSTS preload: not until the domain is settled (`_headers` already sends `max-age=63072000; includeSubDomains`).
