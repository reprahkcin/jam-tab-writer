/* Jam Tab Writer — chords-over-lyrics editor.
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

function renderLine(raw, semitones, numKey) {
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
    let text = isChord(m[1]) ? transposeChord(m[1], semitones) : m[1];
    if (numKey !== null && numKey !== undefined && isChord(m[1])) text = chordToNumber(text, numKey);
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

function render(body, semitones, numKey) {
  if (!body.trim()) {
    return '<div class="empty-hint">Nothing yet — start typing in the editor. ' +
      'Chords go in brackets, e.g. <code>[Am]</code>.</div>';
  }
  return body.split('\n').map((l) => renderLine(l, semitones, numKey)).join('');
}

// ---- Wrapping chord/lyric rendering (phone performance view) ---------------
// The chart lays chords on their own space-aligned line, which cannot wrap
// without drifting off the syllable underneath. For a phone we instead attach
// each chord to the word it lands on and let the words reflow, so a long line
// wraps down the screen instead of running off the edge.
function renderLineWrapped(raw, semitones, numKey) {
  const trimmed = raw.trim();
  if (trimmed === '') return '<div class="blank"></div>';
  if (/^\{(page|pagebreak|newpage|page break)\}$/i.test(trimmed)) return '';

  let sectionMatch = trimmed.match(/^\{(.+)\}$/);
  const loneBracket = trimmed.match(/^\[([^\[\]]+)\]$/);
  if (!sectionMatch && loneBracket && !isChord(loneBracket[1])) sectionMatch = loneBracket;
  if (sectionMatch) return `<div class="section">${escapeHtml(sectionMatch[1])}</div>`;

  // Same parse as renderLine: pull out [chords] and note where each lands.
  const chords = [];
  let lyric = '';
  const re = /\[([^\]]*)\]/g;
  let last = 0, m;
  while ((m = re.exec(raw)) !== null) {
    lyric += raw.slice(last, m.index);
    let text = isChord(m[1]) ? transposeChord(m[1], semitones) : m[1];
    if (numKey !== null && numKey !== undefined && isChord(m[1])) text = chordToNumber(text, numKey);
    chords.push({ pos: lyric.length, text });
    last = m.index + m[0].length;
  }
  lyric += raw.slice(last);

  if (!chords.length) return `<div class="wline">${escapeHtml(lyric) || '&nbsp;'}</div>`;

  // One segment per word (leading space kept with its word) so the line can
  // break between words while each chord stays glued above its syllable.
  const toks = lyric.match(/\s*\S+|\s+/g) || [];
  const segs = [];
  let i = 0;
  for (const t of toks) {
    const start = i, end = i + t.length;
    const hit = chords.filter((c) => c.pos >= start && c.pos < end).map((c) => c.text);
    segs.push({ chord: hit.join(' '), text: t });
    i = end;
  }
  const tail = chords.filter((c) => c.pos >= lyric.length).map((c) => c.text);
  if (tail.length) segs.push({ chord: tail.join(' '), text: '' });

  return '<div class="wline">' + segs.map((s) =>
    `<span class="wseg"><span class="wc">${escapeHtml(s.chord)}</span>` +
    `<span class="wt">${escapeHtml(s.text)}</span></span>`).join('') + '</div>';
}

function renderWrapped(body, semitones, numKey) {
  if (!body.trim()) return '<div class="empty-hint">Nothing yet.</div>';
  return body.split('\n').map((l) => renderLineWrapped(l, semitones, numKey)).join('');
}

// Nashville Number System: show chords as scale degrees relative to the tonic,
// so the band can follow in any key. Transposition-invariant by construction.
const NASH_DEG = ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'];
function chordToNumber(name, tonicPc) {
  const m = name.match(CHORD_RE);
  if (!m) return name;
  const deg = (pc) => NASH_DEG[(((pc - tonicPc) % 12) + 12) % 12];
  let out = deg(chordRootPc(m[1], m[2])) + (m[3] || '');
  if (m[4]) out += '/' + deg(chordRootPc(m[4], m[5] || ''));
  return out;
}
// The tonic pitch class in the same shift reference as the displayed chords, or
// null when numbering is off / no chord to anchor on.
function numberKeyFor(s) {
  if (!prefs.nashville) return null;
  const raw = firstChordPc(s.body);
  if (raw === null) return null;
  return (((raw + inlineShift(s)) % 12) + 12) % 12;
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
  tempoInput: document.getElementById('tempo-input'),
  status: document.getElementById('save-status'),
  breadcrumb: document.getElementById('save-breadcrumb'),
  capoBanner: document.getElementById('capo-banner'),
  tuningBanner: document.getElementById('tuning-banner'),
  songTuning: document.getElementById('song-tuning'),
  instBar: document.getElementById('instrument-bar'),
  instPanels: document.getElementById('instrument-panels'),
  roadmap: document.getElementById('roadmap'),
  riffPanels: document.getElementById('riff-panels'),
  riffEditors: document.getElementById('riff-editors'),
  harmonica: document.getElementById('harmonica-panel'),
  toggleChords: document.getElementById('toggle-chords'),
  toggleScales: document.getElementById('toggle-scales'),
  toggleNumbers: document.getElementById('toggle-numbers'),
};

let songs = loadSongs();
let currentId = null;

// Default jam: two guitars, uke, piano, harmonica on; mandolin + bass off.
const ENSEMBLE_DEFAULTS = { guitar1: true, guitar2: true, ukulele: true, mandolin: false, piano: true, bass: false, harmonica: true };

function loadPrefs() {
  const defaults = {
    showChords: true, showScales: true, harmonica: true, chordMode: 'shapes', nashville: false,
    scaleType: 'majPent',
    voicings: { guitar1: {}, guitar2: {} }, pianoInv: { piano: {} },
    ensemble: Object.assign({}, ENSEMBLE_DEFAULTS),
    perform: { cols: 4, font: 22, autoSecs: 25, scrollSpeed: 30, autoFit: true, panels: { instruments: true, harp: true } },
    layout: 'split',   // 'split' | 'editor' | 'preview' (desktop only)
    printCols: 1,
    capture: { deviceId: null, deviceLabel: '', format: 'wav' },
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
  p.perform = Object.assign({ cols: 4, font: 22, autoSecs: 25, autoFit: true, panels: {} }, p.perform);
  p.perform.panels = Object.assign({ instruments: true, harp: true }, p.perform.panels);
  p.metro = Object.assign({ bpm: 100, steps: 16, click: true, pattern: null }, p.metro);
  p.capture = Object.assign({ deviceId: null, deviceLabel: '', format: 'wav' }, p.capture);
  return p;
}
let prefs = loadPrefs();

function currentSong() {
  return songs.find((s) => s.id === currentId) || null;
}

function blankSong() {
  return { id: newId(), title: '', artist: '', body: '', transpose: 0, capo: 0, key: null, scaleRoot: null, focusChord: null, riffs: [], tempo: null, tuning: null, updated: Date.now() };
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
  el.tempoInput.value = s.tempo || '';
  el.songTuning.value = s.tuning || 'standard';
  renderPreview();
  renderPalette();
  renderList();
  renderBreadcrumb();
  renderRiffEditor(s);
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

// The chart is space-aligned and cannot wrap without the chords drifting off
// their syllables, so on a phone screen the preview uses the wrapping renderer
// instead. Printing always wants the aligned chart (see the print swap below).
let forceAlignedChart = false;
function chartHtml(body, semitones, numKey) {
  return (!forceAlignedChart && window.matchMedia('(max-width: 760px)').matches)
    ? renderWrapped(body, semitones, numKey)
    : render(body, semitones, numKey);
}

function renderPreview() {
  const s = currentSong();
  if (!s) return;
  el.previewBody.innerHTML = chartHtml(s.body, inlineShift(s), numberKeyFor(s));
  updatePrintHeader(s);
  renderTuningBanner(s);
  renderCapoBanner(s);
  renderInstrumentBar();
  renderInstruments(s);
  renderRoadmap(s);
  renderRiffs(s);
  if (prefs.ensemble.harmonica) renderHarmonica(s);
  else el.harmonica.innerHTML = '';
  // In performance mode the panels are relocated into the overlay and shown
  // independently of the app's own toggles, so keep them all populated.
  if (typeof perf !== 'undefined' && perf.open) perfRenderPanels(s);
  updateFrontMatter();
}

// Is there anything above the chart worth giving page 1 to? Reference panels
// fill a page; the title and capo banner alone don't, and reading them stranded
// on their own sheet is worse than having them head the chart. Set on every
// render rather than at print time, so it's already right however you print.
function updateFrontMatter() {
  const panels = el.instPanels.querySelector('.inst-panel, .sp-head') !== null;
  const harp = (el.harmonica.innerHTML || '').trim() !== '';
  el.preview.classList.toggle('has-front-matter', panels || harp);
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
  // Paper drops the pickers (the title already names the root and the scale)
  // but keeps the focus chord as text: the highlighted tones on the diagram
  // mean nothing unless you know which chord they belong to.
  const focusPrint = s.focusChord
    ? `<span class="sp-focus-print">Chord ${escapeHtml(s.focusChord)}</span>` : '';
  return `<div class="sp-head"><span class="sp-title">${HARP_NAMES[pc]} ${escapeHtml(scale.name)}</span>` +
    `<span class="muted sp-ctl">Root</span><select id="scale-root">${rootOpts}</select>` +
    `<select id="scale-type">${scaleOpts}</select>` +
    `<span class="muted sp-ctl">Chord</span><select id="scale-focus">${focusOpts}</select>` +
    focusPrint +
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

// Fill the meta-row tuning dropdown from the tuner presets (once).
function initTuningSelect() {
  el.songTuning.innerHTML = Object.entries(TUNER_PRESETS)
    .map(([id, t]) => `<option value="${id}">${escapeHtml(id === 'standard' ? 'Standard' : t.name)}</option>`).join('');
}
function renderTuningBanner(s) {
  const id = s.tuning;
  if (!id || id === 'standard' || !TUNER_PRESETS[id]) { el.tuningBanner.innerHTML = ''; return; }
  el.tuningBanner.innerHTML = `<b>Tune to ${escapeHtml(TUNER_PRESETS[id].name)}</b> for this song`;
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

// The song's section labels, in order — mirrors renderLine's section detection
// so the roadmap chips line up 1:1 with the .section divs in the preview.
function songSections(body) {
  const out = [];
  for (const raw of body.split('\n')) {
    const t = raw.trim();
    if (!t || /^\{(page|pagebreak|newpage|page break)\}$/i.test(t)) continue;
    let m = t.match(/^\{(.+)\}$/);
    const lone = t.match(/^\[([^\[\]]+)\]$/);
    if (!m && lone && !isChord(lone[1])) m = lone;
    if (m) out.push(m[1]);
  }
  return out;
}

// Arrangement roadmap: a chip per section; click to scroll the chart to it.
function renderRoadmap(s) {
  const secs = songSections(s.body);
  if (secs.length < 2) { el.roadmap.innerHTML = ''; return; } // needs real structure
  el.roadmap.innerHTML = '<span class="rm-label">Form</span>' +
    secs.map((name, i) => `<button class="rm-chip" data-i="${i}">${escapeHtml(name)}</button>`).join('');
  el.roadmap.querySelectorAll('.rm-chip').forEach((b) => b.addEventListener('click', () => {
    const target = el.previewBody.querySelectorAll('.section')[+b.dataset.i];
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

// ---- Riffs: rendered output (preview/print) + authoring grid ---------------

// Rendered riffs, into #riff-panels (shown on screen; each its own print page).
function renderRiffs(s) {
  const riffs = (s && s.riffs) || [];
  el.riffPanels.innerHTML = riffs.map((riff) => {
    const lines = riffToLines(riff).map((ln) => `<div class="line">${escapeHtml(ln)}</div>`).join('');
    return `<section class="riff-block"><div class="riff-title">${escapeHtml(riff.label || 'Riff')}</div>` +
      `<div class="riff-tab">${lines}</div></section>`;
  }).join('');
}

// The authoring grid (below the editor): one editable tab grid per riff.
function renderRiffEditor(s) {
  const cont = el.riffEditors;
  if (!s) { cont.innerHTML = ''; return; }
  const riffs = s.riffs || (s.riffs = []);
  if (!riffs.length) {
    cont.innerHTML = '<div class="riff-empty">No riffs yet — “+ Add riff” starts a tab that prints on its own page.</div>';
    return;
  }
  const hint = '<div class="riff-hint">Type a fret, then add a technique linking it to the next step: ' +
    '<b>h</b> hammer · <b>p</b> pull · <b>b</b> bend · <b>/</b> <b>\\</b> slide ' +
    '(e.g. <code>5h</code> then <code>7</code> → <code>5h7</code>)</div>';
  cont.innerHTML = hint + riffs.map((riff, ri) => {
    const steps = riff.cols.length;
    let rows = '';
    for (let r = 0; r < 6; r++) {
      let cells = `<span class="rg-str">${RIFF_STRINGS[r]}</span>`;
      for (let c = 0; c < steps; c++) {
        cells += `<input class="rg-cell" maxlength="3" data-ri="${ri}" data-c="${c}" data-r="${r}" value="${escapeHtml(riff.cols[c][r] || '')}" />`;
      }
      rows += `<div class="rg-row">${cells}</div>`;
    }
    return `<div class="riff-edit">` +
      `<div class="riff-edit-head">` +
        `<input class="riff-label" data-ri="${ri}" value="${escapeHtml(riff.label || '')}" placeholder="Riff name" title="Riff name (prints as the heading)" />` +
        `<span class="riff-tools">` +
          `<button class="inline-btn rg-addstep" data-ri="${ri}" title="Add a step">+ step</button>` +
          `<button class="inline-btn rg-delstep" data-ri="${ri}" title="Remove the last step">&minus; step</button>` +
          `<button class="inline-btn rg-del" data-ri="${ri}" title="Delete this riff">Delete</button>` +
        `</span>` +
      `</div><div class="riff-grid">${rows}</div></div>`;
  }).join('');
  wireRiffEditor(s);
}

function wireRiffEditor(s) {
  const cont = el.riffEditors;
  cont.querySelectorAll('.rg-cell').forEach((inp) => {
    inp.addEventListener('input', () => {
      // fret (0–2 digits) + optional trailing technique (h p b / \)
      const m = inp.value.match(/^(\d{0,2})([hpb/\\]?)/);
      const v = m ? m[1] + m[2] : '';
      if (v !== inp.value) inp.value = v;
      s.riffs[+inp.dataset.ri].cols[+inp.dataset.c][+inp.dataset.r] = v;
      s.updated = Date.now(); schedulePersist();
      renderRiffs(s); // update the rendered tab without rebuilding the grid (keeps focus)
    });
    inp.addEventListener('keydown', (e) => riffCellNav(e, inp));
  });
  cont.querySelectorAll('.riff-label').forEach((inp) => inp.addEventListener('input', () => {
    s.riffs[+inp.dataset.ri].label = inp.value;
    s.updated = Date.now(); schedulePersist();
    renderRiffs(s);
  }));
  cont.querySelectorAll('.rg-addstep').forEach((b) => b.addEventListener('click', () => {
    s.riffs[+b.dataset.ri].cols.push(['', '', '', '', '', '']);
    s.updated = Date.now(); schedulePersist(); renderRiffEditor(s); renderRiffs(s);
  }));
  cont.querySelectorAll('.rg-delstep').forEach((b) => b.addEventListener('click', () => {
    const riff = s.riffs[+b.dataset.ri];
    if (riff.cols.length > 1) riff.cols.pop();
    s.updated = Date.now(); schedulePersist(); renderRiffEditor(s); renderRiffs(s);
  }));
  cont.querySelectorAll('.rg-del').forEach((b) => b.addEventListener('click', () => {
    if (!confirm('Delete this riff?')) return;
    s.riffs.splice(+b.dataset.ri, 1);
    s.updated = Date.now(); schedulePersist(); renderRiffEditor(s); renderRiffs(s);
  }));
}

// Arrow-key navigation across grid cells.
function riffCellNav(e, inp) {
  const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
  if (!step) return;
  // Let Left/Right move the caret inside a two-digit entry before leaving the cell.
  if (step[1] === -1 && inp.selectionStart > 0) return;
  if (step[1] === 1 && inp.selectionStart < inp.value.length) return;
  const r = +inp.dataset.r + step[0], c = +inp.dataset.c + step[1];
  const next = el.riffEditors.querySelector(`.rg-cell[data-ri="${inp.dataset.ri}"][data-c="${c}"][data-r="${r}"]`);
  if (next) { e.preventDefault(); next.focus(); next.select(); }
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

let songFilter = '';
function songMatches(s, q) {
  return (s.title || '').toLowerCase().includes(q) ||
    (s.artist || '').toLowerCase().includes(q) ||
    (s.path || '').toLowerCase().includes(q);
}

// When a search is active, show a flat list of matches across every folder — a
// jam wants to jump to a called tune, not navigate the tree.
function renderFiltered(q) {
  el.list.innerHTML = '';
  const matches = songs.filter((s) => songMatches(s, q))
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  el.count.textContent = matches.length + ' / ' + songs.length;
  if (!matches.length) { el.list.innerHTML = '<li class="search-empty">No matches</li>'; return; }
  for (const s of matches) {
    const li = document.createElement('li');
    li.className = 'song-item' + (s.id === currentId ? ' active' : '');
    let sub = s.artist || '';
    if (mode === 'folder') { const lib = libraries.find((l) => l.id === s.libId); sub = (lib ? lib.name + '/' : '') + (s.path || ''); }
    li.innerHTML = `<span class="st"><b>${escapeHtml(s.title || 'Untitled')}</b><small>${escapeHtml(sub)}</small></span>`;
    li.querySelector('.st').addEventListener('click', () => selectSong(s.id));
    el.list.appendChild(li);
  }
}

function renderList() {
  if (songFilter) { renderFiltered(songFilter); return; }
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

// ---- Per-song tempo + count-in ---------------------------------------------
const DEFAULT_TEMPO = 120;
function setTempo(bpm) {
  const s = currentSong();
  if (!s) return;
  s.tempo = bpm === null ? null : Math.max(30, Math.min(300, bpm));
  el.tempoInput.value = s.tempo || '';
  s.updated = Date.now();
  schedulePersist();
}
function bumpTempo(delta) {
  const s = currentSong();
  if (!s) return;
  setTempo((s.tempo || DEFAULT_TEMPO) + delta);
}

// A short beep at scheduled AudioContext time t.
function beepAt(ctx, t, accent) {
  const osc = ctx.createOscillator(), g = ctx.createGain();
  osc.frequency.value = accent ? 1600 : 1000;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(accent ? 0.4 : 0.25, t + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  osc.connect(g); g.connect(ctx.destination);
  osc.start(t); osc.stop(t + 0.06);
}

let countCtx = null;
function countIn() {
  const s = currentSong();
  if (!s) return;
  const bpm = s.tempo || DEFAULT_TEMPO;
  const beat = 60 / bpm;
  const ctx = countCtx || (countCtx = new (window.AudioContext || window.webkitAudioContext)());
  if (ctx.state === 'suspended') ctx.resume();
  const t0 = ctx.currentTime + 0.12;
  let overlay = document.getElementById('count-overlay');
  if (!overlay) { overlay = document.createElement('div'); overlay.id = 'count-overlay'; overlay.className = 'count-overlay'; document.body.appendChild(overlay); }
  overlay.hidden = false; overlay.textContent = '';
  for (let i = 0; i < 4; i++) {
    beepAt(ctx, t0 + i * beat, i === 0);
    const ms = Math.max(0, (t0 + i * beat - ctx.currentTime) * 1000);
    setTimeout(() => { overlay.textContent = String(i + 1); }, ms);
  }
  setTimeout(() => { overlay.hidden = true; }, Math.max(0, (t0 + 4 * beat - ctx.currentTime) * 1000));
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
// ---- Riffs / solos (tablature) ---------------------------------------------
// A riff is { id, label, cols }: cols is an array of steps, each step a 6-cell
// array [high-e … low-E], each cell '' or a fret number. It serializes to a
// standard ChordPro {start_of_tab: label} … {end_of_tab} block so it round-trips
// through .cho files. The ASCII uses a fixed 3-char field per step (dash + a
// two-char fret) so grid ↔ text is lossless.
const RIFF_STRINGS = ['e', 'B', 'G', 'D', 'A', 'E']; // top (high e) → bottom (low E)
const RIFF_DEFAULT_STEPS = 8;

function newRiff(label) {
  const cols = [];
  for (let c = 0; c < RIFF_DEFAULT_STEPS; c++) cols.push(['', '', '', '', '', '']);
  return { id: newId(), label: label || 'Riff', cols };
}

// A cell is a fret plus an optional trailing technique that links it to the next
// step on the same string: h hammer, p pull-off, b bend, / slide up, \ slide down.
const RIFF_TECHS = 'hpb/\\';
function cellFret(cell) { const m = String(cell || '').match(/\d{1,2}/); return m ? m[0] : ''; }
function cellTech(cell) { const m = String(cell || '').match(/[hpb/\\]$/); return m ? m[0] : ''; }

// Each step is a fixed 3-char field: [link][fret padded to 2, left-aligned],
// where `link` is the PREVIOUS cell's technique (so "5h" then "7" → "-5-h7-",
// read 5·h7). Fixed width keeps grid ↔ text lossless, techniques included.
function riffRowAscii(riff, r) {
  let out = RIFF_STRINGS[r] + '|';
  for (let c = 0; c < riff.cols.length; c++) {
    const link = c > 0 ? cellTech(riff.cols[c - 1][r]) : '';
    const f = cellFret(riff.cols[c][r]);
    out += (link || '-') + (f ? f.padEnd(2, '-') : '--');
  }
  return out + '|';
}
function riffToLines(riff) { return RIFF_STRINGS.map((_, r) => riffRowAscii(riff, r)); }
function riffToBlock(riff) {
  return `{start_of_tab: ${riff.label}}\n` + riffToLines(riff).join('\n') + '\n{end_of_tab}';
}

// Parse fixed-width tab lines back into columns (best-effort for hand edits).
function riffFromBlock(label, lines) {
  const byLetter = {};
  for (const ln of lines) {
    const m = ln.match(/^([eBGDAE])\|(.*)$/);
    if (m) byLetter[m[1]] = m[2].replace(/\|\s*$/, '');
  }
  let steps = 0;
  for (const L of RIFF_STRINGS) if (byLetter[L] != null) steps = Math.max(steps, Math.floor(byLetter[L].length / 3));
  const cols = [];
  for (let c = 0; c < steps; c++) cols.push(['', '', '', '', '', '']);
  for (let r = 0; r < 6; r++) {
    const content = byLetter[RIFF_STRINGS[r]] || '';
    for (let c = 0; c < steps; c++) {
      const chunk = content.substr(c * 3, 3);
      cols[c][r] = chunk.slice(1).replace(/[^0-9]/g, '').slice(0, 2); // fret at pos 1–2
      const link = chunk[0];                                          // technique into this step
      if (c > 0 && link && RIFF_TECHS.includes(link)) cols[c - 1][r] += link;
    }
  }
  if (!cols.length) cols.push(['', '', '', '', '', '']);
  return { id: newId(), label: label || 'Riff', cols };
}

function songToCho(s) {
  let out = '';
  if (s.title) out += `{title: ${s.title}}\n`;
  if (s.artist) out += `{artist: ${s.artist}}\n`;
  if (s.key !== null && s.key !== undefined) out += `{key: ${HARP_NAMES[s.key]}}\n`;
  if (s.transpose) out += `{transpose: ${s.transpose}}\n`;
  if (s.capo) out += `{capo: ${s.capo}}\n`;
  if (s.tempo) out += `{tempo: ${s.tempo}}\n`;
  if (s.tuning && s.tuning !== 'standard') out += `{tuning: ${s.tuning}}\n`;
  if (out) out += '\n';
  out += s.body;
  if (s.riffs && s.riffs.length) {
    out += (out.endsWith('\n') ? '\n' : '\n\n') + s.riffs.map(riffToBlock).join('\n\n') + '\n';
  }
  return out;
}

// Parse .cho text into a fresh (unattached) song object.
function parseCho(text, fallbackTitle) {
  const s = blankSong();
  const lines = text.split('\n');
  const body = [];
  let sawDirective = false;
  let tabLabel = null, tabLines = null; // inside a {start_of_tab}…{end_of_tab}
  for (const line of lines) {
    if (tabLines) {
      if (/^\{(end_of_tab|eot)\}\s*$/i.test(line)) {
        s.riffs.push(riffFromBlock(tabLabel, tabLines));
        tabLines = null; tabLabel = null;
      } else {
        tabLines.push(line);
      }
      continue;
    }
    const sot = line.match(/^\{(?:start_of_tab|sot)\s*:?\s*(.*)\}\s*$/i);
    if (sot) { sawDirective = true; tabLabel = sot[1].trim() || 'Riff'; tabLines = []; continue; }
    const t = line.match(/^\{(title|artist|transpose|capo|key|tempo|tuning)\s*:\s*(.*)\}\s*$/i);
    if (t) {
      sawDirective = true;
      const key = t[1].toLowerCase();
      if (key === 'title') s.title = t[2].trim();
      else if (key === 'artist') s.artist = t[2].trim();
      else if (key === 'transpose') s.transpose = parseInt(t[2], 10) || 0;
      else if (key === 'capo') s.capo = Math.max(0, Math.min(11, parseInt(t[2], 10) || 0));
      else if (key === 'key') s.key = noteToPc(t[2]);
      else if (key === 'tempo') s.tempo = Math.max(20, Math.min(400, parseInt(t[2], 10))) || null;
      else if (key === 'tuning') { const v = t[2].trim(); s.tuning = TUNER_PRESETS[v] ? v : null; }
    } else {
      body.push(line);
    }
  }
  if (tabLines) s.riffs.push(riffFromBlock(tabLabel, tabLines)); // unterminated block
  if (sawDirective && body[0] === '') body.shift(); // drop blank after directives
  // Drop trailing blank lines left where riff blocks were lifted out of the body.
  while (body.length && body[body.length - 1] === '') body.pop();
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
  if (s) el.previewBody.innerHTML = chartHtml(el.editor.value, inlineShift(s), numberKeyFor(s)); // instant lyric preview
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
document.getElementById('tempo-up').addEventListener('click', () => bumpTempo(5));
document.getElementById('tempo-down').addEventListener('click', () => bumpTempo(-5));
document.getElementById('count-in-btn').addEventListener('click', countIn);
el.songTuning.addEventListener('change', () => {
  const s = currentSong();
  if (!s) return;
  s.tuning = el.songTuning.value === 'standard' ? null : el.songTuning.value;
  s.updated = Date.now();
  schedulePersist();
  renderTuningBanner(s);
});
el.tempoInput.addEventListener('change', () => {
  const v = parseInt(el.tempoInput.value, 10);
  setTempo(Number.isFinite(v) && v > 0 ? v : null);
});

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
// Desktop layout: side-by-side panes, or a single column showing one pane at
// a time. Phones ignore this and always stack (the switch is hidden there).
function applyLayout() {
  const mode = prefs.layout || 'split';
  document.body.classList.toggle('view-editor', mode === 'editor');
  document.body.classList.toggle('view-preview', mode === 'preview');
  document.querySelectorAll('#view-switch .vs-btn').forEach((b) => {
    b.setAttribute('aria-pressed', b.dataset.view === mode ? 'true' : 'false');
  });
}
document.querySelectorAll('#view-switch .vs-btn').forEach((b) => {
  b.addEventListener('click', () => {
    prefs.layout = b.dataset.view;
    savePrefs();
    applyLayout();
    // The preview measures itself for print column sizing; re-render so a
    // freshly revealed pane lays out at its new width.
    renderPreview();
  });
});

// Phone preview bar: one switch for every chart (chords + scales at once),
// mirroring the two desktop checkboxes so both views stay in sync.
(function wireChartsToggle() {
  const btn = document.getElementById('charts-toggle');
  if (!btn) return;
  const paint = () => {
    const on = prefs.showChords || prefs.showScales;
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.classList.toggle('is-on', on);
    // Off means off: hide the instrument chips and panels too, not just the
    // diagrams inside them, so the phone falls back to a clean lyric sheet.
    document.body.classList.toggle('charts-off', !on);
  };
  btn.addEventListener('click', () => {
    const on = !(prefs.showChords || prefs.showScales);
    prefs.showChords = on;
    prefs.showScales = on;
    el.toggleChords.checked = on;
    el.toggleScales.checked = on;
    savePrefs();
    renderPreview();
    paint();
  });
  paint();
  // Keep the switch honest when the desktop checkboxes change.
  el.toggleChords.addEventListener('change', paint);
  el.toggleScales.addEventListener('change', paint);
})();
document.getElementById('mbar-perform').addEventListener('click', () => openPerform());

el.toggleNumbers.addEventListener('change', () => {
  prefs.nashville = el.toggleNumbers.checked;
  savePrefs();
  renderPreview();
});
document.getElementById('song-search').addEventListener('input', (e) => {
  songFilter = e.target.value.trim().toLowerCase();
  renderList();
});
document.getElementById('export-btn').addEventListener('click', exportSong);

// ---- Share a song as a link ------------------------------------------------
// The whole .cho is gzipped and base64url-packed into the URL hash — no server,
// nothing leaves the device until the link is sent. Opening such a link imports
// the song locally.
function b64urlEncode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
async function gzipToB64(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return b64urlEncode(new Uint8Array(await new Response(stream).arrayBuffer()));
}
async function b64ToText(b64) {
  const stream = new Blob([b64urlDecode(b64)]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

async function shareSong() {
  const s = currentSong();
  if (!s) { alert('Select a song to share first.'); return; }
  let url;
  try {
    const packed = await gzipToB64(songToCho(s));
    url = location.origin + location.pathname + '#song=' + packed;
  } catch { alert('Could not build a share link in this browser.'); return; }
  const input = document.getElementById('share-url');
  input.value = url;
  renderShareQr(url);
  document.getElementById('share-modal').hidden = false;
  input.focus(); input.select();
}

// Draw a scannable QR of the share link, or a note if the song is too big to fit one.
function renderShareQr(url) {
  const box = document.getElementById('share-qr');
  if (!box) return;
  let svg = null;
  try { svg = window.QR && window.QR.svg(url); } catch { svg = null; }
  if (svg) {
    box.innerHTML = svg;
    box.classList.remove('share-qr-empty');
  } else {
    // Over ~2.9KB the link exceeds QR byte-mode capacity — the copyable link still works.
    box.innerHTML = 'This song is too detailed for a scannable code — use the link below.';
    box.classList.add('share-qr-empty');
  }
}

// On load, import a song carried in the URL hash (#song=…), then clean the URL.
async function importSharedSong() {
  const m = location.hash.match(/^#song=(.+)$/);
  if (!m) return;
  try {
    const s = parseCho(await b64ToText(m[1]), 'Shared song');
    s.id = newId();
    if (mode === 'folder') s.libId = null; // a received chart lives outside folders
    songs.push(s);
    if (mode !== 'folder') saveSongs(songs);
    selectSong(s.id);
  } catch { /* malformed link — ignore */ }
  history.replaceState(null, '', location.pathname + location.search);
}
document.getElementById('share-btn').addEventListener('click', shareSong);
document.getElementById('share-close').addEventListener('click', () => { document.getElementById('share-modal').hidden = true; });
document.getElementById('share-copy').addEventListener('click', async () => {
  const input = document.getElementById('share-url');
  try { await navigator.clipboard.writeText(input.value); document.getElementById('share-copy').textContent = 'Copied ✓'; }
  catch { input.select(); document.execCommand('copy'); document.getElementById('share-copy').textContent = 'Copied ✓'; }
  setTimeout(() => { document.getElementById('share-copy').textContent = 'Copy link'; }, 1500);
});
// Collapsible header menu (phones): the ☰ button toggles the action list.
(function wireHeaderMenu() {
  const header = document.querySelector('header');
  const toggle = document.getElementById('menu-toggle');
  const actions = document.getElementById('header-actions');
  if (!header || !toggle || !actions) return;
  const setOpen = (open) => {
    header.classList.toggle('menu-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  toggle.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!header.classList.contains('menu-open')); });
  // Picking any action collapses the menu again.
  actions.addEventListener('click', (e) => { if (e.target.closest('button')) setOpen(false); });
  // Tapping outside the header closes it.
  document.addEventListener('click', (e) => { if (!header.contains(e.target)) setOpen(false); });
})();

// Collapsible song drawer (phones): tap the "Songs" header to show/hide the
// list. Below the breakpoint it starts collapsed so the editor is front and
// centre; picking a song closes it again. On desktop the CSS ignores the
// class, so the list is always shown.
(function wireSongDrawer() {
  const head = document.getElementById('sidebar-head');
  const sidebar = document.getElementById('sidebar');
  const list = document.getElementById('song-list');
  if (!head || !sidebar || !list) return;
  const isPhone = () => window.matchMedia('(max-width: 760px)').matches;
  const setOpen = (open) => {
    sidebar.classList.toggle('drawer-open', open);
    head.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  head.addEventListener('click', () => { if (isPhone()) setOpen(!sidebar.classList.contains('drawer-open')); });
  head.addEventListener('keydown', (e) => { if (isPhone() && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpen(!sidebar.classList.contains('drawer-open')); } });
  list.addEventListener('click', (e) => { if (isPhone() && e.target.closest('li')) setOpen(false); });
})();

document.getElementById('add-riff-btn').addEventListener('click', () => {
  ensureSongForTyping(); // create a local song to hold it if none is selected
  const cur = currentSong();
  if (!cur) { alert('Start or open a song first, then add a riff.'); return; }
  if (!cur.riffs) cur.riffs = [];
  cur.riffs.push(newRiff('Riff ' + (cur.riffs.length + 1)));
  cur.updated = Date.now();
  schedulePersist();
  renderRiffEditor(cur);
  renderRiffs(cur);
});
document.getElementById('print-btn').addEventListener('click', () => {
  // Swap to the aligned chart first: computePrintFont measures line widths,
  // and the phone's wrapped lines would give it the wrong answer.
  if (window.matchMedia('(max-width: 760px)').matches) { forceAlignedChart = true; renderPreview(); }
  computePrintFont();      // size the font to the column width before printing
  window.print();
});

// Paper always gets the space-aligned chart, even when the phone screen is
// showing wrapped lines. Covers Cmd+P as well as the Print button.
window.addEventListener('beforeprint', () => {
  if (!window.matchMedia('(max-width: 760px)').matches) return;
  forceAlignedChart = true;
  renderPreview();
});
window.addEventListener('afterprint', () => {
  if (!forceAlignedChart) return;
  forceAlignedChart = false;
  renderPreview();
});

// Rotating the phone (or crossing the breakpoint on a desktop resize) switches
// which renderer the chart needs.
window.matchMedia('(max-width: 760px)').addEventListener('change', () => renderPreview());

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
// lines are white-space:pre, but they're block elements, so scrollWidth floors
// at the container width — it measured the preview pane rather than the text,
// which made the print size depend on how wide the browser window was (a wide
// monitor shrank the type). A Range over the contents gives the text's own
// extent, chord rows included since those are positioned with spaces.
function widestBodyLinePx() {
  let m = 1;
  const range = document.createRange();
  document.querySelectorAll('#preview-body .line, #riff-panels .line').forEach((l) => {
    range.selectNodeContents(l);
    const w = range.getBoundingClientRect().width;
    if (w > m) m = w;
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
  fit = Math.min(14, Math.max(6, fit)); // 6–14pt; wide songs still shrink to fit
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
  // Cmd/Ctrl+Alt+1/2/3 switch the desktop layout (Split / Editor / Preview).
  // Alt is included so this doesn't collide with the browser's own Cmd/Ctrl+
  // number tab-switching. e.code stays Digit1-3 even when Alt remaps e.key.
  if ((e.metaKey || e.ctrlKey) && e.altKey && !e.shiftKey && /^Digit[123]$/.test(e.code)
      && window.matchMedia('(min-width: 761px)').matches) {
    e.preventDefault();
    const view = { Digit1: 'split', Digit2: 'editor', Digit3: 'preview' }[e.code];
    prefs.layout = view;
    savePrefs();
    applyLayout();
    renderPreview();
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

// Replace a range of the editor text (undo-friendly), then fire input.
function replaceRange(ta, from, to, text) {
  ta.focus();
  ta.setSelectionRange(from, to);
  let ok = false;
  try { ok = document.execCommand('insertText', false, text); } catch { ok = false; }
  if (!ok) {
    ta.value = ta.value.slice(0, from) + text + ta.value.slice(to);
    ta.dispatchEvent(new Event('input'));
  }
}

// Move the current line (or every line the selection touches) up/down, like
// VSCode's Alt+Up / Alt+Down. Keeps the selection on the moved block.
function moveEditorLines(dir) {
  const ta = el.editor;
  const val = ta.value;
  const selStart = ta.selectionStart, selEnd = ta.selectionEnd;
  const lineStart = val.lastIndexOf('\n', selStart - 1) + 1;
  let lineEnd = val.indexOf('\n', selEnd);
  if (lineEnd === -1) lineEnd = val.length;
  const block = val.slice(lineStart, lineEnd);
  if (dir === -1) {
    if (lineStart === 0) return; // already the top line
    const prevStart = val.lastIndexOf('\n', lineStart - 2) + 1;
    const prevLine = val.slice(prevStart, lineStart - 1);
    replaceRange(ta, prevStart, lineEnd, block + '\n' + prevLine);
    const delta = lineStart - prevStart;
    ta.setSelectionRange(selStart - delta, selEnd - delta);
  } else {
    if (lineEnd >= val.length) return; // already the bottom line
    const nextEnd = val.indexOf('\n', lineEnd + 1);
    const realNextEnd = nextEnd === -1 ? val.length : nextEnd;
    const nextLine = val.slice(lineEnd + 1, realNextEnd);
    replaceRange(ta, lineStart, realNextEnd, nextLine + '\n' + block);
    const delta = nextLine.length + 1;
    ta.setSelectionRange(selStart + delta, selEnd + delta);
  }
}

// Duplicate the current line (or the selected block). dir 1 = put the caret on
// the lower copy (Shift+Alt+Down), -1 = keep it on the upper copy (Shift+Alt+Up).
function duplicateEditorLines(dir) {
  const ta = el.editor;
  const val = ta.value;
  const selStart = ta.selectionStart, selEnd = ta.selectionEnd;
  const lineStart = val.lastIndexOf('\n', selStart - 1) + 1;
  let lineEnd = val.indexOf('\n', selEnd);
  if (lineEnd === -1) lineEnd = val.length;
  const block = val.slice(lineStart, lineEnd);
  replaceRange(ta, lineStart, lineEnd, block + '\n' + block);
  if (dir === 1) { const d = block.length + 1; ta.setSelectionRange(selStart + d, selEnd + d); }
  else ta.setSelectionRange(selStart, selEnd);
}

// Keyboard chord placement + Tab-inserts-spaces.
el.editor.addEventListener('keydown', (e) => {
  // VSCode-style line ops on Alt/Option + ↑/↓ — Shift duplicates, else moves.
  if (e.altKey && !e.metaKey && !e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    if (chordPopup) closeChordPopup();
    if (e.shiftKey) duplicateEditorLines(e.key === 'ArrowDown' ? 1 : -1);
    else moveEditorLines(e.key === 'ArrowUp' ? -1 : 1);
    return;
  }
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

const PF_FONT_MIN = 10, PF_FONT_MAX = 60;
const PF_FIT_MAX_COLS = 8; // most columns auto-fit will consider

// `bodyVer` bumps whenever the chart HTML changes, so cached measurements know
// they're stale.
const perf = { open: false, page: 0, pages: 1, bodyVer: 0, orig: {}, idleTimer: null, auto: false, autoTimer: null, setlist: null };
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

// ---- Setlists --------------------------------------------------------------
// Named, ordered lists of songs to perform through. Entries reference songs
// stably (folder: libId+path, local: id) so a set survives reloads.
const SETLIST_KEY = 'gtw.setlists';
let setlists = loadSetlists();
let editingSetId = null; // which setlist the modal is showing

function loadSetlists() { try { return JSON.parse(localStorage.getItem(SETLIST_KEY) || '[]'); } catch { return []; } }
function saveSetlists() { localStorage.setItem(SETLIST_KEY, JSON.stringify(setlists)); }
function songKey(s) { return s.libId ? 'lib:' + s.libId + '|' + (s.path || '') : 'local:' + s.id; }
function resolveKey(key) {
  if (key.startsWith('lib:')) {
    const [libId, path] = key.slice(4).split('|');
    return songs.find((s) => s.libId === libId && (s.path || '') === path);
  }
  return songs.find((s) => s.id === key.slice(6));
}

function openSetlistModal() {
  if (!setlists.find((x) => x.id === editingSetId)) editingSetId = setlists[0] ? setlists[0].id : null;
  document.getElementById('setlist-modal').hidden = false;
  renderSetlistModal();
}
function renderSetlistModal() {
  const listEl = document.getElementById('setlist-list');
  listEl.innerHTML = setlists.map((sl) =>
    `<li class="sl-item${sl.id === editingSetId ? ' active' : ''}" data-id="${sl.id}">${escapeHtml(sl.name)}<span class="sl-count">${sl.items.length}</span></li>`).join('')
    || '<li class="sl-empty">No setlists yet.</li>';
  listEl.querySelectorAll('.sl-item').forEach((li) => li.addEventListener('click', () => { editingSetId = li.dataset.id; renderSetlistModal(); }));

  const detail = document.getElementById('setlist-detail');
  const sl = setlists.find((x) => x.id === editingSetId);
  if (!sl) { detail.innerHTML = '<div class="sl-hint">Create a setlist to start.</div>'; return; }
  const rows = sl.items.map((it, i) => {
    const found = resolveKey(it.key);
    const missing = found ? '' : ' <span class="sl-missing">(not open)</span>';
    return `<li class="sl-row"><span class="sl-song">${i + 1}. ${escapeHtml(it.title || (found && found.title) || 'Untitled')}${missing}</span>` +
      `<span class="sl-tools"><button class="sl-up" data-i="${i}" title="Move up">&#8593;</button>` +
      `<button class="sl-down" data-i="${i}" title="Move down">&#8595;</button>` +
      `<button class="sl-rm" data-i="${i}" title="Remove">&#10005;</button></span></li>`;
  }).join('');
  detail.innerHTML =
    `<div class="sl-detail-head"><b>${escapeHtml(sl.name)}</b>` +
    `<span class="sl-detail-tools"><button class="inline-btn" id="sl-rename">Rename</button>` +
    `<button class="inline-btn" id="sl-delete">Delete</button></span></div>` +
    `<ul class="sl-rows">${rows || '<li class="sl-hint">Empty — add the current song below.</li>'}</ul>` +
    `<div class="sl-actions"><button class="inline-btn" id="sl-add-current">+ Add current song</button>` +
    `<button class="tool-start" id="sl-perform"${sl.items.length ? '' : ' disabled'}>Perform set &#9654;</button></div>`;
  wireSetlistDetail(sl);
}
function wireSetlistDetail(sl) {
  const d = document.getElementById('setlist-detail');
  d.querySelector('#sl-rename').onclick = () => { const n = prompt('Setlist name:', sl.name); if (n && n.trim()) { sl.name = n.trim(); saveSetlists(); renderSetlistModal(); } };
  d.querySelector('#sl-delete').onclick = () => { if (confirm('Delete this setlist?')) { setlists = setlists.filter((x) => x.id !== sl.id); editingSetId = setlists[0] ? setlists[0].id : null; saveSetlists(); renderSetlistModal(); } };
  d.querySelector('#sl-add-current').onclick = () => {
    const cur = currentSong();
    if (!cur) { alert('Select a song first.'); return; }
    sl.items.push({ key: songKey(cur), title: cur.title || 'Untitled' });
    saveSetlists(); renderSetlistModal();
  };
  const perfBtn = d.querySelector('#sl-perform');
  if (perfBtn && !perfBtn.disabled) perfBtn.onclick = () => performSetlist(sl);
  d.querySelectorAll('.sl-up').forEach((b) => (b.onclick = () => { const i = +b.dataset.i; if (i > 0) { [sl.items[i - 1], sl.items[i]] = [sl.items[i], sl.items[i - 1]]; saveSetlists(); renderSetlistModal(); } }));
  d.querySelectorAll('.sl-down').forEach((b) => (b.onclick = () => { const i = +b.dataset.i; if (i < sl.items.length - 1) { [sl.items[i + 1], sl.items[i]] = [sl.items[i], sl.items[i + 1]]; saveSetlists(); renderSetlistModal(); } }));
  d.querySelectorAll('.sl-rm').forEach((b) => (b.onclick = () => { sl.items.splice(+b.dataset.i, 1); saveSetlists(); renderSetlistModal(); }));
}
function performSetlist(sl) {
  const first = sl.items.map((it) => resolveKey(it.key)).find(Boolean);
  if (!first) { alert('None of this set’s songs are open right now — open their folder first.'); return; }
  document.getElementById('setlist-modal').hidden = true;
  perf.setlist = sl;
  selectSong(first.id);
  openPerform();
}

// ---- Keyboard shortcuts cheatsheet -----------------------------------------
function renderHelp() {
  const A = ALT_LABEL, C = IS_MAC ? '⌘' : 'Ctrl+', S = IS_MAC ? '⇧' : 'Shift+';
  const groups = [
    ['Editor', [
      [['[', C + 'K'], 'Search & insert a chord'],
      [[A + '1–9'], 'Insert the numbered palette chord'],
      [[A + '↑', A + '↓'], 'Move line(s) up / down'],
      [[S + A + '↑', S + A + '↓'], 'Duplicate line(s) up / down'],
      [['Tab'], 'Insert two spaces'],
      [[C + 'S'], 'Save to file (folder mode)'],
    ]],
    ['Chord search popup', [
      [['↑', '↓'], 'Move selection'],
      [['Enter', 'Tab'], 'Insert chord'],
      [['Esc'], 'Cancel'],
    ]],
    ['Layout', [
      [[C + A + '1'], 'Split view'],
      [[C + A + '2'], 'Editor only'],
      [[C + A + '3'], 'Preview only'],
    ]],
    ['Performance mode', [
      [['→', '↓', 'Space', 'PgDn'], 'Next page / song'],
      [['←', '↑', 'PgUp'], 'Previous page / song'],
      [['Esc'], 'Exit'],
    ]],
    ['Recording & dictation', [
      [['R'], 'Start / stop a take (works anywhere, including performance mode)'],
      [['D'], 'Start dictating lyrics'],
      [['Esc'], 'Stop dictating'],
    ]],
  ];
  document.getElementById('help-body').innerHTML = groups.map(([title, rows]) =>
    `<div class="help-group"><div class="help-group-title">${title}</div>` +
    rows.map(([keys, desc]) =>
      `<div class="help-row"><span class="help-keys">${keys.map((k) => `<kbd>${escapeHtml(k)}</kbd>`).join('<span class="help-or">or</span>')}</span>` +
      `<span class="help-desc">${escapeHtml(desc)}</span></div>`).join('') + '</div>').join('');
}
function openHelp() { renderHelp(); document.getElementById('help-modal').hidden = false; }
function closeHelp() { document.getElementById('help-modal').hidden = true; }
document.getElementById('help-btn').addEventListener('click', openHelp);
document.getElementById('help-close').addEventListener('click', closeHelp);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !document.getElementById('help-modal').hidden) { closeHelp(); return; }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '');
  // "?" opens the cheatsheet — but not while typing in a field.
  if (e.key === '?' && !typing) { e.preventDefault(); openHelp(); }
  // "R" starts and stops a take from anywhere, performance mode included, so an
  // idea can be caught without leaving the chart. Bare key only: Cmd/Ctrl+R is
  // reload, and a modifier means you meant something else.
  if ((e.key === 'r' || e.key === 'R') && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    captureToggle();
  }
  // "D" starts dictation. Only a start: once it's running your caret is in the
  // editor, so stopping goes through Esc or the button instead of a bare letter.
  // Unlike R, it's a writing tool, so it stays out of performance mode.
  if ((e.key === 'd' || e.key === 'D') && !typing && !dict.on && !perf.open
      && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    dictStart();
  }
  // Esc stops dictation from anywhere, the editor included.
  if (e.key === 'Escape' && (dict.on || dict.showInstall)) {
    e.preventDefault();
    dictStop();
    dict.showInstall = false;
    dictSetStatus('');
    dictPaint();
  }
});

document.getElementById('setlist-btn').addEventListener('click', openSetlistModal);
document.getElementById('setlist-close').addEventListener('click', () => { document.getElementById('setlist-modal').hidden = true; });
document.getElementById('setlist-new').addEventListener('click', () => {
  const name = prompt('New setlist name:', 'Set ' + (setlists.length + 1));
  if (name === null) return;
  const sl = { id: newId(), name: name.trim() || 'Set ' + (setlists.length + 1), items: [] };
  setlists.push(sl); editingSetId = sl.id; saveSetlists(); renderSetlistModal();
});

// The ordered list the page-turner flows through: a chosen setlist if we're
// performing one, else the current folder's charts (by path), else local songs.
function perfSetlist() {
  if (perf.setlist) {
    const out = perf.setlist.items.map((it) => resolveKey(it.key)).filter(Boolean);
    if (out.length) return out;
  }
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
  // Anything still listening would type into a chart you can no longer see.
  if (typeof dict !== 'undefined' && dict.on) dictStop();
  perf.open = true;
  pf.overlay.hidden = false;
  document.body.classList.add('performing');
  pf.colNum.textContent = prefs.perform.cols;
  pf.fontNum.textContent = prefs.perform.font;
  document.getElementById('pf-auto-secs').textContent = prefs.perform.autoSecs || 25;
  document.getElementById('pf-scroll-speed').textContent = prefs.perform.scrollSpeed || 30;
  stopAuto();
  stopPfScroll();
  syncPerfToggles();
  renderPerformBody();
  // Panels first: they eat vertical room, which the fit has to size around.
  applyPerfPanels();
  // Auto-fit sizes text to the screen; meaningless for the phone's single
  // wrapped column, where the reader picks the size instead.
  if (pfPhone()) { prefs.perform.font = Math.max(16, prefs.perform.font); pf.fontNum.textContent = prefs.perform.font; applyPerfLayout(); }
  else if (prefs.perform.autoFit) perfAutoFit();
  else perfAutoFont();
  document.addEventListener('keydown', perfKeydown, true);
  pf.overlay.addEventListener('mousemove', perfActivity);
  perfActivity();
  try { if (pf.overlay.requestFullscreen) pf.overlay.requestFullscreen().catch(() => {}); } catch { /* ignore */ }
}

function closePerform() {
  if (!perf.open) return;
  stopAuto();
  stopPfScroll();
  perf.setlist = null;
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
  // Phone: wrapped lines in one scrolling column. Desktop: the paged chart.
  const phone = pfPhone();
  pf.cols.innerHTML = phone
    ? renderWrapped(s.body, inlineShift(s), numberKeyFor(s))
    : render(s.body, inlineShift(s), numberKeyFor(s));
  pf.cols.classList.toggle('pf-scroll', phone);
  if (phone) pf.viewport.scrollTop = 0;
  perf.page = 0;
  perf.bodyVer++;
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
// The auto-fit search asks for many fonts in a row, so the clone is only re-filled
// when the chart itself changed and each font's width is remembered.
let pfMeasure = null;
let pfMeasureVer = -1;
const pfWidthCache = new Map();
function widestLinePx(font) {
  if (!pfMeasure) {
    pfMeasure = document.createElement('div');
    pfMeasure.className = 'preview';
    pfMeasure.style.cssText =
      'position:absolute; left:-99999px; top:0; visibility:hidden; display:inline-block; white-space:pre; padding:0; overflow:visible;';
    document.body.appendChild(pfMeasure);
  }
  if (pfMeasureVer !== perf.bodyVer) {
    pfMeasure.innerHTML = pf.cols.innerHTML;
    pfMeasureVer = perf.bodyVer;
    pfWidthCache.clear();
  }
  if (pfWidthCache.has(font)) return pfWidthCache.get(font);
  pfMeasure.style.fontSize = font + 'px';
  const w = pfMeasure.scrollWidth;
  pfWidthCache.set(font, w);
  return w;
}

// Largest font at which `cols` columns of the widest line still fit the screen.
function fontForCols(cols) {
  const vw = pf.viewport.clientWidth;
  const ref = 40;
  const wref = widestLinePx(ref);
  if (wref <= 0) return prefs.perform.font;
  const f = Math.floor(targetColW(cols, vw) * ref / wref);
  return Math.max(PF_FONT_MIN, Math.min(PF_FONT_MAX, f));
}

// Lay out columns. A column is never narrower than the widest line, so lines
// never overlap; if the chosen font makes them too wide for `cols` per screen,
// columns widen and the extra ones page horizontally instead. Returns metrics.
function perfLayoutCore(cols = prefs.perform.cols, font = prefs.perform.font) {
  const vw = pf.viewport.clientWidth;
  const wline = widestLinePx(font);
  const colW = Math.max(80, Math.floor(Math.max(targetColW(cols, vw), wline)));
  pf.cols.style.setProperty('--pf-font', font + 'px');
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

// ---- Auto-fit --------------------------------------------------------------
// Sizes each song to exactly one screen, as large as it will go, so a set can be
// pedalled through without anyone stopping to fiddle with the ± steppers.

// Biggest font in [lo, hi] whose layout still lands on one screen; 0 if even
// `lo` spills over. Taller text needs more columns and so a wider total, and
// within this range a column is exactly one screen-share wide, so "fits" only
// flips once as the font grows — safe to bisect.
function largestFittingFont(cols, lo, hi) {
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const { vw, total } = perfLayoutCore(cols, mid);
    if (total <= vw + 2) { best = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return best;
}

// Pick the column count and font that show the whole song on one screen at the
// biggest readable size. Fewer columns are wider, so lines can carry a bigger
// font before they'd clip; more columns buy vertical room. Which wins depends on
// the song's shape, so try each count and keep the roomiest result.
function perfBestFit() {
  if (pf.viewport.clientWidth <= 0) return null;
  let best = null;
  for (let cols = 1; cols <= PF_FIT_MAX_COLS; cols++) {
    // The widest line caps the font for this count, and that cap only shrinks as
    // columns narrow — once it can't beat the incumbent, no later count can.
    const cap = fontForCols(cols);
    if (best && cap <= best.font) break;
    const f = largestFittingFont(cols, best ? best.font + 1 : PF_FONT_MIN, cap);
    if (f) best = { cols, font: f };
  }
  return best;
}

// Fit the current song to the screen. A song too long to fit at even the
// smallest font falls back to the old width-only sizing, and pages sideways.
function perfAutoFit() {
  if (!perf.open || pfPhone()) return;
  const best = perfBestFit();
  if (!best) { perfAutoFont(); return; }
  prefs.perform.cols = best.cols;
  prefs.perform.font = best.font;
  pf.colNum.textContent = best.cols;
  pf.fontNum.textContent = best.font;
  savePrefs();
  applyPerfLayout();
}

function setPerfAutoFit(on) {
  prefs.perform.autoFit = on;
  savePrefs();
  document.getElementById('pf-fit').classList.toggle('on', on);
  if (on) perfAutoFit();
}

// On a phone performance mode is a single scrolling column of wrapped lines
// rather than horizontally paged sheet-music columns.
function pfPhone() { return window.matchMedia('(max-width: 760px)').matches; }

function applyPerfLayout() {
  if (!perf.open) return;
  if (pfPhone()) {
    // One column, no paging: just set the font and let the viewport scroll.
    pf.cols.style.transform = '';
    pf.cols.style.columnWidth = 'auto';
    pf.cols.style.setProperty('--pf-font', prefs.perform.font + 'px');
    perf.pages = 1;
    pf.pageLabel.textContent = '';
    return;
  }
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
  if (prefs.perform.autoFit) perfAutoFit(); // every song gets its own best size
}

// ---- Auto-advance (hands-free) ---------------------------------------------
function perfAtEnd() {
  if (perf.page < perf.pages - 1) return false;
  const list = perfSetlist();
  return list.findIndex((x) => x.id === currentId) >= list.length - 1;
}
function updateAutoBtn() {
  const b = document.getElementById('pf-auto');
  if (b) b.innerHTML = perf.auto ? '&#10074;&#10074;' : '&#9654;'; // pause : play
}
function startAuto() {
  clearInterval(perf.autoTimer);
  perf.auto = true;
  updateAutoBtn();
  perf.autoTimer = setInterval(() => {
    if (perfAtEnd()) { stopAuto(); return; }
    perfForward();
  }, (prefs.perform.autoSecs || 25) * 1000);
}
function stopAuto() {
  perf.auto = false;
  clearInterval(perf.autoTimer);
  updateAutoBtn();
}
function setAutoSecs(delta) {
  prefs.perform.autoSecs = Math.max(5, Math.min(120, (prefs.perform.autoSecs || 25) + delta));
  savePrefs();
  const el2 = document.getElementById('pf-auto-secs');
  if (el2) el2.textContent = prefs.perform.autoSecs;
  if (perf.auto) startAuto(); // restart with the new interval
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
  pf.bar.querySelectorAll('.pf-toggle[data-panel]').forEach((b) => {
    b.classList.toggle('on', !!prefs.perform.panels[b.dataset.panel]);
  });
  document.getElementById('pf-fit').classList.toggle('on', !!prefs.perform.autoFit);
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

// Reaching for a stepper is an explicit override, so it drops out of auto-fit
// rather than having the next song silently undo the adjustment.
function setPerfCols(d) {
  if (prefs.perform.autoFit) setPerfAutoFit(false);
  prefs.perform.cols = Math.max(1, Math.min(10, prefs.perform.cols + d));
  pf.colNum.textContent = prefs.perform.cols;
  perfAutoFont(); // size the text to the new column count (also saves + re-lays)
}
function setPerfFont(d) {
  if (prefs.perform.autoFit) setPerfAutoFit(false);
  prefs.perform.font = Math.max(PF_FONT_MIN, Math.min(80, prefs.perform.font + d));
  pf.fontNum.textContent = prefs.perform.font;
  savePrefs();
  applyPerfLayout();
}

document.getElementById('perform-btn').addEventListener('click', () => { perf.setlist = null; openPerform(); });
// ---- Phone performance auto-scroll ----------------------------------------
// Scrolls the lyric column at a steady px/second so hands stay on the guitar.
// Fractional pixels are accumulated so slow speeds still move smoothly.
const pfScroll = { on: false, raf: null, last: 0, carry: 0 };

function paintScrollBtn() {
  const b = document.getElementById('pf-scroll-play');
  if (b) b.innerHTML = pfScroll.on ? '&#10074;&#10074;' : '&#9654;'; // pause : play
}

function stopPfScroll() {
  pfScroll.on = false;
  if (pfScroll.raf) cancelAnimationFrame(pfScroll.raf);
  pfScroll.raf = null;
  paintScrollBtn();
}

function startPfScroll() {
  if (pfScroll.on) return;
  pfScroll.on = true;
  pfScroll.last = performance.now();
  pfScroll.carry = 0;
  paintScrollBtn();
  const step = (now) => {
    if (!pfScroll.on) return;
    const dt = (now - pfScroll.last) / 1000;
    pfScroll.last = now;
    pfScroll.carry += (prefs.perform.scrollSpeed || 30) * dt;
    const whole = Math.floor(pfScroll.carry);
    if (whole > 0) {
      pfScroll.carry -= whole;
      const v = pf.viewport;
      v.scrollTop += whole;
      if (v.scrollTop + v.clientHeight >= v.scrollHeight - 1) { stopPfScroll(); return; } // hit the end
    }
    pfScroll.raf = requestAnimationFrame(step);
  };
  pfScroll.raf = requestAnimationFrame(step);
}

function setScrollSpeed(d) {
  const cur = prefs.perform.scrollSpeed || 30;
  prefs.perform.scrollSpeed = Math.max(5, Math.min(200, cur + d));
  document.getElementById('pf-scroll-speed').textContent = prefs.perform.scrollSpeed;
  savePrefs();
}

document.getElementById('pf-scroll-play').addEventListener('click', () => (pfScroll.on ? stopPfScroll() : startPfScroll()));
document.getElementById('pf-scroll-slower').addEventListener('click', () => setScrollSpeed(-5));
document.getElementById('pf-scroll-faster').addEventListener('click', () => setScrollSpeed(5));

document.getElementById('pf-exit').addEventListener('click', closePerform);
document.getElementById('pf-auto').addEventListener('click', () => (perf.auto ? stopAuto() : startAuto()));
document.getElementById('pf-auto-slower').addEventListener('click', () => setAutoSecs(5));
document.getElementById('pf-auto-faster').addEventListener('click', () => setAutoSecs(-5));
document.getElementById('pf-col-up').addEventListener('click', () => setPerfCols(1));
document.getElementById('pf-col-down').addEventListener('click', () => setPerfCols(-1));
document.getElementById('pf-font-up').addEventListener('click', () => setPerfFont(1));
document.getElementById('pf-font-down').addEventListener('click', () => setPerfFont(-1));
document.getElementById('pf-fit').addEventListener('click', () => setPerfAutoFit(!prefs.perform.autoFit));
document.getElementById('pf-prev-song').addEventListener('click', () => perfChangeSong(-1));
document.getElementById('pf-next-song').addEventListener('click', () => perfChangeSong(1));
pf.bar.querySelectorAll('.pf-toggle[data-panel]').forEach((b) => b.addEventListener('click', () => {
  const k = b.dataset.panel;
  prefs.perform.panels[k] = !prefs.perform.panels[k];
  savePrefs();
  syncPerfToggles();
  applyPerfPanels();
  if (prefs.perform.autoFit) perfAutoFit(); // panels changed the room to fit into
}));
// Re-fitting is a burst of measurements, so let a drag settle before redoing it.
let pfResizeTimer = null;
window.addEventListener('resize', () => {
  if (!perf.open) return;
  applyPerfLayout();
  if (!prefs.perform.autoFit || pfPhone()) return;
  clearTimeout(pfResizeTimer);
  pfResizeTimer = setTimeout(() => { if (perf.open) perfAutoFit(); }, 150);
});

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
// Readings are measured against the strings of the chosen tuning, not against
// the nearest chromatic note: half a semitone flat on the low E is "tighten the
// 6th string", not "you played a D#, which is nicely in tune".
const tuner = {
  ctx: null, stream: null, analyser: null, buf: null, raf: null, on: false, preset: 'standard',
  pinned: null,    // string index the user picked by hand, or null to auto-pick
  hist: [],        // recent cent readings, for the median smoother
  lastTarget: null,// which string those readings belong to
  done: new Set(), // strings brought in tune since Start, for the ✓ marks
  lastHeard: 0,    // timestamp of the last usable pitch
};

// The green band on the meter covers exactly this, so "needle in the green" and
// the words underneath always agree.
const TUNE_IN_CENTS = 5;
const CENTS_WINDOW = 5;      // frames in the median smoother
const IDLE_MS = 1500;        // silence before the readout dims and asks for a note
const WRONG_STRING_CENTS = 250; // past this, a pinned string is hearing a different one
// The meter spans a full semitone either way, so a string that's badly out looks
// badly out instead of pegging at the end of a ±50¢ scale.
const METER_RANGE = 100;

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

// "E2" → 82.41 Hz.
function noteToFreq(spec) {
  const m = /^([A-G]#?)(-?\d+)$/.exec(spec);
  if (!m) return 0;
  const midi = NOTE_NAMES_SHARP.indexOf(m[1]) + 12 * (Number(m[2]) + 1);
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// The current tuning's target pitches, low → high, with any sweetening applied.
// Strings are numbered the way a player counts them: the low string is the 6th.
let tunerTargetCache = { preset: null, list: [] };
function tunerTargets() {
  if (tunerTargetCache.preset !== tuner.preset) {
    const strings = TUNER_PRESETS[tuner.preset].strings;
    tunerTargetCache = {
      preset: tuner.preset,
      list: strings.map(([note, offset], i) => ({
        i,
        note,
        label: note.replace(/[0-9]/g, ''),
        number: strings.length - i,
        offset,
        hz: noteToFreq(note) * Math.pow(2, offset / 1200),
      })),
    };
  }
  return tunerTargetCache.list;
}

function centsFrom(freq, targetHz) { return 1200 * Math.log2(freq / targetHz); }

// The string this reading is measured against: the pinned one if you've picked
// one, else whichever target is closest right now. Re-read every frame, so the
// tuner always follows whatever you're actually playing.
function tunerTargetFor(freq) {
  const list = tunerTargets();
  if (tuner.pinned != null && list[tuner.pinned]) {
    const t = list[tuner.pinned];
    return { t, cents: centsFrom(freq, t.hz) };
  }
  let best = null;
  for (const t of list) {
    const cents = centsFrom(freq, t.hz);
    if (!best || Math.abs(cents) < Math.abs(best.cents)) best = { t, cents };
  }
  return best;
}

// Where a reading sits on the meter, as a percentage across it.
function meterPos(cents) {
  return 50 + Math.max(-METER_RANGE, Math.min(METER_RANGE, cents)) / METER_RANGE * 50;
}

// Forget the current reading, so the next note heard starts a fresh average.
function resetTunerReading() {
  tuner.hist.length = 0;
  tuner.lastTarget = null;
}

// A median over the last few frames: one bad autocorrelation frame can't yank
// the reading, and the number stops flickering between neighbouring values.
function smoothCents(c) {
  tuner.hist.push(c);
  if (tuner.hist.length > CENTS_WINDOW) tuner.hist.shift();
  return [...tuner.hist].sort((a, b) => a - b)[tuner.hist.length >> 1];
}

// The single source of the verdict: the number, the flat/sharp word and the
// instruction all come from here, so they can never contradict each other.
function tuneAdvice(cents) {
  const off = Math.round(cents);
  if (Math.abs(off) <= TUNE_IN_CENTS) return { inTune: true, text: 'In tune — hold it' };
  const flat = off < 0;
  const amount = Math.abs(off);
  const how = amount > 40 ? ' a lot' : amount > 15 ? '' : ' a touch';
  return {
    inTune: false,
    text: `${flat ? 'Tighten' : 'Loosen'}${how} — ${amount}¢ ${flat ? 'flat' : 'sharp'}`,
  };
}

async function tunerStart() {
  const adviceEl = document.getElementById('tuner-advice');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    adviceEl.textContent = 'Microphone not available in this browser.';
    return;
  }
  // The permission prompt can sit there for a while; say what we're waiting on
  // rather than leaving the last reading up as if it were live.
  adviceEl.textContent = 'Waiting for the microphone…';
  adviceEl.className = 'tuner-advice';
  try {
    tuner.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch {
    adviceEl.textContent = 'Microphone access was denied.';
    return;
  }
  tuner.ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = tuner.ctx.createMediaStreamSource(tuner.stream);
  tuner.analyser = tuner.ctx.createAnalyser();
  tuner.analyser.fftSize = 2048;
  tuner.buf = new Float32Array(tuner.analyser.fftSize);
  src.connect(tuner.analyser);
  tuner.on = true;
  resetTunerReading();
  tuner.done.clear();
  tuner.lastHeard = 0;
  const b = document.getElementById('tuner-toggle');
  b.textContent = 'Stop'; b.classList.add('on');
  adviceEl.textContent = 'Play one string';
  adviceEl.className = 'tuner-advice';
  paintTunerStrings();
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
  const freqEl = document.getElementById('tuner-freq');
  const adviceEl = document.getElementById('tuner-advice');
  const readout = document.getElementById('tuner-readout');
  const needle = document.getElementById('tuner-needle');

  if (freq < 25 || freq > 5000) {
    // Notes decay, so hold the last reading for a moment — you need to look at
    // the peg, not the screen — then fall back to the prompt.
    if (performance.now() - tuner.lastHeard > IDLE_MS) {
      readout.classList.add('idle');
      resetTunerReading();
      adviceEl.textContent = tuner.pinned != null
        ? `Play the ${tunerTargets()[tuner.pinned].number}${ordSuffix(tunerTargets()[tuner.pinned].number)} string`
        : 'Play one string';
      adviceEl.className = 'tuner-advice';
      setMeterOffscale(0);
    }
    return;
  }

  tuner.lastHeard = performance.now();
  readout.classList.remove('idle');
  const { t, cents } = tunerTargetFor(freq);
  // A new string starts a new average — otherwise the old string's readings drag
  // the first frames of the new one.
  if (tuner.lastTarget !== t.i) { tuner.hist.length = 0; tuner.lastTarget = t.i; }
  const smoothed = smoothCents(cents);
  // Pinned to one string but hearing a different one: "502¢ sharp" is a true
  // number and useless advice. Name the string to play instead.
  const wrongString = tuner.pinned != null && Math.abs(smoothed) > WRONG_STRING_CENTS;
  const advice = wrongString
    ? { inTune: false, text: `Play the ${t.number}${ordSuffix(t.number)} string` }
    : tuneAdvice(smoothed);
  if (advice.inTune) tuner.done.add(t.i);

  noteEl.textContent = t.label + ' · ' + t.number + ordSuffix(t.number);
  freqEl.innerHTML = `${freq.toFixed(1)} Hz <span class="tf-arrow">→</span> <b>${t.hz.toFixed(2)} Hz</b>` +
    (t.offset ? ` <span class="tf-sweet">(${t.offset > 0 ? '+' : ''}${t.offset}¢ sweetened)</span>` : '');
  adviceEl.textContent = advice.text;
  adviceEl.className = 'tuner-advice ' +
    (wrongString ? '' : advice.inTune ? 'is-in-tune' : smoothed < 0 ? 'is-flat' : 'is-sharp');
  needle.style.left = meterPos(smoothed) + '%';
  needle.classList.toggle('in-tune', advice.inTune);
  noteEl.classList.toggle('in-tune', advice.inTune);
  // Further out than the meter can draw: point the way rather than just pegging.
  setMeterOffscale(Math.abs(smoothed) > METER_RANGE ? Math.sign(smoothed) : 0);
  paintTunerStrings(t.i, advice.inTune);
}

// -1 = off the flat end, +1 = off the sharp end, 0 = on the scale.
function setMeterOffscale(dir) {
  document.getElementById('tuner-off-flat').classList.toggle('show', dir < 0);
  document.getElementById('tuner-off-sharp').classList.toggle('show', dir > 0);
}

function ordSuffix(n) { return n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'; }
function tunerStop() {
  tuner.on = false;
  if (tuner.raf) cancelAnimationFrame(tuner.raf);
  if (tuner.stream) tuner.stream.getTracks().forEach((t) => t.stop());
  if (tuner.ctx) tuner.ctx.close();
  tuner.ctx = null;
  const b = document.getElementById('tuner-toggle');
  b.textContent = 'Start'; b.classList.remove('on');
  resetTunerReading();
  tuner.done.clear();
  const noteEl = document.getElementById('tuner-note');
  noteEl.textContent = '—';
  noteEl.classList.remove('in-tune');
  document.getElementById('tuner-freq').textContent = 'Play one string';
  document.getElementById('tuner-readout').classList.remove('idle');
  const adviceEl = document.getElementById('tuner-advice');
  adviceEl.textContent = 'Press Start, then play one string.';
  adviceEl.className = 'tuner-advice';
  document.getElementById('tuner-needle').style.left = '50%';
  document.getElementById('tuner-needle').classList.remove('in-tune');
  setMeterOffscale(0);
  paintTunerStrings();
}

// ---- Capture (record takes from an audio interface) ------------------------
// A jam throws off ideas faster than anyone writes them down, so recording has
// to be one key away and must never stop to ask a question. Takes land on the
// song that's open; with nothing open they go to an unfiled bin to sort later.

// Takes live in their own database rather than the `gtw` kv store, so adding
// this can't disturb the schema that holds the folder handles.
const TAKES_IDB = { name: 'gtw-takes', store: 'takes' };
function takesReq(fn) {
  return new Promise((resolve) => {
    const open = indexedDB.open(TAKES_IDB.name, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(TAKES_IDB.store, { keyPath: 'id' });
    open.onerror = () => resolve(null);
    open.onsuccess = () => { try { fn(open.result, resolve); } catch { resolve(null); } };
  });
}
function takesPut(rec) {
  return takesReq((db, resolve) => {
    const tx = db.transaction(TAKES_IDB.store, 'readwrite');
    tx.objectStore(TAKES_IDB.store).put(rec);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}
function takesAll() {
  return takesReq((db, resolve) => {
    const r = db.transaction(TAKES_IDB.store).objectStore(TAKES_IDB.store).getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => resolve([]);
  });
}
function takesDelete(id) {
  return takesReq((db, resolve) => {
    const tx = db.transaction(TAKES_IDB.store, 'readwrite');
    tx.objectStore(TAKES_IDB.store).delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

// The recorder runs off an AudioWorklet rather than MediaRecorder for WAV,
// because MediaRecorder has no uncompressed format. The worklet just hands
// every block to the main thread — the input buffers are recycled the moment
// process() returns, so they have to be copied.
const CAPTURE_WORKLET_SRC = `
class CaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input.length) {
      const copy = [];
      for (let c = 0; c < input.length; c++) copy.push(new Float32Array(input[c]));
      this.port.postMessage(copy);
    }
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
`;

const cap = {
  on: false, stream: null, ctx: null, src: null, node: null, analyser: null,
  recorder: null, chunks: [], pcm: [], frames: 0, channels: 2, rate: 48000,
  startedAt: 0, timer: null, levelRaf: null, songKey: null, songTitle: '',
  workletUrl: null, devicesLoaded: false,
};

function capEl(id) { return document.getElementById(id); }

// Interleave to 16-bit as blocks arrive: half the memory of keeping float32,
// and the conversion has to happen anyway.
function capPushPcm(chans) {
  const n = chans[0].length, ch = chans.length;
  const out = new Int16Array(n * ch);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      let v = chans[c][i];
      v = v < -1 ? -1 : v > 1 ? 1 : v;
      out[i * ch + c] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
  }
  cap.pcm.push(out);
  cap.frames += n;
}

// Standard 44-byte canonical WAV header, then the interleaved PCM.
function encodeWav(chunks, frames, channels, sampleRate) {
  const dataBytes = frames * channels * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);        // PCM fmt chunk size
  view.setUint16(20, 1, true);         // format = PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true); // byte rate
  view.setUint16(32, channels * 2, true);              // block align
  view.setUint16(34, 16, true);        // bits per sample
  str(36, 'data');
  view.setUint32(40, dataBytes, true);
  let off = 44;
  for (const c of chunks) {
    new Int16Array(buf, off, c.length).set(c);
    off += c.length * 2;
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// Device labels stay blank until mic permission has been granted once, so the
// list is only meaningful after the first successful getUserMedia.
async function capLoadDevices() {
  const sel = capEl('cap-device');
  if (!sel || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  let devs = [];
  try { devs = await navigator.mediaDevices.enumerateDevices(); } catch { return; }
  const inputs = devs.filter((d) => d.kind === 'audioinput');
  const named = inputs.some((d) => d.label);
  cap.devicesLoaded = named;
  const want = prefs.capture.deviceId || '';
  sel.innerHTML = '<option value="">Default input</option>' + inputs.map((d, i) =>
    `<option value="${escapeHtml(d.deviceId)}">${escapeHtml(d.label || 'Input ' + (i + 1))}</option>`).join('');
  // Keep the remembered choice selected if that interface is still plugged in.
  if (want && inputs.some((d) => d.deviceId === want)) sel.value = want;
  else if (want) capSetStatus(`${prefs.capture.deviceLabel || 'Saved input'} isn't connected — using the default.`);
  if (!named) capSetStatus('Allow microphone access once and your interfaces will be listed by name.');
}

function capSetStatus(msg) {
  const el2 = capEl('cap-status');
  if (el2) el2.textContent = msg;
}

function capFmtTime(ms) {
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

async function captureStart() {
  if (cap.on) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    capSetStatus('This browser can’t record audio.');
    return;
  }
  const audio = {
    // An instrument is not a voice: every "helpful" processing stage would
    // wreck the take. Same reasoning as the tuner.
    echoCancellation: false, noiseSuppression: false, autoGainControl: false,
    channelCount: 2,
  };
  const wanted = prefs.capture.deviceId;
  try {
    cap.stream = await navigator.mediaDevices.getUserMedia({
      audio: wanted ? Object.assign({ deviceId: { exact: wanted } }, audio) : audio,
    });
  } catch (e) {
    // An unplugged interface makes the exact-deviceId request fail outright;
    // fall back to the default input rather than dropping the take.
    if (wanted) {
      try { cap.stream = await navigator.mediaDevices.getUserMedia({ audio }); }
      catch { capSetStatus('Couldn’t open an input — check the interface and permissions.'); return; }
      capSetStatus('Saved input unavailable — recording from the default input.');
    } else {
      capSetStatus('Microphone access was denied.');
      return;
    }
  }

  const track = cap.stream.getAudioTracks()[0];
  const settings = track ? track.getSettings() : {};
  cap.ctx = new (window.AudioContext || window.webkitAudioContext)();
  cap.rate = cap.ctx.sampleRate;
  cap.channels = Math.max(1, Math.min(2, settings.channelCount || 2));
  cap.src = cap.ctx.createMediaStreamSource(cap.stream);
  cap.analyser = cap.ctx.createAnalyser();
  cap.analyser.fftSize = 1024;
  cap.src.connect(cap.analyser);

  cap.pcm = [];
  cap.chunks = [];
  cap.frames = 0;

  if (prefs.capture.format === 'wav') {
    try {
      if (!cap.workletUrl) {
        cap.workletUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET_SRC], { type: 'application/javascript' }));
      }
      await cap.ctx.audioWorklet.addModule(cap.workletUrl);
      cap.node = new AudioWorkletNode(cap.ctx, 'capture-processor', { numberOfInputs: 1, numberOfOutputs: 0 });
      cap.node.port.onmessage = (e) => { if (cap.on) capPushPcm(e.data); };
      cap.src.connect(cap.node);
    } catch {
      capSetStatus('Uncompressed capture isn’t available here — recording Opus instead.');
      prefs.capture.format = 'opus';
      capEl('cap-format').value = 'opus';
      savePrefs();
    }
  }
  if (prefs.capture.format === 'opus') {
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
    cap.recorder = new MediaRecorder(cap.stream, mime ? { mimeType: mime } : undefined);
    cap.recorder.ondataavailable = (e) => { if (e.data && e.data.size) cap.chunks.push(e.data); };
    cap.recorder.start(1000);
  }

  // Which song this belongs to is fixed at the downbeat, so switching songs
  // while it rolls can't re-file the take underneath you.
  const s = currentSong();
  cap.songKey = s ? songKey(s) : null;
  cap.songTitle = s ? (s.title || 'Untitled') : '';
  cap.on = true;
  cap.startedAt = Date.now();
  capPaintTransport();
  capSetStatus(s ? `Recording to “${cap.songTitle}”…` : 'Recording — this take will be unfiled.');
  cap.timer = setInterval(capTick, 200);
  capLevelLoop();
  // Names only appear once permission exists; the first take unlocks the list.
  if (!cap.devicesLoaded) capLoadDevices();
}

function capTick() {
  if (!cap.on) return;
  const t = capFmtTime(Date.now() - cap.startedAt);
  const a = capEl('cap-time'), b = capEl('cap-indicator-time');
  if (a) a.textContent = t;
  if (b) b.textContent = t;
}

function capLevelLoop() {
  if (!cap.analyser) return;
  const buf = new Float32Array(cap.analyser.fftSize);
  const step = () => {
    if (!cap.analyser) return;
    cap.analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    // Roughly -60dB..0dB across the bar, so quiet playing still moves it.
    const pct = Math.max(0, Math.min(100, (20 * Math.log10(rms || 1e-8) + 60) / 60 * 100));
    const fill = capEl('cap-meter-fill');
    if (fill) fill.style.width = pct.toFixed(1) + '%';
    cap.levelRaf = requestAnimationFrame(step);
  };
  step();
}

async function captureStop() {
  if (!cap.on) return;
  cap.on = false;
  clearInterval(cap.timer);
  if (cap.levelRaf) cancelAnimationFrame(cap.levelRaf);
  const durMs = Date.now() - cap.startedAt;

  let blob = null, ext = 'wav';
  if (cap.recorder) {
    const rec = cap.recorder;
    blob = await new Promise((resolve) => {
      rec.onstop = () => resolve(new Blob(cap.chunks, { type: rec.mimeType || 'audio/webm' }));
      rec.stop();
    });
    ext = (rec.mimeType || '').includes('mp4') ? 'm4a' : 'webm';
  } else {
    blob = encodeWav(cap.pcm, cap.frames, cap.channels, cap.rate);
    ext = 'wav';
  }

  const songKeyAtStart = cap.songKey, songTitleAtStart = cap.songTitle;
  capTeardown();
  capPaintTransport();

  if (!blob || blob.size < 1024) { capSetStatus('Nothing was captured — check the input level.'); return; }

  const take = {
    id: 't' + Date.now().toString(36) + Math.floor(performance.now() % 1000).toString(36),
    songKey: songKeyAtStart,
    songTitle: songTitleAtStart,
    ts: Date.now(),
    durMs,
    ext,
    mime: blob.type,
    name: capTakeName(songTitleAtStart, ext),
    blob,
  };
  await takesPut(take);
  const wrote = await capWriteToDisk(take);
  capSetStatus(wrote
    ? `Saved ${take.name} — also written next to the chart.`
    : `Saved ${take.name}.`);
  renderTakes();
}

function capTeardown() {
  if (cap.node) { try { cap.node.port.onmessage = null; cap.node.disconnect(); } catch { /* gone */ } }
  if (cap.src) { try { cap.src.disconnect(); } catch { /* gone */ } }
  if (cap.stream) cap.stream.getTracks().forEach((t) => t.stop());
  if (cap.ctx) { try { cap.ctx.close(); } catch { /* already closed */ } }
  cap.node = cap.src = cap.analyser = cap.ctx = cap.stream = cap.recorder = null;
  cap.pcm = []; cap.chunks = []; cap.frames = 0;
  const fill = capEl('cap-meter-fill');
  if (fill) fill.style.width = '0%';
}

function capTakeName(title, ext) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const base = (title || 'unfiled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'take';
  return `${base}-${stamp}.${ext}`;
}

// In folder mode the take is also written beside the chart, so it's a real file
// in the same folder you already sync or commit — no export step to remember.
async function capWriteToDisk(take) {
  if (mode !== 'folder' || !take.songKey || !take.songKey.startsWith('lib:')) return false;
  const s = resolveKey(take.songKey);
  if (!s || !s.libId) return false;
  const lib = libraries.find((l) => l.id === s.libId);
  if (!lib || !lib.handle) return false;
  try {
    const sub = (s.path || '').split('/').slice(0, -1).join('/');
    const dir = await resolveDir(lib, sub, true);
    const fh = await dir.getFileHandle(take.name, { create: true });
    const w = await fh.createWritable();
    await w.write(take.blob);
    await w.close();
    return true;
  } catch {
    return false; // permission lapsed or the folder moved — the app copy stands
  }
}

// Fullscreen paints only the fullscreen element's own subtree, so while
// performance mode is up the indicator has to live inside the overlay or it
// isn't drawn at all — z-index can't reach across that boundary.
function capReparentIndicator() {
  const ind = capEl('cap-indicator');
  if (!ind) return;
  const host = document.fullscreenElement || document.body;
  if (ind.parentElement !== host) host.appendChild(ind);
}
document.addEventListener('fullscreenchange', capReparentIndicator);

function capPaintTransport() {
  capReparentIndicator();
  const b = capEl('cap-toggle');
  if (b) {
    b.innerHTML = cap.on ? '&#9632; Stop' : '&#9679; Record';
    b.classList.toggle('on', cap.on);
  }
  const ind = capEl('cap-indicator');
  if (ind) ind.hidden = !cap.on;
  const btn = document.getElementById('capture-btn');
  if (btn) btn.classList.toggle('recording', cap.on);
  if (!cap.on) {
    const t = capEl('cap-time');
    if (t) t.textContent = '0:00';
  }
}

function captureToggle() { return cap.on ? captureStop() : captureStart(); }

// ---- Takes list ------------------------------------------------------------
let takeUrls = [];   // object URLs to revoke on the next render

async function renderTakes() {
  const box = capEl('cap-takes');
  if (!box) return;
  takeUrls.forEach((u) => URL.revokeObjectURL(u));
  takeUrls = [];
  const all = (await takesAll()).sort((a, b) => b.ts - a.ts);
  const cur = currentSong();
  const curKey = cur ? songKey(cur) : null;
  const mine = all.filter((t) => t.songKey && t.songKey === curKey);
  const unfiled = all.filter((t) => !t.songKey);
  const countEl = capEl('cap-takes-count');
  if (countEl) countEl.textContent = all.length ? `${all.length} total` : '';

  const row = (t) => {
    const url = URL.createObjectURL(t.blob);
    takeUrls.push(url);
    const when = new Date(t.ts);
    const clock = String(when.getHours()).padStart(2, '0') + ':' + String(when.getMinutes()).padStart(2, '0');
    return `<div class="cap-take" data-id="${t.id}">` +
      `<audio controls preload="none" src="${url}"></audio>` +
      `<div class="cap-take-meta"><span class="cap-take-name" title="${escapeHtml(t.name)}">${escapeHtml(t.name)}</span>` +
      `<span class="cap-take-sub">${capFmtTime(t.durMs)} · ${clock} · ${(t.blob.size / 1048576).toFixed(1)} MB</span></div>` +
      `<div class="cap-take-tools">` +
      (t.songKey ? '' : `<button class="cap-file" data-id="${t.id}" title="File this take under the current song"${cur ? '' : ' disabled'}>File</button>`) +
      `<a class="cap-dl" href="${url}" download="${escapeHtml(t.name)}" title="Download">&#8595;</a>` +
      `<button class="cap-del" data-id="${t.id}" title="Delete this take">&#10005;</button></div></div>`;
  };

  let html = '';
  if (cur) {
    html += `<div class="cap-group">${escapeHtml(cur.title || 'Untitled')}</div>`;
    html += mine.length ? mine.map(row).join('') : '<div class="cap-empty">No takes for this song yet.</div>';
  }
  if (unfiled.length) {
    html += `<div class="cap-group">Unfiled</div>` + unfiled.map(row).join('');
  }
  if (!cur && !unfiled.length) html = '<div class="cap-empty">No takes yet. Hit Record.</div>';
  box.innerHTML = html;

  box.querySelectorAll('.cap-del').forEach((b) => b.addEventListener('click', async () => {
    await takesDelete(b.dataset.id);
    renderTakes();
  }));
  box.querySelectorAll('.cap-file').forEach((b) => b.addEventListener('click', async () => {
    const s = currentSong();
    if (!s) return;
    const all2 = await takesAll();
    const t = all2.find((x) => x.id === b.dataset.id);
    if (!t) return;
    t.songKey = songKey(s);
    t.songTitle = s.title || 'Untitled';
    await takesPut(t);
    await capWriteToDisk(t);
    renderTakes();
  }));
}

// ---- Dictation (speak lyrics into the editor) ------------------------------
// Strictly on-device: processLocally is never relaxed, so audio doesn't leave
// the machine and this keeps the app's "everything runs locally" promise. The
// cost is that the feature only exists where the local model does.
// Note the API offers no input selection at all — no deviceId, no stream — so
// it always listens to the system default input, not the Record panel's choice.

const SRec = window.SpeechRecognition || window.webkitSpeechRecognition;

const dict = { on: false, rec: null, lang: 'en-US', modelState: 'unknown', installing: false, showInstall: false };

// Whole-utterance commands only. "chorus" on its own is a section marker; "the
// chorus of angels" is a lyric, and matching on substrings would wreck it.
const DICT_SECTIONS = [
  [/^(new |next )?verse$/, 'verse'],
  [/^(new )?chorus$/, 'Chorus'],
  [/^(new )?bridge$/, 'Bridge'],
  [/^(new )?intro$/, 'Intro'],
  [/^(new )?outro$/, 'Outro'],
  [/^(new )?(pre.?chorus)$/, 'Pre-Chorus'],
  [/^(new )?solo$/, 'Solo'],
  [/^(new )?refrain$/, 'Refrain'],
];
const DICT_BREAKS = [
  [/^(new line|line break|next line)$/, '\n'],
  [/^(new paragraph|blank line|new section)$/, '\n\n'],
];

function dictNormalize(s) {
  return s.toLowerCase().replace(/[.,!?;:"'’]/g, '').replace(/\s+/g, ' ').trim();
}

// Verses number themselves off what's already written, so "new verse" three
// times running gives 1, 2, 3 rather than three identical labels.
function dictNextVerse() {
  const body = el.editor.value;
  let max = 0;
  for (const m of body.matchAll(/[{[]\s*verse\s*(\d+)\s*[}\]]/gi)) max = Math.max(max, +m[1]);
  return max + 1;
}

function dictCommandFor(text) {
  const n = dictNormalize(text);
  for (const [re, label] of DICT_SECTIONS) {
    if (re.test(n)) return { kind: 'section', text: label === 'verse' ? `{Verse ${dictNextVerse()}}` : `{${label}}` };
  }
  for (const [re, out] of DICT_BREAKS) if (re.test(n)) return { kind: 'break', text: out };
  return null;
}

// execCommand keeps the textarea's native undo stack alive, so Cmd+Z still
// steps back through dictated text like anything else typed.
function dictInsert(text) {
  const ta = el.editor;
  ta.focus();
  let ok = false;
  try { ok = document.execCommand('insertText', false, text); } catch { ok = false; }
  if (!ok) {
    const a = ta.selectionStart, b = ta.selectionEnd;
    ta.value = ta.value.slice(0, a) + text + ta.value.slice(b);
    ta.selectionStart = ta.selectionEnd = a + text.length;
  }
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

// A spoken line becomes its own lyric line; sections get a blank line above.
function dictCommit(raw) {
  const cmd = dictCommandFor(raw);
  const ta = el.editor;
  const before = ta.value.slice(0, ta.selectionStart);
  const atLineStart = before === '' || before.endsWith('\n');
  if (cmd) {
    if (cmd.kind === 'break') { dictInsert(cmd.text); return; }
    let pre = '';
    if (!atLineStart) pre = '\n';
    if (!/\n\n$/.test(before + pre) && before !== '') pre += '\n';
    dictInsert(pre + cmd.text + '\n');
    return;
  }
  const words = raw.trim();
  if (!words) return;
  dictInsert((atLineStart ? '' : '\n') + words);
}

// Bias the recognizer toward this song's own vocabulary — names and coinages
// are exactly what a general model gets wrong, and they're already on screen.
function dictPhrases() {
  const s = currentSong();
  if (!s) return [];
  const seen = new Set(), out = [];
  const add = (t, boost) => {
    const k = t.toLowerCase();
    if (!t || k.length < 3 || seen.has(k) || out.length >= 60) return;
    seen.add(k);
    try { out.push(new SpeechRecognitionPhrase(t, boost)); } catch { /* older build */ }
  };
  if (s.title) { add(s.title, 3.0); s.title.split(/\s+/).forEach((w) => add(w, 2.0)); }
  if (s.artist) s.artist.split(/\s+/).forEach((w) => add(w, 2.0));
  // Uncommon words already in the lyrics: capitalised or simply rare-looking.
  const body = s.body.replace(/\[[^\]]*\]/g, ' ').replace(/\{[^}]*\}/g, ' ');
  for (const w of body.match(/\b[A-Z][a-z']{2,}\b/g) || []) add(w, 2.0);
  return out;
}

async function dictRefreshModel() {
  if (!SRec || !SRec.available) { dict.modelState = 'unsupported'; dictPaint(); return; }
  try {
    dict.modelState = await SRec.available({ langs: [dict.lang], processLocally: true });
  } catch { dict.modelState = 'unavailable'; }
  dictPaint();
}

async function dictInstallModel() {
  if (dict.installing || !SRec || !SRec.install) return;
  dict.installing = true;
  dictPaint();
  try {
    await SRec.install({ langs: [dict.lang], processLocally: true });
  } catch { /* surfaced by the state below */ }
  dict.installing = false;
  await dictRefreshModel();
}

function dictStart() {
  if (dict.on || !SRec) return;
  // Dictation writes at the caret in the editor, which isn't on screen during
  // performance mode — starting there would quietly edit the song you're playing
  // from, with no visible sign of it.
  if (typeof perf !== 'undefined' && perf.open) return;
  // Not installed yet: reveal the offer rather than silently doing nothing. The
  // prompt only appears once you've asked for dictation, so it isn't clutter
  // for anyone who never uses it.
  if (dict.modelState !== 'available') {
    dict.showInstall = true;
    dictPaint();
    dictRefreshModel();
    return;
  }
  dict.showInstall = false;
  const rec = new SRec();
  rec.lang = dict.lang;
  rec.continuous = true;
  rec.interimResults = true;
  try { rec.processLocally = true; } catch { /* older build: dictStart is gated above */ }
  try { rec.phrases = dictPhrases(); } catch { /* biasing is a bonus, not required */ }

  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) dictCommit(r[0].transcript);
      else interim += r[0].transcript;
    }
    dictSetInterim(interim);
  };
  rec.onerror = (e) => {
    // "no-speech" just means a quiet stretch; keep listening.
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    dictSetStatus(e.error === 'not-allowed' ? 'Microphone access was denied.' : 'Dictation error: ' + e.error);
    dictStop();
  };
  // continuous still ends on long silence in some builds — restart while armed.
  rec.onend = () => { if (dict.on) { try { rec.start(); } catch { dictStop(); } } };

  dict.rec = rec;
  dict.on = true;
  try { rec.start(); } catch { dict.on = false; dict.rec = null; }
  dictPaint();
  dictSetStatus('Listening — speak a line, pause, then the next.');
}

function dictStop() {
  if (!dict.on) return;
  dict.on = false;
  const rec = dict.rec;
  dict.rec = null;
  if (rec) { rec.onend = null; try { rec.stop(); } catch { /* already gone */ } }
  dictSetInterim('');
  dictPaint();
}

function dictToggle() { return dict.on ? dictStop() : dictStart(); }

function dictSetInterim(text) {
  const box = document.getElementById('dict-interim');
  if (!box) return;
  box.textContent = text;
  box.classList.toggle('has-text', !!text);
}
function dictSetStatus(msg) {
  const s = document.getElementById('dict-status');
  if (s) s.textContent = msg || '';
}

function dictPaint() {
  const btn = document.getElementById('dictate-btn');
  const bar = document.getElementById('dict-bar');
  const install = document.getElementById('dict-install');
  if (!btn) return;
  // 'unknown' is the pre-probe state — keep the button up rather than flashing
  // it away and back while availability resolves.
  const supported = !!SRec && dict.modelState !== 'unsupported' && dict.modelState !== 'unavailable';
  btn.hidden = !supported;
  if (!supported) { if (bar) bar.hidden = true; return; }
  btn.classList.toggle('on', dict.on);
  btn.textContent = dict.on ? '● Listening' : '🎤 Dictate';
  const ready = dict.modelState === 'available';
  const busy = dict.installing || dict.modelState === 'downloading';
  if (bar) bar.hidden = !dict.on && !dict.showInstall;
  if (install) {
    install.hidden = ready;
    install.disabled = busy;
    install.textContent = busy ? 'Installing…' : 'Install voice model';
  }
  const live = bar && bar.querySelector('.dict-live');
  if (live) live.hidden = !dict.on;
  if (!ready && dict.showInstall) {
    dictSetStatus(busy
      ? 'Downloading the on-device model — this happens once, then dictation works offline.'
      : 'Dictation runs entirely on your machine. Install the voice model once to use it.');
  }
}

// ---- Tool panel wiring ----
function toggleTool(name) {
  const panel = document.getElementById(name + '-panel');
  panel.hidden = !panel.hidden;
  // Closing the panel must never drop a take in progress — recording is deliberately
  // independent of whether you're looking at it.
  if (panel.hidden) { if (name === 'metro') metroStop(); if (name === 'tuner') tunerStop(); }
  if (name === 'capture' && !panel.hidden) { capLoadDevices(); renderTakes(); }
}
document.getElementById('metro-btn').addEventListener('click', () => toggleTool('metro'));
document.getElementById('tuner-btn').addEventListener('click', () => toggleTool('tuner'));
document.getElementById('capture-btn').addEventListener('click', () => toggleTool('capture'));
document.getElementById('dictate-btn').addEventListener('click', dictToggle);
document.getElementById('dict-install').addEventListener('click', dictInstallModel);
// Ask once at startup whether the local model is here, so the button can hide
// itself entirely where dictation can't run.
dictRefreshModel();
document.getElementById('cap-toggle').addEventListener('click', captureToggle);
document.getElementById('cap-device').addEventListener('change', (e) => {
  prefs.capture.deviceId = e.target.value || null;
  prefs.capture.deviceLabel = e.target.selectedOptions[0] ? e.target.selectedOptions[0].textContent : '';
  savePrefs();
  capSetStatus(prefs.capture.deviceId ? `Armed: ${prefs.capture.deviceLabel}` : 'Armed: default input');
});
document.getElementById('cap-format').addEventListener('change', (e) => {
  prefs.capture.format = e.target.value === 'opus' ? 'opus' : 'wav';
  savePrefs();
});
// Inputs come and go — the interface gets plugged in after the app is open.
if (navigator.mediaDevices && 'ondevicechange' in navigator.mediaDevices) {
  navigator.mediaDevices.addEventListener('devicechange', () => capLoadDevices());
}
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
// The current tuning's targets, low → high: note name over the pitch you're
// aiming at. The one being tuned lights up; each string keeps a ✓ once you've
// brought it in. Clicking one locks the tuner to it.
function renderTunerStrings() {
  const box = document.getElementById('tuner-strings');
  box.innerHTML = tunerTargets().map((t) =>
    `<button class="tstr" data-i="${t.i}" title="Lock the tuner to the ${t.number}${ordSuffix(t.number)} string (${t.hz.toFixed(2)} Hz)">` +
    `<span class="tstr-name">${t.label}</span><span class="tstr-hz">${t.hz.toFixed(1)}</span></button>`).join('');
  box.querySelectorAll('.tstr').forEach((b) => b.addEventListener('click', () => {
    const i = +b.dataset.i;
    tuner.pinned = tuner.pinned === i ? null : i;
    resetTunerReading();
    paintTunerStrings();
  }));
  paintTunerStrings();
}

// `active` is the string currently being read; the pinned one always shows.
function paintTunerStrings(active, inTune) {
  document.querySelectorAll('#tuner-strings .tstr').forEach((b) => {
    const i = +b.dataset.i;
    b.classList.toggle('pinned', tuner.pinned === i);
    b.classList.toggle('active', active === i);
    b.classList.toggle('is-in-tune', active === i && !!inTune);
    b.classList.toggle('done', tuner.done.has(i));
  });
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
    // New targets: nothing carried over from the old tuning is still true.
    tuner.pinned = null;
    tuner.done.clear();
    resetTunerReading();
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
  initTuningSelect();
  el.toggleChords.checked = prefs.showChords;
  el.toggleScales.checked = prefs.showScales;
  el.toggleNumbers.checked = prefs.nashville;
  applyLayout();
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
  // Import a shared song if the URL carries one.
  importSharedSong();
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
  el.roadmap.innerHTML = '';
  el.riffPanels.innerHTML = '';
  el.riffEditors.innerHTML = '';
  el.harmonica.innerHTML = '';
  el.tuningBanner.innerHTML = '';
  el.songTuning.value = 'standard';
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
