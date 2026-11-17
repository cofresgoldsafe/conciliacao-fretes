/**
 * public/js/bi_ciclo_operacional.js
 * Frontend da Sub-aba Ciclo Operacional (BI Executivo)
 * Plataforma de Apoio GSI (Gemini-Cli)
 */

'use strict';

(function () {
  let cicloInitialized = false;
  let isCicloLoading = false;
  let cachedCicloPayload = null;
  let currentEmpresaFilter = 'ALL';

  function formatMoney(val) {
    const num = Number(val) || 0;
    return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function formatDays(val) {
    const num = Number(val) || 0;
    return `${num.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} dias`;
  }

  function getAuthToken() {
    return localStorage.getItem('token') || sessionStorage.getItem('token');
  }

  /**
   * Ponto de entrada chamado ao alternar para a aba #tab-bi-ciclo-operacional
   */
  window.initBiCicloOperacionalView = function () {
    setupCicloEventListeners();
    if (!cachedCicloPayload) {
      carregarCicloOperacional(false);
    }
  };

  function setupCicloEventListeners() {
    if (cicloInitialized) return;
    cicloInitialized = true;

    const selEmp = document.getElementById('selEmpresaBiCiclo');
    if (selEmp) {
      selEmp.addEventListener('change', (e) => {
        currentEmpresaFilter = e.target.value;
        if (cachedCicloPayload && cachedCicloPayload.calculados) {
          renderizarCicloDashboard(cachedCicloPayload.calculados, currentEmpresaFilter);
        }
      });
    }

    const btnSync = document.getElementById('btnSyncBiCiclo');
    if (btnSync) {
      btnSync.addEventListener('click', () => {
        carregarCicloOperacional(true);
      });
    }
  }

  async function carregarCicloOperacional(forceSync = false) {
    if (isCicloLoading) return;

    const token = getAuthToken();
    if (!token) {
      alert('Sessão expirada. Por favor, efetue login novamente.');
      return;
    }

    const loadingSpinner = document.getElementById('biCicloLoading');
    const content = document.getElementById('biCicloContent');
    const btnSync = document.getElementById('btnSyncBiCiclo');
    const lastUpdated = document.getElementById('biCicloLastUpdated');

    try {
      isCicloLoading = true;
      if (loadingSpinner) loadingSpinner.classList.remove('hidden');
      if (content) content.style.opacity = '0.5';
      if (btnSync) {
        btnSync.disabled = true;
        btnSync.innerHTML = '⏳ Sincronizando...';
      }

      let url = '/api/bi/ciclo-operacional';
      let options = {
        headers: { 'Authorization': `Bearer ${token}` }
      };

      if (forceSync) {
        url = '/api/bi/ciclo-operacional/sync';
        options.method = 'POST';
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify({ dias: 365 });
      }

      const res = await fetch(url, options);
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.message || 'Erro ao carregar dados do ciclo operacional.');
      }

      const payload = forceSync ? (json.data || json) : json;
      cachedCicloPayload = payload;

      renderizarCicloDashboard(payload.calculados, currentEmpresaFilter);

      if (lastUpdated && payload.atualizado_em) {
        const d = new Date(payload.atualizado_em);
        lastUpdated.textContent = `Atualizado em ${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
      }

      if (forceSync && typeof window.mostrarNotificacaoToast === 'function') {
        window.mostrarNotificacaoToast('✓ Ciclo Operacional sincronizado a partir do Protheus!', 'success');
      }
    } catch (err) {
      console.error('❌ [BI Ciclo Operacional] Erro:', err);
      alert(`Falha ao obter dados: ${err.message}`);
    } finally {
      isCicloLoading = false;
      if (loadingSpinner) loadingSpinner.classList.add('hidden');
      if (content) content.style.opacity = '1';
      if (btnSync) {
        btnSync.disabled = false;
        btnSync.innerHTML = '🔄 Sincronizar Protheus';
      }
    }
  }

  function renderizarCicloDashboard(calculados, empresaFilter = 'ALL') {
    if (!calculados) return;

    const data = (empresaFilter === 'ALL' || !calculados.porEmpresa || !calculados.porEmpresa[empresaFilter])
      ? calculados.consolidado
      : calculados.porEmpresa[empresaFilter];

    if (!data || !data.indices) return;

    const { indices, saldos, fluxos } = data;

    // 1. PME (Prazo Médio de Estocagem)
    const valPME = document.getElementById('valPME');
    const subEstoque = document.getElementById('subPMEEstoque');
    const subCMV = document.getElementById('subPMECMV');
    if (valPME) valPME.textContent = formatDays(indices.pme.dias);
    if (subEstoque) subEstoque.textContent = `Estoque: ${formatMoney(saldos.estoque)}`;
    if (subCMV) subCMV.textContent = `CMV Diário: ${formatMoney(fluxos.cmvDiario)}`;

    // 2. PMRV (Prazo Médio de Recebimento de Vendas)
    const valPMRV = document.getElementById('valPMRV');
    const subReceber = document.getElementById('subPMRVReceber');
    const subVenda = document.getElementById('subPMRVVenda');
    if (valPMRV) valPMRV.textContent = formatDays(indices.pmrv.dias);
    if (subReceber) subReceber.textContent = `A Receber: ${formatMoney(saldos.contasReceber)}`;
    if (subVenda) subVenda.textContent = `Venda Diária: ${formatMoney(fluxos.faturamentoDiario)}`;

    // 3. PMPC (Prazo Médio de Pagamento de Compras)
    const valPMPC = document.getElementById('valPMPC');
    const subPagar = document.getElementById('subPMPCPagar');
    const subCompra = document.getElementById('subPMPCCompra');
    if (valPMPC) valPMPC.textContent = formatDays(indices.pmpc.dias);
    if (subPagar) subPagar.textContent = `A Pagar: ${formatMoney(saldos.contasPagar)}`;
    if (subCompra) subCompra.textContent = `Compra Diária: ${formatMoney(fluxos.comprasDiarias)}`;

    // 4. CO (Ciclo Operacional = PME + PMRV)
    const valCO = document.getElementById('valCO');
    const subCOFormula = document.getElementById('subCOFormula');
    if (valCO) valCO.textContent = formatDays(indices.co.dias);
    if (subCOFormula) subCOFormula.textContent = `${indices.pme.dias}d (Estoque) + ${indices.pmrv.dias}d (Recebimento)`;

    // 5. CF (Ciclo Financeiro = CO - PMPC)
    const valCF = document.getElementById('valCF');
    const badgeCF = document.getElementById('badgeCF');
    const subCFDesc = document.getElementById('subCFDesc');
    if (valCF) valCF.textContent = formatDays(indices.cf.dias);

    if (badgeCF) {
      badgeCF.className = 'badge-indice';
      if (indices.cf.isAutofinanciado) {
        badgeCF.classList.add('badge-excelente');
        badgeCF.textContent = 'Autofinanciado por Fornecedores';
      } else if (indices.cf.dias > 60) {
        badgeCF.classList.add('badge-critico');
        badgeCF.textContent = 'Ciclo de Caixa Elevado';
      } else {
        badgeCF.classList.add('badge-moderado');
        badgeCF.textContent = 'Ciclo de Caixa Regular';
      }
    }
    if (subCFDesc) subCFDesc.textContent = indices.cf.descricao;

    // 6. NCG (Necessidade de Capital de Giro)
    const valNCG = document.getElementById('valNCG');
    const subNCGAtivo = document.getElementById('subNCGAtivo');
    const subNCGPassivo = document.getElementById('subNCGPassivo');
    const subNCGGiro = document.getElementById('subNCGGiro');
    if (valNCG) valNCG.textContent = formatMoney(indices.ncg.valorPatrimonial);
    if (subNCGAtivo) subNCGAtivo.textContent = `Ativo Operac.: ${formatMoney(saldos.ativoCirculanteOperacional)}`;
    if (subNCGPassivo) subNCGPassivo.textContent = `Passivo Operac.: ${formatMoney(saldos.passivoCirculanteOperacional)}`;
    if (subNCGGiro) {
      if (indices.cf.isAutofinanciado) {
        subNCGGiro.textContent = 'Giro de Caixa: R$ 0,00 (Operação coberta por terceiros)';
      } else {
        subNCGGiro.textContent = `Giro Necessário: ${formatMoney(indices.ncg.valorFinanceiro)} (${indices.cf.dias} dias)`;
      }
    }

    // 7. Timeline Visual do Ciclo
    atualizarTimelineVisual(indices);
  }

  function atualizarTimelineVisual(indices) {
    const barPME = document.getElementById('timelineBarPME');
    const barPMRV = document.getElementById('timelineBarPMRV');
    const barPMPC = document.getElementById('timelineBarPMPC');
    const barCF = document.getElementById('timelineBarCF');

    const coDias = Math.max(1, indices.co.dias);
    const pmePct = Math.min(100, Math.round((indices.pme.dias / coDias) * 100));
    const pmrvPct = Math.max(0, 100 - pmePct);

    if (barPME) {
      barPME.style.width = `${pmePct}%`;
      barPME.title = `PME: ${indices.pme.dias} dias (${pmePct}%)`;
      barPME.textContent = `PME: ${indices.pme.dias}d`;
    }
    if (barPMRV) {
      barPMRV.style.width = `${pmrvPct}%`;
      barPMRV.title = `PMRV: ${indices.pmrv.dias} dias (${pmrvPct}%)`;
      barPMRV.textContent = `PMRV: ${indices.pmrv.dias}d`;
    }

    // Linha inferior de Fornecedores e Caixa
    const maxEscala = Math.max(coDias, indices.pmpc.dias, 1);
    const pmpcPct = Math.min(100, Math.round((indices.pmpc.dias / maxEscala) * 100));
    const cfPct = Math.min(100, Math.round((Math.max(0, indices.cf.dias) / maxEscala) * 100));

    if (barPMPC) {
      barPMPC.style.width = `${pmpcPct}%`;
      barPMPC.title = `PMPC: ${indices.pmpc.dias} dias`;
      barPMPC.textContent = `PMPC (Fornecedores): ${indices.pmpc.dias}d`;
    }

    if (barCF) {
      if (indices.cf.isAutofinanciado) {
        barCF.style.width = '0%';
        barCF.textContent = '';
      } else {
        barCF.style.width = `${cfPct}%`;
        barCF.title = `Ciclo Financeiro a Cobrir: ${indices.cf.dias} dias`;
        barCF.textContent = `CF: ${indices.cf.dias}d`;
      }
    }
  }

})();
