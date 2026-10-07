/**
 * public/js/pgtos_desconhecidos.js
 * 
 * Controlador Frontend para a Sub-Aba 'Pgtos Desconhecidos'
 * Macro-Área: 💰 ASSIST. FINANC. > Pgtos Desconhecidos (#tab-pgtos-desconhecidos)
 * 
 * Módulo 100% Autônomo e Desacoplado (IIFE)
 * Plataforma de Apoio GSI (Gemini-Cli)
 */

(function () {
  'use strict';

  // Utilitários de escape e formatação com fallbacks seguros
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
    const num = parseFloat(val) || 0;
    return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  /**
   * Formata valor numérico ou string para o formato brasileiro BRL (ex: 1.222,33)
   * sem prefixo R$ para uso em campos de entrada (inputs)
   */
  function formatarNumeroBRL(val) {
    if (val === null || val === undefined || String(val).trim() === '') return '';
    const str = String(val).trim();
    const numLimpo = str.replace(/[^\d,\.]/g, '');
    if (!numLimpo) return '';

    let numFloat = 0;
    if (numLimpo.includes(',') && numLimpo.includes('.')) {
      numFloat = parseFloat(numLimpo.replace(/\./g, '').replace(',', '.'));
    } else if (numLimpo.includes(',')) {
      numFloat = parseFloat(numLimpo.replace(',', '.'));
    } else {
      const partesPonto = numLimpo.split('.');
      if (partesPonto.length > 2) {
        numFloat = parseFloat(numLimpo.replace(/\./g, ''));
      } else if (partesPonto.length === 2 && partesPonto[1].length === 3) {
        numFloat = parseFloat(numLimpo.replace(/\./g, ''));
      } else {
        numFloat = parseFloat(numLimpo);
      }
    }

    if (isNaN(numFloat) || numFloat < 0) return '';

    return numFloat.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function getToken() {
    try {
      const rawSession = localStorage.getItem('conciliacao_fretes_session');
      if (rawSession) {
        const sess = JSON.parse(rawSession);
        if (sess && sess.token) return sess.token;
      }
      return localStorage.getItem('gsi_auth_token') ||
             localStorage.getItem('auth_token') ||
             localStorage.getItem('token') ||
             sessionStorage.getItem('auth_token') ||
             sessionStorage.getItem('token') ||
             (window.currentUser && window.currentUser.token) ||
             null;
    } catch {
      return localStorage.getItem('auth_token') || localStorage.getItem('token') || null;
    }
  }

  async function apiFetchJson(url) {
    const token = getToken();
    const headers = { 'Accept': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        msg = errJson.error || errJson.message || msg;
      } catch {}
      throw new Error(msg);
    }
    return await res.json();
  }

  // Estado do Módulo
  let estado = {
    carregando: false,
    resultados: [],
    resumo: null,
    filtroOrigemAtivo: 'TODAS',
    filtroConfiancaAtivo: 'TODAS'
  };

  // Elementos do DOM
  let elEmpresa, elValor, elTermo, btnBuscar, btnLimpar;
  let elIdleState, elLoadingState, elEmptyState, elResultsSection;
  let elKpiTotal, elKpiAlta, elKpiMedia, elKpiOrigens;
  let elTableBody, elChipsOrigem, elChipsConfianca;

  function obterElementos() {
    elEmpresa = document.getElementById('pgtosEmpresaSelect');
    elValor = document.getElementById('pgtosValorInput');
    elTermo = document.getElementById('pgtosTermoInput');
    btnBuscar = document.getElementById('btnBuscarPgtosDesconhecidos');
    btnLimpar = document.getElementById('btnLimparPgtosDesconhecidos');

    elIdleState = document.getElementById('pgtosIdleState');
    elLoadingState = document.getElementById('pgtosLoadingState');
    elEmptyState = document.getElementById('pgtosEmptyState');
    elResultsSection = document.getElementById('pgtosResultsSection');

    elKpiTotal = document.getElementById('pgtosKpiTotal');
    elKpiAlta = document.getElementById('pgtosKpiAlta');
    elKpiMedia = document.getElementById('pgtosKpiMedia');
    elKpiOrigens = document.getElementById('pgtosKpiOrigens');

    elTableBody = document.getElementById('pgtosTableBody');
    elChipsOrigem = document.querySelectorAll('.pgtos-chip-origem');
    elChipsConfianca = document.querySelectorAll('.pgtos-chip-confianca');
  }

  /**
   * Executa a busca federada de pagamentos desconhecidos
   */
  async function executarBusca() {
    obterElementos();

    // Sanitiza e formata valor visualmente no padrão BRL se presente
    if (elValor && elValor.value.trim()) {
      sanitizarInputValor(elValor);
      const fmt = formatarNumeroBRL(elValor.value);
      if (fmt) elValor.value = fmt;
    }

    const empresa = elEmpresa ? elEmpresa.value : 'ALL';
    const valor = elValor ? elValor.value.trim() : '';
    const termo = elTermo ? elTermo.value.trim() : '';

    // Validação estrita: O valor do depósito é obrigatório
    const numLimpo = valor.replace(/[^\d,\.]/g, '').trim();
    let valorValido = false;
    if (numLimpo) {
      let numFloat = 0;
      if (numLimpo.includes(',') && numLimpo.includes('.')) {
        numFloat = parseFloat(numLimpo.replace(/\./g, '').replace(',', '.'));
      } else if (numLimpo.includes(',')) {
        numFloat = parseFloat(numLimpo.replace(',', '.'));
      } else {
        numFloat = parseFloat(numLimpo);
      }
      if (!isNaN(numFloat) && numFloat > 0) {
        valorValido = true;
      }
    }

    if (!valor || !valorValido) {
      alert('⚠️ O valor do depósito é obrigatório para pesquisar pagamentos desconhecidos.');
      if (elValor) elValor.focus();
      return;
    }

    if (estado.carregando) return;

    // Atualiza visibilidade dos estados
    if (elIdleState) elIdleState.classList.add('hidden');
    if (elEmptyState) elEmptyState.classList.add('hidden');
    if (elResultsSection) elResultsSection.classList.add('hidden');
    if (elLoadingState) elLoadingState.classList.remove('hidden');

    if (btnBuscar) {
      btnBuscar.disabled = true;
      btnBuscar.style.opacity = '0.7';
    }

    estado.carregando = true;

    try {
      const qs = new URLSearchParams();
      if (empresa) qs.append('empresa', empresa);
      if (valor) qs.append('valor', valor);
      if (termo) qs.append('termo', termo);
      qs.append('limite', '50');

      const data = await apiFetchJson(`/api/financeiro/pgtos-desconhecidos/buscar?${qs.toString()}`);

      if (!data || !data.success) {
        throw new Error((data && data.error) || 'Falha ao buscar pagamentos desconhecidos.');
      }

      estado.resultados = data.resultados || [];
      estado.resumo = data.resumo || null;

      if (estado.resultados.length === 0) {
        if (elEmptyState) elEmptyState.classList.remove('hidden');
      } else {
        renderizarKpis();
        renderizarTabela();
        if (elResultsSection) elResultsSection.classList.remove('hidden');
      }
    } catch (err) {
      console.error('Erro na busca de pagamentos desconhecidos:', err);
      alert(`⚠️ Erro ao consultar serviços de busca: ${err.message}`);
      if (elIdleState) elIdleState.classList.remove('hidden');
    } finally {
      estado.carregando = false;
      if (elLoadingState) elLoadingState.classList.add('hidden');
      if (btnBuscar) {
        btnBuscar.disabled = false;
        btnBuscar.style.opacity = '1';
      }
    }
  }

  /**
   * Renderiza os cartões de KPIs resumidos
   */
  function renderizarKpis() {
    const res = estado.resumo;
    if (!res) return;

    if (elKpiTotal) elKpiTotal.textContent = res.totalEncontrados;
    if (elKpiAlta) elKpiAlta.textContent = res.altaConfianca;
    if (elKpiMedia) elKpiMedia.textContent = res.mediaConfianca;

    if (elKpiOrigens) {
      const o = res.origens || {};
      elKpiOrigens.innerHTML = `
        <span class="badge-origem-item" title="Assistência Técnica">🔧 ${o.assistencia || 0}</span>
        <span class="badge-origem-item" title="Protheus ERP">🏢 ${o.protheus || 0}</span>
        <span class="badge-origem-item" title="Pipedrive CRM">🎯 ${o.pipedrive || 0}</span>
      `;
    }
  }

  /**
   * Renderiza a tabela compacta de candidatos encontrados
   */
  function renderizarTabela() {
    if (!elTableBody) return;
    elTableBody.innerHTML = '';

    // Aplica filtros ativos em memória
    let filtrados = estado.resultados.filter(item => {
      // Proteção defensiva: nunca exibir títulos baixados no Protheus (apenas recebimentos em aberto)
      if (item.status && item.status.includes('Baixado')) return false;
      if (estado.filtroOrigemAtivo !== 'TODAS') {
        if (item.origem !== estado.filtroOrigemAtivo) return false;
      }
      if (estado.filtroConfiancaAtivo !== 'TODAS') {
        if (item.confianca !== estado.filtroConfiancaAtivo) return false;
      }
      return true;
    });

    if (filtrados.length === 0) {
      elTableBody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 2rem; color: var(--text-muted);">
            Nenhum candidato corresponde aos filtros selecionados.
          </td>
        </tr>
      `;
      return;
    }

    filtrados.forEach((item, idx) => {
      const tr = document.createElement('tr');

      // 1. Badge de Confiança
      let confBadge = '';
      if (item.confianca === 'Alta') {
        confBadge = `<span class="badge-confianca badge-conf-alta" title="Score ${item.score} pts">🟢 Alta</span>`;
      } else if (item.confianca === 'Média') {
        confBadge = `<span class="badge-confianca badge-conf-media" title="Score ${item.score} pts">🟡 Média</span>`;
      } else {
        confBadge = `<span class="badge-confianca badge-conf-baixa" title="Score ${item.score} pts">⚪ Baixa</span>`;
      }

      // 2. Badge de Origem
      let origBadge = '';
      if (item.origem === 'ASSISTENCIA') {
        origBadge = `<span class="badge-origem-tag tag-assistencia">🔧 Assistência</span>`;
      } else if (item.origem === 'PROTHEUS') {
        origBadge = `<span class="badge-origem-tag tag-protheus">🏢 Protheus</span>`;
      } else {
        origBadge = `<span class="badge-origem-tag tag-pipedrive">🎯 Pipedrive</span>`;
      }

      // 3. Empresa
      let empLabel = item.empresaNome || item.empresa || '-';
      if (item.empresa === '15') empLabel = '15 (GSI)';
      else if (item.empresa === '14') empLabel = '14 (MP)';
      else if (item.empresa === '16') empLabel = '16 (OAÇO)';

      // 4. Detalhes de Contato / Pagador
      let contatoHtml = `<strong>${escapeHtml(item.cliente)}</strong>`;
      if (item.cpfCnpj) {
        contatoHtml += `<br><small style="color: var(--text-muted);">Doc: ${escapeHtml(item.cpfCnpj)}</small>`;
      }
      if (item.email) {
        contatoHtml += `<br><small style="color: var(--text-muted);">✉️ ${escapeHtml(item.email)}</small>`;
      }
      if (item.celular) {
        contatoHtml += `<br><small style="color: var(--text-muted);">📱 ${escapeHtml(item.celular)}</small>`;
      }

      // 5. Vendedor / Responsável Comercial
      const nomeVendedor = item.vendedor || 'Vendedor Comercial';
      let vendedorHtml = `<span style="font-weight: 600; color: ${nomeVendedor.includes('Vendedor') ? 'var(--text-muted)' : '#38bdf8'};">${escapeHtml(nomeVendedor)}</span>`;
      if (item.condicaoPagamento) {
        vendedorHtml += `<br><small style="color: var(--text-muted);">${escapeHtml(item.condicaoPagamento)}</small>`;
      }

      // 6. Valor e Tipo de Match
      let valorHtml = `<strong style="font-size: 1rem; color: #10b981; font-family: 'JetBrains Mono', monospace;">${formatCurrency(item.valorMatch)}</strong>`;
      if (item.valorOriginal && Math.abs(item.valorOriginal - item.valorMatch) > 0.01) {
        valorHtml += `<br><small style="color: var(--text-muted);" title="Valor Bruto sem desconto">Orig: ${formatCurrency(item.valorOriginal)}</small>`;
      }
      valorHtml += `<br><small style="color: #94a3b8; font-size: 0.73rem;">${escapeHtml(item.tipoMatch)}</small>`;

      // 7. Ações e Links (com validação estrita de protocolo http/https contra javascript: XSS)
      const safeLink = (item.link && /^https?:\/\//i.test(String(item.link).trim())) ? String(item.link).trim() : null;
      let acoesHtml = `<div style="display: flex; gap: 0.35rem; align-items: center;">`;
      if (safeLink) {
        acoesHtml += `
          <a href="${escapeHtml(safeLink)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline btn-xs" title="Abrir registro oficial">
            🔗 Abrir
          </a>
        `;
      }
      acoesHtml += `
        <button class="btn btn-outline btn-xs btn-copiar-candidato" data-idx="${idx}" title="Copiar resumo para área de transferência">
          📋 Copiar
        </button>
      </div>`;

      tr.innerHTML = `
        <td style="text-align: center;">${confBadge}</td>
        <td>${origBadge}</td>
        <td><span class="badge-empresa-pill">${escapeHtml(empLabel)}</span></td>
        <td>
          <strong style="font-family: 'JetBrains Mono', monospace;">${escapeHtml(item.documento)}</strong>
          <br><small style="color: var(--text-muted);">${escapeHtml(item.status)} • ${escapeHtml(item.data)}</small>
        </td>
        <td>${contatoHtml}</td>
        <td>${vendedorHtml}</td>
        <td style="text-align: right;">${valorHtml}</td>
        <td style="text-align: center;">${acoesHtml}</td>
      `;

      // Event listener para copiar resumo do candidato
      const btnCopiar = tr.querySelector('.btn-copiar-candidato');
      if (btnCopiar) {
        btnCopiar.addEventListener('click', () => {
          copiarResumoCandidato(item);
        });
      }

      elTableBody.appendChild(tr);
    });
  }

  /**
   * Copia os dados do candidato de forma legível para o assistente colar no WhatsApp ou Protheus
   */
  function copiarResumoCandidato(item) {
    const texto = [
      `🔍 [PAGAMENTO IDENTIFICADO]`,
      `• Origem: ${item.origemLabel} (${item.empresaNome || item.empresa})`,
      `• Documento: ${item.documento}`,
      `• Cliente: ${item.cliente}${item.cpfCnpj ? ' (Doc: ' + item.cpfCnpj + ')' : ''}`,
      `• Vendedor/Responsável: ${item.vendedor || 'Vendedor Comercial'}`,
      `• Valor: ${formatCurrency(item.valorMatch)}`,
      `• Status: ${item.status}`,
      item.data && item.data !== '-' ? `• Data: ${item.data}` : '',
      item.link ? `• Link: ${item.link}` : ''
    ].filter(Boolean).join('\n');

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(texto).then(() => {
        alert('✅ Dados do candidato copiados com sucesso para a área de transferência!');
      }).catch(() => {
        prompt('Copie os dados abaixo:', texto);
      });
    } else {
      prompt('Copie os dados abaixo:', texto);
    }
  }

  /**
   * Limpa formulário e restaura estado inicial
   */
  function limparFiltros() {
    obterElementos();
    if (elValor) elValor.value = '';
    if (elTermo) elTermo.value = '';
    if (elEmpresa) elEmpresa.value = 'ALL';

    estado.resultados = [];
    estado.resumo = null;
    estado.filtroOrigemAtivo = 'TODAS';
    estado.filtroConfiancaAtivo = 'TODAS';

    if (elResultsSection) elResultsSection.classList.add('hidden');
    if (elEmptyState) elEmptyState.classList.add('hidden');
    if (elLoadingState) elLoadingState.classList.add('hidden');
    if (elIdleState) elIdleState.classList.remove('hidden');

    atualizarVisualChips();
  }

  function atualizarVisualChips() {
    if (elChipsOrigem) {
      elChipsOrigem.forEach(btn => {
        const isAtivo = btn.getAttribute('data-origem') === estado.filtroOrigemAtivo;
        btn.classList.toggle('active', isAtivo);
        btn.setAttribute('aria-pressed', isAtivo ? 'true' : 'false');
      });
    }

    if (elChipsConfianca) {
      elChipsConfianca.forEach(btn => {
        const isAtivo = btn.getAttribute('data-confianca') === estado.filtroConfiancaAtivo;
        btn.classList.toggle('active', isAtivo);
        btn.setAttribute('aria-pressed', isAtivo ? 'true' : 'false');
      });
    }
  }

  /**
   * Analisa texto colado que corresponda a uma linha de extrato bancário
   */
  function parsearLinhaExtratoFront(raw) {
    if (!raw) return { valorStr: '', pagador: '' };
    let s = String(raw).trim();

    // 1. Extração de valor monetário
    let valorStr = '';
    const regexValorFim = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})\s*$/i;
    const matchValorFim = s.match(regexValorFim);
    if (matchValorFim) {
      valorStr = matchValorFim[1];
      s = s.slice(0, matchValorFim.index).trim();
    } else {
      const matchValorRs = s.match(/R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+\.\d{2})/i);
      if (matchValorRs) {
        valorStr = matchValorRs[1];
        s = s.replace(matchValorRs[0], ' ').trim();
      }
    }

    // 2. Remove datas em qualquer posição
    s = s.replace(/\b\d{2}\/\d{2}\/\d{2,4}\b/g, ' ');

    // 3. Remove termos operacionais bancários
    const termosOperacionais = [
      /\b(CR[EÉ]DITO|D[EÉ]BITO)(\s+EM\s+CONTA(\s+CORRENTE)?)?\b/gi,
      /\b(PIX\s*(RECEBIDO|TRANSF(ERENCIA)?|ENVIADO)?|PAGTO\s+PIX|RECEBIMENTO\s+PIX)\b/gi,
      /\b(TED(\s+REMET(ENTE)?)?|DOC)\b/gi,
      /\b(TRANSF(ER[EÊ]NCIA)?(\s+ELET\s+DISP)?|TRANSF\.)(\s+(RECEBID[AO]|ENVIAD[AO]))?\b/gi,
      /\b(TRANSFER[EÊ]NCIA\s+(RECEBIDA|ENVIADA)|TRANSF\s+(RECEBIDA|ENVIADA))\b/gi,
      /\b(BOLETO(\s+DE\s+COBRAN[CÇ]A)?|BOL\.?)(\s+(RECEBIDO|EMITIDO|PAGO))?\b/gi,
      /\b(PAGTO|PAGAMENTO|LIQUIDA[CÇ][AÃ]O)(\s+(EFETUADO|RECEBIDO))?\b/gi,
      /\b(DEPOSITO|DEPÓSITO|DEP)\b\.?(\s+(EM\s+CONTA|DINHEIRO|EM\s+DINHEIRO|IDENTIFICADO|ONLINE))?\b/gi,
      /\b(RECEBID[AO]|ENVIAD[AO]|EFETUAD[AO]|EMITID[AO])\b/gi
    ];
    for (const regex of termosOperacionais) {
      s = s.replace(regex, ' ');
    }

    // 4. Remove códigos de roteamento bancário, agência e conta
    s = s.replace(/\b\d{3}\s+\d{1,5}\s+\d{4,12}\b/g, ' ');
    s = s.replace(/\b\d{5}\s+\d{6,12}\b/g, ' ');
    s = s.replace(/Cp\s*:\s*\d+[-:]\s*/gi, ' ');
    s = s.replace(/\b\d{3}\/\d{10,15}\b/g, ' ');

    // 5. Remove pontuações e caracteres residuais
    s = s.replace(/["'“”«»]/g, ' ');
    s = s.replace(/[:;]/g, ' ');
    s = s.replace(/(?:^|\s+)-\s*/g, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    s = s.replace(/^[^\wÀ-ÿ/]+|[^\wÀ-ÿ/]+$/g, '').trim();

    return { valorStr, pagador: s };
  }

  function tratarPasteExtrato(e) {
    const clipboardText = (e.clipboardData || window.clipboardData)?.getData('text');
    if (!clipboardText) return;

    const raw = clipboardText.trim();
    const temMultiplosEspacos = /[\t\r\n]|\s{2,}/.test(raw);
    const temData = /\b\d{2}\/\d{2}\/\d{2,4}\b/.test(raw);
    const temValor = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/i.test(raw);

    if ((temMultiplosEspacos || temData) && temValor) {
      e.preventDefault();
      const parsed = parsearLinhaExtratoFront(raw);
      if (elValor && parsed.valorStr) {
        const fmt = formatarNumeroBRL(parsed.valorStr);
        elValor.value = fmt || parsed.valorStr;
      }
      if (elTermo && parsed.pagador) {
        elTermo.value = parsed.pagador;
      }
    }
  }

  /**
   * Sanitiza o campo de valor do depósito, aceitando apenas dígitos, ponto e vírgula
   */
  function sanitizarInputValor(input) {
    if (!input) return;
    const valor = input.value;
    if (!valor) return;

    // Remove qualquer caractere que não seja dígito, vírgula ou ponto
    let limpo = valor.replace(/[^\d,\.]/g, '');

    // Garante no máximo uma vírgula como separador decimal
    const partesVirgula = limpo.split(',');
    if (partesVirgula.length > 2) {
      limpo = partesVirgula[0] + ',' + partesVirgula.slice(1).join('').replace(/,/g, '');
    }

    // Se houver vírgula, não permite pontos após a vírgula decimal
    if (limpo.includes(',')) {
      const idxVirgula = limpo.indexOf(',');
      const antes = limpo.substring(0, idxVirgula);
      const depois = limpo.substring(idxVirgula + 1).replace(/\./g, '');
      limpo = antes + ',' + depois;
    }

    if (input.value !== limpo) {
      input.value = limpo;
    }
  }

  /**
   * Bloqueia ativamente no evento keydown qualquer caractere que não seja reconhecido como número
   * (letras, caracteres especiais @#$%, espaços), permitindo apenas teclas de controle e navegação
   */
  function impedirTeclasInvalidasValor(e) {
    // Teclas de controle e navegação do teclado permitidas
    const teclasPermitidas = [
      'Backspace', 'Delete', 'Tab', 'Escape', 'Enter',
      'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
      'Home', 'End'
    ];
    if (teclasPermitidas.includes(e.key)) return;

    // Atalhos do sistema (Ctrl/Cmd + C, V, A, Z, X, etc.)
    if (e.ctrlKey || e.metaKey) return;

    // Dígitos de 0 a 9 permitidos
    if (/^\d$/.test(e.key)) return;

    // Vírgula decimal permitida (somente uma vírgula no campo)
    if (e.key === ',') {
      const input = e.target;
      const selStart = input.selectionStart || 0;
      const selEnd = input.selectionEnd || 0;
      const textoSelecionado = input.value.substring(selStart, selEnd);
      // Se não tem vírgula ou se a vírgula existente está selecionada para substituição
      if (!input.value.includes(',') || textoSelecionado.includes(',')) {
        return;
      }
      e.preventDefault();
      return;
    }

    // Ponto permitido (separador de milhar ou antes da vírgula)
    if (e.key === '.') {
      const input = e.target;
      const selStart = input.selectionStart || 0;
      const idxVirgula = input.value.indexOf(',');
      // Não permite ponto após a vírgula decimal
      if (idxVirgula !== -1 && selStart > idxVirgula) {
        e.preventDefault();
        return;
      }
      return;
    }

    // Bloqueia qualquer outra tecla (letras, caracteres especiais, espaço)
    e.preventDefault();
  }

  /**
   * Trata a colagem direta no campo de valor, filtrando letras e símbolos
   * mas aceitando números com ou sem 'R$' e separadores (ex: 1.222,33 ou 1222,33)
   */
  function tratarPasteValor(e) {
    const clipboardText = (e.clipboardData || window.clipboardData)?.getData('text');
    if (!clipboardText) return;

    const raw = clipboardText.trim();
    const temMultiplosEspacos = /[\t\r\n]|\s{2,}/.test(raw);
    const temData = /\b\d{2}\/\d{2}\/\d{2,4}\b/.test(raw);
    const temValor = /(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/i.test(raw);

    // Se for linha de extrato bancário com data ou múltiplos espaços, o tratarPasteExtrato vai gerenciar
    if ((temMultiplosEspacos || temData) && temValor) {
      return;
    }

    e.preventDefault();
    // Extrai padrão numérico limpo da string colada
    const match = raw.match(/(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+\.\d{2}|\d+)/i);
    if (match) {
      e.target.value = match[1];
    } else {
      const limpo = raw.replace(/[^\d,\.]/g, '');
      if (limpo) {
        e.target.value = limpo;
      }
    }
    sanitizarInputValor(e.target);
  }

  /**
   * Formata automaticamente o valor para o padrão BRL (ex: 1.222,33) ao perder o foco (blur)
   */
  function formatarAoPerderFocoValor(e) {
    const input = e.target;
    if (!input || !input.value.trim()) return;
    sanitizarInputValor(input);
    const formatado = formatarNumeroBRL(input.value);
    if (formatado) {
      input.value = formatado;
    }
  }

  let moduleInitialized = false;

  /**
   * Inicializa os event listeners do módulo
   */
  function initModule() {
    obterElementos();
    if (moduleInitialized) return;

    if (btnBuscar) {
      btnBuscar.addEventListener('click', executarBusca);
    }

    if (btnLimpar) {
      btnLimpar.addEventListener('click', limparFiltros);
    }

    // Enter nos inputs para busca rápida
    [elValor, elTermo].forEach(input => {
      if (input) {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            executarBusca();
          }
        });
        input.addEventListener('paste', tratarPasteExtrato);
      }
    });

    // Validação estrita, bloqueio de teclas não numéricas e formatação do campo Valor do Depósito
    if (elValor) {
      elValor.addEventListener('keydown', impedirTeclasInvalidasValor);
      elValor.addEventListener('input', () => sanitizarInputValor(elValor));
      elValor.addEventListener('paste', tratarPasteValor);
      elValor.addEventListener('blur', formatarAoPerderFocoValor);
    }

    // Chips de Origem
    if (elChipsOrigem) {
      elChipsOrigem.forEach(btn => {
        btn.addEventListener('click', () => {
          estado.filtroOrigemAtivo = btn.getAttribute('data-origem') || 'TODAS';
          atualizarVisualChips();
          renderizarTabela();
        });
      });
    }

    // Chips de Confiança
    if (elChipsConfianca) {
      elChipsConfianca.forEach(btn => {
        btn.addEventListener('click', () => {
          estado.filtroConfiancaAtivo = btn.getAttribute('data-confianca') || 'TODAS';
          atualizarVisualChips();
          renderizarTabela();
        });
      });
    }

    // Inicializa estado visual e acessibilidade aria-pressed dos chips
    atualizarVisualChips();
    moduleInitialized = true;
  }

  // Exportação para o ciclo de vida global de abas
  window.initPgtosDesconhecidos = initModule;
  window.formatarNumeroBRLPgtos = formatarNumeroBRL;
  window.sanitizarInputValorPgtos = sanitizarInputValor;
  window.impedirTeclasInvalidasValorPgtos = impedirTeclasInvalidasValor;

  /**
   * API PÚBLICA GLOBAL:
   * Permite navegação direta a partir da Conciliação Bancária com preenchimento instantâneo
   */
  window.abrirLocalizadorPgtosDesconhecidos = function ({ empresa, valor, termo } = {}) {
    obterElementos();

    // 1. Alterna visualmente para a macro-área Financeiro e sub-aba Pgtos Desconhecidos
    const subBtnPgtos = document.getElementById('btnTabPgtosDesconhecidos');
    if (subBtnPgtos) {
      subBtnPgtos.click();
    } else {
      const tabPane = document.getElementById('tab-pgtos-desconhecidos');
      if (tabPane) {
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
        tabPane.classList.remove('hidden');
      }
    }

    // 2. Preenche os campos
    if (elEmpresa && empresa) elEmpresa.value = empresa;
    if (elValor && (valor !== null && valor !== undefined)) {
      const strVal = typeof valor === 'number' ? valor.toFixed(2) : String(valor);
      const fmt = formatarNumeroBRL(strVal);
      elValor.value = fmt || strVal;
    }
    if (elTermo && termo) elTermo.value = String(termo).trim();

    // 3. Executa a busca automaticamente
    setTimeout(() => {
      executarBusca();
    }, 150);
  };

  // Auto-inicialização quando o DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initModule);
  } else {
    initModule();
  }
})();
