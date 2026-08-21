const assert = require('assert');
const { syncVippFtp, getVippIndex, getPostingByEtiqueta, getFtpStatus, enrichCorreiosItems } = require('./vipp_ftp');
const { consultarProtheusNF } = require('./protheus_db');

async function runTests() {
  console.log('====================================================');
  console.log('🚀 INICIANDO TESTES AUTOMATIZADOS: FTP VIPP & CORREIOS');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] ${name}`);
      console.error(`   Erro: ${err.message}\n`);
    }
  }

  // Teste 1: Sincronização e Leitura do Cache FTP ViPP
  await test('Sincronização FTP ViPP / Cache de CSVs', async () => {
    const syncRes = await syncVippFtp(false); // utiliza cache ou download
    assert.strictEqual(syncRes.success, true, 'Sincronização deve ter sucesso');
    assert.ok(syncRes.totalPostagens > 0, 'Deve conter postagens indexadas');
    assert.ok(syncRes.files.length > 0, 'Deve conter arquivos CSV no cache');
  });

  // Teste 2: Status do FTP
  await test('Verificação do status do FTP ViPP', async () => {
    const status = getFtpStatus();
    assert.ok(status.status === 'synced' || status.status === 'cache_only', 'Status deve ser synced ou cache_only');
    assert.ok(status.filesCount > 0, 'Deve listar arquivos');
  });

  // Teste 3: Classificação de Ordem de Serviço (OS)
  await test('Classificação de postagem com OS (ex: AP348755922BR -> OS 1323)', async () => {
    const posting = getPostingByEtiqueta('AP348755922BR');
    assert.ok(posting, 'Postagem AP348755922BR deve existir no índice');
    assert.strictEqual(posting.tipoDoc, 'OS', 'Tipo deve ser classificado como OS');
    assert.strictEqual(posting.osNum, '1323', 'Número da OS deve ser 1323');
    assert.strictEqual(posting.identificador, 'OS 1323', 'Identificador deve ser OS 1323');
  });

  // Teste 4: Classificação de Nota Fiscal (NF)
  await test('Classificação de postagem com NF (ex: AD814817842BR -> NF 664)', async () => {
    const posting = getPostingByEtiqueta('AD814817842BR');
    assert.ok(posting, 'Postagem AD814817842BR deve existir no índice');
    assert.strictEqual(posting.tipoDoc, 'NF', 'Tipo deve ser classificado como NF');
    assert.strictEqual(posting.nfNum, '664', 'Número da NF deve ser 664');
  });

  // Teste 5: Enriquecimento de itens Correios (OS, NF e Sem Info)
  await test('Enriquecimento de itens da fatura Correios com Protheus e regras OS/NF/Sem Info', async () => {
    const mockCorreiosItems = [
      { id: 1, etiqueta: 'AP348755922BR', valorCobrado: 60.45, docOriginario: '' }, // OS 1323
      { id: 2, etiqueta: 'AD814817842BR', valorCobrado: 73.18, docOriginario: '' }, // NF 664
      { id: 3, etiqueta: 'XX999999999BR', valorCobrado: 45.00, docOriginario: '' }  // Inexistente no ViPP
    ];

    const enriched = await enrichCorreiosItems(mockCorreiosItems, 'OACO');

    // Item 1 (OS)
    assert.strictEqual(enriched[0].tipoDoc, 'OS', 'Item 1 deve ser OS');
    assert.strictEqual(enriched[0].pedVenda, 'N/A (OS)', 'Item 1 deve ter pedVenda N/A (OS)');
    assert.strictEqual(enriched[0].freteCobradoProtheus, 0.00, 'Item 1 não deve ter cobrança de frete');
    assert.strictEqual(enriched[0].status, 'OS Identificada', 'Status do Item 1 deve ser OS Identificada');

    // Item 2 (NF 664)
    assert.strictEqual(enriched[1].tipoDoc, 'NF', 'Item 2 deve ser NF');
    assert.strictEqual(enriched[1].docOriginario, '664', 'Doc originário deve ser 664');
    assert.strictEqual(enriched[1].protheusEncontrado, true, 'NF 664 deve ser encontrada no Protheus');
    assert.strictEqual(enriched[1].pedVenda, '000734', 'Pedido de venda da NF 664 deve ser 000734');
    assert.strictEqual(enriched[1].freteCobradoProtheus, 128.00, 'Frete cobrado no Protheus deve ser R$ 128,00');

    // Item 3 (Sem Info)
    assert.strictEqual(enriched[2].tipoDoc, 'SEM_INFO', 'Item 3 deve ser SEM_INFO');
    assert.strictEqual(enriched[2].docOriginario, 'Sem Info', 'Doc originário deve ser Sem Info');
    assert.strictEqual(enriched[2].pedVenda, 'Sem Info', 'Ped Venda deve ser Sem Info');
    assert.strictEqual(enriched[2].protheusEncontrado, false, 'Não deve constar como encontrado');
  });

  // Teste 6: Consulta no Protheus por Pedido de Venda direto (ex: 000734 ou 734)
  await test('Consulta no Protheus por Pedido de Venda direto (busca reversa)', async () => {
    const res = await consultarProtheusNF('000734', 'OACO');
    assert.strictEqual(res.encontrado, true, 'Pedido 000734 deve ser localizado');
    assert.strictEqual(res.pedVenda, '000734', 'pedVenda deve ser 000734');
    assert.strictEqual(res.freteCobrado, 128.00, 'Frete cobrado deve ser R$ 128,00');
  });

  console.log('\n====================================================');
  console.log(`📊 RESULTADO DOS TESTES: ${passed}/${total} APROVADOS (${Math.round((passed/total)*100)}%)`);
  console.log('====================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Falha geral na execução dos testes:', err);
  process.exit(1);
});
