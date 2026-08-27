/**
 * public/js/credito.js
 * 
 * Módulo de Análise de Crédito Comercial:
 * 1. Consulta ao ERP Protheus (SC5/SC6/SA1/SE1).
 * 2. Leitura e Validação de Laudos Serasa Experian (PDF).
 * 3. Motor de Score em Tempo Real e Ficha Imutável com Extrato.
 * 4. Calibração de Pesos e Critérios do Score.
 * 5. Histórico e Gravação da Decisão Operacional.
 */

import { apiFetch, escapeHtml, formatCurrency, formatDate } from './utils.js';

export async function consultarCreditoProtheus(numPedido, empresaCodigo) {
  const res = await apiFetch(`/api/financeiro/analise-credito/protheus?pedido=${encodeURIComponent(numPedido)}&empresa=${encodeURIComponent(empresaCodigo)}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Erro ao consultar pedido no Protheus.');
  }
  return data;
}

export async function parseSerasaPdf(file) {
  const formData = new FormData();
  formData.append('serasaPdf', file);

  const res = await apiFetch('/api/financeiro/analise-credito/parse-serasa-pdf', {
    method: 'POST',
    body: formData
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Erro ao processar laudo Serasa.');
  }
  return data;
}

export async function carregarScoreConfig() {
  const res = await apiFetch('/api/financeiro/analise-credito/config');
  if (!res.ok) {
    throw new Error('Falha ao carregar configurações de score.');
  }
  return await res.json();
}

export async function salvarScoreConfig(config) {
  const res = await apiFetch('/api/financeiro/analise-credito/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  });
  if (!res.ok) {
    throw new Error('Falha ao salvar pesos do score.');
  }
  return await res.json();
}

export async function salvarAnaliseCredito(dadosAnalise) {
  const res = await apiFetch('/api/financeiro/analise-credito/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dadosAnalise)
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Erro ao salvar análise de crédito.');
  }
  return data;
}

export async function carregarHistoricoCredito(limit = 200) {
  const res = await apiFetch(`/api/financeiro/analise-credito/history?limit=${limit}`);
  if (!res.ok) {
    throw new Error('Falha ao consultar histórico de crédito.');
  }
  return await res.json();
}
