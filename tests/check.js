// Run: node tests/check.js   (Node 18+, no packages). Checks the generator and the .pptx/.docx readers.
const assert = require('assert'), zlib = require('zlib');
const { generate, enumCheck, idOk, norm, itemKey, carryProgress, ITEM_CAP } = require('../js/reviewer-generator.js');
const { pptxLines, pptLines, docxLines } = require('../js/pptx-reader.js');

// Minimal zip writer (deflate) so the readers are tested on real zip bytes.
function zip(files) {
  const parts = [], central = []; let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const nb = Buffer.from(name), raw = Buffer.from(text), data = zlib.deflateRawSync(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nb.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nb.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, nb, data); central.push(ch, nb); off += 30 + nb.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  const b = Buffer.concat([...parts, cd, end]); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
}
const slide = ps => '<p:sld><p:txBody>' + ps.map(t => '<a:p><a:r><a:t>' + t + '</a:t></a:r></a:p>').join('') + '</p:txBody></p:sld>';

// Minimal OLE2 file holding one stream, small (mini stream) or big (regular sectors), to test both read paths.
function cfb(stream) {
  const mini = stream.length < 4096, END = 0xFFFFFFFE, pad = (b, n) => Buffer.concat([b, Buffer.alloc((n - b.length % n) % n)]);
  const data = pad(stream, mini ? 64 : 512), nUnits = data.length / (mini ? 64 : 512), u32 = a => { const b = Buffer.alloc(512, 0xFF); a.forEach((v, i) => b.writeUInt32LE(v, i * 4)); return b; };
  const chain = (first, n) => Array.from({ length: n }, (_, i) => i === n - 1 ? END : first + i + 1);
  const dataSectors = mini ? pad(data, 512) : data;
  const fat = [0xFFFFFFFD, END, ...(mini ? [END] : []), ...chain(mini ? 3 : 2, Math.ceil(dataSectors.length / 512))];
  const ent = (name, type, start, size) => { const b = Buffer.alloc(128); b.write(name, 0, 'utf16le'); b.writeUInt16LE((name.length + 1) * 2, 64); b[66] = type; b[67] = 1; b.writeUInt32LE(start, 116); b.writeUInt32LE(size, 120); return b; };
  const dir = Buffer.concat([ent('Root Entry', 5, mini ? 3 : END, mini ? data.length : 0), ent('PowerPoint Document', 2, mini ? 0 : 2, stream.length), Buffer.alloc(256)]);
  const head = Buffer.alloc(512); Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(head);
  head.writeUInt16LE(9, 30); head.writeUInt16LE(6, 32); head.writeUInt32LE(1, 44); head.writeUInt32LE(1, 48); head.writeUInt32LE(4096, 56);
  head.writeUInt32LE(mini ? 2 : END, 60); head.writeUInt32LE(mini ? 1 : 0, 64); head.writeUInt32LE(END, 68); head.writeUInt32LE(0, 72);
  head.writeUInt32LE(0, 76); head.fill(0xFF, 80, 512);
  const miniFat = u32(chain(0, nUnits)), b = Buffer.concat([head, u32(fat), dir, ...(mini ? [miniFat] : []), dataSectors]);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
}
// Every human-readable string in a generated item.
const each = (x, fn) => [x.q, ...(x.options || []), ...(x.items || []), x.answer].filter(v => v !== undefined && v !== null).map(String).forEach(fn);
const rec = (ver, type, body) => { const h = Buffer.alloc(8); h.writeUInt16LE(ver, 0); h.writeUInt16LE(type, 2); h.writeUInt32LE(body.length, 4); return Buffer.concat([h, body]); };
const pptStream = (extra = Buffer.alloc(0)) => Buffer.concat([
  rec(15, 0x03F8, rec(0, 0x0FA8, Buffer.from('Click to edit Master title style'))), // master text must be skipped
  extra,
  rec(15, 0x03EE, Buffer.concat([rec(0, 0x0FA8, Buffer.from('Intro:\rCPU\rRAM')), rec(0, 0x0FA0, Buffer.from('Caf\u00e9 notes', 'utf16le'))])),
  rec(15, 0x03EE, rec(0, 0x0FA8, Buffer.from('Second slide'))),
]);

(async () => {
  // old .ppt: small file (mini stream) and big file (regular sectors), master skipped, per-slide tags
  for (const big of [false, true]) {
    const tg = [], got = pptLines(cfb(pptStream(big ? rec(0, 0x1234, Buffer.alloc(5000)) : undefined)), tg);
    assert.deepStrictEqual(got, ['Intro:', '• CPU', '• RAM', 'Café notes', 'Second slide'], 'ppt ' + (big ? 'big' : 'mini'));
    assert.deepStrictEqual(tg, ['slide 1', 'slide 1', 'slide 1', 'slide 1', 'slide 2']);
  }
  assert.throws(() => pptLines(new ArrayBuffer(600)), /not a valid \.ppt/);
  // pptx: slide order, entities, bullets, tags
  const tags = [];
  const lines = await pptxLines(zip({ 'ppt/slides/slide2.xml': slide(['Second &amp; last']), 'ppt/slides/slide1.xml': slide(['Topics:', 'Alpha', 'Beta']) }), tags);
  assert.deepStrictEqual(lines, ['Topics:', '• Alpha', '• Beta', 'Second & last']);
  assert.deepStrictEqual(tags, ['slide 1', 'slide 1', 'slide 1', 'slide 2']);
  // docx: plain paragraph, list paragraph (numPr), run split across <w:t>, entity
  const docx = '<w:document><w:body><w:p><w:r><w:t xml:space="preserve">CPU is the </w:t></w:r><w:r><w:t>brain &amp; core</w:t></w:r></w:p>'
    + '<w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>Item one</w:t></w:r></w:p><w:p></w:p></w:body></w:document>';
  assert.deepStrictEqual(await docxLines(zip({ 'word/document.xml': docx })), ['CPU is the brain & core', '• Item one']);
  await assert.rejects(() => pptxLines(new ArrayBuffer(40)), /not a valid/);

  // generator
  const notes = [
    'Computer basics', 'The CPU is the part of a computer that runs instructions.', 'RAM stands for random access memory used for short term storage.',
    'A compiler means a program that translates source code into machine code.', 'An interpreter is a program that runs source code line by line.',
    'A router is a device that forwards data between networks.', 'A switch is a device that connects devices inside one network.',
    'Note: this line is a heading and should not become a term at all here.', 'Storage devices:', '• Hard disk', '• Solid state drive', '• USB flash drive',
    'Storage devices:', '• Hard disk', '• Solid state drive', '• USB flash drive', // duplicate list
    'The CPU is the part of a computer that runs instructions.', // duplicate definition
  ];
  const t = notes.map((_, i) => 'page ' + (i < 8 ? 1 : 2));
  let sawTF = false;
  for (let k = 0; k < 40; k++) {
    const out = generate(notes, t);
    assert(out.length >= 3 && out.every(x => /^\(page \d\) /.test(x.exp)), 'source carries page tag');
    assert.strictEqual(out.filter(x => x.type === 'enum').length, 1, 'duplicate list dropped');
    assert(!out.some(x => /Note/.test(x.answer || '') ), 'heading is not a term');
    if (out.some(x => x.options && x.options[0] === 'True')) sawTF = true;
    const mc = generate(notes, t, { mcOnly: true, max: 3 });
    assert(mc.length <= 3 && mc.every(x => x.type === 'mc'));
    assert(new Set(out.map(x => x.id)).size === out.length, 'ids unique');
  }
  assert(sawTF, 'true/false items appear');
  assert.deepStrictEqual(enumCheck(['a', 'bb', 'ccc'], 'ccc, a').missing, ['bb']);
  // Grading accepts the answer as a student types it: "and", numbering, articles, acronym expansions.
  const three = ['CPU', 'RAM', 'Cache'];
  for (const typed of ['CPU, RAM, Cache', 'CPU and RAM and Cache', 'CPU\nRAM\nCache', '1. CPU, 2. RAM, 3. Cache',
    'cpu, ram & cache', 'CPU, RAM, and Cache', '- CPU\n- RAM\n- Cache', 'CPU; RAM; Cache', 'the CPU, the RAM, the Cache'])
    assert.deepStrictEqual(enumCheck(three, typed).missing, [], 'all three accepted from: ' + JSON.stringify(typed));
  assert.deepStrictEqual(enumCheck(three, 'CPU and RAM').missing, ['Cache'], 'a genuinely missing item still counts');
  assert.deepStrictEqual(enumCheck(['Research and development', 'Marketing'], 'Research and development, Marketing').missing, [], 'an item containing "and" still matches');
  assert.strictEqual(idOk('RAM', 'random access memory'), true, 'the spelled-out acronym is accepted');
  assert.strictEqual(idOk('random access memory', 'RAM'), true, 'the acronym is accepted for a spelled-out answer');
  assert.strictEqual(idOk('CPU', 'RAM'), false, 'two different acronyms never match');
  assert.strictEqual(idOk('heap', 'stack'), false, 'different short words never match');
  assert.strictEqual(idOk('cache', ''), false, 'an empty answer is wrong');
  // Phase 2: outline lines are skipped, filler is stripped, and a "false" statement is only made when it cannot be true
  const course = [
    'Topics covered', '• Module 1 — Computer organization, functional units, instruction cycle, number systems', '• Module 2 — IA-32 processor architecture, registers, memory management, protection and multitasking',
    'Memory', 'A cache is basically a very small fast memory placed close to the CPU (see Figure 2).', 'RAM is the main working memory that holds running programs, etc.',
    'A stack is a region of memory that stores return addresses and local data.', 'A heap is a region of memory that stores return addresses and local data too.',
    'A pipeline is a technique that overlaps the steps of several instructions.',
  ];
  const texts = new Set(); let sawFalse = false;
  for (let k = 0; k < 200; k++) generate(course, course.map(() => 'page 1')).forEach(x => {
    texts.add(x.q + ' ' + (x.options || []).join(' ') + ' ' + (x.items || []).join(' '));
    if (!/^True or false: /.test(x.q)) return;
    const st = x.q.slice('True or false: '.length);
    assert(/^[A-Z]/.test(st) && /\.$/.test(st), 'a true/false item is a full sentence: ' + x.q);
    if (x.answer !== 1) return;
    sawFalse = true;
    // A "false" statement must not be a sentence the notes actually make, and two definitions that say
    // the same thing must never be swapped for each other.
    const said = course.map(l => l.replace(/\s+/g, ' ').trim());
    assert(!said.includes(st), 'a false statement is not copied from the notes: ' + x.q);
    const flip = st.replace(/\bstack\b/i, '\u0000').replace(/\bheap\b/i, 'stack').replace(/\u0000/, 'heap');
    assert(!said.includes(flip), 'near-identical definitions are never swapped: ' + x.q);
  });
  const all = [...texts].join('\n');
  assert(!/Module \d/.test(all), 'outline lines are skipped');
  assert(!/basically|very small|see Figure|etc\./.test(all), 'filler is removed');
  assert(sawFalse, 'verified false statements are still made');
  // A slide lead-in ("6. The primary function of the Control Unit (CU) is to:" + its options) is not a
  // claim. It used to become "True or false: ... Control Unit (SI) is to:", which cannot be answered.
  const slides = [
    'Computer System Components',
    '1. The primary function of the Control Unit (CU) is to:',
    'A. Store files permanently', 'B. Execute arithmetic calculations only',
    'C. Keyboard', 'D. Speaker',
    '6. The primary function of the Control Unit (CU) is to:',
    'A. Fetch, decode and execute instructions', 'B. Store files permanently',
    'The CU also directs the flow of data between the CPU and other units.',
    'Input devices:', 'C. Keyboard', 'D. Speaker',
  ];
  const slideTF = new Set();
  for (let k = 0; k < 300; k++) generate(slides, slides.map(() => 'page 1')).forEach(x => { if (/^True or false: /.test(x.q)) slideTF.add(x.q); });
  for (const q of slideTF) {
    const st = q.slice('True or false: '.length);
    assert(!/[:;,]\s*$/.test(st), 'no true/false item is cut off at a lead-in: ' + q);
    assert(!/\b(?:is|are|to|of|the|and|such as)\s*\.?$/i.test(st.replace(/\.$/, '')), 'no true/false item ends on a dangling word: ' + q);
    assert(!/matches this description/.test(q), 'true/false is a claim, not a matching puzzle: ' + q);
    assert(!/\S:\s/.test(st), 'no true/false item is a "Term: explanation" line: ' + q);
    assert(/\.$/.test(st), 'true/false items end as a sentence: ' + q);
  }
  assert(slideTF.size >= 1, 'the one complete sentence in those slides still becomes true/false');
  assert([...slideTF].every(q => /directs the flow of data/.test(q)), 'only the real claim is used: ' + [...slideTF].join(' | '));
  // Exam-paper furniture is not content. A module of instructions, rubrics and pre-blanked items used to
  // produce "True or false: Register is correct and FALSE if the statement is incorrect."
  const paper = [
    'Computer Architecture Review',
    'II. Write TRUE if the statement is correct and FALSE if the statement is incorrect.',
    '1. ________ DB defines one byte.',
    '2. ________ Arrays store elements in consecutive memory locations.',
    'III. Choose the best answer.',
    'Shift and Rotate Instructions',
    'Shift and rotate instructions move the bits of an operand left or right.',
    'A. Screen resolution', 'B. Keyboard input', 'C. Control unit', 'D. Arithmetic logic unit',
    'The control unit fetches and decodes instructions from memory.',
    'A register is a small storage location inside the processor.',
    'ROM is memory that keeps its contents after the power is off.',
    'A byte is a group of eight bits.',
  ];
  const RUBRIC_TEXT = /\bif the statement is\b|\bwrite (?:true|false)\b|\btrue or false\b|\bchoose the (?:best|correct)\b|\bfill in the blanks?\b|_{3,}/i;
  let paperTF = 0, paperItems = 0;
  for (let k = 0; k < 200; k++) generate(paper, paper.map(() => 'page 18')).forEach(x => {
    paperItems++;
    // The "True or false: " prefix is the app's own wording, not note text.
    each(x, s => assert(!RUBRIC_TEXT.test(String(s).replace(/^True or false: /, '')), 'no question is built from a rubric, an instruction or a blank line: ' + s));
    if (!/^True or false: /.test(x.q)) return;
    paperTF++;
    const st = x.q.slice('True or false: '.length);
    // "A RAM is…" and "Register is…" both read as errors; the article must fit the term that is there.
    const m = st.match(/^(A|An)\s+([A-Za-z0-9-]+)/);
    if (m) {
      assert(!/^[A-Z0-9][A-Z0-9.-]+$/.test(m[2]), 'an article is not left in front of an acronym: ' + x.q);
      assert.strictEqual(/^[aeiou]/i.test(m[2]), m[1] === 'An', 'a/an agrees with the next word: ' + x.q);
    }
  });
  assert(paperItems >= 3, 'the real sentences in an exam paper still become questions');
  assert(paperTF >= 1, 'a genuine claim in the same paper still becomes true/false');
  // True/false is never lopsided: a set cannot be mostly one answer.
  for (let k = 0; k < 100; k++) {
    const tf = generate(paper, paper.map(() => 'page 18')).filter(x => /^True or false: /.test(x.q));
    const nTrue = tf.filter(x => x.answer === 0).length;
    assert(nTrue * 2 >= tf.length, 'true and false are balanced: ' + tf.length + ' items, ' + nTrue + ' true');
  }
  // Number agreement: a swapped term must fit the verb already in the notes' sentence.
  const agree = [
    'Enzymes are proteins that speed up chemical reactions.',
    'Osmosis is the movement of water across a membrane.',
    'Mitochondria are organelles that produce most of the cell ATP.',
    'A ribosome is a structure that builds proteins.',
    'Chloroplasts are organelles where photosynthesis takes place.',
    'A nucleus is the part that holds the genetic material.',
    'Vacuoles are sacs that store water and nutrients.',
    'A membrane is a barrier that controls what enters a cell.',
  ];
  for (let k = 0; k < 200; k++) generate(agree, agree.map(() => 'page 1')).forEach(x => {
    if (!/^True or false: /.test(x.q)) return;
    const st = x.q.slice('True or false: '.length);
    const m = st.match(/^([\w-]+(?: [\w-]+)?)\s+(is|are|was|were)\b/);
    if (!m) return;
    const word = m[1].trim().split(/\s+/).pop().toLowerCase();
    // "mitochondria" and "osmosis" carry no plural -s; the verb in the note decides for them.
    if (/^(mitochondria|bacteria|data|criteria|nuclei|fungi)$/.test(word)) return;
    const pluralWord = /[^su]s$/.test(word) && !/(?:ss|is|us|osis)$/.test(word);
    assert.strictEqual(pluralWord, /^(are|were)$/.test(m[2]), 'subject and verb agree: ' + x.q);
  });
  // Phase 3: wrong options come from the same section, are never stated in the sentence, and never repeat the answer
  const mix = [
    'Registers', 'EAX is the accumulator register used for arithmetic operations.', 'EBX is the base register used to point at data in memory.', 'ECX is the counter register used for loops and shifts.', 'EDX is the data register used for input and output addresses.',
    'Networking', 'A router is a device that forwards data between networks.', 'A switch is a device that connects devices inside one network.', 'A firewall is a security system that filters traffic using rules.', 'A modem is a device that converts signals for the telephone line.',
    'A stack is a region of memory that stores return addresses.', 'A stack pointer is a register that holds the address of the top of the stack.',
  ];
  let regQs = 0;
  for (let k = 0; k < 150; k++) generate(mix, mix.map(() => 'page 1')).forEach(x => {
    if (x.type !== 'mc' || x.options.length !== 4) return;
    assert.strictEqual(new Set(x.options.map(norm)).size, 4, 'options are distinct');
    assert.strictEqual(x.options[x.answer] === undefined, false, 'key points at an option');
    const ans = x.options[x.answer];
    if (/^Which term/.test(x.q)) {
      x.options.forEach((o, i) => { if (i !== x.answer) assert(!(/stack/i.test(o) && /stack/i.test(ans)), 'no variant of the answer as a wrong option: ' + x.options); });
      if (/^E[A-D]X$/.test(ans)) { regQs++; assert(x.options.every(o => /^E[A-D]X$/.test(o)), 'acronym answers get acronym distractors: ' + x.options); }
    }
  });
  assert(regQs > 0, 'register questions were generated');
  const quiet = generate(notes, t, { noTF: true, noEnum: true });
  assert(quiet.length >= 3, 'notes still produce questions without true/false or enumeration');
  assert(!quiet.some(x => x.type === 'enum' || /^True or false: /.test(x.q)), 'the type toggles are honoured');
  assert.strictEqual(ITEM_CAP.mc, 30, 'the advertised cap is the generator cap');

  // Phase 0: progress is matched by the question, not by an id that Shuffle renumbers.
  const fact = { id: 'id0', type: 'id', q: 'Which term is described? A fast memory close to the CPU.', answer: 'cache', exp: '' };
  assert.strictEqual(itemKey(fact), itemKey({ ...fact, id: 'id9', q: '  which term is described?  a fast MEMORY close to the CPU. ' }), 'the key ignores case, punctuation, spacing and id');
  assert.notStrictEqual(itemKey(fact), itemKey({ ...fact, answer: 'RAM' }), 'a different answer is a different fact');
  const oldSet = [
    fact,
    { id: 'mc1', type: 'mc', q: 'Which term stores the return address?', options: ['stack', 'heap'], answer: 0, exp: '' },
    { id: 'mc2', type: 'mc', q: 'Which term connects networks?', options: ['router', 'switch'], answer: 0, exp: '' }
  ];
  const newSet = [
    { ...fact, id: 'id4' },
    { id: 'mc5', type: 'mc', q: 'Which term stores the return address?', options: ['heap', 'stack'], answer: 1, exp: '' },
    { id: 'id6', type: 'id', q: 'Which term connects networks?', answer: 'router', exp: '' }
  ];
  const carried = carryProgress(oldSet, newSet, {
    ans: { id0: { val: 'cache', ok: true, exp: '' }, mc1: { val: 1, ok: false, exp: 'stack' }, mc2: { val: 'router', ok: true, exp: '' } },
    known: ['id0', 'mc1', 'mc2'], learn: [], srs: { id0: { box: 2, due: 9 }, mc1: { box: 0, due: 9 }, mc2: { box: 1, due: 9 } },
    flags: ['id0']
  });
  assert.deepStrictEqual(carried.ans.id4, { val: 'cache', ok: true, exp: '' }, 'a typed answer follows its question');
  assert.deepStrictEqual(carried.ans.mc5, { val: 0, ok: false, exp: 'stack' }, 'a chosen option follows the option text when the options move');
  assert.strictEqual(carried.ans.id6, undefined, 'an answer does not change format with the card');
  assert.deepStrictEqual(carried.srs.id6, { box: 1, due: 9 }, 'mastery follows the fact across formats');
  assert.ok(carried.known.has('id6') && carried.known.has('mc5'), 'known cards follow the fact');
  assert.strictEqual(carried.kept, 3, 'every matched item is reported');
  assert.ok(carried.flags.has('id4'), 'a flag follows its question');
  assert.strictEqual(carried.flags.has('id6'), false, 'a flag does not jump to another question');
  assert.strictEqual(carried.ans.id0, undefined, 'the old id is not reused');
  const ambiguous = carryProgress([fact], [{ ...fact, id: 'a' }, { ...fact, id: 'b' }], { ans: { id0: { val: 'cache', ok: true, exp: '' } } });
  assert.deepStrictEqual(ambiguous.ans, {}, 'a duplicated question cannot steal progress');
  assert.deepStrictEqual(carryProgress([fact], [{ ...fact, id: 'z', answer: 'other' }], { ans: { id0: { val: 'cache', ok: true, exp: '' } } }).ans, {}, 'a changed answer does not inherit the old result');
  const flagOnly = carryProgress([fact], [{ ...fact, id: 'f1' }], { flags: ['id0'] });
  assert.ok(flagOnly.flags.has('f1') && flagOnly.kept === 1, 'a flag alone is enough to carry the question');
  console.log('all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
