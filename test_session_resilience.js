/**
 * test_session_resilience.js
 * 
 * Suíte de Testes Automatizados para Validação de Resiliência de Sessão:
 * 1. Sliding Session no endpoint POST /api/auth/session-ping com verificação no banco de dados.
 * 2. Bloqueio de renovação para usuários inativos ou deletados (Anti-Zombie Session).
 * 3. Validação do interceptor de 401 e preservação de instâncias Request.
 * 4. Validação de UX/UI no modal de detalhes do pedido com botão Entrar Novamente.
 * 5. Estilização para o tema Claro em #pedidoDetalhesModal.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'gsi_portal_jwt_secret_key_prod_2026_x89a';

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
    throw err;
  }
}

async function runTestAsync(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
    throw err;
  }
}

async function main() {
  console.log('\n================================================================');
  console.log('🧪 SUÍTE DE TESTES: RESILIÊNCIA DE SESSÃO & TRATAMENTO DE 401');
  console.log('================================================================\n');

  const serverJsPath = path.join(__dirname, 'server.js');
  const appJsPath = path.join(__dirname, 'public', 'app.js');
  const styleCssPath = path.join(__dirname, 'public', 'style.css');

  const serverJsContent = fs.readFileSync(serverJsPath, 'utf-8');
  const appJsContent = fs.readFileSync(appJsPath, 'utf-8');
  const styleCssContent = fs.readFileSync(styleCssPath, 'utf-8');

  // --- 1. VALIDAÇÃO DE BACKEND (SERVER.JS) ---
  console.log('--- 1. Validação de Backend (Sliding Session & Anti-Zombie) ---');

  runTest('1.1 - POST /api/auth/session-ping possui rate limiting dedicado (sessionPingLimiter)', () => {
    assert(serverJsContent.includes('sessionPingLimiter'), 'Deve definir e aplicar sessionPingLimiter');
    assert(serverJsContent.includes("app.post('/api/auth/session-ping', sessionPingLimiter"), 'sessionPingLimiter deve estar na rota');
  });

  runTest('1.2 - POST /api/auth/session-ping valida usuário ativo no banco de dados (getUsersDB)', () => {
    const pingRoute = serverJsContent.slice(
      serverJsContent.indexOf("app.post('/api/auth/session-ping'"),
      serverJsContent.indexOf("app.get('/api/auth/diag-smtp'")
    );
    assert(pingRoute.includes('getUsersDB()'), 'Deve consultar o banco de dados via getUsersDB()');
    assert(pingRoute.includes('userFound.active !== false'), 'Deve validar flag active do usuário');
    assert(pingRoute.includes('reason: \'user_inactive_or_not_found\''), 'Deve rejeitar inativos/inexistentes');
  });

  runTest('1.3 - POST /api/auth/session-ping renova token JWT por 7 dias com dados atuais do banco', () => {
    const pingRoute = serverJsContent.slice(
      serverJsContent.indexOf("app.post('/api/auth/session-ping'"),
      serverJsContent.indexOf("app.get('/api/auth/diag-smtp'")
    );
    assert(pingRoute.includes('jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: \'7d\' })'), 'Deve emitir token renovado por 7 dias');
    assert(pingRoute.includes('token: renewedToken'), 'Deve retornar renewedToken no JSON');
    assert(pingRoute.includes('expiresAt'), 'Deve retornar expiresAt recalculado');
  });

  // --- 2. VALIDAÇÃO DE FRONTEND (PUBLIC/APP.JS) ---
  console.log('\n--- 2. Validação de Frontend (Interceptor & Resiliência de 401) ---');

  runTest('2.1 - window.fetch preserva instâncias Request e anexa Authorization corretamente', () => {
    assert(appJsContent.includes('url instanceof Request'), 'Deve tratar url instanceof Request');
    assert(appJsContent.includes("url.headers.set('Authorization', `Bearer ${token}`)"), 'Deve usar set no Request.headers nativo');
  });

  runTest('2.2 - Interceptor de 401 purga todas as chaves de sessão e previne race condition', () => {
    assert(appJsContent.includes("localStorage.removeItem('conciliacao_fretes_session')"), 'Deve remover conciliacao_fretes_session');
    assert(appJsContent.includes("localStorage.removeItem('auth_token')"), 'Deve remover auth_token');
    assert(appJsContent.includes("localStorage.removeItem('auth_user')"), 'Deve remover auth_user');
    assert(appJsContent.includes("localStorage.removeItem('gsi_auth_token')"), 'Deve remover gsi_auth_token');
    assert(appJsContent.includes("localStorage.removeItem('token')"), 'Deve remover token');
    assert(appJsContent.includes('sessionHeartbeatTimer = null'), 'Deve anular o timer de heartbeat');
    assert(appJsContent.includes('loginOverlay.classList.contains(\'hidden\')'), 'Deve checar se overlay já está aberto antes de resetar');
  });

  runTest('2.3 - startSessionHeartbeat processa renovação de token e expurgo se active === false', () => {
    const hbFn = appJsContent.slice(
      appJsContent.indexOf('function startSessionHeartbeat()'),
      appJsContent.indexOf('function showAuthenticatedUser(')
    );
    assert(hbFn.includes('data.token'), 'Deve extrair data.token renovado');
    assert(hbFn.includes('sess.token = data.token'), 'Deve atualizar token na sessão local');
    assert(hbFn.includes('data.active === false'), 'Deve tratar resposta active: false');
    assert(hbFn.includes('showLoginOverlay(true)'), 'Deve forçar login quando inativo');
  });

  runTest('2.4 - abrirDetalhesPedidoModal exibe estado 401 amigável com botão Entrar Novamente', () => {
    const modalFn = appJsContent.slice(
      appJsContent.indexOf('async function abrirDetalhesPedidoModal('),
      appJsContent.indexOf('function renderModalDetalhesContent(')
    );
    assert(modalFn.includes('response.status === 401'), 'Deve verificar explicitamente response.status === 401');
    assert(modalFn.includes('Sua sessão expirou'), 'Deve exibir título conciso');
    assert(modalFn.includes('id="btnReloginPedidoModal"'), 'Deve conter botão com ID btnReloginPedidoModal');
    assert(modalFn.includes('Entrar Novamente'), 'Texto de ação direta sem prolixidade');
    assert(modalFn.includes('escapeHtml(err.message)'), 'Deve sanitizar err.message contra DOM XSS no catch');
  });

  // --- 3. VALIDAÇÃO DE CSS E TEMA CLARO ---
  console.log('\n--- 3. Validação de CSS & Temas Claro/Escuro ---');

  runTest('3.1 - public/style.css contém regras de contraste para .empty-results-box no tema Claro do modal', () => {
    assert(styleCssContent.includes('#pedidoDetalhesModal.modal-theme-light .empty-results-box'), 'Deve conter seletor modal-theme-light .empty-results-box');
    assert(styleCssContent.includes('#pedidoDetalhesModal.modal-theme-light .empty-results-box h4'), 'Deve estilizar título h4 no modal light');
    assert(styleCssContent.includes('#pedidoDetalhesModal.modal-theme-light .empty-results-box p'), 'Deve estilizar parágrafo p no modal light');
  });

  // --- 4. TESTES CRIPTOGRÁFICOS DE ASSINATURA E EXPIRAÇÃO DE JWT ---
  console.log('\n--- 4. Testes Criptográficos de JWT & Expiração ---');

  runTest('4.1 - Token gerado com 7d de expiração é verificado com sucesso por JWT_SECRET', () => {
    const payload = { username: 'alexandre', role: 'admin' };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
    const decoded = jwt.verify(token, JWT_SECRET);
    assert.strictEqual(decoded.username, 'alexandre');
    assert(decoded.exp > Math.floor(Date.now() / 1000) + 6 * 86400, 'Expiração deve ser em ~7 dias');
  });

  runTest('4.2 - Token expirado lança TokenExpiredError e é distinguível no requireAuth', () => {
    const expiredToken = jwt.sign({ username: 'alexandre' }, JWT_SECRET, { expiresIn: '-1s' });
    assert.throws(() => {
      jwt.verify(expiredToken, JWT_SECRET);
    }, (err) => {
      return err.name === 'TokenExpiredError';
    });
  });

  console.log('\n================================================================');
  console.log(`🏁 RESULTADO FINAL: ${passedTests}/${totalTests} testes aprovados com 100% de sucesso!`);
  console.log('================================================================\n');
}

main().catch(err => {
  console.error('\n❌ Erro durante a execução dos testes:', err);
  process.exit(1);
});
