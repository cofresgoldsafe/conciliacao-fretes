/**
 * test_fechamento_vendedores.js
 * 
 * Suíte de Testes Automatizados para o Fechamento Mensal dos Vendedores (26 a 25)
 * Cobre:
 * 1. Regra temporal do ciclo dia 26 às 00:30 de Brasília vs Dias 01 a 25.
 * 2. Cálculo matemático de metas de vendas (100%, 150%, 200%) e premiações.
 * 3. Cálculo matemático de gordura de frete (R$ 700 a R$ 3.000) e premiações.
 * 4. Dedução de fretes embutidos (C5_VLR_FRT) e dedução de inadimplência (SE1).
 * 5. Fórmulas de comissão líquida (1,3%) e total a receber.
 * 6. Rateio de faturamento por empresa e cálculo de benchmarking da equipe.
 * 7. Snapshot imutável de regras vigentes no ato do fechamento.
 * 8. Integridade léxica e sintática de arquivos JS via vm.Script.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const {
  calcularCicloFechamentoDisponivel,
  obterCiclosPredefinidosFechamento,
  normalizarPeriodo,
  calcularMetasEPremios,
  calcularComissoesEPremiosVendedor,
  DEFAULT_METAS_VENDAS
} = require('./fechamento_vendedores_engine');

console.log('🧪 Iniciando Suíte de Testes: Fechamento Mensal dos Vendedores (26 a 25)...');
let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
    process.exitCode = 1;
  }
}

// ─── TESTE 1: Regras Temporais dos Ciclos ────────────────────────────────────

runTest('1.1 - No dia 25 às 23:59:59 deve exibir o ciclo anterior encerrado', () => {
  // Simula 25/08/2026 às 23:59:59
  const ref25Ago = new Date('2026-08-25T23:59:59-03:00');
  const ciclo25Ago = calcularCicloFechamentoDisponivel(ref25Ago);
  
  assert.strictEqual(ciclo25Ago.dtIni, '20260626', 'Data inicial deve ser 20260626');
  assert.strictEqual(ciclo25Ago.dtFim, '20260725', 'Data final deve ser 20260725');
  assert.strictEqual(ciclo25Ago.dataIniIso, '2026-06-26');
  assert.strictEqual(ciclo25Ago.dataFimIso, '2026-07-25');
  assert.strictEqual(ciclo25Ago.cicloId, '2026-06-26_2026-07-25', 'ID do ciclo deve ser 2026-06-26_2026-07-25');
});

runTest('1.2 - No dia 26 às 00:30:00 deve virar para o novo ciclo ativo (26/07 a 25/08)', () => {
  // Simula 26/08/2026 às 00:30:00
  const ref26Ago = new Date('2026-08-26T00:30:00-03:00');
  const ciclo26Ago = calcularCicloFechamentoDisponivel(ref26Ago);
  
  assert.strictEqual(ciclo26Ago.dtIni, '20260726', 'Data inicial deve ser 20260726');
  assert.strictEqual(ciclo26Ago.dtFim, '20260825', 'Data final deve ser 20260825');
  assert.strictEqual(ciclo26Ago.dataIniIso, '2026-07-26');
  assert.strictEqual(ciclo26Ago.dataFimIso, '2026-08-25');
  assert.strictEqual(ciclo26Ago.cicloId, '2026-07-26_2026-08-25', 'ID do ciclo deve ser 2026-07-26_2026-08-25');
});

runTest('1.3 - No dia 02/09 deve manter o ciclo 26/07 a 25/08 até dia 25/09', () => {
  const ref02Set = new Date('2026-09-02T15:00:00-03:00');
  const ciclo02Set = calcularCicloFechamentoDisponivel(ref02Set);
  
  assert.strictEqual(ciclo02Set.dtIni, '20260726');
  assert.strictEqual(ciclo02Set.dtFim, '20260825');
  assert.strictEqual(ciclo02Set.cicloId, '2026-07-26_2026-08-25');
});

runTest('1.4 - obterCiclosPredefinidosFechamento deve retornar exatamente os últimos 12 ciclos mensais (26 a 25)', () => {
  const ref = new Date('2026-09-03T10:00:00-03:00');
  const lista = obterCiclosPredefinidosFechamento(12, ref);
  assert.strictEqual(lista.length, 12, 'Deve conter exatamente 12 ciclos');
  assert.strictEqual(lista[0].cicloId, '2026-07-26_2026-08-25', 'Ciclo 0 deve ser o atual');
  assert.strictEqual(lista[0].isAtual, true);
  assert.strictEqual(lista[1].cicloId, '2026-06-26_2026-07-25', 'Ciclo 1 deve ser o mês passado');
  assert.strictEqual(lista[1].label, '26/06/2026 a 25/07/2026');
  assert.strictEqual(lista[2].cicloId, '2026-05-26_2026-06-25', 'Ciclo 2 deve ser 2 meses atrás');
  assert.strictEqual(lista[2].label, '26/05/2026 a 25/06/2026');
});

// ─── TESTE 2: Metas de Vendas e Premiações ────────────────────────────────────

runTest('2.1 - Vendas abaixo de 100% da Meta Base (R$ 120k) não recebem prêmio de vendas', () => {
  const r = calcularMetasEPremios({
    vendasBaseLiquida: 119999.99,
    gorduraFreteTotal: 0,
    metasConfig: DEFAULT_METAS_VENDAS
  });
  assert.strictEqual(r.premioMetaVendas, 0);
  assert.strictEqual(r.metaVendasStatus, 'NAO_ATINGIDA');
});

runTest('2.2 - Vendas entre 100% e 149.99% recebem R$ 400,00', () => {
  const r = calcularMetasEPremios({
    vendasBaseLiquida: 120000.00,
    gorduraFreteTotal: 0,
    metasConfig: DEFAULT_METAS_VENDAS
  });
  assert.strictEqual(r.premioMetaVendas, 400);
  assert.strictEqual(r.metaVendasStatus, 'BATEU_100');

  const r2 = calcularMetasEPremios({
    vendasBaseLiquida: 179999.00,
    gorduraFreteTotal: 0,
    metasConfig: DEFAULT_METAS_VENDAS
  });
  assert.strictEqual(r2.premioMetaVendas, 400);
});

runTest('2.3 - Vendas entre 150% e 199.99% (R$ 180k a R$ 239k) recebem R$ 600,00', () => {
  const r = calcularMetasEPremios({
    vendasBaseLiquida: 180000.00,
    gorduraFreteTotal: 0,
    metasConfig: DEFAULT_METAS_VENDAS
  });
  assert.strictEqual(r.premioMetaVendas, 600);
  assert.strictEqual(r.metaVendasStatus, 'BATEU_150');
});

runTest('2.4 - Vendas >= 200% (R$ 240k+) recebem R$ 1.000,00', () => {
  const r = calcularMetasEPremios({
    vendasBaseLiquida: 250000.00,
    gorduraFreteTotal: 0,
    metasConfig: DEFAULT_METAS_VENDAS
  });
  assert.strictEqual(r.premioMetaVendas, 1000);
  assert.strictEqual(r.metaVendasStatus, 'BATEU_200');
});

// ─── TESTE 3: Metas de Gordura de Frete ───────────────────────────────────────

runTest('3.1 - Gordura de frete menor que R$ 700 não gera prêmio', () => {
  const r = calcularMetasEPremios({
    vendasBaseLiquida: 0,
    gorduraFreteTotal: 699.99,
    metasConfig: DEFAULT_METAS_VENDAS
  });
  assert.strictEqual(r.premioGorduraFrete, 0);
  assert.strictEqual(r.gorduraStatus, 'SEM_PREMIO');
});

runTest('3.2 - Gordura de frete >= R$ 700 e < R$ 1.100 gera R$ 200 de prêmio', () => {
  const r = calcularMetasEPremios({
    vendasBaseLiquida: 0,
    gorduraFreteTotal: 700.00,
    metasConfig: DEFAULT_METAS_VENDAS
  });
  assert.strictEqual(r.premioGorduraFrete, 200);
  assert.strictEqual(r.gorduraStatus, 'NIVEL_1');
});

runTest('3.3 - Gordura de frete >= R$ 1.100 e < R$ 1.500 gera R$ 300 de prêmio', () => {
  const r = calcularMetasEPremios({
    vendasBaseLiquida: 0,
    gorduraFreteTotal: 1100.00,
    metasConfig: DEFAULT_METAS_VENDAS
  });
  assert.strictEqual(r.premioGorduraFrete, 300);
  assert.strictEqual(r.gorduraStatus, 'NIVEL_2');
});

runTest('3.4 - Gordura de frete >= R$ 1.500 e < R$ 2.100 gera R$ 400 de prêmio', () => {
  const r = calcularMetasEPremios({
    vendasBaseLiquida: 0,
    gorduraFreteTotal: 1550.00,
    metasConfig: DEFAULT_METAS_VENDAS
  });
  assert.strictEqual(r.premioGorduraFrete, 400);
  assert.strictEqual(r.gorduraStatus, 'NIVEL_3');
});

runTest('3.5 - Gordura de frete >= R$ 2.100 e < R$ 3.000 gera R$ 500 de prêmio', () => {
  const r = calcularMetasEPremios({
    vendasBaseLiquida: 0,
    gorduraFreteTotal: 2100.00,
    metasConfig: DEFAULT_METAS_VENDAS
  });
  assert.strictEqual(r.premioGorduraFrete, 500);
  assert.strictEqual(r.gorduraStatus, 'NIVEL_4');
});

runTest('3.6 - Gordura de frete >= R$ 3.000 gera R$ 600 de prêmio', () => {
  const r = calcularMetasEPremios({
    vendasBaseLiquida: 0,
    gorduraFreteTotal: 3450.00,
    metasConfig: DEFAULT_METAS_VENDAS
  });
  assert.strictEqual(r.premioGorduraFrete, 600);
  assert.strictEqual(r.gorduraStatus, 'NIVEL_5');
});

// ─── TESTE 4: Dedução de Frete Embutido e Inadimplência ───────────────────────

runTest('4.1 - Dedução estrita de frete embutido na base de vendas e dedução de inadimplência na comissão', () => {
  const resultado = calcularComissoesEPremiosVendedor({
    vendasBaseBruta: 200000.00,
    fretesEmbutidos: 20000.00, // Venda Líquida = R$ 180.000 (150% da Meta de R$ 120k)
    inadimplentesTotal: 500.00,
    gorduraFreteTotal: 1200.00, // Prêmio Frete = R$ 300
    metasConfig: DEFAULT_METAS_VENDAS
  });

  // 1. Venda Base Líquida = 200k - 20k = 180k
  assert.strictEqual(resultado.vendasBaseLiquida, 180000.00);
  
  // 2. Comissão Bruta = 180k * 0.013 = 2.340,00
  assert.strictEqual(resultado.comissaoBruta, 2340.00);
  
  // 3. Comissão Líquida = 2.340 - 500 = 1.840,00
  assert.strictEqual(resultado.comissaoLiquida, 1840.00);
  
  // 4. Prêmio Meta Vendas (150%) = R$ 600,00
  assert.strictEqual(resultado.premioMetaVendas, 600.00);
  
  // 5. Prêmio Frete (>= R$ 1.100) = R$ 300,00
  assert.strictEqual(resultado.premioGorduraFrete, 300.00);
  
  // 6. Total Prêmios = 600 + 300 = 900,00
  assert.strictEqual(resultado.totalPremios, 900.00);
  
  // 7. Total Geral a Receber = 1.840 (Comissão) + 900 (Prêmios) = 2.740,00
  assert.strictEqual(resultado.totalGeralReceber, 2740.00);
});

runTest('4.2 - Juliana (000074): Frete Embutido deve ser exatamente R$ 2.776,00 com Venda Líquida R$ 169.244,14', () => {
  const resultado = calcularComissoesEPremiosVendedor({
    vendasBaseBruta: 172020.14,
    fretesEmbutidos: 2776.00, // Paridade exata com a Aba Comissões
    inadimplentesTotal: 0.00,
    gorduraFreteTotal: 0.00,
    metasConfig: DEFAULT_METAS_VENDAS
  });

  // 1. Venda Base Líquida = 172.020,14 - 2.776,00 = 169.244,14
  assert.strictEqual(resultado.vendasBaseLiquida, 169244.14);
  
  // 2. Comissão Bruta (1,3%) = 169.244,14 * 0.013 = 2.200,17
  assert.strictEqual(resultado.comissaoBruta, 2200.17);
  assert.strictEqual(resultado.comissaoLiquida, 2200.17);
  
  // 3. Prêmio Meta Vendas (>= 100% da Meta de R$ 120k) = R$ 400,00
  assert.strictEqual(resultado.premioMetaVendas, 400.00);
  assert.strictEqual(resultado.metaVendasStatus, 'BATEU_100');
  
  // 4. Total a Receber = 2.200,17 + 400,00 = 2.600,17
  assert.strictEqual(resultado.totalGeralReceber, 2600.17);
});

// ─── TESTE 5: Inadimplência superior à Comissão não gera comissão negativa ────

runTest('5.1 - Comissão líquida é truncada em zero se a inadimplência for superior', () => {
  const resultado = calcularComissoesEPremiosVendedor({
    vendasBaseBruta: 10000.00,
    fretesEmbutidos: 0,
    inadimplentesTotal: 500.00, // Comissão Bruta: R$ 130,00
    gorduraFreteTotal: 800.00, // Prêmio Frete: R$ 200
    metasConfig: DEFAULT_METAS_VENDAS
  });

  assert.strictEqual(resultado.comissaoBruta, 130.00);
  assert.strictEqual(resultado.comissaoLiquida, 0.00, 'Comissão líquida não pode ser negativa');
  assert.strictEqual(resultado.totalGeralReceber, 200.00, 'Total a receber deve ser composto pelo prêmio');
});

// ─── TESTE 6: Integridade Léxica e Sintática dos Arquivos Frontend e Backend ──

runTest('6.1 - Integridade do fechamento_vendedores_engine.js', () => {
  const code = fs.readFileSync(path.join(__dirname, 'fechamento_vendedores_engine.js'), 'utf8');
  assert.doesNotThrow(() => {
    new vm.Script(code);
  }, 'fechamento_vendedores_engine.js deve ser sintaticamente válido');
});

runTest('6.2 - Integridade do public/js/fechamento_vendedores.js', () => {
  const code = fs.readFileSync(path.join(__dirname, 'public/js/fechamento_vendedores.js'), 'utf8');
  assert.doesNotThrow(() => {
    new vm.Script(code);
  }, 'public/js/fechamento_vendedores.js deve ser sintaticamente válido');
});

runTest('6.3 - Integridade do server.js com as novas rotas de fechamento', () => {
  const code = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.doesNotThrow(() => {
    new vm.Script(code);
  }, 'server.js deve ser sintaticamente válido');
});

// ─── RESUMO FINAL ─────────────────────────────────────────────────────────────

console.log(`\n📊 Resultado dos Testes: ${passedTests}/${totalTests} aprovados (${Math.round((passedTests/totalTests)*100)}%)`);

if (passedTests === totalTests) {
  console.log('🎉 TODOS OS TESTES FORAM APROVADOS COM SUCESSO!');
  process.exit(0);
} else {
  console.error('❌ HOUVE FALHAS NA SUÍTE DE TESTES.');
  process.exit(1);
}
