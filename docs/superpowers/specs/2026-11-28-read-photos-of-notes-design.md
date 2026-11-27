# Read photos and scanned handouts into notes

Date: 2026-11-28. Status: approved by the owner ("approved, build it").

## Intent
A photo of a handout, or a scanned PDF, currently ends in "No readable text found". Students should get a reviewer
from it like from typed notes. Text read from a picture always has mistakes, and each mistake becomes a wrong
question, so the student checks the text before questions are made.

## Approaches
1. Read pictures with the Tesseract engine already vendored for "Find printed labels", put the text in the paste box
   for the student to fix, then the normal Generate flow. **Chosen** (one sensible way: reuses the engine, its
   cache and consent pattern, and the paste box; no new screen).
2. Generate straight from the read text: rejected, mistakes would silently become wrong questions.
3. A separate review screen for read text: rejected, the paste box already is that screen.

## Design (as approved)
- Choose files also takes JPG/PNG/WebP (several at once). On touch phones a "Take a photo" button opens the camera
  and adds each photo to the chosen files. A scanned PDF's pages with no text are rendered by PDF.js and read too.
- Asked once before the first download: about 9 MB (engine + English + Filipino), less if Find printed labels already
  downloaded the engine. Its own consent key; offered only where the label finder is (Worker + WebAssembly + service
  worker), otherwise a plain message.
- Languages eng+fil (my call: Filipino/Taglish notes are common; fil data is 1.5 MB, vendored beside eng).
- One page at a time, progress "Reading page 2 of 5… 40%", a Stop button that keeps the pages read so far.
- The text lands in the paste box with "Read from N pages. Fix any mistakes the reader made, then Generate."
- Not included: handwriting, de-skewing beyond Tesseract's own.

## Left to the builder
Photo downscale size, PDF render scale, progress throttling, test seams (fitForOcr, renderPdfPage, loadTesseract).
