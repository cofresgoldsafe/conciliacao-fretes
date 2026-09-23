/**
 * public/js/logistica_xml_faturamento.js
 * 
 * Módulo de Interface e Automação de XMLs de Faturamento no Google Drive:
 * 1. Manipulação direta do sistema de arquivos via File System Access API (showDirectoryPicker).
 * 2. Persistência e reidratação do directoryHandle no IndexedDB com suporte a troca a qualquer momento.
 * 3. Roteamento automático de subpastas [EMPRESA] / [MM.ANO] e gravação solta (sem ZIP).
 * 4. Nomenclatura oficial padronizada: [SIGLA]-[NF8]-[CHAVE44]-[CLIENTE6].xml.
 * 5. Fallback para download em ZIP quando solicitado ou em navegadores sem suporte.
 */

import { apiFetch, escapeHtml, formatCurrency, formatDate } from './utils.js';

// Constantes e Estados
const DB_NAME = 'portal_gsi_fs_db';
const STORE_NAME = 'handles_store';
const HANDLE_KEY = 'gdrive_xml_root_handle';
const NOME_PASTA_STORAGE_KEY = 'gdrive_xml_root_name';

let rootDirectoryHandle = null;
let notasFaturamentoCache = [];
let isProcessando = false;
let isInitialized = false;

function getDataBrasiliaIso(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(date);
}

// ============================================================================
// PERSISTÊNCIA NATIVA NO INDEXEDDB
// ============================================================================

function abrirIndexedDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      return reject(new Error('IndexedDB não suportado neste navegador.'));
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

async function salvarHandleIndexedDB(key, handle) {
  try {
    const db = await abrirIndexedDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(handle, key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('⚠️ Falha ao salvar handle no IndexedDB:', err);
    return false;
  }
}

async function recuperarHandleIndexedDB(key) {
  try {
    const db = await abrirIndexedDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('⚠️ Falha ao recuperar handle no IndexedDB:', err);
    return null;
  }
}

async function verificarPermissaoHandle(fileHandle, readWrite = true) {
  if (!fileHandle) return false;
  const options = { mode: readWrite ? 'readwrite' : 'read' };
  try {
    if ((await fileHandle.queryPermission(options)) === 'granted') {
      return true;
    }
    if ((await fileHandle.requestPermission(options)) === 'granted') {
      return true;
    }
  } catch (err) {
    console.warn('⚠️ Permissão negada ou não suportada para o handle:', err);
  }
  return false;
}

// ============================================================================
// GERENCIADOR DE PASTA DO GOOGLE DRIVE
// ============================================================================

async function escolherPastaGoogleDrive() {
  if (!('showDirectoryPicker' in window)) {
    alert('Seu navegador não suporta a gravação direta em pastas locais (File System Access API). Recomendamos utilizar o Google Chrome ou Microsoft Edge.');
    return null;
  }

  try {
    const dirHandle = await window.showDirectoryPicker({
      id: 'gdrive_xml_saidas',
      mode: 'readwrite',
      startIn: 'documents'
    });

    if (dirHandle) {
      rootDirectoryHandle = dirHandle;
      await salvarHandleIndexedDB(HANDLE_KEY, dirHandle);
      localStorage.setItem(NOME_PASTA_STORAGE_KEY, dirHandle.name);
      atualizarIndicadorPastaUI(dirHandle.name);
      return dirHandle;
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.error('Erro ao selecionar pasta:', err);
      alert('Erro ao selecionar pasta: ' + err.message);
    }
  }
  return null;
}

function atualizarIndicadorPastaUI(nomePasta) {
  const lbl = document.getElementById('lblLogXmlPastaDrive');
  if (lbl) {
    if (nomePasta) {
      lbl.innerHTML = `📁 <span style="color: #38bdf8;">${escapeHtml(nomePasta)}</span> (Pasta Pronta para Gravação)`;
    } else {
      lbl.innerHTML = `G:\\Drives compartilhados\\Fiscal e Faturamento\\NF's\\XML's Saídas`;
    }
  }
}

// ============================================================================
// CONSULTA E LISTAGEM DE NOTAS FATURADAS
// ============================================================================

export async function carregarNotasFaturadasLogistica() {
  const empSelect = document.getElementById('selLogXmlEmpresa');
  const deInput = document.getElementById('inputLogXmlDataDe');
  const ateInput = document.getElementById('inputLogXmlDataAte');
  const tbody = document.getElementById('tbodyLogXmlNotas');
  const btnBuscar = document.getElementById('btnLogXmlBuscar');

  const empresa = empSelect ? empSelect.value : 'ALL';
  const dataDe = deInput ? deInput.value : '';
  const dataAte = ateInput ? ateInput.value : '';

  if (!dataDe || !dataAte) {
    alert('Por favor, informe a Data Inicial e a Data Final para consulta.');
    return;
  }

  try {
    if (btnBuscar) {
      btnBuscar.disabled = true;
      btnBuscar.innerHTML = `<span class="spinner" style="width: 14px; height: 14px; display: inline-block; vertical-align: middle; margin-right: 6px;"></span> Buscando...`;
    }
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 2rem; color: #94a3b8;"><div class="spinner" style="margin: 0 auto 0.75rem;"></div>Consultando faturamentos no Protheus...</td></tr>`;
    }

    const qs = new URLSearchParams({
      empresa,
      dataDe: dataDe.replace(/\D/g, ''),
      dataAte: dataAte.replace(/\D/g, '')
    });

    const res = await apiFetch(`/api/logistica/faturamento-notas?${qs.toString()}`);
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Erro ao consultar notas faturadas.');
    }

    notasFaturamentoCache = data.notas || [];
    renderizarTabelaNotasFaturadas(notasFaturamentoCache, data.totais);
  } catch (err) {
    console.error('Falha na consulta de faturamento:', err);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 2rem; color: #ef4444;">❌ Erro ao consultar notas: ${escapeHtml(err.message)}</td></tr>`;
    }
  } finally {
    if (btnBuscar) {
      btnBuscar.disabled = false;
      btnBuscar.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg><span>Localizar Notas</span>`;
    }
  }
}

function renderizarTabelaNotasFaturadas(notas = [], totais = {}) {
  const tbody = document.getElementById('tbodyLogXmlNotas');
  const lblTotal = document.getElementById('lblLogXmlTotalNotas');
  const lblValor = document.getElementById('lblLogXmlValorTotal');
  const lblSel = document.getElementById('lblLogXmlSelecionadas');
  const chkAllHeader = document.getElementById('chkLogXmlSelectAllHeader');
  const chkAll = document.getElementById('chkLogXmlSelectAll');

  if (lblTotal) lblTotal.textContent = notas.length;
  if (lblValor) lblValor.textContent = formatCurrency(totais.valorTotal || 0);
  if (lblSel) lblSel.textContent = notas.length;

  if (!tbody) return;

  if (notas.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 2rem; color: #94a3b8;">ℹ️ Nenhuma nota fiscal de saída localizada para o período e empresa selecionados.</td></tr>`;
    atualizarContadorSelecionadas();
    return;
  }

  const mapBadgesEmpresa = {
    '14': '<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3);">14 - Metal Pleno</span>',
    '15': '<span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #3b82f6; border: 1px solid rgba(59, 130, 246, 0.3);">15 - GSI Brasil</span>',
    '16': '<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);">16 - OAÇO / Cofres</span>'
  };

  const rowsHtml = notas.map((n, idx) => {
    const badgeEmp = mapBadgesEmpresa[n.empresa] || `<span class="badge">${escapeHtml(n.empresa)}</span>`;
    const docPadded = String(n.numeroNf || '').padStart(8, '0');
    const pedInfo = [n.numeroPed ? `Ped: ${n.numeroPed}` : '', n.codWeb ? `Web: ${n.codWeb}` : ''].filter(Boolean).join(' | ') || '-';
    const statusClass = n.statusSefaz === 'CANCELADA' ? 'color: #ef4444; font-weight: 600;' : 'color: #10b981; font-weight: 600;';

    return `
      <tr data-index="${idx}" data-chave="${escapeHtml(n.chaveAcesso)}">
        <td style="text-align: center;">
          <input type="checkbox" class="chk-nota-item" data-index="${idx}" checked />
        </td>
        <td>${badgeEmp}</td>
        <td><strong style="font-family: monospace;">${escapeHtml(docPadded)}</strong> <span style="font-size: 0.75rem; color: #64748b;">(Série ${escapeHtml(n.serie || '1')})</span></td>
        <td>${formatDate(n.dataEmissao)}</td>
        <td style="font-size: 0.85rem; color: #cbd5e1;">${escapeHtml(pedInfo)}</td>
        <td style="font-weight: 500; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(n.clienteRazao || '')}">
          ${escapeHtml(n.clienteRazao || 'Consumidor / Não informado')}
        </td>
        <td style="text-align: right; font-weight: 600; color: #f8fafc;">${formatCurrency(n.valorTotal || 0)}</td>
        <td style="${statusClass}">${escapeHtml(n.statusSefaz || 'AUTORIZADA')}</td>
        <td style="font-family: monospace; font-size: 0.75rem; color: #38bdf8; word-break: break-all;">
          ${escapeHtml(n.nomeArquivo)}
        </td>
      </tr>
    `;
  }).join('');

  tbody.innerHTML = rowsHtml;

  // Eventos de seleção
  const checkboxes = tbody.querySelectorAll('.chk-nota-item');
  checkboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      atualizarContadorSelecionadas();
    });
  });

  if (chkAllHeader) chkAllHeader.checked = true;
  if (chkAll) chkAll.checked = true;
  atualizarContadorSelecionadas();
}

function atualizarContadorSelecionadas() {
  const checkboxes = document.querySelectorAll('.chk-nota-item');
  const selecionadas = Array.from(checkboxes).filter(cb => cb.checked).length;
  const lblSel = document.getElementById('lblLogXmlSelecionadas');
  if (lblSel) lblSel.textContent = selecionadas;

  const btnSalvar = document.getElementById('btnLogXmlSalvarDrive');
  const btnBaixarZip = document.getElementById('btnLogXmlBaixarZip');

  if (btnSalvar) {
    btnSalvar.disabled = isProcessando || selecionadas === 0;
    btnSalvar.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg><span>Salvar ${selecionadas} XMLs na Pasta do Google Drive (Sem Zip)</span>`;
  }
  if (btnBaixarZip) {
    btnBaixarZip.disabled = isProcessando || selecionadas === 0;
  }
}

// ============================================================================
// GRAVAÇÃO DIRETA NO GOOGLE DRIVE (SEM ZIP)
// ============================================================================

export async function salvarXmlsNoGoogleDrive() {
  if (isProcessando) return;

  const checkboxes = document.querySelectorAll('.chk-nota-item:checked');
  if (checkboxes.length === 0) {
    alert('Nenhuma nota fiscal selecionada para gravação.');
    return;
  }

  const indices = Array.from(checkboxes).map(cb => parseInt(cb.dataset.index, 10));
  const notasParaSalvar = indices.map(idx => notasFaturamentoCache[idx]).filter(Boolean);

  // 1. Validação ou solicitação do DirectoryHandle
  if (!rootDirectoryHandle) {
    const handleRecuperado = await recuperarHandleIndexedDB(HANDLE_KEY);
    if (handleRecuperado) {
      const temPermissao = await verificarPermissaoHandle(handleRecuperado, true);
      if (temPermissao) {
        rootDirectoryHandle = handleRecuperado;
      }
    }
  }

  if (!rootDirectoryHandle) {
    alert('Por favor, selecione a pasta raiz de XMLs do Google Drive onde os arquivos serão organizados.');
    const escolhido = await escolherPastaGoogleDrive();
    if (!escolhido) return;
  } else {
    const permissaoValida = await verificarPermissaoHandle(rootDirectoryHandle, true);
    if (!permissaoValida) {
      alert('É necessário conceder permissão de escrita para que o navegador grave os XMLs na pasta.');
      const reescolhido = await escolherPastaGoogleDrive();
      if (!reescolhido) return;
    }
  }

  isProcessando = true;
  const progBox = document.getElementById('boxLogXmlProgresso');
  const progBar = document.getElementById('barLogXmlProgresso');
  const progStatus = document.getElementById('lblLogXmlProgressoStatus');
  const progPercent = document.getElementById('lblLogXmlProgressoPercent');
  const progLogs = document.getElementById('boxLogXmlProgressoLogs');
  const btnSalvar = document.getElementById('btnLogXmlSalvarDrive');

  if (progBox) progBox.classList.remove('hidden');
  if (progLogs) progLogs.innerHTML = '';
  if (btnSalvar) btnSalvar.disabled = true;

  const total = notasParaSalvar.length;
  let concluidos = 0;
  let erros = 0;

  try {
    const CHUNK_SIZE = 15;

    for (let c = 0; c < total; c += CHUNK_SIZE) {
      const chunk = notasParaSalvar.slice(c, c + CHUNK_SIZE);
      const chunkNum = Math.floor(c / CHUNK_SIZE) + 1;
      const totalChunks = Math.ceil(total / CHUNK_SIZE);

      if (progStatus) {
        progStatus.textContent = `Consultando lote ${chunkNum} de ${totalChunks} (${chunk.length} XMLs)...`;
      }

      // 2. Busca o lote parcial de XMLs no backend
      const payloadItens = chunk.map(n => ({
        chave: n.chaveAcesso,
        empresa: n.empresa,
        numeroNf: n.numeroNf,
        clienteRazao: n.clienteRazao,
        clienteCod: n.clienteCod,
        dataEmissao: n.dataEmissao,
        nomeArquivo: n.nomeArquivo,
        statusSefaz: n.statusSefaz
      }));

      const resLote = await apiFetch('/api/logistica/faturamento-xmls/lote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itens: payloadItens })
      });

      const dataLote = await resLote.json();
      if (!resLote.ok || !dataLote.success) {
        throw new Error(dataLote.error || `Falha ao resolver lote ${chunkNum} de XMLs.`);
      }

      const resultados = dataLote.resultados || [];

      // 3. Gravação sequencial de cada arquivo do chunk no Google Drive
      for (const item of resultados) {
        const itemIndex = concluidos + erros + 1;
        const progresso = Math.round((itemIndex / total) * 100);

        if (progBar) progBar.style.width = `${progresso}%`;
        if (progPercent) progPercent.textContent = `${progresso}%`;
        if (progStatus) progStatus.textContent = `Gravando arquivo ${itemIndex} de ${total}: ${item.nomeArquivo}...`;

        if (!item.sucesso || !item.xmlConteudo) {
          erros++;
          adicionarLogChip(progLogs, `❌ [ERRO] ${item.nomeArquivo}: ${item.erro || 'XML não disponível'}`, '#ef4444');
          continue;
        }

        try {
          // Roteamento inteligente com subpastaAno:
          // Se o diretório raiz selecionado já for a pasta do ano (ex: "XML's Saídas 2026"), usa direto;
          // Se for a pasta raiz geral ("XML's Saídas"), entra/cria a subpasta do ano.
          let dirDestinoAno = rootDirectoryHandle;
          if (item.subpastaAno && rootDirectoryHandle.name !== item.subpastaAno) {
            dirDestinoAno = await rootDirectoryHandle.getDirectoryHandle(item.subpastaAno, { create: true });
          }

          const dirEmpresa = await dirDestinoAno.getDirectoryHandle(item.subpastaEmpresa, { create: true });
          const dirMes = await dirEmpresa.getDirectoryHandle(item.subpastaMesAno, { create: true });
          const fileHandle = await dirMes.getFileHandle(item.nomeArquivo, { create: true });

          const writable = await fileHandle.createWritable();
          await writable.write(item.xmlConteudo);
          await writable.close();

          concluidos++;
          const pathExibicao = `${item.subpastaAno ? item.subpastaAno + '\\' : ''}${item.subpastaEmpresa}\\${item.subpastaMesAno}\\${item.nomeArquivo}`;
          adicionarLogChip(progLogs, `✅ [SALVO] ${pathExibicao}`, '#10b981');
        } catch (errGravar) {
          erros++;
          adicionarLogChip(progLogs, `❌ [FALHA DISCO] ${item.nomeArquivo}: ${errGravar.message}`, '#ef4444');
        }
      }
    }

    if (progStatus) {
      progStatus.innerHTML = `🎉 Concluído com sucesso! <strong>${concluidos} XMLs</strong> salvos diretamente no Google Drive.${erros > 0 ? ` (<span style="color:#ef4444;">${erros} erros</span>)` : ''}`;
    }
    alert(`Gravação concluída!\n\n✅ ${concluidos} arquivos gravados no Google Drive com sucesso.\n${erros > 0 ? `⚠️ ${erros} falhas.` : ''}`);
  } catch (errGeral) {
    console.error('Erro durante a gravação:', errGeral);
    if (progStatus) progStatus.textContent = `❌ Erro geral: ${errGeral.message}`;
    alert('Erro durante a gravação no Google Drive: ' + errGeral.message);
  } finally {
    isProcessando = false;
    atualizarContadorSelecionadas();
  }
}

function adicionarLogChip(container, texto, cor) {
  if (!container) return;
  const div = document.createElement('div');
  div.style.color = cor;
  div.style.padding = '2px 0';
  div.textContent = texto;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

// ============================================================================
// CONTINGÊNCIA: DOWNLOAD EM PACOTE ZIP
// ============================================================================

export async function baixarXmlsComoZip() {
  const checkboxes = document.querySelectorAll('.chk-nota-item:checked');
  if (checkboxes.length === 0) {
    alert('Nenhuma nota fiscal selecionada.');
    return;
  }

  const indices = Array.from(checkboxes).map(cb => parseInt(cb.dataset.index, 10));
  const notasParaSalvar = indices.map(idx => notasFaturamentoCache[idx]).filter(Boolean);

  // Agrupa itens por empresa para atender o endpoint fiscal
  const notasPorEmpresa = {};
  notasParaSalvar.forEach(n => {
    const emp = n.empresa || '16';
    if (!notasPorEmpresa[emp]) {
      notasPorEmpresa[emp] = [];
    }
    notasPorEmpresa[emp].push({
      doc: n.numeroNf,
      serie: n.serie,
      chave: n.chaveAcesso
    });
  });

  const empresasLista = Object.keys(notasPorEmpresa);

  try {
    for (let i = 0; i < empresasLista.length; i++) {
      const emp = empresasLista[i];
      const payloadItens = notasPorEmpresa[emp];

      const res = await apiFetch('/api/analista-fin/fechamento-fiscal/exportar-xml-sefaz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empresa: emp,
          itens: payloadItens
        })
      });

      if (!res.ok) {
        const dataErr = await res.json().catch(() => ({}));
        throw new Error(dataErr.error || `Erro ao gerar pacote ZIP para empresa ${emp}.`);
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `NFE_XML_FATURAMENTO_EMP${emp}_${getDataBrasiliaIso()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      if (i < empresasLista.length - 1) {
        await new Promise(r => setTimeout(r, 400));
      }
    }
  } catch (err) {
    alert('Falha ao baixar pacote ZIP: ' + err.message);
  }
}

// ============================================================================
// INICIALIZAÇÃO DO MÓDULO & EVENT LISTENERS
// ============================================================================

export function inicializarLogisticaXmlFaturamento() {
  if (isInitialized) {
    return;
  }
  isInitialized = true;

  const btnBuscar = document.getElementById('btnLogXmlBuscar');
  const btnSalvar = document.getElementById('btnLogXmlSalvarDrive');
  const btnBaixarZip = document.getElementById('btnLogXmlBaixarZip');
  const btnEscolherPasta = document.getElementById('btnLogXmlEscolherPasta');

  const deInput = document.getElementById('inputLogXmlDataDe');
  const ateInput = document.getElementById('inputLogXmlDataAte');

  const btnHoje = document.getElementById('btnLogXmlAtalhoHoje');
  const btnOntem = document.getElementById('btnLogXmlAtalhoOntem');
  const btnSemana = document.getElementById('btnLogXmlAtalhoSemana');
  const btnMes = document.getElementById('btnLogXmlAtalhoMes');

  const chkAllHeader = document.getElementById('chkLogXmlSelectAllHeader');
  const chkAll = document.getElementById('chkLogXmlSelectAll');

  // Inicializa datas com o dia de Hoje no fuso de Brasília
  const hoje = getDataBrasiliaIso();
  if (deInput && !deInput.value) deInput.value = hoje;
  if (ateInput && !ateInput.value) ateInput.value = hoje;

  // Tenta reidratar nome da pasta salva
  const nomePastaSalva = localStorage.getItem(NOME_PASTA_STORAGE_KEY);
  if (nomePastaSalva) {
    atualizarIndicadorPastaUI(nomePastaSalva);
  }

  // Atalhos de Data com fuso de Brasília
  if (btnHoje) {
    btnHoje.addEventListener('click', () => {
      const h = getDataBrasiliaIso();
      if (deInput) deInput.value = h;
      if (ateInput) ateInput.value = h;
      carregarNotasFaturadasLogistica();
    });
  }

  if (btnOntem) {
    btnOntem.addEventListener('click', () => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      const ont = getDataBrasiliaIso(d);
      if (deInput) deInput.value = ont;
      if (ateInput) ateInput.value = ont;
      carregarNotasFaturadasLogistica();
    });
  }

  if (btnSemana) {
    btnSemana.addEventListener('click', () => {
      const d = new Date();
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Segunda-feira
      const seg = getDataBrasiliaIso(new Date(d.setDate(diff)));
      const hojeStr = getDataBrasiliaIso();
      if (deInput) deInput.value = seg;
      if (ateInput) ateInput.value = hojeStr;
      carregarNotasFaturadasLogistica();
    });
  }

  if (btnMes) {
    btnMes.addEventListener('click', () => {
      const d = new Date();
      const primeiroDia = getDataBrasiliaIso(new Date(d.getFullYear(), d.getMonth(), 1));
      const hojeStr = getDataBrasiliaIso();
      if (deInput) deInput.value = primeiroDia;
      if (ateInput) ateInput.value = hojeStr;
      carregarNotasFaturadasLogistica();
    });
  }

  // Ações Principais
  if (btnBuscar) {
    btnBuscar.addEventListener('click', carregarNotasFaturadasLogistica);
  }

  if (btnEscolherPasta) {
    btnEscolherPasta.addEventListener('click', escolherPastaGoogleDrive);
  }

  if (btnSalvar) {
    btnSalvar.addEventListener('click', salvarXmlsNoGoogleDrive);
  }

  if (btnBaixarZip) {
    btnBaixarZip.addEventListener('click', baixarXmlsComoZip);
  }

  // Checkbox Select All
  const sincronizarChecks = (checked) => {
    const checkboxes = document.querySelectorAll('.chk-nota-item');
    checkboxes.forEach(cb => { cb.checked = checked; });
    if (chkAllHeader) chkAllHeader.checked = checked;
    if (chkAll) chkAll.checked = checked;
    atualizarContadorSelecionadas();
  };

  if (chkAllHeader) chkAllHeader.addEventListener('change', (e) => sincronizarChecks(e.target.checked));
  if (chkAll) chkAll.addEventListener('change', (e) => sincronizarChecks(e.target.checked));

  // Inicializa estado dos botões de ação desabilitados se nenhuma nota
  atualizarContadorSelecionadas();
}
