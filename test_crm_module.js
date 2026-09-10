/**
 * test_crm_module.js
 * Suite de Testes Automatizados para o Módulo CRM Comercial Nativo
 * Plataforma de Apoio GSI (Gemini-Cli)
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crmEngine = require('./crm_engine');
const express = require('express');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'gsi_portal_jwt_secret_key_prod_2026_x89a';
const cacheFile = path.join(__dirname, 'data', 'crm_deals_cache.json');

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
          resolve({ status: res.statusCode, body: parsed, headers: res.headers });
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
  console.log('🧪 Iniciando Bateria Completa de Testes do Módulo CRM Comercial Nativo...\n');

  // Teste 1: Teste de Unidade do Engine (Criação de Deal)
  console.log('1️⃣  Teste: Criação de Deal no crm_engine');
  const dealMock = {
    titulo: 'Cotação Painéis Solares e Inversores - Cliente Teste S/A',
    cliente_nome: 'CLIENTE TESTE COMERCIO LTDA',
    cliente_cnpj_cpf: '12.345.678/0001-90',
    cliente_cod: '001234',
    cliente_loja: '01',
    cod_vendedor: '000004',
    nome_vendedor: 'Figueiredo',
    estagio: 'PROPOSTA',
    valor_total: 45000.50,
    probabilidade: 60,
    cond_pgto: '28 DDL',
    tipo_frete: 'CIF',
    frete_cobrado: 1200.00,
    frete_embutido: 350.00,
    transportadora: 'RODONAVES',
    itens_cotados: [
      { codigo: '0010001', descricao: 'Inversor 5kW', qtd: 2, preco_unit: 15000.00, total: 30000.00 },
      { codigo: '0010002', descricao: 'Módulo Solar 550W', qtd: 20, preco_unit: 750.00, total: 15000.00 }
    ],
    contatos: [
      { nome: 'Carlos Comprador', cargo: 'Gerente de Compras', telefone: '11999998888', email: 'carlos@teste.com' }
    ]
  };

  const dealCriado = await crmEngine.criarDeal(dealMock, 'alexandre');
  assert.ok(dealCriado.id, 'Deal criado deve possuir ID string');
  assert.strictEqual(dealCriado.estagio.toLowerCase(), 'proposta', 'Estágio inicial deve ser proposta');
  assert.strictEqual(dealCriado.valor_total, 45000.50, 'Valor total deve bater');
  assert.strictEqual(dealCriado.frete_embutido, 350.00, 'Frete embutido deve ser registrado');
  assert.strictEqual(dealCriado.itens_cotados.length, 2, 'Deve conter 2 itens cotados');
  assert.strictEqual(dealCriado.contatos.length, 1, 'Deve conter 1 contato');
  console.log('   ✅ Deal criado com sucesso (ID:', dealCriado.id, ')');

  // Teste 2: Transição de Estágio do Kanban
  console.log('2️⃣  Teste: Transição de Estágio do Kanban (PROPOSTA -> NEGOCIACAO)');
  const dealAtualizado = await crmEngine.atualizarEstagioDeal(dealCriado.id, 'NEGOCIACAO', 'alexandre', 'Negociação avançada com diretoria');
  assert.strictEqual(dealAtualizado.estagio.toLowerCase(), 'negociacao', 'Novo estágio deve ser negociacao');
  assert.ok(dealAtualizado.historico_estagios.length >= 2, 'Histórico de estágios deve registrar a transição');
  console.log('   ✅ Estágio atualizado com telemetria e histórico gravado.');

  // Teste 3: Atividades e Follow-up do Deal
  console.log('3️⃣  Teste: Registro de Follow-up (Atividades)');
  const atividadeMock = {
    tipo: 'LIGACAO',
    assunto: 'Ligação de alinhamento com Carlos',
    descricao: 'Cliente solicitou prazo adicional de 7 dias para pagamento. Proposta aceita em princípio.',
    concluida: true
  };
  const atividadeCriada = await crmEngine.criarAtividadeDeal(dealCriado.id, atividadeMock, 'alexandre');
  assert.ok(atividadeCriada.id, 'Atividade deve possuir ID');
  assert.strictEqual(atividadeCriada.tipo.toUpperCase(), 'LIGACAO');

  const listaAtividades = await crmEngine.listarAtividadesDeal(dealCriado.id);
  assert.ok(listaAtividades.length >= 1, 'Deve retornar ao menos 1 atividade para o deal');
  console.log('   ✅ Atividade registrada na linha do tempo com sucesso.');

  // Teste 4: Autocomplete de Clientes com Sanitização de Colchetes T-SQL
  console.log('4️⃣  Teste: Autocomplete de Clientes (SA1010 / Cache com sanitização T-SQL)');
  const clientes = await crmEngine.autocompleteClientes('TESTE[01]');
  assert.ok(Array.isArray(clientes), 'Autocomplete deve retornar um array mesmo com caracteres especiais');
  console.log('   ✅ Autocomplete com caracteres especiais executou sem quebras de sintaxe.');

  // Teste 5: Segurança das Rotas HTTP e RBAC Zero-Trust
  console.log('5️⃣  Teste: Segurança HTTP e Trava RBAC para Alexandre / Admin');
  const app = express();
  app.use(express.json());
  const crmRoutes = require('./crm_routes');
  app.use('/api/bi/crm', crmRoutes);

  // 5.1: Requisição Sem Token (Anônima) -> Deve retornar 401
  const resAnon = await makeRequest(app, 'GET', '/api/bi/crm/deals');
  assert.strictEqual(resAnon.status, 401, 'Requisição anônima deve ser rejeitada com 401');
  console.log('   ✅ 401 Unauthorized para chamada anônima.');

  // 5.2: Requisição com Token de Vendedor (ex: Figueiredo) -> Deve retornar 403
  const tokenVendedor = generateToken({ username: 'figueiredo', role: 'vendedor', vendorCode: '000004' });
  const resVendedor = await makeRequest(app, 'GET', '/api/bi/crm/deals', {
    'Authorization': `Bearer ${tokenVendedor}`
  });
  assert.strictEqual(resVendedor.status, 403, 'Requisição de vendedor deve ser bloqueada com 403');
  assert.strictEqual(resVendedor.body.error && resVendedor.body.error.code, 'FORBIDDEN_VENDOR', 'Código de erro deve indicar bloqueio de vendedor');
  console.log('   ✅ 403 Forbidden para vendedor comum.');

  // 5.3: Requisição com Token do Administrador Alexandre -> Deve retornar 200
  const tokenAlexandre = generateToken({ username: 'alexandre', role: 'admin' });
  const resAlexandre = await makeRequest(app, 'GET', '/api/bi/crm/deals', {
    'Authorization': `Bearer ${tokenAlexandre}`
  });
  assert.strictEqual(resAlexandre.status, 200, 'Requisição de Alexandre deve ser aceita com 200');
  assert.ok(resAlexandre.body.success, 'Resposta deve indicar sucesso');
  assert.ok(Array.isArray(resAlexandre.body.data), 'Deals deve ser uma lista em res.body.data');
  console.log('   ✅ 200 OK para Alexandre com listagem de deals.');

  // 5.4: Teste de PATCH de Estágio via HTTP por Alexandre
  const resPatch = await makeRequest(app, 'PATCH', `/api/bi/crm/deals/${dealCriado.id}/stage`, {
    'Authorization': `Bearer ${tokenAlexandre}`
  }, { novoEstagio: 'GANHO', justificativa: 'Pedido aprovado pelo cliente!' });
  assert.strictEqual(resPatch.status, 200, 'Patch de estágio por Alexandre deve retornar 200');
  assert.strictEqual(resPatch.body.data.estagio.toLowerCase(), 'ganho', 'Estágio retornado deve ser ganho');
  console.log('   ✅ 200 OK para transição de estágio via HTTP (GANHO).');

  // Teste 6: Soft Delete
  console.log('6️⃣  Teste: Soft Delete de Oportunidade');
  const resDel = await makeRequest(app, 'DELETE', `/api/bi/crm/deals/${dealCriado.id}`, {
    'Authorization': `Bearer ${tokenAlexandre}`
  });
  assert.strictEqual(resDel.status, 200, 'Exclusão deve retornar 200');
  const dealExcluido = await crmEngine.obterDealPorId(dealCriado.id);
  assert.strictEqual(dealExcluido, null, 'Deal excluído não deve ser retornado em consultas ativas (soft delete)');
  console.log('   ✅ Soft delete executado preservando integridade histórica.');

  // Teste 7: Restauração de Oportunidade
  console.log('7️⃣  Teste: Restauração de Oportunidade (Reversibilidade de Exclusão)');
  const resRestore = await makeRequest(app, 'POST', `/api/bi/crm/deals/${dealCriado.id}/restore`, {
    'Authorization': `Bearer ${tokenAlexandre}`
  });
  assert.strictEqual(resRestore.status, 200, 'Restauração deve retornar 200');
  const dealRestaurado = await crmEngine.obterDealPorId(dealCriado.id);
  assert.ok(dealRestaurado, 'Deal deve voltar a ser visível após restauração');
  assert.strictEqual(dealRestaurado.ativo, true, 'Deal restaurado deve estar ativo');
  console.log('   ✅ Oportunidade restaurada com sucesso.');

  // Teste 8: Endpoint de Vendedores
  console.log('8️⃣  Teste: Endpoint GET /api/bi/crm/vendedores');
  const resVend = await makeRequest(app, 'GET', '/api/bi/crm/vendedores', {
    'Authorization': `Bearer ${tokenAlexandre}`
  });
  assert.strictEqual(resVend.status, 200, 'Endpoint de vendedores deve responder 200');
  assert.ok(Array.isArray(resVend.body.data), 'Deve retornar lista de vendedores');
  assert.ok(resVend.body.data.length >= 3, 'Deve listar ao menos 3 vendedores');
  console.log('   ✅ Vendedores listados com sucesso:', resVend.body.data.map(v => v.nome).join(', '));

  // Teste 9: Validação Estrita de Estágios Canônicos
  console.log('9️⃣  Teste: Rejeição de Estágio Inválido (Domínio)');
  await assert.rejects(
    async () => {
      await crmEngine.criarDeal({
        titulo: 'Deal Inválido',
        cliente_nome: 'Cliente Inválido',
        estagio: 'ESTAGIO_INVENTADO'
      }, 'alexandre');
    },
    /Estágio .* inválido/,
    'Deve rejeitar estágio que não esteja na lista canônica'
  );
  console.log('   ✅ Validação de estágios canônicos funcionando perfeitamente.');

  // Teste 10: Regra de Frete Embutido vs Frete Cobrado
  console.log('🔟 Teste: Regra de Frete Embutido no Cálculo do Total');
  const dealFrete = await crmEngine.criarDeal({
    titulo: 'Teste Frete Embutido',
    cliente_nome: 'Cliente Frete',
    estagio: 'PROPOSTA',
    itens_cotados: [
      { codigo: '001', descricao: 'Item 1', qtd: 1, preco_unit: 1000.00 }
    ],
    frete_embutido: 200.00,
    frete_cobrado: 50.00
  }, 'alexandre');
  // Total deve ser 1000 (item) + 50 (frete cobrado) = 1050. Frete embutido (200) NÃO deve somar!
  assert.strictEqual(dealFrete.valor_total, 1050.00, 'Frete embutido NÃO pode ser somado ao total geral');
  assert.strictEqual(dealFrete.frete_embutido, 200.00, 'Frete embutido deve ser registrado para dedução de margem');
  console.log('   ✅ Regra de frete embutido validada com exatidão matemática (R$ 1.050,00).');

  // Limpeza: expurga negócios de teste gerados para manter data/crm_deals_cache.json 100% limpo
  try {
    const rawCache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    rawCache.deals = rawCache.deals.filter(d => !d.titulo.includes('Teste') && !d.titulo.includes('Cotação Painéis'));
    rawCache.atividades = rawCache.atividades.filter(a => !a.assunto.includes('Carlos'));
    rawCache.updated_at = new Date().toISOString();
    fs.writeFileSync(cacheFile, JSON.stringify(rawCache, null, 2), 'utf8');
    console.log('🧹 Cache de produção data/crm_deals_cache.json higienizado após os testes.');
  } catch (err) {
    console.warn('Aviso na higienização:', err.message);
  }

  console.log('\n🎉 TODOS OS 10 TESTES DO CRM COMERCIAL NATIVO FORAM APROVADOS COM 100% DE SUCESSO!\n');
}

runTests().catch(err => {
  console.error('\n❌ ERRO NOS TESTES DO CRM:', err);
  process.exit(1);
});
