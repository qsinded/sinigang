const app = document.getElementById('app');
const KEY = 'reviewer_gen_v1';
let mem = [];
let saveWarn = ''; // shown to the student when the device cannot store their reviewers
const STORAGE_FULL = 'Not saved: this device\'s storage is full. Delete a saved reviewer to free space. Your work is kept only until you close this page.';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || mem; } catch (e) { return mem; } };
const save = () => {
  try { const s = JSON.stringify(R); localStorage.setItem(KEY, s); saveWarn = s.length > 3.5e6 ? STORAGE_NEAR : ''; } // ponytail: ~5M chars is the usual browser cap; move source text to IndexedDB if this fires often
  catch (e) { mem = R; saveWarn = STORAGE_FULL; }
};
const STORAGE_NEAR = 'Storage is almost full. Use "Export all" to save a backup, then delete reviewers you no longer need.';
const BACKUP_KEY = 'reviewer_gen_backup';
const backupOld = () => { try { const t = Number(localStorage.getItem(BACKUP_KEY)); return !t || Date.now() - t > 14 * 864e5; } catch (e) { return false; } };
const warn = () => saveWarn && h('p', { class: 'err', role: 'alert' }, saveWarn);
let R = load();
let q = '', qSort = 'recent', qDue = false, optMax = 0, optMc = false, optNoTF = false, optNoEnum = false, pasteText = '', pending = null, cur = null, tab = null, quizIndex = 0, files = [], status = '', err = '', busy = false;
// How many items a day's due session serves. 0 = all. The cap is a study plan, not a hard limit on
// the reviewer; the home card still shows the full backlog.
let optCap = 20;
try { const c = Number(localStorage.getItem('reviewer_cap_v1')); if ([10, 20, 40, 0].includes(c)) optCap = c; } catch (e) { /* session default */ }
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
  const t = node.querySelector('h1'); document.title = t && t.textContent !== 'SINEGENG' ? t.textContent + ' · SINEGENG' : 'SINEGENG';
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
const pasteLines = t => String(t || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
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
// Added and edited questions need an id that cannot collide with a generated positional one
// (id0, mc1) or with another edit made in the same millisecond.
let itemSeq = 0;
const newItemId = () => 'it_' + Date.now().toString(36) + (itemSeq = (itemSeq + 1) % 1296).toString(36) + Math.random().toString(36).slice(2, 5);

// Diagram images live in IndexedDB: one photo is megabytes, and localStorage is shared with every
// reviewer. Items keep only an image id and a normalized hotspot, so the JSON stays small.
const IMG_DB = 'reviewer_images_v1', IMG_STORE = 'images';
let imgDB = null;
function openImageDB() {
  if (imgDB) return imgDB;
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('This browser cannot store diagram images.'));
  imgDB = new Promise((resolve, reject) => {
    const req = indexedDB.open(IMG_DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(IMG_STORE)) req.result.createObjectStore(IMG_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open image storage.'));
  }).catch(e => { imgDB = null; throw e; });
  return imgDB;
}
function idbOp(mode, run) {
  return openImageDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(IMG_STORE, mode), req = run(tx.objectStore(IMG_STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error || new Error('Image storage failed.'));
    tx.onabort = () => reject(tx.error || new Error('Image storage failed.'));
  }));
}
function idbPut(id, blob) { return idbOp('readwrite', s => s.put(blob, id)); }
function idbGet(id) { return idbOp('readonly', s => s.get(id)); }
function idbDelete(id) { return idbOp('readwrite', s => s.delete(id)); }
const imgURLs = new Map(), imgMissing = new Set();
function imageURL(id) {
  if (!id || imgMissing.has(id)) return Promise.resolve('');
  if (imgURLs.has(id)) return Promise.resolve(imgURLs.get(id));
  return idbGet(id).then(blob => {
    if (!blob) { imgMissing.add(id); return ''; }
    const url = URL.createObjectURL(blob);
    imgURLs.set(id, url);
    return url;
  }).catch(() => { imgMissing.add(id); return ''; });
}
function dropImage(id) {
  const url = imgURLs.get(id);
  if (url) { URL.revokeObjectURL(url); imgURLs.delete(id); }
  imgMissing.delete(id);
  return idbDelete(id).catch(() => {});
}
const blobToDataURL = blob => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(String(fr.result));
  fr.onerror = () => reject(fr.error || new Error('Could not read the image.'));
  fr.readAsDataURL(blob);
});
function dataURLToBlob(data) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(data || ''));
  if (!m) throw new Error('Not a supported image.');
  const bin = atob(m[2]), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}
function imageBlock(it, big) {
  const wrap = h('span', { class: 'diagram' });
  const img = h('img', { alt: 'Diagram with the part to identify marked', decoding: 'async' });
  const pin = h('span', { class: 'pin' + (big ? ' big' : ''), 'aria-hidden': 'true' });
  if (it.hotspot) { pin.style.left = (it.hotspot.x * 100) + '%'; pin.style.top = (it.hotspot.y * 100) + '%'; }
  // Printed labels give the answer away, so the reviewer's covers sit between the image and the pin.
  const masks = cur && Array.isArray(cur.masks) ? cur.masks : [];
  wrap.append(img, ...coverSpans(masks, true), pin);
  imageURL(it.imageId).then(url => {
    if (url) { img.src = url; return; }
    pin.remove();
    wrap.append(h('span', { class: 'err' }, 'Diagram image is not on this device.'));
  });
  return wrap;
}

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
// What the plan will ask for on each of the next `days` days. Anything overdue is counted on day
// zero, so a backlog is never hidden behind a past date.
function forecast(r, days = 7) {
  const out = new Array(days).fill(0), today = todayNumber(), srs = planOf(r).srs || {};
  r.items.forEach(it => {
    const s = srs[it.id];
    const due = s && Number.isInteger(s.due) ? s.due : today;
    const at = Math.max(0, due - today);
    if (at < days) out[at]++;
  });
  return out;
}
// Streak: consecutive days with at least one graded answer or card. Kept per device, apart from the reviewers.
const STREAK_KEY = 'reviewer_gen_streak';
function streakAfter(s, today) { // s = { last, count } or null
  if (s && s.last === today) return s;
  return { last: today, count: s && s.last === today - 1 ? s.count + 1 : 1 };
}
// A streak still counts on the day after, so the student has until midnight to keep it.
function streakNow(s, today) { return s && Number.isInteger(s.count) && (s.last === today || s.last === today - 1) ? s.count : 0; }
function readStreak() { try { const s = JSON.parse(localStorage.getItem(STREAK_KEY)); return s && Number.isInteger(s.last) && Number.isInteger(s.count) ? s : null; } catch (e) { return null; } }
function bumpStreak() { try { localStorage.setItem(STREAK_KEY, JSON.stringify(streakAfter(readStreak(), todayNumber()))); } catch (e) { /* streak just will not show */ } }
const firstDue = () => R.find(r => dueCount(r) > 0);
function studyToday(r) { open(r); startFlash('due', optCap); }
// A card is never scheduled later than the exam, or the plan keeps teaching material after the
// test. A passed exam date stops clamping: revising a past paper should not make everything due.
function dueDay(r, box) {
  const wait = BOX_DAYS[box];
  const left = examDaysLeft(planOf(r).exam);
  return todayNumber() + (left !== null && left >= 0 ? Math.min(wait, left) : wait);
}
function reviewItem(r, id, ok) {
  bumpStreak();
  r.plan = planOf(r); r.plan.srs ||= {};
  const s = r.plan.srs[id] || { box: 0 };
  s.box = ok ? Math.min(s.box + 1, BOX_DAYS.length - 1) : 0;
  s.due = dueDay(r, s.box);
  r.plan.srs[id] = s;
}
function planCard() {
  const due = R.reduce((n, r) => n + dueCount(r), 0);
  const withDue = R.filter(r => dueCount(r) > 0).length;
  const next = R.filter(r => examDaysLeft(r.plan && r.plan.exam) !== null)
    .map(r => ({ r, n: examDaysLeft(r.plan.exam) }))
    .sort((a, b) => a.n - b.n)[0];
  return h('div', { class: 'card today' },
    h('h2', { class: 'k' }, 'Today'),
    h('p', null, due ? due + ' item' + (due === 1 ? '' : 's') + ' due in ' + withDue + ' reviewer' + (withDue === 1 ? '' : 's') + '.' : 'Nothing is due today — study ahead if you like.'),
    h('p', null, h('b', null, streakNow(readStreak(), todayNumber()) ? streakNow(readStreak(), todayNumber()) + '-day streak' : 'Start a streak today'), streakNow(readStreak(), todayNumber()) && readStreak().last !== todayNumber() ? ' · study today to keep it' : ''),
    h('p', { class: 'k' }, 'Next 7 days (today first): ' + R.reduce((acc, r) => forecast(r).map((n, i) => acc[i] + n), new Array(7).fill(0)).join(' · ')),
    h('label', null, 'Daily limit ', h('select', { 'aria-label': 'Items to study each day', onchange: e => { optCap = Number(e.target.value); try { localStorage.setItem('reviewer_cap_v1', String(optCap)); } catch (_) { /* this visit only */ } home(); } }, [[10, '10'], [20, '20'], [40, '40'], [0, 'All']].map(([v, t]) => h('option', { value: v, selected: v === optCap ? '' : null }, t)))),
    due > 0 && h('p', null, h('button', { class: 'btn', onclick: () => studyToday(firstDue()) }, 'Study today (' + due + ' due)')),
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
// Labels printed on a diagram image cannot be erased, so the author boxes them out instead. A cover
// is a normalized rectangle on the reviewer, drawn over the image in practice, flashcards,
// recitation and printouts, but only faintly outlined while it is being placed or removed.
const COVER_MAX = 24, COVER_MIN = 0.01;
const unit = n => Math.min(1, Math.max(0, n));
function cleanMasks(v) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, COVER_MAX).map(m => {
    if (!m || typeof m !== 'object') return null;
    const n = ['x', 'y', 'w', 'h'].map(k => (typeof m[k] === 'number' && Number.isFinite(m[k]) ? m[k] : NaN));
    if (n.some(Number.isNaN)) return null;
    const x = unit(n[0]), y = unit(n[1]);
    const w = Math.min(unit(n[2]), 1 - x), h = Math.min(unit(n[3]), 1 - y);
    return w >= COVER_MIN && h >= COVER_MIN ? { x, y, w, h } : null;
  }).filter(Boolean);
}
const coverStyle = m => 'left:' + (m.x * 100) + '%;top:' + (m.y * 100) + '%;width:' + (m.w * 100) + '%;height:' + (m.h * 100) + '%';
// A pointer position as a fraction of the image, so a cover or pin survives any display size.
function pointInRect(clientX, clientY, r) {
  if (!r || !r.width || !r.height) return null;
  return { x: unit((clientX - r.left) / r.width), y: unit((clientY - r.top) / r.height) };
}
function boxFromPoints(a, b) {
  if (!a || !b) return null;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
  return w >= COVER_MIN && h >= COVER_MIN ? { x, y, w, h } : null;
}
function moveBox(m, dx, dy) {
  return { x: Math.min(1 - m.w, Math.max(0, m.x + dx)), y: Math.min(1 - m.h, Math.max(0, m.y + dy)), w: m.w, h: m.h };
}
function resizeBox(m, dw, dh) {
  return { x: m.x, y: m.y, w: Math.min(1 - m.x, Math.max(COVER_MIN, m.w + dw)), h: Math.min(1 - m.y, Math.max(COVER_MIN, m.h + dh)) };
}
function coverSpans(masks, quiet) {
  return (masks || []).map(m => h('span', { class: 'cover', 'aria-hidden': quiet ? 'true' : null, style: coverStyle(m) }));
}
function applyCovers(r, list) {
  if (!r) return [];
  r.masks = cleanMasks(list);
  save();
  return r.masks;
}
function cleanItem(x) {
  if (!x || !['mc', 'id', 'enum', 'img'].includes(x.type)) return null;
  const id = str(x.id, 40), q = str(x.q), exp = str(x.exp) ?? '';
  if (!id || !q) return null;
  let it = null;
  if (x.type === 'img') {
    const answer = str(x.answer), imageId = str(x.imageId, 80), p = x.hotspot;
    const hotspot = p && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 ? { x: p.x, y: p.y } : null;
    if (answer && imageId && hotspot) it = { id, type: 'img', q, answer, imageId, hotspot, exp };
  } else if (x.type === 'mc') {
    const options = Array.isArray(x.options) ? x.options.map(o => str(o)) : [];
    if (options.length >= 2 && options.length <= 4 && !options.includes(null) && Number.isInteger(x.answer) && x.answer >= 0 && x.answer < options.length) it = { id, type: 'mc', q, options, answer: x.answer, exp };
  } else if (x.type === 'id') {
    const answer = str(x.answer);
    if (answer) it = { id, type: 'id', q, answer, exp };
  } else {
    const items = Array.isArray(x.items) ? x.items.map(o => str(o)) : [];
    if (items.length && !items.includes(null)) it = { id, type: 'enum', q, items, exp };
  }
  // A pinned question was added or edited by hand. It has no source line of its own, so Shuffle
  // has to carry it forward instead of regenerating the old wording.
  if (it && x.pinned === true) it.pinned = true;
  return it;
}
// A question the student removed is remembered by its itemKey(), so a rebuilt set cannot bring it
// back. The cap keeps a hand-edited backup from turning the field into a second source of text.
const HIDDEN_MAX = 400, HIDDEN_LEN = 600;
function cleanHidden(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const k of v) {
    if (typeof k !== 'string' || !k || k.length > HIDDEN_LEN || out.includes(k)) continue;
    out.push(k);
    if (out.length >= HIDDEN_MAX) break;
  }
  return out;
}
function cleanReviewer(x) {
  const title = str(x && x.title, 120), items = Array.isArray(x && x.items) ? x.items.map(cleanItem).filter(Boolean) : [];
  if (!title || items.length < 3) return null;
  const ids = new Set(items.map(it => it.id)), ans = {};
  for (const k in (x.ans || {})) {
    const a = x.ans[k];
    if (ids.has(k) && a && typeof a.ok === 'boolean' && str(a.exp) !== null && (typeof a.val === 'string' || Number.isInteger(a.val))) {
      const out = { val: a.val, ok: a.ok, exp: a.exp };
      if (typeof a.part === 'number' && a.part >= 0 && a.part <= 1) out.part = a.part; // enumeration fraction
      ans[k] = out;
    }
  }
  const idList = v => Array.isArray(v) ? v.filter(k => ids.has(k)) : [];
  // A hand-edited backup can carry an unbounded source array; keep only what Shuffle needs.
  let src = Array.isArray(x.src) && x.src.length <= 20000 && x.src.every(l => typeof l === 'string') ? x.src : undefined;
  let tags = src && Array.isArray(x.tags) && x.tags.length === src.length && x.tags.every(g => typeof g === 'string') ? x.tags : undefined;
  if (src) { src = capSrc(src); tags = tags && tags.slice(0, src.length); }
  const o = x.opts || {}, opts = { max: Number.isInteger(o.max) && o.max > 0 ? o.max : 0, mcOnly: o.mcOnly === true, noTF: o.noTF === true, noEnum: o.noEnum === true };
  // A backup may carry a study plan; keep only a valid date and entries for items that exist.
  const raw = x.plan && typeof x.plan === 'object' && !Array.isArray(x.plan) ? x.plan : {};
  const savedSrs = raw.srs && typeof raw.srs === 'object' && !Array.isArray(raw.srs) ? raw.srs : {};
  const srs = {};
  for (const k in savedSrs) {
    const s = savedSrs[k];
    if (ids.has(k) && s && Number.isInteger(s.box) && s.box >= 0 && s.box < BOX_DAYS.length && Number.isInteger(s.due)) srs[k] = { box: s.box, due: s.due };
  }
  const plan = { exam: validExamDate(raw.exam) ? raw.exam : '', srs };
  // A hand-edited backup must not hide so many questions that the reviewer drops below the
  // three-item minimum every other path enforces.
  let hidden = cleanHidden(x.hidden);
  if (items.filter(it => !hidden.includes(itemKey(it))).length < 3) hidden = [];
  // Removed questions are kept whole so they can be restored. Give one a fresh id rather than let
  // a hand-edited backup point two entries at the same id.
  const seen = new Set(items.map(it => it.id));
  const removed = (Array.isArray(x.removed) ? x.removed : []).slice(0, 200).map(cleanItem).filter(Boolean).map(it => {
    const out = seen.has(it.id) ? { ...it, id: newItemId() } : it;
    seen.add(out.id);
    return out;
  });
  return { id: newRid(), title, items, ans, flashKnown: idList(x.flashKnown), flashLearn: idList(x.flashLearn), flags: idList(x.flags), src, tags, opts, plan, masks: cleanMasks(x.masks), hidden, removed };
}
let note = ''; // one-time message shown on the home screen after export or import
// Backups carry reviewer data plus any diagram images as data URLs, so a file still works on
// another device. Old array-only backups keep importing unchanged.
function cleanBackup(data) {
  const list = Array.isArray(data) ? data : data && Array.isArray(data.reviewers) ? data.reviewers : [data];
  const reviewers = list.map(cleanReviewer).filter(Boolean);
  const images = {};
  const raw = data && !Array.isArray(data) && data.images && typeof data.images === 'object' ? data.images : {};
  const referenced = new Set();
  reviewers.forEach(r => [...r.items, ...(r.removed || [])].forEach(it => { if (it.type === 'img' && it.imageId) referenced.add(it.imageId); }));
  for (const id in raw) {
    const entry = raw[id];
    const value = entry && typeof entry.data === 'string' ? entry.data : '';
    if (typeof id !== 'string' || id.length > 80 || !referenced.has(id)) continue;
    if (value.length > 8 * 1024 * 1024 || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) continue;
    images[id] = value;
  }
  return { reviewers, images };
}
async function exportAll(only) {
  const list = only ? [only] : R;
  const ids = new Set(), images = {};
  list.forEach(r => [...r.items, ...(r.removed || [])].forEach(it => { if (it.type === 'img' && it.imageId) ids.add(it.imageId); }));
  for (const id of ids) {
    try { const blob = await idbGet(id); if (blob) images[id] = await blobToDataURL(blob); } catch (_) { /* keep the reviewer without this image */ }
  }
  try { localStorage.setItem(BACKUP_KEY, String(Date.now())); } catch (_) { /* nudge just repeats */ }
  const payload = { version: 2, reviewers: list, images };
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: 'application/json' })), download: 'reviewers.json' });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  const nImg = Object.keys(images).length;
  note = 'Saved ' + list.length + ' reviewer(s)' + (nImg ? ' with ' + nImg + ' diagram image(s)' : '') + ' to reviewers.json. Check your Downloads.';
  home();
}
async function importFile(f) {
  try {
    const { reviewers, images } = cleanBackup(JSON.parse(await f.text()));
    if (!reviewers.length) throw new Error('no reviewers');
    const ids = Object.keys(images);
    for (const id of ids) {
      try { await idbPut(id, dataURLToBlob(images[id])); imgMissing.delete(id); } catch (_) { /* reviewer still imports; the item shows a missing image */ }
    }
    let replaced = 0;
    for (const nr of reviewers) {
      const dup = R.find(r => sameReviewer(r, nr));
      // A duplicate is never created silently: replacing carries the old progress onto the new copy.
      if (dup && confirm('A reviewer with the same title and questions already exists ("' + dup.title + '"). Replace it and keep its progress? Choose Cancel to keep both.')) {
        const kept = carryProgress(dup.items, nr.items, { ans: dup.ans, known: dup.flashKnown || [], learn: dup.flashLearn || [], srs: planOf(dup).srs || {}, flags: dup.flags || [] });
        nr.ans = kept.ans; nr.flashKnown = [...kept.known]; nr.flashLearn = [...kept.learn]; nr.flags = [...kept.flags];
        nr.plan = planOf(nr); nr.plan.srs = kept.srs;
        nr.hidden = cleanHidden([...(nr.hidden || []), ...(dup.hidden || [])]);
        R = R.filter(r => r !== dup);
        replaced++;
      }
      R.unshift(nr);
    }
    save();
    note = 'Imported ' + reviewers.length + ' reviewer(s)' + (replaced ? ', replaced ' + replaced + ' with progress kept' : '') + (ids.length ? ' with ' + ids.length + ' image(s)' : '') + '.';
  } catch (e) { note = 'Could not import: this is not a reviewer backup file.'; }
  home();
}
// The same backup imported twice is the same reviewer, even though every import gets a new id.
function sameReviewer(a, b) {
  if (!a || !b || a.title.trim().toLowerCase() !== b.title.trim().toLowerCase()) return false;
  return a.items.map(itemKey).sort().join('\n') === b.items.map(itemKey).sort().join('\n');
}
function deleteReviewer(r) {
  R = R.filter(x => x !== r);
  const used = new Set();
  R.forEach(x => [...x.items, ...(x.removed || [])].forEach(it => { if (it.type === 'img' && it.imageId) used.add(it.imageId); }));
  [...r.items, ...(r.removed || [])].forEach(it => { if (it.type === 'img' && it.imageId && !used.has(it.imageId)) dropImage(it.imageId); });
  save(); home();
}

async function run() {
  busy = true; err = ''; status = 'Starting…'; home();
  try {
    let lines = [], tags = [];
    if (!files.length) {
      lines = pasteLines(pasteText);
      if (lines.length < 3) throw new Error('Choose a file, or paste at least a few lines of notes.');
    }
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
    const opts = { max: optMax, mcOnly: optMc, noTF: optNoTF, noEnum: optNoEnum }, items = generate(lines, tags, opts);
    if (items.length < 3) throw new Error('Could not find enough definitions or lists in this file. Notes written as full sentences ("X is …") work best.');
    const titleEl = document.getElementById('title');
    const title = (titleEl && titleEl.value.trim()) || (files[0] ? files[0].name.replace(/\.[^.]+$/, '') : 'Pasted notes');
    pending = { title, items, src: lines, tags, opts, hidden: [], removed: [] }; files = []; preview(); // saved only after the student checks the questions
  } catch (e) { err = String(e.message || e); }
  busy = false; status = ''; if (!cur && !pending) home();
}

function savePending() {
  const p = pending, src = capSrc(p.src);
  // Tags are one string per source line, so they are trimmed with the source they describe.
  const tags = Array.isArray(p.tags) ? p.tags.slice(0, src.length) : [];
  const removed = (p.removed || []).slice(0, 200).map(cleanItem).filter(Boolean);
  const r = { id: newRid(), title: p.title, items: p.items, ans: {}, src, tags, opts: p.opts, plan: { exam: '', srs: {} }, flags: [], hidden: cleanHidden(p.hidden), removed };
  pending = null; R.unshift(r); save(); open(r);
}
let removedAt = null;
function preview() {
  const p = pending, few = p.items.length < 3;
  draw(h('div', null,
    h('button', { class: 'btn alt', onclick: () => home() }, '← Cancel'),
    h('h1', null, 'Check your questions'),
    h('p', { class: 'sub' }, 'Remove any question that looks wrong or confusing, then save. A removed question stays out of later shuffles.'),
    h('div', { class: 'row' }, h('button', { class: 'btn', disabled: few ? '' : null, onclick: savePending }, 'Save reviewer (' + p.items.length + ' questions)'),
      h('button', { class: 'btn alt', onclick: () => openItemEditor({ items: p.items, hidden: p.hidden, removed: p.removed, index: -1, back: preview }) }, 'Add a question'),
      few && h('span', { class: 'err' }, 'Keep at least 3 questions.')),
    h('div', { class: 'items' }, p.items.map((it, i) => h('div', { class: 'card' },
      h('div', { class: 'k' }, TABS[it.type]), h('div', { class: 'q' }, it.q), h('p', null, 'Answer: ' + flashAnswer(it)),
      h('div', { class: 'row' },
        h('button', { class: 'btn alt', onclick: () => openItemEditor({ items: p.items, hidden: p.hidden, removed: p.removed, index: i, back: preview }) }, 'Edit'),
        h('button', { class: 'btn alt rm', 'aria-label': 'Remove question ' + (i + 1), onclick: () => { p.hidden = cleanHidden([...(p.hidden || []), itemKey(it)]); p.removed = [...(p.removed || []), it]; p.items.splice(i, 1); removedAt = i; preview(); say('Removed. ' + p.items.length + ' questions left.'); } }, 'Remove')))))), 'preview');
  // The removed card is gone; put focus on the Remove button that took its place.
  const rm = app.querySelectorAll('.rm'); if (rm.length && removedAt !== null) rm[Math.min(removedAt, rm.length - 1)].focus();
  removedAt = null;
}

// Editing a question in place. The same screen serves a saved reviewer and the pending preview:
// the target carries the list to change, where to go back to, and whether the reviewer owns
// progress that has to be pruned. Any edited question is pinned, because it no longer matches a
// source line and Shuffle would otherwise regenerate the old wording.
let editTarget = null, editDraft = null, editErr = '';
function openItemEditor(target) {
  const before = target.index >= 0 ? target.items[target.index] : null;
  const it = before || { type: 'id' };
  editTarget = { ...target, before };
  editDraft = {
    type: it.type,
    q: it.q || '',
    answer: it.answer || '',
    exp: it.exp || '',
    options: it.type === 'mc' ? [...it.options, '', '', ''].slice(0, 4) : ['', '', '', ''],
    correct: it.type === 'mc' ? it.answer : 0,
    enumText: it.type === 'enum' ? it.items.join('\n') : ''
  };
  editErr = '';
  itemEditor();
}
function itemEditor() {
  const d = editDraft, t = editTarget;
  if (!d || !t) return;
  const label = (text, node) => h('label', null, text, node);
  const option = (value, i) => h('label', { class: 'row' },
    h('input', { type: 'radio', name: 'q-correct', checked: d.correct === i ? '' : null, onchange: () => { editDraft.correct = i; } }),
    h('input', { type: 'text', value, 'aria-label': 'Option ' + (i + 1), placeholder: 'Option ' + (i + 1), oninput: e => { editDraft.options[i] = e.target.value; } }));
  const node = h('div', null,
    h('button', { class: 'btn alt', onclick: () => { editTarget = null; editDraft = null; t.back(); } }, '← Cancel'),
    h('h1', null, t.index < 0 ? 'Add a question' : 'Edit question'),
    h('p', { class: 'sub' }, 'A saved question keeps its study schedule. Changing its answer clears the old result so it is graded fresh.'),
    h('div', { class: 'card' },
      h('p', { class: 'k' }, TABS[d.type] || 'Question'),
      label('Question', h('textarea', { rows: 3, 'aria-label': 'Question', oninput: e => { editDraft.q = e.target.value; } }, d.q)),
      d.type === 'mc'
        ? h('div', null, d.options.map(option), h('p', { class: 'k' }, 'Mark the correct option. Leave an option empty to use fewer than four.'))
        : d.type === 'enum'
          ? label('Answers (one per line)', h('textarea', { rows: 5, 'aria-label': 'Enumeration answers', oninput: e => { editDraft.enumText = e.target.value; } }, d.enumText))
          : label(d.type === 'img' ? 'Label' : 'Answer', h('input', { type: 'text', value: d.answer, 'aria-label': 'Answer', oninput: e => { editDraft.answer = e.target.value; } })),
      label('Explanation (optional)', h('input', { type: 'text', value: d.exp, 'aria-label': 'Explanation', oninput: e => { editDraft.exp = e.target.value; } })),
      editErr && h('p', { class: 'err', role: 'alert' }, editErr),
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: saveEditor }, 'Save question'),
        t.index >= 0 && h('button', { class: 'btn alt', onclick: deleteFromEditor }, 'Delete'))));
  draw(node, 'editor');
}
function saveEditor() {
  const t = editTarget, d = editDraft, old = t.before;
  if (!d.q.trim()) { editErr = 'Write the question first.'; itemEditor(); return; }
  const base = { id: old ? old.id : newItemId(), type: d.type, q: d.q.trim(), exp: d.exp.trim(), pinned: true };
  let candidate;
  if (d.type === 'mc') {
    const options = d.options.map(o => String(o).trim()).filter(Boolean);
    const chosen = String(d.options[d.correct] || '').trim();
    if (options.length < 2) { editErr = 'Give at least two options.'; itemEditor(); return; }
    if (!chosen || options.indexOf(chosen) < 0) { editErr = 'Mark the correct option.'; itemEditor(); return; }
    candidate = { ...base, options, answer: options.indexOf(chosen) };
  } else if (d.type === 'enum') {
    candidate = { ...base, items: d.enumText.split(/\r?\n|,/).map(s => s.trim()).filter(Boolean) };
  } else if (d.type === 'img') {
    candidate = { ...base, answer: d.answer.trim(), imageId: old && old.imageId, hotspot: old && old.hotspot };
  } else {
    candidate = { ...base, answer: d.answer.trim() };
  }
  const clean = cleanItem(candidate);
  if (!clean) { editErr = d.type === 'enum' ? 'Add at least one answer.' : 'A question needs its text and a correct answer.'; itemEditor(); return; }
  const keyChanged = old && itemKey(old) !== itemKey(clean);
  if (t.index >= 0) t.items[t.index] = clean; else t.items.push(clean);
  // Remember the old wording so Shuffle cannot regenerate the version that was just replaced.
  const hidden = t.reviewer ? (t.reviewer.hidden || (t.reviewer.hidden = [])) : t.hidden;
  if (hidden) {
    if (old && keyChanged) hidden.push(itemKey(old));
    const keep = cleanHidden(hidden).filter(k => k !== itemKey(clean));
    hidden.length = 0; hidden.push(...keep);
  }
  if (t.reviewer) {
    if (old && keyChanged) { delete t.reviewer.ans[clean.id]; delete draft[clean.id]; }
    t.reviewer.removed = (t.reviewer.removed || []).filter(x => x.id !== clean.id);
    save();
  }
  editTarget = null; editDraft = null; editErr = '';
  t.back();
}
function deleteFromEditor() {
  const t = editTarget;
  if (!t) return;
  if (t.items.length <= 3) { editErr = 'Keep at least three questions.'; itemEditor(); return; }
  if (!confirm('Delete this question?')) return;
  const it = t.items[t.index];
  if (t.reviewer) removeItem(t.reviewer, it);
  else {
    t.items.splice(t.index, 1);
    if (t.removed) t.removed.push(it);
    if (t.hidden) { t.hidden.push(itemKey(it)); const keep = cleanHidden(t.hidden); t.hidden.length = 0; t.hidden.push(...keep); }
  }
  editTarget = null; editDraft = null; editErr = '';
  t.back();
}
// Removing an item prunes only that item's progress. The item itself is kept so it can come back
// from the Removed list; its key stays hidden so Shuffle cannot regenerate a copy meanwhile.
function removeItem(r, it) {
  if (!r || !it || r.items.length <= 3) return false;
  r.items = r.items.filter(x => x.id !== it.id);
  delete r.ans[it.id];
  if (r.plan && r.plan.srs) delete r.plan.srs[it.id];
  r.flashKnown = (r.flashKnown || []).filter(k => k !== it.id);
  r.flashLearn = (r.flashLearn || []).filter(k => k !== it.id);
  r.flags = (r.flags || []).filter(k => k !== it.id);
  r.removed = [...(r.removed || []).filter(x => x.id !== it.id), it];
  r.hidden = cleanHidden([...(r.hidden || []), itemKey(it)]);
  save();
  return true;
}
function restoreItem(r, it) {
  if (!r || !it) return false;
  r.removed = (r.removed || []).filter(x => x.id !== it.id);
  r.hidden = cleanHidden((r.hidden || []).filter(k => k !== itemKey(it)));
  if (!r.items.some(x => x.id === it.id)) r.items.push(it);
  save();
  return true;
}
function removedScreen(r) {
  const node = h('div', null,
    h('div', { class: 'row' }, h('button', { class: 'btn alt', onclick: () => open(r) }, '← Back'), h('span', { class: 'k' }, 'REMOVED')),
    h('h1', null, 'Removed questions'),
    h('p', { class: 'sub' }, 'Restore a question to practice it again. Its old answer and study schedule are not restored.'),
    (r.removed && r.removed.length)
      ? h('div', { class: 'items' }, r.removed.map(it => h('div', { class: 'card' },
          h('div', { class: 'k' }, TABS[it.type]),
          h('div', { class: 'q' }, it.q),
          h('p', null, 'Answer: ' + flashAnswer(it)),
          h('button', { class: 'btn', onclick: () => { restoreItem(r, it); removedScreen(r); say('Question restored.'); } }, 'Restore'))))
      : h('p', { class: 'k' }, 'Nothing has been removed from this reviewer.'));
  draw(node, 'removed');
}

// Diagram reviewer: one image, tap the parts, name each one, then practice naming them offline.
let diagBlob = null, diagURL = '', diagTitleText = '', diagParts = [], diagPending = null, diagNameText = '', diagBusy = false, diagErr = '', diagToken = 0;
function clearDiagram() {
  diagToken++;
  if (diagURL) URL.revokeObjectURL(diagURL);
  diagBlob = null; diagURL = ''; diagTitleText = ''; diagParts = []; diagPending = null; diagNameText = ''; diagBusy = false; diagErr = '';
}
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = url;
  });
}
// Phone photos are far larger than a diagram needs; cap the longest side and compress so a
// reviewer with a few diagrams stays small.
async function prepareImage(file) {
  if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Choose a PNG, JPEG or WebP image.');
  const original = URL.createObjectURL(file);
  let img;
  try { img = await loadImage(original); }
  catch (e) { URL.revokeObjectURL(original); throw new Error('Could not read that image.'); }
  if (!img.width || !img.height) { URL.revokeObjectURL(original); throw new Error('That image has no readable size.'); }
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  if (scale === 1 && file.size <= 900 * 1024) return { blob: file, url: original };
  try {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    let blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.85));
    if (!blob) blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    if (!blob) throw new Error('Could not prepare that image.');
    URL.revokeObjectURL(original);
    return { blob, url: URL.createObjectURL(blob) };
  } catch (e) {
    URL.revokeObjectURL(original);
    throw new Error(e && e.message ? e.message : 'Could not prepare that image.');
  }
}
async function pickDiagram(file) {
  if (!file) return;
  const token = ++diagToken;
  diagErr = ''; diagBusy = true; diagramSetup();
  try {
    const { blob, url } = await prepareImage(file);
    // The student may have gone home or picked another image while this was decoding.
    if (token !== diagToken) { URL.revokeObjectURL(url); return; }
    if (diagURL) URL.revokeObjectURL(diagURL);
    diagBlob = blob; diagURL = url; diagParts = []; diagPending = null; diagNameText = '';
    if (!diagTitleText) diagTitleText = file.name.replace(/\.[^.]+$/, '').slice(0, 120);
  } catch (e) { if (token === diagToken) diagErr = e && e.message ? e.message : 'Could not read that image.'; }
  if (token !== diagToken) return;
  diagBusy = false; diagramSetup();
}
function addPart() {
  if (!diagPending) { diagErr = 'Tap the part on the image first.'; diagramSetup(); return; }
  const name = diagNameText.trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!name) return;
  if (diagParts.some(p => p.name.toLowerCase() === name.toLowerCase())) { diagErr = 'That part is already labeled.'; diagramSetup(); return; }
  diagParts.push({ x: diagPending.x, y: diagPending.y, name });
  diagPending = null; diagNameText = ''; diagErr = ''; diagramSetup();
  const input = document.getElementById('part-name'); if (input) input.focus();
  say(name + ' added. ' + diagParts.length + ' parts labeled.');
}
async function createDiagram() {
  if (!diagBlob || diagParts.length < 3 || diagBusy) return;
  const token = ++diagToken;
  diagBusy = true; diagErr = ''; diagramSetup();
  try {
    const imageId = 'img_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    await idbPut(imageId, diagBlob);
    if (token !== diagToken) { dropImage(imageId); return; }
    const title = (diagTitleText.trim() || 'Diagram').slice(0, 120);
    const items = diagParts.map((p, i) => ({ id: 'img' + i, type: 'img', q: 'Identify the part marked on the diagram.', answer: p.name, imageId, hotspot: { x: p.x, y: p.y }, exp: '' }));
    const r = { id: newRid(), title, items, ans: {}, src: undefined, tags: undefined, opts: { max: 0, mcOnly: false }, plan: { exam: '', srs: {} }, flags: [], masks: [] };
    R.unshift(r); save(); clearDiagram(); open(r);
  } catch (e) {
    if (token !== diagToken) return;
    diagBusy = false;
    diagErr = e && e.message ? e.message : 'Could not save the diagram reviewer.';
    diagramSetup();
  }
}
function diagramSetup() {
  const canCreate = !!diagBlob && diagParts.length >= 3 && !diagBusy;
  const pins = diagParts.map((p, i) => {
    const el = h('span', { class: 'pin', 'aria-hidden': 'true' }, h('b', null, i + 1));
    el.style.left = (p.x * 100) + '%'; el.style.top = (p.y * 100) + '%';
    return el;
  });
  if (diagPending) {
    const el = h('span', { class: 'pin pending', 'aria-hidden': 'true' }, h('b', null, '?'));
    el.style.left = (diagPending.x * 100) + '%'; el.style.top = (diagPending.y * 100) + '%';
    pins.push(el);
  }
  draw(h('div', null,
    h('button', { class: 'btn alt', onclick: () => { clearDiagram(); home(); } }, '← Cancel'),
    h('h1', null, 'Diagram reviewer'),
    h('p', { class: 'sub' }, 'Upload a diagram, tap each part you want to learn, and type its name. Each label becomes an identification question that works offline.'),
    warn(),
    h('div', { class: 'card' },
      h('h2', { class: 'k' }, '1 · Image'),
      h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': 'Choose a diagram image', onchange: e => pickDiagram(e.target.files[0]) }),
      diagURL
        ? h('span', { class: 'diagram' },
            h('img', { src: diagURL, alt: 'Diagram to label. Tap a part to place a marker.', onclick: e => {
              const r = e.currentTarget.getBoundingClientRect();
              if (!r.width || !r.height) return;
              diagPending = { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
              diagErr = ''; diagramSetup();
              const input = document.getElementById('part-name'); if (input) input.focus();
              say('Point placed. Type the name of that part.');
            } }), pins)
        : h('p', { class: 'k' }, diagBusy ? 'Preparing the image…' : 'No image chosen yet. PNG, JPEG or WebP.'),
      diagURL && h('p', { class: 'k' }, 'Tap the image to place a marker. Choosing another image starts over; images are resized to 1600 px and stay on this device.')),
    diagURL && h('div', { class: 'card' },
      h('h2', { class: 'k' }, '2 · Parts'),
      diagParts.length
        ? h('div', null, diagParts.map((p, i) => h('div', { class: 'part row' },
            h('span', { class: 'mono' }, String(i + 1)),
            h('span', { style: 'flex:1' }, p.name),
            h('button', { class: 'btn alt', 'aria-label': 'Remove part ' + (i + 1) + ': ' + p.name, onclick: () => { diagParts.splice(i, 1); diagramSetup(); say(p.name + ' removed.'); } }, 'Remove'))))
        : h('p', { class: 'k' }, 'No parts labeled yet.'),
      h('div', { class: 'row' },
        h('input', { type: 'text', id: 'part-name', 'aria-label': 'Name of the marked part', placeholder: diagPending ? 'Name the marked part' : 'Tap the image first', value: diagNameText, oninput: e => {
          diagNameText = e.target.value;
          const btn = document.getElementById('add-part'); if (btn) btn.disabled = !diagNameText.trim();
        }, onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); addPart(); } } }),
        h('button', { class: 'btn', id: 'add-part', disabled: !diagPending || !diagNameText.trim() ? '' : null, onclick: addPart }, 'Add part')),
      h('p', { class: 'k' }, 'Label at least 3 parts.')),
    diagURL && h('div', { class: 'card' },
      h('h2', { class: 'k' }, '3 · Name and practice'),
      h('input', { type: 'text', 'aria-label': 'Reviewer title', placeholder: 'Reviewer title (for example: Parts of the heart)', value: diagTitleText, oninput: e => { diagTitleText = e.target.value; } }),
      h('p', null, h('button', { class: 'btn', disabled: canCreate ? null : '', onclick: createDiagram }, diagBusy ? 'Saving…' : 'Create diagram reviewer')),
      diagParts.length < 3 && h('p', { class: 'k' }, 'Add at least 3 parts first.')),
    diagErr && h('p', { class: 'err', role: 'alert' }, diagErr)), 'diagram');
}

// Printed labels on a textbook diagram name the answer next to every pin. The pixels cannot be
// changed, so covers are drawn over the text and saved with the reviewer. Practice renders them
// opaque; this screen shows them as outlines so they can still be adjusted.
let coverFor = null, coverList = [], coverStart = null, coverIndex = -1;
function openCovers(r) {
  if (!r || !r.items.some(i => i.type === 'img')) return;
  coverFor = r; coverList = cleanMasks(r.masks); coverStart = null;
  coverIndex = coverList.length ? 0 : -1;
  coversScreen();
}
function focusCover() {
  const el = app.querySelectorAll('.cover.on');
  if (el && el[0] && el[0].focus) el[0].focus();
}
function hideDraft() {
  const el = document.getElementById('cover-draft');
  if (el && el.style) el.style.display = 'none';
}
function updateDraft(a, b) {
  const el = document.getElementById('cover-draft');
  const box = boxFromPoints(a, b);
  if (!el || !el.style) return;
  if (!box) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.style.left = (box.x * 100) + '%'; el.style.top = (box.y * 100) + '%';
  el.style.width = (box.w * 100) + '%'; el.style.height = (box.h * 100) + '%';
}
function moveCoverKey(e, i) {
  const d = e.shiftKey ? 0.02 : 0.01;
  const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
  const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
  if (dx || dy) {
    e.preventDefault();
    coverList[i] = e.shiftKey ? resizeBox(coverList[i], dx, dy) : moveBox(coverList[i], dx, dy);
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault(); coverList.splice(i, 1); coverIndex = Math.min(i, coverList.length - 1);
    coversScreen(); focusCover(); say('Cover removed.'); return;
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault(); coverIndex = i; coversScreen(); focusCover(); return;
  } else return;
  coverIndex = i; coversScreen(); focusCover();
}
function coversScreen() {
  const r = coverFor; if (!r) return quiz();
  const it = r.items.find(i => i.type === 'img');
  const img = h('img', { alt: 'Diagram with printed labels to cover', decoding: 'async', draggable: 'false' });
  const draft = h('span', { class: 'cover draft', id: 'cover-draft', 'aria-hidden': 'true' });
  const covers = coverList.map((m, i) => {
    const el = h('span', { class: 'cover editing' + (i === coverIndex ? ' on' : ''), tabindex: '0', role: 'button',
      'aria-label': 'Cover ' + (i + 1) + '. Arrow keys move it, Shift with arrows resizes it, Delete removes it.', style: coverStyle(m) });
    el.onclick = () => { coverIndex = i; coversScreen(); focusCover(); };
    el.onkeydown = e => moveCoverKey(e, i);
    return el;
  });
  // Pins stay visible so a cover is never placed over the part being tested without noticing.
  const pins = r.items.filter(i => i.type === 'img').map(i => {
    const p = h('span', { class: 'pin', 'aria-hidden': 'true' });
    if (i.hotspot) { p.style.left = (i.hotspot.x * 100) + '%'; p.style.top = (i.hotspot.y * 100) + '%'; }
    return p;
  });
  const where = e => pointInRect(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
  img.onpointerdown = e => {
    if (e.button != null && e.button !== 0) return;
    const p = where(e); if (!p) return;
    coverStart = p;
    if (e.currentTarget.setPointerCapture) { try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* older browser */ } }
    e.preventDefault();
  };
  img.onpointermove = e => { if (!coverStart) return; updateDraft(coverStart, where(e)); e.preventDefault(); };
  img.onpointerup = e => {
    if (!coverStart) return;
    const box = boxFromPoints(coverStart, where(e));
    coverStart = null; hideDraft();
    if (box) { coverList.push(box); coverIndex = coverList.length - 1; coversScreen(); focusCover(); say('Cover added. ' + coverList.length + ' cover(s).'); }
    e.preventDefault();
  };
  img.onpointercancel = () => { coverStart = null; hideDraft(); };
  const wrap = h('span', { class: 'diagram covering' }, img, ...covers, ...pins, draft);
  imageURL(it && it.imageId).then(url => { if (url) img.src = url; else wrap.append(h('span', { class: 'err' }, 'Diagram image is not on this device.')); });
  const add = () => {
    coverList.push({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }); coverIndex = coverList.length - 1;
    coversScreen(); focusCover(); say('Cover added. Drag it or use the arrow keys.');
  };
  const remove = i => {
    coverList.splice(i, 1); coverIndex = Math.min(i, coverList.length - 1);
    coversScreen(); focusCover();
  };
  const saveCovers = () => {
    const n = applyCovers(r, coverList).length;
    coverFor = null; coverList = []; coverIndex = -1; coverStart = null;
    quiz(); say(n ? n + ' cover(s) saved.' : 'Covers removed.');
  };
  const leave = () => { coverFor = null; coverList = []; coverIndex = -1; coverStart = null; quiz(); };
  draw(h('div', null,
    h('div', { class: 'row' }, h('button', { class: 'btn alt', onclick: leave }, '← Back'), h('span', { class: 'k' }, 'PRINTED LABELS')),
    h('h1', null, 'Hide printed labels'),
    h('p', { class: 'sub' }, 'Text printed on the diagram gives the answer away. Drag over that text to cover it: covers show while you practise, in flashcards and on printouts, but they are only outlines here so you can still adjust them.'),
    warn(),
    h('div', { class: 'card' }, wrap,
      h('p', { class: 'k' }, coverList.length ? coverList.length + ' cover(s). Drag on the image to add another.' : 'Drag a box over any printed label. One box per block of text is usually enough.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn alt', onclick: add }, 'Add cover'),
        coverList.length > 0 && h('button', { class: 'btn alt', onclick: () => { coverList = []; coverIndex = -1; coversScreen(); say('All covers cleared.'); } }, 'Clear all'))),
    coverList.length > 0 && h('div', { class: 'card' },
      h('h2', { class: 'k' }, 'Covers'),
      coverList.map((m, i) => h('div', { class: 'part row' },
        h('span', { class: 'mono' }, String(i + 1)),
        h('span', { style: 'flex:1' }, 'Cover ' + (i + 1)),
        h('button', { class: 'btn alt', 'aria-label': 'Remove cover ' + (i + 1), onclick: () => remove(i) }, 'Remove')))),
    h('p', null, h('button', { class: 'btn', onclick: saveCovers }, 'Save covers')),
    h('p', { class: 'k' }, 'Covers are saved with this reviewer on this device. Pins stay visible here so you can see what is being tested; in practice the printed labels are hidden and the pins remain.')), 'covers');
}

// Pomodoro-style focus timer: 25 minutes of study, then a 5 minute break that starts on its own.
// The bar lives outside #app so screen redraws never remove it, and the deadline is an absolute
// timestamp so a throttled tab (or a reload) still finishes the block on time.
const FOCUS_KEY = 'reviewer_focus_v1', FOCUS_MS = 25 * 60000, BREAK_MS = 5 * 60000;
let focus = loadFocus(), focusClockTimer = null, focusAudio = null;
const focusClock = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
function cleanFocus(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const phase = ['idle', 'focus', 'break'].includes(v.phase) ? v.phase : 'idle';
  const cap = Date.now() + 864e5; // a saved deadline further out than a day is corrupt, not a block
  const end = Number.isFinite(v.end) && v.end > 0 && v.end <= cap ? v.end : 0;
  const running = v.running === true && phase !== 'idle' && end > 0;
  const max = Math.max(FOCUS_MS, BREAK_MS);
  const left = Number.isFinite(v.left) ? Math.min(max, Math.max(0, v.left)) : FOCUS_MS;
  return {
    phase, running, end: running ? end : 0,
    left: phase === 'idle' ? FOCUS_MS : left,
    done: Number.isInteger(v.done) && v.done >= 0 && v.done <= 500 ? v.done : 0,
    day: Number.isInteger(v.day) ? v.day : todayNumber()
  };
}
function loadFocus() {
  try {
    const f = cleanFocus(JSON.parse(localStorage.getItem(FOCUS_KEY)));
    if (f && f.day === todayNumber()) return f;
    if (f) return { ...f, done: 0, day: todayNumber() }; // a new day starts the count again
  } catch (_) { /* no saved timer */ }
  return { phase: 'idle', running: false, end: 0, left: FOCUS_MS, done: 0, day: todayNumber() };
}
function focusSave() { try { localStorage.setItem(FOCUS_KEY, JSON.stringify(focus)); } catch (_) { /* timer still runs, just is not remembered */ } }
// One transition step, pure so the clock can be tested without waiting 25 minutes. A block that
// ended long ago finishes its break against the original deadline instead of starting a fresh one.
function focusNext(f, now) {
  const events = [];
  let next = { ...f };
  if (!next.running || next.phase === 'idle' || !next.end || next.end > now) return { f: next, events };
  if (next.phase === 'focus') {
    events.push('focus-done');
    next = { ...next, phase: 'break', end: next.end + BREAK_MS, left: BREAK_MS, done: next.done + 1 };
    if (next.end > now) return { f: next, events };
    events.push('break-done');
  } else {
    events.push('break-done');
  }
  return { f: { ...next, phase: 'idle', running: false, end: 0, left: FOCUS_MS }, events };
}
function focusSoundReady() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    focusAudio ||= new Ctx();
    if (focusAudio.state === 'suspended') focusAudio.resume();
  } catch (_) { focusAudio = null; }
}
// A short two-note chime made with WebAudio: no audio file, nothing uploaded. If the browser
// blocked audio before any tap, the live announcement still fires.
function focusChime() {
  try {
    if (!focusAudio || focusAudio.state !== 'running') return;
    const start = focusAudio.currentTime;
    [880, 1174.7].forEach((hz, i) => {
      const osc = focusAudio.createOscillator(), gain = focusAudio.createGain(), at = start + i * 0.18;
      osc.frequency.value = hz;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.12, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      osc.connect(gain).connect(focusAudio.destination);
      osc.start(at); osc.stop(at + 0.18);
    });
  } catch (_) { /* silent */ }
}
const focusLabelEl = h('b', { class: 'focus-phase' }, 'Focus');
const focusTimeEl = h('span', { class: 'focus-time', role: 'timer', 'aria-live': 'off' }, focusClock(FOCUS_MS));
const focusCountEl = h('span', { class: 'focus-count' });
const focusFill = h('i');
const focusMainBtn = h('button', { class: 'btn', onclick: focusToggle }, 'Start');
const focusStopBtn = h('button', { class: 'btn alt', onclick: focusStop }, 'Stop');
const focusBar = h('div', { class: 'focusbar', role: 'group', 'aria-label': 'Focus timer' },
  h('span', { class: 'focus-progress', 'aria-hidden': 'true' }, focusFill),
  focusLabelEl, focusTimeEl, focusCountEl,
  h('span', { class: 'focus-actions' }, focusMainBtn, focusStopBtn));
app.after(focusBar);
function focusRenderTick(now = Date.now()) {
  const running = focus.running && focus.phase !== 'idle';
  const left = running ? Math.max(0, focus.end - now) : focus.left;
  const total = focus.phase === 'break' ? BREAK_MS : FOCUS_MS;
  focusTimeEl.textContent = focusClock(left);
  focusFill.style.width = Math.min(100, Math.max(0, (1 - left / total) * 100)) + '%';
}
function focusRender() {
  if (focus.day !== todayNumber()) focus = { ...focus, done: 0, day: todayNumber() };
  const phase = focus.phase;
  focusLabelEl.textContent = phase === 'break' ? 'Break' : 'Focus';
  focusCountEl.textContent = focus.done + ' today';
  focusCountEl.setAttribute('aria-label', focus.done + ' focus block' + (focus.done === 1 ? '' : 's') + ' completed today');
  focusMainBtn.textContent = phase === 'idle' ? 'Start' : focus.running ? 'Pause' : 'Resume';
  focusMainBtn.setAttribute('aria-label', phase === 'idle' ? 'Start a 25 minute focus block'
    : focus.running ? 'Pause the ' + (phase === 'break' ? 'break' : 'focus timer')
    : 'Resume the ' + (phase === 'break' ? 'break' : 'focus timer'));
  focusStopBtn.textContent = phase === 'break' ? 'Skip' : 'Stop';
  focusStopBtn.setAttribute('aria-label', phase === 'break' ? 'Skip the break' : 'Stop the focus block');
  focusStopBtn.hidden = phase === 'idle';
  focusBar.dataset.paused = focus.running ? '0' : '1';
  focusBar.setAttribute('aria-label', 'Focus timer, ' + (phase === 'idle' ? 'ready' : phase === 'break' ? 'break' : 'focus') + (phase !== 'idle' && !focus.running ? ', paused' : ''));
  focusRenderTick();
}
function focusTickStop() { if (focusClockTimer) { clearInterval(focusClockTimer); focusClockTimer = null; } }
function focusTickStart() {
  if (focusClockTimer || focus.phase === 'idle' || !focus.running) return;
  focusClockTimer = setInterval(focusTick, 1000);
}
function focusTick() {
  const now = Date.now(), today = todayNumber();
  const base = focus.day === today ? focus : { ...focus, done: 0, day: today };
  const { f, events } = focusNext(base, now);
  if (!events.length) { focusRenderTick(now); return; }
  focus = f; focusSave(); focusRender(); focusChime();
  const done = events.includes('break-done');
  say(done ? 'Break over. Start the next focus block when ready.' : 'Focus block done. Take a 5 minute break.');
  if (focus.phase === 'idle') focusTickStop();
}
function focusToggle() {
  focusSoundReady();
  const today = todayNumber();
  if (focus.day !== today) focus = { ...focus, done: 0, day: today };
  if (focus.phase === 'idle') {
    focus = { ...focus, phase: 'focus', running: true, end: Date.now() + FOCUS_MS, left: FOCUS_MS };
    say('Focus block started. 25 minutes.');
  } else if (focus.running) {
    focus = { ...focus, running: false, left: Math.max(0, focus.end - Date.now()), end: 0 };
    say(focus.phase === 'break' ? 'Break paused.' : 'Focus paused.');
  } else {
    focus = { ...focus, running: true, end: Date.now() + Math.max(1000, focus.left) };
    say(focus.phase === 'break' ? 'Break resumed.' : 'Focus resumed.');
  }
  focusSave(); focusRender();
  if (focus.running) focusTickStart(); else focusTickStop();
}
function focusStop() {
  const was = focus.phase;
  focus = { ...focus, phase: 'idle', running: false, end: 0, left: FOCUS_MS };
  focusTickStop(); focusSave(); focusRender();
  say(was === 'break' ? 'Break skipped.' : 'Focus block stopped.');
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && focus.running) focusTick(); });
focusRender();
if (focus.running) { focusTick(); focusTickStart(); }

// Saved-reviewer order. "Recent" keeps the order they were added in, which is the only date the
// reviewer record has; the others are cheap to compute from the plan.
function sortReviewers(list) {
  const m = list.slice();
  if (qSort === 'due') m.sort((a, b) => dueCount(b) - dueCount(a));
  else if (qSort === 'exam') m.sort((a, b) => (examDaysLeft(planOf(a).exam) ?? 1e9) - (examDaysLeft(planOf(b).exam) ?? 1e9));
  else if (qSort === 'title') m.sort((a, b) => a.title.localeCompare(b.title));
  return m;
}
function home() {
  pending = null;
  if (reciteActive) stopVoice();
  if (lastScreen === 'diagram') clearDiagram();
  const list = h('div', { class: 'list' });
  flashing = false; stopTimer();
  const n = note; note = '';
  const t = document.getElementById('title'), tv = t ? t.value : '';
  const node = h('div', null,
    h('h1', null, 'Reviewer Generator'),
    h('p', { class: 'sub' }, 'Pick a PDF, PowerPoint (.pptx), Word (.docx) or text file. The reviewer is built on this device, no internet needed.'),
    warn(),
    R.length > 0 && planCard(),
    R.length > 0 && backupOld() && h('p', { class: 'k', role: 'status' }, 'No backup in the last 14 days. Your reviewers live only in this browser, so use "Export all" below.'),
    h('div', { class: 'card' },
      h('input', { type: 'file', id: 'file', 'aria-label': 'Choose a PDF, PowerPoint, Word or text file', accept: '.pdf,.pptx,.ppt,.docx,.txt,.md,text/plain,application/pdf', multiple: '', onchange: e => { files = [...e.target.files]; home(); } }),
      h('p', { class: 'k' }, files.length ? files.length + ' file(s): ' + files.map(f => f.name).join(', ') : 'No file chosen'),
      h('input', { type: 'text', id: 'title', 'aria-label': 'Reviewer title (optional)', placeholder: 'Reviewer title (optional)', value: tv }),
      h('textarea', { rows: 5, 'aria-label': 'Paste notes', placeholder: '…or paste your notes here (at least 200 characters)', oninput: e => { pasteText = e.target.value; } }, pasteText),
      h('div', { class: 'row' },
        h('label', null, 'Questions: ', h('select', { onchange: e => { optMax = Number(e.target.value); } }, [[0, 'All (max ' + (ITEM_CAP.mc + ITEM_CAP.id + ITEM_CAP.tf + ITEM_CAP.enum) + ')'], [10, '10'], [20, '20']].map(([v, t]) => h('option', { value: v, selected: v === optMax ? '' : null }, t)))),
        h('label', null, h('input', { type: 'checkbox', checked: optMc ? '' : null, onchange: e => { optMc = e.target.checked; } }), 'Multiple choice only')),
      h('div', { class: 'row' },
        h('label', null, h('input', { type: 'checkbox', checked: optNoTF ? null : '', onchange: e => { optNoTF = !e.target.checked; } }), 'True / false'),
        h('label', null, h('input', { type: 'checkbox', checked: optNoEnum ? null : '', onchange: e => { optNoEnum = !e.target.checked; } }), 'Enumeration')),
      h('p', null, h('button', { class: 'btn', disabled: busy ? '' : null, onclick: run }, busy ? 'Working…' : 'Generate reviewer')),
      status && h('p', { class: 'k', role: 'status' }, status), err && h('p', { class: 'err', role: 'alert' }, err)),
    h('div', { class: 'card' },
      h('h2', { class: 'k' }, 'Diagrams'),
      h('p', { class: 'k' }, 'Upload a heart, cell, map or any diagram, tap its parts and name them. Each part becomes an identification question that works offline.'),
      h('button', { class: 'btn alt', onclick: () => { clearDiagram(); diagramSetup(); } }, 'Make a diagram reviewer')),
    h('div', { class: 'card' }, h('h2', { class: 'k' }, 'Backup'),
      h('p', { class: 'k' }, 'Save your reviewers to a file to move them to another device or keep a copy.'),
      h('div', { class: 'row' }, h('button', { class: 'btn alt', disabled: R.length ? null : '', onclick: exportAll }, 'Export all'),
        h('label', null, 'Import a backup: ', h('input', { type: 'file', accept: '.json,application/json', onchange: e => { if (e.target.files[0]) importFile(e.target.files[0]); } }))),
      n && h('p', { role: 'status' }, n)),
    R.length > 0 && h('h2', { class: 'k' }, 'Saved reviewers'),
    R.length > 2 && h('div', { class: 'row' },
      h('input', { type: 'search', 'aria-label': 'Search saved reviewers', placeholder: 'Search saved reviewers', value: q, oninput: e => { q = e.target.value; fill(); } }),
      h('label', null, 'Sort ', h('select', { onchange: e => { qSort = e.target.value; home(); } }, [['recent', 'Recently added'], ['due', 'Most due'], ['exam', 'Next exam'], ['title', 'Title']].map(([v, t]) => h('option', { value: v, selected: v === qSort ? '' : null }, t)))),
      h('label', null, h('input', { type: 'checkbox', checked: qDue ? '' : null, onchange: e => { qDue = e.target.checked; home(); } }), 'Due only')),
    list);
  const match = r => (R.length <= 2 || r.title.toLowerCase().includes(q.trim().toLowerCase())) && (!qDue || dueCount(r) > 0);
  const fill = () => { const m = sortReviewers(R.filter(match)); list.replaceChildren(...(m.length || !R.length ? m.map(card) : [h('p', { class: 'k' }, 'No saved reviewer matches "' + q + '".')])); };
  const card = r => h('div', { class: 'card saved' },
      h('div', null, h('b', null, r.title),
        h('div', { class: 'k' }, r.items.length + ' items · ' + Object.values(r.ans).filter(a => a.ok).length + ' correct'
          + (dueCount(r) ? ' · ' + dueCount(r) + ' due' : '')
          + (examDaysLeft(r.plan && r.plan.exam) !== null ? ' · ' + examText(r.plan.exam) : ''))),
      h('div', { class: 'row actions' },
        dueCount(r) > 0 && h('button', { class: 'btn', onclick: () => { open(r); startFlash('due', optCap); } }, 'Review ' + dueCount(r)),
        h('button', { class: 'btn alt', onclick: () => open(r) }, 'Open'),
        h('button', { class: 'btn alt', onclick: () => exportAll(r) }, 'Save file'),
        h('button', { class: 'btn alt', onclick: () => { if (confirm('Delete "' + r.title + '"?')) deleteReviewer(r); } }, 'Delete')));
  fill(); cur = null; draw(node, 'home'); if (n) say(n);
  const nt = document.getElementById('title'); if (nt) nt.value = tv;
}

const TABS = { mc: 'Multiple choice', id: 'Identification', enum: 'Enumeration', img: 'Diagram' };
// A partial enumeration answer earns its fraction; every other type is all or nothing.
const credit = a => (a && typeof a.part === 'number' ? a.part : a && a.ok ? 1 : 0);
const scoreText = n => String(Math.round(n * 10) / 10);
let lastUndo = null;
// One-question mode: chosen explicitly (and remembered) or defaulted by width. A stored choice wins,
// so a student who prefers the list on a phone keeps it after the first tap.
const VIEW_KEY = 'reviewer_quiz_view';
let quizView = null;
try { const v = localStorage.getItem(VIEW_KEY); if (v === 'one' || v === 'list') quizView = v; } catch (_) { /* follow the width */ }
const narrowQuiz = () => typeof matchMedia === 'function' && matchMedia('(max-width: 520px)').matches;
function viewMode() { return quizView || (narrowQuiz() ? 'one' : 'list'); }
function setQuizView(v) {
  quizView = v;
  try { localStorage.setItem(VIEW_KEY, v); } catch (_) { /* this visit only */ }
  quiz(); scrollTo(0, 0);
}
function nextQuiz() {
  if (!cur) return;
  const n = cur.items.filter(i => i.type === tab).length;
  quizIndex = Math.min(quizIndex + 1, Math.max(0, n - 1));
  quiz(); scrollTo(0, 0);
}
function prevQuiz() {
  if (!cur) return;
  quizIndex = Math.max(0, quizIndex - 1);
  quiz(); scrollTo(0, 0);
}
function toggleFlag(r, it) {
  const set = new Set(r.flags || []);
  if (set.has(it.id)) set.delete(it.id); else set.add(it.id);
  r.flags = [...set]; save();
  if (lastScreen === 'jump') jumpScreen(r); else quiz();
  say(set.has(it.id) ? 'Flagged for later.' : 'Flag removed.');
}
function jumpScreen(r) {
  const items = r.items.filter(i => i.type === tab), flags = new Set(r.flags || []);
  const node = h('div', null,
    h('div', { class: 'row' }, h('button', { class: 'btn alt', onclick: quiz }, '← Back'), h('span', { class: 'k' }, 'JUMP TO')),
    h('h1', null, 'Question ' + (quizIndex + 1) + ' of ' + items.length),
    h('p', { class: 'sub' }, TABS[tab] + ' · ' + items.length + ' questions'),
    h('div', { class: 'jump-grid', role: 'group', 'aria-label': 'Jump to question' }, items.map((it, i) => {
      const a = r.ans[it.id];
      const cls = 'jump-btn' + (a ? (a.ok ? ' ok' : ' bad') : '') + (i === quizIndex ? ' now' : '') + (flags.has(it.id) ? ' flagged' : '');
      return h('button', { class: cls, 'aria-label': 'Question ' + (i + 1) + (a ? (a.ok ? ', correct' : ', missed') : ', not answered') + (flags.has(it.id) ? ', flagged' : ''), onclick: () => { quizIndex = i; quiz(); scrollTo(0, 0); } }, String(i + 1));
    })),
    h('div', { class: 'jump-legend' },
      h('span', null, h('i', { class: 'o' }), 'correct'),
      h('span', null, h('i', { class: 'b' }), 'missed'),
      h('span', null, h('i', { class: 'n' }), 'not answered'),
      h('span', null, h('i', { class: 'f' }), 'flagged')),
    h('p', null, h('button', { class: 'btn wide', onclick: quiz }, 'Close')));
  draw(node, 'jump');
}
function printPart() {
  if (viewMode() !== 'one') { window.print(); return; }
  // One mode only has one card in the DOM; print the whole part, then return to the student's view.
  const stored = quizView;
  quizView = 'list'; quiz();
  setTimeout(() => { window.print(); quizView = stored; quiz(); }, 100);
}
function wipe() { for (const k in draft) delete draft[k]; }
// Shuffle = rebuild a new question set from the saved file text (random pick, new wrong options, new order).
// Reviewers saved before source text was kept can only reorder what they have. Ids are rebuilt, so
// answers and mastery are moved by itemKey() instead of by id; removed questions are filtered out.
function shuffleAll() {
  const old = cur.items, hidden = new Set(cur.hidden || []);
  const visible = old.filter(it => !hidden.has(itemKey(it)));
  // Questions added or edited by hand have no source line to rebuild from, so they are carried
  // forward and a freshly generated copy of the same fact is skipped in favour of the pinned one.
  const pinned = visible.filter(it => it.pinned === true), pinnedKeys = new Set(pinned.map(itemKey));
  const fresh = (cur.src ? generate(cur.src, cur.tags, cur.opts) : []).filter(it => !hidden.has(itemKey(it)) && !pinnedKeys.has(itemKey(it)));
  const next = [...pinned, ...fresh];
  if (next.length >= 3) cur.items = next;
  else {
    // Copies, not the saved objects: carryProgress() needs the old option order to move a chosen
    // option to its new index. "visible" already excludes removed questions.
    cur.items = shuffle(visible).map(it => {
      const copy = { ...it };
      if (it.type === 'mc') { const correct = it.options[it.answer]; copy.options = shuffle(it.options); copy.answer = copy.options.indexOf(correct); }
      return copy;
    });
  }
  const kept = carryProgress(old, cur.items, { ans: cur.ans, known: cur.flashKnown || [], learn: cur.flashLearn || [], srs: planOf(cur).srs || {}, flags: cur.flags || [] });
  cur.ans = kept.ans; cur.flashKnown = [...kept.known]; cur.flashLearn = [...kept.learn]; cur.flags = [...kept.flags];
  cur.plan = planOf(cur); cur.plan.srs = kept.srs;
  flashIndex = 0; quizIndex = 0; flashRevealed = false;
  wipe(); save(); quiz(); scrollTo(0, 0);
  say('New question set. Kept progress for ' + kept.kept + ' of ' + visible.length + ' items' + (hidden.size ? '; removed questions stay out.' : '.'));
}
function open(r) {
  // Drafts are keyed by item id, and item ids restart at id0 in every reviewer, so a half-typed answer
  // from another reviewer would appear here if they were kept.
  wipe();
  cur = r; const ts = Object.keys(TABS).filter(k => r.items.some(i => i.type === k)); tab = ts[0]; quizIndex = 0;
  r.flashKnown ||= []; flashIndex = 0; flashRevealed = false; r.flashLearn ||= []; r.flags ||= [];
  r.plan = planOf(r); r.plan.srs ||= {};
  quiz();
}

// Turn generated reviewer questions into front/back study cards. Progress is saved with the reviewer.
let flashIndex = 0, flashRevealed = false, flashing = false, flashMode = 'all', flashOrder = [];
// flashMode: 'all' | 'unknown' (not marked known yet) | 'due' (scheduled for today or overdue).
// flashOrder = item positions to study this session. "Review again" moves a card a few places later so it returns soon.
function startFlash(mode = 'all', cap = 0) {
  stopTimer(); flashMode = mode; flashIndex = 0; flashRevealed = false;
  const known = new Set(cur.flashKnown || []), due = new Set(dueIds(cur));
  flashOrder = cur.items.map((_, i) => i).filter(i =>
    mode === 'all' ? true : mode === 'unknown' ? !known.has(cur.items[i].id) : due.has(cur.items[i].id));
  if (mode === 'due' && cap > 0) flashOrder = flashOrder.slice(0, cap);
  flipcards(); scrollTo(0, 0);
}
function flashAnswer(it) {
  if (it.type === 'mc') return it.options[it.answer] || '';
  if (it.type === 'id' || it.type === 'img') return it.answer || '';
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
      h('p', null, due ? 'Nothing is due in this reviewer.' : 'You marked every card as known. Nice work.'),
      due && firstDue() && h('p', null, h('button', { class: 'btn', onclick: () => studyToday(firstDue()) }, 'Next: ' + firstDue().title + ' (' + dueCount(firstDue()) + ' due)')),
      due && !firstDue() && h('p', null, 'All done for today. Come back tomorrow, or study ahead.'),
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
    ? h('span', { class: 'flip-face answer-face' }, h('span', { class: 'k' }, 'ANSWER'), it.type === 'img' && imageBlock(it, true), h('span', { class: 'flip-copy' }, flashAnswer(it)), h('span', { class: 'flip-source' }, it.exp ? 'From your reviewer notes: ' + it.exp : ''))
    : h('span', { class: 'flip-face question-face' }, h('span', { class: 'k' }, 'QUESTION · TAP TO FLIP'), it.type === 'img' && imageBlock(it), h('span', { class: 'flip-copy' }, it.q));
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
  if (it.type === 'img') return 'Look at the diagram. Identify the part marked.';
  const q = it.q.replace(/_{3,}/g, 'blank');
  if (it.type !== 'mc') return q;
  return q + ' Options: ' + it.options.map((o, i) => 'ABCD'[i] + '. ' + o).join('. ') + '.';
}
function reciteAnswer(it) {
  if (it.type === 'mc') return 'The answer is ' + 'ABCD'[it.answer] + ': ' + it.options[it.answer] + '.';
  if (it.type === 'id' || it.type === 'img') return 'The answer is ' + it.answer + '.';
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
      it.type === 'img' && imageBlock(it, showAnswer),
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
  list.forEach(i => delete cur.ans[i.id]); wipe(); save(); stopTimer(); quizIndex = 0;
  timed = { tab, end: Date.now() + list.length * 30000, over: false };
  tick = setInterval(() => {
    if (!cur || flashing) return stopTimer();
    const left = timed.end - Date.now();
    if (left > 0) { const c = document.getElementById('clock'); if (c) c.textContent = fmt(left); return; }
    clearInterval(tick); timed.over = true; quiz(); say('Time is up.');
  }, 1000);
  quiz();
}

// One level of undo for an answer or a "Count it correct" tap. The answer and the plan entry are
// put back exactly as they were; the streak is not rewound, because the time was spent either way.
function snapshotAnswer(r, id) {
  const s = planOf(r).srs[id];
  return { r, id, ans: r.ans[id] ? { ...r.ans[id] } : null, srs: s ? { ...s } : null };
}
function undoAnswer() {
  const u = lastUndo;
  if (!u || cur !== u.r) return;
  if (u.ans) u.r.ans[u.id] = u.ans; else delete u.r.ans[u.id];
  u.r.plan = planOf(u.r);
  if (u.srs) u.r.plan.srs[u.id] = u.srs; else delete u.r.plan.srs[u.id];
  lastUndo = null; save(); quiz(); say('Answer undone.');
}
function markCorrect(r, it) {
  const a = r.ans[it.id];
  if (!a) return;
  lastUndo = snapshotAnswer(r, it.id);
  a.ok = true;
  reviewItem(r, it.id, true);
  save(); quiz(); say('Marked correct. Undo is available.');
}
function answer(it, val) {
  let ok, exp, part;
  if (it.type === 'mc') { ok = val === it.answer; exp = it.options[it.answer]; }
  else if (it.type === 'id' || it.type === 'img') { ok = idOk(it.answer, val); exp = it.answer; }
  else { const c = enumCheck(it.items, val); ok = c.ok; exp = it.items.join(', ') + (c.ok ? '' : ' (you missed: ' + c.missing.join(', ') + ')'); part = it.items.length ? c.got.length / it.items.length : 0; }
  lastUndo = snapshotAnswer(cur, it.id);
  const a = { val, ok, exp };
  if (part != null) a.part = part;
  cur.ans[it.id] = a;
  reviewItem(cur, it.id, ok);
  const mine = cur.items.filter(i => i.type === tab), done = mine.every(i => cur.ans[i.id]);
  if (done) stopTimer();
  save(); quiz();
  const got = mine.reduce((n, i) => n + credit(cur.ans[i.id]), 0);
  say((ok ? 'Correct. ' : 'Not quite. Answer: ' + exp + '. ') + (done ? 'Part finished: ' + scoreText(got) + ' of ' + mine.length + ' correct.' : ''));
  const fb = document.getElementById('fb-' + it.id); if (fb) fb.focus({ preventScroll: true });
}

function quizItem(r, it, idx, one) {
  const a = r.ans[it.id], over = !!(timed && timed.over && timed.tab === tab), flagged = (r.flags || []).includes(it.id);
  return h('div', { class: 'item' + (one ? ' one' : '') },
    h('div', { class: 'k' }, 'Q' + (idx + 1) + (a ? ' · ' : ''), a && h('span', { class: a.ok ? 'good' : 'miss' }, a.ok ? 'correct' : 'missed'),
      h('button', { class: 'btn alt flag-btn', 'aria-pressed': flagged ? 'true' : 'false', onclick: () => toggleFlag(r, it) }, flagged ? '⚑ Flagged' : '⚑ Flag'),
      h('button', { class: 'btn alt', onclick: () => openItemEditor({ items: r.items, hidden: r.hidden || (r.hidden = []), reviewer: r, index: r.items.indexOf(it), back: quiz }) }, 'Edit')),
    h('div', { class: 'q', id: 'q-' + it.id }, it.q),
    it.type === 'mc'
      ? h('div', { role: 'group', 'aria-labelledby': 'q-' + it.id }, it.options.map((o, oi) => h('button', { class: 'opt' + (a ? (oi === it.answer ? ' ok' : oi === a.val ? ' bad' : '') : ''), disabled: a || over ? '' : null, onclick: () => answer(it, oi) }, h('b', null, 'ABCD'[oi]), o, a && oi === it.answer && h('span', { class: 'mark' }, '✓ Correct answer'), a && oi === a.val && oi !== it.answer && h('span', { class: 'mark' }, '✗ Your answer'))))
      : h('div', null,
        it.type === 'img' && imageBlock(it),
        // The labels are right there in front of the reader, so the way to hide them belongs here
        // too, not only in a menu above the first question.
        it.type === 'img' && !(r.masks && r.masks.length) && h('p', { class: 'k' }, 'The printed labels give the answer away. ',
          h('button', { class: 'btn alt', onclick: () => openCovers(r) }, 'Hide printed labels')),
        it.type === 'enum'
          ? h('textarea', { rows: 4, 'aria-labelledby': 'q-' + it.id, placeholder: 'One per line or separated by commas', disabled: a || over ? '' : null, oninput: e => { draft[it.id] = e.target.value; }, onkeydown: e => { if (e.key === 'Enter' && e.ctrlKey) answer(it, draft[it.id] || ''); } }, a ? a.val : draft[it.id] || '')
          : h('input', { type: 'text', 'aria-labelledby': 'q-' + it.id, placeholder: 'Your answer', value: a ? a.val : draft[it.id] || '', disabled: a || over ? '' : null, oninput: e => { draft[it.id] = e.target.value; }, onkeydown: e => { if (e.key === 'Enter') answer(it, draft[it.id] || ''); } }),
        !a && !over && h('p', null, h('button', { class: 'btn', onclick: () => answer(it, draft[it.id] || '') }, 'Check'))),
    a && h('div', { class: 'fb' + (a.ok ? '' : ' bad'), id: 'fb-' + it.id, tabindex: '-1' }, h('b', null, a.ok ? 'Correct.' : 'Not quite.'),
      h('div', null, 'Answer: ' + a.exp + '.'),
      a.part != null && a.part < 1 && h('div', null, Math.round(a.part * it.items.length) + ' of ' + it.items.length + ' required answers were right.'),
      !a.ok && it.type !== 'mc' && h('button', { class: 'btn alt', onclick: () => markCorrect(r, it) }, 'Count it correct'),
      lastUndo && lastUndo.r === r && lastUndo.id === it.id && h('button', { class: 'btn alt', onclick: undoAnswer }, 'Undo')),
    a && it.type !== 'img' && sourcePanel(r, it),
    h('div', { class: 'ans-print' }, 'Answer: ' + flashAnswer(it)));
}
function quiz() {
  const r = cur, ts = Object.keys(TABS).filter(k => r.items.some(i => i.type === k));
  if (!ts.includes(tab)) tab = ts[0];
  const good = x => x.reduce((n, i) => n + credit(r.ans[i.id]), 0);
  const total = good(r.items), n = r.items.length;
  const mine = r.items.filter(i => i.type === tab);
  const missed = mine.filter(i => r.ans[i.id] && !r.ans[i.id].ok);
  const done = mine.length > 0 && mine.every(i => r.ans[i.id]), partGood = good(mine);
  const over = !!(timed && timed.over && timed.tab === tab), running = !!(timed && !timed.over && timed.tab === tab);
  const rename = () => { const t = prompt('New title', r.title), v = t && t.trim().slice(0, 120); if (v) { r.title = v; save(); quiz(); } };
  const clear = list => { list.forEach(i => delete r.ans[i.id]); quizIndex = 0; save(); quiz(); };
  const view = viewMode();
  quizIndex = Math.max(0, Math.min(quizIndex, Math.max(0, mine.length - 1)));
  const current = mine[quizIndex];
  const node = h('div', null,
    h('div', { class: 'row quiz-head' },
      h('button', { class: 'btn alt', onclick: home }, '← Back'),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Quiz layout' },
        h('button', { class: 'seg-btn' + (view === 'one' ? ' on' : ''), 'aria-pressed': view === 'one' ? 'true' : 'false', onclick: () => setQuizView('one') }, 'One'),
        h('button', { class: 'seg-btn' + (view === 'list' ? ' on' : ''), 'aria-pressed': view === 'list' ? 'true' : 'false', onclick: () => setQuizView('list') }, 'List'))),
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
      h('button', { class: 'btn alt', disabled: dueCount(r) ? null : '', onclick: () => startFlash('due', optCap) }, 'Review due (' + dueCount(r) + ')')),
    view === 'one'
      ? h('div', { class: 'row one-meta' }, h('span', { class: 'mono big' }, 'Q ' + (quizIndex + 1) + ' of ' + mine.length),
          h('span', { class: 'k' }, scoreText(total) + '/' + n + ' correct'),
          bar(mine.length ? (quizIndex + 1) / mine.length * 100 : 0, 'Question position'))
      : h('div', { class: 'row' }, h('span', { class: 'mono big' }, scoreText(total) + '/' + n),
          h('span', { class: 'k' }, 'correct so far · ' + n + ' items'),
          bar(n ? total / n * 100 : 0, 'Correct answers')),
    h('div', { class: 'tabs' }, ts.map(k => h('button', { class: 'tab' + (k === tab ? ' on' : ''), 'aria-current': k === tab ? 'true' : null, onclick: () => { if (timed && timed.tab !== k) stopTimer(); tab = k; quizIndex = 0; quiz(); scrollTo(0, 0); } },
      TABS[k] + ' ', h('span', { class: 'k' }, scoreText(good(r.items.filter(i => i.type === k))) + '/' + r.items.filter(i => i.type === k).length))),
      h('button', { class: 'tab', onclick: () => startFlash('all') }, '✦ Flipcards')),
    h('div', { class: 'row' },
      h('button', { class: 'btn', disabled: missed.length ? null : '', onclick: () => clear(missed) }, 'Retry missed (' + missed.length + ')'),
      h('button', { class: 'btn alt', onclick: () => clear(mine) }, 'Reset this part')),
    h('div', { class: 'row', style: 'margin-top:8px' },
      h('button', { class: 'btn alt', onclick: openRecite }, '🎧 Recite'),
      h('button', { class: 'btn alt', onclick: running ? () => { stopTimer(); quiz(); } : () => startTimed(mine) }, running ? 'Stop timer' : 'Timed practice (' + fmt(mine.length * 30000) + ')')),
    h('details', { class: 'more', open: running ? '' : null }, h('summary', null,
      h('span', null, h('b', null, 'More options'), h('span', { class: 'more-hint' }, 'Add, shuffle, rename, print'))),
      h('div', { class: 'row' },
        h('button', { class: 'btn alt', onclick: shuffleAll }, r.src ? 'Shuffle · new questions' : 'Shuffle'),
        h('button', { class: 'btn alt', onclick: rename }, 'Rename'),
        h('button', { class: 'btn alt', onclick: () => openItemEditor({ items: r.items, hidden: r.hidden || (r.hidden = []), reviewer: r, index: -1, back: quiz }) }, 'Add a question'),
        (r.removed && r.removed.length) && h('button', { class: 'btn alt', onclick: () => removedScreen(r) }, 'Removed questions (' + r.removed.length + ')'),
        ts.includes('img') && h('button', { class: 'btn alt', onclick: () => openCovers(r) }, r.masks && r.masks.length ? 'Edit label covers' : 'Hide printed labels'),
        h('button', { class: 'btn alt', onclick: printPart }, 'Print this part'))),
    tab === 'mc' && h('p', { class: 'k keys' }, 'Keys: 1–4 answer the ' + (view === 'one' ? 'current' : 'next') + ' question.'),
    running && h('p', { class: 'k' }, 'Time left: ', h('b', { id: 'clock', class: 'mono' }, fmt(timed.end - Date.now()))),
    view === 'one'
      ? h('div', { class: 'quiz-one' },
          current ? quizItem(r, current, quizIndex, true) : h('p', { class: 'k' }, 'No questions in this part.'),
          current && r.ans[current.id] && quizIndex < mine.length - 1 && h('p', null, h('button', { class: 'btn wide', onclick: nextQuiz }, 'Next question →')),
          h('div', { class: 'quiz-nav' },
            h('button', { class: 'btn alt', disabled: quizIndex === 0 ? '' : null, onclick: prevQuiz }, '← Previous'),
            h('button', { class: 'btn alt jump', onclick: () => jumpScreen(r) }, (quizIndex + 1) + ' / ' + mine.length + ' · Jump'),
            h('button', { class: 'btn alt', disabled: quizIndex >= mine.length - 1 ? '' : null, onclick: nextQuiz }, 'Next →')))
      : h('div', { class: 'items' }, mine.map((it, idx) => quizItem(r, it, idx, false))),
    (done || over) && h('div', { class: 'card done', role: 'status' }, h('b', null, (over && !done ? 'Time is up. ' : '') + 'Part score: ' + scoreText(partGood) + ' of ' + mine.length + ' correct (' + Math.round(partGood / mine.length * 100) + '%)'),
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
  if (lastScreen !== 'quiz') return;
  if (viewMode() === 'one') {
    if (e.key === 'ArrowRight') { e.preventDefault(); nextQuiz(); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); prevQuiz(); return; }
  }
  const pick = Number(e.key) - 1;
  let it = null;
  if (tab === 'mc' && !(timed && timed.over)) {
    const list = cur.items.filter(i => i.type === 'mc');
    it = viewMode() === 'one' ? list[quizIndex] : list.find(i => !cur.ans[i.id]);
    if (it && cur.ans[it.id]) it = null;
  }
  if (it && pick >= 0 && pick < it.options.length) answer(it, pick);
});
if (typeof matchMedia === 'function') {
  const mq = matchMedia('(max-width: 520px)');
  const resize = () => { if (!quizView && cur && lastScreen === 'quiz') quiz(); };
  if (mq.addEventListener) mq.addEventListener('change', resize); else if (mq.addListener) mq.addListener(resize);
}
home();
