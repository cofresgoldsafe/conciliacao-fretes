/**
 * test_crm_whatsapp_integracao.js
 * 
 * Suíte de Testes Automatizados — Integração Servidor-a-Servidor WhatsApp x CRM (CRM-21a)
 * Cobre:
 * - Cenário 3: process.env.CRM_INTEGRACAO_SECRET ausente/vazio -> 503 INTEGRACAO_DESATIVADA
 * - Cenário 4: Segredo ausente ou incorreto no cabeçalho Authorization -> 401 INTEGRACAO_NAO_AUTORIZADA
 * - Cenário 5: X-Portal-User inexistente ou usuário sem acesso ao WhatsApp -> 403 USUARIO_SEM_ACESSO
 * - Cenário 6: Vendedor com acesso ao WhatsApp mas sem permissão "crm" -> 403 FORBIDDEN_CRM
 * - Cenário 7: Cliente com (11) 98765-4321 localizado buscando 551187654321 com fidelidade
 * - Cenário 8: Telefone inexistente/desconhecido -> status 200, cliente null
 * - Cenário 9: Escopo RBAC — Vendedora 999074 não visualiza deal de 999064 com mesmo telefone
 * - Cenário 10: POST /deals cria negócio com dono=999074, origem=whatsapp, estagio=lead e vínculo principal
 * - Cenário 11: Concorrência com mesmo origem_ref resulta em exatamente 1 negócio (COUNT = 1) e resposta idempotente
 * - Cenário 12: Vendedor A recebe 404 em POST e GET /deals/:id/conversas de deal do Vendedor B
 * - Cenário 13: Segundo vínculo com principal=true altera exclusividade de principal e gera atividade
 */

'use strict';

const assert = require('assert');
const http = require('http');
const express = require('express');
const postgresDb = require('./postgres_db');
const crmEngine = require('./crm_engine');
const crmVendedores = require('./crm_vendedores');
const criarRouterIntegracaoWhatsapp = require('./crm_integracao_whatsapp');
const { criarHandlerWhatsappTicket } = require('./whatsapp_sso');

function userHasWhatsappAccess(u) {
  if (!u || u.active === false) return false;
  if (String(u.username || '').trim().toLowerCase() === 'alexandre' || u.role === 'admin') return true;
  return Array.isArray(u.permissions) && u.permissions.includes('whatsapp');
}

function makeRequest(baseUrl, method, reqPath, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(reqPath, baseUrl);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
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
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Iniciando Testes de Integração WhatsApp x CRM (CRM-21a)...\n');

  const originalSecret = process.env.CRM_INTEGRACAO_SECRET;
  const TEST_SECRET = 'segredo-secreto-integracao-wpp-crm-teste';
  let server = null;
  let baseUrl = '';

  const dbUrlConfigured = Boolean((process.env.DATABASE_URL || '').trim());
  let hasDatabase = false;

  try {
    if (dbUrlConfigured) {
      const okInitPg = await postgresDb.initPostgres();
      if (okInitPg) {
        await crmEngine.initCrmTables();
        await crmVendedores.ensureCrmVendedoresTable();
        hasDatabase = true;
      }
    }
  } catch (err) {
    console.warn('⚠️ [Testes] Aviso ao inicializar Postgres:', err.message);
  }

  try {
    const app = express();
    app.use(express.json());
    app.use('/api/integracoes/whatsapp/crm', criarRouterIntegracaoWhatsapp({ userHasWhatsappAccess }));

    const testWhatsappTickets = new Map();
    const handlerTicket = criarHandlerWhatsappTicket({
      getUsersDB: () => postgresDb.getUsers(),
      userHasWhatsappAccess,
      whatsappSsoTickets: testWhatsappTickets,
      logUserActivity: async () => {},
      WHATSAPP_PANEL_URL: 'https://whatsapp.goldsafe.com.br'
    });

    app.post('/api/auth/whatsapp-ticket', (req, res, next) => {
      const userHeader = req.headers['x-portal-user'] || 'vend_wpp_test';
      req.user = { username: userHeader };
      next();
    }, handlerTicket);

    server = app.listen(0);
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    // ========================================================================
    // Cenário 3: Ausência de CRM_INTEGRACAO_SECRET no ambiente -> 503
    // ========================================================================
    delete process.env.CRM_INTEGRACAO_SECRET;
    const resCenario3 = await makeRequest(baseUrl, 'GET', '/api/integracoes/whatsapp/crm/contexto?telefone=5511987654321', {
      'Authorization': `Bearer ${TEST_SECRET}`,
      'X-Portal-User': 'alexandre'
    });
    assert.strictEqual(resCenario3.status, 503, 'Cenário 3 deve retornar status 503');
    assert.strictEqual(resCenario3.body?.error?.code, 'INTEGRACAO_DESATIVADA', 'Cenário 3 deve retornar INTEGRACAO_DESATIVADA');
    console.log('   ✅ Cenário 3: 503 INTEGRACAO_DESATIVADA quando CRM_INTEGRACAO_SECRET não configurado');

    // Configura o segredo para os próximos cenários
    process.env.CRM_INTEGRACAO_SECRET = TEST_SECRET;

    // ========================================================================
    // Cenário 4: Segredo ausente ou incorreto -> 401
    // ========================================================================
    // 4a. Sem header Authorization
    const resCenario4a = await makeRequest(baseUrl, 'GET', '/api/integracoes/whatsapp/crm/contexto?telefone=5511987654321', {
      'X-Portal-User': 'alexandre'
    });
    assert.strictEqual(resCenario4a.status, 401, 'Cenário 4a deve retornar status 401 sem Authorization');
    assert.strictEqual(resCenario4a.body?.error?.code, 'INTEGRACAO_NAO_AUTORIZADA', 'Cenário 4a deve retornar INTEGRACAO_NAO_AUTORIZADA');

    // 4b. Com segredo incorreto
    const resCenario4b = await makeRequest(baseUrl, 'GET', '/api/integracoes/whatsapp/crm/contexto?telefone=5511987654321', {
      'Authorization': 'Bearer segredo-totalmente-incorreto',
      'X-Portal-User': 'alexandre'
    });
    assert.strictEqual(resCenario4b.status, 401, 'Cenário 4b deve retornar status 401 com segredo inválido');
    assert.strictEqual(resCenario4b.body?.error?.code, 'INTEGRACAO_NAO_AUTORIZADA', 'Cenário 4b deve retornar INTEGRACAO_NAO_AUTORIZADA');
    console.log('   ✅ Cenário 4: 401 INTEGRACAO_NAO_AUTORIZADA para segredo ausente ou incorreto');

    if (!hasDatabase) {
      console.log('   ⏭️ Cenário 5: SKIP (sem DATABASE_URL)');
      console.log('   ⏭️ Cenário 6: SKIP (sem DATABASE_URL)');
      console.log('   ⏭️ Cenário 7: SKIP (sem DATABASE_URL)');
      console.log('   ⏭️ Cenário 8: SKIP (sem DATABASE_URL)');
      console.log('   ⏭️ Cenário 9: SKIP (sem DATABASE_URL)');
      console.log('   ⏭️ Cenário 10: SKIP (sem DATABASE_URL)');
      console.log('   ⏭️ Cenário 11: SKIP (sem DATABASE_URL)');
      console.log('   ⏭️ Cenário 12: SKIP (sem DATABASE_URL)');
      console.log('   ⏭️ Cenário 13: SKIP (sem DATABASE_URL)');
      console.log('   ⏭️ Cenário 14: SKIP (sem DATABASE_URL)');
      console.log('   ⏭️ Cenário 15: SKIP (sem DATABASE_URL)');
      console.log('   ⏭️ Cenário 16: SKIP (sem DATABASE_URL)');
      console.log('   ⏭️ Cenário 17: SKIP (sem DATABASE_URL)');
      return;
    }

    // ========================================================================
    // Cenário 5: X-Portal-User inexistente ou sem permissão whatsapp -> 403
    // ========================================================================
    // 5a. Usuário que não existe
    const resCenario5a = await makeRequest(baseUrl, 'GET', '/api/integracoes/whatsapp/crm/contexto?telefone=5511987654321', {
      'Authorization': `Bearer ${TEST_SECRET}`,
      'X-Portal-User': 'usuario_fantasma_inexistente_999'
    });
    assert.strictEqual(resCenario5a.status, 403, 'Cenário 5a deve retornar 403');
    assert.strictEqual(resCenario5a.body?.error?.code, 'USUARIO_SEM_ACESSO', 'Cenário 5a deve retornar USUARIO_SEM_ACESSO');

    // 5b. Usuário sem permissão 'whatsapp' (utilizando a função real saveUser)
    await postgresDb.saveUser({
      username: 'user_sem_wpp_test',
      name: 'Sem WhatsApp Teste',
      email: 'semwpp@teste.com',
      role: 'user',
      permissions: ['crm'],
      active: true,
      pass: '102030'
    });

    const resCenario5b = await makeRequest(baseUrl, 'GET', '/api/integracoes/whatsapp/crm/contexto?telefone=5511987654321', {
      'Authorization': `Bearer ${TEST_SECRET}`,
      'X-Portal-User': 'user_sem_wpp_test'
    });
    assert.strictEqual(resCenario5b.status, 403, 'Cenário 5b deve retornar 403');
    assert.strictEqual(resCenario5b.body?.error?.code, 'USUARIO_SEM_ACESSO', 'Cenário 5b deve retornar USUARIO_SEM_ACESSO');
    console.log('   ✅ Cenário 5: 403 USUARIO_SEM_ACESSO para usuário inexistente ou sem whatsapp');

    // ========================================================================
    // Cenário 6: Vendedor com whatsapp mas sem permissão crm -> 403 FORBIDDEN_CRM
    // ========================================================================
    await postgresDb.saveUser({
      username: 'vendedor_sem_crm_test',
      name: 'Vendedor Sem CRM Teste',
      email: 'vendedorsemcrm@teste.com',
      role: 'vendedor',
      permissions: ['whatsapp'],
      vendorCode: '999064',
      active: true,
      pass: '102030'
    });

    const resCenario6 = await makeRequest(baseUrl, 'GET', '/api/integracoes/whatsapp/crm/contexto?telefone=5511987654321', {
      'Authorization': `Bearer ${TEST_SECRET}`,
      'X-Portal-User': 'vendedor_sem_crm_test'
    });
    assert.strictEqual(resCenario6.status, 403, 'Cenário 6 deve retornar 403');
    assert.strictEqual(resCenario6.body?.error?.code, 'FORBIDDEN_CRM', 'Cenário 6 deve retornar FORBIDDEN_CRM');
    console.log('   ✅ Cenário 6: 403 FORBIDDEN_CRM para vendedor com whatsapp mas sem permissão crm');

    // ========================================================================
    // Cenário 7: Cliente gravado (11) 98765-4321 localizado buscando 551187654321 com fidelidade
    // ========================================================================
    const idCliTeste = 'CLI-TEST-WPP-777';
    const cnpjFicticio = '11.222.333/0001-81';
    const raizCnpjFicticia = '11222333';

    // Comandos separados para evitar 'cannot insert multiple commands into a prepared statement'
    await postgresDb.safeQuery('DELETE FROM crm_clientes WHERE id = $1;', [idCliTeste]);
    await postgresDb.safeQuery(`
      INSERT INTO crm_clientes (
        id, nome_razao, cnpj_cpf, celular_whatsapp, telefone, protheus_cod, protheus_loja, updated_at
      ) VALUES (
        $1, 'CLIENTE TESTE WHATSAPP LTDA', $2, '(11) 98765-4321', '(11) 3141-9000', '000999', '01', NOW()
      );
    `, [idCliTeste, cnpjFicticio]);

    await postgresDb.safeQuery('DELETE FROM crm_clientes_raiz_cnpj WHERE raiz_cnpj = $1;', [raizCnpjFicticia]);
    await postgresDb.safeQuery(`
      INSERT INTO crm_clientes_raiz_cnpj (raiz_cnpj, razao_social, total_compras, valor_total)
      VALUES ($1, 'CLIENTE TESTE WHATSAPP LTDA', 5, 25000.00);
    `, [raizCnpjFicticia]);

    const resCenario7 = await makeRequest(baseUrl, 'GET', '/api/integracoes/whatsapp/crm/contexto?telefone=551187654321', {
      'Authorization': `Bearer ${TEST_SECRET}`,
      'X-Portal-User': 'alexandre'
    });
    assert.strictEqual(resCenario7.status, 200, 'Cenário 7 deve retornar status 200');
    assert.strictEqual(resCenario7.body?.success, true, 'Cenário 7 deve ter success=true');
    assert.ok(resCenario7.body?.data?.cliente, 'Cenário 7 deve encontrar o cliente pelo telefone alternativo (sem 9)');
    assert.strictEqual(resCenario7.body.data.cliente.id, idCliTeste);
    assert.strictEqual(resCenario7.body.data.cliente.cnpj, cnpjFicticio);
    assert.ok(resCenario7.body.data.cliente.fidelidade, 'Cenário 7 deve retornar o objeto de fidelidade');
    assert.strictEqual(resCenario7.body.data.cliente.fidelidade.total_compras, 5);
    console.log('   ✅ Cenário 7: Cliente gravado (11) 98765-4321 localizado com busca 551187654321 e fidelidade');

    // ========================================================================
    // Cenário 8: Telefone desconhecido -> cliente null 200
    // ========================================================================
    const resCenario8 = await makeRequest(baseUrl, 'GET', '/api/integracoes/whatsapp/crm/contexto?telefone=5511987650000', {
      'Authorization': `Bearer ${TEST_SECRET}`,
      'X-Portal-User': 'alexandre'
    });
    assert.strictEqual(resCenario8.status, 200, 'Cenário 8 deve retornar status 200');
    assert.strictEqual(resCenario8.body?.success, true);
    assert.strictEqual(resCenario8.body?.data?.cliente, null, 'Cenário 8 cliente deve ser null');
    assert.deepStrictEqual(resCenario8.body?.data?.clientes_alternativos, [], 'Cenário 8 clientes alternativos vazio');
    console.log('   ✅ Cenário 8: Telefone desconhecido retorna 200 com cliente null');

    // ========================================================================
    // Cenário 9: Vendedora 999074 não vê deal do 999064 com o mesmo telefone
    // ========================================================================
    const idDealOutroVend = 'DEAL-TEST-WPP-999';

    await postgresDb.safeQuery('DELETE FROM crm_deals WHERE id = $1;', [idDealOutroVend]);
    await postgresDb.safeQuery(`
      INSERT INTO crm_deals (
        id, titulo, cliente_nome, cliente_telefone, valor_total, estagio, cod_vendedor, nome_vendedor, created_by, updated_by
      ) VALUES (
        $1, 'Deal Privado 999064', 'Cliente Teste Deal', '5511987654321', 1000.00, 'proposta', '999064', 'Outro Vendedor Teste', 'sistema', 'sistema'
      );
    `, [idDealOutroVend]);

    // Cria usuária vendedora fictícia de teste (vend_wpp_test) com permissions ['whatsapp', 'crm']
    await postgresDb.saveUser({
      username: 'vend_wpp_test',
      name: 'Vendedora Teste WhatsApp',
      email: 'vendwppteste@teste.com',
      role: 'vendedor',
      permissions: ['whatsapp', 'crm'],
      vendorCode: '999074',
      active: true,
      pass: '102030'
    });

    // Cria vendedor fictício de teste com código 999074 vinculado a vend_wpp_test
    await postgresDb.safeQuery('DELETE FROM crm_vendedores WHERE cod_vendedor = $1;', ['999074']);
    await postgresDb.safeQuery(`
      INSERT INTO crm_vendedores (cod_vendedor, username_portal, nome, meta_mensal)
      VALUES ('999074', 'vend_wpp_test', 'Vendedora Teste WhatsApp', NULL);
    `);
    crmVendedores.invalidarCacheVendedores();

    // Chamada pela vendedora fictícia (vend_wpp_test -> 999074)
    const resCenario9Vendedora = await makeRequest(baseUrl, 'GET', '/api/integracoes/whatsapp/crm/contexto?telefone=5511987654321', {
      'Authorization': `Bearer ${TEST_SECRET}`,
      'X-Portal-User': 'vend_wpp_test'
    });
    assert.strictEqual(resCenario9Vendedora.status, 200);
    const dealsVendedora = resCenario9Vendedora.body?.data?.deals_abertos || [];
    const encontrouDealAlheio = dealsVendedora.some(d => d.id === idDealOutroVend);
    assert.strictEqual(encontrouDealAlheio, false, 'Vendedora 999074 não deve ver o deal pertencente ao vendedor 999064');

    // Chamada por Alexandre (Admin)
    const resCenario9Alexandre = await makeRequest(baseUrl, 'GET', '/api/integracoes/whatsapp/crm/contexto?telefone=5511987654321', {
      'Authorization': `Bearer ${TEST_SECRET}`,
      'X-Portal-User': 'alexandre'
    });
    assert.strictEqual(resCenario9Alexandre.status, 200);
    const dealsAlexandre = resCenario9Alexandre.body?.data?.deals_abertos || [];
    const encontrouAlexandre = dealsAlexandre.some(d => d.id === idDealOutroVend);
    assert.strictEqual(encontrouAlexandre, true, 'Admin Alexandre deve ver o deal em deals_abertos');
    console.log('   ✅ Cenário 9: Vendedora 999074 não vê deal de 999064 e Admin visualiza corretamente');

    // ========================================================================
    // Cenário 10: Vendedor fictício cria via POST /deals -> 201
    // ========================================================================
    const resCenario10 = await makeRequest(baseUrl, 'POST', '/api/integracoes/whatsapp/crm/deals', {
      'Authorization': `Bearer ${TEST_SECRET}`,
      'X-Portal-User': 'vend_wpp_test'
    }, {
      telefone: '5511987654321',
      conversa_id: 'conv-test-10',
      nome_contato: 'Contato Teste Cenário 10',
      origem_ref: 'origem-ref-cenario-10'
    });

    assert.strictEqual(resCenario10.status, 201, 'Cenário 10 deve retornar status 201');
    assert.strictEqual(resCenario10.body?.success, true);
    assert.strictEqual(resCenario10.body?.data?.criado, true);
    assert.strictEqual(resCenario10.body?.data?.deal?.cod_vendedor, '999074', 'Dono deve ser o código do vendedor');
    assert.strictEqual(resCenario10.body?.data?.deal?.origem, 'whatsapp');
    assert.strictEqual(resCenario10.body?.data?.deal?.estagio, 'lead');

    const dealCenario10Id = String(resCenario10.body.data.deal.id);

    // Confere se vínculo principal foi criado
    const vinculoCenario10 = await postgresDb.safeQuery(
      'SELECT principal, ativo FROM crm_deal_conversas WHERE deal_id = $1 AND conversa_id = $2;',
      [dealCenario10Id, 'conv-test-10']
    );
    assert.strictEqual(vinculoCenario10?.rows?.[0]?.principal, true, 'Vínculo inicial deve ser principal');
    assert.strictEqual(vinculoCenario10?.rows?.[0]?.ativo, true, 'Vínculo inicial deve ser ativo');
    console.log('   ✅ Cenário 10: POST /deals cria negócio com dono=999074, origem=whatsapp, estagio=lead e vinculo principal');

    // ========================================================================
    // Cenário 11: Mesmo origem_ref duas vezes (Promise.all) -> um deal só (COUNT(*) = 1) e o outro criado=false
    // ========================================================================
    const payload11 = {
      telefone: '5511987654321',
      conversa_id: 'conv-test-11',
      nome_contato: 'Contato Teste Cenário 11',
      origem_ref: 'origem-ref-cenario-11'
    };

    const [res11a, res11b] = await Promise.all([
      makeRequest(baseUrl, 'POST', '/api/integracoes/whatsapp/crm/deals', {
        'Authorization': `Bearer ${TEST_SECRET}`,
        'X-Portal-User': 'vend_wpp_test'
      }, payload11),
      makeRequest(baseUrl, 'POST', '/api/integracoes/whatsapp/crm/deals', {
        'Authorization': `Bearer ${TEST_SECRET}`,
        'X-Portal-User': 'vend_wpp_test'
      }, payload11)
    ]);

    const statuses = [res11a.status, res11b.status].sort();
    assert.deepStrictEqual(statuses, [200, 201], 'Uma chamada deve retornar 201 e a outra 200');

    const dealId11a = res11a.body?.data?.deal?.id;
    const dealId11b = res11b.body?.data?.deal?.id;
    assert.strictEqual(dealId11a, dealId11b, 'Ambas as chamadas devem referenciar o mesmo deal.id');

    const count11Res = await postgresDb.safeQuery(
      'SELECT COUNT(*) AS total FROM crm_deals WHERE origem_ref = $1;',
      ['origem-ref-cenario-11']
    );
    assert.strictEqual(parseInt(count11Res?.rows?.[0]?.total, 10), 1, 'COUNT(*) por origem_ref deve ser exatamente 1');
    console.log('   ✅ Cenário 11: Concorrência com mesmo origem_ref resulta em exatamente 1 negócio e resposta idempotente');

    // ========================================================================
    // Cenário 12: Vendedor A em POST e GET /deals/<deal do vendedor B>/conversas -> 404
    // ========================================================================
    const idDeal12B = 'DEAL-TEST-WPP-12B';
    await postgresDb.safeQuery('DELETE FROM crm_deals WHERE id = $1;', [idDeal12B]);
    await postgresDb.safeQuery(`
      INSERT INTO crm_deals (
        id, titulo, cliente_nome, cliente_telefone, valor_total, estagio, cod_vendedor, nome_vendedor, created_by, updated_by
      ) VALUES (
        $1, 'Deal Privado 999064 B', 'Cliente Deal 12', '5511987654321', 800.00, 'proposta', '999064', 'Outro Vendedor Teste', 'sistema', 'sistema'
      );
    `, [idDeal12B]);

    // POST /deals/:id/conversas por Vendedor A (999074) em deal de B (999064) -> 404
    const resCenario12Post = await makeRequest(baseUrl, 'POST', `/api/integracoes/whatsapp/crm/deals/${idDeal12B}/conversas`, {
      'Authorization': `Bearer ${TEST_SECRET}`,
      'X-Portal-User': 'vend_wpp_test'
    }, {
      conversa_id: 'conv-invasiva',
      telefone: '5511987654321'
    });
    assert.strictEqual(resCenario12Post.status, 404, 'POST conversas em deal alheio deve retornar 404');
    assert.strictEqual(resCenario12Post.body?.error?.code, 'DEAL_NOT_FOUND');

    // GET /deals/:id/conversas por Vendedor A (999074) em deal de B (999064) -> 404
    const resCenario12Get = await makeRequest(baseUrl, 'GET', `/api/integracoes/whatsapp/crm/deals/${idDeal12B}/conversas`, {
      'Authorization': `Bearer ${TEST_SECRET}`,
      'X-Portal-User': 'vend_wpp_test'
    });
    assert.strictEqual(resCenario12Get.status, 404, 'GET conversas em deal alheio deve retornar 404');
    assert.strictEqual(resCenario12Get.body?.error?.code, 'DEAL_NOT_FOUND');
    console.log('   ✅ Cenário 12: Vendedor A recebe 404 em POST e GET /deals/:id/conversas de deal do Vendedor B');

    // ========================================================================
    // Cenário 13: Segundo vínculo com principal:true -> só um principal ativo e atividade criada
    // ========================================================================
    const resCenario13 = await makeRequest(baseUrl, 'POST', `/api/integracoes/whatsapp/crm/deals/${dealCenario10Id}/conversas`, {
      'Authorization': `Bearer ${TEST_SECRET}`,
      'X-Portal-User': 'vend_wpp_test'
    }, {
      conversa_id: 'conv-test-13',
      telefone: '5511987654321',
      linha_whatsapp: 'linha-02',
      principal: true
    });
    assert.strictEqual(resCenario13.status, 200, 'Segundo vínculo deve retornar 200');

    // Confere que só existe um vínculo principal ativo
    const countPrincipalAtivoRes = await postgresDb.safeQuery(
      'SELECT conversa_id FROM crm_deal_conversas WHERE deal_id = $1 AND ativo = TRUE AND principal = TRUE;',
      [dealCenario10Id]
    );
    assert.strictEqual(countPrincipalAtivoRes?.rows?.length, 1, 'Deve haver estritamente um vínculo principal ativo');
    assert.strictEqual(countPrincipalAtivoRes?.rows?.[0]?.conversa_id, 'conv-test-13', 'O novo vínculo deve ser o principal');

    // Confere criação de atividade de vínculo
    const atividadeRes = await postgresDb.safeQuery(
      "SELECT * FROM crm_atividades WHERE deal_id = $1 AND tipo = 'whatsapp_vinculo';",
      [dealCenario10Id]
    );
    assert.ok(atividadeRes?.rows?.length >= 1, 'Atividade whatsapp_vinculo deve ser criada');
    assert.strictEqual(atividadeRes.rows[0].status, 'concluida');
    console.log('   ✅ Cenário 13: Segundo vínculo com principal=true altera exclusividade de principal e gera atividade');

    // ========================================================================
    // Cenário 14: POST /api/auth/whatsapp-ticket { deal } como dono -> redirectUrl contém &deal=<id>
    // ========================================================================
    const resCenario14 = await makeRequest(baseUrl, 'POST', '/api/auth/whatsapp-ticket', {
      'X-Portal-User': 'vend_wpp_test'
    }, {
      deal: dealCenario10Id
    });
    assert.strictEqual(resCenario14.status, 200, 'Cenário 14 deve retornar 200');
    assert.strictEqual(resCenario14.body?.success, true);
    assert.ok(
      typeof resCenario14.body?.redirectUrl === 'string' && resCenario14.body.redirectUrl.includes(`&deal=${encodeURIComponent(dealCenario10Id)}`),
      'redirectUrl deve conter &deal=' + dealCenario10Id
    );
    console.log('   ✅ Cenário 14: POST /api/auth/whatsapp-ticket { deal } como dono gera redirectUrl com &deal=<id>');

    // ========================================================================
    // Cenário 15: POST /api/auth/whatsapp-ticket { deal } para deal alheio -> 404 DEAL_NOT_FOUND
    // ========================================================================
    const resCenario15 = await makeRequest(baseUrl, 'POST', '/api/auth/whatsapp-ticket', {
      'X-Portal-User': 'vend_wpp_test'
    }, {
      deal: idDeal12B
    });
    assert.strictEqual(resCenario15.status, 404, 'Cenário 15 deve retornar 404');
    assert.strictEqual(resCenario15.body?.success, false);
    assert.strictEqual(resCenario15.body?.code, 'DEAL_NOT_FOUND');
    console.log('   ✅ Cenário 15: POST /api/auth/whatsapp-ticket para deal alheio retorna 404 DEAL_NOT_FOUND');

    // ========================================================================
    // Cenário 16: POST /api/auth/whatsapp-ticket sem deal -> redirectUrl sem &deal= (regressão)
    // ========================================================================
    const resCenario16 = await makeRequest(baseUrl, 'POST', '/api/auth/whatsapp-ticket', {
      'X-Portal-User': 'vend_wpp_test'
    }, {});
    assert.strictEqual(resCenario16.status, 200, 'Cenário 16 deve retornar 200');
    assert.strictEqual(resCenario16.body?.success, true);
    assert.ok(
      typeof resCenario16.body?.redirectUrl === 'string' && !resCenario16.body.redirectUrl.includes('&deal='),
      'redirectUrl não deve conter &deal='
    );
    console.log('   ✅ Cenário 16: POST /api/auth/whatsapp-ticket sem deal retorna redirectUrl sem &deal= (regressão)');

    // ========================================================================
    // Cenário 17: Nono dígito em vínculos: deal criado com 11987651111 é encontrado via GET /contexto?telefone=551187651111
    // ========================================================================
    const resCenario17Post = await makeRequest(baseUrl, 'POST', '/api/integracoes/whatsapp/crm/deals', {
      'Authorization': `Bearer ${TEST_SECRET}`,
      'X-Portal-User': 'vend_wpp_test'
    }, {
      telefone: '11987651111',
      conversa_id: 'conv-test-17',
      nome_contato: 'Contato Teste Nono Dígito Cenário 17',
      origem_ref: 'origem-ref-cenario-17'
    });

    assert.strictEqual(resCenario17Post.status, 201, 'Cenário 17 deve criar deal com status 201');
    assert.strictEqual(resCenario17Post.body?.success, true);
    const dealId17 = String(resCenario17Post.body?.data?.deal?.id);

    const resCenario17Get = await makeRequest(baseUrl, 'GET', '/api/integracoes/whatsapp/crm/contexto?telefone=551187651111', {
      'Authorization': `Bearer ${TEST_SECRET}`,
      'X-Portal-User': 'vend_wpp_test'
    });

    assert.strictEqual(resCenario17Get.status, 200, 'GET /contexto deve retornar 200');
    assert.strictEqual(resCenario17Get.body?.success, true);
    const vinculos17 = resCenario17Get.body?.data?.vinculos || [];
    const achouDeal17 = vinculos17.some(v => String(v.deal_id) === dealId17);
    assert.strictEqual(achouDeal17, true, 'Vínculo do deal criado com 11987651111 deve ser encontrado na busca por 551187651111 (nono dígito)');
    console.log('   ✅ Cenário 17: Deal criado com 11987651111 é encontrado em vinculos via GET /contexto?telefone=551187651111');

  } finally {
    // Limpeza de fixtures
    if (hasDatabase) {
      try {
        await postgresDb.safeQuery('DELETE FROM crm_deals WHERE id IN ($1, $2) OR origem_ref IN ($3, $4, $5);', [
          'DEAL-TEST-WPP-999',
          'DEAL-TEST-WPP-12B',
          'origem-ref-cenario-10',
          'origem-ref-cenario-11',
          'origem-ref-cenario-17'
        ]);
        await postgresDb.safeQuery('DELETE FROM crm_clientes WHERE id = $1;', ['CLI-TEST-WPP-777']);
        await postgresDb.safeQuery('DELETE FROM crm_clientes_raiz_cnpj WHERE raiz_cnpj = $1;', ['11222333']);
        await postgresDb.safeQuery(`DELETE FROM crm_vendedores WHERE cod_vendedor IN ('999074', '999064');`);
        await postgresDb.safeQuery(`DELETE FROM users WHERE username IN ('user_sem_wpp_test', 'vendedor_sem_crm_test', 'vend_wpp_test');`);
        crmVendedores.invalidarCacheVendedores();
      } catch (_) {}
    }

    if (server) {
      server.close();
    }

    if (originalSecret === undefined) {
      delete process.env.CRM_INTEGRACAO_SECRET;
    } else {
      process.env.CRM_INTEGRACAO_SECRET = originalSecret;
    }
  }

  console.log('\n🎉 TODOS OS TESTES DE INTEGRAÇÃO WHATSAPP x CRM FORAM EXECUTADOS COM SUCESSO!\n');
}

runTests().catch(err => {
  console.error('❌ Falha nos testes de integração WhatsApp x CRM:', err);
  process.exit(1);
});
