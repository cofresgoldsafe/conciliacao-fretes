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

const JWT_SECRET = process.env.JWT_SECRET || 'gsi_portal_jwt_secret_key_prod_2026_x89a';

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
    const decoded = jwt.verify(token, JWT_SECRET);
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
 * Middleware: Autorização Estrita (Alexandre / Admin)
 * Bloqueia expressamente vendedores e operadores (403 Forbidden)
 */
function requireAdminOrAlexandre(req, res, next) {
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

  // Vendedores recebem 403 Forbidden
  if (role === 'vendedor' || role === 'user') {
    return sendRfcError(res, {
      status: 403,
      title: 'Acesso Proibido',
      detail: 'Acesso negado. Vendedores não possuem autorização para o módulo de CRM Comercial Nativo.',
      code: 'FORBIDDEN_VENDOR'
    });
  }

  // Trava de autorização explícita: Apenas 'alexandre' ou administradores
  if (username === 'alexandre' || role === 'admin' || role === 'diretoria') {
    return next();
  }

  return sendRfcError(res, {
    status: 403,
    title: 'Acesso Proibido',
    detail: 'Apenas o usuário master alexandre ou administradores possuem privilégios no CRM.',
    code: 'FORBIDDEN'
  });
}

// Aplicação global dos middlewares no router do CRM
router.use(requireAuth);
router.use(requireAdminOrAlexandre);

// ============================================================================
// ENDPOINTS DE DEALS / NEGÓCIOS
// ============================================================================

/**
 * GET /api/bi/crm/deals
 * Lista os negócios do pipeline com filtros por estágio, vendedor, status e busca
 */
router.get('/deals', async (req, res) => {
  try {
    const { estagio, busca, codVendedor, status } = req.query;
    const resultado = await crmEngine.listarDeals({
      estagio: estagio ? String(estagio).trim() : undefined,
      busca: busca ? String(busca).trim() : undefined,
      codVendedor: codVendedor ? String(codVendedor).trim() : undefined,
      status: status ? String(status).trim() : undefined
    });

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

    const novoDeal = await crmEngine.criarDeal(dados, req.user);

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
    const deal = await crmEngine.obterDealPorId(id);

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

    const dealAtualizado = await crmEngine.atualizarDeal(id, dados, req.user);

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
      motivoPerda
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
router.delete('/deals/:id', async (req, res) => {
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
    const atividades = await crmEngine.listarAtividadesDeal(id);

    return res.json({
      success: true,
      total: atividades.length,
      data: atividades
    });
  } catch (err) {
    return sendRfcError(res, {
      status: 500,
      title: 'Erro ao listar atividades',
      detail: err.message,
      code: 'LIST_ACTIVITIES_ERROR'
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

    const novaAtividade = await crmEngine.criarAtividadeDeal(id, dados, req.user);

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

/**
 * GET /api/bi/crm/vendedores
 * Retorna os vendedores ativos mapeados
 */
router.get('/vendedores', (req, res) => {
  return res.json({
    success: true,
    data: [
      { codigo: '000004', nome: 'Figueiredo' },
      { codigo: '000064', nome: 'Andrea' },
      { codigo: '000074', nome: 'Juliana' },
      { codigo: '000001', nome: 'Alexandre' },
      { codigo: '000000', nome: 'Diretoria' }
    ]
  });
});

/**
 * POST /api/bi/crm/deals/:id/restore
 * Restaura um negócio excluído (soft delete)
 */
router.post('/deals/:id/restore', async (req, res) => {
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

module.exports = router;
