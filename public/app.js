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

  // DOM Elements - 2FA (Dois Fatores)
  const twoFactorForm = document.getElementById('twoFactorForm');
  const twoFactorMsgText = document.getElementById('twoFactorMsgText');
  const twoFactorEmailMasked = document.getElementById('twoFactorEmailMasked');
  const twoFactorErrorMsg = document.getElementById('twoFactorErrorMsg');
  const btnVerify2FA = document.getElementById('btnVerify2FA');
  const btnBackToLogin = document.getElementById('btnBackToLogin');
  const btnResend2FA = document.getElementById('btnResend2FA');
  const twoFactorTimer = document.getElementById('twoFactorTimer');
  const digitInputs = [
    document.getElementById('digit1'),
    document.getElementById('digit2'),
    document.getElementById('digit3'),
    document.getElementById('digit4')
  ];

  let currentTemp2FAToken = null;
  let twoFactorTimerInterval = null;

  // DOM Elements - Tab Navigation
  const navTabBtns = document.querySelectorAll('.nav-tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');
  const mainTabBtns = document.querySelectorAll('.main-tab-btn');
  const subGroupLogistica = document.getElementById('subGroupLogistica');
  const subGroupConsulta = document.getElementById('subGroupConsulta');
  const subGroupVendedores = document.getElementById('subGroupVendedores');
  const subGroupCompras = document.getElementById('subGroupCompras');
  const subGroupFinanceiro = document.getElementById('subGroupFinanceiro');
  const subGroupAnalistaFin = document.getElementById('subGroupAnalistaFin');
  const subGroupConfiguracoes = document.getElementById('subGroupConfiguracoes');

  // Função global de sanitização contra DOM-based XSS
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Valida se o destino da requisição é da mesma origem (same-origin) antes de injetar credenciais
  function isSameOriginUrl(targetUrl) {
    if (!targetUrl) return false;
    try {
      const urlStr = (typeof targetUrl === 'object' && targetUrl instanceof Request) 
        ? targetUrl.url 
        : String(targetUrl);

      // URLs relativas são sempre da mesma origem
      if (urlStr.startsWith('/') && !urlStr.startsWith('//')) return true;
      if (!urlStr.startsWith('http://') && !urlStr.startsWith('https://') && !urlStr.startsWith('//')) return true;

      // URLs absolutas: valida se o origin bate com window.location.origin
      const parsed = new URL(urlStr, window.location.origin);
      return parsed.origin === window.location.origin;
    } catch {
      return false;
    }
  }

  // Intercepta requisições fetch da mesma origem para anexar token JWT e dados do usuário logado
  const originalFetch = window.fetch;
  window.fetch = function(url, options = {}) {
    options = options || {};
    
    // Só anexa credenciais/tokens sensíveis se a requisição for para a mesma origem (prevenção de vazamento P0)
    if (isSameOriginUrl(url)) {
      options.headers = options.headers || {};

      let token = currentToken;
      if (!token) {
        try {
          const rawSession = localStorage.getItem('conciliacao_fretes_session');
          if (rawSession) {
            const sess = JSON.parse(rawSession);
            if (sess && sess.token) token = sess.token;
          }
        } catch {}
      }

      if (token) {
        if (options.headers instanceof Headers) {
          options.headers.set('Authorization', `Bearer ${token}`);
        } else if (Array.isArray(options.headers)) {
          options.headers.push(['Authorization', `Bearer ${token}`]);
        } else {
          options.headers['Authorization'] = `Bearer ${token}`;
        }
      }
    }
    return originalFetch.call(this, url, options);
  };

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
  const searchCodWeb = document.getElementById('searchCodWeb');
  const searchPedVenda = document.getElementById('searchPedVenda');
  const searchNFe = document.getElementById('searchNFe');
  const tagCodWeb = document.getElementById('tagCodWeb');
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
  let currentToken = null;

  // --- AUTHENTICATION & 7-DAY SESSION SYSTEM ---
  function checkAuthSession() {
    const rawSession = localStorage.getItem('conciliacao_fretes_session');
    if (rawSession) {
      try {
        const session = JSON.parse(rawSession);
        if (session && session.expiresAt && session.expiresAt > Date.now()) {
          currentUser = session.user;
          currentToken = session.token || null;
          showAuthenticatedUser(session.user, session.token);
          return true;
        }
      } catch (e) {
        localStorage.removeItem('conciliacao_fretes_session');
      }
    }
    showLoginOverlay(true);
    return false;
  }

  let sessionHeartbeatTimer = null;
  function startSessionHeartbeat() {
    if (sessionHeartbeatTimer) clearInterval(sessionHeartbeatTimer);
    fetch('/api/auth/session-ping', { method: 'POST' }).catch(() => {});
    sessionHeartbeatTimer = setInterval(() => {
      if (currentUser && currentToken) {
        fetch('/api/auth/session-ping', { method: 'POST' }).catch(() => {});
      }
    }, 5 * 60 * 1000);
  }

  function showAuthenticatedUser(user, token) {
    currentUser = user;
    if (token) currentToken = token;
    if (loginOverlay) {
      loginOverlay.classList.add('hidden');
      loginOverlay.style.display = 'none';
    }
    if (userInfo) userInfo.textContent = user.name || user.username;

    // Dispara Heartbeat para manter último acesso ativo no painel de auditoria
    startSessionHeartbeat();

    // Apply Tab Permissions safely
    try {
      applyUserPermissions(user);
    } catch (err) {
      console.warn('Aviso ao aplicar permissões do usuário:', err);
    }
  }

  function applyUserPermissions(user) {
    const mainTabTarefas = document.getElementById('mainTabTarefas');
    const mainTabLogistica = document.getElementById('mainTabLogistica');
    const mainTabConsulta = document.getElementById('mainTabConsulta');
    const mainTabVendedores = document.getElementById('mainTabVendedores');
    const mainTabCompras = document.getElementById('mainTabCompras');
    const mainTabFinanceiro = document.getElementById('mainTabFinanceiro');
    const mainTabAnalistaFin = document.getElementById('mainTabAnalistaFin');
    const mainTabBi = document.getElementById('mainTabBi');
    const mainTabConfig = document.getElementById('mainTabConfig');
    
    // Garante que o usuário Alexandre ou Administrador tenha permissão total mesmo com sessão antiga no localStorage
    const isAdmin = (user && user.username && user.username.toLowerCase() === 'alexandre') || (user && user.role === 'admin');
    let perms = (user && Array.isArray(user.permissions)) ? user.permissions : null;
    if (!perms || isAdmin) {
      perms = ['tarefas', 'logistica', 'consulta', 'vendedores', 'compras', 'financeiro', 'analista-fin', 'configuracoes'];
    }

    if (mainTabTarefas) mainTabTarefas.style.display = ''; // Sempre visível para todos os colaboradores
    if (mainTabLogistica) mainTabLogistica.style.display = perms.includes('logistica') ? '' : 'none';
    if (mainTabConsulta) mainTabConsulta.style.display = perms.includes('consulta') ? '' : 'none';
    if (mainTabVendedores) mainTabVendedores.style.display = perms.includes('vendedores') ? '' : 'none';
    if (mainTabCompras) mainTabCompras.style.display = perms.includes('compras') ? '' : 'none';
    if (mainTabFinanceiro) mainTabFinanceiro.style.display = perms.includes('financeiro') ? '' : 'none';
    if (mainTabAnalistaFin) mainTabAnalistaFin.style.display = (perms.includes('analista-fin') || perms.includes('financeiro')) ? '' : 'none';
    if (mainTabBi) mainTabBi.style.display = isAdmin ? '' : 'none';
    if (mainTabConfig) mainTabConfig.style.display = perms.includes('configuracoes') ? '' : 'none';

    // Ajusta o escopo de vendedor logado (Juliana, Andrea, Figueiredo)
    try {
      ajustarEscopoVendedor(user);
    } catch {}

    // Sempre direciona para a central "Minhas Tarefas" como tela de pouso pós-login
    if (typeof switchMainTab === 'function') {
      switchMainTab('tarefas');
    }
  }

  function start2FACountdown(durationSeconds = 300) {
    if (twoFactorTimerInterval) clearInterval(twoFactorTimerInterval);
    let remaining = durationSeconds;

    function updateDisplay() {
      const mins = Math.floor(remaining / 60);
      const secs = remaining % 60;
      if (twoFactorTimer) {
        twoFactorTimer.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        if (remaining <= 60) {
          twoFactorTimer.style.color = '#f87171';
        } else {
          twoFactorTimer.style.color = 'var(--text-muted)';
        }
      }
      if (remaining <= 0) {
        clearInterval(twoFactorTimerInterval);
        if (twoFactorErrorMsg) {
          twoFactorErrorMsg.textContent = '⚠️ O código de 4 dígitos expirou. Clique em Reenviar para receber um novo código.';
          twoFactorErrorMsg.classList.remove('hidden');
        }
        if (btnVerify2FA) btnVerify2FA.disabled = true;
      }
      remaining--;
    }

    if (btnVerify2FA) btnVerify2FA.disabled = false;
    updateDisplay();
    twoFactorTimerInterval = setInterval(updateDisplay, 1000);
  }

  function show2FAStep(tempToken, emailMasked) {
    currentTemp2FAToken = tempToken;
    if (loginForm) {
      loginForm.classList.add('hidden');
      loginForm.style.display = 'none';
    }
    if (twoFactorForm) {
      twoFactorForm.classList.remove('hidden');
      twoFactorForm.style.display = 'block';
    }
    if (twoFactorEmailMasked) twoFactorEmailMasked.textContent = emailMasked || 'seu e-mail corporativo';
    if (twoFactorErrorMsg) twoFactorErrorMsg.classList.add('hidden');

    digitInputs.forEach(inp => {
      if (inp) inp.value = '';
    });
    setTimeout(() => {
      if (digitInputs[0]) digitInputs[0].focus();
    }, 100);

    start2FACountdown(300);
  }

  function resetToLoginForm() {
    if (twoFactorTimerInterval) clearInterval(twoFactorTimerInterval);
    currentTemp2FAToken = null;
    if (twoFactorForm) {
      twoFactorForm.classList.add('hidden');
      twoFactorForm.style.display = 'none';
    }
    if (loginForm) {
      loginForm.classList.remove('hidden');
      loginForm.style.display = 'block';
    }
    if (loginPassword) {
      loginPassword.value = '';
      loginPassword.focus();
    }
    if (loginErrorMsg) loginErrorMsg.classList.add('hidden');
  }

  function showLoginOverlay(show) {
    if (!loginOverlay) return;
    if (show) {
      loginOverlay.classList.remove('hidden');
      loginOverlay.style.display = 'flex';
      resetToLoginForm();
      if (loginUsername) loginUsername.value = '';
    } else {
      loginOverlay.classList.add('hidden');
      loginOverlay.style.display = 'none';
    }
  }

  // Configuração dos campos de dígitos OTP (Auto-advance & Paste)
  digitInputs.forEach((input, idx) => {
    if (!input) return;

    input.addEventListener('input', () => {
      const val = input.value.replace(/[^0-9]/g, '');
      input.value = val ? val.slice(-1) : '';

      if (input.value && idx < digitInputs.length - 1) {
        if (digitInputs[idx + 1]) {
          digitInputs[idx + 1].focus();
          digitInputs[idx + 1].select();
        }
      }

      // Se todos os 4 dígitos foram preenchidos, submete automaticamente
      const fullCode = digitInputs.map(d => d ? d.value : '').join('');
      if (fullCode.length === 4) {
        if (twoFactorForm) {
          if (typeof twoFactorForm.requestSubmit === 'function') {
            twoFactorForm.requestSubmit();
          } else {
            twoFactorForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
          }
        }
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value && idx > 0) {
        if (digitInputs[idx - 1]) digitInputs[idx - 1].focus();
      } else if (e.key === 'ArrowLeft' && idx > 0) {
        if (digitInputs[idx - 1]) digitInputs[idx - 1].focus();
      } else if (e.key === 'ArrowRight' && idx < digitInputs.length - 1) {
        if (digitInputs[idx + 1]) digitInputs[idx + 1].focus();
      }
    });

    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasteData = (e.clipboardData || window.clipboardData).getData('text');
      const digits = pasteData.replace(/[^0-9]/g, '').slice(0, 4);
      if (digits) {
        for (let i = 0; i < digits.length; i++) {
          if (digitInputs[i]) digitInputs[i].value = digits[i];
        }
        const nextIdx = Math.min(digits.length, digitInputs.length - 1);
        if (digitInputs[nextIdx]) digitInputs[nextIdx].focus();
        if (digits.length === 4 && twoFactorForm) {
          if (typeof twoFactorForm.requestSubmit === 'function') {
            twoFactorForm.requestSubmit();
          } else {
            twoFactorForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
          }
        }
      }
    });
  });

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

        if (data.success) {
          if (data.require2FA) {
            // Avança para a tela de inserção do código de 4 dígitos
            show2FAStep(data.tempToken, data.emailMasked);
          } else if (data.user && data.token) {
            // Login direto sem 2FA (contas legadas sem e-mail)
            const session = {
              token: data.token,
              user: data.user,
              expiresAt: data.expiresAt || (Date.now() + 7 * 24 * 60 * 60 * 1000)
            };
            localStorage.setItem('conciliacao_fretes_session', JSON.stringify(session));
            showAuthenticatedUser(data.user, data.token);
          }
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
          btnLoginSubmit.textContent = '🔐 Continuar';
        }
      }
    });
  }

  // Handler de Validação do Formulário 2FA
  if (twoFactorForm) {
    twoFactorForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (twoFactorErrorMsg) twoFactorErrorMsg.classList.add('hidden');

      const code = digitInputs.map(d => d ? d.value.trim() : '').join('');
      if (code.length !== 4) {
        if (twoFactorErrorMsg) {
          twoFactorErrorMsg.textContent = '⚠️ Por favor, digite os 4 dígitos do código de segurança.';
          twoFactorErrorMsg.classList.remove('hidden');
        }
        return;
      }

      if (!currentTemp2FAToken) {
        if (twoFactorErrorMsg) {
          twoFactorErrorMsg.textContent = '⚠️ Sessão 2FA expirada. Volte ao login e tente novamente.';
          twoFactorErrorMsg.classList.remove('hidden');
        }
        return;
      }

      if (btnVerify2FA) {
        btnVerify2FA.disabled = true;
        btnVerify2FA.textContent = 'Validando Código...';
      }

      try {
        const res = await fetch('/api/auth/verify-2fa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tempToken: currentTemp2FAToken,
            code: code
          })
        });
        const data = await res.json();

        if (data.success && data.token && data.user) {
          if (twoFactorTimerInterval) clearInterval(twoFactorTimerInterval);
          const session = {
            token: data.token,
            user: data.user,
            expiresAt: data.expiresAt || (Date.now() + 7 * 24 * 60 * 60 * 1000)
          };
          localStorage.setItem('conciliacao_fretes_session', JSON.stringify(session));
          showAuthenticatedUser(data.user, data.token);
        } else {
          if (twoFactorErrorMsg) {
            twoFactorErrorMsg.textContent = `⚠️ ${data.message || 'Código incorreto ou expirado.'}`;
            twoFactorErrorMsg.classList.remove('hidden');
          }
          digitInputs.forEach(d => { if (d) d.value = ''; });
          if (digitInputs[0]) digitInputs[0].focus();
        }
      } catch (err) {
        if (twoFactorErrorMsg) {
          twoFactorErrorMsg.textContent = '❌ Erro de comunicação com o servidor ao validar código.';
          twoFactorErrorMsg.classList.remove('hidden');
        }
      } finally {
        if (btnVerify2FA) {
          btnVerify2FA.disabled = false;
          btnVerify2FA.textContent = '🔓 Confirmar e Entrar';
        }
      }
    });
  }

  // Handler do Botão Voltar ao Login
  if (btnBackToLogin) {
    btnBackToLogin.addEventListener('click', resetToLoginForm);
  }

  // Handler do Botão Reenviar Código 2FA
  if (btnResend2FA) {
    btnResend2FA.addEventListener('click', async () => {
      if (!currentTemp2FAToken) {
        alert('Sessão expirada. Por favor, volte à tela de login.');
        resetToLoginForm();
        return;
      }

      const originalText = btnResend2FA.textContent;
      btnResend2FA.disabled = true;
      btnResend2FA.textContent = 'Enviando...';

      try {
        const res = await fetch('/api/auth/resend-2fa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tempToken: currentTemp2FAToken })
        });
        const data = await res.json();
        if (data.success) {
          alert(`✅ ${data.message || 'Novo código de 4 dígitos enviado para seu e-mail!'}`);
          start2FACountdown(300);
          digitInputs.forEach(d => { if (d) d.value = ''; });
          if (digitInputs[0]) digitInputs[0].focus();
        } else {
          alert(`⚠️ ${data.message || 'Erro ao reenviar código.'}`);
        }
      } catch (err) {
        alert('❌ Falha na conexão ao solicitar reenvio de código.');
      } finally {
        btnResend2FA.disabled = false;
        btnResend2FA.textContent = originalText;
      }
    });
  }

  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      if (confirm('Deseja realmente encerrar sua sessão?')) {
        localStorage.removeItem('conciliacao_fretes_session');
        currentToken = null;
        currentUser = null;
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
  const currentMyPassword = document.getElementById('currentMyPassword');
  const newMyPassword = document.getElementById('newMyPassword');
  const confirmMyPassword = document.getElementById('confirmMyPassword');
  const myPassMsg = document.getElementById('myPassMsg');

  if (btnChangeMyPass) {
    btnChangeMyPass.addEventListener('click', () => {
      if (currentMyPassword) currentMyPassword.value = '';
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
      const curr = currentMyPassword ? currentMyPassword.value.trim() : '';
      const p1 = newMyPassword ? newMyPassword.value.trim() : '';
      const p2 = confirmMyPassword ? confirmMyPassword.value.trim() : '';

      if (!curr) {
        if (myPassMsg) {
          myPassMsg.textContent = '⚠️ Por favor, digite sua senha atual.';
          myPassMsg.classList.remove('hidden');
        }
        return;
      }

      if (p1.length < 4) {
        if (myPassMsg) {
          myPassMsg.textContent = '⚠️ A nova senha deve possuir no mínimo 4 caracteres.';
          myPassMsg.classList.remove('hidden');
        }
        return;
      }

      if (p1 !== p2) {
        if (myPassMsg) {
          myPassMsg.textContent = '⚠️ As novas senhas digitadas não coincidem.';
          myPassMsg.classList.remove('hidden');
        }
        return;
      }

      if (!currentUser) return;

      try {
        const response = await fetch('/api/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            currentPassword: curr,
            newPassword: p1
          })
        });
        const data = await response.json();
        if (data.success) {
          if (myPassMsg) myPassMsg.textContent = '✅ ' + (data.message || 'Sua senha foi alterada com sucesso!');
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
  function switchMainTab(targetMain) {
    mainTabBtns.forEach(b => b.classList.remove('active'));
    
    const subGroupTarefas = document.getElementById('subGroupTarefas');
    const subGroupLogistica = document.getElementById('subGroupLogistica');
    const subGroupConsulta = document.getElementById('subGroupConsulta');
    const subGroupVendedores = document.getElementById('subGroupVendedores');
    const subGroupCompras = document.getElementById('subGroupCompras');
    const subGroupFinanceiro = document.getElementById('subGroupFinanceiro');
    const subGroupAnalistaFin = document.getElementById('subGroupAnalistaFin');
    const subGroupBi = document.getElementById('subGroupBi');
    const subGroupConfiguracoes = document.getElementById('subGroupConfiguracoes');

    // Hide all sub groups
    if (subGroupTarefas) subGroupTarefas.classList.add('hidden');
    if (subGroupLogistica) subGroupLogistica.classList.add('hidden');
    if (subGroupConsulta) subGroupConsulta.classList.add('hidden');
    if (subGroupVendedores) subGroupVendedores.classList.add('hidden');
    if (subGroupCompras) subGroupCompras.classList.add('hidden');
    if (subGroupFinanceiro) subGroupFinanceiro.classList.add('hidden');
    if (subGroupAnalistaFin) subGroupAnalistaFin.classList.add('hidden');
    if (subGroupBi) subGroupBi.classList.add('hidden');
    if (subGroupConfiguracoes) subGroupConfiguracoes.classList.add('hidden');

    tabPanes.forEach(pane => pane.classList.add('hidden'));

    const activeMainBtn = document.querySelector(`.main-tab-btn[data-main-tab="${targetMain}"]`);
    if (activeMainBtn) activeMainBtn.classList.add('active');

    let firstSubBtn = null;

    if (targetMain === 'tarefas') {
      if (subGroupTarefas) subGroupTarefas.classList.remove('hidden');
      firstSubBtn = subGroupTarefas ? subGroupTarefas.querySelector('.nav-tab-btn') : null;
      const targetPane = document.getElementById('tab-minhas-tarefas');
      if (targetPane) targetPane.classList.remove('hidden');
      if (window.tarefasModule && typeof window.tarefasModule.initTarefasModule === 'function') {
        window.tarefasModule.initTarefasModule();
      } else if (typeof window.initTarefasModule === 'function') {
        window.initTarefasModule();
      }
    } else if (targetMain === 'logistica') {
      if (subGroupLogistica) subGroupLogistica.classList.remove('hidden');
      firstSubBtn = subGroupLogistica ? subGroupLogistica.querySelector('.nav-tab-btn') : null;
    } else if (targetMain === 'consulta') {
      if (subGroupConsulta) subGroupConsulta.classList.remove('hidden');
      firstSubBtn = subGroupConsulta ? subGroupConsulta.querySelector('.nav-tab-btn') : null;
    } else if (targetMain === 'vendedores') {
      if (subGroupVendedores) subGroupVendedores.classList.remove('hidden');
      firstSubBtn = subGroupVendedores ? subGroupVendedores.querySelector('.nav-tab-btn') : null;
      initComissaoDates();
    } else if (targetMain === 'compras') {
      if (subGroupCompras) subGroupCompras.classList.remove('hidden');
      firstSubBtn = subGroupCompras ? subGroupCompras.querySelector('.nav-tab-btn') : null;
    } else if (targetMain === 'financeiro') {
      if (subGroupFinanceiro) subGroupFinanceiro.classList.remove('hidden');
      firstSubBtn = subGroupFinanceiro ? subGroupFinanceiro.querySelector('.nav-tab-btn') : null;
      initConciliacaoBancaria();
    } else if (targetMain === 'analista-fin') {
      if (subGroupAnalistaFin) subGroupAnalistaFin.classList.remove('hidden');
      firstSubBtn = subGroupAnalistaFin ? subGroupAnalistaFin.querySelector('.nav-tab-btn') : null;
    } else if (targetMain === 'bi') {
      if (subGroupBi) subGroupBi.classList.remove('hidden');
      firstSubBtn = subGroupBi ? subGroupBi.querySelector('.nav-tab-btn') : null;
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

      if (targetTab === 'tab-minhas-tarefas') {
        if (window.tarefasModule && typeof window.tarefasModule.initTarefasModule === 'function') {
          window.tarefasModule.initTarefasModule();
        }
      }

      if (targetTab === 'tab-bi-indices') {
        if (typeof window.initBIIndicesTab === 'function') {
          window.initBIIndicesTab();
        }
      }
      if (targetTab === 'tab-bi-metabase') {
        if (typeof window.initBITab === 'function') {
          window.initBITab();
        }
      }
      if (targetTab === 'tab-bi-autorizacoes') {
        if (typeof window.initBIAutorizacoesTab === 'function') {
          window.initBIAutorizacoesTab();
        }
      }
      if (targetTab === 'tab-config-logs') {
        loadAuditDashboard();
      }
      if (targetTab === 'tab-analise-credito') {
        carregarHistoricoCredito();
      }
      if (targetTab === 'tab-holerites') {
        if (window.holeritesModule && typeof window.holeritesModule.carregarHolerites === 'function') {
          window.holeritesModule.carregarCompetencias();
          window.holeritesModule.carregarHolerites();
        }
      }
      if (targetTab === 'tab-funcionarios') {
        if (window.funcionariosDpModule && typeof window.funcionariosDpModule.carregarColaboradores === 'function') {
          window.funcionariosDpModule.carregarColaboradores();
        }
      }
      if (targetTab === 'tab-vend-saldos-estoque' || 
          targetTab === 'tab-vend-pedidos' || 
          targetTab === 'tab-vend-pedidos-abertos' || 
          targetTab === 'tab-compras-pedidos-abertos' || 
          targetTab === 'tab-vend-pedidos-compras' || 
          targetTab === 'tab-vend-comissoes') {
        if (typeof inicializarTemaVendedores === 'function') inicializarTemaVendedores();
      }
      if (targetTab === 'tab-vend-saldos-estoque') {
        carregarSaldosEstoque();
      }
      if (targetTab === 'tab-vend-pedidos-abertos') {
        carregarPedidosAbertos();
      }
      if (targetTab === 'tab-compras-pedidos-abertos') {
        carregarPedidosComprasAbertos();
      }
      if (targetTab === 'tab-vend-pedidos-compras') {
        carregarPedidosCompras();
      }
      if (targetTab === 'tab-pedidos-faturar') {
        carregarPedidosFaturar();
      }
      if (targetTab === 'tab-pedidos-lib-estoque') {
        carregarPedidosLibEstoque();
      }
      if (targetTab === 'tab-pedidos-bloq-estoque') {
        carregarPedidosBloqEstoque();
      }
      if (targetTab === 'tab-vend-gordura-frete') {
        if (typeof inicializarTemaVendedores === 'function') inicializarTemaVendedores();
        if (window.GorduraFreteModule && typeof window.GorduraFreteModule.consultar === 'function') {
          window.GorduraFreteModule.consultar();
        }
      }
      if (targetTab === 'tab-vend-fechamento') {
        if (typeof inicializarTemaVendedores === 'function') inicializarTemaVendedores();
        if (window.FechamentoVendedoresModule && typeof window.FechamentoVendedoresModule.carregarFechamentoAtual === 'function') {
          window.FechamentoVendedoresModule.carregarFechamentoAtual();
        }
      }
      if (targetTab === 'tab-config-metas-vendas') {
        if (window.FechamentoVendedoresModule && typeof window.FechamentoVendedoresModule.carregarConfigMetasUI === 'function') {
          window.FechamentoVendedoresModule.carregarConfigMetasUI();
        }
      }
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

  async function uploadFile(file) {
    if (!file) return;
    const tipo = transportadoraSelect ? transportadoraSelect.value : 'RODONAVES';
    showLoading(true, `Lendo Fatura (${file.name}) e consultando Protheus...`);
    const formData = new FormData();
    formData.append('faturaFile', file);
    formData.append('tipoTransportadora', tipo);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      const data = await response.json();
      if (data.success) {
        renderFaturaData(data);
      } else {
        alert(data.message || data.error || 'Erro ao processar fatura.');
      }
    } catch (err) {
      alert('Erro ao conectar com o servidor para enviar a fatura.');
      console.error('Upload Error:', err);
    } finally {
      showLoading(false);
      if (fileInput) fileInput.value = '';
    }
  }

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
          if (vippStatusText) vippStatusText.innerHTML = `Status API ViPP: <strong>🟢 Token Ativo (${escapeHtml(data.config.usuario)})</strong> — Automação WebService Conectada`;
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
        alert('Por favor, selecione um arquivo de Fatura Correios.');
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
        alert(data.message || data.error || 'Erro ao ler a fatura Correios.');
      }
    } catch (err) {
      alert('Erro no upload da Fatura Correios.');
      console.error(err);
    } finally {
      showLoading(false);
    }
  }

  // --- VIPP FTP STATUS & SYNC LOGIC ---
  const btnSyncVippFtp = document.getElementById('btnSyncVippFtp');
  const vippFtpStatusText = document.getElementById('vippFtpStatusText');
  const vippFtpStatusDot = document.getElementById('vippFtpStatusDot');

  async function checkVippFtpStatus() {
    try {
      const res = await fetch('/api/vipp/ftp-status');
      const data = await res.json();
      if (data.success && data.data) {
        const s = data.data;
        if (vippFtpStatusText) {
          const filesTxt = s.filesCount > 0 ? `${s.filesCount} arquivos CSV` : '0 arquivos';
          const postTxt = s.totalPostagens > 0 ? `${s.totalPostagens} postagens (${s.totalEtiquetas} etiquetas únicas)` : '0 postagens';
          vippFtpStatusText.innerHTML = `FTP ViPP (/Retorno): <strong>Conectado e Operacional</strong> <span style="font-size: 0.85rem; color: #94a3b8; margin-left: 8px;">(${filesTxt} • ${postTxt})</span>`;
        }
        if (vippFtpStatusDot) {
          vippFtpStatusDot.style.backgroundColor = s.status === 'error' ? '#ef4444' : '#10b981';
        }
      }
    } catch (e) {
      console.warn('Erro ao consultar status FTP ViPP:', e);
    }
  }

  if (btnSyncVippFtp) {
    btnSyncVippFtp.addEventListener('click', async () => {
      const originalHtml = btnSyncVippFtp.innerHTML;
      btnSyncVippFtp.disabled = true;
      btnSyncVippFtp.innerHTML = '<span>⏳ Sincronizando...</span>';
      try {
        const res = await fetch('/api/vipp/sync-ftp', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          alert(`✅ FTP ViPP Sincronizado com Sucesso!\n\n• Arquivos Baixados: ${data.data.files ? data.data.files.length : 0}\n• Total de Postagens: ${data.data.totalPostagens || 0}\n• Etiquetas Únicas: ${data.data.totalEtiquetas || 0}`);
          await checkVippFtpStatus();
          if (currentItems && currentItems.length > 0) {
            renderTableRows();
          }
        } else {
          alert(`Aviso na sincronização ViPP: ${data.data?.warning || data.error || 'Não foi possível atualizar o FTP'}`);
        }
      } catch (err) {
        alert('Erro ao comunicar com o servidor para sincronização do FTP ViPP.');
      } finally {
        btnSyncVippFtp.disabled = false;
        btnSyncVippFtp.innerHTML = originalHtml;
      }
    });
  }

  // Executa checagem de status na inicialização
  checkVippFtpStatus();

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
    sumCnpj.innerHTML = `Pagador: <strong>${escapeHtml(empNome)}</strong> <span class="ped-venda-badge" style="margin-left: 8px;">Protheus Empresa ${escapeHtml(empCod)} (${escapeHtml(currentFatura.empresaKey || 'OACO')})</span>`;
    sumFaturaNum.textContent = currentFatura.numeroFatura;
    const sumVencimentoVal = document.getElementById('sumVencimentoVal');
    const sumEmissao = document.getElementById('sumEmissao');
    if (sumVencimentoVal) sumVencimentoVal.textContent = currentFatura.dataVencimento || 'N/A';
    if (sumEmissao) sumEmissao.textContent = `Emissão: ${currentFatura.dataEmissao || 'N/A'}`;
    if (sumDatas) sumDatas.textContent = `Emissão: ${currentFatura.dataEmissao} | Venc: ${currentFatura.dataVencimento}`;
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

    // Identificação: Ordem de Serviço (OS)
    if (item.tipoDoc === 'OS' || (item.docOriginario && String(item.docOriginario).toUpperCase().startsWith('OS'))) {
      return {
        type: 'os',
        orderPriority: 4,
        badgeHtml: `<span class="diverg-badge" style="background: rgba(139, 92, 246, 0.15); color: #c084fc; border: 1px solid rgba(139, 92, 246, 0.35);">🔧 OS (Sem Cobrança)</span>`,
        diffVal: 0
      };
    }

    // Identificação: Objeto Sem Informação no ViPP ainda
    if (item.tipoDoc === 'SEM_INFO' || item.docOriginario === 'Sem Info' || item.status === 'Sem Info') {
      return {
        type: 'seminfo',
        orderPriority: 1,
        badgeHtml: `<span class="diverg-badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35);">⚠️ Sem Info</span>`,
        diffVal: 0
      };
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
      else if (divInfo.type === 'warning' || divInfo.type === 'seminfo') cntWarning++;
      else if (divInfo.type === 'success' || divInfo.type === 'info' || divInfo.type === 'os') cntSuccess++;
    });

    // Atualizar estatísticas dos cartões no topo
    if (cntDivergDanger) cntDivergDanger.textContent = cntDanger;
    if (cntDivergWarning) cntDivergWarning.textContent = cntWarning;
    if (cntDivergSuccess) cntDivergSuccess.textContent = cntSuccess;

    // Clonar e ordenar por prioridade de divergência (Divergentes Prejuízo -> Warning/SemInfo -> Info -> Success -> OS)
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
          (item.codCli && item.codCli.toLowerCase().includes(filterText)) ||
          (item.cliente && item.cliente.toLowerCase().includes(filterText))
        );
        if (!matchesText) return false;
      }
      if (activeStatusFilter === 'danger') return item._divInfo.type === 'danger';
      if (activeStatusFilter === 'warning') return item._divInfo.type === 'warning';
      if (activeStatusFilter === 'seminfo') return item._divInfo.type === 'seminfo';
      if (activeStatusFilter === 'os') return item._divInfo.type === 'os';
      if (activeStatusFilter === 'success') return item._divInfo.type === 'success' || item._divInfo.type === 'info';
      return true;
    });

    filteredItems.forEach((item) => {
      totalCobrado += item.valorCobrado || 0;

      const realIndex = currentItems.indexOf(item);
      const freteProtheusTotal = item.freteProtheusTotal || ((item.freteCobradoProtheus || 0) + (item.freteEmbutidoProtheus || 0));
      const isSemInfo = item.docOriginario === 'Sem Info' || item.tipoDoc === 'SEM_INFO';
      const isOS = item.tipoDoc === 'OS' || (item.docOriginario && String(item.docOriginario).toUpperCase().startsWith('OS'));

      let displayDocVal = item.docOriginario || '';
      if (displayDocVal && /^\d+$/.test(displayDocVal)) {
        displayDocVal = displayDocVal.padStart(9, '0');
      }

      const inputStyle = isSemInfo 
        ? 'color: #fbbf24; border-color: rgba(245, 158, 11, 0.5); background: rgba(245, 158, 11, 0.08);' 
        : (isOS ? 'color: #c084fc; border-color: rgba(139, 92, 246, 0.5);' : '');

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="badge-doc">${escapeHtml(item.doc)}</span></td>
        <td class="mono-text"><strong>${escapeHtml(item.numFrete)}</strong></td>
        <td>
          <input 
            type="text" 
            class="editable-input ${item.isEdited ? 'edited' : ''}" 
            style="${inputStyle}"
            value="${escapeHtml(displayDocVal)}" 
            data-index="${realIndex}"
            placeholder="Digite NF ou Pedido"
            title="Clique para editar a NF ou Pedido (Busca Protheus automática)"
          />
        </td>
        <td><span class="ped-venda-badge">${escapeHtml(item.pedVenda || 'N/A')}</span></td>
        <td class="mono-text"><strong>${formatCurrency(freteProtheusTotal)}</strong></td>
        <td class="mono-text"><strong>${formatCurrency(item.valorCobrado)}</strong></td>
        <td>${item._divInfo.badgeHtml}</td>
        <td class="mono-text"><span class="ped-venda-badge">${escapeHtml(item.codCli || '—')}</span></td>
        <td>${escapeHtml(item.cliente)}</td>
      `;
      ctesTableBody.appendChild(tr);
    });

    document.querySelectorAll('.editable-input').forEach(input => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.target.blur();
        }
      });

      input.addEventListener('change', async (e) => {
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        const rawVal = e.target.value.trim();

        if (!rawVal || rawVal.toLowerCase() === 'sem info') {
          currentItems[idx].docOriginario = 'Sem Info';
          currentItems[idx].tipoDoc = 'SEM_INFO';
          currentItems[idx].pedVenda = 'Sem Info';
          currentItems[idx].codCli = '';
          currentItems[idx].freteCobradoProtheus = 0;
          currentItems[idx].freteEmbutidoProtheus = 0;
          currentItems[idx].freteProtheusTotal = 0;
          currentItems[idx].protheusEncontrado = false;
          currentItems[idx].isEdited = true;
          renderTableRows();
          return;
        }

        if (rawVal.toUpperCase().startsWith('OS')) {
          const osMatch = rawVal.match(/\bOS\s*(\d+)/i);
          const osNum = osMatch ? osMatch[1] : rawVal.replace(/\D/g, '');
          currentItems[idx].docOriginario = `OS ${osNum}`;
          currentItems[idx].tipoDoc = 'OS';
          currentItems[idx].osNum = osNum;
          currentItems[idx].pedVenda = 'N/A (OS)';
          currentItems[idx].codCli = '';
          currentItems[idx].freteCobradoProtheus = 0;
          currentItems[idx].freteEmbutidoProtheus = 0;
          currentItems[idx].freteProtheusTotal = 0;
          currentItems[idx].protheusEncontrado = true;
          currentItems[idx].isEdited = true;
          renderTableRows();
          return;
        }

        const cleanDigits = rawVal.replace(/\D/g, '');
        const queryTerm = cleanDigits || rawVal;
        const newNf = cleanDigits ? cleanDigits.padStart(9, '0') : rawVal;
        currentItems[idx].docOriginario = newNf;
        currentItems[idx].isEdited = true;
        e.target.classList.add('edited');

        try {
          const empKey = currentFatura.empresaKey || 'OACO';
          const res = await fetch(`/api/protheus/consulta/${encodeURIComponent(queryTerm)}?empresa=${empKey}`);
          const resData = await res.json();
          if (resData.success && resData.data && resData.data.encontrado) {
            currentItems[idx].docOriginario = resData.data.nfDoc ? (resData.data.nfDoc.length === 6 ? resData.data.nfDoc.padStart(9, '0') : resData.data.nfDoc) : newNf;
            currentItems[idx].pedVenda = resData.data.pedVenda;
            currentItems[idx].codCli = resData.data.codCli || '';
            currentItems[idx].freteCobradoProtheus = resData.data.freteCobrado;
            currentItems[idx].freteEmbutidoProtheus = resData.data.freteEmbutido;
            currentItems[idx].freteProtheusTotal = resData.data.freteProtheusTotal;
            currentItems[idx].protheusEncontrado = true;
            currentItems[idx].tipoDoc = 'NF';
            if (resData.data.nomeCli) currentItems[idx].cliente = resData.data.nomeCli;
          } else {
            currentItems[idx].pedVenda = 'N/A';
            currentItems[idx].codCli = '';
            currentItems[idx].freteCobradoProtheus = 0;
            currentItems[idx].freteEmbutidoProtheus = 0;
            currentItems[idx].freteProtheusTotal = 0;
            currentItems[idx].protheusEncontrado = false;
          }
          renderTableRows();
        } catch (err) {
          console.error('Erro na requisição ao Protheus:', err);
          currentItems[idx].protheusEncontrado = false;
          currentItems[idx].codCli = '';
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
    let csv = 'DOC;Num Frete;Doc (NF);Ped Venda;Cobrado Cli.;Valor Transp.;Divergencia;Data Vencimento;CodCli;Cliente\n';
    currentItems.forEach(i => {
      const fTotal = i.freteProtheusTotal || ((i.freteCobradoProtheus || 0) + (i.freteEmbutidoProtheus || 0));
      const divLabel = (i._divInfo && i._divInfo.type === 'danger') ? `Prejuizo +${i._divInfo.diffVal}` : (i._divInfo && i._divInfo.type === 'info') ? `Sobra ${Math.abs(i._divInfo.diffVal)}` : 'OK';
      csv += `"${i.doc}";"${i.numFrete}";"${i.docOriginario}";"${i.pedVenda}";"${fTotal}";"${i.valorCobradoStr || i.valorCobrado}";"${divLabel}";"${i.dataVencimento || currentFatura.dataVencimento}";"${i.codCli || ''}";"${i.cliente}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `Conciliacao_Protheus_Fatura_${currentFatura.numeroFatura}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });

  const btnClearFatura = document.getElementById('btnClearFatura');
  if (btnClearFatura) {
    btnClearFatura.addEventListener('click', () => {
      if (confirm('Deseja limpar todos os dados da conferência e carregar uma nova fatura?')) {
        currentFatura = null;
        currentItems = [];
        filterText = '';
        activeStatusFilter = 'all';

        if (faturaSummary) faturaSummary.classList.add('hidden');
        if (tableSection) tableSection.classList.add('hidden');
        if (dropzone) dropzone.classList.remove('hidden');
        if (loadingState) loadingState.classList.add('hidden');
        if (fileInput) fileInput.value = '';
        if (tableSearch) tableSearch.value = '';
        if (tolerancyInput) tolerancyInput.value = '0.00';

        if (filterChips) {
          filterChips.forEach(c => c.classList.remove('active'));
          const allChip = document.querySelector('.filter-chip[data-filter="all"]');
          if (allChip) allChip.classList.add('active');
        }

        const ctesTableBody = document.getElementById('ctesTableBody');
        if (ctesTableBody) ctesTableBody.innerHTML = '';

        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  }

  btnLancarProtheus.disabled = true;
  btnLancarProtheus.addEventListener('click', (e) => {
    e.preventDefault();
    alert('A gravação automática de fretes no Protheus está desabilitada por enquanto (módulo em homologação). Utilize a consulta e a exportação em CSV para conferência.');
  });

  // --- TAB 3 LOGIC (CONSULTA NFE, PEDIDO OU CÓDIGO WEB) ---
  function updateSearchInputsState() {
    const codWebValue = searchCodWeb ? searchCodWeb.value.trim() : '';
    const pedValue = searchPedVenda ? searchPedVenda.value.trim() : '';
    const nfeValue = searchNFe ? searchNFe.value.trim() : '';

    if (codWebValue !== '') {
      if (searchPedVenda) {
        searchPedVenda.disabled = true;
        searchPedVenda.placeholder = 'Bloqueado (Cód. Web preenchido)';
      }
      if (tagPedVenda) {
        tagPedVenda.textContent = 'Bloqueado';
        tagPedVenda.classList.add('blocked');
      }

      if (searchNFe) {
        searchNFe.disabled = true;
        searchNFe.placeholder = 'Bloqueado (Cód. Web preenchido)';
      }
      if (tagNFe) {
        tagNFe.textContent = 'Bloqueado';
        tagNFe.classList.add('blocked');
      }

      if (searchCodWeb) searchCodWeb.disabled = false;
      if (tagCodWeb) {
        tagCodWeb.textContent = 'Ativo';
        tagCodWeb.classList.remove('blocked');
      }
    } else if (pedValue !== '') {
      if (searchCodWeb) {
        searchCodWeb.disabled = true;
        searchCodWeb.placeholder = 'Bloqueado (Pedido preenchido)';
      }
      if (tagCodWeb) {
        tagCodWeb.textContent = 'Bloqueado';
        tagCodWeb.classList.add('blocked');
      }

      if (searchNFe) {
        searchNFe.disabled = true;
        searchNFe.placeholder = 'Bloqueado (Pedido preenchido)';
      }
      if (tagNFe) {
        tagNFe.textContent = 'Bloqueado';
        tagNFe.classList.add('blocked');
      }

      if (searchPedVenda) searchPedVenda.disabled = false;
      if (tagPedVenda) {
        tagPedVenda.textContent = 'Ativo';
        tagPedVenda.classList.remove('blocked');
      }
    } else if (nfeValue !== '') {
      if (searchCodWeb) {
        searchCodWeb.disabled = true;
        searchCodWeb.placeholder = 'Bloqueado (NFe preenchida)';
      }
      if (tagCodWeb) {
        tagCodWeb.textContent = 'Bloqueado';
        tagCodWeb.classList.add('blocked');
      }

      if (searchPedVenda) {
        searchPedVenda.disabled = true;
        searchPedVenda.placeholder = 'Bloqueado (NFe preenchida)';
      }
      if (tagPedVenda) {
        tagPedVenda.textContent = 'Bloqueado';
        tagPedVenda.classList.add('blocked');
      }

      if (searchNFe) searchNFe.disabled = false;
      if (tagNFe) {
        tagNFe.textContent = 'Ativo';
        tagNFe.classList.remove('blocked');
      }
    } else {
      if (searchCodWeb) {
        searchCodWeb.disabled = false;
        searchCodWeb.placeholder = 'Ex: 98412 ou WEB-98412';
      }
      if (tagCodWeb) {
        tagCodWeb.textContent = 'Ativo';
        tagCodWeb.classList.remove('blocked');
      }

      if (searchPedVenda) {
        searchPedVenda.disabled = false;
        searchPedVenda.placeholder = 'Ex: 000630 ou 630';
      }
      if (tagPedVenda) {
        tagPedVenda.textContent = 'Ativo';
        tagPedVenda.classList.remove('blocked');
      }

      if (searchNFe) {
        searchNFe.disabled = false;
        searchNFe.placeholder = 'Ex: 546 ou 000000546';
      }
      if (tagNFe) {
        tagNFe.textContent = 'Ativo';
        tagNFe.classList.remove('blocked');
      }
    }
  }

  if (searchCodWeb) searchCodWeb.addEventListener('input', updateSearchInputsState);
  if (searchPedVenda) searchPedVenda.addEventListener('input', updateSearchInputsState);
  if (searchNFe) searchNFe.addEventListener('input', updateSearchInputsState);

  // Gatilho tecla Enter nos 3 campos de busca
  [searchCodWeb, searchPedVenda, searchNFe].forEach(input => {
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (btnBuscarConsulta) btnBuscarConsulta.click();
        }
      });
    }
  });

  if (btnLimparConsulta) {
    btnLimparConsulta.addEventListener('click', () => {
      if (searchCodWeb) searchCodWeb.value = '';
      if (searchPedVenda) searchPedVenda.value = '';
      if (searchNFe) searchNFe.value = '';
      updateSearchInputsState();
      consultaResultsSection.classList.add('hidden');
      consultaEmptyState.innerHTML = `
        <div class="empty-icon">🔍</div>
        <h4>Nenhuma busca realizada ainda</h4>
        <p>Preencha o <strong>Código Web Pipe</strong>, o <strong>Número do Pedido de Venda</strong> ou o <strong>Número da NFe</strong> acima e clique em <strong>Buscar</strong> para visualizar os resultados multi-empresa.</p>
      `;
      consultaEmptyState.classList.remove('hidden');
      if (consultaTableBody) consultaTableBody.innerHTML = '';
    });
  }

  if (btnBuscarConsulta) {
    btnBuscarConsulta.addEventListener('click', async () => {
      const codWebValue = searchCodWeb ? searchCodWeb.value.trim() : '';
      const pedValue = searchPedVenda ? searchPedVenda.value.trim() : '';
      const nfeValue = searchNFe ? searchNFe.value.trim() : '';

      if (!codWebValue && !pedValue && !nfeValue) {
        alert('Por favor, preencha o Código Web Pipe, o Número do Pedido de Venda OU o Número da NFe para buscar.');
        return;
      }

      let tipo = 'codWeb';
      let termo = codWebValue;
      if (pedValue) {
        tipo = 'pedVenda';
        termo = pedValue;
      } else if (nfeValue) {
        tipo = 'nfe';
        termo = nfeValue;
      }

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

  function getTipoDescricao(tipo) {
    if (tipo === 'codWeb') return 'Código Web Pipe';
    if (tipo === 'pedVenda') return 'Pedido de Venda';
    return 'Número da NFe';
  }

  function renderConsultaResults(rows, tipo, termo) {
    consultaTableBody.innerHTML = '';
    
    rows.forEach(row => {
      const tr = document.createElement('tr');
      const codWebText = row.codWeb && row.codWeb !== '-' ? row.codWeb : '-';
      const codWebHtml = codWebText !== '-'
        ? `<span class="badge-tag" style="background: rgba(56, 189, 248, 0.12); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.25); font-weight: 600; padding: 2px 8px; border-radius: 4px;">${escapeHtml(codWebText)}</span>`
        : `<span style="color: var(--text-muted);">-</span>`;

      tr.innerHTML = `
        <td><span class="badge-doc">${escapeHtml(row.empresa)}</span></td>
        <td class="mono-text">${codWebHtml}</td>
        <td><span class="ped-venda-badge">${escapeHtml(row.pedVenda || '-')}</span></td>
        <td class="mono-text"><strong>${escapeHtml(row.nf || '-')}</strong></td>
        <td class="mono-text"><strong>${formatCurrency(row.valorNf || 0)}</strong></td>
        <td class="mono-text"><strong>${formatCurrency(row.valorCobrado || 0)}</strong></td>
        <td><strong>${escapeHtml(row.nomeCli || '-')}</strong></td>
      `;
      consultaTableBody.appendChild(tr);
    });

    resultsCountBadge.textContent = `${rows.length} ${rows.length === 1 ? 'registro encontrado' : 'registros encontrados'}`;
    searchParamInfo.innerHTML = `Busca realizada por: <strong>${getTipoDescricao(tipo)} (${escapeHtml(termo)})</strong>`;

    consultaEmptyState.classList.add('hidden');
    consultaResultsSection.classList.remove('hidden');
  }

  function renderConsultaEmptyResults(tipo, termo) {
    consultaTableBody.innerHTML = '';
    resultsCountBadge.textContent = '0 registros encontrados';
    searchParamInfo.innerHTML = `Busca por <strong>${getTipoDescricao(tipo)} (${escapeHtml(termo)})</strong>`;
    
    consultaEmptyState.innerHTML = `
      <div class="empty-icon">⚠️</div>
      <h4>Nenhum registro encontrado</h4>
      <p>Não foram encontrados dados no Protheus para o ${getTipoDescricao(tipo)} "<strong>${escapeHtml(termo)}</strong>". Tente outro termo de busca.</p>
    `;
    consultaEmptyState.classList.remove('hidden');
    consultaResultsSection.classList.add('hidden');
  }

  // --- MODALS HANDLER ---
  if (btnOpenHistory) {
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
                <span class="history-card-title">${escapeHtml(item.transportadora)} — Fatura ${escapeHtml(item.faturaNumero)}</span>
                <span class="status-badge sucesso">✓ Integrado na Empresa ${escapeHtml(item.empresaCodigo || '16')}</span>
              </div>
              <div class="history-card-meta">
                <span>🏢 Pagador: <strong>${escapeHtml(item.pagador || 'OACO')}</strong></span> | 
                <span>📅 Data Integração: ${escapeHtml(item.dataIntegracao)}</span> | 
                <span>⏳ Vencimento: <strong>${escapeHtml(item.dataVencimento || '31/07/2026')}</strong></span> | 
                <span>📦 ${escapeHtml(item.totalFretes)} CT-es</span> | 
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
  }

  if (btnCloseModal) btnCloseModal.addEventListener('click', () => resultModal.classList.add('hidden'));
  if (btnConfirmModal) btnConfirmModal.addEventListener('click', () => resultModal.classList.add('hidden'));
  if (btnCloseHistoryModal) btnCloseHistoryModal.addEventListener('click', () => historyModal.classList.add('hidden'));
  if (btnConfirmHistoryModal) btnConfirmHistoryModal.addEventListener('click', () => historyModal.classList.add('hidden'));

  // --- USER MANAGEMENT (TAB CONFIGURAÇÕES) ---
  const btnNewUser = document.getElementById('btnNewUser');
  const userModal = document.getElementById('userModal');
  const btnCloseUserModal = document.getElementById('btnCloseUserModal');
  const btnCancelUserModal = document.getElementById('btnCancelUserModal');
  const userForm = document.getElementById('userForm');
  const userModalTitle = document.getElementById('userModalTitle');

  const editUsername = document.getElementById('editUsername');
  const editName = document.getElementById('editName');
  const editEmail = document.getElementById('editEmail');
  const editPassword = document.getElementById('editPassword');
  const editRole = document.getElementById('editRole');
  const editVendorCode = document.getElementById('editVendorCode');
  const editVendorCodeGroup = document.getElementById('editVendorCodeGroup');
  const permLogistica = document.getElementById('permLogistica');
  const permConsulta = document.getElementById('permConsulta');
  const permVendedores = document.getElementById('permVendedores');
  const permCompras = document.getElementById('permCompras');
  const permFinanceiro = document.getElementById('permFinanceiro');
  const permAnalistaFin = document.getElementById('permAnalistaFin');
  const permConfiguracoes = document.getElementById('permConfiguracoes');
  const userModalMsg = document.getElementById('userModalMsg');
  const usersTableBody = document.getElementById('usersTableBody');

  let currentUsersData = [];

  async function loadUsersTable() {
    if (!usersTableBody) return;
    usersTableBody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 1rem;">Carregando lista de usuários...</td></tr>';

    try {
      const response = await fetch('/api/admin/users');
      const data = await response.json();
      if (data.success && data.users) {
        currentUsersData = data.users;
        renderUsersTable(data.users);
      } else {
        usersTableBody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--accent-rose);">Erro ao carregar usuários.</td></tr>';
      }
    } catch (err) {
      usersTableBody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--accent-rose);">Erro de conexão com o servidor.</td></tr>';
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
        perms.includes('vendedores') ? '<span class="perm-badge perm-badge-vendedores">💼 Vendedores</span>' : '',
        perms.includes('compras') ? '<span class="perm-badge perm-badge-compras">🛒 Compras</span>' : '',
        perms.includes('financeiro') ? '<span class="perm-badge perm-badge-financeiro">💰 Assist. Financ.</span>' : '',
        perms.includes('configuracoes') ? '<span class="perm-badge perm-badge-configuracoes">⚙️ Configurações</span>' : ''
      ].filter(Boolean).join(' ');

      const isMainAdmin = u.username.toLowerCase() === 'alexandre';

      let roleLabel = 'Operador';
      if (u.role === 'admin') roleLabel = 'Administrador';
      if (u.role === 'vendedor') roleLabel = `Vendedor (${u.vendorCode || 'S/C'})`;

      const emailHtml = u.email 
        ? `<span style="font-size: 0.84rem; color: #38bdf8; font-family: var(--font-mono);">${escapeHtml(u.email)}</span>` 
        : `<span class="badge" style="background: rgba(245, 158, 11, 0.12); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); font-size: 0.75rem;">⚠️ Sem E-mail</span>`;

      tr.innerHTML = `
        <td><strong>${escapeHtml(u.username)}</strong></td>
        <td>${escapeHtml(u.name)}</td>
        <td>${emailHtml}</td>
        <td><span class="status-badge ${u.role === 'admin' ? 'sucesso' : (u.role === 'vendedor' ? 'pendente' : 'neutro')}">${roleLabel}</span></td>
        <td>${permsHtml || '<em style="color: var(--text-muted);">Nenhuma</em>'}</td>
        <td><span class="status-badge ${u.active ? 'sucesso' : 'divergente'}">${u.active ? 'Ativo' : 'Inativo'}</span></td>
        <td style="text-align: right;">
          <button class="btn btn-outline btn-sm btn-edit-user" data-user="${escapeHtml(u.username)}" title="Editar Usuário / Permissões">✏️ Editar</button>
          ${!isMainAdmin ? `<button class="btn btn-outline btn-sm btn-delete-user" data-user="${escapeHtml(u.username)}" style="color: var(--accent-rose); border-color: rgba(244, 63, 94, 0.3);" title="Excluir Usuário">🗑️</button>` : ''}
        </td>
      `;

      usersTableBody.appendChild(tr);
    });
  }

  // Event Delegation para ações da tabela de usuários (Prevenção de vazamento de memória)
  if (usersTableBody) {
    usersTableBody.addEventListener('click', async (e) => {
      const btnEdit = e.target.closest('.btn-edit-user');
      if (btnEdit) {
        const uname = btnEdit.getAttribute('data-user');
        const userObj = currentUsersData.find(x => x.username.toLowerCase() === uname.toLowerCase());
        if (userObj) openUserModalForEdit(userObj);
        return;
      }

      const btnDel = e.target.closest('.btn-delete-user');
      if (btnDel) {
        const uname = btnDel.getAttribute('data-user');
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
          } catch (err) {
            alert('Erro ao excluir usuário.');
          }
        }
      }
    });
  }

  function openUserModalForNew() {
    if (userModalTitle) userModalTitle.textContent = '➕ Cadastrar Novo Usuário';
    if (editUsername) { editUsername.value = ''; editUsername.disabled = false; }
    if (editName) editName.value = '';
    if (editEmail) editEmail.value = '';
    if (editPassword) editPassword.value = '';
    if (editRole) editRole.value = 'user';
    if (editVendorCode) editVendorCode.value = '';
    if (editVendorCodeGroup) editVendorCodeGroup.style.display = 'none';
    if (permLogistica) permLogistica.checked = true;
    if (permConsulta) permConsulta.checked = true;
    if (permVendedores) permVendedores.checked = true;
    if (permCompras) permCompras.checked = true;
    if (permFinanceiro) permFinanceiro.checked = false;
    if (permAnalistaFin) permAnalistaFin.checked = false;
    if (permConfiguracoes) permConfiguracoes.checked = false;
    if (userModalMsg) userModalMsg.classList.add('hidden');
    if (userModal) userModal.classList.remove('hidden');
  }

  function openUserModalForEdit(userObj) {
    if (userModalTitle) userModalTitle.textContent = `✏️ Editar Usuário: ${userObj.username}`;
    if (editUsername) { editUsername.value = userObj.username; editUsername.disabled = true; }
    if (editName) editName.value = userObj.name;
    if (editEmail) editEmail.value = userObj.email || '';
    if (editPassword) editPassword.value = '';
    if (editRole) editRole.value = userObj.role || 'user';

    const vCode = userObj.vendorCode || (VENDEDOR_USERS[userObj.username.toLowerCase()] || '');
    if (editVendorCode) editVendorCode.value = vCode;
    if (editVendorCodeGroup) {
      editVendorCodeGroup.style.display = (userObj.role === 'vendedor') ? 'block' : 'none';
    }

    const perms = userObj.permissions || ['logistica', 'consulta'];
    if (permLogistica) permLogistica.checked = perms.includes('logistica');
    if (permConsulta) permConsulta.checked = perms.includes('consulta');
    if (permVendedores) permVendedores.checked = perms.includes('vendedores');
    if (permCompras) permCompras.checked = perms.includes('compras');
    if (permFinanceiro) permFinanceiro.checked = perms.includes('financeiro');
    if (permAnalistaFin) permAnalistaFin.checked = perms.includes('analista-fin') || perms.includes('financeiro');
    if (permConfiguracoes) permConfiguracoes.checked = perms.includes('configuracoes');

    if (userModalMsg) userModalMsg.classList.add('hidden');
    if (userModal) userModal.classList.remove('hidden');
  }

  if (editRole) {
    editRole.addEventListener('change', () => {
      if (editVendorCodeGroup) {
        editVendorCodeGroup.style.display = (editRole.value === 'vendedor') ? 'block' : 'none';
      }
      if (editRole.value === 'vendedor' && editUsername && editVendorCode && !editVendorCode.value) {
        const u = editUsername.value.trim().toLowerCase();
        if (VENDEDOR_USERS[u]) editVendorCode.value = VENDEDOR_USERS[u];
      }
    });
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
      if (permVendedores && permVendedores.checked) selectedPerms.push('vendedores');
      if (permCompras && permCompras.checked) selectedPerms.push('compras');
      if (permFinanceiro && permFinanceiro.checked) selectedPerms.push('financeiro');
      if (permAnalistaFin && permAnalistaFin.checked) selectedPerms.push('analista-fin');
      if (permConfiguracoes && permConfiguracoes.checked) selectedPerms.push('configuracoes');

      if (selectedPerms.length === 0) {
        if (userModalMsg) {
          userModalMsg.textContent = '⚠️ Selecione ao menos 1 aba de permissão para o usuário.';
          userModalMsg.classList.remove('hidden');
        }
        return;
      }

      const payload = {
        username: editUsername.value.trim(),
        name: editName.value.trim(),
        email: editEmail ? editEmail.value.trim() : '',
        pass: editPassword.value.trim(),
        role: editRole.value,
        vendorCode: (editRole.value === 'vendedor' && editVendorCode) ? editVendorCode.value.trim() : (editVendorCode ? editVendorCode.value.trim() : null),
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

  // --- SUB-ABA: ATIVIDADES & AUDITORIA DE USO DOS USUÁRIOS ---
  const btnRefreshAudit = document.getElementById('btnRefreshAudit');
  const auditDbBadge = document.getElementById('auditDbBadge');
  const statAuditActiveUsers = document.getElementById('statAuditActiveUsers');
  const statAuditTotalUsers = document.getElementById('statAuditTotalUsers');
  const statAuditTotalActions = document.getElementById('statAuditTotalActions');
  const auditUsersTableBody = document.getElementById('auditUsersTableBody');
  const auditActivitiesTableBody = document.getElementById('auditActivitiesTableBody');

  if (btnRefreshAudit) {
    btnRefreshAudit.addEventListener('click', () => {
      loadAuditDashboard();
    });
  }

  function formatTimeAgo(isoString) {
    if (!isoString) return '<span style="color: var(--text-muted);">Nunca acessou</span>';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '<span style="color: var(--text-muted);">Nunca acessou</span>';

    const now = new Date();
    let diffSec = Math.floor((now - date) / 1000);
    if (diffSec < 0) diffSec = 0;
    
    const formattedDate = date.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    if (diffSec < 60) return `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);">Online agora</span> <small style="color: var(--text-muted); margin-left: 4px;">(${formattedDate})</small>`;
    if (diffSec < 3600) {
      const mins = Math.floor(diffSec / 60);
      return `<span style="color: #38bdf8; font-weight: 600;">Há ${mins} min</span> <small style="color: var(--text-muted); margin-left: 4px;">(${formattedDate})</small>`;
    }
    if (diffSec < 86400) {
      const hours = Math.floor(diffSec / 3600);
      return `<span style="color: var(--text-secondary);">Há ${hours} h</span> <small style="color: var(--text-muted); margin-left: 4px;">(${formattedDate})</small>`;
    }
    const days = Math.floor(diffSec / 86400);
    return `<span style="color: var(--text-secondary);">Há ${days} dia(s)</span> <small style="color: var(--text-muted); margin-left: 4px;">(${formattedDate})</small>`;
  }

  function getActionBadge(actionType) {
    const type = String(actionType || '').toUpperCase();
    if (type === 'LOGIN') {
      return `<span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3);">🔑 Login</span>`;
    }
    if (type === 'CONSULTA_PED_NF' || type === 'CONSULTA_PEDIDOS') {
      return `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);">🔍 Consulta Pedido</span>`;
    }
    if (type === 'DETALHES_PEDIDO') {
      return `<span class="badge" style="background: rgba(129, 140, 248, 0.15); color: #818cf8; border: 1px solid rgba(129, 140, 248, 0.3);">📄 Detalhes Pedido</span>`;
    }
    if (type === 'CONSULTA_COMISSOES') {
      return `<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3);">💰 Comissões</span>`;
    }
    if (type === 'UPLOAD_FATURA') {
      return `<span class="badge" style="background: rgba(236, 72, 153, 0.15); color: #ec4899; border: 1px solid rgba(236, 72, 153, 0.3);">📦 Upload Fatura</span>`;
    }
    return `<span class="badge" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.3);">${type}</span>`;
  }

  async function loadAuditDashboard() {
    if (!auditUsersTableBody || !auditActivitiesTableBody) return;

    try {
      auditUsersTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">Carregando resumo dos usuários...</td></tr>`;
      auditActivitiesTableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">Carregando feed de atividades...</td></tr>`;

      const response = await fetch('/api/admin/audit-summary');
      const data = await response.json();

      if (data.success) {
        if (auditDbBadge) {
          if (data.dbConnected) {
            auditDbBadge.textContent = '🟢 Supabase PostgreSQL Ativo';
            auditDbBadge.style.color = '#10b981';
            auditDbBadge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
          } else {
            auditDbBadge.textContent = '🟡 Modo Contingência Local';
            auditDbBadge.style.color = '#f59e0b';
            auditDbBadge.style.borderColor = 'rgba(245, 158, 11, 0.3)';
          }
        }

        const usersList = data.users || [];
        const activitiesList = data.recentActivities || [];

        const activeCount = usersList.filter(u => (parseInt(u.totalActions, 10) || 0) > 0 || u.lastActiveAt).length;
        const totalActionsSum = usersList.reduce((acc, curr) => acc + (parseInt(curr.totalActions, 10) || 0), 0);

        if (statAuditActiveUsers) statAuditActiveUsers.textContent = activeCount;
        if (statAuditTotalUsers) statAuditTotalUsers.textContent = `Total: ${usersList.length} usuários cadastrados`;
        if (statAuditTotalActions) statAuditTotalActions.textContent = totalActionsSum;

        // Renderiza Tabela de Usuários
        if (usersList.length === 0) {
          auditUsersTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">Nenhum usuário cadastrado.</td></tr>`;
        } else {
          auditUsersTableBody.innerHTML = usersList.map(u => {
            const roleBadge = u.role === 'admin' 
              ? '<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3);">Admin</span>'
              : (u.role === 'vendedor' 
                ? `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);">Vendedor (${escapeHtml(u.vendorCode || 'S/C')})</span>`
                : '<span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3);">Operador</span>');

            const statusBadge = u.active !== false
              ? '<span class="badge" style="background: rgba(16, 185, 129, 0.1); color: #10b981;">Ativo</span>'
              : '<span class="badge" style="background: rgba(148, 163, 184, 0.1); color: #94a3b8;">Inativo</span>';

            const countActions = parseInt(u.totalActions, 10) || 0;
            const countBadge = countActions > 0
              ? `<span style="font-weight: 700; color: #10b981; font-size: 0.95rem;">${countActions} ação(ões)</span>`
              : `<span style="color: var(--text-muted);">0</span>`;

            return `
              <tr>
                <td><strong style="color: var(--text-primary); font-family: monospace;">${escapeHtml(u.username)}</strong></td>
                <td>${escapeHtml(u.name)}</td>
                <td>${roleBadge}</td>
                <td>${statusBadge}</td>
                <td>${formatTimeAgo(u.lastActiveAt || u.lastLoginAt)}</td>
                <td style="text-align: right;">${countBadge}</td>
              </tr>
            `;
          }).join('');
        }

        // Renderiza Feed de Atividades
        if (activitiesList.length === 0) {
          auditActivitiesTableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">Nenhuma atividade registrada ainda. Conforme os usuários realizarem consultas e logins, elas aparecerão aqui em tempo real.</td></tr>`;
        } else {
          auditActivitiesTableBody.innerHTML = activitiesList.map(act => {
            const dateStr = act.createdAt 
              ? new Date(act.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
              : 'N/A';

            return `
              <tr>
                <td style="color: var(--text-muted); font-size: 0.85rem; font-family: monospace; white-space: nowrap;">${escapeHtml(dateStr)}</td>
                <td>
                  <div style="font-weight: 600; color: var(--text-primary); font-size: 0.9rem;">${escapeHtml(act.userName || act.username)}</div>
                  <small style="color: var(--text-muted); font-family: monospace;">@${escapeHtml(act.username)}</small>
                </td>
                <td>${getActionBadge(act.actionType)}</td>
                <td style="color: var(--text-secondary); font-size: 0.9rem;">${escapeHtml(act.description)}</td>
              </tr>
            `;
          }).join('');
        }
      } else {
        auditUsersTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 1.5rem;">Erro ao carregar dados: ${escapeHtml(data.message || 'Desconhecido')}</td></tr>`;
        auditActivitiesTableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #ef4444; padding: 1.5rem;">Erro ao carregar feed de atividades.</td></tr>`;
      }
    } catch (err) {
      console.error('Erro ao carregar auditoria:', err);
      if (auditUsersTableBody) auditUsersTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 1.5rem;">Falha na conexão com o servidor.</td></tr>`;
      if (auditActivitiesTableBody) auditActivitiesTableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #ef4444; padding: 1.5rem;">Falha na conexão com o servidor.</td></tr>`;
    }
  }

  // --- MÓDULO VENDEDORES: CONSULTA PEDIDOS & COMISSÕES ---
  const VENDEDOR_USERS = {
    'juliana': '000074',
    'andrea': '000064',
    'figueiredo': '000004'
  };

  function ajustarEscopoVendedor(user) {
    const comisVendorSelect = document.getElementById('comisVendorSelect');
    const comisVendorSelectGroup = document.getElementById('comisVendorSelectGroup');
    const pedidosAbertosVendedorFilter = document.getElementById('pedidosAbertosVendedorFilter');
    const pedidosAbertosVendedorFilterGroup = document.getElementById('pedidosAbertosVendedorFilterGroup');

    if (comisVendorSelect) comisVendorSelect.disabled = false;
    if (comisVendorSelectGroup) {
      const label = comisVendorSelectGroup.querySelector('label');
      if (label) label.textContent = '👤 Vendedor';
    }
    if (pedidosAbertosVendedorFilter) pedidosAbertosVendedorFilter.disabled = false;
    if (pedidosAbertosVendedorFilterGroup) {
      const label = pedidosAbertosVendedorFilterGroup.querySelector('label');
      if (label) label.textContent = '👤 Vendedor';
    }
  }

  function initComissaoDates() {
    const comisDataIni = document.getElementById('comisDataIni');
    const comisDataFim = document.getElementById('comisDataFim');
    if (!comisDataIni || !comisDataFim) return;

    if (!comisDataIni.value || !comisDataFim.value) {
      const today = new Date();
      const curDay = today.getDate();
      let dIni, dFim;

      if (curDay <= 25) {
        dIni = new Date(today.getFullYear(), today.getMonth() - 1, 26);
        dFim = new Date(today.getFullYear(), today.getMonth(), 25);
      } else {
        dIni = new Date(today.getFullYear(), today.getMonth(), 26);
        dFim = new Date(today.getFullYear(), today.getMonth() + 1, 25);
      }

      const toDateString = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      };

      comisDataIni.value = toDateString(dIni);
      comisDataFim.value = toDateString(dFim);
    }
  }

  // --- SUB-ABA: VENDEDORES - CONSULTA PEDIDOS ---
  const vendBuscaCodWeb = document.getElementById('vendBuscaCodWeb');
  const vendBuscaNumPed = document.getElementById('vendBuscaNumPed');
  const vendBuscaNomeCli = document.getElementById('vendBuscaNomeCli');
  const btnBuscarVendPedidos = document.getElementById('btnBuscarVendPedidos');
  const btnLimparVendPedidos = document.getElementById('btnLimparVendPedidos');
  const vendPedidosResults = document.getElementById('vendPedidosResults');
  const vendPedidosEmptyState = document.getElementById('vendPedidosEmptyState');
  const vendPedidosTableBody = document.getElementById('vendPedidosTableBody');
  const vendPedidosCount = document.getElementById('vendPedidosCount');

  // Modal Detalhes do Pedido
  const pedidoDetalhesModal = document.getElementById('pedidoDetalhesModal');
  const pedidoDetalhesBody = document.getElementById('pedidoDetalhesBody');
  const btnCloseDetalhesModal = document.getElementById('btnCloseDetalhesModal');
  const btnFecharDetalhesModal = document.getElementById('btnFecharDetalhesModal');
  const btnImprimirDetalhes = document.getElementById('btnImprimirDetalhes');

  async function buscarPedidosVendedoresAction() {
    const codWeb = vendBuscaCodWeb ? vendBuscaCodWeb.value.trim() : '';
    const numPed = vendBuscaNumPed ? vendBuscaNumPed.value.trim() : '';
    const nomeCli = vendBuscaNomeCli ? vendBuscaNomeCli.value.trim() : '';

    if (!codWeb && !numPed && !nomeCli) {
      alert('Por favor, informe ao menos um critério de busca (CodWeb, Número do Pedido ou Nome do Cliente).');
      return;
    }

    if (btnBuscarVendPedidos) {
      btnBuscarVendPedidos.disabled = true;
      btnBuscarVendPedidos.textContent = 'Buscando...';
    }

    try {
      const response = await fetch('/api/vendedores/pedidos/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codWeb, numPed, nomeCli })
      });
      const data = await response.json();

      if (data.success && data.data && data.data.length > 0) {
        renderVendPedidosTable(data.data);
      } else {
        if (vendPedidosTableBody) vendPedidosTableBody.innerHTML = '';
        if (vendPedidosResults) vendPedidosResults.classList.add('hidden');
        if (vendPedidosEmptyState) {
          vendPedidosEmptyState.classList.remove('hidden');
          vendPedidosEmptyState.innerHTML = `
            <div class="empty-icon">⚠️</div>
            <h4>Nenhum pedido encontrado</h4>
            <p>Não encontramos nenhum pedido nas empresas 14, 15 ou 16 com os critérios informados.</p>
          `;
        }
      }
    } catch (err) {
      alert('Erro ao buscar pedidos no servidor: ' + err.message);
    } finally {
      if (btnBuscarVendPedidos) {
        btnBuscarVendPedidos.disabled = false;
        btnBuscarVendPedidos.textContent = '🔍 Buscar';
      }
    }
  }

  function formatNFeBadge(notaFiscal) {
    const nf = (notaFiscal || '').trim();
    if (!nf || nf === '-' || nf === '0') {
      return `<span style="color: var(--text-muted); font-style: italic; font-size: 0.82rem;">⏳ Não emitida</span>`;
    }
    // Protheus grava XXXXXXXXX (ou sequencia de X) quando o pedido é cancelado
    if (/^X+$/i.test(nf) || nf.toUpperCase().includes('CANCEL')) {
      return `<span class="status-badge divergente" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); font-weight: 600; padding: 2px 8px; border-radius: 4px;">🚫 Cancelado</span>`;
    }
    return `<span class="badge-doc" style="font-weight: 600; color: #10b981; background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.25); padding: 3px 8px; border-radius: 4px;">📄 NF ${escapeHtml(nf)}</span>`;
  }

  function renderVendPedidosTable(pedidos) {
    if (!vendPedidosTableBody) return;
    vendPedidosTableBody.innerHTML = '';

    if (vendPedidosCount) vendPedidosCount.textContent = pedidos.length;
    if (vendPedidosEmptyState) vendPedidosEmptyState.classList.add('hidden');
    if (vendPedidosResults) vendPedidosResults.classList.remove('hidden');

    pedidos.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="company-badge">${escapeHtml(p.empresa)}</span></td>
        <td>
          <span class="link-codweb" data-empresa="${p.empresaKey || 'OACO'}" data-ped="${p.numPed}" title="Clique para ver detalhes do pedido">
            ${escapeHtml(p.codWeb)}
          </span>
        </td>
        <td>
          <span class="link-pedido" data-empresa="${p.empresaKey || 'OACO'}" data-ped="${p.numPed}" title="Clique para ver detalhes do pedido">
            <strong>${escapeHtml(p.numPed)}</strong>
          </span>
        </td>
        <td>${formatNFeBadge(p.notaFiscal)}</td>
        <td>${escapeHtml(p.nomeCli)}</td>
        <td style="text-align: center;">
          <button class="btn btn-outline btn-sm btn-ver-detalhe" data-empresa="${p.empresaKey || 'OACO'}" data-ped="${p.numPed}">
            📄 Detalhes
          </button>
        </td>
      `;
      vendPedidosTableBody.appendChild(tr);
    });
  }

  // Event Delegation para links e detalhes de pedidos de vendedores
  if (vendPedidosTableBody) {
    vendPedidosTableBody.addEventListener('click', (e) => {
      const el = e.target.closest('.link-pedido, .link-codweb, .btn-ver-detalhe');
      if (el) {
        const emp = el.getAttribute('data-empresa') || 'OACO';
        const ped = el.getAttribute('data-ped');
        if (ped) abrirDetalhesPedidoModal(emp, ped);
      }
    });
  }

  async function abrirDetalhesPedidoModal(empresaKey, numPedido) {
    if (!pedidoDetalhesModal || !pedidoDetalhesBody) return;

    const isLight = document.getElementById('tab-vend-saldos-estoque')?.classList.contains('tab-theme-light') ||
                    document.getElementById('tab-vend-pedidos-abertos')?.classList.contains('tab-theme-light') ||
                    localStorage.getItem('theme_vendedores') === 'light' ||
                    localStorage.getItem('theme_saldos_estoque') === 'light';

    if (isLight) {
      pedidoDetalhesModal.classList.add('modal-theme-light');
    } else {
      pedidoDetalhesModal.classList.remove('modal-theme-light');
    }

    pedidoDetalhesBody.innerHTML = `
      <div style="text-align: center; padding: 2rem;">
        <div class="spinner" style="margin: 0 auto 1rem auto; width: 32px; height: 32px; border: 3px solid rgba(59,130,246,0.2); border-top-color: #3b82f6; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
        <p>Carregando dados completos do Pedido <strong>${numPedido}</strong> no Protheus...</p>
      </div>
    `;
    pedidoDetalhesModal.classList.remove('hidden');

    try {
      const response = await fetch(`/api/vendedores/pedidos/detalhes?empresaKey=${encodeURIComponent(empresaKey)}&numPedido=${encodeURIComponent(numPedido)}`);
      const data = await response.json();

      if (data.success && data.data) {
        renderModalDetalhesContent(data.data);
      } else {
        pedidoDetalhesBody.innerHTML = `
          <div class="empty-results-box">
            <div class="empty-icon">⚠️</div>
            <h4>Não foi possível obter os detalhes do pedido</h4>
            <p>${data.message || 'Verifique se o pedido ainda existe no Protheus.'}</p>
          </div>
        `;
      }
    } catch (err) {
      pedidoDetalhesBody.innerHTML = `
        <div class="empty-results-box">
          <div class="empty-icon">❌</div>
          <h4>Erro de comunicação</h4>
          <p>${err.message}</p>
        </div>
      `;
    }
  }

  function renderModalDetalhesContent(det) {
    const cli = det.cliente || {};
    const com = det.comercial || {};
    const tot = det.totais || {};
    const fiscal = det.fiscal || {};
    const faturas = det.faturas || [];
    const itens = det.itens || [];

    const formatDataProtheus = (dt) => {
      if (!dt || String(dt).trim().length !== 8) return dt ? String(dt).trim() : '-';
      const s = String(dt).trim();
      return `${s.slice(6,8)}/${s.slice(4,6)}/${s.slice(0,4)}`;
    };

    let itensHtml = '';
    if (itens.length > 0) {
      itensHtml = itens.map(i => `
        <tr>
          <td style="text-align: center; color: var(--text-muted);">${escapeHtml(i.item || '01')}</td>
          <td><code>${escapeHtml(i.produto || '-')}</code></td>
          <td><strong>${escapeHtml(i.descricao || '-')}</strong></td>
          <td style="text-align: center;"><code>${escapeHtml(i.tes || '-')}</code></td>
          <td style="text-align: center;">
            ${i.geraFinanceiro === 'S' 
              ? '<span class="status-badge sucesso" style="padding: 2px 6px; font-size: 0.75rem;" title="Gera Duplicata/Financeiro">Sim (S)</span>' 
              : (i.geraFinanceiro === 'N' ? '<span class="status-badge neutro" style="padding: 2px 6px; font-size: 0.75rem;" title="Não gera financeiro">Não (N)</span>' : '-')}
          </td>
          <td style="text-align: center;">
            ${i.atualizaEstoque === 'S' 
              ? '<span class="status-badge status-info" style="padding: 2px 6px; font-size: 0.75rem; background: rgba(59,130,246,0.15); color: #60a5fa; border: 1px solid rgba(59,130,246,0.3);" title="Movimenta/Atualiza Estoque">Sim (S)</span>' 
              : (i.atualizaEstoque === 'N' ? '<span class="status-badge neutro" style="padding: 2px 6px; font-size: 0.75rem;" title="Não movimenta estoque">Não (N)</span>' : '-')}
          </td>
          <td style="text-align: right; font-weight: 600;">${i.qtd}</td>
          <td style="text-align: right;">${formatCurrency(i.prcUnit)}</td>
          <td style="text-align: right; font-weight: 700; color: #60a5fa;">${formatCurrency(i.total)}</td>
        </tr>
      `).join('');
    } else {
      itensHtml = `<tr><td colspan="9" style="text-align: center; color: var(--text-muted);">Nenhum item listado na tabela SC6 deste pedido.</td></tr>`;
    }

    // Renderização das Faturas / Títulos SE1
    let faturasHtml = '';
    if (faturas.length > 0) {
      faturasHtml = faturas.map(f => {
        const venctoFormatted = formatDataProtheus(f.vencimento);
        const baixaFormatted = f.estaPago ? formatDataProtheus(f.dataBaixa) : '';
        
        let statusBadge = '';
        if (f.estaPago) {
          statusBadge = `<span class="status-badge sucesso" style="font-weight: 600; padding: 2px 8px;">✓ Pago em ${baixaFormatted}</span>`;
        } else {
          statusBadge = `<span class="status-badge pendente" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); font-weight: 600; padding: 2px 8px;">⏳ Pendente</span>`;
        }

        const parcelaBadge = f.parcela && f.parcela !== 'Única' && f.parcela !== ' '
          ? `<span class="ped-venda-badge" style="font-size: 0.75rem; background: rgba(139, 92, 246, 0.15); color: #c084fc; border: 1px solid rgba(139, 92, 246, 0.3); padding: 2px 6px; border-radius: 4px;">Parcela ${escapeHtml(f.parcela)}</span>`
          : `<span class="ped-venda-badge" style="font-size: 0.75rem; color: var(--text-muted);">Única</span>`;

        return `
          <tr>
            <td style="text-align: center;"><code>${escapeHtml(f.numTitulo || det.notaFiscal || '-')}</code></td>
            <td style="text-align: center;">${parcelaBadge}</td>
            <td style="text-align: right; font-weight: 600;">${formatCurrency(f.valor)}</td>
            <td style="text-align: center;"><strong>${venctoFormatted}</strong></td>
            <td style="text-align: center;">${f.estaPago ? `<strong style="color: #34d399;">${baixaFormatted}</strong>` : `<span style="color: var(--text-muted); font-style: italic;">Pendente</span>`}</td>
            <td style="text-align: center;">${statusBadge}</td>
          </tr>
        `;
      }).join('');
    } else {
      let motivoVazio = 'Nenhuma fatura localizada na tabela SE1 para este pedido.';
      if (!det.notaFiscal || det.notaFiscal === '-' || det.notaFiscal === '0') {
        motivoVazio = '⏳ NF-e ainda não emitida — títulos a receber serão gerados no Protheus após o faturamento.';
      } else if (/^X+$/i.test(det.notaFiscal)) {
        motivoVazio = '🚫 Pedido cancelado — nenhum título financeiro ativo na SE1.';
      }
      faturasHtml = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 1rem;">${motivoVazio}</td></tr>`;
    }

    // Badges fiscais consolidados do pedido
    const badgeGeraFin = fiscal.geraFinanceiro === 'S' 
      ? '<span class="status-badge sucesso" style="font-size: 0.8rem; padding: 3px 8px;">💰 Gera Financeiro: Sim</span>' 
      : (fiscal.geraFinanceiro === 'N' ? '<span class="status-badge neutro" style="font-size: 0.8rem; padding: 3px 8px;">💰 Gera Financeiro: Não</span>' : '');
    
    const badgeAtuEstoque = fiscal.atualizaEstoque === 'S' 
      ? '<span class="status-badge status-info" style="font-size: 0.8rem; padding: 3px 8px; background: rgba(59,130,246,0.15); color: #60a5fa; border: 1px solid rgba(59,130,246,0.3);">📦 Atualiza Estoque: Sim</span>' 
      : (fiscal.atualizaEstoque === 'N' ? '<span class="status-badge neutro" style="font-size: 0.8rem; padding: 3px 8px;">📦 Atualiza Estoque: Não</span>' : '');

    const bairroCidade = (cli.bairro || cli.cidade) 
      ? `${cli.bairro ? cli.bairro + ', ' : ''}${cli.cidade || ''}${cli.uf ? ' / ' + cli.uf : ''}`
      : '-';

    const geraFinLabel = fiscal.geraFinanceiro === 'S' 
      ? '<strong style="color: #34d399;">Sim (S)</strong> <span style="color: var(--text-muted); font-size: 0.8rem;">(Gera Duplicata)</span>' 
      : (fiscal.geraFinanceiro === 'N' ? '<strong style="color: #f87171;">Não (N)</strong> <span style="color: var(--text-muted); font-size: 0.8rem;">(Sem Duplicata)</span>' : '-');

    const atuEstoqueLabel = fiscal.atualizaEstoque === 'S' 
      ? '<strong style="color: #60a5fa;">Sim (S)</strong> <span style="color: var(--text-muted); font-size: 0.8rem;">(Movimenta Estoque)</span>' 
      : (fiscal.atualizaEstoque === 'N' ? '<strong style="color: #fbbf24;">Não (N)</strong> <span style="color: var(--text-muted); font-size: 0.8rem;">(Sem Movimentação)</span>' : '-');

    const isLight = pedidoDetalhesModal?.classList.contains('modal-theme-light');
    const numPedColor = isLight ? '#0f172a' : '#f8fafc';
    const totalColor = isLight ? '#059669' : '#10b981';
    const borderSepColor = isLight ? '#e2e8f0' : 'rgba(255,255,255,0.1)';

    // Badge de alerta se houver detecção de endereço de entrega diferente
    const entregaDiferenteBadge = com.entregaDiferenteInfo?.temEnderecoDiferente
      ? `<div style="margin: 6px 0 10px 0; padding: 6px 10px; border-radius: 6px; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #f87171; font-size: 0.78rem; font-weight: 600;">
           🚨 <strong>Endereço de Entrega Alternativo:</strong> ${escapeHtml(com.entregaDiferenteInfo.motivo || 'Verifique C5_MENNOTA')}
         </div>`
      : '';

    pedidoDetalhesBody.innerHTML = `
      <!-- Cabeçalho Rápido do Pedido -->
      <div style="display: flex; justify-content: space-between; align-items: center; background: ${isLight ? '#f8fafc' : 'rgba(30, 41, 59, 0.6)'}; padding: 0.85rem 1.25rem; border-radius: 10px; border: 1px solid var(--panel-border); flex-wrap: wrap; gap: 0.5rem;">
        <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
          <span class="company-badge" style="font-size: 0.9rem; padding: 4px 10px;">${escapeHtml(det.empresa)}</span>
          <span style="font-size: 1.15rem; font-weight: 700; color: ${numPedColor};">Pedido Nº ${escapeHtml(det.numPedido)}</span>
          <span style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); padding: 3px 8px; border-radius: 6px; font-size: 0.8rem; font-weight: 600;">CodWeb: ${escapeHtml(det.codWeb)}</span>
          ${formatNFeBadge(det.notaFiscal)}
          ${badgeGeraFin}
          ${badgeAtuEstoque}
        </div>
        <div style="font-size: 0.85rem; color: var(--text-muted);">
          📅 Emissão: <strong>${formatDataProtheus(det.emissao)}</strong>
        </div>
      </div>

      <!-- Grid de Informações: Cliente & Comercial / Fiscal -->
      <div class="info-section-grid">
        <!-- Box Cliente & Endereço -->
        <div class="info-box">
          <h4>👤 Dados do Cliente & Entrega</h4>
          <div class="info-row">
            <span class="label">Razão Social:</span>
            <span class="val"><strong>${escapeHtml(cli.nome || '-')}</strong></span>
          </div>
          <div class="info-row">
            <span class="label">CNPJ / CPF:</span>
            <span class="val"><code>${escapeHtml(cli.cnpj || '-')}</code></span>
          </div>
          <div class="info-row">
            <span class="label">Endereço:</span>
            <span class="val">${escapeHtml(cli.endereco || '-')}</span>
          </div>
          <div class="info-row">
            <span class="label">Bairro / Cidade:</span>
            <span class="val">${escapeHtml(bairroCidade)}</span>
          </div>
          <div class="info-row">
            <span class="label">CEP:</span>
            <span class="val">${escapeHtml(cli.cep || '-')}</span>
          </div>
          <div class="info-row">
            <span class="label">Contato:</span>
            <span class="val">${escapeHtml(cli.contato || '-')}</span>
          </div>
          <div class="info-row">
            <span class="label">Telefone:</span>
            <span class="val">${escapeHtml(cli.telefone || '-')}</span>
          </div>
          <div class="info-row">
            <span class="label">E-mail:</span>
            <span class="val" style="word-break: break-all;">${escapeHtml(cli.email || '-')}</span>
          </div>
        </div>

        <!-- Box Comercial & Transporte / Fiscal -->
        <div class="info-box">
          <h4>🚚 Logística, Pagamento & Fiscal</h4>
          ${entregaDiferenteBadge}
          <div class="info-row">
            <span class="label">Transportadora:</span>
            <span class="val">${escapeHtml(com.transportadora || '-')}</span>
          </div>
          <div class="info-row">
            <span class="label">Condição Pagto:</span>
            <span class="val">${escapeHtml(com.condPagto || '-')}</span>
          </div>
          <div class="info-row">
            <span class="label">Vendedor:</span>
            <span class="val">${escapeHtml(com.vendedor || com.codVendedor || '-')}</span>
          </div>
          <div class="info-row">
            <span class="label">Data de Emissão:</span>
            <span class="val"><strong>${formatDataProtheus(det.emissao)}</strong></span>
          </div>
          <div class="info-row">
            <span class="label">Gera Financeiro:</span>
            <span class="val">${geraFinLabel}</span>
          </div>
          <div class="info-row">
            <span class="label">Atualiza Estoque:</span>
            <span class="val">${atuEstoqueLabel}</span>
          </div>
          <div class="info-row">
            <span class="label">TES Utilizada(s):</span>
            <span class="val"><code>${escapeHtml(fiscal.tes || '-')}</code></span>
          </div>
          <div class="info-row">
            <span class="label">Observações:</span>
            <span class="val" style="font-size: 0.8rem; max-width: 200px; word-break: break-word;">${escapeHtml(com.observacoes || 'Nenhuma observação informada.')}</span>
          </div>
        </div>
      </div>

      <!-- Tabela de Produtos do Pedido -->
      <div style="background: ${isLight ? '#f8fafc' : 'rgba(15, 23, 42, 0.5)'}; border: 1px solid var(--panel-border); border-radius: 10px; padding: 14px 16px;">
        <h4 style="margin: 0 0 10px 0; font-size: 0.9rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em;">📦 Itens e Produtos do Pedido (Grade SC6 + TES SF4)</h4>
        <div class="table-responsive">
          <table class="data-table" style="font-size: 0.85rem;">
            <thead>
              <tr>
                <th style="width: 6%; text-align: center;">Item</th>
                <th style="width: 16%;">Código</th>
                <th style="width: 28%;">Descrição</th>
                <th style="width: 8%; text-align: center;">TES</th>
                <th style="width: 9%; text-align: center;">Gera Fin.</th>
                <th style="width: 9%; text-align: center;">Estoque</th>
                <th style="width: 8%; text-align: right;">Qtd</th>
                <th style="width: 8%; text-align: right;">Unitário</th>
                <th style="width: 8%; text-align: right;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${itensHtml}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Tabela de Faturas Geradas (SE1) -->
      <div style="background: ${isLight ? '#f8fafc' : 'rgba(15, 23, 42, 0.5)'}; border: 1px solid var(--panel-border); border-radius: 10px; padding: 14px 16px; margin-top: 1rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-wrap: wrap; gap: 0.5rem;">
          <h4 style="margin: 0; font-size: 0.9rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em;">
            💳 Faturas & Títulos a Receber (SE1 - Protheus)
          </h4>
          ${faturas.length > 0 ? `<span style="font-size: 0.8rem; color: ${isLight ? '#0284c7' : '#38bdf8'}; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.2); padding: 2px 8px; border-radius: 4px;">${faturas.length} ${faturas.length === 1 ? 'título / parcela' : 'títulos / parcelas'}</span>` : ''}
        </div>
        <div class="table-responsive">
          <table class="data-table" style="font-size: 0.85rem;">
            <thead>
              <tr>
                <th style="width: 18%; text-align: center;">Nº Fatura / Título</th>
                <th style="width: 14%; text-align: center;">Parcela</th>
                <th style="width: 16%; text-align: right;">Valor</th>
                <th style="width: 16%; text-align: center;">Vencimento</th>
                <th style="width: 18%; text-align: center;">Data Pagamento</th>
                <th style="width: 18%; text-align: center;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${faturasHtml}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Box de Totais -->
      <div class="totais-box" style="display: flex; justify-content: flex-end; margin-top: 1rem;">
        <div style="min-width: 280px; display: flex; flex-direction: column; gap: 6px;">
          <div style="display: flex; justify-content: space-between; font-size: 0.9rem; color: var(--text-muted);">
            <span>Subtotal Produtos:</span>
            <span>${formatCurrency(tot.totalProdutos)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.9rem; color: var(--text-muted);">
            <span>Frete Cobrado:</span>
            <span>${formatCurrency(tot.freteCobrado !== undefined ? tot.freteCobrado : tot.totalFrete)}</span>
          </div>
          ${tot.freteEmbutido > 0 ? `
          <div style="display: flex; justify-content: space-between; font-size: 0.85rem; color: var(--text-muted); font-style: italic;">
            <span>Frete Embutido (Incluso):</span>
            <span>${formatCurrency(tot.freteEmbutido)}</span>
          </div>` : ''}
          ${tot.totalDesconto > 0 ? `
          <div style="display: flex; justify-content: space-between; font-size: 0.9rem; color: var(--accent-rose);">
            <span>Descontos:</span>
            <span>- ${formatCurrency(tot.totalDesconto)}</span>
          </div>` : ''}
          <div style="display: flex; justify-content: space-between; font-size: 1.15rem; font-weight: 700; color: ${totalColor}; border-top: 1px solid ${borderSepColor}; padding-top: 6px; margin-top: 4px;">
            <span>Total Geral do Pedido:</span>
            <span>${formatCurrency(tot.totalGeral)}</span>
          </div>
        </div>
      </div>
    `;
  }

  if (btnBuscarVendPedidos) btnBuscarVendPedidos.addEventListener('click', buscarPedidosVendedoresAction);
  if (btnLimparVendPedidos) {
    btnLimparVendPedidos.addEventListener('click', () => {
      if (vendBuscaCodWeb) vendBuscaCodWeb.value = '';
      if (vendBuscaNumPed) vendBuscaNumPed.value = '';
      if (vendBuscaNomeCli) vendBuscaNomeCli.value = '';
      if (vendPedidosTableBody) vendPedidosTableBody.innerHTML = '';
      if (vendPedidosResults) vendPedidosResults.classList.add('hidden');
      if (vendPedidosEmptyState) vendPedidosEmptyState.classList.remove('hidden');
    });
  }

  [vendBuscaCodWeb, vendBuscaNumPed, vendBuscaNomeCli].forEach(inp => {
    if (inp) {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          buscarPedidosVendedoresAction();
        }
      });
    }
  });

  if (btnCloseDetalhesModal) btnCloseDetalhesModal.addEventListener('click', () => pedidoDetalhesModal.classList.add('hidden'));
  if (btnFecharDetalhesModal) btnFecharDetalhesModal.addEventListener('click', () => pedidoDetalhesModal.classList.add('hidden'));
  if (btnImprimirDetalhes) btnImprimirDetalhes.addEventListener('click', () => window.print());

  // --- SUB-ABA: VENDEDORES - COMISSÕES ---
  const META_POR_VENDEDOR = 120000.00;
  const comisDataIni = document.getElementById('comisDataIni');
  const comisDataFim = document.getElementById('comisDataFim');
  const comisVendorSelect = document.getElementById('comisVendorSelect');
  const btnBuscarComissoes = document.getElementById('btnBuscarComissoes');
  const comissoesSummaryCards = document.getElementById('comissoesSummaryCards');
  const comissoesResults = document.getElementById('comissoesResults');
  const comissoesEmptyState = document.getElementById('comissoesEmptyState');
  const comissoesTableBody = document.getElementById('comissoesTableBody');
  const comisMetaAtingida = document.getElementById('comisMetaAtingida');
  const comisMetaDesc = document.getElementById('comisMetaDesc');
  const comisTotalBase = document.getElementById('comisTotalBase');
  const comisTotalCount = document.getElementById('comisTotalCount');
  const comisTotalGorduraFrete = document.getElementById('comisTotalGorduraFrete');

  async function consultarComissoesAction() {
    const dataIni = comisDataIni ? comisDataIni.value : '';
    const dataFim = comisDataFim ? comisDataFim.value : '';
    const codVend = comisVendorSelect ? comisVendorSelect.value : '';

    if (!dataIni || !dataFim) {
      alert('Por favor, informe a Data Inicial e a Data Final do ciclo.');
      return;
    }

    const d1 = new Date(dataIni);
    const d2 = new Date(dataFim);
    const diffDays = Math.ceil(Math.abs(d2 - d1) / (1000 * 60 * 60 * 24));
    if (diffDays > 60) {
      alert('O intervalo entre as datas não pode ser superior a 60 dias para proteger a performance do banco Protheus.');
      return;
    }

    if (btnBuscarComissoes) {
      btnBuscarComissoes.disabled = true;
      btnBuscarComissoes.textContent = 'Consultando...';
    }

    try {
      const response = await fetch('/api/vendedores/comissoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataIni, dataFim, codVend })
      });
      const data = await response.json();

      if (data.success && data.data) {
        renderComissoesReport(data.data);
      } else {
        alert(data.message || 'Erro ao consultar comissões.');
      }
    } catch (err) {
      alert('Erro de conexão ao consultar comissões: ' + err.message);
    } finally {
      if (btnBuscarComissoes) {
        btnBuscarComissoes.disabled = false;
        btnBuscarComissoes.textContent = '📊 Consultar Comissões';
      }
    }
  }

  function renderComissoesReport(resData) {
    const list = resData.comissoes || [];

    const numVendedores = (comisVendorSelect && comisVendorSelect.value) ? 1 : 3;
    const metaTotal = numVendedores * META_POR_VENDEDOR;
    const totalBase = parseFloat(resData.totalGeralBase) || 0;
    const percAtingido = metaTotal > 0 ? (totalBase / metaTotal) * 100 : 0;

    if (comisMetaAtingida) {
      comisMetaAtingida.textContent = `${percAtingido.toFixed(2).replace('.', ',')}% Atingida`;
    }
    if (comisMetaDesc) {
      comisMetaDesc.textContent = `Meta: ${formatCurrency(metaTotal)} (${numVendedores} vendedor${numVendedores > 1 ? 'es' : ''})`;
    }
    if (comisTotalBase) comisTotalBase.textContent = formatCurrency(resData.totalGeralBase);
    
    const totalGordura = (resData.totalGeralGorduraFrete !== undefined) 
      ? parseFloat(resData.totalGeralGorduraFrete) 
      : list.reduce((acc, c) => acc + (parseFloat(c.gorduraFreteEmbut || c.freteEmbutido) || 0), 0);
    if (comisTotalGorduraFrete) comisTotalGorduraFrete.textContent = formatCurrency(totalGordura);
    if (comisTotalCount) comisTotalCount.textContent = resData.totalRegistros || list.length;

    if (comissoesSummaryCards) comissoesSummaryCards.classList.remove('hidden');
    if (comissoesEmptyState) comissoesEmptyState.classList.add('hidden');
    if (comissoesResults) comissoesResults.classList.remove('hidden');

    if (!comissoesTableBody) return;
    comissoesTableBody.innerHTML = '';

    if (list.length === 0) {
      comissoesTableBody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">Nenhum lançamento de comissão encontrado para o período e vendedor selecionados.</td></tr>`;
      return;
    }

    const formatEmissao = (em) => {
      if (!em || em.length !== 8) return em || '-';
      return `${em.slice(6,8)}/${em.slice(4,6)}/${em.slice(0,4)}`;
    };

    list.forEach(item => {
      const tr = document.createElement('tr');
      const empSigla = item.empresaSigla || (item.empresaKey === 'METAL_PLENO' ? 'MP' : (item.empresaKey === 'GSI' ? 'GSI' : 'OACO'));
      const rawNome = item.nomeCliente || (item.nomeClienteCompleto ? item.nomeClienteCompleto.substring(0, 20) : '-');
      const nome20 = rawNome.length > 20 ? rawNome.substring(0, 20) : rawNome;

      tr.innerHTML = `
        <td><strong>${escapeHtml(item.nomeVendedor || item.codVend || '-')}</strong></td>
        <td style="text-align: center;"><span class="company-badge" style="font-weight: 700; padding: 2px 8px; font-size: 0.78rem;">${escapeHtml(empSigla)}</span></td>
        <td>${formatEmissao(item.emissao)}</td>
        <td><code>${escapeHtml(item.pedido)}</code></td>
        <td>${escapeHtml(item.cliente)}</td>
        <td title="${escapeHtml(item.nomeClienteCompleto || item.nomeCliente || '')}">${escapeHtml(nome20)}</td>
        <td style="text-align: right; font-weight: 500;">${formatCurrency(item.gorduraFreteEmbut !== undefined ? item.gorduraFreteEmbut : (item.freteEmbutido || 0))}</td>
        <td style="text-align: right; font-weight: 500;">${formatCurrency(item.valorBase)}</td>
        <td style="text-align: right; font-weight: 700; color: #10b981;">${formatCurrency(item.valorComis)}</td>
      `;
      comissoesTableBody.appendChild(tr);
    });
  }

  if (btnBuscarComissoes) btnBuscarComissoes.addEventListener('click', consultarComissoesAction);

  // --- SUB-ABA: VENDEDORES - PEDIDOS ABERTOS ---
  const pedidosAbertosEmpresaFilter = document.getElementById('pedidosAbertosEmpresaFilter');
  const pedidosAbertosVendedorFilter = document.getElementById('pedidosAbertosVendedorFilter');
  const btnAtualizarPedidosAbertos = document.getElementById('btnAtualizarPedidosAbertos');
  const pedidosAbertosLoading = document.getElementById('pedidosAbertosLoading');
  const pedidosAbertosResults = document.getElementById('pedidosAbertosResults');
  const pedidosAbertosCount = document.getElementById('pedidosAbertosCount');
  const pedidosAbertosTableBody = document.getElementById('pedidosAbertosTableBody');
  const pedidosAbertosEmptyState = document.getElementById('pedidosAbertosEmptyState');
  const thSortCodWeb = document.getElementById('thSortCodWeb');
  const thSortPedVenda = document.getElementById('thSortPedVenda');
  const sortIconCodWeb = document.getElementById('sortIconCodWeb');
  const sortIconPedVenda = document.getElementById('sortIconPedVenda');

  let pedidosAbertosCache = [];
  let pedidosAbertosSortField = null; // 'codWeb' | 'numPed'
  let pedidosAbertosSortDirection = 'asc'; // 'asc' | 'desc'

  function updatePedidosAbertosSortIcons() {
    if (sortIconCodWeb) {
      if (pedidosAbertosSortField === 'codWeb') {
        sortIconCodWeb.textContent = pedidosAbertosSortDirection === 'asc' ? '▲' : '▼';
        sortIconCodWeb.style.color = '#38bdf8';
        sortIconCodWeb.style.fontWeight = '700';
      } else {
        sortIconCodWeb.textContent = '↕';
        sortIconCodWeb.style.color = 'var(--text-muted)';
        sortIconCodWeb.style.fontWeight = 'normal';
      }
    }
    if (sortIconPedVenda) {
      if (pedidosAbertosSortField === 'numPed') {
        sortIconPedVenda.textContent = pedidosAbertosSortDirection === 'asc' ? '▲' : '▼';
        sortIconPedVenda.style.color = '#38bdf8';
        sortIconPedVenda.style.fontWeight = '700';
      } else {
        sortIconPedVenda.textContent = '↕';
        sortIconPedVenda.style.color = 'var(--text-muted)';
        sortIconPedVenda.style.fontWeight = 'normal';
      }
    }
  }

  function ordenarListaPedidosAbertos(lista, field, direction) {
    if (!field || !Array.isArray(lista)) return lista;
    return [...lista].sort((a, b) => {
      let valA = '';
      let valB = '';
      if (field === 'codWeb') {
        valA = String(a.codWeb || '').trim();
        valB = String(b.codWeb || '').trim();
      } else if (field === 'numPed') {
        valA = String(a.numPed || '').trim();
        valB = String(b.numPed || '').trim();
      }

      const numA = parseInt(valA.replace(/\D/g, ''), 10);
      const numB = parseInt(valB.replace(/\D/g, ''), 10);

      let cmp = 0;
      if (!isNaN(numA) && !isNaN(numB) && numA !== numB) {
        cmp = numA - numB;
      } else {
        cmp = valA.localeCompare(valB, 'pt-BR', { numeric: true, sensitivity: 'base' });
      }

      return direction === 'desc' ? -cmp : cmp;
    });
  }

  function formatPipedriveDealLink(codWeb) {
    const raw = String(codWeb || '').trim();
    const digits = raw.replace(/\D/g, '');
    if (!digits || digits.length < 3 || /^0+$/.test(digits) || raw === '-' || raw === '0') {
      return `<span style="color: var(--text-muted); font-style: italic; font-size: 0.85rem;">${escapeHtml(raw || '-')}</span>`;
    }
    const isLight = document.getElementById('tab-vend-pedidos-abertos')?.classList.contains('tab-theme-light') ||
                    document.getElementById('tab-vend-pedidos')?.classList.contains('tab-theme-light');
    const linkColor = isLight ? '#0284c7' : '#38bdf8';

    return `
      <a href="https://benetroncomercial.pipedrive.com/deal/${digits}" target="_blank" rel="noopener noreferrer" 
         class="link-codweb-pipedrive" title="Abrir oportunidade #${digits} no Pipedrive" 
         style="color: ${linkColor}; text-decoration: underline; font-weight: 600; display: inline-flex; align-items: center; gap: 3px;">
        ${escapeHtml(raw)}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
      </a>
    `;
  }

  function formatBadgeBloqCredito(bloqCredito) {
    const txt = String(bloqCredito || '').trim();
    if (txt === 'BLOQ NO CREDITO' || txt.includes('BLOQ')) {
      return `<span class="diverg-badge status-danger" style="font-size: 0.76rem; padding: 3px 8px;">🔒 ${escapeHtml(txt)}</span>`;
    }
    return `<span class="status-badge sucesso" style="font-size: 0.76rem; padding: 3px 8px; font-weight: 600;">✓ ${escapeHtml(txt || 'SEM BLOQ CREDITO')}</span>`;
  }

  function formatBadgeBloqEstoque(bloqEstoque) {
    const txt = String(bloqEstoque || '').trim();
    if (txt === 'BLOQ POR ESTOQUE' || txt.includes('BLOQ')) {
      return `<span class="diverg-badge status-warning" style="font-size: 0.76rem; padding: 3px 8px;">⚠️ ${escapeHtml(txt)}</span>`;
    }
    return `<span class="status-badge sucesso" style="font-size: 0.76rem; padding: 3px 8px; font-weight: 600;">✓ ${escapeHtml(txt || 'SEM BLOQ ESTOQ')}</span>`;
  }

  function renderPedidosAbertosTable(pedidos) {
    if (!pedidosAbertosTableBody) return;
    pedidosAbertosTableBody.innerHTML = '';

    const empFiltro = (pedidosAbertosEmpresaFilter ? pedidosAbertosEmpresaFilter.value : '').toUpperCase();
    const vendFiltro = (pedidosAbertosVendedorFilter ? pedidosAbertosVendedorFilter.value : '').trim();

    const filtrados = (pedidos || []).filter(p => {
      const codVend = String(p.codVendedor || '').trim();
      const paddedVend = codVend.padStart(6, '0');

      // Descarta qualquer pedido de vendedor que não seja Andrea (000064), Figueiredo (000004) ou Juliana (000074)
      if (!['000004', '000064', '000074'].includes(paddedVend) && !['4', '64', '74'].includes(codVend)) {
        return false;
      }

      if (empFiltro) {
        const empSigla = (p.empresa || '').toUpperCase();
        const empKey = (p.empresaKey || '').toUpperCase();
        if (empSigla !== empFiltro && empKey !== empFiltro && !(empFiltro === 'MP' && empKey === 'METAL_PLENO')) {
          return false;
        }
      }
      if (vendFiltro) {
        const cleanFiltro = vendFiltro.padStart(6, '0');
        if (codVend !== vendFiltro && paddedVend !== cleanFiltro) {
          return false;
        }
      }
      return true;
    });

    if (pedidosAbertosCount) pedidosAbertosCount.textContent = filtrados.length;

    if (filtrados.length === 0) {
      if (pedidosAbertosResults) pedidosAbertosResults.classList.add('hidden');
      if (pedidosAbertosEmptyState) pedidosAbertosEmptyState.classList.remove('hidden');
      return;
    }

    if (pedidosAbertosEmptyState) pedidosAbertosEmptyState.classList.add('hidden');
    if (pedidosAbertosResults) pedidosAbertosResults.classList.remove('hidden');

    const listaFinal = pedidosAbertosSortField 
      ? ordenarListaPedidosAbertos(filtrados, pedidosAbertosSortField, pedidosAbertosSortDirection)
      : filtrados;

    const isLight = document.getElementById('tab-vend-pedidos-abertos')?.classList.contains('tab-theme-light');
    const linkPedColor = isLight ? '#0284c7' : '#38bdf8';

    listaFinal.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="company-badge ${escapeHtml(p.empresa)}">${escapeHtml(p.empresa)}</span></td>
        <td>${formatPipedriveDealLink(p.codWeb)}</td>
        <td>
          <button type="button" class="link-pedido btn-link" data-empresa="${escapeHtml(p.empresaKey || 'OACO')}" data-ped="${escapeHtml(p.numPed)}" 
                  title="Clique para ver os detalhes completos do Pedido #${escapeHtml(p.numPed)}"
                  style="background: none; border: none; padding: 0; color: ${linkPedColor}; font-weight: 700; cursor: pointer; text-decoration: underline; font-size: 0.9rem;">
            ${escapeHtml(p.numPed)}
          </button>
        </td>
        <td>${formatBadgeBloqCredito(p.bloqCredito)}</td>
        <td>${formatBadgeBloqEstoque(p.bloqEstoque)}</td>
        <td><strong>${escapeHtml(p.vendedor)}</strong></td>
        <td>${escapeHtml(p.nomeCli)}</td>
      `;
      pedidosAbertosTableBody.appendChild(tr);
    });
  }

  // Event Delegation para links de pedidos abertos
  if (pedidosAbertosTableBody) {
    pedidosAbertosTableBody.addEventListener('click', (e) => {
      const btn = e.target.closest('.link-pedido');
      if (btn) {
        const emp = btn.getAttribute('data-empresa') || 'OACO';
        const ped = btn.getAttribute('data-ped');
        if (ped) abrirDetalhesPedidoModal(emp, ped);
      }
    });
  }

  async function carregarPedidosAbertos(forceRefresh = false) {
    if (pedidosAbertosLoading) pedidosAbertosLoading.classList.remove('hidden');
    if (pedidosAbertosResults) pedidosAbertosResults.classList.add('hidden');
    if (pedidosAbertosEmptyState) pedidosAbertosEmptyState.classList.add('hidden');
    if (btnAtualizarPedidosAbertos) {
      btnAtualizarPedidosAbertos.disabled = true;
      btnAtualizarPedidosAbertos.textContent = '⏳ Carregando...';
    }

    try {
      const response = await fetch('/api/vendedores/pedidos/abertos');
      const data = await response.json();

      if (data.success && Array.isArray(data.data)) {
        pedidosAbertosCache = data.data;
        renderPedidosAbertosTable(pedidosAbertosCache);
      } else {
        alert(data.message || 'Erro ao carregar lista de pedidos abertos.');
      }
    } catch (err) {
      alert('Erro de comunicação ao carregar pedidos abertos: ' + err.message);
    } finally {
      if (pedidosAbertosLoading) pedidosAbertosLoading.classList.add('hidden');
      if (btnAtualizarPedidosAbertos) {
        btnAtualizarPedidosAbertos.disabled = false;
        btnAtualizarPedidosAbertos.textContent = '🔄 Atualizar Pedidos';
      }
    }
  }

  if (pedidosAbertosEmpresaFilter) {
    pedidosAbertosEmpresaFilter.addEventListener('change', () => {
      renderPedidosAbertosTable(pedidosAbertosCache);
    });
  }

  if (pedidosAbertosVendedorFilter) {
    pedidosAbertosVendedorFilter.addEventListener('change', () => {
      renderPedidosAbertosTable(pedidosAbertosCache);
    });
  }

  if (btnAtualizarPedidosAbertos) {
    btnAtualizarPedidosAbertos.addEventListener('click', () => carregarPedidosAbertos(true));
  }

  if (thSortCodWeb) {
    thSortCodWeb.addEventListener('click', () => {
      if (pedidosAbertosSortField === 'codWeb') {
        pedidosAbertosSortDirection = pedidosAbertosSortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        pedidosAbertosSortField = 'codWeb';
        pedidosAbertosSortDirection = 'asc';
      }
      updatePedidosAbertosSortIcons();
      renderPedidosAbertosTable(pedidosAbertosCache);
    });
  }

  if (thSortPedVenda) {
    thSortPedVenda.addEventListener('click', () => {
      if (pedidosAbertosSortField === 'numPed') {
        pedidosAbertosSortDirection = pedidosAbertosSortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        pedidosAbertosSortField = 'numPed';
        pedidosAbertosSortDirection = 'asc';
      }
      updatePedidosAbertosSortIcons();
      renderPedidosAbertosTable(pedidosAbertosCache);
    });
  }

  // --- SUB-ABA: VENDEDORES - PEDIDOS DE COMPRAS (SC7) ---
  const pedidosComprasSearchInput = document.getElementById('pedidosComprasSearchInput');
  const pedidosComprasEmpresaFilter = document.getElementById('pedidosComprasEmpresaFilter');
  const btnAtualizarPedidosCompras = document.getElementById('btnAtualizarPedidosCompras');
  const pedidosComprasLoading = document.getElementById('pedidosComprasLoading');
  const pedidosComprasResults = document.getElementById('pedidosComprasResults');
  const pedidosComprasCount = document.getElementById('pedidosComprasCount');
  const pedidosComprasTableBody = document.getElementById('pedidosComprasTableBody');
  const pedidosComprasEmptyState = document.getElementById('pedidosComprasEmptyState');

  const statComprasTotalItens = document.getElementById('statComprasTotalItens');
  const statComprasTotalQtd = document.getElementById('statComprasTotalQtd');
  const statComprasDataProxima = document.getElementById('statComprasDataProxima');

  const thSortComprasDescri = document.getElementById('thSortComprasDescri');
  const thSortComprasPed = document.getElementById('thSortComprasPed');
  const thSortComprasSaldo = document.getElementById('thSortComprasSaldo');
  const thSortComprasPrevisao = document.getElementById('thSortComprasPrevisao');

  const sortIconComprasDescri = document.getElementById('sortIconComprasDescri');
  const sortIconComprasPed = document.getElementById('sortIconComprasPed');
  const sortIconComprasSaldo = document.getElementById('sortIconComprasSaldo');
  const sortIconComprasPrevisao = document.getElementById('sortIconComprasPrevisao');

  let pedidosComprasCache = [];
  let pedidosComprasSortField = 'previsao'; // 'descricao' | 'pedCom' | 'saldoCompras' | 'previsao'
  let pedidosComprasSortDirection = 'asc'; // 'asc' | 'desc'

  function updatePedidosComprasSortIcons() {
    const map = [
      { field: 'descricao', icon: sortIconComprasDescri },
      { field: 'pedCom', icon: sortIconComprasPed },
      { field: 'saldoCompras', icon: sortIconComprasSaldo },
      { field: 'previsao', icon: sortIconComprasPrevisao }
    ];

    map.forEach(item => {
      if (!item.icon) return;
      if (pedidosComprasSortField === item.field) {
        item.icon.textContent = pedidosComprasSortDirection === 'asc' ? '▲' : '▼';
        item.icon.style.color = '#38bdf8';
        item.icon.style.fontWeight = '700';
      } else {
        item.icon.textContent = '↕';
        item.icon.style.color = 'var(--text-muted)';
        item.icon.style.fontWeight = 'normal';
      }
    });
  }

  function ordenarListaPedidosCompras(lista, field, direction) {
    if (!field || !Array.isArray(lista)) return lista;
    return [...lista].sort((a, b) => {
      let cmp = 0;
      if (field === 'saldoCompras') {
        cmp = (Number(a.saldoCompras) || 0) - (Number(b.saldoCompras) || 0);
      } else if (field === 'previsao') {
        const rawA = a.previsaoRaw || '';
        const rawB = b.previsaoRaw || '';
        cmp = rawA.localeCompare(rawB);
      } else if (field === 'pedCom') {
        const numA = parseInt(String(a.pedCom || '').replace(/\D/g, ''), 10);
        const numB = parseInt(String(b.pedCom || '').replace(/\D/g, ''), 10);
        if (!isNaN(numA) && !isNaN(numB) && numA !== numB) {
          cmp = numA - numB;
        } else {
          cmp = String(a.pedCom || '').localeCompare(String(b.pedCom || ''), 'pt-BR');
        }
      } else {
        // descricao
        cmp = String(a.descricao || '').localeCompare(String(b.descricao || ''), 'pt-BR', { sensitivity: 'base' });
      }

      return direction === 'desc' ? -cmp : cmp;
    });
  }

  function formatBadgePrevisaoEntrega(previsaoStr, previsaoRaw) {
    if (!previsaoRaw || previsaoRaw.length !== 8) {
      return `<span style="color: var(--text-muted); font-size: 0.85rem;">${escapeHtml(previsaoStr || '-')}</span>`;
    }

    const hoje = new Date();
    const ano = hoje.getFullYear();
    const mes = String(hoje.getMonth() + 1).padStart(2, '0');
    const dia = String(hoje.getDate()).padStart(2, '0');
    const hojeStr = `${ano}${mes}${dia}`;

    const isLight = document.getElementById('tab-vend-pedidos-compras')?.classList.contains('tab-theme-light');
    const normalColor = isLight ? '#0284c7' : '#38bdf8';

    if (previsaoRaw < hojeStr) {
      return `<span class="diverg-badge status-danger" style="font-size: 0.76rem; padding: 2px 7px;" title="Previsão ultrapassada">${escapeHtml(previsaoStr)} (Atrasado)</span>`;
    } else if (previsaoRaw === hojeStr) {
      return `<span class="diverg-badge status-warning" style="font-size: 0.76rem; padding: 2px 7px;" title="Previsão de chegada para hoje!">${escapeHtml(previsaoStr)} (Hoje)</span>`;
    } else {
      return `<span style="font-weight: 600; color: ${normalColor};">${escapeHtml(previsaoStr)}</span>`;
    }
  }

  function renderPedidosComprasTable(pedidos) {
    if (!pedidosComprasTableBody) return;
    pedidosComprasTableBody.innerHTML = '';

    const empFiltro = (pedidosComprasEmpresaFilter ? pedidosComprasEmpresaFilter.value : '').toUpperCase();
    const searchVal = (pedidosComprasSearchInput ? pedidosComprasSearchInput.value : '').toLowerCase().trim();

    const filtrados = (pedidos || []).filter(p => {
      // Filtro estrito: Somente tipo PA e códigos entre 001000000000000 e 019999999999999
      const cod = String(p.codProduto || '').trim();
      const tipo = String(p.tipo || '').trim().toUpperCase();
      if (tipo && tipo !== 'PA') return false;
      if (cod && (cod < '001000000000000' || cod > '019999999999999')) return false;

      if (empFiltro) {
        const empSigla = (p.empresa || '').toUpperCase();
        const empKey = (p.empresaKey || '').toUpperCase();
        if (empSigla !== empFiltro && empKey !== empFiltro && !(empFiltro === 'MP' && empKey === 'METAL_PLENO')) {
          return false;
        }
      }
      if (searchVal) {
        const desc = (p.descricao || '').toLowerCase();
        const codProd = (p.codProduto || '').toLowerCase();
        const ped = (p.pedCom || '').toLowerCase();
        const numPed = (p.numPed || '').toLowerCase();
        const forn = (p.fornecedor || '').toLowerCase();

        const match = desc.includes(searchVal) || 
                      codProd.includes(searchVal) || 
                      ped.includes(searchVal) || 
                      numPed.includes(searchVal) || 
                      forn.includes(searchVal);
        if (!match) return false;
      }
      return true;
    });

    if (pedidosComprasCount) pedidosComprasCount.textContent = filtrados.length;

    // Atualiza cards de métricas
    if (statComprasTotalItens) statComprasTotalItens.textContent = filtrados.length;
    if (statComprasTotalQtd) {
      const totalQtd = filtrados.reduce((acc, it) => acc + (Number(it.saldoCompras) || 0), 0);
      statComprasTotalQtd.textContent = totalQtd.toLocaleString('pt-BR');
    }
    if (statComprasDataProxima) {
      const comPrevisao = filtrados.filter(it => it.previsaoRaw && it.previsaoRaw.length === 8);
      if (comPrevisao.length > 0) {
        comPrevisao.sort((a, b) => a.previsaoRaw.localeCompare(b.previsaoRaw));
        statComprasDataProxima.textContent = comPrevisao[0].previsao || '-';
      } else {
        statComprasDataProxima.textContent = '-';
      }
    }

    if (filtrados.length === 0) {
      if (pedidosComprasResults) pedidosComprasResults.classList.add('hidden');
      if (pedidosComprasEmptyState) pedidosComprasEmptyState.classList.remove('hidden');
      return;
    }

    if (pedidosComprasEmptyState) pedidosComprasEmptyState.classList.add('hidden');
    if (pedidosComprasResults) pedidosComprasResults.classList.remove('hidden');

    const listaFinal = pedidosComprasSortField
      ? ordenarListaPedidosCompras(filtrados, pedidosComprasSortField, pedidosComprasSortDirection)
      : filtrados;

    const isLight = document.getElementById('tab-vend-pedidos-compras')?.classList.contains('tab-theme-light');
    const pedComColor = isLight ? '#0284c7' : '#38bdf8';
    const titleColor = isLight ? '#0f172a' : 'var(--text-primary)';
    const mutedColor = isLight ? '#64748b' : 'var(--text-muted)';

    listaFinal.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="company-badge ${escapeHtml(p.empresa)}">${escapeHtml(p.empresa)}</span></td>
        <td>
          <div style="font-weight: 600; color: ${titleColor}; font-size: 0.88rem;">${escapeHtml(p.descricao)}</div>
          <div style="font-size: 0.76rem; color: ${mutedColor}; font-family: var(--font-mono); margin-top: 2px;">Cód: ${escapeHtml(p.codProduto || '-')}</div>
        </td>
        <td>
          <span style="font-family: var(--font-mono); font-weight: 700; color: ${pedComColor};">${escapeHtml(p.pedCom)}</span>
          ${p.item ? `<span style="font-size: 0.75rem; color: ${mutedColor};"> (Item ${escapeHtml(p.item)})</span>` : ''}
        </td>
        <td style="text-align: center;">
          <span class="status-badge sucesso" style="font-size: 0.82rem; font-weight: 700; padding: 3px 9px;">
            ${Number(p.saldoCompras || 0).toLocaleString('pt-BR')} un
          </span>
        </td>
        <td>${formatBadgePrevisaoEntrega(p.previsao, p.previsaoRaw)}</td>
        <td style="font-size: 0.84rem; color: ${mutedColor};">${escapeHtml(p.emissao || '-')}</td>
        <td style="font-size: 0.82rem; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(p.fornecedor)}">
          ${escapeHtml(p.fornecedor || '-')}
        </td>
      `;
      pedidosComprasTableBody.appendChild(tr);
    });
  }

  async function carregarPedidosCompras(forceRefresh = false) {
    if (pedidosComprasLoading) pedidosComprasLoading.classList.remove('hidden');
    if (pedidosComprasResults) pedidosComprasResults.classList.add('hidden');
    if (pedidosComprasEmptyState) pedidosComprasEmptyState.classList.add('hidden');
    if (btnAtualizarPedidosCompras) {
      btnAtualizarPedidosCompras.disabled = true;
      btnAtualizarPedidosCompras.textContent = '⏳ Carregando...';
    }

    try {
      const response = await fetch('/api/vendedores/pedidos/compras');
      const data = await response.json();

      if (data.success && Array.isArray(data.data)) {
        pedidosComprasCache = data.data;
        updatePedidosComprasSortIcons();
        renderPedidosComprasTable(pedidosComprasCache);
      } else {
        alert(data.message || 'Erro ao carregar lista de pedidos de compras.');
      }
    } catch (err) {
      alert('Erro de comunicação ao carregar pedidos de compras: ' + err.message);
    } finally {
      if (pedidosComprasLoading) pedidosComprasLoading.classList.add('hidden');
      if (btnAtualizarPedidosCompras) {
        btnAtualizarPedidosCompras.disabled = false;
        btnAtualizarPedidosCompras.textContent = '🔄 Atualizar';
      }
    }
  }

  if (pedidosComprasSearchInput) {
    pedidosComprasSearchInput.addEventListener('input', () => {
      renderPedidosComprasTable(pedidosComprasCache);
    });
  }

  if (pedidosComprasEmpresaFilter) {
    pedidosComprasEmpresaFilter.addEventListener('change', () => {
      renderPedidosComprasTable(pedidosComprasCache);
    });
  }

  if (btnAtualizarPedidosCompras) {
    btnAtualizarPedidosCompras.addEventListener('click', () => carregarPedidosCompras(true));
  }

  function handleComprasSortClick(field) {
    if (pedidosComprasSortField === field) {
      pedidosComprasSortDirection = pedidosComprasSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      pedidosComprasSortField = field;
      pedidosComprasSortDirection = 'asc';
    }
    updatePedidosComprasSortIcons();
    renderPedidosComprasTable(pedidosComprasCache);
  }

  if (thSortComprasDescri) thSortComprasDescri.addEventListener('click', () => handleComprasSortClick('descricao'));
  if (thSortComprasPed) thSortComprasPed.addEventListener('click', () => handleComprasSortClick('pedCom'));
  if (thSortComprasSaldo) thSortComprasSaldo.addEventListener('click', () => handleComprasSortClick('saldoCompras'));
  if (thSortComprasPrevisao) thSortComprasPrevisao.addEventListener('click', () => handleComprasSortClick('previsao'));

  // =========================================================================
  // SUB-ABA COMPRAS: PEDIDOS DE COMPRAS EM ABERTO (SC7 CONSOLIDADO & MODAL)
  // =========================================================================

  const pedidosComprasAbertosSearchInput = document.getElementById('pedidosComprasAbertosSearchInput');
  const pedidosComprasAbertosEmpresaFilter = document.getElementById('pedidosComprasAbertosEmpresaFilter');
  const pedidosComprasAbertosStatusFilter = document.getElementById('pedidosComprasAbertosStatusFilter');
  const btnAtualizarPedidosComprasAbertos = document.getElementById('btnAtualizarPedidosComprasAbertos');
  const pedidosComprasAbertosLoading = document.getElementById('pedidosComprasAbertosLoading');
  const pedidosComprasAbertosResults = document.getElementById('pedidosComprasAbertosResults');
  const pedidosComprasAbertosCount = document.getElementById('pedidosComprasAbertosCount');
  const pedidosComprasAbertosTableBody = document.getElementById('pedidosComprasAbertosTableBody');
  const pedidosComprasAbertosEmptyState = document.getElementById('pedidosComprasAbertosEmptyState');

  const statComprasAbertosTotalPedidos = document.getElementById('statComprasAbertosTotalPedidos');
  const statComprasAbertosAtrasados = document.getElementById('statComprasAbertosAtrasados');
  const statComprasAbertosTotalPecas = document.getElementById('statComprasAbertosTotalPecas');
  const statComprasAbertosValorTotal = document.getElementById('statComprasAbertosValorTotal');

  const thSortComprasAbertosPed = document.getElementById('thSortComprasAbertosPed');
  const thSortComprasAbertosEmissao = document.getElementById('thSortComprasAbertosEmissao');
  const thSortComprasAbertosEntrega = document.getElementById('thSortComprasAbertosEntrega');

  const sortIconComprasAbertosPed = document.getElementById('sortIconComprasAbertosPed');
  const sortIconComprasAbertosEmissao = document.getElementById('sortIconComprasAbertosEmissao');
  const sortIconComprasAbertosEntrega = document.getElementById('sortIconComprasAbertosEntrega');

  const modalPedidoCompraDetalhes = document.getElementById('modalPedidoCompraDetalhes');
  const modalPedCompraNum = document.getElementById('modalPedCompraNum');
  const modalPedCompraEmpresaBadge = document.getElementById('modalPedCompraEmpresaBadge');
  const modalPedCompraBody = document.getElementById('modalPedCompraBody');
  const btnCloseModalPedCompra = document.getElementById('btnCloseModalPedCompra');
  const btnFecharModalPedCompra = document.getElementById('btnFecharModalPedCompra');

  let pedidosComprasAbertosCache = [];
  let pedidosComprasAbertosSortField = 'dataEntrega'; // 'numPed' | 'emissao' | 'dataEntrega'
  let pedidosComprasAbertosSortDirection = 'asc'; // 'asc' | 'desc'

  function updatePedidosComprasAbertosSortIcons() {
    const map = [
      { field: 'numPed', icon: sortIconComprasAbertosPed },
      { field: 'emissao', icon: sortIconComprasAbertosEmissao },
      { field: 'dataEntrega', icon: sortIconComprasAbertosEntrega }
    ];

    map.forEach(item => {
      if (!item.icon) return;
      if (pedidosComprasAbertosSortField === item.field) {
        item.icon.textContent = pedidosComprasAbertosSortDirection === 'asc' ? '▲' : '▼';
        item.icon.style.color = '#38bdf8';
        item.icon.style.fontWeight = '700';
      } else {
        item.icon.textContent = '↕';
        item.icon.style.color = 'var(--text-muted)';
        item.icon.style.fontWeight = 'normal';
      }
    });
  }

  function ordenarListaPedidosComprasAbertos(lista, field, direction) {
    if (!field || !Array.isArray(lista)) return lista;
    return [...lista].sort((a, b) => {
      let cmp = 0;
      if (field === 'numPed') {
        const numA = parseInt(String(a.numPed || '').replace(/\D/g, ''), 10);
        const numB = parseInt(String(b.numPed || '').replace(/\D/g, ''), 10);
        if (!isNaN(numA) && !isNaN(numB) && numA !== numB) {
          cmp = numA - numB;
        } else {
          cmp = String(a.numPed || '').localeCompare(String(b.numPed || ''), 'pt-BR');
        }
      } else if (field === 'emissao') {
        const rawA = a.emissaoRaw || '';
        const rawB = b.emissaoRaw || '';
        cmp = rawA.localeCompare(rawB);
      } else if (field === 'dataEntrega') {
        const rawA = a.dataEntregaRaw || '';
        const rawB = b.dataEntregaRaw || '';
        cmp = rawA.localeCompare(rawB);
      } else {
        cmp = String(a.fornecedor || '').localeCompare(String(b.fornecedor || ''), 'pt-BR', { sensitivity: 'base' });
      }

      return direction === 'desc' ? -cmp : cmp;
    });
  }

  function formatBadgeEntregaComprasAbertos(dataEntrega, dataEntregaRaw, statusPrazo, diasAtraso) {
    if (!dataEntregaRaw || dataEntregaRaw.length !== 8) {
      return `<span style="color: var(--text-muted); font-size: 0.85rem;">${escapeHtml(dataEntrega || '-')}</span>`;
    }

    if (statusPrazo === 'ATRASADO') {
      const txtDias = diasAtraso > 1 ? `${diasAtraso}d atrasado` : '1d atrasado';
      return `<span class="diverg-badge status-danger" style="font-size: 0.78rem; font-weight: 700; padding: 3px 8px; display: inline-flex; align-items: center; gap: 4px;" title="Previsão expirada! Comprador deve cobrar novo prazo do fornecedor.">🔴 ${escapeHtml(dataEntrega)} (${escapeHtml(txtDias)})</span>`;
    } else if (statusPrazo === 'HOJE') {
      return `<span class="diverg-badge status-warning" style="font-size: 0.78rem; font-weight: 700; padding: 3px 8px; display: inline-flex; align-items: center; gap: 4px;" title="Previsão de entrega para hoje!">🟡 ${escapeHtml(dataEntrega)} (Hoje)</span>`;
    } else {
      return `<span class="status-badge sucesso" style="font-size: 0.78rem; font-weight: 600; padding: 3px 8px;">🟢 ${escapeHtml(dataEntrega)}</span>`;
    }
  }

  function renderPedidosComprasAbertosTable(pedidos) {
    if (!pedidosComprasAbertosTableBody) return;
    pedidosComprasAbertosTableBody.innerHTML = '';

    const empFiltro = (pedidosComprasAbertosEmpresaFilter ? pedidosComprasAbertosEmpresaFilter.value : '').toUpperCase();
    const statusFiltro = (pedidosComprasAbertosStatusFilter ? pedidosComprasAbertosStatusFilter.value : '').toUpperCase();
    const searchVal = (pedidosComprasAbertosSearchInput ? pedidosComprasAbertosSearchInput.value : '').toLowerCase().trim();

    const filtrados = (pedidos || []).filter(p => {
      if (empFiltro) {
        const empSigla = (p.empresa || '').toUpperCase();
        const empKey = (p.empresaKey || '').toUpperCase();
        if (empSigla !== empFiltro && empKey !== empFiltro && !(empFiltro === 'MP' && empKey === 'METAL_PLENO')) {
          return false;
        }
      }

      if (statusFiltro) {
        if (statusFiltro === 'ATRASADOS' || statusFiltro === 'ATRASADO') {
          if (p.statusPrazo !== 'ATRASADO') return false;
        } else if (statusFiltro === 'HOJE') {
          if (p.statusPrazo !== 'HOJE') return false;
        } else if (statusFiltro === 'NO_PRAZO') {
          if (p.statusPrazo !== 'NO_PRAZO') return false;
        }
      }

      if (searchVal) {
        const ped = (p.pedCom || '').toLowerCase();
        const numPed = (p.numPed || '').toLowerCase();
        const forn = (p.fornecedor || '').toLowerCase();
        const codForn = (p.codFornecedor || '').toLowerCase();

        const match = ped.includes(searchVal) || 
                      numPed.includes(searchVal) || 
                      forn.includes(searchVal) || 
                      codForn.includes(searchVal);
        if (!match) return false;
      }

      return true;
    });

    if (pedidosComprasAbertosCount) pedidosComprasAbertosCount.textContent = filtrados.length;

    // Atualiza cards de métricas
    const totalPedidos = filtrados.length;
    const totalAtrasados = filtrados.filter(p => p.statusPrazo === 'ATRASADO').length;
    const totalPecas = filtrados.reduce((acc, p) => acc + (Number(p.saldoTotal) || 0), 0);
    const valorTotal = filtrados.reduce((acc, p) => acc + (Number(p.valorTotal) || 0), 0);

    if (statComprasAbertosTotalPedidos) statComprasAbertosTotalPedidos.textContent = totalPedidos.toLocaleString('pt-BR');
    if (statComprasAbertosAtrasados) statComprasAbertosAtrasados.textContent = totalAtrasados.toLocaleString('pt-BR');
    if (statComprasAbertosTotalPecas) statComprasAbertosTotalPecas.textContent = totalPecas.toLocaleString('pt-BR');
    if (statComprasAbertosValorTotal) statComprasAbertosValorTotal.textContent = formatCurrency(valorTotal);

    if (filtrados.length === 0) {
      if (pedidosComprasAbertosResults) pedidosComprasAbertosResults.classList.add('hidden');
      if (pedidosComprasAbertosEmptyState) pedidosComprasAbertosEmptyState.classList.remove('hidden');
      return;
    }

    if (pedidosComprasAbertosEmptyState) pedidosComprasAbertosEmptyState.classList.add('hidden');
    if (pedidosComprasAbertosResults) pedidosComprasAbertosResults.classList.remove('hidden');

    const listaFinal = pedidosComprasAbertosSortField
      ? ordenarListaPedidosComprasAbertos(filtrados, pedidosComprasAbertosSortField, pedidosComprasAbertosSortDirection)
      : filtrados;

    const isLight = document.getElementById('tab-compras-pedidos-abertos')?.classList.contains('tab-theme-light');
    const linkPedColor = isLight ? '#0284c7' : '#38bdf8';
    const mutedColor = isLight ? '#64748b' : 'var(--text-muted)';

    listaFinal.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="company-badge ${escapeHtml(p.empresa)}">${escapeHtml(p.empresa)}</span></td>
        <td>
          <button type="button" class="link-ped-compra btn-link" data-empresa="${escapeHtml(p.empresaKey || 'OACO')}" data-ped="${escapeHtml(p.numPed)}" 
                  title="Clique para abrir a ficha completa do Pedido de Compra #${escapeHtml(p.numPed)}"
                  style="background: none; border: none; padding: 0; color: ${linkPedColor}; font-weight: 700; cursor: pointer; text-decoration: underline; font-size: 0.92rem; font-family: var(--font-mono);">
            ${escapeHtml(p.numPed)}
          </button>
        </td>
        <td style="font-size: 0.85rem; color: ${mutedColor};">${escapeHtml(p.emissao || '-')}</td>
        <td style="font-family: var(--font-mono); font-size: 0.85rem; color: ${mutedColor};">${escapeHtml(p.codFornecedor || '-')}</td>
        <td style="font-weight: 600; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(p.fornecedor)}">
          ${escapeHtml(p.fornecedor)}
        </td>
        <td style="text-align: center;">
          <span style="font-weight: 700; color: #10b981; font-size: 0.85rem;">
            ${Number(p.saldoTotal || 0).toLocaleString('pt-BR')} un
          </span>
          <div style="font-size: 0.74rem; color: ${mutedColor};">${p.totalItens} ${p.totalItens === 1 ? 'item' : 'itens'}</div>
        </td>
        <td style="text-align: right; font-weight: 700; color: #60a5fa; font-size: 0.88rem;">
          ${formatCurrency(p.valorTotal)}
        </td>
        <td>${formatBadgeEntregaComprasAbertos(p.dataEntrega, p.dataEntregaRaw, p.statusPrazo, p.diasAtraso)}</td>
      `;
      pedidosComprasAbertosTableBody.appendChild(tr);
    });
  }

  // Event Delegation para links de pedidos de compras em aberto
  if (pedidosComprasAbertosTableBody) {
    pedidosComprasAbertosTableBody.addEventListener('click', (e) => {
      const btn = e.target.closest('.link-ped-compra');
      if (btn) {
        const emp = btn.getAttribute('data-empresa') || 'OACO';
        const ped = btn.getAttribute('data-ped');
        if (ped) abrirDetalhesPedidoCompraModal(emp, ped);
      }
    });
  }

  async function carregarPedidosComprasAbertos(forceRefresh = false) {
    if (pedidosComprasAbertosLoading) pedidosComprasAbertosLoading.classList.remove('hidden');
    if (pedidosComprasAbertosResults) pedidosComprasAbertosResults.classList.add('hidden');
    if (pedidosComprasAbertosEmptyState) pedidosComprasAbertosEmptyState.classList.add('hidden');
    if (btnAtualizarPedidosComprasAbertos) {
      btnAtualizarPedidosComprasAbertos.disabled = true;
      btnAtualizarPedidosComprasAbertos.textContent = '⏳ Carregando...';
    }

    try {
      const response = await fetch('/api/compras/pedidos/abertos');
      const data = await response.json();

      if (data.success && Array.isArray(data.data)) {
        pedidosComprasAbertosCache = data.data;
        updatePedidosComprasAbertosSortIcons();
        renderPedidosComprasAbertosTable(pedidosComprasAbertosCache);
      } else {
        alert(data.message || 'Erro ao carregar lista de pedidos de compras em aberto.');
      }
    } catch (err) {
      alert('Erro de comunicação ao carregar pedidos de compras: ' + err.message);
    } finally {
      if (pedidosComprasAbertosLoading) pedidosComprasAbertosLoading.classList.add('hidden');
      if (btnAtualizarPedidosComprasAbertos) {
        btnAtualizarPedidosComprasAbertos.disabled = false;
        btnAtualizarPedidosComprasAbertos.textContent = '🔄 Atualizar Pedidos';
      }
    }
  }

  if (pedidosComprasAbertosSearchInput) {
    pedidosComprasAbertosSearchInput.addEventListener('input', () => {
      renderPedidosComprasAbertosTable(pedidosComprasAbertosCache);
    });
  }

  if (pedidosComprasAbertosEmpresaFilter) {
    pedidosComprasAbertosEmpresaFilter.addEventListener('change', () => {
      renderPedidosComprasAbertosTable(pedidosComprasAbertosCache);
    });
  }

  if (pedidosComprasAbertosStatusFilter) {
    pedidosComprasAbertosStatusFilter.addEventListener('change', () => {
      renderPedidosComprasAbertosTable(pedidosComprasAbertosCache);
    });
  }

  if (btnAtualizarPedidosComprasAbertos) {
    btnAtualizarPedidosComprasAbertos.addEventListener('click', () => carregarPedidosComprasAbertos(true));
  }

  function handleComprasAbertosSortClick(field) {
    if (pedidosComprasAbertosSortField === field) {
      pedidosComprasAbertosSortDirection = pedidosComprasAbertosSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      pedidosComprasAbertosSortField = field;
      pedidosComprasAbertosSortDirection = 'asc';
    }
    updatePedidosComprasAbertosSortIcons();
    renderPedidosComprasAbertosTable(pedidosComprasAbertosCache);
  }

  if (thSortComprasAbertosPed) thSortComprasAbertosPed.addEventListener('click', () => handleComprasAbertosSortClick('numPed'));
  if (thSortComprasAbertosEmissao) thSortComprasAbertosEmissao.addEventListener('click', () => handleComprasAbertosSortClick('emissao'));
  if (thSortComprasAbertosEntrega) thSortComprasAbertosEntrega.addEventListener('click', () => handleComprasAbertosSortClick('dataEntrega'));

  // --- MODAL: DETALHES DO PEDIDO DE COMPRA ---
  async function abrirDetalhesPedidoCompraModal(empresaKey, numPedido) {
    if (!modalPedidoCompraDetalhes || !modalPedCompraBody) return;

    const isLight = document.getElementById('tab-compras-pedidos-abertos')?.classList.contains('tab-theme-light') ||
                    localStorage.getItem('theme_vendedores') === 'light' ||
                    localStorage.getItem('theme_saldos_estoque') === 'light';

    if (isLight) {
      modalPedidoCompraDetalhes.classList.add('modal-theme-light');
    } else {
      modalPedidoCompraDetalhes.classList.remove('modal-theme-light');
    }

    if (modalPedCompraNum) modalPedCompraNum.textContent = numPedido;
    if (modalPedCompraEmpresaBadge) {
      const sigla = (empresaKey === '14' || empresaKey === 'MP' || empresaKey === 'METAL_PLENO') ? 'MP' :
                    (empresaKey === '15' || empresaKey === 'GSI') ? 'GSI' : 'OACO';
      modalPedCompraEmpresaBadge.innerHTML = `<span class="company-badge ${sigla}" style="margin-left: 8px;">${sigla}</span>`;
    }

    modalPedCompraBody.innerHTML = `
      <div style="text-align: center; padding: 2.5rem;">
        <div class="spinner" style="margin: 0 auto 1rem auto; width: 32px; height: 32px; border: 3px solid rgba(59,130,246,0.2); border-top-color: #3b82f6; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
        <p>Consultando dados e itens do Pedido de Compra <strong>#${escapeHtml(numPedido)}</strong> no Protheus...</p>
      </div>
    `;
    modalPedidoCompraDetalhes.classList.remove('hidden');

    try {
      const response = await fetch(`/api/compras/pedidos/detalhes?empresaKey=${encodeURIComponent(empresaKey)}&numPedido=${encodeURIComponent(numPedido)}`);
      const data = await response.json();

      if (data.success && data.data) {
        renderModalDetalhesPedidoCompraContent(data.data);
      } else {
        modalPedCompraBody.innerHTML = `
          <div class="empty-results-box">
            <div class="empty-icon">⚠️</div>
            <h4>Não foi possível carregar o pedido</h4>
            <p>${data.message || 'Verifique se o pedido ainda existe no Protheus.'}</p>
          </div>
        `;
      }
    } catch (err) {
      modalPedCompraBody.innerHTML = `
        <div class="empty-results-box">
          <div class="empty-icon">❌</div>
          <h4>Erro de comunicação</h4>
          <p>${err.message}</p>
        </div>
      `;
    }
  }

  function renderModalDetalhesPedidoCompraContent(det) {
    if (!modalPedCompraBody) return;
    const c = det.cabecalho || {};
    const t = det.totais || {};
    const itens = det.itens || [];

    let statusBadgeEntrega = '';
    if (c.statusPrazo === 'ATRASADO') {
      statusBadgeEntrega = `<span class="diverg-badge status-danger" style="font-weight: 700; padding: 3px 8px;">🔴 Atrasado (${c.diasAtraso}d de atraso)</span>`;
    } else if (c.statusPrazo === 'HOJE') {
      statusBadgeEntrega = `<span class="diverg-badge status-warning" style="font-weight: 700; padding: 3px 8px;">🟡 Vence Hoje</span>`;
    } else {
      statusBadgeEntrega = `<span class="status-badge sucesso" style="font-weight: 600; padding: 3px 8px;">🟢 No Prazo</span>`;
    }

    let itensHtml = '';
    if (itens.length > 0) {
      itensHtml = itens.map(i => {
        let badgeItemPrazo = '';
        if (i.statusPrazo === 'ATRASADO') {
          badgeItemPrazo = `<span class="diverg-badge status-danger" style="font-size: 0.74rem; padding: 2px 6px;">🔴 ${escapeHtml(i.previsao)} (${i.diasAtraso}d)</span>`;
        } else if (i.statusPrazo === 'HOJE') {
          badgeItemPrazo = `<span class="diverg-badge status-warning" style="font-size: 0.74rem; padding: 2px 6px;">🟡 ${escapeHtml(i.previsao)} (Hoje)</span>`;
        } else {
          badgeItemPrazo = `<span style="font-weight: 600; color: #38bdf8; font-size: 0.82rem;">${escapeHtml(i.previsao || '-')}</span>`;
        }

        return `
          <tr>
            <td style="text-align: center; color: var(--text-muted); font-size: 0.85rem;">${escapeHtml(i.item || '0001')}</td>
            <td><code style="font-size: 0.85rem;">${escapeHtml(i.produto || '-')}</code></td>
            <td><strong>${escapeHtml(i.descricao || '-')}</strong></td>
            <td style="text-align: center;"><span class="badge" style="font-size: 0.75rem;">${escapeHtml(i.um || 'UN')}</span></td>
            <td style="text-align: right; font-weight: 600;">${Number(i.qtd || 0).toLocaleString('pt-BR')}</td>
            <td style="text-align: right; color: var(--text-muted);">${Number(i.quje || 0).toLocaleString('pt-BR')}</td>
            <td style="text-align: right; font-weight: 700; color: #10b981;">${Number(i.saldo || 0).toLocaleString('pt-BR')}</td>
            <td style="text-align: right;">${formatCurrency(i.precoUnit)}</td>
            <td style="text-align: right; font-weight: 700; color: #60a5fa;">${formatCurrency(i.total)}</td>
            <td style="text-align: center;">${badgeItemPrazo}</td>
          </tr>
        `;
      }).join('');
    } else {
      itensHtml = `<tr><td colspan="10" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">Nenhum item localizado para este pedido de compra no Protheus.</td></tr>`;
    }

    modalPedCompraBody.innerHTML = `
      <!-- Cabeçalho Cadastral do Pedido & Fornecedor -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.85rem; background: rgba(15, 23, 42, 0.4); padding: 1.15rem; border-radius: 10px; border: 1px solid var(--panel-border); margin-bottom: 1.25rem;">
        <div>
          <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Fornecedor</div>
          <div style="font-weight: 700; font-size: 0.95rem; margin-top: 2px;">${escapeHtml(c.nomeFornecedor)}</div>
          <div style="font-size: 0.78rem; color: var(--text-muted); font-family: var(--font-mono);">Cód: ${escapeHtml(c.codFornecedor)} ${c.lojaFornecedor ? `| Loja: ${escapeHtml(c.lojaFornecedor)}` : ''}</div>
        </div>

        <div>
          <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">CNPJ / Telefone</div>
          <div style="font-weight: 600; font-size: 0.88rem; margin-top: 2px; font-family: var(--font-mono);">${escapeHtml(c.cnpjFornecedor || '-')}</div>
          <div style="font-size: 0.8rem; color: var(--text-muted);">${c.telFornecedor ? `📞 ${escapeHtml(c.telFornecedor)}` : ''} ${c.contatoFornecedor ? `(${escapeHtml(c.contatoFornecedor)})` : ''}</div>
        </div>

        <div>
          <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Emissão / Cond. Pagto</div>
          <div style="font-weight: 600; font-size: 0.88rem; margin-top: 2px;">📅 Emissão: ${escapeHtml(c.emissao || '-')}</div>
          <div style="font-size: 0.8rem; color: #38bdf8;">💳 ${escapeHtml(c.condPagtoDesc || 'Padrão')}</div>
        </div>

        <div>
          <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Previsão Geral / Status</div>
          <div style="font-weight: 700; font-size: 0.92rem; margin-top: 2px;">📦 Entrega: ${escapeHtml(c.previsaoGeral || '-')}</div>
          <div style="margin-top: 4px;">${statusBadgeEntrega}</div>
        </div>
      </div>

      <!-- Tabela de Itens do Pedido de Compra -->
      <div style="margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center;">
        <h3 style="font-size: 0.95rem; font-weight: 700; margin: 0; color: var(--text-primary);">
          📦 Itens do Pedido de Compra (${t.totalItens} ${t.totalItens === 1 ? 'item' : 'itens'})
        </h3>
        <span style="font-size: 0.8rem; color: var(--text-muted);">
          Total a receber: <strong style="color: #10b981;">${Number(t.saldoTotal || 0).toLocaleString('pt-BR')} peças</strong>
        </span>
      </div>

      <div class="table-responsive" style="max-height: 420px; overflow-y: auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width: 5%; text-align: center;">Item</th>
              <th style="width: 14%;">Código</th>
              <th style="width: 25%;">Descrição do Produto</th>
              <th style="width: 6%; text-align: center;">UM</th>
              <th style="width: 8%; text-align: right;">Qtd Pedida</th>
              <th style="width: 8%; text-align: right;">Entregue</th>
              <th style="width: 8%; text-align: right;">Saldo</th>
              <th style="width: 9%; text-align: right;">Preço Unit</th>
              <th style="width: 9%; text-align: right;">Total Item</th>
              <th style="width: 14%; text-align: center;">Previsão</th>
            </tr>
          </thead>
          <tbody>
            ${itensHtml}
          </tbody>
        </table>
      </div>

      <!-- Resumo Financeiro no Rodapé -->
      <div style="margin-top: 1rem; padding: 0.85rem 1rem; background: rgba(30, 41, 59, 0.4); border-radius: 8px; border: 1px solid var(--panel-border); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem;">
        <div style="font-size: 0.85rem; color: var(--text-muted);">
          Comprador / Usuário Protheus: <strong>${escapeHtml(c.solicitante || c.usuario || 'NÃO INFORMADO')}</strong>
        </div>
        <div style="display: flex; gap: 1.5rem; align-items: center;">
          <div style="font-size: 0.88rem;">Qtd Total: <strong style="color: var(--text-primary);">${Number(t.qtdTotal || 0).toLocaleString('pt-BR')}</strong></div>
          <div style="font-size: 0.88rem;">Saldo Pendente: <strong style="color: #10b981;">${Number(t.saldoTotal || 0).toLocaleString('pt-BR')}</strong></div>
          <div style="font-size: 1rem; font-weight: 700; color: #60a5fa;">Valor Total: ${formatCurrency(t.valorTotal)}</div>
        </div>
      </div>
    `;
  }

  if (btnCloseModalPedCompra) {
    btnCloseModalPedCompra.addEventListener('click', () => {
      if (modalPedidoCompraDetalhes) modalPedidoCompraDetalhes.classList.add('hidden');
    });
  }

  if (btnFecharModalPedCompra) {
    btnFecharModalPedCompra.addEventListener('click', () => {
      if (modalPedidoCompraDetalhes) modalPedidoCompraDetalhes.classList.add('hidden');
    });
  }

  if (modalPedidoCompraDetalhes) {
    modalPedidoCompraDetalhes.addEventListener('click', (e) => {
      if (e.target === modalPedidoCompraDetalhes) {
        modalPedidoCompraDetalhes.classList.add('hidden');
      }
    });
  }

  // =========================================================================
  // SUB-ABA VENDEDORES: SALDOS EM ESTOQUE (POWER BI STYLE & DRILLDOWN)
  // =========================================================================

  let estoqueProdutosData = [];
  let estoqueSortColumn = 'saldo';
  let estoqueSortAsc = false;
  let estoqueItemSelecionado = null;
  let estoquePaginaAtual = 1;
  let estoqueItensPorPagina = 50;

  const estoqueBuscaInput = document.getElementById('estoqueBuscaInput');
  const estoqueEmpresaSelect = document.getElementById('estoqueEmpresaSelect');
  const estoqueGrupoSelect = document.getElementById('estoqueGrupoSelect');
  const estoqueFiltroSelect = document.getElementById('estoqueFiltroSelect');
  const btnLimparFiltrosEstoque = document.getElementById('btnLimparFiltrosEstoque');
  const btnExportEstoqueExcel = document.getElementById('btnExportEstoqueExcel');
  const btnSyncEstoqueManual = document.getElementById('btnSyncEstoqueManual');
  const btnToggleThemeEstoque = document.getElementById('btnToggleThemeEstoque');
  const themeIconEstoque = document.getElementById('themeIconEstoque');
  const themeLabelEstoque = document.getElementById('themeLabelEstoque');
  const btnToggleThemeVendedores = document.getElementById('btnToggleThemeVendedores');
  const themeIconVendedores = document.getElementById('themeIconVendedores');
  const themeLabelVendedores = document.getElementById('themeLabelVendedores');
  const btnToggleThemeCompras = document.getElementById('btnToggleThemeCompras');
  const themeIconCompras = document.getElementById('themeIconCompras');
  const themeLabelCompras = document.getElementById('themeLabelCompras');
  const modalEstoqueDetalhes = document.getElementById('modalEstoqueDetalhes');
  const btnCloseModalEstoque = document.getElementById('btnCloseModalEstoque');
  const btnFecharModalEstoqueDetalhes = document.getElementById('btnFecharModalEstoqueDetalhes');

  const VENDEDORES_SUB_TABS = [
    'tab-vend-saldos-estoque',
    'tab-vend-pedidos',
    'tab-vend-pedidos-abertos',
    'tab-compras-pedidos-abertos',
    'tab-vend-pedidos-compras',
    'tab-vend-comissoes',
    'tab-vend-gordura-frete',
    'tab-vend-fechamento'
  ];

  function aplicarTemaVendedores(modo) {
    const isLight = (modo === 'light');

    VENDEDORES_SUB_TABS.forEach(tabId => {
      const pane = document.getElementById(tabId);
      if (pane) {
        if (isLight) pane.classList.add('tab-theme-light');
        else pane.classList.remove('tab-theme-light');
      }
    });

    const modalEstoque = document.getElementById('modalEstoqueDetalhes');
    const modalPedido = document.getElementById('pedidoDetalhesModal');
    const modalPedCompra = document.getElementById('modalPedidoCompraDetalhes');
    const modalFretes = document.getElementById('modalFretesFechamento');
    if (modalEstoque) {
      if (isLight) modalEstoque.classList.add('modal-theme-light');
      else modalEstoque.classList.remove('modal-theme-light');
    }
    if (modalPedido) {
      if (isLight) modalPedido.classList.add('modal-theme-light');
      else modalPedido.classList.remove('modal-theme-light');
    }
    if (modalPedCompra) {
      if (isLight) modalPedCompra.classList.add('modal-theme-light');
      else modalPedCompra.classList.remove('modal-theme-light');
    }
    if (modalFretes) {
      if (isLight) modalFretes.classList.add('modal-theme-light');
      else modalFretes.classList.remove('modal-theme-light');
    }

    if (themeIconEstoque) themeIconEstoque.textContent = isLight ? '🌙' : '☀️';
    if (themeLabelEstoque) themeLabelEstoque.textContent = isLight ? 'Modo Escuro' : 'Modo Claro';
    if (themeIconVendedores) themeIconVendedores.textContent = isLight ? '🌙' : '☀️';
    if (themeLabelVendedores) themeLabelVendedores.textContent = isLight ? 'Modo Escuro' : 'Modo Claro';
    if (themeIconCompras) themeIconCompras.textContent = isLight ? '🌙' : '☀️';
    if (themeLabelCompras) themeLabelCompras.textContent = isLight ? 'Modo Escuro' : 'Modo Claro';
  }

  function toggleVendedoresTheme() {
    const currentTheme = localStorage.getItem('theme_vendedores') || localStorage.getItem('theme_saldos_estoque') || 'dark';
    const novoModo = currentTheme === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme_saldos_estoque', novoModo);
    localStorage.setItem('theme_vendedores', novoModo);
    aplicarTemaVendedores(novoModo);

    // Re-renderiza as tabelas se necessário
    if (typeof renderSaldosEstoqueTable === 'function') {
      renderSaldosEstoqueTable();
    }
    if (typeof pedidosAbertosCache !== 'undefined' && pedidosAbertosCache && pedidosAbertosCache.length > 0) {
      renderPedidosAbertosTable(pedidosAbertosCache);
    }
    if (typeof pedidosComprasCache !== 'undefined' && pedidosComprasCache && pedidosComprasCache.length > 0) {
      renderPedidosComprasTable(pedidosComprasCache);
    }
  }

  function inicializarTemaVendedores() {
    const temaSalvo = localStorage.getItem('theme_vendedores') || localStorage.getItem('theme_saldos_estoque') || 'dark';
    aplicarTemaVendedores(temaSalvo);
  }

  // Compatibilidade com referências antigas
  const aplicarTemaEstoque = aplicarTemaVendedores;
  const toggleEstoqueTheme = toggleVendedoresTheme;
  const inicializarTemaEstoque = inicializarTemaVendedores;

  const estoqueItensPorPaginaSelect = document.getElementById('estoqueItensPorPaginaSelect');
  const estoquePaginacaoInfo = document.getElementById('estoquePaginacaoInfo');
  const estoquePagNumeros = document.getElementById('estoquePagNumeros');
  const btnEstoquePagPrimeira = document.getElementById('btnEstoquePagPrimeira');
  const btnEstoquePagAnterior = document.getElementById('btnEstoquePagAnterior');
  const btnEstoquePagProxima = document.getElementById('btnEstoquePagProxima');
  const btnEstoquePagUltima = document.getElementById('btnEstoquePagUltima');

  async function carregarSaldosEstoque(forceReload = false) {
    const tbody = document.getElementById('estoqueTableBody');
    const countSpan = document.getElementById('estoqueProdutosCount');
    const lastSyncSpan = document.getElementById('estoqueLastSyncTime');

    if (tbody && (forceReload || estoqueProdutosData.length === 0)) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-muted);">⏳ Carregando dados consolidados de estoque do Supabase...</td></tr>';
    }

    try {
      const searchVal = estoqueBuscaInput ? estoqueBuscaInput.value : '';
      const empresaVal = estoqueEmpresaSelect ? estoqueEmpresaSelect.value : 'todos';
      const filtroVal = estoqueFiltroSelect ? estoqueFiltroSelect.value : 'todos';
      const grupoVal = estoqueGrupoSelect ? estoqueGrupoSelect.value : 'todos';

      const queryParams = new URLSearchParams({
        search: searchVal,
        filtroEmpresa: empresaVal,
        filtroEstoque: filtroVal,
        filtroGrupo: grupoVal
      });

      const token = localStorage.getItem('token');
      const res = await fetch(`/api/vendedores/estoque/saldos?${queryParams.toString()}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const json = await res.json();

      if (!json.success) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #ef4444; padding: 2rem;">❌ ${json.message || 'Erro ao carregar estoque.'}</td></tr>`;
        return;
      }

      estoqueProdutosData = json.data || [];
      if (countSpan) countSpan.textContent = estoqueProdutosData.length;

      // Atualiza KPIs do topo
      if (json.kpis) {
        const kpiItens = document.getElementById('kpiItensEstoque');
        const kpiSem = document.getElementById('kpiItensSemEstoque');
        const kpiVal = document.getElementById('kpiValorEstoque');

        if (kpiItens) kpiItens.textContent = Number(json.kpis.totalItensEstoque || 0).toLocaleString('pt-BR');
        if (kpiSem) kpiSem.textContent = Number(json.kpis.totalItensSemEstoque || 0).toLocaleString('pt-BR');
        if (kpiVal) kpiVal.textContent = Number(json.kpis.totalValorEstoque || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      }

      // Atualiza Badge de Sincronização
      if (lastSyncSpan) {
        const rawDate = json.lastSync ? (json.lastSync.created_at || json.lastSync.synced_at || json.lastSync.syncedAt) : null;
        if (rawDate) {
          const syncDate = new Date(rawDate);
          lastSyncSpan.textContent = !isNaN(syncDate.getTime()) ? syncDate.toLocaleString('pt-BR') : 'Recente';
        } else {
          lastSyncSpan.textContent = 'Não sincronizado';
        }
      }

      estoquePaginaAtual = 1;
      updateEstoqueSortIcons();
      renderSaldosEstoqueTable();
    } catch (err) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: #ef4444; padding: 2rem;">❌ Erro de conexão ao buscar saldos de estoque: ${err.message}</td></tr>`;
    }
  }

  function renderSaldosEstoqueTable() {
    const tbody = document.getElementById('estoqueTableBody');
    if (!tbody) return;

    const empresaVal = estoqueEmpresaSelect ? estoqueEmpresaSelect.value : 'todos';
    const empCod = (empresaVal === '14' || empresaVal === 'mp') ? '14' :
                   (empresaVal === '15' || empresaVal === 'gsi') ? '15' :
                   (empresaVal === '16' || empresaVal === 'oaco') ? '16' : null;

    let lista = [...estoqueProdutosData];

    // Ordenação (suportando valores consolidados ou por empresa selecionada)
    lista.sort((a, b) => {
      let valA, valB;
      if (empCod) {
        const empA = a.detalhes_empresas && a.detalhes_empresas[empCod];
        const empB = b.detalhes_empresas && b.detalhes_empresas[empCod];
        if (estoqueSortColumn === 'saldo') {
          valA = empA ? Number(empA.saldo || 0) : 0;
          valB = empB ? Number(empB.saldo || 0) : 0;
        } else if (estoqueSortColumn === 'saldo_total') {
          valA = (empA ? Number(empA.saldo || 0) : 0) * Number(a.preco || 0);
          valB = (empB ? Number(empB.saldo || 0) : 0) * Number(b.preco || 0);
        } else if (estoqueSortColumn === 'qtd_vendas') {
          valA = empA ? Number(empA.vendas || 0) : 0;
          valB = empB ? Number(empB.vendas || 0) : 0;
        } else if (estoqueSortColumn === 'qtd_compras') {
          valA = empA ? Number(empA.compras || 0) : 0;
          valB = empB ? Number(empB.compras || 0) : 0;
        } else {
          valA = a[estoqueSortColumn];
          valB = b[estoqueSortColumn];
        }
      } else {
        valA = a[estoqueSortColumn];
        valB = b[estoqueSortColumn];
      }

      if (typeof valA === 'string') {
        return estoqueSortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      valA = Number(valA) || 0;
      valB = Number(valB) || 0;
      return estoqueSortAsc ? valA - valB : valB - valA;
    });

    const totalItens = lista.length;
    if (totalItens === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 2.5rem; color: var(--text-muted);">Nenhum produto encontrado com os filtros aplicados.</td></tr>';
      renderEstoquePaginacaoControles(0, 0, 0, 1);
      return;
    }

    const pageSize = (estoqueItensPorPagina === 'todos') ? totalItens : parseInt(estoqueItensPorPagina, 10);
    const totalPaginas = Math.ceil(totalItens / pageSize) || 1;

    if (estoquePaginaAtual > totalPaginas) estoquePaginaAtual = totalPaginas;
    if (estoquePaginaAtual < 1) estoquePaginaAtual = 1;

    const offsetInicio = (estoquePaginaAtual - 1) * pageSize;
    const offsetFim = Math.min(offsetInicio + pageSize, totalItens);
    const itensExibidos = (estoqueItensPorPagina === 'todos') ? lista : lista.slice(offsetInicio, offsetFim);

    const isLight = document.getElementById('tab-vend-saldos-estoque')?.classList.contains('tab-theme-light');
    const descColor = isLight ? '#0f172a' : '#f1f5f9';
    const totalColor = isLight ? '#0284c7' : '#38bdf8';
    const vendasActiveColor = isLight ? '#d97706' : '#fbbf24';
    const comprasActiveColor = isLight ? '#0284c7' : '#38bdf8';
    const mutedColor = isLight ? '#64748b' : 'var(--text-muted)';
    const groupBg = isLight ? 'rgba(2, 132, 199, 0.08)' : 'rgba(56, 189, 248, 0.12)';
    const groupColor = isLight ? '#0284c7' : '#38bdf8';
    const groupBorder = isLight ? 'rgba(2, 132, 199, 0.25)' : 'rgba(56, 189, 248, 0.25)';

    tbody.innerHTML = itensExibidos.map(p => {
      let saldoNum, saldoTotalNum, vendasNum, comprasNum;
      if (empCod) {
        const empObj = p.detalhes_empresas && p.detalhes_empresas[empCod];
        saldoNum = empObj ? Number(empObj.saldo || 0) : 0;
        saldoTotalNum = saldoNum * Number(p.preco || 0);
        vendasNum = empObj ? Number(empObj.vendas || 0) : 0;
        comprasNum = empObj ? Number(empObj.compras || 0) : 0;
      } else {
        saldoNum = Number(p.saldo || 0);
        saldoTotalNum = Number(p.saldo_total || 0);
        vendasNum = Number(p.qtd_vendas || 0);
        comprasNum = Number(p.qtd_compras || 0);
      }

      const precoFmt = Number(p.preco || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const saldoTotalFmt = saldoTotalNum.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const saldoColor = saldoNum > 0 ? (isLight ? '#059669' : '#10b981') : (isLight ? '#dc2626' : '#ef4444');
      const saldoBg = saldoNum > 0 ? (isLight ? 'rgba(5, 150, 105, 0.12)' : 'rgba(16, 185, 129, 0.1)') : (isLight ? 'rgba(220, 38, 38, 0.12)' : 'rgba(239, 68, 68, 0.1)');

      return `
        <tr class="tr-estoque-item" data-codigo="${escapeHtml(p.codigo)}" style="cursor: pointer; transition: background 0.15s ease;" title="Clique para ver drilldown por empresa e pedidos">
          <td>
            <div style="font-weight: 600; color: ${descColor};">${p.descricao || 'PRODUTO SEM DESCRIÇÃO'}</div>
            <div style="font-size: 0.78rem; color: ${mutedColor}; margin-top: 2px;">
              Cód: <code>${p.codigo}</code>
              ${p.grupo ? `<span style="display:inline-block; font-size:0.7rem; margin-left:6px; background:${groupBg}; color:${groupColor}; border:1px solid ${groupBorder}; border-radius:4px; padding:0 5px; font-weight:600;">Grupo ${p.grupo}</span>` : ''}
              ${empCod ? `<span style="display:inline-block; font-size:0.7rem; margin-left:4px; background:rgba(16, 185, 129, 0.12); color:#10b981; border:1px solid rgba(16, 185, 129, 0.25); border-radius:4px; padding:0 5px; font-weight:600;">${empCod === '14' ? 'MP' : empCod === '15' ? 'GSI' : 'OACO'}</span>` : ''}
            </div>
          </td>
          <td style="text-align: right; font-weight: 500; font-family: monospace;">${precoFmt}</td>
          <td style="text-align: right;">
            <span style="display: inline-block; padding: 2px 8px; border-radius: 6px; font-weight: 700; color: ${saldoColor}; background: ${saldoBg}; font-family: monospace;">
              ${saldoNum.toLocaleString('pt-BR')}
            </span>
          </td>
          <td style="text-align: right; font-weight: 600; color: ${totalColor}; font-family: monospace;">${saldoTotalFmt}</td>
          <td style="text-align: right; font-weight: 600; color: ${vendasNum > 0 ? vendasActiveColor : mutedColor}; font-family: monospace;">
            ${vendasNum > 0 ? vendasNum.toLocaleString('pt-BR') : '-'}
          </td>
          <td style="text-align: right; font-weight: 600; color: ${comprasNum > 0 ? comprasActiveColor : mutedColor}; font-family: monospace;">
            ${comprasNum > 0 ? comprasNum.toLocaleString('pt-BR') : '-'}
          </td>
          <td style="text-align: right; font-weight: 500; color: ${mutedColor}; font-family: monospace;">
            ${Number(p.ponto_ped || 0) > 0 ? Number(p.ponto_ped).toLocaleString('pt-BR') : '-'}
          </td>
        </tr>
      `;
    }).join('');

    renderEstoquePaginacaoControles(offsetInicio + 1, offsetFim, totalItens, totalPaginas);
  }

  function renderEstoquePaginacaoControles(inicio, fim, total, totalPaginas) {
    if (estoquePaginacaoInfo) {
      estoquePaginacaoInfo.textContent = total > 0 ? `${inicio} a ${fim} de ${total}` : '0 a 0 de 0';
    }

    if (btnEstoquePagPrimeira) btnEstoquePagPrimeira.disabled = (estoquePaginaAtual <= 1);
    if (btnEstoquePagAnterior) btnEstoquePagAnterior.disabled = (estoquePaginaAtual <= 1);
    if (btnEstoquePagProxima) btnEstoquePagProxima.disabled = (estoquePaginaAtual >= totalPaginas);
    if (btnEstoquePagUltima) btnEstoquePagUltima.disabled = (estoquePaginaAtual >= totalPaginas);

    if (estoquePagNumeros) {
      if (totalPaginas <= 1) {
        estoquePagNumeros.innerHTML = '';
        return;
      }

      let botoesHtml = '';
      const maxVisiveis = 5;
      let startP = Math.max(1, estoquePaginaAtual - 2);
      let endP = Math.min(totalPaginas, startP + maxVisiveis - 1);
      if (endP - startP < maxVisiveis - 1) {
        startP = Math.max(1, endP - maxVisiveis + 1);
      }

      for (let p = startP; p <= endP; p++) {
        const isActive = (p === estoquePaginaAtual);
        botoesHtml += `
          <button class="btn btn-sm ${isActive ? 'btn-primary' : 'btn-outline'}" 
                  style="min-width: 28px; height: 28px; padding: 0 6px; font-size: 0.78rem; font-weight: ${isActive ? '700' : '500'}; cursor: pointer;" 
                  onclick="mudarPaginaEstoque(${p})">
            ${p}
          </button>
        `;
      }
      estoquePagNumeros.innerHTML = botoesHtml;
    }
  }

  window.mudarPaginaEstoque = function(novaPagina) {
    estoquePaginaAtual = novaPagina;
    renderSaldosEstoqueTable();
    const tabela = document.getElementById('tabelaEstoqueSaldos');
    if (tabela) tabela.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  function updateEstoqueSortIcons() {
    const cols = [
      { id: 'sortIconEstoqueDescricao', key: 'descricao' },
      { id: 'sortIconEstoquePreco', key: 'preco' },
      { id: 'sortIconEstoqueSaldo', key: 'saldo' },
      { id: 'sortIconEstoqueSaldoTotal', key: 'saldo_total' },
      { id: 'sortIconEstoqueVendas', key: 'qtd_vendas' },
      { id: 'sortIconEstoqueCompras', key: 'qtd_compras' },
      { id: 'sortIconEstoquePontoPed', key: 'ponto_ped' }
    ];

    cols.forEach(c => {
      const el = document.getElementById(c.id);
      if (el) {
        if (estoqueSortColumn === c.key) {
          el.textContent = estoqueSortAsc ? '▲' : '▼';
          el.style.color = '#38bdf8';
        } else {
          el.textContent = '⇅';
          el.style.color = 'var(--text-muted)';
        }
      }
    });
  }

  function handleEstoqueSortClick(columnKey) {
    if (estoqueSortColumn === columnKey) {
      estoqueSortAsc = !estoqueSortAsc;
    } else {
      estoqueSortColumn = columnKey;
      estoqueSortAsc = (columnKey === 'descricao') ? true : false;
    }
    updateEstoqueSortIcons();
    renderSaldosEstoqueTable();
  }

  // Exportação Completa de Todas as Páginas para Excel (CSV BOM UTF-8)
  function exportarEstoqueParaExcel() {
    if (!estoqueProdutosData || estoqueProdutosData.length === 0) {
      alert('Nenhum produto disponível para exportação.');
      return;
    }

    const empresaVal = estoqueEmpresaSelect ? estoqueEmpresaSelect.value : 'todos';
    const empCod = (empresaVal === '14' || empresaVal === 'mp') ? '14' :
                   (empresaVal === '15' || empresaVal === 'gsi') ? '15' :
                   (empresaVal === '16' || empresaVal === 'oaco') ? '16' : null;

    // Obtém a lista completa respeitando a ordenação ativa
    let listaExport = [...estoqueProdutosData];

    listaExport.sort((a, b) => {
      let valA, valB;
      if (empCod) {
        const empA = a.detalhes_empresas && a.detalhes_empresas[empCod];
        const empB = b.detalhes_empresas && b.detalhes_empresas[empCod];
        if (estoqueSortColumn === 'saldo') {
          valA = empA ? Number(empA.saldo || 0) : 0;
          valB = empB ? Number(empB.saldo || 0) : 0;
        } else if (estoqueSortColumn === 'saldo_total') {
          valA = (empA ? Number(empA.saldo || 0) : 0) * Number(a.preco || 0);
          valB = (empB ? Number(empB.saldo || 0) : 0) * Number(b.preco || 0);
        } else if (estoqueSortColumn === 'qtd_vendas') {
          valA = empA ? Number(empA.vendas || 0) : 0;
          valB = empB ? Number(empB.vendas || 0) : 0;
        } else if (estoqueSortColumn === 'qtd_compras') {
          valA = empA ? Number(empA.compras || 0) : 0;
          valB = empB ? Number(empB.compras || 0) : 0;
        } else {
          valA = a[estoqueSortColumn];
          valB = b[estoqueSortColumn];
        }
      } else {
        valA = a[estoqueSortColumn];
        valB = b[estoqueSortColumn];
      }

      if (typeof valA === 'string') {
        return estoqueSortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      valA = Number(valA) || 0;
      valB = Number(valB) || 0;
      return estoqueSortAsc ? valA - valB : valB - valA;
    });

    // Cabeçalho CSV formatado para Excel pt-BR (separador ponto-e-vírgula e BOM UTF-8)
    let csv = '\uFEFF';
    csv += 'Código;Descrição;Grupo;Preço Unitário (R$);Saldo Total (Físico);Saldo Total (R$);Saldo Metal Pleno (14);Saldo GSI (15);Saldo OACO (16);Qtd Vendas (SC6);Qtd Compras (SC7);Ponto de Pedido\n';

    listaExport.forEach(p => {
      const cod = String(p.codigo || '').trim();
      const desc = String(p.descricao || '').replace(/"/g, '""').trim();
      const grupo = String(p.grupo || '').trim();
      const preco = Number(p.preco || 0).toFixed(2).replace('.', ',');
      const saldoTotal = Number(p.saldo || 0);
      const saldoTotalValor = Number(p.saldo_total || 0).toFixed(2).replace('.', ',');

      const emp14 = (p.detalhes_empresas && p.detalhes_empresas['14']) ? Number(p.detalhes_empresas['14'].saldo || 0) : 0;
      const emp15 = (p.detalhes_empresas && p.detalhes_empresas['15']) ? Number(p.detalhes_empresas['15'].saldo || 0) : 0;
      const emp16 = (p.detalhes_empresas && p.detalhes_empresas['16']) ? Number(p.detalhes_empresas['16'].saldo || 0) : 0;

      const vendas = Number(p.qtd_vendas || 0);
      const compras = Number(p.qtd_compras || 0);
      const pontoPed = Number(p.ponto_ped || 0);

      csv += `"${cod}";"${desc}";"${grupo}";"${preco}";${saldoTotal};"${saldoTotalValor}";${emp14};${emp15};${emp16};${vendas};${compras};${pontoPed}\n`;
    });

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const dataHoraStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    const empSuffix = empCod ? `_Empresa_${empCod}` : '_Consolidado';
    const nomeArquivo = `Saldos_Estoque${empSuffix}_${dataHoraStr}.csv`;

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', nomeArquivo);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }

  // Header click para ordenação na tabela de estoque
  const thDesc = document.getElementById('thEstoqueDescricao');
  const thPrc = document.getElementById('thEstoquePreco');
  const thSld = document.getElementById('thEstoqueSaldo');
  const thTot = document.getElementById('thEstoqueSaldoTotal');
  const thVen = document.getElementById('thEstoqueVendas');
  const thCom = document.getElementById('thEstoqueCompras');
  const thPto = document.getElementById('thEstoquePontoPed');

  if (thDesc) thDesc.addEventListener('click', () => handleEstoqueSortClick('descricao'));
  if (thPrc) thPrc.addEventListener('click', () => handleEstoqueSortClick('preco'));
  if (thSld) thSld.addEventListener('click', () => handleEstoqueSortClick('saldo'));
  if (thTot) thTot.addEventListener('click', () => handleEstoqueSortClick('saldo_total'));
  if (thVen) thVen.addEventListener('click', () => handleEstoqueSortClick('qtd_vendas'));
  if (thCom) thCom.addEventListener('click', () => handleEstoqueSortClick('qtd_compras'));
  if (thPto) thPto.addEventListener('click', () => handleEstoqueSortClick('ponto_ped'));

  // Listeners de paginação
  if (btnEstoquePagPrimeira) btnEstoquePagPrimeira.addEventListener('click', () => mudarPaginaEstoque(1));
  if (btnEstoquePagAnterior) btnEstoquePagAnterior.addEventListener('click', () => mudarPaginaEstoque(estoquePaginaAtual - 1));
  if (btnEstoquePagProxima) btnEstoquePagProxima.addEventListener('click', () => mudarPaginaEstoque(estoquePaginaAtual + 1));
  if (btnEstoquePagUltima) {
    btnEstoquePagUltima.addEventListener('click', () => {
      const pageSize = (estoqueItensPorPagina === 'todos') ? estoqueProdutosData.length : parseInt(estoqueItensPorPagina, 10);
      const totalPaginas = Math.ceil(estoqueProdutosData.length / pageSize) || 1;
      mudarPaginaEstoque(totalPaginas);
    });
  }
  if (estoqueItensPorPaginaSelect) {
    estoqueItensPorPaginaSelect.addEventListener('change', (e) => {
      estoqueItensPorPagina = e.target.value;
      estoquePaginaAtual = 1;
      renderSaldosEstoqueTable();
    });
  }

  // Filtros em tempo real
  if (estoqueBuscaInput) {
    estoqueBuscaInput.addEventListener('input', () => {
      carregarSaldosEstoque();
    });
  }

  if (estoqueEmpresaSelect) {
    estoqueEmpresaSelect.addEventListener('change', () => {
      carregarSaldosEstoque();
    });
  }

  if (estoqueGrupoSelect) {
    estoqueGrupoSelect.addEventListener('change', () => {
      carregarSaldosEstoque();
    });
  }

  if (estoqueFiltroSelect) {
    estoqueFiltroSelect.addEventListener('change', () => {
      carregarSaldosEstoque();
    });
  }

  if (btnLimparFiltrosEstoque) {
    btnLimparFiltrosEstoque.addEventListener('click', () => {
      if (estoqueBuscaInput) estoqueBuscaInput.value = '';
      if (estoqueEmpresaSelect) estoqueEmpresaSelect.value = 'todos';
      if (estoqueGrupoSelect) estoqueGrupoSelect.value = 'todos';
      if (estoqueFiltroSelect) estoqueFiltroSelect.value = 'todos';
      carregarSaldosEstoque();
    });
  }

  if (btnExportEstoqueExcel) {
    btnExportEstoqueExcel.addEventListener('click', exportarEstoqueParaExcel);
  }

  // Disparo manual de sincronização
  if (btnSyncEstoqueManual) {
    btnSyncEstoqueManual.addEventListener('click', async () => {
      btnSyncEstoqueManual.disabled = true;
      const originalHtml = btnSyncEstoqueManual.innerHTML;
      btnSyncEstoqueManual.innerHTML = '<span class="spinner" style="display:inline-block; width:14px; height:14px; border:2px solid #fff; border-top-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite;"></span> Sincronizando...';

      try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/vendedores/estoque/sync', {
          method: 'POST',
          headers: token ? { 'Authorization': `Bearer ${token}` } : {}
        });
        const json = await res.json();

        if (json.success) {
          alert(`✅ Sincronização concluída com sucesso!\nTotal: ${json.detalhes?.count || 0} produtos sincronizados em ${json.detalhes?.duracao_ms || 0}ms.`);
          await carregarSaldosEstoque(true);
        } else {
          alert(json.message || 'Erro ao sincronizar estoque.');
        }
      } catch (e) {
        alert('Erro ao disparar sincronização: ' + e.message);
      } finally {
        btnSyncEstoqueManual.disabled = false;
        btnSyncEstoqueManual.innerHTML = originalHtml;
      }
    });
  }

  // Alternância de Tema Claro/Escuro no Módulo Vendedores e Compras
  if (btnToggleThemeEstoque) {
    btnToggleThemeEstoque.addEventListener('click', toggleVendedoresTheme);
  }
  if (btnToggleThemeVendedores) {
    btnToggleThemeVendedores.addEventListener('click', toggleVendedoresTheme);
  }
  if (btnToggleThemeCompras) {
    btnToggleThemeCompras.addEventListener('click', toggleVendedoresTheme);
  }
  inicializarTemaVendedores();

  // Event Delegation para drilldown na tabela de saldos de estoque (Prevenção de vazamento de memória)
  const estoqueTableBody = document.getElementById('estoqueTableBody');
  if (estoqueTableBody) {
    estoqueTableBody.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-codigo]');
      if (tr) {
        const cod = tr.getAttribute('data-codigo');
        if (cod) abrirModalEstoqueDetalhes(cod);
      }
    });
  }

  // Modal Drilldown por Produto
  window.abrirModalEstoqueDetalhes = function(codigo) {
    const prod = estoqueProdutosData.find(p => p.codigo === codigo);
    if (!prod || !modalEstoqueDetalhes) return;
    estoqueItemSelecionado = prod;

    const isLight = document.getElementById('tab-vend-saldos-estoque')?.classList.contains('tab-theme-light');
    if (isLight) {
      modalEstoqueDetalhes.classList.add('modal-theme-light');
    } else {
      modalEstoqueDetalhes.classList.remove('modal-theme-light');
    }

    const modalTitulo = document.getElementById('modalEstoqueTitulo');
    const modalSub = document.getElementById('modalEstoqueSubtitulo');
    const kpiPrc = document.getElementById('modalKpiPreco');
    const kpiSld = document.getElementById('modalKpiSaldo');
    const kpiTot = document.getElementById('modalKpiValorTotal');
    const kpiPto = document.getElementById('modalKpiPontoPed');

    if (modalTitulo) modalTitulo.textContent = prod.descricao || 'Detalhes do Produto';
    if (modalSub) modalSub.textContent = `Código Protheus: ${prod.codigo}${prod.grupo ? ' | Grupo: ' + prod.grupo : ''}`;
    if (kpiPrc) kpiPrc.textContent = Number(prod.preco || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    if (kpiSld) kpiSld.textContent = `${Number(prod.saldo || 0).toLocaleString('pt-BR')} un`;
    if (kpiTot) kpiTot.textContent = Number(prod.saldo_total || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    if (kpiPto) kpiPto.textContent = `${Number(prod.ponto_ped || 0).toLocaleString('pt-BR')} un`;

    // 1. Preenche Resumo por Empresa
    const tbodyEmp = document.getElementById('modalTbodyEmpresas');
    if (tbodyEmp) {
      const dets = prod.detalhes_empresas || {};
      const emps = [
        { cod: "14", nome: "Empresa 14 (Metal Pleno)", data: dets['14'] || {} },
        { cod: "15", nome: "Empresa 15 (GSI)", data: dets['15'] || {} },
        { cod: "16", nome: "Empresa 16 (OACO)", data: dets['16'] || {} }
      ];

      tbodyEmp.innerHTML = emps.map(e => {
        const saldoNum = Number(e.data.saldo || 0);
        const saldoColor = saldoNum > 0 ? (isLight ? '#059669' : '#10b981') : (isLight ? '#dc2626' : '#ef4444');
        const vendasColor = Number(e.data.vendas || 0) > 0 ? (isLight ? '#d97706' : '#fbbf24') : (isLight ? '#64748b' : 'var(--text-muted)');
        const comprasColor = Number(e.data.compras || 0) > 0 ? (isLight ? '#0284c7' : '#38bdf8') : (isLight ? '#64748b' : 'var(--text-muted)');

        return `
          <tr>
            <td><strong>${e.nome}</strong></td>
            <td style="text-align: right; font-weight: 700; color: ${saldoColor};">
              ${saldoNum.toLocaleString('pt-BR')} un
            </td>
            <td style="text-align: right; font-weight: 600; color: ${vendasColor};">
              ${Number(e.data.vendas || 0).toLocaleString('pt-BR')} un
            </td>
            <td style="text-align: right; font-weight: 600; color: ${comprasColor};">
              ${Number(e.data.compras || 0).toLocaleString('pt-BR')} un
            </td>
          </tr>
        `;
      }).join('');
    }

    // 2. Preenche Lista de Compras Abertas (SC7)
    const tbodyCom = document.getElementById('modalTbodyCompras');
    if (tbodyCom) {
      const dets = prod.detalhes_empresas || {};
      const todasCompras = [
        ...(dets['14']?.comprasLista || []),
        ...(dets['15']?.comprasLista || []),
        ...(dets['16']?.comprasLista || [])
      ];

      const linkColor = isLight ? '#0284c7' : '#38bdf8';
      const badgeBg = isLight ? 'rgba(2, 132, 199, 0.1)' : 'rgba(56, 189, 248, 0.15)';
      const badgeColor = isLight ? '#0284c7' : '#38bdf8';

      if (todasCompras.length === 0) {
        tbodyCom.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 1.5rem; color: var(--text-muted);">Nenhum pedido de compra em aberto para este produto.</td></tr>';
      } else {
        tbodyCom.innerHTML = todasCompras.map(c => `
          <tr>
            <td><strong style="color: ${linkColor};">${c.pedido || '-'}</strong></td>
            <td><span class="badge" style="background: ${badgeBg}; color: ${badgeColor}; padding: 2px 6px; border-radius: 4px;">${c.empresa || '-'}</span></td>
            <td>${c.fornecedor || 'FORNECEDOR NÃO INFORMADO'}</td>
            <td style="text-align: right;">${Number(c.qtdComprada || 0).toLocaleString('pt-BR')}</td>
            <td style="text-align: right;">${Number(c.qtdEntregue || 0).toLocaleString('pt-BR')}</td>
            <td style="text-align: right; font-weight: 700; color: ${linkColor};">${Number(c.saldoCompra || 0).toLocaleString('pt-BR')}</td>
            <td>📅 ${c.previsao || '-'}</td>
          </tr>
        `).join('');
      }
    }

    // 3. Preenche Lista de Vendas Abertas (SC6)
    const tbodyVen = document.getElementById('modalTbodyVendas');
    if (tbodyVen) {
      const dets = prod.detalhes_empresas || {};
      const todasVendas = [
        ...(dets['14']?.vendasLista || []),
        ...(dets['15']?.vendasLista || []),
        ...(dets['16']?.vendasLista || [])
      ];

      const linkColor = isLight ? '#0284c7' : '#38bdf8';
      const badgeBg = isLight ? 'rgba(5, 150, 105, 0.1)' : 'rgba(16, 185, 129, 0.15)';
      const badgeColor = isLight ? '#059669' : '#10b981';
      const vendasColor = isLight ? '#d97706' : '#fbbf24';

      if (todasVendas.length === 0) {
        tbodyVen.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 1.5rem; color: var(--text-muted);">Nenhum pedido de venda em carteira para este produto.</td></tr>';
      } else {
        tbodyVen.innerHTML = todasVendas.map(v => `
          <tr>
            <td><strong>#${v.pedido || '-'}</strong></td>
            <td>${v.codWeb && v.codWeb !== '-' ? `<span style="color: ${linkColor};">${v.codWeb}</span>` : '-'}</td>
            <td><span class="badge" style="background: ${badgeBg}; color: ${badgeColor}; padding: 2px 6px; border-radius: 4px;">${v.empresa || '-'}</span></td>
            <td>${v.cliente || 'CLIENTE NÃO INFORMADO'}</td>
            <td>${v.vendedor || 'NÃO INFORMADO'}</td>
            <td style="text-align: right; font-weight: 700; color: ${vendasColor};">${Number(v.qtdPedida || 0).toLocaleString('pt-BR')} un</td>
            <td>📅 ${v.previsao || '-'}</td>
          </tr>
        `).join('');
      }
    }

    // Reseta para a 1ª aba interna da modal
    document.querySelectorAll('.btn-modal-estoque-tab').forEach((b, idx) => {
      b.classList.toggle('active', idx === 0);
    });
    document.querySelectorAll('.modal-estoque-tab-pane').forEach((p, idx) => {
      p.classList.toggle('hidden', idx !== 0);
    });

    modalEstoqueDetalhes.classList.remove('hidden');
  };

  // Chaveamento de abas dentro da modal de estoque
  document.querySelectorAll('.btn-modal-estoque-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      document.querySelectorAll('.btn-modal-estoque-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.modal-estoque-tab-pane').forEach(p => {
        p.classList.toggle('hidden', p.id !== targetId);
      });
    });
  });

  const fecharModalEstoque = () => {
    if (modalEstoqueDetalhes) modalEstoqueDetalhes.classList.add('hidden');
  };
  if (btnCloseModalEstoque) btnCloseModalEstoque.addEventListener('click', fecharModalEstoque);
  if (btnFecharModalEstoqueDetalhes) btnFecharModalEstoqueDetalhes.addEventListener('click', fecharModalEstoque);
  if (modalEstoqueDetalhes) {
    modalEstoqueDetalhes.addEventListener('click', (e) => {
      if (e.target === modalEstoqueDetalhes) fecharModalEstoque();
    });
  }

  // =========================================================================
  // MÓDULO ASSISTENTE FINANCEIRO — CONCILIAÇÃO BANCÁRIA INTER (077) X PROTHEUS
  // =========================================================================

  const concilDataRef = document.getElementById('concilDataRef');
  const btnChipUltimoUtil = document.getElementById('btnChipUltimoUtil');
  const btnChipD2 = document.getElementById('btnChipD2');
  const btnChipD3 = document.getElementById('btnChipD3');
  const concilEmpresaSelect = document.getElementById('concilEmpresaSelect');
  const btnExecutarConciliacao = document.getElementById('btnExecutarConciliacao');
  const btnOpenInterConfig = document.getElementById('btnOpenInterConfig');

  const concilIdleState = document.getElementById('concilIdleState');
  const concilLoadingState = document.getElementById('concilLoadingState');
  const concilLoadingMsg = document.getElementById('concilLoadingMsg');
  const concilResultsSection = document.getElementById('concilResultsSection');
  const concilResumoDataTexto = document.getElementById('concilResumoDataTexto');
  const btnRecarregarConciliacao = document.getElementById('btnRecarregarConciliacao');
  const concilCardsContainer = document.getElementById('concilCardsContainer');

  const concilDiagnosticoSection = document.getElementById('concilDiagnosticoSection');
  const diagEmpresaTitulo = document.getElementById('diagEmpresaTitulo');
  const diagPeriodoSubtitulo = document.getElementById('diagPeriodoSubtitulo');
  const btnFecharDiagnostico = document.getElementById('btnFecharDiagnostico');
  const diagContentView = document.getElementById('diagContentView');
  const diagTabBtns = document.querySelectorAll('.diag-tab-btn');

  const badgeCountCartao = document.getElementById('badgeCountCartao');
  const badgeCountAgrupados = document.getElementById('badgeCountAgrupados');
  const badgeCountOrfaosP = document.getElementById('badgeCountOrfaosP');
  const badgeCountOrfaosB = document.getElementById('badgeCountOrfaosB');
  const badgeCount11 = document.getElementById('badgeCount11');

  const interConfigModal = document.getElementById('interConfigModal');
  const interConfigModalBody = document.getElementById('interConfigModalBody');
  const btnCloseInterConfigModal = document.getElementById('btnCloseInterConfigModal');
  const btnConfirmInterConfigModal = document.getElementById('btnConfirmInterConfigModal');

  let currentConciliacaoData = null;
  let currentDiagnosticoData = null;
  let currentDiagView = 'orfaosBanco';

  /**
   * Calcula o dia útil anterior pulando fins de semana (offset = 1 -> último útil, offset = 2 -> D-2 útil, etc.)
   */
  function getPreviousBusinessDate(offset = 1) {
    const d = new Date();
    let count = 0;
    while (count < offset) {
      d.setDate(d.getDate() - 1);
      const day = d.getDay();
      if (day !== 0 && day !== 6) { // Pula Domingo (0) e Sábado (6)
        count++;
      }
    }
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function formatDisplayDate(dateIso) {
    if (!dateIso) return '-';
    if (dateIso.length === 8 && !dateIso.includes('-')) {
      return `${dateIso.slice(6,8)}/${dateIso.slice(4,6)}/${dateIso.slice(0,4)}`;
    }
    const parts = dateIso.split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return dateIso;
  }

  /**
   * Inicializa a aba de Conciliação Bancária
   */
  function initConciliacaoBancaria() {
    if (concilDataRef && !concilDataRef.value) {
      concilDataRef.value = getPreviousBusinessDate(1);
    }
  }

  // Chips de seleção rápida de data
  if (btnChipUltimoUtil) {
    btnChipUltimoUtil.addEventListener('click', () => {
      document.querySelectorAll('.quick-date-chips .btn-chip').forEach(c => c.classList.remove('active'));
      btnChipUltimoUtil.classList.add('active');
      if (concilDataRef) concilDataRef.value = getPreviousBusinessDate(1);
    });
  }

  if (btnChipD2) {
    btnChipD2.addEventListener('click', () => {
      document.querySelectorAll('.quick-date-chips .btn-chip').forEach(c => c.classList.remove('active'));
      btnChipD2.classList.add('active');
      if (concilDataRef) concilDataRef.value = getPreviousBusinessDate(2);
    });
  }

  if (btnChipD3) {
    btnChipD3.addEventListener('click', () => {
      document.querySelectorAll('.quick-date-chips .btn-chip').forEach(c => c.classList.remove('active'));
      btnChipD3.classList.add('active');
      if (concilDataRef) concilDataRef.value = getPreviousBusinessDate(3);
    });
  }

  /**
   * Executa a Conciliação de Saldos
   */
  async function executarConciliacaoAction() {
    const dataRef = (concilDataRef && concilDataRef.value) ? concilDataRef.value : getPreviousBusinessDate(1);
    const empresaSel = (concilEmpresaSelect && concilEmpresaSelect.value) ? concilEmpresaSelect.value : 'ALL';

    if (concilIdleState) concilIdleState.classList.add('hidden');
    if (concilResultsSection) concilResultsSection.classList.add('hidden');
    if (concilDiagnosticoSection) concilDiagnosticoSection.classList.add('hidden');
    if (concilLoadingState) {
      concilLoadingState.classList.remove('hidden');
      if (concilLoadingMsg) concilLoadingMsg.textContent = `Consultando saldos SE8 no Protheus e extrato do Banco Inter para a data ${formatDisplayDate(dataRef)}...`;
    }

    try {
      const res = await fetch(`/api/financeiro/conciliacao?data=${dataRef}&empresa=${empresaSel}`);
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Erro ao consultar saldos de conciliação.');
      }

      currentConciliacaoData = data;
      renderConciliacaoCards(data.empresas || [], data.dataReferenciaIso);

      if (concilResumoDataTexto) {
        concilResumoDataTexto.textContent = `Data de Fechamento Avaliada: ${formatDisplayDate(data.dataReferenciaIso)} (${data.empresas.length} empresa${data.empresas.length > 1 ? 's' : ''})`;
      }

      if (concilResultsSection) concilResultsSection.classList.remove('hidden');
    } catch (err) {
      alert(`⚠️ Erro ao executar conciliação: ${err.message}`);
      if (concilIdleState) concilIdleState.classList.remove('hidden');
    } finally {
      if (concilLoadingState) concilLoadingState.classList.add('hidden');
    }
  }

  if (btnExecutarConciliacao) btnExecutarConciliacao.addEventListener('click', executarConciliacaoAction);
  if (btnRecarregarConciliacao) btnRecarregarConciliacao.addEventListener('click', executarConciliacaoAction);

  /**
   * Renderiza os Cards de Saldos das Empresas
   */
  function renderConciliacaoCards(empresas, dataRefIso) {
    if (!concilCardsContainer) return;
    concilCardsContainer.innerHTML = '';

    if (!empresas || empresas.length === 0) {
      concilCardsContainer.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1; padding: 2rem; text-align: center; color: var(--text-muted);">Nenhuma conta encontrada para os parâmetros informados.</div>`;
      return;
    }

    empresas.forEach(emp => {
      const card = document.createElement('div');
      const isOk = emp.status === 'OK';
      const isDivergente = emp.status === 'DIVERGENTE';
      const isPendente = emp.status === 'PENDENTE_INTER';
      const isErro = emp.status === 'ERRO' || emp.status === 'ERRO_INTER';

      let statusClass = 'status-card-divergente';
      let badgeHtml = '';

      if (isOk) {
        statusClass = 'status-card-ok';
        badgeHtml = `<span class="badge-status-ok">🟢 SALDO OK</span>`;
      } else if (isPendente) {
        statusClass = 'status-card-divergente';
        badgeHtml = `<span class="badge-status-erro" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border-color: rgba(245, 158, 11, 0.3);">🟡 AGUARDANDO INTER</span>`;
      } else if (isErro) {
        statusClass = 'status-card-erro';
        badgeHtml = `<span class="badge-status-erro">⚠️ ERRO API INTER</span>`;
      } else {
        statusClass = 'status-card-divergente';
        badgeHtml = `<span class="badge-status-divergente">🔴 DIVERGÊNCIA</span>`;
      }

      let saldoBancoHtml = '<span class="concil-metric-val" style="color: var(--text-muted); font-size: 0.95rem;">Aguardando...</span>';
      let diffHtml = '<span class="concil-diff-val" style="color: var(--text-muted);">--</span>';

      if (emp.saldoBanco !== null && emp.saldoBanco !== undefined) {
        saldoBancoHtml = `<span class="concil-metric-val">${formatCurrency(emp.saldoBanco)}</span>`;
        const diffVal = emp.diferenca || 0;
        const diffClass = Math.abs(diffVal) < 0.01 ? 'diff-val-zero' : 'diff-val-alert';
        const diffSinal = diffVal > 0 ? '+' : '';
        diffHtml = `<span class="concil-diff-val ${diffClass}">${diffSinal}${formatCurrency(diffVal)}</span>`;
      }

      const dataSaldoProtheusFmt = formatDisplayDate(emp.dataUltimoSaldoProtheus || emp.dataReferenciaYmd);

      card.className = `concil-card ${statusClass}`;
      card.innerHTML = `
        <div class="concil-card-header">
          <div class="concil-empresa-info">
            <h4>
              <span>🏢 ${escapeHtml(emp.empresaNome)}</span>
            </h4>
            <span class="concil-conta-badge">Banco Inter (077) • Ag. ${escapeHtml(emp.agencia || '0001')} / Conta: ${escapeHtml(emp.contaFormatada || emp.conta)}</span>
          </div>
          <div>${badgeHtml}</div>
        </div>

        <div class="concil-metrics-grid">
          <div class="concil-metric-box">
            <span class="concil-metric-label">Saldo Protheus (SE8)</span>
            <span class="concil-metric-val" style="color: ${emp.saldoProtheus < 0 ? '#f87171' : 'var(--text-primary)'};">${formatCurrency(emp.saldoProtheus)}</span>
          </div>
          <div class="concil-metric-box">
            <span class="concil-metric-label">Saldo Banco Inter</span>
            ${saldoBancoHtml}
          </div>
          <div class="concil-diff-box">
            <span class="concil-metric-label">Diferença de Saldo:</span>
            ${diffHtml}
          </div>
        </div>

        ${emp.statusBancoMsg ? `
          <div style="font-size: 0.73rem; color: var(--text-muted); background: rgba(0,0,0,0.2); padding: 4px 8px; border-radius: 4px;">
            ℹ️ ${escapeHtml(emp.statusBancoMsg)}
          </div>
        ` : ''}

        <div class="concil-card-footer">
          <span class="concil-meta-date">Fechamento SE8: <strong>${dataSaldoProtheusFmt}</strong></span>
          <button class="btn ${isOk ? 'btn-outline btn-sm' : 'btn-primary btn-sm'} btn-analisar-divergencia" data-empresa="${emp.empresaCodigo}" data-empresa-nome="${escapeHtml(emp.empresaNome)}">
            ${isOk ? '📋 Inspecionar Lançamentos' : '🔍 Analisar Divergência & Lançamentos'}
          </button>
        </div>
      `;

      // Event listener do botão de auditoria da empresa
      const btnAnalisar = card.querySelector('.btn-analisar-divergencia');
      if (btnAnalisar) {
        btnAnalisar.addEventListener('click', () => {
          abrirDiagnosticoEmpresa(emp.empresaCodigo, emp.empresaNome, emp.dataReferenciaIso);
        });
      }

      concilCardsContainer.appendChild(card);
    });
  }

  /**
   * Abre o painel de Diagnóstico e Auditoria Detalhada de Lançamentos
   */
  async function abrirDiagnosticoEmpresa(empresaCodigo, empresaNome, dataRefIso) {
    if (concilDiagnosticoSection) {
      concilDiagnosticoSection.classList.remove('hidden');
      concilDiagnosticoSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    if (diagEmpresaTitulo) {
      diagEmpresaTitulo.innerHTML = `<span>🔍 Diagnóstico de Lançamentos — Empresa ${empresaCodigo} (${escapeHtml(empresaNome)})</span>`;
    }
    if (diagPeriodoSubtitulo) {
      diagPeriodoSubtitulo.textContent = `Carregando movimentações Protheus (SE5) e Extrato do Banco Inter até ${formatDisplayDate(dataRefIso)}...`;
    }
    if (diagContentView) {
      diagContentView.innerHTML = `
        <div style="padding: 2.5rem; text-align: center;">
          <div class="spinner"></div>
          <p style="margin-top: 1rem; color: var(--text-muted);">Processando algoritmo de conciliação 1:1 e agrupamentos N:1...</p>
        </div>
      `;
    }

    try {
      const res = await fetch(`/api/financeiro/diagnostico?empresa=${empresaCodigo}&data=${dataRefIso}&dias=3`);
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Erro ao carregar diagnóstico.');
      }

      currentDiagnosticoData = data;

      if (diagPeriodoSubtitulo) {
        diagPeriodoSubtitulo.textContent = `Período Analisado: ${formatDisplayDate(data.periodo.inicio)} a ${formatDisplayDate(data.periodo.fim)} • ${data.lancamentosProtheusTotal} lançamentos no Protheus, ${data.transacoesBancoTotal} no Banco`;
      }

      // Atualiza badges de contagem
      if (badgeCountCartao) badgeCountCartao.textContent = data.resumo.totalCartaoLiquido || 0;
      if (badgeCountAgrupados) badgeCountAgrupados.textContent = data.resumo.totalAgrupadosN_1 || 0;
      if (badgeCountOrfaosP) badgeCountOrfaosP.textContent = data.resumo.totalOrfaosProtheus || 0;
      if (badgeCountOrfaosB) badgeCountOrfaosB.textContent = data.resumo.totalOrfaosBanco || 0;
      if (badgeCount11) badgeCount11.textContent = data.resumo.totalConciliados1_1 || 0;

      // Define aba inicial padrão como a 1ª aba (orfaosBanco - Faltantes no Protheus)
      currentDiagView = 'orfaosBanco';
      diagTabBtns.forEach(b => b.classList.remove('active'));
      const defaultTab = document.querySelector('.diag-tab-btn[data-diag-view="orfaosBanco"]');
      if (defaultTab) defaultTab.classList.add('active');

      // Renderiza a view inicial
      renderDiagnosticoView(currentDiagView);
    } catch (err) {
      if (diagContentView) {
        diagContentView.innerHTML = `<div class="empty-state" style="padding: 2rem; text-align: center; color: #f87171;">⚠️ Falha ao carregar auditoria: ${escapeHtml(err.message)}</div>`;
      }
    }
  }

  // Alternador de sub-abas do diagnóstico
  diagTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      diagTabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.getAttribute('data-diag-view');
      currentDiagView = view;
      renderDiagnosticoView(view);
    });
  });

  if (btnFecharDiagnostico) {
    btnFecharDiagnostico.addEventListener('click', () => {
      if (concilDiagnosticoSection) concilDiagnosticoSection.classList.add('hidden');
    });
  }

  /**
   * Renderiza a visualização selecionada no painel de diagnóstico
   */
  function renderDiagnosticoView(tipo) {
    if (!diagContentView || !currentDiagnosticoData) return;

    if (tipo === 'cartao') {
      const cartoes = (currentDiagnosticoData.gruposConciliados || []).filter(g => g.tipo === 'CARTAO_LIQUIDO');
      if (cartoes.length === 0) {
        diagContentView.innerHTML = `
          <div style="padding: 2rem; text-align: center; color: var(--text-muted);">
            <div style="font-size: 1.8rem; margin-bottom: 0.5rem;">💳</div>
            <p>Nenhuma venda de cartão ou domicílio com desconto de taxa identificada neste período.</p>
          </div>
        `;
        return;
      }

      let html = `<div style="display: flex; flex-direction: column; gap: 1rem;">`;
      cartoes.forEach((grp) => {
        const bancoItem = grp.bancoItems[0] || {};
        const pCred = grp.protheusItems.find(p => p.tipoOperacao === 'C') || {};
        const pDeb = grp.protheusItems.find(p => p.tipoOperacao === 'D') || {};

        html += `
          <div class="lote-card" style="border-left: 4px solid #a855f7; background: rgba(30, 27, 75, 0.25);">
            <div class="lote-header">
              <div>
                <span class="lote-banco-badge" style="background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.4);">
                  💳 Banco Inter • Crédito Líquido ${formatCurrency(grp.valorTotal)}
                </span>
                <span style="font-size: 0.8rem; color: var(--text-muted); margin-left: 0.5rem;">
                  Data: <strong>${formatDisplayDate(grp.dataBanco)}</strong> | ${escapeHtml(bancoItem.titulo || bancoItem.descricao || 'Credito Domicilio T.o.p')}
                </span>
              </div>
              <div>
                <span style="font-size: 0.78rem; font-weight: 700; color: #10b981; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); padding: 3px 8px; border-radius: 4px;">
                  🟢 Conciliado (Bruto - Taxa)
                </span>
              </div>
            </div>

            <!-- Equação Visual da Conciliação de Cartão -->
            <div style="margin: 0.75rem 0; padding: 0.75rem 1rem; background: rgba(15, 23, 42, 0.5); border-radius: 6px; border: 1px dashed rgba(168, 85, 247, 0.3); display: flex; align-items: center; justify-content: space-around; flex-wrap: wrap; gap: 0.5rem; font-size: 0.85rem;">
              <div style="text-align: center;">
                <span style="display: block; font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">(+) Venda Bruta Protheus</span>
                <strong style="color: #10b981; font-size: 0.95rem;">${formatCurrency(grp.valorBruto)}</strong>
              </div>
              <span style="color: var(--text-muted); font-size: 1.2rem; font-weight: 700;">−</span>
              <div style="text-align: center;">
                <span style="display: block; font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">(−) Taxa Cartão/MDR</span>
                <strong style="color: #f87171; font-size: 0.95rem;">${formatCurrency(grp.valorTaxa)}</strong>
              </div>
              <span style="color: var(--text-muted); font-size: 1.2rem; font-weight: 700;">=</span>
              <div style="text-align: center;">
                <span style="display: block; font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">(=) Crédito Líquido no Banco</span>
                <strong style="color: #c084fc; font-size: 0.95rem;">${formatCurrency(grp.valorTotal)}</strong>
              </div>
            </div>

            <div class="lote-protheus-items">
              <span style="font-size: 0.75rem; font-weight: 700; color: #a855f7; text-transform: uppercase; letter-spacing: 0.04em;">
                ↳ Lançamentos Compensados no ERP Protheus (SE5):
              </span>
              
              <!-- Linha do Crédito Bruto -->
              <div class="lote-item-row" style="background: rgba(16, 185, 129, 0.08); border-left: 3px solid #10b981; padding: 6px 10px; border-radius: 6px;">
                <div>
                  <span style="color: #10b981; font-weight: 700; margin-right: 6px;">[ + RECEBIMENTO ]</span>
                  <span style="color: var(--text-primary); font-weight: 600;">${escapeHtml(pCred.historico || 'Valor recebido s/ Titulo')}</span>
                  ${pCred.beneficiario ? `<span style="font-size: 0.75rem; color: var(--text-muted); margin-left: 6px;">(${escapeHtml(pCred.beneficiario)})</span>` : ''}
                </div>
                <div>
                  <span style="font-size: 0.75rem; color: var(--text-muted); margin-right: 8px;">${formatDisplayDate(pCred.dataIso || pCred.data)}</span>
                  <strong style="color: #10b981;">+ ${formatCurrency(pCred.valor)}</strong>
                </div>
              </div>

              <!-- Linha do Débito da Taxa -->
              <div class="lote-item-row" style="background: rgba(239, 68, 68, 0.08); border-left: 3px solid #f87171; padding: 6px 10px; border-radius: 6px;">
                <div>
                  <span style="color: #f87171; font-weight: 700; margin-right: 6px;">[ − TAXA CARTÃO ]</span>
                  <span style="color: var(--text-primary); font-weight: 600;">${escapeHtml(pDeb.historico || 'Desconto taxa cartão')}</span>
                  ${pDeb.beneficiario ? `<span style="font-size: 0.75rem; color: var(--text-muted); margin-left: 6px;">(${escapeHtml(pDeb.beneficiario)})</span>` : ''}
                </div>
                <div>
                  <span style="font-size: 0.75rem; color: var(--text-muted); margin-right: 8px;">${formatDisplayDate(pDeb.dataIso || pDeb.data)}</span>
                  <strong style="color: #f87171;">− ${formatCurrency(pDeb.valor)}</strong>
                </div>
              </div>
            </div>
          </div>
        `;
      });
      html += `</div>`;
      diagContentView.innerHTML = html;

    } else if (tipo === 'agrupados') {
      const agrupados = (currentDiagnosticoData.gruposConciliados || []).filter(g => g.tipo === 'N:1');
      if (agrupados.length === 0) {
        diagContentView.innerHTML = `
          <div style="padding: 2rem; text-align: center; color: var(--text-muted);">
            <div style="font-size: 1.8rem; margin-bottom: 0.5rem;">📦</div>
            <p>Nenhum lote com múltiplos lançamentos no Protheus agrupado para um único pagamento bancário neste período.</p>
          </div>
        `;
        return;
      }

      let html = `<div style="display: flex; flex-direction: column; gap: 1rem;">`;
      agrupados.forEach((grp, idx) => {
        const bancoItem = grp.bancoItems[0] || {};
        const tipoDesc = grp.tipoOperacao === 'D' ? 'Débito / Pagamento' : 'Crédito / Recebimento';
        const tipoColor = grp.tipoOperacao === 'D' ? '#f87171' : '#10b981';

        html += `
          <div class="lote-card">
            <div class="lote-header">
              <div>
                <span class="lote-banco-badge">🏦 Banco Inter • 1 Transação de ${formatCurrency(grp.valorTotal)}</span>
                <span style="font-size: 0.8rem; color: var(--text-muted); margin-left: 0.5rem;">Data: <strong>${formatDisplayDate(grp.dataBanco)}</strong> | ${escapeHtml(bancoItem.titulo || bancoItem.descricao || '')}</span>
              </div>
              <div>
                <span style="font-size: 0.78rem; font-weight: 700; color: ${tipoColor}; background: rgba(255,255,255,0.05); padding: 2px 8px; border-radius: 4px;">
                  ${grp.protheusItems.length} Lançamentos no Protheus somam exatamente este valor
                </span>
              </div>
            </div>

            <div class="lote-protheus-items">
              <span style="font-size: 0.75rem; font-weight: 700; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.04em;">
                ↳ Lançamentos Vinculados no ERP Protheus (SE5):
              </span>
              ${grp.protheusItems.map(p => `
                <div class="lote-item-row" style="background: rgba(0,0,0,0.2); padding: 6px 10px; border-radius: 6px;">
                  <div>
                    <span style="color: var(--text-primary); font-weight: 600;">${escapeHtml(p.historico || 'Lançamento')}</span>
                    ${p.beneficiario ? `<span style="font-size: 0.75rem; color: var(--text-muted); margin-left: 6px;">(${escapeHtml(p.beneficiario)})</span>` : ''}
                    ${p.documento ? `<span style="font-size: 0.72rem; color: #94a3b8; margin-left: 6px;">Doc: ${escapeHtml(p.documento)}</span>` : ''}
                  </div>
                  <div>
                    <span style="font-size: 0.75rem; color: var(--text-muted); margin-right: 8px;">${formatDisplayDate(p.dataIso || p.data)}</span>
                    <strong>${formatCurrency(p.valor)}</strong>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      });
      html += `</div>`;
      diagContentView.innerHTML = html;

    } else if (tipo === 'orfaosProtheus') {
      const orfaosP = currentDiagnosticoData.orfaosProtheus || [];
      if (orfaosP.length === 0) {
        diagContentView.innerHTML = `<div style="padding: 2rem; text-align: center; color: #10b981;">✅ Todos os lançamentos do Protheus foram localizados no extrato bancário.</div>`;
        return;
      }

      let html = `
        <div style="margin-bottom: 0.5rem; font-size: 0.82rem; color: var(--text-muted);">
          Estes lançamentos constam na tabela <code>SE5</code> do Protheus, mas <strong>NÃO</strong> foram identificados no extrato do Banco Inter:
        </div>
        <div class="table-container" style="max-height: 400px; overflow-y: auto;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Tipo</th>
                <th>Documento</th>
                <th>Histórico / Beneficiário</th>
                <th style="text-align: right;">Valor (R$)</th>
              </tr>
            </thead>
            <tbody>
      `;
      orfaosP.forEach(p => {
        const isCredito = p.tipoOperacao === 'C';
        html += `
          <tr>
            <td>${formatDisplayDate(p.dataIso || p.data)}</td>
            <td><span class="tag-count" style="color: ${isCredito ? '#10b981' : '#f87171'}; font-weight: 700;">${isCredito ? 'CRÉDITO' : 'DÉBITO'}</span></td>
            <td><code>${escapeHtml(p.documento || '-')}</code></td>
            <td><strong>${escapeHtml(p.historico || '-')}</strong> ${p.beneficiario ? `<br><small style="color: var(--text-muted);">${escapeHtml(p.beneficiario)}</small>` : ''}</td>
            <td style="text-align: right; font-weight: 700; font-family: 'JetBrains Mono', monospace; color: ${isCredito ? '#10b981' : '#f87171'};">${formatCurrency(p.valor)}</td>
          </tr>
        `;
      });
      html += `</tbody></table></div>`;
      diagContentView.innerHTML = html;

    } else if (tipo === 'orfaosBanco') {
      const orfaosB = currentDiagnosticoData.orfaosBanco || [];
      if (orfaosB.length === 0) {
        diagContentView.innerHTML = `<div style="padding: 2rem; text-align: center; color: #10b981;">✅ Todas as transações do extrato do Banco Inter foram localizadas no Protheus.</div>`;
        return;
      }

      let html = `
        <div style="margin-bottom: 0.5rem; font-size: 0.82rem; color: var(--text-muted);">
          Estas transações constam no extrato do <strong>Banco Inter</strong>, mas <strong>NÃO</strong> foram identificadas no Protheus (possível lançamento pendente de digitação):
        </div>
        <div class="table-container" style="max-height: 400px; overflow-y: auto;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Tipo</th>
                <th>Transação / Título</th>
                <th>Cliente Provável (Extrato)</th>
                <th style="text-align: right;">Valor (R$)</th>
              </tr>
            </thead>
            <tbody>
      `;
      orfaosB.forEach(b => {
        const isCredito = b.tipoOperacao === 'C';
        const clienteProvavel = b.descricao || b.detalhes || b.titulo || '-';
        html += `
          <tr>
            <td>${formatDisplayDate(b.dataIso || b.data)}</td>
            <td><span class="tag-count" style="color: ${isCredito ? '#10b981' : '#f87171'}; font-weight: 700;">${isCredito ? 'CRÉDITO' : 'DÉBITO'}</span></td>
            <td><strong>${escapeHtml(b.titulo || 'Transação')}</strong></td>
            <td><span style="color: var(--text-primary); font-weight: 600;">${escapeHtml(clienteProvavel)}</span></td>
            <td style="text-align: right; font-weight: 700; font-family: 'JetBrains Mono', monospace; color: ${isCredito ? '#10b981' : '#f87171'};">${formatCurrency(b.valor)}</td>
          </tr>
        `;
      });
      html += `</tbody></table></div>`;
      diagContentView.innerHTML = html;

    } else if (tipo === 'conciliados11') {
      const conc11 = (currentDiagnosticoData.gruposConciliados || []).filter(g => g.tipo === '1:1');
      if (conc11.length === 0) {
        diagContentView.innerHTML = `<div style="padding: 2rem; text-align: center; color: var(--text-muted);">Nenhum lançamento 1:1 registrado.</div>`;
        return;
      }

      let html = `
        <div class="table-container" style="max-height: 400px; overflow-y: auto;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Tipo</th>
                <th>Lançamento Protheus</th>
                <th>Transação Banco Inter</th>
                <th style="text-align: right;">Valor (R$)</th>
                <th style="text-align: center;">Status</th>
              </tr>
            </thead>
            <tbody>
      `;
      conc11.forEach(g => {
        const p = g.protheusItems[0] || {};
        const b = g.bancoItems[0] || {};
        const isCredito = g.tipoOperacao === 'C';
        html += `
          <tr>
            <td>${formatDisplayDate(g.dataBanco)}</td>
            <td><span class="tag-count" style="color: ${isCredito ? '#10b981' : '#f87171'}; font-weight: 700;">${isCredito ? 'CRÉDITO' : 'DÉBITO'}</span></td>
            <td>${escapeHtml(p.historico || '-')} ${p.beneficiario ? `<br><small style="color: var(--text-muted);">${escapeHtml(p.beneficiario)}</small>` : ''}</td>
            <td>${escapeHtml(b.titulo || b.descricao || '-')}</td>
            <td style="text-align: right; font-weight: 700; font-family: 'JetBrains Mono', monospace;">${formatCurrency(g.valorTotal)}</td>
            <td style="text-align: center;"><span class="badge-status-ok" style="font-size: 0.7rem; padding: 2px 6px;">🟢 1:1 Conciliado</span></td>
          </tr>
        `;
      });
      html += `</tbody></table></div>`;
      diagContentView.innerHTML = html;
    }
  }

  /**
   * Modal de Configuração / Credenciais do Banco Inter
   */
  async function abrirModalInterConfig() {
    if (!interConfigModal) return;
    interConfigModal.classList.remove('hidden');

    if (interConfigModalBody) {
      interConfigModalBody.innerHTML = `<div style="text-align: center; padding: 2rem;"><div class="spinner"></div><p>Verificando credenciais no Render...</p></div>`;
    }

    try {
      const res = await fetch('/api/financeiro/inter-config');
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Erro ao carregar status do Inter.');
      }

      const statusMap = data.status || {};
      let html = `
        <div style="background: rgba(30, 41, 59, 0.4); padding: 1rem; border-radius: 8px; border: 1px solid var(--panel-border); font-size: 0.85rem; color: var(--text-secondary); line-height: 1.5;">
          <strong style="color: var(--text-primary);">ℹ️ Como Funciona a Integração com o Banco Inter:</strong><br>
          A API do Banco Inter exige autenticação mTLS (OAuth 2.0 com Certificados Digitais X.509 <code>.crt</code> e chave <code>.key</code>).<br>
          Cadastre as variáveis no painel de <em>Environment Variables</em> do Render para cada empresa:
        </div>

        <div style="display: flex; flex-direction: column; gap: 0.75rem;">
      `;

      for (const [code, info] of Object.entries(statusMap)) {
        html += `
          <div style="background: rgba(15, 23, 42, 0.4); padding: 1rem; border-radius: 8px; border: 1px solid var(--panel-border);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
              <strong style="font-size: 0.95rem; color: var(--text-primary);">🏢 Empresa ${code}: ${escapeHtml(info.empresaNome)}</strong>
              <span style="font-size: 0.78rem; font-weight: 700; color: ${info.isConfigured ? '#10b981' : '#fbbf24'};">${escapeHtml(info.statusDesc)}</span>
            </div>
            <div style="font-size: 0.8rem; color: var(--text-muted); display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.4rem;">
              <span>Conta: <strong>${escapeHtml(info.contaFormatada)}</strong></span>
              <span>Client ID: <strong>${info.hasClientId ? '✅ Configurado' : '❌ Ausente (INTER_CLIENT_ID_' + code + ')'}</strong></span>
              <span>Client Secret: <strong>${info.hasClientSecret ? '✅ Configurado' : '❌ Ausente (INTER_CLIENT_SECRET_' + code + ')'}</strong></span>
              <span>Certificado mTLS: <strong>${info.hasCert ? '✅ Carregado' : '❌ Ausente (INTER_CERT_' + code + ')'}</strong></span>
              <span>Chave Privada: <strong>${info.hasKey ? '✅ Carregada' : '❌ Ausente (INTER_KEY_' + code + ')'}</strong></span>
            </div>
          </div>
        `;
      }

      html += `</div>`;
      if (interConfigModalBody) interConfigModalBody.innerHTML = html;
    } catch (err) {
      if (interConfigModalBody) {
        interConfigModalBody.innerHTML = `<div class="empty-state" style="padding: 1.5rem; text-align: center; color: #f87171;">⚠️ Falha ao verificar credenciais: ${escapeHtml(err.message)}</div>`;
      }
    }
  }

  // =================================================================
  // ANÁLISE DE CRÉDITO & SCORE COMERCIAL (PROTHEUS)
  // =================================================================
  const btnIniciarConsultaCredito = document.getElementById('btnIniciarConsultaCredito');
  const creditoEmpresaSelect = document.getElementById('creditoEmpresaSelect');
  const creditoNumPedido = document.getElementById('creditoNumPedido');
  const creditoProtheusBadge = document.getElementById('creditoProtheusBadge');
  const creditoResultadoSection = document.getElementById('creditoResultadoSection');
  const formAnaliseCreditoCompleto = document.getElementById('formAnaliseCreditoCompleto');
  const historicoCreditoTableBody = document.getElementById('historicoCreditoTableBody');
  const buscaHistoricoCredito = document.getElementById('buscaHistoricoCredito');
  const filtroPeriodoHistoricoCredito = document.getElementById('filtroPeriodoHistoricoCredito');
  const btnSaveScoreConfig = document.getElementById('btnSaveScoreConfig');
  const btnResetScoreConfig = document.getElementById('btnResetScoreConfig');
  const scoreConfigForm = document.getElementById('scoreConfigForm');

  // Elementos do Leitor de Laudo Serasa Experian (PDF)
  const serasaPdfInput = document.getElementById('serasaPdfInput');
  const btnSelectSerasaPdf = document.getElementById('btnSelectSerasaPdf');
  const serasaPdfStatusAlert = document.getElementById('serasaPdfStatusAlert');

  let listaHistoricoCredito = [];
  let scoreConfigActive = null;
  let dadosSerasaAtual = null;

  // 0. Leitura e Validação do Laudo Serasa Experian em Memória
  if (btnSelectSerasaPdf && serasaPdfInput) {
    btnSelectSerasaPdf.addEventListener('click', () => {
      serasaPdfInput.click();
    });

    serasaPdfInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      btnSelectSerasaPdf.disabled = true;
      btnSelectSerasaPdf.innerHTML = '<div class="spinner" style="width: 14px; height: 14px; display: inline-block;"></div> Lendo PDF em memória...';

      if (serasaPdfStatusAlert) {
        serasaPdfStatusAlert.classList.remove('hidden');
        serasaPdfStatusAlert.style.background = 'rgba(56, 189, 248, 0.12)';
        serasaPdfStatusAlert.style.borderColor = 'rgba(56, 189, 248, 0.3)';
        serasaPdfStatusAlert.style.color = '#38bdf8';
        serasaPdfStatusAlert.innerHTML = `⏳ Analisando arquivo <strong>${escapeHtml(file.name)}</strong> em tempo de execução...`;
      }

      try {
        const formData = new FormData();
        formData.append('serasa_pdf', file);

        const res = await fetch('/api/financeiro/analise-credito/parse-serasa-pdf', {
          method: 'POST',
          body: formData
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Falha ao processar o relatório Serasa.');
        }

        const serasa = data.data;
        dadosSerasaAtual = serasa;

        // Banner Verde de Sucesso
        if (serasaPdfStatusAlert) {
          serasaPdfStatusAlert.classList.remove('hidden');
          serasaPdfStatusAlert.style.background = 'rgba(34, 197, 94, 0.15)';
          serasaPdfStatusAlert.style.borderColor = 'rgba(34, 197, 94, 0.35)';
          serasaPdfStatusAlert.style.color = '#22c55e';
          
          const scoreDisp = serasa.is_default ? '<span style="color:#f87171; font-weight:800;">DEFAULT / Múltiplos Eventos</span>' : `<strong>${serasa.score_serasa || serasa.score_serasa_texto || '-'}</strong> / 1000`;
          const pdDisp = serasa.probabilidade_inadimplencia_texto ? ` | PD: <strong>${escapeHtml(serasa.probabilidade_inadimplencia_texto)}</strong>` : '';
          const protestosDisp = serasa.protestos_qtd > 0 ? `<span style="color:#f87171; font-weight:700;">${serasa.protestos_qtd} reg (R$ ${Number(serasa.protestos_valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })})</span>` : '0';
          const pefinDisp = serasa.pefin_qtd > 0 ? `<span style="color:#fbbf24;">${serasa.pefin_qtd} reg</span>` : '0';
          const refinDisp = serasa.refin_qtd > 0 ? `<span style="color:#f87171;">${serasa.refin_qtd} reg</span>` : '0';

          serasaPdfStatusAlert.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
              <div>
                ✓ <strong>Laudo Serasa Validado:</strong> CNPJ <strong>${escapeHtml(serasa.cnpj || 'N/A')}</strong> (${escapeHtml(serasa.razao_social || 'N/A')}) | Emissão: <strong>${escapeHtml(serasa.data_emissao)}</strong> (${serasa.idade_meses} meses)
              </div>
              <span class="badge" style="background: rgba(34, 197, 94, 0.2); color: #22c55e; border-color: rgba(34, 197, 94, 0.4); font-size: 0.72rem;">✓ Válido (&le; 4 meses)</span>
            </div>
            <div style="margin-top: 0.35rem; font-size: 0.8rem; color: #cbd5e1;">
              Score: ${scoreDisp}${pdDisp} | Protestos: ${protestosDisp} | PEFIN: ${pefinDisp} | REFIN: ${refinDisp} | Consultas: <strong>${serasa.consultas_total}</strong> (${serasa.consultas_densidade_dia}/dia)
            </div>
          `;
        }

        // Habilita o botão de consulta Protheus
        if (btnIniciarConsultaCredito) {
          btnIniciarConsultaCredito.disabled = false;
          btnIniciarConsultaCredito.style.opacity = '1';
          btnIniciarConsultaCredito.style.cursor = 'pointer';
          btnIniciarConsultaCredito.title = 'Pronto para consultar o pedido no Protheus ERP';
        }

        // Preenche automaticamente o Bloco 5 (Serasa & Apontamentos)
        const setVal = (id, val) => {
          const el = document.getElementById(id);
          if (el && val !== undefined && val !== null) el.value = val;
        };

        setVal('cr_score_serasa', serasa.score_serasa_texto || serasa.score_serasa || '');
        setVal('cr_probabilidade_inadimplencia', serasa.probabilidade_inadimplencia_texto || '');
        setVal('cr_protestos', serasa.protestos_tem);
        setVal('cr_valor_protestos', serasa.protestos_valor ? Number(serasa.protestos_valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0,00');
        setVal('cr_pfin', serasa.pefin_tem);
        setVal('cr_refin', serasa.refin_tem);
        setVal('cr_dividas_vencidas', serasa.dividas_vencidas_tem);
        setVal('cr_ch_sem_fundo', serasa.cheques_tem);
        setVal('cr_socios_anotacao', serasa.socios_anotacao);
        setVal('cr_consultas_densidade', `${serasa.consultas_densidade_dia || 0} / dia (${serasa.consultas_total || 0} consultas em ${serasa.consultas_janela_dias || 0} dias)`);
        setVal('cr_consultas_densidade_val', serasa.consultas_densidade_dia || 0);
        setVal('cr_consultantes_fomento', serasa.consultantes_fomento);
        setVal('cr_documentos_extraviados', serasa.documentos_extraviados);

        // Se houver dados cadastrais no Serasa, usa como apoio
        if (serasa.fundacao && !document.getElementById('cr_fundacao_matriz').value) {
          setVal('cr_fundacao_matriz', serasa.fundacao);
        }
        if (serasa.situacao_rf && !document.getElementById('cr_cnpj_ativo').value) {
          setVal('cr_cnpj_ativo', serasa.situacao_rf === 'ATIVA' ? 'S' : 'N');
        }

        // Atualiza Score em Tempo Real
        atualizarScoreEmTempoReal();

      } catch (err) {
        dadosSerasaAtual = null;
        if (serasaPdfStatusAlert) {
          serasaPdfStatusAlert.classList.remove('hidden');
          serasaPdfStatusAlert.style.background = 'rgba(239, 68, 68, 0.15)';
          serasaPdfStatusAlert.style.borderColor = 'rgba(239, 68, 68, 0.4)';
          serasaPdfStatusAlert.style.color = '#f87171';
          serasaPdfStatusAlert.innerHTML = `❌ <strong>ERRO NA VALIDAÇÃO DO SERASA:</strong> ${escapeHtml(err.message)}`;
        }

        if (btnIniciarConsultaCredito) {
          btnIniciarConsultaCredito.disabled = true;
          btnIniciarConsultaCredito.style.opacity = '0.6';
          btnIniciarConsultaCredito.style.cursor = 'not-allowed';
          btnIniciarConsultaCredito.title = 'Faça primeiro a leitura do PDF do Serasa acima para liberar a consulta';
        }

        alert(`❌ Erro no Laudo Serasa:\n\n${err.message}\n\nPor favor, selecione um laudo oficial Serasa emitido há no máximo 4 meses.`);
      } finally {
        btnSelectSerasaPdf.disabled = false;
        btnSelectSerasaPdf.innerHTML = '<span>📂 Selecionar Laudo Serasa (.pdf)</span>';
        serasaPdfInput.value = '';
      }
    });
  }

  // Função auxiliar para renderizar os Faróis de Conectividade Externa (SRE / Telemetria)
  function renderFaroisConectividade(statusConexoes) {
    const container = document.getElementById('creditoFaroisConectividade');
    if (!container) return;
    container.classList.remove('hidden');

    const timestampEl = document.getElementById('faroisTimestamp');
    if (timestampEl) {
      timestampEl.textContent = `Checagem: ${new Date().toLocaleTimeString('pt-BR')}`;
    }

    const mapaFarois = {
      receita: { led: 'farol_led_receita', txt: 'farol_receita_txt', card: 'farol_receita', label: 'Receita Federal' },
      registro_br: { led: 'farol_led_registro_br', txt: 'farol_registro_br_txt', card: 'farol_registro_br', label: 'Registro.br' },
      wayback: { led: 'farol_led_wayback', txt: 'farol_wayback_txt', card: 'farol_wayback', label: 'Wayback Machine' },
      dns_mx: { led: 'farol_led_dns_mx', txt: 'farol_dns_mx_txt', card: 'farol_dns_mx', label: 'Servidor MX' },
      fgts_caixa: { led: 'farol_led_fgts_caixa', txt: 'farol_fgts_caixa_txt', card: 'farol_fgts_caixa', label: 'FGTS Caixa' },
      protheus_db: { led: 'farol_led_protheus_db', txt: 'farol_protheus_db_txt', card: 'farol_protheus_db', label: 'ERP Protheus' }
    };

    if (!statusConexoes || typeof statusConexoes !== 'object') return;

    for (const [key, cfg] of Object.entries(mapaFarois)) {
      const info = statusConexoes[key];
      const ledEl = document.getElementById(cfg.led);
      const txtEl = document.getElementById(cfg.txt);
      const cardEl = document.getElementById(cfg.card);

      if (!ledEl || !txtEl) continue;

      ledEl.className = 'farol-led';

      if (!info) {
        ledEl.classList.add('farol-neutral');
        txtEl.textContent = 'Não consultado';
        continue;
      }

      const st = (info.status || '').toUpperCase();
      const tempoStr = info.tempoMs ? ` (${info.tempoMs}ms)` : '';

      if (st === 'OK') {
        ledEl.classList.add('farol-ok');
        txtEl.textContent = `${info.mensagem || 'Conectado'}${tempoStr}`;
      } else if (st === 'ALERTA') {
        ledEl.classList.add('farol-alert');
        txtEl.textContent = `${info.mensagem || 'Atenção'}${tempoStr}`;
      } else if (st === 'ERRO') {
        ledEl.classList.add('farol-error');
        txtEl.textContent = `${info.mensagem || 'Indisponível'}`;
      } else if (st === 'INFO') {
        ledEl.classList.add('farol-info');
        txtEl.textContent = `${info.mensagem || 'Informativo'}`;
      } else {
        ledEl.classList.add('farol-neutral');
        txtEl.textContent = info.mensagem || 'Pendente';
      }

      if (cardEl) {
        cardEl.title = `${cfg.label} [${info.provedor || 'Serviço'}]: ${info.mensagem || ''}${tempoStr}`;
      }
    }
  }

  // Iniciar Consulta Protheus (Passo 2)
  if (btnIniciarConsultaCredito) {
    btnIniciarConsultaCredito.addEventListener('click', async () => {
      if (!dadosSerasaAtual) {
        alert('⚠️ ATENÇÃO:\n\nÉ obrigatório realizar primeiro a leitura do relatório PDF do Serasa antes de consultar o Protheus.');
        if (btnSelectSerasaPdf) btnSelectSerasaPdf.scrollIntoView({ behavior: 'smooth' });
        return;
      }

      const emp = creditoEmpresaSelect ? creditoEmpresaSelect.value : '14';
      const numPed = creditoNumPedido ? creditoNumPedido.value.trim() : '';

      if (!numPed) {
        alert('Por favor, informe o número do Pedido de Venda Protheus.');
        return;
      }

      btnIniciarConsultaCredito.disabled = true;
      btnIniciarConsultaCredito.innerHTML = '<div class="spinner" style="width: 14px; height: 14px; display: inline-block;"></div> Consultando...';
      if (creditoProtheusBadge) creditoProtheusBadge.classList.add('hidden');
      if (creditoResultadoSection) creditoResultadoSection.classList.add('hidden');

      try {
        const res = await fetch('/api/financeiro/analise-credito/protheus', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ empresa: emp, numero_pedido: numPed })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          const err = new Error(data.error || 'Erro ao consultar pedido no Protheus.');
          err.status = res.status;
          throw err;
        }

        // Renderiza instantaneamente os Faróis de Conectividade Externa (SRE)
        if (data.status_conexoes) {
          renderFaroisConectividade(data.status_conexoes);
        }

        const setVal = (id, val) => {
          const el = document.getElementById(id);
          if (el) {
            el.value = (val !== undefined && val !== null) ? val : '';
          }
        };

        setVal('cr_pedido_venda', data.pedido_venda);
        setVal('cr_cod_web', data.cod_web || '');
        setVal('cr_cliente_codigo', data.cliente_codigo || '');
        setVal('cr_cliente_nome', data.cliente_nome || '');
        
        // Formata moeda Brasileira com 2 casas decimais (ex: 2.318,00)
        if (data.total_pedido !== undefined && data.total_pedido !== null) {
          setVal('cr_total_pedido', Number(data.total_pedido).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
        } else {
          setVal('cr_total_pedido', '');
        }

        setVal('cr_desconto_ped', data.desconto_ped || 'OK');
        setVal('cr_faturado', data.faturado || '');
        setVal('cr_entrada', data.entrada || '');
        setVal('cr_quant_grande', data.quant_grande || '');
        setVal('cr_prod_nao_combinam', data.prod_nao_combinam || '');
        setVal('cr_armario_cofre_gt_2000', data.armario_cofre_gt_2000 || '');
        setVal('cr_uf_cliente', data.uf_cliente || '');
        
        // Dados Públicos e Receita Federal
        setVal('cr_cnpj_ativo', data.cnpj_ativo || (data.receita_offline ? '' : 'S'));
        setVal('cr_fundacao_matriz', data.fundacao_matriz || '');
        
        const semCapCheckbox = document.getElementById('cr_sem_capital_social');
        const capInput = document.getElementById('cr_capital_social');
        if (data.capital_social && Number(data.capital_social) > 0) {
          if (semCapCheckbox) semCapCheckbox.checked = false;
          if (capInput) {
            capInput.disabled = false;
            capInput.placeholder = '0,00';
            capInput.value = Number(data.capital_social).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          }
        } else {
          if (semCapCheckbox) semCapCheckbox.checked = true;
          if (capInput) {
            capInput.disabled = true;
            capInput.placeholder = 'Não informado / Isento';
            capInput.value = '';
          }
        }

        // Comparação de Endereço Protheus vs Receita Federal (Sem assumir default falso se API falhar)
        if (data.cadastro_igual_receita === 'INDISPONIVEL' || data.receita_offline) {
          setVal('cr_cadastro_igual_receita', '');
        } else if (data.cadastro_igual_receita) {
          setVal('cr_cadastro_igual_receita', data.cadastro_igual_receita);
        } else {
          setVal('cr_cadastro_igual_receita', '');
        }

        // Casa / Sala / Conjunto no endereço (automático via Receita e Protheus)
        setVal('cr_casa_sala_conj_end', data.casa_sala_conj_end || 'N');

        // Histórico Financeiro Protheus SE1 (Empresas 09, 14, 15 e 16)
        setVal('cr_pgtos_abertos', data.pgtos_abertos !== undefined ? data.pgtos_abertos : 'N');
        setVal('cr_comprou_pagou', data.comprou_pagou !== undefined ? data.comprou_pagou : 'N');
        setVal('cr_comprou_pagou_5x', data.comprou_pagou_5x !== undefined ? data.comprou_pagou_5x : 'N');

        // Maturidade Digital Automática (RDAP, Wayback, Servidor MX) - Fail-Neutral
        if (data.idade_dominio_rdap !== null && data.idade_dominio_rdap !== undefined) {
          const anosTxt = `${data.idade_dominio_rdap} anos ${data.ano_criacao_rdap ? '(Desde ' + data.ano_criacao_rdap + ')' : ''}`;
          setVal('cr_idade_dominio_rdap', anosTxt);
          setVal('cr_idade_dominio_val', data.idade_dominio_rdap);
        } else {
          setVal('cr_idade_dominio_rdap', data.idade_dominio_rdap_erro ? 'Indisponível (Registro.br)' : (data.dominio_principal ? 'Domínio Recente / Não BR' : 'Sem Domínio'));
          setVal('cr_idade_dominio_val', '');
        }

        if (data.wayback_primeiro_snapshot) {
          setVal('cr_wayback_snapshot', `Histórico desde ${data.wayback_primeiro_snapshot}`);
          setVal('cr_wayback_ano_val', data.wayback_primeiro_snapshot);
        } else {
          setVal('cr_wayback_snapshot', data.wayback_offline ? 'Indisponível (Archive.org)' : 'Sem histórico no archive');
          setVal('cr_wayback_ano_val', '');
        }

        setVal('cr_servidor_mx', data.servidor_mx || (data.servidor_mx_offline ? 'Falha DNS' : 'Sem registro MX'));
        setVal('cr_tipo_servidor_mx', data.tipo_servidor_mx || 'NENHUM');
        setVal('cr_dominio_principal', data.dominio_principal || '');

        // Automação Registro.Br (Comparação de Raiz de CNPJ)
        if (data.registro_br && data.registro_br !== 'INDISPONIVEL') {
          setVal('cr_registro_br', data.registro_br);
        } else {
          setVal('cr_registro_br', '');
        }
        setVal('cr_cnpj_registro_br', data.cnpj_registro_br || '');
        setVal('cr_titular_registro_br', data.titular_registro_br || '');

        const regBrInfoEl = document.getElementById('cr_registro_br_info');
        if (regBrInfoEl) {
          if (data.registro_br_detalhes && (data.registro_br_detalhes.cnpjRegistroBr || data.registro_br_detalhes.cpfRegistroBr || data.registro_br_detalhes.dominio || data.registro_br_detalhes.erroTecnico)) {
            const det = data.registro_br_detalhes;
            regBrInfoEl.style.display = 'block';
            if (det.confere) {
              regBrInfoEl.style.background = 'rgba(34, 197, 94, 0.12)';
              regBrInfoEl.style.border = '1px solid rgba(34, 197, 94, 0.3)';
              regBrInfoEl.style.color = '#22c55e';
              regBrInfoEl.innerHTML = `✓ <strong>Raiz Confere:</strong> ${escapeHtml(det.cnpjRegistroBr || '')} ${det.titularRegistroBr ? '(' + escapeHtml(det.titularRegistroBr) + ')' : ''}`;
            } else if (det.erroTecnico) {
              regBrInfoEl.style.background = 'rgba(245, 158, 11, 0.12)';
              regBrInfoEl.style.border = '1px solid rgba(245, 158, 11, 0.3)';
              regBrInfoEl.style.color = '#fbbf24';
              regBrInfoEl.innerHTML = `ℹ️ <strong>Registro.br Indisponível:</strong> ${escapeHtml(det.motivo || 'Oscilação técnica')} (Pontuação neutra mantida)`;
            } else {
              regBrInfoEl.style.background = 'rgba(239, 68, 68, 0.12)';
              regBrInfoEl.style.border = '1px solid rgba(239, 68, 68, 0.3)';
              regBrInfoEl.style.color = '#f87171';
              regBrInfoEl.innerHTML = `⚠️ <strong>${escapeHtml(det.motivo || 'Divergente')}:</strong> ${escapeHtml(det.cnpjRegistroBr || det.cpfRegistroBr || det.dominio || '')} ${det.titularRegistroBr ? '(' + escapeHtml(det.titularRegistroBr) + ')' : ''}`;
            }
          } else {
            regBrInfoEl.style.display = 'none';
          }
        }

        // Preenchimento Automático da Seção 4: E-mails & Site Corporativo
        setVal('cr_email_corporativo', data.email_corporativo || 'N');
        setVal('cr_existe_mail_financeiro', data.existe_mail_financeiro || 'N');
        setVal('cr_mail_gratuito', data.mail_gratuito || 'N');
        setVal('cr_possui_site', data.possui_site || 'N');

        const emailsBadge = document.getElementById('cr_emails_detectados_badge');
        const emailsTxt = document.getElementById('cr_emails_detectados_txt');
        if (emailsBadge && emailsTxt) {
          if (data.emails_encontrados && data.emails_encontrados.length > 0) {
            emailsTxt.textContent = data.emails_encontrados.join(' | ');
            emailsBadge.style.display = 'block';
          } else {
            emailsTxt.textContent = 'Nenhum e-mail no cadastro Protheus';
            emailsBadge.style.display = 'block';
          }
        }

        // Detecção Automática de Endereço de Entrega Diferente (C5_MENNOTA e C5_TRANSP = 000009)
        const entregaVal = data.entrega_igual_cadastro || 'S';
        setVal('cr_entrega_igual_cadastro', entregaVal);

        const entregaBadge = document.getElementById('cr_entrega_diferente_badge');
        if (entregaBadge) {
          if (data.entrega_diferente_detectada) {
            entregaBadge.style.display = 'block';
            entregaBadge.style.background = 'rgba(239, 68, 68, 0.15)';
            entregaBadge.style.border = '1px solid rgba(239, 68, 68, 0.4)';
            entregaBadge.style.color = '#f87171';
            entregaBadge.innerHTML = `🚨 <strong>Endereço de Entrega Diferente:</strong> ${escapeHtml(data.entrega_diferente_motivo || 'Detectado no pedido')}`;
          } else {
            entregaBadge.style.display = 'block';
            entregaBadge.style.background = 'rgba(34, 197, 94, 0.12)';
            entregaBadge.style.border = '1px solid rgba(34, 197, 94, 0.3)';
            entregaBadge.style.color = '#22c55e';
            entregaBadge.innerHTML = `✓ <strong>Entrega Conforme:</strong> Mesmo endereço de cadastro Protheus (SA1)`;
          }
        }

        // Auto-preenchimento e Renderização de Badge FGTS Caixa via InfoSimples API
        const fgtsBadge = document.getElementById('cr_fgts_badge');
        if (data.fgts_info) {
          const fInfo = data.fgts_info;
          if (fInfo.executado) {
            setVal('cr_fgts_situacao_regular', fInfo.fgts_situacao_regular || 'NE');
            setVal('cr_razao_fgts_igual', fInfo.razao_fgts_igual || 'NE');
            
            if (fgtsBadge) {
              fgtsBadge.style.display = 'block';
              if (fInfo.encontrado) {
                if (fInfo.razao_fgts_igual === 'S') {
                  fgtsBadge.style.background = 'rgba(34, 197, 94, 0.12)';
                  fgtsBadge.style.border = '1px solid rgba(34, 197, 94, 0.3)';
                  fgtsBadge.style.color = '#22c55e';
                  fgtsBadge.innerHTML = `✓ <strong>FGTS Caixa Confere:</strong> "${escapeHtml(fInfo.razao_social_caixa)}" (Situação: ${escapeHtml(fInfo.situacao_caixa || 'REGULAR')}${fInfo.validade_crf ? ' | Validade CRF: ' + escapeHtml(fInfo.validade_crf) : ''})`;
                } else {
                  fgtsBadge.style.background = 'rgba(239, 68, 68, 0.15)';
                  fgtsBadge.style.border = '1px solid rgba(239, 68, 68, 0.4)';
                  fgtsBadge.style.color = '#f87171';
                  fgtsBadge.innerHTML = `🚨 <strong>ATENÇÃO — Razão Social Divergente na Caixa:</strong> "${escapeHtml(fInfo.razao_social_caixa)}" (Diverge do cadastro atual! Possível empresa alterada)`;
                }
              } else {
                fgtsBadge.style.background = 'rgba(245, 158, 11, 0.15)';
                fgtsBadge.style.border = '1px solid rgba(245, 158, 11, 0.4)';
                fgtsBadge.style.color = '#fbbf24';
                fgtsBadge.innerHTML = `⚠️ <strong>Empresa Não Localizada na Caixa:</strong> Nunca registrou funcionários / Sem histórico de recolhimento de FGTS`;
              }
            }
          } else {
            // Exibe aviso explícito em vez de ocultar silenciosamente o FGTS
            setVal('cr_fgts_situacao_regular', '');
            setVal('cr_razao_fgts_igual', '');
            if (fgtsBadge) {
              fgtsBadge.style.display = 'block';
              if (fInfo.auth_error || fInfo.code === 601) {
                fgtsBadge.style.background = 'rgba(239, 68, 68, 0.15)';
                fgtsBadge.style.border = '1px solid rgba(239, 68, 68, 0.4)';
                fgtsBadge.style.color = '#f87171';
                fgtsBadge.innerHTML = `🚨 <strong>InfoSimples (Erro 601):</strong> Token inválido ou não autenticado. E-mail de alerta enviado ao administrador.`;
              } else {
                fgtsBadge.style.background = 'rgba(245, 158, 11, 0.12)';
                fgtsBadge.style.border = '1px solid rgba(245, 158, 11, 0.35)';
                fgtsBadge.style.color = '#fbbf24';
                fgtsBadge.innerHTML = `ℹ️ <strong>FGTS Caixa Não Consultado:</strong> ${escapeHtml(fInfo.motivo || 'Serviço temporariamente indisponível')}`;
              }
            }
          }
        } else {
          setVal('cr_fgts_situacao_regular', '');
          setVal('cr_razao_fgts_igual', '');
          if (fgtsBadge) fgtsBadge.style.display = 'none';
        }

        // Campos manuais que permanecem para o analista preencher
        setVal('cr_alteracao_recente_socios', 'N');
        setVal('cr_aumento_expressivo_capital', 'N');
        setVal('cr_decisao_final', 'Decisão (atenção ao gravar)');

        // Validação Cruzada: CNPJ Protheus vs CNPJ Serasa
        const cnpjProtheusDigits = String(data.cliente_codigo || '').replace(/\D/g, '');
        const cnpjSerasaDigits = String(dadosSerasaAtual.cnpj || '').replace(/\D/g, '');
        let cnpjMatchMsg = '';
        let isCnpjDivergent = false;

        if (cnpjProtheusDigits && cnpjSerasaDigits && cnpjProtheusDigits.length >= 8 && cnpjSerasaDigits.length >= 8) {
          if (cnpjProtheusDigits.slice(0, 8) !== cnpjSerasaDigits.slice(0, 8)) {
            isCnpjDivergent = true;
            cnpjMatchMsg = ` | <span style="color:#f87171; font-weight:800;">⚠️ ATENÇÃO: CNPJ Protheus (${escapeHtml(data.cliente_codigo || 'N/A')}) DIFERE do Serasa (${escapeHtml(dadosSerasaAtual.cnpj)})!</span>`;
          } else {
            cnpjMatchMsg = ` | <span style="color:#22c55e;">✓ CNPJ Protheus confere com Laudo Serasa</span>`;
          }
        }

        if (creditoProtheusBadge) {
          creditoProtheusBadge.classList.remove('hidden');
          creditoProtheusBadge.style.background = isCnpjDivergent ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.12)';
          creditoProtheusBadge.style.borderColor = isCnpjDivergent ? 'rgba(239, 68, 68, 0.4)' : 'rgba(34, 197, 94, 0.3)';
          creditoProtheusBadge.style.color = isCnpjDivergent ? '#f87171' : '#22c55e';
          
          let endMsg = '';
          if (data.receita_offline) {
            endMsg = ' | Endereço Receita: <strong style="color:#fbbf24;">Receita Offline (Conferir Manualmente)</strong>';
          } else if (data.comparacao_endereco) {
            endMsg = data.comparacao_endereco.iguais 
              ? ' | Endereço Receita: <strong>Conforme</strong> (variação aceita)' 
              : ' | Endereço Receita: <strong>Divergente</strong>';
          }

          let domMsg = '';
          if (data.dominio_principal) {
            domMsg = ` | Domínio: <strong>${escapeHtml(data.dominio_principal)}</strong> (${data.idade_dominio_rdap !== null ? data.idade_dominio_rdap + ' anos' : 'verificado'})`;
          }

          creditoProtheusBadge.innerHTML = `✓ Pedido <strong>#${data.pedido_venda}</strong> (${escapeHtml(data.cliente_nome)}) importado com sucesso. Condição (SE4): Faturado: <strong>${data.faturado === 'S' ? 'Sim' : 'Não'}</strong> | Entrada: <strong>${data.entrada === 'S' ? 'Sim' : 'Não'}</strong> | Histórico (SE1): <strong>${data.total_compras_pagas || 0} compras pagas</strong>${endMsg}${domMsg}${cnpjMatchMsg}.`;
        }

        // Atualiza Score em Tempo Real imediatamente após preencher dados
        atualizarScoreEmTempoReal();
      } catch (err) {
        // Limpa campos para evitar dados falsos/stale
        if (formAnaliseCreditoCompleto) formAnaliseCreditoCompleto.reset();
        const entregaBadge = document.getElementById('cr_entrega_diferente_badge');
        if (entregaBadge) entregaBadge.style.display = 'none';
        const emailsBadge = document.getElementById('cr_emails_detectados_badge');
        if (emailsBadge) emailsBadge.style.display = 'none';
        const setVal = (id, val) => {
          const el = document.getElementById(id);
          if (el) el.value = val;
        };
        setVal('cr_pedido_venda', numPed);
        setVal('cr_total_pedido', '');
        setVal('cr_cliente_nome', '');

        const isNotFound = err.status === 404 || (err.message && (err.message.includes('NÃO existe') || err.message.includes('não existe') || err.message.includes('404')));

        if (isNotFound) {
          if (creditoProtheusBadge) {
            creditoProtheusBadge.classList.remove('hidden');
            creditoProtheusBadge.style.background = 'rgba(239, 68, 68, 0.15)';
            creditoProtheusBadge.style.borderColor = 'rgba(239, 68, 68, 0.4)';
            creditoProtheusBadge.style.color = '#f87171';
            creditoProtheusBadge.innerHTML = `❌ <strong>Pedido #${escapeHtml(numPed)} NÃO EXISTE no Protheus</strong> para a Empresa ${escapeHtml(emp)}. Verifique o número digitado ou a empresa selecionada.`;
          }
          alert(`❌ Pedido #${numPed} NÃO EXISTE no ERP Protheus (Empresa ${emp}).\n\nPor favor, confirme se o número do pedido está correto no Protheus.`);
        } else {
          if (creditoProtheusBadge) {
            creditoProtheusBadge.classList.remove('hidden');
            creditoProtheusBadge.style.background = 'rgba(239, 68, 68, 0.15)';
            creditoProtheusBadge.style.borderColor = 'rgba(239, 68, 68, 0.4)';
            creditoProtheusBadge.style.color = '#f87171';
            creditoProtheusBadge.innerHTML = `⚠️ <strong>Falha de Conexão com o ERP Protheus (Railway SQL):</strong> ${escapeHtml(err.message)}<br><small style="opacity:0.85;">O pedido #${escapeHtml(numPed)} pode existir, mas a consulta ao banco de dados falhou ou sofreu timeout.</small>`;
          }
          alert(`⚠️ Falha de Conexão com o ERP Protheus (Railway SQL):\n\n${err.message}\n\nO pedido pode existir, mas a conexão com o banco Protheus falhou.`);
        }

        renderFaroisConectividade({
          protheus_db: { status: 'ERRO', provedor: 'Railway SQL', mensagem: err.message || 'Falha de conexão com o banco Protheus' }
        });
        atualizarScoreEmTempoReal();
      } finally {
        btnIniciarConsultaCredito.disabled = false;
        btnIniciarConsultaCredito.innerHTML = '<span>⚡ Iniciar Consulta Protheus</span>';
      }
    });
  }

  // Listener para o Checkbox de Capital Social Não Informado / Isento
  const crSemCapitalSocial = document.getElementById('cr_sem_capital_social');
  const crCapitalSocialInput = document.getElementById('cr_capital_social');
  if (crSemCapitalSocial && crCapitalSocialInput) {
    crSemCapitalSocial.addEventListener('change', () => {
      if (crSemCapitalSocial.checked) {
        crCapitalSocialInput.disabled = true;
        crCapitalSocialInput.value = '';
        crCapitalSocialInput.placeholder = 'Não informado / Isento';
        crCapitalSocialInput.style.opacity = '0.7';
      } else {
        crCapitalSocialInput.disabled = false;
        crCapitalSocialInput.placeholder = '0,00';
        crCapitalSocialInput.style.opacity = '1';
        crCapitalSocialInput.focus();
      }
      atualizarScoreEmTempoReal();
    });
  }

  // Listener para o Botão de Consulta Automática via API InfoSimples
  const btnConsultarFgtsInfoSimples = document.getElementById('btnConsultarFgtsInfoSimples');
  if (btnConsultarFgtsInfoSimples) {
    btnConsultarFgtsInfoSimples.addEventListener('click', async () => {
      const getVal = (id) => {
        const el = document.getElementById(id);
        return el ? el.value.trim() : '';
      };
      let cnpj = getVal('cr_cliente_codigo') || (dadosSerasaAtual ? dadosSerasaAtual.cnpj : '');
      const digits = String(cnpj).replace(/\D/g, '');
      if (!digits) {
        alert('⚠️ Nenhum CNPJ identificado na tela. Realize primeiro a consulta do pedido ou informe o CNPJ do cliente.');
        return;
      }

      const razaoCliente = getVal('cr_cliente_nome');
      const originalText = btnConsultarFgtsInfoSimples.innerHTML;
      btnConsultarFgtsInfoSimples.disabled = true;
      btnConsultarFgtsInfoSimples.innerHTML = '⏳ Consultando InfoSimples...';

      try {
        const res = await fetch('/api/financeiro/analise-credito/consultar-fgts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cnpj: digits, razao_social: razaoCliente })
        });
        const d = await res.json();
        if (!d.success || !d.resultado) {
          throw new Error(d.error || 'Falha ao consultar FGTS na InfoSimples.');
        }

        const fInfo = d.resultado;
        const fgtsBadge = document.getElementById('cr_fgts_badge');

        if (fInfo.executado) {
          setVal('cr_fgts_situacao_regular', fInfo.fgts_situacao_regular || 'NE');
          setVal('cr_razao_fgts_igual', fInfo.razao_fgts_igual || 'NE');
          
          if (fgtsBadge) {
            fgtsBadge.style.display = 'block';
            if (fInfo.encontrado) {
              if (fInfo.razao_fgts_igual === 'S') {
                fgtsBadge.style.background = 'rgba(34, 197, 94, 0.12)';
                fgtsBadge.style.border = '1px solid rgba(34, 197, 94, 0.3)';
                fgtsBadge.style.color = '#22c55e';
                fgtsBadge.innerHTML = `✓ <strong>FGTS Caixa Confere:</strong> "${escapeHtml(fInfo.razao_social_caixa)}" (Situação: ${escapeHtml(fInfo.situacao_caixa || 'REGULAR')}${fInfo.validade_crf ? ' | Validade CRF: ' + escapeHtml(fInfo.validade_crf) : ''})`;
              } else {
                fgtsBadge.style.background = 'rgba(239, 68, 68, 0.15)';
                fgtsBadge.style.border = '1px solid rgba(239, 68, 68, 0.4)';
                fgtsBadge.style.color = '#f87171';
                fgtsBadge.innerHTML = `🚨 <strong>ATENÇÃO — Razão Social Divergente na Caixa:</strong> "${escapeHtml(fInfo.razao_social_caixa)}" (Diverge do cadastro atual! Possível empresa alterada)`;
              }
            } else {
              fgtsBadge.style.background = 'rgba(245, 158, 11, 0.15)';
              fgtsBadge.style.border = '1px solid rgba(245, 158, 11, 0.4)';
              fgtsBadge.style.color = '#fbbf24';
              fgtsBadge.innerHTML = `⚠️ <strong>Empresa Não Localizada na Caixa:</strong> Nunca registrou funcionários / Sem histórico de recolhimento de FGTS`;
            }
          }
          if (typeof atualizarScoreEmTempoReal === 'function') {
            atualizarScoreEmTempoReal();
          }
          alert('✓ Consulta de FGTS na InfoSimples concluída e preenchida com sucesso!');
        } else {
          if (fgtsBadge) {
            fgtsBadge.style.display = 'block';
            if (fInfo.auth_error || fInfo.code === 601) {
              fgtsBadge.style.background = 'rgba(239, 68, 68, 0.15)';
              fgtsBadge.style.border = '1px solid rgba(239, 68, 68, 0.4)';
              fgtsBadge.style.color = '#f87171';
              fgtsBadge.innerHTML = `🚨 <strong>InfoSimples (Erro 601):</strong> Token inválido ou não autenticado. E-mail de alerta enviado ao administrador.`;
            } else {
              fgtsBadge.style.background = 'rgba(245, 158, 11, 0.12)';
              fgtsBadge.style.border = '1px solid rgba(245, 158, 11, 0.35)';
              fgtsBadge.style.color = '#fbbf24';
              fgtsBadge.innerHTML = `ℹ️ <strong>FGTS Caixa Não Consultado:</strong> ${escapeHtml(fInfo.motivo || 'Serviço temporariamente indisponível')}`;
            }
          }
          alert(`⚠️ ${fInfo.motivo || 'Não foi possível consultar o FGTS na InfoSimples.'}`);
        }
      } catch (err) {
        alert('Erro ao consultar FGTS na InfoSimples: ' + err.message);
      } finally {
        btnConsultarFgtsInfoSimples.disabled = false;
        btnConsultarFgtsInfoSimples.innerHTML = originalText;
      }
    });
  }

  // Listener para o Botão de Consulta Assistida 1-Clique na Caixa FGTS
  const btnConsultarFgtsCaixa = document.getElementById('btnConsultarFgtsCaixa');
  if (btnConsultarFgtsCaixa) {
    btnConsultarFgtsCaixa.addEventListener('click', () => {
      const getVal = (id) => {
        const el = document.getElementById(id);
        return el ? el.value.trim() : '';
      };
      let cnpj = getVal('cr_cliente_codigo') || (dadosSerasaAtual ? dadosSerasaAtual.cnpj : '');
      const digits = String(cnpj).replace(/\D/g, '');
      if (!digits) {
        alert('⚠️ Nenhum CNPJ identificado na tela. Realize primeiro a consulta do pedido ou laudo Serasa para copiar o CNPJ.');
        return;
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(digits).then(() => {
          alert(`📋 CNPJ ${digits} copiado com sucesso para a Área de Transferência!\n\nCole (Ctrl+V) no campo de Inscrição da Caixa e digite o Captcha.`);
        }).catch(() => {
          alert(`🌐 Abrindo portal da Caixa.\n\nCNPJ para consulta: ${digits}`);
        });
      } else {
        alert(`🌐 Abrindo portal da Caixa.\n\nCNPJ para consulta: ${digits}`);
      }
      window.open('https://consulta-crf.caixa.gov.br/consultacrf/pages/consultaEmpregador.jsf', '_blank');
    });
  }

  // Função utilitária para extrair dados do formulário
  function extrairDadosFormCredito() {
    const getVal = (id) => {
      const el = document.getElementById(id);
      return el ? el.value.trim() : '';
    };

    const parseMoeda = (valStr) => {
      if (!valStr && valStr !== 0) return 0;
      if (typeof valStr === 'number') return valStr;
      let str = String(valStr).trim().replace(/[^0-9.,-]/g, '');
      if (!str) return 0;
      if (str.includes(',')) {
        str = str.replace(/\./g, '').replace(',', '.');
      } else if ((str.match(/\./g) || []).length > 1) {
        str = str.replace(/\./g, '');
      }
      return parseFloat(str) || 0;
    };

    const isSemCap = crSemCapitalSocial ? crSemCapitalSocial.checked : false;

    return {
      empresa: creditoEmpresaSelect ? creditoEmpresaSelect.value : '14',
      pedido_venda: getVal('cr_pedido_venda'),
      cod_web: getVal('cr_cod_web'),
      cliente_codigo: getVal('cr_cliente_codigo'),
      cliente_nome: getVal('cr_cliente_nome'),
      total_pedido: parseMoeda(getVal('cr_total_pedido')),
      desconto_ped: getVal('cr_desconto_ped') || 'OK',
      faturado: getVal('cr_faturado') || 'S',
      entrada: getVal('cr_entrada') || 'N',
      quant_grande: getVal('cr_quant_grande') || 'N',
      prod_nao_combinam: getVal('cr_prod_nao_combinam') || 'N',
      armario_cofre_gt_2000: getVal('cr_armario_cofre_gt_2000') || 'N',
      uf_cliente: getVal('cr_uf_cliente') || 'SP',
      entrega_igual_cadastro: getVal('cr_entrega_igual_cadastro'),
      cadastro_igual_receita: getVal('cr_cadastro_igual_receita'),
      casa_sala_conj_end: getVal('cr_casa_sala_conj_end'),
      registro_br: getVal('cr_registro_br'),
      cnpj_registro_br: getVal('cr_cnpj_registro_br'),
      titular_registro_br: getVal('cr_titular_registro_br'),
      idade_dominio_rdap: getVal('cr_idade_dominio_val'),
      wayback_primeiro_snapshot: getVal('cr_wayback_ano_val'),
      tipo_servidor_mx: getVal('cr_tipo_servidor_mx'),
      dominio_principal: getVal('cr_dominio_principal'),
      email_corporativo: getVal('cr_email_corporativo'),
      existe_mail_financeiro: getVal('cr_existe_mail_financeiro'),
      mail_gratuito: getVal('cr_mail_gratuito'),
      possui_site: getVal('cr_possui_site'),
      fundacao_matriz: getVal('cr_fundacao_matriz'),
      sem_capital_social: isSemCap ? 'S' : 'N',
      capital_social: isSemCap ? null : parseMoeda(getVal('cr_capital_social')),
      score_serasa: getVal('cr_score_serasa'),
      probabilidade_inadimplencia: getVal('cr_probabilidade_inadimplencia'),
      protestos: getVal('cr_protestos'),
      valor_protestos: parseMoeda(getVal('cr_valor_protestos')),
      pfin: getVal('cr_pfin'),
      refin: getVal('cr_refin') || 'N',
      dividas_vencidas: getVal('cr_dividas_vencidas') || 'N',
      ch_sem_fundo: getVal('cr_ch_sem_fundo'),
      socios_anotacao: getVal('cr_socios_anotacao') || 'N',
      consultas_densidade_dia: parseFloat(getVal('cr_consultas_densidade_val')) || 0,
      consultantes_fomento: getVal('cr_consultantes_fomento') || 'N',
      documentos_extraviados: getVal('cr_documentos_extraviados') || 'N',
      serasa_pdf_info: dadosSerasaAtual || null,
      cnpj_ativo: getVal('cr_cnpj_ativo'),
      pgtos_abertos: getVal('cr_pgtos_abertos'),
      comprou_pagou: getVal('cr_comprou_pagou'),
      comprou_pagou_5x: getVal('cr_comprou_pagou_5x'),
      fgts_situacao_regular: getVal('cr_fgts_situacao_regular'),
      razao_fgts_igual: getVal('cr_razao_fgts_igual'),
      alteracao_recente_socios: getVal('cr_alteracao_recente_socios') || 'N',
      aumento_expressivo_capital: getVal('cr_aumento_expressivo_capital') || 'N',
      obs: getVal('cr_obs'),
      decisao_final: getVal('cr_decisao_final')
    };
  }

  // Helper para formatar badges visuais de pontuação (+X pts / -Y pts / 0 pts)
  function formatarBadgePontos(pts, label) {
    if (pts === undefined || pts === null || isNaN(Number(pts))) return '';
    const n = Number(pts);
    let cls = 'neutral';
    let prefix = '';
    if (n > 0) {
      cls = 'positive';
      prefix = '+';
    } else if (n < 0) {
      cls = 'negative';
      prefix = '';
    }
    const lblStr = label ? ` <small style="opacity:0.85; font-size:0.68rem;">(${escapeHtml(label)})</small>` : '';
    return `<span class="badge-pts ${cls}">${prefix}${n} pts${lblStr}</span>`;
  }

  // Motor de cálculo de Score e Regras de Segurança no Frontend (Espelha o backend dinamicamente)
  function calcularScoreClienteFrontend(dados) {
    const cfg = scoreConfigActive || {};
    const getCfg = (k, def) => (cfg[k] !== undefined && cfg[k] !== null && !isNaN(Number(cfg[k])) ? Number(cfg[k]) : def);

    const totalPed = Number(dados.total_pedido) || 0;
    const isFaturado = dados.faturado === 'S';
    const entradaSim = dados.entrada === 'S';
    const entregaIgualCadastro = dados.entrega_igual_cadastro === 'S';

    const limitePedAlto = getCfg('limite_pedido_alto', 21000);
    const pesoPedAlto = getCfg('peso_pedido_alto', -8);

    const pontos = {};
    pontos.total_pedido = totalPed > limitePedAlto ? pesoPedAlto : 0;
    pontos.faturado = !isFaturado ? getCfg('peso_faturado_avista', 100) : 0;
    pontos.entrada = entradaSim ? getCfg('peso_entrada_sim', 12) : getCfg('peso_entrada_nao', -4);
    pontos.quant_grande = dados.quant_grande === 'S' ? getCfg('peso_muitos_itens_sim', -13) : getCfg('peso_muitos_itens_nao', 1);
    pontos.prod_nao_combinam = dados.prod_nao_combinam === 'S' ? getCfg('peso_prod_variados_sim', -5) : getCfg('peso_prod_variados_nao', 2);
    pontos.pgtos_abertos = dados.pgtos_abertos === 'S' ? getCfg('peso_pgtos_abertos_sim', -3) : getCfg('peso_pgtos_abertos_nao', 1);
    pontos.comprou_pagou = dados.comprou_pagou === 'S' ? getCfg('peso_comprou_2x_sim', 9) : getCfg('peso_comprou_2x_nao', -3);
    pontos.comprou_pagou_5x = dados.comprou_pagou_5x === 'S' ? getCfg('peso_comprou_5x_sim', 23) : 0;
    if (dados.cadastro_igual_receita === 'INDISPONIVEL' || dados.receita_offline === true) {
      pontos.cadastro_igual_receita = 0; // Fail-Neutral: Receita offline não penaliza nem bonifica
    } else {
      pontos.cadastro_igual_receita = dados.cadastro_igual_receita === 'S' ? getCfg('peso_cadastro_receita_sim', 3) : (dados.cadastro_igual_receita === 'N' ? getCfg('peso_cadastro_receita_nao', -3) : 0);
    }
    pontos.cnpj_ativo = dados.cnpj_ativo === 'S' ? getCfg('peso_cnpj_ativo_sim', 2) : (dados.cnpj_ativo === 'N' ? getCfg('peso_cnpj_ativo_nao', -100) : 0);
    pontos.entrega_igual_cadastro = entregaIgualCadastro ? getCfg('peso_entrega_cadastro_sim', 2) : (dados.entrega_igual_cadastro === 'N' ? getCfg('peso_entrega_cadastro_nao', -9) : 0);

    const uf = (dados.uf_cliente || '').toUpperCase().trim();
    pontos.uf_cliente = uf === 'RJ' ? getCfg('peso_uf_rj', -12) : 0;

    if (entregaIgualCadastro) {
      pontos.registro_br = 0;
    } else {
      pontos.registro_br = dados.registro_br === 'S' ? getCfg('peso_registro_br_sim', 6) : 0;
    }

    // Inteligência Digital Automática (RDAP Registro.br, Wayback Machine, Servidor MX) - Fail-Neutral
    const isRdapErro = dados.idade_dominio_rdap_erro === true || dados.registro_br === 'INDISPONIVEL';
    const idadeDominio = dados.idade_dominio_rdap !== undefined && dados.idade_dominio_rdap !== null && dados.idade_dominio_rdap !== '' 
      ? Number(dados.idade_dominio_rdap) 
      : null;

    if (isRdapErro) {
      pontos.idade_dominio = 0; // Fail-Neutral
    } else if (idadeDominio !== null && !isNaN(idadeDominio)) {
      if (idadeDominio >= 10) pontos.idade_dominio = getCfg('peso_dominio_idade_10', 6);
      else if (idadeDominio >= 3) pontos.idade_dominio = getCfg('peso_dominio_idade_3', 3);
      else if (idadeDominio >= 1) pontos.idade_dominio = getCfg('peso_dominio_idade_1', 0);
      else pontos.idade_dominio = getCfg('peso_dominio_idade_recente', -7);
    } else {
      pontos.idade_dominio = dados.possui_site === 'N' ? getCfg('peso_dominio_sem_site', -5) : 0;
    }

    const waybackAno = dados.wayback_primeiro_snapshot ? parseInt(dados.wayback_primeiro_snapshot, 10) : 0;
    const anoAtual = new Date().getFullYear();
    if (waybackAno > 1990) {
      const anosHistorico = anoAtual - waybackAno;
      if (anosHistorico >= 5) pontos.wayback = getCfg('peso_wayback_5', 3);
      else if (anosHistorico >= 1) pontos.wayback = getCfg('peso_wayback_1', 1);
      else pontos.wayback = getCfg('peso_wayback_zero', 0);
    } else {
      pontos.wayback = getCfg('peso_wayback_zero', 0);
    }

    const mxTipo = (dados.tipo_servidor_mx || '').toUpperCase();
    const isMxErro = dados.servidor_mx_offline === true || mxTipo === 'ERRO_REDE';
    if (isMxErro) {
      pontos.servidor_mx = 0; // Fail-Neutral
    } else if (mxTipo === 'PREMIUM') {
      pontos.servidor_mx = getCfg('peso_mx_premium', 3);
    } else if (mxTipo === 'PADRAO' || mxTipo === 'PROPRIO') {
      pontos.servidor_mx = getCfg('peso_mx_padrao', 0);
    } else if (dados.email_corporativo === 'S' && (mxTipo === 'NENHUM' || !mxTipo)) {
      pontos.servidor_mx = getCfg('peso_mx_inexistente', -4);
    } else {
      pontos.servidor_mx = 0;
    }

    pontos.casa_sala_conj = dados.casa_sala_conj_end === 'S' ? getCfg('peso_endereco_sala_sim', -5) : (dados.casa_sala_conj_end === 'N' ? getCfg('peso_endereco_sala_nao', 1) : 0);
    pontos.email_corporativo = dados.email_corporativo === 'S' ? getCfg('peso_email_corp_sim', 3) : (dados.email_corporativo === 'N' ? getCfg('peso_email_corp_nao', -3) : 0);
    pontos.existe_mail_financeiro = dados.existe_mail_financeiro === 'S' ? 0 : (dados.existe_mail_financeiro === 'N' ? getCfg('peso_email_fin_diferente_nao', -7) : 0);
    pontos.mail_gratuito = dados.mail_gratuito === 'S' ? getCfg('peso_email_gratuito_sim', -8) : (dados.mail_gratuito === 'N' ? getCfg('peso_email_gratuito_nao', 2) : 0);
    pontos.possui_site = dados.possui_site === 'S' ? getCfg('peso_site_ativo_sim', 1) : (dados.possui_site === 'N' ? getCfg('peso_site_ativo_nao', -15) : 0);

    let idadeAnos = 0;
    if (dados.fundacao_matriz) {
      const dataFund = new Date(dados.fundacao_matriz);
      if (!isNaN(dataFund.getTime())) {
        const diffMs = Date.now() - dataFund.getTime();
        idadeAnos = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 365.25));
      }
    }
    if (idadeAnos >= 30) pontos.idade_empresa = getCfg('peso_idade_30', 8);
    else if (idadeAnos >= 15) pontos.idade_empresa = getCfg('peso_idade_15', 4);
    else if (idadeAnos >= 5) pontos.idade_empresa = getCfg('peso_idade_5', 0);
    else if (dados.fundacao_matriz) pontos.idade_empresa = getCfg('peso_idade_menor5', -6);
    else pontos.idade_empresa = 0;

    pontos.empresa_grande_conhecida = dados.empresa_grande_conhecida === 'S' ? getCfg('peso_grande_conhecida_sim', 5) : 0;

    const isSemCapital = (crSemCapitalSocial && crSemCapitalSocial.checked) || dados.sem_capital_social === 'S';
    const capSocial = isSemCapital ? 0 : (Number(dados.capital_social) || 0);
    const temProtestos = dados.protestos === 'S';
    const valProtestos = Number(dados.valor_protestos) || 0;

    if (dados.protestos === 'N') {
      pontos.protestos = getCfg('peso_protestos_nao', 5);
      pontos.vlr_protestos_vs_ped = 0;
      pontos.protestos_vs_capital = 0;
    } else if (temProtestos) {
      pontos.protestos = getCfg('peso_protestos_sim', -10);
      pontos.vlr_protestos_vs_ped = totalPed > 0 && valProtestos > (totalPed * 2) ? getCfg('peso_protesto_2x_ped', -10) : 0;
      if (capSocial > 0) {
        pontos.protestos_vs_capital = valProtestos > capSocial ? getCfg('peso_protesto_maior_capital', -20) : getCfg('peso_protesto_menor_capital', 4);
      } else {
        pontos.protestos_vs_capital = 0;
      }
    } else {
      pontos.protestos = 0;
      pontos.vlr_protestos_vs_ped = 0;
      pontos.protestos_vs_capital = 0;
    }

    pontos.ch_sem_fundo = dados.ch_sem_fundo === 'S' ? getCfg('peso_ch_sem_fundo_sim', -6) : 0;
    pontos.pfin = dados.pfin === 'S' ? getCfg('peso_pfin_sim', -5) : (dados.pfin === 'N' ? getCfg('peso_pfin_nao', 1) : 0);
    pontos.refin = dados.refin === 'S' ? getCfg('peso_refin_sim', -10) : 0;
    pontos.dividas_vencidas = dados.dividas_vencidas === 'S' ? getCfg('peso_dividas_vencidas_sim', -4) : 0;
    
    const densidade = Number(dados.consultas_densidade_dia) || 0;
    pontos.densidade_consultas = (densidade >= 4.0) ? getCfg('peso_densidade_consultas_alta', -8) : 0;
    pontos.consultantes_fomento = dados.consultantes_fomento === 'S' ? getCfg('peso_consultantes_fomento_sim', -5) : 0;
    pontos.socios_anotacao = dados.socios_anotacao === 'S' ? getCfg('peso_socios_restricao_sim', -6) : 0;
    pontos.doc_extraviado = dados.documentos_extraviados === 'S' ? getCfg('peso_doc_extraviado_sim', -25) : 0;

    const isDefaultSerasa = dados.is_default === true || dados.is_default === 'S' || String(dados.score_serasa || '').toUpperCase().includes('DEFAULT') || String(dados.score_serasa || '').toUpperCase().includes('MÚLTIPLOS');
    if (isDefaultSerasa) {
      pontos.score_serasa = getCfg('peso_serasa_default', -30);
    } else {
      const serasa = parseInt(dados.score_serasa, 10);
      if (!isNaN(serasa) && dados.score_serasa !== '') {
        if (serasa >= 700) pontos.score_serasa = getCfg('peso_serasa_700', 8);
        else if (serasa >= 500) pontos.score_serasa = getCfg('peso_serasa_500', 4);
        else if (serasa >= 200) pontos.score_serasa = getCfg('peso_serasa_200', -4);
        else if (serasa > 0) pontos.score_serasa = getCfg('peso_serasa_baixo', -15);
        else pontos.score_serasa = getCfg('peso_serasa_zero', -20);
      } else {
        pontos.score_serasa = 0;
      }
    }

    if (isSemCapital) {
      pontos.capital_social = getCfg('peso_capital_nao_informado', 0);
    } else if (capSocial >= 10000000) {
      pontos.capital_social = getCfg('peso_capital_10m', 12);
    } else if (capSocial >= 1000000) {
      pontos.capital_social = getCfg('peso_capital_1m', 6);
    } else if (capSocial >= 150000) {
      pontos.capital_social = getCfg('peso_capital_150k', 0);
    } else if (capSocial >= 12000) {
      pontos.capital_social = getCfg('peso_capital_12k_menor', -3);
    } else if (capSocial > 0) {
      pontos.capital_social = getCfg('peso_capital_zero', -7);
    } else {
      pontos.capital_social = getCfg('peso_capital_nao_informado', 0);
    }

    if (dados.fgts_situacao_regular === 'N') {
      pontos.fgts_regular = getCfg('peso_fgts_regular_nao', -6);
    } else if (dados.fgts_situacao_regular === 'NE') {
      pontos.fgts_regular = 0; // Não Encontrado = 0 pts (penalidade aplicada em Razão = FGTS? -5 pts)
    } else {
      pontos.fgts_regular = 0;
    }
    if (dados.razao_fgts_igual === 'S') {
      pontos.razao_fgts_igual = getCfg('peso_razao_fgts_igual_sim', 3);
    } else if (dados.razao_fgts_igual === 'N') {
      pontos.razao_fgts_igual = getCfg('peso_razao_fgts_igual_nao', -15);
    } else if (dados.razao_fgts_igual === 'NE' || dados.razao_fgts_igual === 'X') {
      pontos.razao_fgts_igual = getCfg('peso_razao_fgts_nao_encontrado', -5);
    } else {
      pontos.razao_fgts_igual = 0;
    }
    pontos.alteracao_recente_socios = dados.alteracao_recente_socios === 'S' ? getCfg('peso_alteracao_recente_socios_sim', -8) : 0;
    pontos.aumento_expressivo_capital = dados.aumento_expressivo_capital === 'S' ? getCfg('peso_aumento_expressivo_capital_sim', -20) : 0;

    const totalScore = Object.values(pontos).reduce((acc, p) => acc + (typeof p === 'number' ? p : 0), 0);

    const subGolpe = (pontos.email_corporativo || 0) + (pontos.possui_site || 0) + (pontos.mail_gratuito || 0) + (pontos.existe_mail_financeiro || 0) + (pontos.idade_dominio || 0) + (pontos.registro_br || 0) + (pontos.alteracao_recente_socios || 0) + (pontos.aumento_expressivo_capital || 0);
    const subEmpresinha = (pontos.idade_empresa || 0) + (pontos.score_serasa || 0) + (pontos.capital_social || 0) + (pontos.fgts_regular || 0) + (pontos.razao_fgts_igual || 0) + (pontos.protestos || 0) + (pontos.pfin || 0) + (pontos.ch_sem_fundo || 0);

    let risco = 'MÉDIO RISCO';
    let sugestao = 'VER E-MAIL CORPORATIVO SITE REFERENC COML NFE 3S ALTO VALOR FATURADO';

    if (isDefaultSerasa || pontos.doc_extraviado < 0) {
      risco = isDefaultSerasa ? 'ALTO-RISCO-DEFAULT' : 'FRAUDE-DOCUMENTO';
      sugestao = 'SÓ À VISTA / PAGAMENTO ANTECIPADO';
    } else if (!isFaturado) {
      risco = 'SEM-RISCO';
      sugestao = 'LIBERADO';
    } else if (totalScore > 5) {
      risco = 'SEM-RISCO';
      sugestao = 'LIBERADO';
    } else if (totalScore >= -3) {
      risco = 'MÉDIO RISCO';
      sugestao = 'VER E-MAIL CORPORATIVO SITE REFERENC COML NFE 3S ALTO VALOR FATURADO';
    } else {
      if (subGolpe < -15) {
        risco = 'GOLPE';
        sugestao = 'ENTRADA OU A VISTA';
      } else if (subEmpresinha < -15) {
        risco = 'ALTO RISCO';
        sugestao = 'ENTRADA OU A VISTA';
      } else {
        if (subGolpe < subEmpresinha) {
          risco = 'GOLPE';
          sugestao = 'ENTRADA OU A VISTA';
        } else {
          risco = 'EMPRESINHA';
          sugestao = 'VER E-MAIL CORPORATIVO SITE REFERENC COML NFE 3S ALTO VALOR FATURADO';
        }
      }
    }

    const alertaPedCompra = totalPed > getCfg('limite_pedido_compra', 5000) ? 'SOLICITAR PED COMPRA' : 'N/A';
    const alertaContratoEntrega = dados.armario_cofre_gt_2000 === 'S' ? 'SOLIC CONTRATO DE ENTREGA' : 'N/A';
    const alertaPerigoGolpe = !entregaIgualCadastro && isFaturado && dados.entrega_igual_cadastro ? 'PERIGO CHECAGEM REVERSA' : 'N/A';
    const alertaCadastroReceita = dados.cadastro_igual_receita === 'INDISPONIVEL' || dados.receita_offline === true
      ? 'RECEITA OFFLINE - CONFERIR ENDEREÇO'
      : (dados.cadastro_igual_receita === 'N' ? 'PRECISA CORRIGIR END DIVERGENTE' : 'N/A');

    const sugestoesLista = [];
    if (alertaContratoEntrega !== 'N/A') sugestoesLista.push('SOLIC CONTRATO DE ENTREGA');
    if (alertaPedCompra !== 'N/A') sugestoesLista.push('SOLICITAR PED COMPRA');
    if (alertaPerigoGolpe !== 'N/A') sugestoesLista.push('PERIGO CHECAGEM REVERSA');
    if (alertaCadastroReceita !== 'N/A') sugestoesLista.push(alertaCadastroReceita);
    if (sugestao && sugestao !== 'LIBERADO' && !sugestoesLista.includes(sugestao)) {
      sugestoesLista.push(sugestao);
    }

    return {
      totalScore,
      risco,
      sugestao,
      alertaPedCompra,
      alertaContratoEntrega,
      alertaPerigoGolpe,
      alertaCadastroReceita,
      sugestoesLista,
      detalhesPontos: pontos
    };
  }

  // Atualização em Tempo Real na Interface (Card da Seção 7 e Banners Superiores)
  function atualizarScoreEmTempoReal() {
    const dados = extrairDadosFormCredito();
    
    // Se ainda não tem pedido ou cliente preenchido, mantém estado inicial
    if (!dados.pedido_venda && !dados.total_pedido) {
      const liveVal = document.getElementById('liveScoreValue');
      const liveRisk = document.getElementById('liveScoreRiskBadge');
      const liveSug = document.getElementById('liveScoreSugestao');
      const liveBadges = document.getElementById('liveScoreBadgesMini');
      if (liveVal) liveVal.textContent = '--';
      if (liveRisk) {
        liveRisk.textContent = 'AGUARDANDO DADOS';
        liveRisk.style.background = 'rgba(56, 189, 248, 0.2)';
        liveRisk.style.color = '#38bdf8';
      }
      if (liveSug) liveSug.innerHTML = 'Sugestão: <span style="color:#fbbf24;">Preencha os campos para calcular</span>';
      if (liveBadges) liveBadges.innerHTML = '';
      return;
    }

    const res = calcularScoreClienteFrontend(dados);

    // 1. Atualiza o Card Live da Seção 7
    const liveVal = document.getElementById('liveScoreValue');
    const liveRisk = document.getElementById('liveScoreRiskBadge');
    const liveSug = document.getElementById('liveScoreSugestao');
    const liveBadges = document.getElementById('liveScoreBadgesMini');

    if (liveVal) {
      liveVal.textContent = res.totalScore;
      liveVal.style.color = res.totalScore > 5 ? '#22c55e' : (res.totalScore >= -3 ? '#fbbf24' : '#f87171');
    }

    if (liveRisk) {
      liveRisk.textContent = res.risco;
      if (res.risco === 'SEM-RISCO') {
        liveRisk.style.background = 'rgba(34, 197, 94, 0.2)';
        liveRisk.style.color = '#22c55e';
      } else if (res.risco === 'GOLPE' || res.risco === 'ALTO RISCO') {
        liveRisk.style.background = 'rgba(239, 68, 68, 0.25)';
        liveRisk.style.color = '#f87171';
      } else {
        liveRisk.style.background = 'rgba(245, 158, 11, 0.2)';
        liveRisk.style.color = '#fbbf24';
      }
    }

    if (liveSug) {
      liveSug.innerHTML = `Sugestão: <strong style="color: #38bdf8;">${escapeHtml(res.sugestao)}</strong>`;
    }

    if (liveBadges) {
      liveBadges.innerHTML = gerarBadgesSugestoesHtml(res.sugestoesLista);
    }

    // 2. Atualiza os Banners Superiores de Sugestões de Segurança
    const listaBadgesSugestoes = document.getElementById('listaBadgesSugestoes');
    if (listaBadgesSugestoes) {
      listaBadgesSugestoes.innerHTML = gerarBadgesSugestoesHtml(res.sugestoesLista);
    }

    const setAlerta = (id, val, text) => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = val !== 'N/A' ? text : 'Dispensado / Sem Risco';
        el.style.color = val !== 'N/A' ? '#f87171' : '#22c55e';
      }
    };

    setAlerta('valAlertaPedCompra', res.alertaPedCompra, 'SOLICITAR PED. COMPRA');
    setAlerta('valAlertaContrato', res.alertaContratoEntrega, 'SOLIC. CONTRATO ENTREGA');
    setAlerta('valAlertaGolpe', res.alertaPerigoGolpe, 'PERIGO CHECAGEM REVERSA');
    setAlerta('valAlertaCadReceita', res.alertaCadastroReceita, res.alertaCadastroReceita === 'RECEITA OFFLINE - CONFERIR ENDEREÇO' ? 'CONFERIR END. (RECEITA OFFLINE)' : 'CORRIGIR END. DIVERGENTE');
  }

  // Conecta escutas reativas em todo o formulário para recálculo instantâneo a cada tecla/seleção
  if (formAnaliseCreditoCompleto) {
    formAnaliseCreditoCompleto.addEventListener('input', atualizarScoreEmTempoReal);
    formAnaliseCreditoCompleto.addEventListener('change', atualizarScoreEmTempoReal);
  }

  // Submeter e Gravar Análise de Crédito no Banco
  if (formAnaliseCreditoCompleto) {
    formAnaliseCreditoCompleto.addEventListener('submit', async (e) => {
      e.preventDefault();

      const payload = extrairDadosFormCredito();

      const semCapValido = payload.sem_capital_social === 'S';

      // Lista de campos com validação de preenchimento obrigatório
      const camposObrigatorios = [
        { val: payload.pedido_venda, id: 'cr_pedido_venda', label: 'Nº Pedido' },
        { val: payload.cliente_nome, id: 'cr_cliente_nome', label: 'Razão Social' },
        { val: payload.total_pedido, id: 'cr_total_pedido', label: 'Total do Pedido' },
        { val: payload.faturado, id: 'cr_faturado', label: 'Faturado a Prazo' },
        { val: payload.entrada, id: 'cr_entrada', label: 'Possui Entrada' },
        { val: payload.quant_grande, id: 'cr_quant_grande', label: 'Qtd. Grande' },
        { val: payload.prod_nao_combinam, id: 'cr_prod_nao_combinam', label: 'Prod. Ñ Combinam' },
        { val: payload.armario_cofre_gt_2000, id: 'cr_armario_cofre_gt_2000', label: 'Item Unitário > 2k' },
        { val: payload.uf_cliente, id: 'cr_uf_cliente', label: 'UF do Cliente' },
        { val: payload.entrega_igual_cadastro, id: 'cr_entrega_igual_cadastro', label: 'Entrega = Cadastro' },
        { val: payload.cadastro_igual_receita, id: 'cr_cadastro_igual_receita', label: 'Cadastro = Receita' },
        { val: payload.casa_sala_conj_end, id: 'cr_casa_sala_conj_end', label: 'Casa/Sala no Endereço' },
        { val: payload.registro_br, id: 'cr_registro_br', label: 'Registro.Br Confere' },
        { val: payload.email_corporativo, id: 'cr_email_corporativo', label: 'E-mail Corporativo' },
        { val: payload.existe_mail_financeiro, id: 'cr_existe_mail_financeiro', label: 'Mail Finan Diferente' },
        { val: payload.mail_gratuito, id: 'cr_mail_gratuito', label: 'E-mail Gratuito' },
        { val: payload.possui_site, id: 'cr_possui_site', label: 'Possui Site Ativo' },
        { val: payload.fundacao_matriz, id: 'cr_fundacao_matriz', label: 'Fundação Matriz' },
        { val: semCapValido ? 'ISENTO' : (payload.capital_social !== null && payload.capital_social !== undefined && payload.capital_social !== '' ? payload.capital_social : ''), id: 'cr_capital_social', label: 'Capital Social' },
        { val: payload.score_serasa, id: 'cr_score_serasa', label: 'Score Serasa' },
        { val: payload.protestos, id: 'cr_protestos', label: 'Possui Protestos' },
        { val: payload.pfin, id: 'cr_pfin', label: 'PFIN Sim' },
        { val: payload.ch_sem_fundo, id: 'cr_ch_sem_fundo', label: 'Cheques Sem Fundo' },
        { val: payload.cnpj_ativo, id: 'cr_cnpj_ativo', label: 'CNPJ Ativo na RF' },
        { val: payload.pgtos_abertos, id: 'cr_pgtos_abertos', label: 'Pgtos em Aberto' },
        { val: payload.comprou_pagou, id: 'cr_comprou_pagou', label: 'Comprou e Pagou 2x+' },
        { val: payload.comprou_pagou_5x, id: 'cr_comprou_pagou_5x', label: 'Comprou e Pagou 5x+' },
        { val: payload.fgts_situacao_regular, id: 'cr_fgts_situacao_regular', label: 'FGTS Regular' },
        { val: payload.razao_fgts_igual, id: 'cr_razao_fgts_igual', label: 'Razão = FGTS' },
        { val: payload.alteracao_recente_socios, id: 'cr_alteracao_recente_socios', label: 'Alteração Recente de Sócios' },
        { val: payload.aumento_expressivo_capital, id: 'cr_aumento_expressivo_capital', label: 'Aumento Expressivo de Capital' }
      ];

      for (const item of camposObrigatorios) {
        if (item.val === undefined || item.val === null || item.val === '') {
          const el = document.getElementById(item.id);
          if (el) {
            el.focus();
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          alert(`⚠️ Campo obrigatório não preenchido: "${item.label}".\n\nNenhum campo pode estar em branco para registrar a análise definitiva no banco.`);
          return;
        }
      }

      // Validação da Decisão Final do Analista
      const decisao = (payload.decisao_final || '').trim();
      if (!decisao || decisao === 'Decisão (atenção ao gravar)') {
        const el = document.getElementById('cr_decisao_final');
        if (el) {
          el.focus();
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        alert('⚠️ Escolha uma decisão antes de gravar.');
        return;
      }

      // Anexa o usuário logado que está gravando a análise
      payload.usuario = currentUser ? (currentUser.name || currentUser.username) : 'Sistema';

      const btnSubmit = document.getElementById('btnCalcularSalvarCredito');
      if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = 'Gravando...';
      }

      try {
        const res = await fetch('/api/financeiro/analise-credito/calcular-salvar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Erro ao calcular e salvar score.');
        }

        const resScore = data.resultado;
        const txtTotalScore = document.getElementById('txtTotalScore');
        const txtRiscoBadge = document.getElementById('txtRiscoBadge');
        const txtSugestaoParecer = document.getElementById('txtSugestaoParecer');
        const scoreBadgeVal = document.getElementById('scoreBadgeVal');

        if (txtTotalScore) txtTotalScore.textContent = resScore.totalScore;
        if (txtRiscoBadge) {
          txtRiscoBadge.textContent = resScore.risco;
          txtRiscoBadge.style.background = resScore.risco === 'SEM-RISCO' ? 'rgba(34, 197, 94, 0.2)' : (resScore.risco === 'GOLPE' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(245, 158, 11, 0.2)');
          txtRiscoBadge.style.color = resScore.risco === 'SEM-RISCO' ? '#22c55e' : (resScore.risco === 'GOLPE' ? '#f87171' : '#fbbf24');
        }
        if (txtSugestaoParecer) txtSugestaoParecer.textContent = resScore.sugestao;
        if (scoreBadgeVal) {
          scoreBadgeVal.style.color = resScore.totalScore > 5 ? '#22c55e' : '#f87171';
          scoreBadgeVal.style.borderColor = resScore.totalScore > 5 ? '#22c55e' : '#f87171';
          scoreBadgeVal.style.background = resScore.totalScore > 5 ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)';
        }

        atualizarScoreEmTempoReal();

        if (creditoResultadoSection) creditoResultadoSection.classList.remove('hidden');
        creditoResultadoSection.scrollIntoView({ behavior: 'smooth' });

        alert(`✓ Análise de Crédito do Pedido #${payload.pedido_venda} GRAVADA COM SUCESSO!\n\nScore Final: ${resScore.totalScore} pts\nRisco: ${resScore.risco}\nDecisão: ${payload.decisao_final}`);

        carregarHistoricoCredito();
      } catch (err) {
        alert('Erro ao registrar análise no banco: ' + err.message);
      } finally {
        if (btnSubmit) {
          btnSubmit.disabled = false;
          btnSubmit.innerHTML = '🛡️ Gravar Análise no Banco';
        }
      }
    });
  }

  // Helper para renderizar badges de sugestões de segurança
  function gerarBadgesSugestoesHtml(sugestoesArr) {
    if (!sugestoesArr || sugestoesArr.length === 0) {
      return `<span class="badge" style="background: rgba(34, 197, 94, 0.12); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.3); font-size: 0.75rem; padding: 3px 8px;">✓ Nenhuma ação crítica (Liberado)</span>`;
    }
    return sugestoesArr.map(sug => {
      const s = String(sug).trim();
      if (s.includes('CONTRATO DE ENTREGA')) {
        return `<span class="badge" style="background: rgba(192, 132, 252, 0.2); color: #c084fc; border: 1px solid rgba(192, 132, 252, 0.4); font-size: 0.74rem; font-weight: 700; padding: 2px 7px;">📦 SOLIC CONTRATO DE ENTREGA</span>`;
      }
      if (s.includes('PED COMPRA')) {
        return `<span class="badge" style="background: rgba(251, 191, 36, 0.2); color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.4); font-size: 0.74rem; font-weight: 700; padding: 2px 7px;">📋 SOLICITAR PED COMPRA</span>`;
      }
      if (s.includes('CHECAGEM REVERSA')) {
        return `<span class="badge" style="background: rgba(239, 68, 68, 0.25); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.45); font-size: 0.74rem; font-weight: 800; padding: 2px 7px;">🚨 PERIGO CHECAGEM REVERSA</span>`;
      }
      if (s.includes('CORRIGIR END DIVERGENTE') || s.includes('PRECISA CORRIGIR')) {
        return `<span class="badge" style="background: rgba(244, 63, 94, 0.2); color: #f43f5e; border: 1px solid rgba(244, 63, 94, 0.4); font-size: 0.74rem; font-weight: 700; padding: 2px 7px;">❗ CORRIGIR END DIVERGENTE</span>`;
      }
      return `<span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); font-size: 0.74rem; font-weight: 600; padding: 2px 7px;">💡 ${escapeHtml(s)}</span>`;
    }).join(' ');
  }

  // Carregar Histórico
  let limiteExibicaoHistorico = 15;

  async function carregarHistoricoCredito() {
    try {
      const res = await fetch('/api/financeiro/analise-credito/historico');
      const data = await res.json();
      if (data.success && Array.isArray(data.historico)) {
        listaHistoricoCredito = data.historico;
        renderHistoricoCreditoTable();
      }
    } catch (e) {
      console.warn('Falha ao carregar histórico de crédito', e);
    }
  }

  function renderHistoricoCreditoTable() {
    if (!historicoCreditoTableBody) return;
    const termo = buscaHistoricoCredito ? buscaHistoricoCredito.value.toLowerCase().trim() : '';
    const periodo = filtroPeriodoHistoricoCredito ? filtroPeriodoHistoricoCredito.value : 'todos';

    const agora = Date.now();
    const seteDiasMs = 7 * 24 * 60 * 60 * 1000;
    const trintaDiasMs = 30 * 24 * 60 * 60 * 1000;

    const filtrados = listaHistoricoCredito.filter(item => {
      const matchTermo = (
        String(item.pedido_venda || '').toLowerCase().includes(termo) ||
        String(item.cliente_nome || '').toLowerCase().includes(termo) ||
        String(item.empresa || '').toLowerCase().includes(termo) ||
        String(item.risco || '').toLowerCase().includes(termo) ||
        String(item.usuario || '').toLowerCase().includes(termo)
      );
      if (!matchTermo) return false;

      if (periodo === '7d') {
        if (!item.created_at) return false;
        const itemTime = new Date(item.created_at).getTime();
        return (agora - itemTime) <= seteDiasMs;
      }
      if (periodo === '30d') {
        if (!item.created_at) return false;
        const itemTime = new Date(item.created_at).getTime();
        return (agora - itemTime) <= trintaDiasMs;
      }
      return true;
    });

    const badgeQtd = document.getElementById('badgeQtdHistorico');
    const lblSubtitulo = document.getElementById('lblSubtituloHistorico');
    const btnToggle = document.getElementById('btnToggleQtdHistorico');

    if (btnToggle) {
      btnToggle.innerHTML = limiteExibicaoHistorico === 15 ? '📊 Listar Últimos 100' : '⚡ Listar Últimos 15';
    }

    const isFiltrado = termo || periodo !== 'todos';
    const periodoLabel = periodo === '7d' ? 'Últimos 7 dias' : (periodo === '30d' ? 'Últimos 30 dias' : '');

    if (badgeQtd) {
      if (isFiltrado) {
        badgeQtd.textContent = `Filtrado (${filtrados.length})`;
      } else {
        badgeQtd.textContent = limiteExibicaoHistorico === 15 ? 'Últimos 15' : 'Últimos 100';
      }
    }

    const exibidos = isFiltrado ? filtrados.slice(0, 100) : filtrados.slice(0, limiteExibicaoHistorico);

    if (lblSubtitulo) {
      if (isFiltrado) {
        let descFiltro = [];
        if (termo) descFiltro.push(`busca "${termo}"`);
        if (periodoLabel) descFiltro.push(periodoLabel.toLowerCase());
        lblSubtitulo.textContent = `Exibindo ${exibidos.length} resultado(s) para ${descFiltro.join(' e ')}`;
      } else {
        lblSubtitulo.textContent = `Exibindo ${exibidos.length} de ${listaHistoricoCredito.length} análises gravadas no banco`;
      }
    }

    if (exibidos.length === 0) {
      historicoCreditoTableBody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">Nenhuma análise encontrada${periodoLabel ? ` nos ${periodoLabel.toLowerCase()}` : ''}.</td></tr>`;
      return;
    }

    historicoCreditoTableBody.innerHTML = exibidos.map(item => {
      const dataStr = item.created_at ? new Date(item.created_at).toLocaleString('pt-BR') : '-';
      const scoreColor = item.total_score > 5 ? '#22c55e' : '#f87171';
      const rawUser = String(item.usuario || (item.dados_completos && item.dados_completos.usuario) || 'Sistema').trim();
      const userInitial = rawUser.length > 0 ? rawUser.charAt(0).toUpperCase() : '-';
      
      let sugestoes = item.sugestoes_lista || [];
      if (sugestoes.length === 0) {
        if (item.alerta_contrato_entrega && item.alerta_contrato_entrega !== 'N/A') sugestoes.push('SOLIC CONTRATO DE ENTREGA');
        if (item.alerta_ped_compra && item.alerta_ped_compra !== 'N/A') sugestoes.push('SOLICITAR PED COMPRA');
        if (item.alerta_perigo_golpe && item.alerta_perigo_golpe !== 'N/A') sugestoes.push('PERIGO CHECAGEM REVERSA');
        if (item.alerta_cadastro_receita && item.alerta_cadastro_receita !== 'N/A') sugestoes.push('CORRIGIR END DIVERGENTE');
        if (item.sugestao && item.sugestao !== 'LIBERADO' && !sugestoes.includes(item.sugestao)) sugestoes.push(item.sugestao);
      }

      return `
        <tr>
          <td style="font-size: 0.8rem; font-family: var(--font-mono); color: var(--text-muted);">${dataStr}</td>
          <td style="text-align: center;"><span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-weight: 700;">${escapeHtml(item.empresa)}</span></td>
          <td style="text-align: center;">
            <span class="user-avatar-badge" title="Registrado por: ${escapeHtml(rawUser)}" style="display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: linear-gradient(135deg, rgba(56, 189, 248, 0.2), rgba(99, 102, 241, 0.25)); color: #38bdf8; font-weight: 700; font-size: 0.78rem; border: 1px solid rgba(56, 189, 248, 0.35); cursor: default; user-select: none;">
              ${escapeHtml(userInitial)}
            </span>
          </td>
          <td>
            <a href="javascript:void(0)" class="btn-abrir-ficha" data-id="${item.id}" style="color: #38bdf8; text-decoration: underline; font-weight: 700; font-family: var(--font-mono); font-size: 0.88rem;">
              #${escapeHtml(item.pedido_venda)}
            </a>
          </td>
          <td><strong>${escapeHtml(item.cliente_nome)}</strong></td>
          <td style="text-align: right; font-weight: 700; font-family: var(--font-mono);">R$ ${Number(item.total_pedido || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
          <td style="text-align: center;"><span class="badge" style="color: ${scoreColor}; font-weight: 800;">${item.total_score}</span></td>
          <td style="text-align: center;"><span class="badge" style="font-size: 0.75rem; font-weight: 700;">${escapeHtml(item.risco)}</span></td>
          <td>
            <div style="display: flex; flex-wrap: wrap; gap: 0.25rem;">
              ${gerarBadgesSugestoesHtml(sugestoes)}
            </div>
          </td>
          <td>
            <span class="badge" style="background: rgba(56, 189, 248, 0.12); color: #38bdf8; font-weight: 600; font-size: 0.75rem;">
              ${escapeHtml(item.decisao_final || 'Liberado')}
            </span>
          </td>
          <td style="text-align: center;">
            <button class="btn btn-secondary btn-small btn-abrir-ficha" data-id="${item.id}" style="padding: 3px 8px; font-size: 0.75rem;" title="Abrir Ficha Completa">
              👁️ Ficha
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Event Delegation para abertura da ficha de análise de crédito (Prevenção de vazamentos de memória)
  if (historicoCreditoTableBody) {
    historicoCreditoTableBody.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-abrir-ficha');
      if (btn) {
        e.preventDefault();
        const id = btn.getAttribute('data-id');
        if (id) abrirFichaAnaliseCredito(id);
      }
    });
  }

  // Conecta o botão de alternar quantidade exibida (15 vs 100)
  const btnToggleQtdHistorico = document.getElementById('btnToggleQtdHistorico');
  if (btnToggleQtdHistorico) {
    btnToggleQtdHistorico.addEventListener('click', () => {
      limiteExibicaoHistorico = limiteExibicaoHistorico === 15 ? 100 : 15;
      renderHistoricoCreditoTable();
    });
  }

  // Função para abrir o modal com a Ficha Completa da Análise de Crédito
  function abrirFichaAnaliseCredito(itemId) {
    const rawItem = listaHistoricoCredito.find(x => String(x.id) === String(itemId));
    if (!rawItem) return;
    const item = { ...(rawItem.dados_completos || {}), ...rawItem };

    const fmtSimNao = (v) => {
      const s = String(v || '').trim().toUpperCase();
      if (s === 'S' || s === 'SIM' || s === '1' || s === 'TRUE') return '<span style="color:#22c55e;font-weight:700;">Sim</span>';
      if (s === 'N' || s === 'NAO' || s === 'NÃO' || s === '0' || s === 'FALSE') return '<span style="color:#f87171;font-weight:700;">Não</span>';
      if (s === 'D' || s === 'DISPENSADO') return '<span style="color:#fbbf24;font-weight:700;">Dispensado</span>';
      return v ? `<span style="color:var(--text-primary);">${escapeHtml(String(v))}</span>` : '-';
    };

    const modal = document.getElementById('modalDetalhesAnaliseCredito');
    const titulo = document.getElementById('modalCreditoTitulo');
    const subtitulo = document.getElementById('modalCreditoSubtitulo');
    const corpo = document.getElementById('modalDetalhesCreditoCorpo');
    const btnImprimir = document.getElementById('btnImprimirFichaCredito');
    const btnCarregar = document.getElementById('btnCarregarNoFormCredito');
    const btnFechar = document.getElementById('btnFecharModalDetalhesCredito');
    const btnClose = document.getElementById('btnCloseModalDetalhesCredito');

    if (!modal || !corpo) return;

    const dataStr = item.created_at ? new Date(item.created_at).toLocaleString('pt-BR') : '-';
    const usuarioStr = item.usuario || (currentUser ? (currentUser.name || currentUser.username) : 'Sistema');
    if (titulo) titulo.innerHTML = `📋 Ficha de Análise de Crédito — Pedido <strong>#${escapeHtml(item.pedido_venda)}</strong>`;
    if (subtitulo) subtitulo.textContent = `Empresa: ${item.empresa || '-'} | Cliente: ${item.cliente_nome || '-'} | Data: ${dataStr} | Usuário: ${usuarioStr}`;

    let sugestoes = item.sugestoes_lista || [];
    if (sugestoes.length === 0) {
      if (item.alerta_contrato_entrega && item.alerta_contrato_entrega !== 'N/A') sugestoes.push('SOLIC CONTRATO DE ENTREGA');
      if (item.alerta_ped_compra && item.alerta_ped_compra !== 'N/A') sugestoes.push('SOLICITAR PED COMPRA');
      if (item.alerta_perigo_golpe && item.alerta_perigo_golpe !== 'N/A') sugestoes.push('PERIGO CHECAGEM REVERSA');
      if (item.alerta_cadastro_receita && item.alerta_cadastro_receita !== 'N/A') sugestoes.push('CORRIGIR END DIVERGENTE');
      if (item.sugestao && item.sugestao !== 'LIBERADO' && !sugestoes.includes(item.sugestao)) sugestoes.push(item.sugestao);
    }

    let pts = item.detalhes_pontos;
    const temPtsSalvos = pts && typeof pts === 'object' && Object.keys(pts).length > 0;
    if (!temPtsSalvos) {
      if (typeof calcularScoreClienteFrontend === 'function' && (item.cnpj_ativo !== undefined || item.faturado !== undefined || item.entrada !== undefined)) {
        const resCalc = calcularScoreClienteFrontend(item);
        pts = resCalc.detalhesPontos || {};
      } else {
        pts = {};
      }
    }

    const isSemCapItem = item.sem_capital_social === 'S' || item.capital_social === null || item.capital_social === undefined || (Number(item.capital_social) === 0 && item.sem_capital_social !== 'N');
    const capSocialFormatado = isSemCapItem ? 'Não informado / Isento' : `R$ ${Number(item.capital_social || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;

    // Lista de conferência de todos os critérios avaliados
    const extratoLinhas = [
      { cat: '1. Limites & Identificação', nome: 'Valor do Pedido (> R$ 21k)', val: item.total_pedido ? `R$ ${Number(item.total_pedido).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '-', pts: pts.total_pedido },
      { cat: '1. Limites & Identificação', nome: 'CNPJ Ativo na RF', val: item.cnpj_ativo === 'S' ? 'Ativo' : (item.cnpj_ativo === 'N' ? 'Inativo' : '-'), pts: pts.cnpj_ativo },
      { cat: '1. Limites & Identificação', nome: 'Endereço Cadastro = Receita', val: item.cadastro_igual_receita === 'S' ? 'Sim' : (item.cadastro_igual_receita === 'N' ? 'Não' : '-'), pts: pts.cadastro_igual_receita },
      { cat: '1. Limites & Identificação', nome: 'Casa / Sala no Endereço', val: item.casa_sala_conj_end === 'S' ? 'Sim' : (item.casa_sala_conj_end === 'N' ? 'Não' : '-'), pts: pts.casa_sala_conj },
      { cat: '1. Limites & Identificação', nome: 'Fundação Matriz (Idade Empresa)', val: item.fundacao_matriz || '-', pts: pts.idade_empresa },
      { cat: '1. Limites & Identificação', nome: 'Capital Social Integralizado', val: capSocialFormatado, pts: pts.capital_social },
      { cat: '1. Limites & Identificação', nome: 'Empresa Grande / Notória', val: item.empresa_grande_conhecida === 'S' ? 'Sim' : (item.empresa_grande_conhecida === 'N' ? 'Não' : '-'), pts: pts.empresa_grande_conhecida },

      { cat: '2. Comercial & Pagamentos', nome: 'Condição de Venda (À Vista / Prazo)', val: item.faturado === 'N' ? 'À Vista (+100)' : (item.faturado === 'S' ? 'A Prazo (0)' : '-'), pts: pts.faturado },
      { cat: '2. Comercial & Pagamentos', nome: 'Possui Entrada', val: item.entrada === 'S' ? 'Sim' : (item.entrada === 'N' ? 'Não' : '-'), pts: pts.entrada },
      { cat: '2. Comercial & Pagamentos', nome: 'Histórico Protheus (Comprou 2x+)', val: item.comprou_pagou === 'S' ? 'Sim' : (item.comprou_pagou === 'N' ? 'Não' : '-'), pts: pts.comprou_pagou },
      { cat: '2. Comercial & Pagamentos', nome: 'Histórico Protheus (Comprou 5x+)', val: item.comprou_pagou_5x === 'S' ? 'Sim' : (item.comprou_pagou_5x === 'N' ? 'Não' : '-'), pts: pts.comprou_pagou_5x },
      { cat: '2. Comercial & Pagamentos', nome: 'Pagamentos em Aberto', val: item.pgtos_abertos === 'S' ? 'Sim' : (item.pgtos_abertos === 'N' ? 'Não' : '-'), pts: pts.pgtos_abertos },
      { cat: '2. Comercial & Pagamentos', nome: 'Quantidade Muito Alta de Itens', val: item.quant_grande === 'S' ? 'Sim' : (item.quant_grande === 'N' ? 'Não' : '-'), pts: pts.quant_grande },
      { cat: '2. Comercial & Pagamentos', nome: 'Produtos Variados Sem Afinidade', val: item.prod_nao_combinam === 'S' ? 'Sim' : (item.prod_nao_combinam === 'N' ? 'Não' : '-'), pts: pts.prod_nao_combinam },
      { cat: '2. Comercial & Pagamentos', nome: 'UF do Cliente (Destino)', val: item.uf_cliente || '-', pts: pts.uf_cliente },

      { cat: '3. Endereço & Maturidade Digital', nome: 'Entrega = Cadastro Principal', val: item.entrega_igual_cadastro === 'S' ? 'Sim' : (item.entrega_igual_cadastro === 'N' ? 'Não' : '-'), pts: pts.entrega_igual_cadastro },
      { cat: '3. Endereço & Maturidade Digital', nome: 'Registro.br Confere', val: item.registro_br === 'S' ? 'Sim' : (item.entrega_igual_cadastro === 'S' ? 'Dispensado' : (item.registro_br === 'N' ? 'Não' : '-')), pts: pts.registro_br },
      { cat: '3. Endereço & Maturidade Digital', nome: 'Idade Domínio (RDAP Registro.br)', val: item.idade_dominio_rdap !== undefined && item.idade_dominio_rdap !== null && item.idade_dominio_rdap !== '' ? `${item.idade_dominio_rdap} anos` : (item.possui_site === 'N' ? 'Sem Site' : '-'), pts: pts.idade_dominio },
      { cat: '3. Endereço & Maturidade Digital', nome: '1º Snapshot Archive.org Wayback', val: item.wayback_primeiro_snapshot || '-', pts: pts.wayback },
      { cat: '3. Endereço & Maturidade Digital', nome: 'Servidor MX de E-mails', val: item.tipo_servidor_mx || item.servidor_mx || '-', pts: pts.servidor_mx },

      { cat: '4. E-mails & Site Corporativo', nome: 'E-mail com Domínio Corporativo', val: item.email_corporativo === 'S' ? 'Sim' : (item.email_corporativo === 'N' ? 'Não' : '-'), pts: pts.email_corporativo },
      { cat: '4. E-mails & Site Corporativo', nome: 'E-mail do Financeiro Diferente', val: item.existe_mail_financeiro === 'S' ? 'Sim' : (item.existe_mail_financeiro === 'N' ? 'Não' : '-'), pts: pts.existe_mail_financeiro },
      { cat: '4. E-mails & Site Corporativo', nome: 'E-mail Gratuito / Genérico', val: item.mail_gratuito === 'S' ? 'Sim' : (item.mail_gratuito === 'N' ? 'Não' : '-'), pts: pts.mail_gratuito },
      { cat: '4. E-mails & Site Corporativo', nome: 'Possui Site Corporativo Ativo', val: item.possui_site === 'S' ? 'Sim' : (item.possui_site === 'N' ? 'Não' : '-'), pts: pts.possui_site },

      { cat: '5. Bureau, Serasa & Protestos', nome: 'Score Serasa (Faixa / DEFAULT)', val: item.score_serasa !== undefined && item.score_serasa !== '' ? `${item.score_serasa}` : '-', pts: pts.score_serasa },
      { cat: '5. Bureau, Serasa & Protestos', nome: 'Apontamento de Protestos', val: item.protestos === 'S' ? 'Sim' : (item.protestos === 'N' ? 'Não' : '-'), pts: pts.protestos },
      { cat: '5. Bureau, Serasa & Protestos', nome: 'Protestos > 2x Pedido', val: item.protestos === 'S' && pts.vlr_protestos_vs_ped !== 0 && pts.vlr_protestos_vs_ped !== undefined ? 'Sim (> 2x)' : 'Não / Dispensado', pts: pts.vlr_protestos_vs_ped },
      { cat: '5. Bureau, Serasa & Protestos', nome: 'Protestos vs Capital Social', val: item.protestos === 'S' && pts.protestos_vs_capital !== 0 && pts.protestos_vs_capital !== undefined ? (pts.protestos_vs_capital < 0 ? '> Capital' : '<= Capital') : 'Dispensado', pts: pts.protestos_vs_capital },
      { cat: '5. Bureau, Serasa & Protestos', nome: 'Pendência Financeira (PEFIN)', val: item.pfin === 'S' ? 'Sim' : (item.pfin === 'N' ? 'Não' : '-'), pts: pts.pfin },
      { cat: '5. Bureau, Serasa & Protestos', nome: 'Pendência Bancária (REFIN)', val: item.refin === 'S' ? 'Sim' : (item.refin === 'N' ? 'Não' : '-'), pts: pts.refin },
      { cat: '5. Bureau, Serasa & Protestos', nome: 'Dívidas Vencidas', val: item.dividas_vencidas === 'S' ? 'Sim' : (item.dividas_vencidas === 'N' ? 'Não' : '-'), pts: pts.dividas_vencidas },
      { cat: '5. Bureau, Serasa & Protestos', nome: 'Cheques Sem Fundo', val: item.ch_sem_fundo === 'S' ? 'Sim' : (item.ch_sem_fundo === 'N' ? 'Não' : '-'), pts: pts.ch_sem_fundo },
      { cat: '5. Bureau, Serasa & Protestos', nome: 'Densidade Consultas Recentes', val: item.consultas_densidade_dia ? `${item.consultas_densidade_dia}/dia` : '0/dia', pts: pts.densidade_consultas },
      { cat: '5. Bureau, Serasa & Protestos', nome: 'Consultas Fomento / Factoring', val: item.consultantes_fomento === 'S' ? 'Sim' : (item.consultantes_fomento === 'N' ? 'Não' : '-'), pts: pts.consultantes_fomento },
      { cat: '5. Bureau, Serasa & Protestos', nome: 'Sócios com Restrição no Bureau', val: item.socios_anotacao === 'S' ? 'Sim' : (item.socios_anotacao === 'N' ? 'Não' : '-'), pts: pts.socios_anotacao },
      { cat: '5. Bureau, Serasa & Protestos', nome: 'Documento Extraviado / Roubado', val: item.documentos_extraviados === 'S' ? 'Sim (ALERTA)' : (item.documentos_extraviados === 'N' ? 'Não' : '-'), pts: pts.doc_extraviado },

      { cat: '6. FGTS, Sócios & Certidões', nome: 'Certidão FGTS Regular', val: item.fgts_situacao_regular === 'S' ? 'Regular' : (item.fgts_situacao_regular === 'N' ? 'Irregular' : (item.fgts_situacao_regular === 'NE' ? 'Não Encontrado' : '-')), pts: pts.fgts_regular !== undefined ? pts.fgts_regular : pts.fgts_situacao_regular },
      { cat: '6. FGTS, Sócios & Certidões', nome: 'Razão Social = FGTS', val: item.razao_fgts_igual === 'S' ? 'Igual' : (item.razao_fgts_igual === 'N' ? 'Divergente' : (item.razao_fgts_igual === 'NE' ? 'Não Encontrado' : '-')), pts: pts.razao_fgts_igual },
      { cat: '6. FGTS, Sócios & Certidões', nome: 'Alteração Recente de Sócios', val: item.alteracao_recente_socios === 'S' ? 'Sim (Alterado)' : 'Não', pts: pts.alteracao_recente_socios },
      { cat: '6. FGTS, Sócios & Certidões', nome: 'Aumento Expressivo de Capital', val: item.aumento_expressivo_capital === 'S' ? 'Sim (Aumento)' : 'Não', pts: pts.aumento_expressivo_capital }
    ];

    let totalGanhos = 0;
    let totalPerdas = 0;
    let temAlgumPonto = false;
    extratoLinhas.forEach(l => {
      if (l.pts !== undefined && l.pts !== null && !isNaN(Number(l.pts))) {
        temAlgumPonto = true;
        const p = Number(l.pts);
        if (p > 0) totalGanhos += p;
        else if (p < 0) totalPerdas += p;
      }
    });

    const totalScoreVal = item.total_score !== undefined ? item.total_score : (item.score !== undefined ? item.score : (temAlgumPonto ? (totalGanhos + totalPerdas) : 0));
    const somaFinalCalculada = temAlgumPonto ? (totalGanhos + totalPerdas) : Number(totalScoreVal || 0);
    const scoreColor = (Number(totalScoreVal) > 5) ? '#22c55e' : '#f87171';

    corpo.innerHTML = `
      <!-- Top Summary Banner -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; background: rgba(15, 23, 42, 0.6); padding: 1.25rem; border-radius: 10px; border: 1px solid var(--panel-border);">
        <div>
          <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">Score Obtido</div>
          <div style="font-size: 1.6rem; font-weight: 900; color: ${scoreColor}; font-family: var(--font-mono);">${totalScoreVal} <span style="font-size: 0.9rem; font-weight: 500; color: var(--text-muted);">pts</span></div>
        </div>
        <div>
          <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">Grau de Risco</div>
          <div style="margin-top: 4px;"><span class="badge" style="font-size: 0.9rem; font-weight: 800; padding: 4px 12px;">${escapeHtml(item.risco || '-')}</span></div>
        </div>
        <div>
          <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">Decisão do Analista</div>
          <div style="font-size: 1.1rem; font-weight: 700; color: #38bdf8; margin-top: 4px;">${escapeHtml(item.decisao_final || 'Liberado')}</div>
        </div>
        <div>
          <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">Total do Pedido</div>
          <div style="font-size: 1.2rem; font-weight: 800; color: #f8fafc; font-family: var(--font-mono); margin-top: 4px;">R$ ${Number(item.total_pedido || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
        </div>
      </div>

      <!-- Bloco de Sugestões de Segurança -->
      <div style="padding: 1rem 1.25rem; border-radius: 10px; background: rgba(30, 41, 59, 0.6); border: 1px solid rgba(251, 191, 36, 0.3);">
        <div style="font-size: 0.85rem; font-weight: 700; color: #fbbf24; margin-bottom: 0.5rem;">🛡️ SUGESTÕES & AÇÕES DE SEGURANÇA DETERMINADAS:</div>
        <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.4rem;">
          ${gerarBadgesSugestoesHtml(sugestoes)}
        </div>
        <div style="margin-top: 0.6rem; font-size: 0.85rem; color: #38bdf8; font-weight: 600;">
          Parecer da Matriz de Risco: <em>${escapeHtml(item.sugestao || 'LIBERADO')}</em>
        </div>
      </div>

      <!-- Bloco 1: Venda & Identificação -->
      <div style="background: rgba(15, 23, 42, 0.35); padding: 1rem; border-radius: 8px; border: 1px solid var(--panel-border);">
        <h4 style="margin: 0 0 0.75rem 0; color: #38bdf8; font-size: 0.9rem;">1. Identificação do Cliente, Pedido e CNPJ Receita</h4>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.75rem; font-size: 0.85rem;">
          <div><strong style="color:var(--text-muted)">Nº Pedido:</strong> #${escapeHtml(item.pedido_venda)}</div>
          <div><strong style="color:var(--text-muted)">Cód. Web:</strong> ${escapeHtml(item.cod_web || '-')}</div>
          <div><strong style="color:var(--text-muted)">Cód. Cliente:</strong> ${escapeHtml(item.cliente_codigo || '-')}</div>
          <div style="grid-column: span 2;"><strong style="color:var(--text-muted)">Razão Social:</strong> ${escapeHtml(item.cliente_nome)}</div>
          <div><strong style="color:var(--text-muted)">Total Pedido:</strong> R$ ${Number(item.total_pedido || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} ${formatarBadgePontos(pts.total_pedido)}</div>
          <div><strong style="color:var(--text-muted)">Desconto:</strong> ${escapeHtml(item.desconto_ped || 'OK')}</div>
          <div><strong style="color:var(--text-muted)">CNPJ Ativo na RF:</strong> ${fmtSimNao(item.cnpj_ativo)} ${formatarBadgePontos(pts.cnpj_ativo)}</div>
          <div><strong style="color:var(--text-muted)">Cadastro = Receita:</strong> ${fmtSimNao(item.cadastro_igual_receita)} ${formatarBadgePontos(pts.cadastro_igual_receita)}</div>
          <div><strong style="color:var(--text-muted)">Casa/Sala no End.:</strong> ${fmtSimNao(item.casa_sala_conj_end)} ${formatarBadgePontos(pts.casa_sala_conj)}</div>
          <div><strong style="color:var(--text-muted)">Fundação Matriz:</strong> ${escapeHtml(item.fundacao_matriz || '-')} ${formatarBadgePontos(pts.idade_empresa)}</div>
          <div><strong style="color:var(--text-muted)">Capital Social:</strong> ${capSocialFormatado} ${formatarBadgePontos(pts.capital_social)}</div>
          <div><strong style="color:var(--text-muted)">Empresa Grande / Notória:</strong> ${fmtSimNao(item.empresa_grande_conhecida)} ${formatarBadgePontos(pts.empresa_grande_conhecida)}</div>
        </div>
      </div>

      <!-- Bloco 2: Comercial & Pagamento -->
      <div style="background: rgba(15, 23, 42, 0.35); padding: 1rem; border-radius: 8px; border: 1px solid var(--panel-border);">
        <h4 style="margin: 0 0 0.75rem 0; color: #22c55e; font-size: 0.9rem;">2. Condições Comerciais & Histórico de Pagamentos</h4>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem; font-size: 0.85rem;">
          <div><strong style="color:var(--text-muted)">Faturado a Prazo:</strong> ${item.faturado === 'N' ? '<span style="color:#22c55e;font-weight:700;">Não (À Vista)</span>' : '<span style="color:#38bdf8;font-weight:700;">Sim (A Prazo)</span>'} ${formatarBadgePontos(pts.faturado)}</div>
          <div><strong style="color:var(--text-muted)">Possui Entrada:</strong> ${fmtSimNao(item.entrada)} ${formatarBadgePontos(pts.entrada)}</div>
          <div><strong style="color:var(--text-muted)">Pgtos em Aberto:</strong> ${fmtSimNao(item.pgtos_abertos)} ${formatarBadgePontos(pts.pgtos_abertos)}</div>
          <div><strong style="color:var(--text-muted)">Comprou e Pagou 2x+:</strong> ${fmtSimNao(item.comprou_pagou)} ${formatarBadgePontos(pts.comprou_pagou)}</div>
          <div><strong style="color:var(--text-muted)">Comprou e Pagou 5x+:</strong> ${fmtSimNao(item.comprou_pagou_5x)} ${formatarBadgePontos(pts.comprou_pagou_5x)}</div>
          <div><strong style="color:var(--text-muted)">Qtd. Grande:</strong> ${fmtSimNao(item.quant_grande)} ${formatarBadgePontos(pts.quant_grande)}</div>
          <div><strong style="color:var(--text-muted)">Prod. Ñ Combinam:</strong> ${fmtSimNao(item.prod_nao_combinam)} ${formatarBadgePontos(pts.prod_nao_combinam)}</div>
          <div><strong style="color:var(--text-muted)">Item Unitário > 2k:</strong> ${fmtSimNao(item.armario_cofre_gt_2000)}</div>
          <div><strong style="color:var(--text-muted)">UF do Cliente:</strong> ${escapeHtml(item.uf_cliente || '-')} ${formatarBadgePontos(pts.uf_cliente)}</div>
        </div>
      </div>

      <!-- Bloco 3: Endereço, Localização & Maturidade Digital -->
      <div style="background: rgba(15, 23, 42, 0.35); padding: 1rem; border-radius: 8px; border: 1px solid var(--panel-border);">
        <h4 style="margin: 0 0 0.75rem 0; color: #a855f7; font-size: 0.9rem;">3. Endereço, Localização & Maturidade Digital</h4>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem; font-size: 0.85rem;">
          <div><strong style="color:var(--text-muted)">Entrega = Cadastro:</strong> ${fmtSimNao(item.entrega_igual_cadastro)} ${formatarBadgePontos(pts.entrega_igual_cadastro)}</div>
          <div><strong style="color:var(--text-muted)">Registro.Br Confere:</strong> ${fmtSimNao(item.registro_br)} ${formatarBadgePontos(pts.registro_br)}${item.cnpj_registro_br ? ` <span style="font-size:0.75rem; color:#38bdf8;" title="Titular: ${escapeHtml(item.titular_registro_br || '')}">(${escapeHtml(item.cnpj_registro_br)})</span>` : ''}</div>
          <div><strong style="color:var(--text-muted)">Idade Domínio (RDAP):</strong> ${item.idade_dominio_rdap !== undefined && item.idade_dominio_rdap !== null && item.idade_dominio_rdap !== '' ? item.idade_dominio_rdap + ' anos' : (item.possui_site === 'N' ? 'Sem Site' : (item.dominio_principal || '-'))} ${formatarBadgePontos(pts.idade_dominio)}</div>
          <div><strong style="color:var(--text-muted)">1º Snapshot Wayback:</strong> ${escapeHtml(item.wayback_primeiro_snapshot || '-')} ${formatarBadgePontos(pts.wayback)}</div>
          <div><strong style="color:var(--text-muted)">Servidor MX:</strong> ${escapeHtml(item.tipo_servidor_mx || item.servidor_mx || '-')} ${formatarBadgePontos(pts.servidor_mx)}</div>
        </div>
      </div>

      <!-- Bloco 4: E-mails, Site & Dados Corporativos -->
      <div style="background: rgba(15, 23, 42, 0.35); padding: 1rem; border-radius: 8px; border: 1px solid var(--panel-border);">
        <h4 style="margin: 0 0 0.75rem 0; color: #eab308; font-size: 0.9rem;">4. E-mails & Site Corporativo</h4>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem; font-size: 0.85rem;">
          <div><strong style="color:var(--text-muted)">E-mail Corporativo:</strong> ${fmtSimNao(item.email_corporativo)} ${formatarBadgePontos(pts.email_corporativo)}</div>
          <div><strong style="color:var(--text-muted)">Mail Finan Diferente:</strong> ${fmtSimNao(item.existe_mail_financeiro)} ${formatarBadgePontos(pts.existe_mail_financeiro)}</div>
          <div><strong style="color:var(--text-muted)">E-mail Gratuito/Provedor:</strong> ${fmtSimNao(item.mail_gratuito)} ${formatarBadgePontos(pts.mail_gratuito)}</div>
          <div><strong style="color:var(--text-muted)">Possui Site Ativo:</strong> ${fmtSimNao(item.possui_site)} ${formatarBadgePontos(pts.possui_site)}</div>
        </div>
      </div>

      <!-- Bloco 5: Bureau, Serasa & Protestos (Expandido) -->
      <div style="background: rgba(15, 23, 42, 0.35); padding: 1rem; border-radius: 8px; border: 1px solid var(--panel-border);">
        <h4 style="margin: 0 0 0.75rem 0; color: #f43f5e; font-size: 0.9rem;">5. Serasa Experian & Apontamentos</h4>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem; font-size: 0.85rem;">
          <div><strong style="color:var(--text-muted)">Score Serasa:</strong> <strong>${escapeHtml(String(item.score_serasa ?? '-'))}</strong> ${item.probabilidade_inadimplencia ? `(PD ${escapeHtml(item.probabilidade_inadimplencia)})` : ''} ${formatarBadgePontos(pts.score_serasa)}</div>
          <div><strong style="color:var(--text-muted)">Possui Protestos:</strong> ${fmtSimNao(item.protestos)} ${formatarBadgePontos(pts.protestos)}</div>
          <div><strong style="color:var(--text-muted)">Valor Protestos:</strong> R$ ${Number(item.valor_protestos || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} ${item.protestos === 'S' ? (formatarBadgePontos(pts.vlr_protestos_vs_ped, 'vs Pedido') + ' ' + formatarBadgePontos(pts.protestos_vs_capital, 'vs Capital')) : ''}</div>
          <div><strong style="color:var(--text-muted)">PEFIN:</strong> ${fmtSimNao(item.pfin)} ${formatarBadgePontos(pts.pfin)}</div>
          <div><strong style="color:var(--text-muted)">REFIN (Bancos):</strong> ${fmtSimNao(item.refin)} ${formatarBadgePontos(pts.refin)}</div>
          <div><strong style="color:var(--text-muted)">Dívidas Vencidas:</strong> ${fmtSimNao(item.dividas_vencidas)} ${formatarBadgePontos(pts.dividas_vencidas)}</div>
          <div><strong style="color:var(--text-muted)">Cheques Sem Fundo:</strong> ${fmtSimNao(item.ch_sem_fundo)} ${formatarBadgePontos(pts.ch_sem_fundo)}</div>
          <div><strong style="color:var(--text-muted)">Sócios c/ Restrição:</strong> ${fmtSimNao(item.socios_anotacao)} ${formatarBadgePontos(pts.socios_anotacao)}</div>
          <div><strong style="color:var(--text-muted)">Densidade Consultas:</strong> ${item.consultas_densidade_dia ? `${item.consultas_densidade_dia}/dia` : '0/dia'} ${formatarBadgePontos(pts.densidade_consultas)}</div>
          <div><strong style="color:var(--text-muted)">Consultas Fomento:</strong> ${fmtSimNao(item.consultantes_fomento)} ${formatarBadgePontos(pts.consultantes_fomento)}</div>
          <div><strong style="color:var(--text-muted)">Doc. Extraviado:</strong> ${item.documentos_extraviados === 'S' ? '<span style="color:#f87171; font-weight:800;">Sim (ALERTA)</span>' : '<span style="color:#22c55e;">Não</span>'} ${formatarBadgePontos(pts.doc_extraviado)}</div>
        </div>
      </div>

      <!-- Bloco 6: FGTS, Sócios & Certidões Comerciais -->
      <div style="background: rgba(15, 23, 42, 0.35); padding: 1rem; border-radius: 8px; border: 1px solid var(--panel-border);">
        <h4 style="margin: 0 0 0.75rem 0; color: #10b981; font-size: 0.9rem;">6. FGTS, Sócios & Certidões Comerciais</h4>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem; font-size: 0.85rem;">
          <div><strong style="color:var(--text-muted)">FGTS Regular:</strong> ${item.fgts_situacao_regular === 'S' ? '<span style="color:#22c55e">Regular</span>' : (item.fgts_situacao_regular === 'N' ? '<span style="color:#f87171">Irregular</span>' : (item.fgts_situacao_regular === 'NE' ? '<span style="color:#fbbf24">Não Encontrado</span>' : '-'))} ${formatarBadgePontos(pts.fgts_regular !== undefined ? pts.fgts_regular : pts.fgts_situacao_regular)}</div>
          <div><strong style="color:var(--text-muted)">Razão = FGTS:</strong> ${item.razao_fgts_igual === 'S' ? '<span style="color:#22c55e">Igual</span>' : (item.razao_fgts_igual === 'N' ? '<span style="color:#f87171">Divergente</span>' : (item.razao_fgts_igual === 'NE' ? '<span style="color:#fbbf24">Não Encontrado</span>' : '-'))} ${formatarBadgePontos(pts.razao_fgts_igual)}</div>
          <div><strong style="color:var(--text-muted)">Troca Recente Sócios:</strong> ${item.alteracao_recente_socios === 'S' ? '<span style="color:#f87171">Sim</span>' : '<span style="color:#22c55e">Não</span>'} ${formatarBadgePontos(pts.alteracao_recente_socios)}</div>
          <div><strong style="color:var(--text-muted)">Aumento Expressivo Cap.:</strong> ${item.aumento_expressivo_capital === 'S' ? '<span style="color:#f87171">Sim</span>' : '<span style="color:#22c55e">Não</span>'} ${formatarBadgePontos(pts.aumento_expressivo_capital)}</div>
        </div>
      </div>

      <!-- Bloco 7: Extrato & Conferência Matemática da Pontuação -->
      <div style="background: rgba(15, 23, 42, 0.5); padding: 1.25rem; border-radius: 10px; border: 1px solid rgba(56, 189, 248, 0.3);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
          <h4 style="margin: 0; color: #38bdf8; font-size: 0.95rem; display: flex; align-items: center; gap: 8px;">
            <span>📊 Extrato & Conferência Matemática do Score</span>
          </h4>
          <span style="font-size: 0.78rem; color: #94a3b8; font-family: var(--font-mono);">Total: <strong>${item.total_score} pts</strong></span>
        </div>

        <p style="margin: 0 0 0.75rem 0; font-size: 0.8rem; color: var(--text-muted);">
          Abaixo estão discriminados todos os critérios ponderados no ato da gravação desta consulta. A soma dos ganhos e penalidades confere o Score Final obtido:
        </p>

        <div style="max-height: 280px; overflow-y: auto; border: 1px solid var(--panel-border); border-radius: 6px;">
          <table class="tabela-extrato-pontos">
            <thead>
              <tr>
                <th style="width: 25%;">Categoria</th>
                <th style="width: 40%;">Parâmetro / Critério</th>
                <th style="width: 20%;">Situação Observada</th>
                <th style="width: 15%; text-align: right;">Pontos</th>
              </tr>
            </thead>
            <tbody>
              ${extratoLinhas.map(linha => `
                <tr>
                  <td style="color: var(--text-muted); font-size: 0.76rem;">${escapeHtml(linha.cat)}</td>
                  <td style="font-weight: 600; color: var(--text-primary);">${escapeHtml(linha.nome)}</td>
                  <td style="color: #38bdf8; font-size: 0.78rem;">${escapeHtml(linha.val)}</td>
                  <td style="text-align: right;">${formatarBadgePontos(linha.pts)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <!-- Totais de Auditoria -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.75rem; background: rgba(15, 23, 42, 0.7); padding: 0.75rem 1rem; border-radius: 8px; border: 1px solid var(--panel-border); margin-top: 0.75rem;">
          <div>
            <div style="font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase;">Total Ganhos (+)</div>
            <div style="font-size: 1.1rem; font-weight: 800; color: #22c55e; font-family: var(--font-mono);">+${totalGanhos} pts</div>
          </div>
          <div>
            <div style="font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase;">Total Penalidades (-)</div>
            <div style="font-size: 1.1rem; font-weight: 800; color: #f87171; font-family: var(--font-mono);">${totalPerdas} pts</div>
          </div>
          <div>
            <div style="font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase;">Score Final Somado</div>
            <div style="font-size: 1.25rem; font-weight: 900; color: ${scoreColor}; font-family: var(--font-mono);">${somaFinalCalculada} pts</div>
          </div>
        </div>

        <div style="margin-top: 0.75rem; font-size: 0.8rem; color: #38bdf8; display: flex; align-items: center; gap: 6px; background: rgba(56, 189, 248, 0.1); padding: 6px 12px; border-radius: 6px; border: 1px solid rgba(56, 189, 248, 0.25);">
          <span>🔒 <strong>Snapshot Imutável:</strong> Esta pontuação foi gravada permanentemente no ato da consulta em ${dataStr}. Mesmo que os cálculos sejam rebalanceados no futuro para novas análises, o registro histórico deste pedido permanece inalterado.</span>
        </div>
      </div>

      <!-- Bloco 8: Observações do Analista -->
      <div style="background: rgba(15, 23, 42, 0.35); padding: 1rem; border-radius: 8px; border: 1px solid var(--panel-border);">
        <h4 style="margin: 0 0 0.75rem 0; color: #e2e8f0; font-size: 0.9rem;">8. Observações do Analista</h4>
        <div style="font-size: 0.88rem; color: var(--text-primary); font-style: italic;">
          ${escapeHtml(item.obs || 'Nenhuma observação interna cadastrada.')}
        </div>
      </div>
    `;

    modal.classList.remove('hidden');

    const fecharModal = () => modal.classList.add('hidden');
    if (btnClose) btnClose.onclick = fecharModal;
    if (btnFechar) btnFechar.onclick = fecharModal;
    if (btnImprimir) btnImprimir.onclick = () => window.print();

    if (btnCarregar) {
      btnCarregar.onclick = () => {
        fecharModal();
        const setVal = (id, val) => {
          const el = document.getElementById(id);
          if (el && val !== undefined && val !== null) el.value = val;
        };
        if (creditoEmpresaSelect) creditoEmpresaSelect.value = item.empresa || '14';
        
        // Preenche o campo de busca superior e o campo do formulário
        setVal('creditoNumPedido', item.pedido_venda);
        setVal('cr_pedido_venda', item.pedido_venda);
        setVal('cr_cod_web', item.cod_web || '');
        setVal('cr_cliente_codigo', item.cliente_codigo || '');
        setVal('cr_cliente_nome', item.cliente_nome || '');
        setVal('cr_total_pedido', Number(item.total_pedido || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
        setVal('cr_desconto_ped', item.desconto_ped || 'OK');
        setVal('cr_faturado', item.faturado || 'S');
        setVal('cr_entrada', item.entrada || 'N');
        setVal('cr_quant_grande', item.quant_grande || 'N');
        setVal('cr_prod_nao_combinam', item.prod_nao_combinam || 'N');
        setVal('cr_armario_cofre_gt_2000', item.armario_cofre_gt_2000 || 'N');
        setVal('cr_uf_cliente', item.uf_cliente || 'SP');
        setVal('cr_entrega_igual_cadastro', item.entrega_igual_cadastro !== undefined ? item.entrega_igual_cadastro : '');
        setVal('cr_cadastro_igual_receita', item.cadastro_igual_receita !== undefined ? item.cadastro_igual_receita : '');
        setVal('cr_casa_sala_conj_end', item.casa_sala_conj_end !== undefined ? item.casa_sala_conj_end : 'N');
        setVal('cr_registro_br', item.registro_br !== undefined ? item.registro_br : '');
        setVal('cr_cnpj_registro_br', item.cnpj_registro_br || '');
        setVal('cr_titular_registro_br', item.titular_registro_br || '');

        const regBrInfoEl = document.getElementById('cr_registro_br_info');
        if (regBrInfoEl) {
          if (item.cnpj_registro_br || item.registro_br_detalhes) {
            regBrInfoEl.style.display = 'block';
            if (item.registro_br === 'S') {
              regBrInfoEl.style.background = 'rgba(34, 197, 94, 0.12)';
              regBrInfoEl.style.border = '1px solid rgba(34, 197, 94, 0.3)';
              regBrInfoEl.style.color = '#22c55e';
              regBrInfoEl.innerHTML = `✓ <strong>Raiz Confere:</strong> ${escapeHtml(item.cnpj_registro_br || '')} ${item.titular_registro_br ? '(' + escapeHtml(item.titular_registro_br) + ')' : ''}`;
            } else {
              regBrInfoEl.style.background = 'rgba(239, 68, 68, 0.12)';
              regBrInfoEl.style.border = '1px solid rgba(239, 68, 68, 0.3)';
              regBrInfoEl.style.color = '#f87171';
              regBrInfoEl.innerHTML = `⚠️ <strong>Registro.Br:</strong> ${escapeHtml(item.cnpj_registro_br || 'Divergente / Não Identificado')} ${item.titular_registro_br ? '(' + escapeHtml(item.titular_registro_br) + ')' : ''}`;
            }
          } else {
            regBrInfoEl.style.display = 'none';
          }
        }
        
        // Maturidade Digital Automática (RDAP, Wayback, MX)
        const idadeDom = item.idade_dominio_rdap !== undefined ? item.idade_dominio_rdap : (item.idade_dominio !== undefined ? item.idade_dominio : null);
        if (idadeDom !== null && idadeDom !== undefined && idadeDom !== '') {
          setVal('cr_idade_dominio_rdap', `${idadeDom} anos`);
          setVal('cr_idade_dominio_val', idadeDom);
        } else {
          setVal('cr_idade_dominio_rdap', item.dominio_principal ? 'Domínio Recente / Não BR' : 'Sem Domínio');
          setVal('cr_idade_dominio_val', '');
        }

        const wb = item.wayback_primeiro_snapshot || item.wayback;
        if (wb) {
          setVal('cr_wayback_snapshot', `Histórico desde ${wb}`);
          setVal('cr_wayback_ano_val', wb);
        } else {
          setVal('cr_wayback_snapshot', 'Sem histórico no archive');
          setVal('cr_wayback_ano_val', '');
        }

        setVal('cr_servidor_mx', item.servidor_mx || 'Sem registro MX');
        setVal('cr_tipo_servidor_mx', item.tipo_servidor_mx || 'NENHUM');
        setVal('cr_dominio_principal', item.dominio_principal || '');

        setVal('cr_email_corporativo', item.email_corporativo !== undefined ? item.email_corporativo : 'N');
        setVal('cr_existe_mail_financeiro', item.existe_mail_financeiro !== undefined ? item.existe_mail_financeiro : 'N');
        setVal('cr_mail_gratuito', item.mail_gratuito !== undefined ? item.mail_gratuito : 'N');
        setVal('cr_possui_site', item.possui_site !== undefined ? item.possui_site : 'N');
        setVal('cr_fundacao_matriz', item.fundacao_matriz || '');
        
        const isSemCapLoad = item.sem_capital_social === 'S' || item.capital_social === null || item.capital_social === undefined;
        if (crSemCapitalSocial) crSemCapitalSocial.checked = isSemCapLoad;
        if (crCapitalSocialInput) {
          crCapitalSocialInput.disabled = isSemCapLoad;
          crCapitalSocialInput.placeholder = isSemCapLoad ? 'Não informado / Isento' : '0,00';
          crCapitalSocialInput.style.opacity = isSemCapLoad ? '0.7' : '1';
          crCapitalSocialInput.value = isSemCapLoad ? '' : Number(item.capital_social || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        
        // Dados do Serasa & Bureau
        setVal('cr_score_serasa', item.score_serasa !== undefined ? item.score_serasa : '');
        setVal('cr_probabilidade_inadimplencia', item.probabilidade_inadimplencia || '');
        setVal('cr_protestos', item.protestos !== undefined ? item.protestos : '');
        setVal('cr_valor_protestos', Number(item.valor_protestos || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
        setVal('cr_pfin', item.pfin !== undefined ? item.pfin : '');
        setVal('cr_refin', item.refin !== undefined ? item.refin : 'N');
        setVal('cr_dividas_vencidas', item.dividas_vencidas !== undefined ? item.dividas_vencidas : 'N');
        setVal('cr_ch_sem_fundo', item.ch_sem_fundo !== undefined ? item.ch_sem_fundo : '');
        setVal('cr_socios_anotacao', item.socios_anotacao !== undefined ? item.socios_anotacao : 'N');
        setVal('cr_consultas_densidade', item.consultas_densidade_dia ? `${item.consultas_densidade_dia}/dia` : '0/dia');
        setVal('cr_consultas_densidade_val', item.consultas_densidade_dia || 0);
        setVal('cr_consultantes_fomento', item.consultantes_fomento !== undefined ? item.consultantes_fomento : 'N');
        setVal('cr_documentos_extraviados', item.documentos_extraviados !== undefined ? item.documentos_extraviados : 'N');

        setVal('cr_cnpj_ativo', item.cnpj_ativo || 'S');
        setVal('cr_pgtos_abertos', item.pgtos_abertos !== undefined ? item.pgtos_abertos : 'N');
        setVal('cr_comprou_pagou', item.comprou_pagou !== undefined ? item.comprou_pagou : 'N');
        setVal('cr_comprou_pagou_5x', item.comprou_pagou_5x !== undefined ? item.comprou_pagou_5x : 'N');
        setVal('cr_fgts_situacao_regular', item.fgts_situacao_regular !== undefined ? item.fgts_situacao_regular : '');
        setVal('cr_razao_fgts_igual', item.razao_fgts_igual !== undefined ? item.razao_fgts_igual : '');
        setVal('cr_alteracao_recente_socios', item.alteracao_recente_socios !== undefined ? item.alteracao_recente_socios : 'N');
        setVal('cr_aumento_expressivo_capital', item.aumento_expressivo_capital !== undefined ? item.aumento_expressivo_capital : 'N');
        setVal('cr_obs', item.obs || '');
        setVal('cr_decisao_final', item.decisao_final || 'Decisão (atenção ao gravar)');

        if (creditoProtheusBadge) {
          creditoProtheusBadge.classList.remove('hidden');
          creditoProtheusBadge.style.background = 'rgba(56, 189, 248, 0.12)';
          creditoProtheusBadge.style.borderColor = 'rgba(56, 189, 248, 0.3)';
          creditoProtheusBadge.style.color = '#38bdf8';
          creditoProtheusBadge.innerHTML = `📋 Análise do Pedido <strong>#${escapeHtml(item.pedido_venda)}</strong> (${escapeHtml(item.cliente_nome || '')}) carregada no formulário com sucesso.`;
        }

        // Recalcula o Score em Tempo Real imediatamente após preencher todos os dados
        atualizarScoreEmTempoReal();

        window.scrollTo({ top: 0, behavior: 'smooth' });
      };
    }

    if (btnImprimir) {
      btnImprimir.onclick = () => {
        window.print();
      };
    }
  }

  if (buscaHistoricoCredito) {
    buscaHistoricoCredito.addEventListener('input', renderHistoricoCreditoTable);
  }

  if (filtroPeriodoHistoricoCredito) {
    filtroPeriodoHistoricoCredito.addEventListener('change', renderHistoricoCreditoTable);
  }

  // Função para atualizar dinamicamente os rótulos com pontos (+X pts / -Y pts) dos selects do formulário de análise de crédito
  function atualizarRotulosSelectsCredito(cfgParam) {
    const cfg = cfgParam || scoreConfigActive || {};
    const getCfg = (k, def) => (cfg[k] !== undefined && cfg[k] !== null && !isNaN(Number(cfg[k])) ? Number(cfg[k]) : def);

    const fmtPts = (num, unitSuffix = 'pts') => {
      const n = Number(num) || 0;
      const unit = (Math.abs(n) === 1 && unitSuffix === 'pts') ? 'pt' : unitSuffix;
      return n > 0 ? `+${n} ${unit}` : (n < 0 ? `${n} ${unit}` : `0 ${unit}`);
    };

    const setOptionText = (selectId, value, templateFn) => {
      const select = document.getElementById(selectId);
      if (!select) return;
      const opt = select.querySelector(`option[value="${value}"]`);
      if (opt) {
        opt.textContent = templateFn();
      }
    };

    // 1. Bloco 1: Limites & Cadastrais
    setOptionText('cr_cnpj_ativo', 'S', () => `Sim (${fmtPts(getCfg('peso_cnpj_ativo_sim', 2))})`);
    setOptionText('cr_cnpj_ativo', 'N', () => `Não (${fmtPts(getCfg('peso_cnpj_ativo_nao', -100))})`);

    setOptionText('cr_cadastro_igual_receita', 'S', () => `Sim (${fmtPts(getCfg('peso_cadastro_receita_sim', 3))})`);
    setOptionText('cr_cadastro_igual_receita', 'N', () => `Não (${fmtPts(getCfg('peso_cadastro_receita_nao', -3))})`);

    setOptionText('cr_casa_sala_conj_end', 'N', () => `Não / Prédio (${fmtPts(getCfg('peso_endereco_sala_nao', 1))})`);
    setOptionText('cr_casa_sala_conj_end', 'S', () => `Sim (${fmtPts(getCfg('peso_endereco_sala_sim', -5))})`);

    // 2. Bloco 2: Comercial & Pagamento
    setOptionText('cr_faturado', 'N', () => `Não (À Vista/Antecipado ${fmtPts(getCfg('peso_avista_geral', 100))})`);
    setOptionText('cr_faturado', 'S', () => `Sim (Faturado 0 pts)`);

    setOptionText('cr_entrada', 'S', () => `Sim (${fmtPts(getCfg('peso_entrada_sim', 12))})`);
    setOptionText('cr_entrada', 'N', () => `Não (${fmtPts(getCfg('peso_entrada_nao', -4))})`);

    setOptionText('cr_pgtos_abertos', 'N', () => `Não (${fmtPts(getCfg('peso_pgtos_abertos_nao', 1))})`);
    setOptionText('cr_pgtos_abertos', 'S', () => `Sim (${fmtPts(getCfg('peso_pgtos_abertos_sim', -3))})`);

    setOptionText('cr_comprou_pagou', 'S', () => `Sim (${fmtPts(getCfg('peso_comprou_pagou_sim', 9))})`);
    setOptionText('cr_comprou_pagou', 'N', () => `Não (${fmtPts(getCfg('peso_comprou_pagou_nao', -3))})`);

    setOptionText('cr_comprou_pagou_5x', 'N', () => `Não (0 pts)`);
    setOptionText('cr_comprou_pagou_5x', 'S', () => `Sim (${fmtPts(getCfg('peso_comprou_pagou_5x_sim', 23))})`);

    setOptionText('cr_quant_grande', 'N', () => `Não (${fmtPts(getCfg('peso_quant_grande_nao', 1))})`);
    setOptionText('cr_quant_grande', 'S', () => `Sim (${fmtPts(getCfg('peso_quant_grande_sim', -13))})`);

    setOptionText('cr_prod_nao_combinam', 'N', () => `Não (${fmtPts(getCfg('peso_prod_nao_combinam_nao', 2))})`);
    setOptionText('cr_prod_nao_combinam', 'S', () => `Sim (${fmtPts(getCfg('peso_prod_nao_combinam_sim', -5))})`);

    // 3. Bloco 3: Endereço & Localização
    setOptionText('cr_entrega_igual_cadastro', 'S', () => `Sim (${fmtPts(getCfg('peso_entrega_cadastro_sim', 2))})`);
    setOptionText('cr_entrega_igual_cadastro', 'N', () => `Não (${fmtPts(getCfg('peso_entrega_cadastro_nao', -9))})`);

    setOptionText('cr_registro_br', 'N', () => `Não (0 pts)`);
    setOptionText('cr_registro_br', 'S', () => `Sim (${fmtPts(getCfg('peso_registro_br_sim', 6))} se entrega dif)`);

    // 4. Bloco 4: E-mails & Site
    setOptionText('cr_email_corporativo', 'S', () => `Sim (${fmtPts(getCfg('peso_email_corp_sim', 3))})`);
    setOptionText('cr_email_corporativo', 'N', () => `Não (${fmtPts(getCfg('peso_email_corp_nao', -3))})`);

    setOptionText('cr_existe_mail_financeiro', 'S', () => `Sim (0 pts)`);
    setOptionText('cr_existe_mail_financeiro', 'N', () => `Não (${fmtPts(getCfg('peso_email_fin_diferente_nao', -7))})`);

    setOptionText('cr_mail_gratuito', 'N', () => `Não (${fmtPts(getCfg('peso_email_gratuito_nao', 2))})`);
    setOptionText('cr_mail_gratuito', 'S', () => `Sim (Gmail/UOL/Terra ${fmtPts(getCfg('peso_email_gratuito_sim', -8))})`);

    setOptionText('cr_possui_site', 'S', () => `Sim (${fmtPts(getCfg('peso_site_ativo_sim', 1))})`);
    setOptionText('cr_possui_site', 'N', () => `Não (${fmtPts(getCfg('peso_site_ativo_nao', -15))})`);

    // 5. Bloco 5: Bureau, Serasa & Protestos
    setOptionText('cr_protestos', 'N', () => `Não (${fmtPts(getCfg('peso_protestos_nao', 5))})`);
    setOptionText('cr_protestos', 'S', () => `Sim (${fmtPts(getCfg('peso_protestos_sim', -10))})`);

    setOptionText('cr_pfin', 'N', () => `Não (${fmtPts(getCfg('peso_pfin_nao', 1))})`);
    setOptionText('cr_pfin', 'S', () => `Sim (${fmtPts(getCfg('peso_pfin_sim', -5))})`);

    setOptionText('cr_refin', 'N', () => `Não (0 pts)`);
    setOptionText('cr_refin', 'S', () => `Sim (${fmtPts(getCfg('peso_refin_sim', -10))})`);

    setOptionText('cr_dividas_vencidas', 'N', () => `Não (0 pts)`);
    setOptionText('cr_dividas_vencidas', 'S', () => `Sim (${fmtPts(getCfg('peso_dividas_vencidas_sim', -4))})`);

    setOptionText('cr_ch_sem_fundo', 'N', () => `Não (0 pts)`);
    setOptionText('cr_ch_sem_fundo', 'S', () => `Sim (${fmtPts(getCfg('peso_ch_sem_fundo_sim', -6))})`);

    setOptionText('cr_socios_anotacao', 'N', () => `Não (0 pts)`);
    setOptionText('cr_socios_anotacao', 'S', () => `Sim (${fmtPts(getCfg('peso_socios_restricao_sim', -6))})`);

    setOptionText('cr_consultantes_fomento', 'N', () => `Não (0 pts)`);
    setOptionText('cr_consultantes_fomento', 'S', () => `Sim (${fmtPts(getCfg('peso_consultantes_fomento_sim', -5))})`);

    setOptionText('cr_documentos_extraviados', 'N', () => `Não (0 pts)`);
    setOptionText('cr_documentos_extraviados', 'S', () => `Sim (${fmtPts(getCfg('peso_doc_extraviado_sim', -25))} / Trava)`);

    // 6. Bloco 6: FGTS, Sócios & Certidões Comerciais
    setOptionText('cr_fgts_situacao_regular', 'S', () => `Regular (0 pts)`);
    setOptionText('cr_fgts_situacao_regular', 'N', () => `Irregular (${fmtPts(getCfg('peso_fgts_regular_nao', -6))})`);
    setOptionText('cr_fgts_situacao_regular', 'NE', () => `Não Encontrado (0 pts)`);

    setOptionText('cr_razao_fgts_igual', 'S', () => `Igual (${fmtPts(getCfg('peso_razao_fgts_igual_sim', 3))})`);
    setOptionText('cr_razao_fgts_igual', 'N', () => `Divergente (${fmtPts(getCfg('peso_razao_fgts_igual_nao', -15))})`);
    setOptionText('cr_razao_fgts_igual', 'NE', () => `Não Encontrado (${fmtPts(getCfg('peso_razao_fgts_nao_encontrado', -5))})`);

    setOptionText('cr_alteracao_recente_socios', 'N', () => `Não (0 pts)`);
    setOptionText('cr_alteracao_recente_socios', 'S', () => `Sim (${fmtPts(getCfg('peso_alteracao_recente_socios_sim', -8))})`);

    setOptionText('cr_aumento_expressivo_capital', 'N', () => `Não (0 pts)`);
    setOptionText('cr_aumento_expressivo_capital', 'S', () => `Sim (${fmtPts(getCfg('peso_aumento_expressivo_capital_sim', -20))})`);
  }

  // Carregar Configurações do Score
  async function carregarScoreConfigUI() {
    try {
      const res = await fetch('/api/financeiro/analise-credito/config');
      const data = await res.json();
      if (data.success && data.config) {
        scoreConfigActive = data.config;
        for (const [k, v] of Object.entries(data.config)) {
          const el = document.getElementById(`cfg_${k}`);
          if (el) el.value = v;
        }
        atualizarRotulosSelectsCredito(data.config);
      }
    } catch (e) {
      console.warn('Falha ao carregar score config', e);
    }
  }

  if (scoreConfigForm) {
    scoreConfigForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const cfg = {};
      const inputs = scoreConfigForm.querySelectorAll('input');
      inputs.forEach(inp => {
        const k = inp.id.replace('cfg_', '');
        if (k === 'infosimples_token') {
          cfg[k] = inp.value.trim();
        } else {
          cfg[k] = parseFloat(inp.value) || 0;
        }
      });

      try {
        const res = await fetch('/api/financeiro/analise-credito/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cfg)
        });
        const d = await res.json();
        if (d.success) {
          scoreConfigActive = d.config || cfg;
          atualizarRotulosSelectsCredito(scoreConfigActive);
          alert('Parâmetros do Score de Crédito salvos com sucesso!');
          if (typeof atualizarScoreEmTempoReal === 'function') {
            atualizarScoreEmTempoReal();
          }
        } else {
          alert('Erro ao salvar: ' + d.error);
        }
      } catch (err) {
        alert('Falha ao salvar configurações.');
      }
    });
  }

  if (btnSaveScoreConfig && scoreConfigForm) {
    btnSaveScoreConfig.addEventListener('click', (e) => {
      e.preventDefault();
      scoreConfigForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
  }

  if (btnResetScoreConfig) {
    btnResetScoreConfig.addEventListener('click', async (e) => {
      e.preventDefault();
      if (confirm('Deseja restaurar todos os parâmetros para os valores originais da planilha Score 2025?')) {
        try {
          const res = await fetch('/api/financeiro/analise-credito/config/reset', { method: 'POST' });
          const d = await res.json();
          if (d.success && d.config) {
            scoreConfigActive = d.config;
            for (const [k, v] of Object.entries(d.config)) {
              const el = document.getElementById(`cfg_${k}`);
              if (el) el.value = v;
            }
            atualizarRotulosSelectsCredito(scoreConfigActive);
            alert('Parâmetros restaurados com sucesso para os padrões oficiais da planilha!');
            if (typeof atualizarScoreEmTempoReal === 'function') {
              atualizarScoreEmTempoReal();
            }
          } else {
            alert('Erro ao restaurar: ' + (d.error || 'Falha desconhecida'));
          }
        } catch (err) {
          alert('Falha ao restaurar configurações padrão.');
        }
      }
    });
  }

  // =========================================================================
  // --- SUB-ABAS LOGÍSTICA: PEDIDOS PRA FATURAR & PEDIDOS BLOQ ESTOQUE ---
  // =========================================================================

  let pedidosFaturarCache = [];
  let pedidosFaturarSortField = 'dataLib';
  let pedidosFaturarSortDirection = 'desc';

  let pedidosBloqCache = [];
  let pedidosBloqSortField = 'dataLib';
  let pedidosBloqSortDirection = 'desc';

  const pedidosFaturarEmpresaFilter = document.getElementById('pedidosFaturarEmpresaFilter');
  const pedidosFaturarSearchInput = document.getElementById('pedidosFaturarSearchInput');
  const btnAtualizarPedidosFaturar = document.getElementById('btnAtualizarPedidosFaturar');
  const btnLimparFiltrosPedidosFaturar = document.getElementById('btnLimparFiltrosPedidosFaturar');
  const pedidosFaturarLoading = document.getElementById('pedidosFaturarLoading');
  const pedidosFaturarResults = document.getElementById('pedidosFaturarResults');
  const pedidosFaturarEmpty = document.getElementById('pedidosFaturarEmpty');
  const pedidosFaturarCount = document.getElementById('pedidosFaturarCount');
  const pedidosFaturarTableBody = document.getElementById('pedidosFaturarTableBody');
  const kpiPedidosFaturarCount = document.getElementById('kpiPedidosFaturarCount');
  const kpiPedidosFaturarQtd = document.getElementById('kpiPedidosFaturarQtd');
  const kpiPedidosFaturarTotal = document.getElementById('kpiPedidosFaturarTotal');

  const thSortFaturarCodWeb = document.getElementById('thSortFaturarCodWeb');
  const thSortFaturarPedVenda = document.getElementById('thSortFaturarPedVenda');
  const thSortFaturarDataLib = document.getElementById('thSortFaturarDataLib');
  const thSortFaturarValor = document.getElementById('thSortFaturarValor');
  const sortIconFaturarCodWeb = document.getElementById('sortIconFaturarCodWeb');
  const sortIconFaturarPedVenda = document.getElementById('sortIconFaturarPedVenda');
  const sortIconFaturarDataLib = document.getElementById('sortIconFaturarDataLib');
  const sortIconFaturarValor = document.getElementById('sortIconFaturarValor');

  const pedidosBloqEmpresaFilter = document.getElementById('pedidosBloqEmpresaFilter');
  const pedidosBloqSearchInput = document.getElementById('pedidosBloqSearchInput');
  const btnAtualizarPedidosBloq = document.getElementById('btnAtualizarPedidosBloq');
  const btnLimparFiltrosPedidosBloq = document.getElementById('btnLimparFiltrosPedidosBloq');
  const pedidosBloqLoading = document.getElementById('pedidosBloqLoading');
  const pedidosBloqResults = document.getElementById('pedidosBloqResults');
  const pedidosBloqEmpty = document.getElementById('pedidosBloqEmpty');
  const pedidosBloqCount = document.getElementById('pedidosBloqCount');
  const pedidosBloqTableBody = document.getElementById('pedidosBloqTableBody');
  const kpiPedidosBloqCount = document.getElementById('kpiPedidosBloqCount');
  const kpiPedidosBloqQtd = document.getElementById('kpiPedidosBloqQtd');
  const kpiPedidosBloqTotal = document.getElementById('kpiPedidosBloqTotal');

  const thSortBloqCodWeb = document.getElementById('thSortBloqCodWeb');
  const thSortBloqPedVenda = document.getElementById('thSortBloqPedVenda');
  const thSortBloqDataLib = document.getElementById('thSortBloqDataLib');
  const thSortBloqValor = document.getElementById('thSortBloqValor');
  const sortIconBloqCodWeb = document.getElementById('sortIconBloqCodWeb');
  const sortIconBloqPedVenda = document.getElementById('sortIconBloqPedVenda');
  const sortIconBloqDataLib = document.getElementById('sortIconBloqDataLib');
  const sortIconBloqValor = document.getElementById('sortIconBloqValor');

  function formatDataProtheusLocal(dt) {
    if (!dt || String(dt).trim().length !== 8) return dt ? String(dt).trim() : '-';
    const s = String(dt).trim();
    return `${s.slice(6,8)}/${s.slice(4,6)}/${s.slice(0,4)}`;
  }

  async function carregarPedidosFaturar(force = false) {
    if (pedidosFaturarCache.length > 0 && !force) {
      renderPedidosFaturarTable(pedidosFaturarCache);
      return;
    }

    if (pedidosFaturarLoading) pedidosFaturarLoading.classList.remove('hidden');
    if (pedidosFaturarResults) pedidosFaturarResults.classList.add('hidden');
    if (pedidosFaturarEmpty) pedidosFaturarEmpty.classList.add('hidden');
    if (btnAtualizarPedidosFaturar) {
      btnAtualizarPedidosFaturar.disabled = true;
      btnAtualizarPedidosFaturar.textContent = '⏳ Carregando...';
    }

    try {
      const response = await fetch('/api/logistica/pedidos-faturar');
      const data = await response.json();
      if (data.success && Array.isArray(data.data)) {
        pedidosFaturarCache = data.data;
        renderPedidosFaturarTable(pedidosFaturarCache);
      } else {
        alert(data.message || 'Erro ao consultar pedidos prontos para faturar.');
      }
    } catch (err) {
      console.error('Erro ao carregar pedidos para faturar:', err);
    } finally {
      if (pedidosFaturarLoading) pedidosFaturarLoading.classList.add('hidden');
      if (btnAtualizarPedidosFaturar) {
        btnAtualizarPedidosFaturar.disabled = false;
        btnAtualizarPedidosFaturar.textContent = '🔄 Atualizar';
      }
    }
  }

  function renderPedidosFaturarTable(items) {
    if (!pedidosFaturarTableBody) return;
    let list = Array.isArray(items) ? [...items] : [...pedidosFaturarCache];

    const selectedEmp = pedidosFaturarEmpresaFilter ? pedidosFaturarEmpresaFilter.value : '';
    if (selectedEmp) {
      list = list.filter(p => p.empresa === selectedEmp || p.empresaKey === selectedEmp);
    }

    const searchTerm = pedidosFaturarSearchInput ? pedidosFaturarSearchInput.value.trim().toLowerCase() : '';
    if (searchTerm) {
      list = list.filter(p => 
        (p.numPed && p.numPed.toLowerCase().includes(searchTerm)) ||
        (p.codWeb && p.codWeb.toLowerCase().includes(searchTerm)) ||
        (p.clienteNome && p.clienteNome.toLowerCase().includes(searchTerm)) ||
        (p.clienteCod && p.clienteCod.toLowerCase().includes(searchTerm)) ||
        (p.nomeTransp && p.nomeTransp.toLowerCase().includes(searchTerm)) ||
        (p.vendedorNome && p.vendedorNome.toLowerCase().includes(searchTerm))
      );
    }

    // Calcular KPIs
    let totalPecas = 0;
    let totalValor = 0;
    for (const p of list) {
      totalPecas += (p.totalQtd || 0);
      totalValor += (p.totalGeral || p.totalValor || 0);
    }

    if (kpiPedidosFaturarCount) kpiPedidosFaturarCount.textContent = list.length;
    if (kpiPedidosFaturarQtd) kpiPedidosFaturarQtd.textContent = totalPecas.toLocaleString('pt-BR');
    if (kpiPedidosFaturarTotal) kpiPedidosFaturarTotal.textContent = formatCurrency(totalValor);
    if (pedidosFaturarCount) pedidosFaturarCount.textContent = list.length;

    if (list.length === 0) {
      if (pedidosFaturarResults) pedidosFaturarResults.classList.add('hidden');
      if (pedidosFaturarEmpty) pedidosFaturarEmpty.classList.remove('hidden');
      pedidosFaturarTableBody.innerHTML = '';
      return;
    }

    if (pedidosFaturarEmpty) pedidosFaturarEmpty.classList.add('hidden');
    if (pedidosFaturarResults) pedidosFaturarResults.classList.remove('hidden');

    // Ordenação
    list.sort((a, b) => {
      let valA = a[pedidosFaturarSortField] || '';
      let valB = b[pedidosFaturarSortField] || '';

      if (pedidosFaturarSortField === 'codWeb' || pedidosFaturarSortField === 'numPed') {
        const numA = parseInt(String(valA).replace(/\D/g, ''), 10);
        const numB = parseInt(String(valB).replace(/\D/g, ''), 10);
        if (!isNaN(numA) && !isNaN(numB)) {
          return pedidosFaturarSortDirection === 'asc' ? numA - numB : numB - numA;
        }
      }

      if (pedidosFaturarSortField === 'totalGeral' || pedidosFaturarSortField === 'totalValor') {
        const numA = parseFloat(valA || 0);
        const numB = parseFloat(valB || 0);
        return pedidosFaturarSortDirection === 'asc' ? numA - numB : numB - numA;
      }

      const cmp = String(valA).localeCompare(String(valB));
      return pedidosFaturarSortDirection === 'asc' ? cmp : -cmp;
    });

    pedidosFaturarTableBody.innerHTML = list.map(p => {
      let empresaBadge = `<span class="empresa-badge empresa-mp">MP</span>`;
      if (p.empresa === 'GSI') empresaBadge = `<span class="empresa-badge empresa-gsi">GSI</span>`;
      if (p.empresa === 'OACO') empresaBadge = `<span class="empresa-badge empresa-oaco">OACO</span>`;

      const codWebCell = typeof formatPipedriveDealLink === 'function' 
        ? formatPipedriveDealLink(p.codWeb)
        : (p.codWeb && p.codWeb !== '-' ? `<a href="https://benetroncomercial.pipedrive.com/deal/${String(p.codWeb).replace(/\D/g, '')}" target="_blank" rel="noopener noreferrer" class="link-codweb-pipedrive" style="display: inline-flex; align-items: center; gap: 4px; color: #38bdf8; text-decoration: none; font-weight: 600; padding: 2px 6px; border-radius: 4px; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.2);"><span style="font-size: 0.8rem;">🔗</span> ${escapeHtml(p.codWeb)}</a>` : '<span style="color: var(--text-muted);">-</span>');

      const pedVendaCell = `
        <button class="btn-link-pedvenda btn-pedvenda-faturar" data-empresa="${escapeHtml(p.empresaKey || p.empresa)}" data-pedido="${escapeHtml(p.numPed)}" title="Clique para abrir os detalhes completos">
          📋 ${escapeHtml(p.numPed)}
        </button>
      `;

      return `
        <tr>
          <td>${empresaBadge}</td>
          <td>${codWebCell}</td>
          <td>${pedVendaCell}</td>
          <td>
            <div style="font-weight: 600;">${escapeHtml(p.clienteNome)}</div>
            <small style="color: var(--text-muted); font-size: 0.75rem;">Cód: ${escapeHtml(p.clienteCod || '-')}</small>
          </td>
          <td>${escapeHtml(p.dataLibFmt || formatDataProtheusLocal(p.dataLib))}</td>
          <td>${escapeHtml(p.dataPrevisaoFmt || formatDataProtheusLocal(p.dataPrevisao))}</td>
          <td>
            <div style="font-size: 0.85rem; font-weight: 500;">${escapeHtml(p.nomeTransp)}</div>
            <span class="badge" style="font-size: 0.7rem; padding: 1px 4px; background: rgba(59,130,246,0.1); color: #60a5fa;">${escapeHtml(p.tpFrete || '-')}</span>
          </td>
          <td style="text-align: center; font-weight: 700;">${p.totalQtd || 1}</td>
          <td style="text-align: right; font-weight: 700; color: #10b981;">${formatCurrency(p.totalGeral || p.totalValor)}</td>
        </tr>
      `;
    }).join('');

    pedidosFaturarTableBody.querySelectorAll('.btn-pedvenda-faturar').forEach(btn => {
      btn.addEventListener('click', () => {
        const emp = btn.getAttribute('data-empresa');
        const ped = btn.getAttribute('data-pedido');
        if (typeof abrirDetalhesPedidoModal === 'function') {
          abrirDetalhesPedidoModal(emp, ped);
        }
      });
    });
  }

  function updatePedidosFaturarSortIcons() {
    if (sortIconFaturarCodWeb) sortIconFaturarCodWeb.textContent = pedidosFaturarSortField === 'codWeb' ? (pedidosFaturarSortDirection === 'asc' ? '▲' : '▼') : '↕';
    if (sortIconFaturarPedVenda) sortIconFaturarPedVenda.textContent = pedidosFaturarSortField === 'numPed' ? (pedidosFaturarSortDirection === 'asc' ? '▲' : '▼') : '↕';
    if (sortIconFaturarDataLib) sortIconFaturarDataLib.textContent = pedidosFaturarSortField === 'dataLib' ? (pedidosFaturarSortDirection === 'asc' ? '▲' : '▼') : '↕';
    if (sortIconFaturarValor) sortIconFaturarValor.textContent = (pedidosFaturarSortField === 'totalGeral' || pedidosFaturarSortField === 'totalValor') ? (pedidosFaturarSortDirection === 'asc' ? '▲' : '▼') : '↕';
  }

  if (pedidosFaturarEmpresaFilter) {
    pedidosFaturarEmpresaFilter.addEventListener('change', () => renderPedidosFaturarTable());
  }
  if (pedidosFaturarSearchInput) {
    pedidosFaturarSearchInput.addEventListener('input', () => renderPedidosFaturarTable());
  }
  if (btnAtualizarPedidosFaturar) {
    btnAtualizarPedidosFaturar.addEventListener('click', () => carregarPedidosFaturar(true));
  }
  if (btnLimparFiltrosPedidosFaturar) {
    btnLimparFiltrosPedidosFaturar.addEventListener('click', () => {
      if (pedidosFaturarEmpresaFilter) pedidosFaturarEmpresaFilter.value = '';
      if (pedidosFaturarSearchInput) pedidosFaturarSearchInput.value = '';
      renderPedidosFaturarTable();
    });
  }
  if (thSortFaturarCodWeb) {
    thSortFaturarCodWeb.addEventListener('click', () => {
      if (pedidosFaturarSortField === 'codWeb') pedidosFaturarSortDirection = pedidosFaturarSortDirection === 'asc' ? 'desc' : 'asc';
      else { pedidosFaturarSortField = 'codWeb'; pedidosFaturarSortDirection = 'asc'; }
      updatePedidosFaturarSortIcons();
      renderPedidosFaturarTable();
    });
  }
  if (thSortFaturarPedVenda) {
    thSortFaturarPedVenda.addEventListener('click', () => {
      if (pedidosFaturarSortField === 'numPed') pedidosFaturarSortDirection = pedidosFaturarSortDirection === 'asc' ? 'desc' : 'asc';
      else { pedidosFaturarSortField = 'numPed'; pedidosFaturarSortDirection = 'asc'; }
      updatePedidosFaturarSortIcons();
      renderPedidosFaturarTable();
    });
  }
  if (thSortFaturarDataLib) {
    thSortFaturarDataLib.addEventListener('click', () => {
      if (pedidosFaturarSortField === 'dataLib') pedidosFaturarSortDirection = pedidosFaturarSortDirection === 'asc' ? 'desc' : 'asc';
      else { pedidosFaturarSortField = 'dataLib'; pedidosFaturarSortDirection = 'desc'; }
      updatePedidosFaturarSortIcons();
      renderPedidosFaturarTable();
    });
  }
  if (thSortFaturarValor) {
    thSortFaturarValor.addEventListener('click', () => {
      if (pedidosFaturarSortField === 'totalGeral') pedidosFaturarSortDirection = pedidosFaturarSortDirection === 'asc' ? 'desc' : 'asc';
      else { pedidosFaturarSortField = 'totalGeral'; pedidosFaturarSortDirection = 'desc'; }
      updatePedidosFaturarSortIcons();
      renderPedidosFaturarTable();
    });
  }

  // --- SUB-ABA: PEDIDOS BLOQUEADOS POR ESTOQUE ---
  async function carregarPedidosBloqEstoque(force = false) {
    if (pedidosBloqCache.length > 0 && !force) {
      renderPedidosBloqEstoqueTable(pedidosBloqCache);
      return;
    }

    if (pedidosBloqLoading) pedidosBloqLoading.classList.remove('hidden');
    if (pedidosBloqResults) pedidosBloqResults.classList.add('hidden');
    if (pedidosBloqEmpty) pedidosBloqEmpty.classList.add('hidden');
    if (btnAtualizarPedidosBloq) {
      btnAtualizarPedidosBloq.disabled = true;
      btnAtualizarPedidosBloq.textContent = '⏳ Carregando...';
    }

    try {
      const response = await fetch('/api/logistica/pedidos-bloq-estoque');
      const data = await response.json();
      if (data.success && Array.isArray(data.data)) {
        pedidosBloqCache = data.data;
        renderPedidosBloqEstoqueTable(pedidosBloqCache);
      } else {
        alert(data.message || 'Erro ao consultar pedidos bloqueados por estoque.');
      }
    } catch (err) {
      console.error('Erro ao carregar pedidos bloqueados por estoque:', err);
    } finally {
      if (pedidosBloqLoading) pedidosBloqLoading.classList.add('hidden');
      if (btnAtualizarPedidosBloq) {
        btnAtualizarPedidosBloq.disabled = false;
        btnAtualizarPedidosBloq.textContent = '🔄 Atualizar';
      }
    }
  }

  function renderPedidosBloqEstoqueTable(items) {
    if (!pedidosBloqTableBody) return;
    let list = Array.isArray(items) ? [...items] : [...pedidosBloqCache];

    const selectedEmp = pedidosBloqEmpresaFilter ? pedidosBloqEmpresaFilter.value : '';
    if (selectedEmp) {
      list = list.filter(p => p.empresa === selectedEmp || p.empresaKey === selectedEmp);
    }

    const searchTerm = pedidosBloqSearchInput ? pedidosBloqSearchInput.value.trim().toLowerCase() : '';
    if (searchTerm) {
      list = list.filter(p => 
        (p.numPed && p.numPed.toLowerCase().includes(searchTerm)) ||
        (p.codWeb && p.codWeb.toLowerCase().includes(searchTerm)) ||
        (p.clienteNome && p.clienteNome.toLowerCase().includes(searchTerm)) ||
        (p.clienteCod && p.clienteCod.toLowerCase().includes(searchTerm)) ||
        (p.nomeTransp && p.nomeTransp.toLowerCase().includes(searchTerm)) ||
        (p.vendedorNome && p.vendedorNome.toLowerCase().includes(searchTerm))
      );
    }

    // Calcular KPIs
    let totalPecas = 0;
    let totalValor = 0;
    for (const p of list) {
      totalPecas += (p.totalQtd || 0);
      totalValor += (p.totalGeral || p.totalValor || 0);
    }

    if (kpiPedidosBloqCount) kpiPedidosBloqCount.textContent = list.length;
    if (kpiPedidosBloqQtd) kpiPedidosBloqQtd.textContent = totalPecas.toLocaleString('pt-BR');
    if (kpiPedidosBloqTotal) kpiPedidosBloqTotal.textContent = formatCurrency(totalValor);
    if (pedidosBloqCount) pedidosBloqCount.textContent = list.length;

    if (list.length === 0) {
      if (pedidosBloqResults) pedidosBloqResults.classList.add('hidden');
      if (pedidosBloqEmpty) pedidosBloqEmpty.classList.remove('hidden');
      pedidosBloqTableBody.innerHTML = '';
      return;
    }

    if (pedidosBloqEmpty) pedidosBloqEmpty.classList.add('hidden');
    if (pedidosBloqResults) pedidosBloqResults.classList.remove('hidden');

    // Ordenação
    list.sort((a, b) => {
      let valA = a[pedidosBloqSortField] || '';
      let valB = b[pedidosBloqSortField] || '';

      if (pedidosBloqSortField === 'codWeb' || pedidosBloqSortField === 'numPed') {
        const numA = parseInt(String(valA).replace(/\D/g, ''), 10);
        const numB = parseInt(String(valB).replace(/\D/g, ''), 10);
        if (!isNaN(numA) && !isNaN(numB)) {
          return pedidosBloqSortDirection === 'asc' ? numA - numB : numB - numA;
        }
      }

      if (pedidosBloqSortField === 'totalGeral' || pedidosBloqSortField === 'totalValor') {
        const numA = parseFloat(valA || 0);
        const numB = parseFloat(valB || 0);
        return pedidosBloqSortDirection === 'asc' ? numA - numB : numB - numA;
      }

      const cmp = String(valA).localeCompare(String(valB));
      return pedidosBloqSortDirection === 'asc' ? cmp : -cmp;
    });

    pedidosBloqTableBody.innerHTML = list.map(p => {
      let empresaBadge = `<span class="empresa-badge empresa-mp">MP</span>`;
      if (p.empresa === 'GSI') empresaBadge = `<span class="empresa-badge empresa-gsi">GSI</span>`;
      if (p.empresa === 'OACO') empresaBadge = `<span class="empresa-badge empresa-oaco">OACO</span>`;

      const codWebCell = typeof formatPipedriveDealLink === 'function' 
        ? formatPipedriveDealLink(p.codWeb)
        : (p.codWeb && p.codWeb !== '-' ? `<a href="https://benetroncomercial.pipedrive.com/deal/${String(p.codWeb).replace(/\D/g, '')}" target="_blank" rel="noopener noreferrer" class="link-codweb-pipedrive" style="display: inline-flex; align-items: center; gap: 4px; color: #38bdf8; text-decoration: none; font-weight: 600; padding: 2px 6px; border-radius: 4px; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.2);"><span style="font-size: 0.8rem;">🔗</span> ${escapeHtml(p.codWeb)}</a>` : '<span style="color: var(--text-muted);">-</span>');

      const pedVendaCell = `
        <button class="btn-link-pedvenda btn-pedvenda-bloq" data-empresa="${escapeHtml(p.empresaKey || p.empresa)}" data-pedido="${escapeHtml(p.numPed)}" title="Clique para abrir os detalhes completos">
          📋 ${escapeHtml(p.numPed)}
        </button>
      `;

      const statusBloqBadge = p.codBlCred === '01'
        ? `<span class="status-badge erro" style="background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.3); font-weight: 600; padding: 2px 6px;">🔴 Estoque + Crédito</span>`
        : `<span class="status-badge erro" style="background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.3); font-weight: 600; padding: 2px 6px;">🔴 Bloq. Estoque (02)</span>`;

      return `
        <tr>
          <td>${empresaBadge}</td>
          <td>${codWebCell}</td>
          <td>${pedVendaCell}</td>
          <td>
            <div style="font-weight: 600;">${escapeHtml(p.clienteNome)}</div>
            <small style="color: var(--text-muted); font-size: 0.75rem;">Cód: ${escapeHtml(p.clienteCod || '-')}</small>
          </td>
          <td>${statusBloqBadge}</td>
          <td>${escapeHtml(p.dataLibFmt || formatDataProtheusLocal(p.dataLib))}</td>
          <td>${escapeHtml(p.dataPrevisaoFmt || formatDataProtheusLocal(p.dataPrevisao))}</td>
          <td>
            <div style="font-size: 0.85rem; font-weight: 500;">${escapeHtml(p.nomeTransp)}</div>
            <span class="badge" style="font-size: 0.7rem; padding: 1px 4px; background: rgba(59,130,246,0.1); color: #60a5fa;">${escapeHtml(p.tpFrete || '-')}</span>
          </td>
          <td style="text-align: center; font-weight: 700;">${p.totalQtd || 1}</td>
          <td style="text-align: right; font-weight: 700; color: #ef4444;">${formatCurrency(p.totalGeral || p.totalValor)}</td>
        </tr>
      `;
    }).join('');

    pedidosBloqTableBody.querySelectorAll('.btn-pedvenda-bloq').forEach(btn => {
      btn.addEventListener('click', () => {
        const emp = btn.getAttribute('data-empresa');
        const ped = btn.getAttribute('data-pedido');
        if (typeof abrirDetalhesPedidoModal === 'function') {
          abrirDetalhesPedidoModal(emp, ped);
        }
      });
    });
  }

  function updatePedidosBloqSortIcons() {
    if (sortIconBloqCodWeb) sortIconBloqCodWeb.textContent = pedidosBloqSortField === 'codWeb' ? (pedidosBloqSortDirection === 'asc' ? '▲' : '▼') : '↕';
    if (sortIconBloqPedVenda) sortIconBloqPedVenda.textContent = pedidosBloqSortField === 'numPed' ? (pedidosBloqSortDirection === 'asc' ? '▲' : '▼') : '↕';
    if (sortIconBloqDataLib) sortIconBloqDataLib.textContent = pedidosBloqSortField === 'dataLib' ? (pedidosBloqSortDirection === 'asc' ? '▲' : '▼') : '↕';
    if (sortIconBloqValor) sortIconBloqValor.textContent = (pedidosBloqSortField === 'totalGeral' || pedidosBloqSortField === 'totalValor') ? (pedidosBloqSortDirection === 'asc' ? '▲' : '▼') : '↕';
  }

  if (pedidosBloqEmpresaFilter) {
    pedidosBloqEmpresaFilter.addEventListener('change', () => renderPedidosBloqEstoqueTable());
  }
  if (pedidosBloqSearchInput) {
    pedidosBloqSearchInput.addEventListener('input', () => renderPedidosBloqEstoqueTable());
  }
  if (btnAtualizarPedidosBloq) {
    btnAtualizarPedidosBloq.addEventListener('click', () => carregarPedidosBloqEstoque(true));
  }
  if (btnLimparFiltrosPedidosBloq) {
    btnLimparFiltrosPedidosBloq.addEventListener('click', () => {
      if (pedidosBloqEmpresaFilter) pedidosBloqEmpresaFilter.value = '';
      if (pedidosBloqSearchInput) pedidosBloqSearchInput.value = '';
      renderPedidosBloqEstoqueTable();
    });
  }
  if (thSortBloqCodWeb) {
    thSortBloqCodWeb.addEventListener('click', () => {
      if (pedidosBloqSortField === 'codWeb') pedidosBloqSortDirection = pedidosBloqSortDirection === 'asc' ? 'desc' : 'asc';
      else { pedidosBloqSortField = 'codWeb'; pedidosBloqSortDirection = 'asc'; }
      updatePedidosBloqSortIcons();
      renderPedidosBloqEstoqueTable();
    });
  }
  if (thSortBloqPedVenda) {
    thSortBloqPedVenda.addEventListener('click', () => {
      if (pedidosBloqSortField === 'numPed') pedidosBloqSortDirection = pedidosBloqSortDirection === 'asc' ? 'desc' : 'asc';
      else { pedidosBloqSortField = 'numPed'; pedidosBloqSortDirection = 'asc'; }
      updatePedidosBloqSortIcons();
      renderPedidosBloqEstoqueTable();
    });
  }
  if (thSortBloqDataLib) {
    thSortBloqDataLib.addEventListener('click', () => {
      if (pedidosBloqSortField === 'dataLib') pedidosBloqSortDirection = pedidosBloqSortDirection === 'asc' ? 'desc' : 'asc';
      else { pedidosBloqSortField = 'dataLib'; pedidosBloqSortDirection = 'desc'; }
      updatePedidosBloqSortIcons();
      renderPedidosBloqEstoqueTable();
    });
  }
  if (thSortBloqValor) {
    thSortBloqValor.addEventListener('click', () => {
      if (pedidosBloqSortField === 'totalGeral') pedidosBloqSortDirection = pedidosBloqSortDirection === 'asc' ? 'desc' : 'asc';
      else { pedidosBloqSortField = 'totalGeral'; pedidosBloqSortDirection = 'desc'; }
      updatePedidosBloqSortIcons();
      renderPedidosBloqEstoqueTable();
    });
  }

  // =========================================================================
  // --- SUB-ABA LOGÍSTICA: FILA & ANÁLISE DE LIBERAÇÃO DE ESTOQUE (MATA455) ---
  // =========================================================================

  let pedidosLibCache = [];
  let pedidosLibSortField = 'statusLib';
  let pedidosLibSortDirection = 'asc';

  const pedidosLibEmpresaFilter = document.getElementById('pedidosLibEmpresaFilter');
  const pedidosLibStatusFilter = document.getElementById('pedidosLibStatusFilter');
  const pedidosLibSearchInput = document.getElementById('pedidosLibSearchInput');
  const btnAtualizarPedidosLib = document.getElementById('btnAtualizarPedidosLib');
  const btnLimparFiltrosPedidosLib = document.getElementById('btnLimparFiltrosPedidosLib');
  const pedidosLibLoading = document.getElementById('pedidosLibLoading');
  const pedidosLibResults = document.getElementById('pedidosLibResults');
  const pedidosLibEmpty = document.getElementById('pedidosLibEmpty');
  const pedidosLibCount = document.getElementById('pedidosLibCount');
  const pedidosLibTableBody = document.getElementById('pedidosLibTableBody');

  const kpiLibProntosCount = document.getElementById('kpiLibProntosCount');
  const kpiLibProntosTotal = document.getElementById('kpiLibProntosTotal');
  const kpiLibParcialCount = document.getElementById('kpiLibParcialCount');
  const kpiLibParcialTotal = document.getElementById('kpiLibParcialTotal');
  const kpiLibAguardandoCount = document.getElementById('kpiLibAguardandoCount');
  const kpiLibAguardandoTotal = document.getElementById('kpiLibAguardandoTotal');
  const kpiLibTotalCount = document.getElementById('kpiLibTotalCount');
  const kpiLibTotalValor = document.getElementById('kpiLibTotalValor');

  const thSortLibCodWeb = document.getElementById('thSortLibCodWeb');
  const thSortLibPedVenda = document.getElementById('thSortLibPedVenda');
  const thSortLibStatus = document.getElementById('thSortLibStatus');
  const thSortLibDataLib = document.getElementById('thSortLibDataLib');
  const thSortLibValor = document.getElementById('thSortLibValor');
  const sortIconLibCodWeb = document.getElementById('sortIconLibCodWeb');
  const sortIconLibPedVenda = document.getElementById('sortIconLibPedVenda');
  const sortIconLibStatus = document.getElementById('sortIconLibStatus');
  const sortIconLibDataLib = document.getElementById('sortIconLibDataLib');
  const sortIconLibValor = document.getElementById('sortIconLibValor');

  // Modal de Detalhes da Fila FIFO
  const modalLibEstoqueItens = document.getElementById('modalLibEstoqueItens');
  const btnCloseModalLibEstoque = document.getElementById('btnCloseModalLibEstoque');
  const btnFecharModalLibEstoque = document.getElementById('btnFecharModalLibEstoque');
  const modalLibEstoqueNumPed = document.getElementById('modalLibEstoqueNumPed');
  const modalLibEstoqueEmpresaBadge = document.getElementById('modalLibEstoqueEmpresaBadge');
  const modalLibEstoqueCliente = document.getElementById('modalLibEstoqueCliente');
  const modalLibEstoqueCodWeb = document.getElementById('modalLibEstoqueCodWeb');
  const modalLibEstoqueVendedor = document.getElementById('modalLibEstoqueVendedor');
  const modalLibEstoqueDataLib = document.getElementById('modalLibEstoqueDataLib');
  const modalLibEstoqueStatusBadge = document.getElementById('modalLibEstoqueStatusBadge');
  const modalLibEstoqueRotina = document.getElementById('modalLibEstoqueRotina');
  const tbodyModalLibEstoqueItens = document.getElementById('tbodyModalLibEstoqueItens');

  async function carregarPedidosLibEstoque(force = false) {
    if (pedidosLibCache.length > 0 && !force) {
      renderPedidosLibEstoqueTable();
      return;
    }

    if (pedidosLibLoading) pedidosLibLoading.classList.remove('hidden');
    if (pedidosLibResults) pedidosLibResults.classList.add('hidden');
    if (pedidosLibEmpty) pedidosLibEmpty.classList.add('hidden');
    if (btnAtualizarPedidosLib) {
      btnAtualizarPedidosLib.disabled = true;
      btnAtualizarPedidosLib.textContent = '⏳ Analisando...';
    }

    try {
      const response = await fetch('/api/logistica/pedidos-lib-estoque');
      const data = await response.json();
      if (data.success && Array.isArray(data.data)) {
        pedidosLibCache = data.data;
        renderPedidosLibEstoqueTable();
      } else {
        alert(data.message || 'Erro ao consultar fila de liberação de estoque.');
      }
    } catch (err) {
      console.error('Erro ao carregar pedidos para liberação de estoque:', err);
    } finally {
      if (pedidosLibLoading) pedidosLibLoading.classList.add('hidden');
      if (btnAtualizarPedidosLib) {
        btnAtualizarPedidosLib.disabled = false;
        btnAtualizarPedidosLib.textContent = '🔄 Atualizar';
      }
    }
  }

  function renderPedidosLibEstoqueTable() {
    if (!pedidosLibTableBody) return;
    let list = [...pedidosLibCache];

    const selectedEmp = pedidosLibEmpresaFilter ? pedidosLibEmpresaFilter.value : '';
    if (selectedEmp) {
      list = list.filter(p => p.empresa === selectedEmp || p.empresaKey === selectedEmp);
    }

    const selectedStatus = pedidosLibStatusFilter ? pedidosLibStatusFilter.value : '';
    if (selectedStatus) {
      list = list.filter(p => p.statusLib === selectedStatus);
    }

    const searchTerm = pedidosLibSearchInput ? pedidosLibSearchInput.value.trim().toLowerCase() : '';
    if (searchTerm) {
      list = list.filter(p => 
        (p.numPed && p.numPed.toLowerCase().includes(searchTerm)) ||
        (p.codWeb && p.codWeb.toLowerCase().includes(searchTerm)) ||
        (p.clienteNome && p.clienteNome.toLowerCase().includes(searchTerm)) ||
        (p.clienteCod && p.clienteCod.toLowerCase().includes(searchTerm)) ||
        (p.nomeTransp && p.nomeTransp.toLowerCase().includes(searchTerm)) ||
        (p.vendedorNome && p.vendedorNome.toLowerCase().includes(searchTerm)) ||
        (Array.isArray(p.itens) && p.itens.some(i => (i.produto && i.produto.toLowerCase().includes(searchTerm)) || (i.descricao && i.descricao.toLowerCase().includes(searchTerm))))
      );
    }

    // Calcular KPIs dos 4 cards
    let countProntos = 0, valorProntos = 0;
    let countParcial = 0, valorParcial = 0;
    let countAguardando = 0, valorAguardando = 0;
    let totalGeralValor = 0;

    for (const p of list) {
      const v = p.totalGeral || p.totalValor || 0;
      totalGeralValor += v;
      if (p.statusLib === 'PRONTO') {
        countProntos++;
        valorProntos += v;
      } else if (p.statusLib === 'PARCIAL') {
        countParcial++;
        valorParcial += v;
      } else {
        countAguardando++;
        valorAguardando += v;
      }
    }

    if (kpiLibProntosCount) kpiLibProntosCount.textContent = countProntos;
    if (kpiLibProntosTotal) kpiLibProntosTotal.textContent = `${formatCurrency(valorProntos)} (100% Saldo)`;
    if (kpiLibParcialCount) kpiLibParcialCount.textContent = countParcial;
    if (kpiLibParcialTotal) kpiLibParcialTotal.textContent = `${formatCurrency(valorParcial)} (Itens Parciais)`;
    if (kpiLibAguardandoCount) kpiLibAguardandoCount.textContent = countAguardando;
    if (kpiLibAguardandoTotal) kpiLibAguardandoTotal.textContent = `${formatCurrency(valorAguardando)} (Sem Saldo)`;
    if (kpiLibTotalCount) kpiLibTotalCount.textContent = list.length;
    if (kpiLibTotalValor) kpiLibTotalValor.textContent = formatCurrency(totalGeralValor);
    if (pedidosLibCount) pedidosLibCount.textContent = list.length;

    if (list.length === 0) {
      if (pedidosLibResults) pedidosLibResults.classList.add('hidden');
      if (pedidosLibEmpty) pedidosLibEmpty.classList.remove('hidden');
      pedidosLibTableBody.innerHTML = '';
      return;
    }

    if (pedidosLibEmpty) pedidosLibEmpty.classList.add('hidden');
    if (pedidosLibResults) pedidosLibResults.classList.remove('hidden');

    // Ordenação
    const orderWeight = { 'PRONTO': 1, 'PARCIAL': 2, 'AGUARDANDO': 3 };
    list.sort((a, b) => {
      if (pedidosLibSortField === 'statusLib') {
        const wA = orderWeight[a.statusLib] || 99;
        const wB = orderWeight[b.statusLib] || 99;
        if (wA !== wB) return pedidosLibSortDirection === 'asc' ? wA - wB : wB - wA;
        return (a.dataLib || a.dataEmissao || '').localeCompare(b.dataLib || b.dataEmissao || '');
      }

      let valA = a[pedidosLibSortField] || '';
      let valB = b[pedidosLibSortField] || '';

      if (pedidosLibSortField === 'codWeb' || pedidosLibSortField === 'numPed') {
        const numA = parseInt(String(valA).replace(/\D/g, ''), 10);
        const numB = parseInt(String(valB).replace(/\D/g, ''), 10);
        if (!isNaN(numA) && !isNaN(numB)) {
          return pedidosLibSortDirection === 'asc' ? numA - numB : numB - numA;
        }
      }

      if (pedidosLibSortField === 'totalGeral' || pedidosLibSortField === 'totalValor') {
        const numA = parseFloat(valA || 0);
        const numB = parseFloat(valB || 0);
        return pedidosLibSortDirection === 'asc' ? numA - numB : numB - numA;
      }

      const cmp = String(valA).localeCompare(String(valB));
      return pedidosLibSortDirection === 'asc' ? cmp : -cmp;
    });

    pedidosLibTableBody.innerHTML = list.map(p => {
      let empresaBadge = `<span class="empresa-badge empresa-mp">MP</span>`;
      if (p.empresa === 'GSI') empresaBadge = `<span class="empresa-badge empresa-gsi">GSI</span>`;
      if (p.empresa === 'OACO') empresaBadge = `<span class="empresa-badge empresa-oaco">OACO</span>`;

      const codWebCell = typeof formatPipedriveDealLink === 'function' 
        ? formatPipedriveDealLink(p.codWeb)
        : (p.codWeb && p.codWeb !== '-' ? `<a href="https://benetroncomercial.pipedrive.com/deal/${String(p.codWeb).replace(/\D/g, '')}" target="_blank" rel="noopener noreferrer" class="link-codweb-pipedrive" style="display: inline-flex; align-items: center; gap: 4px; color: #38bdf8; text-decoration: none; font-weight: 600; padding: 2px 6px; border-radius: 4px; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.2);"><span style="font-size: 0.8rem;">🔗</span> ${escapeHtml(p.codWeb)}</a>` : '<span style="color: var(--text-muted);">-</span>');

      const pedVendaCell = `
        <button class="btn-pedvenda-lib" data-empresa="${escapeHtml(p.empresaKey || p.empresa)}" data-pedido="${escapeHtml(p.numPed)}" title="Clique para auditar a fila FIFO e alocação de itens">
          📋 ${escapeHtml(p.numPed)}
        </button>
      `;

      let statusBadge = `<span class="badge-lib-aguardando">🔴 Aguardando Estoque</span>`;
      if (p.statusLib === 'PRONTO') {
        statusBadge = `<span class="badge-lib-pronto">🟢 Ped. Pronto pra Ser Liberado</span>`;
      } else if (p.statusLib === 'PARCIAL') {
        statusBadge = `<span class="badge-lib-parcial">🟡 Lib Parcial</span>`;
      }

      const rotinaBadge = p.codBlCred === '01'
        ? `<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #f87171; font-size: 0.75rem; font-weight: 600;" title="Possui trava de crédito e estoque">MATA456</span>`
        : `<span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; font-size: 0.75rem; font-weight: 600;" title="Liberação de estoque pura">MATA455</span>`;

      return `
        <tr>
          <td>${empresaBadge}</td>
          <td>${codWebCell}</td>
          <td>${pedVendaCell}</td>
          <td>
            <div style="font-weight: 600;">${escapeHtml(p.clienteNome)}</div>
            <small style="color: var(--text-muted); font-size: 0.75rem;">Cód: ${escapeHtml(p.clienteCod || '-')}</small>
          </td>
          <td>${statusBadge}</td>
          <td>
            <div style="font-weight: 600;">${escapeHtml(p.dataLibFmt || formatDataProtheusLocal(p.dataLib))}</div>
            <small style="color: var(--text-muted); font-size: 0.7rem;">Prioridade FIFO</small>
          </td>
          <td>${escapeHtml(p.dataPrevisaoFmt || formatDataProtheusLocal(p.dataPrevisao))}</td>
          <td>
            <div style="font-size: 0.85rem; font-weight: 500;">${escapeHtml(p.nomeTransp)}</div>
            <span class="badge" style="font-size: 0.7rem; padding: 1px 4px; background: rgba(59,130,246,0.1); color: #60a5fa;">${escapeHtml(p.tpFrete || '-')}</span>
          </td>
          <td style="text-align: center; font-weight: 700;">${p.totalQtd || 1}</td>
          <td style="text-align: right; font-weight: 700; color: ${p.statusLib === 'PRONTO' ? '#10b981' : (p.statusLib === 'PARCIAL' ? '#f59e0b' : '#ef4444')};">
            ${formatCurrency(p.totalGeral || p.totalValor)}
          </td>
          <td style="text-align: center;">${rotinaBadge}</td>
        </tr>
      `;
    }).join('');

    pedidosLibTableBody.querySelectorAll('.btn-pedvenda-lib').forEach(btn => {
      btn.addEventListener('click', () => {
        const emp = btn.getAttribute('data-empresa');
        const ped = btn.getAttribute('data-pedido');
        abrirModalLibEstoqueDetalhes(emp, ped);
      });
    });
  }

  function abrirModalLibEstoqueDetalhes(empresa, numPed) {
    if (!modalLibEstoqueItens) return;
    const ped = pedidosLibCache.find(p => (p.empresa === empresa || p.empresaKey === empresa) && p.numPed === numPed);
    if (!ped) return;

    if (modalLibEstoqueNumPed) modalLibEstoqueNumPed.textContent = ped.numPed;
    if (modalLibEstoqueEmpresaBadge) {
      modalLibEstoqueEmpresaBadge.innerHTML = `<span class="empresa-badge empresa-${ped.empresa.toLowerCase()}">${ped.empresa}</span>`;
    }
    if (modalLibEstoqueCliente) modalLibEstoqueCliente.textContent = `${ped.clienteNome} (${ped.clienteCod || '-'})`;
    if (modalLibEstoqueCodWeb) {
      modalLibEstoqueCodWeb.innerHTML = typeof formatPipedriveDealLink === 'function'
        ? formatPipedriveDealLink(ped.codWeb)
        : (ped.codWeb && ped.codWeb !== '-' ? `<a href="https://benetroncomercial.pipedrive.com/deal/${String(ped.codWeb).replace(/\D/g, '')}" target="_blank" rel="noopener noreferrer" class="link-codweb-pipedrive">🔗 ${escapeHtml(ped.codWeb)}</a>` : '-');
    }
    if (modalLibEstoqueVendedor) modalLibEstoqueVendedor.textContent = ped.vendedorNome || '-';
    if (modalLibEstoqueDataLib) modalLibEstoqueDataLib.textContent = ped.dataLibFmt || formatDataProtheusLocal(ped.dataLib);
    if (modalLibEstoqueStatusBadge) {
      if (ped.statusLib === 'PRONTO') {
        modalLibEstoqueStatusBadge.innerHTML = `<span class="badge-lib-pronto">🟢 Ped. Pronto pra Ser Liberado</span>`;
      } else if (ped.statusLib === 'PARCIAL') {
        modalLibEstoqueStatusBadge.innerHTML = `<span class="badge-lib-parcial">🟡 Lib Parcial</span>`;
      } else {
        modalLibEstoqueStatusBadge.innerHTML = `<span class="badge-lib-aguardando">🔴 Aguardando Estoque</span>`;
      }
    }
    if (modalLibEstoqueRotina) modalLibEstoqueRotina.textContent = ped.rotinaProtheus || 'MATA455';

    if (tbodyModalLibEstoqueItens && Array.isArray(ped.itens)) {
      tbodyModalLibEstoqueItens.innerHTML = ped.itens.map(it => {
        let itemBadge = `<span class="badge-lib-aguardando">🔴 Sem Saldo</span>`;
        if (it.statusItem === 'TOTAL') {
          itemBadge = `<span class="badge-lib-pronto">🟢 Saldo Suficiente</span>`;
        } else if (it.statusItem === 'PARCIAL') {
          itemBadge = `<span class="badge-lib-parcial">🟡 Parcial (${it.qtdAlocada}/${it.qtdLib})</span>`;
        }

        return `
          <tr>
            <td style="text-align: center; font-weight: 600;">${escapeHtml(it.item || '01')}</td>
            <td style="font-family: monospace; font-size: 0.85rem; font-weight: 600; color: #38bdf8;">${escapeHtml(it.produto)}</td>
            <td>
              <div style="font-weight: 600; font-size: 0.9rem;">${escapeHtml(it.descricao)}</div>
              <small style="color: var(--text-muted);">Preço Unit: ${formatCurrency(it.prcVenda)}</small>
            </td>
            <td style="text-align: center; font-weight: 700;">${it.qtdLib}</td>
            <td style="text-align: center; font-weight: 600; color: #38bdf8;">${it.saldoFisicoTotal || 0}</td>
            <td style="text-align: center; font-weight: 700; color: ${it.qtdAlocada > 0 ? '#10b981' : 'var(--text-muted)'};">${it.qtdAlocada}</td>
            <td style="text-align: center; font-weight: 600; color: ${it.saldoFaltante > 0 ? '#ef4444' : '#10b981'};">${it.saldoFaltante}</td>
            <td style="text-align: center;">
              <span class="badge" style="background: rgba(59,130,246,0.15); color: #60a5fa; font-weight: 700;">#${it.posicaoFila || 1}</span>
            </td>
            <td>${itemBadge}</td>
          </tr>
        `;
      }).join('');
    }

    modalLibEstoqueItens.classList.remove('hidden');
  }

  function updatePedidosLibSortIcons() {
    if (sortIconLibCodWeb) sortIconLibCodWeb.textContent = pedidosLibSortField === 'codWeb' ? (pedidosLibSortDirection === 'asc' ? '▲' : '▼') : '↕';
    if (sortIconLibPedVenda) sortIconLibPedVenda.textContent = pedidosLibSortField === 'numPed' ? (pedidosLibSortDirection === 'asc' ? '▲' : '▼') : '↕';
    if (sortIconLibStatus) sortIconLibStatus.textContent = pedidosLibSortField === 'statusLib' ? (pedidosLibSortDirection === 'asc' ? '▲' : '▼') : '↕';
    if (sortIconLibDataLib) sortIconLibDataLib.textContent = pedidosLibSortField === 'dataLib' ? (pedidosLibSortDirection === 'asc' ? '▲' : '▼') : '↕';
    if (sortIconLibValor) sortIconLibValor.textContent = (pedidosLibSortField === 'totalGeral' || pedidosLibSortField === 'totalValor') ? (pedidosLibSortDirection === 'asc' ? '▲' : '▼') : '↕';
  }

  if (pedidosLibEmpresaFilter) {
    pedidosLibEmpresaFilter.addEventListener('change', () => renderPedidosLibEstoqueTable());
  }
  if (pedidosLibStatusFilter) {
    pedidosLibStatusFilter.addEventListener('change', () => renderPedidosLibEstoqueTable());
  }
  if (pedidosLibSearchInput) {
    pedidosLibSearchInput.addEventListener('input', () => renderPedidosLibEstoqueTable());
  }
  if (btnAtualizarPedidosLib) {
    btnAtualizarPedidosLib.addEventListener('click', () => carregarPedidosLibEstoque(true));
  }
  if (btnLimparFiltrosPedidosLib) {
    btnLimparFiltrosPedidosLib.addEventListener('click', () => {
      if (pedidosLibEmpresaFilter) pedidosLibEmpresaFilter.value = '';
      if (pedidosLibStatusFilter) pedidosLibStatusFilter.value = '';
      if (pedidosLibSearchInput) pedidosLibSearchInput.value = '';
      renderPedidosLibEstoqueTable();
    });
  }

  if (thSortLibCodWeb) {
    thSortLibCodWeb.addEventListener('click', () => {
      if (pedidosLibSortField === 'codWeb') pedidosLibSortDirection = pedidosLibSortDirection === 'asc' ? 'desc' : 'asc';
      else { pedidosLibSortField = 'codWeb'; pedidosLibSortDirection = 'asc'; }
      updatePedidosLibSortIcons();
      renderPedidosLibEstoqueTable();
    });
  }
  if (thSortLibPedVenda) {
    thSortLibPedVenda.addEventListener('click', () => {
      if (pedidosLibSortField === 'numPed') pedidosLibSortDirection = pedidosLibSortDirection === 'asc' ? 'desc' : 'asc';
      else { pedidosLibSortField = 'numPed'; pedidosLibSortDirection = 'asc'; }
      updatePedidosLibSortIcons();
      renderPedidosLibEstoqueTable();
    });
  }
  if (thSortLibStatus) {
    thSortLibStatus.addEventListener('click', () => {
      if (pedidosLibSortField === 'statusLib') pedidosLibSortDirection = pedidosLibSortDirection === 'asc' ? 'desc' : 'asc';
      else { pedidosLibSortField = 'statusLib'; pedidosLibSortDirection = 'asc'; }
      updatePedidosLibSortIcons();
      renderPedidosLibEstoqueTable();
    });
  }
  if (thSortLibDataLib) {
    thSortLibDataLib.addEventListener('click', () => {
      if (pedidosLibSortField === 'dataLib') pedidosLibSortDirection = pedidosLibSortDirection === 'asc' ? 'desc' : 'asc';
      else { pedidosLibSortField = 'dataLib'; pedidosLibSortDirection = 'asc'; }
      updatePedidosLibSortIcons();
      renderPedidosLibEstoqueTable();
    });
  }
  if (thSortLibValor) {
    thSortLibValor.addEventListener('click', () => {
      if (pedidosLibSortField === 'totalGeral') pedidosLibSortDirection = pedidosLibSortDirection === 'asc' ? 'desc' : 'asc';
      else { pedidosLibSortField = 'totalGeral'; pedidosLibSortDirection = 'desc'; }
      updatePedidosLibSortIcons();
      renderPedidosLibEstoqueTable();
    });
  }

  if (btnCloseModalLibEstoque) {
    btnCloseModalLibEstoque.addEventListener('click', () => modalLibEstoqueItens.classList.add('hidden'));
  }
  if (btnFecharModalLibEstoque) {
    btnFecharModalLibEstoque.addEventListener('click', () => modalLibEstoqueItens.classList.add('hidden'));
  }
  if (modalLibEstoqueItens) {
    modalLibEstoqueItens.addEventListener('click', (e) => {
      if (e.target === modalLibEstoqueItens) modalLibEstoqueItens.classList.add('hidden');
    });
  }

  // Garantir isolamento estrito de abas no startup (mantém visível a aba inicial tab-minhas-tarefas)
  tabPanes.forEach(pane => {
    if (pane.id !== 'tab-minhas-tarefas') {
      pane.classList.add('hidden');
    } else {
      pane.classList.remove('hidden');
    }
  });

  // Se o usuário estiver autenticado, ativa a central de tarefas
  if (currentUser && typeof switchMainTab === 'function') {
    switchMainTab('tarefas');
  }

  carregarHistoricoCredito();
  carregarScoreConfigUI();
  atualizarRotulosSelectsCredito();

  if (btnOpenInterConfig) btnOpenInterConfig.addEventListener('click', abrirModalInterConfig);
  if (btnCloseInterConfigModal) btnCloseInterConfigModal.addEventListener('click', () => interConfigModal.classList.add('hidden'));
  if (btnConfirmInterConfigModal) btnConfirmInterConfigModal.addEventListener('click', () => interConfigModal.classList.add('hidden'));
});

