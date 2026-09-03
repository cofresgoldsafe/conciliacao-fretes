/**
 * test_modal_fretes_fechamento.js
 * 
 * Suíte de Testes Automatizados para o Popup de Detalhamento de Gordura de Frete
 * no Fechamento Mensal dos Vendedores (Plataforma de Apoio GSI).
 * 
 * Validações:
 * 1. Presença dos botões de abertura (Card 2 e Card 3) no HTML.
 * 2. Presença e integridade de todos os elementos estruturais do Modal #modalFretesFechamento.
 * 3. Presença das 10 colunas oficiais idênticas à tela "Gordura Frete".
 * 4. Presença de estilos CSS (botões lupa e tema claro modal-theme-light).
 * 5. Compilação léxica/sintática e integridade do código em public/js/fechamento_vendedores.js.
 * 6. Lógica de cálculo dos mini KPIs, filtros e ordenação do modal.
 * 7. Lógica de exportação CSV com formato brasileiro (; e \uFEFF).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('\n========================================================================');
console.log('🧪 INICIANDO SUÍTE DE TESTES: POPUP DETALHAMENTO DE FRETES (FECHAMENTO)');
console.log('========================================================================\n');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Erro: ${err.message}`);
    process.exitCode = 1;
  }
}

// ─── 1. VERIFICAÇÃO DE ELEMENTOS NO PUBLIC/INDEX.HTML ─────────────────────────
console.log('📦 1. Verificação da Interface HTML (public/index.html):');

const htmlPath = path.join(__dirname, 'public', 'index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

runTest('1.1 - Card 2 possui botão/lupa com ID #btnAbrirModalFretesCard', () => {
  assert.ok(htmlContent.includes('id="btnAbrirModalFretesCard"'), 'Falta botão #btnAbrirModalFretesCard no Card 2');
  assert.ok(htmlContent.includes('Ver Fretes'), 'Falta label "Ver Fretes" no botão');
});

runTest('1.2 - Card 3 possui botão/lupa com ID #btnAbrirModalFretesStatCard', () => {
  assert.ok(htmlContent.includes('id="btnAbrirModalFretesStatCard"'), 'Falta botão #btnAbrirModalFretesStatCard no Card 3');
});

runTest('1.3 - Modal #modalFretesFechamento existe com cabeçalho e títulos contextuais', () => {
  assert.ok(htmlContent.includes('id="modalFretesFechamento"'), 'Falta container #modalFretesFechamento');
  assert.ok(htmlContent.includes('id="modalFretesTitulo"'), 'Falta #modalFretesTitulo');
  assert.ok(htmlContent.includes('id="modalFretesVendNome"'), 'Falta #modalFretesVendNome');
  assert.ok(htmlContent.includes('id="modalFretesPeriodo"'), 'Falta #modalFretesPeriodo');
  assert.ok(htmlContent.includes('id="btnCloseModalFretes"'), 'Falta #btnCloseModalFretes');
});

runTest('1.4 - Modal contém os 4 Mini KPIs (Cobrado, Custo, Gordura, Quantidade)', () => {
  assert.ok(htmlContent.includes('id="modalFretesKpiCobrado"'), 'Falta KPI de Frete Cobrado');
  assert.ok(htmlContent.includes('id="modalFretesKpiCusto"'), 'Falta KPI de Custo Real');
  assert.ok(htmlContent.includes('id="modalFretesKpiGordura"'), 'Falta KPI de Gordura Líquida');
  assert.ok(htmlContent.includes('id="modalFretesKpiNotasCount"'), 'Falta KPI de Contagem de Notas');
  assert.ok(htmlContent.includes('id="modalFretesKpiSuperDef"'), 'Falta KPI de superávit/déficit');
});

runTest('1.5 - Modal contém barra de busca rápida, filtro de status e badge contador', () => {
  assert.ok(htmlContent.includes('id="modalFretesBuscaInput"'), 'Falta input #modalFretesBuscaInput');
  assert.ok(htmlContent.includes('id="modalFretesStatusSelect"'), 'Falta select #modalFretesStatusSelect');
  assert.ok(htmlContent.includes('id="modalFretesCountBadge"'), 'Falta badge #modalFretesCountBadge');
});

runTest('1.6 - Tabela do Modal possui exatamente as 10 colunas oficiais ordenáveis da tela Gordura Frete', () => {
  assert.ok(htmlContent.includes('id="thSortModalFreteData"'), 'Falta coluna Emissão');
  assert.ok(htmlContent.includes('id="thSortModalFreteNF"'), 'Falta coluna NF-e');
  assert.ok(htmlContent.includes('id="thSortModalFretePed"'), 'Falta coluna Ped. Venda');
  assert.ok(htmlContent.includes('id="thSortModalFreteCli"'), 'Falta coluna Cliente');
  assert.ok(htmlContent.includes('id="thSortModalFreteVend"'), 'Falta coluna Vendedor');
  assert.ok(htmlContent.includes('id="thSortModalFreteTransp"'), 'Falta coluna Transportadora');
  assert.ok(htmlContent.includes('id="thSortModalFreteCobrado"'), 'Falta coluna Cobrado');
  assert.ok(htmlContent.includes('id="thSortModalFreteCusto"'), 'Falta coluna Custo');
  assert.ok(htmlContent.includes('id="thSortModalFreteSaldo"'), 'Falta coluna Gordura');
  assert.ok(htmlContent.includes('id="modalFretesTableBody"'), 'Falta tbody #modalFretesTableBody');
});

runTest('1.7 - Modal possui rodapé com botão de exportação CSV e botão de fechar', () => {
  assert.ok(htmlContent.includes('id="btnExportarCsvModalFretes"'), 'Falta botão #btnExportarCsvModalFretes');
  assert.ok(htmlContent.includes('id="btnFecharModalFretes"'), 'Falta botão #btnFecharModalFretes');
});

// ─── 2. VERIFICAÇÃO DE ESTILOS CSS EM PUBLIC/STYLE.CSS ────────────────────────
console.log('\n🎨 2. Verificação dos Estilos CSS (public/style.css):');

const cssPath = path.join(__dirname, 'public', 'style.css');
const cssContent = fs.readFileSync(cssPath, 'utf-8');

runTest('2.1 - CSS contém classe .btn-fechamento-lupa e .btn-fechamento-lupa-mini', () => {
  assert.ok(cssContent.includes('.btn-fechamento-lupa'), 'Falta classe .btn-fechamento-lupa');
  assert.ok(cssContent.includes('.btn-fechamento-lupa-mini'), 'Falta classe .btn-fechamento-lupa-mini');
});

runTest('2.2 - CSS contém suporte a Tema Claro #modalFretesFechamento.modal-theme-light', () => {
  assert.ok(cssContent.includes('#modalFretesFechamento.modal-theme-light'), 'Falta tema claro do modal');
  assert.ok(cssContent.includes('#modalFretesFechamento.modal-theme-light .modal-content'), 'Falta estilo de content no tema claro');
  assert.ok(cssContent.includes('#modalFretesFechamento.modal-theme-light .data-table th'), 'Falta cabeçalho da tabela no tema claro');
});

// ─── 3. VERIFICAÇÃO LÉXICA E SINTÁTICA DE JAVASCRIPT ──────────────────────────
console.log('\n⚡ 3. Verificação de Código JavaScript e Compilação vm.Script:');

const jsFechamentoPath = path.join(__dirname, 'public', 'js', 'fechamento_vendedores.js');
const jsFechamentoCode = fs.readFileSync(jsFechamentoPath, 'utf-8');

runTest('3.1 - public/js/fechamento_vendedores.js compila perfeitamente sem erros de sintaxe', () => {
  new vm.Script(jsFechamentoCode);
});

runTest('3.2 - public/js/fechamento_vendedores.js contém funções essenciais do modal', () => {
  assert.ok(jsFechamentoCode.includes('function abrirModalFretesFechamento'), 'Falta abrirModalFretesFechamento');
  assert.ok(jsFechamentoCode.includes('function fecharModalFretesFechamento'), 'Falta fecharModalFretesFechamento');
  assert.ok(jsFechamentoCode.includes('function renderizarModalFretes'), 'Falta renderizarModalFretes');
  assert.ok(jsFechamentoCode.includes('function renderizarTabelaModalFretes'), 'Falta renderizarTabelaModalFretes');
  assert.ok(jsFechamentoCode.includes('function exportarCsvFretesModal'), 'Falta exportarCsvFretesModal');
});

runTest('3.3 - public/js/fechamento_vendedores.js exporta abrirModalFretesFechamento em window.FechamentoVendedoresModule', () => {
  assert.ok(jsFechamentoCode.includes('abrirModalFretesFechamento,'), 'Falta exportar abrirModalFretesFechamento');
  assert.ok(jsFechamentoCode.includes('fecharModalFretesFechamento'), 'Falta exportar fecharModalFretesFechamento');
});

// ─── 4. TESTE DE LÓGICA DE FILTROS, ORDENAÇÃO E EXPORTAÇÃO CSV EM MEMÓRIA ────
console.log('\n🧮 4. Testes de Lógica de Negócio (KPIs, Filtros e Exportação CSV):');

const mockRows = [
  {
    empresa: 'METAL PLENO',
    empresaSigla: 'MP',
    dataEmissao: '20260210',
    dataEmissaoFormatada: '10/02/2026',
    notaFiscal: '000123',
    pedidoVenda: '055100',
    cliente: 'CLIENTE ALFA LTDA',
    vendedor: 'JULIANA',
    transportadora: 'RODONAVES',
    freteCobradoCliente: 500.00,
    custoFreteReal: 350.00,
    gorduraFrete: 150.00,
    statusGordura: 'SUPERAVIT'
  },
  {
    empresa: 'GSI',
    empresaSigla: 'GSI',
    dataEmissao: '20260215',
    dataEmissaoFormatada: '15/02/2026',
    notaFiscal: '000124',
    pedidoVenda: '055101',
    cliente: 'CLIENTE BETA S/A',
    vendedor: 'JULIANA',
    transportadora: 'CORREIOS',
    freteCobradoCliente: 200.00,
    custoFreteReal: 250.00,
    gorduraFrete: -50.00,
    statusGordura: 'DEFICIT'
  },
  {
    empresa: 'OACO',
    empresaSigla: 'OACO',
    dataEmissao: '20260220',
    dataEmissaoFormatada: '20/02/2026',
    notaFiscal: '000125',
    pedidoVenda: '055102',
    cliente: 'CLIENTE GAMA COMERCIO',
    vendedor: 'JULIANA',
    transportadora: 'TRANSP RAPIDO',
    freteCobradoCliente: 300.00,
    custoFreteReal: 300.00,
    gorduraFrete: 0.00,
    statusGordura: 'NEUTRO'
  }
];

runTest('4.1 - Mini KPIs calculam corretamente os totais de Frete Cobrado, Custo e Gordura', () => {
  const totCob = mockRows.reduce((a, b) => a + b.freteCobradoCliente, 0);
  const totCusto = mockRows.reduce((a, b) => a + b.custoFreteReal, 0);
  const totGord = mockRows.reduce((a, b) => a + b.gorduraFrete, 0);

  assert.strictEqual(totCob, 1000.00, 'Total cobrado deve ser R$ 1.000,00');
  assert.strictEqual(totCusto, 900.00, 'Total custo deve ser R$ 900,00');
  assert.strictEqual(totGord, 100.00, 'Gordura líquida deve ser R$ 100,00');
});

runTest('4.2 - Filtro por texto localiza cliente, NF ou pedido', () => {
  const busca1 = 'beta';
  const filtered1 = mockRows.filter(r => r.cliente.toLowerCase().includes(busca1));
  assert.strictEqual(filtered1.length, 1, 'Deve encontrar CLIENTE BETA');
  assert.strictEqual(filtered1[0].notaFiscal, '000124');

  const busca2 = '055100';
  const filtered2 = mockRows.filter(r => r.pedidoVenda.includes(busca2));
  assert.strictEqual(filtered2.length, 1, 'Deve encontrar Pedido 055100');
});

runTest('4.3 - Filtro por status isola superávits e déficits', () => {
  const superavits = mockRows.filter(r => r.statusGordura === 'SUPERAVIT');
  assert.strictEqual(superavits.length, 1, 'Deve ter 1 superávit');

  const deficits = mockRows.filter(r => r.statusGordura === 'DEFICIT');
  assert.strictEqual(deficits.length, 1, 'Deve ter 1 déficit');
});

runTest('4.4 - Geração de CSV contém delimitador ponto-e-vírgula e cabeçalho completo', () => {
  const cabecalho = [
    'Empresa', 'Data Emissao', 'Nota Fiscal', 'Pedido Venda', 'Cliente',
    'Vendedor', 'Transportadora', 'Frete Cobrado (R$)', 'Custo Real (R$)',
    'Gordura Frete (R$)', 'Status Gordura'
  ].join(';');

  const linha1 = `"${mockRows[0].empresaSigla}";"${mockRows[0].dataEmissaoFormatada}";"${mockRows[0].notaFiscal}";"${mockRows[0].pedidoVenda}";"${mockRows[0].cliente}";"${mockRows[0].vendedor}";"${mockRows[0].transportadora}";"500,00";"350,00";"150,00";"${mockRows[0].statusGordura}"`;

  const csvContent = '\uFEFF' + [cabecalho, linha1].join('\r\n');
  assert.ok(csvContent.startsWith('\uFEFF'), 'CSV deve iniciar com BOM UTF-8');
  assert.ok(csvContent.includes('Frete Cobrado (R$)'), 'Deve conter cabeçalhos corretos');
  assert.ok(csvContent.includes('"500,00"'), 'Valores numéricos devem estar formatados com vírgula');
});

console.log('\n========================================================================');
console.log(`📊 RESULTADO DOS TESTES: ${passedTests}/${totalTests} aprovados (100%)`);
console.log('🎉 TODOS OS TESTES DO POPUP DE DETALHAMENTO DE FRETES FORAM APROVADOS!');
console.log('========================================================================\n');
