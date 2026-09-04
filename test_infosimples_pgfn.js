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
console.log('🧪 INICIANDO TESTES: INFOSIMPLES DÍVIDA ATIVA PGFN & SCORE');
console.log('================================================================\n');

(async () => {
  // 1. DEFAULT_CONFIG
  test('1. DEFAULT_CONFIG possui pesos oficiais de Dívida Ativa PGFN (Zero = +2, > 50k = -7, > Capital = -20)', () => {
    assert.strictEqual(DEFAULT_CONFIG.peso_pgfn_zero, 2.0);
    assert.strictEqual(DEFAULT_CONFIG.peso_pgfn_gt_50k, -7.0);
    assert.strictEqual(DEFAULT_CONFIG.peso_pgfn_gt_capital, -20.0);
  });

  // 2. Cálculo de Score - Empresa sem Dívida Ativa PGFN (R$ 0,00 ➔ +2 pts)
  test('2. calcularScore pontua +2 pts quando pgfn_total_divida = 0', () => {
    const dados = {
      total_pedido: 1000,
      faturado: 'S',
      pgfn_total_divida: 0,
      pgfn_executado: true
    };
    const res = calcularScore(dados);
    assert.strictEqual(res.detalhesPontos.pgfn_divida_ativa, 2.0, 'Dívida R$ 0 deve somar +2 pts');
  });

  // 3. Cálculo de Score - Empresa com Dívida > R$ 50k (mas <= Capital Social ➔ -7 pts)
  test('3. calcularScore pontua -7 pts quando pgfn_total_divida > 50.000 e <= Capital Social', () => {
    const dados = {
      total_pedido: 1000,
      faturado: 'S',
      capital_social: 100000,
      pgfn_total_divida: 60000,
      pgfn_executado: true
    };
    const res = calcularScore(dados);
    assert.strictEqual(res.detalhesPontos.pgfn_divida_ativa, -7.0, 'Dívida > 50k deve pontuar -7 pts');
  });

  // 4. Cálculo de Score - Empresa com Dívida > Capital Social ➔ -20 pts (Precedência estrita sobre os -7 pts)
  test('4. calcularScore pontua -20 pts quando pgfn_total_divida > Capital Social', () => {
    const dados = {
      total_pedido: 1000,
      faturado: 'S',
      capital_social: 100000,
      pgfn_total_divida: 150000,
      pgfn_executado: true
    };
    const res = calcularScore(dados);
    assert.strictEqual(res.detalhesPontos.pgfn_divida_ativa, -20.0, 'Dívida > Capital deve pontuar -20 pts');
  });

  // 5. Cálculo de Score - Empresa com Dívida pequena (ex: R$ 10.000 <= 50k e <= Capital ➔ 0 pts neutro)
  test('5. calcularScore pontua 0 pts quando dívida ativa está entre R$ 0,01 e R$ 50.000 (<= Capital)', () => {
    const dados = {
      total_pedido: 1000,
      faturado: 'S',
      capital_social: 100000,
      pgfn_total_divida: 10000,
      pgfn_executado: true
    };
    const res = calcularScore(dados);
    assert.strictEqual(res.detalhesPontos.pgfn_divida_ativa, 0, 'Dívida intermediária <= 50k deve ser neutra (0 pts)');
  });

  // 6. Fail-Neutral: Consulta PGFN offline, timeout ou não executada ➔ 0 pts sem prejudicar o cliente
  test('6. calcularScore é Fail-Neutral (0 pts) quando PGFN não foi consultada ou falhou', () => {
    const dadosNaoConsultado = {
      total_pedido: 1000,
      faturado: 'S',
      pgfn_total_divida: null,
      pgfn_executado: false
    };
    const res = calcularScore(dadosNaoConsultado);
    assert.strictEqual(res.detalhesPontos.pgfn_divida_ativa, 0, 'PGFN offline/não consultada deve ser 0 pts');
  });

  // 7. Persistência de Configurações de Pesos da PGFN
  test('7. saveScoreConfig e resetScoreConfig persistem e restauram pesos da PGFN', () => {
    const custom = {
      peso_pgfn_zero: 3.0,
      peso_pgfn_gt_50k: -10.0,
      peso_pgfn_gt_capital: -25.0
    };
    saveScoreConfig(custom);
    let cfg = getScoreConfig();
    assert.strictEqual(cfg.peso_pgfn_zero, 3.0);
    assert.strictEqual(cfg.peso_pgfn_gt_50k, -10.0);
    assert.strictEqual(cfg.peso_pgfn_gt_capital, -25.0);

    resetScoreConfig();
    cfg = getScoreConfig();
    assert.strictEqual(cfg.peso_pgfn_zero, 2.0);
    assert.strictEqual(cfg.peso_pgfn_gt_50k, -7.0);
    assert.strictEqual(cfg.peso_pgfn_gt_capital, -20.0);
  });

  // 8. Verificação no public/index.html
  test('8. public/index.html contém botão Consultar PGFN, badge e inputs de pesos', () => {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf-8');
    assert(html.includes('id="btnConsultarPgfnInfoSimples"'), 'Deve conter botão Consultar PGFN InfoSimples');
    assert(html.includes('id="cr_pgfn_badge"'), 'Deve conter badge cr_pgfn_badge');
    assert(html.includes('id="cr_pgfn_total_divida"'), 'Deve conter input hidden cr_pgfn_total_divida');
    assert(html.includes('id="cr_pgfn_executado"'), 'Deve conter input hidden cr_pgfn_executado');
    assert(html.includes('id="cfg_peso_pgfn_zero"'), 'Deve conter input cfg_peso_pgfn_zero');
    assert(html.includes('id="cfg_peso_pgfn_gt_50k"'), 'Deve conter input cfg_peso_pgfn_gt_50k');
    assert(html.includes('id="cfg_peso_pgfn_gt_capital"'), 'Deve conter input cfg_peso_pgfn_gt_capital');
  });

  // 9. Verificação no public/app.js
  test('9. public/app.js contém renderPgfnBadge, chamada ao endpoint /consultar-pgfn e cálculo frontend', () => {
    const js = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf-8');
    assert(js.includes('renderPgfnBadge'), 'Deve conter função renderPgfnBadge');
    assert(js.includes('/api/financeiro/analise-credito/consultar-pgfn'), 'Deve chamar endpoint de consulta PGFN');
    assert(js.includes('cr_pgfn_badge'), 'Deve manipular badge de PGFN');
    assert(js.includes('cr_pgfn_total_divida'), 'Deve ler valor de cr_pgfn_total_divida');
    assert(js.includes('peso_pgfn_zero'), 'Deve referenciar peso_pgfn_zero');
    assert(js.includes('peso_pgfn_gt_50k'), 'Deve referenciar peso_pgfn_gt_50k');
    assert(js.includes('peso_pgfn_gt_capital'), 'Deve referenciar peso_pgfn_gt_capital');
  });

  // 10. Servidor HTTP: Endpoint POST /api/financeiro/analise-credito/consultar-pgfn
  const app = require('./server');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    await asyncTest('10. Servidor HTTP expõe endpoint POST /api/financeiro/analise-credito/consultar-pgfn com tratamento de erro e fail-neutral', async () => {
      // Teste sem CNPJ (deve retornar 400)
      const postSemCnpj = JSON.stringify({});
      const resSemCnpj = await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: port,
          path: '/api/financeiro/analise-credito/consultar-pgfn',
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
      const postComCnpj = JSON.stringify({ cnpj: '02021647000125' });
      const resComCnpj = await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: port,
          path: '/api/financeiro/analise-credito/consultar-pgfn',
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
      assert.strictEqual(typeof resComCnpj.data.resultado, 'object');
    });

    // 11. Integridade do DOM: inputs hidden da PGFN NÃO devem ser filhos do container cr_pgfn_badge (prevenção de destruição via innerHTML)
    test('11. Integridade do DOM: inputs hidden da PGFN são irmãos (não filhos) de cr_pgfn_badge', () => {
      const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf-8');
      const badgeMatch = html.match(/<div id="cr_pgfn_badge"[^>]*>([\s\S]*?)<\/div>/);
      assert(badgeMatch, 'Deve conter div cr_pgfn_badge');
      const badgeInner = badgeMatch[1];
      assert(!badgeInner.includes('cr_pgfn_total_divida'), 'cr_pgfn_total_divida NÃO deve ser filho de cr_pgfn_badge');
      assert(!badgeInner.includes('cr_pgfn_executado'), 'cr_pgfn_executado NÃO deve ser filho de cr_pgfn_badge');
    });
  } finally {
    server.close();
  }

  console.log('\n================================================================');
  console.log(`🏁 RESUMO DOS TESTES: ${passCount} Aprovados | ${failCount} Falhas`);
  console.log('================================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
})();
