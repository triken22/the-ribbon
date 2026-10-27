#!/usr/bin/env python3
"""CI only (.github/workflows/publish.yml, job qa): check a published issue on the live site the way a reader's browser fetches it.
Stdlib only (plus validate_issue.py from this directory, also stdlib only).

Usage: ci_qa_public.py NNN [--base https://theribbon.fyi] [--expect-meta issues/NNN/meta.json] [--attempts 4] [--wait 20]

Image names are per build (bookmark publish renders them), so the committed meta.json is not enough: this fetches BASE/manifest.json and
BASE/issues/NNN/meta.json, then GETs every file the published meta lists (files.pdf_color, files.pdf_grayscale, every files.pages and
files.thumbs entry) under BASE/issues/NNN/. It fails on:
  - a status other than 200 (redirects are not followed), a Content-Type other than application/json / application/pdf / image/webp,
    or a Content-Length that differs from the body received
  - a file name outside the publish allowlist (such a name is never fetched), a PDF whose SHA-256 differs from meta files.sha256, an
    image whose SHA-256 does not start with the 12 hex in its name
  - manifest.json without exactly one entry for NNN, a latest that is not the highest issue listed, or an entry that differs from meta
  - with --expect-meta: published PDF names or hashes that differ from the committed meta.json
The whole check is retried (--attempts, --wait seconds apart) so that a publish that just finished has time to show up.
"""
import argparse, hashlib, json, sys, time, urllib.error, urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import validate_issue as vi  # noqa: E402

BASE = "https://theribbon.fyi"  # the site origin (docs/DOMAIN.md); --base https://weekend-bookmark.pages.dev checks the Pages host itself
CT_JSON, CT_PDF, CT_WEBP = "application/json", "application/pdf", "image/webp"
MAX_BYTES = 200 * 1024 * 1024
ENTRY_KEYS = ("title", "date", "pages", "cover_image")  # manifest entry fields copied from meta (bookmark_publish.manifest_entry)


class Fail(Exception):
    """One problem; the message names the URL or field, never more than a short repr of remote data."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, "redirect not followed", headers, fp)


OPENER = urllib.request.build_opener(NoRedirect)
short = lambda v: repr(v)[:80]
obj = lambda v: v if isinstance(v, dict) else {}


def fetch(url, want_ct):
    req = urllib.request.Request(url, headers={"User-Agent": "weekend-bookmark-ci-qa", "Cache-Control": "no-cache", "Accept-Encoding": "identity"})
    try:
        with OPENER.open(req, timeout=60) as r:
            status, ct, cl, body = r.status, r.headers.get("Content-Type") or "", r.headers.get("Content-Length"), r.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as e: raise Fail(f"{url}: HTTP {e.code}")
    except Exception as e: raise Fail(f"{url}: request failed ({type(e).__name__})")
    if status != 200: raise Fail(f"{url}: HTTP {status}")
    if ct.split(";")[0].strip().lower() != want_ct: raise Fail(f"{url}: Content-Type {short(ct)}, want {want_ct}")
    if len(body) > MAX_BYTES: raise Fail(f"{url}: larger than {MAX_BYTES} bytes")
    if cl is not None and cl.strip() != str(len(body)): raise Fail(f"{url}: Content-Length {short(cl)} but {len(body)} bytes received")
    return body


def fetch_json(url):
    try: return json.loads(fetch(url, CT_JSON))
    except ValueError: raise Fail(f"{url}: not valid JSON")


def file_list(n, meta):
    """([(rel, content type, check, expected)], errors). Pure. check is 'sha256' (whole file) or 'name' (12-hex prefix in the name)."""
    if not isinstance(meta, dict) or meta.get("issue") != n: return [], [f"meta.json: issue is not {n}"]
    f, errs, out = meta.get("files"), [], []
    if not isinstance(f, dict): return [], ["meta.json: no files object"]
    sha = obj(f.get("sha256"))
    for k in ("pdf_color", "pdf_grayscale"):
        name, want = f.get(k), sha.get(k)
        if not (isinstance(name, str) and vi.PDF.fullmatch(name)): errs.append(f"meta.json: files.{k} {short(name)} is not an allowed PDF name"); continue
        if not (isinstance(want, str) and vi.HEX64.fullmatch(want)): errs.append(f"meta.json: files.sha256.{k} is not 64 lowercase hex"); continue
        out.append((name, CT_PDF, "sha256", want))
    pages, thumbs, ierrs = vi.image_lists(meta)
    errs += [f"meta.json: {e}" for e in ierrs]
    if pages is None and not ierrs: errs.append("meta.json: no files.pages / files.thumbs (not a bookmark publish build)")
    if pages is not None:
        if meta.get("cover_image") != pages[0]: errs.append("meta.json: cover_image is not files.pages[0]")
        for rel in pages + thumbs: out.append((rel, CT_WEBP, "name", rel.rsplit(".", 2)[1]))
    return out, errs


def check_manifest(n, man, meta):
    """Errors (pure): exactly one entry for n, latest = highest issue listed, entry equal to what publish derives from meta."""
    if not (isinstance(man, dict) and man.get("schema") == 1 and isinstance(man.get("issues"), list)): return ["manifest.json: unexpected shape"]
    issues = man["issues"]
    nums = [i.get("issue") if isinstance(i, dict) else None for i in issues]
    if not all(isinstance(x, int) and not isinstance(x, bool) for x in nums) or not nums: return ["manifest.json: issues must be objects with an integer issue"]
    errs = []
    if man.get("latest") != max(nums): errs.append(f"manifest.json: latest is {short(man.get('latest'))}, highest issue listed is {max(nums)}")
    mine = [i for i in issues if i["issue"] == n]
    if len(mine) != 1: return errs + [f"manifest.json: {len(mine)} entries for issue {n:03d} (want exactly 1)"]
    e, m = mine[0], obj(meta)
    for k in ENTRY_KEYS:
        if e.get(k) != m.get(k): errs.append(f"manifest.json: issue {n:03d} {k} differs from meta.json")
    thumbs = obj(m.get("files")).get("thumbs")
    if not (isinstance(thumbs, list) and thumbs and e.get("cover_thumb") == thumbs[0]): errs.append(f"manifest.json: issue {n:03d} cover_thumb is not files.thumbs[0]")
    return errs


def check_expected(meta, local):
    """Errors (pure): the published PDFs are the ones committed in the repo (same names, same SHA-256)."""
    if not isinstance(local, dict) or not isinstance(local.get("files"), dict): return ["--expect-meta: not a meta.json"]
    m = obj(meta)
    lf, rf = local["files"], obj(m.get("files"))
    errs = [] if local.get("issue") == m.get("issue") else ["--expect-meta: issue differs from the published meta.json"]
    for k in ("pdf_color", "pdf_grayscale"):
        if lf.get(k) != rf.get(k): errs.append(f"published files.{k} differs from the committed meta.json")
        if obj(lf.get("sha256")).get(k) != obj(rf.get("sha256")).get(k): errs.append(f"published files.sha256.{k} differs from the committed meta.json")
    return errs


def check(n, base, expect=None):
    """(errors, summary). Fetches the manifest and meta, then every listed file."""
    root = f"{base}/issues/{n:03d}/"
    try: man, meta = fetch_json(f"{base}/manifest.json"), fetch_json(root + "meta.json")
    except Fail as e: return [str(e)], None
    files, errs = file_list(n, meta)
    errs += check_manifest(n, man, meta)
    if expect is not None: errs += check_expected(meta, expect)
    for rel, ct, how, want in files:
        url = root + rel
        try: h = hashlib.sha256(fetch(url, ct)).hexdigest()
        except Fail as e: errs.append(str(e)); continue
        if how == "sha256" and h != want: errs.append(f"{url}: SHA-256 differs from meta.json files.sha256")
        if how == "name" and h[:vi.HASH_LEN] != want: errs.append(f"{url}: bytes do not match the content hash in the name")
    n_img = sum(1 for _, ct, *_ in files if ct == CT_WEBP)
    return errs, (f"issue {n:03d} on {base}: manifest.json (latest {man.get('latest')}), meta.json, "
                  f"{len(files) - n_img} PDFs (SHA-256 match), {n_img} page images and thumbs (hash names match), all 200 with the right type")


def main(argv=None, out=None, err=None, sleep=time.sleep):
    out, err = out or sys.stdout, err or sys.stderr
    ap = argparse.ArgumentParser(prog="ci_qa_public.py")
    ap.add_argument("issue", help="three digits, e.g. 003")
    ap.add_argument("--base", default=BASE)
    ap.add_argument("--expect-meta", help="committed issues/NNN/meta.json to compare the published PDF names and hashes with")
    ap.add_argument("--attempts", type=int, default=4); ap.add_argument("--wait", type=float, default=20)
    a = ap.parse_args(argv)
    if not (len(a.issue) == 3 and a.issue.isdigit() and a.issue != "000"): err.write("issue must be three digits, 001-999\n"); return 2
    base = a.base.rstrip("/")
    if not base.startswith("https://"): err.write("--base must be an https:// URL\n"); return 2
    expect = None
    if a.expect_meta:
        try: expect = json.loads(Path(a.expect_meta).read_text())
        except Exception as e: err.write(f"--expect-meta unreadable ({type(e).__name__})\n"); return 2
    n, attempts = int(a.issue), max(1, a.attempts)
    for i in range(1, attempts + 1):
        errs, summary = check(n, base, expect)
        if not errs: out.write(f"OK {summary}\n"); return 0
        if i < attempts:
            out.write(f"attempt {i}/{attempts}: {len(errs)} problem(s), first: {errs[0]}; retrying in {a.wait:g}s\n"); out.flush(); sleep(a.wait)
    out.write(f"::error::public QA failed for issue {n:03d} ({len(errs)} problem(s), see the log)\n")
    for e in errs[:40]: err.write(f"FAIL: {e}\n")
    return 1


if __name__ == "__main__":
    sys.exit(main())
