// Read-only gateway from the private R2 bucket (binding ISSUES) to visitors.
// Pages `_headers` does NOT apply to Function responses, so every header is set here and must match public/_headers (a test enforces it).
// Read-only by design: the only bucket calls are head() and get(). A test greps the source for any write verb.

export const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; upgrade-insecure-requests",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

const IMMUTABLE = 'public, max-age=31536000, immutable';
const SHORT = 'public, max-age=60';

// Strict allowlist. Percent signs, backslashes, "..", "//" and query strings never match.
// PDF names: [a-z0-9-]{1,80}.pdf, the same limit validate_issue.py and the audit enforce at publish (Codex #4).
// Page images: per-build p-NN.<12 lowercase hex>.webp (content hash in the URL, what bookmark publish uploads), or the legacy
// p-NN.webp that issues published before the per-build names still reference.
const RULES = [
  { re: /^\/issues\/(?!000)\d{3}\/meta\.json$/, type: 'application/json', cache: SHORT },
  { re: /^\/issues\/(?!000)\d{3}\/[a-z0-9-]{1,80}\.pdf$/, type: 'application/pdf', cache: IMMUTABLE, pdf: true },
  { re: /^\/issues\/(?!000)\d{3}\/pages\/p-(?!00)\d{2,3}(?:\.[0-9a-f]{12})?\.webp$/, type: 'image/webp', cache: IMMUTABLE },
  { re: /^\/issues\/(?!000)\d{3}\/pages\/thumbs\/p-(?!00)\d{2,3}(?:\.[0-9a-f]{12})?\.webp$/, type: 'image/webp', cache: IMMUTABLE },
  { re: /^\/manifest\.json$/, type: 'application/json', cache: SHORT, key: 'manifest.json' },
];

/** Returns {key, type, cache, pdf} for an allowed raw path, else null. Pure; no I/O. */
export function route(pathname) {
  if (typeof pathname !== 'string' || /[%\\\0]|\.\.|\/\//.test(pathname)) return null;
  for (const r of RULES) if (r.re.test(pathname)) return { key: r.key || pathname.slice(1), type: r.type, cache: r.cache, pdf: !!r.pdf };
  return null;
}

function withSecurity(h) { for (const [k, v] of Object.entries(SECURITY_HEADERS)) h.set(k, v); return h; }

/** A 404 (or any non-served path) that falls through to the static site, with the security headers and no-store re-asserted. */
async function notFound(next) {
  let res;
  try { res = await next(); } catch { res = new Response('Not found', { status: 404 }); }
  const h = withSecurity(new Headers(res.headers));
  if (res.status === 404) { h.set('Cache-Control', 'no-store'); h.set('X-Robots-Tag', 'noindex'); }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

const etagMatch = (header, etag) => {
  if (!header) return false;
  if (header.trim() === '*') return true;
  const strip = (s) => s.trim().replace(/^W\//, '');
  return header.split(',').some((t) => strip(t) === strip(etag));
};

/** Parse a single "bytes=a-b" range. Returns null (ignore header), 'bad' (416) or {offset,length}. */
export function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null; // malformed or multi-range: ignore, serve 200
  let start, end;
  if (m[1] === '') { const n = +m[2]; if (n === 0) return 'bad'; start = Math.max(0, size - n); end = size - 1; }
  else { start = +m[1]; end = m[2] === '' ? size - 1 : Math.min(+m[2], size - 1); if (m[2] !== '' && +m[2] < start) return null; }
  if (start >= size) return 'bad';
  return { offset: start, length: end - start + 1 };
}

export async function serve({ request, env, next }) {
  const url = new URL(request.url);
  if (url.search !== '' || request.url.includes('?')) return notFound(next); // no query tricks
  const rt = route(url.pathname);
  if (!rt) return notFound(next);
  const method = request.method;
  if (method !== 'GET' && method !== 'HEAD') {
    const h = withSecurity(new Headers({ Allow: 'GET, HEAD', 'Cache-Control': 'no-store' }));
    return new Response(null, { status: 405, headers: h });
  }
  const bucket = env && env.ISSUES;
  if (!bucket) return notFound(next); // binding not configured: behave like a missing file (empty state)

  const baseHeaders = (obj) => {
    const h = withSecurity(new Headers());
    h.set('Content-Type', rt.type); // from the extension allowlist, never from stored metadata
    h.set('Cache-Control', rt.cache);
    h.set('ETag', obj.httpEtag);
    h.set('X-Robots-Tag', 'noindex');
    if (rt.pdf) { h.set('Accept-Ranges', 'bytes'); h.set('Content-Disposition', `inline; filename="${rt.key.split('/').pop()}"`); }
    return h;
  };

  try {
    const range = rt.pdf ? request.headers.get('Range') : null;
    let obj;
    if (method === 'HEAD' || range) obj = await bucket.head(rt.key);
    else obj = await bucket.get(rt.key);
    if (!obj) return notFound(next);

    const h = baseHeaders(obj);
    if (etagMatch(request.headers.get('If-None-Match'), obj.httpEtag)) {
      if (obj.body && obj.body.cancel) obj.body.cancel();
      return new Response(null, { status: 304, headers: h });
    }
    h.set('Content-Length', String(obj.size));
    if (method === 'HEAD') return new Response(null, { status: 200, headers: h });

    const ifRange = request.headers.get('If-Range');
    const r = range && (!ifRange || ifRange === obj.httpEtag) ? parseRange(range, obj.size) : null;
    if (r === 'bad') {
      h.set('Content-Range', `bytes */${obj.size}`); h.set('Content-Length', '0'); h.set('Cache-Control', 'no-store');
      return new Response(null, { status: 416, headers: h });
    }
    if (r) {
      const part = await bucket.get(rt.key, { range: { offset: r.offset, length: r.length } });
      if (!part || !part.body) return notFound(next);
      h.set('Content-Range', `bytes ${r.offset}-${r.offset + r.length - 1}/${obj.size}`); h.set('Content-Length', String(r.length));
      return new Response(part.body, { status: 206, headers: h });
    }
    if (!obj.body) obj = await bucket.get(rt.key); // range header was present but ignored
    if (!obj || !obj.body) return notFound(next);
    return new Response(obj.body, { status: 200, headers: h });
  } catch {
    // Generic failure: no bucket names, no error text.
    return notFound(next);
  }
}
