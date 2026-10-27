// /subscribe/: Kindle delivery setup, one step on screen at a time.
//
// DELIVERY decides what the last step's button does:
//   'live'  (production) POSTs { email, kindle, variant } to ENDPOINT, the email Worker (workers/email, docs/EMAIL.md).
//           It answers 202 and mails a confirm link (double opt-in); the issue goes to the Kindle only once the reader
//           confirms, so the copy on steps 4 and 5 says "check your email", never "sent".
//   'off'   the kill switch: the steps all work, a notice says nothing is sent or saved, and step 4 says so plainly
//           instead of pretending. Events still fire, so the copy test measures intent.
//   'stub'  pretends to send (900ms) and shows the done step. Local review only: ?delivery=stub, never in production.
// Locally (127.0.0.1, localhost) ?delivery=off|stub|live overrides it, so the checks can walk every mode.
// CSP needs no change: the endpoint is same-origin (a Worker route on /api/*).
//
// ?confirmed | ?stopped | ?expired are where the email Worker's links land (workers/email, docs/EMAIL.md).
// ?step=N opens a step with demo values filled in (review screenshots only).
import { init } from './data.js';

const DELIVERY = 'live';
const ENDPOINT = '/api/subscribe';
const SENDER = 'issue@theribbon.fyi'; // permanent: readers add it to Amazon's approved list, so it never changes (docs/DOMAIN.md)

const params = new URLSearchParams(location.search);
const local = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
const mode = local && ['off', 'stub', 'live'].includes(params.get('delivery')) ? params.get('delivery') : DELIVERY;

const form = document.querySelector('[data-flow]');
const steps = [...form.querySelectorAll('.step')];
const bars = [...document.querySelectorAll('.progress li')];
const count = document.querySelector('[data-count]');
const back = document.querySelector('[data-back]');
const backLabel = document.querySelector('[data-back-label]');
const email = form.querySelector('#email');
const kindle = form.querySelector('#kindle');
const send = form.querySelector('[data-send]');
const sendError = form.querySelector('#send-error');
const LAST = 4;
let current = 1;
let issueName = ''; // "Issue 3" once the manifest is in
let latest = 0;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const KINDLE = /^[a-z0-9._-]+$/i;
const track = (event, props) => { if (typeof window.wbTrack === 'function') window.wbTrack(event, props); };

{ // a phone breaks the address after the @, never mid-word (the <wbr> adds no text, so Copy still copies it whole)
  const at = SENDER.indexOf('@') + 1;
  form.querySelector('[data-sender]').replaceChildren(SENDER.slice(0, at), document.createElement('wbr'), SENDER.slice(at));
}
if (mode === 'off') document.querySelector('[data-notice]').hidden = false;

function kindleName() {
  return kindle.value.trim().replace(/@kindle\.com$/i, '');
}

function show(n, { focus = true } = {}) {
  current = n;
  for (const step of steps) {
    const on = Number(step.dataset.step) === n;
    step.hidden = !on;
    step.classList.toggle('is-entering', on && focus);
  }
  bars.forEach((bar, i) => {
    bar.classList.toggle('is-done', i + 1 < n);
    bar.classList.toggle('is-current', i + 1 === n);
  });
  count.textContent = n > LAST ? 'Done' : `Step ${n} of ${LAST}`;
  backLabel.textContent = n === 1 || n > LAST ? issueName || 'Front page' : 'Back';
  form.querySelector('[data-kindle-full]').textContent = kindleName() ? `${kindleName()}@kindle.com` : 'your Kindle';
  if (focus) form.querySelector(`[data-step="${n}"] h1`).focus();
  if (n > LAST) track('subscribe_done');
  else if (focus) track('subscribe_step', { step: n });
}

function check(input, ok) {
  const error = document.getElementById(input.getAttribute('aria-describedby'));
  const wrap = input.closest('.input');
  error.hidden = ok;
  input.setAttribute('aria-invalid', String(!ok));
  wrap.toggleAttribute('data-invalid', !ok);
  if (!ok) input.focus();
  return ok;
}

async function deliver() {
  if (mode === 'stub') { await new Promise((r) => setTimeout(r, 900)); return; }
  if (mode !== 'live') throw Object.assign(new Error('off'), { off: true });
  let variant = 'A';
  try { variant = localStorage.getItem('wb_ab') || 'A'; } catch (e) { /* private mode */ }
  const r = await fetch(ENDPOINT, {
    method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.value.trim(), kindle: `${kindleName()}@kindle.com`, variant }),
  });
  if (!r.ok) throw Object.assign(new Error(String(r.status)), { status: r.status });
}

function sendFailed(off, status) {
  sendError.replaceChildren();
  if (off) {
    sendError.append('Kindle delivery isn’t switched on yet, so nothing was sent or saved. ');
    if (latest) {
      const a = document.createElement('a');
      a.href = `/read/?n=${latest}`;
      a.textContent = `Read ${issueName} online`;
      sendError.append(a, ' meanwhile.');
    }
  } else if (status === 429) {
    sendError.textContent = 'Too many tries from here. Wait a minute, then try again.';
  } else if (status === 422) {
    sendError.textContent = 'Those addresses didn’t look right. Go back and check them, then try again.';
  } else {
    sendError.textContent = 'That didn’t send. Check your connection, then try again.';
  }
  sendError.hidden = false;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (current === 1 && !check(email, EMAIL.test(email.value.trim()))) return;
  if (current === 2 && !check(kindle, KINDLE.test(kindleName()))) return;
  if (current === 4) {
    if (send.disabled) return;
    sendError.hidden = true;
    send.disabled = true;
    send.textContent = 'Sending…';
    track('subscribe_send');
    try {
      await deliver();
      show(5);
    } catch (e) {
      if (e.off) track('subscribe_blocked', { reason: 'delivery_off' });
      sendFailed(!!e.off, e.status);
    } finally {
      send.disabled = false;
      send.textContent = SEND_LABEL;
    }
    return;
  }
  show(current + 1);
});

for (const input of [email, kindle]) {
  input.addEventListener('input', () => {
    if (input.getAttribute('aria-invalid') === 'true') {
      const ok = input === email ? EMAIL.test(email.value.trim()) : KINDLE.test(kindleName());
      if (ok) check(input, true);
    }
  });
}

back.addEventListener('click', (event) => {
  if (current > 1 && current <= LAST) {
    event.preventDefault();
    show(current - 1);
  }
});

const copy = form.querySelector('[data-copy]');
let copyTimer = 0;
copy.addEventListener('click', async () => {
  const address = form.querySelector('[data-sender]').textContent;
  try {
    await navigator.clipboard.writeText(address);
    copy.textContent = 'Copied';
  } catch {
    copy.textContent = 'Select it';
  }
  clearTimeout(copyTimer);
  copyTimer = setTimeout(() => { copy.textContent = 'Copy'; }, 1600);
});

// With double opt-in (live), the issue goes to the Kindle only once the reader confirms from their inbox.
if (mode === 'live') {
  form.querySelector('#s4').textContent = 'Confirm by email';
  form.querySelector('[data-send-text]').replaceChildren('We’ll email you a link. Confirm it and ', form.querySelector('[data-issue-name]'),
    ' goes to ', form.querySelector('[data-kindle-full]'), ', usually within a few minutes.');
  send.textContent = 'Email me the link';
  form.querySelector('[data-done-title]').textContent = 'Almost there. Check your email.';
  form.querySelector('[data-done-text]').textContent = 'Confirm from the link we just sent; the latest issue goes to your Kindle straight after.';
}

const SEND_LABEL = send.textContent; // restored after each try

// The email links' landing states. They replace the steps; the page's back link goes to the front page.
const OUTCOMES = {
  confirmed: ['You’re in. Check your Kindle.', 'The latest issue is on its way. After that, a new one arrives every Saturday.', 'Back to the front page', '/', true],
  stopped: ['Delivery stopped.', 'Nothing more will be sent to your Kindle. Every issue stays free to read in the library.', 'Go to the library', '/library/', false],
  expired: ['That link has run out.', 'Confirmation links don’t last forever. Start again and we’ll send a fresh one.', 'Start again', '/subscribe/', false],
};
const outcome = Object.keys(OUTCOMES).find((k) => params.has(k));
if (outcome) {
  const [title, text, action, href, mark] = OUTCOMES[outcome];
  const box = document.querySelector('[data-outcome]');
  box.querySelector('h1').textContent = title;
  box.querySelector('[data-outcome-text]').textContent = text;
  const a = box.querySelector('[data-outcome-action]');
  a.textContent = action; a.href = href;
  box.querySelector('.done-mark').hidden = !mark;
  form.hidden = true;
  document.querySelector('.progress').hidden = true;
  document.querySelector('[data-count]').textContent = '';
  document.querySelector('[data-notice]').hidden = true;
  box.hidden = false;
  track(`subscribe_${outcome}`);
}

const demo = Number(params.get('step'));
if (demo >= 2 && demo <= 5) {
  email.value = 'reader@example.com';
  kindle.value = 'reader_2841';
  show(demo, { focus: false });
}

// Name the latest issue where the copy refers to it. Without the manifest the generic words stay.
const c = await init();
if (c.issues.length) {
  latest = c.issues[0].issue;
  issueName = `Issue ${latest}`;
  form.querySelector('[data-issue-name]').textContent = issueName;
  const home = form.querySelector('[data-home-link]');
  home.textContent = `Back to ${issueName}`;
  if (current === 1 || current > LAST) backLabel.textContent = issueName;
}
