import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertFails, assertSucceeds
} from '@firebase/rules-unit-testing';
import {
  doc, setDoc, getDoc, getDocs, updateDoc, deleteDoc, writeBatch, collection,
  serverTimestamp, runTransaction, Timestamp
} from 'firebase/firestore';
import { nextScaleId, todayId, addDays, openingMs } from '../js/time.js';

const SLOT_KEYS = ['h1p1', 'h1p2', 'h1p3', 'h2p1', 'h2p2', 'h2p3', 'h3p1', 'h3p2', 'h3p3'];
const empty = () => Object.fromEntries(SLOT_KEYS.map((k) => [k, null]));

const NOW = Date.now();
const TOMORROW = nextScaleId(NOW);
const TODAY = todayId(NOW);
const FUTURE = addDays(TOMORROW, 1);
const OPEN = NOW >= openingMs(TOMORROW);

let env;

const db = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

async function seedUser(uid, nome, om = 'CIA C', bloqueado = false) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), {
      nome, om, bloqueado, createdAt: Timestamp.now(), lastSeen: Timestamp.now()
    });
  });
}

async function seedScale(id, slots = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'escalas', id), {
      data: id, createdAt: Timestamp.now(), slots: { ...empty(), ...slots }
    });
  });
}

async function seedAdmin(uid) {
  await seedUser(uid, 'RIQUELME', 'CIA C');
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'config', 'admin'), { uid, createdAt: Timestamp.now() });
  });
}

const slot = (uid, nome, om = 'CIA C') => ({ uid, nome, om, em: serverTimestamp() });
const stored = (uid, nome, om = 'CIA C') => ({ uid, nome, om, em: Timestamp.now() });

const newUser = (nome, om = 'CIA C', extra = {}) => ({
  nome, om, createdAt: serverTimestamp(), lastSeen: serverTimestamp(), bloqueado: false, ...extra
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-listagrd',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 }
  });
});

after(async () => env && env.cleanup());

beforeEach(async () => env.clearFirestore());

test('cadastro válido e campos obrigatórios', async () => {
  await assertSucceeds(setDoc(doc(db('a'), 'users', 'a'), newUser('SILVA', 'PE')));
  await assertFails(setDoc(doc(db('b'), 'users', 'b'), newUser('SILVA', 'CIA X')));
  await assertFails(setDoc(doc(db('c'), 'users', 'c'), newUser('s')));
  await assertFails(setDoc(doc(db('d'), 'users', 'd'), newUser('SILVA<script>')));
  await assertFails(setDoc(doc(db('e'), 'users', 'e'), newUser('SILVA', 'PE', { admin: true })));
  await assertFails(setDoc(doc(db('f'), 'users', 'f'), newUser('SILVA', 'PE', { bloqueado: true })));
  await assertFails(setDoc(doc(db('g'), 'users', 'g'), { ...newUser('SILVA'), createdAt: Timestamp.fromMillis(0) }));
  await assertFails(setDoc(doc(db('h'), 'users', 'outro'), newUser('SILVA')));
  await assertFails(setDoc(doc(anon(), 'users', 'x'), newUser('SILVA')));
});

test('nome RIQUELME só com reivindicação de administrador', async () => {
  await assertFails(setDoc(doc(db('r1'), 'users', 'r1'), newUser('RIQUELME')));
  const b = writeBatch(db('r1'));
  b.set(doc(db('r1'), 'config', 'admin'), { uid: 'r1', createdAt: serverTimestamp() });
  b.set(doc(db('r1'), 'users', 'r1'), newUser('RIQUELME'));
  await assertSucceeds(b.commit());
  const b2 = writeBatch(db('r2'));
  b2.set(doc(db('r2'), 'config', 'admin'), { uid: 'r2', createdAt: serverTimestamp() });
  b2.set(doc(db('r2'), 'users', 'r2'), newUser('RIQUELME'));
  await assertFails(b2.commit());
  await assertFails(setDoc(doc(db('r2'), 'users', 'r2'), newUser('RIQUELME')));
  await assertFails(updateDoc(doc(db('r2'), 'config', 'admin'), { uid: 'r2' }));
  await assertFails(deleteDoc(doc(db('r1'), 'config', 'admin')));
});

test('admin não pode ser reivindicado com outro nome', async () => {
  const b = writeBatch(db('x'));
  b.set(doc(db('x'), 'config', 'admin'), { uid: 'x', createdAt: serverTimestamp() });
  b.set(doc(db('x'), 'users', 'x'), newUser('SOUZA'));
  await assertFails(b.commit());
});

test('perfil: leitura própria, sem alterar nome, sem excluir', async () => {
  await seedUser('a', 'SILVA');
  await seedUser('b', 'SOUZA');
  await assertSucceeds(getDoc(doc(db('a'), 'users', 'a')));
  await assertFails(getDoc(doc(db('a'), 'users', 'b')));
  await assertFails(getDocs(collection(db('a'), 'users')));
  await assertSucceeds(updateDoc(doc(db('a'), 'users', 'a'), { lastSeen: serverTimestamp() }));
  await assertFails(updateDoc(doc(db('a'), 'users', 'a'), { nome: 'OUTRO' }));
  await assertFails(updateDoc(doc(db('a'), 'users', 'a'), { bloqueado: false, lastSeen: serverTimestamp(), om: 'PE' }));
  await assertFails(updateDoc(doc(db('a'), 'users', 'b'), { lastSeen: serverTimestamp() }));
  await assertFails(deleteDoc(doc(db('a'), 'users', 'a')));
});

test('escala: só lê quem tem cadastro', async () => {
  await seedUser('a', 'SILVA');
  await seedScale(TODAY);
  await assertSucceeds(getDoc(doc(db('a'), 'escalas', TODAY)));
  await assertFails(getDoc(doc(db('semcadastro'), 'escalas', TODAY)));
  await assertFails(getDoc(doc(anon(), 'escalas', TODAY)));
});

test('não é possível criar escala de hoje, de depois de amanhã ou com data inválida', async () => {
  await seedUser('a', 'SILVA');
  for (const id of [TODAY, FUTURE, '2026-13-01', 'qualquer']) {
    await assertFails(setDoc(doc(db('a'), 'escalas', id), {
      data: id, createdAt: serverTimestamp(), slots: { ...empty(), h1p1: slot('a', 'SILVA') }
    }));
  }
});

test('criação da escala de amanhã respeita o horário do servidor', async () => {
  await seedUser('a', 'SILVA');
  const p = setDoc(doc(db('a'), 'escalas', TOMORROW), {
    data: TOMORROW, createdAt: serverTimestamp(), slots: { ...empty(), h2p2: slot('a', 'SILVA') }
  });
  if (OPEN) await assertSucceeds(p);
  else await assertFails(p);
});

test('criação inválida da escala de amanhã', { skip: !OPEN && 'fora do horário de abertura' }, async () => {
  await seedUser('a', 'SILVA');
  const ref = doc(db('a'), 'escalas', TOMORROW);
  const base = { data: TOMORROW, createdAt: serverTimestamp() };
  await assertFails(setDoc(ref, { ...base, slots: { ...empty(), h1p1: slot('a', 'SILVA'), h1p2: slot('a', 'SILVA') } }));
  await assertFails(setDoc(ref, { ...base, slots: { ...empty(), h1p1: slot('b', 'SOUZA') } }));
  await assertFails(setDoc(ref, { ...base, slots: { ...empty(), h1p1: slot('a', 'FALSO') } }));
  await assertFails(setDoc(ref, { ...base, slots: { ...empty(), h4p1: slot('a', 'SILVA') } }));
  await assertFails(setDoc(ref, { ...base, data: FUTURE, slots: empty() }));
  await assertFails(setDoc(ref, { ...base, slots: empty(), extra: 1 }));
});

test('reserva, vaga ocupada, segunda vaga, cancelamento', { skip: !OPEN && 'fora do horário de abertura' }, async () => {
  await seedUser('a', 'SILVA');
  await seedUser('b', 'SOUZA', 'PE');
  await seedScale(TOMORROW, { h1p1: stored('b', 'SOUZA', 'PE') });
  const refA = doc(db('a'), 'escalas', TOMORROW);
  await assertFails(updateDoc(refA, { 'slots.h1p1': slot('a', 'SILVA') }));
  await assertFails(updateDoc(refA, { 'slots.h1p1': null }));
  await assertFails(updateDoc(refA, { 'slots.h1p2': slot('b', 'SOUZA', 'PE') }));
  await assertFails(updateDoc(refA, { 'slots.h1p2': { ...slot('a', 'SILVA'), om: 'PE' } }));
  await assertFails(updateDoc(refA, { 'slots.h1p2': { ...slot('a', 'SILVA'), em: Timestamp.fromMillis(0) } }));
  await assertFails(updateDoc(refA, { 'slots.h1p2': slot('a', 'SILVA'), 'slots.h1p3': slot('a', 'SILVA') }));
  await assertFails(updateDoc(refA, { 'slots.h9p9': slot('a', 'SILVA') }));
  await assertFails(updateDoc(refA, { data: FUTURE }));
  await assertSucceeds(updateDoc(refA, { 'slots.h2p2': slot('a', 'SILVA') }));
  await assertFails(updateDoc(refA, { 'slots.h3p3': slot('a', 'SILVA') }));
  await assertFails(updateDoc(refA, { 'slots.h2p2': null, 'slots.h3p3': slot('a', 'SILVA') }));
  await assertSucceeds(updateDoc(refA, { 'slots.h2p2': null }));
  await assertSucceeds(updateDoc(refA, { 'slots.h3p3': slot('a', 'SILVA') }));
  await assertFails(deleteDoc(refA));
});

test('concorrência: 10 militares disputando a mesma vaga, apenas 1 consegue', { skip: !OPEN && 'fora do horário de abertura' }, async () => {
  const uids = Array.from({ length: 10 }, (_, i) => `u${i}`);
  for (const u of uids) await seedUser(u, `MILITAR ${String.fromCharCode(65 + Number(u.slice(1)))}`);
  const results = await Promise.allSettled(uids.map((u) => {
    const fs = db(u);
    const ref = doc(fs, 'escalas', TOMORROW);
    return runTransaction(fs, async (tx) => {
      const snap = await tx.get(ref);
      const nome = `MILITAR ${String.fromCharCode(65 + Number(u.slice(1)))}`;
      const s = { uid: u, nome, om: 'CIA C', em: serverTimestamp() };
      if (!snap.exists()) {
        tx.set(ref, { data: TOMORROW, createdAt: serverTimestamp(), slots: { ...empty(), h2p2: s } });
        return;
      }
      if (snap.data().slots.h2p2) throw new Error('taken');
      tx.update(ref, { 'slots.h2p2': s });
    });
  }));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const final = await env.withSecurityRulesDisabled(async (ctx) =>
    (await getDoc(doc(ctx.firestore(), 'escalas', TOMORROW))).data());
  assert.ok(final.slots.h2p2);
});

test('militar bloqueado não reserva', { skip: !OPEN && 'fora do horário de abertura' }, async () => {
  await seedUser('a', 'SILVA', 'CIA C', true);
  await seedScale(TOMORROW);
  await assertFails(updateDoc(doc(db('a'), 'escalas', TOMORROW), { 'slots.h1p1': slot('a', 'SILVA') }));
});

test('escala antiga não pode ser alterada por militar comum', async () => {
  await seedUser('a', 'SILVA');
  await seedScale(TODAY, { h1p1: stored('a', 'SILVA') });
  await assertFails(updateDoc(doc(db('a'), 'escalas', TODAY), { 'slots.h1p1': null }));
  await assertFails(updateDoc(doc(db('a'), 'escalas', TODAY), { 'slots.h1p2': slot('a', 'SILVA') }));
  await assertFails(deleteDoc(doc(db('a'), 'escalas', TODAY)));
});

test('administrador: remove vagas, lista e bloqueia militares', async () => {
  await seedAdmin('adm');
  await seedUser('a', 'SILVA');
  await seedScale(TODAY, { h1p1: stored('a', 'SILVA') });
  const ref = doc(db('adm'), 'escalas', TODAY);
  await assertFails(updateDoc(ref, { 'slots.h1p2': slot('a', 'SILVA') }));
  await assertSucceeds(updateDoc(ref, { 'slots.h1p1': null }));
  await assertFails(deleteDoc(ref));
  await assertSucceeds(getDocs(collection(db('adm'), 'users')));
  await assertSucceeds(updateDoc(doc(db('adm'), 'users', 'a'), { bloqueado: true }));
  await assertFails(updateDoc(doc(db('a'), 'users', 'a'), { bloqueado: false }));
  await assertFails(updateDoc(doc(db('adm'), 'users', 'a'), { createdAt: Timestamp.now() }));
  await assertFails(updateDoc(doc(db('a'), 'escalas', TODAY), { 'slots.h1p1': null }));
});

test('coleções desconhecidas são bloqueadas', async () => {
  await seedUser('a', 'SILVA');
  await assertFails(setDoc(doc(db('a'), 'qualquer', 'x'), { a: 1 }));
  await assertFails(getDoc(doc(db('a'), 'qualquer', 'x')));
});
