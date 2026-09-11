/**
 * Módulo Frontend: NFS-e Pendentes de Entrada & Conciliação Protheus
 * Aba: 📑 ANALISTA FIN ➔ 🧾 NFS-e Pendentes
 * Gemini-Cli (v8.190)
 */

(function () {
  'use strict';

  // Estado do Módulo
  let nfseData = [];
  let nfseFiltradas = [];
  let kpisData = {};
  let colunaOrdenacao = 'dataEmissao';
  let direcaoOrdenacao = 'asc'; // Padrão: mais antigo para o mais novo
  let confettiAnimationId = null;

  // Mapa de Metadados por Empresa
  const EMPRESAS_BADGE = {
    '15': { sigla: 'GSI BW', classe: 'badge-gsi', cor: '#38bdf8', bg: 'rgba(56, 189, 248, 0.15)' },
    '14': { sigla: 'Metal Pleno', classe: 'badge-mp', cor: '#c084fc', bg: 'rgba(168, 85, 247, 0.15)' },
    '16': { sigla: 'OAÇO', classe: 'badge-oaco', cor: '#facc15', bg: 'rgba(234, 179, 8, 0.15)' }
  };

  /**
   * Helper de Token e Autenticação
   */
  function getToken() {
    return localStorage.getItem('token') || sessionStorage.getItem('token') || '';
  }

  async function apiFetch(url, options = {}) {
    const token = getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      const text = await res.text();
      let errJson;
      try { errJson = JSON.parse(text); } catch (e) {}
      throw new Error(errJson?.error || `Erro HTTP ${res.status}: ${text}`);
    }
    return res.json();
  }

  /**
   * Formatação de Datas e Valores Monetários
   */
  function formatarMoeda(val) {
    const num = parseFloat(val) || 0;
    return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function formatarDataBR(isoStr) {
    if (!isoStr) return '-';
    const partes = String(isoStr).slice(0, 10).split('-');
    if (partes.length === 3) {
      return `${partes[2]}/${partes[1]}/${partes[0]}`;
    }
    return String(isoStr);
  }

  function formatarCnpj(cnpj) {
    const c = String(cnpj || '').replace(/\D/g, '');
    if (c.length === 14) {
      return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    }
    return c;
  }

  /**
   * Animação Leve de Confetes / Serpentinas em Micro-Canvas Puro
   */
  function dispararConfetesElegantes() {
    const canvas = document.getElementById('nfseConfettiCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (confettiAnimationId) {
      cancelAnimationFrame(confettiAnimationId);
      confettiAnimationId = null;
    }

    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width || canvas.parentElement?.clientWidth || 800;
    canvas.height = 320;

    const colors = ['#38bdf8', '#34d399', '#fbbf24', '#f43f5e', '#a855f7', '#ffffff'];
    const confettiCount = 60;
    const confettis = [];

    for (let i = 0; i < confettiCount; i++) {
      confettis.push({
        x: Math.random() * canvas.width,
        y: Math.random() * -canvas.height * 0.5,
        w: Math.random() * 8 + 4,
        h: Math.random() * 5 + 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        vx: (Math.random() - 0.5) * 3,
        vy: Math.random() * 2.5 + 2,
        rot: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 6,
        opacity: 1
      });
    }

    let startTime = performance.now();
    const duration = 3800; // 3.8 segundos

    function loop(now) {
      const elapsed = now - startTime;
      if (elapsed > duration) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        confettiAnimationId = null;
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const fadeRatio = elapsed > duration * 0.7 ? 1 - (elapsed - duration * 0.7) / (duration * 0.3) : 1;

      for (const c of confettis) {
        c.x += c.vx;
        c.y += c.vy;
        c.rot += c.rotSpeed;

        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate((c.rot * Math.PI) / 180);
        ctx.fillStyle = c.color;
        ctx.globalAlpha = Math.max(0, fadeRatio);
        ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
        ctx.restore();

        if (c.y > canvas.height) {
          c.y = -10;
          c.x = Math.random() * canvas.width;
        }
      }

      confettiAnimationId = requestAnimationFrame(loop);
    }

    confettiAnimationId = requestAnimationFrame(loop);
  }

  /**
   * Inicialização de Datas Padrão (Últimos 120 Dias)
   */
  function definirDatasPadrao() {
    const hoje = new Date();
    const inputAte = document.getElementById('filtroNfseAte');
    const inputDe = document.getElementById('filtroNfseDe');

    if (inputAte) {
      inputAte.value = hoje.toISOString().slice(0, 10);
    }
    if (inputDe) {
      const data120 = new Date(hoje.getTime() - 120 * 24 * 60 * 60 * 1000);
      inputDe.value = data120.toISOString().slice(0, 10);
    }
  }

  /**
   * Carrega os Dados da API
   */
  async function carregarNfse() {
    const tbody = document.getElementById('tbodyNfsePendentes');
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 2.5rem;">
            ⏳ Carregando notas fiscais de serviço...
          </td>
        </tr>
      `;
    }

    const empresa = document.getElementById('filtroNfseEmpresa')?.value || 'todas';
    const de = document.getElementById('filtroNfseDe')?.value || '';
    const ate = document.getElementById('filtroNfseAte')?.value || '';
    const status = document.getElementById('filtroNfseStatus')?.value || 'PENDENTE';

    try {
      const params = new URLSearchParams({ empresa, de, ate, status });
      const res = await apiFetch(`/api/analista-fin/nfse/pendentes?${params.toString()}`);

      nfseData = res.notas || [];
      kpisData = res.kpis || {};

      atualizarKpis(kpisData);
      aplicarBuscaEOrdenacao();
    } catch (err) {
      console.error('Erro ao carregar NFS-e:', err);
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="7" style="text-align: center; color: #f87171; padding: 2.5rem;">
              ⚠️ Erro ao carregar notas fiscais de serviço: ${err.message}
            </td>
          </tr>
        `;
      }
    }
  }

  /**
   * Atualiza os Cards de KPIs no topo
   */
  function atualizarKpis(kpis) {
    const totalElem = document.getElementById('kpiNfsePendentesTotal');
    const valorElem = document.getElementById('kpiNfseValorTotal');

    const gsiQtd = document.getElementById('kpiNfseGsiQtd');
    const gsiVal = document.getElementById('kpiNfseGsiValor');

    const mpQtd = document.getElementById('kpiNfseMpQtd');
    const mpVal = document.getElementById('kpiNfseMpValor');

    const oacoQtd = document.getElementById('kpiNfseOacoQtd');
    const oacoVal = document.getElementById('kpiNfseOacoValor');

    if (totalElem) totalElem.textContent = kpis.totalPendentes || 0;
    if (valorElem) valorElem.textContent = formatarMoeda(kpis.valorTotalPendente || 0);

    const pe = kpis.porEmpresa || {};
    if (gsiQtd) gsiQtd.textContent = pe['15']?.count || 0;
    if (gsiVal) gsiVal.textContent = formatarMoeda(pe['15']?.valor || 0);

    if (mpQtd) mpQtd.textContent = pe['14']?.count || 0;
    if (mpVal) mpVal.textContent = formatarMoeda(pe['14']?.valor || 0);

    if (oacoQtd) oacoQtd.textContent = pe['16']?.count || 0;
    if (oacoVal) oacoVal.textContent = formatarMoeda(pe['16']?.valor || 0);
  }

  /**
   * Aplica Busca Rápida e Ordenação por Coluna
   */
  function aplicarBuscaEOrdenacao() {
    const termoBusca = (document.getElementById('filtroNfseBusca')?.value || '').toLowerCase().trim();

    // 1. Filtragem por texto
    nfseFiltradas = nfseData.filter(n => {
      if (!termoBusca) return true;
      const numero = String(n.numero_nota || '').toLowerCase();
      const prestador = String(n.prestador_nome || '').toLowerCase();
      const prestCnpj = String(n.prestador_cnpj || '').toLowerCase();
      const muni = String(n.municipio || '').toLowerCase();
      const chave = String(n.chave_acesso || '').toLowerCase();
      const emp = String(n.empresa_nome || '').toLowerCase();

      return numero.includes(termoBusca) ||
             prestador.includes(termoBusca) ||
             prestCnpj.includes(termoBusca) ||
             muni.includes(termoBusca) ||
             chave.includes(termoBusca) ||
             emp.includes(termoBusca);
    });

    // 2. Ordenação
    nfseFiltradas.sort((a, b) => {
      let valA, valB;

      switch (colunaOrdenacao) {
        case 'empresa':
          valA = a.empresa_nome || '';
          valB = b.empresa_nome || '';
          break;
        case 'numero':
          valA = parseInt(String(a.numero_nota).replace(/\D/g, ''), 10) || 0;
          valB = parseInt(String(b.numero_nota).replace(/\D/g, ''), 10) || 0;
          break;
        case 'prestador':
          valA = (a.prestador_nome || '').toLowerCase();
          valB = (b.prestador_nome || '').toLowerCase();
          break;
        case 'valor':
          valA = parseFloat(a.valor_liquido) || 0;
          valB = parseFloat(b.valor_liquido) || 0;
          break;
        case 'dataEmissao':
        default:
          valA = new Date(a.data_emissao || 0).getTime();
          valB = new Date(b.data_emissao || 0).getTime();
          break;
      }

      if (valA < valB) return direcaoOrdenacao === 'asc' ? -1 : 1;
      if (valA > valB) return direcaoOrdenacao === 'asc' ? 1 : -1;
      return 0;
    });

    renderizarTabela();
    verificarEstadoZero();
    atualizarIndicadoresCabecalho();
  }

  /**
   * Renderiza as Linhas da Tabela
   */
  function renderizarTabela() {
    const tbody = document.getElementById('tbodyNfsePendentes');
    if (!tbody) return;

    if (nfseFiltradas.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 3rem 1.5rem;">
            Nenhuma nota fiscal de serviço encontrada para os filtros selecionados.
          </td>
        </tr>
      `;
      return;
    }

    const html = nfseFiltradas.map((n, idx) => {
      const emp = EMPRESAS_BADGE[n.empresa_cod_protheus] || { sigla: n.empresa_nome || 'GSI', cor: '#38bdf8', bg: 'rgba(56, 189, 248, 0.15)' };
      const statusBadge = n.status_entrada === 'LANCADA'
        ? `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; font-weight: 600; padding: 3px 8px; border-radius: 6px;">🟢 Lançada</span>`
        : `<span class="badge" style="background: rgba(244, 63, 94, 0.15); color: #f43f5e; font-weight: 600; padding: 3px 8px; border-radius: 6px;">🟡 Pendente</span>`;

      return `
        <tr style="border-bottom: 1px solid var(--panel-border, #1e293b); transition: background 0.15s ease;" onmouseover="this.style.background='rgba(56,189,248,0.04)'" onmouseout="this.style.background='transparent'">
          <td style="padding: 10px 12px; vertical-align: middle;">
            <span class="badge" style="background: ${emp.bg}; color: ${emp.cor}; font-weight: 700; padding: 4px 8px; border-radius: 6px; font-size: 0.78rem;">
              ${emp.sigla} (${n.empresa_cod_protheus})
            </span>
          </td>
          <td style="padding: 10px 12px; vertical-align: middle;">
            <strong style="font-family: var(--font-mono, monospace); font-size: 0.9rem; color: #f8fafc;">
              ${n.numero_nota || '0'}
            </strong>
          </td>
          <td style="padding: 10px 12px; vertical-align: middle;">
            <div style="font-weight: 600; color: #f1f5f9; line-height: 1.25; font-size: 0.85rem;">
              ${n.prestador_nome || 'Prestador Desconhecido'}
            </div>
            <div style="font-size: 0.75rem; color: var(--text-muted, #94a3b8); font-family: var(--font-mono, monospace); margin-top: 2px;">
              CNPJ: ${formatarCnpj(n.prestador_cnpj)}
            </div>
          </td>
          <td style="padding: 10px 12px; vertical-align: middle; color: #cbd5e1; font-size: 0.85rem;">
            ${formatarDataBR(n.data_emissao)}
          </td>
          <td style="padding: 10px 12px; vertical-align: middle; text-align: right;">
            <strong style="font-family: var(--font-mono, monospace); color: #34d399; font-size: 0.95rem;">
              ${formatarMoeda(n.valor_liquido)}
            </strong>
          </td>
          <td style="padding: 10px 12px; vertical-align: middle; text-align: center;">
            ${statusBadge}
          </td>
          <td style="padding: 10px 12px; vertical-align: middle; text-align: center;">
            <button class="btn btn-outline btn-sm btn-ver-detalhes-nfse" data-index="${idx}" style="padding: 4px 8px; font-size: 0.75rem; gap: 4px;" title="Ver detalhes completos da nota">
              🔍 Detalhes
            </button>
          </td>
        </tr>
      `;
    }).join('');

    tbody.innerHTML = html;

    // Conecta botões de detalhes
    tbody.querySelectorAll('.btn-ver-detalhes-nfse').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(btn.getAttribute('data-index'), 10);
        const nota = nfseFiltradas[index];
        if (nota) abrirModalDetalhes(nota);
      });
    });
  }

  /**
   * Estado Zero / Celebração quando a analista financeira zerar todas as pendências
   */
  function verificarEstadoZero() {
    const cardZero = document.getElementById('nfseZeroPendenciasCard');
    const tableContainer = document.getElementById('nfseTabelaContainer');
    const statusFiltro = document.getElementById('filtroNfseStatus')?.value || 'PENDENTE';

    const temPendencias = (kpisData.totalPendentes || 0) > 0;

    if (!temPendencias && statusFiltro === 'PENDENTE') {
      if (cardZero) cardZero.style.display = 'block';
      dispararConfetesElegantes();
    } else {
      if (cardZero) cardZero.style.display = 'none';
    }
  }

  /**
   * Atualiza as setinhas nos cabeçalhos ordenáveis
   */
  function atualizarIndicadoresCabecalho() {
    document.querySelectorAll('#tableNfsePendentes .sortable-th').forEach(th => {
      const col = th.getAttribute('data-col');
      const indicator = th.querySelector('.sort-indicator');
      if (col === colunaOrdenacao) {
        th.classList.add('active-sort');
        if (indicator) {
          indicator.textContent = direcaoOrdenacao === 'asc' ? '▲' : '▼';
          indicator.style.color = '#38bdf8';
          indicator.style.opacity = '1';
        }
      } else {
        th.classList.remove('active-sort');
        if (indicator) {
          indicator.textContent = '↕';
          indicator.style.color = 'inherit';
          indicator.style.opacity = '0.4';
        }
      }
    });
  }

  /**
   * Alterna a Ordenação por Coluna
   */
  function alternarOrdenacao(col) {
    if (colunaOrdenacao === col) {
      direcaoOrdenacao = direcaoOrdenacao === 'asc' ? 'desc' : 'asc';
    } else {
      colunaOrdenacao = col;
      // Para data, asc = mais antigo primeiro (padrão solicitado)
      // Para valor, desc = maior valor primeiro
      direcaoOrdenacao = (col === 'valor') ? 'desc' : 'asc';
    }
    aplicarBuscaEOrdenacao();
  }

  /**
   * Abre o Modal de Detalhes da NFS-e
   */
  function abrirModalDetalhes(nota) {
    const modal = document.getElementById('modalNfseDetalhes');
    if (!modal) return;

    const numHeader = document.getElementById('modalNfseNumeroHeader');
    const empHeader = document.getElementById('modalNfseEmpresaHeader');
    const chaveElem = document.getElementById('modalNfseChave');
    const prestadorNome = document.getElementById('modalNfsePrestadorNome');
    const prestadorCnpj = document.getElementById('modalNfsePrestadorCnpj');
    const valorElem = document.getElementById('modalNfseValor');
    const emissaoElem = document.getElementById('modalNfseEmissao');
    const muniElem = document.getElementById('modalNfseMunicipio');
    const descElem = document.getElementById('modalNfseDescricao');
    const protheusBox = document.getElementById('modalNfseProtheusBox');
    const protheusDetalhes = document.getElementById('modalNfseProtheusDetalhes');

    if (numHeader) numHeader.textContent = `#${nota.numero_nota || '0'}`;
    if (empHeader) empHeader.textContent = `Empresa: ${nota.empresa_nome} (${nota.empresa_cod_protheus}) | CNPJ: ${formatarCnpj(nota.empresa_cnpj)}`;
    if (chaveElem) chaveElem.textContent = nota.chave_acesso || '-';
    if (prestadorNome) prestadorNome.textContent = nota.prestador_nome || '-';
    if (prestadorCnpj) prestadorCnpj.textContent = `CNPJ: ${formatarCnpj(nota.prestador_cnpj)}`;
    if (valorElem) valorElem.textContent = formatarMoeda(nota.valor_liquido);
    if (emissaoElem) emissaoElem.textContent = `Emitida em: ${formatarDataBR(nota.data_emissao)}`;
    if (muniElem) muniElem.textContent = nota.municipio || 'Não informado no XML';
    if (descElem) descElem.textContent = nota.descricao || 'Sem descrição informada.';

    if (protheusDetalhes) {
      if (nota.status_entrada === 'LANCADA') {
        protheusDetalhes.innerHTML = `
          <div style="color: #34d399; font-weight: 600; margin-bottom: 4px;">
            🟢 Lançada no Protheus (Nota Fiscal de Entrada SF1)
          </div>
          <div>Documento: <strong>${nota.protheus_doc || '-'}</strong> | Emissão Protheus: <strong>${formatarDataBR(nota.protheus_emissao)}</strong></div>
          <div>Fornecedor Protheus: <strong>${nota.protheus_fornece || '-'}/${nota.protheus_loja || '-'}</strong> | Valor: <strong>${formatarMoeda(nota.protheus_valbrut)}</strong></div>
        `;
        if (protheusBox) protheusBox.style.borderLeftColor = '#10b981';
      } else {
        protheusDetalhes.innerHTML = `
          <div style="color: #f43f5e; font-weight: 600; margin-bottom: 4px;">
            🟡 Pendente de Entrada
          </div>
          <div>Esta nota fiscal ainda não foi localizada nas tabelas de entrada SF1 do Protheus.</div>
        `;
        if (protheusBox) protheusBox.style.borderLeftColor = '#f43f5e';
      }
    }

    modal.style.display = 'flex';
    modal.classList.remove('hidden');
  }

  function fecharModalDetalhes() {
    const modal = document.getElementById('modalNfseDetalhes');
    if (modal) {
      modal.style.display = 'none';
      modal.classList.add('hidden');
    }
  }

  /**
   * Sincronização Sob Demanda com o Protheus ERP
   */
  async function sincronizarProtheus() {
    const btn = document.getElementById('btnSyncNfseProtheus');
    const icon = document.getElementById('syncNfseIcon');
    const label = document.getElementById('syncNfseLabel');

    if (btn) btn.disabled = true;
    if (icon) {
      icon.style.display = 'inline-block';
      icon.style.animation = 'spin 1s linear infinite';
    }
    if (label) label.textContent = 'Consultando Protheus...';

    try {
      const res = await apiFetch('/api/analista-fin/nfse/sincronizar', {
        method: 'POST',
        body: JSON.stringify({ dias: 150 })
      });

      if (typeof window.showNotification === 'function') {
        window.showNotification(`Sincronização concluída: ${res.totalAvaliado} notas avaliadas (${res.lancadas} lançadas, ${res.pendentes} pendentes).`, 'success');
      }

      await carregarNfse();
    } catch (err) {
      console.error('Erro na sincronização:', err);
      if (typeof window.showNotification === 'function') {
        window.showNotification(`Erro ao sincronizar com o Protheus: ${err.message}`, 'error');
      } else {
        alert(`Erro na sincronização: ${err.message}`);
      }
    } finally {
      if (btn) btn.disabled = false;
      if (icon) {
        icon.style.animation = 'none';
      }
      if (label) label.textContent = 'Sincronizar Protheus';
    }
  }

  /**
   * Exportação para CSV compatível com Excel (BOM UTF-8 + ;)
   */
  function exportarCsv() {
    if (nfseFiltradas.length === 0) {
      alert('Nenhuma nota para exportar.');
      return;
    }

    const headers = [
      'Empresa Filial',
      'Empresa Nome',
      'Número da Nota',
      'Data de Emissão',
      'CNPJ Prestador',
      'Prestador / Fornecedor',
      'Valor Líquido (R$)',
      'Status Entrada',
      'Documento Protheus',
      'Município',
      'Chave de Acesso'
    ];

    const escapeCsv = (str) => {
      const s = String(str || '').replace(/"/g, '""');
      return `"${s}"`;
    };

    const rows = nfseFiltradas.map(n => [
      escapeCsv(n.empresa_cod_protheus),
      escapeCsv(n.empresa_nome),
      escapeCsv(n.numero_nota),
      escapeCsv(formatarDataBR(n.data_emissao)),
      escapeCsv(n.prestador_cnpj),
      escapeCsv(n.prestador_nome),
      escapeCsv((parseFloat(n.valor_liquido) || 0).toFixed(2).replace('.', ',')),
      escapeCsv(n.status_entrada),
      escapeCsv(n.protheus_doc || ''),
      escapeCsv(n.municipio || ''),
      escapeCsv(n.chave_acesso)
    ].join(';'));

    const csvContent = '\uFEFF' + [headers.join(';'), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `nfse_pendentes_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /**
   * Vincula Listeners de Eventos
   */
  function vincularEventos() {
    // 1. Botão Filtrar
    document.getElementById('btnFiltrarNfse')?.addEventListener('click', () => {
      carregarNfse();
    });

    // 2. Botão Restaurar Padrão 120 Dias
    document.getElementById('btnResetFiltrosNfse')?.addEventListener('click', () => {
      definirDatasPadrao();
      const selEmpresa = document.getElementById('filtroNfseEmpresa');
      const selStatus = document.getElementById('filtroNfseStatus');
      const inputBusca = document.getElementById('filtroNfseBusca');

      if (selEmpresa) selEmpresa.value = 'todas';
      if (selStatus) selStatus.value = 'PENDENTE';
      if (inputBusca) inputBusca.value = '';

      carregarNfse();
    });

    // 3. Mudança reativa de dropdowns
    document.getElementById('filtroNfseEmpresa')?.addEventListener('change', () => carregarNfse());
    document.getElementById('filtroNfseStatus')?.addEventListener('change', () => carregarNfse());

    // 4. Busca instantânea (filtro local sem refetch)
    document.getElementById('filtroNfseBusca')?.addEventListener('input', () => {
      aplicarBuscaEOrdenacao();
    });
    document.getElementById('btnClearBuscaNfse')?.addEventListener('click', () => {
      const input = document.getElementById('filtroNfseBusca');
      if (input) {
        input.value = '';
        aplicarBuscaEOrdenacao();
      }
    });

    // 5. Clique nas colunas para ordenação
    document.querySelectorAll('#tableNfsePendentes .sortable-th').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.getAttribute('data-col');
        if (col) alternarOrdenacao(col);
      });
    });

    // 6. Botão Sincronizar Protheus
    document.getElementById('btnSyncNfseProtheus')?.addEventListener('click', () => {
      sincronizarProtheus();
    });

    // 7. Botão Exportar CSV
    document.getElementById('btnExportarNfseCsv')?.addEventListener('click', () => {
      exportarCsv();
    });

    // 8. Botão Celebrar Novamente
    document.getElementById('btnReplayConfettiNfse')?.addEventListener('click', () => {
      dispararConfetesElegantes();
    });

    // 9. Fechar Modal de Detalhes
    document.getElementById('btnFecharModalNfseX')?.addEventListener('click', fecharModalDetalhes);
    document.getElementById('btnFecharModalNfseFooter')?.addEventListener('click', fecharModalDetalhes);
    document.getElementById('modalNfseDetalhes')?.addEventListener('click', (e) => {
      if (e.target.id === 'modalNfseDetalhes') fecharModalDetalhes();
    });

    // 10. Copiar Chave de Acesso
    document.getElementById('btnCopiarChaveNfse')?.addEventListener('click', () => {
      const chave = document.getElementById('modalNfseChave')?.textContent;
      if (chave) {
        navigator.clipboard.writeText(chave).then(() => {
          const btn = document.getElementById('btnCopiarChaveNfse');
          if (btn) {
            const originalText = btn.innerHTML;
            btn.innerHTML = '✅ Copiado!';
            setTimeout(() => { btn.innerHTML = originalText; }, 2000);
          }
        }).catch(err => console.warn('Erro ao copiar chave:', err));
      }
    });
  }

  /**
   * Ponto de Entrada do Módulo
   */
  let inicializado = false;
  function init() {
    if (!inicializado) {
      definirDatasPadrao();
      vincularEventos();
      inicializado = true;
    }
    carregarNfse();
  }

  // Exporta para escopo global da aplicação
  window.nfsePendentesModule = {
    init,
    inicializar: init,
    carregarNfse,
    carregarDados: carregarNfse,
    alternarOrdenacao,
    ordenarPor: alternarOrdenacao,
    sincronizarProtheus,
    exportarCsv,
    dispararConfetesElegantes
  };

})();
