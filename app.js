/* Guitar Tab Writer — chords-over-lyrics editor.
   No build step, no dependencies. State lives in localStorage; songs
   can also be exported to / imported from plain text files. */

'use strict';

const STORE_KEY = 'gtw.songs.v1';
const LAST_KEY = 'gtw.lastId';
const PREFS_KEY = 'gtw.prefs';

// ---- Chord model & transposition ------------------------------------------

const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// One chord piece: root (+accidental) + suffix, optional /bass.
const CHORD_RE = /^([A-G])([#b]?)([^/\s]*)(?:\/([A-G])([#b]?))?$/;

function isChord(token) {
  return CHORD_RE.test(token);
}

function shiftNote(letter, accidental, semitones, preferFlat) {
  let idx = NOTE_INDEX[letter];
  if (accidental === '#') idx += 1;
  else if (accidental === 'b') idx -= 1;
  idx = (((idx + semitones) % 12) + 12) % 12;
  return (preferFlat ? FLAT : SHARP)[idx];
}

function transposeChord(token, semitones) {
  if (semitones === 0) return token;
  const m = token.match(CHORD_RE);
  if (!m) return token;
  const [, root, acc, suffix, bassRoot, bassAcc] = m;
  // Flats read better for a handful of keys; sharps otherwise.
  const preferFlat = acc === 'b' || bassAcc === 'b';
  let out = shiftNote(root, acc, semitones, preferFlat) + suffix;
  if (bassRoot) out += '/' + shiftNote(bassRoot, bassAcc || '', semitones, preferFlat);
  return out;
}

// ---- Rendering -------------------------------------------------------------

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function renderLine(raw, semitones) {
  const trimmed = raw.trim();

  if (trimmed === '') return '<div class="blank"></div>';

  // Page break: {page} / {pagebreak} / {newpage} on their own line.
  if (/^\{(page|pagebreak|newpage|page break)\}$/i.test(trimmed)) {
    return '<div class="page-break"></div>';
  }

  // Section labels: {Verse 1}  or a lone bracket token that isn't a chord: [Chorus]
  let sectionMatch = trimmed.match(/^\{(.+)\}$/);
  const loneBracket = trimmed.match(/^\[(.+)\]$/);
  if (!sectionMatch && loneBracket && !isChord(loneBracket[1])) sectionMatch = loneBracket;
  if (sectionMatch) {
    return `<div class="section">${escapeHtml(sectionMatch[1])}</div>`;
  }

  // Walk the line, pulling out [chords] and tracking their column in the lyric.
  const chords = [];
  let lyric = '';
  const re = /\[([^\]]*)\]/g;
  let last = 0, m;
  while ((m = re.exec(raw)) !== null) {
    lyric += raw.slice(last, m.index);
    const text = isChord(m[1]) ? transposeChord(m[1], semitones) : m[1];
    chords.push({ pos: lyric.length, text });
    last = m.index + m[0].length;
  }
  lyric += raw.slice(last);

  if (chords.length === 0) {
    return `<div class="line plainline">${escapeHtml(raw)}</div>`;
  }

  // Lay chords onto their own line, nudging right so they never collide.
  let chordLine = '';
  for (const c of chords) {
    let pos = c.pos;
    if (pos < chordLine.length) pos = chordLine.length + 1;
    chordLine += ' '.repeat(pos - chordLine.length) + c.text;
  }

  const chordHtml = `<div class="line chordline">${escapeHtml(chordLine) || ' '}</div>`;
  if (lyric.trim() === '') return chordHtml; // instrumental / chords only
  return chordHtml + `<div class="line lyricline">${escapeHtml(lyric)}</div>`;
}

function render(body, semitones) {
  if (!body.trim()) {
    return '<div class="empty-hint">Nothing yet — start typing in the editor. ' +
      'Chords go in brackets, e.g. <code>[Am]</code>.</div>';
  }
  return body.split('\n').map((l) => renderLine(l, semitones)).join('');
}

// ---- Storage ---------------------------------------------------------------

function loadSongs() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSongs(songs) {
  localStorage.setItem(STORE_KEY, JSON.stringify(songs));
}

let idCounter = Date.now();
function newId() {
  return 's' + (idCounter++).toString(36);
}

// ---- App state -------------------------------------------------------------

const el = {
  list: document.getElementById('song-list'),
  count: document.getElementById('song-count'),
  title: document.getElementById('title-input'),
  artist: document.getElementById('artist-input'),
  editor: document.getElementById('editor'),
  preview: document.getElementById('preview'),
  previewBody: document.getElementById('preview-body'),
  printHeader: document.getElementById('print-header'),
  trAmount: document.getElementById('tr-amount'),
  capoAmount: document.getElementById('capo-amount'),
  status: document.getElementById('save-status'),
  capoBanner: document.getElementById('capo-banner'),
  diagrams: document.getElementById('chord-diagrams'),
  harmonica: document.getElementById('harmonica-panel'),
  toggleDiagrams: document.getElementById('toggle-diagrams'),
  toggleHarmonica: document.getElementById('toggle-harmonica'),
};

let songs = loadSongs();
let currentId = null;

function loadPrefs() {
  try {
    return Object.assign({ diagrams: true, harmonica: true }, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'));
  } catch {
    return { diagrams: true, harmonica: true };
  }
}
let prefs = loadPrefs();

function currentSong() {
  return songs.find((s) => s.id === currentId) || null;
}

function blankSong() {
  return { id: newId(), title: '', artist: '', body: '', transpose: 0, capo: 0, key: null, updated: Date.now() };
}

function selectSong(id) {
  const s = songs.find((x) => x.id === id);
  if (!s) return;
  currentId = id;
  localStorage.setItem(LAST_KEY, id);
  el.title.value = s.title;
  el.artist.value = s.artist;
  el.editor.value = s.body;
  el.trAmount.textContent = (s.transpose > 0 ? '+' : '') + s.transpose;
  el.capoAmount.textContent = s.capo || 0;
  renderPreview();
  renderList();
}

// The chords on the sheet are the shapes you finger; only transpose moves them.
// A capo doesn't change the shapes — it raises the pitch they sound at.
function shapeShift(s) {
  return s.transpose;
}

function renderPreview() {
  const s = currentSong();
  if (!s) return;
  el.previewBody.innerHTML = render(s.body, shapeShift(s));
  updatePrintHeader(s);
  renderCapoBanner(s);
  renderDiagrams(s);
  renderHarmonica(s);
}

// First chord's root is our best guess at the tonic.
function firstChordPc(body) {
  const m = body.match(/\[([^\]]*)\]/g);
  if (!m) return null;
  for (const tok of m) {
    const name = tok.slice(1, -1);
    const cm = name.match(CHORD_RE);
    if (cm) return chordRootPc(cm[1], cm[2]);
  }
  return null;
}

// What the guitar actually sounds: the fingered key raised by transpose + capo.
function soundingKeyPc(s) {
  if (s.key !== null && s.key !== undefined) return s.key; // manual override
  const pc = firstChordPc(s.body);
  if (pc === null) return null;
  return (((pc + s.transpose + (s.capo || 0)) % 12) + 12) % 12;
}

function renderCapoBanner(s) {
  if (!s.capo) { el.capoBanner.innerHTML = ''; return; }
  const pc = soundingKeyPc(s);
  const sounds = pc === null ? '' : ` &middot; these shapes sound in <b>${HARP_NAMES[pc]}</b>`;
  el.capoBanner.innerHTML = `<b>Capo ${s.capo}</b> &mdash; finger the shapes shown below${sounds}`;
}

function renderDiagrams(s) {
  if (!prefs.diagrams) { el.diagrams.innerHTML = ''; return; }
  const shift = shapeShift(s);
  const matches = s.body.match(/\[([^\]]*)\]/g) || [];
  const seen = new Set();
  let html = '';
  for (const tok of matches) {
    const name = tok.slice(1, -1);
    if (!isChord(name)) continue;
    const shown = transposeChord(name, shift);
    if (seen.has(shown)) continue;
    seen.add(shown);
    html += chordDiagramSVG(shown, resolveChord(shown));
  }
  el.diagrams.innerHTML = html;
}

function renderHarmonica(s) {
  if (!prefs.harmonica) { el.harmonica.innerHTML = ''; return; }
  const pc = soundingKeyPc(s);
  if (pc === null) { el.harmonica.innerHTML = ''; return; }
  const r = harmonicaRecs(pc);
  const auto = s.key === null || s.key === undefined;
  let opts = `<option value="auto"${auto ? ' selected' : ''}>Auto (${HARP_NAMES[pc]})</option>`;
  for (let i = 0; i < 12; i++) {
    opts += `<option value="${i}"${!auto && s.key === i ? ' selected' : ''}>${HARP_NAMES[i]}</option>`;
  }
  el.harmonica.innerHTML =
    `<div class="hp-head"><span class="hp-title">Harmonica</span>` +
    `<span class="muted">Song key</span>` +
    `<select id="key-select">${opts}</select></div>` +
    `<div class="hp-grid">` +
      `<div class="hp-item"><b>${r.cross}</b><small>2nd / cross &middot; blues, folk</small></div>` +
      `<div class="hp-item"><b>${r.straight}</b><small>1st / straight &middot; melody</small></div>` +
      `<div class="hp-item"><b>${r.slant}</b><small>3rd / slant &middot; minor, Dorian</small></div>` +
    `</div>` +
    `<div class="hp-note">Diatonic harps above; any key works on a chromatic harmonica.</div>`;
  document.getElementById('key-select').addEventListener('change', (e) => {
    const cur = currentSong();
    cur.key = e.target.value === 'auto' ? null : parseInt(e.target.value, 10);
    cur.updated = Date.now();
    saveSongs(songs);
    renderPreview();
  });
}

function updatePrintHeader(s) {
  const parts = [];
  if (s.title) parts.push(`<h2>${escapeHtml(s.title)}</h2>`);
  if (s.artist) parts.push(`<div class="artist">${escapeHtml(s.artist)}</div>`);
  el.printHeader.innerHTML = parts.join('');
}

function renderList() {
  el.count.textContent = songs.length ? songs.length + '' : '';
  const ordered = [...songs].sort((a, b) => b.updated - a.updated);
  el.list.innerHTML = '';
  for (const s of ordered) {
    const li = document.createElement('li');
    li.className = 'song-item' + (s.id === currentId ? ' active' : '');
    li.innerHTML =
      `<span class="st"><b>${escapeHtml(s.title || 'Untitled')}</b>` +
      `<small>${escapeHtml(s.artist || '')}</small></span>` +
      `<button class="del" title="Delete">&times;</button>`;
    li.querySelector('.st').addEventListener('click', () => selectSong(s.id));
    li.querySelector('.del').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSong(s.id);
    });
    el.list.appendChild(li);
  }
}

function deleteSong(id) {
  const s = songs.find((x) => x.id === id);
  if (!s) return;
  if (!confirm(`Delete "${s.title || 'Untitled'}"? This can't be undone.`)) return;
  songs = songs.filter((x) => x.id !== id);
  saveSongs(songs);
  if (currentId === id) {
    if (songs.length) selectSong([...songs].sort((a, b) => b.updated - a.updated)[0].id);
    else createSong();
  } else {
    renderList();
  }
}

function createSong() {
  const s = blankSong();
  songs.push(s);
  saveSongs(songs);
  selectSong(s.id);
  el.title.focus();
}

let saveTimer = null;
function commit() {
  const s = currentSong();
  if (!s) return;
  s.title = el.title.value;
  s.artist = el.artist.value;
  s.body = el.editor.value;
  s.updated = Date.now();
  el.status.textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveSongs(songs);
    el.status.textContent = 'Saved';
    renderList();
  }, 400);
}

function setTranspose(delta) {
  const s = currentSong();
  if (!s) return;
  s.transpose = Math.max(-11, Math.min(11, s.transpose + delta));
  el.trAmount.textContent = (s.transpose > 0 ? '+' : '') + s.transpose;
  s.updated = Date.now();
  saveSongs(songs);
  renderPreview();
}

function setCapo(delta) {
  const s = currentSong();
  if (!s) return;
  s.capo = Math.max(0, Math.min(11, (s.capo || 0) + delta));
  el.capoAmount.textContent = s.capo;
  s.updated = Date.now();
  saveSongs(songs);
  renderPreview();
}

// ---- Import / Export -------------------------------------------------------

function exportSong() {
  const s = currentSong();
  if (!s) return;
  let out = '';
  if (s.title) out += `{title: ${s.title}}\n`;
  if (s.artist) out += `{artist: ${s.artist}}\n`;
  if (s.transpose) out += `{transpose: ${s.transpose}}\n`;
  if (s.capo) out += `{capo: ${s.capo}}\n`;
  if (out) out += '\n';
  out += s.body;
  const blob = new Blob([out], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (s.title || 'song').replace(/[^\w\-]+/g, '_') + '.cho';
  a.click();
  URL.revokeObjectURL(url);
}

function importText(text, fallbackTitle) {
  const s = blankSong();
  const lines = text.split('\n');
  const body = [];
  let sawDirective = false;
  for (const line of lines) {
    const t = line.match(/^\{(title|artist|transpose|capo)\s*:\s*(.*)\}\s*$/i);
    if (t) {
      sawDirective = true;
      const key = t[1].toLowerCase();
      if (key === 'title') s.title = t[2].trim();
      else if (key === 'artist') s.artist = t[2].trim();
      else if (key === 'transpose') s.transpose = parseInt(t[2], 10) || 0;
      else if (key === 'capo') s.capo = Math.max(0, Math.min(11, parseInt(t[2], 10) || 0));
    } else {
      body.push(line);
    }
  }
  // Drop one leading blank line left after the directive block.
  if (sawDirective && body[0] === '') body.shift();
  s.body = body.join('\n');
  if (!s.title) s.title = fallbackTitle;
  songs.push(s);
  saveSongs(songs);
  selectSong(s.id);
}

// ---- Wire up ---------------------------------------------------------------

el.editor.addEventListener('input', () => {
  const s = currentSong();
  if (s) el.previewBody.innerHTML = render(el.editor.value, s.transpose);
  commit();
});
el.title.addEventListener('input', () => updatePrintHeader({ title: el.title.value, artist: el.artist.value }));
el.artist.addEventListener('input', () => updatePrintHeader({ title: el.title.value, artist: el.artist.value }));
el.title.addEventListener('input', commit);
el.artist.addEventListener('input', commit);

document.getElementById('new-btn').addEventListener('click', createSong);
document.getElementById('tr-up').addEventListener('click', () => setTranspose(1));
document.getElementById('tr-down').addEventListener('click', () => setTranspose(-1));
document.getElementById('capo-up').addEventListener('click', () => setCapo(1));
document.getElementById('capo-down').addEventListener('click', () => setCapo(-1));

function savePrefs() { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); }
el.toggleDiagrams.addEventListener('change', () => {
  prefs.diagrams = el.toggleDiagrams.checked;
  savePrefs();
  renderPreview();
});
el.toggleHarmonica.addEventListener('change', () => {
  prefs.harmonica = el.toggleHarmonica.checked;
  savePrefs();
  renderPreview();
});
document.getElementById('export-btn').addEventListener('click', exportSong);
document.getElementById('print-btn').addEventListener('click', () => window.print());

document.getElementById('pagebreak-btn').addEventListener('click', () => {
  const start = el.editor.selectionStart;
  const val = el.editor.value;
  // Put the marker on its own line, with blank spacing around it.
  const before = val.slice(0, start);
  const after = val.slice(start);
  const pre = before && !before.endsWith('\n') ? '\n' : '';
  const insert = pre + '{page}\n';
  el.editor.value = before + insert + after;
  const caret = start + insert.length;
  el.editor.selectionStart = el.editor.selectionEnd = caret;
  el.editor.focus();
  el.editor.dispatchEvent(new Event('input'));
});

const importInput = document.getElementById('import-input');
document.getElementById('import-btn').addEventListener('click', () => importInput.click());
importInput.addEventListener('change', () => {
  const file = importInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const name = file.name.replace(/\.[^.]+$/, '');
    importText(String(reader.result), name);
  };
  reader.readAsText(file);
  importInput.value = '';
});

// Support Tab key in the editor (insert two spaces instead of leaving field).
el.editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = el.editor.selectionStart, end = el.editor.selectionEnd;
    el.editor.value = el.editor.value.slice(0, start) + '  ' + el.editor.value.slice(end);
    el.editor.selectionStart = el.editor.selectionEnd = start + 2;
    el.editor.dispatchEvent(new Event('input'));
  }
});

// ---- Boot ------------------------------------------------------------------

function boot() {
  el.toggleDiagrams.checked = prefs.diagrams;
  el.toggleHarmonica.checked = prefs.harmonica;
  if (!songs.length) {
    // Seed with a short example so the app isn't blank on first run.
    songs.push({
      id: newId(),
      title: 'Stand By Me',
      artist: 'Ben E. King',
      body: '{Verse 1}\n[G]When the night has [Em]come\n[G]And the land is [G]dark\n' +
        '[C]And the moon is the [D]only light we\'ll [G]see\n\n' +
        '{Chorus}\nNo I [G]won\'t be a[Em]fraid\nNo I [G]won\'t be a[G]fraid',
      transpose: 0,
      updated: Date.now(),
    });
    saveSongs(songs);
  }
  const last = localStorage.getItem(LAST_KEY);
  const startId = songs.some((s) => s.id === last)
    ? last
    : [...songs].sort((a, b) => b.updated - a.updated)[0].id;
  selectSong(startId);
}

boot();
