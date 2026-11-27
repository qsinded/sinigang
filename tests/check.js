// Run: node tests/check.js   (Node 18+, no packages). Checks the generator and the .pptx/.docx readers.
const assert = require('assert'), zlib = require('zlib'), fs = require('fs'), path = require('path');
const { generate, enumCheck, idOk, gradeId, norm, itemKey, carryProgress, ITEM_CAP, SKIP_REASONS } = require('../js/reviewer-generator.js');

// Professor logic: the learning objectives decide what matters; jumbled text is never asked.
{
  const mod = ['Learning Objectives', '- Explain what a kernel does', '- Describe how a scheduler works', '- Define a process',
    'Kernel: the core of the OS that talks to the hardware.', 'Scheduler: the part of the OS that decides which process runs next.',
    'Process: a program that is currently running.', 'Cache: a small fast memory placed close to the CPU.',
    'Latency: the time a packet takes to travel from sender to receiver.', 'Pager: a thing that is ## @@ x y z q w e r t y ~~ !! stuff.'];
  for (let k = 0; k < 100; k++) {
    const top = generate(mod, mod.map(() => 'page 1'), { max: 3 });
    assert.ok(top.length === 3 && top.every(x => /kernel|scheduler|process/i.test(x.exp)), 'the cap keeps the objective terms: ' + top.map(x => x.exp));
    generate(mod, mod.map(() => 'page 1')).forEach(x => assert.ok(!/Pager|Enumerate: By the end|## @@/.test(x.q + x.exp), 'jumbled text or the objectives became a question: ' + x.q));
  }
}
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
  assert.strictEqual(idOk('Interphase', 'prophase metaphase anaphase interphase telophase'), false, 'typing every candidate is not correct');
  assert.strictEqual(idOk('Interphase', 'interphase stage'), true, 'a small extra word is still accepted');
  assert.strictEqual(idOk('centromere', 'the centromere'), true, 'a leading article is ignored');
  // Grading by words: extra filler is fine, an extra content word is not; a missing word is fine while most is there.
  for (const [ans, typed, want] of [['Telophase', 'telophase lol idk', false], ['Interphase', 'interphase stage', true],
    ['Interphase', 'not interphase', false], ['Mitosis', 'mitosis and meiosis', false], ['cell membrane', 'cell membranes', true],
    ['cell membrane', 'membrane', true], ['Andres Bonifacio', 'Bonifacio', true], ['law of demand', 'demand', false],
    ['Research and development', 'research and development', true]])
    assert.strictEqual(idOk(ans, typed), want, JSON.stringify(typed) + ' for ' + JSON.stringify(ans) + ' should be ' + want);
  // Small spelling slips in long words are accepted and flagged; short words, acronyms and other real terms are not.
  for (const [ans, typed] of [['Mitochondria', 'mitocondria'], ['Photosynthesis', 'photosinthesis'], ['Cytokinesis', 'cytokenesis']]) {
    assert.deepStrictEqual(gradeId(ans, typed), { ok: true, typo: true }, JSON.stringify(typed) + ' is a typo of ' + ans);
  }
  assert.deepStrictEqual(gradeId('Mitochondria', 'mitochondria'), { ok: true, typo: false }, 'an exact answer is no typo');
  assert.deepStrictEqual(gradeId('cell membrane', 'cell membranes'), { ok: true, typo: false }, 'a plural is not a spelling slip');
  assert.strictEqual(idOk('Mitosis', 'meiosis'), false, 'two letters off a 7-letter word is another word');
  assert.strictEqual(idOk('CPU', 'CPV'), false, 'acronyms get no typo tolerance');
  assert.strictEqual(idOk('CPU', 'CPUs'), true, 'a short answer typed in the plural is still right');
  assert.strictEqual(idOk('CPU', 'CPU unit stuff'), false, 'a short answer with extra words is not');
  // A slip is only accepted when no other answer in the reviewer is as close: "stalagtite" is one letter off both.
  assert.strictEqual(idOk('stalagmite', 'stalagtite'), true, 'alone, one slip in a long word is accepted');
  assert.strictEqual(idOk('stalagmite', 'stalagtite', ['stalagmite', 'stalactite']), false, 'equally close to another answer is not accepted');
  assert.strictEqual(idOk('Mitosis', 'mitosos', ['Mitosis', 'Meiosis']), true, 'closer to its own answer than any other is accepted');
  assert.deepStrictEqual(enumCheck(['Prophase', 'Metaphase', 'Anaphase', 'Telophase'], 'prophase, metaphse, anaphase, telophase').missing, [], 'a slip inside a list is accepted');
  // History notes are past tense: "X was Y" is a definition too.
  const hist = ['The Katipunan was a secret society founded by Andres Bonifacio in 1892.', 'The Malolos Constitution was the first republican constitution in Asia.',
    'La Liga Filipina was a civic organization founded by Rizal to unite Filipinos.', 'The Treaty of Paris was the agreement that ended the Spanish-American War.'];
  assert(generate(hist).length >= 3, 'past-tense notes produce questions');
  // A dated sentence is asked by its year, in the past tense too ("declared", "arrived"); a decade is never blanked.
  const dated = ['Ferdinand Magellan arrived in Cebu in the Philippines in 1521.', 'Emilio Aguinaldo declared Philippine independence in Kawit, Cavite on June 12, 1898.',
    'Miguel Lopez de Legazpi established the first Spanish settlement in Cebu in 1565.', 'Lapulapu defeated Magellan in the Battle of Mactan in 1521.',
    'The first computers in the Philippines arrived in the 1960s at UP Diliman.'];
  const blanked = new Set();
  for (let i = 0; i < 20; i++) {
    const blanks = generate(dated).filter(q => /^Fill in the blank:/.test(q.q));
    blanks.forEach(q => {
      blanked.add(q.q);
      const a = q.type === 'mc' ? q.options[q.answer] : q.answer;
      assert.match(a, /^\d{4}$/, 'the year is the blank: ' + q.q);
      assert(!/1960s/.test(q.q), 'a decade sentence is not blanked: ' + q.q);
      if (q.type === 'mc') q.options.forEach(o => assert.match(o, /^\d{4}$/, 'wrong options are years too: ' + q.q));
    });
  }
  // A long Title Case title is a heading, not the start of the first sentence under it.
  for (let i = 0; i < 20; i++) {
    const titled = generate(['Araling Panlipunan - Spanish Colonization and Revolution', ...dated, ...hist]);
    titled.forEach(q => assert(!/Araling|Colonization/.test(q.q + ' ' + (q.options || []).join(' ') + ' ' + (q.answer || '')), 'the title leaked into: ' + q.q));
    assert(titled.some(q => /Magellan arrived/.test(q.exp)), 'the first sentence under the title is still asked');
  }
  // The same in sentence case: no verb, the next line starts a new sentence.
  for (let i = 0; i < 20; i++) generate(['Spanish colonization and the Philippine revolution of the century', ...dated, ...hist]).forEach(q =>
    assert(!/colonization/.test(q.q + ' ' + (q.options || []).join(' ') + ' ' + (q.answer || '')), 'the sentence-case title leaked into: ' + q.q));
  // A verbless line cut mid-sentence still joins when the next line carries on in lower case.
  const cut = generate(['Ferdinand Magellan and his crew from Spain on their voyage around the world', 'arrived in Cebu in the Philippines in 1521.', ...hist], [], { noTF: true });
  assert(cut.some(q => /voyage around the world arrived in Cebu/.test(q.exp)), 'a verbless wrapped line stays in its sentence');
  // A clause before "is" is not a term: "A surplus happens when quantity supplied is greater…" must not answer "surplus happens when…".
  const econ = ['A surplus happens when quantity supplied is greater than quantity demanded.', 'A shortage happens when quantity demanded is greater than quantity supplied.',
    'Demand is the quantity of a good that consumers are willing and able to buy.', 'Supply is the quantity of a good that producers are willing to sell.', 'Inflation is a general increase in prices over time.'];
  for (let i = 0; i < 20; i++) generate(econ).forEach(q => {
    const a = q.type === 'mc' ? q.options[q.answer] : String(q.answer || '');
    assert(!/\bwhen\b/.test(a) && !(q.options || []).some(o => /happens when/.test(o)), 'a clause became a term: ' + q.q + ' => ' + a);
  });
  // A Title Case line in the middle of a sentence ("...between Spain and" / "United States Of America") still joins it.
  const wrapped = generate(['The Treaty of Paris was the agreement signed between Spain and', 'United States Of America To End The Spanish-American War', ...hist]);
  assert(wrapped.some(q => /Treaty of Paris/.test(q.exp) && /United States Of America/.test(q.exp)), 'a wrapped line stays in its sentence');
  assert.strictEqual(blanked.size, 4, 'every dated sentence (not the decade one) becomes a fill-in-the-blank: ' + [...blanked].join(' / '));
  // Skip reasons: every note line that yields no question says why, so the notes (or the generator) can be fixed.
  const skipNotes = ['Cell Biology Review', '12', 'Mitosis is the division of a nucleus into two identical nuclei.',
    'Meiosis is a cell division that produces four haploid gametes.', 'Interphase is the stage where the cell grows and copies its DNA.',
    'Long chains of amino acids folded into shapes form the proteins of a cell.', 'Why is the cell membrane important to the cell?', 'Write TRUE if the statement is correct.',
    'Dutch lens makers built the first microscopes in the 1590s.', 'Parts of a cell:', '- Nucleus', '- Ribosome',
    'Organelles:', '- Mitochondria', '- Golgi body', '- Vacuole'];
  const reasonFor = (out, text) => (out.skipped.find(s => s.text === text) || {}).reason;
  for (let i = 0; i < 10; i++) {
    const out = generate(skipNotes);
    assert(Array.isArray(out.skipped), 'generate() reports what it skipped');
    assert.strictEqual(reasonFor(out, 'Cell Biology Review'), 'heading');
    assert.strictEqual(reasonFor(out, '12'), 'furniture');
    assert.strictEqual(reasonFor(out, 'Long chains of amino acids folded into shapes form the proteins of a cell.'), 'no-pattern');
    assert.strictEqual(reasonFor(out, 'Why is the cell membrane important to the cell?'), 'question');
    assert.strictEqual(reasonFor(out, 'Write TRUE if the statement is correct.'), 'instruction');
    assert.strictEqual(reasonFor(out, 'Dutch lens makers built the first microscopes in the 1590s.'), 'decade');
    assert.strictEqual(reasonFor(out, 'Parts of a cell: Nucleus, Ribosome'), 'short-list');
    out.skipped.forEach(s => assert(SKIP_REASONS[s.reason], 'every reason is explained: ' + s.reason));
    const asked = new Set(out.map(q => q.exp));
    out.skipped.forEach(s => assert(!asked.has(s.text), 'a sentence that became a question is not listed as skipped: ' + s.text));
    assert(!JSON.stringify(out).includes('skipped'), 'the report is not saved with the questions');
  }
  // Filipino notes: "Ang X ay Y", "Si X ay Y" and "Si X ang Y" are definitions; a verb-first sentence with a year
  // ("Itinatag ni … noong 1892") is a fill-in-the-blank; "Ito ay …" has no term.
  const fil = ['Ang Katipunan ay isang lihim na samahan na itinatag ni Andres Bonifacio.', 'Si Jose Rizal ay binaril sa Bagumbayan noong Disyembre 30, 1896.',
    'Si Andres Bonifacio ang tinaguriang Ama ng Katipunan.', 'Itinatag ni Andres Bonifacio ang Katipunan sa Tondo noong 1892.',
    'Ang Kartilya ng Katipunan ay isinulat ni Emilio Jacinto.', 'Ang La Liga Filipina ay samahang itinatag ni Jose Rizal sa Maynila.',
    'Ang Saligang Batas ng Malolos ay ang unang republikanong konstitusyon sa Asya.', 'Ito ay mahalagang pangyayari sa kasaysayan ng bansa.'];
  const persons = ['Jose Rizal', 'Andres Bonifacio', 'Emilio Jacinto'];
  const answersFil = new Set();
  for (let i = 0; i < 30; i++) generate(fil).forEach(q => {
    const a = q.type === 'mc' ? q.options[q.answer] : String(q.answer || '');
    if (!/^(True|False)$/.test(a)) answersFil.add(a);
    assert.notStrictEqual(a, 'Ito', '"Ito ay …" has no term');
    const si = q.q.match(/^True or false: Si (.+?) (?:ay|ang) /), ang = q.q.match(/^True or false: Ang (.+?) ay /);
    if (si) assert(persons.includes(si[1]), 'only a person follows "Si": ' + q.q);
    if (ang) assert(!persons.includes(ang[1]), 'a person never follows "Ang": ' + q.q);
  });
  for (const a of ['Katipunan', 'Jose Rizal', 'Andres Bonifacio', 'Kartilya ng Katipunan', '1892'])
    assert(answersFil.has(a), 'Filipino notes ask for "' + a + '"; got: ' + [...answersFil].join(' / '));
  // English with a capitalised "Si" (silicon) is not a Filipino claim, so a verbless line stays a heading.
  const si = generate(['Mining Si wafers and doping in modern chip factories', 'A wafer is a thin slice of silicon used to build chips.',
    'Doping is the process of adding impurities to change how a semiconductor conducts.', 'Etching is the step that removes material to form circuit patterns.']);
  assert.strictEqual((si.skipped.find(s => /Mining Si/.test(s.text)) || {}).reason, 'heading', 'a capitalised "Si" in English is not a Filipino marker');
  assert.strictEqual(idOk('Katipunan', 'ang katipunan'), true, 'a leading "ang" is ignored');
  assert.strictEqual(idOk('Jose Rizal', 'si Jose Rizal'), true, 'a leading "si" is ignored');
  // Plain subject-verb facts ("Ribosomes build proteins…", "The law of demand states that…") ask for their subject
  // as a blank in the note's own sentence. A quantifier or pronoun ("Many cells", "It") is never the answer.
  const svo = ['Ribosomes build proteins from amino acids.', 'The cell membrane controls what enters and leaves the cell.',
    'The law of demand states that when price rises, quantity demanded falls.', 'The law of supply states that when price rises, quantity supplied rises.',
    'A shortage happens when quantity demanded is greater than quantity supplied.', 'A surplus happens when quantity supplied is greater than quantity demanded.',
    'Segmentation divides memory into variable-size logical sections for each program.', 'The control unit fetches and decodes instructions from memory.',
    'Many cells divide every day to replace old and damaged ones.', 'It moves the data from one register to another register.'];
  const svoAns = new Set();
  for (let i = 0; i < 25; i++) generate(svo).filter(q => /^Fill in the blank: /.test(q.q)).forEach(q => {
    const a = q.type === 'mc' ? q.options[q.answer] : q.answer;
    svoAns.add(a);
    assert(!/^(?:Many|It)\b/i.test(a), 'a quantifier or pronoun is not a term: ' + a);
    // The blank sits where the answer stands in the note's own sentence.
    assert.strictEqual(q.q.replace('Fill in the blank: ', '').replace('_____', a).toLowerCase(), q.exp.toLowerCase(), 'the blank is the subject of: ' + q.exp);
  });
  for (const a of ['Ribosomes', 'cell membrane', 'law of demand', 'shortage', 'Segmentation', 'control unit'])
    assert(svoAns.has(a), 'subject-verb fact asks for "' + a + '"; got: ' + [...svoAns].join(' / '));
  // "Instructions:" heads an exam section, but "instruction pointer" is a term; and the subject-verb stage's own reason
  // replaces the vaguer "no-pattern" when it rejects a sentence.
  const ip = generate(['The instruction pointer holds the address of the next instruction to run.', 'Instructions: Answer all the questions below carefully.',
    'A register is a small storage location inside the processor.', 'The cache is a small fast memory placed close to the CPU.',
    'Many cells divide every day to replace old and damaged ones.'], [], { noTF: true });
  assert(ip.some(q => (q.type === 'mc' ? q.options[q.answer] : q.answer) === 'instruction pointer'), '"instruction pointer" is a term, not an exam instruction');
  assert.strictEqual(reasonFor(ip, 'Instructions: Answer all the questions below carefully.'), 'instruction');
  assert.strictEqual(reasonFor(ip, 'Many cells divide every day to replace old and damaged ones.'), 'bad-term', 'the subject-verb reason replaces "no-pattern"');
  // Question wording follows the answer: a person is asked with "Who is described?", and a person's wrong options
  // are other people when the notes have enough of them. Things keep "Which term is described?".
  const people = ['Si Jose Rizal ay binaril sa Bagumbayan noong Disyembre 30, 1896.', 'Si Andres Bonifacio ay nagtatag ng Katipunan sa Tondo.',
    'Si Emilio Jacinto ay sumulat ng Kartilya ng Katipunan.', 'Si Apolinario Mabini ay tinaguriang Dakilang Lumpo ng himagsikan.',
    'Ferdinand Magellan was a Portuguese explorer who led the first voyage around the world.',
    'The Katipunan was a secret society founded to fight Spanish rule in the islands.', 'Ang La Liga Filipina ay samahang itinatag para sa reporma.',
    'Ang Saligang Batas ng Malolos ay ang unang republikanong konstitusyon sa Asya.'];
  const who = ['Jose Rizal', 'Andres Bonifacio', 'Emilio Jacinto', 'Apolinario Mabini', 'Ferdinand Magellan'];
  const sawWho = new Set();
  for (let i = 0; i < 40; i++) generate(people, [], { noTF: true }).forEach(q => {
    const a = q.type === 'mc' ? q.options[q.answer] : q.answer;
    if (/^(?:Which term|Who) is described\?/.test(q.q)) {
      assert.strictEqual(/^Who is described\?/.test(q.q), who.includes(a), 'a person, and only a person, is asked with "Who": ' + q.q + ' => ' + a);
      if (who.includes(a)) sawWho.add(a);
      if (q.type === 'mc' && who.includes(a)) q.options.forEach(o => assert(who.includes(o), 'a person\'s wrong options are people: ' + q.options.join(' | ')));
    }
  });
  assert(sawWho.has('Jose Rizal') && sawWho.has('Ferdinand Magellan'), '"Who" questions are asked for Filipino and English notes: ' + [...sawWho].join(', '));
  // A fill-in-the-blank subject's wrong options agree with its verb: "_____ build" never offers "nucleus".
  const organelles = ['Ribosomes build proteins from amino acids.', 'Lysosomes break down waste and worn-out parts inside the cell.',
    'Chloroplasts capture light energy for photosynthesis in plant cells.', 'Vacuoles store water and nutrients for the cell.',
    'The nucleus controls the activities and growth of the cell.', 'The cell membrane surrounds the cell and protects its contents.',
    'The cell wall gives plant cells a fixed shape and extra support.', 'The cytoplasm holds the organelles in a jelly-like fluid.'];
  const many = x => /[^su]s$/.test(String(x).trim().split(/\s+/).pop().toLowerCase());
  let blanksMC = 0;
  for (let i = 0; i < 40; i++) generate(organelles, [], { noTF: true }).filter(q => q.type === 'mc' && /^Fill in the blank: /.test(q.q)).forEach(q => {
    blanksMC++;
    q.options.forEach(o => assert.strictEqual(many(o), many(q.options[q.answer]), 'wrong options agree with the verb: ' + q.q + ' | ' + q.options.join(' / ')));
  });
  assert(blanksMC > 0, 'subject blanks still become multiple choice when enough options agree');
  // Variety: in one set no wrong option appears more than twice; small notes ask more by typing instead of repeating.
  for (const f of fs.readdirSync(path.join(__dirname, 'corpus')).filter(f => f.endsWith('.txt'))) {
    const lines = fs.readFileSync(path.join(__dirname, 'corpus', f), 'utf8').split(/\r?\n/);
    for (let i = 0; i < 10; i++) {
      const used = new Map();
      generate(lines).filter(q => q.type === 'mc' && !/^True or false/.test(q.q)).forEach(q => q.options.forEach((o, k) => { if (k !== q.answer) used.set(o, (used.get(o) || 0) + 1); }));
      used.forEach((n, o) => assert(n <= 2, f + ': the wrong option "' + o + '" appears ' + n + ' times in one set'));
    }
  }
  // A fact that made a question but was cut by the limit, or by a type the student turned off, says so.
  const capped = generate(skipNotes, [], { max: 1 });
  assert(capped.skipped.some(s => s.reason === 'limit'), 'items cut by the limit are reported');
  const noLists = generate(skipNotes, [], { noEnum: true });
  assert.strictEqual(reasonFor(noLists, 'Organelles: Mitochondria, Golgi body, Vacuole'), 'type-off');
  // An acronym and its spelled-out form are the same answer, so one is never a wrong option for the other.
  const osNotes = ['An operating system is software that manages hardware and software resources.', 'The OS was first developed in the 1950s at IBM.',
    'A process is a program that is currently running in memory.', 'The kernel is the core of the system that talks to the hardware.', 'A thread is the smallest unit of work the scheduler runs.'];
  for (let i = 0; i < 30; i++) generate(osNotes).filter(q => q.type === 'mc').forEach(q => {
    const lo = q.options.map(o => o.toLowerCase()), key = lo[q.answer];
    if (key === 'os' || key === 'operating system') assert(!(lo.includes('os') && lo.includes('operating system')), 'both correct options offered: ' + q.q);
  });
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
    // "True or false: " and "Fill in the blank: … _____" are the app's own wording, not note text; the source sentence
    // (exp) is still checked, so a pre-blanked exam line ("1. ________ DB defines…") is still caught.
    each(x, s => assert(!RUBRIC_TEXT.test(String(s).replace(/^True or false: /, '').replace(/^Fill in the blank: (.*)_____/, '$1')), 'no question is built from a rubric, an instruction or a blank line: ' + s));
    assert(!RUBRIC_TEXT.test(String(x.exp).replace(/^\([^)]*\)\s*/, '')), 'no question cites a rubric or a pre-blanked line: ' + x.exp);
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
