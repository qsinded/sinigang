// Run: node tests/check.js   (Node 18+, no packages). Checks the generator and the .pptx/.docx readers.
const assert = require('assert'), zlib = require('zlib');
const { generate, enumCheck } = require('../js/reviewer-generator.js');
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
  // outline lines are not quizzed, filler is stripped, questions name their section, "because" becomes a reason question
  const course = [
    'Topics covered', 'Module 1 — Computer organization, functional units, instruction cycle, number systems', 'Module 2 — IA-32 processor architecture, registers, memory management, protection and multitasking',
    'Memory', 'A cache is basically a very small fast memory placed close to the CPU (see Figure 2).', 'RAM is the main working memory that holds running programs, etc.',
    'A stack is a region of memory that stores return addresses and local data.', 'A heap is a region of memory used for data that lives beyond one function call.',
    'The CPU uses a cache because main memory is much slower than the processor itself.',
    'Interrupts are handled quickly because the CPU must respond before the device loses its data.',
    'Pages are fixed in size because the hardware can then find any page with one simple calculation.',
    'Registers sit inside the CPU because the processor needs its working values within one clock cycle.',
  ];
  const seenQ = new Set(), seenOpt = new Set();
  for (let k = 0; k < 40; k++) generate(course, course.map(() => 'page 1')).forEach(x => { seenQ.add(x.q); (x.options || []).forEach(o => seenOpt.add(o)); (x.items || []).forEach(o => seenOpt.add(o)); });
  const allText = [...seenQ, ...seenOpt].join('\n');
  assert(!/Module \d/.test(allText), 'outline lines are skipped');
  assert(!/basically|very small|see Figure|etc\./.test(allText), 'filler is removed: ' + allText);
  assert([...seenQ].some(q => /^In "Memory", /.test(q)), 'question carries its section');
  assert([...seenQ].some(q => /omplete the explanation: .* because _____\.$/.test(q)), 'reason question is built');
  console.log('all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
