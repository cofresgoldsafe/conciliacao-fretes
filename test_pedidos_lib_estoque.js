const assert = require('assert');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const http = require('http');

// Configuração do ambiente de teste
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key-123456';

const CLI_DIR = 'C:/Users/Alexandre/Documents/Gemini-Cli';

const { 
  buscarPedidosAnaliseLibEstoque,
  buscarPedidosBloqueadosEstoque,
  buscarPedidosProntosFaturar
} = require(path.join(CLI_DIR, 'protheus_db'));

let server;
let app;
const PORT = 3098;

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
  console.log('🚀 Iniciando Suíte de Testes Automatizados: Logística - Fila & Liberação de Estoque (MATA455 / MATA456)\n');
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

  // 1. TESTES DE ESTRUTURA HTML / DOM
  await test('HTML: subGroupLogistica possui as 5 sub-abas na ordem correta', async () => {
    const html = fs.readFileSync(path.join(CLI_DIR, 'public', 'index.html'), 'utf8');
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

  await test('HTML: Painel tab-pedidos-lib-estoque e Modal modalLibEstoqueItens existem com seus elementos', async () => {
    const html = fs.readFileSync(path.join(CLI_DIR, 'public', 'index.html'), 'utf8');
    assert(html.includes('id="tab-pedidos-lib-estoque"'), 'Painel tab-pedidos-lib-estoque não encontrado');
    assert(html.includes('id="kpiLibProntosCount"'), 'KPI kpiLibProntosCount não encontrado');
    assert(html.includes('id="kpiLibParcialCount"'), 'KPI kpiLibParcialCount não encontrado');
    assert(html.includes('id="kpiLibAguardandoCount"'), 'KPI kpiLibAguardandoCount não encontrado');
    assert(html.includes('id="kpiLibTotalCount"'), 'KPI kpiLibTotalCount não encontrado');
    assert(html.includes('id="pedidosLibTableBody"'), 'TBody pedidosLibTableBody não encontrado');
    assert(html.includes('id="modalLibEstoqueItens"'), 'Modal modalLibEstoqueItens não encontrado');
    assert(html.includes('id="tbodyModalLibEstoqueItens"'), 'TBody tbodyModalLibEstoqueItens não encontrado');
  });

  await test('Frontend JS: Rotas de tab-pedidos-lib-estoque presentes no app.js', async () => {
    const js = fs.readFileSync(path.join(CLI_DIR, 'public', 'app.js'), 'utf8');
    assert(js.includes('carregarPedidosLibEstoque'), 'Função carregarPedidosLibEstoque deve existir no app.js');
    assert(js.includes('renderPedidosLibEstoqueTable'), 'Função renderPedidosLibEstoqueTable deve existir no app.js');
    assert(js.includes('abrirModalLibEstoqueDetalhes'), 'Função abrirModalLibEstoqueDetalhes deve existir no app.js');
    assert(js.includes('/api/logistica/pedidos-lib-estoque'), 'Chamada da API de liberação de estoque deve existir');
  });

  // 2. TESTES DE REGRAS DE NEGÓCIO E ALGORITMO FIFO (PROTHEUS_DB)
  await test('Protheus T-SQL & FIFO: buscarPedidosAnaliseLibEstoque retorna lista estruturada com itens alocados', async () => {
    const pedidos = await buscarPedidosAnaliseLibEstoque();
    assert(Array.isArray(pedidos), 'Deveria retornar um array');
    assert(pedidos.length >= 1, 'Deveria conter ao menos 1 pedido analisado');

    for (const p of pedidos) {
      assert(p.numPed, 'Pedido deve conter numPed');
      assert(p.empresa, 'Pedido deve conter empresa');
      assert(['PRONTO', 'PARCIAL', 'AGUARDANDO'].includes(p.statusLib), `Status de liberação inválido: ${p.statusLib}`);
      assert(p.statusBadge, 'Pedido deve conter statusBadge');
      assert(p.rotinaProtheus, 'Pedido deve sugerir rotina do Protheus');
      assert(Array.isArray(p.itens) && p.itens.length > 0, 'Pedido deve conter array de itens');

      for (const it of p.itens) {
        assert(it.produto, 'Item deve ter código do produto');
        assert(typeof it.qtdLib === 'number' && it.qtdLib > 0, 'qtdLib deve ser número > 0');
        assert(typeof it.qtdAlocada === 'number' && it.qtdAlocada >= 0, 'qtdAlocada deve ser número >= 0');
        assert(typeof it.saldoFisicoTotal === 'number' && it.saldoFisicoTotal >= 0, 'saldoFisicoTotal deve ser número >= 0');
        assert(typeof it.posicaoFila === 'number' && it.posicaoFila >= 1, 'posicaoFila deve ser >= 1');
        assert(['TOTAL', 'PARCIAL', 'SEM_SALDO'].includes(it.statusItem), `statusItem inválido: ${it.statusItem}`);
      }
    }
  });

  await test('Protheus FIFO: Pedido 000346 da Metal Pleno (14) classificado como PRONTO (100% Saldo Disponível)', async () => {
    const pedidos = await buscarPedidosAnaliseLibEstoque({ empresa: 'MP' });
    const ped346 = pedidos.find(p => p.numPed === '000346');
    assert(ped346, 'Pedido 000346 da Metal Pleno deveria estar presente');
    assert.strictEqual(ped346.statusLib, 'PRONTO', 'Pedido 000346 deve estar PRONTO pois possui saldo 11 em SB2');
    assert.strictEqual(ped346.itens[0].statusItem, 'TOTAL', 'Item do pedido 000346 deve estar TOTAL');
    assert.strictEqual(ped346.itens[0].qtdAlocada, 1, 'Qtd alocada deve ser 1');
  });

  await test('Protheus FIFO: Pedido 000763 da OACO (16) classificado como PARCIAL (Saldo 6 vs Qtd 11)', async () => {
    const pedidos = await buscarPedidosAnaliseLibEstoque({ empresa: 'OACO' });
    const ped763 = pedidos.find(p => p.numPed === '000763');
    assert(ped763, 'Pedido 000763 da OACO deveria estar presente');
    assert.strictEqual(ped763.statusLib, 'PARCIAL', 'Pedido 000763 deve estar PARCIAL pois possui saldo 6 para demanda de 11');
    assert.strictEqual(ped763.itens[0].statusItem, 'PARCIAL', 'Item do pedido 000763 deve estar PARCIAL');
    assert.strictEqual(ped763.itens[0].qtdAlocada, 6, 'Qtd alocada deve ser 6');
    assert.strictEqual(ped763.itens[0].saldoFaltante, 5, 'Saldo faltante deve ser 5');
  });

  await test('Protheus FIFO: Fila de prioridade respeita Data Lib mais antiga (Produto 00101010102B009 na OACO)', async () => {
    const pedidos = await buscarPedidosAnaliseLibEstoque({ empresa: 'OACO' });
    const pedidosComProduto = pedidos.filter(p => p.itens.some(i => i.produto === '00101010102B009'));
    
    assert(pedidosComProduto.length >= 4, 'Deveriam existir 4 pedidos com o produto 00101010102B009');
    
    // Obter itens correspondentes a esse produto
    const itens = pedidosComProduto.map(p => {
      const it = p.itens.find(i => i.produto === '00101010102B009');
      return { numPed: p.numPed, dataLib: p.dataLib, posicaoFila: it.posicaoFila };
    }).sort((a, b) => a.posicaoFila - b.posicaoFila);

    assert.strictEqual(itens[0].numPed, '000723', 'Posição #1 na fila deve ser o pedido 000723 (Data 12/08)');
    assert.strictEqual(itens[1].numPed, '000729', 'Posição #2 na fila deve ser o pedido 000729 (Data 14/08)');
    assert.strictEqual(itens[2].numPed, '000736', 'Posição #3 na fila deve ser o pedido 000736 (Data 18/08)');
    assert.strictEqual(itens[3].numPed, '000764', 'Posição #4 na fila deve ser o pedido 000764 (Data 27/08)');
  });

  // 3. TESTES DE INTEGRAÇÃO DE API REST HTTP
  await test('API HTTP: Inicia servidor express e testa endpoint /api/logistica/pedidos-lib-estoque', async () => {
    delete require.cache[require.resolve(path.join(CLI_DIR, 'server'))];
    app = require(path.join(CLI_DIR, 'server'));
    await new Promise((resolve) => {
      server = app.listen(PORT, resolve);
    });

    // 1. Requisição sem token (deve retornar 401)
    const resNoAuth = await makeRequest('/api/logistica/pedidos-lib-estoque');
    assert.strictEqual(resNoAuth.status, 401, 'Requisição não autenticada deve retornar 401');

    // 2. Requisição com token JWT válido
    const token = jwt.sign(
      { username: 'admin', name: 'Administrador', role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    const resAuth = await makeRequest('/api/logistica/pedidos-lib-estoque', {
      'Authorization': `Bearer ${token}`
    });

    assert.strictEqual(resAuth.status, 200, 'Requisição autenticada deve retornar 200');
    assert(resAuth.data.success === true, 'Resposta deve conter success: true');
    assert(typeof resAuth.data.count === 'number', 'Resposta deve conter count');
    assert(Array.isArray(resAuth.data.data), 'Resposta deve conter array data');
    assert(resAuth.data.data.length >= 1, 'Array data deve conter pedidos');

    // 3. Requisição com filtro de empresa
    const resOaco = await makeRequest('/api/logistica/pedidos-lib-estoque?empresa=OACO', {
      'Authorization': `Bearer ${token}`
    });
    assert.strictEqual(resOaco.status, 200);
    assert(resOaco.data.data.every(p => p.empresa === 'OACO'), 'Todos os pedidos devem ser da OACO');
  });

  if (server) {
    await new Promise(resolve => server.close(resolve));
  }

  console.log(`\n========================================`);
  console.log(`Resumo dos Testes: ${passed} PASSADOS | ${failed} FALHAS`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Erro fatal nos testes:', err);
  process.exit(1);
});
