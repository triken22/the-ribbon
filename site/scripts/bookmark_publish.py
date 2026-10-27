#!/usr/bin/env python3
"""bookmark publish NNN: gate, strip, check, audit, validate, record SHA-256, upload to the private R2 bucket.

Usage: bookmark publish NNN [--src DIR] [--gate-dir DIR] [--dry-run | --execute] [--replace] [--no-signoff]

Order (docs/PIPELINE-SPEC.md sections 4, 4a, 4b; any failure exits non-zero and uploads nothing further):
  0 gate     gate dir is 700 and ours; QA verdict file is PASS; NNN.approval is signed (ssh-keygen -Y) by the PINNED key in
             site/keys/approval_allowed_signers; PDF SHA-256 equals the signed hashes and meta.json files.sha256.
             --no-signoff (owner's explicit choice) skips ONLY the signed approval: the approved hashes are then meta.json
             files.sha256, every other step is unchanged, and each run appends one JSON line to the publish log (see open_log()).
  1 stage    the source dir may hold only meta.json, the two PDFs and (ignored) legacy engine page images; ONLY meta.json and the
             two PDFs are copied into a private staging dir (mkdtemp, mode 700). Engine/legacy images are never uploaded.
  2 strip    strip_metadata.py strip + check on the staged PDFs; their bytes must still equal the signed hashes. The only annotations
             that survive (and that check accepts) are minimal x.com/twitter.com status links; their count per PDF is printed
  3 render   reader images are rendered HERE from the approved stripped colour PDF: pdftoppm, one page per call, into a second
             private dir (mkdtemp, mode 700) whose contents must be exactly r-001.png..r-NNN.png. Page count = PDF page count
             (pypdf and pdfinfo, both PDFs) = meta.pages = files.page_count, else refuse. Nothing is globbed from /tmp or cwd.
             Images are named per build: pages/p-NN.<sha256[:12]>.webp, pages/thumbs/p-NN.<sha256[:12]>.webp (meta.json lists them).
  4 verify   image gate: every page is rendered AGAIN, independently, in a third private dir, and each uploaded page and thumb must
             (a) be WebP 1200 / 400 px wide, (b) carry its own content hash in its name, (c) be byte-identical to the re-render and
             (d) match the raw PDF raster within tight pixel-diff limits (DIFF_LIMITS). Any mismatch refuses.
  5 validate strip_metadata.py check + audit and validate_issue.py on the final staged issue dir (check fails on any annotation other
             than a minimal X status link)
  6 record   qa.json (the build record, outside the issue dir) lists the SHA-256 and size of EVERY object to upload and the
             manifest entry, with a generated_at timestamp. The upload refuses if it misses or adds a file, any hash differs, or it
             predates any file it covers. Each object's bytes are hashed again immediately before its PUT.
  7 upload   pages + PDFs, then meta.json, then manifest.json LAST with If-Match on its ETag.
             Immutable objects (pages, thumbs, PDFs) are never overwritten with different bytes; identical ones are skipped,
             so an interrupted publish (e.g. manifest CAS lost) is resumable without --replace.

Gate files live OUTSIDE the issue directory (the audit forbids extra files), in --gate-dir (or $BOOKMARK_GATE_DIR), mode 700, owned by the runner:
  NNN.qa.json       {"issue": N, "qa_verdict": "pass"}       written by the QA gate
  NNN.approval      canonical approval text (see approval_message())   written by the owner on their own machine
  NNN.approval.sig  ssh-keygen -Y sign -n weekend-bookmark-approval over NNN.approval, by the owner's key; agents never sign
  A legacy plain NNN.APPROVED file is refused: it proves nothing.
Credentials: ONLY from the env file named by $BOOKMARK_ENV_FILE (default ~/.config/weekend-bookmark/r2.env). See docs/PUBLISH.md.
Needs: pypdf, Pillow (with WebP), poppler (pdftoppm, pdfinfo), boto3 (boto3 only for --execute).
"""
import argparse, contextlib, datetime, hashlib, io, json, os, re, shutil, stat, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import strip_metadata as sm  # noqa: E402
import validate_issue as vi  # noqa: E402

BUCKET = "weekend-bookmark-issues"  # fixed; there is deliberately no flag to change it
DEFAULT_ENV = "~/.config/weekend-bookmark/r2.env"
IMMUTABLE = "public, max-age=31536000, immutable"
SHORT = "public, max-age=60"
CT = {".pdf": "application/pdf", ".webp": "image/webp", ".json": "application/json"}
ENV_KEYS = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET")
ACCOUNT = re.compile(r"[0-9a-f]{32}")
MANIFEST_KEYS = ("issue", "title", "date", "pages", "cover_image", "cover_thumb")
# Reader images (rendered here, never taken from the engine or a shared temp dir).
RENDER_DPI = 150
PAGE_W, THUMB_W = 1200, 400
WEBP_QUALITY, WEBP_METHOD = 85, 4
# Pixel diff between an uploaded image and a fresh raster of its PDF page (grey-level of |a-b|, 0..255). Measured on issues 002/003:
# a correct page scores mean <= 1.4, >32 fraction <= 0.2 %, worst 1/64 tile <= 4 (thumbs <= 1.9 / 0.2 % / 6.2);
# the 18 Oct stray price list vs its slot scored mean 54, and any neighbouring page >= 30.
DIFF_LIMITS = {"mean": 4.0, "over32": 0.01, "tile": 12.0}
RECORD_SCHEMA = "weekend-bookmark build record v1"
# Signed approval gate. The allowed_signers path is a constant on purpose: no flag or env var can point it elsewhere.
ALLOWED_SIGNERS = HERE.parent / "keys" / "approval_allowed_signers"
SIG_NAMESPACE = "weekend-bookmark-approval"
SIG_PRINCIPAL = "owner"
APPROVAL_HEADER = "weekend-bookmark approval v1"
DEFAULT_LOG = "~/.local/state/weekend-bookmark/publish.log"  # --no-signoff audit log; override with $BOOKMARK_PUBLISH_LOG


class Refuse(Exception):
    """Fail closed: message is safe to print (never contains secrets)."""


# ------------------------------------------------------------------ env file
def inside_git_worktree(path: Path):
    for p in [path.resolve().parent, *path.resolve().parent.parents]:
        if (p / ".git").exists(): return True
    return False


def load_env(path):
    p = Path(os.path.expanduser(str(path)))
    if not p.exists(): raise Refuse(f"env file not found: {p}")
    if p.is_symlink(): raise Refuse("env file must not be a symlink")
    st, dst = p.stat(), p.parent.stat()
    if not stat.S_ISREG(st.st_mode): raise Refuse("env file is not a regular file")
    if stat.S_IMODE(st.st_mode) != 0o600: raise Refuse(f"env file mode must be 600 (is {stat.S_IMODE(st.st_mode):o})")
    if stat.S_IMODE(dst.st_mode) != 0o700: raise Refuse(f"env file directory mode must be 700 (is {stat.S_IMODE(dst.st_mode):o})")
    if st.st_uid != os.getuid() or dst.st_uid != os.getuid(): raise Refuse("env file and its directory must be owned by the running user")
    if inside_git_worktree(p): raise Refuse("env file must not live inside a git work tree")
    env = {}
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line: continue
        k, v = line.split("=", 1)
        k = k.strip().removeprefix("export ").strip()
        if k in ENV_KEYS: env[k] = v.strip().strip("'\"")
    missing = [k for k in ENV_KEYS if not env.get(k)]
    if missing: raise Refuse("env file is missing: " + ", ".join(missing))
    if env["R2_BUCKET"] != BUCKET: raise Refuse(f"R2_BUCKET must be {BUCKET}")
    if not ACCOUNT.fullmatch(env["R2_ACCOUNT_ID"]): raise Refuse("R2_ACCOUNT_ID must be 32 hex characters")
    return env


def make_client(env):
    import boto3  # lazy: tests and dry-runs do not need it
    from botocore.config import Config
    return boto3.client("s3", endpoint_url=f"https://{env['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com", region_name="auto",
                        aws_access_key_id=env["R2_ACCESS_KEY_ID"], aws_secret_access_key=env["R2_SECRET_ACCESS_KEY"],
                        config=Config(retries={"max_attempts": 3, "mode": "standard"}, signature_version="s3v4"))


# ------------------------------------------------------------------ helpers
sha256 = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
md5hex = lambda b: hashlib.md5(b, usedforsecurity=False).hexdigest()  # only to compare with the R2/S3 single-part ETag


def read_json(p, what):
    try: return json.loads(Path(p).read_text())
    except Exception as e: raise Refuse(f"{what} unreadable: {type(e).__name__}")


def approval_message(n, hashes):
    """The exact bytes the owner signs. Any other byte sequence is refused."""
    return (f"{APPROVAL_HEADER}\nissue: {n:03d}\npdf_color: {hashes['pdf_color']}\npdf_grayscale: {hashes['pdf_grayscale']}\n").encode()


def parse_approval(n, data):
    """Strict parse of NNN.approval; returns the hashes. Must round-trip byte for byte through approval_message()."""
    try: lines = data.decode("ascii").split("\n")
    except UnicodeDecodeError: raise Refuse("approval file is malformed (not ASCII)")
    if len(lines) != 5 or lines[4] != "" or lines[0] != APPROVAL_HEADER: raise Refuse("approval file is malformed")
    kv = {}
    for line, want in zip(lines[1:4], ("issue", "pdf_color", "pdf_grayscale")):
        k, sep, v = line.partition(": ")
        if not sep or k != want: raise Refuse("approval file is malformed")
        kv[k] = v
    if kv["issue"] != f"{n:03d}": raise Refuse("approval file is for a different issue")
    hs = {k: kv[k] for k in ("pdf_color", "pdf_grayscale")}
    if not all(vi.HEX64.fullmatch(v) and v == v.lower() for v in hs.values()): raise Refuse("approval file is malformed (hashes)")
    if approval_message(n, hs) != data: raise Refuse("approval file is malformed (not canonical)")
    return hs


def pinned_signers():
    p = ALLOWED_SIGNERS
    if p.is_symlink() or not p.is_file(): raise Refuse("pinned allowed_signers file missing")
    keys = [l for l in p.read_text().splitlines() if l.strip() and not l.lstrip().startswith("#")]
    if not keys: raise Refuse("no pinned approval key in site/keys/approval_allowed_signers yet (placeholder); the repo owner must pin their public key")
    for l in keys:
        if not l.startswith(f'{SIG_PRINCIPAL} namespaces="{SIG_NAMESPACE}" '): raise Refuse("pinned allowed_signers line has the wrong principal or namespace")
    return p


def verify_signature(data, sig_path):
    """Verifies the exact bytes that were parsed (no re-read, so the checked text and the verified text cannot differ)."""
    signers = pinned_signers()
    exe = shutil.which("ssh-keygen")
    if not exe: raise Refuse("ssh-keygen not found (OpenSSH 8.2+ needed to verify the approval signature)")
    r = subprocess.run([exe, "-Y", "verify", "-f", str(signers), "-I", SIG_PRINCIPAL, "-n", SIG_NAMESPACE, "-s", str(sig_path)],
                       input=data, capture_output=True, timeout=30)
    if r.returncode != 0: raise Refuse("approval signature does not verify against the pinned key")


def check_gate_dir(g):
    if g.is_symlink() or not g.is_dir(): raise Refuse("gate dir missing or a symlink")
    st = g.stat()
    if stat.S_IMODE(st.st_mode) != 0o700: raise Refuse(f"gate dir mode must be 700 (is {stat.S_IMODE(st.st_mode):o})")
    if st.st_uid != os.getuid(): raise Refuse("gate dir must be owned by the running user")


def gate_file(g, name, what):
    p = g / name
    if p.is_symlink(): raise Refuse(f"{what} must not be a symlink: {name}")
    if not p.is_file(): raise Refuse(f"{what} missing: {name}")
    return p


def gate(n, src, gate_dir, signoff=True):
    """Step 0. Returns (meta, approved_hashes). The hashes come ONLY from a file whose signature verifies against the pinned key,
    or, with signoff=False (--no-signoff), from meta.json files.sha256; everything else here is checked either way."""
    if not gate_dir: raise Refuse("no gate dir: pass --gate-dir or set BOOKMARK_GATE_DIR")
    g = Path(gate_dir)
    if inside(g, src) or inside(src, g): raise Refuse("gate dir must be outside the issue directory")
    check_gate_dir(g)
    if (g / f"{n:03d}.APPROVED").exists() or (g / f"{n:03d}.APPROVED").is_symlink():
        raise Refuse(f"legacy {n:03d}.APPROVED found: plain approval files are no longer accepted (use the signed {n:03d}.approval + .sig)")
    qa = read_json(gate_file(g, f"{n:03d}.qa.json", "QA verdict file"), "QA verdict")
    if not (isinstance(qa, dict) and qa.get("issue") == n and qa.get("qa_verdict") == "pass"): raise Refuse("QA verdict is not PASS for this issue")
    if signoff:
        msg_p = gate_file(g, f"{n:03d}.approval", "signed approval")
        sig_p = gate_file(g, f"{n:03d}.approval.sig", "approval signature (unsigned approvals are refused)")
        data = msg_p.read_bytes()
        hs = parse_approval(n, data)
        verify_signature(data, sig_p)
    meta = read_json(Path(src) / "meta.json", "meta.json")
    if not isinstance(meta, dict) or meta.get("issue") != n or meta.get("qa_verdict") != "pass": raise Refuse("meta.json: issue/qa_verdict do not match")
    f = meta.get("files") or {}
    if not signoff:
        rec = f.get("sha256")
        hs = {k: rec.get(k) for k in ("pdf_color", "pdf_grayscale")} if isinstance(rec, dict) else {}
        if not hs or not all(isinstance(v, str) and vi.HEX64.fullmatch(v) and v == v.lower() for v in hs.values()):
            raise Refuse("meta.json files.sha256 must hold lowercase SHA-256 for pdf_color and pdf_grayscale (--no-signoff)")
    for k in ("pdf_color", "pdf_grayscale"):
        name = f.get(k)
        if not isinstance(name, str) or not sm.PDF_NAME.fullmatch(name) or not (Path(src) / name).is_file(): raise Refuse(f"files.{k}: PDF missing or bad name")
        got = sha256(Path(src) / name)
        if got != hs[k]: raise Refuse(f"{k}: SHA-256 does not match the {'signed approved hash' if signoff else 'meta.json files.sha256 (--no-signoff)'}")
        if got != (f.get("sha256") or {}).get(k): raise Refuse(f"{k}: SHA-256 does not match meta.json files.sha256")
    return meta, hs


def inside(a, b):
    a, b = Path(a).resolve(), Path(b).resolve()
    return a == b or b in a.parents


# ------------------------------------------------------------------ staging and rendering
@contextlib.contextmanager
def private_dir(prefix):
    """A fresh mkdtemp directory (mode 700, ours, not a symlink), removed afterwards. Never a shared or predictable path."""
    d = Path(tempfile.mkdtemp(prefix=prefix))
    try:
        os.chmod(d, 0o700)
        st = os.lstat(d)
        if not stat.S_ISDIR(st.st_mode) or stat.S_IMODE(st.st_mode) != 0o700 or st.st_uid != os.getuid(): raise Refuse("private temp dir is not mode 700 / ours")
        yield d
    finally:
        shutil.rmtree(d, ignore_errors=True)


def legacy_image(rel, pages):
    m = re.fullmatch(r"pages/(?:thumbs/)?p-(\d{2,3})(?:\.[0-9a-f]{12})?\.webp", rel)
    return bool(m) and 1 <= int(m.group(1)) <= pages


def stage_source(src, staged, meta):
    """Step 1. The source dir may hold meta.json, the two PDFs and (ignored) engine page images under pages/ and pages/thumbs/; nothing
    else. Only meta.json and the PDFs are copied: reader images are always rendered by this script from the approved PDF."""
    src, errs, ignored = Path(src), [], 0
    pdfs = {meta["files"]["pdf_color"], meta["files"]["pdf_grayscale"]}
    for p in sorted(src.rglob("*")):
        rel = p.relative_to(src).as_posix()
        if p.is_symlink(): errs.append(f"{rel}: symlink not allowed")
        elif p.is_dir():
            if rel not in ("pages", "pages/thumbs"): errs.append(f"{rel}/: unexpected directory")
        elif rel == "meta.json" or rel in pdfs: continue
        elif legacy_image(rel, meta["pages"]): ignored += 1
        else: errs.append(f"{rel}: not allowed in the source dir")
    if errs: raise Refuse("source audit: " + "; ".join(errs[:5]))
    staged.mkdir(mode=0o700)
    for name in ["meta.json", *sorted(pdfs)]: shutil.copyfile(src / name, staged / name, follow_symlinks=False)
    return ignored


def tool(name):
    exe = shutil.which(name)
    if not exe: raise Refuse(f"{name} not found (install poppler: brew install poppler / apt install poppler-utils)")
    return exe


def pdf_page_count(pdf):
    """Page count as pypdf AND poppler (the renderer) see it; they must agree."""
    from pypdf import PdfReader
    n = len(PdfReader(str(pdf)).pages)
    r = subprocess.run([tool("pdfinfo"), str(pdf)], capture_output=True, text=True, timeout=60)
    m = re.search(r"^Pages:\s+(\d+)\s*$", r.stdout, re.M)
    if r.returncode != 0 or not m: raise Refuse(f"pdfinfo could not read {Path(pdf).name}")
    if int(m.group(1)) != n: raise Refuse(f"{Path(pdf).name}: pypdf sees {n} pages, poppler sees {m.group(1)}")
    return n


def rasterize(pdf, i, outdir):
    """Page i of pdf as a PNG at RENDER_DPI, written to outdir/r-iii.png (exact name, -singlefile: no page-number suffix games)."""
    out = Path(outdir) / f"r-{i:03d}"
    r = subprocess.run([tool("pdftoppm"), "-r", str(RENDER_DPI), "-png", "-f", str(i), "-l", str(i), "-singlefile", str(pdf), str(out)],
                       capture_output=True, timeout=300)
    png = out.with_suffix(".png")
    if r.returncode != 0 or not png.is_file() or png.is_symlink(): raise Refuse(f"pdftoppm failed on page {i}")
    return png


def workers(): return max(1, min(8, os.cpu_count() or 1))


def rasterize_all(pdf, n, outdir):
    """All n pages into the private outdir, in parallel. Returned by page index, never by sorting a directory listing.
    The directory must then hold exactly r-001.png..r-NNN.png: a stray or missing file refuses."""
    with ThreadPoolExecutor(max_workers=workers()) as ex:
        pngs = list(ex.map(lambda i: rasterize(pdf, i, outdir), range(1, n + 1)))
    want = {f"r-{i:03d}.png" for i in range(1, n + 1)}
    have = set(os.listdir(outdir))
    if have != want:
        extra, missing = sorted(have - want), sorted(want - have)
        raise Refuse(f"render dir does not hold exactly one image per PDF page (unexpected: {extra[:3]}, missing: {missing[:3]})")
    if [p.name for p in pngs] != sorted(want): raise Refuse("render order mismatch")
    return pngs


def load_rgb(png):
    from PIL import Image
    with Image.open(png) as im:
        im.load(); return im.convert("RGB")


def scaled(im, width):
    from PIL import Image
    return im if im.width == width else im.resize((width, max(1, round(im.height * width / im.width))), Image.LANCZOS)


def encode_webp(im, width):
    """Deterministic: same raster + same Pillow/libwebp = same bytes. No EXIF/XMP/ICC is written."""
    im = scaled(im, width).copy(); im.info.clear()
    b = io.BytesIO(); im.save(b, "WEBP", quality=WEBP_QUALITY, method=WEBP_METHOD); return b.getvalue()


def write_new(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "xb") as f: f.write(data)  # never overwrite: a name collision means something else wrote here


def build_images(pdf, n, staged):
    """Step 3. Render every page of the approved stripped PDF and write per-build names into staged/pages. Returns (pages, thumbs)."""
    def enc(png):
        im = load_rgb(png); return encode_webp(im, PAGE_W), encode_webp(im, THUMB_W)
    pages, thumbs = [], []
    with private_dir("bookmark-render-") as rdir:
        pngs = rasterize_all(pdf, n, rdir)
        with ThreadPoolExecutor(max_workers=workers()) as ex: encoded = list(ex.map(enc, pngs))
    for i, (page, thumb) in enumerate(encoded, 1):  # by page index
        for data, is_thumb, lst in ((page, False, pages), (thumb, True, thumbs)):
            rel = vi.page_name(i, data, is_thumb); write_new(staged / rel, data); lst.append(rel)
    if len(pages) != n or len(thumbs) != n: raise Refuse("image count differs from PDF page count")
    return pages, thumbs


def pixel_diff(a, b):
    """{mean, over32, tile}: grey level of |a-b| over the whole image, share of pixels off by more than 32, worst of 8x8 tiles."""
    from PIL import ImageChops
    if a.size != b.size: return {"mean": 255.0, "over32": 1.0, "tile": 255.0}
    d = ImageChops.difference(a, b).convert("L")
    h = d.histogram(); tot = sum(h) or 1
    mean = sum(i * c for i, c in enumerate(h)) / tot
    over = sum(h[33:]) / tot
    W, H, worst = d.width, d.height, 0.0
    for y in range(8):
        for x in range(8):
            t = d.crop((x * W // 8, y * H // 8, max(x * W // 8 + 1, (x + 1) * W // 8), max(y * H // 8 + 1, (y + 1) * H // 8))).histogram()
            worst = max(worst, sum(i * c for i, c in enumerate(t)) / (sum(t) or 1))
    return {"mean": mean, "over32": over, "tile": worst}


def diff_ok(d): return all(d[k] <= DIFF_LIMITS[k] for k in DIFF_LIMITS)


def verify_images(pdf, staged, meta):
    """Step 4, the image gate. Independent of build_images: own private dir, own page-by-page render, compares every listed image
    with ITS page of the approved PDF. Returns a list of errors (empty = pass)."""
    n, f = meta["pages"], meta["files"]
    pages, thumbs = f.get("pages"), f.get("thumbs")
    if not (isinstance(pages, list) and isinstance(thumbs, list) and len(pages) == n == len(thumbs)): return ["image count differs from PDF page count"]
    with private_dir("bookmark-verify-") as vdir, ThreadPoolExecutor(max_workers=workers()) as ex:
        return [e for errs in ex.map(lambda i: verify_page(pdf, i, vdir, staged, pages[i - 1], thumbs[i - 1]), range(1, n + 1)) for e in errs]


def verify_page(pdf, i, vdir, staged, page_rel, thumb_rel):
    """Errors for page i: its page image and thumb against a fresh raster of PDF page i."""
    from PIL import Image
    errs = []
    raw = load_rgb(rasterize(pdf, i, vdir))  # page i rendered on its own: no shared listing, no sorting
    for rel, w, rx in ((page_rel, PAGE_W, vi.PAGE_IMG), (thumb_rel, THUMB_W, vi.THUMB_IMG)):
        mt = rx.fullmatch(rel) if isinstance(rel, str) else None
        if not mt or mt.group(1) != f"{i:02d}": errs.append(f"{rel}: bad name for page {i}"); continue
        p = staged / rel
        if p.is_symlink() or not p.is_file(): errs.append(f"{rel}: missing"); continue
        data = p.read_bytes()
        if hashlib.sha256(data).hexdigest()[:vi.HASH_LEN] != mt.group(2): errs.append(f"{rel}: content hash does not match the name"); continue
        try:
            with Image.open(io.BytesIO(data)) as im:
                fmt = im.format; im.load(); got = im.convert("RGB")
        except Exception:
            errs.append(f"{rel}: unreadable image"); continue
        if fmt != "WEBP" or got.width != w: errs.append(f"{rel}: expected WebP {w}px wide"); continue
        if encode_webp(raw, w) != data: errs.append(f"{rel}: not byte-identical to a fresh render of PDF page {i}")
        d = pixel_diff(got, scaled(raw, w))
        if not diff_ok(d): errs.append(f"{rel}: does not match PDF page {i} (mean {d['mean']:.1f}, >32 {d['over32']:.2%}, tile {d['tile']:.1f})")
    return errs


def tool_versions():
    from PIL import Image, features
    r = subprocess.run([tool("pdftoppm"), "-v"], capture_output=True, text=True, timeout=30)
    return {"pdftoppm": (r.stderr or r.stdout).strip().splitlines()[0] if (r.stderr or r.stdout).strip() else "?",
            "pillow": Image.__version__, "libwebp": str(features.version("webp")), "dpi": RENDER_DPI, "webp_quality": WEBP_QUALITY}


# ------------------------------------------------------------------ build record (qa.json)
def utcnow(): return datetime.datetime.now(datetime.timezone.utc)
def iso_us(t): return t.strftime("%Y-%m-%dT%H:%M:%S.%fZ")
def mtime_us(p): return os.stat(p).st_mtime_ns // 1000


def manifest_entry(meta):
    return {**{k: meta[k] for k in MANIFEST_KEYS if k != "cover_thumb"}, "cover_thumb": meta["files"]["thumbs"][0]}


def write_record(path, n, plan, meta, approved):
    """Step 6. Written AFTER every file it covers is final. Lists every object the upload will PUT (manifest.json is regenerated from
    the live manifest under If-Match, so the record pins this issue's manifest entry instead)."""
    files = {key: {"sha256": sha256(p), "bytes": Path(p).stat().st_size} for key, p, _, _ in plan}
    rec = {"schema": RECORD_SCHEMA, "issue": n, "generated_at": iso_us(utcnow()), "approved": approved, "renderer": tool_versions(),
           "files": files, "manifest_entry": manifest_entry(meta)}
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f: f.write(json.dumps(rec, indent=2, sort_keys=True) + "\n")
    return rec


def check_record(path, n, plan, meta):
    """Refuse unless qa.json covers exactly the planned objects with matching SHA-256 and is not older than any of them."""
    p = Path(path)
    if p.is_symlink() or not p.is_file(): raise Refuse("qa.json build record missing")
    rec = read_json(p, "qa.json")
    if not isinstance(rec, dict) or rec.get("schema") != RECORD_SCHEMA or rec.get("issue") != n: raise Refuse("qa.json is not the build record for this issue")
    files = rec.get("files")
    if not isinstance(files, dict): raise Refuse("qa.json has no file list")
    keys = {key for key, *_ in plan}
    if keys - files.keys(): raise Refuse("qa.json does not cover: " + ", ".join(sorted(keys - files.keys())[:5]))
    if files.keys() - keys: raise Refuse("qa.json lists files that are not being uploaded: " + ", ".join(sorted(files.keys() - keys)[:5]))
    try:
        gen = datetime.datetime.strptime(str(rec.get("generated_at")), "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=datetime.timezone.utc)
    except ValueError: raise Refuse("qa.json generated_at is malformed")
    gen_us = int(gen.timestamp()) * 1_000_000 + gen.microsecond
    rec_us = mtime_us(p)
    for key, path_, _, _ in plan:
        e = files[key]
        if not isinstance(e, dict) or e.get("sha256") != sha256(path_): raise Refuse(f"qa.json: SHA-256 mismatch for {key}")
        if mtime_us(path_) > gen_us or mtime_us(path_) > rec_us: raise Refuse(f"qa.json predates {key}: it cannot vouch for a file written after it")
    if rec.get("manifest_entry") != manifest_entry(meta): raise Refuse("qa.json manifest entry differs from meta.json")
    return rec


def plan_objects(n, staged, meta):
    """Ordered upload plan: (key, local path, content-type, cache-control). manifest.json is added separately, last."""
    base, out = f"issues/{n:03d}/", []
    f = meta["files"]
    for rel in [*f["pages"], *f["thumbs"]]:  # per-build names only; there is no path that uploads a legacy p-NN.webp
        if not (vi.PAGE_IMG.fullmatch(rel) or vi.THUMB_IMG.fullmatch(rel)): raise Refuse(f"refusing to upload image without a content-hash name: {rel}")
        out.append((base + rel, staged / rel, CT[".webp"], IMMUTABLE))
    for k in ("pdf_color", "pdf_grayscale"): out.append((base + meta["files"][k], staged / meta["files"][k], CT[".pdf"], IMMUTABLE))
    out.append((base + "meta.json", staged / "meta.json", CT[".json"], SHORT))
    for key, _, ct, _ in out:
        if CT.get(os.path.splitext(key)[1]) != ct: raise Refuse(f"no content type for {key}")
    return out


def new_manifest(old, meta, now=None):
    if old is not None:
        if not (isinstance(old, dict) and old.get("schema") == 1 and isinstance(old.get("issues"), list)): raise Refuse("existing manifest.json has an unexpected shape")
    issues = [i for i in (old or {}).get("issues", []) if i.get("issue") != meta["issue"]]
    issues.append(manifest_entry(meta))
    issues.sort(key=lambda i: i["issue"])
    now = now or datetime.datetime.now(datetime.timezone.utc)
    return {"schema": 1, "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "latest": max(i["issue"] for i in issues), "issues": issues}


def code(e): return getattr(e, "response", {}).get("Error", {}).get("Code", "")


def get_manifest(client):
    try:
        r = client.get_object(Bucket=BUCKET, Key="manifest.json")
        return json.loads(r["Body"].read()), r["ETag"]
    except Exception as e:
        if code(e) in ("NoSuchKey", "404", "NotFound"): return None, None
        raise Refuse(f"could not read manifest.json ({code(e) or type(e).__name__})")


def head_etag(client, key):
    """ETag of an existing object without quotes, or None if it does not exist."""
    try: h = client.head_object(Bucket=BUCKET, Key=key)
    except Exception as e:
        if code(e) in ("404", "NoSuchKey", "NotFound"): return None
        raise Refuse(f"head {key} failed ({code(e) or type(e).__name__})")
    return str(h.get("ETag") or "").strip('"')


def put(client, key, path, ct, cc, want_sha=None, **extra):
    data = Path(path).read_bytes() if not isinstance(path, bytes) else path
    if want_sha is not None and hashlib.sha256(data).hexdigest() != want_sha:  # the exact bytes being sent, not a re-read
        raise Refuse(f"{key} changed after qa.json was written; nothing more uploaded")
    client.put_object(Bucket=BUCKET, Key=key, Body=data, ContentType=ct, CacheControl=cc, **extra)
    h = client.head_object(Bucket=BUCKET, Key=key)
    if h.get("ContentLength") != len(data): raise Refuse(f"verify failed for {key}: size differs")


def upload(client, n, plan, meta, replace, record, out=print):
    """Codex #1: an immutable key (pages, thumbs, PDFs) is never overwritten with different bytes, because browsers may hold
    the old copy for a year and a CDN purge cannot reach them. Identical bytes are skipped. All of this is checked BEFORE any write.
    Codex #3: an issue whose objects exist but which is NOT in the manifest is an interrupted publish and resumes without --replace."""
    if set(record.get("files", {})) != {key for key, *_ in plan}: raise Refuse("qa.json does not match the upload plan")
    old, etag = get_manifest(client)
    listed = any(i.get("issue") == n for i in (old or {}).get("issues", []))
    if listed and not replace: raise Refuse(f"issue {n:03d} is already in manifest.json; re-publishing needs --replace")
    manifest = new_manifest(old, meta)
    if [i for i in manifest["issues"] if i["issue"] == n] != [record["manifest_entry"]]: raise Refuse("manifest entry differs from qa.json")
    todo, skipped = [], 0
    for key, path, ct, cc in plan:
        if cc == IMMUTABLE:
            have = head_etag(client, key)
            if have is not None:
                if have != md5hex(Path(path).read_bytes()):
                    raise Refuse(f"{key} already exists with different bytes and was served as immutable; it cannot be overwritten "
                                 "(publish changed PDFs under a new file name, changed pages under a new issue number; see docs/PUBLISH.md)")
                skipped += 1; continue
        todo.append((key, path, ct, cc))
    if skipped: out(f"  {skipped} immutable object(s) already present with identical bytes: skipped")
    for key, path, ct, cc in todo: put(client, key, path, ct, cc, want_sha=record["files"][key]["sha256"])
    body = (json.dumps(manifest, indent=2) + "\n").encode()
    extra = {"IfMatch": etag} if etag else {"IfNoneMatch": "*"}
    try: put(client, "manifest.json", body, CT[".json"], SHORT, **extra)
    except Refuse: raise
    except Exception as e: raise Refuse(f"manifest.json write refused ({code(e) or type(e).__name__}); it changed meanwhile: re-run the same command (no --replace needed)")
    return manifest


class Recorder:
    """Proxies the S3 client and notes each key whose PUT the bucket accepted (for the --no-signoff log)."""
    def __init__(self, client, keys): self._client, self.keys = client, keys
    def __getattr__(self, name): return getattr(self._client, name)
    def put_object(self, **kw):
        r = self._client.put_object(**kw); self.keys.append(kw["Key"]); return r


# ------------------------------------------------------------------ --no-signoff log
def open_log():
    """The --no-signoff audit log ($BOOKMARK_PUBLISH_LOG or DEFAULT_LOG): dir 700, file 600, both ours, no symlinks.
    Opened before the run starts, so a run that cannot be logged does nothing."""
    p = Path(os.path.expanduser(os.environ.get("BOOKMARK_PUBLISH_LOG") or DEFAULT_LOG))
    d = p.parent
    if d.is_symlink(): raise Refuse("publish log dir must not be a symlink")
    if not d.exists(): d.mkdir(mode=0o700, parents=True)
    st = d.stat()
    if stat.S_IMODE(st.st_mode) != 0o700 or st.st_uid != os.getuid(): raise Refuse(f"publish log dir must be mode 700 and ours (is {stat.S_IMODE(st.st_mode):o})")
    try: fd = os.open(p, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    except OSError as e: raise Refuse(f"publish log not writable ({type(e).__name__})")
    st = os.fstat(fd)
    if not stat.S_ISREG(st.st_mode) or stat.S_IMODE(st.st_mode) != 0o600 or st.st_uid != os.getuid():
        os.close(fd); raise Refuse(f"publish log must be a regular file, mode 600 and ours (is {stat.S_IMODE(st.st_mode):o})")
    return os.fdopen(fd, "a")


# ------------------------------------------------------------------ main
def run(n, src, gate_dir, execute=False, replace=False, env_file=None, client=None, out=print, signoff=True):
    if signoff: return publish(n, src, gate_dir, execute, replace, client, out)
    # One line per --no-signoff run, written even if it is refused. Never credentials: only the fields below.
    entry = {"time": iso_us(utcnow()), "issue": n, "mode": "execute" if execute else "dry-run", "replace": replace,
             "signoff": "skipped", "approved": None, "result": "failed"}
    if execute: entry["uploaded"] = []
    with open_log() as f:
        try:
            r = publish(n, src, gate_dir, execute, replace, client, out, log=entry)
            entry["result"] = "ok"; return r
        except Refuse: entry["result"] = "refused"; raise
        finally: f.write(json.dumps(entry, sort_keys=True) + "\n")


def publish(n, src, gate_dir, execute, replace, client, out, log=None):
    src = Path(src)
    if not (src / "meta.json").is_file(): raise Refuse(f"{src}: no meta.json")
    if not 1 <= n <= 999: raise Refuse("issue number out of range")
    step = lambda s: out(f"[{s}]")
    step("0 gate")
    if log is not None: out("SIGNOFF SKIPPED (--no-signoff): approved PDF hashes are taken from meta.json files.sha256")
    meta, approved = gate(n, src, gate_dir, signoff=log is None)
    if log is not None: log["approved"] = approved
    pc = meta.get("pages")
    if not isinstance(pc, int) or isinstance(pc, bool) or not 1 <= pc <= 999: raise Refuse("meta.json: pages must be an integer 1..999")
    env_path = Path(os.path.expanduser(os.environ.get("BOOKMARK_ENV_FILE", DEFAULT_ENV)))
    env = None
    if execute or env_path.exists():
        env = load_env(env_path); out("env file: ok (values not shown)")
    elif not execute: out("env file: not present (dry-run only)")
    with private_dir("bookmark-stage-") as t:
        staged = t / f"{n:03d}"
        step("1 stage")
        ignored = stage_source(src, staged, meta)
        if ignored: out(f"  {ignored} engine page image(s) in the source dir ignored: reader images are rendered from the approved PDF")
        step("2 strip")
        for label, args in (("strip", ["x", "strip", str(staged)]), ("check", ["x", "check", str(staged)])):
            if sm.main(args) != 0: raise Refuse(f"step {label} failed")
        for k in ("pdf_color", "pdf_grayscale"):
            if sha256(staged / meta["files"][k]) != approved[k]: raise Refuse(f"{k}: bytes changed by strip (file was not clean at approval); not published")
            out(f"  {meta['files'][k]}: {len(sm.pdf_x_links(staged / meta['files'][k]))} X status link(s)")
        step("3 render")
        pdf = staged / meta["files"]["pdf_color"]
        counts = {k: pdf_page_count(staged / meta["files"][k]) for k in ("pdf_color", "pdf_grayscale")}
        if not (counts["pdf_color"] == counts["pdf_grayscale"] == meta.get("pages") == meta["files"].get("page_count")):
            raise Refuse(f"page count mismatch: colour PDF {counts['pdf_color']}, grayscale PDF {counts['pdf_grayscale']}, "
                         f"meta.pages {meta.get('pages')}, files.page_count {meta['files'].get('page_count')}")
        pages, thumbs = build_images(pdf, counts["pdf_color"], staged)
        m = read_json(staged / "meta.json", "staged meta.json")
        m["files"]["pages"], m["files"]["thumbs"], m["cover_image"] = pages, thumbs, pages[0]
        m["files"]["sha256"] = {k: sha256(staged / m["files"][k]) for k in ("pdf_color", "pdf_grayscale")}
        if m["files"]["sha256"] != approved: raise Refuse("recorded hashes differ from approved hashes")
        (staged / "meta.json").write_text(json.dumps(m, indent=2, ensure_ascii=False) + "\n")
        step("4 verify images")
        m = read_json(staged / "meta.json", "staged meta.json")
        errs = verify_images(pdf, staged, m)
        if errs: raise Refuse("image gate: " + "; ".join(errs[:5]))
        step("5 validate")
        for label, args in (("check", ["x", "check", str(staged)]), ("audit", ["x", "audit", str(staged)])):
            if sm.main(args) != 0: raise Refuse(f"step {label} failed")
        errs = vi.check(staged)
        if errs: raise Refuse("validate_issue: " + "; ".join(errs[:5]))
        plan = plan_objects(n, staged, m)
        step("6 record")
        rec_path = t / "qa.json"  # outside the issue dir: never uploaded, never part of the audit
        write_record(rec_path, n, plan, m, approved)
        record = check_record(rec_path, n, plan, m)
        out(f"  qa.json: {len(record['files'])} files, sha256 {sha256(rec_path)}")
        step("7 upload" if execute else "7 plan (dry-run, no network)")
        if not execute:
            for key, path, ct, cc in plan: out(f"  PUT {BUCKET}/{key}  {ct}  {cc}  {Path(path).stat().st_size} B  sha256 {record['files'][key]['sha256'][:16]}")
            out(f"  PUT {BUCKET}/manifest.json  {CT['.json']}  {SHORT}  (LAST, If-Match on current ETag; regenerated from existing manifest + issue {n:03d})")
            out(f"  replace={'yes' if replace else 'no (refuses if the issue is in manifest.json)'}; existing immutable objects must be byte-identical; nothing was uploaded")
            return None
        record = check_record(rec_path, n, plan, m)  # again, right before the network
        client = client or make_client(env)
        if log is not None: client = Recorder(client, log["uploaded"])
        manifest = upload(client, n, plan, m, replace, record, out=out)
        out(f"published issue {n:03d}; latest={manifest['latest']}")
        return manifest


def main(argv=None):
    ap = argparse.ArgumentParser(prog="bookmark publish")
    ap.add_argument("cmd", choices=["publish"]); ap.add_argument("issue", type=int)
    ap.add_argument("--src", help="issue directory (default ./issues/NNN)")
    ap.add_argument("--gate-dir", default=os.environ.get("BOOKMARK_GATE_DIR"))
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--dry-run", action="store_true", help="default: print the plan, no network")
    g.add_argument("--execute", action="store_true", help="really upload (needs the env file)")
    ap.add_argument("--replace", action="store_true", help="allow re-publishing an issue that already exists")
    ap.add_argument("--no-signoff", action="store_true",
                    help="owner only: skip the signed approval, take the PDF hashes from meta.json; every run is logged ($BOOKMARK_PUBLISH_LOG)")
    a = ap.parse_args(argv)
    try:
        run(a.issue, a.src or f"issues/{a.issue:03d}", a.gate_dir, execute=a.execute, replace=a.replace, signoff=not a.no_signoff)
    except Refuse as e:
        print(f"REFUSED: {e}", file=sys.stderr); return 1
    except Exception as e:
        print(f"FAILED: {type(e).__name__}", file=sys.stderr); return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
