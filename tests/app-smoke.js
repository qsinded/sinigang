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
const keyHandlers = [];
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
  // The app's global key handler is kept so tests can press number keys on the quiz screen.
  addEventListener: (type, fn) => { if (type === 'keydown') keyHandlers.push(fn); }
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

// 1b. Today card: one button across reviewers, and a day streak
assert.match(screenText(appEl), /Study today \(1 due\)/, 'home offers one study button with the due count');
assert.match(screenText(appEl), /Start a streak today/, 'no streak before any study');
assert.strictEqual(JSON.stringify(ctx.streakAfter(null, 100)), JSON.stringify({ last: 100, count: 1 }), 'first study day starts a streak');
assert.strictEqual(JSON.stringify(ctx.streakAfter({ last: 100, count: 1 }, 100)), JSON.stringify({ last: 100, count: 1 }), 'same day does not double count');
assert.strictEqual(JSON.stringify(ctx.streakAfter({ last: 100, count: 3 }, 101)), JSON.stringify({ last: 101, count: 4 }), 'next day extends the streak');
assert.strictEqual(JSON.stringify(ctx.streakAfter({ last: 100, count: 3 }, 103)), JSON.stringify({ last: 103, count: 1 }), 'a missed day restarts it');
assert.strictEqual(ctx.streakNow({ last: 100, count: 3 }, 101), 3, 'streak survives until the end of the next day');
assert.strictEqual(ctx.streakNow({ last: 100, count: 3 }, 102), 0, 'streak is gone after a missed day');
assert.strictEqual(ctx.streakNow(null, 100), 0, 'no saved streak reads as zero');
store.set('reviewer_gen_streak', '{bad json');
assert.strictEqual(ctx.readStreak(), null, 'a corrupt streak is ignored');
ctx.reviewItem(vm.runInContext('R[0]', ctx), 's1', true);
assert.strictEqual(ctx.readStreak().count, 1, 'grading an item records today');
assert.strictEqual(ctx.readStreak().last, ctx.todayNumber(), 'the streak is dated today');
ctx.home();
assert.match(screenText(appEl), /1-day streak/, 'home shows the streak after studying');
assert.doesNotMatch(screenText(appEl), /Study today/, 'no study button once nothing is due');

// 1d. the tab title never repeats the app name, and the on-page confirm replaces confirm()/prompt()
assert.strictEqual(ctx.pageTitle('SINEGENG'), 'SINEGENG');
assert.strictEqual(ctx.pageTitle('notes'), 'notes · SINEGENG');
assert.strictEqual(ctx.pageTitle(''), 'SINEGENG');
const clickIn = (el, label) => { const f = n => n.onclick && (n.children || []).some(c => c.textContent === label) ? n : (n.children || []).map(f).find(Boolean); return f(el); };
(async () => {
  const yes = ctx.ask('Delete?', 'Delete'), box = document.body.children[document.body.children.length - 1];
  assert.strictEqual(box.className, 'veil', 'the box is on the page');
  clickIn(box, 'Delete').onclick();
  assert.strictEqual(await yes, true, 'the confirm button answers yes');
  const no = ctx.ask('Delete?', 'Delete'), box2 = document.body.children[document.body.children.length - 1];
  clickIn(box2, 'Cancel').onclick();
  assert.strictEqual(await no, false, 'Cancel answers no');
  const text = ctx.askText('New title', 'Old'), box3 = document.body.children[document.body.children.length - 1];
  clickIn(box3, 'Cancel').onclick();
  assert.strictEqual(await text, null, 'Cancel gives no text');
})().catch(e => { console.error(e); process.exit(1); });

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
// A true/false answer must never be looked up as text: "TRUE" sits in the exam's "Write TRUE if..." direction.
const examSrc = { src: ['C. Data Bus', 'II. Write TRUE if the statement is correct and FALSE if it is incorrect.', 'You cannot POP directly into an', 'immediate value (constants) in this machine.'], tags: [] };
const tfItem = { type: 'mc', q: 'True or false: You cannot POP directly into an immediate value (constants) in this machine.', options: ['True', 'False'], answer: 0, exp: 'You cannot POP directly into an immediate value (constants) in this machine.' };
assert.ok(ctx.sourceLine(examSrc, tfItem).at >= 2, 'a true/false item finds its own sentence, not the direction');
assert.strictEqual(ctx.sourceLine({ src: examSrc.src.slice(0, 2), tags: [] }, tfItem), null, 'no match is better than the exam direction');
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
  const masks = [{ x: 0.01, y: 0.1, w: 0.2, h: 0.08 }, { x: 2, y: 0, w: 0.1, h: 0.1 }, { x: 0.1, y: 0.1, w: 0, h: 0.1 }];
  const imgReviewer = ctx.cleanReviewer({ title: 'Heart', masks, opts: {}, items: [imgItem(0, 'Right atrium'), imgItem(1, 'Left ventricle'), imgItem(2, 'Aorta')] });
  assert.ok(imgReviewer && imgReviewer.items.every(i => i.type === 'img'), 'diagram items survive validation');
  // Objects built inside the VM have a different prototype, so compare their JSON form.
  const plain = v => JSON.parse(JSON.stringify(v));
  assert.deepStrictEqual(plain(imgReviewer.masks), [{ x: 0.01, y: 0.1, w: 0.2, h: 0.08 }], 'valid label covers survive validation and broken ones are dropped');
  // Covers are normalized boxes: a pointer and a drag must mean the same thing at any display size.
  assert.deepStrictEqual(plain(ctx.pointInRect(50, 25, { left: 0, top: 0, width: 100, height: 100 })), { x: 0.5, y: 0.25 }, 'a pointer becomes a fraction of the image');
  assert.strictEqual(ctx.pointInRect(0, 0, { left: 0, top: 0, width: 0, height: 10 }), null, 'no point without a rendered image');
  // Found text becomes covers: Tesseract line boxes in pixels -> padded fractions of the picture.
  const L = (text, confidence, x0, y0, x1, y1) => ({ text, confidence, bbox: { x0, y0, x1, y1 } });
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const lineCovers = plain(ctx.labelCovers([L('Aorta', 91, 100, 50, 200, 70), L('|', 95, 10, 10, 12, 60), L('Left atrium', 59, 300, 300, 400, 320), L('—', 80, 0, 0, 50, 2)], 1000, 500, []));
  assert.strictEqual(lineCovers.length, 1, 'only a confident line with letters becomes a cover');
  assert.ok(near(lineCovers[0].x, 0.095) && near(lineCovers[0].y, 0.095) && near(lineCovers[0].w, 0.11) && near(lineCovers[0].h, 0.05), 'the box is a padded fraction of the picture');
  assert.strictEqual(ctx.labelCovers([L('RA', 60, 100, 100, 130, 120)], 1000, 500, []).length, 1, 'a two-letter label at the threshold counts');
  const edge = plain(ctx.labelCovers([L('Top', 90, 0, 0, 100, 20)], 1000, 500, []))[0];
  assert.ok(edge.x === 0 && edge.y === 0, 'a box at the edge is clamped to the picture');
  assert.strictEqual(ctx.labelCovers([L('Left', 90, 100, 100, 160, 120), L('ventricle', 90, 158, 100, 260, 120)], 1000, 500, []).length, 1, 'touching boxes merge into one cover');
  assert.strictEqual(ctx.labelCovers([L('Aorta', 91, 100, 50, 200, 70)], 1000, 500, lineCovers).length, 0, 'a label already covered is not covered twice');
  assert.strictEqual(ctx.labelCovers([L('Atrium', 90, 100, 100, 160, 120), L('Valve', 90, 164, 124, 220, 144)], 1000, 500, []).length, 2, 'labels on different lines that touch at a corner stay separate, so the drawing between them is not hidden');
  assert.match(ctx.labelStatusText({ masks: new Array(61).fill({ x: 0, y: 0, w: 0.1, h: 0.1 }) }), /first 60/, 'more labels than a reviewer can hold is said, not silently cut');
  assert.strictEqual(ctx.cleanMasks(Array.from({ length: 61 }, (_, i) => ({ x: 0, y: i / 100, w: 0.1, h: 0.01 }))).length, 60, 'a reviewer keeps up to 60 covers');
  // The label finder. Tesseract is injected, so the real 7 MB engine never loads in tests.
  const fakeT = { terminated: 0, opts: null, gate: Promise.resolve(), lines: [L('Aorta', 91, 100, 50, 200, 70)], createWorker: async (lang, oem, opts) => {
    fakeT.opts = opts; opts.logger({ status: 'recognizing text', progress: 0.5 });
    return { recognize: async () => { await fakeT.gate; return { data: { blocks: [{ paragraphs: [{ lines: fakeT.lines.map(l => ({ ...l, words: l.words || [l] })) }] }] } }; }, terminate: async () => { fakeT.terminated++; } };
  } };
  ctx.location = { href: 'https://example.com/app/', hash: '' };
  ctx.imageSize = async () => ({ width: 1000, height: 500 });
  const realLoad = ctx.loadTesseract;
  ctx.loadTesseract = async () => fakeT;
  const progress = [];
  const labels = plain(await ctx.findLabels(new sandbox.Blob(), [], p => progress.push(p)));
  assert.strictEqual(labels.length, 1, 'findLabels turns the text it reads into covers');
  // Seen in Chrome: a leader line touching a label is read as a backslash and joined to it, and the whole
  // line's confidence drops to 44. Words keep their own boxes and confidence, so the label is still covered.
  const leader = { ...L('\\ Nucleus', 44, 224, 81, 813, 201), words: [L('\\', 30, 224, 150, 300, 201), L('Nucleus', 93, 720, 100, 813, 125)] };
  fakeT.lines = [leader];
  const nucleus = plain(await ctx.findLabels(new sandbox.Blob(), [], () => {}));
  assert.ok(nucleus.length === 1 && near(nucleus[0].x, 0.715) && nucleus[0].w < 0.12, 'a label read together with its leader line is still covered, tightly');
  fakeT.lines = [L('Aorta', 91, 100, 50, 200, 70)];
  assert.strictEqual(fakeT.terminated, 2, 'the reader is shut down after each of the two searches');
  assert.ok(progress.includes(0.5), 'progress is reported');
  assert.strictEqual(fakeT.opts.corePath, 'https://example.com/app/vendor/tesseract', 'the engine comes from this app, never a CDN');
  assert.ok(fakeT.opts.workerBlobURL === false && fakeT.opts.cacheMethod === 'none', 'the worker goes through the service worker, with no second copy in IndexedDB');
  await assert.rejects(realLoad(), /label finder/, 'a failed download says so');
  assert.ok(scripts.includes('./vendor/tesseract/tesseract.min.js'), 'the engine script is loaded from vendor/tesseract');
  scripts.splice(scripts.indexOf('./vendor/tesseract/tesseract.min.js'), 1); // the PDF.js check below expects a clean list
  ctx.Tesseract = fakeT;
  assert.strictEqual(await realLoad(), fakeT, 'a failed load is tried again next time');
  delete ctx.Tesseract;
  ctx.setOcrConsent('no');
  assert.strictEqual(ctx.ocrConsent(), 'no', 'the answer to the download question is remembered');
  ctx.Worker = function Worker() {};
  ctx.navigator = { serviceWorker: { controller: null } };
  assert.strictEqual(ctx.ocrSupported(), false, 'not offered without the service worker, which keeps the download');
  ctx.navigator.serviceWorker.controller = {};
  vm.runInContext('var __wasm = WebAssembly; WebAssembly = undefined;', ctx);
  assert.strictEqual(ctx.ocrSupported(), false, 'not offered with WebAssembly switched off: it would download 7 MB and then fail');
  vm.runInContext('WebAssembly = __wasm;', ctx);
  assert.strictEqual(ctx.ocrSupported(), true, 'offered with a Worker and the service worker');
  const realSetItem = localStorage.setItem;
  localStorage.setItem = () => { throw new Error('storage blocked'); };
  ctx.setOcrConsent('yes');
  assert.strictEqual(ctx.ocrConsent(), 'yes', 'with storage blocked the answer is kept for this visit, so the question does not stick');
  localStorage.setItem = realSetItem;
  ctx.setOcrConsent('no');
  assert.strictEqual(ctx.ocrConsent(), 'no', 'a stored answer wins again once storage works');
  assert.deepStrictEqual(plain(ctx.boxFromPoints({ x: 0.75, y: 0.75 }, { x: 0.25, y: 0.25 })), { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, 'a drag becomes a box in any direction');
  assert.strictEqual(ctx.boxFromPoints({ x: 0.5, y: 0.5 }, { x: 0.505, y: 0.5 }), null, 'a stray tap does not leave a sliver');
  assert.deepStrictEqual(plain(ctx.moveBox({ x: 0.7, y: 0.7, w: 0.2, h: 0.2 }, 0.5, 0)), { x: 0.8, y: 0.7, w: 0.2, h: 0.2 }, 'moving a cover keeps it inside the image');
  assert.deepStrictEqual(plain(ctx.resizeBox({ x: 0.5, y: 0.5, w: 0.2, h: 0.2 }, 0.5, 0.5)), { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, 'resizing a cover stops at the edge');
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
  assert.deepStrictEqual(plain(oldBackup.reviewers[0].masks), plain(imgReviewer.masks), 'label covers survive export and import');
  assert.deepStrictEqual(plain(ctx.applyCovers(imgReviewer, [{ x: 0.7, y: 0.2, w: 0.2, h: 0.1 }, { x: 0, y: 0, w: 1, h: 1 }])), [{ x: 0.7, y: 0.2, w: 0.2, h: 0.1 }, { x: 0, y: 0, w: 1, h: 1 }], 'saving covers updates the reviewer in place');
  ctx.clearDiagram();
  ctx.diagramSetup();
  assert.match(screenText(appEl), /Diagram reviewer/, 'the diagram setup screen renders');
  assert.match(screenText(appEl), /No image chosen/, 'it asks for an image first');
  await ctx.idbPut('img_demo', new sandbox.Blob(['pixels'], { type: 'image/png' }));
  const bare = ctx.cleanReviewer({ title: 'Bare heart', items: [imgItem(0, 'A'), imgItem(1, 'B'), imgItem(2, 'C')] });
  ctx.open(bare);
  assert.match(screenText(appEl), /give the answer away/, 'practice points out printed labels when none are covered');
  assert.match(screenText(appEl), /Hide printed labels/, 'the cover editor is offered right where the labels are seen');
  ctx.open(imgReviewer);
  assert.match(screenText(appEl), /Identify the part marked/, 'a diagram question renders');
  await new Promise(resolve => setTimeout(resolve, 15));
  const diagramImgs = find(appEl, e => e.tagName === 'IMG');
  assert.ok(diagramImgs.length > 0, 'the image element is present');
  assert.strictEqual(diagramImgs[0].src, 'blob:x', 'the stored diagram is shown on the question');
  const coverEls = find(appEl, e => String(e.className).split(' ')[0] === 'cover');
  assert.strictEqual(coverEls.length, imgReviewer.items.length * imgReviewer.masks.length, 'every saved cover is drawn over every diagram question');
  assert.strictEqual(coverEls[0].textContent, '', 'a cover hides text without adding any');
  // Every session asks the parts in a new order, so the pin's position is not what gets memorised.
  const six = ctx.cleanReviewer({ title: 'Cell', items: ['A', 'B', 'C', 'D', 'E', 'F'].map((n, i) => imgItem(i, n)) });
  six.ans = { img2: { ok: true, val: 'C', exp: 'C' } };
  const firsts = new Set();
  for (let k = 0; k < 30; k++) { ctx.open(six); firsts.add(six.items[0].id); }
  assert.ok(firsts.size > 1, 'opening a diagram reviewer changes which part comes first');
  assert.deepStrictEqual(six.items.map(i => i.id).sort(), ['img0', 'img1', 'img2', 'img3', 'img4', 'img5'], 'the new order holds the same parts');
  assert.ok(six.ans.img2 && six.ans.img2.ok, 'answers are keyed by id, so the new order keeps them');
  // Markers: a button you can place, nudge, drag and delete without a pointer.
  assert.deepStrictEqual(plain(ctx.nudgeHotspot({ x: 0.995, y: 0.01 }, 0.02, -0.02)), { x: 1, y: 0 }, 'a nudge stays inside the image');
  ctx.clearDiagram();
  vm.runInContext("diagURL = 'blob:x'; diagBlob = new Blob();", ctx);
  ctx.diagramSetup();
  const state = js => plain(vm.runInContext(js, ctx));
  const pinBtns = () => find(appEl, e => e.tagName === 'BUTTON' && String(e.className).split(' ').includes('pin'));
  const pendingPin = () => pinBtns().find(e => e.className.includes('pending'));
  const press = (el, key, shiftKey = false) => el.onkeydown({ key, shiftKey, preventDefault() {} });
  const placeBtn = () => find(appEl, e => e.tagName === 'BUTTON' && /Place a marker/.test(screenText(e)))[0];
  assert.ok(placeBtn(), 'a keyboard user can place a marker without tapping the image');
  placeBtn().onclick();
  assert.deepStrictEqual(state('diagPending'), { x: 0.5, y: 0.5 }, 'the marker starts at the centre');
  assert.match(pendingPin().attrs['aria-label'], /Arrow keys move it/, 'the new marker is a labelled button');
  press(pendingPin(), 'ArrowRight', true);
  press(pendingPin(), 'ArrowDown');
  assert.ok(Math.abs(state('diagPending.x') - 0.52) < 1e-9 && Math.abs(state('diagPending.y') - 0.505) < 1e-9, 'arrows nudge the marker, Shift for bigger steps');
  press(pendingPin(), 'Escape');
  assert.strictEqual(state('diagPending'), null, 'Escape takes the new marker away');
  for (const name of ['Nucleus', 'Ribosome', 'Vacuole']) {
    placeBtn().onclick();
    press(pendingPin(), 'ArrowLeft');
    find(appEl, e => e.attrs && e.attrs.id === 'part-name')[0].oninput({ target: { value: name } });
    ctx.addPart();
  }
  assert.deepStrictEqual(state('diagParts.map(p => p.name)'), ['Nucleus', 'Ribosome', 'Vacuole'], 'three parts labeled with the keyboard only');
  const createBtn = find(appEl, e => e.tagName === 'BUTTON' && /Create diagram reviewer/.test(screenText(e)))[0];
  assert.strictEqual(createBtn.attrs.disabled, undefined, 'the keyboard-made parts are enough to create the reviewer');
  const firstName = () => find(appEl, e => e.tagName === 'INPUT' && e.attrs['aria-label'] === 'Name of part 1')[0];
  firstName().oninput({ target: { value: 'ribosome ' } });
  const shelfBefore = vm.runInContext('R.length', ctx);
  await ctx.createDiagram();
  assert.ok(/same name/.test(state('diagErr')) && vm.runInContext('R.length', ctx) === shelfBefore, 'a part renamed to a twin is caught before saving');
  firstName().oninput({ target: { value: 'Nucleus' } });
  const placed = () => pinBtns().filter(e => !e.className.includes('pending'));
  assert.strictEqual(placed().length, 3, 'every labeled part has a marker button');
  const y0 = state('diagParts[0].y');
  press(placed()[0], 'ArrowUp');
  assert.ok(state('diagParts[0].y') < y0 && state('diagParts[1].y') === 0.5, 'arrows move only the focused part');
  const editorImg = find(appEl, e => e.tagName === 'IMG')[0];
  editorImg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 });
  const drag = (x, y) => ({ button: 0, pointerId: 1, clientX: x, clientY: y, currentTarget: placed()[1], preventDefault() {} });
  const dragged = placed()[1];
  dragged.onpointerdown(drag(100, 50)); dragged.onpointermove(drag(160, 20)); dragged.onpointerup(drag(160, 20));
  assert.deepStrictEqual(state('diagParts[1]'), { x: 0.8, y: 0.2, name: 'Ribosome' }, 'dragging a marker moves its part');
  assert.strictEqual(state('diagPending'), null, 'a drag does not place a second marker');
  press(placed()[2], 'Delete');
  assert.deepStrictEqual(state('diagParts.map(p => p.name)'), ['Nucleus', 'Ribosome'], 'Delete removes the focused part');
  ctx.clearDiagram();
  // Edit a saved diagram reviewer in place: same reviewer, same ids, only the changed parts lose progress.
  const ed = ctx.cleanReviewer({ title: 'Heart', items: [imgItem(0, 'Right atrium'), imgItem(1, 'Left ventrcle'), imgItem(2, 'Aorta'), imgItem(3, 'Vena cava')] });
  const graded = ok => ({ ok, val: 'x', exp: 'x' });
  ed.ans = { img0: graded(true), img1: graded(false), img3: graded(true) };
  ed.plan.srs = { img0: { box: 2, due: 1 }, img1: { box: 1, due: 1 }, img3: { box: 1, due: 1 } };
  ed.flashKnown = ['img3']; ed.flashLearn = ['img3']; ed.flags = ['img3'];
  const shelf = vm.runInContext('R', ctx); shelf.unshift(ed);
  const shelfSize = shelf.length;
  const revoked = []; ctx.URL.revokeObjectURL = u => revoked.push(u);
  ctx.open(ed);
  const editBtn = find(appEl, e => e.tagName === 'BUTTON' && screenText(e) === 'Edit parts')[0];
  assert.ok(editBtn, 'a saved diagram reviewer offers Edit parts');
  await editBtn.onclick();
  assert.match(screenText(appEl), /Edit diagram reviewer/, 'the editor opens on the saved reviewer');
  assert.strictEqual(state('diagURL'), 'blob:x', 'it shows the stored image');
  assert.deepStrictEqual(state('diagParts.map(p => p.name).sort()'), ['Aorta', 'Left ventrcle', 'Right atrium', 'Vena cava'], 'it loads every saved part');
  const partNamed = n => state('diagParts.findIndex(p => p.name === ' + JSON.stringify(n) + ')');
  const nameInput = i => find(appEl, e => e.tagName === 'INPUT' && e.attrs['aria-label'] === 'Name of part ' + (i + 1))[0];
  nameInput(partNamed('Left ventrcle')).oninput({ target: { value: 'Left ventricle' } });
  const x0 = state('diagParts[' + partNamed('Right atrium') + '].x');
  press(placed()[partNamed('Right atrium')], 'ArrowRight', true);
  press(placed()[partNamed('Vena cava')], 'Delete');
  placeBtn().onclick();
  find(appEl, e => e.attrs && e.attrs.id === 'part-name')[0].oninput({ target: { value: 'Pulmonary artery' } });
  ctx.addPart();
  find(appEl, e => e.tagName === 'INPUT' && e.attrs['aria-label'] === 'Reviewer title')[0].oninput({ target: { value: 'Parts of the heart' } });
  const saveEdit = find(appEl, e => e.tagName === 'BUTTON' && screenText(e) === 'Save changes')[0];
  assert.ok(saveEdit && saveEdit.attrs.disabled === undefined, 'the edit can be saved');
  await saveEdit.onclick();
  assert.strictEqual(shelf.length, shelfSize, 'saving an edit does not make a second reviewer');
  assert.strictEqual(shelf[0], ed, 'the same reviewer is updated');
  assert.strictEqual(ed.title, 'Parts of the heart', 'the title changes');
  const byName = n => ed.items.find(i => i.answer === n);
  assert.strictEqual(byName('Right atrium').id, 'img0', 'a moved part keeps its id');
  assert.ok(byName('Right atrium').hotspot.x > x0, 'and its new position');
  assert.ok(ed.ans.img0 && ed.plan.srs.img0.box === 2, 'and its progress');
  assert.strictEqual(byName('Left ventricle').id, 'img1', 'a renamed part keeps its id');
  assert.ok(!ed.ans.img1 && ed.plan.srs.img1, 'a renamed part keeps its schedule but not the answer graded against the old name');
  assert.ok(!ed.items.some(i => i.id === 'img3'), 'a removed part leaves the reviewer');
  assert.ok(!ed.ans.img3 && !ed.plan.srs.img3 && !ed.flashKnown.includes('img3') && !ed.flashLearn.includes('img3') && !ed.flags.includes('img3'), 'and its progress is pruned');
  assert.ok((ed.removed || []).some(i => i.id === 'img3'), 'and it can be restored from Removed questions');
  const added = byName('Pulmonary artery');
  assert.ok(added && !/^img\d$/.test(added.id) && added.imageId === 'img_demo', 'a new part gets a fresh id and the same image');
  assert.strictEqual(new Set(ed.items.map(i => i.id)).size, ed.items.length, 'ids stay unique');
  assert.ok(ed.items.every(i => ctx.cleanItem(plain(i))), 'edited parts pass validation');
  assert.deepStrictEqual(plain(ctx.cleanReviewer(plain(ed)).items.map(i => i.answer).sort()), plain(ed.items.map(i => i.answer).sort()), 'the edited reviewer survives export and import');
  // Remove a part and add it back in one edit: the re-added part must survive Shuffle.
  await ctx.editDiagram(ed);
  press(placed()[partNamed('Aorta')], 'Delete');
  placeBtn().onclick();
  find(appEl, e => e.attrs && e.attrs.id === 'part-name')[0].oninput({ target: { value: 'Aorta' } });
  ctx.addPart();
  await ctx.createDiagram();
  ctx.shuffleAll();
  assert.ok(ed.items.some(i => i.answer === 'Aorta'), 'a part added back after removing it survives Shuffle');
  await ctx.editDiagram(ed);
  nameInput(0).oninput({ target: { value: 'Typo' } });
  find(appEl, e => e.tagName === 'BUTTON' && /Cancel/.test(screenText(e)))[0].onclick();
  assert.ok(!ed.items.some(i => i.answer === 'Typo'), 'leaving the editor without saving changes nothing');
  assert.deepStrictEqual(revoked, [], 'the editor never revokes the image the reviewer still shows');
  // Swap the picture while editing: parts, pins and progress stay; the old image goes once unused.
  ctx.prepareImage = async () => ({ blob: new sandbox.Blob(['new pixels'], { type: 'image/webp' }), url: 'blob:new' });
  await ctx.editDiagram(ed);
  const replaceInput = find(appEl, e => e.tagName === 'INPUT' && e.attrs.type === 'file')[0];
  assert.ok(replaceInput && /Replace/.test(replaceInput.attrs['aria-label']), 'the editor offers to replace the picture');
  const partsBefore = state('diagParts');
  await ctx.pickDiagram({ name: 'heart-2.webp', type: 'image/webp' });
  assert.deepStrictEqual(state('diagParts'), partsBefore, 'a new picture keeps every part and pin');
  assert.strictEqual(state('diagURL'), 'blob:new', 'the new picture is shown');
  find(appEl, e => e.tagName === 'BUTTON' && /Cancel/.test(screenText(e)))[0].onclick();
  assert.ok(revoked.includes('blob:new') && !revoked.includes('blob:x'), 'cancelling frees the new picture but not the saved one');
  assert.ok(ed.items.every(i => i.imageId === 'img_demo'), 'cancelling keeps the old picture');
  await ctx.editDiagram(ed);
  await ctx.pickDiagram({ name: 'heart-2.webp', type: 'image/webp' });
  await find(appEl, e => e.tagName === 'BUTTON' && screenText(e) === 'Save changes')[0].onclick();
  const newImage = ed.items[0].imageId;
  assert.ok(newImage !== 'img_demo' && [...ed.items, ...ed.removed].every(i => i.imageId === newImage), 'every part, removed ones too, moves to the new picture');
  assert.ok(await ctx.idbGet(newImage), 'the new picture is stored');
  assert.strictEqual(await ctx.idbGet('img_demo'), undefined, 'the old picture is deleted once nothing uses it');
  assert.ok(ed.ans.img0 && ed.plan.srs.img0.box === 2, 'progress survives a new picture');
  assert.strictEqual(shelf.length, shelfSize, 'still one reviewer');
  await ctx.idbPut('img_demo', new sandbox.Blob(['pixels'], { type: 'image/png' })); // later checks use it
  await ctx.editDiagram(ed);
  press(placed()[0], 'Delete'); press(placed()[0], 'Delete');
  assert.strictEqual(find(appEl, e => e.tagName === 'BUTTON' && screenText(e) === 'Save changes')[0].attrs.disabled, '', 'an edit needs at least 3 parts too');
  ctx.clearDiagram();
  shelf.shift();
  // Choice mode: answer a diagram part by picking from the picture's own labels.
  const sixParts = () => six.items.filter(i => i.type === 'img');
  const opts0 = ctx.diagramChoices(six, sixParts()[0]);
  assert.strictEqual(new Set(opts0).size, 4, 'four different labels to choose from');
  assert.ok(opts0.includes(sixParts()[0].answer), 'one of them is the answer');
  assert.deepStrictEqual(plain(ctx.diagramChoices(six, sixParts()[0])), plain(opts0), 'the same part gets the same options every time');
  const three = ctx.cleanReviewer({ title: 'Three', items: [imgItem(0, 'A'), imgItem(1, 'B'), imgItem(2, 'C')] });
  assert.strictEqual(ctx.diagramChoices(three, three.items[0]).length, 3, 'three labels give three options');
  assert.strictEqual(ctx.cleanReviewer({ ...plain(three), opts: { diagramAnswer: 'choice' } }).opts.diagramAnswer, 'choice', 'the setting survives export and import');
  assert.strictEqual(ctx.cleanReviewer({ ...plain(three), opts: { diagramAnswer: 'nonsense' } }).opts.diagramAnswer, undefined, 'a bad setting is dropped');
  six.ans = {}; ctx.open(six);
  const answerMode = label => find(appEl, e => e.tagName === 'BUTTON' && e.attrs['aria-pressed'] && screenText(e) === label)[0];
  assert.ok(answerMode('Type the name') && answerMode('Choose from labels'), 'the reviewer offers both answer modes');
  answerMode('Choose from labels').onclick();
  assert.strictEqual(six.opts.diagramAnswer, 'choice', 'choosing the mode saves it on the reviewer');
  const opts = () => find(appEl, e => e.tagName === 'BUTTON' && String(e.className).split(' ')[0] === 'opt');
  assert.ok(opts().length >= 4 && !find(appEl, e => e.tagName === 'INPUT' && e.attrs.placeholder === 'Your answer').length, 'diagram parts show options instead of a text box');
  const q0 = sixParts()[0];
  opts().slice(0, 4).find(b => screenText(b).includes(q0.answer)).onclick();
  assert.ok(six.ans[q0.id] && six.ans[q0.id].ok, 'picking the right label is correct');
  const q1 = sixParts()[1], wrong = ctx.diagramChoices(six, q1).find(l => l !== q1.answer);
  keyHandlers.forEach(f => f({ key: String(ctx.diagramChoices(six, q1).indexOf(wrong) + 1), target: { tagName: 'BODY' }, preventDefault() {} }));
  assert.ok(six.ans[q1.id] && !six.ans[q1.id].ok && six.ans[q1.id].val === wrong, 'number keys pick an option, and a wrong label is wrong');
  assert.match(ctx.reciteQuestion(q1), /Options: A\. /, 'recitation reads the options aloud');
  answerMode('Type the name').onclick();
  assert.ok(!six.opts.diagramAnswer && find(appEl, e => e.tagName === 'INPUT' && e.attrs.placeholder === 'Your answer').length, 'typing comes back');
  assert.doesNotMatch(ctx.reciteQuestion(q1), /Options/, 'typed mode recites as before');
  // Zoom: pure geometry, then the controls on a practice diagram.
  assert.strictEqual(ctx.clampZoom(0.5), 1); assert.strictEqual(ctx.clampZoom(9), 4);
  assert.strictEqual(ctx.clampPan(0.1, 2), 0.25, 'the view cannot pan past the image edge');
  assert.strictEqual(ctx.clampPan(0.9, 1), 0.5, 'at 100% there is nothing to pan');
  const onScreen = ctx.hotspotToScreen({ x: 0.8, y: 0.5 }, { k: 2, cx: 0.75, cy: 0.5 });
  assert.ok(Math.abs(onScreen.x - 0.6) < 1e-9 && onScreen.y === 0.5, 'a hotspot maps to its place in the zoomed view');
  ctx.open(six);
  const zoomBtn = label => find(appEl, e => e.tagName === 'BUTTON' && e.attrs['aria-label'] === label)[0];
  const layer = () => find(appEl, e => String(e.className) === 'zoom-layer')[0];
  assert.ok(zoomBtn('Zoom in') && zoomBtn('Zoom out') && zoomBtn('Fit the diagram'), 'a practice diagram has zoom controls');
  const zp = sixParts()[0], hotBefore = plain(zp.hotspot);
  zoomBtn('Zoom in').onclick(); zoomBtn('Zoom in').onclick();
  assert.match(layer().style.transform, /scale\(2\.25\)/, 'zoom in scales the diagram');
  const zoomedPin = find(layer(), e => String(e.className).split(' ')[0] === 'pin')[0];
  assert.match(zoomedPin.style.transform, /scale\(0\.44/, 'the pin keeps its size on screen');
  assert.deepStrictEqual(plain(zp.hotspot), hotBefore, 'zooming never moves the saved hotspot');
  zoomBtn('Hide pin').onclick();
  assert.strictEqual(zoomedPin.hidden, true, 'the pin can be hidden to read what is under it');
  zoomBtn('Fit the diagram').onclick();
  assert.match(layer().style.transform, /scale\(1\)/, 'Fit returns to 100%');
  // Auto-cover in the diagram maker: asked once, then each new picture is searched in the background.
  localStorage.removeItem('reviewer_ocr_v1');
  let engineLoads = 0;
  ctx.loadTesseract = async () => { engineLoads++; return fakeT; };
  let focused = null;
  El.prototype.focus = function () { focused = this; }; // records where focus goes after a redraw
  ctx.prepareImage = async () => ({ blob: new sandbox.Blob(['labelled diagram']), url: 'blob:p' });
  const hold = () => { let open; fakeT.gate = new Promise(r => { open = r; }); return open; };
  const settle = () => new Promise(r => setTimeout(r, 10));
  const btnNamed = label => find(appEl, e => e.tagName === 'BUTTON' && screenText(e) === label)[0];
  const statusText = () => { const el = vm.runInContext('labelStatusEl', ctx); return el ? screenText(el) : ''; };
  const threeParts = "diagParts = [{ x: 0.1, y: 0.1, name: 'A' }, { x: 0.5, y: 0.5, name: 'B' }, { x: 0.9, y: 0.9, name: 'C' }];";
  ctx.clearDiagram();
  await ctx.pickDiagram({ name: 'heart.png', type: 'image/png' });
  assert.match(screenText(appEl), /downloads about 7 MB once/, 'the first picture asks before downloading anything');
  btnNamed('No thanks').onclick();
  assert.strictEqual(ctx.ocrConsent(), 'no', 'a no is remembered');
  assert.strictEqual(state('labelSearch'), null, 'declining starts nothing');
  assert.strictEqual(engineLoads, 0, 'and downloads nothing');
  assert.strictEqual(focused, vm.runInContext('labelStatusEl', ctx), 'focus lands on the note that replaced the question');
  assert.match(statusText(), /not searched/, 'which says labels will not be searched');
  assert.doesNotMatch(screenText(appEl), /7 MB/, 'and the question goes away');
  localStorage.removeItem('reviewer_ocr_v1'); ctx.diagramSetup();
  let release = hold();
  btnNamed('Yes, find labels').onclick();
  assert.strictEqual(ctx.ocrConsent(), 'yes', 'a yes is remembered');
  assert.ok(state('labelSearch'), 'agreeing starts the search on this picture');
  assert.strictEqual(focused, vm.runInContext('labelStatusEl', ctx), 'focus lands on the search status, not the page');
  release(); await settle();
  assert.match(statusText(), /Found 1 printed label/, 'the maker says what it found, without a redraw');
  assert.ok(!vm.runInContext('labelStatusEl.hasAttribute("role")', ctx), 'progress is not a live region: a screen reader would read every tick');
  assert.match(vm.runInContext('live.textContent', ctx), /Found 1 printed label/, 'the result is announced once');
  // Agreed once: the next picture is searched by itself. Create does not wait for a search still running.
  ctx.clearDiagram();
  release = hold();
  await ctx.pickDiagram({ name: 'cell.png', type: 'image/png' });
  assert.ok(state('labelSearch'), 'a new picture is searched automatically');
  vm.runInContext(threeParts, ctx);
  await ctx.createDiagram();
  const made = vm.runInContext('R[0]', ctx);
  assert.strictEqual(made.masks.length, 0, 'Create does not wait for the search');
  release(); await settle();
  assert.strictEqual(made.masks.length, 1, 'the covers reach the saved reviewer when the search ends');
  assert.match(JSON.parse(store.get('reviewer_gen_v1'))[0].masks.length ? 'saved' : '', /saved/, 'and are saved');
  // A late result does not redraw the quiz under a student who is typing an answer.
  release = hold();
  await ctx.pickDiagram({ name: 'typing.png', type: 'image/png' }); await settle();
  vm.runInContext(threeParts, ctx);
  await ctx.createDiagram();
  const typedOn = vm.runInContext('R[0]', ctx), screenBefore = appEl.children[0];
  document.activeElement = { tagName: 'INPUT' };
  release(); await settle();
  assert.strictEqual(typedOn.masks.length, 1, 'the covers are still saved');
  assert.strictEqual(appEl.children[0], screenBefore, 'the quiz is not redrawn while the student types');
  document.activeElement = undefined;
  vm.runInContext('R.shift()', ctx);
  // A search for a picture that is no longer there never lands, even after Create.
  ctx.clearDiagram();
  const first = hold();
  await ctx.pickDiagram({ name: 'one.png', type: 'image/png' }); await settle();
  const second = hold();
  await ctx.pickDiagram({ name: 'two.png', type: 'image/png' }); await settle();
  assert.doesNotMatch(statusText(), /Found/, 'the new picture shows its own search');
  vm.runInContext(threeParts, ctx);
  await ctx.createDiagram();
  const twoMade = vm.runInContext('R[0]', ctx);
  first(); await settle();
  assert.strictEqual(twoMade.masks.length, 0, "a replaced picture's search never lands on the reviewer");
  second(); await settle();
  assert.strictEqual(twoMade.masks.length, 1, 'only the search for its own picture does');
  vm.runInContext('R.shift()', ctx);
  // Picture replaced (Edit parts) before the late result: the old covers are dropped.
  release = hold();
  await ctx.pickDiagram({ name: 'swap.png', type: 'image/png' }); await settle();
  vm.runInContext(threeParts, ctx);
  await ctx.createDiagram();
  const swapped = vm.runInContext('R[0]', ctx);
  swapped.items.forEach(i => { i.imageId = 'img_other'; });
  release(); await settle();
  assert.strictEqual(swapped.masks.length, 0, 'a reviewer whose picture was replaced does not get the old covers');
  vm.runInContext('R.shift()', ctx);
  // A failed download in the maker: a plain message, Try again, and Create still works.
  let failNow; fakeT.gate = new Promise((_, no) => { failNow = no; }); fakeT.gate.catch(() => {});
  await ctx.pickDiagram({ name: 'net.png', type: 'image/png' }); await settle();
  failNow(new Error('Network error while fetching https://example.com/app/vendor/tesseract/eng.traineddata.gz. Response code: 504')); await settle();
  assert.ok(/Could not/.test(statusText()) && !/https:/.test(statusText()), "the student sees a plain message, not the engine's error");
  fakeT.gate = Promise.resolve();
  btnNamed('Try again').onclick(); await settle();
  assert.match(statusText(), /Found 1 printed label/, 'Try again searches the same picture again');
  fakeT.gate = new Promise((_, no) => { failNow = no; }); fakeT.gate.catch(() => {});
  await ctx.pickDiagram({ name: 'net2.png', type: 'image/png' }); await settle();
  failNow(new Error('offline')); await settle();
  vm.runInContext(threeParts, ctx);
  const shelfBeforeFail = vm.runInContext('R.length', ctx);
  await ctx.createDiagram();
  assert.strictEqual(vm.runInContext('R.length', ctx), shelfBeforeFail + 1, 'Create still works after a failed search');
  vm.runInContext('R.shift()', ctx);
  fakeT.gate = Promise.resolve();
  // Leaving the maker drops the search.
  hold();
  await ctx.pickDiagram({ name: 'leave.png', type: 'image/png' }); await settle();
  btnNamed('← Cancel').onclick();
  assert.strictEqual(state('labelSearch'), null, 'leaving the maker drops the search');
  fakeT.gate = Promise.resolve();
  // The reviewer was deleted before its search ended: nothing breaks, nothing is saved for it.
  release = hold();
  await ctx.pickDiagram({ name: 'gone.png', type: 'image/png' });
  vm.runInContext(threeParts, ctx);
  await ctx.createDiagram();
  const deleted = vm.runInContext('R.shift()', ctx);
  release(); await settle();
  assert.ok(!vm.runInContext('R', ctx).includes(deleted) && deleted.masks.length === 0, 'a deleted reviewer gets nothing');
  // A dropped search is stopped, not left running: a cheap phone cannot hold two engines at once.
  ctx.clearDiagram();
  hold();
  await ctx.pickDiagram({ name: 'a.png', type: 'image/png' }); await settle();
  const stoppedBefore = fakeT.terminated;
  hold();
  await ctx.pickDiagram({ name: 'b.png', type: 'image/png' }); await settle();
  assert.strictEqual(fakeT.terminated, stoppedBefore + 1, 'picking another picture stops the first search');
  btnNamed('← Cancel').onclick();
  assert.strictEqual(fakeT.terminated, stoppedBefore + 2, 'leaving the maker stops the search');
  // A late result also reaches an open cover editor, so Save covers does not throw it away.
  release = hold();
  await ctx.pickDiagram({ name: 'late.png', type: 'image/png' });
  vm.runInContext(threeParts, ctx);
  await ctx.createDiagram();
  const late = vm.runInContext('R[0]', ctx);
  ctx.openCovers(late);
  release(); await settle();
  assert.strictEqual(vm.runInContext('coverList.length', ctx), 1, 'the open cover editor gets the late covers');
  find(appEl, e => e.tagName === 'BUTTON' && screenText(e) === 'Save covers')[0].onclick();
  assert.strictEqual(late.masks.length, 1, 'and Save covers keeps them');
  // A search that fails after Create is said out loud, not dropped.
  let fail; fakeT.gate = new Promise((_, no) => { fail = no; }); fakeT.gate.catch(() => {});
  await ctx.pickDiagram({ name: 'offline.png', type: 'image/png' });
  vm.runInContext(threeParts, ctx);
  await ctx.createDiagram();
  fail(new Error('Network error')); await settle();
  assert.match(vm.runInContext('live.textContent', ctx), /Could not find printed labels for "/, 'a failure after Create is announced');
  fakeT.gate = Promise.resolve();
  vm.runInContext("R = R.filter(r => r !== R[0] && r !== R[1])", ctx); // the two reviewers made just above
  // Editing a saved reviewer never searches by itself; a browser without the service worker is told why.
  await ctx.editDiagram(made);
  await ctx.pickDiagram({ name: 'clearer.png', type: 'image/png' });
  assert.strictEqual(state('labelSearch'), null, 'a replaced picture is not searched automatically');
  ctx.clearDiagram();
  ctx.navigator.serviceWorker.controller = null;
  await ctx.pickDiagram({ name: 'x.png', type: 'image/png' });
  assert.match(screenText(appEl), /hide them by hand here/, 'without the service worker the maker says to cover by hand');
  assert.strictEqual(state('labelSearch'), null, 'and searches nothing');
  ctx.navigator.serviceWorker.controller = {};
  ctx.clearDiagram();
  vm.runInContext("R = R.filter(r => r.title !== 'cell' && r.title !== 'gone')", ctx);
  ctx.open(imgReviewer); // the cover editor is opened from the reviewer on screen
  ctx.openCovers(imgReviewer);
  assert.match(screenText(appEl), /Hide printed labels/, 'the label-cover editor renders');
  const editing = find(appEl, e => String(e.className).includes('cover editing'));
  assert.strictEqual(editing.length, imgReviewer.masks.length, 'every saved cover is editable');
  assert.match(editing[0].attrs['aria-label'], /Arrow keys move it/, 'a cover says how to move it without a pointer');
  // Draw a cover the way a pointer does: press, drag, release on the image.
  const coverImg = find(appEl, e => e.tagName === 'IMG')[0];
  coverImg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });
  const pointer = (x, y) => ({ button: 0, pointerId: 1, clientX: x, clientY: y, currentTarget: coverImg, preventDefault() {} });
  coverImg.onpointerdown(pointer(10, 10));
  coverImg.onpointermove(pointer(40, 30));
  coverImg.onpointerup(pointer(60, 60));
  assert.match(screenText(appEl), /3 cover\(s\)/, 'dragging on the image adds a cover');
  // Arrow keys move the selected cover, so a keyboard user can place one too.
  const leftOf = () => Number(/left:([\d.]+)%/.exec(find(appEl, e => String(e.className).includes('cover editing'))[0].attrs.style)[1]);
  const beforeLeft = leftOf();
  ctx.moveCoverKey({ key: 'ArrowRight', shiftKey: false, preventDefault() {} }, 0);
  assert.ok(leftOf() > beforeLeft, 'arrow keys nudge a cover');
  // Save from the editor and re-render practice: this is the path the reader takes.
  const labelOf = e => e.children.map(c => c.textContent || '').join(' ');
  const saveBtn = find(appEl, e => e.tagName === 'BUTTON' && /Save covers/.test(labelOf(e)))[0];
  assert.ok(saveBtn, 'the editor offers Save covers');
  saveBtn.onclick();
  assert.strictEqual(imgReviewer.masks.length, 3, 'saving stores every drawn cover on the reviewer');
  const afterSave = find(appEl, e => String(e.className).split(' ')[0] === 'cover');
  assert.strictEqual(afterSave.length, imgReviewer.items.length * 3, 'practice draws the covers after saving');
  // Find printed labels in the cover editor: asked once, adds only what is not covered yet, saved on Save covers.
  localStorage.removeItem('reviewer_ocr_v1');
  let asked = 0; ctx.ask = async () => { asked++; return true; };
  fakeT.gate = Promise.resolve();
  fakeT.lines = [L('Aorta', 91, 100, 50, 200, 70), L('Left ventricle', 88, 600, 300, 800, 330)];
  const savedMasks = imgReviewer.masks;
  imgReviewer.masks = [{ x: 0.01, y: 0.1, w: 0.2, h: 0.08 }]; // covers the Aorta label only
  ctx.openCovers(imgReviewer);
  const masksBefore = plain(imgReviewer.masks);
  const findBtn = () => find(appEl, e => e.tagName === 'BUTTON' && screenText(e) === 'Find printed labels')[0];
  assert.ok(findBtn(), 'the cover editor offers to find printed labels');
  await findBtn().onclick(); await settle();
  assert.strictEqual(asked, 1, 'the first search asks before downloading');
  assert.strictEqual(ctx.ocrConsent(), 'yes', 'and remembers the yes');
  assert.strictEqual(vm.runInContext('coverList.length', ctx), masksBefore.length + 1, 'a label already under a cover is not covered again');
  assert.match(screenText(appEl), /1 printed label covered/, 'the editor says what it added');
  assert.ok(!vm.runInContext('coverStatusEl.hasAttribute("role")', ctx), 'the editor status is not a live region either');
  assert.strictEqual(focused, findBtn(), 'focus returns to Find printed labels after the search');
  assert.deepStrictEqual(plain(imgReviewer.masks), masksBefore, 'nothing is saved until Save covers');
  await findBtn().onclick(); await settle();
  assert.strictEqual(asked, 1, 'a yes is not asked again');
  assert.strictEqual(vm.runInContext('coverList.length', ctx), masksBefore.length + 1, 'searching twice adds nothing');
  assert.match(screenText(appEl), /No printed labels found that are not already covered/, 'and says so');
  vm.runInContext('coverList.splice(1)', ctx); // take the found cover away again
  const editorRelease = hold();
  const running = findBtn().onclick(); await settle();
  vm.runInContext('coverList.push({ x: 0.59, y: 0.59, w: 0.22, h: 0.08 })', ctx); // drawn by hand while it runs
  editorRelease(); await running; await settle();
  assert.strictEqual(vm.runInContext('coverList.length', ctx), 2, 'a cover drawn during the search is not doubled');
  // Near the 60-cover limit the message counts what was really added, not what was found.
  vm.runInContext('coverList = Array.from({ length: 59 }, (_, i) => ({ x: (i % 10) / 10, y: 0.9, w: 0.05, h: 0.05 }))', ctx);
  await findBtn().onclick(); await settle();
  assert.strictEqual(vm.runInContext('coverList.length', ctx), 60, 'the editor stops at 60 covers');
  assert.match(screenText(appEl), /1 printed label covered \(a reviewer holds 60 covers/, 'and says one was added and why the rest were not');
  ctx.navigator.serviceWorker.controller = null; ctx.openCovers(imgReviewer);
  assert.ok(!findBtn() && /hide them by hand here/.test(screenText(appEl)), 'without the service worker the button is replaced by a note');
  ctx.navigator.serviceWorker.controller = {};
  imgReviewer.masks = savedMasks;
  ctx.open(imgReviewer);

  // 8b. Focus timer: pure transitions, then the bar's real start/pause/stop path.
  assert.strictEqual(vm.runInContext('focusClock(1500000)', ctx), '25:00', 'the clock shows 25 minutes');
  assert.strictEqual(vm.runInContext('focusClock(61000)', ctx), '1:01', 'the clock pads seconds');
  assert.strictEqual(vm.runInContext('focusClock(0)', ctx), '0:00', 'the clock never goes negative');
  const focusAt = over => ({ phase: 'focus', running: true, end: 1000, left: 1500000, done: 2, day: 1, ...over });
  const finished = ctx.focusNext(focusAt(), 2000);
  assert.strictEqual(finished.f.phase, 'break', 'a finished focus block starts the break');
  assert.strictEqual(finished.f.done, 3, 'a finished focus block is counted');
  assert.strictEqual(finished.f.end, 1000 + 300000, 'the break runs from the original deadline');
  assert.deepStrictEqual(plain(finished.events), ['focus-done']);
  assert.strictEqual(ctx.focusNext(focusAt(), 500).f.phase, 'focus', 'a running block is left alone');
  const breakOver = ctx.focusNext({ phase: 'break', running: true, end: 1000, left: 300000, done: 1, day: 1 }, 2000);
  assert.strictEqual(breakOver.f.phase, 'idle', 'a finished break returns to ready');
  assert.deepStrictEqual(plain(breakOver.events), ['break-done']);
  const longGone = ctx.focusNext(focusAt(), 1000 + 300000 + 1);
  assert.strictEqual(longGone.f.phase, 'idle', 'a break that also passed does not restart');
  assert.deepStrictEqual(plain(longGone.events), ['focus-done', 'break-done']);
  assert.strictEqual(plain(ctx.cleanFocus({ phase: 'break', running: true, end: 1, left: -5, done: 9000, day: 1 })).done, 0, 'an impossible saved count is dropped');
  localStorage.setItem('reviewer_focus_v1', JSON.stringify({ phase: 'idle', running: false, end: 0, left: 1500000, done: 4, day: 0 }));
  assert.strictEqual(ctx.loadFocus().done, 0, 'yesterday’s count does not carry into today');
  localStorage.removeItem('reviewer_focus_v1');
  assert.strictEqual(vm.runInContext('focusBar.className', ctx), 'focusbar', 'the focus bar is always present');
  assert.strictEqual(vm.runInContext('focusStopBtn.hidden', ctx), true, 'the stop button is hidden while ready');
  assert.match(vm.runInContext('focusMainBtn.textContent', ctx), /Start/, 'the bar starts ready');
  ctx.focusToggle();
  assert.strictEqual(vm.runInContext('focus.phase', ctx), 'focus', 'the start button begins a focus block');
  assert.strictEqual(vm.runInContext('focus.running', ctx), true);
  assert.match(vm.runInContext('focusMainBtn.textContent', ctx), /Pause/);
  assert.strictEqual(vm.runInContext('focusStopBtn.hidden', ctx), false, 'the stop button appears while running');
  assert.ok(localStorage.getItem('reviewer_focus_v1'), 'a started block is saved');
  ctx.focusToggle();
  assert.strictEqual(vm.runInContext('focus.running', ctx), false, 'the same button pauses');
  assert.match(vm.runInContext('focusMainBtn.textContent', ctx), /Resume/);
  ctx.focusStop();
  assert.strictEqual(vm.runInContext('focus.phase', ctx), 'idle', 'stop returns the timer to ready');
  assert.match(vm.runInContext('focusMainBtn.textContent', ctx), /Start/);
  localStorage.removeItem('reviewer_focus_v1');

  // 9. PDF.js is fetched on demand, in worker-before-viewer order, and only once
  assert.deepStrictEqual(scripts, [], 'nothing loaded at boot');
  const p1 = ctx.loadPdfjs();
  ctx.loadPdfjs();
  const lib = await p1;
  assert.strictEqual(lib, ctx.pdfjsLib, 'resolves to the PDF.js namespace');
  assert.strictEqual(ctx.pdfjsLib.GlobalWorkerOptions.workerSrc, './js/pdfjs-worker-bundle.js');
  assert.deepStrictEqual(scripts, ['./js/pdfjs-worker-bundle.js', './js/pdfjs-viewer-bundle.js'], 'loads both bundles in order, once');

  // 10. A half-typed answer belongs to one reviewer: opening another must not show it.
  // Item ids restart at id0 in every reviewer, so drafts keyed by id used to cross over.
  const draftA = ctx.cleanReviewer({ ...base, title: 'Reviewer A' }), draftB = ctx.cleanReviewer({ ...base, title: 'Reviewer B' });
  ctx.open(draftA);
  vm.runInContext("draft['id0'] = 'half typed'", ctx);
  ctx.open(draftB);
  const blanks = find(appEl, e => e.tagName === 'INPUT' && e.attrs.type === 'text').map(e => e.value);
  assert.deepStrictEqual(blanks, ['', '', ''], 'a draft from another reviewer is not shown');

  // 11. Offline support: the service worker precaches files that exist, and the page registers it.
  const files = (() => {
    const src = fs.readFileSync('sw.js', 'utf8'), grab = name => {
      const m = src.match(new RegExp('const ' + name + ' = (\\[[^\\]]*\\]);'));
      assert.ok(m, name + ' list is present in sw.js');
      return m[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));
    };
    return { shell: grab('SHELL'), optional: grab('OPTIONAL') };
  })();
  const before = new Set(files.shell);
  before.add('./index.html'); // './' is the same document
  const missing = [...before, ...files.optional].filter(p => p !== './' && !fs.existsSync(p.replace(/^\.\//, '')));
  assert.deepStrictEqual(missing, [], 'every precached file exists on disk');
  assert.ok(before.has('./js/app.js') && before.has('./css/styles.css'), 'the shell covers the app scripts and styles');
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /<script src="\.\/js\/sw-register\.js">/, 'the page registers the service worker');
  assert.match(html, /rel="manifest"/, 'the page links the manifest');
  assert.match(html, /localStorage\.getItem\('reviewer_theme'\)/, 'the saved theme is applied before first paint');
  const manifest = JSON.parse(fs.readFileSync('manifest.webmanifest', 'utf8'));
  assert.strictEqual(manifest.start_url, './', 'the manifest starts inside the app folder, so a sub-path deploy works');
  manifest.icons.forEach(i => assert.ok(fs.existsSync(i.src.replace(/^\.\//, '')), 'icon exists: ' + i.src));
  // The worker itself must not be cached by a worker, and the sheet and scripts it caches are real files.
  const swSrc = fs.readFileSync('sw.js', 'utf8');
  assert.match(swSrc, /caches\.delete/, 'old caches are dropped on activate');
  assert.doesNotMatch(swSrc, /['"]\.\/sw\.js['"]/, 'sw.js does not cache itself');

  // 12. Shuffle keeps what the student earned, and a removed question stays removed.
  const prog = ctx.cleanReviewer({ title: 'Progress', items: [
    { id: 'id0', type: 'id', q: 'Which term runs instructions?', answer: 'CPU', exp: '' },
    { id: 'id1', type: 'id', q: 'Which term holds running programs?', answer: 'RAM', exp: '' },
    { id: 'id2', type: 'id', q: 'Which term forwards data between networks?', answer: 'router', exp: '' },
    { id: 'id3', type: 'id', q: 'Which term connects devices inside one network?', answer: 'switch', exp: '' }
  ] });
  ctx.open(prog);
  prog.ans.id0 = { val: 'CPU', ok: true, exp: '' };
  prog.plan.srs.id0 = { box: 2, due: ctx.todayNumber() + 7 };
  prog.flashKnown = ['id1'];
  prog.flashLearn = ['id2'];
  const gone = ctx.itemKey(prog.items[3]);
  prog.hidden = [gone];
  ctx.shuffleAll();
  const byAnswer = name => prog.items.find(it => it.answer === name);
  assert.strictEqual(prog.items.length, 3, 'the removed question does not come back');
  assert.ok(!prog.items.some(it => ctx.itemKey(it) === gone), 'the removed question is not in the rebuilt set');
  assert.deepStrictEqual(plain(prog.ans[byAnswer('CPU').id]), { val: 'CPU', ok: true, exp: '' }, 'an answer follows its question, not its old position');
  assert.deepStrictEqual(plain(prog.plan.srs[byAnswer('CPU').id]), { box: 2, due: ctx.todayNumber() + 7 }, 'the Leitner box follows its question');
  assert.ok(prog.flashKnown.includes(byAnswer('RAM').id), 'a known card stays known');
  assert.ok(prog.flashLearn.includes(byAnswer('router').id), 'a learning card stays learning');
  assert.strictEqual(Object.keys(prog.ans).length, 1, 'no stale answer survives under a reused id');
  assert.strictEqual(prog.plan.srs[byAnswer('RAM').id], undefined, 'an untouched question does not inherit a schedule');

  const hiddenOk = ctx.cleanReviewer({ ...base, hidden: ['q9|z', 'x'.repeat(700), 42] });
  assert.deepStrictEqual(plain(hiddenOk.hidden), ['q9|z'], 'hidden keys are validated on import');
  const hiddenAll = ctx.cleanReviewer({ ...base, hidden: base.items.map(it => ctx.itemKey(it)) });
  assert.deepStrictEqual(plain(hiddenAll.hidden), [], 'a backup cannot hide every question');

  // Removing a question in the check screen is remembered on the saved reviewer.
  const pendingItems = [0, 1, 2, 3].map(i => ({ id: 'id' + i, type: 'id', q: 'Pending question ' + i, answer: 'a' + i, exp: '' }));
  vm.runInContext('pending = ' + JSON.stringify({ title: 'Pending', items: pendingItems, src: [], tags: [], opts: { max: 0, mcOnly: false }, hidden: [], removed: [] }), ctx);
  ctx.preview();
  const removeButtons = find(appEl, e => String(e.className).split(' ').includes('rm'));
  assert.strictEqual(removeButtons.length, 4, 'every checked question can be removed');
  removeButtons[2].onclick();
  assert.strictEqual(vm.runInContext('pending.items.length', ctx), 3, 'the question leaves the pending set');
  assert.deepStrictEqual(plain(vm.runInContext('pending.hidden', ctx)), [ctx.itemKey(pendingItems[2])], 'the removal is remembered by key');
  assert.strictEqual(vm.runInContext('pending.removed.length', ctx), 1, 'the preview keeps the removed question for restore');
  ctx.savePending();
  const savedPending = vm.runInContext('R[0]', ctx);
  assert.ok(savedPending.hidden.includes(ctx.itemKey(pendingItems[2])), 'the saved reviewer remembers what was removed');
  assert.strictEqual(savedPending.removed.length, 1, 'the saved reviewer keeps the removed question');

  // 13. Phase 1: edit in place, add, remove and restore, and keep pinned questions on Shuffle.
  const editable = ctx.cleanReviewer({ title: 'Editable', items: [
    { id: 'id0', type: 'id', q: 'Which term runs instructions?', answer: 'CPU', exp: '' },
    { id: 'id1', type: 'id', q: 'Which term holds running programs?', answer: 'RAM', exp: '' },
    { id: 'id2', type: 'id', q: 'Which term forwards data between networks?', answer: 'router', exp: '' },
    { id: 'id3', type: 'id', q: 'Which term connects devices inside one network?', answer: 'switch', exp: '' }
  ] });
  editable.ans.id1 = { val: 'RAM', ok: true, exp: '' };
  editable.plan.srs.id1 = { box: 1, due: ctx.todayNumber() + 3 };
  ctx.open(editable);
  const oldKey = ctx.itemKey(editable.items[1]);
  ctx.openItemEditor({ items: editable.items, hidden: editable.hidden, reviewer: editable, index: 1, back: () => {} });
  vm.runInContext("editDraft.q = 'Which term holds programs and data while they run?'; editDraft.answer = 'RAM';", ctx);
  ctx.saveEditor();
  assert.strictEqual(editable.items[1].q, 'Which term holds programs and data while they run?', 'the question is edited in place');
  assert.strictEqual(editable.items[1].id, 'id1', 'the id is unchanged');
  assert.strictEqual(editable.items[1].pinned, true, 'an edited question is pinned');
  assert.strictEqual(editable.ans.id1, undefined, 'changing the question clears its old answer');
  assert.deepStrictEqual(plain(editable.plan.srs.id1), { box: 1, due: ctx.todayNumber() + 3 }, 'the study schedule stays with the item');
  assert.ok(editable.hidden.includes(oldKey), 'the old wording is hidden from Shuffle');
  assert.ok(!editable.hidden.includes(ctx.itemKey(editable.items[1])), 'the edited wording is not hidden');

  // An explanation-only edit keeps the answer and the key.
  editable.ans.id1 = { val: 'RAM', ok: true, exp: '' };
  ctx.openItemEditor({ items: editable.items, hidden: editable.hidden, reviewer: editable, index: 1, back: () => {} });
  vm.runInContext("editDraft.exp = 'RAM is working memory.';", ctx);
  ctx.saveEditor();
  assert.deepStrictEqual(plain(editable.ans.id1), { val: 'RAM', ok: true, exp: '' }, 'an explanation-only edit keeps the answer');

  // A question added by hand is pinned and defaults to identification.
  const beforeAdd = editable.items.length;
  ctx.openItemEditor({ items: editable.items, hidden: editable.hidden, removed: editable.removed, reviewer: editable, index: -1, back: () => {} });
  vm.runInContext("editDraft.q = 'What does the ALU do?'; editDraft.answer = 'arithmetic and logic';", ctx);
  ctx.saveEditor();
  assert.strictEqual(editable.items.length, beforeAdd + 1, 'a question can be added');
  assert.strictEqual(editable.items[beforeAdd].pinned, true, 'an added question is pinned');
  assert.strictEqual(editable.items[beforeAdd].type, 'id', 'an added question defaults to identification');

  // Remove and restore: only that item's progress is pruned.
  editable.ans[editable.items[2].id] = { val: 'router', ok: true, exp: '' };
  editable.plan.srs[editable.items[2].id] = { box: 2, due: ctx.todayNumber() + 7 };
  const removedItem = editable.items[2];
  assert.strictEqual(ctx.removeItem(editable, removedItem), true, 'a reviewer above the minimum can lose one');
  assert.ok(!editable.items.some(x => x.id === removedItem.id), 'the item leaves the practice set');
  assert.ok(editable.removed.some(x => x.id === removedItem.id), 'the item is kept for restore');
  assert.strictEqual(editable.ans[removedItem.id], undefined, 'its answer is pruned');
  assert.strictEqual(editable.plan.srs[removedItem.id], undefined, 'its schedule is pruned');
  assert.deepStrictEqual(plain(editable.ans.id1), { val: 'RAM', ok: true, exp: '' }, 'another item keeps its answer');
  ctx.restoreItem(editable, removedItem);
  assert.ok(editable.items.some(x => x.id === removedItem.id), 'the item is restored');
  assert.ok(!editable.hidden.includes(ctx.itemKey(removedItem)), 'the restored item is no longer hidden');
  const threeOnly = ctx.cleanReviewer({ ...base });
  assert.strictEqual(ctx.removeItem(threeOnly, threeOnly.items[0]), false, 'a three-item reviewer cannot go below three');

  // A pinned question is not regenerated and not duplicated by Shuffle.
  const pinnedSet = ctx.cleanReviewer({ title: 'Pinned', items: [
    { id: 'p0', type: 'id', q: 'Pinned one?', answer: 'one', exp: '' },
    { id: 'p1', type: 'id', q: 'Pinned two?', answer: 'two', exp: '' },
    { id: 'p2', type: 'id', q: 'Pinned three?', answer: 'three', exp: '' }
  ] });
  pinnedSet.items[0].pinned = true;
  ctx.open(pinnedSet);
  ctx.shuffleAll();
  assert.ok(pinnedSet.items.some(it => it.answer === 'one' && it.pinned), 'a pinned question survives Shuffle');
  assert.strictEqual(pinnedSet.items.filter(it => it.answer === 'one').length, 1, 'it is not duplicated');

  // Multiple choice: empty option slots are dropped and the key follows the marked option.
  const mcSet = ctx.cleanReviewer({ title: 'MC', items: [
    { id: 'mc0', type: 'mc', q: 'Pick one', options: ['A', 'B'], answer: 0, exp: '' },
    { id: 'mc1', type: 'mc', q: 'Pick two', options: ['C', 'D'], answer: 0, exp: '' },
    { id: 'mc2', type: 'mc', q: 'Pick three', options: ['E', 'F'], answer: 0, exp: '' }
  ] });
  ctx.openItemEditor({ items: mcSet.items, hidden: [], reviewer: mcSet, index: 0, back: () => {} });
  vm.runInContext("editDraft.options = ['A', 'B', 'C', '']; editDraft.correct = 2;", ctx);
  ctx.saveEditor();
  assert.deepStrictEqual(plain(mcSet.items[0].options), ['A', 'B', 'C'], 'empty options are dropped');
  assert.strictEqual(mcSet.items[0].answer, 2, 'the chosen option becomes the key');

  // Validation keeps the new fields and reassigns colliding removed ids.
  assert.strictEqual(ctx.cleanItem({ id: 'x', type: 'id', q: 'Q', answer: 'A', pinned: true }).pinned, true, 'a pinned item survives validation');
  assert.strictEqual(ctx.cleanItem({ id: 'x', type: 'id', q: 'Q', answer: 'A' }).pinned, undefined, 'a generated item is not pinned');
  const withRemoved = ctx.cleanReviewer({ ...base, removed: [{ ...base.items[0], id: 'id0' }, { ...base.items[1], id: 'id0' }] });
  assert.strictEqual(withRemoved.removed.length, 2, 'removed questions survive validation');
  assert.notStrictEqual(withRemoved.removed[0].id, withRemoved.removed[1].id, 'colliding removed ids are reassigned');

  // 14. Phase 2: exam-aware plan, forecast, daily cap, partial credit and undo.
  const isoIn = days => { const d = new Date(); d.setDate(d.getDate() + days); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const examR = ctx.cleanReviewer({ ...base, plan: { exam: isoIn(2), srs: {} } });
  examR.plan.srs.id0 = { box: 4, due: ctx.todayNumber() };
  ctx.reviewItem(examR, 'id0', true);
  assert.strictEqual(examR.plan.srs.id0.due, ctx.todayNumber() + 2, 'a card never waits past the exam');
  const pastR = ctx.cleanReviewer({ ...base, plan: { exam: isoIn(-2), srs: {} } });
  pastR.plan.srs.id0 = { box: 4, due: ctx.todayNumber() };
  ctx.reviewItem(pastR, 'id0', true);
  assert.strictEqual(pastR.plan.srs.id0.due, ctx.todayNumber() + 16, 'a passed exam date stops clamping');
  assert.deepStrictEqual(plain(ctx.forecast(examR)), [2, 0, 1, 0, 0, 0, 0], 'the forecast counts today and the clamped item');

  const capR = ctx.cleanReviewer({ ...base, items: [0, 1, 2, 3].map(i => ({ id: 'c' + i, type: 'id', q: 'Cap ' + i, answer: 'a' + i, exp: '' })) });
  ctx.open(capR);
  ctx.startFlash('due', 2);
  assert.strictEqual(vm.runInContext('flashOrder.length', ctx), 2, 'the daily limit caps a due session');
  ctx.startFlash('due', 0);
  assert.strictEqual(vm.runInContext('flashOrder.length', ctx), 4, 'zero means study all');

  const enumR = ctx.cleanReviewer({ ...base, title: 'Enum', items: [
    { id: 'e0', type: 'enum', q: 'List three', items: ['a', 'b', 'c'], exp: '' },
    { id: 'e1', type: 'enum', q: 'List two', items: ['d', 'e'], exp: '' },
    { id: 'e2', type: 'id', q: 'Which one?', answer: 'f', exp: '' }
  ] });
  ctx.open(enumR);
  vm.runInContext("tab = 'enum';", ctx); ctx.quiz();
  ctx.answer(enumR.items[0], 'a, b');
  assert.strictEqual(enumR.ans.e0.ok, false, 'a partial list is not full credit');
  assert.ok(Math.abs(enumR.ans.e0.part - 2 / 3) < 1e-9, 'the earned fraction is stored');
  assert.match(screenText(appEl), /2 of 3 required answers were right/, 'the feedback shows the partial score');
  vm.runInContext('__credit = ' + JSON.stringify(enumR.ans.e0), ctx);
  assert.strictEqual(vm.runInContext('credit(__credit)', ctx), 2 / 3, 'the score uses the fraction');
  ctx.undoAnswer();
  assert.strictEqual(enumR.ans.e0, undefined, 'undo removes the answer');
  assert.strictEqual(enumR.plan.srs.e0, undefined, 'undo restores the empty schedule');
  ctx.answer(enumR.items[2], 'wrong');
  ctx.markCorrect(enumR, enumR.items[2]);
  assert.strictEqual(enumR.ans.e2.ok, true, 'a correct-by-hand answer is recorded');
  ctx.undoAnswer();
  assert.strictEqual(enumR.ans.e2.ok, false, 'undo puts the previous wrong answer back');
  const keptPart = ctx.cleanReviewer({ ...base, ans: { id0: { val: 'a', ok: false, exp: '', part: 0.5 } } });
  assert.strictEqual(keptPart.ans.id0.part, 0.5, 'a saved partial score survives validation');

  // 15. Phase 3/4: paste input, type toggles, sort, and duplicate-safe import.
  vm.runInContext('__raw = ' + JSON.stringify(' one \n\n two \r\n three '), ctx);
  assert.deepStrictEqual(plain(vm.runInContext('pasteLines(__raw)', ctx)), ['one', 'two', 'three'], 'pasted text is split into notes');
  assert.strictEqual(vm.runInContext('ITEM_CAP.mc', ctx), 30, 'the item cap is exposed to the interface');
  const quietGen = ctx.generate(['The CPU is the part of a computer that runs instructions.', 'RAM is memory that holds running programs.', 'A router is a device that forwards data between networks.', 'A switch is a device that connects devices inside one network.', 'A cache is a small fast memory placed close to the CPU.'], [], { noTF: true, noEnum: true });
  assert.ok(quietGen.length >= 3, 'notes still generate without true/false or enumeration');
  assert.ok(!quietGen.some(x => x.type === 'enum' || /^True or false: /.test(x.q)), 'the type toggles are honoured');

  const sortA = ctx.cleanReviewer({ ...base, title: 'Beta', plan: { exam: '', srs: {} } });
  const sortB = ctx.cleanReviewer({ ...base, title: 'Alpha', plan: { exam: isoIn(1), srs: {} } });
  vm.runInContext("qSort = 'title'", ctx);
  assert.deepStrictEqual(plain(ctx.sortReviewers([sortA, sortB]).map(r => r.title)), ['Alpha', 'Beta'], 'title sort');
  vm.runInContext("qSort = 'exam'", ctx);
  assert.deepStrictEqual(plain(ctx.sortReviewers([sortA, sortB]).map(r => r.title)), ['Alpha', 'Beta'], 'next-exam sort puts a dated reviewer first');
  vm.runInContext("qSort = 'recent'", ctx);

  const imp = ctx.cleanReviewer({ ...base, title: 'Group notes' });
  assert.strictEqual(ctx.sameReviewer(imp, ctx.cleanReviewer({ ...base, title: 'group notes' })), true, 'the same questions and title are the same reviewer');
  assert.strictEqual(ctx.sameReviewer(imp, sortA), false, 'a different title is a different reviewer');
  vm.runInContext('R = []', ctx);
  const realAsk = ctx.ask; ctx.ask = async () => true; // the on-page box needs a tap; the replace-duplicate path is tested with it answered yes
  const backup = JSON.stringify({ version: 2, reviewers: [imp], images: {} });
  await ctx.importFile({ text: async () => backup });
  const imported = vm.runInContext('R[0]', ctx);
  imported.ans.id0 = { val: 'a', ok: true, exp: '' };
  imported.plan.srs.id0 = { box: 1, due: ctx.todayNumber() + 3 };
  await ctx.importFile({ text: async () => backup });
  assert.strictEqual(vm.runInContext('R.length', ctx), 1, 'importing the same backup twice replaces instead of duplicating');
  const replaced = vm.runInContext('R[0]', ctx);
  assert.deepStrictEqual(plain(replaced.ans.id0), { val: 'a', ok: true, exp: '' }, 'replacing keeps the old progress');

  // 16. Phase 6 slice: one-question mode, position, flags and Jump.
  const oneR = ctx.cleanReviewer({ ...base, title: 'One at a time' });
  vm.runInContext("quizView = null; quizIndex = 0; localStorage.removeItem('reviewer_quiz_view');", ctx);
  sandbox.matchMedia = () => ({ matches: true });
  ctx.open(oneR);
  assert.strictEqual(vm.runInContext('viewMode()', ctx), 'one', 'a narrow screen defaults to one question');
  assert.match(screenText(appEl), /Q 1 of 3/, 'one mode shows the position');
  assert.strictEqual(screenText(appEl).includes('q1'), false, 'only the current card is rendered');
  assert.strictEqual(screenText(appEl).includes('q2'), false, 'the rest of the part is not rendered yet');
  ctx.nextQuiz();
  assert.match(screenText(appEl), /Q 2 of 3/, 'Next moves one card');
  assert.match(screenText(appEl), /q1/);
  assert.strictEqual(screenText(appEl).includes('q2'), false, 'the next card is still hidden');
  ctx.prevQuiz();
  ctx.nextQuiz();
  ctx.answer(oneR.items[1], oneR.items[1].answer);
  assert.match(screenText(appEl), /Correct\./);
  assert.match(screenText(appEl), /Next question →/, 'feedback offers the next card');
  const flagId = oneR.items[1].id;
  ctx.toggleFlag(oneR, oneR.items[1]);
  assert.ok(oneR.flags.includes(flagId), 'a flag is stored on the item');
  assert.match(screenText(appEl), /Flagged/);
  ctx.jumpScreen(oneR);
  assert.match(screenText(appEl), /Question 2 of 3/);
  const jumps = find(appEl, e => String(e.className).includes('jump-btn'));
  assert.strictEqual(jumps.length, 3, 'Jump lists every card in the part');
  jumps[2].onclick();
  assert.strictEqual(vm.runInContext('quizIndex', ctx), 2, 'a jump number moves to that card');
  vm.runInContext("setQuizView('list')", ctx);
  assert.strictEqual(vm.runInContext("localStorage.getItem('reviewer_quiz_view')", ctx), 'list', 'the layout choice is remembered');
  assert.match(screenText(appEl), /q2/, 'List shows the whole part again');
  assert.strictEqual(screenText(appEl).includes('q0'), true, 'List also shows the first card');
  ctx.shuffleAll();
  assert.ok(oneR.flags.includes(flagId), 'a flag follows its question through Shuffle');
  const flagR = ctx.cleanReviewer({ ...base, flags: ['id0', 'ghost', 5] });
  assert.deepStrictEqual(plain(flagR.flags), ['id0'], 'flags are validated on import');
  sandbox.matchMedia = () => ({ matches: false });
  vm.runInContext("quizView = null; localStorage.removeItem('reviewer_quiz_view');", ctx);
  assert.strictEqual(vm.runInContext('viewMode()', ctx), 'list', 'a wide screen defaults to the list');

  // 17. Stats panel: per-type accuracy, due and flagged counts.
  const statsR = ctx.cleanReviewer({
    title: 'Stats',
    items: [
      { id: 'm0', type: 'mc', q: 'Stat m0', options: ['A', 'B'], answer: 0, exp: '' },
      { id: 'm1', type: 'mc', q: 'Stat m1', options: ['A', 'B'], answer: 0, exp: '' },
      { id: 'i0', type: 'id', q: 'Stat i0', answer: 'one', exp: '' },
      { id: 'i1', type: 'id', q: 'Stat i1', answer: 'two', exp: '' },
      { id: 'e0', type: 'enum', q: 'Stat e0', items: ['a', 'b'], exp: '' },
      { id: 'e1', type: 'enum', q: 'Stat e1', items: ['c', 'd'], exp: '' }
    ],
    flags: ['m1', 'i1'],
    ans: {
      m0: { val: 0, ok: true, exp: 'A' },
      i0: { val: 'wrong', ok: false, exp: 'one' },
      e0: { val: 'a', ok: false, exp: 'a, b', part: 0.5 }
    },
    plan: { exam: '', srs: { m1: { box: 4, due: ctx.todayNumber() + 16 }, i1: { box: 0, due: ctx.todayNumber() } } }
  });
  const st = ctx.reviewerStats(statsR);
  const byType = {};
  st.types.forEach(t => { byType[t.key] = t; });
  assert.deepStrictEqual(plain(st.types.map(t => t.key)), ['mc', 'id', 'enum'], 'stats keep the question-type order');
  assert.strictEqual(byType.mc.answered, 1, 'answered counts only graded items');
  assert.strictEqual(byType.mc.accuracy, 100, 'a correct answer is 100%');
  assert.strictEqual(byType.id.accuracy, 0, 'a missed answer is 0%');
  assert.strictEqual(byType.enum.accuracy, 50, 'enumeration accuracy uses partial credit');
  assert.strictEqual(byType.mc.due, 1, 'a future-scheduled item is not due');
  assert.strictEqual(byType.id.due, 2, 'unscheduled and today-scheduled items are due');
  assert.strictEqual(byType.enum.due, 2, 'unscheduled items are due now');
  assert.strictEqual(byType.mc.flagged, 1);
  assert.strictEqual(byType.id.flagged, 1);
  assert.strictEqual(byType.enum.flagged, 0);
  assert.strictEqual(st.all.accuracy, 50, 'the total uses all earned credit');
  assert.strictEqual(st.all.due, 5, 'the total due count adds the types');
  assert.strictEqual(st.all.flagged, 2, 'the total flag count adds the types');
  const noStats = ctx.reviewerStats(ctx.cleanReviewer({ ...base }));
  assert.strictEqual(noStats.all.accuracy, null, 'no answers means no invented accuracy');
  assert.strictEqual(noStats.all.due, 3, 'unscheduled questions still count as due');
  ctx.open(statsR);
  assert.match(screenText(appEl), /Stats/);
  assert.match(screenText(appEl), /Accuracy/);
  assert.match(screenText(appEl), /100%/, 'the panel shows the correct percentage');
  assert.match(screenText(appEl), /50%/, 'the panel shows the partial-credit percentage');
  const tables = find(appEl, e => e.tagName === 'TABLE');
  assert.strictEqual(tables.length, 1, 'the stats panel renders one table');

  // A small spelling slip in a long answer is accepted, and the feedback says so; a different real term is still wrong.
  const spellR = ctx.cleanReviewer({ ...base, title: 'Spelling', items: ['Mitochondria', 'Photosynthesis', 'Meiosis'].map((k, i) => ({ id: 'sp' + i, type: 'id', q: 'q' + i, answer: k, exp: '' })) });
  ctx.open(spellR);
  ctx.answer(spellR.items[0], 'mitocondria');
  assert.strictEqual(spellR.ans.sp0.ok, true, 'one wrong letter in a long answer is accepted');
  assert.match(spellR.ans.sp0.exp, /check the spelling/i, 'the feedback points out the spelling');
  ctx.answer(spellR.items[1], 'Photosynthesis');
  assert.doesNotMatch(spellR.ans.sp1.exp, /spelling/i, 'an exact answer gets no spelling note');
  ctx.answer(spellR.items[2], 'mitosis');
  assert.strictEqual(spellR.ans.sp2.ok, false, 'a different real term is still wrong');

  // The skip report on the check screen: lines that could become questions are listed with the reason in words;
  // headings and objectives are only counted. It starts closed, so the questions stay first.
  const okNotes = ['Mitosis is the division of a nucleus into two identical nuclei.', 'Meiosis is a cell division that produces four haploid gametes.',
    'Interphase is the stage where the cell grows and copies its DNA.', 'Cytokinesis is the division of the cytoplasm after mitosis.',
    'Long chains of amino acids folded into shapes form the proteins of a cell.', 'Objectives', 'Explain the stages of mitosis'];
  vm.runInContext('pending = { title: "Report", items: generate(' + JSON.stringify(okNotes) + '), src: [], tags: [], opts: {}, hidden: [], removed: [] }', ctx);
  ctx.preview();
  const checkText = screenText(appEl);
  assert.match(checkText, /1 line could become a question/, 'the check screen counts the fixable lines');
  assert.match(checkText, /No term found/, 'the reason is explained in words');
  assert.ok(checkText.includes('Long chains of amino acids folded into shapes'), 'the skipped line itself is shown');
  assert.match(checkText, /2 headings, objectives or instructions were skipped on purpose/, 'furniture is counted');
  assert.ok(!checkText.includes('Explain the stages of mitosis'), 'an objective is counted, not listed');
  const report = find(appEl, e => e.tagName === 'DETAILS' && String(e.className).split(' ').includes('skips'));
  assert.strictEqual(report.length, 1, 'one report on the check screen');
  assert.strictEqual(report[0].attrs.open, undefined, 'the report starts closed on the check screen');

  // Too few questions: instead of a dead end, the error explains and the report is open with every fixable line.
  const fewNotes = ['Cell Biology Review', 'In every living cell, ribosomes build proteins from amino acids for the body.',
    'During photosynthesis plants turn light into sugar inside the green chloroplasts.', 'Within the membrane small channels let water move in and out of the cell.',
    'Long chains of amino acids folded into shapes form the proteins of a cell.'];
  vm.runInContext('cur = null; pending = null; files = []; pasteText = ' + JSON.stringify(fewNotes.join('\n')), ctx);
  await ctx.run();
  const fewText = screenText(appEl);
  assert.match(fewText, /No questions could be made from these notes/, 'the error says how many questions were possible');
  assert.match(fewText, /The list below shows why/, 'the error points at the report');
  assert.match(fewText, /4 lines could become questions/, 'the report counts the fixable lines');
  for (const line of fewNotes.slice(1)) assert.ok(fewText.includes(line.slice(0, 40)), 'every fixable line is listed: ' + line);
  assert.match(fewText, /Not a complete statement with a verb/, 'each reason is explained');
  const openReport = find(appEl, e => e.tagName === 'DETAILS' && String(e.className).split(' ').includes('skips'));
  assert.strictEqual(openReport.length, 1, 'the home screen shows the report after a failed build');
  assert.strictEqual(openReport[0].attrs.open, '', 'the report is already open after a failed build');
  // Only furniture (headings, instructions): there is no list to point at, so the error gives the general hint instead.
  const furnitureOnly = ['Instructions: Answer all the questions below carefully and completely.', 'II. Write TRUE if the statement is correct and FALSE if not.',
    'Why is the cell membrane so important to every living cell?', 'Chapter 4 Review', 'Cell Biology Review'];
  vm.runInContext('pasteText = ' + JSON.stringify(furnitureOnly.join('\n')), ctx);
  await ctx.run();
  const furnText = screenText(appEl);
  assert.match(furnText, /No questions could be made/);
  assert.doesNotMatch(furnText, /list below/, 'no promise of a list that is not there');
  assert.match(furnText, /full sentences/, 'the general hint is given instead');
  assert.strictEqual(find(appEl, e => e.tagName === 'DETAILS' && String(e.className).split(' ').includes('skips')).length, 0, 'no empty report');
  vm.runInContext("pasteText = ''", ctx);

  // From a student test on a phone.
  // A "Note:" line is skipped on purpose: counted, never listed as a line that could become a question.
  vm.runInContext('pending = { title: "Notes", items: generate(' + JSON.stringify([...okNotes, 'Note: Quiz on Friday!']) + '), src: [], tags: [], opts: {}, hidden: [], removed: [] }', ctx);
  ctx.preview();
  assert.ok(!screenText(appEl).includes('Quiz on Friday'), 'a note to the reader is not listed as fixable');
  assert.match(screenText(appEl), /3 headings, objectives or instructions were skipped on purpose/, 'the note is counted as skipped on purpose');
  // Saving clears the pasted notes, so pressing Generate again does not make a duplicate reviewer.
  vm.runInContext('pasteText = "some pasted notes"', ctx);
  ctx.savePending();
  assert.strictEqual(vm.runInContext('pasteText', ctx), '', 'the notes box is cleared after saving');
  // Home: saved reviewers come before the new-reviewer form; the app does not repeat the browser's "No file chosen".
  ctx.home();
  const homeText = screenText(appEl);
  assert.ok(homeText.indexOf('Saved reviewers') >= 0 && homeText.indexOf('Saved reviewers') < homeText.indexOf('Generate reviewer'), 'saved reviewers are above the form');
  assert.ok(!homeText.includes('No file chosen'), 'no second "No file chosen" line');
  // The backup reminder waits until the oldest reviewer is 14 days old when nothing was ever backed up.
  vm.runInContext('localStorage.removeItem(BACKUP_KEY)', ctx);
  ctx.home();
  assert.ok(!screenText(appEl).includes('No backup in the last 14 days'), 'no backup warning on the first day');
  vm.runInContext('R.push({ ...R[0], id: (Date.now() - 20 * 864e5) * 1000, title: "Old one" })', ctx);
  ctx.home();
  assert.match(screenText(appEl), /No backup in the last 14 days/, 'the warning shows once a reviewer is old enough');
  vm.runInContext('R.pop()', ctx);
  // Quiz on a phone: the question comes before the extra tools, options start with a capital, and the spelling note
  // shows what was typed.
  const phoneR = ctx.cleanReviewer({ ...base, title: 'Phone', items: [
    { id: 'p0', type: 'mc', q: 'Fill in the blank: The _____ controls what enters and leaves the cell.', options: ['cell membrane', 'nucleus', 'cytoplasm', 'cell wall'], answer: 0, exp: '' },
    { id: 'p1', type: 'id', q: 'Which term is described? The powerhouse of the cell', answer: 'Mitochondria', exp: 'Mitochondria is the powerhouse of the cell.' },
    { id: 'p2', type: 'id', q: 'Which term is described? The control center of the cell', answer: 'Nucleus', exp: 'The nucleus is the control center of the cell.' }] });
  vm.runInContext("quizView = null; localStorage.removeItem('reviewer_quiz_view');", ctx);
  const wideMedia = sandbox.matchMedia;
  sandbox.matchMedia = () => ({ matches: true }); // a phone-width screen
  ctx.open(phoneR);
  assert.strictEqual(vm.runInContext('viewMode()', ctx), 'one', 'the phone test runs in the one-question view');
  const qText = screenText(appEl);
  assert.ok(qText.indexOf('controls what enters') < qText.indexOf('Review due'), 'the question comes before "Review due" on a phone');
  assert.ok(qText.indexOf('controls what enters') < qText.indexOf('More options'), 'the question comes before "More options" on a phone');
  const optTexts = find(appEl, e => e.tagName === 'BUTTON' && String(e.className).split(' ').includes('opt')).map(screenText);
  assert.ok(optTexts.length === 4 && optTexts.every(t => /^[A-D]\s*[A-Z]/.test(t.trim())), 'options start with a capital: ' + optTexts.join(' | '));
  vm.runInContext("tab = 'id'; quizIndex = 0;", ctx);
  ctx.quiz();
  ctx.answer(phoneR.items[1], 'mitocondria');
  assert.match(phoneR.ans.p1.exp, /you typed "mitocondria"/, 'the spelling note shows what was typed');
  // "Show in my notes" stays open when the quiz redraws (a phone turning sideways redraws it).
  const srcBtn = find(appEl, e => e.tagName === 'BUTTON' && /Show in my notes/.test(screenText(e)))[0];
  srcBtn.onclick({ currentTarget: srcBtn });
  ctx.quiz();
  const srcWrap = find(appEl, e => e.attrs && e.attrs.id === 'src-p1')[0];
  assert.ok(srcWrap && srcWrap.attrs.hidden === undefined, 'the notes panel is still open after a redraw');
  sandbox.matchMedia = wideMedia;

  // Filipino exam formats in the app: Matching type and Modified true or false get their own tabs, are graded, survive a
  // reload, and show up in flashcards and recitation.
  const formatR = ctx.cleanReviewer({ ...base, title: 'Exam formats', items: [
    { id: 'm0', type: 'match', q: 'Matching type (set 1): match each description with the term it describes.',
      pairs: [{ term: 'Mitosis', desc: 'Division into two identical nuclei' }, { term: 'Meiosis', desc: 'Division that makes four gametes' }, { term: 'Osmosis', desc: 'Diffusion of water' }],
      terms: ['Osmosis', 'Mitosis', 'Meiosis'], exp: 'Mitosis is the division into two identical nuclei.' },
    { id: 't0', type: 'mtf', q: 'Modified true or false: [Osmosis] is the division into two identical nuclei. Write TRUE if it is correct; if not, write the word that should replace the one in brackets.', answer: 'Mitosis', exp: 'Mitosis is the division into two identical nuclei.' },
    { id: 't1', type: 'mtf', q: 'Modified true or false: [Osmosis] is the diffusion of water. Write TRUE if it is correct; if not, write the word that should replace the one in brackets.', answer: 'TRUE', exp: 'Osmosis is the diffusion of water.' }] });
  assert.ok(formatR && formatR.items.length === 3, 'matching and modified true or false items pass validation');
  ctx.open(formatR);
  const formatText = screenText(appEl);
  assert.match(formatText, /Matching type/, 'a Matching type tab');
  assert.match(formatText, /Modified true or false/, 'a Modified true or false tab');
  ctx.answer(formatR.items[1], 'mitosis');
  assert.strictEqual(formatR.ans.t0.ok, true, 'a false statement is answered with the right word');
  ctx.answer(formatR.items[2], 'true');
  assert.strictEqual(formatR.ans.t1.ok, true, 'a correct statement is answered TRUE');
  vm.runInContext("tab = 'match'; quizIndex = 0;", ctx);
  ctx.quiz();
  const selects = find(appEl, e => e.tagName === 'SELECT' && /^Term for/.test(e.attrs['aria-label'] || ''));
  assert.strictEqual(selects.length, 3, 'one term picker per description');
  ctx.answer(formatR.items[0], ['Mitosis', 'Osmosis', 'Osmosis']);
  assert.strictEqual(formatR.ans.m0.ok, false, 'a wrong pair makes the set wrong');
  assert.ok(Math.abs(formatR.ans.m0.part - 2 / 3) < 1e-9, 'each right pair earns its share (2 of 3 here)');
  assert.match(formatR.ans.m0.exp, /Division that makes four gametes → Meiosis/, 'the feedback lists the right pairs');
  const reloaded = ctx.cleanReviewer(JSON.parse(JSON.stringify(formatR)));
  assert.ok(reloaded.ans.m0 && reloaded.ans.t0, 'matching and modified true or false answers survive a reload');
  assert.match(ctx.flashAnswer(formatR.items[0]), /Mitosis/, 'a matching set has a flashcard answer');
  assert.strictEqual(ctx.flashAnswer(formatR.items[1]), 'Mitosis', 'a modified true or false flashcard shows its answer');
  assert.match(ctx.reciteQuestion(formatR.items[0]), /Division that makes four gametes/, 'recitation reads the descriptions');
  assert.match(ctx.reciteAnswer(formatR.items[0]), /Meiosis/, 'recitation reads the pairs');

  // Sessions across reviewers ("My mistakes", Periodical exam): copies of questions whose answers and schedule are
  // written back to the reviewer each came from; undo restores the original's old answer.
  const mkR = (title, pre) => ctx.cleanReviewer({ ...base, title, items: ['x', 'y', 'z'].map((k, i) => ({ id: 'id' + i, type: 'id', q: title + ' question ' + k, answer: k + 'ans', exp: '' })),
    ans: { id0: { val: 'wrong', ok: false, exp: pre + 'x' }, id1: { val: 'yans', ok: true, exp: 'yans' } } });
  const bio = mkR('Bio', 'b'), chem = mkR('Chem', 'c');
  vm.runInContext('R = []', ctx); vm.runInContext('R.push(' + JSON.stringify(bio) + ', ' + JSON.stringify(chem) + ')', ctx);
  ctx.home();
  const mistakesBtn = find(appEl, e => e.tagName === 'BUTTON' && /My mistakes \(2\)/.test(screenText(e)))[0];
  assert.ok(mistakesBtn, 'home offers "My mistakes (2)" across reviewers');
  mistakesBtn.onclick();
  assert.strictEqual(vm.runInContext('cur.virtual', ctx), 'mistakes', 'a mistakes session opens');
  assert.strictEqual(vm.runInContext('cur.items.length', ctx), 2, 'one question per missed item, from both reviewers');
  assert.strictEqual(vm.runInContext('Object.keys(cur.ans).length', ctx), 0, 'the mistakes are asked again from scratch');
  const mText = screenText(appEl);
  assert.ok(!/\bShuffle\b|\bRename\b|Add a question/.test(mText), 'tools that would only change copies are hidden');
  assert.ok(!find(appEl, e => e.tagName === 'BUTTON' && screenText(e) === 'Edit').length, 'no Edit on a copy');
  vm.runInContext("tab = 'id'; quizIndex = 0;", ctx);
  vm.runInContext('answer(cur.items[0], "xans")', ctx);
  assert.strictEqual(vm.runInContext('R[0].ans.id0.ok', ctx), true, 'the right answer is written back to Bio');
  assert.ok(vm.runInContext('R[0].plan.srs.id0.box', ctx) >= 1, 'the schedule moves forward in Bio');
  vm.runInContext('undoAnswer()', ctx);
  assert.strictEqual(vm.runInContext('R[0].ans.id0.val', ctx), 'wrong', 'undo puts Bio\'s old answer back');
  // Periodical exam: pick reviewers, get Test I, Test II, … from all of them; answers count in each reviewer.
  ctx.periodicalSetup();
  assert.match(screenText(appEl), /Periodical exam/, 'a periodical exam screen');
  ctx.startPeriodical([vm.runInContext('R[0].id', ctx), vm.runInContext('R[1].id', ctx)], 0);
  assert.strictEqual(vm.runInContext('cur.virtual', ctx), 'exam', 'the exam opens');
  assert.strictEqual(vm.runInContext('cur.items.length', ctx), 6, 'every question of both reviewers');
  assert.match(screenText(appEl), /Test I\. Identification/, 'parts are named like an exam paper');
  vm.runInContext('answer(cur.items.find(i => i.q === "Chem question z"), "zans")', ctx);
  assert.strictEqual(vm.runInContext('R[1].ans.id2.ok', ctx), true, 'an exam answer counts in its own reviewer');
  // Cram mode: the exam is tomorrow, so every card not yet known, missed ones first, no daily limit.
  const tomorrow = new Date(Date.now() + 864e5); const ymd = tomorrow.getFullYear() + '-' + String(tomorrow.getMonth() + 1).padStart(2, '0') + '-' + String(tomorrow.getDate()).padStart(2, '0');
  vm.runInContext('R[0].plan.exam = ' + JSON.stringify(ymd) + '; R[0].flashKnown = ["id1"]; R[0].ans.id0 = { val: "wrong", ok: false, exp: "x" };', ctx);
  vm.runInContext('open(R[0])', ctx);
  const cramBtn = find(appEl, e => e.tagName === 'BUTTON' && /Cram/.test(screenText(e)))[0];
  assert.ok(cramBtn, 'a Cram button when the exam is tomorrow');
  cramBtn.onclick();
  const order = vm.runInContext('flashOrder.map(i => cur.items[i].id)', ctx);
  assert.deepStrictEqual(plain(order), ['id0', 'id2'], 'cram: the missed card first, the known card left out');

  // Share in a group chat: the link itself carries the questions and notes (compressed), never the sharer's answers or
  // schedule; opening it asks, then imports through the same validation as a backup file. Real browser APIs for this part.
  const stubs = { Blob: sandbox.Blob, ask: ctx.ask };
  Object.assign(sandbox, { Blob, Response, CompressionStream, DecompressionStream, TextEncoder, TextDecoder, btoa, atob,
    location: { href: 'https://example.test/app/', pathname: '/app/', search: '', hash: '' } });
  const link = await ctx.shareLink(vm.runInContext('R[0]', ctx));
  assert.match(link, /^https:\/\/example\.test\/app\/#share=[A-Za-z0-9_-]+$/, 'a link with the reviewer packed in');
  assert.ok(link.length <= 8000, 'short enough for a chat app');
  const packed = await ctx.unpack(link.split('#share=')[1]);
  assert.deepStrictEqual(plain(packed.reviewers[0].ans), {}, 'the sharer\'s answers are not shared');
  assert.strictEqual(packed.reviewers[0].plan.exam, '', 'nor the exam date');
  vm.runInContext('R = []', ctx); ctx.ask = async () => true;
  await ctx.openShared(link.split('#share=')[1]);
  assert.strictEqual(vm.runInContext('R.length + " " + R[0].title', ctx), '1 Bio', 'opening the link adds the reviewer');
  await ctx.openShared('this-is-not-a-reviewer');
  assert.match(screenText(appEl), /share link is broken/, 'a broken link is refused politely');
  const huge = ctx.cleanReviewer({ ...base, title: 'Huge', items: Array.from({ length: 400 }, (_, i) => ({ id: 'id' + i, type: 'id', q: 'Question ' + i + ' ' + Math.random().toString(36).repeat(4), answer: 'a' + Math.random().toString(36), exp: '' })) });
  assert.strictEqual(await ctx.shareLink(huge), null, 'a reviewer too big for a link is not shared by link');
  Object.assign(sandbox, stubs); ctx.ask = stubs.ask;

  // Quiz Bee: players pass one phone; each turn starts with "Pass to …" so nobody sees the next question early; a right
  // answer scores, a timeout does not; the end shows the winner. A game does not change the owner's study progress.
  const beeR = ctx.cleanReviewer({ ...base, title: 'Bee', items: [0, 1, 2, 3].map(i => ({ id: 'b' + i, type: 'mc', q: 'Bee question ' + i, options: ['right' + i, 'wrong' + i], answer: 0, exp: '' })) });
  vm.runInContext('R = [' + JSON.stringify(beeR) + ']; open(R[0]);', ctx);
  ctx.beeStart(['Ana', 'Ben'], 2, 20);
  assert.match(screenText(appEl), /Pass the phone to\s+Ana/, 'each turn starts by passing the phone');
  ctx.beeReady();
  const beeQ = vm.runInContext('bee.queue[bee.turn]', ctx);
  ctx.beeAnswer(0);
  assert.match(screenText(appEl), /Correct/, 'a right answer is confirmed');
  assert.strictEqual(vm.runInContext('bee.players[0].score', ctx), 1, 'Ana scores');
  ctx.beeNext(); ctx.beeReady(); ctx.beeTimeout();
  assert.match(screenText(appEl), /Time is up/, 'a timeout says so');
  assert.strictEqual(vm.runInContext('bee.players[1].score', ctx), 0, 'Ben does not score on a timeout');
  ctx.beeNext(); ctx.beeReady(); ctx.beeAnswer(0); ctx.beeNext(); ctx.beeReady(); ctx.beeAnswer(1); ctx.beeNext();
  assert.match(screenText(appEl), /Ana\s+wins/, 'the scoreboard names the winner');
  assert.deepStrictEqual(plain(vm.runInContext('R[0].ans', ctx)), {}, 'the game leaves the owner\'s answers alone');
  assert.ok(beeQ && beeQ.q, 'questions come from the reviewer');
  vm.runInContext('beeStop()', ctx);

  // Blurt: write everything you remember; the check lists the key terms recalled and missed (with the note that has
  // each missed one), forgiving a spelling slip, and offers the missed ones as flashcards.
  const blurtR = ctx.cleanReviewer({ ...base, title: 'Cells', items: [
    { id: 'u0', type: 'id', q: 'Which term is described? The powerhouse of the cell', answer: 'Mitochondria', exp: 'Mitochondria is the powerhouse of the cell.' },
    { id: 'u1', type: 'id', q: 'Which term is described? The control center of the cell', answer: 'Nucleus', exp: 'The nucleus is the control center of the cell.' },
    { id: 'u2', type: 'mc', q: 'Which term is described? Makes proteins', options: ['Ribosome', 'Vacuole'], answer: 0, exp: 'A ribosome makes proteins.' },
    { id: 'u3', type: 'enum', q: 'Enumerate: Types of passive transport', items: ['Diffusion', 'Osmosis'], exp: '' }] });
  vm.runInContext('R = [' + JSON.stringify(blurtR) + ']; open(R[0]);', ctx);
  ctx.blurt();
  assert.match(screenText(appEl), /everything you remember/i, 'the blurt page asks for everything remembered');
  const res = ctx.blurtCheck('The mitocondria makes energy. Osmosis moves water. The nucleus controls the cell.');
  assert.deepStrictEqual(plain(res.recalled).sort(), ['Mitochondria', 'Nucleus', 'Osmosis'], 'recalled terms, a spelling slip forgiven');
  assert.deepStrictEqual(plain(res.missed).sort(), ['Diffusion', 'Ribosome'], 'missed terms');
  const blurtText = screenText(appEl);
  assert.match(blurtText, /3 of 5/, 'the score');
  assert.ok(blurtText.includes('A ribosome makes proteins.'), 'a missed term shows the note it comes from');
  find(appEl, e => e.tagName === 'BUTTON' && /Study the missed ones/.test(screenText(e)))[0].onclick();
  assert.deepStrictEqual(plain(vm.runInContext('flashOrder.map(i => cur.items[i].id)', ctx)), ['u2', 'u3'], 'the missed terms become flashcards');

  // First visit: one tap builds a reviewer from bundled sample notes.
  vm.runInContext('R = []; cur = null; pending = null; files = [];', ctx);
  ctx.home();
  const sampleBtn = find(appEl, e => e.tagName === 'BUTTON' && /Biology sample/.test(screenText(e)))[0];
  assert.ok(sampleBtn, 'a first-time visitor is offered sample notes');
  await sampleBtn.onclick();
  assert.match(screenText(appEl), /Check your questions/, 'the sample builds a reviewer to check');
  assert.ok(vm.runInContext('pending.items.length', ctx) >= 8, 'the sample makes a real set of questions');
  ctx.home();
  vm.runInContext('pasteText = ""', ctx);

  // From the third student test.
  // "Show in my notes" finds the question's own sentence even when the PDF split it over two lines, and never lands on
  // an unrelated line that merely contains the answer word (an exam option "C. Saving files to storage").
  const srcR = ctx.cleanReviewer({ ...base, title: 'Notes', src: ['C. Saving files to storage', '10. Which bus carries data between the CPU, memory, and input/output devices?',
    'Data representation', 'Characters are stored as bytes using the directives', 'DB (Define Byte) and DW (Define Word) in assembly.'],
    items: [{ id: 'n0', type: 'id', q: 'Which term is described? Stored as bytes using the directives DB and DW', answer: 'storage', exp: '(page 2) Characters are stored as bytes using the directives DB (Define Byte) and DW (Define Word) in assembly.' },
      { id: 'n1', type: 'id', q: 'Which term is described? A missing line', answer: 'storage', exp: '(page 9) Memory storage keeps data while the power is on.' },
      { id: 'n2', type: 'id', q: 'q', answer: 'x', exp: '' }] });
  const found = ctx.sourceLine(srcR, srcR.items[0]);
  assert.strictEqual(found && found.at, 3, 'the sentence split over two lines is found, not the option line');
  assert.strictEqual(ctx.sourceLine(srcR, srcR.items[1]), null, 'a sentence that is not in the notes is not replaced by a line containing the answer');
  vm.runInContext('R = [' + JSON.stringify(srcR) + ']; open(R[0]); R[0].ans.n1 = { val: "storage", ok: true, exp: "storage" }; quiz();', ctx);
  vm.runInContext("quizView = 'list'; quiz();", ctx);
  const n1Btn = find(appEl, e => e.tagName === 'BUTTON' && e.attrs['aria-controls'] === 'src-n1')[0];
  n1Btn.onclick({ currentTarget: n1Btn });
  const n1Text = screenText(find(appEl, e => e.attrs && e.attrs.id === 'src-n1')[0]);
  assert.ok(n1Text.includes('Memory storage keeps data') && !n1Text.includes('Saving files'), 'it shows the question\'s own sentence instead: ' + n1Text);
  // Modified true or false states its directions once for the part, like Test II of a paper, not on every item.
  const mtfR = ctx.cleanReviewer({ ...base, title: 'MTF', items: [0, 1, 2].map(i => ({ id: 'f' + i, type: 'mtf', q: 'Modified true or false: [Osmosis] is statement ' + i + '.', answer: 'TRUE', exp: '' })) });
  vm.runInContext('R = [' + JSON.stringify(mtfR) + ']; open(R[0]); quizView = "list"; quiz();', ctx);
  const mtfScreen = screenText(appEl);
  assert.strictEqual((mtfScreen.match(/Write TRUE/g) || []).length, 1, 'the directions appear once for the part');
  const fresh = ctx.generate(['Mitosis is the division of a nucleus into two identical nuclei.', 'Meiosis is a cell division that produces four haploid gametes.',
    'Osmosis is the diffusion of water across a membrane.', 'Diffusion is the movement of particles from high to low concentration.']).filter(q => q.type === 'mtf');
  assert.ok(fresh.length && fresh.every(q => !/Write TRUE/.test(q.q)), 'generated items no longer repeat the directions');
  // A matching set on a flashcard is a list of pairs, not one long paragraph, and the notes are not repeated under it.
  vm.runInContext('R = [' + JSON.stringify(formatR) + ']; open(R[0]); startFlash("all"); flashIndex = flashOrder.indexOf(0); flashRevealed = true; flipcards();', ctx);
  const pairList = find(appEl, e => String(e.className || '').split(' ').includes('pairs'));
  assert.strictEqual(pairList.length, 1, 'the answer is one block of pairs');
  assert.strictEqual(pairList[0].children.length, 3, 'one line per pair');
  assert.ok(!screenText(appEl).includes('From your reviewer notes'), 'the notes are not repeated under the pairs');
  // A periodical exam ends with one total score, and its setup does not redraw (and lose focus) on every tick.
  const phys = mkR('Physics', 'p'), chem2 = mkR('Chemistry', 'q');
  vm.runInContext('R = [' + JSON.stringify(phys) + ', ' + JSON.stringify(chem2) + ']; examPick = new Set();', ctx);
  ctx.periodicalSetup();
  const ticks = find(appEl, e => e.tagName === 'INPUT' && e.attrs.type === 'checkbox');
  ticks[0].checked = true; ticks[0].onchange({ target: ticks[0] });
  assert.ok(find(appEl, e => e === ticks[0]).length === 1, 'ticking a reviewer keeps the same screen (focus stays)');
  const startBtn = find(appEl, e => e.tagName === 'BUTTON' && /Start exam/.test(screenText(e)))[0];
  assert.strictEqual(startBtn.attrs.disabled, undefined, 'Start is enabled once a reviewer is ticked');
  ctx.startPeriodical([vm.runInContext('R[0].id', ctx), vm.runInContext('R[1].id', ctx)], 0);
  vm.runInContext('cur.items.forEach(it => answer(it, it.answer))', ctx);
  assert.match(screenText(appEl), /Final score: 6 of 6/, 'the exam ends with one total score');
  // Delete is set apart from the everyday buttons on a saved reviewer.
  ctx.home();
  const del = find(appEl, e => e.tagName === 'BUTTON' && screenText(e) === 'Delete')[0];
  assert.ok(String(del.className).includes('danger'), 'Delete is styled apart');

  console.log('app smoke checks passed');
})().catch(e => { console.error(e); process.exit(1); });
