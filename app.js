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
    // Reserve an empty chord row above every lyric line so all lines are the
    // same height and align on a uniform grid.
    return `<div class="line chordline"> </div><div class="line lyricline">${escapeHtml(raw)}</div>`;
  }

  // Lay chords onto their own line, nudging right so they always keep at least
  // one space between them (<= so chords that land exactly adjacent still gap).
  let chordLine = '';
  for (const c of chords) {
    let pos = c.pos;
    if (pos <= chordLine.length && chordLine.length > 0) pos = chordLine.length + 1;
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

// ---- File-backed libraries (File System Access API) ------------------------
// The app starts in localStorage ('local') mode. When you "establish a
// collection" — open your first folder — your browser songs are copied into it
// as .cho files and the app switches to 'folder' mode, editing files on disk.
// From then on you can open additional folders; each open folder is a
// "library". Handles are remembered in IndexedDB so folders reconnect (with one
// permission click) next session.

let mode = 'local';           // 'local' | 'folder'
let libraries = [];           // [{ id, name, handle }] — open folders
let activeLibId = null;       // folder that + New / Import target
const fileHandles = {};       // song id -> FileSystemFileHandle
const collapsed = new Set();  // library ids collapsed in the sidebar

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

let libCounter = 1;
function newLibId() { return 'lib' + (libCounter++).toString(36) + newId(); }

async function scanDir(dir, prefix, out) {
  for await (const entry of dir.values()) {
    if (entry.kind === 'file' && entry.name.endsWith('.cho')) {
      out.push({ name: entry.name, path: prefix + entry.name, handle: entry });
    } else if (entry.kind === 'directory') {
      await scanDir(entry, prefix + entry.name + '/', out);
    }
  }
}

// Read every .cho in a library's folder into song objects tagged with libId.
async function loadLibrarySongs(lib) {
  const found = [];
  await scanDir(lib.handle, '', found);
  found.sort((a, b) => a.path.localeCompare(b.path));
  const loaded = [];
  for (const f of found) {
    const text = await (await f.handle.getFile()).text();
    const s = parseCho(text, f.name.replace(/\.cho$/, ''));
    s.id = newId();
    s.path = f.path;
    s.libId = lib.id;
    fileHandles[s.id] = f.handle;
    loaded.push(s);
  }
  return loaded;
}

function persistLibraries() {
  return idbSet('libraries', libraries.map((l) => ({ id: l.id, name: l.name, handle: l.handle })));
}

// Turn a title into a safe, unique .cho filename within a folder.
function slugFilename(title, used) {
  const base = (title || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled';
  let name = base + '.cho', i = 2;
  while (used.has(name.toLowerCase())) name = base + '-' + (i++) + '.cho';
  used.add(name.toLowerCase());
  return name;
}

// Where new / imported songs land. Tracked explicitly so an EMPTY folder can be
// the target (you can't select a song in it to imply it). Set by opening a
// folder or clicking its header; selecting a song points it at that folder too.
function activeLib() {
  return libraries.find((l) => l.id === activeLibId) || libraries[0] || null;
}

function setActiveLib(libId) {
  activeLibId = libId;
  collapsed.delete(libId); // expand so you can see / fill it
  updateModeUI();          // refreshes the "new →" bar and re-renders the list
}

// "Open folder" in local mode: copy browser songs into the chosen folder and
// switch to editing files on disk.
async function establishCollection(handle) {
  const localSongs = songs.slice();
  if (localSongs.length &&
      !confirm(`Copy your ${localSongs.length} browser song${localSongs.length === 1 ? '' : 's'} into "${handle.name}" as .cho files and switch to editing files on disk?\n\n(Your browser copy is kept as a backup.)`)) {
    return;
  }
  const lib = { id: newLibId(), name: handle.name, handle };
  const onDisk = await loadLibrarySongs(lib);   // .cho already sitting in the folder
  mode = 'folder';
  libraries = [lib];
  activeLibId = lib.id;
  songs = onDisk;
  const used = new Set(onDisk.map((s) => (s.path || '').toLowerCase()));
  for (const ls of localSongs) {
    const fname = slugFilename(ls.title, used);
    let fh;
    try { fh = await handle.getFileHandle(fname, { create: true }); }
    catch { continue; }
    const s = Object.assign({}, ls, { id: newId(), path: fname, libId: lib.id });
    fileHandles[s.id] = fh;
    await writeSong(s);
    songs.push(s);
  }
  await persistLibraries();
  updateModeUI();
  if (songs.length) selectSong(songs[0].id);
}

// "Open folder" in folder mode: add another library, leaving the rest open.
async function addLibrary(handle) {
  for (const l of libraries) {
    let same = l.handle === handle;
    try { same = same || await handle.isSameEntry(l.handle); } catch { /* ignore */ }
    if (same) { alert(`"${handle.name}" is already open.`); return; }
  }
  const lib = { id: newLibId(), name: handle.name, handle };
  const loaded = await loadLibrarySongs(lib);
  libraries.push(lib);
  songs.push(...loaded);
  activeLibId = lib.id; // the folder you just opened becomes the new-file target
  await persistLibraries();
  updateModeUI();
  if (loaded.length) selectSong(loaded[0].id); else renderList();
}

async function openFolder() {
  if (!window.showDirectoryPicker) {
    alert('Folder mode needs Chrome or Edge, served over http://localhost or https:// (not file://).');
    return;
  }
  let handle;
  try {
    handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch { return; } // user cancelled
  if (mode === 'folder') await addLibrary(handle);
  else await establishCollection(handle);
}

// Re-scan one library from disk (picks up edits / new / removed files made
// outside the app). Song ids are regenerated, so we re-select by path.
async function reloadLibrary(libId) {
  const lib = libraries.find((l) => l.id === libId);
  if (!lib) return;
  const cur = currentSong();
  const keepPath = cur && cur.libId === libId ? cur.path : null;
  songs.filter((s) => s.libId === libId).forEach((s) => delete fileHandles[s.id]);
  songs = songs.filter((s) => s.libId !== libId);
  const loaded = await loadLibrarySongs(lib);
  songs.push(...loaded);
  const again = keepPath ? loaded.find((s) => s.path === keepPath) : currentSong();
  if (again) selectSong(again.id);
  else if (songs.length && !songs.some((s) => s.id === currentId)) selectSong(songs[0].id);
  else renderList();
}

// Close (forget) one library. Closing the last one returns to browser songs.
async function closeLibrary(libId) {
  libraries = libraries.filter((l) => l.id !== libId);
  songs.filter((s) => s.libId === libId).forEach((s) => delete fileHandles[s.id]);
  songs = songs.filter((s) => s.libId !== libId);
  collapsed.delete(libId);
  if (activeLibId === libId) activeLibId = (libraries[0] || {}).id || null;
  await persistLibraries();
  if (!libraries.length) { returnToLocal(); return; }
  updateModeUI();
  if (!songs.some((s) => s.id === currentId)) { if (songs.length) selectSong(songs[0].id); else renderList(); }
  else renderList();
}

function returnToLocal() {
  mode = 'local';
  songs = loadSongs();
  updateModeUI();
  if (!songs.length) showEmptyState();
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
  toggleGuitar: document.getElementById('toggle-guitar'),
  togglePiano: document.getElementById('toggle-piano'),
  toggleUke: document.getElementById('toggle-uke'),
};

let songs = loadSongs();
let currentId = null;

function loadPrefs() {
  const defaults = {
    diagrams: true, harmonica: true, lead: true, chordMode: 'shapes',
    scaleType: 'majPent', voicings: { rhythm: {}, lead: {} }, pianoInv: { rhythm: {}, lead: {} },
    instruments: { guitar: true, piano: true, ukulele: true },
    perform: { cols: 4, font: 22, panels: { chords: false, lead: false, scale: false, harp: false } },
    printCols: 1,
    metro: { bpm: 100, steps: 16, click: true, pattern: null },
    tunerPreset: 'standard',
  };
  let p = defaults;
  try { p = Object.assign(defaults, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch { /* keep defaults */ }
  if (!p.voicings || Array.isArray(p.voicings)) p.voicings = { rhythm: {}, lead: {} };
  p.voicings.rhythm = p.voicings.rhythm || {};
  p.voicings.lead = p.voicings.lead || {};
  if (!p.pianoInv || Array.isArray(p.pianoInv)) p.pianoInv = { rhythm: {}, lead: {} };
  p.pianoInv.rhythm = p.pianoInv.rhythm || {};
  p.pianoInv.lead = p.pianoInv.lead || {};
  p.instruments = Object.assign({ guitar: true, piano: true, ukulele: true }, p.instruments);
  p.perform = Object.assign({ cols: 4, font: 22, panels: {} }, p.perform);
  p.perform.panels = Object.assign({ chords: false, lead: false, scale: false, harp: false }, p.perform.panels);
  p.metro = Object.assign({ bpm: 100, steps: 16, click: true, pattern: null }, p.metro);
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
  else { if (s.libId) activeLibId = s.libId; if (s.path) idbSet('lastPath', s.path); }
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
  if (prefs.harmonica) renderHarmonica(s);
  else el.harmonica.innerHTML = '';
  // In performance mode the panels are relocated into the overlay and shown
  // independently of the app's own toggles, so keep them all populated.
  if (typeof perf !== 'undefined' && perf.open) perfRenderPanels(s);
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

function instRow(label, diagramsHtml) {
  return `<div class="inst-row"><span class="inst-label">${label}</span>` +
    `<div class="inst-diagrams">${diagramsHtml}</div></div>`;
}

const PIANO_INV_NAMES = ['root', '1st inv', '2nd inv', '3rd inv'];

// Render a diagram set (setName is 'rhythm' or 'lead') into `container` as one
// row per enabled instrument (Guitar / Piano / Ukulele). Each set keeps its own
// guitar voicing selection so rhythm and lead differ.
function renderChordSet(s, container, setName) {
  const shapeSh = shapeShift(s), soundSh = soundShift(s);
  const store = prefs.voicings[setName];
  const matches = s.body.match(/\[([^\]]*)\]/g) || [];
  const seen = new Set();
  const chords = []; // { raw, shape }
  for (const tok of matches) {
    const name = tok.slice(1, -1);
    if (!isChord(name)) continue;
    const shape = transposeChord(name, shapeSh);
    if (seen.has(shape)) continue;
    seen.add(shape);
    chords.push({ raw: name, shape });
  }
  const soundOf = (c) => (s.capo ? transposeChord(c.raw, soundSh) : null);
  const inst = prefs.instruments;
  let html = '';

  if (inst.guitar) {
    let g = '';
    for (const c of chords) {
      const voicings = chordVoicings(c.shape);
      let idx = store[c.shape];
      if (idx === undefined) idx = setName === 'lead' ? defaultLeadIndex(voicings) : 0;
      if (idx >= voicings.length) idx = 0;
      let select = '';
      if (voicings.length > 1) {
        const opts = voicings.map((v, i) =>
          `<option value="${i}"${i === idx ? ' selected' : ''}>${escapeHtml(v.label)}</option>`).join('');
        select = `<select class="cd-voicing" data-set="${setName}" data-chord="${escapeHtml(c.shape)}">${opts}</select>`;
      }
      g += chordDiagramSVG(c.shape, voicings[idx].frets, soundOf(c), select);
    }
    html += instRow('Guitar', g);
  }
  // Piano and ukulele appear only in the Rhythm set — the Lead set is a
  // guitar-only "second guitar" part.
  const withPianoUke = setName === 'rhythm';
  if (inst.piano && withPianoUke) {
    const pstore = prefs.pianoInv[setName];
    let pi = '';
    for (const c of chords) {
      const ci = chordIntervals(c.shape);
      const n = ci ? ci.iv.length : 0;
      let inv = pstore[c.shape] || 0;
      if (inv >= n) inv = 0;
      let select = '';
      if (n > 1) {
        const opts = [];
        for (let k = 0; k < n; k++) opts.push(`<option value="${k}"${k === inv ? ' selected' : ''}>${PIANO_INV_NAMES[k] || (k + ' inv')}</option>`);
        select = `<select class="pk-inv" data-set="${setName}" data-chord="${escapeHtml(c.shape)}">${opts.join('')}</select>`;
      }
      pi += pianoChordSVG(c.shape, inv, soundOf(c), select);
    }
    html += instRow('Piano', pi);
  }
  if (inst.ukulele && withPianoUke) {
    let u = '';
    for (const c of chords) u += ukeDiagramSVG(c.shape, ukeVoicing(c.shape), soundOf(c), '');
    html += instRow('Ukulele', u);
  }
  container.innerHTML = html || '<span class="palette-empty">No instruments selected — enable one above.</span>';

  container.querySelectorAll('.cd-voicing').forEach((sel) => {
    sel.addEventListener('change', () => {
      prefs.voicings[sel.dataset.set][sel.dataset.chord] = parseInt(sel.value, 10);
      savePrefs();
      renderChordSet(currentSong(), container, sel.dataset.set);
    });
  });

  container.querySelectorAll('.pk-inv').forEach((sel) => {
    sel.addEventListener('change', () => {
      prefs.pianoInv[sel.dataset.set][sel.dataset.chord] = parseInt(sel.value, 10);
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

  // One scale diagram per enabled fretted/keyed instrument.
  let diagrams = '';
  if (prefs.instruments.guitar) diagrams += `<div class="scale-inst"><span class="inst-label">Guitar</span>${scaleDiagramSVG(pc, scale.iv, highlight)}</div>`;
  if (prefs.instruments.piano) diagrams += `<div class="scale-inst"><span class="inst-label">Piano</span>${pianoScaleSVG(pc, scale.iv, highlight)}</div>`;

  el.scalePanel.innerHTML =
    `<div class="sp-head"><span class="sp-title">${HARP_NAMES[pc]} ${escapeHtml(scale.name)}</span>` +
    `<span class="muted">Root</span><select id="scale-root">${rootOpts}</select>` +
    `<select id="scale-type">${scaleOpts}</select>` +
    `<span class="muted">Chord</span><select id="scale-focus">${focusOpts}</select>` +
    `<span class="sp-legend"><span class="sp-dot root"></span>root <span class="sp-dot note"></span>scale tone${legendHi}</span>` +
    `</div>` +
    diagrams;

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
  const pc = soundingKeyPc(s);
  if (pc === null) { el.harmonica.innerHTML = ''; return; }
  const r = harmonicaRecs(pc);
  const auto = s.key === null || s.key === undefined;
  let opts = `<option value="auto"${auto ? ' selected' : ''}>Auto (${HARP_NAMES[pc]})</option>`;
  for (let i = 0; i < 12; i++) {
    opts += `<option value="${i}"${!auto && s.key === i ? ' selected' : ''}>${HARP_NAMES[i]}</option>`;
  }
  // Compact single line: it sits up in the header now, not the reference stack.
  el.harmonica.innerHTML =
    `<span class="hp-title">Harmonica</span>` +
    `<select id="key-select">${opts}</select>` +
    `<span class="hp-recs">` +
      `<span class="hp-rec"><b>${r.cross}</b> cross</span>` +
      `<span class="hp-rec"><b>${r.straight}</b> straight</span>` +
      `<span class="hp-rec"><b>${r.slant}</b> slant</span>` +
    `</span>`;
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
  const emptyBtn = '<button class="chip chip-empty" id="empty-chord-btn" title="Insert empty [ ] brackets at the cursor">[ ]</button>';
  el.palette.innerHTML = emptyBtn + list.map((c) =>
    `<button class="chip" data-chord="${escapeHtml(c)}" title="Insert [${escapeHtml(c)}] at the cursor">${escapeHtml(c)}</button>`
  ).join('');
  el.palette.querySelectorAll('.chip[data-chord]').forEach((b) =>
    b.addEventListener('click', () => insertAtCursor('[' + b.dataset.chord + ']')));
  document.getElementById('empty-chord-btn').addEventListener('click', insertEmptyChord);

  // Keep the "Replace" dropdown in sync with the chords in use.
  const sel = document.getElementById('replace-from');
  if (sel) {
    const prev = sel.value;
    sel.innerHTML = list.length
      ? list.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')
      : '<option value="">—</option>';
    if (list.includes(prev)) sel.value = prev;
  }
}

// Overwrite the editor's whole text (undo-friendly where supported), then fire
// input so the preview / palette / save all refresh.
function replaceEditorText(newText) {
  const ta = el.editor;
  if (newText === ta.value) return;
  ta.focus();
  ta.select();
  let ok = false;
  try { ok = document.execCommand('insertText', false, newText); } catch { ok = false; }
  if (!ok) ta.value = newText;
  ta.selectionStart = ta.selectionEnd = 0;
  ta.dispatchEvent(new Event('input'));
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Pure transforms (tested in isolation).
function transposeChordText(text, semi) {
  return text.replace(/\[([^\[\]]*)\]/g,
    (m, inner) => (isChord(inner) ? '[' + transposeChord(inner, semi) + ']' : m));
}
function replaceChordText(text, from, to) {
  return text.replace(new RegExp('\\[' + escapeRegex(from) + '\\]', 'g'), '[' + to + ']');
}

// Transpose every written [chord] in the editor text by `semi` semitones. This
// rewrites the source (unlike the display-only Transpose stepper).
function transposeEditorText(semi) {
  if (!currentSong()) return;
  replaceEditorText(transposeChordText(el.editor.value, semi));
}

// Replace every [from] chord token with [to] throughout the editor.
function replaceChordAll() {
  if (!currentSong()) return;
  const from = document.getElementById('replace-from').value;
  const to = document.getElementById('replace-to').value.trim();
  if (!from || !to || !el.editor.value.includes('[' + from + ']')) return;
  replaceEditorText(replaceChordText(el.editor.value, from, to));
  document.getElementById('replace-to').value = '';
}

// Insert text at the cursor. cursorOffset (optional) places the caret that many
// chars into the inserted text (e.g. between empty brackets) instead of after it.
function insertAtCursor(text, cursorOffset) {
  const ta = el.editor;
  const start = ta.selectionStart, end = ta.selectionEnd;
  ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
  const caret = start + (cursorOffset == null ? text.length : cursorOffset);
  ta.selectionStart = ta.selectionEnd = caret;
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}

// Empty [] at the cursor, caret between the brackets to type a chord.
function insertEmptyChord() {
  insertAtCursor('[]', 1);
}

// Empty {} section on its own line, caret between the braces to name it.
function insertEmptySection() {
  const before = el.editor.value.slice(0, el.editor.selectionStart);
  const pre = before && !before.endsWith('\n') ? '\n' : '';
  insertAtCursor(pre + '{}\n', pre.length + 1);
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
    `<button class="sbtn" data-section="${s}" title="Insert {${s}} section label">${s}</button>`).join('') +
    '<button class="sbtn sbtn-empty" id="empty-section-btn" title="Insert an empty { } section label to name yourself">{ }</button>';
  el.sectionBar.querySelectorAll('.sbtn[data-section]').forEach((b) => b.addEventListener('click', () => {
    insertSection(b.dataset.section === 'Verse' ? nextVerseLabel() : b.dataset.section);
  }));
  document.getElementById('empty-section-btn').addEventListener('click', insertEmptySection);
}

function songItem(s, deletable) {
  const li = document.createElement('li');
  li.className = 'song-item' + (deletable ? '' : ' in-lib') + (s.id === currentId ? ' active' : '');
  const sub = mode === 'folder' ? (s.path || '') : (s.artist || '');
  li.innerHTML =
    `<span class="st"><b>${escapeHtml(s.title || 'Untitled')}</b>` +
    `<small>${escapeHtml(sub)}</small></span>` +
    (deletable ? `<button class="del" title="Delete">&times;</button>` : '');
  li.querySelector('.st').addEventListener('click', () => selectSong(s.id));
  const delBtn = li.querySelector('.del');
  if (delBtn) delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteSong(s.id); });
  return li;
}

function toggleCollapse(libId) {
  if (collapsed.has(libId)) collapsed.delete(libId); else collapsed.add(libId);
  renderList();
}

function renderList() {
  el.count.textContent = songs.length ? songs.length + '' : '';
  el.list.innerHTML = '';

  // Local mode: one flat list, most-recently-edited first.
  if (mode !== 'folder') {
    const ordered = [...songs].sort((a, b) => b.updated - a.updated);
    for (const s of ordered) el.list.appendChild(songItem(s, true));
    return;
  }

  // Folder mode: group by library, each with a collapsible header. Files can't
  // be deleted from the tool, so folder songs carry no delete button.
  for (const lib of libraries) {
    const libSongs = songs
      .filter((s) => s.libId === lib.id)
      .sort((a, b) => (a.path || '').localeCompare(b.path || ''));
    const isCollapsed = collapsed.has(lib.id);
    const isActive = lib.id === activeLibId;
    const header = document.createElement('li');
    header.className = 'lib-header' + (isCollapsed ? ' collapsed' : '') + (isActive ? ' active-lib' : '');
    header.innerHTML =
      `<span class="lib-caret" title="${isCollapsed ? 'Expand' : 'Collapse'}">${isCollapsed ? '▸' : '▾'}</span>` +
      `<span class="lib-name" title="Make this the target folder for + New / Import">${escapeHtml(lib.name)}</span>` +
      `<span class="lib-count">${libSongs.length}</span>` +
      `<button class="lib-btn lib-reload" title="Reload this folder from disk">↻</button>` +
      `<button class="lib-btn lib-close" title="Close this folder">×</button>`;
    header.querySelector('.lib-caret').addEventListener('click', () => toggleCollapse(lib.id));
    header.querySelector('.lib-name').addEventListener('click', () => setActiveLib(lib.id));
    header.querySelector('.lib-reload').addEventListener('click', (e) => {
      e.stopPropagation(); reloadLibrary(lib.id);
    });
    header.querySelector('.lib-close').addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Close "${lib.name}"? The files stay on disk; the folder is just removed from the sidebar.`)) closeLibrary(lib.id);
    });
    el.list.appendChild(header);
    if (!isCollapsed) for (const s of libSongs) el.list.appendChild(songItem(s, false));
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
    else showEmptyState();
  } else {
    renderList();
  }
}

async function createSong() {
  if (mode === 'folder') {
    const lib = activeLib();
    if (!lib) { alert('Open a folder first.'); return; }
    const name = prompt(`New chart file name in "${lib.name}":`, 'new-song.cho');
    if (!name) return;
    const fname = name.endsWith('.cho') ? name : name + '.cho';
    let handle;
    try { handle = await lib.handle.getFileHandle(fname, { create: true }); }
    catch { alert('Could not create the file.'); return; }
    const s = blankSong();
    s.path = fname;
    s.libId = lib.id;
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

async function importText(text, fallbackTitle) {
  const s = parseCho(text, fallbackTitle);
  if (mode === 'folder') {
    const lib = activeLib();
    if (!lib) { alert('Open a folder first.'); return; }
    const used = new Set(songs.filter((x) => x.libId === lib.id).map((x) => (x.path || '').toLowerCase()));
    const fname = slugFilename(s.title || fallbackTitle, used);
    let handle;
    try { handle = await lib.handle.getFileHandle(fname, { create: true }); }
    catch { alert('Could not create the file.'); return; }
    s.path = fname;
    s.libId = lib.id;
    fileHandles[s.id] = handle;
    songs.push(s);
    await writeSong(s);
    selectSong(s.id);
    return;
  }
  songs.push(s);
  saveSongs(songs);
  selectSong(s.id);
}

// ---- Wire up ---------------------------------------------------------------

// If the user starts typing with nothing selected, create a song to hold it.
// Local mode only — folder mode needs an explicit + New so the file gets named.
function ensureSongForTyping() {
  if (currentSong() || mode !== 'local') return;
  const s = blankSong();
  songs.push(s);
  currentId = s.id;
  renderList();
}

let auxTimer = null;
el.editor.addEventListener('input', () => {
  ensureSongForTyping();
  const s = currentSong();
  if (s) el.previewBody.innerHTML = render(el.editor.value, inlineShift(s)); // instant lyric preview
  renderPalette();
  commit();
  // Refresh diagrams / harmonica / scale shortly after typing stops so newly
  // added (or removed) chords show up there too.
  clearTimeout(auxTimer);
  auxTimer = setTimeout(() => { if (currentSong()) renderPreview(); }, 250);
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
[['toggleGuitar', 'guitar'], ['togglePiano', 'piano'], ['toggleUke', 'ukulele']].forEach(([elKey, inst]) => {
  el[elKey].addEventListener('change', () => {
    prefs.instruments[inst] = el[elKey].checked;
    savePrefs();
    renderPreview();
  });
});
document.getElementById('export-btn').addEventListener('click', exportSong);
document.getElementById('print-btn').addEventListener('click', () => {
  computePrintFont();      // size the font to the column width before printing
  updateMetaBreak();       // put the reference panels on their own page when shown
  window.print();
});

// When the reference panels (diagrams / scale / harmonica) have content, give
// them page 1 to themselves so the chart starts clean at the top of page 2
// (rather than crammed onto the bottom of page 1).
function updateMetaBreak() {
  const hasMeta = ['chord-diagrams', 'lead-diagrams', 'scale-panel', 'harmonica-panel']
    .some((id) => ((document.getElementById(id) || {}).innerHTML || '').trim() !== '');
  el.preview.classList.toggle('meta-first', hasMeta);
}

// Print column count (applied only in @media print via the --print-cols var).
const printColsSel = document.getElementById('print-cols');
function applyPrintCols() {
  el.preview.classList.toggle('print-2col', prefs.printCols === 2);
  printColsSel.value = String(prefs.printCols);
}
printColsSel.addEventListener('change', () => {
  prefs.printCols = parseInt(printColsSel.value, 10) || 1;
  savePrefs();
  applyPrintCols();
  computePrintFont();
});

// The widest rendered chart line, in px, at the current on-screen font. Chart
// lines are white-space:pre so their scrollWidth is their true content width
// (chord rows included — positioned with spaces).
function widestBodyLinePx() {
  let m = 1;
  document.querySelectorAll('#preview-body .line').forEach((l) => {
    if (l.scrollWidth > m) m = l.scrollWidth;
  });
  return m;
}

// Chart lines can't wrap without misaligning chords, so in a narrow print
// column a long line would overflow and clip. Shrink the print font so the
// widest line fits the column. We measure the actual line width at the current
// font (accurate for the real monospace advance) and scale. Assumes US Letter
// portrait with ~0.5in margins; conservative so it rarely clips.
function computePrintFont() {
  const cols = prefs.printCols || 1;
  // Lyrics get 0.5in side margins in print (see #preview-body padding), so the
  // usable text width is the page width minus those margins.
  const usablePt = 528 - 72;     // ~6.3in, in points
  const gapPt = 22;              // ~30px column gap
  const colPt = (usablePt - (cols - 1) * gapPt) / cols;
  const screenFontPx = parseFloat(getComputedStyle(el.previewBody).fontSize) || 14;
  const ratio = widestBodyLinePx() / screenFontPx; // line width per unit font
  const SAFETY = 0.94;           // leave headroom so the last char never clips
  let fit = (colPt * SAFETY) / ratio;
  fit = Math.min(12, Math.max(6, fit)); // 6–12pt
  document.documentElement.style.setProperty('--print-font', fit.toFixed(1) + 'pt');
}

// Folder mode controls.
const reopenBtn = document.getElementById('reopen-btn');
document.getElementById('folder-btn').addEventListener('click', openFolder);
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
  document.getElementById('import-btn').hidden = false; // import works in both modes
  const folderBtn = document.getElementById('folder-btn');
  folderBtn.textContent = folder ? '+ Folder' : 'Open folder';
  folderBtn.title = folder
    ? 'Open another folder of .cho charts'
    : 'Set up a file-backed collection: copy your songs into a folder and edit on disk';
  const bar = document.getElementById('folder-bar');
  if (folder) {
    bar.hidden = false;
    const active = activeLib();
    bar.innerHTML = `<span class="fb-name" title="+ New and Import create files here — click a folder name to change">` +
      `+ New → ${escapeHtml(active ? active.name : '—')}</span>`;
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

// Strip every [chord] token from the text, keeping lyrics, section labels
// ({Verse}, or a lone bracketed word like [Chorus]), and {page} markers. Only
// tokens that actually parse as chords are removed. Trailing whitespace left
// behind by a removed chord is trimmed per line.
function stripChords(text) {
  return text.split('\n').map((line) =>
    line.replace(/\[([^\[\]]*)\]/g, (m, inner) => (isChord(inner) ? '' : m)).replace(/[ \t]+$/, '')
  ).join('\n');
}

document.getElementById('clear-chords-btn').addEventListener('click', () => {
  const s = currentSong();
  if (!s) return;
  const text = el.editor.value;
  const tokens = text.match(/\[([^\[\]]*)\]/g) || [];
  const count = tokens.filter((t) => isChord(t.slice(1, -1))).length;
  if (count === 0) { alert('No chords to clear in this chart.'); return; }
  if (!confirm(`Remove all ${count} chord${count === 1 ? '' : 's'} from this chart?\n\nLyrics and section labels are kept. You can undo with Cmd/Ctrl+Z.`)) return;
  const cleared = stripChords(text);
  // Replace via execCommand where supported so the browser's own undo works;
  // fall back to a direct assignment otherwise.
  el.editor.focus();
  el.editor.select();
  let ok = false;
  try { ok = document.execCommand('insertText', false, cleared); } catch { ok = false; }
  if (!ok) el.editor.value = cleared;
  el.editor.selectionStart = el.editor.selectionEnd = 0;
  el.editor.dispatchEvent(new Event('input'));
});

document.getElementById('tr-text-down').addEventListener('click', () => transposeEditorText(-1));
document.getElementById('tr-text-up').addEventListener('click', () => transposeEditorText(1));
document.getElementById('replace-go').addEventListener('click', replaceChordAll);
document.getElementById('replace-to').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); replaceChordAll(); }
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

// ---- Performance mode ------------------------------------------------------
// A full-screen overlay that lays the current song's chords-over-lyrics out in
// N newspaper columns (whole song visible when it fits), with horizontal paging
// for longer songs, toggleable diagram/scale/harmonica panels, and page-turner
// (arrow / PageUp-Down / Space) navigation that flows into the next song.

const PERF_PANELS = { chords: 'chord-diagrams', lead: 'lead-diagrams', scale: 'scale-panel', harp: 'harmonica-panel' };
const PERF_LABELS = { chords: 'Chords', lead: 'Lead', scale: 'Scale', harp: 'Harmonica' };
const PERF_PADX = 28; // must match .perform-cols left/right padding in CSS
const PERF_GAP = 36;  // gap between columns, in px

const perf = { open: false, page: 0, pages: 1, orig: {}, idleTimer: null };
const pf = {
  overlay: document.getElementById('perform-overlay'),
  bar: document.getElementById('perform-bar'),
  song: document.getElementById('pf-song'),
  cols: document.getElementById('perform-cols'),
  viewport: document.getElementById('perform-viewport'),
  panels: document.getElementById('perform-panels'),
  colNum: document.getElementById('pf-cols'),
  fontNum: document.getElementById('pf-font'),
  pageLabel: document.getElementById('pf-page'),
};

// The ordered list the page-turner flows through: the current folder's charts
// (by path) in folder mode, else the local songs (recent first).
function perfSetlist() {
  if (mode === 'folder') {
    const cur = currentSong();
    const libId = cur && cur.libId;
    return songs.filter((s) => s.libId === libId).sort((a, b) => (a.path || '').localeCompare(b.path || ''));
  }
  return [...songs].sort((a, b) => b.updated - a.updated);
}

// Force every panel to render regardless of the app's own view toggles, so the
// performance toggles control them independently.
function perfRenderPanels(s) {
  renderChordSet(s, el.diagrams, 'rhythm');
  renderChordSet(s, el.leadDiagrams, 'lead');
  renderScale(s);
  renderHarmonica(s);
}

function openPerform() {
  const s = currentSong();
  if (!s || perf.open) return;
  renderPreview();
  perfRenderPanels(s);
  // Relocate the live panel nodes into the overlay (keeps them interactive).
  for (const [key, id] of Object.entries(PERF_PANELS)) {
    const node = document.getElementById(id);
    if (!node) continue;
    if (!perf.orig[id]) perf.orig[id] = { parent: node.parentNode, next: node.nextSibling };
    const wrap = document.createElement('div');
    wrap.className = 'pf-panel';
    wrap.dataset.panel = key;
    wrap.innerHTML = `<div class="pf-panel-h">${PERF_LABELS[key]}</div>`;
    wrap.appendChild(node);
    pf.panels.appendChild(wrap);
  }
  perf.open = true;
  pf.overlay.hidden = false;
  document.body.classList.add('performing');
  pf.colNum.textContent = prefs.perform.cols;
  pf.fontNum.textContent = prefs.perform.font;
  syncPerfToggles();
  renderPerformBody();
  perfAutoFont();     // size text to the saved column count for this song/screen
  applyPerfPanels();
  document.addEventListener('keydown', perfKeydown, true);
  pf.overlay.addEventListener('mousemove', perfActivity);
  perfActivity();
  try { if (pf.overlay.requestFullscreen) pf.overlay.requestFullscreen(); } catch { /* ignore */ }
}

function closePerform() {
  if (!perf.open) return;
  perf.open = false;
  document.removeEventListener('keydown', perfKeydown, true);
  pf.overlay.removeEventListener('mousemove', perfActivity);
  clearTimeout(perf.idleTimer);
  // Return the panel nodes to their original places in the preview.
  for (const id of Object.values(PERF_PANELS)) {
    const node = document.getElementById(id);
    const o = perf.orig[id];
    if (o && node) o.parent.insertBefore(node, o.next);
  }
  pf.panels.innerHTML = '';
  pf.overlay.classList.remove('immersive');
  pf.overlay.hidden = true;
  document.body.classList.remove('performing');
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch { /* ignore */ }
  renderPreview();
}

function renderPerformBody() {
  const s = currentSong();
  if (!s) return;
  pf.song.textContent = (s.title || 'Untitled') + (s.artist ? ' · ' + s.artist : '');
  pf.cols.innerHTML = render(s.body, inlineShift(s));
  perf.page = 0;
  applyPerfLayout();
}

// The width one column needs to hold the target number of columns across.
function targetColW(cols, vw) {
  return (vw - PERF_PADX * 2 - (cols - 1) * PERF_GAP) / cols;
}

// The widest chord/lyric line at a given font. Chart lines are white-space:pre
// (never wrap — wrapping would misalign chords over syllables), so a column can
// be no narrower than this without lines overlapping the next column. Measured
// in an offscreen shrink-to-fit clone so multicol/{page} don't skew the result.
let pfMeasure = null;
function widestLinePx(font) {
  if (!pfMeasure) {
    pfMeasure = document.createElement('div');
    pfMeasure.className = 'preview';
    pfMeasure.style.cssText =
      'position:absolute; left:-99999px; top:0; visibility:hidden; display:inline-block; white-space:pre; padding:0; overflow:visible;';
    document.body.appendChild(pfMeasure);
  }
  pfMeasure.style.fontSize = font + 'px';
  pfMeasure.innerHTML = pf.cols.innerHTML;
  return pfMeasure.scrollWidth;
}

// Largest font at which `cols` columns of the widest line still fit the screen.
function fontForCols(cols) {
  const vw = pf.viewport.clientWidth;
  const ref = 40;
  const wref = widestLinePx(ref);
  if (wref <= 0) return prefs.perform.font;
  const f = Math.floor(targetColW(cols, vw) * ref / wref);
  return Math.max(10, Math.min(60, f));
}

// Lay out columns. A column is never narrower than the widest line, so lines
// never overlap; if the chosen font makes them too wide for `cols` per screen,
// columns widen and the extra ones page horizontally instead. Returns metrics.
function perfLayoutCore() {
  const vw = pf.viewport.clientWidth;
  const wline = widestLinePx(prefs.perform.font);
  const colW = Math.max(80, Math.floor(Math.max(targetColW(prefs.perform.cols, vw), wline)));
  pf.cols.style.setProperty('--pf-font', prefs.perform.font + 'px');
  pf.cols.style.columnGap = PERF_GAP + 'px';
  pf.cols.style.columnWidth = colW + 'px';
  return { vw, total: pf.cols.scrollWidth }; // reading scrollWidth forces reflow
}

// Auto-size the font so the current column count fits without overlap.
function perfAutoFont() {
  prefs.perform.font = fontForCols(prefs.perform.cols);
  pf.fontNum.textContent = prefs.perform.font;
  savePrefs();
  applyPerfLayout();
}

function applyPerfLayout() {
  if (!perf.open) return;
  const { vw, total } = perfLayoutCore();
  perf.pages = Math.max(1, Math.round(total / vw));
  if (perf.page > perf.pages - 1) perf.page = perf.pages - 1;
  goPerfPage(perf.page);
}

function goPerfPage(p) {
  perf.page = Math.max(0, Math.min(perf.pages - 1, p));
  const vw = pf.viewport.clientWidth;
  pf.cols.style.transform = `translateX(${-perf.page * vw}px)`;
  pf.pageLabel.textContent = perf.pages > 1 ? `Page ${perf.page + 1}/${perf.pages}` : '';
}

function perfForward() {
  if (perf.page < perf.pages - 1) goPerfPage(perf.page + 1);
  else perfChangeSong(1);
}
function perfBack() {
  if (perf.page > 0) goPerfPage(perf.page - 1);
  else perfChangeSong(-1);
}

function perfChangeSong(dir) {
  const list = perfSetlist();
  const i = list.findIndex((x) => x.id === currentId);
  const j = i + dir;
  if (j < 0 || j >= list.length) return; // at the ends of the set
  selectSong(list[j].id);
  perfRenderPanels(currentSong());
  renderPerformBody();
}

function perfKeydown(e) {
  if (!perf.open) return;
  switch (e.key) {
    case 'Escape': e.preventDefault(); closePerform(); break;
    case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ': case 'Spacebar':
      e.preventDefault(); perfForward(); break;
    case 'ArrowLeft': case 'ArrowUp': case 'PageUp':
      e.preventDefault(); perfBack(); break;
    default: break;
  }
}

function perfActivity() {
  pf.overlay.classList.remove('immersive');
  clearTimeout(perf.idleTimer);
  perf.idleTimer = setTimeout(() => { if (perf.open) pf.overlay.classList.add('immersive'); }, 3500);
}

function syncPerfToggles() {
  pf.bar.querySelectorAll('.pf-toggle').forEach((b) => {
    b.classList.toggle('on', !!prefs.perform.panels[b.dataset.panel]);
  });
}

function applyPerfPanels() {
  let any = false;
  pf.panels.querySelectorAll('.pf-panel').forEach((w) => {
    const on = !!prefs.perform.panels[w.dataset.panel];
    w.hidden = !on;
    if (on) any = true;
  });
  pf.panels.classList.toggle('hidden', !any);
  applyPerfLayout(); // panels change the body height → re-measure pages
}

function setPerfCols(d) {
  prefs.perform.cols = Math.max(1, Math.min(10, prefs.perform.cols + d));
  pf.colNum.textContent = prefs.perform.cols;
  perfAutoFont(); // size the text to the new column count (also saves + re-lays)
}
function setPerfFont(d) {
  prefs.perform.font = Math.max(10, Math.min(80, prefs.perform.font + d));
  pf.fontNum.textContent = prefs.perform.font;
  savePrefs();
  applyPerfLayout();
}
// Shrink the font until the whole song fits one screen (no horizontal paging).
function perfFit() {
  const vw = pf.viewport.clientWidth;
  let f = prefs.perform.font;
  while (f > 10) {
    prefs.perform.font = f;
    if (perfLayoutCore().total <= vw + 2) break;
    f -= 1;
  }
  prefs.perform.font = f;
  pf.fontNum.textContent = f;
  savePrefs();
  applyPerfLayout();
}

document.getElementById('perform-btn').addEventListener('click', openPerform);
document.getElementById('pf-exit').addEventListener('click', closePerform);
document.getElementById('pf-col-up').addEventListener('click', () => setPerfCols(1));
document.getElementById('pf-col-down').addEventListener('click', () => setPerfCols(-1));
document.getElementById('pf-font-up').addEventListener('click', () => setPerfFont(1));
document.getElementById('pf-font-down').addEventListener('click', () => setPerfFont(-1));
document.getElementById('pf-fit').addEventListener('click', perfFit);
document.getElementById('pf-prev-song').addEventListener('click', () => perfChangeSong(-1));
document.getElementById('pf-next-song').addEventListener('click', () => perfChangeSong(1));
pf.bar.querySelectorAll('.pf-toggle').forEach((b) => b.addEventListener('click', () => {
  const k = b.dataset.panel;
  prefs.perform.panels[k] = !prefs.perform.panels[k];
  savePrefs();
  syncPerfToggles();
  applyPerfPanels();
}));
window.addEventListener('resize', () => { if (perf.open) applyPerfLayout(); });

// ---- Metronome -------------------------------------------------------------
// Clicks are scheduled a little ahead on the Web Audio clock so the tempo stays
// steady regardless of JS timer jitter.
// A 16th-note step sequencer: each step is a 16th note, so `steps` = beats × 4
// (16 = one 4/4 bar). Any step count works, for odd meters (e.g. 14 = 7/8).
const DRUMS = [
  { id: 'kick', label: 'Kick' },
  { id: 'snare', label: 'Snare' },
  { id: 'hihat', label: 'Hi-hat' },
  { id: 'tom', label: 'Tom' },
  { id: 'crash', label: 'Crash' },
];
const metro = {
  ctx: null, on: false, bpm: 100, steps: 16, step: 0, next: 0, timer: null, taps: [],
  click: true, noiseBuf: null, pattern: null,
};

function newPattern(steps) { return DRUMS.map(() => new Array(steps).fill(false)); }

// A basic starter beat: kick on beats 1 & 3, snare on 2 & 4, hats on eighths.
function defaultGroove(steps) {
  const p = newPattern(steps);
  for (let s = 0; s < steps; s++) {
    if (s % 8 === 0) p[0][s] = true;      // kick
    if (s % 8 === 4) p[1][s] = true;      // snare
    if (s % 2 === 0) p[2][s] = true;      // hi-hat
  }
  return p;
}

function saveMetro() {
  prefs.metro = { bpm: metro.bpm, steps: metro.steps, click: metro.click, pattern: metro.pattern };
  savePrefs();
}

// ---- Synthesized drum voices (Web Audio) ----
function noiseSource() {
  const ctx = metro.ctx;
  if (!metro.noiseBuf) {
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    metro.noiseBuf = buf;
  }
  const src = ctx.createBufferSource();
  src.buffer = metro.noiseBuf;
  return src;
}
function drumEnv(t, peak, decay) {
  const g = metro.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  return g;
}
function drumKick(t) {
  const ctx = metro.ctx, o = ctx.createOscillator();
  o.frequency.setValueAtTime(160, t);
  o.frequency.exponentialRampToValueAtTime(50, t + 0.11);
  const g = drumEnv(t, 1.0, 0.18);
  o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.2);
}
function drumSnare(t) {
  const ctx = metro.ctx;
  const n = noiseSource(), nf = ctx.createBiquadFilter();
  nf.type = 'highpass'; nf.frequency.value = 1200;
  const ng = drumEnv(t, 0.7, 0.14);
  n.connect(nf); nf.connect(ng); ng.connect(ctx.destination);
  const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 190;
  const og = drumEnv(t, 0.5, 0.1);
  o.connect(og); og.connect(ctx.destination);
  n.start(t); n.stop(t + 0.15); o.start(t); o.stop(t + 0.11);
}
function drumHihat(t) {
  const ctx = metro.ctx;
  const n = noiseSource(), nf = ctx.createBiquadFilter();
  nf.type = 'highpass'; nf.frequency.value = 7000;
  const ng = drumEnv(t, 0.35, 0.05);
  n.connect(nf); nf.connect(ng); ng.connect(ctx.destination);
  n.start(t); n.stop(t + 0.07);
}
function drumTom(t) {
  const ctx = metro.ctx, o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(180, t);
  o.frequency.exponentialRampToValueAtTime(90, t + 0.18);
  const g = drumEnv(t, 0.8, 0.25);
  o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.3);
}
function drumCrash(t) {
  const ctx = metro.ctx;
  const n = noiseSource(), nf = ctx.createBiquadFilter();
  nf.type = 'highpass'; nf.frequency.value = 5000;
  const ng = drumEnv(t, 0.5, 0.8);
  n.connect(nf); nf.connect(ng); ng.connect(ctx.destination);
  n.start(t); n.stop(t + 1.0);
}
const DRUM_FN = { kick: drumKick, snare: drumSnare, hihat: drumHihat, tom: drumTom, crash: drumCrash };

// A soft click on the beat (every 4 steps) when Click is on.
function metroClick(t, accent) {
  const ctx = metro.ctx, osc = ctx.createOscillator(), g = ctx.createGain();
  osc.frequency.value = accent ? 1600 : 1000;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(accent ? 0.35 : 0.2, t + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
  osc.connect(g); g.connect(ctx.destination); osc.start(t); osc.stop(t + 0.05);
}

function metroHighlight(step) {
  if (!metro.on) return;
  document.querySelectorAll('#dm-grid .dm-cells').forEach((lane) => {
    lane.querySelectorAll('.dm-cell').forEach((c, i) => c.classList.toggle('playing', i === step));
  });
}

function metroSchedule() {
  const ctx = metro.ctx;
  const stepDur = 15 / metro.bpm; // 16th note = (60/bpm)/4
  while (metro.next < ctx.currentTime + 0.12) {
    const step = metro.step, when = metro.next;
    DRUMS.forEach((d, r) => { if (metro.pattern[r][step]) DRUM_FN[d.id](when); });
    if (metro.click && step % 4 === 0) metroClick(when, step === 0);
    setTimeout(() => metroHighlight(step), Math.max(0, (when - ctx.currentTime) * 1000));
    metro.step = (step + 1) % metro.steps;
    metro.next += stepDur;
  }
  metro.timer = setTimeout(metroSchedule, 20);
}

function renderDrumGrid() {
  const grid = document.getElementById('dm-grid');
  grid.innerHTML = DRUMS.map((d, r) => {
    let cells = '';
    for (let s = 0; s < metro.steps; s++) {
      cells += `<button class="dm-cell${metro.pattern[r][s] ? ' on' : ''}${s % 4 === 0 ? ' beat' : ''}" data-r="${r}" data-s="${s}"></button>`;
    }
    return `<div class="dm-lane"><span class="dm-lane-label">${d.label}</span><div class="dm-cells">${cells}</div></div>`;
  }).join('');
  grid.querySelectorAll('.dm-cell').forEach((c) => c.addEventListener('click', () => {
    const r = +c.dataset.r, s = +c.dataset.s;
    metro.pattern[r][s] = !metro.pattern[r][s];
    c.classList.toggle('on', metro.pattern[r][s]);
    saveMetro();
  }));
}

function setSteps(n) {
  n = Math.max(4, Math.min(32, n));
  metro.pattern = metro.pattern.map((lane) => {
    const nl = new Array(n).fill(false);
    for (let i = 0; i < Math.min(n, lane.length); i++) nl[i] = lane[i];
    return nl;
  });
  metro.steps = n;
  if (metro.step >= n) metro.step = 0;
  document.getElementById('dm-steps').textContent = n;
  renderDrumGrid();
  saveMetro();
}

function metroStart() {
  if (metro.on) return;
  if (!metro.ctx) metro.ctx = new (window.AudioContext || window.webkitAudioContext)();
  metro.ctx.resume();
  metro.on = true;
  metro.step = 0;
  metro.next = metro.ctx.currentTime + 0.06;
  const b = document.getElementById('metro-toggle');
  b.textContent = 'Stop'; b.classList.add('on');
  metroSchedule();
}
function metroStop() {
  metro.on = false;
  clearTimeout(metro.timer);
  const b = document.getElementById('metro-toggle');
  b.textContent = 'Start'; b.classList.remove('on');
  document.querySelectorAll('#dm-grid .dm-cell.playing').forEach((c) => c.classList.remove('playing'));
}
function setBpm(v) {
  metro.bpm = Math.max(40, Math.min(240, Math.round(v)));
  document.getElementById('metro-bpm').textContent = metro.bpm;
  document.getElementById('metro-slider').value = metro.bpm;
  saveMetro();
}

// ---- Tuner (microphone + autocorrelation) ----------------------------------
const tuner = { ctx: null, stream: null, analyser: null, buf: null, raf: null, on: false, preset: 'standard' };

// Tuning presets: each is a list of target strings, low → high, as
// [note+octave, cent offset]. The offset sweetens the target away from equal
// temperament (0 = standard pitch). Covers alternate tunings and sweetened ones.
const TUNER_PRESETS = {
  standard: { name: 'Standard (EADGBE)', strings: [['E2', 0], ['A2', 0], ['D3', 0], ['G3', 0], ['B3', 0], ['E4', 0]] },
  dropD: { name: 'Drop D (DADGBE)', strings: [['D2', 0], ['A2', 0], ['D3', 0], ['G3', 0], ['B3', 0], ['E4', 0]] },
  dadgad: { name: 'DADGAD', strings: [['D2', 0], ['A2', 0], ['D3', 0], ['G3', 0], ['A3', 0], ['D4', 0]] },
  jamesTaylor: { name: 'James Taylor (sweetened)', strings: [['E2', -12], ['A2', -10], ['D3', -8], ['G3', -4], ['B3', -6], ['E4', -3]] },
};

// Autocorrelation pitch detector. Returns frequency in Hz, or -1 if unclear.
function detectPitch(buf, sampleRate) {
  const SIZE = buf.length;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  if (Math.sqrt(rms / SIZE) < 0.01) return -1; // too quiet
  let r1 = 0, r2 = SIZE - 1;
  const thres = 0.2;
  for (let i = 0; i < SIZE / 2; i++) if (Math.abs(buf[i]) < thres) { r1 = i; break; }
  for (let i = 1; i < SIZE / 2; i++) if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; }
  const b = buf.slice(r1, r2);
  const n = b.length;
  if (n < 2) return -1;
  const c = new Array(n).fill(0);
  for (let lag = 0; lag < n; lag++) for (let i = 0; i < n - lag; i++) c[lag] += b[i] * b[i + lag];
  let d = 0; while (d < n - 1 && c[d] > c[d + 1]) d++;
  let maxval = -1, maxpos = -1;
  for (let i = d; i < n; i++) if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
  let T0 = maxpos;
  if (T0 <= 0) return -1;
  const x1 = c[T0 - 1] || 0, x2 = c[T0], x3 = c[T0 + 1] || 0;
  const a = (x1 + x3 - 2 * x2) / 2, bb = (x3 - x1) / 2;
  if (a) T0 = T0 - bb / (2 * a);
  return sampleRate / T0;
}

const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function freqToNote(freq) {
  const midi = 69 + 12 * Math.log2(freq / 440);
  const rounded = Math.round(midi);
  return {
    name: NOTE_NAMES_SHARP[((rounded % 12) + 12) % 12],
    octave: Math.floor(rounded / 12) - 1,
    cents: Math.round((midi - rounded) * 100),
  };
}

async function tunerStart() {
  const centsEl = document.getElementById('tuner-cents');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    centsEl.textContent = 'Microphone not available in this browser.';
    return;
  }
  try {
    tuner.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch {
    centsEl.textContent = 'Microphone access was denied.';
    return;
  }
  tuner.ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = tuner.ctx.createMediaStreamSource(tuner.stream);
  tuner.analyser = tuner.ctx.createAnalyser();
  tuner.analyser.fftSize = 2048;
  tuner.buf = new Float32Array(tuner.analyser.fftSize);
  src.connect(tuner.analyser);
  tuner.on = true;
  const b = document.getElementById('tuner-toggle');
  b.textContent = 'Stop'; b.classList.add('on');
  centsEl.textContent = 'Listening…';
  tunerLoop();
}
function tunerLoop() {
  if (!tuner.on) return;
  tuner.analyser.getFloatTimeDomainData(tuner.buf);
  updateTuner(detectPitch(tuner.buf, tuner.ctx.sampleRate));
  tuner.raf = requestAnimationFrame(tunerLoop);
}
function updateTuner(freq) {
  const noteEl = document.getElementById('tuner-note');
  const centsEl = document.getElementById('tuner-cents');
  const needle = document.getElementById('tuner-needle');
  if (freq < 25 || freq > 5000) {
    needle.style.left = '50%'; needle.classList.remove('in-tune'); noteEl.classList.remove('in-tune');
    document.querySelectorAll('#tuner-strings .tstr').forEach((s) => s.classList.remove('active'));
    return;
  }
  const { name, octave, cents } = freqToNote(freq);
  // Match the played note to a string in the current tuning and measure against
  // its (possibly sweetened) target pitch.
  const key = name + octave;
  const preset = TUNER_PRESETS[tuner.preset];
  const str = preset && preset.strings.find(([n]) => n === key);
  let offLabel = '';
  let cts = cents;
  if (str) {
    cts = cents - str[1];
    if (str[1] !== 0) offLabel = ` · target ${str[1] > 0 ? '+' : ''}${str[1]}¢`;
  }
  document.querySelectorAll('#tuner-strings .tstr').forEach((s) => s.classList.toggle('active', s.dataset.note === key));
  noteEl.textContent = name + octave;
  const inTune = Math.abs(cts) <= 5;
  centsEl.textContent = (cts > 0 ? '+' : '') + cts + ' cents' + (inTune ? ' · in tune' : cts > 0 ? ' · sharp' : ' · flat') + offLabel;
  needle.style.left = (50 + Math.max(-50, Math.min(50, cts))) + '%';
  needle.classList.toggle('in-tune', inTune);
  noteEl.classList.toggle('in-tune', inTune);
}
function tunerStop() {
  tuner.on = false;
  if (tuner.raf) cancelAnimationFrame(tuner.raf);
  if (tuner.stream) tuner.stream.getTracks().forEach((t) => t.stop());
  if (tuner.ctx) tuner.ctx.close();
  tuner.ctx = null;
  const b = document.getElementById('tuner-toggle');
  b.textContent = 'Start'; b.classList.remove('on');
  document.getElementById('tuner-note').textContent = '—';
  document.getElementById('tuner-note').classList.remove('in-tune');
  document.getElementById('tuner-cents').textContent = 'Start, then play a single note.';
  document.getElementById('tuner-needle').style.left = '50%';
  document.getElementById('tuner-needle').classList.remove('in-tune');
}

// ---- Tool panel wiring ----
function toggleTool(name) {
  const panel = document.getElementById(name + '-panel');
  panel.hidden = !panel.hidden;
  if (panel.hidden) { if (name === 'metro') metroStop(); if (name === 'tuner') tunerStop(); }
}
document.getElementById('metro-btn').addEventListener('click', () => toggleTool('metro'));
document.getElementById('tuner-btn').addEventListener('click', () => toggleTool('tuner'));
document.querySelectorAll('.tool-close').forEach((b) => b.addEventListener('click', () => toggleTool(b.dataset.tool)));
document.getElementById('metro-up').addEventListener('click', () => setBpm(metro.bpm + 1));
document.getElementById('metro-down').addEventListener('click', () => setBpm(metro.bpm - 1));
document.getElementById('metro-slider').addEventListener('input', (e) => setBpm(+e.target.value));
document.getElementById('dm-steps-down').addEventListener('click', () => setSteps(metro.steps - 1));
document.getElementById('dm-steps-up').addEventListener('click', () => setSteps(metro.steps + 1));
document.getElementById('dm-click').addEventListener('change', (e) => { metro.click = e.target.checked; saveMetro(); });
document.getElementById('dm-clear').addEventListener('click', () => {
  metro.pattern = newPattern(metro.steps); renderDrumGrid(); saveMetro();
});
document.getElementById('metro-tap').addEventListener('click', () => {
  const now = performance.now();
  metro.taps = metro.taps.filter((t) => now - t < 2000);
  metro.taps.push(now);
  if (metro.taps.length >= 2) {
    let sum = 0;
    for (let i = 1; i < metro.taps.length; i++) sum += metro.taps[i] - metro.taps[i - 1];
    setBpm(60000 / (sum / (metro.taps.length - 1)));
  }
});
document.getElementById('metro-toggle').addEventListener('click', () => (metro.on ? metroStop() : metroStart()));
document.getElementById('tuner-toggle').addEventListener('click', () => (tuner.on ? tunerStop() : tunerStart()));
// Show the target strings for the current tuning (low → high) as a reference;
// the string nearest the played note is highlighted during tuning.
function renderTunerStrings() {
  const box = document.getElementById('tuner-strings');
  box.innerHTML = TUNER_PRESETS[tuner.preset].strings
    .map(([n]) => `<span class="tstr" data-note="${n}">${n.replace(/[0-9]/g, '')}</span>`).join('');
}
(function initTunerPreset() {
  const tp = document.getElementById('tuner-preset');
  tuner.preset = TUNER_PRESETS[prefs.tunerPreset] ? prefs.tunerPreset : 'standard';
  tp.value = tuner.preset;
  renderTunerStrings();
  tp.addEventListener('change', () => {
    tuner.preset = tp.value;
    prefs.tunerPreset = tp.value;
    savePrefs();
    renderTunerStrings();
  });
})();

// Restore saved metronome/drum settings, then draw the grid.
(function initMetro() {
  const m = prefs.metro;
  metro.bpm = m.bpm; metro.steps = m.steps; metro.click = m.click;
  metro.pattern = (Array.isArray(m.pattern) && m.pattern.length === DRUMS.length &&
    m.pattern.every((l) => Array.isArray(l) && l.length === m.steps))
    ? m.pattern.map((l) => l.slice()) : defaultGroove(m.steps);
  document.getElementById('metro-bpm').textContent = metro.bpm;
  document.getElementById('metro-slider').value = metro.bpm;
  document.getElementById('dm-steps').textContent = metro.steps;
  document.getElementById('dm-click').checked = metro.click;
  renderDrumGrid();
})();

// ---- Boot ------------------------------------------------------------------

function boot() {
  initSectionBar();
  el.toggleDiagrams.checked = prefs.diagrams;
  el.toggleLead.checked = prefs.lead;
  el.toggleHarmonica.checked = prefs.harmonica;
  el.toggleGuitar.checked = prefs.instruments.guitar;
  el.togglePiano.checked = prefs.instruments.piano;
  el.toggleUke.checked = prefs.instruments.ukulele;
  applyPrintCols();
  // No demo/seed content — start empty and let the user create the first song
  // (or reconnect a folder below).
  if (songs.length) {
    const last = localStorage.getItem(LAST_KEY);
    const startId = songs.some((s) => s.id === last)
      ? last
      : [...songs].sort((a, b) => b.updated - a.updated)[0].id;
    selectSong(startId);
  } else {
    showEmptyState();
  }

  // Reconnect any remembered folders (some may need a permission click).
  bootFolders();
}

// Nothing selected: blank the workspace and invite the user to create a song.
// Typing in the editor (in local mode) creates one on the first keystroke.
function showEmptyState() {
  currentId = null;
  el.title.value = '';
  el.artist.value = '';
  el.editor.value = '';
  el.trAmount.textContent = '0';
  el.capoAmount.textContent = '0';
  el.previewBody.innerHTML = render('', 0); // the "nothing yet" hint
  el.diagrams.innerHTML = '';
  el.leadDiagrams.innerHTML = '';
  el.scalePanel.innerHTML = '';
  el.harmonica.innerHTML = '';
  el.capoBanner.innerHTML = '';
  updatePrintHeader({ title: '', artist: '' });
  renderPalette(); // show the [ ] insert button even before a song exists
  renderList();
}

// Restore remembered libraries: load the ones already permitted, and surface a
// one-click "Reconnect" button for any that need a fresh permission grant
// (browsers can't silently re-grant folder access on a cold start).
async function bootFolders() {
  let saved = await idbGet('libraries');
  if (!saved) {
    const legacy = await idbGet('dirHandle'); // migrate the old single-folder key
    if (legacy) saved = [{ id: newLibId(), name: legacy.name, handle: legacy }];
  }
  if (!saved || !saved.length) return;
  const ready = [], need = [];
  for (const entry of saved) {
    let perm;
    try { perm = await entry.handle.queryPermission({ mode: 'readwrite' }); }
    catch { perm = 'denied'; }
    (perm === 'granted' ? ready : need).push(entry);
  }
  if (ready.length) await reconnectLibraries(ready);
  if (need.length) showReconnect(need);
}

async function reconnectLibraries(entries) {
  for (const entry of entries) {
    if (libraries.some((l) => l.id === entry.id)) continue;
    if (mode === 'local') { mode = 'folder'; songs = []; currentId = null; }
    const lib = { id: entry.id || newLibId(), name: entry.name, handle: entry.handle };
    const loaded = await loadLibrarySongs(lib);
    libraries.push(lib);
    songs.push(...loaded);
  }
  await persistLibraries();
  updateModeUI();
  if (!songs.some((s) => s.id === currentId)) {
    const want = await idbGet('lastPath');
    const match = want && songs.find((s) => s.path === want);
    if (match) selectSong(match.id);
    else if (songs.length) selectSong(songs[0].id);
    else renderList();
  } else {
    renderList();
  }
}

function showReconnect(need) {
  reopenBtn.hidden = false;
  reopenBtn.textContent = need.length > 1 ? `Reconnect folders (${need.length})` : 'Reconnect folder';
  reopenBtn.onclick = async () => {
    const granted = [];
    for (const entry of need) {
      let perm;
      try {
        perm = await entry.handle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') perm = await entry.handle.requestPermission({ mode: 'readwrite' });
      } catch { perm = 'denied'; }
      if (perm === 'granted') granted.push(entry);
    }
    if (granted.length) await reconnectLibraries(granted);
    const stillNeed = need.filter((e) => !granted.includes(e));
    if (stillNeed.length) showReconnect(stillNeed);
    else reopenBtn.hidden = true;
  };
}

boot();
