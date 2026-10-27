// Plain-node tests for the Pages Functions (no network, mocked R2 binding). Run: node site/scripts/test_functions.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { serve, route, parseRange, SECURITY_HEADERS } = await import(pathToFileURL(join(root, 'functions/_lib/serve.js')));
const issues = await import(pathToFileURL(join(root, 'functions/issues/[[path]].js')));
const manifestFn = await import(pathToFileURL(join(root, 'functions/manifest.json.js')));
let n = 0;
const test = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('FAIL', name, '\n', e); process.exitCode = 1; } };

const PDF = new Uint8Array(100).map((_, i) => i);
const store = {
  'manifest.json': { body: new TextEncoder().encode('{"schema":1,"issues":[]}'), etag: 'm1' },
  'issues/002/meta.json': { body: new TextEncoder().encode('{}'), etag: 'j1' },
  'issues/002/issue-002-color.pdf': { body: PDF, etag: 'p1' },
  'issues/002/pages/p-01.webp': { body: new Uint8Array([1, 2, 3]), etag: 'w1' },
  'issues/002/pages/thumbs/p-01.webp': { body: new Uint8Array([1]), etag: 't1' },
};
const calls = [];
const bucket = {
  async head(k) { calls.push(['head', k]); const o = store[k]; return o && { size: o.body.length, httpEtag: `"${o.etag}"` }; },
  async get(k, opts) {
    calls.push(['get', k, opts]); const o = store[k]; if (!o) return null;
    let b = o.body; if (opts && opts.range) b = b.slice(opts.range.offset, opts.range.offset + opts.range.length);
    return { size: o.body.length, httpEtag: `"${o.etag}"`, body: new Blob([b]).stream(), httpMetadata: { contentType: 'text/html' } };
  },
};
const next = async () => new Response('nf', { status: 404, headers: { 'X-From': 'static' } });
const call = (path, init = {}, env = { ISSUES: bucket }) => serve({ request: new Request('https://x.test' + path, init), env, next });
const bytes = async (r) => new Uint8Array(await r.arrayBuffer());
const secured = (r) => { for (const [k, v] of Object.entries(SECURITY_HEADERS)) assert.equal(r.headers.get(k), v, k); };

await test('security headers equal public/_headers /*', () => {
  const block = readFileSync(join(root, 'public/_headers'), 'utf8').split('\n\n')[0].split('\n').filter((l) => /^\s+\S/.test(l));
  const want = Object.fromEntries(block.map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  assert.deepEqual(SECURITY_HEADERS, want);
});

await test('cache headers equal public/_headers (numbered files immutable, meta/manifest 60s)', async () => {
  assert.equal((await call('/issues/002/pages/p-01.webp')).headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
  assert.equal((await call('/issues/002/pages/thumbs/p-01.webp')).headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
  assert.equal((await call('/issues/002/issue-002-color.pdf')).headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
  assert.equal((await call('/issues/002/meta.json')).headers.get('Cache-Control'), 'public, max-age=60');
  assert.equal((await call('/manifest.json')).headers.get('Cache-Control'), 'public, max-age=60');
});

await test('200 per type: content-type from extension, not stored metadata; headers', async () => {
  let r = await call('/issues/002/pages/p-01.webp');
  assert.equal(r.status, 200); assert.equal(r.headers.get('Content-Type'), 'image/webp'); secured(r);
  assert.deepEqual([...await bytes(r)], [1, 2, 3]); assert.equal(r.headers.get('ETag'), '"w1"');
  r = await call('/issues/002/issue-002-color.pdf');
  assert.equal(r.headers.get('Content-Type'), 'application/pdf');
  assert.equal(r.headers.get('Content-Disposition'), 'inline; filename="issue-002-color.pdf"');
  assert.equal(r.headers.get('Accept-Ranges'), 'bytes'); assert.equal(r.headers.get('Content-Length'), '100'); secured(r);
  r = await call('/manifest.json'); assert.equal(r.headers.get('Content-Type'), 'application/json'); assert.equal(await r.text(), '{"schema":1,"issues":[]}');
  assert.equal((await call('/issues/002/meta.json')).headers.get('Content-Type'), 'application/json');
});

await test('route handlers are wired (issues catch-all and /manifest.json)', async () => {
  const ctx = (p) => ({ request: new Request('https://x.test' + p), env: { ISSUES: bucket }, next });
  assert.equal((await issues.onRequest(ctx('/issues/002/meta.json'))).status, 200);
  assert.equal((await manifestFn.onRequest(ctx('/manifest.json'))).status, 200);
});

await test('304 with If-None-Match (strong, weak, list, *), headers kept', async () => {
  for (const v of ['"p1"', 'W/"p1"', '"x", "p1"', '*']) {
    const r = await call('/issues/002/issue-002-color.pdf', { headers: { 'If-None-Match': v } });
    assert.equal(r.status, 304, v); secured(r); assert.equal(r.headers.get('ETag'), '"p1"'); assert.equal((await bytes(r)).length, 0);
  }
  assert.equal((await call('/issues/002/issue-002-color.pdf', { headers: { 'If-None-Match': '"other"' } })).status, 200);
});

await test('HEAD returns headers, no body, no object read', async () => {
  calls.length = 0;
  const r = await call('/issues/002/issue-002-color.pdf', { method: 'HEAD' });
  assert.equal(r.status, 200); assert.equal(r.headers.get('Content-Length'), '100'); assert.equal((await bytes(r)).length, 0); secured(r);
  assert.deepEqual(calls.map((c) => c[0]), ['head']);
});

await test('Range: 206 first/open/suffix, 416, ignored when malformed or multi, If-Range', async () => {
  let r = await call('/issues/002/issue-002-color.pdf', { headers: { Range: 'bytes=10-19' } });
  assert.equal(r.status, 206); assert.equal(r.headers.get('Content-Range'), 'bytes 10-19/100'); assert.equal(r.headers.get('Content-Length'), '10');
  assert.deepEqual([...await bytes(r)], [...PDF.slice(10, 20)]); secured(r); assert.equal(r.headers.get('Content-Type'), 'application/pdf');
  r = await call('/issues/002/issue-002-color.pdf', { headers: { Range: 'bytes=90-' } });
  assert.equal(r.headers.get('Content-Range'), 'bytes 90-99/100');
  r = await call('/issues/002/issue-002-color.pdf', { headers: { Range: 'bytes=-5' } });
  assert.equal(r.headers.get('Content-Range'), 'bytes 95-99/100');
  r = await call('/issues/002/issue-002-color.pdf', { headers: { Range: 'bytes=90-500' } });
  assert.equal(r.headers.get('Content-Range'), 'bytes 90-99/100');
  r = await call('/issues/002/issue-002-color.pdf', { headers: { Range: 'bytes=100-200' } });
  assert.equal(r.status, 416); assert.equal(r.headers.get('Content-Range'), 'bytes */100'); secured(r); assert.equal(r.headers.get('Cache-Control'), 'no-store');
  for (const bad of ['bytes=0-1,5-6', 'items=1-2', 'bytes=abc', 'bytes=9-2']) {
    r = await call('/issues/002/issue-002-color.pdf', { headers: { Range: bad } });
    assert.equal(r.status, 200, bad); assert.equal((await bytes(r)).length, 100);
  }
  r = await call('/issues/002/issue-002-color.pdf', { headers: { Range: 'bytes=0-1', 'If-Range': '"stale"' } });
  assert.equal(r.status, 200);
  r = await call('/issues/002/pages/p-01.webp', { headers: { Range: 'bytes=0-1' } }); // range only for PDFs
  assert.equal(r.status, 200);
  assert.equal(parseRange('bytes=-0', 10), 'bad');
});

await test('404 for missing allowed paths: static 404 + security headers + no-store, no bucket/error text', async () => {
  for (const p of ['/issues/009/meta.json', '/issues/002/other.pdf', '/issues/002/pages/p-09.webp']) {
    const r = await call(p); assert.equal(r.status, 404); secured(r); assert.equal(r.headers.get('Cache-Control'), 'no-store');
    assert.equal(await r.text(), 'nf'); assert.equal(r.headers.get('X-From'), 'static');
  }
  const r = await call('/manifest.json', {}, { ISSUES: { head: async () => null, get: async () => null } });
  assert.equal(r.status, 404); secured(r);
});

await test('binding missing or R2 throwing: generic 404, nothing leaked', async () => {
  let r = await call('/manifest.json', {}, {}); assert.equal(r.status, 404); secured(r);
  r = await call('/manifest.json', {}, { ISSUES: { get: async () => { throw new Error('weekend-bookmark-issues SECRET boom'); } } });
  assert.equal(r.status, 404); const t = await r.text(); assert.ok(!/weekend-bookmark|SECRET|boom/.test(t + JSON.stringify([...r.headers])));
});

await test('methods: only GET/HEAD', async () => {
  for (const m of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
    const r = await call('/issues/002/meta.json', { method: m, body: ['POST', 'PUT', 'PATCH'].includes(m) ? 'x' : undefined });
    assert.equal(r.status, 405, m); assert.equal(r.headers.get('Allow'), 'GET, HEAD'); secured(r);
  }
});

await test('query strings are rejected (404)', async () => {
  for (const q of ['?', '?x=1', '?../../manifest.json', '?download=1']) {
    const r = await call('/issues/002/meta.json' + q); assert.equal(r.status, 404, q); secured(r);
  }
  assert.equal((await call('/manifest.json?v=2')).status, 404);
});

await test('allowlist: accepted paths', () => {
  for (const p of ['/manifest.json', '/issues/001/meta.json', '/issues/002/issue-002-color.pdf', '/issues/002/issue-002-grayscale.pdf', '/issues/123/pages/p-16.webp', '/issues/123/pages/p-100.webp', '/issues/123/pages/thumbs/p-01.webp']) assert.ok(route(p), p);
  assert.equal(route('/manifest.json').key, 'manifest.json'); assert.equal(route('/issues/002/meta.json').key, 'issues/002/meta.json');
});

await test('allowlist: per-build content-hash image names (Issue 003 p-10 incident)', async () => {
  const ok = ['/issues/003/pages/p-10.0123456789ab.webp', '/issues/003/pages/thumbs/p-10.0123456789ab.webp', '/issues/123/pages/p-100.ffffffffffff.webp'];
  for (const p of ok) { const r = route(p); assert.ok(r, p); assert.equal(r.key, p.slice(1)); assert.equal(r.type, 'image/webp'); assert.equal(r.cache, 'public, max-age=31536000, immutable'); }
  const bad = ['/issues/003/pages/p-10.0123456789AB.webp', '/issues/003/pages/p-10.0123456789a.webp', '/issues/003/pages/p-10.0123456789abc.webp',
    '/issues/003/pages/p-10..webp', '/issues/003/pages/p-10.webp.webp', '/issues/003/pages/p-10.0123456789ab.0123456789ab.webp', '/issues/003/pages/p-1.0123456789ab.webp',
    '/issues/003/pages/p-00.0123456789ab.webp', '/issues/003/pages/p-10.0123456789ag.webp', '/issues/003/pages/p-10-0123456789ab.webp', '/issues/003/pages/p-10.0123456789ab.png',
    '/issues/003/pages/thumbs/p-10.0123456789ab.webp/', '/issues/003/p-10.0123456789ab.webp'];
  for (const p of bad) assert.equal(route(p), null, p);
  store['issues/002/pages/p-01.0123456789ab.webp'] = { body: new Uint8Array([9, 9]), etag: 'h1' };
  const r = await call('/issues/002/pages/p-01.0123456789ab.webp');
  assert.equal(r.status, 200); assert.equal(r.headers.get('Content-Type'), 'image/webp'); secured(r); assert.deepEqual(await bytes(r), new Uint8Array([9, 9]));
});

await test('PDF name limit is 80 like validate_issue.py and the audit (Codex #4)', () => {
  assert.ok(route('/issues/002/' + 'a'.repeat(80) + '.pdf')); assert.equal(route('/issues/002/' + 'a'.repeat(81) + '.pdf'), null);
});

await test('allowlist: rejected and traversal paths', () => {
  const bad = [
    '/issues/002/../manifest.json', '/issues/../manifest.json', '/issues/002/%2e%2e/manifest.json', '/issues/002/%2E%2E/meta.json', '/issues/002/.%2e/meta.json',
    '/issues//002/meta.json', '/issues/002//meta.json', '//manifest.json', '/issues/002/pages//p-01.webp',
    '/issues/002%2fmeta.json', '/issues%2f002/meta.json', '/issues/002/pages%2fp-01.webp', '/issues/002\\meta.json', '/issues/002/pages\\p-01.webp', '/issues/002/meta.json%00',
    '/issues/000/meta.json', '/issues/2/meta.json', '/issues/0002/meta.json', '/issues/abc/meta.json', '/issues/002/meta.json/', '/issues/002/meta.JSON', '/issues/002/Meta.json',
    '/issues/002/Issue.pdf', '/issues/002/a_b.pdf', '/issues/002/a b.pdf', '/issues/002/a.pdf.exe', '/issues/002/.pdf', '/issues/002/sub/a.pdf', '/issues/002/a.PDF',
    '/issues/002/pages/p-00.webp', '/issues/002/pages/p-1.webp', '/issues/002/pages/p-01.png', '/issues/002/pages/p-01.WEBP', '/issues/002/pages/thumbs/thumbs/p-01.webp', '/issues/002/pages/q-01.webp',
    '/issues/manifest.json', '/issues/', '/issues', '/issues/002/', '/issues/002/notes.txt', '/issues/002/.hidden', '/manifest.json/', '/Manifest.json', '/manifest.json.bak', '/data/x.json', '/', '',
    '/issues/002/meta.json\n', '/issues/002/meta.json ', ' /issues/002/meta.json',
  ];
  for (const p of bad) assert.equal(route(p), null, JSON.stringify(p));
});

await test('traversal through the full handler never reaches R2', async () => {
  calls.length = 0;
  for (const p of ['/issues/002/%2e%2e/%2e%2e/etc', '/issues/002%2f..%2fmanifest.json', '/issues//002/meta.json', '/issues/002/pages/..%2f..%2fmeta.json', '/issues/002/pages/%2e%2e/p-01.webp']) {
    const r = await call(p); assert.equal(r.status, 404, p); secured(r);
  }
  assert.deepEqual(calls, []);
});

await test('functions source is read-only (no write verbs) and holds no secrets', () => {
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); } };
  walk(join(root, 'functions'));
  assert.ok(files.length >= 3);
  for (const f of files) {
    const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/ .*$/gm, '');
    assert.ok(!/\b(put|delete|createMultipartUpload|resumeMultipartUpload|list)\b\s*\(/i.test(src), f + ' uses a write/list verb');
    assert.ok(!/\b(put|delete|multipart)/i.test(src.replace(/Accept-Ranges/g, '')), f + ' mentions a write verb');
    assert.ok(!/AKIA|secret|r2\.cloudflarestorage|api[_-]?token|R2_ACCESS/i.test(src), f + ' looks like it holds a secret');
    for (const m of src.matchAll(/env\.(\w+)/g)) assert.ok(['ISSUES', 'PLAUSIBLE_DOMAIN', 'PLAUSIBLE_API_HOST'].includes(m[1]), `${f} reads env.${m[1]}`);
  }
  const used = new Set(); for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/(?:bucket|ISSUES)\.(\w+)\(/g)) used.add(m[1]);
  assert.deepEqual([...used].sort(), ['get', 'head']);
});

console.log(`${n} node tests passed`);
