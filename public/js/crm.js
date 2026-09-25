/**
 * public/js/crm.js
 * Módulo SPA de CRM Comercial Nativo (Pipeline de Vendas & Kanban)
 * Plataforma de Apoio GSI (Gemini-Cli)
 */

(function () {
  'use strict';

  // 5 Fases Canônicas da Empresa
  const CANONICAL_STAGES = [
    { id: 'LEAD', label: 'Novos Info Pendentes', color: '#64748b', icon: '📥', bgBadge: 'rgba(100, 116, 139, 0.15)' },
    { id: 'CONTATO', label: 'Sem Contato Não Responde', color: '#f59e0b', icon: '⏳', bgBadge: 'rgba(245, 158, 11, 0.15)' },
    { id: 'PROPOSTA', label: 'Proposta feita', color: '#3b82f6', icon: '📄', bgBadge: 'rgba(59, 130, 246, 0.15)' },
    { id: 'NEGOCIACAO', label: 'Negociação Quente', color: '#ec4899', icon: '🔥', bgBadge: 'rgba(236, 72, 153, 0.15)' },
    { id: 'GANHO', label: 'Venda Efetuada', color: '#10b981', icon: '🏆', bgBadge: 'rgba(16, 185, 129, 0.15)' }
  ];

  // Estado Interno do Módulo
  let isInitialized = false;
  let deals = [];
  let currentDeal = null;
  let currentItems = [];
  let autocompleteDebounceTimer = null;
  let draggedDealId = null;
  let dealViewMode = localStorage.getItem('gsi_crm_deal_view_mode') || 'kanban'; // 'kanban' | 'listagem'
  let dealsPage = 1;
  let dealsPerPage = 25;

  // Estado de Clientes Cadastrados (CRM)
  let activeView = 'kanban'; // 'kanban' | 'clientes'
  let clientesList = [];
  let clientesPage = 1;
  let clientesTotalPages = 1;
  let clientesTotalCount = 0;
  let clientesFiltroBusca = '';
  let clientesFiltroVendedor = 'TODOS';
  let clienteSearchDebounceTimer = null;
  let clienteModalOrigin = null; // 'deal' | 'tab' | null

  // Lista de Vendedores Padrão
  const DEFAULT_VENDEDORES = [
    'Alexandre',
    'Juliana',
    'Andrea Ferreira',
    'Andrea',
    'Figueiredo'
  ];

  // Armazenamento em Cache Local Resiliente
  const STORAGE_KEY = 'gsi_crm_deals_cache';
  const ACTIVITIES_KEY_PREFIX = 'gsi_crm_activities_';

  /**
   * Obtém token JWT ativo
   */
  function getToken() {
    try {
      const rawSession = localStorage.getItem('conciliacao_fretes_session');
      if (rawSession) {
        const sess = JSON.parse(rawSession);
        if (sess && sess.token) return sess.token;
      }
      return localStorage.getItem('gsi_auth_token') ||
             localStorage.getItem('auth_token') ||
             localStorage.getItem('token') ||
             sessionStorage.getItem('auth_token') ||
             sessionStorage.getItem('token') ||
             (window.currentUser && window.currentUser.token) ||
             (window.session && window.session.token) ||
             null;
    } catch {
      return localStorage.getItem('auth_token') || localStorage.getItem('token') || null;
    }
  }

  /**
   * Retorna usuário autenticado
   */
  function getCurrentUser() {
    try {
      const rawSession = localStorage.getItem('conciliacao_fretes_session');
      if (rawSession) {
        const sess = JSON.parse(rawSession);
        if (sess && sess.username) return sess;
      }
      if (window.currentUser) return window.currentUser;
    } catch {}
    return { username: 'alexandre', name: 'Alexandre' };
  }

  /**
   * Sanitização estrita contra ataques XSS
   */
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Formatação monetária (R$)
   */
  function formatCurrency(val) {
    const num = parseFloat(val) || 0;
    return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  /**
   * Formatação numérica pt-BR com 2 casas decimais (ex: 1.234,56)
   */
  function formatNumberPtBr(val) {
    const num = parseFloat(val) || 0;
    return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /**
   * Converte string numérica formato pt-BR ou decimal para float
   */
  function parseNumberPtBr(val) {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    let s = String(val).trim();
    if (!s) return 0;
    if (s.includes(',') && s.includes('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else if (s.includes(',')) {
      s = s.replace(',', '.');
    }
    const parsed = parseFloat(s);
    return isNaN(parsed) ? 0 : parsed;
  }

  /**
   * Formatação de data (DD/MM/AAAA)
   */
  function formatDate(isoStr) {
    if (!isoStr) return '-';
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      return d.toLocaleDateString('pt-BR');
    } catch {
      return isoStr;
    }
  }

  /**
   * Formatação de data e hora (DD/MM/AAAA HH:mm)
   */
  function formatDateTime(isoStr) {
    if (!isoStr) return '-';
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return isoStr;
    }
  }

  /**
   * Normaliza chave de estágio para uma das 5 canônicas ou PERDIDO
   */
  function normalizeStageKey(st) {
    if (!st) return 'LEAD';
    const clean = String(st).trim().toUpperCase();
    if (clean === 'LEAD' || clean === 'NOVOS' || clean === 'NOVO') return 'LEAD';
    if (clean === 'CONTATO' || clean === 'SEM_CONTATO') return 'CONTATO';
    if (clean === 'PROPOSTA') return 'PROPOSTA';
    if (clean === 'NEGOCIACAO' || clean === 'QUENTE') return 'NEGOCIACAO';
    if (clean === 'GANHO' || clean === 'VENDA_EFETUADA' || clean === 'FECHADO') return 'GANHO';
    if (clean === 'PERDIDO') return 'PERDIDO';
    return clean;
  }

  /**
   * Mapeia deal da API para o formato padronizado do frontend
   */
  function mapDealFromApi(d) {
    if (!d) return null;
    const custom = d.custom || {};
    return {
      id: String(d.id),
      titulo: d.titulo || '',
      clienteNome: d.cliente_nome || d.clienteNome || '',
      clienteCod: d.cliente_cod || d.clienteCod || '',
      clienteLoja: d.cliente_loja || d.clienteLoja || '01',
      clienteCnpj: d.cliente_cnpj_fmt || d.cliente_cnpj || d.clienteCnpj || '',
      vendedor: d.nome_vendedor || d.vendedor || d.cod_vendedor || 'Alexandre',
      fase: normalizeStageKey(d.estagio || d.fase),
      valor: parseFloat(d.valor_total || d.valor) || 0,
      condPgto: custom.condPgto || d.cond_pgto || d.condPgto || '28 DDL',
      freteCobrado: parseFloat(custom.freteCobrado || d.frete_cobrado || d.freteCobrado) || 0,
      freteEmbutido: parseFloat(custom.freteEmbutido || d.frete_embutido || d.freteEmbutido) || 0,
      tipoFrete: custom.tipoFrete || d.tipo_frete || d.tipoFrete || 'CIF',
      transportadora: custom.transportadora || d.transportadora || '',
      transportadoraCod: custom.transportadora_cod || custom.transportadoraCod || d.transportadora_cod || d.transportadoraCod || '',
      prazoEntrega: custom.prazoEntrega || d.prazo_entrega || d.prazoEntrega || '',
      pedidoCompraCliente: custom.pedidoCompraCliente || d.num_pedido_compra || d.pedidoCompraCliente || '',
      observacoesNfe: custom.observacoesNfe || d.obs_nfe || d.observacoesNfe || '',
      itens: Array.isArray(d.itens_cotados) && d.itens_cotados.length > 0 ? d.itens_cotados : (Array.isArray(d.itens) ? d.itens : []),
      contatoNome: d.contato_nome || d.contatoNome || (Array.isArray(d.contatos) && d.contatos[0]?.nome) || (typeof d.contatos === 'string' ? d.contatos : '') || d.cliente_contato || '',
      faturadoPor: custom.faturadoPor || d.faturado_por || d.faturadoPor || d.empresa_faturamento || (d.cod_filial ? `${d.cod_filial} - ${d.nome_filial || ''}` : '') || '',
      motivoPerda: d.motivo_perda || d.motivoPerda || '',
      observacoesPerda: d.observacoes_perda || d.observacoesPerda || '',
      dataFechamentoReal: d.data_fechamento_real || d.dataFechamentoReal || null,
      createdAt: d.created_at || d.createdAt || new Date().toISOString(),
      updatedAt: d.updated_at || d.updatedAt || new Date().toISOString()
    };
  }

  /**
   * Retorna tag de alerta inteligente para o card
   */
  function getDealAlertBadge(deal) {
    if (deal.fase === 'PERDIDO') {
      return `<span class="crm-badge crm-badge-danger" title="Motivo: ${escapeHtml(deal.motivoPerda || 'Não especificado')}">❌ Perdido</span>`;
    }
    if (deal.fase === 'GANHO') {
      return `<span class="crm-badge crm-badge-success">🏆 Venda Efetuada</span>`;
    }
    if (deal.fase === 'NEGOCIACAO') {
      return `<span class="crm-badge crm-badge-hot">🔥 Quente</span>`;
    }

    // Checa inatividade
    const dataRef = deal.updatedAt || deal.createdAt;
    if (dataRef) {
      const dias = Math.floor((Date.now() - new Date(dataRef).getTime()) / (1000 * 60 * 60 * 24));
      if (dias >= 5) {
        return `<span class="crm-badge crm-badge-warning" title="${dias} dias sem interação">⚠️ Sem contato > ${dias}d</span>`;
      }
    }

    if (deal.fase === 'CONTATO') {
      return `<span class="crm-badge crm-badge-warning">⏳ Retorno Pendente</span>`;
    }

    if (deal.itens && deal.itens.length > 0) {
      return `<span class="crm-badge crm-badge-info">📦 ${deal.itens.length} ite${deal.itens.length > 1 ? 'ns' : 'm'}</span>`;
    }

    return `<span class="crm-badge crm-badge-neutral">Novo</span>`;
  }

  /**
   * Amostra inicial de dados (Mock / Seed) se não houver registros no banco
   */
  function getInitialMockDeals() {
    return [
      {
        id: '25944',
        titulo: 'ROMANHA INDUSTRIA DE ALIME',
        clienteNome: 'ROMANHA INDUSTRIA DE ALIMENTOS LTDA',
        clienteCod: '004128',
        clienteLoja: '01',
        clienteCnpj: '61.412.110/0001-55',
        vendedor: 'Andrea Ferreira',
        contatoNome: 'Yuri',
        faturadoPor: '',
        fase: 'GANHO',
        valor: 6402.00,
        condPgto: '',
        freteCobrado: 250.00,
        freteEmbutido: 0.00,
        tipoFrete: 'FOB',
        transportadora: 'Braspress',
        prazoEntrega: '7 dias úteis',
        pedidoCompraCliente: 'PO-2026-9812',
        observacoesNfe: 'Entregar com agendamento prévio na portaria de cargas.',
        itens: [
          { codigo: 'CF-4040', descricao: 'Cofre Mecânico Blindado 40x40', quantidade: 2, precoTabela: 3300.00, precoNegociado: 3201.00, total: 6402.00 }
        ],
        createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 2 * 86400000).toISOString()
      },
      {
        id: '26732',
        titulo: 'COFRES MATOS COMERCIAL DE',
        clienteNome: 'COFRES MATOS COMERCIAL DE EQUIPAMENTOS',
        clienteCod: '009214',
        clienteLoja: '01',
        clienteCnpj: '08.921.454/0001-30',
        vendedor: 'Andrea Ferreira',
        contatoNome: 'SIDNEY',
        faturadoPor: '16 - OACO',
        fase: 'GANHO',
        valor: 1110.00,
        condPgto: '053-1X PIX',
        freteCobrado: 0.00,
        freteEmbutido: 100.00,
        tipoFrete: 'CIF',
        transportadora: 'Rodonaves',
        prazoEntrega: '10 dias úteis',
        pedidoCompraCliente: '',
        observacoesNfe: '',
        itens: [
          { codigo: 'CF-2020', descricao: 'Cofre Boca de Lobo 20x20', quantidade: 1, precoTabela: 1150.00, precoNegociado: 1110.00, total: 1110.00 }
        ],
        createdAt: new Date(Date.now() - 6 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 6 * 86400000).toISOString()
      },
      {
        id: '26719',
        titulo: 'HBT ENGENHARIA E CONSTRUC',
        clienteNome: 'HBT ENGENHARIA E CONSTRUCOES LTDA',
        clienteCod: '012543',
        clienteLoja: '01',
        clienteCnpj: '17.382.901/0001-88',
        vendedor: 'Andrea Ferreira',
        contatoNome: 'Caio Fabio Alve...',
        faturadoPor: '16 - OACO',
        fase: 'GANHO',
        valor: 869.00,
        condPgto: '31 - PAGAR ME (LINK ...)',
        freteCobrado: 0.00,
        freteEmbutido: 0.00,
        tipoFrete: 'CIF',
        transportadora: 'Transfiat Especial',
        prazoEntrega: '5 dias úteis',
        pedidoCompraCliente: 'PED-VALE-2026-04',
        observacoesNfe: 'Emissão para faturamento direto com dados de entrega em filial bancária.',
        itens: [
          { codigo: 'ARM-NR24', descricao: 'Armário Especial 4 Portas', quantidade: 1, precoTabela: 950.00, precoNegociado: 869.00, total: 869.00 }
        ],
        createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 1 * 86400000).toISOString()
      },
      {
        id: '27014',
        titulo: 'Lote 10 Cofres Digitais Hotelaria Premium',
        clienteNome: 'HOTEL RESORT ROYAL PALACE',
        clienteCod: '007321',
        clienteLoja: '01',
        clienteCnpj: '03.732.190/0001-44',
        vendedor: 'Juliana',
        contatoNome: 'Mariana Lima',
        faturadoPor: '16 - OACO',
        fase: 'NEGOCIACAO',
        valor: 14500.00,
        condPgto: '28 DDL',
        freteCobrado: 350.00,
        freteEmbutido: 0.00,
        tipoFrete: 'CIF',
        transportadora: 'Jadlog',
        prazoEntrega: '10 dias úteis',
        pedidoCompraCliente: 'ROYAL-PO-883',
        observacoesNfe: 'Inserir no corpo da NF: Isento de montagem.',
        itens: [
          { codigo: 'CF-HOTEL-DIG', descricao: 'Cofre Digital Senha Auditável Modelo Hotel', quantidade: 10, precoTabela: 1600.00, precoNegociado: 1450.00, total: 14500.00 }
        ],
        createdAt: new Date(Date.now() - 4 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 1 * 3600000).toISOString()
      },
      {
        id: '27105',
        titulo: 'Armários Blindados com Fechadura Biométrica',
        clienteNome: 'LABORATORIO BIOCIENCIA DIAGNOSTICOS',
        clienteCod: '018902',
        clienteLoja: '01',
        clienteCnpj: '22.890.231/0001-12',
        vendedor: 'Alexandre',
        contatoNome: 'Dr. Roberto',
        faturadoPor: '14 - METAL PLENO',
        fase: 'PROPOSTA',
        valor: 22800.00,
        condPgto: '30/60 DDL',
        freteCobrado: 0.00,
        freteEmbutido: 450.00,
        tipoFrete: 'CIF',
        transportadora: 'Braspress',
        prazoEntrega: '5 dias úteis',
        pedidoCompraCliente: 'LAB-ORD-902',
        observacoesNfe: 'Faturamento liberado pelo departamento financeiro.',
        itens: [
          { codigo: 'ARM-BIO-BLIND', descricao: 'Armário Blindado para Medicamentos Controlados', quantidade: 2, precoTabela: 12000.00, precoNegociado: 11400.00, total: 22800.00 }
        ],
        createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 2 * 3600000).toISOString()
      }
    ];
  }

  /**
   * Salva negócios localmente como cache offline resiliente
   */
  function saveDealsLocal(items) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {}
  }

  /**
   * Carrega negócios do cache local
   */
  function loadDealsLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    const initial = getInitialMockDeals();
    saveDealsLocal(initial);
    return initial;
  }

  /**
   * Ordena atividades em ordem estritamente decrescente de data (mais recente no topo)
   * Suporta campos createdAt, created_at e data com desempate determinístico por ID.
   */
  function sortActivitiesDesc(list) {
    if (!Array.isArray(list)) return [];
    return [...list].sort((a, b) => {
      const timeA = new Date(a.createdAt || a.created_at || a.data || 0).getTime();
      const timeB = new Date(b.createdAt || b.created_at || b.data || 0).getTime();
      if (timeB !== timeA) {
        return timeB - timeA; // Mais recente primeiro
      }
      return String(b.id || '').localeCompare(String(a.id || ''));
    });
  }

  /**
   * Salva atividades de um negócio localmente garantindo ordenação decrescente
   */
  function saveActivitiesLocal(dealId, activities) {
    try {
      const sorted = sortActivitiesDesc(activities);
      localStorage.setItem(ACTIVITIES_KEY_PREFIX + dealId, JSON.stringify(sorted));
    } catch {}
  }

  /**
   * Carrega atividades de um negócio com autocura de ordenação
   */
  function loadActivitiesLocal(dealId) {
    try {
      const raw = localStorage.getItem(ACTIVITIES_KEY_PREFIX + dealId);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const sorted = sortActivitiesDesc(parsed);
          saveActivitiesLocal(dealId, sorted);
          return sorted;
        }
      }
    } catch {}
    const mock = [
      {
        id: 'act-2',
        dealId,
        tipo: 'WHATSAPP',
        descricao: 'Enviada proposta comercial em PDF via WhatsApp para o comprador responsável.',
        autor: 'Juliana',
        createdAt: new Date(Date.now() - 1 * 86400000).toISOString()
      },
      {
        id: 'act-1',
        dealId,
        tipo: 'NOTA',
        descricao: 'Oportunidade cadastrada no CRM Comercial com itens cotados iniciais.',
        autor: 'Alexandre',
        createdAt: new Date(Date.now() - 2 * 86400000).toISOString()
      }
    ];
    saveActivitiesLocal(dealId, mock);
    return mock;
  }

  /**
   * Inicializa o Módulo CRM Comercial
   */
  async function init() {
    console.log('💼 [CRM Comercial] Inicializando módulo CRM nativo...');
    renderKanbanSkeleton();
    setupEventListeners();
    await loadVendedoresOptions();
    await loadDeals();
    setDealViewMode(dealViewMode);
    isInitialized = true;
  }

  /**
   * Renderiza a estrutura esquelética das 5 colunas do Kanban
   */
  function renderKanbanSkeleton() {
    const container = document.getElementById('crmKanbanContainer');
    if (!container) return;

    let html = '';
    CANONICAL_STAGES.forEach(stage => {
      html += `
        <div class="crm-kanban-col" data-stage="${stage.id}" id="crmCol-${stage.id}">
          <div class="crm-col-header" style="border-top: 4px solid ${stage.color};">
            <div class="crm-col-title-wrap">
              <span class="crm-col-icon">${stage.icon}</span>
              <span class="crm-col-title">${escapeHtml(stage.label)}</span>
            </div>
            <div class="crm-col-metrics">
              <span class="crm-col-count" id="crmCount-${stage.id}">0 neg.</span>
              <span class="crm-col-sum" id="crmSum-${stage.id}">R$ 0,00</span>
            </div>
          </div>
          <div class="crm-cards-container" id="crmCards-${stage.id}" data-stage="${stage.id}">
            <!-- Cards inseridos dinamicamente -->
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
    setupDragAndDropDropzones();
  }

  /**
   * Carrega opções do seletor de vendedores
   */
  async function loadVendedoresOptions() {
    const selectFilter = document.getElementById('crmFilterVendedor');
    const selectModal = document.getElementById('crmSelectVendedor');
    const selectFilterCliente = document.getElementById('crmClienteFilterVendedor');
    const selectModalCliente = document.getElementById('crmClienteSelectVendedor');

    let lista = DEFAULT_VENDEDORES;

    try {
      const token = getToken();
      const res = await fetch('/api/bi/crm/vendedores', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) lista = data;
        else if (data && Array.isArray(data.data) && data.data.length > 0) lista = data.data;
        else if (data && Array.isArray(data.vendedores) && data.vendedores.length > 0) lista = data.vendedores;
      }
    } catch {
      // Fallback gracioso
    }

    const nomesVendedores = lista.map(v => {
      if (typeof v === 'object' && v !== null) {
        return v.nome || v.codigo || '';
      }
      return String(v);
    }).filter(Boolean);

    // 1. Filtro do Kanban e Listagem (Proprietário/Vendedor) - sem Diretoria
    if (selectFilter) {
      const current = selectFilter.value || 'TODOS';
      const vendedoresDeals = nomesVendedores.filter(v => String(v).trim().toLowerCase() !== 'diretoria');
      selectFilter.innerHTML = '<option value="TODOS">Todos os Vendedores</option>' +
        vendedoresDeals.map(v => `<option value="${escapeHtml(v)}" ${v === current ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('');
    }

    // 2. Select do Modal de Oportunidade
    if (selectModal) {
      const current = selectModal.value || '';
      selectModal.innerHTML = '<option value="">Selecione o Vendedor Responsável...</option>' +
        nomesVendedores.map(v => `<option value="${escapeHtml(v)}" ${v === current ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('');
    }

    // 3. Filtro da Tabela de Clientes
    if (selectFilterCliente) {
      const current = selectFilterCliente.value || 'TODOS';
      selectFilterCliente.innerHTML = '<option value="TODOS">Todos os Vendedores</option>' +
        nomesVendedores.map(v => `<option value="${escapeHtml(v)}" ${v === current ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('');
    }

    // 4. Select do Modal de Cliente
    if (selectModalCliente) {
      const current = selectModalCliente.value || '';
      selectModalCliente.innerHTML = '<option value="">Selecione o Vendedor Responsável...</option>' +
        nomesVendedores.map(v => `<option value="${escapeHtml(v)}" ${v === current ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('');
    }
  }

  /**
   * Carrega lista de negócios (Deals) via API com fallback para cache local
   */
  async function loadDeals() {
    const btnRefresh = document.getElementById('btnCrmRefresh');
    if (btnRefresh) {
      btnRefresh.disabled = true;
      btnRefresh.innerHTML = '<span>⏳ Atualizando...</span>';
    }

    try {
      const token = getToken();
      const filtroVendedor = document.getElementById('crmFilterVendedor')?.value || 'TODOS';
      const search = document.getElementById('crmSearchInput')?.value || '';

      let url = '/api/bi/crm/deals?';
      const params = new URLSearchParams();
      if (filtroVendedor !== 'TODOS') params.append('codVendedor', filtroVendedor);
      if (search.trim()) params.append('busca', search.trim());
      url += params.toString();

      const res = await fetch(url, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });

      if (res.ok) {
        const data = await res.json();
        let rawList = [];
        if (Array.isArray(data)) rawList = data;
        else if (data && Array.isArray(data.data)) rawList = data.data;
        else if (data && Array.isArray(data.deals)) rawList = data.deals;

        if (rawList.length > 0) {
          deals = rawList.map(mapDealFromApi).filter(Boolean);
        } else {
          deals = loadDealsLocal();
        }
        saveDealsLocal(deals);
      } else {
        console.warn('⚠️ [CRM Comercial] Endpoint /api/bi/crm/deals retornou status ' + res.status + '. Carregando cache local.');
        deals = loadDealsLocal();
      }
    } catch (err) {
      console.warn('⚠️ [CRM Comercial] Conexão com backend indisponível, utilizando dados locais resilientes.', err.message);
      deals = loadDealsLocal();
    } finally {
      if (btnRefresh) {
        btnRefresh.disabled = false;
        btnRefresh.innerHTML = '<span>🔄 Atualizar</span>';
      }
      renderDealsViews();
      updateTopKpis();
    }
  }

  /**
   * Retorna os negócios aplicando os filtros da barra de busca
   */
  function getFilteredDeals() {
    const filterText = (document.getElementById('crmSearchInput')?.value || '').trim().toLowerCase();
    const filterVendedor = document.getElementById('crmFilterVendedor')?.value || 'TODOS';
    const filterStatus = document.getElementById('crmFilterStatus')?.value || 'ABERTAS';

    // Helper de formatação de data no fuso de Brasília (UTC-3)
    const formatBrDate = (val) => {
      if (!val) return '';
      if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val.trim())) {
        const [y, m, d] = val.trim().split('-');
        return `${d}/${m}/${y}`;
      }
      const d = new Date(val);
      if (isNaN(d.getTime())) return '';
      return new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(d);
    };

    const agora = new Date();
    const hojeStr = formatBrDate(agora);
    const ontemData = new Date(agora);
    ontemData.setDate(ontemData.getDate() - 1);
    const ontemStr = formatBrDate(ontemData);

    return deals.filter(deal => {
      // Filtro de vendedor
      if (filterVendedor !== 'TODOS' && deal.vendedor !== filterVendedor) {
        return false;
      }

      // Filtro de status: ABERTAS (não ganho e não perdido), GANHO, GANHO_HOJE, GANHO_ONTEM, PERDIDO, TODOS
      if (filterStatus === 'ABERTAS' || filterStatus === 'ATIVOS') {
        if (deal.fase === 'GANHO' || deal.fase === 'PERDIDO') return false;
      } else if (filterStatus === 'GANHO') {
        if (deal.fase !== 'GANHO') return false;
      } else if (filterStatus === 'GANHO_HOJE') {
        if (deal.fase !== 'GANHO') return false;
        const dataDeal = deal.dataFechamentoReal || deal.updatedAt;
        if (!dataDeal || formatBrDate(dataDeal) !== hojeStr) return false;
      } else if (filterStatus === 'GANHO_ONTEM') {
        if (deal.fase !== 'GANHO') return false;
        const dataDeal = deal.dataFechamentoReal || deal.updatedAt;
        if (!dataDeal || formatBrDate(dataDeal) !== ontemStr) return false;
      } else if (filterStatus === 'PERDIDO') {
        if (deal.fase !== 'PERDIDO') return false;
      }

      // Filtro textual amplo
      if (filterText) {
        const strBusca = [
          deal.titulo || '',
          deal.clienteNome || '',
          deal.clienteCnpj || '',
          deal.vendedor || '',
          deal.contatoNome || '',
          deal.faturadoPor || '',
          deal.condPgto || '',
          deal.id || '',
          deal.pedidoCompraCliente || ''
        ].join(' ').toLowerCase();

        if (!strBusca.includes(filterText)) return false;
      }

      return true;
    });
  }

  /**
   * Alterna entre modo de visualização Kanban e Listagem com persistência
   */
  function setDealViewMode(mode) {
    dealViewMode = (mode === 'listagem') ? 'listagem' : 'kanban';
    try {
      localStorage.setItem('gsi_crm_deal_view_mode', dealViewMode);
    } catch {}

    const kanbanCont = document.getElementById('crmKanbanContainer');
    const listagemCont = document.getElementById('crmListagemContainer');
    const btnKanban = document.getElementById('btnCrmViewModeKanban');
    const btnListagem = document.getElementById('btnCrmViewModeListagem');

    if (kanbanCont) kanbanCont.classList.toggle('hidden', dealViewMode !== 'kanban');
    if (listagemCont) listagemCont.classList.toggle('hidden', dealViewMode !== 'listagem');

    if (btnKanban) {
      btnKanban.className = `btn btn-sm ${dealViewMode === 'kanban' ? 'btn-primary' : 'btn-outline'}`;
      btnKanban.setAttribute('aria-selected', dealViewMode === 'kanban' ? 'true' : 'false');
    }
    if (btnListagem) {
      btnListagem.className = `btn btn-sm ${dealViewMode === 'listagem' ? 'btn-primary' : 'btn-outline'}`;
      btnListagem.setAttribute('aria-selected', dealViewMode === 'listagem' ? 'true' : 'false');
    }

    renderDealsViews();
  }

  /**
   * Retorna o rótulo legível do estágio
   */
  function getStageDisplayLabel(faseKey) {
    if (!faseKey) return '-';
    if (faseKey === 'GANHO') return 'Ganho';
    if (faseKey === 'PERDIDO') return 'Perdido';
    const f = CANONICAL_STAGES.find(s => s.id === faseKey);
    return f ? f.label : faseKey;
  }

  /**
   * Renderiza a visão em listagem tabular (conforme listagem.png e Pilar 1 do GEMINI.md)
   */
  function renderListagemBoard(filteredDeals) {
    const tbody = document.getElementById('crmDealsTableTbody');
    const contadorEl = document.getElementById('crmListagemContador');
    const valorTotalEl = document.getElementById('crmListagemValorTotal');
    const pageNumEl = document.getElementById('crmDealsCurrentPage');
    const totalPagesEl = document.getElementById('crmDealsTotalPages');
    const btnPrev = document.getElementById('btnCrmDealsPrev');
    const btnNext = document.getElementById('btnCrmDealsNext');
    if (!tbody) return;

    const rawItems = Array.isArray(filteredDeals) ? filteredDeals : getFilteredDeals();
    const items = (rawItems || []).filter(Boolean);
    const totalItems = items.length;

    // Cálculo da paginação compulsória (Pilar 1)
    const totalPages = Math.max(1, Math.ceil(totalItems / dealsPerPage));
    if (dealsPage > totalPages) dealsPage = totalPages;
    if (dealsPage < 1) dealsPage = 1;

    const startIndex = (dealsPage - 1) * dealsPerPage;
    const pagedItems = items.slice(startIndex, startIndex + dealsPerPage);

    // Atualiza controles da paginação
    if (pageNumEl) pageNumEl.textContent = dealsPage;
    if (totalPagesEl) totalPagesEl.textContent = totalPages;
    if (btnPrev) btnPrev.disabled = (dealsPage <= 1);
    if (btnNext) btnNext.disabled = (dealsPage >= totalPages);

    if (totalItems === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align: center; padding: 2.5rem 1rem; color: var(--text-muted);">
            Nenhuma oportunidade encontrada com os filtros selecionados.
          </td>
        </tr>
      `;
      if (contadorEl) contadorEl.textContent = '0 oportunidades listadas';
      if (valorTotalEl) valorTotalEl.textContent = 'Total: R$ 0,00';
      return;
    }

    let somaValor = 0;
    items.forEach(d => {
      somaValor += (parseFloat(d.valor) || 0);
    });

    tbody.innerHTML = pagedItems.map(d => {
      const statusLabel = getStageDisplayLabel(d.fase);
      const isGanho = d.fase === 'GANHO';
      const isPerdido = d.fase === 'PERDIDO';
      const statusColor = isGanho ? '#10b981' : (isPerdido ? '#ef4444' : 'var(--text-main)');

      return `
        <tr style="border-bottom: 1px solid var(--panel-border); transition: background-color 0.15s ease;">
          <td style="text-align: center; padding: 6px 8px; white-space: nowrap;">
            <div style="display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
              <button type="button" class="btn btn-outline btn-sm btn-deal-action-edit" data-deal-id="${escapeHtml(d.id)}" title="Editar Oportunidade" style="padding: 2px 6px; font-size: 0.85rem; line-height: 1; height: 26px; width: 26px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 4px;" aria-label="Editar Oportunidade">✏️</button>
              <button type="button" class="btn btn-outline btn-sm btn-deal-action-view" data-deal-id="${escapeHtml(d.id)}" title="Visualizar Oportunidade" style="padding: 2px 6px; font-size: 0.85rem; line-height: 1; height: 26px; width: 26px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 4px;" aria-label="Visualizar Oportunidade">🔍</button>
            </div>
          </td>
          <td style="padding: 10px 12px;">
            <a href="#" class="crm-deal-link" data-deal-id="${escapeHtml(d.id)}" style="color: #10b981; font-weight: 600; text-decoration: none;" title="Abrir detalhes de ${escapeHtml(d.titulo)}">
              ${escapeHtml(d.titulo || 'Sem título')}
            </a>
          </td>
          <td style="padding: 10px 12px; color: #10b981; font-weight: 700; white-space: nowrap;">
            ${formatCurrency(d.valor)}
          </td>
          <td style="padding: 10px 12px; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(d.clienteNome || '-')}">
            ${escapeHtml(d.clienteNome || '-')}
          </td>
          <td style="padding: 10px 12px; white-space: nowrap;">
            <span style="color: ${statusColor}; font-weight: ${isGanho ? '600' : 'normal'};">
              ${escapeHtml(statusLabel)}
            </span>
          </td>
          <td style="padding: 10px 12px; white-space: nowrap; color: var(--text-muted);">
            ${escapeHtml(d.faturadoPor || '-')}
          </td>
          <td style="padding: 10px 12px; white-space: nowrap; color: var(--text-muted);" title="${escapeHtml(d.condPgto || '-')}">
            ${escapeHtml(d.condPgto || '-')}
          </td>
          <td style="padding: 10px 12px; white-space: nowrap;">
            <a href="#" class="crm-deal-link" data-deal-id="${escapeHtml(d.id)}" style="color: #10b981; font-weight: 700; text-decoration: none;" title="Abrir oportunidade #${escapeHtml(d.id)}">
              ${escapeHtml(d.id)}
            </a>
          </td>
          <td style="padding: 10px 12px; white-space: nowrap;">
            ${escapeHtml(d.vendedor || '-')}
          </td>
        </tr>
      `;
    }).join('');

    if (contadorEl) {
      const endItem = Math.min(startIndex + dealsPerPage, totalItems);
      contadorEl.textContent = `${totalItems} oportunidade${totalItems === 1 ? '' : 's'} (exibindo ${startIndex + 1}–${endItem})`;
    }
    if (valorTotalEl) {
      valorTotalEl.textContent = `Total: ${formatCurrency(somaValor)}`;
    }

    // Delegação de cliques única no tbody
    if (!tbody._hasClickListener) {
      tbody._hasClickListener = true;
      tbody.addEventListener('click', (e) => {
        const btnEdit = e.target.closest('.btn-deal-action-edit');
        if (btnEdit) {
          e.preventDefault();
          e.stopPropagation();
          const dealId = btnEdit.getAttribute('data-deal-id');
          if (dealId) openEditDealModal(dealId);
          return;
        }

        const btnView = e.target.closest('.btn-deal-action-view');
        if (btnView) {
          e.preventDefault();
          e.stopPropagation();
          const dealId = btnView.getAttribute('data-deal-id');
          if (dealId) openDealDetailsModal(dealId);
          return;
        }

        const link = e.target.closest('.crm-deal-link');
        if (link) {
          e.preventDefault();
          const dealId = link.getAttribute('data-deal-id');
          if (dealId) openDealDetailsModal(dealId);
        }
      });
    }
  }

  /**
   * Atualiza a visão ativa das oportunidades e os KPIs (sem custo duplo de renderização)
   */
  function renderDealsViews() {
    const filtered = getFilteredDeals();
    if (dealViewMode === 'kanban') {
      renderKanbanBoard(filtered);
    } else {
      renderListagemBoard(filtered);
    }
    updateTopKpis();
  }

  /**
   * Renderiza os cards nos 5 estágios canônicos e atualiza contadores
   */
  function renderKanbanBoard(filteredDeals) {
    // Limpa colunas
    CANONICAL_STAGES.forEach(stage => {
      const colCards = document.getElementById(`crmCards-${stage.id}`);
      if (colCards) colCards.innerHTML = '';
    });

    // Mapeamento de métricas por fase
    const stats = {};
    CANONICAL_STAGES.forEach(s => {
      stats[s.id] = { count: 0, sum: 0 };
    });

    const items = Array.isArray(filteredDeals) ? filteredDeals : getFilteredDeals();

    // Popula cards
    items.forEach(deal => {
      const faseKey = deal.fase || 'LEAD';
      const colCards = document.getElementById(`crmCards-${faseKey}`);
      
      if (stats[faseKey]) {
        stats[faseKey].count += 1;
        stats[faseKey].sum += (parseFloat(deal.valor) || 0);
      }

      if (colCards) {
        const cardElem = createCardElement(deal);
        colCards.appendChild(cardElem);
      }
    });

    // Atualiza contadores dos cabeçalhos das colunas
    CANONICAL_STAGES.forEach(stage => {
      const countEl = document.getElementById(`crmCount-${stage.id}`);
      const sumEl = document.getElementById(`crmSum-${stage.id}`);
      const s = stats[stage.id] || { count: 0, sum: 0 };

      if (countEl) countEl.textContent = `${s.count} neg.`;
      if (sumEl) sumEl.textContent = formatCurrency(s.sum);
    });

    // Mostra mensagem vazia se a coluna não tiver cards
    CANONICAL_STAGES.forEach(stage => {
      const colCards = document.getElementById(`crmCards-${stage.id}`);
      if (colCards && colCards.children.length === 0) {
        colCards.innerHTML = `
          <div class="crm-empty-col">
            <span>Nenhum negócio nesta fase</span>
          </div>
        `;
      }
    });
  }

  /**
   * Cria o elemento visual do Card com Drag and Drop e Sanitização
   */
  function createCardElement(deal) {
    const card = document.createElement('div');
    card.className = 'crm-card';
    card.id = `crm-card-${deal.id}`;
    card.setAttribute('draggable', 'true');
    card.setAttribute('data-deal-id', deal.id);

    const alertBadge = getDealAlertBadge(deal);
    const dataCriacao = formatDate(deal.createdAt || deal.dataCriacao);

    card.innerHTML = `
      <div class="crm-card-header">
        <span class="crm-card-title" title="${escapeHtml(deal.titulo)}">${escapeHtml(deal.titulo)}</span>
        <div class="crm-card-badge-wrap">${alertBadge}</div>
      </div>
      
      <div class="crm-card-client" title="Cliente: ${escapeHtml(deal.clienteNome)}">
        <span class="crm-icon-client">🏢</span>
        <strong>${escapeHtml(deal.clienteNome || 'Cliente não identificado')}</strong>
      </div>

      <div class="crm-card-meta-row">
        <div class="crm-card-value">
          ${formatCurrency(deal.valor)}
        </div>
        <div class="crm-card-vendor" title="Vendedor: ${escapeHtml(deal.vendedor)}">
          <span class="crm-vendor-avatar">${escapeHtml((deal.vendedor || 'U').charAt(0).toUpperCase())}</span>
          <span>${escapeHtml(deal.vendedor || '-')}</span>
        </div>
      </div>

      <div class="crm-card-footer">
        <span class="crm-card-date">📅 ${escapeHtml(dataCriacao)}</span>
        <div class="crm-card-actions">
          <button type="button" class="btn-crm-card-action btn-edit-deal" title="Editar Oportunidade" data-id="${escapeHtml(deal.id)}">✏️</button>
          <button type="button" class="btn-crm-card-action btn-view-deal" title="Ver Detalhes / Follow-up" data-id="${escapeHtml(deal.id)}">🔍</button>
        </div>
      </div>
    `;

    // Eventos Drag & Drop no Card
    card.addEventListener('dragstart', (e) => {
      draggedDealId = deal.id;
      card.classList.add('dragging');
      e.dataTransfer.setData('text/plain', deal.id);
      e.dataTransfer.effectAllowed = 'move';
    });

    card.addEventListener('dragend', () => {
      draggedDealId = null;
      card.classList.remove('dragging');
      document.querySelectorAll('.crm-kanban-col').forEach(col => {
        col.classList.remove('drag-over');
      });
    });

    // Clique no card (fora de botões) abre os detalhes
    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-crm-card-action')) return;
      openDealDetailsModal(deal.id);
    });

    // Ações dos botões do card
    const btnEdit = card.querySelector('.btn-edit-deal');
    if (btnEdit) {
      btnEdit.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditDealModal(deal.id);
      });
    }

    const btnView = card.querySelector('.btn-view-deal');
    if (btnView) {
      btnView.addEventListener('click', (e) => {
        e.stopPropagation();
        openDealDetailsModal(deal.id);
      });
    }

    return card;
  }

  /**
   * Configura zonas de soltura (Dropzones) do Drag & Drop HTML5
   */
  function setupDragAndDropDropzones() {
    const cols = document.querySelectorAll('.crm-kanban-col');
    cols.forEach(col => {
      col.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        col.classList.add('drag-over');
      });

      col.addEventListener('dragleave', (e) => {
        if (!col.contains(e.relatedTarget)) {
          col.classList.remove('drag-over');
        }
      });

      col.addEventListener('drop', async (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        const dealId = e.dataTransfer.getData('text/plain') || draggedDealId;
        const targetStage = col.getAttribute('data-stage');

        if (dealId && targetStage) {
          await moveDealStage(dealId, targetStage);
        }
      });
    });
  }

  /**
   * Move uma oportunidade para uma nova fase com atualização visual imediata e chamada à API
   */
  async function moveDealStage(dealId, newStage, reasonData = null) {
    const deal = deals.find(d => String(d.id) === String(dealId));
    if (!deal) return;
    if (deal.fase === newStage) return;

    const oldStage = deal.fase;
    deal.fase = newStage;
    deal.updatedAt = new Date().toISOString();

    if (newStage === 'PERDIDO' && reasonData) {
      deal.motivoPerda = reasonData.motivo || '';
      deal.observacoesPerda = reasonData.observacoes || '';
    }

    // Atualização otimista na tela
    saveDealsLocal(deals);
    renderDealsViews();
    updateTopKpis();

    // Registra atividade automática na timeline
    try {
      const user = getCurrentUser();
      const activities = loadActivitiesLocal(deal.id);
      activities.unshift({
        id: 'act-' + Date.now(),
        dealId: deal.id,
        tipo: 'NOTA',
        descricao: `Fase alterada de "${oldStage}" para "${newStage}".` + (deal.motivoPerda ? ` Motivo: ${deal.motivoPerda}` : ''),
        autor: user.name || user.username || 'Sistema',
        createdAt: new Date().toISOString()
      });
      saveActivitiesLocal(deal.id, activities);
    } catch {}

    // Notificação / Feedback visual
    mostrarNotificacao(`Oportunidade movida para "${getStageLabel(newStage)}"`, 'success');

    // Sincroniza com o backend via PATCH /api/bi/crm/deals/:id/stage
    try {
      const token = getToken();
      await fetch(`/api/bi/crm/deals/${encodeURIComponent(dealId)}/stage`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          novoEstagio: newStage.toLowerCase(),
          estagio: newStage.toLowerCase(),
          fase: newStage,
          motivoPerda: deal.motivoPerda || null,
          justificativa: deal.observacoesPerda || null
        })
      });
    } catch (err) {
      console.warn('⚠️ [CRM Comercial] Falha ao persistir transição de fase no backend:', err.message);
    }
  }

  /**
   * Retorna o label humanizado da fase
   */
  function getStageLabel(stageId) {
    const f = CANONICAL_STAGES.find(s => s.id === stageId);
    return f ? f.label : stageId;
  }

  /**
   * Atualiza cartões de KPIs no topo do painel
   */
  function updateTopKpis() {
    const kpiTotalPipeline = document.getElementById('crmKpiTotalPipeline');
    const kpiTotalGanho = document.getElementById('crmKpiTotalGanho');
    const kpiTicketMedio = document.getElementById('crmKpiTicketMedio');
    const kpiTotalDeals = document.getElementById('crmKpiTotalDeals');

    let totalPipeline = 0;
    let totalGanho = 0;
    let countGanhos = 0;
    let countAtivos = 0;

    deals.forEach(d => {
      const v = parseFloat(d.valor) || 0;
      if (d.fase === 'GANHO') {
        totalGanho += v;
        countGanhos += 1;
      } else if (d.fase !== 'PERDIDO') {
        totalPipeline += v;
        countAtivos += 1;
      }
    });

    const ticketMedio = countGanhos > 0 ? (totalGanho / countGanhos) : (countAtivos > 0 ? (totalPipeline / countAtivos) : 0);

    if (kpiTotalPipeline) kpiTotalPipeline.textContent = formatCurrency(totalPipeline);
    if (kpiTotalGanho) kpiTotalGanho.textContent = formatCurrency(totalGanho);
    if (kpiTicketMedio) kpiTicketMedio.textContent = formatCurrency(ticketMedio);
    if (kpiTotalDeals) kpiTotalDeals.textContent = `${deals.length} oportunidades`;
  }

  /**
   * Normaliza o nome da empresa faturadora para compatibilidade com o seletor das 3 empresas
   */
  function normalizeFaturadoPor(val) {
    if (!val) return '';
    const s = String(val).toUpperCase().trim();
    if (s.includes('SELECIONE')) return '';
    if (s.startsWith('14') || s.includes('METAL')) return '14 - METAL PLENO';
    if (s.startsWith('15') || s.includes('GSI')) return '15 - GSI COFRES';
    if (s.startsWith('16') || s.includes('OACO') || s.includes('OAÇO') || s.includes('AÇO')) return '16 - OACO';
    return val;
  }

  /**
   * Valida se os 4 campos obrigatórios do Deal estão preenchidos validamente:
   * 1. Título da Oportunidade
   * 2. Vendedor Responsável
   * 3. Cliente
   * 4. Faturado Por (não pode ser vazio ou 'Selecione a empresa')
   */
  function isDealFormValid() {
    const titulo = (document.getElementById('crmInputTitulo')?.value || '').trim();
    const vendedor = (document.getElementById('crmSelectVendedor')?.value || '').trim();
    const cliente = (document.getElementById('crmInputCliente')?.value || '').trim();
    const faturadoPor = (document.getElementById('crmSelectFaturadoPor')?.value || '').trim();

    const hasTitulo = titulo.length > 0;
    const hasVendedor = vendedor.length > 0 && !vendedor.toLowerCase().includes('selecione');
    const hasCliente = cliente.length > 0;
    const hasFaturado = faturadoPor.length > 0 && !faturadoPor.toLowerCase().includes('selecione');

    return Boolean(hasTitulo && hasVendedor && hasCliente && hasFaturado);
  }

  /**
   * Atualiza dinamicamente o estado do botão Salvar Oportunidade (inativo se faltar algum obrigatório)
   */
  function updateDealSaveButtonState() {
    const btnSalvar = document.getElementById('btnSalvarCrmOportunidade');
    if (!btnSalvar) return;

    // Se estiver salvando em andamento, preserva o estado de processamento
    if (btnSalvar.textContent.includes('Salvando')) return;

    const valid = isDealFormValid();
    btnSalvar.disabled = !valid;
    if (!valid) {
      btnSalvar.title = 'Preencha os campos obrigatórios (*) para habilitar: Título, Vendedor, Cliente e Faturado Por';
    } else {
      btnSalvar.removeAttribute('title');
    }
  }

  /**
   * Abre a modal para criação de uma Nova Oportunidade
   */
  function openNewDealModal() {
    currentDeal = null;
    currentItems = [];

    const modal = document.getElementById('modalCrmOportunidade');
    const title = document.getElementById('modalCrmOportunidadeTitle');
    const form = document.getElementById('formCrmOportunidade');

    if (title) title.textContent = '➕ Nova Oportunidade Comercial';
    if (form) form.reset();

    document.getElementById('crmDealId').value = '';
    document.getElementById('crmInputClienteCod').value = '';
    document.getElementById('crmInputClienteLoja').value = '';
    document.getElementById('crmInputClienteCnpj').value = '';

    const transpCodEl = document.getElementById('crmInputTransportadoraCod');
    if (transpCodEl) transpCodEl.value = '';
    const transpDropdown = document.getElementById('crmTransportadoraDropdown');
    if (transpDropdown) {
      transpDropdown.classList.add('hidden');
      transpDropdown.style.display = 'none';
    }

    const selFaturado = document.getElementById('crmSelectFaturadoPor');
    if (selFaturado) selFaturado.value = '';

    // Vendedor padrão: usuário logado se for vendedor
    const user = getCurrentUser();
    const selectVendedor = document.getElementById('crmSelectVendedor');
    if (selectVendedor && user && user.username) {
      const matched = Array.from(selectVendedor.options).find(opt => opt.value.toLowerCase() === user.username.toLowerCase() || opt.value.toLowerCase() === (user.name || '').toLowerCase());
      if (matched) selectVendedor.value = matched.value;
      else selectVendedor.value = 'Alexandre';
    }

    renderItensCotadosTable();
    updateDealSaveButtonState();
    openModal(modal);
  }

  /**
   * Abre a modal para edição de uma Oportunidade existente
   */
  function openEditDealModal(dealId) {
    const deal = deals.find(d => String(d.id) === String(dealId));
    if (!deal) return;

    currentDeal = deal;
    currentItems = Array.isArray(deal.itens) ? JSON.parse(JSON.stringify(deal.itens)) : [];

    const modal = document.getElementById('modalCrmOportunidade');
    const title = document.getElementById('modalCrmOportunidadeTitle');

    if (title) title.textContent = `✏️ Editar Oportunidade #${escapeHtml(deal.id)}`;

    document.getElementById('crmDealId').value = deal.id || '';
    document.getElementById('crmInputTitulo').value = deal.titulo || '';
    document.getElementById('crmInputCliente').value = deal.clienteNome || '';
    document.getElementById('crmInputClienteCod').value = deal.clienteCod || '';
    document.getElementById('crmInputClienteLoja').value = deal.clienteLoja || '';
    document.getElementById('crmInputClienteCnpj').value = deal.clienteCnpj || '';
    document.getElementById('crmSelectVendedor').value = deal.vendedor || '';
    document.getElementById('crmSelectFase').value = deal.fase || 'LEAD';
    document.getElementById('crmInputValor').value = deal.valor || 0;

    const selFaturado = document.getElementById('crmSelectFaturadoPor');
    if (selFaturado) selFaturado.value = normalizeFaturadoPor(deal.faturadoPor) || '';

    // Campos comerciais
    document.getElementById('crmInputCondPgto').value = deal.condPgto || '28 DDL';
    document.getElementById('crmInputFreteCobrado').value = deal.freteCobrado || 0;
    document.getElementById('crmInputFreteEmbutido').value = deal.freteEmbutido || 0;
    document.getElementById('crmSelectTipoFrete').value = deal.tipoFrete || 'CIF';
    document.getElementById('crmInputTransportadora').value = deal.transportadora || '';
    const editTranspCodEl = document.getElementById('crmInputTransportadoraCod');
    if (editTranspCodEl) {
      editTranspCodEl.value = deal.transportadoraCod || deal.transportadora_cod || deal.custom?.transportadora_cod || deal.custom?.transportadoraCod || '';
    }
    const editTranspDropdown = document.getElementById('crmTransportadoraDropdown');
    if (editTranspDropdown) {
      editTranspDropdown.classList.add('hidden');
      editTranspDropdown.style.display = 'none';
    }
    document.getElementById('crmInputPrazoEntrega').value = deal.prazoEntrega || '';
    document.getElementById('crmInputPedidoCompraCliente').value = deal.pedidoCompraCliente || '';
    document.getElementById('crmInputObsNfe').value = deal.observacoesNfe || '';

    renderItensCotadosTable();
    updateDealSaveButtonState();
    openModal(modal);
  }

  let productAutocompleteDebounceTimer = null;
  let activeProductItemIndex = null;

  /**
   * Obtém ou cria o elemento singleton dropdown flutuante de sugestões de produtos
   */
  function getProductDropdownEl() {
    let dropdown = document.getElementById('crmProductSuggestionsDropdown');
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.id = 'crmProductSuggestionsDropdown';
      dropdown.style.cssText = `
        position: absolute;
        z-index: 10005;
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 8px;
        max-height: 290px;
        overflow-y: auto;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.6), 0 8px 10px -6px rgba(0, 0, 0, 0.6);
        display: none;
        width: 480px;
      `;
      document.body.appendChild(dropdown);

      // Fecha ao clicar fora
      document.addEventListener('click', (e) => {
        if (!dropdown.contains(e.target) && !e.target.classList.contains('crm-item-code') && !e.target.classList.contains('crm-item-desc')) {
          dropdown.style.display = 'none';
        }
      });

      // Fecha ao rolar
      window.addEventListener('scroll', () => { dropdown.style.display = 'none'; }, true);
    }
    return dropdown;
  }

  /**
   * Dispara o autocomplete de produtos Protheus a partir de um input ativo
   */
  function triggerProductAutocomplete(inputEl, itemIndex) {
    clearTimeout(productAutocompleteDebounceTimer);
    const dropdown = getProductDropdownEl();
    const termo = (inputEl.value || '').trim();

    if (termo.length < 2) {
      dropdown.style.display = 'none';
      return;
    }

    activeProductItemIndex = itemIndex;

    productAutocompleteDebounceTimer = setTimeout(async () => {
      try {
        const token = getToken();
        const res = await fetch(`/api/bi/crm/produtos/autocomplete?q=${encodeURIComponent(termo)}`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });

        if (!res.ok) {
          dropdown.style.display = 'none';
          return;
        }

        const data = await res.json();
        const produtos = Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);

        if (produtos.length === 0) {
          dropdown.style.display = 'none';
          return;
        }

        // Posiciona dropdown relativo ao input ativo
        const rect = inputEl.getBoundingClientRect();
        dropdown.style.top = `${rect.bottom + window.scrollY + 4}px`;
        let left = rect.left + window.scrollX;
        if (left + 480 > window.innerWidth) {
          left = window.innerWidth - 490;
        }
        dropdown.style.left = `${Math.max(10, left)}px`;
        dropdown.style.width = '480px';

        dropdown.innerHTML = produtos.map((p, pIdx) => {
          const cod = escapeHtml(p.codigo || '');
          const desc = escapeHtml(p.descricao || '');
          const preco = Number(p.preco_tabela) || 0;
          const peso = Number(p.peso_liquido) || 0;
          const grupo = escapeHtml(p.grupo || '');
          const ncm = escapeHtml(p.ncm || '');
          const um = escapeHtml(p.unidade || 'UN');

          return `
            <div class="crm-prod-suggestion-row" data-pindex="${pIdx}" style="padding: 8px 12px; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.06); transition: background 0.15s ease;">
              <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 2px;">
                <span style="font-family: var(--font-mono, monospace); font-weight: 700; color: #38bdf8; font-size: 0.84rem;">${cod}</span>
                <span style="font-weight: 700; color: #10b981; font-size: 0.84rem;">${formatCurrency(preco)}</span>
              </div>
              <div style="font-size: 0.82rem; color: #f1f5f9; font-weight: 500; margin-bottom: 3px; line-height: 1.25;">${desc}</div>
              <div style="display: flex; gap: 8px; font-size: 0.72rem; color: #94a3b8; align-items: center; flex-wrap: wrap;">
                ${grupo ? `<span style="background: rgba(148, 163, 184, 0.15); padding: 1px 5px; border-radius: 4px;">Grupo: ${grupo}</span>` : ''}
                ${peso > 0 ? `<span>Peso: <strong>${peso.toFixed(2)} kg</strong></span>` : ''}
                ${ncm ? `<span>NCM: <strong>${ncm}</strong></span>` : ''}
              </div>
            </div>
          `;
        }).join('');

        dropdown.style.display = 'block';

        // Hover e seleção de itens
        dropdown.querySelectorAll('.crm-prod-suggestion-row').forEach(row => {
          row.addEventListener('mouseenter', () => {
            row.style.background = 'rgba(56, 189, 248, 0.12)';
          });
          row.addEventListener('mouseleave', () => {
            row.style.background = 'transparent';
          });
          row.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const pIdx = parseInt(row.getAttribute('data-pindex'), 10);
            const selProd = produtos[pIdx];
            if (!selProd || isNaN(activeProductItemIndex) || !currentItems[activeProductItemIndex]) return;

            const idx = activeProductItemIndex;
            const prevTabela = Number(currentItems[idx].precoTabela) || 0;
            const prevNegociado = Number(currentItems[idx].precoNegociado) || 0;
            const novoPrecoTabela = Number(selProd.preco_tabela) || 0;

            currentItems[idx].codigo = selProd.codigo;
            currentItems[idx].descricao = selProd.descricao;
            currentItems[idx].precoTabela = novoPrecoTabela;

            // Se precoNegociado for 0 ou igual ao precoTabela anterior, sugere o novo precoTabela
            if (!prevNegociado || prevNegociado === 0 || prevNegociado === prevTabela) {
              currentItems[idx].precoNegociado = novoPrecoTabela;
            }

            currentItems[idx].ncm = selProd.ncm || '';
            currentItems[idx].pesoLiquido = Number(selProd.peso_liquido) || 0;
            currentItems[idx].pesoBruto = Number(selProd.peso_bruto) || 0;
            currentItems[idx].unidade = selProd.unidade || 'UN';
            currentItems[idx].grupo = selProd.grupo || '';

            dropdown.style.display = 'none';
            renderItensCotadosTable();

            // Auto-focus no campo de quantidade para agilidade
            setTimeout(() => {
              const tbody = document.getElementById('crmTbodyItensCotados');
              if (tbody) {
                const qtdInp = tbody.querySelector(`.crm-item-qtd[data-index="${idx}"]`);
                if (qtdInp) {
                  qtdInp.focus();
                  qtdInp.select();
                }
              }
            }, 60);
          });
        });

      } catch (err) {
        console.warn('⚠️ [CRM Autocomplete] Falha ao buscar produtos:', err.message);
        dropdown.style.display = 'none';
      }
    }, 250);
  }

  /**
   * Renderiza a tabela de itens cotados na modal de cadastro
   */
  function renderItensCotadosTable() {
    const tbody = document.getElementById('crmTbodyItensCotados');
    const totalDisplay = document.getElementById('crmItensCotadosTotalDisplay');
    const pesoDisplay = document.getElementById('crmItensCotadosPesoDisplay');
    const dropdown = getProductDropdownEl();
    dropdown.style.display = 'none';

    if (!tbody) return;

    if (currentItems.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 1.2rem;">
            Nenhum produto adicionado. Clique em "+ Adicionar Item" para incluir produtos cotados.
          </td>
        </tr>
      `;
      if (totalDisplay) totalDisplay.textContent = 'R$ 0,00';
      if (pesoDisplay) pesoDisplay.textContent = '0,000 kg';
      return;
    }

    let sumTotal = 0;
    let sumPeso = 0;
    let html = '';

    currentItems.forEach((item, index) => {
      const qtd = parseFloat(item.quantidade) || 0;
      const pNeg = parseFloat(item.precoNegociado) || 0;
      const pesoLiq = parseFloat(item.pesoLiquido) || parseFloat(item.pesoBruto) || 0;
      const subtotal = qtd * pNeg;
      const pesoTotalItem = qtd * pesoLiq;

      sumTotal += subtotal;
      sumPeso += pesoTotalItem;

      html += `
        <tr>
          <td>
            <input type="text" class="form-control form-control-sm crm-item-code" data-index="${index}" value="${escapeHtml(item.codigo || '')}" placeholder="Cód. Protheus" style="font-family: var(--font-mono); width: 130px;" autocomplete="off" title="Código do produto no Protheus (autocomplete disponível)">
          </td>
          <td>
            <input type="text" class="form-control form-control-sm crm-item-desc" data-index="${index}" value="${escapeHtml(item.descricao || '')}" placeholder="Descrição do produto cotado" style="width: 100%;" autocomplete="off" title="Descrição do produto (digite para buscar no catálogo)">
          </td>
          <td style="width: 55px;">
            <input type="number" min="1" max="999" step="1" class="form-control form-control-sm crm-item-qtd" data-index="${index}" value="${item.quantidade || 1}" style="text-align: right; width: 55px; padding-left: 4px; padding-right: 4px;" title="Quantidade">
          </td>
          <td style="width: 95px;">
            <input type="text" class="form-control form-control-sm crm-item-ptabela" data-index="${index}" value="${formatNumberPtBr(item.precoTabela)}" readonly disabled tabindex="-1" style="text-align: right; width: 95px; background: rgba(148, 163, 184, 0.12) !important; color: #94a3b8 !important; border-color: rgba(148, 163, 184, 0.25) !important; cursor: not-allowed; font-weight: 500;" title="Preço oficial de tabela SB1 (fixo/bloqueado)">
          </td>
          <td style="width: 105px;">
            <input type="text" inputmode="decimal" class="form-control form-control-sm crm-item-pnegociado" data-index="${index}" value="${formatNumberPtBr(item.precoNegociado)}" style="text-align: right; width: 105px; font-weight: 600; color: #38bdf8;" title="Preço negociado com o cliente">
          </td>
          <td style="text-align: right; font-weight: 700; white-space: nowrap; width: 110px;">
            ${formatCurrency(subtotal)}
          </td>
          <td style="text-align: center; width: 45px;">
            <button type="button" class="btn btn-outline btn-sm btn-remover-item" data-index="${index}" title="Remover item" style="padding: 2px 6px; color: #f87171;">✕</button>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
    if (totalDisplay) totalDisplay.textContent = formatCurrency(sumTotal);
    if (pesoDisplay) pesoDisplay.textContent = `${sumPeso.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} kg`;

    // Sincroniza campo total do negócio
    const inputValor = document.getElementById('crmInputValor');
    if (inputValor && sumTotal > 0) {
      inputValor.value = sumTotal.toFixed(2);
    }

    // Attach listeners dos inputs dos itens
    tbody.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('focus', (e) => {
        if (e.target.classList.contains('crm-item-pnegociado') || e.target.classList.contains('crm-item-qtd')) {
          e.target.select();
        }
      });

      inp.addEventListener('blur', (e) => {
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        if (isNaN(idx) || !currentItems[idx]) return;

        if (e.target.classList.contains('crm-item-pnegociado')) {
          e.target.value = formatNumberPtBr(currentItems[idx].precoNegociado);
        }
      });

      inp.addEventListener('input', (e) => {
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        if (isNaN(idx) || !currentItems[idx]) return;

        if (e.target.classList.contains('crm-item-code')) {
          currentItems[idx].codigo = e.target.value;
          triggerProductAutocomplete(e.target, idx);
        }
        if (e.target.classList.contains('crm-item-desc')) {
          currentItems[idx].descricao = e.target.value;
          triggerProductAutocomplete(e.target, idx);
        }
        if (e.target.classList.contains('crm-item-qtd')) {
          currentItems[idx].quantidade = parseFloat(e.target.value) || 1;
        }
        if (e.target.classList.contains('crm-item-pnegociado')) {
          currentItems[idx].precoNegociado = parseNumberPtBr(e.target.value);
        }

        // Recalcula totais e peso
        let newSum = 0;
        let newPeso = 0;
        currentItems.forEach(it => {
          const q = parseFloat(it.quantidade) || 0;
          const p = parseFloat(it.precoNegociado) || 0;
          const w = parseFloat(it.pesoLiquido) || parseFloat(it.pesoBruto) || 0;
          newSum += q * p;
          newPeso += q * w;
        });
        if (totalDisplay) totalDisplay.textContent = formatCurrency(newSum);
        if (pesoDisplay) pesoDisplay.textContent = `${newPeso.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} kg`;
        if (inputValor && newSum > 0) inputValor.value = newSum.toFixed(2);

        // Atualiza a célula de subtotal desta linha em tempo real
        const row = e.target.closest('tr');
        if (row) {
          const totalCell = row.querySelector('td:nth-last-child(2)');
          if (totalCell) {
            const rowQtd = parseFloat(currentItems[idx].quantidade) || 0;
            const rowP = parseFloat(currentItems[idx].precoNegociado) || 0;
            totalCell.textContent = formatCurrency(rowQtd * rowP);
          }
        }
      });
    });

    // Botões remover item
    tbody.querySelectorAll('.btn-remover-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-index'), 10);
        if (!isNaN(idx)) {
          currentItems.splice(idx, 1);
          renderItensCotadosTable();
        }
      });
    });
  }

  /**
   * Adiciona um novo item cotado em branco
   */
  function addItemCotado() {
    currentItems.push({
      codigo: '',
      descricao: '',
      quantidade: 1,
      precoTabela: 0,
      precoNegociado: 0,
      total: 0,
      ncm: '',
      pesoLiquido: 0,
      pesoBruto: 0,
      unidade: 'UN',
      grupo: ''
    });
    renderItensCotadosTable();
    setTimeout(() => {
      const tbody = document.getElementById('crmTbodyItensCotados');
      if (tbody) {
        const lastIdx = currentItems.length - 1;
        const inp = tbody.querySelector(`.crm-item-code[data-index="${lastIdx}"]`);
        if (inp) inp.focus();
      }
    }, 50);
  }

  /**
   * Salva a Oportunidade (Criação ou Edição)
   */
  async function handleSaveOpportunity(e) {
    if (e) e.preventDefault();

    const id = document.getElementById('crmDealId')?.value;
    const titulo = document.getElementById('crmInputTitulo')?.value.trim();
    const clienteNome = document.getElementById('crmInputCliente')?.value.trim();
    const clienteCod = document.getElementById('crmInputClienteCod')?.value.trim();
    const clienteLoja = document.getElementById('crmInputClienteLoja')?.value.trim();
    const clienteCnpj = document.getElementById('crmInputClienteCnpj')?.value.trim();
    const vendedor = document.getElementById('crmSelectVendedor')?.value;
    const fase = document.getElementById('crmSelectFase')?.value || 'LEAD';
    const valor = parseFloat(document.getElementById('crmInputValor')?.value) || 0;

    // Campos comerciais
    const condPgto = document.getElementById('crmInputCondPgto')?.value.trim();
    const freteCobrado = parseFloat(document.getElementById('crmInputFreteCobrado')?.value) || 0;
    const freteEmbutido = parseFloat(document.getElementById('crmInputFreteEmbutido')?.value) || 0;
    const tipoFrete = document.getElementById('crmSelectTipoFrete')?.value || 'CIF';
    const transportadora = document.getElementById('crmInputTransportadora')?.value.trim();
    let transportadoraCod = document.getElementById('crmInputTransportadoraCod')?.value.trim();

    const existingDeal = id ? deals.find(d => String(d.id) === String(id)) : null;

    // Se o deal já tinha código e o nome não mudou, preserva o código existente
    if (transportadora && !transportadoraCod && existingDeal && existingDeal.transportadora === transportadora) {
      transportadoraCod = existingDeal.transportadoraCod || existingDeal.transportadora_cod || existingDeal.custom?.transportadora_cod || existingDeal.custom?.transportadoraCod || '';
      const codInputEl = document.getElementById('crmInputTransportadoraCod');
      if (codInputEl) codInputEl.value = transportadoraCod;
    }

    // Validação Estrita: Transportadora deve existir no Protheus
    if (transportadora && !transportadoraCod) {
      alert('A transportadora indicada deve ser obrigatoriamente selecionada da lista do Protheus.\n\nCaso o cliente deseje uma nova transportadora, solicite o cadastro ao responsável no Protheus e clique em "🔄 Atualizar".');
      document.getElementById('crmInputTransportadora')?.focus();
      return;
    }

    const prazoEntrega = document.getElementById('crmInputPrazoEntrega')?.value.trim();
    const pedidoCompraCliente = document.getElementById('crmInputPedidoCompraCliente')?.value.trim();
    const observacoesNfe = document.getElementById('crmInputObsNfe')?.value.trim();

    if (!titulo) {
      alert('Por favor, informe o título da oportunidade.');
      document.getElementById('crmInputTitulo')?.focus();
      return;
    }
    if (!clienteNome) {
      alert('Por favor, informe o cliente da oportunidade.');
      document.getElementById('crmInputCliente')?.focus();
      return;
    }
    if (!vendedor || vendedor.toLowerCase().includes('selecione')) {
      alert('Por favor, selecione o vendedor responsável.');
      document.getElementById('crmSelectVendedor')?.focus();
      return;
    }

    const rawFaturado = (document.getElementById('crmSelectFaturadoPor')?.value || existingDeal?.faturadoPor || '').trim();
    if (!rawFaturado || rawFaturado.toLowerCase().includes('selecione')) {
      alert('Por favor, selecione a empresa em "Faturado Por: *".\n\nEssa seleção é obrigatória para definir qual empresa faturará a oportunidade.');
      document.getElementById('crmSelectFaturadoPor')?.focus();
      return;
    }
    const faturadoPor = normalizeFaturadoPor(rawFaturado) || rawFaturado;

    const contatoNome = existingDeal?.contatoNome || '';

    const payload = {
      titulo,
      cliente_nome: clienteNome,
      clienteNome,
      contatoNome,
      faturadoPor,
      faturado_por: faturadoPor,
      cliente_cod: clienteCod,
      clienteCod,
      cliente_loja: clienteLoja,
      clienteLoja,
      cliente_cnpj: clienteCnpj,
      clienteCnpj,
      nome_vendedor: vendedor,
      cod_vendedor: vendedor,
      vendedor,
      estagio: fase.toLowerCase(),
      fase,
      valor_total: valor,
      valor,
      cond_pgto: condPgto,
      condPgto,
      frete_cobrado: freteCobrado,
      freteCobrado,
      frete_embutido: freteEmbutido,
      freteEmbutido,
      tipo_frete: tipoFrete,
      tipoFrete,
      transportadora,
      transportadora_cod: transportadoraCod || '',
      transportadoraCod: transportadoraCod || '',
      prazo_entrega: prazoEntrega,
      prazoEntrega,
      num_pedido_compra: pedidoCompraCliente,
      pedidoCompraCliente,
      obs_nfe: observacoesNfe,
      observacoesNfe,
      itens_cotados: currentItems,
      itens: currentItems,
      custom: {
        ...(existingDeal?.custom || {}),
        contatoNome,
        faturadoPor,
        faturado_por: faturadoPor,
        condPgto,
        freteCobrado,
        freteEmbutido,
        tipoFrete,
        transportadora,
        transportadora_cod: transportadoraCod || '',
        transportadoraCod: transportadoraCod || '',
        prazoEntrega,
        pedidoCompraCliente,
        observacoesNfe
      },
      updatedAt: new Date().toISOString()
    };

    const btnSalvar = document.getElementById('btnSalvarCrmOportunidade');
    if (btnSalvar) {
      btnSalvar.disabled = true;
      btnSalvar.textContent = 'Salvando...';
    }

    try {
      const token = getToken();
      const isEditing = Boolean(id);
      const url = isEditing ? `/api/bi/crm/deals/${encodeURIComponent(id)}` : '/api/bi/crm/deals';
      const method = isEditing ? 'PUT' : 'POST';

      let savedDeal = null;

      try {
        const res = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify(payload)
        });

        if (res.ok) {
          const data = await res.json();
          savedDeal = mapDealFromApi(data.data || data.deal || data);
        }
      } catch (e) {
        console.warn('⚠️ [CRM Comercial] Falha na requisição de salvar Deal, usando persistência local.', e.message);
      }

      if (!savedDeal) {
        // Fallback local
        if (isEditing) {
          const idx = deals.findIndex(d => String(d.id) === String(id));
          if (idx !== -1) {
            deals[idx] = { ...deals[idx], ...payload };
            savedDeal = deals[idx];
          }
        } else {
          savedDeal = {
            id: 'crm-' + Date.now(),
            ...payload,
            createdAt: new Date().toISOString()
          };
          deals.unshift(savedDeal);
        }
      } else {
        if (isEditing) {
          const idx = deals.findIndex(d => String(d.id) === String(id));
          if (idx !== -1) deals[idx] = savedDeal;
        } else {
          deals.unshift(savedDeal);
        }
      }

      saveDealsLocal(deals);
      closeModal(document.getElementById('modalCrmOportunidade'), true);
      renderDealsViews();
      updateTopKpis();
      mostrarNotificacao(`Oportunidade "${titulo}" salva com sucesso!`, 'success');
    } catch (err) {
      console.error('Erro ao salvar oportunidade:', err);
      alert('Erro ao salvar oportunidade: ' + err.message);
    } finally {
      if (btnSalvar) {
        btnSalvar.textContent = '💾 Salvar Oportunidade';
        updateDealSaveButtonState();
      }
    }
  }

  /**
   * Abre a Ficha Completa do Negócio com Linha do Tempo / Follow-up
   */
  async function openDealDetailsModal(dealId) {
    const deal = deals.find(d => String(d.id) === String(dealId));
    if (!deal) return;

    currentDeal = deal;
    const modal = document.getElementById('modalCrmDetalhes');

    document.getElementById('crmDetalhesTitulo').textContent = deal.titulo || 'Detalhes da Oportunidade';
    document.getElementById('crmDetalhesCliente').textContent = deal.clienteNome || '-';
    document.getElementById('crmDetalhesValor').textContent = formatCurrency(deal.valor);
    document.getElementById('crmDetalhesVendedor').textContent = deal.vendedor || '-';
    document.getElementById('crmDetalhesFaseBadge').innerHTML = getDealAlertBadge(deal);

    const faturadoTexto = deal.faturadoPor || 'Não informado';
    const elFaturado = document.getElementById('crmDetalhesFaturadoPor');
    if (elFaturado) elFaturado.textContent = faturadoTexto;
    const elFaturadoBadge = document.getElementById('crmDetalhesFaturadoPorBadge');
    if (elFaturadoBadge) elFaturadoBadge.textContent = deal.faturadoPor || '-';

    // Campos comerciais na ficha
    document.getElementById('crmDetalhesCondPgto').textContent = deal.condPgto || 'Não informada';
    document.getElementById('crmDetalhesFrete').textContent = `${deal.tipoFrete || 'CIF'} (Cobrado: ${formatCurrency(deal.freteCobrado)} | Embutido: ${formatCurrency(deal.freteEmbutido)})`;
    document.getElementById('crmDetalhesTransportadora').textContent = deal.transportadora || 'A definir';
    document.getElementById('crmDetalhesPrazo').textContent = deal.prazoEntrega || 'A combinar';
    document.getElementById('crmDetalhesPedidoCliente').textContent = deal.pedidoCompraCliente || '-';
    document.getElementById('crmDetalhesObsNfe').textContent = deal.observacoesNfe || 'Nenhuma observação informada.';

    // Itens cotados na ficha
    const tbody = document.getElementById('crmDetalhesTbodyItens');
    if (tbody) {
      if (!deal.itens || deal.itens.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">Nenhum item cotado nesta oportunidade.</td></tr>';
      } else {
        tbody.innerHTML = deal.itens.map(item => `
          <tr>
            <td><code style="color: #38bdf8; font-weight: 600;">${escapeHtml(item.codigo || '-')}</code></td>
            <td>
              <div style="font-weight: 500;">${escapeHtml(item.descricao || '-')}</div>
              ${(item.ncm || (Number(item.pesoLiquido) > 0)) ? `
                <div style="font-size: 0.70rem; color: #94a3b8; display: flex; gap: 8px; margin-top: 2px;">
                  ${item.ncm ? `<span>NCM: <strong>${escapeHtml(item.ncm)}</strong></span>` : ''}
                  ${Number(item.pesoLiquido) > 0 ? `<span>Peso: <strong>${Number(item.pesoLiquido).toFixed(2)}kg</strong></span>` : ''}
                </div>
              ` : ''}
            </td>
            <td style="text-align: right;">${parseFloat(item.quantidade) || 1}</td>
            <td style="text-align: right;">${formatCurrency(item.precoNegociado)}</td>
            <td style="text-align: right; font-weight: 700;">${formatCurrency((parseFloat(item.quantidade) || 1) * (parseFloat(item.precoNegociado) || 0))}</td>
          </tr>
        `).join('');
      }
    }

    // Carrega a linha do tempo de atividades
    await loadDealActivities(deal.id);

    openModal(modal);
  }

  /**
   * Carrega timeline de atividades do Deal
   */
  async function loadDealActivities(dealId) {
    const container = document.getElementById('crmActivitiesTimeline');
    if (!container) return;

    container.innerHTML = '<div style="text-align: center; padding: 1rem; color: var(--text-muted);">Carregando atividades...</div>';

    let activities = [];

    try {
      const token = getToken();
      const res = await fetch(`/api/bi/crm/deals/${encodeURIComponent(dealId)}/activities`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);
        if (list.length > 0) {
          activities = list.map(a => ({
            id: String(a.id),
            dealId: String(a.deal_id || dealId),
            tipo: (a.tipo || 'NOTA').toUpperCase(),
            descricao: a.descricao || a.assunto || '',
            dataAgendamento: a.data_agendada || null,
            autor: a.responsavel_nome || a.responsavel_usuario || a.autor || 'Alexandre',
            createdAt: a.created_at || a.createdAt || new Date().toISOString()
          }));
        }
      }
    } catch {
      // Fallback
    }

    if (activities.length === 0) {
      activities = loadActivitiesLocal(dealId);
    } else {
      // Sincroniza cache local com os registros oficiais vindos do backend
      saveActivitiesLocal(dealId, activities);
    }

    const sortedActivities = sortActivitiesDesc(activities);
    renderActivitiesList(sortedActivities);
  }

  /**
   * Renderiza a lista visual da linha do tempo em ordem estritamente decrescente
   */
  function renderActivitiesList(activities) {
    const container = document.getElementById('crmActivitiesTimeline');
    if (!container) return;

    // Defesa em camadas: garante sempre ordem decrescente (mais recente no topo)
    const sortedActivities = sortActivitiesDesc(activities);

    if (!sortedActivities || sortedActivities.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 2rem 1rem; color: var(--text-muted);">
          <span>Nenhuma interação registrada ainda. Utilize o formulário acima para registrar anotações, ligações ou contatos.</span>
        </div>
      `;
      return;
    }

    const typeIcons = {
      'NOTA': '📝',
      'LIGACAO': '📞',
      'REUNIAO': '🤝',
      'WHATSAPP': '💬',
      'TAREFA': '📅'
    };

    const typeLabels = {
      'NOTA': 'Anotação Interna',
      'LIGACAO': 'Ligação Telefônica',
      'REUNIAO': 'Reunião Realizada',
      'WHATSAPP': 'Contato WhatsApp',
      'TAREFA': 'Agendamento / Tarefa'
    };

    container.innerHTML = sortedActivities.map(act => {
      const icon = typeIcons[act.tipo] || '📌';
      const label = typeLabels[act.tipo] || act.tipo || 'Atividade';
      const dt = formatDateTime(act.createdAt || act.data);

      return `
        <div class="crm-timeline-item">
          <div class="crm-timeline-badge">${icon}</div>
          <div class="crm-timeline-content">
            <div class="crm-timeline-header">
              <strong>${escapeHtml(label)}</strong>
              <span class="crm-timeline-meta">${escapeHtml(act.autor || 'Usuário')} em ${escapeHtml(dt)}</span>
            </div>
            <div class="crm-timeline-body">
              ${escapeHtml(act.descricao || act.texto || '')}
            </div>
            ${act.dataAgendamento ? `
              <div class="crm-timeline-schedule">
                ⏰ Retorno previsto: <strong>${escapeHtml(formatDateTime(act.dataAgendamento))}</strong>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  /**
   * Registra uma nova atividade de follow-up na oportunidade atual
   */
  async function handleAddActivity(e) {
    if (e) e.preventDefault();
    if (!currentDeal) return;

    const tipoSelect = document.getElementById('crmActivityType');
    const descInput = document.getElementById('crmActivityDesc');
    const scheduleInput = document.getElementById('crmActivityDataAgendamento');
    const btnSubmit = document.getElementById('btnCrmRegistrarAtividade');

    const tipo = tipoSelect?.value || 'NOTA';
    const descricao = descInput?.value.trim();
    const dataAgendamento = scheduleInput?.value || null;

    if (!descricao) {
      alert('Por favor, informe a descrição ou anotações da atividade.');
      descInput?.focus();
      return;
    }

    const user = getCurrentUser();
    const newActivity = {
      id: 'act-' + Date.now(),
      dealId: currentDeal.id,
      tipo: tipo.toUpperCase(),
      assunto: descricao.slice(0, 60) || 'Interação CRM',
      descricao,
      data_agendada: dataAgendamento || null,
      dataAgendamento,
      autor: user.name || user.username || 'Alexandre',
      createdAt: new Date().toISOString()
    };

    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.textContent = 'Gravando...';
    }

    try {
      const token = getToken();
      let backendAct = null;
      try {
        const res = await fetch(`/api/bi/crm/deals/${encodeURIComponent(currentDeal.id)}/activities`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            tipo: tipo.toLowerCase(),
            assunto: newActivity.assunto,
            descricao: newActivity.descricao,
            data_agendada: newActivity.dataAgendamento
          })
        });
        if (res.ok) {
          const json = await res.json();
          if (json && json.data) {
            backendAct = json.data;
          }
        }
      } catch (err) {
        console.warn('⚠️ [CRM Comercial] Falha ao registrar atividade no backend, salvando em cache local:', err.message);
      }

      if (backendAct) {
        newActivity.id = String(backendAct.id || newActivity.id);
        newActivity.createdAt = backendAct.created_at || backendAct.createdAt || newActivity.createdAt;
      }

      // Persistência local garantindo ordenação estritamente decrescente (mais recente no topo)
      const list = loadActivitiesLocal(currentDeal.id);
      list.unshift(newActivity);
      const sorted = sortActivitiesDesc(list);
      saveActivitiesLocal(currentDeal.id, sorted);

      // Limpa campos do formulário
      if (descInput) descInput.value = '';
      if (scheduleInput) scheduleInput.value = '';

      // Atualiza timeline imediatamente com a anotação mais recente no topo
      renderActivitiesList(sorted);
      mostrarNotificacao('Interação registrada na linha do tempo com sucesso!', 'success');
    } catch (err) {
      alert('Erro ao registrar atividade: ' + err.message);
    } finally {
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.textContent = '➕ Registrar Atividade';
      }
    }
  }

  /**
   * Abre a modal para marcar uma oportunidade como Perdida
   */
  function openMarkLostModal(dealId) {
    const deal = deals.find(d => String(d.id) === String(dealId));
    if (!deal) return;

    document.getElementById('crmPerdidoDealId').value = deal.id;
    document.getElementById('crmSelectMotivoPerda').value = 'Preço elevado';
    document.getElementById('crmInputObsPerda').value = '';

    openModal(document.getElementById('modalCrmPerdido'));
  }

  /**
   * Confirma a perda da oportunidade com motivo obrigatório
   */
  async function handleConfirmLost(e) {
    if (e) e.preventDefault();
    const dealId = document.getElementById('crmPerdidoDealId')?.value;
    const motivo = document.getElementById('crmSelectMotivoPerda')?.value || 'Outro';
    const observacoes = document.getElementById('crmInputObsPerda')?.value.trim() || '';

    if (!dealId) return;

    await moveDealStage(dealId, 'PERDIDO', { motivo, observacoes });
    closeModal(document.getElementById('modalCrmPerdido'));
    closeModal(document.getElementById('modalCrmDetalhes'));
  }

  /**
   * Autocomplete de Clientes buscando no Protheus ERP (/api/bi/crm/clientes/autocomplete)
   */
  function setupClientAutocomplete() {
    const inputCliente = document.getElementById('crmInputCliente');
    const dropdown = document.getElementById('crmClienteSuggestions');
    if (!inputCliente || !dropdown) return;

    inputCliente.addEventListener('input', () => {
      clearTimeout(autocompleteDebounceTimer);
      const q = inputCliente.value.trim();

      if (q.length < 2) {
        dropdown.classList.add('hidden');
        dropdown.style.display = 'none';
        return;
      }

      autocompleteDebounceTimer = setTimeout(async () => {
        try {
          const token = getToken();
          const res = await fetch(`/api/bi/crm/clientes/autocomplete?q=${encodeURIComponent(q)}&termo=${encodeURIComponent(q)}`, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
          });

          let items = [];
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data)) items = data;
            else if (data && Array.isArray(data.data)) items = data.data;
            else if (data && Array.isArray(data.clientes)) items = data.clientes;
          }

          // Se a API não responder com itens, gera sugestão baseada em negócios existentes
          if (items.length === 0) {
            const matchLocal = deals
              .filter(d => (d.clienteNome || '').toLowerCase().includes(q.toLowerCase()))
              .map(d => ({
                cod: d.clienteCod || '',
                loja: d.clienteLoja || '01',
                nome: d.clienteNome,
                cnpj: d.clienteCnpj || ''
              }));
            items = matchLocal.slice(0, 5);
          }

          if (items.length > 0) {
            dropdown.innerHTML = items.map(cli => {
              const cod = cli.cod || cli.codigo || cli.cliente_cod || cli.A1_COD || '';
              const loja = cli.loja || cli.cliente_loja || cli.A1_LOJA || '01';
              const nome = cli.nome || cli.nome_fantasia || cli.razao_social || cli.razaoSocial || cli.A1_NOME || '';
              const cnpj = cli.cnpj || cli.cpf || cli.cliente_cnpj || cli.A1_CGC || '';
              const isCrm = (cli.origem_fonte === 'CRM') || (cli.is_novo_crm === true) || (!cod || String(cod).startsWith('CLI-'));
              const badgeOrigem = isCrm
                ? '<span class="crm-badge-crm" style="font-size: 0.68rem; padding: 1px 6px; margin-left: 6px;">[CRM]</span>'
                : '<span class="crm-badge-protheus" style="font-size: 0.68rem; padding: 1px 6px; margin-left: 6px;">[Protheus]</span>';

              return `
                <div class="crm-autocomplete-item" data-cod="${escapeHtml(cod)}" data-loja="${escapeHtml(loja)}" data-nome="${escapeHtml(nome)}" data-cnpj="${escapeHtml(cnpj)}">
                  <div style="font-weight: 600; color: var(--text-main); display: flex; align-items: center;">
                    <span>${escapeHtml(nome)}</span>
                    ${badgeOrigem}
                  </div>
                  <div style="font-size: 0.78rem; color: var(--text-muted); font-family: var(--font-mono, monospace);">
                    ${cod ? `Cód: ${escapeHtml(cod)}-${escapeHtml(loja)} | ` : ''}${cnpj ? `CNPJ/CPF: ${escapeHtml(cnpj)}` : ''}
                  </div>
                </div>
              `;
            }).join('');

            dropdown.classList.remove('hidden');
            dropdown.style.display = 'block';

            dropdown.querySelectorAll('.crm-autocomplete-item').forEach(itemEl => {
              itemEl.addEventListener('click', () => {
                inputCliente.value = itemEl.getAttribute('data-nome');
                document.getElementById('crmInputClienteCod').value = itemEl.getAttribute('data-cod') || '';
                document.getElementById('crmInputClienteLoja').value = itemEl.getAttribute('data-loja') || '01';
                document.getElementById('crmInputClienteCnpj').value = itemEl.getAttribute('data-cnpj') || '';
                dropdown.classList.add('hidden');
                dropdown.style.display = 'none';
                updateDealSaveButtonState();
              });
            });
          } else {
            dropdown.classList.add('hidden');
            dropdown.style.display = 'none';
          }
        } catch {
          dropdown.classList.add('hidden');
          dropdown.style.display = 'none';
        }
      }, 300);
    });

    // Fecha ao clicar fora
    document.addEventListener('click', (e) => {
      if (!inputCliente.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.add('hidden');
        dropdown.style.display = 'none';
      }
    });
  }

  let transportadoraDebounceTimer = null;

  /**
   * Autocomplete de Transportadoras homologadas no Protheus (/api/bi/crm/transportadoras/autocomplete)
   */
  function setupTransportadoraAutocomplete() {
    const inputTransp = document.getElementById('crmInputTransportadora');
    const inputTranspCod = document.getElementById('crmInputTransportadoraCod');
    const dropdown = document.getElementById('crmTransportadoraDropdown');
    const btnSync = document.getElementById('btnCrmSyncTransportadoras');
    if (!inputTransp || !dropdown) return;

    inputTransp.addEventListener('input', () => {
      clearTimeout(transportadoraDebounceTimer);
      const q = inputTransp.value.trim();

      if (!q) {
        if (inputTranspCod) inputTranspCod.value = '';
        dropdown.classList.add('hidden');
        dropdown.style.display = 'none';
        return;
      }

      // Se o usuário alterou o texto, limpa o código vinculado para forçar seleção válida
      if (inputTranspCod) inputTranspCod.value = '';

      transportadoraDebounceTimer = setTimeout(async () => {
        try {
          const token = getToken();
          const res = await fetch(`/api/bi/crm/transportadoras/autocomplete?q=${encodeURIComponent(q)}&limite=15`, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
          });

          let items = [];
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data)) items = data;
            else if (data && Array.isArray(data.data)) items = data.data;
          }

          if (items.length > 0) {
            dropdown.innerHTML = items.map(t => {
              const cod = t.codigo || '';
              const nome = t.nome || '';
              const fantasia = t.fantasia || '';
              const cidadeUf = t.cidade_uf || '';
              const cnpjFmt = t.cnpj_fmt || '';
              const bloqueado = Boolean(t.bloqueado);

              const subText = [cidadeUf, cnpjFmt].filter(Boolean).join(' | ');

              return `
                <div class="crm-autocomplete-item ${bloqueado ? 'crm-item-bloqueado' : ''}" 
                     data-cod="${escapeHtml(cod)}" 
                     data-nome="${escapeHtml(nome)}" 
                     data-bloqueado="${bloqueado}"
                     style="padding: 8px 12px; cursor: ${bloqueado ? 'not-allowed' : 'pointer'}; border-bottom: 1px solid rgba(255,255,255,0.05); opacity: ${bloqueado ? '0.6' : '1'};">
                  <div style="font-weight: 600; color: var(--text-main); display: flex; align-items: center; justify-content: space-between;">
                    <span>${escapeHtml(nome)}</span>
                    ${bloqueado ? '<span style="font-size: 0.68rem; color: #ef4444; background: rgba(239,68,68,0.15); padding: 1px 6px; border-radius: 4px;">Bloqueada</span>' : ''}
                  </div>
                  ${fantasia && fantasia !== nome ? `<div style="font-size: 0.78rem; color: var(--text-muted);">${escapeHtml(fantasia)}</div>` : ''}
                  ${subText ? `<div style="font-size: 0.75rem; color: var(--text-muted); font-family: var(--font-mono, monospace);">${escapeHtml(subText)}</div>` : ''}
                </div>
              `;
            }).join('');

            dropdown.classList.remove('hidden');
            dropdown.style.display = 'block';

            dropdown.querySelectorAll('.crm-autocomplete-item').forEach(itemEl => {
              itemEl.addEventListener('click', () => {
                if (itemEl.getAttribute('data-bloqueado') === 'true') {
                  alert('Esta transportadora está bloqueada no Protheus e não pode ser vinculada.');
                  return;
                }
                const selectedNome = itemEl.getAttribute('data-nome');
                const selectedCod = itemEl.getAttribute('data-cod');
                inputTransp.value = selectedNome;
                if (inputTranspCod) inputTranspCod.value = selectedCod;
                dropdown.classList.add('hidden');
                dropdown.style.display = 'none';
              });
            });
          } else {
            dropdown.innerHTML = `
              <div style="padding: 10px; font-size: 0.82rem; color: var(--text-muted); text-align: center;">
                Nenhuma transportadora encontrada no Protheus.<br>
                <span style="font-size: 0.75rem; color: #f59e0b;">Solicite o cadastro ao responsável e clique em "Atualizar".</span>
              </div>
            `;
            dropdown.classList.remove('hidden');
            dropdown.style.display = 'block';
          }
        } catch {
          dropdown.classList.add('hidden');
          dropdown.style.display = 'none';
        }
      }, 250);
    });

    // Fecha ao clicar fora
    document.addEventListener('click', (e) => {
      if (!inputTransp.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.classList.add('hidden');
        dropdown.style.display = 'none';
      }
    });

    // Botão de sincronização manual com o Protheus
    if (btnSync && !btnSync._hasSyncListener) {
      btnSync._hasSyncListener = true;
      btnSync.addEventListener('click', async (e) => {
        e.preventDefault();
        const origText = btnSync.innerHTML;
        btnSync.disabled = true;
        btnSync.innerHTML = '⏳ Atualizando...';

        try {
          const token = getToken();
          const res = await fetch('/api/bi/crm/transportadoras/sync', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            }
          });

          const data = await res.json();
          if (res.ok && data.success) {
            alert(`Transportadoras sincronizadas com sucesso com o Protheus (${data.data?.total_transportadoras || 0} carregadas).`);
          } else {
            alert(`Aviso ao atualizar transportadoras: ${data.message || 'Falha de comunicação'}`);
          }
        } catch (err) {
          alert(`Erro ao sincronizar transportadoras: ${err.message}`);
        } finally {
          btnSync.disabled = false;
          btnSync.innerHTML = origText;
        }
      });
    }
  }

  /**
   * Configura busca automática de endereço pelo CEP ao digitar e teclar TAB ou sair do campo.
   * Preenche Logradouro, Bairro, Cidade e UF, mantendo Número e Complemento livres para digitação.
   */
  function setupCepAutoLookup() {
    const cepInput = document.getElementById('crmClienteCep');
    const statusSpan = document.getElementById('crmCepLookupStatus');
    if (!cepInput || cepInput._hasCepListener) return;
    cepInput._hasCepListener = true;

    let lastCheckedCep = '';
    let isFetching = false;

    async function buscarCep() {
      const rawVal = cepInput.value || '';
      const digits = rawVal.replace(/\D/g, '').slice(0, 8);
      if (digits.length !== 8) return;
      if (digits === lastCheckedCep || isFetching) return;

      isFetching = true;
      lastCheckedCep = digits;
      cepInput.value = `${digits.slice(0, 5)}-${digits.slice(5)}`;

      if (statusSpan) {
        statusSpan.style.display = 'inline';
        statusSpan.textContent = '⏳ Buscando...';
        statusSpan.style.color = '#38bdf8';
      }

      try {
        let data = null;
        const token = getToken();

        // 1. Tenta rota interna do backend (com cache e RLS)
        try {
          const res = await fetch(`/api/bi/crm/cep/${digits}`, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {}
          });
          if (res.ok) {
            const json = await res.json();
            if (json.success && json.data) {
              data = json.data;
            }
          }
        } catch {}

        // 2. Fallback resiliente direto no ViaCEP se a rota interna falhou
        if (!data) {
          const resDirect = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
          if (resDirect.ok) {
            const jsonDirect = await resDirect.json();
            if (!jsonDirect.erro) {
              data = {
                logradouro: jsonDirect.logradouro || '',
                bairro: jsonDirect.bairro || '',
                cidade: jsonDirect.localidade || '',
                uf: jsonDirect.uf || ''
              };
            }
          }
        }

        if (data) {
          const inpLog = document.getElementById('crmClienteLogradouro');
          const inpBairro = document.getElementById('crmClienteBairro');
          const inpCidade = document.getElementById('crmClienteCidade');
          const inpUf = document.getElementById('crmClienteUf');
          const details = document.getElementById('crmClienteDetailsEndereco');
          const inpNum = document.getElementById('crmClienteNumero');

          if (inpLog) inpLog.value = data.logradouro || '';
          if (inpBairro) inpBairro.value = data.bairro || '';
          if (inpCidade) inpCidade.value = data.cidade || data.localidade || '';
          if (inpUf) inpUf.value = (data.uf || '').toUpperCase();

          // Abre a seção retrátil de endereço caso esteja colapsada
          if (details) details.open = true;

          if (statusSpan) {
            statusSpan.textContent = '✅ Endereço preenchido';
            statusSpan.style.color = '#10b981';
            setTimeout(() => {
              if (statusSpan) statusSpan.style.display = 'none';
            }, 3000);
          }

          // Foca automaticamente no campo Número para digitação contínua
          if (inpNum && !inpNum.value) {
            setTimeout(() => {
              try { inpNum.focus(); } catch {}
            }, 60);
          }
        } else {
          if (statusSpan) {
            statusSpan.textContent = '⚠️ Não localizado';
            statusSpan.style.color = '#f59e0b';
            setTimeout(() => {
              if (statusSpan) statusSpan.style.display = 'none';
            }, 3000);
          }
        }
      } catch (err) {
        console.warn('⚠️ [CRM] Falha ao consultar CEP:', err);
        if (statusSpan) {
          statusSpan.textContent = '⚠️ Erro na consulta';
          statusSpan.style.color = '#ef4444';
          setTimeout(() => {
            if (statusSpan) statusSpan.style.display = 'none';
          }, 3000);
        }
      } finally {
        isFetching = false;
      }
    }

    // Eventos: blur, change e keydown (Tab / Enter)
    cepInput.addEventListener('blur', buscarCep);
    cepInput.addEventListener('change', buscarCep);
    cepInput.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' || e.key === 'Enter') {
        const digits = (cepInput.value || '').replace(/\D/g, '');
        if (digits.length === 8) {
          buscarCep();
        }
      }
    });

    // Máscara dinâmica durante digitação
    cepInput.addEventListener('input', () => {
      let v = cepInput.value.replace(/\D/g, '').slice(0, 8);
      if (v.length > 5) {
        cepInput.value = `${v.slice(0, 5)}-${v.slice(5)}`;
      } else {
        cepInput.value = v;
      }
      if (v.length < 8) {
        lastCheckedCep = '';
        if (statusSpan) statusSpan.style.display = 'none';
      }
    });
  }

  /**
   * Configura o botão de sincronização manual do catálogo de produtos Protheus (SB1090/SB1160)
   */
  function setupProductSyncButton() {
    const btnSync = document.getElementById('btnCrmSyncProdutos');
    if (!btnSync || btnSync._hasProductSyncListener) return;
    btnSync._hasProductSyncListener = true;

    btnSync.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        const token = getToken();
        btnSync.disabled = true;
        const origHtml = btnSync.innerHTML;
        btnSync.innerHTML = '⏳ Sincronizando...';

        const res = await fetch('/api/bi/crm/produtos/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          }
        });

        const data = await res.json();
        btnSync.disabled = false;
        btnSync.innerHTML = origHtml;

        if (res.ok && data.success) {
          const meta = data.data || {};
          mostrarNotificacao(`Catálogo Protheus sincronizado! Total: ${meta.total_produtos || 0} produtos (${meta.produtos_ativos || 0} ativos) em ${meta.duracao_ms || 0}ms.`, 'sucesso');
        } else {
          mostrarNotificacao(data.message || 'Erro ao sincronizar catálogo de produtos.', 'erro');
        }
      } catch (err) {
        btnSync.disabled = false;
        btnSync.innerHTML = '🔄 Sync Produtos';
        mostrarNotificacao(`Falha na comunicação: ${err.message}`, 'erro');
      }
    });
  }

  // ============================================================================
  // GESTÃO DE CLIENTES CADASTRO & CARTEIRA COMERCIAL
  // ============================================================================

  /**
   * Alterna entre a visão Kanban de Oportunidades e a visão de Clientes Cadastrados
   */
  function switchCrmView(view) {
    activeView = view === 'clientes' ? 'clientes' : 'kanban';

    const btnKanban = document.getElementById('btnCrmViewKanban');
    const btnClientes = document.getElementById('btnCrmViewClientes');
    const containerKanban = document.getElementById('crmViewKanbanContainer');
    const containerClientes = document.getElementById('crmViewClientesContainer');

    if (activeView === 'kanban') {
      if (btnKanban) {
        btnKanban.classList.remove('btn-outline');
        btnKanban.classList.add('btn-primary');
        btnKanban.setAttribute('aria-pressed', 'true');
      }
      if (btnClientes) {
        btnClientes.classList.remove('btn-primary');
        btnClientes.classList.add('btn-outline');
        btnClientes.setAttribute('aria-pressed', 'false');
      }
      if (containerKanban) {
        containerKanban.classList.remove('hidden');
        containerKanban.style.display = 'block';
      }
      if (containerClientes) {
        containerClientes.classList.add('hidden');
        containerClientes.style.display = 'none';
      }
    } else {
      if (btnClientes) {
        btnClientes.classList.remove('btn-outline');
        btnClientes.classList.add('btn-primary');
        btnClientes.setAttribute('aria-pressed', 'true');
      }
      if (btnKanban) {
        btnKanban.classList.remove('btn-primary');
        btnKanban.classList.add('btn-outline');
        btnKanban.setAttribute('aria-pressed', 'false');
      }
      if (containerClientes) {
        containerClientes.classList.remove('hidden');
        containerClientes.style.display = 'block';
      }
      if (containerKanban) {
        containerKanban.classList.add('hidden');
        containerKanban.style.display = 'none';
      }
      carregarClientes(clientesPage || 1);
    }
  }

  /**
   * Carrega a lista paginada de clientes comerciais do CRM
   */
  async function carregarClientes(pagina = 1) {
    clientesPage = Math.max(1, parseInt(pagina, 10) || 1);

    const tbody = document.getElementById('crmClientesTbody');
    const emptyState = document.getElementById('crmClientesEmptyState');
    const btnRefresh = document.getElementById('btnCrmRefreshClientes');
    const paginationInfo = document.getElementById('crmClientesPaginationInfo');
    const btnPrev = document.getElementById('btnCrmClientesPrev');
    const btnNext = document.getElementById('btnCrmClientesNext');
    const pageCurrent = document.getElementById('crmClientesPageCurrent');

    if (btnRefresh) {
      btnRefresh.disabled = true;
      btnRefresh.innerHTML = '<span>⏳ Atualizando...</span>';
    }

    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 30px; color: var(--text-muted);">Carregando carteira de clientes...</td></tr>';
    }

    try {
      const token = getToken();
      const params = new URLSearchParams();
      if (clientesFiltroBusca) params.append('busca', clientesFiltroBusca);
      if (clientesFiltroVendedor && clientesFiltroVendedor !== 'TODOS') params.append('vendedor', clientesFiltroVendedor);
      params.append('page', String(clientesPage));
      params.append('limit', '15');

      const res = await fetch(`/api/bi/crm/clientes?${params.toString()}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });

      if (!res.ok) {
        throw new Error(`Falha HTTP ${res.status} ao carregar clientes.`);
      }

      const json = await res.json();
      const items = Array.isArray(json.data) ? json.data : [];
      const pagination = json.pagination || { total: items.length, page: clientesPage, totalPages: 1 };

      clientesList = items;
      clientesTotalCount = pagination.total !== undefined ? pagination.total : items.length;
      clientesTotalPages = pagination.totalPages || 1;
      clientesPage = pagination.page || 1;

      atualizarKpisClientes(clientesTotalCount, items);
      renderizarTabelaClientes(items);

      // Paginação
      const limit = pagination.limit || 15;
      const from = clientesTotalCount > 0 ? (clientesPage - 1) * limit + 1 : 0;
      const to = Math.min(clientesPage * limit, clientesTotalCount);
      if (paginationInfo) {
        paginationInfo.textContent = `Exibindo ${from} a ${to} de ${clientesTotalCount} clientes`;
      }
      if (pageCurrent) {
        pageCurrent.textContent = `${clientesPage} / ${clientesTotalPages}`;
      }
      if (btnPrev) btnPrev.disabled = (clientesPage <= 1);
      if (btnNext) btnNext.disabled = (clientesPage >= clientesTotalPages);

    } catch (err) {
      console.warn('⚠️ [CRM] Erro ao carregar clientes:', err.message);
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 30px; color: #f87171;">Erro ao carregar clientes: ${escapeHtml(err.message)}</td></tr>`;
      }
    } finally {
      if (btnRefresh) {
        btnRefresh.disabled = false;
        btnRefresh.innerHTML = '<span>🔄 Atualizar</span>';
      }
    }
  }

  /**
   * Atualiza os 3 Mini KPIs da visão de clientes
   */
  function atualizarKpisClientes(total, items) {
    const kpiTotal = document.getElementById('crmKpiTotalClientes');
    const kpiCrm = document.getElementById('crmKpiClientesCrm');
    const kpiProtheus = document.getElementById('crmKpiClientesProtheus');

    if (kpiTotal) kpiTotal.textContent = `${total} ${total === 1 ? 'cliente' : 'clientes'}`;

    let crmCount = 0;
    let protheusCount = 0;
    items.forEach(c => {
      const isProtheus = !!c.protheus_cod || c.origem === 'PROTHEUS';
      if (isProtheus) protheusCount++;
      else crmCount++;
    });

    if (kpiCrm) kpiCrm.textContent = `${crmCount} prospects (página)`;
    if (kpiProtheus) kpiProtheus.textContent = `${protheusCount} Protheus (página)`;
  }

  /**
   * Renderiza as linhas da tabela de clientes
   */
  function renderizarTabelaClientes(items) {
    const tbody = document.getElementById('crmClientesTbody');
    const emptyState = document.getElementById('crmClientesEmptyState');
    if (!tbody) return;

    if (!items || items.length === 0) {
      tbody.innerHTML = '';
      if (emptyState) {
        emptyState.classList.remove('hidden');
        emptyState.style.display = 'block';
      }
      return;
    }

    if (emptyState) {
      emptyState.classList.add('hidden');
      emptyState.style.display = 'none';
    }

    tbody.innerHTML = items.map(c => {
      const id = escapeHtml(c.id);
      const nomeRazao = escapeHtml(c.nome_razao || 'Sem Razão Social');
      const nomeFantasia = c.nome_fantasia ? escapeHtml(c.nome_fantasia) : '';
      const cnpjCpfFmt = escapeHtml(c.cnpj_cpf_fmt || c.cnpj_cpf || '-');
      const contatoNome = c.contato_nome ? escapeHtml(c.contato_nome) : '-';
      const email = c.email ? escapeHtml(c.email) : '';
      const localidade = (c.cidade || c.uf) ? escapeHtml([c.cidade, c.uf].filter(Boolean).join(' - ')) : '';
      const vendedor = c.vendedor_responsavel ? escapeHtml(c.vendedor_responsavel) : 'Não atribuído';

      // WhatsApp / Telefone com link clicável
      let contatoHtml = '';
      const celDigits = (c.celular_whatsapp || '').replace(/\D/g, '');
      if (celDigits) {
        const celFmt = escapeHtml(c.celular_whatsapp_fmt || c.celular_whatsapp);
        contatoHtml += `
          <div>
            <a href="https://wa.me/55${celDigits}" target="_blank" rel="noopener noreferrer" class="crm-btn-whatsapp" title="Conversar no WhatsApp">
              <span>💬</span> ${celFmt}
            </a>
          </div>
        `;
      }
      if (c.telefone) {
        const telFmt = escapeHtml(c.telefone_fmt || c.telefone);
        contatoHtml += `<div style="font-size: 0.76rem; color: var(--text-muted); margin-top: 3px;">📞 ${telFmt}</div>`;
      }
      if (!contatoHtml) {
        contatoHtml = '<span style="color: var(--text-muted);">-</span>';
      }

      // Origem
      const isCrmNovo = !c.protheus_cod;
      let badgeOrigem = isCrmNovo
        ? '<span class="crm-badge-crm" title="Cadastrado no CRM">[CRM]</span>'
        : '<span class="crm-badge-protheus" title="Cliente da base ERP Protheus">[Protheus]</span>';

      if (c.origem && c.origem !== 'OUTRO' && c.origem !== 'PROTHEUS' && c.origem !== 'CRM') {
        badgeOrigem += `<div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 2px;">${escapeHtml(c.origem)}</div>`;
      }

      const siteUrl = c.site_url ? escapeHtml(c.site_url) : '';
      const siteHref = c.site_url ? (c.site_url.startsWith('http') ? escapeHtml(c.site_url) : 'https://' + escapeHtml(c.site_url)) : '';

      return `
        <tr data-cliente-id="${id}">
          <td>
            <strong style="color: var(--text-main); font-size: 0.88rem; display: block;">${nomeRazao}</strong>
            ${nomeFantasia ? `<div style="font-size: 0.78rem; color: var(--text-muted);">${nomeFantasia}</div>` : ''}
            ${localidade ? `<div style="font-size: 0.74rem; color: #38bdf8; margin-top: 2px;">📍 ${localidade}</div>` : ''}
            ${siteUrl ? `<div style="font-size: 0.74rem; margin-top: 2px;"><a href="${siteHref}" target="_blank" rel="noopener noreferrer" style="color: #60a5fa; text-decoration: none;" title="Abrir site corporativo">🌐 ${siteUrl}</a></div>` : ''}
          </td>
          <td>
            <span style="font-family: var(--font-mono, monospace); font-size: 0.82rem; color: var(--text-muted);">${cnpjCpfFmt}</span>
            ${c.protheus_cod ? `<div style="font-size: 0.72rem; color: #a855f7; font-family: var(--font-mono, monospace);">Cód: ${escapeHtml(c.protheus_cod)}-${escapeHtml(c.protheus_loja || '01')}</div>` : ''}
          </td>
          <td>
            <div style="font-weight: 500;">${contatoNome}</div>
            ${email ? `<div style="font-size: 0.74rem; color: var(--text-muted);"><a href="mailto:${email}" style="color: #38bdf8; text-decoration: none;">${email}</a></div>` : ''}
            ${c.email_nfe ? `<div style="font-size: 0.72rem; color: #a78bfa; margin-top: 2px;" title="NF-e (XML/DANFE)">📄 ${escapeHtml(c.email_nfe)}</div>` : ''}
            ${c.contato_financeiro_nome ? `<div style="font-size: 0.72rem; color: #c084fc; margin-top: 2px;" title="Contas a Pagar / Financeiro">💳 ${escapeHtml(c.contato_financeiro_nome)}${c.contato_financeiro_tel_fmt || c.contato_financeiro_tel ? ` (${escapeHtml(c.contato_financeiro_tel_fmt || c.contato_financeiro_tel)})` : ''}</div>` : ''}
          </td>
          <td>${contatoHtml}</td>
          <td>
            <span style="font-size: 0.82rem; color: var(--text-main);">${vendedor}</span>
          </td>
          <td style="text-align: center;">${badgeOrigem}</td>
          <td style="text-align: center;">
            <div style="display: inline-flex; gap: 4px;">
              <button type="button" class="crm-btn-action btn-edit-cliente" data-id="${id}" title="Editar cliente">
                ✏️ Editar
              </button>
              <button type="button" class="crm-btn-action crm-btn-action-deal btn-deal-cliente" data-id="${id}" title="Criar oportunidade comercial">
                ➕ Deal
              </button>
              <button type="button" class="crm-btn-action crm-btn-action-delete btn-del-cliente" data-id="${id}" data-nome="${nomeRazao}" title="Excluir cliente">
                🗑️
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Listeners de ações da tabela
    tbody.querySelectorAll('.btn-edit-cliente').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.getAttribute('data-id');
        abrirModalCliente(id, 'tab');
      });
    });

    tbody.querySelectorAll('.btn-deal-cliente').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.getAttribute('data-id');
        const cli = clientesList.find(c => String(c.id) === String(id));
        if (cli) {
          criarDealParaCliente(cli);
        }
      });
    });

    tbody.querySelectorAll('.btn-del-cliente').forEach(b => {
      b.addEventListener('click', () => {
        const id = b.getAttribute('data-id');
        const nome = b.getAttribute('data-nome');
        excluirCliente(id, nome);
      });
    });
  }

  /**
   * Abre o modal de nova oportunidade pré-preenchendo dados do cliente
   */
  function criarDealParaCliente(cliente) {
    if (!cliente) return;
    switchCrmView('kanban');
    openNewDealModal();

    const inputTitulo = document.getElementById('crmInputTitulo');
    const inputCliente = document.getElementById('crmInputCliente');
    const inputCod = document.getElementById('crmInputClienteCod');
    const inputLoja = document.getElementById('crmInputClienteLoja');
    const inputCnpj = document.getElementById('crmInputClienteCnpj');
    const selectVend = document.getElementById('crmSelectVendedor');

    if (inputCliente) inputCliente.value = cliente.nome_razao || '';
    if (inputCod) inputCod.value = cliente.protheus_cod || cliente.id || '';
    if (inputLoja) inputLoja.value = cliente.protheus_loja || '01';
    if (inputCnpj) inputCnpj.value = cliente.cnpj_cpf || '';
    if (inputTitulo && cliente.nome_razao) {
      inputTitulo.value = `Cotação Comercial - ${cliente.nome_razao}`;
    }
    if (selectVend && cliente.vendedor_responsavel) {
      selectVend.value = cliente.vendedor_responsavel;
    }
    updateDealSaveButtonState();
  }

  /**
   * Abre o modal de cadastro ou edição de cliente
   */
  async function abrirModalCliente(clienteId = null, origin = 'tab') {
    clienteModalOrigin = origin;
    const modal = document.getElementById('modalCrmCliente');
    const title = document.getElementById('modalCrmClienteTitle');
    const form = document.getElementById('formCrmCliente');
    if (!modal || !form) return;

    form.reset();
    document.getElementById('crmClienteId').value = '';
    const inpTipoProtheus = document.getElementById('crmClienteTipoProtheus');
    if (inpTipoProtheus) inpTipoProtheus.value = 'F';
    const inpSite = document.getElementById('crmClienteSiteUrl');
    if (inpSite) inpSite.value = '';
    const inpMailNfe = document.getElementById('crmClienteEmailNfe');
    if (inpMailNfe) inpMailNfe.value = '';
    const inpMailBol = document.getElementById('crmClienteEmailBoleto');
    if (inpMailBol) inpMailBol.value = '';
    const inpFinNome = document.getElementById('crmClienteContatoFinNome');
    if (inpFinNome) inpFinNome.value = '';
    const inpFinTel = document.getElementById('crmClienteContatoFinTel');
    if (inpFinTel) inpFinTel.value = '';
    const inpFinEmail = document.getElementById('crmClienteContatoFinEmail');
    if (inpFinEmail) inpFinEmail.value = '';

    const detailsEndereco = document.getElementById('crmClienteDetailsEndereco');
    if (detailsEndereco) detailsEndereco.open = false;

    const statusCep = document.getElementById('crmCepLookupStatus');
    if (statusCep) statusCep.style.display = 'none';

    setupCepAutoLookup();
    await loadVendedoresOptions();

    if (clienteId) {
      if (title) title.innerHTML = '✏️ Editar Cliente (CRM)';
      let cliente = clientesList.find(c => String(c.id) === String(clienteId));

      try {
        const token = getToken();
        const res = await fetch(`/api/bi/crm/clientes/${encodeURIComponent(clienteId)}`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        if (res.ok) {
          const json = await res.json();
          if (json.data) cliente = json.data;
        }
      } catch {}

      if (cliente) {
        document.getElementById('crmClienteId').value = cliente.id || '';
        document.getElementById('crmClienteTipoPessoa').value = cliente.tipo_pessoa || 'PJ';
        if (inpTipoProtheus) inpTipoProtheus.value = cliente.tipo_cliente_protheus || 'F';
        document.getElementById('crmClienteNomeRazao').value = cliente.nome_razao || '';
        document.getElementById('crmClienteNomeFantasia').value = cliente.nome_fantasia || '';
        document.getElementById('crmClienteCnpjCpf').value = cliente.cnpj_cpf_fmt || cliente.cnpj_cpf || '';
        document.getElementById('crmClienteIe').value = cliente.ie || '';
        document.getElementById('crmClienteContatoNome').value = cliente.contato_nome || '';
        document.getElementById('crmClienteCelularWhatsapp').value = cliente.celular_whatsapp_fmt || cliente.celular_whatsapp || '';
        document.getElementById('crmClienteTelefone').value = cliente.telefone_fmt || cliente.telefone || '';
        document.getElementById('crmClienteEmail').value = cliente.email || '';
        if (inpSite) inpSite.value = cliente.site_url || '';
        if (inpMailNfe) inpMailNfe.value = cliente.email_nfe || '';
        if (inpMailBol) inpMailBol.value = cliente.email_boleto || '';
        if (inpFinNome) inpFinNome.value = cliente.contato_financeiro_nome || '';
        if (inpFinTel) inpFinTel.value = cliente.contato_financeiro_tel_fmt || cliente.contato_financeiro_tel || '';
        if (inpFinEmail) inpFinEmail.value = cliente.contato_financeiro_email || '';
        document.getElementById('crmClienteSelectVendedor').value = cliente.vendedor_responsavel || '';
        document.getElementById('crmClienteSelectOrigem').value = cliente.origem || 'OUTRO';
        document.getElementById('crmClienteCep').value = cliente.cep || '';
        document.getElementById('crmClienteLogradouro').value = cliente.logradouro || '';
        document.getElementById('crmClienteNumero').value = cliente.numero || '';
        document.getElementById('crmClienteComplemento').value = cliente.complemento || '';
        document.getElementById('crmClienteBairro').value = cliente.bairro || '';
        document.getElementById('crmClienteCidade').value = cliente.cidade || '';
        document.getElementById('crmClienteUf').value = cliente.uf || '';
        document.getElementById('crmClienteObservacoes').value = cliente.observacoes || '';

        if (cliente.logradouro || cliente.cep || cliente.cidade) {
          if (detailsEndereco) detailsEndereco.open = true;
        }
      } else if (origin === 'deal') {
        if (title) title.innerHTML = '👤 Cadastrar / Editar Cliente';
        const inpDeal = document.getElementById('crmInputCliente');
        const nomeParaPreencher = (inpDeal && inpDeal.value.trim()) || (currentDeal && currentDeal.clienteNome) || String(clienteId).trim();
        document.getElementById('crmClienteNomeRazao').value = nomeParaPreencher;
        const cnpjDeal = (document.getElementById('crmInputClienteCnpj')?.value || (currentDeal && currentDeal.clienteCnpj) || '').trim();
        if (cnpjDeal) document.getElementById('crmClienteCnpjCpf').value = cnpjDeal;
        const selVendDeal = document.getElementById('crmSelectVendedor');
        const vendParaPreencher = (selVendDeal && selVendDeal.value) || (currentDeal && currentDeal.vendedor) || '';
        if (vendParaPreencher) document.getElementById('crmClienteSelectVendedor').value = vendParaPreencher;
      }
    } else {
      if (title) title.innerHTML = '👤 Cadastro de Cliente (CRM)';
      if (origin === 'deal') {
        const inpDeal = document.getElementById('crmInputCliente');
        if (inpDeal && inpDeal.value.trim()) {
          document.getElementById('crmClienteNomeRazao').value = inpDeal.value.trim();
        }
        const cnpjDeal = (document.getElementById('crmInputClienteCnpj')?.value || (currentDeal && currentDeal.clienteCnpj) || '').trim();
        if (cnpjDeal) document.getElementById('crmClienteCnpjCpf').value = cnpjDeal;
        const selVendDeal = document.getElementById('crmSelectVendedor');
        if (selVendDeal && selVendDeal.value) {
          document.getElementById('crmClienteSelectVendedor').value = selVendDeal.value;
        }
      }
    }

    openModal(modal);
  }

  /**
   * Salva ou atualiza um cliente comercial via POST /api/bi/crm/clientes
   */
  async function salvarCliente(e) {
    if (e) e.preventDefault();
    const btnSalvar = document.getElementById('btnSalvarCrmCliente');
    const nomeRazao = document.getElementById('crmClienteNomeRazao').value.trim();

    if (!nomeRazao) {
      mostrarNotificacao('Por favor, informe a Razão Social ou Nome do cliente.', 'info');
      return;
    }

    if (btnSalvar) {
      btnSalvar.disabled = true;
      btnSalvar.textContent = 'Gravando...';
    }

    let siteUrlRaw = (document.getElementById('crmClienteSiteUrl')?.value || '').trim();
    let cleanSite = siteUrlRaw.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    if (cleanSite) {
      if (!cleanSite.includes('.') || cleanSite.length < 4 || /\s/.test(cleanSite)) {
        mostrarNotificacao('Por favor, informe um endereço de site corporativo válido (ex: www.cliente.com.br ou cliente.com.br).', 'info');
        if (btnSalvar) {
          btnSalvar.disabled = false;
          btnSalvar.textContent = '💾 Salvar Cliente';
        }
        return;
      }
    }

    const payload = {
      id: document.getElementById('crmClienteId').value || undefined,
      tipo_pessoa: document.getElementById('crmClienteTipoPessoa').value,
      tipo_cliente_protheus: (document.getElementById('crmClienteTipoProtheus')?.value || 'F').trim(),
      nome_razao: nomeRazao,
      nome_fantasia: document.getElementById('crmClienteNomeFantasia').value.trim(),
      cnpj_cpf: document.getElementById('crmClienteCnpjCpf').value.trim(),
      ie: document.getElementById('crmClienteIe').value.trim(),
      contato_nome: document.getElementById('crmClienteContatoNome').value.trim(),
      celular_whatsapp: document.getElementById('crmClienteCelularWhatsapp').value.trim(),
      telefone: document.getElementById('crmClienteTelefone').value.trim(),
      email: document.getElementById('crmClienteEmail').value.trim(),
      site_url: cleanSite,
      email_nfe: document.getElementById('crmClienteEmailNfe')?.value.trim() || '',
      email_boleto: document.getElementById('crmClienteEmailBoleto')?.value.trim() || '',
      contato_financeiro_nome: document.getElementById('crmClienteContatoFinNome')?.value.trim() || '',
      contato_financeiro_tel: document.getElementById('crmClienteContatoFinTel')?.value.trim() || '',
      contato_financeiro_email: document.getElementById('crmClienteContatoFinEmail')?.value.trim() || '',
      vendedor_responsavel: document.getElementById('crmClienteSelectVendedor').value,
      origem: document.getElementById('crmClienteSelectOrigem').value,
      cep: document.getElementById('crmClienteCep').value.trim().replace(/\D/g, ''),
      logradouro: document.getElementById('crmClienteLogradouro').value.trim(),
      numero: document.getElementById('crmClienteNumero').value.trim(),
      complemento: document.getElementById('crmClienteComplemento').value.trim(),
      bairro: document.getElementById('crmClienteBairro').value.trim(),
      cidade: document.getElementById('crmClienteCidade').value.trim(),
      uf: document.getElementById('crmClienteUf').value.trim().toUpperCase(),
      observacoes: document.getElementById('crmClienteObservacoes').value.trim()
    };

    try {
      const token = getToken();
      const res = await fetch('/api/bi/crm/clientes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || errJson.message || `Erro ${res.status} ao salvar cliente.`);
      }

      const json = await res.json();
      const clienteSalvo = json.data || payload;

      closeModal(document.getElementById('modalCrmCliente'));

      if (clienteModalOrigin === 'deal') {
        // Injeta automaticamente no formulário do Deal sem perder campos já digitados
        const inputCliente = document.getElementById('crmInputCliente');
        const inputCod = document.getElementById('crmInputClienteCod');
        const inputLoja = document.getElementById('crmInputClienteLoja');
        const inputCnpj = document.getElementById('crmInputClienteCnpj');
        const selectVend = document.getElementById('crmSelectVendedor');

        const nomeFinal = clienteSalvo.nome_razao || nomeRazao;
        const codFinal = clienteSalvo.protheus_cod || clienteSalvo.id || '';
        const lojaFinal = clienteSalvo.protheus_loja || '01';
        const cnpjFinal = clienteSalvo.cnpj_cpf || '';

        if (inputCliente) inputCliente.value = nomeFinal;
        if (inputCod) inputCod.value = codFinal;
        if (inputLoja) inputLoja.value = lojaFinal;
        if (inputCnpj) inputCnpj.value = cnpjFinal;
        if (selectVend && !selectVend.value && clienteSalvo.vendedor_responsavel) {
          selectVend.value = clienteSalvo.vendedor_responsavel;
        }
        updateDealSaveButtonState();

        // Se o modal de detalhes do negócio estiver aberto, sincroniza imediatamente
        const elDetalhesCliente = document.getElementById('crmDetalhesCliente');
        if (elDetalhesCliente) {
          elDetalhesCliente.textContent = nomeFinal;
        }
        if (currentDeal) {
          currentDeal.clienteNome = nomeFinal;
          if (codFinal) currentDeal.clienteCod = codFinal;
          if (lojaFinal) currentDeal.clienteLoja = lojaFinal;
          if (cnpjFinal) currentDeal.clienteCnpj = cnpjFinal;

          // Se a oportunidade já está salva no banco (possui ID), persiste as alterações no deal
          if (currentDeal.id) {
            try {
              const token = getToken();
              fetch(`/api/bi/crm/deals/${encodeURIComponent(currentDeal.id)}`, {
                method: 'PUT',
                headers: {
                  'Content-Type': 'application/json',
                  ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify({
                  ...currentDeal,
                  cliente_nome: nomeFinal,
                  cliente_cod: codFinal,
                  cliente_loja: lojaFinal,
                  cliente_cnpj: cnpjFinal
                })
              }).catch(e => console.warn('⚠️ [CRM] Falha assíncrona ao persistir cliente no deal:', e));
            } catch {}
          }
          if (typeof renderDealsViews === 'function') renderDealsViews();
          else if (typeof renderKanbanBoard === 'function') renderKanbanBoard();
        }

        const msgSucesso = payload.id
          ? 'Cadastro do cliente atualizado com sucesso!'
          : 'Cliente cadastrado e vinculado à oportunidade!';
        mostrarNotificacao(msgSucesso, 'success');
      } else {
        mostrarNotificacao(json.message || 'Cliente salvo com sucesso!', 'success');
        await carregarClientes(clientesPage);
      }
    } catch (err) {
      console.error('❌ [CRM] Erro ao salvar cliente:', err);
      mostrarNotificacao(err.message || 'Falha ao salvar cliente.', 'info');
    } finally {
      if (btnSalvar) {
        btnSalvar.disabled = false;
        btnSalvar.textContent = '💾 Salvar Cliente';
      }
      clienteModalOrigin = null;
    }
  }

  /**
   * Exclui um cliente comercial com confirmação amigável
   */
  async function excluirCliente(id, nome) {
    if (!id) return;
    const confirmMsg = `Deseja realmente excluir o cliente "${nome || 'selecionado'}"?\n\nEsta ação removerá o cliente da listagem comercial do CRM.`;
    if (!confirm(confirmMsg)) return;

    try {
      const token = getToken();
      const res = await fetch(`/api/bi/crm/clientes/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || errJson.message || `Erro ${res.status} ao excluir.`);
      }

      mostrarNotificacao(`Cliente "${nome || id}" excluído com sucesso.`, 'success');
      await carregarClientes(clientesPage);
    } catch (err) {
      console.error('❌ [CRM] Erro ao excluir cliente:', err);
      mostrarNotificacao(err.message || 'Falha ao excluir cliente.', 'info');
    }
  }

  /**
   * Configuração geral de Event Listeners da interface do CRM
   */
  function setupEventListeners() {
    // 1. Toggles de Visão (Kanban / Clientes)
    const btnKanbanView = document.getElementById('btnCrmViewKanban');
    if (btnKanbanView && !btnKanbanView._hasListener) {
      btnKanbanView._hasListener = true;
      btnKanbanView.addEventListener('click', () => switchCrmView('kanban'));
    }

    const btnClientesView = document.getElementById('btnCrmViewClientes');
    if (btnClientesView && !btnClientesView._hasListener) {
      btnClientesView._hasListener = true;
      btnClientesView.addEventListener('click', () => switchCrmView('clientes'));
    }

    // 2. Toolbar da Visão de Clientes
    const clienteSearchInput = document.getElementById('crmClienteSearchInput');
    if (clienteSearchInput && !clienteSearchInput._hasListener) {
      clienteSearchInput._hasListener = true;
      clienteSearchInput.addEventListener('input', () => {
        clearTimeout(clienteSearchDebounceTimer);
        clienteSearchDebounceTimer = setTimeout(() => {
          clientesFiltroBusca = clienteSearchInput.value.trim();
          carregarClientes(1);
        }, 300);
      });
    }

    const clienteFilterVend = document.getElementById('crmClienteFilterVendedor');
    if (clienteFilterVend && !clienteFilterVend._hasListener) {
      clienteFilterVend._hasListener = true;
      clienteFilterVend.addEventListener('change', () => {
        clientesFiltroVendedor = clienteFilterVend.value;
        carregarClientes(1);
      });
    }

    const btnNovoClienteTab = document.getElementById('btnCrmNovoClienteTab');
    if (btnNovoClienteTab && !btnNovoClienteTab._hasListener) {
      btnNovoClienteTab._hasListener = true;
      btnNovoClienteTab.addEventListener('click', () => abrirModalCliente(null, 'tab'));
    }

    const btnEmptyNovoCliente = document.getElementById('btnCrmEmptyNovoCliente');
    if (btnEmptyNovoCliente && !btnEmptyNovoCliente._hasListener) {
      btnEmptyNovoCliente._hasListener = true;
      btnEmptyNovoCliente.addEventListener('click', () => abrirModalCliente(null, 'tab'));
    }

    const btnRefreshClientes = document.getElementById('btnCrmRefreshClientes');
    if (btnRefreshClientes && !btnRefreshClientes._hasListener) {
      btnRefreshClientes._hasListener = true;
      btnRefreshClientes.addEventListener('click', () => carregarClientes(clientesPage));
    }

    // Botão Novo Cliente acionado de dentro do Deal
    const btnNovoClienteFromDeal = document.getElementById('btnCrmNovoClienteFromDeal');
    if (btnNovoClienteFromDeal && !btnNovoClienteFromDeal._hasListener) {
      btnNovoClienteFromDeal._hasListener = true;
      btnNovoClienteFromDeal.addEventListener('click', () => abrirModalCliente(null, 'deal'));
    }

    // Botão Editar Cadastro do Cliente acionado de dentro do Deal
    const btnEditarClienteFromDeal = document.getElementById('btnCrmEditarClienteFromDeal');
    if (btnEditarClienteFromDeal && !btnEditarClienteFromDeal._hasListener) {
      btnEditarClienteFromDeal._hasListener = true;
      btnEditarClienteFromDeal.addEventListener('click', () => {
        const cod = (document.getElementById('crmInputClienteCod')?.value || '').trim();
        const cnpj = (document.getElementById('crmInputClienteCnpj')?.value || '').trim();
        const nome = (document.getElementById('crmInputCliente')?.value || '').trim();

        const identificador = cod || cnpj || nome;
        if (!identificador) {
          mostrarNotificacao('Selecione ou busque um cliente antes de editar o cadastro.', 'info');
          return;
        }
        abrirModalCliente(identificador, 'deal');
      });
    }

    // Paginação de Clientes
    const btnPrevClientes = document.getElementById('btnCrmClientesPrev');
    if (btnPrevClientes && !btnPrevClientes._hasListener) {
      btnPrevClientes._hasListener = true;
      btnPrevClientes.addEventListener('click', () => {
        if (clientesPage > 1) carregarClientes(clientesPage - 1);
      });
    }

    const btnNextClientes = document.getElementById('btnCrmClientesNext');
    if (btnNextClientes && !btnNextClientes._hasListener) {
      btnNextClientes._hasListener = true;
      btnNextClientes.addEventListener('click', () => {
        if (clientesPage < clientesTotalPages) carregarClientes(clientesPage + 1);
      });
    }

    // Submissão do Modal de Cliente
    const formCliente = document.getElementById('formCrmCliente');
    if (formCliente && !formCliente._hasListener) {
      formCliente._hasListener = true;
      formCliente.addEventListener('submit', salvarCliente);
    }

    // Botão Nova Oportunidade
    const btnNova = document.getElementById('btnCrmNovaOportunidade');
    if (btnNova && !btnNova._hasListener) {
      btnNova._hasListener = true;
      btnNova.addEventListener('click', openNewDealModal);
    }

    // Botão Atualizar Kanban
    const btnRefresh = document.getElementById('btnCrmRefresh');
    if (btnRefresh && !btnRefresh._hasListener) {
      btnRefresh._hasListener = true;
      btnRefresh.addEventListener('click', loadDeals);
    }

    // 3. Toggles de Modo de Visualização das Oportunidades (Kanban vs Listagem)
    const btnModeKanban = document.getElementById('btnCrmViewModeKanban');
    if (btnModeKanban && !btnModeKanban._hasListener) {
      btnModeKanban._hasListener = true;
      btnModeKanban.addEventListener('click', () => setDealViewMode('kanban'));
    }

    const btnModeListagem = document.getElementById('btnCrmViewModeListagem');
    if (btnModeListagem && !btnModeListagem._hasListener) {
      btnModeListagem._hasListener = true;
      btnModeListagem.addEventListener('click', () => setDealViewMode('listagem'));
    }

    // 4. Controles de Paginação da Listagem de Deals (Pilar 1 do GEMINI.md)
    const btnPrevDeals = document.getElementById('btnCrmDealsPrev');
    if (btnPrevDeals && !btnPrevDeals._hasListener) {
      btnPrevDeals._hasListener = true;
      btnPrevDeals.addEventListener('click', () => {
        if (dealsPage > 1) {
          dealsPage--;
          renderListagemBoard();
        }
      });
    }

    const btnNextDeals = document.getElementById('btnCrmDealsNext');
    if (btnNextDeals && !btnNextDeals._hasListener) {
      btnNextDeals._hasListener = true;
      btnNextDeals.addEventListener('click', () => {
        const filtered = getFilteredDeals();
        const totalPages = Math.max(1, Math.ceil(filtered.length / dealsPerPage));
        if (dealsPage < totalPages) {
          dealsPage++;
          renderListagemBoard(filtered);
        }
      });
    }

    const limitSelect = document.getElementById('crmDealsLimitSelect');
    if (limitSelect && !limitSelect._hasListener) {
      limitSelect._hasListener = true;
      limitSelect.addEventListener('change', () => {
        dealsPerPage = parseInt(limitSelect.value, 10) || 25;
        dealsPage = 1;
        renderListagemBoard();
      });
    }

    // Filtros de busca e vendedor do pipeline
    const searchInput = document.getElementById('crmSearchInput');
    if (searchInput && !searchInput._hasListener) {
      searchInput._hasListener = true;
      let timer = null;
      searchInput.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          dealsPage = 1;
          renderDealsViews();
        }, 300);
      });
    }

    const filterVend = document.getElementById('crmFilterVendedor');
    if (filterVend && !filterVend._hasListener) {
      filterVend._hasListener = true;
      filterVend.addEventListener('change', () => {
        dealsPage = 1;
        renderDealsViews();
      });
    }

    const filterStatus = document.getElementById('crmFilterStatus');
    if (filterStatus && !filterStatus._hasListener) {
      filterStatus._hasListener = true;
      filterStatus.addEventListener('change', () => {
        dealsPage = 1;
        renderDealsViews();
      });
    }

    const btnLimpar = document.getElementById('btnCrmLimparFiltros');
    if (btnLimpar && !btnLimpar._hasListener) {
      btnLimpar._hasListener = true;
      btnLimpar.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        if (filterVend) filterVend.value = 'TODOS';
        if (filterStatus) filterStatus.value = 'ABERTAS';
        dealsPage = 1;
        renderDealsViews();
      });
    }

    // Botão Adicionar Item Cotado no Formulário
    const btnAddItem = document.getElementById('btnCrmAddItemCotado');
    if (btnAddItem && !btnAddItem._hasListener) {
      btnAddItem._hasListener = true;
      btnAddItem.addEventListener('click', addItemCotado);
    }

    // Submissão do Formulário de Oportunidade
    const formOportunidade = document.getElementById('formCrmOportunidade');
    if (formOportunidade && !formOportunidade._hasListener) {
      formOportunidade._hasListener = true;
      formOportunidade.addEventListener('submit', handleSaveOpportunity);
    }

    // Validação reativa em tempo real dos 4 campos obrigatórios do Deal (Título, Vendedor, Cliente, Faturado Por)
    ['crmInputTitulo', 'crmSelectVendedor', 'crmInputCliente', 'crmSelectFaturadoPor'].forEach(id => {
      const el = document.getElementById(id);
      if (el && !el._hasDealValidationListener) {
        el._hasDealValidationListener = true;
        el.addEventListener('input', updateDealSaveButtonState);
        el.addEventListener('change', updateDealSaveButtonState);
        el.addEventListener('blur', updateDealSaveButtonState);
      }
    });

    // Submissão de Atividade / Follow-up
    const formAtividade = document.getElementById('formCrmAtividade');
    if (formAtividade && !formAtividade._hasListener) {
      formAtividade._hasListener = true;
      formAtividade.addEventListener('submit', handleAddActivity);
    }

    // Ações no Modal de Detalhes
    const btnEditarClienteDoDetalhes = document.getElementById('btnCrmEditarClienteDoDetalhes');
    if (btnEditarClienteDoDetalhes && !btnEditarClienteDoDetalhes._hasListener) {
      btnEditarClienteDoDetalhes._hasListener = true;
      btnEditarClienteDoDetalhes.addEventListener('click', () => {
        if (!currentDeal) return;
        const cod = (currentDeal.clienteCod || currentDeal.clienteCnpj || currentDeal.clienteNome || '').trim();
        if (!cod) {
          mostrarNotificacao('Esta oportunidade não possui cliente associado.', 'info');
          return;
        }
        abrirModalCliente(cod, 'deal');
      });
    }

    const btnEditarDoDetalhes = document.getElementById('btnCrmEditarDoDetalhes');
    if (btnEditarDoDetalhes && !btnEditarDoDetalhes._hasListener) {
      btnEditarDoDetalhes._hasListener = true;
      btnEditarDoDetalhes.addEventListener('click', () => {
        if (!currentDeal) return;
        closeModal(document.getElementById('modalCrmDetalhes'));
        openEditDealModal(currentDeal.id);
      });
    }

    const btnGanhoDoDetalhes = document.getElementById('btnCrmGanhoDoDetalhes');
    if (btnGanhoDoDetalhes && !btnGanhoDoDetalhes._hasListener) {
      btnGanhoDoDetalhes._hasListener = true;
      btnGanhoDoDetalhes.addEventListener('click', async () => {
        if (!currentDeal) return;
        if (confirm(`Deseja marcar a oportunidade "${currentDeal.titulo}" como VENDA EFETUADA (GANHO)?`)) {
          await moveDealStage(currentDeal.id, 'GANHO');
          closeModal(document.getElementById('modalCrmDetalhes'));
        }
      });
    }

    const btnPerdidoDoDetalhes = document.getElementById('btnCrmPerdidoDoDetalhes');
    if (btnPerdidoDoDetalhes && !btnPerdidoDoDetalhes._hasListener) {
      btnPerdidoDoDetalhes._hasListener = true;
      btnPerdidoDoDetalhes.addEventListener('click', () => {
        if (!currentDeal) return;
        openMarkLostModal(currentDeal.id);
      });
    }

    // Confirmação de Oportunidade Perdida
    const btnConfirmarPerda = document.getElementById('btnConfirmarCrmPerda');
    if (btnConfirmarPerda && !btnConfirmarPerda._hasListener) {
      btnConfirmarPerda._hasListener = true;
      btnConfirmarPerda.addEventListener('click', handleConfirmLost);
    }

    // Botões de fechar modais
    document.querySelectorAll('.btn-close-crm-modal').forEach(btn => {
      if (!btn._hasListener) {
        btn._hasListener = true;
        btn.addEventListener('click', () => {
          const modal = btn.closest('.modal');
          if (modal) closeModal(modal);
        });
      }
    });

    // Proteção de Modais contra fechamento acidental no backdrop (overlay)
    // Em vez de fechar, aplica micro-animação crm-modal-shake no card para feedback visual
    ['modalCrmCliente', 'modalCrmOportunidade', 'modalCrmDetalhes', 'modalCrmPerdido', 'modalCrmMarcarPerdido'].forEach(id => {
      const m = document.getElementById(id);
      if (m && !m._hasBackdropListener) {
        m._hasBackdropListener = true;
        m.addEventListener('click', (e) => {
          if (e.target === m) {
            const content = m.querySelector('.modal-content');
            if (content) {
              content.classList.remove('crm-modal-shake');
              void content.offsetWidth; // Força reflow para reiniciar CSS keyframe
              content.classList.add('crm-modal-shake');
              setTimeout(() => {
                if (content) content.classList.remove('crm-modal-shake');
              }, 450);
            }
          }
        });
      }
    });

    // Alternador Maximizar / Restaurar tamanho do Modal de Oportunidade (Opção B - Estilo HubSpot)
    const btnToggleMaximize = document.getElementById('btnCrmToggleMaximizeDealModal');
    if (btnToggleMaximize && !btnToggleMaximize._hasMaximizeListener) {
      btnToggleMaximize._hasMaximizeListener = true;
      btnToggleMaximize.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const modal = document.getElementById('modalCrmOportunidade');
        const content = modal ? modal.querySelector('.modal-content') : null;
        if (!content) return;
        const isMaximized = content.classList.toggle('modal-maximized');
        btnToggleMaximize.innerHTML = isMaximized ? '🗗' : '⛶';
        btnToggleMaximize.title = isMaximized ? 'Restaurar tamanho padrão' : 'Maximizar / Tela cheia';
        btnToggleMaximize.setAttribute('aria-label', isMaximized ? 'Restaurar tamanho padrão' : 'Maximizar modal');
      });
    }

    // Fechamento com tecla Escape
    if (!document._hasCrmEscapeListener) {
      document._hasCrmEscapeListener = true;
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          // 1. Fecha primeiro o dropdown de sugestões de produtos se estiver visível
          const prodDropdown = document.getElementById('crmProductSuggestionsDropdown');
          if (prodDropdown && prodDropdown.style.display !== 'none') {
            prodDropdown.style.display = 'none';
            return;
          }
          // Fecha dropdown de transportadoras se estiver visível
          const transpDropdown = document.getElementById('crmTransportadoraDropdown');
          if (transpDropdown && transpDropdown.style.display !== 'none' && !transpDropdown.classList.contains('hidden')) {
            transpDropdown.classList.add('hidden');
            transpDropdown.style.display = 'none';
            return;
          }
          // Fecha na ordem inversa de precedência (modal de cliente primeiro se estiver aberto)
          const modalCliente = document.getElementById('modalCrmCliente');
          if (modalCliente && modalCliente.style.display !== 'none' && !modalCliente.classList.contains('hidden')) {
            closeModal(modalCliente);
            return;
          }
          const modalPerda = document.getElementById('modalCrmPerdido') || document.getElementById('modalCrmMarcarPerdido');
          if (modalPerda && modalPerda.style.display !== 'none' && !modalPerda.classList.contains('hidden')) {
            closeModal(modalPerda);
            return;
          }
          const modalDetalhes = document.getElementById('modalCrmDetalhes');
          if (modalDetalhes && modalDetalhes.style.display !== 'none' && !modalDetalhes.classList.contains('hidden')) {
            closeModal(modalDetalhes);
            return;
          }
          const modalOportunidade = document.getElementById('modalCrmOportunidade');
          if (modalOportunidade && modalOportunidade.style.display !== 'none' && !modalOportunidade.classList.contains('hidden')) {
            closeModal(modalOportunidade);
            return;
          }
        }
      });
    }

    setupClientAutocomplete();
    setupTransportadoraAutocomplete();
    setupCepAutoLookup();
    setupProductSyncButton();
  }

  /**
   * Utilitário para verificar se há alterações pendentes no formulário de oportunidade (Dirty Check)
   */
  function isDealFormDirty() {
    const titulo = document.getElementById('crmInputTitulo')?.value?.trim() || '';
    const cliente = document.getElementById('crmInputCliente')?.value?.trim() || '';
    const obsNfe = document.getElementById('crmInputObsNfe')?.value?.trim() || document.getElementById('crmTextareaObs')?.value?.trim() || '';
    const pedidoCompra = document.getElementById('crmInputPedidoCompraCliente')?.value?.trim() || '';
    const transp = document.getElementById('crmInputTransportadora')?.value?.trim() || '';
    const condPgto = document.getElementById('crmInputCondPgto')?.value?.trim() || '';
    const prazoEntrega = document.getElementById('crmInputPrazoEntrega')?.value?.trim() || '';
    const hasItems = Array.isArray(currentItems) && currentItems.length > 0;

    if (currentDeal) {
      if (titulo !== (currentDeal.titulo || '')) return true;
      if (cliente !== (currentDeal.clienteNome || '')) return true;
      if (obsNfe !== (currentDeal.observacoesNfe || currentDeal.observacoes || '')) return true;
      if (pedidoCompra !== (currentDeal.pedidoCompraCliente || '')) return true;
      if (transp !== (currentDeal.transportadora || '')) return true;
      if (condPgto !== (currentDeal.condPgto || '')) return true;
      if (prazoEntrega !== (currentDeal.prazoEntrega || '')) return true;
      if (JSON.stringify(currentItems) !== JSON.stringify(currentDeal.itens || [])) return true;
      return false;
    }

    return Boolean(titulo || cliente || obsNfe || pedidoCompra || transp || hasItems);
  }

  /**
   * Utilitário para abrir modal
   */
  function openModal(modal) {
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }

  /**
   * Utilitário para fechar modal com dirty check opcional
   */
  function closeModal(modal, force = false) {
    if (!modal) return;

    if (modal.id === 'modalCrmOportunidade' && !force) {
      if (isDealFormDirty()) {
        const confirmar = window.confirm('Existem dados preenchidos ou alterações nesta oportunidade que não foram salvas. Deseja realmente fechar e descartar as alterações?');
        if (!confirmar) return;
      }
    }

    modal.classList.add('hidden');
    modal.style.display = 'none';
    if (modal.id === 'modalCrmCliente') {
      clienteModalOrigin = null;
    }
    const prodDropdown = document.getElementById('crmProductSuggestionsDropdown');
    if (prodDropdown) prodDropdown.style.display = 'none';
  }

  /**
   * Notificação flutuante temporária (Toast)
   */
  function mostrarNotificacao(texto, tipo = 'info') {
    let toast = document.getElementById('crmToastNotification');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'crmToastNotification';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      toast.className = 'crm-toast';
      document.body.appendChild(toast);
    }

    const tipoNorm = (tipo === 'sucesso' ? 'success' : (tipo === 'erro' || tipo === 'error' || tipo === 'danger' ? 'danger' : tipo));
    toast.className = `crm-toast crm-toast-${tipoNorm}`;
    toast.innerHTML = `<span>${escapeHtml(texto)}</span>`;
    toast.style.display = 'block';

    setTimeout(() => {
      if (toast) toast.style.display = 'none';
    }, 3500);
  }

  // Exportação pública para o escopo global SPA
  window.CRMModule = {
    init,
    loadDeals,
    switchView: switchCrmView,
    loadClientes: carregarClientes,
    openClienteModal: abrirModalCliente,
    deleteCliente: excluirCliente,
    openNewDealModal,
    openEditDealModal,
    openDealDetails: openDealDetailsModal,
    moveDealStage,
    markLost: openMarkLostModal,
    isDealFormValid,
    updateDealSaveButtonState,
    getDeals: () => deals,
    getClientes: () => clientesList,
    isInitialized: () => isInitialized
  };

  console.log('✅ [CRM Comercial] Módulo CRMModule carregado com sucesso.');
})();
