const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Importações dos módulos do projeto
const { hashPassword, verifyPassword, safeQuery, saveUser } = require('./postgres_db');
const app = require('./server');

const JWT_SECRET = process.env.JWT_SECRET || 'gsi_portal_jwt_secret_key_prod_2026_x89a';

async function runSecurityTests() {
  console.log('🧪 ====================================================');
  console.log('🧪 INICIANDO SUÍTE DE TESTES DE SEGURANÇA & HARDENING');
  console.log('🧪 ====================================================\n');

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

  // --- 1. TESTES DE SANITIZAÇÃO SQL / T-SQL INJECTION ---
  console.log('🔹 1. Testes de Sanitização contra SQL Injection');
  
  function sanitizeSqlParam(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/'/g, "''")
      .replace(/;/g, '')
      .replace(/--/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\*/g, '')
      .replace(/\*\//g, '')
      .trim();
  }

  test('Sanitização simples: duplica aspas simples', () => {
    const input = "O'Connor";
    const out = sanitizeSqlParam(input);
    assert.strictEqual(out, "O''Connor");
  });

  test('Sanitização de ataque: remove ponto e vírgula e comentários', () => {
    const malicious = "123'; DROP TABLE users; --";
    const out = sanitizeSqlParam(malicious);
    assert.strictEqual(out, "123'' DROP TABLE users");
  });

  test('Sanitização de ataque: remove comentários de bloco /* */', () => {
    const malicious = "admin' /* comentário malicioso */ OR 1=1";
    const out = sanitizeSqlParam(malicious);
    assert.strictEqual(out, "admin''  OR 1=1");
  });

  test('Sanitização de valores nulos e indefinidos', () => {
    assert.strictEqual(sanitizeSqlParam(null), '');
    assert.strictEqual(sanitizeSqlParam(undefined), '');
  });

  // --- 2. TESTES DE CRIPTOGRAFIA DE SENHAS (BCRYPT) ---
  console.log('\n🔹 2. Testes de Criptografia e Verificação de Senhas (Bcrypt)');

  await testAsync('Gera hash bcrypt válido com salt 10', async () => {
    const plain = 'senha123Teste';
    const hash = await hashPassword(plain);
    assert(hash.startsWith('$2a$') || hash.startsWith('$2b$'), 'O hash deve iniciar com $2a$ ou $2b$');
    assert.notStrictEqual(hash, plain);
  });

  await testAsync('Verifica senha correta com hash bcrypt', async () => {
    const plain = 'MinhaSenhaSecreta#2026';
    const hash = await hashPassword(plain);
    const valid = await verifyPassword(plain, hash);
    assert.strictEqual(valid, true, 'Senha correta deve retornar true');
  });

  await testAsync('Rejeita senha incorreta com hash bcrypt', async () => {
    const plain = 'SenhaOriginal';
    const hash = await hashPassword(plain);
    const valid = await verifyPassword('SenhaErrada', hash);
    assert.strictEqual(valid, false, 'Senha incorreta deve retornar false');
  });

  await testAsync('Verificação híbrida: aceita senha legada em texto puro', async () => {
    const plain = '321654';
    const legacyStored = '321654';
    const valid = await verifyPassword(plain, legacyStored);
    assert.strictEqual(valid, true, 'Senha legada em texto puro deve ser validada');
  });

  // --- 3. TESTES DE JWT (JSON WEB TOKEN) & RBAC ---
  console.log('\n🔹 3. Testes de Token JWT e Permissões');

  test('Gera e valida token JWT assinado com claims corretos', () => {
    const payload = { username: 'alexandre', role: 'admin', permissions: ['logistica', 'configuracoes'] };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
    
    const decoded = jwt.verify(token, JWT_SECRET);
    assert.strictEqual(decoded.username, 'alexandre');
    assert.strictEqual(decoded.role, 'admin');
    assert.deepStrictEqual(decoded.permissions, ['logistica', 'configuracoes']);
  });

  test('Rejeita token JWT assinado com chave secreta inválida', () => {
    const payload = { username: 'hacker', role: 'admin' };
    const forgedToken = jwt.sign(payload, 'chave_falsa_123', { expiresIn: '1h' });
    
    assert.throws(() => {
      jwt.verify(forgedToken, JWT_SECRET);
    }, /invalid signature/);
  });

  // --- 4. TESTES DE INTEGRAÇÃO HTTP VIA SERVIDOR EXPRESS ---
  console.log('\n🔹 4. Testes de Endpoints HTTP e Middlewares de Segurança');

  const server = app.listen(0);
  const serverPort = server.address().port;
  const baseUrl = `http://127.0.0.1:${serverPort}`;

  function request(method, path, headers = {}, body = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const req = http.request(url, {
        method: method,
        headers: {
          'Connection': 'close',
          ...headers
        }
      }, (res) => {
        let resData = '';
        res.on('data', chunk => resData += chunk);
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(resData);
          } catch {
            parsed = resData;
          }
          resolve({ status: res.statusCode, headers: res.headers, data: parsed });
        });
      });

      req.on('error', reject);
      if (body) {
        if (typeof body === 'object') {
          req.setHeader('Content-Type', 'application/json');
          req.write(JSON.stringify(body));
        } else {
          req.write(body);
        }
      }
      req.end();
    });
  }

  try {
    // 4.1 Login com credenciais válidas (Desafio 2FA quando possui e-mail ou JWT direto)
    await testAsync('Endpoint POST /api/auth/login: Sucesso com credenciais válidas retorna desafio 2FA ou JWT', async () => {
      const res = await request('POST', '/api/auth/login', {}, { username: 'alexandre', password: '321654' });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      if (res.data.require2FA) {
        assert.ok(res.data.tempToken, 'Deve retornar tempToken para o passo 2FA');
        assert.ok(res.data.emailMasked, 'Deve retornar email mascarado');
      } else {
        assert(res.data.token && res.data.token.length > 20, 'Deve retornar token JWT');
        assert.strictEqual(res.data.user.role, 'admin');
      }
    });

    // 4.2 Login com credenciais inválidas
    await testAsync('Endpoint POST /api/auth/login: Falha com senha incorreta retorna 401', async () => {
      const res = await request('POST', '/api/auth/login', {}, { username: 'alexandre', password: 'senhaErrada123' });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.data.success, false);
    });

    // 4.3 Bloqueio de rota Admin sem autenticação
    await testAsync('Endpoint GET /api/admin/users: Rejeita 401 se sem token', async () => {
      const res = await request('GET', '/api/admin/users');
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.data.success, false);
    });

    // 4.4 Bloqueio de rota Admin para usuário operador comum
    const userToken = jwt.sign({ username: 'erica', role: 'user' }, JWT_SECRET, { expiresIn: '1h' });
    await testAsync('Endpoint GET /api/admin/users: Rejeita 403 para usuário não-admin', async () => {
      const res = await request('GET', '/api/admin/users', {
        'Authorization': `Bearer ${userToken}`
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.data.success, false);
    });

    // 4.5 Acesso permitido para administrador com JWT válido
    const adminToken = jwt.sign({ username: 'alexandre', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
    await testAsync('Endpoint GET /api/admin/users: Permite 200 com token de admin', async () => {
      const res = await request('GET', '/api/admin/users', {
        'Authorization': `Bearer ${adminToken}`
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert(Array.isArray(res.data.users));
    });

    // 4.6 Bloqueio de rota /api/vipp/config para usuário comum
    await testAsync('Endpoint GET /api/vipp/config: Rejeita 403 para usuário comum', async () => {
      const res = await request('GET', '/api/vipp/config', {
        'Authorization': `Bearer ${userToken}`
      });
      assert.strictEqual(res.status, 403);
    });

    // 4.7 Acesso permitido para /api/vipp/config com token de admin
    await testAsync('Endpoint GET /api/vipp/config: Permite 200 para admin', async () => {
      const res = await request('GET', '/api/vipp/config', {
        'Authorization': `Bearer ${adminToken}`
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
    });

    // 4.8 [SRE-03] Rate Limiting Headers no endpoint de login
    await testAsync('Endpoint POST /api/auth/login: Retorna headers de Rate Limiting (SRE-03)', async () => {
      const res = await request('POST', '/api/auth/login', {}, { username: 'alexandre', password: '321654' });
      assert.strictEqual(res.status, 200);
      const limitHeader = res.headers['ratelimit-limit'] || res.headers['x-ratelimit-limit'];
      assert(limitHeader !== undefined, 'Deve retornar cabeçalho de rate limit');
    });

    // 4.9 [SRE-01] Resiliência de safeQuery sem crash
    await testAsync('Pool Postgres safeQuery: Retorna null ou resultado sem lançar exceção não tratada (SRE-01)', async () => {
      const queryResult = await safeQuery('SELECT 1;');
      // Sem DATABASE_URL, safeQuery retorna null graciosamente
      assert(queryResult === null || typeof queryResult === 'object');
    });

    // 4.10 [SEC-IDOR] Setup e Endpoint POST /api/auth/change-password rejeita senha atual incorreta
    await saveUser({
      username: 'erica',
      name: 'Érica',
      pass: '1020304050',
      role: 'user',
      permissions: ['logistica', 'consulta'],
      active: true
    });

    await testAsync('Endpoint POST /api/auth/change-password: Rejeita troca com senha atual errada', async () => {
      const res = await request('POST', '/api/auth/change-password', {
        'Authorization': `Bearer ${userToken}`
      }, {
        currentPassword: 'senhaErrada999',
        newPassword: 'novaSenhaValida123'
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.success, false);
    });

    // 4.11 [SEC-IDOR] Endpoint POST /api/auth/change-password atualiza com senha atual correta
    await testAsync('Endpoint POST /api/auth/change-password: Sucesso com senha atual correta', async () => {
      const res = await request('POST', '/api/auth/change-password', {
        'Authorization': `Bearer ${userToken}`
      }, {
        currentPassword: '1020304050',
        newPassword: 'novaSenhaErica2026'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
    });

    // 4.12 [SEC-IDOR] Endpoint POST /api/auth/change-password ignora tentativa de IDOR no payload
    await testAsync('Endpoint POST /api/auth/change-password: Previne IDOR (opera apenas no token)', async () => {
      const res = await request('POST', '/api/auth/change-password', {
        'Authorization': `Bearer ${userToken}`
      }, {
        username: 'alexandre', // Tentativa maliciosa de afetar outro usuário
        currentPassword: 'novaSenhaErica2026',
        newPassword: 'senhaRestaurada1020304050'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
    });

    // --- 5. TESTES DE ROW-LEVEL SECURITY (RLS) E SUPABASE HARDENING (Checks 0013 & 0008) ---
    console.log('\n🔹 5. Testes de Validação de Supabase RLS & Proteção de Colunas Sensíveis');

    const fs = require('fs');
    const path = require('path');

    test('Script SQL de remediação fix_supabase_rls_security.sql existe e é válido', () => {
      const sqlPath = path.join(__dirname, 'sql', 'fix_supabase_rls_security.sql');
      assert.ok(fs.existsSync(sqlPath), 'Arquivo sql/fix_supabase_rls_security.sql deve existir');
      const content = fs.readFileSync(sqlPath, 'utf8');
      assert.ok(content.includes('ENABLE ROW LEVEL SECURITY'), 'Deve conter ENABLE ROW LEVEL SECURITY');
      assert.ok(content.includes('FORCE ROW LEVEL SECURITY'), 'Deve conter FORCE ROW LEVEL SECURITY');
      assert.ok(content.includes('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated'), 'Deve revogar acessos públicos de tabelas');
      assert.ok(content.includes('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated'), 'Deve configurar privilégios padrão para futuras tabelas');
    });

    test('postgres_db.js contém rotina dinâmica de RLS e revogação de acessos anônimos', () => {
      const pgDbPath = path.join(__dirname, 'postgres_db.js');
      const content = fs.readFileSync(pgDbPath, 'utf8');
      assert.ok(content.includes('ENABLE ROW LEVEL SECURITY'), 'Deve conter ENABLE ROW LEVEL SECURITY');
      assert.ok(content.includes('FORCE ROW LEVEL SECURITY'), 'Deve conter FORCE ROW LEVEL SECURITY');
      assert.ok(content.includes('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated'), 'Deve conter REVOKE de acessos anônimos');
      assert.ok(content.includes('grupos_produtos_sbm'), 'Deve incluir grupos_produtos_sbm na proteção');
      assert.ok(content.includes('user_2fa_tokens'), 'Deve proteger tabela de tokens 2FA');
      assert.ok(content.includes('analise_credito_history'), 'Deve proteger tabela de análise de crédito');
    });

    test('sql/bi/00_tabela_grupos_sbm.sql possui comandos de RLS e política de backend', () => {
      const sbmSqlPath = path.join(__dirname, 'sql', 'bi', '00_tabela_grupos_sbm.sql');
      const content = fs.readFileSync(sbmSqlPath, 'utf8');
      assert.ok(content.includes('ENABLE ROW LEVEL SECURITY'), 'grupos_produtos_sbm deve habilitar RLS');
      assert.ok(content.includes('FORCE ROW LEVEL SECURITY'), 'grupos_produtos_sbm deve forçar RLS');
      assert.ok(content.includes('service_role'), 'grupos_produtos_sbm deve ter política para service_role');
    });

    await testAsync('Endpoint GET /api/admin/users não vaza hash de senhas (pass) na listagem', async () => {
      const res = await request('GET', '/api/admin/users', {
        'Authorization': `Bearer ${adminToken}`
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert(Array.isArray(res.data.users));
      for (const u of res.data.users) {
        assert.strictEqual(u.pass, undefined, `Usuário ${u.username} não deve ter a coluna pass exposta`);
        assert.strictEqual(u.password, undefined, `Usuário ${u.username} não deve ter a coluna password exposta`);
      }
    });

  } finally {
    server.close();
  }

  console.log('\n====================================================');
  console.log(`📊 RESULTADO FINAL: ${passed}/${total} TESTES PASSARAM COM SUCESSO!`);
  console.log('====================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runSecurityTests().catch(err => {
  console.error('Erro fatal nos testes:', err);
  process.exit(1);
});
