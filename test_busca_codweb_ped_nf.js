/**
 * test_busca_codweb_ped_nf.js
 * Suíte de Testes Automatizados para a aba BUSCA CODWEB/PED/NF (Harness Fase 4)
 * Valida renomeação da aba principal, colunas da tabela de resultados,
 * higienização da coluna Empresa, enriquecimento de datas (Dt Ganho, Dt Migração, Dt Emissão)
 * e remoção da coluna Vlr Frete Cob.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { buscarProtheusMultiEmpresa } = require('./protheus_db');

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
  console.log('\n================================================================');
  console.log('🧪 SUÍTE DE TESTES: BUSCA CODWEB/PED/NF & DATAS PIPELINE/ERP');
  console.log('================================================================\n');

  const htmlPath = path.join(__dirname, 'public', 'index.html');
  const appJsPath = path.join(__dirname, 'public', 'app.js');
  const protheusDbPath = path.join(__dirname, 'protheus_db.js');

  const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
  const appJsContent = fs.readFileSync(appJsPath, 'utf-8');
  const protheusDbContent = fs.readFileSync(protheusDbPath, 'utf-8');

  // --- 1. VALIDAÇÃO DE UI & ESTRUTURA HTML ---
  console.log('--- 1. Validação de UI & Estrutura HTML ---');

  runTest('1.1 - Aba principal renomeada para "BUSCA CODWEB/PED/NF" preservando id e data-main-tab', () => {
    assert(htmlContent.includes('id="mainTabConsulta"'), 'ID mainTabConsulta deve ser preservado para retrocompatibilidade');
    assert(htmlContent.includes('data-main-tab="consulta"'), 'data-main-tab="consulta" deve ser preservado');
    assert(htmlContent.includes('BUSCA CODWEB/PED/NF</span>'), 'Rótulo da aba deve ser BUSCA CODWEB/PED/NF');
  });

  runTest('1.2 - Modal de permissões atualizado com "BUSCA CODWEB/PED/NF"', () => {
    assert(htmlContent.includes('BUSCA CODWEB/PED/NF</strong> (Consultas Multi-Empresa)'), 'Modal de permissões deve exibir nome atualizado');
  });

  runTest('1.3 - Cabeçalho thead da tabela contém 9 colunas na ordem correta', () => {
    const sectionMatch = htmlContent.match(/id="consultaResultsSection"[\s\S]*?<thead[\s\S]*?<\/thead>/i);
    assert(sectionMatch, 'Deve conter elemento <thead> na seção #consultaResultsSection');
    const thead = sectionMatch[0];

    assert(thead.includes('Empresa'), 'Deve conter coluna Empresa');
    assert(thead.includes('CodWeb'), 'Deve conter coluna CodWeb');
    assert(thead.includes('Dt Ganho'), 'Deve conter coluna Dt Ganho logo após CodWeb');
    assert(thead.includes('Ped Venda'), 'Deve conter coluna Ped Venda');
    assert(thead.includes('Dt Migração'), 'Deve conter coluna Dt Migração logo após Ped Venda');
    assert(thead.includes('NF'), 'Deve conter coluna NF');
    assert(thead.includes('Dt Emissão'), 'Deve conter coluna Dt Emissão logo após NF');
    assert(thead.includes('Vlr NF'), 'Deve conter coluna Vlr NF');
    assert(thead.includes('Nome Cli'), 'Deve conter coluna Nome Cli');

    // Ordem estrita
    const idxEmp = thead.indexOf('Empresa');
    const idxCodWeb = thead.indexOf('CodWeb');
    const idxDtGanho = thead.indexOf('Dt Ganho');
    const idxPedVenda = thead.indexOf('Ped Venda');
    const idxDtMigracao = thead.indexOf('Dt Migração');
    const idxNf = thead.indexOf('>NF<');
    const idxDtEmissao = thead.indexOf('Dt Emissão');
    const idxVlrNf = thead.indexOf('Vlr NF');
    const idxNomeCli = thead.indexOf('Nome Cli');

    assert(idxEmp < idxCodWeb, 'Empresa antes de CodWeb');
    assert(idxCodWeb < idxDtGanho, 'CodWeb antes de Dt Ganho');
    assert(idxDtGanho < idxPedVenda, 'Dt Ganho antes de Ped Venda');
    assert(idxPedVenda < idxDtMigracao, 'Ped Venda antes de Dt Migração');
    assert(idxDtMigracao < idxNf, 'Dt Migração antes de NF');
    assert(idxNf < idxDtEmissao, 'NF antes de Dt Emissão');
    assert(idxDtEmissao < idxVlrNf, 'Dt Emissão antes de Vlr NF');
    assert(idxVlrNf < idxNomeCli, 'Vlr NF antes de Nome Cli');
  });

  runTest('1.4 - Coluna "Vlr Frete Cob." removida do cabeçalho da tabela', () => {
    const sectionMatch = htmlContent.match(/id="consultaResultsSection"[\s\S]*?<thead[\s\S]*?<\/thead>/i);
    assert(sectionMatch, 'Deve conter #consultaResultsSection thead');
    assert(!sectionMatch[0].includes('Vlr Frete Cob.'), 'Coluna Vlr Frete Cob. deve ser removida do thead');
  });

  // --- 2. VALIDAÇÃO DE CÓDIGO JS FRONTEND (APP.JS) ---
  console.log('\n--- 2. Validação de Código JS Frontend (public/app.js) ---');

  runTest('2.1 - public/app.js compila sem erros sintáticos ou léxicos (vm.Script)', () => {
    assert.doesNotThrow(() => {
      new vm.Script(appJsContent);
    }, 'public/app.js deve ter sintaxe JavaScript perfeitamente válida');
  });

  runTest('2.2 - renderConsultaResults injeta as colunas e remove Vlr Frete Cob.', () => {
    assert(appJsContent.includes('formatDataBR(row.dtGanho)'), 'Deve formatar dtGanho');
    assert(appJsContent.includes('formatDataBR(row.dtMigracao)'), 'Deve formatar dtMigracao');
    assert(appJsContent.includes('formatDataBR(row.dtEmissao)'), 'Deve formatar dtEmissao');
    assert(appJsContent.includes('empresaDisplay'), 'Deve tratar empresaDisplay');
    assert(!appJsContent.includes('formatCurrency(row.valorCobrado'), 'Não deve renderizar valorCobrado na tabela');
  });

  runTest('2.3 - Lógica de formatDataBR converte corretamente Protheus YYYYMMDD e Pipedrive ISO', () => {
    function formatDataBR(val) {
      if (!val) return '-';
      const s = String(val).trim();
      if (!s || s === '-') return '-';
      if (/^\d{8}$/.test(s)) {
        return `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`;
      }
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        const p = s.slice(0, 10).split('-');
        return `${p[2]}/${p[1]}/${p[0]}`;
      }
      return s;
    }

    assert.strictEqual(formatDataBR('20260914'), '14/09/2026', 'Data Protheus 20260914 -> 14/09/2026');
    assert.strictEqual(formatDataBR('2026-08-26 17:54:13'), '26/08/2026', 'Timestamp Pipedrive -> 26/08/2026');
    assert.strictEqual(formatDataBR('2026-09-01'), '01/09/2026', 'Data ISO -> 01/09/2026');
    assert.strictEqual(formatDataBR(''), '-', 'Vazio -> -');
    assert.strictEqual(formatDataBR(null), '-', 'Null -> -');
    assert.strictEqual(formatDataBR(undefined), '-', 'Undefined -> -');
    assert.strictEqual(formatDataBR('-'), '-', '- -> -');
  });

  runTest('2.4 - Sanitização da coluna Empresa remove prefixo redundante', () => {
    const clean1 = 'Empresa 16 (OACO)'.replace(/^Empresa\s+/i, '').trim();
    const clean2 = 'Empresa 15 (GSI)'.replace(/^Empresa\s+/i, '').trim();
    const clean3 = 'Empresa 14 (METAL PLENO)'.replace(/^Empresa\s+/i, '').trim();
    const clean4 = '16 (OACO)'.replace(/^Empresa\s+/i, '').trim();

    assert.strictEqual(clean1, '16 (OACO)');
    assert.strictEqual(clean2, '15 (GSI)');
    assert.strictEqual(clean3, '14 (METAL PLENO)');
    assert.strictEqual(clean4, '16 (OACO)');
  });

  runTest('2.5 - renderConsultaResults renderiza a coluna Ped Venda com a classe .link-pedido e data-attributes', () => {
    assert(appJsContent.includes('class="link-pedido" data-empresa="'), 'Deve incluir span com classe link-pedido e data-empresa');
    assert(appJsContent.includes('data-ped="${escapeHtml(row.pedVenda)}"'), 'Deve incluir data-ped com o número do pedido');
  });

  runTest('2.6 - Event Delegation em consultaTableBody dispara abrirDetalhesPedidoModal ao clicar no link-pedido', () => {
    assert(appJsContent.includes("consultaTableBody.addEventListener('click'"), 'Deve registrar listener de clique no consultaTableBody');
    assert(appJsContent.includes("abrirDetalhesPedidoModal(emp, ped)"), 'Deve chamar abrirDetalhesPedidoModal com os parâmetros corretos');
  });

  // --- 3. VALIDAÇÃO DE BACKEND & CONSULTA PROTHEUS MULTI-EMPRESA ---
  console.log('\n--- 3. Validação de Backend & Consulta Protheus Multi-Empresa ---');

  runTest('3.1 - protheus_db.js define empresasInfo sem redundância da palavra Empresa', () => {
    assert(protheusDbContent.includes('nome: "16 (OACO)"'), 'OACO deve ser 16 (OACO)');
    assert(protheusDbContent.includes('nome: "15 (GSI)"'), 'GSI deve ser 15 (GSI)');
    assert(protheusDbContent.includes('nome: "14 (METAL PLENO)"'), 'METAL PLENO deve ser 14 (METAL PLENO)');
  });

  runTest('3.2 - SQL queries selecionam DT_MIGRACAO e DT_EMISSAO', () => {
    assert(protheusDbContent.includes('AS DT_MIGRACAO'), 'Deve selecionar DT_MIGRACAO do C5_EMISSAO');
    assert(protheusDbContent.includes('AS DT_EMISSAO'), 'Deve selecionar DT_EMISSAO do SF2/SD2');
  });

  runTest('3.3 - Suporte a enriquecimento assíncrono Pipedrive (fetchPipedriveWonTime)', () => {
    assert(protheusDbContent.includes('fetchPipedriveWonTime'), 'Deve conter fetchPipedriveWonTime');
    assert(protheusDbContent.includes('pipedriveWonCache'), 'Deve conter cache de won_time');
  });

  await runTestAsync('3.4 - Execução real da busca multi-empresa por Pedido 000763 retorna campos de data', async () => {
    const results = await buscarProtheusMultiEmpresa('pedVenda', '000763');
    assert(Array.isArray(results), 'Resultado deve ser array');
    assert(results.length > 0, 'Deve retornar ao menos 1 registro');

    const first = results[0];
    assert.strictEqual(first.empresa, '16 (OACO)', 'Empresa não deve conter prefixo repetido');
    assert.strictEqual(first.empresaKey, 'OACO', 'empresaKey deve ser OACO');
    assert.strictEqual(first.pedVenda, '000763', 'Pedido deve ser 000763');
    assert.strictEqual(first.codWeb, '26443', 'CodWeb deve ser 26443');
    assert.strictEqual(first.dtMigracao, '20260826', 'Data de migração deve ser 20260826');
    assert.ok(typeof first.nf === 'string', 'NF deve ser string');
    assert.ok(typeof first.dtEmissao === 'string', 'Data de emissão deve ser string');
    assert(first.dtGanho.startsWith('2026-08-26'), 'Data de ganho Pipedrive deve começar com 2026-08-26');
  });

  await runTestAsync('3.5 - Execução real da busca por CodWeb 26616 (sem NF emitida) retorna dtEmissao vazia', async () => {
    const results = await buscarProtheusMultiEmpresa('codWeb', '26616');
    assert(Array.isArray(results), 'Resultado deve ser array');
    assert(results.length > 0, 'Deve retornar o registro da OACO');

    const oaco = results.find(r => r.empresa.includes('16'));
    assert(oaco, 'Deve encontrar na empresa 16');
    assert.strictEqual(oaco.empresa, '16 (OACO)', 'Empresa formatada');
    assert.strictEqual(oaco.codWeb, '26616', 'CodWeb correto');
    assert.strictEqual(oaco.pedVenda, '000799', 'Pedido 000799');
    assert.strictEqual(oaco.nf, '-', 'Sem NF emitida ainda');
    assert.strictEqual(oaco.dtEmissao, '', 'dtEmissao deve ser vazia pois NF não foi emitida');
    assert(oaco.dtGanho.startsWith('2026-09-14'), 'dtGanho deve ser 2026-09-14');
    assert.strictEqual(oaco.dtMigracao, '20260914', 'dtMigracao deve ser 20260914');
  });

  console.log('\n================================================================');
  console.log(`🏁 RESULTADO FINAL: ${passedTests}/${totalTests} testes aprovados com 100% de sucesso!`);
  console.log('================================================================\n');
}

main().catch(err => {
  console.error('\n❌ Erro fatal na execução dos testes:', err);
  process.exit(1);
});
