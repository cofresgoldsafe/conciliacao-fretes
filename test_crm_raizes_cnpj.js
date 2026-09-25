/**
 * test_crm_raizes_cnpj.js
 * Suíte de testes automatizados para Inteligência de Fidelidade por Raiz de CNPJ no CRM Comercial
 * Valida:
 * 1. Extração de raiz de CNPJ (8 dígitos limpos)
 * 2. Motor de cache e consulta síncrona/assíncrona de fidelidade
 * 3. Classificação de badges (⭐ 1-5 compras, 💎 >= 6 compras VIP)
 * 4. Rota REST /api/bi/crm/clientes/raiz-cnpj/:cnpj (com autenticação JWT Zero-Trust)
 * 5. Layout HTML: Coluna 🤝 e badge no modal em public/crm.html e public/index.html
 * 6. Frontend public/js/crm.js: renderização, handlers e dirty check
 * 7. Scripts de carga inicial e sincronização mensal
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const jwt = require('jsonwebtoken');

let passedTests = 0;
let failedTests = 0;

function pass(msg) {
  passedTests++;
  console.log(`  ✅ [PASS] ${msg}`);
}

function fail(msg, err) {
  failedTests++;
  console.error(`  ❌ [FAIL] ${msg}`);
  if (err) console.error(err);
}

function runTest(name, fn) {
  try {
    fn();
    pass(name);
  } catch (err) {
    fail(name, err);
  }
}

async function runAsyncTest(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (err) {
    fail(name, err);
  }
}

console.log('\n============================================================');
console.log('🧪 Iniciando Testes de Inteligência de Raízes de CNPJ no CRM');
console.log('============================================================\n');

// 1. CARREGAMENTO DOS MÓDULOS DO BACKEND
const crmEngine = require('./crm_engine');
const {
  extrairRaizCnpj,
  formatarObjetoFidelidade,
  obterFidelidadeRaizSync,
  obterFidelidadeRaiz,
  obterCacheRaizes
} = crmEngine;

// TESTES DE EXTRAÇÃO DA RAIZ DE CNPJ
console.log('--- 1. Testes Unitários de extrairRaizCnpj() ---');

runTest('extrairRaizCnpj formata CNPJ com máscara padrão (14 dígitos)', () => {
  const raiz = extrairRaizCnpj('07.265.905/0001-50');
  assert.strictEqual(raiz, '07265905');
});

runTest('extrairRaizCnpj formata CNPJ numérico puro (14 dígitos)', () => {
  const raiz = extrairRaizCnpj('13566271000100');
  assert.strictEqual(raiz, '13566271');
});

runTest('extrairRaizCnpj limpa espaços em branco e caracteres especiais', () => {
  const raiz = extrairRaizCnpj('  61.585.865/0001-51 \n');
  assert.strictEqual(raiz, '61585865');
});

runTest('extrairRaizCnpj extrai os 8 primeiros dígitos de CPF (11 dígitos)', () => {
  const raiz = extrairRaizCnpj('123.456.789-01');
  assert.strictEqual(raiz, '12345678');
});

runTest('extrairRaizCnpj retorna null para string com menos de 8 dígitos', () => {
  assert.strictEqual(extrairRaizCnpj('12345'), null);
  assert.strictEqual(extrairRaizCnpj('ABC'), null);
});

runTest('extrairRaizCnpj retorna null para valores nulos, vazios ou indefinidos', () => {
  assert.strictEqual(extrairRaizCnpj(null), null);
  assert.strictEqual(extrairRaizCnpj(undefined), null);
  assert.strictEqual(extrairRaizCnpj(''), null);
});

// TESTES DE FORMATAÇÃO E CLASSIFICAÇÃO DE FIDELIDADE
console.log('\n--- 2. Testes de Classificação de Badges e Tooltips ---');

runTest('formatarObjetoFidelidade com 0 compras retorna null', () => {
  assert.strictEqual(formatarObjetoFidelidade(null), null);
  assert.strictEqual(formatarObjetoFidelidade({ total_compras: 0 }), null);
});

runTest('formatarObjetoFidelidade com 1 compra classifica como estrela (⭐)', () => {
  const res = formatarObjetoFidelidade({ raiz_cnpj: '12345678', total_compras: 1, razao_social: 'Empresa Alpha' });
  assert.ok(res);
  assert.strictEqual(res.tipo, 'estrela');
  assert.strictEqual(res.icone, '⭐');
  assert.strictEqual(res.total_compras, 1);
  assert.ok(res.tooltip.includes('Cliente Fidelidade: 1 compra'));
});

runTest('formatarObjetoFidelidade com 5 compras classifica como estrela (⭐)', () => {
  const res = formatarObjetoFidelidade({ raiz_cnpj: '12345678', total_compras: 5, razao_social: 'Empresa Beta' });
  assert.ok(res);
  assert.strictEqual(res.tipo, 'estrela');
  assert.strictEqual(res.icone, '⭐');
  assert.strictEqual(res.total_compras, 5);
  assert.ok(res.tooltip.includes('Cliente Fidelidade: 5 compras'));
});

runTest('formatarObjetoFidelidade com 6 compras classifica como VIP Diamante (💎)', () => {
  const res = formatarObjetoFidelidade({ raiz_cnpj: '12345678', total_compras: 6, razao_social: 'Empresa Gamma' });
  assert.ok(res);
  assert.strictEqual(res.tipo, 'diamante');
  assert.strictEqual(res.icone, '💎');
  assert.strictEqual(res.total_compras, 6);
  assert.ok(res.tooltip.includes('Cliente Diamante VIP: 6 compras'));
});

runTest('formatarObjetoFidelidade com 50 compras classifica como VIP Diamante (💎)', () => {
  const res = formatarObjetoFidelidade({ raiz_cnpj: '12345678', total_compras: 50, razao_social: 'Empresa Delta' });
  assert.ok(res);
  assert.strictEqual(res.tipo, 'diamante');
  assert.strictEqual(res.icone, '💎');
  assert.strictEqual(res.total_compras, 50);
});

// TESTES DO CACHE DE PRODUÇÃO
console.log('\n--- 3. Testes do Cache de Raízes (crm_clientes_raiz_cnpj_cache.json) ---');

runTest('obterFidelidadeRaizSync identifica raiz VIP Cofres Matos (07265905) com 190 compras', () => {
  const fid = obterFidelidadeRaizSync('07.265.905/0001-50');
  assert.ok(fid, 'Deveria encontrar a raiz 07265905');
  assert.strictEqual(fid.tipo, 'diamante');
  assert.strictEqual(fid.icone, '💎');
  assert.strictEqual(fid.total_compras, 190);
  assert.strictEqual(fid.label, '💎 190');
});

runTest('obterFidelidadeRaizSync identifica raiz Calzedonia (13566271) como VIP', () => {
  const fid = obterFidelidadeRaizSync('13566271000100');
  assert.ok(fid, 'Deveria encontrar a raiz 13566271');
  assert.strictEqual(fid.tipo, 'diamante');
  assert.strictEqual(fid.icone, '💎');
  assert.strictEqual(fid.total_compras, 97);
  assert.strictEqual(fid.label, '💎 97');
});

runTest('obterFidelidadeRaizSync retorna null para CNPJ inexistente', () => {
  const fid = obterFidelidadeRaizSync('99.999.999/9999-99');
  assert.strictEqual(fid, null);
});

// TESTES DE HTML (public/crm.html e public/index.html)
console.log('\n--- 4. Testes de Estrutura HTML ---');

const htmlCrm = fs.readFileSync(path.join(__dirname, 'public/crm.html'), 'utf-8');
const htmlIndex = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf-8');

runTest('public/crm.html contém cabeçalho de coluna 🤝 entre Título e Valor', () => {
  const tablePart = htmlCrm.slice(htmlCrm.indexOf('id="crmDealsTable"'), htmlCrm.indexOf('id="crmDealsTbody"'));
  const idxHandshake = tablePart.indexOf('>🤝</th>');
  const idxTitulo = tablePart.indexOf('>Título</th>');
  const idxValor = tablePart.indexOf('>Valor</th>');
  assert.ok(idxHandshake !== -1, 'Coluna 🤝 deve existir');
  assert.ok(idxTitulo !== -1 && idxHandshake > idxTitulo, 'Coluna 🤝 deve vir após Título');
  assert.ok(idxValor !== -1 && idxHandshake < idxValor, 'Coluna 🤝 deve vir antes de Valor');
});

runTest('public/index.html contém cabeçalho de coluna 🤝 entre Título e Valor', () => {
  const tablePart = htmlIndex.slice(htmlIndex.indexOf('id="crmDealsTable"'), htmlIndex.indexOf('id="crmDealsTbody"'));
  const idxHandshake = tablePart.indexOf('>🤝</th>');
  const idxTitulo = tablePart.indexOf('>Título</th>');
  const idxValor = tablePart.indexOf('>Valor</th>');
  assert.ok(idxHandshake !== -1, 'Coluna 🤝 deve existir');
  assert.ok(idxTitulo !== -1 && idxHandshake > idxTitulo, 'Coluna 🤝 deve vir após Título');
  assert.ok(idxValor !== -1 && idxHandshake < idxValor, 'Coluna 🤝 deve vir antes de Valor');
});

runTest('public/crm.html contém container crmDealClienteFidelidadeBadge junto ao rótulo Cliente: *', () => {
  assert.ok(htmlCrm.includes('id="crmDealClienteFidelidadeBadge"'), 'crmDealClienteFidelidadeBadge deve existir');
  assert.ok(htmlCrm.includes('Cliente: *'), 'Rótulo Cliente: * deve existir');
});

runTest('public/index.html contém container crmDealClienteFidelidadeBadge junto ao rótulo Cliente: *', () => {
  assert.ok(htmlIndex.includes('id="crmDealClienteFidelidadeBadge"'), 'crmDealClienteFidelidadeBadge deve existir');
  assert.ok(htmlIndex.includes('Cliente: *'), 'Rótulo Cliente: * deve existir');
});

// TESTES DO FRONTEND public/js/crm.js
console.log('\n--- 5. Testes do Frontend public/js/crm.js ---');

const jsCrm = fs.readFileSync(path.join(__dirname, 'public/js/crm.js'), 'utf-8');

runTest('public/js/crm.js implementa renderFidelidadeBadge', () => {
  assert.ok(jsCrm.includes('function renderFidelidadeBadge('));
});

runTest('public/js/crm.js mapeia fidelidade_compras no mapDealFromApi', () => {
  assert.ok(jsCrm.includes('fidelidade_compras: d.fidelidade_compras'));
});

runTest('public/js/crm.js renderiza a coluna 🤝 em renderListagemBoard', () => {
  assert.ok(jsCrm.includes('${renderFidelidadeBadge(d.fidelidade_compras)}'));
  assert.ok(jsCrm.includes('colspan="10"'), 'Empty state deve contemplar as 10 colunas');
});

runTest('public/js/crm.js exibe badge de fidelidade no Kanban card (crm-card-client)', () => {
  assert.ok(jsCrm.includes('${renderFidelidadeBadge(deal.fidelidade_compras, { style: \'margin-left: 6px;\' })}'));
});

runTest('public/js/crm.js exibe badge no modal de detalhes após getDealAlertBadge', () => {
  assert.ok(jsCrm.includes('crmDetalhesFaseBadge'));
  assert.ok(jsCrm.includes('if (deal.fidelidade_compras)'));
});

runTest('public/js/crm.js implementa atualizarBadgeClienteModal', () => {
  assert.ok(jsCrm.includes('async function atualizarBadgeClienteModal('));
});

runTest('public/js/crm.js limpa badge ao abrir modal de nova oportunidade', () => {
  assert.ok(jsCrm.includes("const badgeContainer = document.getElementById('crmDealClienteFidelidadeBadge');"));
  assert.ok(jsCrm.includes("if (badgeContainer) badgeContainer.innerHTML = '';"));
});

runTest('public/js/crm.js exibe badge no autocomplete dropdown e preenche ao clicar', () => {
  assert.ok(jsCrm.includes('data-fidelidade='));
  assert.ok(jsCrm.includes('atualizarBadgeClienteModal(cnpjVal, fidObj)'));
});

// TESTES DOS SCRIPTS OPERACIONAIS
console.log('\n--- 6. Testes dos Scripts de Carga e Sincronização ---');

runTest('scripts/carga_inicial_raizes_cnpj.js existe e possui instruções completas', () => {
  const file = path.join(__dirname, 'scripts/carga_inicial_raizes_cnpj.js');
  assert.ok(fs.existsSync(file));
  const content = fs.readFileSync(file, 'utf-8');
  assert.ok(content.includes('01, 04, 05, 09, 14, 15, 16'));
  assert.ok(content.includes('crm_clientes_raiz_cnpj'));
});

runTest('scripts/sync_mensal_raizes_cnpj.js existe e possui rotina incremental', () => {
  const file = path.join(__dirname, 'scripts/sync_mensal_raizes_cnpj.js');
  assert.ok(fs.existsSync(file));
  const content = fs.readFileSync(file, 'utf-8');
  assert.ok(content.includes('activeCompanies'));
  assert.ok(content.includes('crm_clientes_raiz_cnpj_cache.json'));
});

// TESTES DE ROTAS EXPRESS REST (ASSÍNCRONOS)
console.log('\n--- 7. Testes Assíncronos de Cache e Rota REST ---');

async function testarAssincrono() {
  await runAsyncTest('obterCacheRaizes carrega cache em memória com integridade (> 20.000 raízes)', async () => {
    const cache = await obterCacheRaizes();
    assert.ok(cache && typeof cache === 'object');
    const totalRaizes = Object.keys(cache).length;
    assert.ok(totalRaizes > 20000, `Esperado > 20000 raízes no cache, encontrado ${totalRaizes}`);
  });

  const express = require('express');
  const http = require('http');
  const app = express();
  app.use(express.json());

  const crmRoutes = require('./crm_routes');
  app.use('/api/bi/crm', crmRoutes);

  const server = app.listen(0);
  const port = server.address().port;

  const JWT_SECRET = process.env.JWT_SECRET || 'gsi_portal_jwt_secret_key_prod_2026_x89a';
  const testToken = jwt.sign({ username: 'alexandre', role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });

  function httpGet(reqPath, headers = {}) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: '127.0.0.1',
        port: port,
        path: reqPath,
        method: 'GET',
        headers: headers
      };
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch (e) {
            resolve({ status: res.statusCode, raw: data });
          }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  try {
    await runAsyncTest('GET /api/bi/crm/clientes/raiz-cnpj/:cnpj retorna fidelidade de cliente existente', async () => {
      const res = await httpGet('/api/bi/crm/clientes/raiz-cnpj/07265905000150', {
        'Authorization': `Bearer ${testToken}`
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.raiz_cnpj, '07265905');
      assert.strictEqual(res.body.data.tipo, 'diamante');
      assert.strictEqual(res.body.data.icone, '💎');
      assert.strictEqual(res.body.data.total_compras, 190);
    });

    await runAsyncTest('GET /api/bi/crm/clientes/raiz-cnpj/:cnpj retorna 0 compras para raiz não encontrada', async () => {
      const res = await httpGet('/api/bi/crm/clientes/raiz-cnpj/99999999000199', {
        'Authorization': `Bearer ${testToken}`
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.data.total_compras, 0);
      assert.strictEqual(res.body.data.tipo, null);
    });

    await runAsyncTest('GET /api/bi/crm/clientes/raiz-cnpj/:cnpj rejeita CNPJ com menos de 8 dígitos (400 Bad Request)', async () => {
      const res = await httpGet('/api/bi/crm/clientes/raiz-cnpj/123', {
        'Authorization': `Bearer ${testToken}`
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'INVALID_CNPJ_ROOT');
    });

    await runAsyncTest('GET /api/bi/crm/clientes/raiz-cnpj/:cnpj sem token retorna 401 Unauthorized (Zero-Trust)', async () => {
      const res = await httpGet('/api/bi/crm/clientes/raiz-cnpj/07265905000150');
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.success, false);
      assert.strictEqual(res.body.error.code, 'UNAUTHORIZED');
    });
  } finally {
    server.close();
  }
}

// EXECUTA TESTES ASSÍNCRONOS E FINALIZA
(async () => {
  await testarAssincrono();

  console.log('\n============================================================');
  console.log(`📊 Resultado dos Testes: ${passedTests}/${passedTests + failedTests} aprovados.`);
  if (failedTests === 0) {
    console.log('🎉 Todos os testes de Inteligência de Raízes de CNPJ foram aprovados com sucesso!');
    console.log('============================================================\n');
    process.exit(0);
  } else {
    console.error(`💥 Falha em ${failedTests} testes!`);
    console.log('============================================================\n');
    process.exit(1);
  }
})();
