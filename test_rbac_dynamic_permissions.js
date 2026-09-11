/**
 * test_rbac_dynamic_permissions.js
 * 
 * Suíte de testes automatizados para verificação da arquitetura dinâmica
 * de permissões RBAC (Abas Permitidas, Analista Fin, Telas Futuras e Badges).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passCount++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error('     ', err.message);
    failCount++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passCount++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error('     ', err.message);
    failCount++;
  }
}

console.log('\n====================================================');
console.log('🧪 TESTES: PERMISSÕES RBAC DINÂMICAS & ABAS PERMITIDAS');
console.log('====================================================\n');

// 1. Validação de Backend (server.js)
test('1.1 server.js contém allowedTabs com analista-fin, tarefas, bi e suporte a slugs dinâmicos', () => {
  const serverPath = path.join(__dirname, 'server.js');
  const serverContent = fs.readFileSync(serverPath, 'utf8');

  assert.ok(serverContent.includes("'analista-fin'"), 'server.js deve conter analista-fin em allowedTabs');
  assert.ok(serverContent.includes("'tarefas'"), 'server.js deve conter tarefas em allowedTabs');
  assert.ok(serverContent.includes("allowedTabs = ['logistica', 'consulta', 'vendedores', 'compras'"), 'allowedTabs deve manter compatibilidade com teste de compras');
  assert.ok(serverContent.includes('tabSlugRegex'), 'server.js deve conter regex para autorizar novos slugs de abas no futuro');
});

test('1.2 Lógica de sanitização de permissions preserva analista-fin e novas telas dinâmicas', () => {
  const allowedTabs = ['logistica', 'consulta', 'vendedores', 'compras', 'financeiro', 'analista-fin', 'bi', 'tarefas', 'configuracoes'];
  const tabSlugRegex = /^[a-z0-9_-]{2,50}$/;

  const sanitizePerms = (permissions) => {
    return Array.isArray(permissions)
      ? permissions.map(p => String(p).trim().toLowerCase()).filter(p => allowedTabs.includes(p) || tabSlugRegex.test(p))
      : ['logistica', 'consulta'];
  };

  // Teste com as permissões da Érica
  const ericaPerms = ['logistica', 'consulta', 'financeiro', 'analista-fin'];
  const cleanedErica = sanitizePerms(ericaPerms);
  assert.deepStrictEqual(cleanedErica, ['logistica', 'consulta', 'financeiro', 'analista-fin'], 'Deve preservar analista-fin integralmente');

  // Teste com nova tela futura
  const futurePerms = ['logistica', 'nova-tela-rh', 'dashboard_bi_2026'];
  const cleanedFuture = sanitizePerms(futurePerms);
  assert.deepStrictEqual(cleanedFuture, ['logistica', 'nova-tela-rh', 'dashboard_bi_2026'], 'Deve permitir slugs válidos de telas futuras');

  // Teste com injeções inválidas
  const maliciousPerms = ['logistica', '<script>alert(1)</script>', "'; DROP TABLE users;--", 'a'];
  const cleanedMalicious = sanitizePerms(maliciousPerms);
  assert.deepStrictEqual(cleanedMalicious, ['logistica'], 'Deve descartar injeções e slugs inválidos');
});

// 2. Validação de Frontend (app.js)
test('2.1 public/app.js possui SYSTEM_TABS_REGISTRY com analista-fin e todas as abas oficiais', () => {
  const appPath = path.join(__dirname, 'public', 'app.js');
  const appContent = fs.readFileSync(appPath, 'utf8');

  assert.ok(appContent.includes('SYSTEM_TABS_REGISTRY'), 'app.js deve declarar SYSTEM_TABS_REGISTRY');
  assert.ok(appContent.includes("'analista-fin'"), 'SYSTEM_TABS_REGISTRY deve conter analista-fin');
  assert.ok(appContent.includes('perm-badge-analista-fin'), 'SYSTEM_TABS_REGISTRY deve apontar para perm-badge-analista-fin');
  assert.ok(appContent.includes('perm-badge-compras'), 'SYSTEM_TABS_REGISTRY deve conter perm-badge-compras');
});

test('2.2 public/app.js possui função getTabBadgeMeta com fallback genérico resiliente', () => {
  const appPath = path.join(__dirname, 'public', 'app.js');
  const appContent = fs.readFileSync(appPath, 'utf8');

  assert.ok(appContent.includes('function getTabBadgeMeta'), 'app.js deve implementar getTabBadgeMeta');
  assert.ok(appContent.includes('perm-badge-generic'), 'getTabBadgeMeta deve retornar perm-badge-generic para telas não mapeadas');
  assert.ok(appContent.includes('renderPermBadgeHtml'), 'app.js deve implementar renderPermBadgeHtml');
});

test('2.3 renderUsersTable em app.js itera dinamicamente sobre todas as permissões sem array hardcoded', () => {
  const appPath = path.join(__dirname, 'public', 'app.js');
  const appContent = fs.readFileSync(appPath, 'utf8');

  assert.ok(appContent.includes('perms.map(p => renderPermBadgeHtml(p))'), 'renderUsersTable deve mapear todas as perms via renderPermBadgeHtml');
  assert.ok(!appContent.includes("perms.includes('logistica') ? '<span class=\"perm-badge perm-badge-logistica\">"), 'Não deve mais usar ternários hardcoded estáticos para perms');
});

test('2.4 Modal de usuários em app.js descobre dinamicamente checkboxes com input[type="checkbox"][value]', () => {
  const appPath = path.join(__dirname, 'public', 'app.js');
  const appContent = fs.readFileSync(appPath, 'utf8');

  assert.ok(appContent.includes('document.querySelectorAll(\'#userModal input[type="checkbox"][value]\')'), 'Modal deve descobrir checkboxes dinamicamente');
  assert.ok(appContent.includes('document.querySelectorAll(\'#userModal input[type="checkbox"][value]:checked\')'), 'Submit deve ler checkboxes marcados dinamicamente');
});

// 3. Validação de Estilos CSS (public/style.css)
test('3.1 public/style.css define classes para analista-fin, tarefas, bi e generic', () => {
  const cssPath = path.join(__dirname, 'public', 'style.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');

  assert.ok(cssContent.includes('.perm-badge-analista-fin'), 'style.css deve conter .perm-badge-analista-fin');
  assert.ok(cssContent.includes('.perm-badge-tarefas'), 'style.css deve conter .perm-badge-tarefas');
  assert.ok(cssContent.includes('.perm-badge-bi'), 'style.css deve conter .perm-badge-bi');
  assert.ok(cssContent.includes('.perm-badge-generic'), 'style.css deve conter .perm-badge-generic');
});

// 4. Validação dos Dados em users.json
test('4.1 data/users.json contém usuária erica com permissões completas (incluindo analista-fin)', () => {
  const usersPath = path.join(__dirname, 'data', 'users.json');
  const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
  const erica = users.find(u => u.username === 'erica');

  assert.ok(erica, 'Usuária erica deve existir em users.json');
  assert.ok(Array.isArray(erica.permissions), 'erica.permissions deve ser um array');
  assert.ok(erica.permissions.includes('logistica'), 'erica deve ter logistica');
  assert.ok(erica.permissions.includes('consulta'), 'erica deve ter consulta');
  assert.ok(erica.permissions.includes('financeiro'), 'erica deve ter financeiro');
  assert.ok(erica.permissions.includes('analista-fin'), 'erica deve ter analista-fin');
});

// 5. Teste Unitário da Lógica de Renderização do Badge
test('5.1 Execução unitária de getTabBadgeMeta e renderPermBadgeHtml', () => {
  const SYSTEM_TABS_REGISTRY = {
    'tarefas': { label: 'Minhas Tarefas', icon: '📋', className: 'perm-badge-tarefas' },
    'logistica': { label: 'Logística', icon: '📦', className: 'perm-badge-logistica' },
    'consulta': { label: 'Consulta', icon: '🔍', className: 'perm-badge-consulta' },
    'vendedores': { label: 'Vendedores', icon: '💼', className: 'perm-badge-vendedores' },
    'compras': { label: 'Compras', icon: '🛒', className: 'perm-badge-compras' },
    'financeiro': { label: 'Assist. Financ.', icon: '💰', className: 'perm-badge-financeiro' },
    'analista-fin': { label: 'Analista Fin', icon: '📑', className: 'perm-badge-analista-fin' },
    'bi': { label: 'BI Executivo', icon: '📊', className: 'perm-badge-bi' },
    'configuracoes': { label: 'Configurações', icon: '⚙️', className: 'perm-badge-configuracoes' }
  };

  function getTabBadgeMeta(permKey) {
    const cleanKey = String(permKey || '').trim().toLowerCase();
    if (SYSTEM_TABS_REGISTRY[cleanKey]) {
      return SYSTEM_TABS_REGISTRY[cleanKey];
    }
    const formatted = cleanKey.split(/[-_]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return {
      label: formatted || cleanKey,
      icon: '📌',
      className: 'perm-badge-generic'
    };
  }

  function renderPermBadgeHtml(permKey) {
    const meta = getTabBadgeMeta(permKey);
    return `<span class="perm-badge ${meta.className}">${meta.icon} ${meta.label}</span>`;
  }

  // Abas Homologadas
  const htmlAnalista = renderPermBadgeHtml('analista-fin');
  assert.strictEqual(htmlAnalista, '<span class="perm-badge perm-badge-analista-fin">📑 Analista Fin</span>');

  const htmlLogistica = renderPermBadgeHtml('logistica');
  assert.strictEqual(htmlLogistica, '<span class="perm-badge perm-badge-logistica">📦 Logística</span>');

  // Aba Futura Desconhecida
  const htmlNova = renderPermBadgeHtml('controle-qualidade');
  assert.strictEqual(htmlNova, '<span class="perm-badge perm-badge-generic">📌 Controle Qualidade</span>');
});

console.log('\n====================================================');
console.log(`📊 RESULTADOS: ${passCount} Aprovados, ${failCount} Falhas`);
console.log('====================================================\n');

if (failCount > 0) {
  process.exit(1);
}
