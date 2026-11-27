# Read photos of notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Spec: `docs/superpowers/specs/2026-11-28-read-photos-of-notes-design.md`

**Goal:** photos and scanned PDF pages become editable text in the paste box. **Stack:** vendored Tesseract.js 7 (eng+fil), PDF.js, Node tests with the DOM stub.

## Global Constraints
- No network beyond this origin; fil data vendored at `vendor/tesseract/fil.traineddata.gz` (OCR_CACHE keeps it).
- Consent key `reviewer_ocr_notes_v1`; copy: "Reading photos downloads about 9 MB once (less if you already use Find printed labels), then works offline."
- Read text never goes straight to questions: it lands in the paste box.

## Review Focus
- Declining downloads nothing and tells the student how to proceed (Task 2 test).
- Stop mid-way keeps the pages already read (Task 2 test).
- A PDF with some typed and some scanned pages keeps both, in page order (Task 2 test).
- Unsupported browser: plain message, typed files still work (Task 2 test).
- A failed read (engine/network) shows the app's own sentence (Task 2 test).

### Task 1: vendor fil data; shared worker maker
Files: `vendor/tesseract/fil.traineddata.gz`, NOTICE.md; `js/app.js` (`ocrWorker(langs, onProgress)` used by findLabels).
- [ ] Test: findLabels still creates 'eng'; `readPictures` creates 'eng+fil'. Run, fail, implement, pass, commit.

### Task 2: read photos and scanned pages into the paste box
Files: `js/app.js` (run, pdfLines, home file inputs, `isPhoto`, `fitForOcr(file)`, `renderPdfPage(page)`, `readPictures(pics, lines)`), `tests/app-smoke.js`.
- [ ] Tests: photo → consent asked → text in paste box + note, no questions generated; decline; unsupported; scanned PDF page read, typed page kept, order; Stop keeps page 1; engine error shows plain sentence; camera input appends files.
- [ ] Implement; `npm test`; real-Chrome check with a generated photo of printed notes; README; sw.js bump; commit.
