// Run: node tests/app-smoke.js   (Node 18+)
// Boots js/app.js against a small DOM stub: storage cap, import guard, study plan, source lookup,
// diagram items and image storage, plus a render pass over the home, quiz and flashcard screens.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attrs = {};
    this.dataset = {};
    this.style = {};
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.files = [];
    this.tabIndex = 0;
    this.nodeType = 1;
  }
  append(...kids) { for (const k of kids) this.children.push(k && k.nodeType ? k : { nodeType: 3, textContent: String(k) }); }
  replaceChildren(...kids) { this.children = []; this.append(...kids); }
  appendChild(k) { this.append(k); }
  before() {}
  after() {}
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'value') this.value = String(v); if (k === 'checked') this.checked = true; }
  hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener() {}
  querySelector() { return new El('div'); }
  querySelectorAll() { return []; }
  focus() {}
  remove() {}
  click() {}
}

const appEl = new El('main');
const head = new El('head');
const scripts = [];
head.append = s => {
  scripts.push(s.src);
  // the viewer bundle is what defines the pdfjsLib global
  if (s.src.includes('viewer')) { ctx.pdfjsLib = { GlobalWorkerOptions: {} }; sandbox.pdfjsLib = ctx.pdfjsLib; }
  s.onload && s.onload();
};
const docEl = new El('html');
const document = {
  documentElement: docEl,
  head,
  body: new El('body'),
  title: '',
  getElementById: id => (id === 'app' ? appEl : null),
  createElement: tag => new El(tag),
  createTextNode: t => ({ nodeType: 3, textContent: String(t) }),
  querySelector: () => new El('div'),
  addEventListener: () => {}
};
const localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};
const sandbox = {
  document, localStorage, console,
  window: {},
  matchMedia: () => ({ matches: false }),
  scrollTo: () => {},
  scrollY: 0,
  // Scaled timers keep the recitation delays testable without waiting real seconds.
  setTimeout: (fn, ms) => setTimeout(fn, Math.max(1, Math.round((ms || 0) / 1000))),
  clearTimeout, setInterval, clearInterval,
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
  Blob: class {},
  Set, Map, Date, Math, JSON, Number, String, Object, Array, RegExp, Error
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
// One reviewer is already saved, so the home screen renders its plan and card.
const seed = {
  id: 1, title: 'Seeded notes', opts: {}, ans: {}, flashKnown: [], flashLearn: [],
  items: [{ id: 's1', type: 'id', q: 'What runs instructions?', answer: 'CPU', exp: '(page 1) The CPU runs instructions.' }],
  src: ['The CPU runs instructions.'], tags: ['page 1'], plan: { exam: '', srs: {} }
};
const store = new Map([['reviewer_gen_v1', JSON.stringify([seed])]]);
const ctx = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('js/reviewer-generator.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('js/pptx-reader.js', 'utf8'), ctx);
vm.runInContext(fs.readFileSync('js/app.js', 'utf8'), ctx, { filename: 'js/app.js' });

const screenText = el => el.children.map(c => (c.children ? screenText(c) : c.textContent)).join(' ');

// 1. the page booted and drew the home screen, including the study summary
assert.ok(appEl.children.length > 0, 'home screen rendered');
assert.match(screenText(appEl), /Today/, 'home shows the study summary');
assert.match(screenText(appEl), /Seeded notes/, 'saved reviewers are listed');

// 2. source text is capped before it is stored
const bulky = Array.from({ length: 2000 }, (_, i) => 'line ' + i + ' ' + 'x'.repeat(90));
const capped = ctx.capSrc(bulky);
const cappedChars = capped.join('\n').length;
assert.ok(cappedChars <= 40000 + 95, 'capped to ~40k chars, got ' + cappedChars);
assert.strictEqual(capped[0], bulky[0], 'keeps text from the start');

// 3. an imported backup cannot smuggle in an oversized source or a colliding id
const base = { title: 'Notes', opts: {}, items: ['a', 'b', 'c'].map((k, i) => ({ id: 'id' + i, type: 'id', q: 'q' + i, answer: k, exp: '' })) };
const imported = ctx.cleanReviewer({ ...base, src: bulky, tags: bulky.map(() => 'page 1') });
assert.strictEqual(imported.src.length, capped.length, 'imported source is capped');
assert.strictEqual(imported.tags.length, imported.src.length, 'tags stay aligned with the capped source');
const tooMany = ctx.cleanReviewer({ ...base, src: Array(20001).fill('x') });
assert.strictEqual(tooMany.src, undefined, 'absurd source arrays are dropped');
const ids = new Set([1, 2, 3, 4, 5].map(() => ctx.cleanReviewer(base).id));
assert.strictEqual(ids.size, 5, 'reviewer ids stay unique across quick imports');
assert.strictEqual(ctx.cleanReviewer({ ...base, items: base.items.slice(0, 2) }), null, 'reviewers under 3 items are rejected');

// 4. study plan: due counts, Leitner boxes and the exam countdown
const plus5 = new Date(); plus5.setDate(plus5.getDate() + 5);
const iso = plus5.getFullYear() + '-' + String(plus5.getMonth() + 1).padStart(2, '0') + '-' + String(plus5.getDate()).padStart(2, '0');
assert.strictEqual(ctx.examDaysLeft(iso), 5, 'exam countdown uses calendar days');
assert.strictEqual(ctx.examText(iso), 'exam in 5 days');
assert.strictEqual(ctx.examDaysLeft('2026-13-40'), null, 'impossible dates are ignored');
const planned = ctx.cleanReviewer({ ...base, plan: { exam: iso, srs: { id0: { box: 2, due: 1 }, ghost: { box: 1, due: 1 } } } });
assert.strictEqual(planned.plan.exam, iso);
assert.deepStrictEqual(Object.keys(planned.plan.srs), ['id0'], 'schedule entries for unknown items are dropped');
assert.strictEqual(ctx.dueCount(planned), 3, 'unseen and overdue items are due');
ctx.reviewItem(planned, 'id0', true);
assert.strictEqual(ctx.dueCount(planned), 2, 'a known item leaves today\'s queue');
ctx.reviewItem(planned, 'id1', false);
assert.strictEqual(ctx.dueCount(planned), 2, 'a missed item stays due');
assert.strictEqual(planned.plan.srs.id1.box, 0, 'a miss resets the box');
ctx.reviewItem(planned, 'id2', true);
assert.strictEqual(ctx.dueCount(planned), 1);

// 5. source lookup for the "Show in my notes" panel
const srcReviewer = { src: ['Intro line.', 'The CPU is the part of a computer that runs instructions.', 'RAM is short term memory.'], tags: ['page 1', 'page 2', 'page 2'] };
const srcItem = { type: 'id', q: 'Which term?', answer: 'CPU', exp: '(page 2) The CPU is the part of a computer that runs instructions.' };
const hit = ctx.sourceLine(srcReviewer, srcItem);
assert.strictEqual(hit.at, 1, 'source line is located by its saved sentence');
assert.strictEqual(hit.tag, 'page 2');
assert.strictEqual(ctx.sourceLine({ src: [], tags: [] }, srcItem), null, 'a reviewer without saved source is handled');
const marked = ctx.markLine(hit.text, 'CPU');
assert.strictEqual(marked.length, 3);
assert.strictEqual(marked[1].tagName, 'MARK');
assert.strictEqual(marked[1].children[0].textContent, 'CPU');

// 6. the quiz and flashcard screens render and record answers
const live = ctx.cleanReviewer({ ...base, src: srcReviewer.src, tags: srcReviewer.tags, plan: { exam: '', srs: {} } });
ctx.open(live);
assert.match(screenText(appEl), /Exam date/, 'quiz screen offers an exam date');
const find = (el, pred, out = []) => { if (pred(el)) out.push(el); for (const c of el.children) if (c.children) find(c, pred, out); return out; };
const dateInput = find(appEl, e => e.tagName === 'INPUT' && e.attrs.type === 'date')[0];
assert.ok(dateInput, 'the date field is rendered');
dateInput.onchange({ target: { value: iso } });
assert.strictEqual(live.plan.exam, iso, 'the chosen exam date is saved');
assert.match(screenText(appEl), /exam in 5 days/, 'the countdown appears');
ctx.answer(live.items[0], 'a');
assert.ok(live.ans.id0, 'an answer is recorded');
assert.ok(live.plan.srs.id0, 'an answer enters the study schedule');
assert.match(screenText(appEl), /Show in my notes/, 'answered items offer the source panel');
ctx.startFlash('due');
assert.match(screenText(appEl), /FLASHCARDS/, 'the due session opens flashcards');

// 7. oral recitation wording and the graceful no-voice fallback
assert.strictEqual(ctx.reciteAnswer({ type: 'id', answer: 'CPU' }), 'The answer is CPU.');
assert.strictEqual(ctx.reciteAnswer({ type: 'mc', options: ['CPU', 'RAM'], answer: 1 }), 'The answer is B: RAM.');
assert.strictEqual(ctx.reciteAnswer({ type: 'enum', items: ['CPU', 'RAM'] }), 'The answers are: CPU, RAM.');
assert.match(ctx.reciteQuestion({ type: 'mc', q: 'Which one?', options: ['CPU', 'RAM'], answer: 0 }), /Options: A\. CPU\. B\. RAM\./);
assert.match(ctx.reciteQuestion({ type: 'id', q: 'Fill in the blank: ____', answer: 'CPU' }), /blank/);
assert.strictEqual(ctx.ttsReady(), false, 'the stub has no speech voice');
ctx.openRecite();
assert.match(screenText(appEl), /ORAL RECITATION/, 'recitation screen renders');
assert.match(screenText(appEl), /no speech voice/, 'a browser without speech is told plainly');

(async () => {
  // 8. the recitation sequence reads question then answer for every item
  const spoken = [];
  sandbox.speechSynthesis = {
    getVoices: () => [],
    cancel() {},
    speak(u) { spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 1); }
  };
  sandbox.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  assert.strictEqual(ctx.ttsReady(), true, 'a voice is now available');
  await ctx.playFrom(0);
  assert.deepStrictEqual(spoken, ['q0', 'The answer is a.', 'q1', 'The answer is b.', 'q2', 'The answer is c.'], 'question and answer are read in order');
  assert.match(screenText(appEl), /Finished/, 'the session ends on the finished state');

  // 8. image storage, diagrams: validation, backup envelope, setup and quiz rendering
  function fakeIndexedDB() {
    const data = new Map();
    return {
      open() {
        const db = {
          objectStoreNames: { contains: () => true },
          transaction() {
            const tx = { oncomplete: null, onerror: null, onabort: null };
            tx.objectStore = () => ({
              put(value, key) { data.set(key, value); return { result: key }; },
              get(key) { return { result: data.get(key) }; },
              delete(key) { data.delete(key); return { result: undefined }; }
            });
            setTimeout(() => tx.oncomplete && tx.oncomplete(), 3);
            return tx;
          }
        };
        const req = { result: db, onupgradeneeded: null, onsuccess: null, onerror: null };
        setTimeout(() => req.onsuccess && req.onsuccess(), 1);
        return req;
      }
    };
  }
  sandbox.indexedDB = fakeIndexedDB();
  sandbox.Blob = class { constructor(parts, opts) { this.parts = parts; this.type = (opts && opts.type) || ''; } };
  const demoBlob = new sandbox.Blob(['pixels'], { type: 'image/png' });
  await ctx.idbPut('img_demo', demoBlob);
  assert.strictEqual(await ctx.idbGet('img_demo'), demoBlob, 'an image round-trips through storage');
  assert.strictEqual(await ctx.imageURL('img_demo'), 'blob:x', 'the stored image becomes an object URL');
  assert.strictEqual(await ctx.imageURL('img_demo'), 'blob:x', 'the object URL is reused');
  await ctx.dropImage('img_demo');
  assert.strictEqual(await ctx.idbGet('img_demo'), undefined, 'deleting a reviewer removes its image');
  const imgItem = (i, name) => ({ id: 'img' + i, type: 'img', q: 'Identify the part marked on the diagram.', answer: name, imageId: 'img_demo', hotspot: { x: 0.3, y: 0.4 }, exp: '' });
  const imgReviewer = ctx.cleanReviewer({ title: 'Heart', opts: {}, items: [imgItem(0, 'Right atrium'), imgItem(1, 'Left ventricle'), imgItem(2, 'Aorta')] });
  assert.ok(imgReviewer && imgReviewer.items.every(i => i.type === 'img'), 'diagram items survive validation');
  assert.strictEqual(ctx.cleanItem({ ...imgItem(0, 'X'), hotspot: { x: 2, y: 0 } }), null, 'a hotspot outside the image is rejected');
  assert.strictEqual(ctx.cleanItem({ ...imgItem(0, 'X'), imageId: '' }), null, 'an image id is required');
  assert.strictEqual(ctx.flashAnswer(imgReviewer.items[0]), 'Right atrium');
  assert.strictEqual(ctx.reciteAnswer(imgReviewer.items[0]), 'The answer is Right atrium.');
  assert.match(ctx.reciteQuestion(imgReviewer.items[0]), /Look at the diagram/);
  const restored = ctx.cleanBackup({ version: 2, reviewers: [imgReviewer], images: { img_demo: { data: 'data:image/png;base64,AAAA' }, bad: { data: 'https://example.com/x.png' } } });
  assert.strictEqual(restored.reviewers.length, 1);
  assert.deepStrictEqual(Object.keys(restored.images), ['img_demo'], 'only real image payloads are restored');
  const oldBackup = ctx.cleanBackup([imgReviewer]);
  assert.strictEqual(oldBackup.reviewers.length, 1, 'old array backups still import');
  assert.strictEqual(Object.keys(oldBackup.images).length, 0, 'no images in an old backup');
  ctx.clearDiagram();
  ctx.diagramSetup();
  assert.match(screenText(appEl), /Diagram reviewer/, 'the diagram setup screen renders');
  assert.match(screenText(appEl), /No image chosen/, 'it asks for an image first');
  await ctx.idbPut('img_demo', new sandbox.Blob(['pixels'], { type: 'image/png' }));
  ctx.open(imgReviewer);
  assert.match(screenText(appEl), /Identify the part marked/, 'a diagram question renders');
  await new Promise(resolve => setTimeout(resolve, 15));
  const diagramImgs = find(appEl, e => e.tagName === 'IMG');
  assert.ok(diagramImgs.length > 0, 'the image element is present');
  assert.strictEqual(diagramImgs[0].src, 'blob:x', 'the stored diagram is shown on the question');

  // 9. PDF.js is fetched on demand, in worker-before-viewer order, and only once
  assert.deepStrictEqual(scripts, [], 'nothing loaded at boot');
  const p1 = ctx.loadPdfjs();
  ctx.loadPdfjs();
  const lib = await p1;
  assert.strictEqual(lib, ctx.pdfjsLib, 'resolves to the PDF.js namespace');
  assert.strictEqual(ctx.pdfjsLib.GlobalWorkerOptions.workerSrc, './js/pdfjs-worker-bundle.js');
  assert.deepStrictEqual(scripts, ['./js/pdfjs-worker-bundle.js', './js/pdfjs-viewer-bundle.js'], 'loads both bundles in order, once');

  console.log('app smoke checks passed');
})().catch(e => { console.error(e); process.exit(1); });
