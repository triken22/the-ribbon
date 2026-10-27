#!/usr/bin/env python3
"""Strip identifying metadata from publish artefacts and audit an issue directory (see docs/PIPELINE-SPEC.md section 4a).

  strip_metadata.py strip <dir>        rewrite PDFs / WebP / PNG / JPEG under <dir> in place without metadata
  strip_metadata.py check <dir>        exit 1 and list files that still carry metadata (or whose magic bytes do not match the extension)
  strip_metadata.py audit <issue-dir>  exit 1 unless the directory contains EXACTLY what meta.json allows (see audit_issue_dir)

File type is decided by magic bytes, never by extension alone: a PDF renamed to .txt is still a PDF to strip/check.
PDF check flags: Info dictionary, XMP /Metadata (catalog or page), /PieceInfo, embedded files (names tree, /EF, FileAttachment),
  JavaScript (/JS, /JavaScript names, JavaScript actions), /OpenAction, /AA, Launch/SubmitForm/ImportData actions, URI actions, and
  every annotation that is not an X status link exactly as strip writes it (see minimal_x_link).
PDF strip: builds fresh pages and clones only geometry/resources/content (no orphaned objects survive): empty Info, no XMP, no names tree, no OpenAction/AA,
  page /Metadata, /PieceInfo and /AA removed, and every annotation dropped EXCEPT /Link annotations whose only action is a URI action to
  https://x.com|twitter.com/<handle>/status/<id> (X_STATUS_URL, full match). Each kept link is rebuilt as a fresh minimal dict
  (/Type /Subtype /Rect /Border [0 0 0] /A << /S /URI /URI >>); nothing else of the source annotation is copied. Stripping strip's
  own output gives byte-identical bytes, so a PDF approved after strip still hashes the same after publish strips it again.
Images (all lossless, pixels untouched): WebP drops EXIF, XMP and ICCP chunks (pages are rendered sRGB) and clears the VP8X flags.
  PNG drops tEXt/zTXt/iTXt (incl. Software), eXIf, iCCP and tIME chunks. JPEG drops APP1 (EXIF/XMP), APP2 (ICC), APP13 and COM
  segments plus other APPn except JFIF (APP0) and Adobe (APP14, colour transform).
Strip BEFORE the SHA-256 values are recorded: stripping changes the bytes. Needs: pypdf.
"""
import json, re, sys
from pathlib import Path
from pypdf import PdfReader, PdfWriter
from pypdf.generic import (ArrayObject, ByteStringObject, DictionaryObject, FloatObject, IndirectObject, NameObject, NumberObject,
                           TextStringObject)

PDF_NAME = re.compile(r'[a-z0-9-]{1,80}\.pdf')  # same limit as the Pages Function route (Codex #4)
# The only annotation a published PDF may keep: a link to one X post. Used with fullmatch, so no query, fragment, userinfo, port,
# other host or scheme, trailing slash or newline.
X_STATUS_URL = re.compile(r'https://(?:x\.com|twitter\.com)/[A-Za-z0-9_]{1,15}/status/[0-9]{1,25}')
X_LINK_KEYS = {'/Type', '/Subtype', '/Rect', '/Border', '/A'}
EXT_KIND = {'.pdf': 'pdf', '.webp': 'webp', '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg'}
PNG_SIG, JPG_SIG = b'\x89PNG\r\n\x1a\n', b'\xff\xd8\xff'
PNG_DROP = {b'tEXt', b'zTXt', b'iTXt', b'eXIf', b'iCCP', b'tIME'}


def magic_kind(p):
    with open(p, 'rb') as f: h = f.read(12)
    if h.startswith(b'%PDF-'): return 'pdf'
    if h[:4] == b'RIFF' and h[8:12] == b'WEBP': return 'webp'
    if h.startswith(PNG_SIG): return 'png'
    if h.startswith(JPG_SIG): return 'jpeg'
    return None


# ---------------------------------------------------------------- PDF
def res(o): return o.get_object() if isinstance(o, IndirectObject) else o


def x_status_url(s):
    """s as str if it is a PDF string holding exactly an X status URL in plain ASCII (no UTF-16), else None."""
    if isinstance(s, TextStringObject): b = s.get_original_bytes()
    elif isinstance(s, ByteStringObject): b = bytes(s)
    else: return None
    try: u = b.decode('ascii')
    except UnicodeDecodeError: return None
    return u if X_STATUS_URL.fullmatch(u) else None


def link_rect(r):
    """The four /Rect numbers as floats, or None (also for NaN, inf or absurdly large values)."""
    r = res(r)
    if not isinstance(r, ArrayObject) or len(r) != 4: return None
    vals = [res(v) for v in r]
    if not all(isinstance(v, (NumberObject, FloatObject)) and abs(v) <= 1e7 for v in vals): return None
    return [float(v) for v in vals]


def keepable_x_link(a):
    """(rect, url) when annotation a is a /Link whose ONLY action is a URI action to an X status URL, else None. Not kept: other
    subtypes, links with /Dest, /AA or /PA, actions other than URI or with extra keys (/Next chains, /IsMap), other URLs, a bad /Rect."""
    a = res(a)
    if not isinstance(a, DictionaryObject) or a.get('/Subtype') != '/Link' or any(k in a for k in ('/AA', '/Dest', '/PA')): return None
    act = res(a.raw_get('/A')) if '/A' in a else None
    if not isinstance(act, DictionaryObject) or act.get('/S') != '/URI' or set(act) - {'/Type', '/S', '/URI'}: return None
    if '/Type' in act and act.get('/Type') != '/Action': return None
    url = x_status_url(res(act.raw_get('/URI'))) if '/URI' in act else None
    rect = link_rect(a.raw_get('/Rect')) if '/Rect' in a else None
    return (rect, url) if url and rect else None


def minimal_x_link(a):
    """True only for an X status link exactly as strip writes it:
    << /Type /Annot /Subtype /Link /Rect [4 numbers] /Border [0 0 0] /A << /S /URI /URI (url) >> >>."""
    a = res(a)
    if not keepable_x_link(a) or set(a) != X_LINK_KEYS or a.get('/Type') != '/Annot': return False
    border = res(a.raw_get('/Border'))
    return (set(res(a.raw_get('/A'))) == {'/S', '/URI'} and isinstance(border, ArrayObject) and len(border) == 3
            and all(isinstance(res(v), (NumberObject, FloatObject)) and res(v) == 0 for v in border))


def annot_problem(a):
    """None for a minimal X status link, else what is wrong with annotation a."""
    a = res(a)
    if minimal_x_link(a): return None
    if keepable_x_link(a): return 'X status link not in minimal form (strip rebuilds it)'
    sub = a.get('/Subtype') if isinstance(a, DictionaryObject) else None
    return f'{sub if isinstance(sub, NameObject) else "malformed"} annotation (only X status links may stay)'


def page_annots(page):
    a = res(page.raw_get('/Annots')) if '/Annots' in page else None
    return list(a) if isinstance(a, ArrayObject) else []


def pdf_x_links(p):
    """[(page number, url)] of the X status links in PDF p that check accepts (what strip keeps)."""
    return [(i, keepable_x_link(a)[1]) for i, page in enumerate(PdfReader(str(p)).pages, 1) for a in page_annots(page) if minimal_x_link(a)]


def pdf_problems(p):
    r = PdfReader(str(p)); out = set()
    info = r.trailer.get('/Info')
    if info is not None and len(info.get_object()):
        out.add('Info: ' + ','.join(sorted(info.get_object().keys())))
    seen, stack = set(), [r.trailer['/Root']]
    while stack:
        o = stack.pop()
        if isinstance(o, IndirectObject):
            if (o.idnum, o.generation) in seen: continue
            seen.add((o.idnum, o.generation))
        o = o.get_object() if hasattr(o, 'get_object') else o
        if isinstance(o, ArrayObject): stack.extend(o)
        elif isinstance(o, DictionaryObject):
            if minimal_x_link(o): continue  # fully validated: two names, numbers, one ASCII X status URL; nothing inside to inspect
            for k, v in o.items():
                if k == '/Metadata': out.add('XMP /Metadata stream')
                elif k == '/PieceInfo': out.add('/PieceInfo')
                elif k == '/EmbeddedFiles' or k == '/EF': out.add('embedded files')
                elif k == '/JS' or k == '/JavaScript': out.add('JavaScript')
                elif k == '/OpenAction': out.add('/OpenAction')
                elif k == '/AA': out.add('/AA (additional actions)')
                elif k == '/Names' and isinstance(v.get_object(), DictionaryObject): pass
                elif k == '/Annots':
                    arr = res(v)
                    out.update(m for a in (arr if isinstance(arr, ArrayObject) else [arr]) if (m := annot_problem(a)))
                stack.append(v)
            sub, act = o.get('/Subtype'), o.get('/S')
            if o.get('/Type') == '/Annot': out.add(annot_problem(o))  # also annotations reachable outside /Annots (/Popup, form fields)
            if sub == '/FileAttachment': out.add('FileAttachment annotation')
            if act == '/URI': out.add('URI action outside an X status link')
            elif act == '/JavaScript': out.add('JavaScript')
            elif act in ('/Launch', '/SubmitForm', '/ImportData'): out.add(f'{act} action')
    return sorted(out)


PAGE_KEEP = ('/MediaBox', '/CropBox', '/BleedBox', '/TrimBox', '/ArtBox', '/Rotate', '/UserUnit', '/Resources', '/Contents')


def fresh_x_link(w, rect, url):
    """A brand-new indirect link annotation holding only what the link needs; nothing of the source dict is copied."""
    return w._add_object(DictionaryObject({
        NameObject('/Type'): NameObject('/Annot'), NameObject('/Subtype'): NameObject('/Link'),
        NameObject('/Rect'): ArrayObject([FloatObject(v) for v in rect]),
        NameObject('/Border'): ArrayObject([NumberObject(0)] * 3),
        NameObject('/A'): DictionaryObject({NameObject('/S'): NameObject('/URI'), NameObject('/URI'): TextStringObject(url)})}))


def strip_pdf(p):
    """Build brand-new pages and clone ONLY geometry, resources and content into them. Cloning whole pages (add_page) would
    leave orphaned /Metadata, /PieceInfo and attachment objects in the output file even after the page keys are deleted.
    Old catalog (XMP, Names, OpenAction, AA), Info, page-level extras and every annotation except X status links are never
    copied; those links are rebuilt from (rect, url) only. Returns the number of links kept."""
    r = PdfReader(str(p)); w = PdfWriter(); kept = 0
    for page in r.pages:
        np_ = w.add_blank_page(float(page.mediabox.width), float(page.mediabox.height))
        for k in PAGE_KEEP:
            if k in page: np_[NameObject(k)] = page.raw_get(k).clone(w)
        links = [fresh_x_link(w, *kl) for a in page_annots(page) if (kl := keepable_x_link(a))]
        if links: np_[NameObject('/Annots')] = ArrayObject(links); kept += len(links)
    info = w._info  # pypdf stamps its own /Producer; empty it
    for k in list(info.keys()): del info[k]
    tmp = p.with_suffix(p.suffix + '.tmp')
    with open(tmp, 'wb') as f: w.write(f)
    tmp.replace(p)
    return kept


# ---------------------------------------------------------------- WebP
def webp_chunks(data):
    if data[:4] != b'RIFF' or data[8:12] != b'WEBP': raise ValueError('not a WebP file')
    i, out = 12, []
    while i + 8 <= len(data):
        tag, size = data[i:i + 4], int.from_bytes(data[i + 4:i + 8], 'little')
        out.append((tag, data[i + 8:i + 8 + size])); i += 8 + size + (size & 1)
    return out


WEBP_NAMES = {b'EXIF': 'exif', b'XMP ': 'xmp', b'ICCP': 'icc profile'}


def webp_problems(p):
    return sorted({WEBP_NAMES[t] for t, _ in webp_chunks(p.read_bytes()) if t in WEBP_NAMES})


def strip_webp(p):
    """Lossless: drop EXIF / XMP / ICCP chunks and clear their VP8X flags (0x20 ICC, 0x08 EXIF, 0x04 XMP). Pixels are untouched."""
    keep = []
    for tag, body in webp_chunks(p.read_bytes()):
        if tag in WEBP_NAMES: continue
        if tag == b'VP8X': body = bytes([body[0] & ~0x2C & 0xFF]) + body[1:]
        keep.append((tag, body))
    payload = b'WEBP' + b''.join(t + len(b).to_bytes(4, 'little') + b + (b'\0' if len(b) & 1 else b'') for t, b in keep)
    p.write_bytes(b'RIFF' + len(payload).to_bytes(4, 'little') + payload)


# ---------------------------------------------------------------- PNG
def png_chunks(data):
    if not data.startswith(PNG_SIG): raise ValueError('not a PNG file')
    i, out = 8, []
    while i + 12 <= len(data):
        n = int.from_bytes(data[i:i + 4], 'big')
        out.append((data[i + 4:i + 8], data[i:i + 12 + n])); i += 12 + n
    return out


def png_problems(p):
    names = {'tEXt': 'png text (tEXt)', 'zTXt': 'png text (zTXt)', 'iTXt': 'png text (iTXt)', 'eXIf': 'exif', 'iCCP': 'icc profile', 'tIME': 'png timestamp (tIME)'}
    return sorted({names[t.decode()] for t, _ in png_chunks(p.read_bytes()) if t in PNG_DROP})


def strip_png(p):
    p.write_bytes(PNG_SIG + b''.join(raw for t, raw in png_chunks(p.read_bytes()) if t not in PNG_DROP))


# ---------------------------------------------------------------- JPEG
def jpeg_segments(data):
    """Yield (marker, raw_bytes) for header segments up to and including SOS; the rest is yielded as (None, tail)."""
    if not data.startswith(b'\xff\xd8'): raise ValueError('not a JPEG file')
    yield 0xD8, data[:2]; i = 2
    while i + 4 <= len(data):
        if data[i] != 0xFF: break
        m = data[i + 1]
        if m == 0xFF: i += 1; continue
        n = int.from_bytes(data[i + 2:i + 4], 'big')
        yield m, data[i:i + 2 + n]; i += 2 + n
        if m == 0xDA: break
    yield None, data[i:]


def jpeg_drop(m, raw):
    if m == 0xFE: return 'comment'
    if 0xE0 <= m <= 0xEF:
        if m == 0xE0 or (m == 0xEE and raw[4:9] == b'Adobe'): return None
        if m == 0xE1: return 'xmp' if raw[4:33] == b'http://ns.adobe.com/xap/1.0/\x00' else 'exif'
        if m == 0xE2 and raw[4:16] == b'ICC_PROFILE\x00': return 'icc profile'
        return f'app{m - 0xE0} segment'
    return None


def jpeg_problems(p):
    return sorted({d for m, raw in jpeg_segments(p.read_bytes()) if m is not None and (d := jpeg_drop(m, raw))})


def strip_jpeg(p):
    p.write_bytes(b''.join(raw for m, raw in jpeg_segments(p.read_bytes()) if m is None or not jpeg_drop(m, raw)))


PROBLEMS = {'pdf': pdf_problems, 'webp': webp_problems, 'png': png_problems, 'jpeg': jpeg_problems}
STRIP = {'pdf': strip_pdf, 'webp': strip_webp, 'png': strip_png, 'jpeg': strip_jpeg}


def problems(p):
    """Metadata problems for one file, decided by magic bytes. A known extension with other/mismatching magic is itself a problem."""
    kind, want = magic_kind(p), EXT_KIND.get(p.suffix.lower())
    out = []
    if want and kind != want: out.append(f'magic bytes say {kind or "unknown"}, extension says {want}')
    if kind: out += PROBLEMS[kind](p)
    return out


def files(d):
    for p in sorted(Path(d).rglob('*')):
        if p.is_file() and not p.is_symlink() and (magic_kind(p) or p.suffix.lower() in EXT_KIND): yield p


# ---------------------------------------------------------------- audit
def audit_issue_dir(d):
    """Return a list of errors; empty = the directory holds exactly what meta.json allows and nothing else.
    Allowed: meta.json; the two PDFs named in meta.json files.pdf_color / pdf_grayscale (^[a-z0-9-]{1,80}\\.pdf$);
    the page images: exactly those listed in files.pages / files.thumbs (per-build names pages/p-NN.<hash12>.webp, see
    validate_issue.py), or, without those lists, the legacy pages/p-NN.webp and pages/thumbs/p-NN.webp for NN = 1..meta.pages.
    Types are verified by magic bytes."""
    import validate_issue as vi  # local import: same directory, stdlib only
    d = Path(d); errs = []
    try: m = json.loads((d / 'meta.json').read_text())
    except Exception as e: return [f'meta.json unreadable: {e}']
    n = m.get('pages') if isinstance(m, dict) else None
    f = m.get('files') if isinstance(m, dict) else None
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= 999 or not isinstance(f, dict):
        return ['meta.json: need integer "pages" (1..999) and object "files"']
    allowed = {'meta.json': 'json'}
    for k in ('pdf_color', 'pdf_grayscale'):
        name = f.get(k)
        if not isinstance(name, str) or not PDF_NAME.fullmatch(name): errs.append(f'files.{k}: must match [a-z0-9-]{{1,80}}.pdf')
        elif name in allowed: errs.append(f'files.{k}: duplicate PDF name {name}')
        else: allowed[name] = 'pdf'
    pages, thumbs, ierrs = vi.image_lists(m)
    errs += ierrs
    if pages is not None:
        for rel in pages + thumbs: allowed[rel] = 'webp'
    elif not ierrs:
        for i in range(1, n + 1):
            allowed[f'pages/p-{i:02d}.webp'] = allowed[f'pages/thumbs/p-{i:02d}.webp'] = 'webp'
    dirs_ok = {'pages', 'pages/thumbs'}
    for p in sorted(d.rglob('*')):
        rel = p.relative_to(d).as_posix()
        if p.is_symlink(): errs.append(f'{rel}: symlink not allowed'); continue
        if p.is_dir():
            if rel not in dirs_ok: errs.append(f'{rel}/: unexpected directory')
            continue
        want = allowed.get(rel)
        if want is None: errs.append(f'{rel}: not allowed (not named by meta.json / schema)'); continue
        if want == 'json': continue
        got = magic_kind(p)
        if got != want: errs.append(f'{rel}: magic bytes say {got or "unknown"}, expected {want}')
    for rel in sorted(allowed):
        if not (d / rel).is_file(): errs.append(f'{rel}: missing')
    return errs


def main(argv):
    if len(argv) != 3 or argv[1] not in ('strip', 'check', 'audit'):
        print(__doc__); return 2
    cmd, d = argv[1], argv[2]
    if not Path(d).is_dir(): print(f'not a directory: {d}'); return 2
    if cmd == 'audit':
        e = audit_issue_dir(d)
        for x in e: print(f'{d}: {x}')
        print('FAIL: audit' if e else 'OK: issue directory matches the allowlist'); return 1 if e else 0
    bad = 0
    for p in files(d):
        pr = problems(p)
        if cmd == 'check':
            if pr: bad += 1; print(f'{p}: {"; ".join(pr)}')
            continue
        kind = magic_kind(p)
        if kind and (pr := PROBLEMS[kind](p)):
            kept = STRIP[kind](p); print(f'stripped {p}: {"; ".join(pr)}' + (f' (kept {kept} X status link(s))' if kept else ''))
        if left := problems(p): bad += 1; print(f'STILL DIRTY {p}: {"; ".join(left)}')
    if cmd == 'check': print('FAIL: metadata present' if bad else 'OK: no metadata found')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
