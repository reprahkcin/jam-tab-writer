// Cloud mode: one shared library in Firestore for a small invited group.
// Loaded on demand by app.js (dynamic import), so the public app never
// downloads Firebase unless someone opens the shared library.
//
// Layout:
//   shared/library/songs/{songId}   { data, title, updated, updatedBy }
//   shared/library/meta/setlists    { data, updated, updatedBy }
// `data` is the song (or setlist array) as JSON text: songs carry nested arrays
// (riffs, strums) that Firestore can't store as fields, and JSON keeps the
// stored shape identical to what localStorage holds.
//
// Who may read/write is decided by firestore.rules (an email allow-list), not
// here. Firestore's offline cache keeps the library usable without signal;
// edits sync when the connection returns.

import { firebaseConfig } from './cloud-config.js?v=1';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut as fbSignOut,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, writeBatch, setDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

export const configured = !!(firebaseConfig.apiKey && firebaseConfig.projectId);

let app, auth, db;
function init() {
  if (app) return;
  if (!configured) throw new Error('cloud-config.js has no Firebase config yet');
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
}

const songsCol = () => collection(db, 'shared', 'library', 'songs');
const setlistDoc = () => doc(db, 'shared', 'library', 'meta', 'setlists');

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
let knownSetlists = null;

function songJson(s) {
  // Folder-mode and draft bookkeeping never belongs in the shared copy.
  const { draft, libId, path, subpath, ...rest } = s;
  return JSON.stringify(rest);
}

// Watch the library. `onInit(songs)` fires once with the full list; after that
// `onChange({ type: 'set'|'removed', song|id })` fires per edit someone else
// made. `onError(err)` gets permission failures (not on the allow-list).
export function watchSongs({ onInit, onChange, onError }) {
  init();
  let first = true;
  return onSnapshot(songsCol(), (snap) => {
    if (first) {
      first = false;
      const list = [];
      snap.forEach((d) => {
        const data = d.get('data');
        try { list.push(JSON.parse(data)); known.set(d.id, data); } catch { /* skip a corrupt doc */ }
      });
      onInit(list);
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
      if (known.get(id) === data) continue;
      let song;
      try { song = JSON.parse(data); } catch { continue; }
      known.set(id, data);
      onChange({ type: 'set', song, by: ch.doc.get('updatedBy') || '' });
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

export function watchSetlists(onSetlists) {
  init();
  return onSnapshot(setlistDoc(), (snap) => {
    if (snap.metadata.hasPendingWrites) return;
    const data = snap.exists() ? snap.get('data') : '[]';
    if (data === knownSetlists) return;
    knownSetlists = data;
    try { onSetlists(JSON.parse(data)); } catch { /* keep what we have */ }
  }, () => {});
}

export async function syncSetlists(list) {
  init();
  const data = JSON.stringify(list);
  if (data === knownSetlists) return;
  knownSetlists = data;
  await setDoc(setlistDoc(), { data, updated: serverTimestamp(), updatedBy: userEmail() || '' });
}
