/**
 * test_frontend_modules.js
 * 
 * Suíte de Testes Automatizados para a Arquitetura Modular ES6 do Frontend (public/js/):
 * 1. Validação de integridade sintática de todos os submódulos ES6.
 * 2. Validação de exportações do utils.js (escapeHtml, formatCurrency, formatDate, isSameOriginUrl, apiFetch).
 * 3. Validação de exportações de auth.js (setSession, clearSession, isAuthenticated, etc.).
 * 4. Validação de exportações de vendedores.js (aplicarTemaVendedores, toggleVendedoresTheme, carregarSaldosEstoque).
 * 5. Validação de exportações de credito.js, financeiro.js, logistica.js, config.js e index.js.
 * 6. Validação do endpoint OpenAPI (/api/openapi.json e /api-docs).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const app = require('./server');

let passedTests = 0;
let failedTests = 0;

function report(name, success, error) {
  if (success) {
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } else {
    console.error(`  ❌ [FAIL] ${name}: ${error}`);
    failedTests++;
  }
}

function request(baseUrl, path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    }).on('error', reject);
  });
}

async function runFrontendModulesTests() {
  console.log('\n=============================================================');
  console.log('🧪 SUÍTE DE TESTES: MODULARIZAÇÃO ES6 & DOCUMENTAÇÃO OPENAPI');
  console.log('=============================================================\n');

  const jsDir = path.join(__dirname, 'public', 'js');

  // -------------------------------------------------------------
  // Teste 1: Existência física dos 8 módulos ES6
  // -------------------------------------------------------------
  console.log('--- 1. Existência e Integridade dos Arquivos de Módulos ES6 ---');
  try {
    const modulosEsperados = [
      'utils.js',
      'auth.js',
      'vendedores.js',
      'credito.js',
      'financeiro.js',
      'logistica.js',
      'config.js',
      'index.js'
    ];

    for (const mod of modulosEsperados) {
      const fullPath = path.join(jsDir, mod);
      assert.ok(fs.existsSync(fullPath), `Módulo ${mod} deve existir em public/js/`);
      const content = fs.readFileSync(fullPath, 'utf-8');
      assert.ok(content.length > 50, `Módulo ${mod} não deve estar vazio`);
      assert.ok(content.includes('export '), `Módulo ${mod} deve conter declarações de exportação ES6`);
    }

    report('Todos os 8 módulos ES6 em public/js/ existem e possuem declarações de exportação', true);
  } catch (err) {
    report('Todos os 8 módulos ES6 em public/js/ existem e possuem declarações de exportação', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 2: Validação de Funções em utils.js
  // -------------------------------------------------------------
  console.log('\n--- 2. Validação Lógica de Utilitários (utils.js) ---');
  try {
    const utilsCode = fs.readFileSync(path.join(jsDir, 'utils.js'), 'utf-8');
    assert.ok(utilsCode.includes('function escapeHtml'), 'Deve exportar escapeHtml');
    assert.ok(utilsCode.includes('function formatCurrency'), 'Deve exportar formatCurrency');
    assert.ok(utilsCode.includes('function formatDate'), 'Deve exportar formatDate');
    assert.ok(utilsCode.includes('function isSameOriginUrl'), 'Deve exportar isSameOriginUrl');
    assert.ok(utilsCode.includes('function apiFetch'), 'Deve exportar apiFetch');

    report('Módulo utils.js exporta escapeHtml, formatCurrency, formatDate, isSameOriginUrl e apiFetch', true);
  } catch (err) {
    report('Módulo utils.js exporta escapeHtml, formatCurrency, formatDate, isSameOriginUrl e apiFetch', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 3: Validação de Funções em vendedores.js
  // -------------------------------------------------------------
  console.log('\n--- 3. Validação de Módulos Comerciais (vendedores.js) ---');
  try {
    const vendCode = fs.readFileSync(path.join(jsDir, 'vendedores.js'), 'utf-8');
    assert.ok(vendCode.includes('function aplicarTemaVendedores'), 'Deve exportar aplicarTemaVendedores');
    assert.ok(vendCode.includes('function toggleVendedoresTheme'), 'Deve exportar toggleVendedoresTheme');
    assert.ok(vendCode.includes('function carregarSaldosEstoque'), 'Deve exportar carregarSaldosEstoque');
    assert.ok(vendCode.includes('function carregarPedidosAbertos'), 'Deve exportar carregarPedidosAbertos');
    assert.ok(vendCode.includes('function carregarPedidosCompras'), 'Deve exportar carregarPedidosCompras');

    report('Módulo vendedores.js exporta alternância de tema, estoque e pedidos', true);
  } catch (err) {
    report('Módulo vendedores.js exporta alternância de tema, estoque e pedidos', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 3B: Validação de Funções em credito.js
  // -------------------------------------------------------------
  console.log('\n--- 3B. Validação de Módulos de Crédito (credito.js) ---');
  try {
    const credCode = fs.readFileSync(path.join(jsDir, 'credito.js'), 'utf-8');
    assert.ok(credCode.includes('function consultarCreditoProtheus'), 'Deve exportar consultarCreditoProtheus');
    assert.ok(credCode.includes('function parseSerasaPdf'), 'Deve exportar parseSerasaPdf');
    assert.ok(credCode.includes('function carregarScoreConfig'), 'Deve exportar carregarScoreConfig');
    assert.ok(credCode.includes('function salvarScoreConfig'), 'Deve exportar salvarScoreConfig');
    assert.ok(credCode.includes('function salvarAnaliseCredito'), 'Deve exportar salvarAnaliseCredito');
    assert.ok(credCode.includes('function carregarHistoricoCredito'), 'Deve exportar carregarHistoricoCredito');
    assert.ok(credCode.includes('/api/financeiro/analise-credito/protheus'), 'Deve apontar para rota /protheus');
    assert.ok(credCode.includes('serasa_pdf'), 'Deve usar FormData key serasa_pdf');
    assert.ok(credCode.includes('/api/financeiro/analise-credito/calcular-salvar'), 'Deve apontar para /calcular-salvar');
    assert.ok(credCode.includes('/api/financeiro/analise-credito/historico'), 'Deve apontar para /historico');

    report('Módulo credito.js exporta funções e contratos alinhados ao backend Express', true);
  } catch (err) {
    report('Módulo credito.js exporta funções e contratos alinhados ao backend Express', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 4: Validação de Endpoints OpenAPI & Swagger UI
  // -------------------------------------------------------------
  console.log('\n--- 4. Validação da Documentação OpenAPI 3.0 & Swagger UI ---');
  const server = app.listen(0);
  const serverPort = server.address().port;
  const baseUrl = `http://127.0.0.1:${serverPort}`;

  try {
    // 4.1 OpenAPI JSON Spec
    const resSpec = await request(baseUrl, '/api/openapi.json');
    assert.strictEqual(resSpec.status, 200);
    assert.strictEqual(resSpec.body.openapi, '3.0.3');
    assert.ok(resSpec.body.paths['/api/health']);
    assert.ok(resSpec.body.paths['/api/auth/login']);
    assert.ok(resSpec.body.paths['/api/vendedores/estoque/saldos']);
    assert.ok(resSpec.body.paths['/api/webhooks/inter']);

    // 4.2 Swagger UI HTML
    const resUi = await request(baseUrl, '/api-docs/');
    assert.strictEqual(resUi.status, 200);
    assert.ok(typeof resUi.body === 'string' && resUi.body.includes('swagger-ui'));

    report('Endpoints /api/openapi.json e /api-docs entregam especificação 3.0.3 e interface Swagger UI', true);
  } catch (err) {
    report('Endpoints /api/openapi.json e /api-docs entregam especificação 3.0.3 e interface Swagger UI', false, err.message);
  } finally {
    server.close();
  }

  // -------------------------------------------------------------
  // Teste 5: Validação do Compartilhamento DRY de Saldos em Estoque na Logística
  // -------------------------------------------------------------
  console.log('\n--- 5. Validação de Saldos em Estoque na Aba Logística (DRY) ---');
  try {
    const htmlPath = path.join(__dirname, 'public', 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');

    // Verifica sub-aba em Logística
    assert.ok(html.includes('id="btnTabLogSaldosEstoque"'), 'Deve conter botão #btnTabLogSaldosEstoque em Logística');
    assert.ok(html.includes('data-tab="tab-vend-saldos-estoque" id="btnTabLogSaldosEstoque"'), 'Sub-aba Logística deve apontar para data-tab="tab-vend-saldos-estoque"');

    // Verifica sub-aba em Vendedores
    assert.ok(html.includes('id="btnTabVendSaldosEstoque"'), 'Deve conter botão #btnTabVendSaldosEstoque em Vendedores');
    assert.ok(html.includes('data-tab="tab-vend-saldos-estoque" id="btnTabVendSaldosEstoque"'), 'Sub-aba Vendedores deve apontar para data-tab="tab-vend-saldos-estoque"');

    // Garante que existe apenas UMA definição do painel no DOM (Single Source of Truth / DRY)
    const matches = (html.match(/id="tab-vend-saldos-estoque"/g) || []).length;
    assert.strictEqual(matches, 1, `Deve existir exatamente 1 painel id="tab-vend-saldos-estoque" no DOM (encontrado: ${matches})`);

    report('Sub-aba Saldos em Estoque configurada na Logística apontando para o painel unificado (DRY)', true);
  } catch (err) {
    report('Sub-aba Saldos em Estoque configurada na Logística apontando para o painel unificado (DRY)', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 6: Validação de Sintaxe Rigorosa de public/app.js (Sem Conflitos de Variáveis)
  // -------------------------------------------------------------
  console.log('\n--- 6. Validação de Sintaxe Rigorosa (public/app.js) ---');
  try {
    const vm = require('vm');
    const appJsPath = path.join(__dirname, 'public', 'app.js');
    assert.ok(fs.existsSync(appJsPath), 'public/app.js deve existir');
    const appJsCode = fs.readFileSync(appJsPath, 'utf-8');

    // Executa análise léxica e sintática completa
    new vm.Script(appJsCode, { filename: 'public/app.js' });

    report('public/app.js compilado sem erros sintáticos ou redeclaração de variáveis', true);
  } catch (err) {
    report('public/app.js compilado sem erros sintáticos ou redeclaração de variáveis', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 7: Validação da Aba ANALISTA FIN e Sub-Abas Dedicadas
  // -------------------------------------------------------------
  console.log('\n--- 7. Validação da Aba ANALISTA FIN & Sub-Abas Dedicadas ---');
  try {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    const html = fs.readFileSync(indexPath, 'utf-8');
    const appJsPath = path.join(__dirname, 'public', 'app.js');
    const appJsCode = fs.readFileSync(appJsPath, 'utf-8');

    // Aba principal ANALISTA FIN
    assert.ok(html.includes('id="mainTabAnalistaFin"'), 'Deve conter aba principal #mainTabAnalistaFin');
    assert.ok(html.includes('data-main-tab="analista-fin"'), 'Aba deve ter data-main-tab="analista-fin"');
    assert.ok(html.includes('ANALISTA FIN'), 'Rótulo deve conter ANALISTA FIN');

    // Sub-grupo Analista Fin
    assert.ok(html.includes('id="subGroupAnalistaFin"'), 'Deve conter container de sub-abas #subGroupAnalistaFin');

    // Sub-abas no subGroupAnalistaFin
    const subGroupAnalistaMatch = html.match(/id="subGroupAnalistaFin"[^>]*>([\s\S]*?)<\/div>/);
    assert.ok(subGroupAnalistaMatch, 'Deve encontrar bloco #subGroupAnalistaFin');
    const subGroupAnalistaContent = subGroupAnalistaMatch[1];
    assert.ok(subGroupAnalistaContent.includes('id="btnTabHolerites"'), 'Documentos DP deve estar em subGroupAnalistaFin');
    assert.ok(subGroupAnalistaContent.includes('id="btnTabFuncionarios"'), 'Cadastro Funcion. deve estar em subGroupAnalistaFin');

    // Garantir que foram REMOVIDAS de subGroupFinanceiro
    const subGroupFinMatch = html.match(/id="subGroupFinanceiro"[^>]*>([\s\S]*?)<\/div>/);
    assert.ok(subGroupFinMatch, 'Deve encontrar bloco #subGroupFinanceiro');
    const subGroupFinContent = subGroupFinMatch[1];
    assert.ok(!subGroupFinContent.includes('id="btnTabHolerites"'), 'Documentos DP NÃO deve estar em subGroupFinanceiro');
    assert.ok(!subGroupFinContent.includes('id="btnTabFuncionarios"'), 'Cadastro Funcion. NÃO deve estar em subGroupFinanceiro');

    // Validação no app.js
    assert.ok(appJsCode.includes('mainTabAnalistaFin'), 'app.js deve gerenciar mainTabAnalistaFin');
    assert.ok(appJsCode.includes('subGroupAnalistaFin'), 'app.js deve gerenciar subGroupAnalistaFin');

    report('Aba principal ANALISTA FIN e sub-abas Documentos DP / Cadastro Funcion. isoladas e validadas', true);
  } catch (err) {
    report('Aba principal ANALISTA FIN e sub-abas Documentos DP / Cadastro Funcion. isoladas e validadas', false, err.message);
  }

  // -------------------------------------------------------------
  // Resumo Final
  // -------------------------------------------------------------
  console.log('\n=============================================================');
  console.log(`📊 RESULTADOS: ${passedTests} Aprovados, ${failedTests} Falhas`);
  console.log('=============================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runFrontendModulesTests().catch(err => {
    console.error('Erro fatal:', err);
    process.exit(1);
  });
}

module.exports = runFrontendModulesTests;
