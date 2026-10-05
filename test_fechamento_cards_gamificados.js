/**
 * test_fechamento_cards_gamificados.js
 * 
 * Suíte de Testes Automatizados para os novos Cards Gamificados de Metas (Vendas e Frete)
 * e Desempenho da Equipe (Ranking 1 Ouro, 2 Prata, 3 Bronze).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('🧪 Iniciando Suíte de Testes: Cards Gamificados de Fechamento & Ranking...');
let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
    process.exitCode = 1;
  }
}

// ─── TESTE 1: Calibração da Barra de Vendas (0 a 1ª Faixa = 100% da Meta Base) ───

function calcPctBarVendas(vBaseLiq, metaBase = 120000) {
  const v = parseFloat(vBaseLiq || 0);
  const m = parseFloat(metaBase || 120000);
  if (v <= 0 || m <= 0) return 0;
  return Math.min(100, Math.max(0, (v / m) * 100));
}

function getIconeVendas(vBaseLiq, metaBase = 120000) {
  const v = parseFloat(vBaseLiq || 0);
  const m = parseFloat(metaBase || 120000);
  const pct = m > 0 ? (v / m) * 100 : 0;
  return (pct >= 100.0 && v > 0) ? '🏆' : '😞';
}

runTest('1.1 - Barra de Vendas com R$ 60.000 deve preencher exatamente 50% e exibir cara triste 😞', () => {
  const pct = calcPctBarVendas(60000, 120000);
  assert.strictEqual(pct, 50, 'Deve ser exatamente 50%');
  const icone = getIconeVendas(60000, 120000);
  assert.strictEqual(icone, '😞', 'Deve exibir cara triste');
});

runTest('1.2 - Barra de Vendas ao atingir a 1ª Faixa (R$ 120.000 = 100%) deve preencher 100% e exibir Troféu Dourado 🏆', () => {
  const pct = calcPctBarVendas(120000, 120000);
  assert.strictEqual(pct, 100, 'Deve ser 100% (barra cheia - dever cumprido)');
  const icone = getIconeVendas(120000, 120000);
  assert.strictEqual(icone, '🏆', 'Deve exibir troféu dourado');
});

runTest('1.3 - Caso do print cards-01.png: R$ 160.146,83 (133,46%) deve travar barra em 100% com Troféu 🏆', () => {
  const pct = calcPctBarVendas(160146.83, 120000);
  assert.strictEqual(pct, 100, 'Supermeta deve manter barra cheia em 100%');
  const icone = getIconeVendas(160146.83, 120000);
  assert.strictEqual(icone, '🏆', 'Deve exibir troféu dourado');
});

runTest('1.4 - Vendas negativas ou zeradas devem travar barra em 0% com cara triste 😞', () => {
  assert.strictEqual(calcPctBarVendas(0, 120000), 0);
  assert.strictEqual(calcPctBarVendas(-500, 120000), 0);
  assert.strictEqual(getIconeVendas(0, 120000), '😞');
  assert.strictEqual(getIconeVendas(-500, 120000), '😞');
});

// ─── TESTE 2: Calibração da Barra de Frete (0 a 1ª Faixa = R$ 700,00) ──────────

function calcPctBarFrete(gorduraTotal, metaFaixa1 = 700) {
  const g = parseFloat(gorduraTotal || 0);
  const m = parseFloat(metaFaixa1 || 700);
  if (g <= 0 || m <= 0) return 0;
  return Math.min(100, Math.max(0, (g / m) * 100));
}

function getIconeFrete(gorduraTotal, pctMetaVendas, metaFaixa1 = 700) {
  const g = parseFloat(gorduraTotal || 0);
  const pctV = parseFloat(pctMetaVendas || 0);
  const elegivel = pctV >= 85.0;
  return (g >= metaFaixa1 && elegivel) ? '🏆' : '😞';
}

runTest('2.1 - Caso do print cards-01.png: Superávit de R$ 689,56 deve preencher 98,51% da barra (quase cheia!)', () => {
  const pct = calcPctBarFrete(689.56, 700);
  assert(Math.abs(pct - 98.5085) < 0.01, `Pct esperado ~98.51%, recebido ${pct}`);
});

runTest('2.2 - Superávit de R$ 689,56 ainda não atingiu a 1ª faixa (R$ 700), logo deve exibir cara triste 😞', () => {
  const icone = getIconeFrete(689.56, 133.46, 700);
  assert.strictEqual(icone, '😞', 'Deve ser cara triste pois faltam R$ 10,44');
});

runTest('2.3 - Gordura ao atingir a 1ª Faixa (R$ 700) com vendas >= 85% preenche 100% com Troféu Dourado 🏆', () => {
  const pct = calcPctBarFrete(700.00, 700);
  assert.strictEqual(pct, 100, 'Barra deve estar 100% cheia (dever cumprido)');
  const icone = getIconeFrete(700.00, 100.0, 700);
  assert.strictEqual(icone, '🏆', 'Deve exibir troféu dourado');
});

runTest('2.4 - Superávit de R$ 1.500 (Nível 3) mantém barra cheia em 100% com Troféu Dourado 🏆', () => {
  const pct = calcPctBarFrete(1500.00, 700);
  assert.strictEqual(pct, 100, 'Supermeta deve manter barra cheia');
  const icone = getIconeFrete(1500.00, 95.0, 700);
  assert.strictEqual(icone, '🏆', 'Deve exibir troféu dourado');
});

runTest('2.5 - TRAVA 85%: Gordura alta (R$ 2.000) mas Vendas < 85% exibe cara triste 😞 (bloqueado)', () => {
  const icone = getIconeFrete(2000.00, 84.99, 700);
  assert.strictEqual(icone, '😞', 'Deve ser cara triste por bloqueio da regra comercial');
});

runTest('2.6 - Gordura negativa ou zerada preenche 0% da barra com cara triste 😞', () => {
  assert.strictEqual(calcPctBarFrete(0, 700), 0);
  assert.strictEqual(calcPctBarFrete(-150.80, 700), 0);
  assert.strictEqual(getIconeFrete(-150.80, 100.0, 700), '😞');
});

// ─── TESTE 3: Desempenho / Ranking da Equipe (1 Ouro, 2 Prata, 3 Bronze) ───────

function calcularRankingEquipe(vendedores, codVendedorAlvo) {
  const lista = [...vendedores].sort((a, b) => {
    const vA = parseFloat(a.vendas_base_liquida ?? a.vendasBaseLiquida ?? 0);
    const vB = parseFloat(b.vendas_base_liquida ?? b.vendasBaseLiquida ?? 0);
    return vB - vA;
  });

  const curCod = String(codVendedorAlvo || '').trim();
  const rankIdx = lista.findIndex(x => {
    const c = String(x.cod_vendedor || x.codVendedor || '').trim();
    return c === curCod || c === curCod.padStart(6, '0') || curCod === c.padStart(6, '0');
  });

  const posicao = rankIdx >= 0 ? rankIdx + 1 : 1;
  let classe = 'ranking-num-neutro';
  let medalha = '';
  let titulo = `${posicao}º Lugar da Equipe`;

  if (posicao === 1) {
    classe = 'ranking-num-ouro';
    medalha = '🥇';
    titulo = '1º Lugar da Equipe 🥇';
  } else if (posicao === 2) {
    classe = 'ranking-num-prata';
    medalha = '🥈';
    titulo = '2º Lugar da Equipe 🥈';
  } else if (posicao === 3) {
    classe = 'ranking-num-bronze';
    medalha = '🥉';
    titulo = '3º Lugar da Equipe 🥉';
  }

  return { posicao, classe, medalha, titulo, totalVendedores: lista.length };
}

runTest('3.1 - Juliana (000074) com maior venda (R$ 169.244,14) deve ser 1º Lugar Ouro 🥇', () => {
  const equipe = [
    { cod_vendedor: '000074', nome_vendedor: 'Juliana', vendas_base_liquida: 169244.14 },
    { cod_vendedor: '000004', nome_vendedor: 'Figueiredo', vendas_base_liquida: 160146.83 },
    { cod_vendedor: '000064', nome_vendedor: 'Andrea', vendas_base_liquida: 110500.00 }
  ];

  const r = calcularRankingEquipe(equipe, '000074');
  assert.strictEqual(r.posicao, 1, 'Posição deve ser 1');
  assert.strictEqual(r.classe, 'ranking-num-ouro', 'Classe deve ser ranking-num-ouro');
  assert.strictEqual(r.titulo, '1º Lugar da Equipe 🥇');
});

runTest('3.2 - Figueiredo (000004) com R$ 160.146,83 deve ser 2º Lugar Prata 🥈', () => {
  const equipe = [
    { cod_vendedor: '000074', nome_vendedor: 'Juliana', vendas_base_liquida: 169244.14 },
    { cod_vendedor: '000004', nome_vendedor: 'Figueiredo', vendas_base_liquida: 160146.83 },
    { cod_vendedor: '000064', nome_vendedor: 'Andrea', vendas_base_liquida: 110500.00 }
  ];

  const r = calcularRankingEquipe(equipe, '000004');
  assert.strictEqual(r.posicao, 2, 'Posição deve ser 2');
  assert.strictEqual(r.classe, 'ranking-num-prata', 'Classe deve ser ranking-num-prata');
  assert.strictEqual(r.titulo, '2º Lugar da Equipe 🥈');
});

runTest('3.3 - Andrea (000064) com R$ 110.500,00 deve ser 3º Lugar Bronze 🥉', () => {
  const equipe = [
    { cod_vendedor: '000074', nome_vendedor: 'Juliana', vendas_base_liquida: 169244.14 },
    { cod_vendedor: '000004', nome_vendedor: 'Figueiredo', vendas_base_liquida: 160146.83 },
    { cod_vendedor: '000064', nome_vendedor: 'Andrea', vendas_base_liquida: 110500.00 }
  ];

  const r = calcularRankingEquipe(equipe, '000064');
  assert.strictEqual(r.posicao, 3, 'Posição deve ser 3');
  assert.strictEqual(r.classe, 'ranking-num-bronze', 'Classe deve ser ranking-num-bronze');
  assert.strictEqual(r.titulo, '3º Lugar da Equipe 🥉');
});

runTest('3.4 - Vendedor em 4º lugar deve receber classe ranking-num-neutro', () => {
  const equipe = [
    { cod_vendedor: '000074', vendas_base_liquida: 169244.14 },
    { cod_vendedor: '000004', vendas_base_liquida: 160146.83 },
    { cod_vendedor: '000064', vendas_base_liquida: 110500.00 },
    { cod_vendedor: '000099', vendas_base_liquida: 80000.00 }
  ];

  const r = calcularRankingEquipe(equipe, '000099');
  assert.strictEqual(r.posicao, 4);
  assert.strictEqual(r.classe, 'ranking-num-neutro');
  assert.strictEqual(r.titulo, '4º Lugar da Equipe');
});

// ─── TESTE 4: Presença dos Elementos Estruturais no HTML ───────────────────────

runTest('4.1 - public/index.html deve conter os IDs essenciais dos 3 cards gamificados', () => {
  const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf-8');
  
  const idsEsperados = [
    'fechamentoCardVendas',
    'fechamentoVendasIcon',
    'fechamentoProgressLabelVendas',
    'fechamentoProgressBarVendas',
    'fechamentoVendasReguaFim',
    'fechamentoVendasStatusFoot',
    'fechamentoCardFrete',
    'fechamentoFreteIcon',
    'fechamentoProgressLabelFrete',
    'fechamentoProgressBarFrete',
    'fechamentoFreteReguaFim',
    'fechamentoFreteStatusFoot',
    'fechamentoCardRanking',
    'fechamentoRankingNumero',
    'fechamentoRankingTitulo',
    'fechamentoRankingSub',
    'fechamentoRankingMediaVal',
    'fechamentoRankingDiffBadge',
    'fechamentoRankingStatusFoot'
  ];

  for (const id of idsEsperados) {
    assert(html.includes(`id="${id}"`), `Elemento id="${id}" deve existir no HTML`);
  }
});

// ─── TESTE 5: Presença dos Estilos CSS em public/style.css ────────────────────

runTest('5.1 - public/style.css deve conter as classes de pódio e cards gamificados', () => {
  const css = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf-8');
  
  assert(css.includes('.ranking-num-ouro'), 'Deve conter .ranking-num-ouro');
  assert(css.includes('.ranking-num-prata'), 'Deve conter .ranking-num-prata');
  assert(css.includes('.ranking-num-bronze'), 'Deve conter .ranking-num-bronze');
  assert(css.includes('.fechamento-gamificado-card'), 'Deve conter .fechamento-gamificado-card');
  assert(css.includes('pulseTrofeu'), 'Deve conter keyframe pulseTrofeu');
});

// ─── TESTE 6: Integridade Léxica e Sintática via vm.Script ─────────────────────

runTest('6.1 - public/js/fechamento_vendedores.js deve compilar perfeitamente sem erros de sintaxe', () => {
  const code = fs.readFileSync(path.join(__dirname, 'public', 'js', 'fechamento_vendedores.js'), 'utf-8');
  new vm.Script(code, { filename: 'fechamento_vendedores.js' });
});

// ─── TESTE 7: Execução Completa da Renderização no DOM (Prevenção de ReferenceError) ───

runTest('7.1 - Renderização completa dos Stat Cards, Faturamento por Empresa e Benchmarking sem erros', () => {
  const code = fs.readFileSync(path.join(__dirname, 'public', 'js', 'fechamento_vendedores.js'), 'utf-8');
  const cachePath = path.join(__dirname, 'data', 'fechamentos_vendedores_cache.json');
  const cacheData = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf-8')) : [];
  const julianaMock = cacheData.find(x => x.cod_vendedor === '000074') || {
    cod_vendedor: '000074',
    nome_vendedor: 'Juliana',
    vendas_base_bruta: 172020.14,
    fretes_embutidos: 2776,
    vendas_base_liquida: 169244.14,
    meta_vendas_valor: 120000,
    pct_meta_vendas: 141.04,
    premio_meta_vendas: 400,
    gordura_frete_total: 154.42,
    premio_gordura_frete: 0,
    comissao_bruta: 2200.17,
    comissao_liquida: 2200.17,
    total_premios: 400,
    total_geral_receber: 2600.17,
    faturamento_empresas_json: { GSI: 3445.72, OACO: 184497.62, METAL_PLENO: 288973.9, TOTAL: 476917.24 },
    benchmarking_json: { mediaVendasEquipe: 155669.08, diffVendasPct: 8.72, mediaGorduraEquipe: 1067.67, diffGorduraPct: -85.54 }
  };

  const elements = {};
  const getEl = (id) => {
    if (!elements[id]) {
      elements[id] = {
        id,
        classList: { remove: () => {}, add: () => {}, toggle: () => {} },
        style: {},
        innerHTML: '',
        textContent: '',
        appendChild: () => {},
        addEventListener: () => {},
        getContext: () => ({ clearRect: () => {}, save: () => {}, translate: () => {}, rotate: () => {}, fillRect: () => {}, restore: () => {} }),
        getBoundingClientRect: () => ({ width: 800, height: 260 })
      };
    }
    return elements[id];
  };

  const sandbox = {
    window: { currentUser: null },
    document: {
      getElementById: (id) => getEl(id),
      createElement: (tag) => getEl(tag),
      addEventListener: () => {}
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    sessionStorage: { getItem: () => null, setItem: () => {} },
    alert: () => {},
    fetch: async () => ({ status: 200, json: async () => ({ success: true }) }),
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    performance: { now: () => 100 },
    setTimeout: (fn) => fn(),
    clearTimeout: () => {},
    console
  };
  sandbox.globalThis = sandbox;

  // Modifica para injetar fechamento de teste e expor renderizarTelaCompleta
  const testCode = code.replace(
    'let currentFechamento = null;',
    `let currentFechamento = ${JSON.stringify(julianaMock)}; globalThis.__testRenderCompleto = renderizarTelaCompleta;`
  );

  vm.createContext(sandbox);
  vm.runInContext(testCode, sandbox);

  assert.strictEqual(typeof sandbox.globalThis.__testRenderCompleto, 'function', 'renderizarTelaCompleta deve ser acessível');
  sandbox.globalThis.__testRenderCompleto();

  // 1. Verifica Card 3 (Gordura)
  assert(elements['cardFechamentoGorduraVal'].textContent.includes('154,42'), 'Card Gordura deve renderizar o valor correto');
  // 2. Verifica Card 4 (Total Premiações)
  assert(elements['cardFechamentoTotalPremios'].textContent.includes('400,00'), 'Card Premiações deve renderizar o valor correto');
  // 3. Verifica Faturamento por Empresa
  assert(elements['fatEmpresaTotal'].textContent.includes('476.917,24'), 'Faturamento Total por Empresa deve ser exibido');
  // 4. Verifica Benchmarking
  assert(elements['benchVendasDiff'].innerHTML.includes('+8,72%'), 'Performance de vendas deve ser calculada e exibida');
  assert(elements['benchFreteDiff'].innerHTML.includes('-85,54%'), 'Performance de frete deve ser calculada e exibida');
});

console.log(`\n📊 Resultado dos Testes: ${passedTests}/${totalTests} aprovados (${Math.round((passedTests / totalTests) * 100)}%)`);
if (passedTests === totalTests) {
  console.log('🎉 TODOS OS TESTES DOS CARDS GAMIFICADOS FORAM APROVADOS COM SUCESSO!\n');
} else {
  process.exit(1);
}

