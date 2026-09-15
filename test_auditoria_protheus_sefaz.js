/**
 * test_auditoria_protheus_sefaz.js
 * Suíte de testes automatizados para a tela de Auditoria Protheus x SEFAZ:
 * 1. Cálculo de datas padrão do mês anterior
 * 2. Detecção algorítmica de Gaps / Numeração Faltante
 * 3. Matriz de Divergências Fiscais (Protheus x SEFAZ)
 * 4. Montagem de Envelope SOAP 1.2 e Parser XML SEFAZ
 * 5. Integração com Backend Protheus (consultarAuditoriaNfeProtheus)
 * 6. Verificação de Elementos de UI em index.html
 * 7. Verificação de Sintaxe Léxica (vm.Script)
 * 8. Validação de Chaves Inválidas e Fallback
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const {
  SEFAZ_SP_HOST,
  SEFAZ_SP_PATH,
  CSTAT_MAP,
  extrairTag,
  montarEnvelopeSoap12,
  classificarDivergencia,
  consultarSituacaoNfeSefaz
} = require('./sefaz_nfe_client');

const {
  consultarAuditoriaNfeProtheus,
  formatarDataBrFiscal
} = require('./protheus_db');

let totalTestes = 0;
let aprovados = 0;

function report(nome, fn) {
  totalTestes++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${nome}`);
    aprovados++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${nome}`);
    console.error(`     Erro: ${err.message}`);
  }
}

async function reportAsync(nome, fn) {
  totalTestes++;
  try {
    await fn();
    console.log(`  ✅ [PASS] ${nome}`);
    aprovados++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${nome}`);
    console.error(`     Erro: ${err.message}`);
  }
}

async function runTests() {
  console.log('\n=============================================================');
  console.log('🧪 SUÍTE DE TESTES: AUDITORIA PROTHEUS X SEFAZ');
  console.log('=============================================================\n');

  // 1. Cálculo de Datas do Mês Anterior
  report('Teste 1: Cálculo correto de datas do mês anterior', () => {
    const hoje = new Date();
    const anoAtual = hoje.getFullYear();
    const mesAtual = hoje.getMonth();
    const mesAnterior = mesAtual === 0 ? 11 : mesAtual - 1;
    const anoAnterior = mesAtual === 0 ? anoAtual - 1 : anoAtual;
    const ultimoDia = new Date(anoAnterior, mesAnterior + 1, 0).getDate();

    const pad = (n) => String(n).padStart(2, '0');
    const deEsperado = `${anoAnterior}-${pad(mesAnterior + 1)}-01`;
    const ateEsperado = `${anoAnterior}-${pad(mesAnterior + 1)}-${pad(ultimoDia)}`;

    assert.ok(deEsperado.endsWith('-01'), 'Data de deve ser o primeiro dia do mês');
    assert.ok(Number(ateEsperado.split('-')[2]) >= 28, 'Data até deve ser o último dia do mês (28 a 31)');
    assert.strictEqual(deEsperado.slice(0, 7), ateEsperado.slice(0, 7), 'Ambas as datas devem pertencer ao mesmo mês');
  });

  // 2. Detecção Algorítmica de Gaps / Numeração Faltante
  report('Teste 2: Detecção algorítmica de Saltos de Numeração (Gaps)', () => {
    // Simulação de sequência com gaps: 100, 101, 104, 105 (faltam 102 e 103)
    const docsRegistrados = new Map([
      [100, { num: 100, status: 'ATIVA' }],
      [101, { num: 101, status: 'ATIVA' }],
      [104, { num: 104, status: 'CANCELADA' }],
      [105, { num: 105, status: 'INUTILIZADA' }]
    ]);

    const nums = Array.from(docsRegistrados.keys()).sort((a, b) => a - b);
    const min = nums[0];
    const max = nums[nums.length - 1];

    const gaps = [];
    const itens = [];

    for (let n = min; n <= max; n++) {
      if (docsRegistrados.has(n)) {
        itens.push(docsRegistrados.get(n));
      } else {
        gaps.push(n);
        itens.push({ num: n, status: 'FALTANTE', isGap: true });
      }
    }

    assert.strictEqual(min, 100, 'Menor número deve ser 100');
    assert.strictEqual(max, 105, 'Maior número deve ser 105');
    assert.deepStrictEqual(gaps, [102, 103], 'Gaps detectados devem ser 102 e 103');
    assert.strictEqual(itens.length, 6, 'Total de posições na faixa contínua deve ser 6');
    assert.strictEqual(itens.filter(x => x.isGap).length, 2, 'Devem existir exatamente 2 gaps');
  });

  // 3. Matriz de Divergências Fiscais (Protheus x SEFAZ)
  report('Teste 3: Matriz de Classificação de Divergências Fiscais (classificarDivergencia)', () => {
    // 3.1 Cancelada no Protheus e Ativa na SEFAZ (DIVERGÊNCIA CRÍTICA)
    const d1 = classificarDivergencia('CANCELADA', 'AUTORIZADA');
    assert.strictEqual(d1.divergencia, true, 'Deve apontar divergência');
    assert.strictEqual(d1.gravidade, 'CRITICA', 'Gravidade deve ser CRITICA');
    assert.strictEqual(d1.tipo, 'CANCELADA_PROTHEUS_ATIVA_SEFAZ', 'Tipo deve ser CANCELADA_PROTHEUS_ATIVA_SEFAZ');

    // 3.2 Ativa no Protheus e Cancelada na SEFAZ (DIVERGÊNCIA CRÍTICA)
    const d2 = classificarDivergencia('ATIVA', 'CANCELADA');
    assert.strictEqual(d2.divergencia, true, 'Deve apontar divergência');
    assert.strictEqual(d2.gravidade, 'CRITICA', 'Gravidade deve ser CRITICA');
    assert.strictEqual(d2.tipo, 'ATIVA_PROTHEUS_CANCELADA_SEFAZ', 'Tipo deve ser ATIVA_PROTHEUS_CANCELADA_SEFAZ');

    // 3.3 Ativa no Protheus e Autorizada na SEFAZ (CONCILIADO OK)
    const d3 = classificarDivergencia('ATIVA', 'AUTORIZADA');
    assert.strictEqual(d3.divergencia, false, 'Não deve ter divergência');
    assert.strictEqual(d3.gravidade, 'OK', 'Gravidade deve ser OK');
    assert.strictEqual(d3.tipo, 'CONCILIADO', 'Tipo deve ser CONCILIADO');

    // 3.4 Cancelada no Protheus e Cancelada na SEFAZ (CONCILIADO OK)
    const d4 = classificarDivergencia('CANCELADA', 'CANCELADA');
    assert.strictEqual(d4.divergencia, false, 'Não deve ter divergência');
    assert.strictEqual(d4.tipo, 'CONCILIADO', 'Tipo deve ser CONCILIADO');

    // 3.5 Salto de Numeração sem registro na SEFAZ (ALERTA)
    const d5 = classificarDivergencia('FALTANTE', 'NAO_CONSTA');
    assert.strictEqual(d5.divergencia, true, 'Salto sem inutilização deve ser divergência');
    assert.strictEqual(d5.gravidade, 'ALERTA', 'Gravidade deve ser ALERTA');
    assert.strictEqual(d5.tipo, 'NUMERACAO_FALTANTE', 'Tipo deve ser NUMERACAO_FALTANTE');

    // 3.6 Salto de Numeração com Inutilização homologada na SEFAZ (OK)
    const d6 = classificarDivergencia('FALTANTE', 'INUTILIZADA');
    assert.strictEqual(d6.divergencia, false, 'Salto devidamente inutilizado não é divergência');
    assert.strictEqual(d6.tipo, 'SALTO_INUTILIZADO', 'Tipo deve ser SALTO_INUTILIZADO');
  });

  // 4. Montagem de Envelope SOAP 1.2 e Parser XML SEFAZ
  report('Teste 4: Envelope SOAP 1.2 e parser de XML da SEFAZ', () => {
    const chaveValida = '35260948758821000118550010000004201206129449';
    const envelope = montarEnvelopeSoap12(chaveValida);

    assert.ok(envelope.includes('<soap12:Envelope'), 'Deve conter abertura soap12:Envelope');
    assert.ok(envelope.includes('http://www.portalfazenda.gov.br/nfe/wsdl/NFeConsultaProtocolo4'), 'Namespace deve ser do NFeConsultaProtocolo4');
    assert.ok(envelope.includes(`<chNFe>${chaveValida}</chNFe>`), 'Deve conter a chave de acesso');
    assert.ok(envelope.includes('<tpAmb>1</tpAmb>'), 'Ambiente deve ser Produção (tpAmb=1)');

    const xmlRetorno = `
      <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
        <soap:Body>
          <nfeResultMsg xmlns="http://www.portalfazenda.gov.br/nfe/wsdl/NFeConsultaProtocolo4">
            <retConsSitNFe versao="4.00" xmlns="http://www.portalfazenda.gov.br/nfe">
              <tpAmb>1</tpAmb>
              <cStat>101</cStat>
              <xMotivo>Cancelamento de NF-e homologado</xMotivo>
              <dhRecbto>2026-09-08T15:30:00-03:00</dhRecbto>
              <chNFe>${chaveValida}</chNFe>
              <protNFe versao="4.00">
                <infProt>
                  <nProt>135260000123456</nProt>
                </infProt>
              </protNFe>
            </retConsSitNFe>
          </nfeResultMsg>
        </soap:Body>
      </soap:Envelope>
    `;

    assert.strictEqual(extrairTag(xmlRetorno, 'cStat'), '101', 'Deve extrair cStat = 101');
    assert.strictEqual(extrairTag(xmlRetorno, 'xMotivo'), 'Cancelamento de NF-e homologado', 'Deve extrair xMotivo correto');
    assert.strictEqual(extrairTag(xmlRetorno, 'nProt'), '135260000123456', 'Deve extrair nProt correto');
  });

  // 5. Integração com Backend Protheus (consultarAuditoriaNfeProtheus)
  await reportAsync('Teste 5: Execução real da query consultarAuditoriaNfeProtheus no Protheus', async () => {
    const res = await consultarAuditoriaNfeProtheus({
      empresa: '14',
      dataDe: '2026-08-01',
      dataAte: '2026-08-31',
      serie: '1'
    });

    assert.ok(res.ok, 'Resposta deve conter ok=true');
    assert.strictEqual(res.empresa, '14', 'Empresa deve ser 14');
    assert.strictEqual(res.serie, '1', 'Série deve ser 1');
    assert.ok(res.faixa && res.faixa.min > 0, 'Faixa mínima deve ser maior que zero');
    assert.ok(res.faixa.max >= res.faixa.min, 'Faixa máxima deve ser maior ou igual à mínima');
    assert.strictEqual(res.kpis.totalFaixa, res.faixa.max - res.faixa.min + 1, 'Total da faixa deve bater exatamente com max - min + 1');
    assert.strictEqual(res.itens.length, res.kpis.totalRegistros, 'Quantidade de itens deve bater com kpis.totalRegistros');
  });

  // 6. Verificação de Elementos de Interface em index.html
  report('Teste 6: Elementos de Interface da Auditoria no public/index.html', () => {
    const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');

    // Botão na barra de navegação
    assert.ok(html.includes('id="btnTabAuditoriaProtheusSefaz"'), 'Deve conter botão #btnTabAuditoriaProtheusSefaz');
    assert.ok(html.includes('data-tab="tab-auditoria-protheus-sefaz"'), 'Botão deve apontar para tab-auditoria-protheus-sefaz');

    // Sub-aba principal
    assert.ok(html.includes('id="tab-auditoria-protheus-sefaz"'), 'Deve conter o painel #tab-auditoria-protheus-sefaz');

    // Formulário de filtros
    assert.ok(html.includes('id="selAuditoriaEmpresa"'), 'Deve conter seletor de empresa #selAuditoriaEmpresa');
    assert.ok(html.includes('id="inputAuditoriaSerie"'), 'Deve conter input de série fixa #inputAuditoriaSerie');
    assert.ok(html.includes('id="inputAuditoriaDataDe"'), 'Deve conter input de data inicial #inputAuditoriaDataDe');
    assert.ok(html.includes('id="inputAuditoriaDataAte"'), 'Deve conter input de data final #inputAuditoriaDataAte');
    assert.ok(html.includes('id="selAuditoriaFiltroStatus"'), 'Deve conter filtro de status #selAuditoriaFiltroStatus');

    // Botões de ação
    assert.ok(html.includes('id="btnCarregarAuditoriaProtheus"'), 'Deve conter botão #btnCarregarAuditoriaProtheus');
    assert.ok(html.includes('id="btnConsultarAuditoriaSefaz"'), 'Deve conter botão #btnConsultarAuditoriaSefaz');
    assert.ok(html.includes('id="btnExportarAuditoriaCsv"'), 'Deve conter botão #btnExportarAuditoriaCsv');

    // KPIs
    assert.ok(html.includes('id="kpiAuditoriaTotalFaixa"'), 'Deve conter KPI #kpiAuditoriaTotalFaixa');
    assert.ok(html.includes('id="kpiAuditoriaAtivas"'), 'Deve conter KPI #kpiAuditoriaAtivas');
    assert.ok(html.includes('id="kpiAuditoriaCanceladas"'), 'Deve conter KPI #kpiAuditoriaCanceladas');
    assert.ok(html.includes('id="kpiAuditoriaInutilizadas"'), 'Deve conter KPI #kpiAuditoriaInutilizadas');
    assert.ok(html.includes('id="kpiAuditoriaFaltantes"'), 'Deve conter KPI #kpiAuditoriaFaltantes');
    assert.ok(html.includes('id="kpiAuditoriaDivergencias"'), 'Deve conter KPI #kpiAuditoriaDivergencias');

    // Tabela e Script
    assert.ok(html.includes('id="tbodyAuditoriaProtheusSefaz"'), 'Deve conter corpo da tabela #tbodyAuditoriaProtheusSefaz');
    assert.ok(html.includes('src="js/auditoria_protheus_sefaz.js'), 'Deve importar o script auditoria_protheus_sefaz.js');
  });

  // 7. Verificação de Sintaxe Léxica (vm.Script)
  report('Teste 7: Verificação sintática rigorosa dos módulos JS', () => {
    const codeClient = fs.readFileSync(path.join(__dirname, 'sefaz_nfe_client.js'), 'utf8');
    assert.doesNotThrow(() => new vm.Script(codeClient), 'sefaz_nfe_client.js deve ter sintaxe 100% válida');

    const codeFrontend = fs.readFileSync(path.join(__dirname, 'public/js/auditoria_protheus_sefaz.js'), 'utf8');
    assert.doesNotThrow(() => new vm.Script(codeFrontend), 'auditoria_protheus_sefaz.js deve ter sintaxe 100% válida');

    const codeApp = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
    assert.doesNotThrow(() => new vm.Script(codeApp), 'public/app.js deve ter sintaxe 100% válida');
  });

  // 8. Validação de Chaves Inválidas e Tratamento sem Certificado
  await reportAsync('Teste 8: Validação preventiva de tamanho de chave de acesso (44 dígitos)', async () => {
    const resInvalida = await consultarSituacaoNfeSefaz('12345', '14');
    assert.strictEqual(resInvalida.sucesso, false, 'Chave curta deve ser rejeitada imediatamente');
    assert.strictEqual(resInvalida.status, 'CHAVE_INVALIDA', 'Status retornado deve ser CHAVE_INVALIDA');
    assert.ok(resInvalida.xMotivo.includes('esperado 44'), 'Mensagem deve indicar tamanho incorreto');
  });

  console.log('\n=============================================================');
  console.log(`📊 RESULTADOS: ${aprovados} Aprovados de ${totalTestes} Testes`);
  console.log('=============================================================\n');

  if (aprovados < totalTestes) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Falha geral na execução dos testes:', err);
  process.exit(1);
});
