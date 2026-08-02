/* Learn — music theory charts, drawn by the same engine the app plays from.
 *
 * Every diagram here comes out of chords.js (chordIntervals, triadShape,
 * pianoKeyboardSVG, resolveChord …) rather than being drawn by hand, so a chart
 * can't drift out of step with what the chord panels show you, and a fix to the
 * engine improves the teaching for free.
 *
 * Each topic renders twice over: as plain theory worked through a neutral key,
 * and — when the lens is on and a song is open — through that song's own key and
 * chords, because "your Em is G's relative minor" lands where "the vi chord is
 * the relative minor" slides off.
 */
(function (root) {
  'use strict';

  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  // ---- theory tables --------------------------------------------------------

  // Note letters and their pitch classes; spelling a scale means walking these
  // in order, one letter per degree, and accidentals fall where they must.
  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const MAJOR_IV = [0, 2, 4, 5, 7, 9, 11];
  // Quality of the triad built on each degree of a major scale, and the numeral
  // convention: capital = major, lower case = minor, ° = diminished.
  const DEGREES = [
    { num: 'I', q: '', name: 'major', role: 'home — the key itself' },
    { num: 'ii', q: 'm', name: 'minor', role: 'sets up the V' },
    { num: 'iii', q: 'm', name: 'minor', role: 'a softer stand-in for I' },
    { num: 'IV', q: '', name: 'major', role: 'the lift away from home' },
    { num: 'V', q: '', name: 'major', role: 'the pull back home' },
    { num: 'vi', q: 'm', name: 'minor', role: 'the relative minor' },
    { num: 'vii°', q: 'dim', name: 'diminished', role: 'rarely parked on' },
  ];

  // The circle of fifths: each step clockwise adds a sharp, anticlockwise a flat.
  // Relative minors sit inside, sharing the key signature on their left.
  const CIRCLE = [
    { major: 'C', minor: 'Am', acc: 0 },
    { major: 'G', minor: 'Em', acc: 1 },
    { major: 'D', minor: 'Bm', acc: 2 },
    { major: 'A', minor: 'F#m', acc: 3 },
    { major: 'E', minor: 'C#m', acc: 4 },
    { major: 'B', minor: 'G#m', acc: 5 },
    { major: 'F#', minor: 'D#m', acc: 6 },
    { major: 'Db', minor: 'Bbm', acc: -5 },
    { major: 'Ab', minor: 'Fm', acc: -4 },
    { major: 'Eb', minor: 'Cm', acc: -3 },
    { major: 'Bb', minor: 'Gm', acc: -2 },
    { major: 'F', minor: 'Dm', acc: -1 },
  ];
  const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

  // Interval names by semitone distance — the ruler every chord is measured on.
  // The third field is how many letter names the interval spans, which is what
  // decides its spelling: 3 semitones up from G is a minor 3rd and spans two
  // letters (G→B), so it is Bb, not A#. Getting this wrong is the difference
  // between a chart that teaches and one that quietly misleads.
  const INTERVALS = [
    ['0', 'Unison', 0, 'the root itself'],
    ['1', 'Minor 2nd', 1, 'the smallest step there is'],
    ['2', 'Major 2nd', 1, 'one whole step — the "2" in sus2'],
    ['3', 'Minor 3rd', 2, 'makes a chord minor'],
    ['4', 'Major 3rd', 2, 'makes a chord major'],
    ['5', 'Perfect 4th', 3, 'the "4" in sus4'],
    ['6', 'Tritone', 3, 'the restless one — #4 going up, b5 coming down'],
    ['7', 'Perfect 5th', 4, 'in almost every chord; the most neutral note'],
    ['8', 'Minor 6th', 5, 'also spelled #5, as in augmented'],
    ['9', 'Major 6th', 5, 'the "6" in a 6 chord'],
    ['10', 'Minor 7th', 6, 'the "7" in a dominant 7 chord'],
    ['11', 'Major 7th', 6, 'the "7" in maj7 — one step below the octave'],
  ];

  // How many letters each chord tone spans, by semitones from the root. These
  // agree with the INTERVAL_LABELS shorthand (b2, b3, b5, #5, b7 …), so a note
  // named "b5" is spelled as a flattened fifth — Db above G, never C#. Differs
  // from the ruler above at the tritone, which inside a chord is always a flat
  // 5th (G dim is G Bb Db) rather than a sharp 4th.
  const CHORD_LETTER_STEPS = { 0: 0, 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 6: 4, 7: 4, 8: 4, 9: 5, 10: 6, 11: 6 };

  // Chord families, as formulas over those intervals. `q` is the suffix the app
  // itself parses, so the diagrams below are the real ones.
  const TRIADS = [
    { q: '', label: 'Major', formula: '1 · 3 · 5', iv: [0, 4, 7], gloss: 'A major 3rd on the bottom. The default — a bare letter means this.' },
    { q: 'm', label: 'Minor', formula: '1 · b3 · 5', iv: [0, 3, 7], gloss: 'Flatten that 3rd by one fret and the chord turns minor.' },
    { q: 'sus4', label: 'Suspended 4th', formula: '1 · 4 · 5', iv: [0, 5, 7], gloss: 'The 3rd is replaced, not added — so it is neither major nor minor, and it wants to resolve.' },
    { q: 'sus2', label: 'Suspended 2nd', formula: '1 · 2 · 5', iv: [0, 2, 7], gloss: 'Same idea, the other way: the 3rd gives way to the 2nd.' },
    { q: 'dim', label: 'Diminished', formula: '1 · b3 · b5', iv: [0, 3, 6], gloss: 'Minor with the 5th flattened too. Tense; usually passing through.' },
    { q: 'aug', label: 'Augmented', formula: '1 · 3 · #5', iv: [0, 4, 8], gloss: 'Major with the 5th raised. Unsettled in the other direction.' },
  ];
  const SEVENTHS = [
    { q: 'maj7', label: 'Major 7th', formula: '1 · 3 · 5 · 7', iv: [0, 4, 7, 11], gloss: 'Dreamy, still at rest. Not the same as "7".' },
    { q: '7', label: 'Dominant 7th', formula: '1 · 3 · 5 · b7', iv: [0, 4, 7, 10], gloss: 'A plain "7" always means this. Bluesy, and it pulls hard towards the I.' },
    { q: 'm7', label: 'Minor 7th', formula: '1 · b3 · 5 · b7', iv: [0, 3, 7, 10], gloss: 'Minor, softened. The workhorse of the ii chord.' },
    { q: '6', label: 'Major 6th', formula: '1 · 3 · 5 · 6', iv: [0, 4, 7, 9], gloss: 'Sweeter and older-sounding than a 7th.' },
  ];

  // ---- vocabulary -----------------------------------------------------------
  // The words that get used around you as though everyone already knows them.
  // `aka` carries the synonym (bar/measure is the same thing twice), `see` links
  // to the topic that shows it properly, and `app` says where the app does it —
  // half of learning a word is meeting the thing it names.
  const VOCAB = [
    ['Time', 'What keeps everyone playing together.', [
      { t: 'Beat', d: 'The steady pulse you tap your foot to. Everything else in the song is measured against it.' },
      { t: 'Tempo', d: 'How fast the beat goes, counted in BPM — beats per minute. 60 BPM is one beat a second; most songs sit between 70 and 140.', app: 'Set it in the Tempo box; the metronome and count-in both use it.' },
      { t: 'Bar', aka: 'measure', d: 'One group of beats — the unit a song is counted and written in. “Bar” and “measure” are two words for exactly the same thing; bar is the British habit, measure the American one.' },
      { t: 'Time signature', d: 'Two stacked numbers at the start: how many beats are in a bar, and which note value counts as one beat. 4/4 is four quarter-note beats.', see: 'rhythm' },
      { t: 'Downbeat', d: 'Beat 1 of the bar — the strongest one, where a change usually lands.' },
      { t: 'Offbeat', aka: 'the "and"', d: 'The half-beat between the numbers, counted “1 <b>and</b> 2 <b>and</b>”. Upstrokes tend to live here.' },
      { t: 'Upbeat', aka: 'pickup, anacrusis', d: 'Two meanings, so listen for which: the offbeat before a downbeat, or the note or two that lead into bar 1 — that second sense is also called a pickup, or an anacrusis on a written score.' },
      { t: 'Syncopation', d: 'Accents deliberately landing off the beat instead of on it. It is most of what makes a rhythm feel like something rather than like counting.' },
      { t: 'Swing', d: 'Dividing each beat unevenly — long, then short — instead of straight down the middle. Blues, jazz and a lot of country are swung.' },
      { t: 'Groove', d: 'The overall feel of how a rhythm sits: the pulse plus the accents plus how tightly everyone is locked to it.' },
      { t: 'Rest', d: 'A silence with a written length. Rests are played as deliberately as notes.' },
      { t: 'Tie', d: 'Joins two notes of the same pitch into one longer sound, so it can run across a bar line.' },
      { t: 'Triplet', d: 'Three even notes in the space where two would normally go — counted “1-trip-let”.', see: 'rhythm' },
      { t: 'Count-in', d: 'A bar of beats before the music starts, so everyone comes in together.', app: 'The Count in button plays four beats at the song’s tempo.' },
    ]],
    ['Pitch and harmony', 'What the notes are and why they belong together.', [
      { t: 'Pitch', d: 'How high or low a sound is. A note is a pitch with a length attached.' },
      { t: 'Semitone', aka: 'half step', d: 'The smallest step in Western music — one fret on a guitar, or any key to the very next one on a piano.' },
      { t: 'Whole step', aka: 'tone', d: 'Two semitones. Two frets.' },
      { t: 'Octave', d: 'Twelve semitones. The same note name again, higher or lower — so alike that we give it the same letter.' },
      { t: 'Interval', d: 'The distance between two notes, named for how many letters it spans: a 3rd, a 5th, an octave.', see: 'chords' },
      { t: 'Scale', d: 'An ordered set of notes inside an octave that a melody draws on. The major scale is the one most other things are described against.' },
      { t: 'Mode', d: 'The same set of notes treated as though a different one is home. Play C major’s notes but centre on D and you get D Dorian — same seven notes, different resting point, and a noticeably different mood. Ionian is plain major; Aeolian is plain minor.' },
      { t: 'Key', d: 'The home note of a song plus the notes and chords that belong with it. “In the key of G” means G is where things resolve.', see: 'keys' },
      { t: 'Tonic', aka: 'the one', d: 'The home note of a key — the one that sounds like arriving.' },
      { t: 'Root', d: 'The note a chord is built on and named after. Not always the lowest note being played: see inversion.' },
      { t: 'Chord', d: 'Three or more notes sounding together.', see: 'chords' },
      { t: 'Triad', d: 'A three-note chord: root, 3rd and 5th. The basic building block.', see: 'chords' },
      { t: 'Diatonic', d: 'Belonging to the key — built only from its seven notes. A chord from outside is “borrowed”.', see: 'keys' },
      { t: 'Inversion', d: 'The same chord with a different one of its notes at the bottom. Written as a slash chord: C/E is a C with E in the bass.', see: 'inversions' },
      { t: 'Voicing', d: 'Which notes of a chord you actually play, in which octaves, on which strings. Two voicings of G are the same chord and a different sound.', app: 'The dropdown under each chord diagram switches voicing.' },
      { t: 'Arpeggio', d: 'A chord played one note at a time instead of all at once.' },
      { t: 'Transpose', d: 'Move everything up or down by the same interval, so the song keeps its shape in a new key — usually to suit a voice.', app: 'The Transpose stepper does it to the display; Transpose text rewrites the chart itself.' },
      { t: 'Capo', d: 'A clamp across the neck that raises every open string, letting you keep familiar shapes in a higher key.', app: 'The Capo stepper shows the resulting sounding key.' },
      { t: 'Relative minor', d: 'The minor key sharing a major key’s exact notes, built on its 6th degree — G major and E minor. Same notes, different home.', see: 'keys' },
      { t: 'Nashville numbers', d: 'Writing chords as scale degrees (1, 4, 5) instead of letters, so one chart works in any key. Handy when the singer wants it down a tone.', app: 'The Numbers toggle above the preview.' },
      { t: 'Pedal tone', aka: 'drone', d: 'One note held or repeated while the chords change over it.' },
    ]],
    ['Shape of a song', 'The parts, and what they are called.', [
      { t: 'Phrase', d: 'A musical sentence — usually two or four bars, about the length you would sing in one breath. Melodies are built out of phrases the way writing is built out of sentences.' },
      { t: 'Riff', d: 'A short repeated figure that defines a song — the thing you hum when naming it. Usually the guitar or bass, usually the same every time.', app: 'Write them in the Riffs & Solos panel.' },
      { t: 'Lick', d: 'A short idea used while soloing. The difference from a riff: a riff is the song’s, a lick is yours and moves between songs.' },
      { t: 'Hook', d: 'Whatever lodges in the listener’s head — a line, a riff, a rhythm. Not a section, a quality.' },
      { t: 'Verse', d: 'The section that carries the story. Same music each time, different words.' },
      { t: 'Chorus', d: 'The section that repeats words and all, usually the loudest and highest, usually with the title in it.' },
      { t: 'Pre-chorus', d: 'A short build between verse and chorus that makes the chorus feel like an arrival.' },
      { t: 'Bridge', d: 'A section that goes somewhere else — new chords, often once only, to stop the song circling.' },
      { t: 'Intro / Outro', d: 'What gets you in and what gets you out. An outro that repeats and fades is a vamp.' },
      { t: 'Refrain', d: 'A repeated line at the end of every verse. A chorus is a section; a refrain is a line.' },
      { t: 'Vamp', d: 'A short chord loop repeated as long as needed — to jam over, to talk over, or to end on.' },
      { t: 'Turnaround', d: 'A bar or two at the end of a section that walks you back to the top.' },
      { t: 'Break', d: 'A moment where most of the band drops out. A silence you fall through, then everyone returns.' },
      { t: 'Form', d: 'The running order of the sections, written as letters: AABA, or verse–chorus–verse.', app: 'The roadmap above the chart lists your sections in order.' },
      { t: 'Coda', d: 'A tail — an ending section that is not just another chorus.' },
    ]],
    ['Playing it', 'What your hands are doing.', [
      { t: 'Strum', d: 'Dragging a pick or fingers across the strings so the notes sound almost together.', app: 'Write patterns in the Strumming panel.' },
      { t: 'Downstroke / upstroke', d: 'Strumming towards the floor or back up. Downs feel heavier; ups are lighter and usually land on the offbeat.' },
      { t: 'Chuck', aka: 'muted strum', d: 'Relaxing the fretting hand so the strings hit as a percussive click rather than a chord. The × in a strumming pattern.' },
      { t: 'Palm mute', d: 'Resting the picking-hand palm on the strings near the bridge for a tight, damped sound.' },
      { t: 'Hammer-on / pull-off', d: 'Sounding a note by slamming a finger down, or by plucking as you lift off — without picking again.', app: 'h and p in the riff grid.' },
      { t: 'Bend', d: 'Pushing a string sideways to raise its pitch, usually a semitone or a whole tone.' },
      { t: 'Slide', d: 'Moving to another fret without lifting off, so the pitch travels there.' },
      { t: 'Barre', d: 'One finger flattened across several strings, making a shape movable up the neck.' },
      { t: 'Open string', d: 'A string played unfretted. Open strings ring longer and are why some keys are easier than others on a guitar.' },
      { t: 'Fret', d: 'A metal strip on the neck; also the space between two of them, and the verb for pressing a string down.' },
      { t: 'Tuning', d: 'Which notes the open strings are set to. Standard is E A D G B E; anything else is an alternate tuning — Drop D just lowers the 6th string a tone.', app: 'Set a song’s tuning in the Tuning box; the tuner listens against it.' },
      { t: 'Fingerpicking', d: 'Playing strings individually with the fingers instead of strumming across them.' },
      { t: 'Dynamics', d: 'How loud or soft you play, and the changing of it. The most-ignored tool a beginner has.' },
      { t: 'Tone', aka: 'timbre', d: 'The colour of a sound as distinct from its pitch — why the same note differs on a nylon string and a Telecaster.' },
    ]],
  ];

  // ---- small drawing helpers ------------------------------------------------

  const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

  // Name the note `semis` above `tonic`, landing it on the letter `letterSteps`
  // along the alphabet — that is what makes it Bb rather than A#. Returns null
  // when the honest spelling would need a double accidental (spelling upward
  // from a root like A# quickly does), so callers can fall back to a plain name
  // rather than printing C## at somebody trying to learn.
  function spellFrom(tonic, semis, letterSteps) {
    const letter = tonic[0].toUpperCase();
    const accShift = tonic.slice(1) === '#' ? 1 : tonic.slice(1) === 'b' ? -1 : 0;
    if (LETTER_PC[letter] === undefined) return null;
    const want = (LETTER_PC[letter] + accShift + semis) % 12;
    const target = LETTERS[(LETTERS.indexOf(letter) + letterSteps) % 7];
    let diff = (want - LETTER_PC[target] + 12) % 12;
    if (diff > 6) diff -= 12;
    if (Math.abs(diff) > 1) return null;
    return target + (diff === 0 ? '' : diff > 0 ? '#' : 'b');
  }

  // The note `semis` above a chord root, spelled properly where that is possible
  // and plainly where it is not.
  function toneName(rootName, semis) {
    const step = CHORD_LETTER_STEPS[semis];
    const spelled = step === undefined ? null : spellFrom(rootName, semis, step);
    if (spelled) return spelled;
    const pc = (keyPcOf(rootName) + semis) % 12;
    return /b/.test(rootName) ? FLAT_NAMES[pc] : SHARP_NAMES[pc];
  }

  // Spell a major scale so each degree lands on the next letter (G A B C D E F#,
  // never G A B C D E Gb). Takes a tonic like 'C', 'F#', 'Bb'.
  function majorScaleSpelled(tonic) {
    const letter = tonic[0].toUpperCase();
    const accShift = tonic.slice(1) === '#' ? 1 : tonic.slice(1) === 'b' ? -1 : 0;
    const tonicPc = (LETTER_PC[letter] + accShift + 12) % 12;
    const li = LETTERS.indexOf(letter);
    return MAJOR_IV.map((iv, d) => {
      const nextLetter = LETTERS[(li + d) % 7];
      const want = (tonicPc + iv) % 12;
      let diff = (want - LETTER_PC[nextLetter] + 12) % 12;
      if (diff > 6) diff -= 12;                       // -1 = flat, +1 = sharp
      const mark = diff === 0 ? '' : diff > 0 ? '#'.repeat(diff) : 'b'.repeat(-diff);
      return nextLetter + mark;
    });
  }

  // The seven chords a major key gives you, named and numbered.
  function diatonicChords(tonic) {
    const scale = majorScaleSpelled(tonic);
    return DEGREES.map((d, i) => ({ ...d, chord: scale[i] + d.q, note: scale[i] }));
  }

  function keyEntry(name) {
    return CIRCLE.find((c) => c.major === name) || CIRCLE[0];
  }

  // Chords have to be matched by the notes in them, never by how they are
  // spelled: the app writes shapes with sharps (A#) while the key that contains
  // them is named with flats (Bb), and a string compare would report every chord
  // in the song as borrowed. Root pitch class plus triad quality also lets G7
  // count as the same degree as G, which is what a player means by "the five".
  function triadIdOf(name) {
    const ci = typeof chordIntervals === 'function' ? chordIntervals(name) : null;
    if (!ci) return null;
    const has = (i) => ci.iv.includes(i);
    const third = has(4) ? 'M' : has(3) ? 'm' : 's';   // s: suspended, no third
    const fifth = has(6) ? 'd' : has(8) ? 'a' : 'P';
    return { pc: ci.rootPc, q: third + fifth, third, fifth };
  }

  // Where a chord sits relative to a key: the degree it is, the degree it would
  // be if its quality matched, or nothing at all.
  function degreeOf(chordName, dia) {
    const id = triadIdOf(chordName);
    if (!id) return { kind: 'unknown' };
    for (const d of dia) {
      const want = triadIdOf(d.chord);
      if (!want || want.pc !== id.pc) continue;
      if (want.q === id.q || id.third === 's') return { kind: 'in', degree: d };
      // Same root, different quality — a borrowed colour rather than a stranger.
      return { kind: 'altered', degree: d };
    }
    return { kind: 'out' };
  }

  function sigText(acc) {
    if (acc === 0) return 'no sharps or flats';
    const list = (acc > 0 ? SHARP_ORDER : FLAT_ORDER).slice(0, Math.abs(acc));
    return `${Math.abs(acc)} ${acc > 0 ? 'sharp' : 'flat'}${Math.abs(acc) === 1 ? '' : 's'} (${list.join(' ')})`;
  }

  // A keyboard with the given pitch classes lit and labelled. Reuses the app's
  // own keyboard renderer, so these look and behave like the chord panels.
  function keysLit(octaves, map, rootPc) {
    return pianoKeyboardSVG(octaves, (abs) => {
      const pc = abs % 12;
      if (!map.has(pc)) return { fill: 'plain', label: '' };
      return { fill: pc === rootPc ? 'root' : 'hi', label: map.get(pc) };
    });
  }

  function chordCard(name, gloss) {
    const frets = typeof resolveChord === 'function' ? resolveChord(name) : null;
    const dia = frets ? chordDiagramSVG(name, frets, null, '') : '';
    return `<div class="lrn-card">${dia}${gloss ? `<p class="lrn-gloss">${esc(gloss)}</p>` : ''}</div>`;
  }

  // ---- rhythm glyphs --------------------------------------------------------
  // Drawn rather than typed: the Unicode music symbols fall back to tofu on
  // plenty of systems, and these have to be legible at a glance from a stand.

  function noteSVG(kind) {
    const hollow = kind === 'whole' || kind === 'half';
    const stem = kind !== 'whole';
    const flags = kind === 'eighth' ? 1 : kind === 'sixteenth' ? 2 : 0;
    const dotted = /dotted/.test(kind);
    let p = `<ellipse cx="11" cy="30" rx="7.4" ry="5.4" transform="rotate(-20 11 30)"
      fill="${hollow ? 'none' : 'currentColor'}" stroke="currentColor" stroke-width="2"/>`;
    if (stem) p += '<path d="M17.8 28.4 V 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>';
    for (let i = 0; i < flags; i++) {
      const y = 5 + i * 7;
      p += `<path d="M17.8 ${y} q 8 3 7.5 11" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>`;
    }
    if (dotted) p += '<circle cx="23" cy="30" r="2" fill="currentColor"/>';
    return `<svg class="lrn-note" viewBox="0 0 30 40" width="30" height="40" aria-hidden="true">${p}</svg>`;
  }

  const NOTE_VALUES = [
    ['whole', 'Whole note', 'semibreve', '4 beats', 'one per bar of 4/4'],
    ['half', 'Half note', 'minim', '2 beats', 'two per bar'],
    ['quarter', 'Quarter note', 'crotchet', '1 beat', 'four per bar — the pulse you tap'],
    ['eighth', 'Eighth note', 'quaver', '½ beat', 'eight per bar — "1 & 2 & 3 & 4 &"'],
    ['sixteenth', 'Sixteenth note', 'semiquaver', '¼ beat', 'sixteen per bar — "1 e & a"'],
  ];

  const TIME_SIGS = [
    { sig: '4/4', count: ['1', '2', '3', '4'], gloss: 'Four quarter-note beats in a bar. Most songs you know.' },
    { sig: '3/4', count: ['1', '2', '3'], gloss: 'Three beats — a waltz. Emphasis lands on 1.' },
    { sig: '6/8', count: ['1', '2', '3', '4', '5', '6'], gloss: 'Six eighth notes, felt as two groups of three. A rolling, swung lilt.' },
    { sig: '2/4', count: ['1', '2'], gloss: 'Two beats — marches, polkas, plenty of country.' },
  ];

  // A bar of eight slots showing which are struck and in which direction. This
  // is the shape most people actually want when they say "strumming pattern".
  const STRUMS = [
    { name: 'All downs', pat: 'D-D-D-D-', gloss: 'Start here. One strum per beat, all downstrokes.' },
    { name: 'The one everybody knows', pat: 'D-DUxUDU', gloss: 'D · D-U · U-D-U. The x is a beat you skip — keep the hand moving through it.' },
    { name: 'Down-up eighths', pat: 'DUDUDUDU', gloss: 'Constant eighths. The hand never stops; that is what keeps it steady.' },
    { name: 'Folk / boom-chuck', pat: 'D-DUD-DU', gloss: 'Bass note on the beat, strum after it. Country and folk live here.' },
  ];

  function strumRow(pat) {
    const cells = pat.split('').map((c, i) => {
      const beat = i % 2 === 0 ? String(i / 2 + 1) : '&';
      const mark = c === 'D' ? '↓' : c === 'U' ? '↑' : c === 'x' ? '·' : '';
      const cls = c === 'x' ? 'lrn-strum-skip' : c === '-' ? 'lrn-strum-none' : '';
      return `<div class="lrn-strum-cell ${cls}"><span class="lrn-strum-mark">${mark}</span>` +
             `<span class="lrn-strum-beat">${beat}</span></div>`;
    }).join('');
    return `<div class="lrn-strum">${cells}</div>`;
  }

  // ---- circle of fifths -----------------------------------------------------

  function circleSVG(highlightMajor) {
    const R = 118, r = 82, cx = 140, cy = 140;
    let p = `<circle class="lrn-circle-ring" cx="${cx}" cy="${cy}" r="${R + 18}"/>` +
            `<circle class="lrn-circle-ring" cx="${cx}" cy="${cy}" r="${r + 16}"/>`;
    CIRCLE.forEach((k, i) => {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      const mx = cx + Math.cos(a) * R, my = cy + Math.sin(a) * R;
      const nx = cx + Math.cos(a) * r, ny = cy + Math.sin(a) * r;
      const on = k.major === highlightMajor;
      const rel = highlightMajor && k.minor === keyEntry(highlightMajor).minor;
      if (on) p += `<circle class="lrn-circle-hit" cx="${mx}" cy="${my}" r="17"/>`;
      if (rel) p += `<circle class="lrn-circle-hit lrn-circle-rel" cx="${nx}" cy="${ny}" r="15"/>`;
      p += `<text class="lrn-circle-maj${on ? ' on' : ''}" x="${mx}" y="${my + 5}" text-anchor="middle">${esc(k.major)}</text>`;
      p += `<text class="lrn-circle-min${rel ? ' on' : ''}" x="${nx}" y="${ny + 4}" text-anchor="middle">${esc(k.minor)}</text>`;
    });
    p += `<text class="lrn-circle-cap" x="${cx}" y="${cy - 4}" text-anchor="middle">outer: major</text>`;
    p += `<text class="lrn-circle-cap" x="${cx}" y="${cy + 12}" text-anchor="middle">inner: relative minor</text>`;
    return `<svg class="lrn-circle" viewBox="0 0 280 280" width="280" height="280">${p}</svg>`;
  }

  // ---- topic renderers ------------------------------------------------------
  // Each takes a context: { key, song, lens }. `key` is the major key the
  // generic examples are worked in — the song's own key when the lens is on, so
  // the theory arrives in the key under your fingers.

  function lensBlock(ctx, inner) {
    if (!ctx.lens || !ctx.song) return '';
    return `<section class="lrn-lens"><h3 class="lrn-lens-h">In “${esc(ctx.song.title || 'this song')}”` +
      (ctx.song.keyName ? ` · key of ${esc(ctx.song.keyName)}` : '') + `</h3>${inner}</section>`;
  }

  function topicChords(ctx) {
    const rootName = ctx.key;
    const rootPc = keyPcOf(rootName);
    let h = `<p class="lrn-lede">A chord is one note — the <b>root</b> — plus other notes measured
      from it in semitones (frets). Which distances you stack decides what the chord is called.
      Everything below is worked in <b>${esc(rootName)}</b>.</p>`;

    h += `<h3>The ruler: intervals from the root</h3>
      <p>Count frets up from the root on one string. Every chord name is shorthand for a
      selection from this list.</p>
      <table class="lrn-table"><thead><tr><th>Frets</th><th>Interval</th><th>Note in ${esc(rootName)}</th><th></th></tr></thead><tbody>` +
      INTERVALS.map(([n, name, steps, gloss]) => {
        const note = spellFrom(rootName, Number(n), steps) || SHARP_NAMES[(rootPc + Number(n)) % 12];
        return `<tr><td class="lrn-num">${n}</td><td>${esc(name)}</td>` +
          `<td class="lrn-note-cell">${esc(note)}</td><td class="lrn-dim">${esc(gloss)}</td></tr>`;
      }).join('') + '</tbody></table>';

    const fam = (list, title, lede) => {
      let out = `<h3>${title}</h3><p>${lede}</p><div class="lrn-cards">`;
      for (const f of list) {
        const name = rootName + f.q;
        const map = new Map(f.iv.map((i) => [(rootPc + i) % 12, INTERVAL_LABELS[i] || '']));
        const notes = f.iv.map((i) => toneName(rootName, i)).join(' · ');
        out += `<div class="lrn-card lrn-card-wide">
            <div class="lrn-card-h"><b>${esc(name)}</b> <span class="lrn-dim">${esc(f.label)}</span></div>
            <div class="lrn-formula">${esc(f.formula)}<span class="lrn-dim"> = ${esc(notes)}</span></div>
            ${keysLit(1, map, rootPc)}
            <p class="lrn-gloss">${esc(f.gloss)}</p>
          </div>`;
      }
      return out + '</div>';
    };

    h += fam(TRIADS, 'Triads — three notes',
      'Stack a 3rd and a 5th on the root and you have a triad. Change one note and you change the name.');
    h += fam(SEVENTHS, 'Sevenths — four notes',
      'Add one more note a 7th above the root. Note that <b>maj7</b> and plain <b>7</b> are different chords: a bare 7 means the <i>flattened</i> 7th.');

    h += `<h3>Reading the name</h3>
      <p>A chord name is read left to right, and each part answers one question.</p>
      <div class="lrn-anatomy">
        <div><span class="lrn-part">C</span><span class="lrn-part-l">root — which note it is built on</span></div>
        <div><span class="lrn-part">m</span><span class="lrn-part-l">quality — major (nothing), m, sus, dim, aug</span></div>
        <div><span class="lrn-part">7</span><span class="lrn-part-l">extension — an extra note stacked on top</span></div>
        <div><span class="lrn-part">/G</span><span class="lrn-part-l">slash — put this note in the bass instead</span></div>
      </div>
      <table class="lrn-table"><thead><tr><th>Name</th><th>Reads as</th></tr></thead><tbody>
        <tr><td class="lrn-note-cell">Am7</td><td>A minor, with a flat 7th on top</td></tr>
        <tr><td class="lrn-note-cell">Cmaj7</td><td>C major, with the <i>major</i> 7th — not the same as C7</td></tr>
        <tr><td class="lrn-note-cell">Bbsus4</td><td>B flat, 3rd replaced by the 4th</td></tr>
        <tr><td class="lrn-note-cell">D/F#</td><td>a D chord, but with F# as the lowest note</td></tr>
        <tr><td class="lrn-note-cell">F#m7b5</td><td>F# minor 7, and flatten the 5th as well</td></tr>
      </tbody></table>
      <p class="lrn-dim">A bare letter is always major. That is the one piece of shorthand
      everything else hangs off.</p>`;

    // Song lens: spell out the chords actually in the chart.
    if (ctx.lens && ctx.song && ctx.song.chords.length) {
      let inner = '<p>Your chords, taken apart:</p><table class="lrn-table"><thead><tr>' +
        '<th>Chord</th><th>Notes</th><th>Intervals</th></tr></thead><tbody>';
      for (const name of ctx.song.chords) {
        const ci = typeof chordIntervals === 'function' ? chordIntervals(name) : null;
        if (!ci) continue;
        const rootName = (name.match(/^[A-G][#b]?/) || [SHARP_NAMES[ci.rootPc]])[0];
        const notes = ci.iv.map((i) => toneName(rootName, i)).join(' · ');
        const ivs = ci.iv.map((i) => INTERVAL_LABELS[i] || i).join(' · ');
        inner += `<tr><td class="lrn-note-cell">${esc(name)}</td><td>${esc(notes)}</td>` +
                 `<td class="lrn-dim">${esc(ivs)}</td></tr>`;
      }
      h += lensBlock(ctx, inner + '</tbody></table>');
    }
    return h;
  }

  function topicKeys(ctx) {
    const k = keyEntry(ctx.key);
    const scale = majorScaleSpelled(k.major);
    const dia = diatonicChords(k.major);

    let h = `<p class="lrn-lede">A key is a set of seven notes and the chords they build.
      Songs mostly stay inside one, which is why a handful of chords keep turning up together.</p>`;

    h += `<h3>The circle of fifths</h3>
      <p>Each step clockwise is up a 5th and adds one sharp; each step the other way adds a flat.
      Neighbours share almost all their notes, which is why they sound at home together.</p>
      <div class="lrn-circle-wrap">${circleSVG(k.major)}
        <div class="lrn-circle-side">
          <div class="lrn-fact"><span class="lrn-fact-k">Key</span><b>${esc(k.major)} major</b></div>
          <div class="lrn-fact"><span class="lrn-fact-k">Signature</span>${esc(sigText(k.acc))}</div>
          <div class="lrn-fact"><span class="lrn-fact-k">Notes</span>${esc(scale.join(' '))}</div>
          <div class="lrn-fact"><span class="lrn-fact-k">Relative minor</span><b>${esc(k.minor)}</b></div>
        </div>
      </div>`;

    h += `<h3>Relative keys</h3>
      <p>Every major key shares its seven notes with a minor key — its <b>relative minor</b>, built on
      the 6th degree (three semitones down from the major). Same notes, different home note, entirely
      different mood. That is why a song can slip between them without anything sounding wrong.</p>
      <div class="lrn-rel">` +
      CIRCLE.map((c) => `<div class="lrn-rel-pair${c.major === k.major ? ' on' : ''}">
        <b>${esc(c.major)}</b><span>↔</span><b>${esc(c.minor)}</b></div>`).join('') +
      `</div>
      <p class="lrn-dim">Going the other way: a minor key's relative major is three semitones up.</p>`;

    h += `<h3>The chords in ${esc(k.major)}</h3>
      <p>Build a triad on each note of the scale using only notes from that scale, and the qualities
      fall out in a fixed pattern — the same pattern in every major key. Roman numerals name the
      degree, so a progression can be talked about in any key at once.</p>
      <table class="lrn-table"><thead><tr><th>Degree</th><th>Chord</th><th>Quality</th><th></th></tr></thead><tbody>` +
      dia.map((d) => `<tr><td class="lrn-num">${esc(d.num)}</td><td class="lrn-note-cell">${esc(d.chord)}</td>` +
        `<td>${esc(d.name)}</td><td class="lrn-dim">${esc(d.role)}</td></tr>`).join('') +
      `</tbody></table>
      <p>The three majors (<b>I IV V</b>) and the relative minor (<b>vi</b>) carry most popular music
      between them. A I–V–vi–IV in ${esc(k.major)} is
      <b>${esc(dia[0].chord)} ${esc(dia[4].chord)} ${esc(dia[5].chord)} ${esc(dia[3].chord)}</b>.</p>`;

    if (ctx.lens && ctx.song && ctx.song.chords.length) {
      const seen = ctx.song.chords.map((c) => ({ name: c, at: degreeOf(c, dia) }));
      const rows = seen.map(({ name, at }) => {
        const cell = (num, note) => `<tr><td class="lrn-note-cell">${esc(name)}</td>` +
          `<td class="lrn-num${num === '—' ? ' lrn-out' : ''}">${esc(num)}</td><td class="lrn-dim">${note}</td></tr>`;
        if (at.kind === 'in') return cell(at.degree.num, esc(at.degree.role));
        if (at.kind === 'altered') {
          return cell(at.degree.num + '*', `borrowed — the key would give you <b>${esc(at.degree.chord)}</b> here.
            Swapping a chord's quality like this is one of the oldest tricks there is`);
        }
        return cell('—', 'from outside the key — often the most interesting chord in the song');
      }).join('');
      const strangers = seen.filter((x) => x.at.kind !== 'in');
      // The relative minor is matched by notes too, so an Em spelled any way counts.
      const relId = triadIdOf(k.minor);
      const playsRelative = relId && seen.some((x) => {
        const id = triadIdOf(x.name);
        return id && id.pc === relId.pc && id.third === 'm';
      });
      h += lensBlock(ctx, `<p>Where your chords sit in ${esc(k.major)}:</p>
        <table class="lrn-table"><thead><tr><th>Chord</th><th>Degree</th><th></th></tr></thead><tbody>${rows}</tbody></table>` +
        (strangers.length
          ? `<p class="lrn-dim">${esc(strangers.map((x) => x.name).join(', '))} ${strangers.length === 1 ? 'sits' : 'sit'} outside
             the plain key. Borrowed chords are not mistakes — they are where the colour comes from.</p>`
          : `<p class="lrn-dim">Every chord in this song is diatonic to ${esc(k.major)} — which is why it hangs together so easily.</p>`) +
        `<p>Its relative minor is <b>${esc(k.minor)}</b>${
          playsRelative ? ' — which you are already playing.' : '.'}</p>`);
    }
    return h;
  }

  function topicInversions(ctx) {
    const rootName = ctx.key;
    const rootPc = keyPcOf(rootName);
    const demo = rootName;                       // a plain major triad in the working key
    const dia = diatonicChords(rootName);

    let h = `<p class="lrn-lede">An inversion is the same chord with a different note at the bottom.
      The notes do not change — only which one is lowest — and that is enough to change how the
      chord sits under a melody and how smoothly it joins to the next one.</p>`;

    h += `<h3>Same notes, different bass</h3><div class="lrn-cards">` +
      [0, 1, 2].map((inv) => {
        const label = ['Root position', '1st inversion', '2nd inversion'][inv];
        const bass = toneName(rootName, [0, 4, 7][inv]);
        const slash = inv === 0 ? demo : `${demo}/${bass}`;
        return `<div class="lrn-card lrn-card-wide">
          <div class="lrn-card-h"><b>${esc(label)}</b> <span class="lrn-dim">${esc(bass)} in the bass</span></div>
          ${typeof pianoChordSVG === 'function' ? pianoChordSVG(demo, inv, null, '') : ''}
          <p class="lrn-gloss">Written <b>${esc(slash)}</b>${inv === 0 ? ' — no slash needed.' : '.'}</p>
        </div>`;
      }).join('') + '</div>';

    h += `<h3>That is what a slash chord is</h3>
      <p>The name after the slash is simply the note you put in the bass.
      <b>${esc(demo)}/${esc(toneName(rootName, 4))}</b> is not a new chord — it is
      ${esc(demo)} with its 3rd underneath. Sometimes the bass note is not in the chord at all
      (a pedal tone), and that is fine too.</p>`;

    // Guitar triads on string sets, straight out of the engine that powers the
    // voicing dropdowns in the chord panels.
    if (typeof triadShape === 'function' && typeof TRIAD_SETS !== 'undefined') {
      h += `<h3>On the fretboard</h3>
        <p>Three notes on three adjacent strings. The same triad sits all over the neck — each
        inversion puts a different tone on the lowest string. These are the shapes behind the
        voicing dropdown on every chord diagram.</p>`;
      for (const set of TRIAD_SETS) {
        const cards = [0, 1, 2].map((inv) => {
          const frets = triadShape(rootPc, [0, 4, 7], set, inv);
          if (!frets) return '';
          return `<div class="lrn-card">${chordDiagramSVG(`${demo} · ${INV_NAMES[inv]}`, frets, null, '')}</div>`;
        }).join('');
        if (cards.trim()) h += `<h4 class="lrn-sub">${esc(set.name)} strings</h4><div class="lrn-cards">${cards}</div>`;
      }
    }

    h += `<h3>Why bother: voice leading</h3>
      <p>Inversions let the bass walk in steps instead of jumping. Compare these two ways through
      the same three chords in ${esc(rootName)}:</p>
      <div class="lrn-compare">
        <div><div class="lrn-compare-h">Root position throughout</div>
          <div class="lrn-chordline">${esc(dia[0].chord)} → ${esc(dia[4].chord)} → ${esc(dia[5].chord)}</div>
          <div class="lrn-dim">bass: ${esc(dia[0].note)} → ${esc(dia[4].note)} → ${esc(dia[5].note)} — it leaps about</div></div>
        <div><div class="lrn-compare-h">With one inversion</div>
          <div class="lrn-chordline">${esc(dia[0].chord)} → ${esc(dia[4].chord)}/${esc(dia[6].note)} → ${esc(dia[5].chord)}</div>
          <div class="lrn-dim">bass: ${esc(dia[0].note)} → ${esc(dia[6].note)} → ${esc(dia[5].note)} — it steps down, one note at a time</div></div>
      </div>
      <p class="lrn-dim">That descending bass line is one of the most-used moves in popular music.
      Nothing changed but the bass note.</p>`;

    if (ctx.lens && ctx.song && ctx.song.chords.length && typeof chordVoicings === 'function') {
      const rows = ctx.song.chords.map((c) => {
        const vs = chordVoicings(c).filter((v) => v.frets).map((v) => v.label);
        return `<tr><td class="lrn-note-cell">${esc(c)}</td><td class="lrn-dim">${esc(vs.join(', ') || 'default only')}</td></tr>`;
      }).join('');
      h += lensBlock(ctx, `<p>Voicings the app can already show you for this song's chords —
        pick one from the dropdown under any chord diagram:</p>
        <table class="lrn-table"><thead><tr><th>Chord</th><th>Available voicings</th></tr></thead><tbody>${rows}</tbody></table>`);
    }
    return h;
  }

  function topicRhythm(ctx) {
    let h = `<p class="lrn-lede">Pitch is only half of it. Rhythm is how long each sound lasts and
      where it falls against a steady pulse — and it is the half that makes a song recognisable
      when someone taps it on a table.</p>`;

    h += `<h3>Note values</h3>
      <p>Each note value is worth half the one above it. The counts here are for a bar of 4/4,
      the most common time signature there is.</p>
      <table class="lrn-table lrn-notes"><thead><tr><th></th><th>Name</th><th>Also called</th><th>Length</th><th></th></tr></thead><tbody>` +
      NOTE_VALUES.map(([kind, name, alt, len, gloss]) =>
        `<tr><td class="lrn-note-glyph">${noteSVG(kind)}</td><td><b>${esc(name)}</b></td>` +
        `<td class="lrn-dim">${esc(alt)}</td><td>${esc(len)}</td><td class="lrn-dim">${esc(gloss)}</td></tr>`).join('') +
      '</tbody></table>';

    h += `<h3>Dots and triplets</h3>
      <div class="lrn-cards">
        <div class="lrn-card lrn-card-wide">
          <div class="lrn-card-h">${noteSVG('dotted-quarter')}<b>A dot adds half again</b></div>
          <p class="lrn-gloss">A dotted quarter is one and a half beats. Dotted quarter + eighth is
          the long-short limp under a great many songs.</p>
        </div>
        <div class="lrn-card lrn-card-wide">
          <div class="lrn-card-h"><b>Triplets: three in the space of two</b></div>
          <p class="lrn-gloss">Three even notes squeezed into one beat — counted "1-trip-let".
          Swing feel is a cousin of this: the beat divides unevenly, long then short.</p>
        </div>
      </div>`;

    h += `<h3>Time signatures</h3>
      <p>The top number is how many beats are in a bar. The bottom says which note value gets one
      beat — 4 means a quarter note, 8 means an eighth.</p>
      <div class="lrn-timesigs">` +
      TIME_SIGS.map((t) => `<div class="lrn-timesig">
        <div class="lrn-sig">${esc(t.sig)}</div>
        <div class="lrn-count">${t.count.map((c, i) => `<span class="lrn-beat${i === 0 ? ' on' : ''}">${esc(c)}</span>`).join('')}</div>
        <p class="lrn-gloss">${esc(t.gloss)}</p>
      </div>`).join('') + '</div>';

    h += `<h3>Counting the subdivisions</h3>
      <p>Say these out loud while you tap the beat. Everything you strum lands on one of these
      syllables.</p>
      <table class="lrn-table"><tbody>
        <tr><td>Quarters</td><td class="lrn-count-row">1 &nbsp; 2 &nbsp; 3 &nbsp; 4</td></tr>
        <tr><td>Eighths</td><td class="lrn-count-row">1 &amp; 2 &amp; 3 &amp; 4 &amp;</td></tr>
        <tr><td>Sixteenths</td><td class="lrn-count-row">1 e &amp; a 2 e &amp; a 3 e &amp; a 4 e &amp; a</td></tr>
      </tbody></table>`;

    h += `<h3>Strumming patterns</h3>
      <p>A pattern is just which of those slots you hit, and in which direction. The hand keeps
      moving down-up throughout — on a skipped slot you simply miss the strings.</p>` +
      STRUMS.map((s) => `<div class="lrn-strum-block">
        <div class="lrn-card-h"><b>${esc(s.name)}</b></div>
        ${strumRow(s.pat)}
        <p class="lrn-gloss">${esc(s.gloss)}</p>
      </div>`).join('');

    const bpm = ctx.song && ctx.song.tempo;
    h += lensBlock(ctx, bpm
      ? `<p>This song is set to <b>${esc(bpm)} bpm</b>. Open the metronome from the toolbar and it
         will count you in at that tempo — practise a new pattern at half speed first, then bring
         it up. Steady beats fast every time.</p>`
      : `<p>No tempo is set for this song yet. Put one in the Tempo box in the song bar (or tap it
         in on the metronome) and the count-in and performance view will both use it.</p>`);
    return h;
  }

  function topicWords(ctx) {
    const topicTitle = (id) => (TOPICS.find((t) => t.id === id) || {}).title || id;
    let h = `<p class="lrn-lede">The words that get used around you as though everyone
      already knows them. Nothing here is complicated once it is said plainly.</p>
      <div class="lrn-find">
        <input id="lrn-find" type="search" placeholder="Find a word…" spellcheck="false"
          aria-label="Filter the vocabulary" />
        <span id="lrn-find-none" class="lrn-dim" hidden>No word matches that.</span>
      </div>`;

    for (const [group, blurb, terms] of VOCAB) {
      h += `<section class="lrn-group"><h3>${esc(group)}</h3><p class="lrn-dim">${esc(blurb)}</p><dl class="lrn-defs">`;
      for (const item of terms) {
        // data-term carries a lowercased haystack so the filter can match a
        // definition, not just a heading.
        const hay = (item.t + ' ' + (item.aka || '') + ' ' + item.d + ' ' + (item.app || '')).toLowerCase();
        h += `<div class="lrn-def" data-term="${esc(hay)}">
          <dt>${esc(item.t)}${item.aka ? `<span class="lrn-aka">also: ${esc(item.aka)}</span>` : ''}</dt>
          <dd>${item.d}` +
          (item.app ? `<span class="lrn-inapp">In the app: ${item.app}</span>` : '') +
          (item.see ? ` <button class="lrn-see" data-goto="${item.see}">See ${esc(topicTitle(item.see))} →</button>` : '') +
          `</dd></div>`;
      }
      h += '</dl></section>';
    }

    // The lens turns the glossary into a read-out of your own song: the same
    // words, with what they currently are.
    if (ctx.lens && ctx.song) {
      const s = ctx.song;
      const rows = [
        ['Key', s.keyName ? s.keyName + ' major' : null],
        ['Tempo', s.tempo ? s.tempo + ' BPM' : null],
        ['Chords', s.chords.length ? s.chords.join(' · ') : null],
        ['Riffs', s.riffCount ? `${s.riffCount} written` : null],
        ['Strumming patterns', s.strumCount ? `${s.strumCount} written` : null],
        ['Sections', s.sections && s.sections.length ? s.sections.join(' → ') : null],
      ].filter(([, v]) => v);
      if (rows.length) {
        h += lensBlock(ctx, `<p>The same words, pointed at what you have open:</p>
          <table class="lrn-table"><tbody>` +
          rows.map(([k, v]) => `<tr><td class="lrn-num">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('') +
          `</tbody></table>`);
      }
    }
    return h;
  }

  // Pitch class of a key name like 'C', 'F#', 'Bb'.
  function keyPcOf(name) {
    const letter = name[0].toUpperCase();
    const acc = name.slice(1) === '#' ? 1 : name.slice(1) === 'b' ? -1 : 0;
    return ((LETTER_PC[letter] + acc) % 12 + 12) % 12;
  }

  const TOPICS = [
    { id: 'chords', title: 'Chords', blurb: 'How a chord is built, and how the name tells you', render: topicChords },
    { id: 'keys', title: 'Keys', blurb: 'Key signatures, relative keys, and the chords a key gives you', render: topicKeys },
    { id: 'inversions', title: 'Inversions', blurb: 'Same notes, different bass — and why it matters', render: topicInversions },
    { id: 'rhythm', title: 'Rhythm', blurb: 'Note values, time signatures and strumming', render: topicRhythm },
    { id: 'words', title: 'Words', blurb: 'Plain definitions of the vocabulary — bars, phrases, modes, riffs', render: topicWords },
  ];

  // The key the generic examples are worked in. With the lens on we use the
  // song's own key so the theory arrives in the key under your fingers; C is the
  // neutral default because it has no sharps or flats to explain away.
  function workingKey(ctx) {
    if (ctx.lens && ctx.song && ctx.song.keyName) {
      const hit = CIRCLE.find((c) => keyPcOf(c.major) === keyPcOf(ctx.song.keyName));
      if (hit) return hit.major;
    }
    return 'C';
  }

  function render(topicId, ctx) {
    const topic = TOPICS.find((t) => t.id === topicId) || TOPICS[0];
    const full = Object.assign({}, ctx, { key: workingKey(ctx) });
    return `<article class="lrn-topic" data-topic="${topic.id}">
      <h2 class="lrn-h2">${esc(topic.title)}</h2>${topic.render(full)}</article>`;
  }

  root.Learn = {
    TOPICS,
    render,
    // The theory engine, for callers that want the facts rather than a chart —
    // the theory panel beside the chord diagrams is built from these, so the
    // panel and the Learn charts can never disagree about a key.
    theory: {
      majorScaleSpelled, diatonicChords, degreeOf, triadIdOf,
      keyEntry, keyPcOf, sigText, spellFrom, toneName,
      INTERVALS, CIRCLE, DEGREES,
    },
    // exposed for tests
    _internals: { majorScaleSpelled, diatonicChords, keyPcOf, sigText, CIRCLE },
  };
})(typeof window !== 'undefined' ? window : globalThis);
