// /api/event: the same-origin Plausible endpoint that js/pa.js posts to. The browser never talks to Plausible (CSP
// connect-src 'self'); this Function forwards each event server-side to Plausible's Events API. docs/ANALYTICS.md.
//
// It is not an open relay: the Plausible site is always PLAUSIBLE_DOMAIN (never the client's choice), only events posted
// from this origin about a page on this origin are accepted, and only the production host's events are forwarded
// (preview deployments answer 202 with X-Analytics: dropped, so the wiring is checkable there without polluting stats).
// Only the page path and utm_* / ref / source parameters are passed on. No secret is needed for event ingest.
//
// Env (Pages settings, plain variables, both optional):
//   PLAUSIBLE_DOMAIN     the Plausible site and production host, default theribbon.fyi
//   PLAUSIBLE_API_HOST   https origin of the Plausible instance, default https://stats.tristankennedy.art (self-hosted CE)
import { SECURITY_HEADERS } from '../_lib/serve.js';

export const DEFAULT_DOMAIN = 'theribbon.fyi';
export const DEFAULT_API_HOST = 'https://stats.tristankennedy.art';
const MAX_BODY = 8192;
const KEEP = /^(utm_(source|medium|campaign|term|content)|ref|source)$/;
const NAME = /^[\w:. -]{1,120}$/;

function reply(status, body, extra = {}) {
  const h = new Headers({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', ...extra });
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) h.set(k, v);
  return new Response(body, { status, headers: h });
}

const httpUrl = (s) => { try { const u = new URL(s); return /^https?:$/.test(u.protocol) ? u : null; } catch { return null; } };

/** The event Plausible receives, or null if the body is not a valid event about a page on `origin`. Pure; no I/O. */
export function toEvent(text, origin, domain) {
  let j; try { j = JSON.parse(text); } catch { return null; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  if (typeof j.name !== 'string' || !NAME.test(j.name)) return null;
  const page = typeof j.url === 'string' && httpUrl(j.url);
  if (!page || page.origin !== origin) return null;
  const q = new URLSearchParams();
  for (const [k, v] of page.searchParams) if (KEEP.test(k)) q.append(k, v);
  const qs = q.toString();
  const ev = { name: j.name, url: page.origin + page.pathname + (qs ? '?' + qs : ''), domain };
  const ref = typeof j.referrer === 'string' && j.referrer.length <= 2000 && httpUrl(j.referrer);
  if (ref) ev.referrer = ref.origin + ref.pathname;
  if (j.props && typeof j.props === 'object' && !Array.isArray(j.props)) {
    const p = {};
    for (const [k, v] of Object.entries(j.props).slice(0, 30)) {
      if (['string', 'number', 'boolean'].includes(typeof v)) p[k.slice(0, 300)] = typeof v === 'string' ? v.slice(0, 2000) : v;
    }
    if (Object.keys(p).length) ev.props = p;
  }
  if (j.interactive === false) ev.interactive = false;
  return ev;
}

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return reply(405, null, { Allow: 'POST' });
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return reply(403, 'forbidden');
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > MAX_BODY) return reply(413, 'too large');
  let text; try { text = await request.text(); } catch { return reply(400, 'bad request'); }
  if (text.length > MAX_BODY) return reply(413, 'too large');

  const domain = (env && env.PLAUSIBLE_DOMAIN) || DEFAULT_DOMAIN;
  const ev = toEvent(text, url.origin, domain);
  if (!ev) return reply(400, 'bad request');
  if (url.hostname !== domain && url.hostname !== 'www.' + domain) return reply(202, 'ok', { 'X-Analytics': 'dropped' });

  const host = httpUrl((env && env.PLAUSIBLE_API_HOST) || DEFAULT_API_HOST);
  if (!host || host.protocol !== 'https:') return reply(500, 'not configured');
  try {
    const res = await fetch(host.origin + '/api/event', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': request.headers.get('User-Agent') || '',
        // The visitor IP, for Plausible's daily visitor hash. CE reads X-Plausible-IP first; Caddy in front of it
        // replaces an untrusted X-Forwarded-For with this Function's egress IP, so XFF alone would merge all visitors.
        'X-Plausible-IP': request.headers.get('CF-Connecting-IP') || '',
        'X-Forwarded-For': request.headers.get('CF-Connecting-IP') || '',
      },
      body: JSON.stringify(ev),
      signal: typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(5000) : undefined,
    });
    if (res.body && res.body.cancel) res.body.cancel();
    return res.ok ? reply(202, 'ok') : reply(502, 'upstream');
  } catch {
    return reply(502, 'upstream'); // no upstream detail leaks to the client
  }
}
