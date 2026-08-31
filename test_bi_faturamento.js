/**
 * test_bi_faturamento.js
 * Suíte de Testes Automatizados para o Módulo de BI Executivo:
 * Faturamento Mês a Mês & Vendas por Grupo de Produto
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');

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
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
    failed++;
  }
}

async function runAsyncAssertion(name, fn) {
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
    failed++;
  }
}

async function runAllTests() {
  console.log('\n======================================================');
  console.log('🧪 SUÍTE DE TESTES: BI FATURAMENTO & VENDAS POR GRUPO');
  console.log('======================================================\n');

  const protheusDb = require('./protheus_db');
  const postgresDb = require('./postgres_db');

  // --- 1. Testes Unitários de Mapeamento de Grupos do Protheus ---
  console.log('🔹 1. Validação de Mapeamento dos 33 Grupos de Produtos (SBM010)');

  runSyncAssertion('Mapeia Grupo 001 para "001 - Cofres"', () => {
    assert.strictEqual(protheusDb.getGrupoDescricao('001'), '001 - Cofres');
    assert.strictEqual(protheusDb.getGrupoDescricao('1'), '001 - Cofres');
    assert.strictEqual(protheusDb.getGrupoDescricao('0001'), '001 - Cofres');
  });

  runSyncAssertion('Mapeia Grupo 002 para "002 - Fragmentadoras"', () => {
    assert.strictEqual(protheusDb.getGrupoDescricao('002'), '002 - Fragmentadoras');
    assert.strictEqual(protheusDb.getGrupoDescricao('2'), '002 - Fragmentadoras');
  });

  runSyncAssertion('Mapeia Grupo 010 para "010 - Plastificação"', () => {
    assert.strictEqual(protheusDb.getGrupoDescricao('010'), '010 - Plastificação');
    assert.strictEqual(protheusDb.getGrupoDescricao('10'), '010 - Plastificação');
  });

  runSyncAssertion('Mapeia Grupo 018 para "018 - Mobiliário / Armários"', () => {
    assert.strictEqual(protheusDb.getGrupoDescricao('018'), '018 - Mobiliário / Armários');
    assert.strictEqual(protheusDb.getGrupoDescricao('18'), '018 - Mobiliário / Armários');
  });

  runSyncAssertion('Fallback gracioso para códigos desconhecidos ou vazios', () => {
    assert.strictEqual(protheusDb.getGrupoDescricao(''), 'Outros / Sem Grupo');
    assert.strictEqual(protheusDb.getGrupoDescricao(null), 'Outros / Sem Grupo');
    assert.strictEqual(protheusDb.getGrupoDescricao('999'), 'Grupo 999');
  });

  // --- 2. Testes de Persistência e Estatísticas no Postgres/JSON ---
  console.log('\n🔹 2. Validação de Persistência e Cálculo de Estatísticas');

  await runAsyncAssertion('Grava e recupera faturamento no banco ou cache JSON local', async () => {
    const mockItens = [
      {
        empresa_cod: '14',
        empresa_sigla: 'MP',
        nota_doc: '000100',
        nota_serie: '1',
        item_num: '01',
        pedido_venda: '001234',
        cliente_cod: 'CLI001',
        cliente_nome: 'EMPRESA TESTE LTDA',
        vendedor_cod: '000004',
        vendedor_nome: 'Figueiredo',
        produto_cod: '001000000000001',
        produto_descricao: 'COFRE DIGITAL 30X30',
        grupo_cod: '001',
        grupo_descricao: '001 - Cofres',
        quantidade: 2,
        preco_unitario: 1500.00,
        valor_total_item: 3000.00,
        valor_total_nota: 3000.00,
        cfop: '5102',
        tipo_nota: 'N',
        data_emissao: '2026-01-15',
        mes_ano: '2026-01'
      },
      {
        empresa_cod: '15',
        empresa_sigla: 'GSI',
        nota_doc: '000200',
        nota_serie: '1',
        item_num: '01',
        pedido_venda: '001235',
        cliente_cod: 'CLI002',
        cliente_nome: 'COMERCIO TESTE SA',
        vendedor_cod: '000064',
        vendedor_nome: 'Andrea',
        produto_cod: '002000000000001',
        produto_descricao: 'FRAGMENTADORA DE PAPEL',
        grupo_cod: '002',
        grupo_descricao: '002 - Fragmentadoras',
        quantidade: 1,
        preco_unitario: 2200.00,
        valor_total_item: 2200.00,
        valor_total_nota: 2200.00,
        cfop: '5102',
        tipo_nota: 'N',
        data_emissao: '2026-02-10',
        mes_ano: '2026-02'
      }
    ];

    const result = await postgresDb.saveFaturamentoHistoricoDB(mockItens, {
      status: 'SUCCESS',
      duracao_ms: 150,
      triggered_by: 'TEST'
    });

    assert.strictEqual(result.totalItens, 2, 'Total de itens salvos incorreto');
    assert.strictEqual(result.totalValor, 5200.00, 'Total de valor salvo incorreto');

    const stats = await postgresDb.getFaturamentoHistoricoStats();
    assert.ok(stats, 'Stats de faturamento não retornados');
    assert.ok(stats.total_itens >= 2, 'Total de itens nos stats deve ser >= 2');
    assert.ok(stats.total_faturado >= 5200.00, 'Total faturado nos stats deve ser >= 5200');
  });

  // --- 3. Testes de Integridade do Arquivo SQL DDL ---
  console.log('\n🔹 3. Validação do Script DDL e Views de BI');

  runSyncAssertion('Script 05_tabela_e_views_faturamento.sql existe e define as 3 views e RLS', () => {
    const sqlPath = path.join(__dirname, 'sql', 'bi', '05_tabela_e_views_faturamento.sql');
    assert.ok(fs.existsSync(sqlPath), 'Arquivo SQL 05_tabela_e_views_faturamento.sql deve existir');
    const content = fs.readFileSync(sqlPath, 'utf-8');

    assert.ok(content.includes('CREATE TABLE IF NOT EXISTS faturamento_itens_historico'), 'Falta CREATE TABLE faturamento_itens_historico');
    assert.ok(content.includes('vw_bi_faturamento_mensal'), 'Falta view vw_bi_faturamento_mensal');
    assert.ok(content.includes('vw_bi_faturamento_grupo_mes'), 'Falta view vw_bi_faturamento_grupo_mes');
    assert.ok(content.includes('vw_bi_faturamento_vendedor_mes'), 'Falta view vw_bi_faturamento_vendedor_mes');
    assert.ok(content.includes('ENABLE ROW LEVEL SECURITY'), 'Falta ENABLE ROW LEVEL SECURITY');
    assert.ok(content.includes('uq_faturamento_item'), 'Falta constraint uq_faturamento_item');
  });

  // --- 4. Testes de Endpoints HTTP e Segurança RBAC ---
  console.log('\n🔹 4. Validação de Endpoints HTTP e Segurança RBAC');

  const server = http.createServer(require('./server'));
  await new Promise(r => server.listen(0, '127.0.0.1', r));

  const adminToken = generateToken({ username: 'alexandre', role: 'admin', name: 'Alexandre' });
  const userToken = generateToken({ username: 'erica', role: 'user', name: 'Érica' });
  const vendorToken = generateToken({ username: 'juliana', role: 'vendedor', vendorCode: '000074', name: 'Juliana' });

  await runAsyncAssertion('POST /api/bi/sync-faturamento sem token é bloqueado com 401 Unauthorized', async () => {
    const res = await makeRequest(server, {
      method: 'POST',
      path: '/api/bi/sync-faturamento'
    }, {});
    assert.strictEqual(res.statusCode, 401, 'Deveria retornar 401 Unauthorized');
  });

  await runAsyncAssertion('POST /api/bi/sync-faturamento com perfil Vendedor é bloqueado com 403 Forbidden', async () => {
    const res = await makeRequest(server, {
      method: 'POST',
      path: '/api/bi/sync-faturamento',
      headers: { 'Authorization': `Bearer ${vendorToken}` }
    }, {});
    assert.strictEqual(res.statusCode, 403, 'Deveria retornar 403 Forbidden');
  });

  await runAsyncAssertion('POST /api/bi/sync-faturamento com perfil User Comum é bloqueado com 403 Forbidden', async () => {
    const res = await makeRequest(server, {
      method: 'POST',
      path: '/api/bi/sync-faturamento',
      headers: { 'Authorization': `Bearer ${userToken}` }
    }, {});
    assert.strictEqual(res.statusCode, 403, 'Deveria retornar 403 Forbidden');
  });

  await runAsyncAssertion('GET /api/bi/faturamento-stats com perfil Admin retorna 200 OK e dados de faturamento', async () => {
    const res = await makeRequest(server, {
      method: 'GET',
      path: '/api/bi/faturamento-stats',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(res.statusCode, 200, 'Deveria retornar 200 OK');
    assert.strictEqual(res.body.success, true, 'Resposta success deve ser true');
    assert.ok(res.body.stats !== undefined, 'Deveria conter objeto stats');
  });

  server.close();

  console.log('\n======================================================');
  console.log(`📊 RESULTADO FINAL: ${passed} PASSOU | ${failed} FALHOU`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error('❌ Erro fatal na suíte de testes:', err);
  process.exit(1);
});
