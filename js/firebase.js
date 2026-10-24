import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, getDocFromServer, getDocs, updateDoc, onSnapshot, writeBatch,
  runTransaction, serverTimestamp, collection, query, orderBy, limit
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { keysFor, emptySlots } from './escala.js';

const firebaseConfig = {
  apiKey: "AIzaSyCL8IFluqGulij4CPkzkwxWetuK6wNZK8M",
  authDomain: "listagrd.firebaseapp.com",
  projectId: "listagrd",
  storageBucket: "listagrd.firebasestorage.app",
  messagingSenderId: "494052483911",
  appId: "1:494052483911:web:cd5a456433c2612961e262"
};

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
const adminDeviceRef = (uid) => doc(db, 'admins', uid);

const withEmpty = (id, slots) => ({ ...emptySlots(id), ...(slots || {}) });

export async function hashSenha(senha) {
  const data = new TextEncoder().encode(`escala-sd-ev|${senha}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

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

export async function checkAdmin(uid) {
  try {
    const s = await getDoc(adminRef());
    if (s.exists() && s.data().uid === uid) return true;
    const d = await getDoc(adminDeviceRef(uid));
    return d.exists();
  } catch {
    return false;
  }
}

export async function registerUser(uid, nome, om, senha = '') {
  const batch = writeBatch(db);
  if (nome === ADMIN_NAME) {
    const adm = await getDocFromServer(adminRef());
    if (!adm.exists()) {
      batch.set(adminRef(), { uid, createdAt: serverTimestamp() });
    } else if (adm.data().uid !== uid) {
      if (!senha) throw new AppError('needpass');
      batch.set(adminDeviceRef(uid), { prova: await hashSenha(senha), createdAt: serverTimestamp() });
    }
  }
  batch.set(userRef(uid), {
    nome, om,
    createdAt: serverTimestamp(),
    lastSeen: serverTimestamp(),
    bloqueado: false
  });
  try {
    await withTimeout(batch.commit(), 15000);
  } catch (e) {
    if (nome === ADMIN_NAME && senha && e && e.code === 'permission-denied') throw new AppError('badpass');
    throw e;
  }
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
      slots: withEmpty(id, s.exists() ? s.data().slots : null),
      fromCache: s.metadata.fromCache
    });
  }, onErr);
}

export async function reserveSlot(id, key, uid, profile) {
  const keys = keysFor(id);
  if (!keys.includes(key)) throw new AppError('invalid');
  const ref = scaleRef(id);
  const slot = { uid, nome: profile.nome, om: profile.om, em: serverTimestamp() };
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      tx.set(ref, {
        data: id,
        createdAt: serverTimestamp(),
        slots: { ...emptySlots(id), [key]: slot }
      });
      return;
    }
    const slots = withEmpty(id, snap.data().slots);
    if (Object.keys(slots).some((k) => slots[k] && slots[k].uid === uid)) throw new AppError('already');
    if (slots[key]) throw new AppError('taken');
    tx.update(ref, { [`slots.${key}`]: slot });
  });
}

export async function releaseSlot(id, key, uid) {
  const ref = scaleRef(id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists() ? snap.data().slots[key] || null : null;
    if (!cur || cur.uid !== uid) throw new AppError('notmine');
    tx.update(ref, { [`slots.${key}`]: null });
  });
}

export async function adminRemoveSlot(id, key) {
  await withTimeout(updateDoc(scaleRef(id), { [`slots.${key}`]: null }), 15000);
}

export async function getScale(id) {
  const s = await getDoc(scaleRef(id));
  return s.exists() ? withEmpty(id, s.data().slots) : null;
}

export async function listHistory(beforeId, max = 120) {
  const toItems = (docs) => docs
    .map((d) => ({ id: d.id, slots: withEmpty(d.id, d.data().slots) }))
    .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.id) && x.id < beforeId)
    .sort((a, b) => (a.id < b.id ? 1 : -1))
    .slice(0, max);
  try {
    const snap = await withTimeout(getDocs(query(collection(db, 'escalas'), orderBy('data', 'desc'), limit(max + 5))), 15000);
    return toItems(snap.docs);
  } catch (e) {
    console.warn('Histórico: consulta ordenada falhou, usando leitura simples.', e);
    const snap = await withTimeout(getDocs(collection(db, 'escalas')), 15000);
    return toItems(snap.docs);
  }
}

export async function listUsers() {
  const snap = await getDocs(query(collection(db, 'users'), orderBy('nome')));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

export async function setUserBlocked(uid, bloqueado) {
  await withTimeout(updateDoc(userRef(uid), { bloqueado }), 15000);
}
