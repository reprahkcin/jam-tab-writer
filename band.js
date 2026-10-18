// ---- The band: invite link, personal tour, album board ----------------------
// The shared library is for a handful of bandmates writing an album together,
// some of them reluctant. This file is their way in: a link that signs them
// straight into the library, a short tour that greets them by name and points
// at the part of the album that mentions them, a board showing where every
// album song stands, and a dot on whatever someone else changed since they
// last looked.
//
// The band's details live in the library itself (shared/library/meta/band):
//   { album: 'Greatest Hits Album', people: { 'email@x.com': 'Name', … } }
//
// Loaded before app.js, like tour.js: everything here reaches app.js's globals
// (songs, cloud, selectSong …) only when it runs, never at load.

let bandInfo = {}; // shared/library/meta/band, once the library has loaded

const BAND_JOIN_KEY = 'gtw.band.join';        // arrived by the invite link, tour still to come
const BAND_TOUR_KEY = 'gtw.band.tourDone.';   // + email: this person has had the tour here
const SEEN_KEY = 'gtw.cloud.seen';            // { songId: when you last opened it }
const SEEN_SINCE_KEY = 'gtw.cloud.seenSince'; // first visit: older changes aren't news

function bandAlbum() { return normGroup(bandInfo && bandInfo.album); }
// The band's name and its records in order, from the library's band settings.
// The door (before sign-in) can't read those, so index.html carries its own copy.
function bandName() { return (bandInfo && bandInfo.name) || 'the band'; }
function bandCatalog() {
  if (bandInfo && Array.isArray(bandInfo.catalog) && bandInfo.catalog.length) return bandInfo.catalog;
  // Otherwise every top-level folder but the album and the covers.
  const album = bandAlbum().split('/')[0];
  return allGroupPaths().filter((p) => !p.includes('/') && p !== album && !/other people/i.test(p));
}
function listText(items) {
  if (items.length < 2) return items.join('');
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}
function bandMe() { return cloud && cloud.userEmail ? (cloud.userEmail() || '').toLowerCase() : ''; }
function personName(email) {
  const e = (email || '').toLowerCase();
  const people = (bandInfo && bandInfo.people) || {};
  if (people[e]) return people[e];
  return e ? e.split('@')[0] : 'someone';
}
function setBandInfo(v) {
  bandInfo = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

// "2 days ago", short enough for a list.
function agoText(ts) {
  if (!ts) return '';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = s / 60, h = m / 60, d = h / 24;
  if (m < 60) return `${Math.round(m)} min ago`;
  if (h < 24) return `${Math.round(h)} h ago`;
  if (d < 14) return `${Math.round(d)} day${Math.round(d) === 1 ? '' : 's'} ago`;
  return new Date(ts).toLocaleDateString();
}

// ---- Changed since you last looked ------------------------------------------

// Read once and kept in memory: the song list asks for every row on every render.
let seenMap = null;
function readSeen() {
  if (!seenMap) { try { seenMap = JSON.parse(lsGet(SEEN_KEY) || '{}') || {}; } catch { seenMap = {}; } }
  return seenMap;
}
function seenSince() {
  let t = Number(lsGet(SEEN_SINCE_KEY));
  if (!t) { t = Date.now(); lsSet(SEEN_SINCE_KEY, String(t)); }
  return t;
}
function markSeen(id) {
  if (mode !== 'cloud' || !id) return;
  const seen = readSeen();
  seen[id] = Date.now();
  lsSet(SEEN_KEY, JSON.stringify(seen));
}
// Someone else saved this song after you last opened it. Compared on the
// server's clock (`_at`) where there is one, so a bandmate's phone running
// slow doesn't hide their edit.
function isNewToMe(s) {
  if (mode !== 'cloud' || !s || !s._by) return false;
  const me = bandMe();
  if (!me || s._by.toLowerCase() === me) return false;
  const seen = readSeen()[s.id] || seenSince();
  return (s._at || s.updated || 0) > seen;
}

// ---- The album checklist ---------------------------------------------------
// Where each album song stands, ticked by hand by anyone in the band. The items
// are the album's own list (shared/library/meta/album-checklist), edited in the
// Details tab; the ticks live one document per song (cloud.js setCheck), so
// ticks never collide with each other or with someone editing the lyrics.

const DEFAULT_CHECKLIST = [
  { id: 'lyrics-drafted', label: 'Lyrics drafted' },
  { id: 'lyrics-final', label: 'Lyrics final' },
  { id: 'chords-structure', label: 'Chords & structure' },
  { id: 'demo', label: 'Demo recorded' },
  { id: 'solos-features', label: 'Solos and features recorded' },
];
let checklistItems = DEFAULT_CHECKLIST;
let albumChecks = {}; // songId -> { itemId: { by, at } }

// Started from startCloudSync alongside the other library watchers.
function watchChecklist() {
  // Stored as { items: [...] }: a missing doc means "never set" (the defaults),
  // while an emptied list stays empty.
  cloud.watchMeta('album-checklist', (v) => {
    checklistItems = v && Array.isArray(v.items) ? v.items : DEFAULT_CHECKLIST;
    refreshAlbumPanel();
  });
  cloud.watchChecks((all) => { albumChecks = all; refreshAlbumPanel(); });
}
function saveChecklist() {
  cloud.syncMeta('album-checklist', { items: checklistItems }).catch(cloudFailed);
  refreshAlbumPanel();
}
function songTicks(id) { return albumChecks[id] || {}; }
function songDone(s) {
  const ticks = songTicks(s.id);
  return checklistItems.filter((it) => ticks[it.id]).length;
}

// ---- The album panel --------------------------------------------------------
// Two tabs on the album folder's Album button: Songs (each one's checklist)
// and Details (the album's direction, its constraints, and general notes,
// written by the whole band). Each details box is its own document in the
// library (shared/library/meta/album-<key>), so two people editing different
// boxes never overwrite each other.

const ALBUM_FIELDS = [
  { key: 'direction', label: 'Direction',
    hint: 'What the album is: the story, the sound, the feel we’re going for.' },
  { key: 'constraints', label: 'Constraints',
    hint: 'The rules we’re holding to: length, instrumentation, keys, what’s off the table.' },
  { key: 'notes', label: 'Notes',
    hint: 'Anything else: title ideas, open questions, who’s on what.' },
];
const ALBUM_TAB_KEY = 'gtw.album.tab';
const albumDetails = {}; // key -> { text, by, at }

function setAlbumDetail(key, v, meta) {
  albumDetails[key] = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  if (meta && meta.at) albumDetails[key]._at = meta.at; // the server's clock, not the editor's
  const box = document.querySelector(`#album-board textarea[data-key="${key}"]`);
  const who = document.querySelector(`#album-board [data-who="${key}"]`);
  if (!box) return;
  const theirs = albumDetails[key].text || '';
  if (document.activeElement !== box) {
    box.value = theirs;
    sizeBox(box);
    if (who) who.textContent = detailWho(key);
    return;
  }
  // You're typing in the box someone else just changed: say so, and offer
  // their version, rather than letting your next save quietly replace it.
  if (who && theirs !== box.value) {
    who.innerHTML = `${escapeHtml(personName(albumDetails[key].by))} just changed this. What you type will replace it. ` +
      '<button type="button" class="ab-theirs">Show theirs</button>';
    who.querySelector('.ab-theirs').addEventListener('mousedown', (e) => e.preventDefault()); // keep the box focused
    who.querySelector('.ab-theirs').addEventListener('click', () => {
      clearTimeout(detailTimers[key]);
      delete detailTimers[key];
      box.value = theirs;
      sizeBox(box);
      who.textContent = detailWho(key);
    });
  }
}
// Started from startCloudSync alongside the other library watchers.
function watchAlbumDetails() {
  for (const f of ALBUM_FIELDS) cloud.watchMeta('album-' + f.key, (v) => setAlbumDetail(f.key, v));
}
function detailWho(key) {
  const d = albumDetails[key] || {};
  return d.by ? `Last edited by ${personName(d.by)}, ${agoText(d._at || d.at)}` : '';
}
function sizeBox(box) {
  box.style.height = 'auto';
  box.style.height = Math.min(Math.max(box.scrollHeight + 2, 72), 420) + 'px';
}

const detailTimers = {};
// Returns the write, so leaving the library can wait for it.
function saveDetail(key, text) {
  clearTimeout(detailTimers[key]);
  delete detailTimers[key];
  const prev = albumDetails[key] || {};
  if ((prev.text || '') === text) return Promise.resolve();
  const mine = { text, by: bandMe(), at: Date.now() };
  albumDetails[key] = mine;
  const who = document.querySelector(`#album-board [data-who="${key}"]`);
  if (who) who.textContent = detailWho(key);
  return cloud.syncMeta('album-' + key, mine).catch((err) => {
    // Refused: forget it was saved, so the next blur or close tries again.
    if (albumDetails[key] === mine) albumDetails[key] = prev;
    cloudFailed(err);
  });
}
// Write anything still waiting on its timer (closing the panel, leaving a box).
function flushDetails() {
  const writes = [];
  document.querySelectorAll('#album-board textarea[data-key]').forEach((box) => {
    if (detailTimers[box.dataset.key]) writes.push(saveDetail(box.dataset.key, box.value));
  });
  return Promise.all(writes);
}

function albumSongsHtml(album, list) {
  const rows = list.map((s, i) => {
    const ticks = songTicks(s.id);
    const done = songDone(s);
    const by = s._by ? personName(s._by) : '';
    const boxes = checklistItems.map((it) => {
      const tk = ticks[it.id];
      const tip = tk ? `Ticked by ${personName(tk.by)}, ${agoText(tk.at)}` : 'Not done yet';
      return `<label class="ab-check${tk ? ' on' : ''}" title="${escapeHtml(tip)}">` +
        `<input type="checkbox" data-song="${s.id}" data-item="${escapeHtml(it.id)}"${tk ? ' checked' : ''} />` +
        `${escapeHtml(it.label)}</label>`;
    }).join('');
    const total = checklistItems.length;
    return `<div class="ab-row${total && done === total ? ' complete' : ''}">` +
      `<span class="ab-num">${i + 1}</span>` +
      `<span class="ab-main">` +
      `<button class="ab-title" data-id="${s.id}" title="Open this song">${escapeHtml(s.title || 'Untitled')}` +
      `${isNewToMe(s) ? '<span class="new-dot" title="Changed since you last looked"></span>' : ''}</button>` +
      `<span class="ab-checks">${boxes}</span></span>` +
      `<span class="ab-when"><b>${done}/${total}</b><br>${by ? escapeHtml(by) + '<br>' : ''}${escapeHtml(agoText(s.updated))}</span>` +
      `</div>`;
  }).join('');
  const recent = [...songs].filter((s) => s._by).sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 8);
  const recentHtml = recent.map((s) =>
    `<button class="ab-recent" data-id="${s.id}"><b>${escapeHtml(s.title || 'Untitled')}</b>` +
    `<span>${escapeHtml(personName(s._by))} · ${escapeHtml(agoText(s.updated))}</span></button>`).join('');
  return `<div class="ab-list">${rows || '<div class="ab-empty">No songs in this folder yet.</div>'}</div>` +
    (recentHtml ? `<div class="help-sub-head">Recent changes in the library</div><div class="ab-recents">${recentHtml}</div>` : '');
}

// The checklist's items, editable: rename in place, remove, add.
function checklistEditorHtml() {
  return '<div class="ab-field"><span class="ab-flabel">Checklist</span>' +
    '<span class="ab-who">The boxes every album song gets on the Songs tab.</span>' +
    '<div class="ab-items">' + checklistItems.map((it) =>
      `<div class="ab-item"><input type="text" data-item-label="${escapeHtml(it.id)}" value="${escapeHtml(it.label)}" aria-label="Checklist item" />` +
      `<button type="button" class="ab-item-del" data-item-del="${escapeHtml(it.id)}" title="Remove this item">×</button></div>`).join('') +
    '</div><button type="button" class="ab-item-add">+ Add item</button></div>';
}

// Song ticks and the list itself arrive live; redraw what's showing without
// touching a box someone is typing in.
function refreshAlbumPanel() {
  const wrap = document.getElementById('album-board');
  if (!wrap) return;
  const album = bandAlbum();
  const list = songs.filter((s) => normGroup(s.group) === album).sort(songOrder);
  const pane = wrap.querySelector('[data-pane="songs"]');
  if (pane) {
    const top = pane.scrollTop;
    pane.innerHTML = albumSongsHtml(album, list);
    pane.scrollTop = top;
    bindSongsPane(wrap);
  }
  const sub = wrap.querySelector('.share-sub');
  if (sub) sub.textContent = albumSummary(list);
  const ed = wrap.querySelector('.ab-checklist');
  if (ed && !ed.contains(document.activeElement)) {
    ed.innerHTML = checklistEditorHtml();
    bindChecklistEditor(wrap);
  }
}
function albumSummary(list) {
  const total = checklistItems.length;
  const complete = total ? list.filter((s) => songDone(s) === total).length : 0;
  return `${list.length} songs · ${complete} with every box ticked`;
}

function bindSongsPane(wrap) {
  const open = (id) => { void closeAlbumBoard(); selectSong(id); };
  wrap.querySelectorAll('[data-pane="songs"] [data-id]').forEach((b) => b.addEventListener('click', () => open(b.dataset.id)));
  wrap.querySelectorAll('[data-pane="songs"] input[data-song]').forEach((box) => box.addEventListener('change', () => {
    const on = box.checked;
    box.closest('.ab-check').classList.toggle('on', on);
    cloud.setCheck(box.dataset.song, box.dataset.item, on).catch((err) => {
      box.checked = !on; // refused: put it back
      box.closest('.ab-check').classList.toggle('on', !on);
      cloudFailed(err);
    });
  }));
}

function bindChecklistEditor(wrap) {
  const ed = wrap.querySelector('.ab-checklist');
  if (!ed) return;
  ed.querySelectorAll('input[data-item-label]').forEach((inp) => inp.addEventListener('change', () => {
    const label = inp.value.trim();
    const it = checklistItems.find((x) => x.id === inp.dataset.itemLabel);
    if (!it) return;
    if (!label) { inp.value = it.label; return; }
    if (label === it.label) return;
    checklistItems = checklistItems.map((x) => (x.id === it.id ? { id: x.id, label } : x));
    saveChecklist();
  }));
  ed.querySelectorAll('[data-item-del]').forEach((b) => b.addEventListener('click', () => {
    const it = checklistItems.find((x) => x.id === b.dataset.itemDel);
    if (!it) return;
    const ticked = Object.values(albumChecks).filter((ticks) => ticks[it.id]).length;
    if (ticked && !confirm(`Remove "${it.label}"? It's ticked on ${ticked} song${ticked === 1 ? '' : 's'}; those ticks go too.`)) return;
    checklistItems = checklistItems.filter((x) => x.id !== it.id);
    saveChecklist();
  }));
  ed.querySelector('.ab-item-add').addEventListener('click', () => {
    const label = prompt('New checklist item:', '');
    if (!label || !label.trim()) return;
    checklistItems = checklistItems.concat({ id: 'c' + Date.now().toString(36), label: label.trim() });
    saveChecklist();
  });
}

function albumDetailsHtml() {
  return '<div class="ab-details">' + ALBUM_FIELDS.map((f) =>
    `<label class="ab-field"><span class="ab-flabel">${f.label}</span>` +
    `<textarea data-key="${f.key}" rows="3" placeholder="${escapeHtml(f.hint)}">${escapeHtml((albumDetails[f.key] || {}).text || '')}</textarea>` +
    `<span class="ab-who" data-who="${f.key}">${escapeHtml(detailWho(f.key))}</span></label>`).join('') +
    `<div class="ab-checklist">${checklistEditorHtml()}</div>` +
    '<div class="ab-foot">Saves as you type.</div></div>';
}

function openAlbumBoard(tab) {
  const album = bandAlbum();
  if (mode !== 'cloud' || !album) return;
  void closeAlbumBoard();
  const list = songs.filter((s) => normGroup(s.group) === album).sort(songOrder);
  const which = tab || lsGet(ALBUM_TAB_KEY) || 'songs';

  const wrap = document.createElement('div');
  wrap.id = 'album-board';
  wrap.className = 'share-modal';
  wrap.innerHTML =
    `<div class="share-card ab-card" role="dialog" aria-modal="true" aria-label="${escapeHtml(album)}">` +
    `<div class="share-head">${escapeHtml(album)}</div>` +
    `<div class="share-sub">${escapeHtml(albumSummary(list))}</div>` +
    `<div class="ab-tabs" role="tablist">` +
    `<button class="ab-tab" role="tab" data-tab="songs">Songs</button>` +
    `<button class="ab-tab" role="tab" data-tab="details">Details</button></div>` +
    `<div class="ab-pane" data-pane="songs">${albumSongsHtml(album, list)}</div>` +
    `<div class="ab-pane" data-pane="details">${albumDetailsHtml()}</div>` +
    `<div class="share-actions"><button id="ab-close">Close</button></div></div>`;
  document.body.appendChild(wrap);

  const show = (name) => {
    wrap.querySelectorAll('.ab-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    wrap.querySelectorAll('.ab-pane').forEach((p) => { p.hidden = p.dataset.pane !== name; });
    lsSet(ALBUM_TAB_KEY, name);
    if (name === 'details') wrap.querySelectorAll('textarea[data-key]').forEach(sizeBox);
  };
  wrap.querySelectorAll('.ab-tab').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  show(which === 'details' ? 'details' : 'songs');

  bindSongsPane(wrap);
  bindChecklistEditor(wrap);
  wrap.querySelectorAll('textarea[data-key]').forEach((box) => {
    box.addEventListener('input', () => {
      sizeBox(box);
      clearTimeout(detailTimers[box.dataset.key]);
      detailTimers[box.dataset.key] = setTimeout(() => { void saveDetail(box.dataset.key, box.value); }, 800);
    });
    box.addEventListener('blur', () => { if (detailTimers[box.dataset.key]) void saveDetail(box.dataset.key, box.value); });
  });
  wrap.querySelector('#ab-close').addEventListener('click', () => { void closeAlbumBoard(); });
  // Only a click that starts on the backdrop closes it: a text selection
  // dragged out of a box and let go outside the card mustn't.
  let downOnBackdrop = false;
  wrap.addEventListener('mousedown', (e) => { downOnBackdrop = e.target === wrap; });
  wrap.addEventListener('click', (e) => { if (e.target === wrap && downOnBackdrop) void closeAlbumBoard(); });
  wrap.querySelector('#ab-close').focus();
}
// Resolves once any details still waiting have been written.
function closeAlbumBoard() {
  const b = document.getElementById('album-board');
  if (!b) return Promise.resolve();
  const saved = flushDetails();
  b.remove();
  return saved;
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('album-board')) void closeAlbumBoard();
});
// Closing the tab mid-sentence still saves it (into the offline copy, sent when it can be).
window.addEventListener('pagehide', () => { void flushDetails(); });

// ---- The invite link -------------------------------------------------------
// …/?join opens the shared library for someone who's never used the app: one
// screen, one button, then the tour. (The ?join itself is taken off the
// address in app.js, alongside ?cloud.)

function openJoin() {
  const modal = document.getElementById('join-modal');
  if (!modal) return;
  modal.hidden = false;
  document.getElementById('join-signin').focus();
}
function closeJoin() { const m = document.getElementById('join-modal'); if (m) m.hidden = true; }
document.getElementById('join-signin').addEventListener('click', () => { closeJoin(); void openCloud(); });
document.getElementById('join-later').addEventListener('click', () => { closeJoin(); lsSet(BAND_JOIN_KEY, null); });

// ---- The secret switch -----------------------------------------------------
// Five quick taps on the "Jam Tab Writer" title open the same sign-in screen as
// the invite link, so the band can find the library without one. It only
// shows the door: the member list still decides who gets in.
const secretTaps = [];
document.querySelector('header h1').addEventListener('click', (e) => {
  const now = Date.now();
  secretTaps.push(now);
  while (secretTaps.length && now - secretTaps[0] > 2000) secretTaps.shift();
  if (secretTaps.length < 5) return;
  secretTaps.length = 0;
  const h1 = e.currentTarget;
  h1.classList.remove('backstage');
  void h1.offsetWidth; // restart the wiggle
  h1.classList.add('backstage');
  if (mode === 'cloud') { el.status.textContent = 'You’re already backstage.'; return; }
  lsSet(CLOUD_UNLOCK_KEY, '1');
  lsSet(BAND_JOIN_KEY, '1');
  renderSourcePicker();
  closeIntro();
  document.getElementById('join-title').textContent = 'Backstage pass unlocked';
  openJoin();
});

// What the app shows when it opens, in place of the general welcome screen:
// the invite's sign-in screen, or the band tour on a first visit to the library.
function bandOpening() {
  if (mode !== 'cloud' && lsGet(BAND_JOIN_KEY)) { openJoin(); return true; }
  if (mode === 'cloud' && cloudReady && bandAlbum() && bandMe() && !lsGet(BAND_TOUR_KEY + bandMe())) {
    startBandTour();
    return true;
  }
  return false;
}

// ---- The band tour ---------------------------------------------------------

// The first line in an album song that mentions this person: their way in.
function bandHook(name) {
  if (!name) return null;
  const album = bandAlbum();
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  const list = songs.filter((s) => normGroup(s.group) === album).sort(songOrder);
  for (const s of list) {
    const line = (s.body || '').split('\n').find((l) => re.test(l));
    if (line) return { song: s, line: line.replace(/^\s*-\s*/, '').trim() };
  }
  return null;
}

function bandTourSteps() {
  const me = bandMe();
  const name = (bandInfo.people || {})[me] || '';
  const album = bandAlbum();
  const list = songs.filter((s) => normGroup(s.group) === album).sort(songOrder);
  const hook = bandHook(name);
  const start = hook ? hook.song : list[0];
  const albumRow = `#song-list [data-group="${CSS.escape(album)}"]`;
  return {
    start,
    steps: [
      { title: name ? `Hey ${escapeHtml(name)}, welcome backstage` : 'Welcome backstage',
        text: (() => {
          const records = bandCatalog().map((r) => `<i>${escapeHtml(r)}</i>`);
          const owner = (bandInfo.people || {})[(bandInfo.owner || '').toLowerCase()] || 'Nick';
          const band = bandName().replace(/^The /, 'the ');
          const whose = band.endsWith('s') ? band + '’' : band + '’s';
          return `This is ${escapeHtml(whose)} library: every chart from ${records.length ? listText(records) : 'the back catalog'}, ` +
            `plus the covers we jam on. Right now ${escapeHtml(owner)}’s working on <b>${escapeHtml(album)}</b>: ` +
            `${list.length} songs telling the band’s story, open mic on up. A minute’s tour and you’re set. <b>Esc</b> leaves at any time.`;
        })() },
      { el: albumRow, where: 'songs', title: 'The album',
        text: `The album’s songs, in story order. Each one opens on its <b>Notes</b> from the outline (the timeline, ` +
          `the characters, the open questions), then the song as far as it’s got.` },
      start && { el: '#editor', where: 'edit', title: hook ? `You’re in “${escapeHtml(start.title)}”` : escapeHtml(start.title || 'A song'),
        text: hook
          ? `The notes for this one say: <b>“${escapeHtml(hook.line)}”</b>. That’s you.`
          : 'Every album song starts like this: the notes up top, then sections to fill in.' },
      { el: '#editor', where: 'edit', title: 'Writing',
        text: 'Type lyrics under a section like <code>{Verse 1}</code>, and put a chord in square brackets just before the ' +
          'syllable it lands on: <code>[G]like this</code>. It saves as you type. There’s no Save button, ' +
          'and nothing you write can break anything.' },
      { el: '#capture-btn', where: 'header', title: 'Or just play it',
        text: 'Rather not type? Open a song, hit <b>Record</b> and hum or play the idea. Takes are saved with the song.' },
      { el: `${albumRow} .g-board`, where: 'songs', title: 'Where things stand',
        text: 'The <b>Album</b> button shows how far along each song is, and its <b>Details</b> tab has the album’s ' +
          'direction, constraints and notes: the best place to get the big picture.' },
      { el: '#perform-btn', where: 'header', only: 'desktop', title: 'The back catalog',
        text: 'Every older song is here too. Open one and hit <b>Perform</b> for a full-screen chart that scrolls by itself.' },
      { title: name ? `That’s the tour, ${escapeHtml(name)}` : 'That’s the tour',
        text: 'No homework. Have a look through the album songs. If something sparks, a line, a chord or a hummed take is welcome. ' +
          'The tour’s in Help (the <b>?</b>) any time.' },
    ].filter(Boolean),
  };
}

function startBandTour() {
  if (!(window.driver && window.driver.js && window.driver.js.driver)) return;
  if (mode !== 'cloud' || !bandAlbum()) return;
  closeHelp();
  closeIntro();
  closeJoin();
  lsSet(BAND_JOIN_KEY, null);
  if (bandMe()) lsSet(BAND_TOUR_KEY + bandMe(), '1'); // once, however it ends
  const album = bandAlbum();
  groupCollapsed.delete(album);
  const { start, steps: all } = bandTourSteps();
  setActiveGroup(album); // new songs from here land in the album
  if (start) selectSong(start.id);
  const phone = tourPhone();
  const plan = all
    .filter((st) => !st.only || st.only === (phone ? 'phone' : 'desktop'))
    .filter((st) => !st.el || document.querySelector(st.el));
  let tour = null;
  const go = (dir) => {
    const to = (tour.getActiveIndex() ?? 0) + dir;
    if (to < 0) return;
    if (to >= plan.length) { tour.destroy(); return; }
    tourReveal(plan[to].where);
    setTimeout(() => tour.moveTo(to), 0);
  };
  tour = window.driver.js.driver({
    steps: plan.map((st) => ({ element: st.el || undefined, popover: { title: st.title, description: st.text } })),
    showProgress: true,
    progressText: '{{current}} of {{total}}',
    nextBtnText: 'Next',
    prevBtnText: 'Back',
    doneBtnText: 'Done',
    popoverClass: 'jtw-tour',
    overlayOpacity: 0.6,
    stagePadding: 6,
    stageRadius: 8,
    smoothScroll: true,
    onNextClick: () => go(1),
    onPrevClick: () => go(-1),
    onDestroyStarted: () => tour.destroy(),
  });
  tourReveal(plan[0] && plan[0].where);
  tour.drive();
}
document.getElementById('help-band-tour').addEventListener('click', startBandTour);
