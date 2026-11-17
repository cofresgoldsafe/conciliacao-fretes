/**
 * test_bi_ciclo_operacional.js
 * Teste unitário e de conformidade matemática do Motor de Ciclo Operacional
 */

'use strict';

const assert = require('assert');
const {
  calcularCicloOperacionalIndices,
  roundVal,
  roundDays
} = require('./bi_ciclo_operacional_engine');

console.log('🧪 Iniciando testes do motor de Ciclo Operacional...');

// 1. Cenário Base Padrão: 365 dias
const dadosMock = {
  diasPeriodo: 365,
  estoque: [
    { empresa_cod: '14', custo_total: 1500000 },
    { empresa_cod: '15', custo_total: 2500000 },
    { empresa_cod: '16', custo_total: 1000000 }
  ],
  contasReceber: [
    { empresa_cod: '14', saldo: 1200000 },
    { empresa_cod: '15', saldo: 1800000 },
    { empresa_cod: '16', saldo: 800000 }
  ],
  contasPagar: [
    { empresa_cod: '14', saldo: 900000 },
    { empresa_cod: '15', saldo: 1400000 },
    { empresa_cod: '16', saldo: 700000 }
  ],
  vendasPeriodo: [
    { empresa_cod: '14', faturamento_total: 12000000 },
    { empresa_cod: '15', faturamento_total: 18000000 },
    { empresa_cod: '16', faturamento_total: 8000000 }
  ],
  cmvPeriodo: [
    { empresa_cod: '14', cmv_total: 7500000 },
    { empresa_cod: '15', cmv_total: 11000000 },
    { empresa_cod: '16', cmv_total: 5000000 }
  ],
  comprasPeriodo: [
    { empresa_cod: '14', compras_total: 7000000 },
    { empresa_cod: '15', compras_total: 10500000 },
    { empresa_cod: '16', compras_total: 4800000 }
  ]
};

const res = calcularCicloOperacionalIndices(dadosMock);

// Teste 1: Estrutura geral de retorno
assert(res.consolidado, 'Deveria conter objeto consolidado');
assert(res.porEmpresa, 'Deveria conter objeto porEmpresa');
assert(res.porEmpresa['14'], 'Deveria conter dados da empresa 14');
assert(res.porEmpresa['15'], 'Deveria conter dados da empresa 15');
assert(res.porEmpresa['16'], 'Deveria conter dados da empresa 16');

// Teste 2: Consolidado - PME
// Estoque total = 1.5M + 2.5M + 1M = 5.000.000
// CMV total = 7.5M + 11M + 5M = 23.500.000
// CMV diário = 23.500.000 / 365 = 64.383,56
// PME esperado = 5.000.000 / 64.383,56 = 77.7 dias
const pmeConsolidado = res.consolidado.indices.pme.dias;
console.log(`✓ PME Consolidado calculado: ${pmeConsolidado} dias`);
assert(Math.abs(pmeConsolidado - 77.7) < 0.2, `PME esperado próximo de 77.7, obtido ${pmeConsolidado}`);

// Teste 3: Consolidado - PMRV
// Duplicatas total = 1.2M + 1.8M + 0.8M = 3.800.000
// Faturamento total = 12M + 18M + 8M = 38.000.000
// Venda diária = 38.000.000 / 365 = 104.109,59
// PMRV esperado = 3.800.000 / 104.109,59 = 36.5 dias
const pmrvConsolidado = res.consolidado.indices.pmrv.dias;
console.log(`✓ PMRV Consolidado calculado: ${pmrvConsolidado} dias`);
assert(Math.abs(pmrvConsolidado - 36.5) < 0.2, `PMRV esperado próximo de 36.5, obtido ${pmrvConsolidado}`);

// Teste 4: Consolidado - PMPC
// Fornecedores total = 0.9M + 1.4M + 0.7M = 3.000.000
// Compras total = 7.0M + 10.5M + 4.8M = 22.300.000
// Compras diárias = 22.300.000 / 365 = 61.095,89
// PMPC esperado = 3.000.000 / 61.095,89 = 49.1 dias
const pmpcConsolidado = res.consolidado.indices.pmpc.dias;
console.log(`✓ PMPC Consolidado calculado: ${pmpcConsolidado} dias`);
assert(Math.abs(pmpcConsolidado - 49.1) < 0.2, `PMPC esperado próximo de 49.1, obtido ${pmpcConsolidado}`);

// Teste 5: Ciclo Operacional = PME + PMRV
const coEsperado = roundDays(pmeConsolidado + pmrvConsolidado);
assert.strictEqual(res.consolidado.indices.co.dias, coEsperado, 'CO deve ser estritamente igual a PME + PMRV');
console.log(`✓ CO Consolidado calculado: ${res.consolidado.indices.co.dias} dias`);

// Teste 6: Ciclo Financeiro = CO - PMPC (Pegadinha 1 evitada!)
const cfEsperado = roundDays(coEsperado - pmpcConsolidado);
assert.strictEqual(res.consolidado.indices.cf.dias, cfEsperado, 'CF deve subtrair PMPC');
console.log(`✓ CF Consolidado calculado: ${res.consolidado.indices.cf.dias} dias`);

// Teste 7: NCG Patrimonial = (Estoque + Receber) - Pagar
// (5.000.000 + 3.800.000) - 3.000.000 = 5.800.000
assert.strictEqual(res.consolidado.indices.ncg.valorPatrimonial, 5800000, 'NCG Patrimonial calculada corretamente');
console.log(`✓ NCG Patrimonial Consolidada: R$ ${res.consolidado.indices.ncg.valorPatrimonial}`);

// Teste 8: Caso de Ciclo Financeiro Negativo (Autofinanciado por fornecedores)
const mockAutofinanciado = {
  diasPeriodo: 365,
  estoque: [{ empresa_cod: '14', custo_total: 100000 }], // PME baixo (10 dias)
  contasReceber: [{ empresa_cod: '14', saldo: 150000 }], // PMRV baixo (15 dias)
  contasPagar: [{ empresa_cod: '14', saldo: 600000 }],   // PMPC alto (60 dias)
  vendasPeriodo: [{ empresa_cod: '14', faturamento_total: 3650000 }], // 10k/dia
  cmvPeriodo: [{ empresa_cod: '14', cmv_total: 3650000 }],           // 10k/dia
  comprasPeriodo: [{ empresa_cod: '14', compras_total: 3650000 }]     // 10k/dia
};
const resAuto = calcularCicloOperacionalIndices(mockAutofinanciado);
// CO = 10 + 15 = 25 dias
// PMPC = 60 dias
// CF = 25 - 60 = -35 dias
console.log(`✓ CF Autofinanciado: ${resAuto.consolidado.indices.cf.dias} dias`);
assert(resAuto.consolidado.indices.cf.dias < 0, 'CF deve ser negativo quando prazo de fornecedor supera o ciclo operacional');
assert.strictEqual(resAuto.consolidado.indices.cf.isAutofinanciado, true, 'isAutofinanciado deve ser true');
assert.strictEqual(resAuto.consolidado.indices.ncg.valorFinanceiro, 0, 'NCG Financeira de giro deve ser 0 quando autofinanciada');

// Teste 9: Tratamento de divisão por zero (sem dados)
const mockVazio = { diasPeriodo: 365 };
const resVazio = calcularCicloOperacionalIndices(mockVazio);
assert.strictEqual(resVazio.consolidado.indices.pme.dias, 0);
assert.strictEqual(resVazio.consolidado.indices.pmrv.dias, 0);
assert.strictEqual(resVazio.consolidado.indices.pmpc.dias, 0);
assert.strictEqual(resVazio.consolidado.indices.co.dias, 0);
assert.strictEqual(resVazio.consolidado.indices.cf.dias, 0);
console.log('✓ Tratamento de divisão por zero seguro validado com sucesso');

console.log('🎉 TODOS OS TESTES DO MOTOR DE CICLO OPERACIONAL FORAM APROVADOS COM SUCESSO!');
