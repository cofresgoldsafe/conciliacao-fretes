/**
 * serasa_pdf_parser.js
 * Wrapper Node.js para execução em memória do parser Serasa Experian (serasa_pdf_parser.py).
 * Nenhum arquivo PDF é persistido em disco no servidor.
 */

const { spawn } = require('child_process');
const path = require('path');

const PYTHON_SCRIPT = path.join(__dirname, 'serasa_pdf_parser.py');

/**
 * Executa o parser Serasa passando o buffer de memória do PDF via stdin.
 * @param {Buffer} pdfBuffer - Buffer de bytes do arquivo PDF em memória.
 * @returns {Promise<Object>} Resultado estruturado com validações e dados extraídos.
 */
function parseSerasaBuffer(pdfBuffer) {
  return new Promise((resolve, reject) => {
    if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
      return resolve({
        success: false,
        error_type: 'BUFFER_INVALIDO',
        error: 'Nenhum dado ou arquivo PDF válido fornecido na requisição.'
      });
    }

    const py = spawn('python', [PYTHON_SCRIPT, '-'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdoutData = '';
    let stderrData = '';

    py.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString('utf-8');
    });

    py.stderr.on('data', (chunk) => {
      stderrData += chunk.toString('utf-8');
    });

    py.on('error', (err) => {
      console.error('Erro ao invocar processo python serasa_pdf_parser:', err);
      resolve({
        success: false,
        error_type: 'ERRO_EXECUTOR',
        error: 'Falha ao executar o interpretador Python do parser Serasa: ' + err.message
      });
    });

    py.on('close', (code) => {
      if (code !== 0 && !stdoutData.trim()) {
        console.error(`Processo python encerrou com código ${code}:`, stderrData);
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
        console.error('Erro ao decodificar JSON do parser Serasa:', stdoutData, errParse);
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
      console.error('Erro ao escrever buffer no stdin do parser Python:', errWrite);
      resolve({
        success: false,
        error_type: 'ERRO_ESCRITA',
        error: 'Erro de comunicação de buffer com o parser Serasa.'
      });
    }
  });
}

module.exports = {
  parseSerasaBuffer
};
