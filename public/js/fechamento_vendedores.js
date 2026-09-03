/**
 * public/js/fechamento_vendedores.js
 * 
 * Módulo de Fechamento Comercial Mensal dos Vendedores e Gestão de Metas
 * Código 100% Desacoplado, Modular e Autônomo (IIFE)
 */

(function () {
  'use strict';

  let currentFechamento = null;
  let currentCiclo = null;
  let currentHistorico = [];
  let todosVendedoresCiclo = [];
  let isLoading = false;
  let confettiAnimationId = null;

  function getToken() {
    try {
      const rawSession = localStorage.getItem('conciliacao_fretes_session');
      if (rawSession) {
        const sess = JSON.parse(rawSession);
        if (sess && sess.token) return sess.token;
      }
      return localStorage.getItem('gsi_auth_token') ||
             localStorage.getItem('auth_token') ||
             localStorage.getItem('token') ||
             sessionStorage.getItem('auth_token') ||
             sessionStorage.getItem('token') ||
             (window.currentUser && window.currentUser.token) ||
             null;
    } catch {
      return localStorage.getItem('auth_token') || localStorage.getItem('token') || null;
    }
  }

  function getCurrentUser() {
    try {
      if (window.currentUser) return window.currentUser;
      const rawSession = localStorage.getItem('conciliacao_fretes_session');
      if (rawSession) {
        const sess = JSON.parse(rawSession);
        if (sess && sess.user) return sess.user;
      }
    } catch {}
    return null;
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

  // ─── ANIMAÇÃO LEVE DE CONFETES / SERPENTINA (MICRO-CANVAS PURO) ─────────────

  function dispararConfetesElegantes() {
    const canvas = document.getElementById('fechamentoConfettiCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Cancela animação anterior se estiver ativa
    if (confettiAnimationId) {
      cancelAnimationFrame(confettiAnimationId);
      confettiAnimationId = null;
    }

    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width || canvas.parentElement?.clientWidth || 800;
    canvas.height = 260;

    const colors = ['#f59e0b', '#fbbf24', '#10b981', '#38bdf8', '#8b5cf6', '#ec4899', '#ffffff'];
    const confettiCount = 55;
    const confettis = [];

    for (let i = 0; i < confettiCount; i++) {
      confettis.push({
        x: Math.random() * canvas.width,
        y: Math.random() * -canvas.height * 0.5,
        w: Math.random() * 8 + 4,
        h: Math.random() * 5 + 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        vx: (Math.random() - 0.5) * 3,
        vy: Math.random() * 2.5 + 2,
        rot: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 6,
        opacity: 1
      });
    }

    let startTime = performance.now();
    const duration = 3500; // 3.5 segundos

    function loop(now) {
      const elapsed = now - startTime;
      if (elapsed > duration) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        confettiAnimationId = null;
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const fadeRatio = elapsed > duration * 0.7 ? 1 - (elapsed - duration * 0.7) / (duration * 0.3) : 1;

      for (const c of confettis) {
        c.x += c.vx;
        c.y += c.vy;
        c.rot += c.rotSpeed;

        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate((c.rot * Math.PI) / 180);
        ctx.fillStyle = c.color;
        ctx.globalAlpha = Math.max(0, fadeRatio);
        ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
        ctx.restore();

        // Wrap around
        if (c.y > canvas.height) {
          c.y = -10;
          c.x = Math.random() * canvas.width;
        }
      }

      confettiAnimationId = requestAnimationFrame(loop);
    }

    confettiAnimationId = requestAnimationFrame(loop);
  }

  // ─── CONSUMO DE API ────────────────────────────────────────────────────────

  async function apiFetch(url, options = {}) {
    const token = getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401 || res.status === 403) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Sessão expirada ou não autorizada.');
    }
    return res;
  }

  async function carregarFechamentoAtual(codVend) {
    if (isLoading) return;
    isLoading = true;
    mostrarLoading(true);

    try {
      let qs = '';
      if (codVend) qs = `?codVend=${encodeURIComponent(codVend)}`;
      const res = await apiFetch(`/api/vendedores/fechamento/atual${qs}`);
      const json = await res.json();

      if (!json.success) {
        throw new Error(json.message || 'Erro ao obter fechamento atual.');
      }

      currentCiclo = json.ciclo;
      todosVendedoresCiclo = json.todosVendedores || json.fechamentos || [];

      // Se retornou fechamento único ou lista
      if (json.fechamento) {
        currentFechamento = json.fechamento;
      } else if (json.fechamentos && json.fechamentos.length > 0) {
        currentFechamento = json.fechamentos[0];
      }

      renderizarTelaCompleta();

      // Carrega histórico em background
      carregarHistoricoFechamentos();
    } catch (err) {
      mostrarErro(err.message || 'Erro de comunicação ao carregar fechamento.');
    } finally {
      isLoading = false;
      mostrarLoading(false);
    }
  }

  async function carregarHistoricoFechamentos() {
    try {
      const user = getCurrentUser();
      let qs = '';
      if (user && user.role === 'vendedor' && user.vendorCode) {
        qs = `?codVend=${encodeURIComponent(user.vendorCode)}`;
      }
      const res = await apiFetch(`/api/vendedores/fechamento/historico${qs}`);
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        currentHistorico = json.data;
        renderizarSelectHistorico();
      }
    } catch (e) {
      console.warn('⚠️ [Fechamento] Aviso ao carregar histórico:', e.message);
    }
  }

  async function carregarFechamentoPorCiclo(cicloId, codVend) {
    if (isLoading || !cicloId) return;
    isLoading = true;
    mostrarLoading(true);

    try {
      let qs = '';
      if (codVend) qs = `?codVend=${encodeURIComponent(codVend)}`;
      const res = await apiFetch(`/api/vendedores/fechamento/ciclo/${encodeURIComponent(cicloId)}${qs}`);
      const json = await res.json();

      if (!json.success) {
        throw new Error(json.message || 'Fechamento não localizado para este ciclo.');
      }

      todosVendedoresCiclo = json.todosVendedores || json.fechamentos || [];
      if (json.fechamento) {
        currentFechamento = json.fechamento;
      } else if (json.fechamentos && json.fechamentos.length > 0) {
        currentFechamento = json.fechamentos[0];
      }

      currentCiclo = {
        cicloId: cicloId,
        label: json.periodo?.label || currentFechamento?.periodo_label || currentFechamento?.periodoLabel || cicloId,
        dtIni: json.periodo?.dtIni || currentFechamento?.data_ini || currentFechamento?.dataIni,
        dtFim: json.periodo?.dtFim || currentFechamento?.data_fim || currentFechamento?.dataFim
      };

      renderizarTelaCompleta();
    } catch (err) {
      mostrarErro(err.message || 'Erro ao carregar fechamento do ciclo selecionado.');
    } finally {
      isLoading = false;
      mostrarLoading(false);
    }
  }

  async function forcarRecalculoFechamento() {
    if (isLoading) return;
    const btn = document.getElementById('btnRecalcularFechamento');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '⏳ Recalculando...';
    }
    isLoading = true;
    mostrarLoading(true);

    try {
      const selectVend = document.getElementById('fechamentoVendedorSelect');
      const codVend = selectVend ? selectVend.value : null;

      const res = await apiFetch('/api/vendedores/fechamento/gerar', {
        method: 'POST',
        body: JSON.stringify({
          dataIni: currentCiclo ? currentCiclo.dtIni : null,
          dataFim: currentCiclo ? currentCiclo.dtFim : null,
          codVend: codVend || undefined
        })
      });

      const json = await res.json();
      if (!json.success) {
        throw new Error(json.message || 'Erro ao recalcular fechamento.');
      }

      const resData = json.data;
      todosVendedoresCiclo = resData.fechamentos || resData.todosVendedores || [];
      if (resData.fechamento) {
        currentFechamento = resData.fechamento;
      } else if (todosVendedoresCiclo.length > 0) {
        currentFechamento = todosVendedoresCiclo[0];
      }

      renderizarTelaCompleta();
      alert('✅ Fechamento de todos os vendedores recalculado no ERP Protheus e consolidado com sucesso!');
    } catch (err) {
      mostrarErro(err.message || 'Falha ao recalcular fechamento.');
    } finally {
      isLoading = false;
      mostrarLoading(false);
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '🔄 Recalcular Fechamento';
      }
    }
  }

  // ─── RENDERIZAÇÃO DA INTERFACE ─────────────────────────────────────────────

  function renderizarTelaCompleta() {
    if (!currentFechamento) {
      mostrarEmptyState(true);
      return;
    }
    mostrarEmptyState(false);

    // 1. Header & Badges
    const badgeCiclo = document.getElementById('fechamentoBadgeCiclo');
    if (badgeCiclo) {
      const lbl = currentFechamento.periodo_label || currentFechamento.periodoLabel || currentCiclo?.label || '-';
      badgeCiclo.textContent = `📅 Fechamento Oficial: ${lbl}`;
    }

    const badgeTipo = document.getElementById('fechamentoBadgeTipo');
    if (badgeTipo) {
      const tipo = currentFechamento.tipo_geracao || currentFechamento.tipoGeracao || 'JOB_AUTO';
      badgeTipo.textContent = tipo === 'JOB_AUTO' ? '🤖 Gerado Automaticamente' : '⚡ Consolidado sob Demanda';
      badgeTipo.className = tipo === 'JOB_AUTO' ? 'badge-auto' : 'badge-manual';
    }

    // 2. Seletor de Vendedor
    renderizarSelectVendedores();

    // 3. Hero Card Gamificado (Troféu, Metas e Prêmios)
    renderizarHeroCardGamificado();

    // 4. Quatro Stat Cards Principais
    renderizarStatCards();

    // 5. Faturamento por Empresa
    renderizarFaturamentoEmpresas();

    // 6. Benchmarking da Equipe
    renderizarBenchmarking();

    // 7. Extrato & Tabela Detalhada
    renderizarExtratoDetalhado();
  }

  function renderizarSelectVendedores() {
    const container = document.getElementById('fechamentoVendedorWrapper');
    const select = document.getElementById('fechamentoVendedorSelect');
    if (!select) return;

    const user = getCurrentUser();
    if (user && user.role === 'vendedor') {
      if (container) container.style.display = 'none'; // Vendedor só vê o próprio
      return;
    }
    if (container) container.style.display = 'flex';

    const curVend = currentFechamento ? (currentFechamento.cod_vendedor || currentFechamento.codVendedor) : '';

    const defaultVendedores = [
      { cod_vendedor: '000004', nome_vendedor: 'Figueiredo' },
      { cod_vendedor: '000064', nome_vendedor: 'Andrea' },
      { cod_vendedor: '000074', nome_vendedor: 'Juliana' }
    ];

    const lista = (todosVendedoresCiclo && todosVendedoresCiclo.length > 0) ? todosVendedoresCiclo : defaultVendedores;

    select.innerHTML = '';
    lista.forEach(v => {
      const opt = document.createElement('option');
      const vCode = v.cod_vendedor || v.codVendedor || v.cod;
      const vName = v.nome_vendedor || v.nomeVendedor || v.nome || vCode;
      opt.value = vCode;
      opt.textContent = `${vName} (${vCode})`;
      if (vCode === curVend) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function gerarCiclosPredefinidosClient(qtd = 12) {
    const pad = (n) => String(n).padStart(2, '0');
    const now = new Date();
    const ano = now.getFullYear();
    const mes = now.getMonth();
    const dia = now.getDate();
    const hora = now.getHours();
    const minuto = now.getMinutes();

    const isAposFechamentoDia26 = (dia > 26) || (dia === 26 && (hora > 0 || minuto >= 30));
    let endYear = ano;
    let endMonth = isAposFechamentoDia26 ? mes : mes - 1;

    const ciclos = [];
    for (let offset = 0; offset < qtd; offset++) {
      const dIni = new Date(endYear, endMonth - offset - 1, 26);
      const dFim = new Date(endYear, endMonth - offset, 25);

      const sYear = dIni.getFullYear();
      const sMonth = dIni.getMonth() + 1;
      const eYear = dFim.getFullYear();
      const eMonth = dFim.getMonth() + 1;

      const dataIniIso = `${sYear}-${pad(sMonth)}-26`;
      const dataFimIso = `${eYear}-${pad(eMonth)}-25`;
      const dataIniBR = `26/${pad(sMonth)}/${sYear}`;
      const dataFimBR = `25/${pad(eMonth)}/${eYear}`;
      const cicloId = `${dataIniIso}_${dataFimIso}`;
      const label = `${dataIniBR} a ${dataFimBR}`;

      ciclos.push({
        ciclo_id: cicloId,
        cicloId: cicloId,
        periodo_label: label,
        periodoLabel: label,
        data_ini: dataIniIso,
        data_fim: dataFimIso,
        isAtual: offset === 0,
        offset: offset
      });
    }
    return ciclos;
  }

  function renderizarSelectHistorico() {
    const select = document.getElementById('fechamentoHistoricoSelect');
    if (!select) return;

    let lista = currentHistorico;
    if (!lista || lista.length === 0) {
      lista = gerarCiclosPredefinidosClient(12);
    }

    const currentCicloId = currentFechamento ? (currentFechamento.ciclo_id || currentFechamento.cicloId) : (currentCiclo ? currentCiclo.cicloId : '');

    select.innerHTML = '';
    lista.forEach((h, idx) => {
      const opt = document.createElement('option');
      const cId = h.ciclo_id || h.cicloId;
      opt.value = cId;

      let prefix = '';
      if (h.isAtual || idx === 0) {
        prefix = '📌 Ciclo Atual:';
      } else if (h.offset === 1 || idx === 1) {
        prefix = '⏮️ Mês Anterior:';
      } else {
        prefix = '⏮️ Ciclo:';
      }

      opt.textContent = `${prefix} ${h.periodo_label || h.periodoLabel}`;
      if (currentCicloId && currentCicloId === cId) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });
  }

  function renderizarHeroCardGamificado() {
    const f = currentFechamento;
    if (!f) return;

    const vBaseLiq = parseFloat(f.vendas_base_liquida ?? f.vendasBaseLiquida ?? 0);
    const metaValor = parseFloat(f.meta_vendas_valor ?? f.metaVendasValor ?? 120000);
    const pctVendas = metaValor > 0 ? (vBaseLiq / metaValor) * 100 : 0;
    const premioVendas = parseFloat(f.premio_meta_vendas ?? f.premioMetaVendas ?? 0);

    const gorduraTotal = parseFloat(f.gordura_frete_total ?? f.gorduraFreteTotal ?? 0);
    const premioGordura = parseFloat(f.premio_gordura_frete ?? f.premioGorduraFrete ?? 0);

    const totalPremios = parseFloat(f.total_premios ?? f.totalPremios ?? (premioVendas + premioGordura));
    const elegivelGordura = pctVendas >= 85.0;

    // Elementos do Topo
    const elTrofeuTitle = document.getElementById('fechamentoTrofeuTitle');
    const elTrofeuSub = document.getElementById('fechamentoTrofeuSub');
    const elBadgePremioVendas = document.getElementById('fechamentoBadgePremioVendas');
    const elBadgePremioFrete = document.getElementById('fechamentoBadgePremioFrete');
    const elTotalReceberDestaque = document.getElementById('fechamentoTotalReceberDestaque') || document.getElementById('fechamentoTotalPremiosDestaque');
    const elTotalReceberSub = document.getElementById('fechamentoTotalReceberSub');

    const bateuVendas = pctVendas >= 100.0 && vBaseLiq > 0;
    const bateuFrete = gorduraTotal >= 700.0 && elegivelGordura;
    const temConquista = bateuVendas || bateuFrete;

    if (elTrofeuTitle) {
      elTrofeuTitle.textContent = 'Fechamento do Período';
      elTrofeuTitle.style.color = temConquista ? '#fbbf24' : '#38bdf8';
    }
    if (elTrofeuSub) {
      const nomeV = f.nome_vendedor || f.nomeVendedor || 'Vendedor';
      if (temConquista) {
        elTrofeuSub.textContent = `Parabéns, ${nomeV}! Você conquistou premiações no ciclo oficial. Confira seu extrato abaixo.`;
      } else {
        elTrofeuSub.textContent = `${nomeV}, acompanhe suas vendas líquidas, metas e comissões consolidadas do ciclo.`;
      }
    }

    if (elBadgePremioVendas) {
      if (premioVendas > 0) {
        elBadgePremioVendas.innerHTML = `🎁 Prêmio Vendas: <strong>${formatCurrency(premioVendas)}</strong> (${formatPct(pctVendas)})`;
        elBadgePremioVendas.className = 'conquista-badge-ativa';
      } else {
        elBadgePremioVendas.innerHTML = `🎁 Prêmio Vendas: <strong>${formatCurrency(0)}</strong> (${formatPct(pctVendas)})`;
        elBadgePremioVendas.className = 'conquista-badge-inativa';
      }
    }

    if (elBadgePremioFrete) {
      if (premioGordura > 0) {
        elBadgePremioFrete.innerHTML = `🚚 Prêmio Gordura Frete: <strong>${formatCurrency(premioGordura)}</strong>`;
        elBadgePremioFrete.className = 'conquista-badge-ativa';
      } else if (f.gordura_status === 'BLOQUEADO_META_VENDAS' || f.gorduraStatus === 'BLOQUEADO_META_VENDAS' || (!elegivelGordura && gorduraTotal >= 700)) {
        elBadgePremioFrete.innerHTML = `🚚 Prêmio Gordura Frete: <strong>${formatCurrency(0)}</strong> <span style="font-size: 0.72rem; color: #fca5a5; margin-left: 4px;">(Bloqueado: Vendas ${formatPct(pctVendas)} &lt; 85%)</span>`;
        elBadgePremioFrete.className = 'conquista-badge-inativa';
      } else {
        elBadgePremioFrete.innerHTML = `🚚 Prêmio Gordura Frete: <strong>${formatCurrency(0)}</strong>`;
        elBadgePremioFrete.className = 'conquista-badge-inativa';
      }
    }

    // Destaque Topo Direito: TOTAL GERAL A RECEBER (Amarelo)
    const comBruta = parseFloat(f.comissao_bruta ?? f.comissaoBruta ?? (vBaseLiq * 0.013));
    const inadimplentes = parseFloat(f.inadimplentes_total ?? f.inadimplentesTotal ?? 0);
    const comLiquida = parseFloat(f.comissao_liquida ?? f.comissaoLiquida ?? Math.max(0, comBruta - inadimplentes));
    const totalGeral = parseFloat(f.total_geral_receber ?? f.totalGeralReceber ?? (comLiquida + totalPremios));

    if (elTotalReceberDestaque) {
      elTotalReceberDestaque.textContent = formatCurrency(totalGeral);
    }
    if (elTotalReceberSub) {
      elTotalReceberSub.textContent = `Comissão Líq: ${formatCurrency(comLiquida)} + Prêmios: ${formatCurrency(totalPremios)}`;
    }

    // ─── CARD 1: META DE VENDAS (0 a 1ª Faixa = 100% da Meta Base R$ 120k) ──
    const cardVendas = document.getElementById('fechamentoCardVendas');
    const iconVendas = document.getElementById('fechamentoVendasIcon');
    const labelVendas = document.getElementById('fechamentoProgressLabelVendas');
    const subVendas = document.getElementById('fechamentoVendasSub');
    const barVendas = document.getElementById('fechamentoProgressBarVendas');
    const reguaVendas = document.getElementById('fechamentoVendasReguaFim');
    const footVendas = document.getElementById('fechamentoVendasStatusFoot');

    // Calibração: 0 a 100% da Meta Base (R$ 120k). Ao bater 100%, preenche 100% da barra!
    const pctBarVendas = vBaseLiq <= 0 ? 0 : Math.min(100, Math.max(0, (vBaseLiq / metaValor) * 100));

    if (barVendas) {
      barVendas.style.width = `${pctBarVendas}%`;
      if (bateuVendas) {
        barVendas.style.background = 'linear-gradient(90deg, #38bdf8 0%, #10b981 100%)';
      } else {
        barVendas.style.background = 'linear-gradient(90deg, #f59e0b 0%, #38bdf8 100%)';
      }
    }

    if (iconVendas) {
      if (bateuVendas) {
        iconVendas.textContent = '🏆';
        iconVendas.style.animation = 'pulseTrofeu 2s infinite ease-in-out';
      } else {
        iconVendas.textContent = '😞';
        iconVendas.style.animation = 'none';
      }
    }

    if (cardVendas) {
      cardVendas.classList.remove('card-atingido', 'card-nao-atingido');
      cardVendas.classList.add(bateuVendas ? 'card-atingido' : 'card-nao-atingido');
    }

    if (labelVendas) {
      if (bateuVendas) {
        labelVendas.textContent = `${formatPct(pctVendas)} Batida! 🎯`;
        labelVendas.style.color = '#10b981';
      } else {
        labelVendas.textContent = `${formatPct(pctVendas)} Atingida`;
        labelVendas.style.color = '#38bdf8';
      }
    }

    if (subVendas) {
      subVendas.textContent = `${formatCurrency(vBaseLiq)} / ${formatCurrency(metaValor)}`;
    }

    if (reguaVendas) {
      reguaVendas.textContent = `100% Meta Base (${formatCurrency(metaValor)}) ${bateuVendas ? '✓' : ''}`;
    }

    if (footVendas) {
      if (pctVendas >= 200) {
        footVendas.innerHTML = `<span style="color: #10b981;">🎉 Nível Lendário (200%) Atingido!</span> <strong style="color: #fbbf24;">+${formatCurrency(premioVendas)}</strong>`;
      } else if (pctVendas >= 150) {
        const falta200 = Math.max(0, (metaValor * 2.0) - vBaseLiq);
        footVendas.innerHTML = `<span style="color: #10b981;">🚀 Nível Ouro (150%) Batido!</span> <strong style="color: #10b981;">+${formatCurrency(premioVendas)}</strong> <span style="font-size: 0.68rem; color: var(--text-muted);">(Faltam ${formatCurrency(falta200)} p/ 200%)</span>`;
      } else if (pctVendas >= 100) {
        const falta150 = Math.max(0, (metaValor * 1.5) - vBaseLiq);
        footVendas.innerHTML = `<span style="color: #10b981;">✓ Meta Batida!</span> <strong style="color: #10b981;">+${formatCurrency(premioVendas)}</strong> <span style="font-size: 0.68rem; color: var(--text-muted);">(Faltam ${formatCurrency(falta150)} p/ 150%)</span>`;
      } else if (vBaseLiq > 0) {
        const faltaMeta = Math.max(0, metaValor - vBaseLiq);
        footVendas.innerHTML = `<span style="color: #f59e0b;">⚠️ Faltam ${formatCurrency(faltaMeta)} para atingir a meta</span>`;
      } else {
        footVendas.innerHTML = `<span style="color: #ef4444;">⚠️ Nenhuma venda líquida no período</span>`;
      }
    }

    // ─── CARD 2: META DE GORDURA DE FRETE (0 a 1ª Faixa = R$ 700,00) ─────────
    const cardFrete = document.getElementById('fechamentoCardFrete');
    const iconFrete = document.getElementById('fechamentoFreteIcon');
    const labelFrete = document.getElementById('fechamentoProgressLabelFrete');
    const subFrete = document.getElementById('fechamentoFreteSub');
    const barFrete = document.getElementById('fechamentoProgressBarFrete');
    const reguaFrete = document.getElementById('fechamentoFreteReguaFim');
    const footFrete = document.getElementById('fechamentoFreteStatusFoot');

    // Calibração: 0 a 1ª Faixa da Gordura (R$ 700,00). R$ 700 preenche 100% da barra!
    const pctBarFrete = gorduraTotal <= 0 ? 0 : Math.min(100, Math.max(0, (gorduraTotal / 700) * 100));

    if (barFrete) {
      barFrete.style.width = `${pctBarFrete}%`;
      if (bateuFrete) {
        barFrete.style.background = 'linear-gradient(90deg, #10b981 0%, #fbbf24 100%)';
      } else if (!elegivelGordura && gorduraTotal >= 700) {
        barFrete.style.background = 'linear-gradient(90deg, #ef4444 0%, #f59e0b 100%)';
      } else {
        barFrete.style.background = 'linear-gradient(90deg, #38bdf8 0%, #10b981 100%)';
      }
    }

    if (iconFrete) {
      if (bateuFrete) {
        iconFrete.textContent = '🏆';
        iconFrete.style.animation = 'pulseTrofeu 2s infinite ease-in-out';
      } else {
        iconFrete.textContent = '😞';
        iconFrete.style.animation = 'none';
      }
    }

    if (cardFrete) {
      cardFrete.classList.remove('card-atingido', 'card-nao-atingido');
      cardFrete.classList.add(bateuFrete ? 'card-atingido' : 'card-nao-atingido');
    }

    if (labelFrete) {
      if (gorduraTotal > 0) {
        labelFrete.textContent = `Superávit: ${formatCurrency(gorduraTotal)}`;
        labelFrete.style.color = bateuFrete ? '#10b981' : '#f8fafc';
      } else {
        labelFrete.textContent = `Déficit: ${formatCurrency(gorduraTotal)}`;
        labelFrete.style.color = '#ef4444';
      }
    }

    if (subFrete) {
      if (!elegivelGordura && gorduraTotal >= 700) {
        subFrete.innerHTML = `<span style="color: #ef4444; font-weight: 600;">Bloqueado: Vendas ${formatPct(pctVendas)} &lt; 85%</span>`;
      } else {
        subFrete.textContent = `1ª Faixa da Meta: R$ 700,00 (Gatilho ≥ 85% Vendas)`;
      }
    }

    if (reguaFrete) {
      reguaFrete.textContent = `1ª Faixa (${formatCurrency(700)} - Prêmio R$ 200) ${bateuFrete ? '✓' : ''}`;
    }

    if (footFrete) {
      if (!elegivelGordura && gorduraTotal >= 700) {
        footFrete.innerHTML = `<span style="color: #ef4444;">Bloqueado: Meta de vendas &lt; 85%</span>`;
      } else if (bateuFrete) {
        if (gorduraTotal >= 3000) {
          footFrete.innerHTML = `<span style="color: #10b981;">✓ Nível 5 (Máx) Batido!</span> <strong style="color: #fbbf24;">+${formatCurrency(premioGordura)}</strong>`;
        } else if (gorduraTotal >= 2100) {
          const f3000 = 3000 - gorduraTotal;
          footFrete.innerHTML = `<span style="color: #10b981;">✓ Nível 4 Batido!</span> <strong style="color: #10b981;">+${formatCurrency(premioGordura)}</strong> <span style="font-size: 0.68rem; color: var(--text-muted);">(Falta ${formatCurrency(f3000)} p/ N5)</span>`;
        } else if (gorduraTotal >= 1500) {
          const f2100 = 2100 - gorduraTotal;
          footFrete.innerHTML = `<span style="color: #10b981;">✓ Nível 3 Batido!</span> <strong style="color: #10b981;">+${formatCurrency(premioGordura)}</strong> <span style="font-size: 0.68rem; color: var(--text-muted);">(Falta ${formatCurrency(f2100)} p/ N4)</span>`;
        } else if (gorduraTotal >= 1100) {
          const f1500 = 1500 - gorduraTotal;
          footFrete.innerHTML = `<span style="color: #10b981;">✓ Nível 2 Batido!</span> <strong style="color: #10b981;">+${formatCurrency(premioGordura)}</strong> <span style="font-size: 0.68rem; color: var(--text-muted);">(Falta ${formatCurrency(f1500)} p/ N3)</span>`;
        } else {
          const f1100 = 1100 - gorduraTotal;
          footFrete.innerHTML = `<span style="color: #10b981;">✓ 1ª Faixa Batida!</span> <strong style="color: #10b981;">+${formatCurrency(premioGordura)}</strong> <span style="font-size: 0.68rem; color: var(--text-muted);">(Falta ${formatCurrency(f1100)} p/ N2)</span>`;
        }
      } else if (gorduraTotal > 0) {
        const falta700 = Math.max(0, 700 - gorduraTotal);
        footFrete.innerHTML = `<span style="color: #f59e0b;">⚠️ Falta apenas ${formatCurrency(falta700)} para a 1ª faixa</span>`;
      } else {
        footFrete.innerHTML = `<span style="color: #ef4444;">⚠️ Déficit ou sem gordura de frete</span>`;
      }
    }

    // ─── CARD 3: DESEMPENHO / RANKING DA EQUIPE ──────────────────────────────
    const cardRanking = document.getElementById('fechamentoCardRanking');
    const numRanking = document.getElementById('fechamentoRankingNumero');
    const titRanking = document.getElementById('fechamentoRankingTitulo');
    const subRanking = document.getElementById('fechamentoRankingSub');
    const mediaValRanking = document.getElementById('fechamentoRankingMediaVal');
    const diffBadgeRanking = document.getElementById('fechamentoRankingDiffBadge');
    const footRanking = document.getElementById('fechamentoRankingStatusFoot');

    const listaVendedores = (todosVendedoresCiclo && todosVendedoresCiclo.length > 0)
      ? [...todosVendedoresCiclo]
      : [f];

    listaVendedores.sort((a, b) => {
      const vA = parseFloat(a.vendas_base_liquida ?? a.vendasBaseLiquida ?? 0);
      const vB = parseFloat(b.vendas_base_liquida ?? b.vendasBaseLiquida ?? 0);
      return vB - vA;
    });

    const curCod = String(f.cod_vendedor || f.codVendedor || '').trim();
    const rankIdx = listaVendedores.findIndex(x => {
      const c = String(x.cod_vendedor || x.codVendedor || '').trim();
      return c === curCod || c === curCod.padStart(6, '0') || curCod === c.padStart(6, '0');
    });
    const posicao = rankIdx >= 0 ? rankIdx + 1 : 1;

    if (numRanking) {
      numRanking.textContent = posicao;
      numRanking.className = '';
      if (posicao === 1) {
        numRanking.className = 'ranking-num-ouro';
      } else if (posicao === 2) {
        numRanking.className = 'ranking-num-prata';
      } else if (posicao === 3) {
        numRanking.className = 'ranking-num-bronze';
      } else {
        numRanking.className = 'ranking-num-neutro';
      }
    }

    if (titRanking) {
      if (posicao === 1) {
        titRanking.textContent = '1º Lugar da Equipe 🥇';
        titRanking.style.color = '#fbbf24';
      } else if (posicao === 2) {
        titRanking.textContent = '2º Lugar da Equipe 🥈';
        titRanking.style.color = '#e2e8f0';
      } else if (posicao === 3) {
        titRanking.textContent = '3º Lugar da Equipe 🥉';
        titRanking.style.color = '#f97316';
      } else {
        titRanking.textContent = `${posicao}º Lugar da Equipe`;
        titRanking.style.color = '#94a3b8';
      }
    }

    if (subRanking) {
      if (posicao === 1) {
        subRanking.textContent = 'Líder em Vendas Líquidas no período';
      } else if (posicao === 2) {
        subRanking.textContent = 'Vice-líder em Vendas Líquidas';
      } else if (posicao === 3) {
        subRanking.textContent = '3ª posição no ranking da equipe';
      } else {
        subRanking.textContent = `${posicao}ª posição na equipe`;
      }
    }

    // Média de Vendas da Equipe
    const bench = f?.benchmarking_json || f?.benchmarking || {};
    let mediaVendas = parseFloat(bench.mediaVendasEquipe || 0);
    if (!mediaVendas && listaVendedores.length > 0) {
      const totalSoma = listaVendedores.reduce((acc, x) => acc + parseFloat(x.vendas_base_liquida ?? x.vendasBaseLiquida ?? 0), 0);
      mediaVendas = totalSoma / listaVendedores.length;
    }

    const diffVendas = mediaVendas > 0 ? ((vBaseLiq - mediaVendas) / mediaVendas) * 100 : 0;

    if (mediaValRanking) {
      mediaValRanking.textContent = formatCurrency(mediaVendas);
    }

    if (diffBadgeRanking) {
      if (diffVendas >= 0) {
        diffBadgeRanking.className = 'bench-badge-pos';
        diffBadgeRanking.textContent = `▲ +${diffVendas.toFixed(2)}%`;
      } else {
        diffBadgeRanking.className = 'bench-badge-neg';
        diffBadgeRanking.textContent = `▼ ${diffVendas.toFixed(2)}%`;
      }
    }

    if (footRanking) {
      const totalVend = listaVendedores.length;
      if (posicao === 1) {
        footRanking.innerHTML = `<span style="color: #fbbf24;">🏆 Top 1! Parabéns pela liderança no período.</span>`;
      } else if (posicao === 2) {
        footRanking.innerHTML = `<span style="color: #e2e8f0;">🥈 No pódio! Excelente ritmo de vendas (${posicao}/${totalVend}).</span>`;
      } else if (posicao === 3) {
        footRanking.innerHTML = `<span style="color: #f97316;">🥉 No pódio! Continue acelerando (${posicao}/${totalVend}).</span>`;
      } else {
        footRanking.innerHTML = `<span style="color: var(--text-muted);">Ranking apurado entre ${totalVend} vendedores.</span>`;
      }
    }

    // Dispara animação suave de confetes se bateu metas
    if (temConquista) {
      setTimeout(dispararConfetesElegantes, 150);
    }
  }

  function renderizarStatCards() {
    const f = currentFechamento;
    if (!f) return;

    const vBruta = parseFloat(f.vendas_base_bruta ?? f.vendasBaseBruta ?? 0);
    const freteEmb = parseFloat(f.fretes_embutidos ?? f.fretesEmbutidos ?? 0);
    const vLiquida = parseFloat(f.vendas_base_liquida ?? f.vendasBaseLiquida ?? 0);

    const comBruta = parseFloat(f.comissao_bruta ?? f.comissaoBruta ?? (vLiquida * 0.013));
    const inadimplentes = parseFloat(f.inadimplentes_total ?? f.inadimplentesTotal ?? 0);
    const comLiquida = parseFloat(f.comissao_liquida ?? f.comissaoLiquida ?? Math.max(0, comBruta - inadimplentes));

    const gorduraTotal = parseFloat(f.gordura_frete_total ?? f.gorduraFreteTotal ?? 0);
    const premioFrete = parseFloat(f.premio_gordura_frete ?? f.premioGorduraFrete ?? 0);
    const premioVendas = parseFloat(f.premio_meta_vendas ?? f.premioMetaVendas ?? 0);
    const totalPremios = parseFloat(f.total_premios ?? f.totalPremios ?? (premioVendas + premioFrete));

    // Card 1: Vendas Líquidas
    const elVendaLiq = document.getElementById('cardFechamentoVendaLiquida');
    const elVendaSub = document.getElementById('cardFechamentoVendaSub');
    if (elVendaLiq) elVendaLiq.textContent = formatCurrency(vLiquida);
    if (elVendaSub) elVendaSub.innerHTML = `Base: ${formatCurrency(vBruta)} | <span style="color: #ef4444;">(-) Frete Emb: ${formatCurrency(freteEmb)}</span>`;

    // Card 2: Comissões R$ (1,3%)
    const elComisLiq = document.getElementById('cardFechamentoComissaoLiquida');
    const elComisSub = document.getElementById('cardFechamentoComissaoSub');
    if (elComisLiq) elComisLiq.textContent = formatCurrency(comLiquida);
    if (elComisSub) elComisSub.innerHTML = `Bruta (1,3%): ${formatCurrency(comBruta)} | <span style="color: #ef4444;">(-) Inadimpl: ${formatCurrency(inadimplentes)}</span>`;

    // Card 3: Gordura de Frete
    const elGorduraVal = document.getElementById('cardFechamentoGorduraVal');
    const elGorduraSub = document.getElementById('cardFechamentoGorduraSub');
    if (elGorduraVal) {
      elGorduraVal.textContent = formatCurrency(gorduraTotal);
      elGorduraVal.style.color = gorduraTotal > 0 ? '#10b981' : (gorduraTotal < 0 ? '#ef4444' : 'inherit');
    }
    if (elGorduraSub) {
      if (premioFrete > 0) {
        elGorduraSub.innerHTML = `Prêmio de Frete: <strong style="color: #10b981;">${formatCurrency(premioFrete)}</strong>`;
      } else if (f.gordura_status === 'BLOQUEADO_META_VENDAS' || f.gorduraStatus === 'BLOQUEADO_META_VENDAS') {
        elGorduraSub.innerHTML = `Prêmio de Frete: <strong style="color: #ef4444;">${formatCurrency(0)}</strong> <span style="color: #ef4444; font-size: 0.72rem;">(Bloqueado: Vendas &lt; 85%)</span>`;
      } else {
        elGorduraSub.innerHTML = `Prêmio de Frete: <strong style="color: #94a3b8;">${formatCurrency(0)}</strong>`;
      }
    }

    // Card 4: Total Premiações (Verde)
    const elTotalPremiosCard = document.getElementById('cardFechamentoTotalPremios') || document.getElementById('cardFechamentoTotalGeral');
    const elTotalPremiosSub = document.getElementById('cardFechamentoTotalPremiosSub') || document.getElementById('cardFechamentoTotalGeralSub');
    if (elTotalPremiosCard) elTotalPremiosCard.textContent = formatCurrency(totalPremios);
    if (elTotalPremiosSub) {
      elTotalPremiosSub.innerHTML = `Metas Vendas: ${formatCurrency(premioVendas)} + Frete: ${formatCurrency(premioFrete)}`;
    }
  }

  function renderizarFaturamentoEmpresas() {
    const f = currentFechamento;
    const fat = f?.faturamento_empresas_json || f?.faturamentoEmpresas || {};

    const elGsi = document.getElementById('fatEmpresaGsi');
    const elOaco = document.getElementById('fatEmpresaOaco');
    const elMp = document.getElementById('fatEmpresaMp');
    const elTotal = document.getElementById('fatEmpresaTotal');

    if (elGsi) elGsi.textContent = formatCurrency(fat.GSI || 0);
    if (elOaco) elOaco.textContent = formatCurrency(fat.OACO || 0);
    if (elMp) elMp.textContent = formatCurrency(fat.METAL_PLENO || 0);
    if (elTotal) elTotal.textContent = formatCurrency(fat.TOTAL || 0);
  }

  function renderizarBenchmarking() {
    const f = currentFechamento;
    const bench = f?.benchmarking_json || f?.benchmarking || {};

    const elBenchVendas = document.getElementById('benchVendasDiff');
    const elBenchVendasMedia = document.getElementById('benchVendasMedia');
    const elBenchFrete = document.getElementById('benchFreteDiff');
    const elBenchFreteMedia = document.getElementById('benchFreteMedia');

    if (elBenchVendas) {
      const diff = parseFloat(bench.diffVendasPct || 0);
      const isPos = diff >= 0;
      elBenchVendas.innerHTML = `<span class="${isPos ? 'bench-badge-pos' : 'bench-badge-neg'}">${isPos ? '▲ +' : '▼ '}${formatPct(diff)}</span>`;
    }
    if (elBenchVendasMedia) {
      elBenchVendasMedia.textContent = `Média da Equipe: ${formatCurrency(bench.mediaVendasEquipe || 0)}`;
    }

    if (elBenchFrete) {
      const diffF = parseFloat(bench.diffGorduraPct || 0);
      const isPosF = diffF >= 0;
      elBenchFrete.innerHTML = `<span class="${isPosF ? 'bench-badge-pos' : 'bench-badge-neg'}">${isPosF ? '▲ +' : '▼ '}${formatPct(diffF)}</span>`;
    }
    if (elBenchFreteMedia) {
      elBenchFreteMedia.textContent = `Média da Equipe: ${formatCurrency(bench.mediaGorduraEquipe || 0)}`;
    }
  }

  function renderizarExtratoDetalhado() {
    const f = currentFechamento;
    const tbody = document.getElementById('fechamentoExtratoTableBody');
    if (!tbody || !f) return;

    tbody.innerHTML = '';

    const vBruta = parseFloat(f.vendas_base_bruta ?? f.vendasBaseBruta ?? 0);
    const freteEmb = parseFloat(f.fretes_embutidos ?? f.fretesEmbutidos ?? 0);
    const vLiquida = parseFloat(f.vendas_base_liquida ?? f.vendasBaseLiquida ?? 0);
    const comBruta = parseFloat(f.comissao_bruta ?? f.comissaoBruta ?? 0);
    const inadimplentes = parseFloat(f.inadimplentes_total ?? f.inadimplentesTotal ?? 0);
    const comLiquida = parseFloat(f.comissao_liquida ?? f.comissaoLiquida ?? 0);
    const premioVendas = parseFloat(f.premio_meta_vendas ?? f.premioMetaVendas ?? 0);
    const gorduraTotal = parseFloat(f.gordura_frete_total ?? f.gorduraFreteTotal ?? 0);
    const premioFrete = parseFloat(f.premio_gordura_frete ?? f.premioGorduraFrete ?? 0);
    const totalGeral = parseFloat(f.total_geral_receber ?? f.totalGeralReceber ?? 0);

    const linhas = [
      { item: '1. Vendas Base Faturadas (SE3)', regra: 'Soma de E3_BASE das 3 empresas', valor: formatCurrency(vBruta), tipo: 'pos' },
      { item: '2. (-) Dedução de Fretes Embutidos (SC5)', regra: 'Soma de C5_VLR_FRT faturados no período', valor: `- ${formatCurrency(freteEmb)}`, tipo: 'neg' },
      { item: '3. (=) Base Líquida de Vendas', regra: 'Item 1 - Item 2 (Base de Metas e Comissões)', valor: formatCurrency(vLiquida), tipo: 'destaque' },
      { item: '4. Comissão Comercial Bruta (1,3%)', regra: 'Item 3 x 0,013 (1,3%)', valor: formatCurrency(comBruta), tipo: 'pos' },
      { item: '5. (-) Dedução de Inadimplentes (SE1)', regra: 'Títulos em aberto vencidos até o fechamento', valor: `- ${formatCurrency(inadimplentes)}`, tipo: 'neg' },
      { item: '6. (=) Comissão Comercial Líquida', regra: 'max(0, Item 4 - Item 5)', valor: formatCurrency(comLiquida), tipo: 'destaque' },
      { item: '7. (+) Premiação de Meta de Vendas', regra: f.faixa_meta_vendas || f.faixaMetaVendas || 'Meta Vendas', valor: `+ ${formatCurrency(premioVendas)}`, tipo: premioVendas > 0 ? 'bonus' : 'neutro' },
      { item: '8. (+) Premiação de Gordura de Frete', regra: `Gordura Líquida: ${formatCurrency(gorduraTotal)} (${f.faixa_gordura_frete || f.faixaGorduraFrete || 'Frete'})`, valor: `+ ${formatCurrency(premioFrete)}`, tipo: premioFrete > 0 ? 'bonus' : 'neutro' },
      { item: '⭐ TOTAL GERAL A RECEBER NO FECHAMENTO', regra: 'Comissão Líquida (Item 6) + Prêmios (Itens 7 e 8)', valor: formatCurrency(totalGeral), tipo: 'total' }
    ];

    linhas.forEach(l => {
      const tr = document.createElement('tr');
      if (l.tipo === 'total') {
        tr.style.background = 'rgba(16, 185, 129, 0.12)';
        tr.style.fontWeight = '700';
      }
      tr.innerHTML = `
        <td style="padding: 10px 14px; font-weight: ${l.tipo === 'total' || l.tipo === 'destaque' ? '700' : '500'};">${escapeHtml(l.item)}</td>
        <td style="padding: 10px 14px; color: var(--text-muted); font-size: 0.82rem;">${escapeHtml(l.regra)}</td>
        <td style="padding: 10px 14px; text-align: right; font-weight: 700; color: ${l.tipo === 'neg' ? '#ef4444' : (l.tipo === 'bonus' || l.tipo === 'total' ? '#10b981' : 'inherit')}; font-size: ${l.tipo === 'total' ? '1.05rem' : '0.9rem'};">${escapeHtml(l.valor)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function mostrarLoading(show) {
    const el = document.getElementById('fechamentoLoading');
    const content = document.getElementById('fechamentoMainContent');
    if (el) el.classList.toggle('hidden', !show);
    if (content) content.classList.toggle('hidden', show);
  }

  function mostrarEmptyState(show) {
    const el = document.getElementById('fechamentoEmptyState');
    const content = document.getElementById('fechamentoMainContent');
    if (el) el.classList.toggle('hidden', !show);
    if (content) content.classList.toggle('hidden', show);
  }

  function mostrarErro(msg) {
    const errBox = document.getElementById('fechamentoErrorBox');
    if (errBox) {
      errBox.textContent = `❌ ${msg}`;
      errBox.classList.remove('hidden');
      setTimeout(() => errBox.classList.add('hidden'), 8000);
    } else {
      alert(`❌ ${msg}`);
    }
  }

  // ─── ABA DE CONFIGURAÇÃO DE METAS (8 CAMPOS) ────────────────────────────────

  async function carregarConfigMetasUI() {
    try {
      const res = await apiFetch('/api/config/metas-vendas');
      const json = await res.json();
      if (json.success && json.data) {
        preencherFormConfigMetas(json.data);
      }
    } catch (err) {
      console.warn('⚠️ [ConfigMetas] Erro ao carregar configurações de metas:', err.message);
    }
  }

  function preencherFormConfigMetas(cfg) {
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = parseFloat(val || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    set('cfgMetaBaseVendas', cfg.metaBaseVendas ?? 120000);
    set('cfgPremioMeta100', cfg.premioMeta100 ?? 400);
    set('cfgPremioMeta150', cfg.premioMeta150 ?? 600);
    set('cfgPremioMeta200', cfg.premioMeta200 ?? 1000);

    set('cfgPremioGordura700', cfg.premioGordura700 ?? 200);
    set('cfgPremioGordura1100', cfg.premioGordura1100 ?? 300);
    set('cfgPremioGordura1500', cfg.premioGordura1500 ?? 400);
    set('cfgPremioGordura2100', cfg.premioGordura2100 ?? 500);
    set('cfgPremioGordura3000', cfg.premioGordura3000 ?? 600);
  }

  async function salvarConfigMetasUI() {
    const parse = (id, def) => {
      const el = document.getElementById(id);
      if (!el) return def;
      const clean = el.value.replace(/\./g, '').replace(',', '.');
      const n = parseFloat(clean);
      return isNaN(n) ? def : n;
    };

    const payload = {
      metaBaseVendas: parse('cfgMetaBaseVendas', 120000),
      premioMeta100: parse('cfgPremioMeta100', 400),
      premioMeta150: parse('cfgPremioMeta150', 600),
      premioMeta200: parse('cfgPremioMeta200', 1000),
      premioGordura700: parse('cfgPremioGordura700', 200),
      premioGordura1100: parse('cfgPremioGordura1100', 300),
      premioGordura1500: parse('cfgPremioGordura1500', 400),
      premioGordura2100: parse('cfgPremioGordura2100', 500),
      premioGordura3000: parse('cfgPremioGordura3000', 600)
    };

    const btn = document.getElementById('btnSalvarConfigMetas');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '💾 Salvando...';
    }

    try {
      const res = await apiFetch('/api/config/metas-vendas', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || 'Erro ao salvar metas.');

      alert('✅ Parâmetros de Metas e Premiações salvos com sucesso!');
      preencherFormConfigMetas(json.data);
    } catch (err) {
      alert(`❌ ${err.message || 'Falha ao salvar configurações de metas.'}`);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '💾 Salvar Configurações de Metas';
      }
    }
  }

  function restaurarPadroesMetasUI() {
    if (!confirm('Deseja restaurar os valores padrão de metas (Base R$ 120k / Prêmios oficiais)?')) return;
    preencherFormConfigMetas({
      metaBaseVendas: 120000,
      premioMeta100: 400,
      premioMeta150: 600,
      premioMeta200: 1000,
      premioGordura700: 200,
      premioGordura1100: 300,
      premioGordura1500: 400,
      premioGordura2100: 500,
      premioGordura3000: 600
    });
  }

  // ─── INICIALIZAÇÃO & EVENT LISTENERS ───────────────────────────────────────

  function setupEventListeners() {
    // 1. Mudança de Vendedor
    const selectVend = document.getElementById('fechamentoVendedorSelect');
    if (selectVend) {
      selectVend.addEventListener('change', (e) => {
        const vCode = e.target.value;
        const cicloId = currentCiclo ? currentCiclo.cicloId : null;
        if (cicloId) {
          carregarFechamentoPorCiclo(cicloId, vCode);
        } else {
          carregarFechamentoAtual(vCode);
        }
      });
    }

    // 2. Mudança de Ciclo no Histórico
    const selectHist = document.getElementById('fechamentoHistoricoSelect');
    if (selectHist) {
      selectHist.addEventListener('change', (e) => {
        const cicloId = e.target.value;
        const curVend = selectVend ? selectVend.value : null;
        if (!cicloId) {
          carregarFechamentoAtual(curVend);
        } else {
          carregarFechamentoPorCiclo(cicloId, curVend);
        }
      });
    }

    // 3. Botão Recalcular / Forçar Fechamento
    const btnRecalc = document.getElementById('btnRecalcularFechamento');
    if (btnRecalc) {
      btnRecalc.addEventListener('click', forcarRecalculoFechamento);
    }

    // 4. Botão Imprimir / Exportar Ficha
    const btnPrint = document.getElementById('btnImprimirFechamento');
    if (btnPrint) {
      btnPrint.addEventListener('click', () => window.print());
    }

    // 5. Configuração de Metas (Aba Configurações)
    const btnSalvarMetas = document.getElementById('btnSalvarConfigMetas');
    if (btnSalvarMetas) {
      btnSalvarMetas.addEventListener('click', salvarConfigMetasUI);
    }

    const btnRestaurarMetas = document.getElementById('btnRestaurarConfigMetas');
    if (btnRestaurarMetas) {
      btnRestaurarMetas.addEventListener('click', restaurarPadroesMetasUI);
    }

    // Dispara carregamento ao clicar na aba Fechamento
    const tabBtnFechamento = document.getElementById('btnTabVendFechamento');
    if (tabBtnFechamento) {
      tabBtnFechamento.addEventListener('click', () => {
        if (!currentFechamento) {
          carregarFechamentoAtual();
        }
      });
    }

    // Dispara carregamento ao clicar na aba Config Metas
    const tabBtnConfigMetas = document.getElementById('btnTabConfigMetasVendas');
    if (tabBtnConfigMetas) {
      tabBtnConfigMetas.addEventListener('click', carregarConfigMetasUI);
    }

    // Renderiza o select de histórico imediatamente com os ciclos padrão
    renderizarSelectHistorico();
  }

  // Inicializa quando o DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setupEventListeners();
    });
  } else {
    setupEventListeners();
  }

  // Exporta métodos globais se necessário
  window.FechamentoVendedoresModule = {
    carregarFechamentoAtual,
    carregarFechamentoPorCiclo,
    forcarRecalculoFechamento,
    carregarConfigMetasUI,
    salvarConfigMetasUI
  };

})();
