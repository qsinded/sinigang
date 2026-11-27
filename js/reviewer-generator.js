// Rule-based reviewer generator: no AI, no network. Input: array of text lines.
// ponytail: heuristics only (definitions, lists, caps-terms). Upgrade to a local LLM if quality is too low.
function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }

// Words that change with the language of the notes. To support a language, add an entry here; the patterns
// below are built from these lists, so notes that mix languages (Taglish) work too.
const LANGS = {
  en: {
    articles: ['The', 'A', 'An'],                     // before the term that starts a definition
    copulas: ['is defined as', 'is used to', 'refers to', 'stands for', 'means', 'is', 'are', 'was', 'were'], // "X is Y"
    be: ['is', 'are', 'was', 'were'],
    called: ['called', 'known as', 'termed', 'referred to as', 'named'], // "… is called Y": Y is the term
    answerArticles: ['the', 'a', 'an'],               // ignored at the start of a typed answer
    notTerm: ['this', 'that', 'these', 'those', 'it', 'they', 'there', 'here', 'which', 'what', 'when', 'where', 'if', 'in', 'on',
      'for', 'each', 'some', 'all', 'one', 'we', 'you', 'why', 'how', 'who', 'whom', 'whose', // a sentence opener, never a term
      'most', 'many', 'every', 'several', 'both', 'few', 'no', 'another', 'other', 'such', 'its', 'their', 'his', 'her', 'our', 'your', 'my'],
    termVerbs: ['is', 'are', 'was', 'were', 'be', 'do', 'does', 'did', 'will', 'can'], // a term containing one is a clause
    clauseWords: ['when', 'whenever', 'where', 'while', 'if', 'because', 'since', 'that', 'which', 'who', 'whom', 'whose', 'than', 'until', 'unless'],
    answerFiller: ['the', 'a', 'an', 'of', 'and', 'in', 'to', 'for', 'stage', 'phase', 'process', 'type', 'kind', 'part', 'called', 'term'], // may be added to a typed answer
    personNouns: ['man', 'woman', 'person', 'hero', 'heroine', 'patriot', 'leader', 'president', 'king', 'queen', 'emperor', 'ruler', 'chief',
      'scientist', 'writer', 'author', 'poet', 'novelist', 'journalist', 'general', 'soldier', 'founder', 'priest', 'friar', 'missionary',
      'inventor', 'explorer', 'navigator', 'conquistador', 'philosopher', 'painter', 'artist', 'composer', 'revolutionary', 'reformist',
      'propagandist', 'nationalist', 'politician', 'statesman', 'scholar', 'physician', 'doctor', 'teacher', 'lawyer', 'governor',
      'minister', 'senator', 'saint', 'mathematician', 'chemist', 'physicist', 'biologist', 'engineer'], // "a Portuguese explorer who…"
  },
  fil: {
    articles: ['Ang mga', 'Ang', 'Sina', 'Si'],       // "Ang Katipunan ay …", "Si Rizal ay …"
    copulas: ['ay'],
    be: ['ay'],
    called: ['tinatawag na', 'kilala bilang'],
    answerArticles: ['ang mga', 'ang', 'sina', 'si', 'mga'],
    notTerm: ['ito', 'iyan', 'iyon', 'dito', 'doon', 'sila', 'siya', 'tayo', 'kami', 'kayo', 'ako', 'ikaw'],
    termVerbs: ['ay'],
    clauseWords: ['kung', 'kapag', 'dahil', 'habang', 'noong', 'nang', 'upang', 'sapagkat'],
    answerFiller: ['ang', 'ng', 'mga', 'si', 'ni', 'sa', 'ay', 'na'],
    personNouns: ['bayani', 'pinuno', 'pangulo', 'hari', 'reyna', 'manunulat', 'makata', 'heneral', 'tagapagtatag', 'pari', 'ama', 'ina'],
  },
};
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const anyOf = key => Object.values(LANGS).flatMap(l => l[key]).map(esc).join('|');

// Grading has to accept the answer the way a student actually types it, or a right answer reads as wrong.
// Ignored: a leading article, punctuation, and the difference between "RAM" and "random access memory".
const ART = new RegExp('^\\s*(?:' + anyOf('answerArticles') + ')\\s+', 'i');
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
const ANSWER_FILLER = new Set(Object.values(LANGS).flatMap(l => l.answerFiller));
const lower = w => w.toLowerCase();
// Singular and plural are the same answer: "membrane"/"membranes", "class"/"classes".
const sameWord = (e, g) => e === g || e + 's' === g || g + 's' === e || e + 'es' === g || g + 'es' === e;
/** Edit distance (insert, delete, substitute) between two short words. */
function lev(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}
// Spelling slips forgiven in one word: none below 6 letters (heap/head, CPU/CPV), one for 6–9, two for 10 or more.
const slips = w => (w.length >= 10 ? 2 : w.length >= 6 ? 1 : 0);
/**
 * Matches a typed answer to the expected one word by word. Every typed word must be one of the answer's words (a plural
 * or, with allowTypo, a small slip counts) or harmless filler ("the", "stage"); any other word makes it wrong, so
 * "telophase lol idk" and "mitosis and meiosis" fail. Missing words are fine while 60% of the answer is there.
 * @returns {{ok: boolean, typo: boolean, cost: number}} cost = letters changed by slips
 */
function matchWords(A, V, allowTypo) {
  const exp = wordsOf(String(A).replace(ART, '')).map(lower), got = wordsOf(String(V).replace(ART, '')).map(lower), used = new Set();
  let cost = 0;
  for (const g of got) {
    let j = exp.findIndex((e, i) => !used.has(i) && sameWord(e, g));
    if (j < 0 && allowTypo) {
      j = exp.findIndex((e, i) => !used.has(i) && lev(e, g) <= slips(e));
      if (j >= 0) cost += lev(exp[j], g);
    }
    if (j >= 0) used.add(j);
    else if (!ANSWER_FILLER.has(g)) return { ok: false, typo: false, cost };
  }
  const have = [...used].reduce((n, i) => n + exp[i].length, 0), need = exp.join('').length;
  // At least 4 letters must match, or the whole answer when it is shorter ("CPU" typed as "CPUs").
  return { ok: have >= Math.min(4, need) && have >= need * 0.6, typo: cost > 0, cost };
}
/**
 * Grades a typed identification answer.
 * @param {string} ans the expected answer
 * @param {string} val what the student typed
 * @param {string[]} [others] every answer in the reviewer: a spelling slip is only accepted when no other answer fits
 *   what was typed as well ("stalagtite" is one letter off both stalagmite and stalactite)
 * @returns {{ok: boolean, typo: boolean}} typo: accepted, but only by forgiving a spelling slip
 */
function gradeId(ans, val, others = []) {
  const A = String(ans).trim(), V = String(val).trim(), a = bare(A), v = bare(V), no = { ok: false, typo: false };
  if (!v || !a) return no;
  if (a === v) return { ok: true, typo: false };
  if (isAcr(A) !== isAcr(V) && abbreviates(isAcr(A) ? A : V, isAcr(A) ? V : A)) return { ok: true, typo: false };
  const m = matchWords(A, V, !isAcr(A));
  if (!m.ok) return no;
  // Another answer is a rival when what was typed is that answer, or is at most as many slips away from it.
  const rival = o => {
    if (norm(o) === norm(A)) return false;
    if (bare(o) === v) return true;
    const r = matchWords(o, V, !isAcr(o));
    return r.ok && r.cost <= m.cost;
  };
  if (m.typo && others.some(rival)) return no;
  return { ok: true, typo: m.typo };
}
const idOk = (ans, val, others) => gradeId(ans, val, others).ok;
const contains = (a, v) => v.length >= 4 && a.length >= 4 && (a.includes(v) || v.includes(a));

// Answer separators for enumeration items: new lines, commas, semicolons, "and"/"&".
const LIST_SPLIT = /[,\n;]+|\s+(?:and|&)\s+|&/i;
const BULLET = /^\s*(?:[-•●▪◦*–—]|\d+[.)]|[a-z][.)])\s*/i;
function enumCheck(items, val) {
  const raw = String(val);
  const vals = raw.split(LIST_SPLIT).map(s => s.replace(BULLET, '').trim()).filter(Boolean);
  // The whole answer is tried as well, so an item whose own name contains "and" still matches.
  // Listing everything is the task here, so the whole answer only has to contain the item.
  const hit = it => contains(bare(it), bare(raw)) || vals.some(v => idOk(it, v, items)); // a slip must not fit another item better
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
  const ok = list.filter(o => o !== it && !variant(termOf(o), termOf(it)) && norm(termOf(o)) !== norm(termOf(it))
    && !norm(termOf(o)).includes(norm(termOf(it))) && !norm(termOf(it)).includes(norm(termOf(o)))
    && !norm(srcOf(it)).includes(norm(termOf(o))) && overlap(textOf(it), textOf(o)) < 0.4);
  // A plural term dropped into a singular sentence reads as a typo ("Chloroplasts is the process...").
  const same = ok.filter(o => fitsGrammar(o, it));
  return near(termOf(it), (same.length ? same : ok).map(termOf))[0];
}
// Kind of term: acronym (EAX), has a digit (IA-32), several words, or a plain word. Distractors of the same kind look as plausible.
const shape = t => /^[A-Z][A-Z0-9_.\-]+$/.test(t) ? 'acronym' : /\d/.test(t) ? 'number' : /\s/.test(t) ? 'phrase' : 'word';
const variant = (a, b) => { const x = norm(a), y = norm(b); return x === y || (x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x)))
  || (isAcr(a) !== isAcr(b) && abbreviates(isAcr(a) ? a : b, isAcr(a) ? b : a)); }; // "OS" is "operating system"
const BUL = /^(?:[•●▪◦\-*–]|\d+[.)]|[a-z][.)])\s+/;
const NOT_TERM = new RegExp('^(?:' + anyOf('notTerm') + ')\\b', 'i');
// "[The] X is Y" / "[Ang] X ay Y": an optional article, a short term, a linking verb from LANGS, then the description.
const DEF = new RegExp('^(?:(?:' + anyOf('articles') + ')\\s+)?([A-Za-z0-9.][\\w .\\/\\-]{0,38}?)\\s+(?:' + anyOf('copulas') + ')\\s+(.{15,})$');
// "The process by which plants make food is called photosynthesis." / "… ay tinatawag na mitosis.": the description
// comes first and the name last, after a "be" word and a naming phrase from LANGS.
const CALLED = new RegExp('^(.{10,160}?)\\s+(?:' + anyOf('be') + ')\\s+(?:also\\s+)?(?:' + anyOf('called') + ')\\s+(?:(?:the|a|an)\\s+)?([A-Za-z][\\w \\-]{1,40}?)[.;]?$');
// Filipino also puts a person first with "ang": "Si Andres Bonifacio ang tinaguriang Ama ng Katipunan."
const SI_ANG = /^(?:Si|Sina)\s+([A-Z][\w .\-]{0,38}?)\s+ang\s+(.{15,})$/;
// A person is asked with "Who is described?". The evidence must be strong: a "Si/Sina" sentence, or a name with no
// article ("Ferdinand Magellan", never "The Katipunan") whose description opens with a role ("a Portuguese explorer…").
const PERSON_HEAD = new RegExp('^(?:(?:a|an|the|isang|ang)\\s+)?(?:[\\w\\-]+\\s+){0,3}?(?:' + anyOf('personNouns') + ')s?\\b', 'i');
const NAME_WORD = /^(?:[A-Z][a-z'’\-]+|de|del|dela|la|van|von|da|di|y|bin|ibn)$/; // "Miguel Lopez de Legazpi"
const looksName = t => { const w = t.split(' '); return w.length >= 2 && w.length <= 5 && /^[A-Z]/.test(t) && w.every(x => NAME_WORD.test(x)); };
const isPerson = (term, body, src) => /^(?:Si|Sina)\s/.test(src) || (looksName(term) && !/^(?:The|A|An|Ang)\s/.test(src) && PERSON_HEAD.test(body));
const TERM_VERB = new RegExp('\\b(?:' + anyOf('termVerbs') + ')\\b', 'i'), CLAUSE = new RegExp('\\b(?:' + anyOf('clauseWords') + ')\\b', 'i');
// A term is a short name, not a sentence opener ("This", "Many cells"), a heading word, an instruction or a clause.
const termFine = t => t.split(' ').length <= 5 && !NOT_TERM.test(t) && !LOW.test(t) && !LABEL.test(t) && !instruction(t) && !TERM_VERB.test(t) && !CLAUSE.test(t);
const COLON = /^([A-Za-z.][\w .\/\-]{0,38}?)\s*(?::|\s[–—-]\s)\s*(.{20,})$/;
const LOW = /^(note|notes|example|examples|figure|table|chapter|slide|page|summary|objectives?|introduction|references?|agenda|tips?|hints?|remember|reminders?|recap|review|q&a|questions?)$/i; // headings, not terms
// Exam-paper furniture: instructions, rubrics and answer keys describe the test, not the subject. A definition
// split out of one of them ("Write TRUE if the statement" + "is") is nonsense, and so is a question built from it.
// Also skipped: lines that already contain blanks, because the app cannot answer its own exam paper.
const NUM_PREFIX = /^(?:\d+|[IVXLC]+|[A-Za-z])[.)]\s+/; // "6. ", "II. ", "A. "
// "Instructions:" heads an exam section; "instruction pointer" is a term, so those two words need a colon or nothing after.
const IMPERATIVE = /^(?:(?:instructions?|directions?)\s*(?::|$)|(?:write|answer|choose|select|fill|complete|read|study|review|identify|enumerate|match|list|give|state|define|explain|describe|compute|solve|calculate|circle|encircle|underline|label|draw|name|provide|show|compare|discuss|mention|true or false|multiple choice|matching|essay|test|quiz|exam|score|points?)\b)/i;
const RUBRIC = /\bif the statement is\b|\bwrite (?:true|false|t|f)\b|\btrue or false\b|\btell whether\b|\bidentify whether\b|\bindicate whether\b|\bchoose the (?:best|correct|right)\b|\bfill in the blanks?\b|\banswer key\b|\bmatch(?:ing)? (?:type|the (?:items|column))\b/i;
const PREBLANK = /_{3,}/;
// The numbering is stripped first, so "6. Write TRUE if…" and "II. Write TRUE if…" are both recognised.
const instruction = t => {
  const x = String(t).trim().replace(NUM_PREFIX, '');
  return IMPERATIVE.test(x) || RUBRIC.test(x) || PREBLANK.test(x);
};
// Filler that adds no meaning to a study question: hedges, "see Figure 2", citations, trailing "etc.".
// An exam question in the notes ("3. Why is RAM volatile? (2 pts)") asks something; it is not a statement to quiz on.
const QUESTION = /\?/;
const POINTS = /\s*\(\s*\d+\s*(?:pts?|points?|marks?)\.?\s*\)/gi;
const FILL = /\b(?:basically|essentially|simply|actually|really|very|quite|just|in fact|please note that|note that|it is important to (?:note|remember) that)\b[,\s]*/gi;
const LEAD = /^(?:also|however|therefore|thus|moreover|furthermore|in addition|additionally|hence|so|then)\b,?\s+/i;
function clean(s) {
  return s.replace(POINTS, '').replace(/\s*\((?:see|refer to|cf\.?|fig\.?|figure|table)[^)]*\)/gi, '').replace(/\s*\[\d+(?:[,–-]\d+)*\]/g, '')
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
const VERB_IRREGULAR = new Set(('is are was were be been being has have had do does did can cannot could will would shall should may might must'
  + ' began became fought won led wrote made took gave held tore sent built found left lost met rose fell broke chose drew ran sold bought brought taught came went').split(' ')); // past tense, for history notes
const VERB_BASE = new Set(('move store hold keep run convert allow provide contain include carry execute fetch decode direct control manage take need send receive connect measure calculate read write give make perform process represent describe combine divide split sort filter forward translate compile interpret allocate return accept require support enable prevent detect reduce increase overlap schedule load save link join separate count compare match replace remove add set act work become remain appear occur mean refer use call create produce generate store transfer change define convert consist depend belong follow precede happen exist live grow die feed protect regulate maintain balance break build destroy absorb release emit reflect transmit receive deliver route determine choose select apply assign attach bind connect update delete insert modify handle operate drive enable disable start stop begin end finish continue spread flow pass enter leave reach touch point refer apply test show tell say see look find get put bring hold cause affect allow permit require include involve relate correspond equate differ vary range total equal exceed reach strive'
  + ' state rise fall form push pull speed capture surround digest transport synthesize pump').split(' '));
// One word is a verb form: "build", "builds", "divides", "carries", "moved", "moving", "declared". Every ending is tried,
// because one stem rule missed "divides" ("divid") and "moved" ("mov").
const isVerb = w => {
  const x = w.toLowerCase();
  return VERB_IRREGULAR.has(x) || /^[a-z]{3,}ed$/.test(w) || [x, x.replace(/s$/, ''), x.replace(/es$/, ''), x.replace(/ies$/, 'y'),
    x.replace(/d$/, ''), x.replace(/ed$/, ''), x.replace(/ing$/, ''), x.replace(/ing$/, 'e')].some(v => VERB_BASE.has(v));
};
// A lower-case "-ed" word is a past tense ("declared", "arrived"): no list can name every verb a history note uses.
// A Filipino claim links with "ay" ("Ang Katipunan ay …"), or opens with an affixed verb and names its subject with
// ang/si/ni/ng ("Itinatag ni Bonifacio ang Katipunan …", "Binaril si Rizal …"). English never has those markers.
// Markers are lower case mid-sentence, so "Mining Si wafers…" (silicon) is not taken for Filipino.
const FIL_VERB_FIRST = /^(?:[a-z]{0,3}(?:in|um)|nag|mag|pinag|ipinag|ipina|pina|na|ma|i)[a-z]{3,}\b/i, FIL_MARKER = /\s(?:ang|si|sina|ni|ng)\s/;
const filClaim = t => /\say\s/.test(t) || (FIL_VERB_FIRST.test(t) && FIL_MARKER.test(t));
const verbIn = text => filClaim(String(text)) || (String(text).match(/[A-Za-z]+/g) || []).some(isVerb);
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
// What a professor tests is stated in the learning objectives ("Explain what a kernel does"). Their lines start with
// a Bloom verb right under an "Objectives" heading or "...you will be able to:".
const OBJ_HEAD = /^(?:learning )?(?:objectives?|outcomes?)\b|\bable to\s*:?$/i;
const BLOOM = /^(?:explain|describe|define|identify|differentiate|distinguish|compare|contrast|apply|list|discuss|understand|analy[sz]e|evaluate|demonstrate|state|recognize|solve|compute|calculate|summari[sz]e|classify|illustrate|outline|relate|use|name)\b/i;
// Jumbled text (broken PDF columns, symbols, number runs) must not become a question.
function garbled(s) {
  const w = s.match(/\S+/g) || [];
  return !w.length || w.filter(x => /^[A-Za-z]$/.test(x) && !/^[aAI]$/.test(x)).length / w.length > 0.15
    || s.replace(/[A-Za-z0-9\s.,;:'"()\-\/%]/g, '').length / s.length > 0.15 || /(?:\b\d+(?:\.\d+)?\s+){3,}/.test(s + ' ');
}
// Title Case: every word capitalised except small joining words (English, and Filipino "ng", "sa", "mga", "at").
const MINOR = /^(?:a|an|the|and|or|of|in|on|at|to|for|by|with|from|vs|ng|sa|mga)$/i;
const titleCase = s => { const w = s.match(/[A-Za-z][A-Za-z'’]*/g) || []; return w.length >= 3 && w.every(x => MINOR.test(x) || /^[A-Z]/.test(x)); };
const STOP = new Set(['AND', 'OR', 'THE', 'IF', 'IN', 'IS', 'IT', 'TO', 'OF', 'NOT', 'FOR', 'ON', 'AS', 'AT', 'BY']);
// Visible caps, so the interface can say what "All" means instead of silently truncating.
const ITEM_CAP = { mc: 30, id: 20, tf: 8, enum: 10 };
// Why a note line produced no question (generate(...).skipped). Worded for the student, with a fix where one exists.
const SKIP_REASONS = {
  furniture: 'A page number, or a header or footer repeated on every page.',
  heading: 'A heading: it names the section, it is not asked.',
  objective: 'A learning objective: it ranks the questions, it is not asked.',
  outline: 'An agenda, outline or example list, not a fact.',
  'short-list': 'A list with fewer than 3 items, too short to enumerate.',
  length: 'Too short or too long to make a clear question.',
  garbled: 'Looks jumbled, often broken PDF text.',
  question: 'A question, not a statement of fact.',
  instruction: 'An exam instruction, or a line that already has blanks.',
  'bad-term': 'What the sentence is about is not a term (a clause, a heading, a word like "Many" or "It", or more than 5 words). Start with the term.',
  repeated: 'Repeats a term or definition that is already asked.',
  'empty-blank': 'Hiding the term would leave nothing to answer from.',
  'no-claim': 'Not a complete statement with a verb.',
  'cut-list': 'A list cut away from its heading.',
  decade: 'Gives only a decade ("the 1950s"), too vague to ask.',
  'no-pattern': 'No term found: it does not start with what it is about, and has no year or ACRONYM to ask. Try "X is …" or "X does …".',
  'same-term': 'Its key term is already asked from another sentence.',
  'off-objectives': 'Not tied to the learning objectives.',
  limit: 'Made a question, but it was cut by the question limit.',
  'type-off': 'Made a question of a type that is turned off.',
};

/**
 * Builds review questions from note lines. No network, no AI.
 * @param {string[]} rawLines note text, one entry per line
 * @param {string[]} [tags] tags[i] names where rawLines[i] came from, e.g. "page 3"; shown with the source sentence
 * @param {{max?: number, mcOnly?: boolean, noTF?: boolean, noEnum?: boolean}} [o] max: keep at most this many (0 = all)
 * @returns {object[] & {skipped: {text: string, reason: string}[]}} the questions; `.skipped` says why each other
 *   line or sentence made none (codes in SKIP_REASONS). It is a property of the array, so JSON (storage) leaves it out.
 */
function generate(rawLines, tags = [], o = {}) {
  let lines = rawLines.map((l, i) => ({ t: l.replace(/\s+/g, ' ').trim(), g: tags[i] || '' })).filter(l => l.t);
  const cnt = {};
  lines.forEach(l => { cnt[l.t] = (cnt[l.t] || 0) + 1; });
  // The first reason a text is skipped is kept: it is the most specific one.
  const why = new Map(), skip = (t, r) => { if (!why.has(t)) why.set(t, r); return true; };
  // drop page numbers and running headers/footers
  const furniture = l => /^(page\s*)?\d+$/i.test(l.t) || /^(module|unit|chapter|lesson|week|day|topic|session|lecture)\s*[\dIVX]+\s*[—–:-]/i.test(l.t) || (cnt[l.t] >= 3 && l.t.length < 60);
  lines = lines.filter(l => !(furniture(l) && skip(l.t, 'furniture')));
  const objSet = new Set(), objWords = new Set();
  lines.forEach((l, i) => {
    if (!OBJ_HEAD.test(l.t)) return;
    for (let j = i + 1; j < lines.length && BLOOM.test(lines[j].t.replace(BUL, '')); j++) {
      const t = lines[j].t.replace(BUL, ''); objSet.add(t);
      (t.toLowerCase().match(/[a-z0-9]{2,}/g) || []).forEach(x => objWords.add(x));
    }
  });
  // How much a professor would care about a term: named in the objectives, repeated through the notes, or a heading.
  const flat = lines.map(l => l.t).join('\n').toLowerCase();
  const heads = lines.filter(l => (l.t.length < 50 || (l.t.length < 100 && titleCase(l.t))) && !/[.!?:,;]$/.test(l.t)).map(l => l.t.toLowerCase());
  const score = term => {
    const t = String(term).toLowerCase(), esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const times = (flat.match(new RegExp('\\b' + esc + '\\b', 'g')) || []).length;
    return ((t.match(/[a-z0-9]{2,}/g) || []).some(w => objWords.has(w)) ? 3 : 0) + Math.max(0, Math.min(times - 1, 3)) + (heads.some(h => new RegExp('\\b' + esc + '\\b').test(h)) ? 2 : 0);
  };
  const tagOf = new Map(), ctxOf = new Map();
  let sect = ''; // nearest heading above the line, shown as context in the question
  const note = (s, g) => { if (g && !tagOf.has(s)) tagOf.set(s, g); if (!ctxOf.has(s)) ctxOf.set(s, sect); return s; };
  const ex = s => (tagOf.has(s) ? '(' + tagOf.get(s) + ') ' : '') + s;

  const sents = [], enums = [];
  let para = '', paraTag = '', hdr = null, hdrTag = '', items = [];
  const flushList = () => {
    if (hdr) {
      const h = hdr.trim(), src = items.length ? hdr + ': ' + items.join(', ') : hdr + ':';
      const no = OBJ_HEAD.test(h) ? 'objective' : OUTLINE.test(h) || LOW.test(h) ? 'outline' : items.length < 3 ? 'short-list' : '';
      if (no) skip(src, no); else enums.push({ hdr, items: items.map(clean).filter(Boolean), src: note(src, hdrTag) });
    }
    hdr = null; items = [];
  };
  const flushPara = () => { if (para) para.split(/(?<=[.!?])\s+(?=[A-Z".])/).forEach(s => sents.push(note(s.trim(), paraTag))); para = ''; };

  // A long heading starts a sentence and is either Title Case or, in sentence case ("Spanish colonization and the
  // revolution"), has no verb, does not stop on "and"/"the", and the next line starts a new sentence. A line cut
  // mid-sentence fails one of these, so it still joins the next line.
  const longHead = (l, next) => l.length < 100 && (!para || /[.!?]$/.test(para))
    && (titleCase(l) || (!verbIn(l) && !DEAD_END.test(l) && (!next || BUL.test(next) || /^[A-Z"“]/.test(next))));
  for (const [i, { t: l, g }] of lines.entries()) {
    if (BUL.test(l)) {
      flushPara();
      const it = l.replace(BUL, '');
      if (hdr) items.push(it);
      else if (/[:;]\s*$/.test(it) && it.length < 120) { hdr = it.replace(/\s*[:;]\s*$/, ''); hdrTag = g; sect = hdr; } // "6. The CU is to:" is a lead-in
      else sents.push(note(it, g));
    } else {
      flushList();
      if (l.endsWith(':') && l.length < 100) { flushPara(); hdr = l.slice(0, -1); hdrTag = g; sect = hdr; }
      else if (!/[.!?:,;]$/.test(l) && (l.length < 50 || longHead(l, (lines[i + 1] || {}).t))) { flushPara(); sect = l; skip(l, objSet.has(l) ? 'objective' : 'heading'); } // heading
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
  // Reasons every sentence loop shares; returns the code, or '' when the sentence may be used.
  const unfit = (s, min, max) => s.length < min || s.length > max ? 'length' : OUTLINE.test((ctxOf.get(s) || '').trim()) ? 'outline'
    : objSet.has(s) ? 'objective' : instruction(s) ? 'instruction' // "II. Write TRUE if…" is a rubric; "____" lines are blanks
    : garbled(s) ? 'garbled' : QUESTION.test(s) ? 'question' : '';
  for (const s of sents) {
    if (used.has(s)) continue;
    const no = unfit(s, 25, 260);
    if (no) { skip(s, no); continue; }
    // inline list: "Registers: AX, BX, CX and DX."
    const m = s.match(/^(.{6,80}?):\s*(.+)$/);
    if (m) {
      const its = m[2].replace(/\.$/, '').split(/,\s*(?:and\s+|or\s+)?|;\s*|\s+and\s+/).map(x => x.trim()).filter(Boolean);
      if (its.length >= 3 && its.every(x => x.split(' ').length <= 6) && !LOW.test(m[1].trim())) { enums.push({ hdr: m[1], items: its.map(clean).filter(Boolean), src: s }); used.add(s); continue; }
    }
    // "X is called Y" names Y, so its groups are swapped into [term, description] like the others. Only when X is a
    // description: "Jose Rizal is known as the national hero" and "Si Mabini ay tinatawag na …" keep the name as answer.
    const nm = s.match(CALLED), rev = nm && !termFine(nm[1]);
    const d = rev ? [s, nm[2], nm[1]] : s.match(DEF) || s.match(SI_ANG) || s.match(COLON);
    if (d) {
      const term = d[1].trim();
      const body = clean(d[2].replace(/[.;]$/, ''));
      // skip headings posing as terms ("Write TRUE if the statement", "surplus happens when quantity supplied" are
      // clauses) and repeated definitions
      if (body.length < 15 || !termFine(term)) skip(s, 'bad-term');
      else if (seen.has(term.toLowerCase()) || seenBody.has(norm(body))) skip(s, 'repeated');
      else {
        seen.add(term.toLowerCase()); seenBody.add(norm(body));
        const mask = body.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), '_____');
        // "The CPU is the CPU of the computer" leaves "The _____ of the computer": nothing to answer from.
        if ((mask.replace(/_____/g, ' ').match(/[A-Za-z]{4,}/g) || []).length < 2) { skip(s, 'empty-blank'); continue; }
        const who = isPerson(term, body, s);
        // "Telophase is when two new nuclei form…": a description opening with "when"/"where"/"if"… is not a statement,
        // so the term is blanked in the note's own sentence, and the clause is never offered as a statement option.
        const clause = /^(?:when|whenever|where|if|because|how|why|what)\b/i.test(body), c = clean(s), at = c.toLowerCase().indexOf(term.toLowerCase());
        const q = clause && at >= 0 ? 'Fill in the blank: ' + c.slice(0, at) + '_____' + c.slice(at + term.length)
          : (who ? 'Who is described? ' : 'Which term is described? ') + cap1(mask);
        defs.push({ kind: 'def', w: score(term), term, body: cap1(body), who, clause, q, src: s, ctx: ctxOf.get(s) || '' });
        used.add(s);
      }
    }
  }

  const clozes = [], ctoks = new Set();
  for (const s of sents) {
    if (used.has(s)) continue;
    const no = unfit(s, 40, 220) || (statementOk(s) ? '' : 'no-claim'); // a blank needs a sentence too
    if (no) { skip(s, no); continue; }
    // "EAX, EBX, ECX" is a list cut out of its heading, not a sentence to blank.
    if (/(?:^|\s)[A-Z][A-Z0-9]+\s*,\s*[A-Z][A-Z0-9]+\b/.test(s)) { skip(s, 'cut-list'); continue; }
    // In a dated sentence the year is what history asks for, so it is the blank, never another word beside it
    // ("The _____ was first developed in 1950"). A decade ("the 1950s") is too vague to ask, so it is skipped.
    const yr = (s.match(/\b(?:1\d|20)\d\d\b/) || [])[0];
    if (!yr && /\b(?:1\d|20)\d\d/.test(s)) { skip(s, 'decade'); continue; }
    const caps = [...s.matchAll(/(?:^|[\s(])(\.?[A-Z][A-Z0-9_]{1,})\b/g)].map(x => x[1]).filter(t => !STOP.has(t));
    const mm = yr || caps.find(t => !ctoks.has(t));
    if (!mm) { skip(s, caps.length ? 'same-term' : 'no-pattern'); continue; }
    if (objWords.size && !yr && !score(mm)) { skip(s, 'off-objectives'); continue; } // with objectives, a loose sentence must tie to one or be repeated
    if (!yr) ctoks.add(mm); // two events can share a year
    clozes.push({ kind: 'cloze', w: score(mm), term: mm, q: 'Fill in the blank: ' + clean(s).replace(mm, '_____'), src: s, ctx: ctxOf.get(s) || '' });
  }

  // A plain subject-verb fact ("Ribosomes build proteins…", "The law of demand states that…") asks for its subject.
  // The blank sits in the note's own sentence, so no grammar is made up. It runs after the clozes, so a year or an
  // acronym in the sentence is still what gets asked.
  const clozed = new Set(clozes.map(c => c.src)), facts = [], factTerms = new Set();
  // This stage is the last chance for a sentence, so its own reason is more specific than the cloze stage's "no-pattern".
  const refine = (s, r) => { if (!why.has(s) || why.get(s) === 'no-pattern') why.set(s, r); };
  for (const s of sents) {
    // A dated sentence belongs to the year rule above (the year is asked; a decade is too vague), never to this one.
    if (used.has(s) || clozed.has(s) || /\b(?:1\d|20)\d\d/.test(s) || unfit(s, 25, 220) || !statementOk(s)) continue;
    const c = clean(s), art = (c.match(/^(?:The|A|An)\s+/) || [''])[0], words = c.slice(art.length).split(' ');
    // The subject ends at the first verb (1–4 words in); a verb is lower case mid-sentence. "is"/"are" belong to DEF.
    const k = words.findIndex((w, i) => i >= 1 && /^[a-z]/.test(w) && isVerb(w.replace(/[,;:.]$/, '')));
    if (k < 1 || k > 4 || /^(?:is|are|was|were|be|been|being)$/.test(words[k])) continue;
    const term = words.slice(0, k).join(' '), rest = words.slice(k).join(' ');
    if (!termFine(term) || /[^\w\s\-]/.test(term)) { refine(s, 'bad-term'); continue; }
    if ((rest.match(/[A-Za-z]{4,}/g) || []).length < 2) { refine(s, 'empty-blank'); continue; }
    if (seen.has(term.toLowerCase()) || factTerms.has(term.toLowerCase())) { refine(s, 'same-term'); continue; }
    if (objWords.size && !score(term)) { refine(s, 'off-objectives'); continue; } // same rule as the clozes
    factTerms.add(term.toLowerCase());
    facts.push({ kind: 'fact', w: score(term), term, q: 'Fill in the blank: ' + art + '_____ ' + rest, src: s, ctx: ctxOf.get(s) || '' });
  }

  // A fact's wrong options are other subjects and defined terms: the same kind of thing as its answer.
  const pool = { def: defs, cloze: clozes, fact: [...facts, ...defs] };
  const all = shuffle([...defs, ...clozes, ...facts]).sort((a, b) => b.w - a.w); // best first, so the caps keep what matters
  const ctxByText = new Map([...defs.map(d => [d.term, d.ctx]), ...defs.map(d => [d.body, d.ctx]), ...clozes.map(c => [c.term, c.ctx]), ...facts.map(f => [f.term, f.ctx])]);
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
  // "Si" names a person: a swap never puts a thing after it, or a person after "Ang".
  const person = x => /^(?:Si|Sina)\s/.test(x.src);
  const tfText = (it, t) => {
    if (it.kind === 'fact' && !t) return ''; // swapping a subject needs verb agreement ("Ribosomes builds"); facts only make true claims
    const swap = it.kind === 'def'
      ? verifiedSwap(it, defs, x => x.src, x => x.term, x => x.body, o => plural(o.term) === subjectPlural(it) && person(o) === person(it))
      : verifiedSwap(it, clozes, x => x.src, x => x.term, x => x.src, o => plural(o.term) === subjectPlural(it) && person(o) === person(it));
    // No candidate with the right number: skip this true/false rather than print "Chloroplasts is ...".
    if (!t && (!swap || plural(swap) !== subjectPlural(it))) return '';
    const st = (t ? clean(it.src) : replaceTerm(clean(it.src), it.term, swap)).replace(/\.$/, ''); // a true claim is the note's own sentence
    return statementOk(st) ? 'True or false: ' + cap1(st) + '.' : '';
  };
  const out = [];
  let nMC = 0, nID = 0, nTF = 0, nTTrue = 0, nTFalse = 0;
  const falseSrc = new Set(); // one false version per sentence, or the same claim gets flipped four ways
  // Wrong options are the same kind of thing as the answer: people for a person, and for a subject blank, terms that
  // agree with its verb ("_____ build" never offers "nucleus"). Too few of them makes it a typed question instead.
  // An acronym or number answer (EAX, 1898) only gets options of its own shape: one odd one out gives the answer away.
  const sameKind = (it, o) => !!o.who === !!it.who && (it.kind !== 'fact' || plural(o.term) === plural(it.term))
    && (!/^(?:acronym|number)$/.test(shape(it.term)) || shape(o.term) === shape(it.term));
  // Variety: a wrong option is offered at most twice per set, so small notes do not repeat the same three every time.
  const optUse = new Map(), fresh = xs => xs.filter(x => (optUse.get(x) || 0) < 2);
  const spend = (opts, ans) => opts.forEach(x => { if (x !== ans) optUse.set(x, (optUse.get(x) || 0) + 1); });
  for (const it of all) {
    const dist = near(it.term, fresh(pool[it.kind].filter(o => fits(it, o) && sameKind(it, o)).map(o => o.term)), prefer(it));
    // True/false. A "false" statement is only made when it is certainly false (see verifiedSwap), never by luck.
    if (!o.noTF && nTF < ITEM_CAP.tf && Math.random() < 0.2) { // with true/false off, the fact becomes a normal question instead of being dropped
      // Flipping is only worth it while "False" does not outnumber "True", and only once per sentence.
      let t = Math.random() < 0.5;
      if (!t && (falseSrc.has(it.src) || nTFalse >= nTTrue)) t = true;
      const q = tfText(it, t);
      // When this item cannot make an honest claim, fall through to a normal question instead.
      if (q) {
        out.push({ w: it.w, type: 'mc', q, options: ['True', 'False'], answer: t ? 0 : 1, exp: ex(it.src) });
        nTF++; if (t) nTTrue++; else { nTFalse++; falseSrc.add(it.src); }
        continue;
      }
    }
    // Half the time ask a definition the other way round, so a rebuilt set is not the same questions.
    if (it.kind === 'def' && !it.clause && dist.length === 3 && nMC < ITEM_CAP.mc && Math.random() < 0.5) {
      const bodies = fresh(defs.filter(d => fits(it, { ...d, term: d.body }) && !norm(d.body).includes(norm(it.term)) && sameKind(it, d) && !d.clause).map(d => d.body));
      const opts = shuffle([it.body, ...near(it.body, bodies, x => (ctxByText.get(x) === it.ctx ? 30 : 0))]);
      if (opts.length === 4 && keyOk(opts, it.body)) {
        out.push({ w: it.w, type: 'mc', q: 'Which statement describes "' + it.term + '"?', options: opts, answer: opts.indexOf(it.body), exp: ex(it.src) });
        spend(opts, it.body); nMC++; continue;
      }
    }
    const opts = shuffle([it.term, ...dist]);
    if (dist.length === 3 && nMC < ITEM_CAP.mc && (nMC <= nID * 1.5 || nID >= ITEM_CAP.id) && keyOk(opts, it.term)) {
      out.push({ w: it.w, type: 'mc', q: it.q, options: opts, answer: opts.indexOf(it.term), exp: ex(it.src) });
      spend(opts, it.term); nMC++;
    } else if (nID < ITEM_CAP.id) {
      out.push({ w: it.w, type: 'id', q: it.q, answer: it.term, exp: ex(it.src) });
      nID++;
    }
  }
  const firstList = e => { if (seenEnum.has(norm(e.hdr))) { skip(e.src, 'repeated'); return false; } seenEnum.add(norm(e.hdr)); return true; };
  shuffle(enums).sort((a, b) => score(b.hdr) - score(a.hdr)).filter(firstList).slice(0, ITEM_CAP.enum).forEach(e =>
    out.push({ w: score(e.hdr), type: 'enum', q: 'Enumerate: ' + e.hdr, items: e.items, exp: ex(e.src) }));
  let res = o.mcOnly ? out.filter(x => x.type === 'mc') : out;
  if (o.noTF) res = res.filter(x => !/^True or false: /.test(x.q));
  if (o.noEnum) res = res.filter(x => x.type !== 'enum');
  const typed = res;
  if (o.max > 0) res = shuffle(res).sort((a, b) => b.w - a.w).slice(0, o.max); // the most important ones
  res.forEach((x, i) => { x.id = x.type + i; });
  // A fact that made a question but is not in the result was cut by a cap or the limit, or by a type turned off.
  const exps = list => new Set(list.map(x => x.exp)), inOut = exps(out), inTyped = exps(typed), inRes = exps(res);
  for (const c of [...defs, ...clozes, ...facts, ...enums]) {
    const e = ex(c.src);
    if (inRes.has(e)) why.delete(c.src);
    else if (inOut.has(e)) why.set(c.src, inTyped.has(e) ? 'limit' : 'type-off');
    else skip(c.src, 'limit'); // a cap stopped it while building; an earlier reason (a repeated list) is kept
  }
  res.skipped = [...why].map(([text, reason]) => ({ text, reason }));
  return res;
}

// Stable identity for a question across a rebuild. Shuffle renumbers ids (mc0, id1, …), so progress
// has to be matched by what the item asks and what it answers, not by position. The type is left out
// on purpose: the same fact can come back as multiple choice or identification, and mastery of the
// fact should survive that. Two items with the same key are the same question.
function answerText(it) {
  if (!it) return '';
  if (it.type === 'mc') return Array.isArray(it.options) && it.options[it.answer] != null ? it.options[it.answer] : '';
  if (it.type === 'id' || it.type === 'img') return it.answer || '';
  return (it.items || []).join(' | ');
}
function itemKey(it) { return norm(it && it.q) + '|' + norm(answerText(it)); }

// Move what the student earned onto a rebuilt set. Answers only follow a question that kept its
// display type: a typed answer has no index in a new multiple-choice item. Mastery (known/learning
// and the Leitner box) follows the fact itself, so changing the question format does not undo it.
// When the new set has two items with the same key there is no honest way to choose, so that item
// is left alone. Returns fresh maps keyed by the new ids, plus how many items kept something.
function carryProgress(oldItems, newItems, progress = {}) {
  const ans = {}, known = new Set(), learn = new Set(), srs = {}, flags = new Set();
  const oldAns = progress.ans || {}, oldKnown = new Set(progress.known || []), oldLearn = new Set(progress.learn || []), oldSrs = progress.srs || {}, oldFlags = new Set(progress.flags || []);
  const matches = new Map();
  newItems.forEach((it, i) => { const k = itemKey(it); if (!matches.has(k)) matches.set(k, []); matches.get(k).push(i); });
  const used = new Set();
  let kept = 0;
  oldItems.forEach(old => {
    const list = matches.get(itemKey(old)) || [];
    const at = list.length === 1 && !used.has(list[0]) ? list[0] : -1;
    if (at < 0) return;
    const it = newItems[at];
    if (!(oldAns[old.id] || oldKnown.has(old.id) || oldLearn.has(old.id) || oldSrs[old.id] || oldFlags.has(old.id))) return;
    used.add(at); kept++;
    if (oldFlags.has(old.id)) flags.add(it.id);
    if (oldKnown.has(old.id)) known.add(it.id);
    if (oldLearn.has(old.id)) learn.add(it.id);
    const s = oldSrs[old.id];
    if (s) srs[it.id] = { box: s.box, due: s.due };
    const a = oldAns[old.id];
    if (!a) return;
    let val = a.val;
    if (it.type === 'mc') {
      if (old.type !== 'mc' || !Number.isInteger(a.val)) return;
      const chosen = old.options && old.options[a.val];
      if (chosen == null) return;
      const slot = it.options.indexOf(chosen);
      if (slot < 0) return; // the option the student picked is not on the new card
      val = slot;
    } else if (it.type !== old.type) return;
    ans[it.id] = { val, ok: a.ok === true, exp: a.exp };
  });
  return { ans, known, learn, srs, flags, kept };
}

if (typeof module !== 'undefined') module.exports = { generate, idOk, gradeId, enumCheck, norm, itemKey, carryProgress, ITEM_CAP, SKIP_REASONS };
