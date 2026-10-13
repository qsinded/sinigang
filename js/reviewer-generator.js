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

const BUL = /^(?:[•●▪◦\-*–]|\d+[.)]|[a-z][.)])\s+/;
const NOT_TERM = /^(this|that|these|those|it|they|there|here|which|what|when|where|if|in|on|for|each|some|all|one|we|you)\b/i;
const DEF = /^(?:(?:The|A|An)\s+)?([A-Za-z0-9.][\w .\/\-]{0,38}?)\s+(?:is defined as|is used to|refers to|stands for|means|is|are)\s+(.{15,})$/;
const COLON = /^([A-Za-z.][\w .\/\-]{0,38}?)\s*(?::|\s[–—-]\s)\s*(.{20,})$/;
const STOP = new Set(['AND', 'OR', 'THE', 'IF', 'IN', 'IS', 'IT', 'TO', 'OF', 'NOT', 'FOR', 'ON', 'AS', 'AT', 'BY']);

function generate(rawLines) {
  let lines = rawLines.map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const cnt = {};
  lines.forEach(l => { cnt[l] = (cnt[l] || 0) + 1; });
  // drop page numbers and running headers/footers
  lines = lines.filter(l => !/^(page\s*)?\d+$/i.test(l) && !(cnt[l] >= 3 && l.length < 60));

  const sents = [], enums = [];
  let para = '', hdr = null, items = [];
  const flushList = () => { if (hdr && items.length >= 3) enums.push({ hdr, items, src: hdr + ': ' + items.join(', ') }); hdr = null; items = []; };
  const flushPara = () => { if (para) para.split(/(?<=[.!?])\s+(?=[A-Z".])/).forEach(s => sents.push(s.trim())); para = ''; };

  for (const l of lines) {
    if (BUL.test(l)) {
      flushPara();
      const it = l.replace(BUL, '');
      if (hdr) items.push(it); else sents.push(it);
    } else {
      flushList();
      if (l.endsWith(':') && l.length < 100) { flushPara(); hdr = l.slice(0, -1); }
      else if (l.length < 50 && !/[.!?:,;]$/.test(l)) flushPara(); // heading
      else para += (para ? ' ' : '') + l;
    }
  }
  flushList(); flushPara();

  const defs = [], seen = new Set(), used = new Set();
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
      if (term.split(' ').length <= 5 && !NOT_TERM.test(term) && !seen.has(term.toLowerCase())) {
        seen.add(term.toLowerCase());
        const body = d[2].replace(/[.;]$/, '');
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
  let nMC = 0, nID = 0;
  for (const it of all) {
    const dist = shuffle(pool[it.kind].filter(t => norm(t) !== norm(it.term))).slice(0, 3);
    // Half the time ask a definition the other way round, so a rebuilt set is not the same questions.
    if (it.kind === 'def' && dist.length === 3 && nMC < 30 && Math.random() < 0.5) {
      const opts = shuffle([it.body, ...shuffle(defs.filter(d => d !== it)).slice(0, 3).map(d => d.body)]);
      out.push({ type: 'mc', q: 'Which statement describes "' + it.term + '"?', options: opts, answer: opts.indexOf(it.body), exp: it.src });
      nMC++; continue;
    }
    if (dist.length === 3 && nMC < 30 && (nMC <= nID * 1.5 || nID >= 20)) {
      const opts = shuffle([it.term, ...dist]);
      out.push({ type: 'mc', q: it.q, options: opts, answer: opts.indexOf(it.term), exp: it.src });
      nMC++;
    } else if (nID < 20) {
      out.push({ type: 'id', q: it.q, answer: it.term, exp: it.src });
      nID++;
    }
  }
  shuffle(enums).slice(0, 10).forEach(e =>
    out.push({ type: 'enum', q: 'Enumerate: ' + e.hdr, items: e.items, exp: e.src }));
  out.forEach((x, i) => { x.id = x.type + i; });
  return out;
}

if (typeof module !== 'undefined') module.exports = { generate, idOk, enumCheck, norm };
