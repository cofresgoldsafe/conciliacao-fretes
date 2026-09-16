/**
 * exportador_xml_sefaz.js — Módulo Modular de Exportação de XMLs de NF-e via SEFAZ
 * Responsável por:
 * 1. Consultar e baixar XMLs oficiais de NF-e (<nfeProc>) via WebService NFeDistribuicaoDFe (Ambiente Nacional).
 * 2. Gerenciar cache local persistente em disco (data/xml_nfe_cache/) para evitar chamadas redundantes e rejeição 656 (Consumo Indevido).
 * 3. Aplicar controle de taxa (anti-throttling) com pausas entre requisições mTLS.
 * 4. Empacotar os arquivos XML em pacote compactado .zip nativo em memória (via zip_util.js).
 */

const https = require('https');
const crypto = require('crypto');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { criarZipBuffer } = require('./zip_util');

// Host e Caminho do WebService de Distribuição DF-e de Interesse dos Atores da NF-e (Ambiente Nacional)
const SEFAZ_DIST_HOST = 'www1.nfe.fazenda.gov.br';
const SEFAZ_DIST_PATH = '/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx';

// Mapeamento dos CNPJs oficiais por Empresa
const CNPJ_EMPRESAS = {
  '14': '48758821000118', // Metal Pleno Comércio de Fechaduras e Ferragens
  '15': '14061778000115', // GSI Brasil Prestação de Serviços
  '16': '61237790000118'  // OAÇO Indústria e Comércio de Cofres
};

// Diretório de Cache Local Persistente
const CACHE_DIR = path.join(__dirname, 'data', 'xml_nfe_cache');
function garantirDiretorioCache() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/**
 * Obtém as credenciais do Certificado Digital A1 para autenticação mTLS
 * @param {string} empresaCod Código da empresa ('14', '15' ou '16')
 * @param {string} [passphraseCustom] Senha informada manualmente pelo usuário na interface
 */
function obterCredenciaisA1(empresaCod, passphraseCustom = '') {
  const senha =
    passphraseCustom ||
    (empresaCod === '14' && (process.env.NFE_CERT_MP_SENHA || process.env.MP_SENHA)) ||
    (empresaCod === '15' && (process.env.NFE_CERT_GSI_SENHA || process.env.NFSE_CERT_GSI_SENHA)) ||
    (empresaCod === '16' && (process.env.NFE_CERT_OACO_SENHA || process.env.OACO_SENHA)) ||
    process.env.NFSE_CERT_GSI_SENHA ||
    process.env.NFE_CERT_GSI_SENHA ||
    '';

  const pfxBase64 =
    (empresaCod === '14' && (process.env.NFE_CERT_MP_PFX_BASE64 || process.env.MP_PFX_BASE64)) ||
    (empresaCod === '15' && (process.env.NFE_CERT_GSI_PFX_BASE64 || process.env.NFSE_CERT_GSI_PFX_BASE64)) ||
    (empresaCod === '16' && (process.env.NFE_CERT_OACO_PFX_BASE64 || process.env.OACO_PFX_BASE64)) ||
    process.env.NFSE_CERT_GSI_PFX_BASE64 ||
    process.env.NFE_CERT_GSI_PFX_BASE64 ||
    process.env.NFE_CERT_MP_PFX_BASE64 ||
    process.env.NFE_CERT_OACO_PFX_BASE64 ||
    '';

  if (pfxBase64) {
    return {
      pfx: Buffer.isBuffer(pfxBase64) ? pfxBase64 : Buffer.from(String(pfxBase64).replace(/\s+/g, ''), 'base64'),
      passphrase: senha
    };
  }

  // Fallback para arquivos locais conhecidos
  const localCandidates = [
    'C:/Users/Alexandre/Downloads/120a2609105ad966.pfx',
    'C:/Users/Alexandre/Downloads/120a2601206670b4.pfx',
    path.join(__dirname, 'certs', 'gsi.pfx')
  ];

  for (const cand of localCandidates) {
    if (fs.existsSync(cand)) {
      try {
        return {
          pfx: fs.readFileSync(cand),
          passphrase: senha
        };
      } catch (e) {}
    }
  }

  const certPem =
    (empresaCod === '14' && (process.env.NFE_CERT_MP_CERT_PEM || process.env.MP_cert)) ||
    (empresaCod === '15' && (process.env.NFE_CERT_GSI_CERT_PEM || process.env.NFSE_CERT_GSI_CERT_PEM)) ||
    (empresaCod === '16' && (process.env.NFE_CERT_OACO_CERT_PEM || process.env.OACO_cert)) ||
    process.env.NFSE_CERT_GSI_CERT_PEM ||
    process.env.MP_cert ||
    '';

  const keyPem =
    (empresaCod === '14' && (process.env.NFE_CERT_MP_KEY_PEM || process.env.MP_key)) ||
    (empresaCod === '15' && (process.env.NFE_CERT_GSI_KEY_PEM || process.env.NFSE_CERT_GSI_KEY_PEM)) ||
    (empresaCod === '16' && (process.env.NFE_CERT_OACO_KEY_PEM || process.env.OACO_key)) ||
    process.env.NFSE_CERT_GSI_KEY_PEM ||
    process.env.MP_key ||
    '';

  if (certPem && keyPem) {
    return {
      cert: certPem.startsWith('-----BEGIN') ? certPem : Buffer.from(certPem, 'base64').toString('utf8'),
      key: keyPem.startsWith('-----BEGIN') ? keyPem : Buffer.from(keyPem, 'base64').toString('utf8'),
      passphrase: senha || undefined
    };
  }

  return null;
}

/**
 * Monta o envelope SOAP 1.2 estrito para o NFeDistribuicaoDFe (consChNFe)
 * @param {string} chaveNfe Chave de 44 dígitos
 * @param {string} cnpjEmitente CNPJ da empresa emitente (14 dígitos)
 */
function montarEnvelopeDistDFe(chaveNfe, cnpjEmitente) {
  const chLimpa = String(chaveNfe || '').replace(/\D/g, '').trim();
  const cnpLimpo = String(cnpjEmitente || '').replace(/\D/g, '').trim();

  return `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Header/><soap12:Body><nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg><distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>1</tpAmb><cUFAutor>35</cUFAutor><CNPJ>${cnpLimpo}</CNPJ><consChNFe><chNFe>${chLimpa}</chNFe></consChNFe></distDFeInt></nfeDadosMsg></nfeDistDFeInteresse></soap12:Body></soap12:Envelope>`;
}

/**
 * Extrai o texto contido em uma tag XML simples
 */
function extrairTag(xml, tag) {
  if (!xml) return '';
  const regex = new RegExp(`<(?:[\\w.-]+:)?${tag}[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}>`, 'i');
  const m = xml.match(regex);
  return m ? m[1].trim() : '';
}

/**
 * Consulta e baixa o XML oficial de uma única NF-e da SEFAZ via WebService NFeDistribuicaoDFe
 * @param {Object} params
 * @param {string} params.chaveNfe Chave de acesso de 44 dígitos
 * @param {string} params.empresaCod Código da empresa ('14', '15' ou '16')
 * @param {string} [params.passphrase] Senha do certificado digital
 * @returns {Promise<{sucesso: boolean, xml?: string, chave: string, doCache?: boolean, erro?: string, cStat?: string, xMotivo?: string}>}
 */
async function obterXmlNfeSefaz({ chaveNfe, empresaCod, passphrase = '' }) {
  const chaveLimpa = String(chaveNfe || '').replace(/\D/g, '').trim();
  if (chaveLimpa.length !== 44) {
    return {
      sucesso: false,
      chave: chaveLimpa,
      erro: `Chave de acesso inválida (${chaveLimpa.length} dígitos, esperado 44)`
    };
  }

  garantirDiretorioCache();
  const cachePath = path.join(CACHE_DIR, `${chaveLimpa}.xml`);

  // 1. Verificação em Cache Local Persistente (Zero latência e zero consumo de cota SEFAZ)
  if (fs.existsSync(cachePath)) {
    try {
      const cachedXml = fs.readFileSync(cachePath, 'utf8');
      if (cachedXml && cachedXml.includes('<nfeProc') && cachedXml.includes('</nfeProc>')) {
        return {
          sucesso: true,
          xml: cachedXml,
          chave: chaveLimpa,
          doCache: true
        };
      }
    } catch (e) {}
  }

  // 2. Preparação das credenciais mTLS
  const credenciais = obterCredenciaisA1(empresaCod, passphrase);
  if (!credenciais) {
    return {
      sucesso: false,
      chave: chaveLimpa,
      erro: 'Certificado Digital A1 não configurado ou senha incorreta'
    };
  }

  const cnpjEmitente = CNPJ_EMPRESAS[empresaCod] || CNPJ_EMPRESAS['16'];
  const envelopeXml = montarEnvelopeDistDFe(chaveLimpa, cnpjEmitente);
  const postData = Buffer.from(envelopeXml, 'utf8');

  const reqOptions = {
    hostname: SEFAZ_DIST_HOST,
    port: 443,
    path: SEFAZ_DIST_PATH,
    method: 'POST',
    rejectUnauthorized: false,
    secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
    ciphers: 'DEFAULT:@SECLEVEL=1',
    headers: {
      'Content-Type': 'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse"',
      'SOAPAction': 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse',
      'Content-Length': postData.length,
      'User-Agent': 'Antigravity-Fiscal/1.0'
    },
    timeout: 15000
  };

  if (credenciais.pfx) {
    reqOptions.pfx = credenciais.pfx;
    reqOptions.passphrase = credenciais.passphrase;
  } else if (credenciais.cert && credenciais.key) {
    reqOptions.cert = credenciais.cert;
    reqOptions.key = credenciais.key;
    if (credenciais.passphrase) reqOptions.passphrase = credenciais.passphrase;
  }

  return new Promise((resolve) => {
    let req;
    try {
      req = https.request(reqOptions, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            if (res.statusCode === 403) {
              return resolve({
                sucesso: false,
                chave: chaveLimpa,
                cStat: '403',
                erro: 'SEFAZ rejeitou o Certificado Digital (HTTP 403 Forbidden). Verifique a validade e a senha do certificado A1.'
              });
            }

            if (res.statusCode >= 500) {
              return resolve({
                sucesso: false,
                chave: chaveLimpa,
                cStat: String(res.statusCode),
                erro: `WebService SEFAZ retornou erro HTTP ${res.statusCode}`
              });
            }

            const cStat = extrairTag(data, 'cStat');
            const xMotivo = extrairTag(data, 'xMotivo');

            // 138: Documento localizado para o destinatário/emitente
            // 137: Nenhum documento localizado para o destinatário/emitente
            // 656: Consumo Indevido
            if (cStat === '138') {
              const docZipBase64 = extrairTag(data, 'docZip');
              if (docZipBase64) {
                try {
                  const gzippedBuf = Buffer.from(docZipBase64, 'base64');
                  const xmlBuf = zlib.gunzipSync(gzippedBuf);
                  const xmlStr = xmlBuf.toString('utf8');

                  // Salva no cache local persistente
                  try {
                    fs.writeFileSync(cachePath, xmlStr, 'utf8');
                  } catch (e) {}

                  return resolve({
                    sucesso: true,
                    xml: xmlStr,
                    chave: chaveLimpa,
                    doCache: false,
                    cStat,
                    xMotivo
                  });
                } catch (gzipErr) {
                  return resolve({
                    sucesso: false,
                    chave: chaveLimpa,
                    cStat,
                    erro: `Falha ao descomprimir XML retornado pela SEFAZ: ${gzipErr.message}`
                  });
                }
              }
            }

            return resolve({
              sucesso: false,
              chave: chaveLimpa,
              cStat: cStat || 'DESCONHECIDO',
              xMotivo: xMotivo || 'Documento não localizado na SEFAZ para esta chave',
              erro: xMotivo ? `SEFAZ: ${xMotivo} (cStat ${cStat})` : `Retorno SEFAZ cStat ${cStat}`
            });

          } catch (parseErr) {
            resolve({
              sucesso: false,
              chave: chaveLimpa,
              erro: `Falha ao processar envelope de resposta da SEFAZ: ${parseErr.message}`
            });
          }
        });
      });
    } catch (errInit) {
      return resolve({
        sucesso: false,
        chave: chaveLimpa,
        erro: `Falha ao inicializar requisição mTLS: ${errInit.message}`
      });
    }

    req.on('error', (err) => {
      resolve({
        sucesso: false,
        chave: chaveLimpa,
        erro: `Falha de conexão com SEFAZ Ambiente Nacional: ${err.message}`
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        sucesso: false,
        chave: chaveLimpa,
        erro: 'Tempo limite esgotado ao consultar a SEFAZ Ambiente Nacional (15s)'
      });
    });

    try {
      req.write(postData);
      req.end();
    } catch (writeErr) {
      resolve({
        sucesso: false,
        chave: chaveLimpa,
        erro: `Falha ao enviar mensagem para SEFAZ: ${writeErr.message}`
      });
    }
  });
}

/**
 * Pausa utilitária assíncrona para anti-throttling
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Processa um lote de chaves de NF-e, obtém os XMLs e monta o arquivo .zip final em memória
 * @param {Object} params
 * @param {string} params.empresa Código da empresa ('14', '15', '16')
 * @param {Array<{doc?: string, serie?: string, chave: string}>} params.itens Lista de itens/chaves a processar
 * @param {string} [params.passphrase] Senha opcional do certificado A1
 * @param {Function} [params.onProgress] Callback opcional de progresso
 * @returns {Promise<{sucesso: boolean, zipBuffer?: Buffer, totalItens: number, totalObtidos: number, totalCache: number, totalSefaz: number, falhas: Array<{chave: string, erro: string}>}>}
 */
async function processarLoteXmlNfeZip({ empresa, itens = [], passphrase = '', onProgress = null }) {
  const empresaCod = String(empresa || '16').toUpperCase();
  const arquivosZip = [];
  const falhas = [];

  let totalCache = 0;
  let totalSefaz = 0;

  for (let i = 0; i < itens.length; i++) {
    const item = itens[i];
    const chave = String(item.chave || item.chaveAcesso || '').replace(/\D/g, '').trim();

    if (!chave || chave.length !== 44) {
      falhas.push({ chave: chave || item.doc || `item_${i}`, erro: 'Chave de acesso com tamanho incorreto ou vazia' });
      continue;
    }

    if (typeof onProgress === 'function') {
      onProgress(i + 1, itens.length, chave);
    }

    const res = await obterXmlNfeSefaz({ chaveNfe: chave, empresaCod, passphrase });

    if (res.sucesso && res.xml) {
      const nomeArquivo = `${chave}.xml`;
      arquivosZip.push({
        name: nomeArquivo,
        content: res.xml
      });

      if (res.doCache) {
        totalCache++;
      } else {
        totalSefaz++;
        // Pausa anti-throttling de 500ms apenas se foi feita requisição de rede à SEFAZ
        await sleep(500);
      }
    } else {
      falhas.push({
        chave,
        doc: item.doc || '',
        erro: res.erro || res.xMotivo || 'Falha ao obter XML da SEFAZ'
      });
    }
  }

  if (arquivosZip.length === 0) {
    return {
      sucesso: false,
      totalItens: itens.length,
      totalObtidos: 0,
      totalCache,
      totalSefaz,
      falhas,
      erro: falhas.length > 0 ? falhas[0].erro : 'Nenhum XML pôde ser obtido para as notas selecionadas.'
    };
  }

  const zipBuffer = criarZipBuffer(arquivosZip);

  return {
    sucesso: true,
    zipBuffer,
    totalItens: itens.length,
    totalObtidos: arquivosZip.length,
    totalCache,
    totalSefaz,
    falhas
  };
}

module.exports = {
  CNPJ_EMPRESAS,
  CACHE_DIR,
  obterCredenciaisA1,
  montarEnvelopeDistDFe,
  obterXmlNfeSefaz,
  processarLoteXmlNfeZip
};
