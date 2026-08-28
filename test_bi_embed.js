/**
 * test_bi_embed.js
 * Suíte de Testes Automatizados: Módulo de BI Executivo Embutido (Metabase)
 * Plataforma de Apoio GSI (Gemini-Cli)
 */

const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const app = require('./server');
const { getMetabaseConfigStatus, generateSignedDashboardUrl } = require('./services/bi_service');

const JWT_SECRET = process.env.JWT_SECRET || 'gsi_portal_jwt_secret_key_prod_2026_x89a';
const TEST_METABASE_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const TEST_METABASE_URL = 'https://metabase-test.gsi.com.br';

function makeRequest(server, options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      path: options.path,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed });
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
  console.log('===============================================================');
  console.log('🧪 INICIANDO SUÍTE DE TESTES: MÓDULO BI EXECUTIVO (METABASE)');
  console.log('===============================================================');

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  console.log(`📡 Servidor de teste escutando na porta temporária ${port}`);

  let passedTests = 0;
  let totalTests = 0;

  function runAssertion(desc, fn) {
    totalTests++;
    try {
      fn();
      console.log(`  ✅ [PASS] ${desc}`);
      passedTests++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${desc}`);
      console.error(`     Erro: ${err.message}`);
    }
  }

  async function runAsyncAssertion(desc, fn) {
    totalTests++;
    try {
      await fn();
      console.log(`  ✅ [PASS] ${desc}`);
      passedTests++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${desc}`);
      console.error(`     Erro: ${err.message}`);
    }
  }

  try {
    // -------------------------------------------------------------
    // BLOCO 1: Testes de Serviço e Validação de Variáveis de Ambiente
    // -------------------------------------------------------------
    console.log('\n--- BLOCO 1: Validação de Configuração do Serviço de BI ---');

    const origUrl = process.env.METABASE_SITE_URL;
    const origKey = process.env.METABASE_SECRET_KEY;
    const origDash = process.env.METABASE_EXEC_DASHBOARD_ID;

    // Cenário 1.1: Sem variáveis configuradas
    delete process.env.METABASE_SITE_URL;
    delete process.env.METABASE_SECRET_KEY;

    runAssertion('Detecta status não configurado graciosamente quando envs estão ausentes', () => {
      const status = getMetabaseConfigStatus();
      assert.strictEqual(status.isConfigured, false);
      assert.strictEqual(status.hasSecretKey, false);

      const res = generateSignedDashboardUrl();
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.configured, false);
      assert.ok(res.setupGuide, 'Deve retornar guia de configuração');
    });

    // Cenário 1.2: Com variáveis de teste configuradas
    process.env.METABASE_SITE_URL = TEST_METABASE_URL;
    process.env.METABASE_SECRET_KEY = TEST_METABASE_SECRET;
    process.env.METABASE_EXEC_DASHBOARD_ID = '42';

    runAssertion('Detecta status configurado corretamente e gera URL assinada', () => {
      const status = getMetabaseConfigStatus();
      assert.strictEqual(status.isConfigured, true);
      assert.strictEqual(status.siteUrl, TEST_METABASE_URL);
      assert.strictEqual(status.dashboardId, 42);
      assert.strictEqual(status.hasSecretKey, true);

      const res = generateSignedDashboardUrl({ theme: 'night' });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.configured, true);
      assert.ok(res.embedUrl.startsWith(TEST_METABASE_URL + '/embed/dashboard/'));
      assert.ok(res.embedUrl.includes('#bordered=false&titled=false&theme=night'));

      // Valida assinatura do token gerado
      const tokenMatch = res.embedUrl.match(/\/embed\/dashboard\/([^#]+)/);
      assert.ok(tokenMatch, 'Deve conter token JWT na URL');
      const token = tokenMatch[1];
      const decoded = jwt.verify(token, TEST_METABASE_SECRET);
      assert.strictEqual(decoded.resource.dashboard, 42);
      assert.ok(decoded.exp > Math.round(Date.now() / 1000), 'Token deve ter expiração futura');
    });

    // -------------------------------------------------------------
    // BLOCO 2: Testes de Segurança HTTP e Controle de Acesso (RBAC)
    // -------------------------------------------------------------
    console.log('\n--- BLOCO 2: Segurança HTTP & Controle de Acesso RBAC ---');

    const adminToken = jwt.sign({ username: 'alexandre', role: 'admin', name: 'Alexandre' }, JWT_SECRET, { expiresIn: '1h' });
    const vendorToken = jwt.sign({ username: 'juliana', role: 'vendedor', vendorCode: '000074', name: 'Juliana' }, JWT_SECRET, { expiresIn: '1h' });
    const userToken = jwt.sign({ username: 'operador', role: 'user', name: 'Operador' }, JWT_SECRET, { expiresIn: '1h' });

    await runAsyncAssertion('Rejeita acesso não autenticado com 401 Unauthorized', async () => {
      const res = await makeRequest(server, { path: '/api/bi/dashboard-executivo' });
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.body.success, false);
    });

    await runAsyncAssertion('Bloqueia acesso de Vendedor com 403 Forbidden', async () => {
      const res = await makeRequest(server, {
        path: '/api/bi/dashboard-executivo',
        headers: { 'Authorization': `Bearer ${vendorToken}` }
      });
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body.success, false);
    });

    await runAsyncAssertion('Bloqueia acesso de Usuário Operador com 403 Forbidden', async () => {
      const res = await makeRequest(server, {
        path: '/api/bi/dashboard-executivo',
        headers: { 'Authorization': `Bearer ${userToken}` }
      });
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body.success, false);
    });

    await runAsyncAssertion('Permite acesso de Administrador (CEO/CFO) com 200 OK e URL assinada', async () => {
      const res = await makeRequest(server, {
        path: '/api/bi/dashboard-executivo?theme=light',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.configured, true);
      assert.ok(res.body.embedUrl.includes('theme=light'));
    });

    await runAsyncAssertion('Endpoint /api/bi/status retorna metadados de configuração para admin', async () => {
      const res = await makeRequest(server, {
        path: '/api/bi/status',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.isConfigured, true);
      assert.strictEqual(res.body.dashboardId, 42);
    });

    // Restaura variáveis de ambiente originais
    if (origUrl !== undefined) process.env.METABASE_SITE_URL = origUrl; else delete process.env.METABASE_SITE_URL;
    if (origKey !== undefined) process.env.METABASE_SECRET_KEY = origKey; else delete process.env.METABASE_SECRET_KEY;
    if (origDash !== undefined) process.env.METABASE_EXEC_DASHBOARD_ID = origDash; else delete process.env.METABASE_EXEC_DASHBOARD_ID;

  } finally {
    await new Promise((resolve) => server.close(resolve));
    console.log(`\n🛑 Servidor de teste encerrado`);
  }

  console.log('\n===============================================================');
  console.log(`📊 RESULTADO DA SUÍTE DE TESTES: ${passedTests}/${totalTests} aprovados`);
  if (passedTests === totalTests) {
    console.log('🎉 TODOS OS TESTES FORAM APROVADOS COM SUCESSO!');
    console.log('===============================================================');
    process.exit(0);
  } else {
    console.error('⚠️ ALGUNS TESTES FALHARAM!');
    console.log('===============================================================');
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('💥 Erro fatal na execução dos testes:', err);
  process.exit(1);
});
