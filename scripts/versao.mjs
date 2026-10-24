import { readFileSync, writeFileSync } from 'node:fs';

const nova = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(nova || '')) {
  console.error('Uso: node scripts/versao.mjs 2.1.1');
  process.exit(1);
}

const files = ['index.html', 'sw.js', 'js/app.js', 'js/firebase.js', 'js/versao.js', 'version.json'];
for (const f of files) {
  let s = readFileSync(f, 'utf8');
  s = s.replace(/\?v=\d+\.\d+\.\d+/g, `?v=${nova}`)
    .replace(/APP_VERSION = '\d+\.\d+\.\d+'/, `APP_VERSION = '${nova}'`)
    .replace(/const V = '\d+\.\d+\.\d+'/, `const V = '${nova}'`)
    .replace(/escala-sdev-\d+\.\d+\.\d+/, `escala-sdev-${nova}`)
    .replace(/"version": "\d+\.\d+\.\d+"/, `"version": "${nova}"`);
  writeFileSync(f, s);
}
console.log(`Versão ${nova} aplicada. Edite o recado em js/versao.js (NOVIDADES).`);
