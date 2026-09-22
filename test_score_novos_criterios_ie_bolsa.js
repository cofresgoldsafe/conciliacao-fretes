/**
 * test_score_novos_criterios_ie_bolsa.js
 * 
 * Suíte de Testes para validação do cálculo e calibração dinâmica
 * dos novos pesos de Bolsa Família (Antifraude Sócio Laranja) e Inscrição Estadual (IE).
 */

const assert = require('assert');
const {
  calcularScore,
  DEFAULT_CONFIG,
  getScoreConfig,
  saveScoreConfig,
  resetScoreConfig
} = require('./analise_credito_engine');

let passedTests = 0;
let failedTests = 0;

function report(name, success, error) {
  if (success) {
    console.log(`  ✓ [PASS] ${name}`);
    passedTests++;
  } else {
    console.error(`  ❌ [FAIL] ${name}: ${error}`);
    failedTests++;
  }
}

function runTests() {
  console.log('\n=============================================================');
  console.log('🧪 SUÍTE DE TESTES: PESOS DE BOLSA FAMÍLIA & INSCRIÇÃO ESTADUAL');
  console.log('=============================================================\n');

  // Garante configuração padrão limpa no início
  resetScoreConfig();

  // Teste 1: Chaves em DEFAULT_CONFIG
  console.log('--- 1. Existência e valores padrão em DEFAULT_CONFIG ---');
  try {
    assert.strictEqual(DEFAULT_CONFIG.peso_socio_bolsa_familia_sim, -25.0);
    assert.strictEqual(DEFAULT_CONFIG.peso_socio_bolsa_familia_nao, 0.0);
    assert.strictEqual(DEFAULT_CONFIG.peso_socio_bolsa_familia_isento, 0.0);
    assert.strictEqual(DEFAULT_CONFIG.peso_ie_ativa, 2.0);
    assert.strictEqual(DEFAULT_CONFIG.peso_ie_inapta, -15.0);
    assert.strictEqual(DEFAULT_CONFIG.peso_ie_isento, 0.0);
    assert.strictEqual(DEFAULT_CONFIG.peso_ie_nao_informada, 0.0);
    report('DEFAULT_CONFIG possui os 7 novos pesos corretos', true);
  } catch (err) {
    report('DEFAULT_CONFIG possui os 7 novos pesos corretos', false, err.message);
  }

  // Base de dados limpa para testes
  const baseDados = {
    pedido_venda: '123',
    cliente_nome: 'CLIENTE TESTE',
    total_pedido: 10000,
    faturado: 'S',
    entrada: 'S',
    cnpj_ativo: 'S',
    cadastro_igual_receita: 'S',
    entrega_igual_cadastro: 'S',
    score_serasa: 750,
    capital_social: 100000,
    protestos: 'N',
    pfin: 'N',
    refin: 'N',
    dividas_vencidas: 'N',
    ch_sem_fundo: 'N',
    alteracao_recente_socios: 'N',
    aumento_expressivo_capital: 'N'
  };

  // Teste 2: Sócio Regular (N) vs Sócio Laranja (S) vs Empresa Pública (ISENTO)
  console.log('\n--- 2. Cálculo do critério Bolsa Família (Antifraude Laranja) ---');
  try {
    const resRegular = calcularScore({ ...baseDados, socio_bolsa_familia: 'N' });
    const resLaranja = calcularScore({ ...baseDados, socio_bolsa_familia: 'S' });
    const resIsento = calcularScore({ ...baseDados, socio_bolsa_familia: 'ISENTO' });

    assert.strictEqual(resRegular.detalhesPontos.socio_bolsa_familia, 0.0, 'Regular deve pontuar 0');
    assert.strictEqual(resIsento.detalhesPontos.socio_bolsa_familia, 0.0, 'Isento deve pontuar 0');
    assert.strictEqual(resLaranja.detalhesPontos.socio_bolsa_familia, -25.0, 'Laranja deve penalizar -25');

    assert.strictEqual(resRegular.totalScore - resLaranja.totalScore, 25.0, 'Diferença deve ser de exatos 25 pontos');
    assert.ok(resLaranja.sugestoesLista.some(s => s.includes('SÓCIO BENEFICIÁRIO DO BOLSA FAMÍLIA')), 'Deve conter alerta de sócio laranja');

    report('Cálculo e Alerta de Sócio Bolsa Família (-25 pts)', true);
  } catch (err) {
    report('Cálculo e Alerta de Sócio Bolsa Família (-25 pts)', false, err.message);
  }

  // Teste 3: Inscrição Estadual (Ativa vs Inapta vs Isenta)
  console.log('\n--- 3. Cálculo do critério Inscrição Estadual (IE) ---');
  try {
    const resAtiva = calcularScore({ ...baseDados, inscricao_estadual: 'ATIVA' });
    const resInapta = calcularScore({ ...baseDados, inscricao_estadual: 'INAPTA' });
    const resIsenta = calcularScore({ ...baseDados, inscricao_estadual: 'ISENTO' });
    const resNaoInf = calcularScore({ ...baseDados, inscricao_estadual: 'NAO_INFORMADA' });

    assert.strictEqual(resAtiva.detalhesPontos.inscricao_estadual, 2.0, 'Ativa deve bonificar +2');
    assert.strictEqual(resInapta.detalhesPontos.inscricao_estadual, -15.0, 'Inapta deve penalizar -15');
    assert.strictEqual(resIsenta.detalhesPontos.inscricao_estadual, 0.0, 'Isenta deve pontuar 0');
    assert.strictEqual(resNaoInf.detalhesPontos.inscricao_estadual, 0.0, 'Não informada deve pontuar 0');

    assert.ok(resInapta.sugestoesLista.some(s => s.includes('INSCRIÇÃO ESTADUAL INAPTA')), 'Deve conter alerta de IE inapta');

    report('Cálculo de Inscrição Estadual (+2, -15, 0 neutro)', true);
  } catch (err) {
    report('Cálculo de Inscrição Estadual (+2, -15, 0 neutro)', false, err.message);
  }

  // Teste 4: Calibração Dinâmica e Persistência de Pesos (Sem Hardcoding)
  console.log('\n--- 4. Calibração Dinâmica via saveScoreConfig (Sem Hardcoding) ---');
  try {
    const salvo = saveScoreConfig({
      peso_socio_bolsa_familia_sim: -35.0,
      peso_ie_inapta: -20.0
    });
    assert.strictEqual(salvo, true, 'Configuração deve ser salva');

    const configAtual = getScoreConfig();
    assert.strictEqual(configAtual.peso_socio_bolsa_familia_sim, -35.0);
    assert.strictEqual(configAtual.peso_ie_inapta, -20.0);

    const resRecalculo = calcularScore({
      ...baseDados,
      socio_bolsa_familia: 'S',
      inscricao_estadual: 'INAPTA'
    }, configAtual);

    assert.strictEqual(resRecalculo.detalhesPontos.socio_bolsa_familia, -35.0, 'Deve usar peso customizado -35');
    assert.strictEqual(resRecalculo.detalhesPontos.inscricao_estadual, -20.0, 'Deve usar peso customizado -20');

    // Restaura padrões
    resetScoreConfig();
    const configReset = getScoreConfig();
    assert.strictEqual(configReset.peso_socio_bolsa_familia_sim, -25.0);
    assert.strictEqual(configReset.peso_ie_inapta, -15.0);

    report('Calibração e Restauração de Pesos Dinâmicos', true);
  } catch (err) {
    report('Calibração e Restauração de Pesos Dinâmicos', false, err.message);
  }

  console.log('\n=============================================================');
  console.log(`📊 RESUMO DA EXECUÇÃO: ${passedTests} Aprovados, ${failedTests} Falhas`);
  console.log('=============================================================\n');

  if (failedTests > 0) process.exit(1);
}

runTests();
