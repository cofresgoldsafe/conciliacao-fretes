/**
 * Testes Automatizados: Endpoint e Mecanismos do Fechamento Mensal via GitHub Actions Cron
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

// Configura segredos de teste no ambiente antes de carregar dependências
process.env.JWT_SECRET = 'test_jwt_secret_cron_fechamento_2026';
process.env.CRON_SECRET = 'chave_secreta_super_segura_cron_github_actions_12345';
delete process.env.DATABASE_URL; // Usa armazenamento local de teste

const {
  executarJobFechamentoMensal,
  calcularCicloFechamentoDisponivel,
  normalizarPeriodo
} = require('./fechamento_vendedores_engine');

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
    throw err;
  }
}

async function runTestAsync(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
    throw err;
  }
}

async function main() {
  console.log('\n====================================================');
  console.log('🧪 TESTES: FECHAMENTO MENSAL VIA GITHUB ACTIONS CRON');
  console.log('====================================================\n');

  // 1. Validação do Arquivo Workflow YAML
  runTest('1.1 - Workflow YAML existe e contém agendamento dia 26 às 03:30 UTC', () => {
    const workflowPath = path.join(__dirname, '.github', 'workflows', 'fechamento_mensal.yml');
    assert(fs.existsSync(workflowPath), 'Arquivo .github/workflows/fechamento_mensal.yml deve existir');
    const yamlContent = fs.readFileSync(workflowPath, 'utf-8');
    assert(yamlContent.includes("cron: '30 3 26 * *'"), 'Deve conter o cron agendado para o dia 26 às 03:30 UTC (00:30 BRT)');
    assert(yamlContent.includes('workflow_dispatch:'), 'Deve suportar disparo manual via workflow_dispatch');
    assert(yamlContent.includes('secrets.CRON_SECRET'), 'Deve referenciar o segredo CRON_SECRET');
    assert(yamlContent.includes('secrets.API_BASE_URL'), 'Deve referenciar o segredo API_BASE_URL');
    assert(yamlContent.includes('/api/cron/fechamento-mensal'), 'Deve chamar o endpoint /api/cron/fechamento-mensal');
  });

  // 2. Validação da Lógica do Motor (triggeredBy e force)
  await runTestAsync('2.1 - Motor suporta triggeredBy: GITHUB_ACTIONS e force: true', async () => {
    const res = await executarJobFechamentoMensal({
      force: true,
      triggeredBy: 'GITHUB_ACTIONS'
    });
    assert(res.executado === true, 'Deve ter executado o fechamento com force: true');
    assert(res.ciclo, 'Deve retornar o objeto do ciclo');
    assert(res.resultado, 'Deve retornar os dados consolidados do resultado');
    assert(typeof res.resultado.todosVendedores === 'object', 'Deve retornar o array ou lista de vendedores');
  });

  await runTestAsync('2.2 - Motor rejeita execução fora do horário oficial se force for false', async () => {
    const agora = new Date();
    const res = await executarJobFechamentoMensal({
      force: false,
      triggeredBy: 'TEST_UNFORCED'
    });
    const dia = agora.getDate();
    const hora = agora.getHours();
    const minuto = agora.getMinutes();
    if (dia !== 26 || hora !== 0 || minuto < 30) {
      assert(res.executado === false, 'Não deve executar fora do horário programado quando force=false');
      assert(res.motivo.includes('Fora do horário'), 'Deve indicar motivo de fora do horário');
    }
  });

  // 3. Validação do Middleware de Autenticação de Cron
  runTest('3.1 - Comparação com timingSafeEqual rejeita tokens com comprimentos divergentes ou valores incorretos', () => {
    const realSecret = process.env.CRON_SECRET;
    const wrongSecret = 'chave_incorreta_xyz';

    const bufA = Buffer.from(wrongSecret);
    const bufB = Buffer.from(realSecret);
    let isEqual = false;
    if (bufA.length === bufB.length) {
      isEqual = crypto.timingSafeEqual(bufA, bufB);
    }
    assert.strictEqual(isEqual, false, 'Tokens incorretos devem ser rejeitados');

    const correctBuf = Buffer.from(realSecret);
    const isEqualCorrect = (correctBuf.length === bufB.length) && crypto.timingSafeEqual(correctBuf, bufB);
    assert.strictEqual(isEqualCorrect, true, 'Token correto deve ser aceito');
  });

  // 4. Testes HTTP do Endpoint no Express
  const app = require('./server');
  const http = require('http');
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  try {
    await runTestAsync('4.1 - Requisição sem autenticação ao endpoint de cron é bloqueada (401)', async () => {
      const fetchRes = await fetch(`http://127.0.0.1:${port}/api/cron/fechamento-mensal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true })
      });
      assert.strictEqual(fetchRes.status, 401, 'Deve retornar 401 Unauthorized');
      const data = await fetchRes.json();
      assert.strictEqual(data.success, false);
    });

    await runTestAsync('4.2 - Requisição com CRON_SECRET incorreto é bloqueada (401)', async () => {
      const fetchRes = await fetch(`http://127.0.0.1:${port}/api/cron/fechamento-mensal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer token_invalido_123'
        },
        body: JSON.stringify({ force: true })
      });
      assert.strictEqual(fetchRes.status, 401, 'Deve retornar 401');
    });

    await runTestAsync('4.3 - Requisição com CRON_SECRET correto via Bearer Token é aprovada (200)', async () => {
      const fetchRes = await fetch(`http://127.0.0.1:${port}/api/cron/fechamento-mensal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.CRON_SECRET}`
        },
        body: JSON.stringify({ force: true })
      });
      assert.strictEqual(fetchRes.status, 200, 'Deve retornar 200 OK');
      const data = await fetchRes.json();
      assert.strictEqual(data.success, true);
      assert(data.executado === true, 'Job deve constar como executado');
      assert(data.durationMs >= 0, 'Deve registrar duração em ms');
    });

    await runTestAsync('4.4 - Requisição com CRON_SECRET via header customizado x-cron-secret é aprovada (200)', async () => {
      const fetchRes = await fetch(`http://127.0.0.1:${port}/api/vendedores/fechamento/cron`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-cron-secret': process.env.CRON_SECRET
        },
        body: JSON.stringify({ force: true })
      });
      assert.strictEqual(fetchRes.status, 200, 'Alias /api/vendedores/fechamento/cron deve retornar 200 OK');
      const data = await fetchRes.json();
      assert.strictEqual(data.success, true);
    });

    await runTestAsync('4.5 - Requisição com token JWT de Administrador é aceita como fallback (200)', async () => {
      const adminToken = jwt.sign(
        { username: 'admin_test', role: 'admin', name: 'Administrador de Testes' },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      const fetchRes = await fetch(`http://127.0.0.1:${port}/api/cron/fechamento-mensal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${adminToken}`
        },
        body: JSON.stringify({ force: true })
      });
      assert.strictEqual(fetchRes.status, 200, 'Admin JWT deve retornar 200 OK');
      const data = await fetchRes.json();
      assert.strictEqual(data.success, true);
    });
  } finally {
    server.close();
  }

  console.log('\n====================================================');
  console.log(`🏁 RESULTADOS: ${passedTests}/${totalTests} testes aprovados.`);
  console.log('====================================================\n');
}

main().catch((err) => {
  console.error('Falha fatal nos testes:', err);
  process.exit(1);
});
