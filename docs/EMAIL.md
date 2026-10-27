# Email: Kindle delivery, confirm and stop mail

Status: **planned, not deployed.** Code: `workers/email/` (Worker stub, D1 schema, `wrangler.jsonc` set for `theribbon.fyi`).
The domain exists (docs/DOMAIN.md); the sending side below has not been set up. Facts below were checked against the Cloudflare and Resend docs on
25 Oct 2026; Email Sending is in **beta**, so re-check limits before go-live.

## What gets sent

| Mail | From | To | Size | Transport |
| --- | --- | --- | --- | --- |
| Confirm (double opt-in), with the stop link | `issue@theribbon.fyi` | the reader's own address | a few KB | Cloudflare Email Sending |
| Latest issue, on confirm and every Saturday | `issue@theribbon.fyi` | `name@kindle.com` | the issue PDF | Cloudflare if the PDF is ≤ 3.6 MB, else Resend |

All of it is transactional: one sign-up, one confirmation, one issue a week to an address the reader asked for. No marketing
blasts go through this path.

Amazon only accepts documents from senders on the reader's **Approved Personal Document E-mail List**, so `issue@theribbon.fyi` must
never change once readers have approved it (it is fixed now: `SENDER` in `site/public/js/subscribe.js`, `FROM_ISSUES` here). The confirm mail and `/subscribe/` both tell the reader to add it.

## The attachment problem, and the decision

- Cloudflare Email Sending caps a message at **5 MiB including attachments** (25 MiB only for *verified destination*
  addresses, which a Kindle address can never be, because nobody can click a verification link on it). Base64 inflates
  attachments by 4/3, so the PDF must be **under about 3.6 MB**. The Worker's `CF_MAX_ATTACHMENT_BYTES` is 3,600,000.
- Issue 3's greyscale PDF is **9.98 MiB** and the colour one **19.16 MiB**. Neither fits.
- **Resend** allows **40 MB per message after base64**, and can fetch the attachment itself from a URL (`attachments[].path`),
  so the Worker never loads the PDF into memory. Kindle accepts attachments up to 50 MB.

**Decision (proposed, needs the owner's yes):**

1. Confirm and stop mail: Cloudflare Email Sending (binding `EMAIL`).
2. Kindle PDF: the Worker picks the transport by size (`transportFor()`): Cloudflare when it fits, Resend otherwise. Today that
   means Resend for every issue.
3. **To drop Resend**, add a Kindle edition to `bookmark publish`: greyscale, about 150 dpi, JPEG images. 16 pages should land
   around 2–3 MB, which would need confirming on Issue 3. Name it `issue-NNN-kindle.pdf` and add `files.pdf_kindle` to
   `meta.json` (`serve.js` already serves the name; `validate_issue.py`, `ci_qa_public.py` and the publish image gate need to learn the new key). Then `kindleFile()` prefers it, everything goes
   through Cloudflare, and the Resend key can be deleted.

Copy this decision into PRODUCT.md once it is agreed (CLOUDFLARE-LAUNCH.md asks for it there).

## Costs to know about

- **Email Sending to arbitrary recipients requires the Workers Paid plan** (USD 5/month). Sending only to verified addresses
  is free, which covers testing to the owner's own inbox. Check the Email Service pricing page for the included monthly volume.
- Email Routing (inbound `hello@`, later `issue@` and `dmarc@` → the owner's inbox) is free.
- Resend has a free tier; check its current monthly and daily caps against the reader count before relying on it.
- D1 and the rate-limiting binding are within the free allowances at this scale.

## Flow (workers/email/src/index.js)

1. `/subscribe/` POSTs `{email, kindle, variant}` to `/api/subscribe` (same origin, so the CSP's `connect-src 'self'` holds).
2. Rate limit per IP (5/min), validate (`name@kindle.com` only, no CR/LF), upsert a `pending` row with SHA-256 hashes of a
   confirm token and a stop token, send the confirm mail, answer `202` whether or not the address was already known.
3. `GET /api/confirm?t=` → row becomes `active` and the latest issue goes to the Kindle at once → 303 to `/subscribe/?confirmed`.
4. `GET|POST /api/stop?t=` → `stopped` → 303 to `/subscribe/?stopped`. Every mail to the reader carries
   `List-Unsubscribe` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (Gmail/Yahoo bulk-sender rules).
5. Cron `0 7 * * SAT`: every `active` reader whose `last_issue` is older than the latest issue gets it; `last_issue` is
   written after each send, so a re-run never double-sends. Past a few hundred readers, move sends onto a Queue.

Logs never contain addresses or tokens, only row ids and error codes.

**Open before go-live:** bot protection on `/api/subscribe` beyond the rate limit (Turnstile needs `challenges.cloudflare.com`
in `script-src` and `frame-src`, a CSP change both in `_headers` and `functions/_lib/serve.js`); a privacy note on `/subscribe/`
(what is stored: two addresses, the copy-test arm, timestamps); the `/subscribe/?confirmed|stopped|expired` states on the page.

## Setup, once the domain is on Cloudflare (no secrets in the repo, ever)

```sh
cd workers/email
pnpm add -D wrangler                                 # local only; node_modules stays untracked
pnpm exec wrangler login

# 1. Sending domain: Dashboard > Email > Email Service > Onboard domain theribbon.fyi.
#    Cloudflare adds the SPF (TXT), DKIM (TXT) and bounce/return-path records on the zone. Then add DMARC yourself:
#      _dmarc.theribbon.fyi  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@theribbon.fyi; adkim=s; aspf=s"
#    (move p=none -> quarantine after two clean weeks of reports). SPF/DKIM/DMARC must pass before the first Kindle send.
# 2. Inbound: Email Routing is already on (hello@ -> the owner's inbox, catch-all drops). At go-live add rules for
#    issue@theribbon.fyi (Amazon and reader replies) and dmarc@theribbon.fyi -> the same verified inbox.

# 3. Database
pnpm exec wrangler d1 create weekend-bookmark-subscribers  # paste database_id into wrangler.jsonc
pnpm exec wrangler d1 migrations apply weekend-bookmark-subscribers --remote

# 4. wrangler.jsonc already names theribbon.fyi (routes, vars, allowed_sender_addresses); only database_id is left.

# 5. Fallback transport (only while the Kindle PDF is > 3.6 MB). Resend: add theribbon.fyi, publish its DKIM/SPF records,
#    create a *sending-only* API key restricted to theribbon.fyi, then:
pnpm exec wrangler secret put RESEND_API_KEY               # pasted at the prompt; never in chat, repo, PR or shell history

# 6. Test before any route goes live: preview with remote bindings, sending only to a verified address.
pnpm exec wrangler dev --remote
node ../../workers/email/test.mjs                    # pure helpers

# 7. Deploy (adds the theribbon.fyi/api/* route). The owner's explicit go-ahead first.
pnpm exec wrangler deploy
```

Local `wrangler dev` without `--remote` cannot serialise binary attachments; use `--remote` (or Base64 content) to test a
Kindle send.

## Checks before the first real send

- `dig TXT theribbon.fyi`, `dig TXT <selector>._domainkey.theribbon.fyi` (the selector the dashboard shows), `dig TXT _dmarc.theribbon.fyi`.
- Send the confirm mail to a Gmail address, open *Show original*: SPF, DKIM and DMARC all `PASS`, `List-Unsubscribe` present.
- Add `issue@theribbon.fyi` to your own Kindle's approved list, confirm, and check the PDF arrives in *Manage Your Content and Devices*
  under Docs.
