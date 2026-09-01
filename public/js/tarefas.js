/**
 * public/js/tarefas.js
 * 
 * Módulo da Central de Delegação e Checagem "Minhas Tarefas" (SPA GSI):
 * 1. Links Preferidos e Atalhos do Dia a Dia (Gmail, Drive, CNPJ, Sintegra, Pipedrive, etc.).
 * 2. KPIs Operacionais e Contadores de Pauta do Dia.
 * 3. Barra de Filtros em Linha Única com isolamento de perfil (RBAC).
 * 4. Listagem Paginada com Coluna Solicitante e Botão Rápido de Concluídas.
 * 5. Modal de Criação / Delegação de Tarefas (para si mesmo ou equipe).
 * 6. Modal de Detalhes com Workflow de Validação (Concluir, Reabrir, Finalizar).
 * 7. Linha do Tempo e Feed de Comentários por Tarefa com sanitização contra XSS.
 */

import { escapeHtml, formatDate } from './utils.js';

// Estado Reativo do Módulo de Tarefas
const tarefasState = {
  items: [],
  total: 0,
  limit: 50,
  offset: 0,
  currentPage: 1,
  filterStatus: 'TODOS',
  filterResponsavel: 'TODOS',
  filterPrioridade: 'TODOS',
  filterBusca: '',
  currentTarefaDetalhe: null,
  isAdmin: false,
  currentUser: null,
  usersList: [],
  userLinks: []
};

/**
 * Utilitário de requisições com autenticação JWT
 */
async function fetchWithAuth(url, options = {}) {
  let token = null;
  try {
    const rawSession = localStorage.getItem('conciliacao_fretes_session');
    if (rawSession) {
      const sess = JSON.parse(rawSession);
      if (sess && sess.token) token = sess.token;
    }
  } catch {}

  const headers = options.headers ? new Headers(options.headers) : new Headers();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) {
    console.warn('⚠️ [Tarefas] Sessão expirada.');
  }
  return response;
}

/**
 * Formata status com badge e cor contextual
 */
function renderStatusBadge(status) {
  const st = String(status || 'PENDENTE').toUpperCase();
  switch (st) {
    case 'PENDENTE':
      return `<span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #3b82f6; border: 1px solid rgba(59, 130, 246, 0.3); font-weight: 600; padding: 3px 8px; border-radius: 6px;">⏳ Pendente</span>`;
    case 'CONCLUIDA':
      return `<span class="badge" style="background: rgba(234, 179, 8, 0.15); color: #eab308; border: 1px solid rgba(234, 179, 8, 0.3); font-weight: 600; padding: 3px 8px; border-radius: 6px;">🟡 Concluída (Validação)</span>`;
    case 'REABERTA':
      return `<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); font-weight: 600; padding: 3px 8px; border-radius: 6px;">🔄 Reaberta</span>`;
    case 'FINALIZADA':
      return `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); font-weight: 600; padding: 3px 8px; border-radius: 6px;">✅ Finalizada</span>`;
    case 'CANCELADA':
      return `<span class="badge" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.3); font-weight: 600; padding: 3px 8px; border-radius: 6px;">🚫 Cancelada</span>`;
    default:
      return `<span class="badge" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8; padding: 3px 8px; border-radius: 6px;">${escapeHtml(st)}</span>`;
  }
}

/**
 * Formata prioridade com ícone
 */
function renderPrioridadeBadge(prioridade) {
  const prio = String(prioridade || 'MEDIA').toUpperCase();
  switch (prio) {
    case 'URGENTE':
      return `<span style="color: #ef4444; font-weight: 700; font-size: 0.85rem;"><span style="display:inline-block; animation: pulse 1.5s infinite;">🔴</span> Urgente</span>`;
    case 'ALTA':
      return `<span style="color: #f97316; font-weight: 600; font-size: 0.85rem;">🟠 Alta</span>`;
    case 'MEDIA':
      return `<span style="color: #3b82f6; font-weight: 500; font-size: 0.85rem;">🟢 Média</span>`;
    case 'BAIXA':
      return `<span style="color: #64748b; font-weight: 400; font-size: 0.85rem;">⚪ Baixa</span>`;
    default:
      return `<span style="color: #94a3b8; font-size: 0.85rem;">${escapeHtml(prio)}</span>`;
  }
}

/**
 * Inicialização do Módulo de Tarefas
 */
export async function initTarefasModule() {
  console.log('📋 [Tarefas] Inicializando módulo Minhas Tarefas...');

  // 1. Identifica usuário da sessão
  try {
    const rawSession = localStorage.getItem('conciliacao_fretes_session');
    if (rawSession) {
      const sess = JSON.parse(rawSession);
      tarefasState.currentUser = sess.user || null;
      tarefasState.isAdmin = (sess.user && (sess.user.username.toLowerCase() === 'alexandre' || sess.user.role === 'admin'));
    }
  } catch {}

  // 2. Carrega lista de usuários para os selects de responsável
  await carregarUsuariosDisponiveis();

  // 3. Registra Event Listeners
  setupTarefasEventListeners();

  // 4. Carrega Links Preferidos, KPIs e Tarefas
  await carregarLinksPreferidos();
  await carregarTarefasKpis();
  await carregarTarefas(1);
}

/**
 * Carrega a lista de colaboradores ativos
 */
async function carregarUsuariosDisponiveis() {
  try {
    const resp = await fetchWithAuth('/api/auth/users');
    if (resp.ok) {
      const data = await resp.json();
      if (data && Array.isArray(data.users)) {
        tarefasState.usersList = data.users.filter(u => u.active !== false);
        popularSelectsUsuarios();
      }
    }
  } catch (err) {
    console.warn('⚠️ [Tarefas] Aviso ao buscar usuários:', err.message);
  }
}

/**
 * Popula dropdowns de responsáveis no filtro e na modal de criação
 */
function popularSelectsUsuarios() {
  const filterResp = document.getElementById('filterTarefaResp');
  const modalResp = document.getElementById('tarefaRespSelect');

  if (filterResp) {
    let options = '<option value="TODOS">👥 Todos os Colaboradores</option>';
    if (!tarefasState.isAdmin && tarefasState.currentUser) {
      // Usuário comum só filtra por si mesmo
      options = `<option value="${escapeHtml(tarefasState.currentUser.username)}">👤 Minhas Tarefas (${escapeHtml(tarefasState.currentUser.name || tarefasState.currentUser.username)})</option>`;
      filterResp.innerHTML = options;
      filterResp.disabled = true;
    } else {
      tarefasState.usersList.forEach(u => {
        options += `<option value="${escapeHtml(u.username)}">${escapeHtml(u.name || u.username)} (${escapeHtml(u.username)})</option>`;
      });
      filterResp.innerHTML = options;
      filterResp.disabled = false;
    }
  }

  if (modalResp) {
    let modalOptions = '';
    if (!tarefasState.isAdmin && tarefasState.currentUser) {
      // Usuário comum cria para si mesmo
      modalOptions = `<option value="${escapeHtml(tarefasState.currentUser.username)}" data-name="${escapeHtml(tarefasState.currentUser.name || tarefasState.currentUser.username)}" selected>Para mim mesmo (${escapeHtml(tarefasState.currentUser.name || tarefasState.currentUser.username)})</option>`;
      modalResp.innerHTML = modalOptions;
      modalResp.disabled = true;
    } else {
      modalResp.disabled = false;
      tarefasState.usersList.forEach(u => {
        const isSelected = tarefasState.currentUser && u.username.toLowerCase() === tarefasState.currentUser.username.toLowerCase();
        modalOptions += `<option value="${escapeHtml(u.username)}" data-name="${escapeHtml(u.name || u.username)}" ${isSelected ? 'selected' : ''}>${escapeHtml(u.name || u.username)}</option>`;
      });
      modalResp.innerHTML = modalOptions;
    }
  }
}

/**
 * ----------------------------------------------------------------------------
 * SEÇÃO DE LINKS PREFERIDOS DO USUÁRIO (ATALHOS DO DIA A DIA)
 * ----------------------------------------------------------------------------
 */

export async function carregarLinksPreferidos() {
  try {
    const resp = await fetchWithAuth('/api/user/links');
    if (!resp.ok) return;

    const data = await resp.json();
    tarefasState.userLinks = Array.isArray(data.links) ? data.links : [];
    renderLinksPreferidos();
  } catch (err) {
    console.warn('⚠️ [Tarefas] Erro ao buscar links preferidos:', err.message);
  }
}

function renderLinksPreferidos() {
  const container = document.getElementById('userLinksContainer');
  if (!container) return;

  if (tarefasState.userLinks.length === 0) {
    container.innerHTML = `
      <span style="font-size: 0.82rem; color: var(--text-muted);">
        Nenhum atalho cadastrado. Clique em <strong>➕ Adicionar Link</strong> para incluir seus acessos rápidos.
      </span>
    `;
    return;
  }

  let html = '';
  tarefasState.userLinks.forEach(link => {
    html += `
      <div class="user-link-chip" style="display: inline-flex; align-items: center; background: rgba(30, 41, 59, 0.7); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 20px; padding: 4px 10px; font-size: 0.82rem; gap: 6px; transition: all 0.2s ease;">
        <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer" style="text-decoration: none; color: var(--text-primary); font-weight: 500; display: inline-flex; align-items: center; gap: 4px;" title="Abrir ${escapeHtml(link.titulo)} em nova janela">
          <span>${escapeHtml(link.icon || '🔗')}</span>
          <span>${escapeHtml(link.titulo)}</span>
        </a>
        <button onclick="window.tarefasModule.excluirLinkPreferido('${escapeHtml(link.id)}')" title="Remover este link" aria-label="Remover atalho ${escapeHtml(link.titulo)}" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.85rem; padding: 0 2px; line-height: 1; border-radius: 50%;">
          &times;
        </button>
      </div>
    `;
  });

  container.innerHTML = html;
}

export function abrirModalNovoLink() {
  const modal = document.getElementById('modalNovoLink');
  const form = document.getElementById('formNovoLink');
  if (form) form.reset();
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }
}

export function fecharModalNovoLink() {
  const modal = document.getElementById('modalNovoLink');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
}

export async function salvarNovoLink() {
  const tituloInp = document.getElementById('linkTituloInput');
  const urlInp = document.getElementById('linkUrlInput');
  const iconSelect = document.getElementById('linkIconSelect');
  const btnSalvar = document.getElementById('btnSalvarNovoLink');

  if (!tituloInp || !tituloInp.value.trim()) {
    alert('Por favor, informe o título do atalho (ex: Gmail, Sintegra).');
    if (tituloInp) tituloInp.focus();
    return;
  }

  if (!urlInp || !urlInp.value.trim()) {
    alert('Por favor, informe o endereço web (URL).');
    if (urlInp) urlInp.focus();
    return;
  }

  const payload = {
    titulo: tituloInp.value.trim(),
    url: urlInp.value.trim(),
    icon: iconSelect ? iconSelect.value : '🔗'
  };

  if (btnSalvar) {
    btnSalvar.disabled = true;
    btnSalvar.textContent = 'Salvando...';
  }

  try {
    const resp = await fetchWithAuth('/api/user/links', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const data = await resp.json();
    if (!resp.ok || !data.success) throw new Error(data.message || 'Erro ao salvar link.');

    fecharModalNovoLink();
    await carregarLinksPreferidos();
  } catch (err) {
    alert(`Erro ao salvar link: ${err.message}`);
  } finally {
    if (btnSalvar) {
      btnSalvar.disabled = false;
      btnSalvar.textContent = '💾 Adicionar Link';
    }
  }
}

export async function excluirLinkPreferido(linkId) {
  if (!confirm('Deseja remover este atalho dos seus links preferidos?')) return;

  try {
    const resp = await fetchWithAuth(`/api/user/links/${linkId}`, { method: 'DELETE' });
    const data = await resp.json();
    if (!resp.ok || !data.success) throw new Error(data.message || 'Erro ao excluir link.');

    await carregarLinksPreferidos();
  } catch (err) {
    alert(`Erro ao remover link: ${err.message}`);
  }
}

/**
 * ----------------------------------------------------------------------------
 * LISTENERS DA INTERFACE
 * ----------------------------------------------------------------------------
 */

function setupTarefasEventListeners() {
  // Botão Nova Tarefa
  const btnNova = document.getElementById('btnNovaTarefa');
  if (btnNova) {
    btnNova.onclick = () => abrirModalNovaTarefa();
  }

  // Botão Adicionar Link
  const btnAddLink = document.getElementById('btnAddUserLink');
  if (btnAddLink) {
    btnAddLink.onclick = () => abrirModalNovoLink();
  }

  // Botões de Alternância Rápida (Pauta Ativa vs Concluídas)
  const btnVerAtivas = document.getElementById('btnVerTarefasAtivas');
  const btnVerConcluidas = document.getElementById('btnVerTarefasConcluidas');

  if (btnVerAtivas) {
    btnVerAtivas.onclick = () => {
      btnVerAtivas.classList.add('active');
      if (btnVerConcluidas) btnVerConcluidas.classList.remove('active');
      tarefasState.filterStatus = 'TODOS';
      const filterStatus = document.getElementById('filterTarefaStatus');
      if (filterStatus) filterStatus.value = 'TODOS';
      carregarTarefas(1);
    };
  }

  if (btnVerConcluidas) {
    btnVerConcluidas.onclick = () => {
      btnVerConcluidas.classList.add('active');
      if (btnVerAtivas) btnVerAtivas.classList.remove('active');
      tarefasState.filterStatus = 'CONCLUIDA';
      const filterStatus = document.getElementById('filterTarefaStatus');
      if (filterStatus) filterStatus.value = 'CONCLUIDA';
      carregarTarefas(1);
    };
  }

  // Filtros
  const filterStatus = document.getElementById('filterTarefaStatus');
  if (filterStatus) {
    filterStatus.onchange = (e) => {
      tarefasState.filterStatus = e.target.value;
      if (btnVerAtivas && btnVerConcluidas) {
        if (e.target.value === 'CONCLUIDA' || e.target.value === 'FINALIZADA') {
          btnVerConcluidas.classList.add('active');
          btnVerAtivas.classList.remove('active');
        } else {
          btnVerAtivas.classList.add('active');
          btnVerConcluidas.classList.remove('active');
        }
      }
      carregarTarefas(1);
    };
  }

  const filterResp = document.getElementById('filterTarefaResp');
  if (filterResp) {
    filterResp.onchange = (e) => {
      tarefasState.filterResponsavel = e.target.value;
      carregarTarefas(1);
    };
  }

  const filterPrioridade = document.getElementById('filterTarefaPrioridade');
  if (filterPrioridade) {
    filterPrioridade.onchange = (e) => {
      tarefasState.filterPrioridade = e.target.value;
      carregarTarefas(1);
    };
  }

  const inputBusca = document.getElementById('inputBuscaTarefa');
  if (inputBusca) {
    let debounceTimer = null;
    inputBusca.oninput = (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        tarefasState.filterBusca = e.target.value;
        carregarTarefas(1);
      }, 350);
    };
  }

  const btnLimpar = document.getElementById('btnLimparFiltrosTarefas');
  if (btnLimpar) {
    btnLimpar.onclick = () => {
      if (filterStatus) filterStatus.value = 'TODOS';
      if (filterResp && !filterResp.disabled) filterResp.value = 'TODOS';
      if (filterPrioridade) filterPrioridade.value = 'TODOS';
      if (inputBusca) inputBusca.value = '';
      if (btnVerAtivas) btnVerAtivas.classList.add('active');
      if (btnVerConcluidas) btnVerConcluidas.classList.remove('active');
      tarefasState.filterStatus = 'TODOS';
      tarefasState.filterResponsavel = 'TODOS';
      tarefasState.filterPrioridade = 'TODOS';
      tarefasState.filterBusca = '';
      carregarTarefas(1);
    };
  }

  // Botão Recarregar
  const btnRefresh = document.getElementById('btnRefreshTarefas');
  if (btnRefresh) {
    btnRefresh.onclick = () => {
      carregarLinksPreferidos();
      carregarTarefasKpis();
      carregarTarefas(tarefasState.currentPage);
    };
  }

  // Modal Nova Tarefa
  const formNova = document.getElementById('formNovaTarefa');
  if (formNova) {
    formNova.onsubmit = (e) => {
      e.preventDefault();
      salvarNovaTarefa();
    };
  }

  const btnFecharModalNova = document.getElementById('btnFecharModalNovaTarefa');
  if (btnFecharModalNova) {
    btnFecharModalNova.onclick = () => fecharModalNovaTarefa();
  }

  // Modal Novo Link
  const formLink = document.getElementById('formNovoLink');
  if (formLink) {
    formLink.onsubmit = (e) => {
      e.preventDefault();
      salvarNovoLink();
    };
  }

  const btnFecharModalNovoLink = document.getElementById('btnFecharModalNovoLink');
  if (btnFecharModalNovoLink) {
    btnFecharModalNovoLink.onclick = () => fecharModalNovoLink();
  }

  // Modal Detalhes Tarefa
  const btnFecharModalDetalhes = document.getElementById('btnFecharModalTarefaDetalhes');
  if (btnFecharModalDetalhes) {
    btnFecharModalDetalhes.onclick = () => fecharModalDetalhesTarefa();
  }

  // Form Comentários
  const formComentario = document.getElementById('formNovoComentarioTarefa');
  if (formComentario) {
    formComentario.onsubmit = (e) => {
      e.preventDefault();
      enviarComentarioTarefa();
    };
  }
}

/**
 * Consulta e atualiza os 4 KPIs de cabeçalho
 */
export async function carregarTarefasKpis() {
  try {
    const resp = await fetchWithAuth('/api/tarefas/kpis');
    if (!resp.ok) return;

    const data = await resp.json();
    if (data && data.kpis) {
      const { pendentes, aguardando_validacao, reabertas_urgentes, concluidas_mes } = data.kpis;
      
      const elPend = document.getElementById('kpiTarefasPendentes');
      const elAguar = document.getElementById('kpiTarefasAguardando');
      const elReab = document.getElementById('kpiTarefasReabertas');
      const elConc = document.getElementById('kpiTarefasConcluidas');

      if (elPend) elPend.textContent = pendentes || 0;
      if (elAguar) elAguar.textContent = aguardando_validacao || 0;
      if (elReab) elReab.textContent = reabertas_urgentes || 0;
      if (elConc) elConc.textContent = concluidas_mes || 0;
    }
  } catch (err) {
    console.warn('⚠️ [Tarefas] Erro ao carregar KPIs:', err.message);
  }
}

/**
 * Consulta e renderiza a listagem paginada de tarefas
 */
export async function carregarTarefas(page = 1) {
  tarefasState.currentPage = page;
  tarefasState.offset = (page - 1) * tarefasState.limit;

  const tbody = document.getElementById('tarefasTableBody');
  const countBadge = document.getElementById('tarefasCountBadge');
  const emptyState = document.getElementById('tarefasEmptyState');

  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 2.5rem; color: var(--text-muted);">
          <div style="display: inline-block; animation: spin 1s linear infinite; font-size: 1.5rem; margin-bottom: 0.5rem;">⏳</div>
          <div>Carregando tarefas em tempo real...</div>
        </td>
      </tr>
    `;
  }

  try {
    const params = new URLSearchParams({
      status: tarefasState.filterStatus,
      responsavel: tarefasState.filterResponsavel,
      prioridade: tarefasState.filterPrioridade,
      busca: tarefasState.filterBusca,
      limit: tarefasState.limit,
      offset: tarefasState.offset
    });

    const resp = await fetchWithAuth(`/api/tarefas?${params.toString()}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();
    tarefasState.items = data.items || [];
    tarefasState.total = data.total || 0;
    if (data.user) {
      tarefasState.isAdmin = !!data.user.isAdmin;
    }

    if (countBadge) {
      countBadge.textContent = `${tarefasState.total} tarefa${tarefasState.total === 1 ? '' : 's'}`;
    }

    renderTarefasTable();
    renderTarefasPagination();
  } catch (err) {
    console.error('❌ [Tarefas] Erro ao buscar tarefas:', err);
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 2rem; color: #f87171;">
            ⚠️ Não foi possível carregar as tarefas: ${escapeHtml(err.message)}
          </td>
        </tr>
      `;
    }
  }
}

/**
 * Renderiza as linhas da tabela de tarefas
 */
function renderTarefasTable() {
  const tbody = document.getElementById('tarefasTableBody');
  const emptyState = document.getElementById('tarefasEmptyState');
  if (!tbody) return;

  if (tarefasState.items.length === 0) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');

  let html = '';
  tarefasState.items.forEach(t => {
    const commentsCount = Array.isArray(t.comentarios) ? t.comentarios.length : 0;
    const isOwner = tarefasState.currentUser && t.responsavel_username.toLowerCase() === tarefasState.currentUser.username.toLowerCase();
    const canConclude = isOwner && (t.status === 'PENDENTE' || t.status === 'REABERTA');
    const dataLimiteFmt = t.data_limite ? formatDate(t.data_limite) : '<span style="color: var(--text-muted); font-size: 0.8rem;">Sem prazo</span>';

    // Identificação do Solicitante
    const isSelfCreated = (t.criado_por_username || '').toLowerCase() === (t.responsavel_username || '').toLowerCase();
    const solicitanteDisplay = isSelfCreated 
      ? `<span class="badge" style="background: rgba(148, 163, 184, 0.12); color: var(--text-muted); font-size: 0.78rem; padding: 2px 6px; border-radius: 4px;">👤 Próprio Usuário</span>`
      : `<span style="font-size: 0.85rem; font-weight: 500; color: #38bdf8;">👤 ${escapeHtml(t.criado_por_nome || t.criado_por_username)}</span>`;

    // Checa se prazo está atrasado
    let prazoAtrasado = false;
    if (t.data_limite && t.status !== 'FINALIZADA' && t.status !== 'CONCLUIDA') {
      const hoje = new Date().toISOString().split('T')[0];
      const limite = String(t.data_limite).slice(0, 10);
      if (limite < hoje) prazoAtrasado = true;
    }

    html += `
      <tr class="tarefa-row" data-id="${t.id}" style="cursor: pointer; transition: background 0.15s ease;" onclick="window.tarefasModule.abrirModalDetalhesTarefa(${t.id})">
        <td style="text-align: center;">
          <span style="font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; color: var(--text-muted); font-weight: 600;">#${t.id}</span>
        </td>
        <td style="text-align: center;">
          ${renderStatusBadge(t.status)}
        </td>
        <td style="text-align: center;">
          ${renderPrioridadeBadge(t.prioridade)}
        </td>
        <td>
          <div style="font-weight: 600; color: var(--text-primary); font-size: 0.92rem; margin-bottom: 2px;">
            ${escapeHtml(t.titulo)}
          </div>
          ${t.descricao ? `<div style="color: var(--text-muted); font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 380px;">${escapeHtml(t.descricao)}</div>` : ''}
        </td>
        <td>
          ${solicitanteDisplay}
        </td>
        <td>
          <div style="display: flex; align-items: center; gap: 6px;">
            <div style="width: 24px; height: 24px; border-radius: 50%; background: linear-gradient(135deg, #38bdf8, #2563eb); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 0.72rem; font-weight: 700;">
              ${escapeHtml((t.responsavel_nome || t.responsavel_username || '?').charAt(0).toUpperCase())}
            </div>
            <span style="font-size: 0.88rem; font-weight: 500;">${escapeHtml(t.responsavel_nome || t.responsavel_username)}</span>
          </div>
        </td>
        <td style="text-align: center;">
          <span style="${prazoAtrasado ? 'color: #ef4444; font-weight: 700; background: rgba(239, 68, 68, 0.1); padding: 2px 6px; border-radius: 4px;' : 'font-size: 0.85rem;'}">
            ${prazoAtrasado ? '⚠️ ' : ''}${dataLimiteFmt}
          </span>
        </td>
        <td style="text-align: center;" onclick="event.stopPropagation();">
          <div style="display: flex; gap: 6px; justify-content: center; align-items: center;">
            <button class="btn btn-outline btn-sm" onclick="window.tarefasModule.abrirModalDetalhesTarefa(${t.id})" title="Ver detalhes e comentários">
              👁️ <span style="margin-left: 2px; font-size: 0.78rem;">${commentsCount > 0 ? `💬 ${commentsCount}` : 'Abrir'}</span>
            </button>
            ${canConclude ? `
              <button class="btn btn-success btn-sm" onclick="window.tarefasModule.concluirTarefa(${t.id})" title="Marcar como Concluída" style="padding: 4px 8px; font-size: 0.78rem; background: #10b981; color: #fff; border: none; border-radius: 4px; cursor: pointer;">
                ✓ Feito
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

/**
 * Renderiza paginação
 */
function renderTarefasPagination() {
  const container = document.getElementById('tarefasPagination');
  if (!container) return;

  const totalPages = Math.ceil(tarefasState.total / tarefasState.limit) || 1;
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  let html = `
    <div style="display: flex; gap: 8px; align-items: center; justify-content: flex-end; padding: 1rem 0;">
      <button class="btn btn-outline btn-sm" ${tarefasState.currentPage <= 1 ? 'disabled' : ''} onclick="window.tarefasModule.carregarTarefas(${tarefasState.currentPage - 1})">
        ◀ Anterior
      </button>
      <span style="font-size: 0.85rem; color: var(--text-muted);">
        Página <strong>${tarefasState.currentPage}</strong> de <strong>${totalPages}</strong>
      </span>
      <button class="btn btn-outline btn-sm" ${tarefasState.currentPage >= totalPages ? 'disabled' : ''} onclick="window.tarefasModule.carregarTarefas(${tarefasState.currentPage + 1})">
        Próxima ▶
      </button>
    </div>
  `;
  container.innerHTML = html;
}

/**
 * Modal de Criação de Tarefa
 */
export function abrirModalNovaTarefa() {
  const modal = document.getElementById('modalNovaTarefa');
  const form = document.getElementById('formNovaTarefa');
  if (form) form.reset();

  popularSelectsUsuarios();

  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }
}

export function fecharModalNovaTarefa() {
  const modal = document.getElementById('modalNovaTarefa');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
}

export async function salvarNovaTarefa() {
  const tituloInp = document.getElementById('tarefaTituloInput');
  const descInp = document.getElementById('tarefaDescInput');
  const respSelect = document.getElementById('tarefaRespSelect');
  const prioSelect = document.getElementById('tarefaPrioSelect');
  const prazoInp = document.getElementById('tarefaPrazoInput');
  const btnSalvar = document.getElementById('btnSalvarNovaTarefa');

  if (!tituloInp || !tituloInp.value.trim()) {
    alert('Por favor, informe o título da tarefa.');
    if (tituloInp) tituloInp.focus();
    return;
  }

  const selectedOpt = respSelect ? respSelect.options[respSelect.selectedIndex] : null;
  const respUsername = respSelect ? respSelect.value : '';
  const respNome = selectedOpt ? selectedOpt.getAttribute('data-name') : respUsername;

  const payload = {
    titulo: tituloInp.value.trim(),
    descricao: descInp ? descInp.value.trim() : '',
    responsavel_username: respUsername,
    responsavel_nome: respNome,
    prioridade: prioSelect ? prioSelect.value : 'MEDIA',
    data_limite: prazoInp && prazoInp.value ? prazoInp.value : null
  };

  if (btnSalvar) {
    btnSalvar.disabled = true;
    btnSalvar.textContent = 'Salvando...';
  }

  try {
    const resp = await fetchWithAuth('/api/tarefas', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const data = await resp.json();
    if (!resp.ok || !data.success) {
      throw new Error(data.message || 'Erro ao criar tarefa.');
    }

    fecharModalNovaTarefa();
    await carregarTarefasKpis();
    await carregarTarefas(1);
  } catch (err) {
    alert(`Erro ao salvar tarefa: ${err.message}`);
  } finally {
    if (btnSalvar) {
      btnSalvar.disabled = false;
      btnSalvar.textContent = '💾 Criar Tarefa';
    }
  }
}

/**
 * Modal de Detalhes da Tarefa & Feed de Comentários
 */
export async function abrirModalDetalhesTarefa(id) {
  const modal = document.getElementById('modalTarefaDetalhes');
  if (!modal) return;

  modal.classList.remove('hidden');
  modal.style.display = 'flex';

  const bodyEl = document.getElementById('modalTarefaDetalhesContent');
  if (bodyEl) {
    bodyEl.innerHTML = `
      <div style="text-align: center; padding: 3rem; color: var(--text-muted);">
        <div style="display: inline-block; animation: spin 1s linear infinite; font-size: 2rem; margin-bottom: 0.8rem;">⏳</div>
        <div>Carregando detalhes da tarefa #${id}...</div>
      </div>
    `;
  }

  try {
    const resp = await fetchWithAuth(`/api/tarefas/${id}`);
    const data = await resp.json();

    if (!resp.ok || !data.success || !data.tarefa) {
      throw new Error(data.message || 'Não foi possível carregar a tarefa.');
    }

    tarefasState.currentTarefaDetalhe = data.tarefa;
    renderDetalhesModal(data.tarefa);
  } catch (err) {
    if (bodyEl) {
      bodyEl.innerHTML = `
        <div style="text-align: center; padding: 2rem; color: #f87171;">
          ⚠️ ${escapeHtml(err.message)}
        </div>
      `;
    }
  }
}

export function fecharModalDetalhesTarefa() {
  const modal = document.getElementById('modalTarefaDetalhes');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
  tarefasState.currentTarefaDetalhe = null;
}

/**
 * Renderiza o layout interno de 2 colunas do Modal de Detalhes
 */
function renderDetalhesModal(tarefa) {
  const bodyEl = document.getElementById('modalTarefaDetalhesContent');
  if (!bodyEl) return;

  const isOwner = tarefasState.currentUser && tarefa.responsavel_username.toLowerCase() === tarefasState.currentUser.username.toLowerCase();
  const isAdmin = tarefasState.isAdmin;
  const comments = Array.isArray(tarefa.comentarios) ? tarefa.comentarios : [];

  let acoesHtml = '';

  // 1. Ações do Operador Responsável
  if (isOwner && (tarefa.status === 'PENDENTE' || tarefa.status === 'REABERTA')) {
    acoesHtml += `
      <button class="btn btn-success" onclick="window.tarefasModule.concluirTarefa(${tarefa.id})" style="background: #10b981; color: #fff; font-weight: 600; padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer;">
        ✅ Marcar como Concluída (Entregar para Validação)
      </button>
    `;
  }

  // 2. Ações do Gestor / Admin
  if (isAdmin) {
    if (tarefa.status === 'CONCLUIDA' || tarefa.status === 'PENDENTE' || tarefa.status === 'REABERTA') {
      acoesHtml += `
        <button class="btn btn-primary" onclick="window.tarefasModule.finalizarTarefa(${tarefa.id})" style="background: #2563eb; color: #fff; font-weight: 600; padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer;">
          ✨ Aprovar e Finalizar
        </button>
        <button class="btn btn-warning" onclick="window.tarefasModule.reabrirTarefa(${tarefa.id})" style="background: #eab308; color: #000; font-weight: 600; padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer;">
          🔄 Reabrir Tarefa (Faltou Algo)
        </button>
      `;
    } else if (tarefa.status === 'FINALIZADA') {
      acoesHtml += `
        <button class="btn btn-warning" onclick="window.tarefasModule.reabrirTarefa(${tarefa.id})" style="background: #eab308; color: #000; font-weight: 600; padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer;">
          🔄 Reabrir Tarefa Finalizada
        </button>
      `;
    }

    acoesHtml += `
      <button class="btn btn-outline" onclick="window.tarefasModule.excluirTarefa(${tarefa.id})" style="color: #ef4444; border-color: rgba(239, 68, 68, 0.4); font-size: 0.82rem; padding: 6px 12px; margin-left: auto; cursor: pointer;">
        🗑️ Excluir
      </button>
    `;
  }

  bodyEl.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 1.25rem;">
      <!-- Cabeçalho da Tarefa -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid var(--border-color, #334155); padding-bottom: 1rem; flex-wrap: wrap; gap: 0.8rem;">
        <div>
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
            <span style="font-family: 'JetBrains Mono', monospace; color: var(--text-muted); font-weight: 700; font-size: 1.1rem;">#${tarefa.id}</span>
            <h2 style="margin: 0; font-size: 1.25rem; font-weight: 700; color: var(--text-primary);">${escapeHtml(tarefa.titulo)}</h2>
          </div>
          <div style="font-size: 0.82rem; color: var(--text-muted); display: flex; gap: 12px; flex-wrap: wrap;">
            <span>👤 Solicitante: <strong>${escapeHtml(tarefa.criado_por_nome || tarefa.criado_por_username)}</strong></span>
            <span>📅 Criação: <strong>${formatDate(tarefa.created_at)}</strong></span>
            <span>🎯 Responsável: <strong>${escapeHtml(tarefa.responsavel_nome || tarefa.responsavel_username)}</strong></span>
            <span>⏳ Prazo: <strong>${tarefa.data_limite ? formatDate(tarefa.data_limite) : 'Sem prazo'}</strong></span>
          </div>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          ${renderPrioridadeBadge(tarefa.prioridade)}
          ${renderStatusBadge(tarefa.status)}
        </div>
      </div>

      <!-- Barra de Ações Operacionais -->
      ${acoesHtml ? `
        <div style="background: rgba(30, 41, 59, 0.4); border: 1px solid var(--border-color, #334155); border-radius: 8px; padding: 0.75rem 1rem; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
          <span style="font-size: 0.85rem; font-weight: 600; color: var(--text-muted); margin-right: 4px;">⚡ Ações:</span>
          ${acoesHtml}
        </div>
      ` : ''}

      <!-- Grid Principal: Instruções (Esquerda) e Linha do Tempo / Chat (Direita) -->
      <div class="tarefas-modal-grid">
        
        <!-- Coluna Esquerda: O que deve ser feito -->
        <div style="display: flex; flex-direction: column; gap: 0.75rem;">
          <h4 style="margin: 0; font-size: 0.92rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">
            📝 O que deve ser feito (Instruções)
          </h4>
          <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid var(--border-color, #334155); border-radius: 8px; padding: 1rem; flex: 1; font-size: 0.92rem; line-height: 1.6; color: var(--text-primary); white-space: pre-wrap;">${escapeHtml(tarefa.descricao || 'Nenhuma instrução adicional informada.')}</div>
        </div>

        <!-- Coluna Direita: Linha do Tempo e Interações -->
        <div style="display: flex; flex-direction: column; gap: 0.75rem;">
          <h4 style="margin: 0; font-size: 0.92rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">
            💬 Histórico e Comentários (${comments.length})
          </h4>
          
          <!-- Lista de Comentários / Chat -->
          <div id="tarefaCommentsContainer" style="background: rgba(15, 23, 42, 0.6); border: 1px solid var(--border-color, #334155); border-radius: 8px; padding: 0.85rem; flex: 1; max-height: 280px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.65rem;">
            ${comments.length === 0 ? `
              <div style="text-align: center; color: var(--text-muted); padding: 2rem 0; font-size: 0.85rem;">
                Nenhum comentário registrado ainda.<br>Envie uma mensagem abaixo para registrar na tarefa.
              </div>
            ` : comments.map(c => `
              <div style="background: rgba(30, 41, 59, 0.7); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 0.6rem 0.8rem; font-size: 0.85rem;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 0.76rem; color: var(--text-muted);">
                  <strong style="color: #38bdf8;">${escapeHtml(c.autor_nome || c.autor_username)}</strong>
                  <span>${formatDate(c.created_at)}</span>
                </div>
                <div style="color: var(--text-primary); line-height: 1.4; word-break: break-word;">${escapeHtml(c.mensagem)}</div>
              </div>
            `).join('')}
          </div>

          <!-- Caixa de Envio de Comentário -->
          <div style="display: flex; gap: 8px;">
            <input type="text" id="inputNovoComentarioTarefa" class="form-control" placeholder="Escreva uma resposta, link ou observação..." style="flex: 1; font-size: 0.88rem; padding: 8px 12px; border-radius: 6px; background: rgba(30, 41, 59, 0.8); border: 1px solid var(--border-color, #334155); color: var(--text-primary);" onkeydown="if(event.key==='Enter') window.tarefasModule.enviarComentarioTarefa(${tarefa.id});">
            <button class="btn btn-primary" onclick="window.tarefasModule.enviarComentarioTarefa(${tarefa.id})" style="padding: 8px 14px; font-weight: 600; border-radius: 6px; cursor: pointer;">
              Enviar
            </button>
          </div>
        </div>

      </div>
    </div>
  `;

  // Auto-scroll do chat para a última mensagem
  const chatBox = document.getElementById('tarefaCommentsContainer');
  if (chatBox) chatBox.scrollTop = chatBox.scrollHeight;
}

/**
 * Ação: Concluir Tarefa (pelo operador)
 */
export async function concluirTarefa(id) {
  if (!confirm(`Deseja marcar a tarefa #${id} como concluída e enviar para validação?`)) return;

  try {
    const resp = await fetchWithAuth(`/api/tarefas/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'CONCLUIDA' })
    });

    const data = await resp.json();
    if (!resp.ok || !data.success) throw new Error(data.message || 'Erro ao concluir tarefa.');

    await carregarTarefasKpis();
    await carregarTarefas(tarefasState.currentPage);

    if (tarefasState.currentTarefaDetalhe && tarefasState.currentTarefaDetalhe.id === id) {
      await abrirModalDetalhesTarefa(id);
    }
  } catch (err) {
    alert(`Erro ao concluir: ${err.message}`);
  }
}

/**
 * Ação: Reabrir Tarefa (pelo gestor)
 */
export async function reabrirTarefa(id) {
  const justificativa = prompt('Informe o que faltou ou o motivo da reabertura da tarefa:');
  if (justificativa === null) return; // Cancelou
  if (!justificativa.trim()) {
    alert('É obrigatório informar uma justificativa ao reabrir a tarefa.');
    return;
  }

  try {
    const resp = await fetchWithAuth(`/api/tarefas/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'REABERTA',
        justificativa: justificativa.trim()
      })
    });

    const data = await resp.json();
    if (!resp.ok || !data.success) throw new Error(data.message || 'Erro ao reabrir tarefa.');

    await carregarTarefasKpis();
    await carregarTarefas(tarefasState.currentPage);

    if (tarefasState.currentTarefaDetalhe && tarefasState.currentTarefaDetalhe.id === id) {
      await abrirModalDetalhesTarefa(id);
    }
  } catch (err) {
    alert(`Erro ao reabrir: ${err.message}`);
  }
}

/**
 * Ação: Finalizar / Aprovar Tarefa (pelo gestor)
 */
export async function finalizarTarefa(id) {
  if (!confirm(`Deseja aprovar e finalizar a tarefa #${id}?`)) return;

  try {
    const resp = await fetchWithAuth(`/api/tarefas/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'FINALIZADA',
        justificativa: 'Tarefa conferida, aprovada e finalizada pelo gestor.'
      })
    });

    const data = await resp.json();
    if (!resp.ok || !data.success) throw new Error(data.message || 'Erro ao finalizar tarefa.');

    await carregarTarefasKpis();
    await carregarTarefas(tarefasState.currentPage);

    if (tarefasState.currentTarefaDetalhe && tarefasState.currentTarefaDetalhe.id === id) {
      await abrirModalDetalhesTarefa(id);
    }
  } catch (err) {
    alert(`Erro ao finalizar: ${err.message}`);
  }
}

/**
 * Ação: Enviar Comentário
 */
export async function enviarComentarioTarefa(id) {
  const targetId = id || (tarefasState.currentTarefaDetalhe ? tarefasState.currentTarefaDetalhe.id : null);
  if (!targetId) return;

  const inputEl = document.getElementById('inputNovoComentarioTarefa');
  if (!inputEl || !inputEl.value.trim()) return;

  const msg = inputEl.value.trim();
  inputEl.disabled = true;

  try {
    const resp = await fetchWithAuth(`/api/tarefas/${targetId}/comentarios`, {
      method: 'POST',
      body: JSON.stringify({ mensagem: msg })
    });

    const data = await resp.json();
    if (!resp.ok || !data.success) throw new Error(data.message || 'Erro ao enviar comentário.');

    inputEl.value = '';
    await abrirModalDetalhesTarefa(targetId);
  } catch (err) {
    alert(`Erro ao enviar comentário: ${err.message}`);
  } finally {
    if (inputEl) {
      inputEl.disabled = false;
      inputEl.focus();
    }
  }
}

/**
 * Ação: Excluir Tarefa (Admin)
 */
export async function excluirTarefa(id) {
  if (!confirm(`ATENÇÃO: Deseja realmente excluir permanentemente a tarefa #${id}?`)) return;

  try {
    const resp = await fetchWithAuth(`/api/tarefas/${id}`, { method: 'DELETE' });
    const data = await resp.json();
    if (!resp.ok || !data.success) throw new Error(data.message || 'Erro ao excluir tarefa.');

    fecharModalDetalhesTarefa();
    await carregarTarefasKpis();
    await carregarTarefas(1);
  } catch (err) {
    alert(`Erro ao excluir: ${err.message}`);
  }
}

// Expõe globalmente para acesso nos eventos inline do HTML
if (typeof window !== 'undefined') {
  window.initTarefasModule = initTarefasModule;
  window.tarefasModule = {
    initTarefasModule,
    carregarTarefas,
    carregarTarefasKpis,
    carregarLinksPreferidos,
    abrirModalNovaTarefa,
    fecharModalNovaTarefa,
    salvarNovaTarefa,
    abrirModalNovoLink,
    fecharModalNovoLink,
    salvarNovoLink,
    excluirLinkPreferido,
    abrirModalDetalhesTarefa,
    fecharModalDetalhesTarefa,
    concluirTarefa,
    reabrirTarefa,
    finalizarTarefa,
    enviarComentarioTarefa,
    excluirTarefa
  };

  // Auto-inicializa quando o DOM estiver pronto ou quando o módulo for carregado
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        initTarefasModule();
      });
    } else {
      initTarefasModule();
    }
  }
}
