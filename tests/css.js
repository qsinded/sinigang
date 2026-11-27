// Run: node tests/css.js   (Node 18+)
// Diagram pin numbers sit on --acc and --bad. Every theme block that sets one of those must also set
// the ink drawn on it, readable at 4.5:1 (WCAG AA for 12 px text), so a theme change fails here.
const fs = require('fs');
const assert = require('assert');

const css = fs.readFileSync('css/styles.css', 'utf8');
const rgb = hex => { const s = hex.slice(1); return (s.length === 3 ? [...s].map(c => c + c) : s.match(/../g)).map(x => parseInt(x, 16) / 255); };
const lum = hex => { const [r, g, b] = rgb(hex).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
assert.ok(Math.abs(ratio('#000', '#fff') - 21) < 1e-9, 'contrast formula self-check');

let blocks = 0;
for (const [, body] of css.matchAll(/\{([^{}]*--(?:acc|bad):[^{}]*)\}/g)) {
  const v = name => (new RegExp('--' + name + ':(#[0-9a-fA-F]{3,6})\\b').exec(body) || [])[1];
  for (const bg of ['acc', 'bad']) {
    if (!v(bg)) continue;
    blocks++;
    assert.ok(v('on-' + bg), 'a theme sets --' + bg + ' without --on-' + bg + ': ' + body.slice(0, 60));
    const c = ratio(v('on-' + bg), v(bg));
    assert.ok(c >= 4.5, '--on-' + bg + ' on --' + bg + ' is ' + c.toFixed(2) + ':1 in ' + body.slice(0, 60));
  }
}
assert.ok(blocks >= 6, 'light, system-dark and dark themes all checked');
for (const [rule] of css.matchAll(/\.pin[^{}]*\{[^{}]*\}/g)) assert.ok(!/#[0-9a-fA-F]{3}|rgb\(/.test(rule), 'diagram pins use colour tokens, not literals: ' + rule);
assert.ok(/\.pin\.big\{/.test(css), 'the flashcard answer pin (.pin.big) has its own size');
console.log('css checks passed');
