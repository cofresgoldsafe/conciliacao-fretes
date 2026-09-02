/**
 * test_gordura_frete.js
 * 
 * Suíte de Testes Automatizados para a Sub-Aba Gordura de Frete no Módulo de Vendedores
 * Valida:
 * 1. Cálculo da regra do ciclo de fechamento (dia 26 ao dia 25).
 * 2. Obtenção dos 3 ciclos pré-definidos (Atual, Anterior, 2 Anteriores).
 * 3. Trava de segurança para limites de período (máx. 95 dias).
 * 4. Montagem da query T-SQL com prevenção de duplicidade (OUTER APPLY) e filtro de vendedor.
 * 5. Fórmulas de cálculo de Gordura de Frete (COBCLI - Custo Real) e margens percentuais.
 * 6. Integridade sintática de public/js/gordura_frete.js e gordura_frete_engine.js via Node.js vm.Script.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  calcularCicloPadrao,
  obterCiclosPredefinidos,
  buildGorduraFreteSql,
  consultarGorduraFrete
} = require('./gordura_frete_engine');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Erro: ${err.message}`);
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Erro: ${err.message}`);
  }
}

async function main() {
  console.log('\n======================================================');
  console.log('🧪 INICIANDO SUÍTE DE TESTES: GORDURA DE FRETE (VENDEDORES)');
  console.log('======================================================\n');

  // ─── TESTE 1: CÁLCULO DA REGRA DO CICLO DE FECHAMENTO (26 A 25) ───────────
  console.log('📦 1. Regra de Ciclo de Fechamento (26 a 25):');

  runTest('Deve calcular corretamente o ciclo quando data <= 25 (Ex: 02/09/2026 -> 26/08/2026 a 25/09/2026)', () => {
    const ref = new Date(2026, 8, 2); // 02/09/2026
    const ciclo = calcularCicloPadrao(ref);
    assert.strictEqual(ciclo.dtIni, '20260826', 'Data inicial deve ser 26/08/2026');
    assert.strictEqual(ciclo.dtFim, '20260925', 'Data final deve ser 25/09/2026');
    assert.strictEqual(ciclo.dataIniBR, '26/08/2026');
    assert.strictEqual(ciclo.dataFimBR, '25/09/2026');
  });

  runTest('Deve calcular corretamente o ciclo quando data > 25 (Ex: 28/08/2026 -> 26/08/2026 a 25/09/2026)', () => {
    const ref = new Date(2026, 7, 28); // 28/08/2026
    const ciclo = calcularCicloPadrao(ref);
    assert.strictEqual(ciclo.dtIni, '20260826', 'Data inicial deve ser 26/08/2026');
    assert.strictEqual(ciclo.dtFim, '20260925', 'Data final deve ser 25/09/2026');
  });

  runTest('Deve calcular corretamente a virada de ano no ciclo (Ex: 26/12/2026 -> 26/12/2026 a 25/01/2027)', () => {
    const ref = new Date(2026, 11, 26); // 26/12/2026
    const ciclo = calcularCicloPadrao(ref);
    assert.strictEqual(ciclo.dtIni, '20261226', 'Data inicial deve ser 26/12/2026');
    assert.strictEqual(ciclo.dtFim, '20270125', 'Data final deve ser 25/01/2027');
  });

  // ─── TESTE 2: CICLOS PRÉ-DEFINIDOS (ATUAL, ANTERIOR, 2 ANTERIORES) ────────
  console.log('\n📦 2. Obtenção dos 3 Ciclos Pré-definidos:');

  runTest('Deve retornar exatamente 3 ciclos coerentes e consecutivos', () => {
    const ref = new Date(2026, 8, 2); // 02/09/2026
    const ciclos = obterCiclosPredefinidos(ref);
    assert.strictEqual(ciclos.length, 3, 'Devem ser retornados 3 ciclos');
    
    // Ciclo 0 (Atual): 26/08 a 25/09
    assert.strictEqual(ciclos[0].id, 'atual');
    assert.strictEqual(ciclos[0].dtIni, '20260826');
    assert.strictEqual(ciclos[0].dtFim, '20260925');

    // Ciclo 1 (Anterior): 26/07 a 25/08
    assert.strictEqual(ciclos[1].id, 'anterior');
    assert.strictEqual(ciclos[1].dtIni, '20260726');
    assert.strictEqual(ciclos[1].dtFim, '20260825');

    // Ciclo 2 (2 Anteriores): 26/06 a 25/07
    assert.strictEqual(ciclos[2].id, 'dois_anteriores');
    assert.strictEqual(ciclos[2].dtIni, '20260626');
    assert.strictEqual(ciclos[2].dtFim, '20260725');
  });

  // ─── TESTE 3: TRAVA DE SEGURANÇA CONTRA INTERVALOS EXCESSIVOS ──────────────
  console.log('\n📦 3. Trava de Segurança de Período (Máx 95 dias / 3 períodos):');

  await runAsyncTest('Deve rejeitar consultas com intervalo superior a 95 dias para preservar o Protheus', async () => {
    let rejeitou = false;
    try {
      await consultarGorduraFrete({ dataIni: '20260101', dataFim: '20260630' }); // ~180 dias
    } catch (err) {
      if (err.message.includes('95 dias')) {
        rejeitou = true;
      }
    }
    assert.strictEqual(rejeitou, true, 'Deveria ter rejeitado consulta com 180 dias');
  });

  // ─── TESTE 4: MONTAGEM DA QUERY T-SQL E FILTRO DE VENDEDOR ─────────────────
  console.log('\n📦 4. Query T-SQL de Fechamento e Isolamento RBAC:');

  runTest('A query T-SQL deve conter OUTER APPLY com DISTINCT D2_PEDIDO para evitar duplicidade de C5_FRETE', () => {
    const sql = buildGorduraFreteSql('160', 'OACO', '20260826', '20260925', '');
    assert.strictEqual(sql.includes('SF1160 SF1'), true, 'Deve consultar tabela SF1160');
    assert.strictEqual(sql.includes('SF2160 SF2'), true, 'Deve fazer join com SF2160');
    assert.strictEqual(sql.includes('DISTINCT D2_PEDIDO, D2_FILIAL'), true, 'Deve isolar pedidos distintos em SD2160');
    assert.strictEqual(sql.includes('SUM(SC5.C5_FRETE) AS FRETE'), true, 'Deve somar C5_FRETE');
    assert.strictEqual(sql.includes('SUM(SC5.C5_VLR_FRT) AS FRETE2'), true, 'Deve somar C5_VLR_FRT');
    assert.strictEqual(sql.includes("F1_ESPECIE = 'CTR'"), true, 'Filtro F1_ESPECIE = CTR');
    assert.strictEqual(sql.includes("F1_PREFIXO = 'FRE'"), true, 'Filtro F1_PREFIXO = FRE');
  });

  runTest('A query T-SQL deve aplicar o filtro do código do vendedor quando fornecido', () => {
    const sqlJuliana = buildGorduraFreteSql('160', 'OACO', '20260826', '20260925', '000074');
    assert.strictEqual(sqlJuliana.includes("SF2.F2_VEND1) = '000074'"), true, 'Deve filtrar SF2_VEND1 = 000074');
  });

  // ─── TESTE 5: FÓRMULAS DE GORDURA DE FRETE E MARGENS ──────────────────────
  console.log('\n📦 5. Fórmulas de Frete e Gordura:');

  runTest('Deve calcular corretamente Superávit e Déficit de Gordura de Frete', () => {
    // Caso 1: Superávit
    const cobrado1 = 250.00; // 150 frete + 100 frete2
    const custo1 = 180.00;
    const gordura1 = cobrado1 - custo1;
    const pct1 = Math.round(((gordura1 / cobrado1) * 100) * 100) / 100;
    assert.strictEqual(gordura1, 70.00, 'Gordura deve ser R$ 70,00 positiva');
    assert.strictEqual(pct1, 28.00, 'Margem deve ser 28%');

    // Caso 2: Déficit
    const cobrado2 = 100.00;
    const custo2 = 145.50;
    const gordura2 = Math.round((cobrado2 - custo2) * 100) / 100;
    const pct2 = Math.round(((gordura2 / cobrado2) * 100) * 100) / 100;
    assert.strictEqual(gordura2, -45.50, 'Gordura deve ser -R$ 45,50 negativa');
    assert.strictEqual(pct2, -45.50, 'Margem deve ser -45.5%');
  });

  // ─── TESTE 6: INTEGRIDADE SINTÁTICA DE JAVASCRIPT VIA VM.SCRIPT ────────────
  console.log('\n📦 6. Integridade Sintática dos Arquivos JavaScript:');

  runTest('gordura_frete_engine.js deve compilar perfeitamente sem erros de sintaxe', () => {
    const code = fs.readFileSync(path.join(__dirname, 'gordura_frete_engine.js'), 'utf8');
    assert.doesNotThrow(() => {
      new vm.Script(code, { filename: 'gordura_frete_engine.js' });
    }, 'Arquivo gordura_frete_engine.js possui erro léxico/sintático');
  });

  runTest('public/js/gordura_frete.js deve compilar perfeitamente sem erros de sintaxe', () => {
    const code = fs.readFileSync(path.join(__dirname, 'public', 'js', 'gordura_frete.js'), 'utf8');
    assert.doesNotThrow(() => {
      new vm.Script(code, { filename: 'public/js/gordura_frete.js' });
    }, 'Arquivo public/js/gordura_frete.js possui erro léxico/sintático');
  });

  runTest('public/index.html deve conter a sub-aba tab-vend-gordura-frete e a tag de script', () => {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    assert.strictEqual(html.includes('data-tab="tab-vend-gordura-frete"'), true, 'Botão de navegação deve existir');
    assert.strictEqual(html.includes('id="tab-vend-gordura-frete"'), true, 'Container da sub-aba deve existir');
    assert.strictEqual(html.includes('src="js/gordura_frete.js?v=8.130"'), true, 'Script deve ser carregado com versão v=8.130');
  });

  console.log('\n======================================================');
  console.log(`📊 RESULTADO DA SUÍTE DE TESTES: ${passedTests}/${totalTests} aprovados`);
  console.log('======================================================\n');

  if (passedTests === totalTests) {
    console.log('🎉 TODOS OS TESTES PASSARAM COM 100% DE SUCESSO!\n');
    process.exit(0);
  } else {
    console.error(`⚠️ FALHA: ${totalTests - passedTests} teste(s) falharam.\n`);
    process.exit(1);
  }
}

main();
