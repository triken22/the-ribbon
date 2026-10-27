// Shared page parts: the lead (cover, dateline, PDF buttons), the empty/error states, and the lead's entrance.
// Front page and issue page build the same lead, so they read as one publication. See DESIGN.md.
import { el, dateLong, issueDir, coverThumb, fileSize } from './data.js';

export const PDF = /^[a-z0-9-]{1,80}\.pdf$/; // same rule as the publish validator; anything else gets no link
export const readHref = (n, p) => `/read/?n=${n}` + (p > 1 ? `&p=${p}` : '');
export const issueHref = (n) => `/issue/?n=${n}`;
// The masthead already names the paper, so a title that repeats it shows only the rest. Issue 3 was published as
// "The Weekend Bookmark — Issue 3", before the rename to The Ribbon; both names are stripped.
export const shortTitle = (i) => i.title.replace(/^The (?:Ribbon|Weekend Bookmark)\s*[—–:-]\s*/i, '').trim() || i.title || `Issue ${i.issue}`;
export const numbered = (i) => /^Issue\s+\d+$/i.test(shortTitle(i)); // the title already carries the number
export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const pdfFiles = (m) => ({ colour: m && PDF.test(m.files.pdf_color) ? m.files.pdf_color : '', grey: m && PDF.test(m.files.pdf_grayscale) ? m.files.pdf_grayscale : '' });

export function when(d, fmt = dateLong) { const t = el('time', null, fmt(d)); t.dateTime = d; return t; }
/** Row facts: No. (unless the title carries it), the date, then any extras, joined by middle dots in CSS. */
export function dateline(tag, cls, i, extra = [], fmt = dateLong) {
  const p = el(tag, cls);
  if (!numbered(i)) p.append(el('span', null, 'No. ' + i.issue));
  const d = el('span'); d.append(when(i.date, fmt)); p.append(d);
  extra.forEach((x) => p.append(el('span', null, x)));
  return p;
}

/** Cover image at the printed proportion: the 400px thumbnail and the 1200px page image (per-build names from meta.json when
 *  known, else the manifest's), so high-density screens get the sharp one. Fades in once loaded instead of popping. */
export function coverBox(c, i, { m = null, sizes, hero = false, alt = '' } = {}) {
  const box = el('div', 'cover');
  const files = m && m.files.pages && m.files.thumbs ? m.files : null;
  const full = files ? files.pages[0] : i.cover_image;
  if (!full) { box.classList.add('ph'); return box; }
  const dir = issueDir(c, i.issue), thumb = files ? files.thumbs[0] : coverThumb(i);
  const im = el('img');
  im.sizes = sizes; im.srcset = `${dir + thumb} 400w, ${dir + full} 1200w`; im.src = dir + full;
  im.width = 1200; im.height = 1697; im.alt = alt; im.decoding = 'async';
  if (hero) { im.loading = 'eager'; im.setAttribute('fetchpriority', 'high'); } else im.loading = 'lazy';
  im.dataset.loading = '';
  im.addEventListener('load', () => im.removeAttribute('data-loading'));
  im.addEventListener('error', () => { box.classList.add('ph'); im.remove(); });
  box.append(im);
  return box;
}

/** A PDF button that carries its file size. The size slot keeps its width even if the size never arrives, so nothing moves. */
export function pdfLink(cls, label, href) {
  const a = el('a', cls); a.href = href;
  const size = el('span', 'size');
  a.append(el('span', null, label), ' ', size);
  fileSize(href).then((s) => { if (s) size.textContent = s; });
  return a;
}

/** Empty, error and not-found states take the lead's place: a heading, a sentence, and the way out if there is one.
 *  `arrive` settles it in after a fetch; states redrawn while typing (library search) appear instantly. */
export function state(target, { level = 2, heading, text, action = null, arrive = true }) {
  const s = el('section', 'lead lead-state'); s.setAttribute('aria-labelledby', 'lead-h');
  const h = el('h' + level, 'lead-title', heading); h.id = 'lead-h';
  s.append(h, el('p', 'lead-deck', text));
  if (action) s.append(action);
  target.replaceWith(s); s.id = 'lead';
  if (arrive) s.classList.add('arrive');
  return s;
}
export function tryAgain(on) { const b = el('button', 'btn', 'Try again'); b.type = 'button'; b.addEventListener('click', on); return b; }

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)'; // --ease-out in site.css
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** The lead's entrance. The first cover of a visit is set down on the page: it settles 8px onto the paper while its lifted
 *  shadow tightens (450ms, ease-out). After that, and with reduced motion, covers only fade in. The text fades in with it.
 *  Web Animations, so it runs off the main thread while the rest of the page is still loading. */
export function settle(cover, body) {
  let first = true;
  try { first = !sessionStorage.getItem('wb-settled'); sessionStorage.setItem('wb-settled', '1'); } catch (e) { /* storage off: settle every time */ }
  const move = first && !reduced();
  if (body) body.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, delay: move ? 80 : 0, easing: EASE_OUT, fill: 'backwards' });
  const img = cover.querySelector('img');
  cover.style.opacity = '0'; // held until the image has decoded (or 600ms), so the cover arrives whole
  const go = () => {
    cover.style.opacity = '';
    if (!move) { cover.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: EASE_OUT }); return; }
    cover.animate([{ opacity: 0, transform: 'translateY(-8px)' }, { opacity: 1, transform: 'none' }], { duration: 450, easing: EASE_OUT });
    if (cover.matches('a.lead-cover')) cover.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 450, easing: EASE_OUT, pseudoElement: '::after' });
  };
  (img ? Promise.race([img.decode().catch(() => {}), wait(600)]) : Promise.resolve()).then(go);
}
