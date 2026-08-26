/**
 * test_capital_social_isento.js
 * 
 * Suíte de Testes Automatizados para:
 * 1. Tratamento de Capital Social Não Informado / Isento (Filiais, S.A., Sem Fins Lucrativos).
 * 2. Pontuação Neutra (0 pts configurável) sem aplicação indevida de penalidades de microempresa (-7 pts).
 * 3. Validação e gravação definitiva no banco permitindo capital social vazio com flag sem_capital_social: 'S'.
 * 4. Calibração personalizada na aba de configurações.
 * 5. Integração com endpoint HTTP calcular-salvar.
 */

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { calcularScore, DEFAULT_CONFIG } = require('./analise_credito_engine');

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

async function runTests() {
  console.log('\n=============================================================');
  console.log('🧪 SUÍTE DE TESTES: CAPITAL SOCIAL NÃO INFORMADO / ISENTO');
  console.log('=============================================================\n');

  // -------------------------------------------------------------
  // Teste 1: Empresa com Capital Social Não Informado (sem_capital_social: 'S')
  // -------------------------------------------------------------
  console.log('--- 1. Cálculo de Score: Capital Social Não Informado / Isento ---');
  try {
    const resIsento = calcularScore({
      empresa: '14',
      pedido_venda: '000500',
      total_pedido: 10000,
      faturado: 'S',
      entrada: 'N',
      sem_capital_social: 'S',
      capital_social: null,
      score_serasa: '750',
      protestos: 'N'
    });

    assert.strictEqual(resIsento.detalhesPontos.capital_social, 0, 'Pontos de capital social isento deve ser 0 pts');
    assert.ok(resIsento.detalhesPontos.capital_social !== -7, 'Não deve penalizar com -7 pts de microempresa');
    assert.strictEqual(resIsento.detalhesPontos.protestos_vs_capital, 0, 'Protestos vs Capital deve ser 0 para isento');

    report('Capital Social Não Informado recebe 0 pts (Neutro)', true);
  } catch (err) {
    report('Capital Social Não Informado recebe 0 pts (Neutro)', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 2: Empresa com Capital Social Informado (15M -> +12, 5k -> -7)
  // -------------------------------------------------------------
  console.log('\n--- 2. Cálculo de Score: Faixas Padrão de Capital Social ---');
  try {
    // 15 Milhões -> +12 pts
    const res15M = calcularScore({
      empresa: '14',
      pedido_venda: '000501',
      total_pedido: 10000,
      faturado: 'S',
      capital_social: 15000000,
      sem_capital_social: 'N',
      score_serasa: '750'
    });
    assert.strictEqual(res15M.detalhesPontos.capital_social, 12, 'Capital de 15M deve render +12 pts');

    // 5 Mil -> -7 pts (microempresa)
    const res5k = calcularScore({
      empresa: '14',
      pedido_venda: '000502',
      total_pedido: 10000,
      faturado: 'S',
      capital_social: 5000,
      sem_capital_social: 'N',
      score_serasa: '750'
    });
    assert.strictEqual(res5k.detalhesPontos.capital_social, -7, 'Capital de 5k deve aplicar -7 pts');

    report('Faixas Padrão de Capital Social (15M: +12, 5k: -7)', true);
  } catch (err) {
    report('Faixas Padrão de Capital Social (15M: +12, 5k: -7)', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 3: Calibração de Peso Customizado para Não Informado
  // -------------------------------------------------------------
  console.log('\n--- 3. Calibração Customizada: peso_capital_nao_informado ---');
  try {
    const configCustom = {
      ...DEFAULT_CONFIG,
      peso_capital_nao_informado: 2.0
    };

    const resCustom = calcularScore({
      empresa: '14',
      pedido_venda: '000503',
      total_pedido: 10000,
      faturado: 'S',
      sem_capital_social: 'S',
      capital_social: 0
    }, configCustom);

    assert.strictEqual(resCustom.detalhesPontos.capital_social, 2, 'Com peso_capital_nao_informado=2 deve pontuar +2 pts');

    report('Calibração personalizada de peso_capital_nao_informado', true);
  } catch (err) {
    report('Calibração personalizada de peso_capital_nao_informado', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 4: Elementos de Interface e Checkbox no HTML / CSS / JS
  // -------------------------------------------------------------
  console.log('\n--- 4. Validação de Elementos no HTML e JS ---');
  try {
    const htmlContent = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf-8');
    const jsContent = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf-8');

    assert.ok(htmlContent.includes('id="cr_sem_capital_social"'), 'HTML deve conter checkbox #cr_sem_capital_social');
    assert.ok(htmlContent.includes('id="cfg_peso_capital_nao_informado"'), 'HTML deve conter input #cfg_peso_capital_nao_informado');
    assert.ok(jsContent.includes('cr_sem_capital_social'), 'app.js deve referenciar cr_sem_capital_social');
    assert.ok(jsContent.includes('sem_capital_social'), 'app.js deve tratar sem_capital_social no payload');

    report('Presença de elementos de UI e scripts correspondentes', true);
  } catch (err) {
    report('Presença de elementos de UI e scripts correspondentes', false, err.message);
  }

  // -------------------------------------------------------------
  // Teste 5: Endpoint HTTP calcular-salvar com Capital Social Isento
  // -------------------------------------------------------------
  console.log('\n--- 5. Integração HTTP Endpoint POST /api/financeiro/analise-credito/calcular-salvar ---');
  try {
    const app = require('./server');
    const server = http.createServer(app);
    await new Promise(res => server.listen(0, res));
    const port = server.address().port;

    const payload = {
      empresa: '14',
      pedido_venda: 'TESTE-ISENTO-01',
      cliente_codigo: 'CLI001',
      cliente_nome: 'FILIAL EXEMPLO ALIMENTOS LTDA',
      total_pedido: 15000,
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
      possui_site: 'S',
      email_corporativo: 'S',
      existe_mail_financeiro: 'S',
      mail_gratuito: 'N',
      fundacao_matriz: '2015-05-10',
      sem_capital_social: 'S',
      capital_social: null,
      score_serasa: '750',
      protestos: 'N',
      pfin: 'N',
      refin: 'N',
      dividas_vencidas: 'N',
      ch_sem_fundo: 'N',
      socios_anotacao: 'N',
      cnpj_ativo: 'S',
      pgtos_abertos: 'N',
      comprou_pagou: 'S',
      comprou_pagou_5x: 'N',
      fgts_situacao_regular: 'S',
      razao_fgts_igual: 'S',
      tres_nfs_confirmadas: 'S',
      decisao_final: 'Liberado'
    };

    const postData = JSON.stringify(payload);

    const res = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: port,
        path: '/api/financeiro/analise-credito/calcular-salvar',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      }, (r) => {
        let data = '';
        r.on('data', chunk => data += chunk);
        r.on('end', () => resolve({ statusCode: r.statusCode, data: JSON.parse(data) }));
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    });

    server.close();

    assert.strictEqual(res.statusCode, 200, 'Status code HTTP deve ser 200');
    assert.strictEqual(res.data.success, true, 'Resposta deve indicar success: true');
    assert.strictEqual(res.data.resultado.detalhesPontos.capital_social, 0, 'Pontos de capital social gravados devem ser 0');
    assert.strictEqual(res.data.registro.sem_capital_social, 'S', 'Registro salvo deve conter sem_capital_social: S');

    report('Endpoint HTTP calcular-salvar com Capital Social Isento aceito e salvo', true);
  } catch (err) {
    report('Endpoint HTTP calcular-salvar com Capital Social Isento aceito e salvo', false, err.message);
  }

  // -------------------------------------------------------------
  // Resumo Final
  // -------------------------------------------------------------
  console.log('\n=============================================================');
  console.log(`📊 RESUMO DOS TESTES: ${passedTests} Aprovados, ${failedTests} Falhas`);
  console.log('=============================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests();
