// Rule-based reviewer generator: no AI, no network. Input: array of text lines.
// ponytail: heuristics only (definitions, lists, caps-terms). Upgrade to a local LLM if quality is too low.
function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }

// Grading has to accept the answer the way a student actually types it, or a right answer reads as wrong.
// Ignored: a leading article, punctuation, and the difference between "RAM" and "random access memory".
const ART = /^\s*(?:the|a|an)\s+/i;
const bare = s => norm(String(s).replace(ART, ''));
const wordsOf = s => String(s).match(/[A-Za-z0-9]+/g) || [];
const isAcr = s => /^[A-Z0-9][A-Z0-9.\-]{1,9}$/.test(String(s).trim()); // RAM, CPU, IA-32
const FILLER_W = ['of', 'the', 'and', 'for', 'in', 'to', 'a', 'an'];
// "RAM" abbreviates "random access memory": the initials of the spelled-out form spell the short one.
// Only used when exactly one side is written as an acronym, so two different acronyms never match.
function abbreviates(short, long) {
  const w = wordsOf(long).map(x => x.toLowerCase()).filter(x => !FILLER_W.includes(x));
  return norm(short).length >= 2 && w.length >= 2 && w.map(x => x[0]).join('') === norm(short);
}
function idOk(ans, val) {
  const A = String(ans).trim(), V = String(val).trim();
  const a = bare(A), v = bare(V);
  if (!v || !a) return false;
  if (a === v) return true;
  if (isAcr(A) !== isAcr(V) && abbreviates(isAcr(A) ? A : V, isAcr(A) ? V : A)) return true;
  return v.length >= 4 && a.length >= 4 && ((a.includes(v) && v.length >= a.length * 0.6) || v.includes(a));
}

// Answer separators for enumeration items: new lines, commas, semicolons, "and"/"&".
const LIST_SPLIT = /[,\n;]+|\s+(?:and|&)\s+|&/i;
const BULLET = /^\s*(?:[-•●▪◦*–—]|\d+[.)]|[a-z][.)])\s*/i;
function enumCheck(items, val) {
  const raw = String(val);
  const vals = raw.split(LIST_SPLIT).map(s => s.replace(BULLET, '').trim()).filter(Boolean);
  // The whole answer is tried as well, so an item whose own name contains "and" still matches.
  const hit = it => idOk(it, raw) || vals.some(v => idOk(it, v));
  const got = items.filter(hit);
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
function verifiedSwap(it, list, srcOf, termOf, textOf, fitsGrammar = () => true) {
  const ok = list.filter(o => o !== it && norm(termOf(o)) !== norm(termOf(it))
    && !norm(termOf(o)).includes(norm(termOf(it))) && !norm(termOf(it)).includes(norm(termOf(o)))
    && !norm(srcOf(it)).includes(norm(termOf(o))) && overlap(textOf(it), textOf(o)) < 0.4);
  // A plural term dropped into a singular sentence reads as a typo ("Chloroplasts is the process...").
  const same = ok.filter(o => fitsGrammar(o, it));
  return near(termOf(it), (same.length ? same : ok).map(termOf))[0];
}
// Kind of term: acronym (EAX), has a digit (IA-32), several words, or a plain word. Distractors of the same kind look as plausible.
const shape = t => /^[A-Z][A-Z0-9_.\-]+$/.test(t) ? 'acronym' : /\d/.test(t) ? 'number' : /\s/.test(t) ? 'phrase' : 'word';
const variant = (a, b) => { const x = norm(a), y = norm(b); return x === y || (x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x))); };
const BUL = /^(?:[•●▪◦\-*–]|\d+[.)]|[a-z][.)])\s+/;
const NOT_TERM = /^(this|that|these|those|it|they|there|here|which|what|when|where|if|in|on|for|each|some|all|one|we|you)\b/i;
const DEF = /^(?:(?:The|A|An)\s+)?([A-Za-z0-9.][\w .\/\-]{0,38}?)\s+(?:is defined as|is used to|refers to|stands for|means|is|are)\s+(.{15,})$/;
const COLON = /^([A-Za-z.][\w .\/\-]{0,38}?)\s*(?::|\s[–—-]\s)\s*(.{20,})$/;
const LOW = /^(note|notes|example|examples|figure|table|chapter|slide|page|summary|objectives?|introduction|references?|agenda)$/i; // headings, not terms
// Exam-paper furniture: instructions, rubrics and answer keys describe the test, not the subject. A definition
// split out of one of them ("Write TRUE if the statement" + "is") is nonsense, and so is a question built from it.
// Also skipped: lines that already contain blanks, because the app cannot answer its own exam paper.
const NUM_PREFIX = /^(?:\d+|[IVXLC]+|[A-Za-z])[.)]\s+/; // "6. ", "II. ", "A. "
const IMPERATIVE = /^(?:instructions?|directions?|write|answer|choose|select|fill|complete|read|study|review|identify|enumerate|match|list|give|state|define|explain|describe|compute|solve|calculate|circle|encircle|underline|label|draw|name|provide|show|compare|discuss|mention|true or false|multiple choice|matching|essay|test|quiz|exam|score|points?)\b/i;
const RUBRIC = /\bif the statement is\b|\bwrite (?:true|false|t|f)\b|\btrue or false\b|\btell whether\b|\bidentify whether\b|\bindicate whether\b|\bchoose the (?:best|correct|right)\b|\bfill in the blanks?\b|\banswer key\b|\bmatch(?:ing)? (?:type|the (?:items|column))\b/i;
const PREBLANK = /_{3,}/;
// The numbering is stripped first, so "6. Write TRUE if…" and "II. Write TRUE if…" are both recognised.
const instruction = t => {
  const x = String(t).trim().replace(NUM_PREFIX, '');
  return IMPERATIVE.test(x) || RUBRIC.test(x) || PREBLANK.test(x);
};
// Filler that adds no meaning to a study question: hedges, "see Figure 2", citations, trailing "etc.".
const FILL = /\b(?:basically|essentially|simply|actually|really|very|quite|just|in fact|please note that|note that|it is important to (?:note|remember) that)\b[,\s]*/gi;
const LEAD = /^(?:also|however|therefore|thus|moreover|furthermore|in addition|additionally|hence|so|then)\b,?\s+/i;
function clean(s) {
  return s.replace(/\s*\((?:see|refer to|cf\.?|fig\.?|figure|table)[^)]*\)/gi, '').replace(/\s*\[\d+(?:[,–-]\d+)*\]/g, '')
    .replace(LEAD, '').replace(FILL, '').replace(/[,;]?\s+(?:etc|and so on|and so forth)\.?$/i, '')
    .replace(/\s{2,}/g, ' ').replace(/\s+([,.;])/g, '$1').trim();
}
const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1);
// True/false and fill-in-the-blank need a complete declarative sentence. A slide lead-in ("... is to:", a
// heading, an option line) is not a claim, and swapping a word inside one produces nonsense.
const LEAD_IN = /[:;,.]?\s*[-–—]\s*$|[:;,]\s*$/;                    // "... is to:", "as follows:"
const DEAD_END = /\b(?:is|are|was|were|be|to|of|the|a|an|and|or|by|for|with|from|in|on|at|as|that|which|such as|includes?|consists? of|following)\s*[.:]?$/i;
// A claim needs a verb. Matching a fixed list missed the obvious forms ("move" but only "moves" was listed),
// so words are reduced to a stem and checked against base forms; irregulars are listed separately.
const VERB_IRREGULAR = new Set(('is are was were be been being has have had do does did can cannot could will would shall should may might must').split(' '));
const VERB_BASE = new Set(('move store hold keep run convert allow provide contain include carry execute fetch decode direct control manage take need send receive connect measure calculate read write give make perform process represent describe combine divide split sort filter forward translate compile interpret allocate return accept require support enable prevent detect reduce increase overlap schedule load save link join separate count compare match replace remove add set act work become remain appear occur mean refer use call create produce generate store transfer change define convert consist depend belong follow precede happen exist live grow die feed protect regulate maintain balance break build destroy absorb release emit reflect transmit receive deliver route determine choose select apply assign attach bind connect update delete insert modify handle operate drive enable disable start stop begin end finish continue spread flow pass enter leave reach touch point refer apply test show tell say see look find get put bring hold cause affect allow permit require include involve relate correspond equate differ vary range total equal exceed reach strive').split(' '));
const stem = w => w.replace(/(?:ing|ed|es|s)$/i, '');
const verbIn = text => (String(text).match(/[A-Za-z]+/g) || []).some(w =>
  VERB_IRREGULAR.has(w.toLowerCase()) || VERB_BASE.has(w.toLowerCase()) || VERB_BASE.has(stem(w).toLowerCase()));
function statementOk(text) {
  const t = String(text || '').trim();
  if (t.length < 25 || t.length > 240) return false;
  if (/\?\s*$/.test(t)) return false;          // a question is not a proposition
  if (LEAD_IN.test(t)) return false;            // cut-off lead-in
  if (/^["“'(]/.test(t)) return false;          // a quoted fragment, not a claim
  if (/\S:\s/.test(t)) return false;           // "Term: explanation" is not a sentence
  if (DEAD_END.test(t.replace(/\.$/, ''))) return false;
  return verbIn(t);                             // must say something that can be true or false
}
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
      if (hdr) items.push(it);
      else if (/[:;]\s*$/.test(it) && it.length < 120) { hdr = it.replace(/\s*[:;]\s*$/, ''); hdrTag = g; sect = hdr; } // "6. The CU is to:" is a lead-in
      else sents.push(note(it, g));
    } else {
      flushList();
      if (l.endsWith(':') && l.length < 100) { flushPara(); hdr = l.slice(0, -1); hdrTag = g; sect = hdr; }
      else if (l.length < 50 && !/[.!?:,;]$/.test(l)) { flushPara(); sect = l; } // heading
      else {
        if (!para) paraTag = g;
        // Slides and PDFs often drop the full stop at the end of a line. Joining "…to recognize first"
        // with "The CPU is…" makes one long pseudo-sentence that then becomes a question.
        else if (!/[.!?:;,]$/.test(para) && /^(?:The|A|An|This|These|It|They|Each|Every|All|Most|Some|Many|Another)\b/.test(l)) para += '.';
        para += (para ? ' ' : '') + l;
      }
    }
  }
  flushList(); flushPara();

  const defs = [], seen = new Set(), seenBody = new Set(), used = new Set(), seenEnum = new Set();
  for (const s of sents) {
    if (used.has(s) || s.length < 25 || s.length > 260 || OUTLINE.test((ctxOf.get(s) || '').trim())) continue;
    if (instruction(s)) continue; // "II. Write TRUE if the statement is correct…" is a rubric, not a fact
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
      if (body.length >= 15 && term.split(' ').length <= 5 && !NOT_TERM.test(term) && !LOW.test(term) && !LABEL.test(term) && !seen.has(term.toLowerCase()) && !seenBody.has(norm(body))
        && !instruction(term) && !/\b(?:is|are|was|were|be|do|does|did|will|can)\b/i.test(term)) { // "Write TRUE if the statement" is a clause, not a term
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
    if (!statementOk(s)) continue; // a blank needs a sentence too
    if (instruction(s)) continue;
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
  // A true/false item is the note's own sentence, with the term swapped only when it must be false.
  // Both formats used to leak their builder into the question ("... matches this description"), which
  // read as a matching puzzle instead of a claim; the sentence itself is the claim.
  // Number of a term, from its last word: "enzyme" singular, "enzymes" plural, but "osmosis", "class"
  // and "status" are singular however they end. A swap must agree with the verb already in the sentence.
  const plural = x => {
    const w = (String(x).trim().split(/\s+/).pop() || '').toLowerCase();
    return /[^su]s$/.test(w) && !/(?:ss|is|us|osis)$/.test(w);
  };
  // "Mitochondria are ..." is plural however it is spelled, so the verb in the note wins over the
  // spelling when the term is the subject of the sentence.
  const subjectPlural = it => {
    const esc = String(it.term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const src = String(it.src).replace(/^(?:the|a|an)\s+/i, '');
    if (new RegExp('^' + esc + '\\s+(?:are|were|have|do)\\b', 'i').test(src)) return true;
    if (new RegExp('^' + esc + '\\s+(?:is|was|has|does)\\b', 'i').test(src)) return false;
    return plural(it.term);
  };
  // Put the swapped term where the original stands, keeping the article right: "A cache is…" with an
  // acronym becomes "RAM is…", while "ROM is…" with a common noun becomes "A register is…" (never
  // "A RAM is…", "A operating system is…" or "Register is…").
  const isAcrWord = x => /^[A-Z0-9][A-Z0-9.\-]{1,}$/.test(String(x).trim());
  const replaceTerm = (src, oldT, newT) => {
    const at = src.toLowerCase().indexOf(oldT.toLowerCase());
    if (at < 0) return src;
    let before = src.slice(0, at);
    const after = src.slice(at + oldT.length);
    const art = before.match(/^(.*?)(?:\b(An?)\s+)$/i), initial = before.replace(/\b(?:A|An)\s+$/i, '');
    const atStart = initial.trim() === '' || /[.!?]\s*$/.test(initial);
    const artFor = t => (/^[aeiou]/i.test(t) ? 'An ' : 'A ');
    if (art && !atStart) return src; // the term is part of a longer phrase ("the cache memory"); leave it alone
    if (art) {
      // An article already sits before the term: keep the head, then give the new term the right one.
      before = initial + (isAcrWord(newT) || plural(newT) ? '' : artFor(newT));
    } else if (atStart && !isAcrWord(newT) && !plural(newT)) {
      before = initial + artFor(newT); // "ROM is…" -> "A register is…"
    }
    return before + newT + after;
  };
  const tfText = (it, t) => {
    const swap = it.kind === 'def'
      ? verifiedSwap(it, defs, x => x.src, x => x.term, x => x.body, o => plural(o.term) === subjectPlural(it))
      : verifiedSwap(it, clozes, x => x.src, x => x.term, x => x.src, o => plural(o.term) === subjectPlural(it));
    // No candidate with the right number: skip this true/false rather than print "Chloroplasts is ...".
    if (!t && (!swap || plural(swap) !== subjectPlural(it))) return '';
    const st = replaceTerm(clean(it.src), it.term, t ? it.term : swap).replace(/\.$/, '');
    return statementOk(st) ? 'True or false: ' + cap1(st) + '.' : '';
  };
  const out = [];
  let nMC = 0, nID = 0, nTF = 0, nTTrue = 0, nTFalse = 0;
  const falseSrc = new Set(); // one false version per sentence, or the same claim gets flipped four ways
  for (const it of all) {
    const dist = near(it.term, pool[it.kind].filter(o => fits(it, o)).map(o => o.term), prefer(it));
    // True/false. A "false" statement is only made when it is certainly false (see verifiedSwap), never by luck.
    if (nTF < 8 && Math.random() < 0.2) {
      // Flipping is only worth it while "False" does not outnumber "True", and only once per sentence.
      let t = Math.random() < 0.5;
      if (!t && (falseSrc.has(it.src) || nTFalse >= nTTrue)) t = true;
      const q = tfText(it, t);
      // When this item cannot make an honest claim, fall through to a normal question instead.
      if (q) {
        out.push({ type: 'mc', q, options: ['True', 'False'], answer: t ? 0 : 1, exp: ex(it.src) });
        nTF++; if (t) nTTrue++; else { nTFalse++; falseSrc.add(it.src); }
        continue;
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
