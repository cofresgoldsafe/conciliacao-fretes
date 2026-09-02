/**
 * test_compras_tab.js
 * 
 * Suíte de Testes Automatizados para validação da Nova Aba Principal COMPRAS:
 * 1. Verificação de markup HTML da aba principal e sub-grupo Compras
 * 2. Validação da diretriz DRY (apontamento para abas existentes sem duplicação de containers)
 * 3. Validação do RBAC / Permissões (UI, modal de usuários, style.css, server.js e postgres_db.js)
 * 4. Validação da alternância de abas em switchMainTab('compras')
 * 5. Validação de sincronização de tema Claro/Escuro para a aba Compras
 * 6. Validação léxica e sintática de public/app.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

console.log('\n=============================================================');
console.log('🧪 SUÍTE DE TESTES: ABA PRINCIPAL COMPRAS & SUB-ABAS (DRY)');
console.log('=============================================================\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Erro: ${err.message}`);
    failed++;
  }
}

// 1. Verificação do HTML da Aba Principal e Sub-Grupo
test('1. index.html possui botão da aba principal #mainTabCompras e sub-grupo #subGroupCompras', () => {
  const htmlPath = path.join(__dirname, 'public', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  assert.ok(html.includes('id="mainTabCompras"'), 'Falta botão #mainTabCompras no header');
  assert.ok(html.includes('data-main-tab="compras"'), 'Falta atributo data-main-tab="compras"');
  assert.ok(html.includes('COMPRAS</span>'), 'Falta texto da aba COMPRAS');
  assert.ok(html.includes('id="subGroupCompras"'), 'Falta container #subGroupCompras');
});

// 2. Validação DRY das 4 Sub-Abas em COMPRAS e VENDEDORES
test('2. Sub-grupos #subGroupCompras e #subGroupVendedores contêm sub-aba "Prod x Ped Compras" apontando para IDs existentes (DRY)', () => {
  const htmlPath = path.join(__dirname, 'public', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  // Localiza o bloco do subGroupVendedores
  const vendStart = html.indexOf('id="subGroupVendedores"');
  assert.ok(vendStart !== -1, 'subGroupVendedores não encontrado');
  const vendEnd = html.indexOf('id="subGroupCompras"', vendStart);
  const vendBlock = html.substring(vendStart, vendEnd !== -1 ? vendEnd : vendStart + 2500);

  // Valida rótulo em Vendedores
  assert.ok(vendBlock.includes('data-tab="tab-vend-pedidos"'), 'Falta sub-aba tab-vend-pedidos em subGroupVendedores');
  assert.ok(vendBlock.includes('<span>Prod x Ped Compras</span>'), 'Falta rótulo Prod x Ped Compras em subGroupVendedores');

  // Localiza o bloco do subGroupCompras
  const subGroupStart = html.indexOf('id="subGroupCompras"');
  assert.ok(subGroupStart !== -1, 'subGroupCompras não encontrado');
  const subGroupEnd = html.indexOf('<!-- Sub-abas de Assistente Financeiro -->', subGroupStart);
  const subGroupBlock = html.substring(subGroupStart, subGroupEnd !== -1 ? subGroupEnd : subGroupStart + 2500);

  // Verifica as 4 sub-abas e o rótulo atualizado
  assert.ok(subGroupBlock.includes('data-tab="tab-vend-saldos-estoque"'), 'Falta sub-aba apontando para tab-vend-saldos-estoque');
  assert.ok(subGroupBlock.includes('data-tab="tab-vend-pedidos"'), 'Falta sub-aba apontando para tab-vend-pedidos');
  assert.ok(subGroupBlock.includes('<span>Prod x Ped Compras</span>'), 'Falta rótulo Prod x Ped Compras em subGroupCompras');
  assert.ok(subGroupBlock.includes('data-tab="tab-vend-pedidos-abertos"'), 'Falta sub-aba apontando para tab-vend-pedidos-abertos');
  assert.ok(subGroupBlock.includes('data-tab="tab-vend-pedidos-compras"'), 'Falta sub-aba apontando para tab-vend-pedidos-compras');

  // Verifica ausência de duplicação de containers tab-pane
  const matchesSaldos = (html.match(/id="tab-vend-saldos-estoque"/g) || []).length;
  const matchesPedidos = (html.match(/id="tab-vend-pedidos"/g) || []).length;
  const matchesAbertos = (html.match(/id="tab-vend-pedidos-abertos"/g) || []).length;
  const matchesCompras = (html.match(/id="tab-vend-pedidos-compras"/g) || []).length;

  assert.strictEqual(matchesSaldos, 1, 'id="tab-vend-saldos-estoque" deve ser único no DOM (DRY)');
  assert.strictEqual(matchesPedidos, 1, 'id="tab-vend-pedidos" deve ser único no DOM (DRY)');
  assert.strictEqual(matchesAbertos, 1, 'id="tab-vend-pedidos-abertos" deve ser único no DOM (DRY)');
  assert.strictEqual(matchesCompras, 1, 'id="tab-vend-pedidos-compras" deve ser único no DOM (DRY)');
});

// 3. Validação de RBAC e Modal de Usuários
test('3. Gestão de permissões RBAC inclui "compras" em formulário, badges, server.js e postgres_db.js', () => {
  const htmlPath = path.join(__dirname, 'public', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.ok(html.includes('id="permCompras"'), 'Falta checkbox #permCompras no #userModal');
  assert.ok(html.includes('value="compras"'), 'Falta value="compras" no checkbox');
  assert.ok(html.includes('Prod x Ped Compras &amp; Comissões') || html.includes('Prod x Ped Compras & Comissões'), 'Falta texto Prod x Ped Compras & Comissões no modal de permissões');

  const cssPath = path.join(__dirname, 'public', 'style.css');
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.ok(css.includes('.perm-badge-compras'), 'Falta classe .perm-badge-compras no style.css');

  const serverPath = path.join(__dirname, 'server.js');
  const server = fs.readFileSync(serverPath, 'utf8');
  assert.ok(server.includes("'compras'"), 'server.js deve incluir permissão compras');
  assert.ok(server.includes("allowedTabs = ['logistica', 'consulta', 'vendedores', 'compras'"), 'allowedTabs em server.js deve conter compras');

  const dbPath = path.join(__dirname, 'postgres_db.js');
  const db = fs.readFileSync(dbPath, 'utf8');
  assert.ok(db.includes("'compras'"), 'postgres_db.js deve incluir permissão compras no seed admin');
});

// 4. Validação de Lógica no app.js
test('4. public/app.js orquestra switchMainTab("compras") e applyUserPermissions para Compras', () => {
  const jsPath = path.join(__dirname, 'public', 'app.js');
  const js = fs.readFileSync(jsPath, 'utf8');

  assert.ok(js.includes("targetMain === 'compras'"), 'Falta tratamento de targetMain === "compras" em switchMainTab');
  assert.ok(js.includes("subGroupCompras.classList.remove('hidden')"), 'switchMainTab deve exibir subGroupCompras');
  assert.ok(js.includes("perms.includes('compras')"), 'applyUserPermissions deve checar perms.includes("compras")');
  assert.ok(js.includes("permCompras.checked"), 'submit do form e edição devem ler/gravar permCompras');
  assert.ok(js.includes("perm-badge-compras"), 'renderUsersTable deve exibir perm-badge-compras');
});

// 5. Validação de Alternância de Tema no Módulo Compras
test('5. Botão de tema #btnToggleThemeCompras integrado e sincronizado em app.js e vendedores.js', () => {
  const htmlPath = path.join(__dirname, 'public', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.ok(html.includes('id="btnToggleThemeCompras"'), 'Falta #btnToggleThemeCompras no HTML');
  assert.ok(html.includes('id="themeIconCompras"'), 'Falta #themeIconCompras no HTML');
  assert.ok(html.includes('id="themeLabelCompras"'), 'Falta #themeLabelCompras no HTML');

  const jsPath = path.join(__dirname, 'public', 'app.js');
  const js = fs.readFileSync(jsPath, 'utf8');
  assert.ok(js.includes('btnToggleThemeCompras'), 'Falta btnToggleThemeCompras em app.js');
  assert.ok(js.includes('themeIconCompras'), 'Falta themeIconCompras em app.js');
  assert.ok(js.includes('themeLabelCompras'), 'Falta themeLabelCompras em app.js');

  const vendPath = path.join(__dirname, 'public', 'js', 'vendedores.js');
  const vend = fs.readFileSync(vendPath, 'utf8');
  assert.ok(vend.includes('btnToggleThemeCompras'), 'Falta btnToggleThemeCompras em vendedores.js');
  assert.ok(vend.includes('themeIconCompras'), 'Falta themeIconCompras em vendedores.js');
});

// 6. Verificação de Integridade Sintática do app.js
test('6. Compilação léxica de public/app.js sem erros via vm.Script', () => {
  const jsPath = path.join(__dirname, 'public', 'app.js');
  const js = fs.readFileSync(jsPath, 'utf8');

  // Envelopa em função assíncrona simulando browser para validar sintaxe estrita
  assert.doesNotThrow(() => {
    new vm.Script(`(function() {\n${js}\n})();`);
  }, 'Erro de sintaxe encontrado em public/app.js');
});

console.log('\n=============================================================');
console.log(`📊 RESULTADO DOS TESTES: ${passed} Aprovados, ${failed} Falhas`);
console.log('=============================================================\n');

if (failed > 0) {
  process.exit(1);
}
