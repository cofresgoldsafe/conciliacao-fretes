/**
 * public/js/bi_os.js
 * Controlador Frontend da Sub-Aba "🛠️ OS" em "📊 BI EXECUTIVO"
 * Plataforma de Apoio GSI (Gemini-Cli)
 *
 * Funcionalidades:
 * 1. Gráfico 1 (Barras + Linha de Média): Recebimentos Quitados de OS no Protheus (SE1150) nos últimos 24 meses.
 *    - Alternância entre Regime de Caixa (Data da Baixa) e Competência (Data de Emissão).
 *    - Drilldown interativo: clicar em uma barra filtra os títulos daquele mês na tabela analítica.
 * 2. Gráfico 2 (Barras Empilhadas / Filtráveis): Quantidade de OS Criadas nos últimos 20 meses (Supabase Assistência).
 *    - Indicação clara de OS Padrão vs Garantia + filtro rápido ("Todas", "Só OS Padrão", "Só Garantia").
 * 3. 4 Cards Executivos de KPIs e Tabela Analítica Paginada (Pilar 1) com exportação CSV.
 */

(function () {
  'use strict';

  const state = {
    initialized: false,
    loadingDashboard: false,
    loadingTitulos: false,
    regime: 'baixa', // 'baixa' | 'emissao'
    filtroTipoOs: 'todas', // 'todas' | 'padrao' | 'garantia'
    mesAnoFiltro: '', // '' (todos os 24m) ou 'YYYY-MM'
    search: '',
    page: 1,
    limit: 50,
    dashboardData: null,
    titulosItems: [],
    pagination: {
      page: 1,
      limit: 50,
      total: 0,
      totalPages: 1,
      hasNext: false
    }
  };

  let chartFaturamentoInstance = null;
  let chartCriadasInstance = null;

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getAuthToken() {
    try {
      const rawSession = localStorage.getItem('conciliacao_fretes_session');
      if (rawSession) {
        const parsed = JSON.parse(rawSession);
        if (parsed && parsed.token) return parsed.token;
      }
      const directToken = localStorage.getItem('gsi_auth_token');
      if (directToken) return directToken;
    } catch (e) {
      // ignora erro de parse
    }
    return '';
  }

  function formatBrl(val) {
    const num = Number(val) || 0;
    return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function formatInt(val) {
    const num = Number(val) || 0;
    return num.toLocaleString('pt-BR');
  }

  function formatYmdBr(ymd) {
    const clean = String(ymd || '').replace(/\D/g, '');
    if (clean.length !== 8) return ymd || '-';
    return `${clean.slice(6, 8)}/${clean.slice(4, 6)}/${clean.slice(0, 4)}`;
  }

  function formatDateTimeBr(isoStr) {
    if (!isoStr) return '--';
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return isoStr;
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  async function apiFetch(url, options = {}) {
    const token = getAuthToken();
    const headers = Object.assign(
      {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      options.headers || {}
    );
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(url, Object.assign({}, options, { headers }));
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
      throw new Error(data.error || data.message || `Erro HTTP ${response.status}`);
    }
    return data;
  }

  /**
   * Atualiza os 4 KPIs Executivos no topo da aba
   */
  function renderKpis() {
    if (!state.dashboardData || !state.dashboardData.kpis) return;
    const kpis = state.dashboardData.kpis;

    const elReceita24m = document.getElementById('kpiBiOsReceita24m');
    const elMediaReceita = document.getElementById('kpiBiOsMediaReceita');
    const elReceitaMesAtual = document.getElementById('kpiBiOsReceitaMesAtual');
    const elVariacaoMes = document.getElementById('kpiBiOsVariacaoMes');
    const elTotalCriadas = document.getElementById('kpiBiOsTotalCriadas20m');
    const elMediaCriadas = document.getElementById('kpiBiOsMediaCriadas');
    const elMixResumo = document.getElementById('kpiBiOsMixResumo');
    const elTaxaGarantia = document.getElementById('kpiBiOsTaxaGarantia');
    const elSyncStatus = document.getElementById('biOsSyncStatusText');

    if (elSyncStatus) {
      const syncLabel = formatDateTimeBr(state.dashboardData.lastSyncAt);
      const cacheTag = state.dashboardData.fromCache ? ' (Cache)' : ' (Ao vivo)';
      elSyncStatus.textContent = `Atualizado: ${syncLabel}${cacheTag}`;
    }

    if (elReceita24m) {
      elReceita24m.textContent = formatBrl(kpis.receitaTotal24m);
    }
    if (elMediaReceita) {
      elMediaReceita.textContent = `Média: ${formatBrl(kpis.mediaMensalReceita24m)}/mês · ${formatInt(kpis.qtdTitulos24m)} títulos`;
    }

    if (elReceitaMesAtual) {
      elReceitaMesAtual.textContent = formatBrl(kpis.receitaMesAtual);
    }
    if (elVariacaoMes) {
      const varPct = Number(kpis.variacaoMesPct) || 0;
      const sign = varPct > 0 ? '+' : '';
      const melhorLabel = kpis.melhorMesReceita && kpis.melhorMesReceita.label
        ? ` · Pico: ${kpis.melhorMesReceita.label} (${formatBrl(kpis.melhorMesReceita.valor)})`
        : '';
      elVariacaoMes.textContent = `${sign}${varPct.toFixed(1).replace('.', ',')}% vs mês ant.${melhorLabel}`;
      elVariacaoMes.style.background = varPct >= 0 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)';
      elVariacaoMes.style.color = varPct >= 0 ? '#10b981' : '#f59e0b';
    }

    // KPIs 3 e 4 reagem também ao filtro de tipo de OS selecionado
    const totalPadrao = Number(kpis.totalPadrao20m) || 0;
    const totalGarantia = Number(kpis.totalGarantia20m) || 0;
    const totalGeral = Number(kpis.totalOs20m) || 0;

    if (elTotalCriadas && elMediaCriadas) {
      if (state.filtroTipoOs === 'padrao') {
        elTotalCriadas.textContent = formatInt(totalPadrao);
        elMediaCriadas.textContent = `Média: ${(totalPadrao / 20).toFixed(1).replace('.', ',')} OS Padrão/mês`;
      } else if (state.filtroTipoOs === 'garantia') {
        elTotalCriadas.textContent = formatInt(totalGarantia);
        elMediaCriadas.textContent = `Média: ${(totalGarantia / 20).toFixed(1).replace('.', ',')} Garantias/mês`;
      } else {
        elTotalCriadas.textContent = formatInt(totalGeral);
        elMediaCriadas.textContent = `Média: ${Number(kpis.mediaMensalOs20m || 0).toFixed(1).replace('.', ',')} OS/mês`;
      }
    }

    if (elMixResumo) {
      elMixResumo.textContent = `${formatInt(totalPadrao)} Padrão · ${formatInt(totalGarantia)} Garantia`;
    }
    if (elTaxaGarantia) {
      const taxa = Number(kpis.taxaGarantiaPct) || 0;
      const pctPadrao = totalGeral > 0 ? (100 - taxa).toFixed(1).replace('.', ',') : '0,0';
      elTaxaGarantia.textContent = `Garantia: ${taxa.toFixed(1).replace('.', ',')}% · Padrão: ${pctPadrao}%`;
    }
  }

  /**
   * Popula o select de meses da tabela analítica com os 24 meses disponíveis
   */
  function populateMesFiltroSelect() {
    const selectEl = document.getElementById('biOsFiltroMesTabela');
    const btnLimparMes = document.getElementById('btnBiOsLimparMes');
    if (!selectEl || !state.dashboardData) return;

    const serie24 = Array.isArray(state.dashboardData.faturamento24m)
      ? state.dashboardData.faturamento24m
      : [];

    const currentVal = state.mesAnoFiltro || '';
    const optionsHtml = ['<option value="">Todos os 24 meses</option>'];

    for (let i = serie24.length - 1; i >= 0; i--) {
      const m = serie24[i];
      const sel = m.mesAno === currentVal ? ' selected' : '';
      optionsHtml.push(
        `<option value="${escapeHtml(m.mesAno)}"${sel}>${escapeHtml(m.label)} (${formatBrl(m.valorTotal)})</option>`
      );
    }

    selectEl.innerHTML = optionsHtml.join('');
    selectEl.value = currentVal;

    if (btnLimparMes) {
      btnLimparMes.style.display = currentVal ? 'inline-flex' : 'none';
    }
  }

  /**
   * Renderiza o Gráfico 1: Recebimentos Quitados de OS nos últimos 24 meses (Protheus SE1150)
   */
  function renderChartFaturamento24m() {
    const canvas = document.getElementById('chartBiOsFaturamento24m');
    if (!canvas || typeof window.Chart === 'undefined' || !state.dashboardData) return;

    if (chartFaturamentoInstance) {
      chartFaturamentoInstance.destroy();
      chartFaturamentoInstance = null;
    }

    const serie24 = Array.isArray(state.dashboardData.faturamento24m)
      ? state.dashboardData.faturamento24m
      : [];
    const mediaMensal = Number(state.dashboardData.kpis?.mediaMensalReceita24m) || 0;

    const labels = serie24.map((item) => item.label);
    const values = serie24.map((item) => item.valorTotal);
    const mediaLine = serie24.map(() => mediaMensal);

    const bgColors = serie24.map((item) => {
      if (state.mesAnoFiltro && item.mesAno === state.mesAnoFiltro) {
        return 'rgba(56, 189, 248, 0.92)'; // Destaque ciano quando filtrado
      }
      return 'rgba(16, 185, 129, 0.78)'; // Verde esmeralda padrão
    });

    const borderColors = serie24.map((item) => {
      if (state.mesAnoFiltro && item.mesAno === state.mesAnoFiltro) {
        return '#38bdf8';
      }
      return '#10b981';
    });

    chartFaturamentoInstance = new window.Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            type: 'bar',
            label: state.regime === 'emissao' ? 'Quitados por Emissão (R$)' : 'Recebimentos Quitados (R$)',
            data: values,
            backgroundColor: bgColors,
            borderColor: borderColors,
            borderWidth: 1.5,
            borderRadius: 5,
            order: 2
          },
          {
            type: 'line',
            label: 'Média Mensal (24m)',
            data: mediaLine,
            borderColor: '#f59e0b',
            borderWidth: 2,
            borderDash: [6, 4],
            pointRadius: 0,
            fill: false,
            order: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        onClick: (_evt, elements) => {
          if (!elements || elements.length === 0) return;
          const idx = elements[0].index;
          const clickedBucket = serie24[idx];
          if (!clickedBucket) return;

          // Toggle do filtro do mês clicado
          if (state.mesAnoFiltro === clickedBucket.mesAno) {
            state.mesAnoFiltro = '';
          } else {
            state.mesAnoFiltro = clickedBucket.mesAno;
          }
          state.page = 1;
          populateMesFiltroSelect();
          renderChartFaturamento24m();
          loadTitulosPaginados();
        },
        plugins: {
          legend: {
            labels: {
              color: '#cbd5e1',
              font: { size: 12, weight: '600' }
            }
          },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                if (ctx.dataset.type === 'line') {
                  return ` Média 24m: ${formatBrl(ctx.parsed.y)}`;
                }
                const bucket = serie24[ctx.dataIndex];
                const valorStr = formatBrl(ctx.parsed.y);
                const qtdStr = bucket ? `${bucket.qtdTitulos} título(s)` : '';
                return ` Valor Quitado: ${valorStr} (${qtdStr})`;
              },
              afterBody: function (items) {
                if (!items || !items.length) return '';
                const bucket = serie24[items[0].dataIndex];
                if (!bucket || !bucket.qtdTitulos) return '';
                return `Ticket Médio: ${formatBrl(bucket.ticketMedio)}`;
              }
            }
          }
        },
        scales: {
          x: {
            ticks: { color: '#94a3b8', font: { size: 11 } },
            grid: { color: 'rgba(148, 163, 184, 0.08)' }
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: '#94a3b8',
              font: { size: 11 },
              callback: function (value) {
                if (value >= 1000) {
                  return 'R$ ' + (value / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'k';
                }
                return 'R$ ' + value;
              }
            },
            grid: { color: 'rgba(148, 163, 184, 0.12)' }
          }
        }
      }
    });
  }

  /**
   * Renderiza o Gráfico 2: Quantidade de OS Criadas nos últimos 20 meses (Supabase Assistência)
   * Suporta filtro "todas" (empilhado Padrão + Garantia), "padrao" ou "garantia"
   */
  function renderChartCriadas20m() {
    const canvas = document.getElementById('chartBiOsCriadas20m');
    if (!canvas || typeof window.Chart === 'undefined' || !state.dashboardData) return;

    if (chartCriadasInstance) {
      chartCriadasInstance.destroy();
      chartCriadasInstance = null;
    }

    const serie20 = Array.isArray(state.dashboardData.osCriadas20m)
      ? state.dashboardData.osCriadas20m
      : [];

    const labels = serie20.map((item) => item.label);
    const dataPadrao = serie20.map((item) => item.padrao);
    const dataGarantia = serie20.map((item) => item.garantia);

    const datasets = [];
    const isStacked = state.filtroTipoOs === 'todas';

    if (state.filtroTipoOs === 'todas' || state.filtroTipoOs === 'padrao') {
      datasets.push({
        label: 'OS Padrão',
        data: dataPadrao,
        backgroundColor: 'rgba(59, 130, 246, 0.82)',
        borderColor: '#3b82f6',
        borderWidth: 1.5,
        borderRadius: isStacked ? 3 : 5,
        stack: isStacked ? 'os_stack' : undefined
      });
    }

    if (state.filtroTipoOs === 'todas' || state.filtroTipoOs === 'garantia') {
      datasets.push({
        label: 'Garantia',
        data: dataGarantia,
        backgroundColor: 'rgba(245, 158, 11, 0.88)',
        borderColor: '#f59e0b',
        borderWidth: 1.5,
        borderRadius: 5,
        stack: isStacked ? 'os_stack' : undefined
      });
    }

    chartCriadasInstance = new window.Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            labels: {
              color: '#cbd5e1',
              font: { size: 12, weight: '600' }
            }
          },
          tooltip: {
            callbacks: {
              afterBody: function (items) {
                if (!items || !items.length) return '';
                const bucket = serie20[items[0].dataIndex];
                if (!bucket) return '';
                const pctGarantia = bucket.total > 0
                  ? ((bucket.garantia / bucket.total) * 100).toFixed(1).replace('.', ',')
                  : '0,0';
                return `Total no Mês: ${bucket.total} OS (${pctGarantia}% Garantia)`;
              }
            }
          }
        },
        scales: {
          x: {
            stacked: isStacked,
            ticks: { color: '#94a3b8', font: { size: 11 } },
            grid: { color: 'rgba(148, 163, 184, 0.08)' }
          },
          y: {
            stacked: isStacked,
            beginAtZero: true,
            ticks: {
              color: '#94a3b8',
              font: { size: 11 },
              precision: 0
            },
            grid: { color: 'rgba(148, 163, 184, 0.12)' }
          }
        }
      }
    });
  }

  /**
   * Atualiza visual dos botões de pílula do filtro de tipo de OS ("Todas", "Só OS Padrão", "Só Garantia")
   */
  function updateFiltroTipoButtons() {
    const mapBtns = [
      { id: 'btnBiOsFiltroTodas', tipo: 'todas' },
      { id: 'btnBiOsFiltroPadrao', tipo: 'padrao' },
      { id: 'btnBiOsFiltroGarantia', tipo: 'garantia' }
    ];

    for (const entry of mapBtns) {
      const btn = document.getElementById(entry.id);
      if (!btn) continue;
      if (state.filtroTipoOs === entry.tipo) {
        btn.classList.remove('btn-outline');
        btn.classList.add('btn-primary');
      } else {
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-outline');
      }
    }
  }

  /**
   * Renderiza a tabela analítica paginada de títulos SE1150
   */
  function renderTitulosTable(resumo = { totalValor: 0, totalTitulos: 0 }) {
    const tbody = document.getElementById('biOsTabelaTitulosBody');
    const elResumo = document.getElementById('biOsTabelaResumo');
    const elPagInfo = document.getElementById('biOsPaginationInfo');
    const btnPrev = document.getElementById('btnBiOsPrevPage');
    const btnNext = document.getElementById('btnBiOsNextPage');

    if (elResumo) {
      const filtroTag = state.mesAnoFiltro ? ` · Filtro: ${state.mesAnoFiltro}` : ' · Últimos 24 meses';
      elResumo.textContent = `${formatInt(resumo.totalTitulos)} título(s) quitado(s) · Soma: ${formatBrl(resumo.totalValor)}${filtroTag}`;
    }

    if (elPagInfo) {
      elPagInfo.textContent = `Página ${state.pagination.page} de ${state.pagination.totalPages} (${formatInt(state.pagination.total)} reg.)`;
    }

    if (btnPrev) {
      btnPrev.disabled = state.pagination.page <= 1;
    }
    if (btnNext) {
      btnNext.disabled = !state.pagination.hasNext;
    }

    if (!tbody) return;

    if (!state.titulosItems || state.titulosItems.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 2.2rem; color: var(--text-muted);">
            Nenhum título quitado de OS encontrado para os filtros selecionados.
          </td>
        </tr>
      `;
      return;
    }

    const rowsHtml = state.titulosItems.map((item) => {
      const clienteStr = item.cliente_cod
        ? `${escapeHtml(item.cliente_cod)} - ${escapeHtml(item.cliente_nome || '-')}`
        : escapeHtml(item.cliente_nome || '-');

      return `
        <tr>
          <td style="padding: 9px 10px; white-space: nowrap; font-weight: 600; color: #10b981;">${escapeHtml(formatYmdBr(item.baixa))}</td>
          <td style="padding: 9px 10px; white-space: nowrap; color: var(--text-muted);">${escapeHtml(formatYmdBr(item.emissao))}</td>
          <td style="padding: 9px 10px;"><span class="badge" style="background: rgba(148, 163, 184, 0.15); color: #cbd5e1;">${escapeHtml(item.prefixo || '-')}</span></td>
          <td style="padding: 9px 10px; font-family: monospace; font-weight: 700; color: #38bdf8;">${escapeHtml(item.numero)}</td>
          <td style="padding: 9px 10px; text-align: center;">${escapeHtml(item.parcela || '-')}</td>
          <td style="padding: 9px 10px;">${clienteStr}</td>
          <td style="padding: 9px 10px; color: var(--text-muted); font-size: 0.8rem;">${escapeHtml(item.historico || '-')}</td>
          <td style="padding: 9px 10px; text-align: right; font-weight: 700; color: #10b981; white-space: nowrap;">${escapeHtml(formatBrl(item.valor_pago))}</td>
        </tr>
      `;
    });

    tbody.innerHTML = rowsHtml.join('');
  }

  /**
   * Carrega a listagem paginada de títulos SE1150 do servidor
   */
  async function loadTitulosPaginados() {
    if (state.loadingTitulos) return;
    state.loadingTitulos = true;

    const tbody = document.getElementById('biOsTabelaTitulosBody');
    if (tbody && (!state.titulosItems || state.titulosItems.length === 0)) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 2rem; color: var(--text-muted);">
            Carregando títulos quitados de OS...
          </td>
        </tr>
      `;
    }

    try {
      const params = new URLSearchParams({
        regime: state.regime,
        mesAno: state.mesAnoFiltro || '',
        search: state.search || '',
        page: String(state.page),
        limit: String(state.limit)
      });

      const data = await apiFetch(`/api/bi/os/titulos?${params.toString()}`);
      state.titulosItems = Array.isArray(data.items) ? data.items : [];
      state.pagination = data.pagination || {
        page: state.page,
        limit: state.limit,
        total: state.titulosItems.length,
        totalPages: 1,
        hasNext: false
      };
      renderTitulosTable(data.resumo || { totalValor: 0, totalTitulos: 0 });
    } catch (err) {
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="8" style="text-align: center; padding: 2rem; color: #ef4444;">
              Erro ao carregar títulos: ${escapeHtml(err.message)}
            </td>
          </tr>
        `;
      }
    } finally {
      state.loadingTitulos = false;
    }
  }

  /**
   * Carrega os dados consolidados do dashboard (KPIs + Gráfico 24m + Gráfico 20m)
   */
  async function loadDashboard({ forceSync = false } = {}) {
    if (state.loadingDashboard) return;
    state.loadingDashboard = true;

    const btnSync = document.getElementById('btnBiOsSync');
    const elSyncStatus = document.getElementById('biOsSyncStatusText');
    if (btnSync) btnSync.disabled = true;
    if (elSyncStatus) elSyncStatus.textContent = forceSync ? 'Sincronizando Protheus + Supabase...' : 'Carregando...';

    try {
      let data;
      if (forceSync) {
        data = await apiFetch('/api/bi/os/sync', {
          method: 'POST',
          body: JSON.stringify({ regime: state.regime })
        });
      } else {
        data = await apiFetch(`/api/bi/os/dashboard?regime=${encodeURIComponent(state.regime)}`);
      }

      state.dashboardData = data;
      renderKpis();
      populateMesFiltroSelect();
      renderChartFaturamento24m();
      renderChartCriadas20m();
      await loadTitulosPaginados();
    } catch (err) {
      if (elSyncStatus) {
        elSyncStatus.textContent = `Erro: ${err.message}`;
      }
    } finally {
      state.loadingDashboard = false;
      if (btnSync) btnSync.disabled = false;
    }
  }

  /**
   * Exporta os títulos filtrados da página atual (ou até 200 registros) para CSV UTF-8 BOM
   */
  async function exportTitulosCsv() {
    try {
      const params = new URLSearchParams({
        regime: state.regime,
        mesAno: state.mesAnoFiltro || '',
        search: state.search || '',
        page: '1',
        limit: '200'
      });
      const data = await apiFetch(`/api/bi/os/titulos?${params.toString()}`);
      const rows = Array.isArray(data.items) ? data.items : [];
      if (!rows.length) return;

      const header = ['Baixa', 'Emissao', 'Filial', 'Prefixo', 'Numero_OS', 'Parcela', 'Codigo_Cliente', 'Nome_Cliente', 'Historico', 'Valor_Quitado'];
      const csvLines = [header.join(';')];

      for (const r of rows) {
        const line = [
          formatYmdBr(r.baixa),
          formatYmdBr(r.emissao),
          r.filial || '',
          r.prefixo || '',
          r.numero || '',
          r.parcela || '',
          r.cliente_cod || '',
          String(r.cliente_nome || '').replace(/;/g, ','),
          String(r.historico || '').replace(/;/g, ','),
          String(Number(r.valor_pago || 0).toFixed(2)).replace('.', ',')
        ];
        csvLines.push(line.join(';'));
      }

      const blob = new Blob(['\uFEFF' + csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bi_os_titulos_quitados_${state.mesAnoFiltro || '24m'}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[BI OS] Erro ao exportar CSV:', err);
    }
  }

  function bindEvents() {
    const selectRegime = document.getElementById('biOsSelectRegime');
    if (selectRegime) {
      selectRegime.addEventListener('change', () => {
        state.regime = selectRegime.value === 'emissao' ? 'emissao' : 'baixa';
        state.page = 1;
        loadDashboard({ forceSync: false });
      });
    }

    const btnSync = document.getElementById('btnBiOsSync');
    if (btnSync) {
      btnSync.addEventListener('click', () => {
        loadDashboard({ forceSync: true });
      });
    }

    const filterBtns = [
      { id: 'btnBiOsFiltroTodas', tipo: 'todas' },
      { id: 'btnBiOsFiltroPadrao', tipo: 'padrao' },
      { id: 'btnBiOsFiltroGarantia', tipo: 'garantia' }
    ];

    for (const entry of filterBtns) {
      const btn = document.getElementById(entry.id);
      if (btn) {
        btn.addEventListener('click', () => {
          state.filtroTipoOs = entry.tipo;
          updateFiltroTipoButtons();
          renderKpis();
          renderChartCriadas20m();
        });
      }
    }

    const selectMesTabela = document.getElementById('biOsFiltroMesTabela');
    if (selectMesTabela) {
      selectMesTabela.addEventListener('change', () => {
        state.mesAnoFiltro = selectMesTabela.value || '';
        state.page = 1;
        populateMesFiltroSelect();
        renderChartFaturamento24m();
        loadTitulosPaginados();
      });
    }

    const btnLimparMes = document.getElementById('btnBiOsLimparMes');
    if (btnLimparMes) {
      btnLimparMes.addEventListener('click', () => {
        state.mesAnoFiltro = '';
        state.page = 1;
        populateMesFiltroSelect();
        renderChartFaturamento24m();
        loadTitulosPaginados();
      });
    }

    const inputBusca = document.getElementById('biOsInputBuscaTitulos');
    const btnBuscar = document.getElementById('btnBiOsBuscarTitulos');
    if (btnBuscar) {
      btnBuscar.addEventListener('click', () => {
        state.search = inputBusca ? inputBusca.value.trim() : '';
        state.page = 1;
        loadTitulosPaginados();
      });
    }
    if (inputBusca) {
      inputBusca.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          state.search = inputBusca.value.trim();
          state.page = 1;
          loadTitulosPaginados();
        }
      });
    }

    const btnExportCsv = document.getElementById('btnBiOsExportCsv');
    if (btnExportCsv) {
      btnExportCsv.addEventListener('click', exportTitulosCsv);
    }

    const selectLimit = document.getElementById('biOsPageLimit');
    if (selectLimit) {
      selectLimit.addEventListener('change', () => {
        state.limit = parseInt(selectLimit.value, 10) || 50;
        state.page = 1;
        loadTitulosPaginados();
      });
    }

    const btnPrev = document.getElementById('btnBiOsPrevPage');
    if (btnPrev) {
      btnPrev.addEventListener('click', () => {
        if (state.page > 1) {
          state.page -= 1;
          loadTitulosPaginados();
        }
      });
    }

    const btnNext = document.getElementById('btnBiOsNextPage');
    if (btnNext) {
      btnNext.addEventListener('click', () => {
        if (state.pagination.hasNext) {
          state.page += 1;
          loadTitulosPaginados();
        }
      });
    }
  }

  function initBiOsView() {
    if (!state.initialized) {
      bindEvents();
      state.initialized = true;
    }
    loadDashboard({ forceSync: false });
  }

  window.initBiOsView = initBiOsView;
})();
