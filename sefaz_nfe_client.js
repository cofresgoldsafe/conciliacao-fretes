/**
 * sefaz_nfe_client.js — Cliente de Integração com a SEFAZ para Consulta de Situação de NF-e
 * WebService: NFeConsultaProtocolo4 (WSDL SOAP 1.2)
 * Suporta:
 * 1. Autenticação mTLS utilizando Certificado Digital A1 (.pfx ou .pem)
 * 2. Consulta de Situação em Tempo Real por Chave de Acesso de 44 dígitos
 * 3. Consulta em Lote com controle de rate limiting (anti-throttling cStat 656)
 * 4. Matriz de Classificação de Divergências Fiscais (Protheus x SEFAZ)
 */

const https = require('https');
const crypto = require('crypto');

// Endpoints Homologados da SEFAZ
const SEFAZ_SP_HOST = 'nfe.fazenda.sp.gov.br';
const SEFAZ_SP_PATH = '/ws/nfeconsultaprotocolo4.asmx';

// Mapeamento de Códigos Oficiais de Retorno da SEFAZ (cStat)
const CSTAT_MAP = {
  '100': { status: 'AUTORIZADA', rotulo: 'Autorizada', desc: 'Autorizado o uso da NF-e', badgeClass: 'badge-success' },
  '101': { status: 'CANCELADA', rotulo: 'Cancelada', desc: 'Cancelamento de NF-e homologado', badgeClass: 'badge-danger' },
  '102': { status: 'INUTILIZADA', rotulo: 'Inutilizada', desc: 'Inutilização de número homologada', badgeClass: 'badge-warning' },
  '110': { status: 'DENEGADA', rotulo: 'Denegada', desc: 'Uso Denegado (irregularidade cadastral)', badgeClass: 'badge-danger' },
  '135': { status: 'EVENTO_VINCULADO', rotulo: 'Evento Registrado', desc: 'Evento registrado e vinculado a NF-e', badgeClass: 'badge-info' },
  '217': { status: 'NAO_CONSTA', rotulo: 'Não Consta', desc: 'NF-e não consta na base de dados da SEFAZ', badgeClass: 'badge-secondary' },
  '656': { status: 'CONSUMO_INDEVIDO', rotulo: 'Consumo Indevido', desc: 'Consumo Indevido: limite de requisições excedido temporariamente', badgeClass: 'badge-warning' }
};

/**
 * Decodifica entidades XML para texto limpo
 */
function decodificarXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * Extrai o texto contido em uma tag XML simples
 */
function extrairTag(xml, tag) {
  if (!xml) return '';
  const regex = new RegExp(`<(?:[\\w.-]+:)?${tag}[^>]*>([^<]*)</(?:[\\w.-]+:)?${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? decodificarXml(match[1]) : '';
}

/**
 * Obtém os buffers e credenciais de certificado A1 para a empresa informada,
 * com fallback para qualquer certificado disponível no ambiente.
 */
function obterCertificadoA1(empresaCod) {
  const pfxBase64 =
    (empresaCod === '14' && (process.env.NFE_CERT_MP_PFX_BASE64 || process.env.MP_PFX_BASE64)) ||
    (empresaCod === '15' && (process.env.NFE_CERT_GSI_PFX_BASE64 || process.env.NFSE_CERT_GSI_PFX_BASE64)) ||
    (empresaCod === '16' && (process.env.NFE_CERT_OACO_PFX_BASE64 || process.env.OACO_PFX_BASE64)) ||
    // Fallback cruzado: qualquer certificado A1 ICP-Brasil autentica o mTLS na SEFAZ para consulta
    process.env.NFSE_CERT_GSI_PFX_BASE64 ||
    process.env.NFE_CERT_GSI_PFX_BASE64 ||
    process.env.NFE_CERT_MP_PFX_BASE64 ||
    process.env.NFE_CERT_OACO_PFX_BASE64 ||
    '';

  const senha =
    (empresaCod === '14' && (process.env.NFE_CERT_MP_SENHA || process.env.MP_SENHA)) ||
    (empresaCod === '15' && (process.env.NFE_CERT_GSI_SENHA || process.env.NFSE_CERT_GSI_SENHA)) ||
    (empresaCod === '16' && (process.env.NFE_CERT_OACO_SENHA || process.env.OACO_SENHA)) ||
    process.env.NFSE_CERT_GSI_SENHA ||
    process.env.NFE_CERT_GSI_SENHA ||
    '';

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

  if (pfxBase64) {
    return {
      pfx: Buffer.from(pfxBase64.replace(/\s+/g, ''), 'base64'),
      passphrase: senha
    };
  }

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
 * Monta o Envelope SOAP 1.2 oficial para NFeConsultaProtocolo4
 */
function montarEnvelopeSoap12(chaveNfe) {
  const chaveLimpa = String(chaveNfe).replace(/\D/g, '').trim();
  return `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <nfeDadosMsg xmlns="http://www.portalfazenda.gov.br/nfe/wsdl/NFeConsultaProtocolo4">
      <consSitNFe xmlns="http://www.portalfazenda.gov.br/nfe" versao="4.00">
        <tpAmb>1</tpAmb>
        <xServ>CONSULTAR</xServ>
        <chNFe>${chaveLimpa}</chNFe>
      </consSitNFe>
    </nfeDadosMsg>
  </soap12:Body>
</soap12:Envelope>`.trim();
}

/**
 * Consulta a situação de uma única chave de acesso junto à SEFAZ
 */
async function consultarSituacaoNfeSefaz(chaveNfe, empresaCod = '14') {
  const chaveLimpa = String(chaveNfe || '').replace(/\D/g, '').trim();
  if (chaveLimpa.length !== 44) {
    return {
      sucesso: false,
      cStat: 'INVALIDA',
      status: 'CHAVE_INVALIDA',
      rotulo: 'Chave Inválida',
      xMotivo: `Chave de acesso com tamanho incorreto (${chaveLimpa.length} dígitos, esperado 44)`,
      protocolo: '',
      dataHora: '',
      chave: chaveLimpa
    };
  }

  const credenciais = obterCertificadoA1(empresaCod);
  if (!credenciais) {
    return {
      sucesso: false,
      cStat: 'SEM_CERTIFICADO',
      status: 'SEM_CERTIFICADO',
      rotulo: 'Sem Certificado A1',
      xMotivo: 'Certificado Digital A1 não configurado no servidor para autenticação mTLS na SEFAZ. Utilize o link do Portal da NF-e.',
      protocolo: '',
      dataHora: '',
      chave: chaveLimpa
    };
  }

  const envelopeXml = montarEnvelopeSoap12(chaveLimpa);
  const postData = Buffer.from(envelopeXml, 'utf8');

  const reqOptions = {
    hostname: SEFAZ_SP_HOST,
    port: 443,
    path: SEFAZ_SP_PATH,
    method: 'POST',
    headers: {
      'Content-Type': 'application/soap+xml; charset=utf-8',
      'Content-Length': postData.length,
      'User-Agent': 'Antigravity-Fiscal/1.0'
    },
    timeout: 12000
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
    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const cStat = extrairTag(data, 'cStat') || 'DESCONHECIDO';
          const xMotivo = extrairTag(data, 'xMotivo') || 'Resposta recebida da SEFAZ';
          const nProt = extrairTag(data, 'nProt') || '';
          const dhRecbto = extrairTag(data, 'dhRecbto') || '';

          const mapeado = CSTAT_MAP[cStat] || {
            status: 'OUTRO',
            rotulo: `cStat ${cStat}`,
            desc: xMotivo,
            badgeClass: 'badge-secondary'
          };

          resolve({
            sucesso: true,
            cStat,
            status: mapeado.status,
            rotulo: mapeado.rotulo,
            xMotivo,
            protocolo: nProt,
            dataHora: dhRecbto,
            chave: chaveLimpa,
            rawXmlSnippet: data.slice(0, 300)
          });
        } catch (parseErr) {
          resolve({
            sucesso: false,
            cStat: 'ERRO_PARSE',
            status: 'ERRO_PARSE',
            rotulo: 'Erro Parse',
            xMotivo: `Falha ao processar resposta XML da SEFAZ: ${parseErr.message}`,
            protocolo: '',
            dataHora: '',
            chave: chaveLimpa
          });
        }
      });
    });

    req.on('error', (err) => {
      resolve({
        sucesso: false,
        cStat: 'ERRO_CONEXAO',
        status: 'ERRO_CONEXAO',
        rotulo: 'Erro Conexão',
        xMotivo: `Falha de conexão com SEFAZ-SP: ${err.message}`,
        protocolo: '',
        dataHora: '',
        chave: chaveLimpa
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        sucesso: false,
        cStat: 'TIMEOUT',
        status: 'TIMEOUT',
        rotulo: 'Timeout SEFAZ',
        xMotivo: 'Tempo limite esgotado ao consultar a SEFAZ-SP (12s)',
        protocolo: '',
        dataHora: '',
        chave: chaveLimpa
      });
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Matriz de Diagnóstico: Classifica o status entre o Protheus e a SEFAZ
 */
function classificarDivergencia(statusProtheus, statusSefaz) {
  const p = String(statusProtheus || '').toUpperCase().trim();
  const s = String(statusSefaz || '').toUpperCase().trim();

  // Caso 1: Cancelada no Protheus e Ativa na SEFAZ (DIVERGÊNCIA CRÍTICA)
  if (p === 'CANCELADA' && s === 'AUTORIZADA') {
    return {
      divergencia: true,
      gravidade: 'CRITICA',
      tipo: 'CANCELADA_PROTHEUS_ATIVA_SEFAZ',
      label: '🚨 CANCELADA NO ERP / ATIVA NA SEFAZ',
      tooltip: 'A NF consta cancelada/excluída no Protheus, mas continua AUTORIZADA e válida na Fazenda!',
      badgeClass: 'badge-danger'
    };
  }

  // Caso 2: Ativa no Protheus e Cancelada na SEFAZ (DIVERGÊNCIA CRÍTICA)
  if (p === 'ATIVA' && s === 'CANCELADA') {
    return {
      divergencia: true,
      gravidade: 'CRITICA',
      tipo: 'ATIVA_PROTHEUS_CANCELADA_SEFAZ',
      label: '🚨 ATIVA NO ERP / CANCELADA NA SEFAZ',
      tooltip: 'A NF está ativa e faturada no Protheus, mas foi CANCELADA na SEFAZ!',
      badgeClass: 'badge-danger'
    };
  }

  // Caso 3: Salto / Numeração Faltante
  if (p === 'FALTANTE') {
    if (s === 'INUTILIZADA') {
      return {
        divergencia: false,
        gravidade: 'OK',
        tipo: 'SALTO_INUTILIZADO',
        label: '✅ NÚMERO INUTILIZADO NA SEFAZ',
        tooltip: 'Salto de numeração no Protheus devidamente inutilizado na SEFAZ.',
        badgeClass: 'badge-success'
      };
    }
    return {
      divergencia: true,
      gravidade: 'ALERTA',
      tipo: 'NUMERACAO_FALTANTE',
      label: '⚠️ SALTO DE NUMERAÇÃO (SEM INUTILIZAÇÃO)',
      tooltip: 'Número pulado na sequência oficial que não possui NF autorizada nem evento de inutilização.',
      badgeClass: 'badge-warning'
    };
  }

  // Caso 4: Conciliado Normal
  if ((p === 'ATIVA' && s === 'AUTORIZADA') ||
      (p === 'CANCELADA' && s === 'CANCELADA') ||
      (p === 'INUTILIZADA' && (s === 'INUTILIZADA' || s === 'NAO_CONSTA'))) {
    return {
      divergencia: false,
      gravidade: 'OK',
      tipo: 'CONCILIADO',
      label: '✅ CONCILIADO',
      tooltip: 'Status coincidente entre o ERP Protheus e a SEFAZ.',
      badgeClass: 'badge-success'
    };
  }

  // Caso 5: Pendente de Consulta na SEFAZ
  if (!s || s === 'NAO_CONSULTADA') {
    return {
      divergencia: false,
      gravidade: 'PENDENTE',
      tipo: 'PENDENTE_CONSULTA',
      label: '⏳ AGUARDANDO SEFAZ',
      tooltip: 'Clique em "Consultar Situação SEFAZ" para verificar a situação na Fazenda.',
      badgeClass: 'badge-secondary'
    };
  }

  // Caso 6: Outros status ou advertências
  return {
    divergencia: s === 'NAO_CONSTA' && p === 'ATIVA',
    gravidade: s === 'NAO_CONSTA' && p === 'ATIVA' ? 'ALERTA' : 'INFORMATIVO',
    tipo: 'OUTRO',
    label: `${p} / ${s}`,
    tooltip: `Protheus: ${p} | SEFAZ: ${s}`,
    badgeClass: 'badge-secondary'
  };
}

/**
 * Consulta em lote com controle de throttling (150ms entre chamadas)
 */
async function consultarLoteSefaz(itens, empresaCod = '14', delayMs = 150) {
  const resultados = [];
  for (let i = 0; i < itens.length; i++) {
    const item = itens[i];
    if (item.chaveNfe && item.chaveNfe.length === 44) {
      const resSefaz = await consultarSituacaoNfeSefaz(item.chaveNfe, empresaCod);
      const diag = classificarDivergencia(item.statusProtheus, resSefaz.status);
      resultados.push({
        doc: item.doc,
        chaveNfe: item.chaveNfe,
        statusProtheus: item.statusProtheus,
        sefaz: resSefaz,
        diagnostico: diag
      });
      // Pausa anti-throttling para evitar cStat 656
      if (i < itens.length - 1 && delayMs > 0) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    } else {
      const diag = classificarDivergencia(item.statusProtheus, 'NAO_CONSTA');
      resultados.push({
        doc: item.doc,
        chaveNfe: item.chaveNfe || '',
        statusProtheus: item.statusProtheus,
        sefaz: {
          sucesso: true,
          cStat: '217',
          status: 'NAO_CONSTA',
          rotulo: 'Não Consta',
          xMotivo: 'NF sem chave de acesso ou número faltante',
          protocolo: '',
          dataHora: ''
        },
        diagnostico: diag
      });
    }
  }
  return resultados;
}

module.exports = {
  SEFAZ_SP_HOST,
  SEFAZ_SP_PATH,
  CSTAT_MAP,
  extrairTag,
  montarEnvelopeSoap12,
  obterCertificadoA1,
  consultarSituacaoNfeSefaz,
  classificarDivergencia,
  consultarLoteSefaz
};
