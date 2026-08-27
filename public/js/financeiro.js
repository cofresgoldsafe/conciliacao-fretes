/**
 * public/js/financeiro.js
 * 
 * Módulo Financeiro & Conciliação Bancária:
 * 1. Consulta de Saldo ao vivo (Banco Inter mTLS vs SE8 Protheus).
 * 2. Extrato e Matching Inteligente (1:1, Cartão Líquido e N:1 Subset-Sum vs SE5).
 * 3. Monitoramento de Webhooks Bancários e Idempotência.
 * 4. Telemetria e Observabilidade de Circuit Breakers por Empresa.
 */

import { apiFetch, escapeHtml, formatCurrency, formatDate } from './utils.js';

export async function carregarSaldoFinanceiro(empresa = 'ALL') {
  const res = await apiFetch(`/api/financeiro/saldo?empresa=${encodeURIComponent(empresa)}`);
  if (!res.ok) {
    throw new Error('Falha ao consultar saldos bancários.');
  }
  return await res.json();
}

export async function carregarExtratoFinanceiro(dataInicio, dataFim, empresa = 'ALL') {
  const qs = new URLSearchParams();
  if (dataInicio) qs.set('dataInicio', dataInicio);
  if (dataFim) qs.set('dataFim', dataFim);
  if (empresa) qs.set('empresa', empresa);

  const res = await apiFetch(`/api/financeiro/extrato?${qs.toString()}`);
  if (!res.ok) {
    throw new Error('Falha ao consultar extrato e conciliação bancária.');
  }
  return await res.json();
}

export async function carregarWebhooksBancarios() {
  const res = await apiFetch('/api/financeiro/webhooks');
  if (!res.ok) {
    throw new Error('Falha ao carregar eventos de webhooks.');
  }
  return await res.json();
}

export async function carregarStatusCircuitBreakers() {
  const res = await apiFetch('/api/financeiro/circuit-breaker-status');
  if (!res.ok) {
    throw new Error('Falha ao consultar telemetria dos circuit breakers.');
  }
  return await res.json();
}
