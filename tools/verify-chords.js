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
   chordToneLabels, ukeVoicing, mandoVoicing })`, ctx);
const { OPEN_CHORDS, MOVABLE, TRIAD_TONES, TRIAD_SETS, INV_NAMES, UKE_ABS, MANDO_ABS,
  chordRootPc, parseQuality, resolveChord, chordVoicings, movableAt, triadShape,
  chordToneLabels, ukeVoicing, mandoVoicing } = X;

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

console.log('\n--- PROBLEMS (' + problems.length + ') ---');
problems.forEach((p) => console.log(p));
console.log('\n--- NOTES (' + notes.length + ') ---');
notes.forEach((n) => console.log(n));
