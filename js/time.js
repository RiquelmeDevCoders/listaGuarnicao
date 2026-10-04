export const TZ = 'America/Sao_Paulo';
const BRT_OFFSET_H = 3;
const DAY_MS = 86400000;

export const WEEKDAYS = [
  'DOMINGO', 'SEGUNDA-FEIRA', 'TERÇA-FEIRA', 'QUARTA-FEIRA',
  'QUINTA-FEIRA', 'SEXTA-FEIRA', 'SÁBADO'
];

const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23'
});

export function brtParts(ms) {
  const p = {};
  for (const { type, value } of partsFmt.formatToParts(new Date(ms))) p[type] = value;
  return {
    y: +p.year, m: +p.month, d: +p.day,
    h: +p.hour % 24, min: +p.minute, s: +p.second
  };
}

const pad = (n) => String(n).padStart(2, '0');

export function idFromUtc(ms) {
  const dt = new Date(ms);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function idToUtc(id) {
  const [y, m, d] = id.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(id, n) {
  return idFromUtc(idToUtc(id) + n * DAY_MS);
}

export function todayId(nowMs) {
  const { y, m, d } = brtParts(nowMs);
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function nextScaleId(nowMs) {
  return addDays(todayId(nowMs), 1);
}

export function weekdayOf(id) {
  return new Date(idToUtc(id)).getUTCDay();
}

export function weekdayName(id) {
  return WEEKDAYS[weekdayOf(id)];
}

export function openingHour(eveId) {
  const wd = weekdayOf(eveId);
  return wd === 0 || wd === 6 ? 16 : 18;
}

export function openingMs(scaleId) {
  const eve = addDays(scaleId, -1);
  return idToUtc(eve) + (openingHour(eve) + BRT_OFFSET_H) * 3600000;
}

export function closingMs(scaleId) {
  return idToUtc(scaleId) + BRT_OFFSET_H * 3600000;
}

export const STATUS = {
  WAITING: 'AGUARDANDO LIBERAÇÃO',
  OPEN: 'ABERTA',
  FULL: 'PREENCHIDA',
  CLOSED: 'ENCERRADA'
};

export function scaleStatus(scaleId, nowMs, filled) {
  if (nowMs >= closingMs(scaleId)) return STATUS.CLOSED;
  if (nowMs < openingMs(scaleId)) return STATUS.WAITING;
  return filled >= 9 ? STATUS.FULL : STATUS.OPEN;
}

export function formatBR(id) {
  const [y, m, d] = id.split('-');
  return `${d}/${m}/${y}`;
}

export function formatClock(ms) {
  const { h, min } = brtParts(ms);
  return `${pad(h)}:${pad(min)}`;
}

export function formatDateTime(ms) {
  const { y, m, d, h, min } = brtParts(ms);
  return `${pad(d)}/${pad(m)}/${y} ${pad(h)}:${pad(min)}`;
}

export function formatCountdown(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;
}

export function greeting(nowMs) {
  const { h } = brtParts(nowMs);
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 18) return 'Boa tarde';
  return 'Boa noite';
}
