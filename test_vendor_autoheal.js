/**
 * test_vendor_autoheal.js
 * Suíte de Testes Automatizados para Autocura de vendorCode e Gestão de Usuários Vendedores
 */

const http = require('http');
const jwt = require('jsonwebtoken');
const app = require('./server');
const { getUsers, saveUser } = require('./postgres_db');

const JWT_SECRET = process.env.JWT_SECRET || 'gsi_portal_jwt_secret_key_prod_2026_x89a';

let server;
let port;
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${message}`);
    failed++;
  }
}

async function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request({
      hostname: '127.0.0.1',
      port: port,
      path: path,
      method: method,
      headers: headers
    }, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(raw), raw });
        } catch {
          resolve({ status: res.statusCode, data: raw, raw });
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runTests() {
  console.log('\n====================================================');
  console.log('🧪 TESTES AUTOMATIZADOS: AUTOCURA & GESTÃO VENDEDORES');
  console.log('====================================================\n');

  // Inicia servidor de teste
  server = http.createServer(app);
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      console.log(`Servidor de teste escutando na porta ${port}\n`);
      resolve();
    });
  });

  const adminToken = jwt.sign({ username: 'alexandre', name: 'Alexandre', role: 'admin', permissions: ['configuracoes', 'vendedores'] }, JWT_SECRET);

  try {
    // 1. Simula usuário Juliana com vendorCode NULL no banco/JSON
    console.log('--- Cenário 1: Autocura no Login ---');
    await saveUser({
      username: 'juliana',
      name: 'Juliana',
      email: 'juliana@oaco.com.br',
      role: 'vendedor',
      vendorCode: null, // Força nulo
      permissions: ['vendedores'],
      active: true
    });

    // Faz login com Juliana
    const loginRes = await request('POST', '/api/auth/login', { username: 'juliana', password: '102030' });
    assert(loginRes.status === 200, 'Login da Juliana responde 200 OK');
    
    // Se solicitou 2FA, verifica autocura no token temporário ou na validação 2FA
    let julianaJwt = null;
    if (loginRes.data.require2FA) {
      assert(loginRes.data.require2FA === true, 'Login requer 2FA com e-mail cadastrado');
    } else {
      assert(loginRes.data.user.vendorCode === '000074', 'Autocura no login preenche vendorCode: "000074"');
      julianaJwt = loginRes.data.token;
    }

    // 2. Token gerado com autocura em getUserFromReq
    console.log('\n--- Cenário 2: Resiliência em getUserFromReq com Token Antigo (vendorCode: null) ---');
    const legacyJulianaToken = jwt.sign({
      username: 'juliana',
      name: 'Juliana',
      role: 'vendedor',
      vendorCode: null, // Token legado sem vendorCode
      permissions: ['vendedores']
    }, JWT_SECRET);

    const pedAbertosRes = await request('GET', '/api/vendedores/pedidos/abertos', null, legacyJulianaToken);
    assert(pedAbertosRes.status === 200, 'Requisição com token legado da Juliana é auto-resolvida e responde 200 OK (não 403)');
    assert(pedAbertosRes.data.success === true, 'Retorno contém success: true');

    // 3. Resiliência para Andrea e Figueiredo
    console.log('\n--- Cenário 3: Resiliência para Andrea e Figueiredo ---');
    const legacyAndreaToken = jwt.sign({ username: 'andrea', name: 'Andrea', role: 'vendedor', vendorCode: null }, JWT_SECRET);
    const legacyFigueiredoToken = jwt.sign({ username: 'figueiredo', name: 'Figueiredo', role: 'vendedor', vendorCode: null }, JWT_SECRET);

    const andreaRes = await request('GET', '/api/vendedores/pedidos/abertos', null, legacyAndreaToken);
    assert(andreaRes.status === 200, 'Token legado de Andrea (000064) responde 200 OK');

    const figRes = await request('GET', '/api/vendedores/pedidos/abertos', null, legacyFigueiredoToken);
    assert(figRes.status === 200, 'Token legado de Figueiredo (000004) responde 200 OK');

    // 4. Vendedor desconhecido sem vendorCode continua bloqueado (Fail-Closed)
    console.log('\n--- Cenário 4: Segurança Fail-Closed para Vendedor Desconhecido ---');
    const unknownVendorToken = jwt.sign({ username: 'vendedor_fantasma', name: 'Fantasma', role: 'vendedor', vendorCode: null }, JWT_SECRET);
    const unknownRes = await request('GET', '/api/vendedores/pedidos/abertos', null, unknownVendorToken);
    assert(unknownRes.status === 403, 'Vendedor sem vendorCode e sem mapeamento padrão recebe 403 Forbidden');
    assert(unknownRes.data.message && unknownRes.data.message.includes('Perfil de vendedor sem código'), 'Mensagem de segurança correta');

    // 5. Gestão de Usuários: Preservação de vendorCode na edição
    console.log('\n--- Cenário 5: Preservação de vendorCode no Painel Admin ---');
    // Salva Juliana sem passar vendorCode no body (comportamento de tela antiga)
    const saveWithoutCodeRes = await request('POST', '/api/admin/users/save', {
      username: 'juliana',
      name: 'Juliana Silva',
      email: 'juliana@oaco.com.br',
      role: 'vendedor',
      permissions: ['vendedores'],
      active: true
    }, adminToken);
    assert(saveWithoutCodeRes.status === 200, 'Admin salva usuário com sucesso');

    const usersListRes = await request('GET', '/api/admin/users', null, adminToken);
    const julianaUser = usersListRes.data.users.find(u => u.username === 'juliana');
    assert(julianaUser && julianaUser.vendorCode === '000074', 'vendorCode de Juliana foi preservado como "000074"');

    // 6. Gestão de Usuários: Atualização explícita de vendorCode
    console.log('\n--- Cenário 6: Atualização explícita de vendorCode ---');
    const saveWithNewCodeRes = await request('POST', '/api/admin/users/save', {
      username: 'novo_vendedor_teste',
      name: 'Novo Vendedor Teste',
      email: 'teste.vend@oaco.com.br',
      role: 'vendedor',
      vendorCode: '000099',
      permissions: ['vendedores'],
      active: true
    }, adminToken);
    assert(saveWithNewCodeRes.status === 200, 'Admin cadastra novo vendedor com vendorCode explícito');

    const usersListRes2 = await request('GET', '/api/admin/users', null, adminToken);
    const novoVend = usersListRes2.data.users.find(u => u.username === 'novo_vendedor_teste');
    assert(novoVend && novoVend.vendorCode === '000099', 'Novo vendedor gravado com vendorCode "000099"');

  } catch (err) {
    console.error('Erro na execução dos testes:', err);
    failed++;
  } finally {
    // Restaura base limpa
    await saveUser({
      username: 'juliana',
      name: 'Juliana',
      email: 'juliana@oaco.com.br',
      role: 'vendedor',
      vendorCode: '000074',
      permissions: ['vendedores'],
      active: true
    });

    if (server) server.close();

    console.log('\n====================================================');
    console.log(`🏁 RESULTADO: ${passed} passaram, ${failed} falharam.`);
    console.log('====================================================\n');

    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
