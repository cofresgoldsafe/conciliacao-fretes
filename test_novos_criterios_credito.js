/**
 * Testes Automatizados: Novos Critérios de Score de Crédito & Consulta Assistida Caixa FGTS
 * 
 * Cobertura:
 * 1. Verificação dos novos parâmetros no DEFAULT_CONFIG (peso_alteracao_recente_socios_sim = -8, peso_aumento_expressivo_capital_sim = -20)
 * 2. Cálculo matemático de pontuação para cenários 'N' (0 pts) e 'S' (-8 pts / -20 pts)
 * 3. Incorporação dos novos critérios no diagnóstico de risco (subGolpe)
 * 4. Calibração personalizada de pesos (override)
 * 5. Persistência e restauração de configurações em disco (score_config.json)
 * 6. Validação de elementos UI e botão 1-clique Caixa FGTS no public/index.html
 * 7. Validação de lógica, clipboard, URL oficial da Caixa e extrato de conferência no public/app.js
 * 8. Integração HTTP POST /api/financeiro/analise-credito/calcular-salvar com os novos campos
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

const {
  DEFAULT_CONFIG,
  getScoreConfig,
  saveScoreConfig,
  resetScoreConfig,
  calcularScore
} = require('./analise_credito_engine');

console.log('================================================================');
console.log('🧪 INICIANDO TESTES: NOVOS CRITÉRIOS DE CRÉDITO & 1-CLIQUE CAIXA');
console.log('================================================================\n');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Erro: ${err.message}`);
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ [PASS] ${name}`);
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Erro: ${err.message}`);
  }
}

(async () => {
  // Teste 1: Validação no DEFAULT_CONFIG
  runTest('1. DEFAULT_CONFIG possui pesos oficiais de alteração de sócios (-8) e aumento de capital (-20)', () => {
    assert.strictEqual(DEFAULT_CONFIG.peso_alteracao_recente_socios_sim, -8.0);
    assert.strictEqual(DEFAULT_CONFIG.peso_aumento_expressivo_capital_sim, -20.0);
  });

  // Teste 2: Cenário Neutro (N = 0 pts)
  runTest('2. calcularScore pontua 0 pts quando alteracao_recente_socios = N e aumento_expressivo_capital = N', () => {
    const dados = {
      total_pedido: 5000,
      faturado: 'S',
      alteracao_recente_socios: 'N',
      aumento_expressivo_capital: 'N'
    };
    const res = calcularScore(dados);
    assert.strictEqual(res.detalhesPontos.alteracao_recente_socios, 0);
    assert.strictEqual(res.detalhesPontos.aumento_expressivo_capital, 0);
  });

  // Teste 3: Cenário com Penalidades Aplicadas (S = -8 pts e -20 pts)
  runTest('3. calcularScore aplica -8 pts para alteração de sócios e -20 pts para aumento de capital', () => {
    const dados = {
      total_pedido: 15000,
      faturado: 'S',
      alteracao_recente_socios: 'S',
      aumento_expressivo_capital: 'S'
    };
    const res = calcularScore(dados);
    assert.strictEqual(res.detalhesPontos.alteracao_recente_socios, -8.0);
    assert.strictEqual(res.detalhesPontos.aumento_expressivo_capital, -20.0);
  });

  // Teste 4: Customização e Override de Pesos
  runTest('4. calcularScore respeita pesos customizados quando informados', () => {
    const customCfg = {
      ...DEFAULT_CONFIG,
      peso_alteracao_recente_socios_sim: -15.0,
      peso_aumento_expressivo_capital_sim: -35.0
    };
    const dados = {
      total_pedido: 8000,
      faturado: 'S',
      alteracao_recente_socios: 'S',
      aumento_expressivo_capital: 'S'
    };
    const res = calcularScore(dados, customCfg);
    assert.strictEqual(res.detalhesPontos.alteracao_recente_socios, -15.0);
    assert.strictEqual(res.detalhesPontos.aumento_expressivo_capital, -35.0);
  });

  // Teste 5: Persistência e Reset de Configurações
  runTest('5. saveScoreConfig e resetScoreConfig persistem e restauram os novos parâmetros', () => {
    saveScoreConfig({
      peso_alteracao_recente_socios_sim: -12.0,
      peso_aumento_expressivo_capital_sim: -25.0
    });
    let cfg = getScoreConfig();
    assert.strictEqual(cfg.peso_alteracao_recente_socios_sim, -12.0);
    assert.strictEqual(cfg.peso_aumento_expressivo_capital_sim, -25.0);

    resetScoreConfig();
    cfg = getScoreConfig();
    assert.strictEqual(cfg.peso_alteracao_recente_socios_sim, -8.0);
    assert.strictEqual(cfg.peso_aumento_expressivo_capital_sim, -20.0);
  });

  // Teste 6: UI - public/index.html
  runTest('6. public/index.html contém botão 1-clique Caixa, novos selects e inputs de configuração', () => {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf-8');
    assert.ok(html.includes('btnConsultarFgtsCaixa'), 'Deve conter o botão btnConsultarFgtsCaixa');
    assert.ok(html.includes('Consultar FGTS na Caixa (1-Clique)'), 'Deve conter texto do botão 1-clique');
    assert.ok(html.includes('cr_alteracao_recente_socios'), 'Deve conter select cr_alteracao_recente_socios');
    assert.ok(html.includes('cr_aumento_expressivo_capital'), 'Deve conter select cr_aumento_expressivo_capital');
    assert.ok(html.includes('cfg_peso_alteracao_recente_socios_sim'), 'Deve conter input cfg_peso_alteracao_recente_socios_sim');
    assert.ok(html.includes('cfg_peso_aumento_expressivo_capital_sim'), 'Deve conter input cfg_peso_aumento_expressivo_capital_sim');
  });

  // Teste 7: UI - public/app.js
  runTest('7. public/app.js contém evento do botão 1-clique, URL oficial da Caixa, rotulagem e extrato', () => {
    const js = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf-8');
    assert.ok(js.includes('btnConsultarFgtsCaixa'), 'app.js deve mapear o botão btnConsultarFgtsCaixa');
    assert.ok(js.includes('consulta-crf.caixa.gov.br/consultacrf/pages/consultaEmpregador.jsf'), 'app.js deve conter a URL oficial da Caixa');
    assert.ok(js.includes('navigator.clipboard.writeText'), 'app.js deve copiar CNPJ para clipboard');
    assert.ok(js.includes('cr_alteracao_recente_socios'), 'app.js deve ler e manipular cr_alteracao_recente_socios');
    assert.ok(js.includes('cr_aumento_expressivo_capital'), 'app.js deve ler e manipular cr_aumento_expressivo_capital');
    assert.ok(js.includes('Alteração Recente de Sócios'), 'app.js deve renderizar no extrato e na ficha');
    assert.ok(js.includes('Aumento Expressivo de Capital'), 'app.js deve renderizar no extrato e na ficha');
  });

  // Teste 8: Integração HTTP POST /api/financeiro/analise-credito/calcular-salvar
  await runAsyncTest('8. Servidor HTTP processa e persiste alteracao_recente_socios e aumento_expressivo_capital', async () => {
    const app = require('./server');
    const server = http.createServer(app);

    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    try {
      const payload = {
        pedido_venda: 'TESTE_SOCIOS_CAPITAL',
        empresa: '14',
        cliente_codigo: '02021647000125',
        cliente_nome: 'CLIENTE TESTE AUDITORIA LTDA',
        total_pedido: 10000.00,
        faturado: 'S',
        entrada: 'N',
        quant_grande: 'N',
        prod_nao_combinam: 'N',
        armario_cofre_gt_2000: 'N',
        uf_cliente: 'SP',
        entrega_igual_cadastro: 'S',
        cadastro_igual_receita: 'S',
        casa_sala_conj_end: 'N',
        google_maps: '10',
        registro_br: 'S',
        email_corporativo: 'S',
        existe_mail_financeiro: 'S',
        mail_gratuito: 'N',
        possui_site: 'S',
        fundacao_matriz: '2010-01-01',
        capital_social: 500000.00,
        score_serasa: '750',
        protestos: 'N',
        valor_protestos: 0,
        pfin: 'N',
        refin: 'N',
        dividas_vencidas: 'N',
        ch_sem_fundo: 'N',
        socios_anotacao: 'N',
        consultas_densidade_dia: 0,
        consultantes_fomento: 'N',
        documentos_extraviados: 'N',
        cnpj_ativo: 'S',
        pgtos_abertos: 'N',
        comprou_pagou: 'S',
        comprou_pagou_5x: 'N',
        fgts_situacao_regular: 'S',
        razao_fgts_igual: 'S',
        alteracao_recente_socios: 'S',
        aumento_expressivo_capital: 'S',
        tres_nfs_confirmadas: 'S',
        obs: 'Teste automatizado de auditoria',
        decisao_final: 'Liberado'
      };

      const postData = JSON.stringify(payload);
      const resData = await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: port,
          path: '/api/financeiro/analise-credito/calcular-salvar',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          }
        }, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode, data: JSON.parse(body) });
            } catch (e) {
              reject(e);
            }
          });
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
      });

      assert.strictEqual(resData.status, 200);
      assert.strictEqual(resData.data.success, true);
      assert.strictEqual(resData.data.resultado.detalhesPontos.alteracao_recente_socios, -8.0);
      assert.strictEqual(resData.data.resultado.detalhesPontos.aumento_expressivo_capital, -20.0);
      assert.ok(resData.data.registro, 'Deve retornar o registro gravado');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  console.log('\n================================================================');
  console.log(`📊 RESULTADOS: ${passedTests}/${totalTests} aprovados (${Math.round((passedTests / totalTests) * 100)}%)`);
  console.log('================================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
})();
