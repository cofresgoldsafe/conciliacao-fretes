/**
 * test_fechamento_fiscal.js
 * Suíte de Testes Automatizados para a Sub-aba Fechamento Fiscal (Analista Fin)
 * Validação contra REL GERAL OACO AGOSTO 2026.xlsx, exclusão de ROMA, Total Tributado e RBT12
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const {
  consultarFechamentoFiscalProtheus,
  obterHistoricoFaturamento12MesesProtheus,
  formatarDataBrFiscal,
  formatarCgcFiscal
} = require('./protheus_db');

const {
  salvarFechamentoFiscalDB,
  obterFechamentoFiscalDB,
  listarFechamentosFiscaisDB
} = require('./postgres_db');

async function runTests() {
  console.log('🧪 ========================================================');
  console.log('🧪 INICIANDO SUÍTE DE TESTES: FECHAMENTO FISCAL (ANALISTA FIN)');
  console.log('🧪 ========================================================\n');

  let passed = 0;
  let failed = 0;

  function report(name, fn) {
    try {
      fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
      failed++;
    }
  }

  async function reportAsync(name, fn) {
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
      failed++;
    }
  }

  // TESTE 1: Batimento 100% com o Excel de Homologação OACO 08/2026
  await reportAsync('Teste 1: Batimento de Saídas, Tributado e Entradas contra REL GERAL OACO AGOSTO 2026.xlsx', async () => {
    const res = await consultarFechamentoFiscalProtheus({
      empresa: '16',
      dataDe: '2026-08-01',
      dataAte: '2026-08-31',
      criterioDataEntrada: 'EMISSAO'
    });

    assert.ok(res.ok, 'Resposta deve indicar ok: true');
    assert.strictEqual(res.empresa, 'OACO', 'Empresa deve ser OACO');
    assert.strictEqual(res.empresaCodigo, '16', 'Código de empresa deve ser 16');

    // 1.1 Saídas
    assert.strictEqual(res.totais.totalSaidas.qtd, 70, 'Total NFs Saída deve ser exatamente 70');
    assert.strictEqual(res.totais.totalSaidas.valor, 182680.74, 'Valor Total Saídas deve ser R$ 182.680,74');

    // 1.2 Total Tributado
    assert.strictEqual(res.totais.totalTributado.qtd, 70, 'Total Tributado Qtd deve ser 70');
    assert.strictEqual(res.totais.totalTributado.valor, 182680.74, 'Valor Total Tributado deve ser R$ 182.680,74');

    // 1.3 Devoluções e Remessas de Saída em 08/2026
    assert.strictEqual(res.totais.totalDevolucao.qtd, 0, 'Total Devolução Saída deve ser 0');
    assert.strictEqual(res.totais.totalDevolucao.valor, 0, 'Valor Devolução Saída deve ser R$ 0,00');
    assert.strictEqual(res.totais.totalRemessa.qtd, 0, 'Total Remessa Saída deve ser 0');
    assert.strictEqual(res.totais.totalRemessa.valor, 0, 'Valor Remessa Saída deve ser R$ 0,00');

    // 1.4 Entradas (sem ROMA)
    assert.strictEqual(res.totais.totalEntradas.qtd, 60, 'Total NFs Entrada (sem ROMA) deve ser exatamente 60');
    assert.strictEqual(res.totais.totalCtr.qtd, 37, 'Total CTRs deve ser 37');
    assert.strictEqual(res.totais.totalImpostos.qtd, 3, 'Total Impostos (IMP + DAS) deve ser 3');
    assert.strictEqual(res.totais.totalImpostos.valor, 15818.17, 'Valor de Impostos deve ser R$ 15.818,17');
    assert.strictEqual(res.totais.totalNfe.qtd, 10, 'Total NFE deve ser 10');
  });

  // TESTE 2: Exclusão Estrita de Documentos ROMA
  await reportAsync('Teste 2: Verificação de descarte estrito de movimentos ROMA', async () => {
    const res = await consultarFechamentoFiscalProtheus({
      empresa: '16',
      dataDe: '2026-08-01',
      dataAte: '2026-08-31'
    });

    // Garante que nenhum item retornado na listagem possui tipoDoc ROMA
    const itensRoma = res.itens.filter(item => (item.tipoDoc || '').toUpperCase() === 'ROMA');
    assert.strictEqual(itensRoma.length, 0, 'Nenhum documento com tipoDoc ROMA deve constar na listagem');

    // Garante que as 6 notas ROMA foram filtradas
    assert.strictEqual(res.totais.totalEntradas.qtd, 60, 'Total de entradas deve ignorar os 6 romaneios internos');
  });

  // TESTE 3: Regras de Negócio e Classificação Fiscal (Total Tributado e Gera Imposto)
  await reportAsync('Teste 3: Validação dos critérios de incidência fiscal e badges Gera Imposto', async () => {
    const res = await consultarFechamentoFiscalProtheus({
      empresa: '16',
      dataDe: '2026-08-01',
      dataAte: '2026-08-31'
    });

    const saidas = res.itens.filter(i => i.entraSaida === 'SAÍDA');
    const entradas = res.itens.filter(i => i.entraSaida === 'ENTRA');

    assert.strictEqual(saidas.length, 70, 'Deve conter 70 itens de saída');
    assert.strictEqual(entradas.length, 60, 'Deve conter 60 itens de entrada');

    // Todas as 70 saídas em 08/2026 são vendas com duplicata
    saidas.forEach(s => {
      assert.strictEqual(s.geraImposto, 'Sim', `Saída NF ${s.numNf} deve ter geraImposto = 'Sim'`);
      assert.strictEqual(s.tipoOperacao, 'VENDA_TRIBUTADA', `Saída NF ${s.numNf} deve ser VENDA_TRIBUTADA`);
    });

    // Entradas não devem gerar faturamento de saída
    entradas.forEach(e => {
      assert.strictEqual(e.geraImposto, 'Não', `Entrada NF ${e.numNf} deve ter geraImposto = 'Não'`);
    });
  });

  // TESTE 4: Suporte Multiempresa (Metal Pleno 14 e GSI 15)
  await reportAsync('Teste 4: Consulta de Fechamento para Metal Pleno (14) e GSI (15)', async () => {
    // Metal Pleno
    const resMP = await consultarFechamentoFiscalProtheus({
      empresa: '14',
      dataDe: '2026-08-01',
      dataAte: '2026-08-31'
    });
    assert.ok(resMP.ok, 'Consulta Metal Pleno deve retornar ok');
    assert.strictEqual(resMP.empresaCodigo, '14', 'Código MP deve ser 14');
    assert.ok(resMP.totais.totalSaidas.qtd > 0, 'Metal Pleno deve conter saídas em 08/2026');
    assert.ok(resMP.totais.totalEntradas.qtd > 0, 'Metal Pleno deve conter entradas em 08/2026');

    // GSI Brasil
    const resGSI = await consultarFechamentoFiscalProtheus({
      empresa: '15',
      dataDe: '2026-08-01',
      dataAte: '2026-08-31'
    });
    assert.ok(resGSI.ok, 'Consulta GSI deve retornar ok');
    assert.strictEqual(resGSI.empresaCodigo, '15', 'Código GSI deve ser 15');
    assert.ok(typeof resGSI.totais.totalSaidas.valor === 'number', 'Valor saídas GSI deve ser numérico');
    assert.ok(resGSI.totais.totalEntradas.qtd > 0, 'GSI deve conter entradas em 08/2026');
  });

  // TESTE 5: Histórico de Faturamento dos Últimos 12 Meses (RBT12 Fase 2)
  await reportAsync('Teste 5: Apuração dos 12 meses anteriores e RBT12 para OACO', async () => {
    const res12m = await obterHistoricoFaturamento12MesesProtheus({
      empresa: '16',
      anoMesReferencia: '202608'
    });

    assert.ok(res12m.ok, 'Histórico 12m deve retornar ok');
    assert.strictEqual(res12m.historico.length, 12, 'Deve conter exatamente 12 competências consecutivas');
    assert.strictEqual(res12m.periodo12m.de, '202508', 'Início dos 12 meses deve ser 202508');
    assert.strictEqual(res12m.periodo12m.ate, '202607', 'Fim dos 12 meses deve ser 202607');
    assert.ok(res12m.rbt12 > 1000000, `RBT12 acumulada deve ser superior a R$ 1.000.000 (calculado: R$ ${res12m.rbt12})`);
  });

  // TESTE 6: Persistência Relacional / Fallback JSON (Consolidação de Fechamento)
  await reportAsync('Teste 6: Gravação e recuperação de Fechamento Fiscal Consolidado', async () => {
    const dadosMock = {
      empresa: '16',
      anoMes: '202608',
      dataInicio: '2026-08-01',
      dataFim: '2026-08-31',
      totais: {
        totalSaidas: { qtd: 70, valor: 182680.74 },
        totalTributado: { qtd: 70, valor: 182680.74 },
        totalEntradas: { qtd: 60, valor: 89963.79 },
        totalNfe: { qtd: 10, valor: 25282.46 },
        totalCtr: { qtd: 37, valor: 6468.36 },
        totalImpostos: { qtd: 3, valor: 15818.17 }
      },
      rbt12: 2375044.88,
      usuario: 'Teste Automatizado'
    };

    const resSave = await salvarFechamentoFiscalDB(dadosMock);
    assert.ok(resSave.ok, 'Gravação do fechamento deve retornar ok');

    const resGet = await obterFechamentoFiscalDB('16', '202608');
    assert.ok(resGet, 'Fechamento salvo deve ser recuperado com sucesso');
    assert.strictEqual(String(resGet.empresa || resGet.empresa_cod), '16', 'Empresa do fechamento deve ser 16');

    const lista = await listarFechamentosFiscaisDB('16');
    assert.ok(Array.isArray(lista), 'Listagem deve ser um array');
    assert.ok(lista.length > 0, 'Deve haver ao menos um fechamento na listagem');
  });

  // TESTE 7: Integridade Léxica e Sintática dos Arquivos Frontend
  report('Teste 7: Verificação léxica de public/js/fechamento_fiscal.js e public/app.js', () => {
    const codeFiscal = fs.readFileSync(path.join(__dirname, 'public/js/fechamento_fiscal.js'), 'utf-8');
    assert.doesNotThrow(() => new vm.Script(codeFiscal), 'fechamento_fiscal.js deve ter sintaxe válida');

    const codeApp = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf-8');
    assert.doesNotThrow(() => new vm.Script(codeApp), 'app.js deve ter sintaxe válida');
  });

  // TESTE 8: Presença de Elementos de Interface no public/index.html
  report('Teste 8: Verificação da sub-aba e componentes de UI no public/index.html', () => {
    const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf-8');

    assert.ok(html.includes('id="btnTabFechamentoFiscal"'), 'Deve conter botão #btnTabFechamentoFiscal');
    assert.ok(html.includes('id="tab-fechamento-fiscal"'), 'Deve conter aba #tab-fechamento-fiscal');
    assert.ok(html.includes('id="selFechamentoEmpresa"'), 'Deve conter seletor de empresa #selFechamentoEmpresa');
    assert.ok(html.includes('id="btnConsultarFechamentoFiscal"'), 'Deve conter botão #btnConsultarFechamentoFiscal');
    assert.ok(html.includes('id="kpiTotalTributadoQtd"'), 'Deve conter card #kpiTotalTributadoQtd');
    assert.ok(html.includes('id="kpiTotalImpostosValor"'), 'Deve conter card #kpiTotalImpostosValor');
    assert.ok(html.includes('id="inputBuscaFechamento"'), 'Deve conter campo de busca instantânea #inputBuscaFechamento');
    assert.ok(html.includes('id="tbodyFechamentoFiscal"'), 'Deve conter tabela #tbodyFechamentoFiscal');
    assert.ok(html.includes('src="js/fechamento_fiscal.js'), 'Deve importar script fechamento_fiscal.js');
  });

  // TESTE 9: Formatação Auxiliar de CPF/CNPJ e Data
  report('Teste 9: Verificação dos utilitários formatarDataBrFiscal e formatarCgcFiscal', () => {
    assert.strictEqual(formatarDataBrFiscal('20260804'), '04/08/2026', 'Data 20260804 deve formatar 04/08/2026');
    assert.strictEqual(formatarCgcFiscal('40838591000195'), '40.838.591/0001-95', 'CNPJ deve formatar com máscara');
    assert.strictEqual(formatarCgcFiscal('10612344797'), '106.123.447-97', 'CPF deve formatar com máscara');
  });

  console.log('\n========================================================');
  console.log(`📊 RESULTADO DA SUÍTE: ${passed} PASSOU, ${failed} FALHOU (Total: ${passed + failed})`);
  console.log('========================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Erro fatal durante execução da suíte de testes:', err);
  process.exit(1);
});
