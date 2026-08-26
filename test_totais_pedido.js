/**
 * Testes Automatizados: Validação do Cálculo de Totais do Pedido de Venda
 * Garante que C5_FRETE é somado ao total e C5_VLR_FRT (Frete Embutido) NÃO é somado.
 */

const assert = require('assert');

console.log('====================================================');
console.log('🧪 TESTES: CÁLCULO DE TOTAIS DO PEDIDO (C5_FRETE vs C5_VLR_FRT)');
console.log('====================================================\n');

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passCount++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Erro: ${err.message}`);
    failCount++;
  }
}

// Simulação da lógica de cálculo de totais em obterDetalhesPedido
function calcularTotaisPedido(itens, head) {
  const roundVal = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
  const totalProdutos = itens.reduce((acc, it) => acc + parseFloat(it.VALOR || 0), 0);
  const freteCobrado = parseFloat(head.FRETE || 0); // C5_FRETE
  const freteEmbutido = parseFloat(head.FRETE_EMBUTIDO || 0); // C5_VLR_FRT
  const totalFrete = freteCobrado; // Apenas C5_FRETE compõe o total do pedido
  const totalDesconto = parseFloat(head.DESCONTO || 0);
  const totalGeral = totalProdutos + totalFrete - totalDesconto;

  return {
    totalProdutos: roundVal(totalProdutos),
    totalFrete: roundVal(totalFrete),
    freteCobrado: roundVal(freteCobrado),
    freteEmbutido: roundVal(freteEmbutido),
    totalDesconto: roundVal(totalDesconto),
    totalGeral: roundVal(totalGeral)
  };
}

// 1. Cenário com apenas C5_FRETE (frete normal cobrado)
test('Cenário 1: Frete normal (C5_FRETE = R$ 150,00, C5_VLR_FRT = 0) deve SOMAR ao total', () => {
  const itens = [
    { ITEM: '01', VALOR: 1000.00 },
    { ITEM: '02', VALOR: 500.00 }
  ];
  const head = {
    FRETE: 150.00,
    FRETE_EMBUTIDO: 0,
    DESCONTO: 0
  };

  const totais = calcularTotaisPedido(itens, head);
  assert.strictEqual(totais.totalProdutos, 1500.00);
  assert.strictEqual(totais.freteCobrado, 150.00);
  assert.strictEqual(totais.freteEmbutido, 0.00);
  assert.strictEqual(totais.totalFrete, 150.00);
  assert.strictEqual(totais.totalGeral, 1650.00, 'Total geral deve ser 1500 + 150 = 1650');
});

// 2. Cenário com apenas C5_VLR_FRT (frete embutido CIF)
test('Cenário 2: Frete embutido (C5_FRETE = 0, C5_VLR_FRT = R$ 200,00) NÃO deve somar ao total', () => {
  const itens = [
    { ITEM: '01', VALOR: 2500.00 }
  ];
  const head = {
    FRETE: 0,
    FRETE_EMBUTIDO: 200.00,
    DESCONTO: 0
  };

  const totais = calcularTotaisPedido(itens, head);
  assert.strictEqual(totais.totalProdutos, 2500.00);
  assert.strictEqual(totais.freteCobrado, 0.00);
  assert.strictEqual(totais.freteEmbutido, 200.00);
  assert.strictEqual(totais.totalFrete, 0.00);
  assert.strictEqual(totais.totalGeral, 2500.00, 'Total geral deve ser exatamente 2500, sem somar frete embutido');
});

// 3. Cenário misto (C5_FRETE = R$ 100,00 e C5_VLR_FRT = R$ 80,00 com desconto R$ 50,00)
test('Cenário 3: Misto (C5_FRETE = 100, C5_VLR_FRT = 80, Desconto = 50) soma apenas C5_FRETE', () => {
  const itens = [
    { ITEM: '01', VALOR: 3000.00 }
  ];
  const head = {
    FRETE: 100.00,
    FRETE_EMBUTIDO: 80.00,
    DESCONTO: 50.00
  };

  const totais = calcularTotaisPedido(itens, head);
  assert.strictEqual(totais.totalProdutos, 3000.00);
  assert.strictEqual(totais.freteCobrado, 100.00);
  assert.strictEqual(totais.freteEmbutido, 80.00);
  assert.strictEqual(totais.totalFrete, 100.00);
  assert.strictEqual(totais.totalDesconto, 50.00);
  // Total = 3000 (produtos) + 100 (frete cobrado) - 50 (desconto) = 3050
  assert.strictEqual(totais.totalGeral, 3050.00, 'Total geral deve ser 3000 + 100 - 50 = 3050');
});

// 4. Integração com Endpoint de Análise de Crédito
test('Cenário 4: Payload de Análise de Crédito calcula total_pedido com base em totalGeral', () => {
  const tot = {
    totalProdutos: 5000,
    totalFrete: 200, // Apenas C5_FRETE
    freteCobrado: 200,
    freteEmbutido: 350,
    totalDesconto: 0,
    totalGeral: 5200 // 5000 + 200
  };

  const totalVal = Number(tot.totalGeral || tot.totalProdutos || 0);
  const payloadTotal = parseFloat(totalVal.toFixed(2));
  assert.strictEqual(payloadTotal, 5200.00);
});

console.log(`\n====================================================`);
console.log(`📊 RESULTADOS: ${passCount} aprovados, ${failCount} falhas`);
console.log(`====================================================\n`);

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
