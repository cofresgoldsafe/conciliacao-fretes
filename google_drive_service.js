/**
 * google_drive_service.js — Cliente Autônomo da Google Drive API v3 para Job em Nuvem
 * 
 * Permite que o servidor na nuvem (Render/Linux) grave diretamente no Google Drive
 * corporativo (Drives Compartilhados) via Service Account, sem depender de nenhuma máquina física ligada.
 * 
 * Regras:
 * 1. Autenticação OAuth2 Server-to-Server via JWT (RS256) nativo.
 * 2. Suporte estrito a Drives Compartilhados (supportsAllDrives=true, includeItemsFromAllDrives=true).
 * 3. Cache em memória do access_token (reaproveitamento seguro durante o TTL de 1h).
 * 4. Idempotência: não sobe arquivos que já constam com o mesmo nome na pasta de destino.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const jwt = require('jsonwebtoken');

const CREDENTIALS_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_PATH || path.join(__dirname, 'google_service_account.json');

let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Carrega as credenciais da Service Account do arquivo JSON ou variável de ambiente
 */
function carregarCredenciaisServiceAccount() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    } catch (e) {
      console.warn('⚠️ Falha ao fazer parse de GOOGLE_SERVICE_ACCOUNT_JSON da env:', e.message);
    }
  }

  if (fs.existsSync(CREDENTIALS_PATH)) {
    try {
      const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      console.warn(`⚠️ Falha ao ler ${CREDENTIALS_PATH}:`, e.message);
    }
  }

  return null;
}

/**
 * Obtém token OAuth2 de acesso usando JWT assinado (Service Account)
 */
async function obterAccessTokenGoogle() {
  const agora = Math.floor(Date.now() / 1000);
  if (cachedToken && agora < tokenExpiresAt - 60) {
    return cachedToken;
  }

  const creds = carregarCredenciaisServiceAccount();
  if (!creds || !creds.client_email || !creds.private_key) {
    throw new Error('Credenciais da Service Account do Google não configuradas ou inválidas.');
  }

  const payload = {
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    exp: agora + 3600,
    iat: agora
  };

  const assertion = jwt.sign(payload, creds.private_key, { algorithm: 'RS256' });

  const postData = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion
  }).toString();

  return new Promise((resolve, reject) => {
    const req = https.request('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 15000
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.access_token) {
            cachedToken = data.access_token;
            tokenExpiresAt = agora + (data.expires_in || 3600);
            resolve(cachedToken);
          } else {
            reject(new Error(`Falha OAuth2 Google: ${data.error_description || data.error || body}`));
          }
        } catch (err) {
          reject(new Error(`Erro no parse OAuth2: ${err.message}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout ao autenticar no Google OAuth2')); });
    req.write(postData);
    req.end();
  });
}

/**
 * Executa requisição autenticada à Google Drive API v3
 */
function requisicaoDriveApi({ endpoint, method = 'GET', headers = {}, body = null }) {
  return new Promise(async (resolve, reject) => {
    try {
      const token = await obterAccessTokenGoogle();

      const options = {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          ...headers
        },
        timeout: 25000
      };

      const req = https.request(endpoint, options, (res) => {
        let respBody = '';
        res.on('data', chunk => respBody += chunk);
        res.on('end', () => {
          try {
            const parsed = respBody ? JSON.parse(respBody) : {};
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(parsed);
            } else {
              const errMsg = parsed.error ? parsed.error.message : respBody;
              reject(new Error(`Drive API [HTTP ${res.statusCode}]: ${errMsg}`));
            }
          } catch (e) {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(respBody);
            } else {
              reject(new Error(`Drive API [HTTP ${res.statusCode}]: ${respBody}`));
            }
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout na requisição Google Drive')); });

      if (body) {
        req.write(body);
      }
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Localiza a pasta raiz 'XML\'s Saídas' compartilhada com o robô
 */
async function localizarPastaRaizXmlsSaidas(nomePastaAlvo = "XML's Saídas") {
  // 1. Tenta achar pasta exata 'XML\'s Saídas'
  const safeName = nomePastaAlvo.replace(/'/g, "\\'");
  let q = encodeURIComponent(`name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  let endpoint = `https://www.googleapis.com/drive/v3/files?q=${q}&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives&fields=files(id,name,parents,driveId)`;

  let res = await requisicaoDriveApi({ endpoint });
  if (res.files && res.files.length > 0) {
    return res.files[0];
  }

  // 2. Se não encontrou, busca pasta anual compartilhada diretamente (ex: "XML's Saídas 2026")
  q = encodeURIComponent(`name contains 'XML\\'s Saídas' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  endpoint = `https://www.googleapis.com/drive/v3/files?q=${q}&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives&fields=files(id,name,parents,driveId)`;

  res = await requisicaoDriveApi({ endpoint });
  if (res.files && res.files.length > 0) {
    return res.files[0];
  }

  return null;
}

/**
 * Localiza ou cria uma subpasta dentro de um parentId no Google Drive
 */
async function obterOuCriarSubpastaDrive({ parentId, nomeSubpasta }) {
  const safeName = nomeSubpasta.replace(/'/g, "\\'");
  const q = encodeURIComponent(`name = '${safeName}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  const listEndpoint = `https://www.googleapis.com/drive/v3/files?q=${q}&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives&fields=files(id,name)`;

  const busca = await requisicaoDriveApi({ endpoint: listEndpoint });
  if (busca.files && busca.files.length > 0) {
    return busca.files[0].id;
  }

  // Cria a pasta
  const postBody = JSON.stringify({
    name: nomeSubpasta,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentId]
  });

  const createEndpoint = 'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name';
  const criada = await requisicaoDriveApi({
    endpoint: createEndpoint,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postBody)
    },
    body: postBody
  });

  return criada.id;
}

/**
 * Verifica se um arquivo com o nome informado já existe na pasta de destino (Idempotência)
 */
async function verificarArquivoExisteNoDrive({ parentId, nomeArquivo }) {
  const safeName = nomeArquivo.replace(/'/g, "\\'");
  const q = encodeURIComponent(`name = '${safeName}' and '${parentId}' in parents and trashed = false`);
  const endpoint = `https://www.googleapis.com/drive/v3/files?q=${q}&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives&fields=files(id,name)`;

  const res = await requisicaoDriveApi({ endpoint });
  return res.files && res.files.length > 0;
}

/**
 * Faz o upload multipart de um arquivo XML para a pasta de destino no Google Drive
 */
async function salvarArquivoXmlNoDrive({ parentId, nomeArquivo, xmlConteudo }) {
  // 1. Checa idempotência
  const jaExiste = await verificarArquivoExisteNoDrive({ parentId, nomeArquivo });
  if (jaExiste) {
    return { salvo: false, jaExistente: true };
  }

  // 2. Monta payload multipart/related
  const boundary = `-------314159265358979323846_${Date.now()}`;
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metadata = JSON.stringify({
    name: nomeArquivo,
    mimeType: 'application/xml',
    parents: [parentId]
  });

  const multipartBody = Buffer.concat([
    Buffer.from(delimiter + 'Content-Type: application/json; charset=UTF-8\r\n\r\n' + metadata),
    Buffer.from(delimiter + 'Content-Type: application/xml; charset=UTF-8\r\n\r\n'),
    Buffer.from(xmlConteudo, 'utf8'),
    Buffer.from(closeDelimiter)
  ]);

  const endpoint = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name';

  const res = await requisicaoDriveApi({
    endpoint,
    method: 'POST',
    headers: {
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': multipartBody.length
    },
    body: multipartBody
  });

  return { salvo: true, fileId: res.id, nome: res.name };
}

/**
 * Orquestra o salvamento de um lote de notas fiscais diretamente na nuvem do Google Drive
 */
async function sincronizarNotasFaturamentoDriveNuvem({ notas = [], pastaRaizId = null }) {
  let rootId = pastaRaizId;
  let rootName = '';

  if (!rootId) {
    const pastaRaiz = await localizarPastaRaizXmlsSaidas();
    if (!pastaRaiz) {
      throw new Error("Pasta raiz 'XML\\'s Saídas' não encontrada no Google Drive da Service Account. Certifique-se de compartilhar a pasta com o e-mail do robô.");
    }
    rootId = pastaRaiz.id;
    rootName = pastaRaiz.name;
  }

  const stats = {
    total: notas.length,
    gravados: 0,
    jaExistentes: 0,
    erros: 0,
    detalhes: []
  };

  // Cache das subpastas para não fazer requisições repetidas
  const folderCache = {};

  for (const n of notas) {
    const nomeArquivo = n.nomeArquivo;
    const subpastaAno = n.subpastaAno;
    const subpastaEmpresa = n.subpastaEmpresa;
    const subpastaMesAno = n.subpastaMesAno;
    const xmlConteudo = n.xmlConteudo;

    if (!xmlConteudo) {
      stats.erros++;
      stats.detalhes.push({ arquivo: nomeArquivo, erro: 'XML vazio ou não disponível' });
      continue;
    }

    try {
      // Se a pasta raiz compartilhada já for a pasta do ano (ex: "XML's Saídas 2026"), usa ela diretamente
      let idAno = rootId;
      if (rootName !== subpastaAno) {
        const chaveAno = `ano_${subpastaAno}`;
        if (!folderCache[chaveAno]) {
          folderCache[chaveAno] = await obterOuCriarSubpastaDrive({ parentId: rootId, nomeSubpasta: subpastaAno });
        }
        idAno = folderCache[chaveAno];
      }

      // Cria/Acessa subpasta Empresa
      const chaveEmp = `${idAno}_${subpastaEmpresa}`;
      if (!folderCache[chaveEmp]) {
        folderCache[chaveEmp] = await obterOuCriarSubpastaDrive({ parentId: idAno, nomeSubpasta: subpastaEmpresa });
      }
      const idEmp = folderCache[chaveEmp];

      // Cria/Acessa subpasta MesAno
      const chaveMes = `${idEmp}_${subpastaMesAno}`;
      if (!folderCache[chaveMes]) {
        folderCache[chaveMes] = await obterOuCriarSubpastaDrive({ parentId: idEmp, nomeSubpasta: subpastaMesAno });
      }
      const idMes = folderCache[chaveMes];

      // Grava o arquivo
      const uploadRes = await salvarArquivoXmlNoDrive({
        parentId: idMes,
        nomeArquivo,
        xmlConteudo
      });

      if (uploadRes.salvo) {
        stats.gravados++;
        stats.detalhes.push({ arquivo: nomeArquivo, status: 'GRAVADO' });
      } else if (uploadRes.jaExistente) {
        stats.jaExistentes++;
        stats.detalhes.push({ arquivo: nomeArquivo, status: 'JA_EXISTENTE' });
      }
    } catch (err) {
      stats.erros++;
      stats.detalhes.push({ arquivo: nomeArquivo, erro: err.message });
      console.warn(`❌ [Google Drive Nuvem] Erro ao gravar ${nomeArquivo}:`, err.message);
    }
  }

  return stats;
}

module.exports = {
  carregarCredenciaisServiceAccount,
  obterAccessTokenGoogle,
  localizarPastaRaizXmlsSaidas,
  obterOuCriarSubpastaDrive,
  verificarArquivoExisteNoDrive,
  salvarArquivoXmlNoDrive,
  sincronizarNotasFaturamentoDriveNuvem
};
