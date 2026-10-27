---
name: The Ribbon
description: A free Saturday magazine of the week in tech, delivered to Kindle. The front door makes one promise on an ochre ground; the reading rooms behind it are paper and ink.
colors:
  # Front door (/ and /subscribe/), css/front.css. Authored in oklch; hex is the sRGB rendering.
  ochre: "#F0D6A3"
  ochre-sunk: "#EACB93"
  ink-warm: "#24180F"
  ink-warm-soft: "#584331"
  field-edge: "#85705C"
  paper-warm: "#FAF6EE"
  paper-warm-soft: "#CEC2AF"
  sheet: "#F6F3EC"
  ribbon: "#C92F36"
  ribbon-on-ink: "#E86059"
  alert: "#9B1F1B"
  device: "#1D2022"
  device-edge: "#3A3D41"
  eink: "#E8E8E5"
  # Reading register (library, issue, reader), css/site.css
  red: "#C1121F"
  blue: "#2F5D8A"
  ink: "#1A1A1A"
  ink2: "#3A3835"
  mute: "#5F5C57"
  line: "#B9B5AC"
  rule: "#D8D5CE"
  panel: "#E8ECEF"
  paper: "#F7F4EC"
  card: "#FBF9F4"
  tone: "#E7E2D5"
typography:
  front-display:
    fontFamily: "'Instrument Serif', 'Instrument Serif Fallback', Georgia, serif"
    fontSize: "clamp(2.5rem, 1.9rem + 2vw, 3.75rem)"
    fontWeight: 400
    lineHeight: 1.04
    letterSpacing: "-0.012em"
  front-display-m:
    fontFamily: "'Instrument Serif', 'Instrument Serif Fallback', Georgia, serif"
    fontSize: "clamp(2.125rem, 1.7rem + 1.6vw, 3.25rem)"
    fontWeight: 400
    lineHeight: 1.04
  front-display-s:
    fontFamily: "'Instrument Serif', 'Instrument Serif Fallback', Georgia, serif"
    fontSize: "clamp(2rem, 1.7rem + 1.2vw, 2.625rem)"
    fontWeight: 400
    lineHeight: 1.04
  front-wordmark:
    fontFamily: "'Instrument Serif', 'Instrument Serif Fallback', Georgia, serif"
    fontSize: "1.375rem"
    fontWeight: 400
    lineHeight: 1
  front-body:
    fontFamily: "'Schibsted Grotesk', 'Schibsted Grotesk Fallback', Arial, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.55
  front-sub-desktop:
    fontFamily: "'Schibsted Grotesk', 'Schibsted Grotesk Fallback', Arial, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 400
    lineHeight: 1.4
  front-small:
    fontFamily: "'Schibsted Grotesk', 'Schibsted Grotesk Fallback', Arial, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 500
    lineHeight: 1.3
  front-cta:
    fontFamily: "'Schibsted Grotesk', 'Schibsted Grotesk Fallback', Arial, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 600
    lineHeight: 1
  nameplate:
    fontFamily: "Newsreader, 'Newsreader Fallback', Georgia, 'Times New Roman', serif"
    fontSize: "60px"
    fontWeight: 800
    lineHeight: 0.92
    letterSpacing: "-0.025em"
  display:
    fontFamily: "Newsreader, 'Newsreader Fallback', Georgia, 'Times New Roman', serif"
    fontSize: "clamp(38px, 1.5rem + 4.4vw, 88px)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.025em"
  page-title:
    fontFamily: "Newsreader, 'Newsreader Fallback', Georgia, 'Times New Roman', serif"
    fontSize: "clamp(36px, 1.2rem + 2.6vw, 60px)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Newsreader, 'Newsreader Fallback', Georgia, 'Times New Roman', serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Newsreader, 'Newsreader Fallback', Georgia, 'Times New Roman', serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.005em"
  deck:
    fontFamily: "Newsreader, 'Newsreader Fallback', Georgia, 'Times New Roman', serif"
    fontSize: "clamp(21px, 1rem + 0.9vw, 27px)"
    fontWeight: 400
    lineHeight: 1.3
  body:
    fontFamily: "Newsreader, 'Newsreader Fallback', Georgia, 'Times New Roman', serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.6
  dateline:
    fontFamily: "'IBM Plex Sans Condensed', 'IBM Plex Sans Condensed Fallback', 'Arial Narrow', sans-serif"
    fontSize: "15px"
    fontWeight: 500
    lineHeight: 1.4
    fontFeature: "\"tnum\" 1, \"lnum\" 1"
  meta:
    fontFamily: "'IBM Plex Sans Condensed', 'IBM Plex Sans Condensed Fallback', 'Arial Narrow', sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.4
    fontFeature: "\"tnum\" 1, \"lnum\" 1"
  note:
    fontFamily: "Newsreader, 'Newsreader Fallback', Georgia, 'Times New Roman', serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.5
  link:
    fontFamily: "'IBM Plex Sans Condensed', 'IBM Plex Sans Condensed Fallback', 'Arial Narrow', sans-serif"
    fontSize: "16px"
    fontWeight: 600
    letterSpacing: "0.01em"
  button:
    fontFamily: "'IBM Plex Sans Condensed', 'IBM Plex Sans Condensed Fallback', 'Arial Narrow', sans-serif"
    fontSize: "13px"
    fontWeight: 600
    letterSpacing: "0.12em"
  label:
    fontFamily: "'IBM Plex Sans Condensed', 'IBM Plex Sans Condensed Fallback', 'Arial Narrow', sans-serif"
    fontSize: "12px"
    fontWeight: 600
    letterSpacing: "0.13em"
  data:
    fontFamily: "'IBM Plex Mono', ui-monospace, Menlo, monospace"
    fontSize: "11.5px"
    fontWeight: 400
    letterSpacing: "0"
rounded:
  none: "0px"
  paper: "2px"
  field: "14px"
  device: "26px"
  pill: "999px"
spacing:
  front-space-1: "0.25rem"
  front-space-2: "0.5rem"
  front-space-3: "0.75rem"
  front-space-4: "1rem"
  front-space-5: "1.5rem"
  front-space-6: "2rem"
  front-space-7: "3rem"
  front-space-8: "4rem"
  front-space-9: "6rem"
  front-space-10: "9rem"
  front-gutter: "clamp(1.25rem, 4vw, 3rem)"
  front-hero-top: "clamp(1.5rem, 4svh, 3rem) on phones; clamp(4rem, 12svh, 6rem) from 64rem"
  page-margin: "40px"
  page-margin-narrow: "20px"
  gutter: "clamp(40px, 5vw, 72px)"
  section-gap: "clamp(64px, 8vw, 104px)"
  stack: "28px"
  row: "18px"
components:
  front-pill:
    backgroundColor: "{colors.ink-warm}"
    textColor: "{colors.paper-warm}"
    typography: "{typography.front-cta}"
    rounded: "{rounded.pill}"
    padding: "0 2rem"
    height: "3.5rem"
  front-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-warm}"
    typography: "{typography.front-body}"
    rounded: "{rounded.pill}"
    padding: "0 1.5rem"
    height: "3rem"
  front-ghost-hover:
    backgroundColor: "{colors.ink-warm}"
    textColor: "{colors.paper-warm}"
  front-turn-button:
    backgroundColor: "transparent"
    textColor: "{colors.ink-warm}"
    rounded: "{rounded.pill}"
    size: "44px"
  front-input:
    backgroundColor: "{colors.paper-warm}"
    textColor: "{colors.ink-warm}"
    rounded: "{rounded.field}"
    height: "3.25rem"
  front-chip:
    backgroundColor: "{colors.ochre}"
    textColor: "{colors.ink-warm}"
    rounded: "{rounded.pill}"
    height: "44px"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.button}"
    rounded: "{rounded.none}"
    padding: "0 22px"
    height: "50px"
  button-primary-hover:
    backgroundColor: "{colors.red}"
    textColor: "{colors.paper}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.none}"
    padding: "0 22px"
    height: "50px"
  button-ghost-hover:
    backgroundColor: "transparent"
    textColor: "{colors.red}"
  text-link:
    textColor: "{colors.ink}"
    typography: "{typography.link}"
    height: "44px"
  text-link-hover:
    textColor: "{colors.red}"
  nav-link:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    padding: "12px 0"
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0 12px"
    height: "36px"
  chip-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  input-search:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "8px 28px 8px 0"
    height: "44px"
  dateline:
    textColor: "{colors.ink2}"
    typography: "{typography.dateline}"
    padding: "11px 0"
  archive-entry:
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    padding: "18px 0"
  archive-entry-hover:
    textColor: "{colors.red}"
  contents-entry:
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    padding: "14px 0"
  contents-entry-hover:
    textColor: "{colors.red}"
  library-card-title:
    textColor: "{colors.ink}"
    typography: "{typography.title}"
  source-chip:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0 8px"
    height: "28px"
  source-chip-hover:
    textColor: "{colors.red}"
---
<!-- The front-door section below records the system approved as out/kindle-homepage-v5 (v4 copy and A/B, v5 hero spacing),
     ported to production in October 2026. The reading-register sections after it are unchanged from the whole-site redesign. -->

# Design System: The Ribbon

## Two registers, one publication

The site has two jobs and one look for each, on purpose (Impeccable modes).

| Register | Pages | Job | System |
|---|---|---|---|
| **Front door** (Persuade) | `/`, `/subscribe/` | Make one promise and get one action: free on your Kindle, every Saturday. | Ochre ground, Instrument Serif + Schibsted Grotesk, pill actions, the issue as a turnable book. `css/front.css`. |
| **Reading register** (Read) | `/library/`, `/issue/`, `/read/`, 404 | Find and read issues. | Paper and ink, Newsreader + IBM Plex Sans Condensed, ruled lines, square buttons. `css/site.css`. Described from "Reading register" below. |

They share the ink-and-ribbon mark, the motion curves and durations, self-hosted faces and the CSP. Moving from the front
door into the library is moving from the magazine's cover into its pages. If the owner wants one look everywhere, port
the reading register's tokens to the front-door palette later; the components already map one to one (square button to
pill, dateline band to issue line).

## Front door: the method (Fable)

**Vision bar.** A stranger on a phone understands the promise, sees a real issue and can act on it without scrolling: hero,
sub, issue line, the cover, the pager, the CTA and "Free." all sit above the fold at 390×844 in every copy variant (tested
in `ui_check.mjs`: the free line ends at 812px in A, 787px in B–D). The issue is the proof: the cover is the week's real
cover from `manifest.json`, and it turns to every real page from `meta.json`.

**Hard floors.**
- One ochre ground, ink for everything that works, the red ribbon only in the wordmark mark. No second accent.
- Instrument Serif at 400 only, for the promise (hero, h2, the close, the wordmark). Schibsted Grotesk for everything that
  works. No monospace and no third face.
- One primary action per screen (the pill). Secondary actions are a ghost pill or an underlined text link. Nothing else is
  a button.
- Every first-viewport slot (issue line, read links, pager, cover) is reserved in HTML, so data arriving never moves
  anything: CLS under 0.01 with late manifest, meta, images and fonts. The fallback faces are metric-matched (`fonts.css`).
- 44px hit areas, visible focus rings in ink (paper on ink), contrast at least 4.5:1 for text (ink on ochre 12.3:1,
  secondary ink 6.6:1, error red 5.7:1).
- CSP `default-src 'self'`: no inline scripts or styles, no third-party hosts.

**Banlist.** Process essays or the dense register above the fold (they live in the footer line and the library). Kickers
or eyebrows above headings. Card grids. Stats, testimonials or subscriber counts we don't have. Gradient text. Emoji or
glyph icons (icons are authored 1.5px-stroke SVG). Selling future customisation. A modal anywhere in the flow.

## Front door: tokens

All in `css/front.css` `:root`, authored in oklch (hex in the front matter).

| Group | Tokens |
|---|---|
| Colour | `--issue` ochre ground · `--issue-sunk` hover ground · `--ink` · `--ink-soft` secondary text · `--line` / `--line-strong` hairlines (ink at 20% / 42%) · `--field-edge` input border · `--paper` field and footer text · `--paper-soft` footer secondary · `--sheet` page paper · `--ribbon` / `--ribbon-on-ink` the mark · `--alert` errors · `--device` / `--device-edge` / `--eink` the Kindle |
| Type | `--font-display` Instrument Serif · `--font-ui` Schibsted Grotesk · `--text-xs/s/m/l` 13/15/17/19px · `--display-s/m/l` fluid clamps (32–42, 34–52, 40–60px) · line-height 1.04 display, 1.55 body |
| Space | `--space-1…10` on a 4px base (4, 8, 12, 16, 24, 32, 48, 64, 96, 144px) · `--gutter` `clamp(1.25rem, 4vw, 3rem)` · `--bar-h` 56px / 72px · `--hero-top` header-to-hero interval, the widest in the first viewport: `clamp(24px, 4svh, 48px)` on phones, `clamp(64px, 12svh, 96px)` from 64rem |
| Shape | `--radius-paper` 2px (pages) · `--radius-field` 14px (inputs, the sender box) · `--radius-device` 26px (the Kindle) · `--radius-pill` (actions, chips) |
| Depth | `--shadow-paper` under the book (soft, negative spread) · `--shadow-device` under the Kindle · `--shadow-pill` under the primary action · `--ring` focus-within on fields |
| Motion | `--ease-out` `cubic-bezier(0.23, 1, 0.32, 1)` · `--ease-in-out` `cubic-bezier(0.77, 0, 0.175, 1)` · `--dur-micro` 160ms · `--dur-step` 260ms · `--dur-refresh` 720ms |

The ochre was taken from Issue 3's cover and is now the brand's Saturday colour, fixed rather than recomputed per issue
(a per-issue ground would need a colour in `meta.json`; deriving it in the browser would flash).

## Front door: layout

- **Phone:** one centred column: hero (two block clauses, problem then relief), sub (max 32ch), issue line as the cover's
  caption, the book, the pager, the pill (max 20rem), "Free. Stop delivery any time.", then "Read online · PDF".
- **Desktop (64rem+):** three columns on one baseline: the problem right-aligned on the left (h1 max 10ch, issue line under
  it), the book in the middle, the relief on the right (sub max 22ch, pill, free line, links). The pager sits under the book.
- **Book size** follows the fold so the actions never drop below it: phones `min(72vw, 19.5rem, max(13rem, (100svh − bar −
  hero-top − 26rem) × page ratio))`; desktop height `min(100svh − bar − hero-top − 7.25rem, 44rem)`. The `sizes` hint in
  `js/front.js` mirrors this so a 1× screen loads the 400px thumbnail.
- **Kindle beat:** h2 "Leave the feed. Keep the *signal*." (the one italic word, as in the mock), one line, the Kindle on its
  side showing the issue's last page on e-ink (greyscale, top of the page, full width), then "Set it up" (ghost pill).
- **Footer** on ink: "See you Saturday." in display type, then the process line with "Every issue", and the quiet
  "Free to read. Enjoying it? Buy me a coffee" text link.

## Front door: components

- **Pill (primary):** ink, paper text, 56px tall, 600 weight, arrow icon. Hover (fine pointers only) lifts 1px and the arrow
  moves 2px; press scales to 0.97. Disabled: `--ink-soft`, progress cursor.
- **Ghost pill (secondary):** 1.5px ink border, inverts to ink on hover.
- **Text links:** underlined at 0.35em offset in `--line-strong`, full ink on hover; 44px tall and at least 44px wide.
- **The book:** the latest issue's pages stacked, hinged on the spine. A blank sheet holds the cover's place until
  `manifest.json` answers, then the cover (eager, `fetchpriority=high`), then pages 2–N from `meta.json` (lazy, low priority,
  srcset 400w thumb + 1200w page). The back cover is ink with "That's Issue N.", "Read it full size" and "Back to the cover".
  A missing page image leaves a numbered sheet. No issues, or a failed list, puts one sentence (and Try again) on the sheet.
- **Caption (no buttons):** one quiet line under the book: empty on the closed cover until the issue has been opened,
  then the section from `meta.json` and "4–5 / N" (phones name the right-hand page only). `aria-live` announces each change.
- **Fields:** 52px, `--radius-field`, paper fill, ink ring on focus, `--alert` border and message on error. The Kindle field
  carries an "@kindle.com" suffix.
- **Flow chrome (/subscribe/):** back link, "Step n of 4", a four-segment progress bar; one step on screen at a time.
- **Notice:** a hairline-bordered note above the steps while delivery is off. It states the fact; no icon, no colour.
- **QA switcher:** a dashed "A/B" chip, only with `?ab=qa`. It looks like tooling on purpose.

## Front door: motion

One authored moment per beat, each a page arriving:
- **Book (a magazine on the table):** closed on its cover, then open spreads 2|3 … N|back cover. Phones show the recto whole
  and the verso's edge (the spread hangs off the left of the screen); 40rem+ the full spread; the three-column hero from 80rem.
- **Page curl:** grab a page or its corner and the corner follows the finger; the fold is the perpendicular bisector of the
  corner's rest point and the finger, drawn with `clip-path` and a reflection `matrix()` (the page's back on the flap), with a
  cast shadow and a curl sheen. Release past a third or with a flick (> 0.11 px/ms) completes, carrying the release speed
  (260–560ms, `--ease-out`); otherwise it lies back. Taps turn on `--ease-in-out` (640ms). Catchable mid-flight.
  The open/close slide of the spread runs 560ms on `--ease-drawer`.
- **Invite:** no instructional copy. While untouched, the cover's bottom corner lifts and settles (1.4s after it's seen, up to
  three times, 7s apart); a fine pointer near any outer corner peels it. Never under reduced motion.
- **E-ink refresh:** one invert-and-settle flash (720ms) when the Kindle scrolls into view.
- **Step change:** 260ms fade with 12px travel from the right.
- **Micro:** 160ms press and hover; closing is faster than opening (the QA switcher closes in 120ms).
- **Reduced motion:** nothing travels: page turns fade through to the next spread (90ms out, 160ms in), steps fade, and press scales and transform transitions
  are off. Keyboard-initiated changes are instant everywhere (`html[data-input=key]`).

---

# Reading register: library, issue, reader

<!-- Qualitative language below (Creative North Star, colour names, overview voice) was inferred in a non-interactive run and is unconfirmed by the owner. -->

## Overview

**Creative North Star: "The Saturday Register"**

The site is the printed magazine's own register: a front page where the newest issue leads, a library that lists the rest, and a reader that turns the pages. It is set like a publication, not assembled like an app. Book paper ground, one ink, one red. Structure comes from ruled lines of graded weight and from one strict two-column grid, never from boxes, tints or shadows. The covers are the only pictures and the only objects that lift off the page.

Two typefaces do the talking. Newsreader carries the nameplate, every title, the italic cover lines and the reading text. IBM Plex Sans Condensed runs the machinery: navigation, buttons, datelines, links and every fact in a row, always with tabular figures. IBM Plex Mono is held back for literal machine strings such as file names and @handles. Density is calm: large type, generous section gaps, short lists, nothing competing with the cover.

The register's front page (23 October 2026, since replaced by the front door above) set its cleanest expression: the lead on the two-column register grid, one dateline band, square ink buttons that carry their file sizes, underlined text links, and a ruled list of earlier issues opened by the page's single heavy rule. The whole-site pass that followed brought every page onto it: the issue page opens with the same lead, the library and the issue contents sit on the same grid, the reader's chrome speaks the same two voices, and the older devices (label kickers above headings, a red tab section marker, a monospace utility strip, glyph arrows, gradient cover swatches) are gone. New surfaces follow the same components.

**Key Characteristics:**
- Book paper ground, press ink, and one red that marks state and place.
- Rules of graded weight do the work that boxes and cards do elsewhere.
- One two-column grid holds the lead and every list row, so titles align down the page.
- Newsreader speaks; Plex Sans Condensed operates, with tabular lining figures for every fact.
- Square corners everywhere; a soft paper lift only under covers and page images.
- Self-hosted faces only; nothing loads from a third-party host.

## Colors

A warm uncoated-paper neutral family in two inks, with one saturated cover red and one quiet annotation blue.

### Primary
- **Cover Red** (#C1121F): the single accent, the same red as the printed cover's nameplate block. It marks where you are and what responds: the current nav item's 2px underline, hover and press on links, titles and archive entries, the primary button's hover fill, the 2px focus outline, text selection, the caret, form accent colour, the reader's progress bar and current thumbnail. Red at rest appears only in the cover art and in the contents' page numerals (issue page and reader), where the printed issue sets them in red too. 5.66:1 on paper.

### Secondary
- **Index Blue** (#2F5D8A): annotation only. It names a section in the issue contents (in the narrow column, beside its stories) and under each headline in the reader's contents, and it marks the page of a found match in a library search hit. It is never a link, button or heading colour, and never a label above a headline.

### Neutral
- **Press Ink** (#1A1A1A): all headings, body text, primary button fill, the masthead and footer rules, section-opening rules. 15.8:1 on paper.
- **Soft Ink** (#3A3835): secondary text that still has to read well: the tagline, italic cover lines (decks), datelines, archive meta, the colophon paragraph.
- **Pencil Grey** (#5F5C57): quiet notes and loading text, footer meta, the middle-dot separators in a dateline. 6.06:1 on paper; the lightest colour allowed for text.
- **Stone Line** (#B9B5AC): chip borders, source-chip borders, the resting underline of text links, the scrollbar thumb. Never text.
- **Hairline Grey** (#D8D5CE): the 1px hairlines between list rows, under the dateline band, under the breadcrumb bar. Never text.
- **Index Panel** (#E8ECEF): the cool tint behind a library search hit, paired only with Index Blue.
- **Book Paper** (#F7F4EC): the ground of every page and the browser theme colour. Everything sits directly on it.
- **Proof Sheet** (#FBF9F4): a hair lighter than the ground: source chips and their hover cards, and the paper behind page images in the page grid and the reader.
- **Cover Tone** (#E7E2D5): the slightly darker paper a cover or page image sits on while it loads, and what shows if it fails. A background only; never text or rules.

The page reader scopes its own deeper ground (#E9E5DA, the desk the pages lie on) and a dark mode (#121212 ground, #1B1B1B chrome, #ECE8DE text) through local variables; those stay inside the reader and are not a palette for other surfaces. The reader's chrome is Book Paper, so the browser theme colour stays #F7F4EC (#1B1B1B in its dark mode).

### Named Rules
**The One Red Rule.** Red means "here" or "now": current location, hover, focus, selection, progress. Headings, rules and body text never take it at rest, and it fills an area only as a button's hover state.

**The Paper Ground Rule.** Pages sit on Book Paper with no section tints or banded backgrounds. Proof Sheet is the only raised paper, and only for source chips and cards and the paper behind page images.

## Typography

**Display Font:** Newsreader (with Georgia, 'Times New Roman', serif), self-hosted variable, 400–800 upright and 400–600 italic
**Body Font:** Newsreader (same stack)
**Label Font:** IBM Plex Sans Condensed (with 'Arial Narrow', sans-serif), 400 / 500 / 600 / 700
**Data Font:** IBM Plex Mono (with ui-monospace, Menlo, monospace), 400 / 600, for literal machine strings only

**Character:** A newspaper's serif with real weight at the top and a calm text cut below, set against a narrow, engineered sans that keeps labels and numbers compact and orderly. The serif carries meaning; the condensed sans carries operation.

**Fallback faces:** while the web fonts load, `Newsreader Fallback` (Georgia, Georgia Bold, Georgia Italic) and `IBM Plex Sans Condensed Fallback` (Arial Narrow, Arial Narrow Bold) are drawn with `size-adjust`, `ascent-override` and `descent-override` measured against the self-hosted faces, so the swap moves nothing (`fonts.css`). They sit second in `--serif` and `--cond` and are never chosen as a design face.

### Hierarchy
- **Nameplate** (800, 60px, 0.92, -0.025em): the masthead title, the page's h1 on the front page. 40px at 900px and below; a compact 38px (30px narrow) on library and issue pages; 22px in the footer.
- **Display** (700, clamp(38px, 1.5rem + 4.4vw, 88px), 1, -0.025em, balanced wrap): the lead issue's title on the front page and the issue page (its h1 there).
- **Page title** (700, clamp(36px, 1.2rem + 2.6vw, 60px), 1, -0.025em): the library's "Every issue so far", and the heading of every empty, error and not-found state.
- **Headline** (700, 30px, 1.15, -0.01em): section heads such as "Earlier issues", "Contents", "Pages", "Print at home", and the reader's panel and sheet titles (26px in sheets). 28px at 720px and below.
- **Title** (600, 22px, 1.25, -0.005em): issue titles in the archive list and the library list view; contents headlines at 400, 21px (19px on phones). 21px on phones. Library cover cards set their titles at 700, 24px, 1.1 (20px on phones).
- **Deck** (italic 400, clamp(21px, 1rem + 0.9vw, 27px), 1.3, Soft Ink, max 30ch): the cover line under the lead title; the issue page deck uses the same voice at 25px.
- **Body** (400, 18px, 1.6, Soft Ink, max 65ch): reading paragraphs. Short interface text inherits the page default of 18px at 1.4; notes run 17px at 1.5 in Pencil Grey.
- **Dateline** (Plex Sans Condensed 500, 15px, 1.4, tabular lining figures, Soft Ink): issue number, date, page count, joined by a Pencil Grey middle dot with 0.55em either side. The same facts run 14px in library cards and list rows (**Meta**), and 13-15px in the reader's chrome. Footer meta is condensed 14px with tabular figures in Pencil Grey.
- **Note** (Newsreader 400, 17px, 1.5, Pencil Grey): loading lines ("Loading the latest issue…") and short asides.
- **Link** (Plex Sans Condensed 600, 16px, 0.01em): standalone text links such as "Read online", "Contents", "All issues in the library".
- **Button** (Plex Sans Condensed 600, 13px, 0.12em, uppercase): button labels. The file size inside a PDF button drops to 500 weight, 0.04em, tabular, at 75% opacity.
- **Label** (Plex Sans Condensed 600, 12px, 0.13em, uppercase): navigation (set at 13px in the masthead), segmented-control cells, and the library's form legends and field label. Never above a heading.
- **Data** (Plex Mono 400, 11.5-12.5px, normal tracking): a PDF file name in the issue page's print block and the reader's download rows, an @handle in a source chip or source card.

### Named Rules
**The Two Voices Rule.** Newsreader speaks (nameplate, titles, decks, reading); Plex Sans Condensed operates (nav, buttons, datelines, links, meta). A third voice appears only as data.

**The Tabular Facts Rule.** Every number that sits in a row or a button (issue numbers, dates, page counts, file sizes, issue totals) is Plex Sans Condensed with tabular lining figures, so columns of facts line up.

**The Real Data Mono Rule.** IBM Plex Mono is legitimate only for literal machine strings: a file name, an @handle, a SHA or build hash. Dates, counts, page numbers, breadcrumbs, captions, status strips and labels are never monospace; the front page uses none.

## Layout

Content sits in a centred column up to 1320px wide with a 40px page margin (20px at 900px and below). Nothing sits above any masthead: every page opens at the page margin with the same static masthead (compact on the library, issue and 404 pages), so it paints before data loads.

The reading register runs on one two-column grid: a narrow column of min(24rem, 38%) for the cover and row metadata, and a wide column for titles and reading text, separated by a clamp(40px, 5vw, 72px) gutter. The lead, every section, and every archive row use the same columns; section heads use subgrid so a section's trailing link right-aligns in the wide column. Sections are separated by clamp(64px, 8vw, 104px) of space above their opening rule. Inside the lead a 28px step separates deck, dateline band and actions; archive rows have 18px of vertical padding (16px on phones). The footer sits 72px below the last section.

The same grid runs the inner pages. The library puts its filters (search, year, section, edition, clear) in the narrow column and the issues in the wide one, as covers or as a ruled list. The issue page opens with the front page's lead, then Contents (each section's name in the narrow column, its stories with page numbers in the wide one), Pages (an 8-up grid of page thumbnails in the wide column), Print at home, Other issues and Image credits, each a section on the grid.

While a page's main is busy (`aria-busy`), only the lead's held space shows; what follows the lead, and the footer, appear once the lead is final, so late data never pushes visible content down. Covers carry width and height, PDF size slots are reserved, and the fallback faces are metric-matched: the front page measures layout shift 0 at 1280 and 390 with every response late.

Responsive behaviour: below 1024px the two PDF buttons stack at one width (max 22rem), label left and size right, with height reserved so the links below never jump. At 720px and below the grid collapses to one column: a compact cover (min(10.5rem, 44vw)), then title, deck, dateline and full-width buttons, so the primary button lands on the first phone screen; archive rows put the title first and the meta beneath; the library's filters fold behind a Filters button and its cards run two up; the page grid runs four up. On touch and narrow screens every target reaches 44px, using invisible hit areas where the visual must stay small (`ui_check.mjs` checks every link, button and field on every page).

### Named Rules
**The One Grid Rule.** The lead and every list row share the same two columns, so cover, metadata and titles align down the whole page. A new section joins that grid rather than inventing its own.

**The Rule Weights Rule.** Rules carry structure, graded by weight: a Hairline Grey 1px between rows, 1px ink to open a section or top a dateline band, 2px ink under the masthead (followed by a 3px gap and a 1px ink line, a double rule) and over the footer, and one 3px ink rule per page to open the archive list.

## Elevation & Depth

The system is flat. Depth is reserved for paper objects: issue covers, page images in the reader and the page grid, and the floating source card and reader panels. Each gets a soft, offset-down shadow with a 1px contact line, as if a printed sheet were resting on the paper. Buttons, rules, text and sections stay flat. The one lift on the front page and the issue page is under the lead cover.

### Shadow Vocabulary
- **Lead cover lift** (`--lift: 0 1px 0 rgba(26,26,26,.08), 0 18px 30px -20px rgba(26,26,26,.55)`): the lead cover on the front page and the issue page. On hover it rises 6px and a deeper shadow (`--lift-up: 0 1px 0 rgba(26,26,26,.08), 0 26px 36px -22px rgba(26,26,26,.5)`) fades in on a pseudo-element, so no shadow is ever animated.
- **Library cover lift** (`0 1px 0 rgba(26,26,26,.08), 0 12px 22px -16px rgba(26,26,26,.6)`): cover cards in the library; rises 4px on hover.
- **Page thumbnail** (`0 1px 0 rgba(0,0,0,.06), 0 6px 12px -8px rgba(0,0,0,.4)`): the issue page's page grid and the library list's small covers; page thumbnails rise 4px on hover.
- **Reader page** (`0 1px 0 rgba(0,0,0,.06), 0 14px 30px -16px rgba(40,30,10,.45)`): pages on the reader's stage.
- **Floating card** (`0 18px 30px -20px rgba(0,0,0,.55)`): the source hover card; the reader's download popover uses `0 18px 40px -24px rgba(0,0,0,.55)` and its contents panel `12px 0 30px -24px rgba(0,0,0,.5)`.

### Named Rules
**The Paper Lift Rule.** Only printed objects and floating cards cast a shadow, always soft and offset downward. A shadow never stands in for a border, a section or a button state.

## Shapes

Everything is square. Buttons, chips, segmented controls, the search field, key caps, source chips, panels, sheets and covers all have a 0px radius; the search field resets the browser's rounding explicitly. Covers keep the printed issue's proportion (1800:2548) and crop to it. Form comes from rules and borders: 1px ink outlines for the ghost button, segmented control and download popover, a 1px Stone Line for chips, a 1px ink underline for the search field. Icons are authored inline SVG line drawings on a 24px grid, stroked in currentColor at 1.6–1.8 with no fill (including the open-elsewhere mark on source links).

### Named Rules
**The Square Corner Rule.** No radius anywhere (0px). Softness comes from the paper, not the corners.

## Components

### Buttons
Square ink slabs with condensed uppercase labels: decisive, typeset, never pill-shaped.
- **Shape:** square (0px), 1px border in the fill colour.
- **Primary:** Press Ink fill, Book Paper text, 13px condensed uppercase at 0.12em; 44px minimum height with 20px side padding site-wide, 50px with 22px padding for the front page's PDF buttons. A PDF button carries its file size after the label in a right-aligned slot reserved at 4.6em, so the button does not grow when the size arrives; if the size never arrives the slot is removed.
- **Hover / Focus:** primary fills Cover Red with a red border; colour transitions run 150ms `ease`. Hover styles apply only on hover-capable fine pointers, so a tap never leaves one stuck. Focus is the global 2px Cover Red outline at a 3px offset.
- **Press:** buttons and chips scale to 0.97 on `:active` (160ms on the strong ease-out), for pointer input only.
- **Ghost:** transparent with a 1px ink border and ink text. It hovers to red text and a red border while staying transparent, so the two PDF buttons never look alike on hover.
- **Stacked:** below 1024px the PDF buttons stack at one width with label and size pushed to opposite ends.

### Text Links
- **Style:** Plex Sans Condensed 600, 16px, ink, underlined 1px in Stone Line at a 0.2em offset; 44px minimum height.
- **Hover:** text turns Cover Red and the underline takes the text colour, over 150ms.
- **Press:** every link but a button turns red on `:active`, the touch feedback that replaces the browser's tap highlight (switched off site-wide).
- A file size that belongs to a link sits beside it in Meta, outside the underline ("Colour PDF 19.2 MB").
- In running serif text, links are ink with a 1px underline at 0.2em and turn red on hover.

### Chips and Segmented Control
- **Chip:** 36px tall (with an invisible 44px hit area on touch and narrow screens), 12px side padding, 1px Stone Line border, transparent, Plex Sans Condensed 500 at 14px. Hover darkens the border to ink; selected (pressed) fills ink with paper text.
- **Segmented control:** a 1px ink frame divided by 1px ink lines into equal cells; 12px condensed uppercase labels at 0.12em; the pressed cell fills ink. Used for the library's edition and view switches.

### Cards / Containers
- **Corner Style:** square (0px).
- **No boxes:** sections are opened by rules, never boxed. The issue page's former download box is now the Print at home section: four specs in a ruled row (Plex Sans Condensed, tabular), the booklet instructions, and each edition as a text link with its size and literal file name.
- **Shadow Strategy:** flat (see The Paper Lift Rule).
- Library cover cards are not boxes: a cover, a 1px ink rule, the title, the cover line in italics, the facts, then "Read online" and the PDF of the chosen edition, sitting directly on paper. The list view sets the same facts as ruled rows with a 72px cover.

### Inputs / Fields
- **Style:** the library search field is an underline only: transparent, no radius, a 1px ink bottom border, Newsreader at 19px, 44px tall, with a 20px SVG magnifier at the right.
- **Focus:** the global 2px red outline, offset 4px for the field.
- Form legends use the condensed uppercase label at 11px over a hairline; the search field's label uses the same 11px label.

### Navigation
- **Masthead:** nameplate (Newsreader 800) with the italic tagline in Soft Ink beneath, navigation right-aligned on the baseline, then a 2px ink rule, a 3px gap and a 1px ink line. Static HTML on every page so it paints before data loads, with the skip link before it. On the front page the nameplate is the h1; on inner pages it links home at the compact size.
- **Links:** Plex Sans Condensed 600 at 13px, uppercase, 0.13em, 28px apart, 12px vertical padding. Hover and the current section show a 2px Cover Red underline (`aria-current="page"` on its own page, `"true"` on an issue page inside the library); the text stays ink.
- **Mobile:** the nav wraps below the nameplate; the nameplate drops to 40px.
- **Footer:** a 2px ink rule, the nameplate at 22px left, the issue total and cadence in condensed Pencil Grey with tabular figures on the right.

### Dateline Band
The lead's facts gathered into one band: a 1px ink rule above, a hairline below, 11px vertical padding (9px on phones), full width of the title column. Contents are the issue number (only when the title lacks it), the long-form date in a `time` element, and the page count, in condensed 500 at 15px with tabular lining figures, separated by Pencil Grey middle dots.

### Archive Entry
A whole-row link on the two-column grid. Metadata (issue number and date, dateline style) sits in the narrow column; the title (Newsreader 600, 22px) sits in the wide column on the same baseline. Rows are separated by hairlines, with a hairline above the first. On hover the title turns red and gains an underline in its own colour. The list is opened by the page's one 3px ink rule and capped at six entries, with "All issues in the library" right-aligned in the section head.

### Cover
The issue's cover image at the printed proportion, on Cover Tone while it loads or if it fails, fading in once loaded. The lead cover (front page and issue page) is the page's only high-priority image: `srcset` offers the 400px per-build thumbnail and the 1200px page image named in `meta.json` (`files.thumbs[0]`, `files.pages[0]`), with `sizes` matching the column, and it keeps `width`/`height`, so high-density screens get the sharp image and nothing shifts. Every other image is lazy. It carries the lead cover lift and rises 6px on hover. The cover link duplicates "Read online", so it is removed from the tab order.

### Contents (issue page)
Ruled groups on the grid: the section name in Index Blue (Plex Sans Condensed 600, 15px) in the narrow column, its stories in the wide one, each a red tabular page number and the headline (Newsreader 21px) linking the reader at that page, with "Cover story" and source chips beneath when they apply. Image credits close the page as their own section, like a magazine's picture credits.

### States
Loading shows the lead's held space and one Note line. Empty, error and not-found states take the lead's place: a Page-title heading, one sentence in the Deck voice that names the problem and the way out, and the button that takes it ("Try again", "Back to the library", "Clear the filters"). The same component serves the front page, library, issue page, reader and 404.

### Reader
Full-screen paper desk: Book Paper chrome with hairline borders, the deeper reader ground behind the pages, a 2px red progress line. Title and position in Plex Sans Condensed; keyboard shortcuts shown as square key caps; the contents panel, download popover and phone sheets use Headline titles with no labels above them, contents rows with red tabular page numbers and the section in Index Blue beneath each headline. Dark mode swaps the reader's local variables only.

### Source Credit
A square chip on Proof Sheet with a 1px Stone Line border: the @handle in Plex Mono at 11.5px in Pencil Grey (real data), "Source" in 12px condensed uppercase at 0.08em, and the open-elsewhere line icon. Hover and focus turn the border and text red. On hover-capable devices a floating card (Proof Sheet, 1px ink border, 2px red top edge) shows the author, handle and post excerpt; on touch the chip grows to 44px and the card is suppressed.

### Motion
Small, physical, and only where it carries meaning (Emil Kowalski's frequency, purpose, curve and duration tables). Tokens in `site.css`: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` for entrances, exits and press; `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)` for on-screen movement; `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)` for page-sized objects; plain `ease` for hover and colour; `--t-press` 160ms, `--t-state` 150ms, `--t-pop` 180ms, `--t-enter` 240ms.
- **The authored moment:** the first lead cover of a visit is set down on the page (8px settle, its lifted shadow tightening, 450ms ease-out, Web Animations); later covers and every reduced-motion view only fade (200ms).
- **Arrival:** content that lands after a fetch fades in (240ms); library cards stagger 40ms apart, at most five steps, on first view only; images fade in once loaded.
- **Feedback:** buttons and chips press to 0.97 (160ms); links turn red on press; hover lifts covers 6px / thumbnails 4px on `ease` (200ms up, 150ms back), on hover-capable fine pointers only.
- **Continuity:** same-origin page changes crossfade (`@view-transition`, 200ms); the reader turns a page as a hinged leaf (400ms on the drawer curve, pointer only, a second click finishes the first turn at once); the phone pager follows the finger, commits on a quarter page or a flick over 0.11 px/ms, resists past the ends, and hands the release speed to the curve; panels and sheets leave the way they came, faster than they arrived, and reverse mid-flight; layout changes in the phone reader use a transform-only FLIP.
- **Never:** keyboard-initiated changes animate nothing (after a key press every transition is instant until the pointer is used, and keyboard page changes skip the crossfade); no layout property, shadow or `transition: all` is animated; no `scale(0)`; no `ease-in`.
- **Reduced motion:** nothing travels or scales; overlays and arriving content fade (150-240ms) and colour changes stay.

## Do's and Don'ts

### Do:
- **Do** set every page on Book Paper (#F7F4EC) in Press Ink (#1A1A1A), and let Cover Red (#C1121F) mark only state and place: hover, focus, the current nav item, selection.
- **Do** separate with rules by weight: a Hairline Grey 1px between rows, 1px ink to open a section, 2px ink under the masthead and over the footer, and one 3px ink rule per page for the archive list.
- **Do** put the lead and every list row on the one two-column grid (min(24rem, 38%) and 1fr, gutter clamp(40px, 5vw, 72px)), collapsing to one column at 720px.
- **Do** set every row fact (issue number, date, page count, file size) in Plex Sans Condensed with tabular lining figures, joined by a Pencil Grey middle dot.
- **Do** carry a file's size inside the button that downloads it, in a right-aligned slot reserved at 4.6em.
- **Do** keep every target at least 44px (50px for the lead's PDF buttons) and keep the 2px red focus outline at a 3px offset.
- **Do** use IBM Plex Mono only for literal machine strings: a PDF file name, an @handle, a SHA or build hash.
- **Do** draw icons as inline SVG line icons on a 24px grid, stroked in currentColor at 1.6–1.8, with no fill.
- **Do** build an inner page from the shared parts (`parts.js`: lead, dateline, cover, PDF button, state) and the shared tokens; hold the lead's space while data loads.
- **Do** give every new animation a purpose, a frequency check, a curve and duration from the motion tokens, a reduced-motion fade, and no keyboard path.

### Don't:
- **Don't** put a small uppercase label above a heading (the retired "LIBRARY", "ISSUE NO. 2 · COVER STORY" and "THIS WEEK" kickers, or blue section labels above headlines); the heading carries itself.
- **Don't** mark sections with a red tab on a red hairline; open a section with a 1px ink rule.
- **Don't** set dates, counts, page numbers, breadcrumbs, captions or status strips in monospace to look technical.
- **Don't** round anything: buttons, chips, fields, panels and covers are square (0px).
- **Don't** put a shadow on buttons, rules, text or boxes; the soft paper lift belongs to covers, page images and floating cards.
- **Don't** use Index Blue (#2F5D8A) as a second accent for links, buttons or headings; it is annotation only.
- **Don't** use Unicode arrows or other glyphs as icons; draw them (key caps in the reader's shortcut legend are text, not icons).
- **Don't** add colour literals outside the tokens for text or rules.
- **Don't** spell it "Grayscale" in anything a reader sees; the edition is "Greyscale" (the data key `pdf_grayscale` and file names stay as they are).
- **Don't** animate on keyboard input, animate layout properties or shadows, or replay an entrance when a list re-renders.
