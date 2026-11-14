/**
 * test_crm_rbac_vendedor.js
 * Suite de Testes Automatizados — CRM-19 (RBAC por Vendedor, Escopo por Proprietário e Meta Mensal)
 * Plataforma de Apoio GSI (Gemini-Cli)
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-crm19-ci';

const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const jwt = require('jsonwebtoken');

const db = require('./postgres_db');
const auditLogsCapturados = [];
const originalIsConfigured = db.isConfigured;
const originalLogUserActivity = db.logUserActivity;
const originalGetConfigMetas = db.getConfigMetasVendasDB;

// Configura stubs em postgres_db ANTES de carregar módulos que desestruturam suas funções
db.isConfigured = () => false;
db.logUserActivity = async (entry) => {
  auditLogsCapturados.push(entry);
  return true;
};
db.getConfigMetasVendasDB = async () => ({ metaBaseVendas: 120000.00 });

const crmVendedores = require('./crm_vendedores');
const crmEngine = require('./crm_engine');
const crmRoutes = require('./crm_routes');
const { normalizarRegistro } = require('./scripts/crm19_normalizar_vendedores');

const JWT_SECRET = process.env.JWT_SECRET;
const cacheFile = path.join(__dirname, 'data', 'crm_deals_cache.json');

function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
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
  console.log('🧪 Iniciando Suite de Testes CRM-19 (RBAC por Vendedor, Escopo e Meta Mensal)...\n');

  const originalCacheRaw = fs.existsSync(cacheFile) ? fs.readFileSync(cacheFile, 'utf8') : null;
  crmVendedores.invalidarCacheVendedores();
  crmVendedores.restaurarFallbackPadrao();

  try {
    const app = express();
    app.use(express.json());
    app.use('/api/bi/crm', crmRoutes);

    const tokenAlexandre = generateToken({ username: 'alexandre', name: 'Alexandre', role: 'admin', permissions: ['bi', 'crm'] });
    const tokenJuliana = generateToken({ username: 'juliana', name: 'Juliana', role: 'vendedor', vendorCode: '000074', permissions: ['vendedores', 'crm'] });
    const tokenFigueiredo = generateToken({ username: 'figueiredo', name: 'Figueiredo', role: 'vendedor', vendorCode: '000004', permissions: ['vendedores', 'crm'] });
    const tokenVendSemPerm = generateToken({ username: 'juliana', name: 'Juliana', role: 'vendedor', vendorCode: '000074', permissions: ['vendedores', 'bi-crm', 'tab-bi-crm'] });
    const tokenVendSemVinculo = generateToken({ username: 'vendedor_avulso', name: 'Vendedor Avulso', role: 'vendedor', vendorCode: '000999', permissions: ['vendedores', 'crm'] });
    const tokenOperadorUser = generateToken({ username: 'operador_fin', name: 'Operador', role: 'user', permissions: ['financeiro', 'crm'] });

    // 1. Anônimo -> 401
    console.log('1️⃣  Cenário 1: Requisição sem token retorna 401');
    const res1 = await makeRequest(app, 'GET', '/api/bi/crm/deals');
    assert.strictEqual(res1.status, 401);
    console.log('   ✅ 401 confirmado.');

    // 2. role: 'user' -> 403 FORBIDDEN_CRM
    console.log('2️⃣  Cenário 2: role="user" retorna 403 FORBIDDEN_CRM');
    const res2 = await makeRequest(app, 'GET', '/api/bi/crm/deals', { Authorization: `Bearer ${tokenOperadorUser}` });
    assert.strictEqual(res2.status, 403);
    assert.strictEqual(res2.body.error.code, 'FORBIDDEN_CRM');
    console.log('   ✅ 403 FORBIDDEN_CRM confirmado.');

    // 3. Vendedor sem permissão estrita 'crm' (mesmo com bi-crm/tab-bi-crm) -> 403 FORBIDDEN_CRM
    console.log('3️⃣  Cenário 3: Vendedor sem permissão estrita "crm" retorna 403 FORBIDDEN_CRM');
    const res3 = await makeRequest(app, 'GET', '/api/bi/crm/deals', { Authorization: `Bearer ${tokenVendSemPerm}` });
    assert.strictEqual(res3.status, 403);
    assert.strictEqual(res3.body.error.code, 'FORBIDDEN_CRM');
    console.log('   ✅ 403 FORBIDDEN_CRM confirmado.');

    // 4. Vendedor com permissão 'crm' mas sem vínculo ativo em crm_vendedores -> 403 FORBIDDEN_CRM
    console.log('4️⃣  Cenário 4: Vendedor sem vínculo em crm_vendedores retorna 403 FORBIDDEN_CRM');
    const res4 = await makeRequest(app, 'GET', '/api/bi/crm/deals', { Authorization: `Bearer ${tokenVendSemVinculo}` });
    assert.strictEqual(res4.status, 403);
    assert.strictEqual(res4.body.error.code, 'FORBIDDEN_CRM');
    console.log('   ✅ 403 FORBIDDEN_CRM confirmado (mesmo com vendorCode no JWT).');

    // Preparação de deals de Juliana (000074) e Figueiredo (000004)
    const dealJulianaResp = await makeRequest(app, 'POST', '/api/bi/crm/deals', {
      Authorization: `Bearer ${tokenJuliana}`
    }, {
      titulo: 'Deal Teste Juliana CRM-19',
      cliente_nome: 'CLIENTE JULIANA LTDA',
      cliente_cnpj: '11.222.333/0001-81',
      cod_vendedor: '000004', // Tentativa maliciosa de criar em nome de Figueiredo
      nome_vendedor: 'Figueiredo',
      estagio: 'PROPOSTA',
      valor_total: 25000
    });
    assert.strictEqual(dealJulianaResp.status, 201);
    const dealJuliana = dealJulianaResp.body.data;

    // 9. POST /deals por vendedor ignora cod_vendedor do body e grava 000074/Juliana
    console.log('5️⃣  Cenário 9: POST /deals por Juliana ignora cod_vendedor do body e força 000074 / Juliana');
    assert.strictEqual(dealJuliana.cod_vendedor, '000074');
    assert.strictEqual(dealJuliana.nome_vendedor, 'Juliana');
    console.log('   ✅ Ownership forçado no backend na criação.');

    const dealFigueiredoResp = await makeRequest(app, 'POST', '/api/bi/crm/deals', {
      Authorization: `Bearer ${tokenFigueiredo}`
    }, {
      titulo: 'Deal Teste Figueiredo CRM-19',
      cliente_nome: 'CLIENTE FIGUEIREDO S/A',
      estagio: 'NEGOCIACAO',
      valor_total: 40000
    });
    assert.strictEqual(dealFigueiredoResp.status, 201);
    const dealFigueiredo = dealFigueiredoResp.body.data;
    assert.strictEqual(dealFigueiredo.cod_vendedor, '000004');
    assert.strictEqual(dealFigueiredo.nome_vendedor, 'Figueiredo');

    // 5. GET /deals por Juliana retorna apenas deals cod_vendedor='000074', mesmo passando ?cod_vendedor=000004
    console.log('6️⃣  Cenário 5: GET /deals por Juliana ignora ?cod_vendedor=000004 e retorna só 000074');
    const res5 = await makeRequest(app, 'GET', '/api/bi/crm/deals?cod_vendedor=000004', {
      Authorization: `Bearer ${tokenJuliana}`
    });
    assert.strictEqual(res5.status, 200);
    assert.ok(res5.body.data.length >= 1);
    assert.ok(res5.body.data.every(d => d.cod_vendedor === '000074'), 'Juliana só pode receber deals 000074');
    console.log('   ✅ Escopo de listagem isolado com sucesso.');

    // 6. GET /deals por Alexandre retorna deals de todos os vendedores e respeita ?cod_vendedor=000074
    console.log('7️⃣  Cenário 6: GET /deals por Alexandre vê todos e filtra quando solicita ?cod_vendedor=000074');
    const res6All = await makeRequest(app, 'GET', '/api/bi/crm/deals', {
      Authorization: `Bearer ${tokenAlexandre}`
    });
    assert.strictEqual(res6All.status, 200);
    const codsVistosAdmin = new Set(res6All.body.data.map(d => d.cod_vendedor));
    assert.ok(codsVistosAdmin.has('000074') && codsVistosAdmin.has('000004'), 'Admin deve enxergar deals de múltiplos vendedores');

    const res6Filtered = await makeRequest(app, 'GET', '/api/bi/crm/deals?cod_vendedor=000074', {
      Authorization: `Bearer ${tokenAlexandre}`
    });
    assert.strictEqual(res6Filtered.status, 200);
    assert.ok(res6Filtered.body.data.every(d => d.cod_vendedor === '000074'), 'Admin filtrando por 000074 deve ver apenas 000074');
    console.log('   ✅ Visão global e filtro do Admin confirmados.');

    // 7. GET /deals/:id de Figueiredo chamado por Juliana -> 404 + log CRM_DEAL_ACESSO_NEGADO
    console.log('8️⃣  Cenário 7: GET /deals/:id alheio por Juliana retorna 404 e grava CRM_DEAL_ACESSO_NEGADO');
    const logsAntes = auditLogsCapturados.length;
    const res7 = await makeRequest(app, 'GET', `/api/bi/crm/deals/${dealFigueiredo.id}`, {
      Authorization: `Bearer ${tokenJuliana}`
    });
    assert.strictEqual(res7.status, 404, 'Deve retornar 404 para não revelar existência de deal alheio');
    assert.ok(auditLogsCapturados.length > logsAntes, 'Deve registrar log de auditoria');
    assert.strictEqual(auditLogsCapturados[auditLogsCapturados.length - 1].actionType, 'CRM_DEAL_ACESSO_NEGADO');
    console.log('   ✅ 404 anti-enumeração + log CRM_DEAL_ACESSO_NEGADO confirmados.');

    // 7b. GET /deals/:id próprio por Juliana -> 200 com notes_count calculado via listarAtividadesDeal
    const res7Own = await makeRequest(app, 'GET', `/api/bi/crm/deals/${dealJuliana.id}`, {
      Authorization: `Bearer ${tokenJuliana}`
    });
    assert.strictEqual(res7Own.status, 200, 'GET /deals/:id próprio deve retornar 200 sem erro 500');
    assert.strictEqual(typeof res7Own.body.data.notes_count, 'number', 'Deve calcular notes_count via listarAtividadesDeal');

    // 8. PUT /deals/:id, PATCH /stage, GET/POST /activities de deal alheio por Juliana -> 404
    console.log('9️⃣  Cenário 8: PUT, PATCH /stage, GET/POST /activities em deal alheio retornam 404');
    const resPutAlheio = await makeRequest(app, 'PUT', `/api/bi/crm/deals/${dealFigueiredo.id}`, {
      Authorization: `Bearer ${tokenJuliana}`
    }, { titulo: 'Tentativa Invasão' });
    assert.strictEqual(resPutAlheio.status, 404);

    const resPatchAlheio = await makeRequest(app, 'PATCH', `/api/bi/crm/deals/${dealFigueiredo.id}/stage`, {
      Authorization: `Bearer ${tokenJuliana}`
    }, { novoEstagio: 'PERDIDO', justificativa: 'Tentativa Invasão' });
    assert.strictEqual(resPatchAlheio.status, 404);

    const resGetActAlheio = await makeRequest(app, 'GET', `/api/bi/crm/deals/${dealFigueiredo.id}/activities`, {
      Authorization: `Bearer ${tokenJuliana}`
    });
    assert.strictEqual(resGetActAlheio.status, 404);

    const resPostActAlheio = await makeRequest(app, 'POST', `/api/bi/crm/deals/${dealFigueiredo.id}/activities`, {
      Authorization: `Bearer ${tokenJuliana}`
    }, { tipo: 'NOTA', assunto: 'Tentativa Invasão', descricao: 'Nota em deal alheio' });
    assert.strictEqual(resPostActAlheio.status, 404);
    console.log('   ✅ Bloqueio total (404) em PUT, PATCH /stage, GET/POST /activities de deal alheio.');

    // 10. PUT /deals/:id do próprio deal por Juliana tentando mudar cod_vendedor para '000004' mantém '000074'
    //     e ao mudar estagio para 'GANHO' preenche data_fechamento_real e status='ganho'
    console.log('🔟 Cenário 10: PUT /deals/:id próprio preserva 000074 e grava data_fechamento_real ao ir para GANHO');
    const res10 = await makeRequest(app, 'PUT', `/api/bi/crm/deals/${dealJuliana.id}`, {
      Authorization: `Bearer ${tokenJuliana}`
    }, {
      titulo: 'Deal Juliana Fechado via PUT',
      cod_vendedor: '000004',
      nome_vendedor: 'Figueiredo',
      estagio: 'GANHO',
      valor_total: 30000
    });
    assert.strictEqual(res10.status, 200);
    assert.strictEqual(res10.body.data.cod_vendedor, '000074', 'Vendedor não pode transferir deal próprio para outro vendedor');
    assert.strictEqual(res10.body.data.nome_vendedor, 'Juliana');
    assert.strictEqual(res10.body.data.estagio, 'ganho');
    assert.strictEqual(res10.body.data.status, 'ganho');
    assert.ok(res10.body.data.data_fechamento_real, 'PUT com estagio=GANHO deve preencher data_fechamento_real');
    console.log('   ✅ Ownership preservado e data_fechamento_real gravada via PUT.');

    // 11. DELETE /deals/:id por vendedor -> 403 FORBIDDEN_CRM_ADMIN
    console.log('1️⃣1️⃣ Cenário 11: Rotas administrativas chamadas por vendedor retornam 403 FORBIDDEN_CRM_ADMIN');
    const resDelDealVend = await makeRequest(app, 'DELETE', `/api/bi/crm/deals/${dealJuliana.id}`, {
      Authorization: `Bearer ${tokenJuliana}`
    });
    assert.strictEqual(resDelDealVend.status, 403);
    assert.strictEqual(resDelDealVend.body.error.code, 'FORBIDDEN_CRM_ADMIN');

    // 12. POST /deals/migrate-ids, POST /deals/:id/restore, POST /produtos/sync, POST /transportadoras/sync, DELETE/restore /clientes/:id por vendedor -> 403 FORBIDDEN_CRM_ADMIN
    const adminOnlyEndpoints = [
      ['POST', '/api/bi/crm/deals/migrate-ids'],
      ['POST', `/api/bi/crm/deals/${dealJuliana.id}/restore`],
      ['POST', '/api/bi/crm/produtos/sync'],
      ['POST', '/api/bi/crm/transportadoras/sync'],
      ['DELETE', '/api/bi/crm/clientes/1'],
      ['POST', '/api/bi/crm/clientes/1/restore']
    ];
    for (const [method, endpoint] of adminOnlyEndpoints) {
      const resp = await makeRequest(app, method, endpoint, { Authorization: `Bearer ${tokenJuliana}` });
      assert.strictEqual(resp.status, 403, `${method} ${endpoint} deveria retornar 403 para vendedor`);
      assert.strictEqual(resp.body.error.code, 'FORBIDDEN_CRM_ADMIN');
    }
    console.log('   ✅ Todas as 7 rotas administrativas retornaram 403 FORBIDDEN_CRM_ADMIN para vendedor.');

    // 13. GET /me retorna escopo para vendedor e para admin
    console.log('1️⃣2️⃣ Cenário 13: GET /me retorna escopo correto para vendedor e para admin');
    const resMeVend = await makeRequest(app, 'GET', '/api/bi/crm/me', { Authorization: `Bearer ${tokenJuliana}` });
    assert.strictEqual(resMeVend.status, 200);
    assert.strictEqual(resMeVend.body.data.isAdmin, false);
    assert.strictEqual(resMeVend.body.data.cod_vendedor, '000074');
    assert.strictEqual(resMeVend.body.data.nome_vendedor, 'Juliana');

    const resMeAdmin = await makeRequest(app, 'GET', '/api/bi/crm/me', { Authorization: `Bearer ${tokenAlexandre}` });
    assert.strictEqual(resMeAdmin.status, 200);
    assert.strictEqual(resMeAdmin.body.data.isAdmin, true);
    assert.strictEqual(resMeAdmin.body.data.cod_vendedor, null);
    console.log('   ✅ GET /me validado para vendedor e admin.');

    // 14. GET /vendedores retorna apenas [Juliana] para Juliana e todos os 4 para Alexandre
    console.log('1️⃣3️⃣ Cenário 14: GET /vendedores respeita escopo');
    const resVendJuliana = await makeRequest(app, 'GET', '/api/bi/crm/vendedores', { Authorization: `Bearer ${tokenJuliana}` });
    assert.strictEqual(resVendJuliana.status, 200);
    assert.strictEqual(resVendJuliana.body.data.length, 1);
    assert.strictEqual(resVendJuliana.body.data[0].codigo, '000074');
    assert.strictEqual(resVendJuliana.body.data[0].nome, 'Juliana');

    const resVendAdmin = await makeRequest(app, 'GET', '/api/bi/crm/vendedores', { Authorization: `Bearer ${tokenAlexandre}` });
    assert.strictEqual(resVendAdmin.status, 200);
    assert.strictEqual(resVendAdmin.body.data.length, 4);
    console.log('   ✅ GET /vendedores validado (1 para vendedor, 4 para admin).');

    // 15. GET /meta: individual para vendedor e consolidado (sem somar 000001 Alexandre) para admin
    console.log('1️⃣4️⃣ Cenário 15: GET /meta calcula meta individual (R$ 120.000) e consolidada da equipe (R$ 360.000 sem Alexandre)');
    const now = new Date();
    const mesAtual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const resMetaJuliana = await makeRequest(app, 'GET', `/api/bi/crm/meta?mes=${mesAtual}`, {
      Authorization: `Bearer ${tokenJuliana}`
    });
    assert.strictEqual(resMetaJuliana.status, 200);
    assert.strictEqual(resMetaJuliana.body.data.meta_mensal, 120000);
    assert.ok(resMetaJuliana.body.data.realizado >= 30000, 'Realizado de Juliana deve contabilizar o deal ganho no mês');
    assert.ok(typeof resMetaJuliana.body.data.percentual === 'number', 'Percentual deve ser numérico quando meta_mensal > 0');
    assert.strictEqual(resMetaJuliana.body.data.vendedores.length, 1);
    assert.strictEqual(resMetaJuliana.body.data.vendedores[0].cod_vendedor, '000074');

    const resMetaAdminEquipe = await makeRequest(app, 'GET', `/api/bi/crm/meta?mes=${mesAtual}`, {
      Authorization: `Bearer ${tokenAlexandre}`
    });
    assert.strictEqual(resMetaAdminEquipe.status, 200);
    assert.strictEqual(resMetaAdminEquipe.body.data.meta_mensal, 360000, 'Soma da equipe deve ser 3 x 120.000 = 360.000 (excluindo Alexandre 000001 com meta 0)');
    assert.ok(resMetaAdminEquipe.body.data.vendedores.every(v => v.cod_vendedor !== '000001'), 'vendedores da equipe não deve incluir vendedores com meta 0');

    const metaAlexandreEscopo = await crmEngine.obterMetaMensal({
      mes: mesAtual,
      scope: { all: false, codVendedor: '000001', codigosLeitura: ['000001'] }
    });
    assert.strictEqual(metaAlexandreEscopo.meta_mensal, 0);
    assert.strictEqual(metaAlexandreEscopo.percentual, null, 'Percentual deve ser null quando meta_mensal === 0');
    console.log('   ✅ GET /meta validado (individual, equipe 360k e percentual null para meta 0).');

    // 16. Testes unitários do normalizador de vendedores (3 cenários)
    console.log('1️⃣5️⃣ Cenários 16 a 18: Função normalizarRegistro');
    const norm1 = await normalizarRegistro({ cod_vendedor: '', nome_vendedor: 'Juliana' });
    assert.strictEqual(norm1.semMapeamento, false);
    assert.strictEqual(norm1.codNovo, '000074');
    assert.strictEqual(norm1.nomeNovo, 'Juliana');

    const norm2 = await normalizarRegistro({ cod_vendedor: '000004', nome_vendedor: '' });
    assert.strictEqual(norm2.semMapeamento, false);
    assert.strictEqual(norm2.codNovo, '000004');
    assert.strictEqual(norm2.nomeNovo, 'Figueiredo');

    const norm3 = await normalizarRegistro({ cod_vendedor: '1', nome_vendedor: 'Alexandre' });
    assert.strictEqual(norm3.semMapeamento, false);
    assert.strictEqual(norm3.codNovo, '000001');
    assert.strictEqual(norm3.nomeNovo, 'Alexandre');
    console.log('   ✅ Normalização (Juliana->000074, 000004->Figueiredo, 1->000001) validada.');

    console.log('\n🎉 TODOS OS 18 CENÁRIOS DO CRM-19 (RBAC VENDEDOR & META) PASSARAM COM SUCESSO!\n');
  } finally {
    db.isConfigured = originalIsConfigured;
    db.logUserActivity = originalLogUserActivity;
    db.getConfigMetasVendasDB = originalGetConfigMetas;
    crmVendedores.invalidarCacheVendedores();
    if (originalCacheRaw !== null) {
      fs.writeFileSync(cacheFile, originalCacheRaw, 'utf8');
    }
  }
}

runTests().catch((err) => {
  console.error('\n❌ ERRO NOS TESTES CRM-19:', err);
  process.exit(1);
});
