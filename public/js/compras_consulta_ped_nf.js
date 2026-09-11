/**
 * compras_consulta_ped_nf.js
 * 
 * Módulo Frontend Isolado: Consulta de Pedidos de Compra e NFe de Entrada (Módulo Compras)
 * 
 * Responsável por:
 * 1. Pesquisa multi-empresa direta no Protheus (OACO 16, GSI 15, Metal Pleno 14)
 * 2. Suporte aos 3 critérios: Pedido de Compra (C7_NUM/D1_PEDIDO), NFe (SF1_DOC) ou Fornecedor (SA2010)
 * 3. Trava de segurança de 90 dias com validação estrita para buscas por fornecedor
 * 4. Tabela com Empresa, Razão Social, Pedido de Compra, NFe, Data Emissão, Valor e Botão Ver
 * 5. Modal rico de Detalhes da NFe de Entrada (SF1 + SD1 + SA2 + SF4 + SE2) com cópia de Chave de 44 dígitos
 * 6. Integração com tema Claro/Escuro do módulo Compras
 */

(function () {
  'use strict';

  let _initialized = false;
  let isSearching = false;

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

  function formatCnpj(cnpj) {
    const c = String(cnpj || '').replace(/\D/g, '');
    if (c.length === 14) {
      return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    }
    if (c.length === 11) {
      return c.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
    }
    return cnpj || '-';
  }

  const ComprasConsultaPedNfModule = {
    init: function () {
      if (!_initialized) {
        this.bindEvents();
        this.initDefaultDates();
        _initialized = true;
      }
      this.sincronizarTemaModal();
    },

    initDefaultDates: function () {
      const dataIni = document.getElementById('searchComprasDataIni');
      const dataFim = document.getElementById('searchComprasDataFim');

      const hoje = new Date();
      const spHoje = new Date(hoje.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
      
      const yyyy = spHoje.getFullYear();
      const mm = String(spHoje.getMonth() + 1).padStart(2, '0');
      const dd = String(spHoje.getDate()).padStart(2, '0');
      const hojeStr = `${yyyy}-${mm}-${dd}`;

      // 90 dias atrás
      const dt90 = new Date(spHoje.getTime() - (90 * 24 * 60 * 60 * 1000));
      const y90 = dt90.getFullYear();
      const m90 = String(dt90.getMonth() + 1).padStart(2, '0');
      const d90 = String(dt90.getDate()).padStart(2, '0');
      const dataIniStr = `${y90}-${m90}-${d90}`;

      if (dataFim && !dataFim.value) dataFim.value = hojeStr;
      if (dataIni && !dataIni.value) dataIni.value = dataIniStr;
    },

    bindEvents: function () {
      const btnBuscar = document.getElementById('btnBuscarConsultaCompras');
      const btnLimpar = document.getElementById('btnLimparConsultaCompras');
      const inputPed = document.getElementById('searchComprasPed');
      const inputNFe = document.getElementById('searchComprasNFe');
      const inputCodFornec = document.getElementById('searchComprasCodFornec');
      const inputFornec = document.getElementById('searchComprasFornec');

      // Botão Buscar
      if (btnBuscar) {
        btnBuscar.addEventListener('click', () => this.executarBusca());
      }

      // Botão Limpar
      if (btnLimpar) {
        btnLimpar.addEventListener('click', () => this.limparFiltros());
      }

      // Atalho Enter nos inputs
      [inputPed, inputNFe, inputCodFornec, inputFornec].forEach(input => {
        if (input) {
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              this.executarBusca();
            }
          });
        }
      });

      // Feedback visual de foco / exclusividade mútua
      const tagPed = document.getElementById('tagComprasPed');
      const tagNFe = document.getElementById('tagComprasNFe');
      const tagCodFornec = document.getElementById('tagComprasCodFornec');
      const tagFornec = document.getElementById('tagComprasFornec');

      const atualizarTags = () => {
        const hasPed = inputPed && inputPed.value.trim().length > 0;
        const hasNFe = inputNFe && inputNFe.value.trim().length > 0;
        const hasCodFornec = inputCodFornec && inputCodFornec.value.trim().length > 0;
        const hasFornec = inputFornec && inputFornec.value.trim().length > 0;

        if (tagPed) {
          tagPed.textContent = hasPed ? 'Prioritário' : 'Ativo';
          tagPed.style.background = hasPed ? 'rgba(56, 189, 248, 0.2)' : '';
          tagPed.style.color = hasPed ? '#38bdf8' : '';
        }
        if (tagNFe) {
          tagNFe.textContent = hasNFe ? (hasPed ? 'Secundário' : 'Prioritário') : 'Ativo';
          tagNFe.style.background = hasNFe ? 'rgba(56, 189, 248, 0.2)' : '';
          tagNFe.style.color = hasNFe ? '#38bdf8' : '';
        }
        if (tagCodFornec) {
          tagCodFornec.textContent = hasCodFornec ? ((hasPed || hasNFe) ? 'Secundário' : 'Prioritário') : 'Ativo';
          tagCodFornec.style.background = hasCodFornec ? 'rgba(56, 189, 248, 0.2)' : '';
          tagCodFornec.style.color = hasCodFornec ? '#38bdf8' : '';
        }
        if (tagFornec) {
          tagFornec.textContent = hasFornec ? ((hasPed || hasNFe || hasCodFornec) ? 'Secundário' : 'Prioritário') : 'Ativo';
          tagFornec.style.background = hasFornec ? 'rgba(56, 189, 248, 0.2)' : '';
          tagFornec.style.color = hasFornec ? '#38bdf8' : '';
        }
      };

      if (inputPed) inputPed.addEventListener('input', atualizarTags);
      if (inputNFe) inputNFe.addEventListener('input', atualizarTags);
      if (inputCodFornec) inputCodFornec.addEventListener('input', atualizarTags);
      if (inputFornec) inputFornec.addEventListener('input', atualizarTags);

      // Modal Detalhes NFe
      const modal = document.getElementById('modalNFeEntradaDetalhes');
      const btnCloseX = document.getElementById('btnCloseModalNFeEntrada');
      const btnCloseFooter = document.getElementById('btnFecharModalNFeEntrada');

      if (btnCloseX) btnCloseX.addEventListener('click', () => this.fecharModal());
      if (btnCloseFooter) btnCloseFooter.addEventListener('click', () => this.fecharModal());

      if (modal) {
        modal.addEventListener('click', (e) => {
          if (e.target === modal) this.fecharModal();
        });
      }

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
          this.fecharModal();
        }
      });
    },

    limparFiltros: function () {
      const inputPed = document.getElementById('searchComprasPed');
      const inputNFe = document.getElementById('searchComprasNFe');
      const inputCodFornec = document.getElementById('searchComprasCodFornec');
      const inputFornec = document.getElementById('searchComprasFornec');
      const selectEmpresa = document.getElementById('selectComprasEmpresa');
      const tbody = document.getElementById('comprasTableBody');
      const resultsSection = document.getElementById('comprasResultsSection');
      const emptyState = document.getElementById('comprasEmptyState');

      if (inputPed) inputPed.value = '';
      if (inputNFe) inputNFe.value = '';
      if (inputCodFornec) inputCodFornec.value = '';
      if (inputFornec) inputFornec.value = '';
      if (selectEmpresa) selectEmpresa.value = 'TODAS';

      this.initDefaultDates();

      const tagPed = document.getElementById('tagComprasPed');
      const tagNFe = document.getElementById('tagComprasNFe');
      const tagCodFornec = document.getElementById('tagComprasCodFornec');
      const tagFornec = document.getElementById('tagComprasFornec');
      if (tagPed) { tagPed.textContent = 'Ativo'; tagPed.style.background = ''; tagPed.style.color = ''; }
      if (tagNFe) { tagNFe.textContent = 'Ativo'; tagNFe.style.background = ''; tagNFe.style.color = ''; }
      if (tagCodFornec) { tagCodFornec.textContent = 'Ativo'; tagCodFornec.style.background = ''; tagCodFornec.style.color = ''; }
      if (tagFornec) { tagFornec.textContent = 'Ativo'; tagFornec.style.background = ''; tagFornec.style.color = ''; }

      if (tbody) tbody.innerHTML = '';
      if (resultsSection) resultsSection.classList.add('hidden');
      if (emptyState) emptyState.classList.remove('hidden');
    },

    executarBusca: async function () {
      if (isSearching) return;

      const inputPed = document.getElementById('searchComprasPed');
      const inputNFe = document.getElementById('searchComprasNFe');
      const inputCodFornec = document.getElementById('searchComprasCodFornec');
      const inputFornec = document.getElementById('searchComprasFornec');
      const selectEmpresa = document.getElementById('selectComprasEmpresa');
      const inputDataIni = document.getElementById('searchComprasDataIni');
      const inputDataFim = document.getElementById('searchComprasDataFim');

      const pedValue = inputPed ? inputPed.value.trim() : '';
      const nfeValue = inputNFe ? inputNFe.value.trim() : '';
      const codFornecValue = inputCodFornec ? inputCodFornec.value.trim() : '';
      const fornecValue = inputFornec ? inputFornec.value.trim() : '';
      const empresaValue = selectEmpresa ? selectEmpresa.value : 'TODAS';
      const dataIniValue = inputDataIni ? inputDataIni.value.trim() : '';
      const dataFimValue = inputDataFim ? inputDataFim.value.trim() : '';

      if (!pedValue && !nfeValue && !codFornecValue && !fornecValue) {
        alert('Por favor, preencha o Número do Pedido de Compra, o Número da NFe, o Cód. Fornecedor OU a Razão Social do Fornecedor para buscar.');
        return;
      }

      let tipo = 'nfe';
      let termo = nfeValue;

      if (pedValue) {
        tipo = 'pedCompra';
        termo = pedValue;
      } else if (nfeValue) {
        tipo = 'nfe';
        termo = nfeValue;
      } else if (codFornecValue) {
        tipo = 'codFornec';
        termo = codFornecValue;

        if (!dataIniValue || !dataFimValue) {
          alert('Para pesquisar por Cód. Fornecedor, as datas de emissão inicial e final são obrigatórias.');
          return;
        }

        const dIni = new Date(dataIniValue + 'T00:00:00');
        const dFim = new Date(dataFimValue + 'T00:00:00');
        const diffMs = dFim.getTime() - dIni.getTime();
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays < 0) {
          alert('A Data de Emissão Inicial não pode ser posterior à Data Final.');
          return;
        }

        if (diffDays > 90) {
          alert(`Para pesquisa por Cód. Fornecedor, o intervalo máximo permitido é de 90 dias (você selecionou ${diffDays} dias).\n\nPor favor, reduza o período para proteger a performance do Protheus.`);
          return;
        }
      } else if (fornecValue) {
        tipo = 'fornecedor';
        termo = fornecValue;

        // Validação estrita da trava dos 90 dias
        if (termo.length < 3) {
          alert('Para pesquisar por Fornecedor, informe ao menos 3 caracteres.');
          if (inputFornec) inputFornec.focus();
          return;
        }

        if (!dataIniValue || !dataFimValue) {
          alert('Para pesquisar por Fornecedor, as datas de emissão inicial e final são obrigatórias.');
          return;
        }

        const dIni = new Date(dataIniValue + 'T00:00:00');
        const dFim = new Date(dataFimValue + 'T00:00:00');
        const diffMs = dFim.getTime() - dIni.getTime();
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays < 0) {
          alert('A Data de Emissão Inicial não pode ser posterior à Data Final.');
          return;
        }

        if (diffDays > 90) {
          alert(`Para pesquisa por Fornecedor, o intervalo máximo permitido é de 90 dias (você selecionou ${diffDays} dias).\n\nPor favor, reduza o período para proteger a performance do Protheus.`);
          return;
        }
      }

      const emptyState = document.getElementById('comprasEmptyState');
      const resultsSection = document.getElementById('comprasResultsSection');
      const loading = document.getElementById('comprasLoading');
      const loadingMsg = document.getElementById('comprasLoadingMsg');

      if (emptyState) emptyState.classList.add('hidden');
      if (resultsSection) resultsSection.classList.add('hidden');
      if (loading) loading.classList.remove('hidden');
      if (loadingMsg) {
        const tipoDesc = tipo === 'fornecedor' ? 'fornecedor' : (tipo === 'codFornec' ? 'código de fornecedor' : (tipo === 'pedCompra' ? 'pedido de compra' : 'nota fiscal'));
        loadingMsg.textContent = `Consultando ${tipoDesc} "${termo}" no Protheus...`;
      }

      isSearching = true;

      try {
        const token = localStorage.getItem('token');
        const params = new URLSearchParams({
          tipo: tipo,
          termo: termo,
          empresa: empresaValue,
          dataIni: dataIniValue,
          dataFim: dataFimValue
        });

        const res = await fetch(`/api/compras/consulta-ped-nf?${params.toString()}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        const data = await res.json();

        if (!data.success) {
          throw new Error(data.message || 'Erro na consulta de compras.');
        }

        this.renderResultados(data.rows || [], tipo, termo, empresaValue);
      } catch (err) {
        alert('Erro ao consultar no Protheus: ' + err.message);
        console.error('Erro na consulta de compras:', err);
        if (emptyState) emptyState.classList.remove('hidden');
      } finally {
        if (loading) loading.classList.add('hidden');
        isSearching = false;
      }
    },

    renderResultados: function (rows, tipo, termo, empresa) {
      const tbody = document.getElementById('comprasTableBody');
      const resultsSection = document.getElementById('comprasResultsSection');
      const emptyState = document.getElementById('comprasEmptyState');
      const countBadge = document.getElementById('comprasResultsCountBadge');
      const paramInfo = document.getElementById('comprasSearchParamInfo');

      if (!tbody) return;
      tbody.innerHTML = '';

      if (rows.length === 0) {
        if (resultsSection) resultsSection.classList.add('hidden');
        if (emptyState) {
          emptyState.innerHTML = `
            <div class="empty-icon" style="font-size: 2.5rem; margin-bottom: 0.5rem;">🔎</div>
            <h4 style="margin: 0 0 0.5rem; font-size: 1.1rem;">Nenhum registro localizado</h4>
            <p style="color: var(--text-muted); font-size: 0.88rem; max-width: 600px; margin: 0 auto;">
              Não encontramos notas fiscais ou pedidos de compra correspondentes a <strong>"${escapeHtml(termo)}"</strong> nas empresas consultadas. Verifique a grafia ou o período de emissão.
            </p>
          `;
          emptyState.classList.remove('hidden');
        }
        return;
      }

      rows.forEach(row => {
        const tr = document.createElement('tr');

        // Badge de Empresa
        let empColor = '#38bdf8';
        let empBg = 'rgba(56, 189, 248, 0.12)';
        let empBorder = 'rgba(56, 189, 248, 0.3)';
        if (row.empresa === 'MP' || row.empresaKey === 'METAL_PLENO') {
          empColor = '#f59e0b';
          empBg = 'rgba(245, 158, 11, 0.12)';
          empBorder = 'rgba(245, 158, 11, 0.3)';
        } else if (row.empresa === 'GSI') {
          empColor = '#0284c7';
          empBg = 'rgba(2, 132, 199, 0.12)';
          empBorder = 'rgba(2, 132, 199, 0.3)';
        } else if (row.empresa === 'OACO') {
          empColor = '#10b981';
          empBg = 'rgba(16, 185, 129, 0.12)';
          empBorder = 'rgba(16, 185, 129, 0.3)';
        }

        const empBadge = `<span class="badge-tag" style="background: ${empBg}; color: ${empColor}; border: 1px solid ${empBorder}; font-weight: 700; padding: 2px 8px; border-radius: 4px;">${escapeHtml(row.empresa)}</span>`;

        // Pedido de Compra
        let pedHtml = `<span style="color: var(--text-muted);">-</span>`;
        if (row.temPedCompra && row.pedCompra && row.pedCompra !== '-') {
          pedHtml = `<span class="badge-tag" style="background: rgba(56, 189, 248, 0.12); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.25); font-weight: 600; padding: 2px 8px; border-radius: 4px;">#${escapeHtml(row.pedCompra)}</span>`;
        }

        // NFe
        let nfHtml = `<span style="color: var(--text-muted);">-</span>`;
        if (row.temNfe && row.nfe && row.nfe !== '-') {
          const serieTxt = row.serie ? ` <small style="color: var(--text-muted);">(${escapeHtml(row.serie)})</small>` : '';
          nfHtml = `<strong>${escapeHtml(row.nfe)}</strong>${serieTxt}`;
        } else if (!row.temNfe) {
          nfHtml = `<span class="badge-tag" style="background: rgba(245, 158, 11, 0.12); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); font-weight: 600; font-size: 0.78rem; padding: 2px 6px; border-radius: 4px;">Pendente (Sem NF)</span>`;
        }

        // Razão Social / Fornecedor
        const cnpjFormatted = row.cnpj ? `<br><small style="color: var(--text-muted); font-family: monospace; font-size: 0.78rem;">${formatCnpj(row.cnpj)}</small>` : '';
        const razaoHtml = `<strong>${escapeHtml(row.razaoSocial)}</strong>${cnpjFormatted}`;

        // Botão Ver
        let btnVerHtml = '';
        if (row.temNfe && row.nfe && row.nfe !== '-') {
          btnVerHtml = `
            <button type="button" class="btn btn-outline btn-sm btn-ver-nfe" 
                    data-empresa="${escapeHtml(row.empresaKey || row.empresa)}" 
                    data-doc="${escapeHtml(row.nfe)}" 
                    data-serie="${escapeHtml(row.serie || '')}" 
                    data-fornece="${escapeHtml(row.fornece || '')}" 
                    data-loja="${escapeHtml(row.loja || '01')}" 
                    style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; font-size: 0.8rem; cursor: pointer;">
              <span>👁️ Ver</span>
            </button>
          `;
        } else if (row.temPedCompra && row.pedCompra && row.pedCompra !== '-') {
          btnVerHtml = `
            <button type="button" class="btn btn-outline btn-sm btn-ver-ped-compra" 
                    data-empresa="${escapeHtml(row.empresaKey || row.empresa)}" 
                    data-numped="${escapeHtml(row.pedCompra)}" 
                    style="display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; font-size: 0.8rem; cursor: pointer;">
              <span>📋 Ver Ped.</span>
            </button>
          `;
        } else {
          btnVerHtml = `<span style="color: var(--text-muted);">-</span>`;
        }

        tr.innerHTML = `
          <td>${empBadge}</td>
          <td>${razaoHtml}</td>
          <td>${pedHtml}</td>
          <td class="mono-text">${nfHtml}</td>
          <td>${escapeHtml(row.emissao || '-')}</td>
          <td class="mono-text" style="text-align: right; font-weight: 700; color: #10b981;">${formatCurrency(row.valorNf || 0)}</td>
          <td style="text-align: center;">${btnVerHtml}</td>
        `;

        tbody.appendChild(tr);
      });

      // Bind botões "Ver"
      tbody.querySelectorAll('.btn-ver-nfe').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const b = e.currentTarget;
          this.abrirDetalhesNFe({
            empresaKey: b.getAttribute('data-empresa'),
            doc: b.getAttribute('data-doc'),
            serie: b.getAttribute('data-serie'),
            fornece: b.getAttribute('data-fornece'),
            loja: b.getAttribute('data-loja')
          });
        });
      });

      tbody.querySelectorAll('.btn-ver-ped-compra').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const b = e.currentTarget;
          const empresaKey = b.getAttribute('data-empresa');
          const numPed = b.getAttribute('data-numped');
          if (typeof window.abrirModalPedidoCompraDetalhes === 'function') {
            window.abrirModalPedidoCompraDetalhes(empresaKey, numPed);
          } else {
            alert(`Pedido de Compra #${numPed} (${empresaKey}): mercadoria ainda não recebida (Sem NF de entrada no Protheus).`);
          }
        });
      });

      if (countBadge) {
        countBadge.textContent = `${rows.length} ${rows.length === 1 ? 'registro encontrado' : 'registros encontrados'}`;
      }

      if (paramInfo) {
        let descTipo = 'NFe de Entrada';
        if (tipo === 'pedCompra') descTipo = 'Pedido de Compra';
        else if (tipo === 'codFornec') descTipo = 'Cód. Fornecedor';
        else if (tipo === 'fornecedor') descTipo = 'Fornecedor';
        paramInfo.innerHTML = `Critério: <strong>${descTipo} (${escapeHtml(termo)})</strong> | Empresa: <strong>${escapeHtml(empresa)}</strong>`;
      }

      if (emptyState) emptyState.classList.add('hidden');
      if (resultsSection) resultsSection.classList.remove('hidden');
    },

    abrirDetalhesNFe: async function ({ empresaKey, doc, serie, fornece, loja }) {
      const modal = document.getElementById('modalNFeEntradaDetalhes');
      const modalBody = document.getElementById('modalNFeEntradaBody');
      const modalNum = document.getElementById('modalNFeNum');
      const modalBadge = document.getElementById('modalNFeEmpresaBadge');
      const modalSub = document.getElementById('modalNFeSubtitulo');

      if (!modal || !modalBody) return;

      this.sincronizarTemaModal();

      if (modalNum) modalNum.textContent = doc ? `#${doc}` : '-';
      if (modalBadge) {
        let badgeBg = 'rgba(56, 189, 248, 0.15)';
        let badgeColor = '#38bdf8';
        if (empresaKey === 'MP' || empresaKey === 'METAL_PLENO' || empresaKey === '14') {
          badgeBg = 'rgba(245, 158, 11, 0.15)';
          badgeColor = '#f59e0b';
        } else if (empresaKey === 'OACO' || empresaKey === '16') {
          badgeBg = 'rgba(16, 185, 129, 0.15)';
          badgeColor = '#10b981';
        }
        modalBadge.innerHTML = `<span class="badge" style="background: ${badgeBg}; color: ${badgeColor}; font-weight: 700; margin-left: 6px; padding: 2px 8px; border-radius: 4px;">${escapeHtml(empresaKey)}</span>`;
      }
      if (modalSub) {
        modalSub.textContent = `Carregando dados da NF-e no Protheus...`;
      }

      modalBody.innerHTML = `
        <div style="text-align: center; padding: 3rem 1rem;">
          <div class="spinner" style="margin: 0 auto 1rem;"></div>
          <p style="color: var(--text-muted); font-size: 0.95rem;">Buscando itens (SD1), impostos (SF1) e contas a pagar (SE2)...</p>
        </div>
      `;

      modal.classList.remove('hidden');

      try {
        const token = localStorage.getItem('token');
        const params = new URLSearchParams({ empresaKey, doc, serie, fornece, loja });
        const res = await fetch(`/api/compras/nfe-entrada-detalhes?${params.toString()}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await res.json();
        if (!data.success) {
          throw new Error(data.message || 'Erro ao carregar detalhes da NFe.');
        }

        this.renderDetalhesNFe(data.data);
      } catch (err) {
        modalBody.innerHTML = `
          <div style="padding: 2rem; text-align: center; color: #ef4444;">
            <div style="font-size: 2rem; margin-bottom: 0.5rem;">⚠️</div>
            <p><strong>Erro ao carregar detalhes da NFe:</strong> ${escapeHtml(err.message)}</p>
          </div>
        `;
      }
    },

    renderDetalhesNFe: function (dados) {
      const modalBody = document.getElementById('modalNFeEntradaBody');
      const modalSub = document.getElementById('modalNFeSubtitulo');
      if (!modalBody || !dados) return;

      const h = dados.header || {};
      const itens = dados.itens || [];
      const titulos = dados.titulos || [];

      if (modalSub) {
        modalSub.textContent = `${h.fornecedor || 'Fornecedor'} • Emissão: ${h.emissao || '-'} • Entrada: ${h.digitacao || '-'}`;
      }

      // Bloco Chave NFe
      let chaveHtml = '';
      if (h.chaveNfe) {
        chaveHtml = `
          <div style="background: rgba(15, 23, 42, 0.4); border: 1px solid var(--panel-border); border-radius: 8px; padding: 10px 14px; margin-bottom: 1.25rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; min-width: 260px;">
              <span style="font-size: 0.8rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">Chave de Acesso:</span>
              <span id="chaveNFeValor" class="mono-text" style="font-size: 0.82rem; letter-spacing: 0.04em; color: var(--primary-color, #38bdf8); word-break: break-all;">${escapeHtml(h.chaveNfe)}</span>
            </div>
            <button type="button" id="btnCopiarChaveNFe" class="btn btn-outline btn-sm" style="display: flex; align-items: center; gap: 6px; padding: 4px 10px; font-size: 0.78rem; cursor: pointer;">
              <span>📋 Copiar Chave</span>
            </button>
          </div>
        `;
      }

      // Bloco Fornecedor & Dados Gerais (Grid 2 colunas)
      const fornecedorHtml = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem; margin-bottom: 1.25rem;">
          <div style="background: rgba(15, 23, 42, 0.3); border: 1px solid var(--panel-border); border-radius: 8px; padding: 12px 14px;">
            <div style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; color: var(--text-muted); margin-bottom: 6px;">Dados do Fornecedor</div>
            <div style="font-size: 1rem; font-weight: 700; margin-bottom: 4px;">${escapeHtml(h.fornecedor)}</div>
            ${h.fantasia ? `<div style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 4px;">Fantasia: ${escapeHtml(h.fantasia)}</div>` : ''}
            <div style="font-size: 0.82rem; font-family: monospace;">CNPJ: <strong>${formatCnpj(h.cnpj)}</strong> • Cód: ${escapeHtml(h.fornece || '-')}/${escapeHtml(h.loja || '01')}</div>
            <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 2px;">Localidade: ${escapeHtml(h.cidade || '-')}/${escapeHtml(h.uf || '-')}</div>
          </div>

          <div style="background: rgba(15, 23, 42, 0.3); border: 1px solid var(--panel-border); border-radius: 8px; padding: 12px 14px;">
            <div style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; color: var(--text-muted); margin-bottom: 6px;">Condições e Datas</div>
            <div style="font-size: 0.88rem; margin-bottom: 6px;">
              Condição de Pagto: <strong style="color: #38bdf8;">${escapeHtml(h.condPagtoDesc || h.condPagto || 'Não informada')}</strong>
            </div>
            <div style="display: flex; gap: 1.5rem; font-size: 0.85rem;">
              <div>Data Emissão: <strong>${escapeHtml(h.emissao || '-')}</strong></div>
              <div>Data Entrada: <strong>${escapeHtml(h.digitacao || '-')}</strong></div>
            </div>
            <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 6px;">
              Filial Protheus: <code>${escapeHtml(h.filial || '01')}</code> • Série: <code>${escapeHtml(h.serie || 'Única')}</code>
            </div>
          </div>
        </div>
      `;

      // Cards de Resumo Financeiro da NF
      const totaisHtml = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 0.75rem; margin-bottom: 1.25rem;">
          <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 8px; padding: 8px 12px;">
            <div style="font-size: 0.72rem; font-weight: 600; text-transform: uppercase; color: var(--text-muted);">Valor Total Bruto</div>
            <div style="font-size: 1.2rem; font-weight: 700; color: #10b981; margin-top: 2px;">${formatCurrency(h.valorBruto)}</div>
          </div>
          <div style="background: rgba(15, 23, 42, 0.3); border: 1px solid var(--panel-border); border-radius: 8px; padding: 8px 12px;">
            <div style="font-size: 0.72rem; font-weight: 600; text-transform: uppercase; color: var(--text-muted);">Mercadorias</div>
            <div style="font-size: 1.1rem; font-weight: 700; margin-top: 2px;">${formatCurrency(h.valorMercadoria)}</div>
          </div>
          <div style="background: rgba(15, 23, 42, 0.3); border: 1px solid var(--panel-border); border-radius: 8px; padding: 8px 12px;">
            <div style="font-size: 0.72rem; font-weight: 600; text-transform: uppercase; color: var(--text-muted);">Frete</div>
            <div style="font-size: 1.1rem; font-weight: 700; margin-top: 2px;">${formatCurrency(h.valorFrete)}</div>
          </div>
          <div style="background: rgba(15, 23, 42, 0.3); border: 1px solid var(--panel-border); border-radius: 8px; padding: 8px 12px;">
            <div style="font-size: 0.72rem; font-weight: 600; text-transform: uppercase; color: var(--text-muted);">Descontos</div>
            <div style="font-size: 1.1rem; font-weight: 700; color: #f59e0b; margin-top: 2px;">${formatCurrency(h.valorDesconto)}</div>
          </div>
          <div style="background: rgba(15, 23, 42, 0.3); border: 1px solid var(--panel-border); border-radius: 8px; padding: 8px 12px;">
            <div style="font-size: 0.72rem; font-weight: 600; text-transform: uppercase; color: var(--text-muted);">Valor ICMS</div>
            <div style="font-size: 1.1rem; font-weight: 700; margin-top: 2px;">${formatCurrency(h.valorIcms)}</div>
          </div>
          <div style="background: rgba(15, 23, 42, 0.3); border: 1px solid var(--panel-border); border-radius: 8px; padding: 8px 12px;">
            <div style="font-size: 0.72rem; font-weight: 600; text-transform: uppercase; color: var(--text-muted);">Valor IPI</div>
            <div style="font-size: 1.1rem; font-weight: 700; margin-top: 2px;">${formatCurrency(h.valorIpi)}</div>
          </div>
        </div>
      `;

      // Grade de Itens da NF (SD1)
      let itensRows = '';
      itens.forEach(it => {
        const pedBadge = (it.pedidoCompra && it.pedidoCompra !== '-')
          ? `<span class="badge-tag" style="background: rgba(56, 189, 248, 0.12); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.25); font-weight: 600; padding: 2px 6px; border-radius: 4px;">#${escapeHtml(it.pedidoCompra)}${it.itemPc ? ` <small>(${escapeHtml(it.itemPc)})</small>` : ''}</span>`
          : `<span style="color: var(--text-muted);">-</span>`;

        itensRows += `
          <tr>
            <td style="font-weight: 600; color: var(--text-muted); text-align: center;">${escapeHtml(it.item)}</td>
            <td class="mono-text" style="font-size: 0.82rem;">${escapeHtml(it.codigo)}</td>
            <td><strong>${escapeHtml(it.descricao)}</strong></td>
            <td style="text-align: center;">${escapeHtml(it.um)}</td>
            <td style="text-align: right; font-weight: 700;">${it.quantidade}</td>
            <td style="text-align: right;" class="mono-text">${formatCurrency(it.valorUnitario)}</td>
            <td style="text-align: right; font-weight: 700; color: #10b981;" class="mono-text">${formatCurrency(it.valorTotal)}</td>
            <td style="font-size: 0.8rem;" title="${escapeHtml(it.tesDesc)}">
              <code>${escapeHtml(it.tes)}</code>
              ${it.tesDesc ? `<br><small style="color: var(--text-muted);">${escapeHtml(it.tesDesc)}</small>` : ''}
            </td>
            <td style="text-align: center;"><code>${escapeHtml(it.cfop || '-')}</code></td>
            <td style="text-align: center;">${pedBadge}</td>
          </tr>
        `;
      });

      const tabelaItensHtml = `
        <div style="margin-bottom: 1.5rem;">
          <div style="font-size: 0.95rem; font-weight: 700; margin-bottom: 0.5rem; display: flex; align-items: center; justify-content: space-between;">
            <span>📦 Itens da Nota Fiscal (${itens.length})</span>
            <small style="color: var(--text-muted); font-weight: normal;">Tabela SD1 + SB1 + SF4</small>
          </div>
          <div class="table-responsive" style="max-height: 280px; overflow-y: auto; border: 1px solid var(--panel-border); border-radius: 8px;">
            <table class="data-table" style="margin: 0;">
              <thead>
                <tr>
                  <th style="width: 5%; text-align: center;">Item</th>
                  <th style="width: 14%;">Código</th>
                  <th style="width: 27%;">Descrição do Produto</th>
                  <th style="width: 5%; text-align: center;">UM</th>
                  <th style="width: 7%; text-align: right;">Qtd</th>
                  <th style="width: 10%; text-align: right;">Unitário</th>
                  <th style="width: 11%; text-align: right;">Total</th>
                  <th style="width: 11%;">TES</th>
                  <th style="width: 5%; text-align: center;">CFOP</th>
                  <th style="width: 10%; text-align: center;">Ped. Compra</th>
                </tr>
              </thead>
              <tbody>
                ${itensRows || '<tr><td colspan="10" style="text-align: center; color: var(--text-muted); padding: 1rem;">Nenhum item localizado na SD1.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      `;

      // Seção Títulos no Contas a Pagar (SE2)
      let titulosRows = '';
      titulos.forEach(t => {
        let statusBadge = `<span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; padding: 2px 8px; border-radius: 4px; font-weight: 700; font-size: 0.78rem;">ABERTO</span>`;
        if (t.status === 'PAGO') {
          statusBadge = `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; padding: 2px 8px; border-radius: 4px; font-weight: 700; font-size: 0.78rem;">PAGO</span>`;
        } else if (t.status === 'PARCIAL') {
          statusBadge = `<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; padding: 2px 8px; border-radius: 4px; font-weight: 700; font-size: 0.78rem;">PARCIAL</span>`;
        }

        titulosRows += `
          <tr>
            <td style="text-align: center;"><code>${escapeHtml(t.prefixo || '-')}</code></td>
            <td class="mono-text"><strong>${escapeHtml(t.num)}</strong></td>
            <td style="text-align: center;">${escapeHtml(t.parcela)}</td>
            <td style="text-align: center;"><code>${escapeHtml(t.tipo)}</code></td>
            <td style="text-align: right; font-weight: 700;" class="mono-text">${formatCurrency(t.valor)}</td>
            <td style="text-align: right; color: #f59e0b;" class="mono-text">${formatCurrency(t.saldo)}</td>
            <td style="text-align: center;"><strong>${escapeHtml(t.vencimento)}</strong></td>
            <td style="text-align: center;">${escapeHtml(t.baixa || '-')}</td>
            <td style="text-align: center;">${statusBadge}</td>
          </tr>
        `;
      });

      const titulosHtml = `
        <div>
          <div style="font-size: 0.95rem; font-weight: 700; margin-bottom: 0.5rem; display: flex; align-items: center; justify-content: space-between;">
            <span>💰 Financeiro / Contas a Pagar (${titulos.length})</span>
            <small style="color: var(--text-muted); font-weight: normal;">Tabela SE2</small>
          </div>
          ${titulos.length > 0 ? `
            <div class="table-responsive" style="border: 1px solid var(--panel-border); border-radius: 8px;">
              <table class="data-table" style="margin: 0;">
                <thead>
                  <tr>
                    <th style="width: 8%; text-align: center;">Prefixo</th>
                    <th style="width: 14%;">Título</th>
                    <th style="width: 10%; text-align: center;">Parcela</th>
                    <th style="width: 8%; text-align: center;">Tipo</th>
                    <th style="width: 14%; text-align: right;">Valor</th>
                    <th style="width: 14%; text-align: right;">Saldo</th>
                    <th style="width: 12%; text-align: center;">Vencimento</th>
                    <th style="width: 10%; text-align: center;">Data Baixa</th>
                    <th style="width: 10%; text-align: center;">Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${titulosRows}
                </tbody>
              </table>
            </div>
          ` : `
            <div style="background: rgba(15, 23, 42, 0.2); border: 1px dashed var(--panel-border); border-radius: 8px; padding: 1rem; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
              Nenhum título financeiro encontrado no Contas a Pagar (SE2) para este documento (pode ser nota sem duplicatas, remessa ou já liquidada anteriormente).
            </div>
          `}
        </div>
      `;

      modalBody.innerHTML = `
        ${chaveHtml}
        ${fornecedorHtml}
        ${totaisHtml}
        ${tabelaItensHtml}
        ${titulosHtml}
      `;

      // Bind botão copiar chave
      const btnCopiar = document.getElementById('btnCopiarChaveNFe');
      if (btnCopiar && h.chaveNfe) {
        btnCopiar.addEventListener('click', () => {
          navigator.clipboard.writeText(h.chaveNfe).then(() => {
            const originalHtml = btnCopiar.innerHTML;
            btnCopiar.innerHTML = `<span style="color: #10b981;">✓ Copiado!</span>`;
            setTimeout(() => { btnCopiar.innerHTML = originalHtml; }, 2000);
          }).catch(() => {
            alert('Não foi possível copiar para a área de transferência.');
          });
        });
      }
    },

    fecharModal: function () {
      const modal = document.getElementById('modalNFeEntradaDetalhes');
      if (modal) modal.classList.add('hidden');
    },

    sincronizarTemaModal: function () {
      const modal = document.getElementById('modalNFeEntradaDetalhes');
      if (!modal) return;
      
      const tabCompras = document.getElementById('tab-compras-consulta-ped-nf');
      const isLight = (tabCompras && tabCompras.classList.contains('tab-theme-light')) ||
                      localStorage.getItem('theme_vendedores') === 'light' ||
                      localStorage.getItem('theme_saldos_estoque') === 'light';

      if (isLight) {
        modal.classList.add('modal-theme-light');
      } else {
        modal.classList.remove('modal-theme-light');
      }
    }
  };

  window.ComprasConsultaPedNfModule = ComprasConsultaPedNfModule;
})();
