/* Chord shapes, diagram rendering, and harmonica suggestions.
   Loaded before app.js; reuses its globals (SHARP, NOTE_INDEX, CHORD_RE,
   transposeChord, isChord, escapeHtml) at call time. */

'use strict';

// Fret arrays are [6th(lowE), 5th(A), 4th(D), 3rd(G), 2nd(B), 1st(high e)].
// -1 = muted, 0 = open, N = fret N.
const OPEN_CHORDS = {
  'C':     [-1, 3, 2, 0, 1, 0],
  'C7':    [-1, 3, 2, 3, 1, 0],
  'Cmaj7': [-1, 3, 2, 0, 0, 0],
  'Cadd9': [-1, 3, 2, 0, 3, 0],
  'D':     [-1, -1, 0, 2, 3, 2],
  'Dm':    [-1, -1, 0, 2, 3, 1],
  'D7':    [-1, -1, 0, 2, 1, 2],
  'Dm7':   [-1, -1, 0, 2, 1, 1],
  'Dmaj7': [-1, -1, 0, 2, 2, 2],
  'Dsus2': [-1, -1, 0, 2, 3, 0],
  'Dsus4': [-1, -1, 0, 2, 3, 3],
  'E':     [0, 2, 2, 1, 0, 0],
  'Em':    [0, 2, 2, 0, 0, 0],
  'E7':    [0, 2, 0, 1, 0, 0],
  'Em7':   [0, 2, 0, 0, 0, 0],
  'Emaj7': [0, 2, 1, 1, 0, 0],
  'Esus4': [0, 2, 2, 2, 0, 0],
  'F':     [1, 3, 3, 2, 1, 1],
  'Fmaj7': [-1, -1, 3, 2, 1, 0],
  'F7':    [1, 3, 1, 2, 1, 1],
  'G':     [3, 2, 0, 0, 0, 3],
  'G7':    [3, 2, 0, 0, 0, 1],
  'Gmaj7': [3, 2, 0, 0, 0, 2],
  'Gsus4': [3, 3, 0, 0, 1, 3],
  'A':     [-1, 0, 2, 2, 2, 0],
  'Am':    [-1, 0, 2, 2, 1, 0],
  'A7':    [-1, 0, 2, 0, 2, 0],
  'Am7':   [-1, 0, 2, 0, 1, 0],
  'Amaj7': [-1, 0, 2, 1, 2, 0],
  'Asus2': [-1, 0, 2, 2, 0, 0],
  'Asus4': [-1, 0, 2, 2, 3, 0],
  'B7':    [-1, 2, 1, 2, 0, 2],
  'Bm':    [-1, 2, 4, 4, 3, 2],
  'Bm7':   [-1, 2, 0, 2, 0, 2],
  // Common open forms for qualities the barre generator would put mid-neck.
  'C9':    [-1, 3, 2, 3, 3, 3],
  'E9':    [0, 2, 0, 1, 0, 2],
  'G9':    [3, -1, 0, 2, 0, 1],
  'Eadd9': [0, 2, 2, 1, 0, 2],
  'Gadd9': [3, -1, 0, 2, 0, 3],
};

// Movable barre forms. Patterns are the open shape; add the barre fret to
// every non-muted string. E-forms have their root on the 6th string (open E,
// pitch class 4); A-forms on the 5th string (open A, pitch class 9).
const MOVABLE = {
  E: { ref: 4, q: {
    'major': [0, 2, 2, 1, 0, 0],
    'm':     [0, 2, 2, 0, 0, 0],
    '7':     [0, 2, 0, 1, 0, 0],
    'm7':    [0, 2, 0, 0, 0, 0],
    'maj7':  [0, 2, 1, 1, 0, 0],
    'sus4':  [0, 2, 2, 2, 0, 0],
    '7sus4': [0, 2, 0, 2, 0, 0],
    '6':     [0, 2, 2, 1, 2, 0],
    'm6':    [0, 2, 2, 0, 2, 0],
    'aug':   [0, 3, 2, 1, 1, 0],
    'dim7':  [0, 1, 2, 0, 2, 0],
    '5':     [0, 2, 2, -1, -1, -1],
  } },
  A: { ref: 9, q: {
    'major': [-1, 0, 2, 2, 2, 0],
    'm':     [-1, 0, 2, 2, 1, 0],
    '7':     [-1, 0, 2, 0, 2, 0],
    'm7':    [-1, 0, 2, 0, 1, 0],
    'maj7':  [-1, 0, 2, 1, 2, 0],
    'sus4':  [-1, 0, 2, 2, 3, 0],
    'sus2':  [-1, 0, 2, 2, 0, 0],
    '7sus4': [-1, 0, 2, 0, 3, 0],
    '6':     [-1, 0, 2, 2, 2, 2],
    'm6':    [-1, 0, 2, 2, 1, 2],
    'aug':   [-1, 0, 3, 2, 2, 1],
    'dim':   [-1, 0, 1, 2, 1, -1],
    'dim7':  [-1, 0, 1, 2, 1, 2],
    'm7b5':  [-1, 0, 1, 0, 1, -1],
    '9':     [-1, 0, 2, 4, 2, 3],
    'm9':    [-1, 0, 2, 4, 1, 3],
    'maj9':  [-1, 0, 2, 4, 2, 4],
    'add9':  [-1, 0, 2, 4, 2, 0],
    'madd9': [-1, 0, 2, 4, 1, 0],
    '5':     [-1, 0, 2, 2, -1, -1],
  } },
  // D-shape forms (root on the 4th string) — handy mid-neck voicings.
  D: { ref: 2, label: 'D', q: {
    'major': [-1, -1, 0, 2, 3, 2],
    'm':     [-1, -1, 0, 2, 3, 1],
    '7':     [-1, -1, 0, 2, 1, 2],
    'm7':    [-1, -1, 0, 2, 1, 1],
    'maj7':  [-1, -1, 0, 2, 2, 2],
  } },
};

// ---- Triads & voicings -----------------------------------------------------

// Absolute semitones of the open strings [6th..1st], used to order triad notes.
const STRING_ABS = [40, 45, 50, 55, 59, 64];

// Interval sets (from the root) for the qualities that reduce to a clean triad.
const TRIAD_TONES = {
  'major': [0, 4, 7],
  'm':     [0, 3, 7],
  'sus2':  [0, 2, 7],
  'sus4':  [0, 5, 7],
  'dim':   [0, 3, 6],
  'aug':   [0, 4, 8],
};

// Adjacent 3-string sets (indices into the [6th..1st] array), low → high.
const TRIAD_SETS = [
  { name: 'Top', strings: [3, 4, 5] },   // G B e
  { name: 'Mid', strings: [2, 3, 4] },   // D G B
];
const INV_NAMES = ['root', '1st', '2nd'];

// Close-voiced triad on a string set, for a given inversion (which chord tone
// sits on the lowest string). Returns a 6-string fret array, or null if it
// can't be voiced compactly. Each string's note is fixed mod 12, so the only
// freedom is which octave (fret vs fret+12) — we pick the combination that
// keeps the three notes in the tightest, lowest fret window.
function triadShape(rootPc, tones, set, inversion) {
  const pcs = tones.map((t) => (rootPc + t) % 12);
  const order = pcs.slice(inversion).concat(pcs.slice(0, inversion)); // rotate bass
  const base = set.strings.map((s, i) => (((order[i] - STRING_ABS[s]) % 12) + 12) % 12);

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const f = base.map((b, i) => b + ((mask >> i) & 1 ? 12 : 0));
    const span = Math.max(...f) - Math.min(...f);
    const maxf = Math.max(...f);
    if (!best || span < best.span || (span === best.span && maxf < best.maxf)) best = { f, span, maxf };
  }
  let f = best.f;
  while (Math.min(...f) >= 12) f = f.map((x) => x - 12); // drop to the lowest octave
  if (best.span > 4 || Math.max(...f) > 15) return null; // not compactly playable

  const frets = [-1, -1, -1, -1, -1, -1];
  set.strings.forEach((s, i) => { frets[s] = f[i]; });
  return frets;
}

function movableAt(form, rootPc) {
  const f = ((rootPc - form.ref) % 12 + 12) % 12;
  return { fret: f, frets: form.pat.map((v) => (v < 0 ? -1 : v + f)) };
}

// All voicings offered for a chord: default shape, barre forms, then triads.
// Each entry is { label, frets }. The first is the default.
function chordVoicings(name) {
  const m = name.match(CHORD_RE);
  if (!m) return [{ label: 'shape n/a', frets: null }];
  const [, root, acc, suffix] = m;
  const pc = chordRootPc(root, acc);
  const quality = parseQuality(suffix);
  const out = [{ label: 'Default', frets: resolveChord(name) }];

  const barreForms = [
    { name: 'E', form: MOVABLE.E },
    { name: 'A', form: MOVABLE.A },
    { name: 'D', form: MOVABLE.D },
  ];
  if (quality) {
    for (const { name: fname, form } of barreForms) {
      if (!form.q[quality]) continue;
      const { fret, frets } = movableAt({ ref: form.ref, pat: form.q[quality] }, pc);
      out.push({ label: `${fname}-barre ${fret}fr`, frets });
    }
    const tones = TRIAD_TONES[quality];
    if (tones) {
      for (const set of TRIAD_SETS) {
        for (let inv = 0; inv < 3; inv++) {
          const frets = triadShape(pc, tones, set, inv);
          if (frets) out.push({ label: `${set.name} triad ${INV_NAMES[inv]}`, frets });
        }
      }
    }
  }

  // Drop entries with no shape and any duplicates (same fret array).
  const seen = new Set();
  return out.filter((v) => {
    if (!v.frets) return out.length === 1; // keep a lone "n/a" so something shows
    const key = v.frets.join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function chordRootPc(root, acc) {
  let pc = NOTE_INDEX[root];
  if (acc === '#') pc += 1;
  else if (acc === 'b') pc -= 1;
  return ((pc % 12) + 12) % 12;
}

// Map a chord suffix to one of the qualities we can draw; null if unsupported.
// Order matters: longer/more specific spellings first, so maj9 never falls
// through to the bare-m test (that bug drew Cmaj9 as C minor) and m7b5 never
// reads as a plain m7.
function parseQuality(suffix) {
  const s = suffix.trim();
  if (s === '' || s === 'maj' || s === 'M') return 'major';
  if (/^(maj9|M9)/.test(s)) return 'maj9';
  if (/^(maj|M7|Δ)/.test(s)) return 'maj7';        // maj7; maj11/13 approximated
  if (/^(m7b5|min7b5|-7b5|ø)/.test(s)) return 'm7b5';
  if (/^(dim7|°7)/.test(s)) return 'dim7';
  if (/^(dim|°)/.test(s)) return 'dim';
  if (/^(aug|\+)/.test(s)) return 'aug';
  if (/^(m9|min9)/.test(s)) return 'm9';
  if (/^(m7|min7|-7)/.test(s)) return 'm7';
  if (/^(m6|min6)/.test(s)) return 'm6';
  if (/^(madd9|m\(add9\))/.test(s)) return 'madd9';
  if (/^(m|min|-)/.test(s)) return 'm';
  if (/^7sus/.test(s)) return '7sus4';
  if (/^9/.test(s)) return '9';
  if (/^(7|11|13)/.test(s)) return '7';            // 11/13: the b7 is the core
  if (/^6/.test(s)) return '6';
  if (/^5/.test(s)) return '5';
  if (/^sus2/.test(s)) return 'sus2';
  if (/^sus/.test(s)) return 'sus4';
  if (/^\(?add9/.test(s)) return 'add9';
  return null;
}

function movableShape(rootPc, quality) {
  const cands = [];
  if (MOVABLE.E.q[quality]) cands.push({ f: (rootPc - MOVABLE.E.ref + 12) % 12, pat: MOVABLE.E.q[quality] });
  if (MOVABLE.A.q[quality]) cands.push({ f: (rootPc - MOVABLE.A.ref + 12) % 12, pat: MOVABLE.A.q[quality] });
  if (!cands.length) return null;
  cands.sort((a, b) => a.f - b.f); // lower on the neck is easier
  const c = cands[0];
  return c.pat.map((v) => (v < 0 ? -1 : v + c.f));
}

// The plain (no-bass) shape for a parsed chord: named bank first, then barres.
function plainShape(root, acc, suffix, pc) {
  const spellings = [root + acc + suffix, SHARP[pc] + suffix];
  for (const key of spellings) {
    if (OPEN_CHORDS[key]) return OPEN_CHORDS[key];
  }
  const quality = parseQuality(suffix);
  if (!quality) return null;
  return movableShape(pc, quality);
}

// Regraft a shape so the slash bass is its lowest note: try putting the bass
// on the 6th, 5th or 4th string within reach of the remaining fingers, muting
// anything below it. Candidates that lose a chord tone are rejected; ties are
// settled toward open bass strings and tight fret spans. This derives the
// standard shapes (D/F# 2x0232, G/B x20033-family, C/G 3x2010, Am/G 3x2210,
// C/B x22010, G/D xx0003 …) instead of keeping a hand-written slash bank.
function graftBass(frets, bassPc) {
  const plainPcs = new Set();
  frets.forEach((f, i) => { if (f >= 0) plainPcs.add((STRING_ABS[i] + f) % 12); });
  let best = null;
  for (let s = 0; s <= 2; s++) {
    const rest = frets.slice(s + 1).filter((f) => f > 0);
    const lo = rest.length ? Math.min(...rest) : 0;
    const hi = rest.length ? Math.max(...rest) : 0;
    for (let f = 0; f <= 15; f++) {
      if ((STRING_ABS[s] + f) % 12 !== bassPc) continue;
      if (f !== 0 && (f < lo - 2 || f > (rest.length ? hi + 2 : 3))) continue;
      const out = frets.slice();
      for (let k = 0; k < s; k++) out[k] = -1;
      out[s] = f;
      const notes = [];
      const pcs = new Set();
      out.forEach((fr, i) => { if (fr >= 0) { notes.push(STRING_ABS[i] + fr); pcs.add((STRING_ABS[i] + fr) % 12); } });
      if (Math.min(...notes) !== STRING_ABS[s] + f) continue;      // bass must be lowest
      if ([...plainPcs].some((p) => !pcs.has(p))) continue;        // keep every chord tone
      const fr = out.filter((x) => x > 0);
      const span = fr.length ? Math.max(...fr) - Math.min(...fr) : 0;
      if (span > 4) continue;
      const score = (f > 0 ? 10 : 0) + span * 2 + s;
      if (!best || score < best.score) best = { out, score };
    }
  }
  return best ? best.out : null;
}

// Resolve a chord name (e.g. "F#m7", "Cadd9", "D/F#") to a fret array, or null.
// Slash chords get the named bass grafted in as the lowest note; if no playable
// graft exists the plain shape is the fallback.
function resolveChord(name) {
  const m = name.match(CHORD_RE);
  if (!m) return null;
  const [, root, acc, suffix, bass, bacc] = m;
  const pc = chordRootPc(root, acc);
  const shape = plainShape(root, acc, suffix, pc);
  if (!bass || !shape) return shape;
  const bassPc = chordRootPc(bass, bacc || '');
  const notes = [];
  shape.forEach((f, i) => { if (f >= 0) notes.push(STRING_ABS[i] + f); });
  if (Math.min(...notes) % 12 === bassPc) return shape; // already voiced that way
  return graftBass(shape, bassPc) || shape;
}

// Build a small SVG fretboard diagram for a chord. `soundingName`, when given,
// is shown beneath as what the shape sounds as with a capo (e.g. "sounds A").
// `extra` is appended inside the block (used for the voicing dropdown).
// A 6-string guitar chord diagram (thin wrapper over the shared renderer).
function chordDiagramSVG(displayName, frets, soundingName, extra) {
  return fretDiagramSVG(displayName, frets, 6, soundingName, extra, '');
}

// ---- Scales ----------------------------------------------------------------

const SCALES = [
  { id: 'majPent', name: 'Major pentatonic', iv: [0, 2, 4, 7, 9] },
  { id: 'minPent', name: 'Minor pentatonic', iv: [0, 3, 5, 7, 10] },
  { id: 'blues', name: 'Blues (minor)', iv: [0, 3, 5, 6, 7, 10] },
  { id: 'major', name: 'Major (Ionian)', iv: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'minor', name: 'Minor (Aeolian)', iv: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'dorian', name: 'Dorian', iv: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'mixo', name: 'Mixolydian', iv: [0, 2, 4, 5, 7, 9, 10] },
];
function scaleById(id) { return SCALES.find((s) => s.id === id) || SCALES[0]; }

// Intervals that make up each chord quality, for highlighting chord tones.
const QUALITY_IV = {
  'major': [0, 4, 7], 'm': [0, 3, 7], '7': [0, 4, 7, 10], 'm7': [0, 3, 7, 10],
  'maj7': [0, 4, 7, 11], '6': [0, 4, 7, 9], 'm6': [0, 3, 7, 9],
  'sus2': [0, 2, 7], 'sus4': [0, 5, 7], '7sus4': [0, 5, 7, 10],
  'dim': [0, 3, 6], 'dim7': [0, 3, 6, 9], 'm7b5': [0, 3, 6, 10], 'aug': [0, 4, 8],
  '9': [0, 2, 4, 7, 10], 'm9': [0, 2, 3, 7, 10], 'maj9': [0, 2, 4, 7, 11],
  'add9': [0, 2, 4, 7], 'madd9': [0, 2, 3, 7], '5': [0, 7],
};

// Interval degree labels by semitone distance from the chord root.
const INTERVAL_LABELS = {
  0: 'R', 1: 'b2', 2: '2', 3: 'b3', 4: '3', 5: '4',
  6: 'b5', 7: '5', 8: '#5', 9: '6', 10: 'b7', 11: '7',
};

// A chord's root pitch class + its interval list (from the root) + the slash
// bass pitch class (null when the name has no slash), or null if unparsable.
function chordIntervals(name) {
  const m = name.match(CHORD_RE);
  if (!m) return null;
  const [, root, acc, suffix, bass, bacc] = m;
  const iv = QUALITY_IV[parseQuality(suffix)] || [0, 4, 7]; // reasonable default
  return {
    rootPc: chordRootPc(root, acc),
    iv,
    bassPc: bass ? chordRootPc(bass, bacc || '') : null,
  };
}

// Map of pitch class -> interval label for a chord name (R/3/5/7 …), or null.
// A slash bass outside the chord tones is included with its own degree label.
function chordToneLabels(name) {
  const ci = chordIntervals(name);
  if (!ci) return null;
  const map = new Map();
  for (const i of ci.iv) map.set((ci.rootPc + i) % 12, INTERVAL_LABELS[i] || '');
  if (ci.bassPc !== null && !map.has(ci.bassPc)) {
    map.set(ci.bassPc, INTERVAL_LABELS[(ci.bassPc - ci.rootPc + 12) % 12] || '');
  }
  return map;
}

// A full-neck scale map: 6 strings x `FR` frets, scale tones dotted, root
// filled. Low E is the bottom row; the nut is at the left. When `highlight`
// (a Map of pitch class -> interval label) is given, those chord tones get a
// ring with the interval label (R/3/5/7 …); chord tones that fall outside the
// scale are drawn as hollow labelled markers so the whole chord is visible.
// `opts.onWire` puts each note on its fret line instead of behind it — where a
// lap steel's bar goes. `opts.ruler` adds rows under the fret numbers, one cell
// per fret 0..15: text cells [{ text, hi }, …] or a row of position glyphs
// [{ shapes: [kind…] }, …]. `opts.shapeAt(fret)` names the shape(s) a fret's
// notes take — the lap steel's positions — instead of the plain circle; a
// second kind is drawn as an outline round the first.
function scaleDiagramSVG(rootPc, intervals, highlight, tuning = STRING_ABS, opts = {}) {
  const set = new Set(intervals.map((i) => (rootPc + i) % 12));
  const hi = highlight && highlight.size ? highlight : null;
  const N = tuning.length;
  // `gutter` widens the left margin: room for the string names and for the
  // names of the triad rows (`grips`) drawn under the ruler.
  const FR = 15, left = 26 + (opts.gutter || 0), top = 14, rowH = 18, colW = 30, rulerH = 11;
  const ruler = opts.ruler || [];
  const grips = opts.grips || [];
  const gGap = 5.6, gPad = 6, gH = (N - 1) * gGap + 2 * gPad;
  const shapeAt = opts.shapeAt || (() => ['circle']);
  const mark = (f, cx, cy, cls, r) => {
    const kinds = shapeAt(f);
    let m = markShape(kinds[0], cx, cy, r, `class="${cls}"`);
    if (kinds[1]) m += markShape(kinds[1], cx, cy, 1.12 * r, `class="${cls} sc-second"`);
    return m;
  };
  const width = left + FR * colW + 12;
  const numY = top + (N - 1) * rowH + 16;
  const gripTop = numY + 8 + ruler.length * rulerH + (grips.length ? 8 : 0);
  const height = gripTop + grips.length * gH;
  const x = (f) => left + f * colW;
  const y = (i) => top + (N - 1 - i) * rowH; // string 0 (lowest) at the bottom
  // Where fret f's note is drawn: behind the fret for fingers, on it for a bar.
  const at = (f) => (f === 0 ? left - 12 : opts.onWire ? x(f) : x(f) - colW / 2);
  const markers = [3, 5, 7, 9, 12, 15];

  let p = '';
  for (let i = 0; i < N; i++) p += `<line class="sc-string" x1="${x(0)}" y1="${y(i)}" x2="${x(FR)}" y2="${y(i)}"/>`;
  for (let f = 0; f <= FR; f++) {
    const cls = f === 0 ? 'sc-nut' : 'sc-fret';
    p += `<line class="${cls}" x1="${x(f)}" y1="${y(N - 1)}" x2="${x(f)}" y2="${y(0)}"/>`;
  }
  for (const f of markers) p += `<text class="sc-fretnum" x="${at(f)}" y="${numY}" text-anchor="middle">${f}</text>`;
  if (opts.stringNames) opts.stringNames.forEach((nm, i) => { p += `<text class="sc-strname" x="2" y="${y(i)}" dominant-baseline="central">${escapeHtml(nm)}</text>`; });
  ruler.forEach((row, r) => row.forEach((cell, f) => {
    if (!cell || f > FR) return;
    const rowY = numY + (r + 1) * rulerH;
    if (cell.shapes) {
      // Two glyphs sit side by side where a fret belongs to two positions.
      cell.shapes.forEach((kind, k) => { p += markShape(kind, at(f) + (k - (cell.shapes.length - 1) / 2) * 9, rowY - 3.5, 3.2, 'class="sc-pos"'); });
    } else if (cell.text) {
      p += `<text class="${cell.hi ? 'sc-bar sc-bar-hi' : 'sc-bar'}" x="${at(f)}" y="${rowY}" text-anchor="middle">${escapeHtml(cell.text)}</text>`;
    }
  }));

  for (let i = 0; i < N; i++) {
    for (let f = 0; f <= FR; f++) {
      const pc = (tuning[i] + f) % 12;
      const cx = at(f);
      const cy = y(i);
      const inScale = set.has(pc);
      const isChordTone = hi && hi.has(pc);
      if (inScale && isChordTone) {
        p += mark(f, cx, cy, `${pc === rootPc ? 'sc-root' : 'sc-note'} sc-hi`, 7);
        p += `<text class="sc-label" x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central">${hi.get(pc)}</text>`;
      } else if (inScale) {
        p += mark(f, cx, cy, pc === rootPc ? 'sc-root' : 'sc-note', pc === rootPc ? 6 : 5);
      } else if (isChordTone) {
        p += mark(f, cx, cy, 'sc-chordonly', 7);
        p += `<text class="sc-label-open" x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central">${hi.get(pc)}</text>`;
      }
    }
  }
  // Triad rows: one small neck per chord, high string on top as above, with
  // each grip a stroke across the strings it takes at the fret it's played
  // on — a dot per string to pick (solid for the root), and where the stroke
  // passes a string without a dot, that string is skipped. A fret with several
  // grips spreads them side by side, lowest strings first, with the fret
  // number beside them so it reads without a trip back up to the ruler.
  grips.forEach((row, r) => {
    const rt = gripTop + r * gH, sy = (i) => rt + gPad + (N - 1 - i) * gGap;
    let g = `<rect class="sc-grip-band${r % 2 ? ' odd' : ''}" x="0" y="${rt}" width="${width}" height="${gH}"/>`;
    for (let i = 0; i < N; i++) g += `<line class="sc-grip-string" x1="${x(0)}" y1="${sy(i)}" x2="${x(FR)}" y2="${sy(i)}"/>`;
    g += `<line class="sc-grip-nut" x1="${x(0)}" y1="${sy(N - 1)}" x2="${x(0)}" y2="${sy(0)}"/>`;
    const long = row.label.length > 5 ? ` textLength="${left - 16}" lengthAdjust="spacingAndGlyphs"` : '';
    g += `<text class="sc-grip-name"${row.focus ? ` data-chord="${escapeHtml(row.focus)}"` : ''} x="2" y="${rt + gH / 2}" dominant-baseline="central"${long}>` +
      `${escapeHtml(row.label)}${row.title ? `<title>${escapeHtml(row.title)}</title>` : ''}</text>`;
    if (!row.grips.length) {
      g += `<text class="sc-grip-none" x="${x(0) + 8}" y="${rt + gH / 2}" dominant-baseline="central">no straight-bar triad in this tuning</text>`;
    }
    const byFret = new Map();
    for (const gr of row.grips) if (gr.fret <= FR) byFret.set(gr.fret, (byFret.get(gr.fret) || []).concat([gr]));
    for (const [f, list] of byFret) {
      const lane = Math.min(7.5, 22 / list.length), half = (list.length - 1) / 2 * lane;
      list.forEach((gr, k) => {
        const gx = at(f) + (k - (list.length - 1) / 2) * lane;
        g += `<line class="sc-grip" x1="${gx}" y1="${sy(gr.strings[0])}" x2="${gx}" y2="${sy(gr.strings[2])}"/>`;
        gr.strings.forEach((si, j) => {
          g += `<circle class="${gr.roles[j] === 'R' ? 'sc-grip-root' : 'sc-grip-dot'}" cx="${gx}" cy="${sy(si)}" r="2.4"/>`;
        });
      });
      if (f > 0) {
        const right = f < FR;
        g += `<text class="sc-grip-fret" x="${at(f) + (right ? half + 5 : -half - 5)}" y="${rt + gH / 2}" ` +
          `text-anchor="${right ? 'start' : 'end'}" dominant-baseline="central">${f}</text>`;
      }
    }
    p += `<g class="sc-grip-row${row.on ? ' on' : ''}">${g}</g>`;
  });

  const cls = 'scale-svg' + (hi ? ' has-hi' : '') + (grips.some((row) => row.on) ? ' grip-focus' : '');
  return `<svg class="${cls}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMinYMin meet">${p}</svg>`;
}

// ---- Piano diagrams --------------------------------------------------------

const PIANO_WHITE = [0, 2, 4, 5, 7, 9, 11];        // pitch classes of white keys C..B
const PIANO_BLACK = [                               // black keys: pc + white key it follows
  { pc: 1, after: 0 }, { pc: 3, after: 1 },
  { pc: 6, after: 3 }, { pc: 8, after: 4 }, { pc: 10, after: 5 },
];
const PK = { ww: 12, wh: 46, bw: 8, bh: 28 };

function pkCls(fill) {
  return fill === 'root' ? 'pk-root' : fill === 'hi' ? 'pk-hi' : fill === 'scale' ? 'pk-scale' : '';
}

// A piano keyboard of `octaves` octaves. `style(abs)` — called per key with its
// absolute semitone (0..octaves*12-1) — returns { fill, label, bass }: fill is
// 'plain' | 'hi' | 'root' | 'scale'; bass draws a marker under the key (used to
// show the chord inversion's lowest note). `extraCls` adds an SVG class.
function pianoKeyboardSVG(octaves, style, extraCls) {
  const width = octaves * 7 * PK.ww + 2;
  let p = '';
  const bassX = [];
  for (let o = 0; o < octaves; o++) {
    for (let i = 0; i < 7; i++) {
      const abs = o * 12 + PIANO_WHITE[i];
      const kx = (o * 7 + i) * PK.ww + 1;
      const st = style(abs);
      p += `<rect class="pk-white ${pkCls(st.fill)}" x="${kx}" y="1" width="${PK.ww}" height="${PK.wh}" rx="1"/>`;
      if (st.label) p += `<text class="pk-label" x="${kx + PK.ww / 2}" y="${PK.wh - 4}" text-anchor="middle">${st.label}</text>`;
      if (st.bass) bassX.push(kx + PK.ww / 2);
    }
  }
  for (let o = 0; o < octaves; o++) {
    for (const b of PIANO_BLACK) {
      const abs = o * 12 + b.pc;
      const kx = (o * 7 + b.after + 1) * PK.ww - PK.bw / 2 + 1;
      const st = style(abs);
      p += `<rect class="pk-black ${pkCls(st.fill)}" x="${kx}" y="1" width="${PK.bw}" height="${PK.bh}" rx="1"/>`;
      if (st.label) p += `<text class="pk-label pk-label-b" x="${kx + PK.bw / 2}" y="${PK.bh - 3}" text-anchor="middle">${st.label}</text>`;
      if (st.bass) bassX.push(kx + PK.bw / 2);
    }
  }
  const markerH = bassX.length ? 8 : 0;
  const height = PK.wh + 2 + markerH;
  const y0 = PK.wh + 2;
  for (const bx of bassX) {
    p += `<path class="pk-bass" d="M ${bx - 3} ${y0 + markerH} L ${bx + 3} ${y0 + markerH} L ${bx} ${y0 + 1} Z"/>`;
  }
  return `<svg class="piano-svg${extraCls ? ' ' + extraCls : ''}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${p}</svg>`;
}

// Two-octave keyboard showing a chord voicing for the given inversion: the notes
// are stacked from the bass up, so different inversions light up different keys.
// Root emphasized; keys labelled with interval degrees (R/3/5/7 …).
function pianoChordSVG(displayName, inv, soundingName, extra) {
  const ci = chordIntervals(displayName);
  const sub = soundingName && soundingName !== displayName
    ? `<div class="cd-sound">sounds ${escapeHtml(soundingName)}</div>` : '';
  const tail = sub + (extra || '');
  const head = `<div class="cd-name" data-chord="${escapeHtml(displayName)}">${escapeHtml(displayName)}</div>`;
  if (!ci) return `<div class="chord-diagram piano-diagram">${head}<div class="cd-na">notes n/a</div>${tail}</div>`;
  const n = ci.iv.length;
  const invI = ((inv || 0) % n + n) % n;
  // Rotate so the inversion's bass tone comes first, then stack ascending.
  const order = ci.iv.slice(invI).concat(ci.iv.slice(0, invI));
  let positions = new Map(); // absolute semitone -> { label, root, bass }
  let prev = -1;
  for (const t of order) {
    let abs = (ci.rootPc + t) % 12;
    while (abs <= prev) abs += 12;
    positions.set(abs, { label: INTERVAL_LABELS[t] || '', root: t === 0 });
    prev = abs;
  }
  // A slash bass outside the chord tones sits below the stack (shifting the
  // stack up an octave if needed, as long as it still fits the two octaves).
  const bassIsExtra = ci.bassPc !== null && !ci.iv.some((t) => (ci.rootPc + t) % 12 === ci.bassPc);
  if (bassIsExtra) {
    const keys = [...positions.keys()];
    const shift = ci.bassPc >= keys[0] ? 12 : 0;
    if (keys[keys.length - 1] + shift <= 23) {
      const shifted = new Map([[ci.bassPc, { label: INTERVAL_LABELS[(ci.bassPc - ci.rootPc + 12) % 12] || '', root: false, bass: true }]]);
      for (const [abs, info] of positions) shifted.set(abs + shift, info);
      positions = shifted;
    }
  } else if (ci.bassPc !== null) {
    // Mark the bottom key when the chosen inversion really puts the named
    // bass there (the inversion dropdown can override it).
    const [firstAbs, firstInfo] = positions.entries().next().value;
    if (firstAbs % 12 === ci.bassPc) firstInfo.bass = true;
  }
  const svg = pianoKeyboardSVG(2, (abs) => {
    const info = positions.get(abs);
    return info ? { fill: info.root ? 'root' : 'hi', label: info.label, bass: info.bass } : { fill: 'plain', label: '' };
  });
  return `<div class="chord-diagram piano-diagram">${head}${svg}${tail}</div>`;
}

// Two-octave keyboard scale roll: scale tones teal, root orange; when a chord is
// focused, its tones are gold with interval labels (like the guitar scale map).
function pianoScaleSVG(rootPc, intervals, highlight) {
  const set = new Set(intervals.map((i) => (rootPc + i) % 12));
  const hi = highlight && highlight.size ? highlight : null;
  return pianoKeyboardSVG(3, (abs) => {
    const pc = abs % 12;
    if (hi && hi.has(pc)) return { fill: pc === rootPc ? 'root' : 'hi', label: hi.get(pc) };
    if (set.has(pc)) return { fill: pc === rootPc ? 'root' : 'scale', label: '' };
    return { fill: 'plain', label: '' };
  }, 'piano-scale');
}

// ---- Other fretted instruments (ukulele, mandolin, bass) -------------------
// Absolute semitone tunings, low string first (drawn left→right).
const UKE_ABS = [55, 48, 52, 57];        // reentrant gCEA
const MANDO_ABS = [55, 62, 69, 76];      // GDAE, tuned in fifths (4 courses)
const BASS_ABS = [40, 45, 50, 55];       // EADG (used for the bass scale map)

// Best playable voicing (frets per string, low→high) that covers every chord
// tone with the root present, low on the neck. Parameterized by tuning + reach,
// so it serves ukulele, mandolin, and any other fretted instrument. null if no
// shape is within reach.
function fretVoicing(name, tuning, maxF) {
  const labels = chordToneLabels(name);
  const m = name.match(CHORD_RE);
  if (!labels || !m) return null;
  const rootPc = chordRootPc(m[1], m[2]);
  let chordPcs = [...labels.keys()];
  // More tones than strings (9th chords, slash basses): omit the 5th — the
  // conventional sacrifice — so the defining tones all fit.
  if (chordPcs.length > tuning.length) chordPcs = chordPcs.filter((pc) => pc !== (rootPc + 7) % 12);
  if (chordPcs.length > tuning.length) return null;
  const chordSet = new Set(chordPcs);
  const N = tuning.length;
  const cands = tuning.map((abs) => {
    const list = [];
    for (let f = 0; f <= maxF; f++) if (chordSet.has((abs + f) % 12)) list.push(f);
    return list;
  });
  if (cands.some((c) => !c.length)) return null;
  let best = null;
  const frets = new Array(N).fill(0);
  function rec(i) {
    if (i === N) {
      const pcs = new Set(frets.map((f, s) => (tuning[s] + f) % 12));
      if (!pcs.has(rootPc)) return;
      for (const t of chordPcs) if (!pcs.has(t)) return;
      const fr = frets.filter((f) => f > 0);
      const span = fr.length ? Math.max(...fr) - Math.min(...fr) : 0;
      const maxf = fr.length ? Math.max(...fr) : 0;
      const opens = frets.filter((f) => f === 0).length;
      const score = maxf * 10 + span * 6 - opens * 2;
      if (!best || score < best.score) best = { frets: frets.slice(), score };
      return;
    }
    for (const f of cands[i]) { frets[i] = f; rec(i + 1); }
  }
  rec(0);
  return best ? best.frets : null;
}
function ukeVoicing(name) { return fretVoicing(name, UKE_ABS, 5); }
function mandoVoicing(name) { return fretVoicing(name, MANDO_ABS, 7); }

// A fretboard chord diagram for any number of strings. `cls` adds a modifier
// class (e.g. 'uke-diagram') so per-instrument styling still applies.
function fretDiagramSVG(displayName, frets, nStrings, soundingName, extra, cls) {
  const sub = soundingName && soundingName !== displayName
    ? `<div class="cd-sound">sounds ${escapeHtml(soundingName)}</div>` : '';
  const tail = sub + (extra || '');
  const dcls = 'chord-diagram' + (cls ? ' ' + cls : '');
  const head = `<div class="cd-name" data-chord="${escapeHtml(displayName)}">${escapeHtml(displayName)}</div>`;
  if (!frets) return `<div class="${dcls}">${head}<div class="cd-na">shape n/a</div>${tail}</div>`;
  const S = nStrings, rows = 4, cellW = 9, cellH = 12, left = 17, top = 18;
  const fretted = frets.filter((f) => f > 0);
  const maxF = fretted.length ? Math.max(...fretted) : 0;
  const minF = fretted.length ? Math.min(...fretted) : 0;
  const base = maxF > 4 ? minF : 1;
  const width = left * 2 + (S - 1) * cellW;
  const height = top + rows * cellH + 4;
  const x = (i) => left + i * cellW;
  const y = (k) => top + k * cellH;
  let p = '';
  for (let k = 0; k <= rows; k++) p += `<line x1="${x(0)}" y1="${y(k)}" x2="${x(S - 1)}" y2="${y(k)}"/>`;
  for (let i = 0; i < S; i++) p += `<line x1="${x(i)}" y1="${y(0)}" x2="${x(i)}" y2="${y(rows)}"/>`;
  if (base === 1) p += `<rect class="cd-nut" x="${x(0) - 1}" y="${top - 3}" width="${(S - 1) * cellW + 2}" height="3"/>`;
  else p += `<text class="cd-fretnum" x="0" y="${y(0) + cellH - 1}" text-anchor="start">${base}fr</text>`;
  for (let i = 0; i < S; i++) {
    const f = frets[i], cx = x(i);
    if (f < 0) p += `<text class="cd-mark" x="${cx}" y="${top - 5}" text-anchor="middle">&#215;</text>`;
    else if (f === 0) p += `<text class="cd-mark" x="${cx}" y="${top - 5}" text-anchor="middle">&#9675;</text>`;
    else { const cy = y(f - base) + cellH / 2; p += `<circle class="cd-dot" cx="${cx}" cy="${cy}" r="3.4"/>`; }
  }
  return `<div class="${dcls}">${head}<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${p}</svg>${tail}</div>`;
}
// A 4-string ukulele fretboard diagram (same visual style as the guitar one).
function ukeDiagramSVG(displayName, frets, soundingName, extra) {
  return fretDiagramSVG(displayName, frets, 4, soundingName, extra, 'uke-diagram');
}
function mandoDiagramSVG(displayName, frets, soundingName, extra) {
  return fretDiagramSVG(displayName, frets, 4, soundingName, extra, 'mando-diagram');
}

// ---- Lap steel -------------------------------------------------------------
// Nothing is fretted on a lap steel: a bar laid straight across the strings
// stops every one of them at the same fret, and the chord is whichever strings
// you pick there. So a chord shape is a bar position plus a grip, and what a
// position gives depends entirely on the tuning. Slants are left to the player
// — a straight bar covers what a chart needs, and when a tuning can't give the
// whole chord that way, the grip says which tones it leaves out.

// An octave of bar positions reaches every chord; open-string ones come round
// again at 12.
const LAP_FRETS = 12;

// What leaving a tone out costs a grip. The root is required outright; the 3rd
// (or a sus tone standing in for it) is what makes the chord what it is; 7ths,
// 6ths, 9ths and altered 5ths come next; a plain 5th matters least. Frets cost
// half a point each: the bar slides anywhere, so height only breaks ties, and
// a whole chord up the neck beats a partial one at the nut.
const LAP_FRET_COST = 0.5;
function lapOmitCost(t) {
  if (t === 7) return 8;
  if (t === 3 || t === 4) return 40;
  return 25;
}

// Every straight-bar grip for a chord in a tuning (absolute semitones, low
// string first), best first: [{ fret, frets, omit }]. `frets` is the per-string
// array the diagrams take (-1 = leave it unpicked); `omit` names the chord
// tones the grip goes without ('b7', '5', 'E bass' …).
function lapVoicings(name, tuning) {
  const ci = chordIntervals(name);
  if (!ci) return [];
  const tones = new Set(ci.iv.map((t) => (ci.rootPc + t) % 12));
  const slash = ci.bassPc !== null;
  if (slash) tones.add(ci.bassPc);
  const bassName = slash ? name.slice(name.lastIndexOf('/') + 1) : '';
  const out = [];
  for (let f = 0; f <= LAP_FRETS; f++) {
    const pcs = tuning.map((abs) => (abs + f) % 12);
    const all = pcs.map((pc) => (tones.has(pc) ? f : -1));
    // A slash chord wants its bass at the bottom, so nothing under the lowest
    // string that sounds it gets picked — unless that leaves no chord, in which
    // case the whole grip stands and the bass goes unmet.
    let frets = all, bassOk = !slash;
    if (slash) {
      const lo = pcs.findIndex((pc, i) => all[i] >= 0 && pc === ci.bassPc);
      if (lo >= 0) {
        const trimmed = all.map((x, i) => (i < lo ? -1 : x));
        const kept = pcs.filter((pc, i) => trimmed[i] >= 0);
        if (kept.length >= 2 && kept.includes(ci.rootPc)) { frets = trimmed; bassOk = true; }
      }
    }
    const picked = pcs.filter((pc, i) => frets[i] >= 0);
    // Two different notes at least: the root in two octaves isn't a chord.
    if (new Set(picked).size < 2 || !picked.includes(ci.rootPc)) continue;
    const omitted = ci.iv.filter((t) => !picked.includes((ci.rootPc + t) % 12));
    let score = f * LAP_FRET_COST + omitted.reduce((sum, t) => sum + lapOmitCost(t), 0);
    if (!bassOk) score += 20;
    if (picked.length < 3) score += 6;              // a bare two-string dyad
    if (!slash && picked[0] !== ci.rootPc) score += 2; // root not on the bottom
    const omit = omitted.map((t) => INTERVAL_LABELS[t]);
    if (!bassOk) omit.push(`${bassName} bass`);
    out.push({ fret: f, frets, omit, score });
  }
  return out.sort((a, b) => a.score - b.score || a.fret - b.fret);
}

// Minor chords read better with these spellings (G#m, Bbm) than the key names.
const MINOR_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
function isMinorChord(ci) { return ci.iv.includes(3) && !ci.iv.includes(4); }

// The chord a tuning's straight-bar chord `bar` becomes with the bar at fret f.
function lapBarNameAt(bar, f) {
  const ci = chordIntervals(bar);
  return (isMinorChord(ci) ? MINOR_NAMES : HARP_NAMES)[(ci.rootPc + f) % 12] + bar.match(CHORD_RE)[3];
}

// ---- Positions ------------------------------------------------------------
// A guitarist learns a scale in the five CAGED positions, each built round a
// chord shape. A lap steel has one chord shape — the bar — so its positions
// are the frets where a straight bar gives a chord of the key: I, IV and V,
// with the relative minors alongside them in a 6th tuning. Every fret belongs
// to the nearest of those bars; one midway between two belongs to both.
const LAP_SHAPES = ['circle', 'square', 'diamond', 'hexagon', 'triangle', 'tridown'];
const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

// The seven-note scale a pentatonic or blues scale is carved from, which is
// what decides whether a chord is in the key.
function lapParentIv(scale) {
  if (scale.iv.length >= 7) return scale.iv;
  return scale.iv.includes(3) ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
}

// How a chord ranks by its root's distance above the key's: I, then IV, then
// V, then — for a minor key in a tuning with only a major bar — the relative
// major's I, IV and V, then the rest.
const LAP_RANK = { 0: 0, 5: 1, 7: 2, 3: 3, 8: 4, 10: 5 };
function lapRank(iv) { return iv in LAP_RANK ? LAP_RANK[iv] : 6 + iv; }

// { list: [{ shape, chords, numerals, frets }], at: (fret) => [index…] } for
// a tuning's straight-bar chords `bars` in a key, or null when the scale has
// no key to speak of. `at` gives the position(s) a fret belongs to, nearest
// first by rank.
function lapPositions(bars, rootPc, scale, lastFret) {
  if (!bars || !bars.length || scale.iv.length > 7) return null;
  const parent = lapParentIv(scale);
  const inKey = new Set(parent.map((i) => (rootPc + i) % 12));
  // A bar chord is in the key where its root, 3rd and 5th all are — the 7th
  // of an E7 bar is left out of it, as a player leaves that string out.
  const byFret = new Map();
  for (const bar of bars) {
    const ci = chordIntervals(bar);
    const triad = ci.iv.filter((t) => t === 0 || t === 3 || t === 4 || t === 7);
    for (let f = 0; f <= lastFret; f++) {
      if (!triad.every((t) => inKey.has((ci.rootPc + t + f) % 12))) continue;
      if (!byFret.has(f)) byFret.set(f, []);
      byFret.get(f).push(bar);
    }
  }
  if (!byFret.size) return null;
  // One position per chord, an octave apart, ranked (see lapRank); the rank
  // hands out the shapes.
  const rank = lapRank;
  const classes = new Map();
  for (const [f, list] of [...byFret].sort((a, b) => a[0] - b[0])) {
    const k = f % 12;
    if (!classes.has(k)) {
      const facts = list.map((bar) => {
        const ci = chordIntervals(bar);
        const iv = (ci.rootPc + f - rootPc + 12) % 12;
        const n = NUMERALS[parent.indexOf(iv)];
        return { name: lapBarNameAt(bar, f), numeral: isMinorChord(ci) ? n.toLowerCase() : n, rank: rank(iv) };
      }).sort((a, b) => a.rank - b.rank);
      classes.set(k, { frets: [], chords: facts.map((x) => x.name), numerals: facts.map((x) => x.numeral), rank: facts[0].rank });
    }
    classes.get(k).frets.push(f);
  }
  const list = [...classes.values()].sort((a, b) => a.rank - b.rank || a.frets[0] - b.frets[0]);
  list.forEach((pos, i) => { pos.shape = LAP_SHAPES[i % LAP_SHAPES.length]; });
  const anchors = [];
  list.forEach((pos, i) => pos.frets.forEach((f) => anchors.push({ f, i })));
  const at = (f) => {
    let best = Infinity, out = [];
    for (const a of anchors) {
      const dist = Math.abs(a.f - f);
      if (dist < best) { best = dist; out = [a.i]; } else if (dist === best && !out.includes(a.i)) out.push(a.i);
    }
    return out.sort((a, b) => a - b);
  };
  return { list, at };
}

// ---- Triads on a straight bar ---------------------------------------------
// A bar can't finger a chord, but it can give a triad: three strings at one
// fret that spell a chord's root, 3rd and 5th once each. The string sets that
// do it belong to the tuning and repeat at every fret, so each chord gets a
// few grips — its inversions — an octave apart. That's the map for playing
// triads over a progression: where every chord is, and on which strings.
const LAP_TRIAD_SPAN = 3; // a grip reaches across four strings at most
const TRIAD_SUFFIX = { major: '', m: 'm', dim: '°', aug: '+', sus4: 'sus4', sus2: 'sus2' };

// The triad a chord comes down to: { rootPc, quality, tones, label }. 7ths,
// 6ths and added tones drop away; a power chord has no 3rd to make one.
function chordTriad(name) {
  const ci = chordIntervals(name);
  const m = name.match(CHORD_RE);
  if (!ci || !m) return null;
  const has = (t) => ci.iv.includes(t);
  let quality;
  if (has(4)) quality = has(8) && !has(7) ? 'aug' : 'major';
  else if (has(3)) quality = has(6) && !has(7) ? 'dim' : 'm';
  else if (has(5)) quality = 'sus4';
  else if (has(2)) quality = 'sus2';
  else return null;
  return { rootPc: ci.rootPc, quality, tones: TRIAD_TONES[quality], label: m[1] + m[2] + TRIAD_SUFFIX[quality] };
}

// Every straight-bar grip for a triad in a tuning (absolute semitones, low
// string first) from the nut to lastFret: [{ fret, strings: [lo, mid, hi],
// roles }], fret by fret, lowest strings first. `roles` is the chord tone each
// string sounds: 'R', '3' or '5' (a b3, b5, #5 or sus tone counts as the 3rd
// or 5th it stands in for).
function lapTriadGrips(triad, tuning, lastFret) {
  const N = tuning.length, out = [];
  const role = (pc) => ['R', '3', '5'][triad.tones.findIndex((t) => (triad.rootPc + t) % 12 === pc)];
  for (let f = 0; f <= lastFret; f++) {
    const pcs = tuning.map((abs) => (abs + f) % 12);
    for (let a = 0; a < N; a++) {
      for (let b = a + 1; b < N; b++) {
        for (let c = b + 1; c < N && c - a <= LAP_TRIAD_SPAN; c++) {
          const trio = [pcs[a], pcs[b], pcs[c]];
          if (new Set(trio).size < 3 || !trio.every((pc) => role(pc))) continue;
          out.push({ fret: f, strings: [a, b, c], roles: trio.map(role) });
        }
      }
    }
  }
  return out;
}

// A key's triads, one per degree of the seven-note scale behind `scale` (so a
// pentatonic still gets its IV and V): [{ label, numeral, triad }], or null
// when the scale has no key to speak of. `nameOf(pc)` spells a root.
function keyTriads(rootPc, scale, nameOf) {
  if (scale.iv.length > 7) return null;
  const parent = lapParentIv(scale);
  const out = [];
  parent.forEach((iv, d) => {
    const third = (parent[(d + 2) % 7] - iv + 12) % 12, fifth = (parent[(d + 4) % 7] - iv + 12) % 12;
    const quality = ['major', 'm', 'dim', 'aug'].find((q) => TRIAD_TONES[q][1] === third && TRIAD_TONES[q][2] === fifth);
    if (!quality) return;
    const pc = (rootPc + iv) % 12, n = NUMERALS[d];
    out.push({
      label: nameOf(pc) + TRIAD_SUFFIX[quality],
      numeral: quality === 'major' ? n : quality === 'aug' ? n + '+' : n.toLowerCase() + (quality === 'dim' ? '°' : ''),
      triad: { rootPc: pc, quality, tones: TRIAD_TONES[quality], label: nameOf(pc) + TRIAD_SUFFIX[quality] },
    });
  });
  return out;
}

// The key's triads that a tuning can bar, each with its grips from the nut to
// lastFret: [{ label, numeral, triad, grips }], or null for none.
function lapKeyTriads(tuning, rootPc, scale, lastFret, nameOf) {
  const out = (keyTriads(rootPc, scale, nameOf) || [])
    .map((k) => Object.assign(k, { grips: lapTriadGrips(k.triad, tuning, lastFret) }))
    .filter((k) => k.grips.length);
  return out.length ? out : null;
}

// The narrowest stretches of neck, [[from, to]…], holding a grip of every
// triad in `rows` (each { grips }) — where a whole progression can be played
// with the bar hardly travelling. Triads with no grip are left out of it.
function lapTriadZones(rows) {
  const sets = rows.map((r) => [...new Set(r.grips.map((g) => g.fret))]).filter((s) => s.length);
  if (sets.length < 2) return [];
  let best = Infinity, out = [];
  for (const from of [...new Set(sets.flat())].sort((a, b) => a - b)) {
    let to = from;
    for (const s of sets) {
      const up = s.filter((f) => f >= from);
      to = up.length ? Math.max(to, Math.min(...up)) : Infinity;
    }
    if (to === Infinity) continue;
    if (to - from < best) { best = to - from; out = [[from, to]]; } else if (to - from === best) out.push([from, to]);
  }
  return out;
}

// "bar 5", "open", "bar 3 · no b7" — what a grip is, in a player's words.
function lapVoicingLabel(v) {
  return (v.fret === 0 ? 'open' : `bar ${v.fret}`) + (v.omit.length ? ` · no ${v.omit.join(', ')}` : '');
}

// A lap steel chord diagram: the bar lying across every string on its fret,
// dots on the strings to pick and crosses over the rest, and each picked
// string's chord tone (R/3/5 …) underneath, so a grip can be thinned by ear.
// `focusName` is the chord the name click focuses on the scale maps — the
// guitar shape, which is what the song's focus chord is stored as.
function lapDiagramSVG(displayName, v, tuning, focusName, extra) {
  const head = `<div class="cd-name" data-chord="${escapeHtml(focusName)}">${escapeHtml(displayName)}</div>`;
  const dcls = 'chord-diagram lap-diagram';
  if (!v) return `<div class="${dcls}">${head}<div class="cd-na">no straight-bar grip</div>${extra || ''}</div>`;
  const labels = chordToneLabels(displayName) || new Map();
  const S = v.frets.length, rows = 3, cellW = 11, cellH = 12, left = 20, top = 18;
  const width = left * 2 + (S - 1) * cellW;
  const x = (i) => left + i * cellW;
  const y = (k) => top + k * cellH;
  const toneY = y(rows) + 9;
  const height = toneY + 3;
  let p = '';
  for (let k = 0; k <= rows; k++) p += `<line x1="${x(0)}" y1="${y(k)}" x2="${x(S - 1)}" y2="${y(k)}"/>`;
  for (let i = 0; i < S; i++) p += `<line x1="${x(i)}" y1="${y(0)}" x2="${x(i)}" y2="${y(rows)}"/>`;
  // The top line is the nut when the bar is at the 1st fret or the strings are
  // open; further up it's the fret below the bar.
  if (v.fret <= 1) p += `<rect class="cd-nut" x="${x(0) - 1}" y="${top - 3}" width="${(S - 1) * cellW + 2}" height="3"/>`;
  if (v.fret > 0) {
    // The bar sits right over the fret, not behind it as a fingertip would,
    // so it lies on the fret line.
    const by = y(1);
    p += `<rect class="lap-bar" x="${x(0) - 4}" y="${by - 3}" width="${(S - 1) * cellW + 8}" height="6" rx="3"/>`;
    p += `<text class="cd-fretnum" x="0" y="${by + 2.5}" text-anchor="start">${v.fret}fr</text>`;
  }
  for (let i = 0; i < S; i++) {
    const f = v.frets[i], cx = x(i);
    if (f < 0) { p += `<text class="cd-mark" x="${cx}" y="${top - 5}" text-anchor="middle">&#215;</text>`; continue; }
    if (f === 0) p += `<text class="cd-mark" x="${cx}" y="${top - 5}" text-anchor="middle">&#9675;</text>`;
    else p += `<circle class="cd-dot" cx="${cx}" cy="${y(1)}" r="3.2"/>`;
    const tone = labels.get((tuning[i] + f) % 12) || '';
    p += `<text class="lap-tone" x="${cx}" y="${toneY}" text-anchor="middle">${tone}</text>`;
  }
  const omit = v.omit.length ? `<div class="cd-omit">no ${escapeHtml(v.omit.join(', '))}</div>` : '';
  return `<div class="${dcls}">${head}<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${p}</svg>${omit}${extra || ''}</div>`;
}

// ---- Lap steel neck insert -------------------------------------------------
// A true-size paper copy of a lap steel's fretboard, to lie on the real one
// beneath the strings and show a scale in a tuning. The neck is whatever the
// player measured, in inches. The drawing is in hundredths of an inch on a
// sheet declared in inches, so it prints at size. It comes out as strips short
// enough for Letter paper, cut mid-space so no fret line lands on a join.
// Text on the strips reads from the playing position — nut to the left, low
// string nearest — which on the upright sheet is a quarter turn clockwise.

const LAP_SHEET = { w: 8.5, h: 11, margin: 0.45 };
const LAP_PIECE_MAX = LAP_SHEET.h - 2 * LAP_SHEET.margin;
const LAP_FONT = 'Helvetica, Arial, sans-serif';
const LAP_INK = {
  color: {
    root: { fill: '#f2994a', stroke: '#222', text: '#111' },
    tone: { fill: '#a5e3d5', stroke: '#222', text: '#111' },
    dim: { fill: '#eee', stroke: '#999', text: '#555' },
  },
  mono: {
    root: { fill: '#111', stroke: '#111', text: '#fff' },
    tone: { fill: '#fff', stroke: '#111', text: '#111' },
    dim: { fill: '#e6e6e6', stroke: '#888', text: '#444' },
  },
};

// Inches → drawing units, trimmed so the SVG stays readable.
function lu(v) { return +(v * 100).toFixed(2); }

// Distance from the nut to fret n on a scale length (equal temperament).
function fretDistance(scale, n) { return scale * (1 - Math.pow(2, -n / 12)); }

// The position marker that belongs to fret n — the run most steel boards carry,
// repeating each octave. It sits in the space before its fret line.
function lapMarkerAt(n) {
  return n >= 3 ? { 3: 'circle', 5: 'triangle', 7: 'square', 9: 'diamond', 0: 'bar' }[n % 12] : undefined;
}

// Where everything on a neck is: fret distances `d` (d[0] is the nut; frets
// that would run off the board are dropped), the dot radius `r` at each fret,
// the board's half-width and each string's offset from the centre line at any
// distance from the nut. A dot has to clear its neighbours both along the
// string — the next fret up is the closer one — and across to the next string.
function lapInsertGeometry(neck, nStrings) {
  const d = [0];
  for (let n = 1; n <= neck.frets; n++) {
    const at = fretDistance(neck.scale, n);
    if (at > neck.length - 0.02) break;
    d.push(at);
  }
  const along = (from, to) => (y) => from + (to - from) * y / neck.length;
  const width = along(neck.nutW, neck.endW), span = along(neck.nutSpan, neck.endSpan);
  const gap = (y) => (nStrings > 1 ? span(y) / (nStrings - 1) : width(y));
  return {
    d,
    length: neck.length,
    r: d.map((y, n) => Math.min(0.12, 0.38 * (fretDistance(neck.scale, n + 1) - y), 0.42 * gap(y))),
    halfW: (y) => width(y) / 2,
    stringX: (i, y) => (nStrings > 1 ? -span(y) / 2 + i * gap(y) : 0),
  };
}

// Where to cut the neck into strips that fit the sheet: [0, cut…, length].
// Cuts fall midway between two fret lines, as near to equal strips as the
// frets allow.
function lapInsertCuts(d, length) {
  const mids = d.slice(0, -1).map((y, n) => (y + d[n + 1]) / 2);
  for (let k = Math.max(1, Math.ceil(length / LAP_PIECE_MAX)); ; k++) {
    const cuts = [0];
    for (let j = 1; j < k; j++) {
      const from = cuts[cuts.length - 1], target = j * length / k;
      const ok = mids.filter((m) => m > from && m - from <= LAP_PIECE_MAX);
      cuts.push(ok.length
        ? ok.reduce((best, m) => (Math.abs(m - target) < Math.abs(best - target) ? m : best))
        : Math.min(from + LAP_PIECE_MAX, length));
    }
    cuts.push(length);
    if (cuts.every((c, i) => i === 0 || c - cuts[i - 1] <= LAP_PIECE_MAX + 1e-9)) return cuts;
  }
}

// One run of text. `turn` lays it along the neck, to be read from the playing
// position; `mid` centres it on (x, y) across its own height as well.
function lapText(x, y, str, size, o = {}) {
  const at = o.turn ? ` transform="translate(${lu(x)},${lu(y)}) rotate(90)"` : ` x="${lu(x)}"`;
  const base = (o.mid ? 0.36 * size : 0) + (o.turn ? 0 : y);
  return `<text${at} y="${lu(base)}" font-size="${lu(size)}" text-anchor="${o.anchor || 'middle'}" ` +
    `fill="${o.fill || '#111'}"${o.bold ? ' font-weight="700"' : ''}>${escapeHtml(String(str))}</text>`;
}

// One mark shape, `r` being roughly its reach from the centre: the shapes that
// stand for positions are sized to read as the same weight as a circle and to
// hold the same lettering. 'open' is the rounded square of an open string.
// `u` turns a coordinate into the drawing's units — the insert draws in
// hundredths of an inch, the screen's fret map in pixels.
const px = (v) => +v.toFixed(2);
function markShape(kind, x, y, r, attrs, u = px) {
  const P = (pts) => `<polygon points="${pts.map(([dx, dy]) => `${u(x + dx * r)},${u(y + dy * r)}`).join(' ')}" ${attrs}/>`;
  if (kind === 'square') return `<rect x="${u(x - 0.9 * r)}" y="${u(y - 0.9 * r)}" width="${u(1.8 * r)}" height="${u(1.8 * r)}" ${attrs}/>`;
  if (kind === 'open') return `<rect x="${u(x - r)}" y="${u(y - r)}" width="${u(2 * r)}" height="${u(2 * r)}" rx="${u(r * 0.3)}" ${attrs}/>`;
  if (kind === 'diamond') return P([[0, -1.2], [1.2, 0], [0, 1.2], [-1.2, 0]]);
  if (kind === 'hexagon') return P([[0, -1.05], [0.91, -0.525], [0.91, 0.525], [0, 1.05], [-0.91, 0.525], [-0.91, -0.525]]);
  if (kind === 'triangle') return P([[0, -1.3], [1.15, 0.75], [-1.15, 0.75]]);
  if (kind === 'tridown') return P([[0, 1.3], [1.15, -0.75], [-1.15, -0.75]]);
  return `<circle cx="${u(x)}" cy="${u(y)}" r="${u(r)}" ${attrs}/>`;
}
function lapShape(kind, x, y, r, attrs) { return markShape(kind, x, y, r, attrs, lu); }
// The same shapes as text, for a legend that is words rather than a drawing.
const SHAPE_GLYPH = { circle: '●', square: '■', diamond: '◆', hexagon: '⬢', triangle: '▲', tridown: '▼' };

// A note on the neck. `kinds` is the shape to draw it as — 'open' for the
// rounded square at the nut — and, when positions are on, a second kind for a
// note that belongs to two positions, drawn as an outline round the first.
// `label` is [note] or [note, degree].
function lapNoteMark(x, y, r, ink, label, kinds) {
  let out = lapShape(kinds[0], x, y, r, `fill="${ink.fill}" stroke="${ink.stroke}" stroke-width="0.9"`);
  if (kinds[1]) out += lapShape(kinds[1], x, y, 1.12 * r, `fill="none" stroke="${ink.stroke}" stroke-width="0.9"`);
  if (label.length > 1) {
    // Note above, degree below — as read from the playing position, where
    // "above" is towards the far (high-string) side.
    out += lapText(x + 0.22 * r, y, label[0], 0.8 * r, { turn: true, mid: true, bold: true, fill: ink.text });
    out += lapText(x - 0.5 * r, y, label[1], 0.52 * r, { turn: true, mid: true, fill: ink.text });
  } else if (label[0]) {
    const size = (String(label[0]).length > 1 ? 0.95 : 1.15) * r;
    out += lapText(x, y, label[0], size, { turn: true, mid: true, bold: true, fill: ink.text });
  }
  return out;
}

function lapMarkerShape(kind, y, h, boardW) {
  const fill = 'fill="#d4d4d4"';
  if (kind === 'circle') return `<circle cx="0" cy="${lu(y)}" r="${lu(h / 2)}" ${fill}/>`;
  if (kind === 'square') return `<rect x="${lu(-h * 0.45)}" y="${lu(y - h * 0.45)}" width="${lu(h * 0.9)}" height="${lu(h * 0.9)}" ${fill}/>`;
  if (kind === 'bar') {
    const w = boardW * 0.58;
    return `<rect x="${lu(-w / 2)}" y="${lu(y - h / 2)}" width="${lu(w)}" height="${lu(h)}" rx="${lu(h / 2)}" ${fill}/>`;
  }
  const pts = kind === 'triangle' // pointing up the neck, towards the bridge
    ? [[-h * 0.55, y - h / 2], [h * 0.55, y - h / 2], [0, y + h / 2]]
    : [[0, y - h * 0.55], [h * 0.55, y], [0, y + h * 0.55], [-h * 0.55, y]];
  return `<polygon points="${pts.map(([px, py]) => `${lu(px)},${lu(py)}`).join(' ')}" ${fill}/>`;
}

// The note radius at fret n. Positions shrink the marks a touch: a two-shape
// mark needs the room, and the diamond reaches past a circle's edge. Still big
// enough for the degree.
function lapMarkRadius(o, g) {
  return (n) => g.r[n] * (o.positions ? 0.88 : 1);
}

// The clear band before fret line n: from the last fret's dots (or, before the
// first fret, the open-string row) to this one's.
function lapBand(g, rr, n) {
  return { from: g.d[n - 1] + (n === 1 ? 2 * rr(0) + 0.035 : rr(n - 1)), to: g.d[n] - rr(n) };
}

// Where the key's triads go on the insert: for every fret from 1 up, the
// triads a bar gives there, I, IV and V first, each a group of grips — and
// how big a stack of them fits in the clear band just before the fret line,
// on the same strip as the line. Where it doesn't, the later groups go just
// past the line instead, into the band beyond, when nothing else is drawn
// there. Frets too crowded even for that are left out (the grips repeat an
// octave lower), and so are the open strings, which have fret 12's.
//   → { at: Map(fret → { lane, size, nut, body }), drawn, crowded }, where
//     nut and body (or null) are { groups: [{ t, grips }], labels, extents, total }
//     and each label is [chord, numeral], or [numeral] where room is short.
const LAP_TRI_GAP = 0.03, LAP_TRI_GROUP = 0.03, LAP_TRI_DOT = 0.028;
function lapTriadLayout(o, g) {
  const rr = lapMarkRadius(o, g), last = g.d.length - 1;
  const byFret = new Map();
  for (const t of o.triads || []) {
    for (const gr of t.grips) {
      if (gr.fret < 1 || gr.fret > last) continue;
      const groups = byFret.get(gr.fret) || [];
      let grp = groups.find((x) => x.t === t);
      if (!grp) groups.push(grp = { t, grips: [] });
      grp.grips.push(gr);
      byFret.set(gr.fret, groups);
    }
  }
  const rank = (grp) => lapRank((grp.t.triad.rootPc - o.rootPc + 12) % 12);
  const cuts = lapInsertCuts(g.d, g.length).slice(1, -1);
  const cutIn = (a, b) => cuts.find((c) => c > a && c < b);
  // Rails and labels shrink together; a label drops its chord name for the
  // numeral alone before a fret gives up on them. Labels are two short turned
  // lines in the margin past the top string, so their size is capped by it.
  const sized = (groups, k, short, cap) => {
    const lane = 0.07 * k, size = Math.min(0.07 * k, cap);
    const labels = groups.map((grp) => (short ? [grp.t.numeral] : [grp.t.label, grp.t.numeral]));
    const extents = groups.map((grp, i) =>
      Math.max(grp.grips.length * lane, 0.6 * size * Math.max(...labels[i].map((l) => l.length)) + 0.015));
    return { groups, labels, extents, lane, size, total: extents.reduce((a, b) => a + b, 0) + (groups.length - 1) * LAP_TRI_GROUP };
  };
  const at = new Map(), drawn = [], crowded = [];
  for (const n of [...byFret.keys()].sort((a, b) => a - b)) {
    const groups = byFret.get(n).sort((a, b) => rank(a) - rank(b));
    const y = g.d[n], { from, to } = lapBand(g, rr, n);
    const cutA = cutIn(g.d[n - 1], y);
    const nutRoom = to - LAP_TRI_GAP - Math.max(from + 0.05, cutA === undefined ? -Infinity : cutA + 0.04);
    let bodyRoom = 0;
    if (n < last && !byFret.has(n + 1)) {
      const next = lapBand(g, rr, n + 1), cutB = cutIn(y, g.d[n + 1]);
      bodyRoom = Math.min(next.to - 0.05, cutB === undefined ? Infinity : cutB - 0.04) - (y + rr(n) + LAP_TRI_GAP);
    }
    const margin = g.halfW(y) + g.stringX(0, y);
    const cap = (margin - 0.035 - LAP_TRI_DOT - 0.012) / 2.1;
    // Split across the line, a lone chord goes half and half, labelled twice.
    const half = Math.ceil(groups[0].grips.length / 2);
    const units = groups.length > 1 ? groups
      : [{ t: groups[0].t, grips: groups[0].grips.slice(0, half) }, { t: groups[0].t, grips: groups[0].grips.slice(half) }];
    const tryFit = (k, short, list, split) => {
      const nut = sized(list.slice(0, split), k, short, short ? 2.1 * cap : cap);
      const body = split < list.length ? sized(list.slice(split), k, short, short ? 2.1 * cap : cap) : null;
      return nut.total <= nutRoom && (!body || body.total <= bodyRoom) ? { lane: nut.lane, size: nut.size, nut, body } : null;
    };
    // Everything before the line first; then split across it, as many groups
    // before the line as fit — shrinking a little for each, then further, and
    // only then down to bare numerals.
    let lay = null;
    const passes = [[false, 0.8, false], [false, 0.8, true], [false, 0.6, false], [false, 0.6, true], [true, 0.6, false], [true, 0.6, true]];
    search: for (const [short, minK, spill] of passes) {
      if (spill && (bodyRoom <= 0 || !units[units.length - 1].grips.length)) continue;
      for (let k = 1; k > minK - 0.01; k -= 0.05) {
        for (let split = spill ? units.length - 1 : groups.length; split >= 1; split--) {
          if ((lay = tryFit(k, short, spill ? units : groups, split))) break search;
          if (!spill) break;
        }
      }
    }
    if (lay) { at.set(n, lay); drawn.push(n); } else crowded.push(n);
  }
  return { at, drawn, crowded };
}

// The whole neck, drawn once in its own coordinates: x from the centre line,
// y from the nut. Each strip shows its own stretch of this through a clip.
//   o.tuning   absolute semitones, low string first (drawn at the left)
//   o.rootPc, o.scale { name, iv }, o.names[pc], o.dimPcs (Set, drawn fainter)
//   o.labels   'both' | 'notes' | 'degrees';  o.color  true | false
//   o.bars     (fret) => the chords a straight bar gives there ([] for none)
//   o.positions  lapPositions(…), or null;  o.triads  lapKeyTriads(…), or null
//   o.shortName, o.scaleTitle   what the strips are labelled with
function lapNeckContent(o, g) {
  const N = o.tuning.length;
  const ink = LAP_INK[o.color ? 'color' : 'mono'];
  const inScale = new Set(o.scale.iv.map((t) => (o.rootPc + t) % 12));
  const last = g.d.length - 1;
  const pos = o.positions || null;
  const rr = lapMarkRadius(o, g);
  const tri = o.triads ? lapTriadLayout(o, g) : null;
  const kindsAt = (n, open) => (pos ? pos.at(n).map((i) => pos.list[i].shape) : [open ? 'open' : 'circle']);
  let under = '', lines = '', marks = '', text = '';

  for (let i = 0; i < N; i++) {
    under += `<line x1="${lu(g.stringX(i, 0))}" y1="0" x2="${lu(g.stringX(i, g.length))}" y2="${lu(g.length)}" stroke="#cfcfcf" stroke-width="0.6"/>`;
  }

  const labelFor = (pc, r) => {
    const note = o.names[pc], degree = INTERVAL_LABELS[(pc - o.rootPc + 12) % 12];
    if (o.labels === 'degrees') return [degree];
    return o.labels === 'both' && r >= 0.1 ? [note, degree] : [note];
  };
  const inkFor = (pc) => (pc === o.rootPc ? ink.root : o.dimPcs && o.dimPcs.has(pc) ? ink.dim : ink.tone);

  // Open strings, just below the nut: every string gets one, so the top of the
  // strip spells the tuning; the ones outside the scale are only ghosted.
  const r0 = rr(0), openY = g.r[0] + 0.035;
  for (let i = 0; i < N; i++) {
    const pc = o.tuning[i] % 12, x = g.stringX(i, openY);
    marks += inScale.has(pc)
      ? lapNoteMark(x, openY, r0, inkFor(pc), labelFor(pc, r0), kindsAt(0, true))
      : lapNoteMark(x, openY, r0, { fill: 'none', stroke: '#bbb', text: '#888' }, [o.names[pc]], ['open']);
  }

  for (let n = 1; n <= last; n++) {
    const y = g.d[n], r = rr(n);
    const heavy = n % 12 === 0;
    lines += `<line x1="${lu(-g.halfW(y))}" y1="${lu(y)}" x2="${lu(g.halfW(y))}" y2="${lu(y)}" stroke="#111" stroke-width="${heavy ? 4.5 : 3}"/>`;

    // The clear band between this fret's dots and the last one's, and the
    // triad rails for this fret: a stack at the band's far end, and maybe a
    // second one just past the line, in the band beyond.
    const { from, to } = lapBand(g, rr, n);
    const band = to - from;
    const here = tri && tri.at.get(n);
    const triTop = here ? to - LAP_TRI_GAP - here.nut.total : to;
    const prev = tri && tri.at.get(n - 1);
    const bandFrom = prev && prev.body ? g.d[n - 1] + rr(n - 1) + LAP_TRI_GAP + prev.body.total + 0.02 : from;
    const triStrings = new Set();
    // A stack runs from `edge` away from the fret line (dir -1 towards the
    // nut, +1 towards the body): one rail per grip, lowest strings nearest
    // the line, centred in its group's share; the label down the far edge.
    const stack = (st, edge, dir) => {
      const lane = here.lane, dr = Math.min(LAP_TRI_DOT, 0.4 * lane), size = here.size;
      st.groups.forEach((grp, gi) => {
        const ext = st.extents[gi], start = edge + dir * (ext - grp.grips.length * lane) / 2;
        grp.grips.forEach((gr, j) => {
          const ly = start + dir * (j + 0.5) * lane;
          const xs = gr.strings.map((si) => g.stringX(si, ly));
          marks += `<line x1="${lu(xs[0])}" y1="${lu(ly)}" x2="${lu(xs[2])}" y2="${lu(ly)}" stroke="#111" stroke-width="0.8"/>`;
          gr.strings.forEach((si, k) => {
            triStrings.add(si);
            marks += `<circle cx="${lu(xs[k])}" cy="${lu(ly)}" r="${lu(dr)}" ` + (gr.roles[k] === 'R'
              ? `fill="${ink.root.fill}" stroke="${ink.root.stroke}" stroke-width="0.6"/>`
              : 'fill="#fff" stroke="#111" stroke-width="0.7"/>');
          });
        });
        // Chord above, numeral below, as read from the playing position.
        const mid = edge + dir * ext / 2, [top, below] = st.labels[gi];
        const x1 = g.halfW(mid) - 0.035 - size / 2;
        text += lapText(x1, mid, top, size, { turn: true, mid: true, bold: true });
        if (below) text += lapText(x1 - 1.1 * size, mid, below, size, { turn: true, mid: true, fill: '#333' });
        edge += dir * (ext + LAP_TRI_GROUP);
      });
    };
    if (here) {
      stack(here.nut, to - LAP_TRI_GAP, -1);
      if (here.body) stack(here.body, y + r + LAP_TRI_GAP, 1);
    }

    // A rail can take a chord tone the scale leaves out (the 4th of a major
    // pentatonic, in the IV chord): that string gets a ghost of its note.
    for (let i = 0; i < N; i++) {
      const pc = (o.tuning[i] + n) % 12;
      if (inScale.has(pc)) marks += lapNoteMark(g.stringX(i, y), y, r, inkFor(pc), labelFor(pc, r), kindsAt(n, false));
      else if (triStrings.has(i)) marks += lapNoteMark(g.stringX(i, y), y, r, { fill: '#fff', stroke: '#999', text: '#666' }, [o.names[pc]], ['circle']);
    }

    // The board's own marker, in whatever the rails leave of the band.
    const kind = lapMarkerAt(n);
    const markTo = here ? triTop - 0.02 : to;
    if (kind && markTo - bandFrom > 0.05) {
      const space = y - g.d[n - 1];
      const h = Math.min((kind === 'bar' ? 0.62 : 0.45) * space, 0.85 * (markTo - bandFrom));
      under += lapMarkerShape(kind, (bandFrom + markTo) / 2, h, 2 * g.halfW(y));
    }

    // Fret number — led by the glyph of its position, when those are on —
    // then the straight-bar chords, stacked at the near edge and ending just
    // short of the line. They shrink with the band, and drop out — chords
    // first — once they would be too small to read.
    const room = band - 0.045, left = -g.halfW(y) + 0.035, end = to - 0.02;
    const glyphs = pos ? pos.at(n) : [];
    const numSize = Math.min(0.1, room / (0.62 * String(n).length + 0.9 * glyphs.length));
    if (numSize >= 0.055) {
      text += lapText(left, end, n, numSize, { turn: true, anchor: 'end', bold: true });
      glyphs.forEach((i, k) => {
        const gy = end - 0.62 * numSize * String(n).length - (0.5 + 0.9 * k) * numSize;
        under += lapShape(pos.list[i].shape, left + 0.36 * numSize, gy, 0.3 * numSize, 'fill="#111"');
      });
      // A chord the triad labels already name isn't lettered twice, and any
      // left over stops short of the rails, which reach the near string.
      const named = here ? [...here.nut.groups, ...(here.body ? here.body.groups : [])].map((grp) => grp.t.triad) : [];
      const chords = (o.bars ? o.bars(n) : []).filter((c) => {
        const t = chordTriad(c);
        return !named.some((x) => t && x.rootPc === t.rootPc && x.quality === t.quality);
      });
      const chEnd = here ? triTop - 0.02 : end;
      const longest = Math.max(0, ...chords.map((c) => c.length));
      const chSize = Math.min(0.085, (chEnd - bandFrom - 0.025) / (0.6 * longest));
      if (longest && chSize >= 0.06) {
        chords.forEach((c, k) => { text += lapText(left + 0.11 + k * 0.095, chEnd, c, chSize, { turn: true, anchor: 'end', fill: '#444' }); });
      }
    }
  }

  // What this strip is, so a drawer full of them can be told apart: along the
  // first fret space on the nut strip, clear of any triad rails there…
  const t1 = tri && tri.at.get(1);
  const idEnd = t1 ? g.d[1] - rr(1) - LAP_TRI_GAP - t1.nut.total - 0.02 : g.d[1] - g.r[1];
  const idRoom = idEnd - (2 * r0 + 0.035) - 0.12;
  if (last >= 1 && idRoom >= 0.4) {
    const mid = (2 * r0 + 0.035 + idEnd) / 2;
    const fit = (str, max, wide) => Math.min(max, idRoom / (wide * str.length));
    text += lapText(0.12, mid, o.shortName, fit(o.shortName, 0.12, 0.6), { turn: true, mid: true, bold: true });
    text += lapText(-0.06, mid, o.scaleTitle, fit(o.scaleTitle, 0.1, 0.56), { turn: true, mid: true, fill: '#333' });
  }
  // …and across the tail past the last fret on the far one, either side of the
  // marker that lives there.
  const tailFrom = g.d[last] + g.r[last], tail = g.length - tailFrom;
  if (tail >= 0.14) {
    const y = tailFrom + tail / 2, size = Math.min(0.09, tail * 0.55), half = g.halfW(g.length);
    const kind = lapMarkerAt(last + 1);
    if (kind && kind !== 'bar') under += lapMarkerShape(kind, y, Math.min(0.2, 0.7 * tail), 2 * half);
    text += lapText(-half * 0.5, y, o.shortName, size, { mid: true, bold: true });
    text += lapText(half * 0.5, y, o.scaleTitle, size, { mid: true, fill: '#333' });
  }
  return under + lines + marks + text;
}

// Break a sentence into lines of at most `max` characters.
function lapWrap(str, max) {
  const out = [];
  let line = '';
  for (const word of str.split(' ')) {
    if (line && (line + ' ' + word).length > max) { out.push(line); line = word; } else line = line ? line + ' ' + word : word;
  }
  if (line) out.push(line);
  return out;
}

// The column beside the strips: what the sheet is, how to print and fit it, and
// two rulers to prove the printer kept the size.
function lapInsertInfo(o, g, x, y, w) {
  const ink = LAP_INK[o.color ? 'color' : 'mono'];
  const per = Math.floor(w / 0.058); // characters per line at the body size
  let out = '', cy = y + 0.1;
  const para = (str, size, opt) => {
    for (const ln of lapWrap(str, Math.floor(per * 0.105 / size))) {
      out += lapText(x, cy, ln, size, Object.assign({ anchor: 'start' }, opt));
      cy += size * 1.32;
    }
    cy += 0.07;
  };
  para('LAP STEEL NECK INSERT', 0.085, { bold: true, fill: '#666' });
  para(o.tuningName, 0.14, { bold: true });
  para(o.scaleTitle, 0.125);
  const pos = o.positions || null;
  [[ink.root, 'root', 'circle'], [ink.tone, o.dimPcs ? 'natural note' : 'scale tone', 'circle'],
    ...(o.dimPcs ? [[ink.dim, 'sharp / flat', 'circle']] : []),
    [ink.tone, pos ? 'open string (the row before the nut)' : 'open string', 'open']].forEach(([k, name, kind]) => {
    out += lapNoteMark(x + 0.07, cy - 0.035, 0.065, k, [], [kind]) + lapText(x + 0.2, cy, name, 0.105, { anchor: 'start' });
    cy += 0.19;
  });
  if (pos) {
    cy += 0.06;
    para('POSITIONS', 0.085, { bold: true, fill: '#666' });
    for (const p of pos.list) {
      out += lapShape(p.shape, x + 0.07, cy - 0.035, 0.065, 'fill="#111"');
      out += lapText(x + 0.2, cy, `${p.chords.join(' / ')} · ${p.numerals.join(' / ')}`, 0.105, { anchor: 'start', bold: true });
      cy += 0.145;
      out += lapText(x + 0.2, cy, 'bar ' + p.frets.join(', '), 0.095, { anchor: 'start', fill: '#333' });
      cy += 0.19;
    }
    para('Each fret belongs to the nearest chord bar. A mark drawn with two shapes sits midway between two positions and belongs to both.', 0.1, { fill: '#333' });
  }
  const tri = o.triads ? lapTriadLayout(o, g) : null;
  if (tri && tri.drawn.length) {
    cy += 0.06;
    para('TRIADS', 0.085, { bold: true, fill: '#666' });
    // A sample rail: four strings, three dots, the root solid, one skipped.
    const sx = (k) => x + 0.05 + k * 0.1, ry = cy - 0.035;
    for (let k = 0; k < 4; k++) out += `<line x1="${lu(sx(k))}" y1="${lu(ry - 0.07)}" x2="${lu(sx(k))}" y2="${lu(ry + 0.07)}" stroke="#cfcfcf" stroke-width="0.6"/>`;
    out += `<line x1="${lu(sx(0))}" y1="${lu(ry)}" x2="${lu(sx(3))}" y2="${lu(ry)}" stroke="#111" stroke-width="0.8"/>`;
    [[0, true], [1, false], [3, false]].forEach(([k, root]) => {
      out += `<circle cx="${lu(sx(k))}" cy="${lu(ry)}" r="${lu(0.028)}" ` +
        (root ? `fill="${ink.root.fill}" stroke="${ink.root.stroke}" stroke-width="0.6"/>` : 'fill="#fff" stroke="#111" stroke-width="0.7"/>');
    });
    out += lapText(x + 0.45, cy, 'one triad', 0.105, { anchor: 'start', bold: true });
    cy += 0.2;
    // A numeral and its chord never part at a line break.
    para(o.triads.map((t) => `${t.numeral}\u00a0${t.label}`).join(' · '), 0.105, { bold: true });
    const missing = (keyTriads(o.rootPc, o.scale, (pc) => o.names[pc]) || [])
      .filter((k) => !o.triads.some((t) => t.numeral === k.numeral)).map((k) => `${k.numeral}\u00a0${k.label}`);
    para('Beside a fret, a rail for each three strings that make a chord of the key there. Pick the dotted strings (solid: the root) and skip any the rail crosses. The chord is named at the far edge; a grey note is a chord tone outside the scale. ' +
      (missing.length ? `No straight-bar grip for ${missing.join(', ')}. ` : '') +
      (o.triads.some((t) => t.grips.some((gr) => gr.fret === 0)) ? 'Open strings: as fret 12. ' : '') +
      (tri.crowded.length ? `Fret${tri.crowded.length > 1 ? 's' : ''} ${tri.crowded.join(', ')}: too tight to draw, as an octave lower.` : ''), 0.1, { fill: '#333' });
  }
  cy += 0.05;
  para('Lettering reads from the playing position: nut to your left, low string nearest you (the left edge of each strip).', 0.105, { fill: '#333' });
  para('Print at 100% (“actual size”), never “fit to page”, then check both rulers before you cut.', 0.105, { bold: true });
  para('Cut on the outlines. Slide the nut strip beneath the strings and up against the nut, then butt the next strip against it. Card stock keeps the board’s own markers from showing through.', 0.105, { fill: '#333' });
  const n = o.neck, f12 = g.d[12];
  para(`Drawn for a ${n.scale} in scale: ${g.d.length - 1} frets on a ${n.length} in board, ${n.nutW}–${n.endW} in wide.` +
    (f12 ? ` Fret 12 sits ${f12.toFixed(2)} in from the nut.` : ''), 0.105, { fill: '#333' });

  // Rulers: 2 in across, then as many whole inches down as the page has left.
  const tick = (x1, y1, x2, y2) => `<line x1="${lu(x1)}" y1="${lu(y1)}" x2="${lu(x2)}" y2="${lu(y2)}" stroke="#111" stroke-width="0.8"/>`;
  cy += 0.1;
  out += tick(x, cy, x + 2, cy);
  for (let i = 0; i <= 4; i++) out += tick(x + i / 2, cy, x + i / 2, cy + (i % 2 ? 0.06 : 0.11));
  out += lapText(x + 1, cy + 0.26, '2 in across', 0.095, {});
  cy += 0.5;
  const downIn = Math.max(1, Math.min(6, Math.floor(LAP_SHEET.h - LAP_SHEET.margin - cy)));
  out += tick(x, cy, x, cy + downIn);
  for (let i = 0; i <= downIn * 2; i++) {
    out += tick(x, cy + i / 2, x + (i % 2 ? 0.06 : 0.11), cy + i / 2);
    if (i % 2 === 0) out += lapText(x + 0.16, cy + i / 2 + 0.035, i / 2, 0.095, { anchor: 'start' });
  }
  out += lapText(x + 0.45, cy + downIn / 2, `${downIn} in down`, 0.095, { turn: true, mid: true });
  return out;
}

// The finished sheets, one SVG string per page. Strips run left to right, nut
// strip first, all hanging from the top margin; the info column takes what is
// left of the last page, or a page of its own.
function lapInsertPages(o) {
  const g = lapInsertGeometry(o.neck, o.tuning.length);
  const cuts = lapInsertCuts(g.d, g.length);
  const content = lapNeckContent(o, g);
  const M = LAP_SHEET.margin, GAP = 0.45, INFO_W = 1.85;
  const pages = [''];
  let x = M;
  for (let k = 0; k + 1 < cuts.length; k++) {
    const a = cuts[k], b = cuts[k + 1];
    const w = 2 * Math.max(g.halfW(a), g.halfW(b));
    if (pages[pages.length - 1] && x + w > LAP_SHEET.w - M) { pages.push(''); x = M; }
    const poly = [[-g.halfW(a), a], [g.halfW(a), a], [g.halfW(b), b], [-g.halfW(b), b]]
      .map(([px, py]) => `${lu(px)},${lu(py)}`).join(' ');
    pages[pages.length - 1] +=
      `<g transform="translate(${lu(x + w / 2)},${lu(M - a)})">` +
        `<clipPath id="lap-strip-${k}"><polygon points="${poly}"/></clipPath>` +
        `<g clip-path="url(#lap-strip-${k})">${content}</g>` +
        `<polygon points="${poly}" fill="none" stroke="#333" stroke-width="0.8"/>` +
      `</g>`;
    x += w + GAP;
  }
  if (x + INFO_W > LAP_SHEET.w - M) { pages.push(''); x = M; }
  pages[pages.length - 1] += lapInsertInfo(o, g, x, M, LAP_SHEET.w - M - x);
  return pages.map((body) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lu(LAP_SHEET.w)} ${lu(LAP_SHEET.h)}" ` +
    `width="${LAP_SHEET.w}in" height="${LAP_SHEET.h}in" font-family="${LAP_FONT}">` +
    `<rect width="100%" height="100%" fill="#fff"/>${body}</svg>`);
}

// Harmonica keys the common players' spelling.
const HARP_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

// Given the sounding key (pitch class), suggest diatonic harmonica keys per position.
function harmonicaRecs(keyPc) {
  return {
    songKey: HARP_NAMES[keyPc],
    // 2nd position (cross): harp is a fifth below the song key — the go-to for blues/folk.
    cross: HARP_NAMES[(keyPc + 5) % 12],
    // 1st position (straight): harp matches the song key.
    straight: HARP_NAMES[keyPc],
    // 3rd position (slant): harp a whole step below — for minor/Dorian tunes.
    slant: HARP_NAMES[(keyPc - 2 + 12) % 12],
  };
}
