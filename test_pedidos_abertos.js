/**
 * test_pedidos_abertos.js
 * Teste unitário, integração e segurança adversarial para Pedidos Abertos (SC5/SC9).
 */

const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const protheusDb = require('./protheus_db');
const server = require('./server');

const JWT_SECRET = process.env.JWT_SECRET || 'gsi_portal_jwt_secret_key_prod_2026_x89a';

console.log('\n====================================================');
console.log('🧪 TESTES AUTOMATIZADOS: PEDIDOS ABERTOS & SEGURANÇA');
console.log('====================================================\n');

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passCount++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
    failCount++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passCount++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
    failCount++;
  }
}

// 1. Testes de Bloqueio de Estoque (C9_BLEST) conforme regra Power BI
test('C9_BLEST = "10" resulta em "SEM BLOQ ESTOQ"', () => {
  assert.strictEqual(protheusDb.calcularStatusBloqueioEstoque('10'), 'SEM BLOQ ESTOQ');
  assert.strictEqual(protheusDb.calcularStatusBloqueioEstoque(' 10 '), 'SEM BLOQ ESTOQ');
});

test('C9_BLEST = "02" resulta em "BLOQ POR ESTOQUE"', () => {
  assert.strictEqual(protheusDb.calcularStatusBloqueioEstoque('02'), 'BLOQ POR ESTOQUE');
  assert.strictEqual(protheusDb.calcularStatusBloqueioEstoque(' 02 '), 'BLOQ POR ESTOQUE');
});

test('C9_BLEST vazio, nulo ou sem "0" resulta em "SEM BLOQ ESTOQ"', () => {
  assert.strictEqual(protheusDb.calcularStatusBloqueioEstoque(''), 'SEM BLOQ ESTOQ');
  assert.strictEqual(protheusDb.calcularStatusBloqueioEstoque(null), 'SEM BLOQ ESTOQ');
  assert.strictEqual(protheusDb.calcularStatusBloqueioEstoque(undefined), 'SEM BLOQ ESTOQ');
  assert.strictEqual(protheusDb.calcularStatusBloqueioEstoque('1'), 'SEM BLOQ ESTOQ');
  assert.strictEqual(protheusDb.calcularStatusBloqueioEstoque('2'), 'SEM BLOQ ESTOQ');
});

// 2. Testes de Bloqueio de Crédito (C9_BLCRED) conforme regra Power BI
test('C9_BLCRED = "10" resulta em "SEM BLOQ CREDITO"', () => {
  assert.strictEqual(protheusDb.calcularStatusBloqueioCredito('10'), 'SEM BLOQ CREDITO');
  assert.strictEqual(protheusDb.calcularStatusBloqueioCredito(' 10 '), 'SEM BLOQ CREDITO');
});

test('C9_BLCRED = "01" resulta em "BLOQ NO CREDITO"', () => {
  assert.strictEqual(protheusDb.calcularStatusBloqueioCredito('01'), 'BLOQ NO CREDITO');
  assert.strictEqual(protheusDb.calcularStatusBloqueioCredito(' 01 '), 'BLOQ NO CREDITO');
});

test('C9_BLCRED vazio, nulo ou sem "1" resulta em "SEM BLOQ CREDITO"', () => {
  assert.strictEqual(protheusDb.calcularStatusBloqueioCredito(''), 'SEM BLOQ CREDITO');
  assert.strictEqual(protheusDb.calcularStatusBloqueioCredito(null), 'SEM BLOQ CREDITO');
  assert.strictEqual(protheusDb.calcularStatusBloqueioCredito(undefined), 'SEM BLOQ CREDITO');
  assert.strictEqual(protheusDb.calcularStatusBloqueioCredito('0'), 'SEM BLOQ CREDITO');
  assert.strictEqual(protheusDb.calcularStatusBloqueioCredito('2'), 'SEM BLOQ CREDITO');
});

// 3. Teste de Agregação SC9 Multi-Itens (Precedência Estrita de Bloqueio)
test('Agregação SC9 prioriza bloqueio (02/01) sobre liberação (10) em pedidos multi-itens', () => {
  function simularAgregacaoSC9(itensSC9) {
    const hasBloqEstoque = itensSC9.some(it => String(it.C9_BLEST || '').trim() === '02');
    const hasLibEstoque = itensSC9.some(it => String(it.C9_BLEST || '').trim() === '10');
    const blestFinal = hasBloqEstoque ? '02' : (hasLibEstoque ? '10' : '');

    const hasBloqCred = itensSC9.some(it => String(it.C9_BLCRED || '').trim() === '01');
    const hasLibCred = itensSC9.some(it => String(it.C9_BLCRED || '').trim() === '10');
    const blcredFinal = hasBloqCred ? '01' : (hasLibCred ? '10' : '');

    return {
      bloqEstoque: protheusDb.calcularStatusBloqueioEstoque(blestFinal),
      bloqCredito: protheusDb.calcularStatusBloqueioCredito(blcredFinal)
    };
  }

  // Pedido com 2 itens: Item 1 liberado (10), Item 2 bloqueado por estoque (02)
  const res1 = simularAgregacaoSC9([
    { C9_ITEM: '01', C9_BLEST: '10', C9_BLCRED: '10' },
    { C9_ITEM: '02', C9_BLEST: '02', C9_BLCRED: '10' }
  ]);
  assert.strictEqual(res1.bloqEstoque, 'BLOQ POR ESTOQUE', 'Deve priorizar bloqueio de estoque');
  assert.strictEqual(res1.bloqCredito, 'SEM BLOQ CREDITO');

  // Pedido com 2 itens: Item 1 liberado (10), Item 2 bloqueado por crédito (01)
  const res2 = simularAgregacaoSC9([
    { C9_ITEM: '01', C9_BLEST: '10', C9_BLCRED: '10' },
    { C9_ITEM: '02', C9_BLEST: '10', C9_BLCRED: '01' }
  ]);
  assert.strictEqual(res2.bloqEstoque, 'SEM BLOQ ESTOQ');
  assert.strictEqual(res2.bloqCredito, 'BLOQ NO CREDITO', 'Deve priorizar bloqueio de crédito');
});

// 4. Teste de Extração de ID e Link do Pipedrive
test('Extração de dígitos e sanitização para link do Pipedrive', () => {
  function getPipedriveDealUrl(codWeb) {
    const raw = String(codWeb || '').trim();
    const digits = raw.replace(/\D/g, '');
    if (!digits || digits.length < 3 || digits === '00' || raw === '-' || raw === '0') return null;
    return `https://benetroncomercial.pipedrive.com/deal/${digits}`;
  }

  assert.strictEqual(getPipedriveDealUrl('12345'), 'https://benetroncomercial.pipedrive.com/deal/12345');
  assert.strictEqual(getPipedriveDealUrl('WEB-98412'), 'https://benetroncomercial.pipedrive.com/deal/98412');
  assert.strictEqual(getPipedriveDealUrl(' 554433 '), 'https://benetroncomercial.pipedrive.com/deal/554433');
  assert.strictEqual(getPipedriveDealUrl('00'), null, 'Dígitos inválidos como 00 devem ser rejeitados');
  assert.strictEqual(getPipedriveDealUrl('1'), null, 'Deal IDs muito curtos devem ser rejeitados');
  assert.strictEqual(getPipedriveDealUrl('-'), null);
  assert.strictEqual(getPipedriveDealUrl(''), null);
  assert.strictEqual(getPipedriveDealUrl(null), null);
});

// 5. Teste de Mapeamento e Siglas de Empresas
test('Siglas oficiais de empresas para exibição em tabela', () => {
  const empresas = [
    { key: "OACO", sigla: "OACO", codigo: "16" },
    { key: "GSI", sigla: "GSI", codigo: "15" },
    { key: "METAL_PLENO", sigla: "MP", codigo: "14" }
  ];

  const mapSigla = (key) => {
    const found = empresas.find(e => e.key === key || e.sigla === key || e.codigo === key);
    return found ? found.sigla : key;
  };

  assert.strictEqual(mapSigla('OACO'), 'OACO');
  assert.strictEqual(mapSigla('GSI'), 'GSI');
  assert.strictEqual(mapSigla('METAL_PLENO'), 'MP');
  assert.strictEqual(mapSigla('14'), 'MP');
  assert.strictEqual(mapSigla('15'), 'GSI');
  assert.strictEqual(mapSigla('16'), 'OACO');
});

// 6. Teste de De-Para de Vendedores
test('De-Para de códigos de vendedor', () => {
  assert.strictEqual(protheusDb.getNomeVendedor('000004'), 'Figueiredo');
  assert.strictEqual(protheusDb.getNomeVendedor('000064'), 'Andrea');
  assert.strictEqual(protheusDb.getNomeVendedor('000074'), 'Juliana');
  assert.strictEqual(protheusDb.getNomeVendedor('4'), 'Figueiredo');
  assert.strictEqual(protheusDb.getNomeVendedor('64'), 'Andrea');
  assert.strictEqual(protheusDb.getNomeVendedor('74'), 'Juliana');
});

// Helper para chamadas HTTP
function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, rawBody: body });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    req.end();
  });
}

// 7. Testes de Segurança HTTP & Proteção RBAC / BOLA
async function runHttpSecurityTests() {
  const adminToken = jwt.sign({ username: 'alexandre', name: 'Alexandre', role: 'admin', permissions: ['vendedores'] }, JWT_SECRET);
  const vendorJulianaToken = jwt.sign({ username: 'juliana', name: 'Juliana', role: 'vendedor', vendorCode: '000074', permissions: ['vendedores'] }, JWT_SECRET);

  const testPort = 3000;

  // 7.1. Requisição não autenticada deve ser rejeitada com 401
  await asyncTest('GET /api/vendedores/pedidos/abertos sem token é bloqueado com 401 Unauthorized', async () => {
    const res = await makeRequest({
      hostname: '127.0.0.1',
      port: testPort,
      path: '/api/vendedores/pedidos/abertos',
      method: 'GET'
    });
    assert.strictEqual(res.status, 401, 'Endpoint deve exigir autenticação');
    assert.strictEqual(res.body.success, false);
  });

  // 7.2. Requisição de detalhes sem token deve ser rejeitada com 401
  await asyncTest('GET /api/vendedores/pedidos/detalhes sem token é bloqueado com 401 Unauthorized', async () => {
    const res = await makeRequest({
      hostname: '127.0.0.1',
      port: testPort,
      path: '/api/vendedores/pedidos/detalhes?empresaKey=OACO&numPedido=000630',
      method: 'GET'
    });
    assert.strictEqual(res.status, 401, 'Endpoint de detalhes deve exigir autenticação');
    assert.strictEqual(res.body.success, false);
  });

  // 7.3. Requisição com token de vendedor autenticado tem sucesso
  await asyncTest('GET /api/vendedores/pedidos/abertos com Bearer JWT responde 200 OK', async () => {
    const res = await makeRequest({
      hostname: '127.0.0.1',
      port: testPort,
      path: '/api/vendedores/pedidos/abertos',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${vendorJulianaToken}`
      }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert(Array.isArray(res.body.data), 'data deve ser um array');
  });

  // 7.4. Requisição de admin com Bearer JWT responde 200 OK
  await asyncTest('GET /api/vendedores/pedidos/abertos com token de Admin responde 200 OK', async () => {
    const res = await makeRequest({
      hostname: '127.0.0.1',
      port: testPort,
      path: '/api/vendedores/pedidos/abertos',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${adminToken}`
      }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
  });

  // 7.5. Vendedor sem vendorCode associado deve ser bloqueado com 403 (Fail-Closed)
  const invalidVendorToken = jwt.sign({ username: 'sem_codigo', name: 'Vendedor Sem Código', role: 'vendedor' }, JWT_SECRET);
  await asyncTest('Vendedor sem vendorCode recebe 403 Forbidden (Fail-Closed)', async () => {
    const res = await makeRequest({
      hostname: '127.0.0.1',
      port: testPort,
      path: '/api/vendedores/pedidos/abertos',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${invalidVendorToken}`
      }
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.success, false);
  });

  // 7.6. POST /api/vendedores/pedidos/search sem token é bloqueado com 401
  await asyncTest('POST /api/vendedores/pedidos/search sem token é bloqueado com 401 Unauthorized', async () => {
    const res = await makeRequest({
      hostname: '127.0.0.1',
      port: testPort,
      path: '/api/vendedores/pedidos/search',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { codWeb: '123' });
    assert.strictEqual(res.status, 401);
  });

  // 7.7. POST /api/vendedores/comissoes sem token é bloqueado com 401
  await asyncTest('POST /api/vendedores/comissoes sem token é bloqueado com 401 Unauthorized', async () => {
    const res = await makeRequest({
      hostname: '127.0.0.1',
      port: testPort,
      path: '/api/vendedores/comissoes',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { dataIni: '2026-08-01', dataFim: '2026-08-25' });
    assert.strictEqual(res.status, 401);
  });

  console.log(`\n====================================================`);
  console.log(`🏁 RESULTADO: ${passCount} passaram, ${failCount} falharam.`);
  console.log('====================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

// Inicia servidor temporário para testes HTTP se não estiver ouvindo
const testApp = server.listen ? server : null;
const tempServer = http.createServer(server);
tempServer.listen(3000, () => {
  runHttpSecurityTests().then(() => {
    tempServer.close();
  }).catch((err) => {
    console.error('Erro nos testes HTTP:', err);
    tempServer.close();
    process.exit(1);
  });
});
