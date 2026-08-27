/**
 * public/js/logistica.js
 * 
 * Módulo de Logística & Conciliação de Fretes:
 * 1. Upload e Parsing de Faturas Rodonaves (PDF).
 * 2. Upload e Parsing de Faturas Correios SFE (Extrato Analítico).
 * 3. Upload e Integração ViPP / Tipo 2 (CSV/TXT).
 * 4. Histórico de Conciliações e Amarrações Fiscais.
 */

import { apiFetch, escapeHtml, formatCurrency, formatDate } from './utils.js';

export async function uploadFaturaFrete(file, tipoTransportadora) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('tipoTransportadora', tipoTransportadora);

  const res = await apiFetch('/api/upload', {
    method: 'POST',
    body: formData
  });

  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || 'Erro ao processar fatura.');
    err.isWrongFormat = data.isWrongFormat || false;
    throw err;
  }
  return data;
}

export async function carregarHistoricoFretes() {
  const res = await apiFetch('/api/history');
  if (!res.ok) {
    throw new Error('Falha ao carregar histórico de fretes.');
  }
  return await res.json();
}
