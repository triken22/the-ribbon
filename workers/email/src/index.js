// The Ribbon email Worker (stub, NOT DEPLOYED; see docs/EMAIL.md).
//
//   POST /api/subscribe   { email, kindle, variant }  (site/public/js/subscribe.js)  -> 202, confirm mail to `email`
//   GET  /api/confirm?t=  confirm link                  -> sends the latest issue to the Kindle, redirects to /subscribe/?confirmed
//   GET  /api/stop?t=     stop link in every mail       -> stops delivery, redirects to /subscribe/?stopped
//   POST /api/stop?t=     RFC 8058 one-click unsubscribe (List-Unsubscribe-Post)
//   cron  Saturday        latest issue to every active reader not yet sent it
//
// Transport: Cloudflare Email Sending (binding EMAIL) for every message that fits its 5 MiB cap. A Kindle PDF bigger than
// CF_MAX_ATTACHMENT_BYTES goes through Resend instead, which fetches the PDF itself from the public site URL (`path`), so
// the Worker never holds the file. RESEND_API_KEY is a Worker secret, never in the repo.

const EMAIL_RE = /^[^\s@<>()",;:]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,24}$/i;
const KINDLE_RE = /^[a-z0-9._-]{1,64}@kindle\.com$/i; // same rule as subscribe.js (name part only, @kindle.com added)
const ISSUE_PDF = /^[a-z0-9-]{1,80}\.pdf$/;           // same allowlist as site/functions/_lib/serve.js

/** Normalise and validate the subscribe body. Returns {email, kindle, variant} or null. Pure. */
export function parseSubscribe(body) {
  if (!body || typeof body !== 'object') return null;
  const email = String(body.email || '').trim().toLowerCase();
  const kindle = String(body.kindle || '').trim().toLowerCase();
  const variant = /^[a-z0-9_-]{1,16}$/i.test(String(body.variant || '')) ? String(body.variant) : null;
  if (!EMAIL_RE.test(email) || !KINDLE_RE.test(kindle)) return null;
  return { email, kindle, variant };
}

/** Which transport carries a PDF of `bytes`. Pure. */
export function transportFor(bytes, max) {
  return Number.isFinite(bytes) && bytes > 0 && bytes <= max ? 'cloudflare' : 'resend';
}

/** The PDF a Kindle gets: a Kindle edition if publish ever makes one (docs/EMAIL.md), else greyscale (e-ink), else colour. Pure. */
export function kindleFile(meta) {
  const f = (meta && meta.files) || {};
  for (const name of [f.pdf_kindle, f.pdf_grayscale, f.pdf_color]) if (typeof name === 'string' && ISSUE_PDF.test(name)) return name;
  return null;
}

const pad3 = (n) => String(n).padStart(3, '0');
const token = () => { const b = crypto.getRandomValues(new Uint8Array(32)); return btoa(String.fromCharCode(...b)).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]); };
const sha256 = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, '0')).join('');
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const back = (env, q) => Response.redirect(`${env.SITE}/subscribe/?${q}`, 303);

async function readJson(env, key) {
  const o = await env.ISSUES.get(key);
  return o ? JSON.parse(await o.text()) : null;
}

async function latestIssue(env) {
  const m = await readJson(env, 'manifest.json');
  const n = m && Number.isInteger(m.latest) ? m.latest : null;
  if (!n) return null;
  const meta = await readJson(env, `issues/${pad3(n)}/meta.json`);
  const file = kindleFile(meta);
  return file && { n, title: String(meta.title || `Issue ${n}`), file, key: `issues/${pad3(n)}/${file}` };
}

/** Sends one message. `pdf` = {key, file} attaches an issue PDF, choosing the transport by size. */
async function send(env, { to, subject, text, stopUrl, pdf }) {
  const from = { email: env.FROM_ISSUES, name: env.FROM_NAME };
  const headers = stopUrl ? { 'List-Unsubscribe': `<${stopUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined;
  let attachments;
  if (pdf) {
    const head = await env.ISSUES.head(pdf.key);
    if (!head) throw new Error(`missing ${pdf.key}`);
    if (transportFor(head.size, +env.CF_MAX_ATTACHMENT_BYTES) === 'resend') return sendResend(env, { from, to, subject, text, headers, pdf });
    const body = await env.ISSUES.get(pdf.key);
    attachments = [{ content: await body.arrayBuffer(), filename: pdf.file, type: 'application/pdf', disposition: 'attachment' }];
  }
  return env.EMAIL.send({ from, to, subject, text, headers, attachments });
}

async function sendResend(env, { from, to, subject, text, headers, pdf }) {
  if (!env.RESEND_API_KEY) throw new Error('PDF too large for Cloudflare Email Sending and RESEND_API_KEY is not set');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    // Resend fetches the attachment from the public URL itself (40 MB message cap); served by site/functions/issues.
    body: JSON.stringify({ from: `${from.name} <${from.email}>`, to: [to], subject, text, headers,
      attachments: [{ path: `${env.SITE}/${pdf.key}`, filename: pdf.file }] }),
  });
  if (!r.ok) throw new Error(`resend ${r.status}`);
  return r.json();
}

async function deliver(env, sub, issue) {
  await send(env, {
    to: sub.kindle,
    subject: `The Ribbon, No. ${issue.n}: ${issue.title}`, // no "Convert": keep the printed layout
    // Amazon files the attachment and never shows this body, so the stop link lives in the confirm mail (to the reader's own
    // address). Raw stop tokens are not stored, so a later "your issue was sent" mail would need a new stop token per send.
    text: `Issue ${issue.n} of The Ribbon is attached.`,
    pdf: issue,
  });
  await env.DB.prepare('UPDATE subscribers SET last_issue = ?1 WHERE id = ?2').bind(issue.n, sub.id).run();
}

async function subscribe(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (env.SUBSCRIBE_LIMIT && !(await env.SUBSCRIBE_LIMIT.limit({ key: ip })).success) return json(429, { error: 'slow_down' });
  let body; try { body = await request.json(); } catch { return json(400, { error: 'bad_json' }); }
  const s = parseSubscribe(body);
  if (!s) return json(422, { error: 'invalid' });
  const confirm = token(), stop = token();
  // Re-subscribing (pending or stopped) rotates both tokens; an active reader just gets a fresh confirm mail.
  await env.DB.prepare(`INSERT INTO subscribers (email, kindle, status, confirm_hash, stop_hash, variant) VALUES (?1, ?2, 'pending', ?3, ?4, ?5)
    ON CONFLICT(email) DO UPDATE SET kindle = ?2, confirm_hash = ?3, stop_hash = ?4, variant = ?5,
      status = CASE status WHEN 'active' THEN 'active' ELSE 'pending' END`)
    .bind(s.email, s.kindle, await sha256(confirm), await sha256(stop), s.variant).run();
  const stopUrl = `${env.SITE}/api/stop?t=${stop}`;
  await send(env, {
    to: s.email,
    subject: 'Confirm your Kindle delivery',
    text: [
      'One step left. Confirm and the latest issue goes to your Kindle:', `${env.SITE}/api/confirm?t=${confirm}`, '',
      `First, add ${env.FROM_ISSUES} to your Approved Personal Document E-mail List on Amazon (Manage Your Content and Devices > Preferences > Personal Document Settings), or Amazon will drop it.`, '',
      `Didn't ask for this? Ignore it, nothing is sent. Stop at any time: ${stopUrl}`,
    ].join('\n'),
    stopUrl,
  });
  return json(202, { ok: true }); // same answer whether the address was new or known: no account enumeration
}

async function confirm(url, env) {
  const t = url.searchParams.get('t') || '';
  const sub = t && await env.DB.prepare("SELECT * FROM subscribers WHERE confirm_hash = ?1 AND status IN ('pending', 'active')").bind(await sha256(t)).first();
  if (!sub) return back(env, 'expired');
  await env.DB.prepare("UPDATE subscribers SET status = 'active', confirm_hash = NULL, confirmed_at = datetime('now') WHERE id = ?1").bind(sub.id).run();
  const issue = await latestIssue(env);
  if (issue && sub.last_issue !== issue.n) await deliver(env, sub, issue);
  return back(env, 'confirmed');
}

async function stop(url, env) {
  const t = url.searchParams.get('t') || '';
  if (t) await env.DB.prepare("UPDATE subscribers SET status = 'stopped' WHERE stop_hash = ?1").bind(await sha256(t)).run();
  return back(env, 'stopped'); // same answer for unknown tokens
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname}`;
    try {
      if (route === 'POST /api/subscribe') return await subscribe(request, env);
      if (route === 'GET /api/confirm') return await confirm(url, env);
      if (route === 'GET /api/stop' || route === 'POST /api/stop') return await stop(url, env);
      return json(404, { error: 'not_found' });
    } catch (e) {
      console.error('email worker', route, e && (e.code || e.message)); // never log addresses or tokens
      return json(500, { error: 'try_again' });
    }
  },

  // Weekly run. Fine for hundreds of readers; past that, enqueue one message per reader on a Queue and send from the consumer.
  async scheduled(_event, env) {
    const issue = await latestIssue(env);
    if (!issue) return;
    const { results } = await env.DB.prepare("SELECT * FROM subscribers WHERE status = 'active' AND (last_issue IS NULL OR last_issue < ?1)").bind(issue.n).all();
    for (const sub of results) {
      try { await deliver(env, sub, issue); } catch (e) { console.error('deliver', sub.id, e && (e.code || e.message)); }
    }
  },
};
