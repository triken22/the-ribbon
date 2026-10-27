#!/usr/bin/env python3
"""Tests for ci_r2_env.py (the CI credential step). Network is mocked; every value is an obviously fake one assembled at runtime.
Run: python3 site/scripts/test_ci_r2_env.py"""
import hashlib, io, json, os, stat, tempfile, unittest, urllib.error
from pathlib import Path
from unittest import mock
import ci_r2_env as ce

TOKEN = "FAKE" + "-test-only" * 4            # 44 chars, token-shaped, assembled at runtime
ACCOUNT = "0f" * 16                          # 32 hex
KEY_ID = "ab" * 16                           # 32 hex
SECRET = hashlib.sha256(TOKEN.encode()).hexdigest()
FB = {"R2_ACCOUNT_ID": "1e" * 16, "R2_ACCESS_KEY_ID": "2d" * 16, "R2_SECRET_ACCESS_KEY": "3c" * 32}


class Resp:
    def __init__(self, body): self.body = body
    def read(self, n=-1): return self.body
    def __enter__(self): return self
    def __exit__(self, *a): return False


class FakeAPI:
    """Stands in for ce.OPENER: answers by path, records every request (URL and Authorization header)."""
    def __init__(self, accounts=None, verify=None, status=None, body=None):
        self.accounts = [{"id": ACCOUNT, "name": "fake"}] if accounts is None else accounts
        self.verify = {"id": KEY_ID, "status": "active"} if verify is None else verify
        self.status, self.body, self.seen = status, body, []
    def open(self, req, timeout=None):
        self.seen.append((req.full_url, req.get_header("Authorization")))
        if self.status:
            raise urllib.error.HTTPError(req.full_url, self.status, "x", {}, io.BytesIO(self.body or b""))
        if req.full_url == ce.API + "/accounts":
            return Resp(json.dumps({"success": True, "errors": [], "result": self.accounts}).encode())
        if req.full_url == f"{ce.API}/accounts/{ACCOUNT}/tokens/verify":
            return Resp(json.dumps({"success": True, "errors": [], "result": self.verify}).encode())
        raise AssertionError(f"unexpected URL {req.full_url}")


class T(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.t = Path(self.tmp.name)
        self.out_file = self.t / "wb" / "r2.env"
    def tearDown(self): self.tmp.cleanup()

    def run_main(self, environ, api=None, path=None):
        out, err = io.StringIO(), io.StringIO()
        api = api or FakeAPI()
        with mock.patch.object(ce, "OPENER", api):
            rc = ce.main([str(path or self.out_file)], environ=environ, out=out, err=err)
        return rc, out.getvalue(), err.getvalue(), api

    def assert_no_leak(self, out, err, values):
        """A value may appear in stdout ONLY as its own ::add-mask:: line, and never in stderr (nor an 8-char prefix of it)."""
        for v in values:
            self.assertNotIn(v[:8], err)
            for line in out.splitlines():
                if v[:8] in line: self.assertEqual(line, f"::add-mask::{v}", "value outside its mask line")

    def test_token_derives_masks_and_writes(self):
        rc, out, err, api = self.run_main({"CLOUDFLARE_R2_TOKEN": TOKEN})
        self.assertEqual(rc, 0, err)
        lines = out.splitlines()
        self.assertEqual(lines[:4], [f"::add-mask::{v}" for v in (TOKEN, ACCOUNT, KEY_ID, SECRET)])  # token first, then each value as derived
        self.assert_no_leak(out, err, [TOKEN, ACCOUNT, KEY_ID, SECRET])
        self.assertIn("values masked, not shown", out)
        self.assertEqual(self.out_file.read_text(),
                         f"R2_ACCOUNT_ID={ACCOUNT}\nR2_ACCESS_KEY_ID={KEY_ID}\nR2_SECRET_ACCESS_KEY={SECRET}\nR2_BUCKET=weekend-bookmark-issues\n")
        self.assertEqual(stat.S_IMODE(self.out_file.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.out_file.parent.stat().st_mode), 0o700)
        self.assertEqual(api.seen, [(ce.API + "/accounts", f"Bearer {TOKEN}"), (f"{ce.API}/accounts/{ACCOUNT}/tokens/verify", f"Bearer {TOKEN}")])

    def test_secret_is_lowercase_sha256_of_token(self):
        self.run_main({"CLOUDFLARE_R2_TOKEN": TOKEN})
        got = dict(l.split("=", 1) for l in self.out_file.read_text().splitlines())["R2_SECRET_ACCESS_KEY"]
        self.assertEqual(got, hashlib.sha256(TOKEN.encode()).hexdigest()); self.assertEqual(got, got.lower()); self.assertEqual(len(got), 64)

    def test_load_env_accepts_the_file(self):
        try: import bookmark_publish as bp
        except ImportError: self.skipTest("bookmark_publish needs pypdf")
        self.assertEqual(self.run_main({"CLOUDFLARE_R2_TOKEN": TOKEN})[0], 0)
        env = bp.load_env(self.out_file)
        self.assertEqual(env, {"R2_ACCOUNT_ID": ACCOUNT, "R2_ACCESS_KEY_ID": KEY_ID, "R2_SECRET_ACCESS_KEY": SECRET, "R2_BUCKET": bp.BUCKET})
        self.assertEqual(ce.BUCKET, bp.BUCKET)

    def test_token_wins_over_fallback(self):
        rc, out, err, _ = self.run_main({"CLOUDFLARE_R2_TOKEN": TOKEN, **FB})
        self.assertEqual(rc, 0, err); self.assertIn(f"R2_ACCOUNT_ID={ACCOUNT}\n", self.out_file.read_text())

    def test_fallback_when_token_empty(self):
        rc, out, err, api = self.run_main({"CLOUDFLARE_R2_TOKEN": "", **FB})
        self.assertEqual(rc, 0, err); self.assertEqual(api.seen, [])  # no network on the fallback path
        for v in FB.values(): self.assertIn(f"::add-mask::{v}", out.splitlines())
        self.assert_no_leak(out, err, list(FB.values()))
        self.assertEqual(self.out_file.read_text(), "".join(f"{k}={FB[k]}\n" for k in ce.FALLBACK) + "R2_BUCKET=weekend-bookmark-issues\n")

    def test_fallback_missing_names_only(self):
        rc, out, err, _ = self.run_main({"R2_ACCOUNT_ID": FB["R2_ACCOUNT_ID"]})
        self.assertEqual(rc, 1); self.assertIn("R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY", err)
        self.assertNotIn(FB["R2_ACCOUNT_ID"], out + err); self.assertFalse(self.out_file.exists())

    def test_fallback_bad_shape_refused_unprinted(self):
        bad = {**FB, "R2_SECRET_ACCESS_KEY": "not-hex-" + "z" * 30}
        rc, out, err, _ = self.run_main(bad)
        self.assertEqual(rc, 1); self.assertIn("R2_SECRET_ACCESS_KEY is not 64 lowercase hex", err)
        self.assertNotIn(bad["R2_SECRET_ACCESS_KEY"], out + err); self.assertFalse(self.out_file.exists())

    def test_multiline_token_refused_before_any_mask(self):
        rc, out, err, api = self.run_main({"CLOUDFLARE_R2_TOKEN": TOKEN + "\nSECOND-LINE-" + "q" * 10})
        self.assertEqual(rc, 1); self.assertEqual(out, ""); self.assertEqual(api.seen, [])
        self.assertNotIn("SECOND-LINE", err); self.assertNotIn(TOKEN[:8], err)

    def test_account_count_must_be_one(self):
        for accts in ([], [{"id": ACCOUNT}, {"id": "9" * 32}]):
            with self.subTest(n=len(accts)):
                rc, out, err, _ = self.run_main({"CLOUDFLARE_R2_TOKEN": TOKEN}, FakeAPI(accounts=accts))
                self.assertEqual(rc, 1); self.assertIn("exactly one account", err); self.assertFalse(self.out_file.exists())
                self.assert_no_leak(out, err, [TOKEN, "9" * 32])

    def test_token_must_be_active(self):
        for verify in ({"id": KEY_ID, "status": "disabled"}, {"id": KEY_ID}, {"status": "active"}, {"id": "../x", "status": "active"}):
            with self.subTest(verify=verify):
                rc, out, err, _ = self.run_main({"CLOUDFLARE_R2_TOKEN": TOKEN}, FakeAPI(verify=verify))
                self.assertEqual(rc, 1); self.assertIn("verify token", err); self.assertFalse(self.out_file.exists())
                self.assertNotIn(f"::add-mask::{SECRET}", out)  # nothing is derived past the failing step

    def test_http_error_body_is_never_printed(self):
        body = json.dumps({"success": False, "errors": [{"code": 1000, "message": f"Invalid API Token {TOKEN}"}]}).encode()
        rc, out, err, _ = self.run_main({"CLOUDFLARE_R2_TOKEN": TOKEN}, FakeAPI(status=403, body=body))
        self.assertEqual(rc, 1); self.assertIn("list accounts: HTTP 403 (Cloudflare error code 1000)", err)
        self.assertNotIn("Invalid API Token", err); self.assert_no_leak(out, err, [TOKEN])

    def test_success_false_refused(self):
        api = FakeAPI()
        api.open = lambda req, timeout=None: Resp(json.dumps({"success": False, "errors": [{"code": 9109, "message": TOKEN}]}).encode())
        rc, out, err, _ = self.run_main({"CLOUDFLARE_R2_TOKEN": TOKEN}, api)
        self.assertEqual(rc, 1); self.assertIn("success is not true (Cloudflare error code 9109)", err); self.assert_no_leak(out, err, [TOKEN])

    def test_redirects_are_never_followed(self):
        import urllib.request
        req = urllib.request.Request(ce.API + "/accounts", headers={"Authorization": f"Bearer {TOKEN}"})
        with self.assertRaises(urllib.error.HTTPError):
            ce.NoRedirect().redirect_request(req, io.BytesIO(), 302, "Found", {}, "https://elsewhere.invalid/")
        self.assertTrue(any(isinstance(h, ce.NoRedirect) for h in ce.OPENER.handlers))

    def test_never_overwrites(self):
        self.out_file.parent.mkdir(mode=0o700); self.out_file.write_text("keep\n")
        rc, out, err, _ = self.run_main({"CLOUDFLARE_R2_TOKEN": TOKEN})
        self.assertEqual(rc, 1); self.assertIn("refusing to overwrite", err); self.assertEqual(self.out_file.read_text(), "keep\n")

    def test_dir_must_be_700(self):
        self.out_file.parent.mkdir(); os.chmod(self.out_file.parent, 0o755)
        rc, out, err, _ = self.run_main({"CLOUDFLARE_R2_TOKEN": TOKEN})
        self.assertEqual(rc, 1); self.assertIn("mode 700", err); self.assertFalse(self.out_file.exists())

    def test_dir_symlink_refused(self):
        real = self.t / "real"; real.mkdir(mode=0o700); self.out_file.parent.symlink_to(real)
        rc, out, err, _ = self.run_main({"CLOUDFLARE_R2_TOKEN": TOKEN})
        self.assertEqual(rc, 1); self.assertIn("symlink", err); self.assertEqual(list(real.iterdir()), [])

    def test_refuses_inside_git_worktree(self):
        (self.t / ".git").mkdir()
        rc, out, err, _ = self.run_main({"CLOUDFLARE_R2_TOKEN": TOKEN})
        self.assertEqual(rc, 1); self.assertIn("git work tree", err); self.assertFalse(self.out_file.parent.exists())

    def test_usage(self):
        err = io.StringIO()
        self.assertEqual(ce.main([], environ={}, out=io.StringIO(), err=err), 2); self.assertIn("usage", err.getvalue())


if __name__ == "__main__":
    unittest.main()
