// /sitemap.xml, built from the R2 manifest so every published issue page is listed without a deploy.
// Read-only: one get() of manifest.json. A missing binding or a bad manifest still answers with the static pages.
// URLs are always on the canonical origin, whichever host answered (theribbon.fyi, weekend-bookmark.pages.dev or a preview,
// which Pages noindexes itself), so the sitemap agrees with the canonical tags. Function responses skip _headers, so the
// security headers are set here.
import { SECURITY_HEADERS } from './_lib/serve.js';

export const SITE_ORIGIN = 'https://theribbon.fyi'; // the one site origin (docs/DOMAIN.md); robots.txt and every share URL match it

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Published issues as [{n, date}], newest first. Anything malformed is dropped, never thrown. */
export function issuesFrom(text) {
  let j; try { j = JSON.parse(text); } catch { return []; }
  if (!j || !Array.isArray(j.issues)) return [];
  const seen = new Set(), out = [];
  for (const i of j.issues) {
    const n = i && i.issue;
    if (!Number.isInteger(n) || n < 1 || n > 999 || seen.has(n)) continue;
    seen.add(n); out.push({ n, date: DATE.test(String(i.date || '')) ? String(i.date) : '' });
  }
  return out.sort((a, b) => b.n - a.n);
}

export function sitemap(origin, issues) {
  const url = (path, lastmod) => `  <url><loc>${origin}${path}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`;
  const newest = issues.find((i) => i.date);
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    url('/', newest && newest.date), url('/library/', newest && newest.date),
    ...issues.map((i) => url(`/issue/?n=${i.n}`, i.date)), '</urlset>', ''].join('\n');
}

export async function onRequest({ request, env }) {
  const h = new Headers({ 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) h.set(k, v);
  if (request.method !== 'GET' && request.method !== 'HEAD') { h.set('Allow', 'GET, HEAD'); h.set('Cache-Control', 'no-store'); return new Response(null, { status: 405, headers: h }); }
  let issues = [];
  try { const o = env && env.ISSUES && await env.ISSUES.get('manifest.json'); if (o) issues = issuesFrom(await new Response(o.body).text()); } catch { /* static pages only */ }
  const body = sitemap(SITE_ORIGIN, issues);
  return new Response(request.method === 'HEAD' ? null : body, { headers: h });
}
