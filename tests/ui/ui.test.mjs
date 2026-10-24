import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve('.');
const SHOTS = path.resolve('tests/screens');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const brt = (y, m, d, h, min = 0) => Date.UTC(y, m - 1, d, h + 3, min);
let server, browser, base;

before(async () => {
  await mkdir(SHOTS, { recursive: true });
  server = http.createServer(async (req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/version.json' && server.fakeVersion) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ version: server.fakeVersion }));
      return;
    }
    const file = p === '/js/firebase.js' ? 'tests/ui/mock-firebase.js' : (p === '/' ? 'index.html' : p.slice(1));
    try {
      const body = await readFile(path.join(ROOT, file));
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
});

after(async () => { await browser?.close(); server?.close(); });

async function open(mock, { width = 390, height = 844, at } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: true, isMobile: width < 700 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => { errors.push('native dialog: ' + d.message()); d.dismiss(); });
  await page.addInitScript((m) => {
    m.offset = m.at ? m.at - Date.now() : 0;
    window.__MOCK = m;
    window.__shared = [];
    if (!m.showNovidades && !sessionStorage.getItem('keep')) localStorage.setItem('escala-sdev-versao-vista', '2.0.0');
  }, { ...mock, at });
  await page.goto(base);
  page.errors = errors;
  return page;
}

const me = (nome = 'SILVA', om = 'CIA C', extra = {}) => ({ uid: 'me', users: { me: { nome, om, bloqueado: false, ...extra } } });
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('1-3 primeiro acesso, validação e cadastro', async () => {
  const page = await open({ uid: 'me' }, { at: brt(2026, 10, 4, 17) });
  await page.waitForSelector('#view-register:not(.hidden)');
  await shot(page, '01-cadastro');
  await page.click('#regSubmit');
  assert.match(await page.textContent('#regError'), /nome de guerra válido/);
  await page.fill('#regNome', 'sd ev joão');
  await page.click('#regSubmit');
  assert.match(await page.textContent('#regError'), /OM/);
  await page.check('input[value="PE"]', { force: true });
  await page.click('#regSubmit');
  await page.waitForSelector('#view-home:not(.hidden)');
  assert.equal(await page.textContent('#helloNome'), 'JOÃO');
  assert.equal(await page.textContent('#helloOm'), 'PE');
  assert.match(await page.textContent('#toasts'), /Cadastro realizado com sucesso!/);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('4 escala bloqueada antes do horário (domingo 15:59 → segunda)', async () => {
  const page = await open(me(), { at: brt(2026, 10, 4, 15, 59) });
  await page.waitForSelector('#slotsHome .slot');
  assert.equal(await page.textContent('#scaleDay'), 'SEGUNDA-FEIRA');
  assert.equal(await page.textContent('#scaleDate'), '05/10/2026');
  assert.equal(await page.textContent('#scaleStatus'), 'AGUARDANDO LIBERAÇÃO');
  assert.match(await page.textContent('#notice'), /Escala ainda não liberada[\s\S]*16:00/);
  assert.equal(await page.locator('[data-act="take"]').count(), 0);
  await shot(page, '02-aguardando');
  await page.waitForFunction(() => document.querySelector('#scaleStatus').textContent === 'ABERTA', null, { timeout: 70000 });
  assert.match(await page.textContent('#toasts'), /Escala liberada/);
  await page.context().close();
});

test('4b dia útil abre só às 18:00 (segunda 17:59 → terça)', async () => {
  const page = await open(me(), { at: brt(2026, 10, 5, 17, 0) });
  await page.waitForSelector('#slotsHome .slot');
  assert.equal(await page.textContent('#scaleDay'), 'TERÇA-FEIRA');
  assert.equal(await page.textContent('#scaleStatus'), 'AGUARDANDO LIBERAÇÃO');
  assert.match(await page.textContent('#notice'), /18:00/);
  await page.context().close();
});

test('12 sábado 16:00 → escala de domingo aberta', async () => {
  const page = await open(me(), { at: brt(2026, 10, 10, 16, 0) });
  await page.waitForSelector('#slotsHome .slot');
  assert.equal(await page.textContent('#scaleDay'), 'DOMINGO');
  assert.equal(await page.textContent('#scaleDate'), '11/10/2026');
  assert.equal(await page.textContent('#scaleStatus'), 'ABERTA');
  await page.context().close();
});

test('5-8 escolha, confirmação, segunda vaga, corrida e tempo real', async () => {
  const page = await open({ ...me('RIQUELME'), raceKey: 'h1p1', escalas: { '2026-10-05': { h1p2: { uid: 'j', nome: 'JOÃO', om: 'CIA C' } } } }, { at: brt(2026, 10, 4, 19) });
  await page.waitForSelector('[data-act="take"]');
  assert.equal(await page.textContent('#scaleStatus'), 'ABERTA');
  assert.match(await page.textContent('#scaleCount'), /1 de 9/);
  await shot(page, '03-aberta');
  await page.click('[data-key="h2p2"]');
  await page.waitForSelector('#modal[open]');
  assert.equal(await page.textContent('#modalTitle'), 'Você deseja assumir o 2º horário, P2?');
  await shot(page, '04-confirmacao');
  await page.click('#modal button[value="cancel"]');
  assert.equal(await page.locator('#modal[open]').count(), 0);
  await page.click('[data-key="h2p2"]');
  await page.click('#modalOk');
  await page.waitForSelector('.slot.mine');
  assert.match(await page.textContent('#toasts'), /Vaga reservada com sucesso!/);
  assert.match(await page.textContent('#notice'), /Você já está escalado nesta escala[\s\S]*2º HORÁRIO — P2/);
  assert.match(await page.textContent('.slot.mine'), /RIQUELME\s*\| CIA C/);
  await shot(page, '05-escalado');
  await page.click('[data-key="h3p1"]');
  assert.match(await page.textContent('#toasts'), /Você já possui uma vaga nesta escala/);
  assert.equal(await page.locator('#modal[open]').count(), 0);
  await page.click('[data-act="release"]');
  await page.click('#modalOk');
  await page.waitForFunction(() => !document.querySelector('.slot.mine'));
  assert.match(await page.textContent('#toasts'), /Alteração realizada com sucesso/);
  await page.click('[data-key="h1p1"]');
  await page.click('#modalOk');
  await page.waitForFunction(() => document.querySelector('#toasts').textContent.includes('acabou de ser ocupada'));
  assert.match(await page.textContent('#slotsHome'), /CARLOS/);
  await page.evaluate(() => window.__mock.take('2026-10-05', 'h3p3', { uid: 'p', nome: 'PEDRO', om: 'PE' }));
  await page.waitForFunction(() => document.querySelector('#slotsHome').textContent.includes('PEDRO'));
  assert.match(await page.textContent('#scaleCount'), /3 de 9/);
  assert.deepEqual(page.errors, []);
  await page.context().close();
});

test('9 escala com 9 vagas preenchidas', async () => {
  const full = {};
  ['h1p1', 'h1p2', 'h1p3', 'h2p1', 'h2p2', 'h2p3', 'h3p1', 'h3p2', 'h3p3'].forEach((k, i) => { full[k] = { uid: 'x' + i, nome: 'MILITAR ' + 'ABCDEFGHI'[i], om: i % 2 ? 'PE' : 'CIA C' }; });
  const page = await open({ ...me(), escalas: { '2026-10-05': full } }, { at: brt(2026, 10, 4, 20) });
  await page.waitForFunction(() => document.querySelector('#scaleStatus').textContent === 'PREENCHIDA');
  assert.match(await page.textContent('#scaleCount'), /9 de 9/);
  assert.equal(await page.locator('[data-act="take"]').count(), 0);
  assert.match(await page.textContent('#notice'), /Escala preenchida/);
  await shot(page, '06-preenchida');
  await page.context().close();
});

test('10 histórico e 11 virada domingo → segunda', async () => {
  const esc = {
    '2026-09-30': { h1p1: { uid: 'a', nome: 'ALVES', om: 'PE' } },
    '2026-10-01': { h2p3: { uid: 'b', nome: 'BRITO', om: 'CIA C' } },
    '2026-10-04': { h3p2: { uid: 'c', nome: 'COSTA', om: 'PE' } },
    '2026-10-05': {}
  };
  const page = await open({ ...me(), escalas: esc }, { at: brt(2026, 10, 4, 23, 59) + 50000 });
  await page.waitForSelector('#slotsHome .slot');
  assert.equal(await page.textContent('#scaleDay'), 'SEGUNDA-FEIRA');
  await page.waitForFunction(() => document.querySelector('#scaleDay').textContent === 'TERÇA-FEIRA', null, { timeout: 20000 });
  assert.equal(await page.textContent('#scaleDate'), '06/10/2026');
  assert.equal(await page.textContent('#scaleStatus'), 'AGUARDANDO LIBERAÇÃO');
  await page.click('a[href="#historico"]');
  await page.waitForSelector('.hist-item');
  const items = await page.locator('.hist-item').allTextContents();
  assert.equal(items.length, 4);
  assert.match(items[0], /04\/10\/2026[\s\S]*Escala de 05\/10\/2026/);
  assert.match(items[3], /29\/09\/2026[\s\S]*Escala de 30\/09\/2026/);
  await shot(page, '07-historico');
  await page.click('a[href="#historico/2026-10-01"]');
  await page.waitForSelector('#view-detail:not(.hidden) .slot');
  assert.equal(await page.textContent('#detStatus'), 'ENCERRADA');
  assert.match(await page.textContent('#slotsDetail'), /BRITO/);
  assert.equal(await page.locator('#slotsDetail [data-act]').count(), 0);
  await shot(page, '08-detalhe');
  await page.context().close();
});

test('13 compartilhar escala e sistema / 14 WhatsApp', async () => {
  const page = await open({ ...me('RIQUELME'), escalas: { '2026-10-05': { h1p2: { uid: 'me', nome: 'RIQUELME', om: 'CIA C' } } } }, { at: brt(2026, 10, 4, 19) });
  await page.evaluate(() => { navigator.share = async (d) => { window.__shared.push(d); }; });
  await page.waitForSelector('.slot.mine');
  await page.click('#btnShareScale');
  await page.click('#btnShareApp');
  const shared = await page.evaluate(() => window.__shared);
  assert.match(shared[0].text, /^\*LISTA DA GUARNIÇÃO\*\nEscala de SEGUNDA-FEIRA — 05\/10\/2026\n\n\*1º HORÁRIO\*\nP1 - \nP2 - RIQUELME \| CIA C\nP3 - \n\n\*2º HORÁRIO\*/);
  assert.match(shared[1].text, /^Confira e preencha a escala da guarnição pelo sistema:\n\nhttp/);
  await page.evaluate(() => { delete Navigator.prototype.share; navigator.share = undefined; });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.click('#btnShareApp');
  await page.waitForFunction(() => document.querySelector('#toasts').textContent.includes('Link copiado!'));
  assert.equal(await page.getAttribute('#btnWhats', 'href'), 'https://chat.whatsapp.com/CT5EigeEZAr36FZMgSYE2r?s=cl&p=i&mlu=4&ilr=4');
  assert.equal(await page.getAttribute('#btnWhats', 'target'), '_blank');
  await page.context().close();
});

test('15 responsividade: 320px, 390px e desktop sem rolagem horizontal', async () => {
  for (const [w, h, name] of [[320, 568, '09-320px'], [390, 844, null], [1280, 900, '10-desktop']]) {
    const page = await open({ ...me('MAGALHÃES BARBOSA'), escalas: { '2026-10-05': { h1p1: { uid: 'z', nome: 'FERNANDES ALBUQUERQUE', om: 'CIA C' } } } }, { width: w, height: h, at: brt(2026, 10, 4, 19) });
    await page.waitForSelector('[data-act="take"]');
    assert.ok(await noHScroll(page), `rolagem horizontal em ${w}px`);
    const small = await page.$$eval('button, a.btn', (els) => els.filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44).map((e) => e.textContent.trim()));
    assert.deepEqual(small, [], `botões menores que 44px em ${w}px`);
    if (name) await shot(page, name);
    await page.context().close();
  }
});

test('administrador: painel, bloqueio e remoção; nome reservado', async () => {
  const page = await open({
    uid: 'me', admin: 'me',
    users: { me: { nome: 'RIQUELME', om: 'CIA C', bloqueado: false }, a: { nome: 'SILVA', om: 'PE', bloqueado: false } },
    escalas: { '2026-10-05': { h1p1: { uid: 'a', nome: 'SILVA', om: 'PE' } } }
  }, { at: brt(2026, 10, 4, 19) });
  await page.waitForSelector('#navAdmin:not(.hidden)');
  await page.click('[data-act="admrm"][data-key="h1p1"]');
  await page.click('#modalOk');
  await page.waitForFunction(() => !document.querySelector('#slotsHome').textContent.includes('SILVA'));
  await page.click('#navAdmin');
  await page.waitForSelector('.user');
  await shot(page, '11-admin');
  await page.click('[data-act="block"][data-uid="a"]');
  await page.click('#modalOk');
  await page.waitForSelector('.user.blocked');
  await page.context().close();

  const p2 = await open({ uid: 'me', admin: 'outro', secret: '2511' }, { at: brt(2026, 10, 4, 19) });
  await p2.waitForSelector('#view-register:not(.hidden)');
  assert.equal(await p2.locator('#regSenhaWrap.hidden').count(), 1);
  await p2.fill('#regNome', 'Riquelme');
  await p2.check('input[value="CIA C"]', { force: true });
  await p2.click('#regSubmit');
  await p2.waitForFunction(() => document.querySelector('#regError').textContent.includes('senha do ADM'));
  assert.equal(await p2.locator('#regSenhaWrap.hidden').count(), 0);
  await p2.fill('#regSenha', '1234');
  await p2.click('#regSubmit');
  await p2.waitForFunction(() => document.querySelector('#regError').textContent.includes('Senha incorreta'));
  await p2.fill('#regSenha', '2511');
  await p2.click('#regSubmit');
  await p2.waitForSelector('#navAdmin:not(.hidden)');
  await p2.click('#navAdmin');
  await p2.waitForSelector('.user');
  await p2.context().close();

  const p4 = await open({ uid: 'me', admin: 'outro', secret: '2511' }, { at: brt(2026, 10, 4, 19) });
  await p4.waitForSelector('#view-register:not(.hidden)');
  await p4.fill('#regNome', 'Silva');
  await p4.check('input[value="PE"]', { force: true });
  await p4.click('#regSubmit');
  await p4.waitForSelector('#view-home:not(.hidden)');
  assert.equal(await p4.locator('#navAdmin.hidden').count(), 1);
  await p4.context().close();

  const p3 = await open(me(), { at: brt(2026, 10, 4, 19) });
  await p3.waitForSelector('[data-act="take"]');
  assert.equal(await p3.locator('#navAdmin.hidden').count(), 1);
  await p3.goto(base + '#admin');
  await p3.waitForSelector('#view-home:not(.hidden)');
  await p3.evaluate(() => window.__mock.setProfile({ bloqueado: true }));
  await p3.waitForFunction(() => document.querySelector('#notice').textContent.includes('bloqueado'));
  await p3.context().close();
});

test('posto duplo a partir de 25/10/2026: 2 militares por posto, 18 vagas', async () => {
  const page = await open({ ...me(), escalas: { '2026-10-25': { h2p2: { uid: 'j', nome: 'JOÃO', om: 'CIA C' } } } }, { at: brt(2026, 10, 24, 18, 30) });
  await page.waitForSelector('[data-act="take"]');
  assert.equal(await page.textContent('#scaleDate'), '25/10/2026');
  assert.match(await page.textContent('#scaleCount'), /1 de 18/);
  assert.equal(await page.locator('#slotsHome .post.double').count(), 9);
  assert.equal(await page.locator('#slotsHome .slot').count(), 18);
  assert.ok(await page.locator('[data-key="h2p2b"]').count(), 'segunda vaga do P2 livre');
  await page.click('[data-key="h2p2b"]');
  assert.match(await page.textContent('#modalText'), /Posto duplo — vaga 2 de 2/);
  await page.click('#modalOk');
  await page.waitForSelector('.slot.mine');
  assert.match(await page.textContent('#notice'), /2º HORÁRIO — P2 · VAGA 2/);
  assert.match(await page.textContent('#scaleCount'), /2 de 18/);
  assert.ok(await noHScroll(page));
  await shot(page, '12-posto-duplo');
  await page.evaluate(() => { navigator.share = async (d) => { window.__shared.push(d); }; });
  await page.click('#btnShareScale');
  const t = (await page.evaluate(() => window.__shared))[0].text;
  assert.match(t, /\*2º HORÁRIO\*\nP1 - \nP1 - \nP2 - JOÃO \| CIA C\nP2 - SILVA \| CIA C\nP3 - \nP3 - /);
  assert.match(t, /Vagas preenchidas: 2\/18/);
  await page.context().close();

  const small = await open({ ...me('MAGALHÃES BARBOSA'), escalas: { '2026-10-25': { h1p1: { uid: 'z', nome: 'FERNANDES ALBUQUERQUE', om: 'CIA C' } } } }, { width: 320, height: 568, at: brt(2026, 10, 24, 19) });
  await small.waitForSelector('[data-act="take"]');
  assert.ok(await noHScroll(small), 'rolagem horizontal em 320px');
  await shot(small, '13-duplo-320');
  await small.context().close();
});

test('posto duplo: escala cheia com 18 e histórico antigo segue com 9', async () => {
  const keys = [];
  for (let h = 1; h <= 3; h++) for (let p = 1; p <= 3; p++) keys.push(`h${h}p${p}`, `h${h}p${p}b`);
  const full = Object.fromEntries(keys.map((k, i) => [k, { uid: 'x' + i, nome: 'MILITAR ' + 'ABCDEFGHIJKLMNOPQR'[i], om: 'PE' }]));
  const page = await open({ ...me(), escalas: { '2026-10-25': full, '2026-10-24': { h1p1: { uid: 'a', nome: 'ALVES', om: 'PE' } } } }, { at: brt(2026, 10, 24, 20) });
  await page.waitForFunction(() => document.querySelector('#scaleStatus').textContent === 'PREENCHIDA');
  assert.match(await page.textContent('#notice'), /Todas as 18 vagas/);
  await page.click('a[href="#historico"]');
  await page.waitForSelector('.hist-item');
  assert.match(await page.textContent('.hist-item'), /1\/9/);
  await page.click('.hist-item');
  await page.waitForSelector('#view-detail:not(.hidden) .slot');
  assert.equal(await page.locator('#slotsDetail .slot').count(), 9);
  assert.equal(await page.locator('#slotsDetail .post.double').count(), 0);
  await page.context().close();
});

test('mensagem de nova versão aparece uma vez e aviso de atualização', async () => {
  const page = await open({ ...me(), showNovidades: true }, { at: brt(2026, 10, 24, 19) });
  await page.waitForSelector('#modal[open]');
  assert.match(await page.textContent('#modalText'), /SD EV RIQUELME[\s\S]*DUPLO[\s\S]*parar de rodar na 24 KKKKKKKKKKK/);
  assert.equal(await page.locator('#modal button[value="cancel"].hidden').count(), 1);
  await shot(page, '14-novidades');
  await page.click('#modalOk');
  assert.equal(await page.locator('#modal[open]').count(), 0);
  await page.evaluate(() => sessionStorage.setItem('keep', '1'));
  await page.reload();
  await page.waitForSelector('#slotsHome .slot');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#modal[open]').count(), 0);
  assert.equal(await page.locator('#updbar.hidden').count(), 1);
  await page.context().close();

  server.fakeVersion = '9.9.9';
  const p2 = await open(me(), { at: brt(2026, 10, 24, 19) });
  await p2.waitForSelector('#updbar:not(.hidden)');
  assert.match(await p2.textContent('#updbar'), /Nova versão disponível/);
  server.fakeVersion = null;
  await p2.context().close();
});

test('histórico mostra escalas simples e duplas', async () => {
  const page = await open({ ...me(), escalas: {
    '2026-10-20': { h1p1: { uid: 'a', nome: 'ALVES', om: 'PE' } },
    '2026-10-25': { h1p1: { uid: 'a', nome: 'ALVES', om: 'PE' }, h1p1b: { uid: 'b', nome: 'BRITO', om: 'CIA C' } }
  } }, { at: brt(2026, 10, 26, 10) });
  await page.waitForSelector('#slotsHome .slot');
  await page.click('a[href="#historico"]');
  await page.waitForSelector('.hist-item');
  const items = await page.locator('.hist-item').allTextContents();
  assert.equal(items.length, 2);
  assert.match(items[0], /Escala de 25\/10\/2026[\s\S]*2\/18/);
  assert.match(items[1], /Escala de 20\/10\/2026[\s\S]*1\/9/);
  await page.click('a[href="#historico/2026-10-25"]');
  await page.waitForSelector('#view-detail:not(.hidden) .post.double');
  assert.match(await page.textContent('#slotsDetail'), /ALVES[\s\S]*BRITO/);
  await page.context().close();
});
