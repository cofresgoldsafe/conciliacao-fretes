/**
 * test_nfse_pendentes.js
 * Suíte de testes automatizados para a funcionalidade de NFS-e Pendentes
 * no módulo FINANC. / 📑 ANALISTA FIN do Gemini-Cli.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// 1. Carregar módulos backend
const postgresDb = require('./postgres_db.js');

console.log('🧪 [TEST NFS-E PENDENTES] Iniciando validação completa...\n');

let totalTests = 0;
let passedTests = 0;

function runTest(description, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${description}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${description}:`, err.message);
  }
}

async function runAsyncTest(description, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ [PASS] ${description}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${description}:`, err.message);
  }
}

async function main() {
  // ── TESTES DE EXTRAÇÃO DO NÚMERO DA NFS-E ──────────────────────────────
  console.log('--- 1. Testes de Extração de Número da Chave ADN (50 dígitos) ---');

  runTest('Deve extrair o número 8 da NFS-e corretamente cortando modelo e zeros à esquerda', () => {
    const chave = '3550308210865578800018625000000000000000000008260281206191';
    const cnpj = '08655788000186';
    const data = '2026-02-10';
    const num = postgresDb.extrairNumeroNfse(chave, cnpj, data);
    assert.strictEqual(num, '8');
  });

  runTest('Deve extrair o número 31229 da NFS-e corretamente cortando modelo 25 e série 000', () => {
    const chave = '3550308213304126006529025000000000000000031229260170068864';
    const cnpj = '33041260065290';
    const data = '2026-01-20';
    const num = postgresDb.extrairNumeroNfse(chave, cnpj, data);
    assert.strictEqual(num, '31229');
  });

  runTest('Deve retornar vazio com segurança caso a chave seja nula ou curta', () => {
    assert.strictEqual(postgresDb.extrairNumeroNfse('', '123', '2026-01-01'), '');
    assert.strictEqual(postgresDb.extrairNumeroNfse(null, '123', '2026-01-01'), '');
    assert.strictEqual(postgresDb.extrairNumeroNfse('12345', '123', '2026-01-01'), '');
  });

  // ── TESTES DE CONSULTA E FILTROS EM MEMÓRIA / BANCO ───────────────────
  console.log('\n--- 2. Testes de Consulta, Filtros e KPIs (obterNfsePendentesDB) ---');

  await runAsyncTest('Deve carregar dados e retornar estrutura de resposta com KPIs e notas', async () => {
    const resultado = await postgresDb.obterNfsePendentesDB({
      status: 'PENDENTE',
      dias: 120,
    });

    assert.ok(resultado, 'Resultado não deve ser nulo');
    assert.ok(Array.isArray(resultado.notas), 'notas deve ser um Array');
    assert.ok(Array.isArray(resultado.itens), 'itens deve ser um Array (alias)');
    assert.ok(resultado.kpis, 'kpis deve existir');
    assert.strictEqual(typeof resultado.kpis.totalPendentes, 'number');
    assert.strictEqual(typeof resultado.kpis.valorTotalPendente, 'number');
    assert.ok(resultado.kpis.porEmpresa, 'kpis.porEmpresa deve existir');
  });

  await runAsyncTest('Filtro por empresa específica (ex: 15 GSI) deve retornar apenas notas da GSI', async () => {
    const resultado = await postgresDb.obterNfsePendentesDB({
      empresa: '15',
      status: 'PENDENTE',
      dias: 120,
    });

    assert.ok(resultado.notas.length > 0, 'Deve encontrar notas para a GSI');
    for (const item of resultado.notas) {
      assert.strictEqual(item.empresa_cod_protheus, '15', `Nota ${item.numero_nota} deve ser da empresa 15`);
    }
  });

  await runAsyncTest('Filtro de data (dataInicio e dataFim) deve respeitar o intervalo', async () => {
    const dataInicio = '2026-01-01';
    const dataFim = '2026-01-31';
    const resultado = await postgresDb.obterNfsePendentesDB({
      dataInicio,
      dataFim,
      status: 'TODAS',
    });

    assert.ok(resultado.notas.length > 0, 'Deve encontrar notas no mês de janeiro');
    for (const item of resultado.notas) {
      if (item.data_emissao) {
        const dt = String(item.data_emissao).slice(0, 10);
        assert.ok(dt >= dataInicio, `Data ${dt} deve ser >= ${dataInicio}`);
        assert.ok(dt <= dataFim, `Data ${dt} deve ser <= ${dataFim}`);
      }
    }
  });

  // ── TESTES DE INTEGRIDADE DO FRONTEND (HTML / DOM / JS) ────────────────
  console.log('\n--- 3. Testes de Integridade da UI (index.html & scripts) ---');

  runTest('index.html deve conter o botão da sub-aba no subgrupo do Analista Financeiro', () => {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    assert.ok(html.includes('id="btnTabNfsePendentes"'), 'Deve conter botão #btnTabNfsePendentes');
    assert.ok(html.includes('🧾 NFS-e Pendentes'), 'Deve exibir o rótulo da sub-aba');
    assert.ok(html.includes('id="subGroupAnalistaFin"'), 'Deve estar dentro do subgrupo do analista fin');
  });

  runTest('index.html deve conter a section #tab-nfse-pendentes com todos os seletores requeridos', () => {
    const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    assert.ok(html.includes('id="tab-nfse-pendentes"'), 'Deve conter o painel #tab-nfse-pendentes');
    assert.ok(html.includes('id="filtroNfseEmpresa"'), 'Deve conter seletor de empresa');
    assert.ok(html.includes('id="filtroNfseDe"'), 'Deve conter input de data De');
    assert.ok(html.includes('id="filtroNfseAte"'), 'Deve conter input de data Até');
    assert.ok(html.includes('id="btnSyncNfseProtheus"'), 'Deve conter botão de sincronização Protheus');
    assert.ok(html.includes('id="btnExportarNfseCsv"'), 'Deve conter botão de exportação CSV');
    assert.ok(html.includes('id="tableNfsePendentes"'), 'Deve conter tabela de listagem');
    assert.ok(html.includes('id="nfseZeroPendenciasCard"'), 'Deve conter card de zero pendências');
    assert.ok(html.includes('id="nfseConfettiCanvas"'), 'Deve conter canvas de confetes');
    assert.ok(html.includes('id="modalNfseDetalhes"'), 'Deve conter modal de detalhes');
    assert.ok(html.includes('src="js/nfse_pendentes.js'), 'Deve carregar o script js/nfse_pendentes.js');
  });

  runTest('public/app.js deve acionar o módulo nfsePendentes ao trocar para a aba', () => {
    const appJs = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
    assert.ok(appJs.includes("targetTab === 'tab-nfse-pendentes'"), 'Deve mapear troca para tab-nfse-pendentes');
    assert.ok(appJs.includes('window.nfsePendentesModule.init()'), 'Deve inicializar o módulo via init()');
  });

  runTest('public/js/nfse_pendentes.js deve ser sintaticamente válido e encapsulado', () => {
    const scriptCode = fs.readFileSync(path.join(__dirname, 'public', 'js', 'nfse_pendentes.js'), 'utf8');
    const sandbox = {
      window: {},
      document: {
        getElementById: () => null,
        querySelectorAll: () => [],
      },
      console: console,
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
      requestAnimationFrame: () => {},
    };
    const script = new vm.Script(scriptCode);
    assert.doesNotThrow(() => {
      script.runInNewContext(sandbox);
    }, 'O script não deve lançar exceção léxica ou de compilação');

    assert.ok(sandbox.window.nfsePendentesModule, 'Deve expor window.nfsePendentesModule');
    assert.strictEqual(typeof sandbox.window.nfsePendentesModule.init, 'function');
    assert.strictEqual(typeof sandbox.window.nfsePendentesModule.carregarNfse, 'function');
    assert.strictEqual(typeof sandbox.window.nfsePendentesModule.alternarOrdenacao, 'function');
    assert.strictEqual(typeof sandbox.window.nfsePendentesModule.exportarCsv, 'function');
    assert.strictEqual(typeof sandbox.window.nfsePendentesModule.dispararConfetesElegantes, 'function');
  });

  // ── TESTES DE ROTAS NO SERVER.JS ──────────────────────────────────────
  console.log('\n--- 4. Testes de Rotas da API em server.js ---');

  runTest('server.js deve ter registradas as 4 rotas de NFS-e do Analista Financeiro', () => {
    const serverJs = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    assert.ok(serverJs.includes("app.get('/api/analista-fin/nfse/pendentes'"), 'Deve conter GET /api/analista-fin/nfse/pendentes');
    assert.ok(serverJs.includes("app.post('/api/analista-fin/nfse/sincronizar'"), 'Deve conter POST /api/analista-fin/nfse/sincronizar');
    assert.ok(serverJs.includes("app.post('/api/analista-fin/nfse/ingest'"), 'Deve conter POST /api/analista-fin/nfse/ingest');
    assert.ok(serverJs.includes("app.patch('/api/analista-fin/nfse/:chaveAcesso/status'"), 'Deve conter PATCH /api/analista-fin/nfse/:chaveAcesso/status');
  });

  console.log(`\n==============================================`);
  console.log(`🎯 TOTAL DE TESTES: ${totalTests} | APROVADOS: ${passedTests} | FALHAS: ${totalTests - passedTests}`);
  console.log(`==============================================\n`);

  if (totalTests !== passedTests) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error in test suite:', err);
  process.exit(1);
});
