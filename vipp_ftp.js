const path = require('path');
const { execFile } = require('child_process');
const { consultarProtheusNF } = require('./protheus_db');

let memoryIndex = {
  byEtiqueta: {},
  list: [],
  files: [],
  totalPostagens: 0,
  totalEtiquetas: 0,
  lastSync: null,
  status: 'initialized'
};

/**
 * Executa o script Python para sincronizar o FTP e/ou ler o cache local de CSVs
 */
function runSyncScript(forceSync = false) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'vipp_ftp_sync.py');
    const pythonBin = process.platform === 'win32' ? 'python' : 'python3';
    const args = [scriptPath];
    if (forceSync) args.push('--sync');

    execFile(pythonBin, args, { cwd: __dirname, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && pythonBin === 'python3') {
        return execFile('python', args, { cwd: __dirname, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }, (err2, out2, stderr2) => {
          if (err2) {
            return reject(new Error(`Erro ao executar sincronização ViPP: ${err2.message} - ${stderr2}`));
          }
          try {
            resolve(JSON.parse(out2));
          } catch (pe) {
            reject(new Error(`Resposta inválida do sincronizador ViPP: ${out2}`));
          }
        });
      }
      if (err) {
        return reject(new Error(`Erro ao executar sincronização ViPP: ${err.message} - ${stderr}`));
      }
      try {
        const data = JSON.parse(stdout);
        resolve(data);
      } catch (parseErr) {
        reject(new Error(`Resposta inválida do sincronizador ViPP: ${stdout}`));
      }
    });
  });
}

/**
 * Sincroniza os relatórios do FTP ViPP e atualiza o índice em memória
 */
async function syncVippFtp(forceSync = true) {
  try {
    const result = await runSyncScript(forceSync);
    if (result && result.success) {
      memoryIndex = {
        byEtiqueta: result.byEtiqueta || {},
        list: result.list || [],
        files: result.files || [],
        totalPostagens: result.totalPostagens || 0,
        totalEtiquetas: result.totalEtiquetas || 0,
        lastSync: new Date().toISOString(),
        status: result.fromCache ? 'cache_only' : 'synced',
        warning: result.warning || null
      };
      return { success: true, ...memoryIndex };
    } else {
      throw new Error(result.error || 'Falha ao sincronizar FTP ViPP');
    }
  } catch (err) {
    console.error('Erro na sincronização FTP ViPP:', err.message);
    memoryIndex.status = 'error';
    memoryIndex.lastError = err.message;
    return { success: false, error: err.message, ...memoryIndex };
  }
}

/**
 * Retorna o índice em memória atual
 */
function getVippIndex() {
  return memoryIndex;
}

/**
 * Busca uma postagem específica por etiqueta
 */
function getPostingByEtiqueta(etiqueta) {
  if (!etiqueta) return null;
  const clean = String(etiqueta).trim().toUpperCase();
  return memoryIndex.byEtiqueta[clean] || null;
}

/**
 * Retorna o status operacional da integração FTP ViPP
 */
function getFtpStatus() {
  return {
    status: memoryIndex.status,
    totalPostagens: memoryIndex.totalPostagens,
    totalEtiquetas: memoryIndex.totalEtiquetas,
    filesCount: memoryIndex.files.length,
    files: memoryIndex.files,
    lastSync: memoryIndex.lastSync,
    lastError: memoryIndex.lastError || null
  };
}

/**
 * Cruza os itens extraídos da fatura dos Correios (PDF SFE) com o ViPP e o Protheus
 * Regras:
 * - Se encontrado com OS: tipoDoc = 'OS', pedVenda = 'N/A (OS)', frete = 0, status = 'OS Identificada'
 * - Se encontrado com NF: tipoDoc = 'NF', consulta Protheus (pedVenda, cliente, frete cobrado)
 * - Se NÃO encontrado no ViPP: docOriginario = 'Sem Info', pedVenda = 'Sem Info', status = 'Sem Info' (Permite edição manual)
 */
async function enrichCorreiosItems(items, empresaKey = 'OACO', autoSyncRemote = true) {
  if (!items || !Array.isArray(items)) return items;

  // Garante que o índice em memória busque novos arquivos no FTP se o cache estiver vazio ou há mais de 1 minuto sem checar
  const now = Date.now();
  const lastSyncTime = memoryIndex.lastSync ? new Date(memoryIndex.lastSync).getTime() : 0;
  const isStale = (now - lastSyncTime) > 60 * 1000; // Mais de 1 minuto

  if (autoSyncRemote && (isStale || Object.keys(memoryIndex.byEtiqueta).length === 0)) {
    try {
      await syncVippFtp(true); // Conecta ao FTP e baixa arquivos novos de /Retorno
    } catch (e) {
      console.warn('Aviso: Sincronização remota FTP falhou, usando cache local:', e.message);
      if (Object.keys(memoryIndex.byEtiqueta).length === 0) {
        await syncVippFtp(false).catch(() => {});
      }
    }
  } else if (Object.keys(memoryIndex.byEtiqueta).length === 0) {
    await syncVippFtp(false).catch(() => {});
  }

  for (const item of items) {
    const etiqueta = String(item.etiqueta || item.numFrete || '').trim().toUpperCase();
    const posting = getPostingByEtiqueta(etiqueta);

    if (posting) {
      // Objeto encontrado no ViPP
      item.vippEncontrado = true;
      item.dataPostagem = posting.dataPostagem || item.dataPostagem;
      item.servico = posting.servico || item.servico;
      item.cliente = posting.destinatario || item.cliente;
      item.chaveNfe = posting.chaveNfe || '';
      item.cidade = posting.cidade || '';
      item.uf = posting.uf || '';

      if (posting.tipoDoc === 'OS') {
        // Classificação: Ordem de Serviço
        item.tipoDoc = 'OS';
        item.osNum = posting.osNum;
        item.docOriginario = `OS ${posting.osNum}`;
        item.pedVenda = 'N/A (OS)';
        item.codCli = '';
        item.freteCobradoProtheus = 0.00;
        item.freteEmbutidoProtheus = 0.00;
        item.freteProtheusTotal = 0.00;
        item.protheusEncontrado = true;
        item.status = 'OS Identificada';
      } else {
        // Classificação: Nota Fiscal
        item.tipoDoc = 'NF';
        item.osNum = '';
        const nfNum = posting.nfNum;
        item.docOriginario = nfNum || 'Sem Info';

        if (nfNum) {
          try {
            const protheusData = await consultarProtheusNF(nfNum, empresaKey);
            item.pedVenda = protheusData.pedVenda || 'N/A';
            item.codCli = protheusData.codCli || '';
            item.freteCobradoProtheus = protheusData.freteCobrado || 0.00;
            item.freteEmbutidoProtheus = protheusData.freteEmbutido || 0.00;
            item.freteProtheusTotal = protheusData.freteProtheusTotal || (item.freteCobradoProtheus + item.freteEmbutidoProtheus);
            item.protheusEncontrado = protheusData.encontrado;
            if (protheusData.encontrado && protheusData.nomeCliente) {
              item.cliente = protheusData.nomeCliente;
            }
            item.status = protheusData.encontrado ? 'Batimento Protheus' : 'NF Não Encontrada';
          } catch (err) {
            console.error(`Erro ao consultar Protheus para NF ${nfNum}:`, err.message);
            item.pedVenda = 'Erro Consulta';
            item.freteCobradoProtheus = 0.00;
            item.freteEmbutidoProtheus = 0.00;
            item.freteProtheusTotal = 0.00;
            item.protheusEncontrado = false;
            item.status = 'Erro Consulta Protheus';
          }
        } else {
          item.pedVenda = 'Sem Info';
          item.freteCobradoProtheus = 0.00;
          item.freteEmbutidoProtheus = 0.00;
          item.freteProtheusTotal = 0.00;
          item.protheusEncontrado = false;
          item.status = 'Sem Info';
        }
      }
    } else {
      // Objeto AINDA NÃO localizado no ViPP (movimentação pendente nos Correios)
      item.vippEncontrado = false;
      item.tipoDoc = 'SEM_INFO';
      item.docOriginario = 'Sem Info';
      item.pedVenda = 'Sem Info';
      item.codCli = '';
      item.freteCobradoProtheus = 0.00;
      item.freteEmbutidoProtheus = 0.00;
      item.freteProtheusTotal = 0.00;
      item.protheusEncontrado = false;
      item.status = 'Sem Info';
    }
  }

  return items;
}

// Inicialização em background ao carregar o módulo
syncVippFtp(false).catch(err => {
  console.log('Inicialização do cache ViPP em background concluída com aviso:', err.message);
});

module.exports = {
  syncVippFtp,
  getVippIndex,
  getPostingByEtiqueta,
  getFtpStatus,
  enrichCorreiosItems
};
