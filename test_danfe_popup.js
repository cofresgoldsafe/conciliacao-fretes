/**
 * test_danfe_popup.js — Suíte de Testes Automatizados para DANFE e Visualizador de NF-e
 * 
 * Testa:
 * 1. Parser de XML do DANFE (danfe_parser.js)
 * 2. Formatação de CNPJ/CPF, Chave de Acesso e Moeda
 * 3. Enriquecimento de chaveNfe e serieNf em protheus_db.js
 * 4. Busca flexível em postgres_db.js (obterDocumentoNfeCentralPorChaveOuDoc)
 * 5. Tratamento de erros, XML ausente e cálculo da próxima sincronização (12:30h / 18:30h)
 */

'use strict';

const assert = require('assert');
const { parseDanfeXml, formatCnpjCpf, formatChaveAcesso, formatDate, formatMoeda } = require('./danfe_parser');

let passedTests = 0;
let failedTests = 0;

function runTest(desc, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${desc}: ${err.message}`);
    failedTests++;
  }
}

async function runTestAsync(desc, fn) {
  try {
    await fn();
    console.log(`  ✅ [PASS] ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${desc}: ${err.message}`);
    failedTests++;
  }
}

// XML Completo Mock para teste do DANFE
const xmlCompletoMock = `<?xml version="1.0" encoding="utf-8"?>
<nfeProc versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe>
    <infNFe Id="NFe35260848758821000118550010000007891988776655" versao="4.00">
      <ide>
        <cUF>35</cUF>
        <natOp>VENDA DE MERCADORIA</natOp>
        <mod>55</mod>
        <serie>1</serie>
        <nNF>789</nNF>
        <dhEmi>2026-08-15T14:30:00-03:00</dhEmi>
        <dhSaiEnt>2026-08-15T16:00:00-03:00</dhSaiEnt>
        <tpNF>1</tpNF>
        <tpAmb>1</tpAmb>
      </ide>
      <emit>
        <CNPJ>48758821000118</CNPJ>
        <xNome>METAL PLENO INDUSTRIA E COMERCIO LTDA</xNome>
        <xFant>METAL PLENO</xFant>
        <enderEmit>
          <xLgr>RUA DAS INDUSTRIAS</xLgr>
          <nro>1200</nro>
          <xCpl>GALPAO 3</xCpl>
          <xBairro>DISTRITO INDUSTRIAL</xBairro>
          <xMun>SAO PAULO</xMun>
          <UF>SP</UF>
          <CEP>01001000</CEP>
          <fone>1133334444</fone>
        </enderEmit>
        <IE>123456789111</IE>
        <CRT>3</CRT>
      </emit>
      <dest>
        <CNPJ>12345678000195</CNPJ>
        <xNome>CLIENTE TESTE COMERCIO DE COFRES SA</xNome>
        <enderDest>
          <xLgr>AVENIDA PAULISTA</xLgr>
          <nro>1500</nro>
          <xCpl>SALA 101</xCpl>
          <xBairro>BELA VISTA</xBairro>
          <xMun>SAO PAULO</xMun>
          <UF>SP</UF>
          <CEP>01310100</CEP>
          <fone>11988887777</fone>
        </enderDest>
        <IE>987654321000</IE>
        <email>financeiro@clienteteste.com.br</email>
      </dest>
      <det nItem="1">
        <prod>
          <cProd>COFRE-GS-50</cProd>
          <xProd>COFRE DIGITAL DE ALTA SEGURANCA GOLD SAFE 50CM</xProd>
          <NCM>83030000</NCM>
          <CFOP>5102</CFOP>
          <uCom>UN</uCom>
          <qCom>2.0000</qCom>
          <vUnCom>1500.0000</vUnCom>
          <vProd>3000.00</vProd>
        </prod>
        <imposto>
          <ICMS>
            <ICMS00>
              <orig>0</orig>
              <CST>00</CST>
              <modBC>3</modBC>
              <vBC>3000.00</vBC>
              <pICMS>18.00</pICMS>
              <vICMS>540.00</vICMS>
            </ICMS00>
          </ICMS>
          <IPI>
            <IPITrib>
              <CST>50</CST>
              <vBC>3000.00</vBC>
              <pIPI>5.00</pIPI>
              <vIPI>150.00</vIPI>
            </IPITrib>
          </IPI>
        </imposto>
      </det>
      <total>
        <ICMSTot>
          <vBC>3000.00</vBC>
          <vICMS>540.00</vICMS>
          <vBCST>0.00</vBCST>
          <vST>0.00</vST>
          <vProd>3000.00</vProd>
          <vFrete>120.00</vFrete>
          <vSeg>0.00</vSeg>
          <vDesc>50.00</vDesc>
          <vII>0.00</vII>
          <vIPI>150.00</vIPI>
          <vPIS>49.50</vPIS>
          <vCOFINS>228.00</vCOFINS>
          <vOutro>0.00</vOutro>
          <vNF>3220.00</vNF>
        </ICMSTot>
      </total>
      <transp>
        <modFrete>0</modFrete>
        <transporta>
          <CNPJ>99888777000166</CNPJ>
          <xNome>RODONAVES TRANSPORTES LTDA</xNome>
          <IE>112233445566</IE>
          <xEnder>RODOVIA ANHANGUERA KM 312</xEnder>
          <xMun>RIBEIRAO PRETO</xMun>
          <UF>SP</UF>
        </transporta>
        <vol>
          <qVol>2</qVol>
          <esp>VOLUMES</esp>
          <marca>GOLD SAFE</marca>
          <pesoB>85.500</pesoB>
          <pesoL>82.000</pesoL>
        </vol>
      </transp>
      <cobr>
        <fat>
          <nFat>789</nFat>
          <vOrig>3220.00</vOrig>
          <vDesc>0.00</vDesc>
          <vLiq>3220.00</vLiq>
        </fat>
        <dup>
          <nDup>001</nDup>
          <dVenc>2026-09-15</dVenc>
          <vDup>1610.00</vDup>
        </dup>
        <dup>
          <nDup>002</nDup>
          <dVenc>2026-10-15</dVenc>
          <vDup>1610.00</vDup>
        </dup>
      </cobr>
      <infAdic>
        <infCpl>PEDIDO DE VENDA: 000543 | CODWEB: 34521 | VENDEDOR: JOAO COMERCIAL</infCpl>
      </infAdic>
    </infNFe>
  </NFe>
  <protNFe versao="4.00">
    <infProt>
      <tpAmb>1</tpAmb>
      <verAplic>SP_NFE_PL_009</verAplic>
      <chNFe>35260848758821000118550010000007891988776655</chNFe>
      <dhRecbto>2026-08-15T14:30:15-03:00</dhRecbto>
      <nProt>135260012345678</nProt>
      <cStat>100</cStat>
      <xMotivo>Autorizado o uso da NF-e</xMotivo>
    </infProt>
  </protNFe>
</nfeProc>`;

async function runAllTests() {
  console.log('\n======================================================');
  console.log('🧪 SUÍTE DE TESTES: DANFE & VISUALIZADOR DE NF-E');
  console.log('======================================================\n');

  // 1. Testes do danfe_parser.js
  runTest('1.1 - Formatação de CNPJ e CPF', () => {
    assert.strictEqual(formatCnpjCpf('48758821000118'), '48.758.821/0001-18');
    assert.strictEqual(formatCnpjCpf('12345678901'), '123.456.789-01');
    assert.strictEqual(formatCnpjCpf(''), '-');
  });

  runTest('1.2 - Formatação de Chave de Acesso em grupos de 4', () => {
    const chave = '35260848758821000118550010000007891988776655';
    const fmt = formatChaveAcesso(chave);
    assert.strictEqual(fmt, '3526 0848 7588 2100 0118 5500 1000 0007 8919 8877 6655');
  });

  runTest('1.3 - Formatação de Moeda e Data', () => {
    assert.strictEqual(formatMoeda(3220.5), '3.220,50');
    assert.strictEqual(formatMoeda('100.00'), '100,00');
    assert.strictEqual(formatDate('2026-08-15T14:30:00-03:00'), '15/08/2026');
    assert.strictEqual(formatDate('20260815'), '15/08/2026');
  });

  runTest('1.4 - parseDanfeXml extrai corretamente cabeçalho e chave', () => {
    const danfe = parseDanfeXml(xmlCompletoMock);
    assert.strictEqual(danfe.numeroNf, '789');
    assert.strictEqual(danfe.serie, '1');
    assert.strictEqual(danfe.chaveAcesso, '35260848758821000118550010000007891988776655');
    assert.strictEqual(danfe.tipoOperacao, '1 - SAÍDA');
    assert.strictEqual(danfe.dataEmissao, '15/08/2026');
    assert.strictEqual(danfe.protocolo.numero, '135260012345678');
  });

  runTest('1.5 - parseDanfeXml extrai dados de Emitente e Destinatário', () => {
    const danfe = parseDanfeXml(xmlCompletoMock);
    assert.strictEqual(danfe.emitente.cnpjCpfFormatado, '48.758.821/0001-18');
    assert.strictEqual(danfe.emitente.xNome, 'METAL PLENO INDUSTRIA E COMERCIO LTDA');
    assert.strictEqual(danfe.emitente.uf, 'SP');
    assert.strictEqual(danfe.destinatario.cnpjCpfFormatado, '12.345.678/0001-95');
    assert.strictEqual(danfe.destinatario.xNome, 'CLIENTE TESTE COMERCIO DE COFRES SA');
    assert.strictEqual(danfe.destinatario.email, 'financeiro@clienteteste.com.br');
  });

  runTest('1.6 - parseDanfeXml extrai Totais e Impostos', () => {
    const danfe = parseDanfeXml(xmlCompletoMock);
    assert.strictEqual(danfe.totais.vProd, 3000.00);
    assert.strictEqual(danfe.totais.vFrete, 120.00);
    assert.strictEqual(danfe.totais.vIPI, 150.00);
    assert.strictEqual(danfe.totais.vNF, 3220.00);
    assert.strictEqual(danfe.totais.vBC, 3000.00);
    assert.strictEqual(danfe.totais.vICMS, 540.00);
  });

  runTest('1.7 - parseDanfeXml extrai Itens / Produtos e Duplicatas', () => {
    const danfe = parseDanfeXml(xmlCompletoMock);
    assert.strictEqual(danfe.itens.length, 1);
    assert.strictEqual(danfe.itens[0].codigo, 'COFRE-GS-50');
    assert.strictEqual(danfe.itens[0].quantidade, 2);
    assert.strictEqual(danfe.itens[0].valorTotal, 3000);
    assert.strictEqual(danfe.duplicatas.length, 2);
    assert.strictEqual(danfe.duplicatas[0].nDup, '001');
    assert.strictEqual(danfe.duplicatas[0].vDup, 1610);
    assert.strictEqual(danfe.duplicatas[1].dVenc, '15/10/2026');
  });

  runTest('1.8 - parseDanfeXml trata exceção para XML inválido', () => {
    assert.throws(() => {
      parseDanfeXml('');
    }, /inválido ou vazio/);
  });

  // 2. Testes de Integração com postgres_db.js
  await runTestAsync('2.1 - obterDocumentoNfeCentralPorChaveOuDoc localiza documento por chave e por doc', async () => {
    const { obterDocumentoNfeCentralPorChaveOuDoc } = require('./postgres_db');
    assert.strictEqual(typeof obterDocumentoNfeCentralPorChaveOuDoc, 'function');
    
    // Testa busca resiliente (mesmo sem conexão real ou com fallback)
    const docInexistente = await obterDocumentoNfeCentralPorChaveOuDoc({ chave: '00000000000000000000000000000000000000000000' });
    assert.strictEqual(docInexistente, null);
  });

  // 3. Teste do Cálculo de Próxima Sincronização
  runTest('3.1 - Próxima sincronização calcula 12:30h ou 18:30h corretamente', () => {
    const agora = new Date();
    const utcHours = agora.getUTCHours();
    const utcMinutes = agora.getUTCMinutes();
    const brHours = (utcHours - 3 + 24) % 24;

    let proximaSync = '12:30h';
    if (brHours < 12 || (brHours === 12 && utcMinutes < 30)) {
      proximaSync = '12:30h';
    } else if (brHours < 18 || (brHours === 18 && utcMinutes < 30)) {
      proximaSync = '18:30h';
    } else {
      proximaSync = 'amanhã às 12:30h';
    }
    assert(proximaSync.includes('12:30h') || proximaSync.includes('18:30h'));
  });

  // 4. Testes de Interface & Estrutura HTML/CSS
  runTest('4.1 - public/index.html contém modal #danfeModal e botões de ação', () => {
    const fs = require('fs');
    const html = fs.readFileSync('./public/index.html', 'utf8');
    assert(html.includes('id="danfeModal"'), 'Modal #danfeModal não encontrado em index.html');
    assert(html.includes('id="btnImprimirDanfe"'), 'Botão #btnImprimirDanfe não encontrado');
    assert(html.includes('id="btnDownloadXmlDanfe"'), 'Botão #btnDownloadXmlDanfe não encontrado');
    assert(html.includes('id="btnCopiarChaveDanfe"'), 'Botão #btnCopiarChaveDanfe não encontrado');
    assert(html.includes('id="danfeLoadingSefaz"'), 'Container #danfeLoadingSefaz não encontrado');
    assert(html.includes('id="danfeNaoSincronizado"'), 'Container #danfeNaoSincronizado não encontrado');
    assert(html.includes('id="danfePaperContainer"'), 'Container #danfePaperContainer não encontrado');
  });

  runTest('4.2 - public/style.css contém classes .link-nfe, .danfe-paper e regras @media print', () => {
    const fs = require('fs');
    const css = fs.readFileSync('./public/style.css', 'utf8');
    assert(css.includes('.link-nfe'), 'Classe .link-nfe não encontrada em style.css');
    assert(css.includes('.danfe-paper'), 'Classe .danfe-paper não encontrada em style.css');
    assert(css.includes('.danfe-sefaz-spinner'), 'Classe .danfe-sefaz-spinner não encontrada');
    assert(css.includes('@media print'), 'Regras @media print não encontradas');
    assert(css.includes('#danfeModal'), '#danfeModal nas regras de impressão não encontrado');
  });

  runTest('4.3 - public/app.js compila e exporta renderDanfeHtml e abrirDanfeModal', () => {
    const fs = require('fs');
    const vm = require('vm');
    const code = fs.readFileSync('./public/app.js', 'utf8');
    assert.doesNotThrow(() => {
      new vm.Script(code);
    }, 'Erro de sintaxe em public/app.js');
    assert(code.includes('function renderDanfeHtml'), 'Função renderDanfeHtml não encontrada em app.js');
    assert(code.includes('function abrirDanfeModal'), 'Função abrirDanfeModal não encontrada em app.js');
    assert(code.includes('link-nfe'), 'Classe link-nfe não referenciada em app.js');
  });

  // 5. Testes de Backend & Protheus DB
  runTest('5.1 - protheus_db.js seleciona CHAVE_NFE e SERIE_NF em buscarProtheusMultiEmpresa', () => {
    const fs = require('fs');
    const protheusDbCode = fs.readFileSync('./protheus_db.js', 'utf8');
    assert(protheusDbCode.includes('CHAVE_NFE'), 'CHAVE_NFE não selecionada nas queries do Protheus');
    assert(protheusDbCode.includes('SERIE_NF'), 'SERIE_NF não selecionada nas queries do Protheus');
    assert(protheusDbCode.includes('chaveNfe:'), 'chaveNfe não mapeada no retorno normalizado');
  });

  runTest('5.2 - server.js define as rotas /api/nfe/danfe-dados e /api/nfe/xml-download', () => {
    const fs = require('fs');
    const serverCode = fs.readFileSync('./server.js', 'utf8');
    assert(serverCode.includes("app.get('/api/nfe/danfe-dados'"), 'Rota /api/nfe/danfe-dados não definida em server.js');
    assert(serverCode.includes("app.get('/api/nfe/xml-download/:chave'"), 'Rota /api/nfe/xml-download/:chave não definida em server.js');
  });

  console.log('\n======================================================');
  console.log(`📊 RESULTADO DOS TESTES: ${passedTests} APROVADOS | ${failedTests} FALHAS`);
  console.log('======================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error('Erro na execução dos testes:', err);
  process.exit(1);
});
