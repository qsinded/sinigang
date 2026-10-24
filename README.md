# Reviewer Generator

Turns PDF, PowerPoint, Word and text notes into practice questions, flashcards and timed drills,
and a labeled diagram image into identification questions. Everything runs in the browser: files
never leave the device, progress is saved locally, and the app works offline. There is no server,
no account and no build step.

## Features

- **Question generation** from definitions, inline lists and capitalised terms: multiple choice,
  true/false, identification and enumeration, with distractors chosen to look plausible.
- **"Show in my notes"** on every answered item: the sentence the answer came from is reopened in
  its original paragraph, with the answer highlighted, so feedback points at the student's own
  material instead of a canned explanation.
- **Exam-date study plan**: give a reviewer its exam date and every item is scheduled with a small
  Leitner box (0, 1, 3, 7 and 16 day waits). The home screen shows what is due today and the next
  exam; reviewers get a one-tap **Review** button for due items.
- **Diagram reviewers**: upload a heart, cell, map or any diagram image, tap each part and type its
  name; every hotspot becomes an identification question, and the same image shows up in
  flashcards and recitation. Images stay on the device.
- **Practice modes**: flashcards with known/learning tracking, shuffle into a fresh question set
  from the saved source, timed practice, retry-missed, print, and export/import of backups.
- **Hands-free oral recitation**: the device's own speech voice reads each question, pauses while
  you think, then reads the answer and moves on. Speed, think time, read-answers and auto-advance
  are adjustable; Space pauses, arrows skip and Esc stops. No audio is uploaded.
- **Accessibility and comfort**: keyboard shortcuts, screen-reader announcements, focus management,
  light/dark themes, reduced-motion and print styles, touch-sized controls.

## Project structure

- `index.html` — website entry point
- `css/styles.css` — styles
- `js/reviewer-generator.js` — rule-based question generator (no network)
- `js/pptx-reader.js` — `.pptx`, `.docx` and old `.ppt` text extraction
- `js/app.js` — interface, storage, study plan, diagrams, source panel, flashcards and recitation
- `js/pdfjs-viewer-bundle.js`, `js/pdfjs-worker-bundle.js` — vendored PDF.js 3.11.174, loaded on demand
- `tests/check.js` — generator and file-reader checks
- `tests/app-smoke.js` — page boot, storage cap, study plan, diagrams, source lookup and PDF.js checks

## Running the tests

```sh
npm test                    # all suites (Node 18+)
npm run quality            # question-quality report on tests/corpus/ (fails if a count gets worse)
node tests/check.js
node tests/app-smoke.js
```

No dependencies are installed; the tests only use Node built-ins and a small DOM stub.

## Deployment

The app is fully static. Deploy this folder to Vercel, Netlify, Cloudflare Pages, GitHub Pages or any
file host — no build command, no environment variables, no serverless functions.

## Diagram reviewers

1. On the home screen choose **Make a diagram reviewer** and pick a PNG, JPEG or WebP image.
2. Tap a part on the image, type its name and choose **Add part**. Repeat for at least 3 parts.
3. Name the reviewer and choose **Create diagram reviewer**, then practice naming the marked part.

Images are resized to 1600 px and stored in IndexedDB on this device. The reviewer itself only keeps
an image id, a normalized hotspot and the label, so `localStorage` stays small. Export embeds the
images in `reviewers.json`, which makes backups portable but noticeably larger.

Labeling is manual by design: on a textbook diagram the printed label sits next to an arrow, and only
a person can say which part that arrow points to. Nothing is scanned or uploaded, and the app never
needs a server to practice the result.

## Supported input

PDF, PowerPoint (`.pptx` and old `.ppt`), Word (`.docx`) and text (`.txt`, `.md`, `.csv`); PNG, JPEG
and WebP for diagram reviewers. Old `.doc` must be saved as `.docx` or PDF first. Scanned PDFs and
image-only slides need OCR.

## Known limits

- PDF.js is pinned to 3.11.174, which is affected by CVE-2024-4367; `js/app.js` passes
  `isEvalSupported: false` when opening a document, which is the documented mitigation. Upgrade to
  PDF.js 4.2.67+ (ESM build) to remove the issue and the main-thread parsing.
- Saved reviewers keep at most 40,000 characters of source text each, so a very large file can only
  rebuild a subset of questions when you shuffle. Reviewers and progress live in this device's
  `localStorage`; diagram images live in IndexedDB. Use Export/Import to move them.
- Diagram reviewers need IndexedDB; private windows and some locked-down browsers block it, in which
  case the setup screen explains that images cannot be stored. Labeling is manual — the app does not
  detect labels or arrows in an uploaded image.
- PDF text is grouped into lines by vertical position, so multi-column layouts may interleave lines.
