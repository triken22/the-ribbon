// Plausible analytics, first-party. A small self-hosted stand-in for Plausible's script: it defines window.plausible
// (the hook js/ab.js already calls), sends one pageview per load, and posts every event to /api/event on this origin.
// The Pages Function there (functions/api/event.js) forwards it to Plausible server-side, so the CSP stays
// script-src 'self' / connect-src 'self' and no third-party code runs here. docs/ANALYTICS.md has the whole picture.
//
//   <script defer src="/js/pa.js" data-domain="theribbon.fyi"></script>   after ab.js, before any module script
//   <html data-pa-404>                                                    the 404 page: also sends a "404" event
//
// Nothing is sent from localhost, file: or a headless browser, or when localStorage.plausible_ignore is "true" (the
// owner's own visits). Every call is still recorded in window.__pa.log so QA can see what would have gone out.
// Only the page origin, path and utm_* / ref / source parameters leave the browser: never the rest of the query.

(() => {
  if (typeof window.plausible === 'function' && window.plausible.wb) return; // loaded twice
  const me = document.currentScript;
  const domain = (me && me.dataset.domain) || location.hostname;
  const endpoint = (me && me.dataset.api) || '/api/event';
  const KEEP = /^(utm_(source|medium|campaign|term|content)|ref|source)$/;

  const ignored = (() => {
    if (location.protocol === 'file:' || /^(localhost|127(\.\d+){3}|\[::1\])$/.test(location.hostname)) return 'localhost';
    if (navigator.webdriver || window._phantom || window.__nightmare || window.Cypress) return 'automation';
    try { if (localStorage.getItem('plausible_ignore') === 'true') return 'ignored'; } catch (e) { /* no storage: count them */ }
    return null;
  })();

  const pageUrl = () => {
    const u = new URL(location.href);
    const q = new URLSearchParams();
    for (const [k, v] of u.searchParams) if (KEEP.test(k)) q.append(k, v);
    const s = q.toString();
    return u.origin + u.pathname + (s ? '?' + s : '');
  };
  const referrer = () => {
    try { const r = new URL(document.referrer); return r.origin === location.origin ? null : r.origin + r.pathname; } catch (e) { return null; }
  };
  // Plausible takes flat string/number/boolean props; anything else is dropped here rather than rejected there.
  const clean = (props) => {
    const out = {};
    if (props && typeof props === 'object') {
      for (const [k, v] of Object.entries(props).slice(0, 30)) {
        if (['string', 'number', 'boolean'].includes(typeof v)) out[String(k).slice(0, 300)] = typeof v === 'string' ? v.slice(0, 2000) : v;
      }
    }
    return out;
  };

  const pa = { domain, ignored, log: [] };
  window.__pa = pa;

  function plausible(name, opts) {
    const o = opts || {};
    const event = { name: String(name), url: pageUrl(), domain, referrer: referrer(), props: clean(o.props) };
    if (o.interactive === false) event.interactive = false;
    pa.log.push({ ...event, sent: !ignored, reason: ignored });
    const done = () => { if (typeof o.callback === 'function') try { o.callback(); } catch (e) { /* caller's problem */ } };
    if (ignored) { done(); return; }
    try {
      fetch(endpoint, { method: 'POST', keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(event) })
        .then(done, done);
    } catch (e) { done(); } // analytics never breaks the page
  }
  plausible.wb = true;

  // Calls queued before this loaded, in Plausible's own queue shape (window.plausible.q).
  const queued = (window.plausible && window.plausible.q) || [];
  window.plausible = plausible;
  for (const args of queued) plausible(...args);

  plausible('pageview');
  if (document.documentElement.hasAttribute('data-pa-404')) plausible('404', { props: { path: location.pathname } });
})();
