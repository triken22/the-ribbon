// Renders the default share card and the apple-touch icon from default.html with Chromium (playwright-core).
// Usage: PW_DIR=/path/with/node_modules node site/scripts/og/render_og.mjs   (CHROME_PATH if Playwright's browser is missing)
// Writes site/public/og/default.png (1200x630) and site/public/apple-touch-icon.png (180x180). Re-run after a brand change.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const require = createRequire((process.env.PW_DIR || process.cwd()) + '/');
const { chromium } = require('playwright-core');
const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, '..', '..', 'public');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const pg = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
// fonts.css points at /fonts/..., which under file:// is the filesystem root: serve those from public/fonts.
await pg.route(/\/fonts\/[^/]+\.woff2$/, (r) => r.fulfill({ path: path.join(pub, 'fonts', path.basename(new URL(r.request().url()).pathname)), contentType: 'font/woff2' }));
await pg.goto(pathToFileURL(path.join(here, 'default.html')).href);
await pg.evaluate(() => document.fonts.ready);
const faces = await pg.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family));
if (!faces.some((f) => f.includes('Instrument Serif')) || !faces.some((f) => f.includes('Schibsted'))) throw new Error('web fonts did not load: ' + faces);
fs.mkdirSync(path.join(pub, 'og'), { recursive: true });
await pg.locator('#og').screenshot({ path: path.join(pub, 'og', 'default.png') });
await pg.locator('#icon').screenshot({ path: path.join(pub, 'apple-touch-icon.png') });
await browser.close();
console.log('wrote og/default.png, apple-touch-icon.png');
