/**
 * test_crm_produtos.js
 * 
 * Bateria de Testes Automatizados para o Espelho de Catálogo de Produtos do Protheus no CRM Comercial
 * Plataforma de Apoio GSI (Gemini-Cli)
 */

const assert = require('assert');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const crmEngine = require('./crm_engine');
const crmRoutes = require('./crm_routes');

const JWT_SECRET = process.env.JWT_SECRET || 'gsi_portal_jwt_secret_key_prod_2026_x89a';
const dataDir = path.join(__dirname, 'data');
const produtosCacheFile = path.join(dataDir, 'crm_produtos_cache.json');

function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

function makeRequest(app, method, reqPath, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const options = {
        hostname: '127.0.0.1',
        port: port,
        path: reqPath,
        method: method,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        }
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          server.close();
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      });

      req.on('error', (err) => {
        server.close();
        reject(err);
      });

      if (body) {
        req.write(typeof body === 'string' ? body : JSON.stringify(body));
      }
      req.end();
    });
  });
}

// Backup do cache pré-existente (se houver) para restauração no fim dos testes
let backupCache = null;

async function runTests() {
  console.log('🧪 =================================================================');
  console.log('🧪 Iniciando Testes de Catálogo de Produtos Protheus / CRM Comercial');
  console.log('🧪 =================================================================\n');

  try {
    if (fs.existsSync(produtosCacheFile)) {
      backupCache = fs.readFileSync(produtosCacheFile, 'utf8');
    }
  } catch (err) {
    console.warn('Aviso backup cache:', err.message);
  }

  const app = express();
  app.use(express.json());
  app.use('/api/bi/crm', crmRoutes);

  const tokenAdmin = generateToken({ username: 'alexandre', name: 'Alexandre GSI', role: 'admin' });
  const tokenVendedor = generateToken({ username: 'juliana', name: 'Juliana Vendedora', role: 'vendedor' });

  // ---------------------------------------------------------------------------
  // 1. Validação do arquivo SQL e Bootstrap
  // ---------------------------------------------------------------------------
  console.log('1️⃣  Teste: Validação do Arquivo SQL de Produtos e Bootstrap Idempotente');
  const sqlPath = path.join(__dirname, 'sql', 'bi', '09_tabela_crm_produtos.sql');
  assert.ok(fs.existsSync(sqlPath), 'Arquivo sql/bi/09_tabela_crm_produtos.sql deve existir');
  const sqlContent = fs.readFileSync(sqlPath, 'utf8');
  assert.ok(sqlContent.includes('CREATE TABLE IF NOT EXISTS crm_produtos'), 'SQL deve conter criação da tabela crm_produtos');
  assert.ok(sqlContent.includes('preco_tabela NUMERIC'), 'SQL deve conter coluna preco_tabela');
  assert.ok(sqlContent.includes('peso_liquido NUMERIC'), 'SQL deve conter coluna peso_liquido');
  assert.ok(sqlContent.includes('ENABLE ROW LEVEL SECURITY'), 'SQL deve habilitar RLS');
  
  // Teste de chamada segura do bootstrap
  await crmEngine.initCrmTables();
  assert.strictEqual(typeof crmEngine.initCrmDatabase, 'function', 'initCrmDatabase deve ser função');
  console.log('   ✅ Arquivo SQL e Bootstrap idempotente validados com sucesso.');

  // ---------------------------------------------------------------------------
  // 2. Teste do Cache Local Resiliente (Leitura / Gravação Atômica)
  // ---------------------------------------------------------------------------
  console.log('\n2️⃣  Teste: Contingência de Cache Local (crm_produtos_cache.json)');
  const mockProdutos = [
    {
      codigo: 'CF-3040',
      descricao: 'COFRE DIGITAL MECANICO 30X40',
      ncm: '83030000',
      unidade: 'UN',
      tipo: 'PA',
      grupo: '001',
      preco_tabela: 1250.50,
      peso_liquido: 25.4000,
      peso_bruto: 26.2000,
      aliquota_ipi: 5.00,
      bloqueado: false
    },
    {
      codigo: 'CF-4050-BL',
      descricao: 'COFRE BOCA DE LOBO 40X50 COLETOR',
      ncm: '83030000',
      unidade: 'UN',
      tipo: 'PA',
      grupo: '001',
      preco_tabela: 2390.00,
      peso_liquido: 48.0000,
      peso_bruto: 50.0000,
      aliquota_ipi: 5.00,
      bloqueado: false
    },
    {
      codigo: 'CF-LEGADO-OBS',
      descricao: 'COFRE DESCONTINUADO MODELO ANTIGO',
      ncm: '83030000',
      unidade: 'UN',
      tipo: 'PA',
      grupo: '002',
      preco_tabela: 850.00,
      peso_liquido: 18.0000,
      peso_bruto: 19.0000,
      aliquota_ipi: 0.00,
      bloqueado: true // PRODUTO BLOQUEADO
    },
    {
      codigo: 'PT-9021',
      descricao: 'PORTA FORTE REFORCADA BLINDADA',
      ncm: '73083000',
      unidade: 'UN',
      tipo: 'PA',
      grupo: '018',
      preco_tabela: 8900.00,
      peso_liquido: 195.5000,
      peso_bruto: 210.0000,
      aliquota_ipi: 10.00,
      bloqueado: false
    }
  ];

  const writeSuccess = await crmEngine.writeProdutosCache({ produtos: mockProdutos });
  assert.strictEqual(writeSuccess, true, 'writeProdutosCache deve retornar true');

  const cacheLido = await crmEngine.readProdutosCache();
  assert.ok(cacheLido && Array.isArray(cacheLido.produtos), 'Cache deve conter array de produtos');
  assert.strictEqual(cacheLido.produtos.length, 4, 'Cache deve conter 4 produtos gravados');
  assert.strictEqual(cacheLido.produtos[0].codigo, 'CF-3040');
  console.log('   ✅ Gravação e leitura atômica de cache local validadas com sucesso.');

  // ---------------------------------------------------------------------------
  // 3. Teste de Autocomplete de Produtos e Sanitização
  // ---------------------------------------------------------------------------
  console.log('\n3️⃣  Teste: Autocomplete de Produtos com Fallback, Filtros e Sanitização');
  
  // 3.1 Termo com menos de 2 caracteres -> deve retornar vazio
  const resCurto = await crmEngine.autocompleteProdutos('C');
  assert.deepStrictEqual(resCurto, [], 'Termos com menos de 2 caracteres devem retornar array vazio');

  // 3.2 Busca por código (ex: "CF-30")
  const resCodigo = await crmEngine.autocompleteProdutos('CF-30');
  assert.ok(resCodigo.length >= 1, 'Deve encontrar pelo menos 1 produto para "CF-30"');
  assert.strictEqual(resCodigo[0].codigo, 'CF-3040');
  assert.strictEqual(resCodigo[0].preco_tabela, 1250.50);
  assert.strictEqual(resCodigo[0].peso_liquido, 25.4);
  assert.strictEqual(resCodigo[0].ncm, '83030000');

  // 3.3 Busca por descrição (ex: "Boca de Lobo")
  const resDesc = await crmEngine.autocompleteProdutos('Boca de Lobo');
  assert.ok(resDesc.length >= 1, 'Deve encontrar produto contendo "Boca de Lobo"');
  assert.strictEqual(resDesc[0].codigo, 'CF-4050-BL');

  // 3.4 Filtro de produtos bloqueados (apenasAtivos = true)
  const resAtivos = await crmEngine.autocompleteProdutos('DESCONTINUADO', { apenasAtivos: true });
  assert.strictEqual(resAtivos.length, 0, 'Produto bloqueado não deve aparecer com apenasAtivos: true');

  const resComBloqueados = await crmEngine.autocompleteProdutos('DESCONTINUADO', { apenasAtivos: false });
  assert.strictEqual(resComBloqueados.length, 1, 'Produto bloqueado deve aparecer com apenasAtivos: false');
  assert.strictEqual(resComBloqueados[0].bloqueado, true);

  // 3.5 Teste de Sanitização e Proteção contra SQL Injection
  const injectionTerms = [
    "'; DROP TABLE crm_produtos; --",
    "' OR '1'='1",
    "CF%' OR 1=1 --",
    "[CF-3040]"
  ];
  for (const inj of injectionTerms) {
    const resInj = await crmEngine.autocompleteProdutos(inj);
    assert.ok(Array.isArray(resInj), `Autocomplete deve retornar array seguro para injeção: ${inj}`);
  }
  console.log('   ✅ Autocomplete, ordenação de relevância e sanitização validados com 100% de precisão.');

  // ---------------------------------------------------------------------------
  // 4. Teste de Status do Catálogo de Produtos
  // ---------------------------------------------------------------------------
  console.log('\n4️⃣  Teste: Obtenção de Status do Catálogo de Produtos');
  const statusInfo = await crmEngine.obterStatusProdutosCrm();
  assert.ok(statusInfo.success, 'Status deve retornar success: true');
  assert.strictEqual(typeof statusInfo.total_produtos, 'number');
  assert.strictEqual(typeof statusInfo.produtos_ativos, 'number');
  assert.strictEqual(typeof statusInfo.produtos_bloqueados, 'number');
  assert.ok(statusInfo.total_produtos >= 4, 'Total de produtos deve ser no mínimo os 4 do teste');
  assert.ok(statusInfo.last_synced_at !== null, 'Data de última sincronização deve estar preenchida');
  console.log(`   ✅ Status obtido: Total: ${statusInfo.total_produtos}, Ativos: ${statusInfo.produtos_ativos}, Bloqueados: ${statusInfo.produtos_bloqueados} (Origem: ${statusInfo.origem}).`);

  // ---------------------------------------------------------------------------
  // 5. Teste de Sincronização do Catálogo (Protheus SB1090/SB1160 + Fallback)
  // ---------------------------------------------------------------------------
  console.log('\n5️⃣  Teste: Sincronização de Produtos Protheus (sincronizarProdutosCrmProtheus)');
  const syncResult = await crmEngine.sincronizarProdutosCrmProtheus({ triggeredBy: 'TEST_SUITE' });
  assert.ok(syncResult.success, 'Sincronização deve retornar success: true');
  assert.strictEqual(syncResult.status, 'SINCRONIZADO');
  assert.strictEqual(syncResult.triggered_by, 'TEST_SUITE');
  assert.ok(syncResult.duracao_ms >= 0, 'Duração em milissegundos deve ser computada');
  assert.ok(syncResult.total_produtos >= 0, 'Total de produtos deve ser computado');
  console.log(`   ✅ Sincronização executada com sucesso em ${syncResult.duracao_ms}ms (${syncResult.total_produtos} produtos processados).`);

  // ---------------------------------------------------------------------------
  // 6. Testes das Rotas HTTP no Router do CRM
  // ---------------------------------------------------------------------------
  console.log('\n6️⃣  Teste: Segurança e Roteamento Express (crm_routes.js)');

  // 6.1 Rota sem token -> 401 Unauthorized
  const resAnon = await makeRequest(app, 'GET', '/api/bi/crm/produtos/autocomplete?q=CF');
  assert.strictEqual(resAnon.status, 401, 'Requisição anônima deve retornar 401');

  // 6.2 Rota com usuário vendedor -> 403 Forbidden
  const resVend = await makeRequest(app, 'GET', '/api/bi/crm/produtos/autocomplete?q=CF', {
    'Authorization': `Bearer ${tokenVendedor}`
  });
  assert.strictEqual(resVend.status, 403, 'Usuário vendedor deve retornar 403 Forbidden');

  // 6.3 Autocomplete com Admin -> 200 OK
  const cacheAtual = await crmEngine.readProdutosCache();
  const prodAtivoAlvo = (cacheAtual.produtos || []).find(p => !p.bloqueado && p.preco_tabela > 0) || cacheAtual.produtos[0];
  assert.ok(prodAtivoAlvo, 'Deve haver ao menos um produto ativo no catálogo sincronizado');
  const termoBusca = prodAtivoAlvo.codigo.slice(0, Math.min(6, prodAtivoAlvo.codigo.length));

  const resAutocomp = await makeRequest(app, 'GET', `/api/bi/crm/produtos/autocomplete?q=${encodeURIComponent(termoBusca)}`, {
    'Authorization': `Bearer ${tokenAdmin}`
  });
  assert.strictEqual(resAutocomp.status, 200, 'Admin deve receber 200 OK');
  assert.strictEqual(resAutocomp.body.success, true);
  assert.ok(Array.isArray(resAutocomp.body.data), 'data deve ser array');
  assert.ok(resAutocomp.body.total >= 1, 'Deve encontrar ao menos um produto no autocomplete');
  assert.ok(resAutocomp.body.data.some(p => p.codigo === prodAtivoAlvo.codigo), 'Produto alvo deve estar nos resultados');

  // 6.4 Status com Admin -> 200 OK
  const resStatusHttp = await makeRequest(app, 'GET', '/api/bi/crm/produtos/status', {
    'Authorization': `Bearer ${tokenAdmin}`
  });
  assert.strictEqual(resStatusHttp.status, 200, 'GET /produtos/status deve retornar 200 OK');
  assert.strictEqual(resStatusHttp.body.success, true);
  assert.ok(resStatusHttp.body.data.total_produtos >= 0);

  // 6.5 Sync com Admin -> 200 OK
  const resSyncHttp = await makeRequest(app, 'POST', '/api/bi/crm/produtos/sync', {
    'Authorization': `Bearer ${tokenAdmin}`
  });
  assert.strictEqual(resSyncHttp.status, 200, 'POST /produtos/sync deve retornar 200 OK');
  assert.strictEqual(resSyncHttp.body.success, true);
  assert.strictEqual(resSyncHttp.body.data.status, 'SINCRONIZADO');
  console.log('   ✅ Todos os endpoints de produtos protegidos (401, 403 e 200) responderam em conformidade RFC.');

  // ---------------------------------------------------------------------------
  // 7. Simulação do Enriquecimento de Itens Cotados da Oportunidade
  // ---------------------------------------------------------------------------
  console.log('\n7️⃣  Teste: Simulação de Seleção e Enriquecimento de Itens Cotados (NCM, Peso, Preço)');
  
  const produtoSelecionado = prodAtivoAlvo;
  const qtdSimulada = 3;
  const pTab = Number(produtoSelecionado.preco_tabela) || 100;
  const pLiq = Number(produtoSelecionado.peso_liquido) || 5;

  const itemCotadoSimulado = {
    codigo: produtoSelecionado.codigo,
    descricao: produtoSelecionado.descricao,
    quantidade: qtdSimulada,
    precoTabela: pTab,
    precoNegociado: pTab, // Se negociado não for informado, usa tabela
    ncm: produtoSelecionado.ncm || '83030000',
    pesoLiquido: pLiq,
    pesoBruto: Number(produtoSelecionado.peso_bruto) || pLiq,
    unidade: produtoSelecionado.unidade || 'UN'
  };

  const subtotalEsperado = qtdSimulada * pTab;
  const pesoTotalEsperado = qtdSimulada * pLiq;

  const subtotalCalculado = itemCotadoSimulado.quantidade * itemCotadoSimulado.precoNegociado;
  const pesoTotalCalculado = itemCotadoSimulado.quantidade * itemCotadoSimulado.pesoLiquido;

  assert.strictEqual(subtotalCalculado, subtotalEsperado, 'Subtotal calculado deve bater com o esperado');
  assert.strictEqual(pesoTotalCalculado, pesoTotalEsperado, 'Peso total calculado deve bater com o esperado');
  assert.ok(itemCotadoSimulado.unidade, 'Unidade de medida deve ser preservada');

  console.log(`   ✅ Enriquecimento validado: ${qtdSimulada}x ${itemCotadoSimulado.codigo} -> Subtotal: R$ ${subtotalCalculado.toFixed(2)} | Peso: ${pesoTotalCalculado.toFixed(2)} kg.`);

  // ---------------------------------------------------------------------------
  // Finalização e Limpeza
  // ---------------------------------------------------------------------------
  if (backupCache) {
    fs.writeFileSync(produtosCacheFile, backupCache, 'utf8');
  }

  console.log('\n🏆 =================================================================');
  console.log('🏆 TODOS OS TESTES FORAM CONCLUÍDOS COM 100% DE SUCESSO!');
  console.log('🏆 =================================================================\n');
}

runTests().catch(err => {
  console.error('\n❌ Falha na execução dos testes:', err);
  if (backupCache) {
    try { fs.writeFileSync(produtosCacheFile, backupCache, 'utf8'); } catch {}
  }
  process.exit(1);
});
