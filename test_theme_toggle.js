/**
 * test_theme_toggle.js
 * Testes automatizados para validação do recurso de alternância de Tema Claro/Escuro (Light/Dark Mode)
 * em todas as 5 sub-abas do Módulo Vendedores e nos Modais da Plataforma de Apoio GSI.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('\n====================================================');
console.log('🧪 TESTES AUTOMATIZADOS: TEMA CLARO/ESCURO (VENDEDORES & MODAIS)');
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
test('HTML possui botões seletores #btnToggleThemeEstoque e #btnToggleThemeVendedores com ícones e labels', () => {
  const htmlPath = path.join(__dirname, 'public', 'index.html');
  const content = fs.readFileSync(htmlPath, 'utf8');

  assert.ok(content.includes('id="btnToggleThemeEstoque"'), 'Falta elemento #btnToggleThemeEstoque');
  assert.ok(content.includes('id="btnToggleThemeVendedores"'), 'Falta elemento #btnToggleThemeVendedores');
  assert.ok(content.includes('id="themeIconVendedores"'), 'Falta elemento #themeIconVendedores');
  assert.ok(content.includes('id="themeLabelVendedores"'), 'Falta elemento #themeLabelVendedores');
  assert.ok(content.includes('Modo Claro'), 'Label inicial padrão deve ser Modo Claro');
});

// 2. Verificação do CSS em public/style.css
test('CSS contém regras completas de tema claro para todas as sub-abas dos Vendedores e modais', () => {
  const cssPath = path.join(__dirname, 'public', 'style.css');
  const content = fs.readFileSync(cssPath, 'utf8');

  assert.ok(content.includes('.tab-theme-light'), 'Falta classe .tab-theme-light');
  assert.ok(content.includes('.tab-theme-light .card'), 'Falta estilo de card claro');
  assert.ok(content.includes('.tab-theme-light .kpi-card'), 'Falta estilo de kpi-card claro');
  assert.ok(content.includes('.tab-theme-light .stat-card'), 'Falta estilo de stat-card claro');
  assert.ok(content.includes('.tab-theme-light .vend-search-form'), 'Falta estilo de formulário de busca claro');
  assert.ok(content.includes('.tab-theme-light .compras-filter-bar'), 'Falta estilo de filtro de compras claro');
  assert.ok(content.includes('.tab-theme-light .comis-filter-bar'), 'Falta estilo de filtro de comissões claro');
  assert.ok(content.includes('.tab-theme-light .data-table th'), 'Falta cabeçalho claro da tabela');
  assert.ok(content.includes('.tab-theme-light .data-table td'), 'Falta linhas claras da tabela');
  assert.ok(content.includes('.tab-theme-light #estoquePaginationContainer'), 'Falta paginação clara');
  assert.ok(content.includes('#modalEstoqueDetalhes.modal-theme-light'), 'Falta modal claro de estoque');
  assert.ok(content.includes('#pedidoDetalhesModal.modal-theme-light'), 'Falta modal claro de detalhes do pedido');
  assert.ok(content.includes('.tab-theme-light .company-badge'), 'Falta company-badge no tema claro');
});

// 3. Verificação do JavaScript em public/app.js
test('JS possui funções aplicarTemaVendedores, toggleVendedoresTheme e inicializarTemaVendedores para as 5 sub-abas', () => {
  const jsPath = path.join(__dirname, 'public', 'app.js');
  const content = fs.readFileSync(jsPath, 'utf8');

  assert.ok(content.includes('function aplicarTemaVendedores('), 'Falta function aplicarTemaVendedores');
  assert.ok(content.includes('function toggleVendedoresTheme('), 'Falta function toggleVendedoresTheme');
  assert.ok(content.includes('function inicializarTemaVendedores('), 'Falta function inicializarTemaVendedores');
  assert.ok(content.includes("'tab-vend-saldos-estoque'"), 'Falta tab-vend-saldos-estoque na lista de abas');
  assert.ok(content.includes("'tab-vend-pedidos'"), 'Falta tab-vend-pedidos na lista de abas');
  assert.ok(content.includes("'tab-vend-pedidos-abertos'"), 'Falta tab-vend-pedidos-abertos na lista de abas');
  assert.ok(content.includes("'tab-vend-pedidos-compras'"), 'Falta tab-vend-pedidos-compras na lista de abas');
  assert.ok(content.includes("'tab-vend-comissoes'"), 'Falta tab-vend-comissoes na lista de abas');
  assert.ok(content.includes("localStorage.setItem('theme_vendedores'"), 'Falta gravação de theme_vendedores no localStorage');
  assert.ok(content.includes("btnToggleThemeVendedores.addEventListener('click', toggleVendedoresTheme)"), 'Falta listener do botão de tema dos vendedores');
});

// 4. Verificação de Cores Dinâmicas e Acessibilidade (WCAG 2.1)
test('JS adapta cores dinâmicas de texto, badges, saldos, vendas e compras ao tema ativo em todas as telas', () => {
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

// 5. Verificação dos Modais Drilldown e Detalhes do Pedido com Sincronização de Tema
test('Modais de Estoque e Detalhes do Pedido sincronizam classe modal-theme-light e ajustam cores internas', () => {
  const jsPath = path.join(__dirname, 'public', 'app.js');
  const content = fs.readFileSync(jsPath, 'utf8');

  assert.ok(content.includes("modalEstoqueDetalhes.classList.add('modal-theme-light')"), 'Falta adição de classe na modal de estoque');
  assert.ok(content.includes("pedidoDetalhesModal.classList.add('modal-theme-light')"), 'Falta adição de classe na modal de pedido');
  assert.ok(content.includes("pedidoDetalhesModal.classList.remove('modal-theme-light')"), 'Falta remoção de classe na modal de pedido');
});

console.log('\n====================================================');
console.log(`📊 RESULTADO DOS TESTES:`);
console.log(`   ✅ Aprovados: ${passed}`);
console.log(`   ❌ Falhas:    ${failed}`);
console.log('====================================================\n');

if (failed > 0) {
  process.exit(1);
}
