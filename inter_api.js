const https = require('https');
const fs = require('fs');
const path = require('path');

/**
 * Módulo de Integração com a API do Banco Inter (Banking v2)
 * Suporta autenticação mTLS (Certificado X.509 + Chave Privada) e OAuth 2.0
 */

const INTER_BASE_URL = 'https://cdpj.partners.bancointer.com.br';

// Mapeamento das Contas do Banco Inter por Empresa
const CONTAS_INTER = {
  "14": {
    empresaCodigo: "14",
    empresaNome: "METAL PLENO / S4BW",
    banco: "077",
    agencia: "0001",
    conta: "397407319",
    contaFormatada: "3974073-9",
    cnpj: "44.914.992/0001-38",
    tabelaSE8: "SE8140",
    tabelaSE5: "SE5140"
  },
  "15": {
    empresaCodigo: "15",
    empresaNome: "GSI COFRES",
    banco: "077",
    agencia: "0001",
    conta: "137760655",
    contaFormatada: "13776065-5",
    cnpj: "18.324.901/0001-14",
    tabelaSE8: "SE8150",
    tabelaSE5: "SE5150"
  },
  "16": {
    empresaCodigo: "16",
    empresaNome: "OAÇO PRODUTOS DE AÇO",
    banco: "077",
    agencia: "0001",
    conta: "48165605",
    contaFormatada: "4816560-5",
    cnpj: "61.237.790/0001-18",
    tabelaSE8: "SE8160",
    tabelaSE5: "SE5160"
  }
};

// Cache de tokens de acesso por empresa
const tokenCache = {};

// Mapeamento de caminhos locais padrão para certificados
const LOCAL_CERT_PATHS = {
  "15": {
    cert: 'D:\\Backup IA\\Projetos Antigos\\Inter_API-Chave_e_Certificado GSI\\Inter API_Certificado.crt',
    key: 'D:\\Backup IA\\Projetos Antigos\\Inter_API-Chave_e_Certificado GSI\\Inter API_Chave.key'
  },
  "16": {
    cert: 'D:\\Backup IA\\Projetos Antigos\\Inter_API-Chave_e_Certificado OACO\\Inter API_Certificado.crt',
    key: 'D:\\Backup IA\\Projetos Antigos\\Inter_API-Chave_e_Certificado OACO\\Inter API_Chave.key'
  }
};

/**
 * Obtém as credenciais mTLS configuradas para uma empresa
 */
function getInterCredentials(empresaCodigo) {
  const code = String(empresaCodigo).trim();
  
  let clientId = '';
  let clientSecret = '';
  let certRaw = '';
  let keyRaw = '';

  if (code === '15') { // GSI
    clientId = process.env.GSI_clientId || process.env.GSI_CLIENT_ID || 
               process.env.INTER_CLIENT_ID_15 || process.env.INTER_CLIENT_ID_GSI || process.env.INTER_CLIENT_ID || '';
    clientSecret = process.env.GSI_clientSecret || process.env.GSI_CLIENT_SECRET || 
                   process.env.INTER_CLIENT_SECRET_15 || process.env.INTER_CLIENT_SECRET_GSI || process.env.INTER_CLIENT_SECRET || '';
    certRaw = process.env.GSI_cert || process.env.GSI_CERT || 
              process.env.INTER_CERT_15 || process.env.INTER_CERT_GSI || process.env.INTER_CERT || '';
    keyRaw = process.env.GSI_key || process.env.GSI_KEY || 
             process.env.INTER_KEY_15 || process.env.INTER_KEY_GSI || process.env.INTER_KEY || '';
  } else if (code === '16') { // OAÇO
    clientId = process.env.OACO_clientId || process.env.OACO_CLIENT_ID || 
               process.env.INTER_CLIENT_ID_16 || process.env.INTER_CLIENT_ID_OACO || process.env.INTER_CLIENT_ID || '';
    clientSecret = process.env.OACO_clientSecret || process.env.OACO_CLIENT_SECRET || 
                   process.env.INTER_CLIENT_SECRET_16 || process.env.INTER_CLIENT_SECRET_OACO || process.env.INTER_CLIENT_SECRET || '';
    certRaw = process.env.OACO_cert || process.env.OACO_CERT || 
              process.env.INTER_CERT_16 || process.env.INTER_CERT_OACO || process.env.INTER_CERT || '';
    keyRaw = process.env.OACO_key || process.env.OACO_KEY || 
             process.env.INTER_KEY_16 || process.env.INTER_KEY_OACO || process.env.INTER_KEY || '';
  } else { // 14 Metal Pleno
    clientId = process.env.MP_clientId || process.env.MP_CLIENT_ID || 
               process.env.INTER_CLIENT_ID_14 || process.env.INTER_CLIENT_ID_METAL_PLENO || process.env.INTER_CLIENT_ID || '';
    clientSecret = process.env.MP_clientSecret || process.env.MP_CLIENT_SECRET || 
                   process.env.INTER_CLIENT_SECRET_14 || process.env.INTER_CLIENT_SECRET_METAL_PLENO || process.env.INTER_CLIENT_SECRET || '';
    certRaw = process.env.MP_cert || process.env.MP_CERT || 
              process.env.INTER_CERT_14 || process.env.INTER_CERT_METAL_PLENO || process.env.INTER_CERT || '';
    keyRaw = process.env.MP_key || process.env.MP_KEY || 
             process.env.INTER_KEY_14 || process.env.INTER_KEY_METAL_PLENO || process.env.INTER_KEY || '';
  }

  // Fallback para caminhos locais conhecidos no drive D:
  const localFallbacks = LOCAL_CERT_PATHS[code];
  if (!certRaw && localFallbacks && fs.existsSync(localFallbacks.cert)) {
    certRaw = localFallbacks.cert;
  }
  if (!keyRaw && localFallbacks && fs.existsSync(localFallbacks.key)) {
    keyRaw = localFallbacks.key;
  }

  let cert = null;
  let key = null;

  if (certRaw) {
    if (Buffer.isBuffer(certRaw)) {
      cert = certRaw;
    } else if (typeof certRaw === 'string' && fs.existsSync(certRaw)) {
      cert = fs.readFileSync(certRaw);
    } else if (typeof certRaw === 'string' && certRaw.includes('BEGIN CERTIFICATE')) {
      cert = Buffer.from(certRaw, 'utf8');
    } else if (typeof certRaw === 'string') {
      try { cert = Buffer.from(certRaw, 'base64'); } catch (e) { cert = certRaw; }
    }
  }

  if (keyRaw) {
    if (Buffer.isBuffer(keyRaw)) {
      key = keyRaw;
    } else if (typeof keyRaw === 'string' && fs.existsSync(keyRaw)) {
      key = fs.readFileSync(keyRaw);
    } else if (typeof keyRaw === 'string' && (keyRaw.includes('BEGIN RSA PRIVATE KEY') || keyRaw.includes('BEGIN PRIVATE KEY'))) {
      key = Buffer.from(keyRaw, 'utf8');
    } else if (typeof keyRaw === 'string') {
      try { key = Buffer.from(keyRaw, 'base64'); } catch (e) { key = keyRaw; }
    }
  }

  const isConfigured = Boolean(clientId && clientSecret && cert && key);

  return {
    empresaCodigo: code,
    clientId,
    clientSecret,
    cert,
    key,
    isConfigured
  };
}

/**
 * Retorna o status de configuração das credenciais do Inter
 */
function getInterConfigStatus() {
  const status = {};
  for (const [code, info] of Object.entries(CONTAS_INTER)) {
    const creds = getInterCredentials(code);
    status[code] = {
      empresaCodigo: code,
      empresaNome: info.empresaNome,
      conta: info.conta,
      contaFormatada: info.contaFormatada,
      hasClientId: Boolean(creds.clientId),
      hasClientSecret: Boolean(creds.clientSecret),
      hasCert: Boolean(creds.cert),
      hasKey: Boolean(creds.key),
      isConfigured: creds.isConfigured,
      statusDesc: creds.isConfigured ? '🟢 Conectado' : '🟡 Aguardando Credenciais/Certificados no Render'
    };
  }
  return status;
}

/**
 * Obtém Token OAuth 2.0 junto ao Banco Inter
 */
async function getInterAccessToken(empresaCodigo) {
  const creds = getInterCredentials(empresaCodigo);
  
  if (!creds.isConfigured) {
    throw new Error(`Credenciais do Banco Inter não configuradas para a Empresa ${empresaCodigo}. Configure ${empresaCodigo === '15' ? 'GSI_clientId/GSI_clientSecret' : 'OACO_clientId/OACO_clientSecret'} e os certificados.`);
  }

  // Verifica cache
  const cached = tokenCache[empresaCodigo];
  if (cached && cached.expiresAt > Date.now() + 60000) {
    return cached.accessToken;
  }

  const scopesToTry = ['extrato.read', 'banking.saldo banking.extrato.read', 'extrato.read boleto-cobranca.read', ''];
  let lastError = null;

  for (const scope of scopesToTry) {
    try {
      const token = await requestOAuthToken(creds, scope);
      return token;
    } catch (err) {
      lastError = err;
      // Se o erro não for de escopo ou 400, não adianta tentar outros escopos
      if (!err.message.includes('400') && !err.message.includes('scope')) {
        break;
      }
    }
  }

  throw lastError || new Error(`Falha ao autenticar no Banco Inter para Empresa ${empresaCodigo}`);
}

function requestOAuthToken(creds, scope) {
  return new Promise((resolve, reject) => {
    const params = {
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: 'client_credentials'
    };
    if (scope) params.scope = scope;

    const postParams = new URLSearchParams(params).toString();
    const urlObj = new URL(`${INTER_BASE_URL}/oauth/v2/token`);

    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method: 'POST',
      cert: creds.cert,
      key: creds.key,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postParams)
      },
      timeout: 12000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const json = JSON.parse(data);
            const expiresIn = (json.expires_in || 3600) * 1000;
            tokenCache[creds.empresaCodigo] = {
              accessToken: json.access_token,
              expiresAt: Date.now() + expiresIn
            };
            resolve(json.access_token);
          } catch (e) {
            reject(new Error('Erro ao processar token do Banco Inter: ' + data));
          }
        } else {
          reject(new Error(`Erro ao autenticar no Banco Inter (Status ${res.statusCode}): ${data}`));
        }
      });
    });

    req.on('error', err => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout ao autenticar no Banco Inter'));
    });

    req.write(postParams);
    req.end();
  });
}

/**
 * Consulta o Saldo Bancário no Banco Inter para uma data específica
 * @param {string} empresaCodigo '14', '15' ou '16'
 * @param {string} dataIso 'YYYY-MM-DD'
 */
async function consultarSaldoInter(empresaCodigo, dataIso) {
  const info = CONTAS_INTER[String(empresaCodigo)];
  if (!info) throw new Error(`Empresa inválida: ${empresaCodigo}`);

  const creds = getInterCredentials(empresaCodigo);

  // Se não estiver configurado em produção, utiliza simulação inteligente
  if (!creds.isConfigured) {
    return {
      empresaCodigo,
      empresaNome: info.empresaNome,
      conta: info.conta,
      dataSaldo: dataIso,
      saldoDisponivel: null, // indica que precisa ser confrontado com dados locais/simulados
      origem: 'simulacao_pendente_credenciais',
      mensagem: 'Credenciais mTLS do Banco Inter não configuradas no Render.'
    };
  }

  try {
    const token = await getInterAccessToken(empresaCodigo);

    return new Promise((resolve, reject) => {
      const pathUrl = `/banking/v2/saldo?dataSaldo=${dataIso}`;
      const urlObj = new URL(`${INTER_BASE_URL}${pathUrl}`);

      const options = {
        hostname: urlObj.hostname,
        port: 443,
        path: `${urlObj.pathname}${urlObj.search}`,
        method: 'GET',
        cert: creds.cert,
        key: creds.key,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        },
        timeout: 15000
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const json = JSON.parse(data);
              const saldo = Number(json.disponivel !== undefined ? json.disponivel : (json.saldo || 0));
              resolve({
                empresaCodigo,
                empresaNome: info.empresaNome,
                conta: info.conta,
                dataSaldo: dataIso,
                saldoDisponivel: saldo,
                detalhes: json,
                origem: 'api_real_inter'
              });
            } catch (e) {
              reject(new Error('Resposta inválida de saldo do Banco Inter: ' + data));
            }
          } else {
            reject(new Error(`Erro ao consultar saldo Inter (Status ${res.statusCode}): ${data}`));
          }
        });
      });

      req.on('error', err => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout ao consultar saldo no Banco Inter'));
      });

      req.end();
    });
  } catch (err) {
    throw err;
  }
}

/**
 * Consulta o Extrato Bancário no Banco Inter para um período
 * @param {string} empresaCodigo '14', '15' ou '16'
 * @param {string} dataInicioIso 'YYYY-MM-DD'
 * @param {string} dataFimIso 'YYYY-MM-DD'
 */
async function consultarExtratoInter(empresaCodigo, dataInicioIso, dataFimIso) {
  const info = CONTAS_INTER[String(empresaCodigo)];
  if (!info) throw new Error(`Empresa inválida: ${empresaCodigo}`);

  const creds = getInterCredentials(empresaCodigo);

  if (!creds.isConfigured) {
    return {
      empresaCodigo,
      empresaNome: info.empresaNome,
      conta: info.conta,
      dataInicio: dataInicioIso,
      dataFim: dataFimIso,
      transacoes: [],
      origem: 'simulacao_pendente_credenciais'
    };
  }

  try {
    const token = await getInterAccessToken(empresaCodigo);

    return new Promise((resolve, reject) => {
      const pathUrl = `/banking/v2/extrato?dataInicio=${dataInicioIso}&dataFim=${dataFimIso}`;
      const urlObj = new URL(`${INTER_BASE_URL}${pathUrl}`);

      const options = {
        hostname: urlObj.hostname,
        port: 443,
        path: `${urlObj.pathname}${urlObj.search}`,
        method: 'GET',
        cert: creds.cert,
        key: creds.key,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        },
        timeout: 15000
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const json = JSON.parse(data);
              const transacoes = (json.transacoes || []).map((t, idx) => ({
                id: t.idTransacao || `inter-${idx}`,
                data: t.dataEntrada || t.data || '',
                tipoOperacao: t.tipoOperacao || (t.tipoTransacao === 'DEBITO' || Number(t.valor) < 0 ? 'D' : 'C'),
                valor: Math.abs(Number(t.valor || 0)),
                titulo: t.titulo || t.descricao || 'Transação Bancária',
                descricao: t.descricao || t.detalhes || t.nomePagador || t.nomeRecebedor || '',
                documento: t.numeroDocumento || t.codigoTransacao || ''
              }));

              resolve({
                empresaCodigo,
                empresaNome: info.empresaNome,
                conta: info.conta,
                dataInicio: dataInicioIso,
                dataFim: dataFimIso,
                transacoes,
                origem: 'api_real_inter'
              });
            } catch (e) {
              reject(new Error('Resposta inválida de extrato do Banco Inter: ' + data));
            }
          } else {
            reject(new Error(`Erro ao consultar extrato Inter (Status ${res.statusCode}): ${data}`));
          }
        });
      });

      req.on('error', err => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout ao consultar extrato no Banco Inter'));
      });

      req.end();
    });
  } catch (err) {
    throw err;
  }
}

module.exports = {
  CONTAS_INTER,
  getInterCredentials,
  getInterConfigStatus,
  getInterAccessToken,
  consultarSaldoInter,
  consultarExtratoInter
};
