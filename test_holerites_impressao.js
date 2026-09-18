/**
 * test_holerites_impressao.js
 * 
 * Suíte de Testes Automatizados para Impressão e Exportação em PDF de Holerites:
 * 1. Validação estática de regras @media print no public/style.css.
 * 2. Validação dinâmica E2E (Playwright Headless Chromium) sob @media print:
 *    - Visibilidade de #modalHoleritePreview e elementos internos (sem tela em branco).
 *    - Renderização de holerite individual em ESTRITAMENTE 1 PÁGINA (eliminação da 2ª página vazia).
 *    - Ocultação de elementos decorativos (.modal-header-tools, .no-print, header, main).
 *    - Paginação de holerites em lote (N documentos = N páginas exatas, sem página órfã no final).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const pypdf = require('child_process');

let passedTests = 0;
let failedTests = 0;

function report(name, success, error) {
  if (success) {
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } else {
    console.error(`  ❌ [FAIL] ${name}: ${error}`);
    failedTests++;
  }
}

async function runHoleritePrintTests() {
  console.log('\n=============================================================');
  console.log('🖨️ SUÍTE DE TESTES: IMPRESSÃO & PDF DE HOLERITES E RECIBOS');
  console.log('=============================================================\n');

  // 1. Validação de Regras CSS (@media print)
  try {
    console.log('--- 1. Validação Estrutural de CSS (@media print) ---');
    const css = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf-8');

    assert.ok(css.includes('#modalHoleritePreview'), 'Deve conter seletores para #modalHoleritePreview');
    assert.ok(css.includes('#holeriteDocumentoContainer'), 'Deve conter seletores para #holeriteDocumentoContainer');
    assert.ok(css.includes('.holerite-folha-a4:last-child'), 'Deve conter regra para .holerite-folha-a4:last-child evitando quebra de página órfã');
    assert.ok(css.includes('page-break-after: auto !important') || css.includes('break-after: auto !important'), 'Deve desativar break-after no último holerite');
    assert.ok(css.includes('page-break-inside: avoid !important') || css.includes('break-inside: avoid !important'), 'Deve evitar quebra no interior do holerite');
    assert.ok(css.includes('imprimindo-holerite'), 'Deve conter classe imprimindo-holerite para isolamento');

    report('Regras de CSS @media print configuradas para conter visibilidade e paginação', true);
  } catch (err) {
    report('Regras de CSS @media print configuradas para conter visibilidade e paginação', false, err.message);
  }

  // 2. Testes E2E com Playwright em Modo de Impressão
  let browser = null;
  try {
    console.log('\n--- 2. Validação E2E com Chromium em Mídia de Impressão (Print Media) ---');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    const htmlPath = 'file://' + path.resolve(__dirname, 'public', 'index.html').replace(/\\/g, '/');
    await page.goto(htmlPath);

    // Carrega holerites.js
    const holeritesJs = fs.readFileSync(path.join(__dirname, 'public', 'js', 'holerites.js'), 'utf-8');
    await page.evaluate((code) => {
      window.eval(code);
    }, holeritesJs);

    // Teste 2.1: Holerite Individual (Caso Real Luiz Claudio Figueiredo)
    await page.evaluate(() => {
      const doc = {
        id: 999,
        empresa: 'SEM_REGISTRO',
        origem_arquivo_tipo: 'MANUAL_PF',
        funcionario_codigo: 'SEM_REG',
        funcionario_nome: 'LUIZ CLAUDIO FIGUEIREDO',
        funcionario_departamento: '1',
        funcionario_filial: '1',
        funcionario_cargo: 'Vendedor',
        funcionario_tipo_contrato: 'Sem Registro',
        funcionario_cbo: '-',
        funcionario_cpf: '262.496.668-42',
        tipo_documento: 'ADIANTAMENTO',
        competencia_mes: '10',
        competencia_ano: '2026',
        competencia_formatada: 'Outubro de 2026',
        data_pagamento: '18/09/2026',
        eventos: [
          { codigo: '001', descricao: 'Recibo de Adiantamento Salarial', referencia: '1,00', vencimento: '1000.00', desconto: '0.00' }
        ],
        total_vencimentos: 1000.0,
        total_descontos: 0.0,
        valor_liquido: 1000.0,
        valor_liquido_extenso: 'Mil reais'
      };

      const modal = document.getElementById('modalHoleritePreview');
      const container = document.getElementById('holeriteDocumentoContainer');
      modal.style.display = 'flex';
      document.body.classList.add('imprimindo-holerite');
      container.innerHTML = `
        <div class="no-print">BARRA PIX</div>
        <div class="no-print">BARRA RECADO</div>
        ${window.holeritesModule.gerarHoleriteHtml(doc)}
      `;
    });

    await page.emulateMedia({ media: 'print' });

    // Avalia estilos computados sob impressão
    const compStyles = await page.evaluate(() => {
      const modal = document.getElementById('modalHoleritePreview');
      const container = document.getElementById('holeriteDocumentoContainer');
      const folha = document.querySelector('.holerite-folha-a4');
      const headerTools = document.querySelector('.modal-header-tools');
      const noPrintEl = document.querySelector('.no-print');
      const title = document.querySelector('.holerite-folha-a4 h2');

      return {
        modalVisible: window.getComputedStyle(modal).visibility,
        containerVisible: window.getComputedStyle(container).visibility,
        titleVisible: window.getComputedStyle(title).visibility,
        headerToolsDisplay: window.getComputedStyle(headerTools).display,
        noPrintDisplay: window.getComputedStyle(noPrintEl).display,
        folhaPageBreakAfter: window.getComputedStyle(folha).pageBreakAfter,
        folhaBreakAfter: window.getComputedStyle(folha).breakAfter
      };
    });

    assert.strictEqual(compStyles.modalVisible, 'visible', 'Modal deve estar visível sob impressão');
    assert.strictEqual(compStyles.containerVisible, 'visible', 'Container deve estar visível sob impressão');
    assert.strictEqual(compStyles.titleVisible, 'visible', 'Título do documento deve estar visível sob impressão');
    assert.strictEqual(compStyles.headerToolsDisplay, 'none', 'Botões de ação do modal devem ser ocultados na impressão');
    assert.strictEqual(compStyles.noPrintDisplay, 'none', 'Elementos .no-print devem ser ocultados na impressão');
    assert.strictEqual(compStyles.folhaBreakAfter, 'auto', 'Único holerite não deve forçar break-after');
    report('Estilos computados do holerite em modo de impressão validados (visibilidade ativa e chrome oculto)', true);

    // Gera PDF do holerite individual
    const singlePdfPath = path.join(__dirname, 'test_holerite_single.pdf');
    const singlePdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
    fs.writeFileSync(singlePdfPath, singlePdfBuffer);

    // Valida PDF com script Python (pypdf)
    const pythonCodeSingle = [
      'import pypdf, sys, re',
      'reader = pypdf.PdfReader(sys.argv[1])',
      'pages = len(reader.pages)',
      'txt = reader.pages[0].extract_text() if pages > 0 else ""',
      'clean_txt = re.sub(r"\\s+", "", txt)',
      'has_title = "RECIBODEPAGAMENTO" in clean_txt',
      'has_name = "LUIZCLAUDIOFIGUEIREDO" in clean_txt',
      'has_extenso = "Milreais" in clean_txt',
      'print(f"{pages}|{len(txt)}|{has_title}|{has_name}|{has_extenso}")'
    ].join('\n');

    const pySingleResult = pypdf.execFileSync('python', ['-c', pythonCodeSingle, singlePdfPath], { encoding: 'utf-8' }).trim();

    const [numPages, txtLen, hasTitle, hasName, hasExtenso] = pySingleResult.split('|');
    assert.strictEqual(numPages, '1', `PDF individual deve ter ESTRITAMENTE 1 página (obtido: ${numPages})`);
    assert.ok(parseInt(txtLen, 10) > 500, 'PDF não pode estar em branco (deve conter texto legível)');
    assert.strictEqual(hasTitle, 'True', 'PDF deve conter título RECIBO DE PAGAMENTO');
    assert.strictEqual(hasName, 'True', 'PDF deve conter nome LUIZ CLAUDIO FIGUEIREDO');
    assert.strictEqual(hasExtenso, 'True', 'PDF deve conter valor por extenso Mil reais');
    report('PDF de holerite individual gerado com sucesso em ESTRITAMENTE 1 página e com dados completos (sem tela em branco)', true);

    // Teste 2.2: Holerites em Lote (2 colaboradores)
    await page.evaluate(() => {
      const doc1 = {
        id: 1,
        empresa: 'SEM_REGISTRO',
        origem_arquivo_tipo: 'MANUAL_PF',
        funcionario_nome: 'LUIZ CLAUDIO FIGUEIREDO',
        tipo_documento: 'ADIANTAMENTO',
        valor_liquido: 1000.0,
        valor_liquido_extenso: 'Mil reais'
      };
      const doc2 = {
        id: 2,
        empresa: 'OACO',
        funcionario_nome: 'WILLIAM CONCEICAO',
        tipo_documento: 'SALARIO',
        valor_liquido: 2500.0,
        valor_liquido_extenso: 'Dois mil e quinhentos reais'
      };

      const container = document.getElementById('holeriteDocumentoContainer');
      container.innerHTML = window.holeritesModule.gerarHoleriteHtml(doc1) + window.holeritesModule.gerarHoleriteHtml(doc2);
    });

    const batchPdfPath = path.join(__dirname, 'test_holerite_batch.pdf');
    const batchPdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
    fs.writeFileSync(batchPdfPath, batchPdfBuffer);

    const pythonCodeBatch = [
      'import pypdf, sys, re',
      'reader = pypdf.PdfReader(sys.argv[1])',
      'pages = len(reader.pages)',
      'txt1 = reader.pages[0].extract_text() if pages > 0 else ""',
      'txt2 = reader.pages[1].extract_text() if pages > 1 else ""',
      'has_doc1 = "LUIZCLAUDIOFIGUEIREDO" in re.sub(r"\\s+", "", txt1)',
      'has_doc2 = "WILLIAMCONCEICAO" in re.sub(r"\\s+", "", txt2)',
      'print(f"{pages}|{has_doc1}|{has_doc2}")'
    ].join('\n');

    const pyBatchResult = pypdf.execFileSync('python', ['-c', pythonCodeBatch, batchPdfPath], { encoding: 'utf-8' }).trim();

    const [batchPages, hasDoc1, hasDoc2] = pyBatchResult.split('|');
    assert.strictEqual(batchPages, '2', `PDF em lote de 2 colaboradores deve ter ESTRITAMENTE 2 páginas (obtido: ${batchPages})`);
    assert.strictEqual(hasDoc1, 'True', 'Página 1 deve conter Colaborador 1');
    assert.strictEqual(hasDoc2, 'True', 'Página 2 deve conter Colaborador 2');
    report('PDF de holerites em lote gerado com sucesso com 1 página exata por colaborador (sem páginas vazias excedentes)', true);

    // Limpeza de arquivos temporários de teste
    try { fs.unlinkSync(singlePdfPath); } catch (e) {}
    try { fs.unlinkSync(batchPdfPath); } catch (e) {}
    try { fs.unlinkSync('test_output_before.pdf'); } catch (e) {}
    try { fs.unlinkSync('test_output_before_full.pdf'); } catch (e) {}
    try { fs.unlinkSync('test_output_after.pdf'); } catch (e) {}
    try { fs.unlinkSync('test_output_batch.pdf'); } catch (e) {}
    try { fs.unlinkSync('test_print_reproduce.js'); } catch (e) {}
    try { fs.unlinkSync('test_print_fix_verification.js'); } catch (e) {}
    try { fs.unlinkSync('debug_crop_top.png'); } catch (e) {}
    try { fs.unlinkSync('debug_crop_bottom.png'); } catch (e) {}

    await browser.close();
  } catch (err) {
    if (browser) await browser.close();
    report('Validação E2E com Playwright em modo de impressão', false, err.message);
  }

  console.log('\n=============================================================');
  console.log(`📊 RESULTADOS: ${passedTests} Aprovados, ${failedTests} Falhas`);
  console.log('=============================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runHoleritePrintTests();
