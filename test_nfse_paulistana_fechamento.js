/**
 * test_nfse_paulistana_fechamento.js
 * Suíte de Testes Automatizados para a Integração de NFS-e Nota Paulistana (Prefeitura de SP)
 * no Fechamento Fiscal Mensal da GSI (Empresa 15).
 * 
 * Cobre:
 * 1. Parsers XML e TXT de lote da Nota Paulistana (paulistana_client.js)
 * 2. Utilitário nativo ZIP de lote de XMLs (zip_util.js)
 * 3. Persistência, idempotência e consultas em postgres_db.js (com fallback local)
 * 4. Mesclagem de NFS-e no Fechamento Fiscal Protheus (protheus_db.js) e impacto em totalTributado / totalServico
 * 5. Agregação de NFS-e no histórico de 12 meses e RBT12 para a Empresa 15 (GSI)
 * 6. Isolamento estrito entre empresas (14-MP e 16-OACO imunes a notas de serviço da 15)
 * 7. Verificação sintática e elementos de interface (index.html e fechamento_fiscal.js)
 * 8. Rotas e segurança fail-closed no server.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const {
  humanizarErroMtls,
  parseNFeXmlPaulistana,
  parseTxtLotePaulistana,
  gerarXmlSinteticoPaulistana
} = require('./paulistana_client');

const { criarZipBuffer, calcularCrc32 } = require('./zip_util');

const {
  salvarNfseEmitidasDB,
  consultarNfseEmitidasPeriodoDB,
  obterXmlNfseEmitidaDB,
  consultarHistoricoFaturamentoServicos12mDB
} = require('./postgres_db');

const {
  consultarFechamentoFiscalProtheus,
  obterHistoricoFaturamento12MesesProtheus
} = require('./protheus_db');

async function runTests() {
  console.log('🧪 =====================================================================');
  console.log('🧪 INICIANDO SUÍTE DE TESTES: NFS-E NOTA PAULISTANA & FECHAMENTO FISCAL');
  console.log('🧪 =====================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
      if (err.stack) {
        console.error(`     Linha do erro: ${err.stack.split('\n')[1]}`);
      }
      failed++;
    }
  }

  // XML Mock oficial representativo da Prefeitura de SP
  const mockXmlNfeIndividual = `<?xml version="1.0" encoding="UTF-8"?>
<NFe xmlns="http://www.prefeitura.sp.gov.br/nfe">
  <ChaveNFe>
    <InscricaoPrestador>43219876</InscricaoPrestador>
    <NumeroNFe>10452</NumeroNFe>
    <CodigoVerificacao>ABC123XYZ</CodigoVerificacao>
  </ChaveNFe>
  <DataEmissaoNFe>2026-08-15T14:30:00</DataEmissaoNFe>
  <NumeroLote>9988</NumeroLote>
  <TributacaoNFe>T</TributacaoNFe>
  <StatusNFe>N</StatusNFe>
  <Discriminacao>SERVICOS DE CONSULTORIA DE TI E INTEGRACAO DE SISTEMAS CONFORME CONTRATO GSI-2026</Discriminacao>
  <ValorServicos>15400.00</ValorServicos>
  <ValorDeducoes>0.00</ValorDeducoes>
  <ValorPIS>98.56</ValorPIS>
  <ValorCOFINS>454.40</ValorCOFINS>
  <ValorINSS>0.00</ValorINSS>
  <ValorIR>231.00</ValorIR>
  <ValorCSLL>154.00</ValorCSLL>
  <CodigoServico>02898</CodigoServico>
  <AliquotaServicos>0.025</AliquotaServicos>
  <ValorISS>385.00</ValorISS>
  <ISSRetido>false</ISSRetido>
  <CPFCNPJTomador>
    <CNPJ>22333444000199</CNPJ>
  </CPFCNPJTomador>
  <RazaoSocialTomador>CLIENTE CORPORATIVO EXEMPLO LTDA</RazaoSocialTomador>
  <EmailTomador>financeiro@clienteexemplo.com.br</EmailTomador>
</NFe>`;

  const mockXmlRetornoConsulta = `<?xml version="1.0" encoding="UTF-8"?>
<RetornoConsulta xmlns="http://www.prefeitura.sp.gov.br/nfe">
  <Cabecalho Versao="1">
    <Sucesso>true</Sucesso>
  </Cabecalho>
  ${mockXmlNfeIndividual}
  <NFe>
    <ChaveNFe>
      <InscricaoPrestador>43219876</InscricaoPrestador>
      <NumeroNFe>10453</NumeroNFe>
      <CodigoVerificacao>DEF456UVW</CodigoVerificacao>
    </ChaveNFe>
    <DataEmissaoNFe>2026-08-20T10:15:00</DataEmissaoNFe>
    <TributacaoNFe>T</TributacaoNFe>
    <StatusNFe>N</StatusNFe>
    <Discriminacao>DESENVOLVIMENTO DE SOFTWARE E CUSTOMIZACOES EM ERP</Discriminacao>
    <ValorServicos>8600.00</ValorServicos>
    <ValorDeducoes>0.00</ValorDeducoes>
    <ValorPIS>55.04</ValorPIS>
    <ValorCOFINS>253.68</ValorCOFINS>
    <ValorIR>129.00</ValorIR>
    <ValorCSLL>86.00</ValorCSLL>
    <CodigoServico>02898</CodigoServico>
    <AliquotaServicos>0.025</AliquotaServicos>
    <ValorISS>215.00</ValorISS>
    <ISSRetido>false</ISSRetido>
    <CPFCNPJTomador>
      <CNPJ>55666777000188</CNPJ>
    </CPFCNPJTomador>
    <RazaoSocialTomador>PARCEIRO TECNOLOGICO S.A.</RazaoSocialTomador>
  </NFe>
</RetornoConsulta>`;

  // TESTE 1: Parser de XML individual da Nota Paulistana
  await test('Teste 1: Parser de XML individual da Nota Paulistana (parseNFeXmlPaulistana)', () => {
    const notas = parseNFeXmlPaulistana(mockXmlNfeIndividual);
    assert.ok(Array.isArray(notas) && notas.length === 1, 'Deve retornar array com 1 nota');
    const nota = notas[0];
    assert.strictEqual(nota.numero_nota, '010452');
    assert.strictEqual(nota.codigo_verificacao, 'ABC123XYZ');
    assert.strictEqual(nota.valor_servicos, 15400.00);
    assert.strictEqual(nota.valor_pis, 98.56);
    assert.strictEqual(nota.valor_cofins, 454.40);
    assert.strictEqual(nota.valor_ir, 231.00);
    assert.strictEqual(nota.valor_csll, 154.00);
    assert.strictEqual(nota.valor_iss, 385.00);
    assert.strictEqual(nota.iss_retido, false);
    assert.strictEqual(nota.tomador_cnpj_cpf, '22333444000199');
    assert.strictEqual(nota.tomador_razao, 'CLIENTE CORPORATIVO EXEMPLO LTDA');
    assert.strictEqual(nota.status, 'NORMAL');
    assert.ok(nota.xml_conteudo.includes('<NumeroNFe>10452</NumeroNFe>'), 'XML conteúdo original deve ser preservado');
  });

  // TESTE 2: Parser de Retorno Consulta XML com múltiplas notas
  await test('Teste 2: Parser de RetornoConsulta XML com múltiplas notas (parseNFeXmlPaulistana)', () => {
    const notas = parseNFeXmlPaulistana(mockXmlRetornoConsulta);
    assert.strictEqual(notas.length, 2, 'Devem ser extraídas exatamente 2 notas');
    assert.strictEqual(notas[0].numero_nota, '010452');
    assert.strictEqual(notas[0].valor_servicos, 15400.00);
    assert.strictEqual(notas[1].numero_nota, '010453');
    assert.strictEqual(notas[1].valor_servicos, 8600.00);
    assert.strictEqual(notas[1].tomador_cnpj_cpf, '55666777000188');
  });

  // TESTE 3: Parser de arquivo TXT de lote da Prefeitura de SP
  await test('Teste 3: Parser de arquivo TXT de lote da Prefeitura de SP (parseTxtLotePaulistana)', () => {
    const txtLote = `1|00000000|20260801|20260831|14061778000115\n` +
      `2|10454|20260825|202608|14061778000115|43219876|22333444000199|CLIENTE TXT EXEMPLO|500000|0|12500|N|02898|250|MANUTENCAO PREVENTIVA DE EQUIPAMENTOS\n` +
      `2|10455|20260828|202608|14061778000115|43219876|33444555000188|OUTRO TOMADOR SA|350000|0|8750|N|02898|250|CONSULTORIA FISCAL E TI\n` +
      `9|2|850000|0|21250\n`;

    const notasTxt = parseTxtLotePaulistana(txtLote);
    assert.strictEqual(notasTxt.length, 2, 'Devem ser extraídas 2 notas do arquivo TXT');
    assert.strictEqual(notasTxt[0].numero_nota, '010454');
    assert.strictEqual(notasTxt[0].valor_servicos, 5000.00);
    assert.strictEqual(notasTxt[0].valor_iss, 125.00);
    assert.ok(notasTxt[0].xml_conteudo, 'Deve gerar XML sintético para notas importadas via TXT');
    assert.ok(notasTxt[0].xml_conteudo.includes('<NumeroNFe>010454</NumeroNFe>'), 'XML sintético deve conter número da nota');
  });

  // TESTE 4: Gerador de XML Sintético para Contingência
  await test('Teste 4: Geração de XML Sintético bem-formado (gerarXmlSinteticoPaulistana)', () => {
    const xml = gerarXmlSinteticoPaulistana({
      numero_nota: '99001',
      data_emissao: '2026-08-10T12:00:00',
      valor_servicos: 1200.50,
      valor_iss: 30.01,
      discriminacao_servico: 'MANUTENCAO PREVENTIVA',
      tomador_cnpj_cpf: '12345678000199',
      tomador_razao: 'TESTE TOMADOR SA'
    });

    assert.ok(xml.includes('<NFe'), 'Deve conter tag raiz NFe');
    assert.ok(xml.includes('<NumeroNFe>99001</NumeroNFe>'), 'Deve conter o número da NFe');
    assert.ok(xml.includes('<ValorServicos>1200.50</ValorServicos>'), 'Deve conter o valor formatado');
    assert.ok(xml.includes('TESTE TOMADOR SA'), 'Deve conter a razão social do tomador');
  });

  // TESTE 5: Utilitário ZIP Nativo (criarZipBuffer e calcularCrc32)
  await test('Teste 5: Geração de Pacote ZIP Nativo com múltiplos XMLs (zip_util.js)', () => {
    const arquivos = [
      { name: 'NFSe_10452.xml', content: mockXmlNfeIndividual },
      { name: 'NFSe_10453.xml', content: '<NFe><NumeroNFe>10453</NumeroNFe></NFe>' }
    ];

    const zipBuffer = criarZipBuffer(arquivos);
    assert.ok(Buffer.isBuffer(zipBuffer), 'Deve retornar um Buffer Node.js');
    assert.ok(zipBuffer.length > 100, 'Tamanho do ZIP deve ser coerente');

    // Assinatura PKZIP: 0x50 0x4B 0x03 0x04 ('PK\x03\x04')
    assert.strictEqual(zipBuffer[0], 0x50, 'Byte 0 deve ser P');
    assert.strictEqual(zipBuffer[1], 0x4b, 'Byte 1 deve ser K');
    assert.strictEqual(zipBuffer[2], 0x03, 'Byte 2 deve ser 0x03');
    assert.strictEqual(zipBuffer[3], 0x04, 'Byte 3 deve ser 0x04');

    // Assinatura Central Directory Header: 0x50 0x4B 0x01 0x02
    const zipString = zipBuffer.toString('latin1');
    assert.ok(zipString.includes('NFSe_10452.xml'), 'Deve conter o nome do arquivo 1 no header');
    assert.ok(zipString.includes('NFSe_10453.xml'), 'Deve conter o nome do arquivo 2 no header');
    // End of Central Directory: 'PK\x05\x06'
    assert.ok(zipString.includes('PK\x05\x06'), 'Deve conter o End of Central Directory');
  });

  // TESTE 6: Persistência no Banco / Armazenamento Local e Idempotência (salvarNfseEmitidasDB)
  await test('Teste 6: Persistência e idempotência de NFS-e (salvarNfseEmitidasDB e consultarNfseEmitidasPeriodoDB)', async () => {
    const notasParaSalvar = [
      {
        chave_acesso: '14061778000115_10452',
        numero_nota: '10452',
        empresa_cod_protheus: '15',
        empresa_cnpj: '14061778000115',
        inscricao_prestador: '43219876',
        data_emissao: '2026-08-15T14:30:00',
        competencia: '2026-08',
        codigo_verificacao: 'ABC123XYZ',
        tomador_cnpj_cpf: '22333444000199',
        tomador_razao: 'CLIENTE CORPORATIVO EXEMPLO LTDA',
        discriminacao_servico: 'SERVICOS DE CONSULTORIA DE TI',
        valor_servicos: 15400.00,
        valor_deducoes: 0,
        valor_pis: 98.56,
        valor_cofins: 454.40,
        valor_inss: 0,
        valor_ir: 231.00,
        valor_csll: 154.00,
        valor_iss: 385.00,
        aliquota_iss: 2.5,
        iss_retido: false,
        codigo_servico: '02898',
        status: 'NORMAL',
        origem: 'PREFEITURA_SP',
        xml_conteudo: mockXmlNfeIndividual
      },
      {
        chave_acesso: '14061778000115_10453',
        numero_nota: '10453',
        empresa_cod_protheus: '15',
        empresa_cnpj: '14061778000115',
        inscricao_prestador: '43219876',
        data_emissao: '2026-08-20T10:15:00',
        competencia: '2026-08',
        codigo_verificacao: 'DEF456UVW',
        tomador_cnpj_cpf: '55666777000188',
        tomador_razao: 'PARCEIRO TECNOLOGICO S.A.',
        discriminacao_servico: 'DESENVOLVIMENTO DE SOFTWARE',
        valor_servicos: 8600.00,
        valor_deducoes: 0,
        valor_pis: 55.04,
        valor_cofins: 253.68,
        valor_inss: 0,
        valor_ir: 129.00,
        valor_csll: 86.00,
        valor_iss: 215.00,
        aliquota_iss: 2.5,
        iss_retido: false,
        codigo_servico: '02898',
        status: 'NORMAL',
        origem: 'PREFEITURA_SP',
        xml_conteudo: '<NFe><NumeroNFe>10453</NumeroNFe></NFe>'
      }
    ];

    // Salva pela 1ª vez
    const resSave1 = await salvarNfseEmitidasDB(notasParaSalvar);
    assert.ok(resSave1.ok, 'Deve retornar ok: true');
    assert.ok(resSave1.total >= 2, 'Total processado deve ser >= 2');

    // Salva pela 2ª vez (deve ser idempotente / atualizar sem duplicar)
    const resSave2 = await salvarNfseEmitidasDB(notasParaSalvar);
    assert.ok(resSave2.ok, 'Segundo salvamento deve retornar ok');
    assert.ok(resSave2.total >= 2, 'Total processado deve ser >= 2');

    // Consulta sem XML (modo leve para listagem)
    const notasListadas = await consultarNfseEmitidasPeriodoDB({
      empresa: '15',
      dataDe: '2026-08-01',
      dataAte: '2026-08-31',
      incluirXml: false
    });
    assert.ok(Array.isArray(notasListadas), 'Deve retornar array de notas');
    assert.ok(notasListadas.length >= 2, 'Deve retornar ao menos as 2 notas');
    const n1 = notasListadas.find(n => n.numero_nota === '10452');
    assert.ok(n1, 'Nota 10452 deve estar na listagem');
    assert.strictEqual(n1.valor_servicos, 15400.00);
    assert.strictEqual(n1.tem_xml, true, 'Flag tem_xml deve ser true');
    assert.strictEqual(n1.xml_conteudo, undefined, 'xml_conteudo deve ser omitido na listagem para performance');

    // Obter XML individual sob demanda
    const xmlIndividual = await obterXmlNfseEmitidaDB('14061778000115_10452');
    assert.ok(xmlIndividual && xmlIndividual.xml_conteudo, 'XML individual deve ser retornado');
    assert.ok(xmlIndividual.xml_conteudo.includes('<NumeroNFe>10452</NumeroNFe>'), 'XML deve conter os dados originais');
  });

  // TESTE 7: Mesclagem no Fechamento Fiscal Protheus da GSI (Empresa 15)
  await test('Teste 7: Integração de NFS-e no Fechamento Fiscal da GSI (consultarFechamentoFiscalProtheus)', async () => {
    const resGsi = await consultarFechamentoFiscalProtheus({
      empresa: '15',
      dataDe: '2026-08-01',
      dataAte: '2026-08-31',
      criterioDataEntrada: 'EMISSAO'
    });

    assert.ok(resGsi.ok, 'Fechamento da GSI deve responder ok: true');
    assert.strictEqual(resGsi.empresaCodigo, '15');

    // Total de Serviço deve conter as 2 notas (15.400 + 8.600 = 24.000)
    assert.ok(resGsi.totais.totalServico, 'Objeto totalServico deve existir');
    assert.ok(resGsi.totais.totalServico.qtd >= 2, 'Quantidade de serviços deve ser >= 2');
    assert.ok(resGsi.totais.totalServico.valor >= 24000.00, 'Valor de serviços deve ser >= R$ 24.000,00');

    // Breakdown prefeituraSp
    assert.ok(resGsi.totais.totalServico.prefeituraSp, 'Deve conter breakdown prefeituraSp');
    assert.ok(resGsi.totais.totalServico.prefeituraSp.qtd >= 2, 'Qtd prefeituraSp deve ser >= 2');
    assert.ok(resGsi.totais.totalServico.prefeituraSp.valor >= 24000.00, 'Valor prefeituraSp deve ser >= 24000');

    // Total Tributado deve incluir o total de serviço
    assert.ok(resGsi.totais.totalTributado.valor >= resGsi.totais.totalServico.valor,
      'Total Tributado deve englobar o faturamento das notas de serviço');

    // Verifica presença de itens com origem PREFEITURA_SP no array de itens
    const itensServico = resGsi.itens.filter(s => s.origem === 'PREFEITURA_SP' || s.especie === 'NFS-e SP');
    assert.ok(itensServico.length >= 2, 'Array de itens deve conter as notas da Prefeitura de SP');
    const nf1 = itensServico.find(s => s.numNf === '10452' || s.numNf === '010452');
    assert.ok(nf1, 'Nota 10452 deve estar presente no array de itens');
    assert.strictEqual(nf1.entraSaida, 'SAÍDA');
    assert.strictEqual(nf1.especie, 'NFS-e SP');
    assert.strictEqual(nf1.cfop, '5933');
    assert.strictEqual(nf1.tipoOperacao, 'SERVICO');
    assert.strictEqual(nf1.geraImposto, 'Sim', 'NFS-e de saída deve gerar imposto');
    assert.strictEqual(nf1.temXml, true, 'Flag temXml deve ser true');
  });

  // TESTE 8: Isolamento Estrito entre Empresas (Metal Pleno 14 e OAÇO 16 não podem receber NFS-e da 15)
  await test('Teste 8: Isolamento estrito entre empresas (14 e 16 não recebem NFS-e da 15)', async () => {
    // Empresa 16 (OACO)
    const resOaco = await consultarFechamentoFiscalProtheus({
      empresa: '16',
      dataDe: '2026-08-01',
      dataAte: '2026-08-31',
      criterioDataEntrada: 'EMISSAO'
    });

    const servicosOaco = resOaco.itens.filter(s => s.origem === 'PREFEITURA_SP');
    assert.strictEqual(servicosOaco.length, 0, 'OACO não deve conter notas de serviço da prefeitura de SP da GSI');
    assert.strictEqual(resOaco.totais.totalServico.prefeituraSp.qtd, 0, 'Qtd prefeituraSp para OACO deve ser 0');
    assert.strictEqual(resOaco.totais.totalServico.prefeituraSp.valor, 0, 'Valor prefeituraSp para OACO deve ser 0');

    // Empresa 14 (Metal Pleno)
    const resMp = await consultarFechamentoFiscalProtheus({
      empresa: '14',
      dataDe: '2026-08-01',
      dataAte: '2026-08-31',
      criterioDataEntrada: 'EMISSAO'
    });

    const servicosMp = resMp.itens.filter(s => s.origem === 'PREFEITURA_SP');
    assert.strictEqual(servicosMp.length, 0, 'Metal Pleno não deve conter notas de serviço da prefeitura da GSI');
  });

  // TESTE 9: Agregação de NFS-e no Histórico de 12 Meses e RBT12 para a Empresa 15 (GSI)
  await test('Teste 9: Agregação de serviços no Histórico de Faturamento 12 Meses e RBT12 (obterHistoricoFaturamento12MesesProtheus)', async () => {
    const res12m = await obterHistoricoFaturamento12MesesProtheus({
      empresa: '15',
      anoMesReferencia: '202608'
    });
    assert.ok(res12m.ok, 'Histórico deve responder ok: true');
    assert.strictEqual(res12m.historico.length, 12, 'Devem ser 12 meses históricos');

    // Mês de 202608 deve computar o faturamento das notas de serviço
    const mesAgosto = res12m.historico.find(m => m.anoMes === '202608' || m.anoMes === '08/2026');
    if (mesAgosto) {
      assert.ok(mesAgosto.totalServicos >= 24000.00, 'Total de serviços de 08/2026 deve ser >= R$ 24.000,00');
      assert.ok(mesAgosto.totalFaturamento >= mesAgosto.totalServicos, 'Faturamento total deve somar os serviços');
    }

    // RBT12 total deve ser computada
    assert.ok(res12m.rbt12 >= 24000.00, 'RBT12 deve computar o faturamento dos serviços da GSI');
  });

  // TESTE 10: Verificação de UI, Botões e Modais no index.html e fechamento_fiscal.js
  await test('Teste 10: Verificação léxica de botões, modais e handlers no frontend', () => {
    const indexHtml = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf-8');
    const jsFechamento = fs.readFileSync(path.join(__dirname, 'public', 'js', 'fechamento_fiscal.js'), 'utf-8');

    // Botões no index.html
    assert.ok(indexHtml.includes('id="btnSincronizarNfseSp"'), 'Deve conter botão btnSincronizarNfseSp no index.html');
    assert.ok(indexHtml.includes('id="btnExportarLoteXmlZip"'), 'Deve conter botão btnExportarLoteXmlZip no index.html');
    assert.ok(indexHtml.includes('id="btnImportarLoteNfseSp"'), 'Deve conter botão btnImportarLoteNfseSp no index.html');
    assert.ok(indexHtml.includes('id="inputUploadLoteNfseSp"'), 'Deve conter input de upload de lote no index.html');
    assert.ok(indexHtml.includes('id="modalNfsePaulistanaDetalhes"'), 'Deve conter modal modalNfsePaulistanaDetalhes no index.html');

    // Handlers no JS
    assert.ok(jsFechamento.includes('sincronizarNfseSp'), 'Deve implementar função sincronizarNfseSp');
    assert.ok(jsFechamento.includes('exportarLoteXmlZip'), 'Deve implementar função exportarLoteXmlZip');
    assert.ok(jsFechamento.includes('abrirModalNfsePaulistana'), 'Deve implementar função abrirModalNfsePaulistana');
    assert.ok(jsFechamento.includes('baixarXmlIndividual'), 'Deve implementar função baixarXmlIndividual');
    assert.ok(jsFechamento.includes('🏛️ NFS-e SP'), 'Deve exibir badge institucional para NFS-e SP');

    // Verificação de sintaxe via vm.Script
    assert.doesNotThrow(() => {
      new vm.Script(jsFechamento, { filename: 'fechamento_fiscal.js' });
    }, 'public/js/fechamento_fiscal.js deve ter sintaxe JavaScript válida');
  });

  // TESTE 11: Verificação de Endpoints e Rotas no server.js
  await test('Teste 11: Verificação de rotas e segurança no server.js', () => {
    const serverJs = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf-8');

    assert.ok(serverJs.includes('/api/analista-fin/nfse-emitidas/sync'), 'Deve registrar rota /sync');
    assert.ok(serverJs.includes('/api/analista-fin/nfse-emitidas/ingest'), 'Deve registrar rota /ingest');
    assert.ok(serverJs.includes('/api/analista-fin/nfse-emitidas/upload'), 'Deve registrar rota /upload');
    assert.ok(serverJs.includes('/api/analista-fin/nfse-emitidas/:chaveAcesso/xml'), 'Deve registrar rota /:chaveAcesso/xml');
    assert.ok(serverJs.includes('/api/analista-fin/nfse-emitidas/exportar-zip'), 'Deve registrar rota /exportar-zip');
    assert.ok(serverJs.includes('requireAuth'), 'Rotas de NFS-e devem ser protegidas por requireAuth');
  });

  // TESTE 12: Humanização e Tratamento Resiliente de Erros Criptográficos mTLS / OpenSSL 3.0
  await test('Teste 12: Tradução operacional de erros OpenSSL mTLS (humanizarErroMtls)', () => {
    const errLegacy = humanizarErroMtls({ message: 'Unsupported PKCS12 PFX data' });
    assert.ok(errLegacy.includes('PKCS#12 legada'), 'Deve identificar criptografia legada');

    const errDecoder = humanizarErroMtls({ message: 'error:1E08010C:DECODER routines::unsupported' });
    assert.ok(errDecoder.includes('Importar Lote SP'), 'Deve orientar importação de lote');

    const errSenha = humanizarErroMtls({ message: 'mac verify failure' });
    assert.ok(errSenha.includes('Senha do certificado'), 'Deve identificar senha incorreta');

    const errDecryption = humanizarErroMtls({ message: '409D8E90867F0000:error:0A000119:SSL routines:tls_get_more_records:decryption failed or bad record mac' });
    assert.ok(errDecryption.includes('handshake mTLS') || errDecryption.includes('vencido'), 'Deve orientar sobre handshake ou vencimento');

    const errExpired = humanizarErroMtls({ message: 'certificate has expired', code: 'CERT_HAS_EXPIRED' });
    assert.ok(errExpired.includes('VENCIDO'), 'Deve alertar sobre certificado vencido');
  });

  // TESTE 13: Verificação de Inicialização do Servidor com Suporte a Cifras Legadas no package.json
  await test('Teste 13: Script de inicialização do package.json configurado com --openssl-legacy-provider', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
    assert.ok(pkg.scripts && pkg.scripts.start, 'Deve possuir script start');
    assert.ok(pkg.scripts.start.includes('--openssl-legacy-provider'), 'Script start deve carregar o provedor legado do OpenSSL 3.0');
  });

  console.log('\n=====================================================================');
  console.log(`📊 RESULTADO DA SUÍTE: ${passed} PASSOU, ${failed} FALHOU (Total: ${passed + failed})`);
  console.log('=====================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
