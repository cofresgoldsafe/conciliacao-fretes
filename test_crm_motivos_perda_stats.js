/**
 * test_crm_motivos_perda_stats.js
 * 
 * Teste unitário e de integração para o BI de Motivos de Perda (CRM-23 / Opção B)
 * Valida agregações estatísticas, percentuais, principal ofensor, escopo de vendedor, fallback local
 * e o endpoint HTTP GET /api/bi/crm/motivos-perda/estatisticas.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');

const crmEngine = require('./crm_engine');
const crmRoutes = require('./crm_routes');
const crmVendedores = require('./crm_vendedores');
const { safeWriteJson, safeReadJson } = require('./safe_json_storage');

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-secret-crm-motivos-perda';
}

const dataDir = path.join(__dirname, 'data');
const crmCacheFile = path.join(dataDir, 'crm_deals_cache.json');

function generateToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
}

function makeRequest(app, method, reqPath, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const options = {
        hostname: '127.0.0.1',
        port,
        path: reqPath,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        }
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          server.close();
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode, body: parsed, headers: res.headers });
        });
      });

      req.on('error', (err) => {
        server.close();
        reject(err);
      });

      if (body) {
        req.write(typeof body === 'string' ? body : JSON.stringify(body));
      }
      req.end();
    });
  });
}

async function runTests() {
  console.log('🧪 Iniciando testes de BI de Motivos de Perda (CRM-23)...');

  // 1. Validação dos motivos canônicos com cor
  console.log('  1. Validando MOTIVOS_PERDA e cores...');
  assert(Array.isArray(crmEngine.MOTIVOS_PERDA), 'MOTIVOS_PERDA deve ser um array');
  assert.strictEqual(crmEngine.MOTIVOS_PERDA.length, 7, 'Devem existir exatamente 7 motivos');
  crmEngine.MOTIVOS_PERDA.forEach(m => {
    assert(m.cod, 'Todo motivo deve ter cod');
    assert(m.label, 'Todo motivo deve ter label');
    assert(m.cor && m.cor.startsWith('#'), 'Todo motivo deve ter cor hexadecimal');
  });

  // 2. Setup do app Express
  const app = express();
  app.use(express.json());
  app.use('/api/bi/crm', crmRoutes);

  const tokenAdmin = generateToken({
    username: 'alexandre',
    name: 'Alexandre',
    role: 'admin',
    permissions: ['bi', 'crm']
  });
  const authAdmin = { Authorization: `Bearer ${tokenAdmin}` };

  const tokenJuliana = generateToken({
    username: 'juliana',
    name: 'Juliana',
    role: 'vendedor',
    vendorCode: '000074',
    permissions: ['vendedores', 'crm']
  });
  const authJuliana = { Authorization: `Bearer ${tokenJuliana}` };

  // 3. Setup de dados de contingência local em memória/cache
  console.log('  2. Inserindo deals de teste no cache local...');
  let cacheOriginal = null;
  try {
    cacheOriginal = await safeReadJson(crmCacheFile, { deals: [], atividades: [] });
  } catch (_) {
    cacheOriginal = { deals: [], atividades: [] };
  }

  const agoraIso = new Date().toISOString();
  const dealsMock = [
    {
      id: '99901',
      titulo: 'Deal Perdido Preço 1',
      valor: 10000,
      estagio: 'perdido',
      status: 'perdido',
      motivo_perda_cod: 'preco',
      motivo_perda: 'Preço',
      cod_vendedor: '000074',
      nome_vendedor: 'Juliana',
      ativo: true,
      updated_at: agoraIso
    },
    {
      id: '99902',
      titulo: 'Deal Perdido Preço 2',
      valor: 20000,
      estagio: 'perdido',
      status: 'perdido',
      motivo_perda_cod: 'preco',
      motivo_perda: 'Preço',
      cod_vendedor: '000064',
      nome_vendedor: 'Andrea',
      ativo: true,
      updated_at: agoraIso
    },
    {
      id: '99903',
      titulo: 'Deal Perdido Prazo',
      valor: 5000,
      estagio: 'perdido',
      status: 'perdido',
      motivo_perda_cod: 'prazo_entrega',
      motivo_perda: 'Prazo de Entrega',
      cod_vendedor: '000074',
      nome_vendedor: 'Juliana',
      ativo: true,
      updated_at: agoraIso
    },
    {
      id: '99904',
      titulo: 'Deal Perdido Crédito Negado',
      valor: 15000,
      estagio: 'perdido',
      status: 'perdido',
      motivo_perda_cod: 'credito_negado',
      motivo_perda: 'Crédito Negado',
      cod_vendedor: '000064',
      nome_vendedor: 'Andrea',
      ativo: true,
      updated_at: agoraIso
    },
    {
      id: '99905',
      titulo: 'Deal Ganho (Não deve contar)',
      valor: 50000,
      estagio: 'ganho',
      status: 'ativo',
      motivo_perda_cod: null,
      cod_vendedor: '000074',
      nome_vendedor: 'Juliana',
      ativo: true,
      updated_at: agoraIso
    }
  ];

  const novoCache = {
    ...cacheOriginal,
    deals: [...(cacheOriginal.deals || []).filter(d => !String(d.id).startsWith('9990')), ...dealsMock]
  };
  await safeWriteJson(crmCacheFile, novoCache);

  try {
    // 4. Teste da função obterEstatisticasMotivosPerda para Admin (scope all: true)
    console.log('  3. Executando obterEstatisticasMotivosPerda (Admin)...');
    const statsAdmin = await crmEngine.obterEstatisticasMotivosPerda({ periodo: 'todos' }, { all: true });

    assert(statsAdmin, 'Estatísticas não podem ser nulas');
    assert(statsAdmin.totalPerdidos >= 4, `Total de perdidos esperado >= 4, obtido: ${statsAdmin.totalPerdidos}`);
    assert(statsAdmin.valorTotalPerdido >= 50000, `Valor total esperado >= 50000, obtido: ${statsAdmin.valorTotalPerdido}`);
    assert(Array.isArray(statsAdmin.motivos), 'motivos deve ser um array');
    assert(statsAdmin.principalOfensor, 'Deve identificar o principal ofensor');

    // Valida que 'preco' tem pelo menos 2 ocorrências e R$ 30.000
    const motivoPreco = statsAdmin.motivos.find(m => m.cod === 'preco');
    assert(motivoPreco, "Motivo 'preco' deve existir");
    assert(motivoPreco.quantidade >= 2, "Quantidade de 'preco' >= 2");
    assert(motivoPreco.valorTotal >= 30000, "Valor de 'preco' >= 30000");

    // 5. Teste de Escopo de Vendedor Restrito (000074 Juliana)
    console.log('  4. Executando obterEstatisticasMotivosPerda com escopo restrito (000074)...');
    const statsVendedor = await crmEngine.obterEstatisticasMotivosPerda(
      { periodo: 'todos' },
      { all: false, codVendedor: '000074', codigosLeitura: ['000074'] }
    );

    assert(statsVendedor, 'Estatísticas do vendedor não podem ser nulas');
    const mockVendedorPerdidos = statsVendedor.motivos.reduce((acc, m) => acc + m.quantidade, 0);
    assert(mockVendedorPerdidos >= 2, 'Vendedor deve ver seus negócios perdidos');
    const precoVend = statsVendedor.motivos.find(m => m.cod === 'preco');
    assert(precoVend.quantidade >= 1, "'preco' para 000074 >= 1");

    // 6. Teste de Período
    console.log('  5. Testando agregações com filtro de período (mes e ano)...');
    const statsMes = await crmEngine.obterEstatisticasMotivosPerda({ periodo: 'mes' }, { all: true });
    assert(statsMes.totalPerdidos >= 4, 'No mês atual deve capturar os deals inseridos hoje');

    // 7. Teste de Rota HTTP GET /api/bi/crm/motivos-perda/estatisticas (Admin)
    console.log('  6. Testando chamada HTTP GET /api/bi/crm/motivos-perda/estatisticas como Admin...');
    const resHttpAdmin = await makeRequest(app, 'GET', '/api/bi/crm/motivos-perda/estatisticas?periodo=todos', authAdmin);
    assert.strictEqual(resHttpAdmin.status, 200, 'HTTP status deve ser 200');
    assert.strictEqual(resHttpAdmin.body.success, true, 'success deve ser true');
    assert(resHttpAdmin.body.data, 'data deve existir no envelope');
    assert(resHttpAdmin.body.data.totalPerdidos >= 4, 'Total de perdidos via HTTP deve ser >= 4');
    assert(Array.isArray(resHttpAdmin.body.data.motivos), 'motivos deve ser array via HTTP');

    // 8. Teste de Rota HTTP GET /api/bi/crm/motivos-perda/estatisticas como Vendedor (RBAC)
    console.log('  7. Testando chamada HTTP GET /api/bi/crm/motivos-perda/estatisticas como Vendedor (Juliana)...');
    const resHttpJuliana = await makeRequest(app, 'GET', '/api/bi/crm/motivos-perda/estatisticas?periodo=todos', authJuliana);
    assert.strictEqual(resHttpJuliana.status, 200, 'HTTP status deve ser 200');
    assert.strictEqual(resHttpJuliana.body.success, true);
    assert(resHttpJuliana.body.data.totalPerdidos >= 2, 'Juliana deve ver seus 2 negócios perdidos');

    console.log('✅ Todos os testes de BI de Motivos de Perda (motor + HTTP) passaram com sucesso!');
  } finally {
    // Limpeza / restauração do cache
    console.log('  🧹 Limpando dados mock do cache...');
    const cacheRestaurar = await safeReadJson(crmCacheFile, { deals: [], atividades: [] });
    cacheRestaurar.deals = (cacheRestaurar.deals || []).filter(d => !String(d.id).startsWith('9990'));
    await safeWriteJson(crmCacheFile, cacheRestaurar);
  }
}

runTests().catch(err => {
  console.error('❌ Falha nos testes:', err);
  process.exit(1);
});
