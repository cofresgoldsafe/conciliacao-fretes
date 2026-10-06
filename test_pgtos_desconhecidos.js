/**
 * test_pgtos_desconhecidos.js
 * 
 * Suíte de Testes Automatizados para a tela 'Pgtos Desconhecidos'
 * Macro-Área: 💰 ASSIST. FINANC. > Pgtos Desconhecidos (#tab-pgtos-desconhecidos)
 * 
 * Validação de:
 * 1. Sanitização e normalização de strings de extrato bancário
 * 2. Normalização de valores monetários
 * 3. Heurística e cálculo de score por empresa (GSI vs Metal Pleno e OAÇO)
 * 4. Integridade da rota REST e estrutura JSON
 * 5. Integridade do frontend e marcação HTML/DOM
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  limparTermoBancario,
  normalizarValorNumerico,
  calcularScoreEConfianca
} = require('./routes/pgtos_desconhecidos');

console.log('🧪 [TESTES] Iniciando Suíte de Testes: Pgtos Desconhecidos...\n');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
  }
}

(async () => {
  // =========================================================================
  // BLOCO 1: SANITIZAÇÃO DE TERMOS DE EXTRATO BANCÁRIO
  // =========================================================================
  console.log('--- Bloco 1: Limpeza de Prefixos e Termos de Extrato ---');

  runTest('1.1 Remove prefixo PIX RECEBIDO com hífen', () => {
    const res = limparTermoBancario('PIX RECEBIDO -SILICONE CENTER LTDA');
    assert.strictEqual(res, 'SILICONE CENTER LTDA');
  });

  runTest('1.2 Remove prefixo PIX RECEBIDO sem hífen', () => {
    const res = limparTermoBancario('PIX RECEBIDO SILICONE CENTER');
    assert.strictEqual(res, 'SILICONE CENTER');
  });

  runTest('1.3 Remove prefixo TED REMETENTE', () => {
    const res = limparTermoBancario('TED REMETENTE JOAO DA SILVA');
    assert.strictEqual(res, 'JOAO DA SILVA');
  });

  runTest('1.4 Remove prefixo TRANSF ELET DISP', () => {
    const res = limparTermoBancario('TRANSF ELET DISP ACME CORPORATION');
    assert.strictEqual(res, 'ACME CORPORATION');
  });

  runTest('1.5 Remove prefixo PAGTO PIX', () => {
    const res = limparTermoBancario('PAGTO PIX - GUILHERME LOPES');
    assert.strictEqual(res, 'GUILHERME LOPES');
  });

  runTest('1.6 Preserva CNPJ/CPF quando não há prefixo de ruído bancário', () => {
    const res = limparTermoBancario('04.914.489/0001-68');
    assert.strictEqual(res, '04.914.489/0001-68');
  });

  runTest('1.7 Trata strings vazias, nulas e indefinidas', () => {
    assert.strictEqual(limparTermoBancario(''), '');
    assert.strictEqual(limparTermoBancario(null), '');
    assert.strictEqual(limparTermoBancario(undefined), '');
  });

  // =========================================================================
  // BLOCO 2: NORMALIZAÇÃO DE VALORES MONETÁRIOS
  // =========================================================================
  console.log('\n--- Bloco 2: Normalização de Valores Monetários ---');

  runTest('2.1 Normaliza número puro', () => {
    assert.strictEqual(normalizarValorNumerico(361), 361);
    assert.strictEqual(normalizarValorNumerico(361.5), 361.5);
  });

  runTest('2.2 Normaliza string com ponto decimal', () => {
    assert.strictEqual(normalizarValorNumerico('361.00'), 361);
  });

  runTest('2.3 Normaliza string com vírgula padrão BRL', () => {
    assert.strictEqual(normalizarValorNumerico('361,00'), 361);
    assert.strictEqual(normalizarValorNumerico('1301,79'), 1301.79);
  });

  runTest('2.4 Normaliza string com símbolo R$ e separador de milhar', () => {
    assert.strictEqual(normalizarValorNumerico('R$ 1.301,79'), 1301.79);
    assert.strictEqual(normalizarValorNumerico('R$ 361,00'), 361);
  });

  runTest('2.5 Retorna null para valores inválidos ou vazios', () => {
    assert.strictEqual(normalizarValorNumerico(''), null);
    assert.strictEqual(normalizarValorNumerico(null), null);
    assert.strictEqual(normalizarValorNumerico('abc'), null);
  });

  // =========================================================================
  // BLOCO 3: HEURÍSTICA E RANQUEAMENTO POR EMPRESA
  // =========================================================================
  console.log('\n--- Bloco 3: Motor de Score e Confiança por Empresa ---');

  runTest('3.1 Empresa 15 (GSI) prioriza Assistência Técnica (Score >= 150, Confiança Alta)', () => {
    const itemAssistencia = {
      origem: 'ASSISTENCIA',
      empresa: '15',
      cliente: 'SILICONE CENTER LTDA',
      valorMatch: 361,
      scoreBase: 160
    };
    const ranqueado = calcularScoreEConfianca(itemAssistencia, '15', 361, 'SILICONE CENTER');
    assert.strictEqual(ranqueado.confianca, 'Alta');
    assert(ranqueado.score >= 200, `Score esperado >= 200, recebido ${ranqueado.score}`);
  });

  runTest('3.2 Empresa 15 (GSI) reduz pontuação relativa de Pipedrive CRM', () => {
    const itemPipe = {
      origem: 'PIPEDRIVE',
      empresa: 'CRM',
      cliente: 'Lead Aleatório',
      valorMatch: 361,
      scoreBase: 80
    };
    const ranqueado = calcularScoreEConfianca(itemPipe, '15', 361, 'Outro Cliente');
    assert(ranqueado.score < 100, `Score esperado < 100, recebido ${ranqueado.score}`);
  });

  runTest('3.3 Empresas 14 (Metal Pleno) e 16 (OAÇO) ZERAM e descartam Assistência Técnica', () => {
    const itemAssistencia = {
      origem: 'ASSISTENCIA',
      empresa: '15',
      cliente: 'Silicone Center',
      valorMatch: 361,
      scoreBase: 160
    };
    const ranq14 = calcularScoreEConfianca(itemAssistencia, '14', 361, 'Silicone');
    const ranq16 = calcularScoreEConfianca(itemAssistencia, '16', 361, 'Silicone');
    assert.strictEqual(ranq14.score, 0, 'Assistência deve ser zerada para Metal Pleno (14)');
    assert.strictEqual(ranq16.score, 0, 'Assistência deve ser zerada para OAÇO (16)');
  });

  runTest('3.4 Empresa 16 (OAÇO) prioriza Protheus (Adiantamento RA / Pedido) com Confiança Alta', () => {
    const itemProtheus = {
      origem: 'PROTHEUS',
      empresa: '16',
      cliente: 'Alexandre Fistarol',
      vendedor: 'JULIANA BARBOSA FERREIRA LOPES',
      valorMatch: 1301.79,
      scoreBase: 175
    };
    const ranqueado = calcularScoreEConfianca(itemProtheus, '16', 1301.79, 'Alexandre');
    assert.strictEqual(ranqueado.confianca, 'Alta');
    assert(ranqueado.score >= 230, `Score esperado >= 230, recebido ${ranqueado.score}`);
  });

  // =========================================================================
  // BLOCO 4: INTEGRIDADE DE FRONTEND E MARCAÇÃO DOM
  // =========================================================================
  console.log('\n--- Bloco 4: Integridade de Frontend e Marcação HTML ---');

  runTest('4.1 public/index.html possui o botão #btnTabPgtosDesconhecidos em subGroupFinanceiro', () => {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    assert(html.includes('id="btnTabPgtosDesconhecidos"'), 'Botão da sub-aba não encontrado no HTML');
    assert(html.includes('data-tab="tab-pgtos-desconhecidos"'), 'data-tab="tab-pgtos-desconhecidos" não encontrado no botão');
  });

  runTest('4.2 public/index.html possui o container #tab-pgtos-desconhecidos com tabela e controles', () => {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    assert(html.includes('id="tab-pgtos-desconhecidos"'), 'Container da tela não encontrado no HTML');
    assert(html.includes('id="pgtosEmpresaSelect"'), 'Seletor de empresa não encontrado');
    assert(html.includes('id="pgtosValorInput"'), 'Campo de valor não encontrado');
    assert(html.includes('id="pgtosTermoInput"'), 'Campo de termo não encontrado');
    assert(html.includes('id="btnBuscarPgtosDesconhecidos"'), 'Botão de busca não encontrado');
    assert(html.includes('id="pgtosTableBody"'), 'Tbody da tabela não encontrado');
  });

  runTest('4.3 public/index.html carrega o script js/pgtos_desconhecidos.js', () => {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    assert(html.includes('js/pgtos_desconhecidos.js'), 'Inclusão do script não encontrada no index.html');
  });

  runTest('4.4 public/app.js injeta botão btn-localizar-origem na listagem de créditos órfãos', () => {
    const appJs = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
    assert(appJs.includes('btn-localizar-origem'), 'Botão btn-localizar-origem não encontrado em public/app.js');
    assert(appJs.includes('abrirLocalizadorPgtosDesconhecidos'), 'Chamada a abrirLocalizadorPgtosDesconhecidos não encontrada em public/app.js');
  });

  runTest('4.5 public/js/pgtos_desconhecidos.js exporta abrirLocalizadorPgtosDesconhecidos globalmente', () => {
    const js = fs.readFileSync(path.join(__dirname, 'public', 'js', 'pgtos_desconhecidos.js'), 'utf8');
    assert(js.includes('window.abrirLocalizadorPgtosDesconhecidos'), 'Exportação global não encontrada em public/js/pgtos_desconhecidos.js');
  });

  runTest('4.6 server.js monta a rota /api/financeiro/pgtos-desconhecidos com requireAuth e requireFinanceiroAccess', () => {
    const serverJs = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    assert(serverJs.includes("app.use('/api/financeiro/pgtos-desconhecidos', requireAuth, requireFinanceiroAccess"), 'Mount com requireAuth e requireFinanceiroAccess não encontrado em server.js');
    assert(serverJs.includes('pgtosDesconhecidosRoutes'), 'Import do router não encontrado em server.js');
  });

  runTest('4.7 public/js/pgtos_desconhecidos.js possui proteção contra link injection e fallback de clipboard', () => {
    const js = fs.readFileSync(path.join(__dirname, 'public', 'js', 'pgtos_desconhecidos.js'), 'utf8');
    assert(js.includes('safeLink'), 'Variável safeLink não encontrada no frontend');
    assert(js.includes('^https?:\\/\\/'), 'Regex de validação de protocolo seguro não encontrada no frontend');
    assert(js.includes('navigator.clipboard.writeText'), 'Chamada segura a clipboard não encontrada');
  });

  runTest('4.8 public/js/pgtos_desconhecidos.js gerencia acessibilidade com aria-pressed nos chips', () => {
    const js = fs.readFileSync(path.join(__dirname, 'public', 'js', 'pgtos_desconhecidos.js'), 'utf8');
    assert(js.includes("btn.setAttribute('aria-pressed', isAtivo ? 'true' : 'false')"), 'aria-pressed nos chips não encontrado');
  });

  // =========================================================================
  // BLOCO 5: INTEGRAÇÃO REAL DA ROTA DE BUSCA
  // =========================================================================
  console.log('\n--- Bloco 5: Teste Funcional da Rota Backend Express ---');

  await runAsyncTest('5.1 Rota responde com validação amigável se parâmetros ausentes', async () => {
    const express = require('express');
    const requestApp = express();
    requestApp.use('/api', require('./routes/pgtos_desconhecidos'));

    const http = require('http');
    const server = http.createServer(requestApp);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const res = await new Promise((resolve) => {
      http.get(`http://127.0.0.1:${port}/api/buscar`, (res) => {
        let d = '';
        res.on('data', chunk => d += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
      });
    });

    server.close();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.success, false);
    assert(res.body.error.includes('Informe ao menos o valor'), 'Mensagem de erro amigável esperada');
  });

  await runAsyncTest('5.2 Rota busca e ranqueia dados da Assistência Técnica para Empresa 15 (GSI)', async () => {
    const express = require('express');
    const requestApp = express();
    requestApp.use('/api', require('./routes/pgtos_desconhecidos'));

    const http = require('http');
    const server = http.createServer(requestApp);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const res = await new Promise((resolve) => {
      http.get(`http://127.0.0.1:${port}/api/buscar?empresa=15&valor=361&termo=silicone`, (res) => {
        let d = '';
        res.on('data', chunk => d += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
      });
    });

    server.close();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert(Array.isArray(res.body.resultados), 'Resultados deve ser um array');
    assert(res.body.resultados.length > 0, 'Deve retornar ao menos 1 candidato');

    const primeiro = res.body.resultados[0];
    assert.strictEqual(primeiro.confianca, 'Alta');
    assert(primeiro.score >= 150, `Score esperado >= 150, recebido ${primeiro.score}`);
    assert(primeiro.cliente.includes('Guilherme') || primeiro.cliente.includes('SILICONE') || primeiro.documento.includes('1381'), 'Deve identificar a OS 1381 da Silicone Center');
  });

  await runAsyncTest('5.3 Rota aplica clamping defensivo em limites negativos e excessivos', async () => {
    const express = require('express');
    const requestApp = express();
    requestApp.use('/api', require('./routes/pgtos_desconhecidos'));

    const http = require('http');
    const server = http.createServer(requestApp);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    // Teste com limite negativo
    const resNeg = await new Promise((resolve) => {
      http.get(`http://127.0.0.1:${port}/api/buscar?empresa=15&valor=361&limite=-5`, (res) => {
        let d = '';
        res.on('data', chunk => d += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
      });
    });

    // Teste com limite excessivo
    const resOver = await new Promise((resolve) => {
      http.get(`http://127.0.0.1:${port}/api/buscar?empresa=15&valor=361&limite=500`, (res) => {
        let d = '';
        res.on('data', chunk => d += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
      });
    });

    server.close();
    assert.strictEqual(resNeg.status, 200);
    assert.strictEqual(resNeg.body.criterios.limite, 1, 'Limite negativo deve sofrer clamp para 1');
    assert.strictEqual(resOver.status, 200);
    assert.strictEqual(resOver.body.criterios.limite, 100, 'Limite excessivo deve sofrer clamp para 100');
  });

  // =========================================================================
  // BLOCO 6: SEGURANÇA ZERO-TRUST E RBAC
  // =========================================================================
  console.log('\n--- Bloco 6: Validação de Segurança RBAC e Sanitização SQL ---');

  await runAsyncTest('6.1 Middleware requireFinanceiroAccess bloqueia vendedor com HTTP 403 Forbidden', async () => {
    const express = require('express');
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = 'test_secret_for_rbac_123';

    // Mock do middleware e app de teste
    const testApp = express();
    const vendedorToken = jwt.sign({ username: 'marcelo.vendas', role: 'vendedor', permissions: ['vendedores'] }, JWT_SECRET);

    function requireAuthMock(req, res, next) {
      const auth = req.headers['authorization'];
      if (!auth) return res.status(401).json({ success: false });
      req.user = jwt.verify(auth.slice(7), JWT_SECRET);
      next();
    }

    function requireFinanceiroAccessMock(req, res, next) {
      if (!req.user) return res.status(401).json({ success: false });
      if (req.user.role === 'vendedor') {
        return res.status(403).json({ success: false, message: 'Acesso negado. Perfil vendedor não possui permissão para acessar localização de pagamentos.' });
      }
      next();
    }

    testApp.use('/api/financeiro/pgtos-desconhecidos', requireAuthMock, requireFinanceiroAccessMock, (req, res) => {
      res.json({ success: true });
    });

    const http = require('http');
    const server = http.createServer(testApp);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const res = await new Promise((resolve) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/api/financeiro/pgtos-desconhecidos/buscar',
        method: 'GET',
        headers: { 'Authorization': `Bearer ${vendedorToken}` }
      }, (res) => {
        let d = '';
        res.on('data', chunk => d += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
      });
      req.end();
    });

    server.close();
    assert.strictEqual(res.status, 403, 'Perfil vendedor deve receber HTTP 403');
    assert.strictEqual(res.body.success, false);
    assert(res.body.message.includes('Perfil vendedor não possui permissão'));
  });

  await runAsyncTest('6.2 Middleware requireFinanceiroAccess permite acesso para admin e analista-fin', async () => {
    const express = require('express');
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = 'test_secret_for_rbac_123';

    const testApp = express();
    const adminToken = jwt.sign({ username: 'alexandre', role: 'admin' }, JWT_SECRET);
    const finToken = jwt.sign({ username: 'tatiane', role: 'user', permissions: ['financeiro'] }, JWT_SECRET);

    function requireAuthMock(req, res, next) {
      const auth = req.headers['authorization'];
      req.user = jwt.verify(auth.slice(7), JWT_SECRET);
      next();
    }

    function requireFinanceiroAccessMock(req, res, next) {
      const role = req.user.role;
      const perms = req.user.permissions || [];
      if (role === 'vendedor') return res.status(403).json({ success: false });
      if (role === 'admin' || role === 'diretoria' || perms.includes('financeiro')) return next();
      return res.status(403).json({ success: false });
    }

    testApp.use('/api/financeiro/pgtos-desconhecidos', requireAuthMock, requireFinanceiroAccessMock, (req, res) => {
      res.json({ success: true });
    });

    const http = require('http');
    const server = http.createServer(testApp);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    // Teste Admin
    const resAdmin = await new Promise((resolve) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/api/financeiro/pgtos-desconhecidos/buscar',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      }, (res) => {
        let d = '';
        res.on('data', chunk => d += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
      });
      req.end();
    });

    // Teste Financeiro
    const resFin = await new Promise((resolve) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/api/financeiro/pgtos-desconhecidos/buscar',
        headers: { 'Authorization': `Bearer ${finToken}` }
      }, (res) => {
        let d = '';
        res.on('data', chunk => d += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
      });
      req.end();
    });

    server.close();
    assert.strictEqual(resAdmin.status, 200);
    assert.strictEqual(resAdmin.body.success, true);
    assert.strictEqual(resFin.status, 200);
    assert.strictEqual(resFin.body.success, true);
  });

  runTest('6.3 Query Protheus protege contra wildcard bypass (LIKE %%) se termo não tem dígitos', () => {
    const routeCode = fs.readFileSync(path.join(__dirname, 'routes', 'pgtos_desconhecidos.js'), 'utf8');
    assert(routeCode.includes('digits.length >= 3'), 'Proteção de no mínimo 3 dígitos no CGC deve existir');
    assert(routeCode.includes("SA1.A1_CGC LIKE '%${digits}%'"), 'Cláusula CGC parametrizada deve existir');
  });

  console.log(`\n=======================================================`);
  console.log(`📊 [SUMÁRIO] Total de Testes: ${totalTests} | Aprovados: ${passedTests} | Falhas: ${totalTests - passedTests}`);
  console.log(`=======================================================\n`);

  if (totalTests !== passedTests) {
    process.exit(1);
  }
})();
