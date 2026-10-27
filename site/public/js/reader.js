import { icon, ICON } from './chrome.js';
import { init, el, dateShort, issueDir, loadMeta, pageSrc, sectionOf, sourceChip, fileSize } from './data.js';
import { shortTitle, numbered, reduced, pdfFiles, state, tryAgain } from './parts.js';

const RATIO = 1800 / 2548; // page width / height
const root = document.getElementById('rd');
const q = new URLSearchParams(location.search);
const n = +q.get('n');
const c = await init();
const it = c.issues.find((i) => i.issue === n);
const m = it ? await loadMeta(c, n) : null;

// Motion: pointer-driven changes animate; keyboard-driven ones are instant (they repeat too often), as is everything
// under reduced motion. chrome.js keeps the last input type on <html>.
const byKey = () => document.documentElement.dataset.input === 'key';
const motion = () => (byKey() ? 'none' : reduced() ? 'fade' : 'full'); // reduced motion: overlays fade in place, nothing travels
const animate = () => motion() === 'full';
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)', EASE_DRAWER = 'cubic-bezier(0.32, 0.72, 0, 1)'; // --ease-out, --ease-drawer

/** An overlay that leaves the way it came. Reopening or closing mid-flight reverses from where it is. parts(node) lists
 *  [element, keyframes from hidden to shown]; enters on `ease` over `enter` ms, exits ease-out over `exit` ms.
 *  mode: 'full' moves, 'fade' (reduced motion) is a 150ms opacity fade, 'none' (keyboard) is instant. */
function overlay(host, build, parts, enter, exit, ease = EASE_OUT) {
  let node = null, anims = [], closing = false;
  const play = (nd, back, mode) => parts(nd).map(([e, k]) => {
    const f = mode === 'fade' ? [{ opacity: 0 }, { opacity: 1 }] : k;
    const duration = mode === 'fade' ? (back ? 100 : 150) : back ? exit : enter;
    return e.animate(back ? [...f].reverse() : f, { duration, easing: back || mode === 'fade' ? EASE_OUT : ease, fill: 'both' });
  });
  return {
    get node() { return closing ? null : node; },
    show(mode) {
      if (node && closing) { closing = false; anims.forEach((a) => { a.onfinish = null; if (a.playState === 'running') a.reverse(); else a.cancel(); }); return node; }
      if (node) return node;
      node = build(); host.append(node);
      anims = mode !== 'none' ? play(node, false, mode) : [];
      return node;
    },
    hide(mode) {
      if (!node) return;
      const nd = node, done = () => { nd.remove(); if (node === nd) { node = null; anims = []; closing = false; } };
      if (mode === 'none') { anims.forEach((a) => a.cancel()); done(); return; }
      if (closing) return;
      closing = true;
      if (anims.some((a) => a.playState === 'running')) anims.forEach((a) => a.reverse()); else anims = play(nd, true, mode);
      anims[0].onfinish = () => { if (closing) done(); };
    },
  };
}

if (!m) {
  root.className = 'rd rd-state'; const ph = el('div'); root.replaceChildren(ph);
  if (it || c.failed) state(ph, { level: 1, heading: 'The issue didn’t load', text: 'Something went wrong fetching it. Check your connection, then try again.', action: tryAgain(() => location.reload()) });
  else { const a = el('a', 'btn', 'Back to the library'); a.href = '/library/'; state(ph, { level: 1, heading: 'That issue doesn’t exist', text: 'The link may be old, or the issue hasn’t been published yet.', action: a }); }
} else {
  start();
}

function start() {
  const title = shortTitle(it), label = numbered(it) ? title : `No. ${n} · ${title}`;
  document.title = `${label} — The Ribbon`;
  const COUNT = m.pages;
  const mobile = matchMedia('(max-width:900px)');
  mobile.addEventListener('change', () => location.reload());
  const DIR = issueDir(c, n);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const startPage = clamp(+q.get('p') || 1, 1, COUNT);
  const theme = { get: () => { try { return localStorage.getItem('wb-theme') === 'dark'; } catch (e) { return false; } }, set: (d) => { try { localStorage.setItem('wb-theme', d ? 'dark' : 'paper'); } catch (e) { /* private mode */ } } };
  const themeColor = (dark) => { const t = document.querySelector('meta[name=theme-color]'); if (t) t.content = dark ? '#1B1B1B' : '#F7F4EC'; }; // matches the reader's chrome bar
  const articles = [...m.articles].sort((a, b) => a.page - b.page);
  const articlesOn = (pages) => articles.filter((a) => pages.includes(a.page) && a.sources.length);
  const setUrl = (p) => { const u = new URL(location.href); u.searchParams.set('p', p); history.replaceState(null, '', u); };
  const SUN = 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4', MOON = 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z';
  const LIST = 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01', CLOSE = 'M6 6l12 12M18 6L6 18';

  function pageImg(p, thumb, alt = '') {
    const im = el('img', 'page-img'); im.alt = alt; im.draggable = false; im.decoding = 'async';
    im.src = pageSrc(c, m, p, thumb);
    im.addEventListener('error', () => { const ph = el('div', 'ph-page', thumb ? '' : `Page ${p} is not available.`); im.replaceWith(ph); });
    return im;
  }
  const dlLinks = () => {
    const out = [], { colour, grey } = pdfFiles(m);
    for (const [name, file, hint] of [['Colour edition', colour, 'For screens'], ['Greyscale print edition', grey, 'For home printers']]) {
      if (!file) continue;
      const a = el('a', 'dlrow'); a.href = DIR + file; a.setAttribute('download', file);
      const sz = el('span', 'sz'); const s = el('span', 's'); s.append(el('span', null, hint), el('code', null, file));
      a.append(el('span', 'dt', name), sz, icon(ICON.download, 20, 1.6), s);
      fileSize(DIR + file).then((v) => { sz.textContent = v; }); out.push(a);
    }
    return out;
  };
  const printTip = 'Print on A4: 100 g inside pages, a 200 g cover, saddle-stitched.';
  const dlHead = () => { const h = el('div', 'hd'); h.append(el('h2', null, 'Download'), el('span', 'facts', `PDF · A4 · ${COUNT} pages`)); return h; };
  const tocRows = (onPick, curPages) => articles.map((a) => {
    const b = el('button', 'trow'); b.type = 'button'; b.dataset.page = a.page;
    if (curPages.includes(a.page)) { b.classList.add('cur'); b.setAttribute('aria-current', 'true'); }
    const x = el('span', 'x'); x.append(el('span', 't', a.headline), el('span', 'sc', sectionOf(m, a.section) + (a.kind === 'cover' ? ' · Cover story' : '')));
    const p = el('span', 'p'); p.append(el('span', 'sr', 'Page '), String(a.page));
    b.append(p, x); b.addEventListener('click', () => onPick(a.page)); return b;
  });
  const srcItems = (list) => list.map((a) => { const w = el('div', 'it'); a.sources.forEach((s) => w.append(sourceChip(s))); return w; });

  /* =================== DESKTOP: spreads with a page turn =================== */
  function desktop() {
    root.className = 'rd'; root.tabIndex = 0;
    root.setAttribute('aria-label', `Reader for The Ribbon, ${label}. Arrow keys turn pages.`);
    const S = [[0, 1]]; let p = 2;
    while (p + 1 <= COUNT) { S.push([p, p + 1]); p += 2; }
    if (p === COUNT) S.push([COUNT, 0]);
    const spreadOf = (pg) => (pg <= 1 ? 0 : Math.min(S.length - 1, Math.floor(pg / 2)));
    const Z = [1, 1.35, 1.75, 2.4];
    const st = { s: spreadOf(startPage), turn: null, z: 0, dark: theme.get(), thumbs: true, toc: false, dl: false, fs: false };
    root.classList.toggle('dark', st.dark); themeColor(st.dark);
    let wheelAcc = 0, wheelLock = 0, spreadKey = '', thumbKey = '', turnAnims = [];

    // frame
    const hd = el('header', 'rhd');
    const back = el('a', 'ib'); back.href = `/issue/?n=${n}`; back.setAttribute('aria-label', 'Close reader, back to the issue page'); back.title = 'Close (back to issue)'; back.append(icon(ICON.back, 20, 1.6));
    const tt = el('div', 'tt'); tt.append(el('b', null, 'The Ribbon'), el('span', 'facts', `${label} · ${dateShort(m.date)}`));
    const l = el('div', 'l'); l.append(back, tt);
    const where = el('div', 'where facts'); where.setAttribute('aria-live', 'polite'); const wb = el('b'); where.append(wb, el('span', null, `of ${COUNT}`));
    const tools = el('div', 'tools');
    const ibtn = (lab, d, on, tip) => { const b = el('button', 'ib'); b.type = 'button'; b.setAttribute('aria-label', lab); b.title = tip || lab; if (d) b.append(icon(d, 20, 1.6)); b.addEventListener('click', on); return b; };
    const tocB = ibtn('Contents', LIST, () => setS({ toc: !st.toc, dl: false }), 'Contents (C)'); tocB.setAttribute('aria-expanded', 'false');
    const zo = ibtn('Zoom out', 'M5 12h14', () => zoom(st.z - 1), 'Zoom out (−)');
    const zr = el('button', 'zpct'); zr.type = 'button'; zr.setAttribute('aria-label', 'Reset zoom'); zr.title = 'Reset zoom (0)'; zr.addEventListener('click', () => zoom(0));
    const zi = ibtn('Zoom in', 'M5 12h14M12 5v14', () => zoom(st.z + 1), 'Zoom in (+)');
    const thB = ibtn('Thumbnails', 'M3 14h5v6H3zM9.5 14h5v6h-5zM16 14h5v6h-5zM3 4h18v6H3z', () => setS({ thumbs: !st.thumbs }), 'Thumbnails (T)');
    const themeB = ibtn('Dark mode', null, () => setS({ dark: !st.dark }), 'Dark mode (N)');
    const fsB = ibtn('Full screen', null, fullscreen, 'Full screen (F)');
    const dlB = el('button', 'lbl dlbtn'); dlB.type = 'button'; dlB.title = 'Download (D)'; dlB.setAttribute('aria-expanded', 'false'); dlB.append(icon(ICON.download), 'Download'); dlB.addEventListener('click', () => setS({ dl: !st.dl, toc: false }));
    const sep = () => el('span', 'sep');
    tools.append(tocB, sep(), zo, zr, zi, sep(), thB, themeB, fsB, dlB);
    hd.append(l, where, tools);
    const prog = el('div', 'prog'); const pgi = el('i'); prog.append(pgi);
    const mid = el('div', 'mid'); const stage = el('div', 'stage');
    const prev = el('button', 'turn prev'); prev.type = 'button'; prev.setAttribute('aria-label', 'Previous pages'); prev.append(icon('M15 4l-8 8 8 8', 30, 1.3)); prev.addEventListener('click', () => go(st.s - 1));
    const next = el('button', 'turn next'); next.type = 'button'; next.setAttribute('aria-label', 'Next pages'); next.append(icon('M9 4l8 8-8 8', 30, 1.3)); next.addEventListener('click', () => go(st.s + 1));
    const scroller = el('div', 'scroller'); const spread = el('div', 'spread'); scroller.append(spread); stage.append(prev, next, scroller);
    const srcbar = el('div', 'srcbar'); srcbar.setAttribute('aria-label', 'Sources for these pages'); srcbar.setAttribute('role', 'region');
    const thumbs = el('nav', 'thumbs'); thumbs.setAttribute('aria-label', 'Pages');
    const layer = el('div'); // contents panel and download popover
    mid.append(stage, srcbar, thumbs, layer); root.replaceChildren(hd, prog, mid);

    // contents slides in from the left edge it is docked to; the download popover grows from its button (top right)
    let tocRowsEls = [];
    const toc = overlay(layer, () => {
      const a = el('aside', 'tocpanel'); a.setAttribute('aria-label', 'Contents');
      const h = el('div', 'hd'); const x = ibtn('Close contents', CLOSE, () => setS({ toc: false }));
      h.append(el('h2', null, 'Contents'), x);
      const body = el('div', 'body'); tocRowsEls = tocRows((pg) => { setS({ toc: false }); go(spreadOf(pg)); }, S[st.s].filter((x2) => x2 > 0));
      body.append(...tocRowsEls); a.append(h, body); return a;
    }, (a) => [[a, [{ transform: 'translateX(-100%)' }, { transform: 'none' }]]], 280, 200, EASE_DRAWER);
    const dl = overlay(layer, () => {
      const d = el('div', 'dlpop'); d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'Download this issue');
      d.append(dlHead(), ...dlLinks(), el('p', 'tip', printTip)); return d;
    }, (d) => [[d, [{ opacity: 0, transform: 'scale(0.97)' }, { opacity: 1, transform: 'none' }]]], 180, 120);

    const size = () => {
      const H = stage.clientHeight - 56, W = stage.clientWidth - 176, z = Z[st.z];
      let h = H * z; if (st.z === 0) h = Math.min(h, W / (2 * RATIO));
      spread.style.height = Math.max(120, h) + 'px'; spread.style.width = Math.max(120, h * 2 * RATIO) + 'px';
      scroller.style.overflow = st.z === 0 ? 'hidden' : 'auto';
    };
    new ResizeObserver(size).observe(stage);

    // Page images are made once and moved between the halves and the leaf, so the spread never blanks while a decode catches up.
    const imgs = new Map();
    const img = (pg) => {
      if (!imgs.has(pg)) { const im = pageImg(pg, false, `Page ${pg}`); im.addEventListener('error', () => imgs.set(pg, el('div', 'ph-page', `Page ${pg} is not available.`))); imgs.set(pg, im); }
      return imgs.get(pg);
    };
    const half = (side, pg) => { const d = el('div', 'half ' + side); if (pg > 0) { d.classList.add('paper'); d.append(img(pg)); } return d; };
    function drawSpread() {
      const key = st.turn ? `${st.turn.from}>${st.turn.to}` : String(st.s);
      if (key === spreadKey) return; // unrelated redraws (theme, panels) never rebuild the pages or restart a turn
      spreadKey = key;
      let L, R, lf, lb, dir = '';
      if (st.turn) {
        const a = S[st.turn.from], b = S[st.turn.to];
        if (st.turn.dir === 'f') { L = a[0]; R = b[1]; lf = a[1]; lb = b[0]; dir = 'f'; } else { L = b[0]; R = a[1]; lf = a[0]; lb = b[1]; dir = 'b'; }
      } else [L, R] = S[st.s];
      const lh = half('L', L), rh = half('R', R);
      if (L > 0) lh.append(el('div', 'sp'));
      if (L > 0 && R > 0) rh.append(el('div', 'sp'));
      spread.replaceChildren(lh, rh);
      if (!st.turn) { // warm the next spread at low priority, so the leaf of the next turn is already decoded
        (S[st.s + 1] || []).forEach((pg) => { if (pg > 0 && !imgs.has(pg)) img(pg).fetchPriority = 'low'; });
        return;
      }
      // The leaf: the page being turned, front and back, hinged on the spine. A page-sized object crossing half the
      // screen, so it gets drawer timing (400ms on the iOS drawer curve: it leaves at once and settles), not the 300ms UI cap.
      const leaf = el('div', 'leaf ' + dir); leaf.setAttribute('aria-hidden', 'true');
      const shades = [];
      const face = (cls, pg, to) => { const f = el('div', 'face ' + cls); if (pg > 0) f.append(img(pg)); const sh = el('div', 'shade ' + to); shades.push(sh); f.append(sh); return f; };
      leaf.append(face('', lf, dir === 'f' ? 'r' : 'l'), face('back', lb, dir === 'f' ? 'l' : 'r')); spread.append(leaf);
      const T = { duration: 400, easing: EASE_DRAWER };
      turnAnims = [leaf.animate([{ transform: 'rotateY(0deg)' }, { transform: `rotateY(${dir === 'f' ? -180 : 180}deg)` }], { ...T, fill: 'forwards' }),
        ...shades.map((s) => s.animate([{ opacity: 0 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }], T))];
      turnAnims[0].onfinish = endTurn;
    }
    function endTurn() { if (!st.turn) return; turnAnims.forEach((a) => a.cancel()); turnAnims = []; st.turn = null; draw(); }
    function drawThumbs() {
      thumbs.hidden = !st.thumbs;
      const key = st.thumbs ? String(st.s) : '';
      if (!st.thumbs || key === thumbKey) return;
      thumbKey = key;
      const strip = el('div', 'strip2');
      S.forEach((pair, i) => {
        const b = el('button', 'th' + (i === st.s ? ' cur' : '')); b.type = 'button';
        const lab = i === 0 ? '1' : pair[1] === 0 ? String(pair[0]) : `${pair[0]}–${pair[1]}`;
        b.setAttribute('aria-label', i === 0 ? 'Cover' : 'Pages ' + lab); if (i === st.s) b.setAttribute('aria-current', 'page');
        const pp = el('span', 'pp'); pair.filter((x) => x > 0).forEach((x) => { const s = el('span'); const im = pageImg(x, true); im.loading = 'lazy'; s.append(im); pp.append(s); });
        b.append(pp, el('span', 'n', lab)); b.addEventListener('click', () => go(i)); strip.append(b);
      });
      const key2 = (k) => el('kbd', null, k);
      const h1 = el('p', 'hint'); h1.append(key2('←'), key2('→'), ' turn', el('br'), key2('+'), key2('−'), ' zoom', el('br'), key2('F'), ' full screen');
      const h2 = el('p', 'hint r'); h2.append(key2('T'), ' thumbnails', el('br'), key2('C'), ' contents', el('br'), key2('D'), ' download');
      thumbs.replaceChildren(h1, strip, h2);
      const curEl = strip.querySelector('.cur'); if (curEl) strip.scrollLeft = curEl.offsetLeft - strip.clientWidth / 2 + curEl.offsetWidth / 2;
    }
    let srcKey = '';
    function draw() {
      const sp = S[st.s], vis = sp.filter((x) => x > 0);
      root.classList.toggle('dark', st.dark); themeColor(st.dark);
      drawSpread(); size();
      wb.textContent = st.s === 0 ? 'Cover' : sp[1] === 0 ? `Page ${sp[0]}` : `Pages ${sp[0]}–${sp[1]}`;
      pgi.style.transform = `scaleX(${(st.s / (S.length - 1)).toFixed(3)})`;
      prev.disabled = st.s === 0; next.disabled = st.s === S.length - 1;
      zr.textContent = Math.round(Z[st.z] * 100) + '%'; zo.disabled = st.z === 0; zi.disabled = st.z === Z.length - 1;
      thB.classList.toggle('on', st.thumbs); thB.setAttribute('aria-pressed', String(st.thumbs));
      tocB.classList.toggle('on', st.toc); tocB.setAttribute('aria-expanded', String(st.toc)); dlB.setAttribute('aria-expanded', String(st.dl));
      themeB.replaceChildren(icon(st.dark ? SUN : MOON, 20, 1.6)); themeB.setAttribute('aria-label', st.dark ? 'Paper mode' : 'Dark mode');
      fsB.replaceChildren(icon(st.fs ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', 20, 1.6)); fsB.setAttribute('aria-label', st.fs ? 'Exit full screen' : 'Full screen');
      if (srcKey !== String(st.s)) { // sources for the visible pages
        srcKey = String(st.s); const list = articlesOn(vis);
        srcbar.replaceChildren(); srcbar.hidden = !list.length;
        if (list.length) srcbar.append(el('span', 'srclabel', 'Sources on these pages'), ...srcItems(list));
      }
      drawThumbs();
      const a = motion();
      if (st.toc) { toc.show(a); tocRowsEls.forEach((b) => { const on = vis.includes(+b.dataset.page); b.classList.toggle('cur', on); if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); }); } else toc.hide(a);
      if (st.dl) dl.show(a); else dl.hide(a);
      setUrl(sp[0] || 1);
    }
    const setS = (o) => { Object.assign(st, o); if ('dark' in o) theme.set(st.dark); draw(); };
    function go(to) {
      if (to < 0 || to >= S.length || to === st.s) return;
      endTurn(); // a turn still in flight completes at once, so a quick second click is never swallowed
      if (!animate()) { st.s = to; draw(); return; }
      st.turn = { dir: to > st.s ? 'f' : 'b', from: st.s, to }; st.s = to; draw();
    }
    function zoom(i) { setS({ z: clamp(i, 0, Z.length - 1) }); }
    function fullscreen() {
      try {
        if (document.fullscreenElement) document.exitFullscreen();
        else if (root.requestFullscreen) root.requestFullscreen().catch(() => {});
      } catch (e) { /* unsupported */ }
    }
    document.addEventListener('fullscreenchange', () => setS({ fs: !!document.fullscreenElement }));
    root.addEventListener('keydown', (e) => {
      const k = e.key, t = e.target;
      if (t.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (k === 'ArrowRight' || k === 'PageDown' || (k === ' ' && t === root)) { e.preventDefault(); go(st.s + 1); }
      else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); go(st.s - 1); }
      else if (k === 'Home') { e.preventDefault(); go(0); } else if (k === 'End') { e.preventDefault(); go(S.length - 1); }
      else if (k === '+' || k === '=') { e.preventDefault(); zoom(st.z + 1); } else if (k === '-' || k === '_') { e.preventDefault(); zoom(st.z - 1); } else if (k === '0') zoom(0);
      else if (k === 'f' || k === 'F') fullscreen(); else if (k === 't' || k === 'T') setS({ thumbs: !st.thumbs });
      else if (k === 'c' || k === 'C') setS({ toc: !st.toc, dl: false }); else if (k === 'd' || k === 'D') setS({ dl: !st.dl, toc: false });
      else if (k === 'n' || k === 'N') setS({ dark: !st.dark });
      else if (k === 'Escape') { if (st.toc || st.dl) setS({ toc: false, dl: false }); else if (st.z > 0) zoom(0); root.focus({ preventScroll: true }); }
    });
    root.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); wheelAcc += e.deltaY; if (Math.abs(wheelAcc) > 40) { zoom(st.z + (wheelAcc < 0 ? 1 : -1)); wheelAcc = 0; } return; }
      if (st.z > 0 || !e.target.closest('.stage')) return;
      const now = Date.now(); if (now < wheelLock) return;
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(d) > 24) { wheelLock = now + 750; go(st.s + (d > 0 ? 1 : -1)); }
    }, { passive: false });
    draw(); root.focus({ preventScroll: true });
  }

  /* =================== PHONE: one page, a pager that follows the finger =================== */
  function phone() {
    root.className = 'rd rm'; root.tabIndex = 0;
    root.setAttribute('aria-label', `Reader for ${label}. Swipe or tap the edges to turn pages.`);
    const st = { p: startPage, dark: theme.get(), hc: false };
    root.classList.toggle('dark', st.dark); themeColor(st.dark);
    const hd = el('header', 'mhd'); const row = el('div', 'row');
    const back = el('a', 'ib'); back.href = `/issue/?n=${n}`; back.setAttribute('aria-label', 'Close reader'); back.append(icon(ICON.back, 22, 1.6));
    const c2 = el('div', 'c'); const sub = el('span', 'facts'); sub.setAttribute('aria-live', 'polite'); c2.append(el('b', null, label), sub);
    const dlB = el('button', 'ib'); dlB.type = 'button'; dlB.setAttribute('aria-label', 'Download'); dlB.append(icon(ICON.download, 21)); dlB.addEventListener('click', () => open('dl', dlB));
    row.append(back, c2, dlB); const mp = el('div', 'mprog'); const mpi = el('i'); mp.append(mpi); hd.append(row, mp);
    const stage = el('div', 'mstage');
    const ft = el('footer', 'mfoot'); const msrc = el('div', 'msrc'); msrc.setAttribute('role', 'region'); msrc.setAttribute('aria-label', 'Sources for this page');
    const bar = el('div', 'bar');
    const tocB = el('button', 'ib'); tocB.type = 'button'; tocB.setAttribute('aria-label', 'Contents'); tocB.append(icon(LIST, 22, 1.6)); tocB.addEventListener('click', () => open('toc', tocB));
    const lab = el('label', 'sr', 'Page'); lab.htmlFor = 'rm-range';
    const rg = el('input', 'range'); rg.type = 'range'; rg.id = 'rm-range'; rg.min = 1; rg.max = COUNT; rg.step = 1; rg.addEventListener('input', () => jump(+rg.value));
    const cnt = el('span', 'cnt');
    const thB = el('button', 'ib'); thB.type = 'button'; thB.addEventListener('click', () => { st.dark = !st.dark; theme.set(st.dark); paint(); });
    bar.append(tocB, lab, rg, cnt, thB); ft.append(msrc, bar);
    const host = el('div'); root.replaceChildren(hd, stage, ft, host);
    let page = el('div', 'mpage'); stage.append(page);
    // One-time hint, inside the footer chrome (never over the page), gone after a few seconds.
    let seen = false; try { seen = localStorage.getItem('wb-reader-hint') === '1'; localStorage.setItem('wb-reader-hint', '1'); } catch (e) { /* private mode: show once per load */ }
    if (!seen) { const hint = el('p', 'hint', 'Swipe or tap the edges to turn pages'); ft.prepend(hint); setTimeout(() => relayout(() => hint.remove()), 3500); }

    // page box: centred between the header and footer chrome, never under them
    let box = { w: 0, h: 0, top: 0 };
    const place = (pg) => { pg.style.width = box.w + 'px'; pg.style.height = box.h + 'px'; pg.style.top = box.top + 'px'; };
    const fit = () => {
      const sh = stage.clientHeight, sw = stage.clientWidth;
      const top = st.hc ? 8 : hd.offsetHeight + 8, bot = st.hc ? 8 : ft.offsetHeight + 8;
      const h = Math.max(100, Math.min(sh - top - bot, (sw - 20) / RATIO));
      box = { w: Math.max(60, h * RATIO), h, top: top + (sh - top - bot) / 2 };
      stage.querySelectorAll('.mpage').forEach(place);
    };
    for (const o of [stage, ft, hd]) new ResizeObserver(fit).observe(o);
    /** Layout changes that resize the page (chrome hidden, a sources row appearing) morph it with a FLIP: transform only. */
    function relayout(change) {
      const before = page.getBoundingClientRect();
      change(); fit();
      const after = page.getBoundingClientRect();
      if (!before.height || !after.height || Math.abs(before.height - after.height) < 1 || !animate()) return;
      const k = before.height / after.height, dy = (before.top + before.height / 2) - (after.top + after.height / 2);
      page.animate([{ transform: `translate(-50%,-50%) translateY(${dy.toFixed(1)}px) scale(${k.toFixed(4)})` }, { transform: 'translate(-50%,-50%)' }], { duration: st.hc ? 200 : 250, easing: EASE_OUT }); // in step with the chrome
    }
    const fill = (pg, p) => { const im = pageImg(p, false, `Page ${p}`); im.fetchPriority = 'high'; pg.dataset.p = p; pg.replaceChildren(im); }; // the page on screen beats the prefetches below
    function paint() {
      root.classList.toggle('dark', st.dark); themeColor(st.dark);
      sub.textContent = `${st.p === 1 ? 'Cover' : 'Page ' + st.p} of ${COUNT}`;
      mpi.style.transform = `scaleX(${((st.p - 1) / (COUNT - 1)).toFixed(3)})`; rg.value = st.p; cnt.textContent = `${st.p}/${COUNT}`;
      thB.setAttribute('aria-label', st.dark ? 'Paper mode' : 'Dark mode'); thB.replaceChildren(icon(st.dark ? SUN : MOON, 21, 1.6));
      if (page.dataset.p !== String(st.p)) fill(page, st.p);
      relayout(() => {
        root.classList.toggle('hc', st.hc);
        const list = articlesOn([st.p]); msrc.replaceChildren(); msrc.hidden = !list.length;
        if (list.length) msrc.append(el('span', 'srclabel', 'Sources'), ...srcItems(list));
      });
      setUrl(st.p);
      [st.p + 1, st.p - 1].forEach((x) => { if (x >= 1 && x <= COUNT) { const i = new Image(); i.fetchPriority = 'low'; i.decoding = 'async'; i.src = pageSrc(c, m, x, false); } });
    }

    // The pager. A swipe drags the page and its neighbour together; letting go past a quarter of the page, or with a flick
    // (velocity over 0.11 px/ms), turns it, otherwise it springs back. Past the first or last page it resists instead of
    // stopping dead. One finger only. Taps on the outer quarters turn the same way; the keyboard and the slider jump.
    const GAP = 16, tf = (x) => `translate(-50%,-50%) translateX(${x.toFixed(1)}px)`;
    let peek = null, peekSide = 0, slide = null, drag = null;
    const at = (pg, x) => { pg.style.transform = x ? tf(x) : ''; };
    const clearPeek = () => { if (peek) { peek.remove(); peek = null; peekSide = 0; } };
    const makePeek = (side) => { const to = st.p + side; if (to < 1 || to > COUNT) return; peek = el('div', 'mpage'); peekSide = side; place(peek); fill(peek, to); at(peek, side * (box.w + GAP)); stage.append(peek); };
    const zoomed = () => window.visualViewport && window.visualViewport.scale > 1.02;
    function settleTo(side, from, v = 0) { // side: 1 next, -1 previous, 0 back to rest; v: release speed in px/ms
      if (side && !peek) makePeek(side);
      if (side && !peek) side = 0;
      const D = box.w + GAP, ps = peekSide, left = Math.abs((side ? -side * D : 0) - from);
      // Hand the finger's speed to the curve: ease-out starts at 1/0.23 of its average speed, so this duration continues the
      // release velocity instead of jerking to a fixed one (kept within 160-300ms). Taps use 260ms.
      const dur = v > 0.05 ? Math.min(300, Math.max(160, left / v / 0.23)) : side ? 260 : 200;
      const end = () => {
        slide = null;
        if (side) { page.remove(); page = peek; peek = null; peekSide = 0; at(page, 0); st.p = +page.dataset.p; paint(); }
        else { clearPeek(); at(page, 0); }
      };
      if (!animate()) { end(); return; }
      const o = { duration: dur, easing: EASE_OUT, fill: 'forwards' };
      const anims = [page.animate([{ transform: tf(from) }, { transform: tf(side ? -side * D : 0) }], o)];
      if (peek) anims.push(peek.animate([{ transform: tf(from + ps * D) }, { transform: tf(side ? 0 : ps * D) }], o));
      const fin = () => { if (slide !== cur) return; anims.forEach((a) => a.cancel()); end(); };
      const cur = { finish: fin }; slide = cur;
      anims[0].onfinish = fin;
    }
    const go = (side) => { if (slide) slide.finish(); if (st.p + side >= 1 && st.p + side <= COUNT) settleTo(side, 0); };
    const jump = (p) => { if (slide) slide.finish(); clearPeek(); st.p = clamp(p, 1, COUNT); paint(); };
    stage.addEventListener('pointerdown', (e) => {
      if (drag || !e.isPrimary || e.target.closest('a,button')) return;
      if (slide) slide.finish(); // a turn still in flight completes at once
      drag = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, on: false, side: 0, off: 0, vx: 0, ldx: 0, lt: 0 };
    });
    stage.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.on) {
        if (zoomed() || Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
        drag.on = true; try { stage.setPointerCapture(e.pointerId); } catch (er) { /* pointer already gone */ }
      }
      const now = performance.now(); // the finger's speed just before release, for the hand-off
      if (drag.lt) drag.vx = (dx - drag.ldx) / Math.max(1, now - drag.lt);
      drag.ldx = dx; drag.lt = now;
      const side = dx < 0 ? 1 : -1;
      if (side !== drag.side) { clearPeek(); drag.side = side; makePeek(side); }
      drag.off = peek ? dx : dx * 0.3;
      at(page, drag.off); if (peek) at(peek, drag.off + peekSide * (box.w + GAP));
    });
    stage.addEventListener('pointerup', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; drag = null;
      if (d.on) {
        const v = Math.abs(d.off) / Math.max(1, performance.now() - d.t), turn = peek && (Math.abs(d.off) > box.w * 0.25 || v > 0.11);
        settleTo(turn ? d.side : 0, d.off, turn ? Math.max(v, Math.abs(d.vx)) : 0); return;
      }
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10 || performance.now() - d.t > 400 || zoomed()) return; // pinch-zoomed: let the user pan
      const r = stage.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width;
      if (fx < 0.25) go(-1); else if (fx > 0.75) go(1); else { st.hc = !st.hc; paint(); }
    });
    stage.addEventListener('pointercancel', (e) => { if (drag && e.pointerId === drag.id) { const d = drag; drag = null; if (d.on) settleTo(0, d.off); } });

    // sheets rise from the bottom edge and leave the same way; focus returns to the button that opened them
    let opener = null, kind = '';
    const sheet = overlay(host, () => {
      const wrap = el('div', 'sheetwrap');
      const dim = el('div', 'dim'); dim.addEventListener('click', () => open(''));
      const sh = el('div', 'sheet'); sh.setAttribute('role', 'dialog'); const t = kind === 'toc' ? 'Contents' : 'Download'; sh.setAttribute('aria-label', kind === 'toc' ? 'Contents' : 'Download this issue');
      const h = el('div', 'hd'); const x = el('button', 'ib'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.append(icon(CLOSE, 20, 1.6)); x.addEventListener('click', () => open(''));
      h.append(el('h2', null, t), x); const body = el('div', 'body');
      if (kind === 'toc') body.append(...tocRows((pg) => { open(''); jump(pg); }, [st.p]));
      else body.append(el('p', 'facts sub', `PDF · A4 · ${COUNT} pages`), ...dlLinks(), el('p', 'tip', printTip));
      sh.append(h, body); wrap.append(dim, sh); return wrap;
    }, (w) => [[w.querySelector('.dim'), [{ opacity: 0 }, { opacity: 1 }]], [w.querySelector('.sheet'), [{ transform: 'translateY(100%)' }, { transform: 'none' }]]], 300, 200, EASE_DRAWER);
    function open(k, from) {
      const a = motion();
      if (!k) { sheet.hide(a); if (opener) opener.focus({ preventScroll: true }); opener = null; kind = ''; return; }
      if (kind && kind !== k) sheet.hide('none');
      kind = k; opener = from || null;
      const w = sheet.show(a); const x = w.querySelector('.sheet .ib'); if (x) x.focus({ preventScroll: true });
    }
    root.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'Escape') open('');
    });
    paint();
  }
  if (mobile.matches) phone(); else desktop();
}
