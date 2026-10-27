// Homepage copy test. Four hero variants (A–D); production splits new visitors 50/50 between A and B.
//
//   CONFIG.enabled = false   switches the test off: everyone sees CONFIG.fallback, stored assignments are ignored
//                            (a ?v= link still previews a variant for that page view, and is never saved).
//   ?v=A|B|C|D               override: shows that variant and keeps it (source "override", so analysis can drop it)
//   no ?v                    the stored assignment (localStorage "wb_ab"), else a fair coin over CONFIG.arms
//   ?ab=qa                   shows the QA switcher for the rest of the tab's session. Visitors never see it.
//
// Only the hero line, the sub and the primary CTA label change; everything else is constant so the test isolates the
// promise. Classic script, loaded synchronously in <head>: <html data-ab> is set before first paint and a non-A hero
// stays hidden (never A-then-swapped) until its copy is in. Pages without <html data-ab-assign> (e.g. /subscribe/) only
// read the stored variant to label their events; they never assign one.
//
// Events: see track() below. They reach Plausible via js/pa.js and /api/event, same-origin: CSP stays default-src 'self'.

(() => {
  const CONFIG = { enabled: true, arms: ['A', 'B'], fallback: 'A' };
  const KEY = 'wb_ab', SRC = 'wb_ab_src', QA = 'wb_ab_qa';
  const COPY = {
    A: {
      hero: ['Stay current on tech.', 'Skip the scroll.'],
      sub: 'Sixteen pages of what mattered in AI and tech this week — free on your Kindle every Saturday.',
      cta: 'Get it free on Kindle',
    },
    B: {
      hero: ['The week on\u00a0X\u00a0—', 'without opening\u00a0X.'], // non-breaking: X stays with "on" and the dash
      sub: 'Edited bookmarks, no account, no algorithm. Free every Saturday.',
      cta: 'Get it free on Kindle',
    },
    C: {
      hero: ['What people said.', 'Not what media spun.'],
      sub: 'Primary posts from the week, cut to sixteen pages. Free on Kindle.',
      cta: 'Get it free on Kindle',
    },
    D: {
      hero: ['Sixteen pages.', 'Zero doomscroll.'],
      sub: 'One free Saturday magazine instead of another week in the feed.',
      cta: 'Send free issues to Kindle',
    },
  };
  const IDS = Object.keys(COPY);
  const valid = (v) => (typeof v === 'string' && IDS.includes(v.toUpperCase()) ? v.toUpperCase() : null);
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
  };

  const root = document.documentElement;
  const params = new URLSearchParams(location.search);
  const assigns = root.hasAttribute('data-ab-assign');
  const fromUrl = valid(params.get('v'));

  // Who sees what, and why. source: override | assigned | returning | off | nostorage | unassigned
  let variant, source;
  if (fromUrl) {
    variant = fromUrl;
    source = 'override';
    if (CONFIG.enabled) { ls.set(KEY, fromUrl); ls.set(SRC, 'override'); }
  } else if (!CONFIG.enabled) {
    variant = CONFIG.fallback; source = 'off';
  } else if (valid(ls.get(KEY))) {
    variant = valid(ls.get(KEY)); source = ls.get(SRC) === 'override' ? 'override' : 'returning';
  } else if (assigns) {
    const pick = CONFIG.arms[Math.floor(Math.random() * CONFIG.arms.length)];
    // Without storage the assignment can't stick, so those visitors see the fallback and are labelled for exclusion.
    if (ls.set(KEY, pick)) { ls.set(SRC, 'assigned'); variant = pick; source = 'assigned'; } else { variant = CONFIG.fallback; source = 'nostorage'; }
  } else {
    variant = CONFIG.fallback; source = 'unassigned';
  }

  root.dataset.ab = variant;
  if (assigns && variant !== 'A') root.dataset.abPending = '';

  // Analytics. Every event goes to the console, to window.__wbAb.events, and out as a `wb:track` DOM event, and to
  // Plausible through window.plausible, which js/pa.js defines (deferred, so it is there before DOMContentLoaded and
  // before any module script). pa.js posts to /api/event on this origin; see docs/ANALYTICS.md. PostHog
  // (window.posthog) is called too if it is ever on the page, proxied through this origin like Plausible.
  const qa = { variant, source, enabled: CONFIG.enabled, views: { A: 0, B: 0, C: 0, D: 0 }, events: [] };
  window.__wbAb = qa;
  function track(event, props) {
    const payload = { event, variant, source, path: location.pathname, ...props };
    qa.events.push(payload);
    console.info('[wb_ab]', payload);
    try { dispatchEvent(new CustomEvent('wb:track', { detail: payload })); } catch (e) { /* very old browser */ }
    try { if (typeof window.plausible === 'function') window.plausible(event, { props: { variant, source, path: payload.path, ...props } }); } catch (e) { /* analytics never breaks the page */ }
    try { if (window.posthog && typeof window.posthog.capture === 'function') window.posthog.capture(event, payload); } catch (e) { /* same */ }
    return payload;
  }
  window.wbTrack = track;

  function apply() {
    const c = COPY[variant];
    const h1 = document.querySelector('[data-ab-hero]');
    if (h1) {
      h1.replaceChildren(...c.hero.map((line, i) => {
        const s = document.createElement('span');
        s.className = 'clause';
        s.textContent = line;
        return i ? [' ', s] : [s];
      }).flat());
    }
    const sub = document.querySelector('[data-ab-sub]');
    if (sub) sub.textContent = c.sub;
    const cta = document.querySelector('[data-ab-cta]');
    if (cta) cta.textContent = c.cta;
    root.dataset.ab = variant;
    delete root.dataset.abPending;
  }

  function view() {
    qa.variant = variant;
    qa.source = source;
    qa.views[variant] += 1;
    track('variant_view');
  }

  function choose(v) {
    if (v === variant) return;
    variant = v;
    source = 'override';
    if (CONFIG.enabled) { ls.set(KEY, v); ls.set(SRC, 'override'); }
    const url = new URL(location.href);
    url.searchParams.set('v', v);
    history.replaceState(history.state, '', url);
    apply();
    view();
    paintSwitcher();
  }

  // QA switcher: ?ab=qa turns it on for this tab (sessionStorage), ?ab=off turns it off again.
  let showQa = false;
  try {
    if (params.get('ab') === 'qa') sessionStorage.setItem(QA, '1');
    if (params.get('ab') === 'off') sessionStorage.removeItem(QA);
    showQa = sessionStorage.getItem(QA) === '1';
  } catch (e) { showQa = params.get('ab') === 'qa'; }

  let ui = null;
  function buildSwitcher() {
    const wrap = document.createElement('div');
    wrap.className = 'ab';
    const panel = document.createElement('div');
    panel.className = 'ab__panel'; panel.id = 'ab-panel'; panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', 'Homepage copy variant (QA only)'); panel.inert = true;
    for (const id of IDS) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ab__opt'; b.dataset.v = id; b.textContent = id; b.setAttribute('aria-pressed', 'false');
      panel.append(b);
    }
    const toggle = document.createElement('button');
    toggle.type = 'button'; toggle.className = 'ab__toggle';
    toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', 'ab-panel');
    const tag = document.createElement('span'); tag.className = 'ab__tag'; tag.textContent = 'A/B';
    const cur = document.createElement('b'); cur.className = 'ab__cur'; cur.dataset.abCur = '';
    const sr = document.createElement('span'); sr.className = 'visually-hidden'; sr.textContent = ', change copy variant';
    toggle.append(tag, cur, sr);
    wrap.append(panel, toggle);
    document.body.append(wrap);
    root.classList.add('has-ab');

    const open = (on) => {
      wrap.toggleAttribute('data-open', on);
      toggle.setAttribute('aria-expanded', String(on));
      panel.inert = !on;
    };
    toggle.addEventListener('click', () => open(!wrap.hasAttribute('data-open')));
    panel.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (b) choose(b.dataset.v);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && wrap.hasAttribute('data-open')) { open(false); toggle.focus(); }
    });
    document.addEventListener('pointerdown', (e) => {
      if (wrap.hasAttribute('data-open') && !wrap.contains(e.target)) open(false);
    });
    ui = wrap;
    paintSwitcher();
  }

  function paintSwitcher() {
    if (!ui) return;
    ui.querySelector('[data-ab-cur]').textContent = variant;
    ui.querySelectorAll('[data-v]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === variant)));
  }

  // Any element with data-track="<event>" reports a click (the CTAs on the front page).
  function bindCtas() {
    document.addEventListener('click', (e) => {
      const a = e.target.closest && e.target.closest('[data-track]');
      if (a) track(a.dataset.track);
    });
  }

  function start() {
    bindCtas();
    if (!assigns) return;
    apply();
    if (showQa) buildSwitcher();
    view();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
