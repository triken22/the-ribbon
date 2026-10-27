#!/usr/bin/env python3
"""Tests for check_secrets.sh (Codex #5: test files are scanned; Codex #6: matched values are never printed).
Fake credentials are assembled at runtime so this file itself never contains a literal the scanner would flag.
Run: python3 site/scripts/test_check_secrets.py"""
import os, shutil, subprocess, tempfile, unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "check_secrets.sh"
KEY_ID = "AK" + "IA" + "Q7ZX" * 4                     # matches the access-key-id pattern, assembled at runtime
SHORT_SECRET = "Zq9" + "xW2vL7pR4tY8k"               # 16 chars: was fully reproducible from the old 80-char line excerpt
PEM = "-----BEGIN " + "OPENSSH PRIVATE KEY-----"


class T(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.repo = Path(self.tmp.name)
        (self.repo / "site" / "scripts").mkdir(parents=True)
        shutil.copy(SCRIPT, self.repo / "site" / "scripts" / "check_secrets.sh")
        (self.repo / "site" / "index.html").write_text("<p>hello</p>\n")
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)
    def tearDown(self): self.tmp.cleanup()

    def scan(self):
        r = subprocess.run(["bash", str(self.repo / "site" / "scripts" / "check_secrets.sh")], capture_output=True, text=True)
        return r.returncode, r.stdout + r.stderr

    def test_clean_repo_passes(self):
        rc, out = self.scan(); self.assertEqual(rc, 0, out); self.assertIn("OK: no secrets found", out)

    def test_test_files_are_scanned(self):  # Codex #5
        for name, body in (("site/scripts/test_upload.py", f'KEY = "{KEY_ID}"\n'),
                           ("site/scripts/test_fixture.mjs", f"// {PEM}\n"),
                           ("site/dev-fixtures/test_env.txt", f"R2_SECRET_ACCESS_KEY={SHORT_SECRET}\n")):
            with self.subTest(name=name):
                p = self.repo / name; p.parent.mkdir(parents=True, exist_ok=True); p.write_text("x = 1\n" + body)
                rc, out = self.scan()
                self.assertEqual(rc, 1, out); self.assertIn(f"{name}:2", out)
                p.unlink()

    def test_env_files_fail_but_env_example_passes(self):
        for name in (".env", ".env.local", "workers/email/.env.production", "site/r2.env"):
            with self.subTest(name=name):
                p = self.repo / name; p.parent.mkdir(parents=True, exist_ok=True); p.write_text("X=\n")
                rc, out = self.scan(); self.assertEqual(rc, 1, out); self.assertIn(name, out)
                p.unlink()
        ex = self.repo / "workers" / "email" / ".env.example"; ex.parent.mkdir(parents=True, exist_ok=True)
        ex.write_text("# names only\n" + "".join(f"{name}=\n" for name in ("RESEND_API_KEY", "R2_SECRET_ACCESS_KEY")))
        rc, out = self.scan(); self.assertEqual(rc, 0, out)
        ex.write_text(f"R2_SECRET_ACCESS_KEY={SHORT_SECRET}\n")  # an example with a real-looking value is still caught
        rc, out = self.scan(); self.assertEqual(rc, 1, out); self.assertIn("workers/email/.env.example:1", out)

    def test_matched_values_are_redacted(self):  # Codex #6
        p = self.repo / "site" / "config.txt"
        p.write_text(f"a=1\nR2_SECRET_ACCESS_KEY={SHORT_SECRET}\nid={KEY_ID}\n")
        rc, out = self.scan()
        self.assertEqual(rc, 1)
        self.assertIn("site/config.txt:2", out); self.assertIn("site/config.txt:3", out); self.assertIn("value redacted", out)
        self.assertNotIn(SHORT_SECRET, out); self.assertNotIn(KEY_ID, out); self.assertNotIn(SHORT_SECRET[:6], out)

    def test_redaction_without_git(self):
        shutil.rmtree(self.repo / ".git")
        (self.repo / "site" / "x.txt").write_text(f"R2_ACCESS_KEY_ID={SHORT_SECRET}\n")
        rc, out = self.scan()
        self.assertEqual(rc, 1); self.assertIn("site/x.txt:1", out); self.assertNotIn(SHORT_SECRET, out)

    def test_only_the_scanner_itself_is_excluded(self):
        src = SCRIPT.read_text()
        self.assertNotIn("test_", src.split("files=")[1].split("\n")[0])
        self.assertNotIn("/test_'", src)


if __name__ == "__main__":
    unittest.main()
