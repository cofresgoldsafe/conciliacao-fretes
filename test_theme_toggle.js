/**
 * test_theme_toggle.js
 * Testes automatizados para validação do recurso de alternância de Tema Claro/Escuro (Light/Dark Mode)
 * na sub-aba Saldos em Estoque e no Modal Drilldown da Plataforma de Apoio GSI.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('\n====================================================');
console.log('🧪 TESTES AUTOMATIZADOS: TEMA CLARO/ESCURO (SALDOS ESTOQUE)');
console.log('====================================================\n');

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

// 1. Verificação do HTML em public/index.html
test('HTML possui botão seletor #btnToggleThemeEstoque com ícone e label', () => {
  const htmlPath = path.join(__dirname, 'public', 'index.html');
  const content = fs.readFileSync(htmlPath, 'utf8');

  assert.ok(content.includes('id="btnToggleThemeEstoque"'), 'Falta elemento #btnToggleThemeEstoque');
  assert.ok(content.includes('id="themeIconEstoque"'), 'Falta elemento #themeIconEstoque');
  assert.ok(content.includes('id="themeLabelEstoque"'), 'Falta elemento #themeLabelEstoque');
  assert.ok(content.includes('Modo Claro'), 'Label inicial padrão deve ser Modo Claro');
});

// 2. Verificação do CSS em public/style.css
test('CSS contém regras completas de tema claro com escopo .tab-theme-light e .modal-theme-light', () => {
  const cssPath = path.join(__dirname, 'public', 'style.css');
  const content = fs.readFileSync(cssPath, 'utf8');

  assert.ok(content.includes('.tab-theme-light'), 'Falta classe .tab-theme-light');
  assert.ok(content.includes('.tab-theme-light .card'), 'Falta estilo de card claro');
  assert.ok(content.includes('.tab-theme-light .kpi-card'), 'Falta estilo de kpi-card claro');
  assert.ok(content.includes('.tab-theme-light #kpiItensEstoque'), 'Falta estilo de KPI positivo claro');
  assert.ok(content.includes('.tab-theme-light .vend-search-form'), 'Falta estilo de formulário de busca claro');
  assert.ok(content.includes('.tab-theme-light .data-table th'), 'Falta cabeçalho claro da tabela');
  assert.ok(content.includes('.tab-theme-light .data-table td'), 'Falta linhas claras da tabela');
  assert.ok(content.includes('.tab-theme-light #estoquePaginationContainer'), 'Falta paginação clara');
  assert.ok(content.includes('#modalEstoqueDetalhes.modal-theme-light'), 'Falta modal claro de estoque');
  assert.ok(content.includes('#modalEstoqueDetalhes.modal-theme-light #modalEstoqueTitulo'), 'Falta título claro da modal');
});

// 3. Verificação do JavaScript em public/app.js
test('JS possui funções aplicarTemaEstoque, toggleEstoqueTheme e inicializarTemaEstoque com persistência localStorage', () => {
  const jsPath = path.join(__dirname, 'public', 'app.js');
  const content = fs.readFileSync(jsPath, 'utf8');

  assert.ok(content.includes('function aplicarTemaEstoque('), 'Falta function aplicarTemaEstoque');
  assert.ok(content.includes('function toggleEstoqueTheme('), 'Falta function toggleEstoqueTheme');
  assert.ok(content.includes('function inicializarTemaEstoque('), 'Falta function inicializarTemaEstoque');
  assert.ok(content.includes("localStorage.setItem('theme_saldos_estoque'"), 'Falta gravação no localStorage');
  assert.ok(content.includes("localStorage.getItem('theme_saldos_estoque'"), 'Falta leitura do localStorage');
  assert.ok(content.includes("btnToggleThemeEstoque.addEventListener('click', toggleEstoqueTheme)"), 'Falta listener do botão de tema');
});

// 4. Verificação de Cores Dinâmicas e Acessibilidade (WCAG 2.1)
test('JS adapta cores dinâmicas de texto, badges, saldos, vendas e compras ao tema ativo', () => {
  const jsPath = path.join(__dirname, 'public', 'app.js');
  const content = fs.readFileSync(jsPath, 'utf8');

  // Verifica contraste de texto escuro sobre fundo claro no render da tabela
  assert.ok(content.includes("isLight ? '#0f172a' : '#f1f5f9'"), 'Falta ajuste de cor do título do produto para tema claro');
  // Verde mais escuro (#059669) para fundo claro vs (#10b981) para fundo escuro
  assert.ok(content.includes("isLight ? '#059669' : '#10b981'"), 'Falta verde WCAG AA para tema claro');
  // Azul escuro (#0284c7) para compras/totais no tema claro vs (#38bdf8)
  assert.ok(content.includes("isLight ? '#0284c7' : '#38bdf8'"), 'Falta azul WCAG AA para tema claro');
  // Âmbar escuro (#d97706) para vendas no tema claro vs (#fbbf24)
  assert.ok(content.includes("isLight ? '#d97706' : '#fbbf24'"), 'Falta âmbar WCAG AA para vendas no tema claro');
});

// 5. Verificação da Modal Drilldown com Sincronização de Tema
test('abrirModalEstoqueDetalhes sincroniza classe modal-theme-light e ajusta cores das tabelas internas', () => {
  const jsPath = path.join(__dirname, 'public', 'app.js');
  const content = fs.readFileSync(jsPath, 'utf8');

  assert.ok(content.includes("modalEstoqueDetalhes.classList.add('modal-theme-light')"), 'Falta adição de classe na modal no modo claro');
  assert.ok(content.includes("modalEstoqueDetalhes.classList.remove('modal-theme-light')"), 'Falta remoção de classe na modal no modo escuro');
});

console.log('\n====================================================');
console.log(`📊 RESULTADO DOS TESTES:`);
console.log(`   ✅ Aprovados: ${passed}`);
console.log(`   ❌ Falhas:    ${failed}`);
console.log('====================================================\n');

if (failed > 0) {
  process.exit(1);
}
