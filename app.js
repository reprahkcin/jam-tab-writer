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

// One chord piece: root (+accidental) + a quality suffix built only from real
// chord tokens, optional /bass. The strict suffix stops ordinary words like
// "Chorus" or "Bridge" (which start with A–G) from being read as chords.
const CHORD_RE = /^([A-G])([#b]?)((?:maj|min|sus|add|aug|dim|m|M|Δ|ø|°|\+|-|[0-9]|#|b|\(|\))*)(?:\/([A-G])([#b]?))?$/;

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

  // Section labels: {Verse 1}  or a single lone bracket token that isn't a
  // chord: [Chorus]. The bracket must hold no inner brackets, so a chords-only
  // line like "[Dm]  [Am]  [F]" is NOT mistaken for a section.
  let sectionMatch = trimmed.match(/^\{(.+)\}$/);
  const loneBracket = trimmed.match(/^\[([^\[\]]+)\]$/);
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

// ---- Folder mode (File System Access API) ----------------------------------
// In 'folder' mode, songs are read from and saved directly to .cho files on
// disk instead of localStorage. The directory handle is remembered in
// IndexedDB so the folder can be reopened with one click (and one permission
// grant) next session.

let mode = 'local';           // 'local' | 'folder'
let dirHandle = null;         // FileSystemDirectoryHandle for the open folder
const fileHandles = {};       // song id -> FileSystemFileHandle

const IDB = { name: 'gtw', store: 'kv' };
function idbReq(fn) {
  return new Promise((resolve) => {
    const open = indexedDB.open(IDB.name, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(IDB.store);
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      try { fn(open.result, resolve); } catch { resolve(null); }
    };
  });
}
function idbGet(key) {
  return idbReq((db, resolve) => {
    const r = db.transaction(IDB.store).objectStore(IDB.store).get(key);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => resolve(null);
  });
}
function idbSet(key, val) {
  return idbReq((db, resolve) => {
    const tx = db.transaction(IDB.store, 'readwrite');
    tx.objectStore(IDB.store).put(val, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

async function scanDir(dir, prefix, out) {
  for await (const entry of dir.values()) {
    if (entry.kind === 'file' && entry.name.endsWith('.cho')) {
      out.push({ name: entry.name, path: prefix + entry.name, handle: entry });
    } else if (entry.kind === 'directory') {
      await scanDir(entry, prefix + entry.name + '/', out);
    }
  }
}

async function enterFolder(handle) {
  const found = [];
  await scanDir(handle, '', found);
  if (!found.length) {
    alert('No .cho files found in that folder (looked recursively).');
    return;
  }
  found.sort((a, b) => a.path.localeCompare(b.path));
  dirHandle = handle;
  mode = 'folder';
  songs = [];
  for (const k of Object.keys(fileHandles)) delete fileHandles[k];
  for (const f of found) {
    const text = await (await f.handle.getFile()).text();
    const s = parseCho(text, f.name.replace(/\.cho$/, ''));
    s.id = newId();
    s.path = f.path;
    fileHandles[s.id] = f.handle;
    songs.push(s);
  }
  await idbSet('dirHandle', handle);
  updateModeUI();
  selectSong(songs[0].id);
}

async function openFolder() {
  if (!window.showDirectoryPicker) {
    alert('Folder mode needs Chrome or Edge, served over http://localhost (not file://).');
    return;
  }
  let handle;
  try {
    handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch { return; } // user cancelled
  await enterFolder(handle);
}

async function reopenFolder() {
  const handle = await idbGet('dirHandle');
  if (!handle) return;
  try {
    let perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') perm = await handle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return;
    await enterFolder(handle);
  } catch {
    alert('Could not reopen the folder — please pick it again.');
  }
}

function closeFolder() {
  mode = 'local';
  dirHandle = null;
  songs = loadSongs();
  updateModeUI();
  if (!songs.length) createSong();
  else selectSong([...songs].sort((a, b) => b.updated - a.updated)[0].id);
}

async function writeSong(s) {
  const h = fileHandles[s.id];
  if (!h) return;
  const w = await h.createWritable();
  await w.write(songToCho(s));
  await w.close();
}

// Persist the current song: to its file in folder mode, else to localStorage.
let persistTimer = null;
function schedulePersist() {
  const s = currentSong();
  if (!s) return;
  el.status.textContent = 'Saving…';
  clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    if (mode === 'folder') {
      try { await writeSong(s); el.status.textContent = 'Saved · ' + (s.path || 'file'); }
      catch { el.status.textContent = 'Save failed'; }
    } else {
      saveSongs(songs);
      el.status.textContent = 'Saved';
    }
    renderList();
  }, mode === 'folder' ? 600 : 400);
}

// ---- App state -------------------------------------------------------------

const el = {
  list: document.getElementById('song-list'),
  count: document.getElementById('song-count'),
  title: document.getElementById('title-input'),
  artist: document.getElementById('artist-input'),
  editor: document.getElementById('editor'),
  sectionBar: document.getElementById('section-bar'),
  palette: document.getElementById('chord-palette'),
  preview: document.getElementById('preview'),
  previewBody: document.getElementById('preview-body'),
  printHeader: document.getElementById('print-header'),
  trAmount: document.getElementById('tr-amount'),
  capoAmount: document.getElementById('capo-amount'),
  status: document.getElementById('save-status'),
  capoBanner: document.getElementById('capo-banner'),
  diagrams: document.getElementById('chord-diagrams'),
  leadDiagrams: document.getElementById('lead-diagrams'),
  scalePanel: document.getElementById('scale-panel'),
  rhythmLabel: document.getElementById('rhythm-label'),
  leadSection: document.getElementById('lead-section'),
  harmonica: document.getElementById('harmonica-panel'),
  toggleDiagrams: document.getElementById('toggle-diagrams'),
  toggleLead: document.getElementById('toggle-lead'),
  toggleHarmonica: document.getElementById('toggle-harmonica'),
};

let songs = loadSongs();
let currentId = null;

function loadPrefs() {
  const defaults = {
    diagrams: true, harmonica: true, lead: true, chordMode: 'shapes',
    scaleType: 'majPent', voicings: { rhythm: {}, lead: {} },
  };
  let p = defaults;
  try { p = Object.assign(defaults, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch { /* keep defaults */ }
  if (!p.voicings || Array.isArray(p.voicings)) p.voicings = { rhythm: {}, lead: {} };
  p.voicings.rhythm = p.voicings.rhythm || {};
  p.voicings.lead = p.voicings.lead || {};
  return p;
}
let prefs = loadPrefs();

function currentSong() {
  return songs.find((s) => s.id === currentId) || null;
}

function blankSong() {
  return { id: newId(), title: '', artist: '', body: '', transpose: 0, capo: 0, key: null, scaleRoot: null, focusChord: null, updated: Date.now() };
}

function selectSong(id) {
  const s = songs.find((x) => x.id === id);
  if (!s) return;
  // Flush any pending debounced write for the outgoing song before switching,
  // so a quick switch never drops unsaved edits to its file.
  if (mode === 'folder' && currentId && currentId !== id) {
    const prev = currentSong();
    clearTimeout(persistTimer);
    if (prev) writeSong(prev).catch(() => {});
  }
  currentId = id;
  if (mode === 'local') localStorage.setItem(LAST_KEY, id);
  el.title.value = s.title;
  el.artist.value = s.artist;
  el.editor.value = s.body;
  el.trAmount.textContent = (s.transpose > 0 ? '+' : '') + s.transpose;
  el.capoAmount.textContent = s.capo || 0;
  renderPreview();
  renderPalette();
  renderList();
}

// Two views of every chord:
//  - shape:    what your fingers fret. Moves with transpose; a capo does NOT
//              change the shape ("still a G").
//  - sounding: what it actually sounds as = shape + capo. This is what a
//              capo-less bandmate plays and what the harmonica must match.
function shapeShift(s) {
  return s.transpose;
}
function soundShift(s) {
  return s.transpose + (s.capo || 0);
}
// Which one the chords above the lyrics display (toggled from the capo banner).
function inlineShift(s) {
  return prefs.chordMode === 'sounding' ? soundShift(s) : shapeShift(s);
}

function renderPreview() {
  const s = currentSong();
  if (!s) return;
  el.previewBody.innerHTML = render(s.body, inlineShift(s));
  updatePrintHeader(s);
  renderCapoBanner(s);
  if (prefs.diagrams) renderChordSet(s, el.diagrams, 'rhythm');
  else el.diagrams.innerHTML = '';
  el.rhythmLabel.style.display = prefs.lead ? '' : 'none';
  if (prefs.lead) {
    el.leadSection.style.display = '';
    renderChordSet(s, el.leadDiagrams, 'lead');
    renderScale(s);
  } else {
    el.leadSection.style.display = 'none';
  }
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
  const sounds = pc === null ? '' : ` &middot; the song sounds in <b>${HARP_NAMES[pc]}</b>`;
  const semis = s.capo === 1 ? '1 semitone' : `${s.capo} semitones`;
  const mode = prefs.chordMode === 'sounding' ? 'sounding' : 'shapes';
  el.capoBanner.innerHTML =
    `<div class="cb-main"><b>Capo ${s.capo}</b> &mdash; you fret the shapes below; ` +
    `they sound ${semis} higher${sounds}</div>` +
    `<div class="cb-toggle">Chords above lyrics: ` +
    `<button class="seg${mode === 'shapes' ? ' on' : ''}" data-mode="shapes">Shapes to fret</button>` +
    `<button class="seg${mode === 'sounding' ? ' on' : ''}" data-mode="sounding">Sounding (for others)</button>` +
    `</div>`;
  el.capoBanner.querySelectorAll('.seg').forEach((b) => b.addEventListener('click', () => {
    prefs.chordMode = b.dataset.mode;
    savePrefs();
    renderPreview();
  }));
}

// Unique chord shapes used in the song, in order of first appearance.
function uniqueShapes(s) {
  const shift = shapeShift(s);
  const matches = s.body.match(/\[([^\]]*)\]/g) || [];
  const seen = new Set();
  const out = [];
  for (const tok of matches) {
    const name = tok.slice(1, -1);
    if (!isChord(name)) continue;
    const shape = transposeChord(name, shift);
    if (seen.has(shape)) continue;
    seen.add(shape);
    out.push(shape);
  }
  return out;
}

// Lead set defaults to a triad up the neck (falling back to a barre form).
function defaultLeadIndex(voicings) {
  let i = voicings.findIndex((v) => /triad/.test(v.label));
  if (i < 0) i = voicings.findIndex((v) => /barre/.test(v.label));
  return i < 0 ? 0 : i;
}

// Render one diagram row (setName is 'rhythm' or 'lead') into `container`.
// Each set keeps its own voicing selection so rhythm and lead differ.
function renderChordSet(s, container, setName) {
  const shapeSh = shapeShift(s), soundSh = soundShift(s);
  const store = prefs.voicings[setName];
  const matches = s.body.match(/\[([^\]]*)\]/g) || [];
  const seen = new Set();
  let html = '';
  for (const tok of matches) {
    const name = tok.slice(1, -1);
    if (!isChord(name)) continue;
    const shape = transposeChord(name, shapeSh);
    if (seen.has(shape)) continue;
    seen.add(shape);

    const voicings = chordVoicings(shape);
    let idx = store[shape];
    if (idx === undefined) idx = setName === 'lead' ? defaultLeadIndex(voicings) : 0;
    if (idx >= voicings.length) idx = 0;
    const chosen = voicings[idx];

    let select = '';
    if (voicings.length > 1) {
      const opts = voicings.map((v, i) =>
        `<option value="${i}"${i === idx ? ' selected' : ''}>${escapeHtml(v.label)}</option>`).join('');
      select = `<select class="cd-voicing" data-set="${setName}" data-chord="${escapeHtml(shape)}">${opts}</select>`;
    }
    const sounding = s.capo ? transposeChord(name, soundSh) : null;
    html += chordDiagramSVG(shape, chosen.frets, sounding, select);
  }
  container.innerHTML = html;

  container.querySelectorAll('.cd-voicing').forEach((sel) => {
    sel.addEventListener('change', () => {
      prefs.voicings[sel.dataset.set][sel.dataset.chord] = parseInt(sel.value, 10);
      savePrefs();
      renderChordSet(currentSong(), container, sel.dataset.set);
    });
  });

  // Click a chord's name to focus it — its tones highlight on the scale map.
  container.querySelectorAll('.cd-name').forEach((nm) => {
    const shape = nm.dataset.chord;
    if (s.focusChord === shape) nm.classList.add('focused');
    nm.title = 'Click to highlight this chord’s notes on the scale map';
    nm.addEventListener('click', () => {
      const cur = currentSong();
      cur.focusChord = cur.focusChord === shape ? null : shape;
      cur.updated = Date.now();
      schedulePersist();
      renderPreview();
    });
  });
}

// Scale map for the lead set: root defaults to the song's sounding key.
function renderScale(s) {
  const auto = s.scaleRoot === null || s.scaleRoot === undefined;
  const pc = auto ? soundingKeyPc(s) : s.scaleRoot;
  if (pc === null) { el.scalePanel.innerHTML = ''; return; }
  const scale = scaleById(prefs.scaleType);

  let rootOpts = `<option value="auto"${auto ? ' selected' : ''}>Auto (${HARP_NAMES[pc]})</option>`;
  for (let i = 0; i < 12; i++) {
    rootOpts += `<option value="${i}"${!auto && s.scaleRoot === i ? ' selected' : ''}>${HARP_NAMES[i]}</option>`;
  }
  const scaleOpts = SCALES.map((sc) =>
    `<option value="${sc.id}"${sc.id === scale.id ? ' selected' : ''}>${sc.name}</option>`).join('');

  // Chord-tone highlight: the focused chord's sounding tones, labelled R/3/5/7.
  let highlight = null;
  if (s.focusChord) {
    const soundingName = s.capo ? transposeChord(s.focusChord, s.capo) : s.focusChord;
    highlight = chordToneLabels(soundingName);
  }

  const chordNames = uniqueShapes(s);
  const focusOpts = `<option value="">none</option>` + chordNames.map((c) =>
    `<option value="${escapeHtml(c)}"${s.focusChord === c ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('');
  const legendHi = highlight ? ` <span class="sp-dot hi"></span>chord tone` : '';

  el.scalePanel.innerHTML =
    `<div class="sp-head"><span class="sp-title">${HARP_NAMES[pc]} ${escapeHtml(scale.name)}</span>` +
    `<span class="muted">Root</span><select id="scale-root">${rootOpts}</select>` +
    `<select id="scale-type">${scaleOpts}</select>` +
    `<span class="muted">Chord</span><select id="scale-focus">${focusOpts}</select>` +
    `<span class="sp-legend"><span class="sp-dot root"></span>root <span class="sp-dot note"></span>scale tone${legendHi}</span>` +
    `</div>` +
    scaleDiagramSVG(pc, scale.iv, highlight);

  document.getElementById('scale-focus').addEventListener('change', (e) => {
    const cur = currentSong();
    cur.focusChord = e.target.value || null;
    cur.updated = Date.now();
    schedulePersist();
    renderPreview();
  });
  document.getElementById('scale-root').addEventListener('change', (e) => {
    const cur = currentSong();
    cur.scaleRoot = e.target.value === 'auto' ? null : parseInt(e.target.value, 10);
    cur.updated = Date.now();
    schedulePersist();
    renderScale(cur);
  });
  document.getElementById('scale-type').addEventListener('change', (e) => {
    prefs.scaleType = e.target.value;
    savePrefs();
    renderScale(currentSong());
  });
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
    schedulePersist();
    renderPreview();
  });
}

function updatePrintHeader(s) {
  const parts = [];
  if (s.title) parts.push(`<h2>${escapeHtml(s.title)}</h2>`);
  if (s.artist) parts.push(`<div class="artist">${escapeHtml(s.artist)}</div>`);
  el.printHeader.innerHTML = parts.join('');
}

// Palette of the chords already used in the current chart. Clicking a chip
// inserts that bracketed chord at the editor cursor. Reads the raw text so the
// chips match exactly what's typed (independent of transpose).
function renderPalette() {
  const re = /\[([^\]]*)\]/g;
  const seen = new Set();
  const list = [];
  let m;
  while ((m = re.exec(el.editor.value)) !== null) {
    if (isChord(m[1]) && !seen.has(m[1])) { seen.add(m[1]); list.push(m[1]); }
  }
  if (!list.length) {
    el.palette.innerHTML = '<span class="palette-empty">Chords you use appear here to insert at the cursor.</span>';
    return;
  }
  el.palette.innerHTML = list.map((c) =>
    `<button class="chip" data-chord="${escapeHtml(c)}" title="Insert [${escapeHtml(c)}] at the cursor">${escapeHtml(c)}</button>`
  ).join('');
  el.palette.querySelectorAll('.chip').forEach((b) =>
    b.addEventListener('click', () => insertAtCursor('[' + b.dataset.chord + ']')));
}

function insertAtCursor(text) {
  const ta = el.editor;
  const start = ta.selectionStart, end = ta.selectionEnd;
  ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
  ta.selectionStart = ta.selectionEnd = start + text.length;
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}

// Section-label buttons. Each inserts a {Section} on its own line; "Verse"
// auto-increments to the next number already present in the chart.
const SECTION_BUTTONS = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Bridge', 'Solo', 'Outro'];

function insertSection(label) {
  const ta = el.editor;
  const before = ta.value.slice(0, ta.selectionStart);
  const pre = before && !before.endsWith('\n') ? '\n' : '';
  insertAtCursor(pre + '{' + label + '}\n');
}

function nextVerseLabel() {
  const nums = [...el.editor.value.matchAll(/\{\s*verse\s*(\d+)\s*\}/gi)].map((m) => +m[1]);
  return 'Verse ' + ((nums.length ? Math.max(...nums) : 0) + 1);
}

function initSectionBar() {
  el.sectionBar.innerHTML = SECTION_BUTTONS.map((s) =>
    `<button class="sbtn" data-section="${s}" title="Insert {${s}} section label">${s}</button>`).join('');
  el.sectionBar.querySelectorAll('.sbtn').forEach((b) => b.addEventListener('click', () => {
    insertSection(b.dataset.section === 'Verse' ? nextVerseLabel() : b.dataset.section);
  }));
}

function renderList() {
  el.count.textContent = songs.length ? songs.length + '' : '';
  // Folder mode keeps file order (stable); local mode floats recent to the top.
  const ordered = mode === 'folder'
    ? [...songs].sort((a, b) => (a.path || '').localeCompare(b.path || ''))
    : [...songs].sort((a, b) => b.updated - a.updated);
  el.list.innerHTML = '';
  for (const s of ordered) {
    const li = document.createElement('li');
    li.className = 'song-item' + (s.id === currentId ? ' active' : '');
    const sub = mode === 'folder' ? (s.path || '') : (s.artist || '');
    const del = mode === 'folder' ? '' : `<button class="del" title="Delete">&times;</button>`;
    li.innerHTML =
      `<span class="st"><b>${escapeHtml(s.title || 'Untitled')}</b>` +
      `<small>${escapeHtml(sub)}</small></span>${del}`;
    li.querySelector('.st').addEventListener('click', () => selectSong(s.id));
    const delBtn = li.querySelector('.del');
    if (delBtn) delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteSong(s.id); });
    el.list.appendChild(li);
  }
}

function deleteSong(id) {
  if (mode === 'folder') return; // never delete files from the tool
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

async function createSong() {
  if (mode === 'folder') {
    const name = prompt('New chart file name:', 'new-song.cho');
    if (!name) return;
    const fname = name.endsWith('.cho') ? name : name + '.cho';
    let handle;
    try { handle = await dirHandle.getFileHandle(fname, { create: true }); }
    catch { alert('Could not create the file.'); return; }
    const s = blankSong();
    s.path = fname;
    fileHandles[s.id] = handle;
    songs.push(s);
    await writeSong(s);
    selectSong(s.id);
    el.title.focus();
    return;
  }
  const s = blankSong();
  songs.push(s);
  saveSongs(songs);
  selectSong(s.id);
  el.title.focus();
}

function commit() {
  const s = currentSong();
  if (!s) return;
  s.title = el.title.value;
  s.artist = el.artist.value;
  s.body = el.editor.value;
  s.updated = Date.now();
  schedulePersist();
}

function setTranspose(delta) {
  const s = currentSong();
  if (!s) return;
  s.transpose = Math.max(-11, Math.min(11, s.transpose + delta));
  el.trAmount.textContent = (s.transpose > 0 ? '+' : '') + s.transpose;
  s.updated = Date.now();
  schedulePersist();
  renderPreview();
}

function setCapo(delta) {
  const s = currentSong();
  if (!s) return;
  s.capo = Math.max(0, Math.min(11, (s.capo || 0) + delta));
  el.capoAmount.textContent = s.capo;
  s.updated = Date.now();
  schedulePersist();
  renderPreview();
}

// ---- Import / Export -------------------------------------------------------

// Note name <-> pitch class, for the {key: G} directive.
function noteToPc(str) {
  const m = str.trim().match(/^([A-G])([#b]?)/);
  if (!m) return null;
  let pc = NOTE_INDEX[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return ((pc % 12) + 12) % 12;
}

// Serialize a song to .cho text (directive block + body).
function songToCho(s) {
  let out = '';
  if (s.title) out += `{title: ${s.title}}\n`;
  if (s.artist) out += `{artist: ${s.artist}}\n`;
  if (s.key !== null && s.key !== undefined) out += `{key: ${HARP_NAMES[s.key]}}\n`;
  if (s.transpose) out += `{transpose: ${s.transpose}}\n`;
  if (s.capo) out += `{capo: ${s.capo}}\n`;
  if (out) out += '\n';
  out += s.body;
  return out;
}

// Parse .cho text into a fresh (unattached) song object.
function parseCho(text, fallbackTitle) {
  const s = blankSong();
  const lines = text.split('\n');
  const body = [];
  let sawDirective = false;
  for (const line of lines) {
    const t = line.match(/^\{(title|artist|transpose|capo|key)\s*:\s*(.*)\}\s*$/i);
    if (t) {
      sawDirective = true;
      const key = t[1].toLowerCase();
      if (key === 'title') s.title = t[2].trim();
      else if (key === 'artist') s.artist = t[2].trim();
      else if (key === 'transpose') s.transpose = parseInt(t[2], 10) || 0;
      else if (key === 'capo') s.capo = Math.max(0, Math.min(11, parseInt(t[2], 10) || 0));
      else if (key === 'key') s.key = noteToPc(t[2]);
    } else {
      body.push(line);
    }
  }
  if (sawDirective && body[0] === '') body.shift(); // drop blank after directives
  s.body = body.join('\n');
  if (!s.title) s.title = fallbackTitle || '';
  return s;
}

function exportSong() {
  const s = currentSong();
  if (!s) return;
  const blob = new Blob([songToCho(s)], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (s.title || 'song').replace(/[^\w\-]+/g, '_') + '.cho';
  a.click();
  URL.revokeObjectURL(url);
}

function importText(text, fallbackTitle) {
  const s = parseCho(text, fallbackTitle);
  songs.push(s);
  saveSongs(songs);
  selectSong(s.id);
}

// ---- Wire up ---------------------------------------------------------------

el.editor.addEventListener('input', () => {
  const s = currentSong();
  if (s) el.previewBody.innerHTML = render(el.editor.value, inlineShift(s));
  renderPalette();
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
el.toggleLead.addEventListener('change', () => {
  prefs.lead = el.toggleLead.checked;
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

// Folder mode controls.
const reopenBtn = document.getElementById('reopen-btn');
document.getElementById('folder-btn').addEventListener('click', openFolder);
reopenBtn.addEventListener('click', reopenFolder);
document.getElementById('save-btn').addEventListener('click', saveCurrentNow);

async function saveCurrentNow() {
  const s = currentSong();
  if (!s) return;
  if (mode === 'folder') {
    try { await writeSong(s); el.status.textContent = 'Saved · ' + (s.path || 'file'); }
    catch { el.status.textContent = 'Save failed'; }
  } else {
    saveSongs(songs);
    el.status.textContent = 'Saved';
  }
}

function updateModeUI() {
  const folder = mode === 'folder';
  document.getElementById('save-btn').hidden = !folder;
  document.getElementById('import-btn').hidden = folder;
  const bar = document.getElementById('folder-bar');
  if (folder) {
    bar.hidden = false;
    bar.innerHTML = `<span class="fb-name" title="${escapeHtml(dirHandle && dirHandle.name || '')}">` +
      `${escapeHtml(dirHandle && dirHandle.name || 'folder')}</span>` +
      `<button id="close-folder" class="inline-btn">Close</button>`;
    document.getElementById('close-folder').addEventListener('click', closeFolder);
  } else {
    bar.hidden = true;
    bar.innerHTML = '';
  }
  renderList();
}

// Cmd/Ctrl+S saves the current chart immediately.
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    saveCurrentNow();
  }
});

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
  initSectionBar();
  el.toggleDiagrams.checked = prefs.diagrams;
  el.toggleLead.checked = prefs.lead;
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

  // Offer to reopen the last folder (needs a click to re-grant permission).
  idbGet('dirHandle').then((h) => { if (h) reopenBtn.hidden = false; });
}

boot();
