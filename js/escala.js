export const DOUBLE_FROM = '2026-10-25';
export const SINGLE_FROM = '2026-10-31';

const BASE_KEYS = ['h1p1', 'h1p2', 'h1p3', 'h2p1', 'h2p2', 'h2p3', 'h3p1', 'h3p2', 'h3p3'];

export const isDouble = (id) => id >= DOUBLE_FROM && id < SINGLE_FROM;

export function seatsOf(id, h, p) {
  const k = `h${h}p${p}`;
  return isDouble(id) ? [k, `${k}b`] : [k];
}

// Em escala de posto normal, mostra a vaga 2 só se alguém já estava nela
// (marcada quando a escala ainda era de posto duplo).
export function seatsShown(id, h, p, slots) {
  const k = `h${h}p${p}`;
  if (isDouble(id)) return [k, `${k}b`];
  return slots && slots[`${k}b`] ? [k, `${k}b`] : [k];
}

export function keysFor(id) {
  return isDouble(id) ? BASE_KEYS.flatMap((k) => [k, `${k}b`]) : [...BASE_KEYS];
}

export const capacityOf = (id) => keysFor(id).length;

export function emptySlots(id) {
  return Object.fromEntries(keysFor(id).map((k) => [k, null]));
}

export function keyInfo(k) {
  return { h: +k[1], p: +k[3], seat: k.endsWith('b') ? 2 : 1 };
}
