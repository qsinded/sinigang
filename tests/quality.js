// Run: node tests/quality.js   (npm run quality)
// Scores what the generator makes from the notes in tests/corpus/. Random picks are seeded, so a run is repeatable.
// Each hard check counts bad questions; the run fails when a count is higher than BASELINE, so quality can only go up.
// To accept an improvement, lower the number in BASELINE in the same commit.
const fs = require('fs'), path = require('path');
const { generate, norm } = require('../js/reviewer-generator.js');

const BASELINE = { leak: 0, dupOptions: 0, badKey: 0, outlineOption: 0, tooShort: 0, ungrounded: 0, dupQuestion: 0, falseTrueMismatch: 0, filler: 0 };
const RUNS = 25;

function seeded(seed) { // mulberry32
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const OUTLINE_OPT = /^(module|unit|chapter|lesson|week|topic)\s*\d/i;
const answerText = q => q.type === 'mc' ? q.options[q.answer] : q.type === 'id' ? q.answer : (q.items || []).join(' ');
// Share of the text's words that appear in the source sentence. Cleaning removes filler words, so exact matching would flag good questions.
const covered = (text, src) => { const w = String(text).toLowerCase().match(/[a-z0-9]{3,}/g) || [], s = new Set(String(src).toLowerCase().match(/[a-z0-9]{3,}/g) || []); return w.length ? w.filter(x => s.has(x)).length / w.length : 1; };
const rawSrc = q => String(q.exp).replace(/^\([^)]*\)\s*/, '');
const srcOf = q => norm(String(q.exp).replace(/^\([^)]*\)\s*/, ''));

function check(q, bad) {
  const ans = answerText(q), qn = norm(q.q);
  if (q.type !== 'enum' && !/^True or false/.test(q.q) && norm(ans).length >= 4 && qn.includes(norm(ans))) bad.leak++;
  if (/\b(basically|essentially|simply|actually|really|very|quite)\b|\((see|fig)/i.test(q.q + ' ' + (q.options || []).join(' '))) bad.filler++;
  if (q.type === 'mc') {
    if (new Set(q.options.map(norm)).size !== q.options.length) bad.dupOptions++;
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) bad.badKey++;
    if (q.options.some(o => OUTLINE_OPT.test(o)) || OUTLINE_OPT.test(q.q.replace(/^.*?"/, ''))) bad.outlineOption++;
  }
  if (q.q.replace(/_+/g, '').trim().length < 20) bad.tooShort++;
  // the answer must come from the source sentence it cites
  if (q.type === 'enum' ? !q.items.every(i => covered(i, rawSrc(q)) >= 0.8) : !/^True$|^False$/.test(ans) && covered(ans, rawSrc(q)) < 0.8) bad.ungrounded++;
  // a "true" statement must come from the source; a "false" one must not be a statement the source makes
  const tf = q.q.match(/^True or false: "(.+)" matches this description: (.+)$/) || q.q.match(/^True or false: (.+)$/);
  if (tf) {
    const isTrue = q.answer === 0, said = tf.length === 3 ? covered(tf[1], rawSrc(q)) >= 1 && covered(tf[2], rawSrc(q)) >= 0.8 : covered(tf[1], rawSrc(q)) >= 0.95;
    if (isTrue !== said) bad.falseTrueMismatch++;
  }
}

// The checks must catch known-bad questions, or a zero score means nothing.
(() => {
  const b = Object.fromEntries(Object.keys(BASELINE).map(k => [k, 0]));
  check({ type: 'mc', q: 'Which statement describes "Module 2"?', options: ['Module 3 — x', 'Module 3 — x', 'b'], answer: 7, exp: '(page 1) unrelated' }, b);
  check({ type: 'id', q: 'The processor runs code. Which term is the processor?', answer: 'processor', exp: '(page 1) The processor runs code.' }, b);
  check({ type: 'mc', q: 'True or false: "RAM" matches this description: runs code', options: ['True', 'False'], answer: 0, exp: '(page 1) The CPU runs code.' }, b);
  check({ type: 'id', q: '____', answer: 'zzzz', exp: '(page 1) other' }, b);
  check({ type: 'id', q: 'Which term is a very small storage place?', answer: 'register', exp: '(page 1) register' }, b);
  for (const k of ['filler', 'leak', 'dupOptions', 'badKey', 'outlineOption', 'tooShort', 'ungrounded', 'falseTrueMismatch']) if (!b[k]) throw new Error('quality check "' + k + '" no longer catches a bad question');
})();

const dir = path.join(__dirname, 'corpus'), bad = Object.fromEntries(Object.keys(BASELINE).map(k => [k, 0]));
const examples = {};
let total = 0;
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.txt'))) {
  const lines = fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/);
  const types = {}, cited = new Set();
  for (let seed = 1; seed <= RUNS; seed++) {
    Math.random = seeded(seed);
    const out = generate(lines, lines.map(() => 'page 1')), seenQ = new Set();
    out.forEach(q => {
      total++; types[q.type] = (types[q.type] || 0) + 1; cited.add(srcOf(q));
      const before = { ...bad }; check(q, bad);
      if (seenQ.has(q.q)) bad.dupQuestion++; seenQ.add(q.q);
      for (const k in bad) if (bad[k] > before[k] && !examples[k]) examples[k] = f + ': ' + q.q + (q.options ? ' | ' + q.options.join(' / ') : '');
    });
  }
  const facts = lines.filter(l => l.length > 30 && /[a-z]/.test(l)).length;
  console.log(f.padEnd(28), JSON.stringify(types), 'distinct sources used:', cited.size + '/' + facts + ' substantial lines');
}
console.log('\nquestions checked:', total);
let fail = false;
for (const k in BASELINE) {
  const over = bad[k] > BASELINE[k]; fail ||= over;
  console.log((over ? 'FAIL ' : 'ok   ') + k.padEnd(20), String(bad[k]).padStart(5), '(baseline ' + BASELINE[k] + ')' + (bad[k] && examples[k] ? '\n       e.g. ' + examples[k].slice(0, 200) : ''));
}
process.exit(fail ? 1 : 0);
