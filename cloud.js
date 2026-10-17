// Cloud mode: one shared library in Firestore for a small invited group.
// Loaded on demand by app.js (dynamic import), so the public app never
// downloads Firebase unless someone opens the shared library.
//
// Layout:
//   shared/library/songs/{songId}   { data, title, updated, updatedBy }
//   shared/library/meta/setlists    { data, updated, updatedBy }
//   shared/library/meta/groups      { data, … } — every folder path, so empty folders persist
//   shared/library/takes/{takeId}   { songId, songTitle, ts, durMs, ext, mime, name, size, by }
//   Storage: library/takes/{takeId}.{ext} — the take's audio
// `data` is the song (or setlist array) as JSON text: songs carry nested arrays
// (riffs, strums) that Firestore can't store as fields, and JSON keeps the
// stored shape identical to what localStorage holds.
//
// Who may read/write is decided by firestore.rules (an email allow-list), not
// here. Firestore's offline cache keeps the library usable without signal;
// edits sync when the connection returns.

import { firebaseConfig } from './cloud-config.js?v=2';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut as fbSignOut,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, writeBatch, setDoc, deleteDoc, serverTimestamp, getDocs, getDoc,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import {
  getStorage, ref, uploadBytes, getDownloadURL, deleteObject,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js';

export const configured = !!(firebaseConfig.apiKey && firebaseConfig.projectId);

let app, auth, db, storage;
function init() {
  if (app) return;
  if (!configured) throw new Error('cloud-config.js has no Firebase config yet');
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  storage = getStorage(app);
}

const songsCol = () => collection(db, 'shared', 'library', 'songs');
const metaDoc = (name) => doc(db, 'shared', 'library', 'meta', name);
const takesCol = () => collection(db, 'shared', 'library', 'takes');
const takeRef = (t) => ref(storage, `library/takes/${t.id}.${t.ext}`);

// Resolves with the signed-in user (or null) once Firebase has restored the
// session from its own storage.
export function whenUser() {
  init();
  return new Promise((resolve) => {
    const off = onAuthStateChanged(auth, (u) => { off(); resolve(u); });
  });
}

export async function signIn() {
  init();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(auth, provider);
  return cred.user;
}

export async function signOut() {
  init();
  await fbSignOut(auth);
}

export function userEmail() {
  return auth && auth.currentUser ? auth.currentUser.email : null;
}

// What was last written to or read from the server, by id, as the JSON text
// stored in `data`. sync() writes only what differs; the listener ignores
// snapshots that match, so our own writes never bounce back as "remote" edits.
const known = new Map();
const knownMeta = {}; // meta doc name -> its last-known `data` text

function songJson(s) {
  // Folder-mode and draft bookkeeping never belongs in the shared copy, nor
  // do fields the app keeps for itself (`_by`, who last saved it).
  const { draft, libId, path, subpath, ...rest } = s;
  for (const k of Object.keys(rest)) if (k.startsWith('_')) delete rest[k];
  return JSON.stringify(rest);
}

// Watch the library. `onInit(songs)` fires once with the full list; after that
// `onChange({ type: 'set'|'removed', song|id })` fires per edit someone else
// made. `onError(err)` gets permission failures (not on the allow-list).
export function watchSongs({ onInit, onChange, onError }) {
  init();
  let first = true, pending = null, timer = null;
  const start = (snap) => {
    first = false;
    clearTimeout(timer);
    const list = [];
    snap.forEach((d) => {
      const data = d.get('data');
      try {
        const s = JSON.parse(data);
        s._by = d.get('updatedBy') || ''; // who saved it last, for "changed since you looked"
        list.push(s);
        known.set(d.id, data);
      } catch { /* skip a corrupt doc */ }
    });
    onInit(list);
  };
  // The first answer usually comes from this browser's offline copy, which can
  // be days old. Online, wait for the server's (a few seconds at most) so the
  // app opens on what's really there; offline, the copy is all there is.
  return onSnapshot(songsCol(), { includeMetadataChanges: true }, (snap) => {
    if (first) {
      if (snap.metadata.fromCache && navigator.onLine) {
        pending = snap;
        if (!timer) timer = setTimeout(() => { if (first) start(pending); }, 4000);
        return;
      }
      start(snap);
      return;
    }
    if (snap.metadata.hasPendingWrites) return; // our own write, already applied
    for (const ch of snap.docChanges()) {
      const id = ch.doc.id;
      if (ch.type === 'removed') {
        if (!known.has(id)) continue;
        known.delete(id);
        onChange({ type: 'removed', id });
        continue;
      }
      const data = ch.doc.get('data');
      if (known.get(id) === data) continue; // unchanged, or only its sync state moved
      let song;
      try { song = JSON.parse(data); } catch { continue; }
      known.set(id, data);
      song._by = ch.doc.get('updatedBy') || '';
      onChange({ type: 'set', song, by: song._by });
    }
  }, onError);
}

// Bring the server in line with the local song list: write changed or new
// songs, delete ones that are gone. Cheap to call after every edit.
export async function syncSongs(songs) {
  init();
  const batch = writeBatch(db);
  let n = 0;
  const live = new Set();
  const by = userEmail() || '';
  const before = new Map(); // to undo `known` if the write is refused
  for (const s of songs) {
    if (s.draft) continue;
    live.add(s.id);
    const data = songJson(s);
    if (known.get(s.id) === data) continue;
    before.set(s.id, known.get(s.id));
    known.set(s.id, data);
    s._by = by;
    batch.set(doc(songsCol(), s.id), { data, title: s.title || '', updated: s.updated || Date.now(), updatedBy: by });
    n++;
  }
  for (const id of [...known.keys()]) {
    if (live.has(id)) continue;
    before.set(id, known.get(id));
    known.delete(id);
    batch.delete(doc(songsCol(), id));
    n++;
  }
  // With the offline cache, commit() resolves once the server has the write;
  // offline it waits, so don't await it from the UI.
  if (!n) return;
  try { await batch.commit(); }
  catch (err) {
    for (const [id, v] of before) { if (v === undefined) known.delete(id); else known.set(id, v); }
    throw err;
  }
}

// Copy songs in from elsewhere (this browser, open folders) on joining.
// Batches top out at 500 writes.
export async function copyIn(songs) {
  init();
  const by = userEmail() || '';
  for (let i = 0; i < songs.length; i += 400) {
    const batch = writeBatch(db);
    for (const s of songs.slice(i, i + 400)) {
      batch.set(doc(songsCol(), s.id), { data: songJson(s), title: s.title || '', updated: s.updated || Date.now(), updatedBy: by });
    }
    await batch.commit();
  }
}

// The library's small shared lists (setlists, folders), one JSON doc each.
export function watchMeta(name, onValue) {
  init();
  return onSnapshot(metaDoc(name), (snap) => {
    if (snap.metadata.hasPendingWrites) return;
    const data = snap.exists() ? snap.get('data') : '[]';
    if (data === knownMeta[name]) return;
    knownMeta[name] = data;
    try { onValue(JSON.parse(data)); } catch { /* keep what we have */ }
  }, () => {});
}

export async function syncMeta(name, value) {
  init();
  const data = JSON.stringify(value);
  if (data === knownMeta[name]) return;
  const before = knownMeta[name];
  knownMeta[name] = data;
  try { await setDoc(metaDoc(name), { data, updated: serverTimestamp(), updatedBy: userEmail() || '' }); }
  catch (err) { knownMeta[name] = before; throw err; }
}

export const watchSetlists = (onSetlists) => watchMeta('setlists', onSetlists);
export const syncSetlists = (list) => syncMeta('setlists', list);

// One-off reads, for copying in from outside the library (nothing is watched yet).
export async function fetchSongs() {
  init();
  const snap = await getDocs(songsCol());
  const list = [];
  snap.forEach((d) => { try { list.push(JSON.parse(d.get('data'))); } catch { /* skip */ } });
  return list;
}

export async function fetchMeta(name) {
  init();
  const snap = await getDoc(metaDoc(name));
  try { return snap.exists() ? JSON.parse(snap.get('data')) : []; } catch { return []; }
}

// ---- Takes -----------------------------------------------------------------
// Audio goes to Storage first and the Firestore record second, so a take only
// appears in anyone's list once its audio is there to play.

const TAKE_MIME = { wav: 'audio/wav', m4a: 'audio/mp4', webm: 'audio/webm' };

export async function uploadTake(t, songId) {
  init();
  const contentType = t.mime || TAKE_MIME[t.ext] || 'audio/wav';
  await uploadBytes(takeRef(t), t.blob, { contentType });
  await setDoc(doc(takesCol(), t.id), {
    songId, songTitle: t.songTitle || '', ts: t.ts, durMs: t.durMs || 0, ext: t.ext,
    mime: contentType, name: t.name, size: t.blob.size, by: userEmail() || '',
  });
}

// `onTakes(list)` gets every take's record, now and after each change.
export function watchTakes(onTakes) {
  init();
  return onSnapshot(takesCol(), (snap) => {
    onTakes(snap.docs.map((d) => Object.assign({ id: d.id }, d.data())));
  }, () => {});
}

export function takeUrl(t) {
  init();
  return getDownloadURL(takeRef(t));
}

export async function deleteTake(t) {
  init();
  try { await deleteObject(takeRef(t)); }
  catch (err) { if (!err || err.code !== 'storage/object-not-found') throw err; }
  await deleteDoc(doc(takesCol(), t.id));
}
