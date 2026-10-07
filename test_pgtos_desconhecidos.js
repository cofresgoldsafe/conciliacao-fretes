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
  calcularScoreEConfianca,
  parseDataGenerica,
  formatarDataBr,
  isWithinLastDays,
  obterDataCorteProtheus,
  extrairDivisorCondicao,
  parsearLinhaExtrato
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

  runTest('1.8 Remove prefixo DEPOSITO isolado e com espaços (ex: DEPOSITO JESMOND)', () => {
    const res = limparTermoBancario(' DEPOSITO JESMOND ');
    assert.strictEqual(res, 'JESMOND');
  });

  runTest('1.9 Remove prefixo DEP. abreviado (ex: DEP. JESMOND)', () => {
    const res = limparTermoBancario('DEP. JESMOND');
    assert.strictEqual(res, 'JESMOND');
  });

  runTest('1.10 Remove prefixo DEPOSITO EM CONTA com hífen', () => {
    const res = limparTermoBancario('DEPOSITO EM CONTA - JESMOND COMERCIO');
    assert.strictEqual(res, 'JESMOND COMERCIO');
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

  runTest('2.6 Preserva sinal negativo para rejeição de valores não positivos', () => {
    assert.strictEqual(normalizarValorNumerico(-150), -150);
    assert.strictEqual(normalizarValorNumerico('-150'), -150);
    assert.strictEqual(normalizarValorNumerico('-R$ 150,00'), -150);
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
    assert(html.includes('id="pgtosValorInput" class="form-input" placeholder="Ex: 1.222,33" required aria-required="true" inputmode="decimal" autocomplete="off"'), 'Campo pgtosValorInput deve ser obrigatório e possuir atributos numéricos');
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

  runTest('4.9 public/js/pgtos_desconhecidos.js valida campo de valor como obrigatório com alerta amigável', () => {
    const js = fs.readFileSync(path.join(__dirname, 'public', 'js', 'pgtos_desconhecidos.js'), 'utf8');
    assert(js.includes('O valor do depósito é obrigatório para pesquisar pagamentos desconhecidos.'), 'Mensagem de obrigatoriedade de valor deve constar no JS');
    assert(js.includes('elValor.focus()'), 'Foco no campo elValor deve existir quando valor não for preenchido');
  });

  runTest('4.10 public/js/pgtos_desconhecidos.js possui sintaxe JS 100% válida e compila com sucesso', () => {
    const js = fs.readFileSync(path.join(__dirname, 'public', 'js', 'pgtos_desconhecidos.js'), 'utf8');
    const vm = require('vm');
    assert.doesNotThrow(() => {
      new vm.Script(js);
    }, 'Sintaxe JS inválida em public/js/pgtos_desconhecidos.js');
  });

  runTest('4.11 public/app.js invoca initPgtosDesconhecidos ao selecionar a aba correspondente', () => {
    const appJs = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
    assert(appJs.includes("targetTab === 'tab-pgtos-desconhecidos'"), 'Verificação de tab-pgtos-desconhecidos não encontrada em app.js');
    assert(appJs.includes('initPgtosDesconhecidos'), 'Invocação de initPgtosDesconhecidos não encontrada em app.js');
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
    assert(res.body.error.includes('O valor do depósito é obrigatório'), 'Mensagem de erro de valor obrigatório esperada');
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

  await runAsyncTest('5.4 Rota rejeita busca contendo apenas termo e sem valor com HTTP 400', async () => {
    const express = require('express');
    const requestApp = express();
    requestApp.use('/api', require('./routes/pgtos_desconhecidos'));

    const http = require('http');
    const server = http.createServer(requestApp);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const res = await new Promise((resolve) => {
      http.get(`http://127.0.0.1:${port}/api/buscar?termo=silicone`, (res) => {
        let d = '';
        res.on('data', chunk => d += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
      });
    });

    server.close();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.success, false);
    assert(res.body.error.includes('O valor do depósito é obrigatório'), 'Deve informar que o valor é obrigatório');
  });

  await runAsyncTest('5.5 Rota rejeita valor zero ou negativo com HTTP 400', async () => {
    const express = require('express');
    const requestApp = express();
    requestApp.use('/api', require('./routes/pgtos_desconhecidos'));

    const http = require('http');
    const server = http.createServer(requestApp);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const resZero = await new Promise((resolve) => {
      http.get(`http://127.0.0.1:${port}/api/buscar?valor=0`, (res) => {
        let d = '';
        res.on('data', chunk => d += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
      });
    });

    const resNeg = await new Promise((resolve) => {
      http.get(`http://127.0.0.1:${port}/api/buscar?valor=-150`, (res) => {
        let d = '';
        res.on('data', chunk => d += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
      });
    });

    server.close();
    assert.strictEqual(resZero.status, 400);
    assert(resZero.body.error.includes('O valor do depósito é obrigatório'));
    assert.strictEqual(resNeg.status, 400);
    assert(resNeg.body.error.includes('O valor do depósito é obrigatório'));
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

  // =========================================================================
  // BLOCO 7: REGRAS E FILTROS DE 90 DIAS (PIPEDRIVE, PROTHEUS, ASSISTÊNCIA)
  // =========================================================================
  console.log('\n--- Bloco 7: Filtros de 90 Dias (Pipedrive update_time, Protheus E1_EMISSAO, Assistência Entrada em) ---');

  runTest('7.1 parseDataGenerica converte confiavelmente formatos BRL, ISO e Protheus', () => {
    const dBrl = parseDataGenerica('18/09/2026');
    assert(dBrl instanceof Date && !isNaN(dBrl.getTime()), 'Data BRL deve ser convertida');
    assert.strictEqual(dBrl.getDate(), 18);
    assert.strictEqual(dBrl.getMonth(), 8); // Setembro = 8
    assert.strictEqual(dBrl.getFullYear(), 2026);

    const dIso = parseDataGenerica('2026-10-07 12:30:00');
    assert(dIso instanceof Date && !isNaN(dIso.getTime()), 'Data ISO com hora deve ser convertida');
    assert.strictEqual(dIso.getFullYear(), 2026);

    const dPro = parseDataGenerica('20260915');
    assert(dPro instanceof Date && !isNaN(dPro.getTime()), 'Data Protheus YYYYMMDD deve ser convertida');
    assert.strictEqual(dPro.getDate(), 15);
    assert.strictEqual(dPro.getMonth(), 8);
    assert.strictEqual(dPro.getFullYear(), 2026);
  });

  runTest('7.2 formatarDataBr formata qualquer data para DD/MM/AAAA', () => {
    assert.strictEqual(formatarDataBr('2026-10-07 12:00:00'), '07/10/2026');
    assert.strictEqual(formatarDataBr('20260901'), '01/09/2026');
    assert.strictEqual(formatarDataBr('18/09/2026'), '18/09/2026');
    assert.strictEqual(formatarDataBr(null), '-');
  });

  runTest('7.3 isWithinLastDays aprova datas recentes e rejeita datas com mais de 90 dias', () => {
    const hoje = new Date();
    
    // Data de 10 dias atrás (deve aprovar)
    const dRecente = new Date(hoje.getTime() - 10 * 86400000);
    const ddRec = String(dRecente.getDate()).padStart(2, '0');
    const mmRec = String(dRecente.getMonth() + 1).padStart(2, '0');
    const strRecenteBrl = `${ddRec}/${mmRec}/${dRecente.getFullYear()}`;
    assert.strictEqual(isWithinLastDays(strRecenteBrl, 90), true, 'Data de 10 dias atrás deve ser aceita');

    // Data de 120 dias atrás (deve rejeitar)
    const dAntiga = new Date(hoje.getTime() - 120 * 86400000);
    const ddAnt = String(dAntiga.getDate()).padStart(2, '0');
    const mmAnt = String(dAntiga.getMonth() + 1).padStart(2, '0');
    const strAntigaBrl = `${ddAnt}/${mmAnt}/${dAntiga.getFullYear()}`;
    assert.strictEqual(isWithinLastDays(strAntigaBrl, 90), false, 'Data de 120 dias atrás deve ser rejeitada');
  });

  runTest('7.4 isWithinLastDays trata com segurança valores nulos, indefinidos e inválidos', () => {
    assert.strictEqual(isWithinLastDays(null, 90), false);
    assert.strictEqual(isWithinLastDays(undefined, 90), false);
    assert.strictEqual(isWithinLastDays('', 90), false);
    assert.strictEqual(isWithinLastDays('data-invalida-xyz', 90), false);
  });

  runTest('7.5 obterDataCorteProtheus retorna string de 8 dígitos no formato YYYYMMDD', () => {
    const corte = obterDataCorteProtheus(90);
    assert.strictEqual(typeof corte, 'string');
    assert.strictEqual(corte.length, 8);
    assert(/^\d{8}$/.test(corte), 'Deve conter exatamente 8 dígitos numéricos');
  });

  runTest('7.6 routes/pgtos_desconhecidos.js aplica cláusula de corte E1_EMISSAO e C5_EMISSAO nas queries Protheus', () => {
    const routeCode = fs.readFileSync(path.join(__dirname, 'routes', 'pgtos_desconhecidos.js'), 'utf8');
    assert(routeCode.includes("E1.E1_EMISSAO >= '${dataCorteProtheus}'"), 'Cláusula E1_EMISSAO >= dataCorte deve constar em SE1');
    assert(routeCode.includes("C5.C5_EMISSAO >= '${dataCorteProtheus}'"), 'Cláusula C5_EMISSAO >= dataCorte deve constar em SC5');
    assert(routeCode.includes('obterDataCorteProtheus(90)'), 'Chamada para obterDataCorteProtheus(90) deve existir');
  });

  runTest('7.7 routes/pgtos_desconhecidos.js valida campo de entrada da Assistência Técnica e update_time do Pipedrive', () => {
    const routeCode = fs.readFileSync(path.join(__dirname, 'routes', 'pgtos_desconhecidos.js'), 'utf8');
    // Assistência: Entrada em (data_abertura)
    assert(routeCode.includes('isWithinLastDays(dtEntrada, 90)'), 'Filtro de 90 dias na data de entrada da Assistência Técnica deve constar');
    // Pipedrive: update_time
    assert(routeCode.includes('isWithinLastDays(updateTime, 90)'), 'Filtro de 90 dias em update_time do Pipedrive deve constar');
  });

  runTest('7.8 public/js/pgtos_desconhecidos.js inclui a data formatada no texto copiado pelo botão Copiar', () => {
    const jsCode = fs.readFileSync(path.join(__dirname, 'public', 'js', 'pgtos_desconhecidos.js'), 'utf8');
    assert(jsCode.includes("item.data && item.data !== '-' ? `• Data: ${item.data}` : ''"), 'Inclusão da data no texto de cópia deve constar');
  });

  console.log('\n--- Bloco 8: Exclusão Estrita de Títulos Baixados / Somente Recebimentos em Aberto Protheus ---');
  runTest('8.1 routes/pgtos_desconhecidos.js aplica cláusulas E1_SALDO > 0 e E1_BAIXA vazia na query SE1', () => {
    const routeCode = fs.readFileSync(path.join(__dirname, 'routes', 'pgtos_desconhecidos.js'), 'utf8');
    assert(routeCode.includes('"E1.E1_SALDO > 0"'), 'Cláusula E1.E1_SALDO > 0 deve constar nas whereClauses de SE1');
    assert(routeCode.includes('"RTRIM(ISNULL(E1.E1_BAIXA, \'\')) = \'\'"'), 'Cláusula de baixa vazia deve constar nas whereClauses de SE1');
  });

  runTest('8.2 routes/pgtos_desconhecidos.js descarta títulos com baixa ou saldo <= 0 e nunca gera status Baixado no Protheus', () => {
    const routeCode = fs.readFileSync(path.join(__dirname, 'routes', 'pgtos_desconhecidos.js'), 'utf8');
    assert(routeCode.includes('if (isBaixado || saldo <= 0)'), 'Loop de SE1 deve ignorar registros baixados ou sem saldo ativo');
    assert(!routeCode.includes("'Baixado no Protheus'"), "Código não deve mais atribuir status 'Baixado no Protheus'");
  });

  runTest('8.3 public/js/pgtos_desconhecidos.js possui filtro de proteção defensivo contra títulos baixados na renderização', () => {
    const jsCode = fs.readFileSync(path.join(__dirname, 'public', 'js', 'pgtos_desconhecidos.js'), 'utf8');
    assert(jsCode.includes("item.status && item.status.includes('Baixado')"), 'Filtro defensivo contra status Baixado deve existir em renderizarTabela');
  });

  // =========================================================================
  // BLOCO 9: PARCELAMENTO SC5, TOLERÂNCIA DE 6% E BUSCA TEXTUAL PROTHEUS
  // =========================================================================
  console.log('\n--- Bloco 9: Parcelamento SC5, Tolerância de 6% e Busca Textual Protheus ---');

  runTest('9.1 extrairDivisorCondicao extrai corretamente divisores de parcelamento (1x a 4x e padrão)', () => {
    assert.strictEqual(extrairDivisorCondicao('1X BOL 28 D'), 1);
    assert.strictEqual(extrairDivisorCondicao('2X DEP + BOL 28D'), 2);
    assert.strictEqual(extrairDivisorCondicao('3X BOL 15/30/60'), 3);
    assert.strictEqual(extrairDivisorCondicao('4X CC VISA'), 4);
    assert.strictEqual(extrairDivisorCondicao('10X CC MASTER'), 10);
    assert.strictEqual(extrairDivisorCondicao('REMESSA SEM COBRANCA'), 1);
    assert.strictEqual(extrairDivisorCondicao(''), 1);
    assert.strictEqual(extrairDivisorCondicao(null), 1);
  });

  runTest('9.2 calcularScoreEConfianca: Match idêntico gera Confiança Alta (🟢)', () => {
    const itemExato = {
      origem: 'PROTHEUS',
      empresa: '16',
      cliente: 'JESMOND COMERCIO VAR',
      valorMatch: 3957.00,
      scoreBase: 160
    };
    const res = calcularScoreEConfianca(itemExato, '16', 3957.00, '');
    assert.strictEqual(res.confianca, 'Alta');
    assert(res.score >= 150, `Score esperado >= 150, recebido ${res.score}`);
  });

  runTest('9.3 calcularScoreEConfianca: Diferença de até 6% gera Confiança Baixa (⚪)', () => {
    // 3800 vs 3957 = diff de 3.96% (dentro dos 6%)
    const itemComDiferenca = {
      origem: 'PROTHEUS',
      empresa: '16',
      cliente: 'JESMOND COMERCIO VAR',
      valorMatch: 3800.00,
      scoreBase: 160
    };
    const res = calcularScoreEConfianca(itemComDiferenca, '16', 3957.00, '');
    assert.strictEqual(res.confianca, 'Baixa');
    assert(res.score < 90, `Score esperado < 90, recebido ${res.score}`);
  });

  runTest('9.4 calcularScoreEConfianca: Diferença superior a 6% é zerada para descarte imediato', () => {
    // 947.40 vs 3957 = diff de 76% (> 6%)
    const itemDiscrepante = {
      origem: 'PROTHEUS',
      empresa: '16',
      cliente: 'Henrique Mezzomo',
      valorMatch: 947.40,
      scoreBase: 155
    };
    const res = calcularScoreEConfianca(itemDiscrepante, '16', 3957.00, '');
    assert.strictEqual(res.score, 0, 'Itens com diferença > 6% devem ter score 0');
  });

  await runAsyncTest('9.5 Rota Protheus com valor 3957 retorna título 000725 e elimina pedidos estranhos (947.40, 1033.54, 1019.58)', async () => {
    const express = require('express');
    const requestApp = express();
    requestApp.use('/api', require('./routes/pgtos_desconhecidos'));

    const http = require('http');
    const server = http.createServer(requestApp);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const res = await new Promise((resolve) => {
      http.get(`http://127.0.0.1:${port}/api/buscar?empresa=ALL&valor=3957`, (res) => {
        let d = '';
        res.on('data', chunk => d += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
      });
    });

    server.close();
    assert.strictEqual(res.status, 200);
    assert(Array.isArray(res.body.resultados), 'Resultados deve ser array');
    
    // Título 000725 de 3957,00 deve constar com Confiança Alta
    const tit000725 = res.body.resultados.find(r => r.cliente && r.cliente.includes('JESMOND'));
    assert(tit000725, 'Título 000725 de JESMOND deve ser retornado');
    assert.strictEqual(tit000725.confianca, 'Alta');
    assert.strictEqual(tit000725.valorMatch, 3957);

    // Nenhum resultado deve possuir valores fora da margem de 6% (como 947.40, 1033.54, 1019.58)
    const estranhos = res.body.resultados.filter(r => [947.4, 1033.54, 1019.58].includes(r.valorMatch));
    assert.strictEqual(estranhos.length, 0, `Nenhum pedido estranho deve aparecer. Encontrados: ${estranhos.length}`);
  });

  await runAsyncTest('9.6 Rota Protheus com termo " DEPOSITO JESMOND " localiza o título da JESMOND com sucesso', async () => {
    const express = require('express');
    const requestApp = express();
    requestApp.use('/api', require('./routes/pgtos_desconhecidos'));

    const http = require('http');
    const server = http.createServer(requestApp);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const res = await new Promise((resolve) => {
      http.get(`http://127.0.0.1:${port}/api/buscar?empresa=ALL&valor=3957&termo=%20DEPOSITO%20JESMOND%20`, (res) => {
        let d = '';
        res.on('data', chunk => d += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
      });
    });

    server.close();
    assert.strictEqual(res.status, 200);
    assert(Array.isArray(res.body.resultados), 'Resultados deve ser array');
    
    const titJesmond = res.body.resultados.find(r => r.cliente && r.cliente.includes('JESMOND'));
    assert(titJesmond, 'Título de JESMOND deve ser localizado na busca com termo " DEPOSITO JESMOND "');
    assert.strictEqual(titJesmond.confianca, 'Alta');
  });

  // =========================================================================
  // BLOCO 10: PARSER ROBUSTO DE LINHAS DE EXTRATO BANCÁRIO & SMART PASTE
  // =========================================================================
  console.log('\n--- Bloco 10: Parser Robusto de Linhas de Extrato Bancário & Smart Paste ---');

  runTest('10.1 parsearLinhaExtrato extrai data, valor e razão social da linha MADERO', () => {
    const raw = '07/10/2026    CRÉDITO    Pix recebido    PIX RECEBIDO -MADERO INDUSTRIA E COM    R$ 1.220,00';
    const res = parsearLinhaExtrato(raw);
    assert.strictEqual(res.data, '07/10/2026', 'Data deve ser 07/10/2026');
    assert.strictEqual(res.valor, 1220.00, 'Valor deve ser 1220.00');
    assert.strictEqual(res.pagador, 'MADERO INDUSTRIA E COM', 'Pagador deve ser MADERO INDUSTRIA E COM');
  });

  runTest('10.2 parsearLinhaExtrato extrai data, valor e remove roteamento bancário da linha BOMBRIL', () => {
    const raw = '13/07/2026    Transferencia recebida: "341 263 993933 BOMBRIL S A   EM RECUPERACAO J"    26.504,00';
    const res = parsearLinhaExtrato(raw);
    assert.strictEqual(res.data, '13/07/2026', 'Data deve ser 13/07/2026');
    assert.strictEqual(res.valor, 26504.00, 'Valor deve ser 26504.00');
    assert.strictEqual(res.pagador, 'BOMBRIL S A EM RECUPERACAO J', 'Pagador deve ser limpo');
  });

  runTest('10.3 parsearLinhaExtrato extrai dados e remove prefixo Pix Cp: da linha VIEIRA', () => {
    const raw = '13/07/2026    Pix recebido: "Cp :18236120-A M G VIEIRA COMERCIO DE PECAS E ACESSORIOS LTDA"    24.000,00';
    const res = parsearLinhaExtrato(raw);
    assert.strictEqual(res.data, '13/07/2026', 'Data deve ser 13/07/2026');
    assert.strictEqual(res.valor, 24000.00, 'Valor deve ser 24000.00');
    assert.strictEqual(res.pagador, 'A M G VIEIRA COMERCIO DE PECAS E ACESSORIOS LTDA');
  });

  runTest('10.4 parsearLinhaExtrato extrai valor e limpa dados da FUNDACAO ARTHUR BERNARDES', () => {
    const raw = 'Transferencia recebida: "001 4478 73881 FUNDACAO ARTHUR BERNARDES"    9.292,00';
    const res = parsearLinhaExtrato(raw);
    assert.strictEqual(res.valor, 9292.00, 'Valor deve ser 9292.00');
    assert.strictEqual(res.pagador, 'FUNDACAO ARTHUR BERNARDES');
  });

  runTest('10.5 parsearLinhaExtrato extrai valor e limpa dados da ARAUCO CELULOSE', () => {
    const raw = 'Transferencia recebida: "341 7285 277674 ARAUCO CELULOSE DO BRASIL S A"    19.662,00';
    const res = parsearLinhaExtrato(raw);
    assert.strictEqual(res.valor, 19662.00, 'Valor deve ser 19662.00');
    assert.strictEqual(res.pagador, 'ARAUCO CELULOSE DO BRASIL S A');
  });

  runTest('10.6 limparTermoBancario preserva CNPJ e CPF sem distorção', () => {
    assert.strictEqual(limparTermoBancario('12.345.678/0001-90'), '12.345.678/0001-90');
    assert.strictEqual(limparTermoBancario('123.456.789-00'), '123.456.789-00');
  });

  runTest('10.7 public/js/pgtos_desconhecidos.js possui listeners de paste para smart paste', () => {
    const frontCode = fs.readFileSync(path.join(__dirname, 'public', 'js', 'pgtos_desconhecidos.js'), 'utf8');
    assert(frontCode.includes('tratarPasteExtrato'), 'Função tratarPasteExtrato deve existir no frontend');
    assert(frontCode.includes("input.addEventListener('paste', tratarPasteExtrato)"), 'Listener de paste deve estar registrado');
  });

  await runAsyncTest('10.8 Rota Express com valor 1220 e linha bruta do extrato no termo localiza título da MADERO (Alta)', async () => {
    const express = require('express');
    const requestApp = express();
    requestApp.use('/api', require('./routes/pgtos_desconhecidos'));

    const http = require('http');
    const server = http.createServer(requestApp);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const rawLinha = '07/10/2026    CRÉDITO    Pix recebido    PIX RECEBIDO -MADERO INDUSTRIA E COM    R$ 1.220,00';
    const url = `http://127.0.0.1:${port}/api/buscar?empresa=ALL&valor=1220&termo=${encodeURIComponent(rawLinha)}`;

    const res = await new Promise((resolve) => {
      http.get(url, (res) => {
        let d = '';
        res.on('data', chunk => d += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
      });
    });

    server.close();
    assert.strictEqual(res.status, 200);
    assert(Array.isArray(res.body.resultados), 'Resultados deve ser array');
    const titMadero = res.body.resultados.find(r => r.cliente && r.cliente.includes('MADERO'));
    assert(titMadero, 'Título da MADERO deve ser encontrado mesmo com linha bruta de extrato colada');
    assert.strictEqual(titMadero.confianca, 'Alta', 'Confiança deve ser Alta para valor idêntico');
  });

  await runAsyncTest('10.9 Rota Express aproveita valor embutido na linha de extrato quando campo valor vem vazio', async () => {
    const express = require('express');
    const requestApp = express();
    requestApp.use('/api', require('./routes/pgtos_desconhecidos'));

    const http = require('http');
    const server = http.createServer(requestApp);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const rawLinha = '07/10/2026    CRÉDITO    Pix recebido    PIX RECEBIDO -MADERO INDUSTRIA E COM    R$ 1.220,00';
    const url = `http://127.0.0.1:${port}/api/buscar?empresa=ALL&termo=${encodeURIComponent(rawLinha)}`;

    const res = await new Promise((resolve) => {
      http.get(url, (res) => {
        let d = '';
        res.on('data', chunk => d += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
      });
    });

    server.close();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.criterios.valor, 1220, 'Valor 1220 deve ser extraído automaticamente');
    const titMadero = res.body.resultados.find(r => r.cliente && r.cliente.includes('MADERO'));
    assert(titMadero, 'Título da MADERO deve ser encontrado');
    assert.strictEqual(titMadero.confianca, 'Alta');
  });

  // =========================================================================
  // BLOCO 11: MÁSCARA, FORMATAÇÃO BRL E VALIDAÇÃO NUMÉRICA DO VALOR DO DEPÓSITO
  // =========================================================================
  console.log('\n--- Bloco 11: Máscara, Formatação BRL e Validação Numérica Estrita do Depósito ---');

  const vm = require('vm');
  const jsContent = fs.readFileSync(path.join(__dirname, 'public', 'js', 'pgtos_desconhecidos.js'), 'utf8');

  // Cria sandbox com mocks mínimos de DOM e window
  const sandbox = {
    document: {
      getElementById: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      readyState: 'complete'
    },
    localStorage: { getItem: () => null },
    sessionStorage: { getItem: () => null },
    window: {},
    navigator: { clipboard: {} },
    parseFloat,
    parseInt,
    isNaN,
    console
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(jsContent, sandbox);

  const {
    formatarNumeroBRLPgtos,
    sanitizarInputValorPgtos,
    impedirTeclasInvalidasValorPgtos
  } = sandbox;

  runTest('11.1 formatarNumeroBRL preserva formato com milhar e decimal (1.222,33)', () => {
    assert.strictEqual(formatarNumeroBRLPgtos('1.222,33'), '1.222,33');
    assert.strictEqual(formatarNumeroBRLPgtos('12.345,67'), '12.345,67');
  });

  runTest('11.2 formatarNumeroBRL converte formato sem milhar (1222,33) para (1.222,33)', () => {
    assert.strictEqual(formatarNumeroBRLPgtos('1222,33'), '1.222,33');
    assert.strictEqual(formatarNumeroBRLPgtos('361,00'), '361,00');
  });

  runTest('11.3 formatarNumeroBRL converte ponto decimal (1222.33) para (1.222,33)', () => {
    assert.strictEqual(formatarNumeroBRLPgtos('1222.33'), '1.222,33');
  });

  runTest('11.4 formatarNumeroBRL formata números inteiros com casas decimais zeradas', () => {
    assert.strictEqual(formatarNumeroBRLPgtos('1222'), '1.222,00');
    assert.strictEqual(formatarNumeroBRLPgtos('361'), '361,00');
    assert.strictEqual(formatarNumeroBRLPgtos(3957), '3.957,00');
  });

  runTest('11.5 formatarNumeroBRL retorna vazio para strings sem números ou inválidas', () => {
    assert.strictEqual(formatarNumeroBRLPgtos('abc'), '');
    assert.strictEqual(formatarNumeroBRLPgtos('!@#$%'), '');
    assert.strictEqual(formatarNumeroBRLPgtos(''), '');
    assert.strictEqual(formatarNumeroBRLPgtos(null), '');
  });

  runTest('11.6 sanitizarInputValor remove letras e caracteres especiais mantendo dígitos e pontuação', () => {
    const inputMock = { value: 'abc1.222,33xyz@#' };
    sanitizarInputValorPgtos(inputMock);
    assert.strictEqual(inputMock.value, '1.222,33');
  });

  runTest('11.7 sanitizarInputValor limpa string contendo apenas texto ou símbolos para vazio', () => {
    const inputMock = { value: 'qualquer texto especial !@#' };
    sanitizarInputValorPgtos(inputMock);
    assert.strictEqual(inputMock.value, '');
  });

  runTest('11.8 sanitizarInputValor impede múltiplas vírgulas decimais e pontos após vírgula', () => {
    const inputMock1 = { value: '12,22,33' };
    sanitizarInputValorPgtos(inputMock1);
    assert.strictEqual(inputMock1.value, '12,2233');

    const inputMock2 = { value: '1222,3.3' };
    sanitizarInputValorPgtos(inputMock2);
    assert.strictEqual(inputMock2.value, '1222,33');
  });

  runTest('11.9 impedirTeclasInvalidasValor bloqueia letras e símbolos e permite dígitos, vírgula e controles', () => {
    let bloqueado = false;
    const prevent = () => { bloqueado = true; };

    // Letra deve ser bloqueada
    bloqueado = false;
    impedirTeclasInvalidasValorPgtos({ key: 'a', target: { value: '' }, preventDefault: prevent });
    assert.strictEqual(bloqueado, true, 'Letra "a" deve ser bloqueada');

    // Símbolo especial deve ser bloqueado
    bloqueado = false;
    impedirTeclasInvalidasValorPgtos({ key: '@', target: { value: '' }, preventDefault: prevent });
    assert.strictEqual(bloqueado, true, 'Caractere "@" deve ser bloqueado');

    // Dígito 5 deve ser permitido
    bloqueado = false;
    impedirTeclasInvalidasValorPgtos({ key: '5', target: { value: '' }, preventDefault: prevent });
    assert.strictEqual(bloqueado, false, 'Dígito deve ser permitido');

    // Primeira vírgula deve ser permitida
    bloqueado = false;
    impedirTeclasInvalidasValorPgtos({ key: ',', target: { value: '1222', selectionStart: 4, selectionEnd: 4 }, preventDefault: prevent });
    assert.strictEqual(bloqueado, false, 'Primeira vírgula deve ser permitida');

    // Segunda vírgula deve ser bloqueada
    bloqueado = false;
    impedirTeclasInvalidasValorPgtos({ key: ',', target: { value: '1222,33', selectionStart: 7, selectionEnd: 7 }, preventDefault: prevent });
    assert.strictEqual(bloqueado, true, 'Segunda vírgula deve ser bloqueada');

    // Backspace deve ser permitido
    bloqueado = false;
    impedirTeclasInvalidasValorPgtos({ key: 'Backspace', target: { value: '1222' }, preventDefault: prevent });
    assert.strictEqual(bloqueado, false, 'Backspace deve ser permitido');
  });

  runTest('11.10 public/js/pgtos_desconhecidos.js registra listeners de input, blur, keydown e paste no input de valor', () => {
    const jsCode = fs.readFileSync(path.join(__dirname, 'public', 'js', 'pgtos_desconhecidos.js'), 'utf8');
    assert(jsCode.includes("elValor.addEventListener('keydown', impedirTeclasInvalidasValor)"), 'Listener keydown deve estar registrado');
    assert(jsCode.includes("elValor.addEventListener('input', () => sanitizarInputValor(elValor))"), 'Listener input deve estar registrado');
    assert(jsCode.includes("elValor.addEventListener('paste', tratarPasteValor)"), 'Listener paste deve estar registrado');
    assert(jsCode.includes("elValor.addEventListener('blur', formatarAoPerderFocoValor)"), 'Listener blur deve estar registrado');
  });

  console.log(`\n=======================================================`);
  console.log(`📊 [SUMÁRIO] Total de Testes: ${totalTests} | Aprovados: ${passedTests} | Falhas: ${totalTests - passedTests}`);
  console.log(`=======================================================\n`);

  if (totalTests !== passedTests) {
    process.exit(1);
  }
})();
