/**
 * public/js/auth.js
 * 
 * Módulo de Autenticação, Desafio 2FA, RBAC e Gestão de Sessão.
 */

import { apiFetch, escapeHtml } from './utils.js';

let currentTemp2FAToken = null;
let twoFactorTimerInterval = null;

export function getAuthToken() {
  return localStorage.getItem('auth_token');
}

export function getAuthUser() {
  try {
    const raw = localStorage.getItem('auth_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function isAuthenticated() {
  const token = getAuthToken();
  const user = getAuthUser();
  return Boolean(token && user);
}

export function setSession(token, user) {
  if (token) localStorage.setItem('auth_token', token);
  if (user) localStorage.setItem('auth_user', typeof user === 'string' ? user : JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('auth_user');
}

/**
 * Inicializa contagem regressiva de expiração do token 2FA (5 minutos)
 * @param {HTMLElement} timerEl Elemento de exibição do timer
 * @param {Function} onExpire Callback chamado ao expirar
 */
export function start2FATimer(timerEl, onExpire) {
  clearInterval(twoFactorTimerInterval);
  let timeLeft = 300; // 5 minutos = 300 segundos

  function updateDisplay() {
    const min = Math.floor(timeLeft / 60);
    const sec = timeLeft % 60;
    if (timerEl) {
      timerEl.textContent = `Código expira em ${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }
    if (timeLeft <= 0) {
      clearInterval(twoFactorTimerInterval);
      if (timerEl) timerEl.textContent = 'Código expirado. Clique em Reenviar.';
      if (typeof onExpire === 'function') onExpire();
    }
    timeLeft--;
  }

  updateDisplay();
  twoFactorTimerInterval = setInterval(updateDisplay, 1000);
}

export function stop2FATimer() {
  clearInterval(twoFactorTimerInterval);
}

/**
 * Dispara requisição de login com credenciais
 */
export async function loginUser(username, password) {
  const res = await apiFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Credenciais inválidas.');
  }

  if (data.require2FA) {
    currentTemp2FAToken = data.tempToken;
  } else if (data.token && data.user) {
    setSession(data.token, data.user);
  }

  return data;
}

/**
 * Valida o código 2FA de 4 dígitos digitado pelo operador
 */
export async function verify2FACode(code) {
  if (!currentTemp2FAToken) {
    throw new Error('Sessão temporária 2FA expirada. Faça login novamente.');
  }

  const res = await apiFetch('/api/auth/verify-2fa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tempToken: currentTemp2FAToken, code })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Código incorreto.');
  }

  setSession(data.token, data.user);
  currentTemp2FAToken = null;
  stop2FATimer();
  return data;
}

/**
 * Reenvia um novo código 2FA para o e-mail do usuário
 */
export async function resend2FACode() {
  if (!currentTemp2FAToken) {
    throw new Error('Sessão expirada. Faça login novamente.');
  }

  const res = await apiFetch('/api/auth/resend-2fa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tempToken: currentTemp2FAToken })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Erro ao reenviar código.');
  }

  if (data.tempToken) {
    currentTemp2FAToken = data.tempToken;
  }
  return data;
}

/**
 * Heartbeat periódico (a cada 5 minutos) para manter status ativo de engajamento do operador
 */
export function initSessionHeartbeat() {
  if (isAuthenticated()) {
    apiFetch('/api/auth/session-ping').catch(() => {});
  }
  setInterval(() => {
    if (isAuthenticated()) {
      apiFetch('/api/auth/session-ping').catch(() => {});
    }
  }, 5 * 60 * 1000);
}
