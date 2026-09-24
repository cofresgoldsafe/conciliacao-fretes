/**
 * public/js/bi_despesas.js
 * Módulo Frontend: BI Executivo — Análise de Despesas & Movimento Bancário (SE5)
 * Plataforma de Apoio GSI (Gemini-Cli)
 */

(function () {
  'use strict';

  let despesasInitialized = false;
  let isLoading = false;
  let chartPaiInstance = null;
  let chartCompInstance = null;
  let activeChartView = 'pai'; // 'pai' | 'comparativo'

  // Estado dos filtros e paginação
  const state = {
    periodo: 'ano_2026',
    dataIni: '',
    dataFim: '',
    empresa: 'TODAS',
    naturezaPai: 'TODAS',
    busca: '',
    incluirTransferencias: false,
    page: 1,
    limit: 50
  };

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
   * Helper: Sanitização contra XSS
   */
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Helper: Notificação Toast
   */
  function showToast(message, type = 'info') {
    if (typeof window.showNotification === 'function') {
      window.showNotification(message, type);
    } else {
      console.log(`[Toast ${type}]:`, message);
    }
  }

  /**
   * Inicialização da View (chamada pelo app.js ao abrir a aba)
   */
  function initBiDespesasView() {
    if (!despesasInitialized) {
      bindEvents();
      carregarNaturezasPais();
      carregarStatusSync();
      configurarDatasPorPeriodo('ano_2026');
      despesasInitialized = true;
    }
    carregarDadosCompletos();
  }

  /**
   * Vinculação de eventos DOM
   */
  function bindEvents() {
    // Seletor de Período
    const selPeriodo = document.getElementById('biDespesasFiltroPeriodo');
    if (selPeriodo) {
      selPeriodo.addEventListener('change', (e) => {
        configurarDatasPorPeriodo(e.target.value);
        state.page = 1;
        carregarDadosCompletos();
      });
    }

    // Seletor de Empresa
    const selEmpresa = document.getElementById('biDespesasFiltroEmpresa');
    if (selEmpresa) {
      selEmpresa.addEventListener('change', (e) => {
        state.empresa = e.target.value;
        state.page = 1;
        carregarDadosCompletos();
      });
    }

    // Seletor de Natureza Pai
    const selPai = document.getElementById('biDespesasFiltroNaturezaPai');
    if (selPai) {
      selPai.addEventListener('change', (e) => {
        state.naturezaPai = e.target.value;
        state.page = 1;
        carregarDadosCompletos();
      });
    }

    // Checkbox de Transferências
    const checkTransf = document.getElementById('biDespesasCheckTransferencias');
    if (checkTransf) {
      checkTransf.addEventListener('change', (e) => {
        state.incluirTransferencias = e.target.checked;
        state.page = 1;
        carregarDadosCompletos();
      });
    }

    // Botão Filtrar
    const btnFiltrar = document.getElementById('btnBiDespesasFiltrar');
    if (btnFiltrar) {
      btnFiltrar.addEventListener('click', () => {
        const inpBusca = document.getElementById('biDespesasFiltroBusca');
        const inpIni = document.getElementById('biDespesasDataIni');
        const inpFim = document.getElementById('biDespesasDataFim');

        if (inpBusca) state.busca = inpBusca.value.trim();
        if (state.periodo === 'custom') {
          if (inpIni) state.dataIni = inpIni.value;
          if (inpFim) state.dataFim = inpFim.value;
        }
        state.page = 1;
        carregarDadosCompletos();
      });
    }

    // Input de Busca no Enter
    const inpBusca = document.getElementById('biDespesasFiltroBusca');
    if (inpBusca) {
      inpBusca.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          state.busca = inpBusca.value.trim();
          state.page = 1;
          carregarDadosCompletos();
        }
      });
    }

    // Botão Limpar Filtros
    const btnLimpar = document.getElementById('btnBiDespesasLimpar');
    if (btnLimpar) {
      btnLimpar.addEventListener('click', () => {
        if (inpBusca) inpBusca.value = '';
        if (selEmpresa) selEmpresa.value = 'TODAS';
        if (selPai) selPai.value = 'TODAS';
        if (selPeriodo) selPeriodo.value = 'ano_2026';
        if (checkTransf) checkTransf.checked = false;

        state.empresa = 'TODAS';
        state.naturezaPai = 'TODAS';
        state.busca = '';
        state.incluirTransferencias = false;
        configurarDatasPorPeriodo('ano_2026');
        state.page = 1;
        carregarDadosCompletos();
      });
    }

    // Alternância de Gráficos (Segmented Control)
    const btnGrafPai = document.getElementById('btnBiDespesasGraficoPai');
    const btnGrafComp = document.getElementById('btnBiDespesasGraficoComparativo');

    if (btnGrafPai && btnGrafComp) {
      btnGrafPai.addEventListener('click', () => {
        activeChartView = 'pai';
        btnGrafPai.className = 'btn btn-primary btn-sm';
        btnGrafComp.className = 'btn btn-outline btn-sm';
        document.getElementById('biDespesasWrapperChartPai').style.display = 'block';
        document.getElementById('biDespesasWrapperChartComp').style.display = 'none';
        document.getElementById('biDespesasChartTitulo').textContent = 'Distribuição de Despesas por Natureza Pai';
        renderGraficoNaturezaPai();
      });

      btnGrafComp.addEventListener('click', () => {
        activeChartView = 'comparativo';
        btnGrafComp.className = 'btn btn-primary btn-sm';
        btnGrafPai.className = 'btn btn-outline btn-sm';
        document.getElementById('biDespesasWrapperChartPai').style.display = 'none';
        document.getElementById('biDespesasWrapperChartComp').style.display = 'block';
        document.getElementById('biDespesasChartTitulo').textContent = 'Comparativo Mês a Mês Lado a Lado (2025 vs 2026)';
        renderGraficoComparativo();
      });
    }

    // Paginação: Limite por página
    const selLimit = document.getElementById('biDespesasPageLimit');
    if (selLimit) {
      selLimit.addEventListener('change', (e) => {
        state.limit = parseInt(e.target.value, 10) || 50;
        state.page = 1;
        carregarLancamentos();
      });
    }

    // Paginação: Anterior / Próxima
    const btnPrev = document.getElementById('btnBiDespesasPrevPage');
    const btnNext = document.getElementById('btnBiDespesasNextPage');

    if (btnPrev) {
      btnPrev.addEventListener('click', () => {
        if (state.page > 1) {
          state.page--;
          carregarLancamentos();
        }
      });
    }

    if (btnNext) {
      btnNext.addEventListener('click', () => {
        state.page++;
        carregarLancamentos();
      });
    }

    // Exportação CSV
    const btnCsv = document.getElementById('btnBiDespesasExportCsv');
    if (btnCsv) {
      btnCsv.addEventListener('click', exportarCsvLancamentos);
    }

    // Botões de Sincronização Protheus
    const btnSync = document.getElementById('btnBiDespesasSync');
    if (btnSync) {
      btnSync.addEventListener('click', () => dispararSincronizacao('incremental'));
    }

    const btnSyncFull = document.getElementById('btnBiDespesasSyncFull');
    if (btnSyncFull) {
      btnSyncFull.addEventListener('click', () => {
        if (confirm('Deseja executar a carga completa desde 01/01/2025? Essa operação reprocessará todos os lançamentos das 3 empresas.')) {
          dispararSincronizacao('full');
        }
      });
    }
  }

  /**
   * Configura datas pré-definidas com base no período selecionado
   */
  function configurarDatasPorPeriodo(tipo) {
    state.periodo = tipo;
    const divCustom = document.getElementById('biDespesasCustomDatas');
    const inpIni = document.getElementById('biDespesasDataIni');
    const inpFim = document.getElementById('biDespesasDataFim');

    const agora = new Date();
    const anoAtual = agora.getFullYear();
    const mesAtual = agora.getMonth() + 1;

    if (divCustom) divCustom.style.display = (tipo === 'custom') ? 'grid' : 'none';

    if (tipo === 'ano_2026') {
      state.dataIni = '2026-01-01';
      state.dataFim = '2026-12-31';
    } else if (tipo === 'ano_2025') {
      state.dataIni = '2025-01-01';
      state.dataFim = '2025-12-31';
    } else if (tipo === 'mes_atual') {
      const mStr = String(mesAtual).padStart(2, '0');
      const ultDia = new Date(anoAtual, mesAtual, 0).getDate();
      state.dataIni = `${anoAtual}-${mStr}-01`;
      state.dataFim = `${anoAtual}-${mStr}-${String(ultDia).padStart(2, '0')}`;
    } else if (tipo === 'mes_anterior') {
      const dataMesAnt = new Date(anoAtual, mesAtual - 2, 1);
      const anoAnt = dataMesAnt.getFullYear();
      const mesAnt = dataMesAnt.getMonth() + 1;
      const mStr = String(mesAnt).padStart(2, '0');
      const ultDia = new Date(anoAnt, mesAnt, 0).getDate();
      state.dataIni = `${anoAnt}-${mStr}-01`;
      state.dataFim = `${anoAnt}-${mStr}-${String(ultDia).padStart(2, '0')}`;
    } else if (tipo === 'comparativo') {
      // Abre intervalo completo para o comparativo
      state.dataIni = '2025-01-01';
      state.dataFim = '2026-12-31';
      // Se não estiver na aba de comparativo, muda automaticamente
      const btnGrafComp = document.getElementById('btnBiDespesasGraficoComparativo');
      if (btnGrafComp && activeChartView !== 'comparativo') {
        btnGrafComp.click();
      }
    } else if (tipo === 'todos') {
      state.dataIni = '2025-01-01';
      state.dataFim = '';
    }

    if (inpIni && state.dataIni) inpIni.value = state.dataIni;
    if (inpFim && state.dataFim) inpFim.value = state.dataFim;
  }

  /**
   * Constrói Query String dos filtros atuais
   */
  function buildQueryString(extra = {}) {
    const params = new URLSearchParams();
    if (state.empresa && state.empresa !== 'TODAS') params.append('empresa', state.empresa);
    if (state.naturezaPai && state.naturezaPai !== 'TODAS') params.append('naturezaPai', state.naturezaPai);
    if (state.dataIni) params.append('dataIni', state.dataIni);
    if (state.dataFim) params.append('dataFim', state.dataFim);
    if (state.busca) params.append('busca', state.busca);
    if (state.incluirTransferencias) params.append('incluirTransferencias', 'true');

    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined && v !== null && v !== '') {
        params.append(k, String(v));
      }
    }

    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }

  /**
   * Carrega tudo em paralelo (KPIs, Gráficos e Lançamentos)
   */
  async function carregarDadosCompletos() {
    if (isLoading) return;
    isLoading = true;
    try {
      await Promise.all([
        carregarKpis(),
        activeChartView === 'pai' ? renderGraficoNaturezaPai() : renderGraficoComparativo(),
        carregarLancamentos()
      ]);
    } catch (err) {
      console.error('❌ [BI Despesas] Erro ao carregar dados:', err);
    } finally {
      isLoading = false;
    }
  }

  /**
   * 1. Carrega e preenche Cards de KPIs
   */
  async function carregarKpis() {
    const token = getAuthToken();
    try {
      const qs = buildQueryString();
      const res = await fetch(`/api/bi/despesas/kpis${qs}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Erro na resposta');

      // 1. Total Líquido
      const elLiq = document.getElementById('kpiDespesasLiquidas');
      if (elLiq) elLiq.textContent = formatMoney(data.totalLiquido);

      // Variação %
      const elVarBadge = document.getElementById('kpiDespesasVariacaoBadge');
      if (elVarBadge) {
        if (data.variacaoPercentualAnterior !== null && data.variacaoPercentualAnterior !== undefined) {
          const varNum = Number(data.variacaoPercentualAnterior);
          const sinal = varNum > 0 ? '+' : '';
          const cor = varNum > 0 ? '#ef4444' : '#10b981'; // Despesa subindo = vermelho, caindo = verde
          elVarBadge.style.background = varNum > 0 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)';
          elVarBadge.style.color = cor;
          elVarBadge.textContent = `${sinal}${varNum.toFixed(1)}% vs período anterior`;
        } else {
          elVarBadge.style.background = 'rgba(148, 163, 184, 0.2)';
          elVarBadge.style.color = 'var(--text-muted)';
          elVarBadge.textContent = 'Período base';
        }
      }

      // 2. Total Bruto
      const elBrut = document.getElementById('kpiDespesasBrutas');
      if (elBrut) elBrut.textContent = formatMoney(data.totalBruto);
      const elQtdLanc = document.getElementById('kpiDespesasQtdLancamentos');
      if (elQtdLanc) elQtdLanc.textContent = `${data.totalLancamentos.toLocaleString('pt-BR')} pagamentos`;

      // 3. Estornos
      const elEst = document.getElementById('kpiDespesasEstornos');
      if (elEst) elEst.textContent = formatMoney(data.totalEstornos);
      const elQtdEst = document.getElementById('kpiDespesasQtdEstornos');
      if (elQtdEst) elQtdEst.textContent = `${data.qtdEstornos.toLocaleString('pt-BR')} estornos contabilizados`;

      // 4. Maior Grupo
      const elMaiorVlr = document.getElementById('kpiDespesasMaiorGrupoValor');
      const elMaiorNome = document.getElementById('kpiDespesasMaiorGrupoNome');
      if (elMaiorVlr && data.maiorGrupo) {
        elMaiorVlr.textContent = formatMoney(data.maiorGrupo.valor);
      }
      if (elMaiorNome && data.maiorGrupo) {
        elMaiorNome.textContent = `${data.maiorGrupo.nome} (${data.maiorGrupo.percentual || 0}%)`;
        elMaiorNome.title = data.maiorGrupo.nome;
      }

    } catch (err) {
      console.warn('⚠️ [BI Despesas] Erro ao carregar KPIs:', err.message);
    }
  }

  /**
   * 2. Renderiza Gráfico 1: Natureza Pai (Chart.js)
   */
  async function renderGraficoNaturezaPai() {
    const canvas = document.getElementById('chartBiDespesasPai');
    if (!canvas || typeof Chart === 'undefined') return;

    const token = getAuthToken();
    try {
      const qs = buildQueryString();
      const res = await fetch(`/api/bi/despesas/grafico-pai${qs}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      const itens = (data.itens || []).filter(it => it.valorLiquido > 0);
      const labels = itens.map(it => it.descricao || it.codigo);
      const valores = itens.map(it => it.valorLiquido);

      // Cores elegantes com transparência
      const paleta = [
        '#38bdf8', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7',
        '#ec4899', '#f43f5e', '#f97316', '#eab308', '#10b981',
        '#14b8a6', '#06b6d4', '#64748b'
      ];

      if (chartPaiInstance) {
        chartPaiInstance.destroy();
        chartPaiInstance = null;
      }

      chartPaiInstance = new Chart(canvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Despesa Líquida (R$)',
            data: valores,
            backgroundColor: labels.map((_, i) => paleta[i % paleta.length]),
            borderRadius: 6,
            borderSkipped: false
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: 'y', // Barras horizontais para facilitar leitura de rótulos longos
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: function (ctx) {
                  const val = ctx.raw || 0;
                  const item = itens[ctx.dataIndex];
                  return ` ${formatMoney(val)} (${item ? item.percentual : 0}% do total)`;
                }
              }
            }
          },
          scales: {
            x: {
              grid: { color: 'rgba(255, 255, 255, 0.08)' },
              ticks: {
                color: '#94a3b8',
                callback: function (val) {
                  if (val >= 1000000) return `R$ ${(val / 1000000).toFixed(1)}M`;
                  if (val >= 1000) return `R$ ${(val / 1000).toFixed(0)}k`;
                  return `R$ ${val}`;
                }
              }
            },
            y: {
              grid: { display: false },
              ticks: {
                color: '#e2e8f0',
                font: { size: 11, weight: '600' }
              }
            }
          },
          onClick: function (evt, elements) {
            if (elements && elements.length > 0) {
              const idx = elements[0].index;
              const item = itens[idx];
              if (item) {
                const selPai = document.getElementById('biDespesasFiltroNaturezaPai');
                if (selPai) {
                  selPai.value = item.codigo;
                  state.naturezaPai = item.codigo;
                  state.page = 1;
                  carregarDadosCompletos();
                  showToast(`Filtrado por: ${item.descricao}`, 'info');
                }
              }
            }
          }
        }
      });

    } catch (err) {
      console.warn('⚠️ [BI Despesas] Erro ao renderizar gráfico Pai:', err.message);
    }
  }

  /**
   * 3. Renderiza Gráfico 2: Comparativo Lado a Lado Mês a Mês (2025 vs 2026)
   */
  async function renderGraficoComparativo() {
    const canvas = document.getElementById('chartBiDespesasComparativo');
    if (!canvas || typeof Chart === 'undefined') return;

    const token = getAuthToken();
    try {
      const qs = buildQueryString();
      const res = await fetch(`/api/bi/despesas/comparativo-anual${qs}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      const meses = data.meses || [];
      const labels = meses.map(m => m.abrevMes);
      const valores2025 = meses.map(m => m.valor2025);
      const valores2026 = meses.map(m => m.valor2026);

      if (chartCompInstance) {
        chartCompInstance.destroy();
        chartCompInstance = null;
      }

      chartCompInstance = new Chart(canvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'Ano 2025',
              data: valores2025,
              backgroundColor: '#64748b', // Cinza azulado
              borderRadius: 4
            },
            {
              label: 'Ano 2026',
              data: valores2026,
              backgroundColor: '#10b981', // Verde esmeralda vivo
              borderRadius: 4
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'top',
              labels: {
                color: '#e2e8f0',
                font: { weight: '600' }
              }
            },
            tooltip: {
              callbacks: {
                label: function (ctx) {
                  return ` ${ctx.dataset.label}: ${formatMoney(ctx.raw)}`;
                },
                afterBody: function (tooltipItems) {
                  if (tooltipItems.length >= 1) {
                    const idx = tooltipItems[0].dataIndex;
                    const itemMes = meses[idx];
                    if (itemMes && itemMes.variacaoPercentual !== null) {
                      const sinal = itemMes.diferenca > 0 ? '+' : '';
                      return `\nVariação: ${sinal}${itemMes.variacaoPercentual.toFixed(1)}% (${formatMoney(itemMes.diferenca)})`;
                    }
                  }
                  return '';
                }
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: '#e2e8f0', font: { weight: '600' } }
            },
            y: {
              grid: { color: 'rgba(255, 255, 255, 0.08)' },
              ticks: {
                color: '#94a3b8',
                callback: function (val) {
                  if (val >= 1000000) return `R$ ${(val / 1000000).toFixed(1)}M`;
                  if (val >= 1000) return `R$ ${(val / 1000).toFixed(0)}k`;
                  return `R$ ${val}`;
                }
              }
            }
          }
        }
      });

    } catch (err) {
      console.warn('⚠️ [BI Despesas] Erro ao renderizar gráfico comparativo:', err.message);
    }
  }

  /**
   * 4. Carrega e Renderiza Tabela Analítica Paginada
   */
  async function carregarLancamentos() {
    const tbody = document.getElementById('biDespesasTabelaBody');
    if (!tbody) return;

    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; padding: 2rem; color: var(--text-muted);">
          <span style="display: inline-block; animation: spin 1s linear infinite; margin-right: 8px;">⏳</span> Carregando lançamentos...
        </td>
      </tr>
    `;

    const token = getAuthToken();
    try {
      const qs = buildQueryString({ page: state.page, limit: state.limit });
      const res = await fetch(`/api/bi/despesas/lancamentos${qs}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      const items = data.items || [];
      const pag = data.pagination || {};

      // Atualiza textos de paginação
      const elResumo = document.getElementById('biDespesasTabelaResumoRegistros');
      if (elResumo) {
        elResumo.textContent = `Exibindo ${items.length} de ${pag.total.toLocaleString('pt-BR')} lançamentos | Total Líquido: ${formatMoney(pag.totalLiquido)}`;
      }

      const elInfo = document.getElementById('biDespesasPaginationInfo');
      if (elInfo) {
        elInfo.textContent = `Página ${pag.page} de ${pag.totalPages}`;
      }

      const btnPrev = document.getElementById('btnBiDespesasPrevPage');
      const btnNext = document.getElementById('btnBiDespesasNextPage');
      if (btnPrev) btnPrev.disabled = !pag.hasPrev;
      if (btnNext) btnNext.disabled = !pag.hasNext;

      if (items.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="9" style="text-align: center; padding: 3rem; color: var(--text-muted);">
              Nenhum lançamento de despesa encontrado para os filtros selecionados.
            </td>
          </tr>
        `;
        return;
      }

      // Renderiza Linhas
      tbody.innerHTML = items.map(it => {
        const isEst = it.is_estorno;
        const isTransf = it.is_transferencia;
        const valClass = isEst ? 'color: #ef4444; font-weight: 700;' : 'color: var(--text-main); font-weight: 600;';
        const valPrefix = isEst ? '-' : '';
        const valorFormatado = `${valPrefix}${formatMoney(Math.abs(it.valor_liquido))}`;

        // Badge da Empresa
        let empBadge = `<span class="badge" style="background: rgba(148, 163, 184, 0.2); color: #94a3b8; font-weight: 600;">${it.empresa_sigla}</span>`;
        if (it.empresa_sigla === 'MP') {
          empBadge = `<span class="badge" style="background: rgba(59, 130, 246, 0.2); color: #60a5fa; font-weight: 600;">MP</span>`;
        } else if (it.empresa_sigla === 'GSI') {
          empBadge = `<span class="badge" style="background: rgba(16, 185, 129, 0.2); color: #34d399; font-weight: 600;">GSI</span>`;
        } else if (it.empresa_sigla === 'OACO') {
          empBadge = `<span class="badge" style="background: rgba(249, 115, 22, 0.2); color: #fb923c; font-weight: 600;">OAÇO</span>`;
        }

        // Badge do Tipo
        let tipoBadge = `<span class="badge" style="background: rgba(148, 163, 184, 0.15); color: var(--text-muted); font-size: 0.72rem;">${escapeHtml(it.tipo_doc || 'VL')}</span>`;
        if (isEst) {
          tipoBadge = `<span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #ef4444; font-weight: 700; font-size: 0.72rem;">Estorno</span>`;
        } else if (isTransf) {
          tipoBadge = `<span class="badge" style="background: rgba(168, 85, 247, 0.2); color: #c084fc; font-size: 0.72rem;">Transf.</span>`;
        }

        return `
          <tr style="${isEst ? 'background: rgba(239, 68, 68, 0.05);' : ''}">
            <td style="padding: 10px; white-space: nowrap; font-family: monospace;">${formatDate(it.data_movimento)}</td>
            <td style="padding: 10px; text-align: center;">${empBadge}</td>
            <td style="padding: 10px; font-weight: 600; color: #38bdf8;">${escapeHtml(it.natureza_pai_desc || it.natureza_pai_cod)}</td>
            <td style="padding: 10px;">
              <div style="font-weight: 600;">${escapeHtml(it.natureza_cod)}</div>
              <div style="font-size: 0.76rem; color: var(--text-muted);">${escapeHtml(it.natureza_desc)}</div>
            </td>
            <td style="padding: 10px;">
              <div style="font-weight: 600; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(it.fornecedor_nome)}">
                ${escapeHtml(it.fornecedor_nome)}
              </div>
              ${it.fornecedor_cod ? `<span style="font-size: 0.74rem; color: var(--text-muted); font-family: monospace;">Cód: ${escapeHtml(it.fornecedor_cod)}</span>` : ''}
            </td>
            <td style="padding: 10px; font-family: monospace; font-size: 0.8rem;">${escapeHtml(it.numero_documento || it.numero_titulo || '-')}</td>
            <td style="padding: 10px; font-size: 0.8rem; color: var(--text-muted); max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(it.historico)}">
              ${escapeHtml(it.historico || '-')}
            </td>
            <td style="padding: 10px; text-align: center;">${tipoBadge}</td>
            <td style="padding: 10px; text-align: right; ${valClass}; font-family: monospace; font-size: 0.9rem;">
              ${valorFormatado}
            </td>
          </tr>
        `;
      }).join('');

    } catch (err) {
      console.warn('⚠️ [BI Despesas] Erro ao carregar lançamentos:', err.message);
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align: center; padding: 2rem; color: #ef4444;">
            Erro ao carregar dados: ${escapeHtml(err.message)}
          </td>
        </tr>
      `;
    }
  }

  /**
   * 5. Popula Seletor de Naturezas Pai
   */
  async function carregarNaturezasPais() {
    const sel = document.getElementById('biDespesasFiltroNaturezaPai');
    if (!sel) return;

    const token = getAuthToken();
    try {
      const res = await fetch('/api/bi/despesas/naturezas-pais', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.success || !data.pais) return;

      sel.innerHTML = '<option value="TODAS">Todas as Naturezas Pai</option>' +
        data.pais.map(p => `<option value="${escapeHtml(p.codigo)}">${escapeHtml(p.codigo)} - ${escapeHtml(p.descricao)}</option>`).join('');
    } catch (err) {
      console.warn('⚠️ [BI Despesas] Erro ao carregar naturezas pai:', err.message);
    }
  }

  /**
   * 6. Carrega Status da Última Sincronização
   */
  async function carregarStatusSync() {
    const elText = document.getElementById('biDespesasSyncStatusText');
    if (!elText) return;

    const token = getAuthToken();
    try {
      const res = await fetch('/api/bi/despesas/sync-status', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.last_sync_at) {
        const d = new Date(data.last_sync_at);
        const dataFormatada = d.toLocaleString('pt-BR');
        elText.textContent = `Última sincronização: ${dataFormatada} (${(data.total_registros || 0).toLocaleString('pt-BR')} registros)`;
      } else {
        elText.textContent = 'Sem sincronização registrada.';
      }
    } catch {
      elText.textContent = 'Status indisponível.';
    }
  }

  /**
   * 7. Dispara Sincronização com o Protheus
   */
  async function dispararSincronizacao(modo = 'incremental') {
    const btnSync = document.getElementById('btnBiDespesasSync');
    const elText = document.getElementById('biDespesasSyncStatusText');
    if (btnSync) btnSync.disabled = true;

    if (elText) {
      elText.innerHTML = '<span style="display: inline-block; animation: spin 1s linear infinite;">⏳</span> Sincronizando com Protheus...';
    }
    showToast(`Iniciando sincronização ${modo === 'full' ? 'completa' : 'incremental'} de despesas...`, 'info');

    const token = getAuthToken();
    try {
      const res = await fetch('/api/bi/despesas/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ modo, retroativoDias: 10 })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Erro ao sincronizar.');
      }

      showToast(`Sincronização concluída! ${data.totalExtraidos} registros processados em ${(data.duracaoMs / 1000).toFixed(1)}s.`, 'success');
      await carregarStatusSync();
      await carregarNaturezasPais();
      await carregarDadosCompletos();

    } catch (err) {
      console.error('❌ [BI Despesas] Erro na sincronização:', err);
      showToast(err.message, 'error');
      if (elText) elText.textContent = 'Falha na sincronização.';
    } finally {
      if (btnSync) btnSync.disabled = false;
    }
  }

  /**
   * 8. Exportação para CSV da Tabela Filtrada
   */
  async function exportarCsvLancamentos() {
    showToast('Gerando exportação CSV...', 'info');
    const token = getAuthToken();
    try {
      // Puxa todos os registros filtrados (até 5000 itens)
      const qs = buildQueryString({ page: 1, limit: 5000 });
      const res = await fetch(`/api/bi/despesas/lancamentos${qs}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (!res.ok) throw new Error('Falha ao exportar.');
      const data = await res.json();
      const items = data.items || [];

      if (items.length === 0) {
        showToast('Nenhum registro para exportar.', 'warning');
        return;
      }

      function sanitizeCsvCell(val) {
        let s = String(val || '').trim();
        if (/^[=+@\-]/.test(s)) {
          s = "'" + s;
        }
        return `"${s.replace(/"/g, '""')}"`;
      }

      const headers = ['Data', 'Empresa', 'Natureza Pai Cod', 'Natureza Pai', 'Natureza Cod', 'Natureza Descricao', 'Fornecedor Cod', 'Fornecedor Nome', 'Documento', 'Historico', 'Tipo', 'Estorno', 'Valor Bruto', 'Valor Liquido'];
      const rows = items.map(it => [
        `"${formatDate(it.data_movimento)}"`,
        sanitizeCsvCell(it.empresa_sigla),
        sanitizeCsvCell(it.natureza_pai_cod),
        sanitizeCsvCell(it.natureza_pai_desc),
        sanitizeCsvCell(it.natureza_cod),
        sanitizeCsvCell(it.natureza_desc),
        sanitizeCsvCell(it.fornecedor_cod),
        sanitizeCsvCell(it.fornecedor_nome),
        sanitizeCsvCell(it.numero_documento || it.numero_titulo),
        sanitizeCsvCell(it.historico),
        sanitizeCsvCell(it.tipo_doc),
        `"${it.is_estorno ? 'SIM' : 'NAO'}"`,
        `"${Number(it.valor_bruto || 0).toFixed(2).replace('.', ',')}"`,
        `"${Number(it.valor_liquido || 0).toFixed(2).replace('.', ',')}"`
      ]);

      const csvContent = '\uFEFF' + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `despesas_protheus_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast('Arquivo CSV baixado com sucesso!', 'success');

    } catch (err) {
      showToast('Erro ao exportar CSV: ' + err.message, 'error');
    }
  }

  // Exportação global para app.js
  window.initBiDespesasView = initBiDespesasView;
  window.refreshBiDespesas = carregarDadosCompletos;

})();
