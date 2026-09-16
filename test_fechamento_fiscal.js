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

    // 1.3 Devoluções e Remessas em 08/2026 (Computa NFe 000660 de devolução de entrada com formulário próprio)
    assert.strictEqual(res.totais.totalDevolucao.qtd, 1, 'Total Devolução deve ser 1 (NFe 000660)');
    assert.strictEqual(res.totais.totalDevolucao.valor, 607, 'Valor Devolução deve ser R$ 607,00 (NFe 000660)');
    assert.strictEqual(res.totais.totalDevolucao.saidas.qtd, 0, 'Devolução Saída deve ser 0');
    assert.strictEqual(res.totais.totalDevolucao.entradas.qtd, 1, 'Devolução Entrada deve ser 1 (NFe 000660)');
    assert.strictEqual(res.totais.totalDevolucao.entradas.valor, 607, 'Valor Devolução Entrada deve ser R$ 607,00');
    assert.strictEqual(res.totais.totalRemessa.qtd, 0, 'Total Remessa Saída deve ser 0');
    assert.strictEqual(res.totais.totalRemessa.valor, 0, 'Valor Remessa Saída deve ser R$ 0,00');

    // 1.3.1 Notas de Serviço Saída em 08/2026 (OACO não teve saída de serviço em 08/2026)
    assert.ok(res.totais.totalServico, 'Objeto totalServico deve existir nos totais');
    assert.strictEqual(res.totais.totalServico.qtd, 0, 'Total NFs Serviço Saída deve ser 0 em 08/2026');
    assert.strictEqual(res.totais.totalServico.valor, 0, 'Valor NFs Serviço Saída deve ser R$ 0,00 em 08/2026');

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
        totalRemessa: { qtd: 0, valor: 0 },
        totalServico: { qtd: 2, valor: 3500.00 },
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
    assert.strictEqual(resGet.totais?.totalServico?.qtd, 2, 'Total de serviços salvo deve ser 2');
    assert.strictEqual(resGet.totais?.totalServico?.valor, 3500.00, 'Valor de serviços salvo deve ser 3500.00');

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
    assert.ok(html.includes('id="kpiTotalRemessaQtd"'), 'Deve conter card #kpiTotalRemessaQtd');
    assert.ok(html.includes('id="kpiTotalServicoQtd"'), 'Deve conter card #kpiTotalServicoQtd');
    assert.ok(html.includes('id="kpiTotalServicoValor"'), 'Deve conter card #kpiTotalServicoValor');
    assert.ok(html.includes('id="kpiTotalTributadoQtd"'), 'Deve conter card #kpiTotalTributadoQtd');
    assert.ok(html.includes('id="kpiTotalImpostosValor"'), 'Deve conter card #kpiTotalImpostosValor');
    assert.ok(html.includes('id="inputBuscaFechamento"'), 'Deve conter campo de busca instantânea #inputBuscaFechamento');
    assert.ok(html.includes('value="SERVICO"'), 'Deve conter opção SERVICO no filtro de tipo');
    assert.ok(html.includes('value="SPED_NFE"'), 'Deve conter opção SPED_NFE no filtro de tipo de documento');
    assert.ok(html.includes('id="tbodyFechamentoFiscal"'), 'Deve conter tabela #tbodyFechamentoFiscal');
    assert.ok(html.includes('src="js/fechamento_fiscal.js'), 'Deve importar script fechamento_fiscal.js');
  });

  // TESTE 9: Formatação Auxiliar de CPF/CNPJ e Data
  report('Teste 9: Verificação dos utilitários formatarDataBrFiscal e formatarCgcFiscal', () => {
    assert.strictEqual(formatarDataBrFiscal('20260804'), '04/08/2026', 'Data 20260804 deve formatar 04/08/2026');
    assert.strictEqual(formatarCgcFiscal('40838591000195'), '40.838.591/0001-95', 'CNPJ deve formatar com máscara');
    assert.strictEqual(formatarCgcFiscal('10612344797'), '106.123.447-97', 'CPF deve formatar com máscara');
  });

  // TESTE 10: Validação de NFe de Devolução com Formulário Próprio MATA103 (NFe 000660 OACO 08/2026)
  await reportAsync('Teste 10: Validação de NFe de Devolução com Formulário Próprio MATA103 (NFe 000660)', async () => {
    const res = await consultarFechamentoFiscalProtheus({
      empresa: '16',
      dataDe: '2026-08-01',
      dataAte: '2026-08-31'
    });

    const nf660 = res.itens.find(i => i.numNf === '000660');
    assert.ok(nf660, 'NFe 000660 deve constar na listagem de itens');
    assert.strictEqual(nf660.entraSaida, 'ENTRA', 'Fluxo de 000660 deve ser ENTRA');
    assert.strictEqual(nf660.tipo, 'D', 'Tipo de 000660 deve ser D (Devolução)');
    assert.strictEqual(nf660.tipoDoc, 'SPED', 'Tipo Doc de 000660 deve ser SPED');
    assert.strictEqual(nf660.tipoOperacao, 'DEVOLUCAO', 'Operação deve ser classificada como DEVOLUCAO');
    assert.strictEqual(nf660.formularioProprio, true, 'Deve indicar formulário próprio emitido no MATA103');
    assert.strictEqual(nf660.valor, 607, 'Valor bruto de 000660 deve ser R$ 607,00');
    assert.strictEqual(nf660.cfop, '2202', 'CFOP de devolução deve ser 2202');
    assert.strictEqual(nf660.tes, '040', 'TES deve ser 040');
    assert.strictEqual(nf660.cnpjCpf, '24387738715', 'CPF do cliente deve ser resolvido via SA1');
    assert.strictEqual(nf660.cnpjCpfFmt, '243.877.387-15', 'CPF formatado deve ter máscara');
    assert.strictEqual(nf660.razaoSocial, 'Cicero Augusto Figueira', 'Razão social deve ser o nome do cliente Cicero Augusto Figueira');
    assert.strictEqual(nf660.nfOrigem, '000634', 'NF de saída original devolvida deve ser 000634');
    assert.strictEqual(nf660.serieOrigem, '1', 'Série de saída original deve ser 1');
  });

  // TESTE 11: Validação de Classificação de Notas de Serviço de Saída
  report('Teste 11: Classificação determinística de Notas de Serviço na Saída', () => {
    function classificarNotaSaida(row) {
      const val = Number(row.F2_VALBRUT || 0);
      const tipo = (row.F2_TIPO || '').trim().toUpperCase();
      const esp = (row.F2_ESPECIE || '').trim().toUpperCase();
      const cfop = String(row.CFOP || '').trim();
      const geraDuplic = (row.GERA_DUPLIC || 'N').trim().toUpperCase();

      let tipoOperacao = 'OUTRAS_SAIDAS';
      let geraImposto = false;

      if (tipo === 'D' || cfop.startsWith('52') || cfop.startsWith('62') || cfop.startsWith('72')) {
        tipoOperacao = 'DEVOLUCAO';
      } else if (
        tipo === 'S' ||
        ['NFS', 'RPS', 'NFPS', 'SE', 'NFSE', 'NFS-E'].includes(esp) ||
        cfop === '5933' || cfop === '6933' ||
        row.TES === '594' || row.TES === '099' || row.TES === '108' ||
        ((row.DESCR_TES || '').toUpperCase().includes('VENDA DE SERV') || (row.DESCR_TES || '').toUpperCase().includes('PRESTACAO DE SERV'))
      ) {
        tipoOperacao = 'SERVICO';
        geraImposto = true;
      } else if (
        tipo === 'B' ||
        cfop === '5554' ||
        (cfop.startsWith('59') && cfop !== '5922') ||
        (cfop.startsWith('69') && cfop !== '6922') ||
        cfop === '5117' ||
        cfop === '6117' ||
        geraDuplic !== 'S'
      ) {
        tipoOperacao = 'REMESSA';
      } else if (
        (tipo === 'N' || tipo === 'C') &&
        geraDuplic === 'S' &&
        (cfop.startsWith('51') || cfop.startsWith('54') || cfop.startsWith('61') || cfop.startsWith('64') || cfop.startsWith('71') || cfop === '5922' || cfop === '6922')
      ) {
        tipoOperacao = 'VENDA_TRIBUTADA';
        geraImposto = true;
      }

      const tipoDoc = (tipoOperacao === 'SERVICO' && (!esp || esp === 'SPED')) ? 'NFS' : (row.F2_ESPECIE || 'SPED').trim();

      return { tipoOperacao, geraImposto, tipoDoc };
    }

    // Cenário A: NF emitida com CFOP 5933 (Prestação de serviços)
    const nfsCfop = classificarNotaSaida({ F2_VALBRUT: 1500, F2_TIPO: 'N', F2_ESPECIE: 'SPED', CFOP: '5933', GERA_DUPLIC: 'S' });
    assert.strictEqual(nfsCfop.tipoOperacao, 'SERVICO', 'CFOP 5933 deve ser classificado como SERVICO');
    assert.strictEqual(nfsCfop.geraImposto, true, 'CFOP 5933 deve ter geraImposto = true');
    assert.strictEqual(nfsCfop.tipoDoc, 'NFS', 'TipoDoc deve ser NFS quando serviço');

    // Cenário B: NF emitida com espécie NFS
    const nfsEsp = classificarNotaSaida({ F2_VALBRUT: 2200, F2_TIPO: 'N', F2_ESPECIE: 'NFS', CFOP: '5949', GERA_DUPLIC: 'S' });
    assert.strictEqual(nfsEsp.tipoOperacao, 'SERVICO', 'Espécie NFS deve ser classificada como SERVICO');
    assert.strictEqual(nfsEsp.geraImposto, true, 'Espécie NFS deve ter geraImposto = true');

    // Cenário C: NF emitida com TES de serviço 594 (Venda de Serviço)
    const nfsTes = classificarNotaSaida({ F2_VALBRUT: 800, F2_TIPO: 'N', F2_ESPECIE: 'SPED', CFOP: '5102', TES: '594', DESCR_TES: 'VENDA DE SERVICO', GERA_DUPLIC: 'S' });
    assert.strictEqual(nfsTes.tipoOperacao, 'SERVICO', 'TES 594 de serviço deve ser classificada como SERVICO');
    assert.strictEqual(nfsTes.geraImposto, true, 'TES 594 deve ter geraImposto = true');

    // Cenário D: NF de remessa 5949 comum não deve ser confundida com serviço
    const remessa = classificarNotaSaida({ F2_VALBRUT: 300, F2_TIPO: 'N', F2_ESPECIE: 'SPED', CFOP: '5949', TES: '501', DESCR_TES: 'REMESSA P/ CONSERTO', GERA_DUPLIC: 'N' });
    assert.strictEqual(remessa.tipoOperacao, 'REMESSA', 'CFOP 5949 comum deve ser REMESSA');
    assert.strictEqual(remessa.geraImposto, false, 'Remessa não gera imposto');
  });

  // TESTE 12: Validação da lógica de filtragem conjunta por SPED & NFE
  report('Teste 12: Validação da lógica de filtragem conjunta por SPED & NFE', () => {
    const itensMock = [
      { numNf: '001', tipoDoc: 'SPED' },
      { numNf: '002', tipoDoc: 'NFE' },
      { numNf: '003', tipoDoc: 'CTR' },
      { numNf: '004', tipoDoc: 'NFS' },
      { numNf: '005', tipoDoc: 'IMP' },
      { numNf: '006', tipoDoc: 'SPED' },
      { numNf: '007', tipoDoc: 'DAS' },
      { numNf: '008', tipoDoc: 'NF-E' }
    ];

    function filtrarPorDoc(itens, filtroDoc) {
      return itens.filter(item => {
        if (filtroDoc !== 'ALL') {
          const docUpper = (item.tipoDoc || '').toUpperCase();
          if (filtroDoc === 'SPED_NFE' || filtroDoc === 'SPED & NFE') {
            if (docUpper !== 'SPED' && docUpper !== 'NFE' && docUpper !== 'NF-E') return false;
          } else if (filtroDoc === 'CTR' && docUpper !== 'CTR' && docUpper !== 'CTE') {
            return false;
          } else if (filtroDoc !== 'CTR' && docUpper !== filtroDoc) {
            return false;
          }
        }
        return true;
      });
    }

    const filtradosSpedNfe = filtrarPorDoc(itensMock, 'SPED_NFE');
    assert.strictEqual(filtradosSpedNfe.length, 4, 'SPED & NFE deve retornar 4 itens (2 SPED + 1 NFE + 1 NF-E)');
    assert.deepStrictEqual(filtradosSpedNfe.map(i => i.numNf), ['001', '002', '006', '008']);

    const filtradosSped = filtrarPorDoc(itensMock, 'SPED');
    assert.strictEqual(filtradosSped.length, 2, 'SPED isolado deve retornar 2 itens');

    const filtradosNfe = filtrarPorDoc(itensMock, 'NFE');
    assert.strictEqual(filtradosNfe.length, 1, 'NFE isolado deve retornar 1 item');

    const filtradosAll = filtrarPorDoc(itensMock, 'ALL');
    assert.strictEqual(filtradosAll.length, 8, 'ALL deve retornar todos os 8 itens');
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
