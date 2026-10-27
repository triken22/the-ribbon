// Plain-node tests for public/js/data.js image URLs (per-build content-hash names with legacy fallback). Run: node site/scripts/test_data_js.mjs
import assert from 'node:assert/strict';
const H = 'pages/p-%s.0123456789ab.webp', T = 'pages/thumbs/p-%s.abcdefabcdef.webp';
const pages = Array.from({length: 16}, (_, k) => H.replace('%s', String(k + 1).padStart(2, '0')));
const thumbs = Array.from({length: 16}, (_, k) => T.replace('%s', String(k + 1).padStart(2, '0')));
const docs = {
  '/manifest.json': { schema: 1, issues: [{ issue: 3, title: 'x', date: '2026-10-24', pages: 16, cover_image: pages[0], cover_thumb: thumbs[0] }, { issue: 2, title: 'y', date: '2026-10-17', pages: 16, cover_image: 'pages/p-01.webp' }, { issue: 4, title: 'z', date: '2026-10-31', pages: 16, cover_image: 'javascript:x', cover_thumb: '../x.webp' }] },
  '/issues/003/meta.json': { issue: 3, pages: 16, cover_image: pages[0], files: { pages, thumbs, pages_dir: 'pages/' } },
  '/issues/002/meta.json': { issue: 2, pages: 16, cover_image: 'pages/p-01.webp', files: { pages_dir: 'pages/' } },
  '/issues/004/meta.json': { issue: 4, pages: 16, files: { pages: [...pages].reverse(), thumbs, pages_dir: 'pages/' } },
};
globalThis.fetch = async (u) => ({ ok: !!docs[u], status: docs[u] ? 200 : 404, json: async () => docs[u] });
const d = await import(new URL('../public/js/data.js', import.meta.url));
const c = await d.init();
const [i4, i3, i2] = c.issues;
assert.equal(d.coverThumb(i3), thumbs[0]); assert.equal(d.coverThumb(i2), 'pages/thumbs/p-01.webp');
assert.equal(i4.cover_image, ''); assert.equal(i4.cover_thumb, '');
const m3 = await d.loadMeta(c, 3), m2 = await d.loadMeta(c, 2), m4 = await d.loadMeta(c, 4);
assert.equal(d.pageSrc(c, m3, 10, false), '/issues/003/' + pages[9]); assert.equal(d.pageSrc(c, m3, 10, true), '/issues/003/' + thumbs[9]);
assert.equal(d.pageSrc(c, m2, 10, false), '/issues/002/pages/p-10.webp'); assert.equal(d.pageSrc(c, m2, 10, true), '/issues/002/pages/thumbs/p-10.webp');
assert.equal(d.pageSrc(c, m4, 10, false), '/issues/004/pages/p-10.webp'); // misordered list is dropped -> legacy fallback
assert.equal(c.failed, false);

// init(): only a failed request (network error or 5xx) sets `failed`; a missing or malformed manifest is the calm empty state.
for (const [mode, want] of [['network', true], ['500', true], ['404', false], ['malformed', false]]) {
  globalThis.fetch = async () => {
    if (mode === 'network') throw new TypeError('fetch failed');
    if (mode === 'malformed') return { ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } };
    return { ok: false, status: +mode, json: async () => ({}) };
  };
  const dm = await import(new URL('../public/js/data.js?' + mode, import.meta.url)); // fresh module: init() caches its context
  const cm = await dm.init();
  assert.equal(cm.failed, want, mode); assert.deepEqual(cm.issues, [], mode);
}
console.log('frontend ok');
