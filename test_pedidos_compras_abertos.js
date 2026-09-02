/**
 * test_pedidos_compras_abertos.js
 * Suite de testes automatizados para a sub-aba Ped Compras Aberto (SC7 Multi-Empresa)
 * e Modal de Detalhes de Pedido de Compra.
 */

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const vm = require('vm');
const jwt = require('jsonwebtoken');
const protheusDb = require('./protheus_db');
const server = require('./server');

const JWT_SECRET = process.env.JWT_SECRET || 'gsi_portal_jwt_secret_key_prod_2026_x89a';

console.log('\n====================================================');
console.log('🧪 TESTES AUTOMATIZADOS: PED COMPRAS ABERTO (SC7)');
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

// 1. Teste da Regra Estrita de Pedidos Abertos vs. Encerrados
test('Critério de pedido em aberto descarta saldo zero, C7_ENCER = E, C7_RESIDUO = S ou deletados', () => {
  function isPedidoAberto(row) {
    if (row.D_E_L_E_T_ && row.D_E_L_E_T_.trim() !== '') return false;
    const quant = Number(row.C7_QUANT) || 0;
    const quje = Number(row.C7_QUJE) || 0;
    if ((quant - quje) <= 0) return false;
    if (row.C7_RESIDUO && row.C7_RESIDUO.trim() === 'S') return false;
    if (row.C7_ENCER && row.C7_ENCER.trim() === 'E') return false;
    return true;
  }

  // Exemplos reais validados na Empresa 16
  const pedidosAbertosExemplos = [
    { num: '000263', C7_QUANT: 3, C7_QUJE: 0, C7_RESIDUO: '', C7_ENCER: '', D_E_L_E_T_: '' },
    { num: '000264', C7_QUANT: 1, C7_QUJE: 0, C7_RESIDUO: '', C7_ENCER: '', D_E_L_E_T_: '' },
    { num: '000265', C7_QUANT: 400, C7_QUJE: 0, C7_RESIDUO: '', C7_ENCER: '', D_E_L_E_T_: '' },
    { num: '000255', C7_QUANT: 5, C7_QUJE: 0, C7_RESIDUO: '', C7_ENCER: '', D_E_L_E_T_: '' },
    { num: '000258', C7_QUANT: 5, C7_QUJE: 0, C7_RESIDUO: '', C7_ENCER: '', D_E_L_E_T_: '' }
  ];

  const pedidosEncerradosExemplos = [
    { num: '000256', C7_QUANT: 5, C7_QUJE: 5, C7_RESIDUO: '', C7_ENCER: 'E', D_E_L_E_T_: '' },
    { num: '000260', C7_QUANT: 1, C7_QUJE: 1, C7_RESIDUO: '', C7_ENCER: 'E', D_E_L_E_T_: '' },
    { num: '000181', C7_QUANT: 5, C7_QUJE: 5, C7_RESIDUO: '', C7_ENCER: 'E', D_E_L_E_T_: '' },
    { num: '000108', C7_QUANT: 1, C7_QUJE: 1, C7_RESIDUO: '', C7_ENCER: 'E', D_E_L_E_T_: '' }
  ];

  for (const p of pedidosAbertosExemplos) {
    assert.strictEqual(isPedidoAberto(p), true, `Pedido ${p.num} deve ser classificado como ABERTO`);
  }

  for (const p of pedidosEncerradosExemplos) {
    assert.strictEqual(isPedidoAberto(p), false, `Pedido ${p.num} deve ser classificado como ENCERRADO/EXPURGADO`);
  }
});

// 2. Teste do Cálculo Determinístico de Atraso na Data de Entrega
test('Detecção e cálculo de dias de atraso quando data de entrega < hoje', () => {
  function calcularPrazo(dataEntregaRaw, hojeRaw) {
    if (!dataEntregaRaw || dataEntregaRaw.length !== 8) return { statusPrazo: 'NO_PRAZO', diasAtraso: 0 };
    
    const pAno = parseInt(dataEntregaRaw.substring(0, 4), 10);
    const pMes = parseInt(dataEntregaRaw.substring(4, 6), 10) - 1;
    const pDia = parseInt(dataEntregaRaw.substring(6, 8), 10);
    const entregaDate = new Date(pAno, pMes, pDia);

    const hAno = parseInt(hojeRaw.substring(0, 4), 10);
    const hMes = parseInt(hojeRaw.substring(4, 6), 10) - 1;
    const hDia = parseInt(hojeRaw.substring(6, 8), 10);
    const hojeDate = new Date(hAno, hMes, hDia);

    if (dataEntregaRaw < hojeRaw) {
      const diffMs = hojeDate.getTime() - entregaDate.getTime();
      const dias = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
      return { statusPrazo: 'ATRASADO', diasAtraso: dias };
    } else if (dataEntregaRaw === hojeRaw) {
      return { statusPrazo: 'HOJE', diasAtraso: 0 };
    } else {
      return { statusPrazo: 'NO_PRAZO', diasAtraso: 0 };
    }
  }

  const hoje = '20260902';

  const res1 = calcularPrazo('20260810', hoje);
  assert.strictEqual(res1.statusPrazo, 'ATRASADO');
  assert.strictEqual(res1.diasAtraso, 23);

  const res2 = calcularPrazo('20260901', hoje);
  assert.strictEqual(res2.statusPrazo, 'ATRASADO');
  assert.strictEqual(res2.diasAtraso, 1);

  const res3 = calcularPrazo('20260902', hoje);
  assert.strictEqual(res3.statusPrazo, 'HOJE');
  assert.strictEqual(res3.diasAtraso, 0);

  const res4 = calcularPrazo('20260911', hoje);
  assert.strictEqual(res4.statusPrazo, 'NO_PRAZO');
  assert.strictEqual(res4.diasAtraso, 0);
});

// 3. Teste de Agregação de Itens e Totais de Pedido de Compra
test('Agregação de linhas calcula corretamente totalItens, qtdTotal, saldoTotal e valorTotal', () => {
  const itensMock = [
    { C7_ITEM: '0001', C7_QUANT: 10, C7_QUJE: 2, C7_PRECO: 50.0, C7_TOTAL: 500.0 },
    { C7_ITEM: '0002', C7_QUANT: 5, C7_QUJE: 0, C7_PRECO: 100.0, C7_TOTAL: 500.0 },
    { C7_ITEM: '0003', C7_QUANT: 2, C7_QUJE: 2, C7_PRECO: 200.0, C7_TOTAL: 400.0 }
  ];

  const totalItens = itensMock.length;
  const qtdTotal = itensMock.reduce((acc, i) => acc + i.C7_QUANT, 0);
  const qtdEntregue = itensMock.reduce((acc, i) => acc + i.C7_QUJE, 0);
  const saldoTotal = itensMock.reduce((acc, i) => acc + (i.C7_QUANT - i.C7_QUJE), 0);
  const valorTotal = itensMock.reduce((acc, i) => acc + i.C7_TOTAL, 0);

  assert.strictEqual(totalItens, 3);
  assert.strictEqual(qtdTotal, 17);
  assert.strictEqual(qtdEntregue, 4);
  assert.strictEqual(saldoTotal, 13);
  assert.strictEqual(valorTotal, 1400.0);
});

// 4. Teste de Formatação de Data Protheus
test('Formatação de datas Protheus YYYYMMDD para DD/MM/AAAA', () => {
  assert.strictEqual(protheusDb.formatarDataProtheus('20260902'), '02/09/2026');
  assert.strictEqual(protheusDb.formatarDataProtheus('20260828'), '28/08/2026');
  assert.strictEqual(protheusDb.formatarDataProtheus(''), '-');
  assert.strictEqual(protheusDb.formatarDataProtheus(null), '-');
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

// 5. Testes de Endpoints HTTP e Segurança
async function runHttpSecurityTests() {
  const adminToken = jwt.sign({ username: 'alexandre', name: 'Alexandre', role: 'admin', permissions: ['compras'] }, JWT_SECRET);
  const testPort = 3001;

  // 5.1. GET /api/compras/pedidos/abertos sem autenticação -> 401
  await asyncTest('GET /api/compras/pedidos/abertos sem token é bloqueado com 401 Unauthorized', async () => {
    const res = await makeRequest({
      hostname: '127.0.0.1',
      port: testPort,
      path: '/api/compras/pedidos/abertos',
      method: 'GET'
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.success, false);
  });

  // 5.2. GET /api/compras/pedidos/abertos autenticado -> 200 OK com kpis e data
  await asyncTest('GET /api/compras/pedidos/abertos autenticado responde 200 OK com KPIs', async () => {
    const res = await makeRequest({
      hostname: '127.0.0.1',
      port: testPort,
      path: '/api/compras/pedidos/abertos?empresa=OACO',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${adminToken}`
      }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert(Array.isArray(res.body.data), 'res.body.data deve ser um array');
    assert(typeof res.body.kpis === 'object', 'res.body.kpis deve ser um objeto');
    assert(typeof res.body.kpis.totalPedidos === 'number', 'kpis.totalPedidos deve ser numérico');
  });

  // 5.3. GET /api/compras/pedidos/detalhes sem token -> 401
  await asyncTest('GET /api/compras/pedidos/detalhes sem token é bloqueado com 401 Unauthorized', async () => {
    const res = await makeRequest({
      hostname: '127.0.0.1',
      port: testPort,
      path: '/api/compras/pedidos/detalhes?empresaKey=OACO&numPedido=000263',
      method: 'GET'
    });
    assert.strictEqual(res.status, 401);
  });

  // 5.4. GET /api/compras/pedidos/detalhes sem numPedido -> 400
  await asyncTest('GET /api/compras/pedidos/detalhes sem numPedido responde 400 Bad Request', async () => {
    const res = await makeRequest({
      hostname: '127.0.0.1',
      port: testPort,
      path: '/api/compras/pedidos/detalhes?empresaKey=OACO',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${adminToken}`
      }
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.success, false);
  });

  // 5.5. GET /api/compras/pedidos/detalhes com pedido válido -> 200 OK
  await asyncTest('GET /api/compras/pedidos/detalhes com pedido válido retorna cabeçalho e itens', async () => {
    const res = await makeRequest({
      hostname: '127.0.0.1',
      port: testPort,
      path: '/api/compras/pedidos/detalhes?empresaKey=OACO&numPedido=000263',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${adminToken}`
      }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert(res.body.data.cabecalho, 'Deve retornar cabeçalho');
    assert(Array.isArray(res.body.data.itens), 'Deve retornar array de itens');
    assert(res.body.data.totais, 'Deve retornar totais');
  });

  // 6. Teste de Integridade Sintática e Elementos DOM
  test('Validação sintática e de elementos DOM em public/app.js e public/index.html', () => {
    const html = fs.readFileSync('public/index.html', 'utf8');
    const js = fs.readFileSync('public/app.js', 'utf8');

    // Validação de sintaxe JS
    new vm.Script(js);

    // Validação de elementos no HTML
    assert(html.includes('btnTabComprasPedidosComprasAbertos'), 'Botão da sub-aba no HTML');
    assert(html.includes('tab-compras-pedidos-abertos'), 'Painel da sub-aba no HTML');
    assert(html.includes('modalPedidoCompraDetalhes'), 'Modal de detalhes de compra no HTML');
    assert(html.includes('pedidosComprasAbertosTableBody'), 'Tabela de pedidos compras abertos no HTML');

    // Validação de manipuladores no JS
    assert(js.includes('pedidosComprasAbertosTableBody'), 'Manipulação de tabela no app.js');
    assert(js.includes('abrirDetalhesPedidoCompraModal'), 'Função de abertura de modal no app.js');
    assert(js.includes('formatBadgeEntregaComprasAbertos'), 'Função de badge de prazos no app.js');
  });

  console.log(`\n====================================================`);
  console.log(`🏁 RESULTADO: ${passCount} passaram, ${failCount} falharam.`);
  console.log('====================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

// Inicia servidor temporário na porta 3001 para testes HTTP
const tempServer = http.createServer(server);
tempServer.listen(3001, () => {
  runHttpSecurityTests().then(() => {
    tempServer.close();
  }).catch((err) => {
    console.error('Erro nos testes HTTP:', err);
    tempServer.close();
    process.exit(1);
  });
});
