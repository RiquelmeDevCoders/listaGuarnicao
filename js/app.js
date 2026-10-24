import {
  ADMIN_NAME, AppError, ensureAuth, getProfile, watchProfile, checkAdmin,
  registerUser, syncServerClock, watchScale, reserveSlot, releaseSlot, adminRemoveSlot,
  getScale, listHistory, listUsers, setUserBlocked
} from './firebase.js';
import { isDouble, seatsOf, capacityOf, keyInfo } from './escala.js';
import { APP_VERSION, NOVIDADES } from './versao.js';
import {
  STATUS, todayId, nextScaleId, addDays, weekdayName, openingMs, scaleStatus,
  formatBR, formatClock, formatDateTime, formatCountdown, greeting, openingHour
} from './time.js';

const WHATSAPP_GROUP = 'https://chat.whatsapp.com/CT5EigeEZAr36FZMgSYE2r?s=cl&p=i&mlu=4&ilr=4';
const SHIFT_NAMES = ['PRIMEIRO HORÁRIO', 'SEGUNDO HORÁRIO', 'TERCEIRO HORÁRIO'];
const NOME_RE = /^[A-ZÁÂÃÀÉÊÍÓÔÕÚÜÇ][A-ZÁÂÃÀÉÊÍÓÔÕÚÜÇ ]*[A-ZÁÂÃÀÉÊÍÓÔÕÚÜÇ]$/;

const MSG = {
  registered: 'Cadastro realizado com sucesso!',
  reserved: 'Vaga reservada com sucesso!',
  taken: 'Essa vaga acabou de ser ocupada por outro militar. Escolha outra disponível.',
  already: 'Você já possui uma vaga nesta escala.',
  notOpen: 'Escala ainda não está liberada.',
  full: 'Escala preenchida.',
  changed: 'Alteração realizada com sucesso.',
  closed: 'Esta escala está encerrada.',
  offline: 'Sem conexão. A vaga só é confirmada com internet.',
  blocked: 'Seu acesso está bloqueado. Procure o administrador.',
  generic: 'Não foi possível concluir. Tente novamente.'
};

const ICONS = {
  ok: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>',
  err: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/></svg>',
  warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l10 18H2zM12 10v4M12 18h.01"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  ban: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>'
};

const S = {
  uid: null,
  profile: null,
  isAdmin: false,
  offset: 0,
  syncedAt: 0,
  scaleId: null,
  slots: null,
  unsubScale: null,
  unsubProfile: null,
  lastStatus: null,
  busy: false,
  history: null,
  users: null,
  detailId: null,
  detailSlots: null,
  started: false
};

const $ = (id) => document.getElementById(id);
const now = () => Date.now() + S.offset;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const filledCount = (slots) => (slots ? Object.values(slots).filter(Boolean).length : 0);
const mySlotKey = (slots) => (slots ? Object.keys(slots).find((k) => slots[k] && slots[k].uid === S.uid) : null) || null;
const seatLabel = (id, k) => {
  const { h, p, seat } = keyInfo(k);
  return `${h}º horário, P${p}${isDouble(id) ? ` (vaga ${seat} de 2)` : ''}`;
};
const appUrl = () => location.origin + location.pathname.replace(/index\.html$/, '');

function show(view) {
  for (const el of document.querySelectorAll('.view')) el.classList.toggle('hidden', el.id !== `view-${view}`);
  const inside = ['home', 'history', 'detail', 'admin'].includes(view);
  $('navHome').classList.toggle('hidden', !inside || view === 'home');
  $('navAdmin').classList.toggle('hidden', !inside || !S.isAdmin || view === 'admin');
  window.scrollTo(0, 0);
}

function toast(text, type = 'ok', ms = 3600) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', type === 'err' ? 'alert' : 'status');
  el.innerHTML = `${ICONS[type] || ICONS.info}<span>${esc(text)}</span>`;
  const box = $('toasts');
  while (box.children.length >= 3) box.firstChild.remove();
  box.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 220);
  }, ms);
}

function confirmModal({ title, text = '', ok = 'CONFIRMAR', eyebrow = 'CONFIRMAÇÃO', danger = false, single = false }) {
  const modal = $('modal');
  modal.querySelector('button[value="cancel"]').classList.toggle('hidden', single);
  modal.querySelector('.grid2').classList.toggle('single', single);
  $('modalTitle').textContent = title;
  $('modalText').textContent = text;
  $('modalEyebrow').textContent = eyebrow;
  const okBtn = $('modalOk');
  okBtn.textContent = ok;
  okBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      if (modal.open) modal.close();
      modal.removeAttribute('open');
      modal.querySelectorAll('button').forEach((b) => b.removeEventListener('click', onClick));
      modal.removeEventListener('cancel', onCancel);
      resolve(v);
    };
    const onClick = (e) => {
      e.preventDefault();
      finish(e.currentTarget.value === 'ok');
    };
    const onCancel = (e) => {
      e.preventDefault();
      finish(false);
    };
    modal.querySelectorAll('button').forEach((b) => b.addEventListener('click', onClick));
    modal.addEventListener('cancel', onCancel);
    if (typeof modal.showModal === 'function') modal.showModal();
    else modal.setAttribute('open', '');
    okBtn.focus();
  });
}

function errorMessage(e) {
  const code = e && e.code;
  if (code === 'taken' || code === 'aborted') return [MSG.taken, 'err'];
  if (code === 'already') return [MSG.already, 'warn'];
  if (code === 'reserved') return ['Este nome de guerra é reservado ao administrador.', 'err'];
  if (code === 'notmine') return ['Esta vaga não está mais em seu nome.', 'warn'];
  if (code === 'unavailable' || code === 'timeout' || code === 'deadline-exceeded') return [MSG.offline, 'err'];
  if (code === 'permission-denied') {
    if (S.profile && S.profile.bloqueado) return [MSG.blocked, 'err'];
    if (S.scaleId) {
      const st = currentStatus();
      if (st === STATUS.WAITING) return [MSG.notOpen, 'warn'];
      if (st === STATUS.CLOSED) return [MSG.closed, 'warn'];
    }
    return ['Operação não permitida. Atualize a página e tente novamente.', 'err'];
  }
  return [MSG.generic, 'err'];
}

function fail(e) {
  const [text, type] = errorMessage(e);
  toast(text, type, 5000);
}

async function share(text, title, fallback) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  await fallback();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

function scaleText(id, slots) {
  const lines = ['*LISTA DA GUARNIÇÃO*', `Escala de ${weekdayName(id)} — ${formatBR(id)}`];
  for (let h = 1; h <= 3; h++) {
    lines.push('', `*${h}º HORÁRIO*`);
    for (let p = 1; p <= 3; p++) {
      for (const k of seatsOf(id, h, p)) {
        const s = slots && slots[k];
        lines.push(`P${p} - ${s ? `${s.nome} | ${s.om}` : ''}`);
      }
    }
  }
  lines.push('', `Vagas preenchidas: ${filledCount(slots)}/${capacityOf(id)}`, `Sistema: ${appUrl()}`);
  return lines.join('\n');
}

function shareScale(id, slots) {
  const text = scaleText(id, slots);
  share(text, 'Lista da Guarnição', async () => {
    const copied = await copyText(text);
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    if (copied) toast('Escala copiada! Cole no WhatsApp se necessário.');
  });
}

function shareApp() {
  const url = appUrl();
  const text = `Confira e preencha a escala da guarnição pelo sistema:\n\n${url}`;
  share(text, 'Escala SD EV', async () => {
    const copied = await copyText(url);
    toast(copied ? 'Link copiado!' : url, copied ? 'ok' : 'info', 5000);
  });
}

function seatHtml(key, slot, ctx) {
  const { h, p, seat } = keyInfo(key);
  const mine = slot && slot.uid === S.uid;
  const cls = !slot ? 'free' : mine ? 'mine' : 'taken';
  const stateTxt = !slot ? 'Livre' : mine ? 'Sua vaga' : 'Ocupada';
  const state = ctx.double ? `Vaga ${seat} · ${stateTxt}` : stateTxt;
  const name = slot
    ? `${esc(slot.nome)} <span class="om">| ${esc(slot.om)}</span>`
    : 'Disponível';
  const where = `${h}º horário, P${p}${ctx.double ? `, vaga ${seat}` : ''}`;
  const label = `${where}: ${slot ? `${slot.nome}, ${slot.om}` : 'disponível'}`;
  let action = '';
  if (!slot) {
    if (ctx.live && (ctx.status === STATUS.OPEN)) {
      const blocked = ctx.hasMine || (S.profile && S.profile.bloqueado);
      action = `<button type="button" class="btn ${blocked ? 'btn-ghost' : 'btn-primary'}" data-act="take" data-key="${key}" aria-label="Escolher ${where}">ESCOLHER</button>`;
    } else if (ctx.live && ctx.status === STATUS.WAITING) {
      action = `<span class="lock">${ICONS.clock}AGUARDE</span>`;
    }
  } else if (mine && ctx.live) {
    action = '<span class="you">VOCÊ</span>';
  } else {
    action = `<span class="lock" title="Ocupada">${ICONS.lock}</span>`;
  }
  if (slot && S.isAdmin && !(mine && ctx.live)) {
    action = `<button type="button" class="btn btn-danger btn-sm" data-act="admrm" data-key="${key}" aria-label="Remover ${esc(slot.nome)} da vaga">REMOVER</button>`;
  }
  return `<li class="slot ${cls}" aria-label="${esc(label)}">
    <span class="slot-body"><span class="slot-state">${state}</span><span class="slot-name">${name}</span></span>
    ${action}
  </li>`;
}

function renderSlots(container, slots, ctx, id) {
  const double = isDouble(id);
  const c = { ...ctx, double };
  let html = '';
  for (let h = 1; h <= 3; h++) {
    html += `<section class="shift" aria-label="${SHIFT_NAMES[h - 1]}">
      <div class="shift-head"><span class="shift-num">${h}º</span><h2 class="shift-name">${SHIFT_NAMES[h - 1]}</h2></div>
      <ul class="shift-list">`;
    for (let p = 1; p <= 3; p++) {
      const seats = seatsOf(id, h, p).map((k) => seatHtml(k, slots ? slots[k] : null, c)).join('');
      html += `<li class="post${double ? ' double' : ''}">
        <span class="slot-post" aria-hidden="true">P${p}${double ? '<small>DUPLO</small>' : ''}</span>
        <ul class="seats" aria-label="P${p}${double ? ', posto duplo' : ''}">${seats}</ul>
      </li>`;
    }
    html += '</ul></section>';
  }
  container.innerHTML = html;
}

function statusClass(st) {
  return {
    [STATUS.OPEN]: 's-open',
    [STATUS.WAITING]: 's-wait',
    [STATUS.FULL]: 's-full',
    [STATUS.CLOSED]: 's-closed'
  }[st];
}

function setStatus(el, st) {
  el.textContent = st;
  el.className = `status ${statusClass(st)}`;
}

function currentStatus() {
  return scaleStatus(S.scaleId, now(), filledCount(S.slots), capacityOf(S.scaleId));
}

function renderTopLines() {
  const t = now();
  const today = todayId(t);
  $('greet').textContent = greeting(t);
  $('todayLine').textContent = `Hoje: ${weekdayName(today)}, ${formatBR(today)} · ${formatClock(t)} (Brasília)`;
}

function renderNotice(st, mine) {
  const box = $('notice');
  if (S.profile.bloqueado) {
    box.className = 'notice n-block';
    box.innerHTML = `${ICONS.ban}<div class="notice-body"><strong>Acesso bloqueado</strong><p>${MSG.blocked}</p></div>`;
    return;
  }
  if (st === STATUS.WAITING) {
    const open = openingMs(S.scaleId);
    const hour = openingHour(addDays(S.scaleId, -1));
    box.className = 'notice n-wait';
    box.innerHTML = `${ICONS.clock}<div class="notice-body"><strong>Escala ainda não liberada.</strong>
      <p>A escala do próximo dia estará disponível a partir das ${hour}:00.</p>
      <span class="cd" id="countdown" aria-label="Tempo restante">${formatCountdown(open - now())}</span></div>`;
    return;
  }
  if (mine) {
    const { h, p, seat } = keyInfo(mine);
    box.className = 'notice n-mine';
    box.innerHTML = `${ICONS.shield}<div class="notice-body"><strong>Você já está escalado nesta escala.</strong>
      <p>${h}º HORÁRIO — P${p}${isDouble(S.scaleId) ? ` · VAGA ${seat}` : ''}</p></div>
      <button type="button" class="btn btn-ghost" data-act="release" data-key="${mine}">CANCELAR / TROCAR MINHA VAGA</button>`;
    return;
  }
  if (st === STATUS.FULL) {
    box.className = 'notice n-info';
    box.innerHTML = `${ICONS.info}<div class="notice-body"><strong>Escala preenchida.</strong><p>Todas as ${capacityOf(S.scaleId)} vagas foram ocupadas. Consulta liberada.</p></div>`;
    return;
  }
  box.className = 'notice hidden';
  box.innerHTML = '';
}

function renderHome() {
  if (!S.profile || !S.scaleId) return;
  $('helloNome').textContent = S.profile.nome;
  $('helloOm').textContent = S.profile.om;
  renderTopLines();
  const filled = filledCount(S.slots);
  const st = currentStatus();
  S.lastStatus = st;
  const mine = mySlotKey(S.slots);
  $('scaleDay').textContent = weekdayName(S.scaleId);
  $('scaleDate').textContent = formatBR(S.scaleId);
  setStatus($('scaleStatus'), st);
  const cap = capacityOf(S.scaleId);
  $('scaleCount').textContent = `${filled} de ${cap} vagas preenchidas`;
  $('scaleBar').style.width = `${(filled / cap) * 100}%`;
  $('btnToday').href = `#historico/${todayId(now())}`;
  renderNotice(st, mine);
  renderSlots($('slotsHome'), S.slots, { live: true, status: st, hasMine: !!mine }, S.scaleId);
}

function startScale() {
  if (S.unsubScale) S.unsubScale();
  S.scaleId = nextScaleId(now());
  S.slots = null;
  S.history = null;
  renderHome();
  S.unsubScale = watchScale(S.scaleId, (data) => {
    const before = mySlotKey(S.slots);
    S.slots = data.slots;
    const after = mySlotKey(S.slots);
    if (before && !after && !S.busy) toast('Sua vaga foi removida da escala.', 'warn', 5000);
    renderHome();
  }, () => toast('Falha ao atualizar a escala em tempo real.', 'err'));
}

async function syncClock() {
  try {
    S.offset = await syncServerClock(S.uid);
    S.syncedAt = Date.now();
  } catch {
    S.syncedAt = 0;
  }
  if (S.scaleId && nextScaleId(now()) !== S.scaleId) startScale();
  else renderHome();
}

function tick() {
  if (!S.scaleId) return;
  if (nextScaleId(now()) !== S.scaleId) {
    startScale();
    return;
  }
  const st = currentStatus();
  if (st !== S.lastStatus) {
    const was = S.lastStatus;
    renderHome();
    if (was === STATUS.WAITING && st === STATUS.OPEN) toast('Escala liberada! Escolha sua vaga.', 'ok', 5000);
    return;
  }
  const cd = $('countdown');
  if (cd) cd.textContent = formatCountdown(openingMs(S.scaleId) - now());
  if (new Date().getSeconds() === 0) renderTopLines();
}

async function onTake(key, btn) {
  if (S.busy) return;
  if (S.profile.bloqueado) return toast(MSG.blocked, 'err');
  const st = currentStatus();
  if (st === STATUS.WAITING) return toast(MSG.notOpen, 'warn');
  if (st === STATUS.FULL) return toast(MSG.full, 'warn');
  if (st === STATUS.CLOSED) return toast(MSG.closed, 'warn');
  if (mySlotKey(S.slots)) return toast(MSG.already, 'warn');
  if (S.slots && S.slots[key]) return toast(MSG.taken, 'err');
  if (!navigator.onLine) return toast(MSG.offline, 'err');
  const { h, p, seat } = keyInfo(key);
  const ok = await confirmModal({
    title: `Você deseja assumir o ${h}º horário, P${p}?`,
    text: `${isDouble(S.scaleId) ? `Posto duplo — vaga ${seat} de 2. ` : ''}Escala de ${weekdayName(S.scaleId)}, ${formatBR(S.scaleId)}. Registro: ${S.profile.nome} | ${S.profile.om}.`
  });
  if (!ok) return;
  S.busy = true;
  if (btn && btn.isConnected) {
    btn.disabled = true;
    btn.textContent = '...';
  }
  try {
    await withTimeout(reserveSlot(S.scaleId, key, S.uid, S.profile), 20000);
    toast(MSG.reserved, 'ok');
  } catch (e) {
    fail(e);
  } finally {
    S.busy = false;
    renderHome();
  }
}

async function onRelease(key) {
  if (S.busy) return;
  const st = currentStatus();
  if (st === STATUS.WAITING || st === STATUS.CLOSED) return toast(MSG.closed, 'warn');
  if (!navigator.onLine) return toast(MSG.offline, 'err');
  const ok = await confirmModal({
    title: `Cancelar sua vaga no ${seatLabel(S.scaleId, key)}?`,
    text: 'A vaga ficará disponível imediatamente para outro militar. Depois você poderá escolher outra vaga livre.',
    ok: 'CANCELAR VAGA',
    danger: true
  });
  if (!ok) return;
  S.busy = true;
  try {
    await withTimeout(releaseSlot(S.scaleId, key, S.uid), 20000);
    toast(MSG.changed, 'ok');
  } catch (e) {
    fail(e);
  } finally {
    S.busy = false;
    renderHome();
  }
}

async function onAdminRemove(scaleId, key, slots) {
  if (!S.isAdmin) return;
  const slot = slots && slots[key];
  if (!slot) return;
  const ok = await confirmModal({
    eyebrow: 'ADMINISTRAÇÃO',
    title: `Remover ${slot.nome} | ${slot.om}?`,
    text: `${seatLabel(scaleId, key)} — escala de ${formatBR(scaleId)}. A vaga ficará disponível.`,
    ok: 'REMOVER',
    danger: true
  });
  if (!ok) return;
  try {
    S.busy = true;
    await adminRemoveSlot(scaleId, key);
    toast(MSG.changed, 'ok');
    S.history = null;
    if (scaleId !== S.scaleId) await openDetail(scaleId, true);
  } catch (e) {
    fail(e);
  } finally {
    S.busy = false;
  }
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new AppError('timeout')), ms))]);
}

async function openHistory() {
  show('history');
  const list = $('histList');
  if (!S.history) {
    list.innerHTML = '<li class="loader"><span class="spinner" aria-hidden="true"></span></li>';
    try {
      S.history = await listHistory(S.scaleId);
    } catch (e) {
      console.error('Erro ao carregar histórico:', e);
      list.innerHTML = `<li class="empty">Não foi possível carregar o histórico.${e && e.code ? ` (${esc(e.code)})` : ''}
        <button type="button" class="btn btn-ghost btn-block" id="btnHistRetry" style="margin-top:12px">TENTAR NOVAMENTE</button></li>`;
      $('btnHistRetry').addEventListener('click', openHistory);
      return;
    }
  }
  if (!S.history.length) {
    list.innerHTML = '<li class="empty">Nenhuma escala anterior registrada ainda.</li>';
    return;
  }
  list.innerHTML = S.history.map(({ id, slots }) => {
    const n = filledCount(slots);
    const cap = capacityOf(id);
    return `<li><a class="hist-item" href="#historico/${id}">
      <span>
        <span class="hist-fill">${formatBR(addDays(id, -1))}</span>
        <span class="hist-scale">Escala de <span>${formatBR(id)}</span> · ${weekdayName(id)}</span>
      </span>
      <span class="hist-count">${n}/${cap} ${ICONS.chevron}</span>
    </a></li>`;
  }).join('');
}

async function openDetail(id, force = false) {
  show('detail');
  S.detailId = id;
  $('detDay').textContent = weekdayName(id);
  $('detDate').textContent = formatBR(id);
  $('detFill').textContent = `Preenchida em ${formatBR(addDays(id, -1))}, a partir das ${openingHour(addDays(id, -1))}:00.`;
  let slots = !force && S.history ? (S.history.find((x) => x.id === id) || {}).slots : null;
  if (!slots) {
    $('slotsDetail').innerHTML = '<div class="loader"><span class="spinner" aria-hidden="true"></span></div>';
    try {
      slots = await getScale(id);
    } catch (e) {
      fail(e);
    }
  }
  if (S.detailId !== id) return;
  S.detailSlots = slots;
  const n = filledCount(slots);
  const cap = capacityOf(id);
  setStatus($('detStatus'), scaleStatus(id, now(), n, cap));
  $('detCount').textContent = `${n} de ${cap} vagas preenchidas`;
  renderSlots($('slotsDetail'), slots, { live: false }, id);
  if (!slots) $('slotsDetail').insertAdjacentHTML('afterbegin', '<p class="empty">Nenhum militar registrado nesta escala.</p>');
}

function renderUsers() {
  const q = $('admSearch').value.trim().toUpperCase();
  const users = S.users || [];
  const list = users.filter((u) => !q || u.nome.includes(q));
  const ciac = users.filter((u) => u.om === 'CIA C').length;
  $('admStats').innerHTML = `
    <div class="stat"><b>${users.length}</b><span>TOTAL</span></div>
    <div class="stat"><b>${ciac}</b><span>CIA C</span></div>
    <div class="stat"><b>${users.length - ciac}</b><span>PE</span></div>`;
  if (!list.length) {
    $('userList').innerHTML = '<li class="empty">Nenhum militar encontrado.</li>';
    return;
  }
  $('userList').innerHTML = list.map((u) => {
    const me = u.uid === S.uid;
    const created = u.createdAt ? formatBR(todayId(u.createdAt.toMillis())) : '—';
    const seen = u.lastSeen ? formatDateTime(u.lastSeen.toMillis()) : '—';
    return `<li class="user ${u.bloqueado ? 'blocked' : ''}">
      <div>
        <span class="user-name">${esc(u.nome)}</span> <span class="tag">${esc(u.om)}</span>
        ${u.bloqueado ? '<span class="user-flag">BLOQUEADO</span>' : ''}
        <span class="user-meta">Cadastro: ${created} · Último acesso: ${seen}</span>
      </div>
      ${me || u.nome === ADMIN_NAME ? '<span class="tag">ADM</span>' : `<button type="button" class="btn ${u.bloqueado ? 'btn-ghost' : 'btn-danger'} btn-sm" data-act="block" data-uid="${u.uid}">${u.bloqueado ? 'DESBLOQUEAR' : 'BLOQUEAR'}</button>`}
    </li>`;
  }).join('');
}

async function openAdmin() {
  if (!S.isAdmin) {
    location.hash = '';
    return;
  }
  show('admin');
  $('userList').innerHTML = '<li class="loader"><span class="spinner" aria-hidden="true"></span></li>';
  try {
    S.users = await listUsers();
    renderUsers();
  } catch (e) {
    $('userList').innerHTML = '<li class="empty">Não foi possível carregar os militares.</li>';
    fail(e);
  }
}

async function onBlock(uid) {
  const u = (S.users || []).find((x) => x.uid === uid);
  if (!u) return;
  const next = !u.bloqueado;
  const ok = await confirmModal({
    eyebrow: 'ADMINISTRAÇÃO',
    title: `${next ? 'Bloquear' : 'Desbloquear'} ${u.nome} | ${u.om}?`,
    text: next ? 'O militar não poderá escolher nem cancelar vagas.' : 'O militar voltará a poder escolher vagas.',
    ok: next ? 'BLOQUEAR' : 'DESBLOQUEAR',
    danger: next
  });
  if (!ok) return;
  try {
    await setUserBlocked(uid, next);
    u.bloqueado = next;
    renderUsers();
    toast(MSG.changed, 'ok');
  } catch (e) {
    fail(e);
  }
}

function route() {
  if (!S.profile) return;
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  const m = h.match(/^historico\/(\d{4}-\d{2}-\d{2})$/);
  if (m) {
    if (m[1] >= S.scaleId) {
      location.hash = '';
      return;
    }
    openDetail(m[1]);
  } else if (h === 'historico') {
    openHistory();
  } else if (h === 'admin') {
    openAdmin();
  } else {
    show('home');
    renderHome();
  }
}

function normalizeNome(v) {
  return v
    .toUpperCase()
    .replace(/[^A-ZÁÂÃÀÉÊÍÓÔÕÚÜÇ ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(SD\s+EV|SD|EV)\s+/, '');
}

async function onRegister(e) {
  e.preventDefault();
  const err = $('regError');
  const nome = normalizeNome($('regNome').value);
  const omInput = document.querySelector('input[name="om"]:checked');
  err.classList.add('hidden');
  const showErr = (t) => {
    err.textContent = t;
    err.classList.remove('hidden');
  };
  if (nome.length < 2 || nome.length > 20 || !NOME_RE.test(nome)) return showErr('Informe um nome de guerra válido (somente letras, 2 a 20 caracteres).');
  if (!omInput) return showErr('Selecione sua OM: CIA C ou PE.');
  if (!navigator.onLine) return showErr('Sem conexão. Conecte-se à internet para realizar o cadastro.');
  const btn = $('regSubmit');
  btn.disabled = true;
  btn.textContent = 'CADASTRANDO...';
  try {
    await registerUser(S.uid, nome, omInput.value, $('regSenha').value.trim());
    toast(MSG.registered, 'ok');
    showNovidades(true);
    await enter({ nome, om: omInput.value, bloqueado: false });
  } catch (ex) {
    const code = ex && ex.code;
    if (code === 'needpass') {
      $('regSenhaWrap').classList.remove('hidden');
      $('regSenha').focus();
      showErr('Este nome é do administrador. Digite a senha do ADM para entrar neste aparelho.');
    } else if (code === 'badpass') {
      showErr('Senha incorreta.');
    } else {
      const [t] = errorMessage(ex);
      showErr(code === 'permission-denied' ? 'Cadastro recusado. Verifique o nome de guerra e tente novamente.' : t);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'ENTRAR NO SISTEMA';
  }
}

async function enter(profile) {
  S.profile = profile;
  checkAdmin(S.uid).then((adm) => {
    const was = S.isAdmin;
    S.isAdmin = adm;
    if (S.isAdmin && !was && profile.nome === ADMIN_NAME) toast('Acesso de administrador ativo.', 'ok');
    route();
  });
  if (S.unsubProfile) S.unsubProfile();
  S.unsubProfile = watchProfile(S.uid, (p) => {
    if (!p) return;
    const changed = p.bloqueado !== S.profile.bloqueado;
    S.profile = { ...S.profile, nome: p.nome, om: p.om, bloqueado: p.bloqueado };
    if (changed) {
      renderHome();
      if (p.bloqueado) toast(MSG.blocked, 'err', 6000);
    }
  });
  startScale();
  syncClock();
  if (!S.started) {
    S.started = true;
    setInterval(tick, 1000);
    window.addEventListener('hashchange', route);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - S.syncedAt > 600000) syncClock();
      if (document.visibilityState === 'visible') tick();
    });
  }
  route();
}

function bindEvents() {
  $('regForm').addEventListener('submit', onRegister);
  $('regNome').addEventListener('input', (e) => {
    const pos = e.target.selectionStart;
    e.target.value = e.target.value.toUpperCase();
    try { e.target.setSelectionRange(pos, pos); } catch { /* input type sem seleção */ }
  });
  $('btnRetry').addEventListener('click', () => location.reload());
  $('btnShareApp').addEventListener('click', shareApp);
  $('btnShareScale').addEventListener('click', () => shareScale(S.scaleId, S.slots));
  $('btnShareDetail').addEventListener('click', () => shareScale(S.detailId, S.detailSlots));
  $('navHome').addEventListener('click', (e) => {
    e.preventDefault();
    location.hash = '';
  });
  $('slotsHome').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'take') onTake(b.dataset.key, b);
    if (b.dataset.act === 'admrm') onAdminRemove(S.scaleId, b.dataset.key, S.slots);
  });
  $('notice').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="release"]');
    if (b) onRelease(b.dataset.key);
  });
  $('slotsDetail').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="admrm"]');
    if (b) onAdminRemove(S.detailId, b.dataset.key, S.detailSlots);
  });
  $('userList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="block"]');
    if (b) onBlock(b.dataset.uid);
  });
  $('admSearch').addEventListener('input', renderUsers);
  $('updBtn').addEventListener('click', applyUpdate);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkUpdate();
  });
  const net = () => $('netbar').classList.toggle('hidden', navigator.onLine);
  window.addEventListener('online', () => {
    net();
    syncClock();
  });
  window.addEventListener('offline', net);
  net();
  $('btnWhats').href = WHATSAPP_GROUP;
}

const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } }
};
const SEEN_KEY = 'escala-sdev-versao-vista';

async function showNovidades(isNewUser) {
  if (storage.get(SEEN_KEY) === APP_VERSION) return;
  storage.set(SEEN_KEY, APP_VERSION);
  if (isNewUser) return;
  await confirmModal({ eyebrow: `VERSÃO ${APP_VERSION}`, title: NOVIDADES.titulo, text: NOVIDADES.texto, ok: NOVIDADES.botao, single: true });
}

async function checkUpdate() {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const { version } = await res.json();
    if (version && version !== APP_VERSION) $('updbar').classList.remove('hidden');
  } catch { /* offline */ }
}

async function applyUpdate() {
  $('updBtn').disabled = true;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.update();
    if ('caches' in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
  } catch { /* segue */ }
  location.reload();
}

function registerSW() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

async function boot() {
  bindEvents();
  registerSW();
  checkUpdate();
  show('loading');
  try {
    const user = await withTimeout(ensureAuth(), 20000);
    S.uid = user.uid;
    const profile = await getProfile(S.uid);
    if (!profile) {
      show('register');
      return;
    }
    await enter(profile);
    showNovidades(false);
  } catch (e) {
    console.error('Erro na inicialização do sistema:', e);
    const code = e && e.code;
    if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') {
      $('errorText').textContent = 'Login anônimo não habilitado no Firebase. Ative em Authentication > Método de login.';
    } else if (code === 'auth/configuration-not-found') {
      $('errorText').textContent = 'Authentication não iniciado no Firebase. Acesse o console do Firebase e clique em "Começar" no menu Authentication.';
    } else {
      $('errorText').textContent = 'Não foi possível conectar ao sistema. Verifique o console do navegador e sua conexão.';
    }
    show('error');
  }
}

boot();
