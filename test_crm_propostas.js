/**
 * ============================================================================
 * SUÍTE DE TESTES AUTOMATIZADOS — CRM-20 (PROPOSTA EM PDF POR EMPRESA EMISSORA)
 * ============================================================================
 * Cobre os 21 cenários obrigatórios da Seção 8 da especificação
 * docs/telas/08_bi_executivo/crm20_proposta_pdf.md, na mesma numeração (1 a 21):
 * - Cenários puros (1 a 6, 11, 16 parcial, 17, 18, 19 parcial, 21) rodam sempre.
 * - Cenários de banco (7 a 10, 12 a 15, 16 com banco, 19 com banco, 20) rodam obrigatoriamente
 *   quando DATABASE_URL está definida (sem SKIP) e imprimem SKIP apenas quando DATABASE_URL
 *   não está definida (validando adicionalmente o 503 PROPOSTAS_INDISPONIVEIS).
 * - Nenhum teste envia e-mail real (stub de bloqueio ativo desde o início) nem chama o Protheus.
 * ============================================================================
 */

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-secret-crm20-propostas-suite';
}
if (!process.env.CRON_SECRET) {
  process.env.CRON_SECRET = 'test-cron-secret-crm20-suite';
}

const postgresDb = require('./postgres_db');
const crmEngine = require('./crm_engine');
const crmVendedores = require('./crm_vendedores');
const crmPropostas = require('./crm_propostas');
const crmRoutes = require('./crm_routes');

const CRM_CACHE_FILE = path.join(__dirname, 'data', 'crm_deals_cache.json');
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const crmCacheBackup = fs.existsSync(CRM_CACHE_FILE) ? fs.readFileSync(CRM_CACHE_FILE, 'utf8') : null;
const usersFileBackup = fs.existsSync(USERS_FILE) ? fs.readFileSync(USERS_FILE, 'utf8') : null;

// Trava de segurança global: impede qualquer disparo real de e-mail fora do Cenário 14
function installSafetyEmailBlockStub() {
  crmPropostas.setSendPropostaEmailStub(async () => {
    throw new Error('BLOQUEIO DE SEGURANÇA: sendPropostaEmail chamado fora do Cenário 14!');
  });
}
installSafetyEmailBlockStub();

const EMPRESA_14_MOCK = {
  codigo: '14',
  razao_social: 'METAL PLENO COMERCIO DE FECHADURAS E FERRAGENS LTDA',
  nome_fantasia: 'Metal Pleno',
  cnpj: '48758821000118',
  ie: '145707309111',
  endereco: 'Rua Maria José, 119 · Bela Vista · São Paulo/SP · 01324-010',
  telefone: '(11) 3141-9000',
  email_contato: null,
  site: null,
  logo_path: null,
  cor_primaria: '#0b3d91',
  cor_secundaria: '#f59e0b',
  texto_rodape: null,
  texto_email: null,
  dados_bancarios_pix: null,
  validade_padrao_dias: 7,
  blocos_opcionais: { mostrar_ncm: false, mostrar_peso: false },
  ativo: true
};

const EMPRESA_15_MOCK = {
  codigo: '15',
  razao_social: 'GSI BRASIL PRESTACAO DE SERVICOS LTDA',
  nome_fantasia: 'GSI Brasil',
  cnpj: '14061778000115',
  ie: 'ISENTO',
  endereco: 'Rua Maria José, 119 · Bela Vista · São Paulo/SP · 01324-010',
  telefone: '(11) 3141-9000',
  email_contato: null,
  site: null,
  logo_path: 'logos/logo-gsi.png',
  cor_primaria: '#0b3d91',
  cor_secundaria: '#f59e0b',
  texto_rodape: null,
  texto_email: null,
  dados_bancarios_pix: 'PIX CNPJ: 14.061.778/0001-15 (Banco Inter)',
  validade_padrao_dias: 7,
  blocos_opcionais: { mostrar_ncm: false, mostrar_peso: false },
  ativo: true
};

const EMPRESA_16_MOCK = {
  codigo: '16',
  razao_social: 'OACO INDUSTRIA E COMERCIO DE COFRES LTDA',
  nome_fantasia: 'OAÇO / Cofres Gold Safe',
  cnpj: '61237790000118',
  ie: '535132321110',
  endereco: 'Rua Maria José, 119 · Bela Vista · São Paulo/SP · 01324-010',
  telefone: '(11) 3141-9000',
  email_contato: null,
  site: null,
  logo_path: 'logos/logo-oaco.png',
  cor_primaria: '#0b3d91',
  cor_secundaria: '#f59e0b',
  texto_rodape: null,
  texto_email: null,
  dados_bancarios_pix: null,
  validade_padrao_dias: 7,
  blocos_opcionais: { mostrar_ncm: false, mostrar_peso: false },
  ativo: true
};

const VENDEDOR_MOCK = {
  codigo: '000074',
  cod_vendedor: '000074',
  nome: 'Juliana',
  email: 'juliana.teste@gsicofres.com.br',
  telefone_whatsapp: '(11) 98888-7777',
  assinatura: 'Atenciosamente, Juliana · Equipe Comercial GSI'
};

function makeDealFixture(overrides = {}) {
  return {
    id: '29501',
    titulo: 'Aquisição de Cofres Inteligentes',
    cliente_nome: 'SUPERMERCADO CENTRAL LTDA',
    cliente_cnpj: '12345678000195',
    cliente_email: 'compras@supercentral.com.br',
    cliente_telefone_fmt: '(11) 4002-8922',
    cliente_cidade: 'São Paulo',
    cliente_uf: 'SP',
    estagio: 'proposta',
    status: 'aberto',
    faturado_por: '15 - GSI',
    cod_vendedor: '000074',
    nome_vendedor: 'Juliana',
    cond_pgto: '28/56/84 DDL',
    prazo_entrega: '10 dias úteis',
    tipo_frete: 'CIF',
    transportadora: 'Rodonaves',
    frete_cobrado: 150.0,
    frete_embutido: 320.0,
    desconto: 800.0,
    valor_total: 4350.0,
    obs_nfe: 'OBS FISCAL INTERNA NAO PODE SAIR NO PDF',
    observacoes: 'ANOTACAO INTERNA SECRETA DE MARGEM MINIMA 18%',
    num_pedido_compra: 'PC-SECRETO-999',
    custom: {
      contatoNome: 'Carlos Comprador',
      faturadoPor: '15 - GSI'
    },
    itens_cotados: [
      {
        codigo: 'COF-001',
        descricao: 'Cofre Boca de Lobo Digital 50cm',
        quantidade: 2,
        unidade: 'UN',
        precoTabela: 2500.0,
        descontoPercent: 16,
        precoNegociado: 2100.0,
        ncm: '83030000',
        peso_kg: 45.5
      }
    ],
    ...overrides
  };
}

function makeJwtToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
}

function requireCronAuthTest(req, res, next) {
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  const providedHeader = (req.headers['x-cron-secret'] || '').trim();
  const authHeader = (req.headers.authorization || '').trim();
  const bearerSecret = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const candidate = providedHeader || bearerSecret;

  if (!cronSecret || !candidate) {
    return res.status(401).json({ error: 'Não autorizado para disparar job agendado.' });
  }
  const bufA = Buffer.from(cronSecret, 'utf8');
  const bufB = Buffer.from(candidate, 'utf8');
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
    return res.status(401).json({ error: 'Credencial de cron inválida.' });
  }
  return next();
}

function createTestServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Usa exatamente os handlers reais exportados por crm_propostas.js (compartilhados com server.js)
  app.get('/p/:token', crmPropostas.handleLinkPublico);
  app.post('/api/cron/crm-propostas-vencendo', requireCronAuthTest, crmPropostas.handleCronVencendo);
  app.use('/api/bi/crm', crmRoutes);

  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}`
      });
    });
    server.on('error', reject);
  });
}

function httpRequest(baseUrl, method, urlPath, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl);
    const payload = body !== null ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const reqHeaders = { ...headers };
    if (payload !== null && !reqHeaders['Content-Type']) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: reqHeaders
      },
      (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const rawBuffer = Buffer.concat(chunks);
          const text = rawBuffer.toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {}
          resolve({
            status: res.statusCode,
            headers: res.headers,
            buffer: rawBuffer,
            text,
            json
          });
        });
      }
    );
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

(async () => {
  let passed = 0;
  let skipped = 0;
  let testServer = null;
  const createdDealIds = [];
  let savedVendedor000074 = null;
  let savedUserJuliana = null;
  let savedEmpresa15 = null;

  async function runScenario(num, title, fn, { requiresDb = false, hasDatabase = false } = {}) {
    if (requiresDb && !hasDatabase) {
      console.log(`⏭️  [SKIP sem banco] Cenário ${num}: ${title}`);
      skipped++;
      return;
    }
    await fn();
    console.log(`✅ [PASS] Cenário ${num}: ${title}`);
    passed++;
  }

  try {
    console.log('🚀 Iniciando suíte de testes CRM-20 (Propostas em PDF por Empresa Emissora)...');

    const dbUrlConfigured = Boolean((process.env.DATABASE_URL || '').trim());
    let hasDatabase = false;

    if (dbUrlConfigured) {
      const okInitPg = await postgresDb.initPostgres();
      assert.strictEqual(okInitPg, true, 'initPostgres() falhou com DATABASE_URL definida');
      const ping = await postgresDb.safeQuery('SELECT 1 AS ok;');
      assert.ok(ping && Array.isArray(ping.rows) && ping.rows.length === 1, 'Falha ao conectar ao PostgreSQL com DATABASE_URL definida');
      await crmEngine.initCrmTables();
      const okPropostas = await crmPropostas.ensureCrmPropostasTables();
      assert.strictEqual(okPropostas, true, 'ensureCrmPropostasTables() falhou ao criar tabelas no PostgreSQL');
      hasDatabase = true;

      // Guarda estado original do vendedor 000074, usuário juliana e empresa 15 para restaurar no finally
      const vRes = await postgresDb.safeQuery(`SELECT * FROM crm_vendedores WHERE cod_vendedor = '000074';`);
      savedVendedor000074 = vRes?.rows?.[0] || null;

      const uRes = await postgresDb.safeQuery(`SELECT username, email FROM users WHERE LOWER(username) = 'juliana';`);
      savedUserJuliana = uRes?.rows?.[0] || null;

      savedEmpresa15 = await crmPropostas.obterEmpresa('15');
    }

    testServer = await createTestServer();
    const { baseUrl } = testServer;

    const adminToken = makeJwtToken({
      id: 1,
      username: 'alexandre',
      name: 'Alexandre',
      role: 'admin',
      permissions: ['all']
    });

    // =========================================================================
    // CENÁRIO 1: resolverCodigoEmpresa
    // =========================================================================
    await runScenario(1, "resolverCodigoEmpresa ('14 - Metal Pleno' -> '14', '15 - GSI' -> '15', '16 - OACO'/'16 - O AÇO' -> '16', '' -> '', '99' -> '')", async () => {
      assert.strictEqual(crmPropostas.resolverCodigoEmpresa('14 - Metal Pleno'), '14');
      assert.strictEqual(crmPropostas.resolverCodigoEmpresa('15 - GSI'), '15');
      assert.strictEqual(crmPropostas.resolverCodigoEmpresa('16 - OACO'), '16');
      assert.strictEqual(crmPropostas.resolverCodigoEmpresa('16 - O AÇO'), '16');
      assert.strictEqual(crmPropostas.resolverCodigoEmpresa(''), '');
      assert.strictEqual(crmPropostas.resolverCodigoEmpresa('99'), '');
    });

    // =========================================================================
    // CENÁRIO 2: montarSnapshot remove precoTabela, descontoPercent, desconto, frete_embutido, obs_nfe, observacoes
    // =========================================================================
    await runScenario(2, 'montarSnapshot remove precoTabela, descontoPercent, desconto, frete_embutido, obs_nfe, observacoes e não contém valor de precoTabela', async () => {
      const deal = makeDealFixture({
        itens_cotados: [
          {
            codigo: 'COF-900',
            descricao: 'Cofre Forte Alta Segurança',
            quantidade: 2,
            unidade: 'UN',
            precoTabela: 5999.77,
            descontoPercent: 30,
            precoNegociado: 4200.0,
            ncm: '83030000',
            peso_kg: 120
          }
        ]
      });
      const snapshot = crmPropostas.montarSnapshot(deal, EMPRESA_15_MOCK, VENDEDOR_MOCK, {
        observacoesCliente: 'Entregar em horário comercial.'
      });
      const serialized = JSON.stringify(snapshot);

      const forbiddenKeys = [
        'precoTabela',
        'descontoPercent',
        'desconto',
        'frete_embutido',
        'obs_nfe',
        'observacoes',
        'num_pedido_compra',
        'cargo',
        'garantia_padrao',
        'texto_apresentacao',
        'texto_condicoes',
        'prazo_entrega_padrao',
        'mostrar_assinatura_cliente',
        'mostrar_dados_bancarios'
      ];
      for (const key of forbiddenKeys) {
        assert.strictEqual(serialized.includes(`"${key}"`), false, `Chave proibida encontrada no snapshot: ${key}`);
      }
      assert.strictEqual(serialized.includes('5999.77'), false, 'Valor de precoTabela vazou no snapshot');
      assert.strictEqual(serialized.includes('OBS FISCAL INTERNA'), false, 'obs_nfe vazou no snapshot');
      assert.strictEqual(serialized.includes('ANOTACAO INTERNA SECRETA'), false, 'observacoes internas vazaram no snapshot');
      assert.strictEqual(snapshot.itens[0].preco_unitario, 4200.0);
      assert.strictEqual(snapshot.observacoes_cliente, 'Entregar em horário comercial.');
    });

    // =========================================================================
    // CENÁRIO 3: montarSnapshot calcula total a partir de quantidade * preco_unitario + frete_cobrado
    // =========================================================================
    await runScenario(3, 'montarSnapshot calcula total a partir de quantidade * preco_unitario + frete_cobrado mesmo se deal.valor_total estiver desatualizado', async () => {
      const deal = makeDealFixture({
        valor_total: 999999.99,
        frete_cobrado: 250.5,
        itens_cotados: [
          { codigo: 'A1', descricao: 'Item A', quantidade: 3, unidade: 'UN', precoNegociado: 100.0 },
          { codigo: 'B2', descricao: 'Item B', quantidade: 2, unidade: 'UN', precoNegociado: 50.25 }
        ]
      });
      const snapshot = crmPropostas.montarSnapshot(deal, EMPRESA_15_MOCK, VENDEDOR_MOCK);
      assert.strictEqual(snapshot.subtotal, 400.5);
      assert.strictEqual(snapshot.frete_cobrado, 250.5);
      assert.strictEqual(snapshot.total, 651.0);
    });

    // =========================================================================
    // CENÁRIO 4: montarSnapshot falha quando faltam empresa, CNPJ do cliente, itens ou preço <= 0
    // =========================================================================
    await runScenario(4, 'montarSnapshot falha com EMPRESA_EMITENTE_INVALIDA, CLIENTE_INCOMPLETO e ITENS_INVALIDOS', async () => {
      assert.throws(
        () => crmPropostas.montarSnapshot(makeDealFixture({ faturado_por: '' }), null, VENDEDOR_MOCK),
        (err) => err.status === 400 && err.code === 'EMPRESA_EMITENTE_INVALIDA'
      );

      assert.throws(
        () => crmPropostas.montarSnapshot(makeDealFixture({ cliente_cnpj: '' }), EMPRESA_15_MOCK, VENDEDOR_MOCK),
        (err) => err.status === 400 && err.code === 'CLIENTE_INCOMPLETO'
      );

      assert.throws(
        () => crmPropostas.montarSnapshot(makeDealFixture({ itens_cotados: [] }), EMPRESA_15_MOCK, VENDEDOR_MOCK),
        (err) => err.status === 400 && err.code === 'ITENS_INVALIDOS'
      );

      assert.throws(
        () => crmPropostas.montarSnapshot(
          makeDealFixture({
            itens_cotados: [{ codigo: 'X1', descricao: 'Item Zero', quantidade: 1, precoNegociado: 0 }]
          }),
          EMPRESA_15_MOCK,
          VENDEDOR_MOCK
        ),
        (err) => err.status === 400 && err.code === 'ITENS_INVALIDOS' && Array.isArray(err.itensInvalidos) && err.itensInvalidos.length === 1
      );
    });

    // =========================================================================
    // CENÁRIO 5: montarSnapshot falha com 409 DEAL_PERDIDO para deal com estagio = 'perdido'
    // =========================================================================
    await runScenario(5, "montarSnapshot falha com 409 DEAL_PERDIDO para deal com estagio = 'perdido'", async () => {
      assert.throws(
        () => crmPropostas.montarSnapshot(makeDealFixture({ estagio: 'perdido' }), EMPRESA_15_MOCK, VENDEDOR_MOCK),
        (err) => err.status === 409 && err.code === 'DEAL_PERDIDO'
      );
    });

    // =========================================================================
    // CENÁRIO 6: gerarPdf devolve Buffer %PDF-1. ... %%EOF (> 1000 bytes) com logo (15/16) e sem logo (14)
    // =========================================================================
    await runScenario(6, 'gerarPdf devolve Buffer %PDF-1. ... %%EOF (> 1000 bytes) com logo existente (15/16) e sem logo (14)', async () => {
      for (const emp of [EMPRESA_14_MOCK, EMPRESA_15_MOCK, EMPRESA_16_MOCK]) {
        const snap = crmPropostas.montarSnapshot(
          makeDealFixture({ faturado_por: emp.codigo }),
          emp,
          VENDEDOR_MOCK,
          { numero: '29501-R1', revisao: 1 }
        );
        const docDef = crmPropostas.montarDocDefinition(snap, { previa: emp.codigo === '14' });
        const pdfBuf = await crmPropostas.gerarPdf(docDef);

        assert.ok(Buffer.isBuffer(pdfBuf), `Retorno para empresa ${emp.codigo} deve ser Buffer`);
        assert.ok(pdfBuf.length > 1000, `PDF da empresa ${emp.codigo} deve ter > 1000 bytes (teve ${pdfBuf.length})`);
        assert.ok(pdfBuf.subarray(0, 7).toString('ascii').startsWith('%PDF-1.'), `PDF da empresa ${emp.codigo} deve começar com %PDF-1.`);
        assert.ok(pdfBuf.subarray(pdfBuf.length - 32).toString('ascii').includes('%%EOF'), `PDF da empresa ${emp.codigo} deve terminar com %%EOF`);
      }
    });

    // Se DATABASE_URL não estiver definida, testa também o 503 PROPOSTAS_INDISPONIVEIS
    if (!hasDatabase) {
      await assert.rejects(
        () => crmPropostas.listarEmpresas(),
        (err) => err.status === 503 && err.code === 'PROPOSTAS_INDISPONIVEIS'
      );
      console.log('ℹ️  [503 OK] Retorno 503 PROPOSTAS_INDISPONIVEIS validado sem banco.');
    }

    // Helper para criar deal de teste no banco (usando apenas estágios e vendedores válidos)
    async function criarDealTesteNoBanco(overrides = {}) {
      const base = makeDealFixture(overrides);
      delete base.id;
      const criado = await crmEngine.criarDeal(
        base,
        { username: 'alexandre', name: 'Alexandre', role: 'admin' },
        { all: true }
      );
      createdDealIds.push(String(criado.id));
      return criado;
    }

    // =========================================================================
    // CENÁRIO 7: gerarRevisao cria R1, depois R2, mantendo R1 intacta (mesmo pdf_sha256 e valor_total)
    // =========================================================================
    await runScenario(7, 'gerarRevisao cria R1, depois R2, mantendo R1 intacta (mesmo pdf_sha256 e valor_total antes e depois de editar o deal)', async () => {
      const deal = await criarDealTesteNoBanco({
        estagio: 'proposta',
        faturado_por: '15 - GSI',
        frete_cobrado: 100,
        itens_cotados: [
          { codigo: 'COF-10', descricao: 'Cofre Standard', quantidade: 1, unidade: 'UN', precoNegociado: 2000 }
        ]
      });

      const r1 = await crmPropostas.gerarRevisao(
        deal.id,
        { validadeDias: 7, observacoesCliente: 'Revisão 1' },
        { username: 'alexandre', role: 'admin' },
        { all: true }
      );
      assert.strictEqual(r1.revisao, 1);
      assert.strictEqual(r1.numero, `${deal.id}-R1`);
      assert.strictEqual(r1.valor_total, 2100);

      // Edita o deal (altera preço e frete) e gera R2
      await crmEngine.atualizarDeal(
        deal.id,
        {
          frete_cobrado: 200,
          itens_cotados: [
            { codigo: 'COF-10', descricao: 'Cofre Standard', quantidade: 2, unidade: 'UN', precoNegociado: 2500 }
          ]
        },
        { username: 'alexandre', role: 'admin' },
        { all: true }
      );

      const r2 = await crmPropostas.gerarRevisao(
        deal.id,
        { validadeDias: 10, observacoesCliente: 'Revisão 2' },
        { username: 'alexandre', role: 'admin' },
        { all: true }
      );
      assert.strictEqual(r2.revisao, 2);
      assert.strictEqual(r2.numero, `${deal.id}-R2`);
      assert.strictEqual(r2.valor_total, 5200);
      assert.notStrictEqual(r2.pdf_sha256, r1.pdf_sha256);

      // Confere que R1 permaneceu imutável no banco
      const lista = await crmPropostas.listarPropostas(deal.id, { all: true });
      const r1Lista = lista.find(p => p.revisao === 1);
      assert.ok(r1Lista, 'R1 deve continuar existindo na listagem');
      assert.strictEqual(r1Lista.valor_total, 2100);
      assert.strictEqual(r1Lista.pdf_sha256, r1.pdf_sha256);

      const pdfR1 = await crmPropostas.obterPdf(deal.id, 1, { all: true });
      const shaCalculado = crypto.createHash('sha256').update(pdfR1.pdfBuffer).digest('hex');
      assert.strictEqual(shaCalculado, r1.pdf_sha256, 'Binário de R1 deve manter exatamente o mesmo SHA-256');
    }, { requiresDb: true, hasDatabase });

    // =========================================================================
    // CENÁRIO 8: gerarRevisao avança deal de lead ou contato para proposta, mas não mexe se em negociacao ou ganho
    // =========================================================================
    await runScenario(8, "gerarRevisao avança deal de 'lead' ou 'contato' para 'proposta', mas não altera se em 'negociacao' ou 'ganho'", async () => {
      const dealLead = await criarDealTesteNoBanco({ estagio: 'lead', faturado_por: '14 - Metal Pleno' });
      await crmPropostas.gerarRevisao(dealLead.id, {}, { username: 'alexandre', role: 'admin' }, { all: true });
      const dealLeadDepois = await crmEngine.obterDealPorId(dealLead.id, { all: true });
      assert.strictEqual(dealLeadDepois.estagio, 'proposta', "Deal em 'lead' deve avançar para 'proposta'");

      const dealNeg = await criarDealTesteNoBanco({ estagio: 'negociacao', faturado_por: '16 - OACO' });
      await crmPropostas.gerarRevisao(dealNeg.id, {}, { username: 'alexandre', role: 'admin' }, { all: true });
      const dealNegDepois = await crmEngine.obterDealPorId(dealNeg.id, { all: true });
      assert.strictEqual(dealNegDepois.estagio, 'negociacao', "Deal em 'negociacao' não deve regredir para 'proposta'");
    }, { requiresDb: true, hasDatabase });

    // =========================================================================
    // CENÁRIO 9: Duas chamadas simultâneas (Promise.all) a gerarRevisao no mesmo deal produzem R1 e R2 sem erro 500
    // =========================================================================
    await runScenario(9, 'Duas chamadas simultâneas (Promise.all) a gerarRevisao no mesmo deal produzem R1 e R2 sem erro 500', async () => {
      const dealConc = await criarDealTesteNoBanco({ estagio: 'contato', faturado_por: '15 - GSI' });
      const [resA, resB] = await Promise.all([
        crmPropostas.gerarRevisao(dealConc.id, { validadeDias: 7 }, { username: 'alexandre', role: 'admin' }, { all: true }),
        crmPropostas.gerarRevisao(dealConc.id, { validadeDias: 14 }, { username: 'alexandre', role: 'admin' }, { all: true })
      ]);
      const revisoes = [resA.revisao, resB.revisao].sort((a, b) => a - b);
      assert.deepStrictEqual(revisoes, [1, 2], 'Chamadas concorrentes devem gerar exatamente R1 e R2');
    }, { requiresDb: true, hasDatabase });

    // =========================================================================
    // CENÁRIO 10: listarPropostas não devolve a coluna pdf (não vem binário na listagem)
    // =========================================================================
    await runScenario(10, 'listarPropostas não devolve a coluna pdf (sem binário na listagem)', async () => {
      const dealId = createdDealIds[0];
      const items = await crmPropostas.listarPropostas(dealId, { all: true });
      assert.ok(items.length >= 1, 'Deve retornar revisões geradas');
      for (const item of items) {
        assert.strictEqual(item.pdf, undefined, 'Coluna BYTEA pdf não pode vir em listarPropostas');
        assert.strictEqual(item.pdfBuffer, undefined, 'pdfBuffer não pode vir em listarPropostas');
        assert.ok(item.pdf_tamanho_bytes > 1000, 'pdf_tamanho_bytes deve vir preenchido');
      }
    }, { requiresDb: true, hasDatabase });

    // =========================================================================
    // CENÁRIO 11: Escopo por proprietário (CRM-19): vendedor tentando acessar deal de outro vendedor recebe 404
    // =========================================================================
    await runScenario(11, 'Escopo por proprietário (CRM-19): vendedor tentando gerar, listar, baixar ou enviar proposta de deal de outro vendedor recebe 404', async () => {
      const scopeJuliana = {
        all: false,
        codVendedor: '000074',
        codigosLeitura: ['000074'],
        username: 'juliana',
        role: 'vendedor'
      };
      const dealDeFigueiredo = { id: '29888', cod_vendedor: '000004', estagio: 'proposta' };
      assert.strictEqual(crmEngine.dealVisivel(dealDeFigueiredo, scopeJuliana), false);
      assert.strictEqual(crmEngine.dealEditavel(dealDeFigueiredo, scopeJuliana), false);

      if (hasDatabase) {
        const dealReal04 = await criarDealTesteNoBanco({
          cod_vendedor: '000004', // Figueiredo
          nome_vendedor: 'Figueiredo',
          faturado_por: '15 - GSI'
        });
        await crmPropostas.gerarRevisao(dealReal04.id, {}, { username: 'alexandre', role: 'admin' }, { all: true });

        await assert.rejects(
          () => crmPropostas.previaProposta(dealReal04.id, {}, scopeJuliana),
          (err) => err.status === 404 && err.code === 'DEAL_NOT_FOUND'
        );
        await assert.rejects(
          () => crmPropostas.gerarRevisao(dealReal04.id, {}, { username: 'juliana', role: 'vendedor' }, scopeJuliana),
          (err) => err.status === 404 && err.code === 'DEAL_NOT_FOUND'
        );
        await assert.rejects(
          () => crmPropostas.listarPropostas(dealReal04.id, scopeJuliana),
          (err) => err.status === 404 && err.code === 'DEAL_NOT_FOUND'
        );
        await assert.rejects(
          () => crmPropostas.obterPdf(dealReal04.id, 1, scopeJuliana),
          (err) => err.status === 404 && err.code === 'DEAL_NOT_FOUND'
        );
        await assert.rejects(
          () => crmPropostas.enviarPorEmail(dealReal04.id, 1, { para: 'cli@teste.com' }, { username: 'juliana', role: 'vendedor' }, scopeJuliana),
          (err) => err.status === 404 && err.code === 'DEAL_NOT_FOUND'
        );
      }
    });

    // =========================================================================
    // CENÁRIO 12: Vendedor com herança de leitura ['000074', '000064'] lista e baixa proposta de 000064, mas recebe 404 ao gerar ou enviar
    // =========================================================================
    await runScenario(12, "Vendedor com herança de leitura (['000074', '000064']) consegue listar e baixar proposta de deal do '000064', mas recebe 404 ao gerar revisão ou enviar e-mail", async () => {
      const deal64 = await criarDealTesteNoBanco({
        cod_vendedor: '000064', // Andrea
        nome_vendedor: 'Andrea',
        faturado_por: '15 - GSI'
      });
      await crmPropostas.gerarRevisao(deal64.id, {}, { username: 'alexandre', role: 'admin' }, { all: true });

      const scopeComHeranca = {
        all: false,
        codVendedor: '000074',
        codigosLeitura: ['000074', '000064'],
        username: 'juliana',
        role: 'vendedor'
      };

      const lista = await crmPropostas.listarPropostas(deal64.id, scopeComHeranca);
      assert.strictEqual(lista.length, 1, 'Deve conseguir listar proposta de histórico herdado');

      const pdf = await crmPropostas.obterPdf(deal64.id, 1, scopeComHeranca);
      assert.ok(Buffer.isBuffer(pdf.pdfBuffer) && pdf.pdfBuffer.length > 1000, 'Deve conseguir baixar PDF de histórico herdado');

      await assert.rejects(
        () => crmPropostas.gerarRevisao(deal64.id, {}, { username: 'juliana', role: 'vendedor' }, scopeComHeranca),
        (err) => err.status === 404 && err.code === 'DEAL_NOT_FOUND'
      );
      await assert.rejects(
        () => crmPropostas.enviarPorEmail(deal64.id, 1, { para: 'cli@teste.com' }, { username: 'juliana', role: 'vendedor' }, scopeComHeranca),
        (err) => err.status === 404 && err.code === 'DEAL_NOT_FOUND'
      );
    }, { requiresDb: true, hasDatabase });

    // =========================================================================
    // CENÁRIO 13: enviarPorEmail bloqueia proposta vencida (409 PROPOSTA_VENCIDA) e vendedor sem e-mail (409 VENDEDOR_SEM_EMAIL)
    // =========================================================================
    await runScenario(13, 'enviarPorEmail bloqueia proposta vencida (409 PROPOSTA_VENCIDA) e vendedor sem e-mail (409 VENDEDOR_SEM_EMAIL)', async () => {
      // Zera temporariamente o e-mail da Juliana tanto em crm_vendedores quanto em users (e users.json)
      await postgresDb.safeQuery(`UPDATE crm_vendedores SET email = NULL WHERE cod_vendedor = '000074';`);
      await postgresDb.safeQuery(`UPDATE users SET email = NULL WHERE LOWER(username) = 'juliana';`);
      if (fs.existsSync(USERS_FILE)) {
        try {
          const arr = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
          if (Array.isArray(arr)) {
            arr.forEach(u => {
              if (String(u.username || '').toLowerCase() === 'juliana') u.email = null;
            });
            fs.writeFileSync(USERS_FILE, JSON.stringify(arr, null, 2), 'utf8');
          }
        } catch {}
      }
      crmVendedores.invalidarCacheVendedores();

      const dealSemEmail = await criarDealTesteNoBanco({
        cod_vendedor: '000074',
        nome_vendedor: 'Juliana',
        faturado_por: '15 - GSI'
      });
      await crmPropostas.gerarRevisao(dealSemEmail.id, { validadeDias: 7 }, { username: 'alexandre', role: 'admin' }, { all: true });

      // 13a. Vendedor sem e-mail -> 409 VENDEDOR_SEM_EMAIL (sem chamar stub de envio!)
      await assert.rejects(
        () => crmPropostas.enviarPorEmail(
          dealSemEmail.id,
          1,
          { para: 'cliente@empresa.com.br' },
          { username: 'juliana', role: 'vendedor' },
          { all: true }
        ),
        (err) => err.status === 409 && err.code === 'VENDEDOR_SEM_EMAIL'
      );

      // 13b. Proposta vencida -> 409 PROPOSTA_VENCIDA
      await postgresDb.safeQuery(
        `UPDATE crm_propostas SET validade_ate = CURRENT_DATE - INTERVAL '2 days' WHERE deal_id = $1 AND revisao = 1;`,
        [String(dealSemEmail.id)]
      );
      await assert.rejects(
        () => crmPropostas.enviarPorEmail(
          dealSemEmail.id,
          1,
          { para: 'cliente@empresa.com.br' },
          { username: 'juliana', role: 'vendedor' },
          { all: true }
        ),
        (err) => err.status === 409 && err.code === 'PROPOSTA_VENCIDA'
      );
    }, { requiresDb: true, hasDatabase });

    // =========================================================================
    // CENÁRIO 14: enviarPorEmail com stub do mailer (Reply-To, fromName sem forçar from, CC vendedor, anexo PDF sha256 e atividade proposta_enviada)
    // =========================================================================
    await runScenario(14, 'enviarPorEmail com stub do mailer verifica Reply-To, fromName (sem passar from), cópia CC ao vendedor, anexo PDF e atividade proposta_enviada', async () => {
      await postgresDb.safeQuery(
        `UPDATE crm_vendedores
         SET email = 'juliana@gsicofres.com.br',
             telefone_whatsapp = '(11) 98888-7777',
             assinatura = 'Juliana · Comercial GSI'
         WHERE cod_vendedor = '000074';`
      );
      crmVendedores.invalidarCacheVendedores();

      const dealEmail = await criarDealTesteNoBanco({
        cod_vendedor: '000074',
        nome_vendedor: 'Juliana',
        faturado_por: '15 - GSI',
        cliente_email: 'comprador@cliente.com.br'
      });

      const rev = await crmPropostas.gerarRevisao(dealEmail.id, { validadeDias: 7 }, { username: 'juliana', role: 'vendedor' }, { all: true });

      let capturedMailArgs = null;
      try {
        crmPropostas.setSendPropostaEmailStub(async (mailArgs) => {
          capturedMailArgs = mailArgs;
          return { success: true, mode: 'stub', messageId: 'stub-msg-14' };
        });

        const sendRes = await crmPropostas.enviarPorEmail(
          dealEmail.id,
          1,
          {
            para: 'comprador@cliente.com.br',
            cc: 'financeiro@cliente.com.br'
          },
          { username: 'juliana', role: 'vendedor' },
          { all: true }
        );

        assert.strictEqual(sendRes.success, true);
        assert.ok(capturedMailArgs, 'Stub do mailer deve ter sido chamado');
        assert.strictEqual(capturedMailArgs.replyTo, 'juliana@gsicofres.com.br', 'Reply-To deve ser o e-mail do vendedor');
        assert.strictEqual(capturedMailArgs.from, undefined, 'enviarPorEmail não deve passar from (mailer.sendPropostaEmail resolve o remetente)');
        assert.ok(capturedMailArgs.fromName.includes('Juliana') && capturedMailArgs.fromName.includes('GSI Brasil'), 'fromName deve conter <Vendedor> e <Empresa>');
        assert.ok(Array.isArray(capturedMailArgs.cc) && capturedMailArgs.cc.includes('juliana@gsicofres.com.br'), 'Vendedor deve receber cópia em CC');
        assert.ok(capturedMailArgs.cc.includes('financeiro@cliente.com.br'), 'CC informado também deve estar presente');

        const attachedBuffer = Buffer.from(capturedMailArgs.attachment.contentBase64, 'base64');
        const attachedSha256 = crypto.createHash('sha256').update(attachedBuffer).digest('hex');
        assert.strictEqual(attachedSha256, rev.pdf_sha256, 'Anexo PDF enviado por e-mail deve ter exatamente o mesmo pdf_sha256 salvo');

        const ativRes = await postgresDb.safeQuery(
          `SELECT * FROM crm_atividades WHERE deal_id = $1 AND tipo = 'proposta_enviada';`,
          [String(dealEmail.id)]
        );
        assert.strictEqual(ativRes.rows.length, 1, 'Deve criar atividade proposta_enviada concluída');
        assert.strictEqual(ativRes.rows[0].status, 'concluida');
      } finally {
        installSafetyEmailBlockStub();
      }
    }, { requiresDb: true, hasDatabase });

    // =========================================================================
    // CENÁRIO 15: registrarAbertura com User-Agent de navegador real 3 min após envio + deduplicação por IP
    // =========================================================================
    await runScenario(15, 'registrarAbertura com UA de navegador 3 min após envio incrementa aberturas 0 -> 1, cria 1 atividade proposta_visualizada e deduplica no mesmo minuto', async () => {
      const dealOpen = await criarDealTesteNoBanco({
        cod_vendedor: '000074',
        nome_vendedor: 'Juliana',
        faturado_por: '15 - GSI'
      });
      const rev = await crmPropostas.gerarRevisao(dealOpen.id, { validadeDias: 7 }, { username: 'juliana', role: 'vendedor' }, { all: true });

      // Simula enviada_em há 3 minutos no banco (sem esperar)
      await postgresDb.safeQuery(
        `UPDATE crm_propostas SET enviada_em = NOW() - INTERVAL '3 minutes' WHERE deal_id = $1 AND revisao = 1;`,
        [String(dealOpen.id)]
      );

      const browserUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
      const resp1 = await httpRequest(baseUrl, 'GET', `/p/${rev.token_publico}`, {
        headers: {
          'User-Agent': browserUa,
          'X-Forwarded-For': '177.55.66.77'
        }
      });
      assert.strictEqual(resp1.status, 200);
      assert.strictEqual(resp1.headers['cache-control'], 'no-store');
      assert.ok(resp1.buffer.subarray(0, 7).toString('ascii').startsWith('%PDF-1.'));

      // Segunda abertura no mesmo minuto pelo mesmo IP não incrementa
      const resp2 = await httpRequest(baseUrl, 'GET', `/p/${rev.token_publico}`, {
        headers: {
          'User-Agent': browserUa,
          'X-Forwarded-For': '177.55.66.77'
        }
      });
      assert.strictEqual(resp2.status, 200);

      const lista = await crmPropostas.listarPropostas(dealOpen.id, { all: true });
      assert.strictEqual(lista[0].aberturas, 1, 'Contador de aberturas deve ser 1 após deduplicação');
      assert.ok(lista[0].visualizada_em, 'visualizada_em deve estar preenchido');

      const ativRes = await postgresDb.safeQuery(
        `SELECT * FROM crm_atividades WHERE deal_id = $1 AND tipo = 'proposta_visualizada';`,
        [String(dealOpen.id)]
      );
      assert.strictEqual(ativRes.rows.length, 1, 'Deve criar exatamente 1 atividade proposta_visualizada');
    }, { requiresDb: true, hasDatabase });

    // =========================================================================
    // CENÁRIO 16: registrarAbertura com UA WhatsApp/2.23 ou SafeLinks ou < 2 min após enviada_em não incrementa
    // =========================================================================
    await runScenario(16, 'registrarAbertura com UA WhatsApp/2.23 ou SafeLinks ou em menos de 2 min após enviada_em devolve PDF mas não incrementa aberturas nem cria atividade', async () => {
      assert.strictEqual(crmPropostas.BOT_UA_REGEX.test('WhatsApp/2.23.10.75 A'), true);
      assert.strictEqual(crmPropostas.BOT_UA_REGEX.test('Mozilla/5.0 SafeLinks-Scanner/1.0'), true);

      if (hasDatabase) {
        const dealBot = await criarDealTesteNoBanco({
          cod_vendedor: '000074',
          nome_vendedor: 'Juliana',
          faturado_por: '15 - GSI'
        });
        const rev = await crmPropostas.gerarRevisao(dealBot.id, { validadeDias: 7 }, { username: 'juliana', role: 'vendedor' }, { all: true });

        // 16a. Com enviada_em há 3 min, mas User-Agent de WhatsApp e SafeLinks
        await postgresDb.safeQuery(
          `UPDATE crm_propostas SET enviada_em = NOW() - INTERVAL '3 minutes' WHERE deal_id = $1 AND revisao = 1;`,
          [String(dealBot.id)]
        );

        const rWa = await httpRequest(baseUrl, 'GET', `/p/${rev.token_publico}`, {
          headers: { 'User-Agent': 'WhatsApp/2.23.10.75 A', 'X-Forwarded-For': '189.10.20.30' }
        });
        assert.strictEqual(rWa.status, 200);
        assert.ok(rWa.buffer.subarray(0, 7).toString('ascii').startsWith('%PDF-1.'));

        const rSl = await httpRequest(baseUrl, 'GET', `/p/${rev.token_publico}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MS Office SafeLinks)', 'X-Forwarded-For': '189.10.20.31' }
        });
        assert.strictEqual(rSl.status, 200);

        // 16b. Com enviada_em há 30 segundos (< 2 minutos), mesmo com User-Agent de navegador real
        await postgresDb.safeQuery(
          `UPDATE crm_propostas SET enviada_em = NOW() - INTERVAL '30 seconds' WHERE deal_id = $1 AND revisao = 1;`,
          [String(dealBot.id)]
        );
        const rRecent = await httpRequest(baseUrl, 'GET', `/p/${rev.token_publico}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
            'X-Forwarded-For': '189.10.20.32'
          }
        });
        assert.strictEqual(rRecent.status, 200);

        const lista = await crmPropostas.listarPropostas(dealBot.id, { all: true });
        assert.strictEqual(lista[0].aberturas, 0, 'Nenhuma abertura de robô ou < 2min após envio deve ser contabilizada');

        const ativRes = await postgresDb.safeQuery(
          `SELECT * FROM crm_atividades WHERE deal_id = $1 AND tipo = 'proposta_visualizada';`,
          [String(dealBot.id)]
        );
        assert.strictEqual(ativRes.rows.length, 0, 'Nenhuma atividade proposta_visualizada deve ser criada');
      }
    });

    // =========================================================================
    // CENÁRIO 17: GET /p/:token com token inválido ('abc') ou inexistente (43 chars) devolve 404 com o mesmo HTML
    // =========================================================================
    await runScenario(17, 'GET /p/:token com token inválido (abc) ou inexistente (43 chars base64url) devolve 404 com a mesma página HTML simples', async () => {
      const tokenInexistente43 = 'A'.repeat(43);
      assert.strictEqual(crmPropostas.TOKEN_PUBLICO_REGEX.test('abc'), false);
      assert.strictEqual(crmPropostas.TOKEN_PUBLICO_REGEX.test(tokenInexistente43), true);

      const resInvalido = await httpRequest(baseUrl, 'GET', '/p/abc');
      const resInexistente = await httpRequest(baseUrl, 'GET', `/p/${tokenInexistente43}`);

      assert.strictEqual(resInvalido.status, 404);
      assert.strictEqual(resInexistente.status, 404);
      assert.strictEqual(resInvalido.text, resInexistente.text, 'Página 404 de token inválido e token inexistente deve ser idêntica');
      assert.ok(resInvalido.text.includes('Proposta não encontrada'));
    });

    // =========================================================================
    // CENÁRIO 18: PUT /api/bi/crm/empresas-emitentes/15 chamado por vendedor devolve 403
    // =========================================================================
    await runScenario(18, 'PUT /api/bi/crm/empresas-emitentes/15 chamado por vendedor devolve 403', async () => {
      const vendedorToken = makeJwtToken({
        id: 74,
        username: 'juliana',
        name: 'Juliana',
        role: 'vendedor',
        permissions: ['crm']
      });

      const res = await httpRequest(baseUrl, 'PUT', '/api/bi/crm/empresas-emitentes/15', {
        headers: { Authorization: `Bearer ${vendedorToken}` },
        body: { nome_fantasia: 'Tentativa Vendedor' }
      });
      assert.strictEqual(res.status, 403);
    });

    // =========================================================================
    // CENÁRIO 19: PUT /api/bi/crm/empresas-emitentes/15 com cor_primaria = 'red', logo_path = '../../etc/passwd' ou dados obrigatórios vazios devolve 400
    // =========================================================================
    await runScenario(19, "PUT /api/bi/crm/empresas-emitentes/15 com cor_primaria = 'red', logo_path = '../../etc/passwd' ou razao_social/nome_fantasia/cnpj vazios devolve 400", async () => {
      assert.strictEqual(crmPropostas.HEX_COLOR_REGEX.test('red'), false);
      assert.strictEqual(crmPropostas.validarLogoPathRelativo('../../etc/passwd').valid, false);

      if (hasDatabase) {
        const resCor = await httpRequest(baseUrl, 'PUT', '/api/bi/crm/empresas-emitentes/15', {
          headers: { Authorization: `Bearer ${adminToken}` },
          body: { cor_primaria: 'red' }
        });
        assert.strictEqual(resCor.status, 400);
        const corErrCode = resCor.json?.error?.code || resCor.json?.code;
        assert.strictEqual(corErrCode, 'COR_INVALIDA');

        const resLogo = await httpRequest(baseUrl, 'PUT', '/api/bi/crm/empresas-emitentes/15', {
          headers: { Authorization: `Bearer ${adminToken}` },
          body: { logo_path: '../../etc/passwd' }
        });
        assert.strictEqual(resLogo.status, 400);
        const logoErrCode = resLogo.json?.error?.code || resLogo.json?.code;
        assert.strictEqual(logoErrCode, 'LOGO_PATH_INVALIDO');

        for (const campoVazio of [{ razao_social: '' }, { nome_fantasia: '   ' }, { cnpj: '' }]) {
          const resVazio = await httpRequest(baseUrl, 'PUT', '/api/bi/crm/empresas-emitentes/15', {
            headers: { Authorization: `Bearer ${adminToken}` },
            body: campoVazio
          });
          assert.strictEqual(resVazio.status, 400);
          const vazioCode = resVazio.json?.error?.code || resVazio.json?.code;
          assert.strictEqual(vazioCode, 'DADOS_EMPRESA_INCOMPLETOS');
        }
      }
    });

    // =========================================================================
    // CENÁRIO 20: gerarLembretesValidade cria atividade proposta_vencendo apenas para a revisão mais nova de deals abertos que vencem em 2 dias (idempotente)
    // =========================================================================
    await runScenario(20, 'gerarLembretesValidade cria atividade proposta_vencendo apenas para a revisão mais nova de deals abertos que vencem em 2 dias e não duplica na 2ª execução', async () => {
      const hojeRef = '2026-11-13';
      const venceEm2Dias = '2026-11-15';

      // Deal aberto com R1 e R2 vencendo em 2026-11-15 -> deve criar apenas para R2
      const dealAberto = await criarDealTesteNoBanco({
        estagio: 'proposta',
        cod_vendedor: '000074',
        nome_vendedor: 'Juliana',
        faturado_por: '15 - GSI'
      });
      await crmPropostas.gerarRevisao(dealAberto.id, { dataEmissao: hojeRef, validadeDias: 2 }, { username: 'juliana', role: 'vendedor' }, { all: true });
      await crmPropostas.gerarRevisao(dealAberto.id, { dataEmissao: hojeRef, validadeDias: 2 }, { username: 'juliana', role: 'vendedor' }, { all: true });

      // Deal ganho com R1 vencendo em 2026-11-15 -> NÃO deve criar lembrete
      const dealGanho = await criarDealTesteNoBanco({
        estagio: 'ganho',
        cod_vendedor: '000074',
        nome_vendedor: 'Juliana',
        faturado_por: '15 - GSI'
      });
      await crmPropostas.gerarRevisao(dealGanho.id, { dataEmissao: hojeRef, validadeDias: 2 }, { username: 'juliana', role: 'vendedor' }, { all: true });

      const exec1 = await crmPropostas.gerarLembretesValidade(hojeRef);
      assert.ok(exec1.criadas >= 1, 'Primeira execução deve criar ao menos 1 lembrete');

      const ativAberto = await postgresDb.safeQuery(
        `SELECT * FROM crm_atividades WHERE deal_id = $1 AND tipo = 'proposta_vencendo';`,
        [String(dealAberto.id)]
      );
      assert.strictEqual(ativAberto.rows.length, 1, 'Deve criar lembrete apenas para a revisão mais nova (R2) do deal aberto');
      assert.strictEqual(ativAberto.rows[0].custom?.proposta_numero, `${dealAberto.id}-R2`);
      assert.strictEqual(ativAberto.rows[0].custom?.validade_ate, venceEm2Dias);
      assert.strictEqual(ativAberto.rows[0].status, 'pendente');

      const ativGanho = await postgresDb.safeQuery(
        `SELECT * FROM crm_atividades WHERE deal_id = $1 AND tipo = 'proposta_vencendo';`,
        [String(dealGanho.id)]
      );
      assert.strictEqual(ativGanho.rows.length, 0, 'Não deve criar lembrete para deal ganho');

      // Segunda execução no mesmo dia -> idempotente (criadas === 0 para esses deals)
      const exec2 = await crmPropostas.gerarLembretesValidade(hojeRef);
      assert.strictEqual(exec2.criadas, 0, 'Segunda execução no mesmo dia não pode duplicar lembretes');
    }, { requiresDb: true, hasDatabase });

    // =========================================================================
    // CENÁRIO 21: POST /api/cron/crm-propostas-vencendo sem x-cron-secret devolve 401 + verificação estática do server.js
    // =========================================================================
    await runScenario(21, 'POST /api/cron/crm-propostas-vencendo sem x-cron-secret devolve 401 e server.js registra handlers oficiais com requireCronAuth e propostaPublicaLimiter', async () => {
      const resSemHeader = await httpRequest(baseUrl, 'POST', '/api/cron/crm-propostas-vencendo');
      assert.strictEqual(resSemHeader.status, 401);

      const resErrado = await httpRequest(baseUrl, 'POST', '/api/cron/crm-propostas-vencendo', {
        headers: { 'x-cron-secret': 'segredo-incorreto' }
      });
      assert.strictEqual(resErrado.status, 401);

      const serverSrc = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
      assert.ok(
        serverSrc.includes("app.get('/p/:token', propostaPublicaLimiter, crmPropostas.handleLinkPublico)"),
        'server.js deve registrar GET /p/:token com propostaPublicaLimiter e crmPropostas.handleLinkPublico'
      );
      assert.ok(
        serverSrc.includes("app.post('/api/cron/crm-propostas-vencendo', requireCronAuth, crmPropostas.handleCronVencendo)"),
        'server.js deve registrar POST /api/cron/crm-propostas-vencendo com requireCronAuth e crmPropostas.handleCronVencendo'
      );
    });

    console.log(`\n🎉 Suíte CRM-20 concluída com sucesso: ${passed} cenários aprovados, ${skipped} ignorados (sem banco).`);
  } catch (err) {
    console.error('\n❌ FALHA NA SUÍTE DE TESTES CRM-20:', err);
    process.exitCode = 1;
  } finally {
    crmPropostas.limparCachesEmMemoriaParaTestes();

    if (testServer && testServer.server) {
      await new Promise(resolve => testServer.server.close(resolve));
    }

    // Limpeza dos dados criados no Postgres e restauração de crm_vendedores, users e crm_empresas_emitentes
    if (postgresDb.isPostgresConnected() && postgresDb.getPool()) {
      try {
        for (const dealId of createdDealIds) {
          await postgresDb.safeQuery('DELETE FROM crm_atividades WHERE deal_id = $1;', [String(dealId)]);
          await postgresDb.safeQuery('DELETE FROM crm_propostas WHERE deal_id = $1;', [String(dealId)]);
          await postgresDb.safeQuery('DELETE FROM crm_deals WHERE id = $1;', [String(dealId)]);
        }
        if (savedVendedor000074) {
          await postgresDb.safeQuery(
            `UPDATE crm_vendedores
             SET email = $2, telefone_whatsapp = $3, assinatura = $4
             WHERE cod_vendedor = $1;`,
            [
              savedVendedor000074.cod_vendedor,
              savedVendedor000074.email,
              savedVendedor000074.telefone_whatsapp,
              savedVendedor000074.assinatura
            ]
          );
        }
        if (savedUserJuliana) {
          await postgresDb.safeQuery(
            `UPDATE users SET email = $2 WHERE LOWER(username) = LOWER($1);`,
            [savedUserJuliana.username, savedUserJuliana.email]
          );
        }
        if (savedEmpresa15) {
          await crmPropostas.salvarEmpresa('15', savedEmpresa15, { username: 'sistema' });
        }
        await postgresDb.safeQuery(
          `DELETE FROM user_activities
           WHERE action_type IN ('CRM_PROPOSTA_GERADA', 'CRM_PROPOSTA_ENVIADA', 'CRM_PROPOSTA_BAIXADA', 'CRM_PROPOSTA_ABERTA', 'CRM_EMPRESA_EDITADA', 'CRM_DEAL_ACESSO_NEGADO')
             AND created_at > NOW() - INTERVAL '10 minutes';`
        );
      } catch (cleanErr) {
        console.warn('⚠️ Aviso na limpeza de dados de teste no Postgres:', cleanErr.message);
      }
      try {
        await postgresDb.getPool().end();
      } catch {}
    }

    // Restaura data/crm_deals_cache.json e data/users.json se tiverem sido tocados
    try {
      if (crmCacheBackup !== null) {
        const currentContent = fs.existsSync(CRM_CACHE_FILE) ? fs.readFileSync(CRM_CACHE_FILE, 'utf8') : '';
        if (currentContent !== crmCacheBackup) {
          fs.writeFileSync(CRM_CACHE_FILE, crmCacheBackup, 'utf8');
        }
      }
    } catch {}
    try {
      if (usersFileBackup !== null) {
        const currentUsers = fs.existsSync(USERS_FILE) ? fs.readFileSync(USERS_FILE, 'utf8') : '';
        if (currentUsers !== usersFileBackup) {
          fs.writeFileSync(USERS_FILE, usersFileBackup, 'utf8');
        }
      }
    } catch {}
  }
})();
