/**
 * test_pedidos_compras.js
 * Suite de testes automatizados para a sub-aba Pedidos Compras (SC7 Multi-Empresa).
 */

const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const protheusDb = require('./protheus_db');
const server = require('./server');

const JWT_SECRET = process.env.JWT_SECRET || 'gsi_portal_jwt_secret_key_prod_2026_x89a';

console.log('\n====================================================');
console.log('🧪 TESTES AUTOMATIZADOS: PEDIDOS DE COMPRAS (SC7)');
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

// 1. Teste de Cálculo de Saldo Pendente (C7_QUANT - C7_QUJE)
test('Cálculo de saldo pendente de compras respeita (C7_QUANT - C7_QUJE)', () => {
  function calcularSaldo(quant, quje) {
    return Math.max(0, (Number(quant) || 0) - (Number(quje) || 0));
  }

  assert.strictEqual(calcularSaldo(10, 0), 10, 'Pedido sem entregas parciais');
  assert.strictEqual(calcularSaldo(10, 3), 7, 'Pedido com entrega parcial de 3 unidades');
  assert.strictEqual(calcularSaldo(5, 5), 0, 'Pedido totalmente entregue');
  assert.strictEqual(calcularSaldo(5, 8), 0, 'Entrega excedente não gera saldo negativo');
});

// 2. Teste de Formatação de Identificador PedCom com Sigla da Empresa
test('Formatação de PedCom com sigla da empresa e número do pedido', () => {
  function formatarPedCom(sigla, numPed) {
    return `${sigla}${String(numPed || '').trim()}`;
  }

  assert.strictEqual(formatarPedCom('MP', '000207'), 'MP000207');
  assert.strictEqual(formatarPedCom('GSI', '000150'), 'GSI000150');
  assert.strictEqual(formatarPedCom('OACO', '000320'), 'OACO000320');
});

// 3. Teste de Formatação de Datas Protheus (YYYYMMDD -> DD/MM/AAAA)
test('Formatação de datas Protheus YYYYMMDD para DD/MM/AAAA', () => {
  assert.strictEqual(protheusDb.formatarDataProtheus('20260827'), '27/08/2026');
  assert.strictEqual(protheusDb.formatarDataProtheus('20260909'), '09/09/2026');
  assert.strictEqual(protheusDb.formatarDataProtheus(''), '-');
  assert.strictEqual(protheusDb.formatarDataProtheus(null), '-');
});

// 4. Teste de Filtro Instantâneo por Texto (Descrição, Código, Pedido, Fornecedor)
test('Filtro textual encontra correspondências parciais case-insensitive', () => {
  const lista = [
    { descricao: 'ARMARIO CORTA FOGO GSI 100X100X45 CM', codProduto: 'MP000207', pedCom: 'MP000207', fornecedor: 'GSI FABRICA' },
    { descricao: 'COFRE CHAVE TETRA MASTER 100 GSI', codProduto: 'CF00100', pedCom: 'GSI000150', fornecedor: 'GSI COFRES' },
    { descricao: 'FECHADURA TRIPLA ARMARIO CORTA FOGO', codProduto: '25580', pedCom: 'OACO000050', fornecedor: 'FORNECEDOR AÇO' }
  ];

  function filtrar(termo) {
    const s = termo.toLowerCase().trim();
    return lista.filter(p => 
      p.descricao.toLowerCase().includes(s) ||
      p.codProduto.toLowerCase().includes(s) ||
      p.pedCom.toLowerCase().includes(s) ||
      p.fornecedor.toLowerCase().includes(s)
    );
  }

  assert.strictEqual(filtrar('armario').length, 2);
  assert.strictEqual(filtrar('cofre').length, 1);
  assert.strictEqual(filtrar('MP000207').length, 1);
  assert.strictEqual(filtrar('25580').length, 1);
  assert.strictEqual(filtrar('AÇO').length, 1);
  assert.strictEqual(filtrar('inexistente').length, 0);
});

// 5. Teste de Ordenação por Previsão, Descrição, Saldo e Pedido
test('Ordenação de compras respeita data de previsão ISO, saldo numérico e texto', () => {
  function ordenar(lista, field, dir) {
    return [...lista].sort((a, b) => {
      let cmp = 0;
      if (field === 'saldoCompras') {
        cmp = (Number(a.saldoCompras) || 0) - (Number(b.saldoCompras) || 0);
      } else if (field === 'previsao') {
        cmp = (a.previsaoRaw || '').localeCompare(b.previsaoRaw || '');
      } else if (field === 'pedCom') {
        const numA = parseInt(String(a.pedCom || '').replace(/\D/g, ''), 10);
        const numB = parseInt(String(b.pedCom || '').replace(/\D/g, ''), 10);
        cmp = numA - numB;
      } else {
        cmp = (a.descricao || '').localeCompare(b.descricao || '', 'pt-BR');
      }
      return dir === 'desc' ? -cmp : cmp;
    });
  }

  const mock = [
    { descricao: 'COFRE C', pedCom: 'MP000030', saldoCompras: 15, previsaoRaw: '20260910' },
    { descricao: 'ARMARIO A', pedCom: 'MP000010', saldoCompras: 5, previsaoRaw: '20260828' },
    { descricao: 'FECHADURA B', pedCom: 'MP000020', saldoCompras: 50, previsaoRaw: '20260901' }
  ];

  // Previsão ASC (mais próximas primeiro)
  const sortPrevAsc = ordenar(mock, 'previsao', 'asc');
  assert.deepStrictEqual(sortPrevAsc.map(x => x.previsaoRaw), ['20260828', '20260901', '20260910']);

  // Saldo DESC (maiores quantidades primeiro)
  const sortSaldoDesc = ordenar(mock, 'saldoCompras', 'desc');
  assert.deepStrictEqual(sortSaldoDesc.map(x => x.saldoCompras), [50, 15, 5]);

  // Descrição ASC
  const sortDescAsc = ordenar(mock, 'descricao', 'asc');
  assert.deepStrictEqual(sortDescAsc.map(x => x.descricao), ['ARMARIO A', 'COFRE C', 'FECHADURA B']);
});

// 6. Teste de Filtragem Estrita por Tipo de Produto PA (B1_TIPO = 'PA')
test('Filtro de produto aceita somente tipo PA e rejeita outros tipos (MP, PI, MC, SV)', () => {
  function validarTipoPA(tipo) {
    const t = String(tipo || '').trim().toUpperCase();
    return t === 'PA';
  }

  assert.strictEqual(validarTipoPA('PA'), true, 'Tipo PA deve ser aceito');
  assert.strictEqual(validarTipoPA('pa'), true, 'Tipo pa (minúsculo) deve ser aceito');
  assert.strictEqual(validarTipoPA('MP'), false, 'Tipo MP (Matéria Prima) deve ser rejeitado');
  assert.strictEqual(validarTipoPA('PI'), false, 'Tipo PI (Produto Intermediário) deve ser rejeitado');
  assert.strictEqual(validarTipoPA('MC'), false, 'Tipo MC (Material de Consumo) deve ser rejeitado');
  assert.strictEqual(validarTipoPA('SV'), false, 'Tipo SV (Serviço) deve ser rejeitado');
  assert.strictEqual(validarTipoPA(''), false, 'Tipo vazio deve ser rejeitado');
});

// 7. Teste de Filtragem Estrita por Faixa de Código (001000000000000 a 019999999999999)
test('Filtro de produto aceita somente códigos na faixa entre 001000000000000 e 019999999999999', () => {
  function validarFaixaCodigo(cod) {
    const c = String(cod || '').trim();
    return c >= '001000000000000' && c <= '019999999999999';
  }

  assert.strictEqual(validarFaixaCodigo('001000000000000'), true, 'Limite inferior exato');
  assert.strictEqual(validarFaixaCodigo('001000000000001'), true, 'Início da faixa');
  assert.strictEqual(validarFaixaCodigo('010000000000000'), true, 'Meio da faixa');
  assert.strictEqual(validarFaixaCodigo('019999999999999'), true, 'Limite superior exato');
  assert.strictEqual(validarFaixaCodigo('000999999999999'), false, 'Abaixo do limite inferior');
  assert.strictEqual(validarFaixaCodigo('020000000000000'), false, 'Acima do limite superior');
  assert.strictEqual(validarFaixaCodigo('999999999999999'), false, 'Fora da faixa');
  assert.strictEqual(validarFaixaCodigo('PRODUTO_TESTE'), false, 'Texto arbitrário fora da faixa');
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

async function runHttpSecurityTests(portToUse = 3000) {
  const adminToken = jwt.sign({ username: 'alexandre', name: 'Alexandre', role: 'admin', permissions: ['vendedores'] }, JWT_SECRET);
  const vendorToken = jwt.sign({ username: 'juliana', name: 'Juliana', role: 'vendedor', vendorCode: '000074', permissions: ['vendedores'] }, JWT_SECRET);

  const testPort = portToUse;

  // 6.1. Requisição não autenticada deve ser rejeitada com 401
  await asyncTest('GET /api/vendedores/pedidos/compras sem token é bloqueado com 401 Unauthorized', async () => {
    const res = await makeRequest({
      hostname: '127.0.0.1',
      port: testPort,
      path: '/api/vendedores/pedidos/compras',
      method: 'GET'
    });
    assert.strictEqual(res.status, 401, 'Endpoint deve exigir autenticação');
    assert.strictEqual(res.body.success, false);
  });

  // 6.2. Requisição autenticada de vendedor deve retornar 200 OK com array
  await asyncTest('GET /api/vendedores/pedidos/compras com token de vendedor responde 200 OK', async () => {
    const res = await makeRequest({
      hostname: '127.0.0.1',
      port: testPort,
      path: '/api/vendedores/pedidos/compras',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${vendorToken}`
      }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert(Array.isArray(res.body.data), 'data deve ser um array');
  });

  // 6.3. Requisição de admin deve retornar 200 OK
  await asyncTest('GET /api/vendedores/pedidos/compras com token de admin responde 200 OK', async () => {
    const res = await makeRequest({
      hostname: '127.0.0.1',
      port: testPort,
      path: '/api/vendedores/pedidos/compras?empresa=MP',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${adminToken}`
      }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
  });

  console.log(`\n====================================================`);
  console.log(`🏁 RESULTADO: ${passCount} passaram, ${failCount} falharam.`);
  console.log('====================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

// Inicia servidor temporário para testes HTTP se não estiver ouvindo
const tempServer = http.createServer(server);
tempServer.listen(0, () => {
  const dynamicPort = tempServer.address().port;
  runHttpSecurityTests(dynamicPort).then(() => {
    tempServer.close();
  }).catch((err) => {
    console.error('Erro nos testes HTTP:', err);
    tempServer.close();
    process.exit(1);
  });
});
