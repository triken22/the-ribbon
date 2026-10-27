import { init, el } from './data.js';

export { icon } from './data.js';
export const ICON = {
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14', book: 'M3 5h7a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H3zM21 5h-7a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h7z',
  out: 'M14 5h5v5M19 5l-8 8M17 14v5H5V7h5', back: 'M15 5l-7 7 7 7',
};

// Keyboard-initiated actions never animate: they repeat too often for motion to feel like anything but delay.
// The last input type is kept on <html> for CSS (press feedback) and used to skip the page crossfade on keyboard navigation.
const root = document.documentElement;
const input = (v) => { if (root.dataset.input !== v) root.dataset.input = v; }; // write only on change: no restyle per mouse move
addEventListener('keydown', (e) => { if (!e.metaKey && !e.ctrlKey && !e.altKey) input('key'); }, true);
addEventListener('pointerdown', () => input('pointer'), true);
addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') input('pointer'); }, { capture: true, passive: true });
addEventListener('pageswap', (e) => { if (root.dataset.input === 'key' && e.viewTransition) e.viewTransition.skipTransition(); });

/** Loads the issue list and fills the footer. The skip link and masthead are static HTML on every page, so they paint first. */
export async function chrome() {
  const c = await init();
  footer(c);
  return c;
}

function footer(c) {
  const foot = document.getElementById('foot');
  if (foot) {
    foot.className = 'foot wrap';
    const n = c.issues.length; // no count when the list failed to load or is empty: "0 issues" would contradict the page
    const f = el('div', 'in'); f.append(el('span', 't', 'The Ribbon'),
      el('span', 'm', !c.failed && n ? `${n} ${n === 1 ? 'issue' : 'issues'} so far · new issue every Saturday` : 'New issue every Saturday'));
    foot.replaceChildren(f);
  }
}
