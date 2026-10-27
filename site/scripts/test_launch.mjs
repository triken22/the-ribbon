// Launch-prep checks (no network): share cards on every template, one site origin everywhere, icon/og image sizes,
// robots.txt, and the /sitemap.xml Function. Run: node site/scripts/test_launch.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pub = (p) => join(root, 'public', p);
const { onRequest, issuesFrom, sitemap, SITE_ORIGIN } = await import(pathToFileURL(join(root, 'functions/sitemap.xml.js')));
const { SECURITY_HEADERS } = await import(pathToFileURL(join(root, 'functions/_lib/serve.js')));
let n = 0;
const test = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('FAIL', name, '\n', e); process.exitCode = 1; } };
const meta = (html, attr, key) => { const m = new RegExp(`<meta ${attr}="${key}" content="([^"]*)">`).exec(html); return m && m[1]; };
const png = (p) => { const b = readFileSync(p); assert.equal(b.toString('latin1', 1, 4), 'PNG'); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

const PAGES = ['index.html', 'library/index.html', 'issue/index.html', 'read/index.html'];
const html = Object.fromEntries(PAGES.map((p) => [p, readFileSync(pub(p), 'utf8')]));
const ORIGIN = new URL(/^Sitemap: (\S+)$/m.exec(readFileSync(pub('robots.txt'), 'utf8'))[1]).origin; // the one site origin (docs/DOMAIN.md)

await test('every template has a large share card with an absolute image', () => {
  for (const p of PAGES) {
    const h = html[p];
    for (const k of ['og:type', 'og:site_name', 'og:title', 'og:description', 'og:image', 'og:image:alt']) assert.ok(meta(h, 'property', k), `${p} ${k}`);
    assert.equal(meta(h, 'property', 'og:image'), ORIGIN + '/og/default.png', p);
    assert.equal(meta(h, 'property', 'og:image:width'), '1200', p); assert.equal(meta(h, 'property', 'og:image:height'), '630', p);
    assert.equal(meta(h, 'name', 'twitter:card'), 'summary_large_image', p);
    assert.ok(meta(h, 'name', 'description'), `${p} description`);
    assert.ok(h.includes('<link rel="apple-touch-icon" href="/apple-touch-icon.png">'), `${p} apple-touch-icon`);
  }
});

await test('query-driven pages (issue, read) carry no canonical or og:url', () => {
  for (const p of ['issue/index.html', 'read/index.html']) { assert.ok(!/rel="canonical"|property="og:url"/.test(html[p]), p); }
  assert.ok(html['index.html'].includes(`<link rel="canonical" href="${ORIGIN}/">`));
  assert.ok(html['library/index.html'].includes(`<link rel="canonical" href="${ORIGIN}/library/">`));
});

await test('JSON-LD on the front page parses and names a WebSite and a Periodical', () => {
  const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html['index.html']);
  assert.ok(m, 'ld+json block');
  const types = JSON.parse(m[1])['@graph'].map((x) => x['@type']);
  assert.deepEqual(types.sort(), ['Periodical', 'WebSite']);
  assert.ok(!/<script(?![^>]*(?:src=|type="application\/ld\+json"))[^>]*>/.test(html['index.html']), 'no executable inline script');
});

await test('one site origin in every share, canonical and JSON-LD URL (so the domain swap is one sed)', () => {
  const urls = [];
  for (const p of PAGES) {
    const h = html[p];
    for (const m of h.matchAll(/<meta property="og:(?:url|image)" content="([^"]+)">|<link rel="canonical" href="([^"]+)">/g)) urls.push(m[1] || m[2]);
    const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(h);
    if (ld) for (const m of ld[1].matchAll(/"(https:\/\/[^"]+)"/g)) if (!m[1].startsWith('https://schema.org')) urls.push(m[1]);
  }
  assert.ok(urls.length >= PAGES.length, 'found the share URLs');
  for (const u of urls) assert.equal(new URL(u).origin, ORIGIN, u);
});

await test('images: og 1200x630, apple-touch-icon 180x180', () => {
  assert.deepEqual(png(pub('og/default.png')), [1200, 630]);
  assert.deepEqual(png(pub('apple-touch-icon.png')), [180, 180]);
});

await test('robots.txt allows all and points at the sitemap', () => {
  const t = readFileSync(pub('robots.txt'), 'utf8');
  assert.match(t, /^User-agent: \*$/m); assert.match(t, /^Allow: \/$/m); assert.ok(t.includes(`Sitemap: ${ORIGIN}/sitemap.xml`));
});

await test('CSP stays strict; forms may post only to this origin (/subscribe/)', () => {
  const csp = SECURITY_HEADERS['Content-Security-Policy'];
  for (const d of ["default-src 'self'", "script-src 'self'", "style-src 'self'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'"]) assert.ok(csp.includes(d), d);
  assert.ok(!/unsafe-|https?:|\*/.test(csp), csp);
});

await test('Plausible: every public page loads /js/pa.js same-origin, deferred, after ab.js and before any module script', () => {
  const TAG = '<script defer src="/js/pa.js" data-domain="theribbon.fyi"></script>';
  for (const p of [...PAGES, 'subscribe/index.html', '404.html']) {
    const h = readFileSync(pub(p), 'utf8');
    assert.equal(h.split(TAG).length - 1, 1, `${p} has the pa.js tag once`);
    const at = h.indexOf(TAG), ab = h.indexOf('<script src="/js/ab.js"></script>'), mod = h.search(/<script type="module"|<link rel="modulepreload"/);
    if (ab >= 0) assert.ok(ab < at, `${p}: pa.js after ab.js`);
    if (mod >= 0) assert.ok(at < mod, `${p}: pa.js before the module scripts`);
    assert.ok(!/plausible\.io|stats\.tristankennedy\.art/.test(h), `${p} never loads the Plausible host directly`);
  }
  assert.ok(/<html [^>]*data-pa-404/.test(readFileSync(pub('404.html'), 'utf8')), '404 page sends the 404 event');
  assert.equal(new URL('https://' + /data-domain="([^"]+)"/.exec(html['index.html'])[1]).origin, ORIGIN, 'data-domain is the site origin');
});

await test('Plausible: the /api/event Function exists and the CSP still allows no other host', async () => {
  const ev = await import(pathToFileURL(join(root, 'functions/api/event.js')));
  assert.equal(typeof ev.onRequest, 'function');
  assert.equal('https://' + ev.DEFAULT_DOMAIN, ORIGIN);
  const csp = SECURITY_HEADERS['Content-Security-Policy'];
  assert.ok(csp.includes("connect-src 'self';") && csp.includes("script-src 'self';") && !csp.includes('plausible') && !csp.includes('stats.tristankennedy.art'), csp);
  assert.ok(readFileSync(pub('_headers'), 'utf8').includes(csp), '_headers carries the same CSP');
});

await test('manifest parsing: valid issues newest first, junk dropped, never throws', () => {
  assert.deepEqual(issuesFrom('{"issues":[{"issue":1,"date":"2026-10-10"},{"issue":3,"date":"2026-10-24"},{"issue":3},{"issue":"2"},{"issue":0},{"issue":4,"date":"<x>"}]}'),
    [{ n: 4, date: '' }, { n: 3, date: '2026-10-24' }, { n: 1, date: '2026-10-10' }]);
  for (const bad of ['', 'nope', 'null', '{}', '{"issues":3}']) assert.deepEqual(issuesFrom(bad), []);
});

const bucket = (text) => ({ async get(k) { return k === 'manifest.json' && text != null ? { body: new Blob([text]).stream() } : null; } });
const call = (method, env, host = 'https://weekend-bookmark.pages.dev') => onRequest({ request: new Request(host + '/sitemap.xml', { method }), env });

await test('sitemap origin is the site origin of robots.txt and the share cards', () => { assert.equal(SITE_ORIGIN, ORIGIN); });

await test('sitemap lists the static pages and every issue, on the site origin whichever host answered', async () => {
  const r = await call('GET', { ISSUES: bucket(readFileSync(join(root, 'dev-fixtures/manifest.json'), 'utf8')) }, 'https://abc123.weekend-bookmark.pages.dev');
  assert.equal(r.status, 200); assert.equal(r.headers.get('Content-Type'), 'application/xml; charset=utf-8');
  assert.equal(r.headers.get('Cache-Control'), 'public, max-age=3600');
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) assert.equal(r.headers.get(k), v, k);
  const x = await r.text();
  for (const loc of ['/', '/library/', '/issue/?n=3', '/issue/?n=2', '/issue/?n=1']) assert.ok(x.includes(`<loc>${ORIGIN}${loc}</loc>`), loc);
  assert.ok(!x.includes('pages.dev'));
  assert.ok(x.includes('<lastmod>2026-10-24</lastmod>'));
});

await test('sitemap without a binding or with a bad manifest still serves the static pages', async () => {
  for (const env of [{}, { ISSUES: bucket(null) }, { ISSUES: bucket('{broken') }, { ISSUES: { get() { throw new Error('r2 down'); } } }]) {
    const r = await call('GET', env); assert.equal(r.status, 200);
    const x = await r.text(); assert.ok(x.includes(`<loc>${ORIGIN}/library/</loc>`)); assert.ok(!x.includes('/issue/'));
  }
});

await test('sitemap: HEAD has no body, other methods 405', async () => {
  const h = await call('HEAD', {}); assert.equal(h.status, 200); assert.equal(await h.text(), '');
  const p = await call('POST', {}); assert.equal(p.status, 405); assert.equal(p.headers.get('Allow'), 'GET, HEAD');
});

await test('sitemap output is well-formed for an empty list', () => {
  const x = sitemap('https://a.test', []);
  assert.match(x, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.equal((x.match(/<url>/g) || []).length, 2); assert.ok(x.trimEnd().endsWith('</urlset>'));
});

if (!process.exitCode) console.log(`${n} launch tests passed`);
