/**
 * public/js/bi_indices.js
 * Módulo Frontend: Índices Financeiros de Liquidez & Drilldown Auditável
 * Plataforma de Apoio GSI (Gemini-Cli)
 */

(function () {
  'use strict';

  let indicesInitialized = false;
  let isIndicesLoading = false;
  let cachedIndicesPayload = null;
  let currentEmpresaFilter = 'ALL';
  let activeModalDrilldownTab = 'modalTabIndicesExtrato';

  /**
   * Helper: Obtém Token JWT da sessão
   */
  function getAuthToken() {
    try {
      const raw = localStorage.getItem('conciliacao_fretes_session');
      if (raw) {
        const sess = JSON.parse(raw);
        if (sess && sess.token) return sess.token;
      }
      return localStorage.getItem('gsi_auth_token');
    } catch {
      return null;
    }
  }

  /**
   * Helper: Formatação Monetária BRL
   */
  function formatMoney(v) {
    const num = Number(v) || 0;
    return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  /**
   * Helper: Formatação de Índice Numérico
   */
  function formatIndex(v) {
    const num = Number(v) || 0;
    return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /**
   * Helper: Formatação de Data
   */
  function formatDate(dStr) {
    if (!dStr) return '-';
    const s = String(dStr).split('T')[0];
    const parts = s.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dStr;
  }

  /**
   * Helper: Escape HTML
   */
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Inicializa a aba de Índices Financeiros quando selecionada
   */
  function initBIIndicesTab() {
    setupIndicesEventListeners();
    if (!cachedIndicesPayload) {
      carregarIndicesFinanceiros(false);
    }
  }

  /**
   * Configura ouvintes de eventos da sub-aba de Índices
   */
  function setupIndicesEventListeners() {
    if (indicesInitialized) return;
    indicesInitialized = true;

    // Seletor de Empresa
    const selEmp = document.getElementById('selEmpresaBiIndices');
    if (selEmp) {
      selEmp.addEventListener('change', (e) => {
        currentEmpresaFilter = e.target.value;
        if (cachedIndicesPayload && cachedIndicesPayload.metricas) {
          renderizarIndicesDashboard(cachedIndicesPayload.metricas, currentEmpresaFilter);
        }
      });
    }

    // Botão Sincronizar Protheus
    const btnSync = document.getElementById('btnSyncBiIndices');
    if (btnSync) {
      btnSync.addEventListener('click', () => {
        carregarIndicesFinanceiros(true);
      });
    }

    // Eventos de Clique nos 3 Cards Principais de Índices (Abre Modal com foco no índice)
    const cardLC = document.getElementById('cardLiquidezCorrente');
    if (cardLC) {
      cardLC.addEventListener('click', () => abrirModalIndicesDrilldown('modalTabIndicesExtrato', 'LC'));
    }

    const cardLS = document.getElementById('cardLiquidezSeca');
    if (cardLS) {
      cardLS.addEventListener('click', () => abrirModalIndicesDrilldown('modalTabIndicesExtrato', 'LS'));
    }

    const cardLI = document.getElementById('cardLiquidezImediata');
    if (cardLI) {
      cardLI.addEventListener('click', () => abrirModalIndicesDrilldown('modalTabIndicesExtrato', 'LI'));
    }

    // Eventos de Clique nos 4 Cards de Componentes
    const cardCompEst = document.getElementById('cardCompEstoque');
    if (cardCompEst) {
      cardCompEst.addEventListener('click', () => abrirModalIndicesDrilldown('modalTabIndicesEstoque'));
    }

    const cardCompBco = document.getElementById('cardCompBancos');
    if (cardCompBco) {
      cardCompBco.addEventListener('click', () => abrirModalIndicesDrilldown('modalTabIndicesBancos'));
    }

    const cardCompRec = document.getElementById('cardCompReceber');
    if (cardCompRec) {
      cardCompRec.addEventListener('click', () => abrirModalIndicesDrilldown('modalTabIndicesReceber'));
    }

    const cardCompPag = document.getElementById('cardCompPagar');
    if (cardCompPag) {
      cardCompPag.addEventListener('click', () => abrirModalIndicesDrilldown('modalTabIndicesPagar'));
    }

    // Fechamento da Modal
    const btnClose = document.getElementById('btnCloseModalIndices');
    const btnFechar = document.getElementById('btnFecharModalIndices');
    const modal = document.getElementById('modalIndicesDrilldown');

    if (btnClose) btnClose.addEventListener('click', fecharModalIndices);
    if (btnFechar) btnFechar.addEventListener('click', fecharModalIndices);
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) fecharModalIndices();
      });
    }

    // Abas Internas da Modal
    const tabBtns = document.querySelectorAll('.btn-modal-indices-tab');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-target');
        alternarAbaModalIndices(targetId);
      });
    });

    // Inputs de Busca dentro da Modal
    setupModalSearchFilter('inputBuscaReceberModal', 'tbodyModalReceber');
    setupModalSearchFilter('inputBuscaPagarModal', 'tbodyModalPagar');
    setupModalSearchFilter('inputBuscaEstoqueModal', 'tbodyModalEstoque');
  }

  /**
   * Helper para busca/filtro em tempo real nas tabelas da modal
   */
  function setupModalSearchFilter(inputId, tbodyId) {
    const input = document.getElementById(inputId);
    if (!input) return;

    input.addEventListener('input', (e) => {
      const term = String(e.target.value || '').toLowerCase().trim();
      const tbody = document.getElementById(tbodyId);
      if (!tbody) return;

      const rows = tbody.querySelectorAll('tr');
      rows.forEach(tr => {
        if (tr.classList.contains('empty-row')) return;
        const text = tr.textContent.toLowerCase();
        tr.style.display = text.includes(term) ? '' : 'none';
      });
    });
  }

  /**
   * Carrega os dados de índices do backend (GET /api/bi/indices ou POST /api/bi/indices/sync)
   */
  async function carregarIndicesFinanceiros(forceSync = false) {
    if (isIndicesLoading) return;

    const token = getAuthToken();
    if (!token) {
      alert('Sessão expirada. Por favor, efetue login novamente.');
      return;
    }

    const loadingSpinner = document.getElementById('biIndicesLoading');
    const content = document.getElementById('biIndicesContent');
    const btnSync = document.getElementById('btnSyncBiIndices');
    const lastUpdated = document.getElementById('biIndicesLastUpdated');

    try {
      isIndicesLoading = true;
      if (loadingSpinner) loadingSpinner.classList.remove('hidden');
      if (content) content.style.opacity = '0.5';
      if (btnSync) {
        btnSync.disabled = true;
        btnSync.innerHTML = '⏳ Sincronizando...';
      }

      let url = '/api/bi/indices';
      let options = {
        headers: { 'Authorization': `Bearer ${token}` }
      };

      if (forceSync) {
        url = '/api/bi/indices/sync';
        options.method = 'POST';
      }

      const res = await fetch(url, options);
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.message || 'Erro ao carregar índices financeiros.');
      }

      const metricas = forceSync ? (json.data && json.data.metricas ? json.data.metricas : json.data) : json.metricas;
      cachedIndicesPayload = {
        metricas,
        timestamp: json.timestamp || new Date().toISOString()
      };

      renderizarIndicesDashboard(metricas, currentEmpresaFilter);

      if (lastUpdated) {
        const d = new Date(cachedIndicesPayload.timestamp);
        lastUpdated.textContent = `Atualizado às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
      }

      if (forceSync) {
        mostrarNotificacaoToast('✓ Índices e tabelas financeiras sincronizados com sucesso!', 'success');
      }
    } catch (err) {
      console.error('❌ [BI Índices] Erro ao carregar:', err);
      alert(`Falha ao obter dados dos índices: ${err.message}`);
    } finally {
      isIndicesLoading = false;
      if (loadingSpinner) loadingSpinner.classList.add('hidden');
      if (content) content.style.opacity = '1';
      if (btnSync) {
        btnSync.disabled = false;
        btnSync.innerHTML = '🔄 Sincronizar Protheus';
      }
    }
  }

  /**
   * Renderiza os cards e tabelas no dashboard conforme a empresa selecionada
   */
  function renderizarIndicesDashboard(metricas, empresaFilter = 'ALL') {
    if (!metricas) return;

    const data = (empresaFilter === 'ALL' || !metricas.porEmpresa || !metricas.porEmpresa[empresaFilter])
      ? metricas.consolidado
      : metricas.porEmpresa[empresaFilter];

    if (!data) return;

    // 1. Valores dos 3 Índices
    const valLC = document.getElementById('valLC');
    const valLS = document.getElementById('valLS');
    const valLI = document.getElementById('valLI');

    if (valLC) valLC.textContent = formatIndex(data.liquidezCorrente);
    if (valLS) valLS.textContent = formatIndex(data.liquidezSeca);
    if (valLI) valLI.textContent = formatIndex(data.liquidezImediata);

    // Badges de Classificação de Saúde Financeira
    atualizarBadgeIndice('badgeLC', data.liquidezCorrente, 1.0, 1.5);
    atualizarBadgeIndice('badgeLS', data.liquidezSeca, 0.8, 1.0);
    atualizarBadgeIndice('badgeLI', data.liquidezImediata, 0.2, 0.5);

    // 2. Fórmulas e Valores Componentes nos 3 Cards
    const valLC_AC = document.getElementById('valLC_AC');
    const valLC_PC = document.getElementById('valLC_PC');
    if (valLC_AC) valLC_AC.textContent = formatMoney(data.ativoCirculante);
    if (valLC_PC) valLC_PC.textContent = formatMoney(data.passivoCirculante);

    const valLS_AS = document.getElementById('valLS_AS');
    const valLS_PC = document.getElementById('valLS_PC');
    if (valLS_AS) valLS_AS.textContent = formatMoney(data.ativoSeco);
    if (valLS_PC) valLS_PC.textContent = formatMoney(data.passivoCirculante);

    const valLI_Disp = document.getElementById('valLI_Disp');
    const valLI_PC = document.getElementById('valLI_PC');
    if (valLI_Disp) valLI_Disp.textContent = formatMoney(data.componentes?.disponibilidades?.saldoTotal);
    if (valLI_PC) valLI_PC.textContent = formatMoney(data.passivoCirculante);

    // 3. Quatro Cards de Componentes
    const compEst = data.componentes?.estoque || {};
    const compBco = data.componentes?.disponibilidades || {};
    const compRec = data.componentes?.contasReceber || {};
    const compPag = data.componentes?.contasPagar || {};

    const elEstCusto = document.getElementById('compEstoqueCusto');
    const elEstVenda = document.getElementById('compEstoqueVenda');
    const elEstQtd = document.getElementById('compEstoqueQtd');
    if (elEstCusto) elEstCusto.textContent = formatMoney(compEst.custoTotal);
    if (elEstVenda) elEstVenda.textContent = formatMoney(compEst.vendaTotal);
    if (elEstQtd) elEstQtd.textContent = `${compEst.totalItens || 0} itens`;

    const elBcoTotal = document.getElementById('compBancosTotal');
    const elBcoQtd = document.getElementById('compBancosQtd');
    if (elBcoTotal) elBcoTotal.textContent = formatMoney(compBco.saldoTotal);
    if (elBcoQtd) elBcoQtd.textContent = `${compBco.totalContas || 0} contas`;

    const elRecValido = document.getElementById('compReceberValido');
    const elRecTotal = document.getElementById('compReceberTotal');
    const elRecQtd = document.getElementById('compReceberQtd');
    if (elRecValido) elRecValido.textContent = formatMoney(compRec.validoIndice);
    if (elRecTotal) elRecTotal.textContent = formatMoney(compRec.totalAberto);
    if (elRecQtd) elRecQtd.textContent = `${compRec.totalTitulos || 0} títulos`;

    const elPagTotal = document.getElementById('compPagarTotal');
    const elPagPR = document.getElementById('compPagarPR');
    const elPagQtd = document.getElementById('compPagarQtd');
    if (elPagTotal) elPagTotal.textContent = formatMoney(compPag.totalAberto);
    if (elPagPR) elPagPR.textContent = formatMoney(compPag.provisoriosPR);
    if (elPagQtd) elPagQtd.textContent = `${compPag.totalTitulos || 0} títulos`;

    // 4. Renderiza Tabela Comparativa Multi-Empresa
    renderizarTabelaComparativa(metricas);
  }

  /**
   * Helper: Atualiza badge de saúde do índice com cores adequadas
   */
  function atualizarBadgeIndice(badgeId, valor, limiteMinimo, limiteBom) {
    const badge = document.getElementById(badgeId);
    if (!badge) return;

    const num = Number(valor) || 0;
    if (num >= limiteBom) {
      badge.textContent = 'Excelente';
      badge.style.background = 'rgba(16, 185, 129, 0.15)';
      badge.style.color = '#10b981';
      badge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
    } else if (num >= limiteMinimo) {
      badge.textContent = 'Saudável';
      badge.style.background = 'rgba(56, 189, 248, 0.15)';
      badge.style.color = '#38bdf8';
      badge.style.borderColor = 'rgba(56, 189, 248, 0.3)';
    } else {
      badge.textContent = 'Atenção';
      badge.style.background = 'rgba(239, 68, 68, 0.15)';
      badge.style.color = '#f87171';
      badge.style.borderColor = 'rgba(239, 68, 68, 0.3)';
    }
  }

  /**
   * Renderiza a tabela comparativa multi-empresa
   */
  function renderizarTabelaComparativa(metricas) {
    const tbody = document.getElementById('tbodyComparativoIndices');
    if (!tbody || !metricas || !metricas.porEmpresa) return;

    const empresas = [
      { key: '14', sigla: 'MP', nome: 'Metal Pleno (14)' },
      { key: '15', sigla: 'GSI', nome: 'GSI Cofres (15)' },
      { key: '16', sigla: 'OACO', nome: 'OAÇO (16)' }
    ];

    let html = '';

    empresas.forEach(emp => {
      const d = metricas.porEmpresa[emp.key];
      if (!d) return;

      const comp = d.componentes || {};
      html += `
        <tr>
          <td><strong>${emp.nome}</strong></td>
          <td style="text-align: right; color: var(--text-muted);">${formatMoney(comp.estoque?.custoTotal)}</td>
          <td style="text-align: right; color: #10b981;">${formatMoney(comp.disponibilidades?.saldoTotal)}</td>
          <td style="text-align: right; color: #38bdf8;">${formatMoney(comp.contasReceber?.validoIndice)}</td>
          <td style="text-align: right; color: #f87171;">${formatMoney(comp.contasPagar?.totalAberto)}</td>
          <td style="text-align: right; font-weight: 600; color: #f8fafc;">${formatMoney(d.ativoCirculante)}</td>
          <td style="text-align: center; font-weight: 700; color: ${d.liquidezCorrente >= 1 ? '#38bdf8' : '#f87171'}; font-family: var(--font-mono);">${formatIndex(d.liquidezCorrente)}</td>
          <td style="text-align: center; font-weight: 700; color: ${d.liquidezSeca >= 0.8 ? '#10b981' : '#f87171'}; font-family: var(--font-mono);">${formatIndex(d.liquidezSeca)}</td>
          <td style="text-align: center; font-weight: 700; color: ${d.liquidezImediata >= 0.2 ? '#f59e0b' : '#f87171'}; font-family: var(--font-mono);">${formatIndex(d.liquidezImediata)}</td>
        </tr>
      `;
    });

    // Linha Consolidada
    const c = metricas.consolidado;
    if (c) {
      const compC = c.componentes || {};
      html += `
        <tr style="background: rgba(56, 189, 248, 0.08); font-weight: 700; border-top: 2px solid var(--panel-border);">
          <td style="color: #38bdf8;">🌐 TOTAL CONSOLIDADO</td>
          <td style="text-align: right; color: var(--text-muted);">${formatMoney(compC.estoque?.custoTotal)}</td>
          <td style="text-align: right; color: #10b981;">${formatMoney(compC.disponibilidades?.saldoTotal)}</td>
          <td style="text-align: right; color: #38bdf8;">${formatMoney(compC.contasReceber?.validoIndice)}</td>
          <td style="text-align: right; color: #f87171;">${formatMoney(compC.contasPagar?.totalAberto)}</td>
          <td style="text-align: right; color: #38bdf8;">${formatMoney(c.ativoCirculante)}</td>
          <td style="text-align: center; font-size: 1.05rem; color: #38bdf8; font-family: var(--font-mono);">${formatIndex(c.liquidezCorrente)}</td>
          <td style="text-align: center; font-size: 1.05rem; color: #10b981; font-family: var(--font-mono);">${formatIndex(c.liquidezSeca)}</td>
          <td style="text-align: center; font-size: 1.05rem; color: #f59e0b; font-family: var(--font-mono);">${formatIndex(c.liquidezImediata)}</td>
        </tr>
      `;
    }

    tbody.innerHTML = html;
  }

  /**
   * Abre a Modal de Drilldown no painel desejado
   */
  async function abrirModalIndicesDrilldown(targetTab = 'modalTabIndicesExtrato', focoIndice = null) {
    const modal = document.getElementById('modalIndicesDrilldown');
    if (!modal) return;

    modal.classList.remove('hidden');
    alternarAbaModalIndices(targetTab);

    if (targetTab === 'modalTabIndicesExtrato') {
      renderizarExtratoMatematicoModal(focoIndice);
    } else {
      carregarDetalhesModalDrilldown(targetTab);
    }
  }

  /**
   * Fecha a Modal de Drilldown
   */
  function fecharModalIndices() {
    const modal = document.getElementById('modalIndicesDrilldown');
    if (modal) modal.classList.add('hidden');
  }

  /**
   * Alterna entre as abas internas da modal
   */
  function alternarAbaModalIndices(targetTabId) {
    activeModalDrilldownTab = targetTabId;

    // Atualiza botões
    const tabBtns = document.querySelectorAll('.btn-modal-indices-tab');
    tabBtns.forEach(btn => {
      if (btn.getAttribute('data-target') === targetTabId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Atualiza painéis
    const panes = document.querySelectorAll('.modal-indices-tab-pane');
    panes.forEach(pane => {
      if (pane.id === targetTabId) {
        pane.classList.remove('hidden');
      } else {
        pane.classList.add('hidden');
      }
    });

    if (targetTabId === 'modalTabIndicesExtrato') {
      renderizarExtratoMatematicoModal();
    } else {
      carregarDetalhesModalDrilldown(targetTabId);
    }
  }

  /**
   * Renderiza o Extrato Matemático e Conferência na Modal
   */
  function renderizarExtratoMatematicoModal(focoIndice = null) {
    const container = document.getElementById('modalExtratoMatematicoCorpo');
    if (!container || !cachedIndicesPayload || !cachedIndicesPayload.metricas) return;

    const metricas = cachedIndicesPayload.metricas;
    const data = (currentEmpresaFilter === 'ALL' || !metricas.porEmpresa || !metricas.porEmpresa[currentEmpresaFilter])
      ? metricas.consolidado
      : metricas.porEmpresa[currentEmpresaFilter];

    if (!data) return;

    const nomeEmpresa = currentEmpresaFilter === 'ALL' 
      ? '🌐 Consolidado (3 Empresas: Metal Pleno, GSI Cofres e OAÇO)' 
      : (metricas.porEmpresa[currentEmpresaFilter]?.empresa_nome || `Empresa ${currentEmpresaFilter}`);

    const comp = data.componentes || {};
    const est = comp.estoque || {};
    const bco = comp.disponibilidades || {};
    const rec = comp.contasReceber || {};
    const pag = comp.contasPagar || {};

    container.innerHTML = `
      <div style="background: rgba(15, 23, 42, 0.6); padding: 1rem; border-radius: 8px; border: 1px solid var(--panel-border);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
          <span style="font-weight: 700; color: #38bdf8; font-size: 0.95rem;">Escopo Analisado: ${nomeEmpresa}</span>
          <span class="badge" style="font-size: 0.78rem;">Fórmulas Auditáveis</span>
        </div>
        <p style="font-size: 0.82rem; color: var(--text-muted); margin: 0;">
          Abaixo estão discriminados todos os valores exatos de cada componente contábil e a demonstração aritmética dos 3 índices calculados.
        </p>
      </div>

      <!-- DEMONSTRATIVO MATEMÁTICO DOS 3 ÍNDICES -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem;">
        
        <!-- LC DETALHADO -->
        <div class="card" style="padding: 1rem; border-left: 4px solid #38bdf8; ${focoIndice === 'LC' ? 'box-shadow: 0 0 0 2px #38bdf8;' : ''}">
          <div style="font-weight: 700; color: #38bdf8; font-size: 0.9rem; margin-bottom: 0.5rem; display: flex; justify-content: space-between;">
            <span>💧 1. Liquidez Corrente (LC)</span>
            <span style="font-size: 1.1rem; color: #f8fafc; font-family: var(--font-mono);">${formatIndex(data.liquidezCorrente)}</span>
          </div>
          <div style="font-size: 0.8rem; line-height: 1.5; color: var(--text-muted); background: rgba(0,0,0,0.2); padding: 0.6rem; border-radius: 6px;">
            <div><strong>Numerador (Ativo Circulante):</strong></div>
            <div style="padding-left: 8px;">• Estoques PA: <span style="color:#f8fafc;">${formatMoney(est.custoTotal)}</span></div>
            <div style="padding-left: 8px;">• Saldos Bancários: <span style="color:#10b981;">+ ${formatMoney(bco.saldoTotal)}</span></div>
            <div style="padding-left: 8px;">• A Receber (&le;5d): <span style="color:#38bdf8;">+ ${formatMoney(rec.validoIndice)}</span></div>
            <div style="border-top: 1px dashed var(--panel-border); margin: 4px 0; padding-top: 2px;">
              = <strong>${formatMoney(data.ativoCirculante)}</strong>
            </div>
            <div style="margin-top: 6px;"><strong>Denominador (Passivo Circulante):</strong></div>
            <div style="padding-left: 8px;">• Contas a Pagar Total: <span style="color:#f87171;">${formatMoney(data.passivoCirculante)}</span></div>
            <div style="border-top: 1px solid var(--panel-border); margin-top: 6px; padding-top: 4px; color: #38bdf8; font-weight: 700;">
              Cálculo: ${formatMoney(data.ativoCirculante)} ÷ ${formatMoney(data.passivoCirculante)} = ${formatIndex(data.liquidezCorrente)}
            </div>
          </div>
        </div>

        <!-- LS DETALHADO -->
        <div class="card" style="padding: 1rem; border-left: 4px solid #10b981; ${focoIndice === 'LS' ? 'box-shadow: 0 0 0 2px #10b981;' : ''}">
          <div style="font-weight: 700; color: #10b981; font-size: 0.9rem; margin-bottom: 0.5rem; display: flex; justify-content: space-between;">
            <span>🧪 2. Liquidez Seca (LS)</span>
            <span style="font-size: 1.1rem; color: #f8fafc; font-family: var(--font-mono);">${formatIndex(data.liquidezSeca)}</span>
          </div>
          <div style="font-size: 0.8rem; line-height: 1.5; color: var(--text-muted); background: rgba(0,0,0,0.2); padding: 0.6rem; border-radius: 6px;">
            <div><strong>Numerador (Ativo Seco s/ Estoque):</strong></div>
            <div style="padding-left: 8px;">• Saldos Bancários: <span style="color:#10b981;">${formatMoney(bco.saldoTotal)}</span></div>
            <div style="padding-left: 8px;">• A Receber (&le;5d): <span style="color:#38bdf8;">+ ${formatMoney(rec.validoIndice)}</span></div>
            <div style="border-top: 1px dashed var(--panel-border); margin: 4px 0; padding-top: 2px;">
              = <strong>${formatMoney(data.ativoSeco)}</strong>
            </div>
            <div style="margin-top: 6px;"><strong>Denominador (Passivo Circulante):</strong></div>
            <div style="padding-left: 8px;">• Contas a Pagar Total: <span style="color:#f87171;">${formatMoney(data.passivoCirculante)}</span></div>
            <div style="border-top: 1px solid var(--panel-border); margin-top: 6px; padding-top: 4px; color: #10b981; font-weight: 700;">
              Cálculo: ${formatMoney(data.ativoSeco)} ÷ ${formatMoney(data.passivoCirculante)} = ${formatIndex(data.liquidezSeca)}
            </div>
          </div>
        </div>

        <!-- LI DETALHADO -->
        <div class="card" style="padding: 1rem; border-left: 4px solid #f59e0b; ${focoIndice === 'LI' ? 'box-shadow: 0 0 0 2px #f59e0b;' : ''}">
          <div style="font-weight: 700; color: #f59e0b; font-size: 0.9rem; margin-bottom: 0.5rem; display: flex; justify-content: space-between;">
            <span>⚡ 3. Liquidez Imediata (LI)</span>
            <span style="font-size: 1.1rem; color: #f8fafc; font-family: var(--font-mono);">${formatIndex(data.liquidezImediata)}</span>
          </div>
          <div style="font-size: 0.8rem; line-height: 1.5; color: var(--text-muted); background: rgba(0,0,0,0.2); padding: 0.6rem; border-radius: 6px;">
            <div><strong>Numerador (Disponibilidades Bancárias):</strong></div>
            <div style="padding-left: 8px;">• Saldos Bancários (SE8): <span style="color:#f59e0b;">${formatMoney(bco.saldoTotal)}</span></div>
            <div style="border-top: 1px dashed var(--panel-border); margin: 4px 0; padding-top: 2px;">
              = <strong>${formatMoney(bco.saldoTotal)}</strong>
            </div>
            <div style="margin-top: 6px;"><strong>Denominador (Passivo Circulante):</strong></div>
            <div style="padding-left: 8px;">• Contas a Pagar Total: <span style="color:#f87171;">${formatMoney(data.passivoCirculante)}</span></div>
            <div style="border-top: 1px solid var(--panel-border); margin-top: 6px; padding-top: 4px; color: #f59e0b; font-weight: 700;">
              Cálculo: ${formatMoney(bco.saldoTotal)} ÷ ${formatMoney(data.passivoCirculante)} = ${formatIndex(data.liquidezImediata)}
            </div>
          </div>
        </div>

      </div>

      <!-- QUADRO RESUMO DE VARIÁVEIS -->
      <div class="card" style="padding: 1rem;">
        <h4 style="margin: 0 0 0.75rem 0; font-size: 0.88rem; color: #f8fafc;">📋 Síntese Geral das Variáveis</h4>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem;">
          <div style="background: rgba(15, 23, 42, 0.5); padding: 0.6rem; border-radius: 6px; border: 1px solid var(--panel-border);">
            <div style="font-size: 0.75rem; color: var(--text-muted);">Estoque Custo Total (PA)</div>
            <div style="font-weight: 700; color: #f8fafc; font-size: 1.05rem;">${formatMoney(est.custoTotal)}</div>
            <div style="font-size: 0.72rem; color: var(--text-muted);">${est.totalItens || 0} produtos com saldo &gt; 0</div>
          </div>
          <div style="background: rgba(15, 23, 42, 0.5); padding: 0.6rem; border-radius: 6px; border: 1px solid var(--panel-border);">
            <div style="font-size: 0.75rem; color: var(--text-muted);">Saldos Bancários (SE8)</div>
            <div style="font-weight: 700; color: #10b981; font-size: 1.05rem;">${formatMoney(bco.saldoTotal)}</div>
            <div style="font-size: 0.72rem; color: var(--text-muted);">${bco.totalContas || 0} contas correntes</div>
          </div>
          <div style="background: rgba(15, 23, 42, 0.5); padding: 0.6rem; border-radius: 6px; border: 1px solid var(--panel-border);">
            <div style="font-size: 0.75rem; color: var(--text-muted);">A Receber Válido (&le;5d)</div>
            <div style="font-weight: 700; color: #38bdf8; font-size: 1.05rem;">${formatMoney(rec.validoIndice)}</div>
            <div style="font-size: 0.72rem; color: var(--text-muted);">Total: ${formatMoney(rec.totalAberto)} (Inadimplente: ${formatMoney(rec.inadimplente5d)})</div>
          </div>
          <div style="background: rgba(15, 23, 42, 0.5); padding: 0.6rem; border-radius: 6px; border: 1px solid var(--panel-border);">
            <div style="font-size: 0.75rem; color: var(--text-muted);">A Pagar Total (SE2)</div>
            <div style="font-weight: 700; color: #f87171; font-size: 1.05rem;">${formatMoney(pag.totalAberto)}</div>
            <div style="font-size: 0.72rem; color: var(--text-muted);">Provisórios (PR): ${formatMoney(pag.provisoriosPR)}</div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Carrega os dados detalhados para as abas 2, 3, 4, 5 da Modal
   */
  async function carregarDetalhesModalDrilldown(targetTabId) {
    const token = getAuthToken();
    if (!token) return;

    let tipo = 'bancos';
    let tbodyId = 'tbodyModalBancos';

    if (targetTabId === 'modalTabIndicesBancos') {
      tipo = 'bancos';
      tbodyId = 'tbodyModalBancos';
    } else if (targetTabId === 'modalTabIndicesReceber') {
      tipo = 'receber';
      tbodyId = 'tbodyModalReceber';
    } else if (targetTabId === 'modalTabIndicesPagar') {
      tipo = 'pagar';
      tbodyId = 'tbodyModalPagar';
    } else if (targetTabId === 'modalTabIndicesEstoque') {
      tipo = 'estoque';
      tbodyId = 'tbodyModalEstoque';
    }

    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 1.5rem; color: var(--text-muted);">Carregando registros...</td></tr>`;

    try {
      const res = await fetch(`/api/bi/indices/drilldown?tipo=${tipo}&empresa=${currentEmpresaFilter}&limit=100`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const json = await res.json();

      if (!res.ok) throw new Error(json.message || 'Erro ao carregar detalhes.');

      const itens = json.itens || [];

      if (itens.length === 0) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="10" style="text-align: center; padding: 1.5rem; color: var(--text-muted);">Nenhum registro encontrado para a empresa selecionada.</td></tr>`;
        return;
      }

      if (tipo === 'bancos') {
        renderTabelaModalBancos(itens);
      } else if (tipo === 'receber') {
        renderTabelaModalReceber(itens);
      } else if (tipo === 'pagar') {
        renderTabelaModalPagar(itens);
      } else if (tipo === 'estoque') {
        renderTabelaModalEstoque(itens);
      }
    } catch (err) {
      console.error('❌ [BI Drilldown] Erro:', err);
      tbody.innerHTML = `<tr class="empty-row"><td colspan="10" style="text-align: center; color: #f87171; padding: 1.5rem;">Falha ao carregar detalhes: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function renderTabelaModalBancos(itens) {
    const tbody = document.getElementById('tbodyModalBancos');
    const badge = document.getElementById('modalBancosTotalBadge');
    if (!tbody) return;

    let soma = 0;
    let html = '';

    itens.forEach(r => {
      soma += Number(r.saldo_atual || 0);
      html += `
        <tr>
          <td><span class="badge">${r.empresa_sigla || r.empresa_cod}</span></td>
          <td><strong>${escapeHtml(r.banco_cod)}</strong></td>
          <td>${escapeHtml(r.agencia || '-')}</td>
          <td>${escapeHtml(r.conta)}</td>
          <td>${escapeHtml(r.conta_nome || '-')}</td>
          <td>${formatDate(r.data_saldo)}</td>
          <td style="text-align: right; font-weight: 700; color: #10b981; font-family: var(--font-mono);">${formatMoney(r.saldo_atual)}</td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
    if (badge) badge.textContent = `Total: ${formatMoney(soma)}`;
  }

  function renderTabelaModalReceber(itens) {
    const tbody = document.getElementById('tbodyModalReceber');
    const badgeTotal = document.getElementById('modalReceberTotalBadge');
    const badgeValido = document.getElementById('modalReceberValidoBadge');
    if (!tbody) return;

    let totalGeral = 0;
    let totalValido = 0;
    let html = '';

    itens.forEach(r => {
      const saldo = Number(r.saldo || 0);
      totalGeral += saldo;
      if (r.valido_indice) totalValido += saldo;

      html += `
        <tr>
          <td><span class="badge">${r.empresa_sigla || r.empresa_cod}</span></td>
          <td><strong>${escapeHtml(r.numero_titulo)}</strong></td>
          <td>${escapeHtml(r.parcela || '-')}</td>
          <td><span class="badge" style="font-size: 0.72rem;">${escapeHtml(r.tipo)}</span></td>
          <td>${escapeHtml(r.cliente_nome)}</td>
          <td><code>${escapeHtml(r.natureza_cod || '-')}</code></td>
          <td>${formatDate(r.data_emissao)}</td>
          <td>${formatDate(r.data_vencimento)}</td>
          <td style="color: ${r.dias_vencido > 0 ? (r.dias_vencido > 5 ? '#f87171' : '#fbbf24') : '#10b981'};">
            ${r.dias_vencido > 0 ? `${r.dias_vencido}d atraso` : 'Em dia'}
          </td>
          <td>
            ${r.valido_indice 
              ? `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981;">✓ Válido</span>` 
              : `<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #f87171;">🚫 &gt;5d Atraso</span>`}
          </td>
          <td style="text-align: right; font-weight: 700; color: #38bdf8; font-family: var(--font-mono);">${formatMoney(saldo)}</td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
    if (badgeTotal) badgeTotal.textContent = `Total: ${formatMoney(totalGeral)}`;
    if (badgeValido) badgeValido.textContent = `Válido Índice: ${formatMoney(totalValido)}`;
  }

  function renderTabelaModalPagar(itens) {
    const tbody = document.getElementById('tbodyModalPagar');
    const badgeTotal = document.getElementById('modalPagarTotalBadge');
    const badgePR = document.getElementById('modalPagarPRBadge');
    if (!tbody) return;

    let totalGeral = 0;
    let totalPR = 0;
    let html = '';

    itens.forEach(r => {
      const saldo = Number(r.saldo || 0);
      totalGeral += saldo;
      if (r.is_provisorio) totalPR += saldo;

      html += `
        <tr>
          <td><span class="badge">${r.empresa_sigla || r.empresa_cod}</span></td>
          <td><strong>${escapeHtml(r.numero_titulo)}</strong></td>
          <td>${escapeHtml(r.parcela || '-')}</td>
          <td>
            ${r.is_provisorio 
              ? `<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; font-weight: 700;">PR (Provisório)</span>` 
              : `<span class="badge" style="font-size: 0.72rem;">${escapeHtml(r.tipo)}</span>`}
          </td>
          <td>${escapeHtml(r.fornecedor_nome)}</td>
          <td><code>${escapeHtml(r.natureza_cod || '-')}</code></td>
          <td>${formatDate(r.data_emissao)}</td>
          <td>${formatDate(r.data_vencimento)}</td>
          <td style="text-align: right; font-weight: 700; color: #f87171; font-family: var(--font-mono);">${formatMoney(saldo)}</td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
    if (badgeTotal) badgeTotal.textContent = `Passivo Total: ${formatMoney(totalGeral)}`;
    if (badgePR) badgePR.textContent = `Provisórios (PR): ${formatMoney(totalPR)}`;
  }

  function renderTabelaModalEstoque(itens) {
    const tbody = document.getElementById('tbodyModalEstoque');
    const badgeCusto = document.getElementById('modalEstoqueCustoBadge');
    const badgeVenda = document.getElementById('modalEstoqueVendaBadge');
    if (!tbody) return;

    let totalCusto = 0;
    let totalVenda = 0;
    let html = '';

    itens.forEach(r => {
      const custoTot = Number(r.custo_total || 0);
      const vendaTot = Number(r.valor_total_venda || 0);
      totalCusto += custoTot;
      totalVenda += vendaTot;

      html += `
        <tr>
          <td><span class="badge">${r.empresa_sigla || r.empresa_cod}</span></td>
          <td><code>${escapeHtml(r.codigo)}</code></td>
          <td><strong>${escapeHtml(r.descricao)}</strong></td>
          <td><span class="badge" style="font-size: 0.72rem;">${escapeHtml(r.grupo_cod || '-')}</span></td>
          <td style="text-align: right; font-weight: 700; color: #10b981;">${r.quantidade} un</td>
          <td style="text-align: right; color: var(--text-muted); font-family: var(--font-mono);">${formatMoney(r.custo_unitario)}</td>
          <td style="text-align: right; font-weight: 700; color: #38bdf8; font-family: var(--font-mono);">${formatMoney(custoTot)}</td>
          <td style="text-align: right; color: var(--text-muted); font-family: var(--font-mono);">${formatMoney(vendaTot)}</td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
    if (badgeCusto) badgeCusto.textContent = `Custo Total: ${formatMoney(totalCusto)}`;
    if (badgeVenda) badgeVenda.textContent = `Venda Total: ${formatMoney(totalVenda)}`;
  }

  /**
   * Toast Notification simples
   */
  function mostrarNotificacaoToast(msg, tipo = 'info') {
    const toast = document.createElement('div');
    toast.style.position = 'fixed';
    toast.style.bottom = '24px';
    toast.style.right = '24px';
    toast.style.padding = '12px 20px';
    toast.style.background = tipo === 'success' ? '#059669' : '#1e293b';
    toast.style.color = '#ffffff';
    toast.style.borderRadius = '8px';
    toast.style.boxShadow = '0 10px 25px rgba(0,0,0,0.3)';
    toast.style.zIndex = '99999';
    toast.style.fontSize = '0.9rem';
    toast.style.fontWeight = '600';
    toast.style.transition = 'all 0.3s ease';
    toast.textContent = msg;

    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // Exporta função para o escopo global
  window.initBIIndicesTab = initBIIndicesTab;
  window.carregarIndicesFinanceiros = carregarIndicesFinanceiros;

})();
