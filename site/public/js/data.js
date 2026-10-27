// Data layer: manifest + per-issue meta, allowlist sanitising, source-credit component.
// Everything from meta.json is rendered as plain text (textContent / attributes), never as HTML.

const X_URL = /^https:\/\/x\.com\/([A-Za-z0-9_]{1,15})\/status\/([0-9]{1,25})$/;
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const SLUG = /^[a-z0-9-]{1,40}$/;
// Page images: per-build p-NN.<12 hex>.webp (bookmark publish) or legacy p-NN.webp. Anything else is dropped.
const IMG = /^pages\/p-\d{2,3}(?:\.[0-9a-f]{12})?\.webp$/;
const THUMB = /^pages\/thumbs\/p-\d{2,3}(?:\.[0-9a-f]{12})?\.webp$/;
const imgOr = (re, v) => (re.test(String(v || '')) ? String(v) : '');
/** files.pages / files.thumbs from meta.json: kept only if there is exactly one well-formed name per page, in page order. */
const imageList = (re, list, pages, sub) => (Array.isArray(list) && list.length === pages &&
  list.every((x, k) => re.test(String(x)) && String(x).startsWith(`${sub}p-${String(k + 1).padStart(2, '0')}.`)) ? list.map(String) : null);

export const pad = (n) => String(n).padStart(3, '0');
export const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const fmt = (opts) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...opts });
export const dateLong = (d) => fmt({ day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(d + 'T00:00:00Z'));
export const dateShort = (d) => fmt({ day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d + 'T00:00:00Z'));
export const dateDM = (d) => fmt({ day: 'numeric', month: 'short' }).format(new Date(d + 'T00:00:00Z'));

let ctx;
async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-cache', credentials: 'omit' });
  if (!r.ok) throw Object.assign(new Error(url + ' ' + r.status), { status: r.status });
  return r.json();
}

/** Load the issue index from /manifest.json. A missing, empty or malformed manifest is a calm "no issues yet" state, never an error.
 *  `failed` is set only when the request itself failed (network error or a 5xx), so a page can offer to try again. */
export async function init() {
  if (ctx) return ctx;
  let raw = null, failed = false;
  try { raw = await getJSON('/manifest.json'); } catch (e) { raw = null; failed = e instanceof TypeError || e.status >= 500; }
  if (!raw || typeof raw !== 'object') raw = {};
  const issues = (Array.isArray(raw.issues) ? raw.issues : [])
    .map((i) => ({ issue: +i.issue, title: String(i.title || ''), date: String(i.date || ''), pages: +i.pages || 16, cover_image: imgOr(IMG, i.cover_image), cover_thumb: imgOr(THUMB, i.cover_thumb) }))
    .filter((i) => Number.isInteger(i.issue) && i.issue > 0 && /^\d{4}-\d{2}-\d{2}$/.test(i.date))
    .sort((a, b) => b.issue - a.issue); // newest first
  ctx = { base: '/', example: false, issues, metas: new Map(), failed };
  return ctx;
}

export const issueDir = (c, n) => `${c.base}issues/${pad(n)}/`;
export const coverSrc = (c, i) => issueDir(c, i.issue) + i.cover_image;
export const thumbOf = (rel) => rel.replace(/([^/]+)$/, 'thumbs/$1');
/** Cover thumbnail of a manifest entry: its own per-build name if published with one, else the legacy thumbs/ twin of the cover. */
export const coverThumb = (i) => i.cover_thumb || thumbOf(i.cover_image);

export function sanitiseSource(s) {
  if (!s || typeof s !== 'object') return null;
  const m = X_URL.exec(String(s.url || ''));
  if (!m || !HANDLE.test(String(s.author_handle || ''))) return null;
  if (m[1].toLowerCase() !== String(s.author_handle).toLowerCase() || m[2] !== String(s.post_id)) return null;
  return { post_id: m[2], url: m[0], author_handle: s.author_handle, author_name: String(s.author_name || '').slice(0, 80), snippet: String(s.snippet || '').slice(0, 200) };
}

function sanitiseMeta(r) {
  const f = r.files || {};
  return {
    issue: +r.issue, title: String(r.title || ''), date: String(r.date || ''), pages: +r.pages || 16,
    cover_headline: String(r.cover_headline || ''), cover_image: imgOr(IMG, r.cover_image),
    qa_verdict: String(r.qa_verdict || ''),
    sections: (r.sections || []).filter((s) => SLUG.test(String(s.slug))).map((s) => ({ slug: s.slug, label: String(s.label || ''), page_start: +s.page_start, page_end: +s.page_end })),
    articles: (r.articles || []).map((a) => ({
      id: String(a.id || ''), headline: String(a.headline || ''), section: String(a.section || ''), page: +a.page || 1, kind: String(a.kind || ''),
      sources: (a.sources || []).map(sanitiseSource).filter(Boolean),
    })),
    files: {
      pdf_color: String(f.pdf_color || ''), pdf_grayscale: String(f.pdf_grayscale || ''), pages_dir: String(f.pages_dir || 'pages/'),
      page_count: +f.page_count || +r.pages || 16, sha256: f.sha256 || {},
      pages: imageList(IMG, f.pages, +r.pages || 16, 'pages/'), thumbs: imageList(THUMB, f.thumbs, +r.pages || 16, 'pages/thumbs/'),
    },
    image_credits: (r.image_credits || []).map(String),
  };
}

export async function loadMeta(c, n) {
  if (!c.metas.has(n)) c.metas.set(n, getJSON(issueDir(c, n) + 'meta.json').then(sanitiseMeta).catch(() => null));
  return c.metas.get(n);
}

export const pageSrc = (c, m, p, thumb) => {
  const list = thumb ? m.files.thumbs : m.files.pages;
  if (list && m.files.pages && m.files.thumbs && list[p - 1]) return issueDir(c, m.issue) + list[p - 1]; // per-build name from meta.json
  const d = m.files.pages_dir.replace(/^\/+/, '').replace(/\.\./g, '');
  return issueDir(c, m.issue) + d + (thumb ? 'thumbs/' : '') + `p-${String(p).padStart(2, '0')}.webp`;
};
export const sectionOf = (m, slug) => (m.sections.find((s) => s.slug === slug) || {}).label || '';

const sizeCache = new Map();
/** File size via HEAD (no size key in meta.json by design). Resolves "19.0 MB" or "". */
export function fileSize(url) {
  if (!sizeCache.has(url)) {
    sizeCache.set(url, fetch(url, { method: 'HEAD', credentials: 'omit' }).then((r) => {
      const n = +r.headers.get('content-length');
      return r.ok && n ? (n / 1048576).toFixed(1) + ' MB' : '';
    }).catch(() => ''));
  }
  return sizeCache.get(url);
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Line icon on a 24px grid, stroked in currentColor (authored paths, no icon font, no glyphs). */
export function icon(d, size = 18, sw = 1.7) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', sw); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'path'); p.setAttribute('d', d); s.append(p); return s;
}
const OUT = 'M14 5h5v5M19 5l-8 8M17 14v5H5V7h5'; // opens elsewhere

let uid = 0;
/** Source credit: visible "@handle Source" chip (one tap/click opens the post) + hover/focus card. */
export function sourceChip(s) {
  const wrap = el('span', 'src');
  const a = el('a');
  a.href = s.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  a.setAttribute('aria-label', `Source: post by @${s.author_handle} on X`);
  const h = el('span', 'h', '@' + s.author_handle); // visible text: @handle, then "Source" and an open-elsewhere icon
  a.append(h, el('span', 'go2', 'Source'), icon(OUT, 13, 1.8));
  const card = el('span', 'src-card'); card.id = 'src-' + (++uid);
  const au = el('span', 'au'); au.append(el('span', null, s.author_name || '@' + s.author_handle), el('span', 'hd', '@' + s.author_handle));
  const go = el('span', 'go', 'Open on X'); go.append(icon(OUT, 13, 1.8));
  card.append(au, el('span', 'sn', s.snippet), go);
  a.setAttribute('aria-describedby', card.id);
  card.setAttribute('role', 'tooltip');
  wrap.append(a, card);
  // The card is position:fixed (so scrolling bars can't clip it); place it under the chip, or above if there's no room.
  const place = () => {
    const r = a.getBoundingClientRect(), w = Math.min(320, innerWidth - 32);
    card.style.width = w + 'px';
    const left = Math.max(16, Math.min(r.left, innerWidth - w - 16));
    const h = card.offsetHeight || 170;
    const top = r.bottom + 8 + h > innerHeight && r.top - 8 - h > 0 ? r.top - 8 - h : r.bottom + 8;
    card.style.left = left + 'px'; card.style.top = top + 'px';
    // Safety net: if some ancestor ever becomes the containing block for fixed elements (transform, filter, will-change),
    // measure where the card actually landed and correct by the difference. Viewport coordinates only; scroll is never added.
    const k = card.getBoundingClientRect();
    if (Math.abs(k.left - left) > 1 || Math.abs(k.top - top) > 1) { card.style.left = (left - (k.left - left)) + 'px'; card.style.top = (top - (k.top - top)) + 'px'; }
  };
  wrap.addEventListener('mouseenter', () => { card.style.display = 'block'; place(); });
  wrap.addEventListener('mouseleave', () => { if (!wrap.contains(document.activeElement)) card.style.display = ''; });
  a.addEventListener('focus', () => { card.style.display = 'block'; place(); });
  a.addEventListener('blur', () => { card.style.display = ''; });
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') { card.style.display = ''; } });
  return wrap;
}
