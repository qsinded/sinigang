# Reviewer Generator — Vercel Static Deployment

## Project structure

- `index.html` — website entry point
- `css/styles.css` — styles extracted from the original HTML
- `js/pdfjs-worker-bundle.js` — original PDF.js worker bundle
- `js/pdfjs-viewer-bundle.js` — original PDF.js library bundle
- `js/reviewer-generator.js` — reviewer-generation logic
- `js/pptx-reader.js` — PowerPoint text-reading logic
- `js/app.js` — interface and application behavior
- `tests/check.js` — run `node tests/check.js` to check the generator and the .ppt/.pptx/.docx readers

Supported input: PDF, PowerPoint (.pptx and old .ppt), Word (.docx) and text files. Old .doc must be saved as .docx or PDF first.
