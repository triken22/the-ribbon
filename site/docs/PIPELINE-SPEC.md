# Mini pipeline spec: `meta.json`, `manifest.json`, `bookmark publish NNN`

Status: proposal for review. The site in `site/public/` already reads exactly this shape.
Example data (fictional posts and handles) lives in `site/dev-fixtures/`, outside `public/`, and never ships. See `site/docs/DEV.md`.

## 1. Layout in the bucket (site root `/`)

```
manifest.json                    # index of published issues (written LAST)
issues/NNN/meta.json             # one per issue, NNN zero-padded to 3 digits
issues/NNN/issue-NNN-color.pdf
issues/NNN/issue-NNN-grayscale.pdf
issues/NNN/pages/p-01.<hash12>.webp         # WebP, 1200 px wide, one per page; <hash12> = first 12 hex of its own SHA-256
issues/NNN/pages/thumbs/p-01.<hash12>.webp  # WebP, 400 px wide (legacy issues: p-01.webp / thumbs/p-01.webp)
```

All paths inside `meta.json` and in manifest entries are relative to `issues/NNN/`.
Nothing else is ever uploaded: no bookmarks, no ledger, no `data/`, no work files.

## 2. `issues/NNN/meta.json`

Allowlist only. Any key not listed here makes `bookmark publish` fail (the site also ignores unknown keys).

| key | type | rule |
|---|---|---|
| `issue` | int | ≥ 1, equals NNN |
| `title` | string | ≤ 80 chars, plain text |
| `date` | string | `YYYY-MM-DD` |
| `pages` | int | page count (16 today) |
| `cover_headline` | string | ≤ 160 chars; shown as the deck |
| `cover_image` | string | `files.pages[0]` (legacy: `pages/p-01.webp`) |
| `qa_verdict` | string | must be `"pass"` |
| `sections[]` | `{slug,label,page_start,page_end}` | `slug` matches `^[a-z0-9-]{1,40}$` |
| `articles[]` | `{id,headline,section,page,kind,sources}` | `section` is a `slug`; `kind` ∈ `cover, feature, brief, department, column, list` |
| `articles[].sources[]` | `{post_id,url,author_handle,author_name,snippet}` | see below |
| `files` | `{pdf_color,pdf_grayscale,pages_dir,page_count,sha256,pages,thumbs}` | PDF names `^[a-z0-9-]{1,80}\.pdf$`; `pages_dir` = `pages/`; `sha256` = `{pdf_color,pdf_grayscale}` hex digests; `pages` / `thumbs` = one per-build image name per page, in order (written by `bookmark publish`; absent on legacy/engine meta) |
| `image_credits` | string[] | printed credits only |

`sources[]` rules (the privacy boundary):

- `url` must match `^https://x\.com/<author_handle>/status/<post_id>$` exactly (handle compared case-insensitively).
- `post_id`: digits only. `author_handle`: `^[A-Za-z0-9_]{1,15}$` (no `@`). `author_name`: ≤ 80 chars.
- `snippet`: ≤ 200 chars, **the text already printed in the issue**. Never extra bookmark text.
- Only posts that are credited in the printed issue. An article without a printed credit gets `"sources": []`.
- The site renders every string as plain text. No HTML, no X embeds, no X scripts.

Sizes are not in `meta.json`; the site reads them from `Content-Length` of the PDF files.

Example (trimmed):

```json
{
  "issue": 2, "title": "The night-shift model", "date": "2026-10-17", "pages": 16,
  "cover_headline": "Opus 5.5 is working the night shift", "cover_image": "pages/p-01.webp", "qa_verdict": "pass",
  "sections": [{"slug": "ai-tools", "label": "AI & Tools", "page_start": 4, "page_end": 5}],
  "articles": [{
    "id": "a03", "headline": "Opus 5.5 is working the night shift", "section": "ai-tools", "page": 4, "kind": "cover",
    "sources": [{"post_id": "1000000000000000202", "url": "https://x.com/demo_editor/status/1000000000000000202",
                 "author_handle": "demo_editor", "author_name": "Demo Editor", "snippet": "…"}]
  }],
  "files": {"pdf_color": "issue-002-color.pdf", "pdf_grayscale": "issue-002-grayscale.pdf", "pages_dir": "pages/", "page_count": 16,
            "sha256": {"pdf_color": "…64 hex…", "pdf_grayscale": "…64 hex…"}},
  "image_credits": ["Cover illustration: AI-generated for this issue."]
}
```

## 3. `manifest.json`

```json
{ "schema": 1, "generated_at": "2026-10-15T18:00:00Z", "latest": 3,
  "issues": [ { "issue": 3, "title": "…", "date": "2026-10-24", "pages": 16, "cover_image": "pages/p-01.3f2a9c0d1e4b.webp", "cover_thumb": "pages/thumbs/p-01.8c1d0e2f3a4b.webp" } ] }
```

- `issues[]`: one entry per **published** issue, any order (the site sorts by `issue`, newest first).
- `latest`: highest published `issue`. The home page features it on the shelf.
- Entry keys are copied from that issue's `meta.json`. No other keys.
- Held or unapproved issues never appear here. Unpublish = remove the entry (and optionally delete `issues/NNN/`).

## 4. `bookmark publish NNN`

Refuses to start unless all of these hold (exit non-zero, upload nothing):

1. `qa_verdict == "pass"` in the QA gate output for issue NNN.
2. A signed approval for NNN exists: `NNN.approval` (issue number and both PDF SHA-256 values) with `NNN.approval.sig`, an `ssh-keygen -Y` signature by the owner's key pinned in `site/keys/approval_allowed_signers` (see PUBLISH.md section 1a). Never written or signed by the pipeline or any agent; a plain `APPROVED` file is refused.
3. SHA-256 of each PDF on disk equals the hash recorded at approval time, and equals `files.sha256` in `meta.json`.
4. `meta.json` passes the allowlist/regex checks (`site/scripts/validate_issue.py issues/NNN` does this).
5. Page images are rendered by publish from the approved stripped colour PDF (one per PDF page, count must match), named per build with their content hash, and pass the image gate: each is byte-identical to an independent re-render of its own PDF page and within tight pixel limits of the raw raster. A build record `qa.json` lists the SHA-256 of every object to upload and must be newer than all of them (PUBLISH.md section 2a).

Upload order (idempotent, so a re-run after a failure is safe; only touches `issues/NNN/*` and `manifest.json`):

1. `issues/NNN/pages/*.webp`, `pages/thumbs/*.webp` and both PDFs. Verify each object (size / ETag) after upload.
2. `issues/NNN/meta.json`.
3. `manifest.json`, **last**: read the current one (note its ETag), add or replace this issue's entry, set `latest`, and write with `If-Match` on that ETag. The site therefore never points at a half-uploaded issue.

Credentials: a bucket-scoped R2 token limited to `issues/*` and `manifest.json`, living only in the Mini's environment (never in a repo).
### 4a. Metadata stripping and issue-directory audit (required before approval)

Every published artefact must be free of identifying metadata, and the issue directory must contain only what the schema allows. **Order, no exceptions: strip -> check -> audit -> record SHA-256 -> approve -> upload.** Stripping changes the bytes, so it runs before the SHA-256 values are recorded and approved (step 3 above compares against the approved hash). Publish is gated on **all three commands exiting 0**; any non-zero aborts the publish.

```
python3 site/scripts/strip_metadata.py strip contents-of/issues/NNN
python3 site/scripts/strip_metadata.py check contents-of/issues/NNN
python3 site/scripts/strip_metadata.py audit contents-of/issues/NNN
```

- File type is decided by **magic bytes** (`%PDF-`, `RIFF....WEBP`, PNG and JPEG signatures), never by extension alone. A renamed PDF is still stripped and checked; a file whose magic does not match its extension fails `check`.
- PDFs (both editions): `check` flags the Info dictionary, XMP `/Metadata` (catalog or page), `/PieceInfo`, embedded files (names tree `EmbeddedFiles`, `/EF`, FileAttachment annotations), JavaScript (`/JS`, `/JavaScript` names, JavaScript actions), `/OpenAction`, `/AA`, Launch/SubmitForm/ImportData actions, URI actions, and **every annotation except a minimal X status link** (below). `strip` builds fresh pages and clones only geometry, resources and content, so no orphaned objects survive; it leaves Info empty, writes no XMP, names tree or OpenAction, and **drops every annotation except links to X posts**. Text and visuals are preserved.
- X status links (so readers can click through to the post): a `/Link` annotation is kept only if its **only** action is `/S /URI` (no `/Dest`, `/AA`, `/PA`, `/Next` chain or `/IsMap`) and the URI, as plain ASCII, fully matches `^https://(x\.com|twitter\.com)/[A-Za-z0-9_]{1,15}/status/[0-9]{1,25}$` (so no query, fragment, userinfo, port, `www.`/`mobile.` host, `http:` or trailing slash). `strip` never copies the source dict: it writes a fresh `<< /Type /Annot /Subtype /Link /Rect [..] /Border [0 0 0] /A << /S /URI /URI (..) >> >>` with nothing else (`/AP`, `/OC`, `/StructParent`, `/F`, `/Contents`, … are gone). Non-X URI links, GoTo/Launch/JavaScript/named actions, widgets, notes, FileAttachment and every other annotation are dropped. `check` accepts exactly that minimal form and flags anything else, including an X link Chromium wrote that has not been stripped yet. Strip is idempotent (stripping its own output gives the same bytes), which is what lets publish re-strip an approved PDF and still match the signed hash. Alternatives: `qpdf --empty --pages` plus the same `check`, or pikepdf; the check is the gate either way.
- Images: pages are rendered sRGB, so **colour profiles are stripped too, not kept**. WebP: EXIF, XMP and ICCP chunks are removed losslessly. PNG: tEXt/zTXt/iTXt (incl. Software), eXIf, iCCP, tIME. JPEG: APP1 (EXIF/XMP), APP2 (ICC), APP13, COM and other APPn except JFIF/Adobe. All lossless; `check` flags every one of these.
- Allowlist `audit <issue-dir>`: reads `meta.json` and allows only `meta.json`, the two PDFs named in `files.pdf_color` / `files.pdf_grayscale` (each `^[a-z0-9-]{1,80}\.pdf$`), and exactly the images listed in `files.pages` / `files.thumbs` (or, for legacy meta without them, `pages/p-NN.webp` plus `pages/thumbs/p-NN.webp` for NN = 1..`pages`). Anything else (extra files or directories, hidden files, symlinks, PNG/JPEG, other PDFs) fails, as does a missing expected file or a file whose magic bytes are not PDF (for PDFs) or WebP (for page images).
- Status: the helper and its tests (`site/scripts/test_strip_metadata.py`) exist in this repo. It is **not** wired into the local engine or any publish script yet; the engine owner must call all three steps in the pre-approval step.

Image recipe (now inside `bookmark publish`, not the engine): `pdftoppm -r 150 -png -f N -l N -singlefile` per page into a private dir, Lanczos resize to 1200 px / 400 px wide, WebP quality 85.

## 5. Serving notes (Servers)

- `public/_headers` only applies to responses **served by Pages as static assets**. A Worker or a direct R2 response does **not** get `_headers`. If `/manifest.json`, `/issues/*` or the PDFs come through a Worker (or an R2 custom domain), that Worker must set these itself: `X-Content-Type-Options: nosniff`, the same `Content-Security-Policy`, `Strict-Transport-Security`, `Referrer-Policy`, the right `Content-Type` (`application/pdf` for PDFs, `application/json` for JSON, `image/webp` for pages), and the cache headers from `_headers`.
- Pages merges every matching `_headers` rule, so `Cache-Control` is set per path and never under `/*`.
- No example data in production: `public/example/` and the `/example/` fallback in `js/data.js` are gone. `site/scripts/check_no_example.sh` fails if either returns. Run it before every production publish.
- Unknown paths: `public/404.html` is served by Pages with a real 404 status (noindex) and the `/*` headers. There is deliberately no `_redirects` catch-all, which would turn 404s into 200s. All pages route by query string (`/issue/?n=3`, `/read/?n=3&p=4`), so no rewrites are needed.
- A missing or empty `/manifest.json` shows a calm "No issues have been published yet" state.

### 4b. Notes for whoever wires publish (IT SEC review of 5bb1fe0)

1. If a font or image inside a PDF carries its own XMP, `strip` keeps it (resources are cloned) and then fails closed with "STILL DIRTY". Expect a hard stop, not a leak.
2. `audit` does not scan `meta.json` content. Publish must also run `validate_issue.py`.
3. Publish must exit non-zero unless strip, check, audit and the validator all pass, in that order, before SHA-256 values are recorded.

### 4c. Implemented

`bookmark publish NNN` is `site/scripts/bookmark_publish.py` (wrapper `site/scripts/bookmark`) and the serving Function is `site/functions/`. Operations, gate-file convention, env file and checklist: `site/docs/PUBLISH.md`. Note: `meta.json` is served with `max-age=60` (same as the manifest).
