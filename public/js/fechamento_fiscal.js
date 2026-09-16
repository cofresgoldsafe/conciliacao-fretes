/**
 * fechamento_fiscal.js — Módulo de Fechamento Fiscal Mensal (Analista Fin)
 * Apuração de Saídas e Entradas Protheus ERP, Total Tributado, Histórico 12 Meses (RBT12)
 * e Ingestão/Exportação de NFS-e da Prefeitura de São Paulo (GSI Empresa 15)
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
  let btnSincronizarNfseSp = null;
  let btnExportarLoteXmlZip = null;
  let btnImportarLoteNfseSp = null;
  let inputUploadLoteNfseSp = null;

  let modalNfseSp = null;
  let modalNfseSpCorpo = null;
  let btnFecharModalNfseSp = null;
  let btnModalFecharNfseSp = null;
  let btnModalBaixarXml = null;

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

  let btnExportarXmlNfe = null;
  let modalExportarXml = null;
  let btnFecharModalExportarXml = null;
  let btnCancelarExportarXml = null;
  let btnConfirmarExportarXml = null;
  let modalXmlEmpresaNome = null;
  let modalXmlPeriodo = null;
  let modalXmlQtdNotas = null;
  let inputSenhaCertificadoModalXml = null;
  let modalXmlProgressoContainer = null;
  let modalXmlProgressoTexto = null;
  let modalXmlProgressoPerc = null;
  let modalXmlProgressoBarra = null;
  let modalXmlProgressoDetalhe = null;
  let modalXmlMensagem = null;

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
   * Atualiza a visibilidade dos botões de NFS-e exclusivos da GSI (Empresa 15)
   */
  function atualizarVisibilidadeBotoesGsi() {
    const isGsi = selEmpresa && selEmpresa.value === '15';
    const resultadosVisiveis = resultados && resultados.style.display !== 'none';

    // Botões de Ingestão/Sincronização ficam visíveis assim que a GSI é selecionada
    if (btnSincronizarNfseSp) btnSincronizarNfseSp.style.display = isGsi ? 'inline-flex' : 'none';
    if (btnImportarLoteNfseSp) btnImportarLoteNfseSp.style.display = isGsi ? 'inline-flex' : 'none';
    // Exportação ZIP fica disponível quando há resultados na tela
    if (btnExportarLoteXmlZip) btnExportarLoteXmlZip.style.display = (isGsi && resultadosVisiveis) ? 'inline-flex' : 'none';
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
    btnSincronizarNfseSp = document.getElementById('btnSincronizarNfseSp');
    btnExportarLoteXmlZip = document.getElementById('btnExportarLoteXmlZip');
    btnImportarLoteNfseSp = document.getElementById('btnImportarLoteNfseSp');
    inputUploadLoteNfseSp = document.getElementById('inputUploadLoteNfseSp');

    modalNfseSp = document.getElementById('modalNfsePaulistanaDetalhes');
    modalNfseSpCorpo = document.getElementById('modalNfseSpCorpo');
    btnFecharModalNfseSp = document.getElementById('btnFecharModalNfseSp');
    btnModalFecharNfseSp = document.getElementById('btnModalFecharNfseSp');
    btnModalBaixarXml = document.getElementById('btnModalBaixarXml');

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
    if (selEmpresa) {
      selEmpresa.addEventListener('change', atualizarVisibilidadeBotoesGsi);
    }
    if (btnConsultar) {
      btnConsultar.addEventListener('click', consultarFechamento);
    }
    if (btnExportarCsv) {
      btnExportarCsv.addEventListener('click', exportarCsvFechamento);
    }
    if (btnConsolidar) {
      btnConsolidar.addEventListener('click', consolidarFechamento);
    }

    // Ações de NFS-e GSI
    if (btnSincronizarNfseSp) {
      btnSincronizarNfseSp.addEventListener('click', sincronizarNfseSp);
    }
    if (btnExportarLoteXmlZip) {
      btnExportarLoteXmlZip.addEventListener('click', exportarLoteXmlZip);
    }
    if (btnImportarLoteNfseSp) {
      btnImportarLoteNfseSp.addEventListener('click', () => {
        if (inputUploadLoteNfseSp) inputUploadLoteNfseSp.click();
      });
    }
    if (inputUploadLoteNfseSp) {
      inputUploadLoteNfseSp.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          importarArquivoLotePaulistana(e.target.files[0]);
          e.target.value = '';
        }
      });
    }
    if (btnFecharModalNfseSp) {
      btnFecharModalNfseSp.addEventListener('click', fecharModalNfsePaulistana);
    }
    if (btnModalFecharNfseSp) {
      btnModalFecharNfseSp.addEventListener('click', fecharModalNfsePaulistana);
    }

    // Delegação de cliques no grid para detalhes de NFS-e Paulistana e download de XML
    if (tbodyTabela) {
      tbodyTabela.addEventListener('click', (e) => {
        const link = e.target.closest('.link-nfse-paulistana');
        if (link) {
          const chave = link.dataset.chave;
          const item = estadoFechamento.itensFiltrados.find(i => i.chaveAcesso === chave || String(i.numNf) === String(chave));
          if (item) abrirModalNfsePaulistana(item);
          return;
        }

        const btnXml = e.target.closest('.btn-baixar-xml-avulso');
        if (btnXml) {
          const chave = btnXml.dataset.chave;
          const num = btnXml.dataset.num;
          baixarXmlIndividual(chave, num);
          return;
        }
      });
    }

    if (inputBusca) {
      inputBusca.addEventListener('input', filtrarItensTabela);
    }
    if (selFiltroTipo) {
      selFiltroTipo.addEventListener('change', filtrarItensTabela);
    }
    if (selFiltroDoc) {
      selFiltroDoc.addEventListener('change', () => {
        filtrarItensTabela();
        atualizarVisibilidadeBotaoExportarXml();
      });
    }

    // Modal e Ações de Exportação de XMLs da SEFAZ
    btnExportarXmlNfe = document.getElementById('btnExportarXmlFechamento');
    modalExportarXml = document.getElementById('modalExportarXmlNfe');
    btnFecharModalExportarXml = document.getElementById('btnFecharModalExportarXml');
    btnCancelarExportarXml = document.getElementById('btnCancelarExportarXml');
    btnConfirmarExportarXml = document.getElementById('btnConfirmarExportarXml');
    modalXmlEmpresaNome = document.getElementById('modalXmlEmpresaNome');
    modalXmlPeriodo = document.getElementById('modalXmlPeriodo');
    modalXmlQtdNotas = document.getElementById('modalXmlQtdNotas');
    inputSenhaCertificadoModalXml = document.getElementById('inputSenhaCertificadoModalXml');
    modalXmlProgressoContainer = document.getElementById('modalXmlProgressoContainer');
    modalXmlProgressoTexto = document.getElementById('modalXmlProgressoTexto');
    modalXmlProgressoPerc = document.getElementById('modalXmlProgressoPerc');
    modalXmlProgressoBarra = document.getElementById('modalXmlProgressoBarra');
    modalXmlProgressoDetalhe = document.getElementById('modalXmlProgressoDetalhe');
    modalXmlMensagem = document.getElementById('modalXmlMensagem');

    if (btnExportarXmlNfe) {
      btnExportarXmlNfe.addEventListener('click', abrirModalExportarXml);
    }
    if (btnFecharModalExportarXml) {
      btnFecharModalExportarXml.addEventListener('click', fecharModalExportarXml);
    }
    if (btnCancelarExportarXml) {
      btnCancelarExportarXml.addEventListener('click', fecharModalExportarXml);
    }
    if (btnConfirmarExportarXml) {
      btnConfirmarExportarXml.addEventListener('click', executarExportacaoXmlSefaz);
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

      atualizarVisibilidadeBotoesGsi();
      atualizarVisibilidadeBotaoExportarXml();

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
    // 4. Total NFs Serviço
    setCard('kpiTotalServicoQtd', 'kpiTotalServicoValor', totais.totalServico);

    // Detalhe no subtítulo do card de serviços quando houver notas da prefeitura
    const elSubServico = document.getElementById('kpiTotalServicoSub');
    if (elSubServico && totais.totalServico) {
      if (totais.totalServico.prefeituraSp && totais.totalServico.prefeituraSp.qtd > 0) {
        elSubServico.innerHTML = `Protheus: <strong>${formatarInt(totais.totalServico.protheus ? totais.totalServico.protheus.qtd : 0)}</strong> | Pref. SP: <strong>${formatarInt(totais.totalServico.prefeituraSp.qtd)}</strong>`;
      } else if (selEmpresa && selEmpresa.value === '15') {
        elSubServico.innerHTML = `<span style="color: #38bdf8;">💡 Clique em <strong>Sincronizar NFS-e SP</strong> ou <strong>Importar Lote</strong></span>`;
      } else {
        elSubServico.textContent = 'Faturamento de serviços prestados';
      }
    }

    // 5. Total Tributado
    setCard('kpiTotalTributadoQtd', 'kpiTotalTributadoValor', totais.totalTributado);

    // 6. Total NFs Entrada
    setCard('kpiTotalEntradasQtd', 'kpiTotalEntradasValor', totais.totalEntradas);
    // 7. Total NFE
    setCard('kpiTotalNfeQtd', 'kpiTotalNfeValor', totais.totalNfe);
    // 8. Total CTRs
    setCard('kpiTotalCtrQtd', 'kpiTotalCtrValor', totais.totalCtr);
    // 9. Total Impostos (IMP + DAS)
    setCard('kpiTotalImpostosQtd', 'kpiTotalImpostosValor', totais.totalImpostos);
  }

  /**
   * Renderiza o histórico de 12 meses (RBT12)
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
      const detalheServ = item.valorServicos > 0 ? ` <span style="font-size: 0.72rem; color: #38bdf8;" title="Inclui serviços">${formatarMoeda(item.valorServicos)}</span>` : '';
      html += `
        <tr style="border-bottom: 1px solid rgba(51, 65, 85, 0.4);">
          <td style="padding: 6px 10px; font-weight: 600; color: #f8fafc;">${item.rotulo}</td>
          <td style="padding: 6px 10px; text-align: center; color: #cbd5e1;">${formatarInt(item.qtdNotas)}</td>
          <td style="padding: 6px 10px; text-align: right; font-weight: 700; color: #38bdf8; font-family: var(--font-mono, monospace);">
            ${formatarMoeda(item.valorFaturado)}
            ${detalheServ}
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
      if (filtroTipo === 'DEVOLUCAO' && item.tipoOperacao !== 'DEVOLUCAO') return false;
      if (filtroTipo === 'SERVICO' && item.tipoOperacao !== 'SERVICO') return false;
      if (filtroTipo === 'TRIBUTADO' && item.geraImposto !== 'Sim') return false;
      if (filtroTipo === 'NAO_TRIBUTADO' && item.geraImposto !== 'Não') return false;

      // 2. Filtro de Tipo Doc
      if (filtroDoc !== 'ALL') {
        const docUpper = (item.tipoDoc || '').toUpperCase();
        if (filtroDoc === 'SPED_NFE' || filtroDoc === 'SPED & NFE') {
          if (docUpper !== 'SPED' && docUpper !== 'NFE' && docUpper !== 'NF-E') return false;
        } else if (filtroDoc === 'CTR' && docUpper !== 'CTR' && docUpper !== 'CTE') {
          return false;
        } else if (filtroDoc !== 'CTR' && docUpper !== filtroDoc) {
          return false;
        }
      }

      // 3. Busca por Termo (Num NF, Valor, CNPJ/CPF, Razão Social, Devolução, Serviço ou NF Origem)
      if (termo) {
        const numMatch = (item.numNf || '').toLowerCase().includes(termo);
        const cnpjMatch = (item.cnpjCpf || '').replace(/[^0-9]/g, '').includes(termo.replace(/[^0-9]/g, ''));
        const razaoMatch = (item.razaoSocial || '').toLowerCase().includes(termo);
        const cfopMatch = (item.cfop || '').includes(termo);
        const tesMatch = (item.tes || '').includes(termo);
        const valorMatch = String(item.valor || '').includes(termo) || formatarMoeda(item.valor).toLowerCase().includes(termo);
        const tipoMatch = (item.tipoOperacao || '').toLowerCase().includes(termo) ||
          ((termo === 'devolucao' || termo === 'devolução') && item.tipoOperacao === 'DEVOLUCAO') ||
          ((termo === 'servico' || termo === 'serviço') && item.tipoOperacao === 'SERVICO') ||
          ((termo === 'proprio' || termo === 'próprio') && item.formularioProprio);
        const nfOriMatch = (item.nfOrigem || '').toLowerCase().includes(termo);

        if (!numMatch && !cnpjMatch && !razaoMatch && !cfopMatch && !tesMatch && !valorMatch && !tipoMatch && !nfOriMatch) {
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
      const isDevolucao = item.tipoOperacao === 'DEVOLUCAO';
      const isPrefeituraSp = item.origem === 'PREFEITURA_SP' || item.origem === 'PREFEITURA_SP_TXT';

      let badgeFluxo = '';
      if (isDevolucao) {
        const devLabel = isSaida ? 'SAÍDA (DEV)' : 'ENTRA (DEV)';
        const devTitle = isSaida
          ? 'Devolução a Fornecedor'
          : (item.formularioProprio ? 'Devolução de Venda (Formulário Próprio MATA103)' : 'Devolução de Venda (Cliente)');
        badgeFluxo = `<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 700; background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3);" title="${devTitle}">${devLabel}</span>`;
      } else if (isPrefeituraSp) {
        badgeFluxo = '<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 700; background: rgba(56, 189, 248, 0.18); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4);" title="NFS-e emitida diretamente na Prefeitura de São Paulo (Nota Paulistana)">🏛️ NFS-e SP</span>';
      } else if (item.tipoOperacao === 'SERVICO') {
        badgeFluxo = '<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 700; background: rgba(2, 132, 199, 0.15); color: #38bdf8; border: 1px solid rgba(2, 132, 199, 0.3);" title="Nota Fiscal de Serviço (Saída)">SERVIÇO</span>';
      } else if (isSaida) {
        badgeFluxo = '<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 700; background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3);">SAÍDA</span>';
      } else {
        badgeFluxo = '<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 700; background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3);">ENTRA</span>';
      }

      const badgeGeraImposto = item.geraImposto === 'Sim'
        ? '<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 700; background: rgba(16, 185, 129, 0.2); color: #10b981;">Sim</span>'
        : '<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 500; background: rgba(148, 163, 184, 0.12); color: #94a3b8;">Não</span>';

      const dataExibicao = item.dataEmissaoFmt || item.dataDigitacaoFmt || '';

      const docTag = item.formularioProprio
        ? `<div style="font-size: 0.68rem; color: #c084fc; font-weight: 600;" title="Nota emitida em formulário próprio (MATA103)">Próprio</div>`
        : '';

      const nfOrigemTag = item.nfOrigem
        ? `<div style="font-size: 0.68rem; color: #94a3b8; font-weight: 500;" title="Devolução referente à NF original ${item.nfOrigem}">Orig: ${item.nfOrigem}</div>`
        : '';

      // Renderização do número da NF com link para espelho da nota quando for NFS-e Paulistana
      let numNfHtml = item.numNf;
      if (isPrefeituraSp) {
        numNfHtml = `
          <a href="javascript:void(0)" class="link-nfse-paulistana" data-chave="${item.chaveAcesso}" style="color: #38bdf8; text-decoration: underline; font-weight: 700;" title="Ver espelho da nota fiscal">${item.numNf}</a>
          ${item.temXml ? `<button type="button" class="btn-baixar-xml-avulso" data-chave="${item.chaveAcesso}" data-num="${item.numNf}" title="Baixar XML desta nota" style="background: none; border: none; cursor: pointer; padding: 0 4px; font-size: 0.9rem; color: #a78bfa; vertical-align: middle;">📄</button>` : ''}
        `;
      }

      html += `
        <tr style="border-bottom: 1px solid var(--panel-border, #334155); transition: background 0.15s ease;" onmouseover="this.style.background='rgba(51, 65, 85, 0.25)'" onmouseout="this.style.background='transparent'">
          <td style="padding: 7px 12px; text-align: center;">${badgeFluxo}</td>
          <td style="padding: 7px 10px; text-align: center; font-weight: 600; color: #cbd5e1;">${item.tipo}</td>
          <td style="padding: 7px 10px; text-align: center; font-weight: 600; color: #94a3b8;">
            ${item.tipoDoc}
            ${docTag}
          </td>
          <td style="padding: 7px 12px; font-family: var(--font-mono, monospace); font-weight: 700; color: #f8fafc;">
            ${numNfHtml}
            ${nfOrigemTag}
          </td>
          <td style="padding: 7px 10px; text-align: center; color: #cbd5e1; white-space: nowrap;">${dataExibicao}</td>
          <td style="padding: 7px 12px; text-align: right; font-family: var(--font-mono, monospace); font-weight: 700; color: ${item.tipoOperacao === 'SERVICO' ? '#38bdf8' : (isSaida ? '#60a5fa' : (isDevolucao ? '#c084fc' : '#34d399'))};">
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
   * Abre modal de espelho da NFS-e da Prefeitura de SP
   */
  function abrirModalNfsePaulistana(item) {
    if (!modalNfseSp || !modalNfseSpCorpo) return;

    const tituloEl = document.getElementById('modalNfseSpTitulo');
    if (tituloEl) {
      tituloEl.textContent = `Espelho da NFS-e Nº ${item.numNf} — Prefeitura de SP`;
    }

    modalNfseSpCorpo.innerHTML = `
      <div style="background: rgba(15, 23, 42, 0.4); border: 1px solid var(--panel-border, #334155); border-radius: 8px; padding: 12px; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">
        <div>
          <span style="font-size: 0.72rem; color: #94a3b8; text-transform: uppercase;">Prestador de Serviços</span>
          <div style="font-weight: 700; color: #f8fafc;">GSI BW Equipamentos de Aço Cofres e Armários</div>
          <div style="font-size: 0.75rem; color: #94a3b8; font-family: monospace;">CNPJ: 14.061.778/0001-15</div>
        </div>
        <div>
          <span style="font-size: 0.72rem; color: #94a3b8; text-transform: uppercase;">Tomador (Cliente)</span>
          <div style="font-weight: 700; color: #f8fafc;">${item.razaoSocial || 'Cliente Não Informado'}</div>
          <div style="font-size: 0.75rem; color: #94a3b8; font-family: monospace;">CNPJ/CPF: ${item.cnpjCpfFmt || item.cnpjCpf || '-'}</div>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; background: rgba(56, 189, 248, 0.05); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 8px; padding: 12px;">
        <div>
          <span style="font-size: 0.72rem; color: #94a3b8;">Número / Série</span>
          <div style="font-weight: 700; color: #38bdf8; font-size: 1.1rem; font-family: monospace;">${item.numNf} <span style="font-size: 0.8rem; color: #94a3b8;">(${item.serie || 'NFS'})</span></div>
        </div>
        <div>
          <span style="font-size: 0.72rem; color: #94a3b8;">Data de Emissão</span>
          <div style="font-weight: 700; color: #f8fafc;">${item.dataEmissaoFmt || '-'}</div>
        </div>
        <div>
          <span style="font-size: 0.72rem; color: #94a3b8;">Valor dos Serviços</span>
          <div style="font-weight: 700; color: #10b981; font-size: 1.1rem; font-family: monospace;">${formatarMoeda(item.valor)}</div>
        </div>
        <div>
          <span style="font-size: 0.72rem; color: #94a3b8;">ISS Retido</span>
          <div style="font-weight: 700; color: ${item.issRetido ? '#f59e0b' : '#94a3b8'};">${item.issRetido ? 'Sim (Retido na Fonte)' : 'Não'}</div>
        </div>
      </div>

      <div>
        <span style="font-size: 0.75rem; font-weight: 600; color: #94a3b8; text-transform: uppercase;">Discriminação dos Serviços Prestados</span>
        <div style="margin-top: 4px; padding: 10px; background: rgba(15, 23, 42, 0.6); border: 1px solid var(--panel-border, #334155); border-radius: 6px; font-size: 0.82rem; line-height: 1.45; white-space: pre-wrap; color: #e2e8f0; max-height: 140px; overflow-y: auto;">
          ${item.discriminacao || item.descrTes || 'Nenhuma discriminação adicional informada.'}
        </div>
      </div>
    `;

    if (btnModalBaixarXml) {
      btnModalBaixarXml.onclick = () => baixarXmlIndividual(item.chaveAcesso, item.numNf);
    }

    modalNfseSp.style.display = 'flex';
  }

  function fecharModalNfsePaulistana() {
    if (modalNfseSp) modalNfseSp.style.display = 'none';
  }

  /**
   * Baixa o XML individual de uma NFS-e
   */
  function baixarXmlIndividual(chaveAcesso, numeroNota) {
    if (!chaveAcesso) return;
    const token = localStorage.getItem('auth_token');
    const url = `/api/analista-fin/nfse-emitidas/${encodeURIComponent(chaveAcesso)}/xml`;

    fetch(url, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    })
    .then(res => {
      if (!res.ok) throw new Error('XML não encontrado no servidor.');
      return res.blob();
    })
    .then(blob => {
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `NFS-e_${numeroNota || 'nota'}.xml`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    })
    .catch(err => {
      notificar(`Erro ao baixar XML: ${err.message}`, 'error');
    });
  }

  /**
   * Exporta lote compactado ZIP de todos os XMLs de NFS-e da GSI do período
   */
  function exportarLoteXmlZip() {
    const empresa = selEmpresa ? selEmpresa.value : '15';
    const de = inputDataDe ? inputDataDe.value.replace(/[^0-9]/g, '') : '';
    const ate = inputDataAte ? inputDataAte.value.replace(/[^0-9]/g, '') : '';

    if (empresa !== '15') {
      notificar('A exportação de lote XML é exclusiva para as notas de serviço da GSI.', 'warning');
      return;
    }

    const token = localStorage.getItem('auth_token');
    const url = `/api/analista-fin/nfse-emitidas/exportar-zip?empresa=15&de=${de}&ate=${ate}`;

    notificar('Gerando pacote ZIP com os XMLs de NFS-e...', 'info');

    fetch(url, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    })
    .then(res => {
      if (!res.ok) {
        return res.json().then(j => { throw new Error(j.error || 'Erro ao gerar arquivo ZIP'); });
      }
      return res.blob();
    })
    .then(blob => {
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `NFS-e_GSI_${de}_${ate}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
      notificar('Download do lote de XMLs (.zip) concluído com sucesso!', 'success');
    })
    .catch(err => {
      notificar(`Falha ao exportar lote ZIP: ${err.message}`, 'error');
    });
  }

  /**
   * Dispara a sincronização mTLS contra a Prefeitura de SP
   */
  async function sincronizarNfseSp() {
    const de = inputDataDe ? inputDataDe.value.replace(/[^0-9]/g, '') : '';
    const ate = inputDataAte ? inputDataAte.value.replace(/[^0-9]/g, '') : '';

    const btn = document.getElementById('btnSincronizarNfseSp');
    const icon = document.getElementById('iconSyncNfseSp');
    const label = document.getElementById('labelSyncNfseSp');

    try {
      if (btn) btn.disabled = true;
      if (icon) icon.textContent = '⏳';
      if (label) label.textContent = 'Buscando na Prefeitura...';

      const res = await apiFetch('/api/analista-fin/nfse-emitidas/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ de, ate })
      });

      if (res.ok) {
        notificar(res.mensagem || 'Sincronização com a Prefeitura concluída!', 'success');
        await consultarFechamento();
      } else if (res.aviso) {
        notificar(res.error, 'warning');
      } else {
        notificar(res.error || 'Falha na sincronização com a Prefeitura.', 'error');
      }
    } catch (err) {
      notificar(`Erro ao sincronizar com a Prefeitura de SP: ${err.message}`, 'error');
    } finally {
      if (btn) btn.disabled = false;
      if (icon) icon.textContent = '🔄';
      if (label) label.textContent = 'Sincronizar NFS-e SP';
    }
  }

  /**
   * Importa arquivo de lote exportado da Nota Paulistana (XML ou TXT)
   */
  async function importarArquivoLotePaulistana(file) {
    if (!file) return;
    const formData = new FormData();
    formData.append('arquivo', file);

    const token = localStorage.getItem('auth_token');
    try {
      notificar(`Importando arquivo ${file.name}...`, 'info');
      const res = await fetch('/api/analista-fin/nfse-emitidas/upload', {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: formData
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        notificar(data.mensagem || 'Arquivo importado com sucesso!', 'success');
        await consultarFechamento();
      } else {
        notificar(data.error || 'Falha ao processar arquivo.', 'error');
      }
    } catch (err) {
      notificar(`Erro na importação: ${err.message}`, 'error');
    }
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
      'Operacao',
      'Tipo',
      'Tipo Doc.',
      'Formulario Proprio',
      'Num NF',
      'NF Origem',
      'Data',
      'Valor',
      'CFOP',
      'TES',
      'UF',
      'CNPJ/CPF',
      'Razao Social',
      'Gera Imposto',
      'Difal',
      'Origem Documental'
    ];

    const escapeCsv = (val) => {
      const str = String(val === null || val === undefined ? '' : val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = [headers.map(escapeCsv).join(';')];

    lista.forEach(item => {
      const isPrefeituraSp = item.origem === 'PREFEITURA_SP' || item.origem === 'PREFEITURA_SP_TXT';
      const row = [
        item.entraSaida,
        item.tipoOperacao,
        item.tipo,
        item.tipoDoc,
        item.formularioProprio ? 'Sim' : 'Não',
        item.numNf,
        item.nfOrigem || '',
        item.dataEmissaoFmt || item.dataDigitacaoFmt || '',
        Number(item.valor || 0).toFixed(2).replace('.', ','),
        item.cfop,
        item.tes,
        item.uf,
        item.cnpjCpf,
        item.razaoSocial,
        item.geraImposto,
        item.difal || '',
        isPrefeituraSp ? 'Prefeitura de SP (Nota Paulistana)' : 'TOTVS Protheus (SF2/SF1)'
      ];
      rows.push(row.map(escapeCsv).join(';'));
    });

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

  /**
   * Atualiza a visibilidade do botão 'Exportar XML' quando o filtro for 'SPED_NFE'
   */
  function atualizarVisibilidadeBotaoExportarXml() {
    if (!btnExportarXmlNfe || !selFiltroDoc) return;
    const isSpedNfe = selFiltroDoc.value === 'SPED_NFE' || selFiltroDoc.value === 'SPED & NFE';
    btnExportarXmlNfe.style.display = isSpedNfe ? 'inline-flex' : 'none';
  }

  /**
   * Notificação visual flutuante dedicada para ações de exportação XML
   */
  function notificarExportarXml(msg, tipo = 'warning') {
    let toast = document.getElementById('toastAvisoFechamentoXml');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toastAvisoFechamentoXml';
      toast.style.cssText = 'position: fixed; top: 24px; right: 24px; z-index: 10000; padding: 12px 18px; border-radius: 8px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.5); font-weight: 600; font-size: 0.9rem; transition: opacity 0.3s ease; display: flex; align-items: center; gap: 8px;';
      document.body.appendChild(toast);
    }
    if (tipo === 'warning') {
      toast.style.background = '#78350f';
      toast.style.color = '#fef3c7';
      toast.style.border = '1px solid #f59e0b';
      toast.innerHTML = `<span>⚠️</span> <span>${msg}</span>`;
    } else if (tipo === 'error') {
      toast.style.background = '#881337';
      toast.style.color = '#fff1f2';
      toast.style.border = '1px solid #f43f5e';
      toast.innerHTML = `<span>❌</span> <span>${msg}</span>`;
    } else {
      toast.style.background = '#065f46';
      toast.style.color = '#ecfdf5';
      toast.style.border = '1px solid #10b981';
      toast.innerHTML = `<span>✅</span> <span>${msg}</span>`;
    }
    toast.style.opacity = '1';
    toast.style.display = 'flex';
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => { if (toast) toast.style.display = 'none'; }, 300);
    }, 4500);

    notificar(msg, tipo);
  }

  /**
   * Abre o modal de confirmação para exportação de XMLs da SEFAZ
   */
  function abrirModalExportarXml() {
    if (!modalExportarXml) {
      modalExportarXml = document.getElementById('modalExportarXmlNfe');
    }
    if (!modalExportarXml) {
      console.error('Modal #modalExportarXmlNfe não encontrado no DOM.');
      return;
    }

    // Obtém as notas fiscais mercantis (SPED / NFE) da listagem filtrada ou atual
    const todosItens = (estadoFechamento && Array.isArray(estadoFechamento.itensFiltrados) && estadoFechamento.itensFiltrados.length > 0)
      ? estadoFechamento.itensFiltrados
      : ((estadoFechamento && estadoFechamento.dadosAtuais && Array.isArray(estadoFechamento.dadosAtuais.itens)) ? estadoFechamento.dadosAtuais.itens : []);

    const itens = todosItens.filter(item => {
      const doc = (item.tipoDoc || '').toUpperCase();
      return doc === 'SPED' || doc === 'NFE' || doc === 'NF-E';
    });

    if (itens.length === 0) {
      notificarExportarXml('Nenhuma nota fiscal mercantil (SPED / NFE) carregada na listagem. Por favor, clique em "Filtrar Documentos" antes de exportar.', 'warning');
      return;
    }

    if (!modalXmlEmpresaNome) modalXmlEmpresaNome = document.getElementById('modalXmlEmpresaNome');
    if (!modalXmlPeriodo) modalXmlPeriodo = document.getElementById('modalXmlPeriodo');
    if (!modalXmlQtdNotas) modalXmlQtdNotas = document.getElementById('modalXmlQtdNotas');
    if (!modalXmlProgressoContainer) modalXmlProgressoContainer = document.getElementById('modalXmlProgressoContainer');
    if (!modalXmlMensagem) modalXmlMensagem = document.getElementById('modalXmlMensagem');
    if (!btnConfirmarExportarXml) btnConfirmarExportarXml = document.getElementById('btnConfirmarExportarXml');

    const empNome = selEmpresa && selEmpresa.selectedIndex >= 0 ? selEmpresa.options[selEmpresa.selectedIndex].text : 'Empresa';
    const dtDe = inputDataDe ? inputDataDe.value : '';
    const dtAte = inputDataAte ? inputDataAte.value : '';

    if (modalXmlEmpresaNome) modalXmlEmpresaNome.textContent = empNome;
    if (modalXmlPeriodo) modalXmlPeriodo.textContent = `${dtDe} a ${dtAte}`;
    if (modalXmlQtdNotas) modalXmlQtdNotas.textContent = `${itens.length} notas fiscais`;

    // Reseta estado visual do modal
    if (modalXmlProgressoContainer) modalXmlProgressoContainer.style.display = 'none';
    if (modalXmlMensagem) {
      modalXmlMensagem.style.display = 'none';
      modalXmlMensagem.textContent = '';
    }
    if (btnConfirmarExportarXml) {
      btnConfirmarExportarXml.disabled = false;
      const ic = document.getElementById('btnConfirmarExportarXmlIcon');
      const tx = document.getElementById('btnConfirmarExportarXmlTexto');
      if (ic) ic.textContent = '📥';
      if (tx) tx.textContent = 'Gerar e Baixar .zip';
    }

    modalExportarXml.classList.remove('hidden');
    modalExportarXml.style.display = 'flex';
  }

  /**
   * Fecha o modal de exportação de XMLs
   */
  function fecharModalExportarXml() {
    if (!modalExportarXml) {
      modalExportarXml = document.getElementById('modalExportarXmlNfe');
    }
    if (!modalExportarXml) return;
    modalExportarXml.classList.add('hidden');
    modalExportarXml.style.display = 'none';
  }

  /**
   * Executa a chamada à API para obter XMLs da SEFAZ e disparar download do .zip
   */
  async function executarExportacaoXmlSefaz() {
    const todosItens = (estadoFechamento && Array.isArray(estadoFechamento.itensFiltrados) && estadoFechamento.itensFiltrados.length > 0)
      ? estadoFechamento.itensFiltrados
      : ((estadoFechamento && estadoFechamento.dadosAtuais && Array.isArray(estadoFechamento.dadosAtuais.itens)) ? estadoFechamento.dadosAtuais.itens : []);

    const itens = todosItens.filter(item => {
      const doc = (item.tipoDoc || '').toUpperCase();
      return doc === 'SPED' || doc === 'NFE' || doc === 'NF-E';
    });

    if (itens.length === 0) {
      notificarExportarXml('Nenhuma nota fiscal selecionada para exportação.', 'warning');
      return;
    }

    const empresa = selEmpresa ? selEmpresa.value : '16';
    const passphrase = inputSenhaCertificadoModalXml ? inputSenhaCertificadoModalXml.value.trim() : '';

    // Prepara tela de progresso
    if (modalXmlProgressoContainer) modalXmlProgressoContainer.style.display = 'block';
    if (modalXmlMensagem) modalXmlMensagem.style.display = 'none';
    if (btnConfirmarExportarXml) btnConfirmarExportarXml.disabled = true;

    const textoProg = document.getElementById('modalXmlProgressoTexto');
    const percProg = document.getElementById('modalXmlProgressoPerc');
    const barraProg = document.getElementById('modalXmlProgressoBarra');
    const detalheProg = document.getElementById('modalXmlProgressoDetalhe');

    if (textoProg) textoProg.textContent = `Processando ${itens.length} notas fiscais...`;
    if (percProg) percProg.textContent = 'Conectando...';
    if (barraProg) barraProg.style.width = '25%';
    if (detalheProg) detalheProg.textContent = 'Consultando cache local e WebService SEFAZ com mTLS A1...';

    const token = localStorage.getItem('auth_token');

    try {
      const payload = {
        empresa,
        itens: itens.map(i => ({
          doc: i.numNf,
          serie: i.serie,
          chave: i.chaveAcesso
        })),
        passphrase
      };

      if (barraProg) barraProg.style.width = '50%';
      if (detalheProg) detalheProg.textContent = 'Obtendo XMLs oficiais e gerando arquivo compactado...';

      const resp = await fetch('/api/analista-fin/fechamento-fiscal/exportar-xml-sefaz', {
        method: 'POST',
        headers: Object.assign(
          { 'Content-Type': 'application/json' },
          token ? { 'Authorization': `Bearer ${token}` } : {}
        ),
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        let errJson = {};
        try { errJson = await resp.json(); } catch {}
        throw new Error(errJson.error || `Erro HTTP ${resp.status}: ${resp.statusText}`);
      }

      if (barraProg) barraProg.style.width = '90%';
      if (detalheProg) detalheProg.textContent = 'Pacote .zip gerado! Iniciando download...';

      const blob = await resp.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;

      const dtDe = inputDataDe ? inputDataDe.value.replace(/[^0-9]/g, '') : '';
      const dtAte = inputDataAte ? inputDataAte.value.replace(/[^0-9]/g, '') : '';
      a.download = `NFE_XML_EMP${empresa}_${dtDe}_${dtAte}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);

      if (barraProg) barraProg.style.width = '100%';
      if (percProg) percProg.textContent = '100%';
      if (detalheProg) detalheProg.textContent = 'Download do pacote .zip concluído!';

      notificar(`Download do lote de ${itens.length} XMLs (.zip) concluído com sucesso!`, 'success');

      setTimeout(() => {
        fecharModalExportarXml();
      }, 1500);

    } catch (err) {
      console.error('Erro ao exportar XMLs da SEFAZ:', err);
      if (barraProg) barraProg.style.width = '0%';
      if (modalXmlMensagem) {
        modalXmlMensagem.style.display = 'block';
        modalXmlMensagem.style.background = 'rgba(239, 68, 68, 0.15)';
        modalXmlMensagem.style.color = '#f87171';
        modalXmlMensagem.style.border = '1px solid rgba(239, 68, 68, 0.3)';
        modalXmlMensagem.innerHTML = `⚠️ <strong>Falha na exportação:</strong> ${err.message}`;
      }
    } finally {
      if (btnConfirmarExportarXml) btnConfirmarExportarXml.disabled = false;
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
    sincronizarNfseSp,
    exportarLoteXmlZip,
    abrirModalNfsePaulistana,
    fecharModalNfsePaulistana,
    baixarXmlIndividual,
    atualizarVisibilidadeBotaoExportarXml,
    abrirModalExportarXml,
    fecharModalExportarXml,
    executarExportacaoXmlSefaz,
    getEstado: () => estadoFechamento
  };

})();
