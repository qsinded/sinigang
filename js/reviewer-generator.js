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
function near(t, c) {
  const w = t.split(' ')[0].toLowerCase(), cost = x => Math.abs(x.length - t.length) - (x.split(' ')[0].toLowerCase() === w ? 20 : 0);
  return shuffle(shuffle(c).sort((a, b) => cost(a) - cost(b)).slice(0, 6)).slice(0, 3);
}

const BUL = /^(?:[•●▪◦\-*–]|\d+[.)]|[a-z][.)])\s+/;
const NOT_TERM = /^(this|that|these|those|it|they|there|here|which|what|when|where|if|in|on|for|each|some|all|one|we|you)\b/i;
const DEF = /^(?:(?:The|A|An)\s+)?([A-Za-z0-9.][\w .\/\-]{0,38}?)\s+(?:is defined as|is used to|refers to|stands for|means|is|are)\s+(.{15,})$/;
const COLON = /^([A-Za-z.][\w .\/\-]{0,38}?)\s*(?::|\s[–—-]\s)\s*(.{20,})$/;
const LOW = /^(note|notes|example|examples|figure|table|chapter|slide|page|summary|objectives?|introduction|references?|agenda)$/i; // headings, not terms
const STOP = new Set(['AND', 'OR', 'THE', 'IF', 'IN', 'IS', 'IT', 'TO', 'OF', 'NOT', 'FOR', 'ON', 'AS', 'AT', 'BY']);

// tags[i] (optional) names where rawLines[i] came from, e.g. "page 3"; it is shown with the source sentence.
// o = { max: keep at most this many items (0 = all), mcOnly: multiple choice only }.
function generate(rawLines, tags = [], o = {}) {
  let lines = rawLines.map((l, i) => ({ t: l.replace(/\s+/g, ' ').trim(), g: tags[i] || '' })).filter(l => l.t);
  const cnt = {};
  lines.forEach(l => { cnt[l.t] = (cnt[l.t] || 0) + 1; });
  // drop page numbers and running headers/footers
  lines = lines.filter(l => !/^(page\s*)?\d+$/i.test(l.t) && !(cnt[l.t] >= 3 && l.t.length < 60));
  const tagOf = new Map(), note = (s, g) => { if (g && !tagOf.has(s)) tagOf.set(s, g); return s; };
  const ex = s => (tagOf.has(s) ? '(' + tagOf.get(s) + ') ' : '') + s;

  const sents = [], enums = [];
  let para = '', paraTag = '', hdr = null, hdrTag = '', items = [];
  const flushList = () => { if (hdr && items.length >= 3) enums.push({ hdr, items, src: note(hdr + ': ' + items.join(', '), hdrTag) }); hdr = null; items = []; };
  const flushPara = () => { if (para) para.split(/(?<=[.!?])\s+(?=[A-Z".])/).forEach(s => sents.push(note(s.trim(), paraTag))); para = ''; };

  for (const { t: l, g } of lines) {
    if (BUL.test(l)) {
      flushPara();
      const it = l.replace(BUL, '');
      if (hdr) items.push(it); else sents.push(note(it, g));
    } else {
      flushList();
      if (l.endsWith(':') && l.length < 100) { flushPara(); hdr = l.slice(0, -1); hdrTag = g; }
      else if (l.length < 50 && !/[.!?:,;]$/.test(l)) flushPara(); // heading
      else { if (!para) paraTag = g; para += (para ? ' ' : '') + l; }
    }
  }
  flushList(); flushPara();

  const defs = [], seen = new Set(), seenBody = new Set(), used = new Set(), seenEnum = new Set();
  for (const s of sents) {
    if (s.length < 25 || s.length > 260) continue;
    // inline list: "Registers: AX, BX, CX and DX."
    const m = s.match(/^(.{6,80}?):\s*(.+)$/);
    if (m) {
      const its = m[2].replace(/\.$/, '').split(/,\s*(?:and\s+|or\s+)?|;\s*|\s+and\s+/).map(x => x.trim()).filter(Boolean);
      if (its.length >= 3 && its.every(x => x.split(' ').length <= 6)) { enums.push({ hdr: m[1], items: its, src: s }); used.add(s); continue; }
    }
    const d = s.match(DEF) || s.match(COLON);
    if (d) {
      const term = d[1].trim();
      const body = d[2].replace(/[.;]$/, '');
      // skip headings posing as terms and repeated definitions
      if (term.split(' ').length <= 5 && !NOT_TERM.test(term) && !LOW.test(term) && !seen.has(term.toLowerCase()) && !seenBody.has(norm(body))) {
        seen.add(term.toLowerCase()); seenBody.add(norm(body));
        const mask = body.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), '_____');
        defs.push({ kind: 'def', term, body, q: 'Which term is described? ' + mask, src: s });
        used.add(s);
      }
    }
  }

  const clozes = [], ctoks = new Set();
  for (const s of sents) {
    if (used.has(s) || s.length < 40 || s.length > 220) continue;
    const mm = [...s.matchAll(/(?:^|[\s(])(\.?[A-Z][A-Z0-9_]{1,})\b/g)].map(x => x[1]).find(t => !STOP.has(t) && !ctoks.has(t));
    if (!mm) continue;
    ctoks.add(mm);
    clozes.push({ kind: 'cloze', term: mm, q: 'Fill in the blank: ' + s.replace(mm, '_____'), src: s });
  }

  const pool = { def: defs.map(x => x.term), cloze: clozes.map(x => x.term) };
  const all = shuffle([...defs, ...clozes]);
  const out = [];
  let nMC = 0, nID = 0, nTF = 0;
  for (const it of all) {
    const dist = near(it.term, pool[it.kind].filter(t => norm(t) !== norm(it.term)));
    // True/false: the statement is right, or has a similar-looking other term swapped in.
    if (it.kind === 'def' && dist.length && nTF < 8 && Math.random() < 0.2) {
      const t = Math.random() < 0.5;
      out.push({ type: 'mc', q: 'True or false: "' + (t ? it.term : dist[0]) + '" matches this description: ' + it.body, options: ['True', 'False'], answer: t ? 0 : 1, exp: ex(it.src) });
      nTF++; continue;
    }
    // Half the time ask a definition the other way round, so a rebuilt set is not the same questions.
    if (it.kind === 'def' && dist.length === 3 && nMC < 30 && Math.random() < 0.5) {
      const opts = shuffle([it.body, ...near(it.body, defs.filter(d => d !== it).map(d => d.body))]);
      out.push({ type: 'mc', q: 'Which statement describes "' + it.term + '"?', options: opts, answer: opts.indexOf(it.body), exp: ex(it.src) });
      nMC++; continue;
    }
    if (dist.length === 3 && nMC < 30 && (nMC <= nID * 1.5 || nID >= 20)) {
      const opts = shuffle([it.term, ...dist]);
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
