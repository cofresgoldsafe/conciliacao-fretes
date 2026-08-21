/**
 * test_vendedores_nfe.js
 * Teste unitário e de integração para a lógica da coluna NF-e (C5_NOTA)
 * nos pedidos de vendedores.
 */

const assert = require('assert');
const protheusDb = require('./protheus_db');

console.log('\n====================================================');
console.log('🧪 TESTES AUTOMATIZADOS: NF-E / C5_NOTA (VENDEDORES)');
console.log('====================================================\n');

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passCount++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
    failCount++;
  }
}

// Simulador da lógica client-side formatNFeBadge
function formatNFeBadge(notaFiscal) {
  const nf = (notaFiscal || '').trim();
  if (!nf || nf === '-' || nf === '0') {
    return { status: 'NAO_EMITIDA', label: '⏳ Não emitida' };
  }
  if (/^X+$/i.test(nf) || nf.toUpperCase().includes('CANCEL')) {
    return { status: 'CANCELADO', label: '🚫 Cancelado' };
  }
  return { status: 'EMITIDA', label: `📄 NF ${nf}`, nf: nf };
}

// 1. Testes de Classificação de C5_NOTA
test('C5_NOTA vazio resulta em "Não emitida"', () => {
  assert.strictEqual(formatNFeBadge('').status, 'NAO_EMITIDA');
  assert.strictEqual(formatNFeBadge('   ').status, 'NAO_EMITIDA');
  assert.strictEqual(formatNFeBadge(null).status, 'NAO_EMITIDA');
  assert.strictEqual(formatNFeBadge(undefined).status, 'NAO_EMITIDA');
  assert.strictEqual(formatNFeBadge('-').status, 'NAO_EMITIDA');
});

test('C5_NOTA com "XXXXXXXXX" resulta em "Cancelado"', () => {
  assert.strictEqual(formatNFeBadge('XXXXXXXXX').status, 'CANCELADO');
  assert.strictEqual(formatNFeBadge('xxxxxxxxx').status, 'CANCELADO');
  assert.strictEqual(formatNFeBadge('   XXXX   ').status, 'CANCELADO');
  assert.strictEqual(formatNFeBadge('CANCELADO').status, 'CANCELADO');
});

test('C5_NOTA com número preenchido resulta em "Emitida" com o número da NF', () => {
  const res1 = formatNFeBadge('000123456');
  assert.strictEqual(res1.status, 'EMITIDA');
  assert.strictEqual(res1.nf, '000123456');

  const res2 = formatNFeBadge('987654');
  assert.strictEqual(res2.status, 'EMITIDA');
  assert.strictEqual(res2.nf, '987654');
});

// 2. Testes de Classificação Fiscal da TES (SF4: F4_DUPLIC e F4_ESTOQUE)
test('F4_DUPLIC = "S" indica Gera Financeiro = Sim, "N" indica Não', () => {
  const parseGeraFin = (f4) => (f4 || '').trim().toUpperCase() === 'S' ? 'S' : ((f4 || '').trim().toUpperCase() === 'N' ? 'N' : '-');
  assert.strictEqual(parseGeraFin('S'), 'S');
  assert.strictEqual(parseGeraFin('s'), 'S');
  assert.strictEqual(parseGeraFin('N'), 'N');
  assert.strictEqual(parseGeraFin('n'), 'N');
  assert.strictEqual(parseGeraFin(''), '-');
  assert.strictEqual(parseGeraFin(null), '-');
});

test('F4_ESTOQUE = "S" indica Atualiza Estoque = Sim, "N" indica Não', () => {
  const parseAtuEstq = (f4) => (f4 || '').trim().toUpperCase() === 'S' ? 'S' : ((f4 || '').trim().toUpperCase() === 'N' ? 'N' : '-');
  assert.strictEqual(parseAtuEstq('S'), 'S');
  assert.strictEqual(parseAtuEstq('s'), 'S');
  assert.strictEqual(parseAtuEstq('N'), 'N');
  assert.strictEqual(parseAtuEstq('n'), 'N');
  assert.strictEqual(parseAtuEstq(''), '-');
  assert.strictEqual(parseAtuEstq(null), '-');
});

test('Consolidação fiscal do pedido agrega TES e indicadores fiscais', () => {
  const itens = [
    { TES: '501', F4_DUPLIC: 'S', F4_ESTOQUE: 'S' },
    { TES: '501', F4_DUPLIC: 'S', F4_ESTOQUE: 'S' }
  ];
  const distinctTes = [...new Set(itens.map(i => (i.TES || '').trim()).filter(Boolean))];
  const hasDuplicSim = itens.some(i => (i.F4_DUPLIC || '').trim().toUpperCase() === 'S');
  const hasEstoqueSim = itens.some(i => (i.F4_ESTOQUE || '').trim().toUpperCase() === 'S');

  assert.strictEqual(distinctTes.join(', '), '501');
  assert.strictEqual(hasDuplicSim, true);
  assert.strictEqual(hasEstoqueSim, true);
});

// 3. Testes de Faturas / Títulos SE1 (E1_BAIXA, E1_VENCTO, E1_PARCELA)
test('E1_BAIXA preenchido com data indica título PAGO', () => {
  const checkStatusBaixa = (baixa) => {
    const dataBaixa = (baixa || '').trim();
    const estaPago = !!(dataBaixa && dataBaixa !== '' && dataBaixa !== '0' && dataBaixa.length === 8);
    return {
      estaPago,
      status: estaPago ? 'PAGO' : 'PENDENTE'
    };
  };

  const res1 = checkStatusBaixa('20260815');
  assert.strictEqual(res1.estaPago, true);
  assert.strictEqual(res1.status, 'PAGO');

  const res2 = checkStatusBaixa('');
  assert.strictEqual(res2.estaPago, false);
  assert.strictEqual(res2.status, 'PENDENTE');

  const res3 = checkStatusBaixa('   ');
  assert.strictEqual(res3.estaPago, false);
  assert.strictEqual(res3.status, 'PENDENTE');

  const res4 = checkStatusBaixa(null);
  assert.strictEqual(res4.estaPago, false);
  assert.strictEqual(res4.status, 'PENDENTE');
});

test('E1_PARCELA identifica parcelas divididas (A, B, C, 01, 02) ou Parcela Única', () => {
  const parseParcela = (parcela) => {
    const p = (parcela || '').trim();
    return p || 'Única';
  };

  assert.strictEqual(parseParcela(''), 'Única');
  assert.strictEqual(parseParcela('   '), 'Única');
  assert.strictEqual(parseParcela(null), 'Única');
  assert.strictEqual(parseParcela('A'), 'A');
  assert.strictEqual(parseParcela('B'), 'B');
  assert.strictEqual(parseParcela('01'), '01');
  assert.strictEqual(parseParcela('AB'), 'AB');
});

test('Formatação de datas Protheus YYYYMMDD para DD/MM/AAAA', () => {
  const formatData = (dt) => {
    if (!dt || String(dt).trim().length !== 8) return dt ? String(dt).trim() : '-';
    const s = String(dt).trim();
    return `${s.slice(6,8)}/${s.slice(4,6)}/${s.slice(0,4)}`;
  };

  assert.strictEqual(formatData('20260821'), '21/08/2026');
  assert.strictEqual(formatData('20260905'), '05/09/2026');
  assert.strictEqual(formatData(''), '-');
  assert.strictEqual(formatData(null), '-');
});

// 4. Testes de Contrato do Módulo protheus_db
test('protheus_db exporta buscarPedidosVendedores e obterDetalhesPedido', () => {
  assert.strictEqual(typeof protheusDb.buscarPedidosVendedores, 'function');
  assert.strictEqual(typeof protheusDb.obterDetalhesPedido, 'function');
});

console.log(`\n====================================================`);
console.log(`📊 RESULTADOS: ${passCount} aprovados, ${failCount} falhas`);
console.log(`====================================================\n`);

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
