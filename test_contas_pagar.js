const assert = require('assert');
const {
  classificarSituacaoTitulo,
  MOTIVOS_BAIXA_MAP,
  EMPRESAS_CONTAS_PAGAR,
  consultarContasPagarSe2,
  consultarMovimentacoesTituloSe5,
  sanitizeSqlParam
} = require('./protheus_db');

async function runTests() {
  console.log('🧪 Iniciando Bateria de Testes: Módulo Contas a Pagar (SE2 / SE5)...');
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✅ [PASSOU] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FALHOU] ${name}:`, err.message);
      failed++;
    }
  }

  // 1. Testes de Classificação de Situações
  await test('1. Título em Aberto (saldo igual ao valor original, sem baixa)', () => {
    const sit = classificarSituacaoTitulo(1500.00, 1500.00, '', '', '');
    assert.strictEqual(sit.codigo, 'ABERTO');
    assert.strictEqual(sit.badgeClass, 'badge-warning');
    assert.strictEqual(sit.movFinanceiro, false);
  });

  await test('2. Título Quitado com Movimentação Financeira (saldo 0, data baixa preenchida, banco 077, motivo DEB)', () => {
    const sit = classificarSituacaoTitulo(1500.00, 0, '20260915', 'DEB', '077');
    assert.strictEqual(sit.codigo, 'QUITADO_FIN');
    assert.strictEqual(sit.badgeClass, 'badge-success');
    assert.strictEqual(sit.movFinanceiro, true);
    assert.strictEqual(sit.banco, '077');
    assert.ok(sit.descricaoBaixa.includes('Banco 077'));
  });

  await test('3. Título Quitado com Movimentação Financeira (motivo NOR com banco)', () => {
    const sit = classificarSituacaoTitulo(250.00, 0, '20260910', 'NOR', '077');
    assert.strictEqual(sit.codigo, 'QUITADO_FIN');
    assert.strictEqual(sit.movFinanceiro, true);
  });

  await test('4. Título Quitado por Compensação / Sem Movimento Financeiro (motivo CMP, sem banco)', () => {
    const sit = classificarSituacaoTitulo(3596.00, 0, '20260811', 'CMP', '');
    assert.strictEqual(sit.codigo, 'QUITADO_CMP');
    assert.strictEqual(sit.badgeClass, 'badge-purple');
    assert.strictEqual(sit.movFinanceiro, false);
    assert.ok(sit.descricaoBaixa.includes('Compensação'));
  });

  await test('5. Título Quitado por Devolução (motivo DEV, sem banco)', () => {
    const sit = classificarSituacaoTitulo(400.00, 0, '20260710', 'DEV', '');
    assert.strictEqual(sit.codigo, 'QUITADO_CMP');
    assert.strictEqual(sit.movFinanceiro, false);
    assert.ok(sit.descricaoBaixa.includes('Devolução'));
  });

  await test('6. Título com Baixa Parcial (saldo menor que o valor original e maior que zero)', () => {
    const sit = classificarSituacaoTitulo(1000.00, 400.00, '20260910', 'DEB', '077');
    assert.strictEqual(sit.codigo, 'BAIXA_PARCIAL');
    assert.strictEqual(sit.badgeClass, 'badge-amber');
    assert.strictEqual(sit.movFinanceiro, true);
  });

  // 2. Testes de Sanitização SQL e Proteção contra LIKE Injection
  await test('7. Sanitização contra SQL Injection e Injeção de Padrão LIKE (colchetes)', () => {
    const limpo1 = sanitizeSqlParam("123'; DROP TABLE SE2140; --");
    assert.strictEqual(limpo1.includes(';'), false);
    assert.strictEqual(limpo1.includes('--'), false);

    const limpo2 = sanitizeSqlParam("teste' OR '1'='1");
    assert.strictEqual(limpo2, "teste'' OR ''1''=''1");

    const limpo3 = sanitizeSqlParam("[MP-FATURA] [URGENTE");
    assert.strictEqual(limpo3.includes('['), false);
    assert.strictEqual(limpo3.includes(']'), false);
    assert.strictEqual(limpo3, "MP-FATURA URGENTE");
  });

  // 3. Testes de Consulta Real no Protheus Railway
  await test('8. Consulta paginada multi-empresa com retorno de itens e summary', async () => {
    const res = await consultarContasPagarSe2({
      empresa: '14',
      page: 1,
      pageSize: 5
    });

    assert.strictEqual(res.success, true);
    assert.ok(Array.isArray(res.items));
    assert.ok(res.items.length <= 5);
    assert.ok(res.summary);
    assert.ok(typeof res.summary.totalRegistros === 'number');
    assert.ok(typeof res.summary.totalValor === 'number');
    assert.ok(typeof res.summary.totalSaldo === 'number');
    assert.ok(res.pagination);
    assert.strictEqual(res.pagination.page, 1);
    assert.strictEqual(res.pagination.limit, 5);

    if (res.items.length > 0) {
      const primeiro = res.items[0];
      assert.ok(primeiro.numTitulo);
      assert.ok(primeiro.empresaCod);
      assert.ok(primeiro.situacao);
      assert.ok(primeiro.situacao.codigo);
      assert.ok(primeiro.dataVencBr);
      assert.ok(primeiro.dataBaixaBr);
    }
  });

  await test('9. Filtro por Situação (QUITADO_FIN vs QUITADO_CMP) sem falso positivo', async () => {
    const resFin = await consultarContasPagarSe2({
      empresa: '14',
      situacao: 'QUITADO_FIN',
      page: 1,
      pageSize: 3
    });
    assert.strictEqual(resFin.success, true);
    assert.ok(resFin.items.length > 0, 'Deve retornar ao menos 1 item QUITADO_FIN');
    for (const item of resFin.items) {
      assert.strictEqual(item.situacao.codigo, 'QUITADO_FIN');
      assert.strictEqual(item.situacao.movFinanceiro, true);
    }

    const resCmp = await consultarContasPagarSe2({
      empresa: '14',
      situacao: 'QUITADO_CMP',
      page: 1,
      pageSize: 3
    });
    assert.strictEqual(resCmp.success, true);
    assert.ok(resCmp.items.length > 0, 'Deve retornar ao menos 1 item QUITADO_CMP');
    for (const item of resCmp.items) {
      assert.strictEqual(item.situacao.codigo, 'QUITADO_CMP');
      assert.strictEqual(item.situacao.movFinanceiro, false);
    }
  });

  await test('10. Consulta de movimentações detalhadas SE5 de um título com filial', async () => {
    const res = await consultarContasPagarSe2({
      empresa: '14',
      situacao: 'QUITADO_FIN',
      page: 1,
      pageSize: 1
    });

    assert.ok(res.items.length > 0, 'Deve encontrar pelo menos 1 título para testar movimentações');
    const t = res.items[0];
    const movs = await consultarMovimentacoesTituloSe5(
      t.empresaCod,
      t.filial,
      t.prefixo,
      t.numTitulo,
      t.parcela,
      t.tipo,
      t.codFornecedor
    );
    assert.ok(Array.isArray(movs));
    assert.ok(movs.length > 0, 'Deve encontrar pelo menos 1 movimentação na SE5 para título quitado');
    assert.ok(movs[0].dataBr);
    assert.ok(typeof movs[0].valor === 'number');
  });

  await test('10.1. Resiliência a termos com colchetes abertos (prevenção de crash Msg 9812)', async () => {
    const res = await consultarContasPagarSe2({
      empresa: '14',
      termo: '[TESTE_SEM_FECHAR',
      page: 1,
      pageSize: 5
    });
    assert.strictEqual(res.success, true);
  });

  // 4. Testes Estruturais de Arquivos e DOM
  await test('11. Verificação de Elementos DOM em index.html', () => {
    const fs = require('fs');
    const html = fs.readFileSync('./public/index.html', 'utf8');

    assert.ok(html.includes('id="btnTabContasPagar"'), 'Deve conter botão #btnTabContasPagar');
    assert.ok(html.includes('id="btnTabFinContasPagar"'), 'Deve conter botão #btnTabFinContasPagar em Assist. Financ.');
    assert.ok(html.includes('id="tab-contas-pagar"'), 'Deve conter aba #tab-contas-pagar');
    assert.ok(html.includes('id="searchContasPagarTermo"'), 'Deve conter input de busca rápida #searchContasPagarTermo');
    assert.ok(html.includes('id="filterContasPagarEmpresa"'), 'Deve conter seletor de empresa #filterContasPagarEmpresa');
    assert.ok(html.includes('id="filterContasPagarSituacao"'), 'Deve conter seletor de situação #filterContasPagarSituacao');
    assert.ok(html.includes('id="btnBuscarContasPagar"'), 'Deve conter botão buscar #btnBuscarContasPagar');
    assert.ok(html.includes('id="tbodyContasPagar"'), 'Deve conter tbody da tabela #tbodyContasPagar');
    assert.ok(html.includes('id="modalDetalhesTituloContasPagar"'), 'Deve conter modal de detalhes #modalDetalhesTituloContasPagar');
    assert.ok(html.includes('id="tbodyMovimentacoesSE5"'), 'Deve conter tbody das movimentações SE5 #tbodyMovimentacoesSE5');
    assert.ok(html.includes('src="js/contas_pagar.js'), 'Deve carregar o script js/contas_pagar.js');
  });

  await test('12. Verificação de Integração em app.js', () => {
    const fs = require('fs');
    const appJs = fs.readFileSync('./public/app.js', 'utf8');

    assert.ok(appJs.includes("targetTab === 'tab-contas-pagar'"), 'app.js deve escutar a aba tab-contas-pagar');
    assert.ok(appJs.includes('ContasPagarModule.init'), 'app.js deve inicializar ContasPagarModule.init');
  });

  console.log(`\n🏁 Resultado: ${passed} passaram, ${failed} falharam.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Erro fatal nos testes:', err);
  process.exit(1);
});

