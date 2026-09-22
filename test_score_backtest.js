/**
 * test_score_backtest.js
 *
 * Suite de Backtesting no Historico Real de Analises de Credito (65 registros em data/analise_credito_history.json)
 * Testa o impacto dos novos criterios:
 * 1. Inscricao Estadual (ATIVA: +2 pts, INAPTA: -15 pts, ISENTO: 0 pts, NAO_INFORMADA: 0 pts)
 * 2. Antifraude Socio Bolsa Familia (SIM: -25 pts, NAO: 0 pts, ISENTO: 0 pts)
 * 3. Suporte a Empresas Publicas / Sem Socios PF (ISENTO neutro sem falso positivo)
 * 4. Respeito estrito as configuracoes dinamicas (sem hardcoding)
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const {
  calcularScore,
  getScoreConfig,
  saveScoreConfig,
  resetScoreConfig,
  DEFAULT_CONFIG
} = require('./analise_credito_engine');

const HISTORY_PATH = path.join(__dirname, 'data', 'analise_credito_history.json');

function runBacktest() {
  console.log('=============================================================');
  console.log('📊 SUÍTE DE BACKTESTING: HISTÓRICO REAL DE ANÁLISES DE CRÉDITO');
  console.log('=============================================================');

  // Garante estado limpo e padrão
  resetScoreConfig();

  if (!fs.existsSync(HISTORY_PATH)) {
    console.error('Arquivo data/analise_credito_history.json não encontrado!');
    process.exit(1);
  }

  const historico = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
  console.log(`\n📂 Carregados ${historico.length} registros históricos para backtest.`);

  const config = getScoreConfig();
  console.log('⚙️ Configurações atuais carregadas de score_config.json:');
  console.log(`  - peso_socio_bolsa_familia_sim: ${config.peso_socio_bolsa_familia_sim}`);
  console.log(`  - peso_socio_bolsa_familia_nao: ${config.peso_socio_bolsa_familia_nao}`);
  console.log(`  - peso_socio_bolsa_familia_isento: ${config.peso_socio_bolsa_familia_isento}`);
  console.log(`  - peso_ie_ativa: ${config.peso_ie_ativa}`);
  console.log(`  - peso_ie_inapta: ${config.peso_ie_inapta}`);
  console.log(`  - peso_ie_isento: ${config.peso_ie_isento}`);

  let passedTests = 0;
  let totalTests = 0;

  // ---------------------------------------------------------------------------
  // CENÁRIO 1: Baseline e Retrocompatibilidade
  // ---------------------------------------------------------------------------
  console.log('\n--- 1. Baseline de Retrocompatibilidade (Valores Neutros / Não Informados) ---');
  totalTests++;
  try {
    let neutroDeltas = 0;
    for (const h of historico) {
      // Reconstitui o formulário histórico sem alterar os campos novos
      const formDados = { ...h };
      delete formDados.total_score;
      delete formDados.risco;
      delete formDados.sugestao;
      delete formDados.detalhes_pontos;
      delete formDados.sugestoes_lista;

      // Com campos não informados ou neutros
      formDados.inscricao_estadual = 'NAO_INFORMADA';
      formDados.socio_bolsa_familia = 'NAO';

      const res = calcularScore(formDados);
      // O detalhe de pontos novos deve ser 0
      assert.strictEqual(res.detalhesPontos.inscricao_estadual, 0, 'IE NAO_INFORMADA deve pontuar 0');
      assert.strictEqual(res.detalhesPontos.socio_bolsa_familia, 0, 'Sócio BF NAO deve pontuar 0');
      neutroDeltas++;
    }
    console.log(`  ✓ [PASS] Retrocompatibilidade confirmada em ${neutroDeltas}/${historico.length} registros (Impacto neutro = 0 pts)`);
    passedTests++;
  } catch (err) {
    console.error('  ✗ [FAIL] Falha no teste de baseline:', err.message);
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 2: Simulação de Inscrição Estadual Ativa (+2 pts)
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Simulação de Inscrição Estadual Ativa (+2 pts) ---');
  totalTests++;
  try {
    let alteracoesScore = 0;
    let transicoesParaLiberado = 0;

    for (const h of historico) {
      const formDados = { ...h, inscricao_estadual: 'ATIVA', socio_bolsa_familia: 'NAO' };
      const res = calcularScore(formDados);

      assert.strictEqual(res.detalhesPontos.inscricao_estadual, config.peso_ie_ativa);
      alteracoesScore++;
      if (h.sugestao === 'ANALISE-MANUAL' && res.sugestao === 'LIBERADO') {
        transicoesParaLiberado++;
      }
    }
    console.log(`  ✓ [PASS] IE Ativa avaliada em ${alteracoesScore} registros (+${config.peso_ie_ativa} pts concedidos com sucesso)`);
    console.log(`    ℹ️ Migrações de status para LIBERADO: ${transicoesParaLiberado}`);
    passedTests++;
  } catch (err) {
    console.error('  ✗ [FAIL] Falha no teste de IE Ativa:', err.message);
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 3: Simulação de Empresa Isenta / Não-Contribuinte de IE (0 pts)
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. Simulação de Empresas Isentas de IE (Prestadoras / Autarquias) ---');
  totalTests++;
  try {
    for (const h of historico) {
      const formDados = { ...h, inscricao_estadual: 'ISENTO', socio_bolsa_familia: 'NAO' };
      const res = calcularScore(formDados);
      assert.strictEqual(res.detalhesPontos.inscricao_estadual, 0, 'IE ISENTO deve pontuar rigorosamente 0');
    }
    console.log(`  ✓ [PASS] IE Isenta avaliada em ${historico.length} registros: Nenhuma empresa penalizada indevidamente (0 pts)`);
    passedTests++;
  } catch (err) {
    console.error('  ✗ [FAIL] Falha no teste de IE Isento:', err.message);
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 4: Simulação de Inscrição Estadual Inapta / Cancelada (-15 pts)
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. Simulação de Inscrição Estadual Inapta / Cancelada (-15 pts) ---');
  totalTests++;
  try {
    let bloqueados = 0;
    for (const h of historico) {
      const formDados = { ...h, inscricao_estadual: 'INAPTA', socio_bolsa_familia: 'NAO' };
      const res = calcularScore(formDados);
      assert.strictEqual(res.detalhesPontos.inscricao_estadual, config.peso_ie_inapta);
      assert(res.sugestoesLista.some(s => s.includes('INSCRIÇÃO ESTADUAL INAPTA')), 'Alerta de IE inapta deve existir');
      if (res.sugestao === 'BLOQUEADO' || res.risco === 'ALTO-RISCO') {
        bloqueados++;
      }
    }
    console.log(`  ✓ [PASS] IE Inapta penalizada em ${historico.length} registros (-15 pts). Alerta emitido em 100% dos casos.`);
    console.log(`    ℹ️ Casos que caíram em ALTO-RISCO ou BLOQUEADO: ${bloqueados}/${historico.length}`);
    passedTests++;
  } catch (err) {
    console.error('  ✗ [FAIL] Falha no teste de IE Inapta:', err.message);
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 5: Simulação de Sócio Laranja com Bolsa Família Recente (-25 pts)
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. Simulação de Detecção de Sócio Laranja (Bolsa Família = SIM, -25 pts) ---');
  totalTests++;
  try {
    let travadosAntifraude = 0;
    let antesLiberadosDepoisBloqueados = 0;

    for (const h of historico) {
      const formDados = { ...h, socio_bolsa_familia: 'SIM', inscricao_estadual: 'NAO_INFORMADA' };
      const res = calcularScore(formDados);

      assert.strictEqual(res.detalhesPontos.socio_bolsa_familia, config.peso_socio_bolsa_familia_sim);
      assert(res.sugestoesLista.some(s => s.includes('SÓCIO BENEFICIÁRIO DO BOLSA FAMÍLIA')), 'Alerta crítico de sócio laranja deve ser emitido');
      travadosAntifraude++;

      if (h.sugestao === 'LIBERADO' && res.sugestao !== 'LIBERADO') {
        antesLiberadosDepoisBloqueados++;
      }
    }
    console.log(`  ✓ [PASS] Antifraude de Sócio Laranja acionado com sucesso em ${travadosAntifraude} registros (-25 pts).`);
    console.log(`    🚨 Análises que eram LIBERADAS e foram rebaixadas/bloqueadas devido ao sócio laranja: ${antesLiberadosDepoisBloqueados}`);
    passedTests++;
  } catch (err) {
    console.error('  ✗ [FAIL] Falha no teste de Sócio Laranja:', err.message);
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 6: Empresas Públicas / Sem Sócios PF (Isenção Neutra)
  // ---------------------------------------------------------------------------
  console.log('\n--- 6. Empresas Públicas / Entidades Governamentais / Sem Sócios PF ---');
  totalTests++;
  try {
    let neutrosSucesso = 0;
    for (const h of historico) {
      // Simula empresa pública: sem IE (ISENTO) e sem sócios PF (ISENTO)
      const formDados = {
        ...h,
        inscricao_estadual: 'ISENTO',
        socio_bolsa_familia: 'ISENTO'
      };
      const res = calcularScore(formDados);

      assert.strictEqual(res.detalhesPontos.inscricao_estadual, 0);
      assert.strictEqual(res.detalhesPontos.socio_bolsa_familia, 0);
      assert(!res.sugestoesLista.some(s => s.includes('sócio laranja')), 'Não deve emitir falso alerta de sócio laranja para entidades isentas');
      neutrosSucesso++;
    }
    console.log(`  ✓ [PASS] Empresa Pública e Isenções testadas em ${neutrosSucesso} registros: 0 pts de impacto e zero falsos alertas.`);
    passedTests++;
  } catch (err) {
    console.error('  ✗ [FAIL] Falha no teste de Empresas Públicas:', err.message);
  }

  // ---------------------------------------------------------------------------
  // CENÁRIO 7: Verificação de Calibração Dinâmica no Backtest (Zero Hardcoding)
  // ---------------------------------------------------------------------------
  console.log('\n--- 7. Verificação de Dinamismo de Pesos no Backtest ---');
  totalTests++;
  try {
    // Altera temporariamente a penalidade de laranja para -40 pts
    saveScoreConfig({ peso_socio_bolsa_familia_sim: -40 });

    const amostra = historico[0];
    const resModificada = calcularScore({ ...amostra, socio_bolsa_familia: 'SIM' });
    assert.strictEqual(resModificada.detalhesPontos.socio_bolsa_familia, -40, 'Deve usar o peso alterado de -40 dinamicamente');

    // Restaura
    resetScoreConfig();
    const resRestaurada = calcularScore({ ...amostra, socio_bolsa_familia: 'SIM' });
    assert.strictEqual(resRestaurada.detalhesPontos.socio_bolsa_familia, -25, 'Deve restaurar peso -25 dinamicamente');

    console.log('  ✓ [PASS] Motor de score respeita parametrização dinâmica de pesos em tempo de execução.');
    passedTests++;
  } catch (err) {
    console.error('  ✗ [FAIL] Falha no teste de dinamismo de pesos:', err.message);
  }

  console.log('\n=============================================================');
  console.log(`📊 RESUMO DO BACKTESTING: ${passedTests}/${totalTests} Cenários Aprovados, ${totalTests - passedTests} Falhas`);
  console.log('=============================================================');

  if (passedTests === totalTests) {
    console.log('🎉 TODOS OS CENÁRIOS DE BACKTESTING NO HISTÓRICO FORAM HOMOLOGADOS COM SUCESSO!\n');
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runBacktest();
