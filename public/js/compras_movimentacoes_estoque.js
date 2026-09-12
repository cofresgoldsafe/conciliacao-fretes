/**
 * compras_movimentacoes_estoque.js
 * 
 * Módulo Frontend Isolado: Movimentações do Estoque (Módulo Compras)
 * 
 * Funcionalidades:
 * 1. Consulta em tempo real de Entradas (SD1 / Romaneios Manuais) e Saídas Faturadas (SD2) no Protheus
 * 2. Multi-empresa (Metal Pleno 14, GSI 15, OACO 16)
 * 3. Autocomplete inteligente de produtos (código ou nome)
 * 4. Período padrão dinâmico de 12 meses (customizável)
 * 5. Filtros por Tipo de Movimentação (Todas, Entradas Manuais, Entradas com NF, Saídas com NF)
 * 6. Filtro dinâmico por Código da Movimentação (TES) com descrições oficiais
 * 7. Cards de KPIs (Total Entradas, Total Saídas, Saldo do Período, Total Lançamentos)
 * 8. Tabela rica com badges de status, ordenação interativa e paginação
 * 9. Exportação completa para Excel (CSV formatado com UTF-8 BOM e ponto-e-vírgula)
 * 10. Suporte total a temas Claro/Escuro sincronizados com o módulo Compras
 */

(function () {
  'use strict';

  let _initialized = false;
  let debounceTimer = null;
  let dadosConsultaAtual = null;
  let movimentacoesExibidas = [];
  let paginaAtual = 1;
  const ITENS_POR_PAGINA = 25;
  let ordenacao = { coluna: 'emissao', direcao: 'desc' };

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

  function formatNumber(val) {
    const num = Number(val) || 0;
    return num.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function getAuthToken() {
    return localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token') || '';
  }

  const ComprasMovimentacoesEstoqueModule = {
    init: function () {
      if (!_initialized) {
        this.bindEvents();
        this.initDefaultDates();
        _initialized = true;
      }
      this.sincronizarTema();
    },

    initDefaultDates: function () {
      const dataIniInput = document.getElementById('movEstoqueDataIni');
      const dataFimInput = document.getElementById('movEstoqueDataFim');

      if (dataIniInput && dataFimInput && !dataIniInput.value) {
        const hoje = new Date();
        const anoAtras = new Date(hoje);
        anoAtras.setFullYear(anoAtras.getFullYear() - 1);

        dataFimInput.value = hoje.toISOString().slice(0, 10);
        dataIniInput.value = anoAtras.toISOString().slice(0, 10);
      }
    },

    bindEvents: function () {
      const inputProduto = document.getElementById('movEstoqueInputProduto');
      const btnConsultar = document.getElementById('btnConsultarMovEstoque');
      const btnLimpar = document.getElementById('btnLimparMovEstoque');
      const btnExportar = document.getElementById('btnExportarMovEstoque');
      const filtroEmpresa = document.getElementById('movEstoqueFiltroEmpresa');
      const filtroTipo = document.getElementById('movEstoqueFiltroTipo');
      const filtroTes = document.getElementById('movEstoqueFiltroTes');

      // Autocomplete de Produto
      if (inputProduto) {
        inputProduto.addEventListener('input', (e) => {
          this.handleAutocomplete(e.target.value);
        });

        inputProduto.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            this.fecharSugestoes();
            this.consultarMovimentacoes();
          } else if (e.key === 'Escape') {
            this.fecharSugestoes();
          }
        });
      }

      // Fechar autocomplete ao clicar fora
      document.addEventListener('click', (e) => {
        const container = document.getElementById('movEstoqueAutocompleteContainer');
        if (container && !container.contains(e.target)) {
          this.fecharSugestoes();
        }
      });

      // Botão Consultar
      if (btnConsultar) {
        btnConsultar.addEventListener('click', () => {
          this.fecharSugestoes();
          this.consultarMovimentacoes();
        });
      }

      // Botão Limpar
      if (btnLimpar) {
        btnLimpar.addEventListener('click', () => {
          this.limparFormulario();
        });
      }

      // Botão Exportar Excel
      if (btnExportar) {
        btnExportar.addEventListener('click', () => {
          this.exportarExcel();
        });
      }

      // Filtros em tela (refinamento reativo pós-carregamento)
      if (filtroEmpresa) {
        filtroEmpresa.addEventListener('change', () => this.aplicarFiltrosLocais());
      }
      if (filtroTipo) {
        filtroTipo.addEventListener('change', () => this.aplicarFiltrosLocais());
      }
      if (filtroTes) {
        filtroTes.addEventListener('change', () => this.aplicarFiltrosLocais());
      }
    },

    handleAutocomplete: function (termo) {
      clearTimeout(debounceTimer);
      const listEl = document.getElementById('movEstoqueSugestoesList');
      if (!listEl) return;

      const clean = (termo || '').trim();
      if (clean.length < 2) {
        this.fecharSugestoes();
        return;
      }

      debounceTimer = setTimeout(async () => {
        try {
          const token = getAuthToken();
          const res = await fetch(`/api/compras/ponto-pedido/produtos?q=${encodeURIComponent(clean)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const json = await res.json();

          if (json.success && Array.isArray(json.produtos) && json.produtos.length > 0) {
            this.renderSugestoes(json.produtos);
          } else {
            this.fecharSugestoes();
          }
        } catch (err) {
          console.warn('Erro no autocomplete de produtos:', err.message);
          this.fecharSugestoes();
        }
      }, 250);
    },

    renderSugestoes: function (produtos) {
      const listEl = document.getElementById('movEstoqueSugestoesList');
      if (!listEl) return;

      listEl.innerHTML = '';
      produtos.forEach(p => {
        const item = document.createElement('div');
        item.className = 'ponto-pedido-autocomplete-item';
        item.setAttribute('role', 'option');
        item.innerHTML = `
          <div style="font-weight: 600; display: flex; justify-content: space-between; align-items: center;">
            <span style="color: var(--text-color, #f8fafc);">${escapeHtml(p.descricao || p.codigo)}</span>
            <span style="font-size: 0.75rem; color: #38bdf8; font-family: monospace; font-weight: 700;">${escapeHtml(p.codigo)}</span>
          </div>
          <div style="font-size: 0.75rem; color: var(--text-muted, #94a3b8); display: flex; gap: 12px; margin-top: 3px;">
            <span>Grupo: <b>${escapeHtml(p.grupo || '-')}</b></span>
            <span>Saldo: <b>${formatNumber(p.saldo)} un</b></span>
            <span>Preço: <b>${formatCurrency(p.preco)}</b></span>
          </div>
        `;

        item.addEventListener('click', () => {
          const inputBusca = document.getElementById('movEstoqueInputProduto');
          if (inputBusca) {
            inputBusca.value = p.codigo;
          }
          this.fecharSugestoes();
          this.consultarMovimentacoes();
        });

        listEl.appendChild(item);
      });

      listEl.style.display = 'block';
    },

    fecharSugestoes: function () {
      const listEl = document.getElementById('movEstoqueSugestoesList');
      if (listEl) {
        listEl.style.display = 'none';
        listEl.innerHTML = '';
      }
    },

    limparFormulario: function () {
      const inputProduto = document.getElementById('movEstoqueInputProduto');
      const filtroEmpresa = document.getElementById('movEstoqueFiltroEmpresa');
      const filtroTipo = document.getElementById('movEstoqueFiltroTipo');
      const filtroTes = document.getElementById('movEstoqueFiltroTes');
      const containerResultados = document.getElementById('movEstoqueResultadosContainer');
      const containerEmpty = document.getElementById('movEstoqueEmptyState');
      const containerLoading = document.getElementById('movEstoqueLoadingState');

      if (inputProduto) inputProduto.value = '';
      if (filtroEmpresa) filtroEmpresa.value = 'TODAS';
      if (filtroTipo) filtroTipo.value = 'TODOS';
      if (filtroTes) {
        filtroTes.innerHTML = '<option value="">Todas as Movimentações / TES</option>';
        filtroTes.value = '';
      }

      this.initDefaultDates();
      dadosConsultaAtual = null;
      movimentacoesExibidas = [];
      paginaAtual = 1;

      if (containerResultados) containerResultados.classList.add('hidden');
      if (containerLoading) containerLoading.classList.add('hidden');
      if (containerEmpty) containerEmpty.classList.remove('hidden');
    },

    consultarMovimentacoes: async function () {
      const inputProduto = document.getElementById('movEstoqueInputProduto');
      const dataIniInput = document.getElementById('movEstoqueDataIni');
      const dataFimInput = document.getElementById('movEstoqueDataFim');
      const filtroEmpresa = document.getElementById('movEstoqueFiltroEmpresa');
      const filtroTipo = document.getElementById('movEstoqueFiltroTipo');
      const filtroTes = document.getElementById('movEstoqueFiltroTes');

      const termo = (inputProduto ? inputProduto.value : '').trim();
      if (!termo) {
        alert('Por favor, informe o código ou nome de um produto para consultar as movimentações.');
        if (inputProduto) inputProduto.focus();
        return;
      }

      const dataIni = dataIniInput ? dataIniInput.value : '';
      const dataFim = dataFimInput ? dataFimInput.value : '';
      const empresa = filtroEmpresa ? filtroEmpresa.value : 'TODAS';
      const tipoMov = filtroTipo ? filtroTipo.value : 'TODOS';
      const tes = filtroTes ? filtroTes.value : '';

      const containerEmpty = document.getElementById('movEstoqueEmptyState');
      const containerLoading = document.getElementById('movEstoqueLoadingState');
      const containerResultados = document.getElementById('movEstoqueResultadosContainer');
      const containerError = document.getElementById('movEstoqueErrorState');

      if (containerEmpty) containerEmpty.classList.add('hidden');
      if (containerResultados) containerResultados.classList.add('hidden');
      if (containerError) containerError.classList.add('hidden');
      if (containerLoading) containerLoading.classList.remove('hidden');

      try {
        const token = getAuthToken();
        const params = new URLSearchParams({
          codigo: termo,
          empresa: empresa || 'TODAS',
          dataIni: dataIni ? dataIni.replace(/-/g, '') : '',
          dataFim: dataFim ? dataFim.replace(/-/g, '') : '',
          tipoMov: 'TODOS'
        });

        const res = await fetch(`/api/compras/movimentacoes-estoque?${params.toString()}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await res.json();
        if (containerLoading) containerLoading.classList.add('hidden');

        if (!data.success) {
          throw new Error(data.message || 'Erro ao consultar movimentações de estoque no Protheus.');
        }

        dadosConsultaAtual = data;
        this.atualizarListaTesSelect(data.listaTes || []);
        this.renderizarCabecalhoProduto(data.produto, data.periodo);
        
        // Aplica os filtros ativos (empresa, tipo, TES) preservando opções completas no select
        this.aplicarFiltrosLocais();

        if (containerResultados) containerResultados.classList.remove('hidden');
      } catch (err) {
        console.error('Erro na consulta de movimentações:', err);
        if (containerLoading) containerLoading.classList.add('hidden');
        if (containerError) {
          const msgEl = document.getElementById('movEstoqueErrorMsg');
          if (msgEl) msgEl.textContent = err.message || 'Ocorreu um erro ao consultar as movimentações.';
          containerError.classList.remove('hidden');
        } else {
          alert('Erro ao consultar movimentações: ' + err.message);
        }
      }
    },

    atualizarListaTesSelect: function (listaTes) {
      const selectTes = document.getElementById('movEstoqueFiltroTes');
      if (!selectTes) return;

      const valorAnterior = selectTes.value;
      selectTes.innerHTML = '<option value="">Todas as Movimentações / TES</option>';

      listaTes.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.tes;
        const prefixo = t.tipo === 'ENTRADA' ? '📥 [ENTRADA]' : '📤 [SAÍDA]';
        opt.textContent = `${prefixo} TES ${t.tes} - ${t.descricao || 'Sem descrição'} (${t.count})`;
        selectTes.appendChild(opt);
      });

      // Restaura o valor se ainda existir na lista
      if (valorAnterior) {
        selectTes.value = valorAnterior;
      }
    },

    aplicarFiltrosLocais: function () {
      if (!dadosConsultaAtual || !Array.isArray(dadosConsultaAtual.movimentacoes)) return;

      const filtroEmpresa = document.getElementById('movEstoqueFiltroEmpresa');
      const filtroTipo = document.getElementById('movEstoqueFiltroTipo');
      const filtroTes = document.getElementById('movEstoqueFiltroTes');

      const valEmp = filtroEmpresa ? filtroEmpresa.value : 'TODAS';
      const valTipo = filtroTipo ? filtroTipo.value : 'TODOS';
      const valTes = filtroTes ? filtroTes.value : '';

      movimentacoesExibidas = dadosConsultaAtual.movimentacoes.filter(m => {
        // Filtro Empresa
        if (valEmp && valEmp !== 'TODAS' && valEmp !== 'TODOS') {
          if (m.empresa !== valEmp && m.empresaCodigo !== valEmp) return false;
        }

        // Filtro Tipo
        if (valTipo && valTipo !== 'TODOS') {
          if (valTipo === 'ENTRADA' && m.tipoMov !== 'ENTRADA') return false;
          if (valTipo === 'SAIDA' && m.tipoMov !== 'SAIDA') return false;
          if (valTipo === 'ENTRADA_MANUAL' && (!m.isManual || m.tipoMov !== 'ENTRADA')) return false;
          if (valTipo === 'ENTRADA_NF' && (m.isManual || m.tipoMov !== 'ENTRADA')) return false;
          if (valTipo === 'SAIDA_NF' && m.tipoMov !== 'SAIDA') return false;
        }

        // Filtro TES
        if (valTes && m.tes !== valTes) return false;

        return true;
      });

      // Recalcula KPIs dos dados visíveis filtrados
      let totalEntradasQtd = 0;
      let totalSaidasQtd = 0;
      let totalEntradasValor = 0;
      let totalSaidasValor = 0;
      let qtdEntradasManuais = 0;
      let qtdEntradasNF = 0;
      let qtdSaidasNF = 0;

      for (const m of movimentacoesExibidas) {
        if (m.tipoMov === 'ENTRADA') {
          totalEntradasQtd += m.quantidade;
          totalEntradasValor += m.valorTotal;
          if (m.isManual) qtdEntradasManuais++;
          else qtdEntradasNF++;
        } else {
          totalSaidasQtd += m.quantidade;
          totalSaidasValor += m.valorTotal;
          qtdSaidasNF++;
        }
      }

      this.renderizarKpis({
        totalEntradasQtd: Math.round(totalEntradasQtd * 100) / 100,
        totalSaidasQtd: Math.round(totalSaidasQtd * 100) / 100,
        saldoPeriodoQtd: Math.round((totalEntradasQtd - totalSaidasQtd) * 100) / 100,
        totalEntradasValor: Math.round(totalEntradasValor * 100) / 100,
        totalSaidasValor: Math.round(totalSaidasValor * 100) / 100,
        totalRegistros: movimentacoesExibidas.length,
        qtdEntradasManuais,
        qtdEntradasNF,
        qtdSaidasNF
      });

      paginaAtual = 1;
      this.renderizarTabela();
    },

    renderizarCabecalhoProduto: function (prod, periodo) {
      const elCod = document.getElementById('movEstoqueProdCodigo');
      const elDesc = document.getElementById('movEstoqueProdDescricao');
      const elGrupo = document.getElementById('movEstoqueProdGrupo');
      const elUm = document.getElementById('movEstoqueProdUm');
      const elPeriodo = document.getElementById('movEstoquePeriodoInfo');

      if (elCod) elCod.textContent = prod.CODIGO || '-';
      if (elDesc) elDesc.textContent = prod.DESCRICAO || '-';
      if (elGrupo) elGrupo.textContent = prod.GRUPO ? `Grupo: ${prod.GRUPO}` : '';
      if (elUm) elUm.textContent = prod.UM ? `UM: ${prod.UM}` : 'UN';
      if (elPeriodo && periodo) {
        elPeriodo.textContent = `Período: ${periodo.deFormatado} até ${periodo.ateFormatado}`;
      }
    },

    renderizarKpis: function (kpis) {
      const elTotalEntradas = document.getElementById('kpiMovEstoqueTotalEntradas');
      const elValorEntradas = document.getElementById('kpiMovEstoqueValorEntradas');
      const elTotalSaidas = document.getElementById('kpiMovEstoqueTotalSaidas');
      const elValorSaidas = document.getElementById('kpiMovEstoqueValorSaidas');
      const elSaldoPeriodo = document.getElementById('kpiMovEstoqueSaldoPeriodo');
      const elTotalRegistros = document.getElementById('kpiMovEstoqueTotalRegistros');
      const elDetalhesLanc = document.getElementById('kpiMovEstoqueDetalhesLanc');

      if (elTotalEntradas) elTotalEntradas.textContent = `+${formatNumber(kpis.totalEntradasQtd)} un`;
      if (elValorEntradas) elValorEntradas.textContent = formatCurrency(kpis.totalEntradasValor);
      
      if (elTotalSaidas) elTotalSaidas.textContent = `-${formatNumber(kpis.totalSaidasQtd)} un`;
      if (elValorSaidas) elValorSaidas.textContent = formatCurrency(kpis.totalSaidasValor);

      if (elSaldoPeriodo) {
        const saldo = Number(kpis.saldoPeriodoQtd) || 0;
        const prefixo = saldo > 0 ? '+' : '';
        elSaldoPeriodo.textContent = `${prefixo}${formatNumber(saldo)} un`;
        if (saldo > 0) {
          elSaldoPeriodo.style.color = '#10b981'; // Verde
        } else if (saldo < 0) {
          elSaldoPeriodo.style.color = '#ef4444'; // Vermelho
        } else {
          elSaldoPeriodo.style.color = 'inherit';
        }
      }

      if (elTotalRegistros) elTotalRegistros.textContent = `${kpis.totalRegistros} lançamentos`;
      if (elDetalhesLanc) {
        elDetalhesLanc.textContent = `${kpis.qtdEntradasManuais || 0} Manuais | ${kpis.qtdEntradasNF || 0} NFs Entrada | ${kpis.qtdSaidasNF || 0} NFs Saída`;
      }
    },

    renderizarTabela: function () {
      const tbody = document.getElementById('movEstoqueTbody');
      const contadorEl = document.getElementById('movEstoqueTotalContador');
      const paginacaoContainer = document.getElementById('movEstoquePaginacao');

      if (!tbody) return;

      if (movimentacoesExibidas.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="12" style="text-align: center; padding: 2.5rem; color: var(--text-muted, #94a3b8);">
              Nenhuma movimentação encontrada para os filtros selecionados no período.
            </td>
          </tr>
        `;
        if (contadorEl) contadorEl.textContent = '0 movimentações';
        if (paginacaoContainer) paginacaoContainer.innerHTML = '';
        return;
      }

      // Ordenar dados
      const dadosOrdenados = [...movimentacoesExibidas].sort((a, b) => {
        let valA = a[ordenacao.coluna];
        let valB = b[ordenacao.coluna];

        if (typeof valA === 'string') valA = valA.toUpperCase();
        if (typeof valB === 'string') valB = valB.toUpperCase();

        if (valA < valB) return ordenacao.direcao === 'asc' ? -1 : 1;
        if (valA > valB) return ordenacao.direcao === 'asc' ? 1 : -1;
        return 0;
      });

      // Paginação
      const totalItens = dadosOrdenados.length;
      const totalPaginas = Math.ceil(totalItens / ITENS_POR_PAGINA) || 1;
      if (paginaAtual > totalPaginas) paginaAtual = totalPaginas;

      const inicio = (paginaAtual - 1) * ITENS_POR_PAGINA;
      const fim = Math.min(inicio + ITENS_POR_PAGINA, totalItens);
      const paginaDados = dadosOrdenados.slice(inicio, fim);

      if (contadorEl) {
        contadorEl.textContent = `Exibindo ${inicio + 1}-${fim} de ${totalItens} movimentações`;
      }

      let html = '';
      paginaDados.forEach(m => {
        // Badges de tipo
        let badgeTipoHtml = '';
        let qtdColor = '#10b981';
        let qtdSinal = '+';

        if (m.tipoMov === 'ENTRADA') {
          if (m.isManual) {
            badgeTipoHtml = `<span class="badge" style="background: rgba(139, 92, 246, 0.15); color: #a78bfa; border: 1px solid rgba(139, 92, 246, 0.3); font-weight: 600; padding: 3px 8px; border-radius: 6px; font-size: 0.78rem;">📦 Entrada Manual</span>`;
          } else {
            badgeTipoHtml = `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); font-weight: 600; padding: 3px 8px; border-radius: 6px; font-size: 0.78rem;">🟢 Entrada NF</span>`;
          }
          qtdColor = '#10b981';
          qtdSinal = '+';
        } else {
          badgeTipoHtml = `<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); font-weight: 600; padding: 3px 8px; border-radius: 6px; font-size: 0.78rem;">🔴 Saída NF</span>`;
          qtdColor = '#ef4444';
          qtdSinal = '-';
        }

        // Badge Empresa
        let empBadgeStyle = 'background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3);';
        if (m.empresa === 'GSI') empBadgeStyle = 'background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3);';
        if (m.empresa === 'OACO') empBadgeStyle = 'background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3);';

        const empBadge = `<span class="badge" style="${empBadgeStyle} font-weight: 700; padding: 2px 7px; border-radius: 5px; font-size: 0.75rem;">${escapeHtml(m.empresa)}</span>`;

        html += `
          <tr style="border-bottom: 1px solid var(--panel-border, rgba(255,255,255,0.06)); transition: background 0.15s ease;">
            <td style="white-space: nowrap; font-size: 0.85rem; font-weight: 500;">${escapeHtml(m.emissaoFormatada)}</td>
            <td style="text-align: center;">${empBadge}</td>
            <td style="white-space: nowrap;">${badgeTipoHtml}</td>
            <td style="font-family: monospace; font-weight: 700; font-size: 0.88rem; color: var(--text-highlight, #38bdf8);">${escapeHtml(m.doc)}</td>
            <td style="text-align: center; font-size: 0.82rem; color: var(--text-muted);">${escapeHtml(m.serie || '-')}</td>
            <td style="text-align: center; font-size: 0.82rem; color: var(--text-muted);">${escapeHtml(m.item || '-')}</td>
            <td style="text-align: right; font-weight: 700; font-size: 0.92rem; color: ${qtdColor};">${qtdSinal}${formatNumber(m.quantidade)}</td>
            <td style="text-align: right; font-size: 0.85rem; color: var(--text-color);">${formatCurrency(m.valorUnitario)}</td>
            <td style="text-align: right; font-size: 0.85rem; font-weight: 600; color: var(--text-color);">${formatCurrency(m.valorTotal)}</td>
            <td style="white-space: nowrap;">
              <span style="font-family: monospace; font-weight: 700; color: #f59e0b; background: rgba(245, 158, 11, 0.1); padding: 2px 6px; border-radius: 4px; font-size: 0.8rem; margin-right: 6px;">${escapeHtml(m.tes)}</span>
              <span style="font-size: 0.82rem; color: var(--text-muted);">${escapeHtml(m.tesDescricao || '-')}</span>
            </td>
            <td style="text-align: center; font-family: monospace; font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(m.cfop || '-')}</td>
            <td style="font-size: 0.82rem; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(m.participanteNome)}">
              ${escapeHtml(m.participanteNome || m.participanteCod || '-')}
            </td>
          </tr>
        `;
      });

      tbody.innerHTML = html;
      this.renderizarControlesPaginacao(totalPaginas);
    },

    renderizarControlesPaginacao: function (totalPaginas) {
      const container = document.getElementById('movEstoquePaginacao');
      if (!container) return;

      if (totalPaginas <= 1) {
        container.innerHTML = '';
        return;
      }

      let pagHtml = `
        <div style="display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 1rem;">
          <button class="btn btn-outline btn-sm" id="btnMovEstoquePagAnt" ${paginaAtual === 1 ? 'disabled' : ''} style="padding: 4px 10px; font-size: 0.8rem;">
            ◀ Anterior
          </button>
          <span style="font-size: 0.85rem; color: var(--text-muted); padding: 0 6px;">
            Página <b>${paginaAtual}</b> de <b>${totalPaginas}</b>
          </span>
          <button class="btn btn-outline btn-sm" id="btnMovEstoquePagProx" ${paginaAtual === totalPaginas ? 'disabled' : ''} style="padding: 4px 10px; font-size: 0.8rem;">
            Próxima ▶
          </button>
        </div>
      `;
      container.innerHTML = pagHtml;

      const btnAnt = document.getElementById('btnMovEstoquePagAnt');
      const btnProx = document.getElementById('btnMovEstoquePagProx');

      if (btnAnt) {
        btnAnt.addEventListener('click', () => {
          if (paginaAtual > 1) {
            paginaAtual--;
            this.renderizarTabela();
          }
        });
      }
      if (btnProx) {
        btnProx.addEventListener('click', () => {
          if (paginaAtual < totalPaginas) {
            paginaAtual++;
            this.renderizarTabela();
          }
        });
      }
    },

    exportarExcel: function () {
      if (!movimentacoesExibidas || movimentacoesExibidas.length === 0) {
        alert('Não há movimentações para exportar.');
        return;
      }

      const prod = (dadosConsultaAtual && dadosConsultaAtual.produto) || {};
      const codProd = prod.CODIGO || 'produto';

      const cabecalhos = [
        'Data Emissão',
        'Empresa',
        'Tipo Movimento',
        'Subtipo',
        'Documento',
        'Série',
        'Item',
        'Código Produto',
        'Descrição Produto',
        'Quantidade',
        'Valor Unitário (R$)',
        'Valor Total (R$)',
        'TES',
        'Descrição da TES',
        'Atualiza Estoque',
        'CFOP',
        'Cód. Participante',
        'Nome Participante / Cliente / Fornecedor'
      ];

      const escapeCsvCell = (val) => {
        if (val === null || val === undefined) return '""';
        let str = String(val);
        // Prevenção contra CSV Formula Injection (CWE-1236): prefixar com apóstrofo se iniciar com =, +, -, @, tab, cr
        if (/^[=+\-@\t\r]/.test(str)) {
          str = "'" + str;
        }
        return `"${str.replace(/"/g, '""')}"`;
      };

      const linhas = [cabecalhos.join(';')];

      movimentacoesExibidas.forEach(m => {
        const linha = [
          escapeCsvCell(m.emissaoFormatada || ''),
          escapeCsvCell(m.empresa || ''),
          escapeCsvCell(m.tipoMov || ''),
          escapeCsvCell(m.isManual ? 'Entrada Manual' : (m.tipoMov === 'ENTRADA' ? 'Entrada NF' : 'Saída NF')),
          escapeCsvCell(m.doc || ''),
          escapeCsvCell(m.serie || ''),
          escapeCsvCell(m.item || ''),
          escapeCsvCell(m.codProd || prod.CODIGO || ''),
          escapeCsvCell(prod.DESCRICAO || ''),
          String(m.quantidade || 0).replace('.', ','),
          String(m.valorUnitario || 0).replace('.', ','),
          String(m.valorTotal || 0).replace('.', ','),
          escapeCsvCell(m.tes || ''),
          escapeCsvCell(m.tesDescricao || ''),
          escapeCsvCell(m.atualizaEstoque || ''),
          escapeCsvCell(m.cfop || ''),
          escapeCsvCell(m.participanteCod || ''),
          escapeCsvCell(m.participanteNome || '')
        ];
        linhas.push(linha.join(';'));
      });

      // UTF-8 BOM (\uFEFF) para garantir abertura com caracteres especiais no Excel
      const csvContent = '\uFEFF' + linhas.join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      const dataStr = new Date().toISOString().slice(0, 10);
      link.setAttribute('href', url);
      link.setAttribute('download', `movimentacoes_estoque_${codProd}_${dataStr}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    },

    sincronizarTema: function () {
      const painel = document.getElementById('tab-compras-movimentacoes-estoque');
      if (!painel) return;

      const isLight = document.body.classList.contains('theme-light') || 
                      localStorage.getItem('theme_compras') === 'light' || 
                      localStorage.getItem('theme_vendedores') === 'light';

      if (isLight) {
        painel.classList.add('tab-theme-light');
      } else {
        painel.classList.remove('tab-theme-light');
      }
    }
  };

  window.ComprasMovimentacoesEstoqueModule = ComprasMovimentacoesEstoqueModule;

  // Auto-inicialização quando o DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ComprasMovimentacoesEstoqueModule.init());
  } else {
    ComprasMovimentacoesEstoqueModule.init();
  }
})();
