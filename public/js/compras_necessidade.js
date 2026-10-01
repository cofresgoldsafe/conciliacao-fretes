/**
 * compras_necessidade.js
 * 
 * Módulo Frontend Isolado: Necessidade de Compras Protheus (Módulo Compras)
 * 
 * Responsável por:
 * 1. Seleção de empresa (14 - Metal Pleno, 15 - GSI, 16 - OAÇO) e modo (Novas vs Novas e Pendentes)
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

  const ComprasNecessidadeModule = {
    init: function () {
      if (!_initialized) {
        this.bindEvents();
        _initialized = true;
      }
    },

    bindEvents: function () {
      const btnAnalisar = document.getElementById('btnAnalisarNecessidade');
      const btnAtualizar = document.getElementById('btnAtualizarNecessidade');
      const btnExportar = document.getElementById('btnExportarExcelNecessidade');
      const btnSair = document.getElementById('btnSairNecessidade');
      const chkAll = document.getElementById('chkAllNecessidade');
      const selEmpresa = document.getElementById('selEmpresaNecessidade');

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

      // Enter no select para disparar análise rápida
      if (selEmpresa) {
        selEmpresa.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            this.executarAnalise();
          }
        });
      }
    },

    executarAnalise: async function (isRefresh = false) {
      if (isAnalyzing) return;

      const selEmpresa = document.getElementById('selEmpresaNecessidade');
      const selModo = document.getElementById('selModoNecessidade');
      const emptyState = document.getElementById('emptyStateNecessidade');
      const loading = document.getElementById('loadingNecessidade');
      const wrapperTabela = document.getElementById('wrapperTabelaNecessidade');
      const tbody = document.getElementById('tbodyNecessidadeCompras');
      const chkAll = document.getElementById('chkAllNecessidade');
      const btnAnalisar = document.getElementById('btnAnalisarNecessidade');

      const empresa = selEmpresa ? selEmpresa.value : '';
      const modo = selModo ? selModo.value : 'novas';

      if (!empresa) {
        alert('Por favor, selecione uma empresa para analisar as necessidades de compra.');
        if (selEmpresa) selEmpresa.focus();
        return;
      }

      empresaAtual = empresa;
      modoAtual = modo;
      isAnalyzing = true;

      // Atualiza interface para estado de loading
      if (emptyState) emptyState.style.display = 'none';
      if (wrapperTabela) wrapperTabela.style.display = 'none';
      if (loading) loading.style.display = 'block';
      if (btnAnalisar) btnAnalisar.disabled = true;
      if (chkAll) chkAll.checked = false;

      try {
        const token = localStorage.getItem('token');
        const params = new URLSearchParams({
          empresa: empresa,
          modo: modo
        });

        const res = await fetch(`/api/compras/necessidade?${params.toString()}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
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

      if (!tbody || !wrapperTabela) return;

      tbody.innerHTML = '';
      if (chkAll) chkAll.checked = false;

      if (!itens || itens.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="10" style="padding: 2.5rem 1rem; text-align: center; color: var(--text-muted, #94a3b8); font-size: 0.95rem;">
              ✅ <b>Nenhuma necessidade de compra encontrada</b> para os parâmetros selecionados nesta empresa.
            </td>
          </tr>
        `;
        wrapperTabela.style.display = 'block';
        if (emptyState) emptyState.style.display = 'none';
        return;
      }

      const rowsHtml = itens.map((item, index) => {
        const saldoStyle = item.saldoEstoque < 0 
          ? 'color: #ef4444; font-weight: 700;' 
          : (item.saldoEstoque === 0 ? 'color: var(--text-muted, #94a3b8);' : 'font-weight: 600;');

        const necDestaque = item.necessidade > 0 
          ? 'font-weight: 700; color: #2563eb;' 
          : 'color: var(--text-muted, #94a3b8);';

        return `
          <tr data-index="${index}" class="tr-necessidade-item">
            <td style="text-align: center; padding: 8px;">
              <input type="checkbox" class="chk-item-necessidade" data-index="${index}" data-produto="${escapeHtml(item.produto)}" style="cursor: pointer;" />
            </td>
            <td style="font-family: monospace, ui-monospace; font-size: 0.9rem; font-weight: 600; white-space: nowrap;">
              ${escapeHtml(item.produto)}
            </td>
            <td style="white-space: normal; max-width: 320px; line-height: 1.35;">
              ${escapeHtml(item.descricao)}
            </td>
            <td style="text-align: right; font-family: monospace, ui-monospace; font-size: 0.9rem;">
              ${formatarNumero(item.pedVendas)}
            </td>
            <td style="text-align: right; font-family: monospace, ui-monospace; font-size: 0.9rem;">
              ${formatarNumero(item.pedCompras)}
            </td>
            <td style="text-align: right; font-family: monospace, ui-monospace; font-size: 0.9rem; ${saldoStyle}">
              ${formatarNumero(item.saldoEstoque)}
            </td>
            <td style="text-align: right; font-family: monospace, ui-monospace; font-size: 0.9rem; font-weight: 600;">
              ${formatarNumero(item.pontoPed)}
            </td>
            <td style="text-align: right; font-family: monospace, ui-monospace; font-size: 0.95rem; ${necDestaque}">
              ${formatarNumero(item.necessidade)}
            </td>
            <td style="text-align: center; font-family: monospace, ui-monospace; font-size: 0.88rem;">
              ${escapeHtml(item.codFornec || '-')}
            </td>
            <td style="white-space: nowrap; font-size: 0.85rem;" title="${escapeHtml(item.razaoSocialCompleta || '')}">
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
      if (!itensCarregados || itensCarregados.length === 0) {
        alert('Não há dados carregados para exportar. Selecione uma empresa e clique em Analisar primeiro.');
        return;
      }

      const headers = [
        'Produto',
        'Descricao',
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

      const rows = itensCarregados.map(item => [
        escapeCsv(item.produto),
        escapeCsv(item.descricao),
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
      a.download = `necessidade_compras_empresa_${empresaAtual || 'GSI'}_${modoAtual}_${hoje}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },

    sair: function () {
      const selEmpresa = document.getElementById('selEmpresaNecessidade');
      const selModo = document.getElementById('selModoNecessidade');
      const emptyState = document.getElementById('emptyStateNecessidade');
      const wrapperTabela = document.getElementById('wrapperTabelaNecessidade');
      const tbody = document.getElementById('tbodyNecessidadeCompras');
      const chkAll = document.getElementById('chkAllNecessidade');

      if (selEmpresa) selEmpresa.value = '';
      if (selModo) selModo.value = 'novas';
      if (chkAll) chkAll.checked = false;
      if (tbody) tbody.innerHTML = '';
      if (wrapperTabela) wrapperTabela.style.display = 'none';
      if (emptyState) emptyState.style.display = 'block';

      itensCarregados = [];
      empresaAtual = '';
      modoAtual = 'novas';
    }
  };

  window.ComprasNecessidadeModule = ComprasNecessidadeModule;

})();
