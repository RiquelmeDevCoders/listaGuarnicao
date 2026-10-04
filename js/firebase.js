import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, getDocFromServer, getDocs, updateDoc, onSnapshot, writeBatch,
  runTransaction, serverTimestamp, collection, query, where, orderBy, limit,
  documentId
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyCL8IFluqGulij4CPkzkwxWetuK6wNZK8M",
  authDomain: "listagrd.firebaseapp.com",
  projectId: "listagrd",
  storageBucket: "listagrd.firebasestorage.app",
  messagingSenderId: "494052483911",
  appId: "1:494052483911:web:cd5a456433c2612961e262"
};

export const SLOT_KEYS = ['h1p1', 'h1p2', 'h1p3', 'h2p1', 'h2p2', 'h2p3', 'h3p1', 'h3p2', 'h3p3'];
export const ADMIN_NAME = 'RIQUELME';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch {
  db = initializeFirestore(app, {});
}

export class AppError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

const userRef = (uid) => doc(db, 'users', uid);
const scaleRef = (id) => doc(db, 'escalas', id);
const adminRef = () => doc(db, 'config', 'admin');

const emptySlots = () => Object.fromEntries(SLOT_KEYS.map((k) => [k, null]));

const withTimeout = (p, ms) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(new AppError('timeout')), ms))
]);

export function ensureAuth() {
  return new Promise((resolve, reject) => {
    const off = onAuthStateChanged(auth, async (user) => {
      if (user) {
        off();
        resolve(user);
        return;
      }
      try {
        await signInAnonymously(auth);
      } catch (e) {
        off();
        reject(e);
      }
    }, reject);
  });
}

export async function getProfile(uid) {
  let snap;
  try {
    snap = await withTimeout(getDocFromServer(userRef(uid)), 8000);
  } catch {
    snap = await getDoc(userRef(uid));
  }
  return snap.exists() ? snap.data() : null;
}

export function watchProfile(uid, cb) {
  return onSnapshot(userRef(uid), (s) => cb(s.exists() ? s.data() : null), () => {});
}

export async function getAdminUid() {
  try {
    const s = await getDoc(adminRef());
    return s.exists() ? s.data().uid : null;
  } catch {
    return null;
  }
}

export async function registerUser(uid, nome, om) {
  const batch = writeBatch(db);
  if (nome === ADMIN_NAME) {
    const adm = await getDocFromServer(adminRef());
    if (adm.exists() && adm.data().uid !== uid) throw new AppError('reserved');
    if (!adm.exists()) batch.set(adminRef(), { uid, createdAt: serverTimestamp() });
  }
  batch.set(userRef(uid), {
    nome, om,
    createdAt: serverTimestamp(),
    lastSeen: serverTimestamp(),
    bloqueado: false
  });
  await withTimeout(batch.commit(), 15000);
}

export async function syncServerClock(uid) {
  const t0 = Date.now();
  await withTimeout(updateDoc(userRef(uid), { lastSeen: serverTimestamp() }), 8000);
  const t1 = Date.now();
  const snap = await withTimeout(getDocFromServer(userRef(uid)), 8000);
  const serverMs = snap.data().lastSeen.toMillis();
  return serverMs - (t0 + t1) / 2;
}

export function watchScale(id, cb, onErr) {
  return onSnapshot(scaleRef(id), (s) => {
    cb({
      exists: s.exists(),
      slots: s.exists() ? { ...emptySlots(), ...s.data().slots } : emptySlots(),
      fromCache: s.metadata.fromCache
    });
  }, onErr);
}

export async function reserveSlot(id, key, uid, profile) {
  if (!SLOT_KEYS.includes(key)) throw new AppError('invalid');
  const ref = scaleRef(id);
  const slot = { uid, nome: profile.nome, om: profile.om, em: serverTimestamp() };
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      tx.set(ref, {
        data: id,
        createdAt: serverTimestamp(),
        slots: { ...emptySlots(), [key]: slot }
      });
      return;
    }
    const slots = { ...emptySlots(), ...snap.data().slots };
    if (SLOT_KEYS.some((k) => slots[k] && slots[k].uid === uid)) throw new AppError('already');
    if (slots[key]) throw new AppError('taken');
    tx.update(ref, { [`slots.${key}`]: slot });
  });
}

export async function releaseSlot(id, key, uid) {
  const ref = scaleRef(id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists() ? snap.data().slots[key] : null;
    if (!cur || cur.uid !== uid) throw new AppError('notmine');
    tx.update(ref, { [`slots.${key}`]: null });
  });
}

export async function adminRemoveSlot(id, key) {
  await withTimeout(updateDoc(scaleRef(id), { [`slots.${key}`]: null }), 15000);
}

export async function getScale(id) {
  const s = await getDoc(scaleRef(id));
  return s.exists() ? { ...emptySlots(), ...s.data().slots } : null;
}

export async function listHistory(beforeId, max = 120) {
  const q = query(
    collection(db, 'escalas'),
    where(documentId(), '<', beforeId),
    orderBy(documentId(), 'desc'),
    limit(max)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, slots: { ...emptySlots(), ...d.data().slots } }));
}

export async function listUsers() {
  const snap = await getDocs(query(collection(db, 'users'), orderBy('nome')));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

export async function setUserBlocked(uid, bloqueado) {
  await withTimeout(updateDoc(userRef(uid), { bloqueado }), 15000);
}
