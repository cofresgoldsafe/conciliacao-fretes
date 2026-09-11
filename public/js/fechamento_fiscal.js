/**
 * fechamento_fiscal.js — Módulo de Fechamento Fiscal Mensal (Analista Fin)
 * Apuração de Saídas e Entradas Protheus ERP, Total Tributado e Histórico 12 Meses (RBT12)
 */

(function () {
  'use strict';

  // Estado Local do Módulo
  let estadoFechamento = {
    carregando: false,
    dadosAtuais: null,
    historico12m: null,
    itensFiltrados: []
  };

  // Elementos do DOM
  let selEmpresa = null;
  let inputDataDe = null;
  let inputDataAte = null;
  let selCriterioData = null;
  let btnConsultar = null;
  let btnExportarCsv = null;
  let btnConsolidar = null;
  let placeholder = null;
  let loading = null;
  let resultados = null;
  let inputBusca = null;
  let selFiltroTipo = null;
  let selFiltroDoc = null;
  let contadorRegistros = null;
  let tbodyTabela = null;
  let btnToggle12m = null;
  let conteudo12m = null;
  let iconToggle12m = null;
  let tbody12m = null;
  let kpiRbt12 = null;

  // Formatador Monetário Brasileiro
  const formatadorMoeda = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const formatadorNumero = new Intl.NumberFormat('pt-BR');

  function formatarMoeda(val) {
    return formatadorMoeda.format(Number(val) || 0);
  }

  function formatarInt(val) {
    return formatadorNumero.format(Number(val) || 0);
  }

  /**
   * Calcula as datas padrão para o mês anterior
   */
  function calcularDatasMesAnterior() {
    const hoje = new Date();
    const anoAtual = hoje.getFullYear();
    const mesAtual = hoje.getMonth(); // 0 a 11

    const mesAnterior = mesAtual === 0 ? 11 : mesAtual - 1;
    const anoAnterior = mesAtual === 0 ? anoAtual - 1 : anoAtual;

    const primeiroDia = new Date(anoAnterior, mesAnterior, 1);
    const ultimoDia = new Date(anoAnterior, mesAnterior + 1, 0);

    const pad = (n) => String(n).padStart(2, '0');
    const deStr = `${anoAnterior}-${pad(mesAnterior + 1)}-01`;
    const ateStr = `${anoAnterior}-${pad(mesAnterior + 1)}-${pad(ultimoDia.getDate())}`;

    return { de: deStr, ate: ateStr };
  }

  /**
   * Inicializa referências DOM e configurações de tela
   */
  function initFechamentoFiscal() {
    selEmpresa = document.getElementById('selFechamentoEmpresa');
    inputDataDe = document.getElementById('inputFechamentoDataDe');
    inputDataAte = document.getElementById('inputFechamentoDataAte');
    selCriterioData = document.getElementById('selFechamentoCriterioData');
    btnConsultar = document.getElementById('btnConsultarFechamentoFiscal');
    btnExportarCsv = document.getElementById('btnExportarFechamentoCsv');
    btnConsolidar = document.getElementById('btnConsolidarFechamentoFiscal');

    placeholder = document.getElementById('fechamentoFiscalPlaceholder');
    loading = document.getElementById('fechamentoFiscalLoading');
    resultados = document.getElementById('fechamentoFiscalResultados');

    inputBusca = document.getElementById('inputBuscaFechamento');
    selFiltroTipo = document.getElementById('selFiltroTipoFechamento');
    selFiltroDoc = document.getElementById('selFiltroDocFechamento');
    contadorRegistros = document.getElementById('contadorRegistrosFechamento');
    tbodyTabela = document.getElementById('tbodyFechamentoFiscal');

    btnToggle12m = document.getElementById('btnToggleHistorico12m');
    conteudo12m = document.getElementById('conteudoHistorico12m');
    iconToggle12m = document.getElementById('iconToggle12m');
    tbody12m = document.getElementById('tbodyHistorico12m');
    kpiRbt12 = document.getElementById('kpiRbt12Total');

    // Configura datas padrão do mês anterior nos inputs
    const datas = calcularDatasMesAnterior();
    if (inputDataDe && !inputDataDe.value) inputDataDe.value = datas.de;
    if (inputDataAte && !inputDataAte.value) inputDataAte.value = datas.ate;

    // Listeners
    if (btnConsultar) {
      btnConsultar.addEventListener('click', consultarFechamento);
    }
    if (btnExportarCsv) {
      btnExportarCsv.addEventListener('click', exportarCsvFechamento);
    }
    if (btnConsolidar) {
      btnConsolidar.addEventListener('click', consolidarFechamento);
    }

    if (inputBusca) {
      inputBusca.addEventListener('input', filtrarItensTabela);
    }
    if (selFiltroTipo) {
      selFiltroTipo.addEventListener('change', filtrarItensTabela);
    }
    if (selFiltroDoc) {
      selFiltroDoc.addEventListener('change', filtrarItensTabela);
    }

    if (btnToggle12m) {
      btnToggle12m.addEventListener('click', () => {
        if (!conteudo12m) return;
        const aberto = conteudo12m.style.display === 'block';
        conteudo12m.style.display = aberto ? 'none' : 'block';
        if (iconToggle12m) iconToggle12m.textContent = aberto ? '▼' : '▲';
      });
    }
  }

  /**
   * Helper para chamadas autenticadas à API do backend
   */
  async function apiFetch(url, options = {}) {
    const token = localStorage.getItem('auth_token');
    const headers = Object.assign({}, options.headers || {});
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(url, Object.assign({}, options, { headers }));
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || `Erro HTTP ${res.status}: ${res.statusText}`);
    }
    return await res.json();
  }

  /**
   * Helper para toast notifications
   */
  function notificar(msg, tipo = 'info') {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, tipo);
    } else {
      alert(msg);
    }
  }

  /**
   * Dispara a apuração do Fechamento Fiscal no Protheus
   */
  async function consultarFechamento() {
    if (estadoFechamento.carregando) return;

    const empresa = selEmpresa ? selEmpresa.value : '';
    if (!empresa) {
      notificar('Por favor, selecione uma empresa para consultar o fechamento fiscal.', 'warning');
      if (selEmpresa) selEmpresa.focus();
      return;
    }

    const de = inputDataDe ? inputDataDe.value : '';
    const ate = inputDataAte ? inputDataAte.value : '';
    const criterioData = selCriterioData ? selCriterioData.value : 'EMISSAO';

    estadoFechamento.carregando = true;
    if (placeholder) placeholder.style.display = 'none';
    if (resultados) resultados.style.display = 'none';
    if (loading) loading.style.display = 'block';

    try {
      const params = new URLSearchParams({
        empresa,
        de: de.replace(/[^0-9]/g, ''),
        ate: ate.replace(/[^0-9]/g, ''),
        criterioData
      });

      // Extrai ano_mes para o histórico dos 12 meses
      const anoMesRef = de.replace(/[^0-9]/g, '').substring(0, 6);

      // Consulta Fechamento e Histórico 12m em paralelo
      const [resFechamento, res12m] = await Promise.all([
        apiFetch(`/api/analista-fin/fechamento-fiscal?${params.toString()}`),
        apiFetch(`/api/analista-fin/fechamento-fiscal/historico-12m?empresa=${empresa}&anoMes=${anoMesRef}`).catch(err => {
          console.warn('Aviso ao buscar histórico 12m:', err.message);
          return null;
        })
      ]);

      estadoFechamento.dadosAtuais = resFechamento;
      estadoFechamento.historico12m = res12m;
      estadoFechamento.itensFiltrados = resFechamento.itens || [];

      renderizarTotais(resFechamento.totais);
      renderizarHistorico12m(res12m);
      filtrarItensTabela();

      if (btnExportarCsv) btnExportarCsv.style.display = 'inline-flex';
      if (btnConsolidar) btnConsolidar.style.display = 'inline-flex';
      if (loading) loading.style.display = 'none';
      if (resultados) resultados.style.display = 'block';

      notificar(`Apuração fiscal concluída: ${resFechamento.totalItens} notas processadas com sucesso!`, 'success');
    } catch (err) {
      console.error('Erro ao consultar fechamento fiscal:', err);
      notificar(`Falha na consulta do fechamento: ${err.message}`, 'error');
      if (loading) loading.style.display = 'none';
      if (placeholder) placeholder.style.display = 'block';
    } finally {
      estadoFechamento.carregando = false;
    }
  }

  /**
   * Renderiza os 8 cards de totais no topo
   */
  function renderizarTotais(totais) {
    if (!totais) return;

    const setCard = (idQtd, idVal, item) => {
      const elQtd = document.getElementById(idQtd);
      const elVal = document.getElementById(idVal);
      if (elQtd) elQtd.textContent = formatarInt(item ? item.qtd : 0);
      if (elVal) elVal.textContent = formatarMoeda(item ? item.valor : 0);
    };

    // 1. Total NFs Saída
    setCard('kpiTotalSaidasQtd', 'kpiTotalSaidasValor', totais.totalSaidas);
    // 2. Total Devolução
    setCard('kpiTotalDevolucaoQtd', 'kpiTotalDevolucaoValor', totais.totalDevolucao);
    // 3. Total Remessa
    setCard('kpiTotalRemessaQtd', 'kpiTotalRemessaValor', totais.totalRemessa);
    // 4. Total Tributado
    setCard('kpiTotalTributadoQtd', 'kpiTotalTributadoValor', totais.totalTributado);

    // 5. Total NFs Entrada
    setCard('kpiTotalEntradasQtd', 'kpiTotalEntradasValor', totais.totalEntradas);
    // 6. Total NFE
    setCard('kpiTotalNfeQtd', 'kpiTotalNfeValor', totais.totalNfe);
    // 7. Total CTRs
    setCard('kpiTotalCtrQtd', 'kpiTotalCtrValor', totais.totalCtr);
    // 8. Total Impostos (IMP + DAS)
    setCard('kpiTotalImpostosQtd', 'kpiTotalImpostosValor', totais.totalImpostos);
  }

  /**
   * Renderiza o histórico de 12 meses (RBT12) da Fase 2
   */
  function renderizarHistorico12m(dados12m) {
    if (!tbody12m || !kpiRbt12) return;

    if (!dados12m || !Array.isArray(dados12m.historico)) {
      kpiRbt12.textContent = 'R$ 0,00';
      tbody12m.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 10px; color: #94a3b8;">Histórico não disponível</td></tr>';
      return;
    }

    kpiRbt12.textContent = formatarMoeda(dados12m.rbt12);

    let html = '';
    dados12m.historico.forEach(item => {
      html += `
        <tr style="border-bottom: 1px solid rgba(51, 65, 85, 0.4);">
          <td style="padding: 6px 10px; font-weight: 600; color: #f8fafc;">${item.rotulo}</td>
          <td style="padding: 6px 10px; text-align: center; color: #cbd5e1;">${formatarInt(item.qtdNotas)}</td>
          <td style="padding: 6px 10px; text-align: right; font-weight: 700; color: #38bdf8; font-family: var(--font-mono, monospace);">
            ${formatarMoeda(item.valorFaturado)}
          </td>
        </tr>
      `;
    });

    tbody12m.innerHTML = html;
  }

  /**
   * Filtra os itens em memória com base nos inputs de busca instantânea
   */
  function filtrarItensTabela() {
    if (!estadoFechamento.dadosAtuais || !Array.isArray(estadoFechamento.dadosAtuais.itens)) return;

    const termo = inputBusca ? inputBusca.value.trim().toLowerCase() : '';
    const filtroTipo = selFiltroTipo ? selFiltroTipo.value : 'ALL';
    const filtroDoc = selFiltroDoc ? selFiltroDoc.value : 'ALL';

    const todos = estadoFechamento.dadosAtuais.itens;

    const filtrados = todos.filter(item => {
      // 1. Filtro de Tipo/Fluxo
      if (filtroTipo === 'SAIDA' && item.entraSaida !== 'SAÍDA') return false;
      if (filtroTipo === 'ENTRA' && item.entraSaida !== 'ENTRA') return false;
      if (filtroTipo === 'TRIBUTADO' && item.geraImposto !== 'Sim') return false;
      if (filtroTipo === 'NAO_TRIBUTADO' && item.geraImposto !== 'Não') return false;

      // 2. Filtro de Tipo Doc
      if (filtroDoc !== 'ALL') {
        const docUpper = (item.tipoDoc || '').toUpperCase();
        if (filtroDoc === 'CTR' && docUpper !== 'CTR' && docUpper !== 'CTE') return false;
        else if (filtroDoc !== 'CTR' && docUpper !== filtroDoc) return false;
      }

      // 3. Busca por Termo (Num NF, Valor, CNPJ/CPF ou Razão Social)
      if (termo) {
        const numMatch = (item.numNf || '').toLowerCase().includes(termo);
        const cnpjMatch = (item.cnpjCpf || '').replace(/[^0-9]/g, '').includes(termo.replace(/[^0-9]/g, ''));
        const razaoMatch = (item.razaoSocial || '').toLowerCase().includes(termo);
        const cfopMatch = (item.cfop || '').includes(termo);
        const tesMatch = (item.tes || '').includes(termo);
        const valorMatch = String(item.valor || '').includes(termo) || formatarMoeda(item.valor).toLowerCase().includes(termo);

        if (!numMatch && !cnpjMatch && !razaoMatch && !cfopMatch && !tesMatch && !valorMatch) {
          return false;
        }
      }

      return true;
    });

    estadoFechamento.itensFiltrados = filtrados;
    renderizarGrid(filtrados);

    if (contadorRegistros) {
      contadorRegistros.textContent = `Exibindo ${formatarInt(filtrados.length)} de ${formatarInt(todos.length)} notas`;
    }
  }

  /**
   * Renderiza as linhas do grid com formatação idêntica ao layout Excel
   */
  function renderizarGrid(lista) {
    if (!tbodyTabela) return;

    if (!lista || lista.length === 0) {
      tbodyTabela.innerHTML = `
        <tr>
          <td colspan="12" style="text-align: center; padding: 2.5rem 1rem; color: var(--text-muted, #94a3b8);">
            Nenhuma nota fiscal encontrada para os filtros aplicados.
          </td>
        </tr>
      `;
      return;
    }

    let html = '';
    lista.forEach(item => {
      const isSaida = item.entraSaida === 'SAÍDA';
      const badgeFluxo = isSaida
        ? '<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 700; background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3);">SAÍDA</span>'
        : '<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 700; background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3);">ENTRA</span>';

      const badgeGeraImposto = item.geraImposto === 'Sim'
        ? '<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 700; background: rgba(16, 185, 129, 0.2); color: #10b981;">Sim</span>'
        : '<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 500; background: rgba(148, 163, 184, 0.12); color: #94a3b8;">Não</span>';

      const dataExibicao = item.dataEmissaoFmt || item.dataDigitacaoFmt || '';

      html += `
        <tr style="border-bottom: 1px solid var(--panel-border, #334155); transition: background 0.15s ease;" onmouseover="this.style.background='rgba(51, 65, 85, 0.25)'" onmouseout="this.style.background='transparent'">
          <td style="padding: 7px 12px; text-align: center;">${badgeFluxo}</td>
          <td style="padding: 7px 10px; text-align: center; font-weight: 600; color: #cbd5e1;">${item.tipo}</td>
          <td style="padding: 7px 10px; text-align: center; font-weight: 600; color: #94a3b8;">${item.tipoDoc}</td>
          <td style="padding: 7px 12px; font-family: var(--font-mono, monospace); font-weight: 700; color: #f8fafc;">
            ${item.numNf}
          </td>
          <td style="padding: 7px 10px; text-align: center; color: #cbd5e1; white-space: nowrap;">${dataExibicao}</td>
          <td style="padding: 7px 12px; text-align: right; font-family: var(--font-mono, monospace); font-weight: 700; color: ${isSaida ? '#60a5fa' : '#38bdf8'};">
            ${formatarMoeda(item.valor)}
          </td>
          <td style="padding: 7px 10px; text-align: center; font-family: var(--font-mono, monospace); color: #e2e8f0;">${item.cfop || '-'}</td>
          <td style="padding: 7px 10px; text-align: center; font-family: var(--font-mono, monospace); color: #e2e8f0;" title="${item.descrTes || ''}">${item.tes || '-'}</td>
          <td style="padding: 7px 8px; text-align: center; font-weight: 600; color: #cbd5e1;">${item.uf || '-'}</td>
          <td style="padding: 7px 12px; color: #cbd5e1; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.cnpjCpfFmt} — ${item.razaoSocial}">
            <span style="font-family: var(--font-mono, monospace); color: #94a3b8; font-size: 0.78rem;">${item.cnpjCpfFmt || '-'}</span>
            ${item.razaoSocial ? `<div style="font-size: 0.76rem; color: #f1f5f9; overflow: hidden; text-overflow: ellipsis;">${item.razaoSocial}</div>` : ''}
          </td>
          <td style="padding: 7px 10px; text-align: center;">${badgeGeraImposto}</td>
          <td style="padding: 7px 10px; text-align: right; font-family: var(--font-mono, monospace); color: #94a3b8;">${item.difal || ''}</td>
        </tr>
      `;
    });

    tbodyTabela.innerHTML = html;
  }

  /**
   * Exporta a listagem para CSV no padrão Excel com delimitador ';' e BOM UTF-8
   */
  function exportarCsvFechamento() {
    const lista = estadoFechamento.itensFiltrados;
    if (!lista || lista.length === 0) {
      notificar('Nenhum dado disponível para exportação.', 'warning');
      return;
    }

    const headers = [
      'Entra / Saida',
      'Tipo',
      'Tipo Doc.',
      'Num NF',
      'Data',
      'Valor',
      'CFOP',
      'TES',
      'UF',
      'CNPJ/CPF',
      'Razao Social',
      'Gera Imposto',
      'Difal'
    ];

    const escapeCsv = (val) => {
      const str = String(val === null || val === undefined ? '' : val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = [headers.map(escapeCsv).join(';')];

    lista.forEach(item => {
      const row = [
        item.entraSaida,
        item.tipo,
        item.tipoDoc,
        item.numNf,
        item.dataEmissaoFmt || item.dataDigitacaoFmt || '',
        Number(item.valor || 0).toFixed(2).replace('.', ','),
        item.cfop,
        item.tes,
        item.uf,
        item.cnpjCpf,
        item.razaoSocial,
        item.geraImposto,
        item.difal || ''
      ];
      rows.push(row.map(escapeCsv).join(';'));
    });

    // Adiciona BOM UTF-8 (\uFEFF) para garantir acentuação correta no Excel Windows
    const csvContent = '\uFEFF' + rows.join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const empresaNome = selEmpresa ? selEmpresa.options[selEmpresa.selectedIndex].text.replace(/[^a-zA-Z0-9]/g, '_') : 'Fechamento';
    const de = inputDataDe ? inputDataDe.value : '';
    const ate = inputDataAte ? inputDataAte.value : '';

    const a = document.createElement('a');
    a.href = url;
    a.download = `Fechamento_Fiscal_${empresaNome}_${de}_a_${ate}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    notificar('Exportação concluída! Arquivo CSV gerado com sucesso.', 'success');
  }

  /**
   * Consolida e salva o fechamento atual no PostgreSQL
   */
  async function consolidarFechamento() {
    if (!estadoFechamento.dadosAtuais) return;

    const { empresaCodigo, periodo, totais, itens } = estadoFechamento.dadosAtuais;
    const anoMes = periodo.de.replace(/[^0-9]/g, '').substring(0, 6);

    const confirmar = confirm(`Deseja consolidar e gravar o snapshot do Fechamento Fiscal da empresa ${empresaCodigo} para a competência ${anoMes}?\n\nIsso salvará os dados de faturamento e RBT12 de forma permanente.`);
    if (!confirmar) return;

    try {
      const payload = {
        empresa: empresaCodigo,
        anoMes,
        dataInicio: periodo.de,
        dataFim: periodo.ate,
        totais,
        rbt12: estadoFechamento.historico12m ? estadoFechamento.historico12m.rbt12 : 0,
        detalhes: {
          totalItens: itens.length,
          dataFechamento: new Date().toISOString()
        }
      };

      await apiFetch('/api/analista-fin/fechamento-fiscal/consolidar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      notificar(`Fechamento consolidado com sucesso no banco de dados para ${anoMes}!`, 'success');
    } catch (err) {
      console.error('Erro ao consolidar fechamento:', err);
      notificar(`Falha ao consolidar fechamento: ${err.message}`, 'error');
    }
  }

  // Inicialização Automática após o DOM carregar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFechamentoFiscal);
  } else {
    initFechamentoFiscal();
  }

  // Expõe namespace seguro para testes e automação
  window.FechamentoFiscalModule = {
    init: initFechamentoFiscal,
    consultar: consultarFechamento,
    filtrar: filtrarItensTabela,
    exportarCsv: exportarCsvFechamento,
    consolidar: consolidarFechamento,
    getEstado: () => estadoFechamento
  };

})();
