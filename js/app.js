const app = document.getElementById('app');
const KEY = 'reviewer_gen_v1';
let mem = [];
let saveWarn = ''; // shown to the student when the device cannot store their reviewers
const STORAGE_FULL = 'Not saved: this device\'s storage is full. Delete a saved reviewer to free space. Your work is kept only until you close this page.';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || mem; } catch (e) { return mem; } };
const save = () => {
  try { localStorage.setItem(KEY, JSON.stringify(R)); saveWarn = ''; }
  catch (e) { mem = R; saveWarn = STORAGE_FULL; }
};
const warn = () => saveWarn && h('p', { class: 'err', role: 'alert' }, saveWarn);
let R = load();
let q = '', optMax = 0, optMc = false, pending = null, cur = null, tab = null, files = [], status = '', err = '', busy = false;
const draft = {};

function h(tag, p, ...kids) {
  const e = document.createElement(tag);
  for (const k in (p || {})) {
    if (p[k] == null) continue;
    if (k.startsWith('on')) e[k] = p[k]; else if (k === 'class') e.className = p[k]; else e.setAttribute(k, p[k]);
  }
  kids.flat().forEach(c => { if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c)); });
  return e;
}
// Header, footer and the screen-reader announcer live outside #app so redraws do not remove them.
const live = h('p', { class: 'sr', 'aria-live': 'polite' });
const say = msg => { live.textContent = ''; live.textContent = msg; };
const THEME = 'reviewer_theme', root = document.documentElement;
try { const t = localStorage.getItem(THEME); if (t === 'dark' || t === 'light') root.dataset.theme = t; } catch (e) { /* no storage: follow the system */ }
const dark = () => (root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
const themeLabel = () => dark() ? '☀ Light mode' : '☾ Dark mode';
const themeBtn = h('button', { class: 'btn alt', onclick: () => {
  root.dataset.theme = dark() ? 'light' : 'dark';
  try { localStorage.setItem(THEME, root.dataset.theme); } catch (e) { /* kept for this visit only */ }
  themeBtn.textContent = themeLabel();
} }, themeLabel());
app.tabIndex = -1; // lets the skip link move focus into the page
app.before(h('header', { class: 'site' }, h('a', { class: 'skip', href: '#app' }, 'Skip to content'), h('nav', { 'aria-label': 'Main' }, h('button', { class: 'btn alt', onclick: () => home() }, 'Home'), themeBtn), live));
app.after(h('footer', { class: 'site' }, 'Works offline. Progress is saved on this device only. ',
  h('span', { class: 'keys' }, 'Keys: 1–4 pick an answer, Ctrl+Enter checks a list, ← → cards, Space flips.')));
// A new screen gets its own page title and focus on its heading, so screen readers hear the change. Redraws of the same screen keep focus alone.
let lastScreen = '';
function draw(node, screen) {
  const y = scrollY, first = !lastScreen; app.replaceChildren(node); scrollTo(0, y);
  if (!screen || screen === lastScreen) return;
  lastScreen = screen;
  const t = node.querySelector('h1'); document.title = (t ? t.textContent + ' · ' : '') + 'Reviewer Generator';
  if (t && !first) { t.tabIndex = -1; t.focus(); }
}
const bar = (pct, label) => h('div', { class: 'bar', role: 'progressbar', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(pct) }, h('i', { style: 'width:' + pct + '%' }));

// Classic scripts, worker runs on the main thread: phone HTML viewers block module imports and Workers.
function loadPdfjs() { pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.js'; return pdfjsLib; }
async function pdfLines(pdfjs, buf, tags) {
  const doc = await pdfjs.getDocument({ data: buf }).promise, out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    status = 'Reading page ' + p + ' of ' + doc.numPages + '…'; home();
    const tc = await (await doc.getPage(p)).getTextContent(), before = out.length;
    let line = '', y = null;
    for (const it of tc.items) {
      if (y !== null && Math.abs(it.transform[5] - y) > 2) { out.push(line); line = ''; }
      line += it.str; y = it.transform[5];
    }
    out.push(line);
    for (let i = before; i < out.length; i++) tags[i] = 'page ' + p;
  }
  return out;
}

// Backup file: every field is rebuilt from scratch so a hand-edited file cannot add anything the app does not expect.
const str = (v, max = 5000) => typeof v === 'string' ? v.slice(0, max) : null;
function cleanItem(x) {
  if (!x || !['mc', 'id', 'enum'].includes(x.type)) return null;
  const id = str(x.id, 40), q = str(x.q), exp = str(x.exp) ?? '';
  if (!id || !q) return null;
  if (x.type === 'mc') {
    const options = Array.isArray(x.options) ? x.options.map(o => str(o)) : [];
    if (options.length < 2 || options.length > 4 || options.includes(null) || !Number.isInteger(x.answer) || x.answer < 0 || x.answer >= options.length) return null;
    return { id, type: 'mc', q, options, answer: x.answer, exp };
  }
  if (x.type === 'id') { const answer = str(x.answer); return answer ? { id, type: 'id', q, answer, exp } : null; }
  const items = Array.isArray(x.items) ? x.items.map(o => str(o)) : [];
  return items.length && !items.includes(null) ? { id, type: 'enum', q, items, exp } : null;
}
function cleanReviewer(x, i) {
  const title = str(x && x.title, 120), items = Array.isArray(x && x.items) ? x.items.map(cleanItem).filter(Boolean) : [];
  if (!title || items.length < 3) return null;
  const ids = new Set(items.map(it => it.id)), ans = {};
  for (const k in (x.ans || {})) {
    const a = x.ans[k];
    if (ids.has(k) && a && typeof a.ok === 'boolean' && str(a.exp) !== null && (typeof a.val === 'string' || Number.isInteger(a.val))) ans[k] = { val: a.val, ok: a.ok, exp: a.exp };
  }
  const idList = v => Array.isArray(v) ? v.filter(k => ids.has(k)) : [];
  const src = Array.isArray(x.src) && x.src.every(l => typeof l === 'string') ? x.src : undefined;
  const tags = src && Array.isArray(x.tags) && x.tags.length === src.length && x.tags.every(g => typeof g === 'string') ? x.tags : undefined;
  const o = x.opts || {}, opts = { max: Number.isInteger(o.max) && o.max > 0 ? o.max : 0, mcOnly: o.mcOnly === true };
  return { id: Date.now() + i, title, items, ans, flashKnown: idList(x.flashKnown), flashLearn: idList(x.flashLearn), src, tags, opts };
}
let note = ''; // one-time message shown on the home screen after export or import
function exportAll() {
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(R)], { type: 'application/json' })), download: 'reviewers.json' });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  note = 'Saved ' + R.length + ' reviewer(s) to reviewers.json. Check your Downloads.'; home();
}
async function importFile(f) {
  try {
    const data = JSON.parse(await f.text());
    const list = (Array.isArray(data) ? data : [data]).map(cleanReviewer).filter(Boolean);
    if (!list.length) throw new Error('no reviewers');
    R.unshift(...list); save(); note = 'Imported ' + list.length + ' reviewer(s).';
  } catch (e) { note = 'Could not import: this is not a reviewer backup file.'; }
  home();
}

async function run() {
  busy = true; err = ''; status = 'Starting…'; home();
  try {
    let lines = [], tags = [];
    for (const f of files) {
      const t = []; let l; // t[i] = page or slide of l[i]
      if (/\.pdf$/i.test(f.name)) l = await pdfLines(loadPdfjs(), await f.arrayBuffer(), t);
      else if (/\.pptx$/i.test(f.name)) l = await pptxLines(await f.arrayBuffer(), t);
      else if (/\.docx$/i.test(f.name)) l = await docxLines(await f.arrayBuffer());
      else if (/\.doc$/i.test(f.name)) throw new Error('Old .doc files cannot be read. In Word use Save As > .docx (or PDF), then pick that file.');
      else if (/\.ppt$/i.test(f.name)) l = pptLines(await f.arrayBuffer(), t);
      else l = (await f.text()).split(/\r?\n/);
      lines.push(...l); tags.push(...l.map((_, i) => t[i] || ''));
    }
    if (lines.join('').length < 200) throw new Error('No readable text found. Scanned PDFs or slides that are only pictures cannot be read offline.');
    status = 'Building items…'; home();
    const opts = { max: optMax, mcOnly: optMc }, items = generate(lines, tags, opts);
    if (items.length < 3) throw new Error('Could not find enough definitions or lists in this file. Notes written as full sentences ("X is …") work best.');
    const title = document.getElementById('title').value.trim() || files[0].name.replace(/\.[^.]+$/, '');
    pending = { title, items, src: lines, tags, opts }; files = []; preview(); // saved only after the student checks the questions
  } catch (e) { err = String(e.message || e); }
  busy = false; status = ''; if (!cur && !pending) home();
}

function savePending() {
  const p = pending, r = { id: Date.now(), title: p.title, items: p.items, ans: {}, src: p.src, tags: p.tags, opts: p.opts };
  pending = null; R.unshift(r); save(); open(r);
}
let removedAt = null;
function preview() {
  const p = pending, few = p.items.length < 3;
  draw(h('div', null,
    h('button', { class: 'btn alt', onclick: () => home() }, '← Cancel'),
    h('h1', null, 'Check your questions'),
    h('p', { class: 'sub' }, 'Remove any question that looks wrong or confusing, then save. Shuffle later builds a fresh set from your file, so removed questions can come back.'),
    h('div', { class: 'row' }, h('button', { class: 'btn', disabled: few ? '' : null, onclick: savePending }, 'Save reviewer (' + p.items.length + ' questions)'),
      few && h('span', { class: 'err' }, 'Keep at least 3 questions.')),
    h('div', { class: 'items' }, p.items.map((it, i) => h('div', { class: 'card' },
      h('div', { class: 'k' }, TABS[it.type]), h('div', { class: 'q' }, it.q), h('p', null, 'Answer: ' + flashAnswer(it)),
      h('button', { class: 'btn alt', 'aria-label': 'Remove question ' + (i + 1), onclick: () => { p.items.splice(i, 1); removedAt = i; preview(); say('Removed. ' + p.items.length + ' questions left.'); } }, 'Remove'))))), 'preview');
  // The removed card is gone; put focus on the Remove button that took its place.
  const rm = app.querySelectorAll('.card .btn'); if (rm.length && removedAt !== null) rm[Math.min(removedAt, rm.length - 1)].focus();
  removedAt = null;
}

function home() {
  pending = null;
  const list = h('div', { class: 'list' });
  flashing = false; stopTimer();
  const n = note; note = '';
  const t = document.getElementById('title'), tv = t ? t.value : '';
  const node = h('div', null,
    h('h1', null, 'Reviewer Generator'),
    h('p', { class: 'sub' }, 'Pick a PDF, PowerPoint (.pptx), Word (.docx) or text file. The reviewer is built on this device, no internet needed.'),
    warn(),
    h('div', { class: 'card' },
      h('input', { type: 'file', id: 'file', 'aria-label': 'Choose a PDF, PowerPoint, Word or text file', accept: '.pdf,.pptx,.ppt,.docx,.doc,.txt,.md,text/plain,application/pdf', multiple: '', onchange: e => { files = [...e.target.files]; home(); } }),
      h('p', { class: 'k' }, files.length ? files.length + ' file(s): ' + files.map(f => f.name).join(', ') : 'No file chosen'),
      h('input', { type: 'text', id: 'title', 'aria-label': 'Reviewer title (optional)', placeholder: 'Reviewer title (optional)', value: tv }),
      h('div', { class: 'row' },
        h('label', null, 'Questions: ', h('select', { onchange: e => { optMax = Number(e.target.value); } }, [[0, 'All'], [10, '10'], [20, '20']].map(([v, t]) => h('option', { value: v, selected: v === optMax ? '' : null }, t)))),
        h('label', null, h('input', { type: 'checkbox', checked: optMc ? '' : null, onchange: e => { optMc = e.target.checked; } }), 'Multiple choice only')),
      h('p', null, h('button', { class: 'btn', disabled: busy || !files.length ? '' : null, onclick: run }, busy ? 'Working…' : 'Generate reviewer')),
      status && h('p', { class: 'k', role: 'status' }, status), err && h('p', { class: 'err', role: 'alert' }, err)),
    h('div', { class: 'card' }, h('h2', { class: 'k' }, 'Backup'),
      h('p', { class: 'k' }, 'Save your reviewers to a file to move them to another device or keep a copy.'),
      h('div', { class: 'row' }, h('button', { class: 'btn alt', disabled: R.length ? null : '', onclick: exportAll }, 'Export all'),
        h('label', null, 'Import a backup: ', h('input', { type: 'file', accept: '.json,application/json', onchange: e => { if (e.target.files[0]) importFile(e.target.files[0]); } }))),
      n && h('p', { role: 'status' }, n)),
    R.length > 0 && h('h2', { class: 'k' }, 'Saved reviewers'),
    R.length > 5 && h('input', { type: 'text', 'aria-label': 'Search saved reviewers', placeholder: 'Search saved reviewers', value: q, oninput: e => { q = e.target.value; fill(); } }),
    list);
  const match = r => R.length <= 5 || r.title.toLowerCase().includes(q.trim().toLowerCase());
  const fill = () => { const m = R.filter(match); list.replaceChildren(...(m.length || !R.length ? m.map(card) : [h('p', { class: 'k' }, 'No saved reviewer matches "' + q + '".')])); };
  const card = r => h('div', { class: 'card row' },
      h('div', { style: 'flex:1' }, h('b', null, r.title), h('div', { class: 'k' }, r.items.length + ' items · ' + Object.values(r.ans).filter(a => a.ok).length + ' correct')),
      h('button', { class: 'btn', onclick: () => open(r) }, 'Open'),
      h('button', { class: 'btn alt', onclick: () => { if (confirm('Delete "' + r.title + '"?')) { R = R.filter(x => x !== r); save(); home(); } } }, 'Delete'));
  fill(); cur = null; draw(node, 'home'); if (n) say(n);
  const nt = document.getElementById('title'); if (nt) nt.value = tv;
}

const TABS = { mc: 'Multiple choice', id: 'Identification', enum: 'Enumeration' };
function wipe() { for (const k in draft) delete draft[k]; }
// Shuffle = rebuild a new question set from the saved file text (random pick, new wrong options, new order).
// Reviewers saved before source text was kept can only reorder what they have.
function shuffleAll() {
  if (Object.keys(cur.ans).length && !confirm('Make a new shuffled set and reset your progress?')) return;
  const fresh = cur.src ? generate(cur.src, cur.tags, cur.opts) : [];
  if (fresh.length >= 3) cur.items = fresh;
  else {
    cur.items = shuffle(cur.items);
    cur.items.forEach(it => { if (it.type === 'mc') { const t = it.options[it.answer]; it.options = shuffle(it.options); it.answer = it.options.indexOf(t); } });
  }
  // Item ids are rebuilt (type + index), so old "mastered" flashcards would point at different questions.
  cur.ans = {}; cur.flashKnown = []; cur.flashLearn = []; flashIndex = 0; flashRevealed = false;
  wipe(); save(); quiz(); scrollTo(0, 0);
}
function open(r) {
  cur = r; const ts = Object.keys(TABS).filter(k => r.items.some(i => i.type === k)); tab = ts[0];
  r.flashKnown ||= []; flashIndex = 0; flashRevealed = false; r.flashLearn ||= [];
  quiz();
}

// Turn generated reviewer questions into front/back study cards. Progress is saved with the reviewer.
let flashIndex = 0, flashRevealed = false, flashing = false, flashOnly = false, flashOrder = [];
// flashOrder = item positions to study this session. "Review again" moves a card a few places later so it returns soon.
function startFlash(only) {
  stopTimer(); flashOnly = only; flashIndex = 0; flashRevealed = false;
  const known = new Set(cur.flashKnown || []);
  flashOrder = cur.items.map((_, i) => i).filter(i => !only || !known.has(cur.items[i].id));
  flipcards(); scrollTo(0, 0);
}
function flashAnswer(it) {
  if (it.type === 'mc') return it.options[it.answer] || '';
  if (it.type === 'id') return it.answer || '';
  return (it.items || []).join(', ');
}
function flipcards() {
  const r = cur; if (!r) return;
  const items = flashOrder.map(i => r.items[i]);
  if (!items.length && !flashOnly) { quiz(); return; }
  if (!items.length) {
    flashing = false;
    draw(h('div', null, h('button', { class: 'btn alt', onclick: () => home() }, '← Back'), h('h1', null, r.title),
      h('p', null, 'You marked every card as known. Nice work.'), h('button', { class: 'btn', onclick: () => startFlash(false) }, 'Study all cards')), 'flash');
    return;
  }
  flashing = true;
  flashIndex = Math.max(0, Math.min(flashIndex, items.length - 1));
  const it = items[flashIndex];
  const known = new Set(r.flashKnown || []), learn = new Set(r.flashLearn || []);
  const nKnown = r.items.filter(i => known.has(i.id)).length, nLearn = r.items.filter(i => learn.has(i.id) && !known.has(i.id)).length;
  const mark = isKnown => { known[isKnown ? 'add' : 'delete'](it.id); learn[isKnown ? 'delete' : 'add'](it.id); r.flashKnown = [...known]; r.flashLearn = [...learn]; save(); };
  // Spans, not divs: a <button> may only contain phrasing content. CSS makes them flex/block.
  const face = flashRevealed
    ? h('span', { class: 'flip-face answer-face' }, h('span', { class: 'k' }, 'ANSWER'), h('span', { class: 'flip-copy' }, flashAnswer(it)), h('span', { class: 'flip-source' }, it.exp ? 'From your reviewer notes: ' + it.exp : ''))
    : h('span', { class: 'flip-face question-face' }, h('span', { class: 'k' }, 'QUESTION · TAP TO FLIP'), h('span', { class: 'flip-copy' }, it.q));
  const node = h('div', null,
    h('div', { class: 'row' }, h('button', { class: 'btn alt', onclick: () => { home(); } }, '← Back'), h('span', { class: 'k' }, 'FLASHCARDS')),
    h('h1', null, r.title),
    h('p', { class: 'sub' }, 'Try to answer from memory, then flip the card. Mark what you know to track your progress.'),
    warn(),
    h('div', { class: 'flip-progress-row' }, h('span', { class: 'mono' }, (flashIndex + 1) + ' / ' + items.length), h('span', { class: 'k' }, (r.items.length - nKnown - nLearn) + ' new · ' + nLearn + ' learning · ' + nKnown + ' known'), bar(nKnown / r.items.length * 100, 'Cards known')),
    h('p', null, h('button', { class: 'btn alt', onclick: () => startFlash(!flashOnly) }, flashOnly ? 'Study all cards' : 'Study only cards not known yet (' + (r.items.length - nKnown) + ')')),
    h('button', { class: 'flip-card' + (flashRevealed ? ' revealed' : ''), onclick: () => { flashRevealed = !flashRevealed; flipcards(); } }, face, h('span', { class: 'flip-hint' }, flashRevealed ? 'Click to see question' : 'Click to reveal answer')),
    h('div', { class: 'row flip-actions' },
      h('button', { class: 'btn alt', disabled: flashIndex === 0 ? '' : null, onclick: () => { flashIndex--; flashRevealed = false; flipcards(); } }, '← Previous'),
      h('button', { class: 'btn alt', onclick: () => { flashRevealed = !flashRevealed; flipcards(); } }, flashRevealed ? 'Show question' : 'Reveal answer'),
      h('button', { class: 'btn', onclick: () => { mark(true); nextFlash(items); } }, '✓ I knew it'),
      h('button', { class: 'btn alt', onclick: () => { mark(false); const [x] = flashOrder.splice(flashIndex, 1); flashOrder.splice(Math.min(flashIndex + 3, flashOrder.length), 0, x); flashRevealed = false; flipcards(); } }, '↻ Review again'),
      h('button', { class: 'btn alt', disabled: flashIndex >= items.length - 1 ? '' : null, onclick: () => { flashIndex++; flashRevealed = false; flipcards(); } }, 'Next →')),
    h('p', { class: 'k flip-footnote' }, 'Tip: use “I knew it” only when you recalled the answer before flipping.'));
  draw(node, 'flash');
  document.querySelector('.flip-card').focus({ preventScroll: true }); // keep keyboard users on the card after a redraw
}
function nextFlash(items) { flashIndex = flashIndex < items.length - 1 ? flashIndex + 1 : 0; flashRevealed = false; flipcards(); }

// Timed practice: 30 seconds per item for the open part. The clock text is updated in place so typing is not interrupted.
let timed = null, tick = 0;
const fmt = ms => { const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
function stopTimer() { clearInterval(tick); timed = null; }
function startTimed(list) {
  if (list.some(i => cur.ans[i.id]) && !confirm('Timed practice clears your answers for this part. Continue?')) return;
  list.forEach(i => delete cur.ans[i.id]); wipe(); save(); stopTimer();
  timed = { tab, end: Date.now() + list.length * 30000, over: false };
  tick = setInterval(() => {
    if (!cur || flashing) return stopTimer();
    const left = timed.end - Date.now();
    if (left > 0) { const c = document.getElementById('clock'); if (c) c.textContent = fmt(left); return; }
    clearInterval(tick); timed.over = true; quiz(); say('Time is up.');
  }, 1000);
  quiz();
}

function answer(it, val) {
  let ok, exp;
  if (it.type === 'mc') { ok = val === it.answer; exp = it.options[it.answer]; }
  else if (it.type === 'id') { ok = idOk(it.answer, val); exp = it.answer; }
  else { const c = enumCheck(it.items, val); ok = c.ok; exp = it.items.join(', ') + (c.ok ? '' : ' (you missed: ' + c.missing.join(', ') + ')'); }
  cur.ans[it.id] = { val, ok, exp };
  const part = cur.items.filter(i => i.type === tab), done = part.every(i => cur.ans[i.id]);
  if (done) stopTimer();
  save(); quiz();
  say((ok ? 'Correct. ' : 'Not quite. Answer: ' + exp + '. ') + (done ? 'Part finished: ' + part.filter(i => cur.ans[i.id].ok).length + ' of ' + part.length + ' correct.' : ''));
  const fb = document.getElementById('fb-' + it.id); if (fb) fb.focus({ preventScroll: true });
}

function quiz() {
  const r = cur, ts = Object.keys(TABS).filter(k => r.items.some(i => i.type === k));
  if (!ts.includes(tab)) tab = ts[0];
  const good = x => x.filter(i => r.ans[i.id] && r.ans[i.id].ok).length;
  const total = good(r.items), n = r.items.length;
  const mine = r.items.filter(i => i.type === tab);
  const missed = mine.filter(i => r.ans[i.id] && !r.ans[i.id].ok);
  const done = mine.length > 0 && mine.every(i => r.ans[i.id]), partGood = good(mine);
  const over = !!(timed && timed.over && timed.tab === tab), running = !!(timed && !timed.over && timed.tab === tab);
  const rename = () => { const t = prompt('New title', r.title), v = t && t.trim().slice(0, 120); if (v) { r.title = v; save(); quiz(); } };
  const clear = list => { list.forEach(i => delete r.ans[i.id]); save(); quiz(); };
  const node = h('div', null,
    h('button', { class: 'btn alt', onclick: home }, '← Back'),
    h('h1', null, r.title),
    h('p', { class: 'sub' }, 'Answer each item. You get the result and an explanation right away. Missed items stay marked so you can retry them.'),
    warn(),
    h('div', { class: 'row' }, h('span', { class: 'mono big' }, total + '/' + n),
      h('span', { class: 'k' }, 'correct so far · ' + n + ' items'),
      bar(n ? total / n * 100 : 0, 'Correct answers')),
    h('div', { class: 'tabs' }, ts.map(k => h('button', { class: 'tab' + (k === tab ? ' on' : ''), 'aria-current': k === tab ? 'true' : null, onclick: () => { tab = k; quiz(); scrollTo(0, 0); } },
      TABS[k] + ' ', h('span', { class: 'k' }, good(r.items.filter(i => i.type === k)) + '/' + r.items.filter(i => i.type === k).length))),
      h('button', { class: 'tab', onclick: () => startFlash(false) }, '✦ Flipcards')),
    h('div', { class: 'row' },
      h('button', { class: 'btn', disabled: missed.length ? null : '', onclick: () => clear(missed) }, 'Retry missed (' + missed.length + ')'),
      h('button', { class: 'btn alt', onclick: () => clear(mine) }, 'Reset this part')),
    h('div', { class: 'row', style: 'margin-top:8px' },
      h('button', { class: 'btn alt', onclick: shuffleAll }, r.src ? 'Shuffle · new questions' : 'Shuffle'),
      h('button', { class: 'btn alt', onclick: running ? () => { stopTimer(); quiz(); } : () => startTimed(mine) }, running ? 'Stop timer' : 'Timed practice (' + fmt(mine.length * 30000) + ')'),
      h('button', { class: 'btn alt', onclick: rename }, 'Rename'),
      h('button', { class: 'btn alt', onclick: () => window.print() }, 'Print this part')),
    running && h('p', { class: 'k' }, 'Time left: ', h('b', { id: 'clock', class: 'mono' }, fmt(timed.end - Date.now()))),
    h('div', { class: 'items' }, mine.map((it, idx) => {
      const a = r.ans[it.id];
      return h('div', { class: 'item' },
        h('div', { class: 'k' }, 'Q' + (idx + 1) + (a ? ' · ' : ''), a && h('span', { class: a.ok ? 'good' : 'miss' }, a.ok ? 'correct' : 'missed')),
        h('div', { class: 'q', id: 'q-' + it.id }, it.q),
        it.type === 'mc'
          ? h('div', { role: 'group', 'aria-labelledby': 'q-' + it.id }, it.options.map((o, oi) => h('button', { class: 'opt' + (a ? (oi === it.answer ? ' ok' : oi === a.val ? ' bad' : '') : ''), disabled: a || over ? '' : null, onclick: () => answer(it, oi) }, h('b', null, 'ABCD'[oi]), o, a && oi === it.answer && h('span', { class: 'mark' }, '✓ Correct answer'), a && oi === a.val && oi !== it.answer && h('span', { class: 'mark' }, '✗ Your answer'))))
          : h('div', null,
            it.type === 'enum'
              ? h('textarea', { rows: 4, 'aria-labelledby': 'q-' + it.id, placeholder: 'One per line or separated by commas', disabled: a || over ? '' : null, oninput: e => { draft[it.id] = e.target.value; }, onkeydown: e => { if (e.key === 'Enter' && e.ctrlKey) answer(it, draft[it.id] || ''); } }, a ? a.val : draft[it.id] || '')
              : h('input', { type: 'text', 'aria-labelledby': 'q-' + it.id, placeholder: 'Your answer', value: a ? a.val : draft[it.id] || '', disabled: a || over ? '' : null, oninput: e => { draft[it.id] = e.target.value; }, onkeydown: e => { if (e.key === 'Enter') answer(it, draft[it.id] || ''); } }),
            !a && !over && h('p', null, h('button', { class: 'btn', onclick: () => answer(it, draft[it.id] || '') }, 'Check'))),
        a && h('div', { class: 'fb' + (a.ok ? '' : ' bad'), id: 'fb-' + it.id, tabindex: '-1' }, h('b', null, a.ok ? 'Correct.' : 'Not quite.'),
          h('div', null, (a.ok ? '' : 'Answer: ' + a.exp + '. ') + 'Source: ' + it.exp)),
        h('div', { class: 'ans-print' }, 'Answer: ' + flashAnswer(it)));
    })),
    (done || over) && h('div', { class: 'card done', role: 'status' }, h('b', null, (over && !done ? 'Time is up. ' : '') + 'Part score: ' + partGood + ' of ' + mine.length + ' correct (' + Math.round(partGood / mine.length * 100) + '%)'),
      h('p', null, partGood === mine.length ? 'Perfect. Try another part or the flashcards.' : 'Use "Retry missed" at the top to practice the ones you got wrong.')));
  flashing = false;
  draw(node, 'quiz');
}

// Keys for laptops. Typing fields keep their own keys; Enter on a text answer is wired on the field itself.
document.addEventListener('keydown', e => {
  if (!cur || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target.tagName; if (t === 'INPUT' || t === 'TEXTAREA') return;
  if (flashing) {
    const last = flashOrder.length - 1;
    if (e.key === 'ArrowRight' && flashIndex < last) { flashIndex++; flashRevealed = false; flipcards(); }
    else if (e.key === 'ArrowLeft' && flashIndex > 0) { flashIndex--; flashRevealed = false; flipcards(); }
    else if (e.key === ' ' && t !== 'BUTTON') { e.preventDefault(); flashRevealed = !flashRevealed; flipcards(); }
    return;
  }
  const pick = Number(e.key) - 1, it = tab === 'mc' && !(timed && timed.over) && cur.items.find(i => i.type === 'mc' && !cur.ans[i.id]);
  if (it && pick >= 0 && pick < it.options.length) answer(it, pick);
});
home();
