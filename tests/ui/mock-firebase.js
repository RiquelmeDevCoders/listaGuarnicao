import { emptySlots } from './escala.js';
const M = window.__MOCK || {};
export const ADMIN_NAME = 'RIQUELME';
export class AppError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}
const ts = (ms) => ({ toMillis: () => ms });
const empty = (id) => emptySlots(id);
const store = { users: M.users || {}, escalas: M.escalas || {}, admin: M.admin || null, devices: M.devices || [], secret: M.secret || '2511' };
const listeners = new Map();
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const uid0 = M.uid || 'me';
function emit(id) {
  const cb = listeners.get(id);
  if (cb) cb({ exists: !!store.escalas[id], slots: { ...empty(id), ...(store.escalas[id] || {}) }, fromCache: false });
}
window.__mock = {
  store,
  take(id, key, s) { store.escalas[id] = { ...(store.escalas[id] || {}), [key]: s }; emit(id); },
  clear(id, key) { store.escalas[id] = { ...(store.escalas[id] || {}), [key]: null }; emit(id); },
  setProfile(p) { store.users[uid0] = { ...store.users[uid0], ...p }; window.__mock.profileCb && window.__mock.profileCb(store.users[uid0]); }
};
export async function ensureAuth() { return { uid: uid0 }; }
export async function getProfile(uid) { return store.users[uid] || null; }
export function watchProfile(uid, cb) { window.__mock.profileCb = cb; return () => {}; }
export async function checkAdmin(uid) { return store.admin === uid || store.devices.includes(uid); }
export async function registerUser(uid, nome, om, senha = '') {
  await delay(100);
  if (nome === ADMIN_NAME) {
    if (!store.admin) store.admin = uid;
    else if (store.admin !== uid) {
      if (!senha) throw new AppError('needpass');
      if (senha !== store.secret) throw new AppError('badpass');
      store.devices.push(uid);
    }
  }
  store.users[uid] = { nome, om, bloqueado: false, createdAt: ts(Date.now()), lastSeen: ts(Date.now()) };
}
export async function syncServerClock() { return M.offset || 0; }
export function watchScale(id, cb) { listeners.set(id, cb); setTimeout(() => emit(id), 30); return () => listeners.delete(id); }
export async function reserveSlot(id, key, uid, profile) {
  await delay(150);
  if (M.raceKey === key) {
    window.__mock.take(id, key, { uid: 'other', nome: 'CARLOS', om: 'PE' });
    throw new AppError('taken');
  }
  const s = store.escalas[id] || {};
  if (Object.values(s).some((v) => v && v.uid === uid)) throw new AppError('already');
  if (s[key]) throw new AppError('taken');
  window.__mock.take(id, key, { uid, nome: profile.nome, om: profile.om });
}
export async function releaseSlot(id, key, uid) {
  await delay(100);
  const s = store.escalas[id] || {};
  if (!s[key] || s[key].uid !== uid) throw new AppError('notmine');
  window.__mock.clear(id, key);
}
export async function adminRemoveSlot(id, key) { window.__mock.clear(id, key); }
export async function getScale(id) { return store.escalas[id] ? { ...empty(id), ...store.escalas[id] } : null; }
export async function listHistory(beforeId) {
  return Object.keys(store.escalas).filter((k) => k < beforeId).sort().reverse()
    .map((id) => ({ id, slots: { ...empty(id), ...store.escalas[id] } }));
}
export async function listUsers() {
  return Object.entries(store.users).map(([uid, u]) => ({ uid, createdAt: ts(Date.now()), lastSeen: ts(Date.now()), ...u }))
    .sort((a, b) => a.nome.localeCompare(b.nome));
}
export async function setUserBlocked(uid, b) { store.users[uid].bloqueado = b; }
