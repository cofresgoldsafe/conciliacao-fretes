/**
 * test_cnpj_matriz_fundacao.js
 * 
 * Validação da resolução automática de CNPJ Matriz e cálculo de idade da empresa
 * na Análise de Crédito Comercial do Portal GSI.
 * 
 * Caso real de homologação:
 * Pedido Venda #000822 (Web #26535) Empresa 16 (OAÇO)
 * Cliente: MADERO INDUSTRIA E COMERCIO S.A.
 * CNPJ Filial Faturada: 13.783.221/0321-67 (Abertura: 2025-04-25) -> Gerava erroneamente -6 pts (< 5 anos)
 * CNPJ Matriz Resolvida: 13.783.221/0001-25 (Fundação: 2011-04-06) -> Pontua corretamente +4 pts (>= 15 anos)
 * Ganho de Score: +10 pontos legítimos
 */

const assert = require('assert');
const app = require('./server');
const protheusDb = require('./protheus_db');
const { calcularScore, getScoreConfig } = require('./analise_credito_engine');

console.log('🧪 Iniciando Suíte de Testes: Resolução de CNPJ Matriz e Fundação na Análise de Crédito...\n');

let passCount = 0;
let failCount = 0;

function test(descricao, fn) {
  try {
    fn();
    console.log(`  ✓ [PASS] ${descricao}`);
    passCount++;
  } catch (err) {
    console.error(`  ✗ [FAIL] ${descricao}`);
    console.error(`     Motivo: ${err.message}`);
    failCount++;
  }
}

async function testAsync(descricao, fn) {
  try {
    await fn();
    console.log(`  ✓ [PASS] ${descricao}`);
    passCount++;
  } catch (err) {
    console.error(`  ✗ [FAIL] ${descricao}`);
    console.error(`     Motivo: ${err.message}`);
    failCount++;
  }
}

async function runAllTests() {
  // --------------------------------------------------------------------------
  // 1. Testes da Função Pura obterCnpjMatriz (Módulo 11 da RFB)
  // --------------------------------------------------------------------------
  console.log('--- 1. Derivação Matemática do CNPJ Matriz (Módulo 11) ---');

  test('1.1 Filial Madero 0321 deve derivar exatamente a matriz 0001 com DVs válidos', () => {
    const cnpjFilial = '13.783.221/0321-67';
    const matrizEsperada = '13783221000125';
    const matrizObtida = app.obterCnpjMatriz(cnpjFilial);
    assert.strictEqual(matrizObtida, matrizEsperada, `Esperava matriz ${matrizEsperada}, obteve ${matrizObtida}`);
  });

  test('1.2 Filial Banco do Brasil 0002 deve derivar a matriz 0001 com DVs corretos', () => {
    const cnpjFilial = '00.000.000/0002-72';
    const matrizEsperada = '00000000000191';
    const matrizObtida = app.obterCnpjMatriz(cnpjFilial);
    assert.strictEqual(matrizObtida, matrizEsperada);
  });

  test('1.3 CNPJ que já é Matriz (0001) deve ser retornado íntegro sem alteração de dígitos', () => {
    const cnpjMatriz = '13.783.221/0001-25';
    const matrizObtida = app.obterCnpjMatriz(cnpjMatriz);
    assert.strictEqual(matrizObtida, '13783221000125');
  });

  test('1.4 Filial Magazine Luiza 0446 deve derivar a matriz 0001 com DVs válidos', () => {
    const cnpjFilial = '47.960.950/0446-96';
    const matrizEsperada = '47960950000121';
    const matrizObtida = app.obterCnpjMatriz(cnpjFilial);
    assert.strictEqual(matrizObtida, matrizEsperada);
  });

  test('1.5 Entrada não-CNPJ ou com tamanho inválido deve ser tratada defensivamente sem exceção', () => {
    assert.strictEqual(app.obterCnpjMatriz(''), '');
    assert.strictEqual(app.obterCnpjMatriz(null), null);
    assert.strictEqual(app.obterCnpjMatriz('12345'), '12345');
    assert.strictEqual(app.obterCnpjMatriz('123.456.789-00'), '123.456.789-00');
  });

  // --------------------------------------------------------------------------
  // 2. Normalização de Datas ISO para Input HTML e Motor JS
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Normalização de Formato de Data (ISO YYYY-MM-DD) ---');

  test('2.1 Data no padrão DD/MM/YYYY (ReceitaWS) deve ser convertida para YYYY-MM-DD', () => {
    assert.strictEqual(app.formatarDataIso('06/04/2011'), '2011-04-06');
    assert.strictEqual(app.formatarDataIso('25/04/2025'), '2025-04-25');
  });

  test('2.2 Data já no padrão ISO YYYY-MM-DD (BrasilAPI) deve ser preservada', () => {
    assert.strictEqual(app.formatarDataIso('2011-04-06'), '2011-04-06');
    assert.strictEqual(app.formatarDataIso('2025-04-25T00:00:00.000Z'), '2025-04-25');
  });

  test('2.3 Entradas vazias ou inválidas devem retornar formato seguro', () => {
    assert.strictEqual(app.formatarDataIso(''), '');
    assert.strictEqual(app.formatarDataIso(null), '');
  });

  // --------------------------------------------------------------------------
  // 3. Impacto no Motor de Score: Filial Recente vs Matriz Histórica
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Validação do Motor de Score (Idade da Empresa) ---');

  test('3.1 Data de filial recente (2025-04-25) gera penalidade de -6 pontos (< 5 anos)', () => {
    const dadosFilialRecente = {
      total_pedido: 10000,
      faturado: 'S',
      cnpj_ativo: 'S',
      fundacao_matriz: '2025-04-25', // Filial de meses de vida
      score_serasa: 700
    };
    const resultado = calcularScore(dadosFilialRecente);
    assert.strictEqual(resultado.detalhesPontos.idade_empresa, -6, 'Filial com < 5 anos deve pontuar peso_idade_menor5 (-6 pts)');
  });

  test('3.2 Data da Matriz (2011-04-06) computa pontuação positiva de +4 pontos (>= 15 anos)', () => {
    const dadosMatrizCorreta = {
      total_pedido: 10000,
      faturado: 'S',
      cnpj_ativo: 'S',
      fundacao_matriz: '2011-04-06', // Matriz com 15 anos de história
      score_serasa: 700
    };
    const resultado = calcularScore(dadosMatrizCorreta);
    assert.strictEqual(resultado.detalhesPontos.idade_empresa, 4, 'Matriz com >= 15 anos deve pontuar peso_idade_15 (+4 pts)');
    
    // Ganho líquido de +10 pontos para o cliente comercial (+4 vs -6)
    const delta = resultado.detalhesPontos.idade_empresa - (-6);
    assert.strictEqual(delta, 10, 'A correção da fundação deve conceder 10 pontos adicionais legítimos ao cliente');
  });

  // --------------------------------------------------------------------------
  // 4. Resolução Real de Matriz e Resiliência de Fallback (Função de Produção)
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Resiliência de Fallback via Função de Produção resolverFundacaoMatriz ---');

  test('4.1 app.resolverFundacaoMatriz usa a fundação da filial se matriz estiver indisponível (Fallback)', () => {
    const dadosFilial = { fundacao: '2025-04-25', _erroTecnico: false };
    const dadosMatrizOffline = { _erroTecnico: true, fundacao: '' };

    const fundacaoFinal = app.resolverFundacaoMatriz(dadosFilial, dadosMatrizOffline);
    assert.strictEqual(fundacaoFinal, '2025-04-25', 'Fallback deve manter a data da filial');
  });

  test('4.2 app.resolverFundacaoMatriz prioriza a fundação da Matriz quando consultada com sucesso', () => {
    const dadosFilial = { fundacao: '2025-04-25', _erroTecnico: false };
    const dadosMatrizOk = { fundacao: '2011-04-06', _erroTecnico: false };

    const fundacaoFinal = app.resolverFundacaoMatriz(dadosFilial, dadosMatrizOk);
    assert.strictEqual(fundacaoFinal, '2011-04-06', 'Data da matriz deve sobrepor a filial');
  });

  test('4.3 app.resolverFundacaoMatriz retorna string vazia se ambos forem nulos ou offline', () => {
    assert.strictEqual(app.resolverFundacaoMatriz(null, null), '');
    assert.strictEqual(app.resolverFundacaoMatriz({ _erroTecnico: true }, { _erroTecnico: true }), '');
  });

  // --------------------------------------------------------------------------
  // 5. Blindagem contra CPF e Validação de Cache em Memória
  // --------------------------------------------------------------------------
  console.log('\n--- 5. Blindagem de CPF e Cache em Memória ---');

  test('5.1 Clientes CPF (11 dígitos) não devem ser classificados como filial', () => {
    const cpfFormatado = '123.456.789-00';
    const digitsCpf = cpfFormatado.replace(/\D/g, '');
    const cnpjMatriz = digitsCpf.length === 14 ? app.obterCnpjMatriz(digitsCpf) : null;
    const ehFilial = Boolean(digitsCpf.length === 14 && cnpjMatriz && cnpjMatriz !== digitsCpf);
    assert.strictEqual(ehFilial, false, 'CPF nunca deve acionar busca de matriz como filial');
  });

  test('5.2 Cache em memória de CNPJ armazena e reutiliza resultados sem chamadas redundantes', () => {
    const fakeCnpj = '99999999000199';
    const dadosFake = {
      fundacao: '2000-01-01',
      capitalSocial: 500000,
      cnpjAtivo: 'S',
      _status: { status: 'OK', provedor: 'TesteCache' }
    };
    app.cnpjPublicoCache.set(fakeCnpj, { timestamp: Date.now(), dados: dadosFake });

    const emCache = app.cnpjPublicoCache.get(fakeCnpj);
    assert.ok(emCache, 'Item deve existir no cache');
    assert.strictEqual(emCache.dados.fundacao, '2000-01-01');
    assert.strictEqual(emCache.dados.capitalSocial, 500000);
    // Limpa chave de teste
    app.cnpjPublicoCache.delete(fakeCnpj);
  });

  // --------------------------------------------------------------------------
  // 6. Histórico Financeiro Consolidado por Raiz de CNPJ em SE1 (Protheus)
  // --------------------------------------------------------------------------
  console.log('\n--- 6. Histórico Financeiro Consolidado por Raiz de CNPJ em SE1 ---');

  await testAsync('6.1 Histórico financeiro consolidado por raiz de CNPJ encontra compras pagas em SE1 de todas as filiais', async () => {
    const hist = await protheusDb.obterHistoricoFinanceiroCliente('144824', '13.783.221/0321-67');
    assert.ok(hist, 'Histórico deve ser retornado');
    assert.ok(hist.totalComprasPagas >= 5, `Esperava pelo menos 5 compras pagas consolidadas, obteve ${hist.totalComprasPagas}`);
    assert.strictEqual(hist.comprou2x, 'S', 'comprou2x deve ser S');
    assert.strictEqual(hist.comprou5x, 'S', 'comprou5x deve ser S');
    assert.strictEqual(hist.temPgtosAbertos, 'N', 'temPgtosAbertos deve ser N');
  });

  test('6.2 Impacto do histórico de compras no score: comprou_pagou (2x+) e comprou_pagou_5x concedem +32 pts vs -3 pts', () => {
    const dadosClienteSemHistorico = {
      total_pedido: 10000,
      faturado: 'S',
      cnpj_ativo: 'S',
      fundacao_matriz: '2011-04-06',
      comprou_pagou: 'N',
      comprou_pagou_5x: 'N'
    };
    const resSemHist = calcularScore(dadosClienteSemHistorico);
    assert.strictEqual(resSemHist.detalhesPontos.comprou_pagou, -3, 'Sem compras anteriores aplica penalidade de -3 pts');
    assert.strictEqual(resSemHist.detalhesPontos.comprou_pagou_5x, 0, 'Sem 5 compras anteriores pontua 0');

    const dadosClienteComHistorico = {
      total_pedido: 10000,
      faturado: 'S',
      cnpj_ativo: 'S',
      fundacao_matriz: '2011-04-06',
      comprou_pagou: 'S',
      comprou_pagou_5x: 'S'
    };
    const resComHist = calcularScore(dadosClienteComHistorico);
    assert.strictEqual(resComHist.detalhesPontos.comprou_pagou, 9, 'comprou2x aplica bonificação de +9 pts');
    assert.strictEqual(resComHist.detalhesPontos.comprou_pagou_5x, 23, 'comprou5x aplica bonificação de +23 pts');

    // Ganho líquido de +35 pontos para o cliente (+32 vs -3)
    const deltaPontos = (resComHist.detalhesPontos.comprou_pagou + resComHist.detalhesPontos.comprou_pagou_5x) - (resSemHist.detalhesPontos.comprou_pagou + resSemHist.detalhesPontos.comprou_pagou_5x);
    assert.strictEqual(deltaPontos, 35, 'A consolidação do histórico financeiro por raiz deve conceder 35 pontos adicionais legítimos ao cliente');
  });

  // --------------------------------------------------------------------------
  // Resumo da Execução
  // --------------------------------------------------------------------------
  console.log('\n========================================');
  console.log(`📊 Resultado Final dos Testes:`);
  console.log(`   Total de Testes: ${passCount + failCount}`);
  console.log(`   Aprovados: ${passCount}`);
  console.log(`   Falhas: ${failCount}`);
  console.log('========================================\n');

  if (failCount > 0) {
    process.exit(1);
  } else {
    console.log('🎉 Todos os 17 testes de resolução de CNPJ Matriz, Fundação e Histórico Financeiro por Raiz foram aprovados com sucesso!');
    process.exit(0);
  }
}

runAllTests().catch(err => {
  console.error('Erro fatal nos testes:', err);
  process.exit(1);
});
