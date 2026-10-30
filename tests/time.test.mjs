import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  todayId, nextScaleId, weekdayName, openingMs, closingMs, scaleStatus, STATUS, formatBR, addDays
} from '../js/time.js';

const brt = (y, m, d, h = 0, min = 0) => Date.UTC(y, m - 1, d, h + 3, min);

test('escala é sempre do dia seguinte (horário de Brasília)', () => {
  const cases = [
    [brt(2026, 10, 4, 10), '2026-10-05', 'SEGUNDA-FEIRA'],
    [brt(2026, 10, 5, 10), '2026-10-06', 'TERÇA-FEIRA'],
    [brt(2026, 10, 6, 10), '2026-10-07', 'QUARTA-FEIRA'],
    [brt(2026, 10, 7, 10), '2026-10-08', 'QUINTA-FEIRA'],
    [brt(2026, 10, 8, 10), '2026-10-09', 'SEXTA-FEIRA'],
    [brt(2026, 10, 9, 10), '2026-10-10', 'SÁBADO'],
    [brt(2026, 10, 10, 10), '2026-10-11', 'DOMINGO']
  ];
  for (const [ms, id, name] of cases) {
    assert.equal(nextScaleId(ms), id);
    assert.equal(weekdayName(id), name);
  }
});

test('virada de dia segue Brasília e não o UTC', () => {
  assert.equal(todayId(brt(2026, 10, 4, 23, 59)), '2026-10-04');
  assert.equal(nextScaleId(brt(2026, 10, 4, 23, 59)), '2026-10-05');
  assert.equal(todayId(brt(2026, 10, 5, 0, 0)), '2026-10-05');
  assert.equal(nextScaleId(brt(2026, 10, 5, 0, 0)), '2026-10-06');
});

test('virada de mês e ano', () => {
  assert.equal(nextScaleId(brt(2026, 9, 30, 20)), '2026-10-01');
  assert.equal(nextScaleId(brt(2026, 12, 31, 20)), '2027-01-01');
  assert.equal(nextScaleId(brt(2028, 2, 28, 20)), '2028-02-29');
  assert.equal(addDays('2027-01-01', -1), '2026-12-31');
});

test('abertura: seg-sex 18:00, sáb e dom 16:00 (dia atual)', () => {
  assert.equal(openingMs('2026-10-05'), brt(2026, 10, 4, 16));
  assert.equal(openingMs('2026-10-06'), brt(2026, 10, 5, 18));
  assert.equal(openingMs('2026-10-10'), brt(2026, 10, 9, 18));
  assert.equal(openingMs('2026-10-11'), brt(2026, 10, 10, 16));
  assert.equal(closingMs('2026-10-05'), brt(2026, 10, 5, 0));
});

test('status ao longo do tempo', () => {
  const id = '2026-10-05';
  assert.equal(scaleStatus(id, brt(2026, 10, 4, 15, 59), 0), STATUS.WAITING);
  assert.equal(scaleStatus(id, brt(2026, 10, 4, 16, 0), 0), STATUS.OPEN);
  assert.equal(scaleStatus(id, brt(2026, 10, 4, 17, 0), 3), STATUS.OPEN);
  assert.equal(scaleStatus(id, brt(2026, 10, 4, 20, 0), 9), STATUS.FULL);
  assert.equal(scaleStatus(id, brt(2026, 10, 5, 0, 0), 4), STATUS.CLOSED);
  const tue = '2026-10-06';
  assert.equal(scaleStatus(tue, brt(2026, 10, 5, 17, 59), 0), STATUS.WAITING);
  assert.equal(scaleStatus(tue, brt(2026, 10, 5, 18, 0), 0), STATUS.OPEN);
  const sun = '2026-10-11';
  assert.equal(scaleStatus(sun, brt(2026, 10, 10, 15, 59), 0), STATUS.WAITING);
  assert.equal(scaleStatus(sun, brt(2026, 10, 10, 16, 0), 0), STATUS.OPEN);
});

test('cálculo de dia da semana das regras = JavaScript', () => {
  let id = '2024-01-01';
  for (let i = 0; i < 1500; i++) {
    const days = Date.UTC(+id.slice(0, 4), +id.slice(5, 7) - 1, +id.slice(8, 10)) / 86400000;
    assert.equal((Math.trunc(days) + 4) % 7, new Date(days * 86400000).getUTCDay());
    id = addDays(id, 1);
  }
});

test('formato de data', () => {
  assert.equal(formatBR('2026-10-05'), '05/10/2026');
});

test('posto duplo só entre 25/10 e 30/10/2026', async () => {
  const { isDouble, capacityOf } = await import('../js/escala.js');
  assert.equal(isDouble('2026-10-24'), false);
  assert.equal(isDouble('2026-10-25'), true);
  assert.equal(isDouble('2026-10-30'), true);
  assert.equal(isDouble('2026-10-31'), false);
  assert.equal(isDouble('2026-11-01'), false);
  assert.equal(capacityOf('2026-11-01'), 9);
  assert.equal(capacityOf('2026-10-28'), 18);
});
