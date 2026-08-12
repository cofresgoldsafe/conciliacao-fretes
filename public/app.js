document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const transportadoraSelect = document.getElementById('transportadoraSelect');
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const btnLoadSample = document.getElementById('btnLoadSample');
  const btnLoadSampleTipo2 = document.getElementById('btnLoadSampleTipo2');
  const loadingState = document.getElementById('loadingState');
  const loadingMessage = document.getElementById('loadingMessage');

  const faturaSummary = document.getElementById('faturaSummary');
  const sumTransp = document.getElementById('sumTransp');
  const sumCnpj = document.getElementById('sumCnpj');
  const sumFaturaNum = document.getElementById('sumFaturaNum');
  const sumDatas = document.getElementById('sumDatas');
  const sumQtdFretes = document.getElementById('sumQtdFretes');
  const sumValorTotal = document.getElementById('sumValorTotal');
  const batimentoBadge = document.getElementById('batimentoBadge');

  const tableSection = document.getElementById('tableSection');
  const tableSearch = document.getElementById('tableSearch');
  const btnExportCsv = document.getElementById('btnExportCsv');
  const ctesTableBody = document.getElementById('ctesTableBody');
  const footTotalOrcado = document.getElementById('footTotalOrcado');
  const footTotalCobrado = document.getElementById('footTotalCobrado');

  const btnRecalcular = document.getElementById('btnRecalcular');
  const btnLancarProtheus = document.getElementById('btnLancarProtheus');

  const resultModal = document.getElementById('resultModal');
  const modalBody = document.getElementById('modalBody');
  const btnCloseModal = document.getElementById('btnCloseModal');
  const btnConfirmModal = document.getElementById('btnConfirmModal');

  const btnOpenHistory = document.getElementById('btnOpenHistory');
  const historyModal = document.getElementById('historyModal');
  const historyModalBody = document.getElementById('historyModalBody');
  const btnCloseHistoryModal = document.getElementById('btnCloseHistoryModal');
  const btnConfirmHistoryModal = document.getElementById('btnConfirmHistoryModal');

  // Application State
  let currentFatura = null;
  let currentItems = [];
  let filterText = '';

  function formatCurrency(val) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
  }

  // Load Rodonaves sample (Exemplo_FAT_OACO.pdf)
  btnLoadSample.addEventListener('click', async (e) => {
    e.stopPropagation();
    showLoading(true, 'Lendo fatura Exemplo_FAT_OACO.pdf e consultando SD2/SC5 no Protheus...');
    try {
      const response = await fetch('/api/sample-rodonaves');
      const data = await response.json();
      if (data.success) {
        renderFaturaData(data);
      } else {
        alert('Erro ao carregar exemplo Rodonaves: ' + data.message);
      }
    } catch (err) {
      alert('Erro ao carregar exemplo.');
      console.error(err);
    } finally {
      showLoading(false);
    }
  });

  // Load Tipo 2 sample (VIPP)
  btnLoadSampleTipo2.addEventListener('click', async (e) => {
    e.stopPropagation();
    showLoading(true, 'Lendo fatura VIPP Visualset e consultando SD2/SC5 no Protheus...');
    try {
      const response = await fetch('/api/sample-tipo2');
      const data = await response.json();
      if (data.success) {
        renderFaturaData(data);
      } else {
        alert('Erro ao carregar exemplo Tipo 2: ' + data.message);
      }
    } catch (err) {
      alert('Erro ao carregar exemplo Tipo 2.');
      console.error(err);
    } finally {
      showLoading(false);
    }
  });

  // Drag and drop handlers
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      uploadFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      uploadFile(fileInput.files[0]);
    }
  });

  async function uploadFile(file) {
    showLoading(true, `Lendo ${file.name} e identificando Empresa Pagadora no Protheus...`);
    const formData = new FormData();
    formData.append('faturaFile', file);
    formData.append('tipoTransportadora', transportadoraSelect.value);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      const data = await response.json();
      if (data.success) {
        renderFaturaData(data);
      } else {
        alert('Erro ao ler a fatura: ' + data.message);
      }
    } catch (err) {
      alert('Erro no upload.');
      console.error(err);
    } finally {
      showLoading(false);
    }
  }

  function showLoading(isLoading, msg = 'Processando...') {
    if (isLoading) {
      loadingMessage.textContent = msg;
      loadingState.classList.remove('hidden');
      dropzone.classList.add('hidden');
    } else {
      loadingState.classList.add('hidden');
      dropzone.classList.remove('hidden');
    }
  }

  function renderFaturaData(data) {
    currentFatura = data.fatura;
    currentItems = data.items;

    sumTransp.textContent = currentFatura.transportadora;
    const empCod = currentFatura.empresaCodigo || '16';
    const empNome = currentFatura.pagador || 'OACO PRODUTOS DE ACO LTDA';
    
    sumCnpj.innerHTML = `Pagador: <strong>${empNome}</strong> <span class="ped-venda-badge" style="margin-left: 8px;">Protheus Empresa ${empCod} (${currentFatura.empresaKey || 'OACO'})</span>`;
    sumFaturaNum.textContent = currentFatura.numeroFatura;
    sumDatas.textContent = `Emissão: ${currentFatura.dataEmissao} | Venc: ${currentFatura.dataVencimento}`;
    sumQtdFretes.textContent = `${currentFatura.qtdFretes} CT-es`;
    sumValorTotal.textContent = formatCurrency(currentFatura.valorTotal);

    renderTableRows();

    faturaSummary.classList.remove('hidden');
    tableSection.classList.remove('hidden');
    tableSection.scrollIntoView({ behavior: 'smooth' });
  }

  // Filter Table Search
  tableSearch.addEventListener('input', (e) => {
    filterText = e.target.value.toLowerCase().trim();
    renderTableRows();
  });

  function renderTableRows() {
    ctesTableBody.innerHTML = '';

    let totalOrcado = 0;
    let totalCobrado = 0;

    const filteredItems = currentItems.filter(item => {
      if (!filterText) return true;
      return (
        item.numFrete.toLowerCase().includes(filterText) ||
        item.docOriginario.toLowerCase().includes(filterText) ||
        (item.pedVenda && item.pedVenda.toLowerCase().includes(filterText)) ||
        item.cliente.toLowerCase().includes(filterText)
      );
    });

    filteredItems.forEach((item, index) => {
      totalOrcado += item.valorOrcado || 0;
      totalCobrado += item.valorCobrado || 0;

      const realIndex = currentItems.indexOf(item);
      const dataVenc = item.dataVencimento || currentFatura.dataVencimento || '31/07/2026';
      const freteProtheusTotal = item.freteProtheusTotal || ((item.freteCobradoProtheus || 0) + (item.freteEmbutidoProtheus || 0));

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="badge-doc">${item.doc}</span></td>
        <td class="mono-text"><strong>${item.numFrete}</strong></td>
        <td>
          <input 
            type="text" 
            class="editable-input ${item.isEdited ? 'edited' : ''}" 
            value="${item.docOriginario}" 
            data-index="${realIndex}"
            title="Clique para editar a NF (Consulta SD2_DOC)"
          />
        </td>
        <td><span class="ped-venda-badge">${item.pedVenda || 'N/A'}</span></td>
        <td class="mono-text"><strong>${formatCurrency(freteProtheusTotal)}</strong></td>
        <td class="mono-text"><span class="venc-badge">📅 ${dataVenc}</span></td>
        <td class="mono-text">${formatCurrency(item.valorOrcado)}</td>
        <td class="mono-text"><strong>${formatCurrency(item.valorCobrado)}</strong></td>
        <td>${item.cliente}</td>
        <td>
          <span class="status-badge ${item.status === 'Lançado no Protheus' ? 'sucesso' : 'pendente'}" id="statusBadge-${realIndex}">
            ${item.status}
          </span>
        </td>
      `;
      ctesTableBody.appendChild(tr);
    });

    // Re-consult Protheus when NF input changes
    document.querySelectorAll('.editable-input').forEach(input => {
      input.addEventListener('change', async (e) => {
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        const newNf = e.target.value.trim();
        currentItems[idx].docOriginario = newNf;
        currentItems[idx].isEdited = true;
        e.target.classList.add('edited');

        try {
          const empKey = currentFatura.empresaKey || 'OACO';
          const res = await fetch(`/api/protheus/consulta/${newNf}?empresa=${empKey}`);
          const resData = await res.json();
          if (resData.success && resData.data) {
            currentItems[idx].pedVenda = resData.data.pedVenda;
            currentItems[idx].freteCobradoProtheus = resData.data.freteCobrado;
            currentItems[idx].freteEmbutidoProtheus = resData.data.freteEmbutido;
            currentItems[idx].freteProtheusTotal = resData.data.freteProtheusTotal;
            renderTableRows();
          }
        } catch (err) {
          console.error('Erro na requisição ao Protheus:', err);
        }
      });
    });

    footTotalOrcado.innerHTML = `<strong>${formatCurrency(totalOrcado)}</strong>`;
    footTotalCobrado.innerHTML = `<strong>${formatCurrency(totalCobrado)}</strong>`;

    const fullCobrado = currentItems.reduce((acc, curr) => acc + (curr.valorCobrado || 0), 0);
    const diff = Math.abs(currentFatura.valorTotal - fullCobrado);
    if (diff < 0.05) {
      batimentoBadge.className = 'batimento-badge status-ok';
      batimentoBadge.textContent = `✓ Batimento ${formatCurrency(fullCobrado)} (100%)`;
    } else {
      batimentoBadge.className = 'batimento-badge status-alert';
      batimentoBadge.textContent = `⚠️ Divergência R$ ${diff.toFixed(2)}`;
    }
  }

  btnRecalcular.addEventListener('click', () => {
    renderTableRows();
  });

  // Export CSV
  btnExportCsv.addEventListener('click', () => {
    if (!currentItems || currentItems.length === 0) return;
    let csv = 'DOC;Num Frete;Doc (NF);Ped Venda;Cobrado Cli.;Data Vencimento;Valor Orcado;Valor Cobrado;Cliente;Status\n';
    currentItems.forEach(i => {
      const fTotal = i.freteProtheusTotal || ((i.freteCobradoProtheus || 0) + (i.freteEmbutidoProtheus || 0));
      csv += `"${i.doc}";"${i.numFrete}";"${i.docOriginario}";"${i.pedVenda}";"${fTotal}";"${i.dataVencimento || currentFatura.dataVencimento}";"${i.valorOrcadoStr || i.valorOrcado}";"${i.valorCobradoStr || i.valorCobrado}";"${i.cliente}";"${i.status}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `Conciliacao_Protheus_Fatura_${currentFatura.numeroFatura}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });

  // Launch into Protheus - Botão Mantido Desabilitado Conforme Instrução
  btnLancarProtheus.disabled = true;
  btnLancarProtheus.addEventListener('click', (e) => {
    e.preventDefault();
    alert('A gravação automática de fretes no Protheus está desabilitada por enquanto (módulo em homologação). Utilize a consulta e a exportação em CSV para conferência.');
  });

  // History Modal Handler
  btnOpenHistory.addEventListener('click', async () => {
    historyModalBody.innerHTML = '<p>Carregando histórico de integrações...</p>';
    historyModal.classList.remove('hidden');
    try {
      const response = await fetch('/api/history');
      const data = await response.json();
      if (data.success && data.history.length > 0) {
        historyModalBody.innerHTML = data.history.map(item => `
          <div class="history-card">
            <div class="history-card-header">
              <span class="history-card-title">${item.transportadora} — Fatura ${item.faturaNumero}</span>
              <span class="status-badge sucesso">✓ Integrado na Empresa ${item.empresaCodigo || '16'}</span>
            </div>
            <div class="history-card-meta">
              <span>🏢 Pagador: <strong>${item.pagador || 'OACO'}</strong></span> | 
              <span>📅 Data Integração: ${item.dataIntegracao}</span> | 
              <span>⏳ Vencimento: <strong>${item.dataVencimento || '31/07/2026'}</strong></span> | 
              <span>📦 ${item.totalFretes} CT-es</span> | 
              <span>💰 Total: <strong>${formatCurrency(item.valorTotal)}</strong></span>
            </div>
          </div>
        `).join('');
      } else {
        historyModalBody.innerHTML = '<p style="color: var(--text-muted);">Nenhum histórico de integração gravado ainda.</p>';
      }
    } catch (err) {
      historyModalBody.innerHTML = '<p style="color: var(--accent-rose);">Erro ao buscar histórico.</p>';
    }
  });

  // Close modals
  btnCloseModal.addEventListener('click', () => resultModal.classList.add('hidden'));
  btnConfirmModal.addEventListener('click', () => resultModal.classList.add('hidden'));
  btnCloseHistoryModal.addEventListener('click', () => historyModal.classList.add('hidden'));
  btnConfirmHistoryModal.addEventListener('click', () => historyModal.classList.add('hidden'));
});
