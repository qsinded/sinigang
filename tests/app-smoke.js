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

  console.log('app smoke checks passed');
})().catch(e => { console.error(e); process.exit(1); });
