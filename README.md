# SINEGENG

Turns PDF, PowerPoint, Word and text notes into practice questions, flashcards and timed drills,
and a labeled diagram image into identification questions. Everything runs in the browser: files
never leave the device, progress is saved locally, and the app works offline. There is no server,
no account and no build step.

## Features

- **Question generation** from definitions, inline lists and capitalised terms: multiple choice,
  true/false, identification and enumeration, with distractors chosen to look plausible. A true/false
  item is the note's own sentence ("True or false: A cache is a small fast memory placed close to the
  CPU."), never a rearranged fragment: slide lead-ins like "The control unit is to:" and option lines
  are skipped, a swapped term agrees in number with the verb and takes the right article, and a false
  statement is only made when the swap cannot be true. Exam-paper furniture (instructions, rubrics like
  "Write TRUE if the statement is correct", answer keys and lines that already contain blanks) is
  skipped instead of becoming a question, so a past paper yields questions only from its real content.
- **"Show in my notes"** on every answered item: the sentence the answer came from is reopened in
  its original paragraph, with the answer highlighted, so feedback points at the student's own
  material instead of a canned explanation.
- **Exam-date study plan**: give a reviewer its exam date and every item is scheduled with a small
  Leitner box (0, 1, 3, 7 and 16 day waits). A wait is clamped to the exam day, so the last review
  never lands after the test. The home screen shows what is due today, a seven-day forecast and the
  next exam, and the daily limit (10, 20, 40 or all) decides how much a due session serves.
- **Diagram reviewers**: upload a heart, cell, map or any diagram image, tap each part and type its
  name; every hotspot becomes an identification question, and the same image shows up in
  flashcards and recitation. Labels already printed on the image can be boxed out with covers, so
  practice does not give the answer away. Images stay on the device.
- **Pomodoro-style focus timer**: a 25-minute focus block with a 5-minute break that starts on its
  own, a compact bar that stays visible on every screen, a soft chime, and a count of completed
  blocks for today. It runs on the device clock, so changing screens or reopening the app does not
  lose the block.
- **Practice modes**: flashcards with known/learning tracking, shuffle into a fresh question set
  from the saved source (answers and card mastery follow a question that comes back, and questions
  removed at the check step are not resurrected), timed practice, retry-missed, print, and
  export/import of backups. Enumeration answers earn the fraction of items they got right; one
  answer can be undone after grading or after "Count it correct".
- **Editable reviewers**: fix a question or answer, add one by hand, and remove or restore items.
  Edited and added questions are pinned, so Shuffle carries them forward instead of regenerating the
  old wording. Removing an item prunes only that item's progress.
- **One question at a time on a phone**: the quiz opens in One mode below 520 px, with a remembered
  One/List switch, a position bar, and a sticky Previous / Jump / Next bar above the focus timer.
  Jump is a colour-coded grid of the whole part; any item can be flagged, and flags follow their
  question through a Shuffle. Arrow keys change cards in One mode, and 1–4 answer the current card.
- **Stats by question type**: a Stats panel at the end of each quiz shows accuracy, answered, due
  and flagged counts for every type, plus an all-questions total. Accuracy uses the same partial
  enumeration credit as the score; due follows the same schedule as Review due.
- **Input and sharing**: choose the question types, paste notes instead of making a file, export one
  reviewer on its own, and import a backup without silently creating a duplicate (replace it and
  keep the old progress, or keep both). Saved reviewers can be searched, sorted and filtered by due
  status.
- **Hands-free oral recitation**: the device's own speech voice reads each question, pauses while
  you think, then reads the answer and moves on. Speed, think time, read-answers and auto-advance
  are adjustable; Space pauses, arrows skip and Esc stops. No audio is uploaded.
- **Accessibility and comfort**: keyboard shortcuts, screen-reader announcements, focus management,
  light/dark themes, reduced-motion and print styles, touch-sized controls.

## Project structure

- `index.html` — website entry point
- `css/styles.css` — styles
- `js/reviewer-generator.js` — rule-based question generator and answer grading (no network)
- `js/pptx-reader.js` — `.pptx`, `.docx` and old `.ppt` text extraction
- `js/app.js` — interface, storage, study plan, diagrams, source panel, flashcards and recitation
- `js/pdfjs-viewer-bundle.js`, `js/pdfjs-worker-bundle.js` — vendored PDF.js 3.11.174, loaded on demand
- `js/sw-register.js` — registers the offline cache (does nothing on `file://`)
- `sw.js` — service worker: precaches the app shell so it opens with no connection
- `manifest.webmanifest`, `icons/` — installable app name, colours and icons
- `tools/make-icons.js` — redraws the icons (shapes only, no font needed)
- `tests/check.js` — generator, grading and file-reader checks
- `tests/app-smoke.js` — page boot, storage cap, study plan, diagrams, label covers, source lookup, one-question quiz and PDF.js checks
- `tests/offline.js` — service worker behaviour against fake cache/network objects

## Running the tests

```sh
npm test                    # all suites (Node 18+)
npm run quality            # question-quality report on tests/corpus/ (fails if a count gets worse)
node tests/check.js
node tests/app-smoke.js
node tests/offline.js
npm run icons              # redraw icons/ (only after changing a colour in css/styles.css)
```

No dependencies are installed; the tests only use Node built-ins and a small DOM stub.

## Deployment

The app is fully static. Deploy this folder to Vercel, Netlify, Cloudflare Pages, GitHub Pages or any
file host — no build command, no environment variables, no serverless functions. It works from a
sub-path (like `user.github.io/repo/`) because every path in the manifest and the service worker is
relative.

**After changing any shipped file, bump `VERSION` in `sw.js`** (`v1` → `v2`). The cache is
cache-first, so phones keep the old copy until the name changes: the new worker then downloads the
shell again and the page reloads itself once. Opening the page from `file://` skips all of this and
works as before, with no offline support.

## Offline support

`sw.js` precaches the page, the styles, the app scripts and the icons on first visit, so the
app opens with no connection and stays usable after the browser has cleared its HTTP cache. PDF.js
(1.5 MB) is fetched in the background at install and cached the first time a PDF is opened if that
fetch failed — a PDF still needs its library the first time, and an offline PNG/text review never
does. A navigation to any path inside the app is answered with the cached page, so a bookmark to a
deep link still opens. Reviewer data and images are untouched by the worker: they live in
`localStorage` and IndexedDB as before.

## Diagram reviewers

1. On the home screen choose **Make a diagram reviewer** and pick a PNG, JPEG or WebP image.
2. Tap a part on the image, type its name and choose **Add part**. Repeat for at least 3 parts.
3. Name the reviewer and choose **Create diagram reviewer**, then practice naming the marked part.
4. If the image already has its labels printed on it, choose **Hide printed labels** on the practice
   screen and drag a box over each block of text. Covers show while you practise, in flashcards and
   on printouts, but not while you label parts. Drag on the image to add one, or choose **Add cover**
   and use the arrow keys (Shift with arrows resizes, Delete removes).

Images are resized to 1600 px and stored in IndexedDB on this device. The reviewer itself only keeps
an image id, a normalized hotspot, the label and any covers, so `localStorage` stays small. Export
embeds the images in `reviewers.json`, which makes backups portable but noticeably larger; covers
are small enough to travel in the reviewer itself.

Labeling is manual by design: on a textbook diagram the printed label sits next to an arrow, and only
a person can say which part that arrow points to. Nothing is scanned or uploaded, and the app never
needs a server to practice the result.

## Focus timer

Start a 25-minute block from the bar at the bottom of any screen. When it ends, a chime and an
announcement start a 5-minute break; when the break ends, start the next block when you are ready.
Pause, resume and stop or skip are on the same bar, and completed focus blocks are counted for the
day. The running block and the count live in this device's `localStorage`, apart from the reviewers
and their export.

## Supported input

PDF, PowerPoint (`.pptx` and old `.ppt`), Word (`.docx`) and text (`.txt`, `.md`, `.csv`); PNG, JPEG
and WebP for diagram reviewers. Old `.doc` must be saved as `.docx` or PDF first. Scanned PDFs and
image-only slides need OCR.

## Known limits

- Offline support needs `http(s)`; a page opened from `file://` still works, just without the cache.
  Since the service worker serves the shell cache-first, a deploy only reaches phones after the
  `VERSION` bump described above.
- The saved theme is applied before the first paint, but a reviewer's diagram images still appear a
  moment after the question, because they are read from IndexedDB.
- PDF.js is pinned to 3.11.174, which is affected by CVE-2024-4367; `js/app.js` passes
  `isEvalSupported: false` when opening a document, which is the documented mitigation. Upgrade to
  PDF.js 4.2.67+ (ESM build) to remove the issue and the main-thread parsing.
- Saved reviewers keep at most 40,000 characters of source text each, so a very large file can only
  rebuild a subset of questions when you shuffle. Reviewers and progress live in this device's
  `localStorage`; diagram images live in IndexedDB. Use Export/Import to move them.
- A removed question is kept in its reviewer's Removed list and can be restored; its previous answer
  and study schedule are not restored. A rebuilt set will not bring it back on its own.
- An edited question is pinned to the reviewer and no longer regenerates from the source text.
  Changing its answer clears that item's stored result, but keeps its study schedule.
- Partial enumeration credit affects the score only: the Leitner box advances only when every
  required item is given. The daily limit applies to due flashcard sessions, not to a graded quiz.
- The Stats panel counts accuracy from answered items only; unanswered items are not counted as
  wrong. It breaks results down by question type, not by page or slide section yet.
- Paste and OCR: text can be pasted directly, but a scanned handout or a photo of a page still needs
  OCR before it can be read; the app does not bundle it.
- Diagram reviewers need IndexedDB; private windows and some locked-down browsers block it, in which
  case the setup screen explains that images cannot be stored. Labeling is manual — the app does not
  detect labels or arrows in an uploaded image.
- A cover is a box you place by hand: it hides printed text, not the arrows or leader lines next to
  it, and a label that sits inside the drawing needs its own small box. Covers are stored with the
  reviewer, so they apply to every question and every mode, and they are printed as solid blocks.
- The focus timer is device-local and is not part of Export/Import. It follows the device clock: a
  block that ends while the tab is closed completes the next time the app opens, and nothing
  notifies you while it is closed. The chime needs one tap on the timer so the browser allows
  audio; the spoken announcement works either way.
- PDF text is grouped into lines by vertical position, so multi-column layouts may interleave lines.
