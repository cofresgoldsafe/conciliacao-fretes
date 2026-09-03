/**
 * funcionarios_dp.js - Módulo Frontend de Cadastro Geral de Funcionários & Colaboradores (DP / RH)
 * Suporte a GSI BW, OAÇO e Sem Registro / Prestadores
 */

(function () {
  'use strict';

  // Estado Local
  const state = {
    empresaFiltro: 'TODAS',
    statusFiltro: 'TODOS',
    searchQuery: '',
    colaboradores: [],
    currentColab: null
  };

  function getAuthHeader() {
    const token = localStorage.getItem('token') || localStorage.getItem('authToken');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  }

  function formatMoney(val) {
    const num = parseFloat(val) || 0.0;
    return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  // Inicialização do Módulo
  function init() {
    console.log('👥 [Funcionários DP] Inicializando módulo...');
    setupEventListeners();
    carregarColaboradores();
  }

  function setupEventListeners() {
    // 1. Botão Novo Colaborador
    const btnNovo = document.getElementById('btnNovoColaborador');
    if (btnNovo) {
      btnNovo.addEventListener('click', abrirModalNovo);
    }

    // 2. Sincronizar dos Holerites
    const btnSync = document.getElementById('btnSyncColaboradoresHolerite');
    if (btnSync) {
      btnSync.addEventListener('click', executarSyncHolerites);
    }

    // 3. Atualizar Lista
    const btnRefresh = document.getElementById('btnRefreshColaboradores');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', carregarColaboradores);
    }

    // 4. Exportar CSV
    const btnExportar = document.getElementById('btnExportarColaboradores');
    if (btnExportar) {
      btnExportar.addEventListener('click', exportarColaboradoresCsv);
    }

    // 5. Filtros Empresa
    const groupEmpresa = document.getElementById('groupFiltroEmpresaColab');
    if (groupEmpresa) {
      groupEmpresa.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-colab-filtro-empresa');
        if (!btn) return;
        groupEmpresa.querySelectorAll('.btn-colab-filtro-empresa').forEach(b => {
          b.classList.remove('active', 'btn-primary');
          b.classList.add('btn-outline');
        });
        btn.classList.add('active', 'btn-primary');
        btn.classList.remove('btn-outline');
        state.empresaFiltro = btn.dataset.empresa || 'TODAS';
        carregarColaboradores();
      });
    }

    // 6. Filtros Status
    const groupStatus = document.getElementById('groupFiltroStatusColab');
    if (groupStatus) {
      groupStatus.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-colab-filtro-status');
        if (!btn) return;
        groupStatus.querySelectorAll('.btn-colab-filtro-status').forEach(b => {
          b.classList.remove('active', 'btn-primary');
          b.classList.add('btn-outline');
        });
        btn.classList.add('active', 'btn-primary');
        btn.classList.remove('btn-outline');
        state.statusFiltro = btn.dataset.status || 'TODOS';
        carregarColaboradores();
      });
    }

    // 7. Busca Instantânea
    const inputBusca = document.getElementById('inputBuscaColaborador');
    let debounceTimer = null;
    if (inputBusca) {
      inputBusca.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          state.searchQuery = e.target.value.trim();
          carregarColaboradores();
        }, 300);
      });
    }

    const btnClearBusca = document.getElementById('btnClearBuscaColaborador');
    if (btnClearBusca && inputBusca) {
      btnClearBusca.addEventListener('click', () => {
        inputBusca.value = '';
        state.searchQuery = '';
        carregarColaboradores();
      });
    }

    // 8. Controles do Modal de Formulário
    const modalForm = document.getElementById('modalColaboradorForm');
    const btnFecharForm = document.getElementById('btnFecharModalColaboradorForm');
    const btnCancelarForm = document.getElementById('btnCancelarColaboradorForm');
    const btnSalvarForm = document.getElementById('btnSalvarColaboradorForm');

    if (btnFecharForm && modalForm) {
      btnFecharForm.addEventListener('click', () => modalForm.style.display = 'none');
    }
    if (btnCancelarForm && modalForm) {
      btnCancelarForm.addEventListener('click', () => modalForm.style.display = 'none');
    }
    if (btnSalvarForm) {
      btnSalvarForm.addEventListener('click', salvarFormularioColaborador);
    }

    // 9. Controles do Modal de Ficha
    const modalFicha = document.getElementById('modalColaboradorFicha');
    const btnFecharFicha = document.getElementById('btnFecharModalColaboradorFicha');
    const btnFecharFicha2 = document.getElementById('btnFecharFichaColaborador');
    const btnEditarFicha = document.getElementById('btnEditarFichaColaborador');

    if (btnFecharFicha && modalFicha) {
      btnFecharFicha.addEventListener('click', () => modalFicha.style.display = 'none');
    }
    if (btnFecharFicha2 && modalFicha) {
      btnFecharFicha2.addEventListener('click', () => modalFicha.style.display = 'none');
    }
    if (btnEditarFicha) {
      btnEditarFicha.addEventListener('click', () => {
        if (state.currentColab) {
          if (modalFicha) modalFicha.style.display = 'none';
          abrirModalEditar(state.currentColab.id);
        }
      });
    }
  }

  // --- CARREGAMENTO DE DADOS E RENDERIZAÇÃO ---

  async function carregarColaboradores() {
    const tbody = document.getElementById('colaboradoresTableBody');
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 2.5rem;">
            ⏳ Carregando colaboradores...
          </td>
        </tr>
      `;
    }

    try {
      const params = new URLSearchParams();
      if (state.empresaFiltro && state.empresaFiltro !== 'TODAS') params.append('empresa', state.empresaFiltro);
      if (state.statusFiltro && state.statusFiltro !== 'TODOS') params.append('status', state.statusFiltro);
      if (state.searchQuery) params.append('busca', state.searchQuery);

      const res = await fetch(`/api/dp/colaboradores?${params.toString()}`, {
        headers: getAuthHeader()
      });
      const data = await res.json();

      if (data.success && Array.isArray(data.colaboradores)) {
        state.colaboradores = data.colaboradores;
        renderTabela();
        atualizarKpis();
      } else {
        throw new Error(data.error || 'Erro ao carregar colaboradores.');
      }
    } catch (err) {
      console.error('Erro ao carregar colaboradores:', err);
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="8" style="text-align: center; color: #ef4444; padding: 2rem;">
              ❌ Falha ao carregar colaboradores: ${err.message}
            </td>
          </tr>
        `;
      }
    }
  }

  function renderTabela() {
    const tbody = document.getElementById('colaboradoresTableBody');
    if (!tbody) return;

    if (state.colaboradores.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 3rem;">
            Nenhum colaborador encontrado para os filtros informados.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = state.colaboradores.map(c => {
      // Badge Empresa
      let badgeEmpresa = `<span class="badge-gsi">GSI BW</span>`;
      if (c.empresa === 'OACO') badgeEmpresa = `<span class="badge-oaco">OAÇO</span>`;
      else if (c.empresa === 'SEM_REGISTRO') badgeEmpresa = `<span class="badge-sem-reg">Sem Registro</span>`;

      // Badge Status
      let badgeStatus = `<span class="badge-status-ativo">🟢 Ativo</span>`;
      if (c.status === 'FERIAS') badgeStatus = `<span class="badge-status-ferias">🟡 Férias</span>`;
      else if (c.status === 'AFASTADO') badgeStatus = `<span class="badge-status-afastado">🟠 Afastado</span>`;
      else if (c.status === 'DESLIGADO') badgeStatus = `<span class="badge-status-desligado">🔴 Desligado</span>`;

      // Telefone / WhatsApp Link
      let contatoHtml = '<span style="color: var(--text-muted);">-</span>';
      if (c.telefone_celular) {
        const numClean = c.telefone_celular.replace(/\D/g, '');
        const waLink = numClean.length >= 10 ? `https://wa.me/55${numClean}` : null;
        contatoHtml = `
          <div style="display: flex; align-items: center; gap: 6px;">
            <span>📱 ${c.telefone_celular}</span>
            ${waLink ? `<a href="${waLink}" target="_blank" rel="noopener noreferrer" title="Conversar no WhatsApp" style="text-decoration: none; font-size: 0.9rem;">💬</a>` : ''}
          </div>
        `;
      }

      // Chave PIX com Cópia Rápida
      let pixHtml = '<span style="color: var(--text-muted);">-</span>';
      if (c.chave_pix) {
        const pixShort = c.chave_pix.length > 20 ? c.chave_pix.substring(0, 18) + '...' : c.chave_pix;
        pixHtml = `
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; color: #38bdf8;" title="${c.chave_pix}">
              ${pixShort}
            </span>
            <button type="button" class="btn btn-outline btn-sm" onclick="window.funcionariosDpModule.copiarChavePix('${c.chave_pix.replace(/'/g, "\\'")}')" style="padding: 1px 5px; font-size: 0.7rem;" title="Copiar Chave PIX">
              📋
            </button>
          </div>
        `;
      }

      return `
        <tr style="border-bottom: 1px solid var(--panel-border);">
          <td>${badgeEmpresa}</td>
          <td>
            <strong style="color: var(--text-color, #f8fafc); display: block; font-size: 0.88rem;">${c.nome_completo}</strong>
            <span style="font-size: 0.74rem; color: var(--text-muted);">
              ${c.cpf ? `CPF: ${c.cpf}` : 'Sem CPF'} ${c.codigo_interno ? `| Cód: ${c.codigo_interno}` : ''}
            </span>
          </td>
          <td>
            <span style="display: block; font-weight: 500;">${c.cargo || 'Não informado'}</span>
            <span style="font-size: 0.74rem; color: var(--text-muted);">${c.departamento || '-'}</span>
          </td>
          <td style="font-size: 0.8rem;">${c.data_admissao || '-'}</td>
          <td>${contatoHtml}</td>
          <td>${pixHtml}</td>
          <td style="text-align: center;">${badgeStatus}</td>
          <td style="text-align: center;">
            <div style="display: inline-flex; gap: 4px;">
              <button type="button" class="btn btn-primary btn-sm" onclick="window.funcionariosDpModule.abrirFicha(${c.id})" title="Ver Ficha Completa" style="padding: 2px 7px; font-size: 0.75rem;">
                👁️
              </button>
              <button type="button" class="btn btn-outline btn-sm" onclick="window.funcionariosDpModule.abrirModalEditar(${c.id})" title="Editar Cadastro" style="padding: 2px 7px; font-size: 0.75rem;">
                ✏️
              </button>
              <button type="button" class="btn btn-outline btn-sm" onclick="window.funcionariosDpModule.excluirColaborador(${c.id})" title="Excluir" style="padding: 2px 5px; font-size: 0.75rem; color: #ef4444; border-color: rgba(239, 68, 68, 0.3);">
                🗑️
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function atualizarKpis() {
    let total = state.colaboradores.length;
    let ativos = 0;
    let gsi = 0;
    let oaco = 0;
    let semReg = 0;
    let desligados = 0;

    for (const c of state.colaboradores) {
      if (c.status === 'ATIVO') ativos++;
      else if (c.status === 'DESLIGADO' || c.status === 'AFASTADO') desligados++;

      if (c.empresa === 'GSI') gsi++;
      else if (c.empresa === 'OACO') oaco++;
      else if (c.empresa === 'SEM_REGISTRO') semReg++;
    }

    const elTotal = document.getElementById('kpiColabTotal');
    const elAtivos = document.getElementById('kpiColabAtivos');
    const elGsi = document.getElementById('kpiColabGsi');
    const elOaco = document.getElementById('kpiColabOaco');
    const elSemReg = document.getElementById('kpiColabSemReg');
    const elDesligados = document.getElementById('kpiColabDesligados');

    if (elTotal) elTotal.textContent = total;
    if (elAtivos) elAtivos.textContent = ativos;
    if (elGsi) elGsi.textContent = gsi;
    if (elOaco) elOaco.textContent = oaco;
    if (elSemReg) elSemReg.textContent = semReg;
    if (elDesligados) elDesligados.textContent = desligados;
  }

  // --- MODAL DE FORMULÁRIO (NOVO / EDITAR) ---

  function abrirModalNovo() {
    const modal = document.getElementById('modalColaboradorForm');
    const title = document.getElementById('modalColaboradorFormTitle');
    const form = document.getElementById('formColaborador');

    if (!modal) return;
    if (title) title.innerHTML = '<span>➕ Novo Cadastro de Funcionário</span>';
    if (form) form.reset();

    document.getElementById('colabInputId').value = '';
    document.getElementById('colabInputEmpresa').value = 'GSI';
    document.getElementById('colabInputStatus').value = 'ATIVO';
    document.getElementById('colabInputTipoContrato').value = 'CLT';

    modal.style.display = 'flex';
  }

  async function abrirModalEditar(id) {
    try {
      const res = await fetch(`/api/dp/colaboradores/${id}`, { headers: getAuthHeader() });
      const data = await res.json();
      if (!data.success || !data.colaborador) {
        throw new Error(data.error || 'Colaborador não encontrado.');
      }

      const c = data.colaborador;
      const modal = document.getElementById('modalColaboradorForm');
      const title = document.getElementById('modalColaboradorFormTitle');

      if (title) title.innerHTML = `<span>✏️ Editar Funcionário: ${c.nome_completo}</span>`;

      document.getElementById('colabInputId').value = c.id || '';
      document.getElementById('colabInputEmpresa').value = c.empresa || 'GSI';
      document.getElementById('colabInputNome').value = c.nome_completo || '';
      document.getElementById('colabInputCpf').value = c.cpf || '';
      document.getElementById('colabInputRg').value = c.rg || '';
      document.getElementById('colabInputNascimento').value = c.data_nascimento || '';
      document.getElementById('colabInputCodigo').value = c.codigo_interno || '';

      document.getElementById('colabInputCargo').value = c.cargo || '';
      document.getElementById('colabInputCbo').value = c.cbo || '';
      document.getElementById('colabInputDepto').value = c.departamento || '';
      document.getElementById('colabInputTipoContrato').value = c.tipo_contrato || 'CLT';
      document.getElementById('colabInputAdmissao').value = c.data_admissao || '';
      document.getElementById('colabInputDemissao').value = c.data_demissao || '';
      document.getElementById('colabInputCtpsNum').value = c.ctps_numero || '';
      document.getElementById('colabInputCtpsSerie').value = c.ctps_serie || '';
      document.getElementById('colabInputPis').value = c.pis_pasep || '';
      document.getElementById('colabInputStatus').value = c.status || 'ATIVO';
      document.getElementById('colabInputSalarioBase').value = c.salario_base || '';

      document.getElementById('colabInputCelular').value = c.telefone_celular || '';
      document.getElementById('colabInputTelefoneFixo').value = c.telefone_fixo || '';
      document.getElementById('colabInputEmail').value = c.email_pessoal || '';
      document.getElementById('colabInputCep').value = c.endereco_cep || '';
      document.getElementById('colabInputLogradouro').value = c.endereco_logradouro || '';
      document.getElementById('colabInputNumero').value = c.endereco_numero || '';
      document.getElementById('colabInputComplemento').value = c.endereco_complemento || '';
      document.getElementById('colabInputBairro').value = c.endereco_bairro || '';
      document.getElementById('colabInputCidade').value = c.endereco_cidade || '';
      document.getElementById('colabInputUf').value = c.endereco_uf || '';

      document.getElementById('colabInputTipoPix').value = c.tipo_chave_pix || '';
      document.getElementById('colabInputChavePix').value = c.chave_pix || '';
      document.getElementById('colabInputBancoNome').value = c.banco_nome || '';
      document.getElementById('colabInputBancoCodigo').value = c.banco_codigo || '';
      document.getElementById('colabInputAgencia').value = c.agencia || '';
      document.getElementById('colabInputConta').value = c.conta_corrente || '';
      document.getElementById('colabInputTipoConta').value = c.tipo_conta || 'CORRENTE';
      document.getElementById('colabInputObservacoes').value = c.observacoes || '';

      if (modal) modal.style.display = 'flex';
    } catch (err) {
      alert('Erro ao carregar dados para edição: ' + err.message);
    }
  }

  async function salvarFormularioColaborador() {
    const id = document.getElementById('colabInputId').value;
    const nome = document.getElementById('colabInputNome').value.trim();
    const empresa = document.getElementById('colabInputEmpresa').value;

    if (!nome) {
      alert('Por favor, informe o Nome Completo do colaborador.');
      return;
    }

    const payload = {
      empresa,
      nome_completo: nome,
      cpf: document.getElementById('colabInputCpf').value.trim(),
      rg: document.getElementById('colabInputRg').value.trim(),
      data_nascimento: document.getElementById('colabInputNascimento').value.trim(),
      codigo_interno: document.getElementById('colabInputCodigo').value.trim(),
      cargo: document.getElementById('colabInputCargo').value.trim(),
      cbo: document.getElementById('colabInputCbo').value.trim(),
      departamento: document.getElementById('colabInputDepto').value.trim(),
      tipo_contrato: document.getElementById('colabInputTipoContrato').value,
      data_admissao: document.getElementById('colabInputAdmissao').value.trim(),
      data_demissao: document.getElementById('colabInputDemissao').value.trim(),
      ctps_numero: document.getElementById('colabInputCtpsNum').value.trim(),
      ctps_serie: document.getElementById('colabInputCtpsSerie').value.trim(),
      pis_pasep: document.getElementById('colabInputPis').value.trim(),
      status: document.getElementById('colabInputStatus').value,
      salario_base: parseFloat(document.getElementById('colabInputSalarioBase').value) || 0.0,
      telefone_celular: document.getElementById('colabInputCelular').value.trim(),
      telefone_fixo: document.getElementById('colabInputTelefoneFixo').value.trim(),
      email_pessoal: document.getElementById('colabInputEmail').value.trim(),
      endereco_cep: document.getElementById('colabInputCep').value.trim(),
      endereco_logradouro: document.getElementById('colabInputLogradouro').value.trim(),
      endereco_numero: document.getElementById('colabInputNumero').value.trim(),
      endereco_complemento: document.getElementById('colabInputComplemento').value.trim(),
      endereco_bairro: document.getElementById('colabInputBairro').value.trim(),
      endereco_cidade: document.getElementById('colabInputCidade').value.trim(),
      endereco_uf: document.getElementById('colabInputUf').value.trim(),
      tipo_chave_pix: document.getElementById('colabInputTipoPix').value,
      chave_pix: document.getElementById('colabInputChavePix').value.trim(),
      banco_nome: document.getElementById('colabInputBancoNome').value.trim(),
      banco_codigo: document.getElementById('colabInputBancoCodigo').value.trim(),
      agencia: document.getElementById('colabInputAgencia').value.trim(),
      conta_corrente: document.getElementById('colabInputConta').value.trim(),
      tipo_conta: document.getElementById('colabInputTipoConta').value,
      observacoes: document.getElementById('colabInputObservacoes').value.trim()
    };

    const isEdit = Boolean(id);
    const url = isEdit ? `/api/dp/colaboradores/${id}` : '/api/dp/colaboradores';
    const method = isEdit ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: {
          ...getAuthHeader(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Falha ao salvar colaborador.');
      }

      alert(`✅ Colaborador "${payload.nome_completo}" ${isEdit ? 'atualizado' : 'cadastrado'} com sucesso!`);
      const modal = document.getElementById('modalColaboradorForm');
      if (modal) modal.style.display = 'none';
      await carregarColaboradores();
    } catch (err) {
      alert('Erro ao salvar: ' + err.message);
    }
  }

  // --- FICHA EXECUTIVA DO COLABORADOR ---

  async function abrirFicha(id) {
    try {
      const res = await fetch(`/api/dp/colaboradores/${id}`, { headers: getAuthHeader() });
      const data = await res.json();
      if (!data.success || !data.colaborador) {
        throw new Error(data.error || 'Colaborador não encontrado.');
      }

      state.currentColab = data.colaborador;
      const c = data.colaborador;
      const modal = document.getElementById('modalColaboradorFicha');
      const body = document.getElementById('colaboradorFichaBody');

      if (!modal || !body) return;

      let badgeEmpresa = `<span class="badge-gsi">GSI BW (Filial 15)</span>`;
      if (c.empresa === 'OACO') badgeEmpresa = `<span class="badge-oaco">OAÇO (Filial 16)</span>`;
      else if (c.empresa === 'SEM_REGISTRO') badgeEmpresa = `<span class="badge-sem-reg">Sem Registro / Avulso</span>`;

      body.innerHTML = `
        <div style="background: rgba(30, 41, 59, 0.4); border: 1px solid var(--panel-border); border-radius: 8px; padding: 14px; margin-bottom: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <div>
              <h4 style="margin: 0; font-size: 1.15rem; color: #f8fafc;">${c.nome_completo}</h4>
              <span style="font-size: 0.82rem; color: var(--text-muted);">${c.cargo || 'Cargo não especificado'} &bull; ${c.departamento || 'Geral'}</span>
            </div>
            <div>${badgeEmpresa}</div>
          </div>
          <div style="display: flex; gap: 12px; flex-wrap: wrap; font-size: 0.8rem; color: #94a3b8; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 8px;">
            <span>CPF: <strong style="color: #f8fafc;">${c.cpf || '-'}</strong></span>
            <span>RG: <strong style="color: #f8fafc;">${c.rg || '-'}</strong></span>
            <span>Cód: <strong style="color: #f8fafc;">${c.codigo_interno || '-'}</strong></span>
            <span>Status: <strong style="color: #34d399;">${c.status || 'ATIVO'}</strong></span>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px;">
          <!-- Vínculo -->
          <div style="background: rgba(30, 41, 59, 0.3); border: 1px solid var(--panel-border); border-radius: 6px; padding: 10px;">
            <strong style="color: #10b981; font-size: 0.8rem; display: block; margin-bottom: 6px;">💼 Vínculo & Documentos</strong>
            <p style="margin: 3px 0; font-size: 0.8rem;">Admissão: <strong>${c.data_admissao || '-'}</strong></p>
            <p style="margin: 3px 0; font-size: 0.8rem;">CTPS: <strong>${c.ctps_numero || '-'} ${c.ctps_serie ? `Série ${c.ctps_serie}` : ''}</strong></p>
            <p style="margin: 3px 0; font-size: 0.8rem;">PIS/PASEP: <strong>${c.pis_pasep || '-'}</strong></p>
            <p style="margin: 3px 0; font-size: 0.8rem;">Salário Base: <strong style="color: #34d399;">${formatMoney(c.salario_base)}</strong></p>
          </div>

          <!-- Contato -->
          <div style="background: rgba(30, 41, 59, 0.3); border: 1px solid var(--panel-border); border-radius: 6px; padding: 10px;">
            <strong style="color: #f59e0b; font-size: 0.8rem; display: block; margin-bottom: 6px;">📱 Contato & Endereço</strong>
            <p style="margin: 3px 0; font-size: 0.8rem;">Celular: <strong>${c.telefone_celular || '-'}</strong></p>
            <p style="margin: 3px 0; font-size: 0.8rem;">E-mail: <strong>${c.email_pessoal || '-'}</strong></p>
            <p style="margin: 3px 0; font-size: 0.8rem;">Endereço: <strong>${c.endereco_logradouro ? `${c.endereco_logradouro}, ${c.endereco_numero || 'S/N'}` : '-'}</strong></p>
            <p style="margin: 3px 0; font-size: 0.8rem;">Cidade/UF: <strong>${c.endereco_cidade || '-'} / ${c.endereco_uf || '-'}</strong></p>
          </div>
        </div>

        <!-- Dados Bancários & PIX -->
        <div style="background: rgba(168, 85, 247, 0.1); border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 6px; padding: 12px; margin-bottom: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <strong style="color: #c084fc; font-size: 0.82rem;">💳 Chave PIX & Pagamentos</strong>
            ${c.chave_pix ? `<button type="button" class="btn btn-outline btn-sm" onclick="window.funcionariosDpModule.copiarChavePix('${c.chave_pix.replace(/'/g, "\\'")}')" style="padding: 2px 8px; font-size: 0.72rem;">📋 Copiar PIX</button>` : ''}
          </div>
          <p style="margin: 3px 0; font-family: 'JetBrains Mono', monospace; font-size: 0.88rem; color: #f8fafc;">
            Chave: <strong>${c.chave_pix || 'Nenhuma chave cadastrada'}</strong> ${c.tipo_chave_pix ? `(${c.tipo_chave_pix})` : ''}
          </p>
          <div style="display: flex; gap: 14px; font-size: 0.78rem; color: #94a3b8; margin-top: 4px;">
            <span>Banco: <strong>${c.banco_nome || '-'}</strong></span>
            <span>Agência: <strong>${c.agencia || '-'}</strong></span>
            <span>Conta: <strong>${c.conta_corrente || '-'}</strong></span>
          </div>
        </div>

        ${c.observacoes ? `
          <div style="background: rgba(30, 41, 59, 0.25); border: 1px solid var(--panel-border); border-radius: 6px; padding: 10px; font-size: 0.8rem;">
            <strong style="color: var(--text-muted); display: block; margin-bottom: 4px;">📝 Observações do DP:</strong>
            <p style="margin: 0; color: #cbd5e1;">${c.observacoes}</p>
          </div>
        ` : ''}
      `;

      modal.style.display = 'flex';
    } catch (err) {
      alert('Erro ao abrir ficha: ' + err.message);
    }
  }

  // --- SINCRONIZAÇÃO E EXCLUSÃO ---

  async function executarSyncHolerites() {
    const btn = document.getElementById('btnSyncColaboradoresHolerite');
    if (btn) btn.disabled = true;

    try {
      const res = await fetch('/api/dp/colaboradores/sync-holerites', {
        method: 'POST',
        headers: getAuthHeader()
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      alert(`✅ Sincronização concluída!\n\n• Holerites analisados: ${data.total_verificados}\n• Novos funcionários cadastrados: ${data.novos_adicionados}`);
      await carregarColaboradores();
    } catch (err) {
      alert('Falha na sincronização: ' + err.message);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function excluirColaborador(id) {
    const colab = state.colaboradores.find(x => x.id === id);
    const nome = colab ? colab.nome_completo : `ID ${id}`;

    if (!confirm(`Tem certeza que deseja excluir o cadastro de "${nome}"?\n\nEsta ação removerá a ficha funcional do banco de dados.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/dp/colaboradores/${id}`, {
        method: 'DELETE',
        headers: getAuthHeader()
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      await carregarColaboradores();
    } catch (err) {
      alert('Erro ao excluir: ' + err.message);
    }
  }

  function copiarChavePix(chave) {
    if (!chave) return;
    navigator.clipboard.writeText(chave).then(() => {
      alert(`📋 Chave PIX copiada para a área de transferência:\n\n${chave}`);
    }).catch(() => {
      prompt('Chave PIX (copie manualmente):', chave);
    });
  }

  function exportarColaboradoresCsv() {
    if (state.colaboradores.length === 0) {
      alert('Nenhum colaborador para exportar.');
      return;
    }

    const colunas = [
      'ID', 'Empresa', 'Nome Completo', 'CPF', 'RG', 'Código Interno', 'Cargo', 'CBO',
      'Departamento', 'Tipo Contrato', 'Admissão', 'Demissão', 'Status', 'Salário Base (R$)',
      'Celular', 'Telefone Fixo', 'E-mail', 'CEP', 'Logradouro', 'Número', 'Bairro', 'Cidade', 'UF',
      'Tipo Chave PIX', 'Chave PIX', 'Banco', 'Agência', 'Conta Corrente'
    ];

    const linhas = state.colaboradores.map(c => [
      c.id,
      c.empresa,
      `"${(c.nome_completo || '').replace(/"/g, '""')}"`,
      c.cpf || '',
      c.rg || '',
      c.codigo_interno || '',
      `"${(c.cargo || '').replace(/"/g, '""')}"`,
      c.cbo || '',
      `"${(c.departamento || '').replace(/"/g, '""')}"`,
      c.tipo_contrato || 'CLT',
      c.data_admissao || '',
      c.data_demissao || '',
      c.status || 'ATIVO',
      (parseFloat(c.salario_base) || 0).toFixed(2).replace('.', ','),
      c.telefone_celular || '',
      c.telefone_fixo || '',
      c.email_pessoal || '',
      c.endereco_cep || '',
      `"${(c.endereco_logradouro || '').replace(/"/g, '""')}"`,
      c.endereco_numero || '',
      `"${(c.endereco_bairro || '').replace(/"/g, '""')}"`,
      `"${(c.endereco_cidade || '').replace(/"/g, '""')}"`,
      c.endereco_uf || '',
      c.tipo_chave_pix || '',
      `"${(c.chave_pix || '').replace(/"/g, '""')}"`,
      `"${(c.banco_nome || '').replace(/"/g, '""')}"`,
      c.agencia || '',
      c.conta_corrente || ''
    ]);

    const csvContent = '\uFEFF' + [
      colunas.join(';'),
      ...linhas.map(r => r.join(';'))
    ].join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `colaboradores_dp_${state.empresaFiltro}_${state.statusFiltro}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Registra globalmente no window
  window.funcionariosDpModule = {
    init,
    carregarColaboradores,
    abrirModalNovo,
    abrirModalEditar,
    abrirFicha,
    excluirColaborador,
    copiarChavePix
  };

  // Inicializa quando o DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
