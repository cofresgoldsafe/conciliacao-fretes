/**
 * holerites.js - Módulo Frontend de Gestão, Upload e Emissão de Holerites Executivos
 * Suporta: GSI BW, OAÇO e Colaboradores Sem Registro
 */

(function () {
  'use strict';

  // Estado Local do Módulo
  const state = {
    selectedAno: null,
    selectedMes: null,
    selectedEmpresa: 'TODAS',
    selectedTipo: 'TODOS',
    searchQuery: '',
    competencias: [],
    holerites: [],
    selectedIds: new Set(),
    uploadFiles: [],
    currentPreviewDoc: null
  };

  // Utilitários de Formatação
  function formatMoney(val) {
    const num = parseFloat(val) || 0.0;
    return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function getAuthHeader() {
    const token = localStorage.getItem('token') || localStorage.getItem('authToken');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  }

  // Inicialização do Módulo
  function init() {
    console.log('📄 [Holerites] Inicializando módulo...');
    setupEventListeners();
    carregarCompetencias();
    carregarHolerites();
  }

  function setupEventListeners() {
    // 1. Drag-and-Drop & Seleção de Arquivos
    const dropZone = document.getElementById('holeriteDropZone');
    const fileInput = document.getElementById('inputFilesHolerite');

    if (dropZone && fileInput) {
      dropZone.addEventListener('click', () => fileInput.click());

      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
      });

      dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
      });

      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer && e.dataTransfer.files) {
          handleFilesSelected(Array.from(e.dataTransfer.files));
        }
      });

      fileInput.addEventListener('change', (e) => {
        if (e.target.files) {
          handleFilesSelected(Array.from(e.target.files));
        }
      });
    }

    // Botões da Fila de Upload
    const btnClearQueue = document.getElementById('btnClearHoleriteQueue');
    if (btnClearQueue) {
      btnClearQueue.addEventListener('click', clearUploadQueue);
    }

    const btnConfirmarUpload = document.getElementById('btnConfirmarUploadHolerite');
    if (btnConfirmarUpload) {
      btnConfirmarUpload.addEventListener('click', executarUpload);
    }

    // Botão de Rolagem Suave até o Upload
    const btnScroll = document.getElementById('btnScrollToUploadHolerite');
    if (btnScroll) {
      btnScroll.addEventListener('click', () => {
        const sec = document.getElementById('secaoUploadHolerites');
        if (sec) sec.scrollIntoView({ behavior: 'smooth' });
      });
    }

    // Botão de Atualizar Lista
    const btnRefresh = document.getElementById('btnRefreshHolerites');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => {
        carregarCompetencias();
        carregarHolerites();
      });
    }

    // 2. Filtros de Empresa
    const groupEmpresa = document.getElementById('groupFiltroEmpresaHolerites');
    if (groupEmpresa) {
      groupEmpresa.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-filtro-empresa');
        if (!btn) return;
        groupEmpresa.querySelectorAll('.btn-filtro-empresa').forEach(b => {
          b.classList.remove('active', 'btn-primary');
          b.classList.add('btn-outline');
        });
        btn.classList.add('active', 'btn-primary');
        btn.classList.remove('btn-outline');
        state.selectedEmpresa = btn.dataset.empresa || 'TODAS';
        carregarHolerites();
      });
    }

    // 3. Filtros de Tipo de Documento
    const groupTipo = document.getElementById('groupFiltroTipoHolerites');
    if (groupTipo) {
      groupTipo.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-filtro-tipo');
        if (!btn) return;
        groupTipo.querySelectorAll('.btn-filtro-tipo').forEach(b => {
          b.classList.remove('active', 'btn-primary');
          b.classList.add('btn-outline');
        });
        btn.classList.add('active', 'btn-primary');
        btn.classList.remove('btn-outline');
        state.selectedTipo = btn.dataset.tipo || 'TODOS';
        carregarHolerites();
      });
    }

    // 4. Busca Instantânea (com debounce)
    const inputBusca = document.getElementById('inputBuscaHolerite');
    let debounceTimer = null;
    if (inputBusca) {
      inputBusca.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          state.searchQuery = e.target.value.trim();
          carregarHolerites();
        }, 300);
      });
    }

    const btnClearBusca = document.getElementById('btnClearBuscaHolerite');
    if (btnClearBusca && inputBusca) {
      btnClearBusca.addEventListener('click', () => {
        inputBusca.value = '';
        state.searchQuery = '';
        carregarHolerites();
      });
    }

    // 5. Checkbox Selecionar Todos
    const chkSelectAll = document.getElementById('chkSelectAllHolerites');
    if (chkSelectAll) {
      chkSelectAll.addEventListener('change', (e) => {
        const checked = e.target.checked;
        const checkboxes = document.querySelectorAll('.chk-holerite-item');
        checkboxes.forEach(chk => {
          chk.checked = checked;
          const id = parseInt(chk.dataset.id, 10);
          if (checked) state.selectedIds.add(id);
          else state.selectedIds.delete(id);
        });
        atualizarContadorSelecionados();
      });
    }

    // 6. Ações em Lote
    const btnImprimirLote = document.getElementById('btnImprimirSelecionadosHolerite');
    if (btnImprimirLote) {
      btnImprimirLote.addEventListener('click', imprimirSelecionados);
    }

    const btnMsgLote = document.getElementById('btnMensagemLoteHolerite');
    if (btnMsgLote) {
      btnMsgLote.addEventListener('click', abrirModalMensagemLote);
    }

    const btnExportar = document.getElementById('btnExportarExcelHolerites');
    if (btnExportar) {
      btnExportar.addEventListener('click', exportarParaExcel);
    }

    // 7. Modais
    setupModalControls();
  }

  function setupModalControls() {
    // Modal Preview
    const btnFecharPreview = document.getElementById('btnFecharModalHolerite');
    const modalPreview = document.getElementById('modalHoleritePreview');
    if (btnFecharPreview && modalPreview) {
      btnFecharPreview.addEventListener('click', () => {
        modalPreview.style.display = 'none';
      });
    }

    const btnImprimirPreview = document.getElementById('btnImprimirModalHolerite');
    if (btnImprimirPreview) {
      btnImprimirPreview.addEventListener('click', () => {
        window.print();
      });
    }

    const btnSalvarMsgPreview = document.getElementById('btnSalvarMsgModalHolerite');
    if (btnSalvarMsgPreview) {
      btnSalvarMsgPreview.addEventListener('click', salvarMensagemModalPreview);
    }

    // Modal Mensagem em Lote
    const modalMsgLote = document.getElementById('modalHoleriteMensagemLote');
    const btnFecharMsgLote = document.getElementById('btnFecharModalMsgLote');
    const btnCancelarMsgLote = document.getElementById('btnCancelarMsgLote');
    const btnAplicarMsgLote = document.getElementById('btnAplicarMsgLote');

    if (btnFecharMsgLote && modalMsgLote) {
      btnFecharMsgLote.addEventListener('click', () => modalMsgLote.style.display = 'none');
    }
    if (btnCancelarMsgLote && modalMsgLote) {
      btnCancelarMsgLote.addEventListener('click', () => modalMsgLote.style.display = 'none');
    }
    if (btnAplicarMsgLote) {
      btnAplicarMsgLote.addEventListener('click', aplicarMensagemEmLote);
    }
  }

  // --- CONTROLE DE ARQUIVOS E UPLOAD ---

  function handleFilesSelected(files) {
    const valid = files.filter(f => {
      const ext = f.name.toLowerCase();
      return ext.endsWith('.pdf') || ext.endsWith('.xlsx') || ext.endsWith('.xls');
    });

    if (valid.length === 0) {
      alert('Selecione apenas arquivos .pdf (contabilidade) ou .xlsx / .xls (planilhas).');
      return;
    }

    for (const f of valid) {
      if (!state.uploadFiles.some(existing => existing.name === f.name && existing.size === f.size)) {
        state.uploadFiles.push(f);
      }
    }
    renderUploadQueue();
  }

  function renderUploadQueue() {
    const queueBox = document.getElementById('holeriteUploadQueue');
    const listEl = document.getElementById('holeriteQueueList');
    const titleEl = document.getElementById('holeriteQueueTitle');
    if (!queueBox || !listEl) return;

    if (state.uploadFiles.length === 0) {
      queueBox.style.display = 'none';
      return;
    }

    queueBox.style.display = 'block';
    if (titleEl) {
      titleEl.textContent = `${state.uploadFiles.length} arquivo(s) pronto(s) para importação:`;
    }

    listEl.innerHTML = state.uploadFiles.map((f, idx) => `
      <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(30, 41, 59, 0.7); padding: 6px 12px; border-radius: 6px; font-size: 0.82rem;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span>${f.name.endsWith('.pdf') ? '📕' : '📗'}</span>
          <strong style="color: #f8fafc;">${f.name}</strong>
          <span style="color: var(--text-muted); font-size: 0.75rem;">(${(f.size / 1024).toFixed(1)} KB)</span>
        </div>
        <button type="button" class="btn btn-outline btn-sm" onclick="window.holeritesModule.removerArquivoFila(${idx})" style="padding: 1px 6px; font-size: 0.75rem; color: #ef4444; border-color: rgba(239, 68, 68, 0.3);">✕</button>
      </div>
    `).join('');
  }

  function removerArquivoFila(idx) {
    state.uploadFiles.splice(idx, 1);
    renderUploadQueue();
  }

  function clearUploadQueue() {
    state.uploadFiles = [];
    const input = document.getElementById('inputFilesHolerite');
    if (input) input.value = '';
    renderUploadQueue();
  }

  async function executarUpload() {
    if (state.uploadFiles.length === 0) return;

    const btn = document.getElementById('btnConfirmarUploadHolerite');
    const statusMsg = document.getElementById('holeriteUploadStatusMsg');

    if (btn) btn.disabled = true;
    if (statusMsg) statusMsg.style.display = 'inline';

    const formData = new FormData();
    for (const f of state.uploadFiles) {
      formData.append('holeriteFiles', f);
    }

    try {
      const response = await fetch('/api/financeiro/holerites/upload', {
        method: 'POST',
        headers: getAuthHeader(),
        body: formData
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Falha ao processar arquivos de holerites.');
      }

      alert(`✅ Sucesso! ${data.total_importados} holerite(s)/recibo(s) extraído(s) e gravado(s) com sucesso no Supabase.`);
      clearUploadQueue();
      await carregarCompetencias();
      await carregarHolerites();
    } catch (err) {
      console.error('Erro no upload de holerites:', err);
      alert('❌ Erro no processamento: ' + err.message);
    } finally {
      if (btn) btn.disabled = false;
      if (statusMsg) statusMsg.style.display = 'none';
    }
  }

  // --- CARGA DE DADOS E FILTROS ---

  async function carregarCompetencias() {
    try {
      const res = await fetch('/api/financeiro/holerites/competencias', {
        headers: getAuthHeader()
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.competencias)) {
        state.competencias = data.competencias;
        renderCompetenciasBotoes();
      }
    } catch (err) {
      console.warn('Falha ao carregar competências de holerites:', err);
    }
  }

  function renderCompetenciasBotoes() {
    const container = document.getElementById('holeritesCompetenciasBotoes');
    if (!container) return;

    let html = `
      <button class="btn btn-sm ${state.selectedAno === null ? 'btn-primary active' : 'btn-outline'} btn-comp-pill" data-ano="" data-mes="" id="btnCompTodos">
        🌐 Todos os Meses
      </button>
    `;

    for (const c of state.competencias) {
      const isSelected = state.selectedAno === c.competencia_ano && state.selectedMes === c.competencia_mes;
      const btnClass = isSelected ? 'btn-primary active' : 'btn-outline';
      html += `
        <button class="btn btn-sm ${btnClass} btn-comp-pill" data-ano="${c.competencia_ano}" data-mes="${c.competencia_mes}">
          📅 ${c.competencia_formatada || `${c.competencia_mes}/${c.competencia_ano}`} 
          <span style="font-size: 0.72rem; opacity: 0.85; margin-left: 4px;">(${c.total_docs})</span>
        </button>
      `;
    }

    container.innerHTML = html;

    // Vincula eventos aos botões de competência
    container.querySelectorAll('.btn-comp-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.btn-comp-pill').forEach(b => {
          b.classList.remove('active', 'btn-primary');
          b.classList.add('btn-outline');
        });
        btn.classList.add('active', 'btn-primary');
        btn.classList.remove('btn-outline');

        const ano = btn.dataset.ano ? parseInt(btn.dataset.ano, 10) : null;
        const mes = btn.dataset.mes ? parseInt(btn.dataset.mes, 10) : null;
        state.selectedAno = ano;
        state.selectedMes = mes;

        const infoLabel = document.getElementById('holeriteInfoCompetenciaLabel');
        if (infoLabel) {
          if (ano && mes) {
            infoLabel.innerHTML = `Focando na competência <strong>${btn.textContent.trim()}</strong>`;
          } else {
            infoLabel.textContent = 'Exibindo todo o histórico de competências';
          }
        }

        carregarHolerites();
      });
    });
  }

  async function carregarHolerites() {
    const tbody = document.getElementById('holeritesTableBody');
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="10" style="text-align: center; color: var(--text-muted); padding: 2.5rem;">
            ⏳ Carregando holerites...
          </td>
        </tr>
      `;
    }

    try {
      const params = new URLSearchParams();
      if (state.selectedAno) params.append('ano', state.selectedAno);
      if (state.selectedMes) params.append('mes', state.selectedMes);
      if (state.selectedEmpresa && state.selectedEmpresa !== 'TODAS') params.append('empresa', state.selectedEmpresa);
      if (state.selectedTipo && state.selectedTipo !== 'TODOS') params.append('tipo_documento', state.selectedTipo);
      if (state.searchQuery) params.append('busca', state.searchQuery);

      const res = await fetch(`/api/financeiro/holerites?${params.toString()}`, {
        headers: getAuthHeader()
      });
      const data = await res.json();

      if (data.success && Array.isArray(data.documentos)) {
        state.holerites = data.documentos;
        renderTabelaHolerites();
        atualizarKpis();
      } else {
        throw new Error(data.error || 'Erro ao obter lista de holerites.');
      }
    } catch (err) {
      console.error('Erro ao carregar holerites:', err);
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="10" style="text-align: center; color: #ef4444; padding: 2rem;">
              ❌ Falha ao carregar holerites: ${err.message}
            </td>
          </tr>
        `;
      }
    }
  }

  function renderTabelaHolerites() {
    const tbody = document.getElementById('holeritesTableBody');
    if (!tbody) return;

    if (state.holerites.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="10" style="text-align: center; color: var(--text-muted); padding: 3rem;">
            Nenhum holerite ou recibo encontrado para os filtros selecionados.
          </td>
        </tr>
      `;
      atualizarContadorSelecionados();
      return;
    }

    tbody.innerHTML = state.holerites.map(doc => {
      const isChecked = state.selectedIds.has(doc.id);
      
      // Badge Empresa
      let badgeEmpresa = `<span class="badge-gsi">GSI BW</span>`;
      if (doc.empresa === 'OACO') badgeEmpresa = `<span class="badge-oaco">OAÇO</span>`;
      else if (doc.empresa === 'SEM_REGISTRO') badgeEmpresa = `<span class="badge-sem-reg">Sem Registro</span>`;

      // Badge Tipo
      let badgeTipo = `<span class="badge-folha-mensal">Salário Mensal</span>`;
      if (doc.tipo_documento === 'ADIANTAMENTO') badgeTipo = `<span class="badge-adiantamento">Adiantamento</span>`;
      else if (doc.tipo_documento_label) badgeTipo = `<span class="badge-folha-mensal">${doc.tipo_documento_label}</span>`;

      // Mensagem personalizada preview
      let msgHtml = `<button type="button" class="btn btn-outline btn-sm" onclick="window.holeritesModule.abrirEdicaoMensagem(${doc.id})" style="font-size: 0.72rem; padding: 2px 6px;">+ Recado</button>`;
      if (doc.mensagem_personalizada && doc.mensagem_personalizada.trim()) {
        const preview = doc.mensagem_personalizada.length > 25 ? doc.mensagem_personalizada.substring(0, 25) + '...' : doc.mensagem_personalizada;
        msgHtml = `
          <span title="${doc.mensagem_personalizada.replace(/"/g, '&quot;')}" style="display: inline-flex; align-items: center; gap: 4px; font-size: 0.78rem; color: #38bdf8; cursor: pointer;" onclick="window.holeritesModule.abrirEdicaoMensagem(${doc.id})">
            <span>💬</span> <span>${preview}</span>
          </span>
        `;
      }

      return `
        <tr style="border-bottom: 1px solid var(--panel-border);">
          <td style="text-align: center;">
            <input type="checkbox" class="chk-holerite-item" data-id="${doc.id}" ${isChecked ? 'checked' : ''} onchange="window.holeritesModule.toggleSelecionado(${doc.id}, this.checked)">
          </td>
          <td>${badgeEmpresa}</td>
          <td style="font-weight: 500; font-size: 0.8rem;">${doc.competencia_formatada || `${doc.competencia_mes}/${doc.competencia_ano}`}</td>
          <td>${badgeTipo}</td>
          <td>
            <strong style="color: var(--text-color, #f8fafc); display: block;">${doc.funcionario_nome}</strong>
            <span style="font-size: 0.74rem; color: var(--text-muted);">${doc.funcionario_cargo || 'Colaborador'}</span>
          </td>
          <td style="text-align: right; font-family: 'JetBrains Mono', monospace; color: #34d399;">
            ${formatMoney(doc.total_vencimentos)}
          </td>
          <td style="text-align: right; font-family: 'JetBrains Mono', monospace; color: #f87171;">
            ${formatMoney(doc.total_descontos)}
          </td>
          <td style="text-align: right; font-family: 'JetBrains Mono', monospace; font-weight: 700; color: #38bdf8; font-size: 0.92rem;">
            ${formatMoney(doc.valor_liquido)}
          </td>
          <td>${msgHtml}</td>
          <td style="text-align: center;">
            <div style="display: inline-flex; gap: 4px;">
              <button type="button" class="btn btn-primary btn-sm" onclick="window.holeritesModule.visualizarHolerite(${doc.id})" title="Visualizar e Imprimir" style="padding: 2px 8px; font-size: 0.75rem;">
                👁️ Ver
              </button>
              <button type="button" class="btn btn-outline btn-sm" onclick="window.holeritesModule.excluirHolerite(${doc.id})" title="Excluir" style="padding: 2px 6px; font-size: 0.75rem; color: #ef4444; border-color: rgba(239, 68, 68, 0.3);">
                🗑️
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    atualizarContadorSelecionados();
  }

  function atualizarKpis() {
    let totDocs = state.holerites.length;
    let liqGsi = 0.0, qtdGsi = 0;
    let liqOaco = 0.0, qtdOaco = 0;
    let liqSemReg = 0.0, qtdSemReg = 0;
    let totalLiq = 0.0, totalBruto = 0.0;

    for (const d of state.holerites) {
      const liq = parseFloat(d.valor_liquido) || 0.0;
      const bruto = parseFloat(d.total_vencimentos) || 0.0;
      totalLiq += liq;
      totalBruto += bruto;

      if (d.empresa === 'GSI') {
        liqGsi += liq;
        qtdGsi++;
      } else if (d.empresa === 'OACO') {
        liqOaco += liq;
        qtdOaco++;
      } else if (d.empresa === 'SEM_REGISTRO') {
        liqSemReg += liq;
        qtdSemReg++;
      }
    }

    const elTotalDocs = document.getElementById('kpiHoleritesTotalDocs');
    const elSubComp = document.getElementById('kpiHoleritesSubCompetencia');
    const elLiqGsi = document.getElementById('kpiHoleritesLiqGsi');
    const elQtdGsi = document.getElementById('kpiHoleritesQtdGsi');
    const elLiqOaco = document.getElementById('kpiHoleritesLiqOaco');
    const elQtdOaco = document.getElementById('kpiHoleritesQtdOaco');
    const elLiqSemReg = document.getElementById('kpiHoleritesLiqSemReg');
    const elQtdSemReg = document.getElementById('kpiHoleritesQtdSemReg');
    const elLiqTotal = document.getElementById('kpiHoleritesLiqTotal');
    const elBrutoSub = document.getElementById('kpiHoleritesBrutoSub');

    if (elTotalDocs) elTotalDocs.textContent = totDocs;
    if (elSubComp) {
      elSubComp.textContent = state.selectedAno && state.selectedMes 
        ? `${state.selectedMes}/${state.selectedAno}` 
        : 'Todos os meses';
    }
    if (elLiqGsi) elLiqGsi.textContent = formatMoney(liqGsi);
    if (elQtdGsi) elQtdGsi.textContent = `${qtdGsi} funcs`;
    if (elLiqOaco) elLiqOaco.textContent = formatMoney(liqOaco);
    if (elQtdOaco) elQtdOaco.textContent = `${qtdOaco} funcs`;
    if (elLiqSemReg) elLiqSemReg.textContent = formatMoney(liqSemReg);
    if (elQtdSemReg) elQtdSemReg.textContent = `${qtdSemReg} funcs`;
    if (elLiqTotal) elLiqTotal.textContent = formatMoney(totalLiq);
    if (elBrutoSub) elBrutoSub.textContent = `Bruto: ${formatMoney(totalBruto)}`;
  }

  function toggleSelecionado(id, checked) {
    if (checked) state.selectedIds.add(id);
    else state.selectedIds.delete(id);
    atualizarContadorSelecionados();
  }

  function atualizarContadorSelecionados() {
    const lbl = document.getElementById('lblHoleritesSelecionadosCount');
    const chkAll = document.getElementById('chkSelectAllHolerites');
    if (lbl) {
      lbl.textContent = `(${state.selectedIds.size} selecionados)`;
    }
    if (chkAll && state.holerites.length > 0) {
      chkAll.checked = state.holerites.every(d => state.selectedIds.has(d.id));
    }
  }

  // --- GERAÇÃO E VISUALIZAÇÃO DO HOLERITE EXECUTIVO ---

  function gerarHoleriteHtml(doc) {
    const isGsi = doc.empresa === 'GSI';
    const logoSrc = isGsi ? '/logos/logo-gsi.png' : '/logos/logo-oaco.png';
    const razaoSocial = doc.empresa_razao_social || (isGsi ? 'GSI BW EQUIPAMENTOS DE ACO COFRES E ARMARIOS LTDA' : 'OACO PRODUTOS DE ACO LTDA');
    const cnpj = doc.empresa_cnpj || (isGsi ? '14.061.778/0001-15' : '61.237.790/0001-18');

    let tituloDoc = 'RECIBO DE PAGAMENTO DE SALÁRIO';
    if (doc.tipo_documento === 'ADIANTAMENTO') tituloDoc = 'RECIBO DE ADIANTAMENTO SALARIAL';
    else if (doc.tipo_documento === '13_PRIMEIRA_PARCELA') tituloDoc = '13º SALÁRIO - 1ª PARCELA';
    else if (doc.tipo_documento === '13_SEGUNDA_PARCELA') tituloDoc = '13º SALÁRIO - 2ª PARCELA';
    else if (doc.tipo_documento === 'FERIAS') tituloDoc = 'RECIBO DE FÉRIAS';

    // Eventos
    const eventos = Array.isArray(doc.eventos) ? doc.eventos : [];
    let eventosRows = '';
    if (eventos.length > 0) {
      eventosRows = eventos.map(e => `
        <tr>
          <td class="holerite-num" style="width: 55px; text-align: center;">${e.codigo || ''}</td>
          <td>${e.descricao || ''}</td>
          <td class="holerite-num" style="width: 75px; text-align: center;">${e.referencia || ''}</td>
          <td class="holerite-num holerite-vencimento" style="width: 110px; text-align: right;">
            ${e.vencimento > 0 ? formatMoney(e.vencimento) : ''}
          </td>
          <td class="holerite-num holerite-desconto" style="width: 110px; text-align: right;">
            ${e.desconto > 0 ? formatMoney(e.desconto) : ''}
          </td>
        </tr>
      `).join('');
    } else {
      eventosRows = `
        <tr>
          <td colspan="5" style="text-align: center; color: #64748b; padding: 12px;">Nenhum evento detalhado.</td>
        </tr>
      `;
    }

    // Mensagem Personalizada
    const msgTexto = (doc.mensagem_personalizada || doc.mensagem_contabilidade || '').trim();
    let quadroMsg = '';
    if (msgTexto) {
      quadroMsg = `
        <div class="holerite-quadro-mensagem">
          <div class="holerite-quadro-mensagem-header">
            <span>📢 Comunicado da Empresa</span>
          </div>
          <div>${msgTexto}</div>
        </div>
      `;
    }

    return `
      <div class="holerite-folha-a4" data-id="${doc.id}">
        <!-- Cabeçalho -->
        <table class="holerite-header-table">
          <tr>
            <td style="width: 200px; vertical-align: middle;">
              <img src="${logoSrc}" alt="Logo" class="holerite-empresa-logo" onerror="this.style.display='none'">
            </td>
            <td style="text-align: center; vertical-align: middle;">
              <h2 style="margin: 0; font-size: 1.15rem; font-weight: 700; color: #0f172a; text-transform: uppercase;">
                ${razaoSocial}
              </h2>
              <span style="font-size: 0.8rem; color: #475569; display: block; margin-top: 2px;">
                CNPJ: <strong>${cnpj}</strong>
              </span>
            </td>
            <td style="width: 200px; text-align: right; vertical-align: middle;">
              <span style="font-size: 0.82rem; font-weight: 700; color: #1e3a8a; display: block;">
                ${tituloDoc}
              </span>
              <span style="font-size: 0.82rem; font-weight: 600; color: #0f172a;">
                Competência: ${doc.competencia_formatada || `${doc.competencia_mes}/${doc.competencia_ano}`}
              </span>
            </td>
          </tr>
        </table>

        <!-- Dados do Colaborador -->
        <table class="holerite-dados-colaborador">
          <tr>
            <td style="width: 90px; color: #64748b;">Código: <strong>${doc.funcionario_codigo || 'SEM_REG'}</strong></td>
            <td colspan="2">Nome: <strong style="font-size: 0.92rem; color: #0f172a;">${doc.funcionario_nome}</strong></td>
            <td style="width: 120px; text-align: right;">CBO: <strong>${doc.funcionario_cbo || '-'}</strong></td>
          </tr>
          <tr>
            <td style="color: #64748b;">Depto/Filial: <strong>${doc.funcionario_departamento || '1'}/${doc.funcionario_filial || '1'}</strong></td>
            <td>Cargo: <strong>${doc.funcionario_cargo || '-'}</strong></td>
            <td>Admissão: <strong>${doc.funcionario_admissao || '-'}</strong></td>
            <td style="text-align: right;">${doc.funcionario_cpf ? `CPF: <strong>${doc.funcionario_cpf}</strong>` : `Tipo: <strong>${doc.funcionario_tipo_contrato || 'Mensalista'}</strong>`}</td>
          </tr>
        </table>

        <!-- Tabela de Eventos -->
        <table class="holerite-tabela-eventos">
          <thead>
            <tr>
              <th style="text-align: center;">Cód</th>
              <th style="text-align: left;">Descrição da Verba</th>
              <th style="text-align: center;">Referência</th>
              <th style="text-align: right;">Vencimentos (Crédito)</th>
              <th style="text-align: right;">Descontos (Débito)</th>
            </tr>
          </thead>
          <tbody>
            ${eventosRows}
          </tbody>
        </table>

        <!-- Grid de Totais -->
        <div class="holerite-totais-grid">
          <div class="holerite-total-card">
            <span class="holerite-total-label">Total de Vencimentos</span>
            <span class="holerite-total-valor" style="color: #047857;">${formatMoney(doc.total_vencimentos)}</span>
          </div>
          <div class="holerite-total-card">
            <span class="holerite-total-label">Total de Descontos</span>
            <span class="holerite-total-valor" style="color: #b91c1c;">${formatMoney(doc.total_descontos)}</span>
          </div>
          <div class="holerite-total-card destaque-liquido">
            <span class="holerite-total-label">Valor Líquido a Receber</span>
            <span class="holerite-total-valor">${formatMoney(doc.valor_liquido)}</span>
          </div>
        </div>

        <!-- Valor por Extenso -->
        <div style="font-size: 0.78rem; color: #334155; margin-bottom: 12px; background: #f1f5f9; padding: 6px 12px; border-radius: 4px;">
          Valor por extenso: <em>${doc.valor_liquido_extenso || formatMoney(doc.valor_liquido)}</em>
        </div>

        <!-- Bases de Cálculo -->
        <table class="holerite-bases-table">
          <thead>
            <tr>
              <th>Salário Base</th>
              <th>Sal. Contr. INSS</th>
              <th>Base Cálc. FGTS</th>
              <th>FGTS do Mês</th>
              <th>Base Cálc. IRRF</th>
              <th>Faixa IRRF</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${formatMoney(doc.salario_base)}</td>
              <td>${formatMoney(doc.sal_contr_inss)}</td>
              <td>${formatMoney(doc.base_calc_fgts)}</td>
              <td>${formatMoney(doc.fgts_mes)}</td>
              <td>${formatMoney(doc.base_calc_irrf)}</td>
              <td>${doc.faixa_irrf ? formatMoney(doc.faixa_irrf) : '0,00'}</td>
            </tr>
          </tbody>
        </table>

        <!-- Mensagem Personalizada -->
        ${quadroMsg}

        <!-- Canhoto de Quitação -->
        <div class="holerite-canhoto-recibo">
          <p style="margin: 0; line-height: 1.4;">
            Declaro ter recebido a importância líquida de <strong>${formatMoney(doc.valor_liquido)}</strong> discriminada neste recibo, referente à quitação integral das verbas correspondentes ao período indicado.
          </p>
          <div class="holerite-canhoto-linhas">
            <div style="font-size: 0.78rem;">
              Data: <strong>____/____/________</strong>
            </div>
            <div class="holerite-linha-assinatura">
              ${doc.funcionario_nome}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  async function visualizarHolerite(id) {
    try {
      const res = await fetch(`/api/financeiro/holerites/${id}`, {
        headers: getAuthHeader()
      });
      const data = await res.json();
      if (!data.success || !data.documento) {
        throw new Error(data.error || 'Documento não encontrado.');
      }

      state.currentPreviewDoc = data.documento;
      const container = document.getElementById('holeriteDocumentoContainer');
      const modal = document.getElementById('modalHoleritePreview');

      if (container && modal) {
        // Renderiza o holerite com uma área editável de mensagem no topo da visualização
        const doc = data.documento;

        let pixBarHtml = '';
        try {
          const colabRes = await fetch(`/api/dp/colaboradores?busca=${encodeURIComponent(doc.funcionario_cpf || doc.funcionario_nome)}`, { headers: getAuthHeader() });
          const colabData = await colabRes.json();
          if (colabData.success && Array.isArray(colabData.colaboradores) && colabData.colaboradores.length > 0) {
            const c = colabData.colaboradores[0];
            if (c.chave_pix || c.telefone_celular) {
              pixBarHtml = `
                <div class="no-print" style="margin-bottom: 12px; padding: 10px 14px; background: rgba(168, 85, 247, 0.08); border: 1px solid rgba(168, 85, 247, 0.25); border-radius: 8px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                  <div style="display: flex; align-items: center; gap: 14px; font-size: 0.82rem;">
                    ${c.chave_pix ? `<span>💳 PIX: <strong style="font-family: monospace; color: #a855f7;">${c.chave_pix}</strong></span>` : ''}
                    ${c.telefone_celular ? `<span>📱 Cel: <strong>${c.telefone_celular}</strong></span>` : ''}
                    <span>Status: <strong style="color: #10b981;">${c.status || 'ATIVO'}</strong></span>
                  </div>
                  ${c.chave_pix ? `<button type="button" class="btn btn-outline btn-sm" onclick="navigator.clipboard.writeText('${c.chave_pix.replace(/'/g, "\\'")}').then(() => alert('📋 Chave PIX copiada: ${c.chave_pix}'))" style="font-size: 0.75rem; padding: 2px 8px;">📋 Copiar PIX</button>` : ''}
                </div>
              `;
            }
          }
        } catch (e) {}

        const html = `
          ${pixBarHtml}
          <div class="no-print" style="margin-bottom: 16px; padding: 12px 16px; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px;">
            <label style="font-size: 0.82rem; font-weight: 700; color: #1e293b; display: block; margin-bottom: 6px;">
              ✏️ Personalizar Mensagem / Recado para este Holerite:
            </label>
            <div style="display: flex; gap: 8px;">
              <input type="text" id="inputModalMensagemIndividual" class="form-control" value="${(doc.mensagem_personalizada || '').replace(/"/g, '&quot;')}" placeholder="Digite um comunicado específico ou felicitações..." style="flex: 1; font-size: 0.85rem; padding: 6px 12px; border: 1px solid #cbd5e1; border-radius: 6px;">
              <button type="button" class="btn btn-primary btn-sm" onclick="window.holeritesModule.salvarMensagemModalPreview()" style="font-weight: 600; white-space: nowrap;">
                💾 Salvar Recado
              </button>
            </div>
          </div>
          ${gerarHoleriteHtml(doc)}
        `;
        container.innerHTML = html;
        modal.style.display = 'flex';
      }
    } catch (err) {
      console.error('Erro ao visualizar holerite:', err);
      alert('Erro ao carregar pré-visualização: ' + err.message);
    }
  }

  async function salvarMensagemModalPreview() {
    if (!state.currentPreviewDoc) return;
    const input = document.getElementById('inputModalMensagemIndividual');
    const msg = input ? input.value.trim() : '';

    try {
      const res = await fetch(`/api/financeiro/holerites/${state.currentPreviewDoc.id}/mensagem`, {
        method: 'PATCH',
        headers: {
          ...getAuthHeader(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ mensagem: msg })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      state.currentPreviewDoc.mensagem_personalizada = msg;
      // Atualiza na lista local
      const item = state.holerites.find(x => x.id === state.currentPreviewDoc.id);
      if (item) item.mensagem_personalizada = msg;
      renderTabelaHolerites();

      // Atualiza o documento na tela
      visualizarHolerite(state.currentPreviewDoc.id);
      alert('✅ Mensagem personalizada salva com sucesso!');
    } catch (err) {
      console.error('Erro ao salvar mensagem:', err);
      alert('Falha ao salvar mensagem: ' + err.message);
    }
  }

  async function abrirEdicaoMensagem(id) {
    const doc = state.holerites.find(x => x.id === id);
    if (!doc) return;

    const novaMsg = prompt(`Digite a mensagem personalizada para ${doc.funcionario_nome}:`, doc.mensagem_personalizada || '');
    if (novaMsg === null) return;

    try {
      const res = await fetch(`/api/financeiro/holerites/${id}/mensagem`, {
        method: 'PATCH',
        headers: {
          ...getAuthHeader(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ mensagem: novaMsg.trim() })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      doc.mensagem_personalizada = novaMsg.trim();
      renderTabelaHolerites();
    } catch (err) {
      alert('Erro ao salvar mensagem: ' + err.message);
    }
  }

  function abrirModalMensagemLote() {
    if (state.selectedIds.size === 0) {
      alert('Selecione pelo menos um holerite na tabela para aplicar a mensagem em lote.');
      return;
    }

    const modal = document.getElementById('modalHoleriteMensagemLote');
    const desc = document.getElementById('msgLoteAlvoDesc');
    const txt = document.getElementById('txtMensagemLoteHolerite');

    if (desc) {
      desc.innerHTML = `A mensagem abaixo será gravada em <strong>${state.selectedIds.size}</strong> holerite(s) selecionado(s):`;
    }
    if (txt) txt.value = '';
    if (modal) modal.style.display = 'flex';
  }

  async function aplicarMensagemEmLote() {
    const txt = document.getElementById('txtMensagemLoteHolerite');
    const modal = document.getElementById('modalHoleriteMensagemLote');
    const msg = txt ? txt.value.trim() : '';

    const ids = Array.from(state.selectedIds);
    if (ids.length === 0) return;

    try {
      const res = await fetch('/api/financeiro/holerites/mensagem-lote', {
        method: 'PATCH',
        headers: {
          ...getAuthHeader(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ids, mensagem: msg })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      for (const d of state.holerites) {
        if (ids.includes(d.id)) {
          d.mensagem_personalizada = msg;
        }
      }
      renderTabelaHolerites();
      if (modal) modal.style.display = 'none';
      alert(`✅ Mensagem aplicada com sucesso em ${data.total_atualizados} holerite(s)!`);
    } catch (err) {
      alert('Erro ao aplicar mensagens em lote: ' + err.message);
    }
  }

  function imprimirSelecionados() {
    if (state.selectedIds.size === 0) {
      alert('Selecione pelo menos um holerite para imprimir.');
      return;
    }

    const selecionados = state.holerites.filter(d => state.selectedIds.has(d.id));
    if (selecionados.length === 0) return;

    const container = document.getElementById('holeriteDocumentoContainer');
    const modal = document.getElementById('modalHoleritePreview');

    if (container && modal) {
      // Concatena todas as folhas A4
      const allHtml = selecionados.map(d => gerarHoleriteHtml(d)).join('');
      container.innerHTML = allHtml;
      modal.style.display = 'flex';
      // Aciona o diálogo nativo de impressão
      setTimeout(() => {
        window.print();
      }, 300);
    }
  }

  async function excluirHolerite(id) {
    const doc = state.holerites.find(x => x.id === id);
    const nome = doc ? doc.funcionario_nome : `ID ${id}`;

    if (!confirm(`Deseja realmente excluir o holerite de "${nome}"?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/financeiro/holerites/${id}`, {
        method: 'DELETE',
        headers: getAuthHeader()
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      state.selectedIds.delete(id);
      await carregarCompetencias();
      await carregarHolerites();
    } catch (err) {
      alert('Erro ao excluir holerite: ' + err.message);
    }
  }

  function exportarParaExcel() {
    if (state.holerites.length === 0) {
      alert('Nenhum dado para exportar.');
      return;
    }

    const colunas = [
      'ID', 'Empresa', 'Competência', 'Tipo de Recibo', 'Código', 'Colaborador',
      'CPF', 'Cargo', 'CBO', 'Salário Base (R$)', 'Total Vencimentos (R$)',
      'Total Descontos (R$)', 'Valor Líquido (R$)', 'Mensagem Personalizada'
    ];

    const linhas = state.holerites.map(d => [
      d.id,
      d.empresa,
      d.competencia_formatada || `${d.competencia_mes}/${d.competencia_ano}`,
      d.tipo_documento_label || d.tipo_documento,
      d.funcionario_codigo || '',
      `"${(d.funcionario_nome || '').replace(/"/g, '""')}"`,
      d.funcionario_cpf || '',
      `"${(d.funcionario_cargo || '').replace(/"/g, '""')}"`,
      d.funcionario_cbo || '',
      (parseFloat(d.salario_base) || 0).toFixed(2).replace('.', ','),
      (parseFloat(d.total_vencimentos) || 0).toFixed(2).replace('.', ','),
      (parseFloat(d.total_descontos) || 0).toFixed(2).replace('.', ','),
      (parseFloat(d.valor_liquido) || 0).toFixed(2).replace('.', ','),
      `"${(d.mensagem_personalizada || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = '\uFEFF' + [
      colunas.join(';'),
      ...linhas.map(row => row.join(';'))
    ].join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `holerites_${state.selectedAno || 'todos'}_${state.selectedMes || 'todos'}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Registra globalmente na janela para acesso via onclick e listeners
  window.holeritesModule = {
    init,
    carregarCompetencias,
    carregarHolerites,
    visualizarHolerite,
    salvarMensagemModalPreview,
    abrirEdicaoMensagem,
    toggleSelecionado,
    excluirHolerite,
    removerArquivoFila
  };

  // Inicialização no DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
