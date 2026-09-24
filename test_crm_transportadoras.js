/**
 * test_crm_transportadoras.js
 * 
 * Bateria de Testes Automatizados para a Gestão e Espelhamento de Transportadoras Homologadas do Protheus no CRM Comercial
 * Plataforma de Apoio GSI (Gemini-Cli)
 */

const assert = require('assert');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const crmEngine = require('./crm_engine');
const crmRoutes = require('./crm_routes');

const JWT_SECRET = process.env.JWT_SECRET || 'gsi_portal_jwt_secret_key_prod_2026_x89a';
const dataDir = path.join(__dirname, 'data');
const transpCacheFile = path.join(dataDir, 'crm_transportadoras_cache.json');

function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

function makeRequest(app, method, reqPath, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const options = {
        hostname: '127.0.0.1',
        port: port,
        path: reqPath,
        method: method,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        }
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
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
        req.write(typeof body === 'object' ? JSON.stringify(body) : String(body));
      }
      req.end();
    });
  });
}

async function runTests() {
  console.log('🚀 Iniciando Bateria de Testes: Transportadoras Homologadas Protheus no CRM...');
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    return (async () => {
      try {
        await fn();
        console.log(`  ✅ [PASS] ${name}`);
        passed++;
      } catch (err) {
        console.error(`  ❌ [FAIL] ${name}:`, err.message);
        failed++;
      }
    })();
  }

  // Configuração de App Express para testes de rotas
  const app = express();
  app.use(express.json());
  app.use('/api/bi/crm', crmRoutes);

  const adminToken = generateToken({ username: 'alexandre', role: 'admin' });
  const vendedorToken = generateToken({ username: 'vendedor_teste', role: 'vendedor' });

  // 1. Teste de Leitura e Escrita do Cache Atômico
  await test('1. Cache local atômico de transportadoras', async () => {
    const cacheOriginal = await crmEngine.readTransportadorasCache();
    assert(Array.isArray(cacheOriginal.transportadoras), 'Cache deve conter array de transportadoras');
    assert(cacheOriginal.transportadoras.length > 0, 'Cache deve conter itens após a sincronização');

    // Valida estrutura de item
    const retira = cacheOriginal.transportadoras.find(t => t.codigo === '000009');
    assert(retira, 'Código 000009 (CLIENTE RETIRA) deve estar presente no cache');
    assert.strictEqual(retira.nome, 'CLIENTE RETIRA');
  });

  // 2. Teste de Sincronização das Tabelas SA4
  await test('2. Sincronização idempotente de transportadoras Protheus (SA4010/SA4160)', async () => {
    const resSync = await crmEngine.sincronizarTransportadorasProtheus({ triggeredBy: 'UNIT_TEST' });
    assert.strictEqual(resSync.success, true);
    assert(resSync.total_transportadoras >= 1100, `Esperado ao menos 1100 transportadoras, obtido: ${resSync.total_transportadoras}`);
    assert(resSync.transportadoras_ativas > 1000, 'A grande maioria deve estar ativa');
    assert.strictEqual(resSync.status, 'SINCRONIZADO');
  });

  // 3. Teste de Autocomplete por Termo (Nome, Fantasia e Retira)
  await test('3. Autocomplete de transportadoras por nome, fantasia e retira', async () => {
    // Busca "retira"
    const acRetira = await crmEngine.autocompleteTransportadoras('retira');
    assert(acRetira.length > 0, 'Deve encontrar ao menos um resultado para retira');
    assert.strictEqual(acRetira[0].codigo, '000009', 'Primeiro resultado de retira deve ser código 000009');
    assert.strictEqual(acRetira[0].nome, 'CLIENTE RETIRA');

    // Busca "braspress"
    const acBras = await crmEngine.autocompleteTransportadoras('braspress');
    assert(acBras.length > 0, 'Deve encontrar Braspress');
    assert.strictEqual(acBras[0].codigo, '000005', 'Código da Braspress deve ser 000005');

    // Busca por código "000021" (Rodonaves)
    const acCod = await crmEngine.autocompleteTransportadoras('000021');
    assert(acCod.length > 0, 'Deve encontrar transportadora pelo código 000021');
    assert(acCod[0].nome.includes('RODONAVES'), 'Transportadora 000021 deve ser Rodonaves');
  });

  // 4. Teste de Validação de Transportadora Cadastrada
  await test('4. Validação estrita de transportadora homologada', async () => {
    const valValida = await crmEngine.validarTransportadoraProtheus('000005');
    assert(valValida, 'Código 000005 deve ser validado');
    assert.strictEqual(valValida.codigo, '000005');

    const valRetira = await crmEngine.validarTransportadoraProtheus('000009');
    assert(valRetira, 'Código 000009 deve ser validado');

    const valInvalida = await crmEngine.validarTransportadoraProtheus('999998_INEXISTENTE');
    assert.strictEqual(valInvalida, null, 'Código inexistente deve retornar null');
  });

  // 5. Teste de Criação de Oportunidade com Transportadora e Código Oculto
  await test('5. Criação de Deal registrando transportadora e código oculto Protheus', async () => {
    const dealPayload = {
      titulo: 'Proposta com Braspress e FOB',
      cliente_nome: 'Empresa Teste Logística S/A',
      cliente_cnpj: '12345678000195',
      tipo_frete: 'FOB',
      transportadora: 'BRASPRESS TRANSPORTES URGENTES LTDA',
      transportadora_cod: '000005',
      valor_total: 15400.00,
      vendedor: 'Alexandre'
    };

    const dealCriado = await crmEngine.criarDeal(dealPayload, { username: 'alexandre' });
    assert(dealCriado, 'Deal deve ser criado');
    assert.strictEqual(dealCriado.transportadora, 'BRASPRESS TRANSPORTES URGENTES LTDA');
    assert.strictEqual(dealCriado.transportadora_cod, '000005', 'Código Protheus deve ser salvo no deal');
    assert.strictEqual(dealCriado.tipo_frete, 'FOB', 'Tipo de frete deve ser preservado');

    // Consulta de volta
    const dealBuscado = await crmEngine.obterDealPorId(dealCriado.id);
    assert(dealBuscado, 'Deal deve ser recuperado por ID');
    assert.strictEqual(dealBuscado.transportadora_cod, '000005', 'Código Protheus deve persistir na recuperação');
  });

  // 6. Teste de Atualização para CLIENTE RETIRA
  await test('6. Atualização de oportunidade para CLIENTE RETIRA (000009)', async () => {
    const dealPayload = {
      titulo: 'Proposta para Retirada FOB',
      cliente_nome: 'Cliente Retirada SP',
      tipo_frete: 'CIF',
      transportadora: 'BRASPRESS TRANSPORTES URGENTES LTDA',
      transportadora_cod: '000005',
      valor_total: 8000.00,
      vendedor: 'Alexandre'
    };

    const criado = await crmEngine.criarDeal(dealPayload, { username: 'alexandre' });
    const dealAtualizado = await crmEngine.atualizarDeal(criado.id, {
      tipo_frete: 'FOB',
      transportadora: 'CLIENTE RETIRA',
      transportadora_cod: '000009'
    }, { username: 'alexandre' });

    assert.strictEqual(dealAtualizado.transportadora, 'CLIENTE RETIRA');
    assert.strictEqual(dealAtualizado.transportadora_cod, '000009', 'Código deve atualizar para 000009');
    assert.strictEqual(dealAtualizado.tipo_frete, 'FOB');
  });

  // 7. Testes de API REST: Autocomplete, Sync e Status
  await test('7. Endpoint GET /api/bi/crm/transportadoras/autocomplete com token', async () => {
    const res = await makeRequest(app, 'GET', '/api/bi/crm/transportadoras/autocomplete?q=retira', {
      'Authorization': `Bearer ${adminToken}`
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert(Array.isArray(res.body.data), 'body.data deve ser array');
    assert(res.body.data.length > 0, 'Deve retornar ao menos 1 resultado');
    assert.strictEqual(res.body.data[0].codigo, '000009');
  });

  await test('8. Endpoint GET /api/bi/crm/transportadoras/status', async () => {
    const res = await makeRequest(app, 'GET', '/api/bi/crm/transportadoras/status', {
      'Authorization': `Bearer ${adminToken}`
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert(res.body.data.total_transportadoras >= 1100);
    assert(res.body.data.transportadoras_ativas > 1000);
  });

  await test('9. Endpoint POST /api/bi/crm/transportadoras/sync', async () => {
    const res = await makeRequest(app, 'POST', '/api/bi/crm/transportadoras/sync', {
      'Authorization': `Bearer ${adminToken}`
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.data.status, 'SINCRONIZADO');
  });

  await test('10. Segurança: Bloqueio 401 para requisições sem autenticação', async () => {
    const res = await makeRequest(app, 'GET', '/api/bi/crm/transportadoras/autocomplete?q=bras');
    assert.strictEqual(res.status, 401, 'Requisição sem token deve retornar 401 Unauthorized');
  });

  console.log(`\n==================================================`);
  console.log(`Bateria de Testes Finalizada: ${passed} passaram, ${failed} falharam.`);
  console.log(`==================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Erro fatal nos testes:', err);
  process.exit(1);
});
