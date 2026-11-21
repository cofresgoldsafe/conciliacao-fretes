/**
 * ============================================================================
 * SUÍTE DE TESTES AUTOMATIZADOS — OPÇÃO C / CRM-24 (TRANSFERÊNCIA DE OPORTUNIDADE)
 * ============================================================================
 * Cobre:
 * - Cenário 1: Transferência por Administrador (Alexandre / admin) com sucesso.
 * - Cenário 2: Transferência pelo próprio vendedor dono (Andrea / 000064) com sucesso.
 * - Cenário 3: Bloqueio de transferência por vendedor que não é o dono (403 Forbidden).
 * - Cenário 4: Bloqueio de transferência para o mesmo vendedor (400 MESMO_VENDEDOR).
 * - Cenário 5: Bloqueio de transferência sem informar novo vendedor (400 VENDEDOR_OBRIGATORIO).
 * - Cenário 6: Bloqueio de transferência sem justificativa (400 JUSTIFICATIVA_OBRIGATORIA).
 * - Cenário 7: Bloqueio de transferência para vendedor inexistente (400 VENDEDOR_NAO_ENCONTRADO).
 * - Cenário 8: Registro da linha do tempo ("Transferido de ... para ... por ...: ...") e telemetria auditável.
 * ============================================================================
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-secret-crm24-transferir-suite';
}

const db = require('./postgres_db');
const auditLogsCapturados = [];
const originalLogUserActivity = db.logUserActivity;
const originalGetConfigMetas = db.getConfigMetasVendasDB;

db.logUserActivity = async (entry) => {
  auditLogsCapturados.push(entry);
  return true;
};
db.getConfigMetasVendasDB = async () => ({ metaBaseVendas: 120000.00 });

const crmVendedores = require('./crm_vendedores');
const crmEngine = require('./crm_engine');
const crmRoutes = require('./crm_routes');

const JWT_SECRET = process.env.JWT_SECRET;
const cacheFile = path.join(__dirname, 'data', 'crm_deals_cache.json');
const originalCacheRaw = fs.existsSync(cacheFile) ? fs.readFileSync(cacheFile, 'utf8') : null;

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
          resolve({ status: res.statusCode, body: parsed });
        });
      });

      req.on('error', (err) => {
        server.close();
        reject(err);
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  });
}

function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/bi/crm', crmRoutes);
  return app;
}

async function runTests() {
  console.log('\n===============================================================');
  console.log('🧪 INICIANDO SUÍTE DE TESTES: OPÇÃO C (TRANSFERÊNCIA CRM-24)');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  function testPass(nome) {
    passed++;
    console.log(`  ✅ [PASS] ${nome}`);
  }

  function testFail(nome, err) {
    failed++;
    console.error(`  ❌ [FAIL] ${nome}:`, err.message || err);
  }

  // Prepara tokens de teste
  const adminToken = generateToken({
    id: 1,
    username: 'alexandre',
    name: 'Alexandre',
    role: 'admin',
    vendorCode: '000001'
  });

  const andreaToken = generateToken({
    id: 2,
    username: 'andrea',
    name: 'Andrea',
    role: 'vendedor',
    permissions: ['crm'],
    vendorCode: '000064'
  });

  const figueiredoToken = generateToken({
    id: 3,
    username: 'figueiredo',
    name: 'Figueiredo',
    role: 'vendedor',
    permissions: ['crm'],
    vendorCode: '000004'
  });

  const app = buildTestApp();

  try {
    // ------------------------------------------------------------------------
    // Cenário 1: Transferência por Administrador (Alexandre / admin)
    // ------------------------------------------------------------------------
    try {
      // Cria deal pertencente à Andrea (000064)
      const novoDeal = await crmEngine.criarDeal({
        titulo: 'Oportunidade Teste Transferencia Admin',
        cliente_nome: 'Cliente ABC Teste',
        cliente_cnpj: '11222333000181',
        valor_total: 15000,
        cod_vendedor: '000064',
        nome_vendedor: 'Andrea'
      }, { username: 'andrea', name: 'Andrea', role: 'vendedor' });

      assert.ok(novoDeal && novoDeal.id, 'Deal deve ser criado');
      assert.strictEqual(novoDeal.cod_vendedor, '000064');

      // Admin transfere de Andrea (000064) para Figueiredo (000004)
      const res = await makeRequest(
        app,
        'POST',
        `/api/bi/crm/deals/${novoDeal.id}/transferir`,
        { 'Authorization': `Bearer ${adminToken}` },
        {
          novo_cod_vendedor: '000004',
          justificativa: 'Cobertura de férias da vendedora Andrea'
        }
      );

      assert.strictEqual(res.status, 200, `Status esperado 200, obtido: ${res.status}`);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.cod_vendedor, '000004');
      assert.strictEqual(res.body.data.nome_vendedor, 'Figueiredo');

      // Verifica timeline de atividades
      const atividades = await crmEngine.listarAtividadesDeal(novoDeal.id, { all: true });
      const actTransf = atividades.find(a => String(a.tipo).toLowerCase() === 'transferencia');
      assert.ok(actTransf, 'Deve conter atividade do tipo transferencia na timeline');
      assert.ok(actTransf.descricao.includes('Transferido de Andrea para Figueiredo por Alexandre: Cobertura de férias'),
        `Texto da atividade inesperado: ${actTransf.descricao}`);

      // Verifica telemetria
      const logAudit = auditLogsCapturados.find(l => l.actionType === 'CRM_DEAL_TRANSFERIDO' && l.metadata?.deal_id === String(novoDeal.id));
      assert.ok(logAudit, 'Deve registrar log de auditoria CRM_DEAL_TRANSFERIDO');
      assert.strictEqual(logAudit.metadata.para_cod_vendedor, '000004');

      testPass('Cenário 1: Transferência por Administrador com sucesso, atividade na timeline e auditoria');
    } catch (err) {
      testFail('Cenário 1: Transferência por Administrador', err);
    }

    // ------------------------------------------------------------------------
    // Cenário 2: Transferência pelo próprio vendedor dono (Andrea)
    // ------------------------------------------------------------------------
    try {
      const dealAndrea = await crmEngine.criarDeal({
        titulo: 'Oportunidade da Andrea para Transferir',
        cliente_nome: 'Cliente Andrea Transfer',
        cliente_cnpj: '44555666000199',
        valor_total: 8000,
        cod_vendedor: '000064',
        nome_vendedor: 'Andrea'
      }, { username: 'andrea', name: 'Andrea', role: 'vendedor' });

      // Andrea transfere para Juliana (000074)
      const res = await makeRequest(
        app,
        'POST',
        `/api/bi/crm/deals/${dealAndrea.id}/transferir`,
        { 'Authorization': `Bearer ${andreaToken}` },
        {
          novo_cod_vendedor: '000074',
          justificativa: 'Cliente prefere atendimento por Juliana'
        }
      );

      assert.strictEqual(res.status, 200, `Status esperado 200, obtido: ${res.status}`);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.cod_vendedor, '000074');
      assert.strictEqual(res.body.data.nome_vendedor, 'Juliana');

      testPass('Cenário 2: Transferência pelo próprio vendedor dono com sucesso');
    } catch (err) {
      testFail('Cenário 2: Transferência pelo próprio vendedor dono', err);
    }

    // ------------------------------------------------------------------------
    // Cenário 3: Bloqueio de transferência por vendedor alheio (Figueiredo tentando transferir de Andrea)
    // ------------------------------------------------------------------------
    try {
      const dealAndrea2 = await crmEngine.criarDeal({
        titulo: 'Oportunidade Exclusiva da Andrea',
        cliente_nome: 'Cliente Andrea Não Mexer',
        cliente_cnpj: '77888999000122',
        valor_total: 5000,
        cod_vendedor: '000064',
        nome_vendedor: 'Andrea'
      }, { username: 'andrea', name: 'Andrea', role: 'vendedor' });

      // Figueiredo tenta transferir oportunidade de Andrea
      const res = await makeRequest(
        app,
        'POST',
        `/api/bi/crm/deals/${dealAndrea2.id}/transferir`,
        { 'Authorization': `Bearer ${figueiredoToken}` },
        {
          novo_cod_vendedor: '000004',
          justificativa: 'Tentativa indevida de puxar lead'
        }
      );

      assert.ok(res.status === 403 || res.status === 404,
        `Deveria bloquear com 403 ou 404, obtido: ${res.status}`);

      testPass('Cenário 3: Bloqueio de transferência por vendedor não-dono (403/404)');
    } catch (err) {
      testFail('Cenário 3: Bloqueio de transferência por vendedor não-dono', err);
    }

    // ------------------------------------------------------------------------
    // Cenário 4: Bloqueio de transferência para o mesmo vendedor
    // ------------------------------------------------------------------------
    try {
      const dealMesmo = await crmEngine.criarDeal({
        titulo: 'Oportunidade Teste Mesmo Vendedor',
        cliente_nome: 'Cliente Mesmo Vend',
        cliente_cnpj: '99888777000133',
        valor_total: 12000,
        cod_vendedor: '000064',
        nome_vendedor: 'Andrea'
      }, { username: 'andrea', name: 'Andrea', role: 'vendedor' });

      const res = await makeRequest(
        app,
        'POST',
        `/api/bi/crm/deals/${dealMesmo.id}/transferir`,
        { 'Authorization': `Bearer ${adminToken}` },
        {
          novo_cod_vendedor: '000064', // Mesmo código atual!
          justificativa: 'Tentativa de transferir para si mesmo'
        }
      );

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error?.code, 'MESMO_VENDEDOR');

      testPass('Cenário 4: Bloqueio de transferência para o mesmo vendedor (400 MESMO_VENDEDOR)');
    } catch (err) {
      testFail('Cenário 4: Bloqueio de transferência para o mesmo vendedor', err);
    }

    // ------------------------------------------------------------------------
    // Cenário 5: Bloqueio sem informar novo vendedor
    // ------------------------------------------------------------------------
    try {
      const res = await makeRequest(
        app,
        'POST',
        '/api/bi/crm/deals/1/transferir',
        { 'Authorization': `Bearer ${adminToken}` },
        {
          novo_cod_vendedor: '',
          justificativa: 'Faltando vendedor'
        }
      );

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error?.code, 'VENDEDOR_OBRIGATORIO');

      testPass('Cenário 5: Bloqueio sem novo vendedor informado (400 VENDEDOR_OBRIGATORIO)');
    } catch (err) {
      testFail('Cenário 5: Bloqueio sem novo vendedor informado', err);
    }

    // ------------------------------------------------------------------------
    // Cenário 6: Bloqueio sem justificativa
    // ------------------------------------------------------------------------
    try {
      const res = await makeRequest(
        app,
        'POST',
        '/api/bi/crm/deals/1/transferir',
        { 'Authorization': `Bearer ${adminToken}` },
        {
          novo_cod_vendedor: '000004',
          justificativa: '    '
        }
      );

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error?.code, 'JUSTIFICATIVA_OBRIGATORIA');

      testPass('Cenário 6: Bloqueio sem justificativa (400 JUSTIFICATIVA_OBRIGATORIA)');
    } catch (err) {
      testFail('Cenário 6: Bloqueio sem justificativa', err);
    }

    // ------------------------------------------------------------------------
    // Cenário 7: Bloqueio para vendedor inexistente
    // ------------------------------------------------------------------------
    try {
      const dealInvalido = await crmEngine.criarDeal({
        titulo: 'Oportunidade Teste Vend Inexistente',
        cliente_nome: 'Cliente Teste Invalido',
        cliente_cnpj: '12345678000100',
        valor_total: 9000,
        cod_vendedor: '000064',
        nome_vendedor: 'Andrea'
      }, { username: 'andrea', name: 'Andrea', role: 'vendedor' });

      const res = await makeRequest(
        app,
        'POST',
        `/api/bi/crm/deals/${dealInvalido.id}/transferir`,
        { 'Authorization': `Bearer ${adminToken}` },
        {
          novo_cod_vendedor: '999999', // Código inexistente
          justificativa: 'Tentativa para vendedor falso'
        }
      );

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error?.code, 'VENDEDOR_NAO_ENCONTRADO');

      testPass('Cenário 7: Bloqueio para vendedor inexistente (400 VENDEDOR_NAO_ENCONTRADO)');
    } catch (err) {
      testFail('Cenário 7: Bloqueio para vendedor inexistente', err);
    }

  } finally {
    // Restaura cache original
    if (originalCacheRaw) {
      fs.writeFileSync(cacheFile, originalCacheRaw, 'utf8');
    }
    db.logUserActivity = originalLogUserActivity;
    db.getConfigMetasVendasDB = originalGetConfigMetas;
  }

  console.log('\n---------------------------------------------------------------');
  console.log(`TOTAL DE TESTES: ${passed + failed} | APROVADOS: ${passed} | FALHAS: ${failed}`);
  console.log('---------------------------------------------------------------\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Falha crítica na execução da suíte de testes:', err);
  process.exit(1);
});
