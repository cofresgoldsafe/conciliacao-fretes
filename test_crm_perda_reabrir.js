/**
 * ============================================================================
 * SUÍTE DE TESTES AUTOMATIZADOS — CRM-23 (MOTIVO DE PERDA, LEAD AVULSO E REGRAS)
 * ============================================================================
 * Cobre os cenários 1 a 10 e o cenário 18 (parcial: cenários 4 e 7 em cache)
 * da Seção 8 de docs/telas/08_bi_executivo/crm23_perda_lead_reabrir.md:
 * - Cenário 1: GET /motivos-perda (7 itens na ordem canônica)
 * - Cenário 2: PATCH stage -> perdido sem motivo (400 MOTIVO_PERDA_OBRIGATORIO)
 * - Cenário 3: PATCH stage -> perdido com motivo inválido (400 MOTIVO_PERDA_OBRIGATORIO)
 * - Cenário 4: PATCH stage -> perdido com motivoPerdaCod e justificativa (200)
 * - Cenário 5: PUT deal com estagio='perdido' sem motivo (400 MOTIVO_PERDA_OBRIGATORIO)
 * - Cenário 6: criarDeal sem cliente e sem contato (400 CLIENTE_OU_CONTATO_OBRIGATORIO)
 * - Cenário 7: criarDeal sem cliente, com contato { nome, telefone } (201)
 * - Cenário 8: Deal sem cliente -> proposta -> negociacao (200 nos dois)
 * - Cenário 9: Deal sem cliente/CNPJ -> ganho via PATCH e PUT (400 CLIENTE_DOC_OBRIGATORIO_GANHO)
 * - Cenário 10: Deal com CPF (11 dígitos) -> ganho (200 e data_fechamento_real gravado)
 * - Cenário 18 (parcial): Versão sem Postgres dos cenários 4 e 7 (fallback JSON)
 * ============================================================================
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-secret-crm23-perda-reabrir-suite';
}

const db = require('./postgres_db');
const auditLogsCapturados = [];
const originalIsConfigured = db.isConfigured;
const originalLogUserActivity = db.logUserActivity;
const originalGetConfigMetas = db.getConfigMetasVendasDB;

db.logUserActivity = async (entry) => {
  auditLogsCapturados.push(entry);
  return true;
};
db.getConfigMetasVendasDB = async () => ({ metaBaseVendas: 120000.00 });

const crmVendedores = require('./crm_vendedores');
const crmEngine = require('./crm_engine');
const crmRoutes = require('./crm_routes');

const JWT_SECRET = process.env.JWT_SECRET;
const cacheFile = path.join(__dirname, 'data', 'crm_deals_cache.json');
const originalCacheRaw = fs.existsSync(cacheFile) ? fs.readFileSync(cacheFile, 'utf8') : null;

function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

function makeRequest(app, method, reqPath, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      const options = {
        hostname: '127.0.0.1',
        port,
        path: reqPath,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        }
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          server.close();
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
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
  console.log('🧪 Iniciando Suite de Testes CRM-23 (Motivo de Perda, Lead Avulso e Validações)...\n');

  crmVendedores.invalidarCacheVendedores();
  crmVendedores.restaurarFallbackPadrao();

  const app = express();
  app.use(express.json());
  app.use('/api/bi/crm', crmRoutes);

  const tokenAdmin = generateToken({
    username: 'alexandre',
    name: 'Alexandre',
    role: 'admin',
    permissions: ['bi', 'crm']
  });
  const authAdmin = { Authorization: `Bearer ${tokenAdmin}` };

  const tokenJuliana = generateToken({
    username: 'juliana',
    name: 'Juliana',
    role: 'vendedor',
    vendorCode: '000074',
    permissions: ['vendedores', 'crm']
  });
  const authJuliana = { Authorization: `Bearer ${tokenJuliana}` };

  const tokenAndrea = generateToken({
    username: 'andrea',
    name: 'Andrea',
    role: 'vendedor',
    vendorCode: '000064',
    permissions: ['vendedores', 'crm']
  });
  const authAndrea = { Authorization: `Bearer ${tokenAndrea}` };

  try {
    // ------------------------------------------------------------------------
    // Cenário 1: GET /motivos-perda (7 itens na ordem canônica)
    // ------------------------------------------------------------------------
    console.log('1️⃣  Cenário 1: GET /api/bi/crm/motivos-perda retorna 7 motivos na ordem canônica');
    const res1 = await makeRequest(app, 'GET', '/api/bi/crm/motivos-perda', authAdmin);
    assert.strictEqual(res1.status, 200, 'Status deve ser 200');
    assert.strictEqual(res1.body.success, true, 'success deve ser true');
    assert(Array.isArray(res1.body.data), 'data deve ser array');
    assert.strictEqual(res1.body.data.length, 7, 'Deve conter exatamente 7 motivos');

    const expectedCodigos = [
      'preco',
      'prazo_entrega',
      'produto_nao_atende',
      'compra_cancelada',
      'sem_resposta',
      'credito_negado',
      'transferido_outro_vendedor'
    ];
    const expectedLabels = [
      'Preço',
      'Prazo de Entrega',
      'Produto Não Atende',
      'Compra Cancelada',
      'Sem Resposta',
      'Crédito Negado',
      'Transferido para Outro Vendedor'
    ];

    res1.body.data.forEach((m, idx) => {
      assert.strictEqual(m.cod, expectedCodigos[idx], `Código no índice ${idx} deve ser ${expectedCodigos[idx]}`);
      assert.strictEqual(m.label, expectedLabels[idx], `Label no índice ${idx} deve ser ${expectedLabels[idx]}`);
    });
    console.log('   ✅ 7 motivos validados com exatidão na ordem canônica.');

    // ------------------------------------------------------------------------
    // Criação de Deal de base para os cenários 2, 3, 4 e 5
    // ------------------------------------------------------------------------
    const resBase = await makeRequest(app, 'POST', '/api/bi/crm/deals', authJuliana, {
      titulo: 'Deal Teste Perda',
      cliente_nome: 'CLIENTE JULIANA LTDA',
      cliente_cnpj: '11.222.333/0001-81',
      estagio: 'proposta',
      valor_total: 15000.00
    });
    assert.strictEqual(resBase.status, 201, 'Criação do deal base deve retornar 201');
    const dealBaseId = resBase.body.data.id;
    assert(dealBaseId, 'Deal base deve possuir ID');

    // ------------------------------------------------------------------------
    // Cenário 2: PATCH stage -> perdido sem motivo (400 MOTIVO_PERDA_OBRIGATORIO)
    // ------------------------------------------------------------------------
    console.log('2️⃣  Cenário 2: PATCH stage -> perdido sem motivo retorna 400 MOTIVO_PERDA_OBRIGATORIO');
    const res2 = await makeRequest(app, 'PATCH', `/api/bi/crm/deals/${dealBaseId}/stage`, authJuliana, {
      novoEstagio: 'perdido'
    });
    assert.strictEqual(res2.status, 400, 'Status deve ser 400');
    assert.strictEqual(res2.body.error?.code, 'MOTIVO_PERDA_OBRIGATORIO', 'Erro deve ser MOTIVO_PERDA_OBRIGATORIO');

    const res2Check = await makeRequest(app, 'GET', `/api/bi/crm/deals/${dealBaseId}`, authJuliana);
    assert.strictEqual(res2Check.body.data.estagio, 'proposta', 'Estágio não deve ter sido alterado');
    console.log('   ✅ Bloqueio confirmado e estágio preservado.');

    // ------------------------------------------------------------------------
    // Cenário 3: PATCH stage -> perdido com motivo inválido ('Outro' ou 'concorrente')
    // ------------------------------------------------------------------------
    console.log('3️⃣  Cenário 3: PATCH stage -> perdido com "Outro" ou "concorrente" retorna 400');
    const res3a = await makeRequest(app, 'PATCH', `/api/bi/crm/deals/${dealBaseId}/stage`, authJuliana, {
      novoEstagio: 'perdido',
      motivoPerda: 'Outro'
    });
    assert.strictEqual(res3a.status, 400);
    assert.strictEqual(res3a.body.error?.code, 'MOTIVO_PERDA_OBRIGATORIO');

    const res3b = await makeRequest(app, 'PATCH', `/api/bi/crm/deals/${dealBaseId}/stage`, authJuliana, {
      novoEstagio: 'perdido',
      motivoPerda: 'concorrente'
    });
    assert.strictEqual(res3b.status, 400);
    assert.strictEqual(res3b.body.error?.code, 'MOTIVO_PERDA_OBRIGATORIO');
    console.log('   ✅ Rejeição de motivos fora da lista fechada confirmada.');

    // ------------------------------------------------------------------------
    // Cenário 4: PATCH stage -> perdido com motivoPerdaCod: 'credito_negado' e justificativa
    // ------------------------------------------------------------------------
    console.log('4️⃣  Cenário 4: PATCH stage -> perdido com credito_negado e justificativa retorna 200');
    const res4 = await makeRequest(app, 'PATCH', `/api/bi/crm/deals/${dealBaseId}/stage`, authJuliana, {
      novoEstagio: 'perdido',
      motivoPerdaCod: 'credito_negado',
      justificativa: 'Restrição cadastral Serasa'
    });
    assert.strictEqual(res4.status, 200, 'Status deve ser 200');
    assert.strictEqual(res4.body.data.estagio, 'perdido');
    assert.strictEqual(res4.body.data.motivo_perda_cod, 'credito_negado');
    assert.strictEqual(res4.body.data.motivo_perda, 'Crédito Negado');

    const hist4 = res4.body.data.historico_estagios || [];
    const ultimoHist4 = hist4[hist4.length - 1] || {};
    assert(
      ultimoHist4.justificativa?.includes('Perdido: Crédito Negado — Restrição cadastral Serasa'),
      `Justificativa no histórico deve conter "Perdido: Crédito Negado — Restrição cadastral Serasa", obtido: "${ultimoHist4.justificativa}"`
    );
    console.log('   ✅ Perda estruturada gravada com sucesso com código, label e justificativa.');

    // ------------------------------------------------------------------------
    // Cenário 5: PUT do deal com estagio: 'perdido' sem motivo (400 MOTIVO_PERDA_OBRIGATORIO)
    // ------------------------------------------------------------------------
    console.log('5️⃣  Cenário 5: PUT deal com estagio="perdido" sem motivo retorna 400 MOTIVO_PERDA_OBRIGATORIO');
    const resDealAberto = await makeRequest(app, 'POST', '/api/bi/crm/deals', authJuliana, {
      titulo: 'Deal Aberto para PUT Perdido',
      cliente_nome: 'CLIENTE TESTE PUT',
      cliente_cnpj: '11.222.333/0001-81',
      estagio: 'contato'
    });
    assert.strictEqual(resDealAberto.status, 201);
    const dealPutId = resDealAberto.body.data.id;

    const res5 = await makeRequest(app, 'PUT', `/api/bi/crm/deals/${dealPutId}`, authJuliana, {
      estagio: 'perdido'
    });
    assert.strictEqual(res5.status, 400);
    assert.strictEqual(res5.body.error?.code, 'MOTIVO_PERDA_OBRIGATORIO');
    console.log('   ✅ Validação na rota PUT confirmada.');

    // ------------------------------------------------------------------------
    // Cenário 6: criarDeal sem cliente e sem contato (400 CLIENTE_OU_CONTATO_OBRIGATORIO)
    // ------------------------------------------------------------------------
    console.log('6️⃣  Cenário 6: criarDeal sem cliente e sem contato retorna 400 CLIENTE_OU_CONTATO_OBRIGATORIO');
    let errCenario6 = null;
    try {
      await crmEngine.criarDeal({
        titulo: 'Deal Fantasma Sem Cliente',
        cod_vendedor: '000074'
      }, 'alexandre', { all: true });
    } catch (e) {
      errCenario6 = e;
    }
    assert(errCenario6, 'Deve lançar erro');
    assert.strictEqual(errCenario6.status, 400);
    assert.strictEqual(errCenario6.code, 'CLIENTE_OU_CONTATO_OBRIGATORIO');

    const res6Http = await makeRequest(app, 'POST', '/api/bi/crm/deals', authJuliana, {
      titulo: 'Deal Fantasma HTTP'
    });
    assert.strictEqual(res6Http.status, 400);
    assert.strictEqual(res6Http.body.error?.code, 'CLIENTE_OU_CONTATO_OBRIGATORIO');
    console.log('   ✅ Bloqueio no motor e na rota HTTP confirmado.');

    // ------------------------------------------------------------------------
    // Cenário 7: criarDeal sem cliente, com contato { nome, telefone }
    // ------------------------------------------------------------------------
    console.log('7️⃣  Cenário 7: criarDeal sem cliente com contato avulso retorna 201, cliente_nome="", estágio lead');
    const res7 = await makeRequest(app, 'POST', '/api/bi/crm/deals', authJuliana, {
      titulo: 'Lead Avulso Contato',
      cliente_nome: '',
      contatos: [
        { nome: 'Roberto Almeida', telefone: '(11) 98765-4321' }
      ]
    });
    assert.strictEqual(res7.status, 201, 'Deve criar com 201');
    assert.strictEqual(res7.body.data.cliente_nome, '', 'cliente_nome deve ser vazio');
    assert.strictEqual(res7.body.data.estagio, 'lead', 'Estágio inicial deve ser lead');
    assert(Array.isArray(res7.body.data.contatos), 'contatos deve ser array');
    assert.strictEqual(res7.body.data.contatos[0]?.nome, 'Roberto Almeida');
    assert.strictEqual(res7.body.data.contatos[0]?.telefone, '11987654321');
    const leadAvulsoId = res7.body.data.id;
    console.log('   ✅ Lead avulso criado com sucesso.');

    // ------------------------------------------------------------------------
    // Cenário 8: Deal sem cliente -> proposta -> negociacao (200 nos dois)
    // ------------------------------------------------------------------------
    console.log('8️⃣  Cenário 8: Deal avulso avança para proposta e negociacao com 200');
    const res8a = await makeRequest(app, 'PATCH', `/api/bi/crm/deals/${leadAvulsoId}/stage`, authJuliana, {
      novoEstagio: 'proposta'
    });
    assert.strictEqual(res8a.status, 200);
    assert.strictEqual(res8a.body.data.estagio, 'proposta');

    const res8b = await makeRequest(app, 'PATCH', `/api/bi/crm/deals/${leadAvulsoId}/stage`, authJuliana, {
      novoEstagio: 'negociacao'
    });
    assert.strictEqual(res8b.status, 200);
    assert.strictEqual(res8b.body.data.estagio, 'negociacao');
    console.log('   ✅ Avanço livre até negociação sem exigir cliente/documento.');

    // ------------------------------------------------------------------------
    // Cenário 9: Deal sem cliente/CNPJ -> ganho via PATCH e PUT (400 CLIENTE_DOC_OBRIGATORIO_GANHO)
    // ------------------------------------------------------------------------
    console.log('9️⃣  Cenário 9: Marcar ganho sem cliente/CNPJ retorna 400 CLIENTE_DOC_OBRIGATORIO_GANHO');
    const res9Patch = await makeRequest(app, 'PATCH', `/api/bi/crm/deals/${leadAvulsoId}/stage`, authJuliana, {
      novoEstagio: 'ganho'
    });
    assert.strictEqual(res9Patch.status, 400);
    assert.strictEqual(res9Patch.body.error?.code, 'CLIENTE_DOC_OBRIGATORIO_GANHO');

    const res9Put = await makeRequest(app, 'PUT', `/api/bi/crm/deals/${leadAvulsoId}`, authJuliana, {
      estagio: 'ganho'
    });
    assert.strictEqual(res9Put.status, 400);
    assert.strictEqual(res9Put.body.error?.code, 'CLIENTE_DOC_OBRIGATORIO_GANHO');
    console.log('   ✅ Bloqueio de ganho sem documento confirmado em PATCH e PUT.');

    // ------------------------------------------------------------------------
    // Cenário 10: Deal com CPF (11 dígitos) -> ganho (200 e data_fechamento_real)
    // ------------------------------------------------------------------------
    console.log('🔟 Cenário 10: Deal com CPF (11 dígitos) marcado como ganho retorna 200');
    const res10Put = await makeRequest(app, 'PUT', `/api/bi/crm/deals/${leadAvulsoId}`, authJuliana, {
      cliente_nome: 'Roberto Almeida',
      cliente_cnpj: '123.456.789-01'
    });
    assert.strictEqual(res10Put.status, 200);

    const res10Patch = await makeRequest(app, 'PATCH', `/api/bi/crm/deals/${leadAvulsoId}/stage`, authJuliana, {
      novoEstagio: 'ganho'
    });
    assert.strictEqual(res10Patch.status, 200);
    assert.strictEqual(res10Patch.body.data.estagio, 'ganho');
    assert(res10Patch.body.data.data_fechamento_real, 'data_fechamento_real deve estar gravado');
    console.log('   ✅ Ganho com CPF concluído e data_fechamento_real gravada.');

    // ------------------------------------------------------------------------
    // Cenário 11: Reabrir perdido que veio de negociacao (200, mesmo id, volta negociacao)
    // ------------------------------------------------------------------------
    console.log('1️⃣1️⃣ Cenário 11: Reabrir deal perdido que veio de negociacao retorna 200 e volta para negociacao');
    const resDealPerdido = await makeRequest(app, 'POST', '/api/bi/crm/deals', authJuliana, {
      titulo: 'Deal para Perda e Reabertura',
      cliente_nome: 'CLIENTE NEGOCIACAO REABRIR',
      cliente_cnpj: '11.222.333/0001-81',
      estagio: 'contato',
      valor_total: 18000.00
    });
    assert.strictEqual(resDealPerdido.status, 201);
    const dealPerdidoId = resDealPerdido.body.data.id;

    // Avança para proposta, depois negociacao
    await makeRequest(app, 'PATCH', `/api/bi/crm/deals/${dealPerdidoId}/stage`, authJuliana, { novoEstagio: 'proposta' });
    await makeRequest(app, 'PATCH', `/api/bi/crm/deals/${dealPerdidoId}/stage`, authJuliana, { novoEstagio: 'negociacao' });

    // Marca como perdido com motivo preco
    const resMarcarPerdido = await makeRequest(app, 'PATCH', `/api/bi/crm/deals/${dealPerdidoId}/stage`, authJuliana, {
      novoEstagio: 'perdido',
      motivoPerdaCod: 'preco',
      justificativa: 'Achou o concorrente mais em conta'
    });
    assert.strictEqual(resMarcarPerdido.status, 200);
    assert.strictEqual(resMarcarPerdido.body.data.estagio, 'perdido');
    assert.strictEqual(resMarcarPerdido.body.data.motivo_perda_cod, 'preco');

    // Reabre o deal perdido
    const resReabrirPerdido = await makeRequest(app, 'POST', `/api/bi/crm/deals/${dealPerdidoId}/reabrir`, authJuliana);
    assert.strictEqual(resReabrirPerdido.status, 200, 'Reabrir deve retornar 200');
    assert.strictEqual(resReabrirPerdido.body.data.id, dealPerdidoId, 'O ID deve ser mantido');
    assert.strictEqual(resReabrirPerdido.body.data.estagio, 'negociacao', 'Deve retornar ao estágio negociacao');
    assert.strictEqual(resReabrirPerdido.body.data.motivo_perda_cod, null, 'motivo_perda_cod deve ser limpo (null)');
    assert(
      !resReabrirPerdido.body.data.motivo_perda,
      'motivo_perda deve ser limpo'
    );
    const hist11 = resReabrirPerdido.body.data.historico_estagios || [];
    const ultHist11 = hist11[hist11.length - 1] || {};
    assert(
      ultHist11.justificativa?.includes('Reaberto por juliana (estava perdido: Preço)'),
      `Justificativa deve registrar reabertura com motivo anterior, obtido: "${ultHist11.justificativa}"`
    );
    console.log('   ✅ Deal perdido reaberto com sucesso preservando ID e voltando para negociação.');

    // ------------------------------------------------------------------------
    // Cenário 12: Reabrir ganho que veio de proposta (200, zera fechamento e deduz /meta)
    // ------------------------------------------------------------------------
    console.log('1️⃣2️⃣ Cenário 12: Reabrir ganho que veio de proposta volta para proposta e deduz valor da /meta');
    const resDealGanho = await makeRequest(app, 'POST', '/api/bi/crm/deals', authJuliana, {
      titulo: 'Deal Ganho para Reabertura',
      cliente_nome: 'CLIENTE META GANHO',
      cliente_cnpj: '11.222.333/0001-81',
      estagio: 'proposta',
      valor_total: 25000.00
    });
    assert.strictEqual(resDealGanho.status, 201);
    const dealGanhoId = resDealGanho.body.data.id;

    // Marca como ganho
    const resMarcarGanho = await makeRequest(app, 'PATCH', `/api/bi/crm/deals/${dealGanhoId}/stage`, authJuliana, {
      novoEstagio: 'ganho'
    });
    assert.strictEqual(resMarcarGanho.status, 200);
    assert.strictEqual(resMarcarGanho.body.data.estagio, 'ganho');

    // Mede a meta de Juliana ANTES de reabrir
    const resMetaAntes = await makeRequest(app, 'GET', '/api/bi/crm/meta', authJuliana);
    assert.strictEqual(resMetaAntes.status, 200);
    const realizadoAntes = parseFloat(resMetaAntes.body.data?.realizado || 0);

    // Reabre o deal ganho
    const resReabrirGanho = await makeRequest(app, 'POST', `/api/bi/crm/deals/${dealGanhoId}/reabrir`, authJuliana);
    assert.strictEqual(resReabrirGanho.status, 200);
    assert.strictEqual(resReabrirGanho.body.data.id, dealGanhoId, 'O ID deve ser mantido');
    assert.strictEqual(resReabrirGanho.body.data.estagio, 'proposta', 'Deve retornar para proposta');
    assert.strictEqual(resReabrirGanho.body.data.data_fechamento_real, null, 'data_fechamento_real deve ser null');

    // Mede a meta de Juliana DEPOIS de reabrir
    const resMetaDepois = await makeRequest(app, 'GET', '/api/bi/crm/meta', authJuliana);
    assert.strictEqual(resMetaDepois.status, 200);
    const realizadoDepois = parseFloat(resMetaDepois.body.data?.realizado || 0);
    assert.strictEqual(
      realizadoAntes - realizadoDepois,
      25000.00,
      `A meta realizada deve deduzir exatamente R$ 25.000,00 (antes=${realizadoAntes}, depois=${realizadoDepois})`
    );
    console.log('   ✅ Reabertura de ganho validada e valor deduzido da meta com precisão.');

    // ------------------------------------------------------------------------
    // Cenário 13: Reabrir deal aberto retorna 409 DEAL_NAO_FECHADO
    // ------------------------------------------------------------------------
    console.log('1️⃣3️⃣ Cenário 13: Reabrir deal aberto retorna 409 DEAL_NAO_FECHADO');
    const resDealAbertoReabrir = await makeRequest(app, 'POST', '/api/bi/crm/deals', authJuliana, {
      titulo: 'Deal Aberto em Lead',
      cliente_nome: 'CLIENTE ABERTO',
      cliente_cnpj: '11.222.333/0001-81',
      estagio: 'lead'
    });
    assert.strictEqual(resDealAbertoReabrir.status, 201);
    const dealAbertoId = resDealAbertoReabrir.body.data.id;

    const res13 = await makeRequest(app, 'POST', `/api/bi/crm/deals/${dealAbertoId}/reabrir`, authJuliana);
    assert.strictEqual(res13.status, 409);
    assert.strictEqual(res13.body.error?.code, 'DEAL_NAO_FECHADO');
    console.log('   ✅ Bloqueio 409 DEAL_NAO_FECHADO confirmado para deal aberto.');

    // ------------------------------------------------------------------------
    // Cenário 14: Juliana reabre/clona deal da Andrea (404 nos dois)
    // ------------------------------------------------------------------------
    console.log('1️⃣4️⃣ Cenário 14: Juliana tentando reabrir ou clonar deal da Andrea retorna 404 DEAL_NOT_FOUND');
    const resDealAndrea = await makeRequest(app, 'POST', '/api/bi/crm/deals', authAndrea, {
      titulo: 'Deal Exclusivo da Andrea',
      cliente_nome: 'CLIENTE EXCLUSIVO ANDREA',
      cliente_cnpj: '11.222.333/0001-81',
      estagio: 'proposta'
    });
    assert.strictEqual(resDealAndrea.status, 201);
    const idAndrea = resDealAndrea.body.data.id;

    // Andrea marca como perdido
    await makeRequest(app, 'PATCH', `/api/bi/crm/deals/${idAndrea}/stage`, authAndrea, {
      novoEstagio: 'perdido',
      motivoPerdaCod: 'preco'
    });

    // Juliana tenta reabrir deal da Andrea
    const res14Reabrir = await makeRequest(app, 'POST', `/api/bi/crm/deals/${idAndrea}/reabrir`, authJuliana);
    assert.strictEqual(res14Reabrir.status, 404);
    assert.strictEqual(res14Reabrir.body.error?.code, 'DEAL_NOT_FOUND');

    // Juliana tenta clonar deal da Andrea
    const res14Clonar = await makeRequest(app, 'POST', `/api/bi/crm/deals/${idAndrea}/clonar`, authJuliana);
    assert.strictEqual(res14Clonar.status, 404);
    assert.strictEqual(res14Clonar.body.error?.code, 'DEAL_NOT_FOUND');
    console.log('   ✅ Bloqueio 404 DEAL_NOT_FOUND por escopo de vendedor confirmado.');

    // ------------------------------------------------------------------------
    // Cenário 15: Juliana reabre o próprio ganho (200)
    // ------------------------------------------------------------------------
    console.log('1️⃣5️⃣ Cenário 15: Juliana reabre o próprio negócio ganho livremente com 200');
    const resDealProprio = await makeRequest(app, 'POST', '/api/bi/crm/deals', authJuliana, {
      titulo: 'Deal Proprio Juliana Ganho',
      cliente_nome: 'CLIENTE PROPRIO JULIANA',
      cliente_cnpj: '11.222.333/0001-81',
      estagio: 'contato'
    });
    assert.strictEqual(resDealProprio.status, 201);
    const idProprio = resDealProprio.body.data.id;

    await makeRequest(app, 'PATCH', `/api/bi/crm/deals/${idProprio}/stage`, authJuliana, { novoEstagio: 'ganho' });

    const res15 = await makeRequest(app, 'POST', `/api/bi/crm/deals/${idProprio}/reabrir`, authJuliana);
    assert.strictEqual(res15.status, 200);
    assert.strictEqual(res15.body.data.id, idProprio);
    assert.strictEqual(res15.body.data.estagio, 'contato');
    console.log('   ✅ Vendedor reabriu o próprio ganho com sucesso.');

    // ------------------------------------------------------------------------
    // Cenário 16: Clonar deal ganho com itens e proposta (201, novo ID >= 29000, estágio lead, campos limpos)
    // ------------------------------------------------------------------------
    console.log('1️⃣6️⃣ Cenário 16: Clonar deal ganho com itens gera nova oportunidade (201, id>=29000, lead)');
    const resOriginal = await makeRequest(app, 'POST', '/api/bi/crm/deals', authJuliana, {
      titulo: 'Fornecimento Especial Cofres',
      cliente_cod: 'CLI001',
      cliente_loja: '02',
      cliente_nome: 'EMPRESA COFRES SA',
      cliente_cnpj: '11.222.333/0001-81',
      cliente_email: 'contato@cofressa.com.br',
      cliente_telefone: '11988887777',
      cliente_cidade: 'Campinas',
      cliente_uf: 'SP',
      cond_pgto: '30 DDL',
      tipo_frete: 'FOB',
      frete_cobrado: 350.00,
      frete_embutido: 100.00,
      transportadora: 'RODONAVES TRANSP',
      transportadora_cod: 'RODO',
      prazo_entrega: '15 dias',
      valor_total: 9350.00,
      itens_cotados: [
        { codigo: 'CF01', descricao: 'Cofre Boca de Lobo', quantidade: 2, precoNegociado: 4500.00, total: 9000.00 }
      ],
      contatos: [
        { nome: 'Marcos Gerente', telefone: '11988887777' }
      ],
      observacoes: 'Entregar na portaria dos fundos',
      custom: {
        faturadoPor: '15 - GSI',
        transportadora_cod: 'RODO',
        ultima_proposta: { numero: 'PROP-999', versao: 2 }
      },
      estagio: 'proposta'
    });
    assert.strictEqual(resOriginal.status, 201);
    const idOriginal = resOriginal.body.data.id;

    // Marca como ganho
    await makeRequest(app, 'PATCH', `/api/bi/crm/deals/${idOriginal}/stage`, authJuliana, { novoEstagio: 'ganho' });

    // Clona o deal
    const resClone = await makeRequest(app, 'POST', `/api/bi/crm/deals/${idOriginal}/clonar`, authJuliana);
    assert.strictEqual(resClone.status, 201, 'Clonar deve retornar 201');
    const clone = resClone.body.data;

    // Validações do clone
    assert(clone.id, 'Clone deve possuir ID');
    assert.notStrictEqual(clone.id, idOriginal, 'ID do clone deve ser diferente do original');
    assert(Number(clone.id) >= 29000, `ID do clone deve ser >= 29000, obtido: ${clone.id}`);
    assert.strictEqual(clone.estagio, 'lead', 'Clone deve nascer no estágio lead');
    assert.strictEqual(parseFloat(clone.valor_total), parseFloat(resOriginal.body.data.valor_total), 'Clone deve ter o mesmo valor_total do original');
    assert.strictEqual(parseFloat(clone.valor_total), 9350.00, 'valor_total do clone deve ser 9350.00');
    assert.strictEqual(clone.titulo, 'Fornecimento Especial Cofres (cópia)');
    assert.strictEqual(clone.cliente_cod, 'CLI001');
    assert.strictEqual(clone.cliente_loja, '02');
    assert.strictEqual(clone.cliente_nome, 'EMPRESA COFRES SA');
    assert.strictEqual(clone.cliente_cnpj, '11222333000181');
    assert.strictEqual(clone.cliente_email, 'contato@cofressa.com.br');
    assert.strictEqual(clone.cliente_telefone, '11988887777');
    assert.strictEqual(clone.cliente_cidade, 'Campinas');
    assert.strictEqual(clone.cliente_uf, 'SP');
    assert.strictEqual(clone.cond_pgto, '30 DDL');
    assert.strictEqual(clone.tipo_frete, 'FOB');
    assert.strictEqual(clone.frete_cobrado, 350.00);
    assert.strictEqual(clone.frete_embutido, 100.00);
    assert.strictEqual(clone.transportadora, 'RODONAVES TRANSP');
    assert.strictEqual(clone.transportadora_cod, 'RODO');
    assert.strictEqual(clone.prazo_entrega, '15 dias');
    assert.strictEqual(clone.itens_cotados.length, 1);
    assert.strictEqual(clone.itens_cotados[0].codigo, 'CF01');
    assert.strictEqual(clone.contatos.length, 1);
    assert.strictEqual(clone.contatos[0].nome, 'Marcos Gerente');
    assert.strictEqual(clone.observacoes, 'Entregar na portaria dos fundos');
    assert.strictEqual(clone.custom?.faturadoPor, '15 - GSI');
    assert.strictEqual(clone.custom?.transportadora_cod, 'RODO');
    assert.strictEqual(clone.custom?.clonado_de, idOriginal);

    // Campos que NÃO devem ser copiados
    assert.strictEqual(clone.custom?.ultima_proposta, undefined, 'custom.ultima_proposta NÃO deve ser copiado');
    assert(!clone.motivo_perda, 'motivo_perda NÃO deve ser copiado');
    assert.strictEqual(clone.motivo_perda_cod, null, 'motivo_perda_cod NÃO deve ser copiado');
    assert.strictEqual(clone.data_fechamento_real, null, 'data_fechamento_real NÃO deve ser copiado');
    assert(!clone.num_pedido_compra, 'num_pedido_compra NÃO deve ser copiado');
    assert(!clone.obs_nfe, 'obs_nfe NÃO deve ser copiado');
    assert.strictEqual(clone.historico_estagios.length, 1, 'Clone deve ter histórico limpo com apenas 1 registro');
    assert(
      clone.historico_estagios[0].justificativa?.includes(`Clonado da oportunidade #${idOriginal}`),
      'Justificativa do clone deve apontar deal de origem'
    );

    // Confere que original permanece inalterado
    const resOrigCheck = await makeRequest(app, 'GET', `/api/bi/crm/deals/${idOriginal}`, authJuliana);
    assert.strictEqual(resOrigCheck.body.data.estagio, 'ganho', 'Original deve continuar ganho');
    console.log('   ✅ Oportunidade clonada com sucesso mantendo dados comerciais e limpando transacionais.');

    // ------------------------------------------------------------------------
    // Cenário 17: Admin clona deal da Juliana (dono do clone = 000074)
    // ------------------------------------------------------------------------
    console.log('1️⃣7️⃣ Cenário 17: Admin clona deal da Juliana preservando o dono 000074');
    const resCloneAdmin = await makeRequest(app, 'POST', `/api/bi/crm/deals/${idOriginal}/clonar`, authAdmin);
    assert.strictEqual(resCloneAdmin.status, 201);
    assert.strictEqual(resCloneAdmin.body.data.cod_vendedor, '000074', 'Admin deve preservar o vendedor original');
    assert.strictEqual(resCloneAdmin.body.data.nome_vendedor, 'Juliana');
    console.log('   ✅ Clone realizado pelo Admin preservou o vendedor original 000074.');

    // ------------------------------------------------------------------------
    // Cenário 18 (completo): Fallback em cache local JSON (cenários 4, 7, 11 e 16 sem Postgres)
    // ------------------------------------------------------------------------
    console.log('1️⃣8️⃣ Cenário 18 (completo): Fallback em cache local JSON (db.isConfigured = () => false)');
    db.isConfigured = () => false;

    // 18.7: Criar lead avulso sem Postgres
    const res18Lead = await makeRequest(app, 'POST', '/api/bi/crm/deals', authJuliana, {
      titulo: 'Lead Avulso Fallback Cache',
      cliente_nome: '',
      contatos: [{ nome: 'Marina Santos', telefone: '11911223344' }]
    });
    assert.strictEqual(res18Lead.status, 201);
    assert.strictEqual(res18Lead.body.data.cliente_nome, '');
    assert.strictEqual(res18Lead.body.data.estagio, 'lead');
    const leadCacheId = res18Lead.body.data.id;

    // Confere gravação no arquivo JSON de cache
    const cacheJson1 = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    const dealNoCache1 = (cacheJson1.deals || []).find(d => String(d.id) === String(leadCacheId));
    assert(dealNoCache1, 'Deal avulso deve estar salvo no cache JSON');
    assert.strictEqual(dealNoCache1.cliente_nome, '');
    assert.strictEqual(dealNoCache1.contatos[0]?.telefone, '11911223344');

    // 18.4: PATCH stage -> perdido com motivoPerdaCod sem Postgres
    const res18Perda = await makeRequest(app, 'PATCH', `/api/bi/crm/deals/${leadCacheId}/stage`, authJuliana, {
      novoEstagio: 'perdido',
      motivoPerdaCod: 'preco',
      justificativa: 'Achou caro no fallback'
    });
    assert.strictEqual(res18Perda.status, 200);
    assert.strictEqual(res18Perda.body.data.estagio, 'perdido');
    assert.strictEqual(res18Perda.body.data.motivo_perda_cod, 'preco');
    assert.strictEqual(res18Perda.body.data.motivo_perda, 'Preço');

    // Confere gravação do motivo no cache JSON
    const cacheJson2 = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    const dealNoCache2 = (cacheJson2.deals || []).find(d => String(d.id) === String(leadCacheId));
    assert.strictEqual(dealNoCache2.motivo_perda_cod, 'preco');
    assert.strictEqual(dealNoCache2.motivo_perda, 'Preço');
    const ultHistCache = dealNoCache2.historico_estagios[dealNoCache2.historico_estagios.length - 1];
    assert(
      ultHistCache.justificativa?.includes('Perdido: Preço — Achou caro no fallback'),
      `Histórico no cache deve conter justificativa de perda, obtido: "${ultHistCache.justificativa}"`
    );

    // 18.11: Reabrir deal no fallback sem Postgres
    const res18Reabrir = await makeRequest(app, 'POST', `/api/bi/crm/deals/${leadCacheId}/reabrir`, authJuliana);
    assert.strictEqual(res18Reabrir.status, 200);
    assert.strictEqual(res18Reabrir.body.data.estagio, 'lead');
    assert.strictEqual(res18Reabrir.body.data.motivo_perda_cod, null);
    assert(!res18Reabrir.body.data.motivo_perda);

    // Confere reabertura no cache JSON
    const cacheJson3 = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    const dealNoCache3 = (cacheJson3.deals || []).find(d => String(d.id) === String(leadCacheId));
    assert.strictEqual(dealNoCache3.estagio, 'lead');
    assert.strictEqual(dealNoCache3.motivo_perda_cod, null);

    // 18.16: Clonar deal no fallback sem Postgres com itens no formato da tela (precoNegociado)
    await makeRequest(app, 'PUT', `/api/bi/crm/deals/${leadCacheId}`, authJuliana, {
      valor_total: 5000.00,
      itens_cotados: [{ codigo: 'A', quantidade: 2, precoNegociado: 2500, total: 5000 }]
    });

    const res18Clonar = await makeRequest(app, 'POST', `/api/bi/crm/deals/${leadCacheId}/clonar`, authJuliana);
    assert.strictEqual(res18Clonar.status, 201);
    assert.notStrictEqual(res18Clonar.body.data.id, leadCacheId);
    assert.strictEqual(res18Clonar.body.data.estagio, 'lead');
    assert.strictEqual(res18Clonar.body.data.custom?.clonado_de, leadCacheId);
    assert.strictEqual(parseFloat(res18Clonar.body.data.valor_total), 5000.00, 'Clone no fallback deve preservar valor_total do original');

    // Confere clone gravado no cache JSON
    const cacheJson4 = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    const dealCloneCache = (cacheJson4.deals || []).find(d => String(d.id) === String(res18Clonar.body.data.id));
    assert(dealCloneCache, 'Clone deve estar persistido no cache JSON');
    assert.strictEqual(dealCloneCache.custom?.clonado_de, leadCacheId);
    assert.strictEqual(parseFloat(dealCloneCache.valor_total), 5000.00, 'valor_total gravado no cache JSON deve ser 5000');

    console.log('   ✅ Fallback JSON completo validado (criar lead avulso, marcar perdido, reabrir e clonar).');

    console.log('\n============================================================');
    console.log('🎉 TODOS OS CENÁRIOS DA FATIA 2B (1 A 18) PASSARAM COM SUCESSO!');
    console.log('============================================================\n');
  } finally {
    db.isConfigured = originalIsConfigured;
    db.logUserActivity = originalLogUserActivity;
    db.getConfigMetasVendasDB = originalGetConfigMetas;
    if (originalCacheRaw) {
      try {
        fs.writeFileSync(cacheFile, originalCacheRaw, 'utf8');
      } catch (_) {}
    }
  }
}

if (require.main === module) {
  runTests().catch(err => {
    console.error('❌ Falha na suite de testes CRM-23 (Fatia 2a):', err);
    process.exit(1);
  });
}

module.exports = { runTests };
