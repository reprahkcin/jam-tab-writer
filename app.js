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
  return { id: newId(), title: '', artist: '', body: '', transpose: 0, capo: 0, key: null, scaleRoot: null, updated: Date.now() };
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

  el.scalePanel.innerHTML =
    `<div class="sp-head"><span class="sp-title">${HARP_NAMES[pc]} ${escapeHtml(scale.name)}</span>` +
    `<span class="muted">Root</span><select id="scale-root">${rootOpts}</select>` +
    `<select id="scale-type">${scaleOpts}</select>` +
    `<span class="sp-legend"><span class="sp-dot root"></span>root <span class="sp-dot note"></span>scale tone</span>` +
    `</div>` +
    scaleDiagramSVG(pc, scale.iv);

  document.getElementById('scale-root').addEventListener('change', (e) => {
    const cur = currentSong();
    cur.scaleRoot = e.target.value === 'auto' ? null : parseInt(e.target.value, 10);
    cur.updated = Date.now();
    saveSongs(songs);
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
}

boot();
