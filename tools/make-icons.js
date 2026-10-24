// Run: node tools/make-icons.js   (Node 18+, no packages)
// Draws the app icons used by the manifest and iOS. Shapes only, so no font is needed and the
// pixels are identical on every machine. Re-run this after changing a colour in css/styles.css.
const fs = require('fs'), path = require('path'), zlib = require('zlib');

const INK = [0x14, 0x21, 0x3d], ACC = [0xc2, 0x8f, 0x00], CARD = [0xf5, 0xf6, 0xf8];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type, 'ascii'), data]), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // no per-row filter
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// A rounded card on the ink background, with three gold text lines and a folded corner, all inside
// the middle 80% so the icon still looks right when a launcher crops it to a circle.
function icon(size) {
  const px = Buffer.alloc(size * size * 4), s = size / 100;
  const at = (x, y) => (y * size + x) * 4;
  const put = (x, y, c) => { const i = at(x, y); px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255; };
  const inRound = (x, y, x0, y0, x1, y1, r) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  // card box, in percentages of the icon; art stays inside 20-80% so a circular launcher crop is safe
  const x0 = 20 * s, y0 = 16 * s, x1 = 80 * s, y1 = 84 * s, r = 9 * s, fold = 13 * s;
  // text lines on the card: [y, right end] in percent
  const lines = [[36, 68], [52, 68], [68, 54]];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      put(x, y, INK);
      if (!inRound(x, y, x0, y0, x1, y1, r)) continue;
      if ((x1 - x) + (y - y0) < fold) continue; // folded corner
      const ly = y / s, lx = x / s;
      const onLine = lines.some(([ly0, lx1]) => Math.abs(ly - ly0) <= 2.8 && lx >= 32 && lx <= lx1 - 2);
      put(x, y, onLine ? ACC : CARD);
    }
  }
  return png(size, size, px);
}

const out = path.join(__dirname, '..', 'icons');
fs.mkdirSync(out, { recursive: true });
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  fs.writeFileSync(path.join(out, name), icon(size));
  console.log('wrote icons/' + name);
}
