// Reads slide text from a .pptx (a zip) with the browser's built-in DecompressionStream, no library.
// ponytail: slides only (no speaker notes, no zip64, no old binary .ppt).
async function pptxLines(buf) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open .pptx. Update it, or save the slides as PDF.');
  const dv = new DataView(buf), u8 = new Uint8Array(buf), dec = new TextDecoder();
  let e = u8.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('This is not a valid .pptx file.');
  const slides = [];
  for (let n = dv.getUint16(e + 10, true), p = dv.getUint32(e + 16, true); n--;) {
    const nl = dv.getUint16(p + 28, true), name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    const m = name.match(/^ppt\/slides\/slide(\d+)\.xml$/);
    if (m) slides.push({ n: +m[1], method: dv.getUint16(p + 10, true), size: dv.getUint32(p + 20, true), off: dv.getUint32(p + 42, true) });
    p += 46 + nl + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  const out = [];
  for (const s of slides.sort((a, b) => a.n - b.n)) {
    const d0 = s.off + 30 + dv.getUint16(s.off + 26, true) + dv.getUint16(s.off + 28, true);
    let raw = u8.subarray(d0, d0 + s.size);
    if (s.method === 8) raw = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    const xml = dec.decode(raw);
    for (const body of xml.match(/<(?:p|a):txBody>[\s\S]*?<\/(?:p|a):txBody>/g) || []) {
      const ps = (body.match(/<a:p[ >][\s\S]*?<\/a:p>/g) || []).map(x =>
        (x.replace(/<a:br\s*\/?>/g, '<a:t> </a:t>').match(/<a:t>[^<]*<\/a:t>/g) || []).map(t => t.slice(5, -6)).join('')
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim()
      ).filter(Boolean);
      // A multi-paragraph box is a bullet list; a line ending in ":" stays a list header.
      out.push(...ps.map(t => ps.length > 1 && !t.endsWith(':') ? '• ' + t : t));
    }
  }
  return out;
}
if (typeof module !== 'undefined') module.exports = { pptxLines };
