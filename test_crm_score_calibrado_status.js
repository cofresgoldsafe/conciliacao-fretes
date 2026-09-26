/**
 * test_crm_score_calibrado_status.js
 * Teste de Verificação da Correção do Status e Score Preditivo Calibrado no CRM
 * Plataforma de Apoio GSI (Gemini-Cli)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { calcularScoreDeal, MODEL_WEIGHTS } = require('./crm_scoring_engine');

console.log('================================================================');
console.log('🧪 TESTES: STATUS LIMPO E SCORE PREDITIVO CALIBRADO NO CRM');
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

// 1. Verificação do Status na Listagem de Deals em public/js/crm.js
test('1.1 public/js/crm.js não renderiza renderScoreBadge para deals GANHO ou PERDIDO na listagem', () => {
  const js = fs.readFileSync(path.join(__dirname, 'public', 'js', 'crm.js'), 'utf8');
  assert.ok(js.includes('(!isGanho && !isPerdido) ? renderScoreBadge(d.score_preditivo) : \'\''), 'Listagem tabular não deve exibir score em negócios Ganho/Perdido');
});

test('1.2 public/js/crm.js não renderiza renderScoreBadge para deals GANHO ou PERDIDO no Kanban', () => {
  const js = fs.readFileSync(path.join(__dirname, 'public', 'js', 'crm.js'), 'utf8');
  assert.ok(js.includes('(![\'GANHO\', \'PERDIDO\'].includes(deal.fase)) ? renderScoreBadge(deal.score_preditivo) : \'\''), 'Kanban não deve exibir score em cards Ganho/Perdido');
});

// 2. Verificação de Status Conclusivo em crm_scoring_engine.js
test('2.1 Deals na fase GANHO retornam score 100% conclusivo com recomendação de faturamento', () => {
  const dealGanho = { fase: 'GANHO', valor_total: 10000 };
  const res = calcularScoreDeal(dealGanho);
  assert.strictEqual(res.score, 100);
  assert.strictEqual(res.probabilidade, 1.0);
  assert.strictEqual(res.classificacao, 'ALTA');
  assert.strictEqual(res.alertaEsfriamento, false);
});

test('2.2 Deals na fase PERDIDO retornam score 0% com recomendação de arquivamento', () => {
  const dealPerdido = { fase: 'PERDIDO', valor_total: 10000 };
  const res = calcularScoreDeal(dealPerdido);
  assert.strictEqual(res.score, 0);
  assert.strictEqual(res.probabilidade, 0.0);
  assert.strictEqual(res.classificacao, 'BAIXA');
  assert.strictEqual(res.alertaEsfriamento, false);
});

// 3. Verificação de Calibração Anti-Inflação de 99%
test('3.1 Oportunidade com histórico de compras na raiz NÃO é inflada para 99%', () => {
  // Deal aberto de cliente com 1 compra faturada no Grupo GSI
  const dealComHistorico = {
    fase: 'PROPOSTA',
    valor_total: 6500,
    created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
    nome_vendedor: 'Luiz Figueiredo',
    fidelidade_compras: {
      raiz_cnpj: '61412110',
      total_compras: 1
    }
  };

  const res = calcularScoreDeal(dealComHistorico);
  // O score deve ser moderado/alto porém realista (entre 50% e 85%), JAMAIS 99% ou 100%
  assert.ok(res.score < 95, `Score de cliente com 1 compra não deve ser inflado para 99% (score obtido: ${res.score}%)`);
  assert.ok(res.score >= 50, `Score deve refletir positivamente a fidelidade (score obtido: ${res.score}%)`);
});

test('3.2 Coeficiente de Vitória Anterior w6 é moderado e balanceado (<= 1.5, sem data leakage)', () => {
  assert.ok(MODEL_WEIGHTS[6] <= 1.5, `w6 (${MODEL_WEIGHTS[6]}) não pode ser inflado (> 1.5) por vazamento de dados`);
  assert.ok(MODEL_WEIGHTS[6] >= 0.5, `w6 (${MODEL_WEIGHTS[6]}) deve conceder bônus positivo à vitória anterior`);
});

console.log(`\n🎉 TODOS OS ${passedTests} TESTES DE STATUS E SCORE CALIBRADO FORAM APROVADOS COM SUCESSO!\n`);
