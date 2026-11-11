'use strict';
const fs = require('fs'), vm = require('vm');
const SHARP = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const CHORD_RE = /^([A-G])([#b]?)((?:maj|min|sus|add|aug|dim|m|M|Δ|ø|°|\+|-|[0-9]|#|b|\(|\))*)(?:\/([A-G])([#b]?))?$/;
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const ctx = vm.createContext({ SHARP, NOTE_INDEX, CHORD_RE, escapeHtml, console });
vm.runInContext(fs.readFileSync(__dirname + '/../chords.js', 'utf8'), ctx);
const X = vm.runInContext('({ scaleDiagramSVG, chordTriad, lapTriadGrips, lapPositions, lapBarNameAt, lapInsertPages, lapInsertGeometry, lapKeyTriads, SCALES })', ctx);
const C6 = [48, 52, 55, 57, 60, 64];
const scale = X.SCALES[0];
// Screen map: G C D Em in C6, key of G.
const pos = X.lapPositions(['C', 'Am'], 7, scale, 15);
const kindsAt = (f) => pos.at(f).map((i) => pos.list[i].shape);
const ruler = ['C', 'Am'].map((bar) => Array.from({ length: 16 }, (_, f) => ({ text: X.lapBarNameAt(bar, f), hi: ['G', 'C', 'D', 'Em'].includes(X.lapBarNameAt(bar, f)) })));
ruler.push(Array.from({ length: 16 }, (_, f) => ({ shapes: kindsAt(f) })));
const rows = ['G', 'C', 'D', 'Em'].map((n) => ({ label: n, focus: n, on: false, grips: X.lapTriadGrips(X.chordTriad(n), C6, 15) }));
const map = X.scaleDiagramSVG(7, scale.iv, null, C6, { onWire: true, ruler, shapeAt: kindsAt, gutter: 30, grips: rows, stringNames: ['C', 'E', 'G', 'A', 'C', 'E'] });
const css = fs.readFileSync(__dirname + '/../styles.css', 'utf8')
  .split('\n').filter((l) => l.startsWith('.scale-svg')).join('\n')
  .replace(/var\(--panel-2\)/g, '#2f2f2f').replace(/var\(--panel\)/g, '#262626').replace(/var\(--line\)/g, '#3b3b3b')
  .replace(/var\(--muted\)/g, '#909090').replace(/var\(--text\)/g, '#e8e8e8').replace(/var\(--accent\)/g, '#f0a35e')
  .replace(/var\(--section\)/g, '#8ec5f0').replace(/var\(--chord\)/g, '#f0a35e');
const vb = map.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
const W = +vb[1], H = +vb[2], S = 3;
fs.writeFileSync(__dirname + '/triads-screen.svg', map
  .replace('<svg class="scale-svg"', `<svg xmlns="http://www.w3.org/2000/svg" width="${W * S}" height="${H * S}" class="scale-svg"`)
  .replace(/preserveAspectRatio="[^"]*">/, (m) => `${m}<style>${css}</style><rect width="100%" height="100%" fill="#262626"/>`));
// Insert: C6, G major pentatonic, black and white.
const neck = { scale: 22.5, length: 18.375, frets: 28, nutW: 1.8, endW: 2.6, nutSpan: 1.45, endSpan: 1.95 };
const g = X.lapInsertGeometry(neck, 6), last = g.d.length - 1;
const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
const pages = X.lapInsertPages({ neck, tuning: C6, tuningName: 'C6 (C E G A C E)', shortName: 'C6', rootPc: 7, scale, scaleTitle: 'G Major pentatonic',
  names, dimPcs: null, labels: 'both', color: false, bars: (n) => ['C', 'Am'].map((b) => X.lapBarNameAt(b, n)),
  positions: pos && X.lapPositions(['C', 'Am'], 7, scale, last), triads: X.lapKeyTriads(C6, 7, scale, last, (pc) => names[pc]) });
fs.writeFileSync(__dirname + '/triads-insert.svg', pages[0].replace('width="8.5in" height="11in"', 'width="1700" height="2200"'));
console.log('ok', W, H);
// Inline the class styles as style="" so QuickLook can draw it.
const rules = [];
for (const line of css.split('\n')) {
  const m = /^((?:\.scale-svg\s+)?(?:\.[\w-]+)+)\s*(?:,\s*[^{]+)?\{([^}]*)\}/.exec(line);
  if (!m) continue;
  const sels = line.slice(0, line.indexOf('{')).split(',').map((x) => x.trim().replace(/^\.scale-svg\s+/, ''));
  for (const sel of sels) if (/^(\.[\w-]+)+$/.test(sel)) rules.push({ classes: sel.slice(1).split('.'), props: m[2].trim() });
}
let svgText = fs.readFileSync(__dirname + '/triads-screen.svg', 'utf8').replace(/<style>[\s\S]*?<\/style>/, '');
svgText = svgText.replace(/<(\w+)([^>]*?) class="([^"]+)"/g, (all, tag, pre, cls) => {
  const have = cls.split(' ');
  const props = rules.filter((r) => r.classes.every((c) => have.includes(c))).map((r) => r.props).join(';');
  return `<${tag}${pre} class="${cls}" style="${props.replace(/"/g, "'")}"`;
});
// Rows inherit nothing from <g>, so give text a font everywhere.
svgText = svgText.replace('<rect width="100%"', '<style>text{font-family:Helvetica,Arial,sans-serif}</style><rect width="100%"');
fs.writeFileSync(__dirname + '/triads-screen-inline.svg', svgText);
console.log('inline ok', rules.length);
