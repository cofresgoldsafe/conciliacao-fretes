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
   * Inicializa o módulo de BI Executivo quando a aba for aberta
   */
  function initBITab() {
    setupBIEvents();
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
      });
    }

    const btnFullscreen = document.getElementById('btnBiFullscreen');
    if (btnFullscreen) {
      btnFullscreen.addEventListener('click', toggleBIFullscreen);
    }
  }

  /**
   * Carrega o Dashboard do Metabase via API segura
   * @param {boolean} forceRefresh Força recarregamento da URL assinada
   */
  async function loadBIDashboard(forceRefresh = false) {
    if (isBiLoading) return;

    let token = null;
    try {
      const rawSession = localStorage.getItem('conciliacao_fretes_session');
      if (rawSession) {
        const sess = JSON.parse(rawSession);
        if (sess && sess.token) token = sess.token;
      }
      if (!token) token = localStorage.getItem('gsi_auth_token');
    } catch {}

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

      // Detecta preferência de tema atual do portal
      const currentTheme = document.body.classList.contains('light-theme') ? 'light' : 'night';

      const res = await fetch(`/api/bi/dashboard-executivo?theme=${currentTheme}&_t=${Date.now()}`, {
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

})();
