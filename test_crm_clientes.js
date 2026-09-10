/**
 * test_crm_clientes.js
 * Testes dos novos métodos e rotas de crm_clientes
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
const clientesCacheFile = path.join(__dirname, 'data', 'crm_clientes_cache.json');

function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

function makeRequest(app, method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const options = {
        hostname: '127.0.0.1',
        port: port,
        path: path,
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
          } catch (e) {
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

async function runTests() {
  console.log('🧪 Iniciando testes de CRM Clientes...\n');

  const app = express();
  app.use(express.json());
  app.use('/api/bi/crm', crmRoutes);

  const tokenAlexandre = generateToken({ username: 'alexandre', name: 'Alexandre GSI', role: 'admin' });
  const tokenVendedor = generateToken({ username: 'juliana', name: 'Juliana Vendedora', role: 'vendedor' });

  // 1. Teste de segurança: Bloqueio não autenticado
  console.log('1️⃣  Teste: Bloqueio para requisições anônimas');
  const resAnon = await makeRequest(app, 'GET', '/api/bi/crm/clientes');
  assert.strictEqual(resAnon.status, 401, 'Deveria retornar 401 para sem token');
  console.log('   ✅ 401 Unauthorized confirmado.');

  // 2. Teste de segurança: Bloqueio para perfil vendedor
  console.log('2️⃣  Teste: Bloqueio para perfil vendedor (403 Forbidden)');
  const resVend = await makeRequest(app, 'GET', '/api/bi/crm/clientes', {
    'Authorization': `Bearer ${tokenVendedor}`
  });
  assert.strictEqual(resVend.status, 403, 'Deveria retornar 403 para vendedor');
  console.log('   ✅ 403 Forbidden para vendedor confirmado.');

  // 3. Teste: Cadastro de cliente comercial via API
  console.log('3️⃣  Teste: Cadastro de cliente via POST /api/bi/crm/clientes');
  const payloadCliente = {
    nome_razao: 'EMPRESA TESTE SEGURANCA LTDA',
    nome_fantasia: 'SEGURANCA TOTAL',
    cnpj_cpf: '12.345.678/0001-99',
    ie: '123456789',
    contato_nome: 'Carlos Gerente',
    telefone: '1133334444',
    celular_whatsapp: '11999998888',
    email: 'carlos@segurancatotal.com.br',
    tipo_cliente_protheus: 'F',
    site_url: 'https://www.segurancatotal.com.br',
    email_nfe: 'nfe@segurancatotal.com.br',
    email_boleto: 'cobranca@segurancatotal.com.br',
    contato_financeiro_nome: 'Amilton Financeiro',
    contato_financeiro_tel: '11988887777',
    contato_financeiro_email: 'financeiro@segurancatotal.com.br',
    cep: '01001-000',
    logradouro: 'Praça da Sé',
    numero: '100',
    complemento: 'Sala 501',
    bairro: 'Sé',
    cidade: 'São Paulo',
    uf: 'SP',
    origem: 'INDICACAO',
    vendedor_responsavel: '000004',
    observacoes: 'Cliente potencial para cofres de alta segurança'
  };

  const resCriar = await makeRequest(app, 'POST', '/api/bi/crm/clientes', {
    'Authorization': `Bearer ${tokenAlexandre}`
  }, payloadCliente);

  assert.strictEqual(resCriar.status, 201, `Status esperado 201, recebido ${resCriar.status}`);
  assert.strictEqual(resCriar.body.success, true);
  const clienteCriado = resCriar.body.data;
  assert(clienteCriado.id.startsWith('CLI-'), 'ID deve iniciar com CLI-');
  assert.strictEqual(clienteCriado.nome_razao, 'EMPRESA TESTE SEGURANCA LTDA');
  assert.strictEqual(clienteCriado.cnpj_cpf, '12345678000199');
  assert.strictEqual(clienteCriado.cnpj_cpf_fmt, '12.345.678/0001-99');
  assert.strictEqual(clienteCriado.tipo_cliente_protheus, 'F');
  assert.strictEqual(clienteCriado.site_url, 'www.segurancatotal.com.br');
  assert.strictEqual(clienteCriado.email_nfe, 'nfe@segurancatotal.com.br');
  assert.strictEqual(clienteCriado.email_boleto, 'cobranca@segurancatotal.com.br');
  assert.strictEqual(clienteCriado.contato_financeiro_nome, 'Amilton Financeiro');
  assert.strictEqual(clienteCriado.contato_financeiro_tel, '11988887777');
  assert.strictEqual(clienteCriado.contato_financeiro_email, 'financeiro@segurancatotal.com.br');
  console.log(`   ✅ Cliente #${clienteCriado.id} criado com sucesso com campos fiscais e financeiro.`);

  // 4. Teste: Consulta por ID via GET /api/bi/crm/clientes/:id
  console.log('4️⃣  Teste: Consulta por ID via GET /api/bi/crm/clientes/:id');
  const resGet = await makeRequest(app, 'GET', `/api/bi/crm/clientes/${clienteCriado.id}`, {
    'Authorization': `Bearer ${tokenAlexandre}`
  });
  assert.strictEqual(resGet.status, 200);
  assert.strictEqual(resGet.body.data.id, clienteCriado.id);
  assert.strictEqual(resGet.body.data.contato_nome, 'Carlos Gerente');
  assert.strictEqual(resGet.body.data.site_url, 'www.segurancatotal.com.br');
  assert.strictEqual(resGet.body.data.email_nfe, 'nfe@segurancatotal.com.br');
  assert.strictEqual(resGet.body.data.email_boleto, 'cobranca@segurancatotal.com.br');
  assert.strictEqual(resGet.body.data.contato_financeiro_nome, 'Amilton Financeiro');
  assert.strictEqual(resGet.body.data.contato_financeiro_email, 'financeiro@segurancatotal.com.br');
  console.log('   ✅ Cliente obtido com sucesso por ID com campos estendidos.');

  // 5. Teste: Edição de cliente via POST /api/bi/crm/clientes com ID
  console.log('5️⃣  Teste: Edição de cliente via POST com id');
  const resEditar = await makeRequest(app, 'POST', '/api/bi/crm/clientes', {
    'Authorization': `Bearer ${tokenAlexandre}`
  }, {
    id: clienteCriado.id,
    nome_razao: 'EMPRESA TESTE SEGURANCA LTDA - ATUALIZADA',
    nome_fantasia: 'SEGURANCA VIP',
    vendedor_responsavel: '000074',
    site_url: 'https://www.segurancavip.com.br',
    contato_financeiro_nome: 'Joyce Contas a Pagar'
  });
  assert.strictEqual(resEditar.status, 200);
  assert.strictEqual(resEditar.body.data.nome_razao, 'EMPRESA TESTE SEGURANCA LTDA - ATUALIZADA');
  assert.strictEqual(resEditar.body.data.vendedor_responsavel, '000074');
  assert.strictEqual(resEditar.body.data.site_url, 'www.segurancavip.com.br');
  assert.strictEqual(resEditar.body.data.contato_financeiro_nome, 'Joyce Contas a Pagar');
  console.log('   ✅ Cliente editado com sucesso.');

  // 6. Teste: Listagem paginada e com filtros
  console.log('6️⃣  Teste: Listagem paginada GET /api/bi/crm/clientes');
  const resList = await makeRequest(app, 'GET', `/api/bi/crm/clientes?busca=SEGURANCA&limit=10`, {
    'Authorization': `Bearer ${tokenAlexandre}`
  });
  assert.strictEqual(resList.status, 200);
  assert.strictEqual(resList.body.success, true);
  assert(Array.isArray(resList.body.data), 'data deve ser array');
  assert(resList.body.pagination, 'deve conter objeto pagination');
  assert(resList.body.data.some(c => c.id === clienteCriado.id), 'cliente criado deve constar na busca');
  console.log(`   ✅ Listagem retornou ${resList.body.data.length} itens (total: ${resList.body.pagination.total}).`);

  // 7. Teste: Autocomplete integrando CRM (prioritário) e Protheus
  console.log('7️⃣  Teste: Autocomplete GET /api/bi/crm/clientes/autocomplete');
  const resAuto = await makeRequest(app, 'GET', `/api/bi/crm/clientes/autocomplete?q=SEGURANCA`, {
    'Authorization': `Bearer ${tokenAlexandre}`
  });
  assert.strictEqual(resAuto.status, 200);
  assert.strictEqual(resAuto.body.success, true);
  const matchCrm = resAuto.body.data.find(c => c.cnpj === '12345678000199' || c.id === clienteCriado.id);
  assert(matchCrm, 'Cliente do CRM deve aparecer no autocomplete');
  assert.strictEqual(matchCrm.origem_fonte, 'CRM', 'origem_fonte deve ser CRM');
  assert.strictEqual(matchCrm.is_novo_crm, true, 'is_novo_crm deve ser true');
  console.log('   ✅ Autocomplete com prioridade CRM validado.');

  // 8. Teste: Soft Delete via DELETE /api/bi/crm/clientes/:id
  console.log('8️⃣  Teste: Soft Delete via DELETE /api/bi/crm/clientes/:id');
  const resDel = await makeRequest(app, 'DELETE', `/api/bi/crm/clientes/${clienteCriado.id}`, {
    'Authorization': `Bearer ${tokenAlexandre}`
  });
  assert.strictEqual(resDel.status, 200);
  assert.strictEqual(resDel.body.success, true);

  // Confirma que não aparece mais na listagem nem na busca por ID
  const resCheck = await makeRequest(app, 'GET', `/api/bi/crm/clientes/${clienteCriado.id}`, {
    'Authorization': `Bearer ${tokenAlexandre}`
  });
  assert.strictEqual(resCheck.status, 404, 'Cliente excluído deve retornar 404');
  console.log('   ✅ Soft delete validado com sucesso.');

  // 9. Teste: Consulta de CEP via GET /api/bi/crm/cep/:cep
  console.log('9️⃣  Teste: Consulta de CEP no ViaCEP via GET /api/bi/crm/cep/:cep');
  const resCep = await makeRequest(app, 'GET', `/api/bi/crm/cep/01001-000`, {
    'Authorization': `Bearer ${tokenAlexandre}`
  });
  assert.strictEqual(resCep.status, 200, `Esperado status 200 no CEP, recebido ${resCep.status}`);
  assert.strictEqual(resCep.body.success, true);
  assert(resCep.body.data, 'deve retornar objeto data');
  assert.strictEqual(resCep.body.data.uf, 'SP');
  assert.strictEqual(resCep.body.data.cidade, 'São Paulo');
  assert.strictEqual(resCep.body.data.logradouro, 'Praça da Sé');
  assert.strictEqual(resCep.body.data.bairro, 'Sé');
  // Garante que número e complemento não são retornados/forçados
  assert.strictEqual(resCep.body.data.numero, undefined, 'numero deve ser indefinido');
  assert.strictEqual(resCep.body.data.complemento, undefined, 'complemento deve ser indefinido');

  // Teste de CEP inválido
  const resCepInvalido = await makeRequest(app, 'GET', `/api/bi/crm/cep/123`, {
    'Authorization': `Bearer ${tokenAlexandre}`
  });
  assert.strictEqual(resCepInvalido.status, 400, 'CEP menor que 8 dígitos deve retornar 400');
  console.log('   ✅ Consulta de CEP e validação de 8 dígitos aprovadas com sucesso.');

  // 10. Teste: Normalização e validação de Site sem necessidade de http/https
  console.log('🔟 Teste: Normalização de site_url com e sem www / http / https');
  assert.strictEqual(crmEngine.normalizarSiteUrl('https://www.cliente.com.br/'), 'www.cliente.com.br');
  assert.strictEqual(crmEngine.normalizarSiteUrl('http://cliente.com.br'), 'cliente.com.br');
  assert.strictEqual(crmEngine.normalizarSiteUrl('www.cliente.com.br'), 'www.cliente.com.br');
  assert.strictEqual(crmEngine.normalizarSiteUrl('cliente.com.br'), 'cliente.com.br');
  assert.strictEqual(crmEngine.normalizarSiteUrl(''), '');
  console.log('   ✅ Normalização de site corporativo validada com perfeição.');

  // Limpeza do cache para manter data/crm_clientes_cache.json limpo
  try {
    const raw = fs.readFileSync(clientesCacheFile, 'utf8');
    const data = JSON.parse(raw);
    if (data.clientes) {
      data.clientes = data.clientes.filter(c => c.id !== clienteCriado.id);
      fs.writeFileSync(clientesCacheFile, JSON.stringify(data, null, 2), 'utf8');
    }
  } catch (e) {}

  console.log('\n🎉 TODOS OS TESTES DE CRM CLIENTES PASSARAM COM SUCESSO!');
}

runTests().catch(err => {
  console.error('❌ Falha nos testes:', err);
  process.exit(1);
});
