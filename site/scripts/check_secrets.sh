#!/usr/bin/env bash
# Simple secret scan for the repo (no CI job runs it yet, so run it by hand and before every merge; see docs/PUBLISH.md).
# Fails on: tracked env files (except .env.example), AWS/R2-style access key ids, 64-hex secrets assigned to *secret*/*token*/*key* names, private keys, and R2/S3 credential variables with values.
set -uo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$repo"
fail=0
if git rev-parse --git-dir >/dev/null 2>&1; then
  # Only the scanner itself is excluded (its patterns are not secrets). Tests and fixtures ARE scanned (Codex #5): tests must build
  # fake credentials at runtime instead of committing literals that look real.
  files="$(git ls-files -co --exclude-standard | grep -v '^site/scripts/check_secrets.sh$')"
  # .env.example files (secret names, empty values) are allowed; their contents are still scanned below.
  envfiles="$(echo "$files" | grep -E '(^|/)(\.env($|\.)|[^/]*\.env$)' | grep -Ev '(^|/)\.env\.example$' || true)"
  if [ -n "$envfiles" ]; then echo "FAIL: an env file is tracked or untracked-but-not-ignored:" >&2; echo "$envfiles" >&2; fail=1; fi
else
  files="$(find site -type f | grep -v '^site/scripts/check_secrets.sh$')"
fi
scan() { # label, regex
  # Report file:line only, never the matched text (Codex #6): a short secret would otherwise be printed in full into logs.
  hits="$(echo "$files" | tr '\n' '\0' | xargs -0 -r grep -IEHn -e "$2" 2>/dev/null | cut -d: -f1,2 || true)"
  if [ -n "$hits" ]; then echo "FAIL: $1 (value redacted) at:" >&2; echo "$hits" >&2; fail=1; fi
}
scan "AWS/R2 access key id" '\b(AKIA|ASIA)[0-9A-Z]{16}\b'
scan "private key block" '-----BEGIN [A-Z ]*PRIVATE KEY-----'
scan "R2 credential variable with a value" '(R2_SECRET_ACCESS_KEY|R2_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|CLOUDFLARE_API_TOKEN)[[:space:]]*[=:][[:space:]]*[A-Za-z0-9/+_-]{16,}'
scan "long hex assigned to a secret-like name" '(secret|token|api[_-]?key|password)[A-Za-z_]*["'"'"']?[[:space:]]*[=:][[:space:]]*["'"'"']?[0-9a-f]{40,}'
scan "R2 endpoint with credentials" 'https://[^/ ]*:[^/ @]*@[^/ ]*r2\.cloudflarestorage\.com'
[ "$fail" -eq 0 ] && echo "OK: no secrets found"
exit "$fail"
