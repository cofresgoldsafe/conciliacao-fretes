/**
 * public/js/bi.js
 * Módulo de BI Executivo Embutido (Metabase Embedded Analytics)
 * Plataforma de Apoio GSI (Gemini-Cli)
 */

(function () {
  'use strict';

  let biInitialized = false;
  let isBiLoading = false;
  let currentEmbedUrl = null;

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
    if (!currentEmbedUrl) {
      loadBIDashboard(false);
    }
  }

  /**
   * Configura os ouvintes de eventos da barra de ferramentas do BI
   */
  function setupBIEvents() {
    if (biInitialized) return;
    biInitialized = true;

    const btnRefresh = document.getElementById('btnBiRefresh');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => {
        loadBIDashboard(true);
        loadBITelemetry();
      });
    }

    const btnSyncFat = document.getElementById('btnBiSyncFaturamento');
    if (btnSyncFat) {
      btnSyncFat.addEventListener('click', syncFaturamentoProtheus);
    }

    const btnSyncInd = document.getElementById('btnBiSyncIndices');
    if (btnSyncInd) {
      btnSyncInd.addEventListener('click', syncIndicesProtheus);
    }

    const btnFullscreen = document.getElementById('btnBiFullscreen');
    if (btnFullscreen) {
      btnFullscreen.addEventListener('click', toggleBIFullscreen);
    }

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
        loadBIDashboard(true);
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
      '📥 Sincronização de Faturamento para o Metabase:\n\n' +
      'Deseja extrair as notas fiscais de vendas do Protheus das empresas MP (14), GSI (15) e OACO (16) ' +
      'e atualizar o banco Supabase para alimentar os gráficos de vendas por mês, grupo e vendedor?\n\n' +
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
      alert(`✅ Faturamento sincronizado com sucesso!\n\nTotal de itens faturados: ${count}\nDuração: ${(duracao / 1000).toFixed(1)}s\n\nO painel analítico do Metabase agora possui dados atualizados.`);
      
      await loadBITelemetry();
      loadBIDashboard(true);
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
      '📊 Sincronização de Índices para o Metabase:\n\n' +
      'Deseja extrair disponibilidades bancárias (SE8), contas a receber (SE1), contas a pagar (SE2) ' +
      'e estoque físico (SB2) das 3 empresas e registrar um novo snapshot no Supabase?\n\n' +
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

      alert('✅ Índices de liquidez sincronizados com sucesso!\n\nSnapshot diário atualizado no Supabase.');
      
      await loadBITelemetry();
      loadBIDashboard(true);
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
   * Carrega o Dashboard do Metabase via API segura
   * @param {boolean} forceRefresh Força recarregamento da URL assinada
   */
  async function loadBIDashboard(forceRefresh = false) {
    if (isBiLoading) return;

    const token = getAuthToken();

    const biIframeContainer = document.getElementById('biIframeContainer');
    const biLoadingSpinner = document.getElementById('biLoadingSpinner');
    const biStatusContainer = document.getElementById('biStatusContainer');
    const biLastUpdated = document.getElementById('biLastUpdated');
    const btnRefresh = document.getElementById('btnBiRefresh');

    if (!token) {
      renderBIError('Sessão expirada. Por favor, faça login novamente no portal.');
      return;
    }

    try {
      isBiLoading = true;
      if (biLoadingSpinner) biLoadingSpinner.classList.remove('hidden');
      if (biStatusContainer) biStatusContainer.classList.add('hidden');
      if (btnRefresh) btnRefresh.disabled = true;

      // Detecta preferência de tema atual do portal e ID do Dashboard
      const currentTheme = document.body.classList.contains('light-theme') ? 'light' : 'night';
      const activeDashId = getActiveDashboardId();
      const dashQuery = activeDashId ? `&dashboardId=${encodeURIComponent(activeDashId)}` : '';

      const res = await fetch(`/api/bi/dashboard-executivo?theme=${currentTheme}${dashQuery}&_t=${Date.now()}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await res.json();

      if (res.status === 403) {
        renderBIError('Acesso negado: Este painel é restrito exclusivamente à diretoria e administração.');
        return;
      }

      if (!res.ok && !data.setupGuide) {
        throw new Error(data.message || 'Falha ao carregar painel de BI.');
      }

      // Caso 1: Metabase ainda não configurado (Instruções guiadas)
      if (!data.configured) {
        renderBISetupGuide(data);
        return;
      }

      // Caso 2: URL Assinada recebida com sucesso
      if (data.success && data.embedUrl) {
        currentEmbedUrl = data.embedUrl;
        renderBIIframe(data.embedUrl);
        const elDashId = document.getElementById('biTelDashboardId');
        if (elDashId && data.dashboardId) {
          elDashId.textContent = data.dashboardId;
        }
        if (biLastUpdated) {
          const now = new Date();
          biLastUpdated.textContent = `Atualizado às ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
        }
      } else {
        renderBIError(data.message || 'Erro inesperado ao gerar incorporação.');
      }
    } catch (err) {
      console.error('❌ [BI Frontend] Erro ao carregar dashboard:', err);
      renderBIError(`Não foi possível conectar ao painel executivo: ${err.message}`);
    } finally {
      isBiLoading = false;
      if (btnRefresh) btnRefresh.disabled = false;
    }
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
   * Renderiza o iframe seguro do Metabase
   */
  function renderBIIframe(embedUrl) {
    const biIframeContainer = document.getElementById('biIframeContainer');
    const biLoadingSpinner = document.getElementById('biLoadingSpinner');
    const biStatusContainer = document.getElementById('biStatusContainer');

    if (!biIframeContainer) return;

    biStatusContainer.classList.add('hidden');
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
      btnRetry.addEventListener('click', () => loadBIDashboard(true));
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
  window.toggleBIFullscreen = toggleBIFullscreen;
  window.getActiveBIDashboardId = getActiveDashboardId;
  window.setActiveBIDashboardId = setActiveDashboardId;

})();
