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

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passCount++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Erro: ${err.message}`);
    failCount++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passCount++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Erro: ${err.message}`);
    failCount++;
  }
}

console.log('================================================================');
console.log('🧪 INICIANDO TESTES: INFOSIMPLES FGTS CAIXA & NOVOS PESOS SCORE');
console.log('================================================================\n');

(async () => {
  // 1. DEFAULT_CONFIG
  test('1. DEFAULT_CONFIG possui pesos oficiais de FGTS (Regular = -6, Igual = +3, Divergente = -15, Não Encontrado = -5)', () => {
    assert.strictEqual(DEFAULT_CONFIG.peso_fgts_regular_nao, -6.0);
    assert.strictEqual(DEFAULT_CONFIG.peso_razao_fgts_igual_sim, 3.0);
    assert.strictEqual(DEFAULT_CONFIG.peso_razao_fgts_igual_nao, -15.0);
    assert.strictEqual(DEFAULT_CONFIG.peso_razao_fgts_nao_encontrado, -5.0);
    assert(DEFAULT_CONFIG.hasOwnProperty('infosimples_token'), 'Deve conter campo infosimples_token');
  });

  // 2. Cálculo de Score - Empresa com FGTS Regular e Razão Igual (+3 pts)
  test('2. calcularScore pontua +3 pts quando fgts_situacao_regular = S e razao_fgts_igual = S', () => {
    const dados = {
      total_pedido: 1000,
      faturado: 'S',
      fgts_situacao_regular: 'S',
      razao_fgts_igual: 'S'
    };
    const res = calcularScore(dados);
    assert.strictEqual(res.detalhesPontos.fgts_regular, 0, 'FGTS Regular deve ser 0 pts');
    assert.strictEqual(res.detalhesPontos.razao_fgts_igual, 3.0, 'Razão Igual deve ser +3 pts');
  });

  // 3. Cálculo de Score - Empresa com FGTS Regular mas Razão Divergente (-15 pts)
  test('3. calcularScore pontua -15 pts quando razao_fgts_igual = N (Divergente)', () => {
    const dados = {
      total_pedido: 1000,
      faturado: 'S',
      fgts_situacao_regular: 'S',
      razao_fgts_igual: 'N'
    };
    const res = calcularScore(dados);
    assert.strictEqual(res.detalhesPontos.fgts_regular, 0);
    assert.strictEqual(res.detalhesPontos.razao_fgts_igual, -15.0, 'Razão Divergente deve ser -15 pts');
  });

  // 4. Cálculo de Score - Empresa Não Encontrada no FGTS (-6 + -5 = -11 pts)
  test('4. calcularScore pontua -6 pts de irregular e -5 pts de Não Encontrada (NE)', () => {
    const dados = {
      total_pedido: 1000,
      faturado: 'S',
      fgts_situacao_regular: 'N',
      razao_fgts_igual: 'NE'
    };
    const res = calcularScore(dados);
    assert.strictEqual(res.detalhesPontos.fgts_regular, -6.0, 'FGTS Não Regular deve ser -6 pts');
    assert.strictEqual(res.detalhesPontos.razao_fgts_igual, -5.0, 'Razão Não Encontrada deve ser -5 pts');
  });

  // 5. Persistência de Configurações e Token InfoSimples
  test('5. saveScoreConfig e resetScoreConfig persistem e restauram token e pesos de FGTS', () => {
    const custom = {
      infosimples_token: 'token_teste_123456',
      peso_razao_fgts_igual_sim: 5.0,
      peso_razao_fgts_igual_nao: -20.0,
      peso_razao_fgts_nao_encontrado: -8.0
    };
    saveScoreConfig(custom);
    let cfg = getScoreConfig();
    assert.strictEqual(cfg.infosimples_token, 'token_teste_123456');
    assert.strictEqual(cfg.peso_razao_fgts_igual_sim, 5.0);
    assert.strictEqual(cfg.peso_razao_fgts_igual_nao, -20.0);
    assert.strictEqual(cfg.peso_razao_fgts_nao_encontrado, -8.0);

    resetScoreConfig();
    cfg = getScoreConfig();
    assert.strictEqual(cfg.peso_razao_fgts_igual_sim, 3.0);
    assert.strictEqual(cfg.peso_razao_fgts_igual_nao, -15.0);
    assert.strictEqual(cfg.peso_razao_fgts_nao_encontrado, -5.0);
  });

  // 6. Verificação no public/index.html
  test('6. public/index.html contém input de token InfoSimples, botão Consultar FGTS e selects atualizados', () => {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf-8');
    assert(html.includes('id="cfg_infosimples_token"'), 'Deve conter input de token InfoSimples');
    assert(html.includes('id="cfg_peso_razao_fgts_igual_sim"'), 'Deve conter input peso razao igual');
    assert(html.includes('id="cfg_peso_razao_fgts_igual_nao"'), 'Deve conter input peso razao divergente');
    assert(html.includes('id="cfg_peso_razao_fgts_nao_encontrado"'), 'Deve conter input peso razao nao encontrado');
    assert(html.includes('id="btnConsultarFgtsInfoSimples"'), 'Deve conter botão Consultar FGTS InfoSimples');
    assert(html.includes('id="cr_fgts_badge"'), 'Deve conter badge de status do FGTS');
    assert(html.includes('value="NE"'), 'Select de razão deve conter opção NE (Não Encontrado)');
  });

  // 7. Verificação no public/app.js
  test('7. public/app.js contém integração com /consultar-fgts, badge, rotulagem dinâmica e extrato Ficha', () => {
    const js = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf-8');
    assert(js.includes('btnConsultarFgtsInfoSimples'), 'Deve conter listener de btnConsultarFgtsInfoSimples');
    assert(js.includes('/api/financeiro/analise-credito/consultar-fgts'), 'Deve chamar endpoint de consulta FGTS');
    assert(js.includes('cr_fgts_badge'), 'Deve manipular badge de FGTS');
    assert(js.includes('peso_razao_fgts_nao_encontrado'), 'Deve referenciar peso_razao_fgts_nao_encontrado');
    assert(js.includes('infosimples_token'), 'Deve preservar token string no scoreConfigForm');
  });

  // 8. Servidor HTTP: Endpoint POST /api/financeiro/analise-credito/consultar-fgts
  await asyncTest('8. Servidor HTTP expõe endpoint POST /api/financeiro/analise-credito/consultar-fgts', async () => {
    const app = require('./server');
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
      // Teste sem CNPJ (deve retornar 400)
      const postSemCnpj = JSON.stringify({});
      const resSemCnpj = await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: port,
          path: '/api/financeiro/analise-credito/consultar-fgts',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postSemCnpj)
          }
        }, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(body) }));
        });
        req.on('error', reject);
        req.write(postSemCnpj);
        req.end();
      });
      assert.strictEqual(resSemCnpj.status, 400, 'Sem CNPJ deve retornar HTTP 400');

      // Teste com CNPJ válido (sem token configurado deve retornar executado: false com motivo explicativo sem travar o servidor)
      const postComCnpj = JSON.stringify({ cnpj: '02021647000125', razao_social: 'EMPRESA TESTE' });
      const resComCnpj = await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: port,
          path: '/api/financeiro/analise-credito/consultar-fgts',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postComCnpj)
          }
        }, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(body) }));
        });
        req.on('error', reject);
        req.write(postComCnpj);
        req.end();
      });
      assert.strictEqual(resComCnpj.status, 200, 'Deve retornar HTTP 200 com payload estruturado');
      assert.strictEqual(resComCnpj.data.success, true);
      assert(resComCnpj.data.resultado !== undefined);
      assert.strictEqual(typeof resComCnpj.data.resultado.executado, 'boolean');
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

  console.log('\n================================================================');
  console.log(`📊 RESULTADOS: ${passCount}/${passCount + failCount} aprovados (${Math.round((passCount / (passCount + failCount)) * 100)}%)`);
  console.log('================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
})();
