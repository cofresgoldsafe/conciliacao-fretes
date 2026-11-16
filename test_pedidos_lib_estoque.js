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

  await test('Protheus FIFO: Valida que pedidos PRONTO possuem 100% de saldo alocado', async () => {
    const pedidos = await buscarPedidosAnaliseLibEstoque();
    const prontos = pedidos.filter(p => p.statusLib === 'PRONTO');
    assert(prontos.length >= 1, 'Deveria existir ao menos 1 pedido PRONTO para liberação');
    for (const ped of prontos) {
      for (const it of ped.itens) {
        assert.strictEqual(it.statusItem, 'TOTAL', `Item ${it.produto} do pedido ${ped.numPed} deveria ser TOTAL`);
        assert.strictEqual(it.qtdAlocada, it.qtdLib, `Qtd alocada deve ser igual à qtd liberada`);
      }
    }
  });

  await test('Protheus FIFO: Valida pedidos PARCIAL e AGUARDANDO respeitando alocação do saldo SB2', async () => {
    const pedidos = await buscarPedidosAnaliseLibEstoque();
    const parciais = pedidos.filter(p => p.statusLib === 'PARCIAL');
    for (const ped of parciais) {
      assert(ped.itens.some(i => i.statusItem === 'PARCIAL' || i.statusItem === 'TOTAL'), 'Pedido PARCIAL deve ter ao menos um item com saldo');
      assert(ped.itens.some(i => i.saldoFaltante > 0), 'Pedido PARCIAL deve ter ao menos um item com falta');
    }
    const aguardando = pedidos.filter(p => p.statusLib === 'AGUARDANDO');
    for (const ped of aguardando) {
      for (const it of ped.itens) {
        assert.strictEqual(it.qtdAlocada, 0, `Pedido AGUARDANDO ${ped.numPed} não deve ter saldo alocado`);
      }
    }
  });

  await test('Protheus FIFO: Fila de prioridade respeita ordem FIFO por DataLib crescente por produto dentro de cada empresa', async () => {
    const pedidos = await buscarPedidosAnaliseLibEstoque();
    // Mapear produtos que aparecem em mais de um pedido por empresa
    const prodCounts = {};
    for (const p of pedidos) {
      for (const it of p.itens) {
        const key = `${p.empresa}_${it.produto}`;
        if (!prodCounts[key]) prodCounts[key] = [];
        prodCounts[key].push({ numPed: p.numPed, dataLib: p.dataLib, posicaoFila: it.posicaoFila });
      }
    }

    for (const [key, list] of Object.entries(prodCounts)) {
      if (list.length > 1) {
        // Ordena por posicaoFila e confere que dataLib é não-decrescente
        list.sort((a, b) => a.posicaoFila - b.posicaoFila);
        for (let i = 0; i < list.length - 1; i++) {
          assert(list[i].posicaoFila < list[i + 1].posicaoFila, `Posição de fila para ${key} deve ser crescente`);
          assert(list[i].dataLib <= list[i + 1].dataLib, `DataLib para ${key} deve respeitar ordem FIFO`);
        }
      }
    }
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
