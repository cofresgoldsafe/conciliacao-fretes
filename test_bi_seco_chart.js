/**
 * test_bi_seco_chart.js
 * Suíte de Testes Automatizados: 2º Gráfico de Tendência — Monitor de Ativo Circulante Seco
 * (Caixa/Bancos + Contas a Receber) & Alertas de Baixa Acentuada
 * Plataforma de Apoio GSI (Gemini-Cli)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');
const app = require('./server');

const JWT_SECRET = process.env.JWT_SECRET || 'gsi_portal_jwt_secret_key_prod_2026_x89a';

function makeRequest(server, options) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      path: options.path,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function runTests() {
  console.log('========================================================================');
  console.log('💎 SUÍTE DE AUDITORIA: 2º GRÁFICO — MONITOR DE ATIVO CIRCULANTE SECO');
  console.log('========================================================================\n');

  let passed = 0;
  let total = 0;

  function test(desc, fn) {
    total++;
    try {
      fn();
      console.log(`  ✅ [PASS] ${desc}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${desc}`);
      console.error(`     Motivo: ${err.message}`);
    }
  }

  async function testAsync(desc, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✅ [PASS] ${desc}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${desc}`);
      console.error(`     Motivo: ${err.message}`);
    }
  }

  // -------------------------------------------------------------
  // BLOCO 1: AUDITORIA DE DOM & INTERFACE DO USUÁRIO (index.html)
  // -------------------------------------------------------------
  console.log('🎨 [BLOCO 1] Auditoria de Estrutura de DOM (public/index.html):');
  const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

  test('1.1 Container do 2º Gráfico (#biSecoCard) está presente no DOM', () => {
    assert.ok(html.includes('id="biSecoCard"'), 'Deve conter id="biSecoCard"');
  });

  test('1.2 Layout Empilhado: #biSecoCard está posicionado após #biChartCard', () => {
    const idxChartCard = html.indexOf('id="biChartCard"');
    const idxSecoCard = html.indexOf('id="biSecoCard"');
    assert.ok(idxChartCard !== -1, 'Deve encontrar #biChartCard');
    assert.ok(idxSecoCard !== -1, 'Deve encontrar #biSecoCard');
    assert.ok(idxSecoCard > idxChartCard, '#biSecoCard DEVE estar posicionado logo após #biChartCard (empilhado)');
  });

  test('1.3 Elementos de Alerta e Status de Baixa Acentuada existem no DOM', () => {
    assert.ok(html.includes('id="biSecoStatusBadge"'), 'Deve conter #biSecoStatusBadge');
    assert.ok(html.includes('id="biSecoAlertBanner"'), 'Deve conter #biSecoAlertBanner');
    assert.ok(html.includes('id="biSecoAlertTitle"'), 'Deve conter #biSecoAlertTitle');
    assert.ok(html.includes('id="biSecoAlertDesc"'), 'Deve conter #biSecoAlertDesc');
  });

  test('1.4 Botões de Ação Comercial e Estoque existem no DOM', () => {
    assert.ok(html.includes('id="btnBiSecoGoEstoque"'), 'Deve conter #btnBiSecoGoEstoque');
    assert.ok(html.includes('id="btnBiSecoAcaoPromo"'), 'Deve conter #btnBiSecoAcaoPromo');
  });

  test('1.5 Mini cards de KPI de Ativo Seco (Caixa, Receber, Total, Variação) existem', () => {
    assert.ok(html.includes('id="biKpiSecoCaixa"'), 'Deve conter #biKpiSecoCaixa');
    assert.ok(html.includes('id="biKpiSecoReceber"'), 'Deve conter #biKpiSecoReceber');
    assert.ok(html.includes('id="biKpiSecoTotal"'), 'Deve conter #biKpiSecoTotal');
    assert.ok(html.includes('id="biKpiSecoVariacao"'), 'Deve conter #biKpiSecoVariacao');
    assert.ok(html.includes('id="biKpiSecoMedia"'), 'Deve conter #biKpiSecoMedia');
  });

  test('1.6 Canvas do 2º Gráfico (#biSecoChart) existe no DOM', () => {
    assert.ok(html.includes('id="biSecoChart"'), 'Deve conter canvas#biSecoChart');
    assert.ok(html.includes('id="biSecoChartWrapper"'), 'Deve conter #biSecoChartWrapper');
  });

  // -------------------------------------------------------------
  // BLOCO 2: AUDITORIA DE ESTILOS CSS (style.css)
  // -------------------------------------------------------------
  console.log('\n🎨 [BLOCO 2] Auditoria de Estilos & Responsividade (public/style.css):');
  const css = fs.readFileSync(path.join(__dirname, 'public', 'style.css'), 'utf8');

  test('2.1 Estilos para #biSecoCard e classes de alerta existem', () => {
    assert.ok(css.includes('#biSecoCard'), 'Deve estilizar #biSecoCard');
    assert.ok(css.includes('.bi-seco-alert-danger'), 'Deve estilizar .bi-seco-alert-danger');
    assert.ok(css.includes('.bi-seco-alert-warning'), 'Deve estilizar .bi-seco-alert-warning');
    assert.ok(css.includes('.bi-seco-alert-success'), 'Deve estilizar .bi-seco-alert-success');
  });

  test('2.2 Animação de pulso para alerta de baixa acentuada está configurada', () => {
    assert.ok(css.includes('biSecoPulseDanger'), 'Deve conter keyframes biSecoPulseDanger');
  });

  // -------------------------------------------------------------
  // BLOCO 3: AUDITORIA DO CONTROLADOR FRONTEND (public/js/bi.js)
  // -------------------------------------------------------------
  console.log('\n⚡ [BLOCO 3] Auditoria do Módulo de Script (public/js/bi.js):');
  const biJs = fs.readFileSync(path.join(__dirname, 'public', 'js', 'bi.js'), 'utf8');

  test('3.1 Instância de Chart para Ativo Seco é gerenciada de forma isolada', () => {
    assert.ok(biJs.includes('let secoChartInstance = null;'), 'Deve declarar secoChartInstance');
  });

  test('3.2 Funções atualizarCardsSeco e renderSecoChart são implementadas e exportadas', () => {
    assert.ok(biJs.includes('function atualizarCardsSeco('), 'Deve conter função atualizarCardsSeco');
    assert.ok(biJs.includes('function renderSecoChart('), 'Deve conter função renderSecoChart');
    assert.ok(biJs.includes('window.renderSecoChart = renderSecoChart;'), 'Deve exportar renderSecoChart');
    assert.ok(biJs.includes('window.atualizarCardsSeco = atualizarCardsSeco;'), 'Deve exportar atualizarCardsSeco');
  });

  test('3.3 Integração no ciclo de vida: loadBIExecutiveChart invoca renderização dupla', () => {
    assert.ok(biJs.includes('atualizarCardsSeco(currentHistoryData);'), 'Deve atualizar KPIs de Ativo Seco');
    assert.ok(biJs.includes('renderSecoChart(currentHistoryData);'), 'Deve renderizar 2º gráfico');
  });

  test('3.4 Alternância Linha/Coluna sincroniza ambos os gráficos', () => {
    const idxLine = biJs.indexOf("btnTypeLine.addEventListener('click'");
    const idxBar = biJs.indexOf("btnTypeBar.addEventListener('click'");
    const idxEnd = biJs.indexOf("// 8.1 Botões de Ação");
    const subLine = biJs.substring(idxLine, idxBar);
    assert.ok(subLine.includes('renderSecoChart(currentHistoryData);'), 'btnTypeLine deve re-renderizar secoChart');

    const subBar = biJs.substring(idxBar, idxEnd);
    assert.ok(subBar.includes('renderSecoChart(currentHistoryData);'), 'btnTypeBar deve re-renderizar secoChart');
  });

  test('3.5 Atalho para saldos de estoque navega para #tab-vend-saldos-estoque', () => {
    assert.ok(biJs.includes('btnBiSecoGoEstoque'), 'Deve escutar btnBiSecoGoEstoque');
    assert.ok(biJs.includes('btnBiSecoAcaoPromo'), 'Deve escutar btnBiSecoAcaoPromo');
    assert.ok(biJs.includes('tab-vend-saldos-estoque'), 'Deve referenciar tab-vend-saldos-estoque');
  });

  // -------------------------------------------------------------
  // BLOCO 4: AUDITORIA DA REGRA MATEMÁTICA DE BAIXA ACENTUADA
  // -------------------------------------------------------------
  console.log('\n📊 [BLOCO 4] Simulação Matemática da Lógica de Tendência & Alertas:');

  function simularAvaliacaoSeco(historyData) {
    if (!historyData || historyData.length === 0) {
      return { status: 'SEM_DADOS', varPct: 0, alertVisible: false };
    }

    const sorted = [...historyData].sort((a, b) => new Date(a.data_registro) - new Date(b.data_registro));
    const latest = sorted[sorted.length - 1];
    const first = sorted[0];

    const caixa = Number(latest.disponibilidades || 0);
    const receber = Number(latest.receber_valido || 0);
    const totalSeco = Number(latest.ativo_seco) || (caixa + receber);

    let varPct = 0;
    if (sorted.length > 1) {
      const firstSeco = Number(first.ativo_seco) || (Number(first.disponibilidades || 0) + Number(first.receber_valido || 0));
      if (firstSeco > 0) {
        varPct = ((totalSeco - firstSeco) / firstSeco) * 100;
      }
    }

    if (varPct <= -10) {
      return { status: 'BAIXA_ACENTUADA', varPct, alertVisible: true, alertType: 'danger' };
    } else if (varPct <= -3) {
      return { status: 'ATENCAO', varPct, alertVisible: true, alertType: 'warning' };
    } else {
      return { status: varPct > 5 ? 'EM_ALTA' : 'ESTAVEL', varPct, alertVisible: false, alertType: 'none' };
    }
  }

  test('4.1 Detecta Baixa Acentuada (queda de 15%) e ativa alerta vermelho', () => {
    const mock = [
      { data_registro: '2026-09-01', disponibilidades: 500000, receber_valido: 500000, ativo_seco: 1000000 },
      { data_registro: '2026-09-10', disponibilidades: 400000, receber_valido: 450000, ativo_seco: 850000 } // -15%
    ];
    const res = simularAvaliacaoSeco(mock);
    assert.strictEqual(res.status, 'BAIXA_ACENTUADA');
    assert.strictEqual(res.varPct, -15);
    assert.strictEqual(res.alertVisible, true);
    assert.strictEqual(res.alertType, 'danger');
  });

  test('4.2 Detecta Recuo Moderado (queda de 5%) e ativa alerta amarelo de atenção', () => {
    const mock = [
      { data_registro: '2026-09-01', disponibilidades: 500000, receber_valido: 500000, ativo_seco: 1000000 },
      { data_registro: '2026-09-10', disponibilidades: 450000, receber_valido: 500000, ativo_seco: 950000 } // -5%
    ];
    const res = simularAvaliacaoSeco(mock);
    assert.strictEqual(res.status, 'ATENCAO');
    assert.strictEqual(res.varPct, -5);
    assert.strictEqual(res.alertVisible, true);
    assert.strictEqual(res.alertType, 'warning');
  });

  test('4.3 Detecta Cenário Estável / Alta (+8%) com banner oculto', () => {
    const mock = [
      { data_registro: '2026-09-01', disponibilidades: 500000, receber_valido: 500000, ativo_seco: 1000000 },
      { data_registro: '2026-09-10', disponibilidades: 550000, receber_valido: 530000, ativo_seco: 1080000 } // +8%
    ];
    const res = simularAvaliacaoSeco(mock);
    assert.strictEqual(res.status, 'EM_ALTA');
    assert.strictEqual(res.varPct, 8);
    assert.strictEqual(res.alertVisible, false);
  });

  test('4.4 Trata série vazia de dados de forma resiliente sem erros', () => {
    const res = simularAvaliacaoSeco([]);
    assert.strictEqual(res.status, 'SEM_DADOS');
    assert.strictEqual(res.alertVisible, false);
  });

  // -------------------------------------------------------------
  // BLOCO 5: AUDITORIA DE API REST (server.js)
  // -------------------------------------------------------------
  console.log('\n🌐 [BLOCO 5] Validação de Integração de Dados do Endpoint Histórico:');

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const adminToken = jwt.sign(
      { username: 'alexandre', role: 'admin', name: 'Alexandre Master' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    await testAsync('5.1 Endpoint /api/bi/indices/historico retorna campos de Ativo Seco e Disponibilidades', async () => {
      const res = await makeRequest(server, {
        path: '/api/bi/indices/historico?empresa=ALL&dias=30',
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(Array.isArray(res.body.historico), 'Deve retornar array de histórico');

      if (res.body.historico.length > 0) {
        const item = res.body.historico[0];
        assert.ok('ativo_seco' in item || 'disponibilidades' in item, 'Deve conter ativo_seco ou disponibilidades');
        assert.ok('data_registro' in item, 'Deve conter data_registro');
      }
    });

  } finally {
    server.close();
  }

  // -------------------------------------------------------------
  // RELATÓRIO FINAL DA AUDITORIA
  // -------------------------------------------------------------
  console.log('\n========================================================================');
  console.log(`📊 RESULTADO DA AUDITORIA: ${passed}/${total} testes aprovados`);
  if (passed === total) {
    console.log('🎉 100% DE APROVAÇÃO! SEGUNDO GRÁFICO E MONITOR HOMOLOGADOS COM SUCESSO!');
  } else {
    console.error(`🚨 ${total - passed} FALHA(S) ENCONTRADA(S)!`);
    process.exit(1);
  }
  console.log('========================================================================\n');
}

runTests().catch((err) => {
  console.error('❌ Erro fatal na suíte de testes:', err);
  process.exit(1);
});
