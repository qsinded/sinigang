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
  h('span', { class: 'keys' }, 'Keys: 1–4 pick an answer, Ctrl+Enter checks a list, ← → cards, Space flips or pauses, Esc stops the voice.')));
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

// PDF.js is fetched the first time a PDF is picked, so ~1.5 MB of bundles no longer delays first
// paint. Classic scripts, worker runs on the main thread: phone HTML viewers block module imports
// and Workers. isEvalSupported:false closes CVE-2024-4367 (font eval) in the vendored 3.x build.
let pdfjsLoading = null;
function loadPdfjs() {
  pdfjsLoading ||= (async () => {
    const add = src => new Promise((ok, fail) => {
      const s = document.createElement('script'); s.src = src; s.onload = ok;
      s.onerror = () => fail(new Error('Could not load the PDF reader. Check that the PDF.js files are still in js/.'));
      document.head.append(s);
    });
    if (!window.pdfjsLib) { await add('./js/pdfjs-worker-bundle.js'); await add('./js/pdfjs-viewer-bundle.js'); }
    pdfjsLib.GlobalWorkerOptions.workerSrc = './js/pdfjs-worker-bundle.js';
    return pdfjsLib;
  })().catch(e => { pdfjsLoading = null; throw e; });
  return pdfjsLoading;
}
async function pdfLines(pdfjs, buf, tags) {
  const doc = await pdfjs.getDocument({ data: buf, isEvalSupported: false }).promise, out = [];
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
// A saved reviewer keeps a capped copy of its source text: enough for Shuffle, small enough that a
// handful of reviewers do not fill the ~5 MB localStorage quota (one full PDF was ~250 KB).
const MAX_SRC_CHARS = 40000;
function capSrc(lines) {
  const out = []; let used = 0;
  for (const line of Array.isArray(lines) ? lines : []) {
    if (typeof line !== 'string') continue;
    if (used + line.length > MAX_SRC_CHARS) { if (!out.length) out.push(line.slice(0, MAX_SRC_CHARS)); break; }
    out.push(line); used += line.length + 1;
  }
  return out;
}
// Reviewer ids used to come from Date.now(); a counter keeps two quick imports from colliding.
let ridSeq = 0;
const newRid = () => Date.now() * 1000 + (ridSeq = (ridSeq + 1) % 1000);

// Study plan: a light Leitner schedule per reviewer plus an optional exam date. Boxes 0-4 wait
// 0, 1, 3, 7 and 16 days, so an item you missed comes back tomorrow instead of disappearing.
const BOX_DAYS = [0, 1, 3, 7, 16];
// Date.UTC of the local calendar date keeps day counts exact across daylight-saving changes.
function dayNumber(d) { return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000); }
function todayNumber() { return dayNumber(new Date()); }
function validExamDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00').getTime()); }
function examDaysLeft(s) { return validExamDate(s) ? dayNumber(new Date(s + 'T00:00:00')) - todayNumber() : null; }
function examText(s) {
  const n = examDaysLeft(s);
  if (n === null) return '';
  return n > 1 ? 'exam in ' + n + ' days' : n === 1 ? 'exam tomorrow' : n === 0 ? 'exam today' : 'exam date passed';
}
function planOf(r) { return r.plan && typeof r.plan === 'object' && !Array.isArray(r.plan) ? r.plan : { exam: '', srs: {} }; }
function isDue(r, it) {
  const s = planOf(r).srs && planOf(r).srs[it.id];
  return !s || !Number.isInteger(s.due) || s.due <= todayNumber();
}
function dueIds(r) { return r.items.filter(it => isDue(r, it)).map(it => it.id); }
function dueCount(r) { return dueIds(r).length; }
function reviewItem(r, id, ok) {
  r.plan = planOf(r); r.plan.srs ||= {};
  const s = r.plan.srs[id] || { box: 0 };
  s.box = ok ? Math.min(s.box + 1, BOX_DAYS.length - 1) : 0;
  s.due = todayNumber() + BOX_DAYS[s.box];
  r.plan.srs[id] = s;
}
function planCard() {
  const due = R.reduce((n, r) => n + dueCount(r), 0);
  const withDue = R.filter(r => dueCount(r) > 0).length;
  const next = R.filter(r => examDaysLeft(r.plan && r.plan.exam) !== null)
    .map(r => ({ r, n: examDaysLeft(r.plan.exam) }))
    .sort((a, b) => a.n - b.n)[0];
  return h('div', { class: 'card' },
    h('h2', { class: 'k' }, 'Today'),
    h('p', null, due ? due + ' item' + (due === 1 ? '' : 's') + ' due in ' + withDue + ' reviewer' + (withDue === 1 ? '' : 's') + '.' : 'Nothing is due today — study ahead if you like.'),
    next && h('p', null, h('b', null, next.r.title), ' · ' + examText(next.r.plan.exam)),
    h('p', { class: 'k' }, 'Open a reviewer to set its exam date, or use Review to study what is due.'));
}

// "Show me why": find the sentence an answer came from and show it in its paragraph.
const untag = s => String(s || '').replace(/^\([^)]*\)\s*/, '').trim();
function sourceLine(r, it) {
  const lines = r.src || [];
  if (!lines.length) return null;
  const plain = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const want = plain(untag(it.exp)), needle = norm(flashAnswer(it) || '');
  let at = want ? lines.findIndex(l => plain(l) === want) : -1;
  if (at < 0 && want) at = lines.findIndex(l => plain(l).includes(want.slice(0, Math.min(want.length, 60))));
  if (at < 0 && needle.length >= 3) at = lines.findIndex(l => norm(l).includes(needle));
  if (at < 0) return null;
  return { at, text: lines[at], tag: (r.tags && r.tags[at]) || '' };
}
function markLine(text, needle) {
  const at = needle ? text.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  if (at < 0) return [text];
  return [text.slice(0, at), h('mark', null, text.slice(at, at + needle.length)), text.slice(at + needle.length)];
}
function sourcePanel(r, it) {
  const found = sourceLine(r, it), answer = untag(it.exp);
  const wrap = h('div', { class: 'src', id: 'src-' + it.id, hidden: '' });
  const fill = () => {
    if (wrap.dataset.filled) return;
    wrap.dataset.filled = '1';
    if (!found) {
      wrap.append(h('p', { class: 'k' }, 'From your notes'), h('p', null, it.exp || answer || 'The source line for this item was not kept.'));
      return;
    }
    wrap.append(h('p', { class: 'k' }, (found.tag ? '(' + found.tag + ') ' : '') + 'From your notes'));
    const from = Math.max(0, found.at - 2), to = Math.min(r.src.length, found.at + 3);
    for (let i = from; i < to; i++) {
      wrap.append(h('p', { class: i === found.at ? 'hit' : null }, ...(i === found.at ? markLine(r.src[i], flashAnswer(it)) : [r.src[i]])));
    }
  };
  const toggle = btn => {
    fill();
    const opening = wrap.hasAttribute('hidden');
    if (opening) wrap.removeAttribute('hidden'); else wrap.setAttribute('hidden', '');
    btn.setAttribute('aria-expanded', opening ? 'true' : 'false');
    btn.textContent = opening ? 'Hide my notes' : 'Show in my notes';
  };
  return h('div', { class: 'src-wrap' },
    h('button', { class: 'btn alt', 'aria-expanded': 'false', 'aria-controls': 'src-' + it.id, onclick: e => toggle(e.currentTarget) }, 'Show in my notes'),
    wrap);
}
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
function cleanReviewer(x) {
  const title = str(x && x.title, 120), items = Array.isArray(x && x.items) ? x.items.map(cleanItem).filter(Boolean) : [];
  if (!title || items.length < 3) return null;
  const ids = new Set(items.map(it => it.id)), ans = {};
  for (const k in (x.ans || {})) {
    const a = x.ans[k];
    if (ids.has(k) && a && typeof a.ok === 'boolean' && str(a.exp) !== null && (typeof a.val === 'string' || Number.isInteger(a.val))) ans[k] = { val: a.val, ok: a.ok, exp: a.exp };
  }
  const idList = v => Array.isArray(v) ? v.filter(k => ids.has(k)) : [];
  // A hand-edited backup can carry an unbounded source array; keep only what Shuffle needs.
  let src = Array.isArray(x.src) && x.src.length <= 20000 && x.src.every(l => typeof l === 'string') ? x.src : undefined;
  let tags = src && Array.isArray(x.tags) && x.tags.length === src.length && x.tags.every(g => typeof g === 'string') ? x.tags : undefined;
  if (src) { src = capSrc(src); tags = tags && tags.slice(0, src.length); }
  const o = x.opts || {}, opts = { max: Number.isInteger(o.max) && o.max > 0 ? o.max : 0, mcOnly: o.mcOnly === true };
  // A backup may carry a study plan; keep only a valid date and entries for items that exist.
  const raw = x.plan && typeof x.plan === 'object' && !Array.isArray(x.plan) ? x.plan : {};
  const savedSrs = raw.srs && typeof raw.srs === 'object' && !Array.isArray(raw.srs) ? raw.srs : {};
  const srs = {};
  for (const k in savedSrs) {
    const s = savedSrs[k];
    if (ids.has(k) && s && Number.isInteger(s.box) && s.box >= 0 && s.box < BOX_DAYS.length && Number.isInteger(s.due)) srs[k] = { box: s.box, due: s.due };
  }
  const plan = { exam: validExamDate(raw.exam) ? raw.exam : '', srs };
  return { id: newRid(), title, items, ans, flashKnown: idList(x.flashKnown), flashLearn: idList(x.flashLearn), src, tags, opts, plan };
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
      if (/\.pdf$/i.test(f.name)) l = await pdfLines(await loadPdfjs(), await f.arrayBuffer(), t);
      else if (/\.pptx$/i.test(f.name)) l = await pptxLines(await f.arrayBuffer(), t);
      else if (/\.docx$/i.test(f.name)) l = await docxLines(await f.arrayBuffer());
      else if (/\.doc$/i.test(f.name)) throw new Error('Old .doc files cannot be read. In Word use Save As > .docx (or PDF), then pick that file.');
      else if (/\.ppt$/i.test(f.name)) l = pptLines(await f.arrayBuffer(), t);
      else if (/\.(txt|md|markdown|csv)$/i.test(f.name)) l = (await f.text()).split(/\r?\n/);
      else throw new Error('Unsupported file: use PDF, PPTX, PPT, DOCX, TXT or MD. Anything else would be read as garbage.');
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
  const p = pending, src = capSrc(p.src);
  // Tags are one string per source line, so they are trimmed with the source they describe.
  const tags = Array.isArray(p.tags) ? p.tags.slice(0, src.length) : [];
  const r = { id: newRid(), title: p.title, items: p.items, ans: {}, src, tags, opts: p.opts, plan: { exam: '', srs: {} } };
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
      h('button', { class: 'btn alt rm', 'aria-label': 'Remove question ' + (i + 1), onclick: () => { p.items.splice(i, 1); removedAt = i; preview(); say('Removed. ' + p.items.length + ' questions left.'); } }, 'Remove'))))), 'preview');
  // The removed card is gone; put focus on the Remove button that took its place.
  const rm = app.querySelectorAll('.rm'); if (rm.length && removedAt !== null) rm[Math.min(removedAt, rm.length - 1)].focus();
  removedAt = null;
}

function home() {
  pending = null;
  if (reciteActive) stopVoice();
  const list = h('div', { class: 'list' });
  flashing = false; stopTimer();
  const n = note; note = '';
  const t = document.getElementById('title'), tv = t ? t.value : '';
  const node = h('div', null,
    h('h1', null, 'Reviewer Generator'),
    h('p', { class: 'sub' }, 'Pick a PDF, PowerPoint (.pptx), Word (.docx) or text file. The reviewer is built on this device, no internet needed.'),
    warn(),
    R.length > 0 && planCard(),
    h('div', { class: 'card' },
      h('input', { type: 'file', id: 'file', 'aria-label': 'Choose a PDF, PowerPoint, Word or text file', accept: '.pdf,.pptx,.ppt,.docx,.txt,.md,text/plain,application/pdf', multiple: '', onchange: e => { files = [...e.target.files]; home(); } }),
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
      h('div', { style: 'flex:1' }, h('b', null, r.title),
        h('div', { class: 'k' }, r.items.length + ' items · ' + Object.values(r.ans).filter(a => a.ok).length + ' correct'
          + (dueCount(r) ? ' · ' + dueCount(r) + ' due' : '')
          + (examDaysLeft(r.plan && r.plan.exam) !== null ? ' · ' + examText(r.plan.exam) : ''))),
      dueCount(r) > 0 && h('button', { class: 'btn', onclick: () => { open(r); startFlash('due'); } }, 'Review ' + dueCount(r)),
      h('button', { class: 'btn alt', onclick: () => open(r) }, 'Open'),
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
  cur.ans = {}; cur.flashKnown = []; cur.flashLearn = []; cur.plan = planOf(cur); cur.plan.srs = {}; flashIndex = 0; flashRevealed = false;
  wipe(); save(); quiz(); scrollTo(0, 0);
}
function open(r) {
  cur = r; const ts = Object.keys(TABS).filter(k => r.items.some(i => i.type === k)); tab = ts[0];
  r.flashKnown ||= []; flashIndex = 0; flashRevealed = false; r.flashLearn ||= [];
  r.plan = planOf(r); r.plan.srs ||= {};
  quiz();
}

// Turn generated reviewer questions into front/back study cards. Progress is saved with the reviewer.
let flashIndex = 0, flashRevealed = false, flashing = false, flashMode = 'all', flashOrder = [];
// flashMode: 'all' | 'unknown' (not marked known yet) | 'due' (scheduled for today or overdue).
// flashOrder = item positions to study this session. "Review again" moves a card a few places later so it returns soon.
function startFlash(mode = 'all') {
  stopTimer(); flashMode = mode; flashIndex = 0; flashRevealed = false;
  const known = new Set(cur.flashKnown || []), due = new Set(dueIds(cur));
  flashOrder = cur.items.map((_, i) => i).filter(i =>
    mode === 'all' ? true : mode === 'unknown' ? !known.has(cur.items[i].id) : due.has(cur.items[i].id));
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
  if (!items.length && flashMode === 'all') { quiz(); return; }
  if (!items.length) {
    flashing = false;
    const due = flashMode === 'due';
    draw(h('div', null, h('button', { class: 'btn alt', onclick: () => home() }, '← Back'), h('h1', null, r.title),
      h('p', null, due ? 'Nothing is due today. Come back tomorrow, or study ahead.' : 'You marked every card as known. Nice work.'),
      h('button', { class: 'btn', onclick: () => startFlash('all') }, 'Study all cards')), 'flash');
    return;
  }
  flashing = true;
  flashIndex = Math.max(0, Math.min(flashIndex, items.length - 1));
  const it = items[flashIndex];
  const known = new Set(r.flashKnown || []), learn = new Set(r.flashLearn || []);
  const nKnown = r.items.filter(i => known.has(i.id)).length, nLearn = r.items.filter(i => learn.has(i.id) && !known.has(i.id)).length;
  const mark = isKnown => { known[isKnown ? 'add' : 'delete'](it.id); learn[isKnown ? 'delete' : 'add'](it.id); r.flashKnown = [...known]; r.flashLearn = [...learn]; reviewItem(r, it.id, isKnown); save(); };
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
    h('p', null, h('button', { class: 'btn alt', onclick: () => startFlash(flashMode === 'unknown' ? 'all' : 'unknown') }, flashMode === 'unknown' ? 'Study all cards' : 'Study only cards not known yet (' + (r.items.length - nKnown) + ')')),
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

// Hands-free oral recitation: the device's own speech voice reads each question, waits while the
// student thinks, reads the answer, then moves on. No audio and no notes leave the device.
let reciteIndex = 0, reciteToken = 0, reciteActive = false, recitePhase = 'idle';
let reciteRate = 1, reciteThink = 4000, reciteAnswers = true, reciteAuto = true;
function ttsReady() { return 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'; }
function reciteQuestion(it) {
  const q = it.q.replace(/_{3,}/g, 'blank');
  if (it.type !== 'mc') return q;
  return q + ' Options: ' + it.options.map((o, i) => 'ABCD'[i] + '. ' + o).join('. ') + '.';
}
function reciteAnswer(it) {
  if (it.type === 'mc') return 'The answer is ' + 'ABCD'[it.answer] + ': ' + it.options[it.answer] + '.';
  if (it.type === 'id') return 'The answer is ' + it.answer + '.';
  return 'The answers are: ' + (it.items || []).join(', ') + '.';
}
function voice() {
  const list = window.speechSynthesis.getVoices() || [];
  return list.find(v => /^en[-_]/i.test(v.lang) && /female|samantha|zira|google us english|natural/i.test(v.name)) || list.find(v => /^en[-_]/i.test(v.lang)) || null;
}
function speak(text, token) {
  return new Promise(resolve => {
    let guard = 0, finished = false;
    const finish = () => { if (finished) return; finished = true; clearTimeout(guard); resolve(); };
    if (!text || token !== reciteToken || !ttsReady()) return finish();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US'; u.rate = reciteRate;
    const v = voice(); if (v) u.voice = v;
    u.onend = finish; u.onerror = finish;
    guard = setTimeout(finish, Math.max(6000, text.length * 200 / reciteRate));
    const synth = window.speechSynthesis;
    const go = () => { if (token === reciteToken && !finished) synth.speak(u); else finish(); };
    // Speak immediately when idle (keeps the user gesture alive on iOS); only wait after a cancel,
    // because a cancel immediately followed by speak() drops the new utterance in some browsers.
    if (synth.speaking || synth.pending) setTimeout(go, 80); else go();
  });
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function stopVoice() { reciteToken++; reciteActive = false; if (ttsReady()) window.speechSynthesis.cancel(); }
async function playFrom(index) {
  if (!cur || !cur.items.length || !ttsReady()) return;
  const token = ++reciteToken;
  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) window.speechSynthesis.cancel();
  reciteIndex = Math.max(0, Math.min(index, cur.items.length - 1));
  reciteActive = true; recitePhase = 'question'; recite();
  await wait(120);
  while (token === reciteToken && reciteIndex < cur.items.length) {
    const it = cur.items[reciteIndex];
    recitePhase = 'question'; recite();
    await speak(reciteQuestion(it), token);
    if (token !== reciteToken) return;
    if (reciteAnswers) {
      recitePhase = 'think'; recite();
      await wait(reciteThink);
      if (token !== reciteToken) return;
      recitePhase = 'answer'; recite();
      await speak(reciteAnswer(it), token);
      if (token !== reciteToken) return;
    }
    if (!reciteAuto) {
      reciteActive = false;
      // Resume should start the next question, not replay the one just answered.
      if (reciteIndex >= cur.items.length - 1) { recitePhase = 'done'; recite(); return; }
      reciteIndex++; recitePhase = 'paused'; recite(); return;
    }
    reciteIndex++;
    if (reciteIndex < cur.items.length) await wait(800);
  }
  if (token !== reciteToken) return;
  reciteActive = false; recitePhase = 'done'; recite(); say('Recitation finished.');
}
function openRecite() {
  reciteIndex = 0; recitePhase = 'idle'; reciteActive = false;
  recite();
  if (ttsReady()) playFrom(0); else say('Spoken recitation is not available in this browser.');
}
function pauseRecite() { stopVoice(); recitePhase = 'paused'; recite(); say('Paused.'); }
function resumeRecite() { if (recitePhase === 'done') reciteIndex = 0; playFrom(reciteIndex); }
function stopRecite() { stopVoice(); recitePhase = 'idle'; recite(); say('Voice stopped.'); }
function skipRecite(delta) {
  if (!cur) return;
  const was = reciteActive;
  stopVoice();
  reciteIndex = Math.max(0, Math.min(reciteIndex + delta, cur.items.length - 1));
  if (was) { playFrom(reciteIndex); return; }
  recitePhase = 'paused'; recite();
}
function recite() {
  const r = cur; if (!r) return;
  const items = r.items, idx = Math.min(reciteIndex, items.length - 1), it = items[idx];
  const showAnswer = recitePhase === 'answer' || recitePhase === 'done';
  const label = { question: 'Reading the question', think: 'Think about your answer', answer: 'Reading the answer', paused: 'Paused', done: 'Finished', idle: 'Ready' }[recitePhase] || 'Ready';
  draw(h('div', null,
    h('div', { class: 'row' }, h('button', { class: 'btn alt', onclick: () => { stopVoice(); quiz(); } }, '← Back'), h('span', { class: 'k' }, 'ORAL RECITATION')),
    h('h1', null, r.title),
    h('p', { class: 'sub' }, 'Listen hands-free: each question is read aloud, then the answer after a short pause. Space pauses, ← → skip, Esc stops.'),
    warn(),
    !ttsReady() && h('p', { class: 'err', role: 'alert' }, 'This browser has no speech voice available, so questions cannot be read aloud here.'),
    h('div', { class: 'flip-progress-row' }, h('span', { class: 'mono' }, (idx + 1) + ' / ' + items.length), h('span', { class: 'k', role: 'status' }, label), bar((idx + 1) / items.length * 100, 'Recitation progress')),
    h('div', { class: 'recite-card' },
      h('div', { class: 'k' }, TABS[it.type] + (showAnswer ? ' · ANSWER' : ' · QUESTION')),
      h('p', { class: 'recite-text' }, showAnswer ? flashAnswer(it) : it.q),
      showAnswer && it.exp && h('p', { class: 'k' }, it.exp)),
    h('div', { class: 'row' },
      h('button', { class: 'btn', disabled: ttsReady() ? null : '', onclick: () => { if (reciteActive) pauseRecite(); else resumeRecite(); } }, reciteActive ? 'Pause' : recitePhase === 'done' ? 'Start again' : 'Start / Resume'),
      h('button', { class: 'btn alt', disabled: idx === 0 ? '' : null, onclick: () => skipRecite(-1) }, '← Previous'),
      h('button', { class: 'btn alt', disabled: idx >= items.length - 1 ? '' : null, onclick: () => skipRecite(1) }, 'Next →'),
      h('button', { class: 'btn alt', onclick: () => playFrom(reciteIndex) }, '↻ Repeat'),
      h('button', { class: 'btn alt', onclick: stopRecite }, 'Stop')),
    h('div', { class: 'row' },
      h('label', null, 'Speed ', h('select', { onchange: e => { reciteRate = Number(e.target.value); } }, [[0.8, 'Slower'], [1, 'Normal'], [1.2, 'Faster']].map(([v, t]) => h('option', { value: v, selected: v === reciteRate ? '' : null }, t)))),
      h('label', null, 'Answer after ', h('select', { onchange: e => { reciteThink = Number(e.target.value); } }, [[2000, '2 s'], [4000, '4 s'], [6000, '6 s']].map(([v, t]) => h('option', { value: v, selected: v === reciteThink ? '' : null }, t)))),
      h('label', null, h('input', { type: 'checkbox', checked: reciteAnswers ? '' : null, onchange: e => { reciteAnswers = e.target.checked; } }), 'Read answers'),
      h('label', null, h('input', { type: 'checkbox', checked: reciteAuto ? '' : null, onchange: e => { reciteAuto = e.target.checked; } }), 'Auto-advance')),
    h('p', { class: 'k' }, 'The voice is your device’s built-in speech: notes stay on this phone and no audio is uploaded.')), 'recite');
}

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
  reviewItem(cur, it.id, ok);
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
    h('div', { class: 'row plan' },
      h('label', null, 'Exam date ', h('input', { type: 'date', 'aria-label': 'Exam date for this reviewer', value: (r.plan && r.plan.exam) || '', onchange: e => {
        const v = e.target.value;
        r.plan = planOf(r);
        r.plan.exam = validExamDate(v) ? v : '';
        if (v && !validExamDate(v)) e.target.value = '';
        save(); quiz();
      } })),
      examDaysLeft(r.plan && r.plan.exam) !== null && h('span', { class: 'k' }, examText(r.plan.exam)),
      h('button', { class: 'btn alt', disabled: dueCount(r) ? null : '', onclick: () => startFlash('due') }, 'Review due (' + dueCount(r) + ')')),
    h('div', { class: 'row' }, h('span', { class: 'mono big' }, total + '/' + n),
      h('span', { class: 'k' }, 'correct so far · ' + n + ' items'),
      bar(n ? total / n * 100 : 0, 'Correct answers')),
    h('div', { class: 'tabs' }, ts.map(k => h('button', { class: 'tab' + (k === tab ? ' on' : ''), 'aria-current': k === tab ? 'true' : null, onclick: () => { if (timed && timed.tab !== k) stopTimer(); tab = k; quiz(); scrollTo(0, 0); } },
      TABS[k] + ' ', h('span', { class: 'k' }, good(r.items.filter(i => i.type === k)) + '/' + r.items.filter(i => i.type === k).length))),
      h('button', { class: 'tab', onclick: () => startFlash('all') }, '✦ Flipcards')),
    h('div', { class: 'row' },
      h('button', { class: 'btn', disabled: missed.length ? null : '', onclick: () => clear(missed) }, 'Retry missed (' + missed.length + ')'),
      h('button', { class: 'btn alt', onclick: () => clear(mine) }, 'Reset this part')),
    h('div', { class: 'row', style: 'margin-top:8px' },
      h('button', { class: 'btn alt', onclick: shuffleAll }, r.src ? 'Shuffle · new questions' : 'Shuffle'),
      h('button', { class: 'btn alt', onclick: running ? () => { stopTimer(); quiz(); } : () => startTimed(mine) }, running ? 'Stop timer' : 'Timed practice (' + fmt(mine.length * 30000) + ')'),
      h('button', { class: 'btn alt', onclick: rename }, 'Rename'),
      h('button', { class: 'btn alt', onclick: openRecite }, '🎧 Recite'),
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
          h('div', null, 'Answer: ' + a.exp + '.')),
        a && sourcePanel(r, it),
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
  const t = e.target.tagName; if (t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT') return;
  if (lastScreen === 'recite') {
    if (e.key === 'ArrowRight') { e.preventDefault(); skipRecite(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); skipRecite(-1); }
    else if (e.key === ' ' && t !== 'BUTTON') { e.preventDefault(); if (reciteActive) pauseRecite(); else resumeRecite(); }
    else if (e.key === 'Escape') { e.preventDefault(); stopRecite(); }
    return;
  }
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
