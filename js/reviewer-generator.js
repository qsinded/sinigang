// Rule-based reviewer generator: no AI, no network. Input: array of text lines.
// ponytail: heuristics only (definitions, lists, caps-terms). Upgrade to a local LLM if quality is too low.
function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }

function idOk(ans, val) {
  const a = norm(ans), v = norm(val);
  if (!v) return false;
  if (a === v) return true;
  return v.length >= 4 && a.length >= 4 && ((a.includes(v) && v.length >= a.length * 0.6) || v.includes(a));
}

function enumCheck(items, val) {
  const vals = String(val).split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
  const got = items.filter(it => vals.some(v => idOk(it, v)));
  return { ok: got.length === items.length, got, missing: items.filter(i => !got.includes(i)) };
}

function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Distractors that look like the answer (similar length, same first word) so the right one is not obvious.
// bonus(x) lets the caller prefer candidates from the same section or of the same shape.
function near(t, c, bonus = () => 0) {
  const w = t.split(' ')[0].toLowerCase(), cost = x => Math.abs(x.length - t.length) - (x.split(' ')[0].toLowerCase() === w ? 20 : 0) - bonus(x);
  const ranked = shuffle(c).sort((a, b) => cost(a) - cost(b)), same = ranked.filter(x => bonus(x) > 0);
  return shuffle((same.length >= 3 ? same : ranked).slice(0, 6)).slice(0, 3); // same section/shape first when there are enough
}

const COMMON = new Set(['used', 'uses', 'that', 'this', 'with', 'from', 'into', 'which', 'what', 'when', 'where', 'each', 'than', 'then', 'their', 'there', 'holds', 'data']);
const words = s => new Set((String(s).toLowerCase().match(/[a-z0-9]{4,}/g) || []).filter(w => !COMMON.has(w)));
const overlap = (a, b) => { const x = words(a), y = words(b); let n = 0; x.forEach(w => { if (y.has(w)) n++; }); return n / (Math.min(x.size, y.size) || 1); };
// Pick another item's term to put in place of this one's, only when the swap cannot be true: the other term is not
// mentioned in this sentence, is not a variant of this term, and its own source says something different.
function verifiedSwap(it, list, srcOf, termOf, textOf) {
  const ok = list.filter(o => o !== it && norm(termOf(o)) !== norm(termOf(it))
    && !norm(termOf(o)).includes(norm(termOf(it))) && !norm(termOf(it)).includes(norm(termOf(o)))
    && !norm(srcOf(it)).includes(norm(termOf(o))) && overlap(textOf(it), textOf(o)) < 0.4);
  const pick = near(termOf(it), ok.map(termOf))[0];
  return pick;
}
// Kind of term: acronym (EAX), has a digit (IA-32), several words, or a plain word. Distractors of the same kind look as plausible.
const shape = t => /^[A-Z][A-Z0-9_.\-]+$/.test(t) ? 'acronym' : /\d/.test(t) ? 'number' : /\s/.test(t) ? 'phrase' : 'word';
const variant = (a, b) => { const x = norm(a), y = norm(b); return x === y || (x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x))); };
const BUL = /^(?:[•●▪◦\-*–]|\d+[.)]|[a-z][.)])\s+/;
const NOT_TERM = /^(this|that|these|those|it|they|there|here|which|what|when|where|if|in|on|for|each|some|all|one|we|you)\b/i;
const DEF = /^(?:(?:The|A|An)\s+)?([A-Za-z0-9.][\w .\/\-]{0,38}?)\s+(?:is defined as|is used to|refers to|stands for|means|is|are)\s+(.{15,})$/;
const COLON = /^([A-Za-z.][\w .\/\-]{0,38}?)\s*(?::|\s[–—-]\s)\s*(.{20,})$/;
const LOW = /^(note|notes|example|examples|figure|table|chapter|slide|page|summary|objectives?|introduction|references?|agenda)$/i; // headings, not terms
// Filler that adds no meaning to a study question: hedges, "see Figure 2", citations, trailing "etc.".
const FILL = /\b(?:basically|essentially|simply|actually|really|very|quite|just|in fact|please note that|note that|it is important to (?:note|remember) that)\b[,\s]*/gi;
const LEAD = /^(?:also|however|therefore|thus|moreover|furthermore|in addition|additionally|hence|so|then)\b,?\s+/i;
function clean(s) {
  return s.replace(/\s*\((?:see|refer to|cf\.?|fig\.?|figure|table)[^)]*\)/gi, '').replace(/\s*\[\d+(?:[,–-]\d+)*\]/g, '')
    .replace(LEAD, '').replace(FILL, '').replace(/[,;]?\s+(?:etc|and so on|and so forth)\.?$/i, '')
    .replace(/\s{2,}/g, ' ').replace(/\s+([,.;])/g, '$1').trim();
}
const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1);
// Outline material (agenda, "Module 2 — ...", "Topics covered") lists what a course covers; it is not a fact to quiz on.
const OUTLINE = /^(topics?( covered)?|agenda|outline|contents?|overview|objectives?|learning outcomes?|course (outline|map)|schedule|syllabus)$/i;
const LABEL = /^(module|unit|chapter|lesson|week|day|topic|part|section|session|lecture|step)\s*[\dIVX]+$/i;
const STOP = new Set(['AND', 'OR', 'THE', 'IF', 'IN', 'IS', 'IT', 'TO', 'OF', 'NOT', 'FOR', 'ON', 'AS', 'AT', 'BY']);

// tags[i] (optional) names where rawLines[i] came from, e.g. "page 3"; it is shown with the source sentence.
// o = { max: keep at most this many items (0 = all), mcOnly: multiple choice only }.
function generate(rawLines, tags = [], o = {}) {
  let lines = rawLines.map((l, i) => ({ t: l.replace(/\s+/g, ' ').trim(), g: tags[i] || '' })).filter(l => l.t);
  const cnt = {};
  lines.forEach(l => { cnt[l.t] = (cnt[l.t] || 0) + 1; });
  // drop page numbers and running headers/footers
  lines = lines.filter(l => !/^(page\s*)?\d+$/i.test(l.t) && !/^(module|unit|chapter|lesson|week|day|topic|session|lecture)\s*[\dIVX]+\s*[—–:-]/i.test(l.t) && !(cnt[l.t] >= 3 && l.t.length < 60));
  const tagOf = new Map(), ctxOf = new Map();
  let sect = ''; // nearest heading above the line, shown as context in the question
  const note = (s, g) => { if (g && !tagOf.has(s)) tagOf.set(s, g); if (!ctxOf.has(s)) ctxOf.set(s, sect); return s; };
  const ex = s => (tagOf.has(s) ? '(' + tagOf.get(s) + ') ' : '') + s;

  const sents = [], enums = [];
  let para = '', paraTag = '', hdr = null, hdrTag = '', items = [];
  const flushList = () => { if (hdr && items.length >= 3 && !OUTLINE.test(hdr.trim())) enums.push({ hdr, items: items.map(clean).filter(Boolean), src: note(hdr + ': ' + items.join(', '), hdrTag) }); hdr = null; items = []; };
  const flushPara = () => { if (para) para.split(/(?<=[.!?])\s+(?=[A-Z".])/).forEach(s => sents.push(note(s.trim(), paraTag))); para = ''; };

  for (const { t: l, g } of lines) {
    if (BUL.test(l)) {
      flushPara();
      const it = l.replace(BUL, '');
      if (hdr) items.push(it); else sents.push(note(it, g));
    } else {
      flushList();
      if (l.endsWith(':') && l.length < 100) { flushPara(); hdr = l.slice(0, -1); hdrTag = g; sect = hdr; }
      else if (l.length < 50 && !/[.!?:,;]$/.test(l)) { flushPara(); sect = l; } // heading
      else { if (!para) paraTag = g; para += (para ? ' ' : '') + l; }
    }
  }
  flushList(); flushPara();

  const defs = [], seen = new Set(), seenBody = new Set(), used = new Set(), seenEnum = new Set();
  for (const s of sents) {
    if (used.has(s) || s.length < 25 || s.length > 260 || OUTLINE.test((ctxOf.get(s) || '').trim())) continue;
    // inline list: "Registers: AX, BX, CX and DX."
    const m = s.match(/^(.{6,80}?):\s*(.+)$/);
    if (m) {
      const its = m[2].replace(/\.$/, '').split(/,\s*(?:and\s+|or\s+)?|;\s*|\s+and\s+/).map(x => x.trim()).filter(Boolean);
      if (its.length >= 3 && its.every(x => x.split(' ').length <= 6)) { enums.push({ hdr: m[1], items: its.map(clean).filter(Boolean), src: s }); used.add(s); continue; }
    }
    const d = s.match(DEF) || s.match(COLON);
    if (d) {
      const term = d[1].trim();
      const body = clean(d[2].replace(/[.;]$/, ''));
      // skip headings posing as terms and repeated definitions
      if (body.length >= 15 && term.split(' ').length <= 5 && !NOT_TERM.test(term) && !LOW.test(term) && !LABEL.test(term) && !seen.has(term.toLowerCase()) && !seenBody.has(norm(body))) {
        seen.add(term.toLowerCase()); seenBody.add(norm(body));
        const mask = body.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), '_____');
        defs.push({ kind: 'def', term, body: cap1(body), q: 'Which term is described? ' + cap1(mask), src: s, ctx: ctxOf.get(s) || '' });
        used.add(s);
      }
    }
  }

  const clozes = [], ctoks = new Set();
  for (const s of sents) {
    if (used.has(s) || s.length < 40 || s.length > 220 || OUTLINE.test((ctxOf.get(s) || '').trim())) continue;
    const mm = [...s.matchAll(/(?:^|[\s(])(\.?[A-Z][A-Z0-9_]{1,})\b/g)].map(x => x[1]).find(t => !STOP.has(t) && !ctoks.has(t));
    if (!mm) continue;
    ctoks.add(mm);
    clozes.push({ kind: 'cloze', term: mm, q: 'Fill in the blank: ' + clean(s).replace(mm, '_____'), src: s, ctx: ctxOf.get(s) || '' });
  }

  const pool = { def: defs, cloze: clozes };
  const all = shuffle([...defs, ...clozes]);
  const ctxByText = new Map([...defs.map(d => [d.term, d.ctx]), ...defs.map(d => [d.body, d.ctx]), ...clozes.map(c => [c.term, c.ctx])]);
  // Wrong options must not be arguable: not stated in the same sentence, not a variant of the answer, not saying the same thing.
  const fits = (it, o) => o !== it && !variant(o.term, it.term) && !norm(it.src).includes(norm(o.term)) && !(it.kind === 'def' && overlap(it.body, o.body) >= 0.4);
  const prefer = it => x => (ctxByText.get(x) === it.ctx ? 30 : 0) + (shape(x) === shape(it.term) ? 10 : 0);
  // A multiple choice item is only kept when its key is unambiguous: distinct options and the answer among them.
  const keyOk = (opts, ans) => new Set(opts.map(norm)).size === opts.length && opts.every(o => norm(o)) && opts.includes(ans);
  const out = [];
  let nMC = 0, nID = 0, nTF = 0;
  for (const it of all) {
    const dist = near(it.term, pool[it.kind].filter(o => fits(it, o)).map(o => o.term), prefer(it));
    // True/false. A "false" statement is only made when it is certainly false (see verifiedSwap), never by luck.
    if (nTF < 8 && Math.random() < 0.2) {
      const t = Math.random() < 0.5;
      if (it.kind === 'def') {
        const w = t ? it.term : verifiedSwap(it, defs, s => s.src, x => x.term, x => x.body);
        if (w) { out.push({ type: 'mc', q: 'True or false: "' + w + '" matches this description: ' + it.body, options: ['True', 'False'], answer: t ? 0 : 1, exp: ex(it.src) }); nTF++; continue; }
      } else {
        const w = t ? it.term : verifiedSwap(it, clozes, s => s.src, x => x.term, x => x.src);
        if (w) { out.push({ type: 'mc', q: 'True or false: ' + clean(it.src).replace(it.term, w), options: ['True', 'False'], answer: t ? 0 : 1, exp: ex(it.src) }); nTF++; continue; }
      }
    }
    // Half the time ask a definition the other way round, so a rebuilt set is not the same questions.
    if (it.kind === 'def' && dist.length === 3 && nMC < 30 && Math.random() < 0.5) {
      const bodies = defs.filter(d => fits(it, { ...d, term: d.body }) && !norm(d.body).includes(norm(it.term))).map(d => d.body);
      const opts = shuffle([it.body, ...near(it.body, bodies, x => (ctxByText.get(x) === it.ctx ? 30 : 0))]);
      if (opts.length === 4 && keyOk(opts, it.body)) {
        out.push({ type: 'mc', q: 'Which statement describes "' + it.term + '"?', options: opts, answer: opts.indexOf(it.body), exp: ex(it.src) });
        nMC++; continue;
      }
    }
    const opts = shuffle([it.term, ...dist]);
    if (dist.length === 3 && nMC < 30 && (nMC <= nID * 1.5 || nID >= 20) && keyOk(opts, it.term)) {
      out.push({ type: 'mc', q: it.q, options: opts, answer: opts.indexOf(it.term), exp: ex(it.src) });
      nMC++;
    } else if (nID < 20) {
      out.push({ type: 'id', q: it.q, answer: it.term, exp: ex(it.src) });
      nID++;
    }
  }
  shuffle(enums).filter(e => !seenEnum.has(norm(e.hdr)) && seenEnum.add(norm(e.hdr))).slice(0, 10).forEach(e =>
    out.push({ type: 'enum', q: 'Enumerate: ' + e.hdr, items: e.items, exp: ex(e.src) }));
  let res = o.mcOnly ? out.filter(x => x.type === 'mc') : out;
  if (o.max > 0) res = shuffle(res).slice(0, o.max);
  res.forEach((x, i) => { x.id = x.type + i; });
  return res;
}

if (typeof module !== 'undefined') module.exports = { generate, idOk, enumCheck, norm };
