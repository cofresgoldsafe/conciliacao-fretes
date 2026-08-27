/**
 * public/js/utils.js
 * 
 * Módulo de Utilitários Globais, Sanitização DOM XSS, Formatação e Requisições Same-Origin.
 */

/**
 * Sanitização estrita contra DOM-based XSS
 * @param {string} str Texto de entrada não confiável
 * @returns {string} Texto sanitizado com entidades HTML
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Formata número para moeda brasileira (R$ 1.234,56)
 * @param {number} val Valor numérico
 * @returns {string} Valor formatado em BRL
 */
export function formatCurrency(val) {
  const num = Number(val) || 0;
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Formata data ISO (YYYY-MM-DD) ou timestamp para formato brasileiro (DD/MM/AAAA)
 * @param {string|Date} dateVal Data em formato ISO ou string
 * @returns {string} Data formatada em DD/MM/AAAA
 */
export function formatDate(dateVal) {
  if (!dateVal) return '--/--/----';
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) {
      // Se for formato YYYYMMDD do Protheus
      const str = String(dateVal).trim();
      if (str.length === 8 && /^\d{8}$/.test(str)) {
        return `${str.slice(6, 8)}/${str.slice(4, 6)}/${str.slice(0, 4)}`;
      }
      return String(dateVal);
    }
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  } catch {
    return String(dateVal);
  }
}

/**
 * Formata CPF ou CNPJ com máscara padrão
 * @param {string} doc Documento bruto
 * @returns {string} Documento com pontuação
 */
export function formatCnpjCpf(doc) {
  if (!doc) return '';
  const digits = String(doc).replace(/\D/g, '');
  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }
  if (digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  }
  return doc;
}

/**
 * Valida se o destino da requisição é da mesma origem (same-origin) antes de injetar credenciais
 * @param {string|Request} targetUrl URL alvo
 * @returns {boolean} True se a URL for da mesma origem
 */
export function isSameOriginUrl(targetUrl) {
  if (!targetUrl) return false;
  try {
    const urlStr = (typeof targetUrl === 'object' && targetUrl instanceof Request) 
      ? targetUrl.url 
      : String(targetUrl);

    if (urlStr.startsWith('/') && !urlStr.startsWith('//')) {
      return true;
    }

    const currentOrigin = window.location.origin;
    const parsed = new URL(urlStr, window.location.href);
    return parsed.origin === currentOrigin;
  } catch {
    return false;
  }
}

/**
 * Wrapper de fetch com injeção automática e segura de token JWT Bearer em requisições same-origin
 * @param {string} url Endpoint alvo
 * @param {Object} options Configuração da requisição
 * @returns {Promise<Response>}
 */
export async function apiFetch(url, options = {}) {
  const headers = { ...options.headers };
  const token = localStorage.getItem('auth_token');

  if (token && isSameOriginUrl(url)) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return fetch(url, {
    ...options,
    headers
  });
}
