# Reviewer Generator — Vercel Static Deployment

## Project structure

- `index.html` — website entry point
- `css/styles.css` — styles extracted from the original HTML
- `js/pdfjs-worker-bundle.js` — original PDF.js worker bundle
- `js/pdfjs-viewer-bundle.js` — original PDF.js library bundle
- `js/reviewer-generator.js` — reviewer-generation logic
- `js/pptx-reader.js` — PowerPoint text-reading logic
- `js/app.js` — interface and application behavior

## Deploy to Vercel

1. Upload the contents of this folder to the **root** of your GitHub repository.
2. Confirm `index.html` is at the repository root beside the `css` and `js` folders.
3. In Vercel, select **Framework Preset: Other**.
4. Set **Root Directory** to `./`.
5. Leave **Build Command** and **Install Command** empty.
6. Set **Output Directory** to `.` and deploy.

This is a static HTML/CSS/JavaScript project; no build step is required.

## Notes

The original CSS and JavaScript code are preserved and separated into files. File references were checked for existence, but the application has not been browser-tested in this generation step.
