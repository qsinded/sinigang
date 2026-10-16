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
let cur = null, tab = null, files = [], status = '', err = '', busy = false;
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
app.before(h('header', { class: 'site' }, h('nav', { 'aria-label': 'Main' }, h('button', { class: 'btn alt', onclick: () => home() }, 'Home')), live));
app.after(h('footer', { class: 'site' }, 'Works offline. Progress is saved on this device only. ',
  h('span', { class: 'keys' }, 'Keys: 1–4 pick an answer, Ctrl+Enter checks a list, ← → cards, Space flips.')));
function draw(node) { const y = scrollY; app.replaceChildren(node); scrollTo(0, y); }

// Classic scripts, worker runs on the main thread: phone HTML viewers block module imports and Workers.
function loadPdfjs() { pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.js'; return pdfjsLib; }
async function pdfLines(pdfjs, buf) {
  const doc = await pdfjs.getDocument({ data: buf }).promise, out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    status = 'Reading page ' + p + ' of ' + doc.numPages + '…'; home();
    const tc = await (await doc.getPage(p)).getTextContent();
    let line = '', y = null;
    for (const it of tc.items) {
      if (y !== null && Math.abs(it.transform[5] - y) > 2) { out.push(line); line = ''; }
      line += it.str; y = it.transform[5];
    }
    out.push(line);
  }
  return out;
}

async function run() {
  busy = true; err = ''; status = 'Starting…'; home();
  try {
    let lines = [], pdfjs = null;
    for (const f of files) {
      if (/\.pdf$/i.test(f.name)) { pdfjs = loadPdfjs(); lines.push(...await pdfLines(pdfjs, await f.arrayBuffer())); }
      else if (/\.pptx$/i.test(f.name)) lines.push(...await pptxLines(await f.arrayBuffer()));
      else if (/\.ppt$/i.test(f.name)) throw new Error('Old .ppt files cannot be read. In PowerPoint use Save As > .pptx (or PDF), then pick that file.');
      else lines.push(...(await f.text()).split(/\r?\n/));
    }
    if (lines.join('').length < 200) throw new Error('No readable text found. Scanned PDFs or slides that are only pictures cannot be read offline.');
    status = 'Building items…'; home();
    const items = generate(lines);
    if (items.length < 3) throw new Error('Could not find enough definitions or lists in this file. Notes written as full sentences ("X is …") work best.');
    const title = document.getElementById('title').value.trim() || files[0].name.replace(/\.[^.]+$/, '');
    const r = { id: Date.now(), title, items, ans: {}, src: lines };
    R.unshift(r); save(); files = []; open(r);
  } catch (e) { err = String(e.message || e); }
  busy = false; status = ''; if (!cur) home();
}

function home() {
  flashing = false;
  const t = document.getElementById('title'), tv = t ? t.value : '';
  const node = h('div', null,
    h('div', { class: 'k' }, '; Offline reviewer generator'),
    h('h1', null, 'Reviewer Generator'),
    h('p', { class: 'sub' }, 'Pick a PDF, PowerPoint (.pptx) or text file. The reviewer is built on this device, no internet needed.'),
    warn(),
    h('div', { class: 'card' },
      h('input', { type: 'file', id: 'file', accept: '.pdf,.pptx,.ppt,.txt,.md,text/plain,application/pdf', multiple: '', onchange: e => { files = [...e.target.files]; home(); } }),
      h('p', { class: 'k' }, files.length ? files.length + ' file(s): ' + files.map(f => f.name).join(', ') : 'No file chosen'),
      h('input', { type: 'text', id: 'title', placeholder: 'Reviewer title (optional)', value: tv }),
      h('p', null, h('button', { class: 'btn', disabled: busy || !files.length ? '' : null, onclick: run }, busy ? 'Working…' : 'Generate reviewer')),
      status && h('p', { class: 'k' }, status), err && h('p', { class: 'err' }, err)),
    R.length > 0 && h('div', { class: 'k' }, 'Saved reviewers'),
    h('div', { class: 'list' }, R.map(r => h('div', { class: 'card row' },
      h('div', { style: 'flex:1' }, h('b', null, r.title), h('div', { class: 'k' }, r.items.length + ' items · ' + Object.values(r.ans).filter(a => a.ok).length + ' correct')),
      h('button', { class: 'btn', onclick: () => open(r) }, 'Open'),
      h('button', { class: 'btn alt', onclick: () => { if (confirm('Delete "' + r.title + '"?')) { R = R.filter(x => x !== r); save(); home(); } } }, 'Delete')))));
  cur = null; draw(node);
  const nt = document.getElementById('title'); if (nt) nt.value = tv;
}

const TABS = { mc: 'Multiple choice', id: 'Identification', enum: 'Enumeration' };
function wipe() { for (const k in draft) delete draft[k]; }
// Shuffle = rebuild a new question set from the saved file text (random pick, new wrong options, new order).
// Reviewers saved before source text was kept can only reorder what they have.
function shuffleAll() {
  if (Object.keys(cur.ans).length && !confirm('Make a new shuffled set and reset your progress?')) return;
  const fresh = cur.src ? generate(cur.src) : [];
  if (fresh.length >= 3) cur.items = fresh;
  else {
    cur.items = shuffle(cur.items);
    cur.items.forEach(it => { if (it.type === 'mc') { const t = it.options[it.answer]; it.options = shuffle(it.options); it.answer = it.options.indexOf(t); } });
  }
  // Item ids are rebuilt (type + index), so old "mastered" flashcards would point at different questions.
  cur.ans = {}; cur.flashKnown = []; flashIndex = 0; flashRevealed = false;
  wipe(); save(); quiz(); scrollTo(0, 0);
}
function open(r) {
  cur = r; const ts = Object.keys(TABS).filter(k => r.items.some(i => i.type === k)); tab = ts[0];
  r.flashKnown ||= []; flashIndex = 0; flashRevealed = false; // start every reviewer on its first card
  quiz();
}

// Turn generated reviewer questions into front/back study cards. Progress is saved with the reviewer.
let flashIndex = 0, flashRevealed = false, flashing = false;
function flashAnswer(it) {
  if (it.type === 'mc') return it.options[it.answer] || '';
  if (it.type === 'id') return it.answer || '';
  return (it.items || []).join(', ');
}
function flipcards() {
  const r = cur; if (!r) return;
  const items = r.items || [];
  if (!items.length) { quiz(); return; }
  flashing = true;
  flashIndex = Math.max(0, Math.min(flashIndex, items.length - 1));
  const it = items[flashIndex];
  const known = new Set(r.flashKnown || []);
  // Spans, not divs: a <button> may only contain phrasing content. CSS makes them flex/block.
  const face = flashRevealed
    ? h('span', { class: 'flip-face answer-face' }, h('span', { class: 'k' }, 'ANSWER'), h('span', { class: 'flip-copy' }, flashAnswer(it)), h('span', { class: 'flip-source' }, it.exp ? 'From your reviewer notes: ' + it.exp : ''))
    : h('span', { class: 'flip-face question-face' }, h('span', { class: 'k' }, 'QUESTION · TAP TO FLIP'), h('span', { class: 'flip-copy' }, it.q));
  const node = h('div', null,
    h('div', { class: 'row' }, h('button', { class: 'btn alt', onclick: () => { home(); } }, '← Back'), h('span', { class: 'k' }, 'FLASHCARDS')),
    h('h1', null, r.title),
    h('p', { class: 'sub' }, 'Try to answer from memory, then flip the card. Mark what you know to track your progress.'),
    warn(),
    h('div', { class: 'flip-progress-row' }, h('span', { class: 'mono' }, (flashIndex + 1) + ' / ' + items.length), h('span', { class: 'k' }, known.size + ' mastered'), h('div', { class: 'bar' }, h('i', { style: 'width:' + (known.size / items.length * 100) + '%' }))),
    h('button', { class: 'flip-card' + (flashRevealed ? ' revealed' : ''), 'aria-label': flashRevealed ? 'Answer side, click to show question' : 'Question side, click to reveal answer', onclick: () => { flashRevealed = !flashRevealed; flipcards(); } }, face, h('span', { class: 'flip-hint' }, flashRevealed ? 'Click to see question' : 'Click to reveal answer')),
    h('div', { class: 'row flip-actions' },
      h('button', { class: 'btn alt', disabled: flashIndex === 0 ? '' : null, onclick: () => { flashIndex--; flashRevealed = false; flipcards(); } }, '← Previous'),
      h('button', { class: 'btn alt', onclick: () => { flashRevealed = !flashRevealed; flipcards(); } }, flashRevealed ? 'Show question' : 'Reveal answer'),
      h('button', { class: 'btn', onclick: () => { const set = new Set(r.flashKnown || []); set.add(it.id); r.flashKnown = [...set]; save(); nextFlash(items); } }, '✓ I knew it'),
      h('button', { class: 'btn alt', onclick: () => { r.flashKnown = (r.flashKnown || []).filter(id => id !== it.id); save(); nextFlash(items); } }, '↻ Review again'),
      h('button', { class: 'btn alt', disabled: flashIndex >= items.length - 1 ? '' : null, onclick: () => { flashIndex++; flashRevealed = false; flipcards(); } }, 'Next →')),
    h('p', { class: 'k flip-footnote' }, 'Tip: use “I knew it” only when you recalled the answer before flipping.'));
  draw(node);
  document.querySelector('.flip-card').focus({ preventScroll: true }); // keep keyboard users on the card after a redraw
}
function nextFlash(items) { flashIndex = flashIndex < items.length - 1 ? flashIndex + 1 : 0; flashRevealed = false; flipcards(); }

function answer(it, val) {
  let ok, exp;
  if (it.type === 'mc') { ok = val === it.answer; exp = it.options[it.answer]; }
  else if (it.type === 'id') { ok = idOk(it.answer, val); exp = it.answer; }
  else { const c = enumCheck(it.items, val); ok = c.ok; exp = it.items.join(', '); }
  cur.ans[it.id] = { val, ok, exp }; save(); quiz();
  const part = cur.items.filter(i => i.type === tab), done = part.every(i => cur.ans[i.id]);
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
  const clear = list => { list.forEach(i => delete r.ans[i.id]); save(); quiz(); };
  const node = h('div', null,
    h('button', { class: 'btn alt', onclick: home }, '← Back'),
    h('h1', null, r.title),
    h('p', { class: 'sub' }, 'Answer each item. You get the result and an explanation right away. Missed items stay marked so you can retry them.'),
    warn(),
    h('div', { class: 'row' }, h('span', { class: 'mono', style: 'font-size:28px;font-weight:700' }, total + '/' + n),
      h('span', { class: 'k' }, 'correct so far · ' + n + ' items'),
      h('div', { class: 'bar' }, h('i', { style: 'width:' + (n ? total / n * 100 : 0) + '%' }))),
    h('div', { class: 'tabs' }, ts.map(k => h('button', { class: 'tab' + (k === tab ? ' on' : ''), onclick: () => { tab = k; quiz(); scrollTo(0, 0); } },
      TABS[k] + ' ', h('span', { class: 'k' }, good(r.items.filter(i => i.type === k)) + '/' + r.items.filter(i => i.type === k).length))),
      h('button', { class: 'tab', onclick: () => { flashIndex = 0; flashRevealed = false; flipcards(); scrollTo(0, 0); } }, '✦ Flipcards')),
    h('div', { class: 'row' },
      h('button', { class: 'btn', disabled: missed.length ? null : '', onclick: () => clear(missed) }, 'Retry missed (' + missed.length + ')'),
      h('button', { class: 'btn alt', onclick: () => clear(mine) }, 'Reset this part')),
    h('div', { class: 'row', style: 'margin-top:8px' },
      h('button', { class: 'btn alt', onclick: shuffleAll }, r.src ? 'Shuffle · new questions' : 'Shuffle')),
    h('div', { class: 'items' }, mine.map((it, idx) => {
      const a = r.ans[it.id];
      return h('div', { class: 'item' },
        h('div', { class: 'k' }, 'Q' + (idx + 1) + (a ? ' · ' : ''), a && h('span', { class: a.ok ? 'good' : 'miss' }, a.ok ? 'correct' : 'missed')),
        h('div', { class: 'q' }, it.q),
        it.type === 'mc'
          ? it.options.map((o, oi) => h('button', { class: 'opt' + (a ? (oi === it.answer ? ' ok' : oi === a.val ? ' bad' : '') : ''), disabled: a ? '' : null, onclick: () => answer(it, oi) }, h('b', null, 'ABCD'[oi]), o, a && oi === it.answer && h('span', { class: 'mark' }, '✓ Correct answer'), a && oi === a.val && oi !== it.answer && h('span', { class: 'mark' }, '✗ Your answer')))
          : h('div', null,
            it.type === 'enum'
              ? h('textarea', { rows: 4, placeholder: 'One per line or separated by commas', disabled: a ? '' : null, oninput: e => { draft[it.id] = e.target.value; }, onkeydown: e => { if (e.key === 'Enter' && e.ctrlKey) answer(it, draft[it.id] || ''); } }, a ? a.val : draft[it.id] || '')
              : h('input', { type: 'text', placeholder: 'Your answer', value: a ? a.val : draft[it.id] || '', disabled: a ? '' : null, oninput: e => { draft[it.id] = e.target.value; }, onkeydown: e => { if (e.key === 'Enter') answer(it, draft[it.id] || ''); } }),
            !a && h('p', null, h('button', { class: 'btn', onclick: () => answer(it, draft[it.id] || '') }, 'Check'))),
        a && h('div', { class: 'fb' + (a.ok ? '' : ' bad'), id: 'fb-' + it.id, tabindex: '-1' }, h('b', null, a.ok ? 'Correct.' : 'Not quite.'),
          h('div', null, (a.ok ? '' : 'Answer: ' + a.exp + '. ') + 'Source: ' + it.exp)));
    })),
    done && h('div', { class: 'card done', role: 'status' }, h('b', null, 'Part finished: ' + partGood + ' of ' + mine.length + ' correct (' + Math.round(partGood / mine.length * 100) + '%)'),
      h('p', null, partGood === mine.length ? 'Perfect. Try another part or the flashcards.' : 'Use "Retry missed" at the top to practice the ones you got wrong.')));
  flashing = false;
  draw(node);
}

// Keys for laptops. Typing fields keep their own keys; Enter on a text answer is wired on the field itself.
document.addEventListener('keydown', e => {
  if (!cur || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target.tagName; if (t === 'INPUT' || t === 'TEXTAREA') return;
  if (flashing) {
    const last = cur.items.length - 1;
    if (e.key === 'ArrowRight' && flashIndex < last) { flashIndex++; flashRevealed = false; flipcards(); }
    else if (e.key === 'ArrowLeft' && flashIndex > 0) { flashIndex--; flashRevealed = false; flipcards(); }
    else if (e.key === ' ' && t !== 'BUTTON') { e.preventDefault(); flashRevealed = !flashRevealed; flipcards(); }
    return;
  }
  const pick = Number(e.key) - 1, it = tab === 'mc' && cur.items.find(i => i.type === 'mc' && !cur.ans[i.id]);
  if (it && pick >= 0 && pick < it.options.length) answer(it, pick);
});
home();
