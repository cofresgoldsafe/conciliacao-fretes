/**
 * compras_necessidade.js
 * 
 * Módulo Frontend Isolado: Necessidade de Compras Protheus (Módulo Compras)
 * 
 * Responsável por:
 * 1. Seleção de empresa (14 - Metal Pleno, 15 - GSI, 16 - OAÇO) e modo (Necessidades Não Atendidas vs Todas as Necessidades)
 * 2. Visualização Protheus Style da necessidade de compras apurada no ERP
 * 3. Renderização das colunas: Checkbox, Produto, Descricao, Ped Vendas, Ped Compras,
 *    Saldo Estoque, Ponto de Ped, Necessidade de Compras, Cod Fornec, Nome Fornec (15 chars)
 * 4. Ações inferiores: Gerar Pedido (disabled), Atualizar, Exporta p/ Excel e Sair
 * 5. Exportação para arquivo CSV compatível com Microsoft Excel (delimitador ';' e BOM UTF-8)
 */

(function () {
  'use strict';

  let _initialized = false;
  let itensCarregados = [];
  let empresaAtual = '';
  let modoAtual = 'novas';
  let grupoAtual = 'todos';
  let isAnalyzing = false;

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatarNumero(num) {
    const n = Number(num) || 0;
    return n.toLocaleString('pt-BR');
  }

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

  const ComprasNecessidadeModule = {
    init: function () {
      this.sincronizarTema();
      if (!_initialized) {
        this.bindEvents();
        _initialized = true;
      }
    },

    sincronizarTema: function () {
      const painel = document.getElementById('tab-compras-necessidade');
      if (!painel) return;
      const isLight = document.body.classList.contains('theme-light') || 
                      localStorage.getItem('theme_compras') === 'light' || 
                      localStorage.getItem('theme_vendedores') === 'light' ||
                      localStorage.getItem('theme_saldos_estoque') === 'light';
      if (isLight) {
        painel.classList.add('tab-theme-light');
      } else {
        painel.classList.remove('tab-theme-light');
      }
    },

    bindEvents: function () {
      const btnAnalisar = document.getElementById('btnAnalisarNecessidade');
      const btnAtualizar = document.getElementById('btnAtualizarNecessidade');
      const btnExportar = document.getElementById('btnExportarExcelNecessidade');
      const btnSair = document.getElementById('btnSairNecessidade');
      const chkAll = document.getElementById('chkAllNecessidade');
      const selEmpresa = document.getElementById('selEmpresaNecessidade');
      const selGrupo = document.getElementById('selGrupoNecessidade');
      const selModo = document.getElementById('selModoNecessidade');

      if (btnAnalisar) {
        btnAnalisar.addEventListener('click', () => this.executarAnalise());
      }

      if (btnAtualizar) {
        btnAtualizar.addEventListener('click', () => {
          if (!empresaAtual) {
            this.executarAnalise();
          } else {
            this.executarAnalise(true);
          }
        });
      }

      if (btnExportar) {
        btnExportar.addEventListener('click', () => this.exportarExcel());
      }

      if (btnSair) {
        btnSair.addEventListener('click', () => this.sair());
      }

      if (chkAll) {
        chkAll.addEventListener('change', (e) => {
          const checked = e.target.checked;
          const checks = document.querySelectorAll('#tbodyNecessidadeCompras .chk-item-necessidade');
          checks.forEach(chk => {
            chk.checked = checked;
          });
        });
      }

      // Enter nos selects para disparar análise rápida
      const dispararEnter = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.executarAnalise();
        }
      };

      if (selEmpresa) selEmpresa.addEventListener('keydown', dispararEnter);
      if (selGrupo) selGrupo.addEventListener('keydown', dispararEnter);
      if (selModo) selModo.addEventListener('keydown', dispararEnter);

      const inputBusca = document.getElementById('inputBuscaNecessidadeProduto');
      if (inputBusca) {
        inputBusca.addEventListener('input', () => {
          this.renderTabela(itensCarregados);
        });
        inputBusca.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            inputBusca.value = '';
            this.renderTabela(itensCarregados);
          }
        });
      }
    },

    executarAnalise: async function (isRefresh = false) {
      if (isAnalyzing) return;

      const selEmpresa = document.getElementById('selEmpresaNecessidade');
      const selGrupo = document.getElementById('selGrupoNecessidade');
      const selModo = document.getElementById('selModoNecessidade');
      const emptyState = document.getElementById('emptyStateNecessidade');
      const loading = document.getElementById('loadingNecessidade');
      const wrapperTabela = document.getElementById('wrapperTabelaNecessidade');
      const tbody = document.getElementById('tbodyNecessidadeCompras');
      const chkAll = document.getElementById('chkAllNecessidade');
      const btnAnalisar = document.getElementById('btnAnalisarNecessidade');

      const empresa = selEmpresa ? selEmpresa.value : '';
      const grupo = selGrupo ? selGrupo.value : 'todos';
      const modo = selModo ? selModo.value : 'novas';

      if (!empresa) {
        alert('Por favor, selecione uma empresa para analisar as necessidades de compra.');
        if (selEmpresa) selEmpresa.focus();
        return;
      }

      empresaAtual = empresa;
      modoAtual = modo;
      grupoAtual = grupo;
      isAnalyzing = true;

      // Atualiza interface para estado de loading
      if (emptyState) emptyState.style.display = 'none';
      if (wrapperTabela) wrapperTabela.style.display = 'none';
      if (loading) loading.style.display = 'block';
      if (btnAnalisar) btnAnalisar.disabled = true;
      if (chkAll) chkAll.checked = false;

      try {
        const token = getToken();
        const headers = {};
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
        const params = new URLSearchParams({
          empresa: empresa,
          modo: modo,
          grupo: grupo
        });

        const res = await fetch(`/api/compras/necessidade?${params.toString()}`, {
          headers
        });

        const data = await res.json();

        if (!data.success) {
          throw new Error(data.message || 'Falha ao consultar necessidade de compras no Protheus.');
        }

        itensCarregados = data.itens || [];
        this.renderTabela(itensCarregados);

      } catch (err) {
        console.error('Erro na análise de necessidade de compras:', err);
        alert('Erro ao consultar Protheus: ' + err.message);
        if (emptyState && itensCarregados.length === 0) emptyState.style.display = 'block';
      } finally {
        isAnalyzing = false;
        if (loading) loading.style.display = 'none';
        if (btnAnalisar) btnAnalisar.disabled = false;
      }
    },

    renderTabela: function (itens) {
      const wrapperTabela = document.getElementById('wrapperTabelaNecessidade');
      const tbody = document.getElementById('tbodyNecessidadeCompras');
      const emptyState = document.getElementById('emptyStateNecessidade');
      const chkAll = document.getElementById('chkAllNecessidade');
      const inputBusca = document.getElementById('inputBuscaNecessidadeProduto');
      const termoBusca = (inputBusca ? inputBusca.value : '').toLowerCase().trim();

      if (!tbody || !wrapperTabela) return;

      tbody.innerHTML = '';
      if (chkAll) chkAll.checked = false;

      // Regra mandatória: somente produtos com Ped Vendas > 0 ou Ped Compras > 0 (omitir 0 e 0)
      let listaExibicao = (itens || []).filter(item => (Number(item.pedVendas) > 0 || Number(item.pedCompras) > 0));

      if (termoBusca) {
        listaExibicao = listaExibicao.filter(item => {
          const prod = String(item.produto || '').toLowerCase();
          const desc = String(item.descricao || '').toLowerCase();
          const forn = String(item.nomeFornec || '').toLowerCase();
          const codForn = String(item.codFornec || '').toLowerCase();
          return prod.includes(termoBusca) || desc.includes(termoBusca) || forn.includes(termoBusca) || codForn.includes(termoBusca);
        });
      }

      if (!listaExibicao || listaExibicao.length === 0) {
        const msg = termoBusca
          ? `🔍 Nenhum produto correspondente a "<b>${escapeHtml(termoBusca)}</b>" nesta consulta.`
          : `✅ <b>Nenhuma necessidade de compra encontrada</b> para os parâmetros selecionados nesta empresa (produtos com Ped Vendas ou Ped Compras &gt; 0).`;
        tbody.innerHTML = `
          <tr>
            <td colspan="10" style="padding: 2.5rem 1rem; text-align: center; color: var(--text-muted, #94a3b8); font-size: 0.95rem;">
              ${msg}
            </td>
          </tr>
        `;
        wrapperTabela.style.display = 'block';
        if (emptyState) emptyState.style.display = 'none';
        return;
      }

      const rowsHtml = listaExibicao.map((item, index) => {
        const saldoStyle = item.saldoEstoque < 0 
          ? 'color: #ef4444; font-weight: 700;' 
          : (item.saldoEstoque === 0 ? 'color: var(--text-muted, #94a3b8);' : 'font-weight: 600;');

        let necClass = 'necessidade-val-zero';
        if (item.necessidade < 0) {
          necClass = 'necessidade-val-falta';
        } else if (item.necessidade > 0) {
          necClass = 'necessidade-val-destaque';
        }

        return `
          <tr data-index="${index}" class="tr-necessidade-item">
            <td style="text-align: center; padding: 6px 4px; width: 34px;">
              <input type="checkbox" class="chk-item-necessidade" data-index="${index}" data-produto="${escapeHtml(item.produto)}" style="cursor: pointer;" />
            </td>
            <td style="font-family: monospace, ui-monospace; font-size: 0.86rem; font-weight: 600; white-space: nowrap; padding: 6px 8px; text-align: left;">
              ${escapeHtml(item.produto)}
            </td>
            <td style="white-space: normal; line-height: 1.25; padding: 6px 8px; font-size: 0.84rem; text-align: left;">
              ${escapeHtml(item.descricao)}
            </td>
            <td style="text-align: center; font-family: monospace, ui-monospace; font-size: 0.86rem; padding: 5px 4px; white-space: nowrap;">
              ${formatarNumero(item.pedVendas)}
            </td>
            <td style="text-align: center; font-family: monospace, ui-monospace; font-size: 0.86rem; padding: 5px 4px; white-space: nowrap;">
              ${formatarNumero(item.pedCompras)}
            </td>
            <td style="text-align: center; font-family: monospace, ui-monospace; font-size: 0.86rem; padding: 5px 4px; white-space: nowrap; ${saldoStyle}">
              ${formatarNumero(item.saldoEstoque)}
            </td>
            <td style="text-align: center; font-family: monospace, ui-monospace; font-size: 0.86rem; font-weight: 600; padding: 5px 4px; white-space: nowrap;">
              ${formatarNumero(item.pontoPed)}
            </td>
            <td style="text-align: center; font-family: monospace, ui-monospace; font-size: 0.88rem; padding: 5px 4px; white-space: nowrap;" class="${necClass}">
              ${formatarNumero(item.necessidade)}
            </td>
            <td style="text-align: center; font-family: monospace, ui-monospace; font-size: 0.84rem; padding: 5px 4px; white-space: nowrap;">
              ${escapeHtml(item.codFornec || '-')}
            </td>
            <td style="white-space: nowrap; font-size: 0.82rem; padding: 6px 8px; text-align: left;" title="${escapeHtml(item.razaoSocialCompleta || '')}">
              ${escapeHtml(item.nomeFornec || '-')}
            </td>
          </tr>
        `;
      }).join('');

      tbody.innerHTML = rowsHtml;
      wrapperTabela.style.display = 'block';
      if (emptyState) emptyState.style.display = 'none';

      // Evento de clique na linha para seleção visual estilo Protheus
      const trs = tbody.querySelectorAll('.tr-necessidade-item');
      trs.forEach(tr => {
        tr.addEventListener('click', (e) => {
          // Se clicou no checkbox, deixa o evento nativo rodar
          if (e.target.classList.contains('chk-item-necessidade')) {
            return;
          }
          // Alterna destaque visual da linha
          trs.forEach(otherTr => otherTr.classList.remove('row-selected'));
          tr.classList.add('row-selected');
        });
      });
    },

    exportarExcel: function () {
      const inputBusca = document.getElementById('inputBuscaNecessidadeProduto');
      const termoBusca = (inputBusca ? inputBusca.value : '').toLowerCase().trim();
      let itensValidos = (itensCarregados || []).filter(item => (Number(item.pedVendas) > 0 || Number(item.pedCompras) > 0));

      if (termoBusca) {
        itensValidos = itensValidos.filter(item => {
          const prod = String(item.produto || '').toLowerCase();
          const desc = String(item.descricao || '').toLowerCase();
          const forn = String(item.nomeFornec || '').toLowerCase();
          const codForn = String(item.codFornec || '').toLowerCase();
          return prod.includes(termoBusca) || desc.includes(termoBusca) || forn.includes(termoBusca) || codForn.includes(termoBusca);
        });
      }

      if (!itensValidos || itensValidos.length === 0) {
        alert('Não há dados com Ped Vendas ou Ped Compras > 0 para exportar. Selecione uma empresa e clique em Analisar primeiro.');
        return;
      }

      const headers = [
        'Produto',
        'Descricao',
        'Linha / Grupo',
        'Ped Vendas',
        'Ped Compras',
        'Saldo Estoque',
        'Ponto de Ped',
        'Necessidade de Compras',
        'Cod Fornec',
        'Nome Fornec',
        'Razao Social Fornecedor Completa'
      ];

      const escapeCsv = (str) => {
        const s = String(str === null || str === undefined ? '' : str).replace(/"/g, '""');
        return `"${s}"`;
      };

      const rows = itensValidos.map(item => [
        escapeCsv(item.produto),
        escapeCsv(item.descricao),
        escapeCsv(item.grupo || ''),
        item.pedVendas,
        item.pedCompras,
        item.saldoEstoque,
        item.pontoPed,
        item.necessidade,
        escapeCsv(item.codFornec),
        escapeCsv(item.nomeFornec),
        escapeCsv(item.razaoSocialCompleta)
      ]);

      const csvContent = '\uFEFF' + [
        headers.join(';'),
        ...rows.map(r => r.join(';'))
      ].join('\r\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const hoje = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `necessidade_compras_empresa_${empresaAtual || 'GSI'}_grupo_${grupoAtual}_${modoAtual}_${hoje}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },

    sair: function () {
      const selEmpresa = document.getElementById('selEmpresaNecessidade');
      const selGrupo = document.getElementById('selGrupoNecessidade');
      const selModo = document.getElementById('selModoNecessidade');
      const inputBusca = document.getElementById('inputBuscaNecessidadeProduto');
      const emptyState = document.getElementById('emptyStateNecessidade');
      const wrapperTabela = document.getElementById('wrapperTabelaNecessidade');
      const tbody = document.getElementById('tbodyNecessidadeCompras');
      const chkAll = document.getElementById('chkAllNecessidade');

      if (selEmpresa) selEmpresa.value = '';
      if (selGrupo) selGrupo.value = 'todos';
      if (selModo) selModo.value = 'novas';
      if (inputBusca) inputBusca.value = '';
      if (chkAll) chkAll.checked = false;
      if (tbody) tbody.innerHTML = '';
      if (wrapperTabela) wrapperTabela.style.display = 'none';
      if (emptyState) emptyState.style.display = 'block';

      itensCarregados = [];
      empresaAtual = '';
      modoAtual = 'novas';
      grupoAtual = 'todos';
    }
  };

  window.ComprasNecessidadeModule = ComprasNecessidadeModule;

})();
