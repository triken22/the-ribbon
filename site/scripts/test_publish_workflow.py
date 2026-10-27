#!/usr/bin/env python3
"""Invariants of .github/workflows/publish.yml that keep the R2 credentials contained (needs PyYAML; skipped without it).
Run: python3 site/scripts/test_publish_workflow.py"""
import re, unittest
from pathlib import Path

try: import yaml
except ImportError: yaml = None

WF = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "publish.yml"
SECRETS = {"CLOUDFLARE_R2_TOKEN", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"}


@unittest.skipUnless(yaml, "PyYAML not installed")
class T(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = WF.read_text(); cls.wf = yaml.safe_load(cls.text)
        cls.jobs = cls.wf["jobs"]; cls.pub = cls.jobs["publish"]; cls.steps = cls.pub["steps"]
    def step(self, prefix):
        (s,) = [s for s in self.steps if s.get("name", "").startswith(prefix)]; return s

    def test_trigger_and_inputs(self):
        on = self.wf.get("on", self.wf.get(True))  # YAML 1.1 reads a bare `on` key as True
        self.assertEqual(list(on), ["workflow_dispatch"])
        i = on["workflow_dispatch"]["inputs"]
        self.assertEqual((i["issue"]["type"], i["issue"]["required"]), ("string", True))
        self.assertEqual((i["replace"]["type"], i["replace"]["default"]), ("boolean", False))
        self.assertEqual((i["dry_run"]["type"], i["dry_run"]["default"]), ("boolean", True))

    def test_permissions_concurrency_environment(self):
        self.assertEqual(self.wf["permissions"], {"contents": "read"})
        self.assertEqual(self.wf["concurrency"], {"group": "publish", "cancel-in-progress": False})
        self.assertEqual((self.pub["runs-on"], self.pub["environment"]), ("ubuntu-latest", "publish"))
        for job in self.jobs.values(): self.assertNotIn("permissions", job)  # nothing widens the top-level read-only token

    def test_no_expressions_in_run_scripts(self):
        for name, job in self.jobs.items():
            for s in job["steps"]:
                if "run" in s: self.assertNotIn("${{", s["run"], f"{name}/{s.get('name')}: pass values via env, never ${{{{ }}}} in run")
                self.assertNotRegex(s.get("run", ""), r"(^|\s)set\s+-[a-z]*x", "no xtrace")

    def test_secrets_only_in_the_credential_step_env(self):
        cred = self.step("Write R2 credentials")
        self.assertEqual(cred["if"], "${{ !inputs.dry_run }}")
        self.assertEqual(cred["env"], {k: f"${{{{ secrets.{k} }}}}" for k in SECRETS})
        self.assertEqual(len(re.findall(r"secrets\.", self.text)), len(SECRETS))  # nowhere else in the file
        self.assertIn('ci_r2_env.py "$RUNNER_TEMP/wb/r2.env"', cred["run"]); self.assertIn("umask 077", cred["run"])

    def test_publish_command(self):
        p = self.step("Publish")
        self.assertEqual(p["env"]["BOOKMARK_ENV_FILE"], "${{ runner.temp }}/wb/r2.env")
        self.assertTrue(p["env"]["BOOKMARK_PUBLISH_LOG"].startswith("${{ runner.temp }}/"))
        self.assertNotIn("secrets", str(p))
        r = p["run"]
        self.assertIn('args=(publish "$ISSUE" --src "issues/$ISSUE" --gate-dir "$gate" --no-signoff)', r)
        self.assertIn('if [[ "$DRY_RUN" == false ]]; then args+=(--execute); else args+=(--dry-run); fi', r)
        self.assertIn('mkdir -m 700 "$gate"', r); self.assertIn('cp -- "gates/$ISSUE.qa.json" "$gate/"', r)

    def test_inputs_validated_before_checkout(self):
        for job in self.jobs.values():
            first = job["steps"][0]
            self.assertEqual(first["name"], "Validate inputs"); self.assertIn("^[0-9]{3}$", first["run"])
            self.assertTrue(any(s.get("uses", "").startswith("actions/checkout@") for s in job["steps"][1:2]))

    def test_checkout_does_not_persist_the_token(self):
        for job in self.jobs.values():
            for s in job["steps"]:
                if s.get("uses", "").startswith("actions/checkout@"): self.assertIs(s["with"]["persist-credentials"], False)

    def test_only_github_actions_are_used(self):
        uses = [s["uses"] for job in self.jobs.values() for s in job["steps"] if "uses" in s]
        self.assertTrue(uses); self.assertTrue(all(u.split("/")[0] == "actions" for u in uses), uses)

    def test_log_uploaded_and_credentials_removed_always(self):
        up = self.step("Upload the publish log")
        self.assertEqual(up["if"], "${{ always() }}"); self.assertIn("wb-log/publish.log", up["with"]["path"]); self.assertNotIn("/wb/", up["with"]["path"])
        last = self.steps[-1]
        self.assertEqual(last["if"], "${{ always() }}"); self.assertIn('rm -rf -- "$RUNNER_TEMP/wb"', last["run"])

    def test_dependencies_are_hash_pinned(self):
        r = self.step("Install Python dependencies")["run"]
        self.assertIn("--require-hashes", r); self.assertIn("-r site/scripts/requirements-publish.txt", r)
        req = (WF.parents[2] / "site" / "scripts" / "requirements-publish.txt").read_text()
        pins = re.findall(r"^([a-z0-9_.-]+)==(\S+) \\$", req, re.M)
        self.assertEqual({n for n, _ in pins}, {"boto3", "botocore", "jmespath", "pillow", "pypdf", "python-dateutil", "s3transfer", "six", "urllib3"})

    def test_qa_job(self):
        qa = self.jobs["qa"]
        self.assertEqual((qa["needs"], qa["if"]), ("publish", "${{ !inputs.dry_run }}"))
        self.assertNotIn("environment", qa); self.assertNotIn("secrets", str(qa))
        self.assertIn('ci_qa_public.py "$ISSUE" --expect-meta "issues/$ISSUE/meta.json"', qa["steps"][-1]["run"])


if __name__ == "__main__":
    unittest.main()
