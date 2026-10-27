#!/usr/bin/env python3
"""CI only (.github/workflows/publish.yml): write the R2 env file that bookmark_publish.load_env() reads. Stdlib only.

Usage: ci_r2_env.py OUT_FILE      e.g. "$RUNNER_TEMP/wb/r2.env"; the directory is created mode 700, the file mode 600 (never overwritten)

Credentials come from this process's environment (the workflow maps the secrets into this one step only):
  CLOUDFLARE_R2_TOKEN    preferred: the R2 API token value. Everything else is derived from it at runtime:
                           R2_ACCOUNT_ID         GET /client/v4/accounts (exactly one account, 32 hex)
                           R2_ACCESS_KEY_ID      GET /client/v4/accounts/<id>/tokens/verify (success, status active): result.id
                           R2_SECRET_ACCESS_KEY  lowercase SHA-256 hex of the token value
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY   fallback, used only when CLOUDFLARE_R2_TOKEN is empty.
Each value is shape-checked (single line, expected characters; nothing is printed) and then registered with ::add-mask:: before it is
used, so a mask line can never carry a second, unmasked line. Nothing else ever prints a value: messages name the variable or the API
step, never its value or the API's response body (only Cloudflare's numeric error codes).
"""
import hashlib, json, os, re, stat, sys, urllib.error, urllib.request
from pathlib import Path

API = "https://api.cloudflare.com/client/v4"
BUCKET = "weekend-bookmark-issues"  # same constant as bookmark_publish.BUCKET
HEX32, HEX64 = re.compile(r"[0-9a-f]{32}"), re.compile(r"[0-9a-f]{64}")
TOKEN = re.compile(r"[A-Za-z0-9_-]{20,200}")
FALLBACK = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")


class Refuse(Exception):
    """Fail closed: message is safe to print (never contains a value)."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """urllib would replay the Authorization header to wherever a redirect points: never follow one."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, "redirect refused", headers, fp)


OPENER = urllib.request.build_opener(NoRedirect)


def mask(value, out):
    out.write(f"::add-mask::{value}\n"); out.flush()


def api_get(path, token, what):
    """GET API + path with the token. Returns the parsed body if success is true, else refuses (status / numeric codes only)."""
    req = urllib.request.Request(API + path, headers={"Authorization": f"Bearer {token}", "Accept": "application/json",
                                                      "User-Agent": "weekend-bookmark-ci"})
    try:
        with OPENER.open(req, timeout=30) as r: body = r.read(1_000_000)
    except urllib.error.HTTPError as e:
        raise Refuse(f"{what}: HTTP {e.code}{error_codes(e)}")
    except Exception as e:
        raise Refuse(f"{what}: request failed ({type(e).__name__})")
    try: data = json.loads(body)
    except ValueError: raise Refuse(f"{what}: response is not JSON")
    if not isinstance(data, dict) or data.get("success") is not True: raise Refuse(f"{what}: success is not true{codes(data)}")
    return data


def codes(data):
    errs = data.get("errors") if isinstance(data, dict) else None
    nums = [e["code"] for e in errs if isinstance(e, dict) and isinstance(e.get("code"), int)] if isinstance(errs, list) else []
    return f" (Cloudflare error code {', '.join(map(str, nums[:5]))})" if nums else ""


def error_codes(e):
    try: return codes(json.loads(e.read(100_000)))
    except Exception: return ""


def from_token(token, out):
    if not TOKEN.fullmatch(token): raise Refuse("CLOUDFLARE_R2_TOKEN does not look like an API token (20-200 of A-Z a-z 0-9 _ -)")
    mask(token, out)
    accts = api_get("/accounts", token, "list accounts").get("result")
    if not isinstance(accts, list) or len(accts) != 1: raise Refuse(f"list accounts: the token must see exactly one account (sees {len(accts) if isinstance(accts, list) else 'none'})")
    acct = accts[0].get("id") if isinstance(accts[0], dict) else None
    if not (isinstance(acct, str) and HEX32.fullmatch(acct)): raise Refuse("list accounts: account id is not 32 lowercase hex")
    mask(acct, out)
    res = api_get(f"/accounts/{acct}/tokens/verify", token, "verify token").get("result")
    if not isinstance(res, dict) or res.get("status") != "active": raise Refuse("verify token: token status is not active")
    key_id = res.get("id")
    if not (isinstance(key_id, str) and HEX32.fullmatch(key_id)): raise Refuse("verify token: token id is not 32 lowercase hex")
    mask(key_id, out)
    secret = hashlib.sha256(token.encode()).hexdigest()
    mask(secret, out)
    return {"R2_ACCOUNT_ID": acct, "R2_ACCESS_KEY_ID": key_id, "R2_SECRET_ACCESS_KEY": secret}


def from_fallback(environ, out):
    vals = {k: (environ.get(k) or "").strip() for k in FALLBACK}
    missing = [k for k, v in vals.items() if not v]
    if missing: raise Refuse("CLOUDFLARE_R2_TOKEN is empty and the fallback secrets are missing: " + ", ".join(missing))
    for k, rx, shape in (("R2_ACCOUNT_ID", HEX32, "32"), ("R2_ACCESS_KEY_ID", HEX32, "32"), ("R2_SECRET_ACCESS_KEY", HEX64, "64")):
        if not rx.fullmatch(vals[k]): raise Refuse(f"{k} is not {shape} lowercase hex")
    for k in FALLBACK: mask(vals[k], out)
    return vals


def inside_git_worktree(p):
    return any((d / ".git").exists() for d in [p.parent, *p.parent.parents])


def write_env(path, creds):
    """Dir 700 and file 600, both ours, no symlinks, never inside a git work tree, never overwriting: what load_env() demands."""
    p = Path(path).absolute()
    d = p.parent
    if inside_git_worktree(p): raise Refuse("env file must not live inside a git work tree")
    if d.is_symlink(): raise Refuse("env file directory must not be a symlink")
    if not d.exists(): d.mkdir(mode=0o700)
    st = d.lstat()
    if not stat.S_ISDIR(st.st_mode) or stat.S_IMODE(st.st_mode) != 0o700 or st.st_uid != os.getuid():
        raise Refuse(f"env file directory must be mode 700 and ours (is {stat.S_IMODE(st.st_mode):o})")
    try: fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except FileExistsError: raise Refuse("env file already exists; refusing to overwrite it")
    with os.fdopen(fd, "w") as f:
        os.fchmod(f.fileno(), 0o600)
        f.write("".join(f"{k}={creds[k]}\n" for k in FALLBACK) + f"R2_BUCKET={BUCKET}\n")
    return p


def main(argv=None, environ=None, out=None, err=None):
    argv = sys.argv[1:] if argv is None else argv
    environ = os.environ if environ is None else environ
    out, err = out or sys.stdout, err or sys.stderr
    if len(argv) != 1: err.write("usage: ci_r2_env.py OUT_FILE\n"); return 2
    os.umask(0o077)
    try:
        token = (environ.get("CLOUDFLARE_R2_TOKEN") or "").strip()
        if token:
            creds, source = from_token(token, out), "derived from CLOUDFLARE_R2_TOKEN"
        else:
            creds, source = from_fallback(environ, out), "from R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY"
        p = write_env(argv[0], creds)
    except Refuse as e:
        err.write(f"REFUSED: {e}\n"); return 1
    except Exception as e:
        err.write(f"FAILED: {type(e).__name__}\n"); return 1
    out.write(f"r2 env: wrote {p} ({source}; values masked, not shown)\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
