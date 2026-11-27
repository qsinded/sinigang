# Vendored OCR engine

Loaded only when a student agrees to "Find printed labels" on a diagram, or to reading photos / scanned pages of
notes (see `js/app.js`, `loadTesseract`). Labels use English; notes use English + Filipino.
Cached by `sw.js` in its own cache (`OCR_CACHE`) so an app update does not download it again.

| File | Package | Version | Licence |
|---|---|---|---|
| `tesseract.min.js`, `worker.min.js` | [tesseract.js](https://github.com/naptha/tesseract.js) | 7.0.0 | Apache-2.0 (`LICENSE-tesseract.js.md`) |
| `tesseract-core-*-lstm.wasm.js` | [tesseract.js-core](https://github.com/naptha/tesseract.js-core) | 7.0.0 | Apache-2.0 (Tesseract OCR itself is Apache-2.0) |
| `eng.traineddata.gz` | [@tesseract.js-data/eng](https://www.npmjs.com/package/@tesseract.js-data/eng), `4.0.0_best_int` | 1.0.0 | MIT package; the model is from tesseract-ocr/tessdata_best, Apache-2.0 |
| `fil.traineddata.gz` | [@tesseract.js-data/fil](https://www.npmjs.com/package/@tesseract.js-data/fil), `4.0.0_best_int` | 1.0.0 | MIT package; the model is from tesseract-ocr/tessdata_best, Apache-2.0 |

`tesseract.min.js.LICENSE.txt` and `worker.min.js.LICENSE.txt` (shipped with tesseract.js) list the libraries
bundled inside those two files and their licences: the node `buffer` module (MIT), ieee754 (BSD-3-Clause),
regenerator-runtime (MIT) and zlib.js (MIT). The `/*! For license information… */` banner in each file points to them.

Three core builds are kept because the worker picks one by browser support (relaxed SIMD, SIMD, plain);
a phone downloads only one. Source-map comments were removed from the two `.min.js` files, since the maps
are not vendored. Upgrading: replace all files from matching versions (tesseract.js N needs core ^N),
then change `OCR_CACHE` in `sw.js` so phones fetch the new engine.
