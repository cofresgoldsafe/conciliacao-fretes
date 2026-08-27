/**
 * test_conciliacao_bancaria.js
 * 
 * Suíte de Testes Unitários para o Motor de Conciliação Bancária (protheus_db.js):
 * 1. Casamento 1:1 Direto (Valor, D/C e Proximidade de Data +-2 dias).
 * 2. Casamento de Cartão / Domicílio Líquido (Crédito Bruto - Débito Taxa MDR = Crédito Líquido no Banco).
 * 3. Casamento Agrupado N:1 (Subset-Sum de Múltiplos Títulos do Protheus = 1 Lançamento no Banco).
 * 4. Tratamento de Tolerância de Centavos (0.01) e Arredondamento Monetário BRL.
 * 5. Identificação de Lançamentos Órfãos e Resumo Estatístico de Conciliação.
 */

const assert = require('assert');
const { algoritmoMatchingConciliacao } = require('./protheus_db');

let passedTests = 0;
let failedTests = 0;

function report(name, success, error) {
  if (success) {
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } else {
    console.error(`  ❌ [FAIL] ${name}: ${error}`);
    failedTests++;
  }
}

async function runConciliacaoTests() {
  console.log('\n=============================================================');
  console.log('🧪 SUÍTE DE TESTES: MOTOR DE CONCILIAÇÃO BANCÁRIA & MATCHING');
  console.log('=============================================================\n');

  // -------------------------------------------------------------
  // Teste 1: Casamento 1:1 Direto
  // -------------------------------------------------------------
  console.log('--- 1. Casamento 1:1 Direto (Créditos e Débitos) ---');
  try {
    const lancamentosProtheus = [
      { id: 'se5-1', data: '2026-08-20', tipoOperacao: 'C', valor: 1540.50, descricao: 'Recebimento Cliente ABC' },
      { id: 'se5-2', data: '2026-08-21', tipoOperacao: 'D', valor: 350.00, descricao: 'Pagamento Fornecedor XYZ' }
    ];

    const transacoesBanco = [
      { id: 'inter-1', data: '2026-08-20', tipoOperacao: 'C', valor: 1540.50, titulo: 'Pix Recebido ABC' },
      { id: 'inter-2', data: '2026-08-22', tipoOperacao: 'D', valor: 350.00, titulo: 'TED/Pix Enviado XYZ' } // 1 dia de diferença
    ];

    const resultado = algoritmoMatchingConciliacao(lancamentosProtheus, transacoesBanco);

    assert.strictEqual(resultado.gruposConciliados.length, 2, 'Deve conciliar os 2 pares 1:1');
    assert.strictEqual(resultado.resumo.totalConciliados1_1, 2);
    assert.strictEqual(resultado.orfaosBanco.length, 0);
    assert.strictEqual(resultado.orfaosProtheus.length, 0);

    const gPix = resultado.gruposConciliados.find(g => g.valorTotal === 1540.50);
    assert.ok(gPix);
    assert.strictEqual(gPix.tipo, '1:1');
    assert.strictEqual(gPix.status, 'CONCILIADO_1_1');
    assert.strictEqual(gPix.protheusItems[0].id, 'se5-1');
    assert.strictEqual(gPix.bancoItems[0].id, 'inter-1');

    report('Casamento 1:1 direto para créditos e débitos com proximidade de data', true);
  } catch (err) {
    report('Casamento 1:1 direto para créditos e débitos com proximidade de data', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 2: Casamento de Vendas Cartão / Domicílio Líquido (1 Crédito Bruto - 1 Taxa = 1 Líquido)
  // -------------------------------------------------------------
  console.log('\n--- 2. Casamento de Cartão / Domicílio Líquido (Bruto - Taxa) ---');
  try {
    const lancamentosProtheus = [
      { id: 'se5-venda', data: '2026-08-15', tipoOperacao: 'C', valor: 500.00, descricao: 'Venda Cartão Loja' },
      { id: 'se5-taxa', data: '2026-08-15', tipoOperacao: 'D', valor: 12.50, descricao: 'Taxa MDR / Interpag' },
      { id: 'se5-outro', data: '2026-08-15', tipoOperacao: 'C', valor: 100.00, descricao: 'Outro Recebimento' }
    ];

    const transacoesBanco = [
      { id: 'inter-domicilio', data: '2026-08-16', tipoOperacao: 'C', valor: 487.50, titulo: 'Credito Domicilio Cartao' } // 500.00 - 12.50 = 487.50
    ];

    const resultado = algoritmoMatchingConciliacao(lancamentosProtheus, transacoesBanco);

    assert.strictEqual(resultado.resumo.totalCartaoLiquido, 1, 'Deve conciliar 1 grupo de cartão líquido');
    const gCartao = resultado.gruposConciliados.find(g => g.tipo === 'CARTAO_LIQUIDO');
    assert.ok(gCartao);
    assert.strictEqual(gCartao.valorTotal, 487.50);
    assert.strictEqual(gCartao.valorBruto, 500.00);
    assert.strictEqual(gCartao.valorTaxa, 12.50);
    assert.strictEqual(gCartao.protheusItems.length, 2, 'Deve conter a venda e a taxa do Protheus');
    assert.strictEqual(resultado.orfaosProtheus.length, 1, 'Lançamento outro deve restar órfão');

    report('Casamento de vendas cartão líquido com dedução de taxa de intermediação', true);
  } catch (err) {
    report('Casamento de vendas cartão líquido com dedução de taxa de intermediação', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 3: Casamento Agrupado N:1 (Subset-Sum)
  // -------------------------------------------------------------
  console.log('\n--- 3. Casamento Agrupado N:1 (Aglutinação Subset-Sum) ---');
  try {
    const lancamentosProtheus = [
      { id: 'se5-p1', data: '2026-08-10', tipoOperacao: 'D', valor: 1200.00, descricao: 'Fornecedor Aço 1' },
      { id: 'se5-p2', data: '2026-08-10', tipoOperacao: 'D', valor: 850.00, descricao: 'Fornecedor Aço 2' },
      { id: 'se5-p3', data: '2026-08-10', tipoOperacao: 'D', valor: 450.00, descricao: 'Fornecedor Tinta' },
      { id: 'se5-p4', data: '2026-08-10', tipoOperacao: 'D', valor: 99.00, descricao: 'Outro Débito' }
    ];

    const transacoesBanco = [
      // 1200.00 + 850.00 + 450.00 = 2500.00 debitado em lote no banco
      { id: 'inter-lote', data: '2026-08-10', tipoOperacao: 'D', valor: 2500.00, titulo: 'Lote de Pagamentos Fornecedores' }
    ];

    const resultado = algoritmoMatchingConciliacao(lancamentosProtheus, transacoesBanco);

    assert.strictEqual(resultado.resumo.totalAgrupadosN_1, 1, 'Deve identificar 1 lote agrupado N:1');
    const gLote = resultado.gruposConciliados.find(g => g.tipo === 'N:1');
    assert.ok(gLote);
    assert.strictEqual(gLote.valorTotal, 2500.00);
    assert.strictEqual(gLote.protheusItems.length, 3, 'Deve agrupar exatamente os 3 itens que somam 2500.00');
    assert.strictEqual(resultado.orfaosProtheus.length, 1, 'Item de 99.00 deve restar órfão');

    report('Aglutinação N:1 identifica corretamente subconjuntos que somam o débito em lote', true);
  } catch (err) {
    report('Aglutinação N:1 identifica corretamente subconjuntos que somam o débito em lote', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 4: Tolerância de Centavos e Arredondamento
  // -------------------------------------------------------------
  console.log('\n--- 4. Tolerância de Centavos e Arredondamento ---');
  try {
    const lancamentosProtheus = [
      { id: 'se5-cent', data: '2026-08-18', tipoOperacao: 'C', valor: 100.004, descricao: 'Dízima' }
    ];
    const transacoesBanco = [
      { id: 'inter-cent', data: '2026-08-18', tipoOperacao: 'C', valor: 100.00, titulo: 'Pix Arredondado' }
    ];

    const resultado = algoritmoMatchingConciliacao(lancamentosProtheus, transacoesBanco);
    assert.strictEqual(resultado.gruposConciliados.length, 1, 'Diferença inferior a 1 centavo deve ser conciliada');
    assert.strictEqual(resultado.orfaosBanco.length, 0);

    report('Tolerância de centavos concilia valores com pequenas variações de ponto flutuante', true);
  } catch (err) {
    report('Tolerância de centavos concilia valores com pequenas variações de ponto flutuante', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 5: Isolamento de Itens Órfãos e Resumo Estatístico
  // -------------------------------------------------------------
  console.log('\n--- 5. Isolamento de Itens Órfãos & Estatísticas ---');
  try {
    const lancamentosProtheus = [
      { id: 'p-1', data: '2026-08-01', tipoOperacao: 'C', valor: 750.00, descricao: 'Recebimento 1' },
      { id: 'p-orfao', data: '2026-08-01', tipoOperacao: 'C', valor: 999.99, descricao: 'Recebimento Sem Banco' }
    ];
    const transacoesBanco = [
      { id: 'b-1', data: '2026-08-01', tipoOperacao: 'C', valor: 750.00, titulo: 'Pix 1' },
      { id: 'b-orfao', data: '2026-08-01', tipoOperacao: 'D', valor: 123.45, titulo: 'Taxa Sem Protheus' }
    ];

    const resultado = algoritmoMatchingConciliacao(lancamentosProtheus, transacoesBanco);

    assert.strictEqual(resultado.resumo.totalBanco, 2);
    assert.strictEqual(resultado.resumo.totalProtheus, 2);
    assert.strictEqual(resultado.resumo.totalConciliados1_1, 1);
    assert.strictEqual(resultado.resumo.totalOrfaosBanco, 1);
    assert.strictEqual(resultado.resumo.totalOrfaosProtheus, 1);
    assert.strictEqual(resultado.orfaosBanco[0].id, 'b-orfao');
    assert.strictEqual(resultado.orfaosProtheus[0].id, 'p-orfao');

    report('Itens órfãos são discriminados e o resumo estatístico reflete fielmente o lote', true);
  } catch (err) {
    report('Itens órfãos são discriminados e o resumo estatístico reflete fielmente o lote', false, err.message);
  }

  // -------------------------------------------------------------
  // Resumo Final
  // -------------------------------------------------------------
  console.log('\n=============================================================');
  console.log(`📊 RESULTADOS: ${passedTests} Aprovados, ${failedTests} Falhas`);
  console.log('=============================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runConciliacaoTests().catch(err => {
    console.error('Erro fatal:', err);
    process.exit(1);
  });
}

module.exports = runConciliacaoTests;
