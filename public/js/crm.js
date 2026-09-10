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
    'Andrea',
    'Figueiredo',
    'Diretoria'
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
      prazoEntrega: custom.prazoEntrega || d.prazo_entrega || d.prazoEntrega || '',
      pedidoCompraCliente: custom.pedidoCompraCliente || d.num_pedido_compra || d.pedidoCompraCliente || '',
      observacoesNfe: custom.observacoesNfe || d.obs_nfe || d.observacoesNfe || '',
      itens: Array.isArray(d.itens_cotados) && d.itens_cotados.length > 0 ? d.itens_cotados : (Array.isArray(d.itens) ? d.itens : []),
      motivoPerda: d.motivo_perda || d.motivoPerda || '',
      observacoesPerda: d.observacoes_perda || d.observacoesPerda || '',
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
        id: 'crm-101',
        titulo: 'Cofre Mecânico 40x40 - Rede Farmácias',
        clienteNome: 'DROGARIA SAO PAULO S/A',
        clienteCod: '004128',
        clienteLoja: '01',
        clienteCnpj: '61.412.110/0001-55',
        vendedor: 'Juliana',
        fase: 'LEAD',
        valor: 4850.00,
        condPgto: '28 DDL',
        freteCobrado: 250.00,
        freteEmbutido: 0.00,
        tipoFrete: 'FOB',
        transportadora: 'Braspress',
        prazoEntrega: '7 dias úteis',
        pedidoCompraCliente: 'PO-2026-9812',
        observacoesNfe: 'Entregar com agendamento prévio na portaria de cargas.',
        itens: [
          { codigo: 'CF-4040', descricao: 'Cofre Mecânico Blindado 40x40', quantidade: 2, precoTabela: 2500.00, precoNegociado: 2425.00, total: 4850.00 }
        ],
        createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 2 * 86400000).toISOString()
      },
      {
        id: 'crm-102',
        titulo: 'Armários de Aço NR-24 - Construtora Sul',
        clienteNome: 'CONSTRUTORA METROPOLITANA LTDA',
        clienteCod: '009214',
        clienteLoja: '01',
        clienteCnpj: '08.921.454/0001-30',
        vendedor: 'Figueiredo',
        fase: 'CONTATO',
        valor: 12600.00,
        condPgto: '30/60 DDL',
        freteCobrado: 0.00,
        freteEmbutido: 600.00,
        tipoFrete: 'CIF',
        transportadora: 'Rodonaves',
        prazoEntrega: '15 dias úteis',
        pedidoCompraCliente: '',
        observacoesNfe: '',
        itens: [
          { codigo: 'ARM-NR24-8P', descricao: 'Armário Vestiário 8 Portas Aço Chapa 24', quantidade: 6, precoTabela: 2200.00, precoNegociado: 2100.00, total: 12600.00 }
        ],
        createdAt: new Date(Date.now() - 6 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 6 * 86400000).toISOString()
      },
      {
        id: 'crm-103',
        titulo: 'Porta Forte Blindada Nível III - Cooperativa',
        clienteNome: 'COOPERATIVA DE CREDITO VALE VERDE',
        clienteCod: '012543',
        clienteLoja: '01',
        clienteCnpj: '17.382.901/0001-88',
        vendedor: 'Alexandre',
        fase: 'PROPOSTA',
        valor: 38900.00,
        condPgto: '30/60/90 DDL',
        freteCobrado: 1200.00,
        freteEmbutido: 0.00,
        tipoFrete: 'CIF',
        transportadora: 'Transfiat Especial',
        prazoEntrega: '20 dias úteis',
        pedidoCompraCliente: 'PED-VALE-2026-04',
        observacoesNfe: 'Emissão para faturamento direto com dados de entrega em filial bancária.',
        itens: [
          { codigo: 'PF-NIV3', descricao: 'Porta Forte Blindada Especial ABNT 10636', quantidade: 1, precoTabela: 42000.00, precoNegociado: 38900.00, total: 38900.00 }
        ],
        createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 1 * 86400000).toISOString()
      },
      {
        id: 'crm-104',
        titulo: 'Lote 10 Cofres Digitais Hotelaria Premium',
        clienteNome: 'HOTEL RESORT ROYAL PALACE',
        clienteCod: '007321',
        clienteLoja: '01',
        clienteCnpj: '03.732.190/0001-44',
        vendedor: 'Andrea',
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
        id: 'crm-105',
        titulo: 'Armários Blindados com Fechadura Biométrica',
        clienteNome: 'LABORATORIO BIOCIENCIA DIAGNOSTICOS',
        clienteCod: '018902',
        clienteLoja: '01',
        clienteCnpj: '22.890.231/0001-12',
        vendedor: 'Juliana',
        fase: 'GANHO',
        valor: 22800.00,
        condPgto: 'À Vista',
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
   * Salva atividades de um negócio localmente
   */
  function saveActivitiesLocal(dealId, activities) {
    try {
      localStorage.setItem(ACTIVITIES_KEY_PREFIX + dealId, JSON.stringify(activities));
    } catch {}
  }

  /**
   * Carrega atividades de um negócio
   */
  function loadActivitiesLocal(dealId) {
    try {
      const raw = localStorage.getItem(ACTIVITIES_KEY_PREFIX + dealId);
      if (raw) return JSON.parse(raw);
    } catch {}
    const mock = [
      {
        id: 'act-1',
        dealId,
        tipo: 'NOTA',
        descricao: 'Oportunidade cadastrada no CRM Comercial com itens cotados iniciais.',
        autor: 'Alexandre',
        createdAt: new Date(Date.now() - 2 * 86400000).toISOString()
      },
      {
        id: 'act-2',
        dealId,
        tipo: 'WHATSAPP',
        descricao: 'Enviada proposta comercial em PDF via WhatsApp para o comprador responsável.',
        autor: 'Juliana',
        createdAt: new Date(Date.now() - 1 * 86400000).toISOString()
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

    // 1. Filtro do Kanban
    if (selectFilter) {
      const current = selectFilter.value || 'TODOS';
      selectFilter.innerHTML = '<option value="TODOS">Todos os Vendedores</option>' +
        nomesVendedores.map(v => `<option value="${escapeHtml(v)}" ${v === current ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('');
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
      renderKanbanBoard();
      updateTopKpis();
    }
  }

  /**
   * Renderiza os cards nos 5 estágios canônicos e atualiza contadores
   */
  function renderKanbanBoard() {
    const filterText = (document.getElementById('crmSearchInput')?.value || '').trim().toLowerCase();
    const filterVendedor = document.getElementById('crmFilterVendedor')?.value || 'TODOS';
    const filterStatus = document.getElementById('crmFilterStatus')?.value || 'ATIVOS';

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

    // Filtra negócios
    const filteredDeals = deals.filter(deal => {
      // Filtro de vendedor
      if (filterVendedor !== 'TODOS' && deal.vendedor !== filterVendedor) {
        return false;
      }

      // Filtro de status (Ativos vs Perdidos vs Todos)
      if (filterStatus === 'ATIVOS' && deal.fase === 'PERDIDO') return false;
      if (filterStatus === 'PERDIDO' && deal.fase !== 'PERDIDO') return false;

      // Filtro textual
      if (filterText) {
        const strBusca = [
          deal.titulo || '',
          deal.clienteNome || '',
          deal.clienteCnpj || '',
          deal.vendedor || '',
          deal.pedidoCompraCliente || ''
        ].join(' ').toLowerCase();

        if (!strBusca.includes(filterText)) return false;
      }

      return true;
    });

    // Popula cards
    filteredDeals.forEach(deal => {
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
    renderKanbanBoard();
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

    // Vendedor padrão: usuário logado se for vendedor
    const user = getCurrentUser();
    const selectVendedor = document.getElementById('crmSelectVendedor');
    if (selectVendedor && user && user.username) {
      const matched = Array.from(selectVendedor.options).find(opt => opt.value.toLowerCase() === user.username.toLowerCase() || opt.value.toLowerCase() === (user.name || '').toLowerCase());
      if (matched) selectVendedor.value = matched.value;
      else selectVendedor.value = 'Alexandre';
    }

    renderItensCotadosTable();
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

    // Campos comerciais
    document.getElementById('crmInputCondPgto').value = deal.condPgto || '28 DDL';
    document.getElementById('crmInputFreteCobrado').value = deal.freteCobrado || 0;
    document.getElementById('crmInputFreteEmbutido').value = deal.freteEmbutido || 0;
    document.getElementById('crmSelectTipoFrete').value = deal.tipoFrete || 'CIF';
    document.getElementById('crmInputTransportadora').value = deal.transportadora || '';
    document.getElementById('crmInputPrazoEntrega').value = deal.prazoEntrega || '';
    document.getElementById('crmInputPedidoCompraCliente').value = deal.pedidoCompraCliente || '';
    document.getElementById('crmInputObsNfe').value = deal.observacoesNfe || '';

    renderItensCotadosTable();
    openModal(modal);
  }

  /**
   * Renderiza a tabela de itens cotados na modal de cadastro
   */
  function renderItensCotadosTable() {
    const tbody = document.getElementById('crmTbodyItensCotados');
    const totalDisplay = document.getElementById('crmItensCotadosTotalDisplay');
    if (!tbody) return;

    if (currentItems.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 1rem;">
            Nenhum produto adicionado. Clique em "+ Adicionar Item" para incluir produtos cotados.
          </td>
        </tr>
      `;
      if (totalDisplay) totalDisplay.textContent = 'R$ 0,00';
      return;
    }

    let sumTotal = 0;
    let html = '';

    currentItems.forEach((item, index) => {
      const subtotal = (parseFloat(item.quantidade) || 0) * (parseFloat(item.precoNegociado) || 0);
      sumTotal += subtotal;

      html += `
        <tr>
          <td>
            <input type="text" class="form-control form-control-sm crm-item-code" data-index="${index}" value="${escapeHtml(item.codigo || '')}" placeholder="Código (ex: CF-3040)" style="font-family: var(--font-mono); width: 110px;">
          </td>
          <td>
            <input type="text" class="form-control form-control-sm crm-item-desc" data-index="${index}" value="${escapeHtml(item.descricao || '')}" placeholder="Descrição do produto cotado" style="width: 100%;">
          </td>
          <td style="width: 75px;">
            <input type="number" min="1" step="1" class="form-control form-control-sm crm-item-qtd" data-index="${index}" value="${item.quantidade || 1}" style="text-align: right;">
          </td>
          <td style="width: 115px;">
            <input type="number" min="0" step="0.01" class="form-control form-control-sm crm-item-ptabela" data-index="${index}" value="${item.precoTabela || 0}" style="text-align: right;">
          </td>
          <td style="width: 115px;">
            <input type="number" min="0" step="0.01" class="form-control form-control-sm crm-item-pnegociado" data-index="${index}" value="${item.precoNegociado || 0}" style="text-align: right; font-weight: 600; color: #38bdf8;">
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

    // Se houver valor dos itens, sincroniza o campo de valor total do negócio
    const inputValor = document.getElementById('crmInputValor');
    if (inputValor && sumTotal > 0) {
      inputValor.value = sumTotal.toFixed(2);
    }

    // Attach listeners dos inputs dos itens
    tbody.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', (e) => {
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        if (isNaN(idx) || !currentItems[idx]) return;

        if (e.target.classList.contains('crm-item-code')) currentItems[idx].codigo = e.target.value;
        if (e.target.classList.contains('crm-item-desc')) currentItems[idx].descricao = e.target.value;
        if (e.target.classList.contains('crm-item-qtd')) currentItems[idx].quantidade = parseFloat(e.target.value) || 1;
        if (e.target.classList.contains('crm-item-ptabela')) currentItems[idx].precoTabela = parseFloat(e.target.value) || 0;
        if (e.target.classList.contains('crm-item-pnegociado')) currentItems[idx].precoNegociado = parseFloat(e.target.value) || 0;

        // Recalcula totais
        let newSum = 0;
        currentItems.forEach(it => {
          newSum += (parseFloat(it.quantidade) || 0) * (parseFloat(it.precoNegociado) || 0);
        });
        if (totalDisplay) totalDisplay.textContent = formatCurrency(newSum);
        if (inputValor && newSum > 0) inputValor.value = newSum.toFixed(2);
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
      total: 0
    });
    renderItensCotadosTable();
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
    if (!vendedor) {
      alert('Por favor, selecione o vendedor responsável.');
      document.getElementById('crmSelectVendedor')?.focus();
      return;
    }

    const payload = {
      titulo,
      cliente_nome: clienteNome,
      clienteNome,
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
      prazo_entrega: prazoEntrega,
      prazoEntrega,
      num_pedido_compra: pedidoCompraCliente,
      pedidoCompraCliente,
      obs_nfe: observacoesNfe,
      observacoesNfe,
      itens_cotados: currentItems,
      itens: currentItems,
      custom: {
        condPgto,
        freteCobrado,
        freteEmbutido,
        tipoFrete,
        transportadora,
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
      closeModal(document.getElementById('modalCrmOportunidade'));
      renderKanbanBoard();
      updateTopKpis();
      mostrarNotificacao(`Oportunidade "${titulo}" salva com sucesso!`, 'success');
    } catch (err) {
      console.error('Erro ao salvar oportunidade:', err);
      alert('Erro ao salvar oportunidade: ' + err.message);
    } finally {
      if (btnSalvar) {
        btnSalvar.disabled = false;
        btnSalvar.textContent = '💾 Salvar Oportunidade';
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
            <td><code style="color: #38bdf8;">${escapeHtml(item.codigo || '-')}</code></td>
            <td>${escapeHtml(item.descricao || '-')}</td>
            <td style="text-align: right;">${item.quantidade || 1}</td>
            <td style="text-align: right;">${formatCurrency(item.precoNegociado)}</td>
            <td style="text-align: right; font-weight: 700;">${formatCurrency((item.quantidade || 1) * (item.precoNegociado || 0))}</td>
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
    }

    renderActivitiesList(activities);
  }

  /**
   * Renderiza a lista visual da linha do tempo
   */
  function renderActivitiesList(activities) {
    const container = document.getElementById('crmActivitiesTimeline');
    if (!container) return;

    if (!activities || activities.length === 0) {
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

    container.innerHTML = activities.map(act => {
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
      try {
        await fetch(`/api/bi/crm/deals/${encodeURIComponent(currentDeal.id)}/activities`, {
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
      } catch (err) {
        console.warn('⚠️ [CRM Comercial] Falha ao registrar atividade no backend, salvando em cache local:', err.message);
      }

      // Persistência local
      const list = loadActivitiesLocal(currentDeal.id);
      list.unshift(newActivity);
      saveActivitiesLocal(currentDeal.id, list);

      // Limpa campos
      if (descInput) descInput.value = '';
      if (scheduleInput) scheduleInput.value = '';

      // Atualiza timeline
      renderActivitiesList(list);
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
      }
    } else {
      if (title) title.innerHTML = '👤 Cadastro de Cliente (CRM)';
      if (origin === 'deal') {
        const inpDeal = document.getElementById('crmInputCliente');
        if (inpDeal && inpDeal.value.trim()) {
          document.getElementById('crmClienteNomeRazao').value = inpDeal.value.trim();
        }
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

        if (inputCliente) inputCliente.value = clienteSalvo.nome_razao || nomeRazao;
        if (inputCod) inputCod.value = clienteSalvo.protheus_cod || clienteSalvo.id || '';
        if (inputLoja) inputLoja.value = clienteSalvo.protheus_loja || '01';
        if (inputCnpj) inputCnpj.value = clienteSalvo.cnpj_cpf || '';
        if (selectVend && !selectVend.value && clienteSalvo.vendedor_responsavel) {
          selectVend.value = clienteSalvo.vendedor_responsavel;
        }

        mostrarNotificacao('Cliente cadastrado e vinculado à oportunidade!', 'success');
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

    // Filtros de busca e vendedor do Kanban
    const searchInput = document.getElementById('crmSearchInput');
    if (searchInput && !searchInput._hasListener) {
      searchInput._hasListener = true;
      let timer = null;
      searchInput.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(renderKanbanBoard, 300);
      });
    }

    const filterVend = document.getElementById('crmFilterVendedor');
    if (filterVend && !filterVend._hasListener) {
      filterVend._hasListener = true;
      filterVend.addEventListener('change', renderKanbanBoard);
    }

    const filterStatus = document.getElementById('crmFilterStatus');
    if (filterStatus && !filterStatus._hasListener) {
      filterStatus._hasListener = true;
      filterStatus.addEventListener('change', renderKanbanBoard);
    }

    const btnLimpar = document.getElementById('btnCrmLimparFiltros');
    if (btnLimpar && !btnLimpar._hasListener) {
      btnLimpar._hasListener = true;
      btnLimpar.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        if (filterVend) filterVend.value = 'TODOS';
        if (filterStatus) filterStatus.value = 'ATIVOS';
        renderKanbanBoard();
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

    // Submissão de Atividade / Follow-up
    const formAtividade = document.getElementById('formCrmAtividade');
    if (formAtividade && !formAtividade._hasListener) {
      formAtividade._hasListener = true;
      formAtividade.addEventListener('submit', handleAddActivity);
    }

    // Ações no Modal de Detalhes
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

    // Fechamento de modais ao clicar no backdrop (overlay)
    ['modalCrmCliente', 'modalCrmOportunidade', 'modalCrmDetalhes', 'modalCrmMarcarPerdido'].forEach(id => {
      const m = document.getElementById(id);
      if (m && !m._hasBackdropListener) {
        m._hasBackdropListener = true;
        m.addEventListener('click', (e) => {
          if (e.target === m) closeModal(m);
        });
      }
    });

    // Fechamento com tecla Escape
    if (!document._hasCrmEscapeListener) {
      document._hasCrmEscapeListener = true;
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          // Fecha na ordem inversa de precedência (modal de cliente primeiro se estiver aberto)
          const modalCliente = document.getElementById('modalCrmCliente');
          if (modalCliente && modalCliente.style.display !== 'none' && !modalCliente.classList.contains('hidden')) {
            closeModal(modalCliente);
            return;
          }
          const modalPerda = document.getElementById('modalCrmMarcarPerdido');
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
    setupCepAutoLookup();
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
   * Utilitário para fechar modal
   */
  function closeModal(modal) {
    if (!modal) return;
    modal.classList.add('hidden');
    modal.style.display = 'none';
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

    toast.className = `crm-toast crm-toast-${tipo}`;
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
    getDeals: () => deals,
    getClientes: () => clientesList,
    isInitialized: () => isInitialized
  };

  console.log('✅ [CRM Comercial] Módulo CRMModule carregado com sucesso.');
})();
