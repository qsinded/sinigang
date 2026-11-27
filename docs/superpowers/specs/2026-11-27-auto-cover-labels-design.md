# Auto-cover printed labels on diagram pictures

Date: 2026-11-27. Status: design, awaiting the owner's approval. Builder-checked; its four questions
are settled below as calls marked "my call".

## Intent

A textbook diagram usually has its labels printed on it, which gives every answer away. Today the
student hides them by dragging a box over each label in **Hide printed labels** (the cover editor).
The owner wants the app to find the printed text on an uploaded picture and cover it automatically,
"so users don't have to manually block some parts on the picture."

Success: a student uploads a labelled diagram, labels their parts as usual, and practises with the
printed labels already hidden, having at most fixed or deleted a box or two.

## Goals

- Find printed text on a diagram picture and turn each label into a cover.
- Work on clean scans and on phone photos of a printed diagram.
- Keep the student in control: found covers are ordinary covers they can move, resize or delete.
- Stay offline after a one-time download, with no server and no account.

## Non-goals

- Naming parts from the text that was read (suggesting "Aorta" when a marker is placed near it).
  A natural follow-up, not this change.
- Reading scanned handouts or photos of notes into questions. That is the separate OCR item in the
  owner's roadmap; this work makes it cheaper later because the engine will already be vendored.
- Arrow or leader-line detection.

## Anti-goals (a failure even if it technically works)

- Spending a student's prepaid data without asking. The ~7 MB download must be agreed to first.
- Blocking the student while it runs. Labelling parts must stay usable during the search.
- Hiding the parts being asked about. Covers already sit under the pins, so a pin stays visible.
- Breaking the "no network" rule: every file is served from this app's own origin.

## Constraints (from the project)

- No dependencies, no build step, no CDN. Third-party code is vendored and lazy-loaded the way
  PDF.js is (`loadPdfjs()` in `js/app.js`, `OPTIONAL` + runtime caching in `sw.js`).
- Every saved field is validated in `cleanReviewer()`; covers go through `cleanMasks()` and are
  capped at `COVER_MAX = 24`.
- Keyboard parity, focus kept visible, live-region announcements through `say()`.
- Bump `VERSION` in `sw.js` once for the release; README stays honest (it currently says the app
  does not detect labels, and ROADMAP.md lists label detection as out of scope; both change).
- Tests use Node built-ins and the DOM stub; Tesseract cannot run there, so it is injected.

## Approaches

1. **Built-in text finder** (pixel heuristics: letter-sized dark marks in rows). Instant, no
   download, no new code to vendor; weak on photos, coloured backgrounds and handwriting.
2. **Tesseract.js OCR, vendored.** Reads real words with boxes; handles photos far better;
   ~7 MB one-time download per device and a few seconds per picture on a cheap phone. Reusable
   for reading scanned handouts later.
3. Browser `TextDetector` (Shape Detection API). Ruled out: not enabled in most browsers.

**Chosen by the owner: 2 (Tesseract).**

## Design

### The engine (vendored)

- `tesseract.js` 7.0.0 (Apache-2.0) and `tesseract.js-core` 7.0.0 (Apache-2.0), English data
  `@tesseract.js-data/eng` 4.0.0_best_int (`eng.traineddata.gz`, 2.95 MB). Versions must match:
  tesseract.js 7 depends on core ^7.
- Files under `vendor/tesseract/`: `tesseract.min.js`, `worker.min.js`, the three LSTM-only core
  builds the worker may choose (`tesseract-core-lstm.wasm.js`, `-simd-lstm`, `-relaxedsimd-lstm`,
  ~3.9 MB each), and `eng.traineddata.gz`, plus the licence files. Repo grows ~15 MB; a device
  downloads one core build: ~7 MB in all.
- English only. Filipino labels are Latin script and still get boxed; adding `fil` (1.5 MB) can come
  with the handout-OCR work.
- Loaded on demand like PDF.js. Worker created with `workerPath`, `corePath` (the directory, so it
  picks the build), `langPath`, `gzip: true`, `workerBlobURL: false` (requests go through the
  service worker), `cacheMethod: 'none'` (the service worker already keeps the files; no second
  copy in IndexedDB). OEM LSTM only.
- `sw.js`: the files are NOT precached (that would cost every user 7 MB). **They live in their own
  cache named after the engine version, e.g. `ocr-tesseract-7.0.0`**, which `activate` does not
  delete. (Builder check found that `activate` deletes every cache but the current `reviewer-<VERSION>`
  one, so runtime-cached engine files would be wiped, and silently re-downloaded, on every app
  update.) The fetch handler puts `vendor/tesseract/*` responses into that cache; a new engine version
  gets a new cache name and the old one is deleted then. `tests/offline.js` covers: engine files go to
  the engine cache, survive an app `VERSION` change, and are served from it offline. Check that the
  worker's requests pass through the service worker.

### Finding labels (pure, testable)

- Run recognition on the stored diagram blob (already ≤1600 px), asking for block output.
- Take **line** boxes, not word boxes (fewer covers, one per label). Keep a line when its confidence
  is at least 60 and its text has 2+ letters or digits; this drops specks and diagram strokes
  read as "|" or "—".
- Normalise to the picture (`x0 / width` …), pad a little (about 0.5% each side), clamp to 0–1.
- Merge boxes that overlap after padding. If more than `COVER_MAX` remain, raise the cap rather
  than drop labels: `COVER_MAX = 60` (each cover is four numbers). `cleanMasks()` keeps validating.
  Known limit, accepted (my call): a phone still running an older copy keeps only the first 24 covers
  of an imported backup until it updates; noted in the README.
- Skip a found box that mostly overlaps a cover already there, so running it twice adds nothing.
- Pure helper, e.g. `labelCovers(lines, width, height, existing)`, tested in `tests/app-smoke.js`
  with hand-written Tesseract-shaped input.

### When it runs (my call; the owner did not pick)

- **First picture ever**, in the diagram maker: a card under the image asks once: "Hide the printed
  labels automatically? This downloads about 7 MB once, then works offline." [Yes, find labels]
  [No thanks]. The answer is remembered on the device.
- **Once agreed**: every new picture in the diagram maker is searched automatically in the
  background while the student places and names parts (they are busy for a minute anyway). A
  status line shows progress ("Looking for printed labels… 40%", then "Found 9 printed labels.
  They will be hidden when you practise."). The search's covers are saved with the reviewer on
  **Create**; if it is still running then, Create waits with "Finishing the label search…".
- **Declined**: nothing downloads; manual covers work as today.
- **Existing reviewers and the cover editor**: a **Find printed labels** button in the cover editor
  adds found covers to the ones there (the same consent question the first time). This also covers
  a picture replaced through **Edit parts**: its covers are not re-searched automatically, because
  hand-made covers may already be right.
- Covers stay hidden in the diagram maker (the student reads the printed labels to name parts).

### Where it is offered (my call)

- Offered only where it can keep its promise: a real `Worker` and a registered service worker
  (`navigator.serviceWorker.controller`). Without the service worker (`file://`, phone HTML viewers)
  every visit would download 7 MB again, and some of those viewers block Workers (see the
  `loadPdfjs()` comment). There, the consent card and the button are replaced by one line:
  "Finding labels automatically needs the installed app or a normal browser; hide them by hand here."
  No main-thread fallback: it would freeze the page for many seconds.

### Creating while the search runs (my call)

- **Create never waits.** If the search (or its first download) is still running, the reviewer is
  created at once and the search keeps going; its covers are added to that saved reviewer when it
  finishes ("9 printed labels hidden"), and an open practice screen redraws. The search result is
  tied to the reviewer's **image id**, not to the maker, so `clearDiagram()` no longer discards it
  after Create; leaving the maker without creating, or picking another picture, still discards it.
  If the reviewer was deleted meanwhile, or its picture replaced, the result is dropped.

### Failure and edge cases

- Download fails or the device is offline before the files are cached: say so, keep manual covers,
  offer to try again; never block Create.
- Nothing found: "No printed labels found."
- Picture changed or maker left mid-search: the result is dropped (the existing `diagToken`
  pattern); the worker is terminated when not needed.
- One worker at a time; terminate it after the search to free memory on cheap phones.

## Left to the builder

- Exact padding, confidence threshold and merge rule; tune on two or three real diagrams (a clean
  scan, a phone photo) and record the result.
- Whether the progress line uses the logger's `progress` or a simple spinner.
- Test seam: how the Tesseract loader is injected so tests run with a fake recogniser.

## Done when

- A labelled heart diagram (scan and phone photo) gets most labels covered with no manual boxes.
- The first use asks before downloading; declining downloads nothing.
- Works offline after the first use; `npm test` passes; README, ROADMAP and `VERSION` updated.
