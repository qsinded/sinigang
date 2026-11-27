# Auto-cover printed labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find printed text on a diagram picture with vendored Tesseract.js and turn each label into a cover.

**Architecture:** Tesseract is vendored under `vendor/tesseract/` and lazy-loaded like PDF.js; its files are cached at
runtime in their own service-worker cache that app updates keep. A pure `labelCovers()` turns Tesseract line boxes into
normalised covers. The diagram maker searches each new picture in the background after one-time consent; the cover
editor gets a **Find printed labels** button.

**Tech Stack:** classic browser scripts, `tesseract.js` 7.0.0 + `tesseract.js-core` 7.0.0 (Apache-2.0),
`@tesseract.js-data/eng` 4.0.0_best_int (MIT); Node built-in tests with the existing DOM stub.

**Spec:** `docs/superpowers/specs/2026-11-27-auto-cover-labels-design.md`

## Global Constraints

- No dependencies in package.json, no build step, no network beyond this app's own origin.
- Not precached: engine files are cached at runtime in `OCR_CACHE = 'ocr-tesseract-7.0.0'`, which `activate` keeps.
- Consent before the first download; copy: "Hide the printed labels automatically? This downloads about 7 MB once, then works offline."
- Offered only with `Worker` and an active service worker controller; otherwise: "Finding labels automatically needs the installed app or a normal browser; hide them by hand here."
- `COVER_MAX = 60`. Line kept when confidence >= 60 and text has 2+ letters or digits.
- Create never waits for the search; covers attach to the saved reviewer by image id.
- Bump `sw.js` VERSION once (v33); README + ROADMAP updated.

## Review Focus

- Student declines consent → nothing downloads, no engine script tag is added (Task 3 test).
- Picture changed or maker left mid-search → old result never lands on a reviewer (Task 4 test).
- Reviewer deleted or picture replaced before a late result → result dropped (Task 4 test).
- Running Find printed labels twice → no duplicate covers (Task 2 `existing` test, Task 5 test).
- Engine download fails → message, manual covers still work, Create still works (Task 3 test).

---

### Task 1: Vendor the engine and keep it cached across app updates

**Files:** Create `vendor/tesseract/{tesseract.min.js,worker.min.js,tesseract-core-lstm.wasm.js,tesseract-core-simd-lstm.wasm.js,tesseract-core-relaxedsimd-lstm.wasm.js,eng.traineddata.gz,LICENSE-tesseract.js.md,LICENSE-tesseract-core.txt}`; Modify `sw.js`; Test `tests/offline.js`.

**Produces:** `OCR_CACHE` in sw.js; requests under `./vendor/tesseract/` are matched/put in `OCR_CACHE`.

- [ ] Test: after `activate`, cache keys are `[CACHE, OCR_CACHE]` when both existed and an older `ocr-tesseract-6` is deleted; a first fetch of `vendor/tesseract/worker.min.js` lands in `OCR_CACHE` (not `CACHE`) and is served offline afterwards; a fresh world with a new CACHE name keeps `OCR_CACHE` on activate.
- [ ] Run `node tests/offline.js` → FAIL (`OCR_CACHE` not declared).
- [ ] Copy files from the npm tarballs (versions above); add `OCR_CACHE`; `activate` deletes keys not in `[CACHE, OCR_CACHE]`; fetch handler picks the cache by path prefix.
- [ ] Run `npm test` → all pass. Commit.

### Task 2: `labelCovers(lines, width, height, existing)` and COVER_MAX 60

**Files:** Modify `js/app.js` (cover helpers ~line 478); Test `tests/app-smoke.js`.

**Produces:** `labelCovers(lines: {text, confidence, bbox:{x0,y0,x1,y1}}[], width, height, existing: Mask[]) → Mask[]` (new covers only).

- [ ] Tests: low confidence (59) and "|"/"—" lines dropped; a 2-letter line kept; box normalised and padded by 0.005, clamped to 0–1; two overlapping lines merge into one box; a box overlapping an `existing` cover by >= 50% of its area is skipped; `cleanMasks` keeps 60 and cuts the 61st.
- [ ] Run → FAIL. Implement. Run `npm test` → pass. Commit.

### Task 3: Engine loader, consent and `findLabels`

**Files:** Modify `js/app.js` (next to `loadPdfjs`); Test `tests/app-smoke.js`.

**Consumes:** `labelCovers`. **Produces:**
- `ocrSupported() → boolean` (Worker + `navigator.serviceWorker.controller`).
- `ocrConsent() → 'yes'|'no'|''` / `setOcrConsent(v)`, localStorage key `reviewer_ocr_v1`.
- `loadTesseract() → Promise<Tesseract>` (script tag `./vendor/tesseract/tesseract.min.js`, memoised, reset on failure). Tests override it on the context.
- `findLabels(blob, existing, onProgress(pct)) → Promise<Mask[]>`: one worker (`createWorker('eng', 1, {workerPath, corePath, langPath` as absolute URLs to `vendor/tesseract/`, `gzip: true, workerBlobURL: false, cacheMethod: 'none', logger})`), `recognize(blob, {}, { blocks: true })`, lines flattened from blocks → paragraphs → lines, image size from `data` or `createImageBitmap`, worker terminated in `finally`.
- [ ] Tests with a fake `loadTesseract`: `findLabels` returns `labelCovers` of the fake lines and calls `terminate`; consent 'no' persisted; a rejected `loadTesseract` rejects `findLabels` and a second call retries the load.
- [ ] Run → FAIL. Implement. Run → pass. Commit.

### Task 4: Diagram maker: consent card, background search, attach on Create

**Files:** Modify `js/app.js` (`pickDiagram`, `clearDiagram`, `createDiagram`, `diagramSetup`); Test `tests/app-smoke.js`.

**Consumes:** Task 3. **Produces:** `labelSearch` state `{ token, blob, pct, masks|null, error, reviewerId|null }`; `startLabelSearch(blob)`, `cancelLabelSearch()`; on finish with `reviewerId` set: covers merged into that reviewer when it still exists and still uses that image id, `save()`, redraw if it is on screen, `say('N printed labels hidden.')`.
- [ ] Tests: consent card shown on first picture when supported (both buttons); "No thanks" stores 'no' and starts nothing; "Yes" stores 'yes' and starts a search; with 'yes' a new picture starts a search automatically; status shows "Found N printed labels"; Create while pending → reviewer created immediately with no masks, then gets them when the fake resolves; picking another picture mid-search drops the first result; Cancel mid-search drops it; reviewer deleted before resolve → nothing thrown, nothing saved; unsupported → the hand-cover line instead of the card; edit mode never auto-searches.
- [ ] Run → FAIL. Implement. Run → pass. Commit.

### Task 5: Cover editor "Find printed labels" + docs + release

**Files:** Modify `js/app.js` (`coversScreen`), `README.md`, `ROADMAP.md`, `sw.js` (VERSION v33); Test `tests/app-smoke.js`.

- [ ] Tests: button present when supported; first press with no consent shows the consent question; with consent, found covers are added to `coverList` (not saved until **Save covers**), a second press adds nothing new; progress/“No printed labels found.” text.
- [ ] Run → FAIL. Implement. `npm test`, `npm run quality` → pass.
- [ ] Real-browser check: serve the repo over http on localhost, headless Chrome via CDP, run `findLabels` on a canvas diagram with printed words; expect covers over the words; check the engine files sit in `ocr-tesseract-7.0.0`. Screenshot the maker + cover editor at 390 px.
- [ ] README (feature, ~7 MB once, where offered, older copies keep 24 covers), ROADMAP out-of-scope line, VERSION v33. Commit.
