// Reads text from .pptx and .docx (both are zips of XML) with the browser's built-in DecompressionStream, no library.
// ponytail: slide and body text only (no speaker notes, tables-as-rows, headers/footers, zip64, or old binary .ppt/.doc).
const unxml = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// Returns [{ name, xml }] for the zip entries whose name matches `re`.
async function zipXml(buf, re) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open .pptx or .docx. Update it, or save the file as PDF.');
  const dv = new DataView(buf), u8 = new Uint8Array(buf), dec = new TextDecoder();
  let e = u8.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('This is not a valid .pptx or .docx file.');
  const found = [];
  for (let n = dv.getUint16(e + 10, true), p = dv.getUint32(e + 16, true); n--;) {
    const nl = dv.getUint16(p + 28, true), name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    if (re.test(name)) found.push({ name, method: dv.getUint16(p + 10, true), size: dv.getUint32(p + 20, true), off: dv.getUint32(p + 42, true) });
    p += 46 + nl + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  const out = [];
  for (const s of found) {
    const d0 = s.off + 30 + dv.getUint16(s.off + 26, true) + dv.getUint16(s.off + 28, true);
    let raw = u8.subarray(d0, d0 + s.size);
    if (s.method === 8) raw = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    out.push({ name: s.name, xml: dec.decode(raw) });
  }
  return out;
}

// tags (optional array) gets one "slide N" entry per returned line.
async function pptxLines(buf, tags) {
  const slides = (await zipXml(buf, /^ppt\/slides\/slide\d+\.xml$/)).map(f => ({ n: +f.name.match(/(\d+)\.xml$/)[1], xml: f.xml }));
  const out = [];
  for (const s of slides.sort((a, b) => a.n - b.n)) {
    const before = out.length;
    for (const body of s.xml.match(/<(?:p|a):txBody>[\s\S]*?<\/(?:p|a):txBody>/g) || []) {
      const ps = (body.match(/<a:p[ >][\s\S]*?<\/a:p>/g) || []).map(x =>
        unxml((x.replace(/<a:br\s*\/?>/g, '<a:t> </a:t>').match(/<a:t>[^<]*<\/a:t>/g) || []).map(t => t.slice(5, -6)).join('')).trim()
      ).filter(Boolean);
      // A multi-paragraph box is a bullet list; a line ending in ":" stays a list header.
      out.push(...ps.map(t => ps.length > 1 && !t.endsWith(':') ? '• ' + t : t));
    }
    if (tags) for (let i = before; i < out.length; i++) tags[i] = 'slide ' + s.n;
  }
  return out;
}

// One line per paragraph; list paragraphs get a bullet so the generator reads them as list items.
async function docxLines(buf) {
  const out = [];
  for (const f of await zipXml(buf, /^word\/document\.xml$/)) {
    for (const p of f.xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []) {
      const text = unxml((p.replace(/<w:(?:tab|br)\s*\/>/g, '<w:t> </w:t>').match(/<w:t(?: [^>]*)?>[^<]*<\/w:t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join('')).trim();
      if (text) out.push(/<w:numPr[\s>\/]/.test(p) ? '• ' + text : text);
    }
  }
  return out;
}
if (typeof module !== 'undefined') module.exports = { pptxLines, docxLines, zipXml };
