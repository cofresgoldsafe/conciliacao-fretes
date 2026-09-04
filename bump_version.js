const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, 'public', 'index.html');
const description = process.argv[2] || process.env.COMMIT_DESC || 'Atualização e Melhorias';

if (!fs.existsSync(indexPath)) {
  console.error('❌ Arquivo public/index.html não encontrado.');
  process.exit(1);
}

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const dataHoraStr = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

let html = fs.readFileSync(indexPath, 'utf-8');

let novaVersaoNum = '8.1';
const vMatch = html.match(/style\.css\?v=([0-9.]+)/);
if (vMatch && vMatch[1]) {
  const parts = vMatch[1].split('.').map(Number);
  if (parts.length >= 2) {
    parts[1] += 1;
    novaVersaoNum = parts.join('.');
  } else if (parts.length === 1) {
    novaVersaoNum = `${parts[0]}.1`;
  }
}

const regexVersionTag = /<span class="version-tag"[^>]*>Última Versão:[\s\S]*?<\/span>/;
const novaTag = `<span class="version-tag" style="display: inline-block; background: rgba(56, 189, 248, 0.12); color: #38bdf8; padding: 1px 7px; border-radius: 6px; font-size: 0.72rem; font-weight: 600; margin-left: 6px; border: 1px solid rgba(56, 189, 248, 0.25);">Última Versão: ${dataHoraStr} (${description})</span>`;

if (regexVersionTag.test(html)) {
  html = html.replace(regexVersionTag, novaTag);
}

html = html.replace(/style\.css\?v=[0-9.]+/g, `style.css?v=${novaVersaoNum}`);
html = html.replace(/app\.js\?v=[0-9.]+/g, `app.js?v=${novaVersaoNum}`);
html = html.replace(/js\/bi\.js\?v=[0-9.]+/g, `js/bi.js?v=${novaVersaoNum}`);
html = html.replace(/js\/bi_indices\.js\?v=[0-9.]+/g, `js/bi_indices.js?v=${novaVersaoNum}`);
html = html.replace(/js\/bi_autorizacoes\.js\?v=[0-9.]+/g, `js/bi_autorizacoes.js?v=${novaVersaoNum}`);
html = html.replace(/js\/gordura_frete\.js\?v=[0-9.]+/g, `js/gordura_frete.js?v=${novaVersaoNum}`);
html = html.replace(/js\/fechamento_vendedores\.js\?v=[0-9.]+/g, `js/fechamento_vendedores.js?v=${novaVersaoNum}`);
html = html.replace(/js\/tarefas\.js\?v=[0-9.]+/g, `js/tarefas.js?v=${novaVersaoNum}`);
html = html.replace(/js\/holerites\.js\?v=[0-9.]+/g, `js/holerites.js?v=${novaVersaoNum}`);
html = html.replace(/js\/funcionarios_dp\.js\?v=[0-9.]+/g, `js/funcionarios_dp.js?v=${novaVersaoNum}`);

fs.writeFileSync(indexPath, html, 'utf-8');
console.log(`✅ Versão atualizada no index.html: ${dataHoraStr} (${description}) | Cache: ?v=${novaVersaoNum}`);
