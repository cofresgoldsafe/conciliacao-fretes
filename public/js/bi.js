/**
 * public/js/bi.js
 * Módulo de BI Executivo Nativo (HTML5 Canvas + Chart.js) & Telemetria
 * Plataforma de Apoio GSI (Gemini-Cli)
 */

(function () {
  'use strict';

  let biInitialized = false;
  let isBiLoading = false;
  let currentEmbedUrl = null;
  let executiveChartInstance = null;
  let currentChartType = 'line';
  let currentHistoryData = [];
  let currentSelectedMetric = 'liquidez';

  /**
   * Obtém token de autorização da sessão
   */
  function getAuthToken() {
    try {
      const rawSession = localStorage.getItem('conciliacao_fretes_session');
      if (rawSession) {
        const sess = JSON.parse(rawSession);
        if (sess && sess.token) return sess.token;
      }
      return localStorage.getItem('gsi_auth_token') || null;
    } catch {
      return null;
    }
  }

  /**
   * Inicializa o módulo de BI Executivo quando a aba for aberta
   */
  function initBITab() {
    setupBIEvents();
    loadBITelemetry();
    loadBIExecutiveChart(false);
  }

  /**
   * Configura os ouvintes de eventos da barra de ferramentas do BI e controles gráficos
   */
  function setupBIEvents() {
    if (biInitialized) return;
    biInitialized = true;

    // 1. Botão de Atualizar
    const btnRefresh = document.getElementById('btnBiRefresh');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => {
        loadBIExecutiveChart(true);
        loadBITelemetry();
      });
    }

    // 2. Sincronização de Faturamento
    const btnSyncFat = document.getElementById('btnBiSyncFaturamento');
    if (btnSyncFat) {
      btnSyncFat.addEventListener('click', syncFaturamentoProtheus);
    }

    // 3. Sincronização de Índices
    const btnSyncInd = document.getElementById('btnBiSyncIndices');
    if (btnSyncInd) {
      btnSyncInd.addEventListener('click', syncIndicesProtheus);
    }

    // 4. Modo Tela Cheia
    const btnFullscreen = document.getElementById('btnBiFullscreen');
    if (btnFullscreen) {
      btnFullscreen.addEventListener('click', toggleBIFullscreen);
    }

    // 5. Seletor de Métrica
    const metricSelect = document.getElementById('biMetricSelect');
    if (metricSelect) {
      metricSelect.addEventListener('change', (e) => {
        currentSelectedMetric = e.target.value;
        if (currentHistoryData && currentHistoryData.length > 0) {
          renderExecutiveChart(currentHistoryData);
        }
      });
    }

    // 6. Seletor de Empresa
    const empresaSelect = document.getElementById('biEmpresaSelect');
    if (empresaSelect) {
      empresaSelect.addEventListener('change', () => {
        loadBIExecutiveChart(true);
      });
    }

    // 7. Seletor de Período
    const periodoSelect = document.getElementById('biPeriodoSelect');
    if (periodoSelect) {
      periodoSelect.addEventListener('change', () => {
        loadBIExecutiveChart(true);
      });
    }

    // 8. Botões de Alternância de Tipo de Gráfico (Linha vs Coluna)
    const btnTypeLine = document.getElementById('btnBiTypeLine');
    const btnTypeBar = document.getElementById('btnBiTypeBar');

    if (btnTypeLine && btnTypeBar) {
      btnTypeLine.addEventListener('click', () => {
        if (currentChartType === 'line') return;
        currentChartType = 'line';
        btnTypeLine.classList.add('active');
        btnTypeLine.style.background = 'var(--primary-color, #3b82f6)';
        btnTypeLine.style.color = '#ffffff';

        btnTypeBar.classList.remove('active');
        btnTypeBar.style.background = 'transparent';
        btnTypeBar.style.color = 'var(--text-muted, #94a3b8)';

        if (currentHistoryData && currentHistoryData.length > 0) {
          renderExecutiveChart(currentHistoryData);
        }
      });

      btnTypeBar.addEventListener('click', () => {
        if (currentChartType === 'bar') return;
        currentChartType = 'bar';
        btnTypeBar.classList.add('active');
        btnTypeBar.style.background = 'var(--primary-color, #3b82f6)';
        btnTypeBar.style.color = '#ffffff';

        btnTypeLine.classList.remove('active');
        btnTypeLine.style.background = 'transparent';
        btnTypeLine.style.color = 'var(--text-muted, #94a3b8)';

        if (currentHistoryData && currentHistoryData.length > 0) {
          renderExecutiveChart(currentHistoryData);
        }
      });
    }

    // 9. Alteração de ID de Dashboard (Preservado para compatibilidade e testes)
    const btnChangeDash = document.getElementById('btnBiChangeDashboardId');
    if (btnChangeDash) {
      btnChangeDash.addEventListener('click', () => {
        const current = getActiveDashboardId() || document.getElementById('biTelDashboardId')?.textContent?.trim() || '1';
        const novoId = prompt(
          '🎯 Alterar / Testar ID do Dashboard Metabase:\n\n' +
          'Informe o número do Dashboard (conforme aparece na URL do Metabase, ex: https://bi-gsi.onrender.com/dashboard/2):\n\n' +
          '• Digite o número do Dashboard desejado (ex: 1, 2, 3...)\n' +
          '• Ou deixe em branco para restaurar o padrão configurado nas variáveis de ambiente.',
          current
        );
        if (novoId === null) return;
        const parsed = parseInt(novoId.trim(), 10);
        if (isNaN(parsed) || parsed <= 0) {
          setActiveDashboardId(null);
          alert('Padrão do servidor restaurado.');
        } else {
          setActiveDashboardId(parsed);
          alert(`ID do Dashboard definido para ${parsed}. Recarregando painel...`);
        }
        loadBIExecutiveChart(true);
      });
    }
  }

  /**
   * Obtém o ID do Dashboard ativo (localStorage ou padrão do servidor)
   */
  function getActiveDashboardId() {
    try {
      const saved = localStorage.getItem('metabase_active_dashboard_id');
      if (saved && !isNaN(parseInt(saved, 10))) {
        return parseInt(saved, 10);
      }
    } catch {}
    return null;
  }

  /**
   * Define o ID do Dashboard ativo no localStorage
   */
  function setActiveDashboardId(id) {
    try {
      if (id && !isNaN(parseInt(id, 10))) {
        localStorage.setItem('metabase_active_dashboard_id', String(id));
      } else {
        localStorage.removeItem('metabase_active_dashboard_id');
      }
    } catch {}
  }

  /**
   * Formata data YYYY-MM-DD para DD/MM/AAAA
   */
  function formatarDataBR(dataStr) {
    if (!dataStr) return '';
    const clean = String(dataStr).split('T')[0];
    const parts = clean.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dataStr;
  }

  /**
   * Formata valor numérico para Moeda Brasileira (R$)
   */
  function formatarMoeda(val) {
    const num = Number(val) || 0;
    return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  /**
   * Carrega os dados da série temporal e renderiza o gráfico executivo nativo
   * @param {boolean} forceRefresh Força recarregamento da API
   */
  async function loadBIExecutiveChart(forceRefresh = false) {
    if (isBiLoading) return;

    const token = getAuthToken();
    const btnRefresh = document.getElementById('btnBiRefresh');
    const chartLoading = document.getElementById('biChartLoading');
    const chartEmpty = document.getElementById('biChartEmpty');
    const chartWrapper = document.getElementById('biChartCanvasWrapper');
    const lastUpdated = document.getElementById('biLastUpdated');

    if (!token) {
      renderBIError('Sessão expirada. Por favor, faça login novamente no portal.');
      return;
    }

    try {
      isBiLoading = true;
      if (btnRefresh) btnRefresh.disabled = true;
      if (chartLoading) chartLoading.classList.remove('hidden');

      const empresaSelect = document.getElementById('biEmpresaSelect');
      const periodoSelect = document.getElementById('biPeriodoSelect');

      const emp = empresaSelect ? empresaSelect.value : 'ALL';
      const dias = periodoSelect ? periodoSelect.value : '30';

      const res = await fetch(`/api/bi/indices/historico?empresa=${encodeURIComponent(emp)}&dias=${encodeURIComponent(dias)}&limit=200&_t=${Date.now()}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (res.status === 403) {
        renderBIError('Acesso negado: Este painel é restrito exclusivamente à diretoria e administração.');
        return;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Falha ao consultar histórico dos índices.');
      }

      const data = await res.json();
      currentHistoryData = Array.isArray(data.historico) ? data.historico : [];

      if (lastUpdated) {
        const now = new Date();
        lastUpdated.textContent = `Atualizado às ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
      }

      // Atualiza Cards de Resumo (KPIs) com o último fechamento cronológico
      atualizarCardsResumo(currentHistoryData);

      if (currentHistoryData.length === 0) {
        if (chartEmpty) chartEmpty.classList.remove('hidden');
        if (chartWrapper) chartWrapper.classList.add('hidden');
        if (executiveChartInstance) {
          executiveChartInstance.destroy();
          executiveChartInstance = null;
        }
      } else {
        if (chartEmpty) chartEmpty.classList.add('hidden');
        if (chartWrapper) chartWrapper.classList.remove('hidden');
        renderExecutiveChart(currentHistoryData);
      }

    } catch (err) {
      console.error('❌ [BI Gráficos] Erro ao carregar histórico:', err);
      renderBIError(`Não foi possível carregar os gráficos executivos: ${err.message}`);
    } finally {
      isBiLoading = false;
      if (chartLoading) chartLoading.classList.add('hidden');
      if (btnRefresh) btnRefresh.disabled = false;
    }
  }

  /**
   * Atualiza os 4 mini cards de resumo com base no snapshot mais recente
   */
  function atualizarCardsResumo(historyData) {
    const elLc = document.getElementById('biKpiLc');
    const elLcStatus = document.getElementById('biKpiLcStatus');
    const elLs = document.getElementById('biKpiLs');
    const elLsStatus = document.getElementById('biKpiLsStatus');
    const elLi = document.getElementById('biKpiLi');
    const elLiStatus = document.getElementById('biKpiLiStatus');
    const elData = document.getElementById('biKpiData');
    const elTotal = document.getElementById('biKpiTotalPontos');

    if (!historyData || historyData.length === 0) {
      if (elLc) elLc.textContent = '---';
      if (elLs) elLs.textContent = '---';
      if (elLi) elLi.textContent = '---';
      if (elData) elData.textContent = '---';
      if (elTotal) elTotal.textContent = '0 snapshots na série temporal';
      return;
    }

    const latest = historyData[historyData.length - 1];
    const lc = Number(latest.liquidez_corrente || 0);
    const ls = Number(latest.liquidez_seca || 0);
    const li = Number(latest.liquidez_imediata || 0);

    if (elLc) {
      elLc.textContent = lc.toFixed(2);
      elLc.style.color = lc >= 1.5 ? '#10b981' : (lc >= 1.0 ? '#f59e0b' : '#ef4444');
    }
    if (elLcStatus) {
      elLcStatus.textContent = lc >= 1.5 ? '✅ Saudável (≥ 1,50)' : (lc >= 1.0 ? '⚠️ Regular (1,0 - 1,5)' : '🚨 Crítico (< 1,00)');
      elLcStatus.style.color = lc >= 1.5 ? '#10b981' : (lc >= 1.0 ? '#f59e0b' : '#ef4444');
    }

    if (elLs) {
      elLs.textContent = ls.toFixed(2);
      elLs.style.color = ls >= 1.0 ? '#10b981' : (ls >= 0.8 ? '#f59e0b' : '#ef4444');
    }
    if (elLsStatus) {
      elLsStatus.textContent = ls >= 1.0 ? '✅ Excelente (≥ 1,00)' : '⚠️ Atenção (< 1,00)';
      elLsStatus.style.color = ls >= 1.0 ? '#10b981' : '#f59e0b';
    }

    if (elLi) {
      elLi.textContent = li.toFixed(2);
      elLi.style.color = li >= 0.2 ? '#10b981' : '#ef4444';
    }
    if (elLiStatus) {
      elLiStatus.textContent = li >= 0.2 ? '✅ Confortável (≥ 0,20)' : '⚠️ Alerta (< 0,20)';
      elLiStatus.style.color = li >= 0.2 ? '#10b981' : '#ef4444';
    }

    if (elData) {
      elData.textContent = formatarDataBR(latest.data_registro);
    }
    if (elTotal) {
      elTotal.textContent = `${historyData.length} snapshot(s) cronológico(s)`;
    }
  }

  /**
   * Renderiza o gráfico Canvas via Chart.js
   * @param {Array} historyData Lista de snapshots históricos
   */
  function renderExecutiveChart(historyData) {
    if (typeof window.Chart === 'undefined') {
      console.warn('⚠️ [BI Chart] Biblioteca Chart.js ainda não carregada no escopo global.');
      return;
    }

    const canvas = document.getElementById('biExecutiveChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (executiveChartInstance) {
      executiveChartInstance.destroy();
      executiveChartInstance = null;
    }

    const isLight = document.body.classList.contains('light-theme') || 
      document.documentElement.classList.contains('light-theme') ||
      Boolean(document.getElementById('tab-bi-metabase')?.closest('.tab-theme-light')) ||
      Boolean(document.getElementById('tab-bi-metabase')?.classList.contains('tab-theme-light'));
    const gridColor = isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.08)';
    const textColor = isLight ? '#475569' : '#94a3b8';
    const tooltipBg = isLight ? '#ffffff' : '#0f172a';
    const tooltipText = isLight ? '#0f172a' : '#f8fafc';
    const tooltipBorder = isLight ? '#cbd5e1' : '#334155';

    const isBar = currentChartType === 'bar';
    const labels = historyData.map(r => formatarDataBR(r.data_registro));

    let datasets = [];
    let isCurrency = false;

    if (currentSelectedMetric === 'liquidez') {
      isCurrency = false;
      datasets = [
        {
          label: 'Liquidez Corrente (LC)',
          data: historyData.map(r => Number(r.liquidez_corrente || 0)),
          borderColor: '#3b82f6',
          backgroundColor: isBar ? 'rgba(59, 130, 246, 0.75)' : 'rgba(59, 130, 246, 0.12)',
          fill: !isBar,
          tension: 0.35,
          borderWidth: 2.5,
          pointRadius: isBar ? 0 : 4,
          pointHoverRadius: 7,
          borderRadius: 5
        },
        {
          label: 'Liquidez Seca (LS)',
          data: historyData.map(r => Number(r.liquidez_seca || 0)),
          borderColor: '#f59e0b',
          backgroundColor: isBar ? 'rgba(245, 158, 11, 0.75)' : 'rgba(245, 158, 11, 0.12)',
          fill: !isBar,
          tension: 0.35,
          borderWidth: 2.5,
          pointRadius: isBar ? 0 : 4,
          pointHoverRadius: 7,
          borderRadius: 5
        },
        {
          label: 'Liquidez Imediata (LI)',
          data: historyData.map(r => Number(r.liquidez_imediata || 0)),
          borderColor: '#10b981',
          backgroundColor: isBar ? 'rgba(16, 185, 129, 0.75)' : 'rgba(16, 185, 129, 0.12)',
          fill: !isBar,
          tension: 0.35,
          borderWidth: 2.5,
          pointRadius: isBar ? 0 : 4,
          pointHoverRadius: 7,
          borderRadius: 5
        }
      ];
    } else if (currentSelectedMetric === 'ativo_passivo') {
      isCurrency = true;
      datasets = [
        {
          label: 'Ativo Circulante (R$)',
          data: historyData.map(r => Number(r.ativo_circulante || 0)),
          borderColor: '#10b981',
          backgroundColor: isBar ? 'rgba(16, 185, 129, 0.75)' : 'rgba(16, 185, 129, 0.15)',
          fill: !isBar,
          tension: 0.35,
          borderWidth: 2.5,
          pointRadius: isBar ? 0 : 4,
          pointHoverRadius: 7,
          borderRadius: 5
        },
        {
          label: 'Passivo Circulante (R$)',
          data: historyData.map(r => Number(r.passivo_circulante || 0)),
          borderColor: '#ef4444',
          backgroundColor: isBar ? 'rgba(239, 68, 68, 0.75)' : 'rgba(239, 68, 68, 0.15)',
          fill: !isBar,
          tension: 0.35,
          borderWidth: 2.5,
          pointRadius: isBar ? 0 : 4,
          pointHoverRadius: 7,
          borderRadius: 5
        }
      ];
    } else if (currentSelectedMetric === 'disponibilidade_pagar') {
      isCurrency = true;
      datasets = [
        {
          label: 'Disponibilidades Bancárias (SE8)',
          data: historyData.map(r => Number(r.disponibilidades || 0)),
          borderColor: '#06b6d4',
          backgroundColor: isBar ? 'rgba(6, 182, 212, 0.75)' : 'rgba(6, 182, 212, 0.15)',
          fill: !isBar,
          tension: 0.35,
          borderWidth: 2.5,
          pointRadius: isBar ? 0 : 4,
          pointHoverRadius: 7,
          borderRadius: 5
        },
        {
          label: 'Contas a Pagar Total (SE2)',
          data: historyData.map(r => Number(r.pagar_total || 0)),
          borderColor: '#f87171',
          backgroundColor: isBar ? 'rgba(248, 113, 113, 0.75)' : 'rgba(248, 113, 113, 0.15)',
          fill: !isBar,
          tension: 0.35,
          borderWidth: 2.5,
          pointRadius: isBar ? 0 : 4,
          pointHoverRadius: 7,
          borderRadius: 5
        }
      ];
    } else if (currentSelectedMetric === 'comparativo_lc') {
      isCurrency = false;
      datasets = [
        {
          label: 'Liquidez Corrente (LC)',
          data: historyData.map(r => Number(r.liquidez_corrente || 0)),
          borderColor: '#8b5cf6',
          backgroundColor: isBar ? 'rgba(139, 92, 246, 0.75)' : 'rgba(139, 92, 246, 0.15)',
          fill: !isBar,
          tension: 0.35,
          borderWidth: 2.5,
          pointRadius: isBar ? 0 : 4,
          pointHoverRadius: 7,
          borderRadius: 5
        }
      ];
    }

    executiveChartInstance = new window.Chart(ctx, {
      type: currentChartType,
      data: {
        labels: labels,
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 650,
          easing: 'easeOutQuart'
        },
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: textColor,
              font: {
                size: 12,
                weight: '600'
              },
              usePointStyle: true,
              padding: 16
            }
          },
          tooltip: {
            backgroundColor: tooltipBg,
            titleColor: tooltipText,
            bodyColor: tooltipText,
            borderColor: tooltipBorder,
            borderWidth: 1,
            padding: 10,
            boxPadding: 4,
            usePointStyle: true,
            callbacks: {
              label: function (context) {
                const label = context.dataset.label || '';
                const raw = context.raw || 0;
                if (isCurrency) {
                  return `${label}: ${formatarMoeda(raw)}`;
                } else {
                  return `${label}: ${raw.toFixed(4)}`;
                }
              }
            }
          }
        },
        scales: {
          x: {
            grid: {
              color: gridColor,
              drawBorder: false
            },
            ticks: {
              color: textColor,
              font: {
                size: 11
              },
              maxRotation: 45,
              minRotation: 0
            }
          },
          y: {
            grid: {
              color: gridColor,
              drawBorder: false
            },
            ticks: {
              color: textColor,
              font: {
                size: 11
              },
              callback: function (val) {
                if (isCurrency) {
                  if (val >= 1000000) return `R$ ${(val / 1000000).toFixed(1)}M`;
                  if (val >= 1000) return `R$ ${(val / 1000).toFixed(0)}k`;
                  return `R$ ${val}`;
                }
                return val;
              }
            }
          }
        }
      }
    });
  }

  /**
   * Sincroniza faturamento consolidado do Protheus para o Supabase / Metabase
   */
  async function syncFaturamentoProtheus() {
    const btn = document.getElementById('btnBiSyncFaturamento');
    const msgEl = document.getElementById('biTelemetryMsg');
    const token = getAuthToken();

    if (!token) {
      alert('Sessão expirada. Por favor, faça login novamente.');
      return;
    }

    const conf = confirm(
      '📥 Sincronização de Faturamento:\n\n' +
      'Deseja extrair as notas fiscais de vendas do Protheus das empresas MP (14), GSI (15) e OACO (16) ' +
      'e atualizar o banco analítico?\n\n' +
      'Clique em OK para iniciar.'
    );
    if (!conf) return;

    const originalText = btn ? btn.innerHTML : '';
    try {
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ Sincronizando...';
      }
      if (msgEl) msgEl.textContent = '⏳ Sincronizando faturamento consolidado com o Protheus...';

      const res = await fetch('/api/bi/sync-faturamento', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Falha na sincronização de faturamento.');
      }

      const count = data.data?.count || data.count || 0;
      const duracao = data.data?.duracao_ms || data.duracao_ms || 0;
      alert(`✅ Faturamento sincronizado com sucesso!\n\nTotal de itens faturados: ${count}\nDuração: ${(duracao / 1000).toFixed(1)}s`);
      
      await loadBITelemetry();
      loadBIExecutiveChart(true);
    } catch (err) {
      console.error('❌ [BI] Erro ao sincronizar faturamento:', err);
      alert(`❌ Erro ao sincronizar faturamento: ${err.message}`);
      if (msgEl) msgEl.textContent = `❌ Erro: ${err.message}`;
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    }
  }

  /**
   * Sincroniza índices financeiros e saldos do Protheus para o Supabase / Metabase
   */
  async function syncIndicesProtheus() {
    const btn = document.getElementById('btnBiSyncIndices');
    const msgEl = document.getElementById('biTelemetryMsg');
    const token = getAuthToken();

    if (!token) {
      alert('Sessão expirada. Por favor, faça login novamente.');
      return;
    }

    const conf = confirm(
      '📊 Sincronização de Índices Financeiros:\n\n' +
      'Deseja extrair disponibilidades bancárias (SE8), contas a receber (SE1), contas a pagar (SE2) ' +
      'e estoque físico (SB2) das 3 empresas e registrar um novo snapshot na série histórica?\n\n' +
      'Clique em OK para iniciar.'
    );
    if (!conf) return;

    const originalText = btn ? btn.innerHTML : '';
    try {
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ Sincronizando...';
      }
      if (msgEl) msgEl.textContent = '⏳ Sincronizando índices e contas com o Protheus...';

      const res = await fetch('/api/bi/indices/sync', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Falha na sincronização de índices.');
      }

      alert('✅ Índices de liquidez sincronizados com sucesso!\n\nNovo snapshot diário registrado na série temporal.');
      
      await loadBITelemetry();
      loadBIExecutiveChart(true);
    } catch (err) {
      console.error('❌ [BI] Erro ao sincronizar índices:', err);
      alert(`❌ Erro ao sincronizar índices: ${err.message}`);
      if (msgEl) msgEl.textContent = `❌ Erro: ${err.message}`;
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    }
  }

  /**
   * Carrega telemetria e contadores das tabelas analíticas no cabeçalho
   */
  async function loadBITelemetry() {
    const token = getAuthToken();
    if (!token) return;

    const elFat = document.getElementById('biTelFaturamento');
    const elInd = document.getElementById('biTelIndices');
    const btnOpen = document.getElementById('btnBiOpenExternal');

    try {
      // 1. Estatísticas de faturamento
      const resFat = await fetch(`/api/bi/faturamento-stats?_t=${Date.now()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (resFat.ok) {
        const dataFat = await resFat.json();
        if (elFat) {
          const totalItens = dataFat.stats?.totalItens || 0;
          const totalValor = dataFat.stats?.totalValor || 0;
          const valorFmt = totalValor ? ` (R$ ${Number(totalValor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : '';
          elFat.innerHTML = totalItens > 0 
            ? `<span style="color: #10b981; font-weight: 600;">${totalItens} itens</span>${valorFmt}`
            : '<span style="color: #f59e0b; font-weight: 600;">0 itens (Clique em Sync Faturamento)</span>';
        }
      }

      // 2. Estatísticas de histórico de índices
      const resInd = await fetch(`/api/bi/indices/historico?limit=30&_t=${Date.now()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (resInd.ok) {
        const dataInd = await resInd.json();
        if (elInd) {
          const hist = Array.isArray(dataInd.historico) ? dataInd.historico : [];
          elInd.innerHTML = hist.length > 0
            ? `<span style="color: #10b981; font-weight: 600;">${hist.length} snapshots diários</span>`
            : '<span style="color: #f59e0b; font-weight: 600;">0 snapshots (Clique em Sync Índices)</span>';
        }
      }

      // 3. Status e URL do Metabase
      const resStat = await fetch(`/api/bi/status?_t=${Date.now()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (resStat.ok) {
        const dataStat = await resStat.json();
        if (btnOpen && dataStat.siteUrl) {
          btnOpen.href = dataStat.siteUrl;
        }
      }
    } catch (e) {
      console.warn('⚠️ [BI Telemetria] Aviso ao consultar telemetria:', e.message);
    }
  }

  /**
   * Alias de compatibilidade com o carregador do Metabase
   */
  async function loadBIDashboard(forceRefresh = false) {
    return loadBIExecutiveChart(forceRefresh);
  }

  /**
   * Função utilitária de sanitização HTML contra DOM XSS
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
   * Renderiza o iframe seguro do Metabase (preservado como fallback)
   */
  function renderBIIframe(embedUrl) {
    const biIframeContainer = document.getElementById('biIframeContainer');
    const biLoadingSpinner = document.getElementById('biLoadingSpinner');
    const biStatusContainer = document.getElementById('biStatusContainer');

    if (!biIframeContainer) return;

    if (biStatusContainer) biStatusContainer.classList.add('hidden');
    biIframeContainer.classList.remove('hidden');

    let iframe = biIframeContainer.querySelector('iframe');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.setAttribute('id', 'biMetabaseIframe');
      iframe.setAttribute('class', 'bi-metabase-iframe');
      iframe.setAttribute('title', 'Painel Executivo de BI Metabase');
      iframe.setAttribute('frameborder', '0');
      iframe.setAttribute('allowtransparency', 'true');
      iframe.setAttribute('allow', 'fullscreen');
      iframe.setAttribute('referrerpolicy', 'no-referrer');
      biIframeContainer.appendChild(iframe);
    }

    iframe.onload = () => {
      if (biLoadingSpinner) biLoadingSpinner.classList.add('hidden');
    };

    iframe.src = embedUrl;
  }

  /**
   * Renderiza o guia amigável de configuração caso o Metabase ainda não esteja configurado
   */
  function renderBISetupGuide(data) {
    const biIframeContainer = document.getElementById('biIframeContainer');
    const biLoadingSpinner = document.getElementById('biLoadingSpinner');
    const biStatusContainer = document.getElementById('biStatusContainer');

    if (biLoadingSpinner) biLoadingSpinner.classList.add('hidden');
    if (biIframeContainer) biIframeContainer.classList.add('hidden');
    if (!biStatusContainer) return;

    biStatusContainer.classList.remove('hidden');
    biStatusContainer.innerHTML = `
      <div class="bi-setup-card card">
        <div class="bi-setup-header">
          <div class="bi-setup-icon">📊</div>
          <div>
            <h3>Painel de BI Executivo (Metabase)</h3>
            <p class="desc">A integração segura está pronta no portal, aguardando apenas as variáveis de conexão com sua instância do Metabase.</p>
          </div>
        </div>

        <div class="bi-setup-status-grid">
          <div class="bi-status-item ${data.setupGuide?.siteUrlSet ? 'status-ok' : 'status-missing'}">
            <span class="status-badge">${data.setupGuide?.siteUrlSet ? '✅ Definida' : '⏳ Pendente'}</span>
            <strong>METABASE_SITE_URL</strong>
            <small>URL base onde o Metabase está hospedado (ex: https://metabase.suaempresa.com)</small>
          </div>
          <div class="bi-status-item ${data.setupGuide?.secretKeySet ? 'status-ok' : 'status-missing'}">
            <span class="status-badge">${data.setupGuide?.secretKeySet ? '✅ Definida' : '⏳ Pendente'}</span>
            <strong>METABASE_SECRET_KEY</strong>
            <small>Chave secreta de 64 caracteres gerada no painel de administração do Metabase</small>
          </div>
          <div class="bi-status-item status-ok">
            <span class="status-badge">ℹ️ ID: ${escapeHtml(data.setupGuide?.dashboardId || 1)}</span>
            <strong>METABASE_EXEC_DASHBOARD_ID</strong>
            <small>ID numérico do Dashboard Executivo que será embutido (Padrão: 1)</small>
          </div>
        </div>

        <div class="bi-setup-instructions">
          <h4>🚀 Como ativar em 3 passos simples:</h4>
          <ol>
            <li><strong>Subir o Metabase:</strong> Conecte sua instância do Metabase ao banco de dados <code>Supabase PostgreSQL</code>.</li>
            <li><strong>Habilitar Incorporação:</strong> No Metabase, vá em <em>Configurações do Administrador &gt; Incorporação &gt; Ativar incorporação em outros aplicativos</em> e gere a <strong>Secret Key</strong>.</li>
            <li><strong>Configurar Variáveis:</strong> Adicione as variáveis <code>METABASE_SITE_URL</code> e <code>METABASE_SECRET_KEY</code> no seu arquivo <code>.env</code> ou painel de ambiente do Render.</li>
          </ol>
        </div>

        <div style="margin-top: 1.25rem; display: flex; gap: 0.75rem; justify-content: flex-end;">
          <button id="btnRetryBiConfig" class="btn btn-primary btn-sm">
            🔄 Testar Conexão Novamente
          </button>
        </div>
      </div>
    `;

    const btnRetry = document.getElementById('btnRetryBiConfig');
    if (btnRetry) {
      btnRetry.addEventListener('click', () => loadBIDashboard(true));
    }
  }

  /**
   * Renderiza mensagem de erro com sanitização rigorosa contra XSS
   */
  function renderBIError(message) {
    const biIframeContainer = document.getElementById('biIframeContainer');
    const biLoadingSpinner = document.getElementById('biLoadingSpinner');
    const biStatusContainer = document.getElementById('biStatusContainer');

    if (biLoadingSpinner) biLoadingSpinner.classList.add('hidden');
    if (biIframeContainer) biIframeContainer.classList.add('hidden');
    if (!biStatusContainer) return;

    biStatusContainer.classList.remove('hidden');
    biStatusContainer.innerHTML = `
      <div class="card bi-error-card" style="border-left: 4px solid #ef4444; padding: 1.5rem;">
        <div style="display: flex; align-items: center; gap: 0.75rem; color: #ef4444; font-weight: 600; font-size: 1.1rem; margin-bottom: 0.5rem;">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          <span>Não foi possível carregar o painel executivo</span>
        </div>
        <p style="color: var(--text-muted, #94a3b8); margin-bottom: 1rem;">${escapeHtml(message)}</p>
        <button id="btnRetryBiError" class="btn btn-outline btn-sm">
          🔄 Tentar Novamente
        </button>
      </div>
    `;

    const btnRetry = document.getElementById('btnRetryBiError');
    if (btnRetry) {
      btnRetry.addEventListener('click', () => loadBIExecutiveChart(true));
    }
  }

  /**
   * Alterna modo Tela Cheia do Container de BI
   */
  function toggleBIFullscreen() {
    const biWrapper = document.getElementById('biWrapper');
    if (!biWrapper) return;

    if (!document.fullscreenElement) {
      if (biWrapper.requestFullscreen) {
        biWrapper.requestFullscreen();
      } else if (biWrapper.webkitRequestFullscreen) {
        biWrapper.webkitRequestFullscreen();
      } else if (biWrapper.msRequestFullscreen) {
        biWrapper.msRequestFullscreen();
      }
      biWrapper.classList.add('bi-fullscreen-active');
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
      biWrapper.classList.remove('bi-fullscreen-active');
    }
  }

  // Exporta globalmente para uso pelo roteador de abas do app.js
  window.initBITab = initBITab;
  window.loadBIDashboard = loadBIDashboard;
  window.loadBIExecutiveChart = loadBIExecutiveChart;
  window.toggleBIFullscreen = toggleBIFullscreen;
  window.getActiveBIDashboardId = getActiveDashboardId;
  window.setActiveBIDashboardId = setActiveDashboardId;

})();
