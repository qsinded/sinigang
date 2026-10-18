// Reads text from .pptx and .docx (zips of XML, via the browser's built-in DecompressionStream) and old .ppt (OLE2 binary). No library.
// ponytail: slide and body text only (no speaker notes, tables-as-rows, headers/footers, zip64, or old binary .doc).
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

// A multi-paragraph box is a bullet list; a line ending in ":" stays a list header.
const bullets = ps => ps.map(t => ps.length > 1 && !t.endsWith(':') ? '• ' + t : t);

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
      out.push(...bullets(ps));
    }
    if (tags) for (let i = before; i < out.length; i++) tags[i] = 'slide ' + s.n;
  }
  return out;
}

// Old .ppt: an OLE2 "compound file" holding a "PowerPoint Document" stream of records. Returns that stream.
function cfbStream(buf, wanted) {
  const bad = () => new Error('This is not a valid .ppt file.');
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  if (u8.length < 512 || dv.getUint32(0, true) !== 0xE011CFD0 || dv.getUint32(4, true) !== 0xE11AB1A1) throw bad();
  const ss = 1 << dv.getUint16(30, true), mss = 1 << dv.getUint16(32, true), cutoff = dv.getUint32(56, true);
  const at = id => (id + 1) * ss, END = 0xFFFFFFFA; // ids from here up are markers, not sectors
  const u32 = (id, n) => { if (at(id) + n * 4 > u8.length) throw bad(); return Array.from({ length: n }, (_, i) => dv.getUint32(at(id) + i * 4, true)); };
  const fatIds = [];
  for (let i = 0; i < 109; i++) fatIds.push(dv.getUint32(76 + i * 4, true));
  for (let id = dv.getUint32(68, true), guard = dv.getUint32(72, true); id < END && guard--;) { const e = u32(id, ss / 4); fatIds.push(...e.slice(0, -1)); id = e[e.length - 1]; }
  const fat = fatIds.filter(id => id < END).flatMap(id => u32(id, ss / 4));
  const chain = (id, table) => { const ids = []; while (id < END && ids.length <= table.length) { ids.push(id); id = table[id]; } return ids; };
  const join = parts => { const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let k = 0; parts.forEach(p => { o.set(p, k); k += p.length; }); return o; };
  const big = id => join(chain(id, fat).map(c => { if (at(c) + ss > u8.length) throw bad(); return u8.subarray(at(c), at(c) + ss); }));
  const dir = big(dv.getUint32(48, true)), dd = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  let root = null, hit = null;
  for (let p = 0; p + 128 <= dir.length; p += 128) {
    const name = new TextDecoder('utf-16le').decode(dir.subarray(p, p + Math.max(0, dd.getUint16(p + 64, true) - 2)));
    const ent = { start: dd.getUint32(p + 116, true), size: dd.getUint32(p + 120, true) };
    if (dir[p + 66] === 5) root = ent; else if (name === wanted) hit = ent;
  }
  if (!hit || !root) throw bad();
  if (hit.size >= cutoff) return big(hit.start).subarray(0, hit.size);
  const mini = big(root.start), mf = big(dv.getUint32(60, true)), mfat = Array.from({ length: mf.length >> 2 }, (_, i) => new DataView(mf.buffer, mf.byteOffset).getUint32(i * 4, true));
  return join(chain(hit.start, mfat).map(c => mini.subarray(c * mss, (c + 1) * mss))).subarray(0, hit.size);
}

// Text atoms inside Slide containers only, so masters, notes and outline copies are skipped.
// ponytail: slides come in file order (not reordered order), and fast-saved files can still hold old text. Upgrade: follow the persist directory.
function pptLines(buf, tags) {
  const s = cfbStream(buf, 'PowerPoint Document'), dv = new DataView(s.buffer, s.byteOffset, s.byteLength), out = [];
  let slide = 0;
  const walk = (p, end, inSlide) => {
    while (p + 8 <= end) {
      const ver = dv.getUint16(p, true) & 15, type = dv.getUint16(p + 2, true), len = dv.getUint32(p + 4, true), b = p + 8;
      if (b + len > end) return; // not a record: stop this level
      if (ver === 15) { if (type === 0x03EE) slide++; walk(b, b + len, inSlide || type === 0x03EE); }
      else if (inSlide && (type === 0x0FA0 || type === 0x0FA8)) {
        const ps = new TextDecoder(type === 0x0FA0 ? 'utf-16le' : 'windows-1252').decode(s.subarray(b, b + len)).split(/[\r\n\v]+/).map(t => t.trim()).filter(Boolean);
        for (const t of bullets(ps)) { if (tags) tags[out.length] = 'slide ' + slide; out.push(t); }
      }
      p = b + len;
    }
  };
  walk(0, s.length, false);
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
if (typeof module !== 'undefined') module.exports = { pptxLines, pptLines, docxLines, zipXml };
