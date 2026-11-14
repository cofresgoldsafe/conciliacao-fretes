/**
 * crm_routes.js
 * 
 * Router Express para o Módulo de CRM Comercial Nativo
 * Rota base: /api/bi/crm
 * 
 * Regras de Segurança:
 * - Autenticação JWT obrigatória via middleware requireAuth.
 * - Autorização estrita: apenas username 'alexandre' ou roles autorizadas ('admin' / 'diretoria').
 * - Vendedores e usuários comuns recebem 403 Forbidden RFC explícito.
 * - Padronização de envelopes JSON de sucesso e erro compatíveis com RFC 7807 / RFC 9457.
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crmEngine = require('./crm_engine');

// Lida na hora da validacao: o server.js define process.env.JWT_SECRET depois de carregar este modulo.
const getJwtSecret = () => process.env.JWT_SECRET;

/**
 * Envelope de Erro Padronizado RFC 7807 / RFC 9457
 */
function sendRfcError(res, { status = 500, title = 'Erro interno do servidor', detail = '', code = 'INTERNAL_ERROR' }) {
  let safeDetail = detail || title;
  if (status >= 500 && process.env.NODE_ENV === 'production') {
    safeDetail = 'Ocorreu um erro interno ao processar a operação. Tente novamente.';
  }
  return res.status(status).json({
    success: false,
    message: safeDetail,
    error: {
      type: `https://portal.gsicofres.com.br/errors/${code.toLowerCase().replace(/_/g, '-')}`,
      title,
      status,
      detail: safeDetail,
      code
    }
  });
}

/**
 * Middleware: Autenticação JWT
 */
function requireAuth(req, res, next) {
  if (req.user && req.user.username) {
    return next();
  }

  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.startsWith('Bearer '))
    ? authHeader.slice(7).trim()
    : (req.headers['x-auth-token'] || req.query.token);

  if (!token) {
    return sendRfcError(res, {
      status: 401,
      title: 'Não Autorizado',
      detail: 'Autenticação necessária. Forneça um token válido no cabeçalho Authorization.',
      code: 'UNAUTHORIZED'
    });
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    req.user = decoded;
    return next();
  } catch (err) {
    return sendRfcError(res, {
      status: 401,
      title: 'Sessão Expirada ou Token Inválido',
      detail: 'Sua credencial expirou ou é inválida. Realize login novamente.',
      code: 'TOKEN_EXPIRED'
    });
  }
}

/**
 * Verifica se o usuário autenticado possui perfil administrativo no CRM
 */
function isCrmAdmin(user) {
  if (!user) return false;
  const username = String(user.username || '').trim().toLowerCase();
  const role = String(user.role || '').trim().toLowerCase();
  return username === 'alexandre' || role === 'admin' || role === 'diretoria';
}

/**
 * Middleware: Autorização e resolução de vínculo comercial no CRM
 * - Admin ('alexandre', role 'admin' ou 'diretoria'): acesso total
 * - Vendedor (role 'vendedor'): exige permissão 'crm' no cadastro e vínculo ativo em crm_vendedores por username_portal
 * - Outras roles ('user', 'logistica', 'analista-fin'): 403 Forbidden
 */
async function requireCrmAccess(req, res, next) {
  try {
    const user = req.user;
    if (!user) {
      return sendRfcError(res, {
        status: 401,
        title: 'Não Autenticado',
        detail: 'Usuário não identificado na requisição.',
        code: 'UNAUTHENTICATED'
      });
    }

    const username = String(user.username || '').trim().toLowerCase();
    const role = String(user.role || '').trim().toLowerCase();

    if (isCrmAdmin(user)) {
      req.crmUser = {
        ...user,
        username,
        role: role || 'admin',
        isAdmin: true,
        cod_vendedor: null,
        nome_vendedor: user.name || 'Alexandre'
      };
      return next();
    }

    if (role === 'vendedor') {
      const perms = Array.isArray(user.permissions)
        ? user.permissions.map(p => String(p).trim().toLowerCase())
        : [];
      if (!perms.includes('crm')) {
        return sendRfcError(res, {
          status: 403,
          title: 'Acesso Proibido',
          detail: 'Seu usuário não possui a permissão "crm" habilitada. Solicite a liberação ao administrador.',
          code: 'FORBIDDEN_CRM'
        });
      }

      const vendedor = await crmEngine.obterVendedorPorUsername(username);
      if (!vendedor || vendedor.ativo === false) {
        return sendRfcError(res, {
          status: 403,
          title: 'Vendedor Sem Vínculo no CRM',
          detail: `O usuário "${username}" não possui vínculo comercial ativo em crm_vendedores.`,
          code: 'FORBIDDEN_CRM'
        });
      }

      if (user.vendorCode && String(user.vendorCode).trim() !== vendedor.cod_vendedor) {
        console.warn(`⚠️ [CRM RBAC] Divergência de vendorCode no JWT de "${username}": JWT=${user.vendorCode} vs crm_vendedores=${vendedor.cod_vendedor}. Utilizando crm_vendedores.`);
      }

      req.crmUser = {
        ...user,
        username,
        role: 'vendedor',
        isAdmin: false,
        cod_vendedor: vendedor.cod_vendedor,
        nome_vendedor: vendedor.nome,
        meta_mensal: vendedor.meta_mensal
      };
      return next();
    }

    return sendRfcError(res, {
      status: 403,
      title: 'Acesso Proibido',
      detail: 'Seu perfil de acesso não possui autorização para o módulo de CRM Comercial.',
      code: 'FORBIDDEN_CRM'
    });
  } catch (err) {
    return sendRfcError(res, {
      status: 500,
      title: 'Erro ao validar acesso ao CRM',
      detail: err.message,
      code: 'CRM_AUTH_ERROR'
    });
  }
}

/**
 * Middleware: Define o escopo de proprietário (req.crmScope) para filtragem server-side
 */
function scopeByOwner(req, res, next) {
  if (req.crmUser && req.crmUser.isAdmin) {
    req.crmScope = {
      all: true,
      codVendedor: null,
      codigosLeitura: null,
      nomeVendedor: null,
      username: req.crmUser.username,
      role: req.crmUser.role || 'admin'
    };
  } else {
    const cod = req.crmUser ? req.crmUser.cod_vendedor : null;
    req.crmScope = {
      all: false,
      codVendedor: cod,
      codigosLeitura: cod ? [cod] : [],
      nomeVendedor: req.crmUser ? req.crmUser.nome_vendedor : null,
      username: req.crmUser ? req.crmUser.username : '',
      role: 'vendedor'
    };
  }
  return next();
}

/**
 * Middleware: Restringe rotas destrutivas ou administrativas exclusivamente ao Admin
 */
function requireCrmAdmin(req, res, next) {
  if (req.crmUser && req.crmUser.isAdmin) {
    return next();
  }
  return sendRfcError(res, {
    status: 403,
    title: 'Operação Restrita ao Administrador',
    detail: 'Esta operação é exclusiva para administradores do CRM Comercial.',
    code: 'FORBIDDEN_CRM_ADMIN'
  });
}

// Aplicação global dos middlewares no router do CRM
router.use(requireAuth);
router.use(requireCrmAccess);
router.use(scopeByOwner);

// ============================================================================
// ENDPOINTS DE DEALS / NEGÓCIOS
// ============================================================================

/**
 * GET /api/bi/crm/deals
 * Lista os negócios do pipeline com filtros por estágio, vendedor, status e busca
 */
router.get('/deals', async (req, res) => {
  try {
    const { estagio, busca, codVendedor, cod_vendedor, status } = req.query;
    const vendFiltro = codVendedor || cod_vendedor;
    const resultado = await crmEngine.listarDeals({
      estagio: estagio ? String(estagio).trim() : undefined,
      busca: busca ? String(busca).trim() : undefined,
      codVendedor: vendFiltro ? String(vendFiltro).trim() : undefined,
      status: status ? String(status).trim() : undefined
    }, req.crmScope);

    return res.json({
      success: true,
      total: resultado.total,
      source: resultado.source,
      data: resultado.deals
    });
  } catch (err) {
    return sendRfcError(res, {
      status: 500,
      title: 'Erro ao listar negócios',
      detail: err.message,
      code: 'LIST_DEALS_ERROR'
    });
  }
});

/**
 * POST /api/bi/crm/deals/migrate-ids
 * Força a execução da migração de IDs legados para os 4 dígitos finais em todas as tabelas
 */
router.post('/deals/migrate-ids', requireCrmAdmin, async (req, res) => {
  try {
    await crmEngine.migrarDealsLegadosParaSequencial(true);
    return res.json({
      success: true,
      message: 'Migração de IDs legados para 4 dígitos executada com sucesso!'
    });
  } catch (err) {
    return sendRfcError(res, {
      status: 500,
      title: 'Erro ao migrar IDs legados',
      detail: err.message,
      code: 'MIGRATE_IDS_ERROR'
    });
  }
});

/**
 * POST /api/bi/crm/deals
 * Cria um novo negócio no CRM
 */
router.post('/deals', async (req, res) => {
  try {
    const dados = req.body;
    if (!dados || !dados.titulo || !String(dados.titulo).trim()) {
      return sendRfcError(res, {
        status: 400,
        title: 'Dados Inválidos',
        detail: "O campo 'titulo' do negócio é obrigatório.",
        code: 'VALIDATION_ERROR'
      });
    }
    if (!dados.cliente_nome || !String(dados.cliente_nome).trim()) {
      return sendRfcError(res, {
        status: 400,
        title: 'Dados Inválidos',
        detail: "O campo 'cliente_nome' é obrigatório.",
        code: 'VALIDATION_ERROR'
      });
    }

    const novoDeal = await crmEngine.criarDeal(dados, req.user, req.crmScope);

    return res.status(201).json({
      success: true,
      message: 'Negócio cadastrado com sucesso!',
      data: novoDeal
    });
  } catch (err) {
    return sendRfcError(res, {
      status: err.status || 500,
      title: 'Erro ao criar negócio',
      detail: err.message,
      code: err.code || 'CREATE_DEAL_ERROR'
    });
  }
});

/**
 * GET /api/bi/crm/deals/:id
 * Consulta os detalhes de um negócio específico
 */
router.get('/deals/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const deal = await crmEngine.obterDealPorId(id, req.crmScope);

    if (!deal) {
      return sendRfcError(res, {
        status: 404,
        title: 'Negócio Não Encontrado',
        detail: `Negócio #${id} não foi encontrado no sistema ou foi excluído.`,
        code: 'DEAL_NOT_FOUND'
      });
    }

    return res.json({
      success: true,
      data: deal
    });
  } catch (err) {
    return sendRfcError(res, {
      status: 500,
      title: 'Erro ao obter negócio',
      detail: err.message,
      code: 'GET_DEAL_ERROR'
    });
  }
});

/**
 * PUT /api/bi/crm/deals/:id
 * Atualiza integralmente os dados de um negócio existente
 */
router.put('/deals/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const dados = req.body;

    const dealAtualizado = await crmEngine.atualizarDeal(id, dados, req.user, req.crmScope);

    return res.json({
      success: true,
      message: 'Negócio atualizado com sucesso!',
      data: dealAtualizado
    });
  } catch (err) {
    return sendRfcError(res, {
      status: err.status || 500,
      title: 'Erro ao atualizar negócio',
      detail: err.message,
      code: err.code || 'UPDATE_DEAL_ERROR'
    });
  }
});

/**
 * PATCH /api/bi/crm/deals/:id/stage
 * Atualiza o estágio do pipeline (Kanban drag & drop)
 */
router.patch('/deals/:id/stage', async (req, res) => {
  try {
    const { id } = req.params;
    const novoEstagio = req.body.novoEstagio || req.body.estagio;
    const justificativa = req.body.justificativa || '';
    const motivoPerda = req.body.motivoPerda || req.body.motivo_perda || '';

    if (!novoEstagio || !String(novoEstagio).trim()) {
      return sendRfcError(res, {
        status: 400,
        title: 'Parâmetro Obrigatório',
        detail: "O campo 'novoEstagio' (ou 'estagio') é obrigatório.",
        code: 'STAGE_REQUIRED'
      });
    }

    const dealAtualizado = await crmEngine.atualizarEstagioDeal(
      id,
      novoEstagio,
      req.user,
      justificativa,
      motivoPerda,
      req.crmScope
    );

    return res.json({
      success: true,
      message: `Estágio atualizado para "${novoEstagio}" com sucesso!`,
      data: dealAtualizado
    });
  } catch (err) {
    return sendRfcError(res, {
      status: err.status || 500,
      title: 'Erro ao alterar estágio',
      detail: err.message,
      code: err.code || 'STAGE_UPDATE_ERROR'
    });
  }
});

/**
 * DELETE /api/bi/crm/deals/:id
 * Exclusão lógica (soft delete) do negócio
 */
router.delete('/deals/:id', requireCrmAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const resultado = await crmEngine.excluirDeal(id, req.user);

    return res.json({
      success: true,
      message: 'Negócio excluído com sucesso.',
      data: resultado
    });
  } catch (err) {
    return sendRfcError(res, {
      status: err.status || 500,
      title: 'Erro ao excluir negócio',
      detail: err.message,
      code: err.code || 'DELETE_DEAL_ERROR'
    });
  }
});

// ============================================================================
// ENDPOINTS DE ATIVIDADES DO DEAL
// ============================================================================

/**
 * GET /api/bi/crm/deals/:id/activities
 * Lista o histórico de atividades e follow-ups de um negócio
 */
router.get('/deals/:id/activities', async (req, res) => {
  try {
    const { id } = req.params;
    const atividades = await crmEngine.listarAtividadesDeal(id, req.crmScope);

    return res.json({
      success: true,
      total: atividades.length,
      data: atividades
    });
  } catch (err) {
    return sendRfcError(res, {
      status: err.status || 500,
      title: 'Erro ao listar atividades',
      detail: err.message,
      code: err.code || 'LIST_ACTIVITIES_ERROR'
    });
  }
});

/**
 * POST /api/bi/crm/deals/:id/activities
 * Adiciona uma nova atividade / compromisso / nota vinculada ao negócio
 */
router.post('/deals/:id/activities', async (req, res) => {
  try {
    const { id } = req.params;
    const dados = req.body;

    if (!dados || !dados.tipo || !String(dados.tipo).trim()) {
      return sendRfcError(res, {
        status: 400,
        title: 'Dados Inválidos',
        detail: "O tipo da atividade ('tipo') é obrigatório (ex: ligacao, reuniao, tarefa).",
        code: 'ACTIVITY_TYPE_REQUIRED'
      });
    }

    if (!dados.assunto || !String(dados.assunto).trim()) {
      return sendRfcError(res, {
        status: 400,
        title: 'Dados Inválidos',
        detail: "O assunto da atividade ('assunto') é obrigatório.",
        code: 'ACTIVITY_SUBJECT_REQUIRED'
      });
    }

    const novaAtividade = await crmEngine.criarAtividadeDeal(id, dados, req.user, req.crmScope);

    return res.status(201).json({
      success: true,
      message: 'Atividade registrada com sucesso!',
      data: novaAtividade
    });
  } catch (err) {
    return sendRfcError(res, {
      status: err.status || 500,
      title: 'Erro ao registrar atividade',
      detail: err.message,
      code: err.code || 'CREATE_ACTIVITY_ERROR'
    });
  }
});

// ============================================================================
// ENDPOINT DE AUTOCOMPLETE DE CLIENTES (PROTHEUS SA1010)
// ============================================================================

/**
 * GET /api/bi/crm/clientes/autocomplete
 * Busca instantânea de clientes cadastrados no Protheus SA1010 por Razão Social, CNPJ ou Código
 */
router.get('/clientes/autocomplete', async (req, res) => {
  try {
    const termo = (req.query.termo || req.query.q || req.query.busca || '').trim();
    const clientes = await crmEngine.autocompleteClientes(termo);

    return res.json({
      success: true,
      total: clientes.length,
      data: clientes
    });
  } catch (err) {
    return sendRfcError(res, {
      status: 500,
      title: 'Erro no autocomplete de clientes',
      detail: err.message,
      code: 'AUTOCOMPLETE_ERROR'
    });
  }
});

// ============================================================================
// ENDPOINTS DE CATÁLOGO E ESPELHO DE PRODUTOS (PROTHEUS SB1090/SB1160)
// ============================================================================

/**
 * GET /api/bi/crm/produtos/autocomplete
 * Busca inteligente de produtos cadastrados no CRM / Protheus ERP por código ou descrição
 */
router.get('/produtos/autocomplete', async (req, res) => {
  try {
    const termo = (req.query.q || req.query.termo || req.query.busca || '').trim();
    const limite = req.query.limite ? parseInt(req.query.limite, 10) : 15;
    const apenasAtivos = req.query.apenasAtivos !== 'false';

    const produtos = await crmEngine.autocompleteProdutos(termo, { limite, apenasAtivos });

    return res.json({
      success: true,
      total: produtos.length,
      data: produtos
    });
  } catch (err) {
    return sendRfcError(res, {
      status: 500,
      title: 'Erro no autocomplete de produtos',
      detail: err.message,
      code: 'PRODUTOS_AUTOCOMPLETE_ERROR'
    });
  }
});

/**
 * POST /api/bi/crm/produtos/sync
 * Força a sincronização do catálogo de produtos das tabelas SB1090 e SB1160 do Protheus
 */
router.post('/produtos/sync', requireCrmAdmin, async (req, res) => {
  try {
    const username = (req.user && req.user.username) || 'sistema';
    const resultado = await crmEngine.sincronizarProdutosCrmProtheus({ triggeredBy: username });

    return res.json({
      success: true,
      message: 'Catálogo de produtos do Protheus sincronizado com sucesso.',
      data: resultado
    });
  } catch (err) {
    return sendRfcError(res, {
      status: 500,
      title: 'Erro na sincronização de produtos do Protheus',
      detail: err.message,
      code: 'PRODUTOS_SYNC_ERROR'
    });
  }
});

/**
 * GET /api/bi/crm/produtos/status
 * Retorna telemetria e integridade do catálogo de produtos (total, ativos, data da última carga)
 */
router.get('/produtos/status', async (req, res) => {
  try {
    const statusInfo = await crmEngine.obterStatusProdutosCrm();

    return res.json({
      success: true,
      data: statusInfo
    });
  } catch (err) {
    return sendRfcError(res, {
      status: 500,
      title: 'Erro ao obter status do catálogo de produtos',
      detail: err.message,
      code: 'PRODUTOS_STATUS_ERROR'
    });
  }
});

// ============================================================================
// ENDPOINTS DE TRANSPORTADORAS HOMOLOGADAS (PROTHEUS SA4010/SA4160)
// ============================================================================

/**
 * GET /api/bi/crm/transportadoras/autocomplete
 * Busca inteligente de transportadoras homologadas no Protheus ERP por código, nome, fantasia ou CNPJ
 */
router.get('/transportadoras/autocomplete', async (req, res) => {
  try {
    const termo = (req.query.q || req.query.termo || req.query.busca || '').trim();
    const limite = req.query.limite ? parseInt(req.query.limite, 10) : 15;

    const transportadoras = await crmEngine.autocompleteTransportadoras(termo, { limite });

    return res.json({
      success: true,
      total: transportadoras.length,
      data: transportadoras
    });
  } catch (err) {
    return sendRfcError(res, {
      status: 500,
      title: 'Erro no autocomplete de transportadoras',
      detail: err.message,
      code: 'TRANSPORTADORAS_AUTOCOMPLETE_ERROR'
    });
  }
});

/**
 * POST /api/bi/crm/transportadoras/sync
 * Força a sincronização das transportadoras homologadas das tabelas SA4010 e SA4160 do Protheus
 */
router.post('/transportadoras/sync', requireCrmAdmin, async (req, res) => {
  try {
    const username = (req.user && req.user.username) || 'sistema';
    const resultado = await crmEngine.sincronizarTransportadorasProtheus({ triggeredBy: username });

    return res.json({
      success: true,
      message: 'Cadastro de transportadoras do Protheus sincronizado com sucesso.',
      data: resultado
    });
  } catch (err) {
    return sendRfcError(res, {
      status: 500,
      title: 'Erro na sincronização de transportadoras do Protheus',
      detail: err.message,
      code: 'TRANSPORTADORAS_SYNC_ERROR'
    });
  }
});

/**
 * GET /api/bi/crm/transportadoras/status
 * Retorna telemetria e integridade do cadastro de transportadoras (total, ativas, data da última carga)
 */
router.get('/transportadoras/status', async (req, res) => {
  try {
    const statusInfo = await crmEngine.obterStatusTransportadorasCrm();

    return res.json({
      success: true,
      data: statusInfo
    });
  } catch (err) {
    return sendRfcError(res, {
      status: 500,
      title: 'Erro ao obter status das transportadoras',
      detail: err.message,
      code: 'TRANSPORTADORAS_STATUS_ERROR'
    });
  }
});

/**
 * GET /api/bi/crm/vendedores
 * Retorna os vendedores ativos mapeados a partir de crm_vendedores
 */
router.get('/vendedores', async (req, res) => {
  try {
    const lista = await crmEngine.listarVendedores();
    const filtrada = (req.crmScope && !req.crmScope.all)
      ? lista.filter(v => v.cod_vendedor === req.crmScope.codVendedor)
      : lista;
    return res.json({
      success: true,
      data: filtrada.map(v => ({
        codigo: v.cod_vendedor,
        cod_vendedor: v.cod_vendedor,
        nome: v.nome,
        username_portal: v.username_portal,
        meta_mensal: v.meta_mensal,
        ativo: v.ativo
      }))
    });
  } catch (err) {
    return sendRfcError(res, {
      status: 500,
      title: 'Erro ao listar vendedores',
      detail: err.message,
      code: 'LIST_VENDEDORES_ERROR'
    });
  }
});

/**
 * GET /api/bi/crm/me
 * Retorna o contexto do usuário autenticado no CRM e seu escopo de permissões
 */
router.get('/me', async (req, res) => {
  try {
    const cu = req.crmUser;
    return res.json({
      success: true,
      data: {
        username: cu.username,
        name: cu.name || cu.nome_vendedor || cu.username,
        role: cu.role,
        isAdmin: Boolean(cu.isAdmin),
        cod_vendedor: cu.cod_vendedor || null,
        nome_vendedor: cu.nome_vendedor || null,
        meta_mensal: cu.meta_mensal !== undefined ? cu.meta_mensal : null,
        scope: req.crmScope,
        permissions: {
          canFilterVendor: Boolean(cu.isAdmin),
          canAssignVendor: Boolean(cu.isAdmin),
          canDeleteDeal: Boolean(cu.isAdmin),
          canRestoreDeal: Boolean(cu.isAdmin),
          canDeleteCliente: Boolean(cu.isAdmin),
          canRestoreCliente: Boolean(cu.isAdmin),
          canSyncCatalogos: Boolean(cu.isAdmin),
          canMigrateIds: Boolean(cu.isAdmin)
        }
      }
    });
  } catch (err) {
    return sendRfcError(res, {
      status: 500,
      title: 'Erro ao obter perfil do CRM',
      detail: err.message,
      code: 'CRM_ME_ERROR'
    });
  }
});

/**
 * GET /api/bi/crm/meta
 * Retorna a meta mensal e o realizado no mês de referência (baseado em data_fechamento_real)
 */
router.get('/meta', async (req, res) => {
  try {
    const resultado = await crmEngine.obterMetaMensal({
      mes: req.query.mes,
      scope: req.crmScope
    });
    return res.json({
      success: true,
      data: resultado
    });
  } catch (err) {
    return sendRfcError(res, {
      status: 500,
      title: 'Erro ao calcular meta mensal do CRM',
      detail: err.message,
      code: 'CRM_META_ERROR'
    });
  }
});

/**
 * POST /api/bi/crm/deals/:id/restore
 * Restaura um negócio excluído (soft delete)
 */
router.post('/deals/:id/restore', requireCrmAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const deal = await crmEngine.restaurarDeal(id, req.user);
    return res.json({
      success: true,
      message: `Negócio #${id} restaurado com sucesso.`,
      data: deal
    });
  } catch (err) {
    return sendRfcError(res, {
      status: err.status || 500,
      title: 'Erro ao restaurar negócio',
      detail: err.message,
      code: err.code || 'RESTORE_DEAL_ERROR'
    });
  }
});

// ============================================================================
// ENDPOINTS DE CADASTRO DE CLIENTES DO CRM
// ============================================================================

/**
 * GET /api/bi/crm/clientes
 * Lista os clientes cadastrados com suporte a busca, filtro por vendedor e paginação
 */
router.get('/clientes', async (req, res) => {
  try {
    const { busca, vendedor, limit, offset, page, order } = req.query;
    const resultado = await crmEngine.listarClientes({
      busca: busca ? String(busca).trim() : undefined,
      vendedor: vendedor ? String(vendedor).trim() : undefined,
      limit,
      offset,
      page,
      order
    });

    return res.json({
      success: true,
      data: resultado.items,
      pagination: resultado.pagination
    });
  } catch (err) {
    return sendRfcError(res, {
      status: 500,
      title: 'Erro ao listar clientes',
      detail: err.message,
      code: 'LIST_CLIENTES_ERROR'
    });
  }
});

/**
 * GET /api/bi/crm/clientes/:id
 * Consulta os detalhes de um cliente específico pelo ID
 */
router.get('/clientes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const cliente = await crmEngine.obterClientePorId(id);

    if (!cliente) {
      return sendRfcError(res, {
        status: 404,
        title: 'Cliente Não Encontrado',
        detail: `Cliente #${id} não foi localizado no sistema ou foi excluído.`,
        code: 'CLIENTE_NOT_FOUND'
      });
    }

    return res.json({
      success: true,
      data: cliente
    });
  } catch (err) {
    return sendRfcError(res, {
      status: 500,
      title: 'Erro ao obter cliente',
      detail: err.message,
      code: 'GET_CLIENTE_ERROR'
    });
  }
});

/**
 * POST /api/bi/crm/clientes
 * Cadastra ou atualiza um cliente comercial no CRM
 */
router.post('/clientes', async (req, res) => {
  try {
    const dados = req.body;
    if (!dados || !dados.nome_razao || !String(dados.nome_razao).trim()) {
      return sendRfcError(res, {
        status: 400,
        title: 'Dados Inválidos',
        detail: "O campo 'nome_razao' é obrigatório para cadastrar o cliente.",
        code: 'VALIDATION_ERROR'
      });
    }

    const isEdicao = !!dados.id;
    const clienteSalvo = await crmEngine.salvarCliente(dados, req.user);

    return res.status(isEdicao ? 200 : 201).json({
      success: true,
      message: isEdicao ? 'Cliente atualizado com sucesso!' : 'Cliente cadastrado com sucesso!',
      data: clienteSalvo
    });
  } catch (err) {
    return sendRfcError(res, {
      status: err.status || 500,
      title: 'Erro ao salvar cliente',
      detail: err.message,
      code: err.code || 'SAVE_CLIENTE_ERROR'
    });
  }
});

/**
 * DELETE /api/bi/crm/clientes/:id
 * Exclusão lógica (soft delete) do cliente comercial
 */
router.delete('/clientes/:id', requireCrmAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const resultado = await crmEngine.excluirCliente(id, req.user);

    return res.json({
      success: true,
      message: 'Cliente excluído com sucesso.',
      data: resultado
    });
  } catch (err) {
    return sendRfcError(res, {
      status: err.status || 500,
      title: 'Erro ao excluir cliente',
      detail: err.message,
      code: err.code || 'DELETE_CLIENTE_ERROR'
    });
  }
});

/**
 * POST /api/bi/crm/clientes/:id/restore
 * Restauração lógica (reversibilidade) do cliente comercial
 */
router.post('/clientes/:id/restore', requireCrmAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const cliente = await crmEngine.restaurarCliente(id, req.user);

    return res.json({
      success: true,
      message: `Cliente #${id} restaurado com sucesso.`,
      data: cliente
    });
  } catch (err) {
    return sendRfcError(res, {
      status: err.status || 500,
      title: 'Erro ao restaurar cliente',
      detail: err.message,
      code: err.code || 'RESTORE_CLIENTE_ERROR'
    });
  }
});

/**
 * GET /api/bi/crm/cep/:cep
 * Consulta endereço a partir do CEP via ViaCEP com cache
 */
router.get('/cep/:cep', async (req, res) => {
  try {
    const { cep } = req.params;
    const endereco = await crmEngine.consultarCep(cep);

    return res.json({
      success: true,
      data: endereco
    });
  } catch (err) {
    return sendRfcError(res, {
      status: err.status || 500,
      title: 'Erro ao consultar CEP',
      detail: err.message,
      code: err.code || 'CEP_ERROR'
    });
  }
});

/**
 * GET /api/bi/crm/clientes/raiz-cnpj/:cnpj
 * Consulta histórico de compras consolidado por Raiz de CNPJ nas 7 empresas do Grupo GSI
 */
router.get('/clientes/raiz-cnpj/:cnpj', async (req, res) => {
  try {
    const { cnpj } = req.params;
    const clean = String(cnpj || '').replace(/\D/g, '');
    if (!clean || clean.length < 8) {
      return sendRfcError(res, {
        status: 400,
        title: 'CNPJ ou CPF inválido',
        detail: 'O parâmetro deve conter ao menos 8 dígitos numéricos para identificação da raiz.',
        code: 'INVALID_CNPJ_ROOT'
      });
    }

    const fidelidade = await crmEngine.obterFidelidadeRaiz(cnpj);

    return res.json({
      success: true,
      data: fidelidade || {
        raiz_cnpj: clean.slice(0, 8),
        total_compras: 0,
        tipo: null,
        icone: '',
        label: '',
        tooltip: ''
      }
    });
  } catch (err) {
    return sendRfcError(res, {
      status: 500,
      title: 'Erro ao consultar fidelidade da raiz de CNPJ',
      detail: err.message,
      code: 'RAIZ_CNPJ_ERROR'
    });
  }
});

module.exports = router;
