const assert = require('assert');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const http = require('http');

// Configuração do ambiente de teste
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key-123456';

const { 
  buscarPedidosProntosFaturar, 
  buscarPedidosBloqueadosEstoque 
} = require('./protheus_db');

let server;
let app;
const PORT = 3099;

function makeRequest(urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: urlPath,
      method: 'GET',
      headers: headers
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function runTests() {
  console.log('🚀 Iniciando Suíte de Testes Automatizados: Logística - Pedidos Faturar & Bloq Estoque\n');
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  // TESTES DE ESTRUTURA HTML / DOM
  await test('HTML: subGroupLogistica possui as 5 sub-abas na ordem correta', async () => {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    assert(html.includes('id="btnTabPedidosFaturar"'), 'Botão btnTabPedidosFaturar não encontrado');
    assert(html.includes('id="btnTabPedidosLibEstoque"'), 'Botão btnTabPedidosLibEstoque não encontrado');
    assert(html.includes('id="btnTabPedidosBloqEstoque"'), 'Botão btnTabPedidosBloqEstoque não encontrado');
    assert(html.includes('id="btnTabUploadTransp"'), 'Botão btnTabUploadTransp não encontrado');
    assert(html.includes('id="btnTabCorreios"'), 'Botão btnTabCorreios não encontrado');

    const idxFaturar = html.indexOf('id="btnTabPedidosFaturar"');
    const idxLib = html.indexOf('id="btnTabPedidosLibEstoque"');
    const idxBloq = html.indexOf('id="btnTabPedidosBloqEstoque"');
    const idxUpload = html.indexOf('id="btnTabUploadTransp"');
    const idxCorreios = html.indexOf('id="btnTabCorreios"');

    assert(idxFaturar < idxLib, 'Ped. pra Faturar deve vir antes de Ped. Lib Estoque');
    assert(idxLib < idxBloq, 'Ped. Lib Estoque deve vir antes de Ped. Bloq Estoque');
    assert(idxBloq < idxUpload, 'Ped. Bloq Estoque deve vir antes de Upload Transp');
    assert(idxUpload < idxCorreios, 'Upload Transp deve vir antes de Correios');
  });

  await test('HTML: Seções tab-pedidos-faturar e tab-pedidos-bloq-estoque existem com seus elementos', async () => {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    assert(html.includes('id="tab-pedidos-faturar"'), 'Painel tab-pedidos-faturar não encontrado');
    assert(html.includes('id="tab-pedidos-bloq-estoque"'), 'Painel tab-pedidos-bloq-estoque não encontrado');
    assert(html.includes('id="kpiPedidosFaturarCount"'), 'KPI kpiPedidosFaturarCount não encontrado');
    assert(html.includes('id="kpiPedidosBloqCount"'), 'KPI kpiPedidosBloqCount não encontrado');
    assert(html.includes('id="pedidosFaturarTableBody"'), 'TBody pedidosFaturarTableBody não encontrado');
    assert(html.includes('id="pedidosBloqTableBody"'), 'TBody pedidosBloqTableBody não encontrado');
  });

  await test('HTML: tab-conciliacao-bancaria e abas inativas possuem a classe "hidden" para isolamento estrito', async () => {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    assert(html.includes('id="tab-conciliacao-bancaria" class="tab-pane hidden"'), 'tab-conciliacao-bancaria DEVE possuir class="tab-pane hidden"');
    assert(html.includes('id="tab-analise-credito" class="tab-pane hidden"'), 'tab-analise-credito DEVE possuir class="tab-pane hidden"');
    assert(html.includes('id="tab-bi-indices" class="tab-pane hidden"'), 'tab-bi-indices DEVE possuir class="tab-pane hidden"');
    assert(html.includes('id="tab-bi-metabase" class="tab-pane hidden"'), 'tab-bi-metabase DEVE possuir class="tab-pane hidden"');
  });

  await test('Frontend JS: Links do Pipedrive utilizam URL oficial https://benetroncomercial.pipedrive.com/deal/', async () => {
    const js = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
    assert(js.includes('https://benetroncomercial.pipedrive.com/deal/'), 'Link do Pipedrive deve apontar para https://benetroncomercial.pipedrive.com/deal/');
    assert(!js.includes('app.pipedrive.com/deals?selected_deal_id'), 'Links legados app.pipedrive.com devem ser extintos');
  });

  // TESTES DE FUNÇÕES DE BANCO T-SQL (PROTHEUS_DB)
  await test('Protheus T-SQL: buscarPedidosProntosFaturar na OACO (16) retorna apenas pedido 000221', async () => {
    const pedidos = await buscarPedidosProntosFaturar({ empresa: 'OACO' });
    assert(Array.isArray(pedidos), 'Deveria retornar um array');
    
    // Verifica se 000221 está presente
    const ped221 = pedidos.find(p => p.numPed === '000221');
    assert(ped221, 'Pedido 000221 deveria estar presente na lista de prontos para faturar');
    assert.strictEqual(ped221.empresa, 'OACO');
    assert(ped221.totalValor > 0, 'Valor do pedido 000221 deve ser maior que zero');

    // Verifica que os pedidos bloqueados por estoque NÃO estão em prontos para faturar
    const blockedOrders = ['000723', '000729', '000736', '000754', '000755', '000762', '000763', '000764'];
    for (const bNum of blockedOrders) {
      const found = pedidos.find(p => p.numPed === bNum);
      assert(!found, `Pedido bloqueado ${bNum} NÃO deveria estar na lista de prontos para faturar`);
    }
  });

  await test('Protheus T-SQL: buscarPedidosBloqueadosEstoque na OACO (16) retorna os 8 pedidos bloqueados', async () => {
    const pedidos = await buscarPedidosBloqueadosEstoque({ empresa: 'OACO' });
    assert(Array.isArray(pedidos), 'Deveria retornar um array');
    
    // Verifica se os 8 pedidos estão listados
    const blockedOrders = ['000723', '000729', '000736', '000754', '000755', '000762', '000763', '000764'];
    for (const bNum of blockedOrders) {
      const found = pedidos.find(p => p.numPed === bNum);
      assert(found, `Pedido bloqueado por estoque ${bNum} deveria estar presente`);
      assert.strictEqual(found.codBlEst, '02');
    }

    // Verifica que o pedido liberado 000221 NÃO está na lista de bloqueados
    const ped221 = pedidos.find(p => p.numPed === '000221');
    assert(!ped221, 'Pedido 000221 NÃO deveria estar na lista de bloqueados por estoque');
  });

  await test('Protheus T-SQL: Multi-empresa retorna dados estruturados com totais corretos', async () => {
    const faturar = await buscarPedidosProntosFaturar();
    assert(Array.isArray(faturar), 'Deveria retornar lista de faturar');
    assert(faturar.length >= 1, 'Deveria conter ao menos 1 pedido');
    for (const p of faturar) {
      assert(p.numPed, 'Pedido deve ter numPed');
      assert(p.empresa, 'Pedido deve ter empresa');
      assert(p.totalQtd >= 1, 'Total de peças deve ser >= 1');
      assert(typeof p.totalValor === 'number', 'Valor deve ser numérico');
      assert(Array.isArray(p.itens) && p.itens.length > 0, 'Itens deve ser um array preenchido');
    }

    const bloq = await buscarPedidosBloqueadosEstoque();
    assert(Array.isArray(bloq), 'Deveria retornar lista de bloqueados');
    assert(bloq.length >= 8, 'Deveria conter ao menos os 8 pedidos de OACO');
  });

  // TESTES DE ENDPOINTS REST HTTP
  // Inicia servidor de teste
  try {
    delete require.cache[require.resolve('./server')];
    app = require('./server');
    await new Promise((resolve) => {
      server = app.listen(PORT, '127.0.0.1', () => {
        resolve();
      });
    });
  } catch (e) {
    console.warn('Servidor já em execução ou porta ocupada, usando existente...');
  }

  const validToken = jwt.sign(
    { username: 'alexandre', name: 'Alexandre Admin', role: 'admin', permissions: ['logistica'] },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  await test('API HTTP: GET /api/logistica/pedidos-faturar exige autenticação JWT (401 sem token)', async () => {
    const res = await makeRequest('/api/logistica/pedidos-faturar');
    assert.strictEqual(res.status, 401, 'Deveria retornar status 401 para requisição sem token');
  });

  await test('API HTTP: GET /api/logistica/pedidos-bloq-estoque exige autenticação JWT (401 sem token)', async () => {
    const res = await makeRequest('/api/logistica/pedidos-bloq-estoque');
    assert.strictEqual(res.status, 401, 'Deveria retornar status 401 para requisição sem token');
  });

  await test('API HTTP: GET /api/logistica/pedidos-faturar retorna 200 com token JWT e dados filtrados', async () => {
    const res = await makeRequest('/api/logistica/pedidos-faturar?empresa=OACO', {
      'Authorization': `Bearer ${validToken}`
    });
    assert.strictEqual(res.status, 200, 'Deveria retornar status 200');
    assert.strictEqual(res.data.success, true);
    assert(Array.isArray(res.data.data));
    const ped221 = res.data.data.find(p => p.numPed === '000221');
    assert(ped221, 'Pedido 000221 deve estar no payload');
  });

  await test('API HTTP: GET /api/logistica/pedidos-bloq-estoque retorna 200 com token JWT e 8 pedidos em OACO', async () => {
    const res = await makeRequest('/api/logistica/pedidos-bloq-estoque?empresa=OACO', {
      'Authorization': `Bearer ${validToken}`
    });
    assert.strictEqual(res.status, 200, 'Deveria retornar status 200');
    assert.strictEqual(res.data.success, true);
    assert(Array.isArray(res.data.data));
    assert.strictEqual(res.data.data.length, 8, 'Deveria retornar exatamente 8 pedidos bloqueados em OACO');
  });

  // Finalização do servidor de teste
  if (server && server.close) {
    server.close();
  }

  console.log(`\n📊 Relatório de Testes Automatizados:`);
  console.log(`   Total de Testes: ${passed + failed}`);
  console.log(`   Passaram: ${passed}`);
  console.log(`   Falharam: ${failed}`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Erro fatal nos testes:', err);
  if (server && server.close) server.close();
  process.exit(1);
});
