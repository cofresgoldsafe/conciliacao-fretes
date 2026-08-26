/**
 * test_serasa_pdf_parser.js
 * 
 * Suíte de Testes Automatizados para:
 * 1. Parser Serasa em Python via Buffer Memory Stream (serasa_pdf_parser.py + serasa_pdf_parser.js).
 * 2. Validação estrita de modelo oficial do Serasa Experian.
 * 3. Validação de validade máxima de 4 meses (rejeição de laudos expirados).
 * 4. Extração de métricas: Score, PD %, PEFIN, REFIN, Dívidas Vencidas, Protestos, Cheques, Sócios, Consultas/Densidade, Fomento e Extravio de Documento.
 * 5. Casos de borda: DEFAULT / Múltiplos Eventos (EQUIPSEA) e Fraude de Documento.
 * 6. Motor de cálculo de Score de Crédito Comercial com novos pesos Serasa.
 * 7. Endpoint HTTP POST /api/financeiro/analise-credito/parse-serasa-pdf.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { parseSerasaBuffer } = require('./serasa_pdf_parser');
const { calcularScore, DEFAULT_CONFIG } = require('./analise_credito_engine');

// Caminhos dos arquivos PDF reais de teste
const pdfDir = __dirname;
const wdmPdfPath = path.join(pdfDir, 'Exemplo-Serasa-WDM BRASIL ACOS LTDA  2026-08-03.pdf');
const dassPdfPath = path.join(pdfDir, 'Exemplo-Serasa-DASS NORDESTE CALCADOS E ARTIGOS ESPORTIVOS S.A  2026-07-01.pdf');
const apPdfPath = path.join(pdfDir, 'Exemplo-Serasa-AP+ELETTROLIGHT SERVICOS DE ENGENHARIA ELETRICA 2026-08-04.pdf');
const equipseaPdfPath = path.join(pdfDir, 'Exemplo-Serasa-EQUIPSEA EQUIPAMENTOS E SERVICOS INDUSTRIAIS LTDA   2026-08-04.pdf');
const optimusPdfPath = path.join(pdfDir, 'Exemplo-Serasa-OPTIMUS PHARMA MEDICAMENTOS MANIPULADOS LTDA.pdf');
const estudoPdfPath = path.join(pdfDir, 'Melhoria_Analise_Credito_PDF_Serasa.pdf');

let passedTests = 0;
let failedTests = 0;

function report(name, success, error) {
  if (success) {
    console.log(`  ✓ [PASS] ${name}`);
    passedTests++;
  } else {
    console.error(`  ❌ [FAIL] ${name}: ${error}`);
    failedTests++;
  }
}

async function runTests() {
  console.log('\n=============================================================');
  console.log('🧪 SUÍTE DE TESTES: LEITOR & VALIDADOR DE LAUDOS SERASA (PDF)');
  console.log('=============================================================\n');

  // -------------------------------------------------------------
  // Teste 1: Laudo WDM Brasil Aços (Moderno, Válido, Limpo)
  // -------------------------------------------------------------
  console.log('--- 1. Teste de Extração: WDM Brasil Aços (Moderno, Válido, Limpo) ---');
  try {
    const buffer = fs.readFileSync(wdmPdfPath);
    const result = await parseSerasaBuffer(buffer);
    
    assert.strictEqual(result.success, true, 'Laudo deve ter success: true');
    assert.strictEqual(result.validado, true, 'Laudo deve ser validado: true');
    assert.strictEqual(result.cnpj, '09.406.820/0003-14', 'CNPJ deve ser 09.406.820/0003-14');
    assert.ok(result.razao_social.includes('WDM'), 'Razão Social deve conter WDM');
    assert.strictEqual(result.score_serasa, 795, 'Score Serasa deve ser 795');
    assert.strictEqual(result.probabilidade_inadimplencia_texto, '0.62%', 'PD deve ser 0.62%');
    assert.strictEqual(result.pefin_tem, 'N', 'PEFIN deve ser N');
    assert.strictEqual(result.refin_tem, 'N', 'REFIN deve ser N');
    assert.strictEqual(result.dividas_vencidas_tem, 'N', 'Dívidas vencidas deve ser N');
    assert.strictEqual(result.protestos_tem, 'N', 'Protestos deve ser N');
    assert.strictEqual(result.cheques_tem, 'N', 'Cheques deve ser N');
    assert.strictEqual(result.socios_anotacao, 'N', 'Sócios deve ser N');
    assert.strictEqual(result.documentos_extraviados, 'N', 'Doc extraviado deve ser N');
    assert.strictEqual(result.idade_meses, 0.8, 'Idade em meses deve ser 0.8 meses');

    report('Extração WDM Brasil Aços', true);
  } catch (err) {
    report('Extração WDM Brasil Aços', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 2: Laudo DASS Nordeste (Score 638, PEFIN 755 e Dívidas 340)
  // -------------------------------------------------------------
  console.log('\n--- 2. Teste de Extração: DASS Nordeste Calçados (Score 638, PEFIN R$ 755) ---');
  try {
    const buffer = fs.readFileSync(dassPdfPath);
    const result = await parseSerasaBuffer(buffer);
    
    assert.strictEqual(result.success, true, 'Laudo deve ter success: true');
    assert.strictEqual(result.validado, true, 'Laudo deve ser validado: true');
    assert.strictEqual(result.cnpj, '01.287.588/0001-79', 'CNPJ deve ser 01.287.588/0001-79');
    assert.ok(result.razao_social.includes('DASS'), 'Razão Social deve conter DASS');
    assert.strictEqual(result.score_serasa, 638, 'Score Serasa deve ser 638');
    assert.strictEqual(result.pefin_tem, 'S', 'PEFIN deve ser S');
    assert.strictEqual(result.pefin_qtd, 1, 'PEFIN qtd deve ser 1');
    assert.strictEqual(result.pefin_valor, 755.03, 'PEFIN valor deve ser 755.03');
    assert.strictEqual(result.dividas_vencidas_tem, 'S', 'Dívidas vencidas deve ser S');
    assert.strictEqual(result.dividas_vencidas_valor, 340, 'Dívidas vencidas valor deve ser 340');
    assert.strictEqual(result.protestos_tem, 'N', 'Protestos deve ser N');
    assert.strictEqual(result.idade_meses, 1.8, 'Idade deve ser 1.8 meses');

    report('Extração DASS Nordeste', true);
  } catch (err) {
    report('Extração DASS Nordeste', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 3: Laudo AP Elettro Light (Score 374, PEFIN R$ 5.126, Alta Densidade 4.5/dia, Fomento)
  // -------------------------------------------------------------
  console.log('\n--- 3. Teste de Extração: AP Elettro Light (Score 374, PEFIN, Densidade 4.5/dia) ---');
  try {
    const buffer = fs.readFileSync(apPdfPath);
    const result = await parseSerasaBuffer(buffer);
    
    assert.strictEqual(result.success, true, 'Laudo deve ter success: true');
    assert.strictEqual(result.validado, true, 'Laudo deve ser validado: true');
    assert.strictEqual(result.cnpj, '34.892.283/0001-45', 'CNPJ deve ser 34.892.283/0001-45');
    assert.strictEqual(result.score_serasa, 374, 'Score Serasa deve ser 374');
    assert.strictEqual(result.pefin_tem, 'S', 'PEFIN deve ser S');
    assert.strictEqual(result.pefin_qtd, 1, 'PEFIN qtd deve ser 1');
    assert.strictEqual(result.pefin_valor, 5126.26, 'PEFIN valor deve ser 5126.26');
    assert.strictEqual(result.refin_tem, 'N', 'REFIN deve ser N');
    assert.strictEqual(result.consultas_total, 9, 'Consultas total deve ser 9');
    assert.strictEqual(result.consultas_janela_dias, 2, 'Janela de dias deve ser 2');
    assert.strictEqual(result.consultas_densidade_dia, 4.5, 'Densidade deve ser 4.5 consultas/dia');
    assert.strictEqual(result.consultantes_fomento, 'S', 'Deve detectar consultante de fomento (C & J FOMENTO)');

    report('Extração AP Elettro Light & Densidade Consultas', true);
  } catch (err) {
    report('Extração AP Elettro Light & Densidade Consultas', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 4: Laudo EQUIPSEA Indl. (DEFAULT, 219 Protestos R$ 33,3M)
  // -------------------------------------------------------------
  console.log('\n--- 4. Teste de Extração: EQUIPSEA Indl. (DEFAULT, 219 Protestos R$ 33,3M) ---');
  try {
    const buffer = fs.readFileSync(equipseaPdfPath);
    const result = await parseSerasaBuffer(buffer);
    
    assert.strictEqual(result.success, true, 'Laudo deve ter success: true');
    assert.strictEqual(result.validado, true, 'Laudo deve ser validado: true');
    assert.strictEqual(result.is_default, true, 'Deve identificar estado DEFAULT');
    assert.strictEqual(result.score_serasa_texto, 'DEFAULT / Múltiplos Eventos', 'Score texto deve indicar DEFAULT');
    assert.strictEqual(result.protestos_tem, 'S', 'Protestos deve ser S');
    assert.strictEqual(result.protestos_qtd, 219, 'Protestos qtd deve ser 219');
    assert.strictEqual(result.protestos_valor, 33369466.95, 'Protestos valor deve ser R$ 33.369.466,95');
    assert.strictEqual(result.pefin_tem, 'N', 'PEFIN deve ser N');
    assert.strictEqual(result.refin_tem, 'N', 'REFIN deve ser N');
    assert.strictEqual(result.dividas_vencidas_tem, 'N', 'Dívidas vencidas deve ser N');
    assert.strictEqual(result.cheques_tem, 'N', 'Cheques sem fundo deve ser N');
    assert.strictEqual(result.consultantes_fomento, 'S', 'Deve detectar consultante de fomento (NOVA S.R.M., DAVOS)');

    report('Extração EQUIPSEA & DEFAULT', true);
  } catch (err) {
    report('Extração EQUIPSEA & DEFAULT', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 4B: Laudo Itambé Minas (Score 608, 169 PEFIN, 4 Protestos, 19 Dívidas)
  // -------------------------------------------------------------
  console.log('\n--- 4B. Teste de Extração: Itambé Minas (Score 608, 169 PEFIN, 4 Protestos, 19 Dívidas) ---');
  try {
    const itambePdfPath = path.join(pdfDir, 'ITAMBE MINAS COMERCIO E DISTRIBUICAO DE ALIMENTOS LTDA 2026-08-07.pdf');
    if (fs.existsSync(itambePdfPath)) {
      const buffer = fs.readFileSync(itambePdfPath);
      const result = await parseSerasaBuffer(buffer);
      
      assert.strictEqual(result.success, true, 'Laudo deve ter success: true');
      assert.strictEqual(result.validado, true, 'Laudo deve ser validado: true');
      assert.strictEqual(result.cnpj, '16.849.231/0027-43', 'CNPJ deve ser 16.849.231/0027-43');
      assert.strictEqual(result.score_serasa, 608, 'Score deve ser 608');
      assert.strictEqual(result.pefin_qtd, 169, 'PEFIN deve ter 169 registros');
      assert.strictEqual(result.pefin_valor, 182628.08, 'PEFIN total R$ 182.628,08');
      assert.strictEqual(result.protestos_qtd, 4, 'Protestos qtd deve ser 4');
      assert.strictEqual(result.protestos_valor, 6133.78, 'Protestos valor R$ 6.133,78');
      assert.strictEqual(result.dividas_vencidas_qtd, 19, 'Dívidas vencidas qtd deve ser 19');
      assert.strictEqual(result.consultantes_fomento, 'S', 'Deve detectar fomento (LEAN SECURITIZADORA)');
      assert.strictEqual(result.idade_meses, 0.6, 'Idade deve ser 0.6 meses');

      report('Extração Itambé Minas', true);
    } else {
      console.log('  ⚠️ Arquivo Itambé Minas não encontrado no diretório.');
    }
  } catch (err) {
    report('Extração Itambé Minas', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 4C: Laudo Prevent Senior (Score 666, 5 PEFIN R$ 486k, 24 Dívidas Vencidas R$ 54k, 1 Protesto R$ 2.106, Fomento)
  // -------------------------------------------------------------
  console.log('\n--- 4C. Teste de Extração: Prevent Senior (Score 666, 5 PEFIN, 24 Dívidas, 1 Protesto) ---');
  try {
    const preventPdfPath = path.join(pdfDir, 'PREVENT SENIOR ATENDIMENTO A SAUDE LTDA 2026-07-07.pdf');
    if (fs.existsSync(preventPdfPath)) {
      const buffer = fs.readFileSync(preventPdfPath);
      const result = await parseSerasaBuffer(buffer);
      
      assert.strictEqual(result.success, true, 'Laudo deve ter success: true');
      assert.strictEqual(result.validado, true, 'Laudo deve ser validado: true');
      assert.strictEqual(result.cnpj, '00.461.479/0001-63', 'CNPJ deve ser 00.461.479/0001-63');
      assert.ok(result.razao_social.includes('PREVENT SENIOR'), 'Razão Social deve conter PREVENT SENIOR');
      assert.strictEqual(result.score_serasa, 666, 'Score deve ser 666');
      assert.strictEqual(result.pefin_qtd, 5, 'PEFIN deve ter 5 registros');
      assert.strictEqual(result.pefin_valor, 486002.67, 'PEFIN total R$ 486.002,67');
      assert.strictEqual(result.protestos_qtd, 1, 'Protestos qtd deve ser 1');
      assert.strictEqual(result.protestos_valor, 2106.19, 'Protestos valor R$ 2.106,19');
      assert.strictEqual(result.dividas_vencidas_qtd, 24, 'Dívidas vencidas qtd deve ser 24');
      assert.strictEqual(result.dividas_vencidas_valor, 54672.85, 'Dívidas vencidas valor R$ 54.672,85');
      assert.strictEqual(result.consultantes_fomento, 'S', 'Deve detectar fomento (REDFACTOR FACTORING)');
      assert.strictEqual(result.idade_meses, 1.6, 'Idade deve ser 1.6 meses');

      report('Extração Prevent Senior', true);
    } else {
      console.log('  ⚠️ Arquivo Prevent Senior não encontrado no diretório.');
    }
  } catch (err) {
    report('Extração Prevent Senior', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 5: Rejeição de Laudo Expirado > 4 Meses (Optimus Pharma)
  // -------------------------------------------------------------
  console.log('\n--- 5. Teste de Validação de Validade: Optimus Pharma (Expirado > 4 meses) ---');
  try {
    const buffer = fs.readFileSync(optimusPdfPath);
    const result = await parseSerasaBuffer(buffer);
    
    assert.strictEqual(result.success, false, 'Laudo expirado deve ter success: false');
    assert.strictEqual(result.error_type, 'LAUDO_EXPIRADO', 'Tipo de erro deve ser LAUDO_EXPIRADO');
    assert.ok(result.error.includes('4 meses') || result.error.includes('EXPIRADO'), 'Erro deve mencionar 4 meses/expirado');
    assert.strictEqual(result.idade_meses, 24.3, 'Idade em meses deve ser 24.3 meses');

    report('Rejeição Laudo Expirado (> 4 meses)', true);
  } catch (err) {
    report('Rejeição Laudo Expirado (> 4 meses)', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 6: Rejeição de Arquivo Não-Serasa
  // -------------------------------------------------------------
  console.log('\n--- 6. Teste de Validação de Modelo: PDF Não-Serasa ---');
  try {
    const buffer = fs.readFileSync(estudoPdfPath);
    const result = await parseSerasaBuffer(buffer);
    
    assert.strictEqual(result.success, false, 'PDF não-serasa deve ter success: false');
    assert.strictEqual(result.error_type, 'MODELO_INVALIDO', 'Tipo de erro deve ser MODELO_INVALIDO');
    assert.ok(result.error.includes('NÃO é um Relatório Oficial Serasa'), 'Erro deve mencionar modelo inválido');

    report('Rejeição PDF Não-Serasa', true);
  } catch (err) {
    report('Rejeição PDF Não-Serasa', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 7: Motor de Score de Crédito com Novos Pesos Serasa
  // -------------------------------------------------------------
  console.log('\n--- 7. Teste de Score de Crédito com Novos Pesos Serasa ---');
  try {
    // Cenário A: Empresa com Serasa DEFAULT (EQUIPSEA) -> Bloqueio imediato Só À Vista
    const calcDefault = calcularScore({
      empresa: '14',
      pedido_venda: '000100',
      total_pedido: 15000,
      faturado: 'S',
      entrada: 'N',
      score_serasa: 'DEFAULT',
      is_default: true,
      protestos: 'S',
      valor_protestos: 33000000,
      capital_social: 100000,
      pfin: 'S',
      refin: 'S',
      dividas_vencidas: 'S',
      socios_anotacao: 'S'
    });
    assert.strictEqual(calcDefault.risco, 'ALTO-RISCO-DEFAULT', 'Risco de DEFAULT deve ser ALTO-RISCO-DEFAULT');
    assert.strictEqual(calcDefault.sugestao, 'SÓ À VISTA / PAGAMENTO ANTECIPADO', 'Sugestão deve ser SÓ À VISTA');
    assert.strictEqual(calcDefault.detalhesPontos.score_serasa, -30, 'Pontos de DEFAULT deve ser -30');
    assert.strictEqual(calcDefault.detalhesPontos.refin, -10, 'Pontos de REFIN deve ser -10');
    assert.strictEqual(calcDefault.detalhesPontos.dividas_vencidas, -4, 'Pontos de dívidas vencidas deve ser -4');
    assert.strictEqual(calcDefault.detalhesPontos.socios_anotacao, -6, 'Pontos de sócios com restrição deve ser -6');

    // Cenário B: Empresa com Documento Extraviado -> Bloqueio por Fraude
    const calcFraude = calcularScore({
      empresa: '14',
      pedido_venda: '000101',
      total_pedido: 8000,
      faturado: 'S',
      score_serasa: '850',
      documentos_extraviados: 'S'
    });
    assert.strictEqual(calcFraude.risco, 'FRAUDE-DOCUMENTO', 'Risco deve ser FRAUDE-DOCUMENTO');
    assert.strictEqual(calcFraude.detalhesPontos.doc_extraviado, -25, 'Penalidade de doc extraviado deve ser -25');

    // Cenário C: Golpista com Serasa Limpo mas Indicadores Digitais/Cadastrais Falsos
    const calcGolpista = calcularScore({
      empresa: '14',
      pedido_venda: '000102',
      total_pedido: 28000,
      faturado: 'S',
      entrada: 'N',
      quant_grande: 'S',
      prod_nao_combinam: 'S',
      uf_cliente: 'RJ',
      entrega_igual_cadastro: 'N',
      google_maps: '0',
      possui_site: 'N',
      email_corporativo: 'N',
      mail_gratuito: 'S',
      score_serasa: '795', // Serasa limpo da empresa antiga comprada
      protestos: 'N',
      pfin: 'N'
    });
    assert.strictEqual(calcGolpista.risco, 'GOLPE', 'Mesmo com Serasa limpo, deve ser classificado como GOLPE');
    assert.ok(calcGolpista.totalScore < -20, 'Score total deve ser fortemente negativo devido a penalidades digitais');

    report('Cálculo de Score & Travas de Segurança Serasa', true);
  } catch (err) {
    report('Cálculo de Score & Travas de Segurança Serasa', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 8: Integração HTTP Endpoint POST /api/financeiro/analise-credito/parse-serasa-pdf
  // -------------------------------------------------------------
  console.log('\n--- 8. Teste de Endpoint HTTP: POST /api/financeiro/analise-credito/parse-serasa-pdf ---');
  try {
    const app = require('./server');
    const server = http.createServer(app);
    await new Promise(res => server.listen(0, res));
    const port = server.address().port;

    const testPdfBuffer = fs.readFileSync(wdmPdfPath);
    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    
    let body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="serasa_pdf"; filename="wdm.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      testPdfBuffer,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const res = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: port,
        path: '/api/financeiro/analise-credito/parse-serasa-pdf',
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length
        }
      }, (r) => {
        let data = '';
        r.on('data', chunk => data += chunk);
        r.on('end', () => resolve({ statusCode: r.statusCode, data: JSON.parse(data) }));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    server.close();

    assert.strictEqual(res.statusCode, 200, 'Status code HTTP deve ser 200');
    assert.strictEqual(res.data.success, true, 'Resposta deve indicar success: true');
    assert.strictEqual(res.data.data.cnpj, '09.406.820/0003-14', 'CNPJ deve ser extraído corretamente no HTTP');
    assert.strictEqual(res.data.data.score_serasa, 795, 'Score deve ser 795 no HTTP');

    report('Endpoint HTTP /parse-serasa-pdf', true);
  } catch (err) {
    report('Endpoint HTTP /parse-serasa-pdf', false, err.message);
  }

  // -------------------------------------------------------------
  // Resumo Final
  // -------------------------------------------------------------
  console.log('\n=============================================================');
  console.log(`📊 RESUMO DA EXECUÇÃO: ${passedTests} Aprovados, ${failedTests} Falhas`);
  console.log('=============================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests();
