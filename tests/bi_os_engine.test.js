/**
 * tests/bi_os_engine.test.js
 * Testes automatizados unitários e de integração do módulo BI OS (Protheus SE1150 + Supabase Assistência)
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildMonthWindow,
  classifyAndDeduplicateOs,
  aggregateProtheus24m,
  aggregateSupabase20m,
  getDashboardData,
  getTitulosPaginados
} = require('../bi_os_engine');

test('1. buildMonthWindow gera janelas contínuas de 24 e 20 meses em ordem cronológica', () => {
  const refDate = new Date(2026, 9, 16); // Outubro/2026
  const win24 = buildMonthWindow(24, refDate);
  const win20 = buildMonthWindow(20, refDate);

  assert.equal(win24.length, 24);
  assert.equal(win24[0].mesAno, '2024-11');
  assert.equal(win24[0].label, 'Nov/24');
  assert.equal(win24[23].mesAno, '2026-10');
  assert.equal(win24[23].label, 'Out/26');

  assert.equal(win20.length, 20);
  assert.equal(win20[0].mesAno, '2025-03');
  assert.equal(win20[0].label, 'Mar/25');
  assert.equal(win20[19].mesAno, '2026-10');
  assert.equal(win20[19].label, 'Out/26');
});

test('2. classifyAndDeduplicateOs exclui OS fantasmas (1485..1501), deduplica e classifica Padrão vs Garantia', () => {
  const sample = [
    { id: '1', numero_os: 1485, tipo_os: 'OS Padrão', status_pagamento: 'Pendente', data_entrada: '2026-08-10T10:00:00Z' },
    { id: '2', numero_os: 1501, tipo_os: 'Garantia', status_pagamento: 'Isento', data_entrada: '2026-08-11T10:00:00Z' },
    { id: '3a', numero_os: 1600, tipo_os: 'Manutenção Corretiva', status_pagamento: 'Pendente', data_entrada: '2026-09-05T10:00:00Z', updated_at: '2026-09-05T10:00:00Z' },
    { id: '3b', numero_os: 1600, tipo_os: 'Garantia', status_pagamento: 'Pendente', data_entrada: '2026-09-05T10:00:00Z', updated_at: '2026-09-06T12:00:00Z' },
    { id: '4', numero_os: 1601, tipo_os: 'Manutenção Corretiva', status_pagamento: 'Confirmado', data_entrada: '2026-10-02T10:00:00Z' },
    { id: '5', numero_os: 1602, tipo_os: 'OS Padrão', status_pagamento: 'Isento', data_entrada: '2026-10-03T10:00:00Z' }
  ];

  const clean = classifyAndDeduplicateOs(sample);
  assert.equal(clean.length, 3, 'Deve descartar 1485 e 1501 e deduplicar 1600');

  const os1600 = clean.find((o) => o.numero_os === 1600);
  assert.equal(os1600.id, '3b');
  assert.equal(os1600.isGarantia, true);
  assert.equal(os1600.tipoCanonico, 'Garantia');

  const os1601 = clean.find((o) => o.numero_os === 1601);
  assert.equal(os1601.isGarantia, false);
  assert.equal(os1601.tipoCanonico, 'OS Padrão');

  const os1602 = clean.find((o) => o.numero_os === 1602);
  assert.equal(os1602.isGarantia, true, 'status_pagamento Isento deve classificar como Garantia');
});

test('3. aggregateProtheus24m e aggregateSupabase20m calculam somas e KPIs corretamente', () => {
  const refDate = new Date(2026, 9, 16); // Outubro/2026
  const mockTitulos = [
    { E1_FILIAL: '01', E1_PREFIXO: 'OS', E1_NUM: 'OS001', E1_EMISSAO: '20260910', E1_BAIXA: '20261005', E1_VALOR: 1000, E1_VALLIQ: 1000 },
    { E1_FILIAL: '01', E1_PREFIXO: 'OS', E1_NUM: 'OS002', E1_EMISSAO: '20260915', E1_BAIXA: '20260920', E1_VALOR: 500, E1_VALLIQ: 550 }
  ];

  const aggBaixa = aggregateProtheus24m(mockTitulos, 'baixa', refDate);
  assert.equal(aggBaixa.kpisReceita.receitaTotal24m, 1550);
  assert.equal(aggBaixa.kpisReceita.qtdTitulos24m, 2);
  assert.equal(aggBaixa.kpisReceita.receitaMesAtual, 1000);
  assert.equal(aggBaixa.kpisReceita.receitaMesAnterior, 550);

  const aggEmissao = aggregateProtheus24m(mockTitulos, 'emissao', refDate);
  assert.equal(aggEmissao.kpisReceita.receitaMesAtual, 0);
  assert.equal(aggEmissao.kpisReceita.receitaMesAnterior, 1550);

  const mockOs = [
    { id: 'a', numero_os: 100, tipo_os: 'OS Padrão', status_pagamento: 'Confirmado', data_entrada: '2026-10-01T10:00:00Z' },
    { id: 'b', numero_os: 101, tipo_os: 'Garantia', status_pagamento: 'Isento', data_entrada: '2026-10-05T10:00:00Z' }
  ];
  const aggSup = aggregateSupabase20m(mockOs, refDate);
  assert.equal(aggSup.kpisOs.totalOs20m, 2);
  assert.equal(aggSup.kpisOs.totalPadrao20m, 1);
  assert.equal(aggSup.kpisOs.totalGarantia20m, 1);
  assert.equal(aggSup.kpisOs.taxaGarantiaPct, 50);
});

test('4. Integração Real: getDashboardData e getTitulosPaginados retornam dados do Protheus SE1150 e Supabase Assistência', async () => {
  const dash = await getDashboardData({ regime: 'baixa', forceSync: true });
  assert.equal(dash.success, true);
  assert.equal(dash.faturamento24m.length, 24);
  assert.equal(dash.osCriadas20m.length, 20);
  assert.ok(dash.kpis.receitaTotal24m > 0, 'Deve retornar receita > 0 da SE1150');
  assert.ok(dash.kpis.totalOs20m > 0, 'Deve retornar total de OS > 0 do Supabase Assistência');

  const pag = await getTitulosPaginados({ regime: 'baixa', page: 1, limit: 10 });
  assert.equal(pag.success, true);
  assert.ok(Array.isArray(pag.items));
  assert.ok(pag.items.length <= 10);
  assert.equal(pag.pagination.page, 1);
  assert.equal(pag.pagination.limit, 10);
  assert.ok(pag.pagination.total > 0);
});
