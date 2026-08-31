/**
 * test_bi_indices.js
 * Suíte Completa de Testes Automatizados para o Módulo de Índices Financeiros de Liquidez
 * BI Executivo — Plataforma de Apoio GSI (Gemini-Cli)
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');

const {
  calcularIndicesLiquidez,
  obterDetalhesIndicesDrilldown,
  roundVal,
  roundIndex,
  calcularDiasVencido
} = require('./bi_indices_engine');

const JWT_SECRET = process.env.JWT_SECRET || 'gsi_portal_jwt_secret_key_prod_2026_x89a';

function generateToken(payload, secret = JWT_SECRET) {
  return jwt.sign(payload, secret, { expiresIn: '1h' });
}

function makeRequest(server, options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      method: options.method || 'GET',
      path: options.path,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch {
          json = data;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: json
        });
      });
    });

    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

let passed = 0;
let failed = 0;

function runSyncAssertion(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}:`, err.message);
    failed++;
  }
}

async function runAsyncAssertion(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}:`, err.message);
    failed++;
  }
}

async function runAllTests() {
  console.log('🧪 ========================================================');
  console.log('🧪 INICIANDO SUÍTE DE TESTES: ÍNDICES FINANCEIROS DE LIQUIDEZ');
  console.log('🧪 ========================================================\n');

  // --- BLOCO 1: TESTES UNITÁRIOS DE FÓRMULAS & MATEMÁTICA ---
  console.log('📦 [BLOCO 1] Validação Matemática dos Índices (LC, LS, LI)...');

  runSyncAssertion('Arredondamento Monetário e de Índices', () => {
    assert.strictEqual(roundVal(1234.5678), 1234.57);
    assert.strictEqual(roundVal(0), 0);
    assert.strictEqual(roundIndex(2.739123), 2.7391);
  });

  runSyncAssertion('Cálculo de Dias Vencidos', () => {
    // Data futura não deve retornar dias vencidos
    const hoje = new Date();
    const amanha = new Date(hoje.getTime() + 24 * 60 * 60 * 1000);
    const amanhaYmd = amanha.toISOString().slice(0, 10).replace(/-/g, '');
    assert.strictEqual(calcularDiasVencido(amanhaYmd), 0);

    // Data de 10 dias atrás deve retornar 10 dias
    const dezDiasAtras = new Date(hoje.getTime() - 10 * 24 * 60 * 60 * 1000);
    const dezDiasYmd = dezDiasAtras.toISOString().slice(0, 10).replace(/-/g, '');
    assert.strictEqual(calcularDiasVencido(dezDiasYmd), 10);
  });

  runSyncAssertion('Cálculo dos 3 Índices com Dados Sintéticos Controlados', () => {
    const mockData = {
      saldosBancarios: [
        { empresa_cod: '14', saldo_atual: 100000 },
        { empresa_cod: '15', saldo_atual: 50000 },
        { empresa_cod: '16', saldo_atual: 150000 }
      ],
      contasReceber: [
        { empresa_cod: '14', saldo: 80000, valido_indice: true },
        { empresa_cod: '14', saldo: 20000, valido_indice: false }, // Inadimplente >5d
        { empresa_cod: '15', saldo: 30000, valido_indice: true },
        { empresa_cod: '16', saldo: 70000, valido_indice: true }
      ],
      contasPagar: [
        { empresa_cod: '14', saldo: 50000, is_provisorio: false },
        { empresa_cod: '14', saldo: 10000, is_provisorio: true }, // PR
        { empresa_cod: '15', saldo: 40000, is_provisorio: false },
        { empresa_cod: '16', saldo: 60000, is_provisorio: false }
      ],
      estoque: [
        { empresa_cod: '14', custo_total: 120000, valor_total_venda: 250000 },
        { empresa_cod: '15', custo_total: 60000, valor_total_venda: 140000 },
        { empresa_cod: '16', custo_total: 80000, valor_total_venda: 180000 }
      ]
    };

    const res = calcularIndicesLiquidez(mockData);
    assert.ok(res.consolidado, 'Deve conter nó consolidado');
    assert.ok(res.porEmpresa['14'], 'Deve conter nó da Empresa 14');
    assert.ok(res.porEmpresa['15'], 'Deve conter nó da Empresa 15');
    assert.ok(res.porEmpresa['16'], 'Deve conter nó da Empresa 16');

    // Teste Empresa 14:
    // Estoque: 120.000
    // Bancos: 100.000
    // Receber Válido: 80.000 (exclui 20.000)
    // Ativo Circulante (14) = 120.000 + 100.000 + 80.000 = 300.000
    // Passivo Circulante (14) = 50.000 + 10.000 (PR) = 60.000
    // LC (14) = 300.000 / 60.000 = 5.0
    // LS (14) = (100.000 + 80.000) / 60.000 = 180.000 / 60.000 = 3.0
    // LI (14) = 100.000 / 60.000 = 1.6667
    const e14 = res.porEmpresa['14'];
    assert.strictEqual(e14.ativoCirculante, 300000);
    assert.strictEqual(e14.passivoCirculante, 60000);
    assert.strictEqual(e14.liquidezCorrente, 5);
    assert.strictEqual(e14.liquidezSeca, 3);
    assert.strictEqual(e14.liquidezImediata, 1.6667);

    // Teste Consolidado:
    // Estoque Total: 120k + 60k + 80k = 260k
    // Bancos Total: 100k + 50k + 150k = 300k
    // Receber Válido Total: 80k + 30k + 70k = 180k
    // Ativo Circulante Consolidado = 260k + 300k + 180k = 740.000
    // Passivo Consolidado = 60k + 40k + 60k = 160.000
    // LC Consolidado = 740.000 / 160.000 = 4.625
    // LS Consolidado = 480.000 / 160.000 = 3.0
    // LI Consolidado = 300.000 / 160.000 = 1.875
    const cons = res.consolidado;
    assert.strictEqual(cons.ativoCirculante, 740000);
    assert.strictEqual(cons.passivoCirculante, 160000);
    assert.strictEqual(cons.liquidezCorrente, 4.625);
    assert.strictEqual(cons.liquidezSeca, 3);
    assert.strictEqual(cons.liquidezImediata, 1.875);
  });

  runSyncAssertion('Tratamento de Divisão por Zero (Passivo Circulante = 0)', () => {
    const semPassivo = {
      saldosBancarios: [{ empresa_cod: '14', saldo_atual: 50000 }],
      contasReceber: [{ empresa_cod: '14', saldo: 20000, valido_indice: true }],
      contasPagar: [],
      estoque: [{ empresa_cod: '14', custo_total: 30000 }]
    };
    const res = calcularIndicesLiquidez(semPassivo);
    assert.strictEqual(res.consolidado.passivoCirculante, 0);
    assert.strictEqual(res.consolidado.liquidezCorrente, 0);
    assert.strictEqual(res.consolidado.liquidezSeca, 0);
    assert.strictEqual(res.consolidado.liquidezImediata, 0);
  });

  // --- BLOCO 2: TESTES DE ARQUIVOS E ARQUITETURA DDL ---
  console.log('\n📁 [BLOCO 2] Validação de Arquivos DDL e Frontend...');

  runSyncAssertion('Existência do Script SQL 06_tabelas_indices_liquidez.sql', () => {
    const sqlPath = path.join(__dirname, 'sql', 'bi', '06_tabelas_indices_liquidez.sql');
    assert.ok(fs.existsSync(sqlPath), 'Arquivo SQL de migração deve existir');
    const content = fs.readFileSync(sqlPath, 'utf-8');
    assert.ok(content.includes('CREATE TABLE IF NOT EXISTS estoque'), 'Deve conter DDL de estoque');
    assert.ok(content.includes('CREATE TABLE IF NOT EXISTS contas_a_receber'), 'Deve conter DDL de contas_a_receber');
    assert.ok(content.includes('CREATE TABLE IF NOT EXISTS contas_a_pagar'), 'Deve conter DDL de contas_a_pagar');
    assert.ok(content.includes('CREATE TABLE IF NOT EXISTS saldos_bancarios'), 'Deve conter DDL de saldos_bancarios');
    assert.ok(content.includes('CREATE OR REPLACE VIEW vw_bi_indices_liquidez'), 'Deve conter view analítica');
  });

  runSyncAssertion('Existência do Script Frontend bi_indices.js', () => {
    const jsPath = path.join(__dirname, 'public', 'js', 'bi_indices.js');
    assert.ok(fs.existsSync(jsPath), 'Arquivo JS frontend deve existir');
    const content = fs.readFileSync(jsPath, 'utf-8');
    assert.ok(content.includes('window.initBIIndicesTab'), 'Deve exportar initBIIndicesTab');
    assert.ok(content.includes('renderizarIndicesDashboard'), 'Deve conter função de renderização');
    assert.ok(content.includes('abrirModalIndicesDrilldown'), 'Deve conter modal de drilldown');
  });

  runSyncAssertion('Estrutura de Sub-abas e Modal em index.html', () => {
    const htmlPath = path.join(__dirname, 'public', 'index.html');
    assert.ok(fs.existsSync(htmlPath), 'index.html deve existir');
    const html = fs.readFileSync(htmlPath, 'utf-8');
    assert.ok(html.includes('id="subGroupBi"'), 'Deve conter subGroupBi no subTabsContainer');
    assert.ok(html.includes('id="tab-bi-indices"'), 'Deve conter sub-aba tab-bi-indices');
    assert.ok(html.includes('id="tab-bi-metabase"'), 'Deve conter sub-aba tab-bi-metabase');
    assert.ok(html.includes('id="modalIndicesDrilldown"'), 'Deve conter modal de drilldown dos índices');
    assert.ok(html.includes('src="js/bi_indices.js'), 'Deve carregar script bi_indices.js');
  });

  // --- BLOCO 3: TESTES DE SEGURANÇA RBAC & ENDPOINTS HTTP ---
  console.log('\n🌐 [BLOCO 3] Validação de Segurança RBAC e Endpoints HTTP...');

  const app = require('./server');
  const server = http.createServer(app);

  await new Promise(resolve => server.listen(0, resolve));

  const adminToken = generateToken({ username: 'alexandre', name: 'Alexandre Admin', role: 'admin', permissions: ['bi'] });
  const vendedorToken = generateToken({ username: 'juliana', name: 'Juliana Vendedora', role: 'vendedor', permissions: ['vendedores'] });
  const userToken = generateToken({ username: 'erica', name: 'Erica Operador', role: 'user', permissions: ['logistica'] });

  try {
    await runAsyncAssertion('GET /api/bi/indices sem token retorna 401 Unauthorized', async () => {
      const res = await makeRequest(server, { path: '/api/bi/indices' });
      assert.strictEqual(res.statusCode, 401);
    });

    await runAsyncAssertion('GET /api/bi/indices com perfil Vendedor retorna 403 Forbidden', async () => {
      const res = await makeRequest(server, {
        path: '/api/bi/indices',
        headers: { 'Authorization': `Bearer ${vendedorToken}` }
      });
      assert.strictEqual(res.statusCode, 403);
    });

    await runAsyncAssertion('GET /api/bi/indices com perfil User retorna 403 Forbidden', async () => {
      const res = await makeRequest(server, {
        path: '/api/bi/indices',
        headers: { 'Authorization': `Bearer ${userToken}` }
      });
      assert.strictEqual(res.statusCode, 403);
    });

    await runAsyncAssertion('GET /api/bi/indices com perfil Admin retorna 200 OK com métricas', async () => {
      const res = await makeRequest(server, {
        path: '/api/bi/indices',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.metricas, 'Deve conter objeto de métricas');
      assert.ok(res.body.metricas.consolidado, 'Deve conter métricas consolidadas');
      assert.ok(typeof res.body.metricas.consolidado.liquidezCorrente === 'number');
      assert.ok(typeof res.body.metricas.consolidado.liquidezSeca === 'number');
      assert.ok(typeof res.body.metricas.consolidado.liquidezImediata === 'number');
    });

    await runAsyncAssertion('GET /api/bi/indices/drilldown?tipo=bancos retorna 200 OK com lista de contas', async () => {
      const res = await makeRequest(server, {
        path: '/api/bi/indices/drilldown?tipo=bancos&empresa=ALL',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.tipo, 'bancos');
      assert.ok(Array.isArray(res.body.itens), 'Deve retornar array de itens');
    });

    await runAsyncAssertion('GET /api/bi/indices/drilldown?tipo=receber retorna 200 OK com títulos', async () => {
      const res = await makeRequest(server, {
        path: '/api/bi/indices/drilldown?tipo=receber&empresa=14',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.tipo, 'receber');
      assert.ok(Array.isArray(res.body.itens));
    });

    await runAsyncAssertion('GET /api/bi/indices/drilldown?tipo=pagar retorna 200 OK com títulos', async () => {
      const res = await makeRequest(server, {
        path: '/api/bi/indices/drilldown?tipo=pagar&empresa=15',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.tipo, 'pagar');
      assert.ok(Array.isArray(res.body.itens));
    });

    await runAsyncAssertion('GET /api/bi/indices/drilldown?tipo=estoque retorna 200 OK com produtos', async () => {
      const res = await makeRequest(server, {
        path: '/api/bi/indices/drilldown?tipo=estoque&empresa=16',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.tipo, 'estoque');
      assert.ok(Array.isArray(res.body.itens));
    });

    await runAsyncAssertion('GET /api/bi/indices/historico com Admin retorna 200 OK com array de histórico', async () => {
      const res = await makeRequest(server, {
        path: '/api/bi/indices/historico?empresa=ALL&dias=30',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.historico), 'Deve retornar array de histórico');
    });

    await runAsyncAssertion('POST /api/bi/indices/sync com Admin dispara sincronização Protheus', async () => {
      const res = await makeRequest(server, {
        path: '/api/bi/indices/sync',
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      // Pode responder 200 OK com dados sincronizados ou 429 se já executou recentemente
      assert.ok(res.statusCode === 200 || res.statusCode === 429, `Esperado 200 ou 429 (recebido: ${res.statusCode})`);
    });

  } finally {
    server.close();
  }

  // --- RELATÓRIO FINAL ---
  console.log('\n========================================================');
  console.log(`📊 RESULTADO DA SUÍTE DE TESTES: ${passed} APROVADOS | ${failed} FALHAS`);
  console.log('========================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runAllTests().catch(err => {
    console.error('❌ Erro fatal na execução dos testes:', err);
    process.exit(1);
  });
}

module.exports = { runAllTests };
