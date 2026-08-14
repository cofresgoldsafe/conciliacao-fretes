document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements - Auth & Login
  const loginOverlay = document.getElementById('loginOverlay');
  const loginForm = document.getElementById('loginForm');
  const loginUsername = document.getElementById('loginUsername');
  const loginPassword = document.getElementById('loginPassword');
  const loginErrorMsg = document.getElementById('loginErrorMsg');
  const btnLoginSubmit = document.getElementById('btnLoginSubmit');
  const userInfo = document.getElementById('userInfo');
  const btnLogout = document.getElementById('btnLogout');

  // DOM Elements - Tab Navigation
  const navTabBtns = document.querySelectorAll('.nav-tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');

  // DOM Elements - Tab 1 (Upload)
  const transportadoraSelect = document.getElementById('transportadoraSelect');
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const loadingState = document.getElementById('loadingState');
  const loadingMessage = document.getElementById('loadingMessage');

  const faturaSummary = document.getElementById('faturaSummary');
  const sumTransp = document.getElementById('sumTransp');
  const sumCnpj = document.getElementById('sumCnpj');
  const sumFaturaNum = document.getElementById('sumFaturaNum');
  const sumDatas = document.getElementById('sumDatas');
  const sumQtdFretes = document.getElementById('sumQtdFretes');
  const sumValorTotal = document.getElementById('sumValorTotal');
  const batimentoBadge = document.getElementById('batimentoBadge');

  const tableSection = document.getElementById('tableSection');
  const tableSearch = document.getElementById('tableSearch');
  const btnExportCsv = document.getElementById('btnExportCsv');
  const ctesTableBody = document.getElementById('ctesTableBody');
  const footTotalOrcado = document.getElementById('footTotalOrcado');
  const footTotalCobrado = document.getElementById('footTotalCobrado');

  const btnRecalcular = document.getElementById('btnRecalcular');
  const btnLancarProtheus = document.getElementById('btnLancarProtheus');

  // DOM Elements - Tab 3 (Consulta NFe ou Pedido)
  const searchPedVenda = document.getElementById('searchPedVenda');
  const searchNFe = document.getElementById('searchNFe');
  const tagPedVenda = document.getElementById('tagPedVenda');
  const tagNFe = document.getElementById('tagNFe');
  const btnBuscarConsulta = document.getElementById('btnBuscarConsulta');
  const btnLimparConsulta = document.getElementById('btnLimparConsulta');
  const consultaLoading = document.getElementById('consultaLoading');
  const consultaResultsSection = document.getElementById('consultaResultsSection');
  const consultaEmptyState = document.getElementById('consultaEmptyState');
  const consultaTableBody = document.getElementById('consultaTableBody');
  const resultsCountBadge = document.getElementById('resultsCountBadge');
  const searchParamInfo = document.getElementById('searchParamInfo');

  // DOM Elements - Modals
  const resultModal = document.getElementById('resultModal');
  const modalBody = document.getElementById('modalBody');
  const btnCloseModal = document.getElementById('btnCloseModal');
  const btnConfirmModal = document.getElementById('btnConfirmModal');

  const btnOpenHistory = document.getElementById('btnOpenHistory');
  const historyModal = document.getElementById('historyModal');
  const historyModalBody = document.getElementById('historyModalBody');
  const btnCloseHistoryModal = document.getElementById('btnCloseHistoryModal');
  const btnConfirmHistoryModal = document.getElementById('btnConfirmHistoryModal');

  // Application State
  let currentFatura = null;
  let currentItems = [];
  let filterText = '';

  function formatCurrency(val) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
  }

  let currentUser = null;

  // --- AUTHENTICATION & 7-DAY SESSION SYSTEM ---
  function checkAuthSession() {
    const rawSession = localStorage.getItem('conciliacao_fretes_session');
    if (rawSession) {
      try {
        const session = JSON.parse(rawSession);
        if (session && session.expiresAt && session.expiresAt > Date.now()) {
          currentUser = session.user;
          showAuthenticatedUser(session.user);
          return true;
        }
      } catch (e) {
        localStorage.removeItem('conciliacao_fretes_session');
      }
    }
    showLoginOverlay(true);
    return false;
  }

  function showAuthenticatedUser(user) {
    currentUser = user;
    if (loginOverlay) loginOverlay.classList.add('hidden');
    if (userInfo) userInfo.textContent = user.name || user.username;

    // Apply Tab Permissions
    applyUserPermissions(user);
  }

  function applyUserPermissions(user) {
    const mainTabConfig = document.getElementById('mainTabConfig');
    
    // Garante que o usuário Alexandre ou Administrador tenha permissão total mesmo com sessão antiga no localStorage
    let perms = (user && Array.isArray(user.permissions)) ? user.permissions : null;
    if (!perms || (user && user.username && user.username.toLowerCase() === 'alexandre') || (user && user.role === 'admin')) {
      perms = ['logistica', 'consulta', 'configuracoes'];
    }

    // 3ª Aba Principal (Configurações) só fica visível se o usuário tiver permissão 'configuracoes'
    if (mainTabConfig) {
      if (perms.includes('configuracoes')) {
        mainTabConfig.classList.remove('hidden');
        mainTabConfig.style.display = '';
      } else {
        mainTabConfig.classList.add('hidden');
      }
    }

    // Se o usuário atual estiver em uma aba que não tem permissão, redireciona para Logística
    const activeMainBtn = document.querySelector('.main-tab-btn.active');
    if (activeMainBtn) {
      const activeMain = activeMainBtn.getAttribute('data-main-tab');
      if (!perms.includes(activeMain)) {
        switchMainTab('logistica');
      }
    }
  }

  function showLoginOverlay(show) {
    if (!loginOverlay) return;
    if (show) {
      loginOverlay.classList.remove('hidden');
      if (loginUsername) loginUsername.value = '';
      if (loginPassword) loginPassword.value = '';
      if (loginErrorMsg) loginErrorMsg.classList.add('hidden');
    } else {
      loginOverlay.classList.add('hidden');
    }
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (loginErrorMsg) loginErrorMsg.classList.add('hidden');
      if (btnLoginSubmit) {
        btnLoginSubmit.disabled = true;
        btnLoginSubmit.textContent = 'Verificando...';
      }

      const username = loginUsername.value.trim();
      const password = loginPassword.value.trim();

      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await response.json();

        if (data.success && data.user) {
          const session = {
            token: data.token,
            user: data.user,
            expiresAt: data.expiresAt || (Date.now() + 7 * 24 * 60 * 60 * 1000)
          };
          localStorage.setItem('conciliacao_fretes_session', JSON.stringify(session));
          showAuthenticatedUser(data.user);
        } else {
          if (loginErrorMsg) {
            loginErrorMsg.textContent = `⚠️ ${data.message || 'Usuário ou senha incorretos.'}`;
            loginErrorMsg.classList.remove('hidden');
          }
        }
      } catch (err) {
        if (loginErrorMsg) {
          loginErrorMsg.textContent = '⚠️ Erro ao conectar com o servidor. Tente novamente.';
          loginErrorMsg.classList.remove('hidden');
        }
      } finally {
        if (btnLoginSubmit) {
          btnLoginSubmit.disabled = false;
          btnLoginSubmit.textContent = '🔐 Entrar no Sistema';
        }
      }
    });
  }

  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      if (confirm('Deseja realmente encerrar sua sessão?')) {
        localStorage.removeItem('conciliacao_fretes_session');
        showLoginOverlay(true);
      }
    });
  }

  // --- MINHA SENHA HANDLER ---
  const btnChangeMyPass = document.getElementById('btnChangeMyPass');
  const myPasswordModal = document.getElementById('myPasswordModal');
  const btnCloseMyPassModal = document.getElementById('btnCloseMyPassModal');
  const btnCancelMyPassModal = document.getElementById('btnCancelMyPassModal');
  const myPassForm = document.getElementById('myPassForm');
  const newMyPassword = document.getElementById('newMyPassword');
  const confirmMyPassword = document.getElementById('confirmMyPassword');
  const myPassMsg = document.getElementById('myPassMsg');

  if (btnChangeMyPass) {
    btnChangeMyPass.addEventListener('click', () => {
      if (newMyPassword) newMyPassword.value = '';
      if (confirmMyPassword) confirmMyPassword.value = '';
      if (myPassMsg) myPassMsg.classList.add('hidden');
      if (myPasswordModal) myPasswordModal.classList.remove('hidden');
    });
  }

  if (btnCloseMyPassModal) btnCloseMyPassModal.addEventListener('click', () => myPasswordModal.classList.add('hidden'));
  if (btnCancelMyPassModal) btnCancelMyPassModal.addEventListener('click', () => myPasswordModal.classList.add('hidden'));

  if (myPassForm) {
    myPassForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const p1 = newMyPassword.value.trim();
      const p2 = confirmMyPassword.value.trim();

      if (p1 !== p2) {
        if (myPassMsg) {
          myPassMsg.textContent = '⚠️ As senhas digitadas não coincidem.';
          myPassMsg.classList.remove('hidden');
        }
        return;
      }

      if (!currentUser) return;

      try {
        const response = await fetch('/api/admin/users/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: currentUser.username,
            name: currentUser.name,
            pass: p1
          })
        });
        const data = await response.json();
        if (data.success) {
          if (myPassMsg) myPassMsg.textContent = '✅ Sua senha foi alterada com sucesso!';
          setTimeout(() => {
            if (myPasswordModal) myPasswordModal.classList.add('hidden');
          }, 1200);
        } else {
          if (myPassMsg) myPassMsg.textContent = '⚠️ ' + (data.message || 'Erro ao alterar senha.');
        }
      } catch (err) {
        if (myPassMsg) myPassMsg.textContent = '❌ Erro de comunicação com o servidor.';
      }
    });
  }

  // --- SISTEMA DE NAVEGAÇÃO DE 2 CAMADAS (ABAS PRINCIPAIS + SUB-ABAS) ---
  const mainTabBtns = document.querySelectorAll('.main-tab-btn');
  const subGroupLogistica = document.getElementById('subGroupLogistica');
  const subGroupConsulta = document.getElementById('subGroupConsulta');
  const subGroupConfiguracoes = document.getElementById('subGroupConfiguracoes');

  function switchMainTab(targetMain) {
    mainTabBtns.forEach(b => b.classList.remove('active'));
    
    // Hide all sub groups
    if (subGroupLogistica) subGroupLogistica.classList.add('hidden');
    if (subGroupConsulta) subGroupConsulta.classList.add('hidden');
    if (subGroupConfiguracoes) subGroupConfiguracoes.classList.add('hidden');

    const activeMainBtn = document.querySelector(`.main-tab-btn[data-main-tab="${targetMain}"]`);
    if (activeMainBtn) activeMainBtn.classList.add('active');

    let firstSubBtn = null;

    if (targetMain === 'logistica') {
      if (subGroupLogistica) subGroupLogistica.classList.remove('hidden');
      firstSubBtn = subGroupLogistica ? subGroupLogistica.querySelector('.nav-tab-btn') : null;
    } else if (targetMain === 'consulta') {
      if (subGroupConsulta) subGroupConsulta.classList.remove('hidden');
      firstSubBtn = subGroupConsulta ? subGroupConsulta.querySelector('.nav-tab-btn') : null;
    } else if (targetMain === 'configuracoes') {
      if (subGroupConfiguracoes) subGroupConfiguracoes.classList.remove('hidden');
      firstSubBtn = subGroupConfiguracoes ? subGroupConfiguracoes.querySelector('.nav-tab-btn') : null;
      loadUsersTable();
    }

    if (firstSubBtn) {
      firstSubBtn.click();
    }
  }

  mainTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetMain = btn.getAttribute('data-main-tab');
      switchMainTab(targetMain);
    });
  });

  const allNavSubBtns = document.querySelectorAll('.nav-tab-btn');
  allNavSubBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = btn.getAttribute('data-tab');
      
      // Remove active from sibling sub-buttons
      const parentGroup = btn.closest('.sub-tabs-group');
      if (parentGroup) {
        parentGroup.querySelectorAll('.nav-tab-btn').forEach(b => b.classList.remove('active'));
      }
      btn.classList.add('active');

      tabPanes.forEach(pane => pane.classList.add('hidden'));
      const targetPane = document.getElementById(targetTab);
      if (targetPane) targetPane.classList.remove('hidden');
    });
  });

  // Check auth session on application start
  checkAuthSession();

  // --- TAB 1 LOGIC (UPLOAD & CONCILIAÇÃO) ---
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      uploadFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      uploadFile(fileInput.files[0]);
    }
  });

  // --- TAB 2 LOGIC (CORREIOS & VIPP) ---
  const dropzoneCorreios = document.getElementById('dropzoneCorreios');
  const faturaFileCorreios = document.getElementById('faturaFileCorreios');
  const fileNameCorreios = document.getElementById('fileNameCorreios');
  const uploadFormCorreios = document.getElementById('uploadFormCorreios');
  const btnSampleCorreios = document.getElementById('btnSampleCorreios');
  const tipoCorreios = document.getElementById('tipoCorreios');

  const btnOpenVippModal = document.getElementById('btnOpenVippModal');
  const btnQuickConfigVipp = document.getElementById('btnQuickConfigVipp');
  const vippConfigModal = document.getElementById('vippConfigModal');
  const btnCloseVippModal = document.getElementById('btnCloseVippModal');
  const btnCancelVippModal = document.getElementById('btnCancelVippModal');
  const vippConfigForm = document.getElementById('vippConfigForm');
  const vippUser = document.getElementById('vippUser');
  const vippToken = document.getElementById('vippToken');
  const vippIdPerfil = document.getElementById('vippIdPerfil');
  const vippContrato = document.getElementById('vippContrato');
  const vippConfigMsg = document.getElementById('vippConfigMsg');

  const vippStatusDot = document.getElementById('vippStatusDot');
  const vippStatusText = document.getElementById('vippStatusText');

  async function loadVippConfigStatus() {
    try {
      const res = await fetch('/api/vipp/config');
      const data = await res.json();
      if (data.success && data.config) {
        if (data.config.hasToken || data.config.ativo) {
          if (vippStatusDot) vippStatusDot.style.backgroundColor = '#10b981'; // Green
          if (vippStatusText) vippStatusText.innerHTML = `Status API ViPP: <strong>🟢 Token Ativo (${data.config.usuario})</strong> — Automação WebService Conectada`;
        } else {
          if (vippStatusDot) vippStatusDot.style.backgroundColor = '#f59e0b'; // Amber
          if (vippStatusText) vippStatusText.innerHTML = `Status API ViPP: <strong>Aguardando Token da API WebService</strong> (Modo Leitura SFE PDF Ativo)`;
        }
        if (vippUser && data.config.usuario) vippUser.value = data.config.usuario;
        if (vippIdPerfil && data.config.idPerfil) vippIdPerfil.value = data.config.idPerfil;
        if (vippContrato && data.config.contrato) vippContrato.value = data.config.contrato;
      }
    } catch (e) {
      console.error('Erro ao buscar status do ViPP:', e);
    }
  }

  function openVippModal(open) {
    if (vippConfigModal) {
      if (open) vippConfigModal.classList.remove('hidden');
      else vippConfigModal.classList.add('hidden');
    }
  }

  if (btnOpenVippModal) btnOpenVippModal.addEventListener('click', () => openVippModal(true));
  if (btnQuickConfigVipp) btnQuickConfigVipp.addEventListener('click', () => openVippModal(true));
  if (btnCloseVippModal) btnCloseVippModal.addEventListener('click', () => openVippModal(false));
  if (btnCancelVippModal) btnCancelVippModal.addEventListener('click', () => openVippModal(false));

  if (vippConfigForm) {
    vippConfigForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (vippConfigMsg) {
        vippConfigMsg.textContent = 'Salvando e testando credenciais ViPP...';
        vippConfigMsg.classList.remove('hidden');
      }

      try {
        const res = await fetch('/api/vipp/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            usuario: vippUser.value,
            token: vippToken.value,
            idPerfil: vippIdPerfil.value,
            contrato: vippContrato.value
          })
        });
        const data = await res.json();
        if (data.success) {
          if (vippConfigMsg) vippConfigMsg.textContent = '✅ Credenciais salvas com sucesso!';
          setTimeout(() => {
            openVippModal(false);
            loadVippConfigStatus();
          }, 1200);
        } else {
          if (vippConfigMsg) vippConfigMsg.textContent = '⚠️ ' + (data.message || 'Erro ao salvar.');
        }
      } catch (err) {
        if (vippConfigMsg) vippConfigMsg.textContent = '❌ Erro de conexão ao salvar token.';
      }
    });
  }

  // Carregar status na inicialização
  loadVippConfigStatus();

  if (dropzoneCorreios && faturaFileCorreios) {
    dropzoneCorreios.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzoneCorreios.classList.add('dragover');
    });

    dropzoneCorreios.addEventListener('dragleave', () => {
      dropzoneCorreios.classList.remove('dragover');
    });

    dropzoneCorreios.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzoneCorreios.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        faturaFileCorreios.files = e.dataTransfer.files;
        if (fileNameCorreios) fileNameCorreios.textContent = e.dataTransfer.files[0].name;
        uploadCorreiosFile(e.dataTransfer.files[0]);
      }
    });

    faturaFileCorreios.addEventListener('change', () => {
      if (faturaFileCorreios.files.length > 0) {
        if (fileNameCorreios) fileNameCorreios.textContent = faturaFileCorreios.files[0].name;
      }
    });
  }

  if (uploadFormCorreios) {
    uploadFormCorreios.addEventListener('submit', (e) => {
      e.preventDefault();
      if (faturaFileCorreios && faturaFileCorreios.files.length > 0) {
        uploadCorreiosFile(faturaFileCorreios.files[0]);
      } else {
        alert('Por favor, selecione um arquivo de Fatura Correios ou utilize o botão "⚡ Carregar Exemplo Correios".');
      }
    });
  }

  if (btnSampleCorreios) {
    btnSampleCorreios.addEventListener('click', async () => {
      showLoading(true, 'Carregando exemplo de Extrato Analítico dos Correios (OACO) e consultando ERP Protheus...');
      try {
        const response = await fetch('/api/sample-correios');
        const data = await response.json();
        if (data.success) {
          renderFaturaData(data);
          // Switch to tab 1 results or keep open table
          const tab1Btn = document.querySelector('[data-tab="tab-upload"]');
          if (tab1Btn) tab1Btn.click();
        } else {
          alert('Erro ao carregar exemplo dos Correios: ' + data.message);
        }
      } catch (err) {
        alert('Erro ao carregar exemplo dos Correios.');
        console.error(err);
      } finally {
        showLoading(false);
      }
    });
  }

  async function uploadCorreiosFile(file) {
    showLoading(true, `Lendo Fatura Correios (${file.name}) e buscando etiquetas/NFs no ERP Protheus...`);
    const formData = new FormData();
    formData.append('faturaFile', file);
    formData.append('tipoTransportadora', tipoCorreios ? tipoCorreios.value : 'CORREIOS_SFE');

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      const data = await response.json();
      if (data.success) {
        renderFaturaData(data);
        const tab1Btn = document.querySelector('[data-tab="tab-upload"]');
        if (tab1Btn) tab1Btn.click();
      } else {
        alert('Erro ao ler a fatura Correios: ' + data.message);
      }
    } catch (err) {
      alert('Erro no upload da Fatura Correios.');
      console.error(err);
    } finally {
      showLoading(false);
    }
  }

  function showLoading(isLoading, msg = 'Processando...') {
    if (isLoading) {
      loadingMessage.textContent = msg;
      loadingState.classList.remove('hidden');
      dropzone.classList.add('hidden');
    } else {
      loadingState.classList.add('hidden');
      dropzone.classList.remove('hidden');
    }
  }

  function renderFaturaData(data) {
    currentFatura = data.fatura;
    currentItems = data.items;

    sumTransp.textContent = currentFatura.transportadora;
    const empCod = currentFatura.empresaCodigo || '16';
    const empNome = currentFatura.pagador || 'OACO PRODUTOS DE ACO LTDA';
    
    sumCnpj.innerHTML = `Pagador: <strong>${empNome}</strong> <span class="ped-venda-badge" style="margin-left: 8px;">Protheus Empresa ${empCod} (${currentFatura.empresaKey || 'OACO'})</span>`;
    sumFaturaNum.textContent = currentFatura.numeroFatura;
    sumDatas.textContent = `Emissão: ${currentFatura.dataEmissao} | Venc: ${currentFatura.dataVencimento}`;
    sumQtdFretes.textContent = `${currentFatura.qtdFretes} CT-es`;
    sumValorTotal.textContent = formatCurrency(currentFatura.valorTotal);

    renderTableRows();

    faturaSummary.classList.remove('hidden');
    tableSection.classList.remove('hidden');
    tableSection.scrollIntoView({ behavior: 'smooth' });
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

  const cntDivergDanger = document.getElementById('cntDivergDanger');
  const cntDivergWarning = document.getElementById('cntDivergWarning');
  const cntDivergSuccess = document.getElementById('cntDivergSuccess');
  const tolerancyInput = document.getElementById('tolerancyInput');
  const filterChips = document.querySelectorAll('.filter-chip');
  let activeStatusFilter = 'all';

  filterChips.forEach(chip => {
    chip.addEventListener('click', (e) => {
      filterChips.forEach(c => c.classList.remove('active'));
      e.target.classList.add('active');
      activeStatusFilter = e.target.getAttribute('data-filter') || 'all';
      renderTableRows();
    });
  });

  if (tolerancyInput) {
    tolerancyInput.addEventListener('input', () => {
      renderTableRows();
    });
  }

  function getItemDivergence(item, tolerancy = 0.00) {
    if (!item) {
      return { type: 'warning', orderPriority: 1, badgeHtml: `<span class="diverg-badge status-warning">⚠️ Dados Indisponíveis</span>`, diffVal: 0 };
    }

    if (item.protheusEncontrado === false) {
      return {
        type: 'warning',
        orderPriority: 1, // Amarelo (Não Encontrado)
        badgeHtml: `<span class="diverg-badge status-warning">❓ NF Não Encontrada</span>`,
        diffVal: 0
      };
    }

    const cobrado = parseFloat(item.valorCobrado);
    const freteProtheus = parseFloat(item.freteProtheusTotal || ((item.freteCobradoProtheus || 0) + (item.freteEmbutidoProtheus || 0)));

    if (isNaN(cobrado) || isNaN(freteProtheus)) {
      return {
        type: 'warning',
        orderPriority: 1, // Amarelo (Valor Inválido)
        badgeHtml: `<span class="diverg-badge status-warning">⚠️ Valor Inválido</span>`,
        diffVal: 0
      };
    }

    // Arredondamento para 2 casas decimais (evita imprecisão do IEEE 754)
    const diff = Math.round((cobrado - freteProtheus) * 100) / 100;

    if (diff > tolerancy) {
      return {
        type: 'danger',
        orderPriority: 0, // Vermelho (Prejuízo)
        badgeHtml: `<span class="diverg-badge status-danger">▲ Prejuízo +${formatCurrency(diff)}</span>`,
        diffVal: diff
      };
    } else if (diff < -tolerancy) {
      return {
        type: 'info',
        orderPriority: 2, // Azul (Lucro / Cobrado a menos)
        badgeHtml: `<span class="diverg-badge status-info">▼ Sobra ${formatCurrency(Math.abs(diff))}</span>`,
        diffVal: diff
      };
    } else {
      return {
        type: 'success',
        orderPriority: 3, // Verde (Bateu)
        badgeHtml: `<span class="diverg-badge status-success">✓ Bateu 100%</span>`,
        diffVal: 0
      };
    }
  }

  tableSearch.addEventListener('input', (e) => {
    filterText = e.target.value.toLowerCase().trim();
    renderTableRows();
  });

  function renderTableRows() {
    if (!currentItems || !Array.isArray(currentItems) || !currentFatura) {
      return; // Proteção contra crash se a função for chamada antes de carregar a fatura
    }

    ctesTableBody.innerHTML = '';

    let totalCobrado = 0;
    let cntDanger = 0;
    let cntWarning = 0;
    let cntSuccess = 0;

    const rawTol = parseFloat(tolerancyInput ? tolerancyInput.value : 0);
    const tolerancy = isNaN(rawTol) ? 0.00 : Math.max(0, rawTol);

    // Processar divergências e estatísticas de TODOS os itens
    currentItems.forEach(item => {
      const divInfo = getItemDivergence(item, tolerancy);
      item._divInfo = divInfo;
      if (divInfo.type === 'danger') cntDanger++;
      else if (divInfo.type === 'warning') cntWarning++;
      else if (divInfo.type === 'success' || divInfo.type === 'info') cntSuccess++;
    });

    // Atualizar estatísticas dos cartões no topo
    if (cntDivergDanger) cntDivergDanger.textContent = cntDanger;
    if (cntDivergWarning) cntDivergWarning.textContent = cntWarning;
    if (cntDivergSuccess) cntDivergSuccess.textContent = cntSuccess;

    // Clonar e ordenar por prioridade de divergência (Divergentes Prejuízo -> Warning -> Info -> Success)
    const sortedItems = [...currentItems].sort((a, b) => {
      return a._divInfo.orderPriority - b._divInfo.orderPriority;
    });

    // Filtrar por busca de texto e por filtro de status ativo
    const filteredItems = sortedItems.filter(item => {
      if (filterText) {
        const matchesText = (
          (item.numFrete && item.numFrete.toLowerCase().includes(filterText)) ||
          (item.docOriginario && item.docOriginario.toLowerCase().includes(filterText)) ||
          (item.pedVenda && item.pedVenda.toLowerCase().includes(filterText)) ||
          (item.cliente && item.cliente.toLowerCase().includes(filterText))
        );
        if (!matchesText) return false;
      }
      if (activeStatusFilter === 'danger') return item._divInfo.type === 'danger';
      if (activeStatusFilter === 'warning') return item._divInfo.type === 'warning';
      if (activeStatusFilter === 'success') return item._divInfo.type === 'success' || item._divInfo.type === 'info';
      return true;
    });

    filteredItems.forEach((item) => {
      totalCobrado += item.valorCobrado || 0;

      const realIndex = currentItems.indexOf(item);
      const dataVenc = item.dataVencimento || currentFatura.dataVencimento || '31/07/2026';
      const freteProtheusTotal = item.freteProtheusTotal || ((item.freteCobradoProtheus || 0) + (item.freteEmbutidoProtheus || 0));

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="badge-doc">${escapeHtml(item.doc)}</span></td>
        <td class="mono-text"><strong>${escapeHtml(item.numFrete)}</strong></td>
        <td>
          <input 
            type="text" 
            class="editable-input ${item.isEdited ? 'edited' : ''}" 
            value="${escapeHtml(item.docOriginario)}" 
            data-index="${realIndex}"
            title="Clique para editar a NF (Consulta SD2_DOC)"
          />
        </td>
        <td><span class="ped-venda-badge">${escapeHtml(item.pedVenda || 'N/A')}</span></td>
        <td class="mono-text"><strong>${formatCurrency(freteProtheusTotal)}</strong></td>
        <td class="mono-text"><strong>${formatCurrency(item.valorCobrado)}</strong></td>
        <td>${item._divInfo.badgeHtml}</td>
        <td class="mono-text"><span class="venc-badge">📅 ${escapeHtml(dataVenc)}</span></td>
        <td>${escapeHtml(item.cliente)}</td>
        <td>
          <span class="status-badge ${item.status === 'Lançado no Protheus' ? 'sucesso' : 'pendente'}" id="statusBadge-${realIndex}">
            ${escapeHtml(item.status)}
          </span>
        </td>
      `;
      ctesTableBody.appendChild(tr);
    });

    document.querySelectorAll('.editable-input').forEach(input => {
      input.addEventListener('change', async (e) => {
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        const newNf = e.target.value.trim();
        currentItems[idx].docOriginario = newNf;
        currentItems[idx].isEdited = true;
        e.target.classList.add('edited');

        try {
          const empKey = currentFatura.empresaKey || 'OACO';
          const res = await fetch(`/api/protheus/consulta/${newNf}?empresa=${empKey}`);
          const resData = await res.json();
          if (resData.success && resData.data && resData.data.encontrado) {
            currentItems[idx].pedVenda = resData.data.pedVenda;
            currentItems[idx].freteCobradoProtheus = resData.data.freteCobrado;
            currentItems[idx].freteEmbutidoProtheus = resData.data.freteEmbutido;
            currentItems[idx].freteProtheusTotal = resData.data.freteProtheusTotal;
            currentItems[idx].protheusEncontrado = true;
          } else {
            currentItems[idx].pedVenda = 'N/A';
            currentItems[idx].freteCobradoProtheus = 0;
            currentItems[idx].freteEmbutidoProtheus = 0;
            currentItems[idx].freteProtheusTotal = 0;
            currentItems[idx].protheusEncontrado = false;
          }
          renderTableRows();
        } catch (err) {
          console.error('Erro na requisição ao Protheus:', err);
          currentItems[idx].protheusEncontrado = false;
          renderTableRows();
        }
      });
    });

    if (footTotalCobrado) footTotalCobrado.innerHTML = `<strong>${formatCurrency(totalCobrado)}</strong>`;

    const fullCobrado = currentItems.reduce((acc, curr) => acc + (curr.valorCobrado || 0), 0);
    const diff = Math.abs(currentFatura.valorTotal - fullCobrado);
    if (diff < 0.05) {
      batimentoBadge.className = 'batimento-badge status-ok';
      batimentoBadge.textContent = `✓ Batimento ${formatCurrency(fullCobrado)} (100%)`;
    } else {
      batimentoBadge.className = 'batimento-badge status-alert';
      batimentoBadge.textContent = `⚠️ Divergência Fatura R$ ${diff.toFixed(2)}`;
    }
  }

  btnRecalcular.addEventListener('click', () => {
    renderTableRows();
  });

  btnExportCsv.addEventListener('click', () => {
    if (!currentItems || currentItems.length === 0) return;
    let csv = 'DOC;Num Frete;Doc (NF);Ped Venda;Cobrado Cli.;Data Vencimento;Valor Orcado;Valor Cobrado;Cliente;Status\n';
    currentItems.forEach(i => {
      const fTotal = i.freteProtheusTotal || ((i.freteCobradoProtheus || 0) + (i.freteEmbutidoProtheus || 0));
      csv += `"${i.doc}";"${i.numFrete}";"${i.docOriginario}";"${i.pedVenda}";"${fTotal}";"${i.dataVencimento || currentFatura.dataVencimento}";"${i.valorOrcadoStr || i.valorOrcado}";"${i.valorCobradoStr || i.valorCobrado}";"${i.cliente}";"${i.status}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `Conciliacao_Protheus_Fatura_${currentFatura.numeroFatura}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });

  btnLancarProtheus.disabled = true;
  btnLancarProtheus.addEventListener('click', (e) => {
    e.preventDefault();
    alert('A gravação automática de fretes no Protheus está desabilitada por enquanto (módulo em homologação). Utilize a consulta e a exportação em CSV para conferência.');
  });

  // --- TAB 3 LOGIC (CONSULTA NFE OU PEDIDO) ---
  function updateSearchInputsState() {
    const pedValue = searchPedVenda.value.trim();
    const nfeValue = searchNFe.value.trim();

    if (pedValue !== '') {
      searchNFe.disabled = true;
      searchNFe.placeholder = 'Bloqueado (Pedido preenchido)';
      tagNFe.textContent = 'Bloqueado';
      tagNFe.classList.add('blocked');
    } else {
      searchNFe.disabled = false;
      searchNFe.placeholder = 'Ex: 546 ou 000000546';
      tagNFe.textContent = 'Ativo';
      tagNFe.classList.remove('blocked');
    }

    if (nfeValue !== '') {
      searchPedVenda.disabled = true;
      searchPedVenda.placeholder = 'Bloqueado (NFe preenchida)';
      tagPedVenda.textContent = 'Bloqueado';
      tagPedVenda.classList.add('blocked');
    } else {
      searchPedVenda.disabled = false;
      searchPedVenda.placeholder = 'Ex: 000630 ou 630';
      tagPedVenda.textContent = 'Ativo';
      tagPedVenda.classList.remove('blocked');
    }
  }

  if (searchPedVenda && searchNFe) {
    searchPedVenda.addEventListener('input', updateSearchInputsState);
    searchNFe.addEventListener('input', updateSearchInputsState);
  }

  if (btnLimparConsulta) {
    btnLimparConsulta.addEventListener('click', () => {
      searchPedVenda.value = '';
      searchNFe.value = '';
      updateSearchInputsState();
      consultaResultsSection.classList.add('hidden');
      consultaEmptyState.innerHTML = `
        <div class="empty-icon">🔍</div>
        <h4>Nenhuma busca realizada ainda</h4>
        <p>Preencha o <strong>Número do Pedido de Venda</strong> ou o <strong>Número da NFe</strong> acima e clique em <strong>Buscar</strong> para visualizar os resultados multi-empresa.</p>
      `;
      consultaEmptyState.classList.remove('hidden');
      if (consultaTableBody) consultaTableBody.innerHTML = '';
    });
  }

  if (btnBuscarConsulta) {
    btnBuscarConsulta.addEventListener('click', async () => {
      const pedValue = searchPedVenda.value.trim();
      const nfeValue = searchNFe.value.trim();

      if (!pedValue && !nfeValue) {
        alert('Por favor, preencha o Número do Pedido de Venda OU o Número da NFe para buscar.');
        return;
      }

      const tipo = pedValue ? 'pedVenda' : 'nfe';
      const termo = pedValue || nfeValue;

      consultaEmptyState.classList.add('hidden');
      consultaResultsSection.classList.add('hidden');
      consultaLoading.classList.remove('hidden');

      try {
        const response = await fetch(`/api/protheus/consulta-avancada?tipo=${tipo}&termo=${encodeURIComponent(termo)}`);
        const data = await response.json();

        if (data.success && data.rows && data.rows.length > 0) {
          renderConsultaResults(data.rows, tipo, termo);
        } else {
          renderConsultaEmptyResults(tipo, termo);
        }
      } catch (err) {
        alert('Erro ao realizar consulta no Protheus: ' + err.message);
        console.error(err);
      } finally {
        consultaLoading.classList.add('hidden');
      }
    });
  }

  function renderConsultaResults(rows, tipo, termo) {
    consultaTableBody.innerHTML = '';
    
    rows.forEach(row => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="badge-doc">${escapeHtml(row.empresa)}</span></td>
        <td><span class="ped-venda-badge">${escapeHtml(row.pedVenda)}</span></td>
        <td class="mono-text"><strong>${escapeHtml(row.nf)}</strong></td>
        <td class="mono-text"><strong>${formatCurrency(row.valorCobrado)}</strong></td>
        <td><strong>${escapeHtml(row.nomeCli)}</strong></td>
      `;
      consultaTableBody.appendChild(tr);
    });

    resultsCountBadge.textContent = `${rows.length} ${rows.length === 1 ? 'registro encontrado' : 'registros encontrados'}`;
    searchParamInfo.innerHTML = `Busca realizada por: <strong>${tipo === 'pedVenda' ? 'Pedido de Venda' : 'Número da NFe'} (${escapeHtml(termo)})</strong>`;

    consultaEmptyState.classList.add('hidden');
    consultaResultsSection.classList.remove('hidden');
  }

  function renderConsultaEmptyResults(tipo, termo) {
    consultaTableBody.innerHTML = '';
    resultsCountBadge.textContent = '0 registros encontrados';
    searchParamInfo.innerHTML = `Busca por <strong>${tipo === 'pedVenda' ? 'Pedido' : 'NFe'} (${escapeHtml(termo)})</strong>`;
    
    consultaEmptyState.innerHTML = `
      <div class="empty-icon">⚠️</div>
      <h4>Nenhum registro encontrado</h4>
      <p>Não foram encontrados dados no Protheus para o ${tipo === 'pedVenda' ? 'Pedido de Venda' : 'Número de NFe'} "<strong>${escapeHtml(termo)}</strong>". Tente outro número.</p>
    `;
    consultaEmptyState.classList.remove('hidden');
    consultaResultsSection.classList.add('hidden');
  }

  // --- MODALS HANDLER ---
  btnOpenHistory.addEventListener('click', async () => {
    historyModalBody.innerHTML = '<p>Carregando histórico de integrações...</p>';
    historyModal.classList.remove('hidden');
    try {
      const response = await fetch('/api/history');
      const data = await response.json();
      if (data.success && data.history.length > 0) {
        historyModalBody.innerHTML = data.history.map(item => `
          <div class="history-card">
            <div class="history-card-header">
              <span class="history-card-title">${item.transportadora} — Fatura ${item.faturaNumero}</span>
              <span class="status-badge sucesso">✓ Integrado na Empresa ${item.empresaCodigo || '16'}</span>
            </div>
            <div class="history-card-meta">
              <span>🏢 Pagador: <strong>${item.pagador || 'OACO'}</strong></span> | 
              <span>📅 Data Integração: ${item.dataIntegracao}</span> | 
              <span>⏳ Vencimento: <strong>${item.dataVencimento || '31/07/2026'}</strong></span> | 
              <span>📦 ${item.totalFretes} CT-es</span> | 
              <span>💰 Total: <strong>${formatCurrency(item.valorTotal)}</strong></span>
            </div>
          </div>
        `).join('');
      } else {
        historyModalBody.innerHTML = '<p style="color: var(--text-muted);">Nenhum histórico de integração gravado ainda.</p>';
      }
    } catch (err) {
      historyModalBody.innerHTML = '<p style="color: var(--accent-rose);">Erro ao buscar histórico.</p>';
    }
  });

  btnCloseModal.addEventListener('click', () => resultModal.classList.add('hidden'));
  btnConfirmModal.addEventListener('click', () => resultModal.classList.add('hidden'));
  btnCloseHistoryModal.addEventListener('click', () => historyModal.classList.add('hidden'));
  btnConfirmHistoryModal.addEventListener('click', () => historyModal.classList.add('hidden'));

  // --- USER MANAGEMENT (TAB CONFIGURAÇÕES) ---
  const btnNewUser = document.getElementById('btnNewUser');
  const userModal = document.getElementById('userModal');
  const btnCloseUserModal = document.getElementById('btnCloseUserModal');
  const btnCancelUserModal = document.getElementById('btnCancelUserModal');
  const userForm = document.getElementById('userForm');
  const userModalTitle = document.getElementById('userModalTitle');

  const editUsername = document.getElementById('editUsername');
  const editName = document.getElementById('editName');
  const editPassword = document.getElementById('editPassword');
  const editRole = document.getElementById('editRole');
  const permLogistica = document.getElementById('permLogistica');
  const permConsulta = document.getElementById('permConsulta');
  const permConfiguracoes = document.getElementById('permConfiguracoes');
  const userModalMsg = document.getElementById('userModalMsg');
  const usersTableBody = document.getElementById('usersTableBody');

  let currentUsersData = [];

  async function loadUsersTable() {
    if (!usersTableBody) return;
    usersTableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 1rem;">Carregando lista de usuários...</td></tr>';

    try {
      const response = await fetch('/api/admin/users');
      const data = await response.json();
      if (data.success && data.users) {
        currentUsersData = data.users;
        renderUsersTable(data.users);
      } else {
        usersTableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--accent-rose);">Erro ao carregar usuários.</td></tr>';
      }
    } catch (err) {
      usersTableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--accent-rose);">Erro de conexão com o servidor.</td></tr>';
    }
  }

  function renderUsersTable(users) {
    if (!usersTableBody) return;
    usersTableBody.innerHTML = '';

    users.forEach(u => {
      const tr = document.createElement('tr');
      
      const perms = u.permissions || ['logistica', 'consulta'];
      const permsHtml = [
        perms.includes('logistica') ? '<span class="perm-badge perm-badge-logistica">📦 Logística</span>' : '',
        perms.includes('consulta') ? '<span class="perm-badge perm-badge-consulta">🔍 Consulta</span>' : '',
        perms.includes('configuracoes') ? '<span class="perm-badge perm-badge-configuracoes">⚙️ Configurações</span>' : ''
      ].filter(Boolean).join(' ');

      const isMainAdmin = u.username.toLowerCase() === 'alexandre';

      tr.innerHTML = `
        <td><strong>${u.username}</strong></td>
        <td>${u.name}</td>
        <td><span class="status-badge ${u.role === 'admin' ? 'sucesso' : 'pendente'}">${u.role === 'admin' ? 'Administrador' : 'Operador'}</span></td>
        <td>${permsHtml || '<em style="color: var(--text-muted);">Nenhuma</em>'}</td>
        <td><span class="status-badge ${u.active ? 'sucesso' : 'divergente'}">${u.active ? 'Ativo' : 'Inativo'}</span></td>
        <td style="text-align: right;">
          <button class="btn btn-outline btn-sm btn-edit-user" data-user="${u.username}" title="Editar Usuário / Permissões">✏️ Editar</button>
          ${!isMainAdmin ? `<button class="btn btn-outline btn-sm btn-delete-user" data-user="${u.username}" style="color: var(--accent-rose); border-color: rgba(244, 63, 94, 0.3);" title="Excluir Usuário">🗑️</button>` : ''}
        </td>
      `;

      usersTableBody.appendChild(tr);
    });

    // Attach edit handlers
    document.querySelectorAll('.btn-edit-user').forEach(btn => {
      btn.addEventListener('click', () => {
        const uname = btn.getAttribute('data-user');
        const userObj = currentUsersData.find(x => x.username.toLowerCase() === uname.toLowerCase());
        if (userObj) openUserModalForEdit(userObj);
      });
    });

    // Attach delete handlers
    document.querySelectorAll('.btn-delete-user').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uname = btn.getAttribute('data-user');
        if (confirm(`Tem certeza que deseja excluir o usuário "${uname}"?`)) {
          try {
            const res = await fetch('/api/admin/users/delete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username: uname })
            });
            const d = await res.json();
            alert(d.message);
            loadUsersTable();
          } catch (e) {
            alert('Erro ao excluir usuário.');
          }
        }
      });
    });
  }

  function openUserModalForNew() {
    if (userModalTitle) userModalTitle.textContent = '➕ Cadastrar Novo Usuário';
    if (editUsername) { editUsername.value = ''; editUsername.disabled = false; }
    if (editName) editName.value = '';
    if (editPassword) editPassword.value = '';
    if (editRole) editRole.value = 'user';
    if (permLogistica) permLogistica.checked = true;
    if (permConsulta) permConsulta.checked = true;
    if (permConfiguracoes) permConfiguracoes.checked = false;
    if (userModalMsg) userModalMsg.classList.add('hidden');
    if (userModal) userModal.classList.remove('hidden');
  }

  function openUserModalForEdit(userObj) {
    if (userModalTitle) userModalTitle.textContent = `✏️ Editar Usuário: ${userObj.username}`;
    if (editUsername) { editUsername.value = userObj.username; editUsername.disabled = true; }
    if (editName) editName.value = userObj.name;
    if (editPassword) editPassword.value = '';
    if (editRole) editRole.value = userObj.role || 'user';

    const perms = userObj.permissions || ['logistica', 'consulta'];
    if (permLogistica) permLogistica.checked = perms.includes('logistica');
    if (permConsulta) permConsulta.checked = perms.includes('consulta');
    if (permConfiguracoes) permConfiguracoes.checked = perms.includes('configuracoes');

    if (userModalMsg) userModalMsg.classList.add('hidden');
    if (userModal) userModal.classList.remove('hidden');
  }

  if (btnNewUser) btnNewUser.addEventListener('click', openUserModalForNew);
  if (btnCloseUserModal) btnCloseUserModal.addEventListener('click', () => userModal.classList.add('hidden'));
  if (btnCancelUserModal) btnCancelUserModal.addEventListener('click', () => userModal.classList.add('hidden'));

  if (userForm) {
    userForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (userModalMsg) {
        userModalMsg.textContent = 'Salvando alterações...';
        userModalMsg.classList.remove('hidden');
      }

      const selectedPerms = [];
      if (permLogistica && permLogistica.checked) selectedPerms.push('logistica');
      if (permConsulta && permConsulta.checked) selectedPerms.push('consulta');
      if (permConfiguracoes && permConfiguracoes.checked) selectedPerms.push('configuracoes');

      const payload = {
        username: editUsername.value.trim(),
        name: editName.value.trim(),
        pass: editPassword.value.trim(),
        role: editRole.value,
        permissions: selectedPerms,
        active: true
      };

      try {
        const response = await fetch('/api/admin/users/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await response.json();

        if (data.success) {
          if (userModalMsg) userModalMsg.textContent = '✅ ' + data.message;
          setTimeout(() => {
            if (userModal) userModal.classList.add('hidden');
            loadUsersTable();
            // If editing current logged in user, refresh session
            if (currentUser && currentUser.username.toLowerCase() === payload.username.toLowerCase()) {
              currentUser.permissions = payload.permissions;
              applyUserPermissions(currentUser);
            }
          }, 1000);
        } else {
          if (userModalMsg) userModalMsg.textContent = '⚠️ ' + (data.message || 'Erro ao salvar usuário.');
        }
      } catch (err) {
        if (userModalMsg) userModalMsg.textContent = '❌ Erro de comunicação com o servidor.';
      }
    });
  }
});
