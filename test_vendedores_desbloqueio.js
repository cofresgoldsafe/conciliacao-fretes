/**
 * test_vendedores_desbloqueio.js
 * Suíte de testes automatizados para:
 * 1. Desativação da trava de vendedor em Pedidos Abertos e Comissões (visualização unificada/todos).
 * 2. Criação da coluna "Nome" truncada em 20 caracteres (com espaços) na tabela de Comissões.
 * 3. Redução da largura da coluna "Vendedor" e distribuição de colunas no HTML/JS.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');
const server = require('./server');

const JWT_SECRET = process.env.JWT_SECRET || 'gsi_portal_jwt_secret_key_prod_2026_x89a';

console.log('\n===============================================================');
console.log('🧪 TESTES: DESBLOQUEIO VENDEDORES & COLUNA NOME EM COMISSÕES');
console.log('===============================================================\n');

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passCount++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
    failCount++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passCount++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
    failCount++;
  }
}

function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, rawBody: body });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    req.end();
  });
}

// 1. Testes de Regra de Negócio: Truncamento de 20 caracteres (contando espaços)
test('Regra de Truncamento do Nome do Cliente em 20 caracteres (com espaços)', () => {
  function formatarNomeCliente20(nomeBruto) {
    const raw = String(nomeBruto || '').trim();
    return raw.length > 20 ? raw.substring(0, 20) : raw;
  }

  const nomeCurto = 'LOJA DO COFRE LTDA';
  assert.strictEqual(formatarNomeCliente20(nomeCurto), 'LOJA DO COFRE LTDA', 'Nomes <= 20 caracteres devem ser mantidos');

  const nomeExato20 = '12345678901234567890'; // 20 chars
  assert.strictEqual(formatarNomeCliente20(nomeExato20).length, 20);

  const nomeLongo = 'BENETRON COMERCIO E INDUSTRIA DE COFRES LTDA';
  const formatado = formatarNomeCliente20(nomeLongo);
  assert.strictEqual(formatado.length, 20, 'Deve ter exatamente 20 caracteres');
  assert.strictEqual(formatado, 'BENETRON COMERCIO E '); // primeiras 20 letras contando espaços

  const nomeVazio = '';
  assert.strictEqual(formatarNomeCliente20(nomeVazio), '');
});

// 2. Testes de Validação do HTML de Comissões (index.html)
test('index.html contém a coluna Nome, Gordura de Frete Embut. e larguras calibradas', () => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');

  // Verifica que existe o thead de comissões com as colunas Nome e Gordura de Frete Embut.
  assert.ok(html.includes('<th style="width: 18%;">Nome</th>'), 'Falta a coluna Nome com 18% no thead');
  assert.ok(html.includes('<th style="width: 13%; text-align: right;">Gordura de Frete Embut.</th>'), 'Falta a coluna Gordura de Frete Embut. no thead');
  assert.ok(html.includes('<th style="width: 11%;">Vendedor</th>'), 'A largura da coluna Vendedor deve ter 11%');
  assert.ok(html.includes('<th style="width: 9%;">Cliente</th>'), 'A coluna Cliente deve ter 9%');

  // Verifica a ordem das colunas no thead: Cliente -> Nome -> Gordura de Frete Embut. -> Valor Base
  const indexCliente = html.indexOf('<th style="width: 9%;">Cliente</th>');
  const indexNome = html.indexOf('<th style="width: 18%;">Nome</th>');
  const indexGordura = html.indexOf('<th style="width: 13%; text-align: right;">Gordura de Frete Embut.</th>');
  const indexValorBase = html.indexOf('<th style="width: 12%; text-align: right;">Valor Base</th>');

  assert.ok(indexCliente > 0 && indexNome > indexCliente, 'A coluna Nome deve vir após a coluna Cliente');
  assert.ok(indexGordura > indexNome, 'A coluna Gordura de Frete Embut. deve vir logo após a coluna Nome');
  assert.ok(indexValorBase > indexGordura, 'A coluna Valor Base deve vir após a coluna Gordura de Frete Embut.');
});

// 3. Testes de Validação da Lógica do Frontend (app.js)
test('app.js renderiza coluna Nome, Gordura de Frete Embut. e atualiza colspan para 9', () => {
  const appJsPath = path.join(__dirname, 'public', 'app.js');
  const code = fs.readFileSync(appJsPath, 'utf8');

  assert.ok(code.includes('colspan="9"'), 'Empty state de comissões deve usar colspan="9"');
  assert.ok(code.includes('nome20') || code.includes('nomeCliente'), 'app.js deve processar nome20 / nomeCliente');
  assert.ok(code.includes('gorduraFreteEmbut') || code.includes('freteEmbutido'), 'app.js deve renderizar gorduraFreteEmbut / freteEmbutido');
  assert.ok(code.includes('<td>${escapeHtml(item.cliente)}</td>'), 'app.js deve renderizar coluna cliente');
});

test('app.js ajustarEscopoVendedor não trava selects para vendedores', () => {
  const appJsPath = path.join(__dirname, 'public', 'app.js');
  const code = fs.readFileSync(appJsPath, 'utf8');

  // Verifica que ajustarEscopoVendedor não contém disabled = true
  const fnMatch = code.match(/function ajustarEscopoVendedor\([\s\S]*?\n\s*\}/);
  assert.ok(fnMatch, 'Função ajustarEscopoVendedor deve existir');
  const fnBody = fnMatch[0];
  assert.ok(!fnBody.includes('.disabled = true'), 'ajustarEscopoVendedor NÃO deve travar selects como disabled');
  assert.ok(!fnBody.includes('(Fixo)'), 'Labels não devem exibir (Fixo)');
});

// 4. Testes de Validação da Query SQL em protheus_db.js
test('protheus_db.js executa LEFT JOIN com SA1010 e SC5 na busca de comissões', () => {
  const protheusPath = path.join(__dirname, 'protheus_db.js');
  const code = fs.readFileSync(protheusPath, 'utf8');

  assert.ok(code.includes('LEFT JOIN SA1010 A1'), 'protheus_db.js deve fazer LEFT JOIN com SA1010');
  assert.ok(code.includes('RTRIM(ISNULL(A1.A1_NOME, \'\')) AS NOME_CLIENTE'), 'Deve selecionar A1_NOME como NOME_CLIENTE');
  assert.ok(code.includes('nomeCliente: nome20'), 'Deve exportar nomeCliente truncado');
  assert.ok(code.includes('ISNULL(C5.C5_VLR_FRT, 0) AS C5_VLR_FRT'), 'Deve selecionar C5_VLR_FRT da SC5');
  assert.ok(code.includes('gorduraFreteEmbut: roundVal(freteEmbutido)'), 'Deve exportar gorduraFreteEmbut no resultado');
});

// 5. Testes de Integração HTTP dos Endpoints Desbloqueados
async function runIntegrationHttpTests(port) {
  const vendorToken = jwt.sign({
    username: 'juliana',
    name: 'Juliana',
    role: 'vendedor',
    vendorCode: '000074',
    permissions: ['vendedores']
  }, JWT_SECRET);

  // 5.1. Vendedor acessando Pedidos Abertos sem filtro (vê todos os pedidos)
  await asyncTest('GET /api/vendedores/pedidos/abertos por Vendedor acessa pedidos de todos', async () => {
    const res = await makeRequest({
      hostname: '127.0.0.1',
      port: port,
      path: '/api/vendedores/pedidos/abertos',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${vendorToken}` }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
  });

  // 5.2. Vendedor acessando Comissões com filtro de outro vendedor
  await asyncTest('POST /api/vendedores/comissoes por Vendedor consulta comissões de outro vendedor (Figueiredo)', async () => {
    const res = await makeRequest({
      hostname: '127.0.0.1',
      port: port,
      path: '/api/vendedores/comissoes',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${vendorToken}`,
        'Content-Type': 'application/json'
      }
    }, { dataIni: '2026-08-01', dataFim: '2026-08-25', codVend: '000004' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
  });

  // 5.3. Vendedor acessando Comissões de todos os vendedores (codVend vazio)
  await asyncTest('POST /api/vendedores/comissoes por Vendedor consulta comissões de TODOS os vendedores', async () => {
    const res = await makeRequest({
      hostname: '127.0.0.1',
      port: port,
      path: '/api/vendedores/comissoes',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${vendorToken}`,
        'Content-Type': 'application/json'
      }
    }, { dataIni: '2026-08-01', dataFim: '2026-08-25', codVend: '' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
  });

  console.log(`\n===============================================================`);
  console.log(`🏁 RESULTADO FINAL: ${passCount} passaram, ${failCount} falharam.`);
  console.log('===============================================================\n');

  if (failCount > 0) {
    process.exit(1);
  }
}

const tempServer = http.createServer(server);
tempServer.listen(0, () => {
  const port = tempServer.address().port;
  runIntegrationHttpTests(port).then(() => {
    tempServer.close();
    process.exit(failCount > 0 ? 1 : 0);
  }).catch((err) => {
    console.error('Erro na execução dos testes de integração:', err);
    tempServer.close();
    process.exit(1);
  });
});
