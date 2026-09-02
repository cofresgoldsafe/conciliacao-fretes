/**
 * public/js/bi_autorizacoes.js
 * Módulo de Autorização de Desconto e Margem (BI Executivo)
 * Plataforma de Apoio GSI (Gemini-Cli)
 */

(function () {
  'use strict';

  let currentDealAnalise = null;
  let isSubmitting = false;
  let historicoCurrentPage = 1;
  const historicoLimit = 50;

  function getToken() {
    try {
      const rawSession = localStorage.getItem('conciliacao_fretes_session');
      if (rawSession) {
        const sess = JSON.parse(rawSession);
        if (sess && sess.token) return sess.token;
      }
      return localStorage.getItem('gsi_auth_token');
    } catch {
      return null;
    }
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

  function formatCurrency(val) {
    const num = parseFloat(val) || 0;
    return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function formatPct(val) {
    const num = parseFloat(val) || 0;
    return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
  }

  function formatDateTime(isoStr) {
    if (!isoStr) return '-';
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return isoStr;
    }
  }

  /**
   * Inicialização da Sub-Aba de Autorizações no BI Executivo
   */
  function initBIAutorizacoesTab() {
    setupEventListeners();
    carregarHistorico(1);
  }

  function setupEventListeners() {
    const form = document.getElementById('formBiAutorizacaoAnalise');
    if (form && !form._hasListener) {
      form._hasListener = true;
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        executarAnalise();
      });
    }

    const btnRefreshHist = document.getElementById('btnBiAutorizacoesRefreshHist');
    if (btnRefreshHist && !btnRefreshHist._hasListener) {
      btnRefreshHist._hasListener = true;
      btnRefreshHist.addEventListener('click', () => {
        carregarHistorico(1);
      });
    }

    const filtroStatus = document.getElementById('filtroBiAutorizacoesStatus');
    if (filtroStatus && !filtroStatus._hasListener) {
      filtroStatus._hasListener = true;
      filtroStatus.addEventListener('change', () => {
        carregarHistorico(1);
      });
    }

    const inputBusca = document.getElementById('inputBiAutorizacoesBusca');
    if (inputBusca && !inputBusca._hasListener) {
      inputBusca._hasListener = true;
      let timer = null;
      inputBusca.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          carregarHistorico(1);
        }, 400);
      });
    }

    // Botões do Modal de Decisão
    const btnAutorizar = document.getElementById('btnModalBiAutorizar');
    if (btnAutorizar && !btnAutorizar._hasListener) {
      btnAutorizar._hasListener = true;
      btnAutorizar.addEventListener('click', () => {
        confirmarEDecidir('AUTORIZADO');
      });
    }

    const btnNaoAutorizar = document.getElementById('btnModalBiNaoAutorizar');
    if (btnNaoAutorizar && !btnNaoAutorizar._hasListener) {
      btnNaoAutorizar._hasListener = true;
      btnNaoAutorizar.addEventListener('click', () => {
        confirmarEDecidir('NAO_AUTORIZADO');
      });
    }

    const btnFecharModal = document.getElementById('btnFecharModalBiAutorizacao');
    if (btnFecharModal && !btnFecharModal._hasListener) {
      btnFecharModal._hasListener = true;
      btnFecharModal.addEventListener('click', fecharModalAnalise);
    }
    const btnCloseX = document.getElementById('btnCloseModalBiAutorizacaoX');
    if (btnCloseX && !btnCloseX._hasListener) {
      btnCloseX._hasListener = true;
      btnCloseX.addEventListener('click', fecharModalAnalise);
    }
  }

  /**
   * Executa a análise prévia chamando o backend
   */
  async function executarAnalise() {
    const inputDeal = document.getElementById('inputBiDealId');
    const inputObs = document.getElementById('inputBiObservacoes');
    const inputProposta = document.getElementById('inputBiValorProposto');
    const btnSubmit = document.getElementById('btnBiAnalisarDeal');
    const alertBox = document.getElementById('alertBiAutorizacoes');

    if (!inputDeal || !inputDeal.value.trim()) {
      exibirAlerta('Informe o número do Deal ou a URL do Pipedrive.', 'warning');
      return;
    }

    const token = getToken();
    if (!token) {
      exibirAlerta('Sessão expirada. Faça login novamente no portal.', 'danger');
      return;
    }

    const dealInput = inputDeal.value.trim();
    const observacoes = inputObs ? inputObs.value.trim() : '';
    const proposta = inputProposta ? inputProposta.value.trim() : '';

    try {
      if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = '<span>⏳ Analisando no Protheus...</span>';
      }
      if (alertBox) alertBox.classList.add('hidden');

      let queryUrl = `/api/bi/autorizacoes/analisar?dealId=${encodeURIComponent(dealInput)}`;
      if (observacoes) queryUrl += `&observacoes=${encodeURIComponent(observacoes)}`;
      if (proposta) queryUrl += `&proposta=${encodeURIComponent(proposta)}`;

      const res = await fetch(queryUrl, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Falha ao analisar Deal.');
      }

      currentDealAnalise = data.deal;
      abrirModalAnalise(data.deal);
    } catch (err) {
      exibirAlerta(`Erro: ${err.message}`, 'danger');
    } finally {
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg><span>🔍 Analisar Deal</span>';
      }
    }
  }

  /**
   * Abre e preenche o modal visual de autorização de desconto
   */
  function abrirModalAnalise(deal) {
    const modal = document.getElementById('modalBiAutorizacaoDetalhes');
    if (!modal) return;

    // Cabeçalho
    const elTitulo = document.getElementById('modalBiDealTitulo');
    const elSolicitante = document.getElementById('modalBiSolicitante');
    const elCliente = document.getElementById('modalBiCliente');
    const elPagamento = document.getElementById('modalBiPagamento');
    const elFrete = document.getElementById('modalBiFreteEmbutido');
    const elBadgeRevenda = document.getElementById('modalBiBadgeRevenda');

    if (elTitulo) elTitulo.innerText = `Deal ${deal.dealId} — ${deal.clienteNome}`;
    if (elSolicitante) elSolicitante.innerText = deal.solicitanteNome || 'Vendedor';
    if (elCliente) elCliente.innerText = deal.clienteNome || '-';
    if (elPagamento) elPagamento.innerText = deal.condPgtoLabel || 'Não informada';
    if (elFrete) elFrete.innerText = formatCurrency(deal.freteEmbutido);

    if (elBadgeRevenda) {
      if (deal.isRevenda) {
        elBadgeRevenda.classList.remove('hidden');
        elBadgeRevenda.innerText = '🏢 Cliente Revenda Cadastrada (Desconto Esperado)';
      } else {
        elBadgeRevenda.classList.add('hidden');
      }
    }

    // Cards Principais
    const elValorVendido = document.getElementById('modalBiValorVendido');
    const elValorTabela = document.getElementById('modalBiValorTabela');
    const elDescontoPct = document.getElementById('modalBiDescontoPct');
    const elDescontoRs = document.getElementById('modalBiDescontoRs');
    const elMargemPct = document.getElementById('modalBiMargemPct');
    const elLucroBruto = document.getElementById('modalBiLucroBruto');

    if (elValorVendido) elValorVendido.innerText = formatCurrency(deal.valorVendaFinal);
    if (elValorTabela) elValorTabela.innerText = `Tabela: ${formatCurrency(deal.precoTabelaTotal)}`;

    if (elDescontoPct) {
      elDescontoPct.innerText = formatPct(deal.descontoPct);
      elDescontoPct.style.color = (deal.descontoPct > 11 && !deal.isRevenda) ? 'var(--danger-color, #ef4444)' : 'var(--success-color, #10b981)';
    }
    if (elDescontoRs) elDescontoRs.innerText = formatCurrency(deal.descontoReais);

    if (elMargemPct) {
      elMargemPct.innerText = formatPct(deal.margemPct);
      elMargemPct.style.color = (deal.margemPct < 40) ? 'var(--warning-color, #f59e0b)' : 'var(--success-color, #10b981)';
    }
    if (elLucroBruto) elLucroBruto.innerText = `Lucro: ${formatCurrency(deal.lucroBruto)}`;

    // Alerta de Desconto
    const elAlertaBox = document.getElementById('modalBiAlertaDescontoBox');
    if (elAlertaBox) {
      if (deal.isAlertaDesconto) {
        elAlertaBox.classList.remove('hidden');
      } else {
        elAlertaBox.classList.add('hidden');
      }
    }

    // Tabela de Itens
    const tbody = document.getElementById('modalBiTbodyItens');
    if (tbody) {
      tbody.innerHTML = '';
      (deal.itens || []).forEach(item => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--panel-border, #e2e8f0)';
        tr.innerHTML = `
          <td style="padding: 10px 14px;">
            <div style="font-weight: 600; color: var(--text-color);">${escapeHtml(item.descricaoProtheus || item.nomePipedrive)}</div>
            <div style="font-size: 0.78rem; color: var(--text-muted);">
              Cód Protheus: <code>${escapeHtml(item.protheusCode || 'NÃO CADASTRADO')}</code>
              ${!item.encontradoProtheus ? '<span style="color:#ef4444; font-weight:700;">(Não achado na SB1090)</span>' : ''}
            </div>
          </td>
          <td style="padding: 10px; text-align: center; font-weight: 600;">${item.quantidade}</td>
          <td style="padding: 10px; text-align: right;">${formatCurrency(item.precoUnitarioDeal)}</td>
          <td style="padding: 10px; text-align: right; color: var(--text-muted);">${formatCurrency(item.precoUnitarioTabela)}</td>
          <td style="padding: 10px; text-align: right; color: var(--text-muted);">${formatCurrency(item.custoUnitario)}</td>
          <td style="padding: 10px; text-align: right; font-weight: 700; color: var(--primary-color);">${formatCurrency(item.totalDeal)}</td>
        `;
        tbody.appendChild(tr);
      });
    }

    // Campo de Observações do Modal
    const modalObs = document.getElementById('modalBiInputObsDecisao');
    if (modalObs) {
      modalObs.value = deal.observacoesInput || '';
    }

    modal.classList.remove('hidden');
  }

  function fecharModalAnalise() {
    const modal = document.getElementById('modalBiAutorizacaoDetalhes');
    if (modal) modal.classList.add('hidden');
    currentDealAnalise = null;
  }

  /**
   * Confirma e despacha a decisão de autorização (AUTORIZADO / NAO_AUTORIZADO)
   */
  async function confirmarEDecidir(decisao) {
    if (!currentDealAnalise || isSubmitting) return;

    const token = getToken();
    if (!token) {
      alert('Sessão expirada. Faça login novamente.');
      return;
    }

    const modalObs = document.getElementById('modalBiInputObsDecisao');
    const observacoes = modalObs ? modalObs.value.trim() : '';

    const isAut = (decisao === 'AUTORIZADO');
    const msgConfirma = isAut
      ? `Confirmar a AUTORIZAÇÃO do desconto para o Deal ${currentDealAnalise.dealId}?\nUma nota auditável será fixada no Pipedrive.`
      : `Confirmar a NÃO AUTORIZAÇÃO do desconto para o Deal ${currentDealAnalise.dealId}?\nUma nota informando a recusa será fixada no Pipedrive.`;

    if (!confirm(msgConfirma)) return;

    const btnAut = document.getElementById('btnModalBiAutorizar');
    const btnNaoAut = document.getElementById('btnModalBiNaoAutorizar');

    try {
      isSubmitting = true;
      if (btnAut) btnAut.disabled = true;
      if (btnNaoAut) btnNaoAut.disabled = true;

      const res = await fetch('/api/bi/autorizacoes/decidir', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          dealId: currentDealAnalise.dealId,
          decisao: decisao,
          observacoes: observacoes,
          proposta: currentDealAnalise.isValorPropostoCustom ? currentDealAnalise.valorVendaFinal : null
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Falha ao registrar decisão.');
      }

      fecharModalAnalise();
      exibirAlerta(`✅ Decisão registrada com sucesso! Nota fixada no Deal ${currentDealAnalise.dealId}.`, 'success');

      // Limpa formulário
      const inputDeal = document.getElementById('inputBiDealId');
      const inputObs = document.getElementById('inputBiObservacoes');
      const inputProposta = document.getElementById('inputBiValorProposto');
      if (inputDeal) inputDeal.value = '';
      if (inputObs) inputObs.value = '';
      if (inputProposta) inputProposta.value = '';

      // Atualiza tabela de histórico
      carregarHistorico(1);
    } catch (err) {
      alert(`Erro ao registrar decisão: ${err.message}`);
    } finally {
      isSubmitting = false;
      if (btnAut) btnAut.disabled = false;
      if (btnNaoAut) btnNaoAut.disabled = false;
    }
  }

  /**
   * Consulta histórico paginado de autorizações
   */
  async function carregarHistorico(page = 1) {
    const token = getToken();
    if (!token) return;

    historicoCurrentPage = page;
    const filtroStatus = document.getElementById('filtroBiAutorizacoesStatus');
    const inputBusca = document.getElementById('inputBiAutorizacoesBusca');
    const tbody = document.getElementById('tbodyBiAutorizacoesHistorico');
    const pagInfo = document.getElementById('biAutorizacoesPaginacaoInfo');
    const btnPrev = document.getElementById('btnBiAutorizacoesPrev');
    const btnNext = document.getElementById('btnBiAutorizacoesNext');

    const status = filtroStatus ? filtroStatus.value : 'TODOS';
    const search = inputBusca ? inputBusca.value.trim() : '';

    try {
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding: 24px; color: var(--text-muted);">⏳ Carregando histórico de autorizações...</td></tr>`;
      }

      let url = `/api/bi/autorizacoes/historico?page=${page}&limit=${historicoLimit}&status=${encodeURIComponent(status)}`;
      if (search) url += `&search=${encodeURIComponent(search)}`;

      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Falha ao carregar histórico.');
      }

      renderizarHistorico(data.items || [], data.pagination || {});
    } catch (err) {
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding: 20px; color: var(--danger-color);">Erro ao carregar histórico: ${escapeHtml(err.message)}</td></tr>`;
      }
    }
  }

  function renderizarHistorico(items, pagination) {
    const tbody = document.getElementById('tbodyBiAutorizacoesHistorico');
    const pagInfo = document.getElementById('biAutorizacoesPaginacaoInfo');
    const btnPrev = document.getElementById('btnBiAutorizacoesPrev');
    const btnNext = document.getElementById('btnBiAutorizacoesNext');

    if (!tbody) return;

    if (!items || items.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding: 28px; color: var(--text-muted);">Nenhuma autorização de desconto registrada até o momento.</td></tr>`;
      if (pagInfo) pagInfo.innerText = 'Página 1 de 1 (0 registros)';
      if (btnPrev) btnPrev.disabled = true;
      if (btnNext) btnNext.disabled = true;
      return;
    }

    tbody.innerHTML = '';
    items.forEach(item => {
      const isAut = (item.status === 'AUTORIZADO');
      const badgeStatus = isAut
        ? `<span class="badge" style="background:#10b981; color:#fff; font-weight:700; padding:4px 8px; border-radius:6px;">AUTORIZADO</span>`
        : `<span class="badge" style="background:#ef4444; color:#fff; font-weight:700; padding:4px 8px; border-radius:6px;">NÃO AUTORIZADO</span>`;

      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--panel-border, #e2e8f0)';
      tr.innerHTML = `
        <td style="padding: 10px 12px; font-size: 0.82rem; color: var(--text-muted);">${formatDateTime(item.created_at)}</td>
        <td style="padding: 10px 12px; font-weight: 700;">
          <a href="https://benetroncomercial.pipedrive.com/deal/${item.deal_id}" target="_blank" rel="noopener noreferrer" style="color: var(--primary-color); text-decoration: underline;">
            Deal #${item.deal_id}
          </a>
        </td>
        <td style="padding: 10px 12px;">
          <div style="font-weight: 600; color: var(--text-color);">${escapeHtml(item.cliente_nome)}</div>
          <div style="font-size: 0.78rem; color: var(--text-muted);">Solicitante: ${escapeHtml(item.solicitante_nome || '-')}</div>
        </td>
        <td style="padding: 10px 12px; text-align: right; font-weight: 700;">${formatCurrency(item.valor_total)}</td>
        <td style="padding: 10px 12px; text-align: right; font-weight: 600; color: ${item.desconto_pct > 11 ? '#ef4444' : '#10b981'};">
          ${formatPct(item.desconto_pct)}
        </td>
        <td style="padding: 10px 12px; text-align: right; font-weight: 600; color: ${item.margem_pct < 40 ? '#f59e0b' : '#10b981'};">
          ${formatPct(item.margem_pct)}
        </td>
        <td style="padding: 10px 12px; font-size: 0.82rem;">
          <div><strong>${escapeHtml(item.cond_pagamento_label || '-')}</strong></div>
          <div style="font-size: 0.76rem; color: var(--text-muted);">Frete: ${formatCurrency(item.frete_embutido)} (${escapeHtml(item.tipo_frete || 'FOB')})</div>
        </td>
        <td style="padding: 10px 12px; text-align: center;">${badgeStatus}</td>
        <td style="padding: 10px 12px; font-size: 0.82rem; color: var(--text-muted);">
          <div>${escapeHtml(item.usuario_decisor_nome || item.usuario_decisor || '-')}</div>
          ${item.observacoes ? `<div style="font-size: 0.74rem; font-style: italic; color: var(--text-color);" title="${escapeHtml(item.observacoes)}">"${escapeHtml(item.observacoes.substring(0, 30))}${item.observacoes.length > 30 ? '...' : ''}"</div>` : ''}
        </td>
      `;
      tbody.appendChild(tr);
    });

    if (pagInfo) {
      pagInfo.innerText = `Página ${pagination.page || 1} de ${pagination.totalPages || 1} (${pagination.total || items.length} autorizações)`;
    }
    if (btnPrev) {
      btnPrev.disabled = !pagination.hasPrev;
      btnPrev.onclick = () => carregarHistorico(pagination.page - 1);
    }
    if (btnNext) {
      btnNext.disabled = !pagination.hasNext;
      btnNext.onclick = () => carregarHistorico(pagination.page + 1);
    }
  }

  function exibirAlerta(msg, tipo = 'info') {
    const alertBox = document.getElementById('alertBiAutorizacoes');
    if (!alertBox) return;

    alertBox.className = `alert alert-${tipo}`;
    alertBox.innerText = msg;
    alertBox.classList.remove('hidden');

    setTimeout(() => {
      alertBox.classList.add('hidden');
    }, 6000);
  }

  // Exportação global
  window.biAutorizacoesModule = {
    initBIAutorizacoesTab,
    executarAnalise,
    fecharModalAnalise,
    confirmarEDecidir,
    carregarHistorico
  };

  window.initBIAutorizacoesTab = initBIAutorizacoesTab;
})();
