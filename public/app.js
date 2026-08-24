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

  function showAuthenticatedUser(user, token) {
    currentUser = user;
    if (token) currentToken = token;
    if (loginOverlay) {
      loginOverlay.classList.add('hidden');
      loginOverlay.style.display = 'none';
    }
    if (userInfo) userInfo.textContent = user.name || user.username;

    // Apply Tab Permissions safely
    try {
      applyUserPermissions(user);
    } catch (err) {
      console.warn('Aviso ao aplicar permissões do usuário:', err);
    }
  }

  function applyUserPermissions(user) {
    const mainTabLogistica = document.getElementById('mainTabLogistica');
    const mainTabConsulta = document.getElementById('mainTabConsulta');
    const mainTabVendedores = document.getElementById('mainTabVendedores');
    const mainTabFinanceiro = document.getElementById('mainTabFinanceiro');
    const mainTabConfig = document.getElementById('mainTabConfig');
    
    // Garante que o usuário Alexandre ou Administrador tenha permissão total mesmo com sessão antiga no localStorage
    let perms = (user && Array.isArray(user.permissions)) ? user.permissions : null;
    if (!perms || (user && user.username && user.username.toLowerCase() === 'alexandre') || (user && user.role === 'admin')) {
      perms = ['logistica', 'consulta', 'vendedores', 'financeiro', 'configuracoes'];
    }

    if (mainTabLogistica) mainTabLogistica.style.display = perms.includes('logistica') ? '' : 'none';
    if (mainTabConsulta) mainTabConsulta.style.display = perms.includes('consulta') ? '' : 'none';
    if (mainTabVendedores) mainTabVendedores.style.display = perms.includes('vendedores') ? '' : 'none';
    if (mainTabFinanceiro) mainTabFinanceiro.style.display = perms.includes('financeiro') ? '' : 'none';
    if (mainTabConfig) mainTabConfig.style.display = perms.includes('configuracoes') ? '' : 'none';

    // Ajusta o escopo de vendedor logado (Juliana, Andrea, Figueiredo)
    try {
      ajustarEscopoVendedor(user);
    } catch {}

    // Se o usuário não tem nenhuma permissão atribuída
    if (perms.length === 0) {
      mainTabBtns.forEach(b => b.classList.remove('active'));
      if (subGroupLogistica) subGroupLogistica.classList.add('hidden');
      if (subGroupConsulta) subGroupConsulta.classList.add('hidden');
      if (subGroupVendedores) subGroupVendedores.classList.add('hidden');
      if (subGroupFinanceiro) subGroupFinanceiro.classList.add('hidden');
      if (subGroupConfiguracoes) subGroupConfiguracoes.classList.add('hidden');
      tabPanes.forEach(pane => pane.classList.add('hidden'));
      return;
    }

    // Se o usuário atual estiver em uma aba que não tem permissão, redireciona para a primeira permitida
    const activeMainBtn = document.querySelector('.main-tab-btn.active');
    if (activeMainBtn) {
      const activeMain = activeMainBtn.getAttribute('data-main-tab');
      if (!perms.includes(activeMain)) {
        const firstPerm = perms[0];
        if (firstPerm && typeof switchMainTab === 'function') switchMainTab(firstPerm);
      }
    } else if (perms.length > 0) {
      if (typeof switchMainTab === 'function') switchMainTab(perms[0]);
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
  const mainTabBtns = document.querySelectorAll('.main-tab-btn');
  const subGroupLogistica = document.getElementById('subGroupLogistica');
  const subGroupConsulta = document.getElementById('subGroupConsulta');
  const subGroupVendedores = document.getElementById('subGroupVendedores');
  const subGroupFinanceiro = document.getElementById('subGroupFinanceiro');
  const subGroupConfiguracoes = document.getElementById('subGroupConfiguracoes');

  function switchMainTab(targetMain) {
    mainTabBtns.forEach(b => b.classList.remove('active'));
    
    // Hide all sub groups
    if (subGroupLogistica) subGroupLogistica.classList.add('hidden');
    if (subGroupConsulta) subGroupConsulta.classList.add('hidden');
    if (subGroupVendedores) subGroupVendedores.classList.add('hidden');
    if (subGroupFinanceiro) subGroupFinanceiro.classList.add('hidden');
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
    } else if (targetMain === 'vendedores') {
      if (subGroupVendedores) subGroupVendedores.classList.remove('hidden');
      firstSubBtn = subGroupVendedores ? subGroupVendedores.querySelector('.nav-tab-btn') : null;
      initComissaoDates();
    } else if (targetMain === 'financeiro') {
      if (subGroupFinanceiro) subGroupFinanceiro.classList.remove('hidden');
      firstSubBtn = subGroupFinanceiro ? subGroupFinanceiro.querySelector('.nav-tab-btn') : null;
      initConciliacaoBancaria();
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

      if (targetTab === 'tab-config-logs') {
        loadAuditDashboard();
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
    sumCnpj.innerHTML = `Pagador: <strong>${empNome}</strong> <span class="ped-venda-badge" style="margin-left: 8px;">Protheus Empresa ${empCod} (${currentFatura.empresaKey || 'OACO'})</span>`;
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
  const permLogistica = document.getElementById('permLogistica');
  const permConsulta = document.getElementById('permConsulta');
  const permVendedores = document.getElementById('permVendedores');
  const permFinanceiro = document.getElementById('permFinanceiro');
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
        perms.includes('financeiro') ? '<span class="perm-badge perm-badge-financeiro">💰 Assist. Financ.</span>' : '',
        perms.includes('configuracoes') ? '<span class="perm-badge perm-badge-configuracoes">⚙️ Configurações</span>' : ''
      ].filter(Boolean).join(' ');

      const isMainAdmin = u.username.toLowerCase() === 'alexandre';

      let roleLabel = 'Operador';
      if (u.role === 'admin') roleLabel = 'Administrador';
      if (u.role === 'vendedor') roleLabel = 'Vendedor';

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
    if (editEmail) editEmail.value = '';
    if (editPassword) editPassword.value = '';
    if (editRole) editRole.value = 'user';
    if (permLogistica) permLogistica.checked = true;
    if (permConsulta) permConsulta.checked = true;
    if (permVendedores) permVendedores.checked = true;
    if (permFinanceiro) permFinanceiro.checked = false;
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

    const perms = userObj.permissions || ['logistica', 'consulta'];
    if (permLogistica) permLogistica.checked = perms.includes('logistica');
    if (permConsulta) permConsulta.checked = perms.includes('consulta');
    if (permVendedores) permVendedores.checked = perms.includes('vendedores');
    if (permFinanceiro) permFinanceiro.checked = perms.includes('financeiro');
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
      if (permVendedores && permVendedores.checked) selectedPerms.push('vendedores');
      if (permFinanceiro && permFinanceiro.checked) selectedPerms.push('financeiro');
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
    const diffSec = Math.floor((now - date) / 1000);
    
    const formattedDate = date.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    if (diffSec < 60) return `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981;">Online agora</span> <small style="color: var(--text-muted); margin-left: 4px;">(${formattedDate})</small>`;
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
                ? `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);">Vendedor (${u.vendorCode || 'S/C'})</span>`
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
                <td><strong style="color: var(--text-primary); font-family: monospace;">${u.username}</strong></td>
                <td>${u.name}</td>
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
                <td style="color: var(--text-muted); font-size: 0.85rem; font-family: monospace; white-space: nowrap;">${dateStr}</td>
                <td>
                  <div style="font-weight: 600; color: var(--text-primary); font-size: 0.9rem;">${act.userName || act.username}</div>
                  <small style="color: var(--text-muted); font-family: monospace;">@${act.username}</small>
                </td>
                <td>${getActionBadge(act.actionType)}</td>
                <td style="color: var(--text-secondary); font-size: 0.9rem;">${act.description}</td>
              </tr>
            `;
          }).join('');
        }
      } else {
        auditUsersTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 1.5rem;">Erro ao carregar dados: ${data.message || 'Desconhecido'}</td></tr>`;
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
    if (!comisVendorSelect) return;

    if (user && user.role === 'vendedor' && VENDEDOR_USERS[user.username.toLowerCase()]) {
      const vendCode = VENDEDOR_USERS[user.username.toLowerCase()];
      comisVendorSelect.value = vendCode;
      comisVendorSelect.disabled = true;
      if (comisVendorSelectGroup) {
        const label = comisVendorSelectGroup.querySelector('label');
        if (label) label.textContent = `👤 Vendedor: ${user.name || user.username} (Fixo)`;
      }
    } else {
      comisVendorSelect.disabled = false;
      if (comisVendorSelectGroup) {
        const label = comisVendorSelectGroup.querySelector('label');
        if (label) label.textContent = '👤 Vendedor';
      }
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

    vendPedidosTableBody.querySelectorAll('.link-pedido, .link-codweb, .btn-ver-detalhe').forEach(el => {
      el.addEventListener('click', () => {
        const emp = el.getAttribute('data-empresa') || 'OACO';
        const ped = el.getAttribute('data-ped');
        if (ped) abrirDetalhesPedidoModal(emp, ped);
      });
    });
  }

  async function abrirDetalhesPedidoModal(empresaKey, numPedido) {
    if (!pedidoDetalhesModal || !pedidoDetalhesBody) return;

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

    pedidoDetalhesBody.innerHTML = `
      <!-- Cabeçalho Rápido do Pedido -->
      <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(30, 41, 59, 0.6); padding: 0.85rem 1.25rem; border-radius: 10px; border: 1px solid var(--panel-border); flex-wrap: wrap; gap: 0.5rem;">
        <div style="display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;">
          <span class="company-badge" style="font-size: 0.9rem; padding: 4px 10px;">${escapeHtml(det.empresa)}</span>
          <span style="font-size: 1.15rem; font-weight: 700; color: #f8fafc;">Pedido Nº ${escapeHtml(det.numPedido)}</span>
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
      <div style="background: rgba(15, 23, 42, 0.5); border: 1px solid var(--panel-border); border-radius: 10px; padding: 14px 16px;">
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
      <div style="background: rgba(15, 23, 42, 0.5); border: 1px solid var(--panel-border); border-radius: 10px; padding: 14px 16px; margin-top: 1rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; flex-wrap: wrap; gap: 0.5rem;">
          <h4 style="margin: 0; font-size: 0.9rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em;">
            💳 Faturas & Títulos a Receber (SE1 - Protheus)
          </h4>
          ${faturas.length > 0 ? `<span style="font-size: 0.8rem; color: #38bdf8; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.2); padding: 2px 8px; border-radius: 4px;">${faturas.length} ${faturas.length === 1 ? 'título / parcela' : 'títulos / parcelas'}</span>` : ''}
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
            <span>Frete (Cobrado + Embutido):</span>
            <span>${formatCurrency(tot.totalFrete)}</span>
          </div>
          ${tot.totalDesconto > 0 ? `
          <div style="display: flex; justify-content: space-between; font-size: 0.9rem; color: var(--accent-rose);">
            <span>Descontos:</span>
            <span>- ${formatCurrency(tot.totalDesconto)}</span>
          </div>` : ''}
          <div style="display: flex; justify-content: space-between; font-size: 1.15rem; font-weight: 700; color: #10b981; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 6px; margin-top: 4px;">
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
    if (comisTotalCount) comisTotalCount.textContent = resData.totalRegistros || list.length;

    if (comissoesSummaryCards) comissoesSummaryCards.classList.remove('hidden');
    if (comissoesEmptyState) comissoesEmptyState.classList.add('hidden');
    if (comissoesResults) comissoesResults.classList.remove('hidden');

    if (!comissoesTableBody) return;
    comissoesTableBody.innerHTML = '';

    if (list.length === 0) {
      comissoesTableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">Nenhum lançamento de comissão encontrado para o período e vendedor selecionados.</td></tr>`;
      return;
    }

    const formatEmissao = (em) => {
      if (!em || em.length !== 8) return em || '-';
      return `${em.slice(6,8)}/${em.slice(4,6)}/${em.slice(0,4)}`;
    };

    list.forEach(item => {
      const tr = document.createElement('tr');
      const empSigla = item.empresaSigla || (item.empresaKey === 'METAL_PLENO' ? 'MP' : (item.empresaKey === 'GSI' ? 'GSI' : 'OACO'));

      tr.innerHTML = `
        <td><strong>${escapeHtml(item.nomeVendedor || item.codVend || '-')}</strong></td>
        <td style="text-align: center;"><span class="company-badge" style="font-weight: 700; padding: 2px 8px; font-size: 0.78rem;">${escapeHtml(empSigla)}</span></td>
        <td>${formatEmissao(item.emissao)}</td>
        <td><code>${escapeHtml(item.pedido)}</code></td>
        <td>${escapeHtml(item.cliente)}</td>
        <td style="text-align: right; font-weight: 500;">${formatCurrency(item.valorBase)}</td>
        <td style="text-align: right; font-weight: 700; color: #10b981;">${formatCurrency(item.valorComis)}</td>
      `;
      comissoesTableBody.appendChild(tr);
    });
  }

  if (btnBuscarComissoes) btnBuscarComissoes.addEventListener('click', consultarComissoesAction);

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
  const btnSaveScoreConfig = document.getElementById('btnSaveScoreConfig');
  const btnResetScoreConfig = document.getElementById('btnResetScoreConfig');
  const scoreConfigForm = document.getElementById('scoreConfigForm');

  let listaHistoricoCredito = [];

  // Iniciar Consulta Protheus
  if (btnIniciarConsultaCredito) {
    btnIniciarConsultaCredito.addEventListener('click', async () => {
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
          throw new Error(data.error || 'Erro ao consultar pedido no Protheus.');
        }

        const setVal = (id, val) => {
          const el = document.getElementById(id);
          if (el && val !== undefined && val !== null) el.value = val;
        };

        setVal('cr_pedido_venda', data.pedido_venda);
        setVal('cr_cod_web', data.cod_web || '');
        setVal('cr_cliente_codigo', data.cliente_codigo || '');
        setVal('cr_cliente_nome', data.cliente_nome || '');
        setVal('cr_total_pedido', data.total_pedido || 0);
        setVal('cr_desconto_ped', data.desconto_ped || 'OK');
        setVal('cr_faturado', data.faturado || 'S');
        setVal('cr_entrada', data.entrada || 'N');
        setVal('cr_quant_grande', data.quant_grande || 'N');
        setVal('cr_prod_nao_combinam', data.prod_nao_combinam || 'N');
        setVal('cr_armario_cofre_gt_2000', data.armario_cofre_gt_2000 || 'N');
        setVal('cr_uf_cliente', data.uf_cliente || 'SP');
        setVal('cr_entrega_igual_cadastro', data.entrega_igual_cadastro || 'S');
        setVal('cr_cadastro_igual_receita', data.cadastro_igual_receita || 'S');
        setVal('cr_casa_sala_conj_end', data.casa_sala_conj_end || 'N');
        setVal('cr_email_corporativo', data.email_corporativo || 'S');
        setVal('cr_existe_mail_financeiro', data.existe_mail_financeiro || 'S');
        setVal('cr_mail_gratuito', data.mail_gratuito || 'N');
        setVal('cr_possui_site', data.possui_site || 'S');
        setVal('cr_fundacao_matriz', data.fundacao_matriz || '');
        setVal('cr_capital_social', data.capital_social || 100000);
        setVal('cr_cnpj_ativo', data.cnpj_ativo || 'S');
        setVal('cr_pgtos_abertos', data.pgtos_abertos || 'N');
        setVal('cr_comprou_pagou', data.comprou_pagou || 'S');
        setVal('cr_comprou_pagou_5x', data.comprou_pagou_5x || 'N');

        if (creditoProtheusBadge) {
          creditoProtheusBadge.classList.remove('hidden');
          creditoProtheusBadge.style.background = 'rgba(34, 197, 94, 0.12)';
          creditoProtheusBadge.style.borderColor = 'rgba(34, 197, 94, 0.3)';
          creditoProtheusBadge.style.color = '#22c55e';
          creditoProtheusBadge.innerHTML = `✓ Pedido <strong>#${data.pedido_venda}</strong> (${escapeHtml(data.cliente_nome)}) importado com sucesso do Protheus ERP. Complete os campos e clique em Consultar.`;
        }
      } catch (err) {
        // Limpa campos para evitar dados falsos/stale
        if (formAnaliseCreditoCompleto) formAnaliseCreditoCompleto.reset();
        const setVal = (id, val) => {
          const el = document.getElementById(id);
          if (el) el.value = val;
        };
        setVal('cr_pedido_venda', numPed);
        setVal('cr_total_pedido', '');
        setVal('cr_cliente_nome', '');

        if (creditoProtheusBadge) {
          creditoProtheusBadge.classList.remove('hidden');
          creditoProtheusBadge.style.background = 'rgba(239, 68, 68, 0.15)';
          creditoProtheusBadge.style.borderColor = 'rgba(239, 68, 68, 0.4)';
          creditoProtheusBadge.style.color = '#f87171';
          creditoProtheusBadge.innerHTML = `❌ <strong>Pedido #${escapeHtml(numPed)} NÃO EXISTE no Protheus</strong> para a Empresa ${escapeHtml(emp)}. Verifique o número digitado ou a empresa selecionada.`;
        }
        alert(`❌ Pedido #${numPed} NÃO EXISTE no ERP Protheus (Empresa ${emp}).\n\nPor favor, confirme se o número do pedido está correto no Protheus.`);
      } finally {
        btnIniciarConsultaCredito.disabled = false;
        btnIniciarConsultaCredito.innerHTML = '<span>⚡ Iniciar Consulta Protheus</span>';
      }
    });
  }

  // Submeter Análise de Crédito
  if (formAnaliseCreditoCompleto) {
    formAnaliseCreditoCompleto.addEventListener('submit', async (e) => {
      e.preventDefault();

      const getVal = (id) => {
        const el = document.getElementById(id);
        return el ? el.value.trim() : '';
      };

      const payload = {
        empresa: creditoEmpresaSelect ? creditoEmpresaSelect.value : '14',
        pedido_venda: getVal('cr_pedido_venda'),
        cod_web: getVal('cr_cod_web'),
        cliente_codigo: getVal('cr_cliente_codigo'),
        cliente_nome: getVal('cr_cliente_nome'),
        total_pedido: parseFloat(getVal('cr_total_pedido')) || 0,
        desconto_ped: getVal('cr_desconto_ped') || 'OK',
        faturado: getVal('cr_faturado') || 'S',
        entrada: getVal('cr_entrada') || 'N',
        quant_grande: getVal('cr_quant_grande') || 'N',
        prod_nao_combinam: getVal('cr_prod_nao_combinam') || 'N',
        armario_cofre_gt_2000: getVal('cr_armario_cofre_gt_2000') || 'N',
        uf_cliente: getVal('cr_uf_cliente') || 'SP',
        entrega_igual_cadastro: getVal('cr_entrega_igual_cadastro') || 'S',
        cadastro_igual_receita: getVal('cr_cadastro_igual_receita') || 'S',
        casa_sala_conj_end: getVal('cr_casa_sala_conj_end') || 'N',
        google_maps: getVal('cr_google_maps') || '5',
        registro_br: getVal('cr_registro_br') || 'N',
        scamadvizer_score: parseFloat(getVal('cr_scamadvizer_score')) || 100,
        email_corporativo: getVal('cr_email_corporativo') || 'S',
        existe_mail_financeiro: getVal('cr_existe_mail_financeiro') || 'S',
        mail_gratuito: getVal('cr_mail_gratuito') || 'N',
        possui_site: getVal('cr_possui_site') || 'S',
        fundacao_matriz: getVal('cr_fundacao_matriz') || '',
        capital_social: parseFloat(getVal('cr_capital_social')) || 0,
        score_serasa: parseInt(getVal('cr_score_serasa')) || 0,
        protestos: getVal('cr_protestos') || 'N',
        valor_protestos: parseFloat(getVal('cr_valor_protestos')) || 0,
        pfin: getVal('cr_pfin') || 'N',
        ch_sem_fundo: getVal('cr_ch_sem_fundo') || 'N',
        cnpj_ativo: getVal('cr_cnpj_ativo') || 'S',
        pgtos_abertos: getVal('cr_pgtos_abertos') || 'N',
        comprou_pagou: getVal('cr_comprou_pagou') || 'S',
        comprou_pagou_5x: getVal('cr_comprou_pagou_5x') || 'N',
        fgts_situacao_regular: getVal('cr_fgts_situacao_regular') || 'S',
        razao_fgts_igual: getVal('cr_razao_fgts_igual') || 'S',
        tres_nfs_confirmadas: getVal('cr_tres_nfs_confirmadas') || 'N',
        obs: getVal('cr_obs'),
        decisao_final: getVal('cr_decisao_final') || 'Liberado'
      };

      if (!payload.pedido_venda || !payload.cliente_nome || !payload.uf_cliente || !payload.fundacao_matriz) {
        alert('Atenção: Todos os campos obrigatórios (Pedido, Cliente, UF, Fundação) devem ser preenchidos para registrar no banco.');
        return;
      }

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

        const setAlerta = (id, val, text) => {
          const el = document.getElementById(id);
          if (el) {
            el.textContent = val !== 'N/A' ? text : 'Dispensado / Sem Risco';
            el.style.color = val !== 'N/A' ? '#f87171' : '#22c55e';
          }
        };

        setAlerta('valAlertaPedCompra', resScore.alertaPedCompra, 'SOLICITAR PED. COMPRA');
        setAlerta('valAlertaContrato', resScore.alertaContratoEntrega, 'SOLIC. CONTRATO ENTREGA');
        setAlerta('valAlertaGolpe', resScore.alertaPerigoGolpe, 'CHECAGEM REVERSA');
        setAlerta('valAlertaCadReceita', resScore.alertaCadastroReceita, 'CORRIGIR END. DIVERGENTE');

        if (creditoResultadoSection) creditoResultadoSection.classList.remove('hidden');
        creditoResultadoSection.scrollIntoView({ behavior: 'smooth' });

        carregarHistoricoCredito();
      } catch (err) {
        alert('Erro ao calcular e registrar análise: ' + err.message);
      } finally {
        if (btnSubmit) {
          btnSubmit.disabled = false;
          btnSubmit.innerHTML = '🛡️ Consultar & Gravar no Banco';
        }
      }
    });
  }

  // Carregar Histórico
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

    const filtrados = listaHistoricoCredito.filter(item => {
      return (
        String(item.pedido_venda || '').toLowerCase().includes(termo) ||
        String(item.cliente_nome || '').toLowerCase().includes(termo) ||
        String(item.empresa || '').toLowerCase().includes(termo) ||
        String(item.risco || '').toLowerCase().includes(termo)
      );
    });

    if (filtrados.length === 0) {
      historicoCreditoTableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">Nenhuma análise encontrada.</td></tr>`;
      return;
    }

    historicoCreditoTableBody.innerHTML = filtrados.map(item => {
      const dataStr = item.created_at ? new Date(item.created_at).toLocaleString('pt-BR') : '-';
      const scoreColor = item.total_score > 5 ? '#22c55e' : '#f87171';
      return `
        <tr>
          <td style="font-size: 0.8rem; font-family: var(--font-mono); color: var(--text-muted);">${dataStr}</td>
          <td><span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8;">${escapeHtml(item.empresa)}</span></td>
          <td><strong style="color: #38bdf8; font-family: var(--font-mono);">#${escapeHtml(item.pedido_venda)}</strong></td>
          <td><strong>${escapeHtml(item.cliente_nome)}</strong></td>
          <td style="text-align: right; font-weight: 700; font-family: var(--font-mono);">R$ ${Number(item.total_pedido || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
          <td style="text-align: center;"><span class="badge" style="color: ${scoreColor}; font-weight: 800;">${item.total_score}</span></td>
          <td style="text-align: center;"><span class="badge" style="font-size: 0.75rem; font-weight: 700;">${escapeHtml(item.risco)}</span></td>
          <td>
            <div style="font-size: 0.82rem; color: #38bdf8; font-weight: 600;">${escapeHtml(item.sugestao)}</div>
            <div style="font-size: 0.72rem; color: var(--text-muted);">Decisão: ${escapeHtml(item.decisao_final || 'Liberado')}</div>
          </td>
        </tr>
      `;
    }).join('');
  }

  if (buscaHistoricoCredito) {
    buscaHistoricoCredito.addEventListener('input', renderHistoricoCreditoTable);
  }

  // Carregar Configurações do Score
  async function carregarScoreConfigUI() {
    try {
      const res = await fetch('/api/financeiro/analise-credito/config');
      const data = await res.json();
      if (data.success && data.config) {
        const cfg = data.config;
        for (const [k, v] of Object.entries(cfg)) {
          const el = document.getElementById(`cfg_${k}`);
          if (el) el.value = v;
        }
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
        cfg[k] = parseFloat(inp.value) || 0;
      });

      try {
        const res = await fetch('/api/financeiro/analise-credito/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cfg)
        });
        const d = await res.json();
        if (d.success) {
          alert('Parâmetros do Score de Crédito salvos com sucesso!');
        } else {
          alert('Erro ao salvar: ' + d.error);
        }
      } catch (err) {
        alert('Falha ao salvar configurações.');
      }
    });
  }

  if (btnResetScoreConfig) {
    btnResetScoreConfig.addEventListener('click', async () => {
      if (confirm('Deseja restaurar todos os parâmetros para os valores originais da planilha Score 2025?')) {
        carregarScoreConfigUI();
      }
    });
  }

  carregarHistoricoCredito();
  carregarScoreConfigUI();

  if (btnOpenInterConfig) btnOpenInterConfig.addEventListener('click', abrirModalInterConfig);
  if (btnCloseInterConfigModal) btnCloseInterConfigModal.addEventListener('click', () => interConfigModal.classList.add('hidden'));
  if (btnConfirmInterConfigModal) btnConfirmInterConfigModal.addEventListener('click', () => interConfigModal.classList.add('hidden'));
});

