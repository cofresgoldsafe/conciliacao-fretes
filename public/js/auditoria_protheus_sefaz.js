/**
 * auditoria_protheus_sefaz.js — Módulo de Auditoria Protheus x SEFAZ
 * Conferência mensal da sequência numérica de Notas Fiscais (Série 1),
 * detecção de saltos/gaps e batimento de cancelamentos e inutilizações entre o ERP e a SEFAZ.
 */

(function () {
  'use strict';

  // Estado Local do Módulo
  let estado = {
    inicializado: false,
    carregando: false,
    consultandoSefaz: false,
    dadosAtuais: null,
    itensComSefaz: null,
    itensFiltrados: [],
    filtroStatus: 'TODOS',
    termoBusca: ''
  };

  // Elementos do DOM
  let selEmpresa = null;
  let inputSerie = null;
  let inputDataDe = null;
  let inputDataAte = null;
  let selFiltroStatus = null;
  let inputBusca = null;
  let btnCarregar = null;
  let btnConsultarSefaz = null;
  let btnExportarCsv = null;

  let placeholder = null;
  let loading = null;
  let resultados = null;
  let boxProgressoSefaz = null;
  let barraProgressoSefaz = null;
  let lblProgressoSefaz = null;

  let kpiTotalFaixa = null;
  let kpiAtivas = null;
  let kpiCanceladas = null;
  let kpiInutilizadas = null;
  let kpiFaltantes = null;
  let kpiDivergencias = null;
  let cardKpiDivergencias = null;

  let contadorRegistros = null;
  let tbodyTabela = null;

  // Formatadores
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
   * Calcula as datas padrão para o primeiro e último dia do mês anterior
   */
  function calcularDatasMesAnterior() {
    const hoje = new Date();
    const anoAtual = hoje.getFullYear();
    const mesAtual = hoje.getMonth(); // 0 a 11

    const mesAnterior = mesAtual === 0 ? 11 : mesAtual - 1;
    const anoAnterior = mesAtual === 0 ? anoAtual - 1 : anoAtual;

    const ultimoDia = new Date(anoAnterior, mesAnterior + 1, 0);

    const pad = (n) => String(n).padStart(2, '0');
    const deStr = `${anoAnterior}-${pad(mesAnterior + 1)}-01`;
    const ateStr = `${anoAnterior}-${pad(mesAnterior + 1)}-${pad(ultimoDia.getDate())}`;

    return { de: deStr, ate: ateStr };
  }

  /**
   * Notificação Toast flutuante
   */
  function exibirToast(msg, tipo = 'info') {
    const toastExistente = document.getElementById('toastAuditoriaFiscal');
    if (toastExistente) toastExistente.remove();

    const toast = document.createElement('div');
    toast.id = 'toastAuditoriaFiscal';
    toast.style.position = 'fixed';
    toast.style.bottom = '24px';
    toast.style.right = '24px';
    toast.style.padding = '12px 20px';
    toast.style.borderRadius = '8px';
    toast.style.zIndex = '9999';
    toast.style.fontSize = '0.9rem';
    toast.style.fontWeight = '600';
    toast.style.boxShadow = '0 10px 15px -3px rgba(0,0,0,0.5)';
    toast.style.transition = 'all 0.3s ease';
    toast.style.display = 'flex';
    toast.style.alignItems = 'center';
    toast.style.gap = '8px';

    if (tipo === 'sucesso') {
      toast.style.background = '#065f46';
      toast.style.color = '#ecfdf5';
      toast.style.border = '1px solid #10b981';
      toast.innerHTML = `<span>✅</span> <span>${msg}</span>`;
    } else if (tipo === 'erro') {
      toast.style.background = '#881337';
      toast.style.color = '#fff1f2';
      toast.style.border = '1px solid #f43f5e';
      toast.innerHTML = `<span>❌</span> <span>${msg}</span>`;
    } else if (tipo === 'alerta') {
      toast.style.background = '#78350f';
      toast.style.color = '#fef3c7';
      toast.style.border = '1px solid #f59e0b';
      toast.innerHTML = `<span>⚠️</span> <span>${msg}</span>`;
    } else {
      toast.style.background = '#1e293b';
      toast.style.color = '#f8fafc';
      toast.style.border = '1px solid #475569';
      toast.innerHTML = `<span>ℹ️</span> <span>${msg}</span>`;
    }

    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  /**
   * Copia a Chave de Acesso para a área de transferência
   */
  async function copiarChave(chave, btnElement) {
    if (!chave) return;
    try {
      await navigator.clipboard.writeText(chave);
      if (btnElement) {
        const textoOriginal = btnElement.innerHTML;
        btnElement.innerHTML = '✓ Copiado';
        btnElement.style.color = '#10b981';
        setTimeout(() => {
          btnElement.innerHTML = textoOriginal;
          btnElement.style.color = '';
        }, 2000);
      }
      exibirToast(`Chave de acesso copiada: ${chave.slice(0, 10)}...${chave.slice(-6)}`, 'sucesso');
    } catch (err) {
      exibirToast('Falha ao copiar chave de acesso.', 'erro');
    }
  }

  /**
   * Inicializa as referências DOM e configurações
   */
  function initAuditoria() {
    selEmpresa = document.getElementById('selAuditoriaEmpresa');
    inputSerie = document.getElementById('inputAuditoriaSerie');
    inputDataDe = document.getElementById('inputAuditoriaDataDe');
    inputDataAte = document.getElementById('inputAuditoriaDataAte');
    selFiltroStatus = document.getElementById('selAuditoriaFiltroStatus');
    inputBusca = document.getElementById('inputAuditoriaBusca');

    btnCarregar = document.getElementById('btnCarregarAuditoriaProtheus');
    btnConsultarSefaz = document.getElementById('btnConsultarAuditoriaSefaz');
    btnExportarCsv = document.getElementById('btnExportarAuditoriaCsv');

    placeholder = document.getElementById('auditoriaPlaceholder');
    loading = document.getElementById('auditoriaLoading');
    resultados = document.getElementById('auditoriaResultados');
    boxProgressoSefaz = document.getElementById('boxProgressoSefaz');
    barraProgressoSefaz = document.getElementById('barraProgressoSefaz');
    lblProgressoSefaz = document.getElementById('lblProgressoSefaz');

    kpiTotalFaixa = document.getElementById('kpiAuditoriaTotalFaixa');
    kpiAtivas = document.getElementById('kpiAuditoriaAtivas');
    kpiCanceladas = document.getElementById('kpiAuditoriaCanceladas');
    kpiInutilizadas = document.getElementById('kpiAuditoriaInutilizadas');
    kpiFaltantes = document.getElementById('kpiAuditoriaFaltantes');
    kpiDivergencias = document.getElementById('kpiAuditoriaDivergencias');
    cardKpiDivergencias = document.getElementById('cardKpiAuditoriaDivergencias');

    contadorRegistros = document.getElementById('auditoriaTableCount');
    tbodyTabela = document.getElementById('tbodyAuditoriaProtheusSefaz');

    // Preenche as datas padrão com o mês anterior
    if (inputDataDe && inputDataAte && (!inputDataDe.value || !inputDataAte.value)) {
      const datasPadrao = calcularDatasMesAnterior();
      inputDataDe.value = datasPadrao.de;
      inputDataAte.value = datasPadrao.ate;
    }

    // Vincula Eventos (apenas uma vez)
    if (!estado.inicializado) {
      if (btnCarregar) btnCarregar.addEventListener('click', carregarAuditoriaProtheus);
      if (btnConsultarSefaz) btnConsultarSefaz.addEventListener('click', consultarSefazEmLote);
      if (btnExportarCsv) btnExportarCsv.addEventListener('click', exportarCsvAuditoria);

      if (selFiltroStatus) {
        selFiltroStatus.addEventListener('change', () => {
          estado.filtroStatus = selFiltroStatus.value;
          aplicarFiltrosETabela();
        });
      }

      if (inputBusca) {
        inputBusca.addEventListener('input', (e) => {
          estado.termoBusca = (e.target.value || '').toLowerCase().trim();
          aplicarFiltrosETabela();
        });
      }

      estado.inicializado = true;
    }
  }

  /**
   * Consulta Protheus (SF2 + SF3) e gera a auditoria de NFs e Gaps
   */
  async function carregarAuditoriaProtheus() {
    if (estado.carregando || estado.consultandoSefaz) return;

    const empresa = selEmpresa ? selEmpresa.value : '';
    const de = inputDataDe ? inputDataDe.value : '';
    const ate = inputDataAte ? inputDataAte.value : '';
    const serie = inputSerie ? inputSerie.value : '1';

    if (!empresa) {
      exibirToast('Selecione uma empresa para consultar.', 'alerta');
      if (selEmpresa) selEmpresa.focus();
      return;
    }

    if (!de || !ate) {
      exibirToast('Informe a data inicial e final do período.', 'alerta');
      return;
    }

    if (de > ate) {
      exibirToast('A data inicial não pode ser maior que a data final.', 'alerta');
      return;
    }

    estado.carregando = true;
    if (placeholder) placeholder.style.display = 'none';
    if (resultados) resultados.style.display = 'none';
    if (loading) loading.style.display = 'block';

    if (btnCarregar) btnCarregar.disabled = true;

    try {
      const token = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token') || '';
      const url = `/api/analista-fin/auditoria-protheus-sefaz/consulta?empresa=${encodeURIComponent(empresa)}&de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}&serie=${encodeURIComponent(serie)}`;

      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!res.ok) {
        const erroJson = await res.json().catch(() => ({}));
        throw new Error(erroJson.error || `Erro HTTP ${res.status}`);
      }

      const dados = await res.json();
      estado.dadosAtuais = dados;
      estado.itensComSefaz = dados.itens.map(it => ({
        ...it,
        statusSefaz: it.isGap ? 'NAO_CONSTA' : 'NAO_CONSULTADA',
        sefazDesc: it.isGap ? 'NF-e não consta na base da SEFAZ' : 'Aguardando verificação SEFAZ',
        sefazProt: '',
        sefazData: '',
        diagnostico: it.isGap ? {
          divergencia: true,
          gravidade: 'ALERTA',
          label: '⚠️ SALTO DE NUMERAÇÃO',
          tooltip: 'Número pulado sem emissão e sem inutilização comprovada.'
        } : {
          divergencia: false,
          gravidade: 'PENDENTE',
          label: '⏳ AGUARDANDO SEFAZ',
          tooltip: 'Clique em "Consultar Situação SEFAZ" para checar na Fazenda.'
        }
      }));

      // Atualiza KPIs do Protheus
      atualizarKpis(dados.kpis);

      // Mostra botões de ação adicionais
      if (btnConsultarSefaz) btnConsultarSefaz.style.display = 'inline-flex';
      if (btnExportarCsv) btnExportarCsv.style.display = 'inline-flex';

      aplicarFiltrosETabela();

      if (loading) loading.style.display = 'none';
      if (resultados) resultados.style.display = 'block';

      exibirToast(`Consulta Protheus concluída: ${dados.kpis.totalRegistros} registros na faixa ${dados.faixa.min} a ${dados.faixa.max}.`, 'sucesso');

      // Se a opção de consultar SEFAZ automaticamente estiver ativa, dispara a consulta em lote
      const chkAuto = document.getElementById('chkAuditoriaAutoSefaz');
      const deveConsultarSefaz = !chkAuto || chkAuto.checked;
      if (deveConsultarSefaz && estado.itensComSefaz.length > 0) {
        consultarSefazEmLote();
      }
    } catch (err) {
      console.error('Erro ao consultar auditoria no Protheus:', err);
      if (loading) loading.style.display = 'none';
      if (placeholder) placeholder.style.display = 'block';
      exibirToast(`Falha na consulta Protheus: ${err.message}`, 'erro');
    } finally {
      estado.carregando = false;
      if (btnCarregar) btnCarregar.disabled = false;
    }
  }

  /**
   * Consulta a SEFAZ em lote para as NFs carregadas
   */
  async function consultarSefazEmLote() {
    if (!estado.itensComSefaz || estado.itensComSefaz.length === 0) {
      exibirToast('Nenhum registro carregado para consulta SEFAZ.', 'alerta');
      return;
    }

    if (estado.consultandoSefaz) return;

    const empresa = selEmpresa ? selEmpresa.value : '14';
    estado.consultandoSefaz = true;

    if (btnConsultarSefaz) btnConsultarSefaz.disabled = true;
    if (btnCarregar) btnCarregar.disabled = true;

    if (boxProgressoSefaz) boxProgressoSefaz.style.display = 'block';
    if (barraProgressoSefaz) barraProgressoSefaz.style.width = '10%';
    if (lblProgressoSefaz) lblProgressoSefaz.textContent = 'Iniciando consulta ao WebService da SEFAZ-SP via mTLS...';

    try {
      const token = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token') || '';

      // Monta o lote apenas com chaves de 44 dígitos ou NFs válidas
      const itensParaConsultar = estado.itensComSefaz.map(it => ({
        doc: it.doc,
        chaveNfe: it.chaveNfe || '',
        statusProtheus: it.statusProtheus
      }));

      if (barraProgressoSefaz) barraProgressoSefaz.style.width = '40%';
      if (lblProgressoSefaz) lblProgressoSefaz.textContent = `Consultando ${itensParaConsultar.length} notas junto à SEFAZ-SP...`;

      const res = await fetch('/api/analista-fin/auditoria-protheus-sefaz/consultar-sefaz', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          empresa,
          itens: itensParaConsultar
        })
      });

      if (barraProgressoSefaz) barraProgressoSefaz.style.width = '85%';

      if (!res.ok) {
        const erroJson = await res.json().catch(() => ({}));
        throw new Error(erroJson.error || `Erro HTTP ${res.status}`);
      }

      const resposta = await res.json();
      const mapaRetorno = new Map();

      for (const r of (resposta.resultados || [])) {
        mapaRetorno.set(r.doc, r);
      }

      let countDivergencias = 0;

      // Mescla os resultados de retorno da SEFAZ com os itens da tela
      for (const it of estado.itensComSefaz) {
        if (mapaRetorno.has(it.doc)) {
          const ret = mapaRetorno.get(it.doc);
          it.statusSefaz = ret.sefaz.status;
          it.sefazRotulo = ret.sefaz.rotulo;
          it.sefazDesc = ret.sefaz.xMotivo;
          it.sefazProt = ret.sefaz.protocolo;
          it.sefazData = ret.sefaz.dataHora;
          it.diagnostico = ret.diagnostico;

          if (ret.diagnostico && ret.diagnostico.divergencia) {
            countDivergencias++;
          }
        }
      }

      if (barraProgressoSefaz) barraProgressoSefaz.style.width = '100%';
      if (lblProgressoSefaz) lblProgressoSefaz.textContent = `Concluído! ${resposta.totalConsultadas} NFs verificadas. ${countDivergencias} divergências encontradas.`;

      // Atualiza KPI de Divergências
      if (kpiDivergencias) kpiDivergencias.textContent = formatarInt(countDivergencias);
      if (cardKpiDivergencias) {
        if (countDivergencias > 0) {
          cardKpiDivergencias.style.borderColor = '#f43f5e';
          cardKpiDivergencias.style.background = 'rgba(244, 63, 94, 0.12)';
        } else {
          cardKpiDivergencias.style.borderColor = '#10b981';
          cardKpiDivergencias.style.background = 'rgba(16, 185, 129, 0.08)';
        }
      }

      aplicarFiltrosETabela();

      if (countDivergencias > 0) {
        exibirToast(`Atenção: ${countDivergencias} divergências encontradas entre Protheus e SEFAZ!`, 'alerta');
      } else {
        exibirToast('Parabéns: Nenhuma divergência encontrada junto à SEFAZ!', 'sucesso');
      }

      setTimeout(() => {
        if (boxProgressoSefaz) boxProgressoSefaz.style.display = 'none';
      }, 3500);
    } catch (err) {
      console.error('Erro na consulta em lote SEFAZ:', err);
      if (lblProgressoSefaz) lblProgressoSefaz.textContent = `Erro: ${err.message}`;
      if (barraProgressoSefaz) barraProgressoSefaz.style.backgroundColor = '#f43f5e';
      exibirToast(`Falha na consulta SEFAZ: ${err.message}`, 'erro');
    } finally {
      estado.consultandoSefaz = false;
      if (btnConsultarSefaz) btnConsultarSefaz.disabled = false;
      if (btnCarregar) btnCarregar.disabled = false;
    }
  }

  /**
   * Atualiza os números dos cards de KPIs no topo
   */
  function atualizarKpis(kpis) {
    if (!kpis) return;
    if (kpiTotalFaixa) kpiTotalFaixa.textContent = formatarInt(kpis.totalFaixa || 0);
    if (kpiAtivas) kpiAtivas.textContent = formatarInt(kpis.ativas || 0);
    if (kpiCanceladas) kpiCanceladas.textContent = formatarInt(kpis.canceladas || 0);
    if (kpiInutilizadas) kpiInutilizadas.textContent = formatarInt(kpis.inutilizadas || 0);
    if (kpiFaltantes) kpiFaltantes.textContent = formatarInt(kpis.faltantes || 0);
    if (kpiDivergencias) kpiDivergencias.textContent = formatarInt(kpis.divergencias || 0);
  }

  /**
   * Aplica filtros (Status e Busca) e renderiza as linhas da tabela
   */
  function aplicarFiltrosETabela() {
    if (!estado.itensComSefaz) return;

    let lista = estado.itensComSefaz;

    // Filtro por Status
    if (estado.filtroStatus === 'DIVERGENCIAS') {
      lista = lista.filter(it => it.diagnostico && it.diagnostico.divergencia);
    } else if (estado.filtroStatus === 'CANCELADAS') {
      lista = lista.filter(it => it.statusProtheus === 'CANCELADA');
    } else if (estado.filtroStatus === 'INUTILIZADAS') {
      lista = lista.filter(it => it.statusProtheus === 'INUTILIZADA');
    } else if (estado.filtroStatus === 'FALTANTES') {
      lista = lista.filter(it => it.statusProtheus === 'FALTANTE');
    } else if (estado.filtroStatus === 'ATIVAS') {
      lista = lista.filter(it => it.statusProtheus === 'ATIVA');
    }

    // Filtro por Termo de Busca
    if (estado.termoBusca) {
      const q = estado.termoBusca;
      lista = lista.filter(it =>
        (it.doc || '').toLowerCase().includes(q) ||
        (it.chaveNfe || '').toLowerCase().includes(q) ||
        (it.clienteNome || '').toLowerCase().includes(q) ||
        (it.clienteCgc || '').toLowerCase().includes(q)
      );
    }

    estado.itensFiltrados = lista;

    if (contadorRegistros) {
      contadorRegistros.textContent = `${lista.length} de ${estado.itensComSefaz.length} notas`;
    }

    renderizarTabela(lista);
  }

  /**
   * Renderiza a tabela de auditoria
   */
  function renderizarTabela(lista) {
    if (!tbodyTabela) return;
    tbodyTabela.innerHTML = '';

    if (lista.length === 0) {
      tbodyTabela.innerHTML = `
        <tr>
          <td colspan="10" style="text-align: center; padding: 2rem; color: var(--text-muted, #94a3b8);">
            Nenhum registro encontrado com os filtros aplicados.
          </td>
        </tr>
      `;
      return;
    }

    const fragment = document.createDocumentFragment();

    for (const it of lista) {
      const tr = document.createElement('tr');

      // Se for divergência crítica, aplica destaque de fundo sutil
      if (it.diagnostico && it.diagnostico.gravidade === 'CRITICA') {
        tr.style.background = 'rgba(244, 63, 94, 0.08)';
      } else if (it.isGap) {
        tr.style.background = 'rgba(245, 158, 11, 0.05)';
      }

      // 1. Empresa / Série
      const tdEmp = document.createElement('td');
      tdEmp.style.textAlign = 'center';
      tdEmp.style.fontSize = '0.85rem';
      tdEmp.style.fontWeight = '600';
      tdEmp.innerHTML = `<span class="badge" style="background: rgba(148, 163, 184, 0.15); color: #cbd5e1;">${estado.dadosAtuais ? estado.dadosAtuais.empresaNome : 'Empresa'}</span>`;

      // 2. Número da NF
      const tdDoc = document.createElement('td');
      tdDoc.style.fontWeight = '700';
      tdDoc.style.fontSize = '0.92rem';
      tdDoc.style.color = it.isGap ? '#f59e0b' : '#38bdf8';
      tdDoc.innerHTML = it.isGap
        ? `<span title="Salto de Numeração: número não emitido">${it.doc} ⚠️</span>`
        : it.doc;

      // 3. Emissão
      const tdEmissao = document.createElement('td');
      tdEmissao.style.textAlign = 'center';
      tdEmissao.style.fontSize = '0.85rem';
      tdEmissao.textContent = it.emissaoFormatada || '-';

      // 4. Cliente / Destinatário
      const tdCli = document.createElement('td');
      tdCli.style.fontSize = '0.85rem';
      if (it.isGap) {
        tdCli.innerHTML = '<span style="color: #f59e0b; font-style: italic;">Salto de Numeração (Não Emitida)</span>';
      } else {
        const nome = it.clienteNome || 'Consumidor / Não Informado';
        const cgc = it.clienteCgc ? `<br><small style="color: var(--text-muted, #94a3b8);">${it.clienteCgc}</small>` : '';
        tdCli.innerHTML = `<span style="color: #f8fafc; font-weight: 500;">${nome}</span>${cgc}`;
      }

      // 5. Valor (R$)
      const tdValor = document.createElement('td');
      tdValor.style.textAlign = 'right';
      tdValor.style.fontWeight = '600';
      tdValor.style.fontSize = '0.88rem';
      tdValor.textContent = it.valor > 0 ? formatarMoeda(it.valor) : '-';

      // 6. Status no Protheus
      const tdStatusProtheus = document.createElement('td');
      tdStatusProtheus.style.textAlign = 'center';
      tdStatusProtheus.innerHTML = renderizarBadgeProtheus(it.statusProtheus);

      // 7. Status na SEFAZ
      const tdStatusSefaz = document.createElement('td');
      tdStatusSefaz.style.textAlign = 'center';
      tdStatusSefaz.innerHTML = renderizarBadgeSefaz(it.statusSefaz, it.sefazProt, it.sefazDesc);

      // 8. Diagnóstico / Batimento
      const tdDiag = document.createElement('td');
      tdDiag.style.textAlign = 'center';
      tdDiag.innerHTML = renderizarBadgeDiagnostico(it.diagnostico);

      // 9. Chave de Acesso
      const tdChave = document.createElement('td');
      tdChave.style.fontFamily = 'monospace';
      tdChave.style.fontSize = '0.78rem';
      if (it.chaveNfe && it.chaveNfe.length === 44) {
        const chaveAbrev = `${it.chaveNfe.slice(0, 8)}...${it.chaveNfe.slice(-6)}`;
        tdChave.innerHTML = `
          <div style="display: flex; align-items: center; gap: 6px;">
            <span title="${it.chaveNfe}" style="color: #94a3b8;">${chaveAbrev}</span>
            <button type="button" class="btn btn-sm btn-outline btnCopiarChave" style="padding: 2px 6px; font-size: 0.72rem;" title="Copiar Chave Completa">📋</button>
            <a href="https://www.nfe.fazenda.gov.br/portal/consultaRecaptcha.aspx?tipoConsulta=resumo&tipoConteudo=7PhJ%2BpHjwsg=" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline" style="padding: 2px 6px; font-size: 0.72rem;" title="Consultar no Portal Nacional da NF-e">🌐</a>
          </div>
        `;
        const btnCopy = tdChave.querySelector('.btnCopiarChave');
        if (btnCopy) {
          btnCopy.addEventListener('click', () => copiarChave(it.chaveNfe, btnCopy));
        }
      } else {
        tdChave.innerHTML = '<span style="color: var(--text-muted, #64748b); font-style: italic;">Sem Chave</span>';
      }

      tr.appendChild(tdEmp);
      tr.appendChild(tdDoc);
      tr.appendChild(tdEmissao);
      tr.appendChild(tdCli);
      tr.appendChild(tdValor);
      tr.appendChild(tdStatusProtheus);
      tr.appendChild(tdStatusSefaz);
      tr.appendChild(tdDiag);
      tr.appendChild(tdChave);

      fragment.appendChild(tr);
    }

    tbodyTabela.appendChild(fragment);
  }

  function renderizarBadgeProtheus(status) {
    if (status === 'ATIVA') {
      return '<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);">🟢 ATIVA</span>';
    } else if (status === 'CANCELADA') {
      return '<span class="badge" style="background: rgba(244, 63, 94, 0.15); color: #f43f5e; border: 1px solid rgba(244, 63, 94, 0.3);">🔴 CANCELADA</span>';
    } else if (status === 'INUTILIZADA') {
      return '<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3);">⚪ INUTILIZADA</span>';
    } else if (status === 'FALTANTE') {
      return '<span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #ef4444; border: 1px dashed #ef4444;">⚠️ SALTO / GAP</span>';
    }
    return `<span class="badge" style="background: rgba(148, 163, 184, 0.2); color: #cbd5e1;">${status || '-'}</span>`;
  }

  function renderizarBadgeSefaz(status, prot, desc) {
    const info = prot ? ` title="Protocolo SEFAZ: ${prot}"` : (desc ? ` title="${desc}"` : '');
    if (status === 'AUTORIZADA') {
      return `<span class="badge"${info} style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);">🟢 AUTORIZADA (100)</span>`;
    } else if (status === 'CANCELADA') {
      return `<span class="badge"${info} style="background: rgba(244, 63, 94, 0.15); color: #f43f5e; border: 1px solid rgba(244, 63, 94, 0.3);">🔴 CANCELADA (101)</span>`;
    } else if (status === 'INUTILIZADA') {
      return `<span class="badge"${info} style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3);">⚪ INUTILIZADA (102)</span>`;
    } else if (status === 'NAO_CONSTA') {
      return `<span class="badge"${info} style="background: rgba(148, 163, 184, 0.15); color: #94a3b8;">❌ NÃO CONSTA (217)</span>`;
    } else if (status === 'NAO_CONSULTADA') {
      return '<span class="badge" style="background: rgba(148, 163, 184, 0.1); color: #64748b;">❓ PENDENTE</span>';
    } else if (status === 'ERRO_CONEXAO') {
      return `<span class="badge"${info} style="background: rgba(239, 68, 68, 0.2); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.4);">🔌 ERRO CONEXÃO</span>`;
    } else if (status === 'SEM_CERTIFICADO') {
      return `<span class="badge"${info} style="background: rgba(245, 158, 11, 0.2); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.4);">⚠️ SEM CERTIFICADO</span>`;
    } else if (status === 'ERRO_CERTIFICADO' || status === 'CERTIFICADO_REJEITADO') {
      return `<span class="badge"${info} style="background: rgba(239, 68, 68, 0.2); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.4);">🚫 ERRO CERTIFICADO</span>`;
    } else if (status === 'ERRO_SCHEMA' || status === 'CSTAT_588') {
      return `<span class="badge"${info} style="background: rgba(245, 158, 11, 0.2); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.4);">⚠️ ERRO XML (588)</span>`;
    } else if (status === 'OUTRO') {
      return `<span class="badge"${info} style="background: rgba(148, 163, 184, 0.2); color: #cbd5e1;">ℹ️ OUTRO STATUS</span>`;
    } else if (status && status.startsWith('CSTAT_')) {
      const cod = status.replace('CSTAT_', '');
      return `<span class="badge"${info} style="background: rgba(148, 163, 184, 0.2); color: #cbd5e1;">cStat ${cod}</span>`;
    }
    return `<span class="badge"${info} style="background: rgba(148, 163, 184, 0.2); color: #cbd5e1;">${status || '-'}</span>`;
  }

  function renderizarBadgeDiagnostico(diag) {
    if (!diag) return '<span style="color: #64748b;">-</span>';
    if (diag.gravidade === 'CRITICA') {
      return `<span class="badge" title="${diag.tooltip || ''}" style="background: #e11d48; color: #fff; font-weight: 700; animation: pulse 1.5s infinite; border: 1px solid #fda4af;">${diag.label}</span>`;
    } else if (diag.gravidade === 'ALERTA') {
      return `<span class="badge" title="${diag.tooltip || ''}" style="background: rgba(245, 158, 11, 0.2); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.4);">${diag.label}</span>`;
    } else if (diag.gravidade === 'OK') {
      return `<span class="badge" title="${diag.tooltip || ''}" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);">${diag.label}</span>`;
    }
    return `<span class="badge" title="${diag.tooltip || ''}" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8;">${diag.label || '-'}</span>`;
  }

  /**
   * Exporta os dados da tabela para arquivo CSV formatado para Microsoft Excel
   */
  function exportarCsvAuditoria() {
    if (!estado.itensFiltrados || estado.itensFiltrados.length === 0) {
      exibirToast('Nenhum dado disponível para exportação.', 'alerta');
      return;
    }

    const cabecalho = [
      'Empresa',
      'Numero_NF',
      'Serie',
      'Data_Emissao',
      'Cliente_Razao_Social',
      'Cliente_CNPJ_CPF',
      'Valor_Total_R$',
      'Status_Protheus',
      'Status_SEFAZ',
      'Diagnostico_Batimento',
      'Chave_Acesso_44_Digitos',
      'Protocolo_SEFAZ'
    ];

    const linhas = estado.itensFiltrados.map(it => [
      estado.dadosAtuais ? estado.dadosAtuais.empresaNome : 'Empresa',
      `"${it.doc}"`,
      `"${it.serie}"`,
      `"${it.emissaoFormatada}"`,
      `"${(it.clienteNome || '').replace(/"/g, '""')}"`,
      `"${it.clienteCgc || ''}"`,
      it.valor ? it.valor.toFixed(2).replace('.', ',') : '0,00',
      `"${it.statusProtheus || ''}"`,
      `"${it.statusSefaz || ''}"`,
      `"${(it.diagnostico && it.diagnostico.label ? it.diagnostico.label : '').replace(/"/g, '""')}"`,
      `"${it.chaveNfe || ''}"`,
      `"${it.sefazProt || ''}"`
    ]);

    const csvContent = '\uFEFF' + [
      cabecalho.join(';'),
      ...linhas.map(l => l.join(';'))
    ].join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    const empresa = estado.dadosAtuais ? estado.dadosAtuais.empresaNome : 'Fiscal';
    const de = inputDataDe ? inputDataDe.value : '';
    const ate = inputDataAte ? inputDataAte.value : '';

    link.setAttribute('href', url);
    link.setAttribute('download', `Auditoria_NFe_SEFAZ_${empresa}_${de}_a_${ate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    exibirToast('Relatório CSV exportado com sucesso!', 'sucesso');
  }

  // Exportação Global para o Sistema
  window.AuditoriaProtheusSefazModule = {
    init: initAuditoria,
    carregarAuditoriaProtheus,
    consultarSefazEmLote,
    exportarCsvAuditoria,
    calcularDatasMesAnterior
  };

  // Inicialização Automática caso o DOM já esteja pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuditoria);
  } else {
    initAuditoria();
  }
})();
