#!/usr/bin/env python3
"""Tests for strip_metadata.py. Run: python3 site/scripts/test_strip_metadata.py"""
import io, json, struct, tempfile, unittest
from pathlib import Path
from PIL import Image
from pypdf import PdfWriter, PdfReader
from pypdf.generic import (ArrayObject, BooleanObject, ByteStringObject, DecodedStreamObject, DictionaryObject, NameObject, NumberObject,
                           TextStringObject, FloatObject)
import strip_metadata as s
import validate_issue as vi
from reportlab.pdfgen import canvas


def base_pdf(p, text='Hello shelf'):
    c = canvas.Canvas(str(p)); c.drawString(72, 700, text); c.showPage(); c.drawString(72, 700, 'Page two'); c.save()


def rewrite(p, fn, author=False):
    r = PdfReader(str(p)); w = PdfWriter(); w.append(r); fn(w)
    for k in list(w._info.keys()): del w._info[k]  # isolate the item under test from pypdf's own /Producer
    if author: w.add_metadata({'/Author': 'Tristan Example'})
    with open(p, 'wb') as f: w.write(f)


def xmp(w):
    o = DecodedStreamObject(); o.set_data(b'<x:xmpmeta>Tristan Example</x:xmpmeta>'); return w._add_object(o)


def add_annot(w, d, page=0):
    d = {NameObject('/Type'): NameObject('/Annot'), NameObject('/Rect'): ArrayObject([FloatObject(0), FloatObject(0), FloatObject(50), FloatObject(50)]), **d}
    w.pages[page].setdefault(NameObject('/Annots'), ArrayObject()).append(w._add_object(DictionaryObject(d)))


def f_info(w): pass  # rewrite(author=True) below
def f_xmp(w): w._root_object[NameObject('/Metadata')] = xmp(w)
def f_pagemeta(w): w.pages[0][NameObject('/Metadata')] = xmp(w)
def f_pieceinfo(w): w.pages[0][NameObject('/PieceInfo')] = DictionaryObject({NameObject('/App'): DictionaryObject({NameObject('/Private'): TextStringObject('secret')})})
def f_embed(w): w.add_attachment('notes.txt', b'secret payload')
def f_fileannot(w):
    ef = DecodedStreamObject(); ef.set_data(b'x'); spec = w._add_object(DictionaryObject({NameObject('/Type'): NameObject('/Filespec'), NameObject('/F'): TextStringObject('a.txt'), NameObject('/EF'): DictionaryObject({NameObject('/F'): w._add_object(ef)})}))
    add_annot(w, {NameObject('/Subtype'): NameObject('/FileAttachment'), NameObject('/FS'): spec})
def f_js(w): w._root_object.setdefault(NameObject('/Names'), DictionaryObject()).update({NameObject('/JavaScript'): DictionaryObject({NameObject('/Names'): ArrayObject([TextStringObject('j'), DictionaryObject({NameObject('/S'): NameObject('/JavaScript'), NameObject('/JS'): TextStringObject('app.alert(1)')})])})})
def f_open(w): w._root_object[NameObject('/OpenAction')] = DictionaryObject({NameObject('/S'): NameObject('/JavaScript'), NameObject('/JS'): TextStringObject('app.alert(2)')})
def f_aa(w): w.pages[0][NameObject('/AA')] = DictionaryObject({NameObject('/O'): DictionaryObject({NameObject('/S'): NameObject('/JavaScript'), NameObject('/JS'): TextStringObject('x')})})
def f_uri(w): add_annot(w, {NameObject('/Subtype'): NameObject('/Link'), NameObject('/A'): DictionaryObject({NameObject('/S'): NameObject('/URI'), NameObject('/URI'): TextStringObject('https://tracker.example/?u=1')})})

PDF_CASES = {'info': f_info, 'xmp': f_xmp, 'page_metadata': f_pagemeta, 'pieceinfo': f_pieceinfo, 'embedded': f_embed,
             'file_annot': f_fileannot, 'js_names': f_js, 'openaction': f_open, 'page_aa': f_aa, 'uri_link': f_uri}


def webp_with(p, **kw):
    ex = Image.Exif(); ex[0x010F] = 'CameraMaker'
    Image.new('RGB', (8, 8), 'red').save(p, 'WEBP', exif=ex.tobytes(), xmp=b'<x:xmpmeta>me</x:xmpmeta>', icc_profile=icc())


def icc():
    from PIL import ImageCms
    return ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()


def png_with(p):
    from PIL.PngImagePlugin import PngInfo
    i = PngInfo(); i.add_text('Software', 'SecretTool'); i.add_itxt('k', 'unicode me'); i.add_text('z', 'zip me', zip=True)
    ex = Image.Exif(); ex[0x010F] = 'CameraMaker'
    Image.new('RGB', (8, 8), 'blue').save(p, 'PNG', pnginfo=i, exif=ex, icc_profile=icc())


def jpg_with(p):
    ex = Image.Exif(); ex[0x010F] = 'CameraMaker'
    Image.new('RGB', (8, 8), 'green').save(p, 'JPEG', exif=ex, icc_profile=icc(), comment=b'secret comment')


class PdfTests(unittest.TestCase):
    def test_each_item_flagged_then_clean(self):
        for name, fn in PDF_CASES.items():
            with self.subTest(name), tempfile.TemporaryDirectory() as t:
                p = Path(t) / 'a.pdf'; base_pdf(p); rewrite(p, fn, author=(name == 'info'))
                self.assertTrue(s.pdf_problems(p), f'{name} not flagged')
                self.assertEqual(any(x.startswith('Info') for x in s.pdf_problems(p)), name == 'info')
                self.assertEqual(s.main(['x', 'check', t]), 1)
                self.assertEqual(s.main(['x', 'strip', t]), 0)
                self.assertEqual(s.pdf_problems(p), [])
                self.assertEqual(s.main(['x', 'check', t]), 0)
                r = PdfReader(str(p)); self.assertEqual(len(r.pages), 2)
                self.assertIn('Hello shelf', r.pages[0].extract_text()); self.assertIn('Page two', r.pages[1].extract_text())
                raw = p.read_bytes()
                for bad in (b'Tristan Example', b'tracker.example', b'secret payload', b'app.alert'): self.assertNotIn(bad, raw)

    def test_all_items_together(self):
        with tempfile.TemporaryDirectory() as t:
            p = Path(t) / 'a.pdf'; base_pdf(p)
            for fn in (f_xmp, f_pagemeta, f_pieceinfo, f_embed, f_js, f_open, f_aa, f_uri, f_fileannot): rewrite(p, fn)
            self.assertGreaterEqual(len(s.pdf_problems(p)), 7)
            s.main(['x', 'strip', t]); self.assertEqual(s.pdf_problems(p), []); self.assertEqual(len(PdfReader(str(p)).pages), 2)

    def test_clean_pdf_is_clean(self):
        with tempfile.TemporaryDirectory() as t:
            p = Path(t) / 'a.pdf'; base_pdf(p); s.strip_pdf(p); self.assertEqual(s.pdf_problems(p), [])

    def test_streams_stay_indirect(self):
        """PDF streams must be indirect objects (ISO 32000-1, 7.3.8). Cloning the resolved page[k] inlined /Contents
        into the page dict: pypdf still read it, but poppler (pdftotext/pdftoppm, Chrome-adjacent viewers) refused the page."""
        import shutil, subprocess
        from pypdf.generic import IndirectObject
        with tempfile.TemporaryDirectory() as t:
            p = Path(t) / 'a.pdf'; base_pdf(p); s.strip_pdf(p)
            for pg in PdfReader(str(p)).pages:
                c = pg.raw_get('/Contents')
                items = c if isinstance(c, ArrayObject) else [c]
                for it in items: self.assertIsInstance(it, IndirectObject)
            if shutil.which('pdftotext'):
                out = subprocess.run(['pdftotext', str(p), '-'], capture_output=True, text=True)
                self.assertNotIn('Syntax Error', out.stderr); self.assertIn('Hello shelf', out.stdout)


# ---------------------------------------------------------------- X status links (the only annotation that may stay)
X_URL, TW_URL = 'https://x.com/TrungTPhan/status/2111839499907223734', 'https://twitter.com/trq212/status/2112219173288120531'


def written(text):
    """text as pypdf writes it inside a literal string (non-alphanumerics octal-escaped), to search raw file bytes."""
    b = io.BytesIO(); TextStringObject(text).write_to_stream(b); return b.getvalue()[1:-1]


def act(s, **kv): return DictionaryObject({NameObject('/S'): NameObject(s), **{NameObject('/' + k): v for k, v in kv.items()}})
def uri(u, **kv): return act('/URI', URI=TextStringObject(u), **kv)
def js(): return act('/JavaScript', JS=TextStringObject('app.alert(3)'))


def link(w, a, page=0, **kv):
    """A link as Chromium writes it (/F 4, /StructParent, /A with /Type /Action) with action a; kv: more annotation keys."""
    if a.get('/S') == '/URI': a[NameObject('/Type')] = NameObject('/Action')
    add_annot(w, {NameObject('/Subtype'): NameObject('/Link'), NameObject('/F'): NumberObject(4), NameObject('/StructParent'): NumberObject(0),
                  NameObject('/A'): a, **{NameObject('/' + k): v for k, v in kv.items()}}, page)


def minimal(w, url=X_URL, page=0, **kv):
    """Exactly what strip writes; kv adds or overrides keys."""
    add_annot(w, {NameObject('/Subtype'): NameObject('/Link'), NameObject('/Border'): ArrayObject([NumberObject(0)] * 3),
                  NameObject('/A'): uri(url), **{NameObject('/' + k): v for k, v in kv.items()}}, page)


def secret_stream(w):
    o = DecodedStreamObject(); o.set_data(b'% Tristan Example appearance'); return w._add_object(o)


# name -> (adds one annotation that must NOT survive, marker that must be gone from the file afterwards)
DROPPED = {
    'non-X URI': (lambda w: link(w, uri('https://tracker.example/?u=1')), 'tracker.example'),
    'x.com profile, no status': (lambda w: link(w, uri('https://x.com/TrungTPhan')), 'x.com/TrungTPhan'),
    'x.com non-status path': (lambda w: link(w, uri('https://x.com/TrungTPhan/likes')), 'x.com/TrungTPhan/likes'),
    'x.com status sub-path': (lambda w: link(w, uri(X_URL + '/photo/1')), 'photo'),
    'query string': (lambda w: link(w, uri(X_URL + '?s=20')), '?s=20'),
    'fragment': (lambda w: link(w, uri(X_URL + '#m')), X_URL + '#m'),
    'userinfo': (lambda w: link(w, uri('https://me@x.com/a/status/1')), 'me@x.com'),
    'port': (lambda w: link(w, uri('https://x.com:443/a/status/1')), 'x.com:443'),
    'http': (lambda w: link(w, uri('http://x.com/a/status/1')), 'http://x.com'),
    'www host': (lambda w: link(w, uri('https://www.x.com/a/status/1')), 'www.x.com'),
    'lookalike host': (lambda w: link(w, uri('https://x.com.evil.example/a/status/1')), 'evil.example'),
    'uppercase host': (lambda w: link(w, uri('https://X.COM/a/status/1')), 'X.COM'),
    'trailing slash': (lambda w: link(w, uri('https://x.com/a/status/1/')), 'status/1/'),
    'trailing newline': (lambda w: link(w, uri('https://x.com/a/status/1\n')), 'status/1\n'),
    'handle too long': (lambda w: link(w, uri('https://x.com/' + 'a' * 16 + '/status/1')), 'a' * 16),
    'id too long': (lambda w: link(w, uri('https://x.com/a/status/' + '9' * 26)), '9' * 26),
    'UTF-16 URI': (lambda w: link(w, act('/URI', URI=ByteStringObject(b'\xfe\xff' + X_URL.encode('utf-16-be')))), None),
    'javascript: URI': (lambda w: link(w, uri('javascript:app.alert(1)//https://x.com/a/status/1')), 'app.alert'),
    'JavaScript action': (lambda w: link(w, js()), 'app.alert'),
    'Launch action': (lambda w: link(w, act('/Launch', F=TextStringObject('calc.exe'))), 'calc.exe'),
    'GoTo action': (lambda w: link(w, act('/GoTo', D=TextStringObject('secret-dest'))), 'secret-dest'),
    'Named action': (lambda w: link(w, act('/Named', N=NameObject('/NextPage'))), '/NextPage'),
    'X link with /AA': (lambda w: link(w, uri(X_URL), AA=DictionaryObject({NameObject('/E'): js()})), 'app.alert'),
    'X link with /Next chain': (lambda w: link(w, uri(X_URL, Next=js())), 'app.alert'),
    'X link with /Dest': (lambda w: link(w, uri(X_URL), Dest=TextStringObject('secret-dest')), 'secret-dest'),
    'X link with /IsMap': (lambda w: link(w, uri(X_URL, IsMap=BooleanObject(True))), 'TrungTPhan'),
    'X link with a 3-number /Rect': (lambda w: minimal(w, Rect=ArrayObject([NumberObject(0)] * 3)), 'TrungTPhan'),
    'X link with an absurd /Rect number': (lambda w: minimal(w, Rect=ArrayObject([NumberObject(10 ** 30)] + [NumberObject(0)] * 3)), 'TrungTPhan'),
    'X URI on a widget': (lambda w: add_annot(w, {NameObject('/Subtype'): NameObject('/Widget'), NameObject('/A'): uri(X_URL)}), 'TrungTPhan'),
    'text note': (lambda w: add_annot(w, {NameObject('/Subtype'): NameObject('/Text'), NameObject('/T'): TextStringObject('Tristan Example')}), 'Tristan Example'),
}


class XLinkTests(unittest.TestCase):
    def make(self, t, *fns):
        p = Path(t) / 'a.pdf'; base_pdf(p); rewrite(p, lambda w: [fn(w) for fn in fns]); return p

    def gone(self, raw, text):
        self.assertNotIn(text.encode('latin-1'), raw); self.assertNotIn(written(text), raw)

    def test_url_pattern(self):
        for u in (X_URL, TW_URL, 'https://x.com/a/status/1', 'https://x.com/i/status/1', 'https://twitter.com/A_b9/status/0',
                  'https://x.com/' + 'a' * 15 + '/status/' + '9' * 25):
            with self.subTest(u): self.assertEqual(s.x_status_url(TextStringObject(u)), u); self.assertEqual(s.x_status_url(ByteStringObject(u.encode())), u)
        for u in ('', 'https://x.com/a/status/', 'https://x.com//status/1', 'https://x.com/a-b/status/1', 'https://x.com/a/statuses/1',
                  'https://x.com/a/status/1a', 'https://x.com/a/status/1?', 'https://x.com/a/status/1 ', ' https://x.com/a/status/1',
                  'https://mobile.twitter.com/a/status/1', 'https://x.co/a/status/1', 'https://xxcom/a/status/1', 'https:/x.com/a/status/1',
                  'https://x.com/a/status/١', 'https://x.com/ä/status/1', 'ftp://x.com/a/status/1'):
            with self.subTest(u): self.assertIsNone(s.x_status_url(TextStringObject(u)))
        self.assertIsNone(s.x_status_url(NameObject('/https://x.com/a/status/1')))

    def test_x_links_kept_as_fresh_minimal_dicts(self):
        for name, url in (('x.com', X_URL), ('twitter.com', TW_URL)):
            with self.subTest(name), tempfile.TemporaryDirectory() as t:
                p = self.make(t, lambda w: link(w, uri(url), AP=DictionaryObject({NameObject('/N'): secret_stream(w)}),
                                                Contents=TextStringObject('Tristan Example note'), NM=TextStringObject('Tristan Example id'),
                                                OC=DictionaryObject({NameObject('/Type'): NameObject('/OCG'), NameObject('/Name'): TextStringObject('Tristan Example layer')}),
                                                C=ArrayObject([FloatObject(1), FloatObject(0), FloatObject(0)]), H=NameObject('/I')))
                self.assertEqual(set(s.pdf_problems(p)), {'X status link not in minimal form (strip rebuilds it)', 'URI action outside an X status link'})
                self.assertEqual(s.main(['x', 'check', t]), 1)
                self.assertEqual(s.main(['x', 'strip', t]), 0)
                self.assertEqual(s.pdf_problems(p), []); self.assertEqual(s.main(['x', 'check', t]), 0)
                r = PdfReader(str(p)); (a,) = r.pages[0]['/Annots']; a = a.get_object()
                self.assertEqual(set(a), s.X_LINK_KEYS); self.assertEqual(a['/Type'], '/Annot'); self.assertEqual(a['/Subtype'], '/Link')
                self.assertEqual(dict(a['/A']), {'/S': '/URI', '/URI': url})
                self.assertEqual(list(a['/Rect']), [0, 0, 50, 50]); self.assertEqual(list(a['/Border']), [0, 0, 0])
                self.assertNotIn('/Annots', r.pages[1])
                self.assertEqual(s.pdf_x_links(p), [(1, url)])
                raw = p.read_bytes(); self.assertIn(written(url), raw); self.gone(raw, 'Tristan Example')
                self.assertIn('Hello shelf', r.pages[0].extract_text())

    def test_everything_else_dropped_and_rejected(self):
        for name, (fn, marker) in DROPPED.items():
            with self.subTest(name), tempfile.TemporaryDirectory() as t:
                p = self.make(t, fn)
                if marker: self.assertTrue(marker.encode('latin-1') in p.read_bytes() or written(marker) in p.read_bytes(), 'probe')
                self.assertTrue(s.pdf_problems(p), f'{name} not flagged'); self.assertEqual(s.pdf_x_links(p), [])
                self.assertEqual(s.main(['x', 'check', t]), 1)
                self.assertEqual(s.main(['x', 'strip', t]), 0); self.assertEqual(s.pdf_problems(p), [])
                self.assertEqual(s.main(['x', 'check', t]), 0)
                r = PdfReader(str(p)); self.assertFalse([pg for pg in r.pages if '/Annots' in pg])
                if marker: self.gone(p.read_bytes(), marker)

    def test_mixed_page_keeps_only_x_links_in_order(self):
        with tempfile.TemporaryDirectory() as t:
            p = self.make(t, lambda w: link(w, uri('https://tracker.example/?u=1')), lambda w: link(w, uri(X_URL)), lambda w: link(w, js()),
                          lambda w: link(w, uri(X_URL), AA=DictionaryObject({NameObject('/E'): js()})), lambda w: link(w, uri(TW_URL), page=1),
                          f_xmp, f_open)
            self.assertEqual(s.main(['x', 'strip', t]), 0)
            self.assertEqual(s.pdf_x_links(p), [(1, X_URL), (2, TW_URL)]); self.assertEqual(s.pdf_problems(p), [])
            raw = p.read_bytes()
            for bad in ('tracker.example', 'app.alert', 'Tristan Example'): self.gone(raw, bad)

    def test_check_accepts_only_the_minimal_form(self):
        with tempfile.TemporaryDirectory() as t:
            p = self.make(t, lambda w: minimal(w), lambda w: minimal(w, TW_URL, page=1))
            self.assertEqual(s.pdf_problems(p), []); self.assertEqual(s.main(['x', 'check', t]), 0)
            before = p.read_bytes(); self.assertEqual(s.main(['x', 'strip', t]), 0); self.assertEqual(p.read_bytes(), before)  # clean: untouched
        not_minimal = {
            '/F': dict(F=NumberObject(4)), '/StructParent': dict(StructParent=NumberObject(0)), '/Contents': dict(Contents=TextStringObject('x')),
            '/P': dict(P=NameObject('/x')), '/Type /Action': dict(A=uri(X_URL, Type=NameObject('/Action'))),
            'visible border': dict(Border=ArrayObject([NumberObject(0), NumberObject(0), NumberObject(1)])),
            'border of names': dict(Border=ArrayObject([NameObject('/a')] * 3)), 'no /Border': dict(Border=None),
            'no /Type': dict(Type=None),
        }
        for name, kv in not_minimal.items():
            with self.subTest(name), tempfile.TemporaryDirectory() as t:
                def add(w):
                    minimal(w, **{k: v for k, v in kv.items() if v is not None})
                    a = w.pages[0]['/Annots'][-1].get_object()
                    for k, v in kv.items():
                        if v is None: del a[NameObject('/' + k)]
                p = self.make(t, add)
                self.assertIn('X status link not in minimal form (strip rebuilds it)', s.pdf_problems(p)); self.assertEqual(s.main(['x', 'check', t]), 1)
                self.assertEqual(s.main(['x', 'strip', t]), 0); self.assertEqual(s.pdf_problems(p), []); self.assertEqual(s.pdf_x_links(p), [(1, X_URL)])

    def test_annotation_outside_annots_is_flagged(self):
        """An annotation reachable from somewhere other than a page's /Annots is still found by the walk and flagged."""
        with tempfile.TemporaryDirectory() as t:
            def add(w):
                hidden = w._add_object(DictionaryObject({NameObject('/Type'): NameObject('/Annot'), NameObject('/Subtype'): NameObject('/Popup'),
                                                         NameObject('/Rect'): ArrayObject([NumberObject(0)] * 4)}))
                w.pages[0][NameObject('/Extra')] = DictionaryObject({NameObject('/Popup'): hidden})
            p = self.make(t, add)
            self.assertIn('/Popup annotation (only X status links may stay)', s.pdf_problems(p))

    def test_links_added_like_reference_annotate_py_survive(self):
        """The v5-links build added links with pypdf's Link annotation in an incremental update (reference/annotate.py)."""
        from pypdf.annotations import Link
        with tempfile.TemporaryDirectory() as t:
            p = Path(t) / 'a.pdf'; base_pdf(p); s.strip_pdf(p)
            w = PdfWriter(str(p), incremental=True)
            for page, url, rect in ((0, X_URL, (71.0, 690.5, 140.25, 702.0)), (1, TW_URL, (71.0, 690.5, 120.0, 702.0)), (1, 'https://theribbon.fyi/3n1', (0, 0, 9, 9))):
                ann = Link(rect=rect, url=url); ann[NameObject('/Border')] = ArrayObject([NumberObject(0)] * 3)
                w.add_annotation(page_number=page, annotation=ann)
            with open(p, 'wb') as f: w.write(f)
            self.assertEqual(s.main(['x', 'check', t]), 1)
            self.assertEqual(s.main(['x', 'strip', t]), 0); self.assertEqual(s.main(['x', 'check', t]), 0)
            self.assertEqual(s.pdf_x_links(p), [(1, X_URL), (2, TW_URL)])
            self.assertEqual(list(PdfReader(str(p)).pages[0]['/Annots'][0].get_object()['/Rect']), [71, 690.5, 140.25, 702])

    def test_strip_is_idempotent(self):
        odd = ArrayObject([FloatObject(10.123456789), NumberObject(20), FloatObject(0.000012345), FloatObject(595.2755905511812)])
        cases = {
            'no annotations': (),
            'links and junk': (lambda w: link(w, uri(X_URL)), lambda w: link(w, uri(TW_URL), page=1, Rect=odd),
                               lambda w: link(w, uri(TW_URL), page=1), lambda w: link(w, uri('https://tracker.example/')), f_xmp, f_pieceinfo, f_embed),
        }
        for name, fns in cases.items():
            with self.subTest(name), tempfile.TemporaryDirectory() as t:
                p = self.make(t, *fns); s.strip_pdf(p); first = p.read_bytes()
                for _ in range(2): s.strip_pdf(p); self.assertEqual(p.read_bytes(), first)  # byte-identical on every re-run
                self.assertEqual(s.main(['x', 'strip', t]), 0); self.assertEqual(p.read_bytes(), first)
                self.assertEqual(s.pdf_problems(p), [])
                if fns: self.assertEqual(s.pdf_x_links(p), [(1, X_URL), (2, TW_URL), (2, TW_URL)])


class ImageTests(unittest.TestCase):
    def run_kind(self, name, maker, size=(8, 8)):
        with tempfile.TemporaryDirectory() as t:
            p = Path(t) / name; maker(p)
            pr = s.problems(p); self.assertIn('icc profile', pr); self.assertIn('exif', pr)
            self.assertEqual(s.main(['x', 'check', t]), 1)
            before = Image.open(p).convert('RGB').tobytes()
            self.assertEqual(s.main(['x', 'strip', t]), 0)
            self.assertEqual(s.problems(p), []); self.assertEqual(s.main(['x', 'check', t]), 0)
            with Image.open(p) as im: im.load(); self.assertEqual(im.size, size)
            raw = p.read_bytes()
            for bad in (b'CameraMaker', b'SecretTool', b'secret comment', b'ICC_PROFILE', b'iCCP', b'ICCP', b'sRGB'): self.assertNotIn(bad, raw, bad)
            return before, Image.open(p).convert('RGB').tobytes(), pr

    def test_webp(self):
        b, a, pr = self.run_kind('p.webp', webp_with); self.assertIn('xmp', pr); self.assertEqual(b, a)

    def test_png(self):
        b, a, pr = self.run_kind('p.png', png_with); self.assertEqual(b, a)
        for k in ('png text (tEXt)', 'png text (iTXt)', 'png text (zTXt)'): self.assertIn(k, pr)

    def test_jpeg(self):
        b, a, pr = self.run_kind('p.jpg', jpg_with); self.assertEqual(b, a); self.assertIn('comment', pr)

    def test_webp_icc_only(self):
        with tempfile.TemporaryDirectory() as t:
            p = Path(t) / 'p.webp'; Image.new('RGB', (8, 8)).save(p, 'WEBP', icc_profile=icc())
            self.assertEqual(s.problems(p), ['icc profile']); s.strip_webp(p); self.assertEqual(s.problems(p), [])


class AuditTests(unittest.TestCase):
    def make(self, t, pages=2):
        d = Path(t) / '001'; (d / 'pages/thumbs').mkdir(parents=True)
        (d / 'meta.json').write_text(json.dumps({'pages': pages, 'files': {'pdf_color': 'a-color.pdf', 'pdf_grayscale': 'a-gray.pdf'}}))
        base_pdf(d / 'a-color.pdf'); base_pdf(d / 'a-gray.pdf')
        for i in range(1, pages + 1):
            for sub in ('pages', 'pages/thumbs'): Image.new('RGB', (4, 4)).save(d / sub / f'p-{i:02d}.webp', 'WEBP')
        return d

    def test_good_dir(self):
        with tempfile.TemporaryDirectory() as t:
            d = self.make(t); self.assertEqual(s.audit_issue_dir(d), []); self.assertEqual(s.main(['x', 'audit', str(d)]), 0)

    def test_rejects(self):
        cases = {
            'extra file': lambda d: (d / 'notes.txt').write_text('x'),
            'extra pdf': lambda d: (d / 'other.pdf').write_bytes(b'%PDF-1.4'),
            'hidden file': lambda d: (d / '.DS_Store').write_bytes(b'x'),
            'png in pages': lambda d: Image.new('RGB', (4, 4)).save(d / 'pages/p-01.png'),
            'extra page': lambda d: (d / 'pages/p-03.webp').write_bytes(b'RIFF\0\0\0\0WEBP'),
            'extra dir': lambda d: (d / 'work').mkdir(),
            'pdf renamed webp': lambda d: (d / 'pages/p-01.webp').write_bytes((d / 'a-color.pdf').read_bytes()),
            'webp renamed pdf': lambda d: (d / 'a-gray.pdf').write_bytes((d / 'pages/p-01.webp').read_bytes()),
            'png as webp': lambda d: (Image.new('RGB', (4, 4)).save(d / 'pages/thumbs/p-02.webp', 'PNG')),
            'missing page': lambda d: (d / 'pages/p-02.webp').unlink(),
            'symlink': lambda d: (d / 'link.pdf').symlink_to(d / 'a-color.pdf'),
        }
        for name, fn in cases.items():
            with self.subTest(name), tempfile.TemporaryDirectory() as t:
                d = self.make(t); fn(d); self.assertTrue(s.audit_issue_dir(d), name); self.assertEqual(s.main(['x', 'audit', str(d)]), 1)

    def test_bad_pdf_names_in_meta(self):
        for bad in ('../x.pdf', 'A.pdf', 'a b.pdf', 'a.PDF', 'sub/a.pdf'):
            with self.subTest(bad), tempfile.TemporaryDirectory() as t:
                d = self.make(t); m = json.loads((d / 'meta.json').read_text()); m['files']['pdf_color'] = bad
                (d / 'meta.json').write_text(json.dumps(m)); self.assertTrue(s.audit_issue_dir(d))

    def make_hashed(self, t, pages=2):
        """Per-build layout written by bookmark publish: names listed in meta files.pages / files.thumbs."""
        d = self.make(t, pages); m = json.loads((d / 'meta.json').read_text()); m['files']['pages'], m['files']['thumbs'] = [], []
        for i in range(1, pages + 1):
            for sub, key in (('pages', 'pages'), ('pages/thumbs', 'thumbs')):
                old = d / sub / f'p-{i:02d}.webp'; rel = vi.page_name(i, old.read_bytes(), key == 'thumbs'); old.rename(d / rel); m['files'][key].append(rel)
        (d / 'meta.json').write_text(json.dumps(m)); return d, m

    def test_hashed_names(self):
        with tempfile.TemporaryDirectory() as t:
            d, m = self.make_hashed(t); self.assertEqual(s.audit_issue_dir(d), [])
        cases = {
            'legacy name next to hashed': lambda d, m: Image.new('RGB', (4, 4)).save(d / 'pages/p-01.webp', 'WEBP'),
            'unlisted hashed image': lambda d, m: (d / 'pages/p-01.0123456789ab.webp').write_bytes((d / m['files']['pages'][0]).read_bytes()),
            'listed but missing': lambda d, m: (d / m['files']['thumbs'][1]).unlink(),
            'only pages listed': lambda d, m: (m['files'].pop('thumbs'), (d / 'meta.json').write_text(json.dumps(m))),
            'wrong page number': lambda d, m: (m['files']['pages'].reverse(), (d / 'meta.json').write_text(json.dumps(m))),
        }
        for name, fn in cases.items():
            with self.subTest(name), tempfile.TemporaryDirectory() as t:
                d, m = self.make_hashed(t); fn(d, m); self.assertTrue(s.audit_issue_dir(d), name)

    def test_pdf_name_length_matches_pages_function(self):  # Codex #4: the Function serves [a-z0-9-]{1,80}.pdf
        for name, ok in (('a' * 80 + '.pdf', True), ('a' * 81 + '.pdf', False)):
            with self.subTest(len=len(name)), tempfile.TemporaryDirectory() as t:
                d = self.make(t); m = json.loads((d / 'meta.json').read_text()); (d / 'a-color.pdf').rename(d / name); m['files']['pdf_color'] = name
                (d / 'meta.json').write_text(json.dumps(m)); self.assertEqual(s.audit_issue_dir(d) == [], ok)

    def test_renamed_pdf_caught_by_check(self):
        with tempfile.TemporaryDirectory() as t:
            p = Path(t) / 'a.pdf'; base_pdf(p); rewrite(p, f_info, author=True); q = Path(t) / 'a.dat'; p.rename(q)
            self.assertEqual(s.magic_kind(q), 'pdf')
            s.main(['x', 'strip', t]); self.assertEqual(s.pdf_problems(q), [])
            r = Path(t) / 'b.pdf'; Image.new('RGB', (4, 4)).save(r, 'PNG')
            self.assertEqual(s.main(['x', 'check', t]), 1)


if __name__ == '__main__': unittest.main()
