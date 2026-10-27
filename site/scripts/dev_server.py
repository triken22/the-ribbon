#!/usr/bin/env python3
"""Local dev/test server. Serves site/public/ and, with --fixtures, overlays site/dev-fixtures/ at the site root
(manifest.json, issues/...) for paths that do not exist in public/. Unknown paths return 404 (404.html if present),
like Cloudflare Pages without a SPA fallback. Never used in production.

  python3 site/scripts/dev_server.py --fixtures [--port 8788]
  python3 site/scripts/dev_server.py --root /tmp/preview   # a copy of public/ with real data merged in, outside the repo
"""
import argparse, http.server, os, posixpath, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.normpath(os.path.join(HERE, '..', 'public'))
FIXT = os.path.normpath(os.path.join(HERE, '..', 'dev-fixtures'))
ROOTS = [PUBLIC]


class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        path = posixpath.normpath(urllib.parse.unquote(urllib.parse.urlsplit(path).path))
        parts = [p for p in path.split('/') if p and p not in ('.', '..')]
        for root in ROOTS:
            cand = os.path.join(root, *parts)
            if os.path.isdir(cand) and os.path.isfile(os.path.join(cand, 'index.html')):
                return cand
            if os.path.isfile(cand):
                return cand
        return os.path.join(PUBLIC, *parts)

    def send_error(self, code, message=None, explain=None):
        if code == 404:
            f = os.path.join(PUBLIC, '404.html')
            if os.path.isfile(f):
                body = open(f, 'rb').read()
                self.send_response(404)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                if self.command != 'HEAD':
                    self.wfile.write(body)
                return
        super().send_error(code, message, explain)

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--fixtures', action='store_true')
    ap.add_argument('--port', type=int, default=8788)
    ap.add_argument('--root', help='serve this directory instead of site/public (local previews only)')
    a = ap.parse_args()
    if a.root:
        PUBLIC = os.path.abspath(a.root)
        ROOTS[0] = PUBLIC
    if a.fixtures:
        ROOTS.append(FIXT)
    http.server.ThreadingHTTPServer(('127.0.0.1', a.port), H).serve_forever()
