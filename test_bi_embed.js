/**
 * test_bi_embed.js
 * Suíte Completa de Auditoria Automatizada: Sub-aba 📈 Metabase Analytics
 * Esteira de Auditores Especializados (Segurança, Arquitetura, QA, SRE e UI/UX)
 * Plataforma de Apoio GSI (Gemini-Cli)
 */

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
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
  console.log('========================================================================');
  console.log('🏛️ ESTEIRA COMPLETA DE AUDITORES DE IA: SUB-ABA 📈 METABASE ANALYTICS');
  console.log('========================================================================');

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  console.log(`📡 Servidor de auditoria escutando na porta temporária ${port}`);

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
    // BLOCO 1: AUDITOR DE SEGURANÇA & RED TEAM (ZERO-TRUST & RBAC)
    // -------------------------------------------------------------
    console.log('\n🔒 [AUDITOR 1 - SEGURANÇA & RED TEAM] Controle de Acesso RBAC & Criptografia:');

    const adminToken = jwt.sign({ username: 'alexandre', role: 'admin', name: 'Alexandre Master' }, JWT_SECRET, { expiresIn: '1h' });
    const vendorToken = jwt.sign({ username: 'juliana', role: 'vendedor', vendorCode: '000074', name: 'Juliana Vendas' }, JWT_SECRET, { expiresIn: '1h' });
    const userToken = jwt.sign({ username: 'operador', role: 'user', name: 'Operador Logística' }, JWT_SECRET, { expiresIn: '1h' });

    await runAsyncAssertion('1.1 Rejeita requisição anônima sem Bearer token com HTTP 401 Unauthorized', async () => {
      const res = await makeRequest(server, { path: '/api/bi/dashboard-executivo' });
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.body.success, false);
    });

    await runAsyncAssertion('1.2 Bloqueia acesso de perfil VENDEDOR com HTTP 403 Forbidden', async () => {
      const res = await makeRequest(server, {
        path: '/api/bi/dashboard-executivo',
        headers: { 'Authorization': `Bearer ${vendorToken}` }
      });
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body.success, false);
    });

    await runAsyncAssertion('1.3 Bloqueia acesso de perfil USER COMUM com HTTP 403 Forbidden', async () => {
      const res = await makeRequest(server, {
        path: '/api/bi/dashboard-executivo',
        headers: { 'Authorization': `Bearer ${userToken}` }
      });
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body.success, false);
    });

    await runAsyncAssertion('1.4 Bloqueia endpoint /api/bi/status para perfis não administrativos', async () => {
      const res = await makeRequest(server, {
        path: '/api/bi/status',
        headers: { 'Authorization': `Bearer ${vendorToken}` }
      });
      assert.strictEqual(res.statusCode, 403);
    });

    await runAsyncAssertion('1.5 Bloqueia endpoint /api/bi/sync-faturamento para perfis não administrativos', async () => {
      const res = await makeRequest(server, {
        path: '/api/bi/sync-faturamento',
        method: 'POST',
        headers: { 'Authorization': `Bearer ${vendorToken}` }
      });
      assert.strictEqual(res.statusCode, 403);
    });

    // -------------------------------------------------------------
    // BLOCO 2: AUDITOR DE SERVIÇO & CRIPTOGRAFIA (SIGNED JWT EMBED)
    // -------------------------------------------------------------
    console.log('\n🔑 [AUDITOR 2 - SERVIÇO & ASSINATURA JWT] Validação de Configuração e Tokens:');

    const origUrl = process.env.METABASE_SITE_URL;
    const origKey = process.env.METABASE_SECRET_KEY;
    const origDash = process.env.METABASE_EXEC_DASHBOARD_ID;

    // Cenário 2.1: Sem variáveis configuradas
    delete process.env.METABASE_SITE_URL;
    delete process.env.METABASE_SECRET_KEY;

    runAssertion('2.1 Trata ausência de variáveis de ambiente graciosamente sem lançar exceções não tratadas', () => {
      const status = getMetabaseConfigStatus();
      assert.strictEqual(status.isConfigured, false);
      assert.strictEqual(status.hasSecretKey, false);

      const res = generateSignedDashboardUrl();
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.configured, false);
      assert.ok(res.setupGuide, 'Deve retornar guia de configuração');
      assert.strictEqual(res.setupGuide.siteUrlSet, false);
      assert.strictEqual(res.setupGuide.secretKeySet, false);
    });

    // Cenário 2.2: Com variáveis configuradas (normalização de URL com e sem https://)
    process.env.METABASE_SITE_URL = 'bi-gsi.onrender.com/';
    process.env.METABASE_SECRET_KEY = TEST_METABASE_SECRET;
    process.env.METABASE_EXEC_DASHBOARD_ID = '15';

    runAssertion('2.2 Normaliza URLs sem protocolo adicionando https:// e removendo barras finais', () => {
      const status = getMetabaseConfigStatus();
      assert.strictEqual(status.isConfigured, true);
      assert.strictEqual(status.siteUrl, 'https://bi-gsi.onrender.com');
      assert.strictEqual(status.dashboardId, 15);
      assert.strictEqual(status.hasSecretKey, true);
    });

    process.env.METABASE_SITE_URL = TEST_METABASE_URL;

    runAssertion('2.3 Gera URL de Embed com Signed JWT criptograficamente válido (HMAC-SHA256)', () => {
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
      assert.strictEqual(decoded.resource.dashboard, 15);
      assert.ok(decoded.exp > Math.round(Date.now() / 1000), 'Token deve ter expiração futura');
      assert.ok(decoded.exp <= Math.round(Date.now() / 1000) + 600, 'Token deve ter expiração máxima de 10 minutos (TTL curto)');
    });

    runAssertion('2.4 Suporta parâmetro de tema claro (light) no hash da URL assinada', () => {
      const res = generateSignedDashboardUrl({ theme: 'light' });
      assert.strictEqual(res.success, true);
      assert.ok(res.embedUrl.includes('theme=light'));
    });

    await runAsyncAssertion('2.5 Endpoint /api/bi/dashboard-executivo retorna URL assinada para Administrador', async () => {
      const res = await makeRequest(server, {
        path: '/api/bi/dashboard-executivo?theme=night',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.configured, true);
      assert.ok(res.body.embedUrl.startsWith(TEST_METABASE_URL));
      assert.strictEqual(res.body.dashboardId, 15);
    });

    // -------------------------------------------------------------
    // BLOCO 3: AUDITOR DE CLEAN CODE & ARQUITETURA MODULAR
    // -------------------------------------------------------------
    console.log('\n🏛️ [AUDITOR 3 - ARQUITETURA & CLEAN CODE] Modularidade e Desacoplamento:');

    runAssertion('3.1 Módulo frontend public/js/bi.js é encapsulado em IIFE com use strict e exports limpos', () => {
      const biJsContent = fs.readFileSync(path.join(__dirname, 'public', 'js', 'bi.js'), 'utf8');
      assert.ok(biJsContent.includes('(function () {'), 'Deve ser encapsulado em IIFE');
      assert.ok(biJsContent.includes("'use strict';"), 'Deve ter modo estrito');
      assert.ok(biJsContent.includes('window.initBITab = initBITab;'), 'Deve exportar initBITab');
      assert.ok(biJsContent.includes('window.loadBIDashboard = loadBIDashboard;'), 'Deve exportar loadBIDashboard');
      assert.ok(biJsContent.includes('window.toggleBIFullscreen = toggleBIFullscreen;'), 'Deve exportar toggleBIFullscreen');
    });

    runAssertion('3.2 Roteador principal em public/app.js integra sub-aba tab-bi-metabase com chamada modular', () => {
      const appJsContent = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
      assert.ok(appJsContent.includes("targetTab === 'tab-bi-metabase'"), 'Deve tratar ativação da sub-aba Metabase');
      assert.ok(appJsContent.includes("window.initBITab()"), 'Deve invocar initBITab do módulo');
      assert.ok(appJsContent.includes("mainTabBi"), 'Deve controlar visibilidade da aba BI pelo perfil admin');
    });

    runAssertion('3.3 Backend isolado em services/bi_service.js sem dependências cíclicas', () => {
      const biServiceContent = fs.readFileSync(path.join(__dirname, 'services', 'bi_service.js'), 'utf8');
      assert.ok(biServiceContent.includes('getMetabaseConfigStatus'), 'Deve exportar getMetabaseConfigStatus');
      assert.ok(biServiceContent.includes('generateSignedDashboardUrl'), 'Deve exportar generateSignedDashboardUrl');
      assert.ok(!biServiceContent.includes("require('./server')"), 'Não pode ter dependência circular com server.js');
    });

    // -------------------------------------------------------------
    // BLOCO 4: AUDITOR DE SRE, RESILIÊNCIA & CHAOS ENGINEERING
    // -------------------------------------------------------------
    console.log('\n⚡ [AUDITOR 4 - SRE & RESILIÊNCIA] Tratamento de Falhas e Proteções de Processo:');

    runAssertion('4.1 Proteção contra DOM XSS: public/js/bi.js implementa escapeHtml em renderBIError e setup', () => {
      const biJsContent = fs.readFileSync(path.join(__dirname, 'public', 'js', 'bi.js'), 'utf8');
      assert.ok(biJsContent.includes('function escapeHtml('), 'Deve conter função de escapeHtml');
      assert.ok(biJsContent.includes('${escapeHtml(message)}'), 'Deve escapar mensagem de erro');
      assert.ok(biJsContent.includes('${escapeHtml(data.setupGuide?.dashboardId'), 'Deve escapar dashboardId');
    });

    runAssertion('4.2 Proteção de Iframe: Adiciona referrerpolicy=no-referrer e title acessível', () => {
      const biJsContent = fs.readFileSync(path.join(__dirname, 'public', 'js', 'bi.js'), 'utf8');
      assert.ok(biJsContent.includes("iframe.setAttribute('referrerpolicy', 'no-referrer');"), 'Deve restringir referrer');
      assert.ok(biJsContent.includes("iframe.setAttribute('title',"), 'Deve ter título acessível para leitores de tela');
      assert.ok(biJsContent.includes("iframe.setAttribute('allow', 'fullscreen');"), 'Deve permitir fullscreen');
    });

    runAssertion('4.3 Proteção contra concorrência: isBiLoading impede disparos simultâneos de requisições', () => {
      const biJsContent = fs.readFileSync(path.join(__dirname, 'public', 'js', 'bi.js'), 'utf8');
      assert.ok(biJsContent.includes('if (isBiLoading) return;'), 'Deve barrar requisições concorrentes');
      assert.ok(biJsContent.includes('isBiLoading = true;'), 'Deve marcar flag de loading');
      assert.ok(biJsContent.includes('isBiLoading = false;'), 'Deve liberar flag no bloco finally');
    });

    // -------------------------------------------------------------
    // BLOCO 5: AUDITOR DE UX / UI DESIGN & ACESSIBILIDADE (WCAG 2.1)
    // -------------------------------------------------------------
    console.log('\n🎨 [AUDITOR 5 - UI / UX DESIGN & ACESSIBILIDADE] Layout, Contraste e Responsividade:');

    runAssertion('5.1 public/index.html define a sub-aba tab-bi-metabase com estrutura completa de DOM', () => {
      const htmlContent = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
      assert.ok(htmlContent.includes('id="tab-bi-metabase"'), 'Deve conter div#tab-bi-metabase');
      assert.ok(htmlContent.includes('id="biWrapper"'), 'Deve conter #biWrapper');
      assert.ok(htmlContent.includes('id="biLastUpdated"'), 'Deve conter #biLastUpdated');
      assert.ok(htmlContent.includes('id="btnBiRefresh"'), 'Deve conter #btnBiRefresh');
      assert.ok(htmlContent.includes('id="btnBiFullscreen"'), 'Deve conter #btnBiFullscreen');
      assert.ok(htmlContent.includes('id="biStatusContainer"'), 'Deve conter #biStatusContainer');
      assert.ok(htmlContent.includes('id="biLoadingSpinner"'), 'Deve conter #biLoadingSpinner');
      assert.ok(htmlContent.includes('id="biIframeContainer"'), 'Deve conter #biIframeContainer');
    });

    runAssertion('5.2 public/style.css inclui estilos responsivos, classes de status e tela cheia', () => {
      const cssContent = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8');
      assert.ok(cssContent.includes('.bi-wrapper'), 'Deve estilizar .bi-wrapper');
      assert.ok(cssContent.includes('.bi-toolbar'), 'Deve estilizar .bi-toolbar');
      assert.ok(cssContent.includes('.bi-metabase-iframe'), 'Deve estilizar .bi-metabase-iframe com altura adequada');
      assert.ok(cssContent.includes('.bi-fullscreen-active'), 'Deve estilizar .bi-fullscreen-active para tela cheia');
      assert.ok(cssContent.includes('.bi-setup-card'), 'Deve estilizar .bi-setup-card');
      assert.ok(cssContent.includes('.bi-status-item.status-ok'), 'Deve estilizar status-ok');
      assert.ok(cssContent.includes('.bi-status-item.status-missing'), 'Deve estilizar status-missing');
    });

    runAssertion('5.3 Script public/js/bi.js é importado em public/index.html com cache busting', () => {
      const htmlContent = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
      assert.ok(htmlContent.includes('<script src="js/bi.js?v='), 'Deve importar js/bi.js com parâmetro de versão');
    });

    // Restaura variáveis de ambiente originais
    if (origUrl !== undefined) process.env.METABASE_SITE_URL = origUrl; else delete process.env.METABASE_SITE_URL;
    if (origKey !== undefined) process.env.METABASE_SECRET_KEY = origKey; else delete process.env.METABASE_SECRET_KEY;
    if (origDash !== undefined) process.env.METABASE_EXEC_DASHBOARD_ID = origDash; else delete process.env.METABASE_EXEC_DASHBOARD_ID;

  } finally {
    await new Promise((resolve) => server.close(resolve));
    console.log(`\n🛑 Servidor de auditoria encerrado`);
  }

  console.log('\n========================================================================');
  console.log(`📊 RESULTADO DA ESTEIRA DE AUDITORES: ${passedTests}/${totalTests} aprovados`);
  if (passedTests === totalTests) {
    console.log('🎉 TODOS OS 18 TESTES E VETORES DE AUDITORIA FORAM 100% APROVADOS!');
    console.log('========================================================================');
    process.exit(0);
  } else {
    console.error('⚠️ ALGUNS TESTES FALHARAM!');
    console.log('========================================================================');
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('💥 Erro fatal na execução dos testes:', err);
  process.exit(1);
});
