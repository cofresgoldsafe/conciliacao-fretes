/**
 * serasa_pdf_parser.js
 * Wrapper Node.js para execução em memória do parser Serasa Experian (serasa_pdf_parser.py).
 * Nenhum arquivo PDF é persistido em disco no servidor.
 * 
 * Suporte Multiplataforma Resiliente:
 * - Linux / Docker / Render: python3 -> python -> /usr/bin/python3
 * - Windows: python -> python3 -> py
 */

const { spawn } = require('child_process');
const path = require('path');

const PYTHON_SCRIPT = path.join(__dirname, 'serasa_pdf_parser.py');

/**
 * Lista de candidatos a interpretador Python por sistema operacional
 */
function getPythonCandidates() {
  if (process.platform === 'win32') {
    return ['python', 'python3', 'py'];
  }
  return ['python3', 'python', '/usr/bin/python3', '/usr/local/bin/python3'];
}

/**
 * Tenta executar o parser Serasa com um binário Python específico.
 */
function trySpawnPython(bin, pdfBuffer) {
  return new Promise((resolve, reject) => {
    let py;
    try {
      py = spawn(bin, [PYTHON_SCRIPT, '-'], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (err) {
      return reject(err);
    }

    let stdoutData = '';
    let stderrData = '';

    py.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString('utf-8');
    });

    py.stderr.on('data', (chunk) => {
      stderrData += chunk.toString('utf-8');
    });

    py.on('error', (err) => {
      reject(err);
    });

    py.on('close', (code) => {
      if (code !== 0 && !stdoutData.trim()) {
        console.error(`Processo python (${bin}) encerrou com código ${code}:`, stderrData);
        return resolve({
          success: false,
          error_type: 'ERRO_PROCESSO',
          error: 'Falha no processamento do laudo Serasa: ' + (stderrData || `Código de saída ${code}`)
        });
      }

      try {
        const parsed = JSON.parse(stdoutData.trim());
        resolve(parsed);
      } catch (errParse) {
        console.error(`Erro ao decodificar JSON do parser Serasa (${bin}):`, stdoutData, errParse);
        resolve({
          success: false,
          error_type: 'JSON_INVALIDO',
          error: 'Resposta inválida do parser Serasa.'
        });
      }
    });

    // Envia o buffer diretamente para o stdin do Python e fecha o stream
    try {
      py.stdin.write(pdfBuffer);
      py.stdin.end();
    } catch (errWrite) {
      reject(errWrite);
    }
  });
}

/**
 * Executa o parser Serasa passando o buffer de memória do PDF via stdin,
 * tentando sucessivamente os binários Python disponíveis (python3 / python / py).
 * @param {Buffer} pdfBuffer - Buffer de bytes do arquivo PDF em memória.
 * @returns {Promise<Object>} Resultado estruturado com validações e dados extraídos.
 */
async function parseSerasaBuffer(pdfBuffer) {
  if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
    return {
      success: false,
      error_type: 'BUFFER_INVALIDO',
      error: 'Nenhum dado ou arquivo PDF válido fornecido na requisição.'
    };
  }

  const candidates = getPythonCandidates();
  let lastError = null;

  for (const bin of candidates) {
    try {
      const result = await trySpawnPython(bin, pdfBuffer);
      return result;
    } catch (err) {
      lastError = err;
      if (err.code === 'ENOENT') {
        // Binário não encontrado no PATH, tenta o próximo candidato
        continue;
      }
      console.warn(`Aviso ao tentar executar Python com binário '${bin}':`, err.message);
    }
  }

  console.error('Todos os binários Python falharam para parseSerasaBuffer:', candidates, lastError);
  return {
    success: false,
    error_type: 'ERRO_EXECUTOR',
    error: `Falha ao executar o interpretador Python do parser Serasa (${candidates.join(', ')}): ${lastError ? lastError.message : 'Interpretador Python não encontrado no servidor'}`
  };
}

module.exports = {
  parseSerasaBuffer
};
