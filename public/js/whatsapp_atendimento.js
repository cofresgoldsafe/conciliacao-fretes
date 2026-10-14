/**
 * public/js/whatsapp_atendimento.js
 * 
 * Módulo Frontend Isolado: WhatsApp Atendimento
 * Aba: ⚙️ CONFIGURAÇÕES -> 💬 WhatsApp Atendimento (#tab-config-whatsapp)
 * 
 * Responsabilidades:
 * 1. Detecção automática do operador logado via auth_user (Figueiredo, Andrea, Juliana, Alexandre).
 * 2. Conexão híbrida resiliente: Supabase Realtime (via CDN) + Backend REST API (/api/chat/*).
 * 3. Gerenciamento de conversas: alternar chat, assumir, finalizar, devolver para IA e enviar mensagens.
 * 4. Navalha de Texto: interface concisa e ágil para atendimento humano e bot.
 */

(function () {
  'use strict';

  // Configurações e Estado Local
  let _initialized = false;
  let activeConversationId = null;
  let activeFilter = 'all'; // 'all' | 'waiting' | 'mine' | 'bot'
  let searchTerm = '';
  let activeOperator = 'Alexandre';
  let conversationsCache = [];
  let messagesCache = {};
  let operatorsCache = [];
  let supabaseClient = null;
  let realtimeChannel = null;
  let pollingInterval = null;

  // Detecção da URL base da API
  function getApiBaseUrl() {
    if (window.WHATSAPP_API_BASE) return window.WHATSAPP_API_BASE;
    const stored = localStorage.getItem('wa_api_url');
    if (stored) return stored.replace(/\/+$/, '');
    if (localStorage.getItem('wa_use_local') === 'true') {
      return 'http://localhost:3333';
    }
    // Padrão de Produção no Render
    return 'https://gemini-whatsapp-multi360.onrender.com';
  }

  // Sanitização XSS
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Detecção do Operador Logado no Portal
  function detectLoggedOperator() {
    try {
      const storedPref = localStorage.getItem('wa_active_operator');
      if (storedPref) return storedPref;

      const raw = localStorage.getItem('auth_user');
      if (!raw) return 'Alexandre';

      const user = typeof raw === 'string' && (raw.startsWith('{') || raw.startsWith('['))
        ? JSON.parse(raw)
        : { name: raw };

      const name = (user.name || user.username || '').trim().toLowerCase();

      if (name.includes('figueiredo')) return 'Figueiredo';
      if (name.includes('andrea')) return 'Andrea';
      if (name.includes('juliana')) return 'Juliana';
      if (name.includes('alexandre')) return 'Alexandre';

      return user.name || user.username || 'Alexandre';
    } catch (e) {
      console.warn('[WA] Erro ao detectar operador logado:', e);
      return 'Alexandre';
    }
  }

  // Formatação de Horários
  function formatTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '';
    
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    if (isToday) {
      return `${hours}:${minutes}`;
    }

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return `Ontem ${hours}:${minutes}`;
    }

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${day}/${month} ${hours}:${minutes}`;
  }

  // Formatação de Telefone
  function formatPhone(phone) {
    if (!phone) return '';
    const digits = String(phone).replace(/\D/g, '');
    if (digits.length === 13 && digits.startsWith('55')) {
      return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
    }
    if (digits.length === 12 && digits.startsWith('55')) {
      return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
    }
    if (digits.length === 11) {
      return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
    }
    return phone;
  }

  // Label e Classe de Status
  function getStatusInfo(status) {
    switch (status) {
      case 'WAITING_HUMAN':
        return { label: 'Aguardando', badgeClass: 'wa-badge-waiting', dotClass: 'connecting' };
      case 'IN_PROGRESS':
        return { label: 'Em atendimento', badgeClass: 'wa-badge-progress', dotClass: 'online' };
      case 'CLOSED':
        return { label: 'Encerrado', badgeClass: 'wa-badge-closed', dotClass: 'offline' };
      case 'BOT_AI':
      default:
        return { label: 'IA Gemini', badgeClass: 'wa-badge-bot', dotClass: 'online' };
    }
  }

  // Atualização do Indicador de Conexão
  function updateConnectionBadge(state, text) {
    const badge = document.getElementById('waConnectionBadge');
    const dot = badge ? badge.querySelector('.wa-status-dot') : null;
    const txt = document.getElementById('waConnectionText');

    if (!badge || !dot || !txt) return;

    dot.className = 'wa-status-dot';
    if (state === 'online') {
      dot.classList.add('online');
      txt.textContent = text || 'Tempo Real Ativo';
    } else if (state === 'connecting') {
      dot.classList.add('connecting');
      txt.textContent = text || 'Conectando...';
    } else {
      dot.classList.add('offline');
      txt.textContent = text || 'Desconectado';
    }
  }

  // ============================================================================
  // REQUISIÇÕES HTTP COM RESILIÊNCIA
  // ============================================================================

  async function apiRequest(endpoint, options = {}) {
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}${endpoint}`;

    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    // Anexa token JWT se existir
    const token = localStorage.getItem('auth_token') || localStorage.getItem('gsi_auth_token');
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const res = await fetch(url, { ...options, headers });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${res.status}: ${res.statusText}`);
      }
      return await res.json();
    } catch (err) {
      console.warn(`[WA API] Falha na chamada ${endpoint}:`, err.message);
      throw err;
    }
  }

  // ============================================================================
  // CARREGAMENTO E MANIPULAÇÃO DE DADOS
  // ============================================================================

  async function fetchConversations() {
    try {
      // 1. Tenta buscar via REST API
      const data = await apiRequest('/api/chat/conversations');
      if (data && Array.isArray(data.conversations)) {
        conversationsCache = data.conversations;
        renderConversationList();
        updateWaitingCounter();
        return;
      }
    } catch (err) {
      // Fallback: se Supabase direto estiver inicializado
      if (supabaseClient) {
        try {
          const { data, error } = await supabaseClient
            .from('conversations')
            .select(`
              id,
              status,
              operator_id,
              last_message_at,
              created_at,
              updated_at,
              contacts (id, phone_key, name, email),
              operators (id, name, email)
            `)
            .order('last_message_at', { ascending: false });

          if (!error && Array.isArray(data)) {
            conversationsCache = data;
            renderConversationList();
            updateWaitingCounter();
            return;
          }
        } catch (sbErr) {
          console.warn('[WA Supabase] Falha ao consultar conversas:', sbErr);
        }
      }
    }
  }

  async function fetchMessages(conversationId) {
    if (!conversationId) return;

    try {
      // 1. Tenta buscar via REST API
      const data = await apiRequest(`/api/chat/messages/${encodeURIComponent(conversationId)}`);
      if (data && Array.isArray(data.messages)) {
        messagesCache[conversationId] = data.messages;
        if (activeConversationId === conversationId) {
          renderMessages(data.messages);
        }
        return;
      }
    } catch (err) {
      // Fallback Supabase direto
      if (supabaseClient) {
        try {
          const { data, error } = await supabaseClient
            .from('messages')
            .select('id, conversation_id, sender_type, sender_id, text, created_at')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: true });

          if (!error && Array.isArray(data)) {
            messagesCache[conversationId] = data;
            if (activeConversationId === conversationId) {
              renderMessages(data);
            }
          }
        } catch (sbErr) {
          console.warn('[WA Supabase] Falha ao consultar mensagens:', sbErr);
        }
      }
    }
  }

  // ============================================================================
  // RENDERIZAÇÃO DE INTERFACE
  // ============================================================================

  function updateWaitingCounter() {
    const counterEl = document.getElementById('waCountWaiting');
    if (!counterEl) return;

    const waitingCount = conversationsCache.filter(c => c.status === 'WAITING_HUMAN').length;
    counterEl.textContent = waitingCount;
    if (waitingCount === 0) {
      counterEl.classList.add('zero');
    } else {
      counterEl.classList.remove('zero');
    }
  }

  function getFilteredConversations() {
    return conversationsCache.filter(conv => {
      // 1. Filtro por busca de texto
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const contactName = (conv.contacts?.name || '').toLowerCase();
        const phone = (conv.contacts?.phone_key || '').toLowerCase();
        if (!contactName.includes(term) && !phone.includes(term)) {
          return false;
        }
      }

      // 2. Filtro por Abas
      if (activeFilter === 'waiting') {
        return conv.status === 'WAITING_HUMAN';
      }
      if (activeFilter === 'mine') {
        const opName = conv.operators?.name || '';
        return opName.toLowerCase() === activeOperator.toLowerCase();
      }
      if (activeFilter === 'bot') {
        return conv.status === 'BOT_AI';
      }

      return true; // 'all'
    });
  }

  function renderConversationList() {
    const listEl = document.getElementById('waConversationList');
    if (!listEl) return;

    const filtered = getFilteredConversations();

    if (filtered.length === 0) {
      listEl.innerHTML = `
        <div style="padding: 24px; text-align: center; color: var(--text-muted, #94a3b8); font-size: 0.85rem;">
          Nenhuma conversa nesta visualização.
        </div>
      `;
      return;
    }

    listEl.innerHTML = filtered.map(conv => {
      const isActive = conv.id === activeConversationId;
      const statusInfo = getStatusInfo(conv.status);
      const contactName = conv.contacts?.name || formatPhone(conv.contacts?.phone_key) || 'Cliente';
      const timeStr = formatTime(conv.last_message_at || conv.created_at);
      const operatorName = conv.operators?.name || '';

      return `
        <div class="wa-conv-item ${isActive ? 'active' : ''}" data-conv-id="${escapeHtml(conv.id)}">
          <div class="wa-conv-avatar">👤</div>
          <div class="wa-conv-info">
            <div class="wa-conv-top-row">
              <span class="wa-conv-name" title="${escapeHtml(contactName)}">${escapeHtml(contactName)}</span>
              <span class="wa-conv-time">${escapeHtml(timeStr)}</span>
            </div>
            <div class="wa-conv-bottom-row">
              <span class="wa-conv-snippet">${escapeHtml(conv.contacts?.phone_key ? formatPhone(conv.contacts.phone_key) : '')}</span>
              <div class="wa-conv-badges">
                ${operatorName ? `<span class="wa-badge wa-badge-operator" title="Operador">${escapeHtml(operatorName)}</span>` : ''}
                <span class="wa-badge ${statusInfo.badgeClass}">${statusInfo.label}</span>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Adiciona evento de clique nas conversas
    listEl.querySelectorAll('.wa-conv-item').forEach(el => {
      el.addEventListener('click', () => {
        const convId = el.getAttribute('data-conv-id');
        selectConversation(convId);
      });
    });
  }

  function selectConversation(conversationId) {
    activeConversationId = conversationId;

    // Atualiza destaque na lista lateral
    const listEl = document.getElementById('waConversationList');
    if (listEl) {
      listEl.querySelectorAll('.wa-conv-item').forEach(el => {
        if (el.getAttribute('data-conv-id') === conversationId) {
          el.classList.add('active');
        } else {
          el.classList.remove('active');
        }
      });
    }

    const conv = conversationsCache.find(c => c.id === conversationId);
    if (!conv) return;

    // Atualiza Painel Central
    const emptyChat = document.getElementById('waEmptyChat');
    const activeChat = document.getElementById('waActiveChat');
    if (emptyChat) emptyChat.classList.add('hidden');
    if (activeChat) activeChat.classList.remove('hidden');

    // Cabeçalho da Conversa
    const contactName = conv.contacts?.name || formatPhone(conv.contacts?.phone_key) || 'Cliente';
    const contactPhone = conv.contacts?.phone_key ? formatPhone(conv.contacts.phone_key) : '';
    const statusInfo = getStatusInfo(conv.status);

    const nameEl = document.getElementById('waChatContactName');
    const phoneEl = document.getElementById('waChatContactPhone');
    const badgeEl = document.getElementById('waChatStatusBadge');

    if (nameEl) nameEl.textContent = contactName;
    if (phoneEl) phoneEl.textContent = contactPhone;
    if (badgeEl) {
      badgeEl.className = `wa-badge ${statusInfo.badgeClass}`;
      badgeEl.textContent = statusInfo.label;
    }

    // Botões de Ação
    updateActionButtons(conv);

    // Carrega e renderiza mensagens
    const cachedMsgs = messagesCache[conversationId];
    if (cachedMsgs) {
      renderMessages(cachedMsgs);
    } else {
      const container = document.getElementById('waMessagesContainer');
      if (container) {
        container.innerHTML = `
          <div style="text-align: center; color: var(--text-muted); padding: 20px; font-size: 0.85rem;">
            Carregando histórico...
          </div>
        `;
      }
    }

    fetchMessages(conversationId);

    // Foco no campo de texto
    const input = document.getElementById('waMessageInput');
    if (input) input.focus();
  }

  function updateActionButtons(conv) {
    const btnAssume = document.getElementById('waBtnAssume');
    const btnFinish = document.getElementById('waBtnFinish');
    const btnReturnBot = document.getElementById('waBtnReturnBot');
    const banner = document.getElementById('waChatBanner');
    const form = document.getElementById('waChatForm');
    const input = document.getElementById('waMessageInput');
    const sendBtn = document.getElementById('waBtnSend');

    if (!btnAssume || !btnFinish || !btnReturnBot || !banner) return;

    // Reset estado
    btnAssume.classList.remove('hidden');
    btnFinish.classList.remove('hidden');
    btnReturnBot.classList.remove('hidden');
    banner.classList.add('hidden');
    banner.className = 'wa-chat-banner';

    if (input) input.disabled = false;
    if (sendBtn) sendBtn.disabled = false;

    if (conv.status === 'BOT_AI') {
      btnAssume.textContent = '👤 Assumir';
      btnFinish.classList.add('hidden');
      btnReturnBot.classList.add('hidden');
      banner.classList.remove('hidden');
      banner.classList.add('banner-bot');
      banner.innerHTML = `<span>🤖 IA Gemini em atendimento. Assuma para interagir diretamente.</span>`;
    } else if (conv.status === 'WAITING_HUMAN') {
      btnAssume.textContent = '⚡ Atender Agora';
      btnFinish.classList.add('hidden');
      banner.classList.remove('hidden');
      banner.classList.add('banner-waiting');
      banner.innerHTML = `<span>⏳ Cliente na fila aguardando vendedor humano.</span>`;
    } else if (conv.status === 'IN_PROGRESS') {
      btnAssume.classList.add('hidden');
      const opName = conv.operators?.name || 'Vendedor';
      banner.classList.remove('hidden');
      banner.innerHTML = `<span>👤 Atendimento em andamento com <strong>${escapeHtml(opName)}</strong>.</span>`;
    } else if (conv.status === 'CLOSED') {
      btnAssume.textContent = '🔄 Reabrir';
      btnFinish.classList.add('hidden');
      btnReturnBot.classList.add('hidden');
      banner.classList.remove('hidden');
      banner.classList.add('banner-closed');
      banner.innerHTML = `<span>🔒 Atendimento encerrado.</span>`;
      if (input) input.disabled = true;
      if (sendBtn) sendBtn.disabled = true;
    }
  }

  function renderMessages(messages) {
    const container = document.getElementById('waMessagesContainer');
    if (!container) return;

    if (!messages || messages.length === 0) {
      container.innerHTML = `
        <div class="wa-msg-system">
          Início da conversa. Nenhuma mensagem registrada ainda.
        </div>
      `;
      return;
    }

    container.innerHTML = messages.map(msg => {
      const isClient = msg.sender_type === 'CLIENT';
      const isBot = msg.sender_type === 'BOT';
      const isOperator = msg.sender_type === 'OPERATOR';

      let msgClass = 'wa-msg-client';
      let senderLabel = '👤 Cliente';

      if (isBot) {
        msgClass = 'wa-msg-bot';
        senderLabel = '🤖 IA Gemini';
      } else if (isOperator) {
        msgClass = 'wa-msg-operator';
        senderLabel = `👤 ${msg.sender_id || activeOperator}`;
      }

      const timeStr = formatTime(msg.created_at);

      return `
        <div class="wa-msg ${msgClass}">
          <div class="wa-msg-sender">
            <span>${escapeHtml(senderLabel)}</span>
          </div>
          <div class="wa-msg-text">${escapeHtml(msg.text)}</div>
          <div class="wa-msg-footer">
            <span class="wa-msg-time">${escapeHtml(timeStr)}</span>
            ${isOperator ? '<span>✓</span>' : ''}
          </div>
        </div>
      `;
    }).join('');

    // Rola para a mensagem mais recente
    container.scrollTop = container.scrollHeight;
  }

  // ============================================================================
  // AÇÕES DO OPERADOR
  // ============================================================================

  async function handleSendMessage(e) {
    if (e) e.preventDefault();
    if (!activeConversationId) return;

    const input = document.getElementById('waMessageInput');
    if (!input) return;

    const text = input.value.trim();
    if (!text) return;

    const conv = conversationsCache.find(c => c.id === activeConversationId);
    if (!conv) return;

    // Limpa campo imediatamente
    input.value = '';

    // Mensagem otimista no chat local
    const tempMsg = {
      id: `temp_${Date.now()}`,
      conversation_id: activeConversationId,
      sender_type: 'OPERATOR',
      sender_id: activeOperator,
      text: text,
      created_at: new Date().toISOString()
    };

    if (!messagesCache[activeConversationId]) {
      messagesCache[activeConversationId] = [];
    }
    messagesCache[activeConversationId].push(tempMsg);
    renderMessages(messagesCache[activeConversationId]);

    // Atualiza snippet da lista lateral
    conv.last_message_at = new Date().toISOString();
    renderConversationList();

    try {
      // 1. Envio para a API backend
      await apiRequest('/api/chat/send', {
        method: 'POST',
        body: JSON.stringify({
          conversationId: activeConversationId,
          text: text,
          operatorId: activeOperator
        })
      });

      // Se a conversa estava em WAITING ou BOT, atualiza para IN_PROGRESS
      if (conv.status === 'WAITING_HUMAN' || conv.status === 'BOT_AI') {
        conv.status = 'IN_PROGRESS';
        updateActionButtons(conv);
        renderConversationList();
        updateWaitingCounter();
      }
    } catch (err) {
      console.error('[WA] Erro ao despachar mensagem:', err);
      // Notifica erro de envio na interface
      const container = document.getElementById('waMessagesContainer');
      if (container) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'wa-msg-system';
        errorDiv.style.color = '#f43f5e';
        errorDiv.textContent = `Falha no envio da mensagem: ${err.message}`;
        container.appendChild(errorDiv);
        container.scrollTop = container.scrollHeight;
      }
    }
  }

  async function handleAssumeChat() {
    if (!activeConversationId) return;
    const conv = conversationsCache.find(c => c.id === activeConversationId);
    if (!conv) return;

    try {
      conv.status = 'IN_PROGRESS';
      conv.operators = { name: activeOperator };
      updateActionButtons(conv);
      renderConversationList();
      updateWaitingCounter();

      await apiRequest('/api/chat/assign', {
        method: 'POST',
        body: JSON.stringify({
          conversationId: activeConversationId,
          operatorId: activeOperator,
          status: 'IN_PROGRESS'
        })
      });
    } catch (err) {
      console.warn('[WA] Falha ao assumir conversa no servidor:', err);
    }
  }

  async function handleFinishChat() {
    if (!activeConversationId) return;
    const conv = conversationsCache.find(c => c.id === activeConversationId);
    if (!conv) return;

    try {
      conv.status = 'CLOSED';
      updateActionButtons(conv);
      renderConversationList();
      updateWaitingCounter();

      await apiRequest('/api/chat/assign', {
        method: 'POST',
        body: JSON.stringify({
          conversationId: activeConversationId,
          operatorId: activeOperator,
          status: 'CLOSED'
        })
      });
    } catch (err) {
      console.warn('[WA] Falha ao encerrar conversa no servidor:', err);
    }
  }

  async function handleReturnToBot() {
    if (!activeConversationId) return;
    const conv = conversationsCache.find(c => c.id === activeConversationId);
    if (!conv) return;

    try {
      conv.status = 'BOT_AI';
      updateActionButtons(conv);
      renderConversationList();
      updateWaitingCounter();

      await apiRequest('/api/chat/assign', {
        method: 'POST',
        body: JSON.stringify({
          conversationId: activeConversationId,
          operatorId: activeOperator,
          status: 'BOT_AI'
        })
      });
    } catch (err) {
      console.warn('[WA] Falha ao devolver conversa para o Bot:', err);
    }
  }

  // ============================================================================
  // SUPABASE REALTIME & FALLBACK POLLING
  // ============================================================================

  function initSupabaseRealtime() {
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      console.log('[WA] Supabase CDN não disponível. Operando via polling HTTP.');
      startPolling();
      return;
    }

    const supabaseUrl = window.SUPABASE_URL || localStorage.getItem('wa_supabase_url') || 'https://huhwzrvxkzffzxfqtzob.supabase.co';
    const supabaseKey = window.SUPABASE_ANON_KEY || localStorage.getItem('wa_supabase_key') || 'sb_publishable__5LmUfJ-JyWdnEAQoZ67tw_x165Jbk3';

    if (!supabaseUrl || !supabaseKey) {
      console.log('[WA] Credenciais Supabase não configuradas no frontend. Operando via polling HTTP.');
      updateConnectionBadge('online', 'Conectado (HTTP)');
      startPolling();
      return;
    }

    try {
      updateConnectionBadge('connecting', 'Conectando Supabase...');
      supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

      realtimeChannel = supabaseClient.channel('whatsapp-portal-channel')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, payload => {
          handleRealtimeConversationChange(payload);
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
          handleRealtimeNewMessage(payload.new);
        })
        .subscribe(status => {
          if (status === 'SUBSCRIBED') {
            updateConnectionBadge('online', 'Supabase Realtime');
          } else if (status === 'CHANNEL_ERROR') {
            updateConnectionBadge('connecting', 'Reconectando Realtime...');
          }
        });
    } catch (err) {
      console.warn('[WA] Erro ao inicializar Realtime:', err);
      updateConnectionBadge('online', 'Conectado (HTTP)');
      startPolling();
    }
  }

  function handleRealtimeConversationChange(payload) {
    if (!payload || !payload.new) return;
    const newConv = payload.new;

    const idx = conversationsCache.findIndex(c => c.id === newConv.id);
    if (idx >= 0) {
      conversationsCache[idx] = { ...conversationsCache[idx], ...newConv };
    } else {
      conversationsCache.unshift(newConv);
    }

    renderConversationList();
    updateWaitingCounter();

    if (activeConversationId === newConv.id) {
      const conv = conversationsCache.find(c => c.id === activeConversationId);
      if (conv) updateActionButtons(conv);
    }
  }

  function handleRealtimeNewMessage(newMsg) {
    if (!newMsg || !newMsg.conversation_id) return;

    const convId = newMsg.conversation_id;

    if (!messagesCache[convId]) {
      messagesCache[convId] = [];
    }

    // Evita duplicatas de mensagens otimistas
    const exists = messagesCache[convId].some(m => m.id === newMsg.id);
    if (!exists) {
      messagesCache[convId].push(newMsg);
    }

    // Se é a conversa aberta na tela, re-renderiza
    if (activeConversationId === convId) {
      renderMessages(messagesCache[convId]);
    }

    // Atualiza horário na lista lateral
    const conv = conversationsCache.find(c => c.id === convId);
    if (conv) {
      conv.last_message_at = newMsg.created_at;
      renderConversationList();
    }
  }

  function startPolling() {
    stopPolling();
    pollingInterval = setInterval(() => {
      // Atualiza apenas se o container do whatsapp estiver visível
      const pane = document.getElementById('tab-config-whatsapp');
      if (pane && !pane.classList.contains('hidden')) {
        fetchConversations();
        if (activeConversationId) {
          fetchMessages(activeConversationId);
        }
      }
    }, 5000);
  }

  function stopPolling() {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  }

  // ============================================================================
  // INICIALIZAÇÃO E EVENT LISTENERS
  // ============================================================================

  function bindEvents() {
    // 1. Seletor de Operador
    const opSelect = document.getElementById('waOperatorSelect');
    if (opSelect) {
      opSelect.value = activeOperator;
      opSelect.addEventListener('change', () => {
        activeOperator = opSelect.value;
        localStorage.setItem('wa_active_operator', activeOperator);
        if (activeFilter === 'mine') {
          renderConversationList();
        }
      });
    }

    // 2. Botão de Atualizar
    const btnRefresh = document.getElementById('waBtnRefresh');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => {
        fetchConversations();
        if (activeConversationId) fetchMessages(activeConversationId);
      });
    }

    // 3. Campo de Pesquisa
    const searchInput = document.getElementById('waSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        searchTerm = searchInput.value.trim();
        renderConversationList();
      });
    }

    // 4. Abas de Filtro
    const filterTabs = document.querySelectorAll('.wa-filter-tab');
    filterTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        filterTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        activeFilter = tab.getAttribute('data-filter') || 'all';
        renderConversationList();
      });
    });

    // 5. Formulário de Envio
    const form = document.getElementById('waChatForm');
    if (form) {
      form.addEventListener('submit', handleSendMessage);
    }

    // Tecla Enter para enviar (Shift+Enter para quebra de linha)
    const textarea = document.getElementById('waMessageInput');
    if (textarea) {
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSendMessage();
        }
      });
    }

    // 6. Botões de Ação do Chat
    const btnAssume = document.getElementById('waBtnAssume');
    if (btnAssume) btnAssume.addEventListener('click', handleAssumeChat);

    const btnFinish = document.getElementById('waBtnFinish');
    if (btnFinish) btnFinish.addEventListener('click', handleFinishChat);

    const btnReturnBot = document.getElementById('waBtnReturnBot');
    if (btnReturnBot) btnReturnBot.addEventListener('click', handleReturnToBot);
  }

  // ============================================================================
  // MÓDULO PÚBLICO EXPOSTO
  // ============================================================================

  const whatsappAtendimentoModule = {
    init: function () {
      // Detecta operador
      activeOperator = detectLoggedOperator();

      if (!_initialized) {
        bindEvents();
        initSupabaseRealtime();
        _initialized = true;
      }

      // Sincroniza o seletor com o operador detectado
      const opSelect = document.getElementById('waOperatorSelect');
      if (opSelect) opSelect.value = activeOperator;

      // Carrega dados iniciais
      fetchConversations();
      if (activeConversationId) {
        fetchMessages(activeConversationId);
      }
    },

    selectConversation: selectConversation,
    refresh: fetchConversations
  };

  window.whatsappAtendimentoModule = whatsappAtendimentoModule;
})();
