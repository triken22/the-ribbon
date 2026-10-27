// UI checks with Chromium (playwright-core). Usage: PW_DIR=/path/with/node_modules node site/scripts/ui_check.mjs
// Starts scripts/dev_server.py --fixtures itself. Not part of the production build.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const require = createRequire((process.env.PW_DIR || process.cwd()) + '/');
const { chromium } = require('playwright-core');
const here = path.dirname(fileURLToPath(import.meta.url));
const FIXT = path.join(here, '..', 'dev-fixtures');
import net from 'node:net';
const PORT = await new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const B = `http://127.0.0.1:${PORT}`;
const srv = spawn('python3', [path.join(here, 'dev_server.py'), '--fixtures', '--port', String(PORT)], { stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 800));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const exe = process.env.CHROME_PATH || undefined;
const browser = await chromium.launch({ executablePath: exe });
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
const pad = (n) => String(n).padStart(3, '0');

// Every visible link, button and field must offer a 44x44 hit area (an absolutely positioned ::after counts). The skip link is off-screen until focused.
const smallTargets = (pg) => pg.evaluate(() => {
  const bad = [];
  for (const e of document.querySelectorAll('a[href], button, input, select, textarea')) {
    if (e.matches('.skip')) continue;
    const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    if (!r.width || !r.height || cs.visibility === 'hidden') continue;
    let w = r.width, h = r.height; const a = getComputedStyle(e, '::after');
    if (a.content !== 'none' && a.position === 'absolute') { w = Math.max(w, parseFloat(a.width) || 0); h = Math.max(h, parseFloat(a.height) || 0); }
    if (w < 43.5 || h < 43.5) bad.push(`${e.tagName.toLowerCase()}.${e.className} "${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 30)}" ${Math.round(w)}x${Math.round(h)}`);
  }
  return bad;
});
// User-facing text says "Greyscale" (British, like "colour"). Literal file names (code elements, hrefs) keep their data spelling.
const grayText = (pg) => pg.evaluate(() => {
  const b = document.body.cloneNode(true); b.querySelectorAll('code, script, style').forEach((x) => x.remove());
  const attrs = [...document.querySelectorAll('[aria-label], [title], img[alt]')].map((e) => [e.getAttribute('aria-label'), e.getAttribute('title'), e.getAttribute('alt')].join(' '));
  return [b.textContent, document.title, ...attrs].join(' ').match(/gray(scale)?\b/gi) || [];
});
// Records every animation and transition that moves something (transform / translate / scale / rotate keyframes), and the fades.
const watchMotion = () => {
  window.__moves = []; window.__fades = [];
  const seen = new WeakSet();
  const poll = () => {
    for (const a of document.getAnimations()) {
      if (seen.has(a)) continue; seen.add(a);
      try {
        const ks = a.effect.getKeyframes(), who = `${a.constructor.name} ${a.effect.target && a.effect.target.className} ${a.effect.pseudoElement || ''}`;
        if (ks.some((f) => ['transform', 'translate', 'scale', 'rotate'].some((p) => p in f))) window.__moves.push(who); else if (ks.some((f) => 'opacity' in f)) window.__fades.push(who);
      } catch (e) { /* effect gone */ }
    }
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
};

try {
  // ---- 1. issue page hover card at several scroll positions
  for (const [vh, ys] of [[1400, [0]], [900, [1000, 1400]]]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: vh } }), pg = await ctx.newPage();
    await pg.goto(`${B}/issue/?n=2`); await pg.waitForSelector('.toc .src a'); await pg.waitForTimeout(900);
    const total = await pg.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    console.log('issue page scrollable height', total);
    for (const y of ys) {
      const info = await pg.evaluate(async (y) => {
        const chips = [...document.querySelectorAll('.toc .src > a')];
        // pick the chip nearest the middle of the viewport after scrolling to y
        scrollTo(0, y); await new Promise((r) => setTimeout(r, 150));
        const a = chips.map((c) => ({ c, r: c.getBoundingClientRect() })).filter((o) => o.r.top > 60 && o.r.bottom < innerHeight - 20)[0];
        return a ? { idx: chips.indexOf(a.c), sy: scrollY } : null;
      }, y);
      if (!info) { console.log(`SKIP scrollY=${y}: no chip in viewport`); continue; }
      const chip = pg.locator('.toc .src > a').nth(info.idx);
      await chip.hover(); await pg.waitForTimeout(150);
      const m = await chip.evaluate((a) => { const c = a.parentElement.querySelector('.src-card'), r = a.getBoundingClientRect(), k = c.getBoundingClientRect();
        return { sy: scrollY, chipTop: r.top, chipBottom: r.bottom, cardTop: k.top, cardBottom: k.bottom, vis: getComputedStyle(c).display !== 'none', ih: innerHeight }; });
      const gap = m.cardTop >= m.chipBottom ? m.cardTop - m.chipBottom : m.chipTop - m.cardBottom;
      console.log(`  scrollY=${m.sy} chip y=${m.chipTop.toFixed(0)}-${m.chipBottom.toFixed(0)} card y=${m.cardTop.toFixed(0)}-${m.cardBottom.toFixed(0)} gap=${gap.toFixed(1)} viewport h=${m.ih}`);
      ok(m.vis && gap >= 0 && gap <= 12 && m.cardTop >= 0 && m.cardBottom <= m.ih, `issue hover card adjacent + on screen at scrollY=${m.sy}`);
      await pg.mouse.move(5, 5);
    }
    await ctx.close();
  }
  // ---- 2. desktop reader: source chip reachable with thumbnails visible; turns animate from the pointer, never from the keyboard
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }), pg = await ctx.newPage();
    await pg.goto(`${B}/read/?n=2&p=4`); await pg.waitForSelector('.srcbar .src a'); await pg.waitForTimeout(900);
    const hasThumbs = await pg.locator('.thumbs').isVisible();
    const chip = pg.locator('.srcbar .src > a').first(), bb = await chip.boundingBox();
    const top = await pg.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return e ? (e.closest('.src > a') ? 'chip' : e.className || e.tagName) : null; }, { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 });
    console.log(`  thumbs visible=${hasThumbs} chip box=${bb.x.toFixed(0)},${bb.y.toFixed(0)} ${bb.width.toFixed(0)}x${bb.height.toFixed(0)} elementFromPoint=${top}`);
    ok(hasThumbs && top === 'chip', 'reader chip is the topmost element at its centre (thumbnails visible)');
    await chip.hover(); await pg.waitForTimeout(150);
    const vis = await chip.evaluate((a) => getComputedStyle(a.parentElement.querySelector('.src-card')).display !== 'none');
    ok(vis, 'reader hover card opens on hover');
    const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 3000 }).catch(() => null), chip.click({ trial: false })]);
    ok(!!popup, 'click opens the post in a new tab'); if (popup) await popup.close().catch(() => {});
    const where = () => pg.locator('.where b').textContent();
    await pg.goto(`${B}/read/?n=2&p=2`); await pg.waitForSelector('.half img'); await pg.waitForTimeout(300);
    await pg.focus('#rd'); await pg.keyboard.press('ArrowRight');
    const keyTurn = await pg.evaluate(() => ({ leaf: !!document.querySelector('.leaf'), where: document.querySelector('.where b').textContent }));
    ok(!keyTurn.leaf && keyTurn.where === 'Pages 4–5', `keyboard turn is instant (no leaf), lands on ${keyTurn.where}`);
    await pg.click('.turn.next');
    const ptrTurn = await pg.evaluate(() => !!document.querySelector('.leaf'));
    await pg.click('.turn.next'); await pg.waitForTimeout(700); // a second click mid-turn is never swallowed
    ok(ptrTurn && (await where()) === 'Pages 8–9' && !(await pg.locator('.leaf').count()), 'pointer turn animates (leaf), a click mid-turn still turns, and the leaf is gone after');
    await pg.click('.dlbtn'); await pg.waitForSelector('.dlpop');
    ok((await grayText(pg)).length === 0, 'reader (download open): no "Grayscale" in user-facing text');
    await ctx.close();
  }
  // ---- 3. touch targets: every link, button and field on every page is at least 44x44 on a phone
  {
    const ctx = await browser.newContext(PHONE), pg = await ctx.newPage();
    const pages = [['home', '/', '.pager.is-ready'], ['subscribe', '/subscribe/', '.step h1'], ['library', '/library/', '.card'], ['issue', '/issue/?n=2', '.toc .src a'], ['404', '/nope/x', '.lead-state'], ['reader', '/read/?n=2&p=4', '.mpage img']];
    for (const [name, url, sel] of pages) {
      await pg.goto(B + url); await pg.waitForSelector(sel); await pg.waitForTimeout(400);
      const bad = await smallTargets(pg); if (bad.length) console.log('  ', bad);
      ok(!bad.length, `${name}: every target >= 44x44 at 390`);
      const ov = await pg.evaluate(() => document.documentElement.scrollWidth - innerWidth); ok(ov <= 0, `no horizontal overflow on ${name} at 390`);
    }
    await pg.goto(`${B}/library/`); await pg.waitForSelector('#ftoggle'); await pg.click('#ftoggle'); await pg.waitForSelector('.filters.open .chip', { state: 'visible' });
    await pg.click('#view button[data-v=list]'); await pg.waitForSelector('.lrow');
    { const bad = await smallTargets(pg); if (bad.length) console.log('  ', bad); ok(!bad.length, 'library (filters open, list view): every target >= 44x44'); }
    { const ov = await pg.evaluate(() => document.documentElement.scrollWidth - innerWidth); ok(ov <= 0, 'no horizontal overflow on library (filters open) at 390'); }
    await pg.goto(`${B}/read/?n=2&p=4`); await pg.waitForSelector('.mpage img'); await pg.click('.mhd .ib[aria-label=Download]'); await pg.waitForSelector('.sheet .dlrow');
    { const bad = await smallTargets(pg); if (bad.length) console.log('  ', bad); ok(!bad.length, 'reader download sheet: every target >= 44x44'); }
    ok((await grayText(pg)).length === 0, 'reader download sheet: no "Grayscale" in user-facing text');
    await ctx.close();
  }
  // ---- 3a. home, phone: in every copy variant the hero, sub, issue line, book, pager, CTA and the "Free." line sit on the first screen
  for (const v of ['A', 'B', 'C', 'D']) {
    const ctx = await browser.newContext(PHONE), pg = await ctx.newPage();
    await pg.goto(`${B}/?v=${v}`); await pg.waitForSelector('.pager.is-ready');
    const f = await pg.evaluate(() => ({ free: Math.round(document.querySelector('.lead__free').getBoundingClientRect().bottom), cta: Math.round(document.querySelector('.lead__actions .pill').getBoundingClientRect().bottom), ab: document.documentElement.dataset.ab }));
    ok(f.ab === v && f.cta <= 844 && f.free <= 844, `home ${v}: CTA (${f.cta}px) and "Free." line (${f.free}px) above the fold at 390x844`);
    await ctx.close();
  }
  // ---- 3b. home page: structure, the pitch, real links, the cover from manifest.json, and every data state
  const man = await (await fetch(`${B}/manifest.json`)).json();
  const L = man.issues[0], meta = await (await fetch(`${B}/issues/${pad(L.issue)}/meta.json`)).json();
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), pg = await ctx.newPage();
    await pg.goto(`${B}/?v=A`); await pg.waitForSelector('.pager.is-ready'); await pg.waitForSelector('[data-issue-links].is-ready');
    await pg.waitForFunction(() => { const i = document.querySelector('.book .leaf img'); return i && i.complete; });
    const h = await pg.evaluate(() => {
      const img = document.querySelector('.book .leaf img');
      return { h1: document.querySelectorAll('h1').length, hero: document.querySelector('h1').textContent, line: document.querySelector('[data-issue-line]').textContent,
        img: img && [img.getAttribute('width'), img.getAttribute('height'), img.getAttribute('fetchpriority'), img.loading, img.alt, img.complete && img.naturalWidth > 0],
        links: [...document.querySelectorAll('[data-issue-links] a')].map((a) => [a.textContent, a.getAttribute('href')]),
        cta: [...document.querySelectorAll('[data-track^=cta_click]')].map((a) => a.getAttribute('href')),
        bmc: document.querySelector('.foot__support a')?.getAttribute('href') ?? null,
        hrefs: [...new Set([...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((u) => u.startsWith('/')))] };
    });
    console.log('  home', JSON.stringify(h));
    ok(h.h1 === 1 && h.hero === 'Stay current on tech. Skip the scroll.', 'home has exactly one h1, the pain-led hero (variant A)');
    ok(h.line.startsWith(`Issue ${L.issue} · `) && h.line.includes('2026'), `home issue line names the latest issue and its date (${h.line})`);
    ok(h.img && h.img[0] === '1200' && h.img[1] === '1697' && h.img[2] === 'high' && h.img[3] === 'eager' && h.img[4].includes(meta.cover_headline) && h.img[5], 'home cover: width/height, fetchpriority=high, eager, alt with the cover headline, loaded');
    const dir = `/issues/${pad(L.issue)}/`;
    ok(h.links.length === 2 && h.links[0][1] === `/read/?n=${L.issue}` && h.links[1][1] === dir + meta.files.pdf_color, 'home "Read online" and "PDF" link the latest issue from meta.json');
    ok(h.cta.length === 2 && h.cta.every((u) => u === '/subscribe/'), 'both CTAs go to /subscribe/');
    ok(h.bmc === null || (h.bmc.startsWith('https://buymeacoffee.com/') && !h.bmc.includes('YOUR_BMC')), 'footer: no placeholder Buy me a coffee link');
    ok((await grayText(pg)).length === 0, 'home: no "Grayscale" in user-facing text');
    for (const u of h.hrefs) { const r = await fetch(B + u, { method: 'HEAD' }); ok(r.status === 200, `home link resolves: ${u} -> ${r.status}`); }
    // the book: no turn buttons; it opens into a two-page spread; keyboard turns are instant; End reaches the back cover
    ok(!(await pg.locator('.turn-btn, [data-prev], [data-next]').count()), 'home book: no arrow buttons, the pages turn by hand');
    await pg.focus('[data-book]'); await pg.keyboard.press('ArrowRight');
    const k1 = await pg.evaluate(() => ({ cap: document.querySelector('[data-caption]').textContent, turning: document.querySelector('.book').classList.contains('is-turning'),
      shown: [...document.querySelectorAll('.leaf.is-shown')].map((l) => [l.getAttribute('aria-label'), Math.round(l.getBoundingClientRect().left)]) }));
    ok(!k1.turning && k1.cap.includes(`2–3 / ${meta.pages}`) && k1.shown.length === 2 && k1.shown[0][1] < k1.shown[1][1], `keyboard turn is instant and opens the spread, pages 2 and 3 side by side (${k1.cap})`);
    await pg.keyboard.press('End');
    ok((await pg.locator('[data-caption]').textContent()).includes(String(meta.pages)) && await pg.locator('.leaf--back a').isVisible(), 'End reaches the last spread, the back cover facing the last page, which links the reader');
    await pg.keyboard.press('Home');
    ok((await pg.locator('[data-caption]').textContent()) === 'Cover' && (await pg.locator('.leaf.is-shown').count()) === 1, 'Home closes the issue on its cover');
    await ctx.close();
    // states, each in a fresh context with the data routed
    const state = async (name, routes, sel, test) => {
      const c2 = await browser.newContext({ viewport: { width: 390, height: 844 } }), p2 = await c2.newPage();
      for (const [pat, fn] of routes) await p2.route(pat, fn);
      await p2.goto(`${B}/`); await p2.waitForSelector(sel, { timeout: 7000 }).catch(() => {});
      const ov2 = await p2.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      ok((await test(p2)) && ov2 <= 0, `home state: ${name}`); await c2.close();
    };
    await state('no manifest (404) is a calm empty state; the pitch and CTA stay', [['**/manifest.json', (r) => r.fulfill({ status: 404, body: 'nope' })]], '.book__state', async (p) =>
      (await p.locator('.book__state .display').textContent()) === 'No issues yet.' && await p.locator('.pager').evaluate((e) => getComputedStyle(e).visibility === 'hidden') && await p.locator('.lead__actions .pill').isVisible() && !(await p.locator('[data-issue-links]').count()));
    await state('manifest fetch failed offers Try again', [['**/manifest.json', (r) => r.abort('failed')]], '.book__state button', async (p) =>
      (await p.locator('.book__state .display').textContent()).includes('didn’t load') && await p.locator('.book__state button').isVisible());
    await state('meta fetch failed: the cover stays, the pager waits, Read online still works', [['**/meta.json', (r) => r.abort('failed')]], '[data-issue-links].is-ready', async (p) => {
      const t = await p.evaluate(() => ({ img: !!document.querySelector('.book .leaf img'), pager: getComputedStyle(document.querySelector('.pager')).visibility, links: [...document.querySelectorAll('[data-issue-links] a')].map((a) => a.textContent) }));
      return t.img && t.pager === 'hidden' && t.links.join() === 'Read online'; });
    await state('a page image that 404s leaves a numbered sheet', [['**/pages/p-02.webp', (r) => r.fulfill({ status: 404, body: '' })], ['**/pages/thumbs/p-02.webp', (r) => r.fulfill({ status: 404, body: '' })]], '.pager.is-ready', async (p) => {
      await p.focus('[data-book]'); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(700);
      return (await p.locator('.leaf.is-missing .leaf__missing').first().textContent()) === 'Page 2'; });
  }
  // ---- 3b2. the copy test: sticky 50/50 assignment, ?v= override, QA switcher only on request, events
  {
    const seen = new Set();
    for (let k = 0; k < 12 && seen.size < 2; k++) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), pg = await ctx.newPage();
      await pg.goto(`${B}/`); await pg.waitForSelector('.pager.is-ready');
      const a = await pg.evaluate(() => ({ v: window.__wbAb.variant, src: window.__wbAb.source, stored: localStorage.getItem('wb_ab') }));
      await pg.reload(); await pg.waitForSelector('.pager.is-ready');
      const b = await pg.evaluate(() => ({ v: window.__wbAb.variant, src: window.__wbAb.source, h1: document.querySelector('h1').textContent, pending: document.documentElement.hasAttribute('data-ab-pending'), qa: !!document.querySelector('.ab') }));
      ok(['A', 'B'].includes(a.v) && a.src === 'assigned' && a.stored === a.v && b.v === a.v && b.src === 'returning' && !b.pending && !b.qa, `new visitor assigned ${a.v}, kept on reload, no QA switcher, copy applied (${b.h1})`);
      seen.add(a.v); await ctx.close();
    }
    ok(seen.size === 2, `assignment reaches both arms (${[...seen].join(', ')})`);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), pg = await ctx.newPage();
    await pg.goto(`${B}/?v=c`); await pg.waitForSelector('.pager.is-ready');
    await pg.goto(`${B}/?v=Z`); await pg.waitForSelector('.pager.is-ready');
    const o = await pg.evaluate(() => ({ v: window.__wbAb.variant, src: window.__wbAb.source, h1: document.querySelector('h1').textContent, cta: document.querySelector('[data-ab-cta]').textContent }));
    ok(o.v === 'C' && o.src === 'override' && o.h1 === 'What people said. Not what media spun.', '?v=c overrides and sticks; an invalid ?v=Z is ignored');
    await pg.goto(`${B}/?v=D&ab=qa`); await pg.waitForSelector('.ab__toggle');
    await pg.click('.ab__toggle'); await pg.click('.ab__opt[data-v=B]');
    const q = await pg.evaluate(() => ({ v: window.__wbAb.variant, url: location.search, h1: document.querySelector('h1').textContent, views: window.__wbAb.views }));
    ok(q.v === 'B' && q.url.includes('v=B') && q.h1.startsWith('The week on') && q.views.D === 1 && q.views.B === 1, '?ab=qa shows the switcher; picking B swaps the copy, rewrites ?v= and logs a view');
    await pg.keyboard.press('Escape');
    await pg.click('.lead__actions .pill', { noWaitAfter: true }).catch(() => {}); await pg.waitForURL('**/subscribe/');
    const sub = await pg.evaluate(() => ({ v: window.__wbAb.variant, src: window.__wbAb.source, ev: window.__wbAb.events.length }));
    ok(sub.v === 'B' && sub.src === 'override' && sub.ev === 0 && !(await pg.locator('.ab').count()), 'subscribe page reads the stored variant for its events, logs no view and shows no switcher');
    await ctx.close();
  }
  // ---- 3b3. phone book: a swipe turns the cover, a short slow drag settles back, a corner drag curls the page (a fold
  // drawn with clip-path, the page's back showing), and the open spread keeps the facing page's edge on screen
  {
    const ctx = await browser.newContext(PHONE), pg = await ctx.newPage();
    await pg.goto(`${B}/`); await pg.waitForSelector('.pager.is-ready'); await pg.waitForTimeout(200);
    const box = await pg.locator('[data-book]').boundingBox(), cy = box.y + box.height / 2, cx = box.x + box.width * 0.7;
    const drag = async (dx, steps) => { await pg.mouse.move(cx, cy); await pg.mouse.down(); for (let k = 1; k <= steps; k++) await pg.mouse.move(cx + (dx * k) / steps, cy); await pg.mouse.up(); await pg.waitForTimeout(500); };
    await drag(-20, 25);
    const stay = !(await pg.locator('[data-caption]').textContent()).includes('/');
    await drag(-box.width * 0.8, 5);
    const cap = await pg.locator('[data-caption]').textContent();
    ok(stay && cap.includes('3 /'), `phone book: a short slow drag settles back, a swipe opens the issue (${cap})`);
    const sp = await pg.evaluate(() => [...document.querySelectorAll('.leaf.is-shown')].map((l) => { const r = l.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)]; }));
    ok(sp.length === 2 && sp[0][1] > 30 && sp[0][0] < 0 && sp[1][1] <= 390, `phone spread: the right-hand page whole, the left one's edge in view (${JSON.stringify(sp)})`);
    const bx = await pg.locator('[data-book]').boundingBox(), sx = await pg.evaluate(() => document.querySelector('[data-spread]').getBoundingClientRect().left);
    const cx2 = sx + bx.width - 4, cy2 = bx.y + bx.height - 4;
    await pg.mouse.move(cx2, cy2); await pg.mouse.down();
    for (let k = 1; k <= 8; k++) await pg.mouse.move(cx2 - k * 14, cy2 - k * 6);
    const curl = await pg.evaluate(() => { const o = [...document.querySelectorAll('.leaf.is-shown')].filter((l) => l.style.transform.startsWith('matrix')); return { turning: document.querySelector('.book').classList.contains('is-turning'), flap: o.length, clip: o[0] && o[0].style.clipPath }; });
    await pg.mouse.up(); await pg.waitForTimeout(600);
    ok(curl.turning && curl.flap === 1 && /polygon/.test(curl.clip), `phone book: a corner drag curls the page over, its back showing (${JSON.stringify(curl).slice(0, 80)})`);
    await ctx.close();
  }
  // ---- 3b4. /subscribe/: live by default (no notice; posts to /api/subscribe, double opt-in copy), validation, the four
  // steps, the honest "delivery off" kill switch, and the stubbed done state locally
  {
    const ctx = await browser.newContext(PHONE), pg = await ctx.newPage();
    const posted = [];
    await pg.route('**/api/subscribe', (r) => { posted.push({ method: r.request().method(), body: r.request().postDataJSON() }); return r.fulfill({ status: 202, contentType: 'application/json', body: '{"ok":true}' }); });
    await pg.goto(`${B}/subscribe/`); await pg.waitForSelector('#email');
    await pg.fill('#email', 'reader@example.com'); await pg.click('[data-step="1"] .pill'); await pg.fill('#kindle', 'reader_1'); await pg.click('[data-step="2"] .pill'); await pg.click('[data-step="3"] .pill');
    const s4 = await pg.evaluate(() => ({ notice: document.querySelector('[data-notice]').hidden, h: document.querySelector('#s4').textContent, p: document.querySelector('[data-send-text]').textContent, btn: document.querySelector('[data-send]').textContent }));
    await pg.click('[data-send]'); await pg.waitForSelector('[data-step="5"]:not([hidden])');
    const live = await pg.evaluate(() => ({ t: document.querySelector('[data-done-title]').textContent, btn: document.querySelector('[data-send]').textContent }));
    console.log('  live', JSON.stringify({ s4, live, posted }));
    ok(s4.notice && s4.p.includes('reader_1@kindle.com') && s4.p.includes('Confirm') && posted.length === 1 && posted[0].method === 'POST'
      && posted[0].body.email === 'reader@example.com' && posted[0].body.kindle === 'reader_1@kindle.com' && posted[0].body.variant
      && live.t.includes('Check your email') && live.btn === s4.btn, 'subscribe (live): no notice, one POST {email, kindle, variant} to /api/subscribe, done says check your email');
    await pg.goto(`${B}/subscribe/?delivery=off`); await pg.waitForSelector('[data-notice]:not([hidden])');
    await pg.fill('#email', 'nope'); await pg.click('[data-step="1"] .pill');
    ok(await pg.locator('#email-error').isVisible(), 'subscribe: a bad email shows its error');
    await pg.fill('#email', 'reader@example.com'); await pg.click('[data-step="1"] .pill');
    await pg.fill('#kindle', 'reader_1@kindle.com'); await pg.click('[data-step="2"] .pill');
    { const ov = await pg.evaluate(() => document.documentElement.scrollWidth - innerWidth); ok(ov <= 0, `subscribe step 3 (sender address): no horizontal overflow at 390 (${ov})`); }
    await pg.click('[data-step="3"] .pill');
    ok((await pg.locator('[data-kindle-full]').textContent()) === 'reader_1@kindle.com' && (await pg.locator('[data-count]').textContent()) === 'Step 4 of 4', 'subscribe: steps 1-3 lead to the test send with the Kindle address');
    { const bad = await smallTargets(pg); if (bad.length) console.log('  ', bad); ok(!bad.length, 'subscribe: every target >= 44x44'); }
    await pg.click('[data-send]'); await pg.waitForSelector('#send-error:not([hidden])');
    ok((await pg.locator('#send-error').textContent()).includes('nothing was sent') && await pg.locator('[data-step="4"]').isVisible(), 'subscribe: with delivery off, the send says so plainly and never claims success');
    await pg.goto(`${B}/subscribe/?delivery=stub`); await pg.waitForSelector('#email');
    await pg.fill('#email', 'reader@example.com'); await pg.click('[data-step="1"] .pill'); await pg.fill('#kindle', 'reader_1'); await pg.click('[data-step="2"] .pill'); await pg.click('[data-step="3"] .pill'); await pg.click('[data-send]');
    await pg.waitForSelector('[data-step="5"]:not([hidden])');
    const done = await pg.evaluate(() => ({ count: document.querySelector('[data-count]').textContent, ev: window.__wbAb.events.map((e) => e.event) }));
    ok(done.count === 'Done' && done.ev.includes('subscribe_done'), 'subscribe (local stub): the done step logs subscribe_done');
    for (const [q, title, href] of [['confirmed', 'You’re in. Check your Kindle.', '/'], ['stopped', 'Delivery stopped.', '/library/'], ['expired', 'That link has run out.', '/subscribe/']]) {
      await pg.goto(`${B}/subscribe/?${q}`); await pg.waitForSelector('[data-outcome]:not([hidden])');
      const o = await pg.evaluate(() => ({ t: document.querySelector('[data-outcome] h1').textContent, href: document.querySelector('[data-outcome-action]').getAttribute('href'), form: getComputedStyle(document.querySelector('[data-flow]')).display, bar: getComputedStyle(document.querySelector('.progress')).display, ev: window.__wbAb.events.map((e) => e.event) }));
      ok(o.t === title && o.href === href && o.form === 'none' && o.bar === 'none' && o.ev.includes(`subscribe_${q}`), `subscribe/?${q}: the email link's landing state replaces the steps`);
    }
    await ctx.close();
  }
  // ---- 3b5. Plausible end to end: the site served as https://theribbon.fyi with the production CSP header, /api/event
  // answered by the real Function (functions/api/event.js) with Plausible's upstream mocked. No CSP violation anywhere;
  // pageviews and the ab.js events go out same-origin and arrive upstream with the pinned domain and their props.
  {
    const { onRequest } = await import(new URL('../functions/api/event.js', import.meta.url));
    const { SECURITY_HEADERS } = await import(new URL('../functions/_lib/serve.js', import.meta.url));
    const upstream = [], browserHosts = new Set();
    const realFetch = globalThis.fetch;
    const ctx = await browser.newContext(PHONE);
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false }); // pa.js skips automation; this run is the exception
      window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    });
    await ctx.route('**/*', async (r) => {
      const u = new URL(r.request().url()); browserHosts.add(u.host);
      if (u.origin !== 'https://theribbon.fyi') return r.abort();
      if (u.pathname === '/api/event') {
        globalThis.fetch = async (url, init) => { upstream.push({ url, body: JSON.parse(init.body), ip: init.headers['X-Plausible-IP'], xff: init.headers['X-Forwarded-For'] }); return new Response('ok', { status: 202 }); };
        try {
          const req = r.request();
          const res = await onRequest({ request: new Request(u.href, { method: req.method(), headers: { ...req.headers(), 'CF-Connecting-IP': '203.0.113.9' }, body: req.postData() }), env: {} });
          return r.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() });
        } finally { globalThis.fetch = realFetch; }
      }
      const res = await realFetch(B + u.pathname + u.search);
      const headers = Object.fromEntries(res.headers); delete headers['content-length'];
      if (/text\/html/.test(headers['content-type'] || '')) Object.assign(headers, SECURITY_HEADERS);
      return r.fulfill({ status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) });
    });
    const pg = await ctx.newPage();
    const P = 'https://theribbon.fyi';
    const settle = () => pg.waitForTimeout(300);
    await pg.goto(`${P}/?v=B&utm_source=ui_check&secret=1`); await pg.waitForSelector('.pager.is-ready'); await settle();
    const home = await pg.evaluate(() => ({ pa: typeof window.plausible === 'function' && !!window.plausible.wb, ignored: window.__pa.ignored, csp: window.__csp }));
    await pg.click('[data-ab-cta]', { noWaitAfter: true }).catch(() => {}); await pg.waitForURL('**/subscribe/'); await pg.waitForSelector('#email'); await settle();
    await pg.fill('#email', 'reader@example.com'); await pg.click('[data-step="1"] .pill'); await settle();
    const subCsp = await pg.evaluate(() => window.__csp);
    const lists = [];
    for (const [url, sel] of [['/library/', '.card'], ['/issue/?n=2', '.toc'], ['/read/?n=2&p=3', '.mpage img'], ['/nope/x', '.lead-state']]) {
      await pg.goto(P + url); await pg.waitForSelector(sel); await settle(); lists.push(...await pg.evaluate(() => window.__csp));
    }
    const names = upstream.map((e) => `${e.body.name} ${new URL(e.body.url).pathname}`);
    console.log('  plausible upstream', JSON.stringify(names));
    const vv = upstream.find((e) => e.body.name === 'variant_view'), cta = upstream.find((e) => e.body.name === 'cta_click'), step = upstream.find((e) => e.body.name === 'subscribe_step');
    ok(home.pa && home.ignored === null && !home.csp.length && !subCsp.length && !lists.length, `pa.js loads on the production host with the production CSP and no violation (${[...home.csp, ...subCsp, ...lists].join('; ') || 'none'})`);
    ok([...browserHosts].every((h) => h === 'theribbon.fyi'), `the browser only ever talks to this origin (${[...browserHosts].join(', ')})`);
    ok(upstream.length && upstream.every((e) => e.url === 'https://stats.tristankennedy.art/api/event' && e.body.domain === 'theribbon.fyi' && e.ip === '203.0.113.9' && e.xff === '203.0.113.9'), 'every event reaches Plausible via the Function, domain pinned, visitor IP forwarded');
    ok(['pageview /', 'pageview /subscribe/', 'pageview /library/', 'pageview /issue/', 'pageview /read/', 'pageview /nope/x', '404 /nope/x'].every((x) => names.includes(x)), 'a pageview from every public page, and a 404 event from the 404 page');
    ok(vv && vv.body.props.variant === 'B' && vv.body.props.source === 'override' && vv.body.props.path === '/' && vv.body.url === `${P}/?utm_source=ui_check`, 'variant_view carries variant, source, path; only utm parameters leave with the URL');
    ok(cta && cta.body.props.variant === 'B' && step && step.body.props.step === 2 && step.body.props.path === '/subscribe/', 'cta_click and subscribe_step (with step) reach Plausible with their props');
    await ctx.close();
  }
  // ---- 3c. hero cover: sharp on high-density screens. srcset = per-build thumbnail (400w) + full page image (1200w) from meta.json,
  //      sizes set, width/height kept, fetchpriority only on the hero. The fixtures are legacy, so per-build names are routed in.
  {
    const dir = `/issues/${pad(L.issue)}/`, hash = (k, t) => (t ? 'abcdef' : '012345') + String(k).padStart(6, '0');
    const pages = Array.from({ length: meta.pages }, (_, k) => `pages/p-${String(k + 1).padStart(2, '0')}.${hash(k, false)}.webp`);
    const thumbs = Array.from({ length: meta.pages }, (_, k) => `pages/thumbs/p-${String(k + 1).padStart(2, '0')}.${hash(k, true)}.webp`);
    const meta2 = { ...meta, cover_image: pages[0], files: { ...meta.files, pages, thumbs } };
    const man2 = { ...man, issues: man.issues.map((i, k) => (k ? i : { ...i, cover_image: pages[0], cover_thumb: thumbs[0] })) };
    for (const [vp, dpr, url, want, sel] of [[{ width: 1280, height: 800 }, 2, '/', 'full', '.book .leaf img[fetchpriority]'], [{ width: 390, height: 844 }, 3, '/', 'full', '.book .leaf img[fetchpriority]'], [{ width: 1280, height: 800 }, 1, '/', 'thumb', '.book .leaf img[fetchpriority]'], [{ width: 1280, height: 800 }, 2, `/issue/?n=${L.issue}`, 'full', '.lead-cover img']]) {
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: dpr }), pg = await ctx.newPage();
      await pg.route('**/manifest.json', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(man2) }));
      await pg.route(`**${dir}meta.json`, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(meta2) }));
      await pg.route(/\/pages\/(thumbs\/)?p-(\d+)\.[0-9a-f]{12}\.webp$/, (r) => {
        const m = /\/pages\/(thumbs\/)?p-(\d+)\./.exec(r.request().url()), f = path.join(FIXT, 'issues', pad(L.issue), 'pages', m[1] || '', `p-${m[2]}.webp`);
        return fs.existsSync(f) ? r.fulfill({ path: f, contentType: 'image/webp' }) : r.fulfill({ status: 404, body: '' });
      });
      await pg.goto(B + url); await pg.waitForSelector(sel); await pg.waitForFunction((s) => { const i = document.querySelector(s); return i.complete && i.currentSrc; }, sel);
      const r = await pg.evaluate((s) => { const i = document.querySelector(s); return { srcset: i.getAttribute('srcset'), sizes: i.getAttribute('sizes'), cur: i.currentSrc, w: i.getAttribute('width'), h: i.getAttribute('height'), high: document.querySelectorAll('img[fetchpriority=high]').length, lazy: [...document.querySelectorAll('img')].filter((x) => x !== i).every((x) => x.loading === 'lazy') }; }, sel);
      const good = r.srcset === `${dir}${thumbs[0]} 400w, ${dir}${pages[0]} 1200w` && !!r.sizes && r.w === '1200' && r.h === '1697' && r.high === 1 && r.lazy && r.cur.endsWith(want === 'full' ? pages[0] : thumbs[0]);
      if (!good) console.log('  ', JSON.stringify(r));
      ok(good, `hero srcset (thumb 400w + meta.json page 1200w), sizes, one fetchpriority=high: ${url} at ${vp.width}px dpr ${dpr} loads the ${want} image`);
      await ctx.close();
    }
  }
  // ---- 3d. layout shift: the home page settles with CLS 0 on desktop and phone, with every response arriving late, in both arms
  for (const [name, opts] of [['1280', { viewport: { width: 1280, height: 800 } }], ['390', PHONE]]) {
    for (const v of ['A', 'B']) {
      const ctx = await browser.newContext(opts), pg = await ctx.newPage();
      await pg.addInitScript(() => { window.__cls = 0; window.__shifts = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; window.__shifts.push(e.sources.map((s) => s.node && (s.node.className || s.node.nodeName)).join(',') + ' ' + e.value.toFixed(4)); } }).observe({ type: 'layout-shift', buffered: true }); });
      const late = (ms) => async (r) => { await new Promise((s) => setTimeout(s, ms)); await r.continue(); };
      await pg.route('**/manifest.json', late(150)); await pg.route('**/meta.json', late(450)); await pg.route('**/*.webp', late(300)); await pg.route('**/*.woff2', late(120));
      await pg.goto(`${B}/?v=${v}`); await pg.waitForSelector('.pager.is-ready'); await pg.waitForSelector('[data-issue-links].is-ready');
      await pg.waitForTimeout(1200);
      const r = await pg.evaluate(() => ({ cls: window.__cls, shifts: window.__shifts }));
      if (r.cls) console.log(`   ${v} ${name}`, JSON.stringify(r));
      ok(r.cls < 0.01, `home ${v} CLS < 0.01 at ${name} with late manifest, meta, images and fonts (${r.cls.toFixed(4)})`);
      await ctx.close();
    }
  }
  // ---- 3e. motion: reduced motion removes every movement (transform/scale/translate keyframes) and never curls a corner;
  // normal motion lifts the cover's corner to invite a pull
  for (const reduce of [true, false]) {
    const ctx = await browser.newContext({ ...PHONE, reducedMotion: reduce ? 'reduce' : 'no-preference' }), pg = await ctx.newPage();
    await pg.addInitScript(watchMotion);
    await pg.goto(`${B}/`); await pg.waitForSelector('.pager.is-ready'); await pg.waitForTimeout(reduce ? 900 : 2200);
    const home = await pg.evaluate(() => window.__moves);
    if (reduce) {
      { const b = await pg.locator('[data-book]').boundingBox(); await pg.mouse.click(b.x + b.width * 0.6, b.y + b.height / 2); } await pg.waitForTimeout(400);
      const turned = (await pg.locator('[data-caption]').textContent()).includes('3 /');
      const homeTurn = await pg.evaluate(() => window.__moves);
      await pg.goto(`${B}/subscribe/`); await pg.waitForSelector('#email'); await pg.fill('#email', 'reader@example.com'); await pg.click('[data-step="1"] .pill'); await pg.waitForTimeout(400);
      const sub = await pg.evaluate(() => window.__moves);
      await pg.goto(`${B}/library/`); await pg.waitForSelector('.card'); await pg.waitForTimeout(600);
      const lib = await pg.evaluate(() => window.__moves);
      await pg.goto(`${B}/issue/?n=2`); await pg.waitForSelector('.toc'); await pg.waitForTimeout(600);
      const iss = await pg.evaluate(() => window.__moves);
      await pg.goto(`${B}/read/?n=2&p=3`); await pg.waitForSelector('.mpage img'); await pg.waitForTimeout(300);
      const box = await pg.locator('.mstage').boundingBox();
      await pg.mouse.click(box.x + box.width - 20, box.y + box.height / 2); await pg.waitForTimeout(100); // tap the right edge: next page
      await pg.click('.mfoot .ib[aria-label=Contents]'); await pg.waitForSelector('.sheet'); await pg.waitForTimeout(400);
      const rd = await pg.evaluate(() => window.__moves);
      const all = [...home, ...homeTurn, ...sub, ...lib, ...iss, ...rd]; if (all.length) console.log('  ', all);
      ok(!all.length && turned, 'reduced motion: nothing moves on home (incl. a page turn), subscribe, library, issue or reader (page turn, sheet)');
      const kept = await pg.evaluate(() => document.querySelector('.mhd .facts').textContent);
      ok(kept.includes('Page 4'), `reduced motion: the tap still turns the page instantly (${kept})`);
      const fades = await pg.evaluate(() => window.__fades.filter((x) => /sheet|dim/.test(x)));
      ok(fades.length >= 2, 'reduced motion is gentler, not zero: the contents sheet and its dim still fade in');
    } else ok(Number(await pg.evaluate(() => document.querySelector('[data-book]').dataset.invited)) >= 1, 'normal motion: the cover\'s corner lifts to invite a pull');
    await ctx.close();
  }
  // ---- 3e2. keyboard-initiated changes never animate: after a key press every transition is instant; the mouse brings them back
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }), pg = await ctx.newPage();
    await pg.goto(`${B}/`); await pg.waitForSelector('.pager.is-ready');
    const dur = () => pg.evaluate(() => getComputedStyle(document.querySelector('.lead__actions .pill')).transitionDuration);
    await pg.mouse.move(200, 200); await pg.mouse.move(220, 220); const before = await dur();
    await pg.keyboard.press('Tab'); const key = await dur();
    await pg.mouse.move(240, 240); const after = await dur();
    ok(before !== '0s' && /^0s(, 0s)*$/.test(key) && after === before, `transitions instant after a key press, restored on mouse use (${before} / ${key} / ${after})`);
    await ctx.close();
  }
  // ---- 3f. phone reader: the page follows a swipe and turns on release; a short drag springs back
  {
    const ctx = await browser.newContext(PHONE), pg = await ctx.newPage();
    await pg.goto(`${B}/read/?n=2&p=3`); await pg.waitForSelector('.mpage img'); await pg.waitForTimeout(300);
    const box = await pg.locator('.mstage').boundingBox(), cy = box.y + box.height / 2, cx = box.x + box.width / 2;
    const drag = async (dx, steps) => { await pg.mouse.move(cx, cy); await pg.mouse.down(); for (let k = 1; k <= steps; k++) await pg.mouse.move(cx + (dx * k) / steps, cy); await pg.mouse.up(); await pg.waitForTimeout(450); };
    await drag(-30, 30); // slow and short: springs back
    const stay = await pg.evaluate(() => [new URL(location.href).searchParams.get('p'), document.querySelectorAll('.mpage').length]);
    await drag(-170, 6);
    const moved = await pg.evaluate(() => [new URL(location.href).searchParams.get('p'), document.querySelectorAll('.mpage').length, getComputedStyle(document.querySelector('.mpage')).transform]);
    console.log('  swipe', JSON.stringify({ stay, moved }));
    ok(stay[0] === '3' && stay[1] === 1 && moved[0] === '4' && moved[1] === 1, 'phone reader: a short slow drag springs back, a swipe turns to the next page');
    await ctx.close();
  }
  // ---- 3g. library and issue pages: edition switch, list view, no-match state, not-found states, Greyscale wording
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }), pg = await ctx.newPage();
    await pg.goto(`${B}/library/`); await pg.waitForSelector('.card');
    await pg.click('#ed button[data-v=grey]');
    const ed = await pg.evaluate(() => ({ grey: document.getElementById('out').classList.contains('greyed'), links: [...document.querySelectorAll('.card-links a[download]')].map((a) => [a.textContent, a.getAttribute('href')]) }));
    ok(ed.grey && ed.links.length === man.issues.length && ed.links.every(([t, h]) => t.startsWith('Greyscale PDF') && /grayscale\.pdf$/.test(h)), 'library: the Greyscale edition switch recolours covers and links each greyscale PDF');
    ok((await grayText(pg)).length === 0, 'library (Greyscale edition): no "Grayscale" in user-facing text');
    await pg.click('#view button[data-v=list]'); ok((await pg.locator('.lrow').count()) === man.issues.length, 'library: list view lists every issue');
    await pg.fill('#q', 'zzzz-no-such-story'); await pg.waitForSelector('#out .lead-state');
    const none = await pg.locator('#out .lead-state h2').textContent();
    await pg.click('#out .lead-state button'); await pg.waitForSelector('.lrow');
    ok(none === 'No issue matches' && (await pg.locator('.lrow').count()) === man.issues.length && (await pg.inputValue('#q')) === '', 'library: no-match state clears back to every issue');
    await pg.goto(`${B}/issue/?n=2`); await pg.waitForSelector('.toc');
    const iss = await pg.evaluate(() => ({ h1: [...document.querySelectorAll('h1')].map((h) => h.textContent), heads: [...document.querySelectorAll('main h2')].map((h) => h.textContent), high: document.querySelectorAll('img[fetchpriority=high]').length }));
    ok(iss.h1.length === 1 && iss.heads.join('|') === 'Contents|Pages|Print at home|Other issues|Image credits' && iss.high === 1, `issue page: one h1, sections ${iss.heads.join(', ')}, one high-priority image`);
    ok((await grayText(pg)).length === 0, 'issue page: no "Grayscale" in user-facing text');
    for (const u of ['/issue/?n=999', '/read/?n=999']) {
      await pg.goto(B + u); await pg.waitForSelector('.lead-state h1');
      ok((await pg.locator('.lead-state h1').textContent()) === 'That issue doesn’t exist' && await pg.locator('.lead-state a.btn').isVisible(), `${u}: not-found state with a way back`);
    }
    await ctx.close();
  }
  // ---- 4/5. 404, empty state
  {
    const r = await fetch(`${B}/nope/x`); ok(r.status === 404 && (await r.text()).includes('Not on the shelf'), '/nope/x returns 404 with the 404 page');
    const r2 = await fetch(`${B}/manifest.json`); console.log('  manifest status (no fixtures overlay expected only in prod)', r2.status);
  }
} finally { await browser.close(); srv.kill(); }
console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); process.exit(fails ? 1 : 0);
