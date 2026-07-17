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
let libraries = [];           // [{ id, name, handle, kind, color, subdirs }] — open folders
let activeLibId = null;       // folder that + New / Import target
let activeSubpath = '';       // subfolder within that folder that new charts target
const fileHandles = {};       // song id -> FileSystemFileHandle
const collapsed = new Set();  // collapsed nodes: libId, or libId+'\0'+subpath

// Every storage system carries an accent colour so charts from different places
// never look like they belong together. The Collection (your managed home
// folder) is always the same green; external folders cycle through a palette;
// browser (localStorage) is neutral grey.
const COLLECTION_DIR = 'GuitarTabWriterCollection';
const COLLECTION_COLOR = '#5db073';
const BROWSER_COLOR = '#8b90a3';
const EXTERNAL_PALETTE = ['#5b9dd9', '#e0a458', '#a986d6', '#4bb5a8', '#d97aa6', '#c98b4b'];
function nextExternalColor() {
  const n = libraries.filter((l) => l.kind === 'external').length;
  return EXTERNAL_PALETTE[n % EXTERNAL_PALETTE.length];
}
// Build a library record from a directory handle. Collection is the managed
// home ("Collection"); anything else is an ad-hoc external folder.
function makeLib(handle, kind) {
  return {
    id: newLibId(),
    name: kind === 'collection' ? 'Collection' : handle.name,
    handle,
    kind,
    color: kind === 'collection' ? COLLECTION_COLOR : nextExternalColor(),
  };
}
// The colour + label for whatever system is active right now (for breadcrumb).
function systemInfo() {
  if (mode !== 'folder') return { color: BROWSER_COLOR, label: 'Browser', kind: 'browser' };
  const lib = activeLib();
  return lib
    ? { color: lib.color, label: lib.name, kind: lib.kind }
    : { color: BROWSER_COLOR, label: 'Browser', kind: 'browser' };
}

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

async function scanDir(dir, prefix, out, dirs) {
  for await (const entry of dir.values()) {
    if (entry.kind === 'file' && entry.name.endsWith('.cho')) {
      out.push({ name: entry.name, path: prefix + entry.name, handle: entry });
    } else if (entry.kind === 'directory') {
      if (dirs) dirs.add(prefix + entry.name);            // remember (incl. empty)
      await scanDir(entry, prefix + entry.name + '/', out, dirs);
    }
  }
}

// Read every .cho in a library's folder into song objects tagged with libId.
// Also records the folder's subdirectory paths (so empty ones show in the tree).
async function loadLibrarySongs(lib) {
  const found = [];
  const dirs = new Set();
  await scanDir(lib.handle, '', found, dirs);
  lib.subdirs = dirs;
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
  return idbSet('libraries', libraries.map((l) => ({ id: l.id, name: l.name, handle: l.handle, kind: l.kind, color: l.color })));
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
  setActiveTarget(libId, '');
}

// Point + New / Import / PDF-drop at a specific folder AND subfolder.
function setActiveTarget(libId, subpath) {
  activeLibId = libId;
  activeSubpath = subpath || '';
  collapsed.delete(libId); // expand the library so you can see / fill it
  // expand each ancestor folder down to the target
  let acc = '';
  for (const seg of activeSubpath.split('/').filter(Boolean)) {
    acc = acc ? acc + '/' + seg : seg;
    collapsed.delete(libId + '\0' + acc);
  }
  updateModeUI();          // refreshes the "new →" bar and re-renders the list
}

// Walk (optionally creating) the directory handle for a subpath inside a library.
async function resolveDir(lib, subpath, create) {
  let dir = lib.handle;
  for (const seg of (subpath || '').split('/').filter(Boolean)) {
    dir = await dir.getDirectoryHandle(seg, { create: !!create });
  }
  return dir;
}

// Join a subfolder path and filename into a library-relative path.
function joinPath(subpath, fname) {
  return subpath ? subpath + '/' + fname : fname;
}

// First folder opened from browser mode: copy browser songs into it and switch
// to editing files on disk. `lib` already carries kind + colour.
async function adoptFolderFromLocal(lib) {
  const handle = lib.handle;
  const localSongs = songs.slice();
  const dest = lib.kind === 'collection' ? 'your Collection' : `"${handle.name}"`;
  if (localSongs.length &&
      !confirm(`Copy your ${localSongs.length} browser song${localSongs.length === 1 ? '' : 's'} into ${dest} as .cho files and switch to editing files on disk?\n\n(Your browser copy is kept as a backup.)`)) {
    return;
  }
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

// Add another already-built library alongside the open ones (folder mode).
async function addLibrary(lib) {
  for (const l of libraries) {
    let same = l.handle === lib.handle;
    try { same = same || await lib.handle.isSameEntry(l.handle); } catch { /* ignore */ }
    if (same) { alert(`"${l.name}" is already open.`); setActiveLib(l.id); return; }
  }
  const loaded = await loadLibrarySongs(lib);
  libraries.push(lib);
  songs.push(...loaded);
  activeLibId = lib.id; // the folder you just opened becomes the new-file target
  await persistLibraries();
  updateModeUI();
  if (loaded.length) selectSong(loaded[0].id); else renderList();
}

// Bring a freshly-built library into the app, whichever mode we're in.
async function openLibrary(lib) {
  if (mode === 'folder') await addLibrary(lib);
  else await adoptFolderFromLocal(lib);
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
  await openLibrary(makeLib(handle, 'external'));
}

// Set up (or focus) the managed Collection: a GuitarTabWriterCollection folder
// in a location you pick once. The picker opens in Documents by default.
async function setupCollection() {
  if (!window.showDirectoryPicker) {
    alert('The Collection needs Chrome or Edge, served over http://localhost or https:// (not file://).');
    return;
  }
  const existing = libraries.find((l) => l.kind === 'collection');
  if (existing) { setActiveLib(existing.id); return; } // already open — just target it
  // The folder you pick is the PARENT: a "GuitarTabWriterCollection" folder is
  // created inside it to hold your charts. Spell that out so the picked folder
  // isn't mistaken for the collection root itself.
  if (!confirm(
    `Pick where your Collection should live.\n\n` +
    `A folder named "${COLLECTION_DIR}" will be created inside the folder you choose, ` +
    `and all your charts will live in there.\n\n` +
    `So pick the PARENT location (e.g. Documents) — not an existing collection folder.`)) return;
  let parent;
  try {
    parent = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'documents', id: 'gtw-collection' });
  } catch { return; } // cancelled
  let handle;
  try {
    handle = await parent.getDirectoryHandle(COLLECTION_DIR, { create: true });
  } catch { alert(`Could not create "${COLLECTION_DIR}" in that location.`); return; }
  await openLibrary(makeLib(handle, 'collection'));
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
  // A folder draft has no file to autosave into; leave it in memory until the
  // user hits Save (which writes it to the folder). Don't claim it's "Saved".
  if (mode === 'folder' && s.draft && !fileHandles[s.id]) {
    el.status.textContent = 'Draft · Save to write to folder';
    renderBreadcrumb('Draft — not yet saved to folder');
    return;
  }
  el.status.textContent = 'Saving…';
  renderBreadcrumb('Saving…');
  clearTimeout(persistTimer);
  persistTimer = setTimeout(async () => {
    if (mode === 'folder') {
      try { await writeSong(s); el.status.textContent = 'Saved · ' + (s.path || 'file'); renderBreadcrumb('Saved ✓'); }
      catch { el.status.textContent = 'Save failed'; renderBreadcrumb('Save failed'); }
    } else {
      saveSongs(songs);
      el.status.textContent = 'Saved';
      renderBreadcrumb('Saved ✓');
    }
    renderList();
  }, mode === 'folder' ? 600 : 400);
}

// The breadcrumb under the title: which system + folder path the current chart
// lives in, plus its save state. Colour matches the sidebar system colour.
function renderBreadcrumb(stateText) {
  const bc = el.breadcrumb;
  if (!bc) return;
  const s = currentSong();
  if (!s) { bc.hidden = true; bc.innerHTML = ''; return; }
  const sys = systemInfo();
  const loc = [
    `<span class="bc-dot" style="background:${sys.color}"></span>`,
    `<span class="bc-sys">${escapeHtml(sys.label)}</span>`,
  ];
  if (mode === 'folder') {
    const segs = (s.path || '').split('/');
    const file = segs.pop() || '';
    for (const seg of segs)
      loc.push(`<span class="bc-sep">›</span><span class="bc-seg">${escapeHtml(seg)}</span>`);
    loc.push(`<span class="bc-sep">›</span><span class="bc-file">${escapeHtml(file)}</span>`);
  }
  if (stateText === undefined)
    stateText = s.draft ? 'Draft — not yet saved to folder'
      : (mode === 'folder' ? '' : 'Autosaves to this browser');
  let cls = '';
  if (/^Saved/.test(stateText)) cls = 'ok';
  else if (/fail|Draft/i.test(stateText)) cls = 'warn';
  const chip = stateText ? `<span class="bc-state ${cls}">${escapeHtml(stateText)}</span>` : '';
  bc.innerHTML = `<span class="bc-loc">${loc.join('')}</span>${chip}`;
  bc.hidden = false;
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
  breadcrumb: document.getElementById('save-breadcrumb'),
  capoBanner: document.getElementById('capo-banner'),
  instBar: document.getElementById('instrument-bar'),
  instPanels: document.getElementById('instrument-panels'),
  harmonica: document.getElementById('harmonica-panel'),
  toggleChords: document.getElementById('toggle-chords'),
  toggleScales: document.getElementById('toggle-scales'),
};

let songs = loadSongs();
let currentId = null;

// Default jam: two guitars, uke, piano, harmonica on; mandolin + bass off.
const ENSEMBLE_DEFAULTS = { guitar1: true, guitar2: true, ukulele: true, mandolin: false, piano: true, bass: false, harmonica: true };

function loadPrefs() {
  const defaults = {
    showChords: true, showScales: true, harmonica: true, chordMode: 'shapes',
    scaleType: 'majPent',
    voicings: { guitar1: {}, guitar2: {} }, pianoInv: { piano: {} },
    ensemble: Object.assign({}, ENSEMBLE_DEFAULTS),
    perform: { cols: 4, font: 22, panels: { instruments: true, harp: true } },
    printCols: 1,
    metro: { bpm: 100, steps: 16, click: true, pattern: null },
    tunerPreset: 'standard',
  };
  let p = defaults;
  try { p = Object.assign(defaults, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch { /* keep defaults */ }
  // Migrate the old rhythm/lead voicing stores onto the new guitar1/guitar2 slots.
  if (!p.voicings || Array.isArray(p.voicings)) p.voicings = {};
  p.voicings.guitar1 = p.voicings.guitar1 || p.voicings.rhythm || {};
  p.voicings.guitar2 = p.voicings.guitar2 || p.voicings.lead || {};
  if (!p.pianoInv || Array.isArray(p.pianoInv)) p.pianoInv = {};
  p.pianoInv.piano = p.pianoInv.piano || p.pianoInv.rhythm || {};
  p.ensemble = Object.assign({}, ENSEMBLE_DEFAULTS, p.ensemble);
  if (typeof p.showChords !== 'boolean') p.showChords = p.diagrams !== false;  // old 'diagrams' toggle
  if (typeof p.showScales !== 'boolean') p.showScales = p.lead !== false;      // old 'lead' carried the scale
  p.perform = Object.assign({ cols: 4, font: 22, panels: {} }, p.perform);
  p.perform.panels = Object.assign({ instruments: true, harp: true }, p.perform.panels);
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
  else {
    // Selecting a chart points the new-file target at its folder + subfolder, so
    // + New / Import / PDF-drop land next to what you're looking at.
    if (s.libId) { activeLibId = s.libId; activeSubpath = (s.path || '').split('/').slice(0, -1).join('/'); }
    if (s.path) idbSet('lastPath', s.path);
  }
  el.title.value = s.title;
  el.artist.value = s.artist;
  el.editor.value = s.body;
  el.trAmount.textContent = (s.transpose > 0 ? '+' : '') + s.transpose;
  el.capoAmount.textContent = s.capo || 0;
  renderPreview();
  renderPalette();
  renderList();
  renderBreadcrumb();
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
  renderInstrumentBar();
  renderInstruments(s);
  if (prefs.ensemble.harmonica) renderHarmonica(s);
  else el.harmonica.innerHTML = '';
  // In performance mode the panels are relocated into the overlay and shown
  // independently of the app's own toggles, so keep them all populated.
  if (typeof perf !== 'undefined' && perf.open) perfRenderPanels(s);
}

// ---- The jam: instruments, their chords, and their scales ------------------
// Each instrument is one section (chords + scale). guitar1/guitar2 are two
// guitar voicing sets (low vs high — your first/second guitar). Bass is scale-
// only; harmonica keeps its own separate panel.
const INSTRUMENTS = [
  { id: 'guitar1', label: 'Guitar 1', kind: 'guitar', chords: true, scale: true, tuning: STRING_ABS, high: false },
  { id: 'guitar2', label: 'Guitar 2', kind: 'guitar', chords: true, scale: true, tuning: STRING_ABS, high: true },
  { id: 'mandolin', label: 'Mandolin', kind: 'fret', chords: true, scale: true, tuning: MANDO_ABS, voicing: mandoVoicing, diagram: mandoDiagramSVG },
  { id: 'ukulele', label: 'Ukulele', kind: 'fret', chords: true, scale: true, tuning: UKE_ABS, voicing: ukeVoicing, diagram: ukeDiagramSVG },
  { id: 'piano', label: 'Piano', kind: 'piano', chords: true, scale: true },
  { id: 'bass', label: 'Bass', kind: 'fret', chords: false, scale: true, tuning: BASS_ABS },
  { id: 'harmonica', label: 'Harmonica', kind: 'harmonica', chords: false, scale: false },
];
function activeInstruments() { return INSTRUMENTS.filter((i) => prefs.ensemble[i.id]); }

// A song's chords, transposed to shapes, de-duplicated: [{raw, shape}].
function chordListFor(s) {
  const shapeSh = shapeShift(s);
  const seen = new Set(), out = [];
  for (const tok of s.body.match(/\[([^\]]*)\]/g) || []) {
    const name = tok.slice(1, -1);
    if (!isChord(name)) continue;
    const shape = transposeChord(name, shapeSh);
    if (seen.has(shape)) continue;
    seen.add(shape);
    out.push({ raw: name, shape });
  }
  return out;
}

// The jam roster: an on/off chip per instrument.
function renderInstrumentBar() {
  el.instBar.innerHTML = INSTRUMENTS.map((i) => {
    const on = !!prefs.ensemble[i.id];
    return `<button class="inst-chip${on ? ' on' : ''}" data-inst="${i.id}" ` +
      `title="${on ? 'Remove from' : 'Add to'} the jam">${escapeHtml(i.label)}</button>`;
  }).join('');
  el.instBar.querySelectorAll('.inst-chip').forEach((b) => b.addEventListener('click', () => {
    prefs.ensemble[b.dataset.inst] = !prefs.ensemble[b.dataset.inst];
    savePrefs();
    renderPreview();
  }));
}

// Scale root/type/focus controls — shown once above the per-instrument scales.
function scaleControlsHtml(s, pc, auto, scale, highlight) {
  let rootOpts = `<option value="auto"${auto ? ' selected' : ''}>Auto (${HARP_NAMES[pc]})</option>`;
  for (let i = 0; i < 12; i++) rootOpts += `<option value="${i}"${!auto && s.scaleRoot === i ? ' selected' : ''}>${HARP_NAMES[i]}</option>`;
  const scaleOpts = SCALES.map((sc) => `<option value="${sc.id}"${sc.id === scale.id ? ' selected' : ''}>${sc.name}</option>`).join('');
  const focusOpts = `<option value="">none</option>` + uniqueShapes(s).map((c) =>
    `<option value="${escapeHtml(c)}"${s.focusChord === c ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('');
  const legendHi = highlight ? ` <span class="sp-dot hi"></span>chord tone` : '';
  return `<div class="sp-head"><span class="sp-title">${HARP_NAMES[pc]} ${escapeHtml(scale.name)}</span>` +
    `<span class="muted">Root</span><select id="scale-root">${rootOpts}</select>` +
    `<select id="scale-type">${scaleOpts}</select>` +
    `<span class="muted">Chord</span><select id="scale-focus">${focusOpts}</select>` +
    `<span class="sp-legend"><span class="sp-dot root"></span>root <span class="sp-dot note"></span>scale tone${legendHi}</span></div>`;
}

// Build a section for every active instrument (chords + scale, per toggles).
function renderInstruments(s) {
  const chords = chordListFor(s);
  const soundSh = soundShift(s);
  const soundOf = (c) => (s.capo ? transposeChord(c.raw, soundSh) : null);

  const auto = s.scaleRoot === null || s.scaleRoot === undefined;
  const pc = auto ? soundingKeyPc(s) : s.scaleRoot;
  const scale = scaleById(prefs.scaleType);
  let highlight = null;
  if (s.focusChord) {
    const soundingName = s.capo ? transposeChord(s.focusChord, s.capo) : s.focusChord;
    highlight = chordToneLabels(soundingName);
  }
  const showScale = (inst) => prefs.showScales && inst.scale && pc !== null;

  const active = activeInstruments().filter((i) => i.kind !== 'harmonica');
  let html = '';
  if (pc !== null && prefs.showScales && active.some((i) => i.scale)) {
    html += scaleControlsHtml(s, pc, auto, scale, highlight);
  }
  for (const inst of active) {
    let body = '';
    if (prefs.showChords && inst.chords) body += `<div class="inst-chords">${chordDiagramsFor(inst, chords, soundOf)}</div>`;
    if (showScale(inst)) {
      const map = inst.kind === 'piano'
        ? pianoScaleSVG(pc, scale.iv, highlight)
        : scaleDiagramSVG(pc, scale.iv, highlight, inst.tuning);
      body += `<div class="inst-scale">${map}</div>`;
    }
    if (!body) continue;
    html += `<section class="inst-panel" data-inst="${inst.id}"><div class="inst-head">${escapeHtml(inst.label)}</div>${body}</section>`;
  }
  el.instPanels.innerHTML = html ||
    '<span class="palette-empty">No instrument charts to show — add instruments above, or enable Chords / Scales.</span>';
  wireInstruments(s);
}

// Chord diagrams row for one instrument.
function chordDiagramsFor(inst, chords, soundOf) {
  let out = '';
  if (inst.kind === 'guitar') {
    const store = prefs.voicings[inst.id] || (prefs.voicings[inst.id] = {});
    for (const c of chords) {
      const voicings = chordVoicings(c.shape);
      let idx = store[c.shape];
      if (idx === undefined) idx = inst.high ? defaultLeadIndex(voicings) : 0;
      if (idx >= voicings.length) idx = 0;
      let select = '';
      if (voicings.length > 1) {
        const opts = voicings.map((v, i) => `<option value="${i}"${i === idx ? ' selected' : ''}>${escapeHtml(v.label)}</option>`).join('');
        select = `<select class="cd-voicing" data-inst="${inst.id}" data-chord="${escapeHtml(c.shape)}">${opts}</select>`;
      }
      out += chordDiagramSVG(c.shape, voicings[idx].frets, soundOf(c), select);
    }
  } else if (inst.kind === 'piano') {
    const store = prefs.pianoInv.piano || (prefs.pianoInv.piano = {});
    for (const c of chords) {
      const ci = chordIntervals(c.shape);
      const n = ci ? ci.iv.length : 0;
      let inv = store[c.shape] || 0;
      if (inv >= n) inv = 0;
      let select = '';
      if (n > 1) {
        const opts = [];
        for (let k = 0; k < n; k++) opts.push(`<option value="${k}"${k === inv ? ' selected' : ''}>${PIANO_INV_NAMES[k] || (k + ' inv')}</option>`);
        select = `<select class="pk-inv" data-chord="${escapeHtml(c.shape)}">${opts.join('')}</select>`;
      }
      out += pianoChordSVG(c.shape, inv, soundOf(c), select);
    }
  } else { // generic fretted (ukulele, mandolin, …)
    for (const c of chords) out += inst.diagram(c.shape, inst.voicing(c.shape), soundOf(c), '');
  }
  return out;
}

function wireInstruments(s) {
  el.instPanels.querySelectorAll('.cd-voicing').forEach((sel) => sel.addEventListener('change', () => {
    (prefs.voicings[sel.dataset.inst] || (prefs.voicings[sel.dataset.inst] = {}))[sel.dataset.chord] = parseInt(sel.value, 10);
    savePrefs(); renderInstruments(currentSong());
  }));
  el.instPanels.querySelectorAll('.pk-inv').forEach((sel) => sel.addEventListener('change', () => {
    (prefs.pianoInv.piano || (prefs.pianoInv.piano = {}))[sel.dataset.chord] = parseInt(sel.value, 10);
    savePrefs(); renderInstruments(currentSong());
  }));
  el.instPanels.querySelectorAll('.cd-name').forEach((nm) => {
    const shape = nm.dataset.chord;
    if (s.focusChord === shape) nm.classList.add('focused');
    nm.title = 'Click to highlight this chord’s notes on the scale maps';
    nm.addEventListener('click', () => {
      const cur = currentSong();
      cur.focusChord = cur.focusChord === shape ? null : shape;
      cur.updated = Date.now();
      schedulePersist();
      renderPreview();
    });
  });
  const rootSel = document.getElementById('scale-root');
  if (rootSel) rootSel.addEventListener('change', (e) => {
    const cur = currentSong();
    cur.scaleRoot = e.target.value === 'auto' ? null : parseInt(e.target.value, 10);
    cur.updated = Date.now(); schedulePersist(); renderInstruments(cur);
  });
  const typeSel = document.getElementById('scale-type');
  if (typeSel) typeSel.addEventListener('change', (e) => { prefs.scaleType = e.target.value; savePrefs(); renderInstruments(currentSong()); });
  const focusSel = document.getElementById('scale-focus');
  if (focusSel) focusSel.addEventListener('change', (e) => {
    const cur = currentSong();
    cur.focusChord = e.target.value || null;
    cur.updated = Date.now(); schedulePersist(); renderPreview();
  });
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

const PIANO_INV_NAMES = ['root', '1st inv', '2nd inv', '3rd inv'];

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
// ---- Keyboard chord placement ----------------------------------------------
// Drop a [chord] without leaving the keyboard:
//  - Alt/Option + 1–9 inserts the Nth palette chord (the chords already in use).
//  - Typing "[" (or Cmd/Ctrl+K) opens a type-ahead popup at the caret over the
//    song's chords plus common ones; arrows/typing filter, Enter/Tab inserts.
const IS_MAC = /Mac|iP(hone|ad|od)/.test(navigator.platform);
const ALT_LABEL = IS_MAC ? '⌥' : 'Alt+';
let paletteChords = [];   // chords in the song, in palette order (Alt+N maps to these)
let chordPopup = null;    // { bracketStart, active, items, el } while the popup is open

const COMMON_CHORDS = ['G', 'C', 'D', 'A', 'E', 'F', 'Am', 'Em', 'Dm', 'Bm', 'Fm',
  'Gm', 'Cm', 'Bb', 'Eb', 'Ab', 'G7', 'C7', 'D7', 'A7', 'E7', 'B7', 'Dsus4',
  'Asus4', 'Cadd9', 'Am7', 'Em7', 'Dm7', 'Gmaj7', 'Cmaj7'];

// Song chords first (so Alt+N order matches), then common ones, de-duplicated.
function chordCandidates() {
  const seen = new Set(), out = [];
  for (const c of paletteChords.concat(COMMON_CHORDS)) {
    if (!seen.has(c)) { seen.add(c); out.push(c); }
  }
  return out;
}

// Caret pixel position inside the textarea (mirror-div technique), as viewport
// coords for placing the popup just below the caret's line.
function caretCoords(ta, pos) {
  const div = document.createElement('div');
  const cs = getComputedStyle(ta);
  const props = ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom',
    'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth',
    'borderLeftWidth', 'fontFamily', 'fontSize', 'fontWeight', 'fontStyle',
    'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing', 'tabSize'];
  for (const p of props) div.style[p] = cs[p];
  Object.assign(div.style, { position: 'absolute', visibility: 'hidden',
    whiteSpace: 'pre-wrap', wordWrap: 'break-word', overflow: 'hidden', height: 'auto' });
  div.textContent = ta.value.slice(0, pos);
  const span = document.createElement('span');
  span.textContent = ta.value.slice(pos) || '.';
  div.appendChild(span);
  document.body.appendChild(div);
  const rect = ta.getBoundingClientRect();
  const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
  const top = rect.top + span.offsetTop - ta.scrollTop + lh;
  const left = rect.left + span.offsetLeft - ta.scrollLeft;
  document.body.removeChild(div);
  return { top, left };
}

// Open the popup: insert an empty [] with the caret between, then show matches.
function triggerChordPopup() {
  if (!currentSong()) return;
  const ta = el.editor;
  const pos = ta.selectionStart;
  ta.value = ta.value.slice(0, pos) + '[]' + ta.value.slice(ta.selectionEnd);
  ta.selectionStart = ta.selectionEnd = pos + 1;
  ta.focus();
  ta.dispatchEvent(new Event('input'));
  chordPopup = { bracketStart: pos, active: 0, items: [], el: null };
  renderChordPopup();
}

// Re-filter and reposition. Closes itself if the caret has left the [ … ] it opened.
function renderChordPopup() {
  const cp = chordPopup;
  if (!cp) return;
  const ta = el.editor;
  const caret = ta.selectionStart;
  const close = ta.value.indexOf(']', cp.bracketStart);
  if (ta.value[cp.bracketStart] !== '[' || caret <= cp.bracketStart || close === -1 || caret > close) {
    closeChordPopup(); return;
  }
  const query = ta.value.slice(cp.bracketStart + 1, caret);
  if (/[\s[\]]/.test(query)) { closeChordPopup(); return; }
  const q = query.toLowerCase();
  let items = chordCandidates().filter((c) => c.toLowerCase().startsWith(q));
  if (query && isChord(query) && !items.some((c) => c.toLowerCase() === q)) items.unshift(query);
  cp.items = items.slice(0, 8);
  if (cp.active >= cp.items.length) cp.active = Math.max(0, cp.items.length - 1);
  if (!cp.items.length) { if (cp.el) cp.el.hidden = true; return; }
  if (!cp.el) { cp.el = document.createElement('div'); cp.el.className = 'chord-pop'; document.body.appendChild(cp.el); }
  cp.el.innerHTML = cp.items.map((c, i) =>
    `<div class="chord-pop-item${i === cp.active ? ' active' : ''}" data-i="${i}">${escapeHtml(c)}</div>`).join('');
  cp.el.querySelectorAll('.chord-pop-item').forEach((it) =>
    it.addEventListener('mousedown', (e) => { e.preventDefault(); cp.active = +it.dataset.i; acceptActiveChord(); }));
  const { top, left } = caretCoords(ta, caret);
  cp.el.style.top = top + 'px';
  cp.el.style.left = left + 'px';
  cp.el.hidden = false;
}

function moveChordActive(d) {
  const cp = chordPopup;
  if (!cp || !cp.items.length) return;
  cp.active = (cp.active + d + cp.items.length) % cp.items.length;
  renderChordPopup();
}

// Insert the highlighted chord (or whatever's typed if none), caret after the ].
function acceptActiveChord() {
  const cp = chordPopup;
  if (!cp) return;
  const ta = el.editor;
  const close = ta.value.indexOf(']', cp.bracketStart);
  if (close === -1) { closeChordPopup(); return; }
  const chosen = cp.items[cp.active] != null ? cp.items[cp.active] : ta.value.slice(cp.bracketStart + 1, close);
  const before = ta.value.slice(0, cp.bracketStart);
  const tok = '[' + chosen + ']';
  ta.value = before + tok + ta.value.slice(close + 1);
  ta.selectionStart = ta.selectionEnd = before.length + tok.length;
  closeChordPopup();
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}

// Escape: bail out. If nothing was typed, remove the auto-inserted [].
function cancelChordPopup() {
  const cp = chordPopup;
  if (!cp) return;
  const ta = el.editor;
  const close = ta.value.indexOf(']', cp.bracketStart);
  const empty = close > -1 && ta.value[cp.bracketStart] === '[' && !ta.value.slice(cp.bracketStart + 1, close);
  if (empty) {
    ta.value = ta.value.slice(0, cp.bracketStart) + ta.value.slice(close + 1);
    ta.selectionStart = ta.selectionEnd = cp.bracketStart;
    ta.dispatchEvent(new Event('input'));
  }
  closeChordPopup();
  ta.focus();
}

function closeChordPopup() {
  if (chordPopup && chordPopup.el) chordPopup.el.remove();
  chordPopup = null;
}

function renderPalette() {
  const re = /\[([^\]]*)\]/g;
  const seen = new Set();
  const list = [];
  let m;
  while ((m = re.exec(el.editor.value)) !== null) {
    if (isChord(m[1]) && !seen.has(m[1])) { seen.add(m[1]); list.push(m[1]); }
  }
  paletteChords = list; // Alt+1..9 map onto these, in order
  const emptyBtn = '<button class="chip chip-empty" id="empty-chord-btn" title="Insert empty [ ] — or just type [ to search chords">[ ]</button>';
  el.palette.innerHTML = emptyBtn + list.map((c, i) => {
    const key = i < 9 ? `<span class="chip-key">${i + 1}</span>` : '';
    const hint = i < 9 ? `  (${ALT_LABEL}${i + 1})` : '';
    return `<button class="chip" data-chord="${escapeHtml(c)}" title="Insert [${escapeHtml(c)}]${hint}">${key}${escapeHtml(c)}</button>`;
  }).join('') +
    `<span class="palette-hint" title="Alt/Option + a number drops that chord; typing [ opens a chord search">${ALT_LABEL}1–9 · type [ to search</span>`;
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

function songItem(s, deletable, depth) {
  const li = document.createElement('li');
  li.className = 'song-item' + (deletable ? '' : ' in-lib') + (s.id === currentId ? ' active' : '') + (s.draft ? ' draft' : '');
  if (depth) li.style.paddingLeft = (10 + depth * 14) + 'px';
  // In a folder tree the subfolders convey location, so the leaf shows just its
  // own filename (not the whole path). Hover reveals the path within the open
  // folder — the browser doesn't expose the absolute on-disk path.
  const sub = s.draft ? 'not saved yet'
    : (mode === 'folder' ? ((s.path || '').split('/').pop() || '') : (s.artist || ''));
  if (mode === 'folder' && !s.draft) {
    const lib = libraries.find((l) => l.id === s.libId);
    li.title = (lib ? lib.name + '/' : '') + (s.path || '');
  }
  li.innerHTML =
    `<span class="st"><b>${escapeHtml(s.title || 'Untitled')}</b>` +
    `<small>${escapeHtml(sub)}</small></span>` +
    (deletable ? `<button class="del" title="Delete">&times;</button>` : '');
  li.querySelector('.st').addEventListener('click', () => selectSong(s.id));
  const delBtn = li.querySelector('.del');
  if (delBtn) delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteSong(s.id); });
  return li;
}

function toggleCollapse(key) {
  if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key);
  renderList();
}

// Nested tree of a library's songs, keyed by subfolder segment. Empty
// subfolders (from lib.subdirs) are included so you can target them.
function buildLibTree(lib) {
  const root = { folders: new Map(), songs: [] };
  const descend = (segs) => {
    let node = root;
    for (const seg of segs.filter(Boolean)) {
      if (!node.folders.has(seg)) node.folders.set(seg, { folders: new Map(), songs: [] });
      node = node.folders.get(seg);
    }
    return node;
  };
  for (const s of songs.filter((x) => x.libId === lib.id)) {
    const segs = (s.path || '').split('/');
    segs.pop(); // drop filename
    descend(segs).songs.push(s);
  }
  for (const sub of (lib.subdirs || [])) descend(sub.split('/'));
  return root;
}

function countUnder(node) {
  let n = node.songs.length;
  for (const child of node.folders.values()) n += countUnder(child);
  return n;
}

// Render one folder's contents (subfolders then songs), recursing into subs.
function renderTreeNode(lib, node, subpath, depth) {
  for (const name of [...node.folders.keys()].sort((a, b) => a.localeCompare(b))) {
    const child = node.folders.get(name);
    const childPath = subpath ? subpath + '/' + name : name;
    const key = lib.id + '\0' + childPath;
    const isCollapsed = collapsed.has(key);
    const isTarget = activeLibId === lib.id && activeSubpath === childPath;
    const row = document.createElement('li');
    row.className = 'subfolder-row' + (isTarget ? ' active-lib' : '');
    row.style.setProperty('--lib-color', lib.color);
    row.style.paddingLeft = (6 + depth * 14) + 'px';
    row.title = lib.name + '/' + childPath; // path within the open folder
    row.innerHTML =
      `<span class="lib-caret" title="${isCollapsed ? 'Expand' : 'Collapse'}">${isCollapsed ? '▸' : '▾'}</span>` +
      `<span class="sf-name" title="Make this the target for + New / Import">${escapeHtml(name)}</span>` +
      `<span class="lib-count">${countUnder(child)}</span>` +
      `<button class="lib-btn sf-locate" title="Show this subfolder's location on disk (opens a system dialog)">◎</button>` +
      `<button class="lib-btn sf-add" title="New subfolder inside">+</button>`;
    row.querySelector('.lib-caret').addEventListener('click', (e) => { e.stopPropagation(); toggleCollapse(key); });
    row.querySelector('.sf-name').addEventListener('click', () => setActiveTarget(lib.id, childPath));
    row.querySelector('.sf-locate').addEventListener('click', (e) => { e.stopPropagation(); revealFolder(lib, childPath); });
    row.querySelector('.sf-add').addEventListener('click', (e) => { e.stopPropagation(); createSubfolder(lib, childPath); });
    el.list.appendChild(row);
    if (!isCollapsed) renderTreeNode(lib, child, childPath, depth + 1);
  }
  for (const s of node.songs.sort((a, b) => (a.path || '').localeCompare(b.path || '')))
    el.list.appendChild(songItem(s, false, depth));
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

  // Folder mode: one collapsible tree per library. The header is the library
  // root; subfolders nest below. Files can't be deleted from the tool, so folder
  // songs carry no delete button.
  for (const lib of libraries) {
    const total = songs.filter((s) => s.libId === lib.id).length;
    const isCollapsed = collapsed.has(lib.id);
    const isTarget = lib.id === activeLibId && !activeSubpath;
    const header = document.createElement('li');
    header.className = 'lib-header' + (isCollapsed ? ' collapsed' : '') + (isTarget ? ' active-lib' : '') +
      (lib.kind === 'collection' ? ' lib-collection' : '');
    header.style.setProperty('--lib-color', lib.color);
    const kindTitle = lib.kind === 'collection' ? 'Your managed Collection' : 'External folder';
    header.innerHTML =
      `<span class="lib-caret" title="${isCollapsed ? 'Expand' : 'Collapse'}">${isCollapsed ? '▸' : '▾'}</span>` +
      `<span class="lib-dot" title="${kindTitle}"></span>` +
      `<span class="lib-name" title="Make this the target for + New / Import">${escapeHtml(lib.name)}</span>` +
      `<span class="lib-count">${total}</span>` +
      `<button class="lib-btn lib-locate" title="Show this folder's location on disk (opens a system dialog)">◎</button>` +
      `<button class="lib-btn sf-add" title="New subfolder">+</button>` +
      `<button class="lib-btn lib-reload" title="Reload this folder from disk">↻</button>` +
      `<button class="lib-btn lib-close" title="Close this folder">×</button>`;
    header.querySelector('.lib-caret').addEventListener('click', () => toggleCollapse(lib.id));
    header.querySelector('.lib-name').addEventListener('click', () => setActiveTarget(lib.id, ''));
    header.querySelector('.lib-locate').addEventListener('click', (e) => { e.stopPropagation(); revealFolder(lib, ''); });
    header.querySelector('.sf-add').addEventListener('click', (e) => { e.stopPropagation(); createSubfolder(lib, ''); });
    header.querySelector('.lib-reload').addEventListener('click', (e) => {
      e.stopPropagation(); reloadLibrary(lib.id);
    });
    header.querySelector('.lib-close').addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Close "${lib.name}"? The files stay on disk; the folder is just removed from the sidebar.`)) closeLibrary(lib.id);
    });
    el.list.appendChild(header);
    if (!isCollapsed) renderTreeNode(lib, buildLibTree(lib), '', 1);
  }
}

// Create a subfolder on disk inside a library (or a nested folder) and target it.
async function createSubfolder(lib, parentSubpath) {
  const inside = parentSubpath ? ` inside "${parentSubpath}"` : ` in "${lib.name}"`;
  const name = prompt(`New subfolder name${inside}:`, '');
  if (name === null) return;
  const clean = name.trim().replace(/[\\/]+/g, '-');
  if (!clean) return;
  try {
    const parent = await resolveDir(lib, parentSubpath, true);
    await parent.getDirectoryHandle(clean, { create: true });
  } catch { alert('Could not create the subfolder.'); return; }
  if (!lib.subdirs) lib.subdirs = new Set();
  lib.subdirs.add(parentSubpath ? parentSubpath + '/' + clean : clean);
  setActiveTarget(lib.id, parentSubpath ? parentSubpath + '/' + clean : clean);
}

// Reveal a folder's on-disk location. The browser can't open Finder or hand us
// the absolute path, but re-opening the system directory picker AT the folder
// shows where it lives (its full path is visible in the native dialog). The
// picker's result is ignored and cancelling is a no-op, so nothing changes.
async function revealFolder(lib, subpath) {
  if (!window.showDirectoryPicker) { alert('Showing a folder location needs Chrome or Edge.'); return; }
  let startIn = lib.handle;
  try { if (subpath) startIn = await resolveDir(lib, subpath, false); }
  catch { /* subfolder gone from disk — fall back to the library root */ }
  try { await window.showDirectoryPicker({ startIn }); }
  catch { /* user dismissed the dialog — nothing to do */ }
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
    const where = lib.name + (activeSubpath ? ' / ' + activeSubpath : '');
    const name = prompt(
      `File name for the new chart in "${where}".\n\n` +
      `This names the .cho file only — you set the song's title and artist inside ` +
      `the editor, and they can be different from the file name.`,
      'new-song.cho');
    if (!name) return;
    const fname = name.endsWith('.cho') ? name : name + '.cho';
    let handle;
    try {
      const dir = await resolveDir(lib, activeSubpath, true);
      handle = await dir.getFileHandle(fname, { create: true });
    } catch { alert('Could not create the file.'); return; }
    const s = blankSong();
    s.path = joinPath(activeSubpath, fname);
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

// Filenames (lowercased basenames) already living directly in a library's
// subfolder — for de-duplicating a new file's name within that folder.
function usedNamesIn(lib, subpath) {
  const prefix = subpath ? subpath + '/' : '';
  const set = new Set();
  for (const x of songs) {
    if (x.libId !== lib.id) continue;
    const p = x.path || '';
    if (!p.startsWith(prefix)) continue;
    const rest = p.slice(prefix.length);
    if (rest.indexOf('/') === -1) set.add(rest.toLowerCase());
  }
  return set;
}

async function importText(text, fallbackTitle) {
  const s = parseCho(text, fallbackTitle);
  if (mode === 'folder') {
    const lib = activeLib();
    if (!lib) { alert('Open a folder first.'); return; }
    const fname = slugFilename(s.title || fallbackTitle, usedNamesIn(lib, activeSubpath));
    let handle;
    try {
      const dir = await resolveDir(lib, activeSubpath, true);
      handle = await dir.getFileHandle(fname, { create: true });
    } catch { alert('Could not create the file.'); return; }
    s.path = joinPath(activeSubpath, fname);
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

// Open converted/imported text as an unsaved DRAFT: nothing is written to disk
// until the user reviews it and hits Save. In folder mode the draft is tagged
// with the active folder (so it shows in the sidebar and Save knows where to
// write it) but gets no file handle, so autosave's writeSong stays a no-op.
function importDraft(text, fallbackTitle) {
  const s = parseCho(text, fallbackTitle);
  if (mode !== 'folder') {
    // Local mode has no "disk" — localStorage IS the store, so it's saved now.
    songs.push(s);
    saveSongs(songs);
    selectSong(s.id);
    return;
  }
  s.draft = true;
  const lib = activeLib();
  s.libId = lib ? lib.id : null;
  s.subpath = activeSubpath;   // remember where Save should write it
  songs.push(s);
  selectSong(s.id);
  renderList();
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
  if (chordPopup) renderChordPopup(); // re-filter as you type inside [ … ]
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
el.toggleChords.addEventListener('change', () => {
  prefs.showChords = el.toggleChords.checked;
  savePrefs();
  renderPreview();
});
el.toggleScales.addEventListener('change', () => {
  prefs.showScales = el.toggleScales.checked;
  savePrefs();
  renderPreview();
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
document.getElementById('collection-btn').addEventListener('click', setupCollection);
document.getElementById('save-btn').addEventListener('click', saveCurrentNow);

async function saveCurrentNow() {
  const s = currentSong();
  if (!s) return;
  if (mode === 'folder') {
    // A PDF/import draft has no file yet — create one in the active folder on
    // first Save (the moment anything actually touches disk).
    if (s.draft && !fileHandles[s.id]) {
      const ok = await materializeDraft(s);
      if (!ok) return;
    }
    try { await writeSong(s); s.draft = false; el.status.textContent = 'Saved · ' + (s.path || 'file'); renderList(); renderBreadcrumb('Saved ✓'); }
    catch { el.status.textContent = 'Save failed'; renderBreadcrumb('Save failed'); }
  } else {
    s.draft = false;
    saveSongs(songs);
    el.status.textContent = 'Saved';
    renderBreadcrumb('Saved ✓');
  }
}

// Give a folder-mode draft a real file handle + name in its target library,
// so Save can write it. Returns false if there's no folder to write into.
async function materializeDraft(s) {
  commit(); // fold the latest title/body edits into s before choosing a filename
  const lib = libraries.find((l) => l.id === s.libId) || activeLib();
  if (!lib) { alert('Open a folder first, then Save.'); return false; }
  const subpath = s.subpath || '';
  const fname = slugFilename(s.title || 'untitled', usedNamesIn(lib, subpath));
  let handle;
  try {
    const dir = await resolveDir(lib, subpath, true);
    handle = await dir.getFileHandle(fname, { create: true });
  } catch { alert('Could not create the file in this folder.'); return false; }
  s.path = joinPath(subpath, fname);
  s.libId = lib.id;
  delete s.subpath;
  fileHandles[s.id] = handle;
  return true;
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
    const dot = active ? `<span class="fb-dot" style="background:${active.color}"></span>` : '';
    const target = active ? active.name + (activeSubpath ? ' / ' + activeSubpath : '') : '—';
    bar.innerHTML = `<span class="fb-name" title="+ New, Import and PDF drops create files here — click a folder to change">` +
      `${dot}+ New → ${escapeHtml(target)}</span>`;
  } else {
    bar.hidden = true;
    bar.innerHTML = '';
  }
  renderList();
  renderBreadcrumb();
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
  importInput.value = '';
  if (isPdf(file)) { convertPdfFile(file); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const name = file.name.replace(/\.[^.]+$/, '');
    importText(String(reader.result), name);
  };
  reader.readAsText(file);
});

function isPdf(file) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

// ---- PDF -> .cho conversion ------------------------------------------------
// OCR (or the text layer, when present) turns a chart PDF into an editable
// draft. The heavy libraries load from a CDN on first use only; the parser
// lives in pdf2cho.js and is a verified port of tools/pdf2cho.py.

const pdfOverlay = document.getElementById('pdf-overlay');
const pdfMsg = document.getElementById('pdf-msg');
const pdfSub = document.getElementById('pdf-sub');
const pdfSpinner = document.getElementById('pdf-spinner');

function showPdfOverlay(state, msg, sub) {
  pdfOverlay.hidden = false;
  pdfOverlay.classList.toggle('dragging', state === 'drag');
  pdfOverlay.classList.toggle('busy', state === 'busy');
  pdfSpinner.hidden = state !== 'busy';
  if (msg !== undefined) pdfMsg.textContent = msg;
  if (sub !== undefined) pdfSub.textContent = sub;
}

function hidePdfOverlay() {
  pdfOverlay.hidden = true;
  pdfOverlay.classList.remove('dragging', 'busy');
}

let converting = false;
let lastProgress = '';

// Rendering a PDF page stalls while the tab is in the background (the browser
// throttles canvas work), so conversion pauses if the user switches away. Nudge
// them to keep it visible; restore the real progress line when they return.
document.addEventListener('visibilitychange', () => {
  if (!converting) return;
  pdfSub.textContent = document.hidden
    ? 'Paused — keep this tab visible to finish converting'
    : lastProgress;
});

async function convertPdfFile(file) {
  if (converting) return;
  if (!window.PdfToCho) { alert('PDF conversion is unavailable (pdf2cho.js failed to load).'); return; }
  converting = true;
  lastProgress = 'Starting…';
  showPdfOverlay('busy', 'Converting ' + file.name, lastProgress);
  try {
    const { cho, usedOcr } = await window.PdfToCho.pdfToCho(file, (m) => {
      lastProgress = m;
      if (!document.hidden) pdfSub.textContent = m;
    });
    const name = file.name.replace(/\.[^.]+$/, '');
    hidePdfOverlay();
    importDraft(cho, name);
    const how = usedOcr ? 'Converted by OCR' : 'Converted from PDF text';
    el.status.textContent = mode === 'folder'
      ? how + ' — review, then Save to the folder'
      : how + ' — review the chords';
  } catch (err) {
    hidePdfOverlay();
    console.error(err);
    alert('Could not convert this PDF.\n\n' + (err && err.message ? err.message : err) +
      '\n\nTip: only chords-over-lyrics charts convert — pure tablature can’t.');
  } finally {
    converting = false;
  }
}

// Drag a PDF anywhere over the window to convert it. dragenter/leave can fire
// per element, so count depth and only hide the hint when the drag truly leaves.
let dragDepth = 0;
function dragHasFiles(e) {
  return !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));
}
window.addEventListener('dragenter', (e) => {
  if (converting || !dragHasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  showPdfOverlay('drag', 'Drop a PDF chart to convert it',
    'Chords-over-lyrics PDFs become an editable draft');
});
window.addEventListener('dragover', (e) => {
  if (dragHasFiles(e) && !converting) e.preventDefault();
});
window.addEventListener('dragleave', (e) => {
  if (converting || !dragHasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) hidePdfOverlay();
});
window.addEventListener('drop', (e) => {
  if (!dragHasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  if (converting) return;
  const file = Array.from(e.dataTransfer.files).find(isPdf);
  if (!file) { hidePdfOverlay(); return; }
  convertPdfFile(file);
});

// Keyboard chord placement + Tab-inserts-spaces.
el.editor.addEventListener('keydown', (e) => {
  // While the chord popup is open, it owns the arrow / enter / tab / escape keys.
  if (chordPopup) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveChordActive(1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); moveChordActive(-1); return; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acceptActiveChord(); return; }
    if (e.key === 'Escape') { e.preventDefault(); cancelChordPopup(); return; }
    // other keys fall through; keyup/input re-filter the list
  }
  // Alt/Option + 1–9 : drop the Nth palette chord at the caret. Use e.code so the
  // digit is layout-independent (Alt often remaps the character on Mac).
  if (e.altKey && !e.metaKey && !e.ctrlKey && /^Digit[1-9]$/.test(e.code)) {
    const n = +e.code.slice(5) - 1;
    if (paletteChords[n]) {
      e.preventDefault();
      if (chordPopup) closeChordPopup();
      insertAtCursor('[' + paletteChords[n] + ']');
    }
    return;
  }
  // Cmd/Ctrl+K : open the chord search popup at the caret.
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
    e.preventDefault(); triggerChordPopup(); return;
  }
  // "[" always starts a chord, so open the search popup instead of a bare bracket.
  if (e.key === '[' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault(); triggerChordPopup(); return;
  }
  // Tab : two spaces (only reached when the popup is closed).
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = el.editor.selectionStart, end = el.editor.selectionEnd;
    el.editor.value = el.editor.value.slice(0, start) + '  ' + el.editor.value.slice(end);
    el.editor.selectionStart = el.editor.selectionEnd = start + 2;
    el.editor.dispatchEvent(new Event('input'));
  }
});

// Keep the popup in sync as the caret moves (arrows, clicks) or focus leaves.
el.editor.addEventListener('keyup', () => { if (chordPopup) renderChordPopup(); });
el.editor.addEventListener('click', () => { if (chordPopup) renderChordPopup(); });
el.editor.addEventListener('blur', () => { if (chordPopup) setTimeout(closeChordPopup, 120); });

// ---- Performance mode ------------------------------------------------------
// A full-screen overlay that lays the current song's chords-over-lyrics out in
// N newspaper columns (whole song visible when it fits), with horizontal paging
// for longer songs, toggleable diagram/scale/harmonica panels, and page-turner
// (arrow / PageUp-Down / Space) navigation that flows into the next song.

const PERF_PANELS = { instruments: 'instrument-panels', harp: 'harmonica-panel' };
const PERF_LABELS = { instruments: 'Instruments', harp: 'Harmonica' };
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
  renderInstruments(s);
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
  el.toggleChords.checked = prefs.showChords;
  el.toggleScales.checked = prefs.showScales;
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
  el.instBar.innerHTML = '';
  el.instPanels.innerHTML = '';
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
  const missing = [];
  for (const entry of entries) {
    if (libraries.some((l) => l.id === entry.id)) continue;
    // Legacy saved folders predate kind/colour — treat them as external and
    // give them a palette colour.
    const kind = entry.kind || 'external';
    const lib = {
      id: entry.id || newLibId(),
      name: entry.name,
      handle: entry.handle,
      kind,
      color: entry.color || (kind === 'collection' ? COLLECTION_COLOR : nextExternalColor()),
    };
    let loaded;
    // The folder may have been moved or deleted since last session — scanning it
    // then throws NotFoundError. Skip it rather than wedging the whole app.
    try { loaded = await loadLibrarySongs(lib); }
    catch { missing.push(entry); continue; }
    if (mode === 'local') { mode = 'folder'; songs = []; currentId = null; } // only once a real folder loads
    libraries.push(lib);
    songs.push(...loaded);
  }

  // Drop vanished folders from the saved list so they stop erroring next boot.
  // Non-blocking (no alert on startup): logged, and shown briefly in the status.
  if (missing.length) {
    const goneIds = new Set(missing.map((m) => m.id));
    const saved = (await idbGet('libraries')) || [];
    await idbSet('libraries', saved.filter((e) => !goneIds.has(e.id)));
    const names = missing.map((e) => e.name).join(', ');
    console.warn('Saved folder(s) not found on disk (moved or deleted), removed:', names);
    if (el.status) el.status.textContent = `Folder not found, removed: ${names}`;
  }

  if (libraries.length) await persistLibraries();
  if (mode === 'folder' && !libraries.length && !document.querySelector('#reopen-btn:not([hidden])')) {
    returnToLocal(); // nothing reconnected and nothing awaiting a permission grant
    return;
  }
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
