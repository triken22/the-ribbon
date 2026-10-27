#!/usr/bin/env python3
"""Tests for validate_issue.py. Run: python3 site/scripts/test_validate_issue.py"""
import copy, hashlib, json, tempfile, unittest
from pathlib import Path
import validate_issue as v

SRC = {"post_id": "123", "url": "https://x.com/ab_c/status/123", "author_handle": "ab_c", "author_name": "A", "snippet": "hi"}


def build(tmp, edit=None):
    d = Path(tmp) / "001"; (d / "pages/thumbs").mkdir(parents=True)
    for n in (1,):
        (d / f"pages/p-{n:02d}.webp").write_bytes(b"x"); (d / f"pages/thumbs/p-{n:02d}.webp").write_bytes(b"x")
    (d / "issue-001-color.pdf").write_bytes(b"c"); (d / "issue-001-grayscale.pdf").write_bytes(b"g")
    h = lambda b: hashlib.sha256(b).hexdigest()
    m = {"issue": 1, "title": "T", "date": "2026-10-10", "pages": 1, "cover_headline": "H", "cover_image": "pages/p-01.webp", "qa_verdict": "pass",
         "sections": [{"slug": "ai", "label": "AI", "page_start": 1, "page_end": 1}],
         "articles": [{"id": "a01", "headline": "H", "section": "ai", "page": 1, "kind": "cover", "sources": [copy.deepcopy(SRC)]}],
         "files": {"pdf_color": "issue-001-color.pdf", "pdf_grayscale": "issue-001-grayscale.pdf", "pages_dir": "pages/", "page_count": 1,
                   "sha256": {"pdf_color": h(b"c"), "pdf_grayscale": h(b"g")}},
         "image_credits": ["Cover illustration: AI-generated."]}
    if edit: edit(m)
    (d / "meta.json").write_text(json.dumps(m)); return d


class T(unittest.TestCase):
    def errs(self, edit=None):
        with tempfile.TemporaryDirectory() as t: return v.check(build(t, edit))

    def test_valid(self): self.assertEqual(self.errs(), [])
    def test_url_trailing_newline(self): self.assertTrue(self.errs(lambda m: m["articles"][0]["sources"][0].update(url=SRC["url"] + "\n")))
    def test_url_wrong_handle(self): self.assertTrue(self.errs(lambda m: m["articles"][0]["sources"][0].update(url="https://x.com/other/status/123")))
    def test_url_unicode_digits(self): self.assertTrue(self.errs(lambda m: m["articles"][0]["sources"][0].update(url="https://x.com/ab_c/status/١٢٣", post_id="١٢٣")))
    def test_date_unicode_digits(self): self.assertTrue(self.errs(lambda m: m.update(date="٢٠٢٦-١٠-١٠")))
    def test_credit_url(self):
        for bad in ("see https://evil.example/x", "www.evil.example", "<b>x</b>", "a>b", "x" * 201):
            self.assertTrue(self.errs(lambda m, b=bad: m.update(image_credits=[b])), bad)
    def test_pdf_name_path(self):
        for bad in ("../x.pdf", "a/b.pdf", "A.pdf", "x.pdf\n", "x.PDF", "x.pdf/../y"):
            self.assertTrue(self.errs(lambda m, b=bad: m["files"].update(pdf_color=b)), bad)
    def test_sha_shape(self):
        for bad in ("abc", {"pdf_color": "A" * 64, "pdf_grayscale": "a" * 64}, {"pdf_color": "a" * 64}, {"pdf_color": "a" * 63 + "\n", "pdf_grayscale": "a" * 64}):
            self.assertTrue(self.errs(lambda m, b=bad: m["files"].update(sha256=b)))
    def test_sha_mismatch(self): self.assertTrue(self.errs(lambda m: m["files"]["sha256"].update(pdf_color="0" * 64)))
    def test_extra_key(self): self.assertTrue(self.errs(lambda m: m.update(deck="x")))

    def test_pdf_name_length_matches_pages_function(self):  # Codex #4
        def rename(m, n):
            m["files"]["pdf_color"] = n
        with tempfile.TemporaryDirectory() as t:
            d = build(t); (d / "issue-001-color.pdf").rename(d / ("a" * 80 + ".pdf"))
            m = json.loads((d / "meta.json").read_text()); m["files"]["pdf_color"] = "a" * 80 + ".pdf"; (d / "meta.json").write_text(json.dumps(m))
            self.assertEqual(v.check(d), [])
        self.assertTrue(any("pdf_color" in e for e in self.errs(lambda m: rename(m, "a" * 81 + ".pdf"))))

    def hashed(self, t, edit=None):
        d = build(t); m = json.loads((d / "meta.json").read_text())
        pg = v.page_name(1, b"x"); th = v.page_name(1, b"x", thumb=True)
        (d / "pages/p-01.webp").rename(d / pg); (d / "pages/thumbs/p-01.webp").rename(d / th)
        m["files"]["pages"], m["files"]["thumbs"], m["cover_image"] = [pg], [th], pg
        if edit: edit(d, m)
        (d / "meta.json").write_text(json.dumps(m)); return v.check(d)

    def test_hashed_names_valid(self):
        with tempfile.TemporaryDirectory() as t: self.assertEqual(self.hashed(t), [])

    def test_hashed_names_rejected(self):
        cases = {
            "hash differs from content": lambda d, m: (d / m["files"]["pages"][0]).write_bytes(b"y"),
            "cover not first page": lambda d, m: m.update(cover_image="pages/p-01.webp"),
            "uppercase hex": lambda d, m: m["files"].update(pages=[m["files"]["pages"][0].upper()]),
            "wrong count": lambda d, m: m["files"].update(thumbs=[]),
            "only one list": lambda d, m: m["files"].pop("thumbs"),
            "path escape": lambda d, m: m["files"].update(pages=["../p-01.2d711642b726.webp"]),
            "thumb in pages": lambda d, m: m["files"].update(pages=m["files"]["thumbs"]),
            "not a list": lambda d, m: m["files"].update(pages="pages/p-01.2d711642b726.webp"),
        }
        for name, fn in cases.items():
            with self.subTest(name), tempfile.TemporaryDirectory() as t: self.assertTrue(self.hashed(t, fn), name)


if __name__ == "__main__":
    unittest.main()
