import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, getDocFromServer, getDocs, updateDoc, deleteDoc, addDoc, onSnapshot, writeBatch,
  runTransaction, serverTimestamp, deleteField, collection, query, orderBy, limit
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { keysFor, emptySlots } from './escala.js?v=2.2.0';
import { APP_VERSION } from './versao.js?v=2.2.0';

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
  return onSnapshot(userRef(uid), (s) => cb(s.exists() ? s.data() : null, s.metadata.fromCache), () => {});
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
  if (!keysFor(id).includes(key)) throw new AppError('invalid');
  const ref = scaleRef(id);
  const slot = { uid, nome: profile.nome, om: profile.om, em: serverTimestamp() };
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      tx.set(ref, {
        data: id,
        createdAt: serverTimestamp(),
        slots: { [key]: slot },
        quem: { [uid]: key }
      });
      return;
    }
    const data = snap.data();
    const slots = data.slots || {};
    if ((data.quem && data.quem[uid]) || Object.keys(slots).some((k) => slots[k] && slots[k].uid === uid)) {
      throw new AppError('already');
    }
    if (slots[key]) throw new AppError('taken');
    tx.update(ref, { [`slots.${key}`]: slot, [`quem.${uid}`]: key });
  });
}

export async function releaseSlot(id, key, uid) {
  const ref = scaleRef(id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new AppError('notmine');
    const data = snap.data();
    const cur = (data.slots || {})[key] || null;
    if (!cur || cur.uid !== uid) throw new AppError('notmine');
    const indexed = data.quem && data.quem[uid] === key;
    tx.update(ref, indexed
      ? { [`slots.${key}`]: null, [`quem.${uid}`]: deleteField() }
      : { [`slots.${key}`]: null });
  });
}

function clearSeatsOf(data, uids) {
  const slots = data.slots || {};
  const up = {};
  for (const k of Object.keys(slots)) {
    if (slots[k] && uids.includes(slots[k].uid)) up[`slots.${k}`] = null;
  }
  for (const u of uids) if (data.quem && u in data.quem) up[`quem.${u}`] = deleteField();
  return up;
}

export async function adminRemoveSlot(id, key) {
  const ref = scaleRef(id);
  await withTimeout(runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const data = snap.data();
    const cur = (data.slots || {})[key];
    const up = { [`slots.${key}`]: null };
    if (cur && data.quem && cur.uid in data.quem) up[`quem.${cur.uid}`] = deleteField();
    tx.update(ref, up);
  }), 15000);
}

export async function completeIndex(id) {
  const ref = scaleRef(id);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists() || snap.data().quemCompleto === true) return;
    const slots = snap.data().slots || {};
    const quem = {};
    for (const k of Object.keys(slots)) if (slots[k] && slots[k].uid) quem[slots[k].uid] = k;
    tx.update(ref, { quem, quemCompleto: true });
  });
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

export async function deleteUser(uid, scaleIds) {
  await runTransaction(db, async (tx) => {
    const snaps = [];
    for (const id of scaleIds) snaps.push([id, await tx.get(scaleRef(id))]);
    for (const [id, snap] of snaps) {
      if (!snap.exists()) continue;
      const clear = clearSeatsOf(snap.data(), [uid]);
      if (Object.keys(clear).length) tx.update(scaleRef(id), clear);
    }
    tx.delete(userRef(uid));
  });
}

const cut = (v, n) => String(v ?? '').slice(0, n);

export async function logError(uid, nome, acao, err, escala = '') {
  try {
    await addDoc(collection(db, 'erros'), {
      uid,
      nome: cut(nome, 20),
      acao: cut(acao, 40),
      codigo: cut((err && err.code) || 'desconhecido', 60),
      detalhe: cut(err && err.message, 300),
      escala: cut(escala, 10),
      versao: cut(APP_VERSION, 10),
      em: serverTimestamp()
    });
  } catch { /* registro de erro é opcional */ }
}

export async function listErrors(max = 40) {
  const snap = await getDocs(query(collection(db, 'erros'), orderBy('em', 'desc'), limit(max)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function clearErrors(ids) {
  const batch = writeBatch(db);
  ids.slice(0, 400).forEach((id) => batch.delete(doc(db, 'erros', id)));
  await withTimeout(batch.commit(), 15000);
}

export async function rulesUpToDate() {
  try {
    await getDocFromServer(doc(db, 'meta', 'regras-2-2'));
    return true;
  } catch (e) {
    return !(e && e.code === 'permission-denied');
  }
}
