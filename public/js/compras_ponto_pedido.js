/**
 * compras_ponto_pedido.js
 * 
 * Módulo Frontend Isolado: Ponto de Pedido Ideal (Módulo Compras)
 * 
 * Responsável por:
 * 1. Autocomplete inteligente de produtos com debounce (sem onerar o banco)
 * 2. Validação e disparo do estudo de Ponto de Pedido
 * 3. Modal de 2 fases:
 *    - Fase A (Loading imediato): "Verificando histórico... Calculando..."
 *    - Fase B (Resultado claro): "De acordo com o histórico consolidado, o ponto de pedido recomendado:"
 *      com número da quantidade em grande evidência e destaque visual
 * 4. Bloco expansível "+info" com memória de cálculo matemática e fotos do Protheus
 * 5. Alerta de Ruptura em Curso quando estoque = 0 e há pedidos atrasados na SC6
 * 6. Cópia do relatório formatado em Markdown para área de transferência
 */

(function () {
  'use strict';

  let currentEstudoData = null;
  let debounceTimer = null;
  let isSearching = false;

  const ComprasPontoPedidoModule = {
    _initialized: false,

    init: function () {
      if (this._initialized) {
        this.sincronizarTemaModal();
        return;
      }
      this._initialized = true;
      this.bindEvents();
    },

    bindEvents: function () {
      const inputBusca = document.getElementById('pontoPedidoInputProduto');
      const btnCalcular = document.getElementById('btnCalcularPontoPedido');
      const btnFecharModal = document.getElementById('btnFecharModalPontoPedido');
      const btnFecharModalFooter = document.getElementById('btnFecharModalPontoPedidoFooter');
      const btnToggleInfo = document.getElementById('btnToggleInfoPontoPedido');
      const btnCopiarMarkdown = document.getElementById('btnCopiarMarkdownPontoPedido');
      const modal = document.getElementById('modalPontoPedidoIdeal');

      if (inputBusca) {
        // Autocomplete no input
        inputBusca.addEventListener('input', (e) => {
          const val = e.target.value.trim();
          this.handleAutocomplete(val);
        });

        // Atalho Enter
        inputBusca.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            this.fecharSugestoes();
            this.dispararCalculo();
          } else if (e.key === 'Escape') {
            this.fecharSugestoes();
          }
        });

        // Fecha autocomplete ao clicar fora
        document.addEventListener('click', (e) => {
          const container = document.getElementById('pontoPedidoAutocompleteContainer');
          if (container && !container.contains(e.target) && e.target !== inputBusca) {
            this.fecharSugestoes();
          }
        });
      }

      if (btnCalcular) {
        btnCalcular.addEventListener('click', () => {
          this.fecharSugestoes();
          this.dispararCalculo();
        });
      }

      if (btnFecharModal) {
        btnFecharModal.addEventListener('click', () => this.fecharModal());
      }
      if (btnFecharModalFooter) {
        btnFecharModalFooter.addEventListener('click', () => this.fecharModal());
      }

      // Fechar modal ao clicar fora (backdrop)
      if (modal) {
        modal.addEventListener('click', (e) => {
          if (e.target === modal) {
            this.fecharModal();
          }
        });
      }

      // Fechar modal ao pressionar tecla Escape
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          const modalEl = document.getElementById('modalPontoPedidoIdeal');
          if (modalEl && modalEl.style.display !== 'none') {
            this.fecharModal();
          }
        }
      });

      if (btnToggleInfo) {
        btnToggleInfo.addEventListener('click', () => this.toggleInfo());
      }

      if (btnCopiarMarkdown) {
        btnCopiarMarkdown.addEventListener('click', () => this.copiarRelatorioMarkdown());
      }
    },

    handleAutocomplete: function (termo) {
      clearTimeout(debounceTimer);
      const listEl = document.getElementById('pontoPedidoSugestoesList');
      if (!listEl) return;

      if (!termo || termo.length < 2) {
        this.fecharSugestoes();
        return;
      }

      debounceTimer = setTimeout(async () => {
        try {
          const token = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
          const res = await fetch(`/api/compras/ponto-pedido/produtos?q=${encodeURIComponent(termo)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const json = await res.json();

          if (json.success && Array.isArray(json.produtos) && json.produtos.length > 0) {
            this.renderSugestoes(json.produtos);
          } else {
            this.fecharSugestoes();
          }
        } catch (err) {
          console.warn('Aviso no autocomplete de produtos:', err.message);
          this.fecharSugestoes();
        }
      }, 300);
    },

    renderSugestoes: function (produtos) {
      const listEl = document.getElementById('pontoPedidoSugestoesList');
      if (!listEl) return;

      listEl.innerHTML = '';
      produtos.forEach(p => {
        const item = document.createElement('div');
        item.className = 'ponto-pedido-autocomplete-item';
        item.setAttribute('role', 'option');
        item.innerHTML = `
          <div style="font-weight: 600; display: flex; justify-content: space-between; align-items: center;">
            <span class="ponto-pedido-item-title">${this.escapeHtml(p.descricao || p.codigo)}</span>
            <span class="ponto-pedido-item-code" style="font-size: 0.75rem; color: #38bdf8; font-family: monospace;">${this.escapeHtml(p.codigo)}</span>
          </div>
          <div class="ponto-pedido-item-meta" style="font-size: 0.75rem; color: var(--text-muted, #94a3b8); display: flex; gap: 12px; margin-top: 3px;">
            <span>Grupo: ${this.escapeHtml(p.grupo || '-')}</span>
            <span>Saldo: ${Number(p.saldo) || 0} un</span>
            <span>PP Cadastrado: ${Number(p.ponto_ped) || 0} un</span>
          </div>
        `;

        item.addEventListener('click', () => {
          const inputBusca = document.getElementById('pontoPedidoInputProduto');
          if (inputBusca) {
            inputBusca.value = p.codigo;
          }
          this.fecharSugestoes();
          this.dispararCalculo();
        });

        listEl.appendChild(item);
      });

      listEl.style.display = 'block';
    },

    fecharSugestoes: function () {
      const listEl = document.getElementById('pontoPedidoSugestoesList');
      if (listEl) {
        listEl.style.display = 'none';
        listEl.innerHTML = '';
      }
    },

    dispararCalculo: async function () {
      const inputBusca = document.getElementById('pontoPedidoInputProduto');
      const inputLeadTime = document.getElementById('pontoPedidoInputLeadTime');
      const identificador = inputBusca ? inputBusca.value.trim() : '';
      const leadTimeCustom = inputLeadTime ? inputLeadTime.value.trim() : '';

      if (!identificador) {
        if (typeof showToast === 'function') {
          showToast('Informe o código do produto, ID do Pipedrive ou nome para calcular.', 'warning');
        } else {
          alert('Informe o código do produto, ID do Pipedrive ou nome para calcular.');
        }
        if (inputBusca) inputBusca.focus();
        return;
      }

      // Abre o modal em estado de LOADING imediato
      this.abrirModalLoading(identificador);

      try {
        const token = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
        const res = await fetch('/api/compras/ponto-pedido/calcular', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ identificador, leadTimeCustom: leadTimeCustom ? Number(leadTimeCustom) : undefined })
        });

        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.message || 'Falha ao consultar histórico do Protheus.');
        }

        currentEstudoData = json;
        this.renderResultado(json);
      } catch (err) {
        console.error('Erro no cálculo do ponto de pedido:', err);
        this.renderErro(err.message || 'Erro de comunicação ao calcular ponto de pedido.');
      }
    },

    abrirModalLoading: function (termo) {
      const modal = document.getElementById('modalPontoPedidoIdeal');
      const loadingState = document.getElementById('pontoPedidoLoadingState');
      const resultState = document.getElementById('pontoPedidoResultState');
      const errorState = document.getElementById('pontoPedidoErrorState');
      const termoEl = document.getElementById('pontoPedidoLoadingTermo');

      if (!modal) return;

      if (termoEl) termoEl.textContent = termo;
      if (loadingState) loadingState.style.display = 'flex';
      if (resultState) resultState.style.display = 'none';
      if (errorState) errorState.style.display = 'none';

      // Sincroniza tema Claro/Escuro
      this.sincronizarTemaModal();

      modal.style.display = 'flex';
    },

    renderResultado: function (data) {
      const loadingState = document.getElementById('pontoPedidoLoadingState');
      const resultState = document.getElementById('pontoPedidoResultState');
      const errorState = document.getElementById('pontoPedidoErrorState');

      if (loadingState) loadingState.style.display = 'none';
      if (errorState) errorState.style.display = 'none';
      if (resultState) resultState.style.display = 'block';

      // 1. Informações do Produto
      const prod = data.produto || {};
      const res = data.resultado || {};
      const met = data.metricas12M || {};
      const est = data.estoque || {};
      const cen = data.cenarios || {};
      const fin = data.financeiro || {};

      const nomeProdEl = document.getElementById('pontoPedidoModalNomeProd');
      const codProdEl = document.getElementById('pontoPedidoModalCodProd');
      const pipedriveEl = document.getElementById('pontoPedidoModalPipedrive');
      const statusBloqEl = document.getElementById('pontoPedidoModalStatusBloq');

      if (nomeProdEl) nomeProdEl.textContent = prod.descricao || 'PRODUTO';
      if (codProdEl) codProdEl.textContent = prod.codigo || '-';
      if (pipedriveEl) {
        if (prod.pipedriveId && prod.pipedriveId !== '-') {
          pipedriveEl.innerHTML = `<span style="color:#a855f7;">Pipedrive ID: <b>${this.escapeHtml(prod.pipedriveId)}</b></span>`;
          pipedriveEl.style.display = 'inline';
        } else {
          pipedriveEl.style.display = 'none';
        }
      }

      if (statusBloqEl) {
        if (prod.bloqueado) {
          statusBloqEl.innerHTML = `<span class="badge" style="background:#ef4444; color:#fff;">⚠️ PRODUTO BLOQUEADO NO PROTHEUS</span>`;
          statusBloqEl.style.display = 'inline-block';
        } else {
          statusBloqEl.style.display = 'none';
        }
      }

      // 2. Quantidade em Evidência (Maior e cor destacada)
      const qtdDestaqueEl = document.getElementById('pontoPedidoQtdDestaque');
      if (qtdDestaqueEl) {
        qtdDestaqueEl.textContent = `${res.pontoPedidoRecomendado} ${res.unidadeMedida || 'unidades'}`;
        if (res.rupturaEmCurso) {
          qtdDestaqueEl.style.color = '#f43f5e'; // Vermelho vibrante
        } else if (res.estoqueCritico) {
          qtdDestaqueEl.style.color = '#f59e0b'; // Âmbar de atenção
        } else {
          qtdDestaqueEl.style.color = '#10b981'; // Verde esmeralda
        }
      }

      // 3. Alerta de Ruptura ou Estoque Crítico
      const alertaBoxEl = document.getElementById('pontoPedidoAlertaBox');
      if (alertaBoxEl) {
        if (res.rupturaEmCurso) {
          alertaBoxEl.style.display = 'block';
          alertaBoxEl.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
          alertaBoxEl.style.borderColor = '#ef4444';
          alertaBoxEl.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px; color:#ef4444; font-weight:700;">
              <span>⚠️ RUPTURA EM CURSO</span>
            </div>
            <p style="margin:4px 0 0 0; font-size:0.85rem; color:#fca5a5;">
              O estoque físico atual é de <b>0 un</b> e há <b>${Number(est.pedidosAbertosQtd) || 0} pedido(s) de venda em aberto aguardando atendimento</b>.
              Sugestão de reposição urgente: <b>${Number(res.compraUrgenteQtd) || 0} unidades</b>.
            </p>
          `;
        } else if (res.estoqueCritico) {
          alertaBoxEl.style.display = 'block';
          alertaBoxEl.style.backgroundColor = 'rgba(245, 158, 11, 0.15)';
          alertaBoxEl.style.borderColor = '#f59e0b';
          alertaBoxEl.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px; color:#f59e0b; font-weight:700;">
              <span>🟡 ATENÇÃO: ESTOQUE ABAIXO DO PONTO DE PEDIDO</span>
            </div>
            <p style="margin:4px 0 0 0; font-size:0.85rem; color:#fcd34d;">
              O saldo físico atual (${Number(est.saldoFisicoTotal) || 0} un) está abaixo da margem de segurança recomendada (${Number(res.pontoPedidoRecomendado) || 0} un).
              Sugestão de compra de <b>${Number(res.compraUrgenteQtd) || 0} unidades</b>.
            </p>
          `;
        } else {
          alertaBoxEl.style.display = 'none';
        }
      }

      // 4. Preenchimento dos Detalhes (+info)
      this.preencherDetalhesInfo(data);

      // Reseta estado do botão +info para recolhido
      const infoContainer = document.getElementById('pontoPedidoDetalhesInfo');
      const btnToggle = document.getElementById('btnToggleInfoPontoPedido');
      if (infoContainer) infoContainer.style.display = 'none';
      if (btnToggle) {
        btnToggle.innerHTML = `<span>ℹ️ +info (Ver estudo completo e números que geraram o resultado)</span> <span>▼</span>`;
        btnToggle.setAttribute('aria-expanded', 'false');
      }
    },

    preencherDetalhesInfo: function (data) {
      const prod = data.produto || {};
      const res = data.resultado || {};
      const met = data.metricas12M || {};
      const est = data.estoque || {};
      const cen = data.cenarios || {};
      const fin = data.financeiro || {};

      // Tabela de Métricas Resumo
      const setTxt = (id, txt) => {
        const el = document.getElementById(id);
        if (el) el.textContent = txt;
      };

      setTxt('infoVendas12M', `${met.vendas12M || 0} un`);
      setTxt('infoMediaMensal', `${met.mediaMensal || 0} un/mês`);
      setTxt('infoMediaDiaria', `${met.mediaDiaria || 0} un/dia`);
      setTxt('infoRunRate', `${met.runRateRecente || 0} un/mês`);
      setTxt('infoLeadTime', `${cen.leadTimeDias || 30} dias ${cen.leadTimeNaoCadastrado ? '(padrão)' : ''}`);
      setTxt('infoPPCadastrado', `${prod.eminCadastrado || 0} un ${prod.eminCadastrado === 0 ? '(Sem ponto cadastrado)' : ''}`);
      setTxt('infoSaldoFisico', `${est.saldoFisicoTotal || 0} un`);
      setTxt('infoPedidosSC6', `${est.pedidosAbertosQtd || 0} un`);

      // Cenários
      setTxt('infoCenario1', `${cen.cenario1Oficial || 0} un`);
      setTxt('infoCenario2_90', `${cen.cenario2_90 || 0} un`);
      setTxt('infoCenario2_95', `${cen.cenario2_95 || 0} un`);
      setTxt('infoCenario2_98', `${cen.cenario2_98 || 0} un`);
      setTxt('infoCenario3_95', `${cen.cenario3_95 || 0} un`);
      setTxt('infoJustificativaDecisao', res.justificativaCenario || 'Critério baseado na estabilidade da demanda.');

      // Saldos por Filial
      const porEmp = est.porEmpresa || {};
      setTxt('infoSaldoMP', `${porEmp['14'] || 0} un`);
      setTxt('infoSaldoGSI', `${porEmp['15'] || 0} un`);
      setTxt('infoSaldoOACO', `${porEmp['16'] || 0} un`);
      setTxt('infoSaldo09', `${porEmp['09'] || 0} un`);

      // Financeiro
      setTxt('infoCustoUnit', this.formatMoney(prod.custoUnitario));
      setTxt('infoPrecoMedio', this.formatMoney(prod.precoMedioRealizado));
      setTxt('infoLucroBruto', `${this.formatMoney(fin.lucroBrutoUnitario)} (${fin.margemLucroBrutoPercentual || 0}%)`);
      setTxt('infoCapitalPP', this.formatMoney(fin.capitalImobilizadoPP));

      // Tabela mês a mês
      const tbodyMeses = document.getElementById('pontoPedidoTbodyMeses');
      if (tbodyMeses && Array.isArray(data.serieMensal)) {
        tbodyMeses.innerHTML = '';
        data.serieMensal.forEach(s => {
          const tr = document.createElement('tr');
          const isZero = s.quantidade === 0;
          tr.innerHTML = `
            <td style="padding: 6px 10px; border-bottom: 1px solid var(--panel-border, #334155);">${this.escapeHtml(s.mesAno)}</td>
            <td class="ponto-pedido-mes-qtd" style="padding: 6px 10px; border-bottom: 1px solid var(--panel-border, #334155); text-align: right; font-weight: ${isZero ? '400' : '700'}; color: ${isZero ? '#94a3b8' : 'var(--text-color, #f8fafc)'};">
              ${Number(s.quantidade) || 0} un ${isZero ? '<span style="font-size:0.7rem; color:#f59e0b;">(sem venda)</span>' : ''}
            </td>
          `;
          tbodyMeses.appendChild(tr);
        });
      }

      // Pedidos em Aberto SC6 (se houver)
      const secSC6 = document.getElementById('pontoPedidoSecSC6');
      const tbodySC6 = document.getElementById('pontoPedidoTbodySC6');
      if (secSC6 && tbodySC6) {
        if (Array.isArray(est.pedidosAbertosLista) && est.pedidosAbertosLista.length > 0) {
          secSC6.style.display = 'block';
          tbodySC6.innerHTML = '';
          est.pedidosAbertosLista.forEach(p => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
              <td style="padding: 6px 10px; border-bottom: 1px solid var(--panel-border); font-family: monospace;">${this.escapeHtml(p.pedido)}</td>
              <td style="padding: 6px 10px; border-bottom: 1px solid var(--panel-border);">${this.escapeHtml(p.empresa)}</td>
              <td style="padding: 6px 10px; border-bottom: 1px solid var(--panel-border);">${this.escapeHtml(p.entrega)}</td>
              <td style="padding: 6px 10px; border-bottom: 1px solid var(--panel-border); text-align: right; font-weight: 700; color: #f43f5e;">${Number(p.quantidade) || 0} un</td>
            `;
            tbodySC6.appendChild(tr);
          });
        } else {
          secSC6.style.display = 'none';
        }
      }
    },

    toggleInfo: function () {
      const infoContainer = document.getElementById('pontoPedidoDetalhesInfo');
      const btnToggle = document.getElementById('btnToggleInfoPontoPedido');
      if (!infoContainer || !btnToggle) return;

      const isHidden = infoContainer.style.display === 'none' || !infoContainer.style.display;
      if (isHidden) {
        infoContainer.style.display = 'block';
        btnToggle.innerHTML = `<span>ℹ️ -info (Recolher estudo completo)</span> <span>▲</span>`;
        btnToggle.setAttribute('aria-expanded', 'true');
      } else {
        infoContainer.style.display = 'none';
        btnToggle.innerHTML = `<span>ℹ️ +info (Ver estudo completo e números que geraram o resultado)</span> <span>▼</span>`;
        btnToggle.setAttribute('aria-expanded', 'false');
      }
    },

    renderErro: function (msg) {
      const loadingState = document.getElementById('pontoPedidoLoadingState');
      const resultState = document.getElementById('pontoPedidoResultState');
      const errorState = document.getElementById('pontoPedidoErrorState');
      const errorMsgEl = document.getElementById('pontoPedidoErrorMsg');

      if (loadingState) loadingState.style.display = 'none';
      if (resultState) resultState.style.display = 'none';
      if (errorState) errorState.style.display = 'flex';
      if (errorMsgEl) errorMsgEl.textContent = msg;
    },

    fecharModal: function () {
      const modal = document.getElementById('modalPontoPedidoIdeal');
      if (modal) {
        modal.style.display = 'none';
      }
    },

    copiarRelatorioMarkdown: function () {
      if (!currentEstudoData || !currentEstudoData.markdownRelatorio) {
        if (typeof showToast === 'function') {
          showToast('Nenhum estudo disponível para cópia.', 'warning');
        }
        return;
      }

      navigator.clipboard.writeText(currentEstudoData.markdownRelatorio).then(() => {
        if (typeof showToast === 'function') {
          showToast('📋 Estudo de Ponto de Pedido copiado com sucesso em Markdown!', 'success');
        } else {
          alert('Estudo copiado com sucesso para a área de transferência!');
        }
      }).catch(err => {
        console.error('Falha ao copiar markdown:', err);
      });
    },

    sincronizarTemaModal: function () {
      const modal = document.getElementById('modalPontoPedidoIdeal');
      if (!modal) return;

      const comprasTab = document.getElementById('tab-compras-pedidos-abertos') || document.getElementById('tab-vend-saldos-estoque');
      const isLight = comprasTab ? comprasTab.classList.contains('tab-theme-light') : false;

      if (isLight) {
        modal.classList.add('modal-theme-light');
      } else {
        modal.classList.remove('modal-theme-light');
      }
    },

    formatMoney: function (val) {
      const n = Number(val) || 0;
      return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    },

    escapeHtml: function (str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
  };

  // Exposição Global
  window.ComprasPontoPedidoModule = ComprasPontoPedidoModule;

  // Auto-inicialização quando o DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ComprasPontoPedidoModule.init());
  } else {
    ComprasPontoPedidoModule.init();
  }
})();
