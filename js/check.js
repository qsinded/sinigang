// Run: node tests/check.js   (Node 18+, no packages). Checks the generator and the .pptx/.docx readers.
const assert = require('assert'), zlib = require('zlib');
const { generate, enumCheck } = require('../js/reviewer-generator.js');
const { pptxLines, docxLines } = require('../js/pptx-reader.js');

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

(async () => {
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
  console.log('all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
