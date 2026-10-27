// Plausible wiring (no network): the /api/event Function with a mocked upstream fetch, and js/pa.js in a fake window.
// Run: node site/scripts/test_analytics.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { onRequest, toEvent, DEFAULT_DOMAIN } = await import(pathToFileURL(join(root, 'functions/api/event.js')));
const { SECURITY_HEADERS } = await import(pathToFileURL(join(root, 'functions/_lib/serve.js')));
let n = 0;
const test = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('FAIL', name, '\n', e); process.exitCode = 1; } };

// --- /api/event -----------------------------------------------------------------------------------------------------
const sent = [];
let upstream = () => new Response('ok', { status: 202 });
globalThis.fetch = async (url, init) => { sent.push({ url, init, body: JSON.parse(init.body) }); return upstream(); };

const SITE = 'https://theribbon.fyi';
const post = (body, { host = SITE, headers = {}, method = 'POST', env = {} } = {}) => onRequest({
  request: new Request(host + '/api/event', {
    method, body: method === 'GET' || method === 'HEAD' ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
    headers: { 'Content-Type': 'text/plain', 'User-Agent': 'Mozilla/5.0 Test', 'CF-Connecting-IP': '203.0.113.7', Origin: host, ...headers },
  }),
  env,
});
const ev = (o = {}) => ({ name: 'pageview', url: SITE + '/', domain: 'evil.example', referrer: null, props: {}, ...o });
const secured = (r) => { for (const [k, v] of Object.entries(SECURITY_HEADERS)) assert.equal(r.headers.get(k), v, k); assert.equal(r.headers.get('Cache-Control'), 'no-store'); };

await test('forwards to the self-hosted Plausible with the pinned domain, the visitor UA and IP', async () => {
  sent.length = 0;
  const r = await post(ev({ name: 'cta_click', props: { variant: 'B', source: 'assigned', path: '/' } }));
  assert.equal(r.status, 202); secured(r);
  assert.equal(sent.length, 1);
  const s = sent[0];
  assert.equal(s.url, 'https://stats.tristankennedy.art/api/event');
  assert.equal(s.init.method, 'POST');
  assert.equal(s.init.headers['Content-Type'], 'application/json');
  assert.equal(s.init.headers['User-Agent'], 'Mozilla/5.0 Test');
  assert.equal(s.init.headers['X-Plausible-IP'], '203.0.113.7');
  assert.equal(s.init.headers['X-Forwarded-For'], '203.0.113.7');
  assert.deepEqual(s.body, { name: 'cta_click', url: SITE + '/', domain: DEFAULT_DOMAIN, props: { variant: 'B', source: 'assigned', path: '/' } });
});

await test('env overrides the domain and instance; a non-https instance is refused', async () => {
  sent.length = 0;
  const env = { PLAUSIBLE_DOMAIN: 'example.org', PLAUSIBLE_API_HOST: 'https://stats.example.org/' };
  const r = await post(ev({ url: 'https://example.org/x' }), { host: 'https://example.org', env });
  assert.equal(r.status, 202); assert.equal(sent[0].url, 'https://stats.example.org/api/event'); assert.equal(sent[0].body.domain, 'example.org');
  sent.length = 0;
  assert.equal((await post(ev(), { env: { PLAUSIBLE_API_HOST: 'http://stats.tristankennedy.art' } })).status, 500); assert.equal(sent.length, 0);
});

await test('only the path and utm/ref/source parameters leave; referrer loses its query', async () => {
  sent.length = 0;
  await post(ev({ url: SITE + '/subscribe/?token=abc&email=a@b.c&utm_source=x&ref=hn&v=B', referrer: 'https://news.ycombinator.com/item?id=1' }));
  assert.equal(sent[0].body.url, SITE + '/subscribe/?utm_source=x&ref=hn');
  assert.equal(sent[0].body.referrer, 'https://news.ycombinator.com/item');
});

await test('preview and pages.dev hosts answer 202 but forward nothing', async () => {
  sent.length = 0;
  for (const host of ['https://abc123.weekend-bookmark.pages.dev', 'https://weekend-bookmark.pages.dev']) {
    const r = await post(ev({ url: host + '/' }), { host });
    assert.equal(r.status, 202, host); assert.equal(r.headers.get('X-Analytics'), 'dropped'); secured(r);
  }
  assert.equal(sent.length, 0);
});

await test('not an open relay: foreign Origin, foreign page URL and bad bodies are refused', async () => {
  sent.length = 0;
  assert.equal((await post(ev(), { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await post(ev({ url: 'https://evil.example/' }))).status, 400);
  for (const bad of ['', 'nope', '[]', 'null', '{}', JSON.stringify(ev({ name: '' })), JSON.stringify(ev({ name: 'x'.repeat(121) })),
    JSON.stringify(ev({ name: '<script>' })), JSON.stringify(ev({ url: 'javascript:alert(1)' })), JSON.stringify(ev({ url: 3 }))]) {
    assert.equal((await post(bad)).status, 400, bad);
  }
  assert.equal((await post('x'.repeat(9000))).status, 413);
  assert.equal(sent.length, 0);
});

await test('GET/HEAD/PUT are 405 with Allow: POST', async () => {
  for (const method of ['GET', 'HEAD', 'PUT']) {
    const r = await post(ev(), { method }); assert.equal(r.status, 405, method); assert.equal(r.headers.get('Allow'), 'POST'); secured(r);
  }
});

await test('upstream failure is a bare 502, never an exception or upstream detail', async () => {
  upstream = () => new Response('secret detail', { status: 400 });
  let r = await post(ev()); assert.equal(r.status, 502); assert.equal(await r.text(), 'upstream');
  upstream = () => { throw new Error('network down'); };
  r = await post(ev()); assert.equal(r.status, 502); assert.equal(await r.text(), 'upstream');
  upstream = () => new Response('ok', { status: 202 });
});

await test('props: flat strings, numbers and booleans only, at most 30, values capped', () => {
  const props = { a: 'x'.repeat(3000), b: 2, c: true, d: { nested: 1 }, e: null, f: [1] };
  for (let i = 0; i < 40; i++) props['k' + i] = 'v';
  const e = toEvent(JSON.stringify(ev({ props })), SITE, DEFAULT_DOMAIN);
  assert.equal(e.props.a.length, 2000); assert.equal(e.props.b, 2); assert.equal(e.props.c, true);
  for (const k of ['d', 'e', 'f']) assert.ok(!(k in e.props), k);
  assert.ok(Object.keys(e.props).length <= 30);
  assert.ok(!('props' in toEvent(JSON.stringify(ev({ props: [] })), SITE, DEFAULT_DOMAIN)));
});

// --- js/pa.js -------------------------------------------------------------------------------------------------------
const PA = readFileSync(join(root, 'public/js/pa.js'), 'utf8');
function page(href, { webdriver = false, ignore = null, is404 = false, referrer = '', before } = {}) {
  const posts = [];
  const store = ignore ? { plausible_ignore: ignore } : {};
  const w = {
    location: new URL(href), navigator: { webdriver },
    document: { currentScript: { dataset: { domain: 'theribbon.fyi' } }, referrer, documentElement: { hasAttribute: (a) => is404 && a === 'data-pa-404' } },
    localStorage: { getItem: (k) => (k in store ? store[k] : null) },
    fetch: (url, init) => { posts.push({ url, init, body: JSON.parse(init.body) }); return Promise.resolve(new Response('ok', { status: 202 })); },
    URL, URLSearchParams, JSON, Object, String, Promise,
  };
  w.window = w;
  if (before) before(w);
  vm.runInNewContext(PA, w);
  return { w, posts };
}

await test('pa.js: one pageview on load, posted same-origin to /api/event as text/plain with keepalive', () => {
  const { w, posts } = page('https://theribbon.fyi/library/?q=ai&utm_campaign=launch', { referrer: 'https://t.co/abc?x=1' });
  assert.equal(posts.length, 1);
  const p = posts[0];
  assert.equal(p.url, '/api/event'); assert.equal(p.init.method, 'POST'); assert.equal(p.init.keepalive, true);
  assert.equal(p.init.headers['Content-Type'], 'text/plain');
  assert.equal(p.body.name, 'pageview'); assert.equal(p.body.url, 'https://theribbon.fyi/library/?utm_campaign=launch');
  assert.equal(p.body.referrer, 'https://t.co/abc'); assert.equal(p.body.domain, 'theribbon.fyi');
  assert.equal(typeof w.plausible, 'function'); assert.equal(w.__pa.ignored, null);
});

await test('pa.js: the ab.js call shape reaches /api/event with its props; callback fires', async () => {
  const { w, posts } = page('https://theribbon.fyi/?v=B');
  let called = false;
  w.plausible('cta_click', { props: { variant: 'B', source: 'override', path: '/', junk: { a: 1 } }, callback: () => { called = true; } });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(posts[1].body.props, { variant: 'B', source: 'override', path: '/' });
  assert.equal(posts[1].body.url, 'https://theribbon.fyi/'); assert.ok(called);
});

await test('pa.js: replays a queue made before it loaded, and ignores a second copy of itself', () => {
  const { w, posts } = page('https://theribbon.fyi/', { before: (w) => { w.plausible = Object.assign(() => {}, { q: [['early', { props: { a: 'b' } }]] }); } });
  assert.deepEqual(posts.map((p) => p.body.name), ['early', 'pageview']);
  vm.runInNewContext(PA, w);
  assert.equal(posts.length, 2);
});

await test('pa.js: the 404 page also sends a 404 event with the path', () => {
  const { posts } = page('https://theribbon.fyi/nope/', { is404: true });
  assert.deepEqual(posts.map((p) => [p.body.name, p.body.props]), [['pageview', {}], ['404', { path: '/nope/' }]]);
});

await test('pa.js: nothing leaves from localhost, automation or plausible_ignore; calls are still logged', () => {
  for (const [href, opts, reason] of [['http://127.0.0.1:8000/', {}, 'localhost'], ['http://localhost/', {}, 'localhost'],
    ['https://theribbon.fyi/', { webdriver: true }, 'automation'], ['https://theribbon.fyi/', { ignore: 'true' }, 'ignored']]) {
    const { w, posts } = page(href, opts);
    w.plausible('variant_view', { props: { variant: 'A' } });
    assert.equal(posts.length, 0, reason); assert.equal(w.__pa.ignored, reason);
    assert.deepEqual([...w.__pa.log].map((e) => [e.name, e.sent]), [['pageview', false], ['variant_view', false]]);
  }
});

if (!process.exitCode) console.log(`${n} analytics tests passed`);
