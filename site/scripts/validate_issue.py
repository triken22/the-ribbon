#!/usr/bin/env python3
"""Allowlist validator for issues/NNN/meta.json (stdlib only). Usage: validate_issue.py <issue-dir> [...]
Exit 0 = valid. Checks keys, types, X-URL pattern, snippet length, file hashes and page images.

Page images come in two shapes:
  per-build (written by `bookmark publish`): files.pages / files.thumbs list every image as pages/p-NN.<hash12>.webp and
    pages/thumbs/p-NN.<hash12>.webp, where <hash12> is the first 12 hex digits of the file's own SHA-256 (checked here), and
    cover_image == files.pages[0]. A changed image therefore always gets a new URL, so a stale immutable cache can never stick.
  legacy (engine output, dev fixtures): no files.pages / files.thumbs; images are pages/p-NN.webp and pages/thumbs/p-NN.webp."""
import hashlib, json, re, sys
from pathlib import Path

TOP = {"issue", "title", "date", "pages", "cover_headline", "cover_image", "qa_verdict", "sections", "articles", "files", "image_credits"}
SEC = {"slug", "label", "page_start", "page_end"}
ART = {"id", "headline", "section", "page", "kind", "sources"}
SRC = {"post_id", "url", "author_handle", "author_name", "snippet"}
FIL = {"pdf_color", "pdf_grayscale", "pages_dir", "page_count", "sha256"}
FIL_IMAGES = {"pages", "thumbs"}  # optional pair: present on everything bookmark publish uploads
KINDS = {"cover", "feature", "brief", "department", "column", "list"}
URL = re.compile(r"https://x\.com/([A-Za-z0-9_]{1,15})/status/([0-9]{1,25})")  # always used with fullmatch (a trailing newline must fail)
PDF = re.compile(r"[a-z0-9-]{1,80}\.pdf")  # same limit as the Pages Function route (Codex #4)
HEX64 = re.compile(r"[0-9a-f]{64}")
HASH_LEN = 12
PAGE_IMG = re.compile(r"pages/p-(\d{2,3})\.([0-9a-f]{12})\.webp")
THUMB_IMG = re.compile(r"pages/thumbs/p-(\d{2,3})\.([0-9a-f]{12})\.webp")


def page_name(i, data, thumb=False):
    """Per-build name for page i: the content hash is part of the URL."""
    return f"pages/{'thumbs/' if thumb else ''}p-{i:02d}.{hashlib.sha256(data).hexdigest()[:HASH_LEN]}.webp"


def image_lists(m):
    """(pages, thumbs, errors). pages/thumbs are the per-build lists, or None for the legacy shape. Pure: no file access."""
    f = m.get("files") if isinstance(m, dict) else None
    n = m.get("pages") if isinstance(m, dict) else None
    if not isinstance(f, dict) or not (f.keys() & FIL_IMAGES): return None, None, []
    if not FIL_IMAGES <= f.keys(): return None, None, ["files.pages and files.thumbs must be given together"]
    errs, out = [], []
    for k, rx in (("pages", PAGE_IMG), ("thumbs", THUMB_IMG)):
        lst = f[k]
        if not isinstance(lst, list) or not isinstance(n, int) or len(lst) != n:
            errs.append(f"files.{k} must list exactly one image per page"); out.append(None); continue
        for i, name in enumerate(lst, 1):
            mt = rx.fullmatch(name) if isinstance(name, str) else None
            if not mt or mt.group(1) != f"{i:02d}":
                errs.append(f"files.{k}[{i - 1}] must be {'pages/thumbs' if k == 'thumbs' else 'pages'}/p-{i:02d}.<12 hex>.webp")
        if len(set(lst)) != len(lst): errs.append(f"files.{k}: duplicate names")
        out.append(lst)
    if errs: return None, None, errs
    return out[0], out[1], []


def keys(obj, allowed, where, errs):
    if not isinstance(obj, dict):
        errs.append(f"{where}: expected object"); return False
    for k in obj.keys() - allowed: errs.append(f"{where}: unexpected key '{k}'")
    for k in allowed - obj.keys(): errs.append(f"{where}: missing key '{k}'")
    return True


def check(d: Path):
    errs = []
    m = json.loads((d / "meta.json").read_text())
    if not keys(m, TOP, "meta", errs): return errs
    pages, thumbs, ierrs = image_lists(m)
    errs += ierrs
    if m["issue"] != int(d.name) : errs.append("issue does not match directory")
    if m["qa_verdict"] != "pass": errs.append("qa_verdict must be 'pass'")
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", str(m["date"])): errs.append("date must be YYYY-MM-DD")
    if len(str(m["title"])) > 80 or len(str(m["cover_headline"])) > 160: errs.append("title/cover_headline too long")
    if pages is not None:
        if m["cover_image"] != pages[0]: errs.append("cover_image must equal files.pages[0]")
    elif not ierrs and m["cover_image"] != "pages/p-01.webp": errs.append("cover_image must be pages/p-01.webp")
    slugs = set()
    for i, s in enumerate(m["sections"]):
        if keys(s, SEC, f"sections[{i}]", errs):
            slugs.add(s["slug"])
            if not re.fullmatch(r"[a-z0-9-]{1,40}", str(s["slug"])): errs.append(f"sections[{i}].slug invalid")
    ids = set()
    for i, a in enumerate(m["articles"]):
        if not keys(a, ART, f"articles[{i}]", errs): continue
        if a["id"] in ids: errs.append(f"articles[{i}].id duplicate")
        ids.add(a["id"])
        if a["section"] not in slugs: errs.append(f"articles[{i}].section unknown")
        if a["kind"] not in KINDS: errs.append(f"articles[{i}].kind invalid")
        if not 1 <= a["page"] <= m["pages"]: errs.append(f"articles[{i}].page out of range")
        for j, s in enumerate(a["sources"]):
            w = f"articles[{i}].sources[{j}]"
            if not keys(s, SRC, w, errs): continue
            u = URL.fullmatch(str(s["url"]))
            if not u or u.group(1).lower() != str(s["author_handle"]).lower() or u.group(2) != str(s["post_id"]): errs.append(f"{w}: url must be https://x.com/<handle>/status/<post_id> and match handle/post_id")
            if len(str(s["snippet"])) > 200: errs.append(f"{w}: snippet > 200 chars")
            if len(str(s["author_name"])) > 80: errs.append(f"{w}: author_name > 80 chars")
    f = m["files"]
    if keys(f, FIL | (FIL_IMAGES if f.keys() & FIL_IMAGES else set()) if isinstance(f, dict) else FIL, "files", errs):
        if f["pages_dir"] != "pages/": errs.append("files.pages_dir must be 'pages/'")
        sha = f["sha256"]
        if not isinstance(sha, dict) or set(sha) != {"pdf_color", "pdf_grayscale"} or not all(isinstance(v, str) and HEX64.fullmatch(v) for v in sha.values()):
            errs.append("files.sha256 must be {pdf_color, pdf_grayscale} of 64-char lowercase hex")
            sha = {}
        for k in ("pdf_color", "pdf_grayscale"):
            name = f[k]
            if not isinstance(name, str) or not PDF.fullmatch(name):
                errs.append(f"files.{k}: must match [a-z0-9-]+.pdf (no path separators)"); continue
            p = d / name
            if not p.is_file(): errs.append(f"files.{k}: {name} not found")
            elif hashlib.sha256(p.read_bytes()).hexdigest() != sha.get(k): errs.append(f"files.{k}: sha256 mismatch")
        if pages is not None:
            for rel in pages + thumbs:
                p = d / rel
                if not p.is_file(): errs.append(f"missing {rel}")
                elif hashlib.sha256(p.read_bytes()).hexdigest()[:HASH_LEN] != rel.rsplit(".", 2)[1]: errs.append(f"{rel}: content hash does not match the name")
        elif not ierrs:
            for n in range(1, m["pages"] + 1):
                for sub in ("pages", "pages/thumbs"):
                    if not (d / sub / f"p-{n:02d}.webp").is_file(): errs.append(f"missing {sub}/p-{n:02d}.webp")
    if not isinstance(m["image_credits"], list): errs.append("image_credits must be a list")
    else:
        for i, x in enumerate(m["image_credits"]):
            if not isinstance(x, str): errs.append(f"image_credits[{i}] must be a string")
            elif len(x) > 200 or any(t in x.lower() for t in ("://", "www.", "<", ">")): errs.append(f"image_credits[{i}]: max 200 chars, no URLs or angle brackets")
    return errs


if __name__ == "__main__":
    bad = 0
    for arg in sys.argv[1:]:
        e = check(Path(arg))
        print(("OK   " if not e else "FAIL ") + arg)
        for x in e[:40]: print("   -", x)
        bad += bool(e)
    sys.exit(1 if bad else 0)
