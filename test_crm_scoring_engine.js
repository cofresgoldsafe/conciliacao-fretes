/**
 * test_crm_scoring_engine.js
 * Suíte de Testes Automatizados para o Motor Preditivo de Oportunidades (crm_scoring_engine.js)
 * Plataforma de Apoio GSI (Gemini-Cli)
 */

const assert = require('assert');
const { calcularScoreDeal, MODEL_WEIGHTS } = require('./crm_scoring_engine');

console.log('================================================================');
console.log('🧪 INICIANDO TESTES DO MOTOR PREDITIVO (CRM SCORING ENGINE)');
console.log('================================================================\n');

let passedTests = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`❌ [FAIL] ${name}: ${err.message}`);
    process.exit(1);
  }
}

// 1. Pesos do modelo
test('1.1 Coeficientes do modelo estão definidos e consistentes', () => {
  assert(Array.isArray(MODEL_WEIGHTS), 'MODEL_WEIGHTS deve ser um array');
  assert.strictEqual(MODEL_WEIGHTS.length, 10, 'Deve conter 10 pesos calibrados');
  assert(MODEL_WEIGHTS.every(w => typeof w === 'number' && !isNaN(w)), 'Todos os pesos devem ser números válidos');
});

// 2. Resiliência a entradas vazias / nulas
test('2.1 Trata objeto vazio sem quebrar (fail-safe)', () => {
  const res = calcularScoreDeal({});
  assert(typeof res.score === 'number', 'Score deve ser um número');
  assert(res.score >= 0 && res.score <= 100, 'Score deve estar entre 0 e 100');
  assert(['BAIXA', 'MEDIA', 'ALTA'].includes(res.classificacao), 'Classificação válida');
  assert(typeof res.recomendacao === 'string', 'Recomendação deve ser texto');
});

test('2.2 Trata valores nulos e strings nos campos numéricos', () => {
  const res = calcularScoreDeal({
    valor_total: '15000.50',
    notes_count: '4',
    done_activities_count: null,
    created_at: '2026-09-01T10:00:00Z',
    nome_vendedor: null
  });
  assert(typeof res.score === 'number', 'Deve processar sem erros');
  assert(res.score >= 0 && res.score <= 100);
});

// 3. Casos de Negócio Reais
test('3.1 Cliente Recorrente com Histórico tem Score superior a Cliente Novo equivalente', () => {
  const dealNovo = {
    valor_total: 5000,
    notes_count: 2,
    created_at: new Date(Date.now() - 5*24*60*60*1000).toISOString(),
    nome_vendedor: 'Andrea Ferreira',
    is_recurrent: false,
    has_won_prior: false
  };

  const dealRecorrente = {
    valor_total: 5000,
    notes_count: 2,
    created_at: new Date(Date.now() - 5*24*60*60*1000).toISOString(),
    nome_vendedor: 'Andrea Ferreira',
    is_recurrent: true,
    has_won_prior: true
  };

  const scoreNovo = calcularScoreDeal(dealNovo);
  const scoreRecorrente = calcularScoreDeal(dealRecorrente);

  assert(scoreRecorrente.score > scoreNovo.score, 'Cliente recorrente deve pontuar mais que cliente novo');
  assert(scoreRecorrente.fatoresPositivos.some(f => f.fator.includes('Cliente Recorrente')), 'Deve listar cliente recorrente nos fatores positivos');
});

test('3.2 Deal Estagnado (>30 dias sem notas) ativa Alerta de Esfriamento e penalidade', () => {
  const dealEstagnado = {
    valor_total: 8000,
    notes_count: 0,
    created_at: new Date(Date.now() - 35*24*60*60*1000).toISOString(),
    nome_vendedor: 'Andrea Ferreira'
  };

  const res = calcularScoreDeal(dealEstagnado);
  assert.strictEqual(res.alertaEsfriamento, true, 'Deve ativar alerta de esfriamento');
  assert.strictEqual(res.classificacao, 'BAIXA', 'Deal estagnado deve ser classificado como BAIXA');
  assert(res.fatoresNegativos.some(f => f.fator.includes('estagnado')), 'Deve indicar estagnação nos fatores negativos');
});

test('3.3 Venda Rápida de Cofre (Juliana Lopes, 1 dia) pontua ALTA', () => {
  const dealJuliana = {
    valor_total: 2200,
    notes_count: 0,
    created_at: new Date(Date.now() - 1*24*60*60*1000).toISOString(),
    nome_vendedor: 'Juliana Lopes'
  };

  const res = calcularScoreDeal(dealJuliana);
  assert.strictEqual(res.classificacao, 'ALTA', 'Venda rápida recente deve ser ALTA');
  assert(res.score >= 80, 'Score de Juliana deve ser >= 80');
});

// 4. Integração com Fidelidade por Raiz de CNPJ
test('4.1 Oportunidade com Raiz de CNPJ (1-5 compras ⭐) ativa bônus de recorrência automaticamente', () => {
  const dealSemFidelidade = {
    valor_total: 4500,
    created_at: new Date(Date.now() - 4*24*60*60*1000).toISOString(),
    nome_vendedor: 'Andrea Ferreira',
    fidelidade_compras: null
  };

  const dealComRaiz = {
    valor_total: 4500,
    created_at: new Date(Date.now() - 4*24*60*60*1000).toISOString(),
    nome_vendedor: 'Andrea Ferreira',
    fidelidade_compras: {
      raiz_cnpj: '07265905',
      total_compras: 3,
      tipo: 'estrela'
    }
  };

  const resSem = calcularScoreDeal(dealSemFidelidade);
  const resCom = calcularScoreDeal(dealComRaiz);

  assert(resCom.score > resSem.score, 'Cliente com histórico na Raiz de CNPJ deve pontuar mais');
  assert(resCom.fatoresPositivos.some(f => f.fator.includes('Cliente Fidelidade na Raiz do CNPJ (3 compras')), 'Deve indicar fidelidade da raiz nos fatores positivos');
});

test('4.2 Oportunidade com Cliente Diamante VIP (6+ compras 💎) recebe bônus VIP máximo', () => {
  const dealEstrela = {
    valor_total: 10000,
    created_at: new Date(Date.now() - 4*24*60*60*1000).toISOString(),
    nome_vendedor: 'Andrea Ferreira',
    fidelidade_compras: {
      raiz_cnpj: '07265905',
      total_compras: 2,
      tipo: 'estrela'
    }
  };

  const dealVip = {
    valor_total: 10000,
    created_at: new Date(Date.now() - 4*24*60*60*1000).toISOString(),
    nome_vendedor: 'Andrea Ferreira',
    fidelidade_compras: {
      raiz_cnpj: '07265905',
      total_compras: 12,
      tipo: 'diamante'
    }
  };

  const resEstrela = calcularScoreDeal(dealEstrela);
  const resVip = calcularScoreDeal(dealVip);

  assert(resVip.score >= resEstrela.score, 'Cliente Diamante VIP deve ter score superior ou igual');
  assert(resVip.fatoresPositivos.some(f => f.fator.includes('Cliente Diamante VIP na Raiz do CNPJ (12 compras')), 'Deve indicar Diamante VIP nos fatores');
  assert.strictEqual(resVip.classificacao, 'ALTA', 'Cliente VIP com 12 compras deve ser classificado como ALTA');
});

console.log(`\n🎉 TODOS OS ${passedTests} TESTES DO MOTOR PREDITIVO PASSARAM COM SUCESSO!\n`);

