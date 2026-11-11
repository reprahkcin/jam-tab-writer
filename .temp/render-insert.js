// Renders lap insert pages for a tuning/key/scale into .temp/insert.html
'use strict';
const fs = require('fs'), vm = require('vm');
const SHARP = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const CHORD_RE = /^([A-G])([#b]?)((?:maj|min|sus|add|aug|dim|m|M|Δ|ø|°|\+|-|[0-9]|#|b|\(|\))*)(?:\/([A-G])([#b]?))?$/;
const escapeHtml = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');
const ctx = vm.createContext({ SHARP, NOTE_INDEX, CHORD_RE, escapeHtml, console });
vm.runInContext(fs.readFileSync(__dirname + '/../chords.js', 'utf8'), ctx);
const X = vm.runInContext('({ lapInsertPages, lapInsertGeometry, lapPositions, SCALES, lapBarNameAt, lapKeyZones })', ctx);
const [tuningName, strings, bars, root, scaleId, extra] = [process.argv[2] || 'C6 (C E G A C E)', (process.argv[3] || '48,52,55,57,60,64').split(',').map(Number), (process.argv[4] || 'C,Am').split(','), +(process.argv[5] || 0), process.argv[6] || 'majPent', process.argv[7] || ''];
const neck = { scale: 22.5, length: 18.375, frets: 28, nutW: 1.8, endW: 2.6, nutSpan: 1.45, endSpan: 1.95 };
const scale = X.SCALES.find((s) => s.id === scaleId);
const names = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const g = X.lapInsertGeometry(neck, strings.length);
const lastFret = g.d.length - 1;
const o = { neck, tuning: strings, tuningName, shortName: tuningName.split(' (')[0], rootPc: root, scale,
  scaleTitle: `${names[root]} ${scale.name}`, names, dimPcs: null, labels: 'both', color: extra.includes('color'),
  bars: (n) => bars.map((b) => X.lapBarNameAt(b, n)), positions: X.lapPositions(bars, root, scale, lastFret) };
if (!extra.includes('nozones')) o.zones = X.lapKeyZones(strings, root, scale, (pc) => names[pc], lastFret);
const pages = X.lapInsertPages(o);
fs.writeFileSync(__dirname + '/insert.html', `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#888">${pages.map((p) => `<div style="margin:10px;background:#fff;display:inline-block">${p}</div>`).join('')}</body></html>`);
console.log('pages', pages.length, 'zones', o.zones ? o.zones.zones.map((z, i) => o.zones.names[i] + ' ' + z.from + '-' + z.to).join(' | ') : 'none');
