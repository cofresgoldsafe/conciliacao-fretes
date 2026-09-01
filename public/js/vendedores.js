/**
 * public/js/vendedores.js
 * 
 * Módulo do Portal Comercial de Vendedores:
 * 1. Alternância e Persistência de Tema Claro/Escuro para todas as 5 sub-abas.
 * 2. Saldos em Estoque com visual Power BI, KPIs e paginação dinâmica.
 * 3. Pedidos Abertos não faturados com regras de bloqueio SC9 e CRM Pipedrive.
 * 4. Pedidos de Compras pendentes SC7 com fornecedores SA2010.
 * 5. Comissões & Metas proporcionais SE3.
 */

import { apiFetch, escapeHtml, formatCurrency, formatDate } from './utils.js';

// ─── TEMA CLARO / ESCURO ──────────────────────────────────────────────────

export function aplicarTemaVendedores(modo) {
  const isLight = (modo === 'light');
  const subAbasVendedores = [
    document.getElementById('tab-vend-saldos-estoque'),
    document.getElementById('tab-vend-pedidos'),
    document.getElementById('tab-vend-pedidos-abertos'),
    document.getElementById('tab-vend-pedidos-compras'),
    document.getElementById('tab-vend-comissoes')
  ];

  subAbasVendedores.forEach(el => {
    if (!el) return;
    if (isLight) el.classList.add('tab-theme-light');
    else el.classList.remove('tab-theme-light');
  });

  // Atualiza botões
  const btnVendedores = document.getElementById('btnToggleThemeVendedores');
  const iconV = document.getElementById('themeIconVendedores');
  const labelV = document.getElementById('themeLabelVendedores');
  const btnEstoque = document.getElementById('btnToggleThemeEstoque');
  const iconE = document.getElementById('themeIconEstoque');
  const labelE = document.getElementById('themeLabelEstoque');

  if (iconV && labelV) {
    iconV.textContent = isLight ? '🌙' : '☀️';
    labelV.textContent = isLight ? 'Modo Escuro' : 'Modo Claro';
  }
  if (iconE && labelE) {
    iconE.textContent = isLight ? '🌙' : '☀️';
    labelE.textContent = isLight ? 'Modo Escuro' : 'Modo Claro';
  }

  // Modais de Drilldown
  const modais = [
    document.getElementById('modalEstoqueDetalhes'),
    document.getElementById('pedidoDetalhesModal')
  ];
  modais.forEach(modal => {
    if (!modal) return;
    if (isLight) modal.classList.add('modal-theme-light');
    else modal.classList.remove('modal-theme-light');
  });

  localStorage.setItem('theme_vendedores', isLight ? 'light' : 'dark');
  localStorage.setItem('theme_saldos_estoque', isLight ? 'light' : 'dark');
}

export function toggleVendedoresTheme() {
  const current = localStorage.getItem('theme_vendedores') || 'dark';
  aplicarTemaVendedores(current === 'light' ? 'dark' : 'light');
}

export function inicializarTemaVendedores() {
  const salvo = localStorage.getItem('theme_vendedores') || localStorage.getItem('theme_saldos_estoque') || 'dark';
  aplicarTemaVendedores(salvo);
}

// ─── SALDOS EM ESTOQUE (POWER BI) ─────────────────────────────────────────

export async function carregarSaldosEstoque(params = {}) {
  const qs = new URLSearchParams();
  if (params.busca) qs.set('busca', params.busca);
  if (params.grupo && params.grupo !== 'todos') qs.set('grupo', params.grupo);
  if (params.filtroEstoque && params.filtroEstoque !== 'todos') qs.set('filtroEstoque', params.filtroEstoque);
  if (params.filtroEmpresa && params.filtroEmpresa !== 'todos') qs.set('filtroEmpresa', params.filtroEmpresa);

  const res = await apiFetch(`/api/vendedores/estoque/saldos?${qs.toString()}`);
  if (!res.ok) {
    throw new Error('Falha ao carregar saldos de estoque.');
  }
  return await res.json();
}

export async function sincronizarEstoqueManual() {
  const res = await apiFetch('/api/vendedores/estoque/sync', { method: 'POST' });
  const data = await res.json();
  if (res.status === 429) {
    throw new Error(data.message || 'Aguarde 2 minutos entre sincronizações manuais.');
  }
  if (!res.ok) {
    throw new Error(data.error || 'Erro na sincronização de estoque.');
  }
  return data;
}

// ─── PEDIDOS ABERTOS ──────────────────────────────────────────────────────

export async function carregarPedidosAbertos() {
  const res = await apiFetch('/api/vendedores/pedidos/abertos');
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Falha ao carregar pedidos em aberto.');
  }
  return await res.json();
}

// ─── PEDIDOS COMPRAS ──────────────────────────────────────────────────────

export async function carregarPedidosCompras() {
  const res = await apiFetch('/api/vendedores/pedidos/compras');
  if (!res.ok) {
    throw new Error('Falha ao carregar pedidos de compras.');
  }
  return await res.json();
}

// ─── COMISSÕES ────────────────────────────────────────────────────────────

export async function carregarComissoes(mes, ano) {
  const res = await apiFetch('/api/vendedores/comissoes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mes, ano })
  });
  if (!res.ok) {
    throw new Error('Falha ao consultar comissões.');
  }
  return await res.json();
}
