import { chrome } from './chrome.js';
import { el, dateShort, issueDir, loadMeta, fileSize } from './data.js';
import { readHref, issueHref, shortTitle, dateline, coverBox, pdfFiles, state, tryAgain } from './parts.js';

// Library: every issue, newest first, with search, year/section filters, an edition switch and a covers/list view.
const main = document.getElementById('main');
const c = await chrome();
const st = { q: '', year: 'all', secs: new Set(), ed: 'colour', view: 'grid' };
const $ = (id) => document.getElementById(id);
const metas = new Map(); // issue -> meta; all loaded up front for search and the section filter
await Promise.all(c.issues.map(async (i) => { metas.set(i.issue, await loadMeta(c, i.issue)); })); // a handful of small JSON files; revisit with a search index past ~100 issues

const years = [...new Set(c.issues.map((i) => i.date.slice(0, 4)))].sort().reverse();
const secMap = new Map();
metas.forEach((m) => m && m.sections.forEach((s) => secMap.set(s.slug, s.label)));
const plural = (k, one, many) => `${k} ${k === 1 ? one : many}`;

function chip(parent, label, pressed, on, count) {
  const b = el('button', 'chip'); b.type = 'button'; b.setAttribute('aria-pressed', String(pressed)); b.append(label);
  if (count != null) b.append(el('span', 'n', String(count)));
  b.addEventListener('click', on); parent.append(b);
}
function drawFilters() {
  const y = $('years'); y.replaceChildren();
  chip(y, 'All years', st.year === 'all', () => { st.year = 'all'; render(); }, c.issues.length);
  years.forEach((v) => chip(y, v, st.year === v, () => { st.year = v; render(); }, c.issues.filter((i) => i.date.startsWith(v)).length));
  const s = $('secs'); s.replaceChildren();
  [...secMap].forEach(([slug, label]) => chip(s, label, st.secs.has(slug), () => { st.secs.has(slug) ? st.secs.delete(slug) : st.secs.add(slug); render(); }));
  $('view').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === st.view)));
}
const norm = (s) => s.toLowerCase().replace(/^@/, '');

function match(i) {
  if (st.year !== 'all' && !i.date.startsWith(st.year)) return null;
  const m = metas.get(i.issue);
  if (st.secs.size && !(m && [...st.secs].every((s) => m.sections.some((x) => x.slug === s)))) return null;
  const q = st.q.trim().toLowerCase();
  if (!q) return { i, hit: null };
  const head = `${i.title} no. ${i.issue} ${m ? m.cover_headline : ''}`.toLowerCase();
  if (head.includes(q)) return { i, hit: null };
  if (m) {
    const a = m.articles.find((a) => a.headline.toLowerCase().includes(q) || a.sources.some((s) => norm(s.author_handle).includes(norm(q)) || s.author_name.toLowerCase().includes(q)));
    if (a) return { i, hit: a };
  }
  return null;
}

// The PDF link follows the edition switch; kept so the switch can update links in place (covers recolour without a rebuild).
let pdfs = [];
function pdfLink(i, m) {
  const w = el('span', 'pdf'); const a = el('a', 'textlink'); const size = el('span', 'size'); w.append(a, size);
  const set = () => {
    const { colour, grey } = pdfFiles(m), file = st.ed === 'grey' ? grey : colour;
    w.hidden = !file; if (!file) return;
    a.href = issueDir(c, i.issue) + file; a.setAttribute('download', file);
    a.textContent = st.ed === 'grey' ? 'Greyscale PDF' : 'Colour PDF'; size.textContent = '';
    fileSize(a.href).then((s) => { if (a.getAttribute('download') === file) size.textContent = s; });
  };
  set(); pdfs.push(set); return w;
}
function links(i, m) {
  const p = el('p', 'card-links'); const r = el('a', 'textlink', 'Read online'); r.href = readHref(i.issue);
  p.append(r); if (m) p.append(pdfLink(i, m)); return p;
}
const deck = (m) => (m && m.cover_headline ? el('p', 'card-deck', m.cover_headline) : null);
function hitLine(hit) { const h = el('p', 'hit'); h.append(el('b', null, `Page ${hit.page}`), hit.headline); return h; }

function card({ i, hit }, k, first) {
  const m = metas.get(i.issue), art = el('article', 'card');
  if (first) { art.classList.add('arrive'); art.style.animationDelay = Math.min(k, 5) * 40 + 'ms'; } // a short stagger, first view only
  const a = el('a', 'card-link'); a.href = issueHref(i.issue);
  a.append(coverBox(c, i, { m, sizes: '(max-width: 720px) 45vw, 260px' }), el('span', 'card-title', shortTitle(i)));
  art.append(a, ...[deck(m), dateline('p', 'facts', i, [`${i.pages} pages`], dateShort), hit && hitLine(hit), links(i, m)].filter(Boolean));
  return art;
}
function row({ i, hit }, k, first) {
  const m = metas.get(i.issue), li = el('li', 'lrow');
  if (first) { li.classList.add('arrive'); li.style.animationDelay = Math.min(k, 5) * 40 + 'ms'; }
  const th = el('a', 'lrow-thumb'); th.href = issueHref(i.issue); th.tabIndex = -1; th.setAttribute('aria-hidden', 'true');
  th.append(coverBox(c, i, { m, sizes: '72px' }));
  const b = el('div', 'lrow-body'); const t = el('a', 'lrow-title', shortTitle(i)); t.href = issueHref(i.issue);
  b.append(...[t, deck(m), dateline('p', 'facts', i, [`${i.pages} pages`], dateShort), hit && hitLine(hit), links(i, m)].filter(Boolean));
  li.append(th, b); return li;
}

let drawn = false;
function render() {
  drawFilters();
  const rs = c.issues.map(match).filter(Boolean);
  const dirty = !!st.q.trim() || st.year !== 'all' || st.secs.size > 0;
  $('clear').hidden = !dirty;
  $('count').textContent = rs.length === c.issues.length ? (rs.length === 1 ? 'Showing 1 issue' : `Showing all ${rs.length} issues`) : `Showing ${rs.length} of ${plural(c.issues.length, 'issue', 'issues')}`;
  const out = $('out'); pdfs = [];
  if (!rs.length) {
    const ph = el('div'); out.replaceChildren(ph);
    const b = el('button', 'btn ghost', 'Clear the filters'); b.type = 'button'; b.addEventListener('click', clear);
    state(ph, { heading: 'No issue matches', text: 'Nothing in the library matches those filters.', action: b, arrive: false });
    return;
  }
  const first = !drawn; drawn = true; // filtering and typing re-render instantly; only the first view staggers in
  if (st.view === 'grid') { const g = el('div', 'grid'); rs.forEach((r, k) => g.append(card(r, k, first))); out.replaceChildren(g); }
  else { const l = el('ol', 'list'); rs.forEach((r, k) => l.append(row(r, k, first))); out.replaceChildren(l); }
}
function edition() {
  $('ed').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === st.ed)));
  $('ednote').textContent = st.ed === 'grey' ? 'Greyscale print PDFs: lighter files for home printers.' : 'Colour PDFs: for reading on screen.';
  $('out').classList.toggle('greyed', st.ed === 'grey');
  pdfs.forEach((set) => set());
}
function clear() { st.q = ''; $('q').value = ''; st.year = 'all'; st.secs.clear(); render(); $('q').focus(); }

if (c.failed || !c.issues.length) {
  $('filters').hidden = true; $('rhead').hidden = true;
  const ph = el('div'); $('out').replaceChildren(ph);
  if (c.failed) state(ph, { heading: 'The issues didn’t load', text: 'Something went wrong fetching the list of issues. Check your connection, then try again.', action: tryAgain(() => location.reload()) });
  else state(ph, { heading: 'No issues yet', text: 'Nothing has been published so far.' });
} else {
  $('libcount').append(...[plural(c.issues.length, 'issue', 'issues'), plural(c.issues.reduce((a, i) => a + i.pages, 0), 'page', 'pages'), 'since ' + dateShort(c.issues[c.issues.length - 1].date)].map((t) => el('span', null, t)));
  $('q').addEventListener('input', (e) => { st.q = e.target.value; render(); });
  $('clear').addEventListener('click', clear);
  $('ed').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && b.dataset.v !== st.ed) { st.ed = b.dataset.v; edition(); } });
  $('view').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && b.dataset.v !== st.view) { st.view = b.dataset.v; render(); } });
  $('ftoggle').addEventListener('click', () => { const o = $('filters').classList.toggle('open'); $('ftoggle').setAttribute('aria-expanded', String(o)); });
  render(); edition();
}
main.removeAttribute('aria-busy');
