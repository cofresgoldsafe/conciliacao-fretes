/**
 * crm_integracao_whatsapp.js
 * 
 * API Servidor-a-Servidor (sem JWT) para Integração com o Painel WhatsApp Multi360.
 * Autenticação via CRM_INTEGRACAO_SECRET (Bearer Token com crypto.timingSafeEqual)
 * e contexto de usuário operacional via cabeçalho X-Portal-User.
 */

'use strict';

const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { getPool, safeQuery, getUsers } = require('./postgres_db');
const crmEngine = require('./crm_engine');
const { resolverAcessoCrm } = require('./crm_routes');
const { normalizarTelefoneBR, variantesTelefoneBR } = require('./telefone_br');

/**
 * Envelope de Erro Padronizado RFC 7807 / RFC 9457
 */
function sendRfcError(res, { status = 500, title = 'Erro interno do servidor', detail = '', code = 'INTERNAL_ERROR', extra = {} }) {
  let safeDetail = detail || title;
  if (status === 500 && process.env.NODE_ENV === 'production') {
    safeDetail = 'Ocorreu um erro interno ao processar a operação. Tente novamente.';
  }
  return res.status(status).json({
    success: false,
    message: safeDetail,
    ...extra,
    error: {
      type: `https://portal.gsicofres.com.br/errors/${code.toLowerCase().replace(/_/g, '-')}`,
      title,
      status,
      detail: safeDetail,
      code,
      ...extra
    }
  });
}

function criarRouterIntegracaoWhatsapp({ userHasWhatsappAccess } = {}) {
  const router = express.Router();

  // Limitador de taxa: 120 req/min no router
  const integracaoLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => sendRfcError(res, {
      status: 429,
      title: 'Muitas Requisições',
      detail: 'Limite de requisições excedido para a integração do WhatsApp. Aguarde um minuto.',
      code: 'RATE_LIMIT_EXCEEDED'
    })
  });

  router.use(integracaoLimiter);

  /**
   * Middleware de autenticação servidor-a-servidor e resolução de escopo
   */
  async function requireIntegracaoWhatsapp(req, res, next) {
    try {
      // 1. process.env.CRM_INTEGRACAO_SECRET vazio -> 503 INTEGRACAO_DESATIVADA
      const integracaoSecret = process.env.CRM_INTEGRACAO_SECRET
        ? String(process.env.CRM_INTEGRACAO_SECRET).trim()
        : '';
      if (!integracaoSecret) {
        return sendRfcError(res, {
          status: 503,
          title: 'Integração Desativada',
          detail: 'A integração com o WhatsApp não está configurada no servidor (CRM_INTEGRACAO_SECRET ausente).',
          code: 'INTEGRACAO_DESATIVADA'
        });
      }

      // 2. Authorization: Bearer <segredo> comparado em tempo constante
      const authHeader = req.headers['authorization'];
      let providedToken = null;
      if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
        providedToken = authHeader.slice(7).trim();
      }

      let segredoValido = false;
      if (providedToken) {
        const bufProvided = Buffer.from(providedToken);
        const bufExpected = Buffer.from(integracaoSecret);
        if (bufProvided.length === bufExpected.length && crypto.timingSafeEqual(bufProvided, bufExpected)) {
          segredoValido = true;
        }
      }

      if (!segredoValido) {
        crmEngine.recordTelemetry(
          { username: 'sistema', name: 'Integração WhatsApp', role: 'sistema', ip: req.ip },
          'CRM_INTEGRACAO_NEGADA',
          'Tentativa de acesso à API de integração WhatsApp rejeitada por credencial inválida ou ausente.',
          { ip: req.ip, path: req.originalUrl || req.path }
        ).catch(() => {});

        return sendRfcError(res, {
          status: 401,
          title: 'Integração Não Autorizada',
          detail: 'Credencial de integração ausente ou inválida.',
          code: 'INTEGRACAO_NAO_AUTORIZADA'
        });
      }

      // 3. Cabeçalho X-Portal-User: buscar em getUsers() de postgres_db
      const portalUserHeader = req.headers['x-portal-user'];
      const cleanUsername = String(portalUserHeader || '').trim().toLowerCase();
      if (!cleanUsername) {
        return sendRfcError(res, {
          status: 403,
          title: 'Acesso Proibido',
          detail: 'Cabeçalho X-Portal-User ausente ou vazio.',
          code: 'USUARIO_SEM_ACESSO'
        });
      }

      const allUsers = await getUsers();
      const user = Array.isArray(allUsers)
        ? allUsers.find(u => String(u.username || '').trim().toLowerCase() === cleanUsername)
        : null;

      if (!user || (typeof userHasWhatsappAccess === 'function' && !userHasWhatsappAccess(user))) {
        return sendRfcError(res, {
          status: 403,
          title: 'Acesso Proibido',
          detail: `O usuário "${cleanUsername}" não existe ou não possui acesso ao WhatsApp.`,
          code: 'USUARIO_SEM_ACESSO'
        });
      }

      // 4. Resolver acesso e escopo CRM a partir do usuário
      try {
        const { crmUser, crmScope } = await resolverAcessoCrm(user);
        req.crmUser = crmUser;
        req.crmScope = crmScope;
      } catch (err) {
        return sendRfcError(res, {
          status: err.status || 500,
          title: err.title || 'Erro ao validar acesso ao CRM',
          detail: err.detail || err.message,
          code: err.code || 'CRM_AUTH_ERROR'
        });
      }

      // 5. getPool() de postgres_db nulo -> 503 INTEGRACAO_INDISPONIVEL
      if (!getPool()) {
        return sendRfcError(res, {
          status: 503,
          title: 'Integração Indisponível',
          detail: 'Banco de dados PostgreSQL indisponível no momento.',
          code: 'INTEGRACAO_INDISPONIVEL'
        });
      }

      return next();
    } catch (err) {
      return sendRfcError(res, {
        status: 500,
        title: 'Erro no middleware de integração',
        detail: err.message,
        code: 'INTEGRACAO_MIDDLEWARE_ERROR'
      });
    }
  }

  router.use(requireIntegracaoWhatsapp);

  /**
   * GET /api/integracoes/whatsapp/crm/contexto?telefone=
   * Busca federada de contexto comercial a partir do número de WhatsApp
   */
  router.get('/contexto', async (req, res) => {
    try {
      const telRaw = req.query.telefone;
      const telefoneE164 = normalizarTelefoneBR(telRaw);
      if (!telefoneE164) {
        return sendRfcError(res, {
          status: 400,
          title: 'Telefone Inválido',
          detail: 'O parâmetro "telefone" não é um número válido.',
          code: 'TELEFONE_INVALIDO'
        });
      }

      const baseVars = variantesTelefoneBR(telefoneE164);
      const variantesSet = new Set(baseVars);
      for (const v of baseVars) {
        if (v.startsWith('55')) {
          variantesSet.add(v.slice(2));
        }
      }
      const variantes = Array.from(variantesSet);

      // 1. Carrega todos os deals visíveis no escopo (abertos e fechados)
      const dealsListResult = await crmEngine.listarDeals({}, req.crmScope);
      const todosDeals = Array.isArray(dealsListResult?.deals) ? dealsListResult.deals : [];
      const idsDealsVisiveis = new Set(todosDeals.map(d => String(d.id)));

      // 2. Vínculos de conversas do WhatsApp ativos (filtrados pelo escopo sem chamar obterDealPorId)
      const variantesE164 = baseVars.filter(v => v.startsWith('55'));
      const vinculosRes = await safeQuery(
        'SELECT deal_id, conversa_id, principal FROM crm_deal_conversas WHERE ativo = TRUE AND telefone_e164 = ANY($1) ORDER BY principal DESC, vinculado_em DESC;',
        [variantesE164]
      );
      const vinculosRaw = vinculosRes && vinculosRes.rows ? vinculosRes.rows : [];
      const vinculos = [];
      for (const v of vinculosRaw) {
        if (idsDealsVisiveis.has(String(v.deal_id))) {
          vinculos.push({
            deal_id: String(v.deal_id),
            conversa_id: String(v.conversa_id),
            principal: Boolean(v.principal)
          });
        }
      }

      // 3. crm_clientes (celular_whatsapp, telefone, contato_financeiro_tel)
      const clientesRes = await safeQuery(`
        SELECT id, protheus_cod, protheus_loja, nome_razao, cnpj_cpf, updated_at
        FROM crm_clientes
        WHERE deleted_at IS NULL
          AND (
            regexp_replace(COALESCE(celular_whatsapp, ''), '\\D', '', 'g') = ANY($1)
            OR regexp_replace(COALESCE(telefone, ''), '\\D', '', 'g') = ANY($1)
            OR regexp_replace(COALESCE(contato_financeiro_tel, ''), '\\D', '', 'g') = ANY($1)
          )
        ORDER BY updated_at DESC;
      `, [variantes]);

      const clientesRows = clientesRes && clientesRes.rows ? clientesRes.rows : [];
      let cliente = null;
      const clientesAlternativos = [];
      if (clientesRows.length > 0) {
        const primeiro = clientesRows[0];
        const cnpjLimpo = String(primeiro.cnpj_cpf || '').replace(/\D/g, '');
        const fidelidade = await crmEngine.obterFidelidadeRaiz(cnpjLimpo);
        cliente = {
          id: String(primeiro.id),
          cliente_cod: primeiro.protheus_cod || null,
          cliente_loja: primeiro.protheus_loja || null,
          nome: primeiro.nome_razao || '',
          cnpj: primeiro.cnpj_cpf || '',
          fidelidade: fidelidade || null
        };

        for (let i = 1; i < clientesRows.length; i++) {
          const alt = clientesRows[i];
          clientesAlternativos.push({
            id: String(alt.id),
            nome: alt.nome_razao || '',
            cnpj: alt.cnpj_cpf || ''
          });
        }
      }

      // 4. Deals abertos do escopo (filtrados a partir de todosDeals)
      const cnpjClienteAlvo = cliente && cliente.cnpj ? String(cliente.cnpj).replace(/\D/g, '') : null;
      const dealsAbertos = [];

      for (const d of todosDeals) {
        const estagio = String(d.estagio || '').toLowerCase();
        if (estagio === 'ganho' || estagio === 'perdido') continue;

        const cnpjDeal = String(d.cliente_cnpj || d.clienteCnpj || '').replace(/\D/g, '');
        const bateCnpj = Boolean(cnpjClienteAlvo && cnpjDeal && cnpjClienteAlvo === cnpjDeal);

        const telDeal = String(d.cliente_telefone || d.clienteTelefone || '').replace(/\D/g, '');
        let bateTelefone = Boolean(telDeal && variantes.includes(telDeal));

        if (!bateTelefone && Array.isArray(d.contatos)) {
          for (const c of d.contatos) {
            const t = String(c.telefone || c.celular || '').replace(/\D/g, '');
            if (t && variantes.includes(t)) {
              bateTelefone = true;
              break;
            }
          }
        }

        if (bateCnpj || bateTelefone) {
          dealsAbertos.push({
            id: String(d.id),
            titulo: d.titulo || '',
            estagio: d.estagio || '',
            valor_total: parseFloat(d.valor_total) || 0
          });
        }
      }

      return res.json({
        success: true,
        data: {
          telefone_e164: telefoneE164,
          cliente,
          clientes_alternativos: clientesAlternativos,
          deals_abertos: dealsAbertos,
          vinculos
        }
      });
    } catch (err) {
      return sendRfcError(res, {
        status: err.status || 500,
        title: 'Erro ao buscar contexto no CRM',
        detail: err.message,
        code: err.code || 'CONTEXTO_CRM_ERROR'
      });
    }
  });

  /**
   * POST /api/integracoes/whatsapp/crm/deals
   * Criação rápida de negócio a partir de uma conversa do WhatsApp (idempotente por origem_ref)
   */
  router.post('/deals', async (req, res) => {
    try {
      const {
        telefone,
        conversa_id,
        nome_contato,
        cliente_cod,
        cliente_loja,
        linha_whatsapp,
        origem_ref
      } = req.body || {};

      const conversaId = String(conversa_id || '').trim();
      const nomeContato = String(nome_contato || '').trim();
      const origemRef = String(origem_ref || '').trim();

      if (!origemRef || !conversaId || !nomeContato) {
        return sendRfcError(res, {
          status: 400,
          title: 'Dados Incompletos',
          detail: 'Os campos "origem_ref", "conversa_id" e "nome_contato" são obrigatórios.',
          code: 'DADOS_INCOMPLETOS'
        });
      }

      const e164 = normalizarTelefoneBR(telefone);
      if (!e164) {
        return sendRfcError(res, {
          status: 400,
          title: 'Telefone Inválido',
          detail: 'O parâmetro "telefone" não é um número válido.',
          code: 'TELEFONE_INVALIDO'
        });
      }

      // Verificação de idempotência prévia por origem_ref
      const dealExistenteRes = await safeQuery('SELECT id FROM crm_deals WHERE origem_ref = $1 LIMIT 1;', [origemRef]);
      if (dealExistenteRes && dealExistenteRes.rows && dealExistenteRes.rows.length > 0) {
        const dealIdExistente = String(dealExistenteRes.rows[0].id);

        await safeQuery(`
          INSERT INTO crm_deal_conversas (deal_id, conversa_id, telefone_e164, linha_whatsapp, principal, vinculado_por)
          VALUES ($1, $2, $3, $4, TRUE, $5)
          ON CONFLICT (deal_id, conversa_id) DO NOTHING;
        `, [dealIdExistente, conversaId, e164, linha_whatsapp || null, req.crmUser.username]);

        const deal = await crmEngine.obterDealPorId(dealIdExistente, req.crmScope);
        if (!deal) {
          return sendRfcError(res, {
            status: 404,
            title: 'Negócio Não Encontrado',
            detail: `O negócio #${dealIdExistente} não existe ou não é visível no escopo atual.`,
            code: 'DEAL_NOT_FOUND'
          });
        }

        return res.status(200).json({
          success: true,
          data: {
            deal,
            link: `/crm#deal=${deal.id}`,
            criado: false
          }
        });
      }

      // Formata dd/mm no fuso America/Sao_Paulo
      const partesData = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit',
        month: '2-digit'
      }).format(new Date());
      const titulo = `${nomeContato} — ${partesData}`;

      const dados = {
        titulo,
        estagio: 'lead',
        origem: 'whatsapp',
        origem_ref: origemRef,
        contatos: [{ nome: nomeContato, telefone: e164 }],
        cliente_telefone: e164
      };

      if (cliente_cod && String(cliente_cod).trim()) {
        const codLimpo = String(cliente_cod).trim();
        const lojaLimpa = cliente_loja ? String(cliente_loja).trim() : null;
        const cliRes = await safeQuery(`
          SELECT protheus_cod, protheus_loja, nome_razao, cnpj_cpf
          FROM crm_clientes
          WHERE protheus_cod = $1
            AND ($2::varchar IS NULL OR protheus_loja = $2)
            AND deleted_at IS NULL
          LIMIT 1;
        `, [codLimpo, lojaLimpa]);

        if (cliRes && cliRes.rows && cliRes.rows.length > 0) {
          const cli = cliRes.rows[0];
          dados.cliente_cod = cli.protheus_cod;
          dados.cliente_loja = cli.protheus_loja || '01';
          dados.cliente_nome = cli.nome_razao;
          dados.cliente_cnpj = cli.cnpj_cpf;
        }
      }

      let dealCriado = null;
      let criado = true;

      try {
        dealCriado = await crmEngine.criarDeal(dados, req.crmUser, req.crmScope);
      } catch (err) {
        if (err.code === 'ORIGEM_REF_DUPLICADA') {
          const corridaRes = await safeQuery('SELECT id FROM crm_deals WHERE origem_ref = $1 LIMIT 1;', [origemRef]);
          if (corridaRes && corridaRes.rows && corridaRes.rows.length > 0) {
            const dealIdCorrida = String(corridaRes.rows[0].id);

            await safeQuery(`
              INSERT INTO crm_deal_conversas (deal_id, conversa_id, telefone_e164, linha_whatsapp, principal, vinculado_por)
              VALUES ($1, $2, $3, $4, TRUE, $5)
              ON CONFLICT (deal_id, conversa_id) DO NOTHING;
            `, [dealIdCorrida, conversaId, e164, linha_whatsapp || null, req.crmUser.username]);

            dealCriado = await crmEngine.obterDealPorId(dealIdCorrida, req.crmScope);
            if (!dealCriado) {
              return sendRfcError(res, {
                status: 404,
                title: 'Negócio Não Encontrado',
                detail: `O negócio #${dealIdCorrida} não existe ou não é visível no escopo atual.`,
                code: 'DEAL_NOT_FOUND'
              });
            }
            criado = false;
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }

      if (criado) {
        await safeQuery(`
          INSERT INTO crm_deal_conversas (deal_id, conversa_id, telefone_e164, linha_whatsapp, principal, vinculado_por)
          VALUES ($1, $2, $3, $4, TRUE, $5)
          ON CONFLICT (deal_id, conversa_id) DO NOTHING;
        `, [dealCriado.id, conversaId, e164, linha_whatsapp || null, req.crmUser.username]);

        crmEngine.recordTelemetry(
          req.crmUser,
          'CRM_WHATSAPP_DEAL_CRIADO',
          `Negócio #${dealCriado.id} criado via integração WhatsApp a partir da conversa ${conversaId}`,
          {
            deal_id: dealCriado.id,
            cod_vendedor: dealCriado.cod_vendedor,
            role: req.crmUser.role,
            username: req.crmUser.username
          }
        ).catch(() => {});

        return res.status(201).json({
          success: true,
          data: {
            deal: dealCriado,
            link: `/crm#deal=${dealCriado.id}`,
            criado: true
          }
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          deal: dealCriado,
          link: `/crm#deal=${dealCriado.id}`,
          criado: false
        }
      });
    } catch (err) {
      return sendRfcError(res, {
        status: err.status || 500,
        title: 'Erro ao criar negócio via WhatsApp',
        detail: err.message,
        code: err.code || 'CRIAR_DEAL_WHATSAPP_ERROR'
      });
    }
  });

  /**
   * POST /api/integracoes/whatsapp/crm/deals/:id/conversas
   * Vincula ou atualiza conversa do WhatsApp ao negócio
   */
  router.post('/deals/:id/conversas', async (req, res) => {
    try {
      const { id } = req.params;
      const cleanDealId = String(id || '').trim();

      const deal = await crmEngine.obterDealPorId(cleanDealId, req.crmScope);
      if (!deal || !crmEngine.dealEditavel(deal, req.crmScope)) {
        return sendRfcError(res, {
          status: 404,
          title: 'Negócio Não Encontrado',
          detail: `Negócio #${cleanDealId} não encontrado ou sem permissão de edição.`,
          code: 'DEAL_NOT_FOUND'
        });
      }

      const conversaId = String(req.body?.conversa_id || '').trim();
      const telRaw = req.body?.telefone;
      const e164 = normalizarTelefoneBR(telRaw);

      if (!conversaId || !e164) {
        return sendRfcError(res, {
          status: 400,
          title: 'Dados Incompletos',
          detail: 'Informe conversa_id e um telefone válido.',
          code: 'DADOS_INCOMPLETOS'
        });
      }

      const linhaWhatsapp = req.body?.linha_whatsapp ? String(req.body.linha_whatsapp).trim() : null;
      const querPrincipal = Boolean(req.body?.principal);

      const pool = getPool();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Se não há vínculo ativo principal no deal, este vira principal
        const principalAtivoRes = await client.query(
          'SELECT id FROM crm_deal_conversas WHERE deal_id = $1 AND principal = TRUE AND ativo = TRUE LIMIT 1;',
          [cleanDealId]
        );
        const temPrincipalAtivo = principalAtivoRes && principalAtivoRes.rows && principalAtivoRes.rows.length > 0;
        const seraPrincipal = querPrincipal || !temPrincipalAtivo;

        if (seraPrincipal) {
          await client.query(
            'UPDATE crm_deal_conversas SET principal = FALSE WHERE deal_id = $1 AND principal = TRUE AND ativo = TRUE;',
            [cleanDealId]
          );
        }

        await client.query(`
          INSERT INTO crm_deal_conversas (deal_id, conversa_id, telefone_e164, linha_whatsapp, principal, ativo, vinculado_por)
          VALUES ($1, $2, $3, $4, $5, TRUE, $6)
          ON CONFLICT (deal_id, conversa_id) DO UPDATE SET
            ativo = TRUE,
            principal = EXCLUDED.principal,
            telefone_e164 = EXCLUDED.telefone_e164,
            linha_whatsapp = EXCLUDED.linha_whatsapp;
        `, [cleanDealId, conversaId, e164, linhaWhatsapp, seraPrincipal, req.crmUser.username]);

        await client.query('COMMIT');
      } catch (transErr) {
        await client.query('ROLLBACK');
        throw transErr;
      } finally {
        client.release();
      }

      // Registra atividade vinculada
      await crmEngine.criarAtividadeDeal(cleanDealId, {
        tipo: 'whatsapp_vinculo',
        status: 'concluida',
        assunto: `Conversa do WhatsApp vinculada (${e164})`
      }, req.crmUser, req.crmScope);

      crmEngine.recordTelemetry(
        req.crmUser,
        'CRM_WHATSAPP_VINCULO',
        `Conversa ${conversaId} vinculada ao negócio #${cleanDealId}`,
        {
          deal_id: cleanDealId,
          conversa_id: conversaId,
          telefone_e164: e164,
          username: req.crmUser.username
        }
      ).catch(() => {});

      const vinculosRes = await safeQuery(`
        SELECT deal_id, conversa_id, telefone_e164, linha_whatsapp, principal, ativo, vinculado_por, vinculado_em
        FROM crm_deal_conversas
        WHERE deal_id = $1 AND ativo = TRUE
        ORDER BY principal DESC, vinculado_em DESC;
      `, [cleanDealId]);

      return res.status(200).json({
        success: true,
        data: {
          vinculos: vinculosRes?.rows || []
        }
      });
    } catch (err) {
      return sendRfcError(res, {
        status: err.status || 500,
        title: 'Erro ao vincular conversa ao negócio',
        detail: err.message,
        code: err.code || 'VINCULAR_CONVERSA_ERROR'
      });
    }
  });

  /**
   * GET /api/integracoes/whatsapp/crm/deals/:id/conversas
   * Lista as conversas do WhatsApp vinculadas ao negócio
   */
  router.get('/deals/:id/conversas', async (req, res) => {
    try {
      const { id } = req.params;
      const cleanDealId = String(id || '').trim();

      const deal = await crmEngine.obterDealPorId(cleanDealId, req.crmScope);
      if (!deal) {
        return sendRfcError(res, {
          status: 404,
          title: 'Negócio Não Encontrado',
          detail: `Negócio #${cleanDealId} não encontrado ou sem permissão de visualização.`,
          code: 'DEAL_NOT_FOUND'
        });
      }

      const vinculos = await listarVinculosDeal(cleanDealId);

      return res.status(200).json({
        success: true,
        data: {
          vinculos
        }
      });
    } catch (err) {
      return sendRfcError(res, {
        status: err.status || 500,
        title: 'Erro ao listar conversas do negócio',
        detail: err.message,
        code: err.code || 'LISTAR_CONVERSAS_ERROR'
      });
    }
  });

  return router;
}

/**
 * Consulta todas as conversas do WhatsApp vinculadas ativas do negócio
 * @param {string} dealId
 * @returns {Promise<Array>}
 */
async function listarVinculosDeal(dealId) {
  const cleanDealId = String(dealId || '').trim();
  const vinculosRes = await safeQuery(`
    SELECT deal_id, conversa_id, telefone_e164, linha_whatsapp, principal, ativo, vinculado_por, vinculado_em
    FROM crm_deal_conversas
    WHERE deal_id = $1 AND ativo = TRUE
    ORDER BY principal DESC, vinculado_em DESC;
  `, [cleanDealId]);

  return vinculosRes?.rows || [];
}

criarRouterIntegracaoWhatsapp.listarVinculosDeal = listarVinculosDeal;

module.exports = criarRouterIntegracaoWhatsapp;
module.exports.listarVinculosDeal = listarVinculosDeal;
