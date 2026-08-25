/**
 * Testes Automatizados: Calibração de Pesos & Motor de Score de Crédito
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  getScoreConfig,
  saveScoreConfig,
  resetScoreConfig,
  DEFAULT_CONFIG,
  calcularScore
} = require('./analise_credito_engine');

console.log('====================================================');
console.log('🧪 INICIANDO TESTES: MOTOR DE SCORE & CALIBRAÇÃO');
console.log('====================================================\n');

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
  }
}

// 1. Validar DEFAULT_CONFIG completo
runTest('DEFAULT_CONFIG contém todos os parâmetros de limites, cadastrais e maturidade digital', () => {
  assert.strictEqual(typeof DEFAULT_CONFIG.limite_pedido_alto, 'number');
  assert.strictEqual(typeof DEFAULT_CONFIG.peso_pedido_alto, 'number');
  assert.strictEqual(typeof DEFAULT_CONFIG.peso_email_corp_sim, 'number');
  assert.strictEqual(typeof DEFAULT_CONFIG.peso_email_fin_diferente_nao, 'number');
  assert.strictEqual(typeof DEFAULT_CONFIG.peso_dominio_idade_10, 'number');
  assert.strictEqual(typeof DEFAULT_CONFIG.peso_dominio_idade_3, 'number');
  assert.strictEqual(typeof DEFAULT_CONFIG.peso_dominio_idade_recente, 'number');
  assert.strictEqual(typeof DEFAULT_CONFIG.peso_wayback_5, 'number');
  assert.strictEqual(typeof DEFAULT_CONFIG.peso_mx_premium, 'number');
  assert.strictEqual(typeof DEFAULT_CONFIG.peso_mx_inexistente, 'number');
  assert.strictEqual(typeof DEFAULT_CONFIG.peso_serasa_700, 'number');
  assert.strictEqual(typeof DEFAULT_CONFIG.peso_protesto_maior_capital, 'number');
});

// 2. Testar Cálculo de Score com pesos de E-mails / RDAP / Wayback / MX Padrão
runTest('calcularScore aplica corretamente pontuações de maturidade digital padrão', () => {
  const dados = {
    total_pedido: 10000,
    faturado: 'S',
    entrada: 'S',
    idade_dominio_rdap: 12, // >= 10 anos -> +6
    wayback_primeiro_snapshot: '2015', // >= 5 anos -> +3
    tipo_servidor_mx: 'PREMIUM', // Google/M365 -> +3
    email_corporativo: 'S', // +3
    existe_mail_financeiro: 'S', // 0
    mail_gratuito: 'N', // +2
    possui_site: 'S', // +1
    comprou_pagou: 'S', // +9
    comprou_pagou_5x: 'N',
    cadastro_igual_receita: 'S', // +3
    cnpj_ativo: 'S', // +2
    entrega_igual_cadastro: 'S', // +2
    protestos: 'N', // +5
    score_serasa: '850', // +8
    capital_social: 2000000, // +6
    tres_nfs_confirmadas: 'S', // +3
    quant_grande: 'N', // +1
    prod_nao_combinam: 'N', // +2
    pgtos_abertos: 'N', // +1
  };

  const resultado = calcularScore(dados);
  assert.strictEqual(resultado.detalhesPontos.idade_dominio, 6);
  assert.strictEqual(resultado.detalhesPontos.wayback, 3);
  assert.strictEqual(resultado.detalhesPontos.servidor_mx, 3);
  assert.strictEqual(resultado.detalhesPontos.email_corporativo, 3);
  assert.strictEqual(resultado.detalhesPontos.mail_gratuito, 2);
  assert.strictEqual(resultado.risco, 'SEM-RISCO');
  assert.strictEqual(resultado.sugestao, 'LIBERADO');
});

// 3. Testar Calibração Customizada de Pesos
runTest('calcularScore respeita pesos customizados quando configurados', () => {
  const customConfig = {
    ...DEFAULT_CONFIG,
    peso_mx_premium: 15.0, // Customizado para +15
    peso_dominio_idade_10: 20.0, // Customizado para +20
    peso_email_corp_sim: 10.0, // Customizado para +10
  };

  const dados = {
    total_pedido: 5000,
    faturado: 'S',
    idade_dominio_rdap: 15,
    tipo_servidor_mx: 'PREMIUM',
    email_corporativo: 'S',
    entrega_igual_cadastro: 'S'
  };

  const resultado = calcularScore(dados, customConfig);
  assert.strictEqual(resultado.detalhesPontos.servidor_mx, 15);
  assert.strictEqual(resultado.detalhesPontos.idade_dominio, 20);
  assert.strictEqual(resultado.detalhesPontos.email_corporativo, 10);
});

// 4. Testar Persistência e Reset de Configurações
runTest('saveScoreConfig e resetScoreConfig gravam e restauram arquivos json', () => {
  saveScoreConfig({ peso_mx_premium: 99.0 });
  let cfg = getScoreConfig();
  assert.strictEqual(cfg.peso_mx_premium, 99.0);

  resetScoreConfig();
  cfg = getScoreConfig();
  assert.strictEqual(cfg.peso_mx_premium, DEFAULT_CONFIG.peso_mx_premium);
});

console.log('\n====================================================');
console.log(`📊 RESULTADOS: ${passedTests}/${totalTests} aprovados (${Math.round((passedTests / totalTests) * 100)}%)`);
console.log('====================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
