/**
 * Testes Automatizados: Pontuação Detalhada e Imutabilidade Histórica de Análise de Crédito
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  getScoreConfig,
  saveScoreConfig,
  resetScoreConfig,
  DEFAULT_CONFIG,
  calcularScore,
  salvarAnalise,
  getHistorico
} = require('./analise_credito_engine');

console.log('====================================================');
console.log('🧪 TESTES: PONTUAÇÃO DETALHADA & IMUTABILIDADE');
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

// 1. A soma dos pontos detalhados deve bater 100% com o totalScore em diversos cenários
runTest('Soma matemática de detalhesPontos bate 100% com totalScore (Cenário 1: Cliente Excelente)', () => {
  const dados = {
    total_pedido: 15000, // <= 21k -> 0 pts
    faturado: 'S', // 0 pts
    entrada: 'S', // +12 pts
    comprou_pagou: 'S', // +9 pts
    comprou_pagou_5x: 'S', // +23 pts
    pgtos_abertos: 'N', // +1 pt
    quant_grande: 'N', // +1 pt
    prod_nao_combinam: 'N', // +2 pts
    cnpj_ativo: 'S', // +2 pts
    cadastro_igual_receita: 'S', // +3 pts
    entrega_igual_cadastro: 'S', // +2 pts
    google_maps: '10', // +6 pts
    registro_br: 'S', // dispensado quando entrega=cadastro -> 0 pts
    idade_dominio_rdap: 12, // +6 pts
    wayback_primeiro_snapshot: '2015', // +3 pts
    tipo_servidor_mx: 'PREMIUM', // +3 pts
    casa_sala_conj_end: 'N', // +1 pt
    email_corporativo: 'S', // +3 pts
    existe_mail_financeiro: 'S', // 0 pts
    mail_gratuito: 'N', // +2 pts
    possui_site: 'S', // +1 pt
    fundacao_matriz: '1995-05-10', // > 30 anos -> +8 pts
    capital_social: 2500000, // >= 1M -> +6 pts
    empresa_grande_conhecida: 'S', // +5 pts
    protestos: 'N', // +5 pts
    score_serasa: '850', // +8 pts
    tres_nfs_confirmadas: 'S', // +3 pts
    fgts_situacao_regular: 'S', // 0 pts
    razao_fgts_igual: 'S', // 0 pts
    ch_sem_fundo: 'N', // 0 pts
    pfin: 'N', // +1 pt
    uf_cliente: 'SP' // 0 pts
  };

  const resultado = calcularScore(dados);
  const somaPontos = Object.values(resultado.detalhesPontos).reduce((acc, curr) => acc + (Number(curr) || 0), 0);

  assert.strictEqual(somaPontos, resultado.totalScore);
  assert(resultado.totalScore > 5, 'Score deve ser positivo');
  assert.strictEqual(resultado.risco, 'SEM-RISCO');
});

runTest('Soma matemática de detalhesPontos bate 100% com totalScore (Cenário 2: Risco Alto / Golpe)', () => {
  const dados = {
    total_pedido: 35000, // > 21k -> -8 pts
    faturado: 'S', // 0 pts
    entrada: 'N', // -4 pts
    comprou_pagou: 'N', // -3 pts
    comprou_pagou_5x: 'N', // 0 pts
    pgtos_abertos: 'S', // -3 pts
    quant_grande: 'S', // -13 pts
    prod_nao_combinam: 'S', // -5 pts
    cnpj_ativo: 'S', // +2 pts
    cadastro_igual_receita: 'N', // -3 pts
    entrega_igual_cadastro: 'N', // -9 pts
    google_maps: '0', // -6 pts
    registro_br: 'N', // 0 pts
    idade_dominio_rdap: 0, // recente -> -7 pts
    wayback_primeiro_snapshot: '', // 0 pts
    tipo_servidor_mx: 'NENHUM', // corporativo sem mx -> -4 pts
    casa_sala_conj_end: 'S', // -5 pts
    email_corporativo: 'S', // +3 pts
    existe_mail_financeiro: 'N', // -7 pts
    mail_gratuito: 'S', // -8 pts
    possui_site: 'N', // -15 pts
    fundacao_matriz: '2024-01-01', // < 5 anos -> -6 pts
    capital_social: 10000, // < 12k -> -7 pts
    empresa_grande_conhecida: 'N', // 0 pts
    protestos: 'S', // -10 pts
    valor_protestos: 80000, // > 2x ped -> -10 pts, > capital -> -20 pts
    score_serasa: '150', // < 200 -> -15 pts
    tres_nfs_confirmadas: 'N', // -3 pts
    fgts_situacao_regular: 'N', // -6 pts
    razao_fgts_igual: 'N', // -10 pts
    ch_sem_fundo: 'S', // -6 pts
    pfin: 'S', // -5 pts
    uf_cliente: 'RJ' // -12 pts
  };

  const resultado = calcularScore(dados);
  const somaPontos = Object.values(resultado.detalhesPontos).reduce((acc, curr) => acc + (Number(curr) || 0), 0);

  assert.strictEqual(somaPontos, resultado.totalScore);
  assert(resultado.totalScore < 0, 'Score deve ser negativo');
  assert.strictEqual(resultado.risco, 'GOLPE');
});

// 2. Testar Imutabilidade: salvar snapshot e alterar configuração global
runTest('Snapshot de detalhes_pontos gravado permanece inalterado após rebalanceamento de pesos', () => {
  const dados = {
    pedido_venda: 'TESTE-IMUTAVEL-01',
    cliente_nome: 'Cliente Teste Imutabilidade',
    total_pedido: 10000,
    faturado: 'S',
    entrada: 'S',
    protestos: 'N',
    score_serasa: '750',
    cnpj_ativo: 'S'
  };

  const resultadoOriginal = calcularScore(dados);
  const registroSalvo = salvarAnalise({
    ...dados,
    total_score: resultadoOriginal.totalScore,
    risco: resultadoOriginal.risco,
    sugestao: resultadoOriginal.sugestao,
    detalhes_pontos: resultadoOriginal.detalhesPontos
  });

  assert(registroSalvo.detalhes_pontos !== undefined, 'detalhes_pontos deve estar presente no registro salvo');
  const pontosSalvosOriginal = { ...registroSalvo.detalhes_pontos };

  // Rebalanceia pesos globais
  saveScoreConfig({
    peso_entrada_sim: 99.0,
    peso_serasa_700: 50.0
  });

  // O novo cálculo em tempo real reflete os novos pesos
  const novoCalculo = calcularScore(dados);
  assert(novoCalculo.totalScore > resultadoOriginal.totalScore, 'Novo cálculo deve usar novos pesos');

  // Mas o histórico salvo permanece intacto
  const historico = getHistorico();
  const itemNoHistorico = historico.find(x => x.pedido_venda === 'TESTE-IMUTAVEL-01');
  assert(itemNoHistorico, 'Registro deve existir no histórico');
  assert.strictEqual(itemNoHistorico.detalhes_pontos.entrada, pontosSalvosOriginal.entrada, 'Pontuação gravada no passado não deve mudar');
  assert.strictEqual(itemNoHistorico.detalhes_pontos.score_serasa, pontosSalvosOriginal.score_serasa, 'Pontuação gravada no passado não deve mudar');

  // Restaura config padrão
  resetScoreConfig();
});

console.log(`\n====================================================`);
console.log(`📊 RESULTADOS: ${passedTests}/${totalTests} aprovados (${Math.round((passedTests / totalTests) * 100)}%)`);
console.log(`====================================================\n`);

if (passedTests !== totalTests) {
  process.exit(1);
}
