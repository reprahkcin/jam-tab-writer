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
   SCALES, LAP_PIECE_MAX, fretDistance, lapInsertGeometry, lapInsertCuts, lapInsertPages })`, ctx);
const { OPEN_CHORDS, MOVABLE, TRIAD_TONES, TRIAD_SETS, INV_NAMES, UKE_ABS, MANDO_ABS,
  chordRootPc, parseQuality, resolveChord, chordVoicings, movableAt, triadShape,
  chordToneLabels, ukeVoicing, mandoVoicing, lapVoicings, chordIntervals, INTERVAL_LABELS,
  SCALES, LAP_PIECE_MAX, fretDistance, lapInsertGeometry, lapInsertCuts, lapInsertPages } = X;

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

console.log('\n--- PROBLEMS (' + problems.length + ') ---');
problems.forEach((p) => console.log(p));
console.log('\n--- NOTES (' + notes.length + ') ---');
notes.forEach((n) => console.log(n));
