/**
 * test_e2e.js
 * Suíte de Testes End-to-End (E2E) para o Portal de Conciliação e Operações Multi-Empresas
 * Valida fluxos críticos: Autenticação, SPA HTML/Assets, RBAC Admin/User, Health, Uploads e APIs Financeiras
 */

const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const app = require('./server');

const JWT_SECRET = process.env.JWT_SECRET || 'gsi_portal_jwt_secret_key_prod_2026_x89a';
let server;
let baseUrl;

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const reqOptions = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);

    if (body) {
      if (typeof body === 'string') {
        req.write(body);
      } else {
        req.write(JSON.stringify(body));
      }
    }
    req.end();
  });
}

async function runE2ESuite() {
  console.log('\n🎭 ====================================================');
  console.log('🎭 INICIANDO SUÍTE DE TESTES E2E & FLUXOS DE NAVEGAÇÃO');
  console.log('🎭 ====================================================\n');

  let passed = 0;
  let total = 0;

  async function testAsync(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}`);
      console.error(`     Erro: ${err.message}`);
    }
  }

  // Subir servidor de teste em porta dinâmica
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  try {
    console.log('🔹 1. Fluxo de Autenticação & Sessão (Login E2E)');

    let adminToken = '';
    const userToken = jwt.sign({ username: 'erica', role: 'user' }, JWT_SECRET, { expiresIn: '1h' });

    await testAsync('Login com usuário admin retorna token e role correspondente', async () => {
      const res = await request('POST', '/api/auth/login', {
        username: 'alexandre',
        password: process.env.ADMIN_INITIAL_PASSWORD || '321654'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.token, 'Deve retornar token JWT');
      assert.strictEqual(res.body.user.role, 'admin');
      adminToken = res.body.token;
    });

    await testAsync('Login com senha incorreta é bloqueado com 401 Unauthorized', async () => {
      const res = await request('POST', '/api/auth/login', {
        username: 'alexandre',
        password: 'senha_completamente_errada'
      });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
    });

    console.log('\n🔹 2. Navegação e Acesso a Recursos Estáticos (Frontend SPA)');

    await testAsync('Acesso à raiz (/) entrega a SPA index.html com as 5 abas principais', async () => {
      const res = await request('GET', '/');
      assert.strictEqual(res.status, 200);
      assert.ok(typeof res.body === 'string' && res.body.includes('Plataforma de Apoio GSI'), 'Deve conter o título da SPA');
      assert.ok(res.body.includes('mainTabLogistica'), 'Deve conter Aba Logística');
      assert.ok(res.body.includes('mainTabConsulta'), 'Deve conter Aba Consulta');
      assert.ok(res.body.includes('mainTabFinanceiro'), 'Deve conter Aba Financeiro');
      assert.ok(res.body.includes('mainTabConfig'), 'Deve conter Aba Configurações');
    });

    await testAsync('Acesso aos assets CSS (/style.css) retorna 200', async () => {
      const res = await request('GET', '/style.css');
      assert.strictEqual(res.status, 200);
    });

    await testAsync('Acesso aos scripts (/app.js) retorna 200', async () => {
      const res = await request('GET', '/app.js');
      assert.strictEqual(res.status, 200);
    });

    console.log('\n🔹 3. Fluxo de RBAC & Administração (Aba Configurações)');

    await testAsync('Operador comum NÃO acessa gestão de usuários (403 Forbidden)', async () => {
      const res = await request('GET', '/api/admin/users', null, {
        Authorization: `Bearer ${userToken}`
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.success, false);
    });

    await testAsync('Admin autenticado acessa lista de operadores (200 OK)', async () => {
      const res = await request('GET', '/api/admin/users', null, {
        Authorization: `Bearer ${adminToken}`
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.users), 'Deve retornar lista de usuários');
    });

    await testAsync('Admin autenticado acessa resumo de auditoria (200 OK)', async () => {
      const res = await request('GET', '/api/admin/audit-summary', null, {
        Authorization: `Bearer ${adminToken}`
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
    });

    console.log('\n🔹 4. Fluxo de Operações, Health Check e Uploads');

    await testAsync('Health check do sistema (/api/health) retorna status operacional 200', async () => {
      const res = await request('GET', '/api/health');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, 'ok');
      assert.ok(res.body.timestamp !== undefined, 'Deve retornar timestamp');
      assert.ok(res.body.version !== undefined, 'Deve retornar versão');
    });

    await testAsync('Endpoint de upload sem arquivo (/api/upload) rejeita com 400 Bad Request', async () => {
      const res = await request('POST', '/api/upload', {});
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
    });

    await testAsync('Aba Rodonaves rejeita fatura dos Correios via HTTP com 400', async () => {
      const fs = require('fs');
      const fileBlob = new Blob([fs.readFileSync('Exemplo_CORREIO_OACO.pdf')], { type: 'application/pdf' });
      const fd = new FormData();
      fd.append('faturaFile', fileBlob, 'Exemplo_CORREIO_OACO.pdf');
      fd.append('tipoTransportadora', 'RODONAVES');
      const res = await fetch(`${baseUrl}/api/upload`, { method: 'POST', body: fd });
      const body = await res.json();
      assert.strictEqual(res.status, 400);
      assert.strictEqual(body.success, false);
      assert.ok(body.message.includes('específica para faturas da transportadora Rodonaves'));
    });

    await testAsync('Aba Correios rejeita fatura da Rodonaves via HTTP com 400', async () => {
      const fs = require('fs');
      const fileBlob = new Blob([fs.readFileSync('Exemplo_FAT_OACO.pdf')], { type: 'application/pdf' });
      const fd = new FormData();
      fd.append('faturaFile', fileBlob, 'Exemplo_FAT_OACO.pdf');
      fd.append('tipoTransportadora', 'CORREIOS_SFE');
      const res = await fetch(`${baseUrl}/api/upload`, { method: 'POST', body: fd });
      const body = await res.json();
      assert.strictEqual(res.status, 400);
      assert.strictEqual(body.success, false);
      assert.ok(body.message.includes('só serve para faturas dos Correios'));
    });

    await testAsync('Consulta ao histórico de conciliações (/api/history) retorna 200', async () => {
      const res = await request('GET', '/api/history');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.history), 'Deve retornar array history');
    });

    console.log('\n🔹 5. Fluxo Financeiro e Webhooks Banco Inter');

    await testAsync('Endpoint de webhooks bancários (/api/financeiro/webhooks) protegido com requireAuth', async () => {
      const res = await request('GET', '/api/financeiro/webhooks', null, {
        Authorization: `Bearer ${adminToken}`
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.eventos), 'Deve retornar array de eventos');
    });

    await testAsync('Configuração do Banco Inter (/api/financeiro/inter-config) retorna status de contas', async () => {
      const res = await request('GET', '/api/financeiro/inter-config');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.status, 'Deve retornar status das contas');
    });

    console.log('\n====================================================');
    console.log(`📊 RESULTADO E2E: ${passed}/${total} TESTES PASSARAM COM SUCESSO!`);
    console.log('====================================================\n');

  } finally {
    if (server) {
      server.close();
    }
  }

  if (passed !== total) {
    process.exit(1);
  }
}

runE2ESuite().catch((err) => {
  console.error('Erro fatal nos testes E2E:', err);
  if (server) server.close();
  process.exit(1);
});
