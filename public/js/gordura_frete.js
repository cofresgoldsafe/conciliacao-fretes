/**
 * public/js/gordura_frete.js
 * 
 * Módulo de Fechamento e Gordura de Frete para Vendedores (Plataforma de Apoio GSI)
 * Código 100% Desacoplado e Autônomo (IIFE)
 */

(function () {
  'use strict';

  let currentData = [];
  let currentKpis = null;
  let currentPeriodo = null;
  let isLoading = false;
  let sortColumn = 'dataEmissao';
  let sortAsc = false; // Mais recente primeiro

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
             null;
    } catch {
      return localStorage.getItem('auth_token') || localStorage.getItem('token') || null;
    }
  }

  function getCurrentUser() {
    try {
      if (window.currentUser) return window.currentUser;
      const rawSession = localStorage.getItem('conciliacao_fretes_session');
      if (rawSession) {
        const sess = JSON.parse(rawSession);
        if (sess && sess.user) return sess.user;
      }
    } catch {}
    return null;
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatCurrency(val) {
    const num = parseFloat(val) || 0;
    return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function formatPct(val) {
    const num = parseFloat(val) || 0;
    return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
  }

  /**
   * Cálculo local do Ciclo Padrão (26 do mês anterior a 25 do mês atual)
   */
  function calcularCicloLocal(refDate) {
    const d = refDate ? new Date(refDate) : new Date();
    const ano = d.getFullYear();
    const mes = d.getMonth();
    const dia = d.getDate();

    let startYear, startMonth, endYear, endMonth;

    if (dia <= 25) {
      const prevDate = new Date(ano, mes - 1, 26);
      startYear = prevDate.getFullYear();
      startMonth = prevDate.getMonth();
      endYear = ano;
      endMonth = mes;
    } else {
      startYear = ano;
      startMonth = mes;
      const nextDate = new Date(ano, mes + 1, 25);
      endYear = nextDate.getFullYear();
      endMonth = nextDate.getMonth();
    }

    const pad = (n) => String(n).padStart(2, '0');

    return {
      dataIniIso: `${startYear}-${pad(startMonth + 1)}-26`,
      dataFimIso: `${endYear}-${pad(endMonth + 1)}-25`,
      dataIniBR: `26/${pad(startMonth + 1)}/${startYear}`,
      dataFimBR: `25/${pad(endMonth + 1)}/${endYear}`
    };
  }

  /**
   * Inicializa o módulo e configura datas padrão
   */
  function init() {
    const dataIniInput = document.getElementById('gorduraDataIni');
    const dataFimInput = document.getElementById('gorduraDataFim');

    // Inicializa campos de data com o ciclo atual
    const cicloAtual = calcularCicloLocal();
    if (dataIniInput && !dataIniInput.value) dataIniInput.value = cicloAtual.dataIniIso;
    if (dataFimInput && !dataFimInput.value) dataFimInput.value = cicloAtual.dataFimIso;

    // Atualiza labels dos botões rápidos
    atualizarLabelsBotoesCiclo();

    // Configura eventos
    setupEventListeners();

    // Ajusta visualização conforme papel do usuário (oculta filtro de vendedor se for vendedor)
    ajustarPermissoesUI();
  }

  function atualizarLabelsBotoesCiclo() {
    const c0 = calcularCicloLocal();
    const btnAtual = document.getElementById('btnGorduraCicloAtual');
    if (btnAtual) {
      btnAtual.setAttribute('data-ini', c0.dataIniIso);
      btnAtual.setAttribute('data-fim', c0.dataFimIso);
      btnAtual.innerHTML = `📌 Ciclo Atual <span style="font-size: 0.72rem; opacity: 0.85; margin-left: 3px;">(${c0.dataIniBR.slice(0, 5)} a ${c0.dataFimBR.slice(0, 5)})</span>`;
    }

    // Ciclo anterior
    const dAnt = new Date(c0.dataIniIso);
    dAnt.setDate(dAnt.getDate() - 5);
    const c1 = calcularCicloLocal(dAnt);
    const btnAnt = document.getElementById('btnGorduraCicloAnterior');
    if (btnAnt) {
      btnAnt.setAttribute('data-ini', c1.dataIniIso);
      btnAnt.setAttribute('data-fim', c1.dataFimIso);
      btnAnt.innerHTML = `⏮️ Ciclo Anterior <span style="font-size: 0.72rem; opacity: 0.85; margin-left: 3px;">(${c1.dataIniBR.slice(0, 5)} a ${c1.dataFimBR.slice(0, 5)})</span>`;
    }

    // 2 Ciclos atrás
    const dDoisAnt = new Date(c1.dataIniIso);
    dDoisAnt.setDate(dDoisAnt.getDate() - 5);
    const c2 = calcularCicloLocal(dDoisAnt);
    const btnDoisAnt = document.getElementById('btnGorduraCicloDoisAnteriores');
    if (btnDoisAnt) {
      btnDoisAnt.setAttribute('data-ini', c2.dataIniIso);
      btnDoisAnt.setAttribute('data-fim', c2.dataFimIso);
      btnDoisAnt.innerHTML = `⏮️ 2 Ciclos Atrás <span style="font-size: 0.72rem; opacity: 0.85; margin-left: 3px;">(${c2.dataIniBR.slice(0, 5)} a ${c2.dataFimBR.slice(0, 5)})</span>`;
    }
  }

  function ajustarPermissoesUI() {
    const user = getCurrentUser();
    const vendGroup = document.getElementById('gorduraVendedorFilterGroup');
    if (user && user.role === 'vendedor' && vendGroup) {
      vendGroup.style.display = 'none'; // Vendedor só consulta o próprio código
    } else if (vendGroup) {
      vendGroup.style.display = '';
    }
  }

  function setupEventListeners() {
    const btnBuscar = document.getElementById('btnBuscarGorduraFrete');
    if (btnBuscar) btnBuscar.addEventListener('click', () => consultarGorduraFreteAction());

    const btnLimpar = document.getElementById('btnLimparFiltrosGordura');
    if (btnLimpar) {
      btnLimpar.addEventListener('click', () => {
        const c0 = calcularCicloLocal();
        const dataIniInput = document.getElementById('gorduraDataIni');
        const dataFimInput = document.getElementById('gorduraDataFim');
        const empSelect = document.getElementById('gorduraEmpresaFilter');
        const vendSelect = document.getElementById('gorduraVendedorFilter');
        const statusSelect = document.getElementById('gorduraStatusFilter');
        const buscaInput = document.getElementById('gorduraBuscaInput');

        if (dataIniInput) dataIniInput.value = c0.dataIniIso;
        if (dataFimInput) dataFimInput.value = c0.dataFimIso;
        if (empSelect) empSelect.value = '';
        if (vendSelect) vendSelect.value = '';
        if (statusSelect) statusSelect.value = '';
        if (buscaInput) buscaInput.value = '';

        destacarBotaoCicloAtivo(document.getElementById('btnGorduraCicloAtual'));
        consultarGorduraFreteAction();
      });
    }

    // Botões Rápidos de Ciclo
    const quickButtons = [
      document.getElementById('btnGorduraCicloAtual'),
      document.getElementById('btnGorduraCicloAnterior'),
      document.getElementById('btnGorduraCicloDoisAnteriores')
    ];

    quickButtons.forEach(btn => {
      if (!btn) return;
      btn.addEventListener('click', () => {
        const ini = btn.getAttribute('data-ini');
        const fim = btn.getAttribute('data-fim');
        if (ini && fim) {
          const dataIniInput = document.getElementById('gorduraDataIni');
          const dataFimInput = document.getElementById('gorduraDataFim');
          if (dataIniInput) dataIniInput.value = ini;
          if (dataFimInput) dataFimInput.value = fim;
          destacarBotaoCicloAtivo(btn);
          consultarGorduraFreteAction();
        }
      });
    });

    // Exportação Excel
    const btnExport = document.getElementById('btnExportGorduraExcel');
    if (btnExport) btnExport.addEventListener('click', exportarParaExcel);

    // Filtro instantâneo por texto e status
    const buscaInput = document.getElementById('gorduraBuscaInput');
    if (buscaInput) {
      buscaInput.addEventListener('input', () => renderTableRows());
    }

    const statusSelect = document.getElementById('gorduraStatusFilter');
    if (statusSelect) {
      statusSelect.addEventListener('change', () => renderTableRows());
    }

    // Ordenação nas colunas da tabela
    setupTableSorting();
  }

  function destacarBotaoCicloAtivo(btnAtivo) {
    const quickButtons = [
      document.getElementById('btnGorduraCicloAtual'),
      document.getElementById('btnGorduraCicloAnterior'),
      document.getElementById('btnGorduraCicloDoisAnteriores')
    ];
    quickButtons.forEach(btn => {
      if (!btn) return;
      if (btn === btnAtivo) {
        btn.classList.remove('btn-outline');
        btn.classList.add('btn-primary');
      } else {
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-outline');
      }
    });
  }

  async function consultarGorduraFreteAction() {
    if (isLoading) return;

    const dataIni = document.getElementById('gorduraDataIni')?.value || '';
    const dataFim = document.getElementById('gorduraDataFim')?.value || '';
    const empresa = document.getElementById('gorduraEmpresaFilter')?.value || '';
    const codVend = document.getElementById('gorduraVendedorFilter')?.value || '';

    if (!dataIni || !dataFim) {
      alert('Por favor, selecione a Data Inicial e a Data Final do período.');
      return;
    }

    // Validação de intervalo máx. 95 dias (~3 períodos)
    const d1 = new Date(dataIni);
    const d2 = new Date(dataFim);
    const diffDays = Math.ceil(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24));
    if (diffDays > 95) {
      alert('O intervalo selecionado possui ' + diffDays + ' dias. Para preservar a performance do banco Protheus, o limite máximo permitido é de 95 dias (3 períodos de fechamento).');
      return;
    }

    const token = getToken();
    if (!token) {
      alert('Sessão expirada. Por favor, faça login novamente.');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/vendedores/gordura-frete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ dataIni, dataFim, empresa, codVend })
      });

      const resData = await response.json();

      if (resData.success && resData.data) {
        currentData = resData.data.dados || [];
        currentKpis = resData.data.kpis || {};
        currentPeriodo = resData.data.periodo || {};
        renderReport();
      } else {
        alert(resData.message || 'Erro ao consultar gordura de frete.');
      }
    } catch (err) {
      alert('Erro de conexão ao consultar gordura de frete: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  function setLoading(loading) {
    isLoading = loading;
    const loadingEl = document.getElementById('gorduraFreteLoading');
    const resultsEl = document.getElementById('gorduraFreteResults');
    const emptyEl = document.getElementById('gorduraFreteEmptyState');
    const btnBuscar = document.getElementById('btnBuscarGorduraFrete');

    if (loading) {
      if (loadingEl) loadingEl.classList.remove('hidden');
      if (resultsEl) resultsEl.classList.add('hidden');
      if (emptyEl) emptyEl.classList.add('hidden');
      if (btnBuscar) {
        btnBuscar.disabled = true;
        btnBuscar.textContent = '⏳ Consultando Protheus...';
      }
    } else {
      if (loadingEl) loadingEl.classList.add('hidden');
      if (btnBuscar) {
        btnBuscar.disabled = false;
        btnBuscar.textContent = '📊 Consultar Gordura';
      }
    }
  }

  function renderReport() {
    const resultsEl = document.getElementById('gorduraFreteResults');
    const emptyEl = document.getElementById('gorduraFreteEmptyState');
    const summaryCards = document.getElementById('gorduraSummaryCards');

    if (!currentData || currentData.length === 0) {
      if (resultsEl) resultsEl.classList.add('hidden');
      if (emptyEl) emptyEl.classList.remove('hidden');
      if (summaryCards) summaryCards.classList.remove('hidden');
      renderKpis();
      return;
    }

    if (emptyEl) emptyEl.classList.add('hidden');
    if (resultsEl) resultsEl.classList.remove('hidden');
    if (summaryCards) summaryCards.classList.remove('hidden');

    renderKpis();
    renderTableRows();
  }

  function renderKpis() {
    const kpiCobrado = document.getElementById('gorduraKpiCobrado');
    const kpiCusto = document.getElementById('gorduraKpiCusto');
    const kpiSaldo = document.getElementById('gorduraKpiSaldo');
    const kpiSaldoCard = document.getElementById('gorduraKpiSaldoCard');
    const kpiMargem = document.getElementById('gorduraKpiMargem');
    const kpiNotasCount = document.getElementById('gorduraKpiNotasCount');
    const kpiSuperavitCount = document.getElementById('gorduraKpiSuperavitCount');
    const kpiDeficitCount = document.getElementById('gorduraKpiDeficitCount');

    const kpis = currentKpis || {
      totalFreteCobrado: 0,
      totalCustoFrete: 0,
      totalGordura: 0,
      percentualMargemGeral: 0,
      totalConhecimentos: 0,
      totalSuperavit: 0,
      totalDeficit: 0
    };

    if (kpiCobrado) kpiCobrado.textContent = formatCurrency(kpis.totalFreteCobrado);
    if (kpiCusto) kpiCusto.textContent = formatCurrency(kpis.totalCustoFrete);

    if (kpiSaldo) {
      kpiSaldo.textContent = formatCurrency(kpis.totalGordura);
      if (kpis.totalGordura > 0) {
        kpiSaldo.style.color = '#10b981'; // Verde
      } else if (kpis.totalGordura < 0) {
        kpiSaldo.style.color = '#ef4444'; // Vermelho
      } else {
        kpiSaldo.style.color = '#94a3b8'; // Neutro
      }
    }

    if (kpiSaldoCard) {
      if (kpis.totalGordura > 0) {
        kpiSaldoCard.style.borderLeftColor = '#10b981';
      } else if (kpis.totalGordura < 0) {
        kpiSaldoCard.style.borderLeftColor = '#ef4444';
      } else {
        kpiSaldoCard.style.borderLeftColor = '#94a3b8';
      }
    }

    if (kpiMargem) kpiMargem.textContent = formatPct(kpis.percentualMargemGeral);
    if (kpiNotasCount) kpiNotasCount.textContent = kpis.totalConhecimentos;
    if (kpiSuperavitCount) kpiSuperavitCount.textContent = `${kpis.totalSuperavit} superávit`;
    if (kpiDeficitCount) kpiDeficitCount.textContent = `${kpis.totalDeficit} déficit`;
  }

  function getFilteredRows() {
    let rows = [...currentData];
    const busca = (document.getElementById('gorduraBuscaInput')?.value || '').toLowerCase().trim();
    const status = document.getElementById('gorduraStatusFilter')?.value || '';

    if (busca) {
      rows = rows.filter(r => 
        (r.cliente && r.cliente.toLowerCase().includes(busca)) ||
        (r.notaFiscal && r.notaFiscal.toLowerCase().includes(busca)) ||
        (r.pedidoVenda && r.pedidoVenda.toLowerCase().includes(busca)) ||
        (r.transportadora && r.transportadora.toLowerCase().includes(busca)) ||
        (r.vendedor && r.vendedor.toLowerCase().includes(busca)) ||
        (r.conhecimento && r.conhecimento.toLowerCase().includes(busca))
      );
    }

    if (status) {
      rows = rows.filter(r => r.statusGordura === status);
    }

    // Ordenação
    rows.sort((a, b) => {
      let valA = a[sortColumn];
      let valB = b[sortColumn];

      if (typeof valA === 'number' && typeof valB === 'number') {
        return sortAsc ? valA - valB : valB - valA;
      }
      valA = String(valA || '').toLowerCase();
      valB = String(valB || '').toLowerCase();
      return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });

    return rows;
  }

  function renderTableRows() {
    const tbody = document.getElementById('gorduraFreteTableBody');
    const countBadge = document.getElementById('gorduraFreteCount');
    if (!tbody) return;

    tbody.innerHTML = '';
    const rows = getFilteredRows();

    if (countBadge) countBadge.textContent = rows.length;

    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--text-muted); padding: 2rem;">Nenhum frete encontrado para os critérios de busca selecionados.</td></tr>`;
      return;
    }

    rows.forEach(item => {
      const tr = document.createElement('tr');
      const sigla = item.empresaSigla || (item.empresa && item.empresa.includes('METAL') ? 'MP' : (item.empresa && item.empresa.includes('GSI') ? 'GSI' : 'OACO'));

      let badgeGordura = '';
      if (item.gorduraFrete > 0) {
        badgeGordura = `<span class="badge-gordura-pos" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.35); font-weight: 700; padding: 3px 8px; border-radius: 6px; font-size: 0.82rem; white-space: nowrap;">+ ${formatCurrency(item.gorduraFrete)}</span>`;
      } else if (item.gorduraFrete < 0) {
        badgeGordura = `<span class="badge-gordura-neg" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.35); font-weight: 700; padding: 3px 8px; border-radius: 6px; font-size: 0.82rem; white-space: nowrap;">- ${formatCurrency(Math.abs(item.gorduraFrete))}</span>`;
      } else {
        badgeGordura = `<span class="badge-gordura-neu" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.3); font-weight: 600; padding: 3px 8px; border-radius: 6px; font-size: 0.82rem; white-space: nowrap;">R$ 0,00</span>`;
      }

      tr.innerHTML = `
        <td style="text-align: center;"><span class="company-badge" style="font-weight: 700; padding: 2px 8px; font-size: 0.78rem;">${escapeHtml(sigla)}</span></td>
        <td><strong>${escapeHtml(item.dataEmissaoFormatada || item.dataEmissao)}</strong></td>
        <td><code>${escapeHtml(item.notaFiscal || '-')}</code></td>
        <td><code>${escapeHtml(item.pedidoVenda || '-')}</code></td>
        <td title="${escapeHtml(item.cliente)}"><strong>${escapeHtml(item.cliente)}</strong></td>
        <td>${escapeHtml(item.vendedor || '-')}</td>
        <td>${escapeHtml(item.transportadora || '-')}</td>
        <td style="text-align: right; font-weight: 600;">${formatCurrency(item.freteCobradoCliente)}</td>
        <td style="text-align: right; color: var(--text-muted); font-weight: 500;">${formatCurrency(item.custoFreteReal)}</td>
        <td style="text-align: right;">${badgeGordura}</td>
      `;

      tbody.appendChild(tr);
    });
  }

  function setupTableSorting() {
    const sortHeaders = [
      { id: 'thSortGorduraData', col: 'dataEmissao' },
      { id: 'thSortGorduraNF', col: 'notaFiscal' },
      { id: 'thSortGorduraPed', col: 'pedidoVenda' },
      { id: 'thSortGorduraCli', col: 'cliente' },
      { id: 'thSortGorduraVend', col: 'vendedor' },
      { id: 'thSortGorduraTransp', col: 'transportadora' },
      { id: 'thSortGorduraCobrado', col: 'freteCobradoCliente' },
      { id: 'thSortGorduraCusto', col: 'custoFreteReal' },
      { id: 'thSortGorduraSaldo', col: 'gorduraFrete' }
    ];

    sortHeaders.forEach(sh => {
      const el = document.getElementById(sh.id);
      if (!el) return;

      el.addEventListener('click', () => {
        if (sortColumn === sh.col) {
          sortAsc = !sortAsc;
        } else {
          sortColumn = sh.col;
          sortAsc = true;
        }
        updateSortIcons(sh.id, sortAsc);
        renderTableRows();
      });
    });
  }

  function updateSortIcons(activeHeaderId, isAsc) {
    const icons = document.querySelectorAll('.gordura-sort-icon');
    icons.forEach(ic => {
      ic.textContent = '↕';
      ic.style.color = 'var(--text-muted)';
    });

    const activeHeader = document.getElementById(activeHeaderId);
    if (activeHeader) {
      const activeIcon = activeHeader.querySelector('.gordura-sort-icon');
      if (activeIcon) {
        activeIcon.textContent = isAsc ? '↑' : '↓';
        activeIcon.style.color = '#38bdf8';
      }
    }
  }

  function exportarParaExcel() {
    const rows = getFilteredRows();
    if (!rows || rows.length === 0) {
      alert('Não há dados disponíveis para exportação com os filtros atuais.');
      return;
    }

    const headers = [
      'Empresa',
      'Data Emissao',
      'Nota Fiscal',
      'Serie NF',
      'Pedido Venda',
      'Cliente',
      'Vendedor',
      'Cod Vendedor',
      'Transportadora',
      'Conhecimento CTE',
      'Frete Adicional R$',
      'Frete Embutido R$',
      'Frete Cobrado Cliente R$',
      'Custo Frete Real R$',
      'Gordura Frete R$',
      'Margem Percentual',
      'Status Gordura'
    ];

    const csvLines = [headers.join(';')];

    rows.forEach(r => {
      const line = [
        `"${(r.empresa || '').replace(/"/g, '""')}"`,
        `"${r.dataEmissaoFormatada || r.dataEmissao || ''}"`,
        `"${r.notaFiscal || ''}"`,
        `"${r.serieNF || ''}"`,
        `"${(r.pedidoVenda || '').replace(/"/g, '""')}"`,
        `"${(r.cliente || '').replace(/"/g, '""')}"`,
        `"${(r.vendedor || '').replace(/"/g, '""')}"`,
        `"${r.codVendedor || ''}"`,
        `"${(r.transportadora || '').replace(/"/g, '""')}"`,
        `"${r.conhecimento || ''}"`,
        (r.freteAdicional || 0).toFixed(2).replace('.', ','),
        (r.freteEmbutido || 0).toFixed(2).replace('.', ','),
        (r.freteCobradoCliente || 0).toFixed(2).replace('.', ','),
        (r.custoFreteReal || 0).toFixed(2).replace('.', ','),
        (r.gorduraFrete || 0).toFixed(2).replace('.', ','),
        (r.percentualGordura || 0).toFixed(2).replace('.', ',') + '%',
        `"${r.statusGordura || ''}"`
      ];
      csvLines.push(line.join(';'));
    });

    const csvContent = '\uFEFF' + csvLines.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dtAtual = new Date().toISOString().slice(0, 10);
    a.download = `fechamento_gordura_frete_${dtAtual}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Exporta para escopo global caso necessário
  window.GorduraFreteModule = {
    init,
    consultar: consultarGorduraFreteAction,
    exportarExcel: exportarParaExcel,
    calcularCiclo: calcularCicloLocal
  };

  // Inicializa quando o DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
