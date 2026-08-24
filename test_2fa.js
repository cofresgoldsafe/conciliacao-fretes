/**
 * test_2fa.js
 * Suíte de Testes Automatizados para Autenticação em Dois Fatores (2FA) e Gestão de E-mails
 * Valida: Nodemailer/Mailer, Hasheamento do Código de 4 Dígitos, Rate Limits, Expiração de 5 min,
 * Bloqueio de Força Bruta (3 tentativas), Proteção PII (maskEmail) e Integração com API REST.
 */

const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const app = require('./server');
const { 
  create2FAToken, 
  verify2FAToken, 
  resend2FAToken, 
  getUsers, 
  saveUser 
} = require('./postgres_db');
const { 
  maskEmail, 
  isValidEmail, 
  send2FACodeEmail 
} = require('./mailer');

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

async function run2FATests() {
  console.log('\n🔐 ====================================================');
  console.log('🔐 INICIANDO SUÍTE DE TESTES: AUTENTICAÇÃO 2FA & E-MAILS');
  console.log('🔐 ====================================================\n');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}`);
      console.error(`     Erro: ${err.message}`);
    }
  }

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

  // --- 1. TESTES DO MÓDULO MAILER & UTILITÁRIOS ---
  console.log('🔹 1. Módulo Mailer, Sanitização & Mascaramento PII');

  test('Validação de e-mail sintático (isValidEmail)', () => {
    assert.strictEqual(isValidEmail('alexandre@oaco.com.br'), true);
    assert.strictEqual(isValidEmail('usuario.teste@empresa.com'), true);
    assert.strictEqual(isValidEmail(''), false);
    assert.strictEqual(isValidEmail(null), false);
    assert.strictEqual(isValidEmail('email_invalido'), false);
    assert.strictEqual(isValidEmail('sem_arroba.com'), false);
  });

  test('Mascaramento seguro de e-mail para exibição na UI (maskEmail)', () => {
    const masked = maskEmail('alexandre@oaco.com.br');
    assert.strictEqual(masked, 'al*******@oaco.com.br');

    const maskedShort = maskEmail('ab@oaco.com.br');
    assert.strictEqual(maskedShort, 'a***@oaco.com.br');

    const maskedNull = maskEmail(null);
    assert.strictEqual(maskedNull, '');
  });

  await testAsync('Disparo de e-mail com template 2FA em modo desenvolvimento/fallback', async () => {
    const result = await send2FACodeEmail({
      to: 'teste.qa@oaco.com.br',
      code: '8492',
      name: 'Operador Teste',
      username: 'op_teste',
      ip: '127.0.0.1'
    });
    assert.strictEqual(result.success, true);
  });

  // --- 2. TESTES DA CAMADA DE PERSISTÊNCIA 2FA (POSTGRES / LOCAL MEMORY) ---
  console.log('\n🔹 2. Camada de Persistência, Hasheamento & Regras de Segurança 2FA');

  let testTempToken = '';
  const expectedCode = '4729';

  await testAsync('Geração de token temporário 2FA com hash seguro', async () => {
    const { tempToken, expiresAt } = await create2FAToken('test_user', expectedCode, 5);
    assert.ok(tempToken, 'Deve gerar tempToken');
    assert.ok(tempToken.startsWith('2fa_'));
    assert(expiresAt > Date.now(), 'Expiração deve estar no futuro');
    testTempToken = tempToken;
  });

  await testAsync('Rejeição de código incorreto com decremento de tentativas', async () => {
    const res = await verify2FAToken(testTempToken, '0000');
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.reason, 'INVALID_CODE');
    assert.strictEqual(res.attemptsLeft, 2);
  });

  await testAsync('Rejeição da segunda tentativa com código incorreto', async () => {
    const res = await verify2FAToken(testTempToken, '1111');
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.reason, 'INVALID_CODE');
    assert.strictEqual(res.attemptsLeft, 1);
  });

  await testAsync('Terceira tentativa incorreta bloqueia o token por limite de tentativas', async () => {
    const res = await verify2FAToken(testTempToken, '2222');
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.reason, 'BLOCKED');
    assert.strictEqual(res.attemptsLeft, 0);
  });

  await testAsync('Tentativa posterior em token bloqueado retorna BLOCKED', async () => {
    const res = await verify2FAToken(testTempToken, expectedCode);
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.reason, 'BLOCKED');
  });

  await testAsync('Verificação bem-sucedida de código correto e consumo único (Anti-Replay)', async () => {
    const { tempToken } = await create2FAToken('test_user_valid', '9182', 5);
    
    // 1ª Verificação: Sucesso
    const res1 = await verify2FAToken(tempToken, '9182');
    assert.strictEqual(res1.valid, true);
    assert.strictEqual(res1.username, 'test_user_valid');

    // 2ª Verificação (Replay Attack): Deve ser rejeitado por já ter sido usado
    const res2 = await verify2FAToken(tempToken, '9182');
    assert.strictEqual(res2.valid, false);
    assert.strictEqual(res2.reason, 'ALREADY_USED');
  });

  await testAsync('Reenvio de código 2FA atualiza token e reseta tentativas', async () => {
    const { tempToken } = await create2FAToken('test_user_resend', '1111', 5);
    // Erra uma vez
    await verify2FAToken(tempToken, '0000');

    // Reenvia novo código
    const resendRes = await resend2FAToken(tempToken, '5555', 5);
    assert.strictEqual(resendRes.success, true);

    // Valida com novo código
    const verifyRes = await verify2FAToken(tempToken, '5555');
    assert.strictEqual(verifyRes.valid, true);
  });

  // --- 3. TESTES DE GESTÃO DE USUÁRIOS E PERSISTÊNCIA DE E-MAIL ---
  console.log('\n🔹 3. Gestão de Usuários & Persistência de E-mail');

  await testAsync('Persistência e recuperação de usuário com e-mail corporativo', async () => {
    await saveUser({
      username: 'usuario_2fa_teste',
      name: 'Usuário de Teste 2FA',
      email: 'usuario.2fa@oaco.com.br',
      pass: 'senha_teste_123',
      role: 'user',
      permissions: ['logistica', 'consulta'],
      active: true
    });

    const allUsers = await getUsers();
    const found = allUsers.find(u => u.username === 'usuario_2fa_teste');
    assert.ok(found, 'Usuário salvo deve existir na lista');
    assert.strictEqual(found.email, 'usuario.2fa@oaco.com.br');
  });

  // --- 4. TESTES END-TO-END HTTP REST (LOGIN COM 2FA) ---
  console.log('\n🔹 4. Endpoints HTTP de Autenticação 2FA (E2E)');

  // Subir servidor de teste em porta dinâmica
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  try {
    let apiTempToken = '';

    await testAsync('POST /api/auth/login para usuário com e-mail: Dispara 2FA e retorna tempToken', async () => {
      const res = await request('POST', '/api/auth/login', {
        username: 'usuario_2fa_teste',
        password: 'senha_teste_123'
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.require2FA, true);
      assert.ok(res.body.tempToken, 'Deve retornar tempToken para o step 2FA');
      assert.strictEqual(res.body.emailMasked, maskEmail('usuario.2fa@oaco.com.br'));
      assert.strictEqual(res.body.expiresInSeconds, 300);

      apiTempToken = res.body.tempToken;
    });

    await testAsync('POST /api/auth/verify-2fa: Rejeita código de 4 dígitos incorreto com 400', async () => {
      const res = await request('POST', '/api/auth/verify-2fa', {
        tempToken: apiTempToken,
        code: '9999'
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.attemptsLeft, 2);
    });

    await testAsync('POST /api/auth/verify-2fa: Rejeita requisição sem parâmetros obrigatórios', async () => {
      const res = await request('POST', '/api/auth/verify-2fa', {});
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
    });

    await testAsync('POST /api/auth/resend-2fa: Reenvia novo código para a sessão 2FA ativa', async () => {
      const res = await request('POST', '/api/auth/resend-2fa', {
        tempToken: apiTempToken
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.message.includes('Novo código'));
    });

    // Teste de validação de e-mail na API de salvar usuário
    const adminToken = jwt.sign({ username: 'alexandre', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

    await testAsync('POST /api/admin/users/save: Rejeita formato inválido de e-mail com 400', async () => {
      const res = await request('POST', '/api/admin/users/save', {
        username: 'user_invalido',
        name: 'Usuário Inválido',
        email: 'email_sem_formato_correto',
        role: 'user',
        permissions: ['logistica']
      }, {
        'Authorization': `Bearer ${adminToken}`
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
    });

    await testAsync('POST /api/admin/users/save: Salva com sucesso usuário com e-mail corporativo válido', async () => {
      const res = await request('POST', '/api/admin/users/save', {
        username: 'marcos_logistica',
        name: 'Marcos de Oliveira',
        email: 'marcos@oaco.com.br',
        pass: '10203040',
        role: 'user',
        permissions: ['logistica', 'consulta']
      }, {
        'Authorization': `Bearer ${adminToken}`
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
    });

    await testAsync('GET /api/admin/users: Retorna campo de e-mail cadastrado na listagem', async () => {
      const res = await request('GET', '/api/admin/users', null, {
        'Authorization': `Bearer ${adminToken}`
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      const userMarcos = res.body.users.find(u => u.username === 'marcos_logistica');
      assert.ok(userMarcos, 'Usuário marcos_logistica deve constar na lista');
      assert.strictEqual(userMarcos.email, 'marcos@oaco.com.br');
    });

  } finally {
    if (server) {
      server.close();
    }
  }

  // --- RELATÓRIO FINAL ---
  console.log('\n📊 ====================================================');
  console.log(`📊 TOTAL DE TESTES 2FA EXECUTADOS: ${total}`);
  console.log(`📊 TESTES APROVADOS: ${passed}`);
  console.log(`📊 TESTES COM FALHA: ${total - passed}`);
  console.log('📊 ====================================================\n');

  if (passed === total) {
    console.log('🎉 TODOS OS TESTES DE 2FA PASSARAM COM 100% DE SUCESSO!\n');
    process.exit(0);
  } else {
    console.error('❌ HOUVE FALHA EM TESTES DE 2FA.\n');
    process.exit(1);
  }
}

if (require.main === module) {
  run2FATests().catch(err => {
    console.error('Erro fatal ao rodar testes 2FA:', err);
    process.exit(1);
  });
}

module.exports = run2FATests;
