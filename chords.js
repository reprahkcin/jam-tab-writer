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
    '6':     [0, 2, 2, 1, 2, 0],
    'm6':    [0, 2, 2, 0, 2, 0],
  } },
  A: { ref: 9, q: {
    'major': [-1, 0, 2, 2, 2, 0],
    'm':     [-1, 0, 2, 2, 1, 0],
    '7':     [-1, 0, 2, 0, 2, 0],
    'm7':    [-1, 0, 2, 0, 1, 0],
    'maj7':  [-1, 0, 2, 1, 2, 0],
    'sus4':  [-1, 0, 2, 2, 3, 0],
    'sus2':  [-1, 0, 2, 2, 0, 0],
    '6':     [-1, 0, 2, 2, 2, 2],
    'm6':    [-1, 0, 2, 2, 1, 2],
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
function parseQuality(suffix) {
  const s = suffix.trim();
  if (s === '' || s === 'maj' || s === 'M') return 'major';
  if (/^(maj7|M7|Δ)/.test(s)) return 'maj7';
  if (/^(m7|min7|-7)/.test(s)) return 'm7';
  if (/^(m6|min6)/.test(s)) return 'm6';
  if (/^(m|min|-)/.test(s)) return 'm';
  if (/^7/.test(s)) return '7';
  if (/^6/.test(s)) return '6';
  if (/^sus2/.test(s)) return 'sus2';
  if (/^sus4?/.test(s)) return 'sus4';
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

// Resolve a chord name (e.g. "F#m7", "Cadd9", "D/F#") to a fret array, or null.
function resolveChord(name) {
  const m = name.match(CHORD_RE);
  if (!m) return null;
  const [, root, acc, suffix] = m; // bass (slash) is ignored for the shape
  const pc = chordRootPc(root, acc);
  const spellings = [root + acc + suffix, SHARP[pc] + suffix];
  for (const key of spellings) {
    if (OPEN_CHORDS[key]) return OPEN_CHORDS[key];
  }
  const quality = parseQuality(suffix);
  if (!quality) return null;
  return movableShape(pc, quality);
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
  'sus2': [0, 2, 7], 'sus4': [0, 5, 7],
};

// Interval degree labels by semitone distance from the chord root.
const INTERVAL_LABELS = {
  0: 'R', 1: 'b2', 2: '2', 3: 'b3', 4: '3', 5: '4',
  6: 'b5', 7: '5', 8: '#5', 9: '6', 10: 'b7', 11: '7',
};

// A chord's root pitch class + its interval list (from the root), or null.
function chordIntervals(name) {
  const m = name.match(CHORD_RE);
  if (!m) return null;
  const [, root, acc, suffix] = m;
  let iv = QUALITY_IV[parseQuality(suffix)];
  if (!iv) {
    if (/dim|°/.test(suffix)) iv = [0, 3, 6];
    else if (/aug|\+/.test(suffix)) iv = [0, 4, 8];
    else iv = [0, 4, 7]; // reasonable default
  }
  return { rootPc: chordRootPc(root, acc), iv };
}

// Map of pitch class -> interval label for a chord name (R/3/5/7 …), or null.
function chordToneLabels(name) {
  const ci = chordIntervals(name);
  if (!ci) return null;
  const map = new Map();
  for (const i of ci.iv) map.set((ci.rootPc + i) % 12, INTERVAL_LABELS[i] || '');
  return map;
}

// A full-neck scale map: 6 strings x `FR` frets, scale tones dotted, root
// filled. Low E is the bottom row; the nut is at the left. When `highlight`
// (a Map of pitch class -> interval label) is given, those chord tones get a
// ring with the interval label (R/3/5/7 …); chord tones that fall outside the
// scale are drawn as hollow labelled markers so the whole chord is visible.
function scaleDiagramSVG(rootPc, intervals, highlight, tuning = STRING_ABS) {
  const set = new Set(intervals.map((i) => (rootPc + i) % 12));
  const hi = highlight && highlight.size ? highlight : null;
  const N = tuning.length;
  const FR = 15, left = 26, top = 14, rowH = 18, colW = 30;
  const width = left + FR * colW + 12;
  const height = top + (N - 1) * rowH + 24;
  const x = (f) => left + f * colW;
  const y = (i) => top + (N - 1 - i) * rowH; // string 0 (lowest) at the bottom
  const markers = [3, 5, 7, 9, 12, 15];

  let p = '';
  for (let i = 0; i < N; i++) p += `<line class="sc-string" x1="${x(0)}" y1="${y(i)}" x2="${x(FR)}" y2="${y(i)}"/>`;
  for (let f = 0; f <= FR; f++) {
    const cls = f === 0 ? 'sc-nut' : 'sc-fret';
    p += `<line class="${cls}" x1="${x(f)}" y1="${y(N - 1)}" x2="${x(f)}" y2="${y(0)}"/>`;
  }
  for (const f of markers) p += `<text class="sc-fretnum" x="${x(f) - colW / 2}" y="${height - 8}" text-anchor="middle">${f}</text>`;

  for (let i = 0; i < N; i++) {
    for (let f = 0; f <= FR; f++) {
      const pc = (tuning[i] + f) % 12;
      const cx = f === 0 ? left - 12 : x(f) - colW / 2;
      const cy = y(i);
      const inScale = set.has(pc);
      const isChordTone = hi && hi.has(pc);
      if (inScale && isChordTone) {
        p += `<circle class="${pc === rootPc ? 'sc-root' : 'sc-note'} sc-hi" cx="${cx}" cy="${cy}" r="7"/>`;
        p += `<text class="sc-label" x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central">${hi.get(pc)}</text>`;
      } else if (inScale) {
        p += `<circle class="${pc === rootPc ? 'sc-root' : 'sc-note'}" cx="${cx}" cy="${cy}" r="${pc === rootPc ? 6 : 5}"/>`;
      } else if (isChordTone) {
        p += `<circle class="sc-chordonly" cx="${cx}" cy="${cy}" r="7"/>`;
        p += `<text class="sc-label-open" x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central">${hi.get(pc)}</text>`;
      }
    }
  }
  const cls = 'scale-svg' + (hi ? ' has-hi' : '');
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
  const positions = new Map(); // absolute semitone -> { label, root }
  let prev = -1;
  for (const t of order) {
    let abs = (ci.rootPc + t) % 12;
    while (abs <= prev) abs += 12;
    positions.set(abs, { label: INTERVAL_LABELS[t] || '', root: t === 0 });
    prev = abs;
  }
  const svg = pianoKeyboardSVG(2, (abs) => {
    const info = positions.get(abs);
    return info ? { fill: info.root ? 'root' : 'hi', label: info.label } : { fill: 'plain', label: '' };
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
  const chordPcs = [...labels.keys()];
  const chordSet = new Set(chordPcs);
  const rootPc = chordRootPc(m[1], m[2]);
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
function ukeVoicing(name) { return fretVoicing(name, UKE_ABS, 4); }
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
