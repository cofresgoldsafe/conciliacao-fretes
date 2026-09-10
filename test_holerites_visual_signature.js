/**
 * test_holerites_visual_signature.js - Suíte de Testes Automatizados para:
 * 1. Renomeação da Sub-aba para "Holerites DP"
 * 2. Disponibilidade perene do Logo OAÇO & GSI (Base64 síncrono)
 * 3. Espaçamento amplo ("bem mais pra baixo") e layout centralizado para assinaturas digitais
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const vm = require('vm');

console.log('=============================================================');
console.log('🧪 SUÍTE DE TESTES: HOLERITES DP & ASSINATURA DIGITAL');
console.log('=============================================================');

let passed = 0;
let failed = 0;

function report(name, ok, err = null) {
  if (ok) {
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } else {
    console.log(`  ❌ [FAIL] ${name}: ${err}`);
    failed++;
  }
}

// 1. Validação do Nome da Aba no HTML
try {
  console.log('\n--- 1. Validação do Nome da Sub-aba Holerites DP ---');
  const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf-8');
  
  // Verifica botão da sub-aba
  const btnMatch = html.match(/id="btnTabHolerites"[^>]*>([\s\S]*?)<\/button>/);
  assert.ok(btnMatch, 'Deve conter botão #btnTabHolerites');
  assert.ok(btnMatch[1].includes('Holerites DP'), 'Botão deve conter o texto "Holerites DP"');
  assert.ok(!btnMatch[1].includes('Documentos DP'), 'Botão NÃO deve mais conter "Documentos DP"');

  // Verifica cabeçalho da seção
  assert.ok(html.includes('Gestão & Emissão de Holerites DP'), 'Título da seção deve exibir Holerites DP');

  report('Sub-aba e títulos atualizados com sucesso para "Holerites DP"', true);
} catch (err) {
  report('Sub-aba e títulos atualizados com sucesso para "Holerites DP"', false, err.message);
}

// 2. Validação dos Logos Base64 e Resiliência no JS
try {
  console.log('\n--- 2. Validação dos Logos Oficiais Base64 (OAÇO e GSI) ---');
  const js = fs.readFileSync(path.join(__dirname, 'public', 'js', 'holerites.js'), 'utf-8');

  assert.ok(js.includes('LOGO_GSI_B64'), 'holerites.js deve conter LOGO_GSI_B64');
  assert.ok(js.includes('LOGO_OACO_B64'), 'holerites.js deve conter LOGO_OACO_B64');
  assert.ok(js.includes('data:image/png;base64,'), 'Logos devem ser Data URIs em Base64');

  // Validação no sandbox JS
  const context = {
    window: {},
    document: {
      readyState: 'complete',
      getElementById: () => null,
      addEventListener: () => {}
    },
    localStorage: { getItem: () => null }
  };
  vm.createContext(context);
  vm.runInContext(js, context);

  assert.ok(context.window.holeritesModule, 'holeritesModule deve estar registrado em window');
  assert.strictEqual(typeof context.window.holeritesModule.gerarHoleriteHtml, 'function', 'gerarHoleriteHtml deve ser exportada');

  // Teste com OACO Adiantamento
  const htmlOaco = context.window.holeritesModule.gerarHoleriteHtml({
    id: 1,
    empresa: 'OACO',
    empresa_razao_social: 'OACO PRODUTOS DE ACO LTDA',
    empresa_cnpj: '61.237.790/0001-18',
    tipo_documento: 'ADIANTAMENTO',
    funcionario_nome: 'WILLIAM CONCEICAO PINHEIRO',
    total_vencimentos: 840,
    total_descontos: 0,
    valor_liquido: 840
  });

  assert.ok(htmlOaco.includes('data:image/png;base64,'), 'HTML da OAÇO deve renderizar o logo Base64');
  assert.ok(htmlOaco.includes('alt="Logo OAÇO"'), 'HTML da OAÇO deve ter alt com identificação da OAÇO');
  assert.ok(htmlOaco.includes('OACO PRODUTOS DE ACO LTDA'), 'HTML da OAÇO deve exibir razão social correta');

  // Teste com GSI Salário
  const htmlGsi = context.window.holeritesModule.gerarHoleriteHtml({
    id: 2,
    empresa: 'GSI',
    tipo_documento: 'FOLHA_MENSAL',
    funcionario_nome: 'ALEXANDRE RODRIGUES ARRAIS',
    total_vencimentos: 4748.8,
    total_descontos: 295.62,
    valor_liquido: 4453.18
  });

  assert.ok(htmlGsi.includes('data:image/png;base64,'), 'HTML da GSI deve renderizar o logo Base64');
  assert.ok(htmlGsi.includes('alt="Logo GSI"'), 'HTML da GSI deve ter alt com identificação da GSI');

  report('Logos Base64 da OAÇO e GSI injetados e renderizados de forma síncrona e perene', true);
} catch (err) {
  report('Logos Base64 da OAÇO e GSI injetados e renderizados de forma síncrona e perene', false, err.message);
}

// 3. Validação do Espaçamento de Assinatura e Centralização no CSS
try {
  console.log('\n--- 3. Validação do Espaçamento de Assinatura e Centralização ---');
  const css = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf-8');

  // holerite-canhoto-linhas
  assert.ok(css.includes('.holerite-canhoto-linhas'), 'Deve definir classe .holerite-canhoto-linhas');
  const canhotoLinhasMatch = css.match(/\.holerite-canhoto-linhas\s*\{([\s\S]*?)\}/);
  assert.ok(canhotoLinhasMatch, 'Deve capturar bloco .holerite-canhoto-linhas');
  const canhotoLinhasContent = canhotoLinhasMatch[1];

  // Verifica margem generosa (pelo menos 60px a 80px)
  const marginMatch = canhotoLinhasContent.match(/margin:\s*(\d+)px/);
  assert.ok(marginMatch, 'Deve conter margem em pixels');
  const marginTopPx = parseInt(marginMatch[1], 10);
  assert.ok(marginTopPx >= 60, `Margem superior deve ser generosa (>= 60px para assinatura digital), obtido: ${marginTopPx}px`);

  // Verifica centralização (margin auto e max-width definido)
  assert.ok(canhotoLinhasContent.includes('auto'), 'Margem deve ter auto para centralização');
  assert.ok(canhotoLinhasContent.includes('max-width'), 'Deve conter max-width para não colar nas bordas');

  // holerite-linha-assinatura
  assert.ok(css.includes('.holerite-linha-assinatura'), 'Deve definir .holerite-linha-assinatura');
  const linhaAssMatch = css.match(/\.holerite-linha-assinatura\s*\{([\s\S]*?)\}/);
  assert.ok(linhaAssMatch, 'Deve capturar .holerite-linha-assinatura');
  const linhaAssContent = linhaAssMatch[1];
  assert.ok(linhaAssContent.includes('border-top'), 'Deve ter traço de assinatura superior');
  assert.ok(linhaAssContent.includes('text-align: center'), 'Nome deve ser centralizado sob o traço');

  // Regras de impressão
  const mediaPrintIdx = css.lastIndexOf('@media print');
  assert.ok(mediaPrintIdx !== -1, 'Deve conter @media print');
  const printContent = css.substring(mediaPrintIdx, mediaPrintIdx + 1200);
  assert.ok(printContent.includes('.holerite-canhoto-linhas'), '@media print deve conter regras para .holerite-canhoto-linhas');
  assert.ok(printContent.includes('margin: 24mm auto') || printContent.includes('max-width: 160mm'), 'Impressão deve manter margem generosa e centralização em milímetros');

  report('Espaçamento vertical generoso e layout centralizado para plataformas de assinatura digital validados', true);
} catch (err) {
  report('Espaçamento vertical generoso e layout centralizado para plataformas de assinatura digital validados', false, err.message);
}

console.log('\n=============================================================');
console.log(`📊 RESULTADOS: ${passed} Aprovados, ${failed} Falhas`);
console.log('=============================================================');

if (failed > 0) {
  process.exit(1);
}
