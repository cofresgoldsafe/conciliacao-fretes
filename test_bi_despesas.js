/**
 * test_bi_despesas.js
 * Suíte de Testes Automatizados: Módulo de Análise de Despesas & Movimento Bancário (BI Executivo)
 * Plataforma de Apoio GSI (Gemini-Cli)
 *
 * Cobertura:
 * Bloco 1: Mapeamento Hierárquico de Naturezas Pai e Resolução SED010
 * Bloco 2: Dedução Matemática de Estornos e Cálculo de Valor Líquido
 * Bloco 3: Segregação de Transferências Internas e CDBs (2.10, TR, TE)
 * Bloco 4: Matriz Comparativa Mês a Mês Lado a Lado (2025 vs 2026)
 * Bloco 5: Envelope REST de Paginação Obrigatória (Pilar 1)
 * Bloco 6: Filtros Combinados (Empresa, Natureza Pai, Busca Textual)
 * Bloco 7: Resiliência de Armazenamento Dual e Metadados de Sync
 * Bloco 8: Integridade de Segurança RBAC e Proteção de Rotas
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  obterKpisDespesas,
  obterGraficoNaturezaPai,
  obterComparativoMesAMes,
  obterLancamentosPaginados,
  obterNaturezasPaisDisponiveis,
  obterStatusSincronizacao,
  carregarEspelhoDespesasDB
} = require('./bi_despesas_engine');

let totalTestes = 0;
let testesPassaram = 0;

function it(descricao, fn) {
  totalTestes++;
  try {
    fn();
    testesPassaram++;
    console.log(`  ✅ [PASSOU] ${descricao}`);
  } catch (err) {
    console.error(`  ❌ [FALHOU] ${descricao}`);
    console.error(`     Motivo: ${err.message}`);
  }
}

async function itAsync(descricao, fn) {
  totalTestes++;
  try {
    await fn();
    testesPassaram++;
    console.log(`  ✅ [PASSOU] ${descricao}`);
  } catch (err) {
    console.error(`  ❌ [FALHOU] ${descricao}`);
    console.error(`     Motivo: ${err.message}`);
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('🧪 SUÍTE DE TESTES: BI EXECUTIVO — ANÁLISE DE DESPESAS (SE5)');
  console.log('================================================================\n');

  // --- BLOCO 1: MAPEAMENTO HIERÁRQUICO DE NATUREZAS PAI ---
  console.log('📌 Bloco 1: Mapeamento Hierárquico de Naturezas Pai e Filhas');
  await itAsync('Deve extrair a lista de Naturezas Pai únicas disponíveis', async () => {
    const pais = await obterNaturezasPaisDisponiveis();
    assert.ok(Array.isArray(pais), 'Deve retornar um array de naturezas pai');
    assert.ok(pais.length > 0, 'Deve conter pelo menos uma natureza pai');
    const temAdm = pais.some(p => p.codigo === '2.01');
    assert.ok(temAdm, 'Deve conter o grupo 2.01 (Despesas Administração)');
  });

  // --- BLOCO 2: DEDUÇÃO MATEMÁTICA DE ESTORNOS ---
  console.log('\n📌 Bloco 2: Dedução Matemática de Estornos e Valor Líquido');
  await itAsync('Deve abater rigorosamente os estornos do valor líquido total', async () => {
    const kpis = await obterKpisDespesas();
    assert.ok(typeof kpis.totalLiquido === 'number', 'Total líquido deve ser numérico');
    assert.ok(typeof kpis.totalBruto === 'number', 'Total bruto deve ser numérico');
    assert.ok(typeof kpis.totalEstornos === 'number', 'Total estornos deve ser numérico');
    assert.ok(kpis.totalBruto >= kpis.totalLiquido, 'Total bruto deve ser maior ou igual ao líquido');
    assert.ok(kpis.totalEstornos >= 0, 'Total de estornos deve ser não-negativo');
  });

  await itAsync('Lançamentos de estorno devem possuir valor_liquido negativo', async () => {
    const dados = await carregarEspelhoDespesasDB();
    const estornos = dados.filter(d => d.is_estorno);
    assert.ok(estornos.length > 0, 'Deve haver estornos identificados na base');
    estornos.slice(0, 10).forEach(e => {
      assert.ok(e.valor_liquido < 0, `Estorno ${e.recno_se5} deve ter valor líquido negativo`);
      assert.strictEqual(e.valor_liquido, -Math.abs(e.valor_bruto), 'Valor líquido do estorno deve ser -valorBruto');
    });
  });

  // --- BLOCO 3: SEGREGAÇÃO DE TRANSFERÊNCIAS INTERNAS E CDBS ---
  console.log('\n📌 Bloco 3: Segregação de Transferências Internas e CDBs (2.10, TR, TE)');
  await itAsync('Por padrão, transferências internas (2.10, TR, TE) devem estar ocultas', async () => {
    const kpisPadrao = await obterKpisDespesas({ incluirTransferencias: false });
    const kpisComTransf = await obterKpisDespesas({ incluirTransferencias: true });
    assert.ok(kpisComTransf.totalLancamentos >= kpisPadrao.totalLancamentos, 'Com transferências deve ter mais ou igual lançamentos');
    assert.ok(kpisComTransf.totalBruto >= kpisPadrao.totalBruto, 'Com transferências deve ter maior ou igual volume bruto');
  });

  await itAsync('Lançamentos de transferência devem ter flag is_transferencia: true', async () => {
    const dados = await carregarEspelhoDespesasDB();
    const transfs = dados.filter(d => d.natureza_cod.startsWith('2.10') || d.tipo_doc === 'TR' || d.tipo_doc === 'TE');
    assert.ok(transfs.length > 0, 'Deve haver transferências identificadas');
    transfs.slice(0, 10).forEach(t => {
      assert.strictEqual(t.is_transferencia, true, `Lançamento ${t.recno_se5} deve ser marcado como transferência`);
    });
  });

  // --- BLOCO 4: MATRIZ COMPARATIVA MÊS A MÊS LADO A LADO ---
  console.log('\n📌 Bloco 4: Matriz Comparativa Mês a Mês Lado a Lado (2025 vs 2026)');
  await itAsync('Deve retornar matriz completa de 12 meses com comparação 2025 x 2026', async () => {
    const comp = await obterComparativoMesAMes();
    assert.strictEqual(comp.ano1, 2025, 'Ano 1 deve ser 2025');
    assert.strictEqual(comp.ano2, 2026, 'Ano 2 deve ser 2026');
    assert.strictEqual(comp.meses.length, 12, 'Deve conter exatamente 12 meses');

    comp.meses.forEach(m => {
      assert.ok(m.mes >= 1 && m.mes <= 12, 'Número do mês deve estar entre 1 e 12');
      assert.ok(typeof m.nomeMes === 'string', 'Nome do mês deve ser string');
      assert.ok(typeof m.valor2025 === 'number', 'valor2025 deve ser numérico');
      assert.ok(typeof m.valor2026 === 'number', 'valor2026 deve ser numérico');
      const diffEsperada = Math.round((m.valor2026 - m.valor2025) * 100) / 100;
      assert.strictEqual(m.diferenca, diffEsperada, 'Diferença deve ser exatamente valor2026 - valor2025');
    });
  });

  // --- BLOCO 5: ENVELOPE REST DE PAGINAÇÃO OBRIGATÓRIA (PILAR 1) ---
  console.log('\n📌 Bloco 5: Envelope REST de Paginação Obrigatória (Pilar 1)');
  await itAsync('Deve retornar envelope padronizado com itens e pagination', async () => {
    const res = await obterLancamentosPaginados({ page: 1, limit: 25 });
    assert.ok(Array.isArray(res.items), 'Deve conter array items');
    assert.ok(res.pagination, 'Deve conter objeto pagination');
    assert.strictEqual(res.pagination.page, 1, 'Página atual deve ser 1');
    assert.strictEqual(res.pagination.limit, 25, 'Limite deve ser 25');
    assert.ok(res.pagination.total > 0, 'Total deve ser maior que zero');
    assert.ok(res.pagination.totalPages >= 1, 'TotalPages deve ser >= 1');
    assert.ok(typeof res.pagination.hasNext === 'boolean', 'hasNext deve ser booleano');
    assert.ok(typeof res.pagination.hasPrev === 'boolean', 'hasPrev deve ser booleano');
  });

  await itAsync('Limite de paginação não deve exceder teto de segurança (100 itens)', async () => {
    const res = await obterLancamentosPaginados({ page: 1, limit: 9999 });
    assert.strictEqual(res.pagination.limit, 100, 'Limite forçado deve ser limitado a 100');
  });

  // --- BLOCO 6: FILTROS COMBINADOS ---
  console.log('\n📌 Bloco 6: Filtros Combinados (Empresa, Natureza Pai, Busca Textual)');
  await itAsync('Deve filtrar corretamente por empresa específica (ex: 14 - Metal Pleno)', async () => {
    const res = await obterLancamentosPaginados({ empresa: '14', page: 1, limit: 50 });
    assert.ok(res.items.length > 0, 'Deve retornar itens da empresa 14');
    res.items.forEach(it => {
      assert.strictEqual(it.empresa_cod, '14', 'Todos os itens devem ser da empresa 14');
    });
  });

  await itAsync('Deve filtrar corretamente por Natureza Pai', async () => {
    const res = await obterLancamentosPaginados({ naturezaPai: '2.01', page: 1, limit: 50 });
    res.items.forEach(it => {
      assert.strictEqual(it.natureza_pai_cod, '2.01', 'Item deve pertencer ao pai 2.01');
    });
  });

  await itAsync('Deve filtrar corretamente por termo de busca textual', async () => {
    const res = await obterLancamentosPaginados({ busca: 'GOOGLE', page: 1, limit: 50 });
    assert.ok(res.items.length > 0, 'Deve encontrar lançamentos com termo GOOGLE');
    res.items.forEach(it => {
      const match = (
        it.fornecedor_nome.toUpperCase().includes('GOOGLE') ||
        it.historico.toUpperCase().includes('GOOGLE')
      );
      assert.ok(match, 'Item deve conter o termo pesquisado');
    });
  });

  // --- BLOCO 7: RESILIÊNCIA E METADADOS DE SINCRONIZAÇÃO ---
  console.log('\n📌 Bloco 7: Resiliência de Armazenamento e Metadados de Sync');
  await itAsync('Arquivo de cache local bi_despesas_cache.json deve existir e conter estrutura válida', async () => {
    const cachePath = path.join(__dirname, 'data', 'bi_despesas_cache.json');
    assert.ok(fs.existsSync(cachePath), 'Arquivo de cache deve existir em data/');
    const raw = fs.readFileSync(cachePath, 'utf-8');
    const parsed = JSON.parse(raw);
    assert.ok(parsed.metadata, 'Cache deve conter metadata');
    assert.ok(Array.isArray(parsed.registros), 'Cache deve conter array de registros');
    assert.ok(parsed.registros.length > 0, 'Cache deve ter registros persistidos');
  });

  await itAsync('Status de sincronização deve retornar data/hora e total de registros', async () => {
    const status = await obterStatusSincronizacao();
    assert.ok(status.last_sync_at !== null, 'Deve conter last_sync_at');
    assert.ok(status.total_registros > 0, 'Deve conter total de registros maior que zero');
  });

  // --- BLOCO 8: INTEGRIDADE DE SEGURANÇA RBAC E ROTAS ---
  console.log('\n📌 Bloco 8: Integridade de Segurança RBAC e Arquitetura');
  it('Código de server.js deve proteger todas as rotas de despesas com requireAuth e requireRole("admin")', () => {
    const serverCode = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf-8');
    const rotas = [
      '/api/bi/despesas/kpis',
      '/api/bi/despesas/grafico-pai',
      '/api/bi/despesas/comparativo-anual',
      '/api/bi/despesas/lancamentos',
      '/api/bi/despesas/naturezas-pais',
      '/api/bi/despesas/sync-status',
      '/api/bi/despesas/sync'
    ];

    rotas.forEach(rota => {
      assert.ok(serverCode.includes(rota), `server.js deve conter a rota ${rota}`);
      // Verifica se a rota possui requireRole('admin')
      const regex = new RegExp(`app\\.(get|post)\\('${rota.replace(/\//g, '\\/')}',\\s*requireAuth,\\s*requireRole\\('admin'\\)`);
      assert.ok(regex.test(serverCode), `Rota ${rota} deve ter requireAuth e requireRole('admin')`);
    });
  });

  it('Frontend bi_despesas.js e index.html devem possuir integridade de elementos e handlers', () => {
    const htmlCode = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf-8');
    const jsCode = fs.readFileSync(path.join(__dirname, 'public', 'js', 'bi_despesas.js'), 'utf-8');
    const appCode = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf-8');

    assert.ok(htmlCode.includes('id="btnTabBiDespesas"'), 'index.html deve conter botão btnTabBiDespesas');
    assert.ok(htmlCode.includes('id="tab-bi-despesas"'), 'index.html deve conter container tab-bi-despesas');
    assert.ok(htmlCode.includes('src="js/bi_despesas.js?v='), 'index.html deve incluir script bi_despesas.js');
    assert.ok(jsCode.includes('window.initBiDespesasView'), 'bi_despesas.js deve exportar initBiDespesasView');
    assert.ok(appCode.includes('tab-bi-despesas'), 'app.js deve tratar ativação de tab-bi-despesas');
  });

  console.log('\n================================================================');
  console.log(`🏁 RESULTADO FINAL: ${testesPassaram} de ${totalTestes} testes passaram com sucesso!`);
  console.log('================================================================\n');

  if (testesPassaram === totalTestes) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Erro fatal na execução dos testes:', err);
  process.exit(1);
});
