#!/usr/bin/env python3
"""Tests for ci_qa_public.py (the post-publish check of the live site). Network is mocked with an in-memory site.
Run: python3 site/scripts/test_ci_qa_public.py"""
import copy, hashlib, io, json, tempfile, unittest, urllib.error
from pathlib import Path
from unittest import mock
import ci_qa_public as cq
import validate_issue as vi

BASE = "https://qa-test.invalid"
ROOT = f"{BASE}/issues/003/"
PAGES = 3


class Resp:
    def __init__(self, status, headers, body): self.status, self.headers, self.body = status, headers, body
    def read(self, n=-1): return self.body
    def __enter__(self): return self
    def __exit__(self, *a): return False


class Site:
    """A published issue 003 (3 pages) plus manifest, served from a dict. Tests mutate .routes / .meta / .manifest before serving."""
    def __init__(self):
        self.pdfs = {"pdf_color": ("issue-003-color-v5-links.pdf", b"%PDF-1.7 fake colour edition"),
                     "pdf_grayscale": ("issue-003-gray-v5-links.pdf", b"%PDF-1.7 fake grayscale edition")}
        self.routes, pages, thumbs = {}, [], []
        for i in range(1, PAGES + 1):
            for thumb, lst in ((False, pages), (True, thumbs)):
                data = f"RIFF fake {'thumb' if thumb else 'page'} {i}".encode(); rel = vi.page_name(i, data, thumb)
                lst.append(rel); self.routes[ROOT + rel] = (200, {"Content-Type": "image/webp"}, data)
        for name, data in self.pdfs.values(): self.routes[ROOT + name] = (200, {"Content-Type": "application/pdf", "Content-Length": str(len(data))}, data)
        self.meta = {"issue": 3, "title": "The Weekend Bookmark — Issue 3", "date": "2026-10-24", "pages": PAGES, "cover_image": pages[0],
                     "qa_verdict": "pass", "files": {"pdf_color": self.pdfs["pdf_color"][0], "pdf_grayscale": self.pdfs["pdf_grayscale"][0],
                     "pages_dir": "pages/", "page_count": PAGES, "pages": pages, "thumbs": thumbs,
                     "sha256": {k: hashlib.sha256(d).hexdigest() for k, (_, d) in self.pdfs.items()}}}
        entry = {k: self.meta[k] for k in ("issue", "title", "date", "pages", "cover_image")} | {"cover_thumb": thumbs[0]}
        self.manifest = {"schema": 1, "generated_at": "2026-10-23T18:00:00Z", "latest": 3,
                         "issues": [{"issue": 2, "title": "Two", "date": "2026-10-17", "pages": 16, "cover_image": "pages/p-01.webp"}, entry]}
        self.seen = []
    def open(self, req, timeout=None):
        url = req.full_url; self.seen.append(url)
        if url == ROOT + "meta.json": status, h, body = 200, {"Content-Type": "application/json"}, json.dumps(self.meta).encode()
        elif url == BASE + "/manifest.json": status, h, body = 200, {"Content-Type": "application/json; charset=utf-8"}, json.dumps(self.manifest).encode()
        else: status, h, body = self.routes.get(url, (404, {"Content-Type": "text/html"}, b"not found"))
        if status != 200: raise urllib.error.HTTPError(url, status, "x", h, io.BytesIO(body))
        return Resp(status, h, body)


class T(unittest.TestCase):
    def setUp(self): self.site = Site()

    def run_qa(self, *extra, attempts=1, site=None):
        out, err, sleeps = io.StringIO(), io.StringIO(), []
        with mock.patch.object(cq, "OPENER", site or self.site):
            rc = cq.main(["003", "--base", BASE, "--attempts", str(attempts), "--wait", "0", *extra], out=out, err=err, sleep=sleeps.append)
        return rc, out.getvalue(), err.getvalue()

    def expected_urls(self):
        f = self.site.meta["files"]
        return {BASE + "/manifest.json", ROOT + "meta.json", ROOT + f["pdf_color"], ROOT + f["pdf_grayscale"], *(ROOT + r for r in f["pages"] + f["thumbs"])}

    def test_ok_fetches_every_listed_file_once(self):
        rc, out, err = self.run_qa()
        self.assertEqual(rc, 0, err); self.assertIn("OK issue 003", out); self.assertIn("2 PDFs", out); self.assertIn(f"{2 * PAGES} page images", out)
        self.assertEqual(sorted(self.site.seen), sorted(self.expected_urls()))

    def test_missing_thumb_fails(self):
        rel = self.site.meta["files"]["thumbs"][1]; del self.site.routes[ROOT + rel]
        rc, out, err = self.run_qa()
        self.assertEqual(rc, 1); self.assertIn(f"FAIL: {ROOT}{rel}: HTTP 404", err); self.assertIn("::error::public QA failed for issue 003", out)

    def test_redirect_is_not_200(self):
        rel = self.site.meta["files"]["pages"][0]; self.site.routes[ROOT + rel] = (302, {"Location": "/elsewhere"}, b"")
        rc, out, err = self.run_qa()
        self.assertEqual(rc, 1); self.assertIn(f"{rel}: HTTP 302", err)

    def test_real_opener_does_not_follow_redirects(self):
        import urllib.request
        req = urllib.request.Request(ROOT + "meta.json")
        with self.assertRaises(urllib.error.HTTPError): cq.NoRedirect().redirect_request(req, io.BytesIO(), 301, "Moved", {}, BASE + "/x")
        self.assertTrue(any(isinstance(h, cq.NoRedirect) for h in cq.OPENER.handlers))

    def test_wrong_content_type_fails(self):
        for rel_of, ct in ((lambda f: f["pages"][2], "text/html"), (lambda f: f["thumbs"][0], "image/png"), (lambda f: f["pdf_color"], "application/octet-stream")):
            with self.subTest(ct=ct):
                self.site = Site(); rel = rel_of(self.site.meta["files"])
                status, h, body = self.site.routes[ROOT + rel]; self.site.routes[ROOT + rel] = (status, {**h, "Content-Type": ct}, body)
                rc, out, err = self.run_qa()
                self.assertEqual(rc, 1); self.assertIn(f"{rel}: Content-Type '{ct}'", err)

    def test_meta_wrong_content_type_fails_before_files(self):
        site = self.site; orig = site.open
        def open_(req, timeout=None):
            r = orig(req, timeout)
            if req.full_url.endswith("/meta.json"): r.headers = {"Content-Type": "text/plain"}
            return r
        site.open = open_
        rc, out, err = self.run_qa()
        self.assertEqual(rc, 1); self.assertIn("meta.json: Content-Type 'text/plain'", err)
        self.assertEqual(site.seen, [BASE + "/manifest.json", ROOT + "meta.json"])

    def test_pdf_hash_mismatch_fails(self):
        name = self.site.meta["files"]["pdf_grayscale"]; s, h, _ = self.site.routes[ROOT + name]
        self.site.routes[ROOT + name] = (s, {"Content-Type": "application/pdf"}, b"%PDF-1.7 different bytes")
        rc, out, err = self.run_qa()
        self.assertEqual(rc, 1); self.assertIn(f"{name}: SHA-256 differs from meta.json files.sha256", err)

    def test_content_length_mismatch_fails(self):
        name = self.site.meta["files"]["pdf_color"]; s, h, body = self.site.routes[ROOT + name]
        self.site.routes[ROOT + name] = (s, {**h, "Content-Length": str(len(body) + 1)}, body)
        rc, out, err = self.run_qa()
        self.assertEqual(rc, 1); self.assertIn("Content-Length", err)

    def test_image_bytes_must_match_name(self):
        rel = self.site.meta["files"]["pages"][1]; s, h, _ = self.site.routes[ROOT + rel]
        self.site.routes[ROOT + rel] = (s, h, b"RIFF a different picture")
        rc, out, err = self.run_qa()
        self.assertEqual(rc, 1); self.assertIn(f"{rel}: bytes do not match the content hash in the name", err)

    def test_unsafe_names_are_never_fetched(self):
        for field, bad in (("pdf_color", "../../manifest.json"), ("pdf_color", "x.pdf?y=1"), ("pages", "pages/../../../etc.webp"), ("thumbs", "https://evil.invalid/p-01.webp")):
            with self.subTest(bad=bad):
                self.site = Site(); f = self.site.meta["files"]
                if field in ("pages", "thumbs"): f[field][0] = bad
                else: f[field] = bad
                rc, out, err = self.run_qa()
                self.assertEqual(rc, 1); self.assertIn("meta.json:", err)
                self.assertFalse([u for u in self.site.seen if "evil" in u or ".." in u or "?" in u], self.site.seen)

    def test_legacy_meta_without_page_lists_fails(self):
        del self.site.meta["files"]["pages"], self.site.meta["files"]["thumbs"]
        rc, out, err = self.run_qa()
        self.assertEqual(rc, 1); self.assertIn("no files.pages / files.thumbs", err)

    def test_meta_for_another_issue_fails(self):
        self.site.meta["issue"] = 4
        rc, out, err = self.run_qa()
        self.assertEqual(rc, 1); self.assertIn("meta.json: issue is not 3", err)

    def test_manifest_checks(self):
        cases = (("missing", lambda m: m["issues"].pop(), "0 entries for issue 003"),
                 ("duplicate", lambda m: m["issues"].append(copy.deepcopy(m["issues"][-1])), "2 entries for issue 003"),
                 ("latest", lambda m: m.update(latest=2), "latest is 2, highest issue listed is 3"),
                 ("title", lambda m: m["issues"][-1].update(title="Old title"), "issue 003 title differs"),
                 ("cover_thumb", lambda m: m["issues"][-1].update(cover_thumb="pages/thumbs/p-01.webp"), "cover_thumb is not files.thumbs[0]"),
                 ("shape", lambda m: m.update(schema=2), "unexpected shape"))
        for label, change, msg in cases:
            with self.subTest(label):
                self.site = Site(); change(self.site.manifest)
                rc, out, err = self.run_qa()
                self.assertEqual(rc, 1); self.assertIn(msg, err)

    def test_older_issue_may_be_below_latest(self):
        self.site.manifest["issues"].append({"issue": 4, "title": "Four", "date": "2026-10-31", "pages": 16, "cover_image": "pages/p-01.webp"})
        self.site.manifest["latest"] = 4
        self.assertEqual(self.run_qa()[0], 0)

    def test_expect_meta(self):
        with tempfile.TemporaryDirectory() as d:
            local = Path(d) / "meta.json"
            committed = copy.deepcopy(self.site.meta); del committed["files"]["pages"], committed["files"]["thumbs"]  # as in the repo
            local.write_text(json.dumps(committed))
            self.assertEqual(self.run_qa("--expect-meta", str(local))[0], 0)
            committed["files"]["sha256"]["pdf_color"] = "0" * 64; local.write_text(json.dumps(committed))
            rc, out, err = self.run_qa("--expect-meta", str(local))
            self.assertEqual(rc, 1); self.assertIn("published files.sha256.pdf_color differs from the committed meta.json", err)

    def test_retries_until_the_issue_shows_up(self):
        site, entry = self.site, self.site.manifest["issues"].pop()
        orig = site.open; calls = {"n": 0}
        def open_(req, timeout=None):
            if req.full_url.endswith("/manifest.json"):
                calls["n"] += 1
                if calls["n"] == 2: site.manifest["issues"].append(entry)
            return orig(req, timeout)
        site.open = open_
        rc, out, err = self.run_qa(attempts=3)
        self.assertEqual(rc, 0, err); self.assertIn("attempt 1/3", out); self.assertEqual(calls["n"], 2)

    def test_gives_up_after_attempts(self):
        self.site.manifest["issues"].pop()
        rc, out, err = self.run_qa(attempts=2)
        self.assertEqual(rc, 1); self.assertIn("attempt 1/2", out); self.assertNotIn("attempt 2/2", out); self.assertIn("0 entries", err)

    def test_meta_unavailable_fails_fast(self):
        rc, out, err = self.run_qa(site=type("Down", (Site,), {"open": lambda self, req, timeout=None: (_ for _ in ()).throw(
            urllib.error.HTTPError(req.full_url, 503, "x", {}, io.BytesIO(b"")))})())
        self.assertEqual(rc, 1); self.assertIn("manifest.json: HTTP 503", err)

    def test_argument_checks(self):
        for argv in (["3"], ["000"], ["0a3"], ["003", "--base", "http://theribbon.fyi"]):
            with self.subTest(argv=argv):
                self.assertEqual(cq.main(argv, out=io.StringIO(), err=io.StringIO()), 2)

    def test_default_base(self):
        self.assertEqual(cq.BASE, "https://theribbon.fyi")


if __name__ == "__main__":
    unittest.main()
