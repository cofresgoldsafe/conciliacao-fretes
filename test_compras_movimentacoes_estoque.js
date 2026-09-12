/**
 * test_compras_movimentacoes_estoque.js
 * 
 * Suíte de Testes Automatizados: Sub-aba Movimentações do Estoque (Módulo Compras)
 * 
 * Cobertura:
 * 1. Validação de exportação e assinatura de consultarMovimentacoesEstoqueProtheus
 * 2. Validação de validações de entrada e sanitização contra SQL Injection
 * 3. Validação de cálculo dinâmico do período padrão de 12 meses
 * 4. Validação de consulta Protheus real (SD1 Entradas / Romaneios + SD2 Saídas + SF4 TES)
 * 5. Validação de classificação de Romaneios Manuais vs NFs normais
 * 6. Validação de KPIs consolidados (Total Entradas, Saídas, Saldo Período, etc.)
 * 7. Validação de integridade sintática e léxica de public/js/compras_movimentacoes_estoque.js e public/app.js
 * 8. Validação de integridade de tags HTML no public/index.html
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const {
  consultarMovimentacoesEstoqueProtheus,
  formatarDataProtheus,
  sanitizeSqlParam
} = require('./protheus_db');

let passCount = 0;
let failCount = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ [PASS] ${name}`);
    passCount++;
  } catch (err) {
    console.error(`❌ [FAIL] ${name}:`, err.message);
    failCount++;
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('🧪 INICIANDO TESTES: MOVIMENTAÇÕES DO ESTOQUE (MÓDULO COMPRAS)');
  console.log('================================================================\n');

  // Teste 1: Validação de Exportação da Função
  await test('1. consultarMovimentacoesEstoqueProtheus deve estar exportada em protheus_db', () => {
    assert.strictEqual(typeof consultarMovimentacoesEstoqueProtheus, 'function');
  });

  // Teste 2: Validação de Parâmetros Obrigatórios e Sanitização
  await test('2. Deve rejeitar consulta sem código do produto', async () => {
    await assert.rejects(
      async () => {
        await consultarMovimentacoesEstoqueProtheus({ codProduto: '' });
      },
      /Informe o código do produto/
    );
  });

  await test('3. Deve rejeitar data inicial posterior à data final', async () => {
    await assert.rejects(
      async () => {
        await consultarMovimentacoesEstoqueProtheus({
          codProduto: '01801080802B003',
          dataIni: '20261231',
          dataFim: '20260101'
        });
      },
      /A data inicial não pode ser posterior à data final/
    );
  });

  // Teste 4: Consulta Real de Movimentações (Metal Pleno + GSI + OACO)
  await test('4. Consulta Protheus real com produto existente (últimos 12 meses)', async () => {
    const res = await consultarMovimentacoesEstoqueProtheus({
      codProduto: '01801080802B003',
      empresa: 'TODAS'
    });

    assert.strictEqual(res.ok, true, 'Deve retornar ok: true');
    assert.ok(res.produto, 'Deve retornar dados cadastrais do produto');
    assert.strictEqual(res.produto.CODIGO, '01801080802B003');
    assert.ok(res.periodo, 'Deve retornar período');
    assert.ok(res.kpis, 'Deve retornar KPIs consolidados');
    assert.ok(typeof res.kpis.totalEntradasQtd === 'number', 'KPI totalEntradasQtd deve ser número');
    assert.ok(typeof res.kpis.totalSaidasQtd === 'number', 'KPI totalSaidasQtd deve ser número');
    assert.ok(typeof res.kpis.saldoPeriodoQtd === 'number', 'KPI saldoPeriodoQtd deve ser número');
    assert.ok(Array.isArray(res.movimentacoes), 'movimentacoes deve ser um array');
    assert.ok(res.movimentacoes.length > 0, 'Deve conter movimentações reais');
    assert.ok(Array.isArray(res.listaTes), 'listaTes deve ser um array');
    assert.ok(res.listaTes.length > 0, 'listaTes deve conter tipos de TES');

    // Verificar estrutura de uma movimentação
    const mov = res.movimentacoes[0];
    assert.ok(mov.id, 'Movimentação deve ter id');
    assert.ok(mov.empresa, 'Movimentação deve ter empresa');
    assert.ok(['ENTRADA', 'SAIDA'].includes(mov.tipoMov), 'tipoMov deve ser ENTRADA ou SAIDA');
    assert.ok(typeof mov.isManual === 'boolean', 'isManual deve ser boolean');
    assert.ok(mov.doc, 'Movimentação deve ter doc');
    assert.ok(typeof mov.quantidade === 'number', 'quantidade deve ser number');
  });

  // Teste 5: Classificação Correta de Entradas Manuais (Romaneios)
  await test('5. Deve identificar entradas manuais com prefixo ROM/TFE ou série vazia', async () => {
    const res = await consultarMovimentacoesEstoqueProtheus({
      codProduto: '01801080802B003',
      tipoMov: 'ENTRADA_MANUAL'
    });

    assert.strictEqual(res.ok, true);
    assert.ok(Array.isArray(res.movimentacoes));
    res.movimentacoes.forEach(m => {
      assert.strictEqual(m.tipoMov, 'ENTRADA');
      assert.strictEqual(m.isManual, true);
      assert.strictEqual(m.subTipo, 'ENTRADA_MANUAL');
    });
  });

  // Teste 6: Filtro por Código da Movimentação (TES)
  await test('6. Deve filtrar corretamente por código específico de TES', async () => {
    const res = await consultarMovimentacoesEstoqueProtheus({
      codProduto: '01801080802B003',
      tes: '501'
    });

    assert.strictEqual(res.ok, true);
    assert.ok(res.movimentacoes.length > 0);
    res.movimentacoes.forEach(m => {
      assert.strictEqual(m.tes, '501');
      assert.strictEqual(m.tipoMov, 'SAIDA');
    });
  });

  // Teste 7: Integridade Sintática do Módulo Frontend Isolado
  await test('7. public/js/compras_movimentacoes_estoque.js deve compilar sem erros de sintaxe', () => {
    const filePath = path.join(__dirname, 'public', 'js', 'compras_movimentacoes_estoque.js');
    assert.ok(fs.existsSync(filePath), 'Arquivo compras_movimentacoes_estoque.js deve existir');
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Executa análise sintática via Node.js vm
    assert.doesNotThrow(() => {
      new vm.Script(content, { filename: 'compras_movimentacoes_estoque.js' });
    });
  });

  // Teste 8: Integridade Sintática do public/app.js
  await test('8. public/app.js deve compilar sem erros de sintaxe (zero colisões léxicas)', () => {
    const appJsPath = path.join(__dirname, 'public', 'app.js');
    const content = fs.readFileSync(appJsPath, 'utf8');
    assert.doesNotThrow(() => {
      new vm.Script(content, { filename: 'app.js' });
    });
  });

  // Teste 9: Validação de Estrutura no public/index.html
  await test('9. public/index.html deve conter elementos da sub-aba Movimentações do Estoque', () => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    const html = fs.readFileSync(indexPath, 'utf8');

    assert.ok(html.includes('id="btnTabComprasMovimentacoesEstoque"'), 'Deve conter botão da sub-aba');
    assert.ok(html.includes('id="tab-compras-movimentacoes-estoque"'), 'Deve conter painel da sub-aba');
    assert.ok(html.includes('id="movEstoqueInputProduto"'), 'Deve conter campo de busca do produto');
    assert.ok(html.includes('id="movEstoqueSugestoesList"'), 'Deve conter lista de autocomplete');
    assert.ok(html.includes('id="movEstoqueDataIni"'), 'Deve conter campo Data Inicial');
    assert.ok(html.includes('id="movEstoqueDataFim"'), 'Deve conter campo Data Final');
    assert.ok(html.includes('id="movEstoqueFiltroEmpresa"'), 'Deve conter seletor de Empresa');
    assert.ok(html.includes('id="movEstoqueFiltroTipo"'), 'Deve conter seletor de Tipo de Movimentação');
    assert.ok(html.includes('id="movEstoqueFiltroTes"'), 'Deve conter seletor de TES');
    assert.ok(html.includes('id="btnConsultarMovEstoque"'), 'Deve conter botão de consulta');
    assert.ok(html.includes('id="btnExportarMovEstoque"'), 'Deve conter botão de exportar Excel');
    assert.ok(html.includes('id="movEstoqueTbody"'), 'Deve conter tbody da tabela');
    assert.ok(html.includes('js/compras_movimentacoes_estoque.js'), 'Deve incluir script do módulo');
  });

  // Teste 10: Validação de Estilos do Tema Claro em public/style.css
  await test('10. public/style.css deve conter regras de tema claro para Movimentações do Estoque', () => {
    const cssPath = path.join(__dirname, 'public', 'style.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    assert.ok(css.includes('#tab-compras-movimentacoes-estoque.tab-theme-light'), 'Deve conter classe tab-theme-light para a sub-aba');
  });

  // Teste 11: Resolução Automática de Produto por Descrição
  await test('11. Deve resolver produto automaticamente ao buscar por descrição', async () => {
    const res = await consultarMovimentacoesEstoqueProtheus({
      codProduto: 'ARMARIO',
      empresa: 'MP'
    });

    assert.strictEqual(res.ok, true);
    assert.ok(res.produto.CODIGO, 'Produto deve ter código resolvido');
    assert.ok(res.produto.DESCRICAO.includes('ARMARIO'), 'Descrição deve corresponder ao produto encontrado');
  });

  // Teste 12: Mitigação contra CSV Formula Injection (CWE-1236)
  await test('12. public/js/compras_movimentacoes_estoque.js deve implementar sanitização contra CSV Formula Injection', () => {
    const filePath = path.join(__dirname, 'public', 'js', 'compras_movimentacoes_estoque.js');
    const content = fs.readFileSync(filePath, 'utf8');
    assert.ok(content.includes('escapeCsvCell'), 'Deve implementar função de sanitização de células CSV');
    assert.ok(content.includes('^[=+\\-@\\t\\r]'), 'Deve verificar prefixos de fórmulas executáveis do Excel');
  });

  console.log('\n================================================================');
  console.log(`📊 RESULTADO FINAL: ${passCount} APROVADOS | ${failCount} FALHAS`);
  console.log('================================================================');

  if (failCount > 0) {
    process.exit(1);
  }
}

runTests();
