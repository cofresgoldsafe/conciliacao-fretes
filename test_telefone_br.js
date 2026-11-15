/**
 * ============================================================================
 * TESTES UNITÁRIOS — NORMALIZAÇÃO E VARIANTES DE TELEFONE BR (CRM-21a)
 * ============================================================================
 */

'use strict';

const assert = require('assert');
const { normalizarTelefoneBR, variantesTelefoneBR } = require('./telefone_br');

console.log('🧪 Iniciando testes de telefone_br.js...');

// 1. Testes de normalizarTelefoneBR
assert.strictEqual(
  normalizarTelefoneBR('(11) 98765-4321'),
  '5511987654321',
  '(11) 98765-4321 deve ser normalizado para 5511987654321'
);

assert.strictEqual(
  normalizarTelefoneBR('011987654321'),
  '5511987654321',
  '011987654321 deve ser normalizado para 5511987654321'
);

assert.strictEqual(
  normalizarTelefoneBR('+1 415 555 0100'),
  '14155550100',
  '+1 415 555 0100 deve ser normalizado para 14155550100'
);

assert.strictEqual(
  normalizarTelefoneBR('123'),
  null,
  '123 deve retornar null'
);

assert.strictEqual(
  normalizarTelefoneBR(''),
  null,
  'String vazia deve retornar null'
);

assert.strictEqual(
  normalizarTelefoneBR(null),
  null,
  'null deve retornar null'
);

assert.strictEqual(
  normalizarTelefoneBR(undefined),
  null,
  'undefined deve retornar null'
);

// 2. Testes de variantesTelefoneBR
assert.deepStrictEqual(
  variantesTelefoneBR('5511987654321'),
  ['5511987654321', '551187654321'],
  '5511987654321 deve gerar [5511987654321, 551187654321]'
);

assert.deepStrictEqual(
  variantesTelefoneBR('551187654321'),
  ['551187654321', '5511987654321'],
  '551187654321 deve gerar [551187654321, 5511987654321]'
);

assert.deepStrictEqual(
  variantesTelefoneBR('551133334444'),
  ['551133334444'],
  '551133334444 (fixo) deve retornar [551133334444] sem variante'
);

console.log('✅ Todos os testes de telefone_br.js passaram com sucesso!');
