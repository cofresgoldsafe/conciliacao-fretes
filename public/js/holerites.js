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

  // Utilitários de Formatação e Sanitização
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function parseNumeroPtBr(val) {
    if (val === null || val === undefined) return 0.0;
    if (typeof val === 'number') return isNaN(val) ? 0.0 : val;
    const s = String(val).trim();
    if (!s) return 0.0;
    if (s.includes(',') && s.includes('.')) {
      return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0.0;
    }
    if (s.includes(',')) {
      return parseFloat(s.replace(',', '.')) || 0.0;
    }
    return parseFloat(s) || 0.0;
  }

  function formatMoney(val) {
    const num = parseNumeroPtBr(val);
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

  // --- LOGOS OFICIAIS EMBUTIDOS EM BASE64 (DISPONIBILIDADE 100% PERENE E SÍNCRONA) ---
  const LOGO_GSI_B64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAK8AAAAtCAYAAADY6jumAAAAxnpUWHRSYXcgcHJvZmlsZSB0eXBlIGV4aWYAAHjabVBbDsMwCPvnFDtCgpMUjpO+pN1gxx8pdGqrWYohGDkE2j7vnV4DnAuVOknT1pKhaFHulkhy9INzKgd7aQ8t3+vEawhsJViEX6VF/1nPPwMP3bJ6MZIlhPkuaAl/eRixB4yJRh6DkIYR2IUcBt2/lZrKdP3CvKU7xA8N4iXaovl5L5Ntb632Dpg3ZCRjQHwAjFMJ/Ui6yWqNCWo50IwrWpjZQv7t6QR9AegqWgvac1duAAABg2lDQ1BJQ0MgcHJvZmlsZQAAeJx9kT1Iw0AcxV9TpaIVh3YQcQhSneyiIo6likWwUNoKrTqYXPoFTRqSFBdHwbXg4Mdi1cHFWVcHV0EQ/ABxF5wUXaTE/yWFFjEeHPfj3b3H3TtAaFaZavbEAFWzjHQiLubyq2LgFQJCGMAYohIz9WRmMQvP8XUPH1/vojzL+9yfY1ApmAzwicQxphsW8Qbx7Kalc94nDrOypBCfE08adEHiR67LLr9xLjks8MywkU3PE4eJxVIXy13MyoZKPEMcUVSN8oWcywrnLc5qtc7a9+QvDBa0lQzXaY4igSUkkYIIGXVUUIWFKK0aKSbStB/38I84/hS5ZHJVwMixgBpUSI4f/A9+d2sWp6fcpGAc6H2x7Y9xILALtBq2/X1s260TwP8MXGkdf60JzH2S3uhokSNgaBu4uO5o8h5wuQMMP+mSITmSn6ZQLALvZ/RNeSB0C/Svub2193H6AGSpq+Ub4OAQmChR9rrHu/u6e/v3TLu/H9Vocs5Tx/kPAAAOVWlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPD94cGFja2V0IGJlZ2luPSLvu78iIGlkPSJXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQiPz4KPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iWE1QIENvcmUgNC40LjAtRXhpdjIiPgogPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4KICA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIgogICAgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iCiAgICB4bWxuczpzdEV2dD0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL3NUeXBlL1Jlc291cmNlRXZlbnQjIgogICAgeG1sbnM6ZGM9Imh0dHA6Ly9wdXJsLm9yZy9kYy9lbGVtZW50cy8xLjEvIgogICAgeG1sbnM6R0lNUD0iaHR0cDovL3d3dy5naW1wLm9yZy94bXAvIgogICAgeG1sbnM6dGlmZj0iaHR0cDovL25zLmFkb2JlLmNvbS90aWZmLzEuMC8iCiAgICB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iCiAgIHhtcE1NOkRvY3VtZW50SUQ9ImdpbXA6ZG9jaWQ6Z2ltcDo5ZDAxZWM2Yy1jYjEyLTRmZTMtYTMwYi05YjgxYWI1ODlhOTAiCiAgIHhtcE1NOkluc3RhbmNlSUQ9InhtcC5paWQ6ZGQwMGUyMzQtN2NiNi00MjgwLThhMTAtNmVkNWVlMTZiMTQzIgogICB4bXBNTTpPcmlnaW5hbERvY3VtZW50SUQ9InhtcC5kaWQ6OGNhYmZmYmQtODNmZC00OTkyLThlYTgtMTcwNDM5ZWU1YjJmIgogICBkYzpGb3JtYXQ9ImltYWdlL3BuZyIKICAgR0lNUDpBUEk9IjIuMCIKICAgR0lNUDpQbGF0Zm9ybT0iV2luZG93cyIKICAgR0lNUDpUaW1lU3RhbXA9IjE3Mzk5Njg2MjYxODIxMzIiCiAgIEdJTVA6VmVyc2lvbj0iMi4xMC4zOCIKICAgdGlmZjpPcmllbnRhdGlvbj0iMSIKICAgeG1wOkNyZWF0b3JUb29sPSJHSU1QIDIuMTAiCiAgIHhtcDpNZXRhZGF0YURhdGU9IjIwMjU6MDI6MTlUMDk6MzY6NTYtMDM6MDAiCiAgIHhtcDpNb2RpZnlEYXRlPSIyMDI1OjAyOjE5VDA5OjM2OjU2LTAzOjAwIj4KICAgPHhtcE1NOkhpc3Rvcnk+CiAgICA8cmRmOlNlcT4KICAgICA8cmRmOmxpCiAgICAgIHN0RXZ0OmFjdGlvbj0ic2F2ZWQiCiAgICAgIHN0RXZ0OmNoYW5nZWQ9Ii8iCiAgICAgIHN0RXZ0Omluc3RhbmNlSUQ9InhtcC5paWQ6YjQ5MWZhN2ItMWY3ZS00OTBkLWJhMjctMmQxNDg1M2UwNTZhIgogICAgICBzdEV2dDpzb2Z0d2FyZUFnZW50PSJHaW1wIDIuMTAgKFdpbmRvd3MpIgogICAgICBzdEV2dDp3aGVuPSIyMDI0LTA5LTA0VDE1OjA3OjM1Ii8+CiAgICAgPHJkZjpsaQogICAgICBzdEV2dDphY3Rpb249InNhdmVkIgogICAgICBzdEV2dDpjaGFuZ2VkPSIvIgogICAgICBzdEV2dDppbnN0YW5jZUlEPSJ4bXAuaWlkOmEwN2M5NWY3LTliN2QtNDU5OC1hODBkLTc1ZjZlMDgxMjE0ZCIKICAgICAgc3RFdnQ6c29mdHdhcmVBZ2VudD0iR2ltcCAyLjEwIChXaW5kb3dzKSIKICAgICAgc3RFdnQ6d2hlbj0iMjAyNS0wMi0xOVQwOTozNzowNiIvPgogICAgPC9yZGY6U2VxPgogICA8L3htcE1NOkhpc3Rvcnk+CiAgPC9yZGY6RGVzY3JpcHRpb24+CiA8L3JkZjpSREY+CjwveDp4bXBtZXRhPgogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAKICAgICAgICAgICAgICAgICAgICAgICAgICAgCjw/eHBhY2tldCBlbmQ9InciPz4izPXtAAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAC4jAAAuIwF4pT92AAAAB3RJTUUH6QITDCUFVHCW9wAAD3hJREFUeNrtXGtUVFeW/s69RfESYxVgEFCwEBUFQR5tEk2PLxyU2OjS+CAqxLe2STs2Smdea82fnu50r/xwohNN7GSSobOSyYqN6CRt7FE7sqIgiKabqshDoKAplIcmaATq3j0/bj1uPYCqSEEt1v30urxF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';
  const LOGO_OACO_B64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJAAAACDCAYAAABiBJKNAAAABGdBTUEAALGPC/xhBQAAAAlwSFlzAAAOwgAADsIBFShKgAAALxtJREFUeF7t3QO0bNm1BuD4xrZt27Y67Lhjq2Pbtu100rGdjm3btr3f+PZ7/32zZ3YdVNW599zTZ40xx67atbHwr+m16mDDdtkuC5SD9RPbZbusp2wDaLssVLY0gP7zn//spH//+9/Dv/71rwOdS/EbmnXvrPP99/p91uetVrYkgPrg5jOQ5BgwOeYan//85z8Pf/rTn4Y//OEPw29+85vhV7/61Ui//e1vh9///vfDH//4x+Hvf//7TtCF3PvPf/7zQCDN53rdVitbHkABjcH0+R//+McIjh/96EfDV77yleETn/jE8MEPfnB45zvfObz5zW8eXve61w2veMUrhpe85CXD8573vOHZz3728JznPGd4/vOfP7z4xS8ef3vNa14zvOlNbxre/e53j/d6hmf95Cc/GcHnXR1Q2wDaw0q4AsD84he/GL785S8PH/7wh4e3ve1tIwge+9jHDvvuu+9wvetdbzj/+c8/nOpUpxqOe9zjDsc85jGHYxzjGMPRj3704WhHO9pw1KMedTz6jvx2rGMdazj+8Y8/nO50pxsufvGLD9e5znWGu9zlLsOTn/zk4VWvetXwjne8Y/jYxz42fOMb3xh+/etfjxwLmLYBtJtKFUf9fI6Z4Qbqb3/72/C9731v+OQnPzm89a1vHZ75zGcOd7zjHYdLX/rSw6lPferhKEc5ynD4wx9+2LFjx3DoQx96OMxhDjMc4hCHOBAd/OAHHw55yEMOhzrUocZjzqF8dnQ/8qwjHOEII8BOe9rTDle5ylWG+9znPiMHU4cvfvGLoxisIKr178ep9m7GsscBKOKoHw0MneXzn//88Pa3v314yEMeMuy1117DyU52suFIRzrScNjDHnYc6AqECohKQJPPAU//jA52sIMdCFD57n7vAyhgPf3pTz/c+ta3Hl72spcN73vf+4avf/3ro66Vegf4EbfbAFpy6Zwmne3417/+dfj+978/fOhDHxr1ltvc5jbDKU95yp2gyWB30KwEoKnz9RwgVa4U4EyBCbn2cIc73MidLnzhCw/3ve99h1e+8pWjmKOga0f0pUyK2u7NXPYIAKWE2+hsyurXvva1UZl92MMeNlziEpcYdRWg6ZyiDqzfVgMQDkIkGXSiDhhxEs+nIx372MceqepLdKUjH/nII9dxTzheRGDeTVwe8YhHHHWoa1/72qN4ff/73z8q4PQ1FODsCTrTpgZQOE6dkTgO5ZQldPe7330429nONg6Yga8ixedQ5x4ZzMpNosMc5zjHGc561rMOl73sZYfb3va2w8Mf/vDhKU95yvCCF7xg2G+//YbXvva1wxve8IbhjW9842ix7b///uN53I++88QnPnF4wAMeMNz85jcfdS7ii9Lt2QFU3gtMgHepS11qeMITnjC8973vHYEULhROW7lS+mGziLlNCaCuC8T0/vjHPz5aT3vvvfdw4hOfeASOgahgCQUoAVM4EMIdTnKSk4zgu+QlLznqJ0996lNHZfejH/3oqEcxy7/97W8PP/3pT0fl9y9/+ctoTcWiioUH0Mjv/ERE0s9+9rPhBz/4wfDVr351+OxnPztaf0TW/e9//+Ea17jGcN7znne04HAu9QIkbTnzmc88Ao/LgJ6Ey9a+mPq8u8umBFA6yGABjkF94AMfOFzgAhcYZ2wVOytxnIDLrMcBAOZKV7rScLvb3W544QtfOFppZvwvf/nLAzkIAcPn6s/JORYeAhgEPL77PUqxkufkGQEYlwIOytR/6EMfOtzgBjcY9aITnvCEO7nhCU5wguHyl7/88KQnPWn44Q9/OCrc4UZ9cu3usmkBZLDM4Gc84xljZxIt6eBqJXXwBEABl4G50IUuNNziFrcYHYMGL55lA18tuQAlXmiEA3EJ8CMBHGWdqHnXu941vOc979npSPzCF74wciwOSoDk//EOwPSeyjW8A3fxfAD2vAc/+MHD1a52teFMZzrTKE5xSeLvxje+8Sg2Xec5m4XzpOx2AFWWHHmv43l56SBYfVd8O1hyLnoNOsUpTjHqIPe+973HgQaE3/3udzuV1HAInMH7DLrBx+1e/vKXD4985COH29/+9qOTkDvAsy52sYsNF7nIRUZAogte8IIj9+BM9DvfD8X4lre85egDetaznjW6FL70pS+NYg0H6twk3AmogfRFL3rRsM8++wznOte5dirlOC9dLOZ/50IVnLu67DYA9cZGp/jmN785KqwGhNVTucksAAU08b9c9KIXHQHw6U9/ehy46BIRMQYMh/jxj388WkBEBa/0ta51rVGhPcc5zjH6jwxgfW/lev18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';

  // --- GERAÇÃO E VISUALIZAÇÃO DO HOLERITE EXECUTIVO ---

  function gerarHoleriteHtml(doc) {
    const emp = String(doc.empresa || '').trim().toUpperCase();
    const rz = String(doc.empresa_razao_social || '').trim().toUpperCase();
    const isGsi = emp === 'GSI' || rz.includes('GSI');
    const logoSrc = isGsi ? LOGO_GSI_B64 : LOGO_OACO_B64;
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
    const minLinhas = 5;
    if (eventos.length > 0) {
      eventosRows = eventos.map(e => {
        const vNum = parseNumeroPtBr(e.vencimento);
        const dNum = parseNumeroPtBr(e.desconto);
        return `
        <tr>
          <td class="holerite-num" style="width: 55px; text-align: center;">${escapeHtml(e.codigo || '')}</td>
          <td>${escapeHtml(e.descricao || '')}</td>
          <td class="holerite-num" style="width: 75px; text-align: center;">${escapeHtml(e.referencia || '')}</td>
          <td class="holerite-num holerite-vencimento" style="width: 120px; text-align: right;">
            ${vNum > 0 ? formatMoney(vNum) : ''}
          </td>
          <td class="holerite-num holerite-desconto" style="width: 120px; text-align: right;">
            ${dNum > 0 ? formatMoney(dNum) : ''}
          </td>
        </tr>
      `;
      }).join('');

      for (let i = eventos.length; i < minLinhas; i++) {
        eventosRows += `
          <tr class="holerite-linha-vazia">
            <td class="holerite-num" style="text-align: center;">&nbsp;</td>
            <td>&nbsp;</td>
            <td class="holerite-num" style="text-align: center;">&nbsp;</td>
            <td class="holerite-num" style="text-align: right;">&nbsp;</td>
            <td class="holerite-num" style="text-align: right;">&nbsp;</td>
          </tr>
        `;
      }
    } else {
      eventosRows = `
        <tr>
          <td colspan="5" style="text-align: center; color: #64748b; padding: 14px;">Nenhum evento detalhado.</td>
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
          <div>${escapeHtml(msgTexto)}</div>
        </div>
      `;
    }

    return `
      <div class="holerite-folha-a4" data-id="${doc.id}">
        <!-- Cabeçalho -->
        <table class="holerite-header-table">
          <tr>
            <td style="width: 200px; vertical-align: middle; text-align: left;">
              <img src="${logoSrc}" alt="Logo ${isGsi ? 'GSI' : 'OAÇO'}" class="holerite-empresa-logo" onerror="this.onerror=null; this.src='${isGsi ? '/logos/logo-gsi.png' : '/logos/logo-oaco.png'}';">
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
            <td style="width: 90px; color: #64748b;">Código: <strong>${escapeHtml(doc.funcionario_codigo || 'SEM_REG')}</strong></td>
            <td colspan="2">Nome: <strong style="font-size: 0.92rem; color: #0f172a;">${escapeHtml(doc.funcionario_nome || '')}</strong></td>
            <td style="width: 120px; text-align: right;">CBO: <strong>${escapeHtml(doc.funcionario_cbo || '-')}</strong></td>
          </tr>
          <tr>
            <td style="color: #64748b;">Depto/Filial: <strong>${escapeHtml(doc.funcionario_departamento || '1')}/${escapeHtml(doc.funcionario_filial || '1')}</strong></td>
            <td>Cargo: <strong>${escapeHtml(doc.funcionario_cargo || '-')}</strong></td>
            <td>Admissão: <strong>${escapeHtml(doc.funcionario_admissao || '-')}</strong></td>
            <td style="text-align: right;">${doc.funcionario_cpf ? `CPF: <strong>${escapeHtml(doc.funcionario_cpf)}</strong>` : `Tipo: <strong>${escapeHtml(doc.funcionario_tipo_contrato || 'Mensalista')}</strong>`}</td>
          </tr>
        </table>

        <!-- Tabela de Eventos com Subtotais e Valor Líquido -->
        <table class="holerite-tabela-eventos">
          <thead>
            <tr>
              <th scope="col" style="width: 55px; text-align: center;">Código</th>
              <th scope="col" style="text-align: left;">Descrição</th>
              <th scope="col" style="width: 75px; text-align: center;">Referência</th>
              <th scope="col" style="width: 120px; text-align: right;">Vencimentos</th>
              <th scope="col" style="width: 120px; text-align: right;">Descontos</th>
            </tr>
          </thead>
          <tbody>
            ${eventosRows}
          </tbody>
          <tfoot>
            <tr class="holerite-linha-subtotais">
              <td colspan="3" class="holerite-subtotal-vazio"></td>
              <td class="holerite-subtotal-col" style="text-align: right;">
                <span class="holerite-subtotal-label">Total de Vencimentos</span>
                <span class="holerite-num holerite-vencimento holerite-subtotal-val">${formatMoney(doc.total_vencimentos)}</span>
              </td>
              <td class="holerite-subtotal-col" style="text-align: right;">
                <span class="holerite-subtotal-label">Total de Descontos</span>
                <span class="holerite-num holerite-desconto holerite-subtotal-val">${formatMoney(doc.total_descontos)}</span>
              </td>
            </tr>
            <tr class="holerite-linha-liquido">
              <td colspan="3" class="holerite-liquido-vazio"></td>
              <td class="holerite-liquido-label-cell" style="text-align: right;">
                <span class="holerite-liquido-label">Valor Líquido &nbsp;⇨</span>
              </td>
              <td class="holerite-liquido-val-cell" style="text-align: right;">
                <span class="holerite-num holerite-liquido-val">${formatMoney(doc.valor_liquido)}</span>
              </td>
            </tr>
          </tfoot>
        </table>

        <!-- Valor por Extenso -->
        <div style="font-size: 0.78rem; color: #334155; margin-bottom: 12px; background: #f1f5f9; padding: 6px 12px; border-radius: 4px;">
          Valor por extenso: <em>${escapeHtml(doc.valor_liquido_extenso || formatMoney(doc.valor_liquido))}</em>
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
            <div class="holerite-canhoto-data">
              Data: <strong>____/____/________</strong>
            </div>
            <div class="holerite-linha-assinatura">
              ${escapeHtml(doc.funcionario_nome || '')}
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
              const pixSafe = encodeURIComponent(c.chave_pix || '');
              pixBarHtml = `
                <div class="no-print" style="margin-bottom: 12px; padding: 10px 14px; background: rgba(168, 85, 247, 0.08); border: 1px solid rgba(168, 85, 247, 0.25); border-radius: 8px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                  <div style="display: flex; align-items: center; gap: 14px; font-size: 0.82rem;">
                    ${c.chave_pix ? `<span>💳 PIX: <strong style="font-family: monospace; color: #a855f7;">${escapeHtml(c.chave_pix)}</strong></span>` : ''}
                    ${c.telefone_celular ? `<span>📱 Cel: <strong>${escapeHtml(c.telefone_celular)}</strong></span>` : ''}
                    <span>Status: <strong style="color: #10b981;">${escapeHtml(c.status || 'ATIVO')}</strong></span>
                  </div>
                  ${c.chave_pix ? `<button type="button" class="btn btn-outline btn-sm" onclick="navigator.clipboard.writeText(decodeURIComponent('${pixSafe}')).then(() => alert('📋 Chave PIX copiada!'))" style="font-size: 0.75rem; padding: 2px 8px;">📋 Copiar PIX</button>` : ''}
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
    gerarHoleriteHtml,
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
