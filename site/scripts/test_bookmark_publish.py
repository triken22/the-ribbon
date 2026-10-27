#!/usr/bin/env python3
"""Tests for bookmark_publish.py (mocked S3 client, fixture issue 002, no network). Run: python3 site/scripts/test_bookmark_publish.py
Needs pypdf, Pillow, poppler (pdftoppm, pdfinfo) and OpenSSH 8.2+. Most classes reuse one real pdftoppm raster per (PDF, page) for
speed (FastRender); StrayFiles and ImageGate always call the real renderer."""
import hashlib, io, json, os, re, shutil, socket, subprocess, sys, tempfile, unittest
from pathlib import Path
from unittest import mock
from pypdf.generic import ArrayObject, DictionaryObject, FloatObject, NameObject, NumberObject, TextStringObject
import bookmark_publish as bp
import strip_metadata as sm

FIX = Path(__file__).resolve().parent.parent / "dev-fixtures" / "issues" / "002"
H = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
REAL_RASTERIZE = bp.rasterize
_RASTERS = {}


def cached_rasterize(pdf, i, outdir):
    """A real pdftoppm raster, computed once per (PDF bytes, page) and copied to the exact path the real function would write."""
    key = (H(pdf), i)
    if key not in _RASTERS:
        with tempfile.TemporaryDirectory() as d: _RASTERS[key] = REAL_RASTERIZE(pdf, i, d).read_bytes()
    out = Path(outdir) / f"r-{i:03d}.png"; out.write_bytes(_RASTERS[key]); return out


class FastRender(unittest.TestCase):
    def setUp(self):
        super().setUp()
        patcher = mock.patch.object(bp, "rasterize", cached_rasterize); patcher.start(); self.addCleanup(patcher.stop)


def image_keys(fake, thumbs=False):
    rx = bp.vi.THUMB_IMG if thumbs else bp.vi.PAGE_IMG
    return sorted(k for k in fake.store if rx.fullmatch(k.removeprefix("issues/002/")))


def key_for(fake, page, thumbs=False):
    (k,) = [k for k in image_keys(fake, thumbs) if f"/p-{page:02d}." in k]; return k


class ClientErr(Exception):
    def __init__(self, c): self.response = {"Error": {"Code": c}}


class FakeS3:
    def __init__(self, manifest=None):
        self.store, self.calls = {}, []
        if manifest is not None: self.store["manifest.json"] = (json.dumps(manifest).encode(), '"etag-old"')
    def get_object(self, Bucket, Key):
        self.calls.append(("get", Key))
        if Key not in self.store: raise ClientErr("NoSuchKey")
        b, e = self.store[Key]; return {"Body": io.BytesIO(b), "ETag": e}
    def head_object(self, Bucket, Key):
        if Key not in self.store: raise ClientErr("404")
        return {"ContentLength": len(self.store[Key][0]), "ETag": self.store[Key][1]}
    def put_object(self, Bucket, Key, Body, ContentType, CacheControl, IfMatch=None, IfNoneMatch=None):
        assert Bucket == bp.BUCKET
        if IfMatch and (Key not in self.store or self.store[Key][1] != IfMatch): raise ClientErr("PreconditionFailed")
        if IfNoneMatch and Key in self.store: raise ClientErr("PreconditionFailed")
        self.calls.append(("put", Key, ContentType, CacheControl, IfMatch, IfNoneMatch))
        self.store[Key] = (Body, '"%s"' % hashlib.md5(Body).hexdigest())  # R2/S3 single-part ETag = MD5 of the bytes


def keygen(path, comment="throwaway-test-key"):
    """Throwaway ed25519 key INSIDE the test temp dir only; deleted with it. Never the real approval key."""
    subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", comment, "-f", str(path)], check=True)
    return Path(str(path) + ".pub").read_text().strip()


def ssh_sign(key, msg_path, namespace=bp.SIG_NAMESPACE):
    sig = Path(str(msg_path) + ".sig")
    if sig.exists(): sig.unlink()
    subprocess.run(["ssh-keygen", "-q", "-Y", "sign", "-f", str(key), "-n", namespace, str(msg_path)], check=True, capture_output=True)
    return sig


class Env:
    """Temp world: clean issue copy, 700 gate dir with a signed approval by a throwaway key pinned via bp.ALLOWED_SIGNERS,
    600 env file in a 700 dir outside any git work tree."""
    def __init__(self, t):
        t = Path(t); self.t = t
        self.src = t / "issues" / "002"; shutil.copytree(FIX, self.src)
        sm.main(["x", "strip", str(self.src)])
        m = json.loads((self.src / "meta.json").read_text())
        self.hashes = {k: H(self.src / m["files"][k]) for k in ("pdf_color", "pdf_grayscale")}
        m["files"]["sha256"] = self.hashes; (self.src / "meta.json").write_text(json.dumps(m))
        self.gate = t / "gate"; self.gate.mkdir(); os.chmod(self.gate, 0o700)
        (self.gate / "002.qa.json").write_text(json.dumps({"issue": 2, "qa_verdict": "pass"}))
        kd = t / "keys"; kd.mkdir(mode=0o700)
        self.key = kd / "approver"; pub = keygen(self.key)
        self.signers = kd / "allowed_signers"
        self.signers.write_text(f'# test\n{bp.SIG_PRINCIPAL} namespaces="{bp.SIG_NAMESPACE}" {pub}\n')
        self.approve()
        d = t / "cfg"; d.mkdir(mode=0o700); os.chmod(d, 0o700)
        self.envf = d / "r2.env"
        self.envf.write_text(f"R2_ACCOUNT_ID={'a' * 32}\nR2_ACCESS_KEY_ID=AKIAFAKE\nR2_SECRET_ACCESS_KEY=shh\nR2_BUCKET={bp.BUCKET}\n"); os.chmod(self.envf, 0o600)
        self.log = t / "state" / "publish.log"  # never the real ~/.local/state
    def approve(self, hashes=None, n=2, key=None, raw=None, namespace=bp.SIG_NAMESPACE):
        msg = self.gate / "002.approval"
        msg.write_bytes(raw if raw is not None else bp.approval_message(n, hashes or self.hashes))
        return ssh_sign(key or self.key, msg, namespace)
    def run(self, **kw):
        kw.setdefault("out", lambda s: None)
        with mock.patch.dict(os.environ, {"BOOKMARK_ENV_FILE": str(self.envf), "BOOKMARK_PUBLISH_LOG": str(self.log)}), \
             mock.patch.object(bp, "ALLOWED_SIGNERS", self.signers):
            return bp.run(2, self.src, self.gate, **kw)


class T(FastRender):
    def setUp(self):
        super().setUp(); self.tmp = tempfile.TemporaryDirectory(); self.e = Env(self.tmp.name)
    def tearDown(self): self.tmp.cleanup()

    def test_refuses_without_approval(self):
        (self.e.gate / "002.approval").unlink()
        fake = FakeS3()
        with self.assertRaisesRegex(bp.Refuse, "signed approval missing"): self.e.run(execute=True, client=fake)
        self.assertEqual(fake.calls, [])

    def test_refuses_without_pass(self):
        (self.e.gate / "002.qa.json").write_text(json.dumps({"issue": 2, "qa_verdict": "fail"}))
        with self.assertRaisesRegex(bp.Refuse, "PASS"): self.e.run(execute=True, client=FakeS3())

    def test_refuses_on_hash_mismatch(self):
        self.e.approve({"pdf_color": "0" * 64, "pdf_grayscale": self.e.hashes["pdf_grayscale"]})
        fake = FakeS3()
        with self.assertRaisesRegex(bp.Refuse, "signed approved hash"): self.e.run(execute=True, client=fake)
        self.assertEqual(fake.calls, [])

    def test_refuses_on_dirty_metadata(self):
        # a PDF with Info metadata that WAS approved as-is: strip changes its bytes, so the approved hash no longer holds
        shutil.copy(FIX / "issue-002-color.pdf", self.e.src / "issue-002-color.pdf")
        h = H(self.e.src / "issue-002-color.pdf"); self.e.hashes["pdf_color"] = h; self.e.approve()
        m = json.loads((self.e.src / "meta.json").read_text()); m["files"]["sha256"]["pdf_color"] = h; (self.e.src / "meta.json").write_text(json.dumps(m))
        fake = FakeS3()
        with self.assertRaisesRegex(bp.Refuse, "changed by strip"): self.e.run(execute=True, client=fake)
        self.assertEqual(fake.calls, [])
        self.assertEqual(H(self.e.src / "issue-002-color.pdf"), h)  # source dir never modified

    def test_refuses_on_extra_file(self):
        (self.e.src / "notes.txt").write_text("x")
        with self.assertRaisesRegex(bp.Refuse, "audit"): self.e.run(execute=True, client=FakeS3())

    def test_refuses_on_bad_image_width(self):
        # The engine's images are no longer used; a rendered image of the wrong width must still be refused by the image gate.
        from PIL import Image
        real = bp.build_images
        def narrow(pdf, n, staged):
            pages, thumbs = real(pdf, n, staged)
            b = io.BytesIO(); Image.new("RGB", (900, 1200), "white").save(b, "WEBP"); data = b.getvalue()
            rel = bp.vi.page_name(3, data); (staged / rel).write_bytes(data); pages[2] = rel
            return pages, thumbs
        fake = FakeS3()
        with mock.patch.object(bp, "build_images", narrow), self.assertRaisesRegex(bp.Refuse, "1200"): self.e.run(execute=True, client=fake)
        self.assertEqual(fake.calls, [])

    def test_upload_order_manifest_last_if_match(self):
        old = {"schema": 1, "generated_at": "2026-01-01T00:00:00Z", "latest": 1, "issues": [{"issue": 1, "title": "One", "date": "2026-10-10", "pages": 16, "cover_image": "pages/p-01.webp"}]}
        fake = FakeS3(old)
        man = self.e.run(execute=True, client=fake)
        puts = [c for c in fake.calls if c[0] == "put"]
        keys = [c[1] for c in puts]
        self.assertEqual(keys[-1], "manifest.json"); self.assertEqual(keys.count("manifest.json"), 1)
        self.assertEqual(keys[-2], "issues/002/meta.json")
        self.assertTrue(all(k.startswith("issues/002/") for k in keys[:-1]))
        self.assertLess(max(i for i, k in enumerate(keys) if k.endswith(".pdf")), keys.index("issues/002/meta.json"))
        self.assertEqual(puts[-1][4], '"etag-old"')  # If-Match
        self.assertEqual([i["issue"] for i in man["issues"]], [1, 2]); self.assertEqual(man["latest"], 2)
        self.assertEqual(set(man["issues"][1]), set(bp.MANIFEST_KEYS))
        for c in puts:  # explicit types and caches
            k = c[1]
            if k == "manifest.json" or k.endswith("meta.json"): self.assertEqual(c[3], "public, max-age=60")
            else: self.assertEqual(c[3], "public, max-age=31536000, immutable")
            self.assertEqual(c[2], {"pdf": "application/pdf", "webp": "image/webp", "json": "application/json"}[k.rsplit(".", 1)[1]])
        meta = json.loads(fake.store["issues/002/meta.json"][0]); self.assertEqual(meta["files"]["sha256"], self.e.hashes)

    def test_first_publish_uses_if_none_match(self):
        fake = FakeS3(); self.e.run(execute=True, client=fake)
        last = [c for c in fake.calls if c[0] == "put"][-1]
        self.assertEqual((last[1], last[4], last[5]), ("manifest.json", None, "*"))

    def test_manifest_changed_meanwhile_fails(self):
        fake = FakeS3({"schema": 1, "latest": 1, "issues": []})
        real = fake.get_object
        def racing(Bucket, Key):
            r = real(Bucket, Key)
            if Key == "manifest.json": fake.store["manifest.json"] = (b"{}", '"someone-else"')
            return r
        fake.get_object = racing
        with self.assertRaises(bp.Refuse): self.e.run(execute=True, client=fake)

    def test_republish_needs_replace(self):
        fake = FakeS3(); self.e.run(execute=True, client=fake)
        n = len(fake.calls)
        with self.assertRaisesRegex(bp.Refuse, "--replace"): self.e.run(execute=True, client=fake)
        self.assertFalse(any(c[0] == "put" for c in fake.calls[n:]))
        n = len(fake.calls)
        self.e.run(execute=True, client=fake, replace=True)  # identical bytes: allowed, immutable objects are not rewritten
        keys = [c[1] for c in fake.calls[n:] if c[0] == "put"]
        self.assertEqual(keys, ["issues/002/meta.json", "manifest.json"])

    def test_wrong_bucket_refused(self):
        self.e.envf.write_text(self.e.envf.read_text().replace(bp.BUCKET, "other-bucket"))
        with self.assertRaisesRegex(bp.Refuse, "R2_BUCKET"): self.e.run(execute=True, client=FakeS3())
        self.assertEqual(bp.BUCKET, "weekend-bookmark-issues")

    def test_env_file_permissions(self):
        os.chmod(self.e.envf, 0o640)
        with self.assertRaisesRegex(bp.Refuse, "mode must be 600"): self.e.run(execute=True, client=FakeS3())
        with self.assertRaisesRegex(bp.Refuse, "mode must be 600"): self.e.run()  # also in dry-run when the file exists
        os.chmod(self.e.envf, 0o600); os.chmod(self.e.envf.parent, 0o755)
        with self.assertRaisesRegex(bp.Refuse, "directory mode must be 700"): self.e.run(execute=True, client=FakeS3())
        os.chmod(self.e.envf.parent, 0o700)
        self.e.run(execute=True, client=FakeS3())

    def test_env_file_in_git_worktree_refused(self):
        subprocess.run(["git", "init", "-q", str(self.e.t / "cfg")], check=True)
        with self.assertRaisesRegex(bp.Refuse, "git work tree"): self.e.run(execute=True, client=FakeS3())

    def test_env_file_symlink_and_missing_vars_refused(self):
        self.e.envf.write_text("R2_BUCKET=" + bp.BUCKET + "\n")
        with self.assertRaisesRegex(bp.Refuse, "missing"): self.e.run(execute=True, client=FakeS3())

    def test_dry_run_makes_no_network_calls(self):
        out = []
        with mock.patch.object(socket, "socket", side_effect=AssertionError("network")), \
             mock.patch.object(bp, "make_client", side_effect=AssertionError("client")):
            self.assertIsNone(self.e.run(out=out.append))
        text = "\n".join(out)
        self.assertIn("manifest.json", text); self.assertIn("nothing was uploaded", text)
        self.assertNotIn("shh", text); self.assertNotIn("AKIAFAKE", text)

    def test_secrets_never_printed(self):
        out = []; self.e.run(execute=True, client=FakeS3(), out=out.append)
        self.assertNotIn("shh", "\n".join(out)); self.assertNotIn("AKIAFAKE", "\n".join(out))

    def test_cli_default_is_dry_run_and_refusal_exit_code(self):
        # The pinned path is a constant (no flag/env override), so the CLI is driven in-process-style through a child python that patches it.
        env = dict(os.environ, BOOKMARK_ENV_FILE=str(self.e.envf), BOOKMARK_GATE_DIR=str(self.e.gate))
        code = ("import sys, pathlib; sys.path.insert(0, %r); import bookmark_publish as bp; bp.ALLOWED_SIGNERS = pathlib.Path(%r); "
                "sys.exit(bp.main(['publish', '2', '--src', %r]))") % (str(Path(bp.__file__).parent), str(self.e.signers), str(self.e.src))
        r = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr); self.assertIn("nothing was uploaded", r.stdout)
        (self.e.gate / "002.approval.sig").unlink()
        r = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True)
        self.assertEqual(r.returncode, 1); self.assertIn("REFUSED", r.stderr)

    def test_real_cli_refuses_with_repo_placeholder_key(self):
        # The repo ships only a placeholder: until the owner pins their public key, every publish is refused.
        env = dict(os.environ, BOOKMARK_ENV_FILE=str(self.e.envf), BOOKMARK_GATE_DIR=str(self.e.gate))
        r = subprocess.run([sys.executable, str(Path(bp.__file__)), "publish", "2", "--src", str(self.e.src)], env=env, capture_output=True, text=True)
        self.assertEqual(r.returncode, 1); self.assertIn("no pinned approval key", r.stderr)


class SignedGate(FastRender):
    """IT SEC gate: only an ssh-keygen -Y signature by the pinned key over the canonical issue+hashes text unlocks publish."""
    def setUp(self):
        super().setUp(); self.tmp = tempfile.TemporaryDirectory(); self.e = Env(self.tmp.name); self.fake = FakeS3()
    def tearDown(self): self.tmp.cleanup()
    def refuses(self, pattern):
        with self.assertRaisesRegex(bp.Refuse, pattern): self.e.run(execute=True, client=self.fake)
        self.assertEqual(self.fake.calls, [], "nothing may touch the bucket on a refused gate")

    def test_valid_signature_publishes(self):
        self.e.run(execute=True, client=self.fake)
        self.assertIn("manifest.json", self.fake.store)

    def test_canonical_message_format(self):
        h = {"pdf_color": "a" * 64, "pdf_grayscale": "b" * 64}
        self.assertEqual(bp.approval_message(3, h), b"weekend-bookmark approval v1\nissue: 003\npdf_color: " + b"a" * 64 + b"\npdf_grayscale: " + b"b" * 64 + b"\n")
        self.assertEqual(bp.parse_approval(3, bp.approval_message(3, h)), h)

    def test_unsigned_refused(self):
        (self.e.gate / "002.approval.sig").unlink(); self.refuses("unsigned approvals are refused")

    def test_legacy_plain_approved_file_refused(self):
        (self.e.gate / "002.APPROVED").write_text(json.dumps({"issue": 2, "sha256": self.e.hashes})); self.refuses("legacy 002.APPROVED")

    def test_legacy_only_refused(self):
        for f in ("002.approval", "002.approval.sig"): (self.e.gate / f).unlink()
        (self.e.gate / "002.APPROVED").write_text(json.dumps({"issue": 2, "sha256": self.e.hashes})); self.refuses("legacy 002.APPROVED")

    def test_unpinned_key_refused(self):
        other = self.e.t / "keys" / "agent"; keygen(other, "agent-on-the-box")
        self.e.approve(key=other); self.refuses("does not verify against the pinned key")

    def test_wrong_namespace_refused(self):
        self.e.approve(namespace="file"); self.refuses("does not verify")

    def test_tampered_after_signing_refused(self):
        self.e.approve()
        bad = dict(self.e.hashes, pdf_color="0" * 64)
        (self.e.gate / "002.approval").write_bytes(bp.approval_message(2, bad))  # old signature kept
        self.refuses("does not verify")

    def test_garbage_signature_refused(self):
        (self.e.gate / "002.approval.sig").write_text("-----BEGIN SSH SIGNATURE-----\nAAAA\n-----END SSH SIGNATURE-----\n")
        self.refuses("does not verify")

    def test_signed_but_hash_mismatch_refused(self):
        self.e.approve(hashes=dict(self.e.hashes, pdf_grayscale="f" * 64)); self.refuses("pdf_grayscale: SHA-256 does not match the signed")

    def test_signed_for_other_issue_refused(self):
        self.e.approve(n=3); self.refuses("different issue")

    def test_malformed_refused(self):
        good = bp.approval_message(2, self.e.hashes)
        for raw in (b"", good.rstrip(b"\n"), good + b"extra: 1\n", good.replace(b"v1", b"v2"), good.upper(),
                    good.replace(b"issue: 002", b"issue: 2"), good.replace(b"pdf_color: ", b"pdf_color:  "),
                    json.dumps({"issue": 2, "sha256": self.e.hashes}).encode(), good.replace(b"\n", b"\r\n"), "issue: ü\n".encode()):
            with self.subTest(raw=raw[:40]):
                self.e.approve(raw=raw)  # validly signed by the pinned key, but not the canonical text
                self.refuses("malformed|different issue")

    def test_gate_dir_mode_must_be_700(self):
        for mode in (0o755, 0o750, 0o711, 0o777):
            os.chmod(self.e.gate, mode)
            with self.subTest(mode=oct(mode)): self.refuses("gate dir mode must be 700")
        os.chmod(self.e.gate, 0o700)

    def test_gate_dir_must_be_owned_by_runner(self):
        with mock.patch.object(bp.os, "getuid", return_value=os.getuid() + 1): self.refuses("owned by the running user")

    def test_gate_dir_symlink_refused(self):
        link = self.e.t / "gate-link"; link.symlink_to(self.e.gate)
        with self.assertRaisesRegex(bp.Refuse, "symlink"):
            with mock.patch.dict(os.environ, {"BOOKMARK_ENV_FILE": str(self.e.envf)}), mock.patch.object(bp, "ALLOWED_SIGNERS", self.e.signers):
                bp.run(2, self.e.src, link, execute=True, client=self.fake, out=lambda s: None)

    def test_symlinked_gate_files_refused(self):
        real = self.e.t / "elsewhere.approval"; shutil.move(self.e.gate / "002.approval", real)
        (self.e.gate / "002.approval").symlink_to(real); self.refuses("must not be a symlink")

    def test_placeholder_or_bad_pinned_file_refused(self):
        repo_file = Path(bp.__file__).resolve().parent.parent / "keys" / "approval_allowed_signers"
        self.e.signers.write_text(repo_file.read_text()); self.refuses("no pinned approval key")
        pub = (self.e.t / "keys" / "approver.pub").read_text().strip()
        self.e.signers.write_text(f"someone-else namespaces=\"{bp.SIG_NAMESPACE}\" {pub}\n"); self.refuses("wrong principal or namespace")
        self.e.signers.write_text(f"{bp.SIG_PRINCIPAL} {pub}\n"); self.refuses("wrong principal or namespace")
        self.e.signers.unlink(); self.refuses("allowed_signers file missing")

    def test_repo_pins_no_private_key_and_no_override(self):
        repo_file = Path(bp.__file__).resolve().parent.parent / "keys" / "approval_allowed_signers"
        self.assertNotIn("PRIVATE KEY", repo_file.read_text())
        self.assertEqual(bp.ALLOWED_SIGNERS.resolve(), repo_file)
        src = Path(bp.__file__).read_text()
        self.assertNotIn("ALLOWED_SIGNERS\", os.environ", src); self.assertNotIn("--allowed-signers", src)


class NoSignoff(FastRender):
    """Owner's --no-signoff: only the signed approval is skipped (hashes from meta.json), every run is logged, nothing else changes."""
    def setUp(self):
        super().setUp(); self.tmp = tempfile.TemporaryDirectory(); self.e = Env(self.tmp.name)
        for f in ("002.approval", "002.approval.sig"): (self.e.gate / f).unlink()  # an unsigned issue
    def tearDown(self): self.tmp.cleanup()

    def test_unsigned_issue_publishes_with_flag_and_is_logged(self):
        out, fake = [], FakeS3()
        self.assertIsNone(self.e.run(signoff=False, out=out.append))  # dry-run
        man = self.e.run(execute=True, client=fake, signoff=False, out=out.append)
        self.assertEqual([i["issue"] for i in man["issues"]], [2])
        self.assertEqual(out.count("SIGNOFF SKIPPED (--no-signoff): approved PDF hashes are taken from meta.json files.sha256"), 2)
        self.assertEqual(json.loads(fake.store["issues/002/meta.json"][0])["files"]["sha256"], self.e.hashes)
        m = json.loads((self.e.src / "meta.json").read_text()); m["files"]["sha256"]["pdf_color"] = "0" * 64
        (self.e.src / "meta.json").write_text(json.dumps(m))
        with self.assertRaisesRegex(bp.Refuse, "pdf_color: SHA-256 does not match the meta.json"): self.e.run(execute=True, client=FakeS3(), signoff=False)
        text = self.e.log.read_text()
        self.assertNotIn("shh", text); self.assertNotIn("AKIAFAKE", text)
        dry, ex, bad = [json.loads(l) for l in text.splitlines()]
        common = {"issue": 2, "replace": False, "signoff": "skipped", "approved": self.e.hashes}
        self.assertEqual(dry, {**common, "time": dry["time"], "mode": "dry-run", "result": "ok"})
        self.assertEqual(ex, {**common, "time": ex["time"], "mode": "execute", "result": "ok", "uploaded": [c[1] for c in fake.calls if c[0] == "put"]})
        self.assertEqual(ex["uploaded"][-1], "manifest.json"); self.assertEqual(len(ex["uploaded"]), 16 + 16 + 2 + 1 + 1)
        self.assertEqual((bad["result"], bad["approved"], bad["uploaded"]), ("refused", None, []))
        self.assertRegex(dry["time"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$")
        self.assertEqual(oct(os.stat(self.e.log.parent).st_mode & 0o777), "0o700"); self.assertEqual(oct(os.stat(self.e.log).st_mode & 0o777), "0o600")

    def test_unsigned_issue_without_flag_still_refused(self):
        fake = FakeS3()
        with self.assertRaisesRegex(bp.Refuse, "signed approval missing"): self.e.run(execute=True, client=fake)
        (self.e.gate / "002.approval").write_bytes(bp.approval_message(2, self.e.hashes))  # canonical text, but no .sig
        with self.assertRaisesRegex(bp.Refuse, "unsigned approvals are refused"): self.e.run(execute=True, client=fake)
        self.assertEqual(fake.calls, []); self.assertFalse(self.e.log.exists())


class ImmutableAndResume(FastRender):
    """Codex #1 (never overwrite immutable URLs with different bytes) and Codex #3 (failed manifest CAS resumes without --replace)."""
    def setUp(self):
        super().setUp(); self.tmp = tempfile.TemporaryDirectory(); self.e = Env(self.tmp.name)
    def tearDown(self): self.tmp.cleanup()

    def test_replace_with_changed_immutable_bytes_refused_before_any_write(self):
        fake = FakeS3(); self.e.run(execute=True, client=fake)
        k = key_for(fake, 3); b, et = fake.store[k]
        fake.store[k] = (b + b"x", '"%s"' % hashlib.md5(b + b"x").hexdigest())  # bucket holds other bytes
        n = len(fake.calls)
        with self.assertRaisesRegex(bp.Refuse, "different bytes and was served as immutable"): self.e.run(execute=True, client=fake, replace=True)
        self.assertFalse(any(c[0] == "put" for c in fake.calls[n:]))

    def test_changed_pdf_under_new_name_is_allowed_with_replace(self):
        fake = FakeS3(); self.e.run(execute=True, client=fake)
        old_pdf = fake.store["issues/002/issue-002-color.pdf"]
        fake.store["issues/002/issue-002-color.pdf"] = (old_pdf[0] + b"%", '"%s"' % hashlib.md5(old_pdf[0] + b"%").hexdigest())
        m = json.loads((self.e.src / "meta.json").read_text())
        (self.e.src / "issue-002-color.pdf").rename(self.e.src / "issue-002-color-v2.pdf"); m["files"]["pdf_color"] = "issue-002-color-v2.pdf"
        (self.e.src / "meta.json").write_text(json.dumps(m))
        self.e.run(execute=True, client=fake, replace=True)
        self.assertIn("issues/002/issue-002-color-v2.pdf", fake.store)
        self.assertEqual(json.loads(fake.store["issues/002/meta.json"][0])["files"]["pdf_color"], "issue-002-color-v2.pdf")

    def test_multipart_style_etag_counts_as_different(self):
        fake = FakeS3(); self.e.run(execute=True, client=fake)
        b, _ = fake.store["issues/002/issue-002-grayscale.pdf"]; fake.store["issues/002/issue-002-grayscale.pdf"] = (b, '"abc-2"')
        with self.assertRaisesRegex(bp.Refuse, "different bytes"): self.e.run(execute=True, client=fake, replace=True)

    def test_failed_manifest_cas_is_resumable_without_replace(self):
        other = {"schema": 1, "generated_at": "2026-01-01T00:00:00Z", "latest": 1,
                 "issues": [{"issue": 1, "title": "One", "date": "2026-10-10", "pages": 16, "cover_image": "pages/p-01.webp"}]}
        fake = FakeS3({"schema": 1, "generated_at": "2026-01-01T00:00:00Z", "latest": 1, "issues": []})
        real = fake.get_object; raced = []
        def racing(Bucket, Key):
            r = real(Bucket, Key)
            if Key == "manifest.json" and not raced:  # another publisher wins the manifest once
                raced.append(1); fake.store["manifest.json"] = (json.dumps(other).encode(), '"someone-else"')
            return r
        fake.get_object = racing
        with self.assertRaisesRegex(bp.Refuse, "re-run the same command \\(no --replace needed\\)"): self.e.run(execute=True, client=fake)
        self.assertIn("issues/002/meta.json", fake.store)  # the interrupted state Codex #3 describes
        n = len(fake.calls)
        man = self.e.run(execute=True, client=fake)  # plain re-run, no --replace
        self.assertEqual([i["issue"] for i in man["issues"]], [1, 2])
        keys = [c[1] for c in fake.calls[n:] if c[0] == "put"]
        self.assertEqual(keys, ["issues/002/meta.json", "manifest.json"])  # immutable objects identical: not rewritten
        self.assertEqual([c[4] for c in fake.calls[n:] if c[0] == "put" and c[1] == "manifest.json"], ['"someone-else"'])

    def test_resume_after_partial_upload_without_meta(self):
        fake = FakeS3(); real_put = fake.put_object; count = []
        def flaky(**kw):
            if kw["Key"].endswith(".pdf") and not count: count.append(1); raise ClientErr("InternalError")
            return real_put(**kw)
        fake.put_object = flaky
        with self.assertRaises(Exception): self.e.run(execute=True, client=fake)
        self.assertNotIn("manifest.json", fake.store)
        self.e.run(execute=True, client=fake)
        self.assertIn("manifest.json", fake.store)

    def test_resume_with_different_partial_bytes_refused(self):
        probe = FakeS3(); self.e.run(execute=True, client=probe); k = key_for(probe, 1)  # the content-addressed key this build uses
        fake = FakeS3(); fake.store[k] = (b"stale", '"%s"' % hashlib.md5(b"stale").hexdigest())
        with self.assertRaisesRegex(bp.Refuse, "different bytes"): self.e.run(execute=True, client=fake)
        self.assertFalse(any(c[0] == "put" for c in fake.calls))


# ------------------------------------------------------------------ Issue 003 page-10 incident (18 Oct): render, image gate, record, names
def price_list(w=2483, h=3508):
    """Stand-in for the stray /tmp/pp-1.png of 18 Oct: a synthetic scanned price list, nothing like a magazine page."""
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (w, h), (250, 250, 247)); d = ImageDraw.Draw(im)
    d.rectangle((0, 0, w, h // 12), fill=(20, 60, 140)); d.text((40, 40), "PREISLISTE NIEDERSPANNUNG (SYNTHETISCH)", fill="white")
    for r in range(1, 60):
        y = h // 12 + r * (h // 64); d.line((30, y, w - 30, y), fill=(80, 80, 80), width=3)
        d.text((40, y + 8), f"Art.-Nr. 2CDS2{r:05d}  Leitungsschutzschalter  {r * 3.17:8.2f} EUR", fill="black")
    return im


def foreign_webp(i, w=bp.PAGE_W, thumb=False):
    data = bp.encode_webp(price_list(), w); return bp.vi.page_name(i, data, thumb), data


def resign(e):
    """After a test changes the source PDFs: strip, record their hashes in meta.json and sign them with the throwaway key."""
    sm.main(["x", "strip", str(e.src)])
    m = json.loads((e.src / "meta.json").read_text())
    e.hashes = {k: H(e.src / m["files"][k]) for k in ("pdf_color", "pdf_grayscale")}
    m["files"]["sha256"] = e.hashes; (e.src / "meta.json").write_text(json.dumps(m)); e.approve()


def edit_pdf(path, fn):
    from pypdf import PdfReader, PdfWriter
    r = PdfReader(str(path)); w = PdfWriter()
    for i, page in enumerate(r.pages, 1): fn(w, i, page)
    with open(path, "wb") as f: w.write(f)


def uploaded_pages(fake):
    from PIL import Image
    return {int(bp.vi.PAGE_IMG.fullmatch(k.removeprefix("issues/002/")).group(1)): Image.open(io.BytesIO(fake.store[k][0])).convert("RGB")
            for k in image_keys(fake)}


class StrayFiles(unittest.TestCase):
    """Root cause of 18 Oct: images were picked by sorting pp-*.png in a shared /tmp and taking the first 16. Real renderer here."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.e = Env(self.tmp.name); self.fake = FakeS3()
    def tearDown(self): self.tmp.cleanup()
    def refuses(self, pattern):
        with self.assertRaisesRegex(bp.Refuse, pattern): self.e.run(execute=True, client=self.fake)
        self.assertEqual(self.fake.calls, [], "nothing may touch the bucket")

    def test_stray_pp1_in_shared_tmp_cwd_and_engine_pages_is_never_published(self):
        shared = self.e.t / "shared-tmp"; shared.mkdir()
        stray = price_list(); stray_bytes = {}
        for name in ("pp-1.png", "pp-01.png", "pp-10.png", "p-10.png", "r-001.png", "r-010.png", "page.png"):
            stray.save(shared / name); stray_bytes[name] = H(shared / name)
        (self.e.src / "pages" / "p-10.webp").write_bytes(foreign_webp(10)[1])  # a wrong engine image in the source dir: ignored
        cwd = os.getcwd(); os.chdir(shared)
        try:
            with mock.patch.object(tempfile, "tempdir", str(shared)): self.e.run(execute=True, client=self.fake)
        finally: os.chdir(cwd)
        got = uploaded_pages(self.fake)
        self.assertEqual(sorted(got), list(range(1, 17)))  # image count == PDF page count, p-16 present
        self.assertEqual(len(image_keys(self.fake, thumbs=True)), 16)
        foreign = bp.scaled(price_list(), bp.PAGE_W)
        with tempfile.TemporaryDirectory() as d:  # independent check: each uploaded page against its own PDF page
            for i in range(1, 17):
                raw = bp.load_rgb(REAL_RASTERIZE(self.e.src / "issue-002-color.pdf", i, d))
                self.assertTrue(bp.diff_ok(bp.pixel_diff(got[i], bp.scaled(raw, bp.PAGE_W))), f"page {i} is not PDF page {i}")
                os.unlink(Path(d) / f"r-{i:03d}.png")
        self.assertFalse(bp.diff_ok(bp.pixel_diff(got[10], foreign.resize(got[10].size))))
        for name, h in stray_bytes.items(): self.assertEqual(H(shared / name), h)  # strays untouched, never read as input
        self.assertEqual(sorted(p.name for p in shared.iterdir()), sorted(stray_bytes))  # private dirs cleaned up

    def test_stray_file_in_source_dir_refused(self):
        price_list().save(self.e.src / "pp-1.png"); self.refuses("source audit: pp-1.png")
        (self.e.src / "pp-1.png").unlink(); price_list().save(self.e.src / "pages" / "pp-1.png"); self.refuses("source audit: pages/pp-1.png")

    def test_stray_file_in_private_render_dir_refused(self):
        def leaky(pdf, i, outdir):
            if i == 1: price_list().save(Path(outdir) / "pp-1.png")
            return REAL_RASTERIZE(pdf, i, outdir)
        with mock.patch.object(bp, "rasterize", leaky): self.refuses("exactly one image per PDF page")

    def test_missing_render_refused(self):
        def lossy(pdf, i, outdir):
            p = REAL_RASTERIZE(pdf, i, outdir)
            if i == 16: p.unlink()
            return p
        with mock.patch.object(bp, "rasterize", lossy): self.refuses("exactly one image per PDF page")

    def test_pdf_with_fewer_pages_than_meta_refused(self):
        for k in ("color", "grayscale"):
            edit_pdf(self.e.src / f"issue-002-{k}.pdf", lambda w, i, page: w.add_page(page) if i <= 15 else None)
        resign(self.e); self.refuses("page count mismatch: colour PDF 15, grayscale PDF 15, meta.pages 16")

    def test_editions_with_different_page_counts_refused(self):
        edit_pdf(self.e.src / "issue-002-grayscale.pdf", lambda w, i, page: w.add_page(page) if i <= 15 else None)
        resign(self.e); self.refuses("page count mismatch: colour PDF 16, grayscale PDF 15")

    def test_render_and_verify_use_separate_private_700_dirs(self):
        seen = {}
        def spy(pdf, i, outdir):
            st = os.lstat(outdir); seen.setdefault(Path(outdir).name.split("-")[1], set()).add((str(outdir), oct(stat.S_IMODE(st.st_mode))))
            return REAL_RASTERIZE(pdf, i, outdir)
        import stat
        with mock.patch.object(bp, "rasterize", spy): self.e.run()
        self.assertEqual(set(seen), {"render", "verify"})
        for kind, dirs in seen.items():
            self.assertEqual(len(dirs), 1, kind); (d, mode), = dirs
            self.assertEqual(mode, "0o700"); self.assertFalse(Path(d).exists(), "private dir removed")
        self.assertNotEqual(seen["render"], seen["verify"])


class ImageGate(unittest.TestCase):
    """The gate re-renders every PDF page and refuses any uploaded image that is not that page. Real renderer here."""
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.e = Env(self.tmp.name); self.fake = FakeS3()
    def tearDown(self): self.tmp.cleanup()
    def tampered(self, fn, pattern):
        real = bp.build_images
        def build(pdf, n, staged):
            pages, thumbs = real(pdf, n, staged); fn(staged, pages, thumbs); return pages, thumbs
        with mock.patch.object(bp, "build_images", build), self.assertRaisesRegex(bp.Refuse, pattern): self.e.run(execute=True, client=self.fake)
        self.assertEqual(self.fake.calls, [])

    def test_foreign_image_with_valid_hash_name_refused(self):  # exactly the 18 Oct p-10
        def swap(staged, pages, thumbs):
            rel, data = foreign_webp(10); (staged / rel).write_bytes(data); (staged / pages[9]).unlink(); pages[9] = rel
        self.tampered(swap, r"image gate: pages/p-10\.[0-9a-f]{12}\.webp: not byte-identical to a fresh render of PDF page 10")

    def test_shifted_pages_refused(self):  # 18 Oct: webp 11-16 were PDF pages 10-15
        def shift(staged, pages, thumbs):
            for i in (11, 10):  # p-11 gets page 10's content, p-12 gets page 11's
                data = (staged / pages[i - 1]).read_bytes(); rel = f"pages/p-{i + 1:02d}." + hashlib.sha256(data).hexdigest()[:12] + ".webp"
                (staged / rel).write_bytes(data); pages[i] = rel
        self.tampered(shift, "p-11.*PDF page 11")

    def test_small_local_edit_refused(self):
        from PIL import Image, ImageDraw
        def box(staged, pages, thumbs):
            im = Image.open(staged / pages[9]).convert("RGB"); ImageDraw.Draw(im).rectangle((500, 700, 560, 760), fill="black")
            b = io.BytesIO(); im.save(b, "WEBP", quality=bp.WEBP_QUALITY); rel = bp.vi.page_name(10, b.getvalue())
            (staged / rel).write_bytes(b.getvalue()); pages[9] = rel
        self.tampered(box, "p-10")

    def test_wrong_thumb_refused(self):
        def thumb(staged, pages, thumbs):
            rel, data = foreign_webp(4, bp.THUMB_W, thumb=True); (staged / rel).write_bytes(data); thumbs[3] = rel
        self.tampered(thumb, r"pages/thumbs/p-04\.[0-9a-f]{12}\.webp")

    def test_name_hash_must_match_content(self):
        def overwrite(staged, pages, thumbs): (staged / pages[0]).write_bytes(foreign_webp(1)[1])
        self.tampered(overwrite, "content hash does not match the name")

    def test_pixel_diff_limits(self):
        with tempfile.TemporaryDirectory() as d:
            raw = bp.load_rgb(REAL_RASTERIZE(self.e.src / "issue-002-color.pdf", 10, d))
        page = bp.scaled(raw, bp.PAGE_W)
        from PIL import Image, ImageDraw
        enc = Image.open(io.BytesIO(bp.encode_webp(raw, bp.PAGE_W))).convert("RGB")
        self.assertTrue(bp.diff_ok(bp.pixel_diff(enc, page)))  # lossy WebP of the right page passes
        self.assertFalse(bp.diff_ok(bp.pixel_diff(bp.scaled(price_list(), bp.PAGE_W).resize(page.size), page)))
        boxed = enc.copy(); ImageDraw.Draw(boxed).rectangle((500, 700, 600, 800), fill="black")
        self.assertFalse(bp.diff_ok(bp.pixel_diff(boxed, page)))  # a 100 px box fails the tile limit
        self.assertFalse(bp.diff_ok(bp.pixel_diff(enc.crop((0, 0, 1200, 1600)), page)))  # size differs

    def test_render_is_deterministic(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            pa = REAL_RASTERIZE(self.e.src / "issue-002-color.pdf", 2, a); pb = REAL_RASTERIZE(self.e.src / "issue-002-color.pdf", 2, b)
            self.assertEqual(bp.encode_webp(bp.load_rgb(pa), 1200), bp.encode_webp(bp.load_rgb(pb), 1200))


class BuildRecord(FastRender):
    """qa.json: SHA-256 of every uploaded object, written after them, checked before and during the upload."""
    def setUp(self):
        super().setUp(); self.tmp = tempfile.TemporaryDirectory(); self.e = Env(self.tmp.name); self.fake = FakeS3()
    def tearDown(self): self.tmp.cleanup()
    def with_record(self, fn, pattern):
        real = bp.write_record
        def write(path, *a):
            rec = real(path, *a); fn(Path(path), rec); return rec
        with mock.patch.object(bp, "write_record", write), self.assertRaisesRegex(bp.Refuse, pattern): self.e.run(execute=True, client=self.fake)
        self.assertFalse(any(c[0] == "put" for c in self.fake.calls))
    @staticmethod
    def rewrite(path, fn):
        rec = json.loads(path.read_text()); fn(rec); path.write_text(json.dumps(rec))

    def test_record_covers_every_uploaded_object(self):
        seen = []; real = bp.write_record
        with mock.patch.object(bp, "write_record", lambda path, *a: seen.append(real(path, *a)) or seen[-1]):
            man = self.e.run(execute=True, client=self.fake)
        rec = seen[0]
        put = {c[1] for c in self.fake.calls if c[0] == "put"} - {"manifest.json"}
        self.assertEqual(set(rec["files"]), put)
        self.assertEqual(len(put), 16 + 16 + 2 + 1)
        for k in put:
            self.assertEqual(rec["files"][k]["sha256"], hashlib.sha256(self.fake.store[k][0]).hexdigest(), k)
            self.assertEqual(rec["files"][k]["bytes"], len(self.fake.store[k][0]))
        self.assertEqual(rec["manifest_entry"], man["issues"][0]); self.assertEqual(rec["approved"], self.e.hashes)
        self.assertEqual(rec["schema"], bp.RECORD_SCHEMA); self.assertEqual(rec["renderer"]["dpi"], 150)

    def test_record_missing_a_file_refused(self):
        self.with_record(lambda p, r: self.rewrite(p, lambda rec: rec["files"].pop(sorted(rec["files"])[3])), "qa.json does not cover")

    def test_record_listing_extra_file_refused(self):
        self.with_record(lambda p, r: self.rewrite(p, lambda rec: rec["files"].__setitem__("issues/002/pages/p-17.000000000000.webp", {"sha256": "0" * 64})),
                         "not being uploaded")

    def test_record_hash_mismatch_refused(self):
        self.with_record(lambda p, r: self.rewrite(p, lambda rec: rec["files"]["issues/002/meta.json"].__setitem__("sha256", "0" * 64)), "SHA-256 mismatch")

    def test_file_changed_after_record_refused(self):
        def change(p, rec):
            m = p.parent / "002" / "meta.json"; m.write_text(m.read_text().replace("night-shift", "night shift"))
        self.with_record(change, "SHA-256 mismatch for issues/002/meta.json")

    def test_record_that_predates_files_refused(self):
        # 18 Oct: qa.json was written at 00:28, the images at 00:30.
        def early(p, rec):
            t = bp.utcnow() - __import__("datetime").timedelta(minutes=2)
            self.rewrite(p, lambda r: r.__setitem__("generated_at", bp.iso_us(t)))
        self.with_record(early, "qa.json predates")

    def test_record_file_older_than_files_refused(self):
        def old_mtime(p, rec):
            st = p.stat(); os.utime(p, ns=(st.st_atime_ns, st.st_mtime_ns - 120 * 10**9))
        self.with_record(old_mtime, "qa.json predates")

    def test_missing_or_foreign_record_refused(self):
        self.with_record(lambda p, r: p.unlink(), "build record missing")
        self.with_record(lambda p, r: self.rewrite(p, lambda rec: rec.__setitem__("issue", 3)), "not the build record")
        self.with_record(lambda p, r: self.rewrite(p, lambda rec: rec["manifest_entry"].__setitem__("cover_image", "pages/p-01.webp")), "manifest entry")

    def test_bytes_changed_between_check_and_put_refused(self):
        real_upload = bp.upload
        def racing(client, n, plan, meta, replace, record, out=print):
            key, path = plan[5][0], plan[5][1]; Path(path).write_bytes(Path(path).read_bytes() + b"\0")
            return real_upload(client, n, plan, meta, replace, record, out)
        with mock.patch.object(bp, "upload", racing), self.assertRaisesRegex(bp.Refuse, "changed after qa.json"): self.e.run(execute=True, client=self.fake)
        self.assertNotIn("manifest.json", self.fake.store)


class HashedNames(FastRender):
    """Per-build names: the content hash is in every image URL, so a corrected image never reuses a URL a browser may hold."""
    def setUp(self):
        super().setUp(); self.tmp = tempfile.TemporaryDirectory(); self.e = Env(self.tmp.name); self.fake = FakeS3()
    def tearDown(self): self.tmp.cleanup()

    def test_names_meta_and_manifest(self):
        man = self.e.run(execute=True, client=self.fake)
        meta = json.loads(self.fake.store["issues/002/meta.json"][0])
        f = meta["files"]
        self.assertEqual(len(f["pages"]), 16); self.assertEqual(len(f["thumbs"]), 16)
        for i, (pg, th) in enumerate(zip(f["pages"], f["thumbs"]), 1):
            self.assertRegex(pg, rf"^pages/p-{i:02d}\.[0-9a-f]{{12}}\.webp$"); self.assertRegex(th, rf"^pages/thumbs/p-{i:02d}\.[0-9a-f]{{12}}\.webp$")
            for rel in (pg, th):
                b = self.fake.store["issues/002/" + rel][0]; self.assertEqual(hashlib.sha256(b).hexdigest()[:12], rel.split(".")[1])
        self.assertEqual(meta["cover_image"], f["pages"][0])
        self.assertEqual(man["issues"][0]["cover_image"], f["pages"][0]); self.assertEqual(man["issues"][0]["cover_thumb"], f["thumbs"][0])
        self.assertFalse([k for k in self.fake.store if re.search(r"/p-\d+\.webp$", k)], "no legacy un-hashed image key is ever uploaded")

    def test_plan_refuses_unhashed_names(self):
        m = {"pages": 1, "files": {"pages": ["pages/p-01.webp"], "thumbs": ["pages/thumbs/p-01.webp"], "pdf_color": "a.pdf", "pdf_grayscale": "b.pdf"}}
        with self.assertRaisesRegex(bp.Refuse, "content-hash name"): bp.plan_objects(2, self.e.t, m)

    def test_corrected_page_republishes_under_new_url_without_overwriting(self):
        self.e.run(execute=True, client=self.fake)
        before = dict(self.fake.store); old10 = key_for(self.fake, 10)
        def fix_page_10(w, i, page):
            if i == 10: page.rotate(180)
            w.add_page(page)
        m = json.loads((self.e.src / "meta.json").read_text())
        for k, ed in (("pdf_color", "color"), ("pdf_grayscale", "grayscale")):  # corrected PDFs get new names (runbook)
            new = f"issue-002-{ed}-v2.pdf"; (self.e.src / m["files"][k]).rename(self.e.src / new); m["files"][k] = new
            edit_pdf(self.e.src / new, fix_page_10)
        (self.e.src / "meta.json").write_text(json.dumps(m)); resign(self.e)
        n = len(self.fake.calls)
        self.e.run(execute=True, client=self.fake, replace=True)
        puts = [c[1] for c in self.fake.calls[n:] if c[0] == "put"]
        self.assertFalse(set(puts) & (set(before) - {"issues/002/meta.json", "manifest.json"}), "no existing immutable key rewritten")
        self.assertEqual(self.fake.store[old10], before[old10])  # the old URL still holds the old bytes (nothing references it now)
        meta = json.loads(self.fake.store["issues/002/meta.json"][0])
        self.assertNotEqual("issues/002/" + meta["files"]["pages"][9], old10)
        self.assertEqual(meta["files"]["pages"][0], before_meta_page(before, 0))  # unchanged pages keep their URL (skipped)


def before_meta_page(store, i): return json.loads(store["issues/002/meta.json"][0])["files"]["pages"][i]


# ------------------------------------------------------------------ X status links: the only annotation a published PDF may keep
X_URL, TW_URL = "https://x.com/TrungTPhan/status/2111839499907223734", "https://twitter.com/trq212/status/2112219173288120531"


def pdf_dict(d): return DictionaryObject({NameObject("/" + k): v for k, v in d.items()})


def action(s, **kv): return pdf_dict({"S": NameObject(s), **kv})
def uri_action(u, **kv): return action("/URI", URI=TextStringObject(u), **kv)
def js_action(): return action("/JavaScript", JS=TextStringObject("app.alert(1)"))


def link_annot(act, rect=(72, 700, 220, 712), **kv):
    """A link exactly as strip writes it (kv adds keys, e.g. the /F and /StructParent Chromium writes)."""
    return pdf_dict({"Type": NameObject("/Annot"), "Subtype": NameObject("/Link"), "Rect": ArrayObject([FloatObject(v) for v in rect]),
                     "Border": ArrayObject([NumberObject(0)] * 3), "A": act, **kv})


def chromium_link(url): return link_annot(uri_action(url, Type=NameObject("/Action")), F=NumberObject(4), StructParent=NumberObject(0))


def add_annots(path, annots):
    """Add [(page, annotation)] to PDF path. Info stays empty, so the annotations are the only thing check could flag."""
    from pypdf import PdfReader, PdfWriter
    w = PdfWriter(); w.append(PdfReader(str(path)))
    for page, a in annots: w.pages[page - 1].setdefault(NameObject("/Annots"), ArrayObject()).append(w._add_object(a))
    for k in list(w._info.keys()): del w._info[k]
    with open(path, "wb") as f: w.write(f)


def approve_as_is(e):
    """Sign the source PDFs exactly as they are, WITHOUT stripping them first."""
    m = json.loads((e.src / "meta.json").read_text())
    e.hashes = {k: H(e.src / m["files"][k]) for k in ("pdf_color", "pdf_grayscale")}
    m["files"]["sha256"] = e.hashes; (e.src / "meta.json").write_text(json.dumps(m)); e.approve()


class XLinks(FastRender):
    """Published PDFs keep clickable links to X posts (minimal x.com/twitter.com status links) and nothing else."""
    def setUp(self):
        super().setUp(); self.tmp = tempfile.TemporaryDirectory(); self.e = Env(self.tmp.name); self.fake = FakeS3()
        self.colour = self.e.src / "issue-002-color.pdf"
    def tearDown(self): self.tmp.cleanup()

    def test_x_links_survive_strip_approval_and_publish(self):
        for ed in ("color", "grayscale"):
            add_annots(self.e.src / f"issue-002-{ed}.pdf", [(1, chromium_link(X_URL)), (3, chromium_link(TW_URL)),
                                                            (3, link_annot(uri_action("https://tracker.example/?u=1")))])
        resign(self.e)  # pre-approval strip: X links rebuilt minimal, tracker link dropped; then hash and sign
        want = [(1, X_URL), (3, TW_URL)]
        self.assertEqual(sm.pdf_x_links(self.colour), want)
        out = []; self.e.run(execute=True, client=self.fake, out=out.append)
        for ed in ("color", "grayscale"):
            self.assertIn(f"  issue-002-{ed}.pdf: 2 X status link(s)", out)
            body = self.fake.store[f"issues/002/issue-002-{ed}.pdf"][0]
            self.assertEqual(hashlib.sha256(body).hexdigest(), self.e.hashes[f"pdf_{ed}"])  # publish strip did not change a byte
            p = self.e.t / f"uploaded-{ed}.pdf"; p.write_bytes(body)
            self.assertEqual(sm.pdf_x_links(p), want); self.assertEqual(sm.pdf_problems(p), [])
            from pypdf import PdfReader
            self.assertEqual([len(pg.get("/Annots") or []) for pg in PdfReader(str(p)).pages][:4], [1, 0, 1, 0])

    def test_minimal_x_links_approved_as_is_pass_strip_and_check(self):
        add_annots(self.colour, [(1, link_annot(uri_action(X_URL))), (2, link_annot(uri_action(TW_URL)))])
        self.assertEqual(sm.pdf_problems(self.colour), [])
        approve_as_is(self.e)
        class PastStep2(Exception): pass
        with mock.patch.object(bp, "pdf_page_count", side_effect=PastStep2), self.assertRaises(PastStep2): self.e.run(execute=True, client=self.fake)
        self.assertEqual(self.fake.calls, [])

    def test_other_annotations_approved_unstripped_are_refused(self):
        cases = {
            "non-X URI": lambda: link_annot(uri_action("https://tracker.example/?u=1")),
            "x.com non-status path": lambda: link_annot(uri_action("https://x.com/TrungTPhan/likes")),
            "query string": lambda: link_annot(uri_action(X_URL + "?s=20")),
            "javascript: URI": lambda: link_annot(uri_action("javascript:app.alert(1)")),
            "JavaScript action": lambda: link_annot(js_action()),
            "Launch": lambda: link_annot(action("/Launch", F=TextStringObject("calc.exe"))),
            "X link with /AA": lambda: link_annot(uri_action(X_URL), AA=pdf_dict({"E": js_action()})),
            "X link with /Next chain": lambda: link_annot(uri_action(X_URL, Next=js_action())),
            "X link as Chromium writes it (not stripped before approval)": lambda: chromium_link(X_URL),
        }
        clean = self.colour.read_bytes()
        for name, make in cases.items():
            with self.subTest(name):
                self.colour.write_bytes(clean); add_annots(self.colour, [(2, make())])
                self.assertTrue(sm.pdf_problems(self.colour), "check must reject it")
                approve_as_is(self.e)
                with self.assertRaisesRegex(bp.Refuse, "pdf_color: bytes changed by strip"): self.e.run(execute=True, client=self.fake)
                self.assertEqual(self.fake.calls, [])

    def test_step5_check_rejects_annotation_added_after_strip(self):
        real = bp.verify_images
        def tamper(pdf, staged, meta):
            errs = real(pdf, staged, meta); add_annots(pdf, [(1, link_annot(uri_action("https://tracker.example/?u=1")))]); return errs
        with mock.patch.object(bp, "verify_images", tamper), self.assertRaisesRegex(bp.Refuse, "step check failed"): self.e.run(execute=True, client=self.fake)
        self.assertEqual(self.fake.calls, [])


if __name__ == "__main__":
    unittest.main()
