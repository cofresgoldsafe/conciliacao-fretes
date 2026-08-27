/**
 * safe_json_storage.js
 * 
 * Módulo de Persistência Segura e Resiliente para Arquivos JSON locais (data/*.json)
 * - Serialização de gravações concorrentes via fila assíncrona por arquivo (FIFO).
 * - Gravação atômica via arquivo temporário + atomicRename com retry e fallback resiliente (Windows NTFS / POSIX).
 * - Sanitização e leitura resiliente com fallback seguro e tratamento UTF-8.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Filas de promessas por caminho absoluto do arquivo para serialização de escrita
const writeQueues = new Map();

/**
 * Garante que o diretório pai do arquivo exista
 */
function ensureDirExists(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Realiza a substituição atômica de arquivos de forma compatível com Windows e POSIX
 * (Trata EPERM/EBUSY momentâneos de NTFS com micro-retries e fallback para copyFile)
 */
async function atomicRenameAsync(tempPath, targetPath, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      await fs.promises.rename(tempPath, targetPath);
      return;
    } catch (err) {
      const isLockError = ['EPERM', 'EBUSY', 'EACCES'].includes(err.code);
      if (isLockError && i < retries - 1) {
        await new Promise(r => setTimeout(r, (i + 1) * 15));
        continue;
      }
      
      // Fallback final: cópia direta + unlink do arquivo temporário
      try {
        await fs.promises.copyFile(tempPath, targetPath);
        await fs.promises.unlink(tempPath).catch(() => {});
        return;
      } catch (copyErr) {
        try {
          if (fs.existsSync(tempPath)) await fs.promises.unlink(tempPath);
        } catch {}
        throw copyErr;
      }
    }
  }
}

/**
 * Versão síncrona de substituição atômica de arquivos
 */
function atomicRenameSync(tempPath, targetPath, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      fs.renameSync(tempPath, targetPath);
      return;
    } catch (err) {
      const isLockError = ['EPERM', 'EBUSY', 'EACCES'].includes(err.code);
      if (isLockError && i < retries - 1) {
        // Pequena espera síncrona
        const start = Date.now();
        while (Date.now() - start < (i + 1) * 10) {}
        continue;
      }

      // Fallback final síncrono: copyFile + unlink
      try {
        fs.copyFileSync(tempPath, targetPath);
        try { fs.unlinkSync(tempPath); } catch {}
        return;
      } catch (copyErr) {
        try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
        throw copyErr;
      }
    }
  }
}

/**
 * Grava dados em arquivo JSON de forma atômica e síncrona
 */
function safeWriteJsonSync(filePath, data) {
  ensureDirExists(filePath);
  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath);
  const tempPath = path.join(dir, `.${baseName}.tmp.${Date.now()}_${crypto.randomBytes(4).toString('hex')}`);

  const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

  try {
    fs.writeFileSync(tempPath, content, 'utf-8');
    atomicRenameSync(tempPath, filePath);
  } catch (err) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {}
    throw err;
  }
}

/**
 * Enfileira e executa a gravação assíncrona de forma estritamente sequencial e atômica
 */
async function safeWriteJson(filePath, data) {
  const absolutePath = path.resolve(filePath);

  // Obtém ou inicializa a fila de promessas do arquivo
  const previousQueue = writeQueues.get(absolutePath) || Promise.resolve();

  // Encadeia a nova operação na fila
  const currentOperation = previousQueue
    .catch(() => {}) // Não interrompe a fila em caso de erro na operação anterior
    .then(async () => {
      ensureDirExists(absolutePath);
      const dir = path.dirname(absolutePath);
      const baseName = path.basename(absolutePath);
      const tempPath = path.join(dir, `.${baseName}.tmp.${Date.now()}_${crypto.randomBytes(4).toString('hex')}`);

      const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

      await fs.promises.writeFile(tempPath, content, 'utf-8');
      await atomicRenameAsync(tempPath, absolutePath);
    });

  writeQueues.set(absolutePath, currentOperation);

  // Limpa a referência da fila quando concluída
  currentOperation.finally(() => {
    if (writeQueues.get(absolutePath) === currentOperation) {
      writeQueues.delete(absolutePath);
    }
  });

  return currentOperation;
}

/**
 * Lê e decodifica arquivo JSON com fallback seguro
 */
function safeReadJsonSync(filePath, defaultValue = null) {
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (!raw || !raw.trim()) return defaultValue;
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[SafeJSON] Aviso ao ler ${path.basename(filePath)}:`, err.message);
    return defaultValue;
  }
}

/**
 * Lê e decodifica arquivo JSON de forma assíncrona com fallback seguro
 */
async function safeReadJson(filePath, defaultValue = null) {
  try {
    const exists = await fs.promises.access(filePath).then(() => true).catch(() => false);
    if (!exists) return defaultValue;
    const raw = await fs.promises.readFile(filePath, 'utf-8');
    if (!raw || !raw.trim()) return defaultValue;
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[SafeJSON] Aviso ao ler ${path.basename(filePath)}:`, err.message);
    return defaultValue;
  }
}

module.exports = {
  safeWriteJson,
  safeWriteJsonSync,
  safeReadJson,
  safeReadJsonSync
};
