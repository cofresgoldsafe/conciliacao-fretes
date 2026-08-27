/**
 * public/js/config.js
 * 
 * Módulo de Configurações, Gestão de Operadores RBAC e Auditoria:
 * 1. Gestão de Usuários (Admin, User, Vendedor com vendorCode Protheus).
 * 2. Feed de Atividades de Auditoria em Tempo Real.
 * 3. Configurações de Conexão ViPP FTP.
 */

import { apiFetch, escapeHtml, formatDate } from './utils.js';

export async function carregarUsuariosAdmin() {
  const res = await apiFetch('/api/admin/users');
  if (!res.ok) {
    throw new Error('Acesso negado: apenas administradores podem gerenciar usuários.');
  }
  return await res.json();
}

export async function salvarUsuarioAdmin(usuario) {
  const res = await apiFetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(usuario)
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Erro ao salvar usuário.');
  }
  return data;
}

export async function excluirUsuarioAdmin(id) {
  const res = await apiFetch(`/api/admin/users/${id}`, {
    method: 'DELETE'
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Erro ao excluir usuário.');
  }
  return data;
}

export async function carregarAtividadesAuditoria() {
  const res = await apiFetch('/api/admin/activities');
  if (!res.ok) {
    throw new Error('Falha ao carregar trilha de auditoria.');
  }
  return await res.json();
}

export async function carregarConfigVipp() {
  const res = await apiFetch('/api/vipp/config');
  if (!res.ok) {
    throw new Error('Falha ao consultar configurações do ViPP.');
  }
  return await res.json();
}

export async function salvarConfigVipp(config) {
  const res = await apiFetch('/api/vipp/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  });
  if (!res.ok) {
    throw new Error('Falha ao salvar configurações do ViPP.');
  }
  return await res.json();
}
