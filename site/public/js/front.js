// The front page. The pitch (hero, sub, CTA) is static HTML so it paints at once; js/ab.js swaps the copy for the
// visitor's variant. This module fills in the week's issue from /manifest.json and its meta.json:
//  1. The book: the latest issue as a magazine on the table. Closed, it shows its cover; open, two facing pages (on a
//     phone, the right-hand page whole and the edge of the left one). Take a page by its corner and it curls over, its
//     back showing and the next page uncovered beneath; let go past a third of the way or with a flick and it turns,
//     otherwise it lies back down. A page in flight can be caught. Tap the right-hand page to go forward, the left-hand
//     one to go back. No buttons: a mouse near a corner lifts it, and until the issue is touched its corner lifts a
//     little now and then. Keyboard turns are instant; reduced motion crossfades.
//  2. The Kindle: the issue's last page on e-ink, with one refresh, once, when it scrolls into view.
// Every slot is reserved in the HTML, so the data arriving moves nothing. No issues, a failed list or a failed meta.json
// each get a calm state in the book's place; the pitch and the subscribe CTA work regardless.
import { chrome } from './chrome.js';
import { el, dateLong, loadMeta, issueDir, pageSrc, coverThumb } from './data.js';
import { readHref, pdfFiles, tryAgain } from './parts.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)'; // --ease-out
// One page's rendered width (front.css .book --page-w): height-led on desktop, width-led on phones. Kept honest so 1x screens get the thumbnail.
const SIZES = '(min-width: 80rem) min(calc((88vh - 10rem) * 0.7071), 31.1rem, calc(50vw - 23rem)), (min-width: 40rem) min(calc(50vw - 3rem), 17rem), min(72vw, 19.5rem)';

const book = document.querySelector('[data-book]');
const pager = document.querySelector('[data-pager]');
const line = document.querySelector('[data-issue-line]');
const links = document.querySelector('[data-issue-links]');
const main = document.getElementById('main');

const c = await chrome();
if (c.failed) {
  bookState('The issue didn’t load.', 'Check your connection, then try again.', tryAgain(() => location.reload()));
} else if (!c.issues.length) {
  bookState('No issues yet.', 'Nothing has been published so far.');
} else {
  const L = c.issues[0];
  const cover = coverLeaf(L);
  fillLine(L);
  // The rest waits for meta.json (page names, sections, PDFs); a stalled request gives up after 5s and the cover stays.
  const m = await Promise.race([loadMeta(c, L.issue), new Promise((r) => setTimeout(() => r(null), 5000))]);
  fillLinks(L, m);
  if (m && m.pages > 1) setUpBook(L, m, cover);
  setUpEink(L, m);
}
main.removeAttribute('aria-busy');

/** Replaces the blank sheet with the cover (eager, high priority: it is the first viewport's image). */
function coverLeaf(L) {
  const leaf = book.querySelector('.leaf');
  leaf.classList.remove('leaf--blank');
  leaf.setAttribute('aria-label', `Page 1, the cover of Issue ${L.issue}`);
  if (!L.cover_image) { missing(leaf, 1); return leaf; }
  const dir = issueDir(c, L.issue);
  const img = el('img');
  img.width = 1200; img.height = 1697; img.sizes = SIZES; img.decoding = 'async'; img.draggable = false;
  img.loading = 'eager'; img.setAttribute('fetchpriority', 'high');
  img.srcset = `${dir + coverThumb(L)} 400w, ${dir + L.cover_image} 1200w`;
  img.src = dir + L.cover_image;
  img.alt = `Cover of Issue ${L.issue}`;
  img.addEventListener('error', () => missing(leaf, 1));
  leaf.prepend(img);
  return leaf;
}

function missing(leaf, p) {
  if (leaf.classList.contains('is-missing')) return;
  leaf.classList.add('is-missing');
  leaf.append(el('span', 'leaf__missing', p === 1 ? 'Cover' : `Page ${p}`));
}

function fillLine(L) {
  const t = el('time', null, dateLong(L.date)); t.dateTime = L.date;
  line.replaceChildren(`Issue ${L.issue} · `, t);
}

function fillLinks(L, m) {
  const [read, pdf] = links.querySelectorAll('a');
  read.href = readHref(L.issue);
  const { colour } = pdfFiles(m);
  if (colour) pdf.href = issueDir(c, L.issue) + colour; else pdf.remove();
  links.classList.add('is-ready');
}

/** No issue to show: the sheet carries the reason, and a retry when one could help. The pager stays hidden. */
function bookState(heading, text, action) {
  book.querySelector('[data-spread]').remove();
  book.classList.add('is-empty');
  book.removeAttribute('tabindex');
  book.removeAttribute('aria-roledescription');
  book.setAttribute('aria-label', 'This week’s issue');
  book.removeAttribute('aria-describedby');
  const s = el('div', 'book__state');
  s.setAttribute('role', 'status');
  s.append(el('p', 'display', heading), el('p', null, text));
  if (action) { action.className = 'ghost'; s.append(action); }
  book.append(s);
  line.remove();
  links.remove();
}

/** What each page is called in the pager and its alt text: its section from meta.json, and the headlines on it. */
function pageInfo(m) {
  return Array.from({ length: m.pages }, (_, k) => {
    const p = k + 1;
    const sec = m.sections.find((s) => p >= s.page_start && p <= s.page_end);
    const heads = m.articles.filter((a) => a.page === p).map((a) => a.headline).filter(Boolean);
    const label = p === 1 ? 'Cover' : sec && sec.label ? sec.label : '';
    return { label, alt: heads.join('. ') };
  });
}

function setUpBook(L, meta, cover) {
  const COUNT = meta.pages;
  const INFO = pageInfo(meta);
  const READER = readHref(L.issue);
  const capEl = pager.querySelector('[data-caption]');
  const live = pager.querySelector('[data-live]');
  const spread = book.querySelector('[data-spread]');
  const [stackL, stackR] = spread.querySelectorAll('.stack');
  const narrow = matchMedia('(max-width: 39.99rem)'); // phones: one page, with the edge of the facing page beside it
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const dir = issueDir(c, L.issue);

  book.setAttribute('aria-label', `Issue ${L.issue}, page by page`);
  cover.setAttribute('aria-label', `Page 1 of ${COUNT}`);
  const coverImg = cover.querySelector('img');
  if (coverImg) {
    if (meta.cover_headline) coverImg.alt = `Cover of Issue ${L.issue}: ${meta.cover_headline}`;
    // meta.json's per-build names are the source of truth; the manifest's cover names match them by spec
    if (meta.files.pages && meta.files.thumbs) { const s = `${dir + meta.files.thumbs[0]} 400w, ${dir + meta.files.pages[0]} 1200w`; if (coverImg.getAttribute('srcset') !== s) coverImg.srcset = s; }
  }

  // Pages 2..N and the back cover. Odd indexes are versos (left), even ones rectos (right): the cover is a recto on its
  // own, then 2|3, 4|5 ... and the back cover faces the last page. Images get their srcset once they're near the open spread.
  const leaves = [cover];
  for (let i = 1; i < COUNT; i++) {
    const p = i + 1;
    const leaf = el('div', i % 2 ? 'leaf is-left' : 'leaf');
    leaf.setAttribute('role', 'group');
    leaf.setAttribute('aria-roledescription', 'slide');
    leaf.setAttribute('aria-label', `Page ${p} of ${COUNT}`);
    const img = el('img');
    img.width = 1200; img.height = 1697; img.decoding = 'async'; img.draggable = false;
    img.loading = 'lazy'; img.fetchPriority = 'low'; // the cover is the page's one high-priority image
    const { label, alt } = INFO[i];
    img.alt = `Page ${p}${label ? ', ' + label : ''}${alt ? ': ' + alt : ''}`;
    img.sizes = SIZES;
    img.dataset.srcset = `${pageSrc(c, meta, p, true)} 400w, ${pageSrc(c, meta, p, false)} 1200w`;
    img.addEventListener('error', () => missing(leaf, p));
    leaf.append(img);
    spread.append(leaf);
    leaves.push(leaf);
  }
  const back = el('div', COUNT % 2 ? 'leaf leaf--back is-left' : 'leaf leaf--back');
  back.setAttribute('role', 'group');
  back.setAttribute('aria-roledescription', 'slide');
  back.setAttribute('aria-label', 'Back cover');
  const mark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  mark.setAttribute('class', 'wordmark__mark'); mark.setAttribute('viewBox', '0 0 11 16'); mark.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'M0 0h11v16l-5.5-4.2L0 16z'); mark.append(path);
  const backTitle = el('p', 'display', `That’s Issue ${L.issue}.`);
  const backActions = el('div', 'back-actions');
  const readLink = el('a', 'textlink', 'Read it full size');
  readLink.href = READER;
  const again = el('button', 'textlink', 'Back to the cover');
  again.type = 'button';
  backActions.append(readLink, again);
  back.append(mark, backTitle, backActions);
  spread.append(back);
  leaves.push(back);

  // The light on a turning page: the shadow it casts on the page it uncovers, and the sheen of the curl on its back.
  const cast = el('span', 'curl curl--cast');
  const gloss = el('span', 'curl curl--gloss');
  cast.setAttribute('aria-hidden', 'true'); gloss.setAttribute('aria-hidden', 'true');
  spread.append(cast, gloss);

  const TOTAL = leaves.length;
  const LASTV = Math.floor(TOTAL / 2);
  const leftOf = (v) => (v > 0 && 2 * v - 1 < TOTAL ? 2 * v - 1 : -1);
  const rightOf = (v) => (2 * v < TOTAL ? 2 * v : -1);
  const NONE = 'polygon(0 0, 0 0, 0 0)';

  let view = 0; // the open spread: 0 is the closed cover, then 2|3, 4|5 ...
  let turn = null; // a page lifting: { d, c (its corner at rest), p (where that corner is now), V, O, U, S, raf, target, peek }
  let drag = null;
  let touched = false;
  let fading = false;
  let W = 0, H = 0;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const easeOut = bezier(0.23, 1, 0.32, 1); // --ease-out
  const easeInOut = bezier(0.77, 0, 0.175, 1); // --ease-in-out
  const ink = (a) => `oklch(0.2 0.03 60 / ${a.toFixed(3)})`;
  const light = (a) => `oklch(1 0 0 / ${a.toFixed(3)})`;
  const slotX = (i) => (i % 2 ? -W : 0); // the spine is x = 0; versos lie left of it
  const can = (d) => (d > 0 ? view < LASTV && rightOf(view) >= 0 : view > 0);

  function measure() { W = cover.offsetWidth; H = cover.offsetHeight; }

  function load(i) {
    const img = leaves[i] && leaves[i].querySelector('img[data-srcset]');
    if (img) { img.srcset = img.dataset.srcset; img.removeAttribute('data-srcset'); }
  }

  // Where the spread sits. Closed on its cover, the cover is centred; open, the spine is. On a phone the open spread
  // slides right so the recto reads whole and the verso's edge shows at the left of the screen.
  function shiftFor(v) {
    const solo = v === 0 ? -1 : rightOf(v) < 0 ? 1 : 0;
    if (!narrow.matches) return (solo * W) / 2;
    if (solo < 0) return 0;
    if (solo > 0) return W;
    const r = book.getBoundingClientRect();
    return clamp(document.documentElement.clientWidth - 12 - (r.left + W), 0, W / 2);
  }

  // The spread at rest: its two pages flat, everything else hidden and out of the accessibility tree.
  function layout() {
    const l = leftOf(view), r = rightOf(view);
    leaves.forEach((leaf, i) => {
      const on = i === l || i === r;
      leaf.classList.toggle('is-shown', on);
      leaf.style.zIndex = on ? 2 : '';
      leaf.style.transform = `translateX(${slotX(i)}px)`;
      leaf.style.clipPath = '';
      leaf.inert = !on;
      leaf.setAttribute('aria-hidden', String(!on));
    });
    stackL.dataset.depth = l < 0 ? 'none' : String(clamp(l, 0, 2));
    stackR.dataset.depth = r < 0 ? 'none' : String(clamp(TOTAL - 1 - r, 0, 2));
    spread.style.setProperty('--shift', `${shiftFor(view).toFixed(1)}px`);
    for (let i = 2 * view - 3; i <= 2 * view + 4; i++) if (i >= 0 && i < TOTAL) load(i);
  }

  // Lift a page by one corner. Forward lifts the recto (V) and shows its back (O, the next verso) as it folds over,
  // uncovering the next recto (U). Back is the mirror image. S is the page that stays flat on the other side.
  function begin(d, cy, peek = false) {
    const v = view;
    const ix = d > 0 ? [rightOf(v), leftOf(v + 1), rightOf(v + 1), leftOf(v)] : [leftOf(v), rightOf(v - 1), leftOf(v - 1), rightOf(v)];
    const [V, O, U, S] = ix.map((i) => (i >= 0 ? leaves[i] : null));
    ix.forEach((i) => { if (i >= 0) { load(i); const img = leaves[i].querySelector('img'); if (img) img.loading = 'eager'; } }); // a lazy image clipped to nothing would never load
    leaves.forEach((leaf) => leaf.classList.toggle('is-shown', leaf === V || leaf === O || leaf === U || leaf === S));
    if (U) { U.style.zIndex = 1; U.style.transform = `translateX(${slotX(ix[2])}px)`; U.style.clipPath = ''; }
    if (S) S.style.zIndex = 1;
    V.style.zIndex = 2;
    if (O) { O.style.zIndex = 4; O.style.clipPath = NONE; }
    turn = { d, c: { x: d * W, y: cy }, p: { x: d * W, y: cy }, V, O, U, S, raf: 0, target: null, peek };
    book.classList.add('is-turning');
  }

  // The corner stays attached: no further than a page width from the spine at its own edge, nor than the diagonal
  // from the spine's other end, and never past its own edges outward.
  function constrain(p) {
    const t = turn;
    let x = t.d > 0 ? Math.min(p.x, W) : Math.max(p.x, -W);
    let y = t.c.y === 0 ? Math.max(p.y, 0) : Math.min(p.y, H);
    for (const [ay, r] of [[t.c.y, W], [H - t.c.y, Math.hypot(W, H)]]) {
      const dy = y - ay, len = Math.hypot(x, dy);
      if (len > r) { x = (x / len) * r; y = ay + (dy / len) * r; }
    }
    return { x, y };
  }

  // Draw the fold for the corner at p. The fold line is the perpendicular bisector of the corner's rest position and p;
  // the part of the page past it is reflected over it, showing the page's back, and the page beneath shows through.
  function render(p) {
    const t = turn;
    p = constrain(p);
    t.p = p;
    const { c, V, O } = t;
    const oxV = t.d > 0 ? 0 : -W, oxO = t.d > 0 ? -W : 0;
    const dx = p.x - c.x, dy = p.y - c.y, len = Math.hypot(dx, dy);
    V.style.transform = `translateX(${oxV}px)`;
    if (len < 0.5) {
      V.style.clipPath = '';
      if (O) O.style.clipPath = NONE;
      cast.style.clipPath = gloss.style.clipPath = NONE;
      return;
    }
    const nx = dx / len, ny = dy / len, mx = (c.x + p.x) / 2, my = (c.y + p.y) / 2;
    const h = (q) => (q[0] - mx) * nx + (q[1] - my) * ny;
    const rect = [[oxV, 0], [oxV + W, 0], [oxV + W, H], [oxV, H]];
    const front = cut(rect, h, 1), fold = cut(rect, h, -1);
    const flap = fold.map((q) => { const k = 2 * h(q); return [q[0] - k * nx, q[1] - k * ny]; });

    V.style.clipPath = poly(front, -oxV);
    if (O) {
      // O's own frame maps onto the sheet by mirroring it across the spine, then across the fold line.
      const k = 2 * (mx * nx + my * ny);
      const a = -(1 - 2 * nx * nx), b = 2 * nx * ny, cc = -2 * nx * ny, dd = 1 - 2 * ny * ny;
      const e = -oxO * (1 - 2 * nx * nx) + k * nx, f = 2 * oxO * nx * ny + k * ny;
      O.style.transform = `matrix(${a}, ${b}, ${cc}, ${dd}, ${e}, ${f})`;
      O.style.clipPath = poly(fold.map((q) => [-q[0] - oxO, q[1]]), 0);
    }

    // The light comes in as the page lifts and goes as it lands.
    const prog = clamp((t.d * (c.x - p.x)) / (2 * W), 0, 1);
    const k = Math.min(1, len / 24) * Math.min(1, (1 - prog) * 2.4);
    const reach = Math.max(1, ...fold.map((q) => -h(q)));
    cast.style.clipPath = poly(fold, W);
    cast.style.background = band(-nx, -ny, mx + W, my, [[ink(0.34 * k), 0], [ink(0.12 * k), reach * 0.18], [ink(0), Math.min(reach * 0.6, W * 0.5)]]);
    gloss.style.clipPath = poly(flap, W);
    gloss.style.background = band(nx, ny, mx + W, my, [[ink(0.22 * k), 0], [ink(0), reach * 0.06], [light(0.22 * k), reach * 0.16], [light(0), reach * 0.42], [ink(0.08 * k), reach]]);
  }

  // A clip-path polygon from points, moved ox along x into an element's own frame.
  function poly(pts, ox) {
    return pts.length < 3 ? NONE : `polygon(${pts.map((q) => `${(q[0] + ox).toFixed(2)}px ${q[1].toFixed(2)}px`).join(', ')})`;
  }

  // A linear gradient along (ux, uy) whose stops sit px from the point (x0, y0), in the 2W x H light boxes.
  function band(ux, uy, x0, y0, stops) {
    const th = Math.atan2(ux, -uy);
    const half = (Math.abs(2 * W * Math.sin(th)) + Math.abs(H * Math.cos(th))) / 2;
    const at = (x0 - W) * ux + (y0 - H / 2) * uy + half;
    return `linear-gradient(${((th * 180) / Math.PI).toFixed(2)}deg, ${stops.map(([col, off]) => `${col} ${(at + off).toFixed(1)}px`).join(', ')})`;
  }

  function animateTo(tx, ty, dur, ease, lift, done) {
    const t = turn, x0 = t.p.x, y0 = t.p.y, start = performance.now();
    cancelAnimationFrame(t.raf);
    const up = t.c.y === 0 ? 1 : -1; // a bottom corner rises as it travels over, a top corner dips
    const step = (now) => {
      const q = Math.min(1, (now - start) / dur), e = ease(q);
      render({ x: x0 + (tx - x0) * e, y: y0 + (ty - y0) * e + up * lift * Math.sin(Math.PI * e) });
      if (q < 1) t.raf = requestAnimationFrame(step); else { t.raf = 0; done(); }
    };
    t.raf = requestAnimationFrame(step);
  }

  // Finish a lifted page: over to the other side, or back down flat. v is the release speed in px/ms, handed to the
  // curve: ease-out starts at 1/0.23 of its average speed, so this duration continues the finger's speed.
  function settle(complete, v = 0, ease = easeOut, dur = 0) {
    const t = turn;
    t.target = complete;
    const tx = complete ? -t.c.x : t.c.x, ty = t.c.y;
    const dist = Math.hypot(tx - t.p.x, ty - t.p.y);
    if (dist < 0.5) { finish(complete); return; }
    if (!dur) dur = v > 0.05 ? clamp(dist / v / 0.23, 260, 560) : complete ? 520 : 300;
    animateTo(tx, ty, dur, ease, complete ? H * 0.09 * Math.min(1, dist / (2 * W)) : 0, () => finish(complete));
  }

  function finish(complete) {
    const t = turn;
    if (!t) return;
    cancelAnimationFrame(t.raf);
    turn = null;
    book.classList.remove('is-turning');
    if (complete) view += t.d;
    layout();
    if (complete || !t.peek) paint();
  }

  // Nothing travels under reduced motion: the spread fades through to the next one.
  function crossfade(change) {
    if (fading) { change(); return; }
    fading = true;
    const out = spread.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 90, easing: 'ease', fill: 'forwards' });
    out.onfinish = () => {
      change();
      out.cancel();
      spread.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: EASE_OUT }).onfinish = () => { fading = false; };
    };
  }

  // Taps and keys. animate=false for keyboard: the change is instant.
  function go(d, animate = true) {
    if (turn) finish(turn.target === true);
    noteTouch();
    if (!can(d)) return;
    if (!animate) { view += d; layout(); paint(); return; }
    if (reduced.matches) { crossfade(() => { view += d; layout(); paint(); }); return; }
    begin(d, H);
    settle(true, 0, easeInOut, 640);
  }

  function jump(v) {
    if (turn) finish(false);
    noteTouch();
    view = clamp(v, 0, LASTV);
    layout();
    paint();
  }

  // The quiet caption under the issue: the section and the page numbers in view. The closed cover says nothing until
  // the issue has been opened once; the pages themselves are the invitation.
  function paint() {
    const l = leftOf(view), r = rightOf(view);
    capEl.textContent = '';
    if (view === 0) {
      live.textContent = touched ? `Cover, page 1 of ${COUNT}` : '';
      if (touched) capEl.append(el('b', null, 'Cover'));
      return;
    }
    const seen = (narrow.matches && r >= 0 ? [r] : [l, r]).filter((i) => i >= 0 && i < COUNT);
    if (!seen.length) { capEl.append(el('b', null, 'Back cover')); live.textContent = 'Back cover'; return; }
    const nums = seen.map((i) => i + 1);
    const withBack = r === COUNT && !narrow.matches;
    const label = seen.map((i) => INFO[i].label).reverse().find(Boolean) || '';
    const range = nums.join('–'), many = nums.length > 1 ? 's' : '';
    capEl.append(el('b', null, label || `Page${many} ${range}`), el('span', 'pager__count', label ? `${range} / ${COUNT}` : `of ${COUNT}`));
    live.textContent = `Page${many} ${nums.join(' and ')} of ${COUNT}${label ? ', ' + label : ''}${withBack ? ', and the back cover' : ''}`;
  }

  function noteTouch() {
    if (touched) return;
    touched = true;
    clearTimeout(inviteTimer);
  }

  again.addEventListener('click', () => { jump(0); book.focus({ preventScroll: true }); });

  book.addEventListener('keydown', (e) => {
    if (e.target !== book) return;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'PageDown') { e.preventDefault(); go(1, false); }
    else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); go(-1, false); }
    else if (k === 'Home') { e.preventDefault(); jump(0); }
    else if (k === 'End') { e.preventDefault(); jump(LASTV); }
  });

  // A pointer in the spread's own frame: the spine is x = 0 and the top of the page y = 0.
  function local(e) {
    const r = spread.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // Dragging. One pointer only; the browser keeps vertical scrolling (touch-action: pan-y). The corner nearest where
  // you took hold follows your finger; let go past a third of the way or with a flick and the page turns over.
  book.addEventListener('pointerdown', (e) => {
    if (drag || fading || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (e.target.closest('a, button')) return;
    let caught = null;
    if (turn) { cancelAnimationFrame(turn.raf); turn.raf = 0; caught = turn; } // catch the page where it is
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, at: local(e), on: false, caught, edge: 0, samples: [[e.clientX, e.timeStamp]] };
  });

  book.addEventListener('pointermove', (e) => {
    if (!drag) { hover(e); return; }
    if (e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.on) {
      if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(dy) * 0.9) return;
      drag.on = true;
      noteTouch();
      try { book.setPointerCapture(e.pointerId); } catch (er) { /* pointer already gone */ }
      book.classList.add('is-dragging');
      if (reduced.matches) { drag.still = true; if (drag.caught) finish(false); }
      else if (drag.caught) { drag.base = { ...drag.caught.p }; drag.caught.peek = false; }
      else if (can(dx < 0 ? 1 : -1)) { begin(dx < 0 ? 1 : -1, drag.at.y < H / 2 ? 0 : H); drag.base = { ...turn.c }; }
      else drag.edge = dx < 0 ? -1 : 1; // nothing that way: the spread gives a little, then settles
    }
    drag.samples.push([e.clientX, e.timeStamp]);
    if (drag.samples.length > 6) drag.samples.shift();
    if (drag.still) return;
    if (drag.edge) {
      spread.style.translate = `${(Math.sign(dx) * Math.min(14, Math.sqrt(Math.abs(dx)) * 1.4)).toFixed(1)}px 0`;
      return;
    }
    render({ x: drag.base.x + dx, y: drag.base.y + dy });
  });

  function release(e, cancelled) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    book.classList.remove('is-dragging');
    if (d.edge) {
      const from = spread.style.translate;
      spread.style.translate = '';
      if (from && !reduced.matches) spread.animate([{ translate: from }, { translate: '0 0' }], { duration: 260, easing: EASE_OUT });
      return;
    }
    const [x0, t0] = d.samples[0], [x1, t1] = d.samples[d.samples.length - 1];
    const v = (x1 - x0) / Math.max(1, t1 - t0); // px/ms, negative is leftwards
    if (d.still) { // reduced motion: a swipe fades through to the next spread
      const dx = x1 - d.x;
      if (Math.abs(v) > 0.11 || Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
      return;
    }
    if (!d.on) {
      if (d.caught && (cancelled || !d.caught.peek)) { settle(d.caught.target === true); return; }
      if (cancelled) return;
      go(d.at.x >= 0 ? 1 : -1); // a tap: the right-hand page turns forward, the left-hand page back
      return;
    }
    if (!turn) return;
    const toward = -turn.d * v;
    const prog = (turn.d * (turn.c.x - turn.p.x)) / (2 * W);
    settle(toward > 0.11 || (toward > -0.11 && prog > 0.3), Math.abs(v));
  }
  book.addEventListener('pointerup', (e) => release(e, false));
  book.addEventListener('pointercancel', (e) => release(e, true));
  book.addEventListener('dragstart', (e) => e.preventDefault());

  // A mouse near a page's outer corner picks it up: the corner peels toward the pointer, an invitation to pull.
  function hover(e) {
    if (e.pointerType !== 'mouse' || e.buttons || !fine.matches || reduced.matches || fading) return;
    if (turn && !turn.peek) return;
    const q = local(e), R = Math.min(W, H) * 0.3;
    let best = null;
    for (const d of [1, -1]) {
      if (!can(d)) continue;
      for (const cy of [0, H]) {
        const dist = Math.hypot(q.x - d * W, q.y - cy);
        if (dist < R && (!best || dist < best.dist)) best = { d, cy, dist };
      }
    }
    if (!best) { retract(); return; }
    noteTouch();
    if (turn && (turn.d !== best.d || turn.c.y !== best.cy)) finish(false);
    if (!turn) begin(best.d, best.cy, true);
    cancelAnimationFrame(turn.raf); turn.raf = 0;
    const c = turn.c, min = W * 0.07;
    let vx = q.x - c.x, vy = q.y - c.y;
    const len = Math.hypot(vx, vy);
    if (len < min) { vx = -best.d * min * 0.8; vy = (best.cy ? -1 : 1) * min * 0.6; }
    render({ x: c.x + vx, y: c.y + vy });
  }
  function retract() {
    if (!turn || !turn.peek || turn.raf) return;
    const t = turn;
    animateTo(t.c.x, t.c.y, 240, easeOut, 0, () => { if (turn === t) finish(false); });
  }
  book.addEventListener('pointerleave', (e) => { if (!drag && e.pointerType === 'mouse') retract(); });

  // The invitation: while nobody has touched the issue, the right-hand page's bottom corner lifts a little and lies
  // back down, a few seconds apart, three times at most. Never under reduced motion, never hidden or scrolled away.
  let inviteTimer = 0, invites = 0, inView = false;
  function invite() {
    if (touched || turn || drag || fading || reduced.matches || document.hidden || !inView || !can(1)) return;
    invites++;
    begin(1, H, true);
    const t = turn;
    t.invite = true;
    book.dataset.invited = String(invites);
    animateTo(t.c.x - W * 0.15, t.c.y - H * 0.075, 760, easeInOut, 0, () => {
      setTimeout(() => {
        if (turn !== t || t.raf || drag) return;
        animateTo(t.c.x, t.c.y, 680, easeInOut, 0, () => { if (turn === t) finish(false); });
      }, 220);
    });
    if (invites < 3) inviteTimer = setTimeout(invite, 7000);
  }
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      inView = entries.some((x) => x.isIntersecting);
      clearTimeout(inviteTimer);
      if (inView && !touched && invites < 3) inviteTimer = setTimeout(invite, invites ? 4000 : 1400);
    }, { threshold: 0.6 });
    io.observe(book);
  }

  let resizeRaf = 0;
  addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => { if (turn) finish(turn.target === true); measure(); layout(); paint(); });
  });

  measure();
  layout();
  paint();
  pager.classList.add('is-ready');
}

/** Sutherland-Hodgman: the part of a convex polygon where sign * h(point) >= 0. */
function cut(pts, h, sign) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const ha = sign * h(a), hb = sign * h(b);
    if (ha >= 0) out.push(a);
    if ((ha >= 0) !== (hb >= 0)) { const t = ha / (ha - hb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}

/** A CSS cubic-bezier as a function of progress, for the turns drawn frame by frame. */
function bezier(x1, y1, x2, y2) {
  const f = (t, a, b) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0, hi = 1, t = x;
    for (let i = 0; i < 24; i++) { t = (lo + hi) / 2; if (f(t, x1, x2) < x) lo = t; else hi = t; }
    return f(t, y1, y2);
  };
}

/** The Kindle beat: the issue's last page on e-ink (the cover if meta.json didn't load). One refresh when it's seen. */
function setUpEink(L, m) {
  const screen = document.querySelector('[data-eink]');
  if (!screen) return;
  const p = m ? m.pages : 1;
  const src = m ? pageSrc(c, m, p, false) : L.cover_image ? issueDir(c, L.issue) + L.cover_image : '';
  if (!src) return;
  const heads = m ? m.articles.filter((a) => a.page === p).map((a) => a.headline).filter(Boolean) : [];
  const img = el('img'); // the screen is a blank e-ink grey until there's a page to show
  img.width = 1200; img.height = 1697; img.loading = 'lazy'; img.decoding = 'async';
  img.alt = `${p === 1 ? 'The cover' : `Page ${p}`} of Issue ${L.issue} on a Kindle screen${heads.length ? ': ' + heads.join('. ') : ''}`;
  img.addEventListener('error', () => img.remove());
  img.src = src;
  screen.append(img);
  if (reduced.matches || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    if (entries.some((x) => x.isIntersecting)) { screen.classList.add('is-refreshing'); io.disconnect(); }
  }, { threshold: 0.6 });
  io.observe(screen);
}
