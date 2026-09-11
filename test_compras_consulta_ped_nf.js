/**
 * test_compras_consulta_ped_nf.js
 * 
 * Suíte de testes automatizados para a funcionalidade "Consulta Ped/NF Compras":
 * 1. Verificação de exportações e funções no protheus_db.js
 * 2. Validação da busca por NFe (retorno estruturado com chave, pedido vinculado, etc.)
 * 3. Validação da busca por Pedido de Compra (retorno com NFe ou status pendente)
 * 4. Validação da busca por Fornecedor e da Trava de Segurança dos 90 dias
 * 5. Validação de rejeições (intervalo > 90 dias, termo < 3 chars, data inicial > final)
 * 6. Validação da consulta completa de detalhes da NFe (SF1 + SD1 + SA2 + SF4 + SE2)
 * 7. Verificação de integridade do DOM em public/index.html (sub-aba, inputs, tabela, modal)
 * 8. Verificação de integridade léxica/sintática via vm.Script (JS frontend e backend)
 * 9. Verificação do registro das rotas da API em server.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const protheusDb = require('./protheus_db');

async function runTests() {
  console.log('🚀 Iniciando Suíte de Testes: Consulta Ped/NF Compras (Harness Fase 4)...\n');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
    }
  }

  async function testAsync(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
    }
  }

  // --- BLOCO 1: Exportações no protheus_db.js ---
  console.log('--- BLOCO 1: Funções no protheus_db.js ---');
  test('Deve exportar buscarConsultaComprasProtheus', () => {
    assert.strictEqual(typeof protheusDb.buscarConsultaComprasProtheus, 'function');
  });

  test('Deve exportar obterDetalhesNFeEntrada', () => {
    assert.strictEqual(typeof protheusDb.obterDetalhesNFeEntrada, 'function');
  });

  // --- BLOCO 2: Regras e Validações de Entrada ---
  console.log('\n--- BLOCO 2: Validações Defensivas e Trava de 90 Dias ---');
  await testAsync('Deve rejeitar busca sem termo', async () => {
    await assert.rejects(
      async () => await protheusDb.buscarConsultaComprasProtheus({ tipo: 'nfe', termo: '' }),
      /Informe um termo de busca/
    );
  });

  await testAsync('Deve rejeitar busca por Fornecedor com menos de 3 caracteres', async () => {
    await assert.rejects(
      async () => await protheusDb.buscarConsultaComprasProtheus({ tipo: 'fornecedor', termo: 'AB', dataIni: '2026-06-15', dataFim: '2026-09-11' }),
      /ao menos 3 caracteres/
    );
  });

  await testAsync('Deve rejeitar busca por Fornecedor sem datas', async () => {
    await assert.rejects(
      async () => await protheusDb.buscarConsultaComprasProtheus({ tipo: 'fornecedor', termo: 'DIVINE' }),
      /as datas de início e fim são obrigatórias/
    );
  });

  await testAsync('Deve rejeitar busca por Fornecedor com data inicial maior que final', async () => {
    await assert.rejects(
      async () => await protheusDb.buscarConsultaComprasProtheus({ tipo: 'fornecedor', termo: 'DIVINE', dataIni: '2026-09-11', dataFim: '2026-06-15' }),
      /data inicial não pode ser maior/
    );
  });

  await testAsync('Deve rejeitar busca por Fornecedor com intervalo superior a 90 dias (Trava de Segurança)', async () => {
    await assert.rejects(
      async () => await protheusDb.buscarConsultaComprasProtheus({ tipo: 'fornecedor', termo: 'DIVINE', dataIni: '2026-01-01', dataFim: '2026-09-11' }),
      /intervalo máximo permitido é de 90 dias/
    );
  });

  await testAsync('Deve rejeitar busca por Código de Fornecedor sem datas', async () => {
    await assert.rejects(
      async () => await protheusDb.buscarConsultaComprasProtheus({ tipo: 'codFornec', termo: '121187' }),
      /as datas de início e fim são obrigatórias/
    );
  });

  await testAsync('Deve rejeitar busca por Código de Fornecedor com intervalo superior a 90 dias', async () => {
    await assert.rejects(
      async () => await protheusDb.buscarConsultaComprasProtheus({ tipo: 'codFornec', termo: '121187', dataIni: '2026-01-01', dataFim: '2026-09-11' }),
      /intervalo máximo permitido é de 90 dias/
    );
  });

  await testAsync('Deve rejeitar busca por Código de Fornecedor com data inicial maior que final', async () => {
    await assert.rejects(
      async () => await protheusDb.buscarConsultaComprasProtheus({ tipo: 'codFornec', termo: '121187', dataIni: '2026-09-11', dataFim: '2026-06-15' }),
      /data inicial não pode ser maior/
    );
  });

  // --- BLOCO 3: Consultas no Protheus DB ---
  console.log('\n--- BLOCO 3: Execução de Consultas Reais no Protheus DB ---');
  await testAsync('Deve consultar NFe de entrada por número (ex: 036057)', async () => {
    const rows = await protheusDb.buscarConsultaComprasProtheus({ tipo: 'nfe', termo: '036057' });
    assert(Array.isArray(rows), 'Deve retornar array de resultados');
    assert(rows.length > 0, 'Deve encontrar a nota 036057');
    const nf = rows[0];
    assert.strictEqual(nf.nfe, '036057');
    assert.strictEqual(nf.empresaKey, 'OACO');
    assert.strictEqual(nf.temNfe, true);
    assert.strictEqual(nf.pedCompra, '000277');
    assert.strictEqual(nf.temPedCompra, true);
    assert(nf.razaoSocial.includes('DIVINE'), 'Deve trazer a razão social do fornecedor');
    assert.strictEqual(nf.valorNf, 39.9);
  });

  await testAsync('Deve consultar por Pedido de Compra (ex: 277)', async () => {
    const rows = await protheusDb.buscarConsultaComprasProtheus({ tipo: 'pedCompra', termo: '277' });
    assert(Array.isArray(rows), 'Deve retornar array');
    assert(rows.length > 0, 'Deve encontrar registros para pedido 277');
    const row = rows[0];
    assert(row.pedCompra.includes('277'), 'Deve conter 277 no pedido');
    assert.strictEqual(row.temPedCompra, true);
  });

  await testAsync('Deve consultar por Fornecedor dentro do limite de 90 dias', async () => {
    const rows = await protheusDb.buscarConsultaComprasProtheus({
      tipo: 'fornecedor',
      termo: 'DIVINE',
      dataIni: '2026-06-15',
      dataFim: '2026-09-11'
    });
    assert(Array.isArray(rows), 'Deve retornar array');
    assert(rows.length > 0, 'Deve encontrar registros do fornecedor DIVINE');
    assert(rows[0].razaoSocial.includes('DIVINE'), 'Razão social deve conter DIVINE');
  });

  await testAsync('Deve consultar por Código de Fornecedor (ex: 121187) dentro do limite de 90 dias', async () => {
    const rows = await protheusDb.buscarConsultaComprasProtheus({
      tipo: 'codFornec',
      termo: '121187',
      dataIni: '2026-06-15',
      dataFim: '2026-09-11'
    });
    assert(Array.isArray(rows), 'Deve retornar array');
    assert(rows.length > 0, 'Deve encontrar registros do código de fornecedor 121187');
    assert(rows.some(r => r.fornece.includes('121187') || r.razaoSocial.includes('DIVINE')), 'Deve conter notas ou pedidos vinculados a 121187');
  });

  await testAsync('Deve obter Detalhes Completos da NFe (SF1 + SD1 + SA2 + SE4 + SE2)', async () => {
    const detalhes = await protheusDb.obterDetalhesNFeEntrada({
      empresaKey: 'OACO',
      doc: '036057',
      serie: '2',
      fornece: '121187',
      loja: '01'
    });

    assert(detalhes !== null, 'Detalhes não podem ser nulos');
    assert.strictEqual(detalhes.empresa, 'OACO');
    
    // Header
    assert.strictEqual(detalhes.header.doc, '036057');
    assert.strictEqual(detalhes.header.serie, '2');
    assert.strictEqual(detalhes.header.chaveNfe, '35260964176824000108550020000360571252058020');
    assert(detalhes.header.fornecedor.includes('DIVINE'), 'Fornecedor deve ser DIVINE');
    assert.strictEqual(detalhes.header.cnpj, '64176824000108');
    assert.strictEqual(detalhes.header.valorBruto, 39.9);
    assert.strictEqual(detalhes.header.condPagto, '013');

    // Itens (SD1)
    assert(Array.isArray(detalhes.itens), 'Itens deve ser array');
    assert(detalhes.itens.length > 0, 'Deve ter ao menos 1 item');
    const item = detalhes.itens[0];
    assert.strictEqual(item.item, '0001');
    assert.strictEqual(item.codigo, '090120B00000419');
    assert(item.descricao.includes('REFLETOR LED'), 'Descrição deve vir da SB1');
    assert.strictEqual(item.pedidoCompra, '000277');
    assert.strictEqual(item.tes, '033');

    // Titulos (SE2)
    assert(Array.isArray(detalhes.titulos), 'Títulos deve ser array');
    assert(detalhes.titulos.length > 0, 'Deve conter parcelas no contas a pagar');
    const tit = detalhes.titulos[0];
    assert.strictEqual(tit.num, '036057');
    assert.strictEqual(tit.valor, 39.9);
    assert.strictEqual(tit.status, 'PAGO');
  });

  // --- BLOCO 4: Integridade do DOM em public/index.html ---
  console.log('\n--- BLOCO 4: Integridade do DOM (public/index.html) ---');
  const indexHtml = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf-8');

  test('HTML deve conter botão da sub-aba btnTabComprasConsultaPedNf em subGroupCompras e btnTabVendConsultaPedNf em subGroupVendedores', () => {
    assert(indexHtml.includes('id="btnTabComprasConsultaPedNf"'), 'Falta id="btnTabComprasConsultaPedNf"');
    assert(indexHtml.includes('id="btnTabVendConsultaPedNf"'), 'Falta id="btnTabVendConsultaPedNf"');
    assert(indexHtml.includes('data-tab="tab-compras-consulta-ped-nf"'), 'Falta data-tab="tab-compras-consulta-ped-nf"');
    assert(indexHtml.includes('Consulta Ped/NF Compras'), 'Falta label do botão');
  });

  test('HTML deve conter painel tab-compras-consulta-ped-nf com formulário de pesquisa completo', () => {
    assert(indexHtml.includes('id="tab-compras-consulta-ped-nf"'), 'Falta id="tab-compras-consulta-ped-nf"');
    assert(indexHtml.includes('id="searchComprasPed"'), 'Falta input do Pedido de Compra');
    assert(indexHtml.includes('id="searchComprasNFe"'), 'Falta input da NFe');
    assert(indexHtml.includes('id="searchComprasCodFornec"'), 'Falta input do Código do Fornecedor');
    assert(indexHtml.includes('id="tagComprasCodFornec"'), 'Falta tag de status do Código do Fornecedor');
    assert(indexHtml.includes('Cód Fornec.'), 'Falta label Cód Fornec.');
    assert(indexHtml.includes('id="searchComprasFornec"'), 'Falta input do Fornecedor');
    assert(indexHtml.includes('id="selectComprasEmpresa"'), 'Falta seletor de empresa');
    assert(indexHtml.includes('id="searchComprasDataIni"'), 'Falta input data inicial');
    assert(indexHtml.includes('id="searchComprasDataFim"'), 'Falta input data final');
    assert(indexHtml.includes('id="btnBuscarConsultaCompras"'), 'Falta botão buscar');
    assert(indexHtml.includes('id="btnLimparConsultaCompras"'), 'Falta botão limpar');
  });

  test('HTML deve conter tabela de resultados e estados de loading/empty', () => {
    assert(indexHtml.includes('id="comprasTableBody"'), 'Falta id="comprasTableBody"');
    assert(indexHtml.includes('id="comprasResultsSection"'), 'Falta id="comprasResultsSection"');
    assert(indexHtml.includes('id="comprasLoading"'), 'Falta id="comprasLoading"');
    assert(indexHtml.includes('id="comprasEmptyState"'), 'Falta id="comprasEmptyState"');
    assert(indexHtml.includes('id="comprasResultsCountBadge"'), 'Falta contador de resultados');
  });

  test('HTML deve conter modal completo modalNFeEntradaDetalhes', () => {
    assert(indexHtml.includes('id="modalNFeEntradaDetalhes"'), 'Falta id="modalNFeEntradaDetalhes"');
    assert(indexHtml.includes('id="modalNFeNum"'), 'Falta id="modalNFeNum"');
    assert(indexHtml.includes('id="modalNFeEntradaBody"'), 'Falta id="modalNFeEntradaBody"');
    assert(indexHtml.includes('id="btnCloseModalNFeEntrada"'), 'Falta botão de fechar X');
    assert(indexHtml.includes('id="btnFecharModalNFeEntrada"'), 'Falta botão fechar rodapé');
  });

  test('HTML deve carregar o script compras_consulta_ped_nf.js', () => {
    assert(indexHtml.includes('src="js/compras_consulta_ped_nf.js?v='), 'Falta tag de inclusão do script');
  });

  // --- BLOCO 5: Integridade de Sintaxe via vm.Script ---
  console.log('\n--- BLOCO 5: Integridade Léxica/Sintática (vm.Script) ---');
  test('public/js/compras_consulta_ped_nf.js deve compilar sem erros e mapear descTipo codFornec', () => {
    const code = fs.readFileSync(path.join(__dirname, 'public', 'js', 'compras_consulta_ped_nf.js'), 'utf-8');
    assert.doesNotThrow(() => {
      new vm.Script(code);
    }, 'Erro léxico ou sintático em compras_consulta_ped_nf.js');
    assert(code.includes("descTipo = 'Cód. Fornecedor'"), 'Falta mapeamento descTipo Cód. Fornecedor');
  });

  test('public/js/vendedores.js deve incluir tab-compras-consulta-ped-nf e compilar', () => {
    const code = fs.readFileSync(path.join(__dirname, 'public', 'js', 'vendedores.js'), 'utf-8');
    assert(code.includes('tab-compras-consulta-ped-nf'), 'Falta tab-compras-consulta-ped-nf em vendedores.js');
  });

  test('public/app.js deve compilar sem erros', () => {
    const code = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf-8');
    assert.doesNotThrow(() => {
      new vm.Script(code);
    }, 'Erro léxico ou sintático em public/app.js');
  });

  test('server.js deve compilar sem erros', () => {
    const code = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf-8');
    assert.doesNotThrow(() => {
      new vm.Script(code);
    }, 'Erro léxico ou sintático em server.js');
  });

  // --- BLOCO 6: Registro de Rotas em server.js ---
  console.log('\n--- BLOCO 6: Rotas da API em server.js ---');
  const serverJs = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf-8');
  test('server.js deve registrar rota /api/compras/consulta-ped-nf com requireAuth', () => {
    assert(serverJs.includes("app.get('/api/compras/consulta-ped-nf', requireAuth"), 'Falta rota /api/compras/consulta-ped-nf');
    assert(serverJs.includes("actionType: 'CONSULTA_COMPRAS_PED_NF'"), 'Falta auditoria da consulta');
  });

  test('server.js deve registrar rota /api/compras/nfe-entrada-detalhes com requireAuth', () => {
    assert(serverJs.includes("app.get('/api/compras/nfe-entrada-detalhes', requireAuth"), 'Falta rota /api/compras/nfe-entrada-detalhes');
    assert(serverJs.includes("actionType: 'CONSULTA_DETALHES_NFE_ENTRADA'"), 'Falta auditoria dos detalhes da NFe');
  });

  // --- RESULTADOS FINAIS ---
  console.log(`\n========================================`);
  console.log(`Resumo dos Testes: ${passed}/${total} aprovados (${Math.round((passed / total) * 100)}%)`);
  console.log(`========================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Falha crítica na execução da suíte:', err);
  process.exit(1);
});
