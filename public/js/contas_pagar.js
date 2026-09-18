/**
 * contas_pagar.js
 * 
 * Módulo Frontend Isolado: Consulta de Contas a Pagar (SE2 / SE5 / SA2010)
 * Aba: 📑 ANALISTA FIN -> 💳 Contas a Pagar (#tab-contas-pagar)
 * 
 * Responsável por:
 * 1. Pesquisa multi-empresa unificada (14 Metal Pleno, 15 GSI Cofres, 16 OAÇO)
 * 2. Suporte a busca por Cód. Fornecedor, Nome/Razão Social, CNPJ ou Número do Título
 * 3. Classificação precisa de Situação:
 *    - Aberto (Pendente)
 *    - Baixa Parcial (com saldo e valor baixado)
 *    - Quitado (Financeiro - Débito/Normal com Banco preenchido)
 *    - Quitado (Compensação / Sem Movimento - Adiantamento PA, Devolução, Acordo)
 * 4. Cards de KPIs executivos (Total Títulos, Valor Original R$, Saldo Aberto R$, Total Baixado R$)
 * 5. Paginação no servidor com seletor de itens por página (25, 50, 100)
 * 6. Modal Rico de Detalhes com histórico de baixas e movimentações bancárias (SE5)
 * 7. Suporte a tema Claro e Escuro
 */

(function () {
  'use strict';

  let _initialized = false;
  let isSearching = false;
  let currentPage = 1;
  let currentLimit = 50;
  let titulosCache = [];
  let currentSummary = null;

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
    const num = Number(val) || 0;
    return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  const ContasPagarModule = {
    init: function () {
      if (!_initialized) {
        this.bindEvents();
        _initialized = true;
        // Executa busca inicial se ainda não houver dados
        if (titulosCache.length === 0) {
          this.executarBusca(1);
        }
      }
      this.sincronizarTemaModal();
    },

    bindEvents: function () {
      const btnBuscar = document.getElementById('btnBuscarContasPagar');
      const btnLimpar = document.getElementById('btnLimparContasPagar');
      const btnToggleAvancado = document.getElementById('btnToggleFiltrosAvancadosCP');
      const inputTermo = document.getElementById('searchContasPagarTermo');
      const selectEmpresa = document.getElementById('filterContasPagarEmpresa');
      const selectSituacao = document.getElementById('filterContasPagarSituacao');
      const selectPageSize = document.getElementById('selectContasPagarPageSize');

      // Botão Buscar
      if (btnBuscar) {
        btnBuscar.addEventListener('click', () => this.executarBusca(1));
      }

      // Botão Limpar
      if (btnLimpar) {
        btnLimpar.addEventListener('click', () => this.limparFiltros());
      }

      // Toggle Filtros Avançados
      if (btnToggleAvancado) {
        btnToggleAvancado.addEventListener('click', () => {
          const painelAvancado = document.getElementById('painelFiltrosAvancadosCP');
          if (painelAvancado) {
            const isHidden = painelAvancado.classList.contains('hidden');
            painelAvancado.classList.toggle('hidden', !isHidden);
            btnToggleAvancado.innerHTML = isHidden
              ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"></polyline></svg> Menos Filtros'
              : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg> Mais Filtros';
          }
        });
      }

      // Atalho Enter nos inputs
      const inputs = [
        inputTermo,
        document.getElementById('searchContasPagarNumTitulo'),
        document.getElementById('searchContasPagarCodFornec'),
        document.getElementById('searchContasPagarNomeFornec'),
        document.getElementById('searchContasPagarCnpjFornec'),
        document.getElementById('searchContasPagarDataVencIni'),
        document.getElementById('searchContasPagarDataVencFim')
      ];

      inputs.forEach(input => {
        if (input) {
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              this.executarBusca(1);
            }
          });
        }
      });

      // Mudança de filtros rápidos
      if (selectEmpresa) {
        selectEmpresa.addEventListener('change', () => this.executarBusca(1));
      }
      if (selectSituacao) {
        selectSituacao.addEventListener('change', () => this.executarBusca(1));
      }
      if (selectPageSize) {
        selectPageSize.addEventListener('change', (e) => {
          currentLimit = parseInt(e.target.value, 10) || 50;
          this.executarBusca(1);
        });
      }

      // Fechar modal ao clicar no botão fechar ou fora
      const modal = document.getElementById('modalDetalhesTituloContasPagar');
      const btnFecharModal = document.getElementById('btnFecharModalDetalhesCP');
      if (btnFecharModal) {
        btnFecharModal.addEventListener('click', () => this.fecharModalDetalhes());
      }
      if (modal) {
        modal.addEventListener('click', (e) => {
          if (e.target === modal) this.fecharModalDetalhes();
        });
      }

      // Tecla ESC para fechar modal
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
          this.fecharModalDetalhes();
        }
      });
    },

    limparFiltros: function () {
      const ids = [
        'searchContasPagarTermo',
        'searchContasPagarNumTitulo',
        'searchContasPagarCodFornec',
        'searchContasPagarNomeFornec',
        'searchContasPagarCnpjFornec',
        'searchContasPagarDataVencIni',
        'searchContasPagarDataVencFim'
      ];
      ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });

      const selEmp = document.getElementById('filterContasPagarEmpresa');
      if (selEmp) selEmp.value = 'TODAS';

      const selSit = document.getElementById('filterContasPagarSituacao');
      if (selSit) selSit.value = 'TODAS';

      this.executarBusca(1);
    },

    executarBusca: async function (pagina = 1) {
      if (isSearching) return;
      isSearching = true;
      currentPage = pagina;

      const btnBuscar = document.getElementById('btnBuscarContasPagar');
      const tableBody = document.getElementById('tbodyContasPagar');
      const containerEmpty = document.getElementById('contasPagarEmptyState');
      const containerLoading = document.getElementById('contasPagarLoadingState');

      if (btnBuscar) {
        btnBuscar.disabled = true;
        btnBuscar.innerHTML = '<span class="spinner" style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.8s linear infinite;vertical-align:middle;margin-right:6px;"></span> Buscando...';
      }

      if (tableBody) tableBody.innerHTML = '';
      if (containerEmpty) containerEmpty.classList.add('hidden');
      if (containerLoading) containerLoading.classList.remove('hidden');

      // Extrai valores dos filtros
      const termo = document.getElementById('searchContasPagarTermo')?.value.trim() || '';
      const empresa = document.getElementById('filterContasPagarEmpresa')?.value || 'TODAS';
      const situacao = document.getElementById('filterContasPagarSituacao')?.value || 'TODAS';
      const numTitulo = document.getElementById('searchContasPagarNumTitulo')?.value.trim() || '';
      const codFornec = document.getElementById('searchContasPagarCodFornec')?.value.trim() || '';
      const nomeFornec = document.getElementById('searchContasPagarNomeFornec')?.value.trim() || '';
      const cnpjFornec = document.getElementById('searchContasPagarCnpjFornec')?.value.trim() || '';
      const dataVencIni = document.getElementById('searchContasPagarDataVencIni')?.value || '';
      const dataVencFim = document.getElementById('searchContasPagarDataVencFim')?.value || '';

      const params = new URLSearchParams({
        termo,
        empresa,
        situacao,
        numTitulo,
        codFornec,
        nomeFornec,
        cnpjFornec,
        dataVencIni,
        dataVencFim,
        page: currentPage,
        pageSize: currentLimit
      });

      try {
        const token = localStorage.getItem('token') || '';
        const res = await fetch(`/api/analista-fin/contas-pagar?${params.toString()}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Erro HTTP ${res.status}`);
        }

        const data = await res.json();
        titulosCache = data.items || [];
        currentSummary = data.summary || {};

        this.atualizarKpis(currentSummary);
        this.renderizarTabela(titulosCache);
        this.renderizarPaginacao(data.pagination);

      } catch (err) {
        console.error('Erro ao consultar Contas a Pagar:', err);
        if (tableBody) {
          tableBody.innerHTML = `
            <tr>
              <td colspan="12" style="text-align: center; padding: 2.5rem 1rem; color: var(--danger, #ef4444);">
                <div style="font-size: 1.5rem; margin-bottom: 0.5rem;">⚠️</div>
                <strong>Falha ao consultar Contas a Pagar:</strong><br>
                <span style="font-size: 0.85rem; color: var(--text-muted);">${escapeHtml(err.message)}</span>
              </td>
            </tr>
          `;
        }
      } finally {
        isSearching = false;
        if (containerLoading) containerLoading.classList.add('hidden');
        if (btnBuscar) {
          btnBuscar.disabled = false;
          btnBuscar.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg> Buscar';
        }
      }
    },

    atualizarKpis: function (summary) {
      if (!summary) return;
      const elQtd = document.getElementById('kpiContasPagarTotalQtd');
      const elVlr = document.getElementById('kpiContasPagarTotalValor');
      const elSld = document.getElementById('kpiContasPagarTotalSaldo');
      const elBx = document.getElementById('kpiContasPagarTotalBaixado');

      if (elQtd) elQtd.textContent = (summary.totalRegistros || 0).toLocaleString('pt-BR');
      if (elVlr) elVlr.textContent = formatCurrency(summary.totalValor || 0);
      if (elSld) elSld.textContent = formatCurrency(summary.totalSaldo || 0);
      if (elBx) elBx.textContent = formatCurrency(summary.totalBaixado || 0);
    },

    renderizarTabela: function (items) {
      const tableBody = document.getElementById('tbodyContasPagar');
      const containerEmpty = document.getElementById('contasPagarEmptyState');
      if (!tableBody) return;

      if (!items || items.length === 0) {
        tableBody.innerHTML = '';
        if (containerEmpty) containerEmpty.classList.remove('hidden');
        return;
      }

      if (containerEmpty) containerEmpty.classList.add('hidden');

      const htmlRows = items.map((item, index) => {
        // Tag da empresa
        let empresaBadge = '';
        if (item.empresaCod === '14') {
          empresaBadge = '<span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #3b82f6; border: 1px solid rgba(59, 130, 246, 0.3);">14 MP</span>';
        } else if (item.empresaCod === '15') {
          empresaBadge = '<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);">15 GSI</span>';
        } else if (item.empresaCod === '16') {
          empresaBadge = '<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3);">16 OAÇO</span>';
        } else {
          empresaBadge = `<span class="badge">${escapeHtml(item.empresaSigla || item.empresaCod)}</span>`;
        }

        // Situação e Badge
        const sit = item.situacao || {};
        let sitBadge = '';
        if (sit.codigo === 'QUITADO_FIN') {
          sitBadge = `
            <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); display: inline-flex; align-items: center; gap: 4px;" title="${escapeHtml(sit.descricaoBaixa || 'Quitado via Banco')}">
              <span>🟢</span> <strong>Quitado (Fin.)</strong>
            </span>
          `;
        } else if (sit.codigo === 'QUITADO_CMP') {
          sitBadge = `
            <span class="badge" style="background: rgba(139, 92, 246, 0.15); color: #a855f7; border: 1px solid rgba(139, 92, 246, 0.3); display: inline-flex; align-items: center; gap: 4px;" title="${escapeHtml(sit.descricaoBaixa || 'Compensação de Adiantamento / Carteira')}">
              <span>🟣</span> <strong>Compensação</strong>
            </span>
          `;
        } else if (sit.codigo === 'QUITADO_LEG') {
          sitBadge = `
            <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); display: inline-flex; align-items: center; gap: 4px;" title="${escapeHtml(sit.descricaoBaixa || 'Liquidado')}">
              <span>🟢</span> <strong>Quitado</strong>
            </span>
          `;
        } else if (sit.codigo === 'BAIXA_PARCIAL') {
          sitBadge = `
            <span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); display: inline-flex; align-items: center; gap: 4px;" title="Saldo Pendente: ${formatCurrency(item.saldo)}">
              <span>🟡</span> <strong>Parcial</strong>
            </span>
          `;
        } else {
          sitBadge = `
            <span class="badge" style="background: rgba(100, 116, 139, 0.15); color: var(--text-muted); border: 1px solid rgba(100, 116, 139, 0.3); display: inline-flex; align-items: center; gap: 4px;">
              <span>⚪</span> <strong>Em Aberto</strong>
            </span>
          `;
        }

        // Título e Parcela
        const numTitFormatado = `${escapeHtml(item.numTitulo)}${item.parcela ? ` / ${escapeHtml(item.parcela)}` : ''}`;

        return `
          <tr class="cp-row" data-index="${index}" style="border-bottom: 1px solid var(--border-color, #e2e8f0); transition: background-color 0.15s ease;">
            <td style="padding: 0.65rem 0.75rem; text-align: center;">${empresaBadge}</td>
            <td style="padding: 0.65rem 0.75rem; font-weight: 500; font-family: monospace;">${escapeHtml(item.dataVencBr || '-')}</td>
            <td style="padding: 0.65rem 0.75rem; text-align: center;"><span class="badge" style="font-size: 0.75rem; opacity: 0.85;">${escapeHtml(item.tipo || 'NF')}</span></td>
            <td style="padding: 0.65rem 0.75rem; font-family: monospace; font-weight: 600; color: var(--primary, #2563eb);">${numTitFormatado}</td>
            <td style="padding: 0.65rem 0.75rem; font-family: monospace; color: var(--text-muted);">${escapeHtml(item.codFornecedor || '-')}</td>
            <td style="padding: 0.65rem 0.75rem; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(item.nomeFornecedor)}">
              <strong>${escapeHtml(item.nomeFornecedor || '-')}</strong>
            </td>
            <td style="padding: 0.65rem 0.75rem; font-family: monospace; font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(item.cnpjFornecedor || '-')}</td>
            <td style="padding: 0.65rem 0.75rem; text-align: right; font-weight: 600;">${formatCurrency(item.valorOriginal)}</td>
            <td style="padding: 0.65rem 0.75rem; text-align: right; font-weight: 600; color: ${item.saldo > 0 ? 'var(--danger, #ef4444)' : 'var(--text-muted)'};">${formatCurrency(item.saldo)}</td>
            <td style="padding: 0.65rem 0.75rem; text-align: center;">${sitBadge}</td>
            <td style="padding: 0.65rem 0.75rem; text-align: center; font-family: monospace; font-size: 0.85rem; color: var(--text-muted);">${escapeHtml(item.dataBaixaBr || '-')}</td>
            <td style="padding: 0.65rem 0.75rem; text-align: center;">
              <button class="btn btn-sm btn-outline btn-ver-detalhes-cp" data-index="${index}" style="padding: 0.25rem 0.6rem; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 4px;" title="Ver Detalhes e Movimentações SE5">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                Detalhes
              </button>
            </td>
          </tr>
        `;
      }).join('');

      tableBody.innerHTML = htmlRows;

      // Eventos dos botões de detalhes
      const btnsDetalhes = tableBody.querySelectorAll('.btn-ver-detalhes-cp');
      btnsDetalhes.forEach(btn => {
        btn.addEventListener('click', (e) => {
          const idx = parseInt(btn.getAttribute('data-index'), 10);
          if (!isNaN(idx) && titulosCache[idx]) {
            this.abrirModalDetalhes(titulosCache[idx]);
          }
        });
      });
    },

    renderizarPaginacao: function (pagination) {
      const containerPaginacao = document.getElementById('contasPagarPaginationContainer');
      const infoPaginacao = document.getElementById('contasPagarPaginationInfo');
      const botoesContainer = document.getElementById('contasPagarPaginationButtons');
      if (!containerPaginacao || !pagination) return;

      const { page, limit, total, totalPages, hasNext, hasPrev } = pagination;

      if (total === 0) {
        containerPaginacao.classList.add('hidden');
        return;
      }
      containerPaginacao.classList.remove('hidden');

      const startItem = (page - 1) * limit + 1;
      const endItem = Math.min(page * limit, total);
      if (infoPaginacao) {
        infoPaginacao.innerHTML = `Exibindo <strong>${startItem}</strong> a <strong>${endItem}</strong> de <strong>${total.toLocaleString('pt-BR')}</strong> títulos`;
      }

      if (botoesContainer) {
        let btnHtml = '';

        // Botão Primeira
        btnHtml += `
          <button class="btn btn-sm btn-outline" ${!hasPrev ? 'disabled' : ''} data-page="1" title="Primeira Página">
            ««
          </button>
          <button class="btn btn-sm btn-outline" ${!hasPrev ? 'disabled' : ''} data-page="${page - 1}" title="Página Anterior">
            «
          </button>
        `;

        // Janela de páginas
        const delta = 2;
        const rangeStart = Math.max(1, page - delta);
        const rangeEnd = Math.min(totalPages, page + delta);

        for (let p = rangeStart; p <= rangeEnd; p++) {
          const isActive = (p === page);
          btnHtml += `
            <button class="btn btn-sm ${isActive ? 'btn-primary active' : 'btn-outline'}" data-page="${p}" style="${isActive ? 'font-weight: bold;' : ''}">
              ${p}
            </button>
          `;
        }

        // Botão Próxima e Última
        btnHtml += `
          <button class="btn btn-sm btn-outline" ${!hasNext ? 'disabled' : ''} data-page="${page + 1}" title="Próxima Página">
            »
          </button>
          <button class="btn btn-sm btn-outline" ${!hasNext ? 'disabled' : ''} data-page="${totalPages}" title="Última Página">
            »»
          </button>
        `;

        botoesContainer.innerHTML = btnHtml;

        // Eventos dos botões de página
        botoesContainer.querySelectorAll('button[data-page]').forEach(btn => {
          btn.addEventListener('click', () => {
            const p = parseInt(btn.getAttribute('data-page'), 10);
            if (!isNaN(p) && p !== currentPage && p >= 1 && p <= totalPages) {
              this.executarBusca(p);
            }
          });
        });
      }
    },

    abrirModalDetalhes: async function (item) {
      const modal = document.getElementById('modalDetalhesTituloContasPagar');
      if (!modal || !item) return;

      // Preenchimento dos dados do título
      const elNum = document.getElementById('modalCpNumTitulo');
      const elEmpresa = document.getElementById('modalCpEmpresa');
      const elSit = document.getElementById('modalCpSituacao');
      const elFornec = document.getElementById('modalCpFornecedor');
      const elCnpj = document.getElementById('modalCpCnpj');
      const elEmissao = document.getElementById('modalCpEmissao');
      const elVenc = document.getElementById('modalCpVencimento');
      const elValor = document.getElementById('modalCpValor');
      const elSaldo = document.getElementById('modalCpSaldo');
      const elBaixado = document.getElementById('modalCpBaixado');
      const elDataBaixa = document.getElementById('modalCpDataBaixa');
      const elHistorico = document.getElementById('modalCpHistorico');
      const tbodyMovs = document.getElementById('tbodyMovimentacoesSE5');
      const loadingMovs = document.getElementById('loadingMovimentacoesSE5');
      const emptyMovs = document.getElementById('emptyMovimentacoesSE5');

      if (elNum) elNum.textContent = `${item.numTitulo}${item.parcela ? ` (Parcela ${item.parcela})` : ''} - Tipo ${item.tipo || 'NF'}`;
      if (elEmpresa) elEmpresa.textContent = `${item.empresaNome} (${item.empresaSigla} / Filial ${item.filial || '01'})`;
      if (elFornec) elFornec.textContent = `[${item.codFornecedor}] ${item.nomeFornecedor}`;
      if (elCnpj) elCnpj.textContent = item.cnpjFornecedor || '-';
      if (elEmissao) elEmissao.textContent = item.dataEmissaoBr || '-';
      if (elVenc) elVenc.textContent = item.dataVencBr || '-';
      if (elValor) elValor.textContent = formatCurrency(item.valorOriginal);
      if (elSaldo) elSaldo.textContent = formatCurrency(item.saldo);
      if (elBaixado) elBaixado.textContent = formatCurrency(item.valorBaixado);
      if (elDataBaixa) elDataBaixa.textContent = item.dataBaixaBr || '-';
      if (elHistorico) elHistorico.textContent = item.historicoTitulo || 'Nenhum histórico registrado no título.';

      if (elSit) {
        const sit = item.situacao || {};
        if (sit.codigo === 'QUITADO_FIN') {
          elSit.innerHTML = '<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981;">🟢 Quitado (Movimentação Financeira)</span>';
        } else if (sit.codigo === 'QUITADO_CMP') {
          elSit.innerHTML = '<span class="badge" style="background: rgba(139, 92, 246, 0.15); color: #a855f7;">🟣 Quitado por Compensação / Sem Movimento</span>';
        } else if (sit.codigo === 'QUITADO_LEG') {
          elSit.innerHTML = '<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981;">🟢 Quitado (Liquidado)</span>';
        } else if (sit.codigo === 'BAIXA_PARCIAL') {
          elSit.innerHTML = '<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b;">🟡 Baixa Parcial</span>';
        } else {
          elSit.innerHTML = '<span class="badge" style="background: rgba(100, 116, 139, 0.15); color: var(--text-muted);">⚪ Em Aberto</span>';
        }
      }

      // Exibe modal e estado de carregamento
      modal.classList.remove('hidden');
      if (tbodyMovs) tbodyMovs.innerHTML = '';
      if (emptyMovs) emptyMovs.classList.add('hidden');
      if (loadingMovs) loadingMovs.classList.remove('hidden');

      // Busca movimentações na SE5
      try {
        const token = localStorage.getItem('token') || '';
        const params = new URLSearchParams({
          empresa: item.empresaCod,
          filial: item.filial || '',
          prefixo: item.prefixo || '',
          num: item.numTitulo,
          parcela: item.parcela || '',
          tipo: item.tipo || '',
          fornece: item.codFornecedor
        });

        const res = await fetch(`/api/analista-fin/contas-pagar/movimentacoes?${params.toString()}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!res.ok) throw new Error('Erro ao buscar movimentações na SE5');
        const data = await res.json();
        const movs = data.movimentacoes || [];

        if (loadingMovs) loadingMovs.classList.add('hidden');

        if (movs.length === 0) {
          if (emptyMovs) emptyMovs.classList.remove('hidden');
        } else {
          if (tbodyMovs) {
            tbodyMovs.innerHTML = movs.map(m => {
              const badgeTipoMov = m.isMovimentoFinanceiro
                ? '<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; font-size: 0.75rem;">🟢 Financeiro</span>'
                : '<span class="badge" style="background: rgba(139, 92, 246, 0.15); color: #a855f7; font-size: 0.75rem;">🟣 Compensação</span>';

              const bcoInfo = m.banco ? `Bco ${escapeHtml(m.banco)}${m.agencia ? ` / Ag ${escapeHtml(m.agencia)}` : ''}` : '-';

              return `
                <tr style="border-bottom: 1px solid var(--border-color, #e2e8f0);">
                  <td style="padding: 0.6rem; font-family: monospace;">${escapeHtml(m.dataBr || '-')}</td>
                  <td style="padding: 0.6rem; font-weight: 600; text-align: right;">${formatCurrency(m.valor)}</td>
                  <td style="padding: 0.6rem;">
                    <strong>${escapeHtml(m.descricaoMotivo || m.motivo || 'Normal')}</strong>
                    <div style="font-size: 0.75rem; color: var(--text-muted);">Motivo: ${escapeHtml(m.motivo || '-')} | Tipo Doc: ${escapeHtml(m.tipoDoc || '-')}</div>
                  </td>
                  <td style="padding: 0.6rem; text-align: center;">${badgeTipoMov}</td>
                  <td style="padding: 0.6rem; font-family: monospace; font-size: 0.8rem; text-align: center;">${bcoInfo}</td>
                  <td style="padding: 0.6rem; font-size: 0.85rem; color: var(--text-muted);">${escapeHtml(m.historico || '-')}</td>
                </tr>
              `;
            }).join('');
          }
        }
      } catch (err) {
        console.error('Erro ao buscar movimentações SE5:', err);
        if (loadingMovs) loadingMovs.classList.add('hidden');
        if (tbodyMovs) {
          tbodyMovs.innerHTML = `
            <tr>
              <td colspan="6" style="text-align: center; color: var(--danger, #ef4444); padding: 1.5rem;">
                Erro ao carregar movimentações do Protheus: ${escapeHtml(err.message)}
              </td>
            </tr>
          `;
        }
      }
    },

    fecharModalDetalhes: function () {
      const modal = document.getElementById('modalDetalhesTituloContasPagar');
      if (modal) modal.classList.add('hidden');
    },

    sincronizarTemaModal: function () {
      // Garante herança de variáveis CSS de cores
    }
  };

  window.ContasPagarModule = ContasPagarModule;
})();
