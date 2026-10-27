#!/usr/bin/env bash
# Fails if example/sample data would ship to production. Run before every production publish and in CI.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
fail=0
if [ -e "$root/public/example" ]; then echo "FAIL: $root/public/example exists. Example data must not ship (use site/dev-fixtures/)." >&2; fail=1; fi
if grep -rIn "/example/" "$root/public" --include='*.js' --include='*.html' --include='*.json' --include='_redirects' --include='_headers' >/dev/null 2>&1; then
  echo "FAIL: a '/example/' reference remains in site/public:" >&2
  grep -rIn "/example/" "$root/public" --include='*.js' --include='*.html' --include='*.json' --include='_redirects' --include='_headers' >&2 || true
  fail=1
fi
if [ -e "$root/public/_redirects" ] && grep -Eq '^[[:space:]]*/\*[[:space:]]' "$root/public/_redirects"; then
  echo "FAIL: catch-all rule in _redirects would turn 404s into 200s." >&2; fail=1
fi
if [ -d "$root/functions" ] && grep -rEn "\.(put|delete|createMultipartUpload)\(" "$root/functions" >/dev/null 2>&1; then echo "FAIL: a Pages Function calls a write method on a binding." >&2; fail=1; fi
if ! "$root/scripts/check_secrets.sh" >/dev/null 2>&1; then echo "FAIL: secret scan (run site/scripts/check_secrets.sh)." >&2; fail=1; fi
[ "$fail" -eq 0 ] && echo "OK: no example data in site/public"
exit "$fail"
