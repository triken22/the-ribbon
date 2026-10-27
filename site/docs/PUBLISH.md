# Publishing runbook: `bookmark publish NNN` and serving issues from R2

Private R2 bucket `weekend-bookmark-issues` holds `manifest.json` and `issues/NNN/*`. Visitors never talk to R2 directly:
a Cloudflare Pages Function (`site/functions/`) reads the bucket through a **binding named `ISSUES`** and serves only an allowlist of paths with the site's security headers.
`r2.dev` public access and any R2 custom domain stay **off**.
Publish runs either on the owner's publish machine (sections 1 and 2) or from GitHub Actions (section 9, same script, `--no-signoff`).

## 1. What the publish machine needs

- Python 3 with `pip install pypdf Pillow "boto3>=1.36"` (boto3 only for real uploads; Pillow must have WebP support, the default wheels do), and **poppler** for `pdftoppm` / `pdfinfo` (`brew install poppler`). A checkout of this repo (read-only use of `site/scripts/`).
- The env file, **outside any git work tree**: `~/.config/weekend-bookmark/r2.env` (override with `BOOKMARK_ENV_FILE`; the path goes in the environment, never the secrets).

  ```
  mkdir -p ~/.config/weekend-bookmark && chmod 700 ~/.config/weekend-bookmark
  umask 077 && $EDITOR ~/.config/weekend-bookmark/r2.env && chmod 600 ~/.config/weekend-bookmark/r2.env
  ```
  ```
  R2_ACCOUNT_ID=<32 hex>
  R2_ACCESS_KEY_ID=<from the token>
  R2_SECRET_ACCESS_KEY=<from the token>
  R2_BUCKET=weekend-bookmark-issues
  ```
  The script refuses unless: file mode 600, its directory mode 700, both owned by the running user, not a symlink, not inside a git work tree, `R2_BUCKET` is exactly `weekend-bookmark-issues`, all four variables are set. Nothing is accepted on the command line, so nothing shows up in `ps`; values are never printed. `*.env` and `.env*` are git-ignored as a second line of defence.
- The **gate dir** (outside the issue directory; the audit forbids extra files), `--gate-dir DIR` or `BOOKMARK_GATE_DIR`. It must be **mode 700, owned by the user running publish, and not a symlink** (`mkdir -m 700 gate`), or publish refuses. Per issue it holds:
  - `NNN.qa.json`: `{"issue": N, "qa_verdict": "pass"}`, written by the QA gate.
  - `NNN.approval` and `NNN.approval.sig`: the repo owner's **signed** approval (section 1a). Nothing else unlocks a publish.
  - A plain `NNN.APPROVED` file (the old convention) is **refused on sight**: anyone with write access could create it, and on 18 Oct an agent did.
  The QA file name is still the open point in the spec: the engine owner must write exactly `NNN.qa.json` (or tell us the real name).

## 1a. Signed approval (the repo owner only, on their own machine; agents never sign)

Publish trusts an approval only if it is an `ssh-keygen -Y` signature, namespace `weekend-bookmark-approval`, by the key pinned in
`site/keys/approval_allowed_signers`, over this exact text (ASCII, `\n` line endings, trailing newline, lowercase hex):

```
weekend-bookmark approval v1
issue: 003
pdf_color: <sha256 of the stripped colour PDF>
pdf_grayscale: <sha256 of the stripped grayscale PDF>
```

Publish refuses if the signature is missing, does not verify, was made by any other key or namespace, if the text is not byte-for-byte canonical, names another issue, or if either hash differs from the PDF on disk (and from `meta.json`).

**One-time setup (owner):**

```
ssh-keygen -t ed25519 -C weekend-bookmark-approval -f ~/.ssh/weekend_bookmark_approval   # use a passphrase; the private key never leaves this machine
cat ~/.ssh/weekend_bookmark_approval.pub
```
Put the **public** key into `site/keys/approval_allowed_signers` (replacing the placeholder comment) as one line, via a PR that the owner approves themselves:
```
owner namespaces="weekend-bookmark-approval" ssh-ed25519 AAAA... weekend-bookmark-approval
```
Until that line exists, every publish is refused ("no pinned approval key"). A hardware key (`-t ed25519-sk`) also works and is better.

**Per issue (owner), after reviewing the stripped PDFs they are approving:**

```
cd /path/to/issues/003
printf 'weekend-bookmark approval v1\nissue: %s\npdf_color: %s\npdf_grayscale: %s\n' 003 \
  "$(shasum -a 256 issue-003-color.pdf | cut -d' ' -f1)" \
  "$(shasum -a 256 issue-003-grayscale.pdf | cut -d' ' -f1)" > 003.approval
cat 003.approval                                                        # check the issue number and hashes
ssh-keygen -Y sign -f ~/.ssh/weekend_bookmark_approval -n weekend-bookmark-approval 003.approval   # writes 003.approval.sig
ssh-keygen -Y verify -f /path/to/repo/site/keys/approval_allowed_signers -I owner -n weekend-bookmark-approval -s 003.approval.sig < 003.approval
mv 003.approval 003.approval.sig /path/to/gate/                         # the gate dir (mode 700); NOT the issue directory
```
(On Linux use `sha256sum` instead of `shasum -a 256`.) Moving the two files out of the issue directory matters: the audit refuses extra files there.

**Rules:** the private key exists only on the owner's machine (or hardware key). No agent, bot or the shared box ever generates, holds or uses it, and no agent writes `NNN.approval.sig`. The pinned file is a constant in the code; there is no flag or environment variable to point publish at another key. Changing the pinned key is a reviewed PR that the owner approves.
**Limits:** the signature proves the owner approved *these bytes*; it does not stop someone who can edit the publish code or holds the R2 key from uploading directly. So the R2 key must live only where agents cannot read it (not on the shared box), and the publish checkout must be one agents cannot modify.
- Per issue: the issue directory (default `./issues/NNN`, or `--src DIR`) with `meta.json` and both PDFs. **Publish renders the reader images itself** from the approved stripped colour PDF (section 2a). Engine page images under `pages/` and `pages/thumbs/` may be present but are **ignored and never uploaded**; any other file in the directory is refused.

## 2. Command

```
bookmark publish 003 --src /path/to/issues/003 --gate-dir /path/to/gate            # dry-run (default): prints the plan, no network
bookmark publish 003 --src ... --gate-dir ... --execute                             # real upload
bookmark publish 003 --src ... --gate-dir ... --execute --replace                   # re-publish an existing issue
bookmark publish 003 --src ... --gate-dir ... --no-signoff                          # owner only: without the signed approval
```

**`--no-signoff` (the owner's explicit decision, per run).** Skips **only** the signed approval of section 1a (`NNN.approval` / `.sig` are not read and the pinned key is not needed); the approved PDF hashes are then taken from `meta.json` `files.sha256`. Every other check runs unchanged and in the same order (gate dir, QA PASS, legacy `NNN.APPROVED` refusal, bucket pin, strip/check with the bytes-unchanged check against those hashes, page counts, image gate, validate, `qa.json`, ETag/immutable checks, `--replace`). The output says `SIGNOFF SKIPPED (--no-signoff)`. Each such run, dry-run or execute, refused or not, appends one JSON line to `~/.local/state/weekend-bookmark/publish.log` (override with `BOOKMARK_PUBLISH_LOG`; dir 700, file 600, publish refuses to start if it cannot open it): UTC time, issue, mode, replace, `"signoff": "skipped"`, the approved PDF SHA-256s, the result and, on execute, the keys actually uploaded. Never credentials. Without the flag nothing changes: an unsigned issue is refused.

Steps, in order; any failure exits non-zero and later steps never run: 0 gate (gate dir 700 and ours, QA PASS, signed approval verifies against the pinned key, PDF hashes equal the signed hashes and `meta.json`) -> 1 stage (only `meta.json` and the two PDFs are copied into a private dir) -> 2 strip + check (PDF bytes must still equal the signed hashes; the only annotations allowed are minimal x.com/twitter.com status links, see PIPELINE-SPEC section 4a, and the number kept per PDF is printed) -> 3 render -> 4 verify images (the image gate) -> 5 check, audit, validate (`validate_issue.py`) on the final issue dir -> 6 record (`qa.json`) -> 7 upload.
Everything runs in **private temp dirs** (`mkdtemp`, mode 700, removed afterwards); the source directory is never modified. If strip changes a PDF's bytes (it was not clean at approval) the hashes no longer match and publish refuses. The dry-run runs steps 0 to 6 too (render and image gate included), so it is the way to check a publish-machine setup without touching R2.

### 2a. Reader images, the image gate and `qa.json` (since the Issue 003 page-10 incident)

On 18 Oct the 00:30 publish of issue 003 took its reader WebPs from a build step that sorted `pp-*.png` in a shared `/tmp` and kept the first 16. A stray `pp-1.png` (a synthetic ABB price list from unrelated extractor work) sorted between `pp-09` and `pp-10`, became page 10, pages 11 to 16 shifted by one and page 16 had no image. The PDFs were clean. The QA file was written at 00:28, before the images existed, and hashed only the PDFs; the old step 5 checked only image widths. So nothing caught it. Now:

- **Render (step 3).** Publish renders every page of the approved, stripped colour PDF with `pdftoppm -r 150`, **one page per call** with `-singlefile`, into its own `mkdtemp` dir (mode 700). The dir must then hold exactly `r-001.png` … `r-NNN.png`; a stray, extra or missing file refuses. Images are taken by page index, never by sorting a listing; nothing is read from `/tmp`, the working directory or the source `pages/`. The page count must agree across pypdf and poppler, both editions, `meta.pages` and `files.page_count`, else refuse. Each page becomes a 1200 px WebP and a 400 px thumb (Lanczos, WebP quality 85, no EXIF/XMP/ICC).
- **Per-build names (step 3).** Every image is named after its own content: `pages/p-10.<first 12 hex of its SHA-256>.webp` and `pages/thumbs/p-10.<…>.webp`. `meta.json` lists them in `files.pages` / `files.thumbs`, `cover_image` is `files.pages[0]` and the manifest entry carries `cover_thumb`. A changed image therefore always has a new URL: a year-long `immutable` cache can never pin a wrong picture to a URL the site still uses. Unchanged images keep their URL (and are skipped on re-publish).
- **Image gate (step 4).** Every page is rendered **again**, page by page, in a second private dir, and each page image and thumb must: be WebP of the right width; carry its own SHA-256 prefix in its name; be **byte-identical** to the fresh render (render + encode are deterministic on one machine); and match the raw PDF raster within tight pixel limits (`DIFF_LIMITS`: mean grey difference ≤ 4, ≤ 1 % of pixels off by more than 32, worst 1/64 tile ≤ 12). Correct pages score about 1 / 0.2 % / 4; the 18 Oct price list scored 54 against its slot, and neighbouring pages score ≥ 30. Any mismatch refuses and names the page.
- **`qa.json`, the build record (step 6).** Written by publish **after** every file is final, outside the issue dir (never uploaded): schema, issue, `generated_at` (UTC, microseconds), the approved PDF hashes, renderer versions, the SHA-256 and size of **every object the upload will PUT** (pages, thumbs, PDFs, `meta.json`) and this issue's manifest entry. Before the upload, and again right before the network, publish refuses if `qa.json` is missing, misses or adds a file, any hash differs, or it (by `generated_at` or file mtime) predates any file it covers. Every PUT then hashes the exact bytes it sends and refuses if they differ from `qa.json`. The dry-run prints each object's SHA-256 and the `qa.json` hash.
  This is separate from the QA verdict `NNN.qa.json` in the gate dir (section 1), which is still required and still judges the PDFs the owner signs; it cannot know the image hashes, because the images are produced by publish.
- The signed approval (section 1a) is unchanged: the owner signs the PDF hashes; the images are derived from exactly those bytes and checked against them.

**Fixing what readers already cached (after the freeze lifts).** Live R2 images for 003 match the clean 07:59 build, but they sit at the old fixed names with `immutable`, so a browser that loaded the bad `p-10.webp` keeps it. The fix is a re-publish under the new names, in this order:
1. Merge and deploy this change to Pages first (the Function must route `p-NN.<hash>.webp` and the reader JS must read `files.pages`; old names keep working meanwhile).
2. The owner pins their key, signs `003.approval` for the unchanged PDFs on their machine; then on the publish machine: `bookmark publish 003 --src … --gate-dir …` (dry-run, read it), then `--execute --replace`. Only new image keys, `meta.json` and the manifest are written; PDFs are identical and skipped.
3. Purge the Cloudflare cache for `/issues/003/meta.json` and `/manifest.json` (both `max-age=60` anyway). Readers then load the new URLs; the old `pages/p-10.webp` is no longer referenced by anything. Deleting the legacy `issues/003/pages/p-NN.webp` objects is optional (owner/Servers, later).
Upload: pages and thumbs, both PDFs, then `meta.json`, then `manifest.json` **last** with `If-Match` on the ETag read at the start (first publish: `If-None-Match: *`). A concurrent change makes the write fail; just re-run the same command, **without** `--replace`: an issue whose objects exist but which is not yet in `manifest.json` is an interrupted publish and resumes (identical objects are skipped, `meta.json` and the manifest are written again).
**Immutable objects are never overwritten with different bytes.** Before any write, every page, thumb and PDF key that already exists is compared with the local bytes (MD5 against the R2 ETag). Identical: skipped. Different (or an ETag that is not a plain MD5): publish refuses and writes nothing, because those URLs were served `immutable` for a year and a CDN purge cannot reach browser caches. Each object is verified by size after upload. Content-Type is set explicitly (`application/pdf`, `image/webp`, `application/json`). Cache-Control: numbered pages, thumbs and PDFs `public, max-age=31536000, immutable`; `meta.json` and `manifest.json` `public, max-age=60`.
`--replace` is required if the issue is already listed in `manifest.json`; nothing is bumped or renumbered silently. With `--replace`, only `meta.json`, the manifest and **new** file names can change. A corrected PDF must get a new file name (for example `issue-003-color-v2.pdf`, set in `meta.json` and signed again). Changed page images get new names automatically (content hash in the name, section 2a), so a corrected issue can be re-published under the same number. Purge the Cloudflare cache for `/manifest.json` and `/issues/NNN/meta.json` after a replace.

## 3. R2 token (owner, in their own Cloudflare dashboard)

R2 > Manage API tokens > Create **Account** or **User** API token: permission **Object Read & Write**, scope **only bucket `weekend-bookmark-issues`**, TTL about 90 days if offered (rotate on the same date every cycle, calendar it). The access key id and secret go **straight into the env file on the publish machine** (for GitHub Actions: the token value goes straight into the `publish` environment secret, section 9): never chat, repo, PR, email or screenshots. No admin or account-wide token. Revoke the old token after rotating.

## 4. Pages: bind the bucket (Servers, with the owner's OK)

Cloudflare dashboard > Workers & Pages > project `weekend-bookmark` > Settings > Bindings > Add > **R2 bucket**: variable name **`ISSUES`**, bucket **`weekend-bookmark-issues`**. Do it for **Production and Preview**. No secrets, no environment variables, no build command (Functions in `functions/` are auto-detected next to the output directory's project root; **check that the project root directory is `site`**, so that `site/functions` and `site/public` are used; if the root is the repo root the Function is not found).
Do not add a `wrangler.toml` for this: once present it becomes the source of truth and dashboard bindings are locked. R2 bindings cannot be made read-only at the platform level; read-only is enforced by the Function code (only `head()` and `get()`; a test fails if any write verb appears) and by keeping the bucket otherwise private. Until the binding exists, `/manifest.json` and `/issues/*` return the normal static 404 (the "no issues yet" state).

What the Function does (`functions/_lib/serve.js`, routes `functions/issues/[[path]].js` and `functions/manifest.json.js`): GET/HEAD only (others 405); any query string, `%` escape, backslash, `..` or `//` is a 404; strict path allowlist (`/issues/NNN/meta.json`, `/issues/NNN/<name>.pdf` with `^[a-z0-9-]{1,80}$` names (publish enforces the same limit), `/issues/NNN/pages/p-NN.<12 hex>.webp` and `/issues/NNN/pages/thumbs/p-NN.<12 hex>.webp`, the legacy `p-NN.webp` forms still referenced by issues published before section 2a, and `/manifest.json` mapped to key `manifest.json`); R2 key = path without leading slash; ETag/`If-None-Match` (304) and single-range `Range` for PDFs (206/416); Content-Type from the extension, never from stored metadata; PDFs `Content-Disposition: inline; filename="..."`; `X-Robots-Tag: noindex` on issue files; the same security headers as `public/_headers` (a test compares them); missing/invalid paths fall through to the static 404 with the security headers and `no-store`; errors are a generic 404 (no bucket names or error text).
`_headers` still applies to every static asset (HTML, JS, CSS, fonts) unchanged; it simply does not apply to Function responses, which is why the Function sets headers itself.

## 5. Rollback of an issue

1. Remove its entry from `manifest.json` (re-publish the manifest without it; `latest` = highest remaining). The site then no longer lists it (this is the unpublish in spec section 3).
2. Optionally delete `issues/NNN/*` objects in the dashboard (owner/Servers).
3. Purge the Cloudflare cache for `/manifest.json` and `/issues/NNN/*`.
To redo a bad issue: fixed PDFs under new PDF file names, signed again by the owner, then `bookmark publish NNN --execute --replace` and purge the cache; the re-rendered pages get new names on their own (section 2a).

## 6. First-publish checklist (Servers / IT SEC)

- [ ] Token created by the owner with the scope above; env file mode 600 in a 700 dir outside any repo; `check_secrets.sh` passes on the repo.
- [ ] R2 binding `ISSUES` set for Production and Preview; project root dir confirmed; `r2.dev` access off.
- [ ] Preview: `bookmark publish NNN` dry-run output reviewed; then `--execute` against the bucket (the preview and production share it).
- [ ] After publish: `/manifest.json` 200 `application/json` `max-age=60`; a page, thumb and PDF 200 with the full security headers, correct types, `immutable`; PDF `Range` gives 206; `HEAD` works; `/issues/NNN/../x`, `?x=1`, `/issues/NNN/other.txt` are 404 with headers; the PDF opens inline in Chrome and Safari (CSP `default-src 'self'` and `object-src 'none'` apply to the PDF response; verify the built-in viewer is fine).
- [ ] IT SEC: real production PDF through `check`; response headers confirmed.
- [ ] `site/scripts/check_no_example.sh` passes (it also runs the secret scan, which covers test files too and prints only file:line, never the value).
- [ ] The owner's public key is pinned in `site/keys/approval_allowed_signers` and the issue's `NNN.approval.sig` was made on their machine.
- [ ] IT SEC's conditional-write test on a throwaway object (`IfNoneMatch` then `IfMatch`), and `r2.dev`/public access confirmed off.

## 7. Cost and caching

Function requests count against the Pages Functions quota (Workers free plan: 100,000 requests/day, then Functions fail with errors; paid plan bills per request). Every page image, thumb, PDF, meta and manifest hit is a Function request, but numbered files are `immutable` for a year, so browsers and the Cloudflare cache absorb repeats (Function responses are not cached by the CDN on their own; add the Cache API or a cache rule if traffic grows). A reader page loads up to 16 images plus thumbs. R2 reads are Class B operations (free tier 10M/month); egress from R2 is free.

## 8. Only the repo owner can do

1. Create the scoped R2 token in their dashboard and put the keys into the env file on the publish machine, or the token value into the GitHub environment secret `CLOUDFLARE_R2_TOKEN` (section 9).
2. Approve the PR and the merge to `main`; pin their approval public key (section 1a); sign each issue's approval on their own machine.
3. Authorise Servers to add the `ISSUES` binding (Production and Preview) and confirm the Pages root directory.
4. Custom domain (`theribbon.fyi`) and analytics are decided: self-hosted Plausible CE at `stats.tristankennedy.art` (same VPS as tristankennedy.art, not Plausible Cloud; site `theribbon.fyi` already exists there), reached same-origin through `/js/pa.js` and `/api/event` so the CSP is unchanged (docs/ANALYTICS.md). Set `PLAUSIBLE_API_HOST` in Pages Production. Confirm printed bookmarks may be public forever.
5. Calendar the token rotation (about every 90 days).

## 9. Publishing from GitHub Actions

Workflow `.github/workflows/publish.yml` ("Publish issue"): manual trigger only (`workflow_dispatch`), **dry run by default**. It runs the same
`site/scripts/bookmark_publish.py` with **`--no-signoff`** (section 2: the signed approval of section 1a is skipped, every other gate runs and
the run is logged), so in CI the human approval is the `publish` environment's required reviewer, if you set one (step 2 below).

**What it publishes.** `issues/NNN/` as committed on the ref you run it from (`meta.json` and the two stripped PDFs, whose SHA-256 must equal
`files.sha256`) and the QA verdict `gates/NNN.qa.json` (committed **outside** the issue directory, because the audit forbids extra files). The
workflow copies only `NNN.qa.json` into a fresh mode-700 gate dir under `$RUNNER_TEMP` and runs:

```
python site/scripts/bookmark_publish.py publish NNN --src issues/NNN --gate-dir <that dir> --no-signoff --dry-run    # dry_run ticked
python site/scripts/bookmark_publish.py publish NNN --src issues/NNN --gate-dir <that dir> --no-signoff --execute    # dry_run unticked
```
plus `--replace` when `replace` is ticked (in a dry run too, so the dry run previews the same command).

**Secret.** One secret, **`CLOUDFLARE_R2_TOKEN`**: the R2 API token **value** (shown once when the token is created), not the access key pair.
At run time, and only when `dry_run` is unticked, `site/scripts/ci_r2_env.py` derives the rest:
- account id: `GET https://api.cloudflare.com/client/v4/accounts` (the token must see exactly one account),
- access key id: `GET /client/v4/accounts/<id>/tokens/verify` (must be `success` and `status: active`; the key id is `result.id`),
- secret access key: the lowercase SHA-256 hex of the token value (Cloudflare's documented R2 derivation).

Each value goes through `::add-mask::` before it is used, and the token is masked too. Errors name the failing step and Cloudflare's numeric
error code only, never a value or a response body. The values are written to `$RUNNER_TEMP/wb/r2.env` (dir 700, file 600, umask 077, never
overwritten) in the format of section 1, and `BOOKMARK_ENV_FILE` points publish at it. A final `if: always()` step deletes that directory.
A dry run never reads a secret (the credential step is skipped), so it works before the secret exists.
Fallback if the token cannot list accounts or verify itself: leave `CLOUDFLARE_R2_TOKEN` unset and add `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID` and
`R2_SECRET_ACCESS_KEY` (32 / 32 / 64 lowercase hex) instead. If `CLOUDFLARE_R2_TOKEN` is set, it wins.

**One-time setup (owner).**
1. Create the token as in section 3, but as an **Account API token** (R2 > Manage API tokens > Create Account API token): Object Read & Write,
   only bucket `weekend-bookmark-issues`. A *User* API token fails at `verify token`, because user tokens are verified at `/user/tokens/verify`;
   use the fallback secrets for one of those.
2. GitHub > the repo > **Settings > Environments > New environment `publish`**:
   - **Deployment branches and tags: Selected branches, `main` only.** Strongly recommended: without it, anyone with write access can run the
     workflow from a branch whose edited workflow reads the secret.
   - **Required reviewers** (optional; recommended now that CI skips the signed approval): add the owner. Every run, dry runs included, then
     waits for their approval before the job starts.
   - **Environment secrets > Add secret**: name `CLOUDFLARE_R2_TOKEN`, value = the token value. Prefer this to a repository secret
     (Settings > Secrets and variables > Actions), which every workflow in the repo could read.
3. Merge the workflow to `main`. GitHub lists a `workflow_dispatch` workflow in the Actions tab only once it is on the default branch.

**Per issue.**
1. Commit `issues/NNN/{meta.json, both PDFs}` (already stripped; `files.sha256` must match) and `gates/NNN.qa.json` (`{"issue": N, "qa_verdict": "pass", ...}`) to `main` through a PR.
2. **Dry run first.** Actions > **Publish issue** > Run workflow: branch `main`, `issue` = `003`, `dry_run` ticked (the default), `replace` as
   needed. Or: `gh workflow run publish.yml --ref main -f issue=003 -f dry_run=true`. Read the "Publish" step log: steps 0 to 6 run in full
   (strip, render, image gate, validate, `qa.json`) and the plan lists every object with its size and SHA-256. The `--no-signoff` log line is
   attached to the run as the artifact `publish-log-<run id>-<attempt>` (no credentials in it).
3. **Execute.** Run it again with `dry_run` unticked (`-f dry_run=false`), and `replace` ticked (`-f replace=true`) if the issue is already
   in `manifest.json` (otherwise publish refuses, section 2).
4. The **`qa`** job then runs automatically (execute runs only; no secrets): `site/scripts/ci_qa_public.py` fetches
   `https://theribbon.fyi/manifest.json` and `/issues/NNN/meta.json`, then every file that meta lists (both PDFs and every
   `files.pages` / `files.thumbs` entry). It fails on any non-200 (redirects count as failures), a wrong `Content-Type` (`application/pdf`,
   `image/webp`, `application/json`), a PDF whose SHA-256 differs from `files.sha256` or from the committed `meta.json`, an image whose bytes do
   not match the hash in its name, or a manifest without exactly one entry for the issue, with the wrong `latest`, or with an entry that differs
   from `meta.json`. It retries 4 times, 20 s apart.
5. After a `--replace`, purge the Cloudflare cache for `/manifest.json` and `/issues/NNN/meta.json` as in section 2 (both are `max-age=60` anyway).

**Notes.**
- `concurrency: publish` (not cancelled): a second run waits for the first instead of racing it on `manifest.json`.
- The workflow token is read-only (`permissions: contents: read`) and checkout does not persist it. No `${{ }}` expression appears inside a
  shell script: inputs reach the shell as environment variables, and `issue` must match `^[0-9]{3}$`. `site/scripts/test_publish_workflow.py`
  checks these rules.
- Python packages are installed from `site/scripts/requirements-publish.txt` with `--require-hashes --only-binary :all:` (exact versions,
  every wheel hashed); poppler comes from Ubuntu (`poppler-utils`).
- The runner renders with Ubuntu's poppler, so its page images differ in bytes from a macOS render and get **different per-build names**
  (section 2a). That is expected: they are new immutable objects, and identical PDFs are skipped.
- The actions use major tags (`actions/checkout@v5`, `actions/setup-python@v6`, `actions/upload-artifact@v4`), not commit SHAs. To pin
  them, resolve each tag (for example `gh api repos/actions/checkout/commits/v5 --jq .sha`) and write `uses: actions/checkout@<sha> # v5`.
- Rotating the token: replace the `CLOUDFLARE_R2_TOKEN` environment secret, then revoke the old token (section 3). A dry run does not read
  the secret, so the next execute run is the first to use the new token; if its credential step fails, nothing has been uploaded.
