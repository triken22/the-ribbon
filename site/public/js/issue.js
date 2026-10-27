import { chrome } from './chrome.js';
import { el, issueDir, loadMeta, pageSrc, sectionOf, sourceChip, fileSize } from './data.js';
import { readHref, issueHref, shortTitle, numbered, dateline, coverBox, pdfLink, pdfFiles, state, tryAgain, settle } from './parts.js';

// Issue page: the same lead as the front page, then the contents by section, the pages, printing, and the neighbouring issues.
const main = document.getElementById('main');
const c = await chrome();
const n = +new URLSearchParams(location.search).get('n');
const idx = c.issues.findIndex((i) => i.issue === n);
const lead0 = () => document.getElementById('lead');
const SIZES = '(max-width: 720px) min(10.5rem, 44vw), min(24rem, 38vw)';

function notFound() {
  document.title = 'Not on the shelf — The Ribbon';
  const a = el('a', 'btn', 'Back to the library'); a.href = '/library/';
  state(lead0(), { level: 1, heading: 'That issue doesn’t exist', text: 'The link may be old, or the issue hasn’t been published yet.', action: a });
}
const failed = () => state(lead0(), { level: 1, heading: 'The issue didn’t load', text: 'Something went wrong fetching it. Check your connection, then try again.', action: tryAgain(() => location.reload()) });

function block(id, heading, link) {
  const s = el('section', 'block'); s.id = id; s.setAttribute('aria-labelledby', id + '-h');
  const h = el('h2', null, heading); h.id = id + '-h';
  if (link) { const head = el('div', 'block-head'); head.append(h, link); s.append(head); } else s.append(h);
  return s;
}
const textlink = (text, href) => { const a = el('a', 'textlink', text); a.href = href; return a; };

function lead(it, m) {
  const art = el('article', 'lead'); art.id = 'lead'; art.setAttribute('aria-labelledby', 'lead-h');
  const cv = el('a', 'lead-cover'); cv.href = readHref(n); cv.tabIndex = -1; // "Read online" is the keyboard route
  cv.append(coverBox(c, it, { m, sizes: SIZES, hero: true, alt: `Cover of Issue ${n}` + (m.cover_headline ? `: ${m.cover_headline}` : '') }));
  const body = el('div', 'lead-body');
  const h = el('h1', 'lead-title', shortTitle(it)); h.id = 'lead-h';
  body.append(h);
  if (m.cover_headline) body.append(el('p', 'lead-deck', m.cover_headline));
  body.append(dateline('p', 'dateline', it, [`${m.pages} pages`, 'A4']));
  const { colour, grey } = pdfFiles(m), dir = issueDir(c, n);
  const acts = el('div', 'lead-actions');
  acts.append(...[colour && pdfLink('btn', 'Read colour PDF', dir + colour), grey && pdfLink('btn ghost', 'Greyscale PDF', dir + grey)].filter(Boolean));
  if (acts.children.length < 2) acts.classList.add('one');
  const links = el('p', 'lead-links'); links.append(textlink('Read online', readHref(n)), textlink('Print at home', '#print'));
  body.append(acts, links);
  art.append(body, cv);
  lead0().replaceWith(art);
  settle(cv, body);
}

function contents(m) {
  const s = block('contents', 'Contents', textlink('Open the reader', readHref(n)));
  const toc = el('ol', 'toc');
  let group = null, last = null;
  for (const a of [...m.articles].sort((x, y) => x.page - y.page)) {
    if (a.section !== last || !group) {
      const li = el('li', 'toc-sec'); li.append(el('span', 'toc-name', sectionOf(m, a.section)));
      group = el('ol', 'toc-list'); li.append(group); toc.append(li); last = a.section;
    }
    const item = el('li', 'toc-item');
    const p = el('span', 'toc-p'); p.append(el('span', 'sr', 'Page '), String(a.page));
    const b = el('div', 'toc-b'); const t = el('a', 'toc-t', a.headline); t.href = readHref(n, a.page); b.append(t);
    if (a.kind === 'cover' || a.sources.length) {
      const meta = el('div', 'toc-meta');
      if (a.kind === 'cover') meta.append(el('span', null, 'Cover story'));
      a.sources.forEach((x) => meta.append(sourceChip(x)));
      b.append(meta);
    }
    item.append(p, b); group.append(item);
  }
  s.append(toc);
  return s;
}

function credits(m) { // at the end of the page, where a magazine keeps its picture credits
  if (!m.image_credits.length) return null;
  const s = block('credits', 'Image credits');
  const p = el('p', 'credits', m.image_credits.join(' ')); s.append(p);
  return s;
}

function pages(m) {
  const s = block('pages', 'Pages');
  const grid = el('div', 'pgrid');
  for (let p = 1; p <= m.pages; p++) {
    const a = el('a', 'pg'); a.href = readHref(n, p); a.setAttribute('aria-label', `Open page ${p} in the reader`);
    const w = el('div', 'cover'); const im = el('img'); im.alt = ''; im.loading = 'lazy'; im.decoding = 'async'; im.src = pageSrc(c, m, p, true);
    im.width = 400; im.height = 566; im.dataset.loading = '';
    im.addEventListener('load', () => im.removeAttribute('data-loading'));
    im.addEventListener('error', () => { w.classList.add('ph'); im.remove(); });
    w.append(im); a.append(w, el('span', null, String(p))); grid.append(a);
  }
  s.append(grid);
  return s;
}

function print(m) {
  const s = block('print', 'Print at home');
  const body = el('div', 'block-body');
  const specs = el('dl', 'specs');
  [['Paper', 'A4'], ['Binding', 'Saddle-stitched'], ['Inside pages', '100 g'], ['Cover', '200 g']].forEach(([k, v]) => { const d = el('div'); d.append(el('dt', null, k), el('dd', null, v)); specs.append(d); });
  const how = el('p', 'print-how', 'Print as a booklet on four A3 sheets, the cover sheet on 200 g. Flip on the short edge, fold, and staple twice along the spine.');
  const files = el('ul', 'files'), dir = issueDir(c, n), { colour, grey } = pdfFiles(m);
  for (const [label, file] of [['Greyscale print edition', grey], ['Colour edition', colour]]) {
    if (!file) continue;
    const li = el('li', 'file'); const a = el('a', 'textlink', label); a.href = dir + file; a.setAttribute('download', file);
    const size = el('span', 'size'); fileSize(dir + file).then((v) => { size.textContent = v; });
    const name = el('span', 'name'); name.append(a, size);
    li.append(name, el('code', null, file)); files.append(li);
  }
  body.append(specs, how, files); s.append(body);
  return s;
}

function others() {
  const near = [c.issues[idx - 1], c.issues[idx + 1]].filter(Boolean); // the later and the earlier issue, newest first
  if (!near.length) return null;
  const s = block('others', 'Other issues', textlink('All issues in the library', '/library/')); s.classList.add('heavy');
  const ol = el('ol', 'index');
  for (const i of near) {
    const a = el('a', 'entry'); a.href = issueHref(i.issue);
    a.append(el('span', 'entry-title', shortTitle(i)), dateline('span', 'entry-meta facts', i));
    const li = el('li'); li.append(a); ol.append(li);
  }
  s.append(ol);
  return s;
}

if (c.failed) failed();
else if (idx < 0) notFound();
else {
  const it = c.issues[idx], m = await loadMeta(c, n);
  if (!m) { c.metas.delete(n); failed(); } else {
    document.title = `${numbered(it) ? '' : `No. ${n}: `}${shortTitle(it)} — The Ribbon`;
    lead(it, m);
    const rest = el('div', 'fadein'); rest.append(...[contents(m), pages(m), print(m), others(), credits(m)].filter(Boolean));
    main.append(rest);
  }
}
main.removeAttribute('aria-busy');
