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

  // Verifica margem generosa (144px, aumentado em 80% em relação aos 80px anteriores para folga de assinatura eletrônica)
  const marginMatch = canhotoLinhasContent.match(/margin:\s*(\d+)px/);
  assert.ok(marginMatch, 'Deve conter margem em pixels');
  const marginTopPx = parseInt(marginMatch[1], 10);
  assert.ok(marginTopPx >= 140, `Margem superior deve ser de 144px (+80% para ZapSign/assinatura digital), obtido: ${marginTopPx}px`);

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
  assert.ok(printContent.includes('margin: 32mm auto') || printContent.includes('max-width: 160mm'), 'Impressão deve manter margem de 32mm (+80%) e centralização em milímetros');

  report('Espaçamento vertical generoso e layout centralizado para plataformas de assinatura digital validados', true);
} catch (err) {
  report('Espaçamento vertical generoso e layout centralizado para plataformas de assinatura digital validados', false, err.message);
}

// 4. Validação da Tabela de Eventos com Subtotais e Valor Líquido no Rodapé (Padrão Clássico)
try {
  console.log('\n--- 4. Validação da Tabela de Lançamentos com Subtotais e Valor Líquido ---');
  const js = fs.readFileSync(path.join(__dirname, 'public', 'js', 'holerites.js'), 'utf-8');
  const css = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf-8');

  // Executa no sandbox JS
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

  // Amostra 1: Recibo de Adiantamento Salarial (OAÇO)
  const htmlAdiantamento = context.window.holeritesModule.gerarHoleriteHtml({
    id: 101,
    empresa: 'OACO',
    empresa_razao_social: 'OACO PRODUTOS DE ACO LTDA',
    tipo_documento: 'ADIANTAMENTO',
    funcionario_nome: 'WILLIAM CONCEICAO PINHEIRO',
    total_vencimentos: 848.00,
    total_descontos: 0.00,
    valor_liquido: 848.00,
    eventos: [
      { codigo: '981', descricao: 'ADIANTAMENTO SALARIAL', referencia: '40,00', vencimento: 848.00, desconto: 0.00 }
    ]
  });

  // Amostra 2: Recibo de Folha Mensal (GSI BW)
  const htmlMensal = context.window.holeritesModule.gerarHoleriteHtml({
    id: 102,
    empresa: 'GSI',
    empresa_razao_social: 'GSI BW EQUIPAMENTOS DE ACO COFRES E ARMARIOS LTDA',
    tipo_documento: 'FOLHA_MENSAL',
    funcionario_nome: 'ALEXANDRE RODRIGUES ARRAIS',
    total_vencimentos: 4748.80,
    total_descontos: 295.62,
    valor_liquido: 4453.18,
    eventos: [
      { codigo: '8781', descricao: 'DIAS NORMAIS', referencia: '30,00', vencimento: 3392.00, desconto: 0.00 },
      { codigo: '9488', descricao: 'AJUDA HOME OFFICE', referencia: '1.356,80', vencimento: 1356.80, desconto: 0.00 },
      { codigo: '998', descricao: 'I.N.S.S.', referencia: '8,72', vencimento: 0.00, desconto: 295.62 }
    ]
  });

  // Asserções para ambos os modelos:
  for (const [modelo, html] of [['Adiantamento OAÇO', htmlAdiantamento], ['Mensal GSI', htmlMensal]]) {
    assert.ok(html.includes('<tfoot'), `${modelo} deve conter elemento <tfoot>`);
    assert.ok(html.includes('holerite-linha-subtotais'), `${modelo} deve conter linha .holerite-linha-subtotais`);
    assert.ok(html.includes('Total de Vencimentos'), `${modelo} deve exibir rótulo "Total de Vencimentos"`);
    assert.ok(html.includes('Total de Descontos'), `${modelo} deve exibir rótulo "Total de Descontos"`);
    assert.ok(html.includes('holerite-linha-liquido'), `${modelo} deve conter linha .holerite-linha-liquido`);
    assert.ok(html.includes('Valor Líquido'), `${modelo} deve exibir rótulo "Valor Líquido"`);
    assert.ok(!html.includes('class="holerite-totais-grid"'), `${modelo} NÃO deve conter contêiner externo .holerite-totais-grid`);
    assert.ok(html.includes('holerite-linha-vazia'), `${modelo} deve conter linhas espaçadoras para manter elegância da folha`);
  }

  // Validação dos valores específicos
  assert.ok(htmlAdiantamento.includes('848,00'), 'Adiantamento deve renderizar 848,00 nos vencimentos e líquido');
  assert.ok(htmlMensal.includes('4.748,80'), 'Mensal deve renderizar total de vencimentos 4.748,80');
  assert.ok(htmlMensal.includes('295,62'), 'Mensal deve renderizar total de descontos 295,62');
  assert.ok(htmlMensal.includes('4.453,18'), 'Mensal deve renderizar valor líquido 4.453,18');

  // Validação no CSS
  assert.ok(css.includes('.holerite-linha-subtotais'), 'CSS deve definir .holerite-linha-subtotais');
  assert.ok(css.includes('.holerite-linha-liquido'), 'CSS deve definir .holerite-linha-liquido');
  assert.ok(css.includes('.holerite-subtotal-val'), 'CSS deve definir .holerite-subtotal-val');
  assert.ok(css.includes('.holerite-liquido-val'), 'CSS deve definir .holerite-liquido-val');
  assert.ok(css.includes('border: 1px solid #000000'), 'CSS deve definir borda preta sólida (#000000) para a tabela de eventos');
  assert.ok(css.includes('border-color: #000000 !important'), 'CSS de impressão deve forçar bordas pretas (#000000) em @media print');

  report('Tabela clássica de holerites com subtotais e valor líquido integrados no rodapé validada com sucesso', true);
} catch (err) {
  report('Tabela clássica de holerites com subtotais e valor líquido integrados no rodapé validada com sucesso', false, err.message);
}

// 5. Validação de Sanitização XSS & Parser Numérico PT-BR
try {
  console.log('\n--- 5. Validação de Sanitização XSS & Parser Numérico PT-BR ---');
  const js = fs.readFileSync(path.join(__dirname, 'public', 'js', 'holerites.js'), 'utf-8');
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

  // Teste de ataque XSS
  const xssPayload = '"><script>alert("xss")</script><img src=x onerror="alert(1)">';
  const htmlXss = context.window.holeritesModule.gerarHoleriteHtml({
    id: 999,
    empresa: 'GSI',
    funcionario_nome: `ALEXANDRE ${xssPayload}`,
    funcionario_cargo: `GERENTE ${xssPayload}`,
    mensagem_personalizada: xssPayload,
    total_vencimentos: "1.356,80",
    total_descontos: "295,62",
    valor_liquido: "1.061,18",
    eventos: [
      { codigo: '101', descricao: `Salário ${xssPayload}`, referencia: '30d', vencimento: "1.356,80", desconto: 0 },
      { codigo: '201', descricao: 'INSS', referencia: '7,5%', vencimento: 0, desconto: "295,62" }
    ]
  });

  assert.ok(!htmlXss.includes('<script>'), 'HTML NÃO deve conter tags <script> não escapadas');
  assert.ok(!htmlXss.includes('<img src=x'), 'HTML NÃO deve conter tags <img> maliciosas não escapadas');
  assert.ok(htmlXss.includes('&lt;script&gt;'), 'Tags script devem ser devidamente escapadas como entidades HTML');
  assert.ok(htmlXss.includes('&quot;xss&quot;'), 'Aspas em payloads devem ser escapadas');

  // Validação de parsing PT-BR de strings com separadores de milhar e decimal
  assert.ok(htmlXss.includes('1.356,80'), 'Deve converter e renderizar strings monetárias PT-BR com separador de milhar ("1.356,80")');
  assert.ok(htmlXss.includes('295,62'), 'Deve converter e renderizar descontos em formato PT-BR ("295,62")');
  assert.ok(htmlXss.includes('1.061,18'), 'Deve converter e renderizar valor líquido PT-BR ("1.061,18")');

  report('Sanitização contra Stored XSS e suporte a strings numéricas PT-BR validados com sucesso', true);
} catch (err) {
  report('Sanitização contra Stored XSS e suporte a strings numéricas PT-BR validados com sucesso', false, err.message);
}

console.log('\n=============================================================');
console.log(`📊 RESULTADOS: ${passed} Aprovados, ${failed} Falhas`);
console.log('=============================================================');

if (failed > 0) {
  process.exit(1);
}
