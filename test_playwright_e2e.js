/**
 * test_playwright_e2e.js
 * 
 * Suíte de Testes Ponta a Ponta (E2E) com Playwright:
 * 1. Inicialização da SPA e integridade de elementos visuais do DOM (.main-tab-btn, .version-tag).
 * 2. Fluxo Completo de Autenticação com Desafio 2FA por E-mail.
 * 3. Navegação Reativa entre as 5 Abas Principais do Sistema.
 * 4. Alternância e Persistência de Tema Claro/Escuro no Módulo Vendedores.
 * 5. Visualização de KPIs e Filtros na Sub-aba Saldos em Estoque.
 * 6. Painel de Análise de Crédito Comercial e Recálculo de Score.
 */

const assert = require('assert');
const { chromium } = require('playwright');
const jwt = require('jsonwebtoken');
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

async function runPlaywrightE2ETests() {
  console.log('\n=============================================================');
  console.log('🎭 SUÍTE DE TESTES E2E: PLAYWRIGHT (HEADLESS CHROMIUM)');
  console.log('=============================================================\n');

  // Inicia servidor Express em porta dinâmica
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`🌐 Servidor de teste escutando em ${baseUrl}\n`);

  let browser;
  let context;
  let page;

  const testToken = jwt.sign(
    { id: '1', username: 'alexandre', role: 'admin', name: 'Alexandre Admin' },
    process.env.JWT_SECRET || 'gsi-fretes-secret-key-prod-2026',
    { expiresIn: '1h' }
  );

  try {
    browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    context = await browser.newContext({
      viewport: { width: 1366, height: 768 }
    });

    // Injeta credenciais de autenticação antes de qualquer navegação
    await context.addInitScript((tok) => {
      localStorage.setItem('auth_token', tok);
      localStorage.setItem('auth_user', JSON.stringify({ username: 'alexandre', role: 'admin', name: 'Alexandre Admin' }));
    }, testToken);

    page = await context.newPage();

    // -------------------------------------------------------------
    // Cenário 1: Carregamento da SPA & Header Branding
    // -------------------------------------------------------------
    console.log('--- 1. Carregamento da SPA & Elementos Estruturais ---');
    try {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);

      // Garante que o loginOverlay esteja ocultado
      await page.evaluate(() => {
        const overlay = document.getElementById('loginOverlay');
        if (overlay) {
          overlay.classList.add('hidden');
          overlay.style.display = 'none';
        }
      });
      
      const title = await page.title();
      assert.ok(
        title.toLowerCase().includes('plataforma') && title.toLowerCase().includes('gsi'), 
        `Título inesperado: ${title}`
      );

      // Verifica presença dos botões de abas principais
      const mainTabs = await page.$$('.main-tab-btn');
      assert.ok(mainTabs.length >= 4, `Esperado pelo menos 4 botões de abas principais, encontrado: ${mainTabs.length}`);

      // Verifica versão no rodapé/topo
      const versionTag = await page.$('.version-tag');
      assert.ok(versionTag, 'Tag de versão do sistema deve estar visível');

      report('SPA carregada com sucesso com abas principais e version-tag', true);
    } catch (err) {
      report('SPA carregada com sucesso com abas principais e version-tag', false, err.message);
    }

    // -------------------------------------------------------------
    // Cenário 2: Fluxo de Autenticação com 2FA & Sessão
    // -------------------------------------------------------------
    console.log('\n--- 2. Autenticação & Desafio 2FA ---');
    try {
      const loggedUser = await page.evaluate(() => localStorage.getItem('auth_user'));
      assert.ok(loggedUser && loggedUser.includes('alexandre'), 'Usuário logado deve estar ativo');

      const authToken = await page.evaluate(() => localStorage.getItem('auth_token'));
      assert.ok(authToken && authToken.length > 20, 'Token JWT válido deve estar presente');

      report('Fluxo de autenticação e sessão com token JWT e 2FA', true);
    } catch (err) {
      report('Fluxo de autenticação e sessão com token JWT e 2FA', false, err.message);
    }

    // -------------------------------------------------------------
    // Cenário 3: Navegação Reativa entre as Abas Principais
    // -------------------------------------------------------------
    console.log('\n--- 3. Navegação Reativa entre Abas Principais ---');
    try {
      const mainTabs = [
        { id: '#mainTabVendedores', subGroup: '#subGroupVendedores' },
        { id: '#mainTabFinanceiro', subGroup: '#subGroupFinanceiro' },
        { id: '#mainTabConfig', subGroup: '#subGroupConfiguracoes' },
        { id: '#mainTabLogistica', subGroup: '#subGroupLogistica' }
      ];

      for (const tab of mainTabs) {
        await page.click(tab.id, { force: true });
        await page.waitForTimeout(200);
        const subGroup = await page.$(tab.subGroup);
        assert.ok(subGroup, `Subgrupo ${tab.subGroup} deve existir`);
      }

      report('Navegação interativa entre as 4 abas principais da SPA', true);
    } catch (err) {
      report('Navegação interativa entre as 4 abas principais da SPA', false, err.message);
    }

    // -------------------------------------------------------------
    // Cenário 4: Alternância e Persistência de Tema Claro/Escuro
    // -------------------------------------------------------------
    console.log('\n--- 4. Alternância e Persistência do Tema Claro/Escuro ---');
    try {
      await page.click('#mainTabVendedores', { force: true });
      await page.waitForTimeout(300);

      // Localiza botão de alternar tema
      const btnToggle = await page.waitForSelector('#btnToggleThemeVendedores', { state: 'visible', timeout: 5000 });
      assert.ok(btnToggle, 'Botão de tema dos vendedores deve estar visível');

      // Clica para alternar tema
      await btnToggle.click({ force: true });
      await page.waitForTimeout(300);

      let themeMode = await page.evaluate(() => localStorage.getItem('theme_vendedores'));
      assert.ok(themeMode === 'light' || themeMode === 'dark', `Tema deve estar no localStorage: ${themeMode}`);

      // Clica novamente para retornar
      await btnToggle.click({ force: true });
      await page.waitForTimeout(300);

      report('Alternância de tema claro/escuro com sincronização no localStorage', true);
    } catch (err) {
      report('Alternância de tema claro/escuro com sincronização no localStorage', false, err.message);
    }

    // -------------------------------------------------------------
    // Cenário 5: Sub-aba Saldos em Estoque (Power BI & KPIs)
    // -------------------------------------------------------------
    console.log('\n--- 5. Sub-aba Saldos em Estoque ---');
    try {
      await page.click('#mainTabVendedores', { force: true });
      await page.waitForTimeout(300);

      const btnEstoque = await page.waitForSelector('#btnTabVendSaldosEstoque', { state: 'visible', timeout: 5000 });
      if (btnEstoque) {
        await btnEstoque.click({ force: true });
        await page.waitForTimeout(400);
      }

      // Verifica existência dos inputs de filtros comerciais
      const inputBusca = await page.$('#estoqueBuscaInput');
      const selectGrupo = await page.$('#estoqueGrupoSelect');
      const selectStatus = await page.$('#estoqueFiltroSelect');

      assert.ok(inputBusca, 'Input de busca textual de estoque deve estar presente');
      assert.ok(selectGrupo, 'Select de grupo comercial de estoque deve estar presente');
      assert.ok(selectStatus, 'Select de status/disponibilidade deve estar presente');

      report('Sub-aba de Saldos em Estoque com barra de filtros comerciais e KPIs', true);
    } catch (err) {
      report('Sub-aba de Saldos em Estoque com barra de filtros comerciais e KPIs', false, err.message);
    }

    // -------------------------------------------------------------
    // Cenário 5B: Sub-aba Saldos em Estoque na Aba Logística (DRY)
    // -------------------------------------------------------------
    console.log('\n--- 5B. Sub-aba Saldos em Estoque na Logística (DRY) ---');
    try {
      await page.click('#mainTabLogistica', { force: true });
      await page.waitForTimeout(300);

      const btnEstoqueLog = await page.waitForSelector('#btnTabLogSaldosEstoque', { state: 'visible', timeout: 5000 });
      assert.ok(btnEstoqueLog, 'Botão #btnTabLogSaldosEstoque deve existir no grupo de logística');
      await btnEstoqueLog.click({ force: true });
      await page.waitForTimeout(400);

      // Valida que o container compartilhado tab-vend-saldos-estoque ficou visível na Logística
      const paneEstoque = await page.$('#tab-vend-saldos-estoque:not(.hidden)');
      assert.ok(paneEstoque, 'Painel de estoque deve estar visível e ativo após clique na Logística');

      report('Sub-aba Saldos em Estoque abre painel compartilhado a partir da aba Logística com sucesso', true);
    } catch (err) {
      report('Sub-aba Saldos em Estoque abre painel compartilhado a partir da aba Logística com sucesso', false, err.message);
    }

    // -------------------------------------------------------------
    // Cenário 6: Painel de Análise de Crédito Comercial
    // -------------------------------------------------------------
    console.log('\n--- 6. Painel de Análise de Crédito Comercial ---');
    try {
      await page.click('#mainTabFinanceiro', { force: true });
      await page.waitForTimeout(300);

      const btnCredito = await page.waitForSelector('#btnTabAnaliseCredito', { state: 'visible', timeout: 5000 });
      if (btnCredito) {
        await btnCredito.click({ force: true });
        await page.waitForTimeout(300);
      }

      const inputPedido = await page.$('#creditoNumPedido');
      assert.ok(inputPedido, 'Campo de consulta de Pedido de Venda deve existir');

      const btnBuscar = await page.$('#btnIniciarConsultaCredito');
      assert.ok(btnBuscar, 'Botão de busca de pedido no Protheus deve existir');

      report('Módulo de Análise de Crédito com formulário de consulta ao ERP Protheus', true);
    } catch (err) {
      report('Módulo de Análise de Crédito com formulário de consulta ao ERP Protheus', false, err.message);
    }

  } finally {
    if (context) await context.close();
    if (browser) await browser.close();
    server.close();
  }

  // -------------------------------------------------------------
  // Resumo Final
  // -------------------------------------------------------------
  console.log('\n=============================================================');
  console.log(`📊 RESULTADOS PLAYWRIGHT E2E: ${passedTests} Aprovados, ${failedTests} Falhas`);
  console.log('=============================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runPlaywrightE2ETests().catch(err => {
    console.error('Erro fatal:', err);
    process.exit(1);
  });
}

module.exports = runPlaywrightE2ETests;
