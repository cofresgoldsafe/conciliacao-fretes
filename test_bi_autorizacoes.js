/**
 * test_bi_autorizacoes.js
 * Suíte de Testes Automatizados para a Sub-Aba 'Autorizações' no BI Executivo
 * Validação de Cálculos Financeiros, Formatação de Notas Pipedrive, DDL/DB e Integridade Frontend
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const {
  extrairDealId,
  extrairCodigoProtheus,
  calcularMargemEDesconto,
  formatarNotaPipedrive,
  COND_PGTO_KEY,
  FRETE_EMBUTIDO_KEY
} = require('./bi_autorizacoes_engine');

const {
  saveAutorizacaoDescontoDB,
  getAutorizacoesDescontoDB
} = require('./postgres_db');

console.log('🧪 [TESTES] Iniciando Suíte de Testes de Autorização de Desconto (BI Executivo)...\n');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
  }
}

(async () => {
  // 1. Testes de Extração de ID de Deal
  runTest('1.1 extrairDealId - número puro', () => {
    assert.strictEqual(extrairDealId(25238), 25238);
    assert.strictEqual(extrairDealId('25238'), 25238);
  });

  runTest('1.2 extrairDealId - URL do Pipedrive simples e complexas', () => {
    assert.strictEqual(extrairDealId('https://benetroncomercial.pipedrive.com/deal/25238'), 25238);
    assert.strictEqual(extrairDealId('https://app.pipedrive.com/deal/19039#details'), 19039);
    assert.strictEqual(extrairDealId('https://benetroncomercial.pipedrive.com/deal/25238?user_id=4&page=1'), 25238, 'Deve ignorar query params como user_id=4');
    assert.strictEqual(extrairDealId('https://benetroncomercial.pipedrive.com/deal/25238#activity-102'), 25238, 'Deve ignorar fragmentos de hash com números');
  });

  runTest('1.3 extrairDealId - texto com deal', () => {
    assert.strictEqual(extrairDealId('Deal #24827'), 24827);
    assert.strictEqual(extrairDealId('deal 19039'), 19039);
    assert.strictEqual(extrairDealId(''), null);
    assert.strictEqual(extrairDealId(null), null);
  });

  // 2. Testes de Extração de Código Protheus
  runTest('2.1 extrairCodigoProtheus - descarta prefixo e hífen', () => {
    assert.strictEqual(extrairCodigoProtheus('15-01801080802B001'), '01801080802B001');
    assert.strictEqual(extrairCodigoProtheus('14-00101010101B060'), '00101010101B060');
    assert.strictEqual(extrairCodigoProtheus('16-00101990000B001'), '00101990000B001');
  });

  runTest('2.2 extrairCodigoProtheus - código sem hífen', () => {
    assert.strictEqual(extrairCodigoProtheus('01801080802B001'), '01801080802B001');
    assert.strictEqual(extrairCodigoProtheus('  00101010101B060  '), '00101010101B060');
    assert.strictEqual(extrairCodigoProtheus(''), '');
  });

  // 3. Testes dos Casos Numéricos de Referência do Manual Técnico (Seção 7.7)
  runTest('3.1 Cálculo Oficial: Deal 19039 (Vendido=87, Frete=30, Tabela=99, Custo=5.67)', () => {
    const res = calcularMargemEDesconto({
      valorVendaTotal: 87,
      freteEmbutido: 30,
      precoTabelaTotal: 99,
      custoTotal: 5.67
    });
    assert.strictEqual(res.valorLiquido, 57.00, 'Valor líquido deve ser 87 - 30 = 57');
    assert.strictEqual(res.descontoPct, 42.42, 'Desconto % deve ser 42.42%');
    assert.strictEqual(res.lucroBruto, 51.33, 'Lucro bruto deve ser 87 - 30 - 5.67 = 51.33');
    assert.strictEqual(res.margemPct, 59.00, 'Margem % deve ser 59.00%');
  });

  runTest('3.2 Cálculo Oficial: Deal 24827 (Vendido=87, Frete=35, Tabela=99, Custo=5.67)', () => {
    const res = calcularMargemEDesconto({
      valorVendaTotal: 87,
      freteEmbutido: 35,
      precoTabelaTotal: 99,
      custoTotal: 5.67
    });
    assert.strictEqual(res.valorLiquido, 52.00, 'Valor líquido deve ser 87 - 35 = 52');
    assert.strictEqual(res.descontoPct, 47.47, 'Desconto % deve ser 47.47%');
    assert.strictEqual(res.lucroBruto, 46.33, 'Lucro bruto deve ser 46.33');
    assert.strictEqual(res.margemPct, 53.25, 'Margem % deve ser 53.25%');
  });

  runTest('3.3 Cálculo Oficial: Deal 23193 (Vendido=87, Frete=40, Tabela=99, Custo=5.67)', () => {
    const res = calcularMargemEDesconto({
      valorVendaTotal: 87,
      freteEmbutido: 40,
      precoTabelaTotal: 99,
      custoTotal: 5.67
    });
    assert.strictEqual(res.valorLiquido, 47.00, 'Valor líquido deve ser 87 - 40 = 47');
    assert.strictEqual(res.descontoPct, 52.53, 'Desconto % deve ser 52.53%');
    assert.strictEqual(res.lucroBruto, 41.33, 'Lucro bruto deve ser 41.33');
    assert.ok(Math.abs(res.margemPct - 47.51) <= 0.01, `Margem % deve ser 47.51% (obtido: ${res.margemPct}%)`);
  });

  runTest('3.4 Regra do Frete Embutido (Frete zero vs Frete positivo)', () => {
    const resZero = calcularMargemEDesconto({
      valorVendaTotal: 1000,
      freteEmbutido: 0,
      precoTabelaTotal: 1000,
      custoTotal: 400
    });
    assert.strictEqual(resZero.descontoPct, 0.00);
    assert.strictEqual(resZero.margemPct, 60.00);

    const resComFrete = calcularMargemEDesconto({
      valorVendaTotal: 1000,
      freteEmbutido: 100,
      precoTabelaTotal: 1000,
      custoTotal: 400
    });
    assert.strictEqual(resComFrete.valorLiquido, 900.00);
    assert.strictEqual(resComFrete.descontoPct, 10.00);
    assert.strictEqual(resComFrete.margemPct, 50.00);
  });

  // 4. Testes de Formatação da Nota Pipedrive (Seção 9)
  runTest('4.1 formatarNotaPipedrive - AUTORIZADO', () => {
    const nota = formatarNotaPipedrive({
      dealId: 25238,
      descontoPct: 6.00,
      condPgtoLabel: '074-1X DEPTEDDOC 10D',
      freteEmbutido: 0.00,
      autorizado: true
    });
    assert.strictEqual(
      nota,
      'Deal 25238 | Desconto Medio Ponderado do Pedido: 6,00% | Forma de Pagamento: 074-1X DEPTEDDOC 10D | Frete Embutido: R$ 0,00 | (ok autorizado)'
    );
  });

  runTest('4.2 formatarNotaPipedrive - NÃO AUTORIZADO', () => {
    const nota = formatarNotaPipedrive({
      dealId: 25238,
      descontoPct: 15.50,
      condPgtoLabel: '015-APPMAX',
      freteEmbutido: 120.00,
      autorizado: false
    });
    assert.strictEqual(
      nota,
      'Deal 25238 | Desconto Medio Ponderado do Pedido: 15,50% | Forma de Pagamento: 015-APPMAX | Frete Embutido: R$ 120,00 | (NAO AUTORIZADO)'
    );
  });

  // 5. Testes de Hashes Oficiais Pipedrive
  runTest('5.1 Hashes de campos customizados Pipedrive', () => {
    assert.strictEqual(COND_PGTO_KEY, 'bdbc4635c15ed6d0add5748159b3a0b1f1b4b5a7');
    assert.strictEqual(FRETE_EMBUTIDO_KEY, 'cd279b000a096a971341df192fba61a673ed87d2');
  });

  // 6. Testes de Persistência e Paginação Envelope no Banco / Fallback
  await runAsyncTest('6.1 saveAutorizacaoDescontoDB e getAutorizacoesDescontoDB', async () => {
    const mockRecord = {
      dealId: 99999,
      solicitanteNome: 'Vendedor Teste',
      clienteNome: 'Cliente Teste Ltda',
      valorTotal: 5000.00,
      precoUnitarioAutorizado: 250.00,
      margemPct: 45.50,
      lucroBruto: 2275.00,
      descontoPct: 8.50,
      descontoReais: 425.00,
      condPgtoLabel: '015-APPMAX',
      tipoFrete: 'CIF',
      freteEmbutido: 150.00,
      status: 'AUTORIZADO',
      usuarioDecisor: 'alexandre',
      usuarioDecisorNome: 'Alexandre',
      observacoes: 'Desconto aprovado para teste unitário',
      notaPipedrive: 'Deal 99999 | ... | (ok autorizado)'
    };

    const saved = await saveAutorizacaoDescontoDB(mockRecord);
    assert.ok(saved, 'Deve salvar registro');
    assert.strictEqual(saved.deal_id, 99999);
    assert.strictEqual(saved.status, 'AUTORIZADO');

    const result = await getAutorizacoesDescontoDB({ page: 1, limit: 50, deal_id: 99999 });
    assert.ok(result, 'Deve retornar envelope de paginação');
    assert.ok(Array.isArray(result.items), 'items deve ser um array');
    assert.ok(result.pagination, 'deve conter objeto pagination');
    assert.strictEqual(result.pagination.limit, 50, 'limite padrão deve ser 50');
    assert.ok(result.items.some(x => x.deal_id === 99999), 'deve conter o deal recém gravado');
  });

  // 7. Testes de Integridade DOM / HTML
  runTest('7.1 public/index.html - Estrutura DOM da sub-aba e modal', () => {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf-8');
    assert.ok(html.includes('id="btnTabBiAutorizacoes"'), 'Deve conter botão #btnTabBiAutorizacoes');
    assert.ok(html.includes('id="tab-bi-autorizacoes"'), 'Deve conter pane #tab-bi-autorizacoes');
    assert.ok(html.includes('id="formBiAutorizacaoAnalise"'), 'Deve conter formulário #formBiAutorizacaoAnalise');
    assert.ok(html.includes('id="modalBiAutorizacaoDetalhes"'), 'Deve conter modal #modalBiAutorizacaoDetalhes');
    assert.ok(html.includes('id="btnModalBiAutorizar"'), 'Deve conter botão #btnModalBiAutorizar');
    assert.ok(html.includes('id="btnModalBiNaoAutorizar"'), 'Deve conter botão #btnModalBiNaoAutorizar');
    assert.ok(html.includes('src="js/bi_autorizacoes.js'), 'Deve importar js/bi_autorizacoes.js');
  });

  // 8. Testes de Sintaxe e Integridade dos Arquivos JS
  runTest('8.1 Validação Sintática de public/js/bi_autorizacoes.js', () => {
    const jsContent = fs.readFileSync(path.join(__dirname, 'public', 'js', 'bi_autorizacoes.js'), 'utf-8');
    assert.doesNotThrow(() => {
      new vm.Script(jsContent);
    }, 'public/js/bi_autorizacoes.js não pode conter erros de sintaxe');
  });

  runTest('8.2 Validação Sintática de bi_autorizacoes_engine.js', () => {
    const jsContent = fs.readFileSync(path.join(__dirname, 'bi_autorizacoes_engine.js'), 'utf-8');
    assert.doesNotThrow(() => {
      new vm.Script(jsContent);
    }, 'bi_autorizacoes_engine.js não pode conter erros de sintaxe');
  });

  runTest('8.3 Validação de Roteamento em public/app.js', () => {
    const appJs = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf-8');
    assert.ok(appJs.includes("targetTab === 'tab-bi-autorizacoes'"), 'app.js deve tratar tab-bi-autorizacoes');
    assert.ok(appJs.includes('window.initBIAutorizacoesTab'), 'app.js deve chamar initBIAutorizacoesTab');
  });

  console.log(`\n======================================================`);
  console.log(`📊 RESULTADO DA SUÍTE DE TESTES: ${passedTests}/${totalTests} APROVADOS (${Math.round(passedTests/totalTests*100)}%)`);
  console.log(`======================================================\n`);

  if (passedTests !== totalTests) {
    process.exit(1);
  }
})();
