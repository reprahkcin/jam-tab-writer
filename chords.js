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
const INV_NAMES = ['root', '1st inv', '2nd inv'];

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
    { name: 'E-shape', form: MOVABLE.E },
    { name: 'A-shape', form: MOVABLE.A },
    { name: 'D-shape', form: MOVABLE.D },
  ];
  if (quality) {
    for (const { name: fname, form } of barreForms) {
      if (!form.q[quality]) continue;
      const { fret, frets } = movableAt({ ref: form.ref, pat: form.q[quality] }, pc);
      out.push({ label: `${fname} barre (${fret}fr)`, frets });
    }
    const tones = TRIAD_TONES[quality];
    if (tones) {
      for (const set of TRIAD_SETS) {
        for (let inv = 0; inv < 3; inv++) {
          const frets = triadShape(pc, tones, set, inv);
          if (frets) out.push({ label: `${set.name} triad · ${INV_NAMES[inv]}`, frets });
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
function chordDiagramSVG(displayName, frets, soundingName, extra) {
  const sub = soundingName && soundingName !== displayName
    ? `<div class="cd-sound">sounds ${escapeHtml(soundingName)}</div>` : '';
  const tail = sub + (extra || '');
  if (!frets) {
    return `<div class="chord-diagram"><div class="cd-name">${escapeHtml(displayName)}</div>` +
      `<div class="cd-na">shape n/a</div>${tail}</div>`;
  }
  const S = 6, rows = 4, cellW = 9, cellH = 12, left = 10, top = 18;
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

  if (base === 1) {
    p += `<rect class="cd-nut" x="${x(0) - 1}" y="${top - 3}" width="${(S - 1) * cellW + 2}" height="3"/>`;
  } else {
    p += `<text class="cd-fretnum" x="${x(0) - 4}" y="${y(0) + cellH - 1}" text-anchor="end">${base}fr</text>`;
  }

  for (let i = 0; i < S; i++) {
    const f = frets[i], cx = x(i);
    if (f < 0) p += `<text class="cd-mark" x="${cx}" y="${top - 5}" text-anchor="middle">&#215;</text>`;
    else if (f === 0) p += `<text class="cd-mark" x="${cx}" y="${top - 5}" text-anchor="middle">&#9675;</text>`;
    else {
      const cy = y(f - base) + cellH / 2;
      p += `<circle class="cd-dot" cx="${cx}" cy="${cy}" r="3.4"/>`;
    }
  }

  return `<div class="chord-diagram"><div class="cd-name">${escapeHtml(displayName)}</div>` +
    `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${p}</svg>${tail}</div>`;
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
