// Pitch-level accuracy audit of the guitar-tab-writer chord banks.
// Loads chords.js with the app.js globals it needs, then checks every shape
// the app can draw against the notes its chord name promises.
'use strict';
const fs = require('fs');
const path = require('path').join(__dirname, '..', 'chords.js');

// ---- app.js globals chords.js relies on ------------------------------------
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const CHORD_RE = /^([A-G])([#b]?)((?:maj|min|sus|add|aug|dim|m|M|Δ|ø|°|\+|-|[0-9]|#|b|\(|\))*)(?:\/([A-G])([#b]?))?$/;
const escapeHtml = (s) => s;

// Evaluate chords.js in a shared VM context and pull its bindings out.
const vm = require('vm');
const ctx = vm.createContext({ SHARP, NOTE_INDEX, CHORD_RE, escapeHtml, console });
const src = fs.readFileSync(path, 'utf8');
vm.runInContext(src + `
;({ OPEN_CHORDS, MOVABLE, TRIAD_TONES, TRIAD_SETS, INV_NAMES, UKE_ABS, MANDO_ABS,
   chordRootPc, parseQuality, resolveChord, chordVoicings, movableAt, triadShape,
   chordToneLabels, ukeVoicing, mandoVoicing })`, ctx);
const X = vm.runInContext(`({ OPEN_CHORDS, MOVABLE, TRIAD_TONES, TRIAD_SETS, INV_NAMES, UKE_ABS, MANDO_ABS,
   chordRootPc, parseQuality, resolveChord, chordVoicings, movableAt, triadShape,
   chordToneLabels, ukeVoicing, mandoVoicing, lapVoicings, chordIntervals, INTERVAL_LABELS,
   SCALES, LAP_PIECE_MAX, fretDistance, lapInsertGeometry, lapInsertCuts, lapInsertPages, lapPositions, scaleDiagramSVG })`, ctx);
const { OPEN_CHORDS, MOVABLE, TRIAD_TONES, TRIAD_SETS, INV_NAMES, UKE_ABS, MANDO_ABS,
  chordRootPc, parseQuality, resolveChord, chordVoicings, movableAt, triadShape,
  chordToneLabels, ukeVoicing, mandoVoicing, lapVoicings, chordIntervals, INTERVAL_LABELS,
  SCALES, LAP_PIECE_MAX, fretDistance, lapInsertGeometry, lapInsertCuts, lapInsertPages, lapPositions, scaleDiagramSVG } = X;

// ---- ground truth ----------------------------------------------------------
// Expected pitch-class interval sets for every suffix in the banks.
const TRUTH = {
  '': [0, 4, 7], 'm': [0, 3, 7], '7': [0, 4, 7, 10], 'm7': [0, 3, 7, 10],
  'maj7': [0, 4, 7, 11], '6': [0, 4, 7, 9], 'm6': [0, 3, 7, 9],
  'sus2': [0, 2, 7], 'sus4': [0, 5, 7], 'add9': [0, 2, 4, 7],
  '7sus4': [0, 5, 7, 10], 'dim': [0, 3, 6], 'dim7': [0, 3, 6, 9],
  'm7b5': [0, 3, 6, 10], 'aug': [0, 4, 8], '9': [0, 2, 4, 7, 10],
  'm9': [0, 2, 3, 7, 10], 'maj9': [0, 2, 4, 7, 11], 'madd9': [0, 2, 3, 7],
  '5': [0, 7],
};
// A chord of 4+ tones may conventionally omit its 5th (open C7, 9ths on uke).
function okWithout5(rootPc, iv, act) {
  if (iv.length < 4) return false;
  const exp = expectPcs(rootPc, iv.filter((i) => i !== 7));
  return setEq(act, exp);
}
const TUNING = [40, 45, 50, 55, 59, 64]; // EADGBe

const pcName = (pc) => SHARP[((pc % 12) + 12) % 12];
function sounded(frets, tuning = TUNING) {
  const notes = [];
  frets.forEach((f, i) => { if (f >= 0) notes.push(tuning[i] + f); });
  return notes;
}
function pcSet(notes) { return new Set(notes.map((n) => n % 12)); }
function expectPcs(rootPc, iv) { return new Set(iv.map((i) => (rootPc + i) % 12)); }
function setEq(a, b) { return a.size === b.size && [...a].every((x) => b.has(x)); }
function describe(rootPc, actual, expected) {
  const extra = [...actual].filter((x) => !expected.has(x)).map(pcName);
  const missing = [...expected].filter((x) => !actual.has(x)).map(pcName);
  const parts = [];
  if (missing.length) parts.push('missing ' + missing.join(','));
  if (extra.length) parts.push('extra ' + extra.join(','));
  return parts.join('; ');
}

function rootPc2(plainName) { const mm = plainName.match(CHORD_RE); return chordRootPc(mm[1], mm[2]); }
const problems = [];
const notes = [];
function bad(section, name, msg) { problems.push(`[${section}] ${name}: ${msg}`); }

// ---- 1. OPEN_CHORDS --------------------------------------------------------
for (const [name, frets] of Object.entries(OPEN_CHORDS)) {
  const m = name.match(CHORD_RE);
  const rootPc = chordRootPc(m[1], m[2]);
  const suffix = m[3];
  const iv = TRUTH[suffix];
  if (!iv) { bad('open', name, 'no ground-truth for suffix ' + suffix); continue; }
  const ns = sounded(frets);
  const act = pcSet(ns);
  const exp = expectPcs(rootPc, iv);
  if (!setEq(act, exp) && !okWithout5(rootPc, iv, act)) bad('open', name, describe(rootPc, act, exp));
  // informational: bass note
  const bassPc = Math.min(...ns) % 12;
  if (bassPc !== rootPc) notes.push(`[open] ${name}: bass is ${pcName(bassPc)}, not root (inversion by shape)`);
}

// ---- 2. MOVABLE barre forms at all 12 roots --------------------------------
for (const [formName, form] of Object.entries(MOVABLE)) {
  for (const [q, pat] of Object.entries(form.q)) {
    const iv = TRUTH[q === 'major' ? '' : q];
    if (!iv) { bad('movable', `${formName}:${q}`, 'no ground truth'); continue; }
    for (let rootPc = 0; rootPc < 12; rootPc++) {
      const { fret, frets } = movableAt({ ref: form.ref, pat }, rootPc);
      const act = pcSet(sounded(frets));
      const exp = expectPcs(rootPc, iv);
      if (!setEq(act, exp) && !okWithout5(rootPc, iv, act)) {
        bad('movable', `${formName}-form ${pcName(rootPc)}${q === 'major' ? '' : q} @${fret}fr`, describe(rootPc, act, exp));
      }
    }
  }
}

// ---- 3. Triads: 12 roots x qualities x sets x inversions -------------------
for (let rootPc = 0; rootPc < 12; rootPc++) {
  for (const [q, tones] of Object.entries(TRIAD_TONES)) {
    for (const set of TRIAD_SETS) {
      for (let inv = 0; inv < 3; inv++) {
        const frets = triadShape(rootPc, tones, set, inv);
        if (!frets) continue; // allowed to bail
        const ns = sounded(frets);
        const act = pcSet(ns);
        const exp = expectPcs(rootPc, tones);
        const label = `${pcName(rootPc)}${q === 'major' ? '' : q} ${set.name} ${INV_NAMES[inv]}`;
        if (!setEq(act, exp)) { bad('triad', label, describe(rootPc, act, exp)); continue; }
        // bass must be the inversion's tone
        const wantBass = (rootPc + tones[inv]) % 12;
        const bassPc = Math.min(...ns) % 12;
        if (bassPc !== wantBass) bad('triad', label, `bass ${pcName(bassPc)}, expected ${pcName(wantBass)}`);
        const fr = frets.filter((f) => f > 0);
        const span = fr.length ? Math.max(...fr) - Math.min(...fr) : 0;
        if (span > 4) bad('triad', label, `span ${span} unplayable`);
      }
    }
  }
}

// ---- 4. chordVoicings across the board -------------------------------------
const SUFFIXES = ['', 'm', '7', 'm7', 'maj7', '6', 'm6', 'sus2', 'sus4', 'add9',
  '7sus4', 'dim', 'dim7', 'm7b5', 'aug', '9', 'm9', 'maj9', 'madd9', '5'];
for (let rootPc = 0; rootPc < 12; rootPc++) {
  for (const suf of SUFFIXES) {
    const name = SHARP[rootPc] + suf;
    const iv = TRUTH[suf];
    for (const v of chordVoicings(name)) {
      if (!v.frets) continue;
      const act = pcSet(sounded(v.frets));
      const exp = expectPcs(rootPc, iv);
      if (!setEq(act, exp) && !okWithout5(rootPc, iv, act)) bad('voicings', `${name} [${v.label}]`, describe(rootPc, act, exp));
    }
  }
}

// ---- 5. Slash chords: the user's complaint, quantified ---------------------
const SLASHES = ['C/E', 'C/G', 'C/B', 'D/F#', 'D/A', 'G/B', 'G/D', 'G/F#', 'A/C#', 'A/E',
  'Am/G', 'Am/E', 'Am/C', 'Em/B', 'Em/G', 'F/A', 'F/C', 'E/G#', 'Dm/F', 'C/F', 'D/C', 'Am7/G', 'Fmaj7/A', 'B7/D#', 'G7/B'];
console.log('--- Slash chords: what the app actually draws ---');
let slashFails = 0;
for (const name of SLASHES) {
  const m = name.match(CHORD_RE);
  if (!m) { console.log(`${name}: DOES NOT PARSE`); continue; }
  const bassPc = m[4] ? chordRootPc(m[4], m[5] || '') : null;
  const plain = name.split('/')[0];
  const frets = resolveChord(name);
  const plainFrets = resolveChord(plain);
  const same = JSON.stringify(frets) === JSON.stringify(plainFrets);
  let verdict;
  if (!frets) verdict = 'no shape';
  else {
    const ns = sounded(frets);
    const actualBass = pcName(Math.min(...ns) % 12);
    const hasBassPc = pcSet(ns).has(bassPc);
    const suf = m[3];
    const iv = TRUTH[suf] || [0, 4, 7];
    const exp = expectPcs(rootPc2(plain), iv);
    exp.add(bassPc);
    const act = pcSet(ns);
    const lowestIsBass = Math.min(...ns) % 12 === bassPc;
    const tonesOk = setEq(act, exp) || okWithout5(rootPc2(plain), [...iv, 99], act) || setEq(act, new Set([...expectPcs(rootPc2(plain), iv.filter(i=>i!==7)), bassPc]));
    verdict = `${lowestIsBass ? 'bass-lowest' : 'BASS-NOT-LOWEST(' + actualBass + ')'} tones:${tonesOk ? 'ok' : 'WRONG ' + describe(0, act, exp)} frets=[${frets}]`;
    if (!lowestIsBass || !tonesOk) slashFails++;
  }
  console.log(`${name.padEnd(9)} ${verdict}`);
  // chord-tone labels: does the lens even know about the bass?
  const labels = chordToneLabels(name);
  if (labels && bassPc !== null && !labels.has(bassPc)) {
    notes.push(`[lens] ${name}: bass ${pcName(bassPc)} missing from chord-tone labels (scale map / uke / mando ignore it)`);
  }
}

console.log('slash failures: ' + slashFails);

// ---- 6. Uke & mandolin voicings --------------------------------------------
for (let rootPc = 0; rootPc < 12; rootPc++) {
  for (const suf of SUFFIXES) {
    const name = SHARP[rootPc] + suf;
    const iv = TRUTH[suf];
    for (const [inst, fn, tuning] of [['uke', ukeVoicing, UKE_ABS], ['mando', mandoVoicing, MANDO_ABS]]) {
      const frets = fn(name);
      if (!frets) { notes.push(`[${inst}] ${name}: no shape found`); continue; }
      const act = pcSet(sounded(frets, tuning));
      const exp = expectPcs(rootPc, iv);
      if (!setEq(act, exp) && !okWithout5(rootPc, iv, act)) bad(inst, name, describe(rootPc, act, exp));
    }
  }
}

// ---- 7. Lap steel grips in every lap steel tuning --------------------------
// The tunings live with the tuner presets in app.js; pull those entries out.
const appSrc = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
const LAP_TUNINGS = [...appSrc.matchAll(/^\s*(lap\w+): (\{ name: .*inst: 'Lap steel'.*\}),$/gm)]
  .map(([, id, lit]) => ({ id, ...vm.runInNewContext(`(${lit})`) }));
if (LAP_TUNINGS.length < 8) bad('lap', 'presets', `only ${LAP_TUNINGS.length} lap steel tunings found in app.js`);
const midiOf = (n) => { const r = /^([A-G]#?)(\d)$/.exec(n); return SHARP.indexOf(r[1]) + 12 * (Number(r[2]) + 1); };
const LAP_NAMES = [...SLASHES];
for (let rootPc = 0; rootPc < 12; rootPc++) for (const suf of SUFFIXES) LAP_NAMES.push(SHARP[rootPc] + suf);
for (const t of LAP_TUNINGS) {
  const tuning = t.strings.map(([n]) => midiOf(n));
  // Its straight-bar chords must really be whole at the nut.
  for (const bar of t.bars) {
    const best = lapVoicings(bar, tuning)[0];
    if (!best || best.fret !== 0 || best.omit.length) bad('lap', `${t.id} bar ${bar}`, `not a whole open chord: ${JSON.stringify(best)}`);
  }
  let partial = 0;
  for (const name of LAP_NAMES) {
    const ci = chordIntervals(name);
    const grips = lapVoicings(name, tuning);
    if (!grips.length) { notes.push(`[lap ${t.id}] ${name}: no grip`); continue; }
    if (grips[0].omit.length) partial++;
    const allowed = new Set(ci.iv.map((i) => (ci.rootPc + i) % 12));
    if (ci.bassPc !== null) allowed.add(ci.bassPc);
    for (const g of grips) {
      const label = `${name} ${t.id} @${g.fret}`;
      const played = g.frets.map((f, i) => (f >= 0 ? tuning[i] + f : null)).filter((n) => n !== null);
      if (g.frets.some((f) => f >= 0 && f !== g.fret)) { bad('lap', label, 'bar not straight'); continue; }
      const act = pcSet(played);
      const wrong = [...act].filter((pc) => !allowed.has(pc));
      if (wrong.length) bad('lap', label, 'wrong notes ' + wrong.map(pcName).join(','));
      if (!act.has(ci.rootPc)) bad('lap', label, 'no root');
      if (act.size < 2) bad('lap', label, 'only one note');
      const missing = ci.iv.filter((i) => !act.has((ci.rootPc + i) % 12)).map((i) => INTERVAL_LABELS[i]);
      const said = g.omit.filter((o) => !o.endsWith(' bass'));
      if (missing.join() !== said.join()) bad('lap', label, `omits ${missing} but says ${said}`);
      const bassMet = !g.omit.some((o) => o.endsWith(' bass'));
      if (ci.bassPc !== null && bassMet && Math.min(...played) % 12 !== ci.bassPc) bad('lap', label, 'bass not lowest');
    }
  }
  notes.push(`[lap ${t.id}] ${partial}/${LAP_NAMES.length} chords fall back to a partial grip`);
}

// ---- 8. Lap steel neck insert geometry --------------------------------------
// The insert is only worth printing if its fret lines land on the real ones, so
// check the ruler it is drawn with, on the default neck and a few others.
const neckLit = appSrc.match(/const LAP_NECK_DEFAULTS = (\{[^}]*\});/);
if (!neckLit) bad('insert', 'defaults', 'LAP_NECK_DEFAULTS not found in app.js');
const NECKS = neckLit ? [vm.runInNewContext(`(${neckLit[1]})`)] : [];
if (NECKS.length) {
  NECKS.push({ ...NECKS[0], scale: 25.5, length: 19.9, frets: 24 }, { ...NECKS[0], scale: 24, length: 22, frets: 36, endW: 3 });
}
for (const neck of NECKS) {
  const label = `${neck.scale}in/${neck.length}in`;
  const g = lapInsertGeometry(neck, 6);
  const last = g.d.length - 1;
  if (Math.abs(g.d[12] - neck.scale / 2) > 1e-9) bad('insert', label, 'fret 12 is not at half the scale');
  if (g.d[last] > neck.length) bad('insert', label, 'a fret runs off the board');
  if (last < neck.frets && fretDistance(neck.scale, last + 1) <= neck.length - 0.02) bad('insert', label, 'dropped a fret that fits');
  for (let n = 1; n <= last; n++) {
    if (g.d[n] - g.d[n - 1] < g.r[n] + g.r[n - 1]) bad('insert', label, `dots collide along the string at fret ${n}`);
    for (const y of [g.d[n]]) if (g.stringX(1, y) - g.stringX(0, y) < 2 * g.r[n]) bad('insert', label, `dots collide across strings at fret ${n}`);
    if (Math.abs(g.stringX(0, g.d[n])) + g.r[n] > g.halfW(g.d[n])) bad('insert', label, `outer dot hangs off the board at fret ${n}`);
  }
  const cuts = lapInsertCuts(g.d, g.length);
  if (cuts[0] !== 0 || cuts[cuts.length - 1] !== neck.length) bad('insert', label, 'strips do not cover the board');
  cuts.slice(1).forEach((c, i) => {
    if (c - cuts[i] > LAP_PIECE_MAX + 1e-9) bad('insert', label, `strip ${i + 1} is ${(c - cuts[i]).toFixed(2)}in, too long for the sheet`);
    if (i + 2 < cuts.length && g.d.some((y) => Math.abs(y - c) < 0.05)) bad('insert', label, `cut ${i + 1} lands on a fret line`);
  });
  // Every tuning and scale must draw, with no broken numbers in the output.
  for (const t of LAP_TUNINGS) {
    for (const scale of SCALES.concat([{ id: 'chromatic', name: 'All notes', iv: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }])) {
      const pages = lapInsertPages({
        neck, tuning: t.strings.map(([n]) => midiOf(n)), tuningName: t.name, shortName: t.id, rootPc: 7, scale,
        scaleTitle: scale.name, names: SHARP, dimPcs: null, labels: 'both', color: true, bars: (n) => t.bars.map((b) => b + n),
      });
      if (!pages.length || pages.some((svg) => /NaN|undefined|Infinity/.test(svg))) bad('insert', `${label} ${t.id} ${scale.id}`, 'broken drawing');
    }
  }
  notes.push(`[insert ${label}] ${last} frets, strips cut at ${cuts.slice(1, -1).map((c) => c.toFixed(2)).join(', ') || 'none'}`);
}

// ---- 9. Lap steel positions -------------------------------------------------
// Every key in every tuning and scale must give three positions an octave —
// the I, IV and V bars — that between them claim every fret, with the tonic's
// position drawn as the circle wherever a tonic bar exists.
const SHAPES_SEEN = new Set();
for (const t of LAP_TUNINGS) {
  for (const scale of SCALES) {
    for (let rootPc = 0; rootPc < 12; rootPc++) {
      const label = `${t.id} ${SHARP[rootPc]} ${scale.id}`;
      const p = lapPositions(t.bars, rootPc, scale, 28);
      if (!p) { bad('positions', label, 'no positions'); continue; }
      if (p.list.length !== 3) bad('positions', label, `${p.list.length} positions, expected 3`);
      p.list.forEach((q) => SHAPES_SEEN.add(q.shape));
      const tonic = p.list.find((q) => q.chords.some((c) => chordIntervals(c).rootPc === rootPc));
      if (tonic && tonic.shape !== 'circle') bad('positions', label, 'tonic position is not the circle');
      if (p.list[0].shape !== 'circle') bad('positions', label, 'first position is not the circle');
      let shared = 0;
      for (let f = 0; f <= 28; f++) {
        const at = p.at(f);
        if (!at.length || at.length > 2) bad('positions', label, `fret ${f} in ${at.length} positions`);
        if (at.length === 2) shared++;
        // A bar fret belongs to its own position, alone.
        const own = p.list.findIndex((q) => q.frets.includes(f));
        if (own >= 0 && (at.length !== 1 || at[0] !== own)) bad('positions', label, `bar fret ${f} not in its own position alone`);
      }
      if (shared > 3) bad('positions', label, `${shared} shared frets, expected at most one an octave`);
      for (const q of p.list) {
        if (q.numerals.some((n) => !/^(i|ii|iii|iv|v|vi|vii)$/i.test(n))) bad('positions', label, 'odd numeral ' + q.numerals);
        if (q.frets.some((f, i) => i && f - q.frets[i - 1] !== 12)) bad('positions', label, 'a position recurs off the octave');
      }
    }
  }
}
if ([...SHAPES_SEEN].sort().join() !== 'circle,diamond,square') bad('positions', 'shapes', 'expected circle, square and diamond only, got ' + [...SHAPES_SEEN]);
// The on-screen fret map draws the same shapes: every tuning and scale must
// render with them, with no broken numbers and a glyph row under the ruler.
for (const t of LAP_TUNINGS) {
  const abs = t.strings.map(([n]) => midiOf(n));
  for (const scale of SCALES) {
    const pos = lapPositions(t.bars, 7, scale, 15);
    const kindsAt = (f) => pos.at(f).map((i) => pos.list[i].shape);
    const ruler = [Array.from({ length: 16 }, (_, f) => ({ text: 'X', hi: false })), Array.from({ length: 16 }, (_, f) => ({ shapes: kindsAt(f) }))];
    const svg = scaleDiagramSVG(7, scale.iv, new Map([[7, 'R'], [11, '3']]), abs, { onWire: true, ruler, shapeAt: kindsAt });
    if (/NaN|undefined/.test(svg)) bad('screen', `${t.id} ${scale.id}`, 'broken fret map');
    if (!/class="sc-pos"/.test(svg) || !/<polygon[^>]*class="sc-(note|root)/.test(svg)) bad('screen', `${t.id} ${scale.id}`, 'no position shapes drawn');
  }
}
const chrom = lapPositions(['C', 'Am'], 0, { id: 'chromatic', iv: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }, 28);
if (chrom !== null) bad('positions', 'chromatic', 'the all-notes map should have no positions');

// ---- 10. Lap steel triads ----------------------------------------------------
// Three strings at one fret spelling a chord's root, 3rd and 5th once each:
// every grip returned must be one, none may be missed, and the insert must
// find room for them without running them into a strip's cut edge.
const TR = vm.runInContext(`({ chordTriad, lapTriadGrips, keyTriads, lapKeyTriads, lapTriadZones, lapTriadLayout,
  lapBand, lapMarkRadius, LAP_TRI_GAP, TRIAD_TONES, lapInsertNoteNames: typeof lapInsertNoteNames })`, ctx);
const TRIAD_EXPECT = {
  G: ['major', 7], G7: ['major', 7], Cmaj7: ['major', 0], Am7: ['m', 9], 'Bm7b5': ['dim', 11], 'F#dim7': ['dim', 6],
  'C+': ['aug', 0], Dsus4: ['sus4', 2], Asus2: ['sus2', 9], 'A/C#': ['major', 9], Bbadd9: ['major', 10], Em9: ['m', 4],
};
for (const [name, [q, pc]] of Object.entries(TRIAD_EXPECT)) {
  const t = TR.chordTriad(name);
  if (!t || t.quality !== q || t.rootPc !== pc) bad('triads', name, `reduced to ${JSON.stringify(t)}, expected ${q} on ${SHARP[pc]}`);
}
if (TR.chordTriad('E5') !== null) bad('triads', 'E5', 'a power chord is not a triad');
if (TR.chordTriad('Bm7b5').label !== 'B°' || TR.chordTriad('Bb').label !== 'Bb') bad('triads', 'labels', 'triad labels misspelled');
let gripCount = 0;
for (const t of LAP_TUNINGS) {
  const tuning = t.strings.map(([n]) => midiOf(n));
  for (let rootPc = 0; rootPc < 12; rootPc++) {
    for (const [quality, tones] of Object.entries(TR.TRIAD_TONES)) {
      const triad = { rootPc, quality, tones, label: SHARP[rootPc] + quality };
      const want = new Set(tones.map((x) => (rootPc + x) % 12));
      const grips = TR.lapTriadGrips(triad, tuning, 28);
      gripCount += grips.length;
      // Independent count: every three strings within four, every fret.
      let expect = 0;
      for (let f = 0; f <= 28; f++) {
        const pcs = tuning.map((a) => (a + f) % 12);
        for (let a = 0; a < 6; a++) for (let b = a + 1; b < 6; b++) for (let c = b + 1; c < 6 && c - a <= 3; c++) {
          const trio = new Set([pcs[a], pcs[b], pcs[c]]);
          if (trio.size === 3 && [...trio].every((x) => want.has(x))) expect++;
        }
      }
      if (grips.length !== expect) bad('triads', `${t.id} ${triad.label}`, `${grips.length} grips, expected ${expect}`);
      for (const gr of grips) {
        const [a, b, c] = gr.strings;
        const pcs = gr.strings.map((i) => (tuning[i] + gr.fret) % 12);
        if (!(a < b && b < c) || c - a > 3) bad('triads', `${t.id} ${triad.label}`, `bad string set ${gr.strings}`);
        if (new Set(pcs).size !== 3 || !pcs.every((x) => want.has(x))) bad('triads', `${t.id} ${triad.label}`, `fret ${gr.fret} ${gr.strings} spells ${pcs.map(pcName)}`);
        gr.roles.forEach((role, k) => {
          const iv = (pcs[k] - rootPc + 12) % 12;
          if (role !== ['R', '3', '5'][tones.indexOf(iv)]) bad('triads', `${t.id} ${triad.label}`, `role ${role} on ${pcName(pcs[k])}`);
        });
      }
    }
  }
  // Each straight-bar chord of the tuning is a triad the open strings grip.
  for (const bar of t.bars) {
    const tb = TR.chordTriad(bar);
    if (!TR.lapTriadGrips(tb, tuning, 0).length) bad('triads', `${t.id} ${bar}`, 'its own bar chord has no open triad');
  }
}
notes.push(`[triads] ${gripCount} grips checked across ${LAP_TUNINGS.length} tunings, 12 roots and ${Object.keys(TR.TRIAD_TONES).length} qualities`);
// The key's triads: numerals and spellings for a major and a minor key.
const kC = TR.keyTriads(0, SCALES.find((x) => x.id === 'major'), (pc) => SHARP[pc]);
if (kC.map((k) => `${k.numeral} ${k.label}`).join(',') !== 'I C,ii Dm,iii Em,IV F,V G,vi Am,vii° B°') bad('triads', 'C major', kC.map((k) => k.numeral + ' ' + k.label).join(','));
const kA = TR.keyTriads(9, SCALES.find((x) => x.id === 'minPent'), (pc) => SHARP[pc]);
if (kA.map((k) => k.numeral).join(',') !== 'i,ii°,III,iv,v,VI,VII') bad('triads', 'A minor pentatonic', kA.map((k) => k.numeral).join(','));
if (TR.keyTriads(0, { id: 'chromatic', iv: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }, (pc) => SHARP[pc]) !== null) bad('triads', 'chromatic', 'all notes has no key');
// The narrowest stretch holding a whole progression.
const C6 = LAP_TUNINGS.find((t) => t.id === 'lapC6').strings.map(([n]) => midiOf(n));
const rowsOf = (names) => names.map((n) => ({ grips: TR.lapTriadGrips(TR.chordTriad(n), C6, 15) }));
if (JSON.stringify(TR.lapTriadZones(rowsOf(['G', 'C', 'D', 'Em']))) !== '[[0,7],[7,14]]') bad('triads', 'zones G C D Em', JSON.stringify(TR.lapTriadZones(rowsOf(['G', 'C', 'D', 'Em']))));
if (JSON.stringify(TR.lapTriadZones(rowsOf(['F', 'Dm']))) !== '[[5,5]]') bad('triads', 'zones F Dm', 'F and Dm share fret 5 in C6');
if (TR.lapTriadZones(rowsOf(['G'])).length) bad('triads', 'zones G', 'one chord is no progression');
// The insert: each fret's stack inside its band, on its own strip.
let crowdedLow = 0, stacks = 0;
for (const neck of NECKS) {
  const g = lapInsertGeometry(neck, 6), last = g.d.length - 1;
  const cuts = lapInsertCuts(g.d, g.length).slice(1, -1);
  for (const t of LAP_TUNINGS) {
    const tuning = t.strings.map(([n]) => midiOf(n));
    for (const scale of SCALES) {
      for (let rootPc = 0; rootPc < 12; rootPc++) {
        const label = `${neck.scale}in ${t.id} ${SHARP[rootPc]} ${scale.id}`;
        const o = { neck, tuning, rootPc, scale, positions: lapPositions(t.bars, rootPc, scale, last), triads: TR.lapKeyTriads(tuning, rootPc, scale, last, (pc) => SHARP[pc]) };
        if (!o.triads) continue;
        const lay = TR.lapTriadLayout(o, g), rr = TR.lapMarkRadius(o, g);
        for (const [n, st] of lay.at) {
          stacks++;
          const { from, to } = TR.lapBand(g, rr, n);
          const top = to - TR.LAP_TRI_GAP - st.nut.total;
          if (top < from + 0.05 - 1e-9) bad('insert-triads', label, `fret ${n} stack runs past its band`);
          if (cuts.some((c) => c > top - 1e-9 && c < to)) bad('insert-triads', label, `fret ${n} stack crosses a strip cut`);
          if (st.body) {
            const start = g.d[n] + rr(n) + TR.LAP_TRI_GAP, stop = start + st.body.total;
            if (lay.at.has(n + 1)) bad('insert-triads', label, `fret ${n} spills into fret ${n + 1}'s rails`);
            if (stop > TR.lapBand(g, rr, n + 1).to - 0.05 + 1e-9) bad('insert-triads', label, `fret ${n} spill runs into fret ${n + 1}'s notes`);
            if (cuts.some((c) => c > g.d[n] && c < stop + 1e-9)) bad('insert-triads', label, `fret ${n} spill crosses a strip cut`);
          }
          if (st.lane < 0.042 - 1e-9 || !(st.size > 0)) bad('insert-triads', label, `fret ${n} drawn too small`);
        }
        if (neck === NECKS[0]) crowdedLow += lay.crowded.filter((n) => n <= 15).length;
        const frets = new Set(o.triads.flatMap((x) => x.grips.map((gr) => gr.fret)).filter((f) => f >= 1 && f <= last));
        if ([...frets].some((f) => !lay.at.has(f) && !lay.crowded.includes(f))) bad('insert-triads', label, 'a triad fret neither drawn nor listed as crowded');
      }
    }
    const pages = lapInsertPages({
      neck, tuning, tuningName: t.name, shortName: t.id, rootPc: 7, scale: SCALES[0], scaleTitle: 'G', names: SHARP, dimPcs: null,
      labels: 'both', color: false, bars: (n) => t.bars.map((b) => b), positions: lapPositions(t.bars, 7, SCALES[0], last),
      triads: TR.lapKeyTriads(tuning, 7, SCALES[0], last, (pc) => SHARP[pc]),
    });
    if (pages.some((svg) => /NaN|undefined|Infinity/.test(svg))) bad('insert-triads', `${neck.scale}in ${t.id}`, 'broken drawing');
  }
}
if (crowdedLow) bad('insert-triads', 'default neck', `${crowdedLow} frets at or below 15 left without their triads`);
notes.push(`[insert triads] ${stacks} fret stacks placed across ${NECKS.length} necks, every tuning, key and scale`);
// On screen: one stroke per grip up to fret 15, under the ruler.
for (const t of LAP_TUNINGS) {
  const abs = t.strings.map(([n]) => midiOf(n));
  const rows = ['G', 'Em', 'C', 'D', 'F#°'].map((name) => {
    const triad = name === 'F#°' ? { rootPc: 6, quality: 'dim', tones: [0, 3, 6], label: name } : TR.chordTriad(name);
    return { label: name, focus: name, on: name === 'C', grips: TR.lapTriadGrips(triad, abs, 15) };
  });
  const svg = scaleDiagramSVG(7, SCALES[0].iv, null, abs, { onWire: true, gutter: 30, grips: rows, stringNames: t.strings.map(([n]) => n) });
  const strokes = (svg.match(/class="sc-grip"/g) || []).length, want = rows.reduce((a, r) => a + r.grips.length, 0);
  if (/NaN|undefined/.test(svg)) bad('screen-triads', t.id, 'broken triad rows');
  if (strokes !== want) bad('screen-triads', t.id, `${strokes} grip strokes drawn, expected ${want}`);
  if ((svg.match(/class="sc-grip-row/g) || []).length !== rows.length) bad('screen-triads', t.id, 'a triad row is missing');
  if (!/sc-grip-row on/.test(svg) || !/grip-focus/.test(svg)) bad('screen-triads', t.id, 'the focus row is not marked');
  if (rows.some((r) => !r.grips.length) && !/no straight-bar triad/.test(svg)) bad('screen-triads', t.id, 'a gripless row says nothing');
}

console.log('\n--- PROBLEMS (' + problems.length + ') ---');
problems.forEach((p) => console.log(p));
console.log('\n--- NOTES (' + notes.length + ') ---');
notes.forEach((n) => console.log(n));
